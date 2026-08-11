import fs from 'node:fs';
import path from 'node:path';

import { info, warn, die } from './cli.js';
import { REPO_ROOT, WORKTREES_ROOT } from './env.js';
import { git, gitSafe } from './git.js';
import { readStatus } from './state.js';

export const PIPELINE_TELEMETRY_FILES = [
    'docs/pipeline-invocations.md',
    'docs/task-quality-log.md',
    'docs/lessons-learned.md',
] as const;

export const PIPELINE_MANAGED_DOCS = [
    'docs/architecture.md',
    'docs/codebase-map.md',
    'docs/decisions.md',
    'docs/patterns.md',
    'docs/pipeline-orchestrator.md',
    'docs/product-context.md',
] as const;

export const PIPELINE_SHARED_DOCS = [...PIPELINE_TELEMETRY_FILES, ...PIPELINE_MANAGED_DOCS] as const;

export const TASK_ARTIFACT_FILES = new Set([
    'spec.md', 'spec-review.md', 'plan.md', 'handoff.md', 'review.md', 'done.md', 'pr-body.md', 'notes.md',
]);

export function worktreePath(taskId: string): string {
    return path.join(WORKTREES_ROOT, taskId);
}

export function isWorktreeEnabled(taskIds: string[]): boolean {
    return readStatus(taskIds[0]).worktree === true;
}

export interface GetActiveCwdOptions {
    /**
     * When true: if the worktree is expected (worktree: true in status.json) but
     * missing from disk, log a warning and return REPO_ROOT instead of dying.
     * Use for callers that can recover from partial-cleanup state (e.g., the
     * --ship flow, where a user may have manually `git worktree remove`'d
     * the directory before re-running --ship). Default false enforces the
     * pre-existing strict behavior for active-pipeline callers.
     */
    tolerateMissingWorktree?: boolean;
}

export function getActiveCwd(taskIds: string[], options: GetActiveCwdOptions = {}): string {
    if (isWorktreeEnabled(taskIds)) {
        const wt = worktreePath(taskIds[0]);
        if (fs.existsSync(wt)) return wt;
        const branch = readStatus(taskIds[0]).branch;
        if (branch) {
            const existing = findExistingWorktreeForBranch(branch);
            if (existing) return existing;
            if (options.tolerateMissingWorktree) {
                warn(
                    `Worktree for task '${taskIds[0]}' is expected but missing — ` +
                    `continuing with REPO_ROOT. (Partial-cleanup state recovery.)`,
                );
                return REPO_ROOT;
            }
            die(
                `Worktree for task '${taskIds[0]}' is expected but missing.\n` +
                `  Restore or recreate the worktree before continuing.`,
            );
        }
    }
    return REPO_ROOT;
}

export function findExistingWorktreeForBranch(branch: string): string | null {
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

export type NodeModulesLstatKind = 'missing' | 'file' | 'directory' | 'symlink' | 'error';

export type NodeModulesLinkInputs = {
    lstatKind: NodeModulesLstatKind;
    resolvedTarget: string | null;
    expectedTarget: string | null;
};

export type NodeModulesLinkVerdict = 'verified-symlink' | 'not-exempt';

export function classifyNodeModulesLinkFromData(input: NodeModulesLinkInputs): NodeModulesLinkVerdict {
    if (input.lstatKind !== 'symlink') return 'not-exempt';
    if (input.resolvedTarget === null || input.expectedTarget === null) return 'not-exempt';
    return input.resolvedTarget === input.expectedTarget ? 'verified-symlink' : 'not-exempt';
}

function probeNodeModulesLstatKind(candidatePath: string): NodeModulesLstatKind {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(candidatePath);
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error';
    }
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isDirectory()) return 'directory';
    return 'file';
}

function realpathOrNull(candidatePath: string): string | null {
    try {
        return fs.realpathSync(candidatePath);
    } catch {
        return null;
    }
}

function isAbsentPathError(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

export function resolveContainedPath(candidateAbsPath: string, rootAbsPath: string): string | null {
    const resolvedCandidate = realpathOrNull(candidateAbsPath);
    const resolvedRoot = realpathOrNull(rootAbsPath);
    if (resolvedCandidate === null || resolvedRoot === null) return null;
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    const contained = relative !== '' &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative);
    return contained ? resolvedCandidate : null;
}

export function isContainedIn(candidateAbsPath: string, rootAbsPath: string): boolean {
    return resolveContainedPath(candidateAbsPath, rootAbsPath) !== null;
}

function extractWorkspacePatterns(pkg: unknown, emitWarnings: boolean): string[] {
    if (typeof pkg !== 'object' || pkg === null) return [];
    const workspaces = (pkg as { workspaces?: unknown }).workspaces;
    let entries: unknown[];
    if (Array.isArray(workspaces)) {
        entries = workspaces;
    } else if (typeof workspaces === 'object' && workspaces !== null) {
        const packages = (workspaces as { packages?: unknown }).packages;
        if (!Array.isArray(packages)) return [];
        entries = packages;
    } else {
        return [];
    }

    const patterns: string[] = [];
    for (const entry of entries) {
        if (typeof entry !== 'string') continue;
        if (entry.startsWith('!')) {
            if (emitWarnings) warn(`Ignoring unsupported negated workspace pattern: ${entry}`);
            continue;
        }
        patterns.push(entry);
    }
    return patterns;
}

export function resolveWorkspaceDirs(
    repoRoot: string,
    options: { emitWarnings?: boolean } = {},
): string[] {
    const emitWarnings = options.emitWarnings !== false;
    let pkg: unknown;
    try {
        pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as unknown;
    } catch (err) {
        if (emitWarnings && !isAbsentPathError(err)) {
            warn(`Could not read or parse ${path.join(repoRoot, 'package.json')}; workspace links are disabled.`);
        }
        return [];
    }

    const patterns = extractWorkspacePatterns(pkg, emitWarnings);
    if (patterns.length === 0) return [];

    const matches = new Set<string>();
    for (const pattern of patterns) {
        const normalizedPattern = path.normalize(pattern);
        const patternSegments = normalizedPattern.split(path.sep);
        if (
            normalizedPattern === '' ||
            normalizedPattern === '.' ||
            path.isAbsolute(normalizedPattern) ||
            patternSegments.includes('..')
        ) {
            if (emitWarnings) {
                warn(`Skipping invalid workspace pattern '${pattern}': expected a relative pattern beneath REPO_ROOT.`);
            }
            continue;
        }
        try {
            for (const match of fs.globSync(pattern, {
                cwd: repoRoot,
                exclude: entry => typeof entry === 'string' &&
                    entry.split(/[\\/]/).includes('node_modules'),
            })) {
                matches.add(match);
            }
        } catch {
            if (emitWarnings) warn(`Could not evaluate workspace pattern '${pattern}'; skipping it.`);
        }
    }

    const eligible = new Set<string>();
    for (const match of matches) {
        const normalizedNative = path.normalize(match);
        const normalized = normalizedNative.split(path.sep).join('/');
        const segments = normalized.split('/');
        if (
            normalized === '' ||
            normalized === '.' ||
            path.isAbsolute(normalizedNative) ||
            segments.includes('..')
        ) {
            if (emitWarnings) {
                warn(`Skipping invalid workspace path '${match}': expected a non-empty relative path beneath REPO_ROOT.`);
            }
            continue;
        }
        if (segments.includes('node_modules')) continue;

        const workspacePath = path.join(repoRoot, normalizedNative);
        let workspaceStat: fs.Stats;
        let manifestStat: fs.Stats;
        try {
            workspaceStat = fs.statSync(workspacePath);
            manifestStat = fs.statSync(path.join(workspacePath, 'package.json'));
        } catch (err) {
            if (emitWarnings && !isAbsentPathError(err)) {
                warn(`Could not inspect workspace candidate '${normalized}'; skipping it.`);
            }
            continue;
        }
        if (!workspaceStat.isDirectory() || !manifestStat.isFile()) continue;
        if (!isContainedIn(workspacePath, repoRoot)) {
            if (emitWarnings) warn(`Skipping workspace outside REPO_ROOT: ${normalized}`);
            continue;
        }
        eligible.add(normalized);
    }
    return [...eligible].sort();
}

function createNodeModulesSymlink(
    sourceModules: string,
    destinationModules: string,
    strict: boolean,
): boolean {
    try {
        fs.symlinkSync(sourceModules, destinationModules);
        return true;
    } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (
            error.code === 'EEXIST' &&
            probeNodeModulesEntry(destinationModules, sourceModules).verdict === 'verified-symlink'
        ) {
            return false;
        }
        if (strict) {
            die(
                `Worktree setup aborted: could not create ${destinationModules} -> ${sourceModules}: ` +
                `${error.message || 'unknown filesystem error'}`
            );
        }
        warn(`Could not repair missing workspace link ${destinationModules}: ${error.message || 'unknown filesystem error'}`);
        return false;
    }
}

export function probeNodeModulesEntry(
    candidatePath: string,
    expectedTargetPath: string,
): { verdict: NodeModulesLinkVerdict; lstatKind: NodeModulesLstatKind; resolvedTarget: string | null } {
    const lstatKind = probeNodeModulesLstatKind(candidatePath);
    const resolvedTarget = lstatKind === 'symlink' ? realpathOrNull(candidatePath) : null;
    const expectedTarget = realpathOrNull(expectedTargetPath);
    const verdict = classifyNodeModulesLinkFromData({ lstatKind, resolvedTarget, expectedTarget });
    return { verdict, lstatKind, resolvedTarget };
}

export function ensureWorktree(taskId: string, branch: string, startPoint?: string): string {
    if (!fs.existsSync(WORKTREES_ROOT)) {
        fs.mkdirSync(WORKTREES_ROOT, { recursive: true });
    }
    let wt = worktreePath(taskId);
    let isNewWorktree = false;
    const repoModulesSrc = path.join(REPO_ROOT, 'node_modules');
    const repoPackageJson = path.join(REPO_ROOT, 'package.json');

    if (fs.existsSync(wt)) {
        const registeredWt = findExistingWorktreeForBranch(branch);
        if (registeredWt === null || realpathOrNull(registeredWt) !== realpathOrNull(wt)) {
            info(`Worktree already exists: ${wt}`);
            return wt;
        }
        info(`Worktree already exists: ${wt}; repairing missing workspace links.`);
    } else {
        const existingWt = findExistingWorktreeForBranch(branch);
        if (existingWt) {
            wt = existingWt;
            info(`Worktree already exists for branch '${branch}': ${wt}`);
            return wt;
        } else {
            if (fs.existsSync(repoPackageJson) && !fs.existsSync(repoModulesSrc)) {
                die(
                    `Worktree setup aborted: ${REPO_ROOT}/node_modules does not exist, but ` +
                    `package.json does. The orchestrator symlinks node_modules from REPO_ROOT into ` +
                    `each worktree; that requires REPO_ROOT to have its dependencies installed first. ` +
                    `Run \`npm install\` (or \`npm ci\`) in ${REPO_ROOT} and try again.`
                );
            }
            isNewWorktree = true;
        }
        if (isNewWorktree && gitSafe('show-ref', '--verify', '--quiet', `refs/heads/${branch}`).ok) {
            info(`Creating worktree at ${wt} (branch: ${branch})...`);
            git('worktree', 'add', wt, branch);
        } else if (isNewWorktree) {
            const startSuffix = startPoint ? ` from ${startPoint}` : '';
            info(`Creating worktree at ${wt} (new branch: ${branch}${startSuffix})...`);
            const args = ['worktree', 'add', '-b', branch, wt];
            if (startPoint) args.push(startPoint);
            git(...args);
        }
    }

    const wtModules = path.join(wt, 'node_modules');
    if (isNewWorktree && fs.existsSync(repoPackageJson)) {
        const probe = probeNodeModulesEntry(wtModules, repoModulesSrc);
        switch (probe.lstatKind) {
            case 'missing':
                if (createNodeModulesSymlink(repoModulesSrc, wtModules, true)) {
                    info('Symlinked node_modules into worktree.');
                }
                break;
            case 'symlink':
                if (probe.verdict === 'not-exempt') {
                    die(
                        `Worktree setup aborted: ${wtModules} is a symlink but does not resolve to ` +
                        `${repoModulesSrc} (found: ${probe.resolvedTarget ?? 'unresolvable target'}). ` +
                        `Remove or fix the stray symlink before retrying.`
                    );
                }
                break;
            case 'file':
            case 'directory':
                break;
            case 'error':
                die(`Worktree setup aborted: could not inspect ${wtModules} (lstat failed).`);
                break;
        }
    }

    if (fs.existsSync(repoPackageJson)) {
        for (const workspace of resolveWorkspaceDirs(REPO_ROOT, { emitWarnings: isNewWorktree })) {
            const sourceModules = path.join(REPO_ROOT, workspace, 'node_modules');
            if (!fs.existsSync(sourceModules)) continue;

            const worktreeWorkspace = path.join(wt, workspace);
            try {
                fs.lstatSync(worktreeWorkspace);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                    info(`Workspace '${workspace}' is not present in the worktree; skipping node_modules link.`);
                } else {
                    warn(`Could not inspect workspace '${workspace}' in the worktree; skipping node_modules link.`);
                }
                continue;
            }

            const resolvedWorkspace = resolveContainedPath(worktreeWorkspace, wt);
            if (resolvedWorkspace === null) {
                warn(`Workspace '${workspace}' resolves outside the worktree or is unresolvable; skipping node_modules link.`);
                continue;
            }

            let resolvedWorkspaceStat: fs.Stats;
            try {
                resolvedWorkspaceStat = fs.statSync(resolvedWorkspace);
            } catch {
                warn(`Workspace '${workspace}' could not be inspected after resolution; skipping node_modules link.`);
                continue;
            }
            if (!resolvedWorkspaceStat.isDirectory()) {
                warn(`Workspace '${workspace}' is not a directory in the worktree; skipping node_modules link.`);
                continue;
            }
            const worktreeModules = path.join(resolvedWorkspace, 'node_modules');
            const workspaceProbe = probeNodeModulesEntry(worktreeModules, sourceModules);
            switch (workspaceProbe.lstatKind) {
                case 'missing':
                    if (createNodeModulesSymlink(sourceModules, worktreeModules, isNewWorktree)) {
                        info(`Symlinked node_modules into worktree workspace '${workspace}'.`);
                    }
                    break;
                case 'symlink':
                    if (isNewWorktree && workspaceProbe.verdict === 'not-exempt') {
                        die(
                            `Worktree setup aborted: ${worktreeModules} is a symlink but does not resolve to ` +
                            `${sourceModules} (found: ${workspaceProbe.resolvedTarget ?? 'unresolvable target'}). ` +
                            `Remove or fix the stray symlink before retrying.`
                        );
                    }
                    break;
                case 'file':
                case 'directory':
                    break;
                case 'error':
                    if (isNewWorktree) {
                        die(`Worktree setup aborted: could not inspect ${worktreeModules} (lstat failed).`);
                    }
                    break;
            }
        }
    }

    if (isNewWorktree) {
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
    }
    info('Worktree ready.');
    return wt;
}

export function teardownWorktree(taskId: string): void {
    const wt = worktreePath(taskId);
    if (!fs.existsSync(wt)) return;
    info(`Removing worktree ${wt}...`);
    const result = gitSafe('worktree', 'remove', '--force', wt);
    if (!result.ok) warn(`Could not remove worktree: ${result.stderr}`);
    else info('Worktree removed.');
}
