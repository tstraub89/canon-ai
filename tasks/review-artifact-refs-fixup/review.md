# Code Review: review-artifact-refs-fixup

> Reviewer: Claude (foreman) | Spec: `tasks/review-artifact-refs-fixup/spec.md`

Synthesized from the anchored Claude lens, the cold-Claude lens, and the injected cold-Codex findings (clean: no actionable regressions).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (AC-2 and AC-10 rows against `bbaa053`)
- [x] Self-Check evidence in the effective record is not contradicted by the diff

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Prompt rule | Pass | Rule in the foreman template; first-round and round-N prompt tests; goldens regenerated. |
| AC-2: Fix-up runs and fixes | Pass | Test asserts attempt 1/2 log, reviewer resume, fixed ref, routing to implement. |
| AC-3: Verdict guard | Pass | Zero-exit and non-zero-exit flips both auto-block, naming task and both verdicts. Guard runs in `finally`. |
| AC-4: Scope guard | Pass | Outside-artifact edit auto-blocks code_review. |
| AC-5: No session | Pass | Warns with findings and the fix-before-`--pr` instruction; continues. |
| AC-6: Early stop | Pass | `spec_gap` gets fix-up before stop; blocked review runs no fix-up. |
| AC-7: Fix-up prompt | Pass | No commit wording; forbids verdict/finding changes; golden covered. |
| AC-8: Checker exemptions | Pass | `review-cold-codex.md`, `review-prior-1.md`, `review-prior-12.md` exempt; `review.md` still fails. |
| AC-9: Docs | Pass | Both copies updated (one stale closing sentence, see nits). |
| AC-10: Recovery path | Pass | One fix-up after recovery, none after the incomplete foreman return; verdict flip auto-blocks. |
| AC-11: Blocked-review recovery | Pass | Archives via real `archivePriorReview`; checker then clean. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

The fix-up reuses the shared helper with a stop callback and a `finally`-wrapped verdict guard, and both `review.md` writers (foreman, recovery) reach it. Behavior matches the spec on every verdict and recovery path I traced. Only wording and test-coverage nits survive.

### Findings

#### Correctness Bugs

(none)

#### Spec Gaps

(none)

#### Nits / Cleanup (non-blocking)

- **Stale closing sentence in docs** (anchored; `docs/pipeline-orchestrator.md:375`, mirrored in `templates/docs/pipeline-orchestrator.md:375`). The paragraph still ends "any change outside that phase's own artifacts stops the run before commit." For code_review the stop auto-blocks the bundle and nothing is committed; the earlier sentences in the same paragraph state this correctly, so the tail is only loosely contradictory. Wording-only. Verified against the doc text.
- **Missing recovery-site test for outside-artifact edit** (anchored; `tests/run-task-safety-scaffold-push.test.ts`). AC-10 names verdict change and outside-edit; only the verdict-flip has a recovery test. Both share the same `onStop` path.
- **No test throws `AgentSessionError`** (anchored; `tests/run-task-safety-scaffold-push.test.ts`). The `flip-fail` case covers the non-zero-exit path; the thrown path is protected only by the `finally`.
- **`codeReviewResetCommands` assigns then returns a local** (anchored; `src/orchestrator/main.ts`). Could return directly.
- **Guard runs before scope check** (cold-Claude; `src/orchestrator/main.ts:633-642`). If a fix session both flips a verdict and edits an outside file, the verdict message is reported first and the file list is not. The bundle is blocked either way.
- **Guard has no pre-fix baseline** (cold-Claude low, anchored low). The spec (Decision item 4) requires the post-fix checked-vs-recorded equality; the phase gate already enforces equality when code_review is marked `done`, so a pre-existing mismatch only arises via manual edits. Consistent with the spec.
- **No-session behavior differs from the recovery path** (cold-Claude, anchored). Main path passes `null` when `lastSessionId` is empty. Matches AC-5 warn-and-continue; `--pr` stays the backstop.

## Dismissed Cold Findings

- Dismissed (cold-Claude): the verdict guard misreads a reroute round because the phase gate takes the verdict from `## Amendment Review` - reroute evidence applies only to `spec_review` and `plan` (`src/orchestrator/validation.ts:330-331`: "Only spec_review and plan are reroute-gated"); code_review always uses `extractCheckedVerdict(content)`, the same function the guard uses.
- Dismissed (cold-Claude): `process.exit` in the `finally` replaces a thrown `reviewer.run` error - intended; the spec requires the guard to run and auto-block even on a thrown `AgentSessionError`.
- Dismissed (cold-Claude): earlier-round text and findings are not protected by the guard - the spec scopes the guard to the checked verdict; prose edits are an accepted risk ("visible in the diff", Known Risks).
- Dismissed (cold-Claude): the new exemptions live only in `isNoisySourceFile` and other scanners were not checked - speculative (the lens stated it did not check); the AC-8/AC-11 tests exercise `runChecks` end to end and pass.
- Dismissed (cold-Codex): no findings; nothing to adjudicate.

## Final Verdict

- [ ] **Approved**
- [x] **Approved with nits** — non-blocking wording and test-coverage items above
- [ ] **Changes requested**
- [ ] **Needs re-review**
- [ ] **Spec gap**
