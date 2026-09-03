# Code Review: worktree-root-in-repo

> Reviewer: Claude | Spec: `tasks/worktree-root-in-repo/spec.md`
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

All of `npm run lint`, `npm run type-check`, `npm test` (1189 passed / 1 expected env skip), `npm run build`, `npm run sync-templates:check`, and `npm run docs-refs-check` were independently re-run by the anchored lens and pass clean. E2E is `deferred_by_spec` per the spec's own Validation Required (no UI surface).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 — Default root resolves in-repo | Met | Unset-env test asserts `WORKTREES_ROOT`, `effectiveWorktreesRoot()`, `worktreePath()` all resolve under `<REPO_ROOT>/.canon/worktrees`; re-run, passes. |
| AC-2 — Override semantics unchanged | Met | Existing relative-anchor regression (`tests/run-task-safety.test.ts`) unmodified, passes in full suite. |
| AC-3 — Containment classification holds for a nested root | Met | 3 new pure `classifyInvocationRoot` cases + real-git test, re-run, pass; paths canonicalized both sides. |
| AC-4 — Creation/teardown in-repo, main checkout stays clean | Met | Real-git lifecycle test (symlinks, `git worktree list` registration, clean `git status`, teardown) re-run, passes. |
| AC-5 — Stale registrations pruned before create-or-reuse | Met (as literally worded) — but see Spec Gap finding below | `ensureWorktree()`'s own red-first/green test re-run, passes: prune runs before the reuse lookup and the recreated path exists non-prunable. The AC's Verify clause is scoped to `ensureWorktree()` in isolation, and that scope is satisfied. The broader claim made elsewhere in the spec (Decision, CHANGELOG, Human Test Plan step 3) that "the next run" recovers a hand-deleted worktree regardless of task phase does **not** hold — see Spec Gaps. |
| AC-6 — Worktree resolution unchanged, provably location-blind | Met | `grep` confirms no containment call inside `findExistingWorktreeForBranch`/`scanWorktreesForSecondaryOwnership`; out-of-root real-git resolution test passes; the three named pre-existing tests (bundle-secondary, stale-worktree `INVALID`, AC-2 relative-override) pass unmodified. |
| AC-7 — `canon run` refuses an out-of-root worktree pre-phase | Met | 4 boundary tests (before-runtime-files refusal, `--ship` exempt, in-root custom name passes, fresh no-worktree passes) re-run, pass. Guard sits at `main.ts:3453-3457`, before `checkDeps`/heartbeat/`guardConcurrentRun`/`--dry-run` exit. |
| AC-8 — Ignore rule ships through the managed block | Met | Pattern present in `.gitignore`, `templates/.gitignore`, `src/lib/canon-block.ts`; new pre-3.0.0 doctor-warning test re-run, passes. |
| AC-9 — Docs describe the new layout on both mirror sides | Met | `npm run docs-refs-check` and `npm run sync-templates:check` re-run clean; `grep -rn 'dev-worktrees'` across the named docs returns zero hits. |
| AC-10 — Old default gone from source | Met | `grep -rn 'dev-worktrees' src/` empty; `grep -c 'dev-worktrees'` on both rebuilt dist bundles → 0/0. |
| AC-11 — Permitted remaining occurrences bounded | Met | `git grep -n 'dev-worktrees' -- . ':!tasks/' ':!CHANGELOG.md' ':!docs/BACKLOG.md'` matches exactly the spec's permitted set (settings.json, the annotated codebase-map row, docs-refs-check.mjs comment + mirror, and the named fixture files including `tests/task-cli.test.ts`). |
| AC-12 — Changelog carries a BREAKING entry with migration steps | Met (text present) — see Spec Gap on the prune claim's actual scope | All required elements present verbatim: new default, both migration paths, `--ship` behavior, prune-on-hand-deletion claim, tooling/clean caveats, main-checkout instruction. The prune-on-hand-deletion sentence oversells scope — see Spec Gaps. |
| AC-13 — Old directory stops being a valid invocation root; state stays reachable | Met | New sentence present in `assertManagedInvocationRoot()`'s message (`state.ts:118-120`); both (i) invocation-refusal and (ii) main-checkout-state-mutation real-git tests re-run, pass; the three pre-existing pure `classifyInvocationRoot` tests pass unmodified. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — `resolveTaskCwd()`, `isOrphanedWorktreeState()`, `getActiveCwd()`, `resolveShipCwd()`, `teardownWorktree()`, and `classifyInvocationRoot()` are all unchanged (confirmed by grep + unmodified-test evidence above).
- [x] Known Risks addressed or documented as accepted — prune ordering, prune side effects, macOS canonicalization, and the two-guard cwd-vs-task boundary are all covered by dedicated tests.
- [ ] Human Test Plan is satisfiable by the implementation — **step 3 is not reliably satisfiable.** See Spec Gaps below: a worktree hand-deleted while the task sits in `code_review`/`qa`/`human_review` (i.e., any phase after the "first implementation phase" step 2 already advanced it past) is not recreated on the next `canon run`; the stale, still-git-registered-but-on-disk-missing path is returned silently by `getActiveCwd()`/`resolveTaskCwd()` and downstream file/subprocess operations fail with a raw error rather than the promised clean recovery.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is clean, well-tested, and faithful to the spec's explicit constraints — resolution logic is genuinely untouched (verified by grep and by three separate unmodified pre-existing tests continuing to pass), the new `canon run` guard is placed correctly relative to `--dry-run`/`--ship`/`CANON_TASKS_DIR_OVERRIDE`, and documentation/changelog/template-mirror coverage is thorough. All three lenses converged independently on the same substantive issue: the "hand-deleted worktree is pruned and recovered on the next run" guarantee that the spec states unconditionally in its Decision, CHANGELOG, and Human Test Plan is actually scoped to only the `implement` phase's `ensureBranch()` → `ensureWorktree()` call path. This is not an implementation deviation — the implementer correctly left `resolveTaskCwd()`/`getActiveCwd()` untouched per explicit Non-Goals and AC-6 — it traces to the spec's own Non-Goals justification containing a factual error about when `resolveTaskCwd()`'s `die()` fires.

### Findings

#### Correctness Bugs

(none surviving — see Spec Gaps)

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

- `assertTaskWorktreeWithinRoot()` (`src/orchestrator/state.ts:124-139`) calls `canonicalizePath(resolved)` twice (once for the `REPO_ROOT` equality check, once inside `isPathInside`) — a trivial redundant `realpathSync` syscall, no behavioral effect. (Anchored lens.)
- `assertTaskWorktreeWithinRoot()`'s die() message suggests `move the directory to ${path.join(worktreesRoot, taskId)}`. For a bundle secondary whose leader's worktree is out-of-root (a legacy-bundle edge case), `resolveTaskCwd(taskId)` resolves to the *leader's* worktree, not a directory named after the secondary — so the suggested target path would name the wrong directory in that narrow scenario. Functionally harmless (resolution is by branch/content, not directory name), purely a remediation-text accuracy nit. (Cold-Claude; low severity, medium confidence.)
- `ensureWorktree()`'s new `git worktree prune` (`src/orchestrator/worktree.ts:298-299`) is repo-wide/unscoped rather than scoped to the task's own branch or worktree. `docs/pipeline-orchestrator.md` (touched by this same diff) documents that concurrent `canon run` invocations across different worktree-mode tasks are supported. In principle a prune from one task's `ensureWorktree()` call could race another task's concurrent, in-flight `git worktree add` during the brief internal window between admin-entry registration and working-directory creation. Investigated: this window is sub-second and internal to a single `git worktree add` invocation, git's prune-eligibility check is based on the on-disk directory's presence, and there is no reported precedent of this firing in the existing suite despite concurrent-worktree tests elsewhere in the codebase. Recorded as a low-likelihood, unverified-in-practice risk worth a backlog note, not a blocking finding. (Cold-Claude; self-assessed high severity / medium confidence — downgraded to nit after investigation found no concrete reproduction and an extremely narrow timing window.)
- No direct end-to-end test combines the bundle-secondary-resolves-to-leader path with the new `canon run` out-of-root guard (AC-7(c) uses a solo custom-named in-root worktree, not a multi-task bundle). Coverage is implied by AC-6's location-blind guarantee plus the unmodified bundle-secondary test, and the anchored lens traced the logic by hand and confirmed it holds. (Anchored lens.)

#### Spec Gaps

- **The hand-deleted-worktree recovery promised in spec.md's Decision §"Observable differences", Human Test Plan step 3, and `CHANGELOG.md` ("If a worktree directory is deleted by hand, the next run automatically prunes its stale git registration") only actually applies when the task's next action happens to route through the `implement` phase.** `ensureWorktree()`'s new prune call (`worktree.ts:298-299`) is reached only via `ensureBranch()`, called exclusively from `src/orchestrator/phases/implement.ts:70`. Every other phase (`qa.ts`, `code-review.ts`, `spec.ts`, `spec-review.ts`, `plan.ts`) resolves its working directory through `getActiveCwd()` (`worktree.ts:50-72`), which falls back to `findExistingWorktreeForBranch()` and returns whatever `git worktree list --porcelain` still reports — a stale, on-disk-nonexistent path — without pruning and without dying, as long as some registration for that branch exists. The same mechanism reaches `resolveTaskCwd()` (`state.ts:284-329`, used by `readStatus()`/`statusFileFor()`, called at `main.ts:379` before any phase logic runs at all): its branch-fallback path also returns the stale registered path silently rather than dying, because `findExistingWorktreeForBranch()` doesn't distinguish a live registration from a prunable one. The practical consequence: a task hand-deleted while sitting in `code_review`/`qa`/`human_review` — which, per Human Test Plan step 3's own sequencing (step 2 already advanced the task past `implement` before step 3 deletes and re-runs), is the state the test plan itself puts the task in — is not recreated on the next `canon run`. Instead the stale path is handed to downstream file reads/subprocess `cwd`s, which fail with a raw, uncontrolled error (e.g., an uncaught ENOENT from `readStatus()`'s `fs.readFileSync` at `main.ts:379`) rather than the clean recovery the spec promises.

  This is not an implementation deviation: the spec's own Non-Goals explicitly forbid changing `getActiveCwd()` or `resolveTaskCwd()`'s logic, and AC-6 requires resolution to remain location-blind with *no* location filter added to `findExistingWorktreeForBranch()`/`scanWorktreesForSecondaryOwnership()` — the implementer was structurally bound not to fix this at the only points that would need it. The root cause is a factual error in the spec's own Non-Goals justification for leaving `getActiveCwd()` alone: it claims "in every non-test path `resolveTaskCwd()`'s `die()` ... fires first" — but `resolveTaskCwd()` only dies when `findExistingWorktreeForBranch()` returns `null`, and a hand-deleted-but-not-yet-pruned worktree's registration is *not* `null` (git keeps listing prunable entries until an explicit `prune`). The spec's AC-5 "Pre-change behavior" analysis independently confirms this exact mechanism ("the reuse branch returns the deleted path silently — the failure surfaces only later when a phase tries to use it") but the chosen fix (prune inside `ensureWorktree()` only) addresses just one of the several call sites that read the same stale registration.

  Flagged independently by: cold-Codex (injected P1: "the added prune logic does not run during a normal recovery path because task state resolution happens first, leaving hand-deleted worktrees unrecoverable without manual intervention"), the anchored lens (traced all cwd-resolution call sites, confidence high), and the foreman's own independent trace of `main.ts:379` → `readStatus()` → `statusFileFor()` → `resolveTaskCwd()`. Three-way convergence across both cold lenses and the anchored lens on the same root cause.

  This needs a human decision, not another implementation round bound by the same Non-Goals: either (a) narrow the spec's Decision/CHANGELOG/Human-Test-Plan claims to explicitly scope the recovery to "the next time the task enters `implement`" (and soften Human Test Plan step 3 accordingly, since as sequenced it exercises the phase where recovery does *not* apply), or (b) lift the Non-Goals restriction on `getActiveCwd()`/`resolveTaskCwd()` enough to prune-and-recreate (or at minimum prune-before-die, so the failure is the existing clean `die()` message instead of a raw crash) at those call sites too — which reopens exactly the resolution-narrowing territory revisions 1-3 were rejected for, so needs deliberate scoping rather than a quick patch.

### Dismissed Cold Findings

- Dismissed (cold-Claude): test-integrity concern about `tests/run-task-safety.test.ts:1632-1650` ("ensureBranch bypasses dirty source guard...") being converted from an in-process `withFakeGitEnv` call to a subprocess `runNodeInline` invocation - verified against the handoff's documented Deviations From Plan ("the new default is resolved at module import... these changes preserve the original assertions' intended branches without changing production behavior") and independently confirmed by the anchored lens: the original assertions (log does/doesn't match specific git invocations) are preserved unchanged, and the conversion is a legitimate strengthening (adds an explicit `assert.equal(result.status, 0, ...)` where none existed before) rather than a weakening. Not a test-integrity violation.
- Dismissed (cold-Claude): `dist/cli/index.js`/`dist/orchestrator/run-task.js` "manually edited in lockstep" concern - handoff's Validation Outcomes records `npm run build` was run and "a second rebuild produced identical hashes," which is the standard reproducible-dist evidence; no sign of hand-patching.
- Dismissed (cold-Claude): `tests/task-cli.test.ts` still using literal `dev-worktrees` fixture paths - explicitly spec-permitted. AC-11 names `tests/task-cli.test.ts` directly as a file where "every occurrence is a fixture directory name under an explicit `CANON_WORKTREES_ROOT`," and this task's Affected Files table does not list `tests/task-cli.test.ts` for edits. Not a defect.
- Dismissed (cold-Claude): efficiency concern about `assertTaskWorktreeWithinRoot()` spawning a `git worktree list` subprocess per task in a bundle loop - real but trivial (local git subprocess, bundle sizes are small), consistent with the existing pattern of per-task resolution calls elsewhere in the bundle loop; not worth a structural change for this task's scope.

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
