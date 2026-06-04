# QA Summary: release-agnostic-surface

> Align canon's shipped surface to its release-agnostic stance

## What Changed

Canon's shipped skills and governing docs were updated so that nothing canon-owned mandates *how* a project does releases — the release-branch model is preserved as a recommended-optional pattern, not a universal requirement.

### `canon-changelog` skill

The skill now derives the CHANGELOG format from whatever `CHANGELOG.md` already exists in the project — title line, version-heading pattern, category names including emoji headers — and matches that format when appending or finalizing. Canon-ai's own bracketed `## [X.Y.Z] — unreleased` style appears only as one example, not as the target. The GP (`GalleryPlanner`) format (`# What's New`, `## vX.Y - <date>`, `### 🚀 Improvements`, `### 🐞 Fixes`) is explicitly covered as a worked witness so the skill works with that project unchanged.

The `docs/decisions.md` "Versioning and Release Policy" section is now an optional policy layer consulted when present, not a hard dependency. Two absence branches are handled without blocking:
- No `§Versioning` section → proceed using CHANGELOG's own style, emit a one-time nudge to fill the section.
- No existing CHANGELOG (greenfield) → surface the Keep-a-Changelog default for human confirmation rather than silently imposing it.

The `auto-release.yml` dependency is removed. The frontmatter `description` no longer asserts a "requires versioned releases" precondition.

### `canon-pipeline` skill §5

The release-branch flow is kept intact but reframed as canon's **recommended, optional** pattern with an explicit "adapt to your project; some projects don't version at all" note. Removed from §5: the hardcoded `## [X.Y.Z] → date` CHANGELOG format, the `auto-release` reference, and the `docs/release-process.md` pointers. The ship step defers changelog mechanics to the `canon-changelog` skill. The `base_branch` auto-detection guidance and `--pr`/`--ship` mechanics are unchanged.

### `AGENTS.md`

Four spots that treated changelog/version-bump as a universal pipeline step now defer to project policy. The commit-ownership rule #3 prose, the summary table row, Release Rules #3 (last-commit linearity), and the Handoff Validation checklist all now read "for projects that version…" or equivalent. Release Rules #2 was not touched.

### `docs/pipeline-orchestrator.md`

- Added a one-line note that `--ship`'s `gh pr merge --squash` is canon's default merge strategy (no behavior change).
- The standalone changelog/version-bump line now defers to project policy ("for projects that version…").
- The cheatsheet pointer to `docs/release-process.md` (a canon-internal file adopters don't have) is genericized to "per your project's release setup."

### Amendment 1 — Phase 3 policy-doc deference + §5 init example (AC-12, AC-13)

Codex's PR-level review on #131 surfaced that Phase 3 (Synthesize) only read `AGENTS.md §"Release Rules"` and the CHANGELOG, silently ignoring an adopter's `docs/decisions.md` Versioning policy when it *was* present. Phase 3 now reads the policy section when present and applies its tier/audience/scope guidance before the generic version-bump heuristics. Separately, the `Let's start vX.Y` init enumeration in §5 (`npm version`, `.canon/version`, etc.) was reworded as canon-ai's example release setup, not a universal requirement.

### Amendment Round 2 — Finalize-mode version preservation + operative-step sweep (AC-14, AC-15)

A third PR-level review exposed a finalize gap: the version-less `## [Unreleased]` heading (the greenfield default the skill introduces) produced a date-only heading on finalize, dropping the Phase-4 proposed version. Phase 5 Finalize now branches on version-carrying vs. version-less headings: for the KaC version-less case, it inserts the Phase-4 version and recreates a fresh `## [Unreleased]` above the finalized block. Version-carrying formats (canon-ai's bracketed form, GP's v-prefix form) finalize unchanged.

**Greenfield default superseded (AC-4 amendment):** AC-4 originally named the version-carrying `## [X.Y.Z] — unreleased` as the greenfield default. The implemented skill's Prerequisites template uses the version-less `## [Unreleased]` (standard Keep-a-Changelog) — the correct release-agnostic choice, since the version-carrying form is canon-ai's own non-standard variant. Amendment Round 2 formally supersedes AC-4's greenfield-default heading to match what ships.

The AC-15 sweep audited every operative step (Phase 1–7 mode detection, version-source handling, fresh-release / in-progress version-file wording, diff preview, commit-message templates, and the `canon-pipeline` §5 handoff) for the format-agnostic invariant. npm-specific mechanics across those steps were generalized to "the project's version files."

### `CHANGELOG.md`

Added the release-format-agnostic bullet under `## [Unreleased]` (AC-11).

### Template mirrors

All four canon-managed mirrors (`templates/.claude/skills/canon-changelog/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md`, `templates/AGENTS.md`, `templates/docs/pipeline-orchestrator.md`) were regenerated by the `sync-templates` pre-commit hook and committed.

## Files Changed

| File | Role |
|---|---|
| `.claude/skills/canon-changelog/SKILL.md` | Root — detect-and-match format, optional policy, greenfield fallback, drop `auto-release` |
| `.claude/skills/canon-pipeline/SKILL.md` | Root — §5 optional/recommended, genericized pointers |
| `AGENTS.md` | Root (delimited) — 4-spot reconcile |
| `docs/pipeline-orchestrator.md` | Root — squash note, changelog-line defer, pointer genericize |
| `CHANGELOG.md` | Unreleased bullet (AC-11) |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Derived mirror |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Derived mirror |
| `templates/AGENTS.md` | Derived mirror |
| `templates/docs/pipeline-orchestrator.md` | Derived mirror |

## How to Test

See the spec's Human Test Plan for the full set; the key scenarios are:

1. **GP-style project**: Take a CHANGELOG headed `# What's New` with `## vX.Y - unreleased` and `### 🚀 Improvements` sections. Ask canon to add a changelog entry for a shipped task. Confirm it appends under the correct emoji category in GP's style — not rewritten into `## [1.9.0] — unreleased` with `### Added`.
2. **Adopter without `§Versioning`**: Run `canon-changelog` on a project that has a CHANGELOG but no versioning-policy section in `docs/decisions.md`. Confirm it still produces an entry and emits a nudge (no error, no block).
3. **Pipeline guidance audit**: Read `canon-pipeline` §5 as a new adopter. Confirm the release-branch flow is described as optional, with no inline CHANGELOG format and no reference to `docs/release-process.md` or `auto-release`.
4. **Canon-ai's own flow**: Confirm canon-ai's bracketed CHANGELOG workflow still works end-to-end — the generalization should not have broken the project that uses the canonical form.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Docs/skill markdown only; eslint passed cleanly |
| `npm test` | Pass | 713 pass, 0 fail, 1 skipped (sandboxed `.git`-write fixture) |
| `npm run sync-templates:check` | Pass | Mirrors match edited roots after two commit rounds |
| `npm run docs-refs-check` | Pass | No dangling refs; release-process pointers genericized, missing-doc backtick refs converted to bare prose |
| `npm run type-check` | deferred_by_spec | No TypeScript change — Spec §Validation Required: N/A |
| `npm run build` | deferred_by_spec | No `src/` change — Spec §Non-Goals: explicitly defers dist rebuild |

## Human Verification Required

None.

## Decisions Made

- **GP format as a mandatory worked witness**: AC-2 requires the skill to demonstrably handle the emoji-category, v-prefix format — not just describe format-agnosticism abstractly. Codex had to cover this explicitly in the guidance, not leave it as an inference.
- **`docs/decisions.md` Versioning policy as optional, not required**: The skill's gate fires on `CHANGELOG.md` presence; the policy section is a bonus layer. An upgrader without it gets a nudge, not a block.
- **Greenfield default named explicitly**: AC-4 requires the skill to name a concrete default (Keep-a-Changelog bracketed form) for projects with no CHANGELOG to match, and surface the choice to the human rather than silently applying it.
- **Iteration 2 triggered by Phase 5 write-path bug**: Code review round 1 found that the `canon-changelog` Phase 5 write instructions still referenced canon-ai's own headings rather than the project-detected ones. Fixed in Iteration 2 alongside converting missing-doc backtick refs in task artifacts to bare prose (which had caused `docs-refs-check` to flag the handoff/review files themselves).
- **Amendment Rounds 2–4 triggered by Codex PR-level review**: Codex's review of #131 identified that two operative steps (Phase 3 policy-doc read, Phase 5 finalize) described format-agnostic deference but didn't act on it. The round-over-round shape was the same meta-class, so Amendment Round 2 swept all remaining instances in one pass rather than iterating per-finding.
- **Greenfield default corrected**: AC-4 originally named the version-carrying `## [X.Y.Z] — unreleased` as the neutral default, but the skill implements the version-less `## [Unreleased]` (standard KaC) — the correct choice since the version-carrying form is canon-ai's own variant. Amendment Round 2 supersedes the AC-4 heading to match what actually ships.

## Open Questions

None.

## Proposed Changelog

**Already written** (AC-11 was part of the implementation). The entry is live in `CHANGELOG.md` under `## [Unreleased]`:

> **`canon-changelog` and `canon-pipeline` now defer release format to the project.** Both shipped skills match the project's existing CHANGELOG style instead of imposing canon-ai's bracketed form, and `canon-pipeline` keeps the release-branch flow as an optional pattern rather than a universal mandate.

**Proposed version bump**: no additional bump beyond what the Unreleased block accumulates. This change is additive and backwards-compatible — it extends what the skills support without removing anything. It contributes to `v1.9.0` (the current release branch target) as a `### Added` entry. Rationale: new behavior for adopters (skill now adapts to their format); no breaking change; no patch-only fix.
