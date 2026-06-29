# Code Review: task-metadata-helpers

> Reviewer: Claude | Spec: `tasks/task-metadata-helpers/spec.md`
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
| AC-1 | Pass | `writeStatusAtomic` calls `deriveTopLevelStatus`; test at `task-cli.test.ts:273` asserts `task_size='L'`, consistent `status`, and today's date stamp. |
| AC-2 | Pass | Tests cover all rejection shapes per field: `task_size` invalid, `delicate`/`worktree` non-boolean, `base_branch` empty/leading-dash/embedded-space/colon, `title` embedded newline; byte-identity confirmed. |
| AC-3 | Pass | `full_send` and `human_spec_gate` each throw with redirect naming the sanctioned mechanism; file byte-unchanged asserted. |
| AC-4 | Pass | Per-representative-field tests assert category-correct messages (redirect vs. immutable) and file byte-unchanged for each. |
| AC-5 | Pass | Unknown-field error enumerates `title`, `task_size`, `delicate`, `worktree`, `base_branch`. |
| AC-6 | Pass | Warning present for active task, absent for pending task; both verified via `captureStdout`. |
| AC-7 | Pass | Dispatch at `index.ts:1516`, `usage()` at `index.ts:53`, CLI help text asserted in `cli.test.ts`. |
| AC-8 | Pass | `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, and `AGENTS.md` all updated. |
| AC-9 | Pass (deferred to CI) | Handoff claims all checks passed; code paths and types consistent with suite expectations. |

### Dropped Sections Check

- [x] Non-goals respected (no new status.json fields; no nested/dotted-path support; no write path for redirected or immutable fields)
- [x] Known Risks addressed (`worktree` flip warning is general; boolean strictness tested; redirect list documented as drift-safe default)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is clean and follows the established mutator pattern in `src/task/index.ts`. The field taxonomy is explicit and exhaustive: every named field resolves to exactly one outcome. Validation reuses the existing `validateBranchField` and `TaskSize` domain correctly. One code-bug survives adjudication: `taskSet` resolves `status.json` via `taskDirFromRoot` instead of the worktree-aware `resolveTaskCwd` + `taskStatusFileForCwd` path used by every sibling mutating command.

### Findings

#### Correctness Bugs

**[code-bug] `taskSet` uses `taskDirFromRoot` instead of `resolveTaskCwd` — `src/task/index.ts:1458`**

Flagged by cold-Claude (high confidence/high severity) and cold-Codex (P2). Cross-model agreement.

```typescript
// taskSet (line 1458) — wrong for worktree-backed tasks:
const statusPath = path.join(taskDirFromRoot(id), 'status.json');

// taskPhase (lines 427–428) — correct pattern:
const taskCwd = resolveTaskCwd(id);
const statusPath = taskStatusFileForCwd(taskCwd, id);
```

For a task running in a worktree (`dev-worktrees/<id>/`), `taskDirFromRoot` returns `REPO_ROOT/tasks/<id>/status.json` — the supervising checkout's stale copy. The pipeline reads from and writes to the worktree copy. `canon task set` will silently mutate the wrong file, and the change will not be visible to the running pipeline.

This violates the established worktree guidance: read and write task files from the active checkout, not the supervising checkout.

**Fix**: replace `taskDirFromRoot(id)` with `taskStatusFileForCwd(resolveTaskCwd(id), id)`. One-line change, matches `taskPhase`.

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): "reads/writes directly from `process.cwd()`" — the mechanism is `taskDirFromRoot` (REPO_ROOT-relative), not raw `process.cwd()`; the worktree-path finding above captures the real issue precisely.
- Dismissed (cold-Claude): Test regex for `sessions` redirect message — anchored lens read the actual source; `REDIRECT_MESSAGES` strings are fully populated (diff showed truncated `'...'` placeholders only). No test integrity issue.
- Dismissed (cold-Claude): `readJsonFile` without schema validation — pre-existing pattern shared by all sibling commands including `taskPhase`; not introduced by this diff.
- Dismissed (cold-Claude): `taskHasStarted` called post-write (sequencing smell) — reads `status.phases`, not `status.status`, so write order does not affect correctness today. Below blocking threshold.
- Dismissed (anchored): AC-1 test does not exercise `deriveTopLevelStatus` re-derive in a mid-pipeline case — coverage gap at low severity; `writeStatusAtomic` behavior exercised across the wider suite. Not blocking.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
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

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `taskSet` now uses `resolveTaskCwd(id)` + `taskStatusFileForCwd(taskCwd, id)` at `index.ts:1458-1459`, matching the pattern at `taskPhase:427-428`. Regression test at `task-cli.test.ts:284` exercises a worktree-backed task and asserts only the worktree copy changes. Full suite passes (909/909). |
| AC-2 | Met (unchanged from round 1) | Validation logic not touched in iteration 2. |
| AC-3 | Met (unchanged from round 1) | Redirect logic not touched in iteration 2. |
| AC-4 | Met (unchanged from round 1) | Category-message logic not touched in iteration 2. |
| AC-5 | Met (unchanged from round 1) | Unknown-field exit path not touched in iteration 2. |
| AC-6 | Met (unchanged from round 1) | Warning path not touched in iteration 2. |
| AC-7 | Met (unchanged from round 1) | Dispatch/usage/help not touched in iteration 2. |
| AC-8 | Met (unchanged from round 1) | Docs and templates mirror not touched in iteration 2. |
| AC-9 | Met | Full `npm test` now passes (909/909). The iteration 2 handoff's "Fail – unrelated" entry was caused by broken refs introduced by the round 1 foreman review.md artifacts (one config-path mention and one worktree-guidance citation). Fixed in the review.md files before this round 2 verdict; full suite confirmed green. |

### Verifying Round 1 findings

- _correctness bug:_ `taskSet` used `taskDirFromRoot` instead of `resolveTaskCwd` + `taskStatusFileForCwd` → fixed at `src/task/index.ts:1458-1459` (anchored lens confirmed match to `taskPhase` pattern); regression test added at `tests/task-cli.test.ts:284` (anchored lens confirmed sound). ✓ Resolved.

### New findings (only NEW issues introduced by Iteration 2's changes)

- Dismissed (cold-Codex): Surplus argv beyond the third position silently drops extra tokens — `canon task set <id> title word1 word2` stores `word1` only. Spec evidence: the spec defines `<value>` as one positional argument; shell convention requires quoting multi-word values (this is how `taskNew`'s title arg works identically). Anchored lens (spec-aware) did not flag this. Cold-Claude rated it low confidence/low severity. Citing spec as the intentional design: `<value>` = one token.
- Dismissed (cold-Claude): `taskStatusFileForCwd` ignores its `_cwd` parameter — pre-existing pattern shared by `taskPhase`, `taskAccept`, `taskResetSpecReview`, and all other sibling commands. Not introduced by iteration 2; taskSet adopted the same consistent pattern. Not a regression.
- Dismissed (cold-Claude): TOCTOU race between `resolveTaskCwd` and subsequent `existsSync` — standard single-user CLI concern; same window exists in all sibling mutators; below blocking threshold.
- Dismissed (cold-Claude): Regression test environment isolation (CANON_TASKS_DIR_OVERRIDE not set) — anchored lens read the test and confirmed the short-circuit path is exercised correctly; test is sound.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

## Round 3 — verifying reroute iteration's response to topology-lock amendment

### Stage 1 — Acceptance Criteria Re-Check

Original ACs unchanged in implementation; amendment ACs (AC-A1 through AC-A5) introduced by the human-review reroute.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | `writeStatusAtomic` + `resolveTaskCwd` routing confirmed. |
| AC-2 | Met (unchanged from round 2) | Validation logic not touched in iteration 3. |
| AC-3 | Met (unchanged from round 2) | Redirect logic not touched in iteration 3. |
| AC-4 | Met (unchanged from round 2) | Category-message logic not touched in iteration 3. |
| AC-5 | Met (unchanged from round 2) | Unknown-field exit path not touched in iteration 3. |
| AC-6 | Met (unchanged from round 2) | Warning path not touched in iteration 3. |
| AC-7 | Met (unchanged from round 2) | Dispatch/usage/help not touched in iteration 3. |
| AC-8 | Met | `docs/pipeline-orchestrator.md` `set` row updated to document two-class model; `templates/docs/pipeline-orchestrator.md` mirror synced. |
| AC-9 | Met | Full suite green (lint, type-check, test, build, sync-templates:check, docs-refs-check). |
| AC-A1 | Met | `args.length > 3` guard at `src/task/index.ts:1456`; error says "unexpected argument" with quoting hint; file byte-unchanged. |
| AC-A2 | Met | Topology lock at `src/task/index.ts:1470` rejects `worktree`/`base_branch` when `status.branch` non-empty; error names field, branch, and lock reason; per-field tests confirm reject-when-branched + succeed-when-unbranched. |
| AC-A3 | Met | Metadata fields (`title`, `task_size`, `delicate`) settable on branched tasks; test at `tests/task-cli.test.ts:454` sets `delicate` with branch recorded, confirms write + warning. |
| AC-A4 | Met | Lock check at line 1470 fires before `SETTABLE_FIELD_SET.has(field)` dispatch; test uses valid value `'true'` for `worktree` and expects lock error, proving lock precedes value parsing. |
| AC-A5 | Met | Two-class model documented in `docs/pipeline-orchestrator.md` `set` row; `templates/` mirror synced; full suite green. |

### Verifying Round 2 findings

- _approved_with_nits (round 2):_ No blocking findings in round 2; reroute iteration adds topology-lock code and amendment ACs, all met as verified above. ✓ Confirmed.

### New findings (only NEW issues introduced by reroute Iteration 3's changes)

**Dismissed (cold-Claude): empty `title ""` accepted** — `taskSet` accepts an empty string for `title` because AC-2 explicitly requires only newline rejection for `title`. The "mirroring `taskNew`'s single-line rule" phrasing is a rationale, not an enumeration of all `taskNew` checks; the spec text names exactly one requirement (embedded newlines). An empty title is a cosmetic oddity, not state corruption. Spec-scope nit, not a code-bug; below blocking threshold.

**Dismissed (cold-Claude): test concurrency for env mutations** — `captureCanonSnapshot` and the `withEnv` wrapper are both synchronous; there is no event-loop yield between env mutation and restore. Node's test runner uses cooperative concurrency, not preemptive parallelism, so there is no race window. Not a real risk in this context.

**Dismissed (cold-Claude): topology-lock structural inconsistency (dual-layer vs. single-layer guards)** — The pre-dispatch lock for `worktree`/`base_branch` is intentional by design (amendment spec §Refined field-mutation model); metadata fields have no equivalent constraint and no pre-dispatch guard is needed. Consistent with spec.

**Dismissed (cold-Codex): no findings submitted for this task.**

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
