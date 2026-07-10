# Spec Review: ship-shared-doc-dirt-preservation

> Reviewer: Codex | Spec: `tasks/ship-shared-doc-dirt-preservation/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

No concerns. The current ship path still has the blanket `checkout HEAD -- ...presentSharedDocs` block at [scripts/run-task/main.ts](/Users/tstraub/canon-ai/canon-ai-dev/scripts/run-task/main.ts:2063), and the revised spec addresses both halves of the problem: pre-merge safety and post-archive preservation of foreign telemetry.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

(none)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- **Non-blocking nit:** The Problem section says the six managed docs include `docs/lessons-learned.md`, but the current constants classify that file as telemetry: `PIPELINE_TELEMETRY_FILES` includes `docs/lessons-learned.md`, while `PIPELINE_MANAGED_DOCS` starts at `docs/architecture.md` and does not include it ([scripts/run-task/worktree.ts](/Users/tstraub/canon-ai/canon-ai-dev/scripts/run-task/worktree.ts:9)). The Decision, AC-11, and implementation-facing details use the correct classification, so this does not block implementation; it is just a wording trap for future readers/manual testers.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> - **Blocking Shape Check — A1 is not implementable/verifiable under the amendment's stated scope.** The amendment requires the preserved-suffix re-append to happen "at the `commitArchiveChanges()` call site" after `git add -A` and before `git commit`, and says reviewers can verify that by reading the call site (`tasks/ship-shared-doc-dirt-preservation/spec.md:123`, `:126`, `:130`, `:134`). In the current code, though, `commitArchiveChanges()` encapsulates `git add -A`, cached-diff, `git commit`, and `git push` inside the helper (`scripts/run-task/main.ts:1887`, `:1892`, `:1897`, `:1903`); the call site only invokes the helper and then restores the suffix after it returns (`scripts/run-task/main.ts:2274`, `:2279`). With the helper signature unchanged and no new helper/schema allowed, there is no honest way to interleave call-site code between the internal staging and commit steps without violating the amendment. Revise the amendment to name the intended seam explicitly: either split/stage/commit helpers at the call site, add a callback or parameter to `commitArchiveChanges()`, or move the restore inside the helper and specify how preserved entries reach it. Then update A1 and Scope so the implementation and review evidence match the actual function boundary.

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> - **Blocking integration conflict — the amendment reverses AC-7's backup guarantee without explicitly amending AC-7.** The approved AC-7 still requires the backup to persist through the entire archive-commit/push tail and to be left in place if the run dies anywhere in that window, including archive push failure (`tasks/ship-shared-doc-dirt-preservation/spec.md:51`). The amendment now requires the call site to stage, re-append each suffix, delete its backup, and only then call `commitArchiveChanges()` for commit/push (`spec.md:129`, `:137`), while A3 requires push failure to preserve the suffix in the working tree (`spec.md:139`). Those are reasonable new semantics, but they cannot coexist with AC-7's "backup left in place on push failure" wording. Revise the amendment to explicitly supersede or rewrite AC-7's backup lifetime after staging, e.g. "after successful re-append, the working tree becomes the recovery layer and the backup is no longer required for commit/push failures."
>
> - **Blocking scope/AC mismatch — A2 and A3 require editing `tests/run-task-ship.test.ts`, but Scope excludes it.** The amendment's Scope says only `scripts/run-task/main.ts` and `tests/run-task-safety.test.ts` are in scope (`spec.md:133`). A2 and A3 require new integration tests in `tests/run-task-ship.test.ts` (`spec.md:138`, `:139`), and that file is the existing ship integration-test file (`tests/run-task-ship.test.ts:1`). Either include `tests/run-task-ship.test.ts` in the amendment scope or change the ACs to use an in-scope test surface.

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> - **Blocking integration conflict — AC-10 still requires documenting the obsolete restore timing.** The current Decision and amendment both say preserved telemetry is re-appended after `stageArchiveChanges()` and before `commitArchiveChanges()` / `git commit` (`tasks/ship-shared-doc-dirt-preservation/spec.md:24`, `:63`, `:75`, `:137`). AC-10 still requires `docs/pipeline-orchestrator.md` to document that pure-append telemetry is "re-applied as uncommitted dirt after the archive commit" (`spec.md:54`). That is now the pre-amendment behavior, and satisfying AC-10 literally would put stale ship-order documentation in the managed docs. Amend AC-10 to require the new timing: dirty managed docs abort pre-merge; pure-append telemetry is preserved, reverted for checkout/merge, then re-applied as uncommitted dirt after archive staging and before archive commit/push; anything else aborts pre-merge.

## Amendment Review

- [ ] **Approved**
- [x] **Approved with nits**
- [ ] **Changes requested**

> Findings:
>
> - **Non-blocking nit:** AC-7's label says it is "superseded by Amendment A5," but A6 is the item that explicitly supersedes AC-7's backup lifetime. The AC body is clear and implementable, so this is just a cross-reference cleanup.
> - **Non-blocking nit:** Known Risks says the insertion point is killed by "Amendment, round 2," but this prompt is reroute amendment review round 1. The surrounding wording and ACs are coherent, so this is only a label mismatch.

## Amendment Review Round 2

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> - **Blocking integration conflict — AC-8 still requires the old content-only pure seam.** The already-approved AC-8 defines the validation helper inputs as "file class, HEAD content, working content" and its unit-test list is still keyed to that three-input shape (`tasks/ship-shared-doc-dirt-preservation/spec.md:52`). Round 2 now requires `classifySharedDocDirtFromData(docClass, porcelainCode, headContent, workingContent)` and says clean/unsafe decisions are gated first by `porcelainCode` (`spec.md:157`, `:159`, `:181`). Those cannot both be literal acceptance criteria: implementing the required porcelain parameter violates AC-8's stated interface, while satisfying AC-8 leaves the SG-1 index-state regression unfixed. Amend AC-8 in place or explicitly supersede it so the accepted seam is porcelain-code + content only for the `' M'` branch.
>
> - **Blocking type/interface gap — Round 2 tells `main.ts` to pass `workingContent: null` without amending the type contract.** The current helper and set-entry type require `workingContent: string` (`scripts/run-task/validation.ts:1587`, `:1590`, `:1618`, `:1622`). The amendment only names adding `porcelainCode` as the second parameter, but then instructs `classifyAndPreserveSharedDocDirt()` to skip reads for every non-`' M'` porcelain entry and pass `workingContent: null` (`tasks/ship-shared-doc-dirt-preservation/spec.md:159`). As written, the implementer must either fail type-check or invent an unstated widening/sentinel. Specify the new signature/type explicitly, e.g. `workingContent: string | null` with content required only when `porcelainCode === ' M'`, or require callers to pass a string placeholder that the non-`' M'` branch ignores.
>
> - **Blocking integration gap — A11 says the Design and Known Risks sections are updated, but the integrated spec sections are still stale.** A11 requires Known Risks to document git-status-derived detection and the single safe-shape rule, and requires the Design `main.ts` row to describe the batched `git status --porcelain` replacement for the `fs.existsSync` loop (`spec.md:182`). The actual Design row still describes only the original classification/preserve step and Round 1 staging split, with no batched status call (`spec.md:63`), and Known Risks contains no git-status-derived detection risk or safe-shape rule (`spec.md:98`-`:105`). Move the Round 2 detection mechanism into those integrated sections or change A11 so it no longer asserts edits that have not landed.

## Amendment Review Round 2

- [ ] **Approved**
- [x] **Approved with nits**
- [ ] **Changes requested**

> Findings:
>
> - **Non-blocking nit:** The amendment's fail-closed rule is sound, but the porcelain-code example for A7's exact setup is slightly off. A7 says to stage an edit and then reset only the working copy back to HEAD, leaving the index changed and the working tree matching HEAD (`tasks/ship-shared-doc-dirt-preservation/spec.md:179`); in a temporary git fixture during review, that shape emitted `MM`, not `M `, because column 2 compares the working tree to the index. A plain staged edit where the working tree still matches the index emits `M `. This does not block implementation because Round 2 aborts every code other than `' M'` (`spec.md:158`) and A7's integration test still exercises the central regression, but A10's unit list should ideally include `MM` or the prose should avoid naming `M ` as the staged-only code for the reset-worktree variant.
