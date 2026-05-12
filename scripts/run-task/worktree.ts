import fs from 'node:fs';
import path from 'node:path';

import { info, warn, die } from './cli.js';
import { REPO_ROOT, WORKTREES_ROOT } from './env.js';
import { git, gitSafe, gitSafeAt, gitSafeAtRaw, getCurrentBranch } from './git.js';
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
    'spec.md', 'spec-review.md', 'plan.md', 'handoff.md', 'review.md', 'done.md', 'notes.md',
]);

export function worktreePath(taskId: string): string {
    return path.join(WORKTREES_ROOT, taskId);
}

export function isWorktreeEnabled(taskIds: string[]): boolean {
    return readStatus(taskIds[0]).worktree === true;
}

export function getActiveCwd(taskIds: string[]): string {
    if (isWorktreeEnabled(taskIds)) {
        const wt = worktreePath(taskIds[0]);
        if (fs.existsSync(wt)) return wt;
        const branch = readStatus(taskIds[0]).branch;
        if (branch) {
            const existing = findExistingWorktreeForBranch(branch);
            if (existing) return existing;
        }
        die(
            `Worktree for task '${taskIds[0]}' is expected but missing.\n` +
            `  Restore or recreate the worktree before continuing.`,
        );
    }
    return REPO_ROOT;
}

export type SharedDocSyncResult = {
    ok: boolean;
    reason?: string;
};

export function canMirrorSharedDocs(sourceCwd: string, destinationCwd: string): SharedDocSyncResult {
    const destinationDirty = gitSafeAtRaw(destinationCwd, 'status', '--porcelain=v1', '-uall', '--', ...PIPELINE_SHARED_DOCS);
    if (!destinationDirty.ok) {
        return {
            ok: false,
            reason: `could not inspect destination shared-doc state in ${destinationCwd}: ${destinationDirty.stderr || 'unknown error'}`,
        };
    }
    if (destinationDirty.stdout.trim()) {
        const firstDirty = destinationDirty.stdout.trim().split('\n')[0]?.trim() ?? 'unknown change';
        return {
            ok: false,
            reason: `destination checkout has local changes in shared docs (${firstDirty})`,
        };
    }

    const sourceHead = gitSafeAtRaw(sourceCwd, 'rev-parse', 'HEAD');
    if (!sourceHead.ok || !sourceHead.stdout.trim()) {
        return { ok: false, reason: `could not read source HEAD in ${sourceCwd}: ${sourceHead.stderr || 'unknown error'}` };
    }

    const destinationHead = gitSafeAtRaw(destinationCwd, 'rev-parse', 'HEAD');
    if (!destinationHead.ok || !destinationHead.stdout.trim()) {
        return { ok: false, reason: `could not read destination HEAD in ${destinationCwd}: ${destinationHead.stderr || 'unknown error'}` };
    }

    const ancestry = gitSafeAtRaw(sourceCwd, 'merge-base', '--is-ancestor', destinationHead.stdout.trim(), sourceHead.stdout.trim());
    if (ancestry.ok) return { ok: true };

    return {
        ok: false,
        reason: `destination branch has diverged from source HEAD (${destinationHead.stdout.trim().slice(0, 7)} is not an ancestor of ${sourceHead.stdout.trim().slice(0, 7)})`,
    };
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

export function flushWorktreeTelemetry(): void {
    const allFiles = [...PIPELINE_SHARED_DOCS];
    const present = allFiles.filter(f => fs.existsSync(path.join(REPO_ROOT, f)));
    if (present.length === 0) return;
    const status = gitSafe('status', '--porcelain', ...present);
    if (!status.ok || !status.stdout.trim()) return;
    for (const f of present) gitSafe('add', '--', f);
    const staged = gitSafe('diff', '--cached', '--name-only');
    if (!staged.stdout.trim()) return;
    const targetBranch = getCurrentBranch();
    const result = gitSafe('commit', '-m', 'chore: flush pipeline telemetry');
    if (!result.ok) warn(`Could not flush telemetry to ${targetBranch}: ${result.stderr}`);
    else info(`Flushed pipeline telemetry to ${targetBranch}.`);
}

export function syncWorktreeArtifacts(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const wt = worktreePath(taskId);
        const wtDir = path.join(wt, 'tasks', taskId);
        const mainDir = path.join(REPO_ROOT, 'tasks', taskId);
        if (!fs.existsSync(wtDir)) continue;
        const wtFiles = new Set(
            fs.readdirSync(wtDir).filter(f => {
                try {
                    const st = fs.lstatSync(path.join(wtDir, f));
                    return st.isFile() && !st.isSymbolicLink();
                } catch { return false; }
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

export function syncWorktreeTelemetry(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const wt = worktreePath(taskId);
        if (!fs.existsSync(wt)) continue;
        const mirrorResult = canMirrorSharedDocs(wt, REPO_ROOT);
        if (!mirrorResult.ok) {
            warn(`Skipping shared-doc sync for ${taskId}: ${mirrorResult.reason}`);
            continue;
        }
        for (const relPath of PIPELINE_SHARED_DOCS) {
            if (relPath === 'docs/pipeline-invocations.md') continue;
            const src = path.join(wt, relPath);
            const dest = path.join(REPO_ROOT, relPath);
            if (!fs.existsSync(src)) continue;
            try {
                if (fs.lstatSync(src).isSymbolicLink()) continue;
                let needsCopy = !fs.existsSync(dest);
                if (!needsCopy) {
                    const sourceContent = fs.readFileSync(src, 'utf8');
                    const destinationContent = fs.readFileSync(dest, 'utf8');
                    needsCopy = sourceContent !== destinationContent;
                }
                if (needsCopy) {
                    fs.copyFileSync(src, dest);
                }
                gitSafeAt(wt, 'checkout', 'HEAD', '--', relPath);
            } catch {
                // Non-fatal — flushWorktreeTelemetry runs at --push/--pr/--ship
            }
        }
    }
}
