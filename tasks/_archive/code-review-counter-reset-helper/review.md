# Code Review: code-review-counter-reset-helper

> Reviewer: Claude | Spec: `tasks/code-review-counter-reset-helper/spec.md`
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

Note: The handoff marks `npm run sync-templates:check` as `deferred_by_spec` with the note "no canon-managed template files changed," but `templates/docs/pipeline-orchestrator.md` IS in the diff. The check would have passed (root and template are in sync), so this is a cosmetic handoff inaccuracy, not an unresolved failure. The spec's conditional "N/A unless a canon-managed root/template pair is touched" did apply here, but the check would have been a clean pass. Not a gate failure.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `canon task reset-code-review <TASK-ID>` dispatched from `taskCmd`; sets `status=pending`, `iterations_current_loop=0`, `preflight_rejections_current_loop=0`, `verdict=""` | Pass | `taskResetCodeReview` at `src/task/index.ts:1049`; dispatched at line 1426; unit test at `tests/task-cli.test.ts:460` asserts all four field values. |
| AC-2: re-derives top-level `status` pointer and writes atomically | Pass | `writeStatusAtomic` calls `deriveTopLevelStatus` before writing; test asserts `updated.status === 'code_review'` post-reset. |
| AC-3: routes to worktree `status.json` when one exists | Pass | Uses `resolveTaskCwd(id)` + `taskDirForCwd(taskCwd, id)` at `src/task/index.ts:1052-1053`; worktree routing fully exercised by `tests/task-cli.test.ts:1568-1654`. |
| AC-4: archives `review.md` → `review-prior-N.md`; drops `claude_review` session entry | Pass | Archive loop at `src/task/index.ts:1065-1070`; session drop at line 1078-1080; test asserts `review-prior-1.md` exists, `review.md` gone, `sessions.claude_review === undefined`. |
| AC-5: rejects invalid input with clear errors; operates only on `code_review` | Pass | Empty-id guard at line 1050; missing `status.json` at lines 1055-1057; wrong-phase guard at lines 1061-1063; all three paths tested. |
| AC-6: single-task and bundle auto-block recovery messages in `code-review.ts` rewritten to reference `canon task reset-code-review <id>` | Pass | Single-task at `scripts/run-task/phases/code-review.ts:233-238`; bundle at lines 270-278; both now point at the helper. Grep confirms no remaining "set phases.code_review.status" hand-edit instruction in those two message blocks. |
| AC-7: `iterations` (lifetime counter) NOT reset; only current-loop counters reset | Pass | `iterations` untouched in `taskResetCodeReview`; test asserts `iterations` remains `4` after reset at `tests/task-cli.test.ts:491`. Spec Non-Goals and AC-7 explicitly mandate this divergence from `taskResetSpecReview`. |

### Dropped Sections Check

- [x] Non-goals respected: `reset-spec-review` unmodified; loop-cap logic untouched; `iterations` lifetime counter preserved.
- [x] Known Risks addressed: `preflight_rejections_current_loop` correctly zeroed (AC-1 confirms all three counters handled); `iterations` preserved (AC-7); subcommand name matches message exactly (`reset-code-review` consistent throughout).
- [x] Human Test Plan satisfiable: a task driven to auto-block will receive the new message, the helper command works, prior review is archived, and the loop counter clears for a fresh pass.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is a clean, spec-faithful mirror of `taskResetSpecReview`, adjusted correctly for `code_review`'s field set. The helper, dispatch, tests, and doc updates are consistent and complete within the spec's scope. The new worktree-routing test provides strong coverage of the path that matters most (where a live worktree exists). No correctness bugs or risk findings survive adjudication.

### Findings

#### Correctness Bugs

None.

#### Risk / Guardrails

None.

#### Optional Cleanup / Nit

- **Misleading env var in worktree test** (`tests/task-cli.test.ts:1617`): The worktree test passes `CANON_SKIP_PHASE_GATE: '1'` to the subprocess, but `taskResetCodeReview` does not call `checkPhaseGate` and is unaffected by this env var. Harmless, but misleads a future reader about what the test is guarding. `source: cold lens`

- **Handoff `sync-templates:check` row note inaccurate** (`tasks/code-review-counter-reset-helper/handoff.md:95`): The row says "no canon-managed template files changed" but `templates/docs/pipeline-orchestrator.md` was changed and is in the diff. The check would have been `Pass` — the root and template are in sync. The row label should be `Pass` rather than `deferred_by_spec`. Cosmetic. `source: anchored lens`

- **Bundle auto-block message "each bundle task that needs recovery" slightly ambiguous** (`scripts/run-task/phases/code-review.ts:273`): `autoBlockPhase` blocks ALL `taskIds` in the bundle, not only the pre-flight-failed ones. The phrase "each bundle task that needs recovery" could lead an operator to reset only the pre-flight-failed tasks and leave blocked siblings stalled. "For all blocked bundle tasks" would be clearer. Low stakes — a significant improvement over the old hand-edit message. `source: cold lens`

#### Spec Gaps

None.

> **Adjacent pre-existing code note (not a spec gap, not blocking):** Two other strings in `code-review.ts` — at `buildPreflightReviewBlock` (≈line 52) and `buildCleanTaskReviewStub` (≈line 121) — are artifact-body generators that may also contain hand-edit recovery text. These are entirely outside the spec's scope (AC-6 targets only the `warn()` reason strings at lines 236-238 and ≈275, not artifact bodies). The spec's Docs Impact note acknowledged this conditional ("if the reviewer finds..."). The implementation is correct per spec; these locations are a follow-up hygiene item if the artifact-body paths also contain stale guidance.

### Dismissed Cold Findings

- **`iterations` not zeroed (cold)** — Dismissed. Spec AC-7 and Non-Goals explicitly mandate NOT resetting `iterations` (the lifetime counter). The `taskResetSpecReview` sibling zeroes `iterations`, but that divergence is intentional and documented in the spec: "Does NOT reset `iterations` (the lifetime counter) — only `iterations_current_loop` and `preflight_rejections_current_loop`."

- **Phase guard accepts `in_progress` tasks; `renameSync` race with live reviewer (cold)** — Dismissed. `taskResetCodeReview` is an operator-invoked CLI command, not automated. The scenario requires a human to manually trigger the reset while an agent is actively writing `review.md` — an effectively impossible race in normal operation. Furthermore, `taskResetSpecReview` has the identical behavior; this is the established pattern across all reset helpers.

- **Test line 491 asserts `iterations === 4` (cold)** — Dismissed. This correctly tests AC-7: the lifetime counter must survive the reset. The assertion documents intentional behavior mandated by the spec.

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
