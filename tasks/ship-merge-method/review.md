# Code Review: ship-merge-method

> Reviewer: Claude (foreman synthesis) | Spec: `tasks/ship-merge-method/spec.md`

Synthesized from the anchored Claude lens, the cold-Claude lens, and the pre-obtained cold-Codex findings (no actionable defects).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (AC-5 row, pre-fix commit `7c8e694`, failure excerpt)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `ship` validated before the no-`docs_freshness` early return; `shipMergeMethod` is a separate result field; unknown `ship.*` keys use the warning path; no CLI flag. |
| AC-2 | Pass | `MERGE_FLAG[mergeMethod]` passed to `gh pr merge`; per-method tests assert anchored lines. |
| AC-3 | Pass | Pre-flight precedes dirt preservation and branch switch; test seeds telemetry, branch, FETCH_HEAD, task state. |
| AC-4 | Pass | Tri-state `lookupPRNumberExact`; unreadable fails closed; confirmed-empty skips settings query; `ghAvailable` guard kept. |
| AC-5 | Pass | `failed` result restores dirt then dies; message states no cleanup ran, re-run guidance, earlier-merged PRs. |
| AC-6 | Pass | Remaining `squash` hits in the three source files are the flag mapping, field name, default, and help text. |
| AC-7 | Pass | Docs, order list, dirt paragraph, decisions, patterns, skills, README, mirrors updated. |
| AC-8 | Pass | Both fake-gh scripts extended; suite reported clean. |
| AC-9 | Pass | Hook deny reason reworded, behavior unchanged. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-scoped implementation. The pre-flight ordering, tri-state lookup, and restore-on-failure follow the spec and are tested with no-mutation assertions. Only minor wording/cleanup nits survive; reviewers did not run the test suite themselves (handoff reports 2,068 passed, cold-Codex reports tests, type-check and template sync passing).

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `src/orchestrator/main.ts:2199-2204` (anchored lens; code-bug-free nit) — the `assertNoOpenPRForTask` hint says to "merge PR #n outside canon (any method)", but `canon-guard` denies squash/default `gh pr merge` on `task/*` PRs. Consider wording that points to re-running `--ship` and names `--rebase`/`--merge` as the hook-permitted manual path.
- `src/orchestrator/main.ts:4214` (anchored lens) — `docsConfig.ok ? … : 'squash'` fallback is dead because the run already dies on `!docsConfig.ok`; defensive only.
- `tests/run-task-ship-docs-fold.test.ts` (anchored lens) — the FETCH_HEAD no-fetch sentinel is asserted only for the disallowed-method scenario, not the AC-4 failure scenarios.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): pre-flight treats empty/errored `gh pr list` as unreadable while sibling lookups return null - the divergence is the spec's explicit requirement (AC-4); sibling helpers deliberately keep their `number | null` contract.
- Dismissed (cold-Claude): `mergeReason` no longer mentions manual `--rebase`/`--merge` while the hook still allows them - AC-9 and Non-Goals fix the hook's behavior as unchanged and require the wording to stop saying other methods need a manual merge; the guard's allow behavior is intentionally untouched.
- Dismissed (cold-Claude): invalid `ship` fails the config load for every command - spec Interaction Dependencies states this is intended (shared parser, "malformed config stops every consumer").
- Dismissed (cold-Claude): restore after a failed merge runs on whichever branch is checked out, in bundles - the failure path returns before any later-step state change and the spec scopes restore to the failed-merge exit; the lens itself did not verify a problem (low confidence).
- Dismissed (cold-Claude): pre-flight only runs when `ghAvailable` - the lens found no defect; AC-4 specifies exactly this.
- Cold-Codex: no findings to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
