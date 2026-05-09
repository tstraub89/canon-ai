import { REPO_ROOT } from '../env.js';
import { resolveTaskCwd } from '../state.js';
import type { TaskContext } from '../types.js';

export const CLAUDE_STARTUP =
    'Read AGENTS.md and docs/patterns.md before starting.\n' +
    'Skim docs/lessons-learned.md for entries relevant to your task area.\n' +
    'Read docs/architecture.md if the task touches core data flow or state management.\n' +
    'Read docs/product-context.md if the task touches user-visible behavior or Pro features.\n' +
    'Skip docs/product-owner.md and docs/decisions.md unless the task involves explicit UX tradeoffs.';

export const CODEX_STARTUP =
    'Read AGENTS.md, docs/patterns.md, and docs/codebase-map.md before starting.\n' +
    'Skim docs/lessons-learned.md for entries relevant to your task area.\n' +
    'Skip docs/product-owner.md, docs/decisions.md, docs/product-context.md unless the task explicitly involves product or UX decisions.\n' +
    'Ground every claim in the current file, diff, or artifact before you state it. Do not rely on prior-session memory for code existence, validation results, or completion status.\n' +
    'On resumed sessions, re-read the task-specific files named in the prompt and inspect the current working tree before saying anything is already done.\n' +
    '\n' +
    'Git ownership: the pipeline orchestrator handles staging, committing, and pushing — do NOT run `git add`, `git commit`, or `git push`. Edit files in the working tree only; the orchestrator reads `git status` after your session and stages every file listed in handoff.md\'s Changes table. Read-only git is fine (`git status`, `git diff`, `git log`, `git show`).\n' +
    '\n' +
    'If a code review claims a file is "missing from the commit" or "staged but not committed," that is a pipeline-orchestration issue, not an implementation issue. Record it as a Blocker in handoff.md with the `[pipeline]` label and do not retry `git add`/`git commit` to recover — the sandbox blocks `.git` writes by design, and the orchestrator owns the recovery path.';

export const QA_STARTUP =
    'Read CHANGELOG.md for voice and version reference.\n' +
    'Read docs/lessons-learned.md for recent insights to distill.\n' +
    'No full codebase context needed for QA — read each task\'s spec.md, handoff.md, and notes.md directly.';

export function taskList(tasks: TaskContext[]): string {
    return tasks.map(t => `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/`).join('\n');
}

export function phaseCommands(taskIds: string[], phase: string, status: string, verdict = ''): string {
    return taskIds.map(id => {
        const cmd = verdict
            ? `${REPO_ROOT}/scripts/task.sh phase ${id} ${phase} ${status} ${verdict}`
            : `${REPO_ROOT}/scripts/task.sh phase ${id} ${phase} ${status}`;
        return `(cd '${resolveTaskCwd(id)}' && ${cmd})`;
    }).join('\n');
}

export function toResumePrompt(prompt: string): string {
    let trimmed = prompt;
    for (const block of [CLAUDE_STARTUP, CODEX_STARTUP, QA_STARTUP]) {
        trimmed = trimmed.replace(`\n\n${block}\n\n`, '\n\n');
    }
    return `[Resumed session — project context loaded. Skip startup boilerplate re-reads (AGENTS.md, architecture docs, etc.) — re-read any task-specific files explicitly requested in this prompt, then verify the current working tree or artifact before claiming anything is already done.]\n\n${trimmed.trimStart()}`;
}
