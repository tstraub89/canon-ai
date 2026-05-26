# Spec: canon-docs-dedup — Eliminate templates/-root drift via sync script + pre-commit/CI gate

> Written by: Claude | Review by: Codex
> Status: draft (revised 2026-05-24 — replaced earlier symlink + heading-lint approach with a sync script after operator feedback about preserving canon-on-canon outside-delimiter freedom)

## Problem

canon-ai-dev is dual-use: it runs canon's pipeline on itself (so it needs its own `docs/`, `AGENTS.md`, `CLAUDE.md`, etc.) AND it ships those same files to adopters via `canon init` (full `templates/` tree wholesale-copied) and `canon upgrade` (`CANON_OWNED` wholesale + `DELIMITED` merge). The two-copy layout means every canon-managed file change has to land in both root AND `templates/` in the same commit. The pipeline only auto-commits root-side files — the `templates/` copy drifts silently.

**Concrete drift surface as of 2026-05-24**:

- `templates/docs/pipeline-orchestrator.md` is missing **three** structural paragraphs from prior PRs that landed only in `docs/pipeline-orchestrator.md`:
  - Auto-commit allow-list expansion (PR #96)
  - Base-drift check paragraph (PR #97)
  - Reroute amendment convention paragraph (PR #99)
- `templates/scripts/docs-refs-check.mjs` is missing the `isNoisySourceFile` 3-class exemption block (root has the carve-out for `templates/...spec.md` + `tasks/<id>/spec.md`; templates/ has the older 2-class set). The drift was explicitly deferred to this task by PR #101 (`docs-refs-adopter-skip-and-ellipsis`). **This is identical to the failure mode this task is fixing** — proof the manual-parallel-edit operator rule (memory `feedback_canon_delimited_files_template_parallel_edit`) isn't sticking.
- `scripts/docs-refs-check.mjs.d.ts` exists in root but **not in `templates/scripts/`**, and is **not in `CANON_OWNED`**. The `.mjs` ships to adopters via `canon upgrade` but its TypeScript declaration file does not. Adopters who copy canon-ai-dev's test pattern (`tests/docs-refs-check.test.ts:7` imports `runChecks` + `NOISY_SOURCE_PATHS` from the `.mjs`) hit type errors. PR #101 made the gap more visible by extending the `.d.ts` with the new `runChecks(repoRoot, options?)` signature and `NOISY_SOURCE_PATHS` export.
- **15 other canon-managed files happen to be byte-identical today but have no enforcement** against the next silent drift: the remaining `CANON_OWNED` paths in `src/cli/commands/upgrade.ts:26-49` (the `.canon/templates/*` task scaffolding, the five `.claude/skills/canon-*/SKILL.md` skills, `.canon/README.md`) and `.codex/config.toml` (not in `CANON_OWNED`, but shipped via `canon init`'s wholesale `templates/` walk).
- DELIMITED files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`) have intentional pedagogical-example divergence inside `<!-- canon:start -->...<!-- canon:end -->` today, but the canon-managed region can still grow asymmetrically. The recurring "edit both sides" cost applies here too.

The manual-parallel-edit rule helps a careful operator but doesn't catch pipeline-initiated edits or honest mistakes. The drift on `scripts/docs-refs-check.mjs` proves the manual approach fails in practice. We want a structural fix.

## Decision

A sync script plus two enforcement gates. Together, they prevent `templates/`-root drift for every canon-managed path.

**Sync script — `scripts/sync-canon-templates.mjs`** with two modes:

- `--apply` (default): copies canon-managed content from root → `templates/` in two patterns:
  1. **Wholesale sync** — full file copy for every entry in `WHOLESALE_SYNC = CANON_OWNED ∪ {.codex/config.toml}`. After this task lands, `CANON_OWNED` has **17 paths** (the existing 16 from `src/cli/commands/upgrade.ts:26-49` plus the new `scripts/docs-refs-check.mjs.d.ts` entry — see *Initial CANON_OWNED extension* below). The sync script imports `CANON_OWNED` directly so the two lists never drift apart.
  2. **In-delimiter sync** — for every entry in `DELIMITED_SYNC = {AGENTS.md, CLAUDE.md, CODEX.md}`, copies only the content between `<!-- canon:start -->` and `<!-- canon:end -->` (inclusive of the markers) from root → `templates/`. Outside-delimiter content on each side is preserved independently. Reuses the existing delimiter regex / parsing logic from `src/cli/commands/upgrade.ts` if a clean exposure exists; otherwise inlines an equivalent.

**Initial `CANON_OWNED` extension**: this task adds `'scripts/docs-refs-check.mjs.d.ts'` to `CANON_OWNED` in `src/cli/commands/upgrade.ts:26-49`. The companion file `templates/scripts/docs-refs-check.mjs.d.ts` does not exist today; the initial sync run creates it as a wholesale copy of the root `.d.ts`. After this task ships, `canon upgrade` ships both the `.mjs` and the matching `.d.ts` to adopters as a pair.
- `--check`: same comparison, writes no files. Exit `0` if every target is in sync, `1` otherwise. Prints the list of drifted paths to stderr.

**Pre-commit hook**: a minimal dev-side hook framework (`simple-git-hooks` recommended; final pick is Codex's during plan) runs `npm run sync-templates` on every `git commit`, then `git add`s the templates/ files in `WHOLESALE_SYNC ∪ DELIMITED_SYNC`. Catches drift before it lands. Local-only — never shipped to adopters via `canon init`/`canon upgrade` (the devDep + hook config live in `package.json` and adopters don't run `npm install` for canon-ai-dev's devDeps).

**CI gate**: `.github/workflows/ci.yml` gains a `npm run sync-templates:check` step (inserted between `npm run lint` and `npm run docs-refs-check`). Fails the build on any drift. Safety net for contributors who bypass the hook (`--no-verify`) or land work without it installed locally.

**Replaces the earlier symlink + class-2 heading-lint split.** The unified sync handles both:
- What was class-1 (`templates/CODEX.md`, `templates/docs/pipeline-orchestrator.md`) → `CODEX.md` in `DELIMITED_SYNC`, `docs/pipeline-orchestrator.md` in `WHOLESALE_SYNC` (it's already in `CANON_OWNED`).
- What was class-2 (AGENTS.md / CLAUDE.md heading-set lint) → replaced with in-delimiter byte-sync. **The pre-existing pedagogical-example divergence inside delimiters is intentionally retired** — `templates/AGENTS.md`'s in-delimiter content will match root `AGENTS.md` byte-for-byte after the initial sync. Adopters will see canon-ai-dev's own references (e.g., `scripts/docs-refs-check.mjs`) as examples, which is already the pattern: that same script ships to adopters anyway.

**Initial sync (committed in this task)**: the script's first `--apply` run produces a diff that:
- Updates `templates/docs/pipeline-orchestrator.md` to match `docs/pipeline-orchestrator.md` (resolves the 3-paragraph drift from PRs #96/#97/#99).
- Updates `templates/scripts/docs-refs-check.mjs` to match `scripts/docs-refs-check.mjs` (resolves the `isNoisySourceFile` 3-class-vs-2-class drift deferred from PR #101).
- Creates `templates/scripts/docs-refs-check.mjs.d.ts` (new file, wholesale copy of root `scripts/docs-refs-check.mjs.d.ts` — see *Initial CANON_OWNED extension* in *Decision*).
- Updates `templates/AGENTS.md` in-delimiter region to match root — concretely **2 line changes**:
  - line 184 — pedagogical example flips from `RETRY_TIMEOUT_MS` in `src/example/retry.ts` to `VALID_DIRS` in `scripts/docs-refs-check.mjs` (root's version; since `scripts/docs-refs-check.mjs` is itself shipped to adopters via `CANON_OWNED`, referencing it as the example is internally consistent).
  - line 275 — adds the missing `| Docs references | Docs references |` validation-matrix row (drift, not intentional divergence).
- Updates `templates/CLAUDE.md` in-delimiter region to match root — **no diff** (manually pre-aligned during spec authorship; root and templates/ are now byte-identical).
- Updates `templates/CODEX.md` in-delimiter region to match root — **no diff** (already byte-identical inside delimiters).
- All other `WHOLESALE_SYNC` entries are byte-identical today, so no diff there.

**Total initial-sync diff** outside the already-known drift on pipeline-orchestrator and docs-refs-check.mjs: **2 line changes** in `templates/AGENTS.md` plus **1 new file** at `templates/scripts/docs-refs-check.mjs.d.ts` (wholesale copy of root). Not noisy.

## Non-Goals

- **Adopter-side enforcement.** The hook and CI gate are canon-ai-dev developer tooling only. Adopters never install the hook; they don't carry `templates/` post-`canon init` (the tree is unpacked into the project root and `templates/` is deleted).
- **Bidirectional sync.** Root is authoritative; `templates/` is derived. Templates-side edits to canon-managed regions are silently overwritten on next `--apply`. `--check` names the path so the developer notices.
- **Symlinks.** Earlier draft proposed symlinking; rejected because canon-ai-dev may want to add outside-delimiter content to a file for canon-on-canon dev work without forcing `templates/` to inherit it. Sync respects the delimiter model.
- **Heading-set lint as a separate mechanism.** Subsumed by in-delimiter byte-sync.
- **Preserving the operator memory rule.** `feedback_canon_delimited_files_template_parallel_edit` becomes obsolete after this task ships — the gate enforces the rule structurally. Memory cleanup is an explicit AC.
- **Auto-detecting which files belong in `WHOLESALE_SYNC` vs `DELIMITED_SYNC`.** This task enumerates them. New canon-managed files added by future tasks must extend the appropriate set explicitly.
- **Cross-platform symlink testing on Windows.** Sync is OS-agnostic (file copy + string slicing). No Windows-specific concern.

## Acceptance Criteria

- [ ] **AC-1**: `scripts/sync-canon-templates.mjs` exists. Running with no args (or explicit `--apply`) syncs canon-managed content from root → `templates/` for every entry in `WHOLESALE_SYNC ∪ DELIMITED_SYNC`. The script imports `CANON_OWNED` directly from `src/cli/commands/upgrade.ts` (or a shared module) so the two lists cannot drift. Running on the current tree (after the AC-14 `CANON_OWNED` extension lands) updates exactly: `templates/docs/pipeline-orchestrator.md`, `templates/scripts/docs-refs-check.mjs`, the in-delimiter region of `templates/AGENTS.md`, and creates `templates/scripts/docs-refs-check.mjs.d.ts`. `templates/CLAUDE.md` and `templates/CODEX.md` are already in sync and should NOT change. No other files change.

- [ ] **AC-2**: Running `--apply` on a freshly-synced tree is a no-op. `git status` shows no changes after a second back-to-back run.

- [ ] **AC-3**: `--check` mode performs the same comparison as `--apply` but writes no files. Exit code `0` when in sync, `1` when any file would change. Stderr lists every drifted path on its own line, prefixed with the sync class (`[wholesale]` or `[delimited]`) and the action (e.g., `[wholesale] templates/scripts/docs-refs-check.mjs differs from scripts/docs-refs-check.mjs`).

- [ ] **AC-4**: Wholesale sync copies the root file byte-for-byte to the `templates/` side. Verified by: (a) running `--apply`, then `diff <root> <templates>` for each WHOLESALE_SYNC entry shows no output; (b) deliberately mutating a templates/ wholesale file and running `--check` reports it.

- [ ] **AC-5**: In-delimiter sync extracts the content between `<!-- canon:start -->` and `<!-- canon:end -->` (markers inclusive) from the root file and replaces the equivalent region in the templates/ file. Outside-delimiter content on each side is preserved exactly. Verified by:
  - Adding a unique line below `<!-- canon:end -->` in `templates/AGENTS.md`. Run `--apply`. Confirm the line remains.
  - Adding a unique line below `<!-- canon:end -->` in root `AGENTS.md`. Run `--apply`. Confirm `templates/AGENTS.md`'s outside-delimiter content is untouched (root's outside-delimiter content does NOT propagate to templates/).
  - Modifying inside-delimiter content on the templates/ side and running `--apply`. Confirm templates/ is reverted to match root's in-delimiter content.

- [ ] **AC-6**: Tests in `tests/sync-canon-templates.test.ts` (NEW file) cover: wholesale sync direction (root → templates/, never reverse), in-delimiter sync preserving outside-delimiter content on both sides, `--check` exit codes for clean and drifted fixtures (string-level fixtures, not real-FS), idempotence of repeated `--apply`. ~150 lines.

- [ ] **AC-7**: A pre-commit hook is installed via `simple-git-hooks` (or an equivalent minimal devDep — pick during plan) that runs `npm run sync-templates` on every commit, then auto-stages modified files in `WHOLESALE_SYNC ∪ DELIMITED_SYNC` via `git add`. Verified by:
  - Editing `docs/pipeline-orchestrator.md`, running `git commit`, and confirming the resulting commit includes `templates/docs/pipeline-orchestrator.md` automatically (verify with `git log -1 --name-only`).
  - Confirming canon's own hook config does NOT install into an adopter project after `canon init` — specifically: the adopter's `package.json` has no `simple-git-hooks` (or chosen framework) field added by canon, and `canon init` does not write or modify the adopter's `.git/hooks/pre-commit`. Pre-existing adopter-owned hooks are untouched.

- [ ] **AC-8**: `.github/workflows/ci.yml` gains a step running `npm run sync-templates:check` between `npm run lint` and `npm run docs-refs-check`. The step fails the build on any drift. Verified by:
  - On a throwaway branch, deliberately commit a drifted state (with `--no-verify` to bypass the hook) and push. Observe the CI job fail with the step naming the drifted file.

- [ ] **AC-9**: `package.json` gains `"sync-templates"` and `"sync-templates:check"` scripts. The chosen hook framework (e.g., `simple-git-hooks`) is added to `devDependencies` only. The hook config (e.g., `"simple-git-hooks": { "pre-commit": "..." }`) is added to `package.json`. `npm install` triggers hook installation via the framework's documented mechanism (e.g., `postinstall`). `package-lock.json` is regenerated by `npm install` and committed in the same commit as the `package.json` change — Codex is explicitly authorized to edit/commit the lockfile (do not hand-edit it; let `npm install` produce it).

- [ ] **AC-10**: `npm run docs-refs-check` continues to return `All refs OK` after the initial sync. The new sync script and its tests are referenced cleanly from the docs (or not referenced at all) — no broken refs introduced.

- [ ] **AC-11**: `canon upgrade` continues to write the correct content into adopters. `npm pack` produces a tarball whose `templates/` files match the synced root content; extract and verify `templates/docs/pipeline-orchestrator.md`, `templates/scripts/docs-refs-check.mjs`, and `templates/AGENTS.md` byte-equal expected synced state.

- [ ] **AC-12**: `CLAUDE.md` gains a paragraph (under "Spec-writing rules of thumb" or a new "Canon-managed file convention" subsection — Codex's choice) documenting:
  - Root is the source of truth for canon-managed content.
  - Templates/-side edits to canon-managed regions are silently overwritten by `--apply`.
  - The pre-commit hook auto-syncs and re-stages.
  - The CI check is the safety net.
  - New canon-managed files must be added to `WHOLESALE_SYNC` (if wholesale-canon-owned) or `DELIMITED_SYNC` (if delimited).
  - The corresponding `templates/CLAUDE.md` update happens automatically via the sync (CLAUDE.md is in `DELIMITED_SYNC`).

- [ ] **AC-13**: `done.md` includes a memory-update todo: remove or rewrite `feedback_canon_delimited_files_template_parallel_edit` to point at the new gate. (Operator runs the cleanup post-merge; not a code change.)

- [ ] **AC-14**: `'scripts/docs-refs-check.mjs.d.ts'` is added to `CANON_OWNED` in `src/cli/commands/upgrade.ts:26-49` (alongside the existing `'scripts/docs-refs-check.mjs'` entry). Verified by: (a) reading `CANON_OWNED` and asserting both paths are present; (b) `templates/scripts/docs-refs-check.mjs.d.ts` exists after the initial sync run and byte-equals `scripts/docs-refs-check.mjs.d.ts`; (c) `npm pack --dry-run` lists `templates/scripts/docs-refs-check.mjs.d.ts` as a regular file in the tarball; (d) a fresh `canon upgrade` against a temp adopter fixture writes the `.d.ts` into the adopter's `scripts/` alongside the `.mjs`.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/sync-canon-templates.mjs` | NEW. ~150–200 lines. Implements `--apply` (default) and `--check`. Imports `CANON_OWNED` from `src/cli/commands/upgrade.ts` (or a shared module factored out as needed). Reuses delimiter parsing from upgrade.ts if cleanly accessible; otherwise inlines an equivalent ~20-line implementation. |
| `tests/sync-canon-templates.test.ts` | NEW. ~150 lines. Per AC-6. String-fixture-based; no real-FS mutation needed for most cases. |
| `package.json` | Add `sync-templates` and `sync-templates:check` scripts; add `simple-git-hooks` (or equivalent) to devDeps; add hook config block. |
| `package-lock.json` | Updated by `npm install` after the new devDep is added to `package.json`. Commit the regenerated lockfile in the same commit as the `package.json` change. Do not hand-edit. |
| `.github/workflows/ci.yml` | Add `- run: npm run sync-templates:check` between the existing `npm run lint` and `npm run docs-refs-check` steps (around line 59). |
| `templates/docs/pipeline-orchestrator.md` | Initial sync — matches `docs/pipeline-orchestrator.md` (adds 3 missing paragraphs). |
| `templates/scripts/docs-refs-check.mjs` | Initial sync — matches `scripts/docs-refs-check.mjs` (resolves the `isNoisySourceFile` 3-class-vs-2-class drift deferred from PR #101). |
| `src/cli/commands/upgrade.ts` | Add `'scripts/docs-refs-check.mjs.d.ts'` to the `CANON_OWNED` array (`src/cli/commands/upgrade.ts:26-49`) so `canon upgrade` ships the `.d.ts` to adopters alongside the `.mjs`. Per AC-14. |
| `templates/scripts/docs-refs-check.mjs.d.ts` | NEW file. Initial sync creates it as a wholesale copy of root `scripts/docs-refs-check.mjs.d.ts`. |
| `templates/AGENTS.md` | Initial sync (in-delimiter) — inside `<!-- canon:start -->...<!-- canon:end -->` matches root `AGENTS.md`. Outside-delimiter content preserved. |
| `templates/CLAUDE.md` | Initial sync (in-delimiter) — same pattern as templates/AGENTS.md. |
| `templates/CODEX.md` | Initial sync (in-delimiter) — currently byte-identical, no visible diff but the sync mechanism now guards it. |
| `CLAUDE.md` | New convention paragraph per AC-12. Corresponding templates/CLAUDE.md update happens via sync automatically (same commit). |
| `docs/codebase-map.md` | Freshness pass per *Docs Impact*: register `scripts/sync-canon-templates.mjs`, its test, and the new npm scripts / pre-commit hook framework. |
| `docs/architecture.md` | Freshness pass per *Docs Impact*: add `npm run sync-templates:check` under Validation; record the new CI step under CI. |
| `AGENTS.md` | Freshness pass per *Docs Impact*: this task changes a developer workflow rule (root authoritative, templates derived, hook + CI enforce). AGENTS.md is the workflow source of truth and must reflect the new convention. Edit inside the canon-delimited region; the corresponding `templates/AGENTS.md` change rides along via in-delimiter sync in the same commit. |

### Interaction Dependencies

- **`canon upgrade`** (`src/cli/commands/upgrade.ts:223-242`): reads `templates/<rel>` via `readFileSync`. No change — sync writes regular files at those paths; upgrade behavior unchanged.
- **`canon init`** (`src/cli/commands/init.ts:33-53`): walks the entire `templates/` tree wholesale-copying to adopters. No change. `templates/.codex/config.toml` ships via this path (which is why `.codex/config.toml` is in `WHOLESALE_SYNC` even though it's not in `CANON_OWNED`).
- **`docs-refs-check`** (`scripts/docs-refs-check.mjs`): scans both root and `templates/` markdown. No interaction with the sync script itself. After the initial sync, both copies have the same broken-ref status (i.e., none).
- **`npm pack` / publish**: bundles the `templates/` tree from disk. Sync must have run before publish — CI gate enforces.
- **Pipeline auto-commit** (`scripts/run-task/main.ts:622`, `scripts/run-task/git.ts:41-45`): the orchestrator commits via `spawnSync('git', ['commit', '-m', ...])` through the `gitSafeAt` wrapper. **No `--no-verify` is passed** (verified: no occurrence of `no-verify` anywhere in `scripts/run-task/` or `src/`), so pre-commit hooks **will fire** on every orchestrator auto-commit. The flow:
  1. Orchestrator stages handoff files via `git add`.
  2. Orchestrator's pre-check (`scripts/run-task/main.ts:604`) verifies `stagedAfter` matches the handoff allow-list. This check runs **before** the commit, so it observes only the orchestrator's staged set.
  3. `git commit` fires → pre-commit hook runs `npm run sync-templates` → sync stages updated `templates/` files via `git add`.
  4. Commit completes with handoff files **plus** the hook-added `templates/` files.
  5. `verifyHandoffFilesCommitted` (`scripts/run-task/main.ts:199-288`) confirms handoff files **are** in the commit (one-way check: `handoff ⊆ committed`). It does **not** object to additional `templates/` files riding along.
  
  Net: the design works without orchestrator changes. The templates/ updates ride along into the same commit as the root changes that triggered them. The plan phase should add a regression test asserting this behavior (e.g., simulate an auto-commit of `docs/pipeline-orchestrator.md` and confirm `templates/docs/pipeline-orchestrator.md` lands in the same commit).
- **Operator memory rule**: `feedback_canon_delimited_files_template_parallel_edit` is rendered obsolete. AC-13 records the cleanup TODO.

### Data Model Changes

`CANON_OWNED` gains one new entry (`'scripts/docs-refs-check.mjs.d.ts'`) per AC-14. No other schema changes — no `status.json` schema changes, no new template directories. The sync script reads `CANON_OWNED` as-is after the AC-14 extension.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — including the new `tests/sync-canon-templates.test.ts`.
- [x] `docs-refs-check` (`npm run docs-refs-check`) — post-sync state still passes.
- [x] `sync-templates:check` (`npm run sync-templates:check`) — exits 0 after initial sync committed.
- [x] `build` (`npm run build`) — dist-freshness gate.
- [ ] `E2E` — N/A; no UI.

**Additional manual check (recorded in handoff)**: run `npm pack`, extract the tarball, and confirm `templates/docs/pipeline-orchestrator.md`, `templates/scripts/docs-refs-check.mjs`, `templates/AGENTS.md`, and `templates/CLAUDE.md` are regular files containing the post-sync content. Compare against the corresponding root files (in-delimiter for the delimited set).

## Docs Impact

- `CLAUDE.md` — Adds the new "Canon-managed file convention" paragraph (AC-12).
- `templates/CLAUDE.md` — Updated automatically via in-delimiter sync.
- `docs/codebase-map.md` — Freshness pass: add `scripts/sync-canon-templates.mjs` (and its test) under the appropriate section so future tasks can find it; mention the new `sync-templates` / `sync-templates:check` npm scripts and the pre-commit hook framework alongside other dev tooling entries.
- `docs/architecture.md` — Freshness pass under the Validation section to register `npm run sync-templates:check` as a project command, and under the CI subsection to record the new CI step's position in the workflow.
- `AGENTS.md` — Freshness pass inside the canon-delimited region: this task changes a workflow rule (root is authoritative for canon-managed content; templates/ is derived; hook + CI enforce). AGENTS.md is the workflow source of truth — add a one-paragraph note (in the file's existing workflow sections, Codex picks the right place) so the rule is discoverable from the canonical doc. Outside-delimiter edits not needed. `templates/AGENTS.md` matches automatically via in-delimiter sync.
- Operator memory `feedback_canon_delimited_files_template_parallel_edit` — Removed or pointed at the new gate during QA (AC-13).

## Known Risks

- **Pre-commit hook + pipeline auto-commit interaction**: verified in *Interaction Dependencies* above — orchestrator auto-commits run `git commit` without `--no-verify`, so hooks fire and the templates/ updates ride along into the same commit. The orchestrator's pre-staging allow-list check (`scripts/run-task/main.ts:604`) runs **before** the hook, so the hook's templates/ additions don't trigger the "staged-after-outside-handoff" abort. The post-commit `verifyHandoffFilesCommitted` check (`scripts/run-task/main.ts:199-288`) is one-way (`handoff ⊆ committed`), so it accepts additional files. **Plan phase must add a regression test** for this exact path: simulate an orchestrator-style commit of a root canon-managed file, assert the matching `templates/` file lands in the same commit.
- **Hook framework dependency**: introduces one new devDep (`simple-git-hooks` or chosen equivalent — single small package, dev-only, never shipped to adopters since canon init copies templates content, not package.json devDeps).
- **Initial-sync diff scope**: the first commit changes 3 templates/ files but the diff is small in aggregate — 3 paragraphs in `templates/docs/pipeline-orchestrator.md`, the carve-out logic in `templates/scripts/docs-refs-check.mjs`, and 2 lines in `templates/AGENTS.md`. CLAUDE.md was pre-aligned during spec authorship; CODEX.md is already in sync. Concrete line-level changes are enumerated in *Decision* > *Initial sync*. PR body should reference that list so the reviewer can audit each line.
- **Templates-side edits to canon-managed regions are silently overwritten**: a developer (or the orchestrator) editing `templates/scripts/docs-refs-check.mjs` directly will see their change reverted by the next sync. Mitigation: `--check`'s stderr message names the templates/ file and points at the root copy ("edit `scripts/docs-refs-check.mjs` instead"). The new CLAUDE.md paragraph (AC-12) calls this out for operators.
- **CI step ordering**: `sync-templates:check` runs before `docs-refs-check`. Reverse ordering would let a `templates/scripts/docs-refs-check.mjs`-drifted state pass docs-refs-check (which scans both copies and they'd disagree on what's "valid") before sync-templates:check catches it. Order is documented in AC-8.
- **Adopters never see the sync mechanism**: a canon adopter receives the SHIPPED state of `templates/` from the npm tarball at install time. They never run the sync script. This is the intended model — sync is a canon-ai-dev developer-tooling concern.
- **`simple-git-hooks` installation timing**: the hook is registered via `postinstall`. A fresh clone that hasn't run `npm install` yet has no hook — first-time contributors might commit drift before CI catches it. This is acceptable (CI gate is the safety net); document in CLAUDE.md so onboarding mentions `npm install` upfront.

## Human Test Plan

1. From the merged branch on a fresh clone, run `npm install` (registers the pre-commit hook).
2. Run `npm run sync-templates:check`. Expected: `All canon-managed files in sync` (or equivalent green message), exit code 0.
3. Edit `docs/pipeline-orchestrator.md` (add a test paragraph). Save. Run `git commit -am "test"`. Expected: the pre-commit hook fires, `templates/docs/pipeline-orchestrator.md` updates automatically, and `git log -1 --name-only` shows both files in the commit. Revert with `git reset HEAD~1 --hard`.
4. Edit the canon-delimited region of `AGENTS.md` (anywhere between `<!-- canon:start -->` and `<!-- canon:end -->`). Save. `git commit -am "test"`. Expected: `templates/AGENTS.md`'s in-delimiter region updates to match; outside-delimiter content unchanged. Revert.
5. Edit the outside-delimiter region of `templates/AGENTS.md` (below `<!-- canon:end -->`). Save. `git commit -am "test"`. Expected: commit succeeds; root `AGENTS.md` is NOT modified; the outside-delimiter content in templates/AGENTS.md is kept. Revert.
6. Manually touch `templates/scripts/docs-refs-check.mjs` (e.g., add a stray newline). Run `npm run sync-templates:check`. Expected: exit 1, message names `templates/scripts/docs-refs-check.mjs` as drifted. Run `npm run sync-templates`. Expected: stray newline removed, `git status` clean.
7. On a throwaway branch, deliberately commit a drifted state with `--no-verify` and push. Expected: CI's `sync-templates:check` step fails with a clear drift message.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (full tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes (auto-commit hook interaction, framework choice, initial-sync diff size, silent overwrite, CI ordering)
- [x] Human Test Plan uses concrete commands the operator can run
- [x] Validation Required has at least one entry marked `- [x]`

---

## Amendment

The implementation added the AC-12 convention paragraph and the AGENTS.md freshness bullet **inside the canon-delimited region** of `CLAUDE.md` (lines ~169-173) and `AGENTS.md` (line 238). This is incorrect: the canon-delimited region of these files ships to adopters via `mergeDelimited` in `canon upgrade`, and adopters have none of the tooling these paragraphs reference (`npm run sync-templates`, `CANON_OWNED`, `DELIMITED`, the pre-commit hook, the CI step, or a `templates/` directory — `canon init` deletes templates/ after scaffolding). The leak would ship confusing dead-end docs to every adopter on next upgrade.

The original AC-12 was under-specified — it said "CLAUDE.md gains a paragraph" without naming the project-additions section. This amendment supersedes AC-12 and corrects the placement.

### Fix

1. **Remove** the "Canon-managed file convention" subsection from `CLAUDE.md`'s canon-delimited region (currently lines ~169-173, between "For large-removal tasks..." and "### Code-review rules of thumb").

2. **Remove** the "Canon-managed files live in the repo root..." bullet from `AGENTS.md`'s canon-delimited region (currently line ~238, in the "Implementation discipline" / "git rules" area).

3. **Add** the canon-managed file convention to `CLAUDE.md`'s **project-additions section** (below `<!-- canon:end -->` at line 220, in the area marked `<!-- Your project additions below — canon upgrade will not touch this section -->`). Cover ALL of the following points (the original AC-12 four plus the two F-1 expansions):
   - Root canon-managed files are authoritative; `templates/` is a derived mirror.
   - **Templates-side edits to canon-managed regions are silently overwritten** by `npm run sync-templates`. A developer who edits, e.g., `templates/scripts/docs-refs-check.mjs` directly will find their change reverted on the next sync. Edit the root copy instead.
   - **The pre-commit hook auto-syncs and re-stages** `templates/` files on every `git commit` via `simple-git-hooks`. Developers do not need to remember to run the sync command — the hook handles it. (`npm run sync-templates` is available as an explicit invocation for cases like rebasing, manual re-sync, or troubleshooting.)
   - `npm run sync-templates:check` runs in CI between `lint` and `docs-refs-check` as the safety net for contributors who bypass the hook (`--no-verify`) or land work without it installed locally.
   - New canon-managed files must be added to either `CANON_OWNED` in `src/lib/canon-owned.ts` (for wholesale-owned files) or `DELIMITED` in the same file (for files with `<!-- canon:start -->...<!-- canon:end -->` markers).
   - The convention paragraph lives **outside** the canon-delimited region precisely because it is canon-ai-dev-only and must not ship to adopters via `canon upgrade`'s DELIMITED merge.

4. **Add** a corresponding shorter note to `AGENTS.md`'s **project-additions section** (below `<!-- canon:end -->` at line ~337). Just enough to make the convention discoverable from the workflow source of truth, then point at `CLAUDE.md`'s project-additions section for the full convention. Codex picks the exact wording.

5. **Run `npm run sync-templates`** before committing so the in-delimiter regions of `templates/AGENTS.md` and `templates/CLAUDE.md` revert (the convention additions disappear from the canon-managed region of the templates/ files automatically — the project-additions section does not propagate via sync).

6. **Verify** before handoff:
   - `grep -n "sync-templates\|CANON_OWNED\|simple-git-hooks\|src/lib/canon-owned" CLAUDE.md AGENTS.md` — every match must be on a line **greater than** the `<!-- canon:end -->` marker (i.e., in the project-additions section, not the canon-managed region).
   - `grep -n "sync-templates\|CANON_OWNED\|simple-git-hooks\|src/lib/canon-owned" templates/CLAUDE.md templates/AGENTS.md` — **zero matches** (the project-additions content does not propagate, and the canon-managed region was reverted by the sync).
   - The six-point coverage above is present in `CLAUDE.md`'s project-additions section.

### Out of scope for this reroute

- **F-2 (.d.ts wildcard)**: pre-existing design debt — the `declare module '*.mjs'` pattern was already imprecise before this task. Will be filed as a follow-up task. Do not touch `scripts/docs-refs-check.mjs.d.ts` or `templates/scripts/docs-refs-check.mjs.d.ts` in this reroute.
- All other ACs (1-11, 13-14) remain met. Do not re-touch the sync script, the shared module, the tests, the CI workflow, the pre-commit hook config, the `.d.ts` files, or the `docs/architecture.md` / `docs/codebase-map.md` updates.

### Validation impact

- `npm run sync-templates:check` must still pass after the placement fix (since the project-additions section is unaffected by sync).
- `npm run docs-refs-check` must still pass.
- The other validation matrix entries are unchanged.
