# Completion Summary: canon-spec-review-rename — Rename canon-review skill to canon-spec-review

> For the human. This is what you need to know.

## What Changed

The pre-pipeline spec-preview skill is renamed from `canon-review` to `canon-spec-review`. The new name aligns it with the pipeline phase it pre-empts (`spec_review`) and distinguishes it from the code-diff review skill (`canon-inline-review`). Every surface that referenced the old name has been updated in lockstep: the live skill directory and its templates mirror, the health-check (`canon doctor`) and its recommended permission grants, the README catalog and allowlist block, four sibling skills that cross-link the command, the pipeline-orchestrator doc, forward-looking dev docs, canon-ai's local settings, and the compiled CLI bundle. Behavior is unchanged — same three-sub-agent fan-out, same BLOCKING / STRONG / NIT report format, same read-only advisory output. Existing adopters who run `canon upgrade` will need to manually remove the stale `.claude/skills/canon-review/` directory; the upgrade path is additive-only and will not remove it.

## Files Changed

**Source edits:**

- `.claude/skills/canon-spec-review/SKILL.md` — Renamed from `canon-review/`; frontmatter `name`, trigger, H1, usage line, and report header updated
- [.claude/skills/canon-review/SKILL.md](.claude/skills/canon-review/SKILL.md) — Deleted
- `.claude/skills/canon-init/SKILL.md` — Grant snippet updated to `Skill(canon-spec-review)` forms
- `.claude/skills/canon-pipeline/SKILL.md` — Cross-link updated to `/canon-spec-review`
- `.claude/skills/canon-spec/SKILL.md` — Cross-link updated to `/canon-spec-review`
- `.claude/skills/canon-status/SKILL.md` — Cross-link updated to `/canon-spec-review`
- `src/lib/canon-owned.ts` — `CANON_OWNED` entry updated to new path
- `src/cli/commands/doctor.ts` — `skillNames` and `RECOMMENDED_ALLOW` updated
- `README.md` — Catalog row, installed-skills prose, and permission-allowlist block updated
- `tests/cli.test.ts` — All-skills-present fixture and README↔`RECOMMENDED_ALLOW` test updated
- `.claude/settings.json` — Local operator grants updated (hygiene; not shipped)
- `docs/pipeline-orchestrator.md` — Three `/canon-review` references updated
- `docs/decisions.md` — Forward-looking reference updated
- `docs/BACKLOG.md` — Forward-looking references updated
- `CHANGELOG.md` — New `[Unreleased]` entry added

**Generated artifacts (tooling-produced, not hand-edited):**

- `dist/cli/index.js` — Rebuilt via `npm run build`
- `templates/.claude/skills/canon-spec-review/SKILL.md` — New sync-generated mirror
- [templates/.claude/skills/canon-review/SKILL.md](templates/.claude/skills/canon-review/SKILL.md) — Removed (`git rm`; orphaned old mirror)
- Re-synced `templates/` mirrors for the four edited sibling skills (canon-init, canon-pipeline, canon-spec, canon-status)
- `templates/docs/pipeline-orchestrator.md` — Re-synced

## How to Test

Follow the Human Test Plan from the spec:

1. Open a Claude Code session in the canon-ai repo. Confirm the spec-preview command is `/canon-spec-review`. The old `/canon-review` should not appear as an available skill.
2. Run `canon doctor` and confirm it reports the spec-preview skill as present (not missing).
3. Read the `[Unreleased]` section of `CHANGELOG.md`. Confirm it instructs existing adopters to delete `.claude/skills/canon-review/` after `canon upgrade` and explicitly states that upgrade will not remove it automatically.
4. Expected: the renamed command works identically to the old one (same advisory spec-preview report), doctor reports green, and the upgrade guidance is unambiguous.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass |
| `npm run build` (+ dist drift check) | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| E2E | deferred_by_spec — no runtime UI surface |

All 11 acceptance criteria verified in code review (Stage 1 pass, Stage 2 approved with nits only).

Two nits from code review are pre-existing and non-blocking:
- `tests/cli.test.ts:432` uses `/canon-spec/` to assert missing-skills warning output; this regex matches both `canon-spec` and `canon-spec-review` and predates this task.
- Empty untracked `.claude/skills/canon-review/` dir residue on the local filesystem after `git rm`; no CI or adopter impact.

## Human Verification Required

None.

## Decisions Made

- **No deletion logic in `canon upgrade`**: the install path stays additive-only. Adopter orphan cleanup is documented in the CHANGELOG, not automated. This keeps `canon upgrade` provably non-destructive.
- **Historical CHANGELOG entries preserved**: existing entries that mention `canon-review` record what shipped under the old name and are correct as written. Only the new `[Unreleased]` entry was added.
- **`tasks/_archive/**` untouched**: archived `spec-review.md` records that cite `/canon-review` as the tool used are historical evidence; renaming them would falsify the audit trail.

## Open Questions

None.

## Proposed Changelog

Already written as part of this task (AC-10). The `[Unreleased]` section in `CHANGELOG.md` has the entry:

> **The pre-pipeline spec-preview skill is renamed `/canon-spec-review` (was `/canon-review`).**

No additional bullet is needed.

Proposed version bump: **1.13.0** — minor bump. The rename is user-visible (`Changed`), requires adopter action (remove the stale skill dir after `canon upgrade`), and ships alongside the release-agnostic adopter guidance already in `[Unreleased]`. The human finalizes the version and cuts the release.
