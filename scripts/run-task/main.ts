import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodeReviewPhase } from './phases/code-review.js';
import { runImplementPhase } from './phases/implement.js';
import { runPlanPhase } from './phases/plan.js';
import { runQaPhase } from './phases/qa.js';
import { runSpecPhase } from './phases/spec.js';
import { runSpecReviewPhase } from './phases/spec-review.js';
import * as splitTypes from './types.js';
import type { PhaseRunResult } from './types.js';
import * as splitCli from './cli.js';
import * as splitEnv from './env.js';
import * as splitState from './state.js';
import * as splitGit from './git.js';
import * as splitWorktree from './worktree.js';
import * as splitPolicy from './policy.js';
import * as splitValidation from './validation.js';
import * as splitTaskSh from './task-sh.js';
import * as splitClaude from './agents/claude.js';
import * as splitCodex from './agents/codex.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = splitEnv.REPO_ROOT;
const TASKS_DIR = splitEnv.TASKS_DIR;

// Worktree root location. Default is a sibling directory `../dev-worktrees`
// (keeps task worktrees out of the main repo's working tree). Override via
// CANON_WORKTREES_ROOT env var — useful when the sibling layout doesn't fit
// (e.g., monorepos, nested checkouts, projects that prefer in-tree worktrees).
// If you change this, also update `additionalDirectories` in
// `.claude/settings.json` to match — Claude Code's permission boundary needs
// the same path the orchestrator writes to.
// ── Constants ──────────────────────────────────────────────────────────────

const PHASE_ORDER = splitTypes.PHASE_ORDER;
type Phase = splitTypes.Phase;
type PhaseStatus = splitTypes.PhaseStatus;
type Verdict = splitTypes.Verdict;
type CurrentPhase = splitTypes.CurrentPhase;
const isPhaseStatus = splitTypes.isPhaseStatus;
const isVerdict = splitTypes.isVerdict;
type StatusJson = splitTypes.StatusJson;
type CliArgs = splitTypes.CliArgs;
type TaskContext = splitTypes.TaskContext;
type PipelineState = splitTypes.PipelineState;

// Stall detection: if no stdout/stderr data arrives within this window, the
// child is assumed hung and gets killed. Override with PIPELINE_STALL_TIMEOUT_MS.
// Default 10 minutes — agent reasoning bursts (Sonnet on a hard plan, Opus on
// a delicate refactor) can sit silent for several minutes between tool calls,
// so the threshold needs to clear normal think-time. Symphony's daemon uses
// 5 min for stuck Codex sessions; we run longer agent calls and prefer to
// over-wait rather than nuke a working session.
// Files maintained by the pipeline itself (script-authored telemetry or
// high-level QA logs appended by sub-Claude). Auto-commit treats these as
// artifacts rather than source changes: they're excluded from the
// "dirty files not covered by handoff.md" check, and bundled into the
// task-artifacts commit so they don't leave the working tree dirty
// between phases.
export const PIPELINE_TELEMETRY_FILES = splitWorktree.PIPELINE_TELEMETRY_FILES;

// ── Module state ───────────────────────────────────────────────────────────

let cliArgs: CliArgs = {
    taskIds: [],
    interactive: false,
    step: false,
    expectPhase: null,
    push: false,
    pr: false,
    reroute: false,
    ship: false,
    dryRun: false,
};
let ghAvailable = false;
// Claude session ID captured after each Claude-run phase for session resumption.
let lastClaudeSessionId: string | null = null;
// Codex session ID captured from startup banner for session resumption
let lastCodexSessionId: string | null = null;
// Non-zero Codex exit (e.g. MCP warnings) doesn't necessarily mean failure.
// checkAndRoute validates by reading status.json instead of trusting exit code alone.
let lastCodexExitStatus = 0;

// ── Output helpers ─────────────────────────────────────────────────────────

const die = splitCli.die;
const info = splitCli.info;
const warn = splitCli.warn;

// ── Arg parsing ────────────────────────────────────────────────────────────

// ── File system ────────────────────────────────────────────────────────────

const taskDirFor = splitState.taskDirFor;
const readStatus = splitState.readStatus;
const deriveTopLevelStatus = splitState.deriveTopLevelStatus;

// ── Command runners ────────────────────────────────────────────────────────

const runCommand = splitGit.runCommand;

// ── Git helpers ────────────────────────────────────────────────────────────

const git = splitGit.git;
const gitSafe = splitGit.gitSafe;
const gitSafeAt = splitGit.gitSafeAt;
const gitSafeAtRaw = splitGit.gitSafeAtRaw;
const getBaseBranch = splitGit.getBaseBranch;
type SessionSlot = splitTypes.SessionSlot;
// ── Phase status helpers ───────────────────────────────────────────────────

function getCurrentPhase(status: StatusJson): CurrentPhase {
    // Always derive from phases — never trust the top-level pointer on its own.
    // A stale top-level value (e.g. from a hand-edited status.json or an older
    // task.sh run) would otherwise silently route to the wrong phase.
    return deriveTopLevelStatus(status);
}

function getPhaseStatus(status: StatusJson, phase: Phase): PhaseStatus {
    const value = status.phases[phase]?.status;
    return isPhaseStatus(value) ? value : 'pending';
}

function getVerdict(status: StatusJson, phase: 'spec_review' | 'code_review'): Verdict {
    const value = status.phases[phase]?.verdict;
    return isVerdict(value) ? value : '';
}

function getIterations(status: StatusJson): number {
    return status.phases.code_review?.iterations ?? 0;
}

function getTitle(status: StatusJson): string {
    return status.title ?? '(untitled)';
}

// ── Pipeline state builder ─────────────────────────────────────────────────

function buildPipelineState(taskIds: string[]): PipelineState {
    const statuses = taskIds.map(splitState.readStatus);
    const tier = splitPolicy.detectTier(statuses);
    const tasks: TaskContext[] = taskIds.map((taskId, i) => ({
        taskId,
        title: getTitle(statuses[i]),
        specReviewVerdict: getVerdict(statuses[i], 'spec_review'),
        iterations: getIterations(statuses[i]),
        rerouteCount: statuses[i].phases.implement?.reroute_count ?? 0,
        status: statuses[i],
    }));
    return { tasks, tier, isBundle: taskIds.length > 1 };
}

// ── Phase assertion ────────────────────────────────────────────────────────

function assertSamePhase(taskIds: string[]): CurrentPhase {
    const phases = taskIds.map(id => getCurrentPhase(readStatus(id)));
    const unique = new Set(phases);
    if (unique.size > 1) {
        die(
            `Bundle tasks are at different phases — cannot proceed.\n` +
            taskIds.map((id, i) => `  ${id}: ${phases[i]}`).join('\n') +
            `\n  Resolve manually then re-run.`
        );
    }
    return phases[0];
}

function appendAutoCommitDebug(taskIds: string[], details: Record<string, unknown>): void {
    const notesPath = path.join(taskDirFor(taskIds[0]), 'notes.md');
    try {
        fs.mkdirSync(path.dirname(notesPath), { recursive: true });
        fs.appendFileSync(
            notesPath,
            `\n[auto-commit-debug] ${new Date().toISOString()} ${JSON.stringify(details)}\n`,
            'utf8'
        );
    } catch {
        // Debug logging must never mask the real auto-commit result.
    }
}

function verifyHandoffFilesCommitted(
    taskIds: string[],
    cwd: string,
    handoffFiles: readonly string[],
    debug: Record<string, unknown>,
): void {
    const baseRef = getBaseBranch(taskIds);
    const postStatus = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall', '--', ...handoffFiles);
    const missing: string[] = [];

    if (!postStatus.ok) {
        Object.assign(debug, {
            baseRef,
            postCommitStatusOk: postStatus.ok,
            postCommitStatusRaw: postStatus.stdout,
            postCommitStatusError: postStatus.stderr,
        });
        appendAutoCommitDebug(taskIds, debug);
        die(`Auto-commit coverage check failed: could not inspect post-commit status: ${postStatus.stderr || 'unknown error'}`);
    }

    const stillDirty = splitGit.parsePorcelain(postStatus.stdout);

    for (const filePath of handoffFiles) {
        if (stillDirty.has(filePath)) {
            missing.push(`${filePath} — still dirty after auto-commit`);
            continue;
        }
        const committed = gitSafeAt(cwd, 'log', '--format=%H', '--max-count=1', `${baseRef}..HEAD`, '--', filePath);
        if (!committed.ok || !committed.stdout.trim()) {
            missing.push(`${filePath} — no commit touches this path in ${baseRef}..HEAD`);
        }
    }

    // Belt-and-suspenders against the silent-omission case: `git diff HEAD` against
    // every handoff file. If the working tree differs from HEAD on any of them, the
    // file's current content is not in any commit — even if `git status` (above) and
    // `git log` (also above) both said it was. Both of those use the status cache;
    // `git diff HEAD` queries the merkle tree directly. Runs on EVERY return path
    // (this function is called from autoCommitCode's success path AND from every
    // early-return path), so the silent-status-omission failure mode is always caught
    // regardless of which path the auto-commit took. Surfaced 2026-05-07 via canon
    // iteration 3 of handoff-verifier; this is the canonical defense, not the
    // duplicate `git diff HEAD` check that originally lived only in autoCommitCode's
    // success path. See docs/lessons-learned.md for the incident.
    const wtDiff = gitSafeAtRaw(cwd, 'diff', 'HEAD', '--name-only', '--', ...handoffFiles);
    if (!wtDiff.ok) {
        Object.assign(debug, { wtDiffOk: false, wtDiffError: wtDiff.stderr });
        appendAutoCommitDebug(taskIds, debug);
        die(`Auto-commit coverage check failed: \`git diff HEAD\` failed: ${wtDiff.stderr || 'unknown error'}`);
    }
    if (wtDiff.stdout.trim()) {
        const stillDifferent = wtDiff.stdout.split('\n').map(s => s.trim()).filter(Boolean);
        for (const f of stillDifferent) {
            // Avoid duplicate messages if status already flagged it as still-dirty.
            if (missing.some(m => m.startsWith(`${f} —`))) continue;
            missing.push(`${f} — working tree differs from HEAD (status reported clean — silent-omission failure mode)`);
        }
    }

    Object.assign(debug, {
        baseRef,
        postCommitStatusRaw: postStatus.stdout,
        postCommitWtDiffRaw: wtDiff.stdout,
        postCommitMissingCoverage: missing,
    });

    if (missing.length > 0) {
        appendAutoCommitDebug(taskIds, debug);
        die(
            `Auto-commit coverage check failed: handoff.md lists files that are neither committed nor cleanly staged for review.\n` +
            missing.map(m => `    ${m}`).join('\n') +
            `\n  To recover: \`cd ${cwd} && git diff HEAD\` to inspect, then stage and commit the missing changes manually before code_review.`
        );
    }
}

function autoCommitCode(taskIds: string[], cwd = REPO_ROOT): void {
    const primaryStatus = splitState.readStatus(taskIds[0]);
    const title = getTitle(primaryStatus);

    const allHandoffFiles = new Set<string>();
    for (const taskId of taskIds) {
        for (const file of splitValidation.parseHandoffFiles(taskId)) {
            allHandoffFiles.add(file);
        }
    }

    if (allHandoffFiles.size === 0) {
        warn('No files found in handoff.md Changes tables — skipping auto-commit.');
        warn('Stage and commit manually, or ensure all handoff.md files have a Changes table.');
        return;
    }

    const handoffFiles = [...allHandoffFiles];
    const debug: Record<string, unknown> = {
        cwd,
        handoffFiles,
    };

    // `-uall` expands new directories into individual file entries. Without it,
    // `git status --porcelain` emits one `?? dir/` line per new directory, which
    // drops every file inside from the staged set (wall-textures regression,
    // 2026-04-17).
    const dirtyResult = splitGit.gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    Object.assign(debug, {
        dirtyStatusOk: dirtyResult.ok,
        dirtyStatusRaw: dirtyResult.stdout,
        dirtyStatusError: dirtyResult.stderr,
    });
    if (!dirtyResult.ok) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'dirty-status-failed' });
        splitCli.die(`Auto-commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || 'unknown error'}`);
    }
    if (!dirtyResult.stdout.trim()) {
        verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'no-uncommitted-changes' });
        splitCli.info('No uncommitted changes to auto-commit.');
        return;
    }

    const dirtyFiles = splitGit.parsePorcelain(dirtyResult.stdout);
    const toStage = handoffFiles.filter(f => dirtyFiles.has(f));
    Object.assign(debug, {
        dirtyFiles: [...dirtyFiles],
        toStage,
    });

    // Verify every handoff file is accounted for. If a handoff entry isn't
    // dirty, it must either (a) exist on disk AND be tracked (= already
    // committed / clean), or (b) have already been committed in baseRef..HEAD
    // — covers files deleted or renamed in an earlier commit on this branch
    // (refactor pattern: round 1 deletes ProjectContext.tsx, round 2 review
    // fixes don't re-touch it, but handoff still lists it as a Change).
    const missing: string[] = [];
    const baseRefForLog = splitGit.getBaseBranch(taskIds);
    for (const f of allHandoffFiles) {
        if (dirtyFiles.has(f)) continue;
        const exists = fs.existsSync(path.join(cwd, f));
        if (!exists) {
            // Path is absent from the working tree — accept it if a commit on
            // this branch already touched it (delete, rename, or modify-then-
            // delete-in-later-commit all show up here).
            const committed = splitGit.gitSafeAt(cwd, 'log', '--format=%H', '--max-count=1', `${baseRefForLog}..HEAD`, '--', f);
            if (committed.ok && committed.stdout.trim()) continue;
            missing.push(`${f} — listed in handoff but missing from working tree (and no commit in ${baseRefForLog}..HEAD touches this path)`);
            continue;
        }
        const tracked = gitSafeAt(cwd, 'ls-files', '--error-unmatch', '--', f).ok;
        if (!tracked) {
            missing.push(`${f} — untracked on disk but git status did not report it (report this as a bug)`);
        }
    }
    if (missing.length > 0) {
        appendAutoCommitDebug(taskIds, { ...debug, missing });
        splitCli.die(
            `Auto-commit aborted: handoff.md lists files that can't be staged:\n` +
            missing.map(m => `    ${m}`).join('\n') +
            `\n  Verify the files exist and fix handoff.md's Changes table, or stage manually.`
        );
    }

    const stagedBefore = splitGit.gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    const stagedBeforeUnexpected = stagedBefore.ok
        ? splitValidation.findStagedFilesOutsideHandoff(stagedBefore.stdout, allHandoffFiles)
        : [];
    Object.assign(debug, {
        stagedBeforeOk: stagedBefore.ok,
        stagedBeforeRaw: stagedBefore.stdout,
        stagedBeforeUnexpected,
    });
    if (!stagedBefore.ok) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'staged-before-failed' });
        splitCli.die(`Auto-commit aborted: failed to inspect staged files: ${stagedBefore.stderr || 'unknown error'}`);
    }
    if (stagedBeforeUnexpected.length > 0) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'preexisting-staged-outside-handoff' });
        splitCli.die(
            `Auto-commit aborted: staged files are not covered by handoff.md.\n` +
            `  Staged files:\n${stagedBeforeUnexpected.map(f => `    ${f}`).join('\n')}\n` +
            `  Unstage them or list them in handoff.md before rerunning.`
        );
    }

    if (toStage.length === 0) {
        verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'already-committed-or-unchanged' });
        splitCli.info('Handoff files are already committed or unchanged — skipping auto-commit.');
        return;
    }

    // Stage every handoff path, not just paths reported by `git status`. This is
    // idempotent for clean files and avoids porcelain-output or racy-status
    // omissions dropping a valid handoff file from the commit.
    const addResult = splitGit.gitSafeAt(cwd, 'add', '-A', '--', ...handoffFiles);
    Object.assign(debug, {
        addOk: addResult.ok,
        addError: addResult.stderr,
    });
    if (!addResult.ok) die(`Failed to stage files: ${addResult.stderr || 'unknown error'}`);

    const preCheck = splitGit.gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    const remaining = preCheck.ok ? splitValidation.findUncoveredTrackedChanges(preCheck.stdout, allHandoffFiles) : [];
    const stagedAfter = splitGit.gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    const stagedAfterUnexpected = stagedAfter.ok
        ? splitValidation.findStagedFilesOutsideHandoff(stagedAfter.stdout, allHandoffFiles)
        : [];
    Object.assign(debug, {
        preCheckOk: preCheck.ok,
        preCheckRaw: preCheck.stdout,
        remaining,
        stagedAfterOk: stagedAfter.ok,
        stagedAfterRaw: stagedAfter.stdout,
        stagedAfterUnexpected,
    });
    if (!preCheck.ok) {
        splitGit.gitSafeAt(cwd, 'reset', 'HEAD', '--', ...handoffFiles);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'precheck-failed' });
        splitCli.die(`Auto-commit aborted: failed to inspect working tree after staging: ${preCheck.stderr || 'unknown error'}`);
    }
    if (remaining.length > 0) {
        splitGit.gitSafeAt(cwd, 'reset', 'HEAD', '--', ...handoffFiles);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'uncovered-source-changes' });
        splitCli.die(
            `Auto-commit aborted: working tree has source changes not covered by handoff.md.\n` +
            `  Dirty files:\n${remaining.map(l => `    ${l}`).join('\n')}\n` +
            `  Fix handoff.md to list all changed files (including both sides of renames),\n` +
            `  or stage and commit manually.`
        );
    }
    if (!stagedAfter.ok) {
        splitGit.gitSafeAt(cwd, 'reset', 'HEAD', '--', ...handoffFiles);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'staged-after-failed' });
        splitCli.die(`Auto-commit aborted: failed to inspect staged files: ${stagedAfter.stderr || 'unknown error'}`);
    }
    if (stagedAfterUnexpected.length > 0) {
        splitGit.gitSafeAt(cwd, 'reset', 'HEAD', '--', ...handoffFiles);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'staged-after-outside-handoff' });
        splitCli.die(
            `Auto-commit aborted: staged files are not covered by handoff.md.\n` +
            `  Staged files:\n${stagedAfterUnexpected.map(f => `    ${f}`).join('\n')}\n` +
            `  Unstage them or list them in handoff.md before rerunning.`
        );
    }
    if (!stagedAfter.stdout.trim()) {
        verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'nothing-staged-after-add' });
        splitCli.info('Handoff files are already committed or unchanged — skipping auto-commit.');
        return;
    }

    const idSuffix = taskIds.length > 1 ? `[${taskIds.join(', ')}]` : `[${taskIds[0]}]`;
    const message = `${title} ${idSuffix}`;
    const commitResult = splitGit.gitSafeAt(cwd, 'commit', '-m', message);
    Object.assign(debug, {
        commitOk: commitResult.ok,
        commitStdout: commitResult.stdout,
        commitError: commitResult.stderr,
    });
    if (!commitResult.ok) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'commit-failed' });
        splitCli.die(`Auto-commit failed: ${commitResult.stderr || 'unknown error'}`);
    }
    // verifyHandoffFilesCommitted now also runs `git diff HEAD` and aborts if any
    // handoff file's working-tree state still differs from HEAD — covering both the
    // success path (here) and every early-return path above.
    verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
    appendAutoCommitDebug(taskIds, { ...debug, result: 'committed' });
    const stagedCount = stagedAfter.stdout.trim().split('\n').filter(Boolean).length;
    info(`Auto-committed ${stagedCount} file(s): ${message}`);
}

function humanReviewAllowedPath(taskIds: string[], filePath: string): boolean {
    const telemetryFiles = splitWorktree.PIPELINE_TELEMETRY_FILES as readonly string[];
    const managedDocs = splitWorktree.PIPELINE_MANAGED_DOCS as readonly string[];
    return taskIds.some(taskId => filePath === `tasks/${taskId}` || filePath.startsWith(`tasks/${taskId}/`)) ||
        telemetryFiles.includes(filePath) ||
        managedDocs.includes(filePath);
}

function mirrorHumanReviewDocsToCwd(cwd: string): void {
    if (cwd === REPO_ROOT) return;
    for (const relPath of [...splitWorktree.PIPELINE_TELEMETRY_FILES, ...splitWorktree.PIPELINE_MANAGED_DOCS]) {
        const src = path.join(REPO_ROOT, relPath);
        const dest = path.join(cwd, relPath);
        if (!fs.existsSync(src)) continue;
        // Skip if the worktree copy has uncommitted changes — preserve QA edits.
        const dirty = splitGit.gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '--', relPath);
        if (dirty.ok && dirty.stdout.trim()) continue;
        try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        } catch {
            // Best-effort mirror: the final dirty-set validation below is authoritative.
        }
    }
}

function commitHumanReviewFiles(taskIds: string[], cwd: string): void {
    mirrorHumanReviewDocsToCwd(cwd);

    const dirtyResult = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    if (!dirtyResult.ok) {
        die(`Human review commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || 'unknown error'}`);
    }

    const dirtyEntries = splitGit.parsePorcelainEntries(dirtyResult.stdout);
    if (dirtyEntries.length === 0) {
        die('Human review commit aborted: no dirty task artifacts, telemetry, or managed docs to commit.');
    }

    const unexpected = dirtyEntries.filter(entry => !entry.paths.every(pathName => humanReviewAllowedPath(taskIds, pathName)));
    if (unexpected.length > 0) {
        die(
            `Human review commit aborted: working tree has dirty files outside the human_review allowlist.\n` +
            unexpected.map(entry => `    ${entry.raw}`).join('\n') +
            `\n  Stage only task artifacts, telemetry, and managed docs before rerunning.`
        );
    }

    const stagePaths = new Set<string>();
    for (const taskId of taskIds) {
        if (dirtyEntries.some(entry => entry.paths.some(pathName => pathName === `tasks/${taskId}` || pathName.startsWith(`tasks/${taskId}/`)))) {
            stagePaths.add(path.join('tasks', taskId));
        }
    }
    for (const relPath of [...splitWorktree.PIPELINE_TELEMETRY_FILES, ...splitWorktree.PIPELINE_MANAGED_DOCS]) {
        if (dirtyEntries.some(entry => entry.paths.includes(relPath))) {
            stagePaths.add(relPath);
        }
    }

    if (stagePaths.size === 0) {
        die('Human review commit aborted: no allowed dirty files found to stage.');
    }

    const stagedBefore = gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    if (!stagedBefore.ok) {
        die(`Human review commit aborted: could not inspect staged files: ${stagedBefore.stderr || 'unknown error'}`);
    }
    const stagedBeforeUnexpected = stagedBefore.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(filePath => !humanReviewAllowedPath(taskIds, filePath));
    if (stagedBeforeUnexpected.length > 0) {
        die(
            `Human review commit aborted: staged files are not covered by the human_review allowlist.\n` +
            stagedBeforeUnexpected.map(f => `    ${f}`).join('\n') +
            `\n  Unstage them or list them in the task artifacts before rerunning.`
        );
    }

    for (const relPath of stagePaths) {
        const addResult = gitSafeAt(cwd, 'add', '-A', '--', relPath);
        if (!addResult.ok) {
            die(`Human review commit aborted: failed to stage ${relPath}: ${addResult.stderr || 'unknown error'}`);
        }
    }

    const stagedResult = gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    if (!stagedResult.ok) {
        die(`Human review commit aborted: could not inspect staged files after add: ${stagedResult.stderr || 'unknown error'}`);
    }
    const stagedNames = stagedResult.stdout.split('\n').map(line => line.trim()).filter(Boolean);
    if (stagedNames.length === 0) {
        die('Human review commit aborted: staging produced no commit-ready files.');
    }
    const stagedUnexpected = stagedNames.filter(filePath => !humanReviewAllowedPath(taskIds, filePath));
    if (stagedUnexpected.length > 0) {
        die(
            `Human review commit aborted: staged files escaped the allowlist.\n` +
            stagedUnexpected.map(f => `    ${f}`).join('\n')
        );
    }

    const branchResult = gitSafeAt(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
    if (!branchResult.ok || !branchResult.stdout.trim()) {
        die(`Human review commit aborted: could not determine the current branch: ${branchResult.stderr || 'unknown error'}`);
    }
    const branchName = branchResult.stdout.trim();
    const baseBranch = getBaseBranch(taskIds);
    const title = getTitle(splitState.readStatus(taskIds[0]));
    const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');

    const commitMessage = `chore: add task artifacts for ${label}`;
    const commitResult = gitSafeAt(cwd, 'commit', '-m', commitMessage);
    if (!commitResult.ok) {
        die(`Human review commit aborted: ${commitResult.stderr || 'unknown error'}`);
    }

    info(`Committed human_review artifacts on ${branchName}: ${commitMessage}`);
    info(`Pushing ${branchName}...`);
    const pushResult = gitSafeAt(cwd, 'push', 'origin', branchName);
    if (!pushResult.ok) {
        die(`Human review push failed: ${pushResult.stderr || 'unknown error'}`);
    }

    if (cliArgs.pr) {
        if (!ghAvailable) die('--pr requires the gh CLI, but it is not available.');
        const prResult = splitGit.runCommand('gh', [
            'pr', 'create',
            '--draft',
            '--base', baseBranch,
            '--head', branchName,
            '--title', title,
            '--body', `Auto-generated by canon-ai for ${label}.`,
        ]);
        if (!prResult.ok) {
            die(`Failed to create draft PR: ${prResult.stderr || 'unknown error'}`);
        }
        info(`Draft PR created: ${prResult.stdout || branchName}`);
    }
}

function printDryRunPlan(state: PipelineState): void {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    const currentPhase = assertSamePhase(taskIds);

    info(`Dry run (${state.tier} tier${state.isBundle ? `, bundle: ${taskIds.join(', ')}` : ''})`);
    if (currentPhase === 'complete') {
        info('No phases remain — tasks are already complete.');
        return;
    }

    console.log('Planned phases:');
    const currentIdx = PHASE_ORDER.indexOf(currentPhase);
    for (const phase of PHASE_ORDER.slice(currentIdx)) {
        if (phase === 'human_review') continue;
        if (phase === 'spec_review' && state.tier === 'fast') continue;
        if (phase === 'spec' || phase === 'plan' || phase === 'code_review' || phase === 'qa') {
            const cfg = splitPolicy.getClaudeConfig(phase, tasks);
            console.log(`  - ${phase}: Claude / ${cfg.model} / ${cfg.effort}`);
            continue;
        }
        if (phase === 'spec_review' || phase === 'implement') {
            const cfg = splitPolicy.getCodexConfig(phase, tasks);
            console.log(`  - ${phase}: Codex / ${cfg.model} / ${cfg.effort}`);
        }
    }
    console.log('  - human_review: no LLM');
}

// ── Ship (archive) ─────────────────────────────────────────────────────────

/**
 * Refuse to ship if local <baseBranch> is behind origin/<baseBranch>.
 * Only called when no PR was merged (i.e., user merged manually before --ship).
 */
function assertLocalBaseInSyncWithOrigin(taskIds: string[]): void {
    const baseBranch = getBaseBranch(taskIds);

    const fetchResult = gitSafe('fetch', 'origin', baseBranch);
    if (!fetchResult.ok) {
        warn(
            `Could not fetch origin/${baseBranch} (network unavailable?). ` +
            `Skipping rebase-safety check; verify locally with \`git pull --rebase origin ${baseBranch}\` if you've recently merged the PR.`,
        );
        return;
    }

    const behindResult = gitSafe('rev-list', '--count', `HEAD..origin/${baseBranch}`);
    if (!behindResult.ok) {
        warn(`Could not check sync with origin/${baseBranch}: ${behindResult.stderr}. Proceeding without check.`);
        return;
    }

    const behind = Number.parseInt(behindResult.stdout, 10);
    if (Number.isNaN(behind) || behind === 0) return;

    die(
        `Local ${baseBranch} is ${behind} commit${behind === 1 ? '' : 's'} behind origin/${baseBranch}. ` +
        `Rebase before --ship: \`git pull --rebase origin ${baseBranch}\` (or \`./scripts/task.sh post-merge-sync ${baseBranch}\`). ` +
        `The squash merge of the implement-phase PR re-introduces tasks/<id>/ on origin/${baseBranch}; ` +
        `rebasing first ensures --ship consumes the post-merge files instead of leaving a duplicate. ` +
        `See docs/pipeline-orchestrator.md §Shipping & Post-Merge Reconciliation.`,
    );
}

/**
 * Verify the local task/<id> branch (if it exists) has been fully pushed to origin.
 * Aborts --ship if local has commits not on origin — those commits would be lost when
 * the orchestrator deletes the local branch after teardown.
 *
 * No-op when the local branch doesn't exist (already cleaned up, or worktree mode
 * never used). Treats "origin/<branch> does not exist" as a soft signal: if we just
 * fetched and origin doesn't have the branch, either it was deleted post-merge
 * (fine; a successful prior --ship or PR squash-merge) or it was never pushed (bad).
 * We can't tell which without more state, so we warn and continue rather than block
 * legitimate post-merge re-runs.
 */
function assertTaskBranchPushed(taskId: string): void {
    const branchName = `task/${taskId}`;
    if (!splitGit.branchExistsLocally(branchName)) return;

    // Refresh remote-tracking ref before comparing.
    splitGit.gitSafe('fetch', 'origin', branchName);

    const remoteRefResult = splitGit.gitSafe('rev-parse', '--verify', `origin/${branchName}`);
    if (!remoteRefResult.ok) {
        warn(
            `origin/${branchName} not found (${remoteRefResult.stderr.trim() || 'unknown'}). ` +
            `Continuing — assuming the remote branch was deleted by an earlier merge. ` +
            `If you have unpushed work on local ${branchName} you wanted to ship, abort with Ctrl+C and push it now.`,
        );
        return;
    }

    // Count commits in local branch that are NOT on origin. Strict SHA equality would
    // false-positive when origin is merely AHEAD of local (e.g., the PR branch was
    // advanced from another checkout, or remote was force-pushed forward) — that's
    // safe to delete; the work isn't unique to local. Only block when local has
    // commits the remote doesn't.
    const aheadResult = splitGit.gitSafe('rev-list', '--count', `origin/${branchName}..${branchName}`);
    if (!aheadResult.ok) {
        warn(`Could not compute ${branchName} vs origin/${branchName} divergence: ${aheadResult.stderr}. Skipping push-verify.`);
        return;
    }
    const ahead = Number.parseInt(aheadResult.stdout.trim(), 10);
    if (Number.isNaN(ahead) || ahead === 0) return;

    const localSha = splitGit.gitSafe('rev-parse', branchName).stdout.trim();
    const remoteSha = splitGit.gitSafe('rev-parse', `origin/${branchName}`).stdout.trim();
    splitCli.die(
        `--ship aborted: local ${branchName} has ${ahead} commit${ahead === 1 ? '' : 's'} not on origin.\n` +
        `  Local HEAD: ${localSha.slice(0, 7)} | origin/${branchName}: ${remoteSha.slice(0, 7)}\n` +
        `  Pushing first prevents work loss — --ship destroys the local branch after merging the PR,\n` +
        `  so unpushed commits would be unreachable. Push:\n` +
        `    git push origin ${branchName}\n` +
        `  Then re-run --ship.`,
    );
}

/**
 * Verify origin/task/<id> no longer exists at the point we're about to ship. A
 * successful PR merge (via gh pr merge --delete-branch) removes the remote ref,
 * so its absence is the post-condition we expect when shipping. Presence here —
 * combined with mergeOpenPRsAndPull() returning false — means either:
 *   - The remote branch has commits that were never PR'd (someone pushed to it
 *     directly from another checkout without opening a PR), so its work is not
 *     in any base-branch merge.
 *   - A prior merge succeeded but `--delete-branch` failed to drop the remote
 *     ref (rare — surface this so the operator can clean up manually rather
 *     than have the safety check pass spuriously next time).
 * Either way, shipping silently would orphan the remote commits.
 */
function assertOriginTaskBranchAbsent(taskId: string): void {
    const branchName = `task/${taskId}`;
    // Query origin directly via ls-remote rather than the local tracking ref. When
    // origin/<branch> was deleted from another checkout, `git fetch --prune origin
    // <branch>` does NOT prune the stale local tracking ref, so a `rev-parse
    // origin/<branch>` would still resolve and falsely block. ls-remote talks to
    // the remote and reports the truth. Caught via codex review of 8c3bb7e.
    //
    // Pass the FULL ref `refs/heads/<branch>` rather than just `<branch>`. With the
    // short form, ls-remote pattern-matches by slash-separated suffix, so
    // `task/foo` would also match `backup/task/foo`. The full-ref form requires
    // an exact match. Caught via codex review of 9618171.
    const lsRemote = splitGit.gitSafe('ls-remote', '--heads', 'origin', `refs/heads/${branchName}`);
    if (!lsRemote.ok) {
        warn(
            `Could not query origin for ${branchName} (${lsRemote.stderr.trim() || 'unknown'}). ` +
            `Skipping origin-branch-absence check — re-run --ship when network access is restored if you ` +
            `want this verified.`,
        );
        return;
    }
    if (!lsRemote.stdout.trim()) return; // Empty output → branch absent on origin — expected.

    const remoteSha = lsRemote.stdout.trim().split(/\s+/)[0];
    splitCli.die(
        `--ship aborted: origin/${branchName} still exists at ${remoteSha.slice(0, 7)} but no PR was merged this run.\n` +
        `  Either the remote branch has commits that were never PR'd, or a prior merge\n` +
        `  failed to delete it. Shipping silently would orphan the remote work.\n` +
        `  Resolve manually:\n` +
        `    - If unmerged work: open + merge a PR (gh pr create --base <base> --head ${branchName} ...).\n` +
        `    - If already merged elsewhere: \`git push origin --delete ${branchName}\` and re-run --ship.`,
    );
}

/**
 * Verify there is no open PR for the task's branch. Called after mergeOpenPRsAndPull
 * returned false (no PR was merged this run) — a defensive cross-check against gh
 * transient issues that might have caused findOpenPRNumber to return null spuriously.
 */
function assertNoOpenPRForTask(taskId: string): void {
    const branchName = `task/${taskId}`;
    const prNum = findOpenPRNumber(branchName);
    if (prNum !== null) {
        splitCli.die(
            `--ship aborted: PR #${prNum} is open for ${branchName} but the merge step did not run.\n` +
            `  This can happen during gh transient hiccups. Re-running --ship usually works; if it\n` +
            `  keeps failing, merge the PR manually (gh pr merge ${prNum} --squash --delete-branch)\n` +
            `  and re-run.`,
        );
    }
}

/**
 * Find the number of an open PR whose head branch matches `branch`.
 * Returns null if gh CLI is unavailable, no PR found, or lookup fails.
 */
function findOpenPRNumber(branch: string): number | null {
    if (!ghAvailable) return null;
    const result = splitGit.runCommand('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number', '--jq', '.[0].number']);
    if (!result.ok || !result.stdout.trim() || result.stdout.trim() === 'null') return null;
    const num = Number.parseInt(result.stdout.trim(), 10);
    return Number.isNaN(num) ? null : num;
}

/**
 * For each task branch with an open PR: squash-merge it (deleting the remote
 * branch), then pull the base branch. Returns true if any PR was merged.
 *
 * The `--delete-branch` flag on `gh pr merge` deletes the remote branch and
 * attempts to delete the local branch too. The local deletion may fail if the
 * branch is used by a worktree — that's fine; we clean local branches ourselves
 * after teardown.
 */
function mergeOpenPRsAndPull(taskIds: string[]): boolean {
    const baseBranch = splitGit.getBaseBranch(taskIds);
    // Deduplicate branch names (bundles share one branch)
    const branches = [...new Set(taskIds.map(id => `task/${id}`))];
    let anyMerged = false;
    for (const branch of branches) {
        const prNum = findOpenPRNumber(branch);
        if (!prNum) continue;
        splitCli.info(`Merging PR #${prNum} (${branch} → ${baseBranch}) via squash...`);
        // --delete-branch removes the remote branch; local cleanup happens post-teardown.
        const result = splitGit.runCommand('gh', ['pr', 'merge', String(prNum), '--squash', '--delete-branch']);
        if (!result.ok && !result.stderr.includes('already merged')) {
            splitCli.die(`Failed to merge PR #${prNum}: ${result.stderr}`);
        }
        splitCli.info(`PR #${prNum} merged.`);
        anyMerged = true;
    }
    if (anyMerged) {
        splitCli.info(`Pulling ${baseBranch}...`);
        splitGit.git('pull', 'origin', baseBranch);
    }
    return anyMerged;
}

/**
 * Hook for project-specific post-merge work (e.g., regenerating derived files,
 * syncing dates, refreshing a manifest). Runs after PRs merge and before tasks
 * are archived in --ship.
 *
 * Convention: drop a `.canon/hooks/post-merge.sh` script in your project. If it
 * exists and is executable, the orchestrator runs it via `bash` from REPO_ROOT
 * after merging PRs. The script should be self-contained: invoke whatever
 * commands your project needs, stage and commit any changes it produces, and
 * exit non-zero on hard failure. The orchestrator treats failures as non-fatal
 * (logs a warning and continues) — your hook should not block --ship for
 * recoverable issues.
 *
 * Absence of the hook is the default; canon-ai itself doesn't ship one.
 */
function runPostMergeHook(): void {
    const hookPath = path.join(REPO_ROOT, '.canon/hooks/post-merge.sh');
    if (!fs.existsSync(hookPath)) return;
    info('Running .canon/hooks/post-merge.sh...');
    const result = runCommand('bash', [hookPath]);
    if (!result.ok) {
        warn(`.canon/hooks/post-merge.sh exited non-zero — continuing. stderr: ${result.stderr.slice(0, 400)}`);
    }
}

/**
 * If the base branch is a release branch (release/v<X.Y>) and gh is available,
 * extract the version from package.json and create a GitHub release tag.
 * No-op for tasks branching off main.
 */
function maybeCreateGitHubRelease(baseBranch: string): void {
    if (!ghAvailable) return;
    if (!baseBranch.startsWith('release/')) return;

    // Read version from package.json (already bumped by release-init)
    let version: string;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string };
        version = pkg.version ?? '';
    } catch {
        warn('Could not read package.json version — skipping GitHub release creation.');
        return;
    }
    if (!version) { warn('package.json has no version field — skipping GitHub release creation.'); return; }

    const tag = `v${version}`;
    info(`Creating GitHub release ${tag}...`);
    // Extract the changelog block for this version to use as release notes.
    let notes = `Release ${tag}`;
    try {
        const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
        // Match the block starting with ## v<major.minor> up to the next ## heading
        const match = changelog.match(new RegExp(`(## v${version.replace('.', '\\.')}[\\s\\S]*?)(?=\n## |$)`));
        if (match) notes = match[1].trim();
    } catch { /* no changelog — use default notes */ }

    const result = runCommand('gh', [
        'release', 'create', tag,
        '--title', tag,
        '--notes', notes,
    ]);
    if (!result.ok) {
        warn(`GitHub release creation failed: ${result.stderr || 'unknown error'}`);
    } else {
        info(`GitHub release ${tag} created: ${result.stdout.trim()}`);
    }
}

/**
 * After archiving, rewrite `tasks/<id>/` → `tasks/_archive/<id>/` in the docs
 * files that commonly carry task refs (lessons-learned.md, task-quality-log.md).
 * Prevents stale refs from tripping the docs-refs-check on the next release PR.
 */
function rewriteArchivedTaskRefs(taskIds: string[]): void {
    const targets = [
        path.join(REPO_ROOT, 'docs', 'lessons-learned.md'),
        path.join(REPO_ROOT, 'docs', 'task-quality-log.md'),
    ];
    for (const filePath of targets) {
        if (!fs.existsSync(filePath)) continue;
        let content = fs.readFileSync(filePath, 'utf8');
        let changed = false;
        for (const taskId of taskIds) {
            const stale = `tasks/${taskId}/`;
            const fresh = `tasks/_archive/${taskId}/`;
            if (content.includes(stale)) {
                content = content.replaceAll(stale, fresh);
                changed = true;
            }
        }
        if (changed) {
            fs.writeFileSync(filePath, content, 'utf8');
            info(`Updated stale task refs in ${path.relative(REPO_ROOT, filePath)}.`);
        }
    }
}

function shipTasks(taskIds: string[]): void {
    // Phase guard first — fail fast before any network calls.
    for (const taskId of taskIds) {
        const currentPhase = getCurrentPhase(splitState.readStatus(taskId));
        if (currentPhase !== 'human_review' && currentPhase !== 'complete') {
            splitCli.die(`--ship requires tasks at human_review or complete. '${taskId}' is at: ${currentPhase}`);
        }
    }

    // Pre-flight: every local task branch with unpushed commits is a hard abort.
    // --ship later tears down the worktree and deletes the local branch; if local
    // has commits not on origin, those commits are lost forever (gone from any
    // ref the user can reach). Also covers the case where the PR-merge step below
    // silently misses a PR for any reason — instead of trusting that flow alone,
    // we independently verify origin has the local work before any destruction.
    // Surfaced 2026-05-07 via canon-on-canon dogfood: the iteration-3 rename fix
    // was committed locally, never pushed, then --ship deleted the branch; only
    // the dangling commits in `git fsck` survived (with a partial subset of files).
    for (const taskId of taskIds) {
        assertTaskBranchPushed(taskId);
    }

    // Flush any telemetry before merging so the PR doesn't pick it up.
    if (taskIds.some(id => splitState.readStatus(id).worktree === true)) splitWorktree.flushWorktreeTelemetry();

    // Merge open PRs and pull; if none found, assert the base is already in sync.
    const merged = mergeOpenPRsAndPull(taskIds);
    if (!merged) {
        // No PR was merged this run. That can mean either (a) PR was merged earlier
        // and the remote branch was already cleaned up by `--delete-branch` on the
        // prior merge, or (b) findOpenPRNumber missed an open PR (gh transient,
        // PR state quirk), or (c) the remote task branch exists with commits that
        // were never PR'd at all (someone pushed to it directly from another
        // checkout). For (b) and (c), proceeding silently archives the task while
        // its work is unmerged — destroying any local artifact path back to those
        // commits and leaving the base branch missing the task's content.
        // Independent verification here prevents that class of silent failure.
        assertLocalBaseInSyncWithOrigin(taskIds);
        for (const taskId of taskIds) assertNoOpenPRForTask(taskId);
        // After mergeOpenPRsAndPull(), a successful merge would have invoked
        // --delete-branch and removed origin/task/<id>. If that branch still exists
        // here, no merge ever happened for it — abort. The earlier
        // assertTaskBranchPushed() (count-of-local-commits-ahead-of-origin) misses
        // this case because origin can be AHEAD of local and have unmerged commits
        // that are only on the remote, never in the base. Caught via codex review
        // of fb76257.
        for (const taskId of taskIds) assertOriginTaskBranchAbsent(taskId);
    }

    // Post-merge: project-specific hook (default no-op; edit runPostMergeHook).
    runPostMergeHook();

    const baseBranch = splitGit.getBaseBranch(taskIds);
    const archiveDir = path.join(TASKS_DIR, '_archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    const localBranchesToDelete: string[] = [];

    for (const taskId of taskIds) {
        // Read from worktree (canonical during pipeline) before tearing it down.
        const status = splitState.readStatus(taskId);
        const hasWorktree = status.worktree === true;

        // Teardown before writeStatus so the write targets REPO_ROOT — ensuring
        // the archived tasks/<id>/status.json has the final completed state, not
        // the stale last-committed snapshot.
        if (hasWorktree) splitWorktree.teardownWorktree(taskId);

        status.updated = new Date().toISOString().slice(0, 10);
        const humanReview = status.phases.human_review;
        if (humanReview) humanReview.status = 'done';
        // writeStatus() derives top-level .status — with every phase now 'done',
        // it becomes 'complete'. No direct assignment needed.
        splitState.writeStatus(taskId, status);

        const src = taskDirFor(taskId);
        const dest = path.join(archiveDir, taskId);
        fs.renameSync(src, dest);
        info(`📦 ${taskId} → tasks/_archive/${taskId}`);

        // Queue local branch for deletion after worktree is gone.
        const branchName = `task/${taskId}`;
        if (splitGit.branchExistsLocally(branchName)) localBranchesToDelete.push(branchName);
    }

    // Rewrite stale tasks/<id>/... refs → tasks/_archive/<id>/... in docs.
    rewriteArchivedTaskRefs(taskIds);

    // Commit the archive move + any status changes and push.
    const stagedPaths: string[] = taskIds.flatMap(id => [
        path.join(TASKS_DIR, id),                        // deleted source (if not cleaned up)
        path.join(TASKS_DIR, '_archive', id),            // new archive destination
        path.join(REPO_ROOT, 'docs', 'lessons-learned.md'),
        path.join(REPO_ROOT, 'docs', 'task-quality-log.md'),
    ]);
    for (const p of stagedPaths) gitSafe('add', '-A', '--', p);
    const staged = gitSafe('diff', '--cached', '--name-only');
    if (staged.stdout.trim()) {
        const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
        gitSafe('commit', '-m', `chore: archive ${label}`);
        info(`Pushing ${baseBranch}...`);
        git('push', 'origin', baseBranch);
    }

    // Delete local task branches (safe to force — squash-merged).
    for (const branch of localBranchesToDelete) {
        const result = splitGit.gitSafe('branch', '-D', branch);
        if (result.ok) info(`Deleted local branch ${branch}.`);
        else warn(`Could not delete local branch ${branch}: ${result.stderr}`);
    }

    // Create a GitHub release if this is a release-branch PR.
    maybeCreateGitHubRelease(baseBranch);

    info(`Shipped ${taskIds.length} task${taskIds.length > 1 ? 's' : ''} to _archive/.`);
    process.exit(0);
}

// ── Reroute ────────────────────────────────────────────────────────────────

function rerouteFromHumanReview(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const currentPhase = getCurrentPhase(splitState.readStatus(taskId));
        if (currentPhase !== 'human_review') {
            splitCli.die(`--reroute requires all tasks to be at human_review. '${taskId}' is at: ${currentPhase}`);
        }
    }
    splitCli.info(`Rerouting: human_review → implement (resetting implement, code_review, qa)`);
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        status.updated = new Date().toISOString().slice(0, 10);
        // writeStatus() derives top-level .status from phases — resetting
        // implement→pending will flip top-level back to 'implement' automatically.
        const implement = status.phases.implement;
        if (implement) {
            implement.status = 'pending';
            // Flag that Codex must treat this as an amended-spec revision, not a resume.
            // Consumed and cleared in runPhase case 'implement' after the reroute pass runs.
            implement.rerouted = true;
            // Accumulate (never reset). The reroute prompt reads this to inject a round
            // marker so session-resumed Codex can't confuse a new reroute with a duplicate
            // of a prior one — the static prompt text is otherwise identical each round.
            implement.reroute_count = (implement.reroute_count ?? 0) + 1;
        }
        const codeReview = status.phases.code_review;
        if (codeReview) { codeReview.status = 'pending'; codeReview.verdict = ''; codeReview.iterations = 0; }
        const qa = status.phases.qa;
        if (qa) qa.status = 'pending';
        const humanReview = status.phases.human_review;
        if (humanReview) humanReview.status = 'pending';
        splitState.writeStatus(taskId, status);
    }
    splitCli.info('Status reset. Pipeline will resume from implement phase with amended-spec context.');
    splitCli.info('Note: Codex will re-read spec.md carefully (looking for new Amendment sections) and update the implementation.');
}

function routeBackTo(taskIds: string[], targetPhase: Phase): void {
    const targetIdx = PHASE_ORDER.indexOf(targetPhase);
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        // Reset the target phase AND every downstream phase back to pending.
        //
        // Why downstream too: deriveTopLevelStatus() walks PHASE_ORDER and
        // returns the first phase whose status !== 'done'. If we only reset
        // the target, a downstream phase still stamped 'done' from a previous
        // cycle (e.g. code_review with a stale 'changes_requested' verdict,
        // or qa from an earlier attempt) would be skipped entirely on the
        // next dispatch: once the target re-runs and flips back to 'done',
        // the loop skips straight past the un-reset downstream phase to the
        // first still-pending one. That's how changes_requested on code_review
        // used to silently skip the re-review after Codex iterated — the fix
        // came in alongside smart-fill-v3-scoring-fidelity after the bug bit.
        for (let i = targetIdx; i < PHASE_ORDER.length; i += 1) {
            const phaseEntry = status.phases[PHASE_ORDER[i]];
            if (phaseEntry) phaseEntry.status = 'pending';
        }
        // writeStatus() derives top-level .status from phases. With target
        // and all downstream flipped to 'pending', derivation correctly lands
        // on the target phase.
        splitState.writeStatus(taskId, status);
    }
}

// ── runPhase ───────────────────────────────────────────────────────────────

async function runPhase(phase: CurrentPhase, state: PipelineState): Promise<PhaseRunResult | undefined> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    // spec cluster: resumes across spec-revision rounds (always run in REPO_ROOT)
    const specClaudeSession = splitState.getStoredSessionId(taskIds, 'claude_spec');
    // code_review cluster: round 1 is always fresh; round 2+ resumes (same worktree cwd)
    const reviewClaudeSession = splitState.getStoredSessionId(taskIds, 'claude_review');
    const codexSession = splitState.getStoredSessionId(taskIds, 'codex');

    if ((phase as Phase) === 'spec') {
        return runSpecPhase(state, cliArgs.interactive, specClaudeSession);
    }
    if ((phase as Phase) === 'spec_review') {
        return runSpecReviewPhase(state, cliArgs.interactive, codexSession);
    }
    if ((phase as Phase) === 'plan') {
        return runPlanPhase(state, cliArgs.interactive);
    }
    if ((phase as Phase) === 'implement') {
        return runImplementPhase(state, cliArgs.interactive, codexSession);
    }
    if ((phase as Phase) === 'code_review') {
        return runCodeReviewPhase(state, cliArgs.interactive, reviewClaudeSession);
    }
    if ((phase as Phase) === 'qa') {
        return runQaPhase(state, cliArgs.interactive);
    }
    if ((phase as Phase) === 'human_review') {
        const taskIds = tasks.map(t => t.taskId);
        if (cliArgs.push || cliArgs.pr) {
            const cwd = splitWorktree.getActiveCwd(taskIds);
            commitHumanReviewFiles(taskIds, cwd);
            process.exit(0);
        }

        console.log('');
        console.log('════════════════════════════════════════════════════════');
        console.log('  HUMAN REVIEW — no push requested.');
        console.log('');
        console.log('  Done files:');
        for (const taskId of taskIds) {
            console.log(`  tasks/${taskId}/done.md`);
        }
        console.log('');
        console.log('  Re-run with --push to commit task artifacts and push, or --pr to also create a draft PR.');
        console.log('════════════════════════════════════════════════════════');
        console.log('');
        process.exit(0);
    }

    die(`Unknown phase: ${String(phase)}`);
}

// ── Evidence-based phase advance + one-shot retry ─────────────────────────
// Background (2026-04-19): Codex "ran" scripts/task.sh phase smart-fill-v3
// implement done in its final summary — but never actually invoked the tool
// call. Every other action (code edits, validation) was real; only the
// silent-side-effect bookkeeping command was hallucinated. Pipeline bailed
// because phases.implement.status was still in_progress.
//
// Two-layer recovery, in order:
//
//   1. Evidence-based auto-advance. If the phase artifact (handoff.md,
//      review.md, etc.) shows the work actually completed, the pipeline
//      advances phases.X.status itself. Bookkeeping is pipeline-owned, not
//      agent-owned — the agent can't skip what isn't its job.
//
//   2. One-shot retry. If the artifact itself is missing/template (i.e.
//      the agent genuinely didn't finish), resume the session with a terse
//      corrective prompt and re-check. Single turn, cheap.
//
// If both fail, bail to human review as before.

interface EvidenceResult {
    advanced: boolean;
    verdict?: Verdict;
    note: string;
}

// Match "- [x] **Approved**" and variants in a review artifact.
function extractCheckedVerdict(content: string): Verdict | null {
    if (/^- \[x\] \*\*Approved\*\*/mi.test(content)) return 'approved';
    if (/^- \[x\] \*\*Approved with nits\*\*/mi.test(content)) return 'approved_with_nits';
    if (/^- \[x\] \*\*Changes requested\*\*/mi.test(content)) return 'changes_requested';
    if (/^- \[x\] \*\*Needs re-review\*\*/mi.test(content)) return 'needs_re_review';
    return null;
}

function readArtifact(taskId: string, name: string): string | null {
    const p = path.join(taskDirFor(taskId), name);
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// Return whether an artifact still looks like the unfilled template.
// [TASK-ID] is the canonical sentinel since it survives in every template
// file and `scripts/task.sh new` substitutes it on creation.
function isTemplateUnfilled(content: string | null): boolean {
    if (content === null) return true;
    return content.includes('[TASK-ID]');
}

function tryEvidenceAdvance(taskId: string, phase: Phase): EvidenceResult {
    switch (phase) {
        case 'implement': {
            // Three gates before auto-advancing (each rules out a different false-positive):
            //  1. handoff.md Changes table is non-empty (basic sanity)
            //  2. validateHandoff passes — same rule Claude's code review applies:
            //     Validation Outcomes table has no Fail and AC Coverage is present.
            //     Catches "Codex wrote a draft handoff before validation actually passed".
            //  3. at least one listed file exists on disk — catches phantom/hallucinated
            //     filenames in the Changes table.
            const files = splitValidation.parseHandoffFiles(taskId);
            if (files.length === 0) return { advanced: false, note: 'handoff.md Changes table is empty' };
            const issues = splitValidation.validateHandoffAgainstSpec(
                path.join(taskDirFor(taskId), 'spec.md'),
                path.join(taskDirFor(taskId), 'handoff.md'),
            );
            if (issues.length > 0) return { advanced: false, note: `handoff.md validation failed: ${issues.join('; ')}` };
            const checkRoots = [REPO_ROOT];
            const sForEvidence = splitState.readStatus(taskId);
            if (sForEvidence.worktree === true) {
                const wt = splitWorktree.worktreePath(taskId);
                if (fs.existsSync(wt)) checkRoots.push(wt);
            }
            const existingFiles = files.filter(f => checkRoots.some(root => fs.existsSync(path.join(root, f))));
            if (existingFiles.length === 0) {
                return { advanced: false, note: `handoff.md lists ${files.length} file(s) but none exist on disk` };
            }
            splitTaskSh.runTaskShFor(taskId, 'phase', taskId, 'implement', 'done');
            return { advanced: true, note: `handoff.md lists ${files.length} file(s) (${existingFiles.length} verified on disk), validation clean` };
        }
        case 'code_review': {
            const content = readArtifact(taskId, 'review.md');
            if (isTemplateUnfilled(content)) return { advanced: false, note: 'review.md is missing or still the template' };
            const verdict = extractCheckedVerdict(content!);
            if (!verdict) return { advanced: false, note: 'no verdict box checked in review.md' };
            splitTaskSh.runTaskShFor(taskId, 'phase', taskId, 'code_review', 'done', verdict);
            return { advanced: true, verdict, note: `verdict=${verdict}` };
        }
        case 'spec_review': {
            const content = readArtifact(taskId, 'spec-review.md');
            if (isTemplateUnfilled(content)) return { advanced: false, note: 'spec-review.md is missing or still the template' };
            const verdict = extractCheckedVerdict(content!);
            if (!verdict) return { advanced: false, note: 'no verdict box checked in spec-review.md' };
            splitTaskSh.runTaskShFor(taskId, 'phase', taskId, 'spec_review', 'done', verdict);
            return { advanced: true, verdict, note: `verdict=${verdict}` };
        }
        case 'plan': {
            const content = readArtifact(taskId, 'plan.md');
            if (isTemplateUnfilled(content)) return { advanced: false, note: 'plan.md is missing or still the template' };
            splitTaskSh.runTaskShFor(taskId, 'phase', taskId, 'plan', 'done');
            return { advanced: true, note: 'plan.md is populated' };
        }
        case 'spec': {
            const content = readArtifact(taskId, 'spec.md');
            if (isTemplateUnfilled(content)) return { advanced: false, note: 'spec.md is missing or still the template' };
            splitTaskSh.runTaskShFor(taskId, 'phase', taskId, 'spec', 'done');
            return { advanced: true, note: 'spec.md is populated' };
        }
        case 'qa': {
            // Upstream salvage (runPhase case 'qa') already handles the Haiku
            // stdout-streaming case. If we're still at qa != done here, the
            // done.md on disk is what we have to work with.
            const donePath = path.join(splitState.taskDirFor(taskId), 'done.md');
            if (splitValidation.isDoneMdTemplate(donePath)) return { advanced: false, note: 'done.md is still the template' };
            splitTaskSh.runTaskShFor(taskId, 'phase', taskId, 'qa', 'done');
            return { advanced: true, note: 'done.md is populated' };
        }
        default:
            return { advanced: false, note: `phase '${phase}' has no evidence rule` };
    }
}

// Resume the last agent session for this phase and prompt them to complete.
// Single turn, terse — the agent has full conversational context already.
async function retryAgentForPhase(taskId: string, phase: Phase, evidenceNote: string): Promise<'done' | 'drift' | 'no_session'> {
    const status = splitState.readStatus(taskId);
    const agent = status.phases[phase]?.agent;
    if (!agent || (agent !== 'codex' && agent !== 'claude')) return 'no_session';
    const sessionId = status.sessions?.[agent] ?? null;
    if (!sessionId) {
        warn(`Cannot retry ${phase} for ${taskId}: no ${agent} session ID stored.`);
        return 'no_session';
    }

    const verdictHint = (phase === 'spec_review' || phase === 'code_review') ? ' <verdict>' : '';
    const prompt = [
        `PIPELINE GUARDRAIL: phases.${phase}.status for task ${taskId} is still '${getPhaseStatus(status, phase)}'.`,
        `Evidence check: ${evidenceNote}.`,
        '',
        'Your previous turn ended without completing the phase. Finish the work now (write the artifact if missing, commit if needed), then run:',
        `  scripts/task.sh phase ${taskId} ${phase} done${verdictHint}`,
        '',
        'Reply with tool calls only. No summary, no explanation.',
    ].join('\n');

    warn(`Retrying ${agent} session ${sessionId.slice(0, 8)}... for ${taskId} ${phase}.`);
    // Implement retries must use the worktree CWD if the task has one.
    const retryCwd = (agent === 'codex' && phase === 'implement') ? splitWorktree.getActiveCwd([taskId]) : REPO_ROOT;
    if (agent === 'codex') {
        // Retry phase must be a Codex-run phase. spec_review and implement are
        // the only two; anything else indicates a stored agent mismatch.
        if (phase !== 'spec_review' && phase !== 'implement') {
            warn(`Cannot retry ${phase} with Codex — not a Codex-run phase.`);
            return 'no_session';
        }
        const retryTasks: TaskContext[] = [{
            taskId, title: status.title ?? taskId, specReviewVerdict: '',
            iterations: 0, rerouteCount: 0, status,
        }];
        const cfg = splitPolicy.getCodexConfig(phase, retryTasks);
        await splitCodex.runCodex(prompt, false, sessionId, cfg.model, cfg.effort, undefined, retryCwd);
    } else {
        if (phase !== 'spec' && phase !== 'plan' && phase !== 'code_review' && phase !== 'qa') {
            warn(`Cannot retry ${phase} with Claude — not a Claude-run phase.`);
            return 'no_session';
        }
        const retryTasks: TaskContext[] = [{
            taskId, title: status.title ?? taskId, specReviewVerdict: '',
            iterations: 0, rerouteCount: 0, status,
        }];
        const cfg = splitPolicy.getClaudeConfig(phase, retryTasks);
        await splitClaude.runClaude(prompt, false, sessionId, cfg.model, cfg.effort, undefined, retryCwd);
    }

    return getPhaseStatus(splitState.readStatus(taskId), phase) === 'done' ? 'done' : 'drift';
}

// Wraps evidence-advance + retry + post-retry-evidence in a single recovery
// attempt for one task. Returns true if the phase is now 'done' (by any path).
async function recoverPhaseForTask(taskId: string, phase: Phase, initialStatus: PhaseStatus): Promise<boolean> {
    const evidence = tryEvidenceAdvance(taskId, phase);
    if (evidence.advanced) {
        warn(`Auto-advanced '${phase}' for '${taskId}' (was ${initialStatus}; ${evidence.note}). Agent skipped task.sh bookkeeping.`);
        return true;
    }

    warn(`Evidence insufficient for '${taskId}' ${phase}: ${evidence.note}. Attempting one-shot retry.`);
    const retry = await retryAgentForPhase(taskId, phase, evidence.note);
    if (retry === 'no_session') return false;
    if (retry === 'done') {
        warn(`Retry succeeded — '${taskId}' ${phase} is now done.`);
        return true;
    }

    // Retry ran but status still isn't done. Check evidence once more — maybe
    // the agent produced the artifact on retry but skipped task.sh again.
    const postEvidence = tryEvidenceAdvance(taskId, phase);
    if (postEvidence.advanced) {
        warn(`Retry produced artifact — auto-advanced (${postEvidence.note}).`);
        return true;
    }
    warn(`Retry did not recover '${taskId}' ${phase} (${postEvidence.note}).`);
    return false;
}

// ── checkAndRoute ──────────────────────────────────────────────────────────

async function checkAndRoute(phase: Phase, taskIds: string[]): Promise<void> {
    let statuses = taskIds.map(splitState.readStatus);

    // Verify all tasks completed this phase. If any didn't, attempt
    // evidence-based auto-advance, then a one-shot retry, before bailing.
    for (let i = 0; i < taskIds.length; i += 1) {
        const phaseStatus = getPhaseStatus(statuses[i], phase);
        if (phaseStatus !== 'done') {
            if (lastCodexExitStatus !== 0) {
                warn(`Codex exited with status ${lastCodexExitStatus} and '${phase}' was not completed for '${taskIds[i]}'.`);
            }
            const recovered = await recoverPhaseForTask(taskIds[i], phase, phaseStatus);
            if (!recovered) {
                warn(`Phase '${phase}' did not reach 'done' for '${taskIds[i]}'. Stopping for human review.`);
                process.exit(2);
            }
        }
    }

    // Re-read after any auto-advances so downstream verdict/iteration checks
    // see the fresh state.
    statuses = taskIds.map(splitState.readStatus);

    if (lastCodexExitStatus !== 0) {
        warn(`Phase '${phase}' completed despite Codex exit status ${lastCodexExitStatus} (likely MCP warnings). Continuing.`);
        lastCodexExitStatus = 0;
    }

    switch (phase) {
        case 'spec_review': {
            const anyChangesRequested = statuses.some(s => getVerdict(s, 'spec_review') === 'changes_requested');
            if (anyChangesRequested) {
                info('Spec review requested changes — routing back to spec.');
                routeBackTo(taskIds, 'spec');
                return;
            }
            // Full tier: human gate fires after Codex spec_review completes
            const tier = splitPolicy.detectTier(statuses);
            if (tier === 'full' && statuses.some(s => s.human_spec_gate)) {
                for (const taskId of taskIds) {
                    const s = splitState.readStatus(taskId);
                    s.human_spec_gate = false;
                    splitState.writeStatus(taskId, s);
                }
                const specList = taskIds.map(id => `  tasks/${id}/spec.md`).join('\n');
                const reviewList = taskIds.map(id => `  tasks/${id}/spec-review.md`).join('\n');
                console.log('');
                console.log('════════════════════════════════════════════════════════');
                console.log('  ✋  SPEC GATE — Human review required before planning.');
                console.log('');
                console.log('  Specs:');
                console.log(specList);
                console.log('  Codex reviews:');
                console.log(reviewList);
                console.log('');
                console.log(`  When ready: npx tsx scripts/run-task.ts ${taskIds.join(' ')}`);
                console.log('════════════════════════════════════════════════════════');
                console.log('');
                process.exit(0);
            }
            return;
        }

        case 'implement':
            autoCommitCode(taskIds, splitWorktree.getActiveCwd(taskIds));
            return;

        case 'code_review': {
            const anyChangesRequested = statuses.some(s =>
                getVerdict(s, 'code_review') === 'changes_requested' ||
                getVerdict(s, 'code_review') === 'needs_re_review'
            );
            if (anyChangesRequested) {
                const maxIter = statuses.reduce((max, s) => Math.max(max, getIterations(s)), 0);
                info(`Code review requested changes (iteration ${maxIter}) — routing back to implement`);
                routeBackTo(taskIds, 'implement');
            }
            return;
        }

        default:
            return;
    }
}

// ── Dependency check ───────────────────────────────────────────────────────

function checkDeps(taskIds: string[], skipAgentDeps = false): void {
    if (!skipAgentDeps) {
        for (const dep of ['jq', 'claude', 'codex']) {
            const result = spawnSync('which', [dep], { stdio: 'ignore' });
            if (result.error || result.status !== 0) {
                const label = dep === 'claude' ? 'Claude Code CLI' : dep === 'codex' ? 'Codex CLI' : dep;
                splitCli.die(`${label} is required`);
            }
        }
        ghAvailable = splitGit.isCommandAvailable('gh');
        splitCli.info(ghAvailable
            ? 'gh CLI found — draft PR creation is available.'
            : 'gh CLI not found — PR creation will be unavailable. Push still works.');
    }

    for (const taskId of taskIds) {
        splitCli.validateTaskId(taskId);
        if (!fs.existsSync(splitState.statusFileFor(taskId))) {
            splitCli.die(`No status.json at tasks/${taskId}/status.json — run ./scripts/task.sh new ${taskId} first`);
        }
    }
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
    // Mark all child processes as orchestrator-driven so .githooks/pre-commit
    // and .githooks/pre-push know to skip — the orchestrator already runs
    // validation per phase and re-running it on every auto-commit is waste.
    process.env.RUN_TASK_ORCHESTRATOR = '1';
    cliArgs = splitCli.parseArgs(process.argv.slice(2));
    splitEnv.warnLegacyEnvVars();
    splitEnv.warnWorktreesRootMismatch();
    const skipAgentDeps = cliArgs.ship || cliArgs.dryRun;
    checkDeps(cliArgs.taskIds, skipAgentDeps);

    if (cliArgs.dryRun) {
        const state = buildPipelineState(cliArgs.taskIds);
        printDryRunPlan(state);
        process.exit(0);
    }

    if (cliArgs.pr && !ghAvailable) {
        die('--pr requires the gh CLI, but it is not available.');
    }

    if (cliArgs.ship) {
        shipTasks(cliArgs.taskIds);
    }

    if (cliArgs.reroute) {
        rerouteFromHumanReview(cliArgs.taskIds);
    }

    const { taskIds } = cliArgs;
    const initialState = buildPipelineState(taskIds);

    info(initialState.isBundle
        ? `Pipeline (bundle, ${initialState.tier} tier): ${taskIds.join(', ')}`
        : `Pipeline (${initialState.tier} tier): ${taskIds[0]} — ${initialState.tasks[0].title}`);
    console.log('');

    let expectChecked = false;

    while (true) {
        const currentPhase = assertSamePhase(taskIds);

        if (!expectChecked && cliArgs.expectPhase) {
            if (currentPhase !== cliArgs.expectPhase) {
                die(`--expect ${cliArgs.expectPhase} but current phase is ${currentPhase}`);
            }
            expectChecked = true;
        }

        console.log('────────────────────────────────────────');
        info(`Current phase: ${currentPhase}`);
        console.log('────────────────────────────────────────');

        const state = buildPipelineState(taskIds);
        const phaseResult = await runPhase(currentPhase, state);
        lastClaudeSessionId = phaseResult?.agent === 'claude' ? phaseResult.sessionId : null;
        lastCodexSessionId = phaseResult?.agent === 'codex' ? phaseResult.sessionId : null;
        lastCodexExitStatus = phaseResult?.agent === 'codex' ? (phaseResult.exitCode ?? 0) : 0;

        // In worktree mode, sync task artifacts from worktree → main repo so the
        // pipeline can read them via taskDirFor() (which always returns REPO_ROOT paths).
        // status.json is kept in sync separately via phaseCommands' `cd REPO_ROOT` wrapper.
        // Telemetry files (task-quality-log, lessons-learned, etc.) get mirrored to
        // REPO_ROOT and reverted in the worktree so the eventual flushWorktreeTelemetry
        // commit-on-main path actually sees them.
        if (splitWorktree.isWorktreeEnabled(taskIds)) {
            splitWorktree.syncWorktreeArtifacts(taskIds);
            splitWorktree.syncWorktreeTelemetry(taskIds);
        }

        // Store session IDs after each agent phase for resumption.
        // Sessions are stored per-cluster, not per-phase:
        //   spec/spec_revision → claude_spec  (both run in REPO_ROOT, share continuity)
        //   code_review        → claude_review (same worktree cwd across rounds)
        //   plan, qa           → not stored    (one-offs, always fresh)
        if (currentPhase !== 'complete' && currentPhase !== 'human_review') {
            const agentForPhase = state.tasks[0].status.phases[currentPhase]?.agent;
            if (agentForPhase === 'claude') {
                const slot: SessionSlot | null =
                    currentPhase === 'spec' ? 'claude_spec' :
                    currentPhase === 'code_review' ? 'claude_review' :
                    null; // plan, qa: one-offs, don't persist
                if (slot && lastClaudeSessionId) {
                    splitState.storeSessionId(taskIds, slot, lastClaudeSessionId);
                    splitCli.info(`Claude session stored (${slot}): ${lastClaudeSessionId.slice(0, 8)}...`);
                }
            } else if (agentForPhase === 'codex' && lastCodexSessionId) {
                splitState.storeSessionId(taskIds, 'codex', lastCodexSessionId);
                splitCli.info(`Codex session stored: ${lastCodexSessionId.slice(0, 8)}...`);
            }
            await checkAndRoute(currentPhase, taskIds);
        }

        if (cliArgs.step) {
            const nextPhase = assertSamePhase(taskIds);
            splitCli.info('Step mode: stopping after one phase.');
            splitCli.info(`Next phase: ${nextPhase}`);
            // Exit non-zero if the phase didn't advance (artifact check reset it to pending,
            // or the sub-agent failed without calling task.sh). This makes failures visible
            // to callers checking $? instead of silently exiting 0.
            if (nextPhase === currentPhase) {
                warn(`Phase ${currentPhase} did not advance after running — sub-agent likely failed. Check the artifact and logs.`);
                process.exit(1);
            }
            process.exit(0);
        }

        console.log('');
    }
}

// Only run the CLI when invoked directly (not when imported by tests).
if (process.argv[1] === __filename) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.stack ?? err.message : err);
        process.exit(1);
    });
}
