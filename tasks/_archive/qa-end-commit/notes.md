# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Existing human_review behavior auto-allowlists all PIPELINE_MANAGED_DOCS once qa.status is done; specs for QA-end/push-time commit gates must not assume managed docs still require Affected Files rows after QA.

[spec] Revision addressing round-1 changes_requested: (1) AC-10 inverted — QA-touched managed docs are committed (not flagged) since humanReviewAllowedPath/verifyBaseDrift union all managed docs at qa.status=done; only out-of-union files still abort. (2) BACKLOG.md check-off moved to implement phase (it's not in PIPELINE_SHARED_DOCS, so the QA-end commit can't stage it; implement commits it via the handoff table and base-drift allows it as an Affected File). (3) Added test files tests/run-task-safety.test.ts (staging helper) + tests/run-task-parse-porcelain.test.ts (findUncoveredTrackedChanges/AC-9 — note: NOT validation.test.ts, where Codex guessed). (4) Added templates/docs/pipeline-orchestrator.md mirror row (canon-owned, auto-synced).
[implement] Focused runs of tests/run-task-safety.test.ts need tests/md-loader-register.mjs in addition to tsx because main.ts imports markdown prompt templates; npm test already includes both loaders.
