# Spec: canon-prune-run-lessons — Tighten /canon-prune from its first real run

> Written by: Claude | Review by: human (fast tier)
> Status: draft

## Problem

The first `/canon-prune` run, on canon-ai's own permanent docs (merged as PR #190), needed eleven rounds of independent review before it was safe to commit. The findings fell into four repeatable classes, each a gap in the skill's instructions rather than in the docs it pruned:

1. **Deletes carried live facts with them.** Approved deletes of "superseded" clauses also removed sentences that were still current: XL/delicate implement defaults to `high`; headless Codex runs record approval questions and continue with authorized work; streamed agents must not inherit the terminal's stdin. The skill judges a rule as a whole and never asks whether every sentence in the removed text is dead.
2. **The implement-prompt guard tag was correct but not actionable.** Both tagged `docs/patterns.md` deletes dropped current guidance from implement prompts for matching tasks. Restoring it then caused two more regressions: folding a short rule into a large pitfall made it match more tasks and crowd out others under the injection cap, and splitting a pair of related rules left each matching only one of their two paths. The tag says "may change implement prompts" but asks no one to say what leaves or where it is still selected.
3. **Deletes left dangling references.** CHANGELOG and backlog entries cited the removed decisions by heading, and surviving decisions pointed at removed clauses ("the claim above"). The skill has no step that looks for citations of what it removes.
4. **The prune record didn't survive the merge.** GitHub's squash merge used the PR description as the commit message, so the drafted record (its "Reviewed and kept" list and `Canon-Prune:` trailer) never reached the base branch. Step 6's lookup would find nothing next time.

The same run surfaced a canon-ai-only gap and two stale doc lines:

5. Run literally on canon-ai's root docs, the skill's "describes a canon mechanism → `delete`" rule would remove canon-ai's own architecture and decision text, whose job is to describe canon. That run suspended the rule by hand. The fix belongs in canon-ai's local `docs-audit` skill, because the shipped skill must stay free of canon-ai-specific logic (the canon-prune-skill decision).
6. `docs/patterns.md`'s worktree test-rule pitfall carries an incident aside naming `taskDirFromRoot()`, now a private helper in `src/task/index.ts`. The rule itself ("use `taskDirFor()`") is correct. `docs/decisions.md` lists four ideas as "Backlogged", but none is tracked in `docs/BACKLOG.md` or an issue.

## Decision

Add four instructions to `/canon-prune`, one canon-ai carve-out to `docs-audit`, and fix the two doc lines.

1. **Sentence-level delete check** (`/canon-prune` Step 2 and Step 3). Before proposing `delete` for a rule or a clause, the proposer classifies every sentence in the text to be removed as superseded, obsolete, or stated elsewhere (naming where). A sentence that states a current fact or rule turns the proposal into an edit that keeps that sentence, or moves it to where it belongs. The triage row shows the classification for every removed sentence.
2. **Guard rows name their cost** (§"Implement-prompt guard"). For every row carrying the **removes from implement prompts** tag, the row names each live requirement in the removed or rewritten text, and the path citations through which it is still selected after the edit. A requirement still selected through no path is kept as its own short H3 pitfall that cites the paths of the code it governs. Don't fold a short rule into a larger pitfall: a larger pitfall matches more tasks and can crowd other pitfalls out of the prompt. Rules that guard the same failure stay in one H3 citing all of their paths.
3. **Reference sweep** (Step 5). Before applying a `delete`, `merge`, `relocate`, or a heading rename, search the repository (excluding archived task directories) for references to the affected heading or claim, including the changelog, backlog, and other docs. Retarget or remove each one in the same apply step, and list them in the hand-back.
4. **The record survives the merge** (Step 6). The hand-back tells the human that the drafted message is the prune record, and that if the change ships through a squash merge or a PR, the record (at least the "Reviewed and kept" list and the `Canon-Prune:` trailer) must be carried into the squash commit message or the PR body the merge uses.
5. **canon-ai carve-out** (`docs-audit`, local only). When `docs-audit` prunes canon-ai's own root docs with `/canon-prune`, the "describes a canon mechanism → `delete`" criterion and §"High-level canon mentions only" don't apply, because canon-ai's docs exist to describe canon.
6. **Doc fixes.** In `docs/patterns.md`, remove the incident aside that names `taskDirFromRoot()` and keep the rule. In `docs/decisions.md`, delete the "Backlogged" line; the ideas were never tracked.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Where the canon-ai carve-out lives | canon-ai's local `docs-audit` skill | A conditional inside the shipped `/canon-prune` | The shipped skill carries no canon-ai-specific branch (canon-prune-skill AC-3) | `Human` |
| The untracked "Backlogged" ideas | Delete the line | File the four ideas as backlog items | None has been picked up since 2026-06; a backlog entry is the place to revive one | `Author` |
| How guard cost is shown | Prose: the row names the requirement and its remaining selecting paths | A `canon` command that diffs pitfall selection before and after | No new subcommand (canon-prune-skill Non-Goal); prose fixes all four regressions from the run | `Author` |
| Version bump / changelog | None; `/canon-prune` is still in `[Unreleased]` | A new changelog bullet | The unreleased entry already describes the skill | `Author` |

## Non-Goals

- No new `canon` subcommand, selector-diff tool, or source change: the diff touches only the Affected Files below (AC-7).
- No change to the shipped skill's canon-managed exclusion or its verdict set.
- No CHANGELOG change.
- Not re-running a prune.

## Acceptance Criteria

- [ ] AC-1: `/canon-prune` requires a per-sentence classification (superseded, obsolete, or stated elsewhere, with the location) for the text of every `delete` and clause delete. It states that a sentence carrying a current fact or rule turns the proposal into an edit that keeps it. The Step 4 triage row shows the classification. **Verify:** read Steps 2–4.
- [ ] AC-2: §"Implement-prompt guard" requires every tagged row to name each live requirement in the affected text and the paths that still select it. A requirement with no remaining selecting path is kept as its own short H3 citing its code paths. The section states both rules: don't fold a short rule into a larger pitfall, and keep rules guarding one failure in one H3 citing all their paths. **Verify:** read the section.
- [ ] AC-3: Step 5 requires, before applying a `delete`, `merge`, `relocate` or heading rename, a repository search (archives excluded) for references to the affected heading or claim, retargeting or removing each in the same apply, and listing them in the hand-back. **Verify:** read Step 5.
- [ ] AC-4: Step 6's hand-back says the drafted message is the prune record and must be carried into the squash commit message or PR body used to merge, including at least the "Reviewed and kept" list and the `Canon-Prune:` trailer. **Verify:** read Step 6.
- [ ] AC-5: The shipped skill stays adopter-safe. `npm run sync-templates:check` and `npm run docs-refs-check` pass, the `templates/` mirror matches, and `grep -n -i 'canon-ai' .claude/skills/canon-prune/SKILL.md` matches only references to the canon-ai maintainers as the upstream recipient. **Verify:** run the commands.
- [ ] AC-6: canon-ai's `.claude/skills/docs-audit/SKILL.md` prune pass states that when it prunes canon-ai's own root docs with `/canon-prune`, the "describes a canon mechanism" delete criterion and §"High-level canon mentions only" do not apply. **Verify:** read the file; confirm `docs-audit` is still absent from `CANON_OWNED` in `src/lib/canon-owned.ts`.
- [ ] AC-7: `docs/patterns.md` no longer contains `taskDirFromRoot`, and the surrounding rule still names `taskDirFor()`. `docs/decisions.md` no longer contains the "**Backlogged (separate future minors" line. `git diff main --stat` touches only the Affected Files. **Verify:** `grep -n taskDirFromRoot docs/patterns.md` returns nothing; `grep -n 'Backlogged (separate' docs/decisions.md` returns nothing; read the diff stat.

## Design

### Affected Files

| File | Change |
|---|---|
| `.claude/skills/canon-prune/SKILL.md`, `templates/.claude/skills/canon-prune/SKILL.md` | AC-1 to AC-4 (root edit, mirror synced via `npm run sync-templates`) |
| `.claude/skills/docs-audit/SKILL.md` | AC-6 carve-out (canon-ai-local, no mirror) |
| `docs/patterns.md` | AC-7: drop the incident aside naming `taskDirFromRoot()` |
| `docs/decisions.md` | AC-7: delete the "Backlogged" line |

### Interaction Dependencies

`docs-audit` references `/canon-prune`'s §"Verdicts" and §"Implement-prompt guard" by heading, so keep both headings unchanged.

### Data Model Changes

None.

## Validation Required

- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [x] `npm test` (some tests pin shipped skill content)

Lint, type-check and build: N/A, since no source file changes. E2E: N/A, since canon-ai has no UI surface.

## Docs Impact

None. `docs/patterns.md` and `docs/decisions.md` are edited directly (AC-7).

## Known Risks

- **The skill gets heavier.** Four more instructions in a skill whose point is trimming. Mitigation: each is one or two sentences in the step it governs, not a new section.
- **The sentence check is skipped in practice.** An inventory agent could label a whole clause "superseded" without per-sentence work. Mitigation: AC-1 requires the classification to appear in the triage row, so its absence is visible to the human.

## Human Test Plan

1. Read the prune skill's delete, guard, apply and record steps. Expected: each of the four lessons from the first run is stated where it applies.
2. Read the docs-audit skill's prune pass. Expected: it says canon-ai's own docs keep their canon-mechanism descriptions.
3. Check the patterns and decisions docs. Expected: the stale helper name and the "Backlogged" line are gone, and nothing else changed.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row
- [x] Plan steps reference actual file names (fast tier: see plan.md)
- [x] Replaces existing behavior: N/A (additive instructions; two doc deletions framed as removals with grep ACs)
- [x] Non-Goals backed by AC-7's diff-stat check
- [x] Symbols named in ACs exist (`taskDirFor()` in `src/orchestrator/state.ts`, `taskDirFromRoot` in `src/task/index.ts`, `CANON_OWNED`)
- [x] Known Risks covers the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has checked entries
- [x] Bug/flake: N/A (skill and doc improvement)
- [x] Refactor: N/A
- [x] Judgment Calls listed
