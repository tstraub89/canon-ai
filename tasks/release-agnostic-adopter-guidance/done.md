# Completion Summary: release-agnostic-adopter-guidance — Make canon's adopter-facing release guidance model-agnostic

> For the human. This is what you need to know.

## What Changed

Canon's adopter-facing release guidance previously assumed a single release model — release-branch-per-version — even though the orchestrator has been model-agnostic in code since before v1.0.0. Adopters using trunk-from-main, tag-from-main, or no versioning were told to "adapt" the release-branch steps with nothing structured to adapt to.

Three targeted changes were made. The `/canon-pipeline` skill's §5 is rewritten as a model-neutral core plus four named recipes — release-branch-per-version, trunk-from-main, tag-from-main, no versioning — each pointing to the adopter's own release policy doc as the source of truth. The section explicitly calls out that `base_branch` is chosen per task, so a hybrid repo (one surface on release branches, another shipping straight to main) is first-class, not a caveat. The `/canon-changelog` skill's two residual release-branch assumptions are neutralized without touching any other behavior. Finally, a new entry in `docs/decisions.md` locks the stance as a settled decision — the anti-regression guard so the same bias cannot creep back into shipped guidance.

## Files Changed

| File | Change |
|---|---|
| `.claude/skills/canon-pipeline/SKILL.md` | §5 rewritten: model-neutral core + four recipes; frontmatter description reframed to be model-neutral |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Auto-synced mirror |
| `.claude/skills/canon-changelog/SKILL.md` | Base-detection heuristic and finalize-mode note neutralized; no other behavioral change |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Auto-synced mirror |
| `docs/decisions.md` | New "Canon prescribes no release model to adopters" entry; stale `dev`-branch parentheticals corrected |

## How to Test

1. As an adopter who ships everything from a single main line with no release branches, open the `/canon-pipeline` skill and confirm there is a clear, usable recipe for your model — not merely an instruction to "adapt" the release-branch steps.
2. As an adopter who tags releases directly from the main line, confirm there is a matching recipe.
3. As a project with two surfaces that release differently (one versioned, one straight to main), confirm the guidance makes clear you choose the model per task and may mix them in one repository.
4. Confirm the guidance never states or implies that release branches are required or are canon's default.
5. Confirm canon's changelog guidance still adapts to whatever changelog format a project already uses and does not impose a particular versioned-heading style.
6. Confirm `docs/release-process.md` is unchanged — canon-ai's own concrete release process stays as-is.

Expected: every common release shape has usable, self-contained guidance; no model is presented as mandatory or default; the model is selectable per task; canon-ai's own concrete process is untouched.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 867 pass, 0 fail, 1 skipped |
| `npm run sync-templates:check` | Pass | Both skill mirrors match roots |
| `npm run docs-refs-check` | Pass | |
| `npm run build` | deferred_by_spec | Skills/docs not bundled into `dist/`; no source change; `dist/` unaffected — Spec: `Validation Required` section |

## Human Verification Required

None.

## Proposed Changelog

Per `docs/decisions.md` §"Versioning and release policy": guidance refinements to existing canon guidance docs are patch-eligible, categorized under `### Changed`. This task rewrites existing sections in two shipped skill files and corrects stale references in an existing decisions entry — no new template, new managed file, new pipeline phase, or new agent capability. Proposed bump: **1.12.2** (patch).

```markdown
### Changed

- **Canon's adopter-facing release guidance is now model-agnostic.** The `/canon-pipeline` skill's release-and-shipping section is rewritten from a single release-branch-per-version walkthrough into a model-neutral core plus four named recipes — *release-branch-per-version*, *trunk-from-main*, *tag-from-main*, and *no versioning*. Each recipe defers to the adopter's own release policy doc as the source of truth. The section now explicitly states that `base_branch` is per-task, so a single repository may mix release models across surfaces. The `/canon-changelog` skill's base-detection heuristic and finalize-mode note are updated to match (no longer assume release-branch as the only model).
```

The human finalizes both the entry wording and the version number.

## Decisions Made

- The global preamble "for every recipe below, your project's own `decisions.md §Versioning and Release Policy` (and/or your project's release doc) is the source of truth" covers all four recipes without per-recipe repetition — code review confirmed this satisfies the authority-pointer requirement for each recipe.
- `docs/pipeline-orchestrator.md` inventory hits are classified `intentionally-conditional` (the doc describes CLI mechanics and flag examples, not prescriptive model defaults) and were not reframed.
- The `canon-changelog` base-detection uses a soft "if readable" hedge on `status.json`, preserving fallback-to-git behavior when the file is absent.

## Open Questions

Two optional nits from code review — human's call whether to address before `--pr` or file as a follow-up:

- **N-1** (`.claude/skills/canon-pipeline/SKILL.md`): The "Always check working tree state before branch operations" guard appears twice in §5 — once in the preamble and once after the no-versioning recipe. The preamble position is more effective; the trailing copy can be removed.
- **N-2** (`docs/decisions.md`): The Rule in the new entry enumerates "skill files, `AGENTS.md`, `CLAUDE.md`" but omits `docs/pipeline-orchestrator.md`, which is also CANON_OWNED and ships to adopters. Could tighten to "skill files and all CANON_OWNED docs."

Neither affects behavior.
