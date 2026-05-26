import fs from 'node:fs';
import path from 'node:path';

import { config } from '../env.js';
import { getBaseBranch, type ScopedDiff } from '../git.js';
import { buildContextBlock, buildImplementStateHeader, buildKnownPitfalls, buildKnownRisks } from '../context.js';
import { taskDirFor } from '../state.js';
import { CLAUDE_STARTUP, CODEX_STARTUP, QA_STARTUP, phaseCommands, taskList } from './helpers.js';
import { renderTemplate } from './render.js';
import type { PipelineState } from '../types.js';
import codeReviewRound1Template from './templates/code-review-round-1.md';
import codeReviewRoundNTemplate from './templates/code-review-round-n.md';
import implementTemplate from './templates/implement.md';
import implementRerouteTemplate from './templates/implement-reroute.md';
import implementRevisionsTemplate from './templates/implement-revisions.md';
import planTemplate from './templates/plan.md';
import qaTemplate from './templates/qa.md';
import specTemplate from './templates/spec.md';
import specRevisionTemplate from './templates/spec-revision.md';
import specReviewTemplate from './templates/spec-review.md';

const TEMPLATES: Record<string, string> = {
    'code-review-round-1.md': codeReviewRound1Template,
    'code-review-round-n.md': codeReviewRoundNTemplate,
    'implement.md': implementTemplate,
    'implement-reroute.md': implementRerouteTemplate,
    'implement-revisions.md': implementRevisionsTemplate,
    'plan.md': planTemplate,
    'qa.md': qaTemplate,
    'spec.md': specTemplate,
    'spec-revision.md': specRevisionTemplate,
    'spec-review.md': specReviewTemplate,
};

function loadTemplate(name: string): string {
    const template = TEMPLATES[name];
    if (!template) throw new Error(`Unknown template: ${name}`);
    return template;
}

function render(name: string, view: object): string {
    return renderTemplate(loadTemplate(name), view);
}

function buildAffectedFilesBlock(affectedFiles: readonly string[] | undefined, baseBranch: string | undefined): string {
    if (!affectedFiles) return '';
    if (affectedFiles.length === 0) {
        return [
            '## Affected files (committed diff vs base branch)',
            '',
            'No prior commits on this task\'s branch yet. Apply the full default check matrix from the spec\'s *Validation Required* section — every check runs unconditionally on this first implement pass. Predicate gating is meaningful only once the task branch has committed changes.',
            '',
        ].join('\n');
    }

    const branch = baseBranch ?? 'base branch';
    return [
        '## Affected files (committed diff vs base branch)',
        '',
        `The following files have committed changes on this task's branch vs \`${branch}\`:`,
        '',
        ...affectedFiles.map(file => `- \`${file}\``),
        '',
        'Use this set when applying predicate-gated checks from the spec\'s *Validation Required* section. If a check is gated (e.g., "run e2e only if `src/` changed"), evaluate the predicate against the affected-files set; when the predicate is false, skip the check and record the skip in the Validation Outcomes table with the predicate\'s verbatim condition in the Notes column. When no predicate gates a check in the spec, run the check unconditionally.',
        '',
    ].join('\n');
}

export function promptSpec(state: PipelineState): string {
    const { tasks, tier, isBundle } = state;
    const combined = tier === 'fast';
    const task = tasks[0];
    return render('spec.md', {
        header: isBundle
            ? `You are writing specs for a bundle of ${tasks.length} related tasks for ${config.projectName}.\n\nBundle tasks:\n${taskList(tasks)}`
            : `You are working on task "${task.taskId}" for ${config.projectName}.\n\nTask: ${task.title}\nDirectory: tasks/${task.taskId}/`,
        startup: CLAUDE_STARTUP,
        instructions: isBundle
            ? tasks.map((t) =>
                `**Task \`${t.taskId}\`**: Write tasks/${t.taskId}/spec.md using the template.` +
                (combined ? ` Also write tasks/${t.taskId}/plan.md with ordered implementation steps, specific file references, and existing patterns.` : '')
            ).join('\n\n')
            : `Write tasks/${task.taskId}/spec.md using the template in .canon/templates/spec.md. Be concrete — Codex implements directly from this.` +
              (combined ? `\n\nAlso write tasks/${task.taskId}/plan.md with ordered implementation steps, specific file references, and existing patterns to use.` : ''),
        bundleNote: isBundle ? '\nThese tasks are related — consider cross-task interactions while speccing.' : '',
        doneNote: combined
            ? 'The orchestrator will handle spec_review and plan-phase advancement automatically for fast-tier tasks.'
            : '',
        selfCheck: [
            'Before running the canon task command, self-check each spec against this list. Fix anything that fails:',
            '- Every AC is verifiable with a specific test (not just "it works" — state exactly how to verify)',
            '- Affected Files lists specific files (not directories) with specific, actionable change descriptions',
            combined ? '- Plan steps reference actual function/file names from the codebase (not just concepts)' : null,
            '- Known Risks covers failure modes for the trickiest ACs',
            '- Human Test Plan describes product behavior only (no code, no file names, no TypeScript)',
            '- Validation Required has at least one entry checked (or explicitly "None" with a reason)',
        ].filter(Boolean).join('\n'),
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'spec', 'done'),
    });
}

export function promptSpecRevision(state: PipelineState): string {
    const { tasks, tier } = state;
    const combined = tier === 'fast';
    const reviewLines = tasks
        .filter(t => t.specReviewVerdict === 'changes_requested')
        .map(t => `- \`${t.taskId}\`: read tasks/${t.taskId}/spec-review.md for findings`)
        .join('\n');

    return render('spec-revision.md', {
        projectName: config.projectName,
        startup: CLAUDE_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        reviewLines,
        combined,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'spec', 'done'),
    });
}

export function promptSpecReview(state: PipelineState): string {
    const { tasks, tier } = state;
    const combined = tier === 'fast';
    const fullSendActive = tasks.some(t => t.status.full_send === true);
    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/spec.md${combined ? ` and tasks/${t.taskId}/plan.md` : ''}`
    ).join('\n');

    return render('spec-review.md', {
        projectName: config.projectName,
        startup: CODEX_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of specs' : 'a spec',
        taskLines,
        combined,
        isBundle: tasks.length > 1,
        fullSendActive,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'spec_review', 'done', '<verdict>'),
    });
}

export function promptPlan(state: PipelineState): string {
    const { tasks } = state;
    const verdictLines = tasks.map(t =>
        `- \`${t.taskId}\`: spec review verdict = ${t.specReviewVerdict}`
    ).join('\n');

    return render('plan.md', {
        projectName: config.projectName,
        startup: CLAUDE_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        verdictLines,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'plan', 'done'),
    });
}

export function promptImplement(
    state: PipelineState,
    mode: 'fresh' | 'resume' = 'fresh',
    affectedFiles?: readonly string[],
    baseBranch?: string,
): string {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" → read tasks/${t.taskId}/spec.md and tasks/${t.taskId}/plan.md`
    ).join('\n');

    return render('implement.md', {
        projectName: config.projectName,
        taskScope: tasks.length > 1 ? 'a bundle of related tasks' : `task "${tasks[0].taskId}"`,
        stateHeader: buildImplementStateHeader(state, mode),
        startup: CODEX_STARTUP,
        risksBlock: buildKnownRisks(taskIds),
        pitfallsBlock: buildKnownPitfalls(taskIds),
        contextBlock: buildContextBlock(taskIds),
        affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch),
        taskLines,
        isBundle: tasks.length > 1,
        phaseCommands: phaseCommands(taskIds, 'implement', 'done'),
    });
}

export function promptImplementResume(state: PipelineState): string {
    return [
        'Your implementation session was interrupted before you could write handoffs.',
        'The code changes are already complete in the working tree.',
        '',
        'Your only remaining tasks:',
        '1. Run the project\'s validation commands (see AGENTS.md "Validation Matrix" and each spec\'s "Validation Required" section) and record results.',
        '2. Write handoff.md for each task (intent/rationale, deviations, AC coverage, validation outcomes).',
        '3. Run canon task to mark implement done for each task.',
        '',
        promptImplement(state, 'resume'),
    ].join('\n');
}

export function promptImplementRevisions(
    state: PipelineState,
    affectedFiles: readonly string[],
    baseBranch: string,
): string {
    const { tasks } = state;
    const stateHeader = buildImplementStateHeader(state, 'revision');
    const maxCodeReviewIter = tasks.reduce((m, t) => Math.max(m, t.iterations), 0);
    // Pre-flight rejection also routes back to implement but doesn't bump
    // `iterations` (it's not a Claude review round — see
    // taskPhasePreflightRejected). Detect it so the revision prompt still
    // points Codex at review.md (which contains the BLOCKED block listing
    // handoff-format issues to fix). Without this branch, the prompt's
    // reviewLines would be empty and Codex wouldn't be told to address the
    // pre-flight findings (Codex P1 on the prior iteration of the fix).
    const maxPreflightRejections = tasks.reduce(
        (m, t) => Math.max(m, t.status.phases.code_review?.preflight_rejections_current_loop ?? 0),
        0,
    );
    // Pre-flight takes priority when present — it's an input-validation
    // failure that must be fixed before any further code-review work, even
    // if prior real review rounds also had findings. Mutually exclusive
    // routing simplifies Codex's task: address the pre-flight now, get back
    // into a state where the real review can run, then any unresolved prior
    // findings will surface in the next real review round naturally.
    // (Codex P2 on the prior iteration: pre-flight after a real review round
    // was rendering review-revision instructions instead of pre-flight
    // instructions in the mixed-history case.)
    const hasPreflightFindings = maxPreflightRejections > 0;
    const hasReviewFindings = maxCodeReviewIter > 0 && !hasPreflightFindings;
    const iterationN = maxCodeReviewIter + 1;
    const priorRound = maxCodeReviewIter;
    const iterBanner = hasPreflightFindings
        ? `[ITERATION ${iterationN} — addressing pre-flight handoff rejection (no Claude review yet)]`
        : `[ITERATION ${iterationN} — addressing code review round ${priorRound}]`;
    const handoffAppend = hasPreflightFindings
        ? `## Iteration ${iterationN} — addressing pre-flight handoff rejection`
        : `## Iteration ${iterationN} — addressing review round ${priorRound}`;
    const reviewLines = hasReviewFindings
        ? tasks.map(t =>
            `- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` (most recent \`## Round ${priorRound}\` section only — earlier rounds are already addressed)`
        ).join('\n')
        : hasPreflightFindings
            ? tasks.map(t =>
                `- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` (\`## Pre-Flight Rejection\` block lists handoff-format issues; no Claude review ran). Address every listed item — usually a malformed Validation Outcomes table or missing AC Coverage rows.`
            ).join('\n')
            : '';

    return render('implement-revisions.md', {
        projectName: config.projectName,
        taskScope: tasks.length > 1 ? 'a bundle of related tasks' : `task "${tasks[0].taskId}"`,
        stateHeader,
        startup: CODEX_STARTUP,
        affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch),
        iterBanner,
        handoffAppend,
        hasReviewFindings,
        hasPreflightFindings,
        iterationN,
        priorRound,
        reviewLines,
        tightenLine: iterationN >= 3 ? ` (note: round ${iterationN} is tightening — prefer to defer nits).` : '',
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'implement', 'done'),
    });
}

export function promptImplementReroute(
    state: PipelineState,
    isResumedSession = false,
    affectedFiles?: readonly string[],
    baseBranch?: string,
): string {
    const { tasks } = state;
    const stateHeader = buildImplementStateHeader(state, 'reroute');
    const taskIds = tasks.map(t => t.taskId);
    // Banner derivation rule:
    // - **Single task**: anchor with the task's own reroute count. Round numbers
    //   are unambiguous here, and the strong "you've been sent back N times"
    //   reminder is most valuable on repeat reroutes.
    // - **Bundle**: tasks may legally carry mixed reroute counts (e.g., task A
    //   entering round 1 alongside task B entering round 2). A single
    //   bundle-wide round number would mislead at least one task per the
    //   anchoring problem Codex flagged. Use a neutral banner and defer to the
    //   per-task `taskLines` below for round-specific direction.
    const roundBanner = tasks.length === 1
        ? (() => {
            const rerouteCount = tasks[0].rerouteCount;
            const humanReviewRound = rerouteCount + 1;
            const priorReroutes = rerouteCount - 1;
            return rerouteCount >= 2
                ? `⚠️  **THIS IS ROUND ${humanReviewRound} OF HUMAN REVIEW — REROUTE #${rerouteCount}.** You have already been sent back ${priorReroutes} time${priorReroutes === 1 ? '' : 's'} before this one. This prompt is **not** a duplicate of the previous reroute you already addressed — the human has provided **new** feedback beyond what you fixed in reroute #${priorReroutes}. If your session memory says "I just finished this," that memory is from the PRIOR round. The spec has additional amendments since then. If your handoff.md references "round ${rerouteCount}" or earlier, it is out-of-date — the current round is ${humanReviewRound}.\n\n`
                : `**This is round 2 of human review — the first reroute for this task.** The human has reviewed your original implementation and sent it back with feedback that requires spec amendments.\n\n`;
        })()
        : `⚠️  **This is a reroute round for a bundle of tasks.** Each task carries its own reroute count — see the per-task lines below for the round number and amendment heading specific to each task. Do **not** assume a single bundle-wide round: a bundle can mix tasks on different reroute rounds. The human has reviewed prior implementations and sent the bundle back with **new** feedback that requires spec amendments. If your session memory says "I just finished this," that memory is from a prior round — re-read each task's amended spec before changing anything.\n\n`;
    // Per-task heading direction. Each task carries its OWN reroute_count
    // (mixed-count bundles are legal), so the prompt names the exact heading
    // each task's amendment lives under rather than relying on a single
    // bundle-wide round number. Round 1 uses the bare `## Amendment` form;
    // round 2+ uses `## Amendment Round N` where N === t.rerouteCount (the
    // post-increment value already reflects the round being entered).
    const taskLines = tasks.map(t => {
        const expectedHeading = t.rerouteCount <= 1
            ? '`## Amendment`'
            : `\`## Amendment Round ${t.rerouteCount}\``;
        return `- \`${t.taskId}\`: "${t.title}" (entering reroute round ${t.rerouteCount}) — the spec was amended after human review. Locate ${expectedHeading} in tasks/${t.taskId}/spec.md and treat that section's content as the new requirements. Ignore prior-round sections when implementing this one. Your previous handoff is at tasks/${t.taskId}/handoff.md.`;
    }).join('\n');

    const preamble = isResumedSession
        ? 'Your session is being continued with spec amendments. The spec has been updated since your last turn — new ACs, new sections, or revised requirements have been added. Your existing code and codebase context are still valid; only the spec has changed.'
        : 'A human reviewed your previous implementation and sent it back with additional feedback. The spec has been updated in place — new ACs, new sections, or revised requirements have been added since you last read it. This is **not** a resume of an interrupted session: your previous work shipped, the human tried it, and now there\'s more to do.';
    const startup = isResumedSession ? '' : CODEX_STARTUP;
    const groundingRule = isResumedSession
        ? 'Grounding rule: re-read the amended spec.md and your handoff.md before changing anything. Your codebase context is current, but the spec has new requirements — do not assume your prior memory of the spec is complete.'
        : 'Grounding rule: re-open the amended spec and the current handoff before changing anything. Session memory is stale by design on reroute rounds.';

    return render('implement-reroute.md', {
        projectName: config.projectName,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        stateHeader,
        startup,
        roundBanner,
        preamble,
        groundingRule,
        risksBlock: buildKnownRisks(taskIds),
        pitfallsBlock: buildKnownPitfalls(taskIds),
        contextBlock: buildContextBlock(taskIds),
        affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch),
        taskLines,
        phaseCommands: phaseCommands(taskIds, 'implement', 'done'),
    });
}

/**
 * Defense-in-depth check against the historical "pre-flight rejection counts
 * as a Claude review round" bug. If review.md lacks a `## Stage 1` heading
 * for ANY task in the bundle, the prior "round" was a pre-flight rejection
 * (or template, or missing entirely) — not a real Stage 1 + Stage 2 review.
 * In that case we must use the Round-1 prompt so Claude fills the AC table
 * from scratch, regardless of what iteration counters say.
 *
 * This guards two scenarios the iteration-counter fix alone can't catch:
 *   1. Legacy status files whose counters are already corrupted from past
 *      pre-flight rejections.
 *   2. Future regressions that bump iteration counters incorrectly without
 *      writing a real Stage 1 review.
 */
function bundleHasRealPriorReview(taskIds: readonly string[]): boolean {
    return taskIds.every(taskId => {
        // taskDirFor honors CANON_TASKS_DIR_OVERRIDE (test paths) AND the
        // standard worktree+tasks/<id>/ production layout — required for the
        // golden tests in run-task-prompts.test.ts to see the test fixture's
        // review.md at the override path.
        const reviewPath = path.join(taskDirFor(taskId), 'review.md');
        try {
            const content = fs.readFileSync(reviewPath, 'utf8');
            // Stage 1 heading present and review.md isn't the unfilled template.
            return /^## Stage 1\b/m.test(content) && !content.includes('[TASK-ID]');
        } catch {
            return false;
        }
    });
}

export function promptCodeReview(
    state: PipelineState,
    baseBranch?: string,
    scopedDiff: ScopedDiff | null = null,
): string {
    const { tasks } = state;
    const rawMaxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
    // Force Round 1 if any task's review.md lacks a real prior Stage 1 review —
    // see bundleHasRealPriorReview docstring for the bug class this prevents.
    const maxIter = bundleHasRealPriorReview(tasks.map(t => t.taskId)) ? rawMaxIter : 0;
    const resolvedBaseBranch = baseBranch ?? getBaseBranch(tasks.map(t => t.taskId));
    const hasDiff = scopedDiff !== null;

    if (maxIter > 0) {
        const roundN = maxIter + 1;
        const priorIteration = maxIter;
        const diffView = hasDiff
            ? {
                hasDiff,
                baseBranch: resolvedBaseBranch,
                diffContent: scopedDiff.diff,
                diffTruncated: scopedDiff.truncated,
            }
            : {
                hasDiff,
                baseBranch: resolvedBaseBranch,
                diffContent: '',
                diffTruncated: false,
            };
        const taskLines = tasks.map(t =>
            `- \`${t.taskId}\` → read the \`## Iteration ${priorIteration} — addressing review round ${maxIter}\` section of \`tasks/${t.taskId}/handoff.md\``
        ).join('\n');
        const tightenLine = roundN >= 3
            ? `\n**Round ${roundN} discipline.** This is round ${roundN}+. Findings must be \`correctness bug\` or \`spec gap\` only — NO \`optional cleanup/nit\` and no wording-only changes. We are tightening, not exploring. If your only finding is a wording preference, approve.\n`
            : '';
        return render('code-review-round-n.md', {
            projectName: config.projectName,
            roundN,
            priorIteration,
            maxIter,
            taskLines,
            tightenLine,
            ...diffView,
            phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'code_review', 'done', '<verdict>'),
        });
    }

    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: read tasks/${t.taskId}/handoff.md and cross-reference tasks/${t.taskId}/spec.md ACs`
    ).join('\n');

    const diffView = hasDiff
        ? {
            hasDiff,
            baseBranch: resolvedBaseBranch,
            diffContent: scopedDiff.diff,
            diffTruncated: scopedDiff.truncated,
        }
        : {
            hasDiff,
            baseBranch: resolvedBaseBranch,
            diffContent: '',
            diffTruncated: false,
        };

    return render('code-review-round-1.md', {
        projectName: config.projectName,
        startup: CLAUDE_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        taskLines,
        isBundle: tasks.length > 1,
        ...diffView,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'code_review', 'done', '<verdict>'),
    });
}

export function promptQa(state: PipelineState): string {
    const { tasks } = state;
    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/`
    ).join('\n');

    return render('qa.md', {
        projectName: config.projectName,
        docsScope: tasks.length > 1 ? 'these tasks' : 'this task',
        startup: QA_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        taskLines,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'qa', 'done'),
    });
}
