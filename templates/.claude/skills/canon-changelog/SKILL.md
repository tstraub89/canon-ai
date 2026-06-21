---
name: canon-changelog
description: Use when the human asks to draft release notes, update CHANGELOG.md, or add entries for shipped tasks — phrases like "draft the changelog", "write release notes", "add a bullet for <task>", "finalize the release", "we're shipping vX.Y", or explicit `/canon-changelog` invocation. Auto-detects fresh release vs. in-progress unreleased block vs. finalization mode from branch + CHANGELOG state. Requires CHANGELOG.md to be present; treats docs/decisions.md §"Versioning and release policy" as an optional policy layer when present.
argument-hint: "[optional: version override e.g. 1.5.0, or single task ID to add one bullet]"
allowed-tools: Read Glob Grep Write Edit Bash(git log *) Bash(git diff *) Bash(git status *) Bash(git branch *) Bash(git rev-parse *) Bash(git add *) Bash(git commit *)
effort: medium
---

# Changelog & Release

Argument: **$ARGUMENTS** _(empty = auto-detect mode from branch + CHANGELOG state)_

```!
git branch --show-current
git log --oneline -12
```

**Orient from the above + your tools.** Do **not** use shell `case`/`if`/loops or `node -e` for orientation — Claude Code blocks unparseable control structures, and this skill's `allowed-tools` is `git` + Read/Glob/Grep/Edit/Write. Gather the rest by reasoning:

- **Version** — Read the project's version source if it has one (canon-ai uses `package.json` → `version`).
- **CHANGELOG state** — Read `CHANGELOG.md`: note the heading format it actually uses and whether an in-progress / unreleased block is present. If `CHANGELOG.md` is missing, stop and create it (see *Prerequisites*).
- **Base for the "commits ahead" range** — identify the point the unreleased work sits on top of, by where you're running. Never use the branch's own tracking ref (`@{upstream}`): once pushed it's `origin/<branch>` and yields an empty range. The base depends on context:
  - **On a task branch**: the current task's `base_branch` (from its `status.json`) — the authoritative per-task base, correct for any release model.
  - **On a release/working branch aggregating toward the mainline** (in-progress append / finalize): the project's default branch (`main`/`master`), or the documented release base if it differs.
  - **On the default branch drafting a fresh release**: bound at the **last released point** — the most recent release tag, if the project tags releases. If it doesn't tag (or this is the first release), there's no precise boundary derivable from the CHANGELOG alone: list the available history and rely on the **Phase 4 confirmation step** to settle the set rather than a computed range. Don't use the default branch itself as the base (`main..HEAD` on `main` is an empty range).

  Then list the commits in the chosen range (`git log --oneline <base>..HEAD`, or the full log when there's no lower bound) to extract task IDs — using only the commands this skill permits.

---

## Prerequisites

This skill requires `CHANGELOG.md` to exist. If it doesn't, treat it as a greenfield case: propose the default format below and confirm it with the human before writing.
```markdown
# Changelog

> Format follows [Keep a Changelog](https://keepachangelog.com/). SemVer per the project's versioning policy.

## [Unreleased]

### Added
- Initial entry.
```

If the project has a `## Release Rules` section, use it for audience and user-facing scope guidance. If it doesn't, read `docs/product-context.md` for context and use judgment.

### When sources are absent

**No `docs/decisions.md §"Versioning and release policy"`**: proceed using the existing CHANGELOG's own style for format, `docs/decisions.md §"Versioning and release policy"` for propose-only behavior discipline when present (canon general rules: agents don't auto-bump; QA proposes entry only; version bump is a separate commit; no major surprises), and audience inferred from the existing CHANGELOG. After finishing, include a one-time note in the response: "(Tip: add a `## Versioning and release policy` section to `docs/decisions.md` for richer audience and scope guidance.)" Do not block.

**No existing `CHANGELOG.md` format to match**: if `docs/decisions.md §Versioning` specifies a format, use that. Otherwise propose Keep a Changelog as the starting point. Surface the proposed default to the human and ask for confirmation before creating or rewriting the file.

---

## Mode detection

> Detect and match your project's existing format. Read `CHANGELOG.md` and derive the title line (`# Changelog`, `# What's New`, etc.), the version-heading pattern (e.g. `## [X.Y.Z] — unreleased` for canon-ai, `## vX.Y - unreleased` for a v-prefixed project, `## [Unreleased]` for Keep-a-Changelog generic), the category/subheading structure including emoji (e.g. `### Added` / `### Fixed` or `### 🚀 Improvements` / `### 🐞 Fixes`), and the insertion point. The existing format is the source of truth; do not impose canon-ai's bracketed form on a project that uses a different one. canon-ai's own format is one valid example.
>
> **"Active unreleased block" = the topmost section whose header marks it unreleased.** Recognize any project-specific unreleased marker (`unreleased`, `Unreleased`, `UNRELEASED`, a future-date placeholder, etc.).

| Branch | CHANGELOG state | Mode |
|---|---|---|
| `main` (or the project's default branch) | no active unreleased block | **Fresh release** — draft a new dated section in the project's own heading style from tasks since the last release |
| Active release/working branch | active unreleased block exists (any form) | **In-progress append** — add bullets under that block for tasks not yet represented |
| Active release/working branch | active unreleased block exists, `$ARGUMENTS = "finalize"` | **Finalize** — set its header to a dated entry in the project's own heading style |
| Any | `$ARGUMENTS` is a single task ID | **Single-task append** — one bullet under the active unreleased block from that task's done.md |

Confirm the detected mode before proceeding. If multiple modes seem plausible, ask.

---

## Workflow

### Phase 1 — Find tasks on this branch

Parse the commit log against the detected base to extract task IDs. Two patterns:
1. `[TASK-ID]` at end of a commit line: `Fix frame clipping [feat-frame-fix]`
2. `chore: add task artifacts for TASK-ID`

Deduplicate. This is your **candidate set**.

**In-progress append mode**: filter out task IDs already mentioned in the existing in-progress block. Remaining = **working set**.

**Fresh release mode**: candidate set = working set.

If no task IDs found (or all already in the block), stop and say so. In finalize mode this is normal — go directly to Phase 3 polish.

---

### Phase 2 — Read task files

For each task in the working set:

1. Read `tasks/<id>/status.json` — only tasks with `qa.status = "done"` can be included.
2. Read `tasks/<id>/done.md`:
   - Find the **"Proposed Changelog"** section (written by the QA pipeline). This is raw material — not boilerplate to paste verbatim. Rewrite it in your own voice calibrated to the project's changelog audience.
   - If no Proposed Changelog section exists, use the **"What Changed"** section as raw material.
3. Read `tasks/<id>/spec.md` for the problem statement and task scope.

Build a per-task record: task ID, title, raw changelog source, one-sentence user-impact summary.

---

### Phase 3 — Synthesize

Read `docs/decisions.md` §"Versioning and release policy" if present (project changelog scope, SemVer tier, and audience) and the top of `CHANGELOG.md` before writing. If that policy is missing, use `docs/product-context.md` for context and proceed. Calibrate your voice and scope against recent entries.

Before drafting bullets, look at the full working set as one release, not a list of tasks:

**Find themes**: do multiple tasks contribute to the same user-visible outcome? If yes, merge into one bullet that tells the whole story.

**Find duplicates**: if two tasks touch the same feature surface, dedupe. Don't list the same change twice with different framings.

**Find cascades**: if a task enabled another task (refactor → feature, infra → capability), the enabler usually drops out. The user-facing outcome covers it.

**Find pre-release iterations**: if a feature debuts in this release and a later task in the same release cycle refines it before the release ships, fold the refinement into the feature bullet. Users only see the shipped version. *Test: did any prior iteration reach users? If no, fold.*

**Find non-entries**: apply your project's "would a user notice" test (from `docs/decisions.md §"Versioning and release policy"` if present, otherwise infer from `CHANGELOG.md` and `docs/product-context.md`). Omit: pure refactors, test changes, pipeline infra, dev tooling, lint cleanup, invisible implementation details. List skipped tasks explicitly in Phase 4 so the human can see your omit decisions.

**Bullet format** — match your project's existing CHANGELOG exactly:
> *Example only (canon-ai's bracketed form). Match your project's actual title, version-heading, and category style — including emoji categories — per the formatting rules below.*
```
## [X.Y.Z] — unreleased

### Added
- **Feature title.** Plain-language description. One to two sentences max.

### Changed
- **Change title.** Plain-language description.

### Fixed
- **Fix title.** Plain-language description.

### Removed
- **Removal title.** Plain-language description.
```

Formatting rules:
- Use the version-heading pattern derived in Mode detection (e.g. `## [X.Y.Z] — unreleased` for canon-ai's format, `## vX.Y - unreleased` for a v-prefixed project, or the project's own equivalent).
- Use the category headings your CHANGELOG already has (e.g. `### Added`, `### 🚀 Improvements`, or whatever the project uses). Create a new category heading only if it matches an existing category type in the file.
- User-facing language only — no file names, no internal jargon, no implementation mechanics
- Bold the entry title
- Omit any category section that has no entries
- Order within a section: most impactful first

**Version bump** (if applicable to the mode):
- `$ARGUMENTS` version → use it
- Otherwise: propose Patch (fixes + improvements only) or Minor (any new user-facing feature). Major bumps require explicit instruction.

---

### ⛔ STOP — Phase 4 — Present draft

Show before writing anything to disk:

1. **Task → bullet mapping**: for every task in the working set, which bullet does it map to (may be many-to-one), or why it was omitted ("merged into [other]" / "no user-facing change")
2. **Tasks skipped**: ID and reason (not QA'd, no done.md, no user-facing change, etc.)
3. **Proposed version**: `vCURRENT → vNEW` with one-line rationale
4. **Full draft changelog section** — formatted exactly as it will appear

Wait for approval. The user may adjust wording or version. Incorporate edits, then proceed.

---

### Phase 5 — Write files

**Fresh release mode** (main, no active unreleased block):
1. Insert a new section using the version-heading pattern derived in Mode detection immediately before the first existing version block in the project's own format (or create the first section if the file is otherwise empty, after the greenfield confirmation step above).
2. Update the project's version files when it tracks version there (for canon-ai, `package.json` and `package-lock.json` if present).

**In-progress append mode** (release branch):
1. Append bullets under the matching category heading from the project's existing CHANGELOG (derived in Mode detection). Create a new category heading only if the file already uses that category type.
2. Do NOT touch the project's version files — when the version is bumped (at branch creation, at finalize, or not at all) depends on your project's versioning policy; defer to your `decisions.md §Versioning and Release Policy` or your release doc.

**Single-task append**: same as the relevant branch mode, but for one bullet only.

**Finalize mode**:
1. Identify whether the active unreleased block's heading carries a version:
   - **Version-carrying** (e.g. `## [X.Y.Z] — unreleased` for canon-ai, `## vX.Y - unreleased` for a v-prefixed project): replace the "unreleased" placeholder with today's date, preserving the heading pattern exactly (e.g. `## [X.Y.Z] — YYYY-MM-DD`, `## vX.Y - YYYY-MM-DD`). Do **not** inject a new `## [Unreleased]` block — this project doesn't use that convention.
   - **Version-less** (`## [Unreleased]` — the Keep-a-Changelog generic form, including the skill's own greenfield default): insert the version proposed/approved in Phase 4, converting to `## [<version>] — YYYY-MM-DD`. Then recreate a fresh empty `## [Unreleased]` section above the finalized block (per Keep-a-Changelog convention for this form).
2. Apply any polish edits approved in Phase 4.
3. Do NOT touch the project's version files.

---

### ⛔ STOP — Phase 6 — Show diff before committing

```bash
git diff CHANGELOG.md <version-files if applicable>
```

Show the complete diff. Say: "Here's what will be committed. Reply **commit** to confirm, or tell me what to change."

Wait for explicit approval before running git.

---

### Phase 7 — Commit (no push)

```bash
# Fresh release
git add CHANGELOG.md <version-files if applicable>
git commit -m "chore: changelog and version bump to <version>"

# In-progress append
git add CHANGELOG.md
git commit -m "docs(changelog): add release bullets for <task-id-1>, <task-id-2>"

# Single-task append
git add CHANGELOG.md
git commit -m "docs(changelog): add release bullet for <task-id>"

# Finalize
git add CHANGELOG.md
git commit -m "docs(changelog): finalize release notes"
```

Confirm the commit hash. Stop. Do not push. Tell the user: "When ready, run `git push origin <branch>`."

---

## Related

- `/canon-status` — confirm what's in flight or recently shipped before drafting.
- `/canon-pipeline` — for hotfix absorption and finalize-ship operations.
- `docs/decisions.md` §"Versioning and release policy" — project changelog scope and SemVer interpretation. Canon's general release rules (propose-only, separate bump commit, no major surprises) are enforced during canon's QA phase.
