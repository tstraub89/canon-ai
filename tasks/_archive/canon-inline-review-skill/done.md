# QA Summary: canon-inline-review-skill — Add canon-inline-review cross-review skill

> For the human. This is what you need to know.

## What Changed

Added a new `/canon-inline-review` Claude Code skill that drives an independent second-model cross-review of below-the-pipeline work (non-trivial inline edits and XS fixes too small for a full canon task). Previously, the operator had to hand-construct the `codex review` invocation each time and recall all the flag rules from CLAUDE.md; now the skill handles everything and loads on demand.

The skill went through one reroute after the initial code review and then a third review round each surfaced the same design issue: auto-detecting the review target from git state (ahead-check, `git log @{u}..HEAD`) has an irreducible ambiguous edge case. Per canon's iteration-vs-design lesson, same class round-over-round means the design is wrong. The final implementation uses **intent-from-context**: the operator's request, conversation, and `$ARGUMENTS` determine the target — not git plumbing. A single `git status --porcelain` survives as a no-op guard only (clean tree + `--uncommitted` resolved → ask rather than run an empty review). Genuine ambiguity routes to `AskUserQuestion`.

The skill's target-selection contract:
- Commit / "last commit" / SHA → `--commit <SHA>` (resolved via read-only `git rev-parse` / `git log`)
- Branch / "whole branch" / pre-PR → `--base <branch>`
- Steering text → positional `PROMPT` (cannot combine with a selector — selector XOR prompt)
- Explicit "uncommitted" / "before commit" / no other signal → `--uncommitted`

`CLAUDE.md`'s "Cross-review for inline and XS work" section (≈12 lines of invocation mechanics) was replaced by a ≤2-line norm and a pointer to the skill. The always-loaded file keeps the rule (when to cross-review; Claude never self-reviews its own inline code; not a spec-compliance gate). The on-demand skill owns the mechanics.

The skill is registered on all required surfaces so it ships to adopters via `canon upgrade`, appears in `canon doctor`, and the README drift test stays green.

## Files Changed

| File | Change |
|---|---|
| `.claude/skills/canon-inline-review/SKILL.md` | Created — new skill with frontmatter, intent-driven target-selection contract, `AskUserQuestion` on ambiguity, scope bound, flag reference pointing at `codex exec review --help` |
| `templates/.claude/skills/canon-inline-review/SKILL.md` | Auto-synced mirror (pre-commit hook) |
| `CLAUDE.md` | Replaced ~12-line cross-review how-to with ≤2-line norm + pointer to `/canon-inline-review` |
| `templates/CLAUDE.md` | Auto-synced delimited mirror |
| `src/lib/canon-owned.ts` | Added skill path to `CANON_OWNED` (gives it the templates mirror) |
| `src/cli/commands/doctor.ts` | Added `canon-inline-review` to `checkSkills()` and `RECOMMENDED_ALLOW` |
| `tests/cli.test.ts` | Expanded skill count from six to seven; switched README drift checks to `WORKTREE_ROOT` |
| `README.md` | Added skill catalog row, prose summary mention, and permission-prompt allowlist entries |
| `.claude/settings.json` | Added local permission grants (canon-ai-local only; does not ship to adopters) |
| `dist/cli/index.js` | Rebuilt after doctor/canon-owned changes |

## How to Test

1. In a repo using canon, make a small uncommitted code change.
2. Ask for an inline review (e.g., "review my uncommitted changes before I commit") or invoke `/canon-inline-review` directly.
3. Expected: the skill runs an independent second-model review of your uncommitted changes and returns a concise findings summary — without requiring you to recall the exact invocation — and it does **not** behave like a spec/AC gate.
4. Open `CLAUDE.md`: confirm the long "Cross-review for inline and XS work" how-to is gone, replaced by a short norm and a pointer to `/canon-inline-review`.
5. Run `canon doctor`: the new skill is recognized and all checks pass.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite including expanded skill-enumeration tests and README drift check (switched to `WORKTREE_ROOT`) |
| `npm run build` | Pass | `dist/cli/index.js` rebuilt and committed |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | Root and `templates/` mirrors in sync |
| `codex exec review --uncommitted` smoke test | blocked | Sandbox rejected app-server client init (`Operation not permitted (os error 1)`); live invocation requires running outside the Codex pipeline sandbox |
| E2E | not_configured | canon-ai has no UI/E2E surface |

## Human Verification Required

None.

(The smoke test status is `blocked` — a sandbox infrastructure limitation — not `human_pending`. The `human_review` gate does not hold for `blocked` checks. Verify the live invocation via the Human Test Plan steps above in your own environment before ship.)

## Decisions Made

- **Intent-from-context replaces git-state inference for target selection** (reroute after round 1+3 convergence): the original design used `git log @{u}..HEAD` + ahead-detection, which produced the same edge-case bug class across every review round. The rerouted contract derives intent from the operator's request and conversation, not git plumbing.
- **Function-named `canon-inline-review` not tool-named `canon-codex-review`**: the name survives a change of second-model reviewer, consistent with canon's no-provider-lock-in stance (`docs/decisions.md` §"Canon prescribes no release model to adopters").
- **`--sandbox read-only` not representable on codex-cli 0.139.0**: `codex exec review --help` does not expose a sandbox flag; the wrapper rejects it. The skill documents the CLI's default read-only review behavior and directs operators at `codex exec review --help` as the live source of truth.
- **README drift tests read `WORKTREE_ROOT` not `REPO_ROOT`**: in a linked-worktree pipeline run, `REPO_ROOT` points at the supervising checkout and misses the task's edits. Now encoded in the test; carries forward to all future tasks touching the README drift check.
- **`settings.json` not in `CANON_OWNED`**: it carries canon-ai's machine-specific config and must not ship to adopters. The adopter grant path is `RECOMMENDED_ALLOW` in `doctor.ts`.

## Proposed Changelog

Proposed version bump: **minor → v1.13.0**. A new skill is a new operator- and adopter-facing capability (ships via `CANON_OWNED`/`RECOMMENDED_ALLOW`); the CLAUDE.md collapse reduces noise in every session. Clears the minor bar per `docs/decisions.md` versioning policy.

Proposed entries under `## [Unreleased]`:

```
### Added

- **New `/canon-inline-review` skill drives independent second-model cross-review for below-the-pipeline work.**
  Non-trivial inline edits and XS fixes too small for a canon task now have a dedicated cross-review path:
  invoke the skill, describe what you want reviewed, and it runs `codex exec review` non-interactively and
  returns a concise bug/quality summary. Target selection is intent-driven — the skill reads your request
  and conversation context to pick `--uncommitted`, `--commit <SHA>`, or `--base <branch>`; a clean working
  tree is detected before running so the review is never silently a no-op. The skill is not a spec-compliance
  gate — anything with acceptance criteria still goes through `canon run` / `--reroute`. Ships to adopters
  via `canon upgrade`; recognized by `canon doctor`; included in the recommended permission block.

### Changed

- **`CLAUDE.md`'s always-loaded cross-review how-to collapses to a two-line norm.** The detailed
  `codex review` invocation mechanics (flag forms, selector-XOR-prompt rule, dirty-tree scoping) have
  moved into the `/canon-inline-review` skill, which loads only on demand. `CLAUDE.md` retains the rule —
  non-trivial inline and XS work gets an independent review before commit; Claude never self-reviews its
  own inline code; this is not a spec-compliance gate — and a pointer to the skill.
```

The human finalizes the version number and wording before cutting the release.

## Open Questions

None.
