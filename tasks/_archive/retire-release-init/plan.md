# Plan: retire-release-init — Retire canon task release-init from the canon CLI

## Overview

Pure deletion task. No new logic; no replacement script. The work is: remove the implementation + tests, sweep all doc/help/skill references, rebuild `dist/`, and add a CHANGELOG entry. Steps are ordered so validation can be run once at the end rather than interleaved.

---

## Step 1 — Remove implementation from `src/task/index.ts`

File: `src/task/index.ts`

**Delete the `ReleaseInitOptions` type** (lines 24–26):
```typescript
export type ReleaseInitOptions = {
    pushFn?: (branch: string) => void;
};
```

**Delete the `usage()` line** for release-init (line 44):
```
'  release-init <version>',
```
Remove that string from the array in `usage()`. The surrounding lines (`post-merge-sync` and the closing `].join(...)`) stay.

**Delete the three private helpers** (contiguous block, lines 1180–1237):
- `updatePackageVersion()` — lines 1180–1193
- `insertChangelogBlock()` — lines 1195–1231
- `defaultPush()` — lines 1233–1237

Do NOT remove `writeJsonAtomic` — it is a shared utility used by the status.json write path elsewhere in the file.

**Delete `taskReleaseInit()`** (lines 1239–1328). This is the exported function itself.

**Delete the dispatch arm** in `taskCmd()` (lines 1364–1366):
```typescript
case 'release-init':
    taskReleaseInit(rest[0] ?? '');
    break;
```

After edits: run `grep -n 'release-init\|taskReleaseInit\|insertChangelogBlock\|updatePackageVersion\|defaultPush\|ReleaseInitOptions' src/task/index.ts` — must return zero matches.

---

## Step 2 — Remove help text from `src/cli/index.ts`

File: `src/cli/index.ts`

Delete the `release-init` entry from the `--help` output (line 64):
```
  release-init <version>  Create release/v<MAJ.MIN> off main with version bumped and an
```
Delete the full entry including any continuation lines. The surrounding help entries stay.

---

## Step 3 — Remove release-init tests from `tests/task-cli.test.ts`

**Update the import line** (line 8): remove `taskReleaseInit` from the named import list. The other imports (`taskAccept`, `taskList`, `taskNew`, `taskPhase`, `taskPostMergeSync`, `taskResetSpecReview`, `taskStatus`, `findUntrackedClobberPaths`) all stay.

**Delete the release-init-only fixture types** (lines 126–127) — verify they are not used by any other test before deleting:
```typescript
type PackageJsonFixture = { version: string };
type PackageLockFixture = { version: string; packages: { '': { version: string } } };
```

**Delete `setupReleaseRepo()`** (lines 910–928) — helper used only by the four release-init tests.

**Delete the four release-init tests** (lines 930–1052):
1. `'task release-init creates release branch, bumps files, commits, and uses injectable push'` (lines 930–955)
2. `'task release-init skips .canon/version when the file does not exist (adopter without .canon/ dir)'` (lines 957–983)
3. `'task release-init inserts new block after intro blockquote, before first existing version block'` (lines 985–1021)
4. `'task release-init exits non-zero with exact local-branch guard message'` (lines 1041–1052)

**Leave `runTaskCmd()` in place** (line 1023) — it is used by subsequent tests that follow the deleted block.

---

## Step 4 — Sweep `docs/release-process.md`

Three reference points, per AC-7. Manual numbered steps are untouched.

1. **History blockquote (line 17)**: Remove the literal `release-init` reference. Current text ends with: `— the same flow \`canon task release-init\` was already built for and the flow canon-ai recommends to adopters.` Replace the trailing clause with: `— the release-branch model canon-ai uses and recommends to adopters.`

2. **Line-77 note**: Delete the entire `> **Note**: \`canon task release-init <version>\` scaffolds most of this…` paragraph (the full block). Surrounding manual steps stay verbatim.

3. **Line-152 related-reference bullet**: Delete the `[pipeline-orchestrator.md](pipeline-orchestrator.md) §"Task management (canon task)" — \`canon task release-init\` helper…` bullet.

After edits: `git grep -nE 'release-init|releaseInit' -- docs/release-process.md` must return zero matches.

---

## Step 5 — Sweep `README.md`

Per AC-7:

1. **Table row (~line 197)**: Delete the `| \`canon task release-init <version>\` | … |` row from the command reference table.

2. **Lifecycle list item (~line 257)**: Remove `release-init` from the `canon task` lifecycle CLI list item. The surrounding items (`new / list / status / phase / accept / reset-spec-review / post-merge-sync`) stay; adjust the prose so the sentence reads coherently without the deleted term.

---

## Step 6 — Sweep `docs/pipeline-orchestrator.md` (canon-owned)

Per AC-7:

1. **Table row (~line 118)**: Delete the `| \`release-init\` | \`<version>\` | Initialize a \`release/v<MAJ.MIN>\`… |` row.

2. **Example invocation (~line 141)**: Delete the `canon task release-init 1.6.0` example line and its surrounding context so the remaining examples stay coherent.

The pre-commit `sync-templates` hook auto-re-syncs `templates/docs/pipeline-orchestrator.md`. Do not hand-edit `templates/`.

---

## Step 7 — Sweep `.claude/skills/canon-pipeline/SKILL.md` (canon-owned)

Per AC-7, three references:

1. **Frontmatter `description` (line 3)**: Remove `release-init` from the trigger list. Current: `Also for release branch operations: \`release-init\`, hotfix absorption, finalize-and-ship.` → Change to: `Also for release branch operations: hotfix absorption, finalize-and-ship.`

2. **Body step (~line 99)**: Delete the `canon task release-init X.Y.0` step. Repoint any surrounding "how to initialize a release branch" prose to the manual `docs/release-process.md` flow.

3. **"Want me to run release-init?" prompt (~line 106)**: Remove the `release-init` check. Replace with language directing the operator to the manual `docs/release-process.md` flow when a release branch doesn't exist yet.

The pre-commit hook auto-re-syncs `templates/.claude/skills/canon-pipeline/SKILL.md`.

---

## Step 8 — Sweep `.claude/skills/canon-changelog/SKILL.md` (canon-owned)

Per AC-7, three references (~lines 164, 169, 214):

- **~Line 164**: `"version was bumped at \`release-init\` time"` → `"version was bumped when the release branch was initialized"`
- **~Line 169**: `"the next cycle's \`release-init\` inserts the next \`## [X.Y.Z] — unreleased\`"` → `"the next release branch's initialization inserts the next \`## [X.Y.Z] — unreleased\`"`
- **~Line 214**: `/canon-pipeline` cross-reference: remove `\`release-init\`,` from `— for \`release-init\`, hotfix absorption, and finalize-ship operations.`

The pre-commit hook auto-re-syncs `templates/.claude/skills/canon-changelog/SKILL.md`.

---

## Step 9 — Close BACKLOG entries in `docs/BACKLOG.md`

Per AC-8, two entries to close (not delete — preserve decision trail):

1. **`release-init` postrun hook idea (~line 542)**: Change `- [ ]` to `- [x]` and append a closure note on the next line:
   ```
   Closed — release-init retired entirely in v1.9; see tasks/retire-release-init.
   ```

2. **Blockquote-ordering bug (~line 976)**: Same treatment — `- [x]` + same closure note.

The original entry text stays intact.

---

## Step 10 — Update `tests/fixtures/canon-dev-tokens.json`

Per AC-7, update the `_comment` field to remove `(release-init does this implicitly)`:

Current: `"Update active_release_branch when canon-ai cuts a new release branch (release-init does this implicitly)."`

New: `"Update active_release_branch when canon-ai cuts a new release branch (the operator does this step manually when initializing the release branch)."`

---

## Step 11 — Add CHANGELOG entry in `CHANGELOG.md`

Per AC-10: the current `## [Unreleased]` block has a `### Fixed` subsection. Add a `### Removed` subsection after `### Fixed` (Keep a Changelog alphabetical order: Added → Changed → Deprecated → Fixed → **Removed** → Security):

```markdown
### Removed

- **`canon task release-init` command removed.** The subcommand was out of canon's scope (general repo maintenance unrelated to the pipeline), hardcoded canon-ai's CHANGELOG format in a way that silently corrupts adopters on other formats, and was never actually used by canon-ai itself (which initializes releases manually per `docs/release-process.md`). Running `canon task release-init` now prints `Unknown subcommand: release-init` and exits non-zero.
```

---

## Step 12 — Build and validate

Run in order (each must pass before the next):

```bash
npm run lint          # eslint src/ tests/ scripts/ — no errors
npm run typecheck     # tsc --noEmit — no dangling refs to deleted symbols
npm test              # full suite clean; no release-init test present
npm run build         # regenerates dist/cli/index.js
```

After `npm run build`:
```bash
git diff --exit-code -- dist/   # clean — dist matches the built output
git grep -n 'release-init' -- dist/   # zero matches
```

Sync check:
```bash
npm run sync-templates:check    # templates mirror matches root
git grep -n 'release-init' -- templates/   # zero matches
```

Final AC-6 allow-list grep:
```bash
git grep -nE 'release-init|releaseInit'
```
Expected matches only in:
- `CHANGELOG.md` (historical entries + new Removed bullet)
- `docs/BACKLOG.md` (two closed entries with their original text)
- `tasks/retire-release-init/**` (this task's own artifacts)
- `tasks/_archive/**` (archived task dirs, if any)

No matches in: `src/`, `tests/`, `dist/`, `templates/`, `docs/release-process.md`, `README.md`, `docs/pipeline-orchestrator.md`, `.claude/skills/`, `tests/fixtures/`.
