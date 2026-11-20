# Completion Summary: canon-prune-run-lessons — Tighten /canon-prune from its first real run

> For the human. This is what you need to know.

## What Changed

The first real `/canon-prune` run needed eleven review rounds, and they fell into four repeatable gaps in the skill's instructions. This change closes those gaps in the skill's steps. Before proposing a delete, the skill now classifies every sentence in the removed text as superseded, obsolete, or stated elsewhere, and keeps any sentence that still states a live fact. Each row that removes an implement-prompt guard now names the live requirements it drops and the paths that still select them, and a requirement with no remaining path becomes its own short pitfall. Before any delete, merge, relocate, or heading rename, the skill searches the repo (archives excluded) for references and retargets them in the same apply step. The hand-back now says the drafted prune record must be carried into the squash commit or PR body used to merge. In canon-ai's local `docs-audit` skill, a carve-out says its own root docs describe canon, so the "describes a canon mechanism" delete rule does not apply to them. Two stale doc lines are gone: a helper name in an incident aside in `docs/patterns.md`, and an untracked "Backlogged" list in `docs/decisions.md`. The shipped skill stays adopter-neutral and its template mirror is in sync.

## Files Changed

- `.claude/skills/canon-prune/SKILL.md` — sentence classification (Steps 2–4), guard requirement and path accounting (§"Implement-prompt guard"), reference sweep (Step 5), record hand-back (Step 6).
- `templates/.claude/skills/canon-prune/SKILL.md` — mirror of the shipped skill, synced with `npm run sync-templates`.
- `.claude/skills/docs-audit/SKILL.md` — canon-ai-only carve-out for its own root docs in the prune pass (line 26). Not a shipped file.
- `docs/patterns.md` — removed the incident aside naming `taskDirFromRoot()`; the `taskDirFor()` rule stays.
- `docs/decisions.md` — removed the "Backlogged (separate future minors" line and its extra blank line.

## How to Test

1. Read `/canon-prune`'s delete step (Step 2 and Step 3). Expected: every removed sentence is classified, and a sentence that states a current fact keeps the proposal an edit.
2. Read the triage step (Step 4). Expected: the triage row shows the classification and the "Sentence classification" column.
3. Read §"Implement-prompt guard". Expected: each tagged row names its live requirements and their remaining selecting paths. Rules that guard one failure stay in one H3, and a short rule is not folded into a larger pitfall.
4. Read Step 5. Expected: a repo-wide reference search (archives excluded) runs before any delete, merge, relocate, or heading rename, and the hand-back lists the references it changed.
5. Read Step 6. Expected: the hand-back says the drafted message is the prune record and must be carried into the squash commit or PR body used to merge.
6. Read the `docs-audit` prune pass. Expected: for canon-ai's own root docs, the "describes a canon mechanism" criterion and the "High-level canon mentions only" section do not apply.
7. Check `docs/patterns.md` and `docs/decisions.md`. Expected: the helper name and the "Backlogged" line are gone, and `taskDirFor()` is still named.

## Test Results

| Check | Result |
|---|---|
| Lint (`npm run lint`) | N/A — no source file changed (spec Validation Required) |
| Type-check (`npm run type-check`) | N/A — no source file changed (spec Validation Required) |
| Unit tests (`npm test`) | Pass — 2,248 passed, 0 failed, 1 skipped (round-2 re-run in `handoff.md`; QA did not re-run) |
| Template mirror (`npm run sync-templates:check`) | Pass — re-run by QA: "All canon-managed files in sync" |
| Docs refs (`npm run docs-refs-check`) | Pass — re-run by QA: "All refs OK" |
| Build (`npm run build`) | N/A — no source file changed (spec Validation Required) |
| E2E | N/A — no UI surface |
| AC-7 greps (`taskDirFromRoot`, "Backlogged (separate") | Pass — re-run by QA: no matches in `docs/`, `.claude/`, or `templates/` |

## Human Verification Required

None.

Pre-merge checklist (cannot be confirmed yet):

- [x] Version correct — no bump in this task (Judgment Call 4); `/canon-prune` is still under `[Unreleased]`.
- [x] Changelog updated if needed — no change proposed (see Proposed Changelog).
- [ ] PR body current — `tasks/canon-prune-run-lessons/pr-body.md` is drafted; confirm after `--pr` opens the PR.
- [ ] Final CI/CD checks green — no PR exists yet.
- [x] Final diff matches spec intent — round-2 review checked AC-1 to AC-7 against the diff.

## Proposed Changelog

No user-facing change beyond the unreleased entry — omit from changelog. The unreleased `/canon-prune` bullet already describes the skill that these instructions govern, and no adopter has a released version of it yet. When `/canon-changelog` runs, the human may choose to fold in "the prune record must be carried into the squash or PR merge," but this QA pass proposes no separate bullet.

## Judgment Calls to Confirm

- Delete the untracked "Backlogged" line in `docs/decisions.md` — chose delete; alternative: file the four ideas as backlog items (none has been picked up since 2026-06).
- How guard cost is shown — chose prose in each row (the requirement and its remaining selecting paths); alternative: a `canon` command that diffs pitfall selection before and after.
- Version bump and changelog — chose none, since `/canon-prune` is still under `[Unreleased]`; alternative: a new changelog bullet for this change.

## Decisions Made

- **Carve-out wording is unconditional for this row (review round 2).** Round 1 found the first wording ("when pruning with `/canon-prune`") unreachable, because `/canon-prune` excludes canon-managed files from its input and this row covers those root copies. The carve-out now applies to this row's canon-ai root docs without a condition (`.claude/skills/docs-audit/SKILL.md:26`).
- **Headings kept.** §"Verdicts" and §"Implement-prompt guard" keep their names because `docs-audit` cites them by heading.
- **No source or test changes.** The diff touches only the Affected Files in the spec.

## Open Questions

- Should the prune record be required in the squash commit message itself, not only in the PR body that the merge uses? AC-4 allows either. Round 1 Codex review argued that `git log --grep` finds the record only when the commit message contains it, since GitHub's squash merge uses the PR body as the message only when the PR is set up that way. The current wording stays as the spec wrote it unless you decide otherwise.

## Follow-ups

| Category | Follow-up | Tracked |
|---|---|---|
| nit | Step 2's inventory-agent return format ("a proposed verdict with exact replacement text, or `delete`") does not list the sentence classification. Adding it to the return fields would show an omission earlier (Known Risk 2). Round 1 nit, left as-is in round 2. | untracked |
| nit | Step 4's "Sentence classification" column has no stated value for `relocate` and `merge` rows. Round 1 nit, left as-is in round 2. | untracked |
| nit | Step 5 reports edits outside the approved rows (CHANGELOG, backlog) only in the hand-back, not at triage, and "heading rename" is not a verdict. AC-3 mandates this shape; the reviewer marked it informational. Round 1 nit. | untracked |
| nit | Step 6 carries the record in a PR body, which `git log --grep` finds only if the merge uses that body as the commit message. A clarifying clause would help; AC-4 allows the PR-body route, so no change was required. Round 1 nit, from the Codex P2 dismissed as blocking. | untracked |
| nit | `.claude/skills/docs-audit/SKILL.md:26` says "this row's canon-ai root docs," which is looser than "root copies of `CANON_OWNED` markdown files," so the carve-out's reach is ambiguous. Flagged by the anchored and cold-Claude lenses in round 2. | untracked |
| nit | Step 6 does not literally tell the human to carry the record; the audience is implicit. Round 2 nit, from the anchored lens. | untracked |
| observation | Check whether the per-sentence classification is filled in on the next real `/canon-prune` run. Known Risk 2 says an inventory agent could label a whole clause "superseded" without per-sentence work. | untracked |

Maintenance: lessons-learned.md plus this task's fragment have 16 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log

- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Two review rounds; round 1 found one blocking wording bug in the docs-audit carve-out, fixed in round 2, with nits left as follow-ups.

## Root Cause

- context-conflicting: the docs-audit group covers root copies of `CANON_OWNED` files, but `/canon-prune` excludes canon-managed files from its input, so a carve-out conditioned on a `/canon-prune` run could never apply to the rows it covers.
