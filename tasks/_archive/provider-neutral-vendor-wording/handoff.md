# Implementation Handoff: provider-neutral-vendor-wording

> Author: Codex | Spec: `tasks/provider-neutral-vendor-wording/spec.md` | Plan: `tasks/provider-neutral-vendor-wording/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `README.md` | Made setup, provider roles, doctor checks, tier descriptions, privacy, and trust-model wording accurate for `mixed` and `claude`; documented the opt-in Claude sandbox and its observed limits. |
| `.canon/README.md`, `templates/.canon/README.md` | Qualified Codex sandbox behavior as mixed-mode and aligned network wording with the user's Codex configuration. |
| `src/orchestrator/cli.ts` | Reworded fast-tier and reroute help to name the phase and implementer role. |
| `src/lib/pipeline-policy.ts` | Reworded the two scope reasons to refer to round records. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt CLI bundles for the wording changes. |
| `tests/cli-args.test.ts` | Added provider-neutral `RUN_USAGE` assertions. |
| `tests/pipeline-policy.test.ts`, `tests/run-task-code-review.test.ts` | Updated expectations and fixtures for the provider-neutral scope reasons. |
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Replaced pipeline role-holder wording and clarified mixed/Claude assignment. |
| `.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md` | Replaced role-holder wording in the spec-review description. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Qualified provider-specific spec-review ownership. |
| `.claude/skills/canon-status/SKILL.md`, `templates/.claude/skills/canon-status/SKILL.md` | Named the implementer as the iterating role. |
| `.canon/templates/spec.md`, `templates/.canon/templates/spec.md` | Changed the reviewer byline to the spec reviewer role. |
| `.canon/templates/spec-review.md`, `templates/.canon/templates/spec-review.md` | Changed the reviewer byline to the spec reviewer role. |
| `.canon/templates/handoff.md`, `templates/.canon/templates/handoff.md` | Changed the author byline to the implementer role. |
| `.canon/templates/review.md`, `templates/.canon/templates/review.md` | Named the implementer in per-round guidance and qualified the cold-Codex lens and dismissal instruction as mixed-mode. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Made role and provider mappings explicit in the operator, tier, matrix, failure, and reroute guidance. |
| `AGENTS.md` | Qualified the Codex role row and cross-review split by provider; documented Claude-mode assignment. |
| `docs/product-context.md` | Replaced vendor-bound glossary and tier wording with roles and mixed-mode qualifications. |
| `docs/patterns.md`, `templates/docs/patterns.md` | Named the implementer role and qualified the Codex spec-review crash as mixed-mode. |
| `templates/docs/task-quality-log.md` | Replaced Codex-specific implementation wording with role-based wording. |
| `docs/codebase-map.md` | Updated template authorship and pitfalls-injection descriptions to name roles. |
| `docs/architecture.md` | Qualified the Codex CLI and matrix to mixed mode and described spec-review and implementation by role/provider. |
| `docs/decisions.md` | Clarified that the earlier backend assignment decision described mixed mode and points to the later Claude assignment. |
| `docs/BACKLOG.md` | Added the 2026-10-31 probe under canon's headless flags and retained network confinement as open work. |

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

Changed provider-dependent user-facing statements to describe the pipeline role first, then state who holds it in each provider mode. Preserved mixed-mode model and lens facts. Documented the Claude sandbox from the observed 2.1.312 run under canon's headless flags, including the network and escape-hatch limitations, without claiming parity with Codex's sandbox.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** Any implementation difference is recorded here.

| Deviation | Rationale | AC impact |
|---|---|---|
| Clarified the 2026-09 backlog probe as a default-permissions result and stated that canon's bypass flags were not tested in that probe. | The new 2026-10-31 probe found that the default-mode network denial does not hold under canon's `--dangerously-skip-permissions` flags; the historical note needed that scope to avoid contradicting the current observation. | AC-9f; no behavior change. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 — `RUN_USAGE` is provider-neutral | Met | No `Codex` in `RUN_USAGE`; fast-tier and reroute role assertions added. |
| AC-2 — Scope reasons are provider-neutral | Met | Old phrase grep is empty; source diff contains only the two requested string replacements; fixtures and generated bundle updated. |
| AC-3 — No unqualified “Codex spec review” | Met | Spec grep returned no unqualified hits. |
| AC-4 — No unqualified Codex role-holder verbs | Met | Spec grep returned no unqualified hits. |
| AC-5 — Artifact templates name roles | Met | Bylines and cold-lens greps returned no unqualified hits; review template states the mixed and Claude lens sets. |
| AC-6 — README setup and doctor statements are conditional | Met | Read Install, Prerequisites, How it works, tier, doctor, and MVP adapter sections; pinned Claude Code floor remains. |
| AC-7 — README trust model covers both providers | Met | Privacy, interactive sessions, mixed-mode Codex sandbox, and Claude-mode permissions are provider-qualified. |
| AC-8 — Docs, skills, and AGENTS.md read correctly under both providers | Met | Reviewed the named sections; provider mappings and mixed-mode model/lens facts are retained. |
| AC-9 — Opt-in Claude sandbox is documented without overclaiming | Met | Settings snippet, opt-in status, version, Bash-only scope, filesystem/network results, and escape-hatch guard are stated. |
| AC-10 — `.canon/README.md` matches README on Codex network | Met | Both root and mirrored text say the network follows the mixed-mode Codex config. |
| AC-11 — Skills are role-based | Met | Reviewed the four skills; fast-tier approval note says “spec review skipped” without naming Codex. |
| AC-12 — Mirrors, refs, and suite are clean | Partial | Build, type-check, lint, template sync, docs refs, and golden-file checks passed. The full unit suite has one reproducible failure outside the Affected Files; see Blockers and Validation Outcomes. |

## Edge Cases Considered

- Checked exact-line qualifiers for mixed-only Codex statements as well as the requested pattern greps.
- Preserved the mixed-mode full Codex implement/spec-review model promotion and the cold-Codex lens's flat mini/high setting.
- Distinguished the opt-in Bash sandbox from Claude's built-in file-edit tools; recorded that `network.allowedDomains` did not confine network under the bypass flags and that `allowUnsandboxedCommands: false` closes the observed escape hatch.
- Preserved pinned README/AGENTS strings and confirmed the prompt golden files are unchanged.

## Blockers

- `[scope]` `npm test` has one reproducible failure in `tests/task-cli.test.ts:1238`, outside this task's Affected Files. The reset-code-review fixture receives the older supervising-checkout scaffold while its expected content comes from the updated worktree template. The isolated test command is recorded in Validation Outcomes. Resolving the worktree template/test path is outside this task's scope, so no out-of-scope file was changed.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| _(none — no red-first ACs)_ | | | | |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Completed successfully. |
| `npm run type-check` | Pass | Completed successfully. |
| `npm test` | Fail – unrelated | Single reported failure at `tests/task-cli.test.ts:1238` (outside the Affected Files). Isolated repro: `node --test --test-name-pattern='task reset-code-review archives prior review' --import ./tests/md-loader-register.mjs --import tsx tests/task-cli.test.ts`; the scaffold/expected-template mismatch is described in Blockers. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/orchestrator/run-task.js`; no other `dist/` paths changed. |
| `npm run sync-templates` | Pass | Updated the ten canon-managed mirrors. |
| `npm run sync-templates:check` | Pass | All canon-managed files are in sync. |
| `npm run docs-refs-check` | Pass | Completed successfully before and after writing this handoff. |
| AC greps (AC-2–AC-5, AC-6c/AC-7a/AC-10) | Pass | All requested grep checks returned no forbidden hits; `using both` occurs only in a mixed-qualified README line. |
| Prompt golden diff check | Pass | `tests/run-task-prompts.golden.json` and `tests/completion.golden.json` are unchanged. |
| E2E | deferred_by_spec | Spec: `Validation Required` — E2E is N/A because there is no UI. |

## Ready for Review

- [ ] All spec ACs met (AC-12 is partial due to the unrelated unit-test failure above)
- [ ] All applicable validation checks pass
- [x] All deviations from plan documented with rationale
