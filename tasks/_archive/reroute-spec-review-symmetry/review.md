# Code Review: reroute-spec-review-symmetry

> Reviewer: Claude | Spec: `tasks/reroute-spec-review-symmetry/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results — every required check is `Pass`; E2E is `deferred_by_spec` per spec's `Validation Required` (E2E marked N/A — no UI surface). Re-verified `npm run build` locally — fresh build produced zero `git diff -- dist/`, matching the handoff's hash-based determinism note.
- [x] All required checks were run (lint, type-check, test, build, docs-refs-check, sync-templates:check).
- [x] No required checks were skipped without justification. The `deferred_by_spec` E2E entry is acceptable: the spec's *Validation Required* explicitly marks it N/A.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Full-tier reroute resets spec_review + plan | Met | `scripts/run-task/main.ts:1868-1944` tier-gates the reset, clears verdict + current-loop counters, preserves `iterations_total` / `changes_requested_total` / `auto_block_count`. `tests/run-task-reroute-preflight.test.ts:406-467` asserts derived phase, monotonic preservation, and `reroute_count == entered round`. |
| AC-2: Tier-aware reroute messaging | Met | `main.ts:1871-1873` and `:1945-1951` differentiate full vs fast tier. Tests assert both wordings (`:433-434` full tier; `:497-498` fast tier). |
| AC-3: spec_review-reroute prompt variant | Met | `scripts/run-task/prompts/index.ts:124-152` dispatches on `implement.rerouted`. Template `spec-review-reroute.md` covers amendment scope, integration check, prior-review read, and forbids handoff/review/done audit. Goldens regenerated; bundle/single golden tests added (`tests/run-task-prompts.test.ts:234-254`, dispatch test `:286-296`, mixed-round bundle assertion `:300-316`). |
| AC-4: plan-reroute prompt variant | Met | `prompts/index.ts:172-200` dispatches on `implement.rerouted`. Template `plan-reroute.md` is append-only, names round-specific headings, reads prior plan/handoff/spec-review. Goldens + dispatch + bundle tests added. |
| AC-5: Option B routing on amendment rejection (whole-bundle reset) | Met | `main.ts:2402-2438` intercepts before `routeBackTo('spec')`, resets every bundled task's `spec_review.status`/`verdict`, lists only rejected tasks' files, prints `canon run <ids>` (not `--reroute`), exits 0. Test `:520-558` exercises the bundle-mixed-verdict case and verifies both tasks return to `spec_review` so `assertSamePhase()` survives. Non-reroute regression `:560-584`. |
| AC-6: Approved reroute amendment flows through (B2) | Met | Regression test `:586-608` asserts approved reroute spec_review does not trip the spec gate and derives to `plan`. |
| AC-7: implement-reroute reads the reroute plan | Met | `prompts/templates/implement-reroute.md` step 2 instructs Codex to read `## Reroute Plan [Round N]` when present and fall back to base plan when absent. Implement-reroute golden updated; round-specific heading per task is preserved by the per-task `taskLines` (already there) plus this new step. |
| AC-8: Templates registered | Met | `prompts/index.ts:16,21,30,35` import + register both new templates. `loadTemplate` resolves them; golden tests render without throw. |
| AC-9: Stale comment corrected | Met | `main.ts:1884-1891` rewrites the comment to document the never-cleared invariant. `grep -rn "rerouted" scripts/` shows exactly one assignment (`main.ts:1892` set to `true`) and reads at known dispatch sites only — no `delete` or `= false`. |
| AC-10: Docs updated | Met | `docs/pipeline-orchestrator.md` Worktree Isolation + Human Reroute sections rewritten; CLAUDE.md Quick refs adds a Reroute step guards bullet. `npm run docs-refs-check` and `npm run sync-templates:check` pass. |
| AC-11: spec_review and plan phases run with `cwd = activeCwd` | Met | `phases/spec-review.ts:96-101` and `phases/plan.ts:25-32` now pass `activeCwd` as `runCodex`/`runClaude` `cwd` arg. Test `tests/run-task-reroute-preflight.test.ts:610-673` runs the live orchestrator end-to-end with fake agent bins, asserts captured cwd = REPO_ROOT on first pass and worktree path on reroute. **Spec gap (non-blocking) flagged below — spec says "8th positional" for runCodex, but cwd is positional 7; implementation matches intent.** |
| AC-12: Reroute clears stored `codex_spec_review` session | Met | `main.ts:1935-1937` deletes only the `codex_spec_review` slot on full-tier reroute. Test `:464-465` asserts the slot is removed and `codex` (implement) is preserved. End-to-end test `:610-673` confirms reroute Codex CLI args don't include `resume` (resumeId is null). |
| AC-13: Recovery retry honors reroute cwd for spec_review | Met | `main.ts:2304-2305` extends the `isWorktreePhase` predicate to cover `spec_review` when `implement.rerouted === true`. Test `:675-751` verifies worktree cwd when rerouted, REPO_ROOT when not. Comment at `:2298-2303` updates the prior "spec/spec_review/plan/qa always run in REPO_ROOT" claim. |
| AC-14: Validation + build artifacts green | Met | Lint/type-check/test/build/docs-refs/sync-templates all pass. Re-verified locally: fresh `npm run build` produced no diff against committed `dist/scripts/run-task.js`. Synced `templates/CLAUDE.md` and `templates/docs/pipeline-orchestrator.md` mirror their roots. |

### Dropped Sections Check

- [x] Non-goals respected — no machine-readable rejection artifact, no re-arming the human spec gate, no third reroute template, no fast-tier mechanics change, no `verifyRerouteAmendment` change, no `rerouted` clear.
- [x] Known Risks addressed: Option B ordering is explicit in `checkAndRoute` and the rewritten comment; mixed-round bundles are exercised by the prompts test; whole-bundle Option B reset is exercised by the reroute-preflight test; first-pass cwd unchanged is the test's "REPO_ROOT on first pass" assertion; AC-11/12/13 coupling all exercised end-to-end. Delicate-surface risk: tests + golden snapshots cover both tiers and both rejection/approval paths.
- [x] Human Test Plan is satisfiable — all four scenarios map to code paths the tests exercise.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality

### Summary

Implementation matches the spec contract closely. Reset logic in `rerouteFromHumanReview()` is correctly tier-gated, comments accurately document the dispatch invariant, and the Option B interception ordering is explicit. Templates are registered and dispatched cleanly. The coupling between AC-11 (cwd arg), AC-12 (session clear), and AC-13 (retry cwd) is implemented as a unit and tested end-to-end with fake agent bins — that is exactly the right shape for verifying the three-way dependency. Tests are thorough: round 1, round 2+, bundle, fast vs full, approved flow-through, Option B rejection, retry path, and the live spec_review cwd assertion all have dedicated cases.

### Findings

#### Correctness Bugs

None.

#### Risk / Guardrails

None blocking. The spec already calls out the dispatch-correctness ordering dependency (Option B intercepts before `routeBackTo('spec')`); the new comment at `main.ts:2406-2409` reinforces it. The four-reset-paths invariant in `main.ts:1884-1891` makes the never-cleared `rerouted` flag defensible.

#### Optional Cleanup / Nit

None.

#### Spec Gaps

- **AC-11 positional-argument count.** The spec says `activeCwd` should be passed as the "8th (`cwd`) positional argument to `runCodex`" — `runCodex`'s signature is `(prompt, interactive, resumeId, model, effort, metricsContext?, cwd, wrapForResume)`, so `cwd` is positional 7. The implementation correctly puts `activeCwd` in the `cwd` slot, matching the intent and the existing `phases/implement.ts:80-94` pattern. Worth correcting in the spec template / future amendment so the "8th" labeling doesn't confuse a future maintainer.

## Final Verdict

- [x] **Approved** — ship as-is

The only finding is a spec wording nit (positional count off-by-one in AC-11). It is non-blocking and the implementation matches the intent.

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
