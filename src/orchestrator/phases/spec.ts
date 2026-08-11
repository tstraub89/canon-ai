import { info, warn } from '../cli.js';
import { getClaudeConfig, getMaxReviewLoops } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { taskPhase } from '../../task/index.js';
import { promptSpec, promptSpecRevision } from '../prompts/index.js';
import { getActiveCwd } from '../worktree.js';
import { autoBlockPhase } from '../state.js';
import { evaluateSpecReviewLoop } from '../review-loop.js';
import type { PipelineState, PhaseRunResult } from '../types.js';

export async function runSpecPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    // Gated on count > 0 so MAX_REVIEW_LOOPS=0 (a valid, tested "no retries"
    // override — tests/pipeline-policy.test.ts) still lets the very first
    // spec write run. count >= cap alone would also trip at count=0,
    // turning "zero retries after review requests changes" into "zero spec
    // writes, ever" — the mirror of a real Codex PR finding on the
    // implement-side checkpoint. The retained review-entry backstop in
    // spec-review.ts is unaffected and keeps blocking the first review
    // round for cap=0, matching pre-relocation behavior.
    const specReviewCheck = evaluateSpecReviewLoop(tasks, getMaxReviewLoops(tasks));
    if (specReviewCheck.count > 0 && specReviewCheck.blocked) {
        warn(specReviewCheck.reason);
        autoBlockPhase(taskIds, 'spec_review', specReviewCheck.count, specReviewCheck.reason);
        process.exit(2);
    }

    const hasChangesRequested = tasks.some(t => t.specReviewVerdict === 'changes_requested');
    if (hasChangesRequested) {
        info('Phase: spec (Claude revises specs after review feedback)');
        for (const t of tasks) taskPhase(t.taskId, 'spec', 'in_progress');
        const cfg = getClaudeConfig('spec', tasks);
        const activeCwd = getActiveCwd(taskIds);
        const result = await runClaude(promptSpecRevision(state), interactive, resumeId, cfg.model, cfg.effort, cfg.budget, {
            taskId: taskIds.join('+'),
            phase: 'spec',
            iteration: tasks[0].status.phases.spec?.iterations_current_loop
                ?? tasks[0].status.phases.spec?.iterations
                ?? 0,
            activeCwd,
        });
        return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
    }

    const label = state.tier === 'fast' ? 'spec+plan' : 'spec';
    info(`Phase: spec (Claude writes ${label}${state.isBundle ? ' for bundle' : ''})`);
    for (const t of tasks) taskPhase(t.taskId, 'spec', 'in_progress');
    const cfg = getClaudeConfig('spec', tasks);
    const activeCwd = getActiveCwd(taskIds);
    const result = await runClaude(promptSpec(state), interactive, null, cfg.model, cfg.effort, cfg.budget, {
        taskId: taskIds.join('+'),
        phase: 'spec',
        iteration: tasks[0].status.phases.spec?.iterations_current_loop
            ?? tasks[0].status.phases.spec?.iterations
            ?? 0,
        activeCwd,
    });
    return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
}
