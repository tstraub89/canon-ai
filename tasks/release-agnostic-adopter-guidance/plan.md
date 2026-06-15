# Plan: release-agnostic-adopter-guidance

> Written by: Claude (pipeline plan session)

## Overview

Pure doc/skill edit — no orchestrator or source changes. Five files change: two skill roots, two auto-synced template mirrors, and `docs/decisions.md`. The pre-commit hook auto-syncs and stages the `templates/` mirrors on commit; Codex only edits the roots.

The spec-review nit (inventory table format for non-shipped hits was underspecified) is addressed in Step 1 below with an explicit two-table layout.

---

## Step 1 — Pre-edit inventory scan (AC-1)

Before touching any file, run `git grep -n` for each model-presuming term and build the inventory report for `handoff.md`. This must cover the live tree, not the spec author's mental model.

**Commands** (exclude `node_modules/`, `dist/`, `tasks/`, `.git/`):

```bash
git grep -n --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=tasks --exclude-dir=.git \
  -e 'release/v' \
  -e 'release branch' \
  -e 'release-branch' \
  -e 'origin/dev' \
  -e 'dev branch' \
  -e 'cut a release' \
  -e 'unreleased' \
  -e 'base_branch\|base branch'
```

Also run separately (case-insensitive for `trunk`):
```bash
git grep -ni 'trunk'
```

**Shipped surfaces** (files where every hit needs a disposition): any file in `CANON_OWNED` or `DELIMITED` as defined in `src/lib/canon-owned.ts` — i.e., the two skill files, `AGENTS.md`, `CLAUDE.md`, `.canon/README.md`, `.claude/skills/canon-init/SKILL.md`, `.claude/skills/canon-spec/SKILL.md`, `.claude/skills/canon-init/write-guide.md`, `.claude/skills/canon-pipeline/recovery.md`, `.claude/skills/canon-status/SKILL.md`, `.claude/skills/canon-review/SKILL.md`, `.canon/templates/*`, `.claude/agents/*.md`, `docs/pipeline-orchestrator.md`, `scripts/docs-refs-check.mjs*`.

**Inventory format in `handoff.md`** (two tables, addressing spec-review nit on format):

```markdown
### Shipped-surface hits (disposition required for each)

| File | Line | Matched text | Disposition |
|---|---|---|---|
| path/to/file | N | matched text | reframed / intentionally-conditional: <reason> / out-of-scope-internal |

### Non-shipped hits (listed for completeness; no disposition required)

| File | Line | Matched text |
|---|---|---|
| path/to/file | N | matched text |
```

Disposition values:
- `reframed` — the hit is in a surface this task edits and the new wording removes the single-model assumption.
- `intentionally-conditional: <reason>` — the hit is in a shipped surface but is already conditioned ("where a project accumulates work on a release branch"; "if applicable") and does not assume release-branches are the only or default model. Record the one-line reason.
- `out-of-scope-internal` — the file is not in `CANON_OWNED` / `DELIMITED` (e.g., `docs/release-process.md`, internal task archives, test fixtures). These belong only in the non-shipped table, not the shipped-surface table.

Every shipped-surface hit must have a disposition row. No shipped-surface hit may be left unaccounted.

---

## Step 2 — Edit `docs/decisions.md` (AC-7)

### 2a. Correct stale `dev` parentheticals

Two occurrences of "CHANGELOG.md lives on both `dev` and `main`" need updating (canon-ai dropped the persistent `dev` branch at 1.4.0):

**In the Decision summary** (the `**Decision**:` line of the "Versioning and release policy" entry):
```
`CHANGELOG.md` lives on both `dev` and `main` and ships with the published `canon-ai` npm package.
```
Change to:
```
`CHANGELOG.md` lives on `main` and ships with the published `canon-ai` npm package.
```

**In the "Changelog audience and scope" sub-bullet** (same text, same fix):
```
  - `CHANGELOG.md` lives on both `dev` and `main` and ships with the published `canon-ai` npm package.
```
Change to:
```
  - `CHANGELOG.md` lives on `main` and ships with the published `canon-ai` npm package.
```

The historical parenthetical at the end of the entry ("Pre-v1.0.0, the changelog lived only on `dev` because `main` was a portable template...") is accurate history — leave it unchanged.

### 2b. Add new decision entry

Insert the following block immediately after the closing `---` of the "Versioning and release policy" entry:

```markdown
## Canon prescribes no release model to adopters

**Decision**: Canon's adopter-facing guidance prescribes no specific release model. The `--pr` / `--ship` / `base_branch` mechanics are model-neutral by design. Adopters may use release-branch-per-version, trunk-from-main, tag-from-main, no versioning, or any hybrid — canon supports all of them because `base_branch` is recorded **per task** in `status.json` at creation.

**Why**: The alternative — shipping one concrete model as "the" canon workflow — produced recurring scope creep: prescriptive release-branch language crept back into adopter-facing surfaces multiple times because nothing pinned the stance. The orchestrator has been model-agnostic in code (`getBaseBranch()` in `scripts/run-task/git.ts` reads `base_branch` from `status.json` with no hardcoded `dev`/`release/` assumption) since before v1.0.0; the guidance lagged. Recording the stance as a settled decision is the anti-regression guard.

The per-task `base_branch` also makes hybrid repos first-class: a project that ships one surface via release branches and another straight to `main` can use canon for both — it just records the appropriate `base_branch` when creating each task.

**Rule**: Adopter-facing guidance (skill files, `AGENTS.md`, `CLAUDE.md`) must not present any single release model as required or as the canon default. When giving a worked example, label it as one common shape and name the authority pointer (the adopter's own `decisions.md §Versioning and Release Policy` and/or their release doc). Do not re-introduce unconditional release-branch framing in shipped surfaces; if a release-model-specific step is genuinely needed, scope it within a named recipe or a conditional clause.

---
```

---

## Step 3 — Edit `.claude/skills/canon-changelog/SKILL.md` (AC-6)

Two targeted edits only. Do not change any other clause — mode-detection table, Phase 1–7 structure, format-detection logic, finalize behavior (other than the one note), or any other wording.

### 3a. Base-detection heuristic (≈line 22, AC-6a)

Current text (in the Orient block under the opening `git branch`/`git log` commands):
```
- **Base branch** (for "commits ahead") — `main` / `release/*` → base `main`; `task/*` → its upstream (`git rev-parse --abbrev-ref @{upstream}`), falling back to `main` if no upstream is set (fresh task branches often have none). Then `git log --oneline <base>..HEAD` for the ahead-list.
```

Replace with:
```
- **Base branch** (for "commits ahead") — derive from the current branch's recorded upstream: `git rev-parse --abbrev-ref @{upstream}`, falling back to the project's default branch (`main` or `master`) if no upstream is set. If the task's `status.json` is readable and has a `base_branch` field, that takes precedence over the git-derived upstream. Then `git log --oneline <base>..HEAD` for the ahead-list.
```

Rationale: removes the `main / release/* →` heuristic that hard-codes release-branch pattern-matching as the mapping rule; replaces with a generic upstream-derivation that works for any release model.

### 3b. In-progress append mode note (≈line 168, AC-6b)

In the "In-progress append mode (release branch)" block under Phase 5 — Write files, the note currently reads:
```
2. Do NOT touch the project's version files — version was bumped when the release branch was initialized.
```

Replace with:
```
2. Do NOT touch the project's version files — when the version is bumped (at branch creation, at finalize, or not at all) depends on your project's versioning policy; defer to your `decisions.md §Versioning and Release Policy` or your release doc.
```

Rationale: removes the assertion that release-branch initialization is the universal version-bump moment; replaces with a conditional deferral that works for all release models.

---

## Step 4 — Edit `.claude/skills/canon-pipeline/SKILL.md` (AC-2, AC-3, AC-4, AC-5)

### 4a. Frontmatter `description` (line 3, AC-5)

Current `description:` value:
```
Use when an existing canon task needs the pipeline driven forward — invoking `canon run`, advancing a single phase, opening the draft PR, shipping a merged task, or recovering from a snag (auto-block hit, phase mismatch, post-merge branch divergence, agent auth failure). Also for release branch operations: hotfix absorption, finalize-and-ship. Don't use to author a new spec (use `/canon-spec`) or check pipeline status (use `/canon-status`).
```

Replace with:
```
Use when an existing canon task needs the pipeline driven forward — invoking `canon run`, advancing a single phase, opening the draft PR, shipping a merged task, or recovering from a snag (auto-block hit, phase mismatch, post-merge branch divergence, agent auth failure). Also for release and shipping operations: finalization, hotfix absorption, and any release model (release-branch, trunk, tag, or no-versioning). Don't use to author a new spec (use `/canon-spec`) or check pipeline status (use `/canon-status`).
```

### 4b. Replace `### 5. Release branches` (AC-2, AC-3, AC-4)

Replace the entire `### 5. Release branches` section — from the `### 5. Release branches` heading through and including the `**Always check working tree state...` paragraph (currently lines 94–116) — with the following:

```markdown
### 5. Release and shipping operations

Canon's `--pr` / `--ship` / `base_branch` mechanics are **model-neutral**. The `base_branch` field is recorded in `status.json` **per task** at creation, so a single repository may use different release models for different task surfaces — pick the model that matches the work at hand.

**Hybrid repos are first-class**: a project with one surface on versioned release branches and another shipping straight to the main line can use different `base_branch` values per task with no global setting. Canon supports all shapes because the per-task `base_branch` is the only release-model knob the orchestrator reads.

**Authority pointer**: For every recipe below, your project's own `decisions.md §Versioning and Release Policy` (and/or your project's release doc) is the source of truth for version numbers, changelog policy, branch strategy, and tag conventions. Canon provides mechanics; your project's policy provides decisions.

**Always check working tree state before branch operations.** If `git status --porcelain` is non-empty, surface it and ask before proceeding. Never blow away uncommitted work.

---

#### Recipe: release-branch-per-version

One release branch per version (`release/vX.Y`). Tasks land on the release branch; a merge PR ships the whole release to the default branch.

1. Check out `release/vX.Y` (initialize it per your project's release doc if it doesn't exist yet — this skill does not run initialization commands).
2. `canon task new <id> "Title"` — auto-detects `base_branch: release/vX.Y`.
3. Run the pipeline normally. `--ship` merges the task to `release/vX.Y`.
4. **Hotfixes during a release cycle**: hotfixes go directly to the default branch. After the hotfix lands, offer: "Release branch `release/vX.Y` will need to absorb this — want me to merge the default branch into it?"
5. **Finalize**: once all vX.Y tasks are merged, use `/canon-changelog finalize` to stamp the unreleased block with today's date.
6. **Ship the release**: `gh pr create --base <default-branch> --head release/vX.Y --title "vX.Y: <theme>"`. After merge, `canon task post-merge-sync` on the default branch. Tag and GitHub release steps live in your project's release doc.

---

#### Recipe: trunk-from-main

All tasks target the project's default branch (`main` or `master`). No separate release branch.

1. `canon task new <id> "Title"` while on the default branch — auto-detects `base_branch: main` (or `master`).
2. Run the pipeline normally. `--ship` merges the task directly to the default branch.
3. Version bumps, changelog entries, and tags are handled on the default branch per your project's versioning policy — not prescribed by canon.

---

#### Recipe: tag-from-main

Tasks land on the default branch; releases are marked with a tag rather than a release branch.

1. Same as trunk-from-main for task targeting and pipeline execution.
2. After the desired set of tasks ships, create a tag from the default branch per your project's tag convention. Canon does not manage tag creation or GitHub release publication — those belong to your project's release doc.

---

#### Recipe: no versioning

Tasks land on the default branch; no version numbers, no CHANGELOG, no tags.

1. `canon task new <id> "Title"` on the default branch.
2. Run the pipeline. `--ship` merges to the default branch.
3. Skip all versioning, changelog, and tagging steps. Use `/canon-changelog` only if and when your project adopts a CHANGELOG.
```

---

## Step 5 — Validation

Run after all file edits, before writing `handoff.md`:

```bash
npm run lint
npm run type-check
npm test
npm run sync-templates:check
npm run docs-refs-check
```

`sync-templates:check` is the load-bearing check for AC-9. If it fails, the root edits did not propagate to the mirrors — run `npm run sync-templates` to regenerate, then re-check.

`docs-refs-check` validates file/path references cited in the edited skills and `decisions.md`. Any illustrative path that doesn't exist in the repo must use prose form (not a markdown link), or must be a real path. If the check fails, fix the offending reference — do not loosen the checker.

If `npm test` surfaces failures in test suites that assert skill or doc content, update those assertions to match the new wording. Any test change must trace to an AC in `handoff.md`.

---

## Step 6 — Handoff

Write `handoff.md` with:

**Changes table** — list all five root + mirror paths:

| File | Change |
|---|---|
| `.claude/skills/canon-pipeline/SKILL.md` | §5 restructured into model-neutral core + 4-recipe menu; frontmatter description reframed |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Auto-synced mirror (pre-commit hook) |
| `.claude/skills/canon-changelog/SKILL.md` | Base-detection heuristic + finalize note neutralized (AC-6 two spots only) |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Auto-synced mirror (pre-commit hook) |
| `docs/decisions.md` | New "Canon prescribes no release model" entry + stale `dev` refs corrected |

**AC Coverage table** — all 9 ACs (AC-1 through AC-9)

**Validation Outcomes table** — all 5 checks (`lint`, `type-check`, `test`, `sync-templates:check`, `docs-refs-check`)

**Inventory** — two-table layout from Step 1 (shipped hits with dispositions, non-shipped hits listed without dispositions)

---

## File map

| File | Step | ACs covered |
|---|---|---|
| `docs/decisions.md` | 2 | AC-7 |
| `.claude/skills/canon-changelog/SKILL.md` | 3 | AC-6 |
| `.claude/skills/canon-pipeline/SKILL.md` | 4 | AC-2, AC-3, AC-4, AC-5 |
| `templates/.claude/skills/canon-changelog/SKILL.md` | auto-sync on commit | AC-9 |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | auto-sync on commit | AC-9 |

> AC-1 (inventory scan) and AC-8 (diff scope guard) are verified in `handoff.md`, not via file edits.
