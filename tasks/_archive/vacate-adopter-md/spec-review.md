# Spec Review: vacate-adopter-md

> Reviewer: Codex | Spec: `tasks/vacate-adopter-md/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist, or are new/deleted/generated exactly as the spec describes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

(none)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- **Non-blocking nit — clarify migration-tool malformed/missing-file behavior in the plan.** AC-8 covers "both markers present" and "markers absent" (`tasks/vacate-adopter-md/spec.md:51`), but it does not explicitly say what happens when only one marker is present, or when one of `CLAUDE.md` / `AGENTS.md` is missing. The obvious safe defaults are: missing file = reported no-op, partial marker pair = non-zero refusal with no write. Capture that in the plan/tests so the tool cannot silently ignore or corrupt a malformed legacy block.

- **Non-blocking nit — scope AC-4's grep check before implementation.** AC-4 says `git grep` should find no code path that reads `templates/CLAUDE.md` / `templates/AGENTS.md` by name (`tasks/vacate-adopter-md/spec.md:47`), while AC-2 intentionally keeps fixture-based delimited-merge tests in `tests/cli.test.ts` and `tests/sync-canon-templates.test.ts` (`tasks/vacate-adopter-md/spec.md:45`, `:111-112`). The current test suite hardcodes `templates/AGENTS.md` in those fixture tests. Either rename those fixtures to a neutral future-delimited path during the test update, or make the grep pathspec production-code-only so AC-4 does not become a false failure.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

> Findings: None. The amendment is implementable as written: the referenced prompt-helper strings exist in `scripts/run-task/prompts/helpers.ts`, the new structural grep/validation ACs are verifiable, and the added `CLAUDE.md` reading-list requirement is scoped to canon-ai's local operator file. It integrates cleanly with the already-approved spec by superseding the stale startup-constant note and adding the helper/golden/dist impacts to the affected-file and validation scope.
