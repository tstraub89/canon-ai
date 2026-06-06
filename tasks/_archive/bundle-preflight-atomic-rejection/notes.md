# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Bundle-atomic pre-flight specs must preserve both route classes: fixable blockers reroute to implement, but blocked-only infrastructure failures stay on the auto-block/human-triage path.
[spec_review] Non-`## Round` pre-flight append blocks with checked verdicts can parse as stale prior verdicts; prior approved review + appended changes_requested stub still extracts approved.
[implement] Plan requested a `src/task/index.ts` docstring update, but the spec's Affected Files table did not authorize that file; left it untouched under the scope cap.
[implement] `npm run build` changed `dist/scripts/run-task.js` only; `dist/cli/index.js` stayed byte-identical despite being listed as an expected generated artifact.
[implement] `npm run docs-refs-check` fails on pre-existing missing refs in `docs/decisions.md` to archived `tasks/codex-code-review-phase/*` files outside this task's diff.

