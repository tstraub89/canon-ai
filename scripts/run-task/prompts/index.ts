import { config } from '../env.js';
import { getBaseBranch, type ScopedDiff } from '../git.js';
import { buildContextBlock, buildImplementStateHeader, buildKnownPitfalls, buildKnownRisks } from '../context.js';
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
        pitfallsBlock: buildKnownPitfalls(),
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
    const hasReviewFindings = maxCodeReviewIter > 0;
    const iterationN = maxCodeReviewIter + 1;
    const priorRound = maxCodeReviewIter;
    const iterBanner = `[ITERATION ${iterationN} — addressing code review round ${priorRound}]`;
    const handoffAppend = `## Iteration ${iterationN} — addressing review round ${priorRound}`;
    const reviewLines = hasReviewFindings
        ? tasks.map(t =>
            `- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` (most recent \`## Round ${priorRound}\` section only — earlier rounds are already addressed)`
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
    const maxReroute = tasks.reduce((m, t) => Math.max(m, t.rerouteCount), 0);
    const roundNum = maxReroute + 1;
    const priorReroutes = maxReroute - 1;
    const roundBanner = maxReroute >= 2
        ? `⚠️  **THIS IS ROUND ${roundNum} OF HUMAN REVIEW — REROUTE #${maxReroute}.** You have already been sent back ${priorReroutes} time${priorReroutes === 1 ? '' : 's'} before this one. This prompt is **not** a duplicate of the previous reroute you already addressed — the human has provided **new** feedback beyond what you fixed in reroute #${priorReroutes}. If your session memory says "I just finished this," that memory is from the PRIOR round. The spec has additional amendments since then. If your handoff.md references "round ${priorReroutes + 1}" or earlier, it is out-of-date — the current round is ${roundNum}.\n\n`
        : `**This is round 2 of human review — the first reroute for this task.** The human has reviewed your original implementation and sent it back with feedback that requires spec amendments.\n\n`;
    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" (reroute #${t.rerouteCount}) — the spec was amended after human review. Read tasks/${t.taskId}/spec.md carefully (look for "Amendment", "Round N", "Follow-up", "Revision Notes", or similar sections that were added since your last handoff). Your previous handoff is at tasks/${t.taskId}/handoff.md.`
    ).join('\n');

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
        pitfallsBlock: buildKnownPitfalls(),
        contextBlock: buildContextBlock(taskIds),
        affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch),
        taskLines,
        phaseCommands: phaseCommands(taskIds, 'implement', 'done'),
    });
}

export function promptCodeReview(
    state: PipelineState,
    baseBranch?: string,
    scopedDiff: ScopedDiff | null = null,
): string {
    const { tasks } = state;
    const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
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
