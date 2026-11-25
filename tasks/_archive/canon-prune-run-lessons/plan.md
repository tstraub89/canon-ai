# Implementation Plan: canon-prune-run-lessons

> Written by: Claude | Implements: `tasks/canon-prune-run-lessons/spec.md`

## Approach

Short prose additions in the step of `/canon-prune` each lesson governs, a one-sentence carve-out in `docs-audit`, and two line-level doc fixes. No source changes.

Feasibility check:
- **Exists:** `.claude/skills/canon-prune/SKILL.md` has §"Implement-prompt guard", §"Step 2 — Inventory and evidence", §"Step 3 — Cross-doc comparison", §"Step 4 — Triage with the human", §"Step 5 — Apply and validate" and §"Step 6 — Prune record". `.claude/skills/docs-audit/SKILL.md` has the "Prune (canon-managed set)" group row and the `PRUNE` verdict line. `taskDirFromRoot` appears once in `docs/patterns.md` (the worktree test-rule paragraph); `taskDirFor()` is exported from `src/orchestrator/state.ts`. The "**Backlogged (separate future minors" line is in `docs/decisions.md`.
- **Real path:** prose read by the invoking Claude session and its subagents; no runtime path.
- **Callers:** `docs-audit` cites §"Verdicts" and §"Implement-prompt guard" by heading; keep both headings unchanged.
- **Tests that can fail:** some tests pin shipped skill content; `npm test` covers them. `sync-templates:check` fails if the mirror isn't synced.
- **Predicates:** N/A.
- **Scope:** every file below is in the spec's Affected Files.
- **Async/stateful:** N/A.

## Steps

### Step 1: Sentence-level delete check (AC-1)

Files: `.claude/skills/canon-prune/SKILL.md`

In Step 2's per-rule return, require for any proposed `delete` (whole rule or clause) a classification of each removed sentence: superseded, obsolete, or stated elsewhere (with location). A sentence that states a current fact or rule turns the proposal into an edit that keeps or moves it. Repeat the requirement in Step 3 for merge copies being removed, and add the classification to the Step 4 row contents.

### Step 2: Guard rows name their cost (AC-2)

Files: `.claude/skills/canon-prune/SKILL.md`

Extend §"Implement-prompt guard": every tagged row names each live requirement in the affected text and the paths that still select it after the edit; a requirement with no selecting path is kept as its own short H3 citing its code paths. Don't fold a short rule into a larger pitfall; rules guarding one failure stay in one H3 citing all their paths. Keep the heading unchanged.

### Step 3: Reference sweep (AC-3)

Files: `.claude/skills/canon-prune/SKILL.md`

In Step 5, before applying a `delete`, `merge`, `relocate` or heading rename: search the repository, excluding archived task directories, for references to the affected heading or claim (changelog, backlog, other docs); retarget or remove each in the same apply; list them in the hand-back.

### Step 4: Record survives the merge (AC-4)

Files: `.claude/skills/canon-prune/SKILL.md`

In Step 6's hand-back paragraph: the drafted message is the prune record; if the change merges by squash or through a PR, carry it (at least the "Reviewed and kept" list and the `Canon-Prune:` trailer) into the squash commit message or the PR body the merge uses.

### Step 5: Sync the mirror (AC-5)

Files: `templates/.claude/skills/canon-prune/SKILL.md`

Run `npm run sync-templates`. Keep the shipped skill free of canon-ai-specific text.

### Step 6: canon-ai carve-out (AC-6)

Files: `.claude/skills/docs-audit/SKILL.md`

In the Prune group row, add: when pruning canon-ai's own root docs with `/canon-prune`, the "describes a canon mechanism" delete criterion and §"High-level canon mentions only" do not apply.

### Step 7: Doc fixes (AC-7)

Files: `docs/patterns.md`, `docs/decisions.md`

Remove the parenthetical incident aside naming `taskDirFromRoot()` from the worktree test-rule paragraph, keeping the `taskDirFor()` rule. Delete the "**Backlogged (separate future minors…**" line.

## Testing Plan

- **Unit**: `npm test` (full suite; pinned skill content).
- **Checks**: `npm run sync-templates:check`, `npm run docs-refs-check`, the AC-5 and AC-7 greps.
- **E2E**: N/A.
