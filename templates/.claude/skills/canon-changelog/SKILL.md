---
name: canon-changelog
description: Use when the human asks to draft release notes, update CHANGELOG.md, or add entries for shipped tasks — phrases like "draft the changelog", "write release notes", "add a bullet for <task>", "finalize the release", "we're shipping vX.Y", or explicit `/canon-changelog` invocation. Auto-detects fresh release vs. in-progress unreleased block vs. finalization mode from branch + CHANGELOG state. Requires the project to do versioned releases (CHANGELOG.md present + AGENTS.md §"Release Rules" defined).
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

- **Version** — Read `package.json` → `version`.
- **CHANGELOG state** — Read `CHANGELOG.md`: note the heading format it actually uses and whether an in-progress / unreleased block is present. If `CHANGELOG.md` is missing, stop and create it (see *Prerequisites*).
- **Base branch** (for "commits ahead") — `main` / `release/*` → base `main`; `task/*` → its upstream (`git rev-parse --abbrev-ref @{upstream}`), falling back to `main` if no upstream is set (fresh task branches often have none). Then `git log --oneline <base>..HEAD` for the ahead-list.

---

## Prerequisites

This skill requires `CHANGELOG.md` to exist. If it doesn't, create it before proceeding — a minimal structure:
```markdown
# Changelog

> Format follows [Keep a Changelog](https://keepachangelog.com/). SemVer per the project's release rules.

## [0.1.0] — unreleased

### Added
- Initial release.
```

Also requires `AGENTS.md` to have a `## Release Rules` section defining:
- The changelog audience (end users? developers? internal ops?)
- What counts as "user-facing" for your project
- SemVer interpretation (what constitutes a major, minor, patch bump)

If those aren't defined, read `docs/product-context.md` for context and use judgment.

---

## Mode detection

> Match the format your `CHANGELOG.md` already uses. canon-ai's canonical form is `## [<version>] — <date|unreleased>` (bracketed full-semver + em-dash, per `docs/release-process.md`): the active block on a release branch is `## [X.Y.Z] — unreleased`, finalize swaps `unreleased` → the date, and the auto-release workflow extracts that block (failing if the `unreleased` placeholder remains).
>
> **"Active unreleased block" = the topmost section whose header marks it unreleased.** Recognize *either* `## [X.Y.Z] — unreleased` *or* a generic `## [Unreleased]` (the Keep-a-Changelog default, which this repo's `CHANGELOG.md` currently uses) — append to whichever exists. When *creating* a block, prefer canonical `## [X.Y.Z] — unreleased` so auto-release can extract it. Adapt headings/categories if your project's convention differs.

| Branch | CHANGELOG state | Mode |
|---|---|---|
| `main` | no active unreleased block | **Fresh release** — draft a new dated `## [X.Y.Z] — YYYY-MM-DD` section from tasks since the last release |
| `release/vX.Y` | active unreleased block exists (either form) | **In-progress append** — add bullets under that block for tasks not yet represented |
| `release/vX.Y` | active unreleased block exists, `$ARGUMENTS = "finalize"` | **Finalize** — set its header to the canonical `## [X.Y.Z] — YYYY-MM-DD` (today's date) |
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

Read `AGENTS.md §"Release Rules"` and the top of `CHANGELOG.md` before writing. Calibrate your voice and scope against recent entries.

Before drafting bullets, look at the full working set as one release, not a list of tasks:

**Find themes**: do multiple tasks contribute to the same user-visible outcome? If yes, merge into one bullet that tells the whole story.

**Find duplicates**: if two tasks touch the same feature surface, dedupe. Don't list the same change twice with different framings.

**Find cascades**: if a task enabled another task (refactor → feature, infra → capability), the enabler usually drops out. The user-facing outcome covers it.

**Find pre-release iterations**: if a feature debuts in this release and a later task in the same release cycle refines it before the release ships, fold the refinement into the feature bullet. Users only see the shipped version. *Test: did any prior iteration reach users? If no, fold.*

**Find non-entries**: apply your project's "would a user notice" test (defined in `AGENTS.md §"Release Rules"`). Omit: pure refactors, test changes, pipeline infra, dev tooling, lint cleanup, invisible implementation details. List skipped tasks explicitly in Phase 4 so the human can see your omit decisions.

**Bullet format** (calibrate to your project's existing entries; this repo uses Keep a Changelog):
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

**Fresh release mode** (main, no active `## [<version>] — unreleased` block):
1. Insert a new `## [X.Y.Z] — YYYY-MM-DD` section immediately before the first existing `## [` version block (below the `# Changelog` title + meta note).
2. Update `"version"` in `package.json` (and `package-lock.json` if present).

**In-progress append mode** (release branch):
1. Append bullets to the appropriate `### Added` / `### Changed` / `### Fixed` / `### Removed` subheading within the active unreleased block (create the subheading if absent).
2. Do NOT touch `package.json` — version was bumped at `release-init` time.

**Single-task append**: same as the relevant branch mode, but for one bullet only.

**Finalize mode**:
1. Set the active unreleased block's header to canonical `## [X.Y.Z] — YYYY-MM-DD` (today's date) — replace `unreleased` with the date, and version a generic `## [Unreleased]` to the bracketed semver while you're there. (The auto-release workflow extracts this block and fails if the `unreleased` placeholder remains.) Don't add a fresh block — the next cycle's `release-init` inserts the next `## [X.Y.Z] — unreleased`.
2. Apply any polish edits approved in Phase 4.
3. Do NOT touch `package.json`.

---

### ⛔ STOP — Phase 6 — Show diff before committing

```bash
git diff CHANGELOG.md package.json package-lock.json
```

Show the complete diff. Say: "Here's what will be committed. Reply **commit** to confirm, or tell me what to change."

Wait for explicit approval before running git.

---

### Phase 7 — Commit (no push)

```bash
# Fresh release
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore: changelog and version bump to vX.Y.Z"

# In-progress append
git add CHANGELOG.md
git commit -m "docs(changelog): add vX.Y bullets for task-id-1, task-id-2"

# Single-task append
git add CHANGELOG.md
git commit -m "docs(changelog): add vX.Y bullet for task-id"

# Finalize
git add CHANGELOG.md
git commit -m "docs(changelog): finalize vX.Y release notes"
```

Confirm the commit hash. Stop. Do not push. Tell the user: "When ready, run `git push origin <branch>`."

---

## Related

- `/canon-status` — confirm what's in flight or recently shipped before drafting.
- `/canon-pipeline` — for `release-init`, hotfix absorption, and finalize-ship operations.
- `AGENTS.md` §"Release Rules" — defines the changelog audience and SemVer interpretation this skill calibrates against.
