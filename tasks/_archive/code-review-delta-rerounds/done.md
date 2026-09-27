# Done: code-review-delta-rerounds

## Summary

`code_review` re-rounds used to re-review the entire task diff from scratch every round, even when a round was only checking whether the previous round's fix landed correctly — on GalleryPlanner's telemetry, re-rounds (round 2+) were ~55% of all code_review time, the pipeline's single largest cost. This task teaches the orchestrator to scope re-rounds to just the fix: cold-Codex and the cold-Claude lens now review only the delta since the previous round's commit, while the anchored lens still gets the full diff, spec, and handoff. Round 1, XL/delicate tasks, and any round where the previous round's record is missing, unusable, or the fix touched files outside the prior change set still get a full review — no lens is ever skipped. Each round that runs cold-Codex now writes its own numbered archive file instead of overwriting the last one, so every round's findings survive, and `review.md` states each round's scope, base, and reason.

## Files Changed

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts` | Pure full/delta scope resolver, ordered triggers 1–5, owned-path exclusions, 400-line threshold constant. |
| `src/orchestrator/git.ts` | Rename-aware range path sets, ancestry/commit probes, delta line stats — probes return `null` on failure vs. `[]` on an empty success. |
| `src/orchestrator/review-archive.ts` | Numbered cold-Codex archive writer, strict header parser, previous-round lookup, malformed-record detection. |
| `src/orchestrator/phases/code-review.ts` | Pins HEAD before cold-Codex, resolves round/scope, selects the cold-Codex base, archives findings per bundle member, forces full scope on any failed probe. |
| `src/orchestrator/prompts/index.ts` | Shares the runner's round definition with the foreman prompt; renders scope-aware prompt data and a missing-delta-diff fallback. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Scope line, delta-round lens instructions, review.md scope-line instruction, anchored full-diff retrieval command. |
| `.claude/agents/code-review-cold.md` (+ `templates/` mirror) | Adds the sibling-site sweep instruction; keeps every spec-blind prohibition. |
| `.canon/templates/review.md` (+ `templates/` mirror) | Shows the scope line in the Round 1 and `## Round N` expected shapes. |
| `scripts/docs-refs-check.mjs` (+ `templates/` mirror) | Exempts numbered cold-Codex archives from the stale-path gate; `review.md` itself is still checked. |
| `docs/decisions.md`, `docs/pipeline-orchestrator.md` (+ `templates/` mirror) | New decision entry; updated "Code Review Diff Injection" and "Per-Iteration Prompt Slimming" sections. |
| `tests/pipeline-policy.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-prompts.test.ts` (+ golden), `tests/docs-refs-check.test.ts` | New coverage for every AC, including real-git rename and HEAD-movement fixtures. |
| `dist/orchestrator/run-task.js` | Rebuilt bundle. |

## How to Test

1. Run a task through `code_review` where round 1 requests changes and the fix is small. After round 2, open the task folder: there should be two saved cold-Codex records (`review-cold-codex-run-1.md`, `review-cold-codex-run-2.md`), and the second should name the exact commit it reviewed since.
2. Open `review.md`: each round's section should state whether it was a full or changes-only review and why.
3. Run a delicate task through two rounds: both rounds should say full review, reason "delicate".
4. Small fix rounds should be noticeably shorter in the run log (`docs/pipeline-invocations.md`), while every round still shows all three reviewers' input in `review.md`.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final source and tests (Iteration 2 re-run). |
| `npm run type-check` | Pass | Final source and tests (Iteration 2 re-run). |
| `npm test` | Pass | 1,255 passed, 1 skipped (Codex sandbox `gitDirWritable` gate), 0 failed, after golden regeneration. |
| `npm run build` | Pass | Repeated fresh build produced an identical orchestrator bundle hash to the committed `dist/`. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All managed mirrors in sync. |
| `git diff --check` | Pass | No whitespace errors. |
| E2E | N/A | Spec marks E2E N/A — no UI surface. |

## Human Verification Required

None of the automated validation checks are pending — every check above has a concrete Pass/N/A result, none `human_pending`.

Pre-merge checklist:
- [ ] Version bump and changelog entry — not yet applied; text proposed below. Tier and the commit itself are the release step's call (`/canon-changelog` + human), not QA's.
- [ ] PR body reviewed — drafted in `pr-body.md`, needs a read before `--pr`.
- [x] Final CI/CD checks green — full suite, lint, type-check, build, docs-refs-check, sync-templates:check all pass (Iteration 2 re-run validation table above).
- [x] Final diff matches spec intent — code review round 2 verdict: **Approved with nits**, all 14 ACs Met.

## Decisions Made During Implementation

- Kept the diff byte-cap logic inside the range helper rather than extracting a separate `capDiff`, since the existing wrapper already delegates to one implementation.
- Called the pure scope resolver for the Round 1 and XL/delicate cases too, instead of constructing those results directly in the runner, so trigger ordering and reason text live in one place (strengthens AC-1/AC-2).
- Added malformed-archive detection and strict header parsing so a missing previous-round record and an unparseable one get distinct full-scope reasons.
- Left the optional `docs/codebase-map.md` and `docs/product-context.md` edits out — neither currently describes the archive family anywhere that needed updating; the required documentation lives in `docs/decisions.md` and `docs/pipeline-orchestrator.md`.
- (Round 1 review fix) Git's synchronous diff/numstat probes can fail on large output; probe failure (`null`) and an empty successful result (`[]`) are now represented separately, and the resolver forces `full` when a required fact is unavailable rather than silently treating a failure as "nothing changed."
- (Round 1 review fix) The reviewed HEAD SHA is now pinned before cold-Codex starts, not read afterward — a HEAD move during a long cold-review run can no longer make the archive record a commit later than what the cold lens actually saw.
- An archive with an entirely unparseable header cannot reveal which round it belongs to; it's treated as unusable only when no valid round-(N−1) archive exists, forcing a full review and naming the malformed record as the reason. This costs an extra full review in the ambiguous case in exchange for preserving coverage.

## Open Questions Needing Human Input

- **R2-N1 (from `review.md` Round 2): should the sibling-site sweep instruction extend to full rounds' foreman wording, not just delta rounds?** Today, full-round foreman instructions still say "constrain [cold-Claude] to changed files only" for truncated-diff context, while the cold agent's own charter (its system prompt) independently states the sweep applies every round. The two read consistently as written, and the cold lens did sweep beyond changed files in both rounds of this review — but closing the wording gap on full rounds changes full-round lens instructions and would need AC-7's "only the scope line added" constraint relaxed. This is a one-line follow-up for whoever owns the next spec touching this template, not a defect blocking this task.
- Several optional nits from `review.md` (R2-N2 through R2-N7) are documented but explicitly non-blocking — e.g., the pinned HEAD isn't threaded through every full-round diff retrieval command, and per-lens timing / a new `pipeline-invocations.md` column is called out in the spec's Non-Goals as a separate follow-up issue.

## Proposed Changelog

**`code_review` re-rounds now scope cold-lens review to the fix delta instead of re-reviewing the whole diff.** Round 1, XL/delicate tasks, and any round where the previous round's cold-Codex record is missing, unusable, or the fix touched files outside the prior round's change set still get a full-diff review — no lens is ever skipped. Otherwise, cold-Codex and the cold-Claude lens review only the changes since the previous round's commit, while the anchored lens keeps the full diff, spec, and handoff context. Each round that runs cold-Codex now writes its own numbered archive file (`tasks/<id>/review-cold-codex-run-N.md`) recording the round, reviewed commit, scope, and reason, instead of overwriting the last one, so every round's cold-Codex findings survive. `review.md` states each round's scope, base, and reason. The cold-Claude lens's charter also gains a standing sibling-site sweep: when a diff adds or changes a guard, check, or invariant, it now searches the repository for other sites that need the same treatment and reports missing ones.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 3
- Validation gaps: 0
- Notes: Two code_review rounds (changes_requested → approved_with_nits); round 1 found five correctness/risk gaps (F1–F5) in delta-scope edge handling (failed git probes, missing-diff prompt fallback, HEAD pinning, anchored-lens instructions, sweep wording), all fixed and test-pinned in round 2; one non-blocking spec-owner follow-up remains (R2-N1, full-round sweep wording).
