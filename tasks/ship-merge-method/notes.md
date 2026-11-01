# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

spec: 2026-11-01 Tim approved the spec conversationally after /canon-spec-review (1 BLOCKING + 9 STRONG folded in). Launch only after adopter-bypass-guards ships (AC-9 edits its hook). Not launched.
spec: 2026-11-01 spec_review round 1 BLOCKING (unreadable gh pr list treated as no-PR bypasses pre-flight) folded into Decision, AC-4, AC-8, Affected Files, Impl Notes, Known Risks. Interpretation: gh-unavailable keeps today's skip behavior.
spec: 2026-11-01 spec_review round 1 BLOCKING (unreadable gh pr list read as no-PR bypasses pre-flight) folded into Decision, AC-4, AC-8, Affected Files, Impl Notes, Known Risks. Interpretation: gh-unavailable keeps today's skip behavior. Note: phase 'spec done' was run once before these edits applied (script error); edits applied after.
plan: 2026-11-01 AC-9 prerequisite met (adopter-bypass-guards shipped as #140; hook + tests exist). Interpretation: doctor.ts not edited (spec says only if needed); README gets a new subsection rather than a retitle; mergeOpenPRsAndPull returns a result object so shipTasks restores dirt then dies; assertNoOpenPRForTask gains a mergeMethod param. Note: restore after a failed merge appends onto the base-branch copy of telemetry files (same as the existing post-merge restore), per spec.
[implement] A successful empty `gh pr list --json` response is `[]`; empty stdout is unreadable and must fail the ship pre-flight. The safety fake had modeled no PR as empty stdout, so it needed to emit an empty JSON array once the new fail-closed lookup was wired in.
[implement] The existing pushed-branch guard runs `git fetch`, which updates remote-tracking refs. It now follows the read-only merge-method pre-flight so disallowed or unreadable settings stop before that local git-state change; the regression fixture advances the bare remote to detect an early fetch.
