# Spec Review: worktree-root-in-repo

> Reviewer: Codex | Spec: `tasks/worktree-root-in-repo/spec.md`

## Shape Check

> Strategic read of the spec itself - does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

None.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

None.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None.

## Verdict

- [x] **Approved** - spec is implementable as written
- [ ] **Approved with nits** - implementable, but noting observations for plan phase
- [ ] **Changes requested** - spec is not implementable as written

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **[blocking] AC-14's required missing-worktree result is not reachable for the canonical primary-task state.** The approved spec explicitly says that `ensureBranch()` records the branch only in the worktree copy and leaves the main-checkout `status.json` branch blank (`spec.md:26`), and the current implementation does that at `git.ts:276-301`. After the amended entry prune removes the stale registration, `resolveTaskCwd()` reads that blank main-checkout branch (`state.ts:290-305`), finds no secondary owner, falls through to `return REPO_ROOT` (`state.ts:325-332`), and `assertTaskWorktreeWithinRoot()` therefore accepts it as the main checkout. The run can proceed toward the `qa` phase instead of producing the existing missing-worktree message required by AC-14. The amendment must define a concrete preflight/detection path for this canonical blank-branch state (without silently routing the task to `REPO_ROOT`), or change the promised outcome and its AC; the current AC-14 fixture also needs to state which copy of `status.json` is advanced so it cannot accidentally construct a non-canonical branch-bearing main-checkout state. Its red-first assertion only proves that the stale registration survives before pruning; it does not establish that the post-prune state reaches the required clean refusal.
>
> 2. **[blocking] Entry-prune scope and failure semantics contradict or leave gaps against approved behavior.** The amendment says the next `canon run` prunes “in every phase,” while the approved interaction contract says `--dry-run` is read-only (`spec.md:148`) and `--ship` has no logic change (`spec.md:147`); the Affected Files delta only mentions a conditional dry-run exemption and does not state whether `--ship` is pruned. `git worktree prune` mutates Git’s worktree registrations, so the amendment must explicitly scope that mutation and add the corresponding AC coverage. Separately, the existing `ensureWorktree()` behavior warns and continues when `git worktree prune` fails (`worktree.ts:297-300`); no behavior is specified for an entry prune failure. A warn-and-continue entry implementation cannot support the amendment’s “always clears” / “no phase ever resolves” guarantee. Specify whether entry prune fails closed with an operator-facing error (and verify that path) or narrow the guarantee and define the fallback.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **[blocking] AC-15(a)'s restore command cannot restore the post-implement state that AC-14 deliberately constructs.** The amendment says to continue from AC-14, run `git worktree add <root>/<id> task/<id>`, and then expect `canon run` to reach the task's normal next step (`spec.md:247-248`). But the current implement flow commits the scaffold to base only before the first worktree is created (`phases/implement.ts:51-70`; `git.ts:84-93`), while `autoCommitCode()` stages only paths listed in `handoff.md` (`main.ts:378-605`). The current project guidance therefore explicitly says `handoff.md`, `status.json`, and other task artifacts can remain uncommitted until the QA-end commit (`docs/patterns.md:127-129`). A fresh worktree from `task/<id>` consequently has the branch's committed scaffold, not AC-14's updated `implement: done` / `code_review: pending` state or the post-implement artifacts. The next run can re-enter the old committed phase or fail on missing artifacts, so “reaches its normal next step” is not verifiable and the remedy contradicts the amendment's own non-goal at `spec.md:253`. Define how the uncommitted task state is restored, or narrow the shipped remedy and AC-15(a) to a state it can actually recover (with a manual state/artifact recovery path for post-implement tasks).
>
> 2. **[blocking] The branch-existence marker is not established as a unique bootstrap marker.** The new refusal treats any existing `refs/heads/task/<id>` as proof that this task previously had a worktree (`spec.md:231-237`). The current worktree code explicitly supports creating a worktree from an already-existing branch (`worktree.ts:332-340`), so a `worktree: true` task in its pre-implement, blank-branch state can encounter that branch without having completed bootstrap (for example, a manually or previously left-behind branch). AC-15(b) covers only the no-branch case, and AC-15(c) only covers `worktree: false`; neither proves that a pre-implement worktree task with an unrelated/pre-existing `task/<id>` ref is not falsely refused. Add and enforce the branch-ownership invariant that makes this marker sound, or introduce a durable marker that distinguishes bootstrap from mere branch existence, plus a negative AC for the false-positive state.
>
> 3. **[blocking] “Every non-dry-run, non-ship run” is not true with the specified entry placement unless the earlier invocation-root guard is included in the scope.** The current `main()` calls `assertManagedInvocationRoot()` before the AC-7 worktree check (`main.ts:3449-3456`), and that guard exits for an invocation from an old sibling worktree (`state.ts:93-120`). The amendment places the new prune “beside the AC-7 guard” and claims pruning on every qualifying run (`spec.md:235, 241-243`), but a run from that foreign cwd can terminate before reaching the prune. State whether the prune must precede `assertManagedInvocationRoot()` (while retaining the dry-run/ship exemptions), or narrow the claim and add the foreign-cwd behavior to the verification/documentation so the approved AC-13 boundary remains coherent.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **[blocking] The implement-phase recovery claim is incompatible with unconditional deleted-registration refusal.** The amended detector identifies any invocation task branch with a missing registered path and then refuses before phase dispatch (`spec.md:239-244, 268`). Therefore a run can never reach `ensureWorktree()` for a stale registration. Yet the amendment still says that when the deleted worktree's next phase is `implement`, re-running lets `ensureWorktree()` recreate it (`spec.md:241, 244, 248, 250`). This state is reachable: reroutes from `code_review`, `qa`, or `human_review` re-enter `implement` (`docs/pipeline-orchestrator.md:458-466`), and the implement phase explicitly treats those calls as subsequent calls against an existing worktree (`src/orchestrator/phases/implement.ts:51-70`). If that worktree is then deleted, the new entry detector refuses before `ensureWorktree()` can run. The phase reset itself is also in the deleted worktree's uncommitted `status.json`, so the main checkout cannot reliably decide that this is the exception. Either remove/narrow the implement-recreation promise and make the operator restore command the only remedy for registered deletions, or specify a durable phase signal and an explicit conditional path that skips refusal for implement, with a regression AC for the reroute/deletion state.
>
> 2. **[blocking] Failure of the new pre-prune enumeration is unspecified, so the “exact” detector has no fail-closed contract.** The current codebase distinguishes enumeration failure from “no match” in `listWorktreesWithBranches()` (`state.ts:146-184`) and explicitly dies on `enumeration-failed` during secondary resolution (`state.ts:305-327`), while the branch lookup separately collapses a failed `git worktree list` to `null` (`state.ts:214-233`). The amendment makes a new entry read of that same command the sole evidence for detecting a deleted registration (`spec.md:239-243`), but AC-16 only specifies the failure behavior for `git worktree prune`, not for `git worktree list --porcelain` (`spec.md:256`). If the new helper treats a failed list as an empty set or otherwise continues, a deleted worktree can evade detection and the run can proceed into the existing fallback path. Define the enumeration failure behavior—fail closed before pruning, with an operator-facing error and no runtime files—and add a deterministic AC covering it (or explicitly justify another safe outcome).
## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **[blocking] AC-16(d)'s required `git worktree list` stderr cannot be produced by the specified helper without an unlisted change.** The current `listWorktreesWithBranches()` contract returns only `{ok: false}` on a failed `git worktree list` and discards `result.stderr` (`src/orchestrator/state.ts:142-152`). The amendment requires the entry path to reuse/export that helper without changing its logic, while AC-16(d) requires the user-facing failure to include Git's stderr. A caller receiving only `{ok:false}` has no way to satisfy that assertion. Specify the helper contract change that preserves the stderr (and list it in the affected-file/change scope), or define a separate entry enumeration path; add the corresponding failure-test expectation.
## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **[blocking] The documented secondary-only boundary can silently route a deleted bundle to `REPO_ROOT`.** The amendment explicitly says there is no detection for `canon run <secondary>` after its leader worktree is deleted (`spec.md:239, 261`), but it still requires the entry `git worktree prune` to run before unchanged resolution (`spec.md:240-243`). In the current bundle bootstrap, the main-checkout copy of the secondary's `status.json` keeps a blank `branch` while the leader's worktree copy carries the shared `task/<leader>` branch (`src/orchestrator/git.ts:276-301`; the existing bundle test asserts this at `tests/run-task-safety.test.ts:1760-1777`). After pruning removes the leader registration, `resolveTaskCwd()` scans no worktree, falls through from `no-match`, and returns `REPO_ROOT` (`src/orchestrator/state.ts:284-333`). The per-task root guard accepts `REPO_ROOT`, so the secondary-only run can proceed against the main checkout rather than stop safely. Calling this a documented boundary does not define a safe outcome and conflicts with the amendment's clean-stop/“no phase” guarantee. Specify a fail-closed secondary-only behavior (or a leader-branch detection path) and add a deterministic acceptance test covering it.
## Amendment Review

- [x] **Approved with nits**

> Findings:
>
> 1. **[nit] Align the broad observable-difference wording with the explicit mode exemptions.** The replacement Decision bullet and the amendment's recovery summary say the next `canon run` stops while a missing registration exists (`spec.md:248, 244`), while the binding scope and AC-16 explicitly exempt `--dry-run` and `--ship` (`spec.md:242, 256`). Add the exemptions to the replacement prose or cross-reference the scope so the changelog/docs writer does not turn the qualified guarantee into an unconditional one.
>
> 2. **[nit] Qualify the non-task-branch non-goal as applying to the new entry detector.** The amendment says there is “No refusal for missing worktrees on non-`task/` branches” (`spec.md:263`), but unchanged `resolveTaskCwd()` still dies when a worktree-backed task has a nonempty recorded branch and no registered worktree (`src/orchestrator/state.ts:293-302`). Since the amendment also binds resolution to remain unchanged, phrase this as “no new entry-detection refusal” to avoid implying that the existing resolver error is being removed.
