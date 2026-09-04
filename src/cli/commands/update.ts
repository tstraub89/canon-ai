import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

import { CANON_UPSTREAM_REPO } from '../../orchestrator/canon-snapshot.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

export type InstallType = 'local' | 'global' | 'npx';

export interface InstallDetection {
    type: InstallType;
    installRoot: string | null;
}

export function detectInstallType(pkgDirOverride?: string): InstallDetection {
    const dir = pkgDirOverride ?? packageDir;
    if (dir.includes('/_npx/') || dir.includes('\\_npx\\')) return { type: 'npx', installRoot: null };

    // Check the package's own install path — handles subdirectory invocations correctly.
    const firstNodeModulesIdx = dir.indexOf('/node_modules/');
    const nodeModulesIdx = dir.lastIndexOf('/node_modules/');
    if (nodeModulesIdx !== -1) {
        const projectRoot = dir.slice(0, nodeModulesIdx);
        if (existsSync(join(projectRoot, 'package.json'))) {
            return { type: 'local', installRoot: realpathSync(projectRoot) };
        }
        // A nested node_modules layout is a local-shaped install (for example,
        // pnpm's virtual store). Its nearest package root may not have the
        // adopter manifest, so surface it to the layout gate instead of
        // silently treating it as a global install.
        if (firstNodeModulesIdx !== nodeModulesIdx && existsSync(projectRoot)) {
            return { type: 'local', installRoot: realpathSync(projectRoot) };
        }
    }
    return { type: 'global', installRoot: null };
}

export interface UpdateOptions {
    channel?: 'main';
    ref?: string;
}

export function parseUpdateArgs(args: string[]): UpdateOptions {
    const options: UpdateOptions = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--channel') {
            const value = args[++i];
            if (value !== 'main') {
                throw new Error(`canon update: --channel only supports 'main'. Got '${value ?? '(missing)'}'.`);
            }
            options.channel = 'main';
        } else if (arg === '--ref') {
            const value = args[++i];
            if (!value) throw new Error('canon update: --ref requires a value.');
            if (value.startsWith('-')) throw new Error('canon update: --ref value must not start with \'-\'.');
            options.ref = value;
        } else {
            throw new Error(`canon update: unknown flag '${arg}'. Supported: --channel main, --ref <ref|sha>.`);
        }
    }
    if (options.channel && options.ref) {
        throw new Error('canon update: --channel and --ref are mutually exclusive.');
    }
    return options;
}

export type ResolveResult =
    | { ok: true; sha: string; version?: string }
    | { ok: false; message: string };

export type GitRunner = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

const GIT_RESOLUTION_TIMEOUT_MS = 30_000;

function nonInteractiveSshCommand(configuredCommand: string | undefined): string {
    const command = configuredCommand?.trim();
    if (!command) return 'ssh -oBatchMode=yes';

    const compactBatchMode = /(^|\s)-oBatchMode=(?:yes|no)(?=\s|$)/i;
    if (compactBatchMode.test(command)) return command.replace(compactBatchMode, '$1-oBatchMode=yes');

    const splitBatchMode = /(^|\s)-o\s+BatchMode=(?:yes|no)(?=\s|$)/i;
    if (splitBatchMode.test(command)) return command.replace(splitBatchMode, '$1-o BatchMode=yes');

    return `${command} -oBatchMode=yes`;
}

export function defaultGitRunner(args: string[]): { ok: boolean; stdout: string; stderr: string } {
    const result = spawnSync('git', args, {
        encoding: 'utf8',
        timeout: GIT_RESOLUTION_TIMEOUT_MS,
        env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_SSH_COMMAND: nonInteractiveSshCommand(process.env.GIT_SSH_COMMAND),
        },
    });
    if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
    return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}

const CANON_AI_DEP_KEYS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const STRICT_FINAL_TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

type GatePass = { ok: true };
type GateFailure = { ok: false; message: string };

export function layoutGate(installRoot: string): GatePass | GateFailure {
    if (!existsSync(join(installRoot, 'package.json'))) {
        return {
            ok: false,
            message: `canon update: no package.json found at ${installRoot} — this doesn't look like an install root. Refusing to run npm here.`,
        };
    }
    return { ok: true };
}

type DependencyGateResult =
    | { ok: true; manifest: Record<string, unknown>; dependencyBlock: CanonDependencyBlock }
    | GateFailure;

type CanonDependencyBlock = (typeof CANON_AI_DEP_KEYS)[number];

function dependencyGate(installRoot: string): DependencyGateResult {
    const manifestPath = join(installRoot, 'package.json');
    let manifest: unknown;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
        return {
            ok: false,
            message: `canon update: ${manifestPath} could not be parsed as JSON — refusing to update. Fix the manifest and retry.`,
        };
    }
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
        return { ok: false, message: `canon update: ${manifestPath} is not a JSON object — refusing to update.` };
    }

    const obj = manifest as Record<string, unknown>;
    const dependencyBlock = CANON_AI_DEP_KEYS.find(key => {
        const block = obj[key];
        return typeof block === 'object' && block !== null && !Array.isArray(block)
            && Object.prototype.hasOwnProperty.call(block, 'canon-ai');
    });
    if (!dependencyBlock) {
        return {
            ok: false,
            message: `canon update: ${manifestPath} does not list canon-ai in dependencies, devDependencies, or optionalDependencies — refusing to run npm install here.`,
        };
    }
    return { ok: true, manifest: obj, dependencyBlock };
}

interface TagEntry {
    sha?: string;
    peeledSha?: string;
}

function parseLsRemoteTags(stdout: string): Map<string, TagEntry> {
    const tags = new Map<string, TagEntry>();
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const tabIdx = line.indexOf('\t');
        if (tabIdx === -1) continue;
        const sha = line.slice(0, tabIdx);
        let ref = line.slice(tabIdx + 1);
        const isPeeled = ref.endsWith('^{}');
        if (isPeeled) ref = ref.slice(0, -3);
        if (!FULL_SHA_RE.test(sha) || !ref.startsWith('refs/tags/')) continue;
        const name = ref.slice('refs/tags/'.length);
        const entry = tags.get(name) ?? {};
        if (isPeeled) entry.peeledSha = sha;
        else entry.sha = sha;
        tags.set(name, entry);
    }
    return tags;
}

function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
}

type GitFallbackResult =
    | { ok: true; stdout: string }
    | { ok: false; httpsStderr: string; sshStderr: string };

function githubHttpsUrl(slug: string): string {
    return `https://github.com/${slug}.git`;
}

function githubSshUrl(slug: string): string {
    return `git@github.com:${slug}.git`;
}

function runGitWithFallback(
    slug: string,
    buildArgs: (remote: string) => string[],
    runGit: GitRunner,
): GitFallbackResult {
    const httpsResult = runGit(buildArgs(githubHttpsUrl(slug)));
    if (httpsResult.ok) return { ok: true, stdout: httpsResult.stdout };

    const sshResult = runGit(buildArgs(githubSshUrl(slug)));
    if (sshResult.ok) return { ok: true, stdout: sshResult.stdout };

    return {
        ok: false,
        httpsStderr: httpsResult.stderr,
        sshStderr: sshResult.stderr,
    };
}

export function resolveStable(slug: string, runGit: GitRunner): ResolveResult {
    const result = runGitWithFallback(slug, remote => ['ls-remote', '--tags', remote], runGit);
    if (!result.ok) {
        return {
            ok: false,
            message: `canon update: could not list release tags for ${slug} over https (${result.httpsStderr || 'no output'}) or ssh (${result.sshStderr || 'no output'}). Check network access and GitHub auth. Aborting — no npm install run.`,
        };
    }

    const tags = parseLsRemoteTags(result.stdout);
    const finalTagNames = [...tags.keys()].filter(name => STRICT_FINAL_TAG_RE.test(name));
    if (finalTagNames.length === 0) {
        return {
            ok: false,
            message: `canon update: no final release tags (vX.Y.Z) found on ${slug}. Aborting — no npm install run, no fallback to an unpinned source.`,
        };
    }
    finalTagNames.sort((a, b) => compareSemver(a.slice(1), b.slice(1)));
    const chosen = finalTagNames[finalTagNames.length - 1];
    const entry = tags.get(chosen);
    const sha = entry?.peeledSha ?? entry?.sha;
    if (!sha) {
        return {
            ok: false,
            message: `canon update: release tag ${chosen} on ${slug} has no commit SHA. Aborting — no npm install run.`,
        };
    }
    return { ok: true, sha, version: chosen.slice(1) };
}

function parseRemoteRefs(stdout: string): Map<string, { sha?: string; peeledSha?: string }> {
    const refs = new Map<string, { sha?: string; peeledSha?: string }>();
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const tabIdx = line.indexOf('\t');
        if (tabIdx === -1) continue;
        const sha = line.slice(0, tabIdx);
        let ref = line.slice(tabIdx + 1);
        const isPeeled = ref.endsWith('^{}');
        if (isPeeled) ref = ref.slice(0, -3);
        if (!FULL_SHA_RE.test(sha)) continue;
        const entry = refs.get(ref) ?? {};
        if (isPeeled) entry.peeledSha = sha;
        else entry.sha = sha;
        refs.set(ref, entry);
    }
    return refs;
}

export function resolveNamedRef(slug: string, refspec: string, runGit: GitRunner): ResolveResult {
    const result = runGitWithFallback(slug, remote => ['ls-remote', remote, refspec], runGit);
    if (!result.ok) {
        return {
            ok: false,
            message: `canon update: could not resolve '${refspec}' on ${slug} over https (${result.httpsStderr || 'no output'}) or ssh (${result.sshStderr || 'no output'}). Check network access and GitHub auth. Aborting — no npm install run.`,
        };
    }

    const refs = parseRemoteRefs(result.stdout);
    const distinctShas = new Set([...refs.values()]
        .map(entry => entry.peeledSha ?? entry.sha)
        .filter((sha): sha is string => sha !== undefined));
    if (distinctShas.size === 0) {
        return { ok: false, message: `canon update: no remote ref matched '${refspec}' on ${slug}. Aborting — no npm install run.` };
    }
    if (distinctShas.size > 1) {
        return { ok: false, message: `canon update: '${refspec}' matched ${distinctShas.size} distinct commits on ${slug} — ambiguous. Aborting — no npm install run.` };
    }
    return { ok: true, sha: [...distinctShas][0] };
}

function currentPinFromManifest(manifest: Record<string, unknown>): string {
    for (const key of CANON_AI_DEP_KEYS) {
        const block = manifest[key];
        if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
        const value = (block as Record<string, unknown>)['canon-ai'];
        if (typeof value !== 'string') continue;
        const match = /#([0-9a-f]{40})$/i.exec(value.trim());
        if (match) return match[1].toLowerCase();
        const versionMatch = /^[~^]?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?)$/.exec(value.trim());
        if (versionMatch) return versionMatch[1];
    }
    return 'unknown';
}

function bakedVersion(): string {
    return process.env.CANON_VERSION ?? 'dev';
}

function ownPackageName(pkgDir: string): string {
    try {
        const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>;
        return typeof manifest.name === 'string' && manifest.name ? manifest.name : 'canon-ai';
    } catch {
        return 'canon-ai';
    }
}

export type NpmViewRunner = (args: string[], cwd?: string) => { status: number | null; stdout: string; stderr: string };

const NPM_VIEW_TIMEOUT_MS = 30_000;

export function defaultNpmViewRunner(args: string[], cwd?: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('npm', args, { encoding: 'utf8', timeout: NPM_VIEW_TIMEOUT_MS, ...(cwd ? { cwd } : {}) });
    if (result.error) return { status: null, stdout: '', stderr: result.error.message };
    return { status: result.status, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}

export type RegistryCheckResult =
    | { ok: true }
    | { ok: false; absent: true; message: string }
    | { ok: false; absent: false; message: string };

export function checkRegistryVersion(pkgName: string, version: string, runner: NpmViewRunner, cwd?: string): RegistryCheckResult {
    const result = runner(['view', `${pkgName}@${version}`, 'version', '--json'], cwd);
    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout); } catch { parsed = undefined; }

    if (result.status === 0 && typeof parsed === 'string' && parsed === version) return { ok: true };
    if (typeof parsed === 'object' && parsed !== null
        && (parsed as { error?: { code?: unknown } }).error?.code === 'E404') {
        return {
            ok: false,
            absent: true,
            message: `canon update: ${pkgName}@${version} is not yet on the npm registry. This release exists on GitHub but has not reached npm yet — retry shortly, or install it directly with \`canon update --ref v${version}\`.`,
        };
    }
    return {
        ok: false,
        absent: false,
        message: `canon update: could not verify ${pkgName}@${version} on the npm registry (${result.stderr || 'no output'}). Aborting — no npm install run.`,
    };
}

interface AnnouncementInput {
    installType: 'local' | 'global';
    installRoot: string | null;
    currentVersion: string;
    currentSha: string;
    channel: 'stable' | 'main' | 'ref';
    targetVersion: string;
    targetSha: string;
}

function formatAnnouncement(input: AnnouncementInput): string {
    const where = input.installType === 'local' ? `local install at ${input.installRoot}` : 'global install';
    const targetLabel = input.channel === 'stable'
        ? `${input.targetVersion} (stable)`
        : `${input.channel} (development)`;
    return [
        '',
        `canon update — ${where}`,
        `  current: ${input.currentVersion} @ ${input.currentSha}`,
        `  target:  ${targetLabel} @ ${input.targetSha}`,
        '',
    ].join('\n');
}

export interface Provenance {
    source: string;
    channel: 'stable' | 'main' | 'ref';
    resolved_sha: string;
    updated_at: string;
    version?: string;
}

function writeProvenance(root: string, provenance: Provenance): void {
    const canonDir = join(root, '.canon');
    mkdirSync(canonDir, { recursive: true });
    writeFileSync(join(canonDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
}

interface SpawnResult {
    status: number | null;
}

export interface UpdateCmdDeps {
    packageDir?: string;
    cwd?: string;
    spawnRunner?: (cmd: string, args: string[], opts: { cwd: string }) => SpawnResult;
    gitRunner?: GitRunner;
    npmViewRunner?: NpmViewRunner;
    exit?: (code: number) => never;
    stdout?: (message: string) => void;
    stderr?: (message: string) => void;
    now?: () => string;
}

export function updateCmd(args: string[], deps: UpdateCmdDeps = {}): void {
    const exit = deps.exit ?? ((code: number): never => process.exit(code));
    const stdout = deps.stdout ?? ((message: string): void => { console.log(message); });
    const stderr = deps.stderr ?? ((message: string): void => { console.error(message); });
    const pkgDir = deps.packageDir ?? packageDir;
    const pkgName = ownPackageName(pkgDir);
    const cwd = deps.cwd ?? process.cwd();
    const spawn = deps.spawnRunner ?? ((cmd: string, cmdArgs: string[], opts: { cwd: string }): SpawnResult => (
        spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: opts.cwd })
    ));
    const runGit = deps.gitRunner ?? defaultGitRunner;
    const nowIso = deps.now ?? ((): string => new Date().toISOString());

    let options: UpdateOptions;
    try {
        options = parseUpdateArgs(args);
    } catch (error) {
        stderr(error instanceof Error ? error.message : String(error));
        return exit(1);
    }

    const detection = detectInstallType(pkgDir);
    if (detection.type === 'npx') {
        stdout('\nRunning via npx — no persistent install to update.');
        stdout('To apply the latest templates, re-run from the latest source:\n');
        stdout(`  npx ${pkgName}@latest upgrade\n`);
        return;
    }

    let manifest: Record<string, unknown> | null = null;
    let dependencyBlock: CanonDependencyBlock = 'devDependencies';
    if (detection.type === 'local') {
        const installRoot = detection.installRoot as string;
        const layout = layoutGate(installRoot);
        if (!layout.ok) {
            stderr(layout.message);
            return exit(1);
        }
        const dependency = dependencyGate(installRoot);
        if (!dependency.ok) {
            stderr(dependency.message);
            return exit(1);
        }
        manifest = dependency.manifest;
        dependencyBlock = dependency.dependencyBlock;
    }

    const upstreamOverride = process.env.CANON_UPSTREAM_REPO?.trim();
    const slug = upstreamOverride ? upstreamOverride : CANON_UPSTREAM_REPO;
    const usesRegistry = options.channel !== 'main' && !options.ref && !upstreamOverride;
    const npmView = deps.npmViewRunner ?? defaultNpmViewRunner;
    let channel: 'stable' | 'main' | 'ref';
    let resolvedSha: string;
    let stableVersion: string | undefined;

    if (options.ref && FULL_SHA_RE.test(options.ref)) {
        channel = 'ref';
        resolvedSha = options.ref.toLowerCase();
    } else if (options.channel === 'main') {
        channel = 'main';
        const result = resolveNamedRef(slug, 'refs/heads/main', runGit);
        if (!result.ok) {
            stderr(result.message);
            return exit(1);
        }
        resolvedSha = result.sha;
    } else if (options.ref) {
        channel = 'ref';
        const result = resolveNamedRef(slug, options.ref, runGit);
        if (!result.ok) {
            stderr(result.message);
            return exit(1);
        }
        resolvedSha = result.sha;
    } else {
        channel = 'stable';
        const result = resolveStable(slug, runGit);
        if (!result.ok) {
            stderr(result.message);
            return exit(1);
        }
        resolvedSha = result.sha;
        stableVersion = result.version;
    }

    if (usesRegistry) {
        const registryCwd = detection.type === 'local' ? detection.installRoot as string : cwd;
        const registryCheck = checkRegistryVersion(pkgName, stableVersion as string, npmView, registryCwd);
        if (!registryCheck.ok) {
            stderr(registryCheck.message);
            return exit(1);
        }
    }

    const target = usesRegistry ? `${pkgName}@${stableVersion}` : `github:${slug}#${resolvedSha}`;
    const currentSha = manifest ? currentPinFromManifest(manifest) : 'unknown';
    stdout(formatAnnouncement({
        installType: detection.type,
        installRoot: detection.installRoot,
        currentVersion: bakedVersion(),
        currentSha,
        channel,
        targetVersion: stableVersion ?? 'unknown',
        targetSha: resolvedSha,
    }));

    const provenance: Provenance = {
        source: target,
        channel,
        resolved_sha: resolvedSha,
        updated_at: nowIso(),
        ...(stableVersion ? { version: stableVersion } : {}),
    };

    if (detection.type === 'local') {
        const installRoot = detection.installRoot as string;
        const saveFlag = dependencyBlock === 'dependencies'
            ? '--save'
            : dependencyBlock === 'optionalDependencies'
                ? '--save-optional'
                : '--save-dev';
        const installArgs = usesRegistry
            ? ['install', saveFlag, target]
            : ['install', saveFlag, '--install-links', target];
        const result = spawn('npm', installArgs, { cwd: installRoot });
        if (result.status !== 0) return exit(result.status ?? 1);
        try {
            writeProvenance(installRoot, provenance);
        } catch (error) {
            const detail = error instanceof Error ? ` (${error.message})` : '';
            stderr(`canon update: npm install succeeded, but provenance could not be recorded at ${join(installRoot, '.canon', 'provenance.json')}${detail}.`);
        }
    } else {
        const installArgs = usesRegistry ? ['install', '-g', target] : ['install', '-g', '--install-links', target];
        const result = spawn('npm', installArgs, { cwd });
        if (result.status !== 0) return exit(result.status ?? 1);
        if (existsSync(join(cwd, '.canon'))) {
            try {
                writeProvenance(cwd, provenance);
            } catch (error) {
                const detail = error instanceof Error ? ` (${error.message})` : '';
                stderr(`canon update: npm install succeeded, but provenance could not be recorded at ${join(cwd, '.canon', 'provenance.json')}${detail}.`);
            }
        } else {
            stdout('(no .canon/ directory found in the current repo — provenance not recorded. Run `canon init` here first to persist it on future updates.)');
        }
    }

    stdout('\ncanon-ai updated. Run `canon upgrade` to sync vendored files in this repo.\n');
}
