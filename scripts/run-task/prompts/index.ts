import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../env.js';
import { getBaseBranch } from '../git.js';
import { buildContextBlock, buildImplementStateHeader, buildKnownPitfalls, buildKnownRisks } from '../context.js';
import { CLAUDE_STARTUP, CODEX_STARTUP, QA_STARTUP, phaseCommands, taskList } from './helpers.js';
import { renderTemplate } from './render.js';
import type { PipelineState } from '../types.js';

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
    const iterationN = tasks.reduce((m, t) => Math.max(m, t.iterations), 0) + 1;
    const priorRound = iterationN - 1;
    const reviewLines = tasks.map(t =>
        `- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` (most recent \`## Round ${priorRound}\` section only — earlier rounds are already addressed)`
    ).join('\n');

    return render('implement-revisions.md', {
        projectName: config.projectName,
        taskScope: tasks.length > 1 ? 'a bundle of related tasks' : `task "${tasks[0].taskId}"`,
        stateHeader,
        startup: CODEX_STARTUP,
        iterationN,
        priorRound,
        reviewLines,
        tightenLine: iterationN >= 3 ? ` (note: round ${iterationN} is tightening — prefer to defer nits).` : '',
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'implement', 'done'),
    });
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
