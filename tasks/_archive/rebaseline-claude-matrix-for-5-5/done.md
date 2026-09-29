# Done: rebaseline-claude-matrix-for-5-5

## Summary

Canon's Claude model/effort matrix was last tuned for Opus 4.8 / Sonnet 4.6 and no longer matched the 5.5-generation cost/quality data now that the `opus`/`sonnet` aliases resolve to that generation. This task replaces the old five-column, per-phase matrix with a simpler two-tier model: every phase (spec, plan, code_review) now picks between a *light* model (Sonnet) and a *strong* model (Opus) by task size, capped at `high` effort (no more `xhigh`), while QA stays on the light model at `medium` effort regardless of size. Two new environment variables, `CLAUDE_MODEL_LIGHT` and `CLAUDE_MODEL_STRONG`, let an adopter override each tier without touching the existing per-phase pins (`CLAUDE_MODEL_SPEC`, `_PLAN`, `_REVIEW`, `_REVIEW_LARGE`, `_QA`) or the legacy catch-all `CLAUDE_MODEL`, all of which keep working under a documented precedence order. A duplicate, dead copy of the policy-resolution logic in `src/orchestrator/env.ts` was removed so `src/orchestrator/policy.ts` is the only place that reads `CLAUDE_MODEL*` env vars.

## Files Changed

- `src/lib/pipeline-policy.ts` — new two-tier `claudeMatrix`/`CLAUDE_CELLS` (literal 4×5 table), medium/high effort only, stale comments corrected.
- `src/orchestrator/policy.ts` — resolves pin → tier variable → legacy `CLAUDE_MODEL` → default per cell; empty tier-variable values treated as unset.
- `src/orchestrator/env.ts` — duplicate policy-config block removed; legacy `CLAUDE_MODEL` deprecation message corrected to name the two new tier vars and its true (every-phase) scope.
- `tests/pipeline-policy.test.ts` — full 20-cell coverage for the default matrix, effort bounds, and every override-precedence case and boundary.
- `tests/run-task-harness.test.ts` — the `MAX_REVIEW_LOOPS` validation test retargeted from the removed `env.config.maxReviewLoops` to `policyConfig().maxReviewLoops`, same inputs/assertions.
- `docs/pipeline-orchestrator.md` + `templates/docs/pipeline-orchestrator.md` — new "Claude Model/Effort Matrix" section, env-var rows (including the new `CLAUDE_MODEL_LIGHT`/`_STRONG` and a `CLAUDE_MODEL` legacy row), rewritten tuning sentence.
- `docs/product-context.md` — corrected the stale XL/delicate "Opus at `xhigh`" claim and the fast-tier "lower effort" claim.
- `README.md` — narrowed the `delicate` upgrade description to the phases it actually affects (not QA, not the cold-Codex lens).
- `docs/decisions.md` — new dated entry: "Model-generation re-baseline (2026-09): Claude defaults → 5.5 generation" (table, evidence, precedence, pinned-adopter effort-change note, rollback, supersession of the 1.11.0 QA-effort rule).
- `docs/patterns.md`, `docs/codebase-map.md` — corrected to name `src/orchestrator/policy.ts` as the sole env/policy resolver (these were added to Affected Files via an operator manifest correction after implement flagged the stale guidance as out of scope).
- `dist/orchestrator/run-task.js`, `dist/cli/index.js` — rebuilt bundles (the CLI bundle changed too because it imports the shared, now-trimmed `env.ts`; also added to Affected Files by the same manifest correction).

## How to Test

1. Preview (dry-run) a pipeline run for a small task — spec, plan, and code review should use the light (Sonnet) model at medium effort.
2. Preview a medium task — spec, plan, and code review should use the strong (Opus) model at medium effort; QA stays on the light model.
3. Preview a delicate task — spec, plan, and code review should use the strong model at high effort (never higher); QA is unchanged.
4. Set `CLAUDE_MODEL_STRONG` to a different model string and preview the medium task again — spec, plan, and code review pick up that model; QA does not change.
5. Set the old catch-all `CLAUDE_MODEL` and start a preview — a deprecation notice should name the two new tier settings.
6. Read `docs/pipeline-orchestrator.md` — a Claude matrix table should sit beside the Codex one, and each model env var should state which phases/sizes it controls.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final revision. |
| `npm run type-check` | Pass | Final revision. |
| `npm test` (full suite) | Pass | 1,321 passed, 0 failed (latest re-run in handoff Iteration 2; the interim failure caused by the required `env.ts` field removal was resolved once the harness test was retargeted). |
| `node --test … tests/pipeline-policy.test.ts` | Pass | 105/105. |
| `npm run build` | Pass | Both `dist/orchestrator/run-task.js` and `dist/cli/index.js` rebuilt and verified byte-for-byte against a fresh `git archive` build in code review round 2. |
| `npm run sync-templates` / `sync-templates:check` | Pass | Mirror in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `git diff --check` | Pass | No whitespace errors. |

## Human Verification Required

None. The handoff's latest `### Re-run validation` table (Iteration 2) has no `human_pending` or `Fail` rows; the Round 1 `npm test` failure is retained in the earlier table as history, per code review nit N-10, but is superseded by the passing re-run.

**Handoff Validation pre-merge checklist:**
- [ ] Version correct — not applicable to QA; canon-ai's release policy assigns the bump tier at the `/canon-changelog` release step, not here. This is a canon-supplied-default change, which `docs/decisions.md` §"Versioning and release policy" classifies as **minor**.
- [ ] Changelog updated if needed — draft entry text below; human finalizes wording and version at release.
- [x] PR body current — see `tasks/rebaseline-claude-matrix-for-5-5/pr-body.md`.
- [ ] Final CI/CD checks green — to confirm once the PR is opened; all checks passed locally in the handoff's final re-run.
- [x] Final diff matches spec intent — code review round 2 verdict is "Approved with nits" with all 8 ACs `Met`.

## Decisions Made During Implementation

- **Manifest correction, not a spec rewrite.** When implement found that removing the `env.ts` duplicate config had consequences the spec's Affected Files list missed (a stale test, a second stale bundle, two stale guidance docs), the operator amended the Affected Files table in place (2026-09-29) rather than treating it as new behavior needing a fresh AC. Review round 2 confirmed all four additions are consequences of AC-4, not scope creep.
- **Empty-value handling was left inconsistent between old and new env vars, deliberately.** The two new tier variables (`CLAUDE_MODEL_LIGHT`/`_STRONG`) treat an empty string as unset (`||`); the five pre-existing per-phase pins and legacy `CLAUDE_MODEL` keep their pre-task behavior of passing an empty string through (`??`). Normalizing the old ones would be a behavior change the spec's Non-Goals didn't authorize ("no deprecation or removal of the existing per-phase `CLAUDE_MODEL_*` pins"), so code review round 2 left this as an accepted nit (N2-2) rather than a blocking finding.
- **Budget caps are unchanged even though M/L now cost more per call** (Opus medium vs. the old Sonnet high). This was an accepted Known Risk in the spec, with `CLAUDE_BUDGET` as the escape hatch; review round 2 confirmed it's spec-intended and not a gap.

## Open Questions

- None blocking. Review round 2's `N2-1` through `N2-5` are optional nits (a couple of untested precedence-pair combinations, a wording clarification on the `CLAUDE_MODEL` doc row, a duplicated test title, and two slightly-stale comments) that the reviewer explicitly did not require before shipping.
- Watch M/L Claude invocations after this ships for budget-cap hits, per the spec's Known Risks — no action needed now, just a heads-up for whoever monitors the first releases after this lands.

## Proposed Changelog

### Changed

- **Canon's shipped Claude model and effort defaults move to the 5.5 generation, collapsed into two tiers.** Without an override, `spec`, `plan`, and `code_review` now pick between a *light* model (`sonnet`) and a *strong* model (`opus`) by task size — light for XS/S, strong for M and above — capped at `high` effort; nothing runs at `xhigh` anymore. `qa` stays on the light model at `medium` effort at every size, since it only writes `done.md` and quality-log data and never gates the pipeline. Two new env vars, `CLAUDE_MODEL_LIGHT` and `CLAUDE_MODEL_STRONG`, override each tier's model without touching effort. The existing per-phase pins (`CLAUDE_MODEL_SPEC`, `_PLAN`, `_REVIEW`, `_REVIEW_LARGE`, `_QA`) and the legacy catch-all `CLAUDE_MODEL` keep working, in that precedence order (pin, then tier variable, then legacy, then default) — but a pin now replaces only the model, never the effort. An adopter who previously pinned `CLAUDE_MODEL_REVIEW=sonnet` or `CLAUDE_MODEL_PLAN=sonnet` to get a specific model will see M/L review or plan effort drop from `high` to `medium`, since effort now always comes from the size/tier cell rather than the old per-model table.

## Maintenance

- `docs/lessons-learned.md` has 8 entries; no sweep signal needed yet (threshold is ~15).

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Two-round code review (changes_requested → approved_with_nits); round-1 blockers were spec-scope gaps (stale test/bundle/docs) fixed by an operator manifest correction, not implementation defects.
