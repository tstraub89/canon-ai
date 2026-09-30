## Summary

- Add a shared read-only reviewer, `spec-review-lens` (tools limited to Read, Grep, Glob, Bash), and point all three `/canon-spec-review` angles at it. The previous `general-purpose` and `Explore` agents could edit files and delegate; `Explore` was also the wrong type for auditing return shapes and call sites.
- Move filtering out of each angle and into the synthesis step, so reviewers report everything they can cite and severity is assigned once.
- Carry Codex spec review's blocking/nit definitions and the full scope-boundary rule into the skill, so the preview stops reporting explicitly excluded behavior as BLOCKING.
- Tighten Check C3 to name the exact `### Affected Files` heading and its parent section, and to include generated or rebuilt outputs. Fix stale pointers: diff review now points at `/canon-inline-review`, and the XS anti-pattern is updated.
- Register the charter as canon-managed in `src/lib/canon-owned.ts`, regenerate the `templates/` mirrors, rebuild `dist/`, and record the decision in `docs/decisions.md`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- `npm test` passes with 1,333 tests; one unrelated linked-worktree test (`tests/run-task-safety.test.ts:2522`) was skipped in the sandbox because it restricts `.git/` writes, so it is unverified rather than passing.
- New structural assertions in `tests/run-task-prompts.test.ts` pin the charter's tool list and the load-bearing wording in both copies.
- Not yet run: a live `/canon-spec-review` dispatch in a fresh Claude Code session. The frontmatter `tools:` syntax follows the documented format but hasn't been exercised at runtime. Worth one manual run before release.
- Adopters need `canon upgrade` and a fresh Claude Code session to get the new reviewer; an updated skill without the charter stops with that instruction instead of falling back to a broader agent.
