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

export function ensureWorktree(taskId: string, branch: string, startPoint?: string): string {
    if (!fs.existsSync(WORKTREES_ROOT)) {
        fs.mkdirSync(WORKTREES_ROOT, { recursive: true });
    }
    const wt = worktreePath(taskId);
    if (fs.existsSync(wt)) {
        info(`Worktree already exists: ${wt}`);
        return wt;
    }
    const existingWt = findExistingWorktreeForBranch(branch);
    if (existingWt) {
        info(`Worktree already exists for branch '${branch}': ${existingWt}`);
        return existingWt;
    }
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

    if (gitSafe('show-ref', '--verify', '--quiet', `refs/heads/${branch}`).ok) {
        info(`Creating worktree at ${wt} (branch: ${branch})...`);
        git('worktree', 'add', wt, branch);
    } else {
        const startSuffix = startPoint ? ` from ${startPoint}` : '';
        info(`Creating worktree at ${wt} (new branch: ${branch}${startSuffix})...`);
        const args = ['worktree', 'add', '-b', branch, wt];
        if (startPoint) args.push(startPoint);
        git(...args);
    }

    const wtModules = path.join(wt, 'node_modules');
    if (fs.existsSync(repoPackageJson) && !fs.existsSync(wtModules)) {
        fs.symlinkSync(repoModulesSrc, wtModules);
        info('Symlinked node_modules into worktree.');
    }

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

export function teardownWorktree(taskId: string): void {
    const wt = worktreePath(taskId);
    if (!fs.existsSync(wt)) return;
    info(`Removing worktree ${wt}...`);
    const result = gitSafe('worktree', 'remove', '--force', wt);
    if (!result.ok) warn(`Could not remove worktree: ${result.stderr}`);
    else info('Worktree removed.');
}
