import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getClaudeConfig } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { runTaskShFor } from '../task-sh.js';
import { extractDoneMdFromStdout, isDoneMdTemplate } from '../validation.js';
import { getActiveCwd } from '../worktree.js';
import { verifyBranch } from '../git.js';
import { readStatus, taskDirFor } from '../state.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import { promptQa } from '../prompts/index.js';

export async function runQaPhase(
    state: PipelineState,
    interactive: boolean,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    verifyBranch(taskIds);
    info(`Phase: qa (Claude writes QA${state.isBundle ? ' for bundle' : ''})`);
    for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'qa', 'in_progress');
    const cfg = getClaudeConfig('qa', tasks);
    const result = await runClaude(promptQa(state), interactive, null, cfg.model, cfg.effort, {
        taskId: taskIds.join('+'),
        phase: 'qa',
        iteration: tasks[0].status.phases.qa?.iterations_current_loop
            ?? tasks[0].status.phases.qa?.iterations
            ?? 0,
    }, getActiveCwd(taskIds));

    if (!state.isBundle && result.capturedStdout) {
        const taskId = taskIds[0];
        const donePath = path.join(taskDirFor(taskId), 'done.md');
        if (isDoneMdTemplate(donePath)) {
            const salvaged = extractDoneMdFromStdout(result.capturedStdout);
            if (salvaged) {
                fs.writeFileSync(donePath, salvaged);
                warn(`Salvaged tasks/${taskId}/done.md from captured stdout — QA sub-agent streamed content instead of using the Write tool.`);
                const phaseStatus = readStatus(taskId).phases.qa?.status ?? 'pending';
                if (phaseStatus !== 'done') {
                    runTaskShFor(taskId, 'phase', taskId, 'qa', 'done');
                    warn(`Also advanced qa → done for ${taskId} (sub-agent skipped task.sh).`);
                }
            }
        }
    }

    return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
}
