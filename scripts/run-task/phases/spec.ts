import { info } from '../cli.js';
import { getClaudeConfig } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { runTaskShFor } from '../task-sh.js';
import { promptSpec, promptSpecRevision } from '../prompts/index.js';
import type { PipelineState, PhaseRunResult } from '../types.js';

export async function runSpecPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    const hasChangesRequested = tasks.some(t => t.specReviewVerdict === 'changes_requested');
    if (hasChangesRequested) {
        info('Phase: spec (Claude revises specs after review feedback)');
        for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'spec', 'in_progress');
        const cfg = getClaudeConfig('spec', tasks);
        const result = await runClaude(promptSpecRevision(state), interactive, resumeId, cfg.model, cfg.effort, {
            taskId: taskIds.join('+'),
            phase: 'spec',
            iteration: tasks[0].status.phases.spec?.iterations,
        });
        return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
    }

    const label = state.tier === 'fast' ? 'spec+plan' : 'spec';
    info(`Phase: spec (Claude writes ${label}${state.isBundle ? ' for bundle' : ''})`);
    for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'spec', 'in_progress');
    const cfg = getClaudeConfig('spec', tasks);
    const result = await runClaude(promptSpec(state), interactive, null, cfg.model, cfg.effort, {
        taskId: taskIds.join('+'),
        phase: 'spec',
        iteration: tasks[0].status.phases.spec?.iterations,
    });
    return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
}
