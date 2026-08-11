import { info, warn } from '../cli.js';
import { getCodexConfig, getMaxReviewLoops } from '../policy.js';
import { runCodex } from '../agents/codex.js';
import { promptImplement, promptImplementResume, promptImplementReroute, promptImplementRevisions } from '../prompts/index.js';
import { commitTaskArtifactsToBase, getAffectedFiles, getBaseBranch, gitSafeAtRaw, parsePorcelain, ensureBranch } from '../git.js';
import { getActiveCwd, TASK_ARTIFACT_FILES } from '../worktree.js';
import { autoBlockPhase, readStatus, writeStatus } from '../state.js';
import { evaluateCodeReviewLoop } from '../review-loop.js';
import type { PipelineState, PhaseRunResult, TaskContext } from '../types.js';
import { taskPhase } from '../../task/index.js';

export function shouldUseImplementRevision(
    tasks: readonly Pick<TaskContext, 'iterations_current_loop' | 'status'>[],
): boolean {
    // Pre-flight rejection routes back to implement but leaves
    // `iterations_current_loop` at 0 (the pre-flight isn't a Claude review
    // round — see taskPhasePreflightRejected). Without also checking the
    // pre-flight counter here, the next implement pass would receive the
    // initial-pass prompt instead of the revision prompt, and Codex would
    // not be told to read the rejected review.md / address its findings
    // (Codex P1 on the prior iteration of the pre-flight-rejection fix).
    return tasks.some(t => {
        const preflightCount = t.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
        return t.iterations_current_loop > 0 || preflightCount > 0;
    });
}

export async function runImplementPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
    force = false,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    // Gated on count > 0 so MAX_REVIEW_LOOPS=0 (a valid, tested "no retries"
    // override — tests/pipeline-policy.test.ts) still lets the very first
    // implementation run. count >= cap alone would also trip at count=0,
    // turning "zero retries after review requests changes" into "zero
    // implementation, ever" — a real Codex PR finding on this task
    // (src/orchestrator/phases/implement.ts). The retained review-entry
    // backstop in code-review.ts is unaffected and keeps blocking the
    // first review round for cap=0, matching pre-relocation behavior.
    const codeReviewCheck = evaluateCodeReviewLoop(tasks, getMaxReviewLoops(tasks));
    if (codeReviewCheck.count > 0 && codeReviewCheck.blocked) {
        warn(codeReviewCheck.reason);
        autoBlockPhase(taskIds, 'code_review', codeReviewCheck.count, codeReviewCheck.reason);
        process.exit(2);
    }

    // Only commit task artifacts to base on the FIRST implement-phase call.
    // On the first call the worktree doesn't exist yet, and the commit puts
    // the scaffold onto base so the new worktree inherits it via branch
    // creation in `ensureBranch`. On subsequent calls (reroutes,
    // code-review-driven iteration cycles) the worktree already exists, and
    // re-committing the latest REPO_ROOT snapshot to base creates divergent
    // commits that fight with the task branch's evolved state at PR-merge
    // time. Worktree-mode tasks with a recorded branch are post-first-implement;
    // skip the commit. Legacy worktree:false tasks always run it.
    const primaryStatus = readStatus(taskIds[0]);
    const worktreeAlreadyCreated = primaryStatus.worktree === true && Boolean(primaryStatus.branch);
    if (!worktreeAlreadyCreated) {
        commitTaskArtifactsToBase(taskIds, TASK_ARTIFACT_FILES);
        const scaffoldBase = getBaseBranch(taskIds);
        info(
            `Scaffold committed to local ${scaffoldBase}; run ` +
            `\`git push origin ${scaffoldBase}\` to keep origin in sync and avoid base-divergence at --push/--pr/--ship.`,
        );
    }
    ensureBranch(taskIds, { force });

    const activeCwd = getActiveCwd(taskIds);
    const baseBranch = getBaseBranch(taskIds);
    const affectedFiles = getAffectedFiles(baseBranch, activeCwd);
    const isRevision = shouldUseImplementRevision(tasks);
    const isRerouted = tasks.some(t => t.status.phases.implement?.rerouted === true);
    const wasImplementInProgress = tasks.some(t => t.status.phases.implement?.status === 'in_progress');
    const phaseLabel = isRevision ? ', revision' : isRerouted ? ', reroute (spec amended)' : '';
    info(`Phase: implement (Codex${state.isBundle ? ' bundle' : ''}${phaseLabel})`);
    for (const t of tasks) taskPhase(t.taskId, 'implement', 'in_progress');

    const codexCfg = getCodexConfig('implement', tasks);
    const isResume = resumeId !== null && !isRevision && !isRerouted && wasImplementInProgress;
    // Only pass a resumeId when we're deliberately continuing an implement session.
    // A stored codex session from spec_review (full-tier tasks) must not bleed into
    // implement: that session's project root is REPO_ROOT, not the worktree, so Codex
    // file ops would land in the wrong tree.
    const shouldResume = isRevision || isRerouted || isResume;
    const implementPrompt = isRevision
        ? promptImplementRevisions(state, affectedFiles, baseBranch)
        : isRerouted
            ? promptImplementReroute(state, resumeId !== null, affectedFiles, baseBranch)
            : isResume
                ? promptImplementResume(state)
                : promptImplement(state, 'fresh', affectedFiles, baseBranch);
    const result = await runCodex(
        implementPrompt,
        interactive,
        shouldResume ? resumeId : null,
        codexCfg.model,
        codexCfg.effort,
        {
            taskId: taskIds.join('+'),
            phase: 'implement',
            iteration: tasks[0].iterations_current_loop,
            activeCwd,
        },
        activeCwd,
        /* wrapForResume */ !isRerouted,
    );

    if (isRevision) {
        const dirtyResult = gitSafeAtRaw(activeCwd, 'status', '--porcelain=v1', '-uall');
        const meaningfulChanges = dirtyResult.ok
            ? [...parsePorcelain(dirtyResult.stdout)].filter(f => {
                if (!f.startsWith('tasks/')) return true;
                if (f.endsWith('/handoff.md')) return true;
                if (f.endsWith('/notes.md')) return true;
                return false;
            })
            : ['<git-status-failed>'];
        if (dirtyResult.ok && meaningfulChanges.length === 0) {
            warn('');
            warn('⚠️  Codex revision iteration produced no source-file changes.');
            warn('    This is the resumed-session hallucination signature: Codex believed');
            warn('    the work was already done from a prior round and skipped re-editing.');
            warn('    Dropping the stored Codex session so the next run starts fresh.');
            warn('');
            for (const taskId of taskIds) {
                const s = readStatus(taskId);
                if (s.sessions) {
                    delete s.sessions.codex;
                    writeStatus(taskId, s);
                }
            }
            autoBlockPhase(taskIds, 'implement', tasks[0].iterations_current_loop + 1,
                'Revision iteration produced no source-file diff — Codex resumed-session hallucination signature. Stored session cleared. Re-run pipeline for a fresh attempt, or apply the fix inline.');
            process.exit(2);
        }
    }

    return { agent: 'codex', sessionId: result.sessionId, exitCode: result.exitCode };
}
