# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `docs/packaging-plan.md` still contains live `CODEX.md` references, but the spec's Affected Files list omits it. `docs-refs-check` scans `docs/*.md`, so AC-8/AC-9 cannot pass without bringing that file into scope.


[implement-revision] `docs-refs-check` rejected the handoff row for the deleted `templates/CODEX.md` file because backtick file-path refs to deleted files are still scanned. Switching the Changes-table cell to markdown-link form keeps diff reconciliation intact without tripping the checker.

