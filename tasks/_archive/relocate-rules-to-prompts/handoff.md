# Implementation Handoff: relocate-rules-to-prompts

> Author: Codex | Spec: `tasks/relocate-rules-to-prompts/spec.md` | Plan: `tasks/relocate-rules-to-prompts/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.canon/templates/done.md` | Repointed changelog scope guidance to `docs/decisions.md`, kept changelog entry-text guidance, and removed the proposed version-bump field per the amendment. |
| `.canon/templates/spec.md` | Inlined the universal validation matrix and protected-docs Docs Impact heads-up rule. |
| `.canon/templates/status.json` | Repointed `_full_send` guidance to `docs/pipeline-orchestrator.md`. |
| `.claude/agents/code-review-anchored.md` | Added anchored-lens code-review rules for handoff diff verification, delicate guards, and git invariant checks. |
| `.claude/agents/code-review-cold.md` | Added a diff-local guard-consistency review rule without spec-aware guidance. |
| `.claude/skills/canon-changelog/SKILL.md` | Rewired release-policy references from `AGENTS.md` to `docs/decisions.md`, inlined canon release discipline where needed, and fixed the frontmatter description to `Versioning and release policy`. |
| `.claude/skills/canon-init/SKILL.md` | Rewired changelog/release guidance to `qa.md` and `docs/decisions.md`. |
| `.claude/skills/canon-pipeline/SKILL.md` | Rewired related references to surviving operator docs. |
| `.claude/skills/canon-spec-review/SKILL.md` | Inlined spec-writing rules of thumb for Agent C. |
| `.claude/skills/canon-spec/SKILL.md` | Inlined spec-writing self-check rules and rewired validation-matrix guidance. |
| `dist/scripts/run-task.js` | Regenerated bundled run-task artifact after prompt/helper edits. |
| `docs/architecture.md` | Made Validation section self-contained as canon-ai command bindings, no longer sourced from `AGENTS.md`. |
| `docs/codebase-map.md` | Documented JIT prompt-rule roles and QA prompt content responsibilities. |
| `docs/decisions.md` | Added the JIT per-phase rule-delivery decision and reconciled the release policy so QA contributes changelog entry text only while the release/changelog step owns bump-tier proposal. |
| `scripts/run-task/prompts/helpers.ts` | Added communication norms and Codex branch-sync/git-workflow guidance to startup constants. |
| `scripts/run-task/prompts/index.ts` | Rewired interrupted-implement resume prompt away from `AGENTS.md` Validation Matrix. |
| `scripts/run-task/prompts/templates/code-review-foreman.md` | Added foreman-scoped code-review rules of thumb. |
| `scripts/run-task/prompts/templates/implement-revisions.md` | Added iteration rules for reverting, cumulative handoff diffs, and deleted-file references. |
| `scripts/run-task/prompts/templates/implement.md` | Added implementation rules and inlined the universal validation matrix. |
| `scripts/run-task/prompts/templates/qa.md` | Inlined release, handoff validation, output format, Docs Freshness, Code-is-Canonical, and Commit Ownership guidance; removed the QA prompt's proposed version-bump ask. |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | Added cross-review and diagnose-before-fix checkpoint guidance for amendment review. |
| `scripts/run-task/prompts/templates/spec-review.md` | Inlined diagnose-before-fix role checkpoints and cross-review rule. |
| `scripts/run-task/prompts/templates/spec-revision.md` | Added spec-writing rules of thumb and the amendment's sensitive-surface escalation trigger list. |
| `scripts/run-task/prompts/templates/spec.md` | Added spec-writing rules of thumb and the amendment's sensitive-surface escalation trigger list. |
| `templates/.canon/templates/done.md` | Synced mirror of `.canon/templates/done.md`. |
| `templates/.canon/templates/spec.md` | Synced mirror of `.canon/templates/spec.md`. |
| `templates/.canon/templates/status.json` | Synced mirror of `.canon/templates/status.json`. |
| `templates/.claude/agents/code-review-anchored.md` | Synced mirror of `.claude/agents/code-review-anchored.md`. |
| `templates/.claude/agents/code-review-cold.md` | Synced mirror of `.claude/agents/code-review-cold.md`. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Synced mirror of `.claude/skills/canon-changelog/SKILL.md`. |
| `templates/.claude/skills/canon-init/SKILL.md` | Synced mirror of `.claude/skills/canon-init/SKILL.md`. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced mirror of `.claude/skills/canon-pipeline/SKILL.md`. |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Synced mirror of `.claude/skills/canon-spec-review/SKILL.md`. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Synced mirror of `.claude/skills/canon-spec/SKILL.md`. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt golden fixture after template changes. |
| `tests/run-task-prompts.test.ts` | Added AC-11 structural relocation coverage for presence tokens, absence tokens, scaffold sweep, and amendment escalation trigger tokens. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Moved the sole-homed rules into the phase surfaces that consume them, keeping the relocation scoped instead of broadcasting all rules everywhere. The implement and spec scaffolds now carry the universal validation matrix directly; QA carries release/docs/output/ownership rules; spec authoring and spec review carry spec-writing rules; code-review surfaces carry only review-specific guidance, with the cold lens remaining spec-blind.

The human-review amendment is implemented as a scoped delta on top of that relocation:
- spec authoring prompts now include the sensitive-surface escalation triggers: auth, billing/payments, privacy/data handling, destructive operations, schema/data-model migrations, and analytics-event changes.
- QA and done surfaces propose changelog entry text only; version number and bump-tier proposal belong to the later release/changelog step and human review.
- the changelog skill description now matches the `docs/decisions.md` heading capitalization.

Remaining `AGENTS.md` / `CLAUDE.md` references in JIT surfaces are not sole-home rule dependencies:
- `helpers.ts` startup lines still tell agents to read `AGENTS.md` as operator/project context; relocated rules now live in the JIT prompts/skills.
- `toResumePrompt()` mentions skipping startup re-reads of `AGENTS.md`; this is a resume optimization, not rule sourcing.
- `canon-init` references `AGENTS.md` / `CLAUDE.md` as files it reads/merges/stages during initialization.
- `canon-spec`, `canon-spec-review`, and `canon-pipeline` references to `CLAUDE.md` are operator-context pointers; the spec-writing/review rules are inlined in their consuming skill or prompt.
- `qa.md` mentions `AGENTS.md` only as a possible permanent-doc promotion target during a human-approved lessons sweep, not as a QA rule source.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Added `scripts/run-task/prompts/index.ts`, which was not in the original spec Affected Files table but was called out in the plan. | `promptImplementResume()` had a hardcoded `AGENTS.md` Validation Matrix reference on a JIT prompt path; leaving it would violate AC-3. | Supports AC-3; no control-flow behavior changed. |
| `tests/run-task-prompts.test.ts` structural file reads use `process.cwd()` instead of `REPO_ROOT`. | In linked worktree runs, `REPO_ROOT` resolves to the supervising checkout; using the active cwd prevents the structural test from reading stale files. | Preserves AC-11 in worktree-isolated tasks. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: coverage / anti-drop | Met | Presence-token grep passed; AC-11 test also asserts the mechanical tokens. Reviewer-only rows are documented in this handoff. |
| AC-2: escalation contract has a home | Met | Spec surfaces carry sensitive-surface/spec-authoring awareness, implement prompt has ambiguity/blocker escalation path, and QA carries notify/human-facing output guidance. |
| AC-3: dangling references rewired | Met | JIT surfaces no longer point to `AGENTS.md`/`CLAUDE.md` for relocated rules; remaining occurrences are justified under Intent & Rationale. |
| AC-4: spec craft rules | Met | `spec.md`, `spec-revision.md`, `canon-spec`, and `canon-spec-review` contain `Name effects to DELETE` and `Prefer positive or structural assertions`. |
| AC-5: code-review craft rules | Met | Foreman and anchored/cold lens charters carry review-scoped rules; cold lens received only diff-local guard consistency guidance. |
| AC-6: `AGENTS.md` / `CLAUDE.md` unchanged | Met | `git diff -- AGENTS.md CLAUDE.md templates/AGENTS.md templates/CLAUDE.md` returned empty. |
| AC-7: `templates/` mirrors synced | Met | `npm run sync-templates:check` passed after syncing managed mirrors. |
| AC-8: anti-broadcast / scoping | Met | Absence-token grep passed: spec surfaces lack code-review signatures, and code-review surfaces lack spec-writing signatures. |
| AC-9: golden fixture | Met | `UPDATE_GOLDENS=1 npm test` regenerated `tests/run-task-prompts.golden.json`; `npm test` passed afterward. |
| AC-10: build artifact current | Met | `npm run build` passed; `git diff --name-only -- dist` reports only `dist/scripts/run-task.js`. |
| AC-11: structural relocation test | Met | Added test in `tests/run-task-prompts.test.ts`; it passed in both golden update and normal `npm test` runs. |
| AC-12: Validation Matrix relocated to both consumers | Met | Matrix row `Migration runner + manual review` appears in `implement.md` and `.canon/templates/spec.md`; `docs/architecture.md` is self-contained as command bindings. |
| AC-13: scaffold zero dependence | Met | `grep -rE 'AGENTS\.md|CLAUDE\.md' .canon/templates/` returned no matches. |
| AC-A1: escalation triggers reach spec templates | Met | `spec.md` and `spec-revision.md` carry auth, billing, privacy, destructive, schema, and analytics triggers; AC-11 asserts the six tokens in both JIT surfaces. |
| AC-A2: QA proposes changelog entry text only | Met | `qa.md` and `done.md` no longer ask QA to propose a version number or bump tier; `docs/decisions.md` assigns bump-tier proposal to the release/changelog step and states QA contributes changelog entry text only. |
| AC-A3: changelog skill description capitalization | Met | `.claude/skills/canon-changelog/SKILL.md` and its mirror use `docs/decisions.md` §"Versioning and release policy" in the description. |

## Edge Cases Considered

- The AC-11 structural test intentionally reads from the active worktree with `process.cwd()` so it validates the edited checkout, not a supervising checkout.
- `code-review-cold.md` avoids spec-aware terms and only adds a diff-local missing-guard pattern, preserving the cold lens purpose.
- `.canon/templates/status.json` points to `docs/pipeline-orchestrator.md` without a non-existent section anchor; docs refs validation passed.
- The AC-A2 grep still finds release-policy statements containing `version bump` in `qa.md` and `docs/decisions.md`; those statements say QA does not pick the version and that changelog/version-bump work happens separately, so they are not contradictory prompts.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Pass | Full suite passed after regeneration, 874 pass / 1 skipped. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK after the handoff rewrite. |
| `npm run build` | Pass | Build succeeded; postbuild normalized `dist/scripts/run-task.js`. |
| `UPDATE_GOLDENS=1 npm test` | Pass | Regenerated `tests/run-task-prompts.golden.json`; suite passed, 874 pass / 1 skipped. |
| E2E | not_configured | Spec marks E2E N/A: no UI surface. |
| AC-1 presence-token grep | Pass | Manual grep verified the relocation presence tokens, including `Migration runner + manual review`. |
| AC-8 absence-token grep | Pass | Manual grep verified anti-broadcast scoping tokens were absent from the wrong surfaces. |
| AC-13 scaffold sweep | Pass | `grep -rE 'AGENTS\.md|CLAUDE\.md' .canon/templates/` returned no matches. |
| AC-6 unchanged agent docs | Pass | `git diff -- AGENTS.md CLAUDE.md templates/AGENTS.md templates/CLAUDE.md` returned empty. |
| AC-10 dist scope | Pass | `git diff --name-only -- dist` returned only `dist/scripts/run-task.js`. |
| AC-A1 escalation-trigger grep | Pass | All six trigger tokens were present in both `spec.md` and `spec-revision.md`. |
| AC-A2 version-bump request grep | Pass | No QA/done surface asks QA to propose/choose/suggest a version or bump tier; benign release-policy mentions explicitly assign that work outside QA. |
| AC-A3 changelog description grep | Pass | The changelog skill description contains `Versioning and release policy`. |

## Ready for Review

- [x] All original and amendment ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
