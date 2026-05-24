# Archive Notes: parser-cwd-worktree-mode (superseded, abandoned)

> Archived 2026-05-23 after 3 spec_review CRs caught incomplete call-site audit; pivoted to the broader structural fix (Worktree-canonical task state from implement onward, BACKLOG.md:9) before adding more throwaway plumbing.

## What this task tried to do

Add an optional `cwd: string = REPO_ROOT` parameter to four task-file parsers in `scripts/run-task/validation.ts` (`parseAffectedFilesFromSpec`, `parseHandoffChangesRows`, `parseHandoffFiles`, `validateHandoff`), and thread the worktree cwd through worktree-context call sites. Backward-compat clean via the default param.

## Why it didn't ship — band-aid analysis

parser-cwd would have correctly fixed the immediate bug (worktree-spec edit invisible to v2's gate at `--pr` time) but it preserved the underlying two-copies model: parsers read from "wherever the caller passes" instead of "the single canonical place." Under the structural fix (worktree-canonical via `taskDirFor` rewire through `resolveTaskCwd`), the explicit `cwd` parameters parser-cwd adds become throwaway plumbing. 60-70% of parser-cwd's value is throwaway under SSOT-(a).

The pivot trigger: Codex's spec_review ran 3 iterations, each catching a new missed call site (`code-review.ts` preflight, `autoCommitCode`, `tryEvidenceAdvance`'s three branches). The audit was reactive, not comprehensive. Continuing meant more iterations + more plumbing under a model the structural fix would obviate anyway.

## Salvageable

The 3-iteration Codex spec_review caught the comprehensive call-site list — durable audit work that transfers directly to the SSOT spec. Captured in this task's `spec.md` Problem section:

- `commitHumanReviewFiles` at main.ts:887 → `parseAffectedFilesFromSpec`
- `verifyBaseDrift` at validation.ts:938 → `parseAffectedFilesFromSpec`
- `verifyHandoffAgainstDiff` at validation.ts:918 → `parseHandoffFiles`
- `runCodeReviewPhase` preflight at code-review.ts:44-47 → `validateHandoff` + `verifyHandoffAgainstDiff`
- `autoCommitCode` at main.ts:346 → `parseHandoffChangesRows` (at main.ts:358)
- `tryEvidenceAdvance` at main.ts:1988 — three branches:
  - `case 'implement'`: `parseHandoffChangesRows` (line 2002) + `validateHandoffAgainstSpec` (lines 2011-2013)
  - `case 'code_review'`: `readArtifact(taskId, 'review.md')` (line 2052) — `readArtifact` itself resolves via `taskDirFor` (main.ts:1983)
  - `case 'qa'`: `path.join(taskDirFor(taskId), 'done.md')` (line 2083)
- `readArtifact` at main.ts:1983 — the underlying helper that resolves via `taskDirFor`

REPO_ROOT-context call sites (no change needed under SSOT-(a) either, since `taskDirFor` rewire returns REPO_ROOT for non-worktree tasks):
- `checkPhaseGate` in `state.ts` → `validateHandoff`
- `canon task phase/list/status/accept` in `src/task/index.ts` (no parser calls; just status writes)
- `buildContextBlock` in `scripts/run-task/context.ts` (REPO_ROOT-anchored reads)

## Pivot target

[BACKLOG.md:9](../../docs/BACKLOG.md:9) "Worktree-canonical task state from implement onward — eliminate REPO_ROOT/worktree sync ambiguity." Option (a) — rewire `taskDirFor` through `resolveTaskCwd` so all callers automatically read from the worktree when one exists. SSOT closes parser-cwd's bug AND GP's `--ship` post-merge-pull bug (BACKLOG.md:9 evidence sub-bullet added 2026-05-23) AND the "git reset wipes uncommitted state" bug (BACKLOG QA-end-commit entry).

## Durable signal

`status.json.phases.spec_review.iterations_total = 3` records that the spec underwent comprehensive call-site discovery via Codex review iterations. Counter preserved (not reset) per the never-reset-iteration-counters memory — the iterations did productive audit work even though the implementation never landed.
