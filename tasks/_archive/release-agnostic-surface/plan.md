# Plan: release-agnostic-surface

> Written by: Claude (pipeline session)

## Spec-review nit addressed

AC-4 flagged that the "one-time nudge" surface was unspecified. Resolution: the nudge appears **inline in the skill's response**, as a parenthetical after the skill confirms format detection — e.g., "(Your `docs/decisions.md` doesn't have a §Versioning policy yet — adding one enables richer audience and scope guidance for future entries.)" This is deterministic, consistent with how the skill already surfaces mode-detection confirmations, and non-blocking.

---

## Steps

All changes are docs/skill prose only — no `src/` edits, no TypeScript, no `dist/` rebuild. The pre-commit `sync-templates` hook regenerates `templates/` mirrors automatically on commit; do not hand-edit templates.

---

### Step 1 — `.claude/skills/canon-changelog/SKILL.md` (AC-1, 2, 3, 4)

**1a. Frontmatter `description` (line 3)** — drop "Requires the project to do versioned releases (CHANGELOG.md present + AGENTS.md §\"Release Rules\" defined)". Replace the entire description value with one that keeps the CHANGELOG-present gate, drops the versioned-releases mandate, and mentions the optional `docs/decisions.md §Versioning` layer:

> `Use when the human asks to draft release notes, update CHANGELOG.md, or add entries for shipped tasks — phrases like "draft the changelog", "write release notes", "add a bullet for <task>", "finalize the release", "we're shipping vX.Y", or explicit /canon-changelog invocation. Auto-detects fresh release vs. in-progress unreleased block vs. finalization mode from branch + CHANGELOG state. Requires CHANGELOG.md to be present; defers version and audience policy to the project's docs/decisions.md §"Versioning and Release Policy" when present.`

**1b. "Mode detection" note block (~lines 51–53) and mode table (~lines 55–60)** — the current note hardcodes canon-ai's format as the canonical target and references `docs/release-process.md` and "the auto-release workflow." Replace the entire note block with a detect-and-match framing:

> **Detect and match your project's existing format.** Read `CHANGELOG.md` and derive: the title line (`# Changelog`, `# What's New`, etc.), the version-heading pattern (e.g., `## [X.Y.Z] — unreleased` for canon-ai, `## vX.Y - unreleased` for a v-prefixed project, `## [Unreleased]` for Keep-a-Changelog generic), the category/subheading structure including emoji (e.g., `### Added` / `### Fixed` or `### 🚀 Improvements` / `### 🐞 Fixes`), and the insertion point. The *existing* format is the source of truth; do not impose canon-ai's bracketed form on a project that uses a different one. canon-ai's own format is one valid example.
>
> **"Active unreleased block"** = the topmost section whose header marks it unreleased. Recognize any project-specific unreleased marker (`unreleased`, `Unreleased`, `UNRELEASED`, a future-date placeholder, etc.).

Replace the mode table's `release/vX.Y`-specific rows with generic equivalents:

| Branch | CHANGELOG state | Mode |
|---|---|---|
| `main` (or default branch) | no active unreleased block | **Fresh release** — draft a new dated section from tasks since the last release |
| Active release/working branch | active unreleased block exists (any form) | **In-progress append** — add bullets under that block for tasks not yet represented |
| Active release/working branch | active unreleased block exists, `$ARGUMENTS = "finalize"` | **Finalize** — set its header to a dated entry in the project's own heading style |
| Any | `$ARGUMENTS` is a single task ID | **Single-task append** — one bullet under the active unreleased block from that task's done.md |

**1c. Remove `auto-release.yml` references** — two locations after 1b's rewrite: the remaining occurrence in the Finalize step of Phase 5 (~line 169), which currently reads "(The auto-release workflow extracts this block and fails if the `unreleased` placeholder remains.)" — remove that parenthetical. Verify: `git grep -n "auto-release" .claude/skills/canon-changelog/SKILL.md` returns nothing.

**1d. Phase 3 "Synthesize" bullet format block (~lines 114–130)** — the hardcoded `## [X.Y.Z] — unreleased` / `### Added` / `### Changed` template in the "Bullet format" subsection must not appear as a literal template. Replace with format-agnostic instructions:

> **Bullet format** — match your project's existing CHANGELOG exactly:
> - Use the version-heading pattern derived in Mode detection (e.g., `## [X.Y.Z] — unreleased` for canon-ai's format, `## vX.Y - unreleased` for a v-prefixed project, etc.)
> - Use the category headings your CHANGELOG already has (e.g., `### Added`, or `### 🚀 Improvements`, or whatever the project uses). Create a new category heading only if it matches an existing category type in the file.
> - User-facing language only — no file names, no internal jargon, no implementation mechanics
> - Bold the entry title
> - Omit any category section that has no entries
> - Order within a section: most impactful first

**1e. Phase 5 Finalize mode step (~lines 169–172)** — the current step names `canonical ## [X.Y.Z] — YYYY-MM-DD` as the target. Replace with:

> **Finalize mode**:
> 1. Set the active unreleased block's header to a dated entry in your project's own version-heading style — replace the "unreleased" placeholder with today's date, keeping whatever heading pattern the project already uses (e.g., `## [X.Y.Z] — YYYY-MM-DD` for canon-ai's format, `## vX.Y - YYYY-MM-DD` for a v-prefixed project).
> 2. Apply any polish edits approved in Phase 4.
> 3. Do NOT touch `package.json`.

**1f. Add AC-4 "When sources are absent" section** — add as a named subsection after the Prerequisites section (before Mode detection), so it's encountered before mode selection begins:

> ### When sources are absent
>
> **No `docs/decisions.md §"Versioning and Release Policy"`**: proceed using the existing CHANGELOG's own style for format, `AGENTS.md §Release Rules` for propose-only behavior discipline, and audience inferred from the existing CHANGELOG. After completing the entry, emit an inline nudge: "(Your `docs/decisions.md` doesn't have a §Versioning policy yet — adding one enables richer audience and scope guidance for future entries.)" Do not error or block.
>
> **No existing CHANGELOG.md format to match (greenfield / empty file)**: use an explicit format from `docs/decisions.md §Versioning` if present; otherwise use the **Keep-a-Changelog default** as a named starting point:
>
> ```markdown
> # Changelog
>
> > Format follows [Keep a Changelog](https://keepachangelog.com/).
>
> ## [Unreleased]
>
> ### Added
> - Initial entry.
> ```
>
> Surface this default to the human and confirm before writing — do not silently impose a format.

**1g. Prerequisites section** — soften the `AGENTS.md §"Release Rules"` requirement from hard-required to "if present, use for audience/scope guidance; otherwise use judgment from `docs/product-context.md`." Keep the CHANGELOG-present gate unchanged.

---

### Step 2 — `.claude/skills/canon-pipeline/SKILL.md` (AC-5, 6)

**2a. §5 opening — add optional/recommended framing** — add a callout at the top of the §5 "Release branches" section:

> **This is canon's recommended, optional release-branch model.** Some projects release differently (e.g., tag from main, no separate release branch, or no versioning at all). Adapt to your project's release setup; steps that reference CHANGELOG format or versioning policy defer to your project's conventions.

**2b. Remove the hardcoded CHANGELOG format from the "Let's ship vX.Y" step (line ~108)** — current step 2 reads:

> 2. Swap `## [X.Y.Z] — unreleased` → `## [X.Y.Z] — YYYY-MM-DD` in CHANGELOG.md (the bracketed em-dash form the auto-release workflow extracts).

Replace with:

> 2. Finalize the CHANGELOG unreleased block — use the `canon-changelog` skill in finalize mode (`/canon-changelog finalize`) to update the heading to today's date in your project's own format.

This removes both the hardcoded format and the `auto-release workflow` reference in one edit (AC-5, AC-9).

**2c. Genericize `docs/release-process.md` pointers** — two occurrences:
- "Let's start vX.Y" step 2 (~line 97): "Direct the operator to the step-by-step in `docs/release-process.md`" → "Direct the operator to your project's release branch initialization steps."
- "Creating a task for a release branch while NOT checked out on it" (~line 102): "want me to walk you through the manual release-branch steps in `docs/release-process.md`?" → "want me to walk you through the steps to initialize a release branch for your project?"

Verify: `git grep -nE "auto-release|release-process.md" .claude/skills/canon-pipeline/SKILL.md` returns nothing.

**2d. base_branch auto-detect guidance** — lines ~100–102 stay substantively intact. Only the `docs/release-process.md` references are genericized.

---

### Step 3 — `AGENTS.md` (AC-7) — four spots only

Edit only the four specified locations. Do not touch Release Rules #2 (~line 350) or the Validation Matrix (~line 304).

**3a. Commit-ownership rule #3 prose (~line 155):**

Old:
```
3. **Changelog + version bump**: A separate release step after human_review, done collaboratively by the human and Claude. Not automated by the pipeline. See Release Rules below.
```
New:
```
3. **Changelog + version bump** *(for projects that version)*: A separate release step after human_review, done collaboratively by the human and Claude per project policy. Not automated by the pipeline. See Release Rules below.
```

**3b. Commit-ownership summary table row (~line 165):**

Old:
```
| Before PR / merge | Changelog + version bump | Human + Claude |
```
New:
```
| Before PR / merge | Changelog + version bump (per project policy; skip if the project doesn't version) | Human + Claude |
```

**3c. Release Rules #3 (~line 351):**

Old:
```
3. **Changelog + version bump are committed separately from code changes** — they are the last commit on the branch. Keeps version-bump commits cherry-pickable / revertable in isolation.
```
New:
```
3. **Changelog + version bump are committed separately from code changes** *(when a project versions its releases)* — isolation intent: keeps version-bump commits cherry-pickable / revertable in isolation. Projects that do not do versioned releases skip this step per their project policy.
```

**3d. Handoff Validation checklist (~lines 356–357):**

Old:
```
- [ ] Version correct
- [ ] Changelog updated if needed
```
New:
```
- [ ] Version correct (per project policy; skip if the project doesn't version)
- [ ] Changelog updated if needed (per project policy; skip if the project doesn't version)
```

---

### Step 4 — `docs/pipeline-orchestrator.md` (AC-8)

**4a. Cheatsheet comment (~line 139):**

Old:
```
# Initialize a release branch with the manual steps in docs/release-process.md
```
New:
```
# Initialize a release branch per your project's release setup
```

**4b. Standalone changelog/version-bump line (~line 298):**

Old:
```
Changelog and version bump remain a manual human + Claude step.
```
New:
```
For projects that version their releases, changelog and version bump remain a manual human + Claude step; projects that don't version skip it.
```

**4c. Add squash-merge strategy note near the `--ship` description (~lines 411–415)** — add a new paragraph after the existing `--ship` description paragraph (after "Running `--ship` with no PR open at all archives the task without the implementation landing — don't do that."):

> **Note on merge strategy**: `--ship` uses `gh pr merge --squash` as canon's default. Projects using rebase-merge or merge-commit should be aware: `--ship` does not support an alternate strategy flag. In those cases, merge the PR manually and run `--ship` afterward — it detects the merge and proceeds to cleanup without attempting another merge.

Verify: `git grep -n "release-process" docs/pipeline-orchestrator.md` returns nothing.

---

### Step 5 — `CHANGELOG.md` (AC-11)

Under `## [Unreleased]` → `### Added`, append:

```
- **`canon-changelog` and `canon-pipeline` skills are now release-format-agnostic.** Both skills detect and match the project's existing CHANGELOG format rather than imposing canon-ai's bracketed form. `canon-pipeline` §5 keeps the release-branch model as a recommended, optional pattern; versioning and changelog policy defer to `docs/decisions.md §Versioning` when present, with graceful degradation when absent.
```

---

### Step 6 — Validate (run in order)

```bash
npm run lint                   # backstop — no code change expected
npm test                       # confirms no template-sync or skill-related test regressed
npm run sync-templates:check   # mirrors match roots after edits
npm run docs-refs-check        # no dangling references from removed docs/release-process.md pointers
```

Per-AC verify greps (run before finalizing):
```bash
git grep -n "auto-release" .claude/skills/canon-changelog/SKILL.md
git grep -n "auto-release" .claude/skills/canon-pipeline/SKILL.md
git grep -n "do versioned releases" .claude/skills/canon-changelog/SKILL.md
git grep -nE "auto-release" -- templates/.claude/skills/canon-pipeline/SKILL.md templates/.claude/skills/canon-changelog/SKILL.md
git grep -n "release-process" docs/pipeline-orchestrator.md
```
All five must return no matches.

---

## Notes for Codex

- **Prescription vs. description**: keep canon-ai's bracketed format as a *named example* in the skill, not an operative instruction. The operative instruction is always "match what `CHANGELOG.md` already uses."
- **GP format witness (AC-2)**: after editing, mentally simulate "append a bullet to a CHANGELOG with title `# What's New`, version heading `## v1.8 - unreleased`, categories `### 🚀 Improvements` / `### 🐞 Fixes`." The result must use GP's format, not canon-ai's. If the skill's instructions produce the canonical bracketed form for that input, the edit is not done.
- **`release/vX.Y` stays**: do not grep-delete every occurrence of the string "release". Only `auto-release.yml` (the workflow file name) and `docs/release-process.md` pointers must be removed. The branch shape `release/vX.Y` appears legitimately as an example in §5 and the mode table.
- **AGENTS.md is delimited**: edits land inside `<!-- canon:start -->` … `<!-- canon:end -->`. The project-additions section after `<!-- canon:end -->` is not touched here.
- **No new files**: every change is an edit to an existing file.
- **`templates/` are derived mirrors**: never hand-edit them. The `sync-templates` pre-commit hook handles regeneration.

---

## Reroute Plan

### Delta

Amendment 1 adds two ACs (AC-12 and AC-13) targeting the same two skill files already touched by the original plan. All prior plan steps remain valid; implement them as before. This section describes only what's new.

---

#### Reroute Step 1 — `.claude/skills/canon-changelog/SKILL.md` (AC-12)

**Phase 3 "Synthesize" — add present-case policy-doc deference.**

The current Phase 3 opener (line ~101) reads:
```
Read `AGENTS.md §"Release Rules"` if present and the top of `CHANGELOG.md` before writing.
```

Replace that opening sentence with the following, so the skill reads and applies `docs/decisions.md §"Versioning and Release Policy"` when it is present — ahead of the generic version-bump heuristics:

> Read `AGENTS.md §"Release Rules"` if present and the top of `CHANGELOG.md` before writing. **If `docs/decisions.md` exists and has a `## Versioning and Release Policy` section (or similar heading), read it now and use its guidance to calibrate the version-bump proposal (patch/minor/major rules defined there take precedence over the generic heuristics below) and the audience/scope framing of bullets.** When that section is absent, fall through to the generic heuristics unchanged — the `### When sources are absent` nudge path already handles that branch; do not duplicate it here.

The generic version-bump paragraph that follows (currently "**Version bump** (if applicable to the mode):…" near line ~140) is unchanged but now carries an implicit "otherwise" — it applies when no policy doc is present or the doc does not specify the bump rule.

*Verify:* read Phase 3 — the policy-doc read appears before the version-bump heuristic block; the absent-case nudge path in `### When sources are absent` is untouched.

---

#### Reroute Step 2 — `.claude/skills/canon-pipeline/SKILL.md` (AC-13)

**§5 "Let's start vX.Y" — reframe init enumeration as example, not universal steps.**

The current "Let's start vX.Y" block (line ~97) contains:
```
The init steps need `npm version`, `npm install --package-lock-only`, `npm run build`, and edits to `.canon/version` + `CHANGELOG.md`, all outside this skill's command scope…
```

Replace that clause so the npm/`.canon/version` commands are framed as canon-ai's own example, not universal steps every project requires. Preserve the out-of-scope rationale and the "skill does not run init" contract:

> **"Let's start vX.Y":** Release-branch initialization is a **manual operator procedure** — this skill does **not** run it. The exact init steps depend on your project (for example, canon-ai's own steps include `npm version`, `npm install --package-lock-only`, `npm run build`, and edits to `.canon/version` + `CHANGELOG.md`), and all such steps fall outside this skill's command scope (`canon`/`git`/`gh` + read/search only). What this skill does:

The numbered sub-steps (verify main is clean, direct operator to their project's init steps, resume once branch is up) remain unchanged.

*Verify:* read §5 "Let's start vX.Y" — the npm/`.canon/version` commands appear only as a parenthetical example; the "skill does not run init / out of command scope" rationale is intact; the operator-delegation steps are unchanged.

---

#### Reroute Step 3 — Validate

No new validation required beyond the existing matrix. Re-run these after both edits to confirm nothing regressed:

```bash
npm run sync-templates:check   # mirrors must match roots after the two skill edits
npm run docs-refs-check        # confirm no new dangling refs
```

The `templates/` mirrors regenerate via the pre-commit hook on commit; do not hand-edit them.

---

## Reroute Plan Round 2

### Delta

Amendment Round 2 adds AC-14 and AC-15. All prior plan steps and Reroute Plan steps remain valid and have already been implemented. This section describes only the delta.

**Spec clarification (no file change):** Amendment Round 2 supersedes AC-4's greenfield-default heading — the documented default is the version-less `## [Unreleased]` (standard Keep-a-Changelog), matching what the skill's Prerequisites template already implements. No edit is needed for this reconciliation.

**Persistent nit from amendment review (non-blocking):** The AC-4 one-time-nudge surface ambiguity has carried across all review rounds. The original plan (Step 1f) defined the nudge as an inline parenthetical in the skill's response, and Step 1f's text is already in the skill. Codex should confirm the nudge appears visibly in Phase 3's absent-case branch — no spec change required, just make sure the surface is explicit if it is currently implied.

---

#### Reroute Round 2, Step 1 — `.claude/skills/canon-changelog/SKILL.md` (AC-14)

**Phase 5 Finalize — branch on version-carrying vs. version-less heading.**

The current Phase 5 Finalize step (as written by the original plan's Step 1e) says: "replace the 'unreleased' placeholder with today's date, keeping whatever heading pattern the project already uses." This is correct for version-carrying headings but wrong for the version-less `## [Unreleased]` form — it would produce a date-only heading like `## [2026-06-04]`, discarding the Phase-4 proposed version.

Replace the Finalize step with an explicit branch on heading type:

> **Finalize mode**:
> 1. Identify whether the active unreleased block's heading carries a version:
>    - **Version-carrying** (e.g., `## [X.Y.Z] — unreleased` for canon-ai, `## vX.Y - unreleased` for a v-prefix project): replace the "unreleased" placeholder with today's date, preserving the heading pattern exactly (e.g., `## [X.Y.Z] — YYYY-MM-DD`, `## vX.Y - YYYY-MM-DD`). Do **not** inject a new `## [Unreleased]` block — this project doesn't use that convention.
>    - **Version-less** (`## [Unreleased]` — the Keep-a-Changelog generic form, including the skill's own greenfield default): insert the version proposed/approved in Phase 4, converting to `## [<version>] — YYYY-MM-DD`. Then recreate a fresh empty `## [Unreleased]` section above the finalized block (per Keep-a-Changelog convention for this form).
> 2. Apply any polish edits approved in Phase 4.
> 3. Do NOT touch `package.json`.

*Verify:* read Phase 5 Finalize — it branches on "version-carrying vs. version-less"; the version-less case uses the Phase-4 version and recreates `## [Unreleased]` above; the version-carrying case finalizes exactly as before (no new `## [Unreleased]` injected where the project doesn't use one).

---

#### Reroute Round 2, Step 2 — `.claude/skills/canon-changelog/SKILL.md` and (conditionally) `.claude/skills/canon-pipeline/SKILL.md` (AC-15)

**Operative-step sweep for the format-agnostic invariant.**

After implementing Step 1, audit every operative step in both skills for this invariant: *use the project's detected format, handle the version-less `## [Unreleased]` default, and assume no specific build toolchain (e.g., npm)*. For each step, confirm it either (a) defers to the detected/project format, (b) handles the version-less default where applicable, or (c) labels canon-ai-specific mechanics as a parenthetical example. Fix any step that fails.

**`canon-changelog` — steps to enumerate and check:**

- **Phase 1 / Mode detection**: does the mode table recognize `## [Unreleased]` (version-less) as a valid "active unreleased block"? (Not just the version-carrying forms.) Genericize if needed.
- **Phase 3 Bullet-format subsection**: does it defer to the detected heading/category structure, or does it still hardcode `### Added` / `### Changed` as the only category options? (AC-12 handled the policy-doc read; confirm the bullet-format block itself is also generic.)
- **Phase 5 Fresh-release mode**: does it use the project-detected version-heading at write time? (Iteration 2 fixed this; verify it still holds after the Phase 5 Finalize edit in Step 1.)
- **Phase 5 In-progress-append mode**: same check.
- **Phase 7 Commit messages**: do they hardcode a version-heading format, or defer to the heading produced by the earlier phases?

**`canon-pipeline` §5 — steps to enumerate and check:**

- **"Let's ship vX.Y" step**: does the finalize-mode delegation to `canon-changelog` (original plan Step 2b) assume a version-carrying heading? If so, generalize to "use `canon-changelog` in finalize mode — it handles both version-carrying and version-less headings."
- **Any remaining npm-specific mechanics** beyond the AC-13 parenthetical example.

If no additional steps require changes beyond the AC-14 Finalize fix in Step 1, state "no other steps required changes" in `handoff.md` with the per-step rationale (AC-15 requires this enumeration regardless of outcome).

*Verify:* `handoff.md` enumerates each operative step checked and states its disposition (clean / fixed) per AC-15; the AC-14 Finalize fix is listed as one instance.

---

#### Reroute Round 2, Step 3 — Validate

No new validation beyond the existing matrix. After Steps 1 and 2:

```bash
npm run lint                   # backstop — no code change expected
npm test                       # confirm no template-sync test regressed
npm run sync-templates:check   # mirrors must match roots after skill edits
npm run docs-refs-check        # no dangling refs introduced
```

The `templates/` mirrors regenerate via the pre-commit hook on commit; do not hand-edit them. `templates/.claude/skills/canon-pipeline/SKILL.md` mirror only needs regeneration if §5 changes in Step 2.
