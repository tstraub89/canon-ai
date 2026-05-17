# Spec Review: canon-self-contained

> Reviewer: Codex | Spec: `tasks/canon-self-contained/spec.md`

## Shape Check

(no concerns)

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

(none)

### Missing Edge Cases

- **Non-blocking nit**: Human Test Plan step 2 still says to run `canon doctor` "in a directory with `git` available but without `jq` installed" (`tasks/canon-self-contained/spec.md:195-197`) without saying that directory must already be canon-initialized. `doctorCmd()` still fails when `AGENTS.md`/`CLAUDE.md`/`CODEX.md` or `.canon/templates/` are missing (`src/cli/commands/doctor.ts:80-106`, `src/cli/commands/doctor.ts:265-270`), and the revised AC-25/local smoke correctly run `canon init` before `doctor`. Plan should carry that clarification into `done.md`/human testing so the human does not try `doctor` in a bare tempdir.

### Type Safety / Interface Gaps

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
