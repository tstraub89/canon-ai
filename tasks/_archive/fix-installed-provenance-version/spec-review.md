# Spec Review: fix-installed-provenance-version

> Reviewer: Codex | Spec: `tasks/fix-installed-provenance-version/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [ ] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- **Blocking — AC-5 assumes a live vendored-submodule path that the current root resolver does not provide.** In `scripts/run-task/env.ts`, `REPO_ROOT` is derived from `git rev-parse --git-common-dir` and then set to that git-dir's parent. In a real submodule, the command returns the host's `.git/modules/<submodule>` directory (verified with a local host/submodule fixture), so this calculation points at the host's `.git` area rather than the submodule checkout. `captureCanonSnapshot()` then probes `--show-superproject-working-tree` and `HEAD` at that `REPO_ROOT`, not at canon's submodule source. The existing vendored test in `tests/run-task-canon-snapshot.test.ts` avoids this by passing a synthetic submodule path directly as `repoRoot`; it does not exercise the production resolver. The revised spec says vendored fields are unchanged and only adds installed-source classification, but it does not define how a real vendored invocation obtains the submodule SHA under this root contract. An implementation can preserve the current fake test while the live vendored AC remains false or can change the source-root handling without guidance. The spec must either define the intended vendored runtime root/source path and add a real-topology regression, or explicitly limit AC-5 to the existing synthetic seam and remove the claim that live vendored behavior is guarded.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- AC-5 lacks a real git-submodule fixture covering `env.ts`'s `--git-common-dir` behavior; its current test fixture supplies `/tmp/vendor/canon-ai` directly and therefore bypasses the failure mode.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- none

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)
