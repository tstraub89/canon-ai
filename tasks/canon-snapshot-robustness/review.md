# Code Review: canon-snapshot-robustness

> Reviewer: Claude | Spec: `tasks/canon-snapshot-robustness/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Call-time env read at `canon-snapshot.ts:72-73`; tests mutate `process.env` after import and before call; override, unset, empty, and whitespace cases all covered. |
| AC-2 | Pass | Existing superproject test unchanged; non-empty `superprojectWorkingTree` takes the original branch; `resolveOrchestratorCommit` never called in that path. |
| AC-3 | Pass | Vendored fixture at `run-task-canon-snapshot.test.ts:201-221`: `parentToplevel=/tmp/host` distinct from `ownToplevel`; asserts `orchestrator_commit='host-sha'` ≠ `upstream_commit`. |
| AC-4 | Pass | Two native-fallback fixtures: (a) parent probe returns `ok: false` → native; (b) parent resolves to own toplevel → native. Both assert `orchestrator_commit === upstream_commit`. |
| AC-5 | Pass | Probe-failure fixture exercises non-ok `parentDir` probe; function returns complete `CanonStamp` without throwing. `fakeGitRunner` provides implicit non-regression guard. |
| AC-6 | Pass | `docs/decisions.md` env-override clause appended in-place to the existing `CANON_UPSTREAM_REPO` provenance Rule. |
| AC-7 | Pass (deferred to CI) | Handoff claims all checks passed; code and tests consistent. |

### Dropped Sections Check

- [x] Non-goals respected (no config-file migration; no symbol relocation; symlinks documented as best-effort)
- [x] Known Risks addressed (false-positive probe mitigated by `parentToplevel !== ownToplevel` test; symlink accepted as non-goal; path normalization applied via `path.resolve`; env trimming tested)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is correct and minimal. The `resolveOrchestratorCommit` helper cleanly encapsulates the fallback logic and remains fully test-seamable via the existing `runGitAt` injection point. The env-var override follows the exact resolution rule specified (trim → non-empty check → fallback to const), and the call-time read is correctly placed at the assignment site in `captureCanonSnapshot` rather than at module load. No blocking findings.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): `resolveOrchestratorCommit` compares `path.resolve(parentToplevel)` vs `path.resolve(ownToplevel)` rather than `path.resolve(repoRoot)` — `ownToplevel` is git-reported (the actual repo root), not a user-supplied path; the comparison is correct for the intended cases; symlinks are an accepted non-goal per spec.
- Dismissed (cold-Claude): `fakeGitRunner` not registered for toplevel probes in the submodule test — correct: non-empty `superprojectWorkingTree` means `resolveOrchestratorCommit` is never reached; the fake runner throws on unexpected calls, providing implicit non-regression protection.
- Dismissed (cold-Claude): code-shape difference between inline superproject branch and extracted helper — informational only; the extracted helper is the cleaner shape, not a defect.
- Dismissed (cold-Codex): no findings submitted for this task.
- Dismissed (anchored): AC-5 lacks a dedicated first-probe-failure test for the `ownToplevel` empty path — the early-exit is covered implicitly; `fakeGitRunner` throw-on-unexpected would catch a regression; low severity, not blocking.
- Dismissed (anchored): `resolveOrchestratorCommit` subdirectory edge case — spec documents safe native fallback as intentional; below nit threshold.

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

## Round 2 — verifying iteration 1's response to round 1

### Stage 1 — Acceptance Criteria Re-Check

No source code changed in iteration 2 for this task. All ACs remain met as verified in round 1.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | No code changes in iteration 2. |
| AC-2 | Met (unchanged from round 1) | No code changes in iteration 2. |
| AC-3 | Met (unchanged from round 1) | No code changes in iteration 2. |
| AC-4 | Met (unchanged from round 1) | No code changes in iteration 2. |
| AC-5 | Met (unchanged from round 1) | No code changes in iteration 2. |
| AC-6 | Met (unchanged from round 1) | No code changes in iteration 2. |
| AC-7 | Met | Full `npm test` passes (909/909) after fixing broken refs introduced by the round 1 foreman review.md artifacts. |

### Verifying Round 1 findings

- _optional cleanup/nit (round 1 nits):_ No blocking findings in round 1; no code changes required. ✓ Confirmed.

### New findings (only NEW issues introduced by Iteration 2's changes)

(none — iteration 2 added only a handoff record with no source or test changes)

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

## Round 3 — verifying reroute iteration's response to round 2

No source code changed for this task in iteration 3. All ACs remain met as verified in round 2.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | No code changes in iteration 3. |
| AC-2 | Met (unchanged from round 2) | No code changes in iteration 3. |
| AC-3 | Met (unchanged from round 2) | No code changes in iteration 3. |
| AC-4 | Met (unchanged from round 2) | No code changes in iteration 3. |
| AC-5 | Met (unchanged from round 2) | No code changes in iteration 3. |
| AC-6 | Met (unchanged from round 2) | No code changes in iteration 3. |
| AC-7 | Met | Full suite green after reroute bundle fixes (shared workspace validation). |

### Verifying Round 2 findings

- _approved_with_nits (round 2):_ No blocking findings; no code changes required. ✓ Confirmed.

### New findings (only NEW issues introduced by reroute Iteration 3's changes)

**Dismissed (cold-Claude): `path.dirname('/')` degenerate edge in `resolveOrchestratorCommit`** — `captureGitOutput` returns empty on failure; the caller returns `upstreamCommit` on empty `parentToplevel`, so the degenerate case degrades to native silently. Accepted as best-effort per spec Non-Goals.

**Dismissed (cold-Claude): `CANON_UPSTREAM_REPO` const/env-var naming collision** — The env var intentionally mirrors the const name for discoverability; the spec calls this out explicitly (`docs/decisions.md` provenance Rule). Callers that import the const get the hardcoded default; callers that call `captureCanonSnapshot()` get the overridden value when the env var is set. This is the intended design surface — not a bug.

**Dismissed (cold-Claude): test concurrency for `withEnv` env mutations** — `captureCanonSnapshot` is synchronous; `withEnv` is synchronous; no event-loop yield between env set and restore. Node's test runner does not preemptively parallelize synchronous code within a file. Not a real race.

**Dismissed (cold-Codex): no findings submitted for this task.**

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
