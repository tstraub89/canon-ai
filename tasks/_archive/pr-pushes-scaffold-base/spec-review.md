# Spec Review: pr-pushes-scaffold-base

> Reviewer: Codex | Spec: `tasks/pr-pushes-scaffold-base/spec.md`

## Shape Check

no concerns

The shared push solves the stated manual-push problem at the existing remote boundary. The current scaffold, full-send push, and divergence-gate code supports the deterministic mechanisms described in Problem. Red-first ACs cover the changed behavior.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

The contract covers present and missing remote bases, empty and unsafe ranges, stale tracking refs, fetch and inspection failures, rejection fallback, and the override. The existing full-send, human-review, and complete-phase callers can share the push while keeping the ship caller on its current divergence-check path. The declared files cover the runtime, tests, help, documentation, managed mirrors, and both build outputs.

## Issues Found

### Correctness Issues

none

### Missing Edge Cases

none

### Type Safety / Interface Gaps

none

## Verification

Re-read the current spec and inspected the working tree, classifier and range helper, push and divergence paths, ship caller, implement hint, existing real-git fixtures and regression assertions, documentation surfaces, and managed-file registry.

This focused baseline run passed in this review session:

```sh
node --test --test-reporter=dot --test-name-pattern='plain --pr still refuses|main full-send tail pushes an unpushed scaffold|full-send tail leaves every unsafe|full-send tail fails closed on a rejected|full-send tail pushes the checked tip|verifyBaseDivergence:' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-safety.test.ts tests/run-task-validation.test.ts
```

Remaining risk: the new missing-base creation, prune, and rejection-fallback behavior needs the specified integration tests during implementation. The baseline run verifies current behavior; it does not validate the proposed implementation. No implementation files changed.

## Verdict

- [x] **Approved** — spec is implementable as written; no findings
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase
