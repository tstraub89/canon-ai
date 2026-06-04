# Implementation Handoff: release-agnostic-surface

> Author: Codex | Spec: `tasks/release-agnostic-surface/spec.md` | Plan: `tasks/release-agnostic-surface/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `.claude/skills/canon-changelog/SKILL.md` | Genericized changelog handling to detect and match the project's existing format, treat docs/decisions.md §Versioning and Release Policy as optional, add the greenfield fallback, and remove canon-ai-only release assumptions. |
| `.claude/skills/canon-pipeline/SKILL.md` | Marked the release-branch flow as optional/recommended, removed canon-internal release-process pointers, and routed finalize-mode changelog work through `canon-changelog`. |
| `AGENTS.md` | Reworded the release/versioning ownership rules so changelog and version-bump steps are conditioned on project policy rather than treated as universal. |
| `CHANGELOG.md` | Added the release-format-agnostic bullet under `## [Unreleased]`. |
| `docs/pipeline-orchestrator.md` | Genericized the release-branch cheatsheet pointer, deferred changelog/versioning to project policy, and added the `--ship` merge-strategy note. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Synced mirror of the root skill edit. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced mirror of the root skill edit. |
| `templates/AGENTS.md` | Synced mirror of the root AGENTS edit. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror of the root orchestrator-doc edit. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Aligned the shipped release guidance with canon's stated release-agnostic stance without changing the underlying release-branch mechanics. The implementation keeps canon-ai's own format as one example, but the operative instruction now derives formatting from each project's existing `CHANGELOG.md` and defers versioning policy to the project's own docs when present.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `canon-changelog` detects and matches the existing format. | Met | The mode-detection guidance now derives the title line, version-heading pattern, categories, and insertion point from the project's existing `CHANGELOG.md`, with canon-ai's format only as one example. |
| AC-2: GP format is a worked witness. | Met | The guidance explicitly handles `# What's New`, `## vX.Y - <date|unreleased>`, and emoji category headings such as `### 🚀 Improvements` / `### 🐞 Fixes`. |
| AC-3: `canon-changelog` defers policy to `decisions.md` if present, drops `auto-release` dependency. | Met | The skill now treats docs/decisions.md §Versioning and Release Policy as optional, removes `auto-release` references, and no longer hardcodes `release/vX.Y` as the only branch shape. |
| AC-4: Graceful degradation when a source is absent (the upgrader path). | Met | Added a `When sources are absent` section that defines both the no-policy branch and the greenfield default/fallback path without blocking. |
| AC-5: `canon-pipeline` §5 keeps the model, optional + genericized. | Met | Section 5 now calls the release-branch model optional/recommended, removes `docs/release-process.md` / `auto-release` references, and defers changelog mechanics to `canon-changelog`. |
| AC-6: `canon-pipeline` preserves release-model-agnostic mechanics. | Met | The base_branch auto-detect guidance and `--pr` / `--ship` flows remain, while the release-process pointer is genericized to the project's own setup. |
| AC-7: `AGENTS.md` four spots reconciled (only those four). | Met | The commit-ownership prose, summary row, Release Rules #3, and Handoff Validation checklist all now condition changelog/version steps on project policy. Release Rules #2 remains untouched. |
| AC-8: `docs/pipeline-orchestrator.md` squash note + changelog-line + release-process pointer reconcile. | Met | The cheatsheet pointer is genericized, the manual changelog/version line now defers to project policy, and a note documents `--ship`'s squash merge as canon's default strategy. |
| AC-9: `auto-release` absent from both shipped skills. | Met | Verified with `git grep -nE "auto-release" -- .claude/skills/canon-pipeline/SKILL.md .claude/skills/canon-changelog/SKILL.md`. |
| AC-10: canon-owned mirrors synced. | Met | `npm run sync-templates:check` passed after syncing the `templates/` mirrors from the edited roots. |
| AC-11: CHANGELOG bullet. | Met | Added the release-format-agnostic bullet under `## [Unreleased]`. |

## Edge Cases Considered

- Projects with no docs/decisions.md §Versioning and Release Policy now get a non-blocking nudge instead of a hard requirement.
- Greenfield changelogs now have an explicit default starting point instead of inheriting canon-ai's bracketed release format.
- The release-branch model still exists for projects that use it; the docs now say it is optional rather than universal.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Docs/skill markdown only; eslint passed cleanly. |
| `npm test` | Pass | Full suite passed (713 pass, 0 fail, 1 skipped by a sandboxed `.git`-write fixture). |
| `npm run sync-templates:check` | Pass | Mirrors were regenerated from the edited roots and matched on check. |
| `npm run docs-refs-check` | Pass | No dangling refs remained after removing the release-process pointers. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->

## Iteration 2 — addressing review round 1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|
| `.claude/skills/canon-changelog/SKILL.md` | Fixed the Phase 5 write path so fresh-release and in-progress-append instructions use the project-detected headings at write time, and added the explicit absent-source branches with the non-blocking nudge plus greenfield confirmation. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Synced mirror of the root skill revision. |
| `tasks/release-agnostic-surface/handoff.md` | Appended this iteration section and normalized missing-doc refs to bare prose so docs-refs-check stays green. |
| `tasks/release-agnostic-surface/review.md` | Normalized missing-doc refs to bare prose so docs-refs-check stays green. |
| `tasks/release-agnostic-surface/notes.md` | Added a note about missing-doc refs in task artifacts tripping docs-refs-check. |

### Findings addressed

- _correctness bug:_ Phase 5 write instructions now use the project-detected version/category headings instead of canon-ai's bracketed defaults, so GP-style changelogs follow the right insertion and category path (`.claude/skills/canon-changelog/SKILL.md:161` and `:165`).
- _spec gap:_ The absent-source behavior now explicitly handles both branches: a non-blocking nudge when `docs/decisions.md` lacks Versioning policy, and a surfaced greenfield default that requires human confirmation before writing (`.claude/skills/canon-changelog/SKILL.md:28` and `:42`).
- _risk/guardrail:_ Task artifact prose that referenced the missing `docs/decisions.md` path was rewritten to bare text so `docs-refs-check` no longer flags the task files.

### AC deltas (if any)

- AC-1: was Partial → now Met (`.claude/skills/canon-changelog/SKILL.md:161`)
- AC-2: was Partial → now Met (`.claude/skills/canon-changelog/SKILL.md:165`)
- AC-4: was Partial → now Met (`.claude/skills/canon-changelog/SKILL.md:28` and `:42`)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run sync-templates:check` | Pass | Mirror remained in sync after the skill update and task-artifact cleanup. |
| `npm run docs-refs-check` | Pass | No broken refs remained after converting missing-doc references to bare prose. |
| `git diff --check` | Pass | No whitespace / patch-format issues in the final revision diff. |

## Iteration 3 — addressing review round 2

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|
| `.claude/skills/canon-changelog/SKILL.md` | Added the AC-12 present-case policy-doc deference to Phase 3 and kept the absent-case behavior intact. |
| `.claude/skills/canon-pipeline/SKILL.md` | Reframed the `Let's start vX.Y` init enumeration as canon-ai's example release setup rather than a universal requirement. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Synced mirror of the root skill revision. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced mirror of the root skill revision. |
| `tasks/release-agnostic-surface/notes.md` | Added a reroute note capturing the present-case policy-doc deference / init-enumeration wording distinction. |

### Findings addressed

- _spec gap:_ Phase 3 now reads docs/decisions.md §Versioning and Release Policy when present and uses it before the generic version-bump and audience heuristics, so adopters' policy guidance is no longer silently ignored (`.claude/skills/canon-changelog/SKILL.md:101`).
- _spec gap:_ The `Let's start vX.Y` release-branch initialization text now names canon-ai's npm/.canon/version steps as an example and explicitly leaves other projects' init setup to their own conventions (`.claude/skills/canon-pipeline/SKILL.md:97`).

### AC deltas (if any)

- AC-12: was Partial → now Met (`.claude/skills/canon-changelog/SKILL.md:101`)
- AC-13: was Partial → now Met (`.claude/skills/canon-pipeline/SKILL.md:97`)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Docs/skill markdown only; eslint passed cleanly. |
| `npm test` | Pass | Full suite passed (713 pass, 0 fail, 1 skipped by a sandboxed `.git`-write fixture). |
| `npm run sync-templates:check` | Pass | Mirrors matched after syncing the amended skill roots. |
| `npm run docs-refs-check` | Pass | No dangling refs introduced by the reroute edit. |
| `git diff --check` | Pass | No whitespace / patch-format issues in the reroute diff. |

## Iteration 4 — addressing review round 3

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|
| `.claude/skills/canon-changelog/SKILL.md` | Added the version-less finalize branch, generalized the version-source / version-file wording, and swept the fresh-release, in-progress, diff, and commit-message steps for the format-agnostic invariant. |
| `.claude/skills/canon-pipeline/SKILL.md` | Clarified that `canon-changelog finalize` handles both version-carrying and version-less headings. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Synced mirror of the root skill revision. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced mirror of the root skill revision. |
| `tasks/release-agnostic-surface/handoff.md` | Appended this iteration section. |
| `tasks/release-agnostic-surface/notes.md` | Added reroute notes about the version-less finalize branch and the generic version-source/version-file sweep. |

### Findings addressed

- _correctness bug:_ Finalize mode now branches on version-carrying versus version-less unreleased headings. The Keep-a-Changelog `## [Unreleased]` case inserts the Phase-4 version, converts the block to a dated release heading, and recreates a fresh `## [Unreleased]` above it; version-carrying formats finalize unchanged (`.claude/skills/canon-changelog/SKILL.md:171` and `:174`).
- _spec gap:_ The remaining operative-step sweep now covers the version source, fresh-release / in-progress version-file handling, the diff preview, the commit-message templates, and the pipeline handoff to `canon-changelog finalize`. These steps now either defer to the project's detected format, handle the version-less default, or frame canon-ai-specific mechanics as examples (`.claude/skills/canon-changelog/SKILL.md:20`, `:163`, `:167`, `:182`, `:197`, `:201`, `:205`, `:209`; `.claude/skills/canon-pipeline/SKILL.md:110`).
- _deviation from plan:_ The plan's package.json / package-lock.json-specific wording was broadened to "the project's version files" and generic release bullet examples so the skill does not assume npm as the build toolchain.

### AC deltas (if any)

- AC-14: was Partial → now Met (`.claude/skills/canon-changelog/SKILL.md:171` and `:174`)
- AC-15: was Partial → now Met (`.claude/skills/canon-changelog/SKILL.md:20`, `:163`, `:167`, `:182`, `:197`, `:201`, `:205`, `:209`; `.claude/skills/canon-pipeline/SKILL.md:110`)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Docs/skill markdown only; eslint passed cleanly. |
| `npm test` | Pass | Full suite passed (713 pass, 0 fail, 1 skipped by a sandboxed `.git`-write fixture). |
| `npm run sync-templates:check` | Pass | Mirrors matched after syncing the amended skill roots. |
| `npm run docs-refs-check` | Pass | No dangling refs introduced by the reroute edit. |
| `git diff --check` | Pass | No whitespace / patch-format issues in the reroute diff. |
| `git grep -n 'auto-release' .claude/skills/canon-changelog/SKILL.md` | Pass | No matches. |
| `git grep -n 'auto-release' .claude/skills/canon-pipeline/SKILL.md` | Pass | No matches. |
| `git grep -n 'do versioned releases' .claude/skills/canon-changelog/SKILL.md` | Pass | No matches. |
| `git grep -nE 'auto-release' -- templates/.claude/skills/canon-pipeline/SKILL.md templates/.claude/skills/canon-changelog/SKILL.md` | Pass | No matches. |
| `git grep -n 'release-process' docs/pipeline-orchestrator.md` | Pass | No matches. |
