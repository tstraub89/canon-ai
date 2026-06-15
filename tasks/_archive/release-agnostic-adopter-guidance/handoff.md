# Implementation Handoff: release-agnostic-adopter-guidance

> Author: Codex | Spec: `tasks/release-agnostic-adopter-guidance/spec.md` | Plan: `tasks/release-agnostic-adopter-guidance/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `.claude/skills/canon-pipeline/SKILL.md` | Reframed the frontmatter description and rewrote §5 into a model-neutral core plus four recipes (release-branch-per-version, trunk-from-main, tag-from-main, no versioning). |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Auto-synced mirror of the root skill edit. |
| `.claude/skills/canon-changelog/SKILL.md` | Neutralized the base-branch heuristic and the finalize-mode version-bump note without changing the rest of the changelog workflow. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Auto-synced mirror of the root skill edit. |
| `docs/decisions.md` | Added the new no-release-model decision entry and corrected the stale `dev`/`main` parentheticals in the existing versioning policy entry. |
| `tasks/release-agnostic-adopter-guidance/notes.md` | Appended one implement note about `git grep` pathspec exclusions in this repo. |
| `tasks/release-agnostic-adopter-guidance/status.json` | Task artifact updated for the in-progress implement phase and the final phase-close transition. |
| `tasks/release-agnostic-adopter-guidance/handoff.md` | Filled the implementation handoff, including AC coverage, validation results, and the inventory scan required by AC-1. |

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

This is a documentation-only adopter-facing release-model rewrite. The implementation keeps the orchestrator untouched and moves the shipped guidance from a single release-branch story to model-neutral mechanics plus named recipes. The decision doc change makes the stance durable so the same release-branch bias does not creep back into shipped guidance later.

## Inventory Scan

Commands run:

```bash
git grep -n -e 'release/v' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
git grep -n -e 'release branch' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
git grep -n -e 'release-branch' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
git grep -n -e 'origin/dev' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
git grep -n -e 'dev branch' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
git grep -n -e 'cut a release' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
git grep -n -e 'unreleased' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
git grep -n -e 'base_branch\\|base branch' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
git grep -ni -e 'trunk' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'
```

### Shipped-surface hits (disposition required for each)

| File | Hit list | Disposition |
|---|---|---|
| `.canon/templates/status.json` | `base_branch` default `main` scaffold at line 8 | `intentionally-conditional`: scaffold default; `canon task new` overwrites from checkout |
| `.claude/skills/canon-changelog/SKILL.md` | lines 3, 21, 22, 52, 54, 58-61, 118, 134, 162, 166, 173-174 | `reframed` |
| `.claude/skills/canon-pipeline/SKILL.md` | lines 3, 72, 82, 84, 96, 98, 106, 108-115, 119, 121, 123, 131, 133 | `reframed` |
| `AGENTS.md` | lines 156, 157, 165, 363 | `intentionally-conditional`: release guidance is explicitly conditional on a versioned release branch |
| `CLAUDE.md` | lines 58, 65, 153, 189 | `intentionally-conditional`: release-branch-specific guidance by design, not a default model |
| `docs/decisions.md` | line 125 historical `dev` note | `intentionally-conditional`: historical parenthetical only; current policy line was rewritten |
| `docs/pipeline-orchestrator.md` | lines 105, 115, 127, 130, 131, 144, 189, 262, 264, 305, 451, 453 | `intentionally-conditional`: pipeline mechanics reference, not adopter-facing policy |
| `templates/.claude/skills/canon-changelog/SKILL.md` | lines 3, 21, 22, 52, 54, 58-61, 118, 134, 162, 166, 173-174 | `reframed` |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | lines 3, 72, 82, 84, 96, 98, 106, 108-115, 119, 121, 123, 131, 133 | `reframed` |

### Non-shipped hits (listed for completeness; no disposition required)

| File | Hit list |
|---|---|
| `.canon/hooks/README.md` | line 9 |
| `.github/workflows/auto-release.yml` | lines 161, 163-164 |
| `.github/workflows/ci.yml` | lines 71-72 |
| `CHANGELOG.md` | line 190 |
| `docs/BACKLOG.md` | lines 604, 1049, 1085-1090, 1102 |
| `docs/product-context.md` | line 127 |
| `docs/release-process.md` | lines 9-11, 26, 39-41, 63, 66, 68, 75-76, 81, 86, 93, 97, 101-105, 108, 111, 115, 126 |
| `templates/docs/pipeline-orchestrator.md` | line 131 |
| `tests/cli.test.ts` | lines 2328, 2330, 2335, 2365 |
| `tests/fixtures/canon-dev-tokens.json` | lines 2-3 |
| `tests/run-task-prompts.golden.json` | lines 6-8 |
| `tests/run-task-prompts.test.ts` | lines 110, 402 |
| `tests/run-task-reroute-preflight.test.ts` | line 63 |
| `tests/run-task-safety.test.ts` | lines 429, 644, 655, 664-665, 695, 701, 711, 738, 744, 754, 769, 783, 789, 833, 863, 876, 883, 932, 941, 968, 974, 984, 996, 1008, 1015, 1033, 1063, 1073, 1078, 1083-1084, 2072, 2106-2107, 3187, 3798, 3822, 3887, 3948, 4011, 4050, 4127, 4150 |
| `tests/run-task-ship.test.ts` | lines 213, 395, 402, 408, 437, 454, 652, 841, 867, 871-872 |
| `tests/run-task-validation.test.ts` | lines 124, 1609, 3063 |
| `tests/task-cli.test.ts` | lines 75, 145, 548, 1742 |

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | The implementation followed the plan directly. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: inventory gate | Met | Re-ran the requested `git grep` inventory against the live tree and recorded both shipped-surface dispositions and non-shipped hits in the inventory scan above. |
| AC-2: recipe menu | Met | `canon-pipeline/SKILL.md` now has four explicit recipes, one for each required release shape. |
| AC-3: per-task / hybrid framing | Met | The skill now states that `base_branch` is recorded per task and that hybrid repos can mix models across surfaces. |
| AC-4: authority pointer | Met | Each recipe defers versioning / tagging / branch policy to the adopter's own `decisions.md` or release doc. |
| AC-5: frontmatter | Met | The skill description no longer frames the skill as release-branch-specific. |
| AC-6: changelog skill neutralization | Met | Only the base-branch heuristic and the finalize note were reframed; the rest of the changelog workflow is unchanged. |
| AC-7: decision record | Met | `docs/decisions.md` now contains the new no-release-model decision and the stale `dev`/`main` wording is corrected. |
| AC-8: diff scope guard | Met | The diff stayed inside the allowed doc/skill/task-artifact set; no `scripts/`, `src/`, `dist/`, `AGENTS.md`, `CLAUDE.md`, or `docs/release-process.md` edits were introduced. |
| AC-9: templates mirror invariant | Met | `npm run sync-templates:check` passed, confirming the root skill edits match their `templates/` mirrors. |

## Edge Cases Considered

- `docs/pipeline-orchestrator.md` and `AGENTS.md` still mention release branches because they describe mechanics or conditional cases, not a canonical default model.
- The changelog skill's finalize behavior was left intact except for the one note about when version bumps happen.
- The task artifact `status.json` remains part of the diff because the phase transition and the handoff are both part of the implement submission.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | `eslint scripts/ tests/ src/` |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` |
| `npm test` | Pass | Full suite passed: 867 pass, 0 fail, 1 skipped. |
| `npm run sync-templates:check` | Pass | Mirrors were already in sync after editing both roots and `templates/` copies. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run build` | deferred_by_spec | Spec marks build N/A because skills/docs are not bundled into `dist/`. Spec: `Validation Required` section. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

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
