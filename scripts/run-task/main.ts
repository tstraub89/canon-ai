import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runCodeReviewPhase } from './phases/code-review.js';
import { runImplementPhase } from './phases/implement.js';
import { runPlanPhase } from './phases/plan.js';
import { runQaPhase } from './phases/qa.js';
import { runSpecPhase } from './phases/spec.js';
import { runSpecReviewPhase } from './phases/spec-review.js';
import * as splitTypes from './types.js';
import type { PhaseEntry, PhaseRunResult } from './types.js';
import * as splitCli from './cli.js';
import * as splitEnv from './env.js';
import * as splitState from './state.js';
import * as splitGit from './git.js';
import * as splitWorktree from './worktree.js';
import * as splitPolicy from './policy.js';
import * as splitValidation from './validation.js';
import * as splitClaude from './agents/claude.js';
import * as splitCodex from './agents/codex.js';
import { refreshCanonSnapshotsAtPaths } from './canon-snapshot.js';
import { detachAndExit, removeCanonPid, shouldAutoDetach } from './detach.js';
import { startHeartbeat, stopAllHeartbeats } from './heartbeat.js';
import { registerShutdownHook } from './signals.js';
import { taskPhase } from '../../src/task/index.js';

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
type PorcelainEntry = splitGit.PorcelainEntry;

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
    fullSend: false,
    force: false,
    allowDivergentBase: false,
};
let ghAvailable = false;
// Claude session ID captured after each Claude-run phase for session resumption.
let lastClaudeSessionId: string | null = null;
// Codex session ID captured from startup banner for session resumption
let lastCodexSessionId: string | null = null;
// Non-zero Codex exit (e.g. MCP warnings) doesn't necessarily mean failure.
// checkAndRoute validates by reading status.json instead of trusting exit code alone.
let lastCodexExitStatus = 0;

export function setCliArgsForTest(next: Partial<CliArgs>): void {
    cliArgs = { ...cliArgs, ...next };
}

export function classifyMergeOutcome(opts: { exitOk: boolean; mergeConfirmed: boolean }): 'tolerate' | 'fail' {
    if (opts.exitOk) return 'tolerate';
    if (opts.mergeConfirmed) return 'tolerate';
    return 'fail';
}

// ── Output helpers ─────────────────────────────────────────────────────────

const die = splitCli.die;
const info = splitCli.info;
const warn = splitCli.warn;

// ── Arg parsing ────────────────────────────────────────────────────────────

// ── File system ────────────────────────────────────────────────────────────

const taskDirFor = splitState.taskDirFor;
const taskDirForRepoRoot = splitState.taskDirForRepoRoot;
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
    // manual phase-helper run) would otherwise silently route to the wrong phase.
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
    const codeReview = status.phases.code_review;
    return codeReview?.iterations_current_loop ?? codeReview?.iterations ?? 0;
}

function getTitle(status: StatusJson): string {
    return status.title ?? '(untitled)';
}

// ── Pipeline state builder ─────────────────────────────────────────────────

export function buildPipelineState(taskIds: string[]): PipelineState {
    const statuses = taskIds.map(splitState.readStatus);
    const tier = splitPolicy.detectTier(statuses);
    const tasks: TaskContext[] = taskIds.map((taskId, i) => {
        const status = statuses[i];
        const codeReview = status.phases.code_review;
        const codeReviewCurrentLoop = codeReview?.iterations_current_loop ?? codeReview?.iterations ?? 0;
        const codeReviewTotal = codeReview?.iterations_total ?? codeReview?.iterations ?? 0;
        return {
            taskId,
            title: getTitle(status),
            specReviewVerdict: getVerdict(status, 'spec_review'),
            iterations: codeReviewCurrentLoop,
            iterations_current_loop: codeReviewCurrentLoop,
            iterations_total: codeReviewTotal,
            rerouteCount: status.phases.implement?.reroute_count ?? 0,
            status,
        };
    });
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
    // Gitignored handoff entries (build-generated artifacts) skip the post-commit
    // verification entirely — they cannot appear in `git status` (ignored),
    // `git log` (untracked), or `git diff HEAD` (untracked). The same gitignored
    // exemption is applied upstream in `autoCommitCode` and downstream in
    // `verifyHandoffAgainstDiff`; without it here, the success path still aborts
    // after staging on a perfectly-valid generator+artifact handoff.
    const gitIgnoredHandoffFiles = splitGit.filterGitIgnoredPaths(handoffFiles, cwd);
    const verifiableHandoffFiles = handoffFiles.filter(f => !gitIgnoredHandoffFiles.has(f));
    Object.assign(debug, {
        verifyGitIgnoredHandoffFiles: [...gitIgnoredHandoffFiles],
    });
    if (verifiableHandoffFiles.length === 0) {
        appendAutoCommitDebug(taskIds, { ...debug, result: 'verify-all-gitignored' });
        return;
    }
    const postStatus = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall', '--', ...verifiableHandoffFiles);
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

    for (const filePath of verifiableHandoffFiles) {
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
    const wtDiff = gitSafeAtRaw(cwd, 'diff', 'HEAD', '--name-only', '--', ...verifiableHandoffFiles);
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

/**
 * True for paths the pipeline writes itself and that the agent need not list
 * in the handoff Changes table: task artifacts under `tasks/<id>/` and
 * append-only telemetry files. Managed docs (architecture.md, decisions.md,
 * etc.) are deliberately NOT in this set — those are user content; if they're
 * dirty after implement, the agent should list them in Changes.
 */
function isPipelineOwnedPath(filePath: string, taskIds: readonly string[]): boolean {
    if (taskIds.some(id => filePath === `tasks/${id}` || filePath.startsWith(`tasks/${id}/`))) return true;
    return (splitWorktree.PIPELINE_TELEMETRY_FILES as readonly string[]).includes(filePath);
}

/**
 * True iff the bundle's auto-commit step should be skipped because the
 * operator already manually committed and ran `canon task accept`.
 *
 * Three checks (all must hold):
 *   1. Every task in the bundle has `phases.implement.operator_accepted: true`.
 *   2. Current HEAD matches the recorded `operator_accepted_sha` on every task.
 *      Pins the acceptance to a specific commit so a later commit on the
 *      task branch invalidates the skip.
 *   3. The working tree has no source-file dirt outside pipeline-owned paths.
 *      Without this, an operator could accept, then leave new uncommitted
 *      edits, and the next `canon run` would silently bypass auto-commit
 *      against fresh dirty files.
 *
 * Bundle is all-or-nothing — accepting one task's implement but not the
 * others would leave autocommit half-running on the unaccepted tasks.
 */
function operatorAcceptedImplement(taskIds: readonly string[], cwd: string): boolean {
    const allAccepted = taskIds.every(taskId => {
        const status = splitState.readStatus(taskId);
        return status.phases?.implement?.operator_accepted === true;
    });
    if (!allAccepted) return false;

    const head = splitGit.gitSafeAt(cwd, 'rev-parse', 'HEAD');
    if (!head.ok) return false;
    const currentSha = head.stdout.trim();
    if (!currentSha) return false;

    const shaMatch = taskIds.every(taskId => {
        const status = splitState.readStatus(taskId);
        const recorded = (status.phases?.implement?.operator_accepted_sha ?? '').trim();
        return recorded !== '' && recorded === currentSha;
    });
    if (!shaMatch) return false;

    // Source-tree must be clean (pipeline-owned paths are fine). Skipping
    // auto-commit when the tree has fresh source edits would let them slip
    // straight into code_review.
    const dirty = splitGit.gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    if (!dirty.ok) return false;
    if (dirty.stdout.trim() === '') return true;
    const dirtyPaths = [...splitGit.parsePorcelain(dirty.stdout)];
    const sourceDirty = dirtyPaths.filter(p => !isPipelineOwnedPath(p, taskIds));
    return sourceDirty.length === 0;
}

function autoCommitCode(taskIds: string[], cwd = REPO_ROOT): void {
    const primaryStatus = splitState.readStatus(taskIds[0]);
    const title = getTitle(primaryStatus);

    if (operatorAcceptedImplement(taskIds, cwd)) {
        splitCli.info('Auto-commit skipped — implement phase was operator-accepted (canon task accept) and HEAD still matches the accepted SHA.');
        return;
    }

    const allHandoffFiles = new Set<string>();
    const allMalformed: Array<{ taskId: string; cell: string; reason: string }> = [];
    for (const taskId of taskIds) {
        const { files, malformed } = splitValidation.parseHandoffChangesRows(taskId);
        for (const file of files) allHandoffFiles.add(file);
        for (const entry of malformed) {
            allMalformed.push({ taskId, cell: entry.cell, reason: entry.reason });
        }
    }
    if (allMalformed.length > 0) {
        const lines = allMalformed.map(m => `    [${m.taskId}] '${m.cell}': ${m.reason}`);
        splitCli.die(
            `Auto-commit aborted: handoff.md Changes table has malformed rows.\n` +
            lines.join('\n') +
            `\n  Fix each row to one path per line in the form \`path/to/file.ext\` (or [path/to/file.ext](url)),\n` +
            `  then re-run. Combined paths, wildcards, and unfilled \`<placeholder>\` rows are not accepted.`
        );
    }

    if (allHandoffFiles.size === 0) {
        // Empty handoff Changes table is hostile when the working tree has
        // *source-file* changes: it means the agent made changes but didn't
        // (or couldn't) populate the table, so auto-commit can't proceed AND
        // the downstream code-review step will read working-tree diff instead
        // of a real commit — a silent-false-success class. Distinguish:
        //   - Clean tree (or only pipeline-owned dirty paths) → genuinely no
        //     source changes. Silent return — preserves the legitimate "implement
        //     decided no source change was needed" path.
        //   - Source-file dirty paths present → bug. Hard fail so the operator
        //     sees it.
        //
        // (Pre-2026-05-18 this branch unconditionally warned and returned. The
        // source-dirty class slipped through silently; surfaced via the
        // pr-at-complete pipeline run where Codex's handoff used markdown-link
        // path syntax that the parser missed.)
        const emptyDebug: Record<string, unknown> = { cwd, handoffFiles: [] };
        const dirtyCheck = splitGit.gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
        Object.assign(emptyDebug, {
            dirtyStatusOk: dirtyCheck.ok,
            dirtyStatusRaw: dirtyCheck.stdout,
            dirtyStatusError: dirtyCheck.stderr,
        });
        if (!dirtyCheck.ok) {
            appendAutoCommitDebug(taskIds, { ...emptyDebug, result: 'empty-handoff-dirty-check-failed' });
            splitCli.die(`Auto-commit aborted: handoff.md Changes table empty AND failed to inspect dirty files: ${dirtyCheck.stderr || 'unknown error'}`);
        }
        const allDirty = [...splitGit.parsePorcelain(dirtyCheck.stdout)];
        const sourceDirty = allDirty.filter(f => !isPipelineOwnedPath(f, taskIds));
        Object.assign(emptyDebug, { allDirty, sourceDirty });
        if (sourceDirty.length > 0) {
            appendAutoCommitDebug(taskIds, { ...emptyDebug, result: 'empty-handoff-but-source-dirty' });
            splitCli.die(
                `Auto-commit aborted: handoff.md Changes table is empty but the working tree has\n` +
                `  source-file changes outside the pipeline-owned paths.\n` +
                `  This usually means the agent made changes but did not populate the Changes table\n` +
                `  in handoff.md — or the table format was not recognized by the parser (backtick\n` +
                `  paths and markdown links are both supported as of 2026-05-18).\n` +
                `  Dirty source files (truncated to first 20):\n` +
                sourceDirty.slice(0, 20).map(f => `    ${f}`).join('\n') +
                `\n  Resolve manually: fix handoff.md or commit/discard the dirty files.`,
            );
        }
        appendAutoCommitDebug(taskIds, { ...emptyDebug, result: 'empty-handoff-clean-or-pipeline-only' });
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
    // Gitignored handoff entries — typically build-generated artifacts like
    // `public/sitemap.xml` that Codex legitimately references in the Changes
    // table to describe build output. They will never appear in
    // `git diff base...HEAD` (not tracked), never show in `git status` (ignored),
    // and `ls-files --error-unmatch` rejects them. Exempt them from the
    // existence/tracked checks below — the script that generated them is the
    // real change and should be listed alongside.
    const gitIgnoredHandoffFiles = splitGit.filterGitIgnoredPaths(handoffFiles, cwd);
    Object.assign(debug, {
        dirtyFiles: [...dirtyFiles],
        toStage,
        gitIgnoredHandoffFiles: [...gitIgnoredHandoffFiles],
    });

    // Verify every handoff file is accounted for. If a handoff entry isn't
    // dirty, it must either (a) exist on disk AND be tracked (= already
    // committed / clean), or (b) have already been committed in baseRef..HEAD
    // — covers files deleted or renamed in an earlier commit on this branch
    // (refactor pattern: round 1 deletes ProjectContext.tsx, round 2 review
    // fixes don't re-touch it, but handoff still lists it as a Change).
    //
    // `settledDeletions` collects case (b)-deletion subsets — paths that
    // don't exist on disk but whose deletion is already committed in
    // baseRef..HEAD. They have no working-tree presence to stage, and
    // passing them to `git add -A` would fail with `pathspec did not match`
    // (the bulk-stage step below would die on the whole operation). Filtered
    // out before staging. Surfaced by the GP starter-preview-renderer task
    // hitting this on every iteration after a prototype-file deletion was
    // committed early. See BACKLOG: GP failure mode #6.
    const missing: string[] = [];
    const settledDeletions = new Set<string>();
    const baseRefForLog = splitGit.getBaseBranch(taskIds);
    for (const f of allHandoffFiles) {
        if (dirtyFiles.has(f)) continue;
        if (gitIgnoredHandoffFiles.has(f)) continue;
        const exists = fs.existsSync(path.join(cwd, f));
        if (!exists) {
            // Path is absent from the working tree — accept it if a commit on
            // this branch already touched it (delete, rename, or modify-then-
            // delete-in-later-commit all show up here).
            const committed = splitGit.gitSafeAt(cwd, 'log', '--format=%H', '--max-count=1', `${baseRefForLog}..HEAD`, '--', f);
            if (committed.ok && committed.stdout.trim()) {
                settledDeletions.add(f);
                continue;
            }
            missing.push(`${f} — listed in handoff but missing from working tree (and no commit in ${baseRefForLog}..HEAD touches this path)`);
            continue;
        }
        const tracked = gitSafeAt(cwd, 'ls-files', '--error-unmatch', '--', f).ok;
        if (!tracked) {
            missing.push(`${f} — untracked on disk but git status did not report it (report this as a bug)`);
        }
    }
    Object.assign(debug, { settledDeletions: [...settledDeletions] });
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
    //
    // Exclude `settledDeletions` — paths whose deletion is already committed
    // in baseRef..HEAD. They have no working-tree presence, and `git add -A`
    // would reject them with `pathspec did not match`, failing the whole
    // bulk operation. The deletion is already in the commit history, so
    // there's nothing to stage for them anyway.
    const stageable = handoffFiles.filter(f => !settledDeletions.has(f));
    Object.assign(debug, { stageable });
    if (stageable.length === 0) {
        verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
        appendAutoCommitDebug(taskIds, { ...debug, result: 'all-handoff-files-already-settled' });
        splitCli.info('All handoff files are already settled in history — skipping auto-commit.');
        return;
    }
    const addResult = splitGit.gitSafeAt(cwd, 'add', '-A', '--', ...stageable);
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

function humanReviewAllowedPath(
    taskIds: string[],
    affectedManagedDocs: ReadonlySet<string>,
    filePath: string,
    affectedPrefixes: ReadonlySet<string> = new Set(),
): boolean {
    return taskIds.some(taskId => filePath === `tasks/${taskId}` || filePath.startsWith(`tasks/${taskId}/`)) ||
        (splitWorktree.PIPELINE_TELEMETRY_FILES as readonly string[]).includes(filePath) ||
        affectedManagedDocs.has(filePath) ||
        [...affectedPrefixes].some(prefix => filePath.startsWith(prefix));
}

export function buildHumanReviewStagePaths(
    taskIds: string[],
    affectedManagedDocs: ReadonlySet<string>,
    dirtyEntries: readonly PorcelainEntry[],
    affectedPrefixes: ReadonlySet<string> = new Set(),
): string[] {
    const stagePaths = new Set<string>();
    for (const taskId of taskIds) {
        if (dirtyEntries.some(entry => entry.paths.some(pathName => pathName === `tasks/${taskId}` || pathName.startsWith(`tasks/${taskId}/`)))) {
            stagePaths.add(path.join('tasks', taskId));
        }
    }
    for (const relPath of splitWorktree.PIPELINE_TELEMETRY_FILES) {
        if (dirtyEntries.some(entry => entry.paths.some(pathName => pathName === relPath))) {
            stagePaths.add(relPath);
        }
    }
    for (const relPath of affectedManagedDocs) {
        if (dirtyEntries.some(entry => entry.paths.some(pathName => pathName === relPath))) {
            stagePaths.add(relPath);
        }
    }
    // Directory-form Affected Files entries (e.g. `dist/`) — stage the prefix
    // itself when any dirty entry falls under it. `git add -A -- dist/` stages
    // every dirty path under the prefix in one call.
    for (const prefix of affectedPrefixes) {
        if (dirtyEntries.some(entry => entry.paths.some(pathName => pathName.startsWith(prefix)))) {
            stagePaths.add(prefix);
        }
    }
    return [...stagePaths];
}

/**
 * Returns the path to the repo's pull-request template if one exists at any
 * of GitHub's recognized locations, or `null` if not. Exported for testing.
 */
export function findPullRequestTemplate(repoRoot: string): string | null {
    // GitHub recognizes both lowercase and uppercase basenames at three
    // canonical locations (`.github/`, `docs/`, repo root). On case-insensitive
    // filesystems (macOS, Windows) the variants collide; on case-sensitive
    // ones (Linux servers, CI runners) they are distinct files. Probe both
    // casings at each location so canon doesn't silently miss a template
    // because the repo happens to use the uppercase form.
    const candidates = [
        path.join(repoRoot, '.github', 'pull_request_template.md'),
        path.join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'),
        path.join(repoRoot, 'docs', 'pull_request_template.md'),
        path.join(repoRoot, 'docs', 'PULL_REQUEST_TEMPLATE.md'),
        path.join(repoRoot, 'pull_request_template.md'),
        path.join(repoRoot, 'PULL_REQUEST_TEMPLATE.md'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Returns the `--body` value to pass to `gh pr create`, or `null` if `gh`
 * should fall back to its own defaults (PR template, commit messages).
 *
 * Default behavior (1.3.0+) is `null` — no body, no canon attribution.
 * Adopters who want the prior "Auto-generated by canon-ai" lead can set
 * `CANON_PR_BODY` to a template string. Placeholders:
 *   - `$LABEL` → the task ID(s) (single or comma-joined)
 *   - `$TITLE` → the PR title
 *
 * Exported for unit testing.
 */
export function resolveCanonPrBody(
    taskIds: readonly string[],
    title: string,
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    const template = env.CANON_PR_BODY;
    if (template === undefined || template === '') return null;
    const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
    return template.replaceAll('$LABEL', label).replaceAll('$TITLE', title);
}

type QaPrBodyResolution =
    | { kind: 'body-file'; path: string }
    | { kind: 'fallback'; reason: string };

export function resolveQaPrBody(taskIds: readonly string[], activeCwd: string): QaPrBodyResolution {
    if (taskIds.length !== 1) {
        return { kind: 'fallback', reason: 'bundle: per-task pr-body.md files are not combined in this version' };
    }

    const prBodyPath = path.join(activeCwd, 'tasks', taskIds[0], 'pr-body.md');
    if (!splitValidation.isPrBodyTemplate(prBodyPath)) {
        return { kind: 'body-file', path: prBodyPath };
    }

    return {
        kind: 'fallback',
        reason: fs.existsSync(prBodyPath) ? 'pr-body.md is still the stub template' : 'pr-body.md not found',
    };
}

export function commitQaArtifacts(taskIds: string[], cwd: string): void {
    const affectedManagedDocs = new Set<string>(splitWorktree.PIPELINE_MANAGED_DOCS);

    const dirtyResult = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    if (!dirtyResult.ok) {
        die(`QA-end commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || 'unknown error'}`);
    }

    const dirtyEntries = splitGit.parsePorcelainEntries(dirtyResult.stdout);
    if (dirtyEntries.length === 0) return;

    const unexpected = dirtyEntries.filter(entry =>
        !entry.paths.every(filePath => humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath))
    );
    if (unexpected.length > 0) {
        die(
            `QA-end commit aborted: working tree has dirty files outside the QA-end allowlist.\n` +
            unexpected.map(entry => `  ${entry.raw}`).join('\n') + '\n' +
            `The allowlist is: tasks/<id>/, PIPELINE_TELEMETRY_FILES, and all PIPELINE_MANAGED_DOCS.\n` +
            `Source or test edits must be committed during the implement phase, not left dirty at QA-end.`
        );
    }

    const stagePaths = new Set(buildHumanReviewStagePaths(taskIds, affectedManagedDocs, dirtyEntries));
    if (stagePaths.size === 0) return;

    const stagedBefore = gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    if (!stagedBefore.ok) {
        die(`QA-end commit aborted: could not inspect staged files: ${stagedBefore.stderr || 'unknown error'}`);
    }
    const stagedBeforeUnexpected = stagedBefore.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(filePath => !humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath));
    if (stagedBeforeUnexpected.length > 0) {
        die(
            `QA-end commit aborted: staged files outside the QA-end allowlist:\n` +
            stagedBeforeUnexpected.map(filePath => `    ${filePath}`).join('\n')
        );
    }

    for (const relPath of stagePaths) {
        const addResult = gitSafeAt(cwd, 'add', '-A', '--', relPath);
        if (!addResult.ok) {
            die(`QA-end commit aborted: failed to stage ${relPath}: ${addResult.stderr || 'unknown error'}`);
        }
    }

    const stagedResult = gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    if (!stagedResult.ok) {
        die(`QA-end commit aborted: could not inspect staged files after add: ${stagedResult.stderr || 'unknown error'}`);
    }
    const stagedNames = stagedResult.stdout.split('\n').map(line => line.trim()).filter(Boolean);
    if (stagedNames.length === 0) return;
    const stagedUnexpected = stagedNames.filter(filePath => !humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath));
    if (stagedUnexpected.length > 0) {
        die(
            `QA-end commit aborted: staged files escaped the QA-end allowlist:\n` +
            stagedUnexpected.map(filePath => `    ${filePath}`).join('\n')
        );
    }

    const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
    const commitMessage = `chore: QA artifacts for ${label}`;
    const commitResult = gitSafeAt(cwd, 'commit', '-m', commitMessage);
    if (!commitResult.ok) {
        die(`QA-end commit aborted: ${commitResult.stderr || 'unknown error'}`);
    }

    info(`Committed QA artifacts: ${commitMessage}`);
}

function createDraftPRForTask(taskIds: string[], branchName: string): void {
    if (!ghAvailable) die('--pr requires the gh CLI, but it is not available.');
    const baseBranch = getBaseBranch(taskIds);
    const title = getTitle(splitState.readStatus(taskIds[0]));
    // 1.3.0 dropped the prior `Auto-generated by canon-ai for <label>` default
    // after the GP "ninja mode" report — leaking the tool used was the one
    // remaining canon footprint in adopter PRs. See `resolveCanonPrBody`.
    const args = [
        'pr', 'create',
        '--draft',
        '--base', baseBranch,
        '--head', branchName,
        '--title', title,
    ];
    const body = resolveCanonPrBody(taskIds, title);
    if (body !== null) {
        args.push('--body', body);
    } else {
        const activeCwd = splitWorktree.getActiveCwd(taskIds);
        const qaPrBody = resolveQaPrBody(taskIds, activeCwd);
        if (qaPrBody.kind === 'body-file') {
            args.push('--body-file', qaPrBody.path);
            const prResult = splitGit.runCommand('gh', args);
            if (!prResult.ok) {
                die(`Failed to create draft PR: ${prResult.stderr || 'unknown error'}`);
            }
            info(`Draft PR created: ${prResult.stdout || branchName}`);
            return;
        }
        warn(`PR body fallback (${qaPrBody.reason}) — falling back to repo PR template or --fill`);
        // `gh pr create` only consults `.github/pull_request_template.md`
        // in interactive mode; in non-tty contexts (CI, background pipeline
        // runs) it errors without a `--body` / `--body-file` / `--fill`.
        // Prefer the repo's PR template if it exists so adopters keep their
        // template content; otherwise `--fill` populates from the task-branch
        // commit messages. Either way: no canon attribution leaks.
        //
        // Resolve the template from the active worktree, not REPO_ROOT — in
        // worktree mode the branch may have edited or added the template, and
        // adopters expect the BRANCH-HEAD version to be used for the PR they
        // are about to open (codex P2, round 11 of PR #86). Fall back to
        // REPO_ROOT if no worktree is active.
        const templatePath =
            findPullRequestTemplate(activeCwd) ?? findPullRequestTemplate(REPO_ROOT);
        if (templatePath) {
            args.push('--body-file', templatePath);
        } else {
            args.push('--fill');
        }
    }
    const prResult = splitGit.runCommand('gh', args);
    if (!prResult.ok) {
        die(`Failed to create draft PR: ${prResult.stderr || 'unknown error'}`);
    }
    info(`Draft PR created: ${prResult.stdout || branchName}`);
}

export function formatExistingPRMessage(prNum: number, prUrl: string): string {
    return `Existing draft PR: #${prNum} (${prUrl})`;
}

/**
 * Idempotent `--pr` at `human_review`: if origin already has an open PR for
 * this branch/base, print its URL; otherwise create the draft PR. Both
 * `human_review` paths (clean-tree retry and dirty-tree commit-then-create)
 * funnel through here so a re-run of `canon run <id> --pr` after the PR has
 * been opened can't die on `gh pr create`'s "PR already exists" exit code.
 *
 * The 1.2.0 changelog claimed `--pr` was idempotent at `human_review`, but
 * only the clean-tree retry branch actually had the existing-PR check
 * (issue #72's fix targeted only the `complete` and clean-tree paths). The
 * dirty-tree path went straight to `createDraftPRForTask` and died on the
 * `gh` exit when GP rebuilt task artifacts on an already-PR'd branch (1.3.0
 * failure mode #10).
 */
function sidecarPathFor(taskId: string, taskDir: string = taskDirFor(taskId)): string {
    return path.join(taskDir, '.pr-number');
}

function recordPinnedPRNumber(taskIds: string[], prNum: number): void {
    const alreadyPinned = taskIds.every(taskId => readSidecarPRNumber(taskId) === prNum);
    if (alreadyPinned) return;

    for (const taskId of taskIds) {
        const sidecarPath = sidecarPathFor(taskId);
        fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
        fs.writeFileSync(sidecarPath, String(prNum), 'utf8');
    }
}

function reportOrCreatePR(taskIds: string[], branchName: string): void {
    if (!ghAvailable) die('--pr requires the gh CLI, but it is not available.');
    const baseBranch = splitGit.getBaseBranch(taskIds);
    const openPR = findOpenPRNumber(branchName, baseBranch);
    let prNum: number;
    if (openPR !== null) {
        const prUrl = lookupPRUrl(openPR);
        info(formatExistingPRMessage(openPR, prUrl));
        prNum = openPR;
    } else {
        createDraftPRForTask(taskIds, branchName);
        const createdPR = findOpenPRNumber(branchName, baseBranch);
        if (createdPR === null) {
            die(
                `Draft PR was created for ${branchName}, but canon could not retrieve its PR number. ` +
                `Re-run --pr so canon can pin pr.number before --ship.`,
            );
            return;
        } else {
            prNum = createdPR;
        }
    }

    recordPinnedPRNumber(taskIds, prNum);
}

function parseOriginRepoSlug(remoteUrl: string): string | null {
    const match = remoteUrl.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
    return match?.[1] ?? null;
}

function lookupPRUrl(prNum: number): string {
    if (ghAvailable) {
        const result = splitGit.runCommand('gh', ['pr', 'view', String(prNum), '--json', 'url', '--jq', '.url']);
        if (result.ok && result.stdout.trim()) return result.stdout.trim();
    }

    const remoteResult = splitGit.runCommand('git', ['remote', 'get-url', 'origin']);
    if (remoteResult.ok) {
        const repoSlug = parseOriginRepoSlug(remoteResult.stdout);
        if (repoSlug) return `https://github.com/${repoSlug}/pull/${prNum}`;
    }

    return `(PR #${prNum})`;
}

export type CompleteState =
    | { kind: 'open_pr'; branch: string; prNum: number; prUrl: string }
    | { kind: 'pushed_no_pr'; branch: string; baseBranch: string }
    | { kind: 'unpushed'; branch: string; baseBranch: string };

export function formatCompleteStateBanner(taskIds: string[], state: CompleteState): string {
    const body = (() => {
        switch (state.kind) {
            case 'open_pr':
                return `  Open PR: #${state.prNum} (${state.prUrl})\n  Next:    \`canon run ${taskIds.join(' ')} --ship\` to merge + archive.`;
            case 'pushed_no_pr':
                return `  Branch ${state.branch} is on origin but no open PR.\n  Next:    \`canon run ${taskIds.join(' ')} --pr\` to (re)open the draft PR, or\n           \`canon run ${taskIds.join(' ')} --ship\` if the work is already merged to ${state.baseBranch}.`;
            case 'unpushed':
                return `  Local branch ${state.branch} is not on origin.\n  Next:    \`canon run ${taskIds.join(' ')} --pr\` to push and open a draft PR.\n           (For a no-PR flow: merge to ${state.baseBranch} manually, push, then run --ship.)`;
        }
    })();
    return [
        '',
        '════════════════════════════════════════════════════════',
        '  TASK COMPLETE — already past human_review.',
        '',
        body,
        '════════════════════════════════════════════════════════',
        '',
    ].join('\n');
}

function inspectCompleteState(branch: string, taskIds: string[]): CompleteState {
    const baseBranch = splitGit.getBaseBranch(taskIds);
    const remoteExists = gitSafeAt(REPO_ROOT, 'rev-parse', '--verify', `origin/${branch}`).ok;
    if (!remoteExists) {
        return { kind: 'unpushed', branch, baseBranch };
    }
    const prNum = ghAvailable ? findOpenPRNumber(branch, baseBranch) : null;
    if (prNum === null) {
        return { kind: 'pushed_no_pr', branch, baseBranch };
    }
    const prUrl = lookupPRUrl(prNum);
    return { kind: 'open_pr', branch, prNum, prUrl };
}

function printCompleteStateBanner(taskIds: string[]): void {
    const branches = [...new Set(taskIds.map(id => resolveTaskBranchName(id)))];
    for (const branch of branches) {
        const tasksOnBranch = taskIds.filter(id => resolveTaskBranchName(id) === branch);
        const state = inspectCompleteState(branch, tasksOnBranch);
        console.log(formatCompleteStateBanner(tasksOnBranch, state));
    }
}

export function enableFullSend(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        status.full_send = true;
        status.human_spec_gate = false;
        splitState.writeStatus(taskId, status);
    }
}

function shouldRunFullSendTail(taskIds: string[]): boolean {
    return taskIds.every(taskId => {
        const status = splitState.readStatus(taskId);
        return status.full_send === true &&
            status.phases.qa?.status === 'done' &&
            status.phases.human_review?.status === 'pending';
    });
}

export function commitHumanReviewFiles(taskIds: string[], cwd: string, createPR: boolean): void {
    if (createPR) {
        ghAvailable = splitGit.isCommandAvailable('gh');
    }

    const baseBranch = splitGit.getBaseBranch(taskIds);
    const baseDivergenceResult = splitValidation.verifyBaseDivergence(baseBranch, cwd);
    if (!baseDivergenceResult.ok) {
        die(`--pr aborted: git error checking base divergence: ${baseDivergenceResult.stderr || 'unknown error'}`);
    } else if (!baseDivergenceResult.fetchFailed && baseDivergenceResult.commits.length > 0) {
        if (!cliArgs.allowDivergentBase) {
            die(splitValidation.verifyBaseDivergenceFromData(baseDivergenceResult.commits));
        }
        warn(
            `--allow-divergent-base override: bypassing base-divergence gate. Divergent commits:\n` +
            baseDivergenceResult.commits.map(commit => `  ${commit.sha.slice(0, 7)}  ${commit.subject}`).join('\n'),
        );
    }

    // Docs-refs gate: catch broken refs in QA/review artifacts before they hit CI.
    // printFindings() in docs-refs-check.mjs writes to stderr (console.error);
    // stdout only carries the "All refs OK" success message.
    const docsRefsScript = path.join(REPO_ROOT, 'scripts', 'docs-refs-check.mjs');
    if (fs.existsSync(docsRefsScript)) {
        const docsRefsResult = spawnSync('node', [docsRefsScript], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
        });
        if (docsRefsResult.status !== 0) {
            const docsRefsOutput = (docsRefsResult.stderr ?? '').trim();
            if (cliArgs.force) {
                splitCli.warn(`--force: docs-refs-check found broken refs (bypassed):\n${docsRefsOutput}`);
            } else {
                splitCli.die(
                    `--pr aborted: docs-refs-check found broken refs in task artifacts that would be committed.\n` +
                    `${docsRefsOutput}\n` +
                    `Fix the references and re-run --pr/--push. Use --force to bypass.`,
                );
            }
        }
    }

    const baseDriftResult = splitValidation.verifyBaseDrift(taskIds, baseBranch, cwd);
    if (baseDriftResult.fetchFailed) {
        // warn already emitted by verifyBaseDrift; offline runs keep the prior best-effort behavior.
    } else if (baseDriftResult.diffFailed) {
        die(
            `--pr aborted: could not compute base-drift diff against origin/${baseBranch}.\n` +
            `Git error: ${baseDriftResult.diffError ?? 'unknown error'}\n` +
            `This failure cannot be bypassed with --force.`
        );
    } else if (baseDriftResult.drift.length > 0) {
        if (!cliArgs.force) {
            die(
                `--pr aborted: base-drift detected. Files in the tree diff between origin/${baseBranch}\n` +
                `and HEAD that are not in the spec's Affected Files (and not task-dir/telemetry):\n` +
                `${baseDriftResult.drift.map(filePath => `  ${filePath}`).join('\n')}\n` +
                `The allowlist is: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, files listed in\n` +
                `your spec's '### Affected Files' table (directory-form entries like 'dist/' match\n` +
                `subpaths), and PIPELINE_MANAGED_DOCS (auto-allowlisted once qa.status = done).\n` +
                `If this is a legitimate task change, add the path to spec.md '### Affected Files'\n` +
                `and rerun. For a rename, list BOTH the old and new paths. If the drift is\n` +
                `unexpected (likely cross-pipeline contamination from a sibling worktree's\n` +
                `managed-doc sync, OR a third-party commit landed on origin/${baseBranch} while\n` +
                `this pipeline was running), recover with one of:\n` +
                `  - rebase onto current origin/${baseBranch} to absorb the base advance:\n` +
                `      git fetch origin ${baseBranch} && git rebase origin/${baseBranch}\n` +
                `  - reset a specific file to base's content if a stray task-branch commit\n` +
                `    introduced it:\n` +
                `      git checkout origin/${baseBranch} -- <path> && git commit -m 'revert drift on <path>'\n` +
                `  - revert the offending task-branch commit entirely:\n` +
                `      git revert <sha>\n` +
                `Bypass with --force if you've verified the drift is intentional.`
            );
        }
        warn(
            `--force override: base-drift detected; proceeding at user request. Drifted files:\n` +
            baseDriftResult.drift.map(filePath => `  ${filePath}`).join('\n')
        );
    }

    const affectedManagedDocs = new Set<string>();
    const affectedPrefixes = new Set<string>();
    for (const taskId of taskIds) {
        const parsed = splitValidation.parseAffectedFilesFromSpec(taskId);
        for (const filePath of parsed.files) {
            if (filePath.endsWith('/')) {
                // Directory-form entries like `dist/` cover any subpath.
                // Kept with the trailing slash so prefix matching is
                // boundary-correct (does not accept `dist-other/foo`).
                affectedPrefixes.add(filePath);
            } else if ((splitWorktree.PIPELINE_MANAGED_DOCS as readonly string[]).includes(filePath)) {
                affectedManagedDocs.add(filePath);
            }
        }
        for (const malformed of parsed.malformed) {
            warn(`${taskId} spec.md Affected Files row malformed: ${malformed.reason}`);
        }

        // QA's "Docs Freshness" sweep can edit any PIPELINE_MANAGED_DOCS entry,
        // not just ones the spec author predicted. Once qa is done for a task,
        // union the full managed-docs set so the human-review gate accepts the
        // promotion without forcing a manual spec backfill before --pr.
        // Mirrors the same union in verifyBaseDrift (validation.ts).
        try {
            if (splitState.readStatus(taskId).phases.qa?.status === 'done') {
                for (const doc of splitWorktree.PIPELINE_MANAGED_DOCS) {
                    affectedManagedDocs.add(doc);
                }
            }
        } catch {
            // Missing/malformed status.json: leave the spec-only allowlist as-is.
            // Strictly safer than auto-widening when state is unreadable.
        }
    }

    const dirtyResult = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    if (!dirtyResult.ok) {
        die(`Human review commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || 'unknown error'}`);
    }

    const dirtyEntries = splitGit.parsePorcelainEntries(dirtyResult.stdout);

    // Idempotent --pr retry: tree is clean AND --pr is set AND the branch was
    // already pushed AND no open PR exists. This is the post-state of a prior
    // --pr run where commit+push succeeded but `gh pr create` failed
    // transiently (network, rate limit). Skip the commit step and re-attempt
    // PR creation only. Caught via canon-ai PR #39 CodeRabbit finding #1.
    if (dirtyEntries.length === 0 && (createPR || cliArgs.push)) {
        const branchResult = gitSafeAt(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
        const branchName = branchResult.ok ? branchResult.stdout.trim() : '';
        if (branchName) {
            // Always push before reporting / creating the PR. `git push` is
            // idempotent — no-op when origin already has the local tip,
            // pushes the difference otherwise. We do NOT short-circuit on
            // `git rev-parse origin/<branch>` because the local
            // remote-tracking ref can be stale (a prior push failed
            // mid-flight, or refs were never fetched). Letting git push
            // run is the safe default.
            //
            // Important: this push runs even when an open PR is found
            // below. Codex P1 on release PR #82: skipping the push on the
            // "PR exists" branch leaves the PR stale when new local
            // commits landed after the PR was opened (clean tree + open
            // PR is NOT a guarantee that origin matches HEAD).
            // (Spec ACs 1+3, complete-state banner contract; PR #75 iter 2.)
            info(`Clean tree. Pushing ${branchName}...`);
            const pushResult = gitSafeAt(cwd, 'push', '-u', 'origin', branchName);
            if (!pushResult.ok) {
                die(`Human review push failed: ${pushResult.stderr || 'unknown error'}`);
            }

            if (createPR) reportOrCreatePR(taskIds, branchName);
            return;
        }
    }

    if (dirtyEntries.length === 0) {
        die('Human review commit aborted: no dirty task artifacts, telemetry, or managed docs to commit.');
    }

    const unexpected = dirtyEntries.filter(entry => !entry.paths.every(pathName => humanReviewAllowedPath(taskIds, affectedManagedDocs, pathName, affectedPrefixes)));
    if (unexpected.length > 0) {
        die(
            `Human review commit aborted: working tree has dirty files outside the human_review allowlist.\n` +
            unexpected.map(entry => `  ${entry.raw}`).join('\n') + `\n` +
            `The allowlist is: tasks/<id>/, PIPELINE_TELEMETRY_FILES, PIPELINE_MANAGED_DOCS entries listed\n` +
            `in your spec's '### Affected Files' table (directory-form entries like 'dist/' match subpaths),\n` +
            `and all PIPELINE_MANAGED_DOCS once qa.status = done (QA's Docs Freshness auto-allowlist).\n` +
            `If this is a managed doc this task legitimately edits before QA, add it to spec.md '### Affected Files' and rerun.\n` +
            `If this is a source or test file, it should have been committed during the implement phase — ` +
            `investigate why it is dirty now (unexpected late edits or base-drift/branch contamination are possible causes) ` +
            `and revert with: git checkout HEAD -- <path>`
        );
    }

    const stagePaths = new Set(buildHumanReviewStagePaths(taskIds, affectedManagedDocs, dirtyEntries, affectedPrefixes));

    for (const relPath of stagePaths) {
        if (affectedManagedDocs.has(relPath)) {
            warn(
                `WARNING: ${relPath} has uncommitted edits and is in PIPELINE_MANAGED_DOCS — ` +
                `run \`git diff HEAD -- ${relPath}\` to verify these are this task's work before --ship.`
            );
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
        .filter(filePath => !humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath, affectedPrefixes));
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
    const stagedUnexpected = stagedNames.filter(filePath => !humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath, affectedPrefixes));
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
    const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
    const commitMessage = `chore: add task artifacts for ${label}`;
    const commitResult = gitSafeAt(cwd, 'commit', '-m', commitMessage);
    if (!commitResult.ok) {
        die(`Human review commit aborted: ${commitResult.stderr || 'unknown error'}`);
    }

    info(`Committed human_review artifacts on ${branchName}: ${commitMessage}`);
    info(`Pushing ${branchName}...`);
    const pushResult = gitSafeAt(cwd, 'push', '-u', 'origin', branchName);
    if (!pushResult.ok) {
        die(`Human review push failed: ${pushResult.stderr || 'unknown error'}`);
    }

    if (createPR) reportOrCreatePR(taskIds, branchName);
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
 * Fast-forward local <baseBranch> when it is strictly behind origin/<baseBranch>.
 * Only called when no PR was merged in this process (i.e., user merged manually
 * or a prior --ship run merged before aborting).
 */
function assertLocalBaseInSyncWithOrigin(baseBranch: string): void {
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

    const aheadResult = gitSafe('rev-list', '--count', `origin/${baseBranch}..HEAD`);
    const ahead = aheadResult.ok ? Number.parseInt(aheadResult.stdout, 10) : NaN;
    if (!Number.isNaN(ahead) && ahead > 0) {
        die(
            `Local ${baseBranch} has diverged from origin/${baseBranch} (${behind} behind, ${ahead} ahead). ` +
            `Resolve with \`git rebase origin/${baseBranch}\` and re-run --ship.`,
        );
    }

    info(`Local ${baseBranch} is ${behind} commit${behind === 1 ? '' : 's'} behind origin/${baseBranch}; fast-forwarding...`);
    git('pull', '--ff-only', 'origin', baseBranch);
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
// Resolve the actual branch name for a task. `ensureBranch` records the branch
// in `status.branch` at task creation. Falls back to the conventional
// `task/<id>` form only if `status.branch` is absent (older tasks created
// before the field was tracked). Hardcoding `task/<id>` here previously caused
// `--ship` to verify the wrong ref when the operator was on a non-default
// branch at task creation time (canon-ai issue tracker, PR #39 CodeRabbit
// finding #2).
function resolveTaskBranchName(taskId: string): string {
    try {
        const recorded = splitState.readStatus(taskId).branch;
        if (recorded && recorded.trim()) return recorded.trim();
    } catch {
        // Status missing/unreadable — fall through to fallback.
    }
    return `task/${taskId}`;
}

function assertTaskBranchPushed(taskId: string, branchName?: string): void {
    const resolvedBranchName = branchName ?? resolveTaskBranchName(taskId);
    if (!splitGit.branchExistsLocally(resolvedBranchName)) return;

    // Refresh remote-tracking ref before comparing.
    splitGit.gitSafe('fetch', 'origin', resolvedBranchName);

    const remoteRefResult = splitGit.gitSafe('rev-parse', '--verify', `origin/${resolvedBranchName}`);
    if (!remoteRefResult.ok) {
        warn(
            `origin/${resolvedBranchName} not found (${remoteRefResult.stderr.trim() || 'unknown'}). ` +
            `Continuing — assuming the remote branch was deleted by an earlier merge. ` +
            `If you have unpushed work on local ${resolvedBranchName} you wanted to ship, abort with Ctrl+C and push it now.`,
        );
        return;
    }

    // Count commits in local branch that are NOT on origin. Strict SHA equality would
    // false-positive when origin is merely AHEAD of local (e.g., the PR branch was
    // advanced from another checkout, or remote was force-pushed forward) — that's
    // safe to delete; the work isn't unique to local. Only block when local has
    // commits the remote doesn't.
    const aheadResult = splitGit.gitSafe('rev-list', '--count', `origin/${resolvedBranchName}..${resolvedBranchName}`);
    if (!aheadResult.ok) {
        warn(`Could not compute ${resolvedBranchName} vs origin/${resolvedBranchName} divergence: ${aheadResult.stderr}. Skipping push-verify.`);
        return;
    }
    const ahead = Number.parseInt(aheadResult.stdout.trim(), 10);
    if (Number.isNaN(ahead) || ahead === 0) return;

    const localSha = splitGit.gitSafe('rev-parse', resolvedBranchName).stdout.trim();
    const remoteSha = splitGit.gitSafe('rev-parse', `origin/${resolvedBranchName}`).stdout.trim();
    splitCli.die(
        `--ship aborted: local ${resolvedBranchName} has ${ahead} commit${ahead === 1 ? '' : 's'} not on origin.\n` +
        `  Local HEAD: ${localSha.slice(0, 7)} | origin/${resolvedBranchName}: ${remoteSha.slice(0, 7)}\n` +
        `  Pushing first prevents work loss — --ship destroys the local branch after merging the PR,\n` +
        `  so unpushed commits would be unreachable. Push:\n` +
        `    git push origin ${resolvedBranchName}\n` +
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
function assertOriginTaskBranchAbsent(branchName: string, baseBranch: string): void {
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

    // Recovery path: if a PR for this branch was already merged INTO THE
    // CURRENT BASE (e.g., the operator merged via the GitHub UI without
    // --delete-branch), the remote branch is a stale leftover, not unmerged
    // work. Auto-delete it instead of forcing the operator into a manual
    // `git push origin --delete` step. Detected by `gh pr list --state
    // merged --head <branch> --base <baseBranch>` — gh is authoritative
    // on origin's PR state.
    //
    // Safety: only auto-delete if the remote tip matches the merged PR's head
    // SHA. If new commits were pushed to the branch after the PR merged, the
    // remote tip will differ — refuse to avoid destroying that work. The
    // `--base` filter is also a safety property: a PR merged into a DIFFERENT
    // base branch doesn't prove the current base has the work, so we must not
    // delete the remote branch on that signal. (Codex P1 on PR #77.)
    const mergedPrNum = ghAvailable ? findMergedPRNumber(branchName, baseBranch) : null;
    if (mergedPrNum !== null) {
        const prHead = getMergedPRHeadSha(mergedPrNum);
        if (prHead === null) {
            // Couldn't verify the PR's head — fall through to the die path.
            // Safer than auto-deleting blind.
        } else if (prHead !== remoteSha) {
            splitCli.die(
                `--ship aborted: origin/${branchName} is at ${remoteSha.slice(0, 7)} but the merged ` +
                `PR #${mergedPrNum} merged head ${prHead.slice(0, 7)}. New commits were pushed to the ` +
                `branch after the PR merged. Resolve manually — those commits are not in the merged work.`,
            );
        } else {
            info(
                `origin/${branchName} still exists at ${remoteSha.slice(0, 7)} (matches merged PR #${mergedPrNum} head). ` +
                `Deleting the remote branch — the merged content is in the base.`,
            );
            const del = splitGit.gitSafe('push', 'origin', `--delete`, branchName);
            if (!del.ok) {
                if (del.stderr.includes('remote ref does not exist')) {
                    splitCli.info(
                        `Remote branch ${branchName} is already absent ("remote ref does not exist"). ` +
                        `No-op delete; continuing cleanup.`,
                    );
                } else {
                    splitCli.die(
                        `--ship aborted: detected merged PR #${mergedPrNum} for ${branchName}, but ` +
                        `\`git push origin --delete ${branchName}\` failed: ${del.stderr.trim() || 'unknown error'}. ` +
                        `Delete the remote branch manually and re-run --ship.`,
                    );
                }
            }
            return;
        }
    }

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
 * Returns the number of a recently-merged PR whose head EXACTLY matches
 * `branch` AND whose base matches `baseBranch`, or null if none.
 *
 * `gh pr list --head <branch>` is documented to filter by branch-name prefix
 * (gh CLI issue #10816), so a query for `task/foo` can return PRs for
 * `task/foo-fix`. Auto-deleting based on that match would be a data-loss
 * bug. We fetch `headRefName` in the JSON and enforce exact equality in
 * code before returning the match. (Codex P1 on PR #77 iter 2; first P1
 * was about `--base` specificity.)
 *
 * Base-specific so we never read "merged into a different branch" as proof
 * that the current shipping base received the work.
 */
function findMergedPRNumber(branch: string, baseBranch: string): number | null {
    if (!ghAvailable) return null;
    return findPRNumberExact(branch, baseBranch, 'merged');
}

/**
 * Returns the head commit SHA of a PR, or null if the lookup fails.
 * Works for open and merged PRs; `assertOriginTaskBranchAbsent` also uses it
 * to verify the current remote tip matches what was actually merged before
 * auto-deleting the branch.
 */
function getMergedPRHeadSha(prNum: number): string | null {
    if (!ghAvailable) return null;
    const result = splitGit.runCommand('gh', ['pr', 'view', String(prNum), '--json', 'headRefOid', '--jq', '.headRefOid']);
    if (!result.ok) return null;
    const sha = result.stdout.trim();
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return null;
    return sha;
}

function isPRMerged(prNum: number): boolean {
    if (!ghAvailable) return false;
    const result = splitGit.runCommand('gh', ['pr', 'view', String(prNum), '--json', 'state', '--jq', '.state']);
    return result.ok && result.stdout.trim() === 'MERGED';
}

function getPRBaseRefName(prNum: number): string | null {
    if (!ghAvailable) return null;
    const result = splitGit.runCommand('gh', ['pr', 'view', String(prNum), '--json', 'baseRefName', '--jq', '.baseRefName']);
    if (!result.ok) return null;
    const ref = result.stdout.trim();
    return ref || null;
}

function readSidecarPRNumber(taskId: string, taskDir: string = taskDirFor(taskId)): number | null {
    const sidecarPath = sidecarPathFor(taskId, taskDir);
    let raw: string;
    try {
        raw = fs.readFileSync(sidecarPath, 'utf8').trim();
    } catch {
        return null;
    }
    if (!/^\d+$/.test(raw)) return null;
    const num = Number.parseInt(raw, 10);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
    return num;
}

type MergeProofResult = { proven: true } | { proven: false; reason: string };

function resolveProofPRNumberForPrefetch(taskId: string, branchName: string, baseBranch: string, taskCwd: string): number | null {
    if (!ghAvailable) return null;
    const pinnedPrNum = readSidecarPRNumber(taskId, path.join(taskCwd, 'tasks', taskId));
    if (pinnedPrNum !== null) return pinnedPrNum;
    return findOpenPRNumber(branchName, baseBranch) ?? findMergedPRNumber(branchName, baseBranch);
}

function commitObjectExists(cwd: string, sha: string): boolean {
    return splitGit.gitSafeAt(cwd, 'cat-file', '-e', `${sha}^{commit}`).ok;
}

function materializePRHead(cwd: string, prNum: number, headSha: string): boolean {
    if (commitObjectExists(cwd, headSha)) return true;

    splitGit.gitSafeAt(cwd, 'fetch', 'origin', `refs/pull/${prNum}/head`);
    if (commitObjectExists(cwd, headSha)) return true;

    splitGit.gitSafeAt(cwd, 'fetch', 'origin', headSha);
    return commitObjectExists(cwd, headSha);
}

function establishPRHeadAncestryProof(cwd: string, prNum: number, prHead: string | null, localTip: string): MergeProofResult {
    if (prHead === null) {
        return {
            proven: false,
            reason: `headRefOid for PR #${prNum} could not be materialized locally; merge proof is unproven.`,
        };
    }

    const ancestorCheck = splitGit.gitSafeAt(cwd, 'merge-base', '--is-ancestor', localTip, prHead);
    if (!ancestorCheck.ok) {
        return {
            proven: false,
            reason:
                `Local tip ${localTip.slice(0, 7)} is not an ancestor of PR #${prNum} head ${prHead.slice(0, 7)}. ` +
                `Possible branch reuse or local-only commits not included in the merged PR.`,
        };
    }

    return { proven: true };
}

function establishMergeProof(
    taskId: string,
    branchName: string,
    localTip: string,
    baseBranch: string,
    cwd: string,
    prefetchedHeads: ReadonlyMap<number, string | null>,
): MergeProofResult {
    const pinnedPrNum = readSidecarPRNumber(taskId, path.join(cwd, 'tasks', taskId));

    if (ghAvailable && pinnedPrNum !== null) {
        if (!isPRMerged(pinnedPrNum)) {
            return { proven: false, reason: `Pinned PR #${pinnedPrNum} is not in MERGED state.` };
        }
        const prBase = getPRBaseRefName(pinnedPrNum);
        if (prBase !== baseBranch) {
            return {
                proven: false,
                reason: `Pinned PR #${pinnedPrNum} was merged into '${prBase ?? 'unknown'}', not '${baseBranch}'.`,
            };
        }
        return establishPRHeadAncestryProof(cwd, pinnedPrNum, prefetchedHeads.get(pinnedPrNum) ?? null, localTip);
    }

    if (ghAvailable) {
        const mergedPrNum = findMergedPRNumber(branchName, baseBranch);
        if (mergedPrNum !== null) {
            return establishPRHeadAncestryProof(cwd, mergedPrNum, prefetchedHeads.get(mergedPrNum) ?? null, localTip);
        }
        return {
            proven: false,
            reason:
                `No merged PR found for ${branchName} targeting ${baseBranch}. Verify the PR was merged, then re-run --ship.`,
        };
    }

    return {
        proven: false,
        reason:
            `gh CLI is not available; cannot verify merge proof. Re-run --ship when gh is reachable, ` +
            `or delete the local branch manually and re-run to take the no-branch archive path.`,
    };
}

/**
 * Verify there is no open PR for the task's branch. Called after mergeOpenPRsAndPull
 * returned false (no PR was merged this run) — a defensive cross-check against gh
 * transient issues that might have caused findOpenPRNumber to return null spuriously.
 */
function assertNoOpenPRForTask(branchName: string, baseBranch: string): void {
    const prNum = findOpenPRNumber(branchName, baseBranch);
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
 * Find the number of an open PR whose head branch EXACTLY matches `branch`
 * AND whose base branch matches `baseBranch`. Returns null if gh CLI is
 * unavailable, no PR found, or lookup fails.
 *
 * Uses `findPRNumberExact` (not a raw `--head` jq filter) because `gh pr
 * list --head <branch>` is documented to filter by prefix (gh CLI issue
 * #10816). A prefix-match here would print the wrong PR's URL on
 * idempotent `--pr` retry, or false-block `--ship` via
 * `assertNoOpenPRForTask`. (Codex P1 on PR #77 iter 2.)
 *
 * `baseBranch` is required (not nullable like findPRNumberExact's param):
 * every caller in this file operates on a specific task with a known
 * base, and skipping the base filter risks squash-merging a wrong-base
 * PR into the wrong base (e.g., an operator-opened PR targeting `main`
 * when canon expects `dev`). The symmetric base-filter in
 * findMergedPRNumber was added for exactly this reason on PR #77;
 * findOpenPRNumber + mergeOpenPRsAndPull missed it. (Codex P2 on
 * release PR #82 integration audit.)
 */
function findOpenPRNumber(branch: string, baseBranch: string): number | null {
    if (!ghAvailable) return null;
    return findPRNumberExact(branch, baseBranch, 'open');
}

/**
 * Shared exact-head-ref PR lookup. `gh pr list --head <branch>` filters by
 * prefix, so we fetch the full result set and enforce `headRefName === branch`
 * in code. `baseBranch` is optional (some callers want any base match).
 * `state` is `open` | `merged` | `closed`.
 *
 * `--limit 1000` is effectively unbounded for any sane repo: gh internally
 * pages the underlying GitHub API to fulfill the limit. A previous version
 * used `--limit 20`, which silently dropped exact matches when a repo had
 * many similarly-prefixed PRs (e.g., a long-running release branch with
 * dozens of open task/* PRs). At 1000+ similarly-prefixed PRs the prefix
 * match is the bigger problem. (Codex P2 on release PR #82.)
 */
function findPRNumberExact(branch: string, baseBranch: string | null, state: 'open' | 'merged' | 'closed'): number | null {
    if (!ghAvailable) return null;
    const args = ['pr', 'list', '--head', branch, '--state', state, '--limit', '1000', '--json', 'number,headRefName'];
    if (baseBranch !== null) args.push('--base', baseBranch);
    const result = splitGit.runCommand('gh', args);
    if (!result.ok || !result.stdout.trim()) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout); } catch { return null; }
    if (!Array.isArray(parsed)) return null;
    for (const entry of parsed) {
        if (typeof entry !== 'object' || entry === null) continue;
        const headRefName = (entry as { headRefName?: unknown }).headRefName;
        const number = (entry as { number?: unknown }).number;
        if (headRefName === branch && typeof number === 'number') return number;
    }
    return null;
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
function mergeOpenPRsAndPull(
    taskIds: string[],
    baseBranch: string,
    branchByTaskId: ReadonlyMap<string, string>,
): boolean {
    // Deduplicate branch names (bundles share one branch)
    const branches = [...new Set(taskIds.map(id => {
        const branchName = branchByTaskId.get(id);
        if (!branchName) splitCli.die(`Missing pre-switch branch snapshot for task '${id}'.`);
        return branchName;
    }))];
    let anyMerged = false;
    for (const branch of branches) {
        const prNum = findOpenPRNumber(branch, baseBranch);
        if (!prNum) continue;
        splitCli.info(`Merging PR #${prNum} (${branch} → ${baseBranch}) via squash...`);
        // --delete-branch removes the remote branch; local cleanup happens post-teardown.
        const result = splitGit.runCommand('gh', ['pr', 'merge', String(prNum), '--squash', '--delete-branch']);
        const outcome = classifyMergeOutcome({
            exitOk: result.ok,
            mergeConfirmed: result.ok ? true : isPRMerged(prNum),
        });
        if (outcome === 'fail') {
            splitCli.die(`Failed to merge PR #${prNum}: ${result.stderr}`);
        }
        if (!result.ok) {
            splitCli.warn(`PR #${prNum} merged; branch-delete step failed and was tolerated: ${result.stderr.trim() || 'unknown error'}`);
            // gh's --delete-branch on a non-zero exit does not guarantee both remote
            // and local deletes succeeded. Setting anyMerged = true below skips the
            // downstream !merged safety net, so verify the remote branch is absent
            // here for every task mapped to this branch.
            for (const taskId of taskIds) {
                const branchName = branchByTaskId.get(taskId);
                if (branchName === branch) {
                    assertOriginTaskBranchAbsent(branchName, baseBranch);
                }
            }
        } else {
            splitCli.info(`PR #${prNum} merged.`);
        }
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

export function commitArchiveChanges(
    taskIds: string[],
    baseBranch: string,
    stagedPaths: readonly string[],
): { committed: boolean; stderr?: string } {
    for (const p of stagedPaths) gitSafe('add', '-A', '--', p);
    const staged = gitSafe('diff', '--cached', '--name-only');
    if (!staged.stdout.trim()) return { committed: false };

    const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
    const commitResult = gitSafe('commit', '-m', `chore: archive ${label}`);
    if (!commitResult.ok) {
        return { committed: false, stderr: commitResult.stderr || 'unknown error' };
    }

    info(`Pushing ${baseBranch}...`);
    git('push', 'origin', baseBranch);
    return { committed: true };
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
    const resolveShipCwd = (taskId: string): string => {
        const tasksDirOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
        if (tasksDirOverride) {
            // The override points at a tasks/ root. Ship reads join back through
            // its parent cwd so downstream path joins continue to land under the
            // override tree instead of the supervising checkout.
            return path.dirname(tasksDirOverride);
        }
        if (splitState.isOrphanedWorktreeState(taskId)) return REPO_ROOT;
        return path.dirname(path.dirname(taskDirFor(taskId)));
    };

    const taskStatuses = new Map<string, StatusJson>();
    const readShipStatus = (taskId: string): StatusJson => {
        const taskCwd = resolveShipCwd(taskId);
        const candidates = [
            path.join(taskCwd, 'tasks', taskId, 'status.json'),
            path.join(taskCwd, taskId, 'status.json'),
            path.join(taskDirForRepoRoot(taskId), 'status.json'),
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return splitState.readStatusFromPath(candidate, taskId);
        }
        const snapshot = taskStatuses.get(taskId);
        if (snapshot) return snapshot;
        return splitState.readStatusFromPath(candidates[0], taskId);
    };
    const readShipBranchName = (taskId: string): string => {
        const branch = readShipStatus(taskId).branch;
        return branch && branch.trim() ? branch.trim() : `task/${taskId}`;
    };
    const baseBranches = new Set<string>();
    for (const taskId of taskIds) {
        const status = readShipStatus(taskId);
        const declared = status.base_branch?.trim() ?? '';
        baseBranches.add(declared || splitGit.getDefaultBaseBranch());
    }
    if (baseBranches.size > 1) {
        splitCli.die(
            `Bundle base_branch mismatch: tasks have different base branches (${[...baseBranches].join(', ')}). ` +
            `All tasks in a bundle must target the same base. Edit status.json to align before invoking.`,
        );
    }
    const baseBranch = [...baseBranches][0];

    // Phase guard first — fail fast before any network calls.
    for (const taskId of taskIds) {
        const currentPhase = getCurrentPhase(readShipStatus(taskId));
        if (currentPhase !== 'human_review' && currentPhase !== 'complete') {
            splitCli.die(`--ship requires tasks at human_review or complete. '${taskId}' is at: ${currentPhase}`);
        }
    }
    // 1b human_review invariant: --ship advances human_review.status directly
    // (line ~1057) and bypasses the task CLI, so the checkPhaseGate enforcement
    // on `canon task` wouldn't catch unresolved human_pending checks. Run the gate
    // here explicitly. Only fires for tasks still at human_review (not those
    // already at `complete` — those have already passed the gate). Caught
    // via Codex review on the 1b inline change.
    for (const taskId of taskIds) {
        const currentPhase = getCurrentPhase(readShipStatus(taskId));
        if (currentPhase !== 'human_review') continue;
        // Resolve the tasks-root for the gate read. Three signals, in
        // priority order:
        //   1. CANON_TASKS_DIR_OVERRIDE (env override; test/temp setups).
        //   2. The active worktree for the task (worktree mode — `handoff.md`
        //      and `done.md` live under `<worktree>/tasks/<id>/`, NOT the
        //      supervising checkout).
        //   3. REPO_ROOT/tasks (non-worktree default).
        // `tolerateMissingWorktree: true` lets --ship recover from partial-
        // cleanup state (e.g., a user manually `git worktree remove`'d before
        // re-running --ship); when the worktree is already gone we fall back
        // to REPO_ROOT, which is what the supervising checkout has.
        // (Codex P2 on PR #77 iter 1: previous form used `path.dirname(
        // taskDirFor(taskId))` unconditionally, which honored the env override
        // but ignored the worktree — gate would read stale artifacts.)
        const taskCwd = resolveShipCwd(taskId);
        const tasksRootForGate = process.env.CANON_TASKS_DIR_OVERRIDE
            ?? path.join(taskCwd, 'tasks');
        const gateResult = splitValidation.checkPhaseGate(
            taskId,
            'human_review',
            undefined,
            tasksRootForGate,
        );
        if (!gateResult.ok) {
            splitCli.die(`--ship aborted for '${taskId}': ${gateResult.reason}`);
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
        assertTaskBranchPushed(taskId, readShipBranchName(taskId));
    }

    // Snapshot only the values that are stable across the upcoming branch
    // switch + merge: `branch` is set at task creation, `worktree` likewise.
    // We deliberately do NOT capture the full `status` object — using a
    // pre-switch snapshot for the archive-loop write would overwrite fields
    // that landed via the squash merge if local was behind origin (Codex P2
    // on PR #103). The archive loop reads status fresh post-merge instead.
    type ShipTaskSnapshot = { branch: string; worktree: boolean };
    const taskSnapshots = new Map<string, ShipTaskSnapshot>();
    const branchByTaskId = new Map<string, string>();
    for (const taskId of taskIds) {
        const status = readShipStatus(taskId);
        const branch = readShipBranchName(taskId);
        taskStatuses.set(taskId, status);
        taskSnapshots.set(taskId, {
            branch,
            worktree: status.worktree === true,
        });
        branchByTaskId.set(taskId, branch);
    }
    const taskSnapshot = (taskId: string): ShipTaskSnapshot => {
        const snapshot = taskSnapshots.get(taskId);
        if (!snapshot) splitCli.die(`Missing pre-switch ship snapshot for task '${taskId}'.`);
        return snapshot;
    };

    // Worktree-mode tasks should leave no REPO_ROOT task-state mirror dirty under
    // the worktree-canonical model. Keep this as a legacy/backstop cleanup for
    // stale supervising-checkout shared-doc dirt before the merge pull.
    if (taskIds.some(id => taskSnapshot(id).worktree)) {
        const presentSharedDocs = splitWorktree.PIPELINE_SHARED_DOCS
            .filter(relPath => fs.existsSync(path.join(REPO_ROOT, relPath)));
        if (presentSharedDocs.length > 0) {
            splitGit.gitSafe('checkout', 'HEAD', '--', ...presentSharedDocs);
        }
    }

    const orphanedStatusPaths = taskIds
        .filter(taskId => taskSnapshot(taskId).worktree && resolveShipCwd(taskId) === REPO_ROOT)
        .map(taskId => path.join('tasks', taskId, 'status.json'));
    if (orphanedStatusPaths.length > 0) {
        splitGit.gitSafe('checkout', 'HEAD', '--', ...orphanedStatusPaths);
    }

    const currentBaseCheckout = splitGit.getCurrentBranch();
    if (currentBaseCheckout !== baseBranch) {
        if (!splitGit.branchExistsLocally(baseBranch)) {
            splitCli.die(
                `Task bundle targets base branch '${baseBranch}', but the current checkout is '${currentBaseCheckout}' ` +
                `and '${baseBranch}' is not available locally. Check out the declared base branch first or fetch it, then re-run.`,
            );
        }
        splitCli.info(`Switching from '${currentBaseCheckout}' to base branch '${baseBranch}' before shipping...`);
        splitGit.git('checkout', baseBranch);
    }

    const shipBaseDivergenceResult = splitValidation.verifyBaseDivergence(baseBranch, REPO_ROOT);
    if (!shipBaseDivergenceResult.ok) {
        splitCli.die(`--ship aborted: git error checking base divergence: ${shipBaseDivergenceResult.stderr || 'unknown error'}`);
    } else if (!shipBaseDivergenceResult.fetchFailed && shipBaseDivergenceResult.commits.length > 0) {
        if (!cliArgs.allowDivergentBase) {
            splitCli.die(splitValidation.verifyBaseDivergenceFromData(shipBaseDivergenceResult.commits));
        }
        splitCli.warn(
            `--allow-divergent-base override: bypassing base-divergence gate at --ship. Divergent commits:\n` +
            shipBaseDivergenceResult.commits.map(commit => `  ${commit.sha.slice(0, 7)}  ${commit.subject}`).join('\n'),
        );
    }

    const prefetchedPRHeads = new Map<number, string | null>();
    for (const taskId of taskIds) {
        const { branch: branchName } = taskSnapshot(taskId);
        if (!splitGit.branchExistsLocally(branchName)) continue;

        const activeCwd = resolveShipCwd(taskId);
        const prNum = resolveProofPRNumberForPrefetch(taskId, branchName, baseBranch, activeCwd);
        if (prNum === null || prefetchedPRHeads.has(prNum)) continue;

        const prHead = getMergedPRHeadSha(prNum);
        if (prHead === null) {
            prefetchedPRHeads.set(prNum, null);
            continue;
        }

        prefetchedPRHeads.set(prNum, materializePRHead(activeCwd, prNum, prHead) ? prHead : null);
    }
    // Merge open PRs and pull; if none found, assert the base is already in sync.
    const merged = mergeOpenPRsAndPull(taskIds, baseBranch, branchByTaskId);
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
        assertLocalBaseInSyncWithOrigin(baseBranch);
        for (const taskId of taskIds) assertNoOpenPRForTask(taskSnapshot(taskId).branch, baseBranch);
        // After mergeOpenPRsAndPull(), a successful merge would have invoked
        // --delete-branch and removed origin/task/<id>. If that branch still exists
        // here, no merge ever happened for it — abort. The earlier
        // assertTaskBranchPushed() (count-of-local-commits-ahead-of-origin) misses
        // this case because origin can be AHEAD of local and have unmerged commits
        // that are only on the remote, never in the base. Caught via codex review
        // of fb76257.
        for (const taskId of taskIds) assertOriginTaskBranchAbsent(taskSnapshot(taskId).branch, baseBranch);
    }

    // Post-merge: project-specific hook (default no-op; edit runPostMergeHook).
    runPostMergeHook();

    const proofFailures: Array<{ taskId: string; reason: string }> = [];
    for (const taskId of taskIds) {
        const branchName = taskSnapshot(taskId).branch;
        if (!splitGit.branchExistsLocally(branchName)) continue;

        const activeCwd = resolveShipCwd(taskId);
        const tipResult = splitGit.gitSafeAt(activeCwd, 'rev-parse', branchName);
        if (!tipResult.ok || !tipResult.stdout.trim()) {
            proofFailures.push({ taskId, reason: `Could not resolve local tip for ${branchName}.` });
            continue;
        }

        const proof = establishMergeProof(taskId, branchName, tipResult.stdout.trim(), baseBranch, activeCwd, prefetchedPRHeads);
        if (!proof.proven) proofFailures.push({ taskId, reason: proof.reason });
    }
    if (proofFailures.length > 0) {
        const lines = proofFailures.map(({ taskId, reason }) => `  ${taskId}: ${reason}`).join('\n');
        splitCli.die(
            `--ship aborted: merge proof could not be established for the following task(s):\n` +
            `${lines}\n\n` +
            `Recovery:\n` +
            `  - Verify the PR was merged: gh pr list --head <branch> --state merged.\n` +
            `  - If merged but proof fails after branch reuse or local advancement, delete the local branch\n` +
            `    (git branch -D <branch>) and re-run --ship; the no-branch path archives without proof.\n` +
            `  - --force does not bypass this gate.`,
        );
    }

    const archiveDir = path.join(TASKS_DIR, '_archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    const localBranchesToDelete: string[] = [];

    for (const taskId of taskIds) {
        const { worktree: hasWorktree } = taskSnapshot(taskId);

        // Re-read status fresh post-merge instead of using the pre-switch
        // captured snapshot. The captured snapshot is stable for `branch` and
        // `worktree` (set at task creation, doesn't change), but the full
        // `status` can be stale if the local task branch was behind origin
        // before `--ship` ran. `assertTaskBranchPushed` only blocks
        // local-AHEAD divergence; a behind-local checkout passes through, and
        // `mergeOpenPRsAndPull` then brings origin's tip into base. Writing
        // the pre-switch snapshot back here would overwrite fields that
        // landed via the merge (Codex P2 on PR #103).
        //
        // By this point in `shipTasks`, `mergeOpenPRsAndPull` has succeeded
        // so the task's `status.json` exists either in the worktree (not yet
        // torn down) or in REPO_ROOT (squashed-in on base) — both routes that
        // `resolveTaskCwd` already handles. The original ENOENT this PR
        // exists to fix is bypassed because the merge has completed.
        const status = readShipStatus(taskId);

        // Teardown before the final write so the worktree can disappear cleanly.
        if (hasWorktree) splitWorktree.teardownWorktree(taskId);

        status.updated = new Date().toISOString().slice(0, 10);
        const humanReview = status.phases.human_review;
        if (humanReview) humanReview.status = 'done';
        // Write directly to the supervising checkout now that the worktree is gone.
        splitState.writeStatusToFile(path.join(REPO_ROOT, 'tasks', taskId, 'status.json'), status);

        const src = taskDirForRepoRoot(taskId);
        const dest = path.join(archiveDir, taskId);
        fs.renameSync(src, dest);
        info(`📦 ${taskId} → tasks/_archive/${taskId}`);

        // Queue local branch for deletion after worktree is gone.
        const branchName = taskSnapshot(taskId).branch;
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
    const archiveCommit = commitArchiveChanges(taskIds, baseBranch, stagedPaths);
    if (archiveCommit.stderr) {
        die(`--ship aborted: failed to commit archive changes: ${archiveCommit.stderr}`);
    }

    // Delete local task branches (safe to force — squash-merged).
    for (const branch of localBranchesToDelete) {
        const result = splitGit.gitSafe('branch', '-D', branch);
        if (result.ok) info(`Deleted local branch ${branch}.`);
        else warn(`Could not delete local branch ${branch}: ${result.stderr}`);
    }

    info(`Shipped ${taskIds.length} task${taskIds.length > 1 ? 's' : ''} to _archive/.`);
    process.exit(0);
}

// ── Reroute ────────────────────────────────────────────────────────────────

export function rerouteFromHumanReview(taskIds: string[]): void {
    const entryStatuses = taskIds.map(taskId => ({ taskId, status: splitState.readStatus(taskId) }));
    const allAtHumanReview = entryStatuses.every(({ status }) => getCurrentPhase(status) === 'human_review');
    const allCodeReviewBlocked = entryStatuses.every(({ status }) => {
        const codeReview = status.phases.code_review;
        return getCurrentPhase(status) === 'code_review' && codeReview?.status === 'blocked';
    });
    const someSpecGap = entryStatuses.some(({ status }) => getVerdict(status, 'code_review') === 'spec_gap');
    const isSpecGapReroute = allCodeReviewBlocked && someSpecGap;
    if (!allAtHumanReview && !isSpecGapReroute) {
        const summary = entryStatuses
            .map(({ taskId, status }) => {
                const currentPhase = getCurrentPhase(status);
                const verdict = getVerdict(status, 'code_review') || 'none';
                const codeReviewStatus = status.phases.code_review?.status ?? 'missing';
                return `'${taskId}': ${currentPhase} (code_review ${codeReviewStatus}, verdict ${verdict})`;
            })
            .join(', ');
        splitCli.die(
            `--reroute requires either all tasks at human_review, or all tasks at code_review blocked with at least one spec_gap verdict. ` +
            `Current state: ${summary}`
        );
    }
    const amendmentFailures: Array<{
        taskId: string;
        specPath: string;
        requiredRound: number;
        expectedHeading: string;
        reason: string;
    }> = [];
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        const codeReviewVerdict = getVerdict(status, 'code_review');
        if (isSpecGapReroute && codeReviewVerdict !== 'spec_gap') {
            continue;
        }
        const requiredRound = (status.phases.implement?.reroute_count ?? 0) + 1;
        const result = splitValidation.verifyRerouteAmendment(taskId, requiredRound);
        if (!result.amended) {
            amendmentFailures.push({
                taskId,
                specPath: path.join(taskDirFor(taskId), 'spec.md'),
                requiredRound,
                expectedHeading: requiredRound === 1 ? '## Amendment' : `## Amendment Round ${requiredRound}`,
                reason: result.reason,
            });
        }
    }
    if (amendmentFailures.length > 0) {
        if (!cliArgs.force) {
            die(
                `--reroute aborted: spec.md amendment required before reroute.\n` +
                amendmentFailures.map(failure =>
                    [
                        `  ${failure.taskId}: ${failure.specPath}`,
                        `    required round: ${failure.requiredRound}`,
                        `    expected heading: ${failure.expectedHeading}`,
                        `    reason: ${failure.reason}`,
                    ].join('\n')
                ).join('\n') +
                `\n  Bypass with --force if you have verified the lack of amendment is intentional.\n` +
                `  See docs/pipeline-orchestrator.md § Human Reroute for the contract.`
            );
        }
        for (const failure of amendmentFailures) {
            warn(
                `--force bypass: ${failure.taskId} spec.md missing required ${failure.expectedHeading} heading for round ${failure.requiredRound}; ` +
                `Codex will re-implement against the existing spec.`
            );
        }
    }
    const rerouteStatuses = taskIds.map(splitState.readStatus);
    const reroutableTier = splitPolicy.detectTier(rerouteStatuses);
    const isFullTierReroute = reroutableTier === 'full';
    const rerouteSource = isSpecGapReroute ? 'code_review spec_gap' : 'human_review';
    splitCli.info(isFullTierReroute
        ? `Rerouting: ${rerouteSource} → spec_review (resetting spec_review, plan, implement, code_review, qa)`
        : `Rerouting: ${rerouteSource} → implement (resetting implement, code_review, qa)`);
    let clearedFullSend = false;
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        status.updated = new Date().toISOString().slice(0, 10);
        // writeStatus() derives top-level .status from phases — the earliest
        // reset phase becomes the next pipeline phase (spec_review for full-tier
        // reroutes, implement for fast-tier reroutes).
        const implement = status.phases.implement;
        if (implement) {
            const currentCodeReviewVerdict = getVerdict(status, 'code_review');
            implement.status = 'pending';
            // implement.rerouted is set on reroute entry and intentionally not
            // cleared. Dispatch correctness relies on the invariant that, at
            // spec_review / plan / implement dispatch time, rerouted === true
            // iff a human reroute is in progress: task creation starts falsy;
            // the original spec_review loop routes to spec only before reroute
            // because reroute+changes_requested is intercepted first; code_review
            // loops prefer the revision prompt before the reroute prompt; and
            // this path sets the flag when a human reroute starts.
            implement.rerouted = true;
            // Accumulate (never reset). The reroute prompt reads this to inject a round
            // marker so session-resumed Codex can't confuse a new reroute with a duplicate
            // of a prior one — the static prompt text is otherwise identical each round.
            implement.reroute_count = (implement.reroute_count ?? 0) + 1;
            const rerouteState = implement as PhaseEntry & {
                reroute_exempt?: boolean;
                reroute_exempt_prior_verdict?: string;
            };
            if (isSpecGapReroute && currentCodeReviewVerdict !== 'spec_gap') {
                rerouteState.reroute_exempt = true;
                rerouteState.reroute_exempt_prior_verdict = currentCodeReviewVerdict;
            } else {
                delete rerouteState.reroute_exempt;
                delete rerouteState.reroute_exempt_prior_verdict;
            }
            clearPhaseOperatorAcceptance(implement);
        }
        const codeReview = status.phases.code_review;
        if (codeReview) {
            codeReview.status = 'pending';
            codeReview.verdict = '';
            // Reset the loop counter so the next review pass starts fresh.
            // Preserve iterations_total / changes_requested_total /
            // preflight_rejections_total / auto_block_count — those are
            // monotonic across reroutes. Writes both the new field and the
            // legacy `iterations` alias for back-compat readers. Caught
            // post-implementation: forgotten consumer from the
            // counter-schema-migration grep audit.
            codeReview.iterations_current_loop = 0;
            codeReview.iterations = 0;
            // Clear the per-loop pre-flight counter too — runCodeReviewPhase
            // auto-blocks on iterations_current_loop + preflight_rejections_current_loop;
            // forgetting this resets stale pre-flight counts from the prior
            // review cycle into the next reroute's loop and can trip the cap
            // before the new Claude session runs.
            codeReview.preflight_rejections_current_loop = 0;
            clearPhaseOperatorAcceptance(codeReview);
        }
        const qa = status.phases.qa;
        if (qa) qa.status = 'pending';
        const humanReview = status.phases.human_review;
        if (humanReview) humanReview.status = 'pending';
        if (isFullTierReroute) {
            const specReview = status.phases.spec_review;
            if (specReview) {
                specReview.status = 'pending';
                specReview.verdict = '';
                // Reset the current-loop counter for the new amendment-review
                // loop. Preserve monotonic history fields.
                specReview.iterations_current_loop = 0;
                specReview.iterations = 0;
                clearPhaseOperatorAcceptance(specReview);
            }
            const plan = status.phases.plan;
            if (plan) plan.status = 'pending';
            if (status.sessions) {
                delete status.sessions.codex_spec_review;
            }
        }
        if (status.full_send === true) {
            status.full_send = false;
            clearedFullSend = true;
        }
        splitState.writeStatus(taskId, status);
    }
    if (isFullTierReroute) {
        splitCli.info('Status reset. Pipeline will resume from spec_review, then plan, then implement.');
        splitCli.info('Stepped reroute now expects spec_review: use --step --expect spec_review.');
    } else {
        splitCli.info('Status reset. Pipeline will resume from implement phase with amended-spec context.');
        splitCli.info('Note: Codex will re-read spec.md carefully (looking for new Amendment sections) and update the implementation.');
    }
    splitCli.info('');
    if (clearedFullSend) {
        splitCli.info('⚠ full_send cleared. Reroutes indicate the prior result needed correction; re-engage at human_review to verify the fix before another PR opens. Re-enable with \'canon run --full-send <id>\' if you\'re confident.');
    }
    splitCli.info('⚠  Before invoking the pipeline: ensure every task that needs amended requirements has an');
    splitCli.info('   Amendment section in tasks/<id>/spec.md in the active task directory. For worktree-backed tasks, edit the worktree copy;');
    splitCli.info('   edit REPO_ROOT only before a worktree exists. review.md alone is not sufficient — Codex reads spec.md as the contract.');
}

function clearPhaseOperatorAcceptance(entry: PhaseEntry | undefined): void {
    if (!entry) return;
    // When a phase reopens, a prior operator accept is stale. For implement,
    // the accepted SHA belongs to a discarded iteration; for review phases,
    // a stale sanction must not mask the next agent verdict.
    delete entry.operator_accepted;
    delete entry.operator_accepted_sha;
    delete entry.operator_accepted_at;
}

function routeBackTo(taskIds: string[], targetPhase: Phase): void {
    const targetIdx = PHASE_ORDER.indexOf(targetPhase);
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        if (targetIdx <= PHASE_ORDER.indexOf('implement')) {
            clearPhaseOperatorAcceptance(status.phases.implement);
        }
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
        // came in after the bug bit a real task.
        for (let i = targetIdx; i < PHASE_ORDER.length; i += 1) {
            const phaseEntry = status.phases[PHASE_ORDER[i]];
            if (phaseEntry) {
                phaseEntry.status = 'pending';
                // Clear any stale verdict so the next review round starts clean.
                if (Object.hasOwn(phaseEntry, 'verdict')) {
                    phaseEntry.verdict = '';
                }
                clearPhaseOperatorAcceptance(phaseEntry);
            }
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
    // spec_review and implement use separate Codex slots. First-pass spec_review
    // is REPO_ROOT-bound; reroute spec_review clears this slot and starts fresh
    // in the active worktree, so it must still never share implement context.
    const codexSpecReviewSession = splitState.getStoredSessionId(taskIds, 'codex_spec_review');
    const codexSession = splitState.getStoredSessionId(taskIds, 'codex');

    if ((phase as Phase) === 'spec') {
        return runSpecPhase(state, cliArgs.interactive, specClaudeSession);
    }
    if ((phase as Phase) === 'spec_review') {
        return runSpecReviewPhase(state, cliArgs.interactive, codexSpecReviewSession);
    }
    if ((phase as Phase) === 'plan') {
        return runPlanPhase(state, cliArgs.interactive);
    }
    if ((phase as Phase) === 'implement') {
        return runImplementPhase(state, cliArgs.interactive, codexSession, cliArgs.force);
    }
    if ((phase as Phase) === 'code_review') {
        return runCodeReviewPhase(state, cliArgs.interactive, reviewClaudeSession);
    }
    if ((phase as Phase) === 'qa') {
        const activeCwd = splitWorktree.getActiveCwd(taskIds);
        const qaTemplatePath = state.isBundle
            ? null
            : (findPullRequestTemplate(activeCwd) ?? findPullRequestTemplate(REPO_ROOT));
        const resolvedPrTemplate = qaTemplatePath ? fs.readFileSync(qaTemplatePath, 'utf8') : null;
        return runQaPhase(state, cliArgs.interactive, resolvedPrTemplate);
    }
    if (phase === 'human_review') {
        const taskIds = tasks.map(t => t.taskId);
        if (shouldRunFullSendTail(taskIds)) {
            const branches = new Set(taskIds.map(id => resolveTaskBranchName(id)));
            if (branches.size !== 1) {
                die(
                    `Full-send tail aborted: bundle spans multiple branches (${[...branches].join(', ')}). Today's --pr flow operates on one branch per invocation; multi-branch full-send is out of scope. Run each branch's tasks as a separate invocation.`
                );
            }

            const branch = [...branches][0];
            const cwd = splitWorktree.getActiveCwd(taskIds);
            const tasksRootForGate = process.env.CANON_TASKS_DIR_OVERRIDE ?? path.join(cwd, 'tasks');

            // Bundle atomicity: write human_review.status = done only after the
            // PR-creation helper returns successfully for every task.
            for (const taskId of taskIds) {
                const gateResult = splitValidation.checkPhaseGate(taskId, 'human_review', undefined, tasksRootForGate);
                if (!gateResult.ok) {
                    die(gateResult.reason);
                }
            }

            commitHumanReviewFiles(taskIds, cwd, true);

            for (const taskId of taskIds) {
                const status = splitState.readStatus(taskId);
                if (status.phases.human_review) {
                    status.phases.human_review.status = 'done';
                }
                splitState.writeStatus(taskId, status);
            }

            const completeState = inspectCompleteState(branch, taskIds);
            let prUrl = '(PR URL unavailable — check GitHub)';
            if (completeState.kind === 'open_pr') {
                prUrl = completeState.prUrl;
            } else {
                warn(`Full-send: PR URL unavailable for branch ${branch}; expected open PR after --pr step`);
            }

            console.log('');
            console.log('════════════════════════════════════════════════════════');
            console.log('  ✅ FULL-SEND COMPLETE — draft PR open.');
            console.log('');
            console.log(`  PR: ${prUrl}`);
            console.log('');
            console.log(`  Merge at your discretion via \`canon run ${taskIds.join(' ')} --ship\`,`);
            console.log('  or via GitHub once the PR is marked ready.');
            console.log('════════════════════════════════════════════════════════');
            console.log('');
            process.exit(0);
        }

        if (cliArgs.push || cliArgs.pr) {
            const cwd = splitWorktree.getActiveCwd(taskIds);
            commitHumanReviewFiles(taskIds, cwd, cliArgs.pr);
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
    if (phase === 'complete') {
        const taskIds = tasks.map(t => t.taskId);
        if (cliArgs.push || cliArgs.pr) {
            const cwd = splitWorktree.getActiveCwd(taskIds);
            commitHumanReviewFiles(taskIds, cwd, cliArgs.pr);
            process.exit(0);
        }

        printCompleteStateBanner(taskIds);
        process.exit(0);
    }

    die(`Unknown phase: ${String(phase)}`);
}

// ── Evidence-based phase advance + one-shot retry ─────────────────────────
// Background (2026-04-19): Codex "ran" the phase-advance helper for <task-id>
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

// `extractCheckedVerdict` was moved to scripts/run-task/validation.ts so the
// phase gate (1a-2) can call it without creating a circular import from
// main.ts. Re-exported here for back-compat with `tests/run-task-extract-verdict.test.ts`.
export const extractCheckedVerdict = splitValidation.extractCheckedVerdict;

function readArtifact(taskId: string, name: string): string | null {
    const p = path.join(taskDirFor(taskId), name);
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function checkImplementEvidence(taskId: string): EvidenceResult {
    // Four gates before auto-advancing (each rules out a different false-positive):
    //  1. handoff.md Changes table is non-empty (basic sanity)
    //  2. no malformed rows — wildcards, combined paths, unfilled placeholders
    //     each fail downstream in autoCommitCode anyway, but failing here lets
    //     the one-shot retry surface the cell-level error to Codex instead of
    //     letting the phase auto-advance and then die at auto-commit.
    //  3. validateHandoff passes — same rule Claude's code review applies:
    //     Validation Outcomes table has no Fail and AC Coverage is present.
    //     Catches "Codex wrote a draft handoff before validation actually passed".
    //  4. at least one listed file exists on disk — catches phantom/hallucinated
    //     filenames in the Changes table.
    const { files, malformed } = splitValidation.parseHandoffChangesRows(taskId);
    if (files.length === 0 && malformed.length === 0) {
        return { advanced: false, note: 'handoff.md Changes table is empty' };
    }
    if (malformed.length > 0) {
        const sample = malformed.slice(0, 3).map(m => `'${m.cell}': ${m.reason}`).join('; ');
        const tail = malformed.length > 3 ? ` (+${malformed.length - 3} more)` : '';
        return { advanced: false, note: `handoff.md Changes table has malformed row(s): ${sample}${tail}` };
    }
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
    // Gitignored handoff entries (build-generated artifacts) are exempt
    // from the "exists on disk" check — they may not have been built yet
    // and don't represent real source changes anyway. Pre-filter so a
    // handoff of `[src/generator.ts, public/sitemap.xml]` advances on
    // the strength of the script existing, ignoring the artifact.
    // But a handoff containing ONLY gitignored entries has no real
    // source evidence — refuse to advance, same as zero-existing.
    //
    // Resolve gitignore from the active worktree (last-pushed checkRoot)
    // when present; branch-local `.gitignore` rules don't exist in the
    // supervising checkout. Falls back to REPO_ROOT for non-worktree tasks.
    const ignoreCwd = checkRoots[checkRoots.length - 1];
    const gitIgnored = splitGit.filterGitIgnoredPaths(files, ignoreCwd);
    const verifiableFiles = files.filter(f => !gitIgnored.has(f));
    if (verifiableFiles.length === 0) {
        return {
            advanced: false,
            note: `handoff.md lists ${files.length} file(s) but all are gitignored — at least one tracked source file is required as evidence`,
        };
    }
    const existingFiles = verifiableFiles.filter(f =>
        checkRoots.some(root => fs.existsSync(path.join(root, f)))
    );
    if (existingFiles.length === 0) {
        // Deletion-only implements are legitimate: a listed file that is
        // absent from disk but known to git as a deletion (uncommitted
        // working-tree delete, or already deleted by a commit on the task
        // branch) is real evidence, same as an existing file. Without this,
        // a deletion-only handoff can never pass the gate — the retry
        // re-deletes nothing and the phase wedges (autoCommitCode already
        // handles deletions; this pre-check must not be stricter).
        const evidenceCwd = checkRoots[checkRoots.length - 1];
        const deletedInWorkingTree = new Set(
            splitGit.gitSafeAt(evidenceCwd, 'ls-files', '--deleted').stdout
                .split('\n').map(l => l.trim()).filter(Boolean),
        );
        const baseBranch = sForEvidence.base_branch || splitGit.getDefaultBaseBranch();
        const committedDiff = splitGit.gitSafeAt(
            evidenceCwd, 'diff', '--name-status', `${baseBranch}...HEAD`,
        );
        const deletedInCommits = new Set(
            committedDiff.stdout.split('\n')
                .filter(l => l.startsWith('D'))
                .map(l => l.split('\t')[1]?.trim())
                .filter((p): p is string => Boolean(p)),
        );
        const deletedFiles = verifiableFiles.filter(f =>
            deletedInWorkingTree.has(f) || deletedInCommits.has(f),
        );
        if (deletedFiles.length === 0) {
            return { advanced: false, note: `handoff.md lists ${files.length} file(s) but none exist on disk or are git-tracked deletions` };
        }
        return { advanced: true, note: `handoff.md lists ${files.length} file(s) (${deletedFiles.length} verified as git-tracked deletions, ${gitIgnored.size} gitignored), validation clean` };
    }
    return { advanced: true, note: `handoff.md lists ${files.length} file(s) (${existingFiles.length} verified on disk, ${gitIgnored.size} gitignored), validation clean` };
}

export function tryEvidenceAdvance(taskId: string, phase: Phase): EvidenceResult {
    switch (phase) {
        case 'implement': {
            const evidence = checkImplementEvidence(taskId);
            if (!evidence.advanced) return evidence;
            taskPhase(taskId, 'implement', 'done');
            return evidence;
        }
        case 'code_review': {
            const content = readArtifact(taskId, 'review.md');
            if (splitValidation.isTemplateUnfilled(content)) return { advanced: false, note: 'review.md is missing or still the template' };
            const verdict = extractCheckedVerdict(content!);
            if (!verdict) return { advanced: false, note: 'no verdict box checked in review.md' };
            taskPhase(taskId, 'code_review', 'done', verdict);
            return { advanced: true, verdict, note: `verdict=${verdict}` };
        }
        case 'spec_review': {
            const content = readArtifact(taskId, 'spec-review.md');
            if (splitValidation.isTemplateUnfilled(content)) return { advanced: false, note: 'spec-review.md is missing or still the template' };
            // Guard the status read: recoverPhaseForTask does not catch throws, so a
            // missing/partial status.json must fail closed (advanced:false → retry),
            // not abort the recovery flow.
            let sSR: ReturnType<typeof splitState.readStatus>;
            try { sSR = splitState.readStatus(taskId); }
            catch { return { advanced: false, note: 'spec_review: status.json unreadable — cannot evaluate reroute evidence' }; }
            // On a reroute the verdict must come from the current round's `## Amendment
            // Review` section, not the stale whole-file approval (checkRerouteEvidence
            // is the shared invariant, also enforced in checkPhaseGate).
            const ev = splitValidation.checkRerouteEvidence('spec_review', content!, sSR);
            if (ev.reroute) {
                if (!ev.ok) return { advanced: false, note: `reroute spec_review: ${ev.reason}` };
                taskPhase(taskId, 'spec_review', 'done', ev.verdict);
                return { advanced: true, verdict: ev.verdict, note: `verdict=${ev.verdict} (reroute amendment review)` };
            }
            const verdict = extractCheckedVerdict(content!);
            if (!verdict) return { advanced: false, note: 'no verdict box checked in spec-review.md' };
            taskPhase(taskId, 'spec_review', 'done', verdict);
            return { advanced: true, verdict, note: `verdict=${verdict}` };
        }
        case 'plan': {
            const content = readArtifact(taskId, 'plan.md');
            if (splitValidation.isTemplateUnfilled(content)) return { advanced: false, note: 'plan.md is missing or still the template' };
            // Guard the status read (recoverPhaseForTask does not catch throws).
            let sPlan: ReturnType<typeof splitState.readStatus>;
            try { sPlan = splitState.readStatus(taskId); }
            catch { return { advanced: false, note: 'plan: status.json unreadable — cannot evaluate reroute evidence' }; }
            // On a reroute, require the current round's `## Reroute Plan` delta so
            // implement-reroute doesn't fall back to the stale plan as if fast-tier
            // (checkRerouteEvidence is the shared invariant, also in checkPhaseGate).
            const ev = splitValidation.checkRerouteEvidence('plan', content!, sPlan);
            if (ev.reroute && !ev.ok) return { advanced: false, note: `reroute plan: ${ev.reason}` };
            taskPhase(taskId, 'plan', 'done');
            return { advanced: true, note: 'plan.md is populated' };
        }
        case 'spec': {
            const content = readArtifact(taskId, 'spec.md');
            if (splitValidation.isTemplateUnfilled(content)) return { advanced: false, note: 'spec.md is missing or still the template' };
            taskPhase(taskId, 'spec', 'done');
            return { advanced: true, note: 'spec.md is populated' };
        }
        case 'qa': {
            // Upstream salvage (runPhase case 'qa') already handles the Haiku
            // stdout-streaming case. If we're still at qa != done here, the
            // done.md on disk is what we have to work with.
            const donePath = path.join(splitState.taskDirFor(taskId), 'done.md');
            if (splitValidation.isDoneMdTemplate(donePath)) return { advanced: false, note: 'done.md is still the template' };
            taskPhase(taskId, 'qa', 'done');
            return { advanced: true, note: 'done.md is populated' };
        }
        default:
            return { advanced: false, note: `phase '${phase}' has no evidence rule` };
    }
}

// Resume the last agent session for this phase and prompt them to complete.
// Single turn, terse — the agent has full conversational context already.
export async function retryAgentForPhase(taskId: string, phase: Phase, evidenceNote: string): Promise<'done' | 'drift' | 'no_session'> {
    const status = splitState.readStatus(taskId);
    const agent = status.phases[phase]?.agent;
    if (!agent || (agent !== 'codex' && agent !== 'claude')) return 'no_session';
    // Sessions live in per-phase slots, not a flat-by-agent slot. Map phase to
    // slot the same way the post-phase storage block does (spec → claude_spec,
    // spec_review → codex_spec_review, code_review → claude_review, implement → codex).
    // plan and qa are one-offs with no stored session; retry returns 'no_session'.
    const slot: SessionSlot | null = agent === 'codex'
        ? (phase === 'spec_review' ? 'codex_spec_review' : 'codex')
        : phase === 'spec' ? 'claude_spec'
        : phase === 'code_review' ? 'claude_review'
        : null;
    const sessionId = slot ? (status.sessions?.[slot] ?? null) : null;
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
        `  canon task phase ${taskId} ${phase} done${verdictHint}`,
        '',
        'Reply with tool calls only. No summary, no explanation.',
    ].join('\n');

    warn(`Retrying ${agent} session ${sessionId.slice(0, 8)}... for ${taskId} ${phase}.`);
    // Retries must use the same cwd as the original phase. implement and
    // code_review always use the active worktree when worktree mode is enabled.
    // spec_review also uses the worktree during human reroutes, because the
    // amended spec lives there and the reroute clears the old REPO_ROOT-bound
    // Codex spec_review session before creating a fresh one. spec, plan, and qa
    // keep REPO_ROOT retry semantics.
    const isWorktreePhase = phase === 'implement' || phase === 'code_review' ||
        (phase === 'spec_review' && status.phases.implement?.rerouted === true);
    const retryCwd = isWorktreePhase ? splitWorktree.getActiveCwd([taskId]) : REPO_ROOT;
    if (agent === 'codex') {
        // Retry phase must be a Codex-run phase. spec_review and implement are
        // the only two; anything else indicates a stored agent mismatch.
        if (phase !== 'spec_review' && phase !== 'implement') {
            warn(`Cannot retry ${phase} with Codex — not a Codex-run phase.`);
            return 'no_session';
        }
        const retryTasks: TaskContext[] = [{
            taskId, title: status.title ?? taskId, specReviewVerdict: '',
            iterations: 0,
            iterations_current_loop: 0,
            iterations_total: 0,
            rerouteCount: 0,
            status,
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
            iterations: 0,
            iterations_current_loop: 0,
            iterations_total: 0,
            rerouteCount: 0,
            status,
        }];
        const cfg = splitPolicy.getClaudeConfig(phase, retryTasks);
        await splitClaude.runClaude(prompt, false, sessionId, cfg.model, cfg.effort, cfg.budget, undefined, retryCwd);
    }

    return getPhaseStatus(splitState.readStatus(taskId), phase) === 'done' ? 'done' : 'drift';
}

// Wraps evidence-advance + retry + post-retry-evidence in a single recovery
// attempt for one task. Returns true if the phase is now 'done' (by any path).
async function recoverPhaseForTask(taskId: string, phase: Phase, initialStatus: PhaseStatus): Promise<boolean> {
    const evidence = tryEvidenceAdvance(taskId, phase);
    if (evidence.advanced) {
        warn(`Auto-advanced '${phase}' for '${taskId}' (was ${initialStatus}; ${evidence.note}). Agent skipped canon task bookkeeping.`);
        return true;
    }

    warn(`Evidence insufficient for '${taskId}' ${phase}: ${evidence.note}. Attempting one-shot retry.`);
    const retry = await retryAgentForPhase(taskId, phase, evidence.note);
    if (retry === 'no_session') return false;
    if (retry === 'done') {
        if (phase === 'implement') {
            const postRetryEvidence = checkImplementEvidence(taskId);
            if (!postRetryEvidence.advanced) {
                taskPhase(taskId, 'implement', 'in_progress');
                warn(`Retry completed but handoff evidence is still missing/invalid: ${postRetryEvidence.note}`);
                return false;
            }
        }
        warn(`Retry succeeded — '${taskId}' ${phase} is now done.`);
        return true;
    }

    // Retry ran but status still isn't done. Check evidence once more — maybe
    // the agent produced the artifact on retry but skipped canon task again.
    const postEvidence = tryEvidenceAdvance(taskId, phase);
    if (postEvidence.advanced) {
        warn(`Retry produced artifact — auto-advanced (${postEvidence.note}).`);
        return true;
    }
    warn(`Retry did not recover '${taskId}' ${phase} (${postEvidence.note}).`);
    return false;
}

// ── checkAndRoute ──────────────────────────────────────────────────────────

export async function checkAndRoute(phase: Phase, taskIds: string[]): Promise<void> {
    let statuses = taskIds.map(splitState.readStatus);

    // Verify all tasks completed this phase. If any didn't, attempt
    // evidence-based auto-advance, then a one-shot retry, before bailing.
    for (let i = 0; i < taskIds.length; i += 1) {
        const phaseStatus = getPhaseStatus(statuses[i], phase);
        if (phase === 'implement' && phaseStatus === 'done') {
            const evidence = checkImplementEvidence(taskIds[i]);
            if (!evidence.advanced) {
                warn(`Codex marked implement done but handoff.md evidence is missing/invalid: ${evidence.note}. Re-run \`canon run ${taskIds[i]}\` to resume the session.`);
                taskPhase(taskIds[i], 'implement', 'in_progress');
                statuses[i] = splitState.readStatus(taskIds[i]);
                const recovered = await recoverPhaseForTask(taskIds[i], phase, phaseStatus);
                if (!recovered) {
                    warn(`Phase '${phase}' did not reach 'done' for '${taskIds[i]}'. Stopping for human review.`);
                    process.exit(2);
                }
                continue;
            }
        }
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
            const isRerouteInProgress = statuses.some(s => s.phases.implement?.rerouted === true);
            // Reroute amendment rejection is human-owned. This must run before
            // routeBackTo('spec'); otherwise a stale rerouted=true flag could
            // send the pipeline through the normal spec loop with reroute prompt
            // variants selected later.
            if (isRerouteInProgress && anyChangesRequested) {
                for (const taskId of taskIds) {
                    const s = splitState.readStatus(taskId);
                    const specReview = s.phases.spec_review;
                    if (specReview) {
                        specReview.status = 'pending';
                        specReview.verdict = '';
                    }
                    splitState.writeStatus(taskId, s);
                }
                const rejectedIds = taskIds.filter((_, index) =>
                    getVerdict(statuses[index], 'spec_review') === 'changes_requested'
                );
                console.log('');
                console.log('════════════════════════════════════════════════════════');
                console.log('  ✋  AMENDMENT REVIEW — Changes requested.');
                console.log('');
                console.log('  Revise the amendment in these files:');
                for (const taskId of rejectedIds) {
                    console.log(`    tasks/${taskId}/spec.md`);
                    console.log(`    tasks/${taskId}/spec-review.md  ← review findings`);
                }
                console.log('');
                console.log('  After revising, re-run the normal pipeline command (NOT --reroute):');
                console.log(`  canon run ${taskIds.join(' ')}`);
                console.log('════════════════════════════════════════════════════════');
                console.log('');
                process.exit(0);
            }
            if (anyChangesRequested) {
                info('Spec review requested changes — routing back to spec.');
                routeBackTo(taskIds, 'spec');
                return;
            }
            // Full tier: human gate fires after Codex spec_review completes
            const tier = splitPolicy.detectTier(statuses);
            const allFullSend = statuses.every(s => s.full_send === true);
            // Bundle gate skip is all-or-nothing: one normal task re-engages the
            // gate for the whole invocation.
            if (tier === 'full' && statuses.some(s => s.human_spec_gate) && !allFullSend) {
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
                console.log(`  When ready: canon run ${taskIds.join(' ')}`);
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
            const specGapIds = taskIds.filter((_, index) => getVerdict(statuses[index], 'code_review') === 'spec_gap');
            if (specGapIds.length > 0) {
                const maxIter = statuses.reduce((max, s) => Math.max(max, getIterations(s)), 0);
                const reason =
                    `Code review surfaced a spec_gap verdict for task(s): ${specGapIds.join(', ')}. ` +
                    `The implementation cannot resolve this — the root cause is in the spec. ` +
                    `Recovery options (both operate on the full blocked bundle [${taskIds.join(' ')}]):\n` +
                    `  FIX: amend spec.md with ## Amendment, then: canon run ${taskIds.join(' ')} --reroute\n` +
                    `  BLESS: canon task accept ${taskIds.join(' ')} code_review --reason "<why>"`;
                console.log('');
                console.log('════════════════════════════════════════════════════════');
                console.log('  ✋  SPEC GAP — Code review surfaced a spec problem.');
                console.log('');
                console.log('  The code review found a problem in the spec, not a fixable');
                console.log('  implementation bug. Review the findings:');
                for (const id of specGapIds) console.log(`    tasks/${id}/review.md`);
                console.log('');
                console.log('  Two recovery options:');
                console.log('');
                console.log('  FIX  — Amend the spec and re-run the full review chain:');
                for (const id of specGapIds) {
                    console.log(`    # Edit tasks/${id}/spec.md — add a ## Amendment section`);
                }
                console.log(`    canon run ${taskIds.join(' ')} --reroute`);
                console.log('');
                console.log('  BLESS — Sanction the gap as acceptable (adds an audit trail):');
                console.log(`    canon task accept ${taskIds.join(' ')} code_review --reason "<why this gap is acceptable>"`);
                console.log('════════════════════════════════════════════════════════');
                console.log('');
                // Block the entire bundle, not just specGapIds. Bundle members
                // share one branch and one commit history: an approved sibling
                // must not advance to qa while a gap task can force a shared
                // re-implementation. Both recovery paths operate on all IDs.
                splitState.autoBlockPhase(taskIds, 'code_review', maxIter, reason);
                process.exit(2);
            }

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

        case 'qa':
            commitQaArtifacts(taskIds, splitWorktree.getActiveCwd(taskIds));
            return;

        default:
            return;
    }
}

// ── Dependency check ───────────────────────────────────────────────────────

function checkDeps(taskIds: string[], skipAgentDeps = false): void {
    if (!skipAgentDeps) {
        for (const dep of ['claude', 'codex']) {
            const result = spawnSync('which', [dep], { stdio: 'ignore' });
            if (result.error || result.status !== 0) {
                const label = dep === 'claude' ? 'Claude Code CLI' : dep === 'codex' ? 'Codex CLI' : dep;
                splitCli.die(`${label} is required`);
            }
        }
    }
    // gh availability must be detected even when skipAgentDeps is true.
    // --ship and --dry-run set skipAgentDeps to skip the claude/codex checks
    // (those CLIs aren't invoked on those paths), but gh IS invoked: --ship
    // calls findOpenPRNumber/findMergedPRNumber/getMergedPRHeadSha for its
    // merge step and externally-merged recovery path. Until this fix, those
    // calls all returned null silently because ghAvailable stayed at its
    // module-load default of false, causing --ship to never invoke
    // `gh pr merge` and the recovery in assertOriginTaskBranchAbsent to never
    // detect an already-merged PR. "--ship is post-merge-only" framing in
    // earlier docs/memory was a symptom of this bug, not a design choice.
    // Diagnosed live in PR #95's ship attempt on 2026-05-21.
    ghAvailable = splitGit.isCommandAvailable('gh');
    if (!skipAgentDeps) {
        splitCli.info(ghAvailable
            ? 'gh CLI found — draft PR creation is available.'
            : 'gh CLI not found — PR creation will be unavailable. Push still works.');
    }

    for (const taskId of taskIds) {
        splitCli.validateTaskId(taskId);
        const repoRootStatusFile = path.join(REPO_ROOT, 'tasks', taskId, 'status.json');
        const statusFile = cliArgs.ship && fs.existsSync(repoRootStatusFile)
            ? repoRootStatusFile
            : splitState.statusFileFor(taskId);
        if (!fs.existsSync(statusFile)) {
            splitCli.die(`No status.json at tasks/${taskId}/status.json — run canon task new ${taskId} first`);
        }
    }
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Register all heartbeat-shutdown + `.canon-pid` cleanup hooks BEFORE writing
 * the first heartbeat. `startHeartbeat` writes synchronously on its first
 * call ([scripts/run-task/heartbeat.ts](./heartbeat.ts)) — if a signal lands
 * between that write and a later hook registration, the file leaks. Bundling
 * both steps into one helper enforces the right ordering by construction
 * and gives every call site (early child path, original post-validation
 * path) the same guarantees.
 */
function bootHeartbeatWithHooks(
    taskIds: string[],
    resolveTaskDir: (id: string) => string,
): void {
    // 1. Hooks first — register everything that needs to fire on shutdown
    //    or signal so a SIGINT/SIGTERM arriving mid-write still cleans up.
    process.on('exit', () => stopAllHeartbeats());
    registerShutdownHook(stopAllHeartbeats);

    const cleanupCanonPids = (): void => {
        for (const id of taskIds) {
            try { removeCanonPid(resolveTaskDir(id)); }
            catch { /* best-effort */ }
        }
    };
    process.on('exit', cleanupCanonPids);
    registerShutdownHook(cleanupCanonPids);

    // 2. Heartbeat starts — writeOnce() inside startHeartbeat fires
    //    synchronously here. Any signal that arrives now has the hooks in
    //    place and a SIGTERM forwarder that knows to sweep both files.
    startHeartbeat(taskIds, resolveTaskDir);
}

export async function main(): Promise<void> {
    splitCli.registerExitHandlers();
    // Signal-driven shutdown re-raises with Node's default action, which
    // bypasses 'exit' handlers — the marker must be written from the
    // shutdown-hook path before the re-raise (Codex PR #156 finding).
    registerShutdownHook(sig => splitCli.writeSignalExitMarker(sig));
    // Mark all child processes as orchestrator-driven so .githooks/pre-commit
    // and .githooks/pre-push know to skip — the orchestrator already runs
    // validation per phase and re-running it on every auto-commit is waste.
    process.env.RUN_TASK_ORCHESTRATOR = '1';
    cliArgs = splitCli.parseArgs(process.argv.slice(2));
    splitEnv.warnLegacyEnvVars();
    splitEnv.warnWorktreesRootMismatch();
    const skipAgentDeps = cliArgs.ship || cliArgs.dryRun;
    checkDeps(cliArgs.taskIds, skipAgentDeps);

    // Early-start the heartbeat for detached children. By the time we reach
    // this point:
    //   - validateTaskId (inside parseArgs, scripts/run-task/cli.ts:133)
    //     has rejected malformed IDs
    //   - checkDeps has rejected missing claude/codex/gh
    // So writing a heartbeat here represents a real, going-to-run
    // orchestrator. Earlier (right after parseArgs, before checkDeps) would
    // leak heartbeat files for runs that were about to fail dep checks.
    //
    // This shrinks the launch window from "Node boot + module load +
    // parseArgs + checkDeps + ship/reroute/fullSend + delicate check +
    // refreshCanonSnapshotsAtPaths + buildPipelineState" down to just the
    // first three — meaningful on slow filesystems where the snapshot
    // refresh and state-validation reads dominate.
    //
    // CANON_DETACHED=1 is set by detachAndExit on the child's spawn env;
    // the parent (which is about to detach and exit) intentionally skips
    // this so we don't briefly have a heartbeat-with-parent-pid that gets
    // immediately cleaned up.
    const earlyHeartbeatTaskIds = cliArgs.taskIds;
    let heartbeatStarted = false;
    const earlyHeartbeatResolver = (id: string): string => {
        const repoRootStatusFile = path.join(REPO_ROOT, 'tasks', id, 'status.json');
        return path.dirname(cliArgs.ship && fs.existsSync(repoRootStatusFile)
            ? repoRootStatusFile
            : splitState.statusFileFor(id));
    };
    if (process.env.CANON_DETACHED === '1' && earlyHeartbeatTaskIds.length > 0) {
        bootHeartbeatWithHooks(earlyHeartbeatTaskIds, earlyHeartbeatResolver);
        heartbeatStarted = true;
    }

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
        return;
    }

    if (cliArgs.reroute) {
        rerouteFromHumanReview(cliArgs.taskIds);
    }

    const { taskIds } = cliArgs;
    if (cliArgs.fullSend) {
        enableFullSend(taskIds);
    }
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        if (status.full_send === true && status.delicate === true && !cliArgs.force) {
            die(`--full-send on delicate task '${taskId}' requires --force. Canon's full-model review chains still run on delicate tasks under full-send, but the combination is a high-commitment stance. Re-run with --force to acknowledge.`);
        }
    }
    refreshCanonSnapshotsAtPaths(taskIds.map(splitState.statusFileFor));
    const initialState = buildPipelineState(taskIds);

    const heartbeatDirResolver = (id: string): string => path.dirname(splitState.statusFileFor(id));

    // Detach AFTER all validation has surfaced any errors to the operator.
    // Once we detach, the parent exits and any later die() in the child only
    // hits the log file — operators wouldn't see it inline. shouldAutoDetach()
    // returns true when stdout is not a TTY AND CANON_NO_DETACH is not set
    // AND we aren't already the detached child. The detached child runs
    // setsid()'d into its own session so harness pgroup-kill (Claude Code
    // operator-session resume, SSH disconnect, etc.) cannot reach it.
    //
    // Only detach when entering the long-running phase loop. Synchronous
    // control modes stay foreground so the operator gets the exit status
    // they're waiting on:
    //   - --pr / --push / --reroute / --ship — one-shot operations,
    //     complete in seconds, operator wants the result inline.
    //   - --step — runs one phase then exits with a status that signals
    //     "phase advanced" (0) or "phase didn't advance / sub-agent
    //     failed" (1). Backgrounding would make scripts/operators see
    //     exit 0 from the parent before the phase actually ran, hiding
    //     the real result.
    //   - --expect <phase> — fail-fast guard that dies if current phase
    //     doesn't match. Detaching turns "fail fast" into "fail silently
    //     in the log," which is exactly the misuse this flag exists to
    //     prevent. (Codex PR #112 P2 finding.)
    //   - --dry-run — exits even earlier (line ~2451) so this branch is
    //     unreachable for it; kept in the predicate defensively.
    //
    // See scripts/run-task/detach.ts and docs/BACKLOG.md "Orchestrator dies
    // silently in background mode" for the failure-mode story.
    const isSynchronousMode =
        cliArgs.pr ||
        cliArgs.push ||
        cliArgs.reroute ||
        cliArgs.ship ||
        cliArgs.step ||
        cliArgs.expectPhase != null;
    if (!isSynchronousMode && shouldAutoDetach()) {
        detachAndExit({
            taskIds,
            resolveTaskDir: heartbeatDirResolver,
            argv: process.argv,
        });
    }

    // Start the heartbeat ticker. Every 30s the orchestrator writes
    // `<taskDir>/.heartbeat.json` so detectors (canon doctor, status-line
    // plugins) can distinguish "alive and working" from "killed by harness
    // session-resume / OOM / SIGKILL" within ~60–90s. The same hook setup
    // also handles `.canon-pid` cleanup on clean shutdown so a re-resume
    // doesn't see a stale pid pointing at a dead process. See
    // bootHeartbeatWithHooks above for the hooks-before-write ordering
    // invariant. Skipped if the detached-child early-start path above
    // already booted the heartbeat (we don't want to double-start).
    if (!heartbeatStarted) {
        bootHeartbeatWithHooks(taskIds, heartbeatDirResolver);
        heartbeatStarted = true;
    }

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

        // Store session IDs after each agent phase for resumption.
        // Sessions are stored per-cluster, not per-phase:
        //   spec/spec_revision  → claude_spec        (both run in REPO_ROOT, share continuity)
        //   code_review         → claude_review       (same worktree cwd across rounds)
        //   spec_review (Codex) → codex_spec_review   (REPO_ROOT; separate from implement)
        //   implement (Codex)   → codex               (worktree cwd)
        //   plan, qa            → not stored          (one-offs, always fresh)
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
                const codexSlot: SessionSlot = currentPhase === 'spec_review' ? 'codex_spec_review' : 'codex';
                splitState.storeSessionId(taskIds, codexSlot, lastCodexSessionId);
                splitCli.info(`Codex session stored (${codexSlot}): ${lastCodexSessionId.slice(0, 8)}...`);
            }
            await checkAndRoute(currentPhase, taskIds);
        }

        if (cliArgs.step) {
            const nextPhase = assertSamePhase(taskIds);
            splitCli.info('Step mode: stopping after one phase.');
            splitCli.info(`Next phase: ${nextPhase}`);
            // Exit non-zero if the phase didn't advance (artifact check reset it to pending,
            // or the sub-agent failed without calling canon task). This makes failures visible
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
