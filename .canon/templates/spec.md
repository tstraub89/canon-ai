# Spec: [TASK-ID] — [Title]

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

What is broken, missing, or suboptimal? Be specific. Link to user feedback, bugs, or roadmap items if available.

> **For a bug or flake fix:** State the confirmed mechanism in *Problem* and how you confirmed it, not merely a plausible cause. Evidence must match the mechanism class: a deterministic mechanism (fixed inputs hit the same wrong branch every run) may cite a trace with the verified trigger values; a runtime-dependent mechanism (race, timing, environment/config interaction) needs executed confirmation — a throwaway prototype-fix spike that makes the symptom vanish, or a deterministic forced repro. Satisfying this is your obligation before marking the spec done; on fast-tier (XS, non-delicate) tasks the `spec_review` checkpoint is skipped and no reviewer will catch an unverified mechanism. If the mechanism is environment-bound and a faithful repro is impractical, say so and name the deterministic alternative used instead (integration fixture or documented manual repro).

## Decision

What are we building? Describe the behavior change, not implementation details.

## Non-Goals

What are we explicitly NOT doing in this task? This prevents scope creep.

## Acceptance Criteria

Checklist of verifiable outcomes. Each item must be testable.

> **For a bug or flake fix:** Include a regression-test AC that fails on the pre-fix code for the stated reason and passes after the fix (red-first). If the mechanism is environment-bound and a faithful repro is impractical, the AC must say so and name the deterministic alternative rather than omitting verification.

- [ ] AC-1: ...
- [ ] AC-2: ...
- [ ] AC-3: ...

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

List files that will need changes, with a brief note on what changes.

| File | Change |
|---|---|
| `<path>` | ... |

### Interaction Dependencies

Other features/components that could be affected by this change.

### Data Model Changes

Any changes to shared types, schemas, or persistent data shape. "None" if no changes.

## Validation Required

Universal change-type → check-category matrix (project command bindings are in `docs/architecture.md` §Validation):

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| UI / interaction changes | End-to-end tests |
| Content / SEO / metadata | Prerender / sitemap / feed regeneration |
| Schema / migration | Migration runner + manual review |
| Cross-platform | Subset of the above on each platform |

Mark applicable checks with `- [x]` (replace `<...>` with the project's actual commands from `docs/architecture.md` §Validation):

- [ ] `<lint>`
- [ ] `<type-check>`
- [ ] `<unit tests>` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [ ] `<build>`
- [ ] `<E2E>`

## Docs Impact

Five protected docs (`docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/product-context.md`). Name any that might go stale if this task ships — this is a heads-up, not a change; the actual update happens at QA. "None" if this is a bug fix or internal-only change.

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
- [ ] Validation Required has at least one entry marked `- [x]` (not `- [ ]`). `- [ ]` is a placeholder; the spec author flips required checks to `- [x]` before marking spec done. The orchestrator's code_review pre-flight blocks if no `[x]` items are present.
- [ ] (Bug/flake fixes; N/A for features/refactors) *Problem* states the confirmed mechanism and how it was confirmed, with evidence matching the mechanism class (runtime-dependent mechanisms need executed confirmation), not merely a plausible cause; *Acceptance Criteria* includes a red-first regression-test AC or an explicit environment-bound and faithful-repro-impractical escape with a deterministic alternative
