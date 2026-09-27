# Done: anchored-lens-patterns-check

## Summary

The anchored code-review lens now checks changed code against the project's own `docs/patterns.md` conventions, not just spec compliance. Previously, this doc-blind review approach let convention violations (theme tokens, accessibility, privacy, HMR-safety, task-record accuracy) slip through review and get caught later by GitHub's PR bot — evidence showed 27 of 60 recent GalleryPlanner PRs got post-approval bot comments clustering on exactly these classes. The anchored lens's Stage 2 now reads `docs/patterns.md` (using its Trigger Table when present, or skimming the file if not) for sections relevant to the diff's changed files, and reports violations using the existing finding categories (`risk/guardrail`, or `correctness bug` when behavior is wrong). It skips unfilled `TODO[canon]` / `_example_` placeholder content, and is fully conditional on the project keeping a `patterns.md` at all — projects without one are unaffected. The cold-Claude and cold-Codex lenses remain doc-blind by design; no other template or finding category changed.

## Files Changed

- `.claude/agents/code-review-anchored.md` — added the conditional Stage 2 patterns-check paragraph.
- `templates/.claude/agents/code-review-anchored.md` — synced adopter mirror (byte-identical).
- `tests/run-task-prompts.test.ts` — new structural regression test asserting the anchored charter contains `docs/patterns.md`, `Trigger Table`, and `TODO[canon]`; that the Return Format category line is unchanged; and that the cold charter still has zero `patterns.md` mentions.

## How to Test

1. In a project that keeps a `docs/patterns.md` with a rule like "use theme colors, never hardcoded colors," run a task whose diff hardcodes a color. Expected: the code review lists a finding naming the broken convention.
2. In a project whose `docs/patterns.md` is still the unfilled starter template, run any task. Expected: no findings reference the placeholder example content.
3. In a project with no `docs/patterns.md` at all, run any task. Expected: no behavior change — the check is skipped entirely.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,255 passed, 1 skipped, 0 failed. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run build` | deferred_by_spec | Spec: N/A — agent charter files are not bundled into `dist/` (per `AGENTS.md` Adopter Scope: `.claude/agents/*.md` ship as-is, not through `tsup`). |
| E2E | deferred_by_spec | Spec: N/A — no E2E harness applies to a prompt-text-only change. |

## Human Verification Required

None.

**Handoff Validation pre-merge checklist:**
- [x] Version correct (unversioned change — no `CHANGELOG.md`/version bump required for QA to propose beyond the entry text below)
- [x] Changelog updated if needed — draft entry below; human/`  /canon-changelog` finalizes
- [x] PR body current (see `pr-body.md`)
- [ ] Final CI/CD checks green — confirm on the opened PR
- [x] Final diff matches spec intent

## Decisions Made

- No new finding category was introduced; violations route through the existing `risk/guardrail` / `correctness bug` categories, per spec AC-2.
- The instruction is scoped to Stage 2 only, and only to code the diff changes — it does not turn into a whole-file audit.
- Code review (cold-Claude lens) flagged two low-severity nits — Trigger Table staleness isn't explicitly handled, and the new test pins substrings rather than full instruction semantics — both were verified against the spec and dismissed as inherited spec design / acceptable per the AC's own verify text, not implementation gaps. No changes were made in response; verdict was `approved_with_nits`.

## Open Questions

None.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: XS task, single spec_review + code_review round each, approved_with_nits on two dismissed low-severity nits; no code changes needed post-review.
