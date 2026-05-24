# Spec Review: parser-cwd-worktree-mode

> Reviewer: Codex | Spec: `tasks/parser-cwd-worktree-mode/spec.md`

## Shape Check

no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- `tryEvidenceAdvance()` in `scripts/run-task/main.ts` still reads `done.md` in its `qa` branch via `path.join(splitState.taskDirFor(taskId), 'done.md')`. That path is still REPO_ROOT-anchored, while `runQaPhase()` writes `done.md` into the active worktree. The revised spec now covers the parser-based reads, the code-review preflight, the implement branch, and `review.md` recovery, but it still leaves this QA recovery path stale in worktree mode.

### Missing Edge Cases

- None beyond the QA `done.md` recovery read above.

### Type Safety / Interface Gaps

- None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)
