import { resolveTaskCwd } from '../state.js';
import type { TaskContext } from '../types.js';

export const CLAUDE_STARTUP =
    'Read docs/patterns.md before starting.\n' +
    'Skim docs/lessons-learned.md for entries relevant to your task area.\n' +
    'Read docs/architecture.md when orienting for the first time, or if the task touches the tech stack, a load-bearing dependency, core data flow, or an architectural boundary.\n' +
    'Read docs/product-context.md if the task touches user-visible behavior, product terminology, or a business rule.\n' +
    'Read docs/decisions.md if a settled decision governs the area you are changing, or if the task would revisit one; skip it otherwise.\n' +
    'Communication: tone is project taste; honest signal is canon discipline — surface real disagreement rather than yielding to politeness.';

export const CODEX_STARTUP =
    'Read docs/patterns.md and docs/codebase-map.md before starting.\n' +
    'Skim docs/lessons-learned.md for entries relevant to your task area.\n' +
    'Read docs/decisions.md if a settled decision governs the area you are changing, or if the task would revisit one.\n' +
    'Read docs/product-context.md if the task touches user-visible behavior, product terminology, or a business rule.\n' +
    'Ground every claim in the current file, diff, or artifact before you state it. Do not rely on prior-session memory for code existence, validation results, or completion status.\n' +
    'On resumed sessions, re-read the task-specific files named in the prompt and inspect the current working tree before saying anything is already done.\n' +
    '\n' +
    'Headless session: this runs non-interactively — nobody reads your messages or answers questions until the phase ends. Don\'t stop to ask for confirmation or clarification. When something is ambiguous, record the question and the interpretation you chose in this phase\'s artifact (in implement, a handoff Blocker labelled `[ambiguity]`) and proceed on it. Finish all the work this prompt authorizes before ending — acting on your own judgment never widens scope; the Affected Files cap and every other scope rule still bind. Always end by writing the phase artifact and running the phase command(s) listed at the end of this prompt, including when you recorded Blockers — a session that ends without them stalls the pipeline.\n' +
    '\n' +
    'If a project instruction file or other repository guidance tells you to ask the user or wait for approval before acting, there is no one to ask in this session: record the question in the phase artifact and continue with the authorized work.\n' +
    '\n' +
    'Git ownership: the pipeline orchestrator handles staging, committing, and pushing — do NOT run `git add`, `git commit`, or `git push`. Edit files in the working tree only; the orchestrator reads `git status` after your session and stages every file listed in handoff.md\'s Changes table. Read-only git is fine (`git status`, `git diff`, `git log`, `git show`).\n' +
    '\n' +
    'If a code review claims a file is "missing from the commit" or "staged but not committed," that is a pipeline-orchestration issue, not an implementation issue. Record it as a Blocker in handoff.md with the `[pipeline]` label and do not retry `git add`/`git commit` to recover — the sandbox blocks `.git` writes by design, and the orchestrator owns the recovery path.\n' +
    '\n' +
    'Communication: tone is project taste; honest signal is canon discipline — surface real disagreement rather than yielding to politeness.\n' +
    'Branch state: the orchestrator manages it — do not fetch, pull, rebase, or push; read the working tree as-is.';

export const QA_STARTUP =
    'Read CHANGELOG.md for voice and version reference, if the project keeps one.\n' +
    'Read docs/lessons-learned.md for recent insights to distill.\n' +
    'No full codebase context needed for QA — read each task\'s spec.md, handoff.md, and notes.md directly.';

export function taskList(tasks: TaskContext[]): string {
    return tasks.map(t => `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/`).join('\n');
}

export function phaseCommands(taskIds: string[], phase: string, status: string, verdict = ''): string {
    return taskIds.map(id => {
        const cmd = verdict
            ? `canon task phase ${id} ${phase} ${status} ${verdict}`
            : `canon task phase ${id} ${phase} ${status}`;
        return `(cd '${resolveTaskCwd(id)}' && ${cmd})`;
    }).join('\n');
}

export function toResumePrompt(prompt: string): string {
    let trimmed = prompt;
    for (const block of [CLAUDE_STARTUP, CODEX_STARTUP, QA_STARTUP]) {
        trimmed = trimmed.replace(`\n\n${block}\n\n`, '\n\n');
    }
    return `[Resumed session — project context loaded. Skip startup boilerplate re-reads (architecture docs, etc.) — re-read any task-specific files explicitly requested in this prompt, then verify the current working tree or artifact before claiming anything is already done.]\n\n${trimmed.trimStart()}`;
}
