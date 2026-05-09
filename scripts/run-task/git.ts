import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import path from 'node:path';

import { REPO_ROOT } from './env.js';
import { die, info, warn } from './cli.js';
import { readStatus, taskDirFor, writeStatus } from './state.js';
import { ensureWorktree } from './worktree.js';
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

export function commitTaskArtifactsToBase(taskIds: string[], _artifactFiles: ReadonlySet<string>): void {
    void _artifactFiles;
    for (const taskId of taskIds) {
        const taskDir = path.relative(REPO_ROOT, taskDirFor(taskId));
        const status = gitSafe('status', '--porcelain', '--', taskDir);
        if (!status.ok || status.stdout.trim().length === 0) continue;
        git('add', '--', taskDir);
        git('commit', '-m', `task(${taskId}): commit artifacts pre-pipeline`);
        info(`Committed task artifacts for ${taskId} to base branch.`);
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

export function commitsAheadOfBase(branchName: string, baseBranch: string): number {
    const result = gitSafe('rev-list', '--count', `${baseBranch}..${branchName}`);
    if (!result.ok) return 0;
    const count = Number.parseInt(result.stdout, 10);
    return Number.isNaN(count) ? 0 : count;
}

export function isCommandAvailable(command: string): boolean {
    const result = spawnSync('which', [command], { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

export function ensureBranch(taskIds: string[]): void {
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
    const current = getCurrentBranch();
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

    const resolvedBranch = getCurrentBranch();
    for (const taskId of taskIds) {
        const s = readStatus(taskId);
        s.branch = resolvedBranch;
        writeStatus(taskId, s);
    }
    info(`Branch recorded: ${resolvedBranch}`);
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
