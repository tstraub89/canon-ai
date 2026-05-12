import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT } from './env.js';
import { gitSafeAt } from './git.js';
import { deriveTopLevelStatus } from './state.js';
import type { CanonStamp, CommandResult, StatusJson } from './types.js';

export const CANON_UPSTREAM_REPO = 'tstraub89/canon-ai';

type GitRunner = (cwd: string, ...args: string[]) => CommandResult;
type CommandRunner = (command: string, args: string[]) => CommandResult;

export type CanonSnapshotOptions = {
    runGitAt?: GitRunner;
    runCommand?: CommandRunner;
};

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

    const superprojectWorkingTree = captureGitOutput(repoRoot, ['rev-parse', '--show-superproject-working-tree'], runGitAt);
    const upstreamCommit = captureGitOutput(repoRoot, ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>';
    const orchestratorCommit = superprojectWorkingTree
        ? captureGitOutput(path.resolve(superprojectWorkingTree), ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>'
        : upstreamCommit;

    return {
        upstream_repo: CANON_UPSTREAM_REPO,
        upstream_commit: upstreamCommit,
        orchestrator_commit: orchestratorCommit,
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

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMain) {
    const [, , statusFilePath] = process.argv;
    if (!statusFilePath) {
        console.error('Usage: canon-snapshot.ts <status.json path>');
        process.exit(2);
    }
    try {
        refreshCanonSnapshotAtPath(statusFilePath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`canon-snapshot: ${message}`);
        process.exit(1);
    }
}
