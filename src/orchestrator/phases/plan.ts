import { lintSpecManifestForTasks, manifestPreflightMessage } from '../validation.js';
import { roleAssignmentFor } from '../policy.js';
import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { agentBackendFor } from '../agents/backend.js';
import { autoBlockPhase, taskDirFor } from '../state.js';
import { getActiveCwd } from '../worktree.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import { promptPlan } from '../prompts/index.js';
import { isTemplateUnfilled } from '../validation.js';
import { taskPhase } from '../../task/index.js';

export async function runPlanPhase(
    state: PipelineState,
    interactive: boolean,
    force = false,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    const manifestFailures = lintSpecManifestForTasks(taskIds);
    if (manifestFailures.length > 0) {
        const message = manifestPreflightMessage(manifestFailures, 'plan', force, taskIds);
        warn(message);
        if (!force) {
            autoBlockPhase(taskIds, 'plan', 0, message);
            process.exit(2);
        }
    }


    info(`Phase: plan (Claude writes plan${state.isBundle ? 's' : ''})`);
    for (const t of tasks) taskPhase(t.taskId, 'plan', 'in_progress');
    const backend = agentBackendFor('author', roleAssignmentFor(state.provider));
    const activeCwd = getActiveCwd(taskIds);
    const result = await backend.run({ role: 'author', phase: 'plan', tasks, prompt: promptPlan(state), interactive: interactive, resumeId: null, metricsContext: {
        taskId: taskIds.join('+'),
        phase: 'plan',
        iteration: tasks[0].status.phases.plan?.iterations_current_loop
            ?? tasks[0].status.phases.plan?.iterations
            ?? 0,
        activeCwd,
    }, cwd: activeCwd });
    for (const t of tasks) {
        const planPath = path.join(taskDirFor(t.taskId), 'plan.md');
        let planContent: string | null = null;
        try { planContent = fs.readFileSync(planPath, 'utf8'); } catch { /* missing */ }
        if (isTemplateUnfilled(planContent)) {
            warn(`[${t.taskId}] plan.md is still the template after plan phase — sub-agent did not write it. Resetting to pending for retry.`);
            taskPhase(t.taskId, 'plan', 'pending');
        }
    }
    return { agent: result.backend, sessionId: result.sessionId, exitCode: result.exitCode };
}
