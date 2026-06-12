import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getCodexConfig, getMaxReviewLoops, isPlanCombined } from '../policy.js';
import { runCodex } from '../agents/codex.js';
import { autoBlockPhase, resolveTaskCwd, taskDirFor, writeStatus } from '../state.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import { promptSpecReview } from '../prompts/index.js';
import { extractCheckedVerdict, isTemplateUnfilled } from '../validation.js';
import { getActiveCwd } from '../worktree.js';
import { taskPhase } from '../../../src/task/index.js';

export function autoBlockSpecReview(taskIds: string[], iterationCount: number, reason: string): void {
    autoBlockPhase(taskIds, 'spec_review', iterationCount, reason);
}

// The phase gate (checkPhaseGate) requires spec-review.md to carry a checked
// verdict matching the one being recorded. Fast tier skips Codex spec review —
// the human's conversational approval IS the verdict — so record it in the
// artifact before advancing, rather than bypassing the gate. No-op when the
// operator already recorded a verdict; a missing artifact is left for the
// gate to report.
function recordFastTierSpecApproval(taskId: string): void {
    const artifactPath = path.join(taskDirFor(taskId), 'spec-review.md');
    let content: string;
    try {
        content = fs.readFileSync(artifactPath, 'utf8');
    } catch {
        return;
    }
    if (extractCheckedVerdict(content)) return;
    const checked = content.replace(/^- \[ \] (\*\*Approved\*\*)/m, '- [x] $1');
    const note = '\n> Fast tier: Codex spec review skipped — human conversational spec approval recorded by the orchestrator.\n';
    fs.writeFileSync(
        artifactPath,
        (checked !== content
            ? checked
            : `${content}\n## Verdict\n\n- [x] **Approved** — fast tier human approval\n`) + note,
    );
}

export async function runSpecReviewPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    if (state.tier === 'fast') {
        const anyGateOn = tasks.some(t => t.status.human_spec_gate);
        const allFullSend = tasks.every(t => t.status.full_send === true);
        // Bundle gate skip is all-or-nothing: one normal task re-engages the
        // spec gate for the whole invocation.
        if (anyGateOn && !allFullSend) {
            for (const t of tasks) {
                if (t.status.human_spec_gate) {
                    t.status.human_spec_gate = false;
                    writeStatus(t.taskId, t.status);
                }
            }
            const specList = taskIds.map(id => `  tasks/${id}/spec.md`).join('\n');
            const planList = taskIds.map(id => `  tasks/${id}/plan.md`).join('\n');
            console.log('');
            console.log('════════════════════════════════════════════════════════');
            console.log(`  ✋  SPEC GATE — Review before Codex implements.`);
            console.log('');
            console.log('  Specs:');
            console.log(specList);
            console.log('  Plans:');
            console.log(planList);
            console.log('');
            console.log(`  When ready: canon run ${taskIds.join(' ')}`);
            console.log('════════════════════════════════════════════════════════');
            console.log('');
            process.exit(0);
        }
        info('Fast tier: auto-advancing spec_review and plan (written during spec phase).');
        for (const t of tasks) {
            recordFastTierSpecApproval(t.taskId);
            taskPhase(t.taskId, 'spec_review', 'done', 'approved');
            if (isPlanCombined(t.status)) {
                taskPhase(t.taskId, 'plan', 'done');
            }
        }
        return null;
    }

    const maxSpecIter = tasks.reduce(
        (max, t) => Math.max(
            max,
            t.status.phases.spec_review?.iterations_current_loop
                ?? t.status.phases.spec_review?.iterations
                ?? 0,
        ),
        0,
    );
    const specReviewLoopCap = getMaxReviewLoops(tasks);
    if (maxSpecIter >= specReviewLoopCap) {
        const reason =
            `Spec review hit ${maxSpecIter} changes_requested iterations in a row ` +
            `(limit: ${specReviewLoopCap}). Pipeline auto-blocked. A repeated ` +
            `pushback usually means the spec has a structural or scope issue that ` +
            `another mechanical revision won't fix — read the latest spec-review.md ` +
            `and decide whether to revise scope, split the task, or defer. To resume ` +
            `after fixing: set phases.spec_review.status = "pending" and ` +
            `phases.spec_review.iterations_current_loop = 0 in status.json, then re-run the pipeline.`;
        warn(reason);
        autoBlockSpecReview(taskIds, maxSpecIter, reason);
        process.exit(2);
    }

    info(`Phase: spec_review (Codex reviews spec${state.isBundle ? 's' : ''})`);
    for (const t of tasks) taskPhase(t.taskId, 'spec_review', 'in_progress');
    const isReReview = resumeId !== null;
    const specReviewPrompt = isReReview
        ? `The spec${state.isBundle ? 's have' : ' has'} been revised since your last review. Re-read the current spec.md ${state.isBundle ? 'files' : 'file'} from disk and produce a completely fresh review — do not replay or summarise your previous output.\n\n${promptSpecReview(state)}`
        : promptSpecReview(state);
    const cfg = getCodexConfig('spec_review', tasks);
    const activeCwd = getActiveCwd(taskIds);
    const result = await runCodex(specReviewPrompt, interactive, resumeId, cfg.model, cfg.effort, {
        taskId: taskIds.join('+'),
        phase: 'spec_review',
        iteration: maxSpecIter,
        activeCwd,
    }, activeCwd);

    // Mirror the post-run template check that code-review.ts and plan.ts
    // already run for their artifacts. Catches the failure mode where Codex
    // marks spec_review done but spec-review.md is still the unfilled
    // template (observed downstream on intel-001 in TokenAnxiety dogfood,
    // discussion #27). Reset to pending so the next run retries instead of
    // silently advancing on a stale phase pointer.
    for (const t of tasks) {
        const reviewPath = path.join(resolveTaskCwd(t.taskId), 'tasks', t.taskId, 'spec-review.md');
        let reviewContent: string | null = null;
        try { reviewContent = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing */ }
        if (isTemplateUnfilled(reviewContent)) {
            warn(`[${t.taskId}] spec-review.md is still the template after spec_review run — sub-agent did not write it. Resetting to pending for retry.`);
            taskPhase(t.taskId, 'spec_review', 'pending');
        }
    }

    return { agent: 'codex', sessionId: result.sessionId, exitCode: result.exitCode };
}
