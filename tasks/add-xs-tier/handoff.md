# Implementation Handoff: add-xs-tier

> Author: Codex | Spec: `tasks/add-xs-tier/spec.md` | Plan: `tasks/add-xs-tier/plan.md`

## Changes

| File | What Changed |
|---|---|
| `scripts/pipeline-policy.ts` | Added `XS` to `TaskSize`, `SIZE_ORDER`, budget table, loop defaults, Codex/Claude matrices, fast-tier routing, plan-collapse routing, and the `maxSize` floor; updated policy comments to the XS fast-tier / S+ full-tier invariant. |
| `tests/pipeline-policy.test.ts` | Added XS routing, matrix, budget, loop-cap, helper, and empty-input coverage; flipped S to full-tier expectations. |
| `tests/run-task-reroute-preflight.test.ts` | Added `XS` to the reroute fixture type and moved the fast-tier reroute fixture from S to XS. |
| `tests/run-task-safety.test.ts` | Moved the two fast-tier spec-gate fixtures from S to XS. |
| `.claude/skills/canon-spec/SKILL.md` | Added inline→XS→S size guidance, shifted light/grill split to XS vs S+, updated bug-fix and full-tier guidance. |
| `docs/pipeline-orchestrator.md` | Updated tier definitions, sizing fields/guide, Codex matrix, env-var size bands, spec-gate timing, loop caps, reroute guidance, and spec-review references to XS fast tier and S+ full tier. |
| `docs/product-context.md` | Updated glossary and tier summary for XS fast tier, S+ full tier, and the new valid size set. |
| `docs/decisions.md` | Rewrote the fast-tier decision around XS and added the inline→XS→S boundary decision. |
| `docs/architecture.md` | Updated the `task_size` enum to `XS | S | M | L | XL`. |
| `.canon/templates/spec.md` | Updated the bug/flake fast-tier rule-of-thumb from S to XS. |
| `scripts/run-task/prompts/templates/spec.md` | Updated the runtime spec prompt fast-tier rule-of-thumb from S to XS. |
| `scripts/run-task/prompts/templates/spec-revision.md` | Updated the runtime spec-revision prompt fast-tier rule-of-thumb from S to XS. |
| `.claude/skills/canon-spec-review/SKILL.md` | Updated full-tier and fast-tier membership wording and the size placeholder to include XS. |
| `.claude/skills/canon-pipeline/SKILL.md` | Updated pre-flight and reroute tier guidance for XS fast tier and S+ full tier. |
| `.claude/skills/canon-inline-review/SKILL.md` | Removed the old "XS = inline/below-pipeline" terminology. |
| `.claude/skills/canon-status/SKILL.md` | Updated the loop-cap warning band to `XS/S/M`. |
| `scripts/run-task/cli.ts` | Updated `canon run` help text for XS fast tier and S+ full-tier reroute. |
| `src/cli/index.ts` | Updated top-level CLI reroute help for XS fast tier and S+ full-tier reroute. |
| `README.md` | Updated public tier/reroute descriptions and inline-review wording to avoid the old XS collision. |
| `dist/cli/index.js` | Rebuilt CLI bundle after source/help changes. |
| `dist/scripts/run-task.js` | Rebuilt orchestrator bundle after policy/help/prompt changes. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt golden after runtime prompt template changes. |
| `templates/docs/pipeline-orchestrator.md` | Synced canon-managed mirror. |
| `templates/.canon/templates/spec.md` | Synced canon-managed mirror. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Synced canon-managed mirror. |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Synced canon-managed mirror. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced canon-managed mirror. |
| `templates/.claude/skills/canon-inline-review/SKILL.md` | Synced canon-managed mirror. |
| `templates/.claude/skills/canon-status/SKILL.md` | Synced canon-managed mirror. |

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

Implemented XS as the new fast-tier floor while preserving every existing S/M/L/XL model, effort, budget, and loop value. S now routes through the full pipeline with its existing medium-effort cells. The docs and shipped guidance were updated in the same pass so the public invariant is consistent: XS is the smallest pipeline task, S+ is full tier, and inline/below-pipeline work is no longer called XS.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Changed `.claude/skills/canon-spec/SKILL.md` "Topics to work through for M+" to "full-tier tasks." | S is now full tier, so leaving M+ would understate the grill path even though the explicit grill split was fixed. | Supports AC-13/AC-18; no negative impact. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `TaskSize` is `XS | S | M | L | XL`; `grep -n "type TaskSize"` verified. |
| AC-2 | Met | `SIZE_ORDER` is `['XS', 'S', 'M', 'L', 'XL']`; grep verified. |
| AC-3 | Met | `BUDGET_BY_SIZE` includes `XS: '5.00'`; S/M/L/XL budget values are unchanged. |
| AC-4 | Met | `defaultMaxReviewLoops('XS')` returns 3; test coverage added. |
| AC-5 | Met | Codex `spec_review` and `implement` XS rows clone S; S rows remain present. |
| AC-6 | Met | Claude `spec`, `plan`, `qa`, and `code_review` matrices include XS rows cloning S. |
| AC-7 | Met | `detectTier` is fast only for all-XS non-delicate bundles; tests cover XS, S, mixed XS/S, and delicate XS. |
| AC-8 | Met | `isPlanCombined` is true only for non-delicate XS; tests cover XS, S, delicate XS, M, and XL. |
| AC-9 | Met | `maxSize` seeds at XS; tests cover all-XS nominal/effective XS and delicate XS effective XL. |
| AC-10 | Met | `getPipelinePolicy` table tests cover XS fast policy and S full policy, including matrix resolution. |
| AC-11 | Met | Policy comments name XS fast tier, S+ full tier, XS/S/M loop cap, and XS/S/M/L review band; historical old-caps note left unchanged. |
| AC-12 | Met | Policy tests gained XS cases and S full-tier assertions; `npm test` passed. |
| AC-12b | Met | Exactly the three tier-dependent non-policy fixtures moved from S to XS; other S fixtures were left alone. |
| AC-13 | Met | `canon-spec` skill includes inline→XS→S guidance and shifts light/grill split to XS vs S+. |
| AC-14 | Met | `docs/pipeline-orchestrator.md` reflects XS fast tier, S+ full tier, updated matrix, env-var bands, gate timing, reroute, and spec-review references. |
| AC-15 | Met | `docs/product-context.md` glossary and tier section updated. |
| AC-16a | Met | Existing `docs/decisions.md` fast-tier entry rewritten around XS and S+ spec_review membership. |
| AC-16b | Met | Added `docs/decisions.md` entry for inline→XS→S boundary. |
| AC-17 | Met | `docs/architecture.md` size enum updated to `XS | S | M | L | XL`. |
| AC-18 | Met | Family A/B/D structural gates returned zero matches; Family C positive surfaces verified. |
| AC-19 | Met | Worklist surfaces updated across policy, tests, docs, skills, CLI help, README, prompt templates, and inline terminology. |
| AC-20 | Met | `npm run build` passed and regenerated `dist/cli/index.js` and `dist/scripts/run-task.js`; final clean `dist/` diff is post-commit/orchestrator territory. |
| AC-21 | Met | `UPDATE_GOLDENS=1 npm test` passed and regenerated `tests/run-task-prompts.golden.json`; plain `npm test` then passed. |
| AC-22 | Met | `npm run sync-templates` and `npm run sync-templates:check` passed; only managed mirrors changed. |
| AC-23 | Met | `npm run lint`, `npm run type-check`, and `npm test` all passed. |

## Edge Cases Considered

- All-XS bundles now report nominal/effective XS instead of silently flooring to S.
- Delicate XS still promotes to XL effective size while retaining the XS nominal loop cap.
- S is full tier but keeps its existing medium-effort model rows.
- Historical/telemetry records with old labels were left unchanged per spec exclusions.
- The old "XS = inline" terminology was removed only from live guidance surfaces; legitimate new XS pipeline wording remains.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | `eslint scripts/ tests/ src/` passed. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` passed. |
| `npm test` | Pass | Plain run passed: 896 pass, 1 skipped, 0 fail. |
| `npm run build` | Pass | Built `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| `UPDATE_GOLDENS=1 npm test` | Pass | Passed: 896 pass, 1 skipped, 0 fail; regenerated prompt golden. |
| `npm run sync-templates` | Pass | Synced canon-managed mirrors. |
| `npm run sync-templates:check` | Pass | Reported all canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | Reported all refs OK. |
| Guidance-consistency gate (AC-18) — `rg` sweeps | Pass | Family A, Family B, Family D, and inline-review `XS` greps all returned zero matches. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
