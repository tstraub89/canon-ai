# Code Review: worktree-node-modules-gate-carveout

> Reviewer: Claude | Spec: `tasks/worktree-node-modules-gate-carveout/spec.md`
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

`npm run lint`, `npm run type-check`, `npm test` (963 tests: 962 pass, 1 skipped), and `npm run build` all pass. The anchored lens confirmed a fresh `npm run build` produced zero diff on `dist/scripts/run-task.js` (committed dist matches source) and that `tests/run-task-safety.test.ts` passes 114/114 including all 8 new node_modules tests. Red-first failures for AC-1 and AC-2 are recorded in `notes.md`.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: red-first QA-end regression | Pass | `commitQaArtifacts exempts the verified node_modules worktree symlink` uses a trailing-slash `node_modules/\n` .gitignore (not vacuous — see AC-5 guard), asserts post-fix commit succeeds and `status === '?? node_modules\n'`. Red-first recorded in notes.md. |
| AC-2: human-review symlink-only tree proceeds | Pass | Exemption filter applied at `main.ts:1219-1220`, **upstream** of the retry (~1227), no-dirty die (~1256), allowlist filter (~1260), and no-stage die (~1286). Test drives `main()` with `--push` on a symlink-only dirty tree; asserts branch pushed and no allowlist / no-stage abort. This is the load-bearing "not allowlist-only" requirement; verified the filter feeds the raw `dirtyEntries` count, not just the `unexpected` filter. |
| AC-3: negative cases still block, exact-path only | Pass | Negative test iterates file / real-directory / wrong-target-symlink; all abort with "outside the QA-end allowlist". Exact-path-only enforced by `entry.paths.length !== 1 \|\| entry.paths[0] !== 'node_modules'`. |
| AC-4: fail closed on probe error | Pass | Classifier test injects `lstatKind:'error'` and `resolvedTarget:null` / `expectedTarget:null` → `not-exempt`. |
| AC-5: both ignore styles, no vacuous pass | Pass | No-slash `node_modules\n` fixture asserts porcelain omits the symlink; pins the two styles apart and guards the vacuous-pass trap. |
| AC-6: symlink never staged | Pass | AC-1 test asserts `git ls-tree` lacks `node_modules` and tree stays `?? node_modules`; `buildHumanReviewStagePaths` unit test feeds a `?? node_modules` entry and asserts it is not emitted. |
| AC-7: idempotent setup | Pass | `ensureWorktree` guard is lstat-based; tests cover missing / verified-symlink / file / directory (no-clobber) + wrong-target (fail-closed die naming path + found target). Guard genuinely runs: the fixture materializes `node_modules` via `git worktree add` so it exists before the guard, avoiding the reuse early-return pitfall (documented deviation). |
| AC-8: pure classifier seam | Pass | `classifyNodeModulesLinkFromData` is pure data-in/data-out (no fs/git); full decision table covered. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work). Implement-phase gates, `--ship` classification, `.env*` symlinks, gitignore-based exemption, and gate-time removal/recreation are all untouched, exactly as the Non-Goals require.
- [x] Known Risks addressed. Vacuous-test trap (AC-5), human-review partial-fix trap (AC-2 upstream filter), realpath normalization (both sides via `realpathOrNull`; tests pass on this macOS host under `/var/folders`), carve-out breadth (target-resolution check + fail-closed probe), probe fail-open (AC-4), and the setup-guard behavior change (AC-7) are all covered.
- [x] Human Test Plan is satisfiable by the implementation.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-scoped implementation of a delicate commit-boundary safety change. The carve-out fails closed in every branch that matters: `classifyNodeModulesLinkFromData` rejects non-symlinks, null-resolved targets, and target mismatches; `probeNodeModulesEntry` only computes a resolved target for symlinks; and the exemption is *classification-only* — staging in both gates stays allowlist-driven via `buildHumanReviewStagePaths()`, which never emits `node_modules`, so the symlink can never be committed even if the classifier misfired. The deliberate `REPO_ROOT`-vs-worktree-`cwd` inversion is correct per spec (the root install genuinely lives at `REPO_ROOT`) and is not the worktree pitfall. All three lenses agree the core logic is sound; the substantive findings below are consistency/scope-boundary observations against surfaces the spec explicitly declares Non-Goals, not defects in the delivered code.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none — no lens surfaced a defect in the delivered code paths against the spec)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

**R1 — Same bug class survives at a third enforcement site: the implement-phase auto-commit gate (spec Non-Goal; recommend a follow-up task).** `[flagged by cold-Claude]` `scripts/run-task/main.ts:466-468` (also `:406`). Verified against source: `autoCommitCode()`'s empty-handoff branch computes `sourceDirty = allDirty.filter(f => !isPipelineOwnedPath(f, taskIds))` and hard-`die`s on `empty-handoff-but-source-dirty`; `operatorAcceptedImplement()` computes the same `sourceDirty` and returns `false` when it is non-empty. Neither routes through `isExemptNodeModulesEntry`. For an adopter whose `.gitignore` uses the trailing-slash `node_modules/` form (exactly the config this feature targets), a worktree task whose implement step produces an **empty** handoff Changes table would abort at implement auto-commit on the visible `?? node_modules` symlink — the same spurious block, one phase earlier. **Adjudication:** real, but the spec's *explicit, documented Non-Goal*: "No change to implement-phase whole-tree dirty checks (`operatorAcceptedImplement()`, `autoCommitCode()`'s empty-handoff and coverage checks)... The shared predicate is shaped for reuse if those boundaries are later shown to trip, but this task does not touch them." The delivered code correctly implements the scoped spec. The failure is also narrower than QA-end's: QA-end tripped on *every* task (hence adopter report #197), while implement only trips in the empty-handoff corner (a task changing no tracked source), and #197 passed implement. Not a blocker for this task. **Recommendation for the human at human_review:** spin a follow-up task to route the implement-phase gates through the shared `isExemptNodeModulesEntry` predicate — the canon "cross-cutting invariant belongs in one shared helper, all sites routed through it" rule of thumb now applies with a third enforcement site of the same invariant confirmed.

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **N1 — `isExemptNodeModulesEntry` keys on path + live-FS verdict only, ignoring the porcelain status code.** `[cold-Claude]` `main.ts:713-715`. The exemption matches any single-path `node_modules` entry whose live FS reads as a verified symlink, without inspecting `indexStatus`/`worktreeStatus`, so it would exempt a typechange/modification (`T`/`M`) of a *tracked* `node_modules`, not only an untracked (`??`) one. This matches the spec verbatim ("a porcelain entry whose path is exactly `node_modules` is exempt iff a filesystem probe confirms it is a symlink whose target resolves to `<REPO_ROOT>/node_modules`" — keyed on path + probe, not status code), and the scenario requires a tracked `node_modules` (virtually always gitignored). A `D` deletion is already safe (live probe reads ENOENT → `missing` → not-exempt). Cosmetic/theoretical; noting for completeness.
- **N2 — Worktree abort message prints raw `repoModulesSrc` while the comparison is realpath-based.** `[cold-Claude]` `worktree.ts:184`. If `REPO_ROOT/node_modules` is itself a symlink, the "does not resolve to `<repoModulesSrc>`" text shows a path different from what was actually compared. The message also prints the found `resolvedTarget`, so the operator still gets actionable info. Cosmetic.
- **N3 — `ensureWorktree` guard's `case 'error'` fail-closed `die` has no dedicated test.** `[anchored]` `worktree.ts:193-195`. Only the pure classifier's `'error'` input is tested; the plan explicitly notes this branch is not required by AC-7. Low value to add (hard to trigger a non-ENOENT lstat error deterministically).
- **N4 — AC-7 "no EEXIST on re-run" is covered structurally, not by a direct second `ensureWorktree` call.** `[anchored]` `tests/run-task-safety.test.ts:1602`. A real re-run hits the pre-existing-worktree early return before the guard (documented deviation), so the fixture materializes a verified symlink via `git worktree add` and asserts no-op/no-crash instead. Sound substitution.
- **N5 — Human-review positive test does not assert `node_modules` stayed out of the pushed commit/tree.** `[cold-Claude]` `tests/run-task-safety.test.ts:~1573`. It asserts exit 0, no abort, and branch pushed, but not tree exclusion. The staging invariant is already covered by the `buildHumanReviewStagePaths` unit test (the single staging source) plus the QA-end `ls-tree` assertion, so this is belt-and-suspenders, not a coverage hole. Not vacuous — the test genuinely distinguishes the upstream-filter fix from the allowlist-only partial fix.
- **N6 — Self-referential fixture symlink is non-obvious.** `[anchored]` `tests/run-task-safety.test.ts:432`. The `verified-symlink` variant builds `fs.symlinkSync(repoModulesFixture, repoModulesFixture)` (target === path); correct only because git stores the absolute target string and the worktree later resolves it to a real dir. A one-line comment would aid future readers.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong. If a surviving finding's root cause is the spec rather than the code, the final verdict is `spec_gap`.

(none — the spec is explicit and well-scoped; R1 and the dismissed reuse-path finding target surfaces the spec deliberately and defensibly declared Non-Goals, not places where the spec was silent or wrong)

### Dismissed Cold Findings

> Cold-lens findings dropped after verification.

- **Dismissed (cold-Codex): "Revalidate node_modules on existing worktree reuse" (P2, `worktree.ts:142-149`)** — also flagged by the anchored lens (2 lenses). The factual sub-claim holds: when `ensureWorktree()` is rerun for a task whose worktree already exists, the `fs.existsSync(wt)` / `findExistingWorktreeForBranch()` early returns (lines 142-149) short-circuit before the node_modules probe, so setup does not re-validate a stale/swapped symlink on the reuse path. But the *safety* claim ("the safety carve-out does not apply on reruns... can leave a bad symlink undetected") does not hold against the code, with explicit spec evidence: (1) the **commit gates re-probe fresh on every run** via `isExemptNodeModulesEntry` — a wrong-target symlink is classified `not-exempt` and *blocks* the QA-end/human-review commit, which is exactly what AC-3's `wrong-target-symlink` negative test proves, so a bad symlink is caught at the commit boundary regardless of the setup path; (2) AC-7 scopes the change to the "creation guard" and the Decision says "replace the `fs.existsSync` **creation guard**"; (3) the reuse early-return is **pre-existing code unchanged by this task** — pre-fix `ensureWorktree` did no node_modules validation on reuse either, so nothing regresses. The setup-time probe is defense-in-depth / early-warning, not the safety boundary; the safety boundary (the commit gates) holds on reruns. Extending setup-time revalidation to the reuse path is a reasonable future hardening, not a blocker.
- **Dismissed (cold-Claude): TOCTOU between the porcelain snapshot and the live re-probe (nit, `main.ts:715`)** — inherent to the AC-8 fs-probe-at-call-site seam design and acceptable for a local single-user CLI; the window is negligible and the mutation chokepoint (staging) stays allowlist-driven regardless.
- **Dismissed (cold-Claude): overall `changes_requested` signal** — its top finding (R1, implement-phase gate) is an explicit spec Non-Goal, not a defect in the delivered code; its remaining findings are P3/nit-tier. The anchored lens (which holds the spec) signalled `approve`. No code-bug or blocking spec-gap survives verification, so the blocking signal is not adopted.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

> All 8 ACs met; no correctness bugs; no test-integrity compromise (AC-2 distinguishes the full fix from the partial-fix trap, AC-7 genuinely exercises the changed guard, AC-1 uses a non-vacuous trailing-slash fixture). The delivered code correctly implements a deliberately scoped spec. The one risk-level finding (R1) and the dismissed reuse-path observation both target surfaces the spec explicitly declares Non-Goals; they are surfaced above as recommended follow-ups for the human, not blockers. **Human action recommended:** consider a follow-up task to route the implement-phase auto-commit gates (and optionally the `ensureWorktree` reuse path) through the same shared `isExemptNodeModulesEntry` predicate, closing the bug class at all enforcement sites.

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
