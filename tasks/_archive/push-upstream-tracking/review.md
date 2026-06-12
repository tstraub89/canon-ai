# Code Review: push-upstream-tracking

> Reviewer: Claude | Spec: `tasks/push-upstream-tracking/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All four required checks (lint, type-check, test, build) report Pass. The three optional checks (sync-templates:check, docs-refs-check, E2E) are marked `not_configured` with correct spec citations.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Clean-tree push path sets `-u` | Pass | `scripts/run-task/main.ts:1117` uses `gitSafeAt(cwd, 'push', '-u', 'origin', branchName)`; `tests/run-task-safety.test.ts` asserts `/^push -u origin task\/task-a$/m` for this path. |
| AC-2: Dirty-tree commit-then-push path sets `-u` | Pass | `scripts/run-task/main.ts:1215` uses same form; corresponding safety test asserts the same push arg vector for the dirty-tree path. |
| AC-3: `rev-parse --abbrev-ref <branch>@{upstream}` resolves to `origin/<branch>` | Pass | `tests/run-task-ship.test.ts:520` asserts this on a real git fixture after `--pr`. |
| AC-4: `git status -sb` header shows tracking line | Pass | `tests/run-task-ship.test.ts:521` and `:533` assert the `## branch...origin/branch` header after both first and second `--pr` runs. |
| AC-5: Idempotent — second `--pr` succeeds with tracking intact | Pass | `tests/run-task-ship.test.ts:525-534` runs `--pr` twice; both exit 0 and tracking ref is asserted after each. |
| AC-6: Push-failure still triggers `die(...)` with message intact | Pass | `tests/run-task-safety.test.ts` new test forces `FAKE_GIT_FAIL_PUSH=1` and asserts `stderr` matches `/Human review push failed: simulated push failure/`. The push args are still logged by the fake-git harness (line 51 logs `$*` unconditionally before any conditional branches), so the accompanying git.log assertion is also valid. |

### Dropped Sections Check

- [x] Non-goals respected — no change to commit content, PR creation, base-drift gate, `--ship` path, or failure handling
- [x] Known Risks addressed — `-u` idempotency is covered by AC-5 and the integration test
- [x] Human Test Plan is satisfiable — the implementation matches the four-step manual flow described

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A minimal, focused change: four characters (`-u` flag) added at two call sites in `commitHumanReviewFiles`, plus a matching dist rebuild, and comprehensive test coverage. All existing tests updated correctly; new tests added for the tracking-ref and push-failure paths. No logic-flow change, no new error paths, no structural risk.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **`--set-upstream` fake-git branches are dead code** (flagged by both lenses) — `tests/run-task-safety.test.ts:133`. The new fake-git harness handles both `-u` and `--set-upstream` spellings for task-branch and base-branch pushes, but production exclusively uses `-u`. The four `--set-upstream` branches (lines 133–135, 139–141) are unreachable under the current implementation. They add no coverage value and could mislead a future reader into thinking `--set-upstream` is a supported invocation form. Safe to remove; not blocking.

- **`--push` real-git integration test removed** (cold lens) — `tests/run-task-ship.test.ts:497-536`. The previous test `'--push keeps the artifacts commit unmarked'` used a real git fixture to verify the `--push` commit-marker and `.pr-number`-absent behavior. It was replaced by a `--pr`-based tracking test. The `--push` upstream-tracking behavior is now covered only by fake-git safety tests (which assert the `-u` arg vector) — not by a real-git test that confirms the tracking ref actually establishes. The spec does not require a `--push` real-git test, and the implementation change is identical for both paths, so this is not a spec gap. Minor coverage reduction; not blocking.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **`classifyMergeOutcome` assertion changed `'tolerate'` → `'clean'`** — diff presentation artifact. The actual file at `tests/run-task-safety.test.ts:2498` still asserts `'tolerate'`; this line appeared in the diff context window adjacent to the new push-failure test insertion but was not part of the change.

- **`FAKE_GIT_BASE_BRANCH` empty-string match in new fake handlers** — if `FAKE_GIT_BASE_BRANCH` is unset, `[ "${4:-}" = "" ]` would match a push with an empty 4th arg. Production guards `if (branchName)` before every push call, making an empty-branch push unreachable. Risk is theoretical.

- **`.pr-number` readFileSync throws if file absent** — a failing test throws instead of failing cleanly; this is a harness ergonomics concern, not a correctness bug.

- **AC-6 git.log assertion validity** (anchored — self-resolved after inspection) — the concern was whether the fake-git logs the push command before the failure branch exits. Line 51 of the fake-git script (`printf "%s\n" "$*" >> "$FAKE_GIT_LOG"`) runs unconditionally before any conditional, so the push args are always logged regardless of the failure branch. Dismissed.

- **`\.{3}` regex in ship test** — `\.{3}` matches three literal dots (escaped dot, quantifier 3), which is exactly the `...` separator in `git status -sb`. Correct behavior; no imprecision.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

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
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
