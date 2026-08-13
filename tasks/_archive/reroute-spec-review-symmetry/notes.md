# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `runSpecReviewPhase()` and `runPlanPhase()` compute `activeCwd` but do not pass it as the subprocess cwd; relative task paths in those prompts still resolve from REPO_ROOT.

[spec_review] `codex_spec_review` is stored and reused by `runPhase()`; reroute spec_review is not fresh by default, and `recoverPhaseForTask()` still maps spec_review retries to REPO_ROOT.

[implement] `tests/run-task-safety.test.ts` had an existing full-send reroute assertion for the old full-tier `implement` re-entry; the full test suite required updating it to the new `spec_review`/`plan` pending state.

[implement] Changing `docs/pipeline-orchestrator.md` requires syncing `templates/docs/pipeline-orchestrator.md`, even though the task's Affected Files table only named the root doc and `templates/CLAUDE.md`.
