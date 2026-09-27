# Completion Summary: affected-files-preflight-at-code-review — Catch files outside Affected Files at the code_review pre-flight instead of --pr

> For the human. This is what you need to know.

## What Changed

When an implementer adds a file the spec's Affected Files table doesn't list (a test helper, a fixture, a rebuilt `dist/` artifact), the pipeline used to let it sail through `code_review` and only reject it at the very end, at `--pr` — forcing you to edit the spec and re-run the whole PR step after the file had already been reviewed. Now the same scope check runs immediately before `code_review`. In a normal run, the pipeline halts before any reviewer is spawned, names the out-of-scope file, and gives two fixes: add it to the spec's Affected Files and re-run, or reroute with a note telling the implementer to remove it. In a full-send run, there's no halt — the code-review foreman judges each out-of-scope file itself (a reasonable scope expansion, a spec miss, or something that shouldn't have changed), writes a spec addendum for the first two cases, and requests changes for the third. Separately, `--pr`'s own abort message now distinguishes "the base branch moved ahead of you" from "this file is actually out of scope," instead of always blaming scope for both.

## Files Changed

- `src/orchestrator/validation.ts` — shared Affected-Files allowlist builder (`buildAffectedFilesAllowlist`) used by both `verifyBaseDrift` and the new pre-flight; pure base-drift message classifier.
- `src/orchestrator/phases/code-review.ts` — the new scope pre-flight (normal-run halt, full-send foreman hand-off); post-foreman/post-recovery enforcement lives at the router (see Decisions Made).
- `src/orchestrator/main.ts` — `checkAndRoute` enforces full-send scope after recovery; `--pr`'s base-drift abort message splits base-advanced files from out-of-scope files.
- `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/code-review-foreman.md` — full-send judgment block rendered only when out-of-scope files exist.
- `src/orchestrator/prompts/templates/implement.md` — Scope Discipline rule 1 now names helpers, fixtures, and test files explicitly.
- `docs/pipeline-orchestrator.md` (+ `templates/docs/` mirror) — documents the new gate and the `--pr` message split.
- `docs/codebase-map.md` — corrected a stale line describing `parseAffectedFilesFromSpec`'s only two consumers; it now also feeds the new pre-flight (Docs Freshness pass, this QA).
- `tests/run-task-validation.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` — coverage for the builder, the scope check, the halt/resume/full-send paths, and the router enforcement (including a directory-form amendment and a sibling-bundle amendment, added after code review's Round 3 finding — see Decisions Made).
- `dist/orchestrator/run-task.js` — rebuilt bundle.

## How to Test

1. Run a task where the implementer adds a small helper file the spec's Affected Files table doesn't list.
2. Expected: the pipeline stops before code review starts and names the out-of-scope file, with two ways to fix it (edit the spec's Affected Files and re-run, or reroute to have it removed).
3. Add the file to the spec and re-run. Expected: `code_review` proceeds normally.
4. Run the same scenario as a full-send task. Expected: no stop — the foreman's review judges the file as a reasonable addition, a spec miss, or something to remove; in the first two cases the PR shows a spec addendum explaining why.
5. While a task is running, land an unrelated commit on the base branch, then run `--pr`. Expected: the abort message says the base branch advanced and to merge/rebase, not that the file is out of scope.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests (`npm test`, 1,289 tests) | Pass |
| `code_review`-specific suite (43 tests, incl. inline post-QA fix) | Pass |
| Build (`dist/` matches committed) | Pass |
| `docs-refs-check` | Pass |
| `sync-templates:check` | Pass |

All checks above were re-run fresh by QA at the current HEAD (`4a23fac`), not just taken from the handoff.

## Human Verification Required

None. No `human_pending` rows remain in `handoff.md`'s validation tables (final Iteration 3 re-run was all-`Pass`), and QA's own fresh re-run confirms it.

## Proposed Changelog

- **`code_review` now catches files outside the spec's Affected Files at pre-flight, instead of waiting until `--pr`.** Previously an implementer-added helper, fixture, or rebuilt `dist/` file the spec didn't list would clear `code_review` — even get fully reviewed — only to be rejected at `--pr`'s base-drift check, forcing an operator to edit the spec and re-run the whole PR step. The same scope check now runs immediately before `code_review`: a normal run halts before any reviewer runs, naming the file and offering two fixes (add it to the spec and re-run, or reroute to remove it); a full-send run instead has the code-review foreman judge each out-of-scope file as a reasonable scope expansion, a spec miss, or something that shouldn't have changed, recording the outcome (and, for the first two, a spec addendum) in `review.md`. `--pr`'s own base-drift message now also distinguishes "the base branch advanced" from "this file is out of scope," instead of labeling both cases as scope violations.

## Decisions Made

- **One shared allowlist builder, not two.** `buildAffectedFilesAllowlist` replaces the allowlist logic `verifyBaseDrift` used to build alone; both the new pre-flight and the existing `--pr` gate call it, so the pre-flight can never be stricter than `--pr` will be later.
- **Full-send enforcement moved to the router, not right after the foreman's session.** Code review round 2 found that enforcing directly after the foreman's session call blocks a legitimately recoverable state — a partial `review.md` with no checked verdict yet, which the existing retry path would otherwise finish normally. Enforcement now runs once, at `checkAndRoute`, after recovery has decided the session is actually done. (This is also the subject of a new `docs/lessons-learned.md` entry from this task.)
- **`spec_gap` keeps its own human-triage route** rather than being forced through the same "unamended file → block" rule as other unresolved out-of-scope files. This is a deliberate deviation from a strict reading of AC-6(c), carried from round 1 review and confirmed in round 3; see Open Questions below.
- **Round 3's one remaining finding (R3-1 — test-only, "post-foreman outcome tests pass vacuously" after enforcement moved to the router) was fixed inline after the operator's `canon task accept`**, adding router test cases for a directory-form amendment and a sibling-bundle amendment. Per this repo's below-pipeline review norm, the fix was verified with `codex review` (three rounds; the round reviewing the final commit found no issues) and QA independently re-ran the full suite, lint, type-check, and build fresh at HEAD to confirm.

## Open Questions

- **AC-6(c) vs. `spec_gap`:** the written AC exempts only a `changes_requested` verdict from blocking on an unamended out-of-scope file, but this implementation also exempts `spec_gap` so a human can still triage it. Should a future change close that gap so `spec_gap` blocks too, or is the current human-triage carve-out the intended long-term behavior? (Handoff Iteration 3 Blockers.)
- **Foreman-written amendments and the reroute gate:** a full-send foreman's `## Amendment` section satisfies the *separate* human-reroute amendment gate exactly as a human-written one would, even though no human wrote it. That's a pre-existing spec gap this task surfaced but didn't fix (handoff Iteration 2 Blockers) — worth a follow-up task if it matters to how reroute is meant to work.

## Quality Log
- Spec verdict: changes_requested (round 1 requested changes; approved on the round-2 revision, per `status.json`'s `changes_requested_total: 1`)
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: 3 code-review rounds (1 auto-block escalation) then operator-accepted (sanctioned) at round 3, whose sole remaining finding (test-only) was fixed inline post-acceptance and independently reverified by QA.
