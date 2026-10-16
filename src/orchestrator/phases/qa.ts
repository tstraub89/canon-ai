import { requireDocsFreshnessConfig, resolveDocsFreshness } from '../docs-freshness.js';
import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getClaudeConfig } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { extractDoneMdFromStdout, isDoneMdTemplate } from '../validation.js';
import { getActiveCwd } from '../worktree.js';
import { getBaseBranch, getAffectedFiles, verifyBranch } from '../git.js';
import { readStatus } from '../state.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import { promptQa, type QaDocsFreshnessPrompt } from '../prompts/index.js';
import { taskPhase } from '../../task/index.js';

export function resolveQaDocsFreshness(taskIds: string[], activeCwd: string,
    deps = { getBaseBranch, getAffectedFiles }): QaDocsFreshnessPrompt {
    const config = requireDocsFreshnessConfig(activeCwd);
    const base = deps.getBaseBranch(taskIds);
    const affected = deps.getAffectedFiles(base, activeCwd);
    const sets = resolveDocsFreshness(config, affected.ok ? affected.files : null);
    if (!affected.ok) warn(`Docs freshness: could not compute the task diff vs ${base} (${affected.stderr || 'unknown error'}); the QA prompt lists protected docs only. Mapped docs not evaluated: ${sets.unevaluatedMappedDocs.join(', ') || 'none'}.`);
    return { editable: sets.promptEditable, flagged: sets.promptFlagged };
}

export async function runQaPhase(
    state: PipelineState,
    interactive: boolean,
    resolvedPrTemplate?: string | null,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    verifyBranch(taskIds);
    info(`Phase: qa (Claude writes QA${state.isBundle ? ' for bundle' : ''})`);
    for (const t of tasks) taskPhase(t.taskId, 'qa', 'in_progress');
    const cfg = getClaudeConfig('qa', tasks);
    const activeCwd = getActiveCwd(taskIds);
    const result = await runClaude(promptQa(state, resolvedPrTemplate, resolveQaDocsFreshness(taskIds, activeCwd)), interactive, null, cfg.model, cfg.effort, cfg.budget, {
        taskId: taskIds.join('+'),
        phase: 'qa',
        iteration: tasks[0].status.phases.qa?.iterations_current_loop
            ?? tasks[0].status.phases.qa?.iterations
            ?? 0,
        activeCwd,
    }, activeCwd);

    if (!state.isBundle && result.capturedStdout) {
        const taskId = taskIds[0];
        // Use the active cwd so the salvage write lands in the same tree Claude wrote to.
        const donePath = path.join(activeCwd, 'tasks', taskId, 'done.md');
        if (isDoneMdTemplate(donePath)) {
            const salvaged = extractDoneMdFromStdout(result.capturedStdout);
            if (salvaged) {
                fs.writeFileSync(donePath, salvaged);
                warn(`Salvaged tasks/${taskId}/done.md from captured stdout — QA sub-agent streamed content instead of using the Write tool.`);
                const phaseStatus = readStatus(taskId).phases.qa?.status ?? 'pending';
                if (phaseStatus !== 'done') {
                    taskPhase(taskId, 'qa', 'done');
                    warn(`Also advanced qa → done for ${taskId} (sub-agent skipped canon task).`);
                }
            }
        }
    }

    return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
}
