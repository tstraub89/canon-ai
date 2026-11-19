# Implementation Handoff: codex-config-models-effort

> Author: Codex | Spec: `tasks/codex-config-models-effort/spec.md` | Plan: `tasks/codex-config-models-effort/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts` | Shared Codex effort set/type, typed per-size implement overrides, and medium/high/high/xhigh/high defaults; other cells unchanged. |
| `src/orchestrator/docs-freshness.ts` | Independent Codex section parser/loader; shared parser recognizes but does not validate Codex settings. |
| `src/orchestrator/policy.ts` | Env-only model snapshot; fresh main-checkout Codex settings merged below env and above defaults; once-per-process unknown-key warning. Optional root injection for tests. |
| `src/orchestrator/main.ts` | Main-checkout startup validation, including dry-run; plain ship skips it. |
| `src/cli/commands/doctor.ts` | Separate Codex config check using the resolved main checkout. |
| `src/orchestrator/agents/codex.ts` | Effort telemetry, shared effort-set re-export, revised invalid-effort error, and cold-review model/effort log. |
| `src/orchestrator/agents/claude.ts` | Resolved effort on session metrics and dash on sub-agent metrics. |
| `src/orchestrator/types.ts` | Required MetricEntry effort field. |
| `src/orchestrator/metrics.ts` | Escaped trailing effort cell and ten-column skeleton with explanatory notes. |
| `src/orchestrator/env.ts` | Retired effort-variable warning points to config. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt generated bundles. |
| `docs/pipeline-invocations.md`, `templates/docs/pipeline-invocations.md` | Effort header/separator/notes; historical invocation rows unchanged. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Defaults, settings, precedence, root/reload rules, validation, ship exemption, telemetry compatibility, and retained max compatibility note. Managed mirror regenerated with sync. |
| `.canon/README.md`, `templates/.canon/README.md` | Codex config example and operator reference. Managed mirror regenerated with sync. |
| `README.md` | Configuring Codex subsection, doctor coverage, and qualified docs-freshness root/error statements. |
| `docs/decisions.md` | New decision with measurement table and judgment limits; superseded notes on historical decisions. |
| `docs/product-context.md` | Current implement defaults and configuration mechanism. |
| `docs/codebase-map.md` | Config/policy and effort telemetry descriptions. |
| `docs/architecture.md` | Effort telemetry and main-checkout Codex exception. |
| `docs/patterns.md` | Pure-policy inputs include Codex config values. |
| `tests/pipeline-policy.test.ts` | Literal defaults, distinct effort overrides, partial fallback, delicate/bundle routing, unchanged sibling cells, and spawned model-precedence cases for both tiers. |
| `tests/docs-freshness.test.ts` | Codex validation shapes/messages, supported efforts, unknown keys, independent parsing, and file-loading cases. |
| `tests/run-task-codex-config.test.ts` | New main/worktree, reread, startup/provider, mid-run isolation, warning-once, actual backend-spawn model routing, and ship/archive regressions. |
| `tests/metrics.test.ts` | Effort helper value, ten-cell row assertions, skeleton/template parity. |
| `tests/claude-subagent-metrics.test.ts` | Ten cells, resolved session effort, dash sub-agent effort. |
| `tests/run-task-code-review.test.ts` | Cold-review log, successful/failed/rejected effort cells, explicit caller effort, updated error-contract assertions. |
| `tests/agent-backend.test.ts` | L implement default is xhigh. |
| `tests/cli.test.ts` | Separate doctor results and ten-column upgrade headers preserving legacy rows. |
| `tests/run-task-ship-docs-fold.test.ts` | Main JSON read expectation, explicit metric effort, and legacy nine-column fragment under ten-column shared header. |
| `tests/run-task-safety-routing.test.ts` | Inline JavaScript caller supplies effort and asserts its trailing cell. |
| `tasks/codex-config-models-effort/notes.md`, `tasks/codex-config-models-effort/handoff.md` | Implementation observations and handoff evidence. |

## Canon Governance

Authoritative provenance remains in `tasks/codex-config-models-effort/status.json`, under canon.

| Field | Source |
|---|---|
| Upstream repo | canon.upstream_repo |
| Upstream commit | canon.upstream_commit |
| Orchestrator commit | canon.orchestrator_commit |
| Codex CLI | canon.codex_cli |
| Claude Code | canon.claude_code |
| Canon version | canon.canon_version |

## Intent & Rationale

Keep operator tuning separate from task content. Only startup and Codex resolution read the main-checkout Codex section. Claude, sizing, loop caps, and active-checkout docs/ship loads retain their existing paths. Env precedence is preserved by keeping built-in model fallbacks out of the import-time snapshot and applying them after freshly loaded config.

Telemetry records the effort consumed by each invocation instead of reconstructing it from the installed version. Older rows remain untouched. No dependencies, task-state schema, repository config, or changelog changed.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Implement defaults remain literal in the five matrix cells instead of a separate default map. | Keeps each cell explicit and avoids a second size-index lookup; optional overrides still use the exact size key. | None; AC-1/2 pinned with literal tests. |
| PolicyConfig effort overrides use the shared CodexEffort union instead of string. | Both parser and pure policy share the validated value type. | None; tighter type safety. |
| The existing ship helper was not edited. | Its nine-cell fixture rows intentionally exercise legacy compatibility; the new fold regression directly combines a legacy header/row with the ten-column shared header. | AC-10 covered without incidental fixture churn. |
| Read and JSON parse errors use separate descriptive clauses. | Distinguishes inaccessible files from malformed JSON while retaining main-checkout/Codex remediation and the existing JSON-error phrase. | None. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Literal XS/S/M/L/XL implement expectations in `tests/pipeline-policy.test.ts`; spawned wrapper checks include built-in mini/full defaults. |
| AC-2 | Met | Distinct per-size efforts, partial defaults, delicate S selecting XL, largest-member and delicate-member bundles. |
| AC-3 | Met | All-low implement overrides leave both other Codex rows and every Claude phase/size cell unchanged. |
| AC-4 | Met | Six spawned precedence cases per tier; actual spec-review, implement and cold-review backend invocations capture cfg-mini/cfg-full in CLI argv. |
| AC-5 | Met | Real main/worktree fixture selects main values, sees a subsequent uncommitted main edit, ignores invalid worktree Codex settings; startup and the shared loader used by spec/QA/validation accept that worktree section. |
| AC-6 | Met | Parser rejects each named shape with key/value/allowed shape; startup/dry-run tests reject ultra before state changes in mixed and Claude modes; doctor fails Codex while docs freshness passes. Unknown-key warning occurs once. |
| AC-7 | Met | Main config becomes invalid after a good resolution; Claude, nominal/effective size and loop cap still resolve before the next Codex lookup exits with the exact bad-key/value message. |
| AC-8 | Met | Invalid main Codex settings survive plain ship through successful archive. |
| AC-9 | Met | Ten-cell metric assertions cover session, sub-agent, successful/failed cold review and rejected effort; skeleton/template/header notes agree. Every source/test caller supplies effort, including the subprocess string. |
| AC-10 | Met | Upgrade and header-only tests preserve nine-cell rows byte-for-byte; fold appends a legacy fragment unchanged under the new header. |
| AC-11 | Met | Cold review console capture requires the Model/Effort line. |
| AC-12 | Met | Parser bounds and shared-loader tests keep top-level claude unknown and avoid validating worktree Codex sections. |
| AC-13 | Met | Config/default/root/telemetry docs updated; specified historical decisions explicitly superseded; no stale live implement contract remains. |
| AC-14 | Met | Error assertions require bug attribution, local TOML override explanation, no source path, and no not-configurable claim. |
| AC-15 | Met | Pure-policy grep finds no fs, process.env or readFile; config arrives as input. |

## Edge Cases Considered

- Missing file/section, empty maps, partial values, null/array/scalar objects, whitespace-only models, unknown/lowercase size keys, and every supported effort.
- A malformed main JSON file cannot provide trustworthy Codex settings even when the active worktree file is valid; it fails on startup/Codex resolution. Plain ship still requires valid JSON for its existing docs/ship loader.
- Deprecated model env values continue to beat config; retired effort env vars remain ignored.
- Warning deduplication does not cache settings: valid and invalid main edits are observed on subsequent Codex lookups.
- Model-specific effort support is deliberately not validated. Configuring max can still fail in Codex; the existing verified CLI/model note remains.
- Release follow-up: document the default changes/config surface and mixed-width telemetry headers, including rows folded before upgrade. Changelog work is excluded by the spec.

## Blockers

- [ambiguity] Does the ship exemption include the combined --ship --dry-run form? Chosen interpretation: plain ship skips Codex reads; combined ship/dry-run validates because dry-run resolves agent configs. This follows the plan's explicit predicate and the existing provider-pin precedent. Ordinary dry-run and plain-ship behavior are tested; the combination uses the same startup predicate and is documented. No work was held for clarification.
- No scope or pipeline blockers. Git staging/commits/pushes remain owned by the orchestrator; no repository git state was mutated by this phase.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| None required — feature/default change | N/A | N/A | N/A | N/A |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | Copied current `tests/pipeline-policy.test.ts` into an isolated git-archive copy of base eb9a2d4a80b03ae502c2db0cf71f0231afac496a; ran the Node test runner with pattern “codex matrix: implement” or “implement effort overrides”. Five failures showed old xhigh/max defaults and ignored low override; unchanged XL passed. Same six assertions pass on current source. Precedence tests assert distinct env/legacy/config literals; backend-spawn tests inspect actual model argv; root tests require main-mini/minimal then edited-mini/low; mid-run/startup tests require the invalid M/ultra message; parser tests require each key, offending value and allowed shape. Those assertions fail if loading/merging/validation is removed. Unchanged-cell/ship/shared-loader cases are deliberate regression guards. Metric tests require ten cells and exact high/medium/dash/ultra values, override-file tests assert the suffix, cold-log test captures its exact format, and upgrade/fold tests require the new header while preserving literal legacy bytes. New header assertions fail against the old skeleton. Final focused run: 226/226; additional metric/log/legacy/root/override selection: 8/8; stronger main-JSON reason assertion: 2/2. |
| Restatement sweep | Ran git grep across tracked files, including hidden managed files and templates, excluding changelog, tasks, historical invocation rows and generated dist, for not configurable, no equivalent knob, no effort override, install previous canon release, fixed phase matrix, mini/max, implement mini/xhigh and CODEX_EFFORT. Updated current in-scope hits and the required historical supersession notes. Remaining release rollback statements concern unchanged spec-review/cold-lens/Claude behavior; the negative error assertion is intentional. Also read every recordMetric call from rg across src/tests, including string-embedded JavaScript and the typed entry helper. No out-of-scope contract edits were needed. The adopter markdown test in `tests/docs-refs-check.test.ts` exposed an optional-config link issue; fixed the in-scope doc without editing that test. Historical rows in `docs/pipeline-invocations.md` were compared byte-for-byte to HEAD and remain identical. |
| Sibling parity | Traced backend resolveConfig into normal/resumed spec-review and implement, cold review, fix-ups/retries and dry-run; all use getCodexConfig. Read shared config consumers in `src/orchestrator/phases/spec.ts`, `src/orchestrator/phases/qa.ts`, `src/orchestrator/validation.ts` and `src/orchestrator/main.ts`: all still use the shared loader that ignores Codex content. Claude/size/cap getters retain policyConfig without section I/O; mid-run test verifies this. Startup validates both providers; plain ship is explicitly exempt. Doctor uses resolveProjectRoot and reports Codex separately. Metrics cover both agents, sub-agents, failed sessions and cold-review rejection. Managed doc pairs are synchronized; standalone telemetry scaffold and runtime skeleton match. |

## Validation Outcomes

All required checks ran on Node v24.21.0. Initial implementation-test failures were corrected; results below are final runs.

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Both declared dist bundles rebuilt after the final source edit. |
| `npm run type-check` | Pass | Final run includes the strengthened JSON-root assertion. |
| `npm run lint` | Pass | Type-aware lint with warnings denied; no suppressions added. |
| `npm test` | Pass | Full suite: 2,246 tests, 2,245 passed, zero failed, one skipped; 95.4 seconds. Additional two-case root assertion rerun passed after strengthening its message expectation. |
| `npm run docs-refs-check` | Pass | All refs OK; rerun after writing this handoff as well. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| Focused policy/parser/root/backend/metrics suite | Pass | 226 passed, zero failed. |
| Selected telemetry/log/upgrade-fold/root checks | Pass | Eight selected tests passed; adopter markdown regression also passed after the link correction. Upgrade coverage additionally ran in the full suite. |
| Scope/history/purity/diff checks | Pass | Changed files are within spec scope or this task's own artifacts; historical rows identical; managed mirrors byte-equal; pure-policy grep empty; git diff --check clean. |

## Ready for Review

- [x] All spec ACs met under the documented combined-flag interpretation.
- [x] All applicable validation checks pass.
- [x] All deviations from plan documented with rationale.
