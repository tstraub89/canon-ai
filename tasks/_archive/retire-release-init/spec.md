# Spec: retire-release-init — Retire canon task release-init from the canon CLI

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`canon task release-init <version>` is a CLI subcommand that creates a `release/v<MAJ.MIN>` branch off `main`, bumps `package.json` + `package-lock.json`, syncs `.canon/version`, inserts a CHANGELOG block, commits, and pushes. It does not earn its place in canon:

1. **It's out of scope.** Canon's git surface is justified where it serves the pipeline (worktree isolation, task PRs, `--ship` teardown ordering). Release-branch initialization is general repo maintenance that has nothing to do with the spec→implement→review→QA pipeline.

2. **Adopters can't use it correctly.** It hardcodes canon-ai's own release conventions:
   - `insertChangelogBlock` anchors on `/^## \[/` and emits `## [X.Y.Z] — unreleased` — the bracketed Keep-a-Changelog shape pinned to canon-ai's `auto-release.yml` extraction regex. An adopter on any other CHANGELOG format (e.g. `## vX.Y.Z - date`) gets `insertAt = -1` → a wrong-format block appended at the bottom of the file.
   - It overwrites `.canon/version` with the app version. But `.canon/version` is canon's **vendored-files version** (written by `canon upgrade` from `CANON_VERSION`, read by `upgrade`/`doctor`), not the adopter's app version. For adopters these are independent, so the write silently corrupts canon's own upgrade/doctor tracking. The justifying `package.json.version === .canon/version` assertion lives only in canon-ai's `auto-release.yml`, which is **not** shipped to adopters (`templates/` / `CANON_OWNED` do not include it).

3. **canon-ai itself doesn't use it.** Per `docs/release-process.md`, canon-ai initializes releases manually because `release-init` skips `npm run build`, and canon-ai commits a `dist/` with the version string baked in (CI's `git diff --exit-code -- dist/` fails otherwise). So the command is bypassed by the one repo on which its assumptions hold.

The command is effectively dead code with a footgun attached. The decision (made with the product owner) is to **remove it entirely, with no replacement script** — canon-ai's manual release flow is already documented step-by-step in `docs/release-process.md` and stays the process.

## Decision

Remove the `release-init` subcommand from the canon CLI in full: the dispatch case, the `taskReleaseInit` implementation, its private helpers (`insertChangelogBlock`, `updatePackageVersion`, `defaultPush`), the `ReleaseInitOptions` type, its tests, and every help-text / docs / skill reference. Rebuild and commit the bundled `dist/`. Sweep all references to point at canon-ai's documented manual flow. After removal, `canon task release-init` behaves like any other unknown subcommand: prints `Unknown subcommand: release-init` + usage and exits non-zero.

No replacement script is created. `docs/release-process.md`'s manual flow is preserved (only the pointers to the removed command are dropped from it).

## Non-Goals

- **No replacement script.** Not creating `scripts/release-init.*` or an `npm run release-init`. canon-ai's manual flow in `docs/release-process.md` remains the process.
- **Not touching `auto-release.yml`** or the `package.json.version === .canon/version` assertion — both canon-ai-internal and unaffected by this removal.
- **Not editing historical CHANGELOG entries** that mention past release-init bugfixes (1.4.0 `.canon/version` + header-format fixes, etc.). Those are immutable release history.
- **Not rewriting `docs/release-process.md`'s manual flow.** Only removing the command pointers (the line-77 note and the line-152 related-reference) and re-pointing any "release-init does this" parentheticals to the manual step. The numbered manual steps stay verbatim.
- **Not removing `writeJsonAtomic`** — it is shared (used for `status.json` writes), not release-init-private.
- **Not changing `canon task new`'s `base_branch` auto-detection** or any other release-branch *support* in canon — only the `release-init` initializer is removed.

## Acceptance Criteria

Checklist of verifiable outcomes. Each item must be testable.

- [ ] **AC-1 — Command removed from dispatch.** The `case 'release-init':` arm in `taskCmd` (`src/task/index.ts`) is deleted. Running `canon task release-init 1.9.0` (e.g. `node dist/cli/index.js task release-init 1.9.0`) prints `Unknown subcommand: release-init` followed by the usage block and exits with status 1. *Verify:* run the command against the built CLI; assert exit code 1 and the unknown-subcommand message.
- [ ] **AC-2 — Implementation and private helpers removed.** `taskReleaseInit`, `insertChangelogBlock`, `updatePackageVersion`, `defaultPush`, and the `ReleaseInitOptions` type are deleted from `src/task/index.ts`. *Verify:* `git grep -nE 'taskReleaseInit|insertChangelogBlock|updatePackageVersion|defaultPush|ReleaseInitOptions' -- src/ tests/ dist/` returns no matches. `writeJsonAtomic` still exists and is still referenced by the status.json write path.
- [ ] **AC-3 — Tests removed, suite green.** The `taskReleaseInit` import and the four `release-init` tests in `tests/task-cli.test.ts` (the create-branch/bump/commit test, the skip-`.canon/version` test, the blockquote-ordering test, and the local-branch-guard test) are deleted, along with any helper used only by them (`release-init-*` temp-dir setup). *Verify:* the full test suite (`npm test`) passes and contains no `release-init` test.
- [ ] **AC-4 — Help text removed.** The `release-init` entry in `src/cli/index.ts`'s `--help` output and the `release-init <version>` line in `src/task/index.ts`'s `usage()` subcommand list are both deleted. *Verify:* `node dist/cli/index.js --help` and `node dist/cli/index.js task` (no subcommand → usage) contain no `release-init`.
- [ ] **AC-5 — `dist/` rebuilt and committed.** `npm run build` is run and the resulting `dist/cli/index.js` (which inlines `src/task/index.ts`) is committed in the same change. *Verify:* `git diff --exit-code -- dist/` is clean after build (no uncommitted dist drift), and `git grep -n 'release-init' -- dist/` returns no matches.
- [ ] **AC-6 — No live reference survives outside the allow-list.** The strings `release-init` / `releaseInit` do not appear in any active doc, help text, or skill. *Allow-list (retained references are historical/record-keeping only):* `CHANGELOG.md` (historical entries), `docs/BACKLOG.md` (the two entries, marked resolved — see AC-8), and `tasks/**` (this task's own artifacts + archived task dirs). The `templates/**` mirrors are **not** allow-listed here — they are derived and verified clean separately by AC-9 (which greps `templates/` after the `sync-templates` re-sync). *Verify:* `git grep -nE 'release-init|releaseInit'` returns matches only under the allow-listed paths (and `templates/**` is clean per AC-9, not via this allow-list). **The allow-list MUST be regenerated from `git grep` against the current tree during spec_review** — the list above is the spec author's mental model and may miss files (archived `status.json` snapshots, template mirrors, telemetry docs).
- [ ] **AC-7 — Doc/skill sweep complete.** Each of the following has its `release-init` references removed or re-pointed at the manual flow, with surrounding prose left coherent (no dangling "see release-init" / broken cross-reference):
  - `docs/release-process.md` — remove the line-77 `> Note: canon task release-init scaffolds most of this…` paragraph and the line-152 related-reference bullet; reword the History blockquote (line 17) to remove the literal `release-init` reference (not merely soften it — past-tense prose that keeps the string still trips AC-6, which does **not** allow-list this file). After the sweep, `git grep -nE 'release-init|releaseInit' -- docs/release-process.md` MUST return zero matches. Manual steps unchanged.
  - `README.md` — remove the `canon task release-init` table row (~line 197) and the `release-init` item in the `canon task` lifecycle list (~line 257).
  - `docs/pipeline-orchestrator.md` — remove the `release-init` table row (~line 118) and the `canon task release-init 1.6.0` example (~line 141).
  - `.claude/skills/canon-pipeline/SKILL.md` — remove `release-init` from the frontmatter `description` (line 3), the `canon task release-init X.Y.0` step (~line 99), and the "want me to run `release-init`?" prompt (~line 106); re-point to the manual `docs/release-process.md` flow.
  - `.claude/skills/canon-changelog/SKILL.md` — reword the three references (lines ~164, ~169, ~214) so they describe the manual release-init flow ("version was bumped when the release branch was initialized" / "the next release branch's initialization") rather than naming the command.
  - `tests/fixtures/canon-dev-tokens.json` — update the `_comment` so it no longer says "release-init does this implicitly" (state that the operator updates `active_release_branch` when cutting a release branch).
  *Verify:* AC-6 grep passes; each listed file reads coherently on manual inspection.
- [ ] **AC-8 — BACKLOG entries resolved, not orphaned.** The two `release-init` BACKLOG entries (the `release-init-postrun` hook idea ~line 542 and the blockquote-ordering bug ~line 966) are marked resolved/closed with a one-line closure note (`Closed — release-init retired entirely in v1.9; see tasks/retire-release-init`), preserving the decision trail rather than silently deleting them. *Verify:* both entries show a closed state with the closure note; no open (`- [ ]`) release-init item remains in `docs/BACKLOG.md`.
- [ ] **AC-9 — Canon-owned mirror synced.** Because `docs/pipeline-orchestrator.md`, `.claude/skills/canon-pipeline/SKILL.md`, and `.claude/skills/canon-changelog/SKILL.md` are in `CANON_OWNED`, their `templates/` mirrors are re-synced (the pre-commit hook runs `sync-templates`; `npm run sync-templates:check` is the backstop). *Verify:* `npm run sync-templates:check` passes (templates match root), and `git grep -n 'release-init' -- templates/` returns no matches.
- [ ] **AC-10 — CHANGELOG entry added.** A bullet is added to the active `## [Unreleased]` block in `CHANGELOG.md` (the current top block; it is the generic `## [Unreleased]` header mid-cycle and gets versioned at release-finalization time — do not invent a `## [1.9.0]` block). Because removing a command is a Keep-a-Changelog **Removed** change, add the bullet under a `### Removed` subsection within the Unreleased block (create the subsection if absent — the block currently has only `### Fixed`), noting that `canon task release-init` was removed (adopter-visible CLI change). *Verify:* the `## [Unreleased]` block contains a `### Removed` entry naming `canon task release-init`.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/task/index.ts` | Delete `taskReleaseInit`, `insertChangelogBlock`, `updatePackageVersion`, `defaultPush`, `ReleaseInitOptions`; delete the `case 'release-init':` dispatch arm; delete the `release-init <version>` line from `usage()`. Keep `writeJsonAtomic`. |
| `src/cli/index.ts` | Delete the `release-init` entry from the `--help` text. |
| `dist/cli/index.js` | Regenerate via `npm run build` (inlines `src/task/index.ts`); commit atomically with the source change. |
| `tests/task-cli.test.ts` | Delete the `taskReleaseInit` import and the four `release-init` tests + their release-init-only temp-dir helper. |
| `docs/release-process.md` | Remove the line-77 release-init note and line-152 related-reference; reword the History blockquote (line 17). Manual steps unchanged. |
| `README.md` | Remove the `canon task release-init` table row and the `release-init` lifecycle-list item. |
| `docs/pipeline-orchestrator.md` | (canon-owned) Remove the `release-init` table row and the example invocation. |
| `.claude/skills/canon-pipeline/SKILL.md` | (canon-owned) Remove `release-init` from frontmatter description + the two body references; re-point to manual flow. |
| `.claude/skills/canon-changelog/SKILL.md` | (canon-owned) Reword the three references away from naming the command. |
| `docs/BACKLOG.md` | Mark the two release-init entries resolved with a closure note. |
| `tests/fixtures/canon-dev-tokens.json` | Update the `_comment` to drop the "release-init does this implicitly" clause. |
| `CHANGELOG.md` | Append removal bullet to the active `## [Unreleased]` block (see AC-10). |
| `templates/docs/pipeline-orchestrator.md` | **Derived mirror** — auto-regenerated by the `sync-templates` hook from the canon-owned root copy. Not hand-edited. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | **Derived mirror** — auto-regenerated by the `sync-templates` hook from the canon-owned root copy. Not hand-edited. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | **Derived mirror** — auto-regenerated by the `sync-templates` hook from the canon-owned root copy. Not hand-edited. |

The three `templates/` rows are **derived mirrors** — never hand-edited; the pre-commit `sync-templates` hook regenerates them from the canon-owned root copies (AC-9). They are listed here nonetheless because the `--pr` base-drift gate diffs HEAD against `origin/<base>` and rejects any changed file not in this table — it does not distinguish generated artifacts from hand edits. Same rationale as declaring `dist/` (CLAUDE.md: "build-generated artifacts go in Affected Files alongside their sources").

### Interaction Dependencies

- **`--pr` base-drift gate / CI `git diff --exit-code -- dist/`:** the committed `dist/` bundle must be rebuilt (AC-5). An undeclared/stale `dist/` fails both gates. `dist/cli/index.js` **and the three `templates/` mirrors** are declared in Affected Files so the `--pr` allow-list accepts them — the gate rejects any changed file outside the table regardless of whether it is generated.
- **`sync-templates` pre-commit hook:** edits to the three canon-owned files trigger automatic `templates/` re-sync + re-stage (AC-9). Implementer must let the hook run (or run `npm run sync-templates`), not hand-edit `templates/`.
- **`canon task new` base-branch auto-detection and other release-branch support** are unaffected — only the initializer is removed.

### Data Model Changes

None. No changes to `status.json` shape, shared types (the only deleted type, `ReleaseInitOptions`, was release-init-private), or persistent data.

## Validation Required

- [x] `npm run lint` (eslint src/ tests/ scripts/)
- [x] `npm run typecheck` (tsc --noEmit) — confirms no dangling reference to the deleted symbols/type
- [x] `npm test` — full suite runs clean (with the four release-init tests removed)
- [x] `npm run build` (tsup) — regenerates `dist/`; commit the result, then confirm `git diff --exit-code -- dist/` is clean
- [ ] E2E — N/A (no browser/E2E layer; CLI behavior covered by the node test suite)
- [x] `npm run sync-templates:check` — templates mirror matches root after the canon-owned edits

## Docs Impact

- `docs/pipeline-orchestrator.md` (protected, canon-owned) — release-init row + example removed (AC-7, AC-9).
- `docs/release-process.md`, `README.md`, `docs/BACKLOG.md` — updated (AC-7, AC-8); not in the protected managed-doc set but swept for coherence.
- Skills `canon-pipeline` / `canon-changelog` (canon-owned) — references reworded (AC-7, AC-9).
- No changes to `codebase-map.md`, `decisions.md`, `patterns.md`, `architecture.md`, `product-context.md`.

## Known Risks

- **Stale `dist/` (highest-likelihood failure).** Forgetting `npm run build`, or committing source without the regenerated bundle, fails the `--pr` base-drift gate and CI's `git diff --exit-code -- dist/`. Mitigation: AC-5 makes the rebuild explicit and verifies a clean `dist/` diff post-build.
- **Incomplete grep allow-list.** The AC-6 allow-list is the author's mental model and may miss archived `status.json` snapshots, telemetry docs, or template mirrors that legitimately contain `release-init`. Mitigation: AC-6 mandates regenerating the allow-list from `git grep` against the current tree at spec_review (per the CLAUDE.md large-removal rule of thumb).
- **Dangling cross-references.** Removing a referenced command can leave "see release-init" dangling in prose. Mitigation: AC-7 requires each swept file to read coherently, not just to lose the literal string.
- **Templates drift if the hook is bypassed.** If the implementer hand-edits `templates/` or commits with the hook disabled, the mirror diverges. Mitigation: AC-9 verifies via `sync-templates:check`.
- **Low blast radius overall:** the command is already unused by canon-ai and unusable by adopters, so removal cannot regress a working flow. The auto-release pipeline and release-branch support are untouched.

## Human Test Plan

1. After the change ships, ask canon to initialize a release branch the old way — e.g. "run canon task release-init 1.10.0". Expected: canon reports the subcommand no longer exists (unknown subcommand) rather than doing anything, and there is no `release-init` listed anywhere in the canon help.
2. Open the canon help / command reference and the release-process document. Expected: no mention of a `release-init` command anywhere; the release-process document still describes the full step-by-step manual way to start a release branch, unchanged.
3. Open the project backlog. Expected: the two old release-init to-do items are marked closed with a short note saying the command was retired, not silently gone.
4. Confirm a normal release can still be cut by following the documented manual steps (create the branch, bump the version, rebuild, add the changelog block, push) — nothing about the normal release process changed except that no `release-init` shortcut exists.
5. Open the release notes / changelog for the upcoming version. Expected: a line noting the `canon task release-init` command was removed.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full-tier M task; plan written in pipeline)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
