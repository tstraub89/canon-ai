# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `templates/docs/decisions.md` exists but is not a mirror of canon-ai's root `docs/decisions.md`: only `docs/pipeline-orchestrator.md` is registered in `CANON_OWNED`, and the sync script operates from that registry. Specs that amend canon-ai-specific decisions must treat `docs/decisions.md` as root-only unless template ownership is deliberately redesigned.

[implement] Adding fail-fast validation to a shared agent runner can invalidate existing failure-ladder fixtures that used placeholder policy values while targeting a later subprocess branch. Here, four `runCodex` calls in `tests/run-task-safety.test.ts` use the invalid literal `effort`; that file was omitted from the spec's Affected Files even though AC-5 changes the shared runner contract.

[implement] Follow-up authorization allowed the safety fixture correction: the four Codex calls now use valid `high` effort, preserving their intended spawn-error, non-zero, stall, and signal coverage; the full suite passes.

