import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import path from 'node:path';

import { REPO_ROOT } from './env.js';
import { die, info, warn } from './cli.js';
import { tickAllHeartbeats } from './heartbeat.js';
import { readStatus, readStatusFromPath, taskDirForRepoRoot, writeStatus, writeStatusToFile } from './state.js';
import { ensureWorktree, PIPELINE_TELEMETRY_FILES } from './worktree.js';
import type { CommandResult } from './types.js';

export function runCommand(command: string, args: string[]): CommandResult {
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

export function runCommandOrDie(command: string, args: string[], options: SpawnSyncOptions = {}): void {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.error) { console.error(result.error.message); process.exit(1); }
    if (typeof result.status === 'number' && result.status !== 0) process.exit(result.status);
    if (result.signal) process.exit(1);
}

export function git(...args: string[]): string {
    const result = runCommand('git', args);
    if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || 'unknown error'}`);
    return result.stdout;
}

export function gitSafe(...args: string[]): CommandResult {
    return runCommand('git', args);
}

export function gitSafeAt(cwd: string, ...args: string[]): CommandResult {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
    return { ok: result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

export function gitSafeAtRaw(cwd: string, ...args: string[]): CommandResult {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
    return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}

/**
 * Returns the subset of `paths` that `git check-ignore` reports as gitignored
 * in `cwd`. Used to exempt build-generated artifacts (e.g. regenerated
 * `public/sitemap.xml`) from handoff coverage and auto-commit existence
 * checks — Codex may legitimately reference them in the Changes table to
 * describe build output, but they will never appear in `git diff base...HEAD`
 * and shouldn't trigger the "file missing from working tree" branch.
 *
 * Single batched invocation: `git check-ignore --stdin` reads NUL-delimited
 * paths and prints the ignored subset, NUL-delimited. Exit 0 = at least one
 * path was ignored, 1 = none were, 128 = error. We treat 0 and 1 as success
 * (the output is authoritative either way) and any error as "no paths
 * ignored" — failing closed would mean treating uncertain state as "definitely
 * not ignored," which is the same default as the pre-1.3.x behavior.
 */
export function filterGitIgnoredPaths(paths: readonly string[], cwd: string): Set<string> {
    if (paths.length === 0) return new Set();
    const result = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
        cwd,
        input: `${paths.join('\0')}\0`,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.error || (result.status !== 0 && result.status !== 1)) {
        return new Set();
    }
    const stdout = result.stdout ?? '';
    return new Set(stdout.split('\0').filter(p => p.length > 0));
}

export function commitTaskArtifactsToBase(taskIds: string[], _artifactFiles: ReadonlySet<string>): void {
    void _artifactFiles;
    for (const taskId of taskIds) {
        const taskDir = path.relative(REPO_ROOT, taskDirForRepoRoot(taskId));
        const status = gitSafe('status', '--porcelain', '--', taskDir);
        if (!status.ok || status.stdout.trim().length === 0) continue;
        git('add', '--', taskDir);
        git('commit', '-m', `task(${taskId}): commit artifacts pre-pipeline`, '--only', '--', taskDir);
        info(`Committed task artifacts for ${taskId} to base branch.`);
    }

    const dirtyTelemetry: string[] = [];
    for (const relPath of PIPELINE_TELEMETRY_FILES) {
        const status = gitSafe('status', '--porcelain', '--', relPath);
        if (status.ok && status.stdout.trim().length > 0) dirtyTelemetry.push(relPath);
    }
    if (dirtyTelemetry.length > 0) {
        for (const relPath of dirtyTelemetry) git('add', '--', relPath);
        git(
            'commit',
            '-m',
            `chore: absorb pre-implement telemetry into scaffold for ${taskIds.join(', ')}`,
            '--only',
            '--',
            ...dirtyTelemetry,
        );
        info(`Absorbed pre-implement telemetry into scaffold for ${taskIds.join(', ')}.`);
    }
}

export function getCurrentBranch(): string {
    return git('rev-parse', '--abbrev-ref', 'HEAD');
}

export function branchExistsLocally(name: string): boolean {
    return gitSafe('show-ref', '--verify', '--quiet', `refs/heads/${name}`).ok;
}

export function getDefaultBaseBranch(): string {
    if (branchExistsLocally('main')) return 'main';
    if (branchExistsLocally('master')) return 'master';
    die('Neither main nor master branch found locally.');
}

export function getBaseBranch(taskIds?: string[]): string {
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

export function getUnpushedBaseCommits(
    baseBranch: string,
    cwd: string,
): { commits: { sha: string; subject: string }[]; ok: boolean; stderr: string } {
    const result = gitSafeAtRaw(cwd, 'log', `origin/${baseBranch}..${baseBranch}`, '--format=%H%x09%s');
    if (!result.ok) {
        return { commits: [], ok: false, stderr: result.stderr };
    }

    const commits: { sha: string; subject: string }[] = [];
    for (const line of result.stdout.split('\n')) {
        if (!line.trim()) continue;
        const tabIndex = line.indexOf('\t');
        if (tabIndex === -1) continue;
        commits.push({
            sha: line.slice(0, tabIndex),
            subject: line.slice(tabIndex + 1),
        });
    }
    return { commits, ok: true, stderr: '' };
}

export type ScopedDiff = {
    diff: string;
    truncated: boolean;
};

function truncateUtf8(input: string, capBytes: number): string {
    const bytes = Buffer.from(input, 'utf8');
    if (bytes.length <= capBytes) return input;

    let end = capBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    return bytes.subarray(0, end).toString('utf8');
}

export function getScopedDiff(
    baseBranch: string,
    cwd: string,
    capBytes = 50_000,
): ScopedDiff | null {
    const result = gitSafeAtRaw(cwd, 'diff', `${baseBranch}...HEAD`);
    if (!result.ok) return null;

    const raw = result.stdout;
    if (Buffer.byteLength(raw, 'utf8') <= capBytes) {
        return { diff: raw, truncated: false };
    }

    return {
        diff: truncateUtf8(raw, capBytes),
        truncated: true,
    };
}

export function isCommandAvailable(command: string): boolean {
    const result = spawnSync('which', [command], { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

export type EnsureBranchOptions = {
    force?: boolean;
};

function isPipelineOwnedDirtyPath(filePath: string): boolean {
    if (filePath.startsWith('tasks/')) return true;
    return (PIPELINE_TELEMETRY_FILES as readonly string[]).includes(filePath);
}

export function findDirtyRepoRootSourcePaths(statusOutput: string): string[] {
    return parsePorcelainEntries(statusOutput)
        .flatMap(entry => entry.paths)
        .filter(filePath => !isPipelineOwnedDirtyPath(filePath));
}

function assertRepoRootCleanBeforeFirstWorktree(force: boolean): void {
    const status = gitSafeAtRaw(REPO_ROOT, 'status', '--porcelain=v1', '-uall');
    if (!status.ok) {
        die(`Could not inspect REPO_ROOT dirty state before creating a task worktree: ${status.stderr || 'unknown git status error'}`);
    }
    const dirtySourcePaths = findDirtyRepoRootSourcePaths(status.stdout);
    if (dirtySourcePaths.length === 0) return;

    const list = dirtySourcePaths.map(filePath => `  - ${filePath}`).join('\n');
    if (!force) {
        die(
            `Worktree creation aborted: REPO_ROOT has uncommitted source edits that would not be present in the new task worktree.\n` +
            `${list}\n\n` +
            `Commit or stash intentional edits before creating the worktree, or rerun with --force if this task should intentionally start from base without those edits.`
        );
    }
    warn(
        `--force override: creating task worktree from base despite uncommitted REPO_ROOT source edits:\n${list}`
    );
}

export function ensureBranch(taskIds: string[], options: EnsureBranchOptions = {}): void {
    const primaryStatus = readStatus(taskIds[0]);
    const useWorktree = primaryStatus.worktree === true;

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
            try {
                tickAllHeartbeats();
            } catch {
                // Best-effort: a heartbeat refresh must never abort worktree reuse.
            }
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
        // First-implement worktree case: create task/<id> directly in the
        // worktree from baseBranch. Never mutate the main checkout's HEAD —
        // that would violate the documented isolation model where the main
        // checkout stays on the base branch while implementation, review, and
        // qa run in ../dev-worktrees/<id>/.
        assertRepoRootCleanBeforeFirstWorktree(options.force === true);
        const leaderWorktree = ensureWorktree(taskIds[0], branchName, baseBranch);
        // Write secondaries first and the leader last because the leader branch
        // is the durable marker that bootstrap completed. Explicit destinations
        // avoid re-entering resolveTaskCwd before each worktree copy is populated.
        const orderedTaskIds = [...taskIds.slice(1), taskIds[0]];
        for (const taskId of orderedTaskIds) {
            const destination = process.env.CANON_TASKS_DIR_OVERRIDE
                ? path.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId, 'status.json')
                : path.join(leaderWorktree, 'tasks', taskId, 'status.json');
            const s = readStatusFromPath(destination, taskId);
            s.branch = branchName;
            writeStatusToFile(destination, s);
        }
        try {
            tickAllHeartbeats();
        } catch {
            // Best-effort: a heartbeat refresh must never abort worktree creation.
        }
        info(`Branch recorded: ${branchName} (worktree mode — main checkout untouched)`);
        return;
    }

    const current = getCurrentBranch();
    if (current !== branchName && current !== baseBranch) {
        if (!branchExistsLocally(baseBranch)) {
            die(
                `Task '${taskIds[0]}' declares base branch '${baseBranch}', but the current checkout is '${current}' ` +
                `and '${baseBranch}' is not available locally. Check out the declared base branch first or fetch it, then re-run.`,
            );
        }
        info(`Switching from '${current}' to declared base '${baseBranch}' before creating '${branchName}'...`);
        git('checkout', baseBranch);
    }

    const checkoutBase = getCurrentBranch();
    if (branchExistsLocally(branchName)) {
        info(`Branch '${branchName}' already exists — checking out.`);
        git('checkout', branchName);
    } else if (checkoutBase === baseBranch) {
        info(`Creating branch '${branchName}' off ${baseBranch}...`);
        git('checkout', '-b', branchName);
    } else {
        die(`Unable to create '${branchName}': expected to be on '${baseBranch}', but are on '${checkoutBase}'.`);
    }

    const resolvedBranch = getCurrentBranch();
    for (const taskId of taskIds) {
        const s = readStatus(taskId);
        s.branch = resolvedBranch;
        writeStatus(taskId, s);
    }
    info(`Branch recorded: ${resolvedBranch}`);
}

export function ensureCheckedOutBaseBranch(taskIds: string[]): string {
    const baseBranch = getBaseBranch(taskIds);
    const current = getCurrentBranch();
    if (current === baseBranch) return baseBranch;
    if (!branchExistsLocally(baseBranch)) {
        die(
            `Task bundle targets base branch '${baseBranch}', but the current checkout is '${current}' ` +
            `and '${baseBranch}' is not available locally. Check out the declared base branch first or fetch it, then re-run.`,
        );
    }
    info(`Switching from '${current}' to base branch '${baseBranch}' before shipping...`);
    git('checkout', baseBranch);
    return baseBranch;
}

export function verifyBranch(taskIds: string[]): void {
    const status = readStatus(taskIds[0]);
    if (!status.branch) return;
    if (status.worktree === true) return;
    const current = getCurrentBranch();
    if (current !== status.branch) {
        warn(`Expected branch '${status.branch}' but on '${current}'. Continuing anyway.`);
    }
}

export type PorcelainEntry = {
    raw: string;
    indexStatus: string;
    worktreeStatus: string;
    paths: string[];
};

function stripPorcelainQuotes(filePath: string): string {
    return filePath.replace(/^"|"$/g, '');
}

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

export function parsePorcelain(output: string): Set<string> {
    return new Set(parsePorcelainEntries(output).flatMap(entry => entry.paths));
}

// Parses `git diff --name-status -z` output. With `-z`, each record is
// NUL-delimited (no quoting/escaping of paths), so we can recover filenames
// with spaces or special characters verbatim. Format per record:
//   non-rename/copy: STATUS\0PATH\0
//   rename/copy:     R100\0OLD\0NEW\0
export function parseNameStatusOutput(raw: string): string[] {
    const paths = new Set<string>();
    const tokens = raw.split('\0').filter(t => t.length > 0);
    let i = 0;
    while (i < tokens.length) {
        const status = tokens[i++];
        if ((status.startsWith('R') || status.startsWith('C')) && i + 1 < tokens.length) {
            paths.add(tokens[i++]);
            paths.add(tokens[i++]);
        } else if (i < tokens.length) {
            paths.add(tokens[i++]);
        }
    }
    return [...paths].sort();
}

export function getAffectedFiles(baseRef: string, cwd: string): string[] {
    const result = gitSafeAtRaw(cwd, 'diff', `${baseRef}...HEAD`, '--name-status', '-M', '-z');
    if (!result.ok || !result.stdout) return [];
    return parseNameStatusOutput(result.stdout);
}

export function getTreeDriftFiles(baseRef: string, cwd: string): { files: string[]; ok: boolean; stderr: string } {
    const result = gitSafeAtRaw(cwd, 'diff', baseRef, 'HEAD', '--name-status', '-M', '-z');
    if (!result.ok) {
        return { files: [], ok: false, stderr: result.stderr };
    }
    return { files: parseNameStatusOutput(result.stdout), ok: true, stderr: '' };
}
