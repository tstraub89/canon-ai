import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
    detectTier as policyDetectTier,
    getPipelinePolicy,
    isPlanCombined as policyIsPlanCombined,
    type ClaudeModelConfig,
    type ClaudePhase,
    type CodexModelConfig,
    type CodexPhase,
    type PipelineTier,
    type PolicyConfig,
    type PolicyInput,
    type TaskSize,
} from './pipeline-policy.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(REPO_ROOT, 'tasks');
const TASK_SH = path.join(REPO_ROOT, 'scripts/task.sh');

// Worktree root location. Default is a sibling directory `../dev-worktrees`
// (keeps task worktrees out of the main repo's working tree). Override via
// CANON_WORKTREES_ROOT env var — useful when the sibling layout doesn't fit
// (e.g., monorepos, nested checkouts, projects that prefer in-tree worktrees).
// If you change this, also update `additionalDirectories` in
// `.claude/settings.json` to match — Claude Code's permission boundary needs
// the same path the orchestrator writes to.
const WORKTREES_ROOT = process.env.CANON_WORKTREES_ROOT
    ? path.resolve(process.env.CANON_WORKTREES_ROOT)
    : path.resolve(REPO_ROOT, '../dev-worktrees');

// ── Constants ──────────────────────────────────────────────────────────────

const PHASE_ORDER = ['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review'] as const;
const PHASE_STATUS_VALUES = ['pending', 'in_progress', 'done', 'changes_requested', 'blocked'] as const;
const VERDICT_VALUES = ['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review'] as const;

type Phase = (typeof PHASE_ORDER)[number];
type PhaseStatus = (typeof PHASE_STATUS_VALUES)[number];
type Verdict = (typeof VERDICT_VALUES)[number] | '';
type CurrentPhase = Phase | 'complete';

// ── Types ──────────────────────────────────────────────────────────────────

type PhaseEntry = {
    status: PhaseStatus;
    agent: string;
    verdict?: Verdict;
    iterations?: number;
    /**
     * Set to true by `--reroute` on `phases.implement`. Signals that the spec has been
     * amended after human_review and Codex should re-read spec.md (not assume prior work
     * is complete). Cleared automatically after a reroute implement pass runs.
     */
    rerouted?: boolean;
    /**
     * Accumulated count of how many times `--reroute` has been invoked for this task's
     * implement phase. Incremented on every reroute; never reset. Used to inject a
     * round-number marker into the reroute prompt so session-resumed Codex can distinguish
     * a new reroute from a duplicate delivery of a prior one. (The static reroute prompt
     * text is otherwise identical across rounds, which triggers a "I already did this"
     * failure mode in resumed sessions.)
     */
    reroute_count?: number;
};

type Escalation = {
    date: string;
    phase: Phase;
    iteration_count?: number;
    reason: string;
};

type StatusJson = {
    id: string;
    title?: string;
    status?: string;
    created?: string;
    updated?: string;
    branch?: string;
    /**
     * Base branch the task branches off and PRs against. Auto-set by
     * `task.sh new` from the current git checkout at task creation. Defaults
     * to `'main'` when absent. Set to `'release/v<X.Y>'` to participate in a
     * multi-task release branch flow.
     */
    base_branch?: string;
    task_size?: TaskSize;
    delicate?: boolean;
    human_spec_gate?: boolean;
    worktree?: boolean;
    phases: Partial<Record<Phase, PhaseEntry>>;
    escalations?: Escalation[];
    sessions?: {
        /** Spec writes and revisions — both run in REPO_ROOT, session continuity helps across rounds. */
        claude_spec?: string | null;
        /** code_review rounds — round 1 is always fresh; round 2+ resumes same session (same worktree cwd). */
        claude_review?: string | null;
        /** @deprecated use claude_spec or claude_review */
        claude?: string | null;
        codex?: string | null;
    };
};

type CliArgs = {
    taskIds: string[];
    interactive: boolean;
    step: boolean;
    expectPhase: string | null;
    push: boolean;
    pr: boolean;
    reroute: boolean;
    ship: boolean;
};

type TaskContext = {
    taskId: string;
    title: string;
    specReviewVerdict: Verdict;
    iterations: number;
    rerouteCount: number;
    status: StatusJson;
};

type PipelineState = {
    tasks: TaskContext[];
    tier: PipelineTier;
    isBundle: boolean;
};

type CommandResult = {
    ok: boolean;
    stdout: string;
    stderr: string;
};

// ── Workflow metrics ───────────────────────────────────────────────────────

const METRICS_FILE = path.join(REPO_ROOT, 'docs/pipeline-invocations.md');

// Stall detection: if no stdout/stderr data arrives within this window, the
// child is assumed hung and gets killed. Override with PIPELINE_STALL_TIMEOUT_MS.
// Default 10 minutes — agent reasoning bursts (Sonnet on a hard plan, Opus on
// a delicate refactor) can sit silent for several minutes between tool calls,
// so the threshold needs to clear normal think-time. Symphony's daemon uses
// 5 min for stuck Codex sessions; we run longer agent calls and prefer to
// over-wait rather than nuke a working session.
const STALL_TIMEOUT_MS = Number(process.env.PIPELINE_STALL_TIMEOUT_MS) || 10 * 60 * 1000;
const STALL_KILL_GRACE_MS = 3000; // SIGTERM, then SIGKILL if still alive after this

// Files maintained by the pipeline itself (script-authored telemetry or
// high-level QA logs appended by sub-Claude). Auto-commit treats these as
// artifacts rather than source changes: they're excluded from the
// "dirty files not covered by handoff.md" check, and bundled into the
// task-artifacts commit so they don't leave the working tree dirty
// between phases.
export const PIPELINE_TELEMETRY_FILES = [
    'docs/pipeline-invocations.md',  // scripts/run-task.ts appends one row per agent invocation (duration, tokens)
    'docs/task-quality-log.md',      // QA sub-Claude appends one row per task (spec verdicts, review iterations, etc.)
    'docs/lessons-learned.md',       // QA sub-Claude appends one entry per task when a reusable insight surfaced
] as const;

// Stdout captured from the most recent runClaude() non-interactive call.
// Used by the QA phase to salvage done.md when the sub-agent streams its
// content to stdout instead of using the Write tool (Haiku regression seen
// 2026-04-18). Cleared at the start of each runClaude call.
let lastClaudeStdout = '';

// Captured from Claude's `--output-format stream-json` final `result` event
// (`session_id` field). More reliable than scanning ~/.claude/projects/<cwd>/
// for the most-recently-modified .jsonl — that approach falsely captured the
// user's own active conversation in worktree mode, since the worktree's
// session dir is a different encoded path. Cleared at the start of each
// runClaude call.
let lastClaudeSessionId: string | null = null;

type MetricEntry = {
    taskId: string;
    phase: string;
    agent: 'claude' | 'codex';
    model: string;
    iteration?: number;
    durationMs: number;
    status: 'ok' | 'failed';
    tokens?: number;
};

function recordMetric(entry: MetricEntry): void {
    if (!fs.existsSync(METRICS_FILE)) {
        fs.writeFileSync(METRICS_FILE, [
            '# Workflow Metrics',
            '',
            '> Auto-logged by `scripts/run-task.ts`. One row per agent invocation.',
            '> Tokens: per-invocation total (input + cache + output). Parsed from the agent\'s structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.',
            '',
            '| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |',
            '|---|---|---|---|---|---|---|---|---|',
            '',
        ].join('\n'));
    }
    const dur = (entry.durationMs / 1000).toFixed(1) + 's';
    const tok = entry.tokens != null ? String(entry.tokens) : '-';
    fs.appendFileSync(METRICS_FILE,
        `| ${new Date().toISOString()} | ${entry.taskId} | ${entry.phase} | ${entry.agent} | ${entry.model} | ${entry.iteration ?? '-'} | ${dur} | ${tok} | ${entry.status} |\n`
    );
}

// ── Config ─────────────────────────────────────────────────────────────────

// Legacy env vars from the pre-matrix config. Model vars keep working as
// fallbacks through one transition. Effort vars are no longer representable
// (effort is matrix-driven by size), so they're warned-and-ignored.
// Remove both buckets after the next release.
const LEGACY_FALLBACK_ENV_VARS: Array<{ old: string; replacement: string }> = [
    { old: 'CLAUDE_MODEL', replacement: 'CLAUDE_MODEL_SPEC / _PLAN / _REVIEW (still honored as fallback for those three; not applied to qa)' },
    { old: 'CODEX_MODEL_DEFAULT', replacement: 'CODEX_MODEL_MINI (still honored as fallback)' },
    { old: 'CODEX_MODEL_DELICATE', replacement: 'CODEX_MODEL_FULL (still honored as fallback)' },
];
const LEGACY_IGNORED_ENV_VARS: Array<{ old: string; reason: string }> = [
    { old: 'CODEX_EFFORT_DEFAULT', reason: 'effort is now matrix-driven by task size in getCodexConfig() — no equivalent knob' },
    { old: 'CODEX_EFFORT_DELICATE', reason: 'effort is now matrix-driven by task size in getCodexConfig() — no equivalent knob' },
];

// Fires only when a real pipeline run is happening (called from main()), not
// during --help or arg-parsing failures. Keeps noise low on misuse paths.
function warnLegacyEnvVars(): void {
    for (const { old, replacement } of LEGACY_FALLBACK_ENV_VARS) {
        if (process.env[old]) {
            console.error(`⚠️  ${old} is deprecated — use ${replacement}. Current run still honors it.`);
        }
    }
    for (const { old, reason } of LEGACY_IGNORED_ENV_VARS) {
        if (process.env[old]) {
            console.error(`⚠️  ${old} is no longer honored — ${reason}. Update the matrix in scripts/run-task.ts if you need different effort.`);
        }
    }
}

// When CANON_WORKTREES_ROOT is set, the orchestrator writes worktrees to a
// non-default path. Claude Code's permission boundary (`additionalDirectories`
// in `.claude/settings.json` or `settings.local.json`) must include that path
// for the architect agent to read/write files inside the worktree. This is a
// classic dual-edit footgun — set the env var, forget the settings.json
// update, watch Claude Code silently fail to access the worktree.
//
// Fires a warning (not a hard fail) at startup when the env var is set but
// no settings file declares a matching `additionalDirectories` entry.
function warnWorktreesRootMismatch(): void {
    if (!process.env.CANON_WORKTREES_ROOT) return;
    const candidates = [
        path.join(REPO_ROOT, '.claude/settings.json'),
        path.join(REPO_ROOT, '.claude/settings.local.json'),
    ];
    const declaredDirs: string[] = [];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
                permissions?: { additionalDirectories?: string[] };
            };
            const dirs = parsed.permissions?.additionalDirectories ?? [];
            for (const dir of dirs) {
                declaredDirs.push(path.resolve(REPO_ROOT, dir));
            }
        } catch { /* malformed JSON; let Claude Code surface that error elsewhere */ }
    }
    if (declaredDirs.length === 0) return; // No settings file at all — nothing to mismatch with.
    const matches = declaredDirs.some(dir => dir === WORKTREES_ROOT);
    if (matches) return;
    console.error(
        `⚠️  CANON_WORKTREES_ROOT is set to ${WORKTREES_ROOT}, but no \`additionalDirectories\` entry in ` +
        `.claude/settings.json or .claude/settings.local.json matches that path. ` +
        `Claude Code will not be able to read/write inside the worktree. ` +
        `Add ${WORKTREES_ROOT} to additionalDirectories in one of those files (settings.local.json is the right place for per-machine overrides).`
    );
}

// Project name appears in agent prompts. Resolution order:
//   1. CANON_PROJECT_NAME env var (explicit override)
//   2. package.json "name" field (Node projects)
//   3. Fallback: "your project"
function resolveProjectName(): string {
    if (process.env.CANON_PROJECT_NAME) return process.env.CANON_PROJECT_NAME;
    try {
        const pkgPath = path.join(REPO_ROOT, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
            if (pkg.name) return pkg.name;
        }
    } catch { /* ignore — fall through */ }
    return 'your project';
}

const config = {
    projectName: resolveProjectName(),
    claudeBudget: process.env.CLAUDE_BUDGET ?? '5.00',
    // Claude is tuned for correctness over token cost. Opus on the phases where
    // false negatives cascade (spec, code review); Sonnet on the phases where
    // structured translation (plan) or templated writing (qa) is the work.
    // Sonnet QA is a deliberate upgrade from haiku — haiku streamed done.md
    // content instead of using the Write tool (regression, 2026-04-18).
    //
    // CLAUDE_MODEL (legacy, single var for all non-qa phases) is honored as a
    // fallback when the phase-specific var isn't set — keeps existing shell
    // overrides working through one transition. Drop after next release.
    claudeModelSpec: process.env.CLAUDE_MODEL_SPEC ?? process.env.CLAUDE_MODEL ?? 'opus',
    claudeModelPlan: process.env.CLAUDE_MODEL_PLAN ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeModelReview: process.env.CLAUDE_MODEL_REVIEW ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeModelQa: process.env.CLAUDE_MODEL_QA ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    // Codex is tuned for token efficiency — mini handles most phases; the full
    // model only comes out for XL or delicate work. Effort is matrix-driven in
    // getCodexConfig() below. Legacy CODEX_MODEL_DEFAULT / _DELICATE are
    // honored as fallbacks for one transition.
    codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? 'gpt-5.4-mini',
    codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? 'gpt-5.5',
    // When unset, MAX_REVIEW_LOOPS is size-aware (see getMaxReviewLoops). Env
    // var override applies uniformly across sizes — use for one-off debugging.
    maxReviewLoops: process.env.MAX_REVIEW_LOOPS ? Number.parseInt(process.env.MAX_REVIEW_LOOPS, 10) : null,
    // Affected-file context injection: skip if total file size exceeds this
    maxContextBytes: Number.parseInt(process.env.MAX_CONTEXT_BYTES ?? String(64 * 1024), 10),
};

// ── Pipeline tier helpers ──────────────────────────────────────────────────
//
// Thin wrappers over scripts/pipeline-policy.ts. Policy logic is pure and
// table-tested in tests/pipeline-policy.test.ts; this layer only bridges
// TaskContext/StatusJson shapes to the policy's PolicyInput.

// Resolves the run-task config struct into the shape pipeline-policy expects.
// Computed lazily so tests that stub `config` still work.
function policyConfig(): PolicyConfig {
    return {
        claudeModelSpec: config.claudeModelSpec,
        claudeModelPlan: config.claudeModelPlan,
        claudeModelReview: config.claudeModelReview,
        claudeModelQa: config.claudeModelQa,
        codexModelMini: config.codexModelMini,
        codexModelFull: config.codexModelFull,
        maxReviewLoops: config.maxReviewLoops,
    };
}

function toPolicyInputs(tasks: readonly TaskContext[]): PolicyInput[] {
    return tasks.map(t => ({ task_size: t.status.task_size, delicate: t.status.delicate }));
}

function getClaudeConfig(phase: ClaudePhase, tasks: readonly TaskContext[]): ClaudeModelConfig {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).claude(phase);
}

function getCodexConfig(phase: CodexPhase, tasks: readonly TaskContext[]): CodexModelConfig {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).codex(phase);
}

function getNominalSize(tasks: readonly TaskContext[]): TaskSize {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).nominalSize;
}

function getEffectiveSize(tasks: readonly TaskContext[]): TaskSize {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).effectiveSize;
}

function getMaxReviewLoops(tasks: readonly TaskContext[]): number {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).maxReviewLoops;
}

function detectTier(statuses: readonly StatusJson[]): PipelineTier {
    return policyDetectTier(statuses.map(s => ({ task_size: s.task_size, delicate: s.delicate })));
}

function isPlanCombined(status: StatusJson): boolean {
    return policyIsPlanCombined({ task_size: status.task_size, delicate: status.delicate });
}

// ── Module state ───────────────────────────────────────────────────────────

let cliArgs: CliArgs = {
    taskIds: [],
    interactive: false,
    step: false,
    expectPhase: null,
    push: false,
    pr: false,
    reroute: false,
    ship: false,
};
let ghAvailable = false;
// Codex session ID captured from startup banner for session resumption
let lastCodexSessionId: string | null = null;
// Non-zero Codex exit (e.g. MCP warnings) doesn't necessarily mean failure.
// checkAndRoute validates by reading status.json instead of trusting exit code alone.
let lastCodexExitStatus = 0;

// ── Output helpers ─────────────────────────────────────────────────────────

function die(message: string): never {
    console.error(`❌ ${message}`);
    process.exit(1);
}

function info(message: string): void {
    console.log(`→ ${message}`);
}

function warn(message: string): void {
    console.error(`⚠️  ${message}`);
}

// ── Arg parsing ────────────────────────────────────────────────────────────

function printUsage(): void {
    console.log('Usage: npx tsx scripts/run-task.ts <TASK-ID...> [options]');
    console.log('');
    console.log('  Single task:  npx tsx scripts/run-task.ts fix-hover-state');
    console.log('  Bundle:       npx tsx scripts/run-task.ts fix-hover-state dark-tokens empty-cta');
    console.log('');
    console.log('  Bundle mode runs all tasks together per phase (one agent session each).');
    console.log('  Fast tier (S, non-delicate only) skips Codex spec review. Full tier (any M/L/XL');
    console.log('  or delicate task) runs the complete pipeline — any such task pulls the entire');
    console.log('  bundle to full tier.');
    console.log('');
    console.log('Options:');
    console.log('  --interactive, -I   Open interactive agent sessions');
    console.log('  --step, -1          Run one phase then stop');
    console.log('  --expect <phase>    Assert current phase before running');
    console.log('  --push              Push branch at human_review');
    console.log('  --pr                Push + create draft PR at human_review');
    console.log('  --reroute           Reset from human_review back to implement AND re-invoke the pipeline');
    console.log('  --ship              Merge open PR, pull, archive task, commit+push, clean branches');
}

function parseArgs(argv: string[]): CliArgs {
    if (argv.length === 0) {
        printUsage();
        process.exit(1);
    }
    if (argv[0] === '--help') {
        printUsage();
        process.exit(0);
    }

    const taskIds: string[] = [];
    let interactive = false;
    let step = false;
    let expectPhase: string | null = null;
    let push = false;
    let pr = false;
    let reroute = false;
    let ship = false;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--interactive':
            case '-I':
                interactive = true;
                break;
            case '--step':
            case '-1':
                step = true;
                break;
            case '--expect':
                index += 1;
                if (index >= argv.length) die('--expect requires a phase argument');
                expectPhase = argv[index];
                break;
            case '--push':
                push = true;
                break;
            case '--pr':
                pr = true;
                break;
            case '--reroute':
                reroute = true;
                break;
            case '--ship':
                ship = true;
                break;
            default:
                if (arg.startsWith('--')) die(`Unknown option: ${arg}`);
                taskIds.push(arg);
        }
    }

    if (taskIds.length === 0) die('At least one TASK-ID is required.');
    return { taskIds, interactive, step, expectPhase, push, pr, reroute, ship };
}

function validateTaskId(id: string): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
        die(`Invalid task ID '${id}'. Must be lowercase alphanumeric, hyphens, dots, or underscores.`);
    }
    if (id.includes('..')) {
        die(`Invalid task ID '${id}'. Must not contain '..'.`);
    }
}

// ── File system ────────────────────────────────────────────────────────────

function taskDirFor(taskId: string): string {
    return path.join(TASKS_DIR, taskId);
}

/** When a worktree is active for this task, its status.json is canonical.
 * REPO_ROOT's copy is the last-committed snapshot and must not be written to. */
function resolveTaskCwd(taskId: string): string {
    const wtStatus = path.join(worktreePath(taskId), 'tasks', taskId, 'status.json');
    return fs.existsSync(wtStatus) ? worktreePath(taskId) : REPO_ROOT;
}

function statusFileFor(taskId: string): string {
    return path.join(resolveTaskCwd(taskId), 'tasks', taskId, 'status.json');
}

function readStatus(taskId: string): StatusJson {
    return JSON.parse(fs.readFileSync(statusFileFor(taskId), 'utf8')) as StatusJson;
}

// `phases.X.status` is the authoritative lifecycle. The top-level `.status`
// field is a derived convenience pointer — the first phase (in canonical
// order) that isn't "done", or "complete" if every phase is done. Computing
// it on write means no caller has to remember to bump both fields in sync
// (the historical drift source), and reroute/ship don't need to touch the
// top level at all.
function deriveTopLevelStatus(status: StatusJson): CurrentPhase {
    for (const phase of PHASE_ORDER) {
        const phaseStatus = status.phases[phase]?.status ?? 'pending';
        if (phaseStatus !== 'done') return phase;
    }
    return 'complete';
}

function writeStatus(taskId: string, status: StatusJson): void {
    status.status = deriveTopLevelStatus(status);
    const statusFile = statusFileFor(taskId);
    const tmpFile = `${statusFile}.tmp`;
    fs.writeFileSync(tmpFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpFile, statusFile);
}

// ── Command runners ────────────────────────────────────────────────────────

function runCommand(command: string, args: string[]): CommandResult {
    const result = spawnSync(command, args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
    return {
        ok: result.status === 0,
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
    };
}

function runCommandOrDie(command: string, args: string[], options: SpawnSyncOptions = {}): void {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.error) { console.error(result.error.message); process.exit(1); }
    if (typeof result.status === 'number' && result.status !== 0) process.exit(result.status);
    if (result.signal) process.exit(1);
}

// ── Git helpers ────────────────────────────────────────────────────────────

function git(...args: string[]): string {
    const result = runCommand('git', args);
    if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || 'unknown error'}`);
    return result.stdout;
}

function gitSafe(...args: string[]): CommandResult {
    return runCommand('git', args);
}

function gitSafeAt(cwd: string, ...args: string[]): CommandResult {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
    return { ok: result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

function gitSafeAtRaw(cwd: string, ...args: string[]): CommandResult {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
    return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}

/**
 * Commit any uncommitted task-artifact changes (within `tasks/<id>/`) to the
 * current branch before the pipeline cuts a worktree. Without this, the worktree
 * branches off a HEAD that doesn't contain the spec/plan, and Codex runs blind.
 *
 * Surgical: only adds files inside `tasks/<id>/`, never sweeps up other working-tree
 * changes the operator may have in flight. Idempotent — no changes = no commit.
 */
function commitTaskArtifactsToBase(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const taskDir = path.relative(REPO_ROOT, taskDirFor(taskId));
        const status = gitSafe('status', '--porcelain', '--', taskDir);
        if (!status.ok || status.stdout.trim().length === 0) continue;
        git('add', '--', taskDir);
        git('commit', '-m', `task(${taskId}): commit artifacts pre-pipeline`);
        info(`Committed task artifacts for ${taskId} to base branch.`);
    }
}

function getCurrentBranch(): string {
    return git('rev-parse', '--abbrev-ref', 'HEAD');
}

function branchExistsLocally(name: string): boolean {
    return gitSafe('show-ref', '--verify', '--quiet', `refs/heads/${name}`).ok;
}

/**
 * Resolve the base branch for an operation.
 *
 * - With taskIds: reads `status.json.base_branch` from each task. All tasks
 *   in a bundle must agree on the base. Falls back to main/master if absent.
 *   Used everywhere that has task context (prompts, --pr, --ship, etc.).
 * - Without taskIds: falls back to main/master. Used in early boot / CLI paths
 *   that haven't loaded task status yet.
 *
 * Tasks branch off and merge against `base_branch`. Default `'main'`. Set to
 * `'release/v<X.Y>'` (auto-detected by `task.sh new` from current checkout)
 * for tasks that participate in a multi-task release branch.
 */
function getBaseBranch(taskIds?: string[]): string {
    if (taskIds && taskIds.length > 0) {
        const bases = new Set<string>();
        for (const id of taskIds) {
            const status = readStatus(id);
            const declared = (status.base_branch ?? '').trim();
            bases.add(declared || getDefaultBaseBranch());
        }
        if (bases.size > 1) {
            die(
                `Bundle base_branch mismatch: tasks have different base branches (${[...bases].join(', ')}). ` +
                `All tasks in a bundle must target the same base. Edit status.json to align before invoking.`,
            );
        }
        return [...bases][0];
    }
    return getDefaultBaseBranch();
}

function getDefaultBaseBranch(): string {
    if (branchExistsLocally('main')) return 'main';
    if (branchExistsLocally('master')) return 'master';
    die('Neither main nor master branch found locally.');
}

function commitsAheadOfBase(branchName: string, baseBranch: string): number {
    const result = gitSafe('rev-list', '--count', `${baseBranch}..${branchName}`);
    if (!result.ok) return 0;
    const count = Number.parseInt(result.stdout, 10);
    return Number.isNaN(count) ? 0 : count;
}

function isCommandAvailable(command: string): boolean {
    const result = spawnSync('which', [command], { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

// ── Branch management ──────────────────────────────────────────────────────
// Bundles share one branch, named after the first task.

function ensureBranch(taskIds: string[]): void {
    const primaryStatus = readStatus(taskIds[0]);
    const useWorktree = primaryStatus.worktree === true;

    // Reject mixed-worktree bundles upfront — ensureWorktree / getActiveCwd key off
    // the first task only, so a bundle with mixed flags would silently misbehave.
    if (taskIds.length > 1) {
        for (const id of taskIds.slice(1)) {
            if ((readStatus(id).worktree === true) !== useWorktree) {
                die(`Mixed-worktree bundle: '${taskIds[0]}' has worktree=${useWorktree} but '${id}' differs. All bundled tasks must use the same worktree setting.`);
            }
        }
    }

    if (primaryStatus.branch) {
        if (useWorktree) {
            ensureWorktree(taskIds[0], primaryStatus.branch);
        } else {
            const current = getCurrentBranch();
            if (current !== primaryStatus.branch) {
                info(`Switching from '${current}' to recorded branch '${primaryStatus.branch}'...`);
                git('checkout', primaryStatus.branch);
            }
        }
        return;
    }

    const branchName = `task/${taskIds[0]}`;
    const baseBranch = getBaseBranch(taskIds);
    if (useWorktree) {
        // Worktree creation branches off whatever HEAD is currently on. The
        // operator should be on baseBranch when invoking — guard against
        // drift. If they're on the task branch's intended base or main, we're
        // fine; otherwise warn but proceed.
        const currentForWorktree = getCurrentBranch();
        if (currentForWorktree !== baseBranch && currentForWorktree !== 'main' && currentForWorktree !== 'master') {
            warn(
                `Creating worktree task branch off '${currentForWorktree}', but task's base_branch is '${baseBranch}'. ` +
                `If you meant to branch off '${baseBranch}', \`git checkout ${baseBranch}\` first.`,
            );
        }
        ensureWorktree(taskIds[0], branchName);
    } else {
        const current = getCurrentBranch();
        // Accept main/master OR the configured base_branch (e.g. release/v1.6)
        // as a valid spot to branch off from.
        const isOnBase = current === baseBranch || current === 'main' || current === 'master';
        if (isOnBase) {
            if (branchExistsLocally(branchName)) {
                info(`Branch '${branchName}' already exists — checking out.`);
                git('checkout', branchName);
            } else {
                info(`Creating branch '${branchName}' off ${current}...`);
                git('checkout', '-b', branchName);
            }
        } else if (current !== branchName) {
            info(`On branch '${current}' (not '${baseBranch}', not '${branchName}'). Staying on it.`);
        }
    }

    const resolvedBranch = useWorktree ? branchName : getCurrentBranch();
    for (const taskId of taskIds) {
        const s = readStatus(taskId);
        s.branch = resolvedBranch;
        writeStatus(taskId, s);
    }
    info(`Branch recorded: ${resolvedBranch}`);
}

function verifyBranch(taskIds: string[]): void {
    const status = readStatus(taskIds[0]);
    if (!status.branch) return;
    // In worktree mode the task branch lives in the worktree; main repo stays on main.
    if (status.worktree === true) return;
    const current = getCurrentBranch();
    if (current !== status.branch) {
        warn(`Expected branch '${status.branch}' but on '${current}'. Continuing anyway.`);
    }
}

// ── Worktree helpers ───────────────────────────────────────────────────────

function worktreePath(taskId: string): string {
    return path.join(WORKTREES_ROOT, taskId);
}

function isWorktreeEnabled(taskIds: string[]): boolean {
    return readStatus(taskIds[0]).worktree === true;
}

/** Returns the worktree path if it exists for this task, REPO_ROOT otherwise. */
function getActiveCwd(taskIds: string[]): string {
    if (isWorktreeEnabled(taskIds)) {
        const wt = worktreePath(taskIds[0]);
        if (fs.existsSync(wt)) return wt;
        // Worktree may be at a different path if this bundle runs with a secondary task first.
        const branch = readStatus(taskIds[0]).branch;
        if (branch) {
            const existing = findExistingWorktreeForBranch(branch);
            if (existing) return existing;
        }
    }
    return REPO_ROOT;
}

function findExistingWorktreeForBranch(branch: string): string | null {
    const result = gitSafe('worktree', 'list', '--porcelain');
    if (!result.ok) return null;
    const lines = result.stdout.split('\n');
    let currentPath: string | null = null;
    for (const line of lines) {
        if (line.startsWith('worktree ')) {
            currentPath = line.slice('worktree '.length).trim();
        } else if (line.startsWith('branch refs/heads/') && currentPath && currentPath !== REPO_ROOT) {
            const lineBranch = line.slice('branch refs/heads/'.length).trim();
            if (lineBranch === branch) return currentPath;
        }
    }
    return null;
}

function ensureWorktree(taskId: string, branch: string): string {
    if (!fs.existsSync(WORKTREES_ROOT)) {
        fs.mkdirSync(WORKTREES_ROOT, { recursive: true });
    }
    const wt = worktreePath(taskId);
    if (fs.existsSync(wt)) {
        info(`Worktree already exists: ${wt}`);
        return wt;
    }
    // Branch may already be checked out in a differently-named worktree (e.g. when a
    // secondary bundle task runs without the primary task ID as the first argument).
    const existingWt = findExistingWorktreeForBranch(branch);
    if (existingWt) {
        info(`Worktree already exists for branch '${branch}': ${existingWt}`);
        return existingWt;
    }
    // Pre-flight: verify REPO_ROOT/node_modules exists if package.json does. This
    // runs BEFORE `git worktree add` so a failed pre-flight leaves no orphan worktree
    // that later runs would early-return on (line ~800) and silently skip the
    // node_modules symlink — leaving the worktree in the same broken state we tried
    // to prevent. If the user follows the abort message and runs `npm install`, the
    // next run starts fresh with no leftover worktree directory.
    const repoModulesSrc = path.join(REPO_ROOT, 'node_modules');
    const repoPackageJson = path.join(REPO_ROOT, 'package.json');
    if (fs.existsSync(repoPackageJson) && !fs.existsSync(repoModulesSrc)) {
        die(
            `Worktree setup aborted: ${REPO_ROOT}/node_modules does not exist, but ` +
            `package.json does. The orchestrator symlinks node_modules from REPO_ROOT into ` +
            `each worktree; that requires REPO_ROOT to have its dependencies installed first. ` +
            `Run \`npm install\` (or \`npm ci\`) in ${REPO_ROOT} and try again.`
        );
    }

    if (branchExistsLocally(branch)) {
        info(`Creating worktree at ${wt} (branch: ${branch})...`);
        git('worktree', 'add', wt, branch);
    } else {
        info(`Creating worktree at ${wt} (new branch: ${branch})...`);
        git('worktree', 'add', '-b', branch, wt);
    }
    // Symlink node_modules so Codex can run npm scripts without a separate install.
    // Only attempt when package.json is present (project actually uses node_modules)
    // and the symlink isn't already there (idempotent for re-runs).
    const wtModules = path.join(wt, 'node_modules');
    if (fs.existsSync(repoPackageJson) && !fs.existsSync(wtModules)) {
        fs.symlinkSync(repoModulesSrc, wtModules);
        info('Symlinked node_modules into worktree.');
    }
    // Symlink local/preview env files (gitignored — not in the worktree by
    // default) so dev-server / preview / deploy CLIs work in the worktree
    // without manual copy. Files already tracked in git are skipped because
    // they're already present from the git checkout.
    const envFiles = fs.readdirSync(REPO_ROOT).filter((name) =>
        name.startsWith('.env')
        && fs.statSync(path.join(REPO_ROOT, name)).isFile()
    );
    const linkedEnvFiles: string[] = [];
    for (const envFile of envFiles) {
        const dst = path.join(wt, envFile);
        if (!fs.existsSync(dst)) {
            fs.symlinkSync(path.join(REPO_ROOT, envFile), dst);
            linkedEnvFiles.push(envFile);
        }
    }
    if (linkedEnvFiles.length > 0) {
        info(`Symlinked env file(s) into worktree: ${linkedEnvFiles.join(', ')}.`);
    }
    info('Worktree ready.');
    return wt;
}

function teardownWorktree(taskId: string): void {
    const wt = worktreePath(taskId);
    if (!fs.existsSync(wt)) return;
    info(`Removing worktree ${wt}...`);
    const result = gitSafe('worktree', 'remove', '--force', wt);
    if (!result.ok) warn(`Could not remove worktree: ${result.stderr}`);
    else info('Worktree removed.');
}

/**
 * In worktree mode, telemetry files accumulate as uncommitted changes in the
 * main repo from two paths:
 *   1. The orchestrator process writes pipeline-invocations.md directly to
 *      REPO_ROOT during phase execution.
 *   2. The QA sub-agent writes task-quality-log.md and lessons-learned.md
 *      inside the worktree; syncWorktreeTelemetry mirrors those to REPO_ROOT
 *      after each worktree phase.
 * Flush them to main before pushing the worktree branch or shipping, so they're
 * never stranded. The task branch never carries telemetry edits forward — they
 * land directly on main.
 */
function flushWorktreeTelemetry(): void {
    const present = PIPELINE_TELEMETRY_FILES.filter(f => fs.existsSync(path.join(REPO_ROOT, f)));
    if (present.length === 0) return;
    const status = gitSafe('status', '--porcelain', ...present);
    if (!status.ok || !status.stdout.trim()) return;
    for (const f of present) gitSafe('add', '--', f);
    const staged = gitSafe('diff', '--cached', '--name-only');
    if (!staged.stdout.trim()) return;
    // Commits land on whatever branch REPO_ROOT is currently on — `main` for
    // standard tasks, `release/v<X.Y>` when the operator is driving a release
    // branch. The telemetry follows the operator's intent automatically.
    const targetBranch = getCurrentBranch();
    const result = gitSafe('commit', '-m', 'chore: flush pipeline telemetry');
    if (!result.ok) warn(`Could not flush telemetry to ${targetBranch}: ${result.stderr}`);
    else info(`Flushed pipeline telemetry to ${targetBranch}.`);
}

// Exhaustive list of pipeline-managed markdown files that Codex writes to tasks/<id>/.
// Used by syncWorktreeArtifacts for delete-aware sync: files present in main but absent
// from the worktree are removed so renamed/deleted artifacts don't linger as stale copies.
const TASK_ARTIFACT_FILES = new Set([
    'spec.md', 'spec-review.md', 'plan.md', 'handoff.md', 'review.md', 'done.md',
]);

/**
 * After Codex runs in a worktree, sync task artifact files between the worktree
 * and the main repo's tasks/<id>/ directory so the pipeline can read them via
 * taskDirFor() (which always returns REPO_ROOT paths). Delete-aware: a known
 * artifact absent from the worktree is removed from the main repo so stale copies
 * from previous rename/delete cycles don't shadow the canonical worktree state.
 *
 * status.json is excluded here — it is read and written directly via statusFileFor(),
 * which routes to the worktree when active, keeping REPO_ROOT's copy clean.
 */
function syncWorktreeArtifacts(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const wt = worktreePath(taskId);
        const wtDir = path.join(wt, 'tasks', taskId);
        const mainDir = path.join(REPO_ROOT, 'tasks', taskId);
        if (!fs.existsSync(wtDir)) continue;
        const wtFiles = new Set(
            fs.readdirSync(wtDir).filter(f => {
                try { return fs.statSync(path.join(wtDir, f)).isFile(); } catch { return false; }
            })
        );
        for (const name of TASK_ARTIFACT_FILES) {
            const src = path.join(wtDir, name);
            const dest = path.join(mainDir, name);
            try {
                if (wtFiles.has(name)) {
                    fs.copyFileSync(src, dest);
                } else if (fs.existsSync(dest)) {
                    fs.unlinkSync(dest);
                }
            } catch {
                // Non-fatal — pipeline catches missing artifacts downstream
            }
        }
    }
}

/**
 * In worktree mode, the QA sub-agent edits telemetry files (task-quality-log.md,
 * lessons-learned.md) inside the worktree. Those edits never reach REPO_ROOT on
 * their own, so flushWorktreeTelemetry — which only stages from REPO_ROOT — would
 * silently drop them. After every worktree phase, mirror those files from the
 * worktree into REPO_ROOT and revert the worktree copy to its branch HEAD so the
 * task branch stays free of telemetry churn (telemetry lives on main; only main
 * grows the log). Idempotent: when the worktree's content matches REPO_ROOT or
 * the file isn't present in the worktree, this is a no-op.
 */
function syncWorktreeTelemetry(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const wt = worktreePath(taskId);
        if (!fs.existsSync(wt)) continue;
        for (const relPath of PIPELINE_TELEMETRY_FILES) {
            // pipeline-invocations.md is written by the orchestrator directly in
            // REPO_ROOT — the worktree copy is always the old HEAD snapshot.
            // Copying worktree→REPO_ROOT would clobber entries the orchestrator
            // just appended. Only sync files that sub-agents write inside the worktree.
            if (relPath === 'docs/pipeline-invocations.md') continue;
            const src = path.join(wt, relPath);
            const dest = path.join(REPO_ROOT, relPath);
            if (!fs.existsSync(src)) continue;
            try {
                let needsCopy = !fs.existsSync(dest);
                if (!needsCopy) {
                    const a = fs.readFileSync(src);
                    const b = fs.readFileSync(dest);
                    needsCopy = !a.equals(b);
                }
                if (needsCopy) {
                    fs.copyFileSync(src, dest);
                }
                // Revert the worktree's copy to its branch HEAD so the task
                // branch never carries telemetry edits forward. If the file
                // isn't tracked on this branch, the checkout no-ops and we
                // ignore the error.
                gitSafeAt(wt, 'checkout', 'HEAD', '--', relPath);
            } catch {
                // Non-fatal — flushWorktreeTelemetry runs at --push/--pr/--ship
                // and surfaces any genuinely broken state there.
            }
        }
    }
}

// ── Session management ─────────────────────────────────────────────────────

// Bundles store the shared session ID in all task status.json files.
type SessionSlot = 'claude_spec' | 'claude_review' | 'codex';

function storeSessionId(taskIds: string[], agent: SessionSlot, sessionId: string): void {
    for (const taskId of taskIds) {
        const s = readStatus(taskId);
        if (!s.sessions) s.sessions = {};
        s.sessions[agent] = sessionId;
        writeStatus(taskId, s);
    }
}

function getStoredSessionId(taskIds: string[], agent: SessionSlot): string | null {
    return readStatus(taskIds[0]).sessions?.[agent] ?? null;
}

function toResumePrompt(prompt: string): string {
    // Strip whichever startup block is embedded in this prompt.
    // Startup blocks are surrounded by \n\n in all prompt templates.
    // CLAUDE_STARTUP / CODEX_STARTUP / QA_STARTUP are defined later in the file
    // but are fully initialized before this function is ever called (via main()).
    let trimmed = prompt;
    for (const block of [CLAUDE_STARTUP, CODEX_STARTUP, QA_STARTUP]) {
        trimmed = trimmed.replace(`\n\n${block}\n\n`, '\n\n');
    }
    return `[Resumed session — project context loaded. Skip startup boilerplate re-reads (AGENTS.md, architecture docs, etc.) — re-read any task-specific files explicitly requested in this prompt, then verify the current working tree or artifact before claiming anything is already done.]\n\n${trimmed.trimStart()}`;
}

// ── Handoff pre-flight ─────────────────────────────────────────────────────

/** Returns a list of blocking issues found in handoff.md before Claude reviews. */
function validateHandoff(taskId: string): string[] {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    const issues: string[] = [];
    try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        if (/\|\s*Fail\s*\|/i.test(content)) {
            issues.push('Validation Outcomes table has one or more Fail results');
        }
        if (!/\|\s*AC[-\s]/i.test(content)) {
            issues.push('AC Coverage table is missing or contains no AC rows');
        }
        issues.push(...validateHandoffAgainstSpec(specPath, handoffPath));
    } catch {
        issues.push('handoff.md not found');
    }
    return issues;
}

function canonicalizeValidationCheck(value: string): string {
    // Prefer the first backticked command (the canonical form). Spec annotations
    // like "`npm run test` — including the four new unit tests" must canonicalize
    // to "npm run test" so they match handoff rows that just contain `npm run test`.
    // Falls back to splitting on em-dash/en-dash/" - " for un-backticked entries.
    const backtickMatch = value.match(/`([^`]+)`/);
    const base = backtickMatch ? backtickMatch[1] : value.split(/\s+[—–-]\s+/)[0];
    return base.replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseValidationRequiredChecks(specPath: string): string[] {
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const section = content.match(/## Validation Required\n\n([\s\S]*?)(?:\n## |\n# |$)/);
        if (!section) return [];
        const checks: string[] = [];
        for (const line of section[1].split('\n')) {
            const match = line.match(/^-\s+\[x\]\s+(.+?)\s*$/i);
            if (match?.[1]) checks.push(match[1].trim());
        }
        return checks;
    } catch {
        return [];
    }
}

type ValidationOutcomeRow = {
    check: string;
    result: string;
    notes: string;
};

function parseValidationOutcomeRows(handoffPath: string): ValidationOutcomeRow[] {
    try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        const lines = content.split('\n');
        const tableStart = lines.findIndex(line => line.includes('| Check |'));
        if (tableStart === -1) return [];
        const rows: ValidationOutcomeRow[] = [];
        for (let index = tableStart + 2; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line.startsWith('|')) break;
            const cells = line.split('|').map(c => c.trim()).filter(Boolean);
            if (cells.length < 2) continue;
            const [check, result, notes = ''] = cells;
            rows.push({ check, result, notes });
        }
        return rows;
    } catch {
        return [];
    }
}

function isPassResult(result: string): boolean {
    return result.trim().toLowerCase().startsWith('pass');
}

function isNAResult(result: string): boolean {
    return /^n\/?a\b/i.test(result.trim());
}

export function validateHandoffAgainstSpec(specPath: string, handoffPath: string): string[] {
    const requiredChecks = parseValidationRequiredChecks(specPath);
    if (requiredChecks.length === 0) return [];

    const rows = parseValidationOutcomeRows(handoffPath);
    const rowMap = new Map<string, ValidationOutcomeRow>();
    for (const row of rows) {
        rowMap.set(canonicalizeValidationCheck(row.check), row);
    }

    const issues: string[] = [];
    for (const required of requiredChecks) {
        const canonical = canonicalizeValidationCheck(required);
        const row = rowMap.get(canonical);
        if (!row) {
            issues.push(`Validation Required item missing from handoff.md: ${required}`);
            continue;
        }
        if (isNAResult(row.result)) {
            issues.push(`Validation Required item marked N/A in handoff.md: ${required}`);
            continue;
        }
        if (!isPassResult(row.result)) {
            const note = row.notes ? ` (${row.notes})` : '';
            issues.push(`Validation Required item did not pass in handoff.md: ${required} — ${row.result}${note}`);
        }
    }
    return issues;
}

// ── Context injection ──────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractAffectedFiles(taskId: string): string[] {
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const match = content.match(/### Affected Files\n\n\|[^\n]+\|\n\|[^\n]+\|\n((?:\|[^\n]+\|\n?)*)/);
        if (!match) return [];
        return match[1]
            .split('\n')
            .filter(l => l.startsWith('|'))
            .map(row => row.match(/\|\s*`([^`]+)`/)?.[1])
            .filter((f): f is string => !!f);
    } catch {
        return [];
    }
}

function buildContextBlock(taskIds: string[]): string {
    const allFiles = new Map<string, string>();
    for (const taskId of taskIds) {
        for (const file of extractAffectedFiles(taskId)) {
            if (allFiles.has(file)) continue;
            const filePath = path.join(REPO_ROOT, file);
            try {
                allFiles.set(file, fs.readFileSync(filePath, 'utf8'));
            } catch {
                // File may be new (not yet created) — skip silently
            }
        }
    }
    if (allFiles.size === 0) return '';

    let totalBytes = 0;
    for (const content of allFiles.values()) totalBytes += content.length;

    if (totalBytes > config.maxContextBytes) {
        const list = [...allFiles.keys()].map(f => `  - ${f}`).join('\n');
        return `\n## Relevant Files (too large to pre-load — read these manually)\n\n${list}\n`;
    }

    let block = '\n## Relevant Files (pre-loaded from spec Affected Files)\n\n';
    for (const [file, content] of allFiles.entries()) {
        const ext = path.extname(file).slice(1) || 'text';
        block += `### \`${file}\`\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
    }
    return block;
}

// ── Patterns / risk injection ──────────────────────────────────────────────

/** Extracts the Known Pitfalls section from docs/patterns.md for injection into implement prompts. */
function buildKnownPitfalls(): string {
    const patternsPath = path.join(REPO_ROOT, 'docs/patterns.md');
    try {
        const content = fs.readFileSync(patternsPath, 'utf8');
        const match = content.match(/## Known Pitfalls\n\n([\s\S]*?)(?:\n## |\n---|\n# |$)/);
        if (!match) return '';
        return `\n## Known Codebase Pitfalls (from docs/patterns.md — read before touching these areas)\n\n${match[1].trimEnd()}\n\n`;
    } catch {
        return '';
    }
}

/** Extracts the Known Risks section from each task's spec.md and surfaces them at prompt-top for primacy. */
function buildKnownRisks(taskIds: string[]): string {
    const riskBlocks = taskIds.map(taskId => {
        const specPath = path.join(taskDirFor(taskId), 'spec.md');
        try {
            const content = fs.readFileSync(specPath, 'utf8');
            const match = content.match(/## Known Risks\n\n([\s\S]*?)(?:\n## |\n# |$)/);
            if (!match) return '';
            const risks = match[1].trim();
            if (!risks || /^n\/?a$/i.test(risks) || /^none$/i.test(risks)) return '';
            return taskIds.length > 1
                ? `**\`${taskId}\` Known Risks:**\n${risks}`
                : risks;
        } catch {
            return '';
        }
    }).filter(Boolean);

    if (riskBlocks.length === 0) return '';
    return `\n## Known Risks (from spec — read before writing any code)\n\n${riskBlocks.join('\n\n')}\n\n`;
}

// ── Implement state header + AC summary (prompt primacy) ───────────────────

type ImplementMode = 'fresh' | 'revision' | 'reroute' | 'resume';

/** Summarize pre-load status from spec Affected Files — matches the decision
 *  buildContextBlock() made (preloaded, listed-only, or none). Surfaced in the
 *  state header so Codex knows whether to read those files manually. */
function summarizePreloadStatus(taskIds: string[]): string {
    const files = new Map<string, number>();
    for (const taskId of taskIds) {
        for (const file of extractAffectedFiles(taskId)) {
            if (files.has(file)) continue;
            const filePath = path.join(REPO_ROOT, file);
            try {
                files.set(file, fs.statSync(filePath).size);
            } catch {
                files.set(file, 0); // new file — not yet on disk
            }
        }
    }
    if (files.size === 0) return 'none (spec has no Affected Files table)';
    const totalBytes = [...files.values()].reduce((sum, n) => sum + n, 0);
    const kb = (totalBytes / 1024).toFixed(1);
    if (totalBytes > config.maxContextBytes) {
        return `${files.size} file(s) listed (${kb} KB) — too large to pre-load, read them manually`;
    }
    return `${files.size} file(s) pre-loaded inline (${kb} KB)`;
}

/** Extracts items from the spec's "Validation Required" section. Accepts both
 *  checked and unchecked boxes — the convention in practice is that any item
 *  present in the list applies; authors often leave boxes unchecked. */
function extractValidationChecks(taskId: string): string[] {
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const section = content.match(/## Validation Required\n\n([\s\S]*?)(?:\n## |\n# |$)/);
        if (!section) return [];
        const checks: string[] = [];
        for (const line of section[1].split('\n')) {
            // Match any checklist line with a backtick-wrapped command — e.g.
            // `- [ ] \`npm run lint\``, `- [x] \`pytest tests/\``, or
            // `- [ ] Manual test: ...`. Project-agnostic; any shell command works.
            const match = line.match(/^-\s+\[[ x]\]\s+`?([^`]+?)`?\s*(?:\(|$)/i);
            if (match?.[1]) checks.push(match[1].trim());
        }
        return checks;
    } catch {
        return [];
    }
}

/** Extracts `- [ ] AC-N: text` lines from a spec for the AC summary block. */
function extractAcSummary(taskId: string): string[] {
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const lines: string[] = [];
        for (const line of content.split('\n')) {
            const match = line.match(/^-\s+\[[ x]\]\s+(AC-[\w.-]+):\s+(.+)$/);
            if (match) lines.push(`- ${match[1]}: ${match[2].trim()}`);
        }
        return lines;
    } catch {
        return [];
    }
}

/** Compact state banner prepended to every implement prompt variant. Makes the
 *  task state explicit (mode, tier, preload status, validation checks) so Codex
 *  can't carry the wrong mental model into the pass. The AC summary below it is
 *  the single highest-value piece of primacy context — Codex optimizes for the
 *  exact targets instead of re-deriving them from the full spec. */
function buildImplementStateHeader(state: PipelineState, mode: ImplementMode): string {
    const { tasks, tier, isBundle } = state;
    const taskIds = tasks.map(t => t.taskId);
    const primary = tasks[0];

    const modeExplain: Record<ImplementMode, string> = {
        fresh: 'first implementation pass — no prior work on this phase',
        revision: `addressing code-review feedback (iteration ${primary.iterations + 1}) — read tasks/<id>/review.md`,
        reroute: `spec was amended after human_review (reroute #${primary.rerouteCount}) — re-read spec.md for new sections`,
        resume: 'previous implement pass was interrupted after code changes were made — finish validation + handoff only',
    };

    const sizes = new Set(tasks.map(t => t.status.task_size ?? 'M'));
    const nominalLabel = sizes.size === 1 ? [...sizes][0] : `mixed (${[...sizes].sort().join(',')})`;
    // If `delicate` promotes the bundle to XL for model/effort purposes, surface
    // that in the header so Codex can spot it without reading status.json.
    const effective = getEffectiveSize(tasks);
    const nominal = getNominalSize(tasks);
    const sizeLabel = effective !== nominal
        ? `${nominalLabel} (effective: ${effective} via delicate)`
        : nominalLabel;
    const bundleLabel = isBundle ? `${tasks.length}-task bundle` : 'single task';
    const preloadLabel = summarizePreloadStatus(taskIds);

    const allChecks = new Set<string>();
    for (const id of taskIds) for (const c of extractValidationChecks(id)) allChecks.add(c);
    const checksLabel = allChecks.size > 0 ? [...allChecks].join(', ') : 'see each spec\'s Validation Required section';

    // AC summary is the biggest remaining token cost. Skip for `resume`
    // (handoff.md's AC coverage table is already the source of truth, and the
    // code changes are already in place). For fresh/revision/reroute, include
    // the full list but cap total size so XL specs and large bundles don't
    // blow up the prompt. `reroute` keeps the full block because the spec may
    // carry NEW amendment ACs Codex hasn't seen.
    const AC_SECTION_CAP = 3000;
    let acSection = '';
    // truncatedLabel is surfaced in the state header so Codex sees upfront
    // whether it should fall back to spec.md for the missing tail, instead of
    // having to spot the inline marker at the bottom of the AC block.
    //   'no'          — full list fits, or spec has zero ACs
    //   'yes — N ACs' — cap hit, tail elided (total N across the bundle)
    //   'n/a (resume)' — AC block replaced with a pointer; handoff.md owns coverage
    let truncatedLabel = 'no';
    if (mode === 'resume') {
        acSection = '\n## Acceptance Criteria\n\nCode changes are already in place — ensure handoff.md\'s AC coverage table lists every AC in spec.md.\n';
        truncatedLabel = 'n/a (resume — see spec.md + handoff.md)';
    } else {
        const perTaskBlocks = taskIds.map(id => {
            const acs = extractAcSummary(id);
            if (acs.length === 0) return { id, lines: [] as string[] };
            return { id, lines: acs };
        }).filter(b => b.lines.length > 0);

        if (perTaskBlocks.length > 0) {
            // Build body, truncating by line once we hit the cap. Track dropped
            // ACs per task so the marker tells Codex exactly what's missing.
            let used = 0;
            const renderedBlocks: string[] = [];
            const dropped: Record<string, number> = {};
            for (const block of perTaskBlocks) {
                const header = isBundle ? `**\`${block.id}\`:**\n` : '';
                const kept: string[] = [];
                for (const line of block.lines) {
                    const cost = line.length + 1; // +1 for newline
                    if (used + cost > AC_SECTION_CAP) {
                        dropped[block.id] = (dropped[block.id] ?? 0) + 1;
                        continue;
                    }
                    kept.push(line);
                    used += cost;
                }
                if (kept.length > 0) renderedBlocks.push(`${header}${kept.join('\n')}`);
                // If kept is empty, every line was already counted in `dropped`
                // by the continue branch above — no extra bookkeeping needed.
            }
            const droppedEntries = Object.entries(dropped).filter(([, n]) => n > 0);
            const totalDropped = droppedEntries.reduce((sum, [, n]) => sum + n, 0);
            const truncMarker = droppedEntries.length > 0
                ? `\n\n*…${droppedEntries.map(([id, n]) => isBundle ? `${n} more ACs in ${id}` : `${n} more ACs`).join(', ')} — see spec.md for full text*`
                : '';
            acSection = `\n## Acceptance Criteria Summary (binding — full text and verification notes in spec.md)\n\n${renderedBlocks.join('\n\n')}${truncMarker}\n`;
            if (totalDropped > 0) truncatedLabel = `yes — ${totalDropped} AC${totalDropped === 1 ? '' : 's'} elided, fall back to spec.md`;
        }
    }

    return `## Task State

- Phase: **implement**
- Mode: **${mode}** — ${modeExplain[mode]}
- Tier / task size: ${tier} / ${sizeLabel}
- Scope: ${bundleLabel}
- Relevant files: ${preloadLabel}
- Required validation: ${checksLabel}
- ACs truncated: ${truncatedLabel}
${acSection}`;
}

// ── Startup doc strings (scoped per agent role) ────────────────────────────

const CLAUDE_STARTUP =
    'Read AGENTS.md and docs/patterns.md before starting.\n' +
    'Skim docs/lessons-learned.md for entries relevant to your task area.\n' +
    'Read docs/architecture.md if the task touches core data flow or state management.\n' +
    'Read docs/product-context.md if the task touches user-visible behavior or Pro features.\n' +
    'Skip docs/product-owner.md and docs/decisions.md unless the task involves explicit UX tradeoffs.';

const CODEX_STARTUP =
    'Read AGENTS.md, docs/patterns.md, and docs/codebase-map.md before starting.\n' +
    'Skim docs/lessons-learned.md for entries relevant to your task area.\n' +
    'Skip docs/product-owner.md, docs/decisions.md, docs/product-context.md unless the task explicitly involves product or UX decisions.\n' +
    'Ground every claim in the current file, diff, or artifact before you state it. Do not rely on prior-session memory for code existence, validation results, or completion status.\n' +
    'On resumed sessions, re-read the task-specific files named in the prompt and inspect the current working tree before saying anything is already done.\n' +
    '\n' +
    'Git ownership: the pipeline orchestrator handles staging, committing, and pushing — do NOT run `git add`, `git commit`, or `git push`. Edit files in the working tree only; the orchestrator reads `git status` after your session and stages every file listed in handoff.md\'s Changes table. Read-only git is fine (`git status`, `git diff`, `git log`, `git show`).\n' +
    '\n' +
    'If a code review claims a file is "missing from the commit" or "staged but not committed," that is a pipeline-orchestration issue, not an implementation issue. Record it as a Blocker in handoff.md with the `[pipeline]` label and do not retry `git add`/`git commit` to recover — the sandbox blocks `.git` writes by design, and the orchestrator owns the recovery path.';

const QA_STARTUP =
    'Read CHANGELOG.md for voice and version reference.\n' +
    'Read docs/lessons-learned.md for recent insights to distill.\n' +
    'No full codebase context needed for QA — read each task\'s spec.md, handoff.md, and notes.md directly.';

// ── Prompt helpers ─────────────────────────────────────────────────────────

function taskList(tasks: TaskContext[]): string {
    return tasks.map(t => `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/`).join('\n');
}

function phaseCommands(taskIds: string[], phase: string, status: string, verdict = ''): string {
    // cd to the task's canonical CWD so task.sh's relative TASKS_DIR="tasks" resolves
    // to the right tasks/ directory. When a worktree is active, this is the worktree
    // path (keeping REPO_ROOT clean); otherwise it's REPO_ROOT.
    return taskIds.map(id => {
        const cmd = verdict
            ? `${REPO_ROOT}/scripts/task.sh phase ${id} ${phase} ${status} ${verdict}`
            : `${REPO_ROOT}/scripts/task.sh phase ${id} ${phase} ${status}`;
        return `(cd '${resolveTaskCwd(id)}' && ${cmd})`;
    }).join('\n');
}

// ── Prompt functions ───────────────────────────────────────────────────────

function promptSpec(state: PipelineState): string {
    const { tasks, tier, isBundle } = state;
    const combined = tier === 'fast'; // write plan alongside spec for fast-tier tasks

    const header = isBundle
        ? `You are writing specs for a bundle of ${tasks.length} related tasks for ${config.projectName}.\n\nBundle tasks:\n${taskList(tasks)}`
        : `You are working on task "${tasks[0].taskId}" for ${config.projectName}.\n\nTask: ${tasks[0].title}\nDirectory: tasks/${tasks[0].taskId}/`;

    const instructions = isBundle
        ? tasks.map(t =>
            `**Task \`${t.taskId}\`**: Write tasks/${t.taskId}/spec.md using the template.` +
            (combined ? ` Also write tasks/${t.taskId}/plan.md with ordered implementation steps, specific file references, and existing patterns.` : '')
        ).join('\n\n')
        : `Write tasks/${tasks[0].taskId}/spec.md using the template in tasks/_templates/spec.md. Be concrete — Codex implements directly from this.` +
          (combined ? `\n\nAlso write tasks/${tasks[0].taskId}/plan.md with ordered implementation steps, specific file references, and existing patterns to use.` : '');

    const doneNote = combined
        ? 'The orchestrator will handle spec_review and plan-phase advancement automatically for fast-tier tasks.'
        : '';

    const selfCheck = `
Before running the task.sh command, self-check each spec against this list. Fix anything that fails:
- Every AC is verifiable with a specific test (not just "it works" — state exactly how to verify)
- Affected Files lists specific files (not directories) with specific, actionable change descriptions
${combined ? '- Plan steps reference actual function/file names from the codebase (not just concepts)\n' : ''}- Known Risks covers failure modes for the trickiest ACs
- Human Test Plan describes product behavior only (no code, no file names, no TypeScript)
- Validation Required has at least one entry checked (or explicitly "None" with a reason)`;

    return `${header}

${CLAUDE_STARTUP}

${instructions}
${isBundle ? '\nThese tasks are related — consider cross-task interactions while speccing.' : ''}
${doneNote ? `\nNote: ${doneNote}` : ''}
${selfCheck}

When done, run (one per task):
${phaseCommands(tasks.map(t => t.taskId), 'spec', 'done')}`;
}

function promptSpecRevision(state: PipelineState): string {
    const { tasks, tier } = state;
    const combined = tier === 'fast';

    const reviewLines = tasks
        .filter(t => t.specReviewVerdict === 'changes_requested')
        .map(t => `- \`${t.taskId}\`: read tasks/${t.taskId}/spec-review.md for findings`)
        .join('\n');

    return `You are revising specs for ${tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`} for ${config.projectName}.

${CLAUDE_STARTUP}

Tasks with review feedback:
${reviewLines}

Address every \`changes_requested\` finding in each spec.md.${combined ? '\nAlso update plan.md if spec changes affect the implementation approach.' : ''}

When done, run:
${phaseCommands(tasks.map(t => t.taskId), 'spec', 'done')}`;
}

function promptSpecReview(state: PipelineState): string {
    const { tasks, tier } = state;
    const combined = tier === 'fast';

    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/spec.md${combined ? ` and tasks/${t.taskId}/plan.md` : ''}`
    ).join('\n');

    return `You are reviewing ${tasks.length > 1 ? 'a bundle of specs' : 'a spec'} for ${config.projectName}.

${CODEX_STARTUP}

Tasks to review:
${taskLines}

Grounding rule: if a finding depends on code, a symbol, or a validation result, verify the current file or diff before you claim it exists. If you did not re-open it, do not infer it from memory.

**Your job is to find what's wrong or missing — not to validate what's there.** Approach this as the implementer: if you had to build this, what would break, be ambiguous, or be missing? Neutral or confirmatory review is a failure mode.

**First, a strategic read of the spec itself — shape before implementability.** Ask:
- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

**Silence is the default.** Only flag a Shape Check concern if something is actually off — do not manufacture one. A real shape concern becomes the lead reason for a \`changes_requested\` verdict; write it under the Shape Check section in spec-review.md. If none, leave that section as "no concerns" and proceed.

Then for each task, actively probe implementability: Can this be implemented as written? Are ACs testable and unambiguous? Are edge cases handled? Are there type safety gaps? Are there file/interaction dependencies Claude missed? Does this conflict with existing patterns in the codebase?${tasks.length > 1 ? '\nAlso probe for cross-task conflicts or missing dependencies between tasks.' : ''}
${combined ? '\nReview plan.md for each task as well — flag if the approach is unsound.' : ''}

**Classify every finding before deciding your verdict:**
- **Blocking**: would cause wrong behavior, a silent bug, or make an AC unimplementable as written. Requires \`changes_requested\`.
- **Non-blocking (nit)**: an implementation detail Codex can resolve by reading the codebase (prop flow, state threading, naming); a minor ambiguity with an obvious default; a question the plan phase should address. Does NOT require \`changes_requested\`.

**Verdict rules:**
- \`changes_requested\` — one or more blocking findings. Spec must be revised before the plan phase.
- \`approved_with_nits\` — no blocking findings, but non-blocking nits worth passing forward. **Loop exits immediately.** Nits are written to spec-review.md and the plan phase picks them up.
- \`approved\` — no findings worth noting.

**Batch related nits.** If you have multiple non-blocking observations, include them all in one \`approved_with_nits\` verdict rather than raising one per round.

If you encounter surprising codebase behavior, append to tasks/<id>/notes.md (prefix: [spec_review]).

For each task, write tasks/<id>/spec-review.md using the template. Set your verdict: approved, approved_with_nits, or changes_requested.

When done, run (one per task with actual verdict):
${phaseCommands(tasks.map(t => t.taskId), 'spec_review', 'done', '<verdict>')}`;
}

function promptPlan(state: PipelineState): string {
    const { tasks } = state;

    const verdictLines = tasks.map(t =>
        `- \`${t.taskId}\`: spec review verdict = ${t.specReviewVerdict}`
    ).join('\n');

    return `You are writing implementation plans for ${tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`} for ${config.projectName}.

${CLAUDE_STARTUP}

${verdictLines}

For each task, read tasks/<id>/spec.md and tasks/<id>/spec-review.md. Address any \`changes_requested\` items before writing the plan. If the verdict is \`approved_with_nits\`, incorporate the nits into the plan — they don't require spec changes but should inform implementation decisions.

Write tasks/<id>/plan.md for each task with ordered implementation steps. Reference specific files, existing patterns, and code examples from the codebase. Codex implements directly from this plan.

If you encounter spec gaps, append to tasks/<id>/notes.md (prefix: [plan]).

When done, run:
${phaseCommands(tasks.map(t => t.taskId), 'plan', 'done')}`;
}

function promptImplement(state: PipelineState, mode: 'fresh' | 'resume' = 'fresh'): string {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    const stateHeader = buildImplementStateHeader(state, mode);
    const contextBlock = buildContextBlock(taskIds);
    const pitfallsBlock = buildKnownPitfalls();
    const risksBlock = buildKnownRisks(taskIds);

    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" → read tasks/${t.taskId}/spec.md and tasks/${t.taskId}/plan.md`
    ).join('\n');

    return `You are implementing ${tasks.length > 1 ? 'a bundle of related tasks' : `task "${tasks[0].taskId}"`} for ${config.projectName}.

${stateHeader}
${CODEX_STARTUP}
${risksBlock}${pitfallsBlock}${contextBlock}
Tasks to implement:
${taskLines}
${tasks.length > 1 ? '\nThese tasks are related — implement them together. Consider shared code paths and cross-task interactions.' : ''}

Grounding rule: before you write handoff.md, re-open the files you changed and verify the current diff against the spec. Do not treat a previous session's memory as proof that the work is already in place.

**Spec ACs are binding. Plan approach is guidance.**
- Every Acceptance Criterion in spec.md MUST be met — these are non-negotiable.
- If you find a better implementation approach than what's in the plan, use it. Document every deviation in handoff.md under "Deviations" with specific rationale.
- You may NOT silently drop an AC, skip a required validation check, or omit a spec requirement.
- If an AC is infeasible as written, document it in Blockers — do not silently skip.
- If an AC is ambiguous enough that two reasonable implementations exist, document your interpretation in handoff.md under Blockers with label \`[ambiguity]\` — do not silently guess. Claude will evaluate whether the interpretation was correct.

Run ALL applicable validation checks before writing handoff. See "Validation Required" in each spec.md and the matrix in AGENTS.md. Required checks must be recorded as Pass or Fail; do not mark a required check N/A unless the spec explicitly removed it.

**Test flakiness in your sandbox.** Validation suites — especially E2E or integration tests — can hit transient failures (timing races, environment quirks, network jitter) that have nothing to do with the code in your spec's Affected Files. **If a failure is in a test / file outside your Affected Files table, do NOT fix it.** Note the observed test name, file, line, and a one-line repro hint in handoff.md → Blockers (or "Validation Outcomes" Notes column with status \`Fail – unrelated\`), then continue. Scope discipline > fixing adjacent bugs you spot during validation. The reviewer/operator will decide whether to triage the unrelated failure separately.

For each task, write tasks/<id>/handoff.md using the template. The Validation Outcomes table must have no Fail results EXCEPT for unrelated-flake rows clearly labeled in the Notes column.
Append to tasks/<id>/notes.md for any surprising codebase behavior (prefix: [implement]).

When done, run:
${phaseCommands(taskIds, 'implement', 'done')}`;
}

function promptImplementRevisions(state: PipelineState): string {
    const { tasks } = state;
    const stateHeader = buildImplementStateHeader(state, 'revision');
    // Iteration number for this revision pass (round 2 = iteration 2 = first revision).
    // Bundle uses the max iteration across tasks so the marker matches whichever task drove the round.
    const iterationN = tasks.reduce((m, t) => Math.max(m, t.iterations), 0) + 1;
    const priorRound = iterationN - 1;

    const reviewLines = tasks.map(t =>
        `- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` (most recent \`## Round ${priorRound}\` section only — earlier rounds are already addressed)`
    ).join('\n');

    return `[ITERATION ${iterationN} — addressing code review round ${priorRound}]

${stateHeader}
${CODEX_STARTUP}

Your prior iteration shipped; the reviewer (Claude) appended findings to \`review.md\` as \`## Round ${priorRound}\`. If you're resuming the prior session, the full task framing (spec, plan, repo conventions) is already in context — skip the re-read. If your context is cold, re-read \`tasks/<id>/spec.md\` and \`tasks/<id>/plan.md\` before addressing findings.

Tasks with new review feedback:
${reviewLines}

For each task:
1. Read the most recent \`## Round ${priorRound}\` section of \`tasks/<id>/review.md\`. That is the entire scope of this iteration.
2. Address every \`correctness bug\`, \`risk/guardrail\`, and \`spec gap\` finding from that round (blocking). \`optional cleanup/nit\` is at your discretion${iterationN >= 3 ? ' (note: round ' + iterationN + ' is tightening — prefer to defer nits)' : ''}.
3. Re-run only the validation checks affected by your changes (typically lint, type-check, plus whatever the diff touches).
4. **APPEND** to \`tasks/<id>/handoff.md\` a new section \`## Iteration ${iterationN} — addressing review round ${priorRound}\` (the template's "On revision rounds" comment shows the shape). Do NOT rewrite the file from scratch — earlier iterations stay as the cumulative record. Include only the delta: findings addressed, AC deltas, re-run validation results.

Spec ACs remain binding. If the review identifies a dropped AC, restore it.
Append to \`tasks/<id>/notes.md\` for new pitfalls found (prefix: \`[implement-revision]\`).

When done, run:
${phaseCommands(tasks.map(t => t.taskId), 'implement', 'done')}`;
}

function promptImplementReroute(state: PipelineState): string {
    const { tasks } = state;
    const stateHeader = buildImplementStateHeader(state, 'reroute');
    const contextBlock = buildContextBlock(tasks.map(t => t.taskId));
    const pitfallsBlock = buildKnownPitfalls();
    const risksBlock = buildKnownRisks(tasks.map(t => t.taskId));

    // Max reroute count across the bundle. rerouteCount=1 means first reroute (round 2
    // of human review overall — round 1 was the original implementation). rerouteCount=2
    // means second reroute (round 3 of human review), etc.
    const maxReroute = tasks.reduce((m, t) => Math.max(m, t.rerouteCount), 0);
    const roundNum = maxReroute + 1; // 2 on first reroute, 3 on second, etc.
    const priorReroutes = maxReroute - 1; // 0 on first reroute, 1 on second, etc.
    const roundBanner = maxReroute >= 2
        ? `⚠️  **THIS IS ROUND ${roundNum} OF HUMAN REVIEW — REROUTE #${maxReroute}.** You have already been sent back ${priorReroutes} time${priorReroutes === 1 ? '' : 's'} before this one. This prompt is **not** a duplicate of the previous reroute you already addressed — the human has provided **new** feedback beyond what you fixed in reroute #${priorReroutes}. If your session memory says "I just finished this," that memory is from the PRIOR round. The spec has additional amendments since then. If your handoff.md references "round ${priorReroutes + 1}" or earlier, it is out-of-date — the current round is ${roundNum}.\n\n`
        : `**This is round 2 of human review — the first reroute for this task.** The human has reviewed your original implementation and sent it back with feedback that requires spec amendments.\n\n`;

    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" (reroute #${t.rerouteCount}) — the spec was amended after human review. Read tasks/${t.taskId}/spec.md carefully (look for "Amendment", "Round N", "Follow-up", "Revision Notes", or similar sections that were added since your last handoff). Your previous handoff is at tasks/${t.taskId}/handoff.md.`
    ).join('\n');

    return `You are addressing **human-review feedback** on ${tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`} for ${config.projectName}.

${stateHeader}
${roundBanner}A human reviewed your previous implementation and sent it back with additional feedback. The spec has been updated in place — new ACs, new sections, or revised requirements have been added since you last read it. This is **not** a resume of an interrupted session: your previous work shipped, the human tried it, and now there's more to do.

${CODEX_STARTUP}
${risksBlock}${pitfallsBlock}${contextBlock}
Tasks with amended specs:
${taskLines}

Grounding rule: re-open the amended spec and the current handoff before changing anything. Session memory is stale by design on reroute rounds.

**How to approach this:**
1. Read tasks/<id>/spec.md top-to-bottom. Scan for any section added after the original spec (e.g. "Amendment", "Round N", "Follow-up", "Post-review"). Those are the new requirements.
2. Read tasks/<id>/handoff.md to understand what you previously shipped. Do NOT assume the handoff covers the amendment — it was written before the amendment existed.
3. Identify the delta: which ACs are new, which changed, which were already addressed by the previous implementation.
4. Implement the delta. Previously-correct work stays; only change what the amendment requires. If the amendment conflicts with a prior AC, the amendment wins.
5. Re-run ALL applicable validation checks (lint, type-check, test, build, e2e as applicable per the spec's Validation Required). Required checks must be recorded as Pass or Fail; do not mark a required check N/A.
6. **Rewrite handoff.md** to reflect the complete current state of the implementation — including the round-1 work that still applies plus the new amendment work. The reviewer reads handoff.md as the single source of truth, not your prior session's context.

**Spec ACs are binding** — including both original ACs and amendment ACs. If you think an amendment AC is infeasible as written, document it under Blockers in handoff.md. Do not silently drop any AC.

Append to tasks/<id>/notes.md for any surprising behavior found while re-reading the codebase (prefix: [implement-reroute]).

When done, run:
${phaseCommands(tasks.map(t => t.taskId), 'implement', 'done')}`;
}

function promptCodeReview(state: PipelineState): string {
    const { tasks } = state;
    const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
    const baseBranch = getBaseBranch(tasks.map(t => t.taskId));

    // Round 2+: resumed Claude session — slim re-review prompt that targets
    // the new handoff iteration only. Skip the Stage 1 AC table (the round-1
    // gate already passed) and re-stating the full review framing (the
    // session has it).
    if (maxIter > 0) {
        const roundN = maxIter + 1;
        const priorIteration = maxIter;
        const taskLines = tasks.map(t =>
            `- \`${t.taskId}\` → read the \`## Iteration ${priorIteration} — addressing review round ${maxIter}\` section of \`tasks/${t.taskId}/handoff.md\``
        ).join('\n');
        const tightenLine = roundN >= 3
            ? `\n**Round ${roundN} discipline.** This is round ${roundN}+. Findings must be \`correctness bug\` or \`spec gap\` only — NO \`optional cleanup/nit\` and no wording-only changes. We are tightening, not exploring. If your only finding is a wording preference, approve.\n`
            : '';

        return `[REVIEW ROUND ${roundN} — verifying iteration ${priorIteration}'s response to round ${maxIter} findings]

Codex appended \`## Iteration ${priorIteration}\` to \`handoff.md\` addressing your prior round's findings. If you're resuming the prior review session, the full task framing (spec, prior review history, repo conventions) is already in context — skip the re-read. If your context is cold, re-read \`tasks/<id>/spec.md\` and the earlier \`## Round\` sections of \`tasks/<id>/review.md\` before verifying the new iteration.

Tasks to re-review:
${taskLines}
${tightenLine}
For each task:
1. Read the \`## Iteration ${priorIteration}\` section of \`tasks/<id>/handoff.md\` — that's the diff under review this round.
2. Read the actual code diff since your prior review: \`git diff ${baseBranch}...HEAD -- <files-from-iteration-${priorIteration}>\` (or read the changed files directly). Do not trust handoff claims that are not visible in the diff.
3. For each finding in your prior \`## Round ${maxIter}\` section of \`review.md\`, verify whether iteration ${priorIteration} addressed it. **Do NOT redo the Stage 1 AC table** — that gate already passed in round 1.
4. **APPEND** \`## Round ${roundN} — verifying iteration ${priorIteration}'s response to round ${maxIter}\` to \`review.md\` (the template's "On re-review" comment shows the shape). Do not rewrite earlier rounds. Include only:
   - Per-finding verification (addressed / still open / no longer relevant)
   - NEW findings introduced by iteration ${priorIteration}'s changes — don't re-litigate decisions from earlier rounds
   - Verdict for this round

Set verdict per task: \`approved\`, \`approved_with_nits\`, \`changes_requested\`, or \`needs_re_review\`.

When done, run (one per task with actual verdict):
${phaseCommands(tasks.map(t => t.taskId), 'code_review', 'done', '<verdict>')}`;
    }

    // Round 1: full review framing.
    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: read tasks/${t.taskId}/handoff.md and cross-reference tasks/${t.taskId}/spec.md ACs`
    ).join('\n');

    return `You are reviewing implementation for ${tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`} for ${config.projectName}.

${CLAUDE_STARTUP}

Tasks to review:
${taskLines}

Grounding rule: inspect the current diff and changed files before you trust any statement in handoff.md. If a claim is not visible in the current artifact, treat it as unverified.

**Read in this order: spec.md → handoff.md → diff.** Do not read handoff.md first — Codex's explanation of what it did will anchor your review before you've formed an independent read of the requirements. Let the spec set the frame, then check whether the handoff and diff match it.

Read the actual diff: \`git diff ${baseBranch}...HEAD\` (or read the changed files directly).
${tasks.length > 1 ? 'Also check for cross-task interactions — unintended coupling or conflicts between tasks.\n' : ''}
**Validation gate**: verify each handoff.md Validation Outcomes table has no Fail results and all applicable checks were run.
Treat a required check marked N/A as a failure of the handoff.

**On plan deviations**: Codex may deviate from plan.md if the deviation is documented with justification in handoff.md. Treat documented deviations as design decisions to evaluate — not automatic violations. Ask: is the AC still met? Is the approach sound?

**Always flag**: dropped or partially-met ACs, undocumented behavior changes, skipped or failed validation checks.

**Citation grounding**: If the PR body's External API section shows a "⚠️ docs-check will flag" warning, the handoff missed one or more citations — flag as \`correctness bug\` and list the packages. For each row in the handoff's \`## Documentation Citations\` table, check whether the package is in \`.agent/docs-map.json\`:
- **Not in the map** (new to the codebase): the \`API cited\` cell MUST contain a real method signature, option name, or named export — not placeholders like "TODO" or "see docs." Verify the cited string actually appears in the diff. A missing or fabricated \`API cited\` cell for a new package is a \`risk/guardrail\` finding — the gate exists to force doc-reading, and an empty cell suggests memory-based implementation.
- **In the map**: \`API cited\` is optional. URL + Section/API is enough unless the usage is unusual.

For each task, write tasks/<id>/review.md. Label every finding: \`correctness bug\`, \`risk/guardrail\`, \`optional cleanup/nit\`, or \`spec gap\` (something ambiguous or missing in the spec that caused Codex to guess — flag it so the spec template can improve). On re-review (round 2+), append a \`## Round N\` section rather than rewriting — the template's "On re-review" comment shows the shape.
${tasks.length > 1 ? 'Note cross-task observations in the relevant review.md file.\n' : ''}
Set verdict per task: approved, approved_with_nits, changes_requested, or needs_re_review.

When done, run (one per task with actual verdict):
${phaseCommands(tasks.map(t => t.taskId), 'code_review', 'done', '<verdict>')}`;
}

function promptQa(state: PipelineState): string {
    const { tasks, isBundle } = state;

    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/`
    ).join('\n');

    return `You are writing QA summaries for ${tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`} for ${config.projectName}.

${QA_STARTUP}

Tasks:
${taskLines}

For each task:
1. **Use the Write tool** to create tasks/<id>/done.md — plain-English summary for the human. Include: what changed, files changed, how to test, test results, decisions made, open questions.
   ⚠️ CRITICAL: Use the \`Write\` tool — do NOT simply output the done.md content as text in your response. Content in your chat reply does not get saved to disk. The pipeline validates that done.md contains real content (not the template) before advancing. Write the file.
2. Include a **Proposed Changelog** section in done.md:
   - Read AGENTS.md §"Release Rules" for the project's changelog audience and SemVer interpretation before writing. Apply the project's defined scope.
   - If CHANGELOG.md exists, read the top of it (the most recent version section) to calibrate on scope and voice.
   - Apply the "would a user notice" test to every candidate bullet (or the project's equivalent scope test): if a candidate falls outside the project's defined changelog scope, omit it. If a task is entirely out of scope, say so explicitly ("no user-facing change — omit from changelog") rather than inventing a bullet.
   - Implementation mechanics belong in the "What Changed" section above — not in the proposed changelog.
   - Proposed version bump per the project's SemVer interpretation, with brief rationale.
   The human finalizes both.

After writing all done.md files:
- Read tasks/<id>/notes.md for each task. For each insight, ask: "would this have changed how a *different* task was approached?" Only write to docs/lessons-learned.md if yes. Task-specific details stay in notes.md only.
- Append one row per task to docs/task-quality-log.md (see that file for column definitions).
- **Docs freshness**: scan the protected docs in AGENTS.md (architecture.md, codebase-map.md, patterns.md, product-context.md, decisions.md) for anything contradicted by ${isBundle ? 'these tasks' : 'this task'}. Update stale references if found.
- **Lessons sweep** (periodic — not every task): scan docs/lessons-learned.md. For each entry: promote durable truths to the right permanent doc (patterns.md / decisions.md / AGENTS.md), OR prune entries that turned out to be task-specific after all (just delete them — the detail lives in the task's notes.md). Leave a tombstone only for promoted entries. Do this when lessons-learned exceeds ~15 entries or at the end of a release milestone.

When done, run (use the Bash tool — do not just output the command as text):
${phaseCommands(tasks.map(t => t.taskId), 'qa', 'done')}`;
}

// ── runClaude / runCodex ───────────────────────────────────────────────────

type StreamResult = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    spawnError: Error | null;
    stalled: boolean;
    capturedStdout: string;
    capturedStderr: string;
};

/**
 * Spawn a child process with live stdout/stderr streaming, line-by-line
 * parsing, and idle-stall detection. Replaces the spawnSync calls inside
 * runClaude/runCodex so we get:
 *
 *   - live progress signal (each parsed event ticks the stall timer)
 *   - hung-process recovery (SIGTERM → SIGKILL after STALL_TIMEOUT_MS of silence)
 *   - the same captured stdout/stderr the post-exit parsers expect
 *
 * `onLine` is called for every non-empty stdout line (whether it parses as
 * JSON or not — the caller decides). `onStderrChunk` lets the caller mirror
 * stderr live AND buffer it for post-exit pattern checks (resume-not-found).
 *
 * Resolves cleanly even when the child exits non-zero or is killed by the
 * stall watchdog — the caller inspects the StreamResult.
 */
function streamProcess(
    command: string,
    args: string[],
    options: {
        cwd: string;
        label: string; // e.g. 'Claude' / 'Codex' — for stall warning messages
        onLine: (line: string) => void;
        onStderrChunk?: (chunk: string) => void;
        stallTimeoutMs?: number;
    },
): Promise<StreamResult> {
    return new Promise((resolve) => {
        const stallMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS;
        let stalled = false;
        let closed = false; // set true when the child's `close` event fires
        let stallTimer: NodeJS.Timeout | null = null;
        let killTimer: NodeJS.Timeout | null = null;
        const capturedStdout: string[] = [];
        const capturedStderr: string[] = [];

        const child = spawn(command, args, {
            cwd: options.cwd,
            stdio: ['inherit', 'pipe', 'pipe'],
        });

        const resetStallTimer = (): void => {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
                stalled = true;
                warn(`${options.label} stalled — no output for ${Math.round(stallMs / 1000)}s. Sending SIGTERM.`);
                try { child.kill('SIGTERM'); } catch { /* already dead */ }
                // `child.killed` flips true the moment kill() is called, so we
                // can't use it to tell whether the child actually exited.
                // Track close-fired locally instead — if the child ignored
                // SIGTERM, follow up with SIGKILL after the grace window.
                killTimer = setTimeout(() => {
                    if (!closed) {
                        warn(`${options.label} did not exit after SIGTERM — sending SIGKILL.`);
                        try { child.kill('SIGKILL'); } catch { /* already dead */ }
                    }
                }, STALL_KILL_GRACE_MS);
            }, stallMs);
        };

        if (child.stdout) {
            const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
            rl.on('line', (line) => {
                resetStallTimer();
                capturedStdout.push(line);
                if (line.trim()) {
                    try { options.onLine(line); } catch { /* parsing errors must not kill the stream */ }
                }
            });
        }

        if (child.stderr) {
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: string) => {
                resetStallTimer();
                capturedStderr.push(chunk);
                if (options.onStderrChunk) {
                    try { options.onStderrChunk(chunk); } catch { /* same */ }
                } else {
                    process.stderr.write(chunk);
                }
            });
        }

        child.on('error', (err) => {
            if (stallTimer) clearTimeout(stallTimer);
            if (killTimer) clearTimeout(killTimer);
            resolve({
                exitCode: null,
                signal: null,
                spawnError: err,
                stalled,
                capturedStdout: capturedStdout.join('\n'),
                capturedStderr: capturedStderr.join(''),
            });
        });

        child.on('close', (code, signal) => {
            closed = true;
            if (stallTimer) clearTimeout(stallTimer);
            if (killTimer) clearTimeout(killTimer);
            resolve({
                exitCode: code,
                signal,
                spawnError: null,
                stalled,
                capturedStdout: capturedStdout.join('\n'),
                capturedStderr: capturedStderr.join(''),
            });
        });

        resetStallTimer();
    });
}

/**
 * Render a one-line live tick for an incoming agent event. Keeps the user's
 * terminal showing forward progress without dumping full JSON. Returns the
 * formatted message or null if the event isn't display-worthy.
 */
function formatLiveTick(event: Record<string, unknown>): string | null {
    const type = event.type;
    // Codex shapes
    if (type === 'thread.started') return `  → session started`;
    if (type === 'turn.started') return `  → turn started`;
    if (type === 'turn.completed') return `  ← turn completed`;
    if (type === 'item.started' || type === 'item.completed') {
        const item = (event.item ?? {}) as { type?: string; name?: string };
        if (item.type === 'tool_call' || item.type === 'function_call') {
            return `  ${type === 'item.started' ? '→' : '←'} ${item.name ?? 'tool'}`;
        }
    }
    // Claude stream-json shapes
    if (type === 'system') {
        const subtype = (event as { subtype?: string }).subtype;
        if (subtype === 'init') return `  → claude session init`;
    }
    if (type === 'assistant') {
        const message = (event as { message?: { content?: Array<{ type?: string; name?: string }> } }).message;
        const blocks = message?.content ?? [];
        for (const b of blocks) {
            if (b.type === 'tool_use' && b.name) return `  → ${b.name}`;
        }
    }
    if (type === 'user') {
        const message = (event as { message?: { content?: Array<{ type?: string }> } }).message;
        const blocks = message?.content ?? [];
        if (blocks.some(b => b.type === 'tool_result')) return `  ← tool result`;
    }
    return null;
}

// Claude CLI prints this to stdout (exit 0) when --resume points at a session
// it can no longer find — sessions get pruned after long usage-limit gaps,
// across machines, or when the projects dir is rotated. Detecting the exact
// string lets us recover automatically with a fresh session instead of
// leaving the phase silently empty.
const CLAUDE_RESUME_NOT_FOUND_RE = /No conversation found with session ID/i;

async function runClaude(
    prompt: string,
    interactive: boolean,
    resumeId: string | null,
    model: string,
    effort: string,
    metricsContext?: { taskId: string; phase: string; iteration?: number },
    cwd = REPO_ROOT,
): Promise<void> {
    info(resumeId ? `Calling Claude Code (resuming ${resumeId.slice(0, 8)}...)...` : 'Calling Claude Code...');
    info(`Model: ${model} | Effort: ${effort}`);

    // Reset module state up front so a prior phase's stdout/session ID can
    // never leak into this call. In particular: the interactive branch
    // returns without populating lastClaudeSessionId, so leaving the reset
    // below the branch would let post-phase storage write a stale ID from
    // an earlier non-interactive Claude phase.
    lastClaudeStdout = '';
    lastClaudeSessionId = null;

    const startMs = Date.now();
    let status: 'ok' | 'failed' = 'ok';

    if (interactive) {
        console.log('');
        console.log(resumeId ? '─── Resuming interactive Claude session ───' : '─── Opening interactive Claude session ───');
        console.log("Prompt loaded. You're in the driver's seat.");
        console.log('───────────────────────────────────────────');
        console.log('');
        const args = ['--model', model, '--effort', effort, '--add-dir', REPO_ROOT];
        if (cwd !== REPO_ROOT) args.push('--add-dir', cwd);
        if (resumeId) args.push('--resume', resumeId);
        args.push(resumeId ? toResumePrompt(prompt) : prompt);
        try {
            runCommandOrDie('claude', args, { cwd });
        } catch (err) {
            status = 'failed';
            throw err;
        } finally {
            if (metricsContext) recordMetric({ ...metricsContext, agent: 'claude', model, durationMs: Date.now() - startMs, status });
        }
        return;
    }

    // Non-interactive: stream-json emits NDJSON events as the agent runs.
    // We parse line-by-line for live progress ticks + stall detection,
    // then capture the final `result` event for tokens/session_id/text.
    // Salvage path: if the agent streams text via assistant events but never
    // emits a `result` envelope (Haiku QA regression, 2026-04-18), we
    // assemble lastClaudeStdout from the accumulated assistant text instead.
    let tokens: number | undefined;

    const attempt = async (useResumeId: string | null): Promise<{ resumeNotFound: boolean }> => {
        const effectivePrompt = useResumeId ? toResumePrompt(prompt) : prompt;
        const args = [
            '-p', effectivePrompt,
            '--model', model,
            '--effort', effort,
            '--add-dir', REPO_ROOT,
            '--max-budget-usd', config.claudeBudget,
            '--dangerously-skip-permissions',
            '--output-format', 'stream-json',
            '--verbose', // required when -p is combined with stream-json
        ];
        if (cwd !== REPO_ROOT) args.push('--add-dir', cwd);
        if (useResumeId) args.push('--resume', useResumeId);

        type ClaudeUsage = {
            input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            output_tokens?: number;
        };
        // Wrapped in a single object so the closure mutation survives
        // TypeScript's control-flow narrowing — `let` bindings narrow to
        // their initialized type after a closure call, which would
        // collapse `null` to `never` for downstream reads.
        const captured: { text: string | null; sessionId: string | null; usage: ClaudeUsage | null } = {
            text: null,
            sessionId: null,
            usage: null,
        };
        const assistantTextChunks: string[] = [];

        const onLine = (line: string): void => {
            let event: Record<string, unknown>;
            try { event = JSON.parse(line); } catch { return; }
            const tick = formatLiveTick(event);
            if (tick) console.log(tick);
            if (event.type === 'assistant') {
                const message = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
                for (const block of message?.content ?? []) {
                    if (block.type === 'text' && block.text) assistantTextChunks.push(block.text);
                }
            }
            if (event.type === 'result') {
                captured.text = (event.result as string | undefined) ?? null;
                captured.sessionId = (event.session_id as string | undefined) ?? null;
                captured.usage = (event.usage as ClaudeUsage | undefined) ?? null;
            }
        };

        const result = await streamProcess('claude', args, {
            cwd,
            label: 'Claude',
            onLine,
        });

        // Detect stale-resume failure first, BEFORE any other handling
        // — the recovery path is the actionable signal.
        if (useResumeId && CLAUDE_RESUME_NOT_FOUND_RE.test(result.capturedStderr + result.capturedStdout)) {
            lastClaudeStdout = '';
            return { resumeNotFound: true };
        }

        if (captured.usage) {
            tokens =
                (captured.usage.input_tokens ?? 0) +
                (captured.usage.cache_creation_input_tokens ?? 0) +
                (captured.usage.cache_read_input_tokens ?? 0) +
                (captured.usage.output_tokens ?? 0);
            if (tokens === 0) tokens = undefined;
        }
        if (captured.text !== null) {
            lastClaudeStdout = captured.text;
        } else if (assistantTextChunks.length > 0) {
            // Salvage: no formal result envelope, but assistant events were emitted.
            warn('Claude did not emit a final result event — using accumulated assistant text.');
            lastClaudeStdout = assistantTextChunks.join('\n');
        } else {
            // Both empty — surface raw stdout so failures are diagnosable.
            lastClaudeStdout = result.capturedStdout;
        }
        if (captured.sessionId) {
            lastClaudeSessionId = captured.sessionId;
        } else {
            // Final fallback: scan captured stdout for a session_id field.
            // Stream-json result events should always carry one, but if the
            // result event was missing we can still salvage continuity.
            const sidMatch = result.capturedStdout.match(/"session_id"\s*:\s*"([0-9a-f-]{36})"/i);
            if (sidMatch) lastClaudeSessionId = sidMatch[1];
        }

        // Mirror final result text to parent stdout so backgrounded runs and
        // captured logs both surface what the agent actually said. Live ticks
        // already showed tool activity; this is the human-readable summary.
        if (lastClaudeStdout) process.stdout.write(lastClaudeStdout);

        // Exit handling. Stalled runs are treated as failures regardless of
        // exit code (the watchdog SIGKILL'd the child mid-stream).
        if (result.spawnError) { console.error(result.spawnError.message); status = 'failed'; process.exit(1); }
        if (result.stalled) { status = 'failed'; process.exit(1); }
        if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
            status = 'failed';
            process.exit(result.exitCode);
        }
        if (result.signal) { status = 'failed'; process.exit(1); }

        return { resumeNotFound: false };
    };

    try {
        const first = await attempt(resumeId);
        if (first.resumeNotFound && resumeId) {
            warn(`Claude session ${resumeId.slice(0, 8)}... was not found — falling back to a fresh session. (Stale ID will be overwritten by post-phase session discovery.)`);
            await attempt(null);
        }
    } catch (err) {
        status = 'failed';
        throw err;
    } finally {
        if (metricsContext) recordMetric({ ...metricsContext, agent: 'claude', model, durationMs: Date.now() - startMs, status, tokens });
    }
}

async function runCodex(
    prompt: string,
    interactive: boolean,
    resumeId: string | null,
    model: string,
    effort: string,
    metricsContext?: { taskId: string; phase: string; iteration?: number },
    cwd = REPO_ROOT,
): Promise<void> {
    const effectivePrompt = resumeId ? toResumePrompt(prompt) : prompt;
    info(resumeId ? `Calling Codex (resuming ${resumeId.slice(0, 8)}...)...` : 'Calling Codex...');
    info(`Model: ${model} | Effort: ${effort}`);

    const startMs = Date.now();
    let status: 'ok' | 'failed' = 'ok';
    let tokens: number | undefined;

    if (interactive) {
        console.log('');
        console.log(resumeId ? '─── Resuming interactive Codex session ───' : '─── Opening interactive Codex session ───');
        console.log("Prompt loaded. You're in the driver's seat.");
        console.log('───────────────────────────────────────────');
        console.log('');
        try {
            runCommandOrDie('codex', ['-m', model, '-C', cwd, effectivePrompt], { cwd });
        } catch (err) {
            status = 'failed';
            throw err;
        } finally {
            if (metricsContext) recordMetric({ ...metricsContext, agent: 'codex', model, durationMs: Date.now() - startMs, status, tokens });
        }
        return;
    }

    // Non-interactive: --json emits NDJSON events. Stream them line-by-line
    // for live progress + stall detection, then assemble the final summary
    // from accumulated agent_message text. Malformed lines (startup
    // banners, blank lines) are skipped silently.
    const effortFlag = ['-c', `model_reasoning_effort=${effort}`];
    // --sandbox is only supported on fresh sessions; exec resume inherits the session's sandbox mode.
    const sandboxFlags = resumeId ? [] : ['--sandbox', 'workspace-write', '-c', 'sandbox_permissions=["disk-full-read-access"]'];
    const args = resumeId
        ? ['exec', 'resume', resumeId, '--json', ...effortFlag, effectivePrompt, '-m', model]
        : ['exec', '--json', ...effortFlag, ...sandboxFlags, effectivePrompt, '-m', model, '-C', cwd];

    try {
        const displayChunks: string[] = [];
        let tokenTotal = 0;
        let sawUsage = false;

        const onLine = (line: string): void => {
            let event: {
                type?: string;
                thread_id?: string;
                item?: { type?: string; text?: string; name?: string };
                usage?: { input_tokens?: number; output_tokens?: number };
            };
            try { event = JSON.parse(line); } catch { return; }
            const tick = formatLiveTick(event as Record<string, unknown>);
            if (tick) console.log(tick);
            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
                lastCodexSessionId = event.thread_id;
            } else if (event.type === 'turn.completed' && event.usage) {
                tokenTotal += (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
                sawUsage = true;
            } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
                displayChunks.push(event.item.text);
            }
        };

        const result = await streamProcess('codex', args, {
            cwd,
            label: 'Codex',
            onLine,
        });

        if (sawUsage) tokens = tokenTotal;
        // Mirror assembled assistant messages to stdout so users (and
        // captured logs) can see Codex's narrative without parsing the
        // JSONL by hand.
        if (displayChunks.length > 0) {
            process.stdout.write(`${displayChunks.join('\n\n')}\n`);
        }

        // Hard errors: spawn failure, stall watchdog, or signal kill.
        if (result.spawnError) { console.error(result.spawnError.message); status = 'failed'; process.exit(1); }
        if (result.stalled) { status = 'failed'; process.exit(1); }
        if (result.signal) { status = 'failed'; process.exit(1); }

        // Non-zero exit may be from MCP server warnings unrelated to task completion.
        // Store and let checkAndRoute validate by reading status.json.
        lastCodexExitStatus = result.exitCode ?? 0;
        if (lastCodexExitStatus !== 0) {
            status = 'failed';
            warn(`Codex exited with status ${lastCodexExitStatus} — will verify phase completion via status.json.`);
        }
    } catch (err) {
        status = 'failed';
        throw err;
    } finally {
        if (metricsContext) recordMetric({ ...metricsContext, agent: 'codex', model, durationMs: Date.now() - startMs, status, tokens });
    }
}

// ── task.sh helper ─────────────────────────────────────────────────────────

/** Worktree-aware phase transition: uses the worktree CWD when active, REPO_ROOT otherwise. */
function runTaskShFor(taskId: string, ...args: string[]): void {
    runCommandOrDie('bash', [TASK_SH, ...args], { cwd: resolveTaskCwd(taskId) });
}

// ── Phase status helpers ───────────────────────────────────────────────────

function getCurrentPhase(status: StatusJson): CurrentPhase {
    // Always derive from phases — never trust the top-level pointer on its own.
    // A stale top-level value (e.g. from a hand-edited status.json or an older
    // task.sh run) would otherwise silently route to the wrong phase.
    return deriveTopLevelStatus(status);
}

function getPhaseStatus(status: StatusJson, phase: Phase): PhaseStatus {
    return status.phases[phase]?.status ?? 'pending';
}

function getVerdict(status: StatusJson, phase: 'spec_review' | 'code_review'): Verdict {
    return status.phases[phase]?.verdict ?? '';
}

function getIterations(status: StatusJson): number {
    return status.phases.code_review?.iterations ?? 0;
}

function getPhaseIterations(status: StatusJson, phase: 'spec_review' | 'code_review'): number {
    return status.phases[phase]?.iterations ?? 0;
}

// Auto-block a phase and append an escalation. Used when a review phase has
// looped past the configured iteration limit — the pipeline stops auto-advancing
// so a human can decide whether the repeated pushback means the spec or the
// implementation has a structural issue that another mechanical revision won't fix.
function autoBlockPhase(
    taskIds: string[],
    phase: Phase,
    iterationCount: number,
    reason: string,
): void {
    const today = new Date().toISOString().slice(0, 10);
    for (const taskId of taskIds) {
        const status = readStatus(taskId);
        const phaseEntry = status.phases[phase];
        if (phaseEntry) phaseEntry.status = 'blocked';
        status.escalations = status.escalations ?? [];
        status.escalations.push({ date: today, phase, iteration_count: iterationCount, reason });
        status.updated = today;
        writeStatus(taskId, status);
    }
}

function getTitle(status: StatusJson): string {
    return status.title ?? '(untitled)';
}

// ── Pipeline state builder ─────────────────────────────────────────────────

function buildPipelineState(taskIds: string[]): PipelineState {
    const statuses = taskIds.map(readStatus);
    const tier = detectTier(statuses);
    const tasks: TaskContext[] = taskIds.map((taskId, i) => ({
        taskId,
        title: getTitle(statuses[i]),
        specReviewVerdict: getVerdict(statuses[i], 'spec_review'),
        iterations: getIterations(statuses[i]),
        rerouteCount: statuses[i].phases.implement?.reroute_count ?? 0,
        status: statuses[i],
    }));
    return { tasks, tier, isBundle: taskIds.length > 1 };
}

// ── Phase assertion ────────────────────────────────────────────────────────

function assertSamePhase(taskIds: string[]): CurrentPhase {
    const phases = taskIds.map(id => getCurrentPhase(readStatus(id)));
    const unique = new Set(phases);
    if (unique.size > 1) {
        die(
            `Bundle tasks are at different phases — cannot proceed.\n` +
            taskIds.map((id, i) => `  ${id}: ${phases[i]}`).join('\n') +
            `\n  Resolve manually then re-run.`
        );
    }
    return phases[0];
}

// ── Auto-commit helpers ────────────────────────────────────────────────────

function extractSection(filePath: string, heading: string): string | null {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const regex = new RegExp(`## ${escapeRegExp(heading)}\\n\\n([\\s\\S]*?)(?=\\n## |$)`);
        const match = content.match(regex);
        return match?.[1]?.trim() || null;
    } catch {
        return null;
    }
}

function replaceMarkdownSection(content: string, heading: string, replacement: string): string {
    const regex = new RegExp(`(## ${escapeRegExp(heading)}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`);
    if (!regex.test(content)) return content;
    return content.replace(regex, `$1${replacement.trim()}\n\n`);
}

type PorcelainEntry = {
    raw: string;
    indexStatus: string;
    worktreeStatus: string;
    paths: string[];
};

function stripPorcelainQuotes(filePath: string): string {
    return filePath.replace(/^"|"$/g, '');
}

// Parse `git status --porcelain` output into status entries. Must
// be fed the `-uall` variant so new directories are expanded into individual
// file entries rather than collapsed to a single `?? dir/` line.
//
// NOTE: do not `trim()` the whole output first — the modified-worktree status
// is ` M filename` (leading space), and a whole-string trim would strip that
// space, shifting `slice(3)` by one and producing corrupt paths.
export function parsePorcelainEntries(output: string): PorcelainEntry[] {
    return output.split('\n').filter(line => line.length >= 3).flatMap(line => {
        if (!line.trim()) return [];
        if (line[2] !== ' ') {
            throw new Error(`Malformed git porcelain line. Preserve leading whitespace before parsing: ${JSON.stringify(line)}`);
        }
        const raw = line.slice(3).trim();
        if (!raw) return [];
        const paths = raw.includes(' -> ')
            ? raw.split(' -> ').map(stripPorcelainQuotes)
            : [stripPorcelainQuotes(raw)];
        return [{
            raw: line,
            indexStatus: line[0],
            worktreeStatus: line[1],
            paths,
        }];
    });
}

// Parse `git status --porcelain` output into a set of dirty file paths.
export function parsePorcelain(output: string): Set<string> {
    return new Set(parsePorcelainEntries(output).flatMap(entry => entry.paths));
}

function autoCommitAllowedSourceBypass(filePath: string): boolean {
    if (filePath.startsWith('tasks/')) return true;
    return (PIPELINE_TELEMETRY_FILES as readonly string[]).includes(filePath);
}

function toFileSet(files: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
    return files instanceof Set ? files : new Set(files);
}

export function findUncoveredTrackedChanges(
    statusOutput: string,
    handoffFiles: ReadonlySet<string> | readonly string[],
): string[] {
    const allowed = toFileSet(handoffFiles);
    return parsePorcelainEntries(statusOutput)
        .filter(entry => {
            const untrackedOnly = entry.indexStatus === '?' && entry.worktreeStatus === '?';
            if (untrackedOnly) return false;
            return entry.paths.some(filePath => !allowed.has(filePath) && !autoCommitAllowedSourceBypass(filePath));
        })
        .map(entry => entry.raw);
}

export function findStagedFilesOutsideHandoff(
    stagedNameOnlyOutput: string,
    handoffFiles: ReadonlySet<string> | readonly string[],
): string[] {
    const allowed = toFileSet(handoffFiles);
    return stagedNameOnlyOutput
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(filePath => !allowed.has(filePath));
}

// Sentinel strings that appear ONLY in the unfilled tasks/_templates/done.md.
// If any of these are present, the QA sub-agent did not write real content.
// Keep in sync with tasks/_templates/done.md.
const DONE_MD_TEMPLATE_SENTINELS = [
    '[TASK-ID]',
    'One paragraph, plain English. No code jargon.',
    '`src/...` — brief note',
];

export function isDoneMdTemplate(donePath: string): boolean {
    let content: string;
    try {
        content = fs.readFileSync(donePath, 'utf8');
    } catch {
        return true; // missing counts as template (nothing written)
    }
    return DONE_MD_TEMPLATE_SENTINELS.some(s => content.includes(s));
}

// Extract the markdown portion of `claude -p` stdout. In practice the
// non-interactive CLI prints the assistant's final message text (plus a
// trailing blank line or two). Strip leading/trailing whitespace and any
// obvious CLI chrome. If the captured content doesn't look like a QA
// summary (no "# QA Summary" or "# Completion Summary" heading), return
// empty string so the caller doesn't overwrite the template with junk.
export function extractDoneMdFromStdout(stdout: string): string {
    const trimmed = stdout.trim();
    if (!trimmed) return '';
    // Heuristic: require a recognizable QA heading so we don't write random
    // stdout if claude printed diagnostics instead of a QA summary.
    if (!/^#\s+(QA Summary|Completion Summary)\b/m.test(trimmed)) return '';
    return trimmed + '\n';
}

function parseHandoffFiles(taskId: string): string[] {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    let content: string;
    try {
        content = fs.readFileSync(handoffPath, 'utf8');
    } catch {
        return [];
    }
    const files: string[] = [];
    const lines = content.split('\n');
    const tableStart = lines.findIndex(line => /^\|\s*File\s*\|/i.test(line));
    if (tableStart === -1) return [];
    for (let index = tableStart + 2; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.startsWith('|')) break;
        const match = line.match(/\|\s*`([^`]+)`/);
        if (match?.[1]) files.push(match[1]);
    }
    return files;
}

/**
 * Paths that appear in the pre-code-review diff but are not Codex-authored
 * content. The current canon-ai implementation may keep this empty.
 *
 * Keep this as the single source of truth for preflight exemptions.
 */
const HANDOFF_DIFF_EXEMPT_PATHS: ReadonlySet<string> = new Set([]);

type HandoffDiffInputs = {
    /** Single-path diff entries (M/A/D/T/U statuses from `git diff --name-status`). */
    diffFiles: readonly string[];
    /**
     * Rename (and copy) pairs from `R<score>` / `C<score>` diff lines: `[oldPath, newPath]`.
     * Treated symmetrically: a handoff entry covers a rename if it lists EITHER side, and a
     * rename entry is covered iff at least one side is in some bundle handoff (or both sides
     * are in HANDOFF_DIFF_EXEMPT_PATHS). This avoids false positives when a handoff lists the
     * pre-image (old) path of a renamed file — which `autoCommitCode()` accepts as valid —
     * because `--name-status -M` is the only diff form that surfaces the old path at all.
     */
    renamePairs?: readonly (readonly [string, string])[];
    handoffFilesByTask: ReadonlyMap<string, readonly string[]>;
};

export function verifyHandoffAgainstDiffFromData(
    taskIds: string[],
    inputs: HandoffDiffInputs,
): string[] {
    const renamePairs = inputs.renamePairs ?? [];
    // "Covered paths" = anything appearing in the diff: simple-change paths plus
    // BOTH sides of every rename pair. Used for the handoff→diff direction: a
    // handoff entry is satisfied if its path matches any covered path.
    const coveredPaths = new Set<string>(inputs.diffFiles);
    for (const [oldPath, newPath] of renamePairs) {
        coveredPaths.add(oldPath);
        coveredPaths.add(newPath);
    }

    const handoffFilesByTask = new Map<string, readonly string[]>();
    const bundleHandoffFiles = new Set<string>();

    for (const taskId of taskIds) {
        const files = inputs.handoffFilesByTask.get(taskId) ?? [];
        handoffFilesByTask.set(taskId, files);
        for (const filePath of files) bundleHandoffFiles.add(filePath);
    }

    const issues: string[] = [];

    // handoff→diff
    for (const taskId of taskIds) {
        const files = handoffFilesByTask.get(taskId) ?? [];
        for (const filePath of files) {
            if (!coveredPaths.has(filePath)) {
                issues.push(`[${taskId}] handoff→diff: ${filePath} listed in handoff but not in diff`);
            }
        }
    }

    // diff→handoff: simple entries
    for (const filePath of inputs.diffFiles) {
        if (HANDOFF_DIFF_EXEMPT_PATHS.has(filePath)) continue;
        if (bundleHandoffFiles.has(filePath)) continue;
        issues.push(`diff→handoff: ${filePath} in diff but not in any bundle handoff`);
    }

    // diff→handoff: rename pairs — covered iff either side is in handoff (or both in exempt).
    // One issue per uncovered rename, naming both paths so reviewer can disambiguate.
    for (const [oldPath, newPath] of renamePairs) {
        if (HANDOFF_DIFF_EXEMPT_PATHS.has(oldPath) && HANDOFF_DIFF_EXEMPT_PATHS.has(newPath)) continue;
        if (bundleHandoffFiles.has(oldPath) || bundleHandoffFiles.has(newPath)) continue;
        issues.push(`diff→handoff: rename ${oldPath} → ${newPath} — neither path in any bundle handoff`);
    }

    return issues;
}

/**
 * Parse `git diff --name-status -M` output into simple paths and rename pairs.
 *
 * Format per line:
 *   M\tpath              — modified
 *   A\tpath              — added
 *   D\tpath              — deleted
 *   T\tpath              — type change
 *   U\tpath              — unmerged
 *   R<score>\told\tnew   — rename (with -M)
 *   C<score>\told\tnew   — copy (with -C; we don't enable -C but accept the format)
 *
 * Why `--name-status` instead of `--name-only`: `--name-only -M` enables rename
 * *detection* but only emits the post-image (new) path, so a handoff that lists
 * the pre-image (old) path of a renamed file would false-positive on the
 * handoff→diff check. `--name-status -M` surfaces both paths in the `R` lines.
 */
function parseDiffNameStatus(stdout: string): { diffFiles: string[]; renamePairs: Array<[string, string]> } {
    const diffFiles: string[] = [];
    const renamePairs: Array<[string, string]> = [];
    for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const status = parts[0];
        if ((status.startsWith('R') || status.startsWith('C')) && parts.length >= 3) {
            renamePairs.push([parts[1], parts[2]]);
        } else if (parts.length >= 2) {
            diffFiles.push(parts[1]);
        }
    }
    return { diffFiles, renamePairs };
}

export function verifyHandoffAgainstDiff(taskIds: string[], baseRef: string): string[] {
    const cwd = getActiveCwd(taskIds);
    const diffResult = gitSafeAtRaw(cwd, 'diff', `${baseRef}...HEAD`, '--name-status', '-M');
    if (!diffResult.ok) {
        return [`git diff failed: ${diffResult.stderr || 'unknown error'}`];
    }

    const { diffFiles, renamePairs } = parseDiffNameStatus(diffResult.stdout);
    const handoffFilesByTask = new Map<string, readonly string[]>(
        taskIds.map(taskId => [taskId, parseHandoffFiles(taskId)]),
    );
    return verifyHandoffAgainstDiffFromData(taskIds, { diffFiles, renamePairs, handoffFilesByTask });
}

function appendAutoCommitDebug(taskIds: string[], details: Record<string, unknown>): void {
    const notesPath = path.join(taskDirFor(taskIds[0]), 'notes.md');
    try {
        fs.mkdirSync(path.dirname(notesPath), { recursive: true });
        fs.appendFileSync(
            notesPath,
            `\n[auto-commit-debug] ${new Date().toISOString()} ${JSON.stringify(details)}\n`,
            'utf8'
        );
    } catch {
        // Debug logging must never mask the real auto-commit result.
    }
}

function verifyHandoffFilesCommitted(
    taskIds: string[],
    cwd: string,
    handoffFiles: readonly string[],
    debug: Record<string, unknown>,
): void {
    const baseRef = getBaseBranch(taskIds);
    const postStatus = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall', '--', ...handoffFiles);
    const missing: string[] = [];

    if (!postStatus.ok) {
        Object.assign(debug, {
            baseRef,
            postCommitStatusOk: postStatus.ok,
            postCommitStatusRaw: postStatus.stdout,
            postCommitStatusError: postStatus.stderr,
        });
        appendAutoCommitDebug(taskIds, debug);
        die(`Auto-commit coverage check failed: could not inspect post-commit status: ${postStatus.stderr || 'unknown error'}`);
    }

    const stillDirty = parsePorcelain(postStatus.stdout);

    for (const filePath of handoffFiles) {
        if (stillDirty.has(filePath)) {
            missing.push(`${filePath} — still dirty after auto-commit`);
            continue;
        }
        const committed = gitSafeAt(cwd, 'log', '--format=%H', '--max-count=1', `${baseRef}..HEAD`, '--', filePath);
        if (!committed.ok || !committed.stdout.trim()) {
            missing.push(`${filePath} — no commit touches this path in ${baseRef}..HEAD`);
        }
    }

    // Belt-and-suspenders against the silent-omission case: `git diff HEAD` against
    // every handoff file. If the working tree differs from HEAD on any of them, the
    // file's current content is not in any commit — even if `git status` (above) and
    // `git log` (also above) both said it was. Both of those use the status cache;
    // `git diff HEAD` queries the merkle tree directly. Runs on EVERY return path
    // (this function is called from autoCommitCode's success path AND from every
    // early-return path), so the silent-status-omission failure mode is always caught
    // regardless of which path the auto-commit took. Surfaced 2026-05-07 via canon
    // iteration 3 of handoff-verifier; this is the canonical defense, not the
    // duplicate `git diff HEAD` check that originally lived only in autoCommitCode's
    // success path. See docs/lessons-learned.md for the incident.
    const wtDiff = gitSafeAtRaw(cwd, 'diff', 'HEAD', '--name-only', '--', ...handoffFiles);
    if (!wtDiff.ok) {
        Object.assign(debug, { wtDiffOk: false, wtDiffError: wtDiff.stderr });
        appendAutoCommitDebug(taskIds, debug);
        die(`Auto-commit coverage check failed: \`git diff HEAD\` failed: ${wtDiff.stderr || 'unknown error'}`);
    }
    if (wtDiff.stdout.trim()) {
        const stillDifferent = wtDiff.stdout.split('\n').map(s => s.trim()).filter(Boolean);
        for (const f of stillDifferent) {
            // Avoid duplicate messages if status already flagged it as still-dirty.
            if (missing.some(m => m.startsWith(`${f} —`))) continue;
            missing.push(`${f} — working tree differs from HEAD (status reported clean — silent-omission failure mode)`);
        }
    }

    Object.assign(debug, {
        baseRef,
        postCommitStatusRaw: postStatus.stdout,
        postCommitWtDiffRaw: wtDiff.stdout,
        postCommitMissingCoverage: missing,
    });

    if (missing.length > 0) {
        appendAutoCommitDebug(taskIds, debug);
        die(
            `Auto-commit coverage check failed: handoff.md lists files that are neither committed nor cleanly staged for review.\n` +
            missing.map(m => `    ${m}`).join('\n') +
            `\n  To recover: \`cd ${cwd} && git diff HEAD\` to inspect, then stage and commit the missing changes manually before code_review.`
        );
    }
}

function autoCommitCode(taskIds: string[], cwd = REPO_ROOT): void {
    const primaryStatus = readStatus(taskIds[0]);
    const title = getTitle(primaryStatus);

    const allHandoffFiles = new Set<string>();
    for (const taskId of taskIds) {
        for (const file of parseHandoffFiles(taskId)) {
            allHandoffFiles.add(file);
        }
    }

    if (allHandoffFiles.size === 0) {
        warn('No files found in handoff.md Changes tables — skipping auto-commit.');
        warn('Stage and commit manually, or ensure all handoff.md files have a Changes table.');
        return;
    }

    const handoffFiles = [...allHandoffFiles];
    const debug: Record<string, unknown> = {
        cwd,
        handoffFiles,
    };

    // `-uall` expands new directories into individual file entries. Without it,
    // `git status --porcelain` emits one `?? dir/` line per new directory, which
    // drops every file inside from the staged set (wall-textures regression,
    // 2026-04-17).
    const dirtyResult = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    Object.assign(debug, {
        dirtyStatusOk: dirtyResult.ok,
        dirtyStatusRaw: dirtyResult.stdout,
        dirtyStatusError: dirtyResult.stderr,
    });
    if (!dirtyResult.ok) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'dirty-status-failed' });
        die(`Auto-commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || 'unknown error'}`);
    }
    if (!dirtyResult.stdout.trim()) {
        verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'no-uncommitted-changes' });
        info('No uncommitted changes to auto-commit.');
        return;
    }

    const dirtyFiles = parsePorcelain(dirtyResult.stdout);
    const toStage = handoffFiles.filter(f => dirtyFiles.has(f));
    Object.assign(debug, {
        dirtyFiles: [...dirtyFiles],
        toStage,
    });

    // Verify every handoff file is accounted for. If a handoff entry isn't
    // dirty, it must either (a) exist on disk AND be tracked (= already
    // committed / clean), or (b) have already been committed in baseRef..HEAD
    // — covers files deleted or renamed in an earlier commit on this branch
    // (refactor pattern: round 1 deletes ProjectContext.tsx, round 2 review
    // fixes don't re-touch it, but handoff still lists it as a Change).
    const missing: string[] = [];
    const baseRefForLog = getBaseBranch(taskIds);
    for (const f of allHandoffFiles) {
        if (dirtyFiles.has(f)) continue;
        const exists = fs.existsSync(path.join(cwd, f));
        if (!exists) {
            // Path is absent from the working tree — accept it if a commit on
            // this branch already touched it (delete, rename, or modify-then-
            // delete-in-later-commit all show up here).
            const committed = gitSafeAt(cwd, 'log', '--format=%H', '--max-count=1', `${baseRefForLog}..HEAD`, '--', f);
            if (committed.ok && committed.stdout.trim()) continue;
            missing.push(`${f} — listed in handoff but missing from working tree (and no commit in ${baseRefForLog}..HEAD touches this path)`);
            continue;
        }
        const tracked = gitSafeAt(cwd, 'ls-files', '--error-unmatch', '--', f).ok;
        if (!tracked) {
            missing.push(`${f} — untracked on disk but git status did not report it (report this as a bug)`);
        }
    }
    if (missing.length > 0) {
        appendAutoCommitDebug(taskIds, { ...debug, missing });
        die(
            `Auto-commit aborted: handoff.md lists files that can't be staged:\n` +
            missing.map(m => `    ${m}`).join('\n') +
            `\n  Verify the files exist and fix handoff.md's Changes table, or stage manually.`
        );
    }

    const stagedBefore = gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    const stagedBeforeUnexpected = stagedBefore.ok
        ? findStagedFilesOutsideHandoff(stagedBefore.stdout, allHandoffFiles)
        : [];
    Object.assign(debug, {
        stagedBeforeOk: stagedBefore.ok,
        stagedBeforeRaw: stagedBefore.stdout,
        stagedBeforeUnexpected,
    });
    if (!stagedBefore.ok) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'staged-before-failed' });
        die(`Auto-commit aborted: failed to inspect staged files: ${stagedBefore.stderr || 'unknown error'}`);
    }
    if (stagedBeforeUnexpected.length > 0) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'preexisting-staged-outside-handoff' });
        die(
            `Auto-commit aborted: staged files are not covered by handoff.md.\n` +
            `  Staged files:\n${stagedBeforeUnexpected.map(f => `    ${f}`).join('\n')}\n` +
            `  Unstage them or list them in handoff.md before rerunning.`
        );
    }

    if (toStage.length === 0) {
        verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'already-committed-or-unchanged' });
        info('Handoff files are already committed or unchanged — skipping auto-commit.');
        return;
    }

    // Stage every handoff path, not just paths reported by `git status`. This is
    // idempotent for clean files and avoids porcelain-output or racy-status
    // omissions dropping a valid handoff file from the commit.
    const addResult = gitSafeAt(cwd, 'add', '-A', '--', ...handoffFiles);
    Object.assign(debug, {
        addOk: addResult.ok,
        addError: addResult.stderr,
    });
    if (!addResult.ok) die(`Failed to stage files: ${addResult.stderr || 'unknown error'}`);

    const preCheck = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    const remaining = preCheck.ok ? findUncoveredTrackedChanges(preCheck.stdout, allHandoffFiles) : [];
    const stagedAfter = gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    const stagedAfterUnexpected = stagedAfter.ok
        ? findStagedFilesOutsideHandoff(stagedAfter.stdout, allHandoffFiles)
        : [];
    Object.assign(debug, {
        preCheckOk: preCheck.ok,
        preCheckRaw: preCheck.stdout,
        remaining,
        stagedAfterOk: stagedAfter.ok,
        stagedAfterRaw: stagedAfter.stdout,
        stagedAfterUnexpected,
    });
    if (!preCheck.ok) {
        gitSafeAt(cwd, 'reset', 'HEAD', '--', ...handoffFiles);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'precheck-failed' });
        die(`Auto-commit aborted: failed to inspect working tree after staging: ${preCheck.stderr || 'unknown error'}`);
    }
    if (remaining.length > 0) {
        gitSafeAt(cwd, 'reset', 'HEAD', '--', ...handoffFiles);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'uncovered-source-changes' });
        die(
            `Auto-commit aborted: working tree has source changes not covered by handoff.md.\n` +
            `  Dirty files:\n${remaining.map(l => `    ${l}`).join('\n')}\n` +
            `  Fix handoff.md to list all changed files (including both sides of renames),\n` +
            `  or stage and commit manually.`
        );
    }
    if (!stagedAfter.ok) {
        gitSafeAt(cwd, 'reset', 'HEAD', '--', ...handoffFiles);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'staged-after-failed' });
        die(`Auto-commit aborted: failed to inspect staged files: ${stagedAfter.stderr || 'unknown error'}`);
    }
    if (stagedAfterUnexpected.length > 0) {
        gitSafeAt(cwd, 'reset', 'HEAD', '--', ...handoffFiles);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'staged-after-outside-handoff' });
        die(
            `Auto-commit aborted: staged files are not covered by handoff.md.\n` +
            `  Staged files:\n${stagedAfterUnexpected.map(f => `    ${f}`).join('\n')}\n` +
            `  Unstage them or list them in handoff.md before rerunning.`
        );
    }
    if (!stagedAfter.stdout.trim()) {
        verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'nothing-staged-after-add' });
        info('Handoff files are already committed or unchanged — skipping auto-commit.');
        return;
    }

    const idSuffix = taskIds.length > 1 ? `[${taskIds.join(', ')}]` : `[${taskIds[0]}]`;
    const message = `${title} ${idSuffix}`;
    const commitResult = gitSafeAt(cwd, 'commit', '-m', message);
    Object.assign(debug, {
        commitOk: commitResult.ok,
        commitStdout: commitResult.stdout,
        commitError: commitResult.stderr,
    });
    if (!commitResult.ok) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'commit-failed' });
        die(`Auto-commit failed: ${commitResult.stderr || 'unknown error'}`);
    }
    // verifyHandoffFilesCommitted now also runs `git diff HEAD` and aborts if any
    // handoff file's working-tree state still differs from HEAD — covering both the
    // success path (here) and every early-return path above.
    verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
    appendAutoCommitDebug(taskIds, { ...debug, result: 'committed' });
    const stagedCount = stagedAfter.stdout.trim().split('\n').filter(Boolean).length;
    info(`Auto-committed ${stagedCount} file(s): ${message}`);
}

function autoCommitArtifacts(taskIds: string[], cwd = REPO_ROOT): void {
    const taskDirs = taskIds.map(id => `tasks/${id}`);
    // In worktree mode, telemetry files live in the main repo (written by run-task.ts
    // itself, not by Codex) — skip them here; they accumulate as uncommitted changes
    // in REPO_ROOT and are committed on the next non-worktree artifact commit.
    const telemetryPresent = cwd === REPO_ROOT
        ? PIPELINE_TELEMETRY_FILES.filter(f => fs.existsSync(path.join(REPO_ROOT, f)))
        : [];
    const pathsToCheck = [...taskDirs, ...telemetryPresent];
    const result = gitSafeAt(cwd, 'status', '--porcelain', ...pathsToCheck);
    if (!result.ok || !result.stdout.trim()) {
        info('No task artifacts to commit.');
        return;
    }
    for (const dir of taskDirs) {
        const addResult = gitSafeAt(cwd, 'add', dir);
        if (!addResult.ok) die(`Failed to stage artifacts for ${dir}: ${addResult.stderr || 'unknown error'}`);
    }
    for (const telemetry of telemetryPresent) {
        // Only stage if dirty (status --porcelain already told us something is
        // there; add -A is idempotent for clean files).
        const addResult = gitSafeAt(cwd, 'add', '--', telemetry);
        if (!addResult.ok) die(`Failed to stage telemetry ${telemetry}: ${addResult.stderr || 'unknown error'}`);
    }
    // If add-ing staged nothing (e.g., all telemetry was already clean and task
    // dirs were the only dirt, but are also clean because we checked `status`
    // against both together), bail out gracefully.
    const staged = gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    if (!staged.stdout.trim()) {
        info('No task artifacts to commit.');
        return;
    }
    const idList = taskIds.join(', ');
    const commitResult = gitSafeAt(cwd, 'commit', '-m', `chore: add task artifacts for ${idList}`);
    if (!commitResult.ok) die(`Artifact commit failed: ${commitResult.stderr || 'unknown error'}`);
    info(`Auto-committed task artifacts for ${idList}.`);
}

// ── PR helpers ─────────────────────────────────────────────────────────────

function extractValidationChecklist(handoffPath: string): string {
    try {
        const rows = parseValidationOutcomeRows(handoffPath);
        if (rows.length === 0) return '- [ ] Validation results not found in handoff.md';
        const results: string[] = [];
        for (const { check, result, notes } of rows) {
            if (canonicalizeValidationCheck(check) === 'citations provided') continue;
            const passed = isPassResult(result);
            const suffix = !passed && notes ? ` (${notes})` : !passed ? ` (${result})` : '';
            results.push(`- [${passed ? 'x' : ' '}] \`${check}\`${suffix}`);
        }
        return results.length > 0 ? results.join('\n') : '- [ ] No validation results found';
    } catch {
        return '- [ ] Validation results not found in handoff.md';
    }
}

function extractExternalApiStatus(handoffPath: string): string {
    try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        if (/^\|\s*Citations provided\s*\|\s*Yes\b/im.test(content)) {
            return [
                '- [ ] No external APIs/dependencies were touched',
                '- [x] External APIs/dependencies were touched and citations are provided below',
            ].join('\n');
        }
    } catch {
        // Fall through
    }
    return [
        '- [x] No external APIs/dependencies were touched',
        '- [ ] External APIs/dependencies were touched and citations are provided below',
    ].join('\n');
}

type DocsMapEntry = { url: string; section: string };

function readDocsMap(): Record<string, DocsMapEntry> {
    const mapPath = path.join(REPO_ROOT, '.agent', 'docs-map.json');
    try {
        const raw = fs.readFileSync(mapPath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const entries: Record<string, DocsMapEntry> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (key.startsWith('_')) continue;
            if (value && typeof value === 'object' && 'url' in (value as object) && 'section' in (value as object)) {
                entries[key] = value as DocsMapEntry;
            }
        }
        return entries;
    } catch {
        return {};
    }
}

function runDocsCheckFlaggedPackages(baseRef: string): Set<string> {
    const result = spawnSync('node', ['scripts/docs-check.mjs', '--list-flagged-with-packages'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, DOCS_CHECK_BASE_REF: baseRef },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) return new Set();
    const packages = new Set<string>();
    for (const line of (result.stdout ?? '').split('\n')) {
        if (!line.trim()) continue;
        const [, pkgList = ''] = line.split('\t');
        for (const pkg of pkgList.split(',').map((p) => p.trim()).filter(Boolean)) {
            packages.add(pkg);
        }
    }
    return packages;
}

function formatMissedCitationsWarning(pkgs: Iterable<string>): string {
    const map = readDocsMap();
    const known: string[] = [];
    const fresh: string[] = [];
    for (const pkg of [...pkgs].sort()) {
        (map[pkg] ? known : fresh).push(pkg);
    }
    const lines = [
        '> ⚠️ **docs-check will flag the following packages.** Codex did not cite them in the handoff. Verify current API before merging.',
        '>',
    ];
    if (fresh.length > 0) {
        lines.push(`> **New to this codebase** (WebFetch + \`API cited\` required): ${fresh.map((p) => `\`${p}\``).join(', ')}`);
    }
    if (known.length > 0) {
        lines.push(`> **Already in \`.agent/docs-map.json\`** (URL + section is enough, no WebFetch required): ${known.map((p) => `\`${p}\``).join(', ')}`);
    }
    lines.push('>');
    lines.push('> Once a new package is validated, add it to `.agent/docs-map.json` so future PRs get the light-touch treatment.');
    return lines.join('\n');
}

function buildPrBody(taskIds: string[]): string {
    const templatePath = path.join(REPO_ROOT, '.github/pull_request_template.md');
    let template: string;
    try {
        template = fs.readFileSync(templatePath, 'utf8');
    } catch {
        warn('Could not read .github/pull_request_template.md — using minimal body.');
        const ids = taskIds.map(id => `\`tasks/${id}/\``).join(', ');
        return `## Summary\n\n- See ${ids} for details.\n`;
    }

    const summaryLines: string[] = [];
    for (const taskId of taskIds) {
        const s = extractSection(path.join(taskDirFor(taskId), 'done.md'), 'What Changed');
        if (s) summaryLines.push(s);
    }
    const summary = summaryLines.join('\n\n') ||
        taskIds.map(id => `- See \`tasks/${id}/done.md\``).join('\n');
    const taskRefs = taskIds.map(id => `\`tasks/${id}/\``).join(', ');

    const primaryHandoff = path.join(taskDirFor(taskIds[0]), 'handoff.md');
    const validation = extractValidationChecklist(primaryHandoff);
    const externalApi = extractExternalApiStatus(primaryHandoff);
    const citations = extractSection(primaryHandoff, 'Documentation Citations');

    // Warning-only: if the handoff claims no external APIs were touched but
    // docs-check's heuristic flags packages, surface a visible warning in the
    // PR body. Do NOT fabricate citations — the whole point of the gate is to
    // force real doc-reading, not a green checkbox. CI's docs-check will still
    // fail (correctly), which is the signal to send Codex back for real citations.
    let externalApiBlock = externalApi;
    const handoffClaimsNoExternal = /- \[x\] No external APIs\/dependencies were touched/.test(externalApi);
    if (handoffClaimsNoExternal || !citations) {
        const flaggedPkgs = runDocsCheckFlaggedPackages(`origin/${getBaseBranch(taskIds)}`);
        if (flaggedPkgs.size > 0) {
            externalApiBlock = `${externalApi}\n\n${formatMissedCitationsWarning(flaggedPkgs)}`;
            info(`buildPrBody: docs-check flagged ${flaggedPkgs.size} package(s) that Codex did not cite — CI will fail until handoff is updated.`);
        }
    }

    let body = template;
    body = replaceMarkdownSection(body, 'Summary', `${summary}\n\nTask artifacts: ${taskRefs}`);
    body = replaceMarkdownSection(body, 'Validation', validation);
    body = replaceMarkdownSection(body, 'External API / Dependency Impact', externalApiBlock);
    if (citations) body = replaceMarkdownSection(body, 'Documentation Citations', citations);
    return body.trim();
}

/**
 * Resolve the git branch for a task's push/PR operations.
 *
 * In worktree mode, `status.branch` is unreliable: the implement-phase sync
 * copies status.json from REPO_ROOT into the worktree, which can clobber the
 * branch field `ensureBranch` just wrote (REPO_ROOT's copy still has the empty
 * default from task creation). The worktree's own HEAD is authoritative.
 *
 * Falls back to status.branch, then current branch, for non-worktree tasks
 * or when the worktree has been removed (e.g., post-ship).
 */
function resolveTaskBranch(taskIds: string[]): string {
    const status = readStatus(taskIds[0]);
    if (status.worktree === true) {
        const wt = worktreePath(taskIds[0]);
        if (fs.existsSync(wt)) {
            const result = gitSafeAt(wt, 'rev-parse', '--abbrev-ref', 'HEAD');
            if (result.ok && result.stdout.trim()) return result.stdout.trim();
        }
    }
    return status.branch || getCurrentBranch();
}

function pushBranch(taskIds: string[]): boolean {
    const branch = resolveTaskBranch(taskIds);
    info(`Pushing '${branch}' to origin...`);
    const result = gitSafe('push', '-u', 'origin', branch);
    if (!result.ok) { warn(`Push failed: ${result.stderr || 'unknown error'}`); return false; }
    info('Push succeeded.');
    return true;
}

function createDraftPr(taskIds: string[]): void {
    if (!ghAvailable) { warn('gh CLI not found — skipping PR creation.'); return; }
    const status = readStatus(taskIds[0]);
    const branch = resolveTaskBranch(taskIds);
    const baseBranch = getBaseBranch(taskIds);
    if (commitsAheadOfBase(branch, baseBranch) === 0) {
        warn(`No commits ahead of ${baseBranch} — nothing to PR.`);
        return;
    }
    const baseTitle = getTitle(status);
    const title = taskIds.length > 1
        ? `${baseTitle} (+${taskIds.length - 1} more) [${taskIds.join(', ')}]`
        : baseTitle;
    const body = buildPrBody(taskIds);
    info(`Creating draft PR (base: ${baseBranch})...`);
    const result = runCommand('gh', [
        'pr', 'create', '--draft',
        '--base', baseBranch,
        '--head', branch,
        '--title', title,
        '--body', body,
    ]);
    if (!result.ok) { warn(`gh pr create failed: ${result.stderr || 'unknown error'}`); return; }
    const prUrl = result.stdout.trim();
    if (prUrl) {
        console.log('');
        console.log(`  🔗 Draft PR created: ${prUrl}`);
        console.log('');
    }
}

// ── Ship (archive) ─────────────────────────────────────────────────────────

/**
 * Refuse to ship if local <baseBranch> is behind origin/<baseBranch>.
 * Only called when no PR was merged (i.e., user merged manually before --ship).
 */
function assertLocalBaseInSyncWithOrigin(taskIds: string[]): void {
    const baseBranch = getBaseBranch(taskIds);

    const fetchResult = gitSafe('fetch', 'origin', baseBranch);
    if (!fetchResult.ok) {
        warn(
            `Could not fetch origin/${baseBranch} (network unavailable?). ` +
            `Skipping rebase-safety check; verify locally with \`git pull --rebase origin ${baseBranch}\` if you've recently merged the PR.`,
        );
        return;
    }

    const behindResult = gitSafe('rev-list', '--count', `HEAD..origin/${baseBranch}`);
    if (!behindResult.ok) {
        warn(`Could not check sync with origin/${baseBranch}: ${behindResult.stderr}. Proceeding without check.`);
        return;
    }

    const behind = Number.parseInt(behindResult.stdout, 10);
    if (Number.isNaN(behind) || behind === 0) return;

    die(
        `Local ${baseBranch} is ${behind} commit${behind === 1 ? '' : 's'} behind origin/${baseBranch}. ` +
        `Rebase before --ship: \`git pull --rebase origin ${baseBranch}\` (or \`./scripts/task.sh post-merge-sync ${baseBranch}\`). ` +
        `The squash merge of the implement-phase PR re-introduces tasks/<id>/ on origin/${baseBranch}; ` +
        `rebasing first ensures --ship consumes the post-merge files instead of leaving a duplicate. ` +
        `See docs/pipeline-orchestrator.md §Shipping & Post-Merge Reconciliation.`,
    );
}

/**
 * Verify the local task/<id> branch (if it exists) has been fully pushed to origin.
 * Aborts --ship if local has commits not on origin — those commits would be lost when
 * the orchestrator deletes the local branch after teardown.
 *
 * No-op when the local branch doesn't exist (already cleaned up, or worktree mode
 * never used). Treats "origin/<branch> does not exist" as a soft signal: if we just
 * fetched and origin doesn't have the branch, either it was deleted post-merge
 * (fine; a successful prior --ship or PR squash-merge) or it was never pushed (bad).
 * We can't tell which without more state, so we warn and continue rather than block
 * legitimate post-merge re-runs.
 */
function assertTaskBranchPushed(taskId: string): void {
    const branchName = `task/${taskId}`;
    if (!branchExistsLocally(branchName)) return;

    // Refresh remote-tracking ref before comparing.
    gitSafe('fetch', 'origin', branchName);

    const remoteRefResult = gitSafe('rev-parse', '--verify', `origin/${branchName}`);
    if (!remoteRefResult.ok) {
        warn(
            `origin/${branchName} not found (${remoteRefResult.stderr.trim() || 'unknown'}). ` +
            `Continuing — assuming the remote branch was deleted by an earlier merge. ` +
            `If you have unpushed work on local ${branchName} you wanted to ship, abort with Ctrl+C and push it now.`,
        );
        return;
    }

    // Count commits in local branch that are NOT on origin. Strict SHA equality would
    // false-positive when origin is merely AHEAD of local (e.g., the PR branch was
    // advanced from another checkout, or remote was force-pushed forward) — that's
    // safe to delete; the work isn't unique to local. Only block when local has
    // commits the remote doesn't.
    const aheadResult = gitSafe('rev-list', '--count', `origin/${branchName}..${branchName}`);
    if (!aheadResult.ok) {
        warn(`Could not compute ${branchName} vs origin/${branchName} divergence: ${aheadResult.stderr}. Skipping push-verify.`);
        return;
    }
    const ahead = Number.parseInt(aheadResult.stdout.trim(), 10);
    if (Number.isNaN(ahead) || ahead === 0) return;

    const localSha = gitSafe('rev-parse', branchName).stdout.trim();
    const remoteSha = gitSafe('rev-parse', `origin/${branchName}`).stdout.trim();
    die(
        `--ship aborted: local ${branchName} has ${ahead} commit${ahead === 1 ? '' : 's'} not on origin.\n` +
        `  Local HEAD: ${localSha.slice(0, 7)} | origin/${branchName}: ${remoteSha.slice(0, 7)}\n` +
        `  Pushing first prevents work loss — --ship destroys the local branch after merging the PR,\n` +
        `  so unpushed commits would be unreachable. Push:\n` +
        `    git push origin ${branchName}\n` +
        `  Then re-run --ship.`,
    );
}

/**
 * Verify origin/task/<id> no longer exists at the point we're about to ship. A
 * successful PR merge (via gh pr merge --delete-branch) removes the remote ref,
 * so its absence is the post-condition we expect when shipping. Presence here —
 * combined with mergeOpenPRsAndPull() returning false — means either:
 *   - The remote branch has commits that were never PR'd (someone pushed to it
 *     directly from another checkout without opening a PR), so its work is not
 *     in any base-branch merge.
 *   - A prior merge succeeded but `--delete-branch` failed to drop the remote
 *     ref (rare — surface this so the operator can clean up manually rather
 *     than have the safety check pass spuriously next time).
 * Either way, shipping silently would orphan the remote commits.
 */
function assertOriginTaskBranchAbsent(taskId: string): void {
    const branchName = `task/${taskId}`;
    // Query origin directly via ls-remote rather than the local tracking ref. When
    // origin/<branch> was deleted from another checkout, `git fetch --prune origin
    // <branch>` does NOT prune the stale local tracking ref, so a `rev-parse
    // origin/<branch>` would still resolve and falsely block. ls-remote talks to
    // the remote and reports the truth. Caught via codex review of 8c3bb7e.
    const lsRemote = gitSafe('ls-remote', '--heads', 'origin', branchName);
    if (!lsRemote.ok) {
        warn(
            `Could not query origin for ${branchName} (${lsRemote.stderr.trim() || 'unknown'}). ` +
            `Skipping origin-branch-absence check — re-run --ship when network access is restored if you ` +
            `want this verified.`,
        );
        return;
    }
    if (!lsRemote.stdout.trim()) return; // Empty output → branch absent on origin — expected.

    const remoteSha = lsRemote.stdout.trim().split(/\s+/)[0];
    die(
        `--ship aborted: origin/${branchName} still exists at ${remoteSha.slice(0, 7)} but no PR was merged this run.\n` +
        `  Either the remote branch has commits that were never PR'd, or a prior merge\n` +
        `  failed to delete it. Shipping silently would orphan the remote work.\n` +
        `  Resolve manually:\n` +
        `    - If unmerged work: open + merge a PR (gh pr create --base <base> --head ${branchName} ...).\n` +
        `    - If already merged elsewhere: \`git push origin --delete ${branchName}\` and re-run --ship.`,
    );
}

/**
 * Verify there is no open PR for the task's branch. Called after mergeOpenPRsAndPull
 * returned false (no PR was merged this run) — a defensive cross-check against gh
 * transient issues that might have caused findOpenPRNumber to return null spuriously.
 */
function assertNoOpenPRForTask(taskId: string): void {
    const branchName = `task/${taskId}`;
    const prNum = findOpenPRNumber(branchName);
    if (prNum !== null) {
        die(
            `--ship aborted: PR #${prNum} is open for ${branchName} but the merge step did not run.\n` +
            `  This can happen during gh transient hiccups. Re-running --ship usually works; if it\n` +
            `  keeps failing, merge the PR manually (gh pr merge ${prNum} --squash --delete-branch)\n` +
            `  and re-run.`,
        );
    }
}

/**
 * Find the number of an open PR whose head branch matches `branch`.
 * Returns null if gh CLI is unavailable, no PR found, or lookup fails.
 */
function findOpenPRNumber(branch: string): number | null {
    if (!ghAvailable) return null;
    const result = runCommand('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number', '--jq', '.[0].number']);
    if (!result.ok || !result.stdout.trim() || result.stdout.trim() === 'null') return null;
    const num = Number.parseInt(result.stdout.trim(), 10);
    return Number.isNaN(num) ? null : num;
}

/**
 * For each task branch with an open PR: squash-merge it (deleting the remote
 * branch), then pull the base branch. Returns true if any PR was merged.
 *
 * The `--delete-branch` flag on `gh pr merge` deletes the remote branch and
 * attempts to delete the local branch too. The local deletion may fail if the
 * branch is used by a worktree — that's fine; we clean local branches ourselves
 * after teardown.
 */
function mergeOpenPRsAndPull(taskIds: string[]): boolean {
    const baseBranch = getBaseBranch(taskIds);
    // Deduplicate branch names (bundles share one branch)
    const branches = [...new Set(taskIds.map(id => `task/${id}`))];
    let anyMerged = false;
    for (const branch of branches) {
        const prNum = findOpenPRNumber(branch);
        if (!prNum) continue;
        info(`Merging PR #${prNum} (${branch} → ${baseBranch}) via squash...`);
        // --delete-branch removes the remote branch; local cleanup happens post-teardown.
        const result = runCommand('gh', ['pr', 'merge', String(prNum), '--squash', '--delete-branch']);
        if (!result.ok && !result.stderr.includes('already merged')) {
            die(`Failed to merge PR #${prNum}: ${result.stderr}`);
        }
        info(`PR #${prNum} merged.`);
        anyMerged = true;
    }
    if (anyMerged) {
        info(`Pulling ${baseBranch}...`);
        git('pull', 'origin', baseBranch);
    }
    return anyMerged;
}

/**
 * Hook for project-specific post-merge work (e.g., regenerating derived files,
 * syncing dates, refreshing a manifest). Runs after PRs merge and before tasks
 * are archived in --ship.
 *
 * Convention: drop a `.canon/hooks/post-merge.sh` script in your project. If it
 * exists and is executable, the orchestrator runs it via `bash` from REPO_ROOT
 * after merging PRs. The script should be self-contained: invoke whatever
 * commands your project needs, stage and commit any changes it produces, and
 * exit non-zero on hard failure. The orchestrator treats failures as non-fatal
 * (logs a warning and continues) — your hook should not block --ship for
 * recoverable issues.
 *
 * Absence of the hook is the default; canon-ai itself doesn't ship one.
 */
function runPostMergeHook(): void {
    const hookPath = path.join(REPO_ROOT, '.canon/hooks/post-merge.sh');
    if (!fs.existsSync(hookPath)) return;
    info('Running .canon/hooks/post-merge.sh...');
    const result = runCommand('bash', [hookPath]);
    if (!result.ok) {
        warn(`.canon/hooks/post-merge.sh exited non-zero — continuing. stderr: ${result.stderr.slice(0, 400)}`);
    }
}

/**
 * If the base branch is a release branch (release/v<X.Y>) and gh is available,
 * extract the version from package.json and create a GitHub release tag.
 * No-op for tasks branching off main.
 */
function maybeCreateGitHubRelease(baseBranch: string): void {
    if (!ghAvailable) return;
    if (!baseBranch.startsWith('release/')) return;

    // Read version from package.json (already bumped by release-init)
    let version: string;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string };
        version = pkg.version ?? '';
    } catch {
        warn('Could not read package.json version — skipping GitHub release creation.');
        return;
    }
    if (!version) { warn('package.json has no version field — skipping GitHub release creation.'); return; }

    const tag = `v${version}`;
    info(`Creating GitHub release ${tag}...`);
    // Extract the changelog block for this version to use as release notes.
    let notes = `Release ${tag}`;
    try {
        const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
        // Match the block starting with ## v<major.minor> up to the next ## heading
        const match = changelog.match(new RegExp(`(## v${version.replace('.', '\\.')}[\\s\\S]*?)(?=\n## |$)`));
        if (match) notes = match[1].trim();
    } catch { /* no changelog — use default notes */ }

    const result = runCommand('gh', [
        'release', 'create', tag,
        '--title', tag,
        '--notes', notes,
    ]);
    if (!result.ok) {
        warn(`GitHub release creation failed: ${result.stderr || 'unknown error'}`);
    } else {
        info(`GitHub release ${tag} created: ${result.stdout.trim()}`);
    }
}

/**
 * After archiving, rewrite `tasks/<id>/` → `tasks/_archive/<id>/` in the docs
 * files that commonly carry task refs (lessons-learned.md, task-quality-log.md).
 * Prevents stale refs from tripping the docs-refs-check on the next release PR.
 */
function rewriteArchivedTaskRefs(taskIds: string[]): void {
    const targets = [
        path.join(REPO_ROOT, 'docs', 'lessons-learned.md'),
        path.join(REPO_ROOT, 'docs', 'task-quality-log.md'),
    ];
    for (const filePath of targets) {
        if (!fs.existsSync(filePath)) continue;
        let content = fs.readFileSync(filePath, 'utf8');
        let changed = false;
        for (const taskId of taskIds) {
            const stale = `tasks/${taskId}/`;
            const fresh = `tasks/_archive/${taskId}/`;
            if (content.includes(stale)) {
                content = content.replaceAll(stale, fresh);
                changed = true;
            }
        }
        if (changed) {
            fs.writeFileSync(filePath, content, 'utf8');
            info(`Updated stale task refs in ${path.relative(REPO_ROOT, filePath)}.`);
        }
    }
}

function shipTasks(taskIds: string[]): void {
    // Phase guard first — fail fast before any network calls.
    for (const taskId of taskIds) {
        const currentPhase = getCurrentPhase(readStatus(taskId));
        if (currentPhase !== 'human_review' && currentPhase !== 'complete') {
            die(`--ship requires tasks at human_review or complete. '${taskId}' is at: ${currentPhase}`);
        }
    }

    // Pre-flight: every local task branch with unpushed commits is a hard abort.
    // --ship later tears down the worktree and deletes the local branch; if local
    // has commits not on origin, those commits are lost forever (gone from any
    // ref the user can reach). Also covers the case where the PR-merge step below
    // silently misses a PR for any reason — instead of trusting that flow alone,
    // we independently verify origin has the local work before any destruction.
    // Surfaced 2026-05-07 via canon-on-canon dogfood: the iteration-3 rename fix
    // was committed locally, never pushed, then --ship deleted the branch; only
    // the dangling commits in `git fsck` survived (with a partial subset of files).
    for (const taskId of taskIds) {
        assertTaskBranchPushed(taskId);
    }

    // Flush any telemetry before merging so the PR doesn't pick it up.
    if (taskIds.some(id => readStatus(id).worktree === true)) flushWorktreeTelemetry();

    // Merge open PRs and pull; if none found, assert the base is already in sync.
    const merged = mergeOpenPRsAndPull(taskIds);
    if (!merged) {
        // No PR was merged this run. That can mean either (a) PR was merged earlier
        // and the remote branch was already cleaned up by `--delete-branch` on the
        // prior merge, or (b) findOpenPRNumber missed an open PR (gh transient,
        // PR state quirk), or (c) the remote task branch exists with commits that
        // were never PR'd at all (someone pushed to it directly from another
        // checkout). For (b) and (c), proceeding silently archives the task while
        // its work is unmerged — destroying any local artifact path back to those
        // commits and leaving the base branch missing the task's content.
        // Independent verification here prevents that class of silent failure.
        assertLocalBaseInSyncWithOrigin(taskIds);
        for (const taskId of taskIds) assertNoOpenPRForTask(taskId);
        // After mergeOpenPRsAndPull(), a successful merge would have invoked
        // --delete-branch and removed origin/task/<id>. If that branch still exists
        // here, no merge ever happened for it — abort. The earlier
        // assertTaskBranchPushed() (count-of-local-commits-ahead-of-origin) misses
        // this case because origin can be AHEAD of local and have unmerged commits
        // that are only on the remote, never in the base. Caught via codex review
        // of fb76257.
        for (const taskId of taskIds) assertOriginTaskBranchAbsent(taskId);
    }

    // Post-merge: project-specific hook (default no-op; edit runPostMergeHook).
    runPostMergeHook();

    const baseBranch = getBaseBranch(taskIds);
    const archiveDir = path.join(TASKS_DIR, '_archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    const localBranchesToDelete: string[] = [];

    for (const taskId of taskIds) {
        // Read from worktree (canonical during pipeline) before tearing it down.
        const status = readStatus(taskId);
        const hasWorktree = status.worktree === true;

        // Teardown before writeStatus so the write targets REPO_ROOT — ensuring
        // the archived tasks/<id>/status.json has the final completed state, not
        // the stale last-committed snapshot.
        if (hasWorktree) teardownWorktree(taskId);

        status.updated = new Date().toISOString().slice(0, 10);
        const humanReview = status.phases.human_review;
        if (humanReview) humanReview.status = 'done';
        // writeStatus() derives top-level .status — with every phase now 'done',
        // it becomes 'complete'. No direct assignment needed.
        writeStatus(taskId, status);

        const src = taskDirFor(taskId);
        const dest = path.join(archiveDir, taskId);
        fs.renameSync(src, dest);
        info(`📦 ${taskId} → tasks/_archive/${taskId}`);

        // Queue local branch for deletion after worktree is gone.
        const branchName = `task/${taskId}`;
        if (branchExistsLocally(branchName)) localBranchesToDelete.push(branchName);
    }

    // Rewrite stale tasks/<id>/... refs → tasks/_archive/<id>/... in docs.
    rewriteArchivedTaskRefs(taskIds);

    // Commit the archive move + any status changes and push.
    const stagedPaths: string[] = taskIds.flatMap(id => [
        path.join(TASKS_DIR, id),                        // deleted source (if not cleaned up)
        path.join(TASKS_DIR, '_archive', id),            // new archive destination
        path.join(REPO_ROOT, 'docs', 'lessons-learned.md'),
        path.join(REPO_ROOT, 'docs', 'task-quality-log.md'),
    ]);
    for (const p of stagedPaths) gitSafe('add', '-A', '--', p);
    const staged = gitSafe('diff', '--cached', '--name-only');
    if (staged.stdout.trim()) {
        const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
        gitSafe('commit', '-m', `chore: archive ${label}`);
        info(`Pushing ${baseBranch}...`);
        git('push', 'origin', baseBranch);
    }

    // Delete local task branches (safe to force — squash-merged).
    for (const branch of localBranchesToDelete) {
        const result = gitSafe('branch', '-D', branch);
        if (result.ok) info(`Deleted local branch ${branch}.`);
        else warn(`Could not delete local branch ${branch}: ${result.stderr}`);
    }

    // Create a GitHub release if this is a release-branch PR.
    maybeCreateGitHubRelease(baseBranch);

    info(`Shipped ${taskIds.length} task${taskIds.length > 1 ? 's' : ''} to _archive/.`);
    process.exit(0);
}

// ── Reroute ────────────────────────────────────────────────────────────────

function rerouteFromHumanReview(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const currentPhase = getCurrentPhase(readStatus(taskId));
        if (currentPhase !== 'human_review') {
            die(`--reroute requires all tasks to be at human_review. '${taskId}' is at: ${currentPhase}`);
        }
    }
    info(`Rerouting: human_review → implement (resetting implement, code_review, qa)`);
    for (const taskId of taskIds) {
        const status = readStatus(taskId);
        status.updated = new Date().toISOString().slice(0, 10);
        // writeStatus() derives top-level .status from phases — resetting
        // implement→pending will flip top-level back to 'implement' automatically.
        const implement = status.phases.implement;
        if (implement) {
            implement.status = 'pending';
            // Flag that Codex must treat this as an amended-spec revision, not a resume.
            // Consumed and cleared in runPhase case 'implement' after the reroute pass runs.
            implement.rerouted = true;
            // Accumulate (never reset). The reroute prompt reads this to inject a round
            // marker so session-resumed Codex can't confuse a new reroute with a duplicate
            // of a prior one — the static prompt text is otherwise identical each round.
            implement.reroute_count = (implement.reroute_count ?? 0) + 1;
        }
        const codeReview = status.phases.code_review;
        if (codeReview) { codeReview.status = 'pending'; codeReview.verdict = ''; codeReview.iterations = 0; }
        const qa = status.phases.qa;
        if (qa) qa.status = 'pending';
        const humanReview = status.phases.human_review;
        if (humanReview) humanReview.status = 'pending';
        writeStatus(taskId, status);
    }
    info('Status reset. Pipeline will resume from implement phase with amended-spec context.');
    info('Note: Codex will re-read spec.md carefully (looking for new Amendment sections) and update the implementation.');
}

function routeBackTo(taskIds: string[], targetPhase: Phase): void {
    const targetIdx = PHASE_ORDER.indexOf(targetPhase);
    for (const taskId of taskIds) {
        const status = readStatus(taskId);
        // Reset the target phase AND every downstream phase back to pending.
        //
        // Why downstream too: deriveTopLevelStatus() walks PHASE_ORDER and
        // returns the first phase whose status !== 'done'. If we only reset
        // the target, a downstream phase still stamped 'done' from a previous
        // cycle (e.g. code_review with a stale 'changes_requested' verdict,
        // or qa from an earlier attempt) would be skipped entirely on the
        // next dispatch: once the target re-runs and flips back to 'done',
        // the loop skips straight past the un-reset downstream phase to the
        // first still-pending one. That's how changes_requested on code_review
        // used to silently skip the re-review after Codex iterated — the fix
        // came in alongside smart-fill-v3-scoring-fidelity after the bug bit.
        for (let i = targetIdx; i < PHASE_ORDER.length; i += 1) {
            const phaseEntry = status.phases[PHASE_ORDER[i]];
            if (phaseEntry) phaseEntry.status = 'pending';
        }
        // writeStatus() derives top-level .status from phases. With target
        // and all downstream flipped to 'pending', derivation correctly lands
        // on the target phase.
        writeStatus(taskId, status);
    }
}

// ── runPhase ───────────────────────────────────────────────────────────────

async function runPhase(phase: CurrentPhase, state: PipelineState): Promise<void> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    // spec cluster: resumes across spec-revision rounds (always run in REPO_ROOT)
    const specClaudeSession = getStoredSessionId(taskIds, 'claude_spec');
    // code_review cluster: round 1 is always fresh; round 2+ resumes (same worktree cwd)
    const reviewClaudeSession = getStoredSessionId(taskIds, 'claude_review');
    const codexSession = getStoredSessionId(taskIds, 'codex');

    switch (phase) {
        case 'spec': {
            const hasChangesRequested = tasks.some(t => t.specReviewVerdict === 'changes_requested');
            if (hasChangesRequested) {
                info('Phase: spec (Claude revises specs after review feedback)');
                for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'spec', 'in_progress');
                const cfg = getClaudeConfig('spec', tasks);
                await runClaude(promptSpecRevision(state), cliArgs.interactive, specClaudeSession, cfg.model, cfg.effort, {
                    taskId: taskIds.join('+'),
                    phase: 'spec',
                    iteration: tasks[0].status.phases.spec?.iterations,
                });
                return;
            }
            const label = state.tier === 'fast' ? 'spec+plan' : 'spec';
            info(`Phase: spec (Claude writes ${label}${state.isBundle ? ' for bundle' : ''})`);
            for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'spec', 'in_progress');
            const cfg = getClaudeConfig('spec', tasks);
            await runClaude(promptSpec(state), cliArgs.interactive, null, cfg.model, cfg.effort, {
                taskId: taskIds.join('+'),
                phase: 'spec',
                iteration: tasks[0].status.phases.spec?.iterations,
            });
            return;
        }

        case 'spec_review': {
            if (state.tier === 'fast') {
                // Fast tier: human gate replaces Codex spec_review.
                // Gate fires on first run (human_spec_gate=true), clears itself, exits.
                // Re-run finds gate=false and auto-advances spec_review + plan.
                const anyGateOn = tasks.some(t => t.status.human_spec_gate);
                if (anyGateOn) {
                    for (const t of tasks) {
                        if (t.status.human_spec_gate) {
                            t.status.human_spec_gate = false;
                            writeStatus(t.taskId, t.status);
                        }
                    }
                    const specList = taskIds.map(id => `  tasks/${id}/spec.md`).join('\n');
                    const planList = taskIds.map(id => `  tasks/${id}/plan.md`).join('\n');
                    console.log('');
                    console.log('════════════════════════════════════════════════════════');
                    console.log(`  ✋  SPEC GATE — Review before Codex implements.`);
                    console.log('');
                    console.log('  Specs:');
                    console.log(specList);
                    console.log('  Plans:');
                    console.log(planList);
                    console.log('');
                    console.log(`  When ready: npx tsx scripts/run-task.ts ${taskIds.join(' ')}`);
                    console.log('════════════════════════════════════════════════════════');
                    console.log('');
                    process.exit(0);
                }
                // Gate already cleared — auto-advance spec_review and plan
                info('Fast tier: auto-advancing spec_review and plan (written during spec phase).');
                for (const t of tasks) {
                    runTaskShFor(t.taskId, 'phase', t.taskId, 'spec_review', 'done', 'approved');
                    if (isPlanCombined(t.status)) {
                        runTaskShFor(t.taskId, 'phase', t.taskId, 'plan', 'done');
                    }
                }
                return;
            }
            // Full tier: Codex reviews specs
            const maxSpecIter = tasks.reduce(
                (max, t) => Math.max(max, getPhaseIterations(t.status, 'spec_review')),
                0,
            );
            const specReviewLoopCap = getMaxReviewLoops(tasks);
            if (maxSpecIter >= specReviewLoopCap) {
                const reason =
                    `Spec review hit ${maxSpecIter} changes_requested iterations in a row ` +
                    `(limit: ${specReviewLoopCap}). Pipeline auto-blocked. A repeated ` +
                    `pushback usually means the spec has a structural or scope issue that ` +
                    `another mechanical revision won't fix — read the latest spec-review.md ` +
                    `and decide whether to revise scope, split the task, or defer. To resume ` +
                    `after fixing: set phases.spec_review.status = "pending" and ` +
                    `phases.spec_review.iterations = 0 in status.json, then re-run the pipeline.`;
                warn(reason);
                autoBlockPhase(taskIds, 'spec_review', maxSpecIter, reason);
                process.exit(2);
            }
            info(`Phase: spec_review (Codex reviews spec${state.isBundle ? 's' : ''})`);
            for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'spec_review', 'in_progress');
            // If resuming a previous session the spec may have been revised — tell Codex
            // to re-read and produce a fresh review rather than replaying its prior output.
            const isReReview = codexSession !== null;
            const specReviewPrompt = isReReview
                ? `The spec${state.isBundle ? 's have' : ' has'} been revised since your last review. Re-read the current spec.md ${state.isBundle ? 'files' : 'file'} from disk and produce a completely fresh review — do not replay or summarise your previous output.\n\n${promptSpecReview(state)}`
                : promptSpecReview(state);
            const specReviewCfg = getCodexConfig('spec_review', tasks);
            await runCodex(specReviewPrompt, cliArgs.interactive, codexSession, specReviewCfg.model, specReviewCfg.effort, {
                taskId: taskIds.join('+'),
                phase: 'spec_review',
                iteration: maxSpecIter,
            });
            return;
        }

        case 'plan': {
            info(`Phase: plan (Claude writes plan${state.isBundle ? 's' : ''})`);
            for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'plan', 'in_progress');
            const cfg = getClaudeConfig('plan', tasks);
            // plan is a one-off — always fresh, don't resume any prior session.
            await runClaude(promptPlan(state), cliArgs.interactive, null, cfg.model, cfg.effort, {
                taskId: taskIds.join('+'),
                phase: 'plan',
                iteration: tasks[0].status.phases.plan?.iterations,
            });
            // Post-run: if plan.md is still the template the sub-agent failed silently.
            for (const t of tasks) {
                const planPath = path.join(taskDirFor(t.taskId), 'plan.md');
                let planContent: string | null = null;
                try { planContent = fs.readFileSync(planPath, 'utf8'); } catch { /* missing */ }
                if (isTemplateUnfilled(planContent)) {
                    warn(`[${t.taskId}] plan.md is still the template after plan phase — sub-agent did not write it. Resetting to pending for retry.`);
                    runTaskShFor(t.taskId, 'phase', t.taskId, 'plan', 'pending');
                }
            }
            return;
        }

        case 'implement': {
            // Commit any uncommitted task artifacts on the base branch before the
            // worktree is created from current HEAD. Otherwise the worktree branches
            // off a HEAD that lacks the spec/plan and Codex runs blind. Idempotent
            // for re-runs (no changes within tasks/<id>/ → no-op).
            commitTaskArtifactsToBase(taskIds);
            ensureBranch(taskIds);
            // Sync task artifacts from REPO_ROOT into the worktree so Codex has the
            // latest spec.md, plan.md, and spec-review.md. These files are written to
            // REPO_ROOT during spec/plan phases but may not be committed before the
            // worktree branches — leaving Codex with a blank template plan.md.
            if (isWorktreeEnabled(taskIds)) {
                const wt = getActiveCwd(taskIds);
                // status.json is INTENTIONALLY excluded — the worktree's status.json
                // is canonical (see resolveTaskCwd). Reviewer Claude updates iterations
                // and verdict via task.sh in the worktree CWD; the orchestrator's
                // routeBackTo() writes to the worktree via writeStatus. Copying the
                // main repo's stale snapshot over the worktree's live state was the
                // root cause of the code_review iteration counter resetting to 0
                // every implement-revision pass — Codex saw "iteration 1" prompts
                // every round, which on a resumed session reads as duplicate delivery
                // and triggers "fix already applied" hallucinations.
                const artifacts = ['spec.md', 'spec-review.md', 'plan.md', 'notes.md'];
                for (const taskId of taskIds) {
                    const srcDir = taskDirFor(taskId);
                    const dstDir = path.join(wt, 'tasks', taskId);
                    // Defensive: dstDir should exist (commitTaskArtifactsToBase committed
                    // the task dir before worktree creation). Stays as belt-and-suspenders.
                    fs.mkdirSync(dstDir, { recursive: true });
                    for (const file of artifacts) {
                        const src = path.join(srcDir, file);
                        const dst = path.join(dstDir, file);
                        if (fs.existsSync(src)) {
                            try { fs.copyFileSync(src, dst); } catch { /* best-effort */ }
                        }
                    }
                }
                info('Synced task artifacts from main worktree into task worktree for implement.');
            }
            const activeCwd = getActiveCwd(taskIds);
            const isRevision = tasks.some(t => t.iterations > 0);
            // Reroute from human_review: spec was amended, Codex must re-read spec
            // and update the implementation — not assume prior work is complete.
            const isRerouted = tasks.some(t => t.status.phases.implement?.rerouted === true);
            // Implement-phase-specific resume marker: this *particular* implement
            // pass had already been flipped to in_progress before we got here, which
            // only happens when a previous implement attempt started but didn't reach
            // the final `task.sh phase implement done` call. A stored codex session
            // alone is NOT enough — Codex runs spec_review in the full tier, so the
            // session ID is present on first implement even when no implementation
            // has been attempted yet. (We must check t.status — the pre-loop snapshot
            // — because line below flips implement to in_progress unconditionally.)
            const wasImplementInProgress = tasks.some(t => t.status.phases.implement?.status === 'in_progress');
            const phaseLabel = isRevision ? ', revision' : isRerouted ? ', reroute (spec amended)' : '';
            info(`Phase: implement (Codex${state.isBundle ? ' bundle' : ''}${phaseLabel})`);
            for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'implement', 'in_progress');
            // Priority: code-review revision > reroute > interrupted-session resume > fresh.
            // isResume requires a stored codex session AND no revision AND no reroute AND
            // evidence that a prior implement pass actually started (wasImplementInProgress).
            // Without the last condition, a fresh first implement would receive the "work is
            // already complete, just write handoff" prompt and skip the actual implementation.
            const isResume = codexSession !== null && !isRevision && !isRerouted && wasImplementInProgress;
            // promptImplementRevisions is slim by design: it points
            // explicitly at review.md §Round N and tells the agent it MAY
            // re-read spec.md/plan.md if needed. That handles both a
            // resumed session (round-1 framing in context, can skip the
            // re-read) and a fresh-session fallback (cold start, re-reads
            // the named files).
            const implementPrompt = isRevision
                ? promptImplementRevisions(state)
                : isRerouted
                    ? promptImplementReroute(state)
                    : isResume
                        ? `Your implementation session was interrupted before you could write handoffs. The code changes are already complete in the working tree.\n\nYour only remaining tasks:\n1. Run the project's validation commands (see AGENTS.md "Validation Matrix" and each spec's "Validation Required" section) and record results.\n2. Write handoff.md for each task (intent/rationale, deviations, AC coverage, validation outcomes).\n3. Run task.sh to mark implement done for each task.\n\n${promptImplement(state, 'resume')}`
                        : promptImplement(state, 'fresh');
            const implementCfg = getCodexConfig('implement', tasks);
            await runCodex(
                implementPrompt,
                cliArgs.interactive,
                codexSession,
                implementCfg.model,
                implementCfg.effort,
                {
                    taskId: taskIds.join('+'),
                    phase: 'implement',
                    iteration: tasks[0].iterations,
                },
                activeCwd,
            );
            // Hallucination guard: on revision iterations (iter > 0) Codex has a
            // stored session and a near-identical prompt to the prior round. Resumed
            // sessions can hallucinate "the revision is already in place, validations
            // passed" without re-editing any source — the prompt looks like one they
            // already finished, so they skip the work entirely.
            //
            // Counted as evidence of real revision work: any source file change
            // (anything outside `tasks/`), OR a handoff.md update, OR a notes.md
            // update. handoff updates legitimately accompany validation-only
            // revisions (when the reviewer's only ask is "re-run a validation and
            // record it") — Codex correctly produces no source diff in that case
            // and refreshes handoff. Bumping status.json alone is NOT work.
            //
            // Discovered 2026-05-02 in frames-drag-to-canvas (4 review iterations
            // with 0 source diff). Refined 2026-05-04 in mobile-floating-toolbar-
            // and-resize (handoff-only revision was misfiring the heuristic).
            if (isRevision) {
                const dirtyResult = gitSafeAtRaw(activeCwd, 'status', '--porcelain=v1', '-uall');
                const meaningfulChanges = dirtyResult.ok
                    ? [...parsePorcelain(dirtyResult.stdout)].filter(f => {
                        if (!f.startsWith('tasks/')) return true; // source file
                        if (f.endsWith('/handoff.md')) return true; // handoff = validation/doc work
                        if (f.endsWith('/notes.md')) return true; // notes = lesson capture
                        return false; // status.json bumps don't count
                    })
                    : ['<git-status-failed>']; // assume valid if we can't tell
                if (dirtyResult.ok && meaningfulChanges.length === 0) {
                    warn('');
                    warn('⚠️  Codex revision iteration produced no source-file changes.');
                    warn('    This is the resumed-session hallucination signature: Codex believed');
                    warn('    the work was already done from a prior round and skipped re-editing.');
                    warn('    Dropping the stored Codex session so the next run starts fresh.');
                    warn('');
                    for (const taskId of taskIds) {
                        const s = readStatus(taskId);
                        if (s.sessions) {
                            delete s.sessions.codex;
                            writeStatus(taskId, s);
                        }
                    }
                    autoBlockPhase(taskIds, 'implement', tasks[0].iterations + 1,
                        'Revision iteration produced no source-file diff — Codex resumed-session hallucination signature. Stored session cleared. Re-run pipeline for a fresh attempt, or apply the fix inline.');
                    process.exit(2);
                }
            }
            // Consume the reroute flag after the pass. If Codex crashed, leaving the flag
            // set is intentional — next invocation will re-send the amended-spec prompt.
            // We only clear once implement.status has actually advanced to done.
            if (isRerouted) {
                for (const t of tasks) {
                    const fresh = readStatus(t.taskId);
                    const implementPhase = fresh.phases.implement;
                    if (implementPhase?.rerouted && implementPhase.status === 'done') {
                        implementPhase.rerouted = false;
                        writeStatus(t.taskId, fresh);
                    }
                }
            }
            return;
        }

        case 'code_review': {
            verifyBranch(taskIds);
            const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
            const codeReviewLoopCap = getMaxReviewLoops(tasks);
            if (maxIter >= codeReviewLoopCap) {
                const reason =
                    `Code review hit ${maxIter} changes_requested iterations in a row ` +
                    `(limit: ${codeReviewLoopCap}). Pipeline auto-blocked. Read ` +
                    `tasks/<id>/review.md — if the same finding keeps recurring, the spec ` +
                    `or approach may need revisiting rather than another implementation pass. ` +
                    `To resume after fixing: set phases.code_review.status = "pending" and ` +
                    `phases.code_review.iterations = 0 in status.json, then re-run the pipeline.`;
                warn(reason);
                autoBlockPhase(taskIds, 'code_review', maxIter, reason);
                process.exit(2);
            }

            // Pre-flight: reject obviously invalid handoffs without spending a Claude session.
            // Catches Fail validation results and missing AC Coverage tables deterministically.
            const preflightFailed: Array<{ taskId: string; issues: string[]; bundleIssues?: string[] }> = [];
            for (const t of tasks) {
                const issues = validateHandoff(t.taskId);
                if (issues.length > 0) preflightFailed.push({ taskId: t.taskId, issues });
            }
            const bundleIssues = verifyHandoffAgainstDiff(taskIds, getBaseBranch(taskIds));
            if (bundleIssues.length > 0) {
                for (const taskId of taskIds) {
                    const existing = preflightFailed.find(entry => entry.taskId === taskId);
                    if (existing) {
                        existing.bundleIssues = bundleIssues;
                    } else {
                        preflightFailed.push({ taskId, issues: [], bundleIssues });
                    }
                }
            }
            if (preflightFailed.length > 0) {
                warn('Validation pre-flight FAILED — rejecting handoff without Claude review:');
                for (const { taskId, issues, bundleIssues: taskBundleIssues } of preflightFailed) {
                    for (const issue of issues) warn(`  [${taskId}] ${issue}`);
                    if (taskBundleIssues) {
                        for (const issue of taskBundleIssues) warn(`  [bundle:${taskId}] ${issue}`);
                    }
                    const perTaskSection = issues.length > 0
                        ? `${issues.map(i => `- ${i}`).join('\n')}\n`
                        : '';
                    const bundleSection = taskBundleIssues && taskBundleIssues.length > 0
                        ? `\n### Bundle-Level Handoff Verification\n\n` +
                          `${taskBundleIssues.map(i => `- ${i}`).join('\n')}\n`
                        : '';
                    const reviewContent =
                        `# Code Review: ${taskId}\n\n` +
                        `## Validation Gate\n\n` +
                        `**BLOCKED — pre-flight rejected handoff before full review:**\n\n` +
                        perTaskSection +
                        bundleSection +
                        `\n` +
                        `## Verdict\n\n- [x] **Changes requested** — fix the above and resubmit handoff.\n`;
                    fs.writeFileSync(path.join(taskDirFor(taskId), 'review.md'), reviewContent);
                    runTaskShFor(taskId, 'phase', taskId, 'code_review', 'done', 'changes_requested');
                }
                return;
            }

            info(`Phase: code_review (Claude${state.isBundle ? ' bundle' : ''}, iteration ${maxIter + 1})`);
            for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'code_review', 'in_progress');
            // Sync task artifacts from REPO_ROOT into the worktree before review.
            // The worktree may have branched before spec revisions were committed to
            // the task branch (spec iterates on main while Codex works in the worktree).
            if (isWorktreeEnabled(taskIds)) {
                const activeCwd = getActiveCwd(taskIds);
                const artifacts = ['spec.md', 'spec-review.md', 'plan.md', 'notes.md'];
                for (const taskId of taskIds) {
                    const srcDir = taskDirFor(taskId);
                    const dstDir = path.join(activeCwd, 'tasks', taskId);
                    fs.mkdirSync(dstDir, { recursive: true });
                    for (const file of artifacts) {
                        const src = path.join(srcDir, file);
                        const dst = path.join(dstDir, file);
                        if (fs.existsSync(src)) {
                            try { fs.copyFileSync(src, dst); } catch { /* best-effort */ }
                        }
                    }
                }
                info('Synced task artifacts from main worktree into task worktree for review.');
            }
            const cfg = getClaudeConfig('code_review', tasks);
            // Round 1: always fresh (no prior review session exists).
            // Round 2+: resume the code_review session from round 1 — same worktree cwd,
            // so the project path matches and the session is resumable.
            // Never resume the spec/plan session here: different cwd, stale context.
            const reviewResumeId = maxIter > 0 ? reviewClaudeSession : null;
            // promptCodeReview's round 2+ branch is slim by design: it points
            // explicitly at review.md §Round N, handoff.md §Iteration N, and
            // git diff. That's enough orientation for both a resumed session
            // (which has the round-1 framing in context) and a stale-resume
            // fallback (which will re-read those files cold). runClaude's
            // resume-not-found retry handles the runtime fallback transparently.
            await runClaude(promptCodeReview(state), cliArgs.interactive, reviewResumeId, cfg.model, cfg.effort, {
                taskId: taskIds.join('+'),
                phase: 'code_review',
                iteration: maxIter,
            }, getActiveCwd(taskIds));
            // Post-run: if review.md is still the template the sub-agent failed silently.
            // Reset to pending so the next run retries rather than staying stuck in_progress.
            for (const t of tasks) {
                const reviewPath = path.join(taskDirFor(t.taskId), 'review.md');
                let reviewContent: string | null = null;
                try { reviewContent = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing */ }
                if (isTemplateUnfilled(reviewContent)) {
                    warn(`[${t.taskId}] review.md is still the template after code_review run — sub-agent did not write it. Resetting to pending for retry.`);
                    runTaskShFor(t.taskId, 'phase', t.taskId, 'code_review', 'pending');
                }
            }
            return;
        }

        case 'qa': {
            verifyBranch(taskIds);
            info(`Phase: qa (Claude writes QA${state.isBundle ? ' for bundle' : ''})`);
            for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'qa', 'in_progress');
            const cfg = getClaudeConfig('qa', tasks);
            // qa is stateless — same reasoning as code_review above: don't resume.
            await runClaude(promptQa(state), cliArgs.interactive, null, cfg.model, cfg.effort, {
                taskId: taskIds.join('+'),
                phase: 'qa',
                iteration: tasks[0].status.phases.qa?.iterations,
            }, getActiveCwd(taskIds));
            // Salvage: if the QA sub-agent streamed done.md content instead of
            // using the Write tool (Haiku regression, 2026-04-18), recover it
            // from captured stdout and also advance qa → done. Single-task only
            // — bundle QA output isn't split per task so we can't safely
            // assign the stream to one done.md.
            if (!state.isBundle && lastClaudeStdout) {
                const taskId = taskIds[0];
                const donePath = path.join(taskDirFor(taskId), 'done.md');
                if (isDoneMdTemplate(donePath)) {
                    const salvaged = extractDoneMdFromStdout(lastClaudeStdout);
                    if (salvaged) {
                        fs.writeFileSync(donePath, salvaged);
                        warn(`Salvaged tasks/${taskId}/done.md from captured stdout — QA sub-agent streamed content instead of using the Write tool.`);
                        const phaseStatus = getPhaseStatus(readStatus(taskId), 'qa');
                        if (phaseStatus !== 'done') {
                            runTaskShFor(taskId, 'phase', taskId, 'qa', 'done');
                            warn(`Also advanced qa → done for ${taskId} (sub-agent skipped task.sh).`);
                        }
                    }
                }
            }
            return;
        }

        case 'human_review': {
            verifyBranch(taskIds);
            let pushed = true;
            if (cliArgs.push || cliArgs.pr) {
                // Flush telemetry that accumulated in the main repo while Codex ran
                // in the worktree, so it's committed to main before the branch is pushed.
                if (isWorktreeEnabled(taskIds)) flushWorktreeTelemetry();
                autoCommitArtifacts(taskIds, getActiveCwd(taskIds));
                pushed = pushBranch(taskIds);
            }
            if (cliArgs.pr && pushed) createDraftPr(taskIds);
            const doneFiles = taskIds.map(id => `tasks/${id}/done.md`).join(', ');
            console.log('');
            console.log('════════════════════════════════════════════════════════');
            console.log(state.isBundle
                ? `  🎯 Bundle ready for review! (${taskIds.length} tasks)`
                : `  🎯 Task ${taskIds[0]} is ready for your review!`);
            console.log(`  Read: ${doneFiles}`);
            if (!cliArgs.push && !cliArgs.pr) {
                console.log('');
                console.log(`  To push:              npx tsx scripts/run-task.ts ${taskIds.join(' ')} --push`);
                console.log(`  To push + draft PR:   npx tsx scripts/run-task.ts ${taskIds.join(' ')} --pr`);
                console.log(`  To send back to impl: npx tsx scripts/run-task.ts ${taskIds.join(' ')} --reroute`);
            }
            console.log(`  Merge + archive:      npx tsx scripts/run-task.ts ${taskIds.join(' ')} --ship`);
            console.log('════════════════════════════════════════════════════════');
            console.log('');
            process.exit(0);
            return;
        }

        case 'complete':
            info(`${state.isBundle ? 'Bundle' : `Task ${taskIds[0]}`} is already complete.`);
            process.exit(0);
            return;

        default:
            die(`Unknown phase: ${String(phase)}`);
    }
}

// ── Evidence-based phase advance + one-shot retry ─────────────────────────
// Background (2026-04-19): Codex "ran" scripts/task.sh phase smart-fill-v3
// implement done in its final summary — but never actually invoked the tool
// call. Every other action (code edits, validation) was real; only the
// silent-side-effect bookkeeping command was hallucinated. Pipeline bailed
// because phases.implement.status was still in_progress.
//
// Two-layer recovery, in order:
//
//   1. Evidence-based auto-advance. If the phase artifact (handoff.md,
//      review.md, etc.) shows the work actually completed, the pipeline
//      advances phases.X.status itself. Bookkeeping is pipeline-owned, not
//      agent-owned — the agent can't skip what isn't its job.
//
//   2. One-shot retry. If the artifact itself is missing/template (i.e.
//      the agent genuinely didn't finish), resume the session with a terse
//      corrective prompt and re-check. Single turn, cheap.
//
// If both fail, bail to human review as before.

interface EvidenceResult {
    advanced: boolean;
    verdict?: Verdict;
    note: string;
}

// Match "- [x] **Approved**" and variants in a review artifact.
function extractCheckedVerdict(content: string): Verdict | null {
    if (/^- \[x\] \*\*Approved\*\*/mi.test(content)) return 'approved';
    if (/^- \[x\] \*\*Approved with nits\*\*/mi.test(content)) return 'approved_with_nits';
    if (/^- \[x\] \*\*Changes requested\*\*/mi.test(content)) return 'changes_requested';
    if (/^- \[x\] \*\*Needs re-review\*\*/mi.test(content)) return 'needs_re_review';
    return null;
}

function readArtifact(taskId: string, name: string): string | null {
    const p = path.join(taskDirFor(taskId), name);
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// Return whether an artifact still looks like the unfilled template.
// [TASK-ID] is the canonical sentinel since it survives in every template
// file and `scripts/task.sh new` substitutes it on creation.
function isTemplateUnfilled(content: string | null): boolean {
    if (content === null) return true;
    return content.includes('[TASK-ID]');
}

function tryEvidenceAdvance(taskId: string, phase: Phase): EvidenceResult {
    switch (phase) {
        case 'implement': {
            // Three gates before auto-advancing (each rules out a different false-positive):
            //  1. handoff.md Changes table is non-empty (basic sanity)
            //  2. validateHandoff passes — same rule Claude's code review applies:
            //     Validation Outcomes table has no Fail and AC Coverage is present.
            //     Catches "Codex wrote a draft handoff before validation actually passed".
            //  3. at least one listed file exists on disk — catches phantom/hallucinated
            //     filenames in the Changes table.
            const files = parseHandoffFiles(taskId);
            if (files.length === 0) return { advanced: false, note: 'handoff.md Changes table is empty' };
            const issues = validateHandoff(taskId);
            if (issues.length > 0) return { advanced: false, note: `handoff.md validation failed: ${issues.join('; ')}` };
            const checkRoots = [REPO_ROOT];
            const sForEvidence = readStatus(taskId);
            if (sForEvidence.worktree === true) {
                const wt = worktreePath(taskId);
                if (fs.existsSync(wt)) checkRoots.push(wt);
            }
            const existingFiles = files.filter(f => checkRoots.some(root => fs.existsSync(path.join(root, f))));
            if (existingFiles.length === 0) {
                return { advanced: false, note: `handoff.md lists ${files.length} file(s) but none exist on disk` };
            }
            runTaskShFor(taskId, 'phase', taskId, 'implement', 'done');
            return { advanced: true, note: `handoff.md lists ${files.length} file(s) (${existingFiles.length} verified on disk), validation clean` };
        }
        case 'code_review': {
            const content = readArtifact(taskId, 'review.md');
            if (isTemplateUnfilled(content)) return { advanced: false, note: 'review.md is missing or still the template' };
            const verdict = extractCheckedVerdict(content!);
            if (!verdict) return { advanced: false, note: 'no verdict box checked in review.md' };
            runTaskShFor(taskId, 'phase', taskId, 'code_review', 'done', verdict);
            return { advanced: true, verdict, note: `verdict=${verdict}` };
        }
        case 'spec_review': {
            const content = readArtifact(taskId, 'spec-review.md');
            if (isTemplateUnfilled(content)) return { advanced: false, note: 'spec-review.md is missing or still the template' };
            const verdict = extractCheckedVerdict(content!);
            if (!verdict) return { advanced: false, note: 'no verdict box checked in spec-review.md' };
            runTaskShFor(taskId, 'phase', taskId, 'spec_review', 'done', verdict);
            return { advanced: true, verdict, note: `verdict=${verdict}` };
        }
        case 'plan': {
            const content = readArtifact(taskId, 'plan.md');
            if (isTemplateUnfilled(content)) return { advanced: false, note: 'plan.md is missing or still the template' };
            runTaskShFor(taskId, 'phase', taskId, 'plan', 'done');
            return { advanced: true, note: 'plan.md is populated' };
        }
        case 'spec': {
            const content = readArtifact(taskId, 'spec.md');
            if (isTemplateUnfilled(content)) return { advanced: false, note: 'spec.md is missing or still the template' };
            runTaskShFor(taskId, 'phase', taskId, 'spec', 'done');
            return { advanced: true, note: 'spec.md is populated' };
        }
        case 'qa': {
            // Upstream salvage (runPhase case 'qa') already handles the Haiku
            // stdout-streaming case. If we're still at qa != done here, the
            // done.md on disk is what we have to work with.
            const donePath = path.join(taskDirFor(taskId), 'done.md');
            if (isDoneMdTemplate(donePath)) return { advanced: false, note: 'done.md is still the template' };
            runTaskShFor(taskId, 'phase', taskId, 'qa', 'done');
            return { advanced: true, note: 'done.md is populated' };
        }
        default:
            return { advanced: false, note: `phase '${phase}' has no evidence rule` };
    }
}

// Resume the last agent session for this phase and prompt them to complete.
// Single turn, terse — the agent has full conversational context already.
async function retryAgentForPhase(taskId: string, phase: Phase, evidenceNote: string): Promise<'done' | 'drift' | 'no_session'> {
    const status = readStatus(taskId);
    const agent = status.phases[phase]?.agent;
    if (!agent || (agent !== 'codex' && agent !== 'claude')) return 'no_session';
    const sessionId = status.sessions?.[agent] ?? null;
    if (!sessionId) {
        warn(`Cannot retry ${phase} for ${taskId}: no ${agent} session ID stored.`);
        return 'no_session';
    }

    const verdictHint = (phase === 'spec_review' || phase === 'code_review') ? ' <verdict>' : '';
    const prompt = [
        `PIPELINE GUARDRAIL: phases.${phase}.status for task ${taskId} is still '${getPhaseStatus(status, phase)}'.`,
        `Evidence check: ${evidenceNote}.`,
        '',
        'Your previous turn ended without completing the phase. Finish the work now (write the artifact if missing, commit if needed), then run:',
        `  scripts/task.sh phase ${taskId} ${phase} done${verdictHint}`,
        '',
        'Reply with tool calls only. No summary, no explanation.',
    ].join('\n');

    warn(`Retrying ${agent} session ${sessionId.slice(0, 8)}... for ${taskId} ${phase}.`);
    // Implement retries must use the worktree CWD if the task has one.
    const retryCwd = (agent === 'codex' && phase === 'implement') ? getActiveCwd([taskId]) : REPO_ROOT;
    if (agent === 'codex') {
        // Retry phase must be a Codex-run phase. spec_review and implement are
        // the only two; anything else indicates a stored agent mismatch.
        if (phase !== 'spec_review' && phase !== 'implement') {
            warn(`Cannot retry ${phase} with Codex — not a Codex-run phase.`);
            return 'no_session';
        }
        const retryTasks: TaskContext[] = [{
            taskId, title: status.title ?? taskId, specReviewVerdict: '',
            iterations: 0, rerouteCount: 0, status,
        }];
        const cfg = getCodexConfig(phase, retryTasks);
        await runCodex(prompt, false, sessionId, cfg.model, cfg.effort, undefined, retryCwd);
    } else {
        if (phase !== 'spec' && phase !== 'plan' && phase !== 'code_review' && phase !== 'qa') {
            warn(`Cannot retry ${phase} with Claude — not a Claude-run phase.`);
            return 'no_session';
        }
        const retryTasks: TaskContext[] = [{
            taskId, title: status.title ?? taskId, specReviewVerdict: '',
            iterations: 0, rerouteCount: 0, status,
        }];
        const cfg = getClaudeConfig(phase, retryTasks);
        await runClaude(prompt, false, sessionId, cfg.model, cfg.effort, undefined, retryCwd);
    }

    return getPhaseStatus(readStatus(taskId), phase) === 'done' ? 'done' : 'drift';
}

// Wraps evidence-advance + retry + post-retry-evidence in a single recovery
// attempt for one task. Returns true if the phase is now 'done' (by any path).
async function recoverPhaseForTask(taskId: string, phase: Phase, initialStatus: PhaseStatus): Promise<boolean> {
    const evidence = tryEvidenceAdvance(taskId, phase);
    if (evidence.advanced) {
        warn(`Auto-advanced '${phase}' for '${taskId}' (was ${initialStatus}; ${evidence.note}). Agent skipped task.sh bookkeeping.`);
        return true;
    }

    warn(`Evidence insufficient for '${taskId}' ${phase}: ${evidence.note}. Attempting one-shot retry.`);
    const retry = await retryAgentForPhase(taskId, phase, evidence.note);
    if (retry === 'no_session') return false;
    if (retry === 'done') {
        warn(`Retry succeeded — '${taskId}' ${phase} is now done.`);
        return true;
    }

    // Retry ran but status still isn't done. Check evidence once more — maybe
    // the agent produced the artifact on retry but skipped task.sh again.
    const postEvidence = tryEvidenceAdvance(taskId, phase);
    if (postEvidence.advanced) {
        warn(`Retry produced artifact — auto-advanced (${postEvidence.note}).`);
        return true;
    }
    warn(`Retry did not recover '${taskId}' ${phase} (${postEvidence.note}).`);
    return false;
}

// ── checkAndRoute ──────────────────────────────────────────────────────────

async function checkAndRoute(phase: Phase, taskIds: string[]): Promise<void> {
    let statuses = taskIds.map(readStatus);

    // Verify all tasks completed this phase. If any didn't, attempt
    // evidence-based auto-advance, then a one-shot retry, before bailing.
    for (let i = 0; i < taskIds.length; i += 1) {
        const phaseStatus = getPhaseStatus(statuses[i], phase);
        if (phaseStatus !== 'done') {
            if (lastCodexExitStatus !== 0) {
                warn(`Codex exited with status ${lastCodexExitStatus} and '${phase}' was not completed for '${taskIds[i]}'.`);
            }
            const recovered = await recoverPhaseForTask(taskIds[i], phase, phaseStatus);
            if (!recovered) {
                warn(`Phase '${phase}' did not reach 'done' for '${taskIds[i]}'. Stopping for human review.`);
                process.exit(2);
            }
        }
    }

    // Re-read after any auto-advances so downstream verdict/iteration checks
    // see the fresh state.
    statuses = taskIds.map(readStatus);

    if (lastCodexExitStatus !== 0) {
        warn(`Phase '${phase}' completed despite Codex exit status ${lastCodexExitStatus} (likely MCP warnings). Continuing.`);
        lastCodexExitStatus = 0;
    }

    switch (phase) {
        case 'spec_review': {
            const anyChangesRequested = statuses.some(s => getVerdict(s, 'spec_review') === 'changes_requested');
            if (anyChangesRequested) {
                info('Spec review requested changes — routing back to spec.');
                routeBackTo(taskIds, 'spec');
                return;
            }
            // Full tier: human gate fires after Codex spec_review completes
            const tier = detectTier(statuses);
            if (tier === 'full' && statuses.some(s => s.human_spec_gate)) {
                for (const taskId of taskIds) {
                    const s = readStatus(taskId);
                    s.human_spec_gate = false;
                    writeStatus(taskId, s);
                }
                const specList = taskIds.map(id => `  tasks/${id}/spec.md`).join('\n');
                const reviewList = taskIds.map(id => `  tasks/${id}/spec-review.md`).join('\n');
                console.log('');
                console.log('════════════════════════════════════════════════════════');
                console.log('  ✋  SPEC GATE — Human review required before planning.');
                console.log('');
                console.log('  Specs:');
                console.log(specList);
                console.log('  Codex reviews:');
                console.log(reviewList);
                console.log('');
                console.log(`  When ready: npx tsx scripts/run-task.ts ${taskIds.join(' ')}`);
                console.log('════════════════════════════════════════════════════════');
                console.log('');
                process.exit(0);
            }
            return;
        }

        case 'implement':
            autoCommitCode(taskIds, getActiveCwd(taskIds));
            return;

        case 'code_review': {
            const anyChangesRequested = statuses.some(s =>
                getVerdict(s, 'code_review') === 'changes_requested' ||
                getVerdict(s, 'code_review') === 'needs_re_review'
            );
            if (anyChangesRequested) {
                const maxIter = statuses.reduce((max, s) => Math.max(max, getIterations(s)), 0);
                info(`Code review requested changes (iteration ${maxIter}) — routing back to implement`);
                routeBackTo(taskIds, 'implement');
            }
            return;
        }

        default:
            return;
    }
}

// ── Dependency check ───────────────────────────────────────────────────────

function checkDeps(taskIds: string[], skipAgentDeps = false): void {
    if (!skipAgentDeps) {
        for (const dep of ['jq', 'claude', 'codex']) {
            const result = spawnSync('which', [dep], { stdio: 'ignore' });
            if (result.error || result.status !== 0) {
                const label = dep === 'claude' ? 'Claude Code CLI' : dep === 'codex' ? 'Codex CLI' : dep;
                die(`${label} is required`);
            }
        }
        ghAvailable = isCommandAvailable('gh');
        info(ghAvailable
            ? 'gh CLI found — draft PR creation is available.'
            : 'gh CLI not found — PR creation will be unavailable. Push still works.');
    }

    for (const taskId of taskIds) {
        validateTaskId(taskId);
        if (!fs.existsSync(statusFileFor(taskId))) {
            die(`No status.json at tasks/${taskId}/status.json — run ./scripts/task.sh new ${taskId} first`);
        }
    }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    // Mark all child processes as orchestrator-driven so .githooks/pre-commit
    // and .githooks/pre-push know to skip — the orchestrator already runs
    // validation per phase and re-running it on every auto-commit is waste.
    process.env.RUN_TASK_ORCHESTRATOR = '1';
    cliArgs = parseArgs(process.argv.slice(2));
    warnLegacyEnvVars();
    warnWorktreesRootMismatch();
    const skipAgentDeps = cliArgs.ship;
    checkDeps(cliArgs.taskIds, skipAgentDeps);

    if (cliArgs.ship) {
        shipTasks(cliArgs.taskIds);
    }

    if (cliArgs.reroute) {
        rerouteFromHumanReview(cliArgs.taskIds);
    }

    const { taskIds } = cliArgs;
    const initialState = buildPipelineState(taskIds);

    info(initialState.isBundle
        ? `Pipeline (bundle, ${initialState.tier} tier): ${taskIds.join(', ')}`
        : `Pipeline (${initialState.tier} tier): ${taskIds[0]} — ${initialState.tasks[0].title}`);
    console.log('');

    let expectChecked = false;

    while (true) {
        const currentPhase = assertSamePhase(taskIds);

        if (!expectChecked && cliArgs.expectPhase) {
            if (currentPhase !== cliArgs.expectPhase) {
                die(`--expect ${cliArgs.expectPhase} but current phase is ${currentPhase}`);
            }
            expectChecked = true;
        }

        console.log('────────────────────────────────────────');
        info(`Current phase: ${currentPhase}`);
        console.log('────────────────────────────────────────');

        const state = buildPipelineState(taskIds);
        await runPhase(currentPhase, state);

        // In worktree mode, sync task artifacts from worktree → main repo so the
        // pipeline can read them via taskDirFor() (which always returns REPO_ROOT paths).
        // status.json is kept in sync separately via phaseCommands' `cd REPO_ROOT` wrapper.
        // Telemetry files (task-quality-log, lessons-learned, etc.) get mirrored to
        // REPO_ROOT and reverted in the worktree so the eventual flushWorktreeTelemetry
        // commit-on-main path actually sees them.
        if (isWorktreeEnabled(taskIds)) {
            syncWorktreeArtifacts(taskIds);
            syncWorktreeTelemetry(taskIds);
        }

        // Store session IDs after each agent phase for resumption.
        // Sessions are stored per-cluster, not per-phase:
        //   spec/spec_revision → claude_spec  (both run in REPO_ROOT, share continuity)
        //   code_review        → claude_review (same worktree cwd across rounds)
        //   plan, qa           → not stored    (one-offs, always fresh)
        if (currentPhase !== 'complete' && currentPhase !== 'human_review') {
            const agentForPhase = state.tasks[0].status.phases[currentPhase]?.agent;
            if (agentForPhase === 'claude') {
                const slot: SessionSlot | null =
                    currentPhase === 'spec' ? 'claude_spec' :
                    currentPhase === 'code_review' ? 'claude_review' :
                    null; // plan, qa: one-offs, don't persist
                if (slot && lastClaudeSessionId) {
                    storeSessionId(taskIds, slot, lastClaudeSessionId);
                    info(`Claude session stored (${slot}): ${lastClaudeSessionId.slice(0, 8)}...`);
                }
            } else if (agentForPhase === 'codex' && lastCodexSessionId) {
                storeSessionId(taskIds, 'codex', lastCodexSessionId);
                info(`Codex session stored: ${lastCodexSessionId.slice(0, 8)}...`);
            }
            await checkAndRoute(currentPhase, taskIds);
        }

        if (cliArgs.step) {
            const nextPhase = assertSamePhase(taskIds);
            info('Step mode: stopping after one phase.');
            info(`Next phase: ${nextPhase}`);
            // Exit non-zero if the phase didn't advance (artifact check reset it to pending,
            // or the sub-agent failed without calling task.sh). This makes failures visible
            // to callers checking $? instead of silently exiting 0.
            if (nextPhase === currentPhase) {
                warn(`Phase ${currentPhase} did not advance after running — sub-agent likely failed. Check the artifact and logs.`);
                process.exit(1);
            }
            process.exit(0);
        }

        console.log('');
    }
}

// Only run the CLI when invoked directly (not when imported by tests).
if (process.argv[1] === __filename) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.stack ?? err.message : err);
        process.exit(1);
    });
}
