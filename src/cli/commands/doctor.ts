import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, relative, sep as pathSep } from 'path';
import { HEARTBEAT_STALE_AFTER_MS, isHeartbeatStale } from '../../../scripts/run-task/heartbeat.js';
import { getQualityLogFile, locateLogTable } from '../../../scripts/run-task/quality-log.js';
import { gatherRunContext, isStatusJson } from '../../../scripts/run-task/run-context.js';
import { type StatusJson } from '../../../scripts/run-task/types.js';
import { CANON_RUNTIME_GITIGNORE_PATTERNS } from '../../lib/canon-block.js';
import { isAvailable } from '../deps.js';

interface Check {
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail?: string;
}

export const EXPECTED_TEMPLATES = [
    'spec.md', 'plan.md', 'handoff.md', 'review.md',
    'done.md', 'spec-review.md', 'notes.md', 'status.json', 'pr-body.md',
];

// Canon's recommended .claude/settings.json permissions.allow entries.
// Kept in sync with README's "Skip the permission prompts" block — the
// `README "Skip the permission prompts" allowlist matches RECOMMENDED_ALLOW`
// test in tests/cli.test.ts will fail CI if these drift apart.
//
// Most entries are for *pipeline composition* — Claude prefers its built-in
// Read / Glob / Grep tools for raw file reads and codebase search; bash
// equivalents (`cat`, `head`, `grep`, etc.) are only reached for when
// commands need to be chained (e.g., `cat foo.json | jq '.bar'`).
export const RECOMMENDED_ALLOW = [
    'Bash(git *)',
    'Bash(gh *)',
    'Bash(sed *)',
    'Bash(awk *)',
    'Bash(ls *)',
    'Bash(find *)',
    'Bash(fd *)',
    'Bash(cat *)',
    'Bash(head *)',
    'Bash(tail *)',
    'Bash(grep *)',
    'Bash(rg *)',
    'Bash(wc *)',
    'Bash(echo *)',
    'Bash(tr *)',
    'Bash(xargs *)',
    'Bash(tee *)',
    'Bash(jq *)',
    'Bash(npm run *)',
    // Both bare and `*`-suffixed forms are required: Claude Code's `Bash(npm
    // test *)` pattern matches `npm test --watch` etc. but does not match
    // bare `npm test` (no trailing space for the glob to consume). Bare and
    // flagged forms are both common — CI runs `npm test` bare and
    // `npm audit --omit=dev` flagged.
    'Bash(npm test)',
    'Bash(npm test *)',
    'Bash(npm audit)',
    'Bash(npm audit *)',
    'Bash(npm ci)',
    'Bash(npm ci *)',
    'Bash(npx canon *)',
    'Bash(npx tsc *)',
    'Bash(canon *)',
    'Bash(codex *)',
    'Skill(canon-init)',
    'Skill(canon-spec)',
    'Skill(canon-spec:*)',
    'Skill(canon-pipeline)',
    'Skill(canon-pipeline:*)',
    'Skill(canon-status)',
    'Skill(canon-status:*)',
    'Skill(canon-changelog)',
    'Skill(canon-changelog:*)',
    'Skill(canon-spec-review)',
    'Skill(canon-spec-review:*)',
    'Skill(canon-inline-review)',
    'Skill(canon-inline-review:*)',
];

// Canon's recommended discovery nudge for adopter CLAUDE.md files.
// Kept in sync with README's "Discovery nudge" block — the
// `README "Discovery nudge" text matches RECOMMENDED_NUDGE` test in
// tests/cli.test.ts will fail CI if these drift apart.
export const RECOMMENDED_NUDGE = [
    'This project uses canon, a spec-first multi-agent pipeline.',
    'Route new features / fixes / refactors through the canon skills.',
    'Start with `/canon-spec` rather than implementing directly.',
].join('\n');

export const MIN_CLAUDE_VERSION = { major: 2, minor: 1, patch: 72 };

export interface ParsedClaudeVersion {
    major: number;
    minor: number;
    patch: number;
}

export function parseClaudeVersion(raw: string): ParsedClaudeVersion | null {
    const match = raw.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
    };
}

// --- individual checks ---

export function checkPlatform(): Check {
    const isWindows = process.platform === 'win32';
    if (!isWindows) return { label: 'platform', status: 'pass' };
    const isWSL = existsSync('/proc/version') &&
        readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
    if (isWSL) return { label: 'platform (WSL)', status: 'pass' };
    return {
        label: 'platform',
        status: 'warn',
        detail: 'Windows without WSL — canon is untested here; use WSL for best results',
    };
}

export function checkNodeVersion(): Check {
    const match = process.version.match(/^v(\d+)/);
    const major = match ? parseInt(match[1], 10) : 0;
    if (major >= 24) return { label: `node ${process.version}`, status: 'pass' };
    return {
        label: `node ${process.version}`,
        status: 'fail',
        detail: 'node 24+ required — https://nodejs.org',
    };
}

export function checkBinary(cmd: string, required: boolean, hint: string): Check {
    if (isAvailable(cmd)) return { label: cmd, status: 'pass' };
    return {
        label: cmd,
        status: required ? 'fail' : 'warn',
        detail: hint,
    };
}

type ClaudeVersionRunner = () => string;

const defaultClaudeVersionRunner: ClaudeVersionRunner = () => execSync('claude --version', { encoding: 'utf8' });

export function checkClaudeVersion(runner: ClaudeVersionRunner = defaultClaudeVersionRunner): Check {
    let raw: string;
    try {
        raw = runner();
    } catch {
        return {
            label: 'claude (version unreadable)',
            status: 'warn',
            detail: 'Could not read `claude --version` output — verify your Claude Code install',
        };
    }

    const parsed = parseClaudeVersion(raw);
    if (!parsed) {
        const preview = raw.trim() || '<empty>';
        return {
            label: `claude (unparseable: ${preview.slice(0, 32)})`,
            status: 'warn',
            detail: 'Could not parse `claude --version` output — verify your Claude Code install',
        };
    }

    const label = `claude ${parsed.major}.${parsed.minor}.${parsed.patch}`;
    const tooOld =
        parsed.major < MIN_CLAUDE_VERSION.major ||
        (
            parsed.major === MIN_CLAUDE_VERSION.major &&
            parsed.minor < MIN_CLAUDE_VERSION.minor
        ) ||
        (
            parsed.major === MIN_CLAUDE_VERSION.major &&
            parsed.minor === MIN_CLAUDE_VERSION.minor &&
            parsed.patch < MIN_CLAUDE_VERSION.patch
        );

    if (tooOld) {
        return {
            label,
            status: 'fail',
            detail: 'Claude Code 2.1.72+ required — npm install -g @anthropic-ai/claude-code',
        };
    }

    return { label, status: 'pass' };
}

export function checkCanonDiscoveryNudge(cwd: string): Check {
    const filenames = ['CLAUDE.md', 'AGENTS.md'];
    const existingFiles = filenames.filter(filename => existsSync(join(cwd, filename)));

    if (existingFiles.length === 0) {
        return {
            label: 'canon discovery nudge',
            status: 'warn',
            detail: `no AGENTS.md or CLAUDE.md found — run the built-in \`/init\` (Claude Code) or Codex init to generate a high-level project overview, then add this to it:\n${RECOMMENDED_NUDGE}`,
        };
    }

    const mentionsCanon = existingFiles.some(filename => {
        const path = join(cwd, filename);
        return /canon/i.test(readFileSync(path, 'utf8'));
    });

    if (mentionsCanon) {
        return { label: 'canon discovery nudge', status: 'pass' };
    }

    return {
        label: 'canon discovery nudge',
        status: 'warn',
        detail: `add this to CLAUDE.md:\n${RECOMMENDED_NUDGE}`,
    };
}

export function checkCodexMdDeprecated(cwd: string): Check | null {
    if (!existsSync(join(cwd, 'CODEX.md'))) return null;
    return {
        label: 'CODEX.md',
        status: 'warn',
        detail: 'deprecated — no tool reads this file; it is safe to delete',
    };
}

export function checkTemplates(cwd: string): Check {
    const dir = join(cwd, '.canon', 'templates');
    if (!existsSync(dir)) {
        return { label: '.canon/templates/', status: 'fail', detail: 'missing — run `canon init`' };
    }
    const missing = EXPECTED_TEMPLATES.filter(f => !existsSync(join(dir, f)));
    if (missing.length > 0) {
        return {
            label: '.canon/templates/',
            status: 'warn',
            detail: `missing: ${missing.join(', ')}`,
        };
    }
    return { label: '.canon/templates/', status: 'pass' };
}

export function checkCanonVersion(cwd: string): Check {
    const versionPath = join(cwd, '.canon', 'version');
    const installedVersion = process.env['CANON_VERSION'] ?? 'dev';

    if (!existsSync(versionPath)) {
        return { label: '.canon/version', status: 'warn', detail: 'missing — run `canon upgrade`' };
    }
    const vendoredVersion = readFileSync(versionPath, 'utf8').trim();
    if (vendoredVersion !== installedVersion) {
        return {
            label: '.canon/version',
            status: 'warn',
            detail: `vendored ${vendoredVersion} ≠ installed ${installedVersion} — run \`canon upgrade\``,
        };
    }
    return { label: `.canon/version (${vendoredVersion})`, status: 'pass' };
}

export function checkSkills(cwd: string): Check {
    const initSkill = join(cwd, '.claude', 'skills', 'canon-init', 'SKILL.md');
    if (!existsSync(initSkill)) {
        return {
            label: '.claude/skills/',
            status: 'warn',
            detail: 'canon-init skill missing — run `canon init` or `canon upgrade`',
        };
    }
    const skillNames = ['canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog', 'canon-spec-review', 'canon-inline-review'];
    const missing = skillNames.filter(s => !existsSync(join(cwd, '.claude', 'skills', s, 'SKILL.md')));
    if (missing.length > 0) {
        return {
            label: '.claude/skills/',
            status: 'warn',
            detail: `operational skills missing: ${missing.join(', ')} — run \`canon upgrade\``,
        };
    }
    return { label: '.claude/skills/', status: 'pass' };
}

export function checkQualityLog(cwd: string): Check {
    const label = 'docs/task-quality-log.md';
    const logPath = getQualityLogFile(cwd);

    let content: string;
    try {
        content = readFileSync(logPath, 'utf8');
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
            if (!existsSync(dirname(logPath))) {
                return {
                    label,
                    status: 'warn',
                    detail: `parent directory of ${logPath} does not exist — the writer's self-heal write would also fail; create the directory (or run \`canon init\`)`,
                };
            }
            return {
                label,
                status: 'pass',
                detail: 'not present — writer creates it fresh on first qa → done transition',
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { label, status: 'warn', detail: `could not read ${logPath}: ${message}` };
    }

    if (locateLogTable(content.split('\n')) !== null) {
        return { label, status: 'pass' };
    }

    const relativePath = relative(cwd, logPath) || logPath;
    return {
        label,
        status: 'warn',
        detail: `${relativePath} has no well-formed '## Log' table with all required columns — compare with templates/docs/task-quality-log.md`,
    };
}

/**
 * Parses the global `~/.codex/config.toml` and returns a map of project paths
 * to their declared trust level. Codex creates `[projects."<absolute-path>"]`
 * blocks the first time a user opens that workspace interactively and clicks
 * "trust"; canon spawns `codex exec` from worktree paths, so if a workspace
 * has never been opened manually, codex fails hard with no actionable output.
 *
 * Format we parse (loose — no full TOML parser dep):
 *
 *   [projects."/Users/x/repo"]
 *   trust_level = "trusted"
 *
 * Other keys inside the project block are ignored.
 */
export function parseCodexProjectTrust(tomlContent: string): Map<string, string> {
    const result = new Map<string, string>();
    const lines = tomlContent.split('\n');
    let currentProject: string | null = null;
    for (const line of lines) {
        const trimmed = line.trim();
        // TOML also allows trailing `# comment` after the closing `]`.
        const header = trimmed.match(/^\[projects\."(.+)"\]\s*(?:#.*)?$/);
        if (header) {
            currentProject = header[1];
            continue;
        }
        if (trimmed.startsWith('[')) {
            currentProject = null;
            continue;
        }
        if (currentProject) {
            // TOML allows both `"..."` and `'...'` for string values, plus an
            // inline `# comment` after the value. Accept either quote style;
            // pick whichever capture group fired.
            const trust = trimmed.match(/^trust_level\s*=\s*(?:"([^"]+)"|'([^']+)')\s*(?:#.*)?$/);
            if (trust) {
                result.set(currentProject, trust[1] ?? trust[2]);
            }
        }
    }
    return result;
}

function safeRealpathOrSelf(target: string): string {
    try { return realpathSync(target); } catch { return target; }
}

export function checkCodexProjectTrust(cwd: string): Check {
    const label = 'codex project trust';
    const configPath = join(homedir(), '.codex', 'config.toml');
    if (!existsSync(configPath)) {
        return {
            label,
            status: 'warn',
            detail: `${configPath} not found — run \`codex\` once interactively to initialize, or add a [projects."<path>"] entry manually before \`canon run\``,
        };
    }

    let trustMap: Map<string, string>;
    try {
        const content = readFileSync(configPath, 'utf8');
        trustMap = parseCodexProjectTrust(content);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { label, status: 'warn', detail: `failed to read ${configPath}: ${message}` };
    }

    // Identify the workspace root that codex would key on. Prefer the git
    // toplevel (which canon's worktree paths all live under); fall back to
    // cwd if git isn't initialized.
    let workspaceRoot = cwd;
    try {
        const out = execSync('git rev-parse --show-toplevel', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (out) workspaceRoot = out;
    } catch { /* not in a git repo — fall through */ }
    const canonicalWorkspace = safeRealpathOrSelf(workspaceRoot);

    // Direct match wins absolutely — an explicit entry for this workspace
    // overrides any parent's trust (otherwise an `untrusted` child under a
    // trusted parent would be silently reported as trusted).
    for (const [project, level] of trustMap) {
        const canonicalProject = safeRealpathOrSelf(project);
        if (canonicalProject === canonicalWorkspace) {
            if (level === 'trusted') {
                return { label, status: 'pass', detail: `${workspaceRoot} is trusted` };
            }
            return {
                label,
                status: 'warn',
                detail:
                    `${workspaceRoot} has an explicit trust_level = "${level}" in ${configPath}. ` +
                    `Change it to "trusted" or remove the block:\n` +
                    `        [projects."${workspaceRoot}"]\n` +
                    `        trust_level = "trusted"`,
            };
        }
    }

    // No exact entry — fall back to parent inheritance. Codex's trust UI treats
    // child paths as inheriting from a trusted parent; mirror that here so we
    // don't false-warn when (e.g.) `/Users/x` is trusted and the workspace is
    // `/Users/x/myrepo` with no entry of its own.
    //
    // Nearest-ancestor wins: a closer untrusted entry overrides a more distant
    // trusted one (e.g. `/Users/x` trusted + `/Users/x/repo` untrusted, with
    // workspace `/Users/x/repo/sub` → treat as untrusted). Otherwise file
    // ordering in the TOML would determine the result.
    type Ancestor = { project: string; level: string; depth: number };
    const ancestors: Ancestor[] = [];
    for (const [project, level] of trustMap) {
        const canonicalProject = safeRealpathOrSelf(project);
        // `path.sep` rather than literal `/` so Windows (and any non-POSIX
        // platform) matches `C:\Users\me\repo` against trusted parent
        // `C:\Users\me` correctly. `realpath` returns native separators, so
        // both operands here are already in the platform's form.
        //
        // Root special case: when the trusted project IS the separator
        // (`/` on POSIX or `C:\` on Windows), the project string already
        // ends with the separator. Appending another would produce `//` /
        // `C:\\`, which `startsWith` would never match against a real
        // workspace path. Compare without the separator append in that case.
        const prefix = canonicalProject.endsWith(pathSep)
            ? canonicalProject
            : `${canonicalProject}${pathSep}`;
        if (canonicalWorkspace.startsWith(prefix)) {
            ancestors.push({ project, level, depth: canonicalProject.length });
        }
    }
    if (ancestors.length > 0) {
        ancestors.sort((a, b) => b.depth - a.depth);
        const nearest = ancestors[0];
        if (nearest.level === 'trusted') {
            return {
                label,
                status: 'pass',
                detail: `inherited from trusted parent ${nearest.project}`,
            };
        }
        return {
            label,
            status: 'warn',
            detail:
                `nearest ancestor ${nearest.project} has trust_level = "${nearest.level}" — codex exec will fail. ` +
                `Add an explicit trusted entry for this workspace:\n` +
                `        [projects."${workspaceRoot}"]\n` +
                `        trust_level = "trusted"`,
        };
    }

    return {
        label,
        status: 'warn',
        detail:
            `${workspaceRoot} is not in ${configPath} — codex exec will fail hard on first invocation. ` +
            `Add this block to fix:\n` +
            `        [projects."${workspaceRoot}"]\n` +
            `        trust_level = "trusted"`,
    };
}

function readAllowFromSettings(path: string): { allow: Set<string>; status: 'ok' | 'missing' | 'invalid' } {
    if (!existsSync(path)) return { allow: new Set(), status: 'missing' };
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { permissions?: { allow?: unknown } } | null;
        const raw = parsed?.permissions?.allow;
        const allow = new Set<string>(
            Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [],
        );
        return { allow, status: 'ok' };
    } catch {
        return { allow: new Set(), status: 'invalid' };
    }
}

export function checkRecommendedPermissions(cwd: string): Check {
    const label = '.claude/settings.json';
    const committed = readAllowFromSettings(join(cwd, '.claude', 'settings.json'));
    const local = readAllowFromSettings(join(cwd, '.claude', 'settings.local.json'));

    if (committed.status === 'invalid') {
        return { label, status: 'warn', detail: 'present but not valid JSON — review manually' };
    }
    if (local.status === 'invalid') {
        return {
            label: '.claude/settings.local.json',
            status: 'warn',
            detail: 'present but not valid JSON — review manually',
        };
    }
    if (committed.status === 'missing' && local.status === 'missing') {
        return {
            label,
            status: 'warn',
            detail: 'not present — see README "Skip the permission prompts" for the recommended allowlist, or rerun `/canon-init`',
        };
    }

    const allow = new Set<string>([...committed.allow, ...local.allow]);
    const missing = RECOMMENDED_ALLOW.filter(p => !allow.has(p));
    if (missing.length === 0) {
        return { label, status: 'pass', detail: 'recommended canon perms present' };
    }
    if (missing.length === RECOMMENDED_ALLOW.length) {
        return {
            label,
            status: 'warn',
            detail: 'no recommended canon perms allowlisted — see README "Skip the permission prompts"',
        };
    }
    const preview = missing.slice(0, 3).join(', ');
    const more = missing.length > 3 ? ` (+${missing.length - 3} more)` : '';
    return {
        label,
        status: 'warn',
        detail: `missing ${missing.length} recommended perm(s): ${preview}${more} — see README`,
    };
}

export function checkLocalSettingsGitignored(cwd: string): Check {
    const settingsPath = join(cwd, '.claude', 'settings.local.json');
    const gitignorePath = join(cwd, '.gitignore');

    if (!existsSync(settingsPath)) return { label: '.claude/settings.local.json', status: 'pass', detail: 'not present' };

    if (!existsSync(gitignorePath)) {
        return {
            label: '.claude/settings.local.json',
            status: 'warn',
            detail: 'present but no .gitignore found — add it to .gitignore to avoid leaking local settings',
        };
    }
    const gitignore = readFileSync(gitignorePath, 'utf8');
    const isIgnored = gitignore.split('\n').some(line => {
        const trimmed = line.trim();
        return trimmed === '.claude/settings.local.json' ||
               trimmed === 'settings.local.json' ||
               trimmed === '.claude/';
    });
    if (isIgnored) return { label: '.claude/settings.local.json', status: 'pass', detail: 'gitignored' };
    return {
        label: '.claude/settings.local.json',
        status: 'warn',
        detail: 'present but not in .gitignore — add `.claude/settings.local.json` to avoid leaking local settings',
    };
}

export function checkRuntimeFilesGitignored(cwd: string): Check {
    const label = 'runtime files .gitignored';
    const gitignorePath = join(cwd, '.gitignore');

    if (!existsSync(gitignorePath)) {
        return {
            label,
            status: 'warn',
            detail: 'no .gitignore found — run `canon upgrade` to add the canon runtime block',
        };
    }

    const lines = readFileSync(gitignorePath, 'utf8').split('\n').map(line => line.trim());
    const missing = CANON_RUNTIME_GITIGNORE_PATTERNS.filter(pattern => !lines.includes(pattern));
    if (missing.length === 0) {
        return { label, status: 'pass', detail: 'all runtime patterns present' };
    }
    return {
        label,
        status: 'warn',
        detail: `missing runtime pattern(s): ${missing.join(', ')} — run \`canon upgrade\` to add them`,
    };
}

// --- active-orchestrator detection ---

/**
 * Format a millisecond age as a short human-readable string ("47s", "12m 3s",
 * "2h 14m"). Used to give doctor's stale-orchestrator warnings concrete
 * duration context without pulling in a date-formatting dep.
 */
export function formatAge(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remSec = seconds % 60;
    if (minutes < 60) return remSec > 0 ? `${minutes}m ${remSec}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

/**
 * Inspect every non-archived task and report orchestrator liveness for those
 * whose status.json says `in_progress`. Returns `Check`s in this shape:
 *   - status `pass`: heartbeat is fresh (< 60s old)
 *   - status `warn`: status says in_progress but heartbeat is stale or missing
 *     → the orchestrator was likely killed; operator should `canon run <id>`
 *
 * Returns an empty array when no task is in_progress — doctor then omits the
 * section. Errors on a single task are absorbed (skip the row); only the
 * tasks we can read are reported.
 */
export function checkActiveOrchestrators(cwd: string, now: number = Date.now()): Check[] {
    const tasksDir = join(cwd, 'tasks');
    if (!existsSync(tasksDir)) return [];
    const checks: Check[] = [];
    let entries: string[];
    try {
        entries = readdirSync(tasksDir).sort();
    } catch {
        return [];
    }
    for (const id of entries) {
        if (id === '_archive') continue;
        const ctx = gatherRunContext(id);
        const status: StatusJson | null = ctx.statusResult.kind === 'ok' && isStatusJson(ctx.statusResult.status)
            ? ctx.statusResult.status
            : null;
        if (status == null) continue;
        // Top-level `status.status` is the *current phase name* (e.g.,
        // "implement", "code_review", "complete") — NOT a phase-status value.
        // The signal that an orchestrator should be running is whether any
        // phase entry has `status: "in_progress"`. The phase handlers flip
        // their own status to in_progress at start and to done/blocked/
        // changes_requested at end; a stuck in_progress phase is exactly the
        // post-kill state we want to detect. See PHASE_STATUS_VALUES in
        // scripts/run-task/types.ts for the set; "phase X started in_progress"
        // is set in scripts/run-task/phases/<phase>.ts at phase entry.
        const phases = status.phases ?? {};
        const hasInProgressPhase = Object.values(phases).some(
            (entry) => entry?.status === 'in_progress',
        );
        if (!hasInProgressPhase) continue;

        const record = ctx.heartbeatResult.kind === 'found' ? ctx.heartbeatResult.record : null;
        const label = `orchestrator ${id}`;
        if (isHeartbeatStale(record, now)) {
            const detail = record === null
                ? `status.json shows in_progress but no .heartbeat.json — orchestrator was killed or never wrote one. Run \`canon run ${id}\` to resume.`
                : `status.json shows in_progress but last heartbeat was ${formatAge(now - record.last_update_ms)} ago (>${HEARTBEAT_STALE_AFTER_MS / 1000}s) — orchestrator likely killed. Run \`canon run ${id}\` to resume.`;
            checks.push({ label, status: 'warn', detail });
        } else if (record) {
            checks.push({
                label,
                status: 'pass',
                detail: `alive (pid ${record.pid}, heartbeat ${formatAge(now - record.last_update_ms)} ago)`,
            });
        }
    }
    return checks;
}

// --- runner ---

function printSection(title: string): void {
    console.log(`\n${title}`);
    console.log('─'.repeat(title.length));
}

function printCheck(c: Check): void {
    const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗';
    const line = `  ${icon} ${c.label}`;
    console.log(c.detail ? `${line} — ${c.detail}` : line);
}

export function doctorCmd(_args: string[]): void {
    const cwd = process.cwd();

    const envChecks: Check[] = [
        checkPlatform(),
        checkNodeVersion(),
        checkBinary('git', true, 'https://git-scm.com/downloads'),
        checkBinary('claude', true, 'npm install -g @anthropic-ai/claude-code'),
        ...(isAvailable('claude') ? [checkClaudeVersion()] : []),
        checkBinary('codex', true, 'npm install -g @openai/codex'),
        checkBinary('gh', false, 'brew install gh && gh auth login  (required for --pr / --push)'),
    ];

    const codexDeprecated = checkCodexMdDeprecated(cwd);
    const canonChecks: Check[] = [
        checkCanonDiscoveryNudge(cwd),
        ...(codexDeprecated ? [codexDeprecated] : []),
        checkTemplates(cwd),
        checkCanonVersion(cwd),
        checkSkills(cwd),
        checkQualityLog(cwd),
    ];

    const configChecks: Check[] = [
        checkCodexProjectTrust(cwd),
        checkRecommendedPermissions(cwd),
        checkLocalSettingsGitignored(cwd),
        checkRuntimeFilesGitignored(cwd),
    ];

    // Active-orchestrator section is conditional — only shows when at least
    // one task is in_progress. Surfaces "task claims in_progress but no live
    // heartbeat" within ~60s of an orchestrator death (harness pgroup kill,
    // OOM, SIGKILL) so the operator can re-resume rather than wait hours
    // before noticing. See docs/BACKLOG.md "Orchestrator dies silently in
    // background mode" for the full failure-mode story.
    const orchestratorChecks = checkActiveOrchestrators(cwd);

    console.log('\ncanon doctor\n');

    printSection('Environment');
    for (const c of envChecks) printCheck(c);

    printSection('Canon setup');
    for (const c of canonChecks) printCheck(c);

    printSection('Config');
    for (const c of configChecks) printCheck(c);

    if (orchestratorChecks.length > 0) {
        printSection('Active orchestrators');
        for (const c of orchestratorChecks) printCheck(c);
    }

    const all = [...envChecks, ...canonChecks, ...configChecks, ...orchestratorChecks];
    const failures = all.filter(c => c.status === 'fail');
    const warnings = all.filter(c => c.status === 'warn');

    console.log('');
    if (failures.length > 0) {
        console.log(`${failures.length} failure(s) — fix the above before running tasks.\n`);
        process.exit(1);
    }
    if (warnings.length > 0) {
        console.log(`${warnings.length} warning(s) — canon should work; review above.\n`);
        return;
    }
    console.log('All checks passed.\n');
}
