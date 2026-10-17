# Spec Review: per-task-telemetry-fragments

> Reviewer: Codex | Spec: `tasks/per-task-telemetry-fragments/spec.md`

## Shape Check

no concerns

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes; the new fold module and metrics test are explicitly identified as new files.
- [x] Proposed patterns are consistent with existing conventions.
- [x] No conflicts with existing functionality identified.

## Issues Found

### Correctness Issues

none

### Missing Edge Cases

none

### Type Safety / Interface Gaps

none

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase

No findings. Reviewed the current spec against the current metrics and quality writers, QA prompt builder and template, task-directory resolution, scaffold and QA artifact commits, ship ordering and reference rewrite, telemetry exemptions, doctor reader, managed-file registry, and relevant test surfaces.

Remaining risk: the spec explicitly accepts duplicate metrics/lessons after a process kill between shared-doc writes and fragment deletion. Ordinary fold failures must preserve all documents and fragments under AC-5; implementation must verify that behavior and the parallel-task merge scenario in AC-6. No implementation tests were run during this spec review.

## Amendment Review

- [x] **Changes requested**

### Findings

1. **P2 — Supply the required diagnosis and red-first criterion for S3** (`tasks/per-task-telemetry-fragments/spec.md:213`, `tasks/per-task-telemetry-fragments/spec.md:227`). With fragments successfully folded, a failed archive rename, archive commit, or archive push currently exits without the recovery hint. S3 repairs those diagnostic failures, but the amendment gives no confirmed trace with verified failure triggers, and AC-11 requires only the final passing tests: it never requires running the regression against the pre-amendment implementation and observing failure specifically because the hint is absent. The original Problem's feature-only exemption does not establish the diagnosis for this amendment. Under this phase's three-role checkpoint, this is a blocking Shape Check concern. Add an amendment Problem with a confirmed deterministic trace (or forced repro where needed), and require AC-11's fragment-bearing failure cases to fail red on the current implementation for the missing hint before the fix, then pass afterward. The existing fake archive-commit/push wrapper is a suitable test seam; its existing failure tests currently exercise preserved legacy dirt rather than consumed fragments. This requests evidence for the diagnostic fix, not automatic recovery or reconsideration of the accepted manual-recovery risk.

2. **Non-blocking — Distinguish failed push from failed commit in the risk description** (`tasks/per-task-telemetry-fragments/spec.md:232`). If the archive commit succeeds and the push fails, the folded rows are already in a local commit, rather than existing "only as uncommitted edits." `commitArchiveChanges` commits before calling push (`src/orchestrator/main.ts:1972`, `src/orchestrator/main.ts:1978`). Describe archive/commit failures as potentially uncommitted or staged, and push failure as committed locally but not pushed, so the recovery explanation matches the actual state.

### Integration and feasibility

S1 preserves the original worktree-routing assertion while aligning its destination with AC-1. S2 corrects the doctor messages without changing its shared-doc reader; its wording change explicitly supersedes AC-2's expectation that doctor tests remain unchanged if a wording assertion exists. S3 preserves AC-5's fold-failure rollback boundary and adds diagnostics after a successful fold. The accepted manual-recovery choice remains in scope; no retry or recovery redesign is requested. The affected paths, existing failure harness, and recovery paragraph in both documentation copies were verified in the current checkout. No prior approved finding is reopened.

### Ambiguity and validation

- [ambiguity] The prompt names `## Amendment`, while the file uses `## Amendment 1 (code_review spec gap, round 2)`. Reviewed that added section as reroute round 1. Both the current round-1 amendment gate and Affected Files parser accept this heading via their `Amendment` word-boundary match; no heading blocker is raised.
- Reviewed the current spec diff, prior spec review, relevant documentation, and the named source/test paths. Did not read implementation handoff, code-review, or QA artifacts. No implementation regression tests were executed in this spec-domain review.
- Validation: `npm run lint` and `npm run docs-refs-check` passed.

## Amendment Review

- [x] **Approved with nits**

### Findings

- **Non-blocking — Make the archive collision fixture nonempty** (`tasks/per-task-telemetry-fragments/spec.md:208`, `tasks/per-task-telemetry-fragments/spec.md:240`). Creating only an empty destination directory does not force the stated failure: `fs.renameSync` replaces it successfully. A throwaway filesystem probe in this review confirmed success for an empty destination and `ENOTEMPTY` for a destination containing a file. Put a sentinel file inside the existing archive directory so AC-11 deterministically reaches the archive-failure diagnostic. This is a fixture clarification within the already-required forced-failure case.

### Shape, evidence, and integration

No blocking concerns. The amendment Problem identifies a deterministic diagnostic mechanism. The current fold consumes fragments before the archive loop; the archive rename has no local catch, a failed archive commit returns stderr to a hint-free `die`, and a failed push throws after a successful local commit. Re-opened those paths and the git/exit helpers and verified the trace against the fake commit/push wrapper. AC-11 now specifies fragment-bearing cases, a red run against the pre-amendment implementation failing on missing hint text, and recording the failing assertion before the fix. The evidence meets the deterministic-mechanism checkpoint.

The amendment preserves the original fold rollback contract in AC-5 and missing-fragment compatibility in AC-7. Its diagnostics distinguish uncommitted/staged edits from an unpushed local commit. S1 keeps worktree routing observable while moving the metrics assertion to the fragment. S2 updates the two doctor messages while retaining the shared-log reader; its conditional test updates are consistent with that correction to AC-2. The named source/test files and the recovery paragraph in both documentation copies exist. The original and amendment Affected Files tables together cover the changes and rebuilt bundles. Manual post-fold recovery remains an explicit accepted risk.

### Ambiguity and validation

- [ambiguity] Interpreted the existing `## Amendment 1 (code_review spec gap, round 2)` section as the requested reroute-round-1 amendment. The current heading gate and scope parser accept it. This new same-round review is appended without changing prior reviews.
- Validation: executed the isolated empty/nonempty rename probe described above. No implementation suite or new regression test was run; AC-11's red-first execution belongs to implementation. Implementation handoff, code-review, and QA artifacts were not read.
- Artifact checks: `npm run lint`, `npm run docs-refs-check`, and `git diff --check` for the edited review/notes passed.
