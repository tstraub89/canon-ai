# Spec Review: default-codex-models-to-gpt-6-generation

> Reviewer: Codex | Spec: `tasks/default-codex-models-to-gpt-6-generation/spec.md`

## Shape Check

no concerns

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

none

### Missing Edge Cases

- Non-blocking: AC-9’s follow-up cohort should define how tasks are identified as run on GPT-6 versus the 5.6-era baseline. The task-quality log does not itself appear to record the model generation, so the plan should specify the cohort boundary or another reliable attribution source.

### Type Safety / Interface Gaps

none

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase

## Amendment Review

- [x] **Approved**

> Findings: No blocking findings. The amendment corrects a confirmed mismatch between the prompt and the supported `canon run --interactive` path: `runCodex` branches on `interactive`, but both modes currently receive the same prompt. AC-11's runtime gate cleanly separates the headless/ask-precedence guidance while preserving the shared startup guidance, and its fresh/resumed coverage includes the retry call by requiring every non-interactive invocation to receive the block. Prepending the block keeps the phase command at the end as required. AC-12 makes both sides of the behavioral boundary verifiable; AC-13 carries the change through goldens, the decision record, and the build. The amendment explicitly supersedes the original Interaction Dependencies statement that resumed sessions do not re-receive headless guidance, so there is no unresolved contradiction. No new issue is raised against the approved base ACs.
