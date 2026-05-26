import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getBaseBranch, getScopedDiff, verifyBranch } from '../git.js';
import { getClaudeConfig, getMaxReviewLoops } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { getActiveCwd } from '../worktree.js';
import { autoBlockPhase, taskDirFor } from '../state.js';
import { isTemplateUnfilled, validateHandoff, verifyHandoffAgainstDiff } from '../validation.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import { promptCodeReview } from '../prompts/index.js';
import { taskPhase, taskPhasePreflightRejected } from '../../../src/task/index.js';

export async function runCodeReviewPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    verifyBranch(taskIds);
    const baseBranch = getBaseBranch(taskIds);
    const activeCwd = getActiveCwd(taskIds);
    const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations_current_loop), 0);
    // Pre-flight rejections are tracked separately from review iterations
    // (they're not Claude rounds) but still need to count toward the loop
    // cap — otherwise persistent handoff-format failures could bounce
    // implement→pre-flight→implement forever without ever tripping the
    // safeguard. Compute combined attempts PER TASK then take the max —
    // computing max-iter and max-preflight separately and summing would
    // mix counters from different tasks in a bundle and over-block
    // healthy bundles (Codex P2 on the prior iteration).
    const perTaskCombined = tasks.map(t => {
        const preflight = t.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
        return {
            taskId: t.taskId,
            real: t.iterations_current_loop,
            preflight,
            combined: t.iterations_current_loop + preflight,
        };
    });
    const worstTask = perTaskCombined.reduce((worst, curr) => curr.combined > worst.combined ? curr : worst, perTaskCombined[0]);
    const codeReviewLoopCap = getMaxReviewLoops(tasks);
    if (worstTask.combined >= codeReviewLoopCap) {
        const reason =
            `Code review hit ${worstTask.combined} attempts in a row for task ${worstTask.taskId} ` +
            `(${worstTask.real} reviewer rounds + ${worstTask.preflight} pre-flight rejections; limit: ${codeReviewLoopCap}). ` +
            `Pipeline auto-blocked. Read tasks/<id>/review.md — if the same finding ` +
            `keeps recurring, the spec or approach may need revisiting rather than ` +
            `another implementation pass. If repeated failures were all pre-flight, ` +
            `the handoff format itself may be wrong (e.g., Validation Outcomes rows ` +
            `using prose labels instead of backticked check keys). To resume after ` +
            `fixing: set phases.code_review.status = "pending", ` +
            `phases.code_review.iterations_current_loop = 0, and ` +
            `phases.code_review.preflight_rejections_current_loop = 0 in status.json, ` +
            `then re-run the pipeline.`;
        warn(reason);
        autoBlockPhase(taskIds, 'code_review', worstTask.combined, reason);
        process.exit(2);
    }

    // Pre-flight: reject obviously invalid handoffs without spending a Claude session.
    // Catches Fail validation results and missing AC Coverage tables deterministically.
    const preflightFailed: Array<{ taskId: string; issues: string[]; bundleIssues?: string[] }> = [];
    for (const t of tasks) {
        const issues = validateHandoff(t.taskId);
        if (issues.length > 0) preflightFailed.push({ taskId: t.taskId, issues });
    }
    const bundleIssues = verifyHandoffAgainstDiff(taskIds, baseBranch);
    if (bundleIssues.length > 0) {
        for (const taskId of taskIds) {
            const existing = preflightFailed.find(entry => entry.taskId === taskId);
            if (existing) {
                existing.bundleIssues = bundleIssues;
            } else {
                preflightFailed.push({ taskId, issues: [], bundleIssues });
            }
        }
    }
    if (preflightFailed.length > 0) {
        warn('Validation pre-flight FAILED — rejecting handoff without Claude review:');
        for (const { taskId, issues, bundleIssues: taskBundleIssues } of preflightFailed) {
            for (const issue of issues) warn(`  [${taskId}] ${issue}`);
            if (taskBundleIssues) {
                for (const issue of taskBundleIssues) warn(`  [bundle:${taskId}] ${issue}`);
            }
            const perTaskSection = issues.length > 0
                ? `${issues.map(i => `- ${i}`).join('\n')}\n`
                : '';
            const bundleSection = taskBundleIssues && taskBundleIssues.length > 0
                ? `\n### Bundle-Level Handoff Verification\n\n` +
                  `${taskBundleIssues.map(i => `- ${i}`).join('\n')}\n`
                : '';
            const blockedBlock =
                `## Validation Gate\n\n` +
                `**BLOCKED — pre-flight rejected handoff before full review:**\n\n` +
                perTaskSection +
                bundleSection +
                `\n` +
                `## Verdict\n\n- [x] **Changes requested** — fix the above and resubmit handoff.\n`;
            // taskDirFor honors CANON_TASKS_DIR_OVERRIDE; required to keep the
            // pre-flight write path consistent with bundleHasRealPriorReview's
            // read path in prompts/index.ts. Otherwise, in test mode (override set),
            // pre-flight writes to one location and the detector reads from
            // another — Codex P2 finding on the prior iteration of this fix.
            const reviewPath = path.join(taskDirFor(taskId), 'review.md');
            // Append-not-overwrite: prior real review rounds (with Stage 1 AC
            // tables and findings) must be preserved. The pre-flight rejection
            // was previously stomping every review.md unconditionally, which
            // destroyed evidence on tasks that hit a pre-flight rejection on
            // round 2+ AFTER a real round 1. Read existing content; if it's
            // a real prior review (contains a `## Stage 1` section), append
            // the BLOCKED block as a new `## Round N — Pre-flight rejected`
            // section so the history survives.
            let existing = '';
            try { existing = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing — first run */ }
            const hasPriorRealReview =
                existing.length > 0 && !isTemplateUnfilled(existing) && /^## Stage 1\b/m.test(existing);
            // Heading deliberately does NOT start with `## Round` so
            // `extractCheckedVerdict` continues to parse the verdict from the
            // latest REAL `## Round N` section above this block. If we used
            // `## Round`, the parser would treat this BLOCKED stub as the
            // latest round and return its `Changes requested` checkbox —
            // breaking manual `canon task phase code_review done <verdict>`
            // recovery against the real prior verdict (Codex P1 finding on
            // the prior iteration).
            const reviewContent = hasPriorRealReview
                ? `${existing.replace(/\s*$/, '')}\n\n---\n\n## Pre-Flight Rejection — handoff rejected before review (no Claude session ran)\n\n${blockedBlock}`
                : `# Code Review: ${taskId}\n\n${blockedBlock}`;
            fs.writeFileSync(reviewPath, reviewContent);
            // Pre-flight rejection: orchestrator-side handoff validation, not a
            // reviewer round. Use the dedicated helper that bumps
            // changes_requested_total only — counting this as an iteration
            // would cause the next code_review run to receive the round-N
            // prompt, which skips Stage 1 (AC table) under the assumption that
            // round 1 was a real review. See taskPhasePreflightRejected docstring.
            taskPhasePreflightRejected(taskId, 'code_review');
        }
        return { agent: 'claude', sessionId: null, exitCode: 0 };
    }

    info(`Phase: code_review (Claude${state.isBundle ? ' bundle' : ''}, iteration ${maxIter + 1})`);
    for (const t of tasks) taskPhase(t.taskId, 'code_review', 'in_progress');

    const cfg = getClaudeConfig('code_review', tasks);
    const reviewResumeId = maxIter > 0 ? resumeId : null;
    const scopedDiff = getScopedDiff(baseBranch, activeCwd);
    const result = await runClaude(promptCodeReview(state, baseBranch, scopedDiff), interactive, reviewResumeId, cfg.model, cfg.effort, {
        taskId: taskIds.join('+'),
        phase: 'code_review',
        iteration: maxIter,
        activeCwd,
    }, activeCwd);

    for (const t of tasks) {
        // Read from the same active task directory that Claude just wrote.
        const reviewPath = path.join(taskDirFor(t.taskId), 'review.md');
        let reviewContent: string | null = null;
        try { reviewContent = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing */ }
        if (isTemplateUnfilled(reviewContent)) {
            warn(`[${t.taskId}] review.md is still the template after code_review run — sub-agent did not write it. Resetting to pending for retry.`);
            taskPhase(t.taskId, 'code_review', 'pending');
        }
    }

    return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
}
