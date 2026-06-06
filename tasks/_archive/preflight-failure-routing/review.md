# Code Review: preflight-failure-routing

> Reviewer: Claude | Spec: `tasks/preflight-failure-routing/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All six required checks recorded `Pass`. I independently re-verified the two load-bearing claims rather than rubber-stamping:

- **`npm run build` → `dist/cli/index.js` byte-identical** (handoff Deviation #2): rebuilt from clean and ran the CI gate `git diff --exit-code -- dist/` → **CLEAN**. The committed `dist/scripts/run-task.js` matches a fresh build, and `dist/cli/index.js` genuinely does not change. Confirmed the *why*: the task's new/changed symbols (`classifyPreflightBlockers`, `classifyValidationChecks`, `validateHandoffAgainstSpec`, `extractCitedFilePaths`) are not reachable from the CLI entry bundle (grep count 0 in `dist/cli/index.js`), only from the orchestrator bundle. The spec's Affected-Files entry for `dist/cli/index.js` was over-cautious; the deviation (omit the net-zero row) is correct and avoids a false handoff→diff mismatch. The `--pr` base-drift gate will pass.
- **`npm test`**: re-ran `tests/run-task-validation.test.ts` + `tests/run-task-prompts.test.ts` with the project's `md-loader-register.mjs` → **184 pass / 0 fail**. `npm run type-check`, `npm run sync-templates:check`, `npm run docs-refs-check` all exit 0 on my machine.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: laundering guard rejects own-file "unrelated" | Met | `classifyValidationChecks` (validation.ts:570–589) pushes a `regression` blocker when a cited path is in `changedFiles`. Tested at both the `classifyPreflightBlockersFromData` seam and the `validateHandoffAgainstSpec` gate. |
| AC-2: genuinely-unrelated accept path preserved | Met | Not-in-diff cited file → `continue`, no issue. Tested both levels (in-diff rejected / not-in-diff accepted). |
| AC-3a: format blocker → handoff-fix framing | Met | `buildPreflightReviewBlock` emits `### Fix the handoff` (code-review.ts:58–67). Unit-tested. |
| AC-3b: regression blocker → code-fix framing | Met | `### Fix the code` + "You broke one or more required checks"; test asserts `doesNotMatch(/resubmit handoff/)`. The verdict line reads "…and resubmit." (not "resubmit handoff"), so the retired phrase is genuinely gone. |
| AC-3c: mixed fixable blockers stack both framings | Met | Both sections rendered; `determinePreflightRoute` → `implement`. Unit-tested. |
| AC-4: regression/format routing + counters unchanged | Met (see Nit-3) | Fixable route preserves the exact `taskPhasePreflightRejected(taskId, 'code_review')` call (code-review.ts:211) — counter mechanics untouched. Verified by reading the unchanged call path + `determinePreflightRoute === 'implement'` unit tests. No *dedicated* status.json integration test was added (Nit-3); the counter code is byte-for-byte unchanged so existing counter tests still cover it. |
| AC-5: infra-blocked halts for human | Met | Blocked-only → `route === 'auto_block'` → `autoBlockPhase` + `process.exit(2)` (code-review.ts:192–202); HALTED/triage message with recovery path. Unit-tested. |
| AC-6: priority — fixable wins over halt | Met | `determinePreflightRoute` returns `implement` if any format/regression present, even with blocked rows. Tested (regression+blocked → implement, Infra note present, no Human-triage text). |
| AC-7: declared-canon defense-in-depth | Met | Clause present in all four surfaces: CLAUDE.md:113 ("file Codex changed"), AGENTS.md:107, `code-review-round-1.md`, `implement.md`. `templates/` mirrors synced (`sync-templates:check` clean); golden regenerated for `promptImplement_fresh` + `promptCodeReview_round1` only, as predicted. |
| AC-8: in-diff match tolerates line/col suffix | Met | `extractCitedFilePaths` strips `:\d+(?::\d+)?$`. Tested `:1231` and `:42:7`, plus the no-suffix match. |
| AC-9: test coverage per Validation Gate Discipline | Met | `tests/run-task-validation.test.ts` covers all three buckets, both in-diff directions, the empty-changed-files skip, suffix tolerance, the priority rule, and review-block framing. `*FromData` seam used — no real git repo required. |
| AC-10: implement-revision prompt bucket-neutral | Met | `promptImplementRevisions` pre-flight branch + `implement-revisions.md` rewritten; banner drops "handoff". Direct assertions (`doesNotMatch` the three retired phrases, `match` neutral wording) added to the existing pre-flight-branch test — not the golden (which renders the review-findings branch). |

### Dropped Sections Check

- [x] Non-goals respected — no new `status.json` fields (classification computed at pre-flight, not persisted); no loop-cap/counter-math change; no bundle-cap aggregation change; `Fail`/`blocked`/`Fail – unrelated` state definitions unchanged.
- [x] Known Risks addressed — fuzzy cited-file extraction is explicit + tested both directions; bundle-union behavior documented in `notes.md`; declared+executable layers both landed together (AC-1 + AC-7); `review.md` append/overwrite convention preserved (`hasPriorRealReview` + non-`## Round` heading); halt path emits a recovery message; AC-10 neutral-prompt↔block coupling preserved (heading names `## Validation Gate` / `## Pre-Flight Rejection` kept stable).
- [x] Human Test Plan satisfiable — all five scenarios map to implemented behavior.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-scoped implementation that matches the plan closely. The classification logic is centralized in one pure, tested seam (`classifyPreflightBlockersFromData`) and reused by both the live wrapper and `validateHandoffAgainstSpec`, so routing and messaging derive from one source — exactly what the spec asked for. Type safety is sound (no `any`, `ReadonlySet` for the changed-files contract). The declared and executable layers landed together. No correctness bugs found. The only observations are cosmetic edge cases in bundle mode and one indirect-rather-than-direct test coverage point — all non-blocking.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Nit-1 (bundle edge — wording):** In a bundle where one task carries *only* a `blocked` blocker but a peer task has a fixable blocker, `determinePreflightRoute` correctly returns `implement` bundle-wide (AC-6), and `buildPreflightReviewBlock` is then called for the blocked-only task with `route='implement'`. That task's `review.md` renders just the `### Infra note (address the above first)` section + "Address the fixable items above first…" + a `Changes requested` verdict — but there are no fixable items *in that task's own block*. The wording is slightly off for the isolated per-task view (the fixable work lives in the peer's block). Behavior is correct (whole bundle reroutes; the blocked row resurfaces next pre-flight); only the standalone-task message reads oddly. Not worth a re-implement cycle.

- **Nit-2 (bundle edge — dropped bundle issues on missing handoff):** `classifyPreflightBlockersFromData` early-returns `[format('handoff.md not found')]` when `handoffMissing`, which discards the `bundleDiffIssues` passed in for that task. Old code surfaced both "handoff.md not found" *and* the bundle issues. This is a degenerate case (a missing handoff already routes to implement, and the bundle issues resurface once the handoff exists), so the practical impact is nil — noting only for completeness.

- **Nit-3 (AC-4 verification is indirect):** AC-4's *Verify* asked for "a test inspecting `status.json` after the rejection." The new tests assert the route (`determinePreflightRoute === 'implement'`) but there's no dedicated status.json integration test for the preflight-counter increment. Because the `taskPhasePreflightRejected` call is byte-for-byte unchanged, existing counter tests still cover the mechanic and a new test would only re-test unchanged behavior — acceptable, but flagging that the literal AC-4 verification surface is covered by inference rather than a fresh assertion.

#### Spec Gaps

(none — the spec was unusually precise; mechanics were correctly deferred and the implementation filled them sensibly.)

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

> All three nits are optional/cosmetic (two bundle-mode edge cases + one test-coverage observation). None block shipping. The loop should exit here; nits ride along to QA.

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N-1's response to round N-1

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->

## Round 2 — verifying the reroute implementation (spec Amendment: AC-1a, AC-1b)

The task rerouted from `human_review` (`implement.rerouted: true`, `reroute_count: 1`) to implement the `## Amendment` added after CodeRabbit's P2 on PR #138. The amendment closes two laundering bypasses the original AC-1/AC-8 missed: absolute-path citations and bare basenames. Round 1's review predates the amendment, so I re-checked every AC (original + amendment) against the current tree, not just the delta.

**Independent re-verification (not rubber-stamped):**
- `npm run build` from clean → `git diff --exit-code -- dist/` is **CLEAN**. `dist/cli/index.js` is genuinely byte-identical (the changed validation symbols tree-shake out of the CLI bundle — `grep -c` of the new symbols in `dist/cli/index.js` = 0, in `dist/scripts/run-task.js` = 7). Deviation #4 (omit the net-zero `dist/cli/index.js` row) confirmed correct; `--pr` base-drift gate will pass.
- Re-ran `tests/run-task-validation.test.ts` + `tests/run-task-prompts.test.ts` → **188 pass / 0 fail** (up from Round 1's 184 — the 4 added rows are the amendment's coverage).
- `docs/decisions.md` edit is not in the spec's Affected Files, but it is a `PIPELINE_MANAGED_DOCS` entry, auto-allowlisted at the `--pr` base-drift gate once `qa.status = done` — so it will not strand the ship.

### Stage 1 — Acceptance Criteria Re-Check (every AC against current code)

| AC | Status | Notes |
|---|---|---|
| AC-1: laundering guard rejects own-file "unrelated" | Met (unchanged) | `classifyValidationChecks` → `regression` when a cited path matches `changedFiles` (validation.ts:607–625). |
| AC-1a: absolute-path citation → in-diff match | **Met (new)** | `matchAgainstChangedFiles` (validation.ts:433–444) detects POSIX `/…` and Windows `C:/…` absolutes and walks right-suffixes against the repo-relative changed set. Tested: `/workspace/repo/e2e/specs/editor.spec.ts:1231` with `e2e/specs/editor.spec.ts` changed → `regression`. |
| AC-1b: bare basename without `:line` → rejected at outer gate | **Met (new)** | `hasSpecificFailUnrelatedReference` (validation.ts:402–414) requires `:line` OR (separator AND extension). `editor.spec.ts` → `format` (insufficient reference); `editor.spec.ts:1231` → passes outer gate, proceeds to Stage 1 credibility (not auto-matched to the in-diff path — by design). Both directions tested. |
| AC-2: genuinely-unrelated accept preserved | Met (unchanged) | Not-in-diff cited file → no issue. Tested. |
| AC-3a/3b/3c: format / regression / mixed framing | Met (unchanged) | `buildPreflightReviewBlock` emits `### Fix the handoff` / `### Fix the code` / both; regression block omits the retired "resubmit handoff" line. |
| AC-4: routing + counters unchanged | Met (see Nit-3, carried) | Fixable route still calls `taskPhasePreflightRejected` unchanged; `determinePreflightRoute → implement` tested. |
| AC-5: infra-blocked halts | Met (unchanged) | Blocked-only → `auto_block` → `autoBlockPhase` + recovery message. |
| AC-6: fixable wins over halt | Met (unchanged) | Any format/regression present → `implement`. Tested. |
| AC-7: declared-canon defense-in-depth | Met (unchanged) | Clause in CLAUDE.md, AGENTS.md, `code-review-round-1.md`, `implement.md`; `templates/` mirrors synced. |
| AC-8: suffix tolerance (`:line`, `:line:col`) | Met (unchanged) | `stripCitedLocation` strips `:\d+(?::\d+)?$`. Tested. |
| AC-9: test coverage | Met (extended) | All three buckets, both in-diff directions, empty-set skip, suffix tolerance, absolute-path match, bare-basename gate (both directions), priority rule, review-block framing. `*FromData` seam — no real git repo. |
| AC-10: bucket-neutral revision prompt | Met (unchanged) | Pre-flight branch + `implement-revisions.md` neutral; banner drops "handoff"; direct assertions in the pre-flight-branch test (not the golden). |

### Verifying the amendment changes

- _amendment fix #1 (tighten outer reference gate):_ implemented as `hasSpecificFailUnrelatedReference`, replacing the old `/\w+\.\w+|:\d+/`. Deviation #3 (require separator+extension rather than any slash) is sound — it preserves the existing vague-prose rejection (`unit/e2e failure` won't masquerade as a file ref) ✓
- _amendment fix #2 (normalize absolute paths):_ implemented as a separate `matchAgainstChangedFiles` suffix-walk rather than mutating `extractCitedFilePaths` (Deviation #2) — keeps extraction and comparison independently testable ✓

### New findings (introduced by the reroute)

(none — no correctness or risk findings; the amendment is clean and the original behavior is preserved.)

The right-suffix walk in `matchAgainstChangedFiles` can theoretically false-positive when a changed file path is a proper suffix of an unrelated absolute citation (e.g. changed `specs/x.ts` vs cited `/repo/e2e/specs/x.ts`). The spec's Known Risks explicitly accepts this — it errs toward `regression` (sends back to implement, where the implementer cites a clearly-outside file), never toward laundering. Not a finding.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Amendment correctly implemented; all 14 ACs Met against current code. The three Round-1 nits (two bundle-mode wording edges + one indirect AC-4 test) are unchanged and remain optional — they ride to QA. Loop exits here.

## Round 3 — verifying the reroute implementation (spec Amendment Round 2: AC-1c, AC-1d)

The task rerouted a second time from `human_review` (`implement.rerouted: true`, `reroute_count: 2`) to implement `## Amendment Round 2`, added after CodeRabbit's P2 on PR #139. That amendment closes the one citation form Amendment 1 still let through: `editor.spec.ts:1231` (bare basename **with** a `:line`). After Amendment 1 it passed the outer reference gate, then `matchAgainstChangedFiles` did `changedFiles.has('editor.spec.ts')` — an exact match against repo-relative keys — which always returned false, so the regression laundered. Round 2's table noted this case as "not auto-matched to the in-diff path — by design"; **Amendment Round 2 reverses that on purpose**, so I re-checked every AC against the current tree (not just the delta) to catch the supersession.

**Independent re-verification (not rubber-stamped):**
- `npm run build` from clean → `git diff --exit-code -- dist/` is **CLEAN**. `dist/cli/index.js` byte-identical confirmed again via `grep -c` (new symbols: 0 in the CLI bundle, 7 in `dist/scripts/run-task.js`). Deviation #4 (omit the net-zero `dist/cli/index.js` row) still correct; `--pr` base-drift gate will pass.
- Re-ran `tests/run-task-validation.test.ts` + `tests/run-task-prompts.test.ts` with the project's `md-loader-register.mjs` → **189 pass / 0 fail** (up from Round 2's 188 — the two added rows are AC-1c's positive/negative coverage; the bare-basename row from Amendment 1 was repurposed).
- Confirmed `matchAgainstChangedFiles`'s three branches are mutually exclusive and the new branch does not regress the others: absolute (`/…` or `C:/…`) → right-suffix walk; relative-with-`/` → exact `has()`; bare basename → last-segment scan. AC-1's exact-match and AC-1a's absolute-suffix paths are untouched.

### Stage 1 — Acceptance Criteria Re-Check (every AC against current code)

| AC | Status | Notes |
|---|---|---|
| AC-1: laundering guard rejects own-file "unrelated" | Met (unchanged) | `classifyValidationChecks` → `regression` when a cited path matches `changedFiles` (validation.ts:615–633). |
| AC-1a: absolute-path citation → in-diff match | Met (unchanged) | `matchAgainstChangedFiles` right-suffix walk (validation.ts:446–451). Tested POSIX + Windows. |
| AC-1b: bare basename without `:line` → rejected at outer gate | Met (behavior now downstream-superseded by AC-1c) | `hasSpecificFailUnrelatedReference` (validation.ts:402–414) still rejects `editor.spec.ts` (no `:line`, no separator) as `format`. The Round-2 caveat ("`editor.spec.ts:1231` passes to Stage 1, not auto-matched") is **no longer true** — see AC-1c. The outer-gate rejection of the no-`:line` form is unchanged and tested (2466). |
| AC-1c: basename + `:line` → in-diff match via last-segment scan | **Met (new)** | `matchAgainstChangedFiles` (validation.ts:439–442): when the cited token has no path separator, compares it against the last segment of every changed file. `editor.spec.ts:1231` with `e2e/specs/editor.spec.ts` changed → `regression` (test 2477); `foo.spec.ts:1231` with the same diff → no issue, preserves the genuinely-unrelated accept path (test 2488). Unit coverage in `matchAgainstChangedFiles` test too (2440–2441). |
| AC-1d: known limitations documented in Known Risks | **Met (new)** | spec Known Risks (spec.md:124) + the Amendment Round 2 threat-model table (spec.md:173–182) enumerate all three residual gaps — `:line`-only, same-basename false-positive, URL citation — each with a safe-direction rationale. |
| AC-2: genuinely-unrelated accept preserved | Met (unchanged) | Not-in-diff cited file (full path or non-colliding basename) → no issue. Tested (2488, 2497). |
| AC-3a/3b/3c: format / regression / mixed framing | Met (unchanged) | `buildPreflightReviewBlock` emits `### Fix the handoff` / `### Fix the code` / both; regression block omits the retired "resubmit handoff" line. |
| AC-4: routing + counters unchanged | Met (see Nit-3, carried) | Fixable route still calls `taskPhasePreflightRejected` unchanged; `determinePreflightRoute → implement` tested. |
| AC-5: infra-blocked halts | Met (unchanged) | Blocked-only → `auto_block` → `autoBlockPhase` + recovery message. |
| AC-6: fixable wins over halt | Met (unchanged) | Any format/regression present → `implement`. Tested. |
| AC-7: declared-canon defense-in-depth | Met (unchanged) | Clause in CLAUDE.md, AGENTS.md, `code-review-round-1.md`, `implement.md`; `templates/` mirrors synced (`sync-templates:check` clean). |
| AC-8: suffix tolerance (`:line`, `:line:col`) | Met (unchanged) | `stripCitedLocation` strips `:\d+(?::\d+)?$`. Tested. |
| AC-9: test coverage | Met (extended) | Adds AC-1c positive/negative to the prior set (three buckets, both in-diff directions, empty-set skip, suffix tolerance, absolute match, bare-basename gate, priority). `*FromData` seam — no real git repo. |
| AC-10: bucket-neutral revision prompt | Met (unchanged) | Pre-flight branch + `implement-revisions.md` neutral; banner drops "handoff"; direct assertions in the pre-flight-branch test (not the golden). |

### Verifying the amendment changes

- _Amendment Round 2 fix (last-segment basename scan):_ implemented as a third branch in `matchAgainstChangedFiles` guarded by "no path separator after normalization," so it cannot shadow the absolute or relative-with-`/` branches. Closes `editor.spec.ts:1231` exactly as the threat-model table requires ✓
- _Supersession handled cleanly:_ the change is purely additive to the matcher; the outer-gate rejection (AC-1b) and the absolute/relative branches (AC-1/AC-1a) are byte-unchanged. No previously-Met AC regressed.

### New findings (introduced by the Round 2 amendment)

(none — no correctness or risk findings. Per the Round 3+ tightening rule I am not opening new nits; the two documented residual gaps — `:line`-only and URL citations — are explicitly accepted in Known Risks and route to Claude Stage 1, never toward laundering.)

The same-basename over-catch is worth one sentence of operator awareness for QA (not a finding, already in Known Risks): common basenames like `index.ts`/`utils.ts` make the last-segment scan over-catch more readily than the spec's `editor.spec.ts` example implies. It is self-correcting — the implementer escapes a false "fix the code" by re-citing the genuinely-unrelated failure with its full path, which the relative-with-`/` exact-match branch then correctly treats as not-in-diff. Safe direction, no change needed.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Amendment Round 2 correctly implemented; all 14 ACs Met against current code, with AC-1b's downstream behavior intentionally superseded by AC-1c (verified, not a regression). The three standing nits (two bundle-mode wording edges + the indirect AC-4 test) are unchanged and remain optional — they ride to QA. Loop exits here.

## Round 4 — verifying the reroute implementation (spec Amendment Round 3: AC-11)

The task rerouted a third time from `human_review` (`implement.rerouted: true`, `reroute_count: 3`) to implement `## Amendment Round 3`, added after CodeRabbit's P2 on PR #139. That amendment closes a behavioral **regression introduced by this very task's refactor**: the original `validateHandoff` ran an all-row `hasFail` scan that blocked on any `Fail` result anywhere in the Validation Outcomes table; the refactor to `classifyValidationChecks(requiredChecks, …)` iterates only the spec's `[x]`-checked items, so a plain `Fail` on a check Codex ran voluntarily (not in `Validation Required`) was silently ignored — a task could proceed to Claude review with an explicitly failed non-required check. AC-11 restores the all-row plain-`Fail` block. I re-checked every AC against the current tree (not just the delta), since the refactor regression and its fix both live in the shared classifier.

**Independent re-verification (not rubber-stamped):**
- Ran all six required checks myself on the current tree: `npm run lint` (clean), `npm run type-check` (clean), `npm test` → **745 pass / 0 fail**, `npm run build` then `git diff --stat -- dist/` → **CLEAN** (committed `dist/scripts/run-task.js` matches a fresh build; `dist/cli/index.js` byte-identical — Deviation #4 still correct, `--pr` base-drift gate will pass), `npm run sync-templates:check` (all canon-managed files in sync), `npm run docs-refs-check` (all refs OK). The handoff's "744 pass, 1 skipped" vs my "745 pass, 0 skipped" is an environment delta on a conditionally-skipped test, not a failure — 0 failures either way.
- Read the AC-11 implementation directly (`classifyPreflightBlockersFromData`, validation.ts:643–670). The non-required scan is **purely additive** after `classifyValidationChecks`: it skips any row whose canonical key is already in `requiredCanonicalKeys` (validation.ts:654, no double-count) and excludes `Fail – unrelated` via `!isUnrelatedFailResult` (validation.ts:655, so non-required unrelated rows stay on the Claude Stage 1 accept path). Confirmed the required-check classification path is byte-unchanged — no previously-Met AC can regress through this change.
- Traced the no-double-count invariant for the worst case: a **required** in-diff `Fail – unrelated` row hits the `isUnrelatedFailResult` regression branch in `classifyValidationChecks` (validation.ts:615–633) exactly once; its canonical key is in `requiredCanonicalKeys`, so the non-required scan skips it, and even absent that skip the `!isUnrelatedFailResult` guard would exclude it. One blocker, not two. Test 2554 confirms the plain-`Fail` required case emits a single regression with the *required-path* message.

### Stage 1 — Acceptance Criteria Re-Check (every AC against current code)

| AC | Status | Notes |
|---|---|---|
| AC-1: laundering guard rejects own-file "unrelated" | Met (unchanged) | `classifyValidationChecks` → `regression` when a cited path matches `changedFiles` (validation.ts:621–631). Byte-unchanged by Round-3 amendment. |
| AC-1a: absolute-path citation → in-diff match | Met (unchanged) | `matchAgainstChangedFiles` right-suffix walk (validation.ts:446–451). Test 2437/2439 (POSIX + Windows). |
| AC-1b: bare basename without `:line` → rejected at outer gate | Met (unchanged) | `hasSpecificFailUnrelatedReference` (validation.ts:402–414) rejects `editor.spec.ts` as `format`. Test 2466. |
| AC-1c: basename + `:line` → in-diff match via last-segment scan | Met (unchanged) | `matchAgainstChangedFiles` no-separator branch (validation.ts:439–443). Test 2477 (caught) / 2488 (non-matching basename accepted). |
| AC-1d: known limitations documented in Known Risks | Met (unchanged) | spec.md:124 + Amendment Round 2 threat-model table (spec.md:173–182): `:line`-only, same-basename false-positive, URL citation — each with safe-direction rationale. |
| AC-2: genuinely-unrelated accept preserved | Met (unchanged) | Not-in-diff cited file → no issue (required path test 2497; non-required path now also test 2545). |
| AC-3a/3b/3c: format / regression / mixed framing | Met (unchanged) | `buildPreflightReviewBlock` emits `### Fix the handoff` / `### Fix the code` / both; regression block's verdict line is "…and resubmit." — the retired "resubmit handoff" phrase is genuinely absent. New AC-11 regression blockers flow into `### Fix the code` (regression bucket). |
| AC-4: routing + counters unchanged | Met (see Nit-3, carried) | Fixable route still calls `taskPhasePreflightRejected` unchanged; `determinePreflightRoute → implement` tested. AC-11's non-required `Fail` is a regression bucket → fixable → implement, same counter path. |
| AC-5: infra-blocked halts | Met (unchanged) | Blocked-only → `auto_block` → `autoBlockPhase` + recovery message (code-review.ts:192–202). A non-required plain `Fail` is a fixable regression, so it never strands the halt path. |
| AC-6: fixable wins over halt | Met (unchanged) | Any format/regression present → `implement`. AC-11 regression blockers are fixable, so they correctly defeat a co-present blocked row. |
| AC-7: declared-canon defense-in-depth | Met (unchanged) | Clause present in CLAUDE.md:113, AGENTS.md:107, `code-review-round-1.md:30`, `implement.md:22`; `templates/` mirrors synced (`sync-templates:check` clean). Untouched by Round-3 amendment. |
| AC-8: suffix tolerance (`:line`, `:line:col`) | Met (unchanged) | `stripCitedLocation` strips `:\d+(?::\d+)?$`. Test 2421–2423. |
| AC-9: test coverage | Met (extended) | Prior set + four AC-11 rows: non-required `Fail` → regression (2524), non-required `Pass` → none (2536), non-required `Fail – unrelated` → accept (2545), required `Fail` not double-counted (2554). `*FromData` seam — no real git repo. |
| AC-10: bucket-neutral revision prompt | Met (unchanged) | Pre-flight branch + `implement-revisions.md` neutral; banner drops "handoff"; direct assertions in the pre-flight-branch test (not the golden). Untouched by Round-3 amendment. |
| AC-11: non-required plain-Fail row → regression blocker | **Met (new)** | `classifyPreflightBlockersFromData` (validation.ts:643–670) scans all `latestResults` after required-check classification; `isFailResult && !isUnrelatedFailResult` AND not-already-required → one `regression` blocker with "not listed in spec's required checks … fix the regression" framing. Non-required `Pass`/`Fail – unrelated` produce nothing; required `Fail` not double-counted. All four verify clauses tested (2524/2536/2545/2554). |

### Verifying the amendment changes

- _Amendment Round 3 fix (restore non-required plain-`Fail` block):_ implemented as a post-pass over `latestResults` in `classifyPreflightBlockersFromData`, guarded by the required-key skip set and the `!isUnrelatedFailResult` exclusion. Restores the pre-refactor all-row block intent. The new scan uses the prefix-based `isFailResult` (`/^fail/i`) rather than the old exact `=== "fail"` match — this is *broader* (also catches `Failed`, `Fail: …`) but only ever in the safe direction (more failures flagged), is consistent with the file's other prefix-based predicates (`isPassResult`), and the implementer's escape hatch for a genuine non-mine failure is `Fail – unrelated` (excluded). Not a finding. ✓
- _Supersession handled cleanly:_ the change is additive; the required-check classifier, the laundering guard (AC-1/1a/1c), the outer gate (AC-1b), and the routing/framing (AC-3/4/5/6) are byte-unchanged. No previously-Met AC regressed.

### New findings (introduced by the Round 3 amendment)

(none — no correctness or risk findings. Per the Round 3+ tightening rule I am not opening new nits; the broader-prefix-match observation above is safe-direction and intentional.)

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Amendment Round 3 (AC-11) correctly implemented; all 17 ACs Met against current code. The Round-3 change is a clean, additive, deduped restoration of the all-row plain-`Fail` block with no regression to any prior AC, independently verified against the full green check suite. The three standing nits (two bundle-mode wording edges + the indirect AC-4 test) remain optional and ride to QA. Loop exits here.
