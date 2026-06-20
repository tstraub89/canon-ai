# Implementation Handoff: vacate-adopter-md

> Author: Codex | Spec: `tasks/vacate-adopter-md/spec.md` | Plan: `tasks/vacate-adopter-md/plan.md`
>
> This handoff is rewritten after reroute #1 and is the complete current implementation record.

## Changes

| File | What Changed |
|---|---|
| `.claude/skills/canon-init/SKILL.md` | Re-scoped initialization guidance to read existing agent files as adopter-owned context, with no canon merge protocol. |
| `.claude/skills/canon-init/write-guide.md` | Replaced the agent-file merge protocol with adopter-owned context guidance. |
| `.github/workflows/ci.yml` | Removed git-install smoke assertions that `canon init` creates root agent files; left `canon doctor` in place. |
| `AGENTS.md` | Slimmed canon-ai-local operator context and removed canon delimiter markers. |
| `CLAUDE.md` | Slimmed canon-ai-local operator context, kept always-on norms, removed delimiter markers, and added `docs/lessons-learned.md` to conversational-session reading. |
| `README.md` | Documented adopter ownership for agent files, updated `canon upgrade`, and added independent-review guidance for inline work. |
| `dist/cli/index.js` | Rebuilt bundled CLI output after source changes. |
| `dist/scripts/run-task.js` | Rebuilt bundled orchestrator output after source and prompt-helper changes. |
| `docs/architecture.md` | Updated CI/path-filter wording so root agent files are local operator docs, not canon-managed root files. |
| `docs/codebase-map.md` | Repointed wiring-map references from root agent files to JIT skills/prompts. |
| `docs/decisions.md` | Added the agent-file ownership decision and corrected stale release-model guidance references. |
| `docs/pipeline-orchestrator.md` | Removed root agent files as source-of-truth/customization targets for canon-owned workflow rules. |
| `docs/product-context.md` | Updated adoption flow so `canon init` no longer scaffolds root agent files. |
| `scripts/run-task/prompts/helpers.ts` | Removed root-agent-file read instructions from startup constants and the resumed-session note. |
| `scripts/run-task/prompts/templates/qa.md` | Removed `AGENTS.md` from the QA lesson-promotion target list. |
| `src/cli/commands/doctor.ts` | Removed `checkAgentFile` and its two failing presence checks; left the warn-only discovery nudge. |
| `src/cli/commands/init.ts` | Added direct existing-agent-file detection and replaced merge-protocol output with adopter-owned context output. |
| `src/cli/commands/upgrade.ts` | Exported marker constants for the migration tool, generalized the delimited-files comment, and widened the loop variable for an empty `DELIMITED`. |
| `src/lib/canon-owned.ts` | Made `DELIMITED` empty so root agent files are no longer managed. |
| `templates/.claude/skills/canon-init/SKILL.md` | Synced canon-owned template mirror for the canon-init skill. |
| `templates/.claude/skills/canon-init/write-guide.md` | Synced canon-owned template mirror for the canon-init write guide. |
| [templates/AGENTS.md](templates/AGENTS.md) | Deleted adopter agent template. |
| [templates/CLAUDE.md](templates/CLAUDE.md) | Deleted adopter agent template. |
| `templates/docs/architecture.md` | Updated shipped scaffold template to avoid stale root-agent-file authority references. |
| `templates/docs/codebase-map.md` | Updated shipped scaffold template to describe agent files as adopter-owned operator context. |
| `templates/docs/decisions.md` | Updated shipped scaffold template release-policy references away from root-agent-file authority. |
| `templates/docs/pipeline-orchestrator.md` | Synced canon-owned pipeline-orchestrator template mirror. |
| `templates/docs/product-context.md` | Updated shipped scaffold template pointer away from `CLAUDE.md` quick refs. |
| `tests/cli.test.ts` | Updated init/upgrade/doctor tests for no-scaffold/no-upgrade behavior and removed `checkAgentFile` coverage. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt golden after QA prompt and startup-helper changes. |
| `tests/strip-canon-block.test.ts` | Added migration-tool fixture coverage, including fail-closed git-status behavior. |
| `tests/sync-canon-templates.test.ts` | Updated sync tests for an empty `DELIMITED` while retaining fixture-level merge coverage. |
| `tools/strip-canon-block.mjs` | Added non-shipped migration tool for stripping legacy canon blocks from root agent files; dirty-tree writes fail closed. |

## Intent & Rationale

The implementation removes canon ownership of adopter root agent files while preserving the delimiter machinery for future file types. `canon init`, `canon upgrade`, `canon doctor`, CI smoke checks, docs, shipped skills, and pipeline startup prompts now align around one rule: root agent files are adopter-owned context when present, not canon-scaffolded or canon-merged files.

Canon-ai's own root agent files were slimmed to ambient local operator context. Reusable workflow rules remain in skills, per-phase prompts, task templates, and protected docs; always-on operator norms that no skill reliably restates remain in `CLAUDE.md`.

## Deviations

| Deviation | Rationale | AC impact |
|---|---|---|
| Edited `templates/docs/architecture.md`, `templates/docs/decisions.md`, `templates/docs/product-context.md`, and `templates/docs/codebase-map.md`, which were not separately listed in the original plan's Affected Files table. | Full-suite docs reference tests scan shipped scaffold templates too; after deleting the agent templates, these mirrors still carried stale root-agent-file authority references. Updating them keeps shipped adopter scaffolds consistent. | Supports AC-13 / AC-18. |
| The migration tool's dirty-tree guard now treats git-status errors as dirty/unknown. | Code review found the initial implementation failed open when git was unavailable. A write-safety guard should refuse when cleanliness cannot be established. | Strengthens AC-8. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 — `DELIMITED` no longer manages the two files | Met | `src/lib/canon-owned.ts` exports `DELIMITED = [] as const`; no root-agent-file membership remains. |
| AC-2 — Delimited machinery retained and still functional | Met | `mergeDelimited`, marker constants, and delimited loops remain; fixture tests still cover `mergeDelimited` and `mergeDelimitedForSync`. |
| AC-3 — A file can be re-added to `DELIMITED` with no code change | Met | The upgrade/sync loops are retained as no-ops over an empty list, and fixture tests exercise the machinery independent of list contents. |
| AC-4 — Template files deleted | Met | [templates/AGENTS.md](templates/AGENTS.md) and [templates/CLAUDE.md](templates/CLAUDE.md) are deleted; production source no longer reads them by name. |
| AC-5 — `canon init` adds neither file | Met | `tests/cli.test.ts` asserts real templates create neither root agent file. |
| AC-6 — `canon init` detects existing agent files without promising a merge protocol | Met | `hasExistingAgentFiles()` checks direct presence; tests cover present/absent paths; `git grep -niI 'merge protocol' -- src/cli/commands/init.ts` returns no matches. |
| AC-7 — `canon upgrade` does not touch root agent files | Met | `tests/cli.test.ts` asserts both files remain byte-identical when upgrade runs with arbitrary content. |
| AC-8 — Migration tool exists with specified contract | Met | `tools/strip-canon-block.mjs` implements strip/no-op/partial-marker/dirty-tree/check/idempotent behavior; tests cover the contract and git-status-unavailable refusal. |
| AC-9 — Migration tool does not ship | Met | `package.json` has no `tools/` files entry; `npm_config_cache=/private/tmp/canon-npm-cache npm pack --dry-run` excluded the tool. |
| AC-10 — canon-ai's own files have no delimiter markers and are slimmed | Met | Root agent files have no `canon:start` / `canon:end` hits and are materially smaller; `CLAUDE.md` retains always-on norms. |
| AC-11 — No operator rule is orphaned by the slim | Met | Mapping table below records dropped sections and surviving homes; cross-references were repointed. |
| AC-12 — N5 resolved | Met | `scripts/run-task/prompts/templates/qa.md` now says `patterns.md / decisions.md`; golden regenerated. |
| AC-13 — Stale managed/scaffolded/delimited references swept | Met | README/docs/skills/templates were swept; prompt-helper root-agent-file references were also removed by amendment AC-A2. |
| AC-14 — README updated | Met | README states adopter ownership, updates `canon upgrade`, and adds independent review guidance for inline work. |
| AC-15 — `docs/decisions.md` updated | Met | Added the zero-owned-content decision and corrected stale references in release-model guidance. |
| AC-16 — `canon doctor` stops enforcing the two files | Met | `checkAgentFile` and its calls/tests are removed; absent-agent-file doctor coverage now warns without failing. |
| AC-17 — CI git-install smoke updated | Met | The two root-agent-file `test -f` assertions are gone and `canon doctor` remains. Remote CI was not runnable from this sandbox; local validation passed. |
| AC-18 — Build, golden, and full validation are clean | Met | Dist rebuilt, golden regenerated, and required local validation passed. |
| AC-A1 — Startup helpers no longer instruct reading root agent files | Met | `CLAUDE_STARTUP`, `CODEX_STARTUP`, and `toResumePrompt()` no longer name root agent files; remaining startup reads are scaffolded docs. |
| AC-A2 — Prompt layer has no root-agent-file references | Met | `git grep -nE 'AGENTS\.md\|CLAUDE\.md' -- scripts/run-task/prompts/` returns no matches. |
| AC-A3 — `docs/lessons-learned.md` added to conversational-session reading | Met | `CLAUDE.md` now tells conversational sessions to skim `docs/lessons-learned.md`. |
| AC-A4 — Golden regenerated and dist rebuilt after helper change | Met | `UPDATE_GOLDENS=1 npm test`, clean `npm test`, `npm run build`, `npm run docs-refs-check`, and `npm run sync-templates:check` all passed. |

### AC-11 Mapping

| Dropped/root section | Surviving home |
|---|---|
| `CLAUDE.md` spec authorship guidance | `.claude/skills/canon-spec/SKILL.md` |
| `CLAUDE.md` plan guidance | `.claude/skills/canon-pipeline/SKILL.md`; `scripts/run-task/prompts/templates/plan.md` |
| `CLAUDE.md` code review guidance | `.claude/agents/code-review-anchored.md`; `.claude/agents/code-review-cold.md` |
| `CLAUDE.md` QA summary guidance | `scripts/run-task/prompts/templates/qa.md` |
| `CLAUDE.md` PR/opening guidance | `.claude/skills/canon-pipeline/SKILL.md`; `docs/pipeline-orchestrator.md` |
| `AGENTS.md` workflow and handoff protocol | `docs/pipeline-orchestrator.md`; `.canon/templates/*.md`; per-phase prompt templates |
| `AGENTS.md` implementation/escalation/validation rules | `scripts/run-task/prompts/templates/implement.md`; task specs' validation sections; `docs/pipeline-orchestrator.md` |
| `AGENTS.md` code review responsibilities | `.claude/agents/code-review-anchored.md`; `.claude/agents/code-review-cold.md` |
| `AGENTS.md` release/changelog rules | `scripts/run-task/prompts/templates/qa.md`; `.claude/skills/canon-changelog/SKILL.md`; `docs/decisions.md` |
| Always-on operator norms | Retained in root `CLAUDE.md`. |
| Cross-reference rows in `docs/codebase-map.md` | Repointed to `docs/pipeline-orchestrator.md` and `scripts/run-task/prompts/templates/`. |

## Edge Cases

- Dirty-tree migration writes are refused, and unknown git status now refuses writes too; `--check` / `--dry-run` still report on dirty trees.
- Partial legacy blocks fail non-destructively rather than silently preserving or corrupting content.
- `DELIMITED` being empty keeps loop machinery intact without type/lint regressions.
- Existing adopter agent files are detected even though deleted templates no longer appear in the scaffold skip list.
- Prompt startup text no longer points fresh no-agent-file adopters at missing paths.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-run after reroute helper/`CLAUDE.md` changes. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` passed. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`; postbuild normalized paths. |
| `UPDATE_GOLDENS=1 npm test` | Pass | Regenerated `tests/run-task-prompts.golden.json`; suite passed with 876 pass, 1 skipped. |
| `npm test` | Pass | Clean full suite passed with 876 pass, 1 skipped. |
| `npm run docs-refs-check` | Pass | `All refs OK`. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm_config_cache=/private/tmp/canon-npm-cache npm pack --dry-run` | Pass | Original implementation check: tarball listing excludes `tools/strip-canon-block.mjs`; first attempt without temp cache hit unrelated local npm cache ownership. |
| `git grep -n "canon:start\|canon:end" -- CLAUDE.md AGENTS.md` | Pass | No root delimiter markers found. |
| `git grep -n "checkAgentFile" -- src tests dist` | Pass | No remaining references. |
| `git grep -nE 'AGENTS\.md\|CLAUDE\.md' -- scripts/run-task/prompts/` | Pass | No prompt-layer root-agent-file references remain. |
| AC-13 stale-reference sweep | Pass | No stale managed/scaffolded/delimited root-agent-file references in README/docs/skills/templates after wording cleanup. |
| E2E | deferred_by_spec | Spec Validation Required marks E2E as N/A because this task has no UI/runtime surface. |

## Ready for Review

- [x] All original and amendment ACs met.
- [x] All applicable validation checks pass.
- [x] Deviations and residual context documented.
