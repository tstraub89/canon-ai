import { TASK_SH } from './env.js';
import { runCommandOrDie } from './git.js';
import { resolveTaskCwd } from './state.js';

/** Worktree-aware phase transition: uses the worktree CWD when active, REPO_ROOT otherwise. */
export function runTaskShFor(taskId: string, ...args: string[]): void {
    runCommandOrDie('bash', [TASK_SH, ...args], { cwd: resolveTaskCwd(taskId) });
}
