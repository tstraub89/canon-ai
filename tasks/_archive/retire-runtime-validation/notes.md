# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] AC-39-style structural greps need an allow-list generated from the current tree, not the spec author's assumed touched files; here the grep surfaced live CLAUDE/CODEX/template/runtime prompt references and historical telemetry docs outside the Affected Files table.

[spec_review] Prompt template changes also require checking `tests/run-task-prompts.golden.json`; the prompt fidelity test asserts against that file separately from `tests/run-task-prompts.test.ts`.

[spec_review] AC-39 archive allow-lists need to be generated from `git grep`, not assumed from task relevance; archived status.json snapshots in unrelated tasks can still contain retired phase blocks.

[implement] Migration-tolerance tests that need a legacy retired phase key must build the key dynamically; otherwise AC-39's structural grep catches the test fixture itself.
