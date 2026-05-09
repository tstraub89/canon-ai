import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getClaudeConfig } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { runTaskShFor } from '../task-sh.js';
import { taskDirFor } from '../state.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import { promptPlan } from '../prompts/index.js';

function isTemplateUnfilled(content: string | null): boolean {
    if (content === null) return true;
    return content.includes('[TASK-ID]');
}

export async function runPlanPhase(
    state: PipelineState,
    interactive: boolean,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    info(`Phase: plan (Claude writes plan${state.isBundle ? 's' : ''})`);
    for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'plan', 'in_progress');
    const cfg = getClaudeConfig('plan', tasks);
    const result = await runClaude(promptPlan(state), interactive, null, cfg.model, cfg.effort, {
        taskId: taskIds.join('+'),
        phase: 'plan',
        iteration: tasks[0].status.phases.plan?.iterations,
    });
    for (const t of tasks) {
        const planPath = path.join(taskDirFor(t.taskId), 'plan.md');
        let planContent: string | null = null;
        try { planContent = fs.readFileSync(planPath, 'utf8'); } catch { /* missing */ }
        if (isTemplateUnfilled(planContent)) {
            warn(`[${t.taskId}] plan.md is still the template after plan phase — sub-agent did not write it. Resetting to pending for retry.`);
            runTaskShFor(t.taskId, 'phase', t.taskId, 'plan', 'pending');
        }
    }
    return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
}
