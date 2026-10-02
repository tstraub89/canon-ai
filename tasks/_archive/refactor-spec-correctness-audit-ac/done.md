# Completion Summary: refactor-spec-correctness-audit-ac — Refactor specs require a correctness audit before preserve-behavior

> For the human. This is what you need to know.

## What Changed

A refactor spec that says "preserve behavior" used to protect whatever bugs the current code had. Canon's spec-writing guidance now tells authors of refactor specs to record, for each behavior they keep, whether it is correct today and to state one outcome: correct as-is, fixed deliberately (with its own AC), split into a separate task, or kept as a named quirk. A behavior confirmed correct needs only a one-line record. The rule reaches every authoring surface (the `/canon-spec` skill, the spec template, the pipeline's spec and spec-revision prompts, and the builder self-check). Review gets the matching question: the pipeline's spec_review prompt treats a missing audit as Blocking (so the spec is revised), while the advisory `/canon-spec-review` skill gains a tenth check that stays STRONG, never BLOCKING. Features and bug fixes are N/A. Two amendment rounds followed PR review: Round 1 raised the pipeline severity to Blocking; Round 2 replaced the hand-written paraphrases with one canonical author rule, reviewer question, and outcome list (adding "correct as-is" as a valid outcome), asserted verbatim in every carrier and mirror by a single test.

## Files Changed

- `.claude/skills/canon-spec/SKILL.md` (+ `templates/` mirror) — audit rule and gated self-check line
- `.canon/templates/spec.md` (+ mirror) — refactor note and gated checklist line
- `.claude/skills/canon-spec-review/SKILL.md` (+ mirror) — check (10); scope count now ten
- `src/orchestrator/prompts/templates/spec.md`, `spec-revision.md` — identical canonical author rule after structural caps
- `src/orchestrator/prompts/templates/spec-review.md` — canonical review question, Blocking severity
- `src/orchestrator/prompts/index.ts` — refactor-gated self-check line
- `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` — canonical-string assertions; regenerated goldens
- `dist/orchestrator/run-task.js` — rebuilt bundle
- `docs/BACKLOG.md` — shipped candidate line removed

## How to Test

1. Ask Claude to draft a spec for a small behavior-preserving refactor. Expected: before any "keep behavior the same" criterion, the Problem section records whether each kept behavior is correct and which of the four outcomes applies.
2. Ask Claude to draft a spec for an ordinary new feature. Expected: no audit requirement appears.
3. Run spec review on a refactor spec that says "preserve behavior" with no correctness record. Expected: the pipeline review blocks (the advisory skill flags STRONG). On a refactor spec that records it, including a one-line "correct as-is", review stays silent about this.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests (`npm test`) | Pass — 1,334 passed, 1 skipped, 0 failed |
| Prompt tests (targeted) | Pass — 47 passed |
| Canonical wording mutation check | Pass — one-word change in a carrier made the test fail as expected; file restored |
| E2E tests | deferred_by_spec — Spec: no UI surface |
| Build | Pass |
| `sync-templates:check` | Pass |
| `docs-refs-check` | Pass |

Note: the 1 skipped test is from the handoff; a skipped test is unverified, not passing. It was not investigated in QA.

## Human Verification Required

None.

Pre-merge checklist (not confirmable in QA; confirm at human_review):
- [ ] Version correct (per project policy)
- [ ] Changelog updated if needed (release step, separate commit)
- [ ] PR body current
- [ ] Final CI/CD checks green
- [ ] Final diff matches spec intent

## Decisions Made

- Author guidance sits right after the refactor structural-caps bullet; reviewer guidance beside the bug-fix evidence question. Refactor identification stays author judgment.
- Severity differs by surface on purpose: Blocking in the pipeline spec_review prompt (Blocking is what triggers `changes_requested`), STRONG, never BLOCKING in the advisory skill (AC-13).
- Round 2 followed the later canonical reviewer wording, which replaces Round 1's "audited, correct" sentence with "A behavior confirmed correct needs only a one-line record" (recorded as an ambiguity in handoff and notes).
- Build verified by consecutive bundle hash matches rather than an empty `git diff -- dist/`, since the bundle change is intended.

## Open Questions

- Code review was `approved_with_nits` (low-severity test-robustness nits); fixing them is optional.
- Whether the canonical-string pattern merits a `docs/patterns.md` entry is a human promotion decision, not done here.

Maintenance: lessons-learned.md has 16 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Proposed Changelog

- **Refactor specs now get a correctness audit before "preserve behavior."** `/canon-spec`, the spec template, and the pipeline's spec prompts tell authors of refactor specs to record whether each preserved behavior is correct today and whether it was left as-is, fixed, split out, or kept as a named quirk. The pipeline's spec review requires that record on refactor specs, and `/canon-spec-review` checks for it as advice. Features and bug fixes are unaffected.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Prose-only guidance across skills, templates, and prompts; two PR-review amendment rounds (Blocking severity, then canonical wording pinned by a test); code review approved with low-severity nits only.
