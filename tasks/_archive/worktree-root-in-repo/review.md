# Code Review: worktree-root-in-repo

> Reviewer: Claude | Spec: `tasks/worktree-root-in-repo/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review of the post-amendment implementation — the prior code_review `spec_gap` round is archived at `tasks/worktree-root-in-repo/review-prior-1.md` and was resolved by the spec's Amendment / revision E). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All of `npm run lint`, `npm run type-check`, `npm test` (1,201 passed / 1 expected environment skip), `npm run build`, `npm run sync-templates:check`, and `npm run docs-refs-check` are recorded as `Pass`. The anchored lens independently re-ran a targeted subset of the new/changed tests (the AC-14 hand-deleted-worktree tests and its rerouted variant, both AC-15 clear-conditions tests, the AC-16 entry-scope/ordering/fail-closed tests, the `assertManagedInvocationRoot` real-git tests, and the AC-8 doctor test) and all passed. E2E is `deferred_by_spec`, citing "Spec: Validation Required — no UI surface," which matches spec.md's own Validation Required checklist.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 — Default root resolves in-repo | Met | `env.ts:68` default is the in-repo .canon/worktrees directory (not a tracked path); unit test asserts `WORKTREES_ROOT`, `effectiveWorktreesRoot()`, and `worktreePath()` all resolve under it. |
| AC-2 — Override semantics unchanged | Met | Existing relative-anchor regression test in `tests/run-task-safety.test.ts` passes unmodified (confirmed absent from the diff). |
| AC-3 — Containment classification holds for a nested root | Met | 3 new pure `classifyInvocationRoot` cases plus a real-git main/nested-worktree test; both sides canonicalized. |
| AC-4 — Creation/teardown in-repo, main checkout stays clean | Met | Real-git lifecycle test verifies directory creation, symlinks, `git worktree list` registration, clean `git status --porcelain`, and teardown. |
| AC-5 — Stale registrations pruned before create-or-reuse | Met | `gitSafe('worktree', 'prune')` in `ensureWorktree()` (`worktree.ts:298-299`) runs before the create/reuse branch; red-first evidence documented in handoff (failed pre-fix, passes post-fix). |
| AC-6 — Worktree resolution unchanged, provably location-blind | Met | `grep`/direct read of `state.ts` confirms no containment call inside `findExistingWorktreeForBranch()`/`scanWorktreesForSecondaryOwnership()`; new real-git test proves an out-of-root registered worktree still resolves; the three named pre-existing tests (bundle-secondary, stale-worktree `INVALID`, AC-2 relative-override) pass unmodified. |
| AC-7 — `canon run` refuses an out-of-root worktree pre-phase | Met | `assertTaskWorktreeWithinRoot()` (`state.ts:124-140`), wired in `main.ts` gated on `!cliArgs.ship` only — **`--dry-run` is deliberately NOT exempted here**, per spec's Interaction Dependencies ("a dry run of an unmigrated task should report the refusal rather than print a plan canon cannot execute") and Implementation Notes. 4 boundary tests present and passing (before-runtime-files refusal, `--ship` exempt, in-root custom name passes, fresh no-worktree passes). |
| AC-8 — Ignore rule ships through the managed block | Met | `.canon/worktrees/` added to `CANON_RUNTIME_GITIGNORE_PATTERNS`, `.gitignore`, `templates/.gitignore`; new pre-3.0.0 doctor-warning test passes. |
| AC-9 — Docs describe the new layout on both mirror sides | Met | Both `docs/pipeline-orchestrator.md` copies, `docs/patterns.md`, and `docs/codebase-map.md` updated per spec; `npm run sync-templates:check`/`docs-refs-check` pass. One disclosed deviation: the `CANON_WORKTREES_ROOT` doc-table default renders as plain text rather than backticked, because `docs-refs-check` treats a backticked runtime-only directory as a broken reference — rationale is sound and both mirror sides render identically. |
| AC-10 — Old default gone from source | Met | `grep -rn 'dev-worktrees' src/` empty; both rebuilt dist bundles at 0 occurrences. |
| AC-11 — Permitted remaining occurrences bounded | Met | `git grep` of remaining occurrences matches the spec's permitted list exactly. |
| AC-12 — Changelog carries a BREAKING entry with migration steps | Met | Entry covers the new default, both migration paths, `--ship` behavior, the narrowed hand-deletion/refusal claim, both doc trade-offs, and the invocation-root instruction. |
| AC-13 — Old directory stops being a valid invocation root; task state stays reachable | Met | Both (i) the appended message sentence in `assertManagedInvocationRoot()` (`state.ts:117-120`) and (ii) the state-routing test (main-checkout mutation lands in the worktree copy) are present and pass; pre-existing pure `classifyInvocationRoot` tests pass unmodified. |
| AC-14 — A missing canon worktree stops the run cleanly and leaves git state untouched | Met (as literally worded) — see Spec Gap below | `assertNoMissingCanonWorktrees()` (`state.ts:142-163`) fires for a registered `task/*` worktree whose path `!fs.existsSync`; both the post-implement and rerouted-state fixtures are present and pass; the refusal names the path, the branch, both remedy commands, contains no `ENOENT`/stack trace, leaves the registration un-pruned, and writes no runtime files. The AC's own contract ("whose worktree path does not exist on disk ... the on-disk check is the contract") is satisfied exactly as specified — see the Spec Gap finding for the boundary this literal wording leaves open. |
| AC-15 — Detection is exact, and each remedy clears it | Met | All seven sub-cases (restore, discard, orphan-branch, intact-in-root, non-task-branch, other-task-branch, bundle leader × two invocation forms) present as distinct tests. |
| AC-16 — Entry scope, ordering, and failure semantics | Met | 4 fake-git tests confirm dry-run/ship skip detection and entry prune, invocation-root-before-missing-worktree ordering, and fail-closed `git worktree list` failure (stderr surfaced, no runtime files). Ordering in `dist/orchestrator/run-task.js` matches `src/orchestrator/main.ts` exactly. |

### Dropped Sections Check

- [x] Non-goals respected — `resolveTaskCwd()`, `isOrphanedWorktreeState()`, `getActiveCwd()`, `resolveShipCwd()`, `teardownWorktree()`, and `classifyInvocationRoot()` are all unchanged (confirmed by direct read of `state.ts`/`worktree.ts` plus the unmodified-test evidence above).
- [x] Known Risks addressed or documented as accepted — prune ordering, prune's repo-wide side effects (explicitly accepted in Known Risks: "Canon's contract is that worktrees are created and removed through canon, so this is acceptable"), macOS canonicalization, and the two-guard cwd-vs-task boundary are all covered by dedicated tests or explicit spec text.
- [x] Human Test Plan is satisfiable by the implementation — step 3's amended wording ("canon stops before doing anything, names the missing workspace... gives one command to restore it and one to discard it") matches `assertNoMissingCanonWorktrees()`'s actual behavior; steps 4–11 map onto AC-7/AC-13/AC-8/AC-12 tests already verified above.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality

### Summary

The implementation is a clean, narrowly-scoped fix that closes the split-brain gap flagged in the prior code_review round (`review-prior-1.md`) exactly the way the spec's Amendment prescribes: an entry-level, repo-wide `assertNoMissingCanonWorktrees()` guard replaces the original per-phase-only prune promise, resolution logic remains genuinely untouched (verified by direct reading of `state.ts`, not just grep), and guard ordering/exemptions match the spec's Implementation Notes exactly in both `src/` and the rebuilt `dist/` bundles. All three lenses (anchored, cold-Claude, cold-Codex) converged on one real residual gap in the new missing-worktree guard's healthiness check, verified below by direct code trace rather than taken on trust. Two other cold-Claude findings were investigated and dismissed with explicit spec citations; the remainder are non-blocking nits.

### Findings

#### Correctness Bugs

(none surviving — see Spec Gaps)

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

- `assertTaskWorktreeWithinRoot()` (`state.ts:124-140`) calls `canonicalizePath(REPO_ROOT)` fresh on every invocation rather than hoisting it — recomputed once per task id in a bundle loop. The spec's own "Nits from the review, disposition" section flagged this exact redundancy as "fix in passing," but it does not appear to have been addressed in this iteration. Trivial, no behavioral effect. (Anchored lens.)
- `ensureWorktree()`'s new `git worktree prune` (`worktree.ts:298-299`) is repo-wide/unscoped rather than limited to the task's own branch, which isn't obvious from the call site. This is the mechanism behind a dismissed cold-Claude finding below (see Dismissed Cold Findings) and is already covered by the spec's own Known Risks section ("Prune has side effects"); flagging here only as a code-readability nit — a one-line comment at the call site would save a future reader from re-deriving the blast radius. (Cold-Claude.)
- No test exercises `git worktree prune` itself failing inside `ensureWorktree()` (the `warn(...)`-and-continue branch on `pruneResult.ok === false`) — unlike the sibling `git worktree list` enumeration-failure path, which does have a fail-closed test. Low risk (the branch is a simple warn-and-continue with no state mutation), but a coverage gap worth closing opportunistically. (Cold-Claude.)
- One possibly-malformed regex character class in a new test helper in `tests/run-task-safety.test.ts` (branch-name escaping for a `RegExp` construction) looked unusual on inspection; harmless today because no fixture branch name contains regex metacharacters, so it has no observed effect. Flagged at low confidence — not independently re-verified as broken. (Anchored lens.)

#### Spec Gaps

- **`assertNoMissingCanonWorktrees()`'s healthiness check (`state.ts:149`, `!fs.existsSync(worktree.path)`) verifies only that the registered worktree's top-level directory exists — not that it is a usable checkout.** A worktree directory that is present but corrupted or partially emptied (its nested `tasks/<id>/status.json` deleted, its `.git` file/pointer broken, or the directory otherwise stripped of content while the top-level path itself survives) passes this check and is treated as healthy; the run proceeds. I independently traced the actual downstream consequence in `resolveTaskCwd()` (`state.ts:313-361`) rather than relying on the lenses' account: for the canonical bootstrap state (`ensureBranch()` deliberately leaves the main-checkout `status.json`'s `branch` field blank — `git.ts:276-301`, asserted by the pre-existing test at `tests/run-task-safety.test.ts:1719-1727`), `resolveTaskCwd()`'s direct-convention fast path (`fs.existsSync(directStatus)`, `state.ts:317`) fails identically to a fully-deleted directory, falls through to `scanWorktreesForSecondaryOwnership()` (`state.ts:211-241`), which likewise `continue`s past the corrupted worktree at its own `candidateStatusPath` existence check (`state.ts:218`) without distinguishing "present but broken" from "not registered here at all," returns `no-match`, and `resolveTaskCwd` falls through to `return REPO_ROOT` (`state.ts:361`). `assertTaskWorktreeWithinRoot()` explicitly treats a `REPO_ROOT` resolution as legitimate (`state.ts:128`, designed to exempt "no worktree yet"), so neither new guard refuses. Net effect: a corrupted-but-present registered worktree produces the exact silent split-brain outcome — a phase running against the main checkout while the task's true (broken) state sits in the registered worktree — that this entire task, and specifically its Amendment, was written to eliminate for the plain-deletion case.

  This is spec-faithful, not an implementation deviation: the Amendment's Decision text defines the detection contract explicitly and narrowly — "whose `worktree` path does not exist on disk ... the on-disk check is the contract, the marker \[`prunable`\] is corroboration" — and the implementation matches that contract exactly. The gap is that the contract itself, while unambiguous, is narrower than the split-brain-elimination goal the Problem section and Amendment state for this task, and neither the original spec's Known Risks nor the Amendment's five review rounds discuss a present-but-corrupted directory as distinct from a deleted one.

  Severity is real but bounded: the trigger requires selective corruption (a partial `rm`, a deleted nested file, disk damage) rather than the common real-world case this task fully covers (an operator deleting the whole directory, verified by AC-14/AC-15's fixtures). Flagged independently by cold-Codex (the orchestrator's pre-obtained injected finding, P2) and cold-Claude ("correctness bug," confidence high), and confirmed as a genuine mechanism — not merely a plausible-sounding claim — by both the anchored lens's and my own independent trace of `resolveTaskCwd()`/`scanWorktreesForSecondaryOwnership()`. Three-way convergence on the same root cause.

### Dismissed Cold Findings

- Dismissed (cold-Claude): "`assertTaskWorktreeWithinRoot()` is gated only on `!cliArgs.ship`, not `--dry-run`, inconsistent with `assertNoMissingCanonWorktrees()`'s `!cliArgs.ship && !cliArgs.dryRun` gating — a dry run against an unmigrated out-of-root task gets a hard `die()` instead of a read-only preview." — Does not hold as a bug: this is the spec's explicit, documented intent for this specific guard, not an inconsistency. Spec's Interaction Dependencies section states verbatim: "**`--dry-run`.** Covered by the guard: a dry run of an unmigrated task should report the refusal rather than print a plan canon cannot execute. This constrains where the check goes... because `--dry-run` exits before the `--ship` return." The Implementation Notes make the same point ("Exempting ship by an explicit `!cliArgs.ship` condition at the early position satisfies both \[--dry-run and --ship exemption concerns\]"). The two guards are *supposed* to differ on this axis: AC-16(a) explicitly requires the missing-worktree detector to skip `--dry-run`, while AC-7's out-of-root guard is deliberately not exempted for it. Both guards' actual code and tests match their respective, differently-scoped ACs.
- Dismissed (cold-Claude): "`ensureWorktree()`'s new repo-wide `git worktree prune` could race a concurrent, unrelated task and silently discard that other task's stale registration — the exact 'discard' action the new refusal's own message says canon does not do automatically." — Verified as real code behavior (prune is indeed repo-wide, unscoped to the task being ensured), but not a code-bug: the spec's own Known Risks section already discloses and accepts this exact repo-wide blast radius — "Prune has side effects. It removes registrations for any worktree whose directory is missing, including one the operator deleted deliberately... Canon's contract is that worktrees are created and removed through canon, so this is acceptable — but it is adopter-visible and AC-12 requires the changelog to say so." AC-12's changelog entry does include this caveat. Additionally, because `assertNoMissingCanonWorktrees()` now scans *all* registered `task/*` worktrees repo-wide at the entry of every qualifying `canon run` — not just the invoked task's own — any stale registration anywhere in the repo would already have triggered the loud entry refusal in a prior or concurrent invocation before `ensureWorktree()`'s own prune is ever reached for a *different* task's bootstrap; the residual window is the narrow mid-single-process race the cold lens itself identified as unconfirmed in practice. Downgraded from correctness-bug to the nit above (missing prune-failure test coverage, and the blast-radius readability point) rather than dismissed outright, since the theoretical race is real even if unconfirmed and low-likelihood.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [x] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

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
