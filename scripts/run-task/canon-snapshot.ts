import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { __dirname, REPO_ROOT } from './env.js';
import { gitSafeAt } from './git.js';
import { deriveTopLevelStatus } from './state.js';
import type { CanonStamp, CommandResult, StatusJson } from './types.js';

export const CANON_UPSTREAM_REPO = 'tstraub89/canon-ai';

type GitRunner = (cwd: string, ...args: string[]) => CommandResult;
type CommandRunner = (command: string, args: string[]) => CommandResult;

export type CanonSnapshotOptions = {
    runGitAt?: GitRunner;
    runCommand?: CommandRunner;
    canonSourcePath?: string;
    canonVersion?: string;
};

function isInstalledSourcePath(sourcePath: string): boolean {
    return sourcePath.includes('/node_modules/') || sourcePath.includes('\\node_modules\\')
        || sourcePath.includes('/_npx/') || sourcePath.includes('\\_npx\\');
}

function resolveCanonVersion(explicit: string | undefined): string {
    // Mirrors bakedVersion() in src/cli/commands/update.ts.
    return explicit ?? process.env.CANON_VERSION ?? 'dev';
}

function resolveOrchestratorCommit(repoRoot: string, upstreamCommit: string, runGitAt: GitRunner): string {
    const ownToplevel = captureGitOutput(repoRoot, ['rev-parse', '--show-toplevel'], runGitAt);
    if (!ownToplevel) return upstreamCommit;

    const parentDir = path.dirname(repoRoot);
    const parentToplevel = captureGitOutput(parentDir, ['rev-parse', '--show-toplevel'], runGitAt);
    if (!parentToplevel) return upstreamCommit;

    if (path.resolve(parentToplevel) === path.resolve(ownToplevel)) {
        return upstreamCommit;
    }

    return captureGitOutput(path.resolve(parentToplevel), ['rev-parse', 'HEAD'], runGitAt) || upstreamCommit;
}

function defaultRunCommand(command: string, args: string[]): CommandResult {
    const result = spawnSync(command, args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
        return { ok: false, stdout: '', stderr: result.error.message };
    }
    return {
        ok: result.status === 0,
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
    };
}

function captureGitOutput(cwd: string, args: string[], runGitAt: GitRunner): string {
    const result = runGitAt(cwd, ...args);
    return result.ok ? result.stdout.trim() : '';
}

function captureVersion(command: string, runCommand: CommandRunner): string {
    const result = runCommand(command, ['--version']);
    if (!result.ok) return '<unavailable>';
    const version = result.stdout.trim();
    return version.length > 0 ? version : '<unavailable>';
}

export function captureCanonSnapshot(repoRoot = REPO_ROOT, options: CanonSnapshotOptions = {}): CanonStamp {
    const runGitAt = options.runGitAt ?? gitSafeAt;
    const runCommand = options.runCommand ?? defaultRunCommand;
    const canonSourcePath = options.canonSourcePath ?? __dirname;
    const isInstalled = isInstalledSourcePath(canonSourcePath);

    const superprojectWorkingTree = captureGitOutput(repoRoot, ['rev-parse', '--show-superproject-working-tree'], runGitAt);
    const drivingCommit = captureGitOutput(repoRoot, ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>';
    const hostCommit = superprojectWorkingTree
        ? captureGitOutput(path.resolve(superprojectWorkingTree), ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>'
        : null;

    let upstreamCommit: string;
    let orchestratorCommit: string;
    if (isInstalled) {
        upstreamCommit = '<unavailable>';
        orchestratorCommit = hostCommit ?? drivingCommit;
    } else if (superprojectWorkingTree) {
        upstreamCommit = drivingCommit;
        orchestratorCommit = hostCommit ?? '<unavailable>';
    } else {
        upstreamCommit = drivingCommit;
        orchestratorCommit = resolveOrchestratorCommit(repoRoot, upstreamCommit, runGitAt);
    }
    const envUpstreamRepo = process.env.CANON_UPSTREAM_REPO?.trim();
    const upstreamRepo = envUpstreamRepo ? envUpstreamRepo : CANON_UPSTREAM_REPO;

    return {
        upstream_repo: upstreamRepo,
        upstream_commit: upstreamCommit,
        orchestrator_commit: orchestratorCommit,
        canon_version: resolveCanonVersion(options.canonVersion),
        codex_cli: captureVersion('codex', runCommand),
        claude_code: captureVersion('claude', runCommand),
    };
}

function applyCanonSnapshot(status: StatusJson, canon: CanonStamp): StatusJson {
    const next: StatusJson = {
        ...status,
        canon,
        updated: new Date().toISOString().slice(0, 10),
    };
    next.status = deriveTopLevelStatus(next);
    return next;
}

export function refreshCanonSnapshotAtPath(statusFilePath: string, options: CanonSnapshotOptions = {}): CanonStamp {
    const status = JSON.parse(fs.readFileSync(statusFilePath, 'utf8')) as StatusJson;
    const canon = captureCanonSnapshot(REPO_ROOT, options);
    const next = applyCanonSnapshot(status, canon);
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    const current = fs.readFileSync(statusFilePath, 'utf8');
    if (current !== serialized) {
        fs.writeFileSync(statusFilePath, serialized, 'utf8');
    }
    return canon;
}

export function refreshCanonSnapshotsAtPaths(statusFilePaths: readonly string[], options: CanonSnapshotOptions = {}): CanonStamp[] {
    return statusFilePaths.map(statusFilePath => refreshCanonSnapshotAtPath(statusFilePath, options));
}
