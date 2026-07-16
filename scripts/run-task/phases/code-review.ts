import fs from 'node:fs';
import path from 'node:path';

import { info, setExitReason, warn } from '../cli.js';
import { getAffectedFiles, getBaseBranch, getScopedDiff, verifyBranch } from '../git.js';
import { getClaudeConfig, getCodexConfig, getMaxReviewLoops } from '../policy.js';
import { runClaude } from '../agents/claude.js';
import { runColdCodexReview } from '../agents/codex.js';
import { getActiveCwd } from '../worktree.js';
import { autoBlockPhase, taskDirFor } from '../state.js';
import { classifyPreflightBlockers, isTemplateUnfilled, verifyHandoffAgainstDiff } from '../validation.js';
import type { ClassifiedBlocker } from '../validation.js';
import type { PipelineState, PhaseRunResult, TaskContext } from '../types.js';
import { promptCodeReview } from '../prompts/index.js';
import { taskPhase, taskPhasePreflightRejected } from '../../../src/task/index.js';

export type PreflightRoute = 'implement' | 'auto_block';

export type PreflightFailure = {
    taskId: string;
    classified: ClassifiedBlocker[];
};

export type CodeReviewPhaseDeps = {
    verifyBranch: typeof verifyBranch;
    getBaseBranch: typeof getBaseBranch;
    getActiveCwd: typeof getActiveCwd;
    getAffectedFiles: typeof getAffectedFiles;
    verifyHandoffAgainstDiff: typeof verifyHandoffAgainstDiff;
    getScopedDiff: typeof getScopedDiff;
    getClaudeConfig: typeof getClaudeConfig;
    getMaxReviewLoops: typeof getMaxReviewLoops;
    getCodexConfig: typeof getCodexConfig;
    runColdCodexReview: typeof runColdCodexReview;
    runClaude: typeof runClaude;
};

const defaultDeps: CodeReviewPhaseDeps = {
    verifyBranch,
    getBaseBranch,
    getActiveCwd,
    getAffectedFiles,
    verifyHandoffAgainstDiff,
    getScopedDiff,
    getClaudeConfig,
    getMaxReviewLoops,
    getCodexConfig,
    runColdCodexReview,
    runClaude,
};

export function determinePreflightRoute(failures: readonly PreflightFailure[]): PreflightRoute {
    const allClassified = failures.flatMap(failure => failure.classified);
    const hasFixable = allClassified.some(blocker => blocker.bucket === 'format' || blocker.bucket === 'regression');
    return hasFixable ? 'implement' : 'auto_block';
}

function bullets(issues: readonly ClassifiedBlocker[]): string {
    return issues.map(issue => `- ${issue.message}`).join('\n');
}

export function buildPreflightReviewBlock(classified: readonly ClassifiedBlocker[], route: PreflightRoute): string {
    const formatIssues = classified.filter(issue => issue.bucket === 'format');
    const regressionIssues = classified.filter(issue => issue.bucket === 'regression');
    const blockedIssues = classified.filter(issue => issue.bucket === 'blocked');
    const sections: string[] = [
        '## Validation Gate',
        '',
        '## Pre-Flight Rejection',
        '',
    ];

    if (route === 'auto_block') {
        sections.push(
            '**HALTED — infrastructure unavailable before full review:**',
            '',
            '### Human triage required',
            '',
            bullets(blockedIssues),
            '',
            'Infrastructure was unavailable, so the required check status is unknown. Re-implementing cannot resolve this. Triage the infrastructure, update the Validation Outcomes rows once the checks can run, reset `phases.code_review.status` to `pending`, and re-run the pipeline.',
        );
        return `${sections.join('\n')}\n`;
    }

    sections.push('**BLOCKED — pre-flight rejected before full review:**', '');
    if (formatIssues.length > 0) {
        sections.push(
            '### Fix the handoff',
            '',
            bullets(formatIssues),
            '',
            'Fix the handoff structure called out above, then resubmit.',
            '',
        );
    }
    if (regressionIssues.length > 0) {
        sections.push(
            '### Fix the code',
            '',
            bullets(regressionIssues),
            '',
            'You broke one or more required checks. Fix the regression, re-run the failing check, and update the Validation Outcomes row. Use `Fail – unrelated` only when the failure is genuinely outside your changed files and the Notes cite a specific file/line reference outside your diff.',
            '',
        );
    }
    if (blockedIssues.length > 0) {
        sections.push(
            '### Infra note (address the above first)',
            '',
            bullets(blockedIssues),
            '',
            'Address the fixable items above first; blocked rows will be re-evaluated on the next pre-flight.',
            '',
        );
    }
    sections.push(
        '## Verdict',
        '',
        '- [x] **Changes requested** — address the items above and resubmit.',
    );
    return `${sections.join('\n')}\n`;
}

function siblingBullets(siblingTaskIds: readonly string[]): string {
    return siblingTaskIds.map(taskId => `- \`${taskId}\` — see \`tasks/${taskId}/review.md\``).join('\n');
}

export function buildCleanTaskReviewStub(
    taskId: string,
    siblingTaskIds: readonly string[],
    route: PreflightRoute,
    appendHeadingN: number | null,
): string {
    const siblings = siblingBullets(siblingTaskIds);
    if (route === 'auto_block') {
        const heading = appendHeadingN === null
            ? '## Bundle Pre-Flight Halt'
            : `## Bundle Pre-Flight Halt (round ${appendHeadingN}) — sibling infrastructure unavailable`;
        const sections = [
            ...(appendHeadingN === null ? [`# Code Review: ${taskId}`, ''] : []),
            heading,
            '',
            'This task is part of a bundle whose handoff pre-flight found only infrastructure-blocked validation rows. The required checks could not run, so no Claude review ran and re-implementation cannot resolve it.',
            '',
            'This task itself had no per-task pre-flight findings — the halt was triggered by sibling task(s) in the bundle:',
            '',
            siblings,
            '',
            'Human triage required: restore the infrastructure, update the affected sibling\'s `handoff.md` Validation Outcomes rows, set `phases.code_review.status = "pending"` for all bundle tasks, and re-run the pipeline.',
        ];
        return `${sections.join('\n')}\n`;
    }

    const heading = appendHeadingN === null
        ? '## Bundle Pre-Flight Rejection'
        : `## Bundle Pre-Flight Rejection (round ${appendHeadingN}) — sibling task(s) failed`;
    const sections = [
        ...(appendHeadingN === null ? [`# Code Review: ${taskId}`, ''] : []),
        heading,
        '',
        'This task is part of a bundle whose handoff failed orchestrator pre-flight validation. No Claude review ran for the bundle.',
        '',
        'This task itself had no per-task pre-flight findings — the rejection was triggered by sibling task(s) in the bundle:',
        '',
        siblings,
    ];

    if (appendHeadingN === null) {
        sections.push(
            '',
            '## Verdict',
            '',
            '- [x] **Changes requested** — fix the sibling task(s) above and resubmit handoff.',
        );
    }

    return `${sections.join('\n')}\n`;
}

export function writePreflightReviewArtifacts(
    tasks: readonly Pick<TaskContext, 'taskId' | 'status'>[],
    preflightFailed: readonly PreflightFailure[],
    route: PreflightRoute,
): boolean {
    if (preflightFailed.length === 0) return false;

    const failuresByTask = new Map(preflightFailed.map(failure => [failure.taskId, failure]));
    const siblingTaskIds = preflightFailed.map(failure => failure.taskId);
    for (const t of tasks) {
        // taskDirFor honors CANON_TASKS_DIR_OVERRIDE; required to keep the
        // pre-flight write path consistent with bundleHasRealPriorReview's
        // read path in prompts/index.ts.
        const reviewPath = path.join(taskDirFor(t.taskId), 'review.md');
        let existing = '';
        try { existing = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing — first run */ }
        // Accept H2 Stage 1 (template-fill path) or H3 Stage 1 only when a real
        // ## Round N section (digit, not the comment scaffold's literal "Round N") exists.
        const hasH2Stage1 = /^## Stage 1\b/m.test(existing);
        const hasNestedStage1 = /^## Round \d+\b/m.test(existing) && /^### Stage 1\b/m.test(existing);
        const hasPriorRealReview =
            existing.length > 0 && !isTemplateUnfilled(existing) && (hasH2Stage1 || hasNestedStage1);

        const failure = failuresByTask.get(t.taskId);
        if (failure) {
            const blockedBlock = buildPreflightReviewBlock(failure.classified, route);
            const reviewContent = hasPriorRealReview
                ? `${existing.replace(/\s*$/, '')}\n\n---\n\n${blockedBlock}`
                : `# Code Review: ${t.taskId}\n\n${blockedBlock}`;
            fs.writeFileSync(reviewPath, reviewContent, 'utf8');
            continue;
        }

        const currentPreflight = t.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
        const appendHeadingN = hasPriorRealReview ? currentPreflight + 1 : null;
        const stub = buildCleanTaskReviewStub(t.taskId, siblingTaskIds, route, appendHeadingN);
        const reviewContent = hasPriorRealReview
            ? `${existing.replace(/\s*$/, '')}\n\n---\n\n${stub}`
            : stub;
        fs.writeFileSync(reviewPath, reviewContent, 'utf8');
    }

    return true;
}

export async function runCodeReviewPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
    deps: CodeReviewPhaseDeps = defaultDeps,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    deps.verifyBranch(taskIds);
    const baseBranch = deps.getBaseBranch(taskIds);
    const activeCwd = deps.getActiveCwd(taskIds);
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
    const codeReviewLoopCap = deps.getMaxReviewLoops(tasks);
    if (worstTask.combined >= codeReviewLoopCap) {
        const reason =
            `Code review hit ${worstTask.combined} attempts in a row for task ${worstTask.taskId} ` +
            `(${worstTask.real} reviewer rounds + ${worstTask.preflight} pre-flight rejections; limit: ${codeReviewLoopCap}). ` +
            `Pipeline auto-blocked. Read tasks/<id>/review.md — if the same finding ` +
            `keeps recurring, the spec or approach may need revisiting rather than ` +
            `another implementation pass. If repeated failures were all pre-flight, ` +
            `the handoff format itself may be wrong (e.g., Validation Outcomes rows ` +
            `using prose labels instead of backticked check keys). To resume after ` +
            `fixing: run \`canon task reset-code-review <id>\` to archive the prior review, ` +
            `clear the loop-local counters, and re-derive status.json, then re-run the pipeline.`;
        warn(reason);
        autoBlockPhase(taskIds, 'code_review', worstTask.combined, reason);
        process.exit(2);
    }

    // Pre-flight: reject obviously invalid handoffs without spending a Claude session.
    // Classify blockers by who can fix them so a real regression is not framed
    // as a handoff-format problem.
    const changedFiles = new Set(deps.getAffectedFiles(baseBranch, activeCwd));
    const bundleIssues = deps.verifyHandoffAgainstDiff(taskIds, baseBranch);
    const preflightFailed: PreflightFailure[] = [];
    for (const t of tasks) {
        // Task-prefixed issues (e.g. "[task-a] handoff→diff: ...") are scoped to
        // their own task — passing all of them to every classifier in a bundle
        // would make clean siblings appear to fail with another task's problem.
        // Bundle-level issues (no leading "[") apply to every task.
        const taskBundleIssues = bundleIssues.filter(issue =>
            !issue.startsWith('[') || issue.startsWith(`[${t.taskId}]`),
        );
        const classified = classifyPreflightBlockers(t.taskId, changedFiles, taskBundleIssues);
        if (classified.length > 0) preflightFailed.push({ taskId: t.taskId, classified });
    }
    if (preflightFailed.length > 0) {
        const route = determinePreflightRoute(preflightFailed);
        warn('Validation pre-flight FAILED — rejecting handoff without Claude review:');
        for (const { taskId, classified } of preflightFailed) {
            for (const issue of classified) warn(`  [${taskId}:${issue.bucket}] ${issue.message}`);
        }
        writePreflightReviewArtifacts(tasks, preflightFailed, route);

        if (route === 'auto_block') {
            const reason =
                `Code review pre-flight found only blocked validation rows for task(s) ${preflightFailed.map(f => f.taskId).join(', ')}. ` +
                `Infrastructure was unavailable, and re-implementation cannot resolve it. ` +
                `Human triage required. To resume after infrastructure is restored: update the affected ` +
                `handoff.md Validation Outcomes rows, run \`canon task reset-code-review <id>\` for each ` +
                `bundle task that needs recovery, and re-run the pipeline.`;
            warn(reason);
            autoBlockPhase(taskIds, 'code_review', worstTask.combined, reason);
            process.exit(2);
        }

        for (const { taskId } of tasks) {
            // Pre-flight rejection: orchestrator-side handoff validation, not a
            // reviewer round. Use the dedicated helper that bumps
            // changes_requested_total only — counting this as an iteration
            // would cause the next code_review run to receive the round-N
            // prompt, which skips Stage 1 (AC table) under the assumption that
            // round 1 was a real review. In bundle mode, this applies to clean
            // siblings too because the code-review attempt was rejected by the
            // bundle pre-flight before Claude ran.
            taskPhasePreflightRejected(taskId, 'code_review');
        }
        return { agent: 'claude', sessionId: null, exitCode: 0 };
    }

    info(`Phase: code_review (Claude${state.isBundle ? ' bundle' : ''}, iteration ${maxIter + 1})`);
    for (const t of tasks) taskPhase(t.taskId, 'code_review', 'in_progress');

    const coldCfg = deps.getCodexConfig('code_review', tasks);
    const coldReviewStartMs = Date.now();
    const coldReview = await deps.runColdCodexReview(baseBranch, coldCfg.model, coldCfg.effort, activeCwd, {
        taskId: taskIds.join('+'),
        phase: 'code_review',
        iteration: maxIter,
        activeCwd,
    });
    const coldReviewDurationMs = Date.now() - coldReviewStartMs;

    if (!coldReview.success) {
        setExitReason(
            `cold-Codex review could not be obtained for task(s) ${taskIds.join(', ')} ` +
            `(no findings output / spawn error / stall / signal). Re-run when Codex is available — ` +
            `the code_review phase has not advanced.`,
        );
        process.exit(1);
    }

    for (const t of tasks) {
        fs.writeFileSync(
            path.join(taskDirFor(t.taskId), 'review-cold-codex.md'),
            coldReview.findings,
            'utf8',
        );
    }
    info(`→ cold-codex review (${taskIds.join(', ')}): ${Math.round(coldReviewDurationMs / 1000)}s`);

    const cfg = deps.getClaudeConfig('code_review', tasks);
    const reviewResumeId = maxIter > 0 ? resumeId : null;
    const scopedDiff = deps.getScopedDiff(baseBranch, activeCwd);
    const result = await deps.runClaude(promptCodeReview(state, baseBranch, scopedDiff, coldReview.findings), interactive, reviewResumeId, cfg.model, cfg.effort, cfg.budget, {
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
