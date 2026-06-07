# Code Review: ship-merge-proof

> Reviewer: Claude | Spec: `tasks/ship-merge-proof/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.
>
> **Note on history.** A prior code-review cycle (pre-amendment, strict SHA-equality implementation) approved-with-nits and reached `human_review`; Codex's PR-level review then flagged a P1, the human amended the spec to ancestor-or-equal proof (AC-14/AC-15), and the task rerouted through `spec_review → plan → implement`. This document is the **fresh Round 1** for that post-amendment implementation; the prior cycle's review (stale line refs, strict-equality findings) is preserved in git history.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

> Anchored lens independently re-ran `npm run type-check` (clean, exit 0) and the full new `tests/run-task-ship.test.ts` suite (14/14 pass). Handoff reports lint / type-check / `npm test` (786 tests, 785 pass, 1 skipped) / build / docs-refs-check / sync-templates:check all Pass; E2E correctly `deferred_by_spec` (no UI surface). No `Fail` rows.

### Acceptance Criteria Check

Cross-reference **every** AC from the spec. Missing an AC from this table is itself a Stage 1 failure.

| AC | Status | Notes |
|---|---|---|
| AC-1: PR number pinned at `--pr` (both branches) | Pass | `reportOrCreatePR` records `prNum` on found + created paths (`main.ts:872-895`). Tests: `--pr pins pr.number on create path`, `--pr pins existing PR number`. |
| AC-1b: `--pr` persists cleanly | Pass | `recordPinnedPRNumber` stages/commits/pushes in active cwd, fail-closed on failure; idempotent skip via `readPinnedPrNumber == prNum` + `anyChanged` guard (`main.ts:840-870`); tests assert empty `git status --porcelain`. |
| AC-2: Deletion requires proof (happy path, exact-equality) | Pass | `establishMergeProof` requires MERGED + baseRef match + ancestor-or-equal (`main.ts:1589-1601`); happy-path exact-match fixture archives + deletes. |
| AC-2b: Refused on merged-into-wrong-base | Pass | `prBase !== baseBranch` → `proven:false` before ancestry (`main.ts:1593-1599`); fixture asserts "not 'main'", task/branch survive. |
| AC-3: Refused on branch-reuse forgery | Pass | `establishPRHeadAncestryProof` runs `merge-base --is-ancestor` against a real unrelated commit (`main.ts:1566`); fixture asserts "not an ancestor", survival. |
| AC-4: Refused when never merged | Pass | Fallback no-merged-PR path → `proven:false` (`main.ts:1608-1612`). |
| AC-5: Legacy fallback proof | Pass | No pinned number → `findMergedPRNumber` (base-filtered) + ancestry (`main.ts:1603-1607`); fixture archives + deletes. |
| AC-6: Fast-forward ungated, non-destructive | Pass | `assertLocalBaseInSyncWithOrigin` runs `git pull --ff-only` when behind>0/ahead==0; diverged still dies; reverted die-on-behind removed (`main.ts:1294-1306`). |
| AC-7: Abort-then-rerun completes in one shot | Pass | Fixtures start base-behind, single `--ship` ff + prove + archive + delete; happy + behind-local tests assert `/fast-forwarding/`. |
| AC-7b: Synced base but unproven ⇒ refused | Pass | Proof gate (`main.ts:1986-2022`) independent of base sync; synced-variant fixture dies + survives (P1 #2 regression pinned). |
| AC-8: Branch already gone ⇒ no-op archive | Pass | `branchExistsLocally` guards skip prefetch + proof (`main.ts:1942, 1989`); fixture archives without proof, no error. |
| AC-9: `--force` does not bypass | Pass | Proof block never reads `cliArgs.force`; parameterized test runs force=[false,true], both die. |
| AC-10: Bundle all-or-nothing | Pass | `proofFailures` collected across all tasks, single `die` before any deletion (`main.ts:1986-2022`, deletion at ~2084); fixture leaves both unarchived. |
| AC-10b: Bundle `--pr` pins every task | Pass | `recordPinnedPRNumber` loops all `taskIds` (`main.ts:842-848`); fixture asserts each sibling pinned. |
| AC-11: Schema additive, migration-free | Pass | `types.ts` `pr?: { number: number }` optional; `validateStatus` tolerant; legacy + pinned validation rows; template `_pr` doc key. |
| AC-11b: Malformed `pr` fails closed | Pass | `readPinnedPrNumber` narrows from `unknown`, rejects non-int / ≤0 (`main.ts:1525-1533`) → falls to fallback; malformed-`pr` ship fixture dies, survives. |
| AC-12: Docs reflect behavior | Pass | `docs/pipeline-orchestrator.md` + `CLAUDE.md` describe ancestor-or-equal proof, materialize-fail-closed, `--force` non-bypass; reference form used; template mirrors synced. |
| AC-13: Tolerate already-deleted remote ref | Pass | `del.stderr.includes('remote ref does not exist')` → info + continue (`main.ts:1450-1454`); other failures still die; fixture completes recovery. |
| AC-14: Behind-local ancestor ships | Pass | Ancestor-or-equal accepts a strict ancestor; fixture advances the remote head, asserts `tip != prHead` and real `is-ancestor == 0`, ships in one `--ship`. |
| AC-15: Unmaterializable PR head ⇒ die | Pass | `materializePRHead` → `null` ⇒ `establishPRHeadAncestryProof` `prHead===null` dies (`main.ts:1548-1564`); prefetch precedes `mergeOpenPRsAndPull()` (`main.ts:1939-1960`); fixture with absent SHA dies, survives. |

### Dropped Sections Check

- [x] Non-goals respected (no `--force` bypass added; no durable on-disk merge record — only live `gh` + pinned number; squash strategy unchanged; `--allow-divergent-base` / base-drift gates untouched; negative guards `assertNoOpenPRForTask` / `assertOriginTaskBranchAbsent` retained).
- [x] Known Risks addressed (local-tip read in active checkout before worktree teardown; `headRefOid` materialized before `--delete-branch` removes `origin/<branch>`, unresolvable object ⇒ die; new `gh` read isolated in `getPRBaseRefName`; `--pr` persistence ordering handled by commit+push after the artifacts push; accepted false-negative carries a concrete recovery message; bundle proofs collected before first deletion).
- [x] Human Test Plan satisfiable (steps 1–7 map to fixtures, including step 7's behind-local case).

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-scoped implementation that puts the safety boundary on the only destructive act (`git branch -D`) exactly as the amended spec intends. Both lenses independently confirmed the core invariants: the ancestor check uses the correct operand order (`merge-base --is-ancestor <localTip> <prHead>`, i.e. localTip ⊆ prHead); `headRefOid` is materialized **before** the squash-merge `--delete-branch` can remove `origin/<branch>`, with an unresolvable object deterministically forcing unproven→die; every `gh` sub-read fails closed on null; `--force` is not consulted in the gate; and the bundle is genuinely all-or-nothing (failures collected, single die before any deletion). Test integrity is strong — fixtures build **real** commit chains so `merge-base --is-ancestor` runs against genuine git state (AC-14 strict ancestor, AC-2 equal, AC-3 unrelated), and the one changed assertion in `run-task-safety.test.ts` reflects an intended behavior change (full-send tail now reports the real PR URL after pinning), not a regression accommodation. No correctness or spec issues surfaced — three optional nits only.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

(none)

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- _optional cleanup/nit (anchored):_ `main.ts:1548-1556` — `materializePRHead` fetches the `headRefOid` object into the object store but does not pin it to a local ref; it is referenced only transiently for the later `merge-base --is-ancestor` call. Safe in-process today (no `git gc`/`fetch --prune` interleaves between prefetch and proof within a single short-lived `--ship`), and the failure mode is fail-closed (spurious die, not data loss). Optional hardening: write a throwaway ref (e.g. `refs/canon/proof/<prNum>`) when materializing, so a future change that introduces a gc/prune between the two points can't flip a proven merge to a die.
- _optional cleanup/nit (anchored):_ `main.ts:1537-1542` (`resolveProofPRNumberForPrefetch`) vs `main.ts:1603-1607` (`establishMergeProof` legacy path) — the prefetch resolves a legacy PR number while the PR is still open (`findOpenPRNumber ?? findMergedPRNumber`), and the proof re-resolves it post-merge (`findMergedPRNumber`). The prefetched map key matches only because GitHub PR numbers are stable across the open→merged transition (they are). Correct as written; add a one-line comment noting the cross-phase number-stability assumption so a future editor doesn't break the map-key contract.
- _optional cleanup/nit (cold):_ `main.ts:856-866` (`recordPinnedPRNumber`) — after staging only `tasks/<id>/status.json`, the function runs a bare `git commit -m` (no pathspec), which commits the whole index. Not a live bug: at both call sites the index is clean (the preceding `commitHumanReviewFiles` already flushed and pushed it, and the idempotent clean path stages nothing). But it leans on that invariant rather than re-inspecting the staged set per the AGENTS.md "inspect the staged set before every commit" discipline. Optional: confirm `git diff --cached --name-only` is limited to the intended status.json paths before committing, mirroring `commitHumanReviewFiles`.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong.

(none)

### Dismissed Cold Findings

> Cold-lens findings dropped because the spec shows the behavior is intended. Include the spec reason.

(none) — The cold lens surfaced a single low-severity code-quality note (`recordPinnedPRNumber` whole-index commit), which is **kept** as an optional nit above rather than dismissed. The cold lens explicitly confirmed no correctness, race, lifecycle, consistency, security, or test-integrity defects, and that the new test file builds real git history rather than stubbing the ancestry checks. The head-SHA-availability concern from the prior cycle is now explicitly handled by the amendment's materialize-or-die path (AC-15) and was not re-raised.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

> Three non-blocking nits only (transient materialized-object not ref-pinned; a clarifying comment on cross-phase PR-number stability; a staged-set re-inspection in `recordPinnedPRNumber`). The human may fold them into a follow-up commit at QA or skip them. Delicate-task audit passed: the destructive `git branch -D` is gated by a forge-proof, ancestor-or-equal merge check on every path (pinned, legacy, gh-unavailable, malformed-pin, unmaterializable-head), every ambiguous signal fails closed, and the non-destructive fast-forward is correctly left ungated while the diverged base still dies.
