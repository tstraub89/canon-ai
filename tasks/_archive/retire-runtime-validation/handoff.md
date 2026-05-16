# Implementation Handoff: retire-runtime-validation

> Author: Codex | Spec: `tasks/retire-runtime-validation/spec.md` | Plan: `tasks/retire-runtime-validation/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file.

## Changes

| File | What Changed |
|---|---|
| `.canon/README.md` | Added implement-phase validation guidance for project-owned Codex sandbox config and project scripts. |
| `.canon/templates/handoff.md` | Removed runtime-validation rerun guidance from the revision comment. |
| `.canon/templates/status.json` | Removed the `runtime_validation` phase block from newly scaffolded tasks. |
| `.claude/skills/canon-pipeline/SKILL.md` | Removed runtime-validation phase flow, valid phase, and recovery guidance. |
| `.claude/skills/canon-status/SKILL.md` | Removed runtime-validation failure warning guidance. |
| `AGENTS.md` | Removed the phase from pipeline diagrams, handoff sequence, validation-authority boundary, and commit-ownership text. |
| `CLAUDE.md` | Updated plan-to-review flow and Stage 1 validation-gate language. |
| `CODEX.md` | Updated flow diagrams and review-iteration guidance to code-review-only reroutes. |
| `README.md` | Removed the phase from the public pipeline flow. |
| `docs/BACKLOG.md` | Removed the deleted call site from the live bundle/worktree entry, narrowed verdict-source scope, and retired the `RuntimeCheck.cwd` gap in place. |
| `docs/architecture.md` | Removed the lifecycle step and auto-block/runtime-counter references. |
| `docs/pipeline-orchestrator.md` | Removed phase docs, env var docs, runtime registry docs, and updated routing/loop prose. |
| `docs/product-context.md` | Rewrote validation extension roadmap and removed stale hardcoded test-count prose. |
| `scripts/pipeline-policy.ts` | Deleted `RuntimeCheck` and `RUNTIME_CHECKS`. |
| `scripts/run-task/context.ts` | Collapsed implement revision-state copy to code-review feedback only. |
| `scripts/run-task/git.ts` | Added `parseNameStatusOutput()` and `getAffectedFiles()`. |
| `scripts/run-task/main.ts` | Removed runtime phase dispatch, routing, dry-run listing, verdict reads, and `TaskContext` population. |
| `scripts/run-task/phases/implement.ts` | Removed runtime-iteration revision detection and threaded affected files into implement prompts. |
| `scripts/run-task/phases/runtime-validation.ts` | Deleted the phase handler. |
| `scripts/run-task/prompts/index.ts` | Removed runtime-failure prompt plumbing and added affected-files prompt block rendering. |
| `scripts/run-task/prompts/templates/implement.md` | Added the affected-files section placeholder. |
| `scripts/run-task/prompts/templates/implement-revisions.md` | Removed runtime-failure copy and added the affected-files section placeholder. |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Added the affected-files section placeholder. |
| `scripts/run-task/state.ts` | Removed default injection of the legacy phase block while preserving unknown fields on write. |
| `scripts/run-task/types.ts` | Removed `runtime_validation` from `PHASE_ORDER` and removed `runtimeIterations*` from `TaskContext`. |
| `scripts/run-task/validation.ts` | Removed runtime-results parsing and the phase-gate config branch. |
| `scripts/task.sh` | Removed the phase from phase order, validation, verdict handling, iteration mutation, shim logic, and help text. |
| `src/cli/index.ts` | Removed the phase from CLI help phase lists. |
| `tasks/_archive/runtime-validation-phase/done.md` | Added the supersession pointer line. |
| `templates/.canon/README.md` | Mirrored `.canon/README.md`. |
| `templates/.canon/templates/handoff.md` | Mirrored `.canon/templates/handoff.md`. |
| `templates/.canon/templates/status.json` | Mirrored `.canon/templates/status.json`. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirrored `.claude/skills/canon-pipeline/SKILL.md`. |
| `templates/.claude/skills/canon-status/SKILL.md` | Mirrored `.claude/skills/canon-status/SKILL.md`. |
| `templates/AGENTS.md` | Mirrored canon-fenced `AGENTS.md`. |
| `templates/CLAUDE.md` | Mirrored canon-fenced `CLAUDE.md`. |
| `templates/CODEX.md` | Mirrored canon-fenced `CODEX.md`. |
| `templates/docs/pipeline-orchestrator.md` | Mirrored `docs/pipeline-orchestrator.md`. |
| `tests/pipeline-policy.test.ts` | Removed `RUNTIME_CHECKS` assertions. |
| `tests/run-task-canon-snapshot.test.ts` | Removed the phase block from fixtures. |
| `tests/run-task-counter-schema.test.ts` | Removed the phase block from fixtures. |
| `tests/run-task-harness.test.ts` | Removed the phase from derived-status cases. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt goldens after template changes. |
| `tests/run-task-prompts.test.ts` | Removed `runtimeIterations*` fixture fields and added affected-files prompt assertions. |
| `tests/run-task-runtime-validation.test.ts` | Deleted the dedicated runtime-validation suite. |
| `tests/run-task-validation.test.ts` | Added name-status parser tests and legacy status roundtrip tolerance; removed the retired phase-gate test. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The pipeline now moves directly from `implement` to `code_review`. Runtime validation as an orchestrator-owned phase was removed from executable routing, task scaffolding, agent docs, templates, skills, CLI help, and tests. Predicate-gated validation now gets the committed affected-file set in Codex implement prompts, where the agent applies the spec's Validation Required instructions.

Legacy status files remain tolerated: `readStatus()` no longer synthesizes the block, `deriveTopLevelStatus()` ignores it because `PHASE_ORDER` no longer includes it, and `writeStatusToFile()` preserves the unknown key because it serializes the parsed object without shape-filtering.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| `promptImplement()` accepts optional affected-file parameters so `promptImplementResume()` can continue calling it without passing affected files. | AC-22 explicitly says `promptImplementResume()` does not receive this parameter. Optional parameters keep the resume path slim without duplicating the base implement prompt renderer. | None; fresh/revision/reroute call sites pass the affected-files set. |
| `parseNameStatusOutput()` includes both sides of copy rows (`C...`) as well as rename rows. | Existing diff parsing treats copies and renames symmetrically; including both paths is conservative for affected-file predicate evaluation. | None; AC-21 required rename coverage and still passes. |
| Affected-files prompt assertions live in `tests/run-task-prompts.test.ts`, not `tests/run-task-validation.test.ts`. | This is the cleaner prompt-builder test location, and the spec allowed a prompt-builder test file if cleaner. | None; AC-24 is covered by direct prompt render assertions. |
| `docs/product-context.md` also removed the hardcoded test-count claim. | The task changes the unit-test count; keeping a copied number in docs would immediately stale. | None; aligns with docs freshness and code-is-canonical guidance. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `PHASE_ORDER` is `spec → spec_review → plan → implement → code_review → qa → human_review`. |
| AC-2 | Met | Runtime phase import removed from `main.ts`. |
| AC-3 | Met | `getVerdict()` accepts only `spec_review` and `code_review`. |
| AC-4 | Met | Runtime phase extraction and downstream reads removed from `buildPipelineState()`. |
| AC-5 | Met | Dry-run phase branch removed. |
| AC-6 | Met | `runPhase()` no longer dispatches runtime validation. |
| AC-7 | Met | `runtimeIterations*` removed from types, builders, prompts, context, implement revision detection, and tests; grep is clean outside allow-list artifacts. |
| AC-8 | Met | `checkAndRoute()` runtime branch removed. |
| AC-9 | Met | `scripts/run-task/phases/runtime-validation.ts` deleted. |
| AC-10 | Met | `RuntimeCheck` and `RUNTIME_CHECKS` removed from policy. |
| AC-11 | Met | `readStatus()` no longer injects a missing phase block. |
| AC-11a | Met | Runtime parsing and phase-gate config removed from `validation.ts`. |
| AC-11b | Met | Runtime-check imports, failure-entry builder, and render fields removed from prompt builder. |
| AC-11c | Met | Implement revision template no longer renders runtime-check copy; rendered output has no runtime substring. |
| AC-11d | Met | Goldens regenerated with `UPDATE_GOLDENS=1 npm test`; `grep -i runtime tests/run-task-prompts.golden.json` has no output. |
| AC-12 | Met | All `phase_order` jq defs in `task.sh` omit the phase. |
| AC-13 | Met | Null-case shim removed from all jq derivations. |
| AC-14 | Met | `./scripts/task.sh phase retire-runtime-validation runtime_validation done` exits non-zero with the unknown-phase error. |
| AC-15 | Met | Verdict and iteration mutation logic in `task.sh` now covers only `spec_review` and `code_review`. |
| AC-16 | Met | `task.sh` help text no longer lists the phase. |
| AC-17 | Met | `.canon/templates/status.json` no longer has the phase block. |
| AC-18 | Met | `templates/.canon/templates/status.json` mirrors the canonical copy byte-for-byte. |
| AC-19 | Met | Runtime validation handoff guidance removed from both handoff templates. |
| AC-20 | Met | `getAffectedFiles()` added with `git diff <base>...HEAD --name-status -M`; failures/empty output return `[]`. |
| AC-21 | Met | `parseNameStatusOutput()` tests cover empty, modified, renamed, deleted, and binary-modified rows. |
| AC-22 | Met | Fresh, revision, and reroute implement prompts receive affected files; resume does not. |
| AC-23 | Met | Implement prompt templates render the required affected-files section branches. |
| AC-24 | Met | Prompt tests assert empty and non-empty affected-files rendering. |
| AC-25 | Met | Legacy retired-phase status fixture parses, routes from implement to code_review, and preserves the unknown block on write-roundtrip. |
| AC-26 | Met | Validation authority boundary removed from `AGENTS.md`. |
| AC-27 | Met | Handoff step removed and sequence renumbered 1-8; `step [0-9]` search found no stale inline references. |
| AC-28 | Met | Commit ownership now says before `code_review`. |
| AC-28a | Met | Fast/full pipeline diagrams now flow directly from implement to code review. |
| AC-28b | Met | `templates/AGENTS.md` canon fence is byte-identical to root. |
| AC-29 | Met | Runtime phase docs/env row/reroute prose removed from `docs/pipeline-orchestrator.md`. |
| AC-29a | Met | `templates/docs/pipeline-orchestrator.md` is byte-identical to root. |
| AC-30 | Met | `docs/architecture.md` lifecycle and auto-block prose updated. |
| AC-31 | Met | `docs/product-context.md` now points adopters at `.codex/config.toml` and project scripts. |
| AC-32 | Met | `docs/BACKLOG.md` live verdict-source/deepsec entries updated; `RuntimeCheck.cwd` entry retired in place. |
| AC-33 | Met | CLI help strings no longer list the phase. |
| AC-34 | Met | `.canon/README.md` and template mirror include implement validation guidance. |
| AC-34a | Met | README pipeline flow no longer lists the phase. |
| AC-34b | Met | Root `CLAUDE.md` and `CODEX.md` runtime references removed. |
| AC-34c | Met | `templates/CLAUDE.md` and `templates/CODEX.md` canon fences are byte-identical to root. |
| AC-34d | Met | Canon pipeline/status skills and mirrors no longer contain runtime references. |
| AC-35 | Met | `tests/run-task-runtime-validation.test.ts` deleted. |
| AC-36 | Met | Listed fixture phase blocks removed. |
| AC-37 | Met | Runtime phase-gate test removed. |
| AC-37a | Met | Pipeline-policy test no longer imports/asserts `RUNTIME_CHECKS`. |
| AC-37b | Met | Prompt tests no longer contain `runtimeIterations`. |
| AC-38 | Met | Supersession pointer added after the archived task H1. |
| AC-39 | Met | Structural grep matches only allow-list paths; grouped counts are in Validation Outcomes. |
| AC-40 | Met | `npm run lint`, `npm run type-check`, `npm test`, and `npm run build` pass. Baseline `dev` test count was 237; current count is 232 (231 pass, 1 skipped), a non-zero delta. |

## Edge Cases Considered

- Legacy status files with an extra retired phase block are preserved on write but ignored for routing.
- First implement pass with no branch commits renders the full-default validation branch.
- Rename parsing includes both old and new paths, preventing predicate false negatives.
- Template mirrors were checked with whole-file diffs or canon-fence diffs according to ownership.
- The structural grep test fixture avoids literal retired phase tokens so tests themselves do not violate AC-39.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed with no output after the command banner. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` passed. |
| `npm test` | Pass | Current suite: 232 tests, 231 pass, 1 skipped, 0 fail. Baseline `dev` suite checked in a temporary local clone: 237 tests, 237 pass. Net test-count delta: -5. |
| `npm run build` | Pass | `tsup` built `dist/cli/index.js` successfully. |
| `UPDATE_GOLDENS=1 npm test` | Pass | Used as the golden update workflow; regenerated `tests/run-task-prompts.golden.json`. |
| `grep -i runtime tests/run-task-prompts.golden.json` | Pass | No output. |
| Mirror diffs | Pass | Whole-file mirrors and canon-fenced root/template docs all diff cleanly. |
| `./scripts/task.sh phase retire-runtime-validation runtime_validation done` | Pass | Exited non-zero with `Error: invalid phase 'runtime_validation'. Must be one of: spec, spec_review, plan, implement, code_review, qa, human_review`. |
| Custom: `git grep -nE 'runtime[_-]validation\|RUNTIME_CHECKS\|RuntimeCheck\|runtimeValidation\|Runtime Validation\|runtimeIterations'` | Pass | Remaining matches are allow-list only: `CHANGELOG.md` 3, `docs/BACKLOG.md` 4, `docs/decisions.md` 4, `docs/lessons-learned.md` 4, `docs/pipeline-invocations.md` 13, `docs/task-quality-log.md` 2, `tasks/_archive/**` 294, `tasks/retire-runtime-validation/**` 180. |
| E2E | N/A | Spec marks E2E N/A because canon-ai has no UI. |

## Runtime Validation Outcomes

> Authored by the orchestrator after Codex's implement phase. Codex did not run these checks.

| Check | Result | Elapsed | Notes |
|---|---|---|---|
| `orchestrator-phase-smoke` | Pass | 0.0s | exit code 0 |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch current with `origin/<base>` was not checked here; pipeline orchestrator owns branch sync/commit/push for this phase.
