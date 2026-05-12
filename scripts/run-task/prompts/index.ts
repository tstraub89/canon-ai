import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../env.js';
import { getBaseBranch } from '../git.js';
import { buildContextBlock, buildImplementStateHeader, buildKnownPitfalls, buildKnownRisks } from '../context.js';
import { RUNTIME_CHECKS } from '../../pipeline-policy.js';
import { computeLatestRuntimeResults } from '../validation.js';
import { resolveTaskCwd } from '../state.js';
import { sanitizeRuntimeCheckName } from '../phases/runtime-validation.js';
import { CLAUDE_STARTUP, CODEX_STARTUP, QA_STARTUP, phaseCommands, taskList } from './helpers.js';
import { renderTemplate } from './render.js';
import type { PipelineState, TaskContext } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.join(__dirname, 'templates');
const TEMPLATE_CACHE = new Map<string, string>();

function loadTemplate(name: string): string {
    const cached = TEMPLATE_CACHE.get(name);
    if (cached) return cached;
    const content = fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
    TEMPLATE_CACHE.set(name, content);
    return content;
}

function render(name: string, view: object): string {
    return renderTemplate(loadTemplate(name), view);
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
            : `Write tasks/${task.taskId}/spec.md using the template in tasks/_templates/spec.md. Be concrete — Codex implements directly from this.` +
              (combined ? `\n\nAlso write tasks/${task.taskId}/plan.md with ordered implementation steps, specific file references, and existing patterns to use.` : ''),
        bundleNote: isBundle ? '\nThese tasks are related — consider cross-task interactions while speccing.' : '',
        doneNote: combined
            ? 'The orchestrator will handle spec_review and plan-phase advancement automatically for fast-tier tasks.'
            : '',
        selfCheck: [
            'Before running the task.sh command, self-check each spec against this list. Fix anything that fails:',
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

export function promptImplement(state: PipelineState, mode: 'fresh' | 'resume' = 'fresh'): string {
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
        taskLines,
        isBundle: tasks.length > 1,
        phaseCommands: phaseCommands(taskIds, 'implement', 'done'),
    });
}

export function promptImplementRevisions(state: PipelineState): string {
    const { tasks } = state;
    const stateHeader = buildImplementStateHeader(state, 'revision');
    const maxCodeReviewIter = tasks.reduce((m, t) => Math.max(m, t.iterations), 0);
    const maxRuntimeIter = tasks.reduce((m, t) => Math.max(m, t.runtimeIterations), 0);
    const hasReviewFindings = maxCodeReviewIter > 0;
    const hasRuntimeFailures = maxRuntimeIter > 0;
    const iterationN = Math.max(maxCodeReviewIter, maxRuntimeIter) + 1;
    const priorRound = maxCodeReviewIter;
    const iterBanner = hasReviewFindings && hasRuntimeFailures
        ? `[ITERATION ${iterationN} — addressing code review round ${priorRound} and runtime validation failures]`
        : hasReviewFindings
            ? `[ITERATION ${iterationN} — addressing code review round ${priorRound}]`
            : `[ITERATION ${iterationN} — addressing runtime validation failures]`;
    const handoffAppend = hasReviewFindings && hasRuntimeFailures
        ? `## Iteration ${iterationN} — addressing review round ${priorRound} and runtime validation`
        : hasReviewFindings
            ? `## Iteration ${iterationN} — addressing review round ${priorRound}`
            : `## Iteration ${iterationN} — addressing runtime validation`;
    const reviewLines = hasReviewFindings
        ? tasks.map(t =>
            `- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` (most recent \`## Round ${priorRound}\` section only — earlier rounds are already addressed)`
        ).join('\n')
        : '';
    const runtimeFailureEntries = hasRuntimeFailures
        ? buildRuntimeFailureEntries(tasks)
        : [];

    return render('implement-revisions.md', {
        projectName: config.projectName,
        taskScope: tasks.length > 1 ? 'a bundle of related tasks' : `task "${tasks[0].taskId}"`,
        stateHeader,
        startup: CODEX_STARTUP,
        iterBanner,
        handoffAppend,
        hasReviewFindings,
        hasRuntimeFailures,
        iterationN,
        priorRound,
        reviewLines,
        runtimeFailureEntries,
        tightenLine: iterationN >= 3 ? ` (note: round ${iterationN} is tightening — prefer to defer nits).` : '',
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'implement', 'done'),
    });
}

function stderrExcerptFromNotes(notes: string): string {
    const withoutArtifacts = notes.replace(/;\s*artifacts:.*$/s, '');
    const firstSeparator = withoutArtifacts.indexOf(';');
    if (firstSeparator === -1) return '';
    return withoutArtifacts.slice(firstSeparator + 1).trim().replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

function buildRuntimeFailureEntries(tasks: readonly TaskContext[]): object[] {
    const entries: object[] = [];
    for (const task of tasks) {
        if (task.runtimeIterations <= 0) continue;
        const handoffPath = path.join(resolveTaskCwd(task.taskId), 'tasks', task.taskId, 'handoff.md');
        let handoffContent = '';
        try {
            handoffContent = fs.readFileSync(handoffPath, 'utf8');
        } catch {
            // Missing handoff is handled downstream by the implementer as a blocker.
        }
        const latestRuntimeResults = computeLatestRuntimeResults(handoffContent);
        for (const row of latestRuntimeResults.values()) {
            if (row.result !== 'Fail' && row.result !== 'Timeout') continue;
            const safeName = sanitizeRuntimeCheckName(row.check);
            const artifactPath = `tasks/${task.taskId}/runtime-check-output/${safeName}/iter-${task.runtimeIterations_total}/`;
            const stderrLogPath = path.join(resolveTaskCwd(task.taskId), artifactPath, 'stderr.log');
            let stderrContent: string;
            try {
                stderrContent = fs.readFileSync(stderrLogPath).subarray(0, 2048).toString('utf8');
            } catch {
                stderrContent = `${stderrExcerptFromNotes(row.notes)}\n[stderr.log missing — using truncated handoff excerpt]`.trim();
            }
            const hint = RUNTIME_CHECKS.find(check => check.name === row.check)?.artifactReadingHint ?? '';
            entries.push({
                taskId: task.taskId,
                checkName: row.check,
                artifactPath,
                stderrContent,
                hasHint: hint.length > 0,
                artifactReadingHint: hint,
            });
        }
    }
    return entries;
}

export function promptImplementReroute(state: PipelineState): string {
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

    return render('implement-reroute.md', {
        projectName: config.projectName,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        stateHeader,
        startup: CODEX_STARTUP,
        roundBanner,
        risksBlock: buildKnownRisks(taskIds),
        pitfallsBlock: buildKnownPitfalls(),
        contextBlock: buildContextBlock(taskIds),
        taskLines,
        phaseCommands: phaseCommands(taskIds, 'implement', 'done'),
    });
}

export function promptCodeReview(state: PipelineState): string {
    const { tasks } = state;
    const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
    const baseBranch = getBaseBranch(tasks.map(t => t.taskId));

    if (maxIter > 0) {
        const roundN = maxIter + 1;
        const priorIteration = maxIter;
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
            baseBranch,
            phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'code_review', 'done', '<verdict>'),
        });
    }

    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: read tasks/${t.taskId}/handoff.md and cross-reference tasks/${t.taskId}/spec.md ACs`
    ).join('\n');

    return render('code-review-round-1.md', {
        projectName: config.projectName,
        startup: CLAUDE_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        taskLines,
        baseBranch,
        isBundle: tasks.length > 1,
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
