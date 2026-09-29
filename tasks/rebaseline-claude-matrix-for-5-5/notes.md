# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] Removing the duplicate policy fields from `src/orchestrator/env.ts` exposed an existing test in `tests/run-task-harness.test.ts:23-46` that still reads `env.config.maxReviewLoops`; the same behavior is now tested through `policyConfig()` in the scoped policy tests. The spec's Affected Files cap excludes the stale test.
[implement] A fresh build also changes `dist/cli/index.js` because the CLI bundle imports the shared env module. The spec lists only the orchestrator bundle, so the CLI bundle was restored to its pre-task content and the scope gap is recorded in handoff.
[implement-revision] Round 1 review confirmed the old env-config test and CLI bundle are spec Affected Files omissions, and identified two additional out-of-scope guidance docs that still name the old resolver. The current phase keeps these as scope blockers rather than editing them.
[implement-revision] The review's mutation probes showed that representative override assertions missed XL/delicate and legacy+tier boundaries. The revised policy tests check each matrix cell for tier and pin cases.
[implement] Operator manifest correction 2026-09-29: added tests/run-task-harness.test.ts, dist/cli/index.js, docs/patterns.md, docs/codebase-map.md to Affected Files (consequences of AC-4's env.ts duplicate removal; spec author missed them). No AC change; resolves the three [scope] blockers in handoff.md.
[implement-revision] The operator's 2026-09-29 manifest correction added the stale harness test, CLI bundle, and two guidance docs. Retargeting the harness test to `policyConfig()` preserved its malformed/negative/zero assertions; the full suite then passed.
