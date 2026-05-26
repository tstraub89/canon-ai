import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

function resolveRepoRoot(): string {
    try {
        // Use `--git-common-dir` rather than `--show-toplevel` so that REPO_ROOT
        // stays anchored at the supervising main checkout even when the
        // orchestrator (or a unit test) is invoked from inside a linked
        // worktree. `--show-toplevel` returns the active worktree path, which
        // makes `WORKTREES_ROOT = REPO_ROOT/../dev-worktrees` resolve to the
        // wrong sibling tree and otherwise inverts the supervisor-vs-worktree
        // contract. Worktree-aware task-state reads/writes go through
        // `resolveTaskCwd(taskId)` (state.ts) — that's the canonical seam for
        // "where does the task's code currently live"; REPO_ROOT is for
        // "where does the supervising orchestrator pipe its files." Codex
        // P2 on PR #42 caught the regression introduced by an earlier flip
        // to `--show-toplevel`.
        const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' });
        if (result.error || result.status !== 0) {
            throw result.error ?? new Error(result.stderr || 'git rev-parse --git-common-dir failed');
        }
        const gitCommonDir = result.stdout.trim();
        if (!gitCommonDir) throw new Error('git rev-parse --git-common-dir returned no path');
        // `git rev-parse --git-common-dir` returns a relative `.git` path in the
        // main checkout and an absolute path from a worktree. Resolving first and
        // then taking the parent directory yields the canonical repo root in both.
        const resolvedGitCommonDir = path.isAbsolute(gitCommonDir)
            ? gitCommonDir
            : path.resolve(process.cwd(), gitCommonDir);
        return path.dirname(resolvedGitCommonDir);
    } catch {
        // Fallback for non-git environments (for example some unit-test runners).
        return path.resolve(__dirname, '../..');
    }
}

export const REPO_ROOT = resolveRepoRoot();
export const TASKS_DIR = path.join(REPO_ROOT, 'tasks');

export const WORKTREES_ROOT = process.env.CANON_WORKTREES_ROOT
    ? path.resolve(process.env.CANON_WORKTREES_ROOT)
    : path.resolve(REPO_ROOT, '../dev-worktrees');

export const STALL_TIMEOUT_MS = Number(process.env.PIPELINE_STALL_TIMEOUT_MS) || 10 * 60 * 1000;
export const STALL_KILL_GRACE_MS = 3000;

export const LEGACY_FALLBACK_ENV_VARS: Array<{ old: string; replacement: string }> = [
    { old: 'CLAUDE_MODEL', replacement: 'CLAUDE_MODEL_SPEC / _PLAN / _REVIEW (still honored as fallback for those three; not applied to qa)' },
    { old: 'CODEX_MODEL_DEFAULT', replacement: 'CODEX_MODEL_MINI (still honored as fallback)' },
    { old: 'CODEX_MODEL_DELICATE', replacement: 'CODEX_MODEL_FULL (still honored as fallback)' },
];

export const LEGACY_IGNORED_ENV_VARS: Array<{ old: string; reason: string }> = [
    { old: 'CODEX_EFFORT_DEFAULT', reason: 'effort is now matrix-driven by task size in getCodexConfig() — no equivalent knob' },
    { old: 'CODEX_EFFORT_DELICATE', reason: 'effort is now matrix-driven by task size in getCodexConfig() — no equivalent knob' },
];

export function warnLegacyEnvVars(): void {
    for (const { old, replacement } of LEGACY_FALLBACK_ENV_VARS) {
        if (process.env[old]) {
            console.error(`⚠️  ${old} is deprecated — use ${replacement}. Current run still honors it.`);
        }
    }
    for (const { old, reason } of LEGACY_IGNORED_ENV_VARS) {
        if (process.env[old]) {
            console.error(`⚠️  ${old} is no longer honored — ${reason}. Update the matrix in scripts/run-task.ts if you need different effort.`);
        }
    }
}

export function warnWorktreesRootMismatch(): void {
    if (!process.env.CANON_WORKTREES_ROOT) return;
    const candidates = [
        path.join(REPO_ROOT, '.claude/settings.json'),
        path.join(REPO_ROOT, '.claude/settings.local.json'),
    ];
    const declaredDirs: string[] = [];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
                permissions?: { additionalDirectories?: string[] };
            };
            const dirs = parsed.permissions?.additionalDirectories ?? [];
            for (const dir of dirs) {
                declaredDirs.push(path.resolve(REPO_ROOT, dir));
            }
        } catch {
            // malformed JSON; let Claude Code surface that error elsewhere
        }
    }
    if (declaredDirs.length === 0) return;
    const matches = declaredDirs.some(dir => dir === WORKTREES_ROOT);
    if (matches) return;
    console.error(
        `⚠️  CANON_WORKTREES_ROOT is set to ${WORKTREES_ROOT}, but no \`additionalDirectories\` entry in ` +
        `.claude/settings.json or .claude/settings.local.json matches that path. ` +
        `Claude Code will not be able to read/write inside the worktree. ` +
        `Add ${WORKTREES_ROOT} to additionalDirectories in one of those files (settings.local.json is the right place for per-machine overrides).`
    );
}

export function resolveProjectName(): string {
    if (process.env.CANON_PROJECT_NAME) return process.env.CANON_PROJECT_NAME;
    try {
        const pkgPath = path.join(REPO_ROOT, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
            if (pkg.name) return pkg.name;
        }
    } catch {
        // ignore — fall through
    }
    return 'your project';
}

export const config = {
    projectName: resolveProjectName(),
    claudeBudget: process.env.CLAUDE_BUDGET ?? '5.00',
    claudeModelSpec: process.env.CLAUDE_MODEL_SPEC ?? process.env.CLAUDE_MODEL ?? 'opus',
    claudeModelPlan: process.env.CLAUDE_MODEL_PLAN ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeModelReview: process.env.CLAUDE_MODEL_REVIEW ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeModelReviewLarge: process.env.CLAUDE_MODEL_REVIEW_LARGE ?? process.env.CLAUDE_MODEL ?? 'opus',
    claudeModelQa: process.env.CLAUDE_MODEL_QA ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? 'gpt-5.4-mini',
    codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? 'gpt-5.5',
    maxReviewLoops: process.env.MAX_REVIEW_LOOPS ? Number.parseInt(process.env.MAX_REVIEW_LOOPS, 10) : null,
    maxContextBytes: Number.parseInt(process.env.MAX_CONTEXT_BYTES ?? String(64 * 1024), 10),
};
