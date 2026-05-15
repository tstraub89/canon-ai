import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getBaseBranch, getScopedDiff, verifyBranch } from '../git.js';
import { getClaudeConfig, getMaxReviewLoops } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { runTaskShFor } from '../task-sh.js';
import { getActiveCwd, isWorktreeEnabled } from '../worktree.js';
import { autoBlockPhase, resolveTaskCwd, taskDirFor } from '../state.js';
import { isTemplateUnfilled, validateHandoff, verifyHandoffAgainstDiff } from '../validation.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import { promptCodeReview } from '../prompts/index.js';

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
    const codeReviewLoopCap = getMaxReviewLoops(tasks);
    if (maxIter >= codeReviewLoopCap) {
        const reason =
            `Code review hit ${maxIter} changes_requested iterations in a row ` +
            `(limit: ${codeReviewLoopCap}). Pipeline auto-blocked. Read ` +
            `tasks/<id>/review.md — if the same finding keeps recurring, the spec ` +
            `or approach may need revisiting rather than another implementation pass. ` +
            `To resume after fixing: set phases.code_review.status = "pending" and ` +
            `phases.code_review.iterations_current_loop = 0 in status.json, then re-run the pipeline.`;
        warn(reason);
        autoBlockPhase(taskIds, 'code_review', maxIter, reason);
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
            const reviewContent =
                `# Code Review: ${taskId}\n\n` +
                `## Validation Gate\n\n` +
                `**BLOCKED — pre-flight rejected handoff before full review:**\n\n` +
                perTaskSection +
                bundleSection +
                `\n` +
                `## Verdict\n\n- [x] **Changes requested** — fix the above and resubmit handoff.\n`;
            // Write rejection into the active worktree's tasks/<id>/ — taskDirFor is
            // not worktree-aware and would land in REPO_ROOT, where main.ts's later
            // worktree sync would clobber the BLOCKED reason. resolveTaskCwd routes
            // to the worktree when one is active.
            fs.writeFileSync(path.join(resolveTaskCwd(taskId), 'tasks', taskId, 'review.md'), reviewContent);
            runTaskShFor(taskId, 'phase', taskId, 'code_review', 'done', 'changes_requested');
        }
        return { agent: 'claude', sessionId: null, exitCode: 0 };
    }

    info(`Phase: code_review (Claude${state.isBundle ? ' bundle' : ''}, iteration ${maxIter + 1})`);
    for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'code_review', 'in_progress');
    if (isWorktreeEnabled(taskIds)) {
        const artifacts = ['spec.md', 'spec-review.md', 'plan.md', 'notes.md'];
        for (const taskId of taskIds) {
            const srcDir = taskDirFor(taskId);
            const dstDir = path.join(activeCwd, 'tasks', taskId);
            fs.mkdirSync(dstDir, { recursive: true });
            for (const file of artifacts) {
                const src = path.join(srcDir, file);
                const dst = path.join(dstDir, file);
                if (fs.existsSync(src)) {
                    try { fs.copyFileSync(src, dst); } catch { /* best-effort */ }
                }
            }
        }
        info('Synced task artifacts from main worktree into task worktree for review.');
    }

    const cfg = getClaudeConfig('code_review', tasks);
    const reviewResumeId = maxIter > 0 ? resumeId : null;
    const scopedDiff = getScopedDiff(baseBranch, activeCwd);
    const result = await runClaude(promptCodeReview(state, baseBranch, scopedDiff), interactive, reviewResumeId, cfg.model, cfg.effort, {
        taskId: taskIds.join('+'),
        phase: 'code_review',
        iteration: maxIter,
    }, activeCwd);

    for (const t of tasks) {
        // Read from the active cwd, not REPO_ROOT — Claude just wrote review.md
        // in the worktree (line 115-119 ran with getActiveCwd) and main.ts's
        // worktree sync hasn't happened yet. taskDirFor would resolve to
        // REPO_ROOT and read a stale (likely still-template) copy, falsely
        // resetting the phase to pending. Mirrors the BLOCKED-write path above.
        const reviewPath = path.join(resolveTaskCwd(t.taskId), 'tasks', t.taskId, 'review.md');
        let reviewContent: string | null = null;
        try { reviewContent = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing */ }
        if (isTemplateUnfilled(reviewContent)) {
            warn(`[${t.taskId}] review.md is still the template after code_review run — sub-agent did not write it. Resetting to pending for retry.`);
            runTaskShFor(t.taskId, 'phase', t.taskId, 'code_review', 'pending');
        }
    }

    return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
}
