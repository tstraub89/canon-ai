# Spec Review: scope-pr-auto-commit-to-affected-files

> Reviewer: Codex | Spec: `tasks/scope-pr-auto-commit-to-affected-files/spec.md`

## Shape Check

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [ ] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- Blocking: AC-15's empty-stage-set behavior says `commitHumanReviewFiles()` should return cleanly and "the caller (`--pr` handler) continues to push/PR" (`spec.md:32`, `spec.md:75`). That is not how the current code is structured. `commitHumanReviewFiles()` owns both the push and PR creation internally (`scripts/run-task/main.ts:923-929` for the clean-tree branch and `scripts/run-task/main.ts:1006-1013` after committing). The `--pr`/`--push` caller only invokes `commitHumanReviewFiles(taskIds, cwd, cliArgs.pr)` and immediately `process.exit(0)` (`scripts/run-task/main.ts:1856-1860`), so an early clean `return` from the new empty-stage-set branch would skip pushing and skip draft PR creation. The spec needs to require the empty-stage-set branch to run the same push/report-or-create-PR logic itself, or refactor that logic into a shared helper used by both clean-tree and empty-stage-set paths.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

None beyond the blocking push/PR ownership mismatch above.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)
