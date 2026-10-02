# Completion Summary: refactor-spec-correctness-audit-ac — Refactor specs require a correctness audit before preserve-behavior

> For the human. This is what you need to know.

## What Changed

A refactor spec that says "preserve behavior" used to protect whatever bugs the current code had. Canon's spec-writing guidance now tells authors of refactor specs to check, for each behavior being kept, whether today's behavior is actually correct, and to say what happens to anything found wrong: fixed on purpose, split into its own task, or kept as a named intentional quirk. The same guidance reaches every place specs are authored (the `/canon-spec` skill, the spec template, and the pipeline's spec and spec-revision prompts, plus the builder self-check). Spec review gets a matching question: it asks for evidence of the audit on refactor specs, as a STRONG finding at most (never BLOCKING), and stays silent when the evidence is there or the refactor is trivially correct. `/canon-spec-review` gains a tenth check for the same thing. Features and bug fixes are explicitly N/A. Prompt-structure tests and the three affected prompt goldens were updated, and `dist/` was rebuilt.

## Files Changed

- `.claude/skills/canon-spec/SKILL.md` (+ `templates/` mirror) — refactor audit rule and gated self-check
- `.canon/templates/spec.md` (+ mirror) — refactor note and gated checklist line
- `.claude/skills/canon-spec-review/SKILL.md` (+ mirror) — new check (10); scope count now ten
- `src/orchestrator/prompts/templates/spec.md`, `spec-revision.md` — identical audit rule after structural caps
- `src/orchestrator/prompts/templates/spec-review.md` — audit-evidence question beside the bug-fix evidence question
- `src/orchestrator/prompts/index.ts` — refactor-gated builder self-check line
- `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` — structural assertions; regenerated goldens
- `dist/orchestrator/run-task.js` — rebuilt bundle
- `docs/BACKLOG.md` — removed the shipped candidate line

## How to Test

1. Ask Claude to draft a spec for a small behavior-preserving refactor. Expected: before any "keep behavior the same" criterion, the spec states whether each kept behavior was checked for correctness and what happens to anything wrong.
2. Ask Claude to draft a spec for an ordinary new feature. Expected: no audit requirement appears.
3. Run the spec review on a refactor spec that says "preserve behavior" with no mention of correctness. Expected: the review raises the missing check. On a refactor spec that shows the check, it stays silent about this.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests (`npm test`) | Pass — 1,334 passed, 1 skipped, 0 failed |
| Prompt tests (targeted) | Pass — 47 passed |
| E2E tests | deferred_by_spec — Spec: no UI surface |
| Build | Pass — consecutive builds gave identical bundle hash; only `dist/orchestrator/run-task.js` changed |
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

- Author guidance placed right after the existing refactor structural-caps bullet; reviewer guidance beside the bug-fix evidence question.
- Missing audit evidence is STRONG, never BLOCKING; the review's silence default is unchanged.
- Refactor identification stays author judgment (no task-type field), same as the bug-fix gate.
- Deviation: build verified by two consecutive bundle hash matches rather than a clean `git diff -- dist/` (the bundle is an intended change).

## Open Questions

- Code review was `approved_with_nits` (low-severity test-robustness nits only); fixing them is optional.
- Whether the pitfall merits a `docs/patterns.md` entry is a human promotion decision, not done here.

## Proposed Changelog

- **Refactor specs now get a correctness audit before "preserve behavior."** `/canon-spec`, the spec template, and the pipeline's spec prompts tell authors of refactor specs to check whether the behavior being kept is actually correct, and to say whether anything wrong was fixed, split out, or kept as a named quirk. Spec review and `/canon-spec-review` ask for that evidence on refactor specs. Features and bug fixes are unaffected.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Prose-only guidance across skills, templates, and prompts; goldens and dist regenerated; code review approved with low-severity nits only.
