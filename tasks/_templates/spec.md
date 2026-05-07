# Spec: [TASK-ID] — [Title]

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

What is broken, missing, or suboptimal? Be specific. Link to user feedback, bugs, or roadmap items if available.

## Decision

What are we building? Describe the behavior change, not implementation details.

## Non-Goals

What are we explicitly NOT doing in this task? This prevents scope creep.

## Acceptance Criteria

Checklist of verifiable outcomes. Each item must be testable.

- [ ] AC-1: ...
- [ ] AC-2: ...
- [ ] AC-3: ...

## Design

### Affected Files

List files that will need changes, with a brief note on what changes.

| File | Change |
|---|---|
| `<path>` | ... |

### Interaction Dependencies

Other features/components that could be affected by this change.

### Data Model Changes

Any changes to shared types, schemas, or persistent data shape. "None" if no changes.

## Validation Required

Which checks apply (from `AGENTS.md` validation matrix). Edit the list below to match the checks defined for this project.

- [ ] `<lint>`
- [ ] `<type-check>`
- [ ] `<unit tests>`
- [ ] `<build>`
- [ ] `<E2E>`

## Docs Impact

Which protected docs (see `AGENTS.md` "Docs Freshness") might need updating if this task ships? "None" if this is a bug fix or internal-only change.

## Known Risks

What could go wrong? Edge cases, performance concerns, or platform-specific issues.

## Human Test Plan

Steps the human should perform to verify the feature works as intended. Written for a product owner, not an engineer.

1. ...
2. ...
3. Expected: ...

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [ ] Every AC states exactly how to verify it (not just "it works")
- [ ] Affected Files lists specific files (not directories) with specific change descriptions
- [ ] Plan steps (fast tier) reference actual function/file names from the codebase
- [ ] Known Risks covers failure modes for the trickiest ACs
- [ ] Human Test Plan uses product language only (no code, no file names)
- [ ] Validation Required has at least one entry checked (or "None" with justification)
