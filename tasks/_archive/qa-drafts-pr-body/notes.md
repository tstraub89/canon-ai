# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `promptQa` is snapshot-tested via `tests/run-task-prompts.golden.json`; any prompt-context change here will need the golden fixture updated too.
[spec_review] `commitTaskArtifactsToBase()` ignores its `_artifactFiles` parameter and stages the whole task dir during human_review, so `TASK_ARTIFACT_FILES` is bookkeeping rather than the real commit mechanism.
