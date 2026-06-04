# Completion Summary: retire-release-init — Retire canon task release-init from the canon CLI

> For the human. This is what you need to know.

## What Changed

The `canon task release-init` subcommand has been removed entirely from the CLI. This command was dead code: canon-ai itself bypassed it (because it skips `npm run build`, which CI requires), and it was unusable by adopters because it hardcoded canon-ai's specific CHANGELOG format and wrote the app version into `.canon/version`, which is canon's own upgrade-tracking file rather than the app version. Running `canon task release-init 1.10.0` now prints "Unknown subcommand: release-init" and exits with an error, exactly like any other unknown subcommand. The manual release steps in `docs/release-process.md` are unchanged and remain the documented process. Two open backlog items about the command are now closed with a note pointing to this task.

## Files Changed

- `src/task/index.ts` — removed `taskReleaseInit`, `insertChangelogBlock`, `updatePackageVersion`, `defaultPush`, `ReleaseInitOptions`, and the `case 'release-init':` dispatch arm; `writeJsonAtomic` and `readJsonFile` retained (shared by other task paths)
- `src/cli/index.ts` — removed `release-init` from `--help` output
- `tests/task-cli.test.ts` — removed the four `release-init` tests and their release-init-only import/helper
- `dist/cli/index.js` — rebuilt bundle; no `release-init` references remain
- `docs/release-process.md` — removed the release-init note and related-reference; reworded the history blurb; manual steps intact
- `README.md` — removed the `canon task release-init` command row and lifecycle-list item
- `docs/pipeline-orchestrator.md` — removed the task-management row and example invocation
- `.claude/skills/canon-pipeline/SKILL.md` — removed `release-init` from description and release-flow guidance; repointed to manual flow
- `.claude/skills/canon-changelog/SKILL.md` — reworded release-branch references to describe manual initialization
- `docs/BACKLOG.md` — both release-init items marked closed with closure note
- `tests/fixtures/canon-dev-tokens.json` — updated comment to remove "release-init does this implicitly" clause
- `CHANGELOG.md` — added `### Removed` bullet under `## [Unreleased]`
- `templates/docs/pipeline-orchestrator.md`, `templates/.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-changelog/SKILL.md` — derived mirrors re-synced via `sync-templates`

## How to Test

1. Run `node dist/cli/index.js task release-init 1.10.0`. Expected: prints "Unknown subcommand: release-init" followed by the usage block, exits non-zero.
2. Run `node dist/cli/index.js --help` and `node dist/cli/index.js task`. Expected: no `release-init` appears anywhere in either output.
3. Open `docs/release-process.md`. Expected: no mention of `release-init`; the numbered manual release steps are intact.
4. Open `docs/BACKLOG.md`. Expected: both former `release-init` items are checked (`- [x]`) with the closure note "Closed — release-init retired entirely in v1.9; see tasks/retire-release-init."
5. Open `CHANGELOG.md`. Expected: `## [Unreleased]` block has a `### Removed` section with a bullet for `canon task release-init`.

## Test Results

| Check | Result |
|---|---|
| Lint (`npm run lint`) | Pass |
| Type-check (`npm run typecheck`) | Pass |
| Unit tests (`npm test`) | Pass |
| Build (`npm run build`) | Pass |
| `git diff --exit-code -- dist/` | Pass |
| `git grep -n 'release-init' -- dist/` | Pass (no matches) |
| `npm run sync-templates:check` | Pass |
| `git grep -nE 'release-init\|releaseInit'` (allow-list check) | Pass |
| E2E | N/A — no browser/E2E layer; CLI behavior covered by node test suite |

## Human Verification Required

None.

## Decisions Made

- **No replacement script.** The decision (made with the product owner during spec authorship) was to remove with no replacement. `docs/release-process.md`'s manual flow is already complete and remains the documented process.
- **`readJsonFile` retained.** An early deletion of the `release-init` block accidentally removed this shared helper. Lint surfaced the regression immediately and it was restored before validation.
- **`docs/pipeline-invocations.md` not in AC-6 allow-list.** This telemetry file contains `retire-release-init` rows (the task ID is a substring match on `release-init`). The spec correctly anticipated that the allow-list might miss telemetry files, but the spec's shipped allow-list was never updated to include this file explicitly. The intent of AC-6 is fully satisfied — no command references survive — and this is recorded as a spec gap in review.md for future large-removal spec authors.

## Open Questions

None.

## Proposed Changelog

The `### Removed` entry is already present in `CHANGELOG.md` under `## [Unreleased]` as required by AC-10:

> **`canon task release-init` has been removed.** Release branches still start from `main`, but the shortcut command is gone; follow the manual release steps in `docs/release-process.md`.

**Proposed version bump:** Patch → `1.9.x` (removing a CLI subcommand that was already dead code and explicitly unusable by adopters). The removal is user-visible (the command no longer exists), but there is no working behavior to break — adopters using it would already be getting incorrect results. A minor bump (`1.10.0`) would also be defensible for a named CLI removal; this is the human's call at finalization.
