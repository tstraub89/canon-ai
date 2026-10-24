# Spec Review: per-command-help

> Reviewer: Codex | Spec: `tasks/per-command-help/spec.md`

## Shape Check

no concerns

The spec addresses a real inconsistency across the existing CLI entry points and keeps the change centered on shared argument declarations, command-local usage, and tests. The compatibility changes for `init`, `doctor`, and `stop` are called out, as are the watch summary-line contract and task managed-root ordering.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

The inspected command paths support the proposed ordering: `runCmd()` currently probes dependencies before spawning; `watchCmd()` separates parse errors from watching and emits its usage summary on the error path; `taskCmd()` checks the managed root before dispatch; and `taskNew()`/`taskSet()` expose the stated title and value slots. `parseWatchArgs()` accepts `--timeout=` today, and `taskNew()` accepts `--base=` today. The current `printHelp()` contains the detailed strings the spec plans to move, while the targeted tests and docs are present.

## Issues Found

### Correctness Issues

none

### Missing Edge Cases

none

### Type Safety / Interface Gaps

none

## Verification

Re-read `tasks/per-command-help/spec.md` and inspected the current CLI dispatch/help, run wrapper and parser, watch parser and command path, task parser and dispatch, update/upgrade parsers, target tests, docs, and template mirror. No implementation tests were run; this phase reviews the spec only.

## Verdict

- [x] **Approved** — spec is implementable as written; no findings
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase
