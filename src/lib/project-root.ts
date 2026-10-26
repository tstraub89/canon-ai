import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve the supervising project root at call time. The main working tree uses
 * git's top level (also correct for separate-git-dir and submodule checkouts);
 * linked worktrees use the common directory's parent. Outside git, cwd is the
 * project root. A linked worktree cannot identify the main tree for a repo
 * whose git directory lives outside its working tree.
 */
export function probeProjectRoot(cwd: string = process.cwd()): { root: string; inGitRepository: boolean } {
    const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [gitDir, commonDir] = result.error || result.status !== 0
        ? []
        : (result.stdout ?? '').trim().split('\n').map(value => value.trim());
    if (!gitDir || !commonDir) return { root: path.resolve(cwd), inGitRepository: false };
    if (safeRealpath(gitDir) !== safeRealpath(commonDir)) return { root: path.dirname(commonDir), inGitRepository: true };

    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const toplevel = top.error || top.status !== 0 ? '' : (top.stdout ?? '').trim();
    return { root: toplevel || path.dirname(commonDir), inGitRepository: true };
}

export function resolveProjectRoot(cwd: string = process.cwd()): string {
    return probeProjectRoot(cwd).root;
}

export function isInsideGitRepository(cwd: string = process.cwd()): boolean {
    return probeProjectRoot(cwd).inGitRepository;
}

function safeRealpath(value: string): string {
    try { return fs.realpathSync(value); } catch { return value; }
}

export function tasksDirOverride(): string | null {
    const override = process.env.CANON_TASKS_DIR_OVERRIDE;
    return override ? path.resolve(override) : null;
}

export function tasksDir(projectRoot: string = resolveProjectRoot()): string {
    return tasksDirOverride() ?? path.join(projectRoot, 'tasks');
}

export function templatesDir(projectRoot: string = resolveProjectRoot()): string {
    return path.join(projectRoot, '.canon', 'templates');
}

export function isValidTaskId(id: string): boolean {
    return /^[a-z0-9][a-z0-9._-]*$/.test(id) && !id.includes('..');
}

export function isTaskEntry(tasksDirPath: string, name: string): boolean {
    if (!isValidTaskId(name)) return false;
    try { return fs.lstatSync(path.join(tasksDirPath, name)).isDirectory(); } catch { return false; }
}
