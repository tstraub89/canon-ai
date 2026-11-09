# Completion Summary: review-artifact-refs-fixup — Code review: citation rule and docs-refs fix-up for review.md

> For the human. This is what you need to know.

## What Changed

Before this change, the code-review step had no protection against broken file references in its review record. If the reviewer wrote an example path in backticks that is not a real repository file, nothing caught it until you opened the draft PR, and `--pr` stopped. Implement and QA already had both a writing rule and an automatic fix pass; code review did not. Now code review gets the same rule in its prompt, and after the reviewer finishes, canon checks `review.md` and lets the reviewer fix broken references (up to two attempts). The same check runs after the one-shot recovery session that can also write `review.md`. The fix pass may only edit references. If it changes the checked verdict or touches any other file, code review is blocked for the whole bundle, and the run stops before routing. A review that is blocked by the reviewer gets no fix pass. The docs-refs checker also skips two kinds of archived or raw review files: the unsuffixed cold-Codex output and archived `review-prior-N.md` files, so a blocked review that was reset does not keep `--pr` from running. The live `review.md` stays checked.

## Files Changed

- `src/orchestrator/main.ts` — fix-up after the reviewer session and after the recovery session; verdict guard; auto-block stops for code review.
- `src/orchestrator/prompts/index.ts` — fix-up prompt wording for code review (no commit wording; no verdict or finding edits).
- `src/orchestrator/prompts/templates/code-review-foreman.md` — citation rule at the step that writes `review.md`.
- `scripts/docs-refs-check.mjs` — exempts `review-cold-codex.md` and `review-prior-N.md`.
- `templates/scripts/docs-refs-check.mjs` — mirror of the checker change.
- `docs/pipeline-orchestrator.md` — fix-up paragraph now states that a code-review stop auto-blocks the bundle. This was a QA edit to a stale closing sentence (see Open Questions).
- `templates/docs/pipeline-orchestrator.md` — mirror of the docs change, regenerated with `npm run sync-templates`.
- `tests/docs-refs-check.test.ts` — exemption cases, live-review negative control, and the real `archivePriorReview` round trip.
- `tests/run-task-prompts.test.ts` and `tests/run-task-prompts.golden.json` — citation rule in first-round and round-N prompts; fix-up prompt snapshot.
- `tests/run-task-safety-scaffold-push.test.ts` — fix-up, verdict and scope guards, no-session warning, early stops, and the recovery-writer case.
- `dist/orchestrator/run-task.js` — rebuilt tracked bundle.

## How to Test

1. Run a task through code review where the reviewer cites an example path that is not a repository file in backticks.
2. Expected: the run log shows an "Artifact fix-up (attempt 1/2)" line for the reviewer after code review, the backticks are gone from `review.md`, and the verdict is unchanged.
3. Open the draft PR (`canon run <id> --pr`). Expected: no "docs-refs-check found broken refs" abort caused by `review.md`.
4. Optional: after a blocked review and `canon task reset-code-review <id>`, the archived `review-prior-N.md` does not stop `--pr`.
5. Negative case (covered by tests, not required by hand): if a fix pass changes the checked verdict, code review auto-blocks with both verdicts named, and nothing routes.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass (implement run) |
| `npm run type-check` | Pass (implement run) |
| `npm test` | Pass — 2,173 passed, 1 skipped, 0 failed (implement run) |
| `UPDATE_GOLDENS=1 npm test` | Pass — 2,173 passed, 1 skipped, 0 failed (implement run) |
| `npm run build` | Pass (implement run; `dist/orchestrator/run-task.js` rebuilt) |
| `npm run docs-refs-check` | Pass — All refs OK (re-run in QA after the docs edit) |
| `npm run sync-templates:check` | Pass — All canon-managed files in sync (re-run in QA after the docs edit) |

Note: the full test suite was not re-run in QA. The only change made in QA is a one-sentence docs edit with its mirror. The docs-refs and template-sync checks were re-run and pass.

## Human Verification Required

None. No validation check is `human_pending`.

Pre-merge checklist items that QA cannot confirm:
- [ ] Version correct — deferred to the release step; this task does not bump the version.
- [ ] Changelog updated — the proposed entry is below; the human adds it at release.
- [ ] PR body current — drafted in `tasks/review-artifact-refs-fixup/pr-body.md`; re-check after any edit.
- [ ] Final CI/CD checks green — not yet observed on the PR.
- [x] Final diff matches spec intent — every AC in the spec is marked Met in the handoff and Pass in code review.

## Proposed Changelog

### Fixed

- **`--pr` no longer stops on broken references in code-review notes.** Code review now gets the same citation rule and reference fix-up that implement and QA already have, so a backticked example path that is not a repository file is fixed before the draft PR is opened. A fix that changes the review's verdict, or that edits any file other than the review, blocks code review instead.

## Judgment Calls to Confirm

- Reviewer-blocked reviews get no fix-up; the existing stop stays as it is — chosen: no fix-up; alternative: run the fix-up on a blocked review before the stop.
- Verdict mismatch after a fix pass auto-blocks code review — chosen: auto-block; alternative: warn and continue.
- Fix-up runs right after the reviewer session, before the full-send scope check and verdict routing — chosen: run before routing; alternative: run only in the post-phase code-review case.
- Stop behavior for code review is auto-block, not a plain exit — chosen: auto-block; alternative: plain exit, as for implement and QA (a plain exit would send the next run to QA and skip the verdict).
- The recovery session also gets the fix-up — chosen: fix-up after recovery when it completes code review; alternative: fix-up only after the reviewer session.
- Cold-Codex `review-cold-codex.md` is exempt from the checker — chosen: exempt it like the run-N copies; alternative: include it in the fix-up.
- Archived `review-prior-N.md` is exempt from the checker — chosen: exempt; alternative: fix up the blocked review before reset, or rewrite references inside the archive at reset time. Cost: refs inside archives go unchecked.

## Decisions Made

- The citation rule text is written into the foreman template verbatim, not passed as a template variable. The existing code-review prompt renderer has no slot for it, and a test compares the rendered text against the canonical constant, so drift is still caught.
- The code-review reset-command builder is shared by the reviewer-blocked stop and the new fix-up stop. The recovery-hint registry requires each reset-command site to be unique, so this keeps the existing recovery text and does not add a second site.
- The verdict guard runs in a `finally` around each reviewer fix session. It therefore also runs after a non-zero exit or a thrown session error.
- With no stored reviewer session, the fix-up warns and continues. Interactive runs and missing session ids pass no session id, so a stale stored reviewer id is never resumed.
- The recovery fix-up runs only if the post-reviewer fix-up did not run, so at most one fix-up runs per bundle per `canon run`.

## Open Questions

- Non-blocking review nits were left unfixed: (a) no test throws `AgentSessionError` in the fix pass (the `finally` covers it, but no test pins it); (b) the outside-artifact edit has no test on the recovery path (only the verdict flip does); (c) `codeReviewResetCommands` in `src/orchestrator/main.ts` could return its value directly; (d) when one fix session both flips the verdict and edits another file, the verdict message is reported first. The bundle is blocked either way. Decide whether to take these as a follow-up.
- QA edited `docs/pipeline-orchestrator.md` (and its mirror) at the closing sentence of the fix-up paragraph. That sentence said any outside-artifact change "stops the run before commit", which code review no longer does. The new text adds that for code review the stop auto-blocks the bundle. Confirm this wording, or revert it if the paragraph is being rewritten anyway.
- `tasks/review-artifact-refs-fixup/review-cold-codex.md` is empty (0 bytes), and the cold-Codex lens reported no findings. The exemption covers it either way; confirm that an empty raw file is expected.
- Changelog: the version bump tier is for the release step to decide, not QA.
- The spec's Judgment Calls table marks one row `Human` (the decision to fix references in the review rather than exempt `review.md`). The other seven are `Author` calls, listed above.

Maintenance: lessons-learned.md plus this task’s fragment have 37 entries (36 `###` headings in `docs/lessons-learned.md`, counting the example heading, plus 1 in this task's fragment); a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Spec went through 4 spec_review iterations (3 changes_requested) for three gaps: the recovery writer, reviewer-blocked reviews, and archived review-prior files; code review passed with nits only.

## Root Cause

- spec-gap: the first draft gave the fix-up only to the foreman session and missed the one-shot recovery session, which also writes `review.md` (caught in spec_review round 1).
- spec-gap: the first revision did not say whether a reviewer-blocked review gets a fix-up or what happens when it is reset (caught in spec_review round 2).
- spec-gap: the archived `review-prior-N.md` created by a blocked-review reset was not exempted, so `--pr` would still abort after a reset (caught in spec_review round 3).
