import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getClaudeConfig } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { taskDirFor } from '../state.js';
import { getActiveCwd } from '../worktree.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import { promptPlan } from '../prompts/index.js';
import { isTemplateUnfilled } from '../validation.js';
import { taskPhase } from '../../../src/task/index.js';

export async function runPlanPhase(
    state: PipelineState,
    interactive: boolean,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    info(`Phase: plan (Claude writes plan${state.isBundle ? 's' : ''})`);
    for (const t of tasks) taskPhase(t.taskId, 'plan', 'in_progress');
    const cfg = getClaudeConfig('plan', tasks);
    const activeCwd = getActiveCwd(taskIds);
    const result = await runClaude(promptPlan(state), interactive, null, cfg.model, cfg.effort, cfg.budget, {
        taskId: taskIds.join('+'),
        phase: 'plan',
        iteration: tasks[0].status.phases.plan?.iterations_current_loop
            ?? tasks[0].status.phases.plan?.iterations
            ?? 0,
        activeCwd,
    }, activeCwd);
    for (const t of tasks) {
        const planPath = path.join(taskDirFor(t.taskId), 'plan.md');
        let planContent: string | null = null;
        try { planContent = fs.readFileSync(planPath, 'utf8'); } catch { /* missing */ }
        if (isTemplateUnfilled(planContent)) {
            warn(`[${t.taskId}] plan.md is still the template after plan phase — sub-agent did not write it. Resetting to pending for retry.`);
            taskPhase(t.taskId, 'plan', 'pending');
        }
    }
    return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
}
