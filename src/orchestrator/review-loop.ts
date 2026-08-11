import type { TaskContext } from './types.js';

export type ReviewLoopResult =
    | { blocked: false; count: number }
    | { blocked: true; count: number; reason: string };

function isUsableCap(cap: number): boolean {
    return Number.isInteger(cap) && cap >= 0;
}

function specReviewIterations(task: TaskContext): number {
    // TaskContext.iterations_current_loop is sourced from code_review. The
    // spec loop must read its own loop-local counter from persisted state.
    return task.status.phases.spec_review?.iterations_current_loop
        ?? task.status.phases.spec_review?.iterations
        ?? 0;
}

function revisionPhaseNotDone(
    tasks: readonly TaskContext[],
    phase: 'spec' | 'implement',
): boolean {
    return tasks.every(task => (task.status.phases[phase]?.status ?? 'pending') !== 'done');
}

function resumeOrderClause(
    revisionPhase: 'spec' | 'implement',
    reviewPhase: 'spec_review' | 'code_review',
    revisionNotDone: boolean,
): string {
    return revisionNotDone
        ? `Resuming after raising the cap runs \`${revisionPhase}\` first — the deferred revision — then \`${reviewPhase}\` again.`
        : `Resuming after raising the cap runs \`${reviewPhase}\` directly; \`${revisionPhase}\` already completed its revision.`;
}

function blockTimingClause(
    revisionPhase: 'spec' | 'implement',
    reviewPhase: 'spec_review' | 'code_review',
    revisionNotDone: boolean,
): string {
    if (revisionNotDone) {
        const revisionWork = revisionPhase === 'spec' ? 'spec revision' : 're-implementation';
        return `Pipeline auto-blocked before the next ${revisionWork}.`;
    }
    return (
        `Pipeline auto-blocked at the \`${reviewPhase}\` entry backstop after ` +
        `\`${revisionPhase}\` already completed its revision.`
    );
}

function resetSemanticsClause(
    revisionPhase: 'spec' | 'implement',
    reviewPhase: 'spec_review' | 'code_review',
    revisionNotDone: boolean,
): string {
    const artifact = revisionPhase === 'spec' ? 'current spec' : 'current implementation';
    const revisionWork = revisionPhase === 'spec' ? 'spec revision' : 'implementation pass';
    const resetEffect =
        `Resetting accepts the ${artifact} as-is, so the next run enters ` +
        `\`${reviewPhase}\` without another ${revisionWork}.`;
    return revisionNotDone
        ? `${resetEffect} Raise the cap instead if you want the deferred ${revisionWork} to run before review.`
        : resetEffect;
}

function buildSpecReviewReason(
    taskIds: string[],
    count: number,
    cap: number,
    revisionNotDone: boolean,
): string {
    const resetCommands = taskIds.map(id => `canon task reset-spec-review ${id}`).join('; ');
    const timingClause = blockTimingClause('spec', 'spec_review', revisionNotDone);
    const resetClause = resetSemanticsClause('spec', 'spec_review', revisionNotDone);
    const resumeClause = resumeOrderClause('spec', 'spec_review', revisionNotDone);
    return (
        `Spec review hit ${count} changes_requested iterations in a row (limit: ${cap}). ` +
        `${timingClause} Read the latest spec-review.md: ` +
        `if review is still converging (each round narrows on distinct, legitimate findings), ` +
        `raise the cap and continue — MAX_REVIEW_LOOPS=<n> canon run ${taskIds.join(' ')}. ` +
        `Only rescope if prior iterations no longer apply — run ${resetCommands} to archive the ` +
        `prior review, clear the loop counters, and drop the stored Claude session. ` +
        `${resetClause} ${resumeClause}`
    );
}

type CodeReviewAttempts = {
    taskId: string;
    real: number;
    preflight: number;
    combined: number;
};

function buildCodeReviewReason(
    worst: CodeReviewAttempts,
    taskIds: string[],
    cap: number,
    revisionNotDone: boolean,
): string {
    const resetCommands = taskIds.map(id => `canon task reset-code-review ${id}`).join('; ');
    const timingClause = blockTimingClause('implement', 'code_review', revisionNotDone);
    const resetClause = resetSemanticsClause('implement', 'code_review', revisionNotDone);
    const resumeClause = resumeOrderClause('implement', 'code_review', revisionNotDone);
    return (
        `Code review hit ${worst.combined} attempts in a row for task ${worst.taskId} ` +
        `(${worst.real} reviewer rounds + ${worst.preflight} pre-flight rejections; limit: ${cap}). ` +
        `${timingClause} Read tasks/<id>/review.md — if the same finding keeps recurring, ` +
        `the spec or approach may need revisiting rather than another implementation pass. ` +
        `If review is still converging, ` +
        `raise the cap and continue — MAX_REVIEW_LOOPS=<n> canon run ${taskIds.join(' ')}. ` +
        `If repeated failures were all pre-flight, the handoff format itself may be wrong ` +
        `(e.g., Validation Outcomes rows using prose labels instead of backticked check keys). ` +
        `To rescope instead, run ${resetCommands} to archive the prior review and clear the ` +
        `loop-local counters. ${resetClause} ${resumeClause}`
    );
}

export function evaluateSpecReviewLoop(
    tasks: readonly TaskContext[],
    cap: number,
): ReviewLoopResult {
    const count = tasks.reduce(
        (max, task) => Math.max(max, specReviewIterations(task)),
        0,
    );
    if (!isUsableCap(cap) || count < cap) return { blocked: false, count };

    return {
        blocked: true,
        count,
        reason: buildSpecReviewReason(
            tasks.map(task => task.taskId),
            count,
            cap,
            revisionPhaseNotDone(tasks, 'spec'),
        ),
    };
}

export function evaluateCodeReviewLoop(
    tasks: readonly TaskContext[],
    cap: number,
): ReviewLoopResult {
    // Combine attempts within each task before taking the bundle maximum.
    // Summing separate maxima can combine counters from different tasks and
    // falsely block a healthy mixed bundle.
    const perTask = tasks.map(task => {
        const preflight = task.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
        return {
            taskId: task.taskId,
            real: task.iterations_current_loop,
            preflight,
            combined: task.iterations_current_loop + preflight,
        };
    });
    const worst = perTask.reduce(
        (currentWorst, candidate) =>
            candidate.combined > currentWorst.combined ? candidate : currentWorst,
        perTask[0] ?? { taskId: '', real: 0, preflight: 0, combined: 0 },
    );
    if (!isUsableCap(cap) || worst.combined < cap) {
        return { blocked: false, count: worst.combined };
    }

    return {
        blocked: true,
        count: worst.combined,
        reason: buildCodeReviewReason(
            worst,
            tasks.map(task => task.taskId),
            cap,
            revisionPhaseNotDone(tasks, 'implement'),
        ),
    };
}
