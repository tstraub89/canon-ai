# Spec: codex-config-models-effort — Codex models and implement effort in .canon/config.json

> Written by: Claude | Review by: spec reviewer
> Status: draft

## Problem

Codex implement reasoning effort is hard-coded in the `implement` row of `codexMatrix()` in `src/lib/pipeline-policy.ts`. The only way to change it is to install a different canon release. v3.15.0 raised it to `xhigh` for XS/S and `max` for M/L.

It was re-measured on 2026-11-18 across canon-ai and one adopter, using non-delicate tasks whose implement runs all used `gpt-6-luna` ("before" is canon < 3.15, "after" is ≥ 3.15). The change doubled time without a measured return at XS/S:

| Size | n before/after | Median total agent time per task | Mean code_review rounds | Tasks rerouted |
|---|---|---|---|---|
| XS | 31 / 26 | 8.8 → 18.9 min (permutation p≈0) | 1.52 → 1.19 | 16% → 8% |
| S | 48 / 35 | 19.9 → 44.5 min (p≈0) | 2.00 → 1.51 (p≈0.08) | 31% → 31% |
| M | 29 / 19 | 61 → 100 min (p≈0.1) | 3.00 → 2.79 | 31% → 37% |
| L | 8 / 18 | not measurable: 13 of 18 after-tasks are one sliced refactor batch | — | — |

Median time outside implementation did not move (XS 2.6 → 2.8 min, S 8.1 → 8.6 min), so fewer review rounds did not offset the slower implementation. The evidence is significant at XS/S only. The M and L changes below are a judgment call, not a measured result.

There are three problems:

1. The XS/S defaults are too expensive for what they buy, and M/L show no sign of paying back.
2. Operators can't tune effort or Codex models per repository without a release. Models have env overrides (`CODEX_MODEL_MINI`/`CODEX_MODEL_FULL`), but those depend on whichever shell launches the run.
3. Effort isn't recorded per invocation. `docs/pipeline-invocations.md` has a Model column but no effort column, so the measurement above had to infer effort from `status.json` `canon.canon_version`. That inference fails once effort is configurable.

## Decision

Make Codex models and Codex implement effort configurable per repository in the adopter-owned `.canon/config.json`, lower the built-in implement effort defaults, and record the resolved effort on every telemetry row.

### 1. Config shape

A new optional top-level `codex` section:

```json
{
  "codex": {
    "models": { "mini": "gpt-6-luna", "full": "gpt-6.2-sol" },
    "implement_effort": { "XS": "medium", "S": "high", "M": "high", "L": "xhigh", "XL": "high" }
  }
}
```

- Every key is optional, and a partial map falls back key by key to the built-in default.
- `models.mini` and `models.full` set the two Codex model tiers. They reach every phase that uses each tier (spec_review, implement, the cold-Codex lens, fix-ups), exactly as `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` do today.
- `implement_effort` sets the effort of the `implement` row only. Its `XL` key also governs delicate tasks, because delicate tasks resolve to the XL cell.

### 2. Precedence

Env var > config > built-in default:

- **Mini model:** `CODEX_MODEL_MINI` → deprecated `CODEX_MODEL_DEFAULT` → `codex.models.mini` → `gpt-6-luna`.
- **Full model:** `CODEX_MODEL_FULL` → deprecated `CODEX_MODEL_DELICATE` → `codex.models.full` → `gpt-6.2-sol`.
- **Implement effort:** `codex.implement_effort.<size>` → built-in cell. No effort env var exists. The retired `CODEX_EFFORT_DEFAULT`/`CODEX_EFFORT_DELICATE` stay ignored with their warning.

### 3. Which file and when

- The `codex` section is read only from the main checkout's `.canon/config.json` (`REPO_ROOT`). It is read in two places:
  - once at orchestrator startup;
  - again each time canon resolves a Codex model/effort (the `getCodexConfig` path).
- An edit on main therefore reaches the next Codex invocation of a task already in flight, committed or not.
- Every other policy lookup stays on the import-time env snapshot and does not read or validate the `codex` section. That covers Claude model/effort, task size and review-loop caps.
- Every existing config load that reads the active checkout (startup `configRoot`, spec, QA, validation and the commit paths) accepts `codex` as a known key without validating it, so a task worktree's copy of the section is never validated and has no effect.
- In worktree mode, a task that edits `.canon/config.json` on its branch cannot change its own Codex settings.
- In a non-worktree task, the main checkout is the task's own working tree, so such an edit does take effect. That is accepted and documented.
- `docs_freshness` and `ship` keep their current root resolution.

### 4. Validation

Validation follows the existing loader's style: hard errors stop the run, and unknown keys warn.

**Hard errors.** Each message names the offending key and value and, where one applies, the allowed set:

- `codex`, `codex.models` or `codex.implement_effort` is not an object.
- `codex.models.mini` or `codex.models.full` is not a non-empty string.
- An `implement_effort` value is not in the allowed Codex effort set (`none|minimal|low|medium|high|xhigh|max`).
- An `implement_effort` key is not one of `XS`, `S`, `M`, `L`, `XL`.

**Warnings.** Any other unknown key under `codex` or `codex.models` produces the same unknown-key warning as elsewhere in the file. The warning is emitted at most once per process, not on every re-read.

**When validation runs:**

- At orchestrator startup, before any agent spawns, including `--dry-run`.
- At each Codex resolution. A bad edit made mid-run stops the next Codex invocation with the same message. Claude phases, size lookups and loop-cap checks are unaffected.

**Exemptions:**

- `canon run --ship` does not validate or read the `codex` section. It spawns no agent, which is the same rule that already exempts provider pins from blocking merge/archive.
- In `claude` provider mode the section is still validated at startup, but it has no effect on any agent.

**Doctor.** `canon doctor` reports the main checkout's `codex` section under its own check, separate from the "Docs freshness" check. Its remediation names the `codex` key to fix and does not suggest deleting the file.

### 5. New built-in implement defaults

| Size | Previous | New |
|---|---|---|
| XS | `xhigh` | `medium` |
| S | `xhigh` | `high` |
| M | `max` | `high` |
| L | `max` | `xhigh` |
| XL/delicate | full model at `high` | unchanged |

All other Codex cells (spec_review, code_review) are unchanged.

### 6. Telemetry

- Every row written to a task's metrics fragment, and therefore to `docs/pipeline-invocations.md` after the fold, gains a trailing `Effort` column.
- `MetricEntry` gets a required `effort` field. Every caller supplies a value:
  - the effort passed to the agent;
  - for a Codex row recorded because its effort was rejected before spawn, the rejected value;
  - `-` where canon passes no effort, which covers Claude sub-agent (`claude:<type>`) rows.
  - Claude session rows log their resolved effort.
- The metrics skeleton header, the scaffold template header and canon-ai's own `docs/pipeline-invocations.md` header gain the column.
- `canon upgrade` already rewrites only the header of an adopter's file, so existing 9-cell rows stay untouched and render with a blank Effort cell. No row migration is shipped.
- The cold-Codex lens also prints the same `Model: … | Effort: …` run-log line the other Codex invocations print.

### 7. Contract sweep

Every statement that Codex implement effort or the Codex models can only be changed by installing a different canon release is replaced with the new config mechanism.

**`docs/decisions.md`:**

- The 2026-10 "Codex implement effort raised; full-model default → GPT-6.1 Sol" entry: its "No effort override" decision, its rollback-by-release Rule, and its note that "the effort cells remain in force" get a "*(Superseded by …)*" note.
- The 2026-11 "Full-model default → GPT-6.2 Sol" entry's statement that effort cells are unchanged gets the same treatment.
- One new decision entry records this change. It covers the evidence table from *Problem*, the statement that the M/L defaults are judgment, the precedence chain, the config-root rule and the `--ship` exemption.

**Other files:**

- The effort-error text in `src/orchestrator/agents/codex.ts`.
- The `CODEX_EFFORT_*` deprecation reason in `src/orchestrator/env.ts`.
- The matrix, env and `max` sections of `docs/pipeline-orchestrator.md`.
- The config docs.

Statements about spec_review effort, cold-lens effort and Claude model/effort remain true and stay unchanged.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Config surface | `.canon/config.json` `codex` section | `CODEX_EFFORT_IMPLEMENT` env var with a size map | Repo-level and the same on every machine, with no collision with the retired `CODEX_EFFORT_*` names. It follows the `ship.merge_method` precedent that repo-level settings live in config. The per-row Effort column, not git history, is the record of what actually ran | `Human` |
| Codex models in config too | Yes, `models.mini`/`models.full` | Effort only | One place for Codex tuning, and two tiers make it a small addition | `Human` |
| Claude models/effort in config | Out of scope | Mirror the Claude precedence chain now | The four-step precedence plus QA exceptions roughly doubles the precedence surface, and nothing about Claude models is under question | `Human` |
| Env vs config precedence | Env, including deprecated fallbacks, wins over config | Config wins, or env removed | Env is the documented per-run override and rollback (`CODEX_MODEL_FULL=gpt-6-sol`), and removing it would be a breaking change | `Human` |
| Config root | Main checkout (`REPO_ROOT`); the worktree copy is never validated or applied | Active checkout, consistent with `docs_freshness` | An edit on main reaches tasks in flight, and in worktree mode a task cannot change its own Codex settings. This is operator policy, not task content | `Human` |
| Read timing | Startup plus every Codex resolution | Startup only | Makes "adjust on the fly" reach a task in flight at its next Codex call | `Human` |
| Validation scope | Only the `codex`-section loader (startup and the `getCodexConfig` path) reads and validates `codex`; shared config loads accept it without validating | Validate in the shared parser and in `policyConfig()` | Putting it in the shared paths would let a `codex` typo stop Claude phases, size lookups, `claude`-mode runs and worktree-copy loads, none of which use it | `Human` |
| `--ship` | Skips `codex` reading and validation | Validate on `--ship` like other startup loads | `--ship` spawns no agent. This follows the existing rule that a bad provider pin must not block merge/archive | `Human` |
| Effort logging | Trailing `Effort` column on every telemetry row | Fold effort into the Model cell, or stamp it in `status.json` | Positions 1–9 are unchanged, so positional readers keep working, and old rows read as "effort unknown", which is accurate | `Human` |
| Adopter migration for the column | None; a heads-up in the release note | A row-migration script | `canon upgrade` already syncs the header, and old rows render with a blank cell | `Human` |
| XL configurable | `XL` key allowed; it governs XL and delicate tasks | Keep XL/delicate fixed | Same mechanism, no reason to withhold it | `Human` |
| New defaults | XS medium, S high, M high, L xhigh, XL high | Full revert to pre-3.15 (XS/S medium, M/L high) | Human's choice of one step down per size. L keeps one notch more than the revert | `Human` |
| Validation strictness | Hard error for a wrong type, an invalid effort or an unknown size key; warning for other unknown keys | Warn on everything and fall back to defaults | Matches the loader's existing style (a bad `ship.merge_method` dies, unknown keys warn). A silently ignored effort setting would corrupt the measurement this task enables | `Author` |
| Effort config scope | `implement` row only | Also spec_review and the cold lens | The evidence is about implement; the other rows have no measured problem | `Author` |
| Effort cell when canon passes none | `-`; a rejected value is logged as-is | Copy the parent session's effort, or leave the cell blank | `-` matches how the table marks other non-applicable cells, and logging the rejected value keeps the failure diagnosable | `Author` |
| Doctor reporting | A separate check for the `codex` section, reading the main checkout | Fold it into the existing "Docs freshness" check | A `codex` error under "Docs freshness" with a "delete the file" hint would mislead | `Author` |
| Spawn-time invalid-effort message | Keep the "bug in canon" attribution and drop "not configurable" | Point the operator at `.canon/config.json` | Config values are validated before resolution, so a config-sourced bad effort can never reach the spawn-time check | `Author` |
| Model × effort compatibility | Not validated; effort is checked against the model-agnostic set only | A per-model allowed-effort table | Canon has no reliable source for per-model support. The docs keep the existing note that `max` is verified only on named CLI/model pairs | `Author` |

## Non-Goals

- **Claude model or effort configuration in `.canon/config.json`.** AC-12 bounds config parsing to the `codex` section.
- **Configurable effort for `spec_review` or the cold-Codex `code_review` lens.** AC-3 pins those cells unchanged.
- **A per-run CLI flag** for model or effort.
- **Reviving `CODEX_EFFORT_DEFAULT`/`CODEX_EFFORT_DELICATE`** or adding any new effort env var.
- **Rewriting or backfilling existing rows** of any `docs/pipeline-invocations.md` or metrics fragment.
- **Validating which efforts a given model or Codex CLI accepts.**
- **Editing `CHANGELOG.md`.** Release notes are written at release time. The release entry must cover:
  - the new defaults (a minor change per `docs/decisions.md` §"Versioning and release policy");
  - the `codex` config section;
  - a heads-up that `docs/pipeline-invocations.md` gains a trailing Effort column on upgrade, with older rows blank;
  - that rows folded before `canon upgrade` runs carry an Effort cell the old header doesn't show yet.
- **Changing canon-ai's own `.canon/config.json`.**

## Acceptance Criteria

- [ ] **AC-1 (defaults).** With no `codex` section and no Codex env vars, `getCodexConfig('implement', …)` resolves:
  - XS → mini/`medium`
  - S → mini/`high`
  - M → mini/`high`
  - L → mini/`xhigh`
  - XL and delicate → full/`high`

  Verified by literal expectations in `tests/pipeline-policy.test.ts`. The old `xhigh`/`max` implement literals are gone from that test's implement rows.
- [ ] **AC-2 (effort config).** A config setting `implement_effort` for some sizes changes exactly those sizes' implement effort and leaves the others at the AC-1 defaults. The fixture uses a distinct value per size, so a wrong-cell lookup shows as a wrong literal. Also verified:
  - a delicate task of nominal size S resolves the `XL` key's value;
  - a bundle resolves the cell of its largest or delicate member, as today.
- [ ] **AC-3 (scope bound).** With a config setting every `implement_effort` key to `low`, the `spec_review` and `code_review` Codex cells still resolve to their current efforts (spec_review XS `medium`, every other spec_review and code_review cell `high`), and the Claude matrix cells are unchanged. Verified by test.
- [ ] **AC-4 (model precedence).** One precedence test per tier covers these cases in a spawned process (env is read at import), using distinct literal values per source (`env-mini`, `legacy-mini`, `cfg-mini`, …). Each case resolves to the first match in Decision §2's chain:
  - only the env var set;
  - only the deprecated env set;
  - only config set;
  - nothing set;
  - env + deprecated + config all set;
  - deprecated + config set.

  One routing test per invocation type (spec_review, implement, cold lens) confirms the config model reaches it.
- [ ] **AC-5 (config root).** In a run-level fixture where the main checkout's `.canon/config.json` and a task worktree's copy set different `codex` values, Codex resolution for an implement invocation in the worktree uses the main checkout's values. Two further checks:
  - A worktree copy with an invalid `codex` section does not fail startup, spec, QA or validation config loads.
  - Changing the main checkout's file between two Codex resolutions in one process changes the second result.

  Verified by test.
- [ ] **AC-6 (validation errors).** Every hard-error case in Decision §4 produces a failure whose message names the key and value, and lists the allowed set where one applies:
  - `codex` not an object;
  - `codex.models` not an object;
  - `codex.implement_effort` not an object;
  - `codex.models.mini` empty;
  - `codex.models.full` not a string;
  - `codex.implement_effort.M` set to `ultra`;
  - `codex.implement_effort.XXL` present.

  Verified by parser tests. The failure occurs at orchestrator startup before any agent spawns (verified with `--dry-run`) and from `canon doctor` (its codex check fails; the "Docs freshness" check is unaffected). An unknown key such as `codex.reasoning` produces the unknown-key warning once, not a failure. Verified by tests.
- [ ] **AC-7 (mid-run edit).** If the main checkout's `codex` section becomes invalid after startup:
  - the next Codex resolution stops with the AC-6 message instead of spawning Codex;
  - a Claude config, size or loop-cap lookup in the same process still succeeds.

  Verified by test.
- [ ] **AC-8 (`--ship` exemption).** `canon run <id> --ship` with an invalid `codex` section in the main checkout proceeds past config loading without a `codex` error. Verified by test.
- [ ] **AC-9 (telemetry column).**
  - Every row `recordMetric` writes has 10 cells, the 10th following Decision §6 (for example `high`, `-` for `claude:<type>` rows, the rejected value for a cold-lens invalid-effort row).
  - `METRICS_SKELETON`, the scaffold template header and canon-ai's own `docs/pipeline-invocations.md` header all end with an `Effort` column, and their descriptive notes mention it.

  - Every `recordMetric` caller in `src/` and `tests/` supplies an effort, including callers embedded in subprocess source strings, which type-check does not see. Today the only such string caller is the `CANON_METRICS_FILE_OVERRIDE` test in `tests/run-task-safety-routing.test.ts`.

  Verified by updated row assertions in `tests/metrics.test.ts`, `tests/claude-subagent-metrics.test.ts`, `tests/run-task-code-review.test.ts` and `tests/run-task-safety-routing.test.ts`, plus a grep for `recordMetric(` across `src/` and `tests/` in which every call site passes an effort.
- [ ] **AC-10 (upgrade compatibility).**
  - `canon upgrade` on a `docs/pipeline-invocations.md` holding 9-cell rows replaces only the header and separator with the 10-column version and leaves every existing row byte-identical.
  - Folding a fragment whose skeleton is still 9 columns into a 10-column file appends its rows unchanged.

  Verified by updating the existing upgrade and fold test fixtures.
- [ ] **AC-11 (cold-lens run log).** A cold-Codex lens invocation prints a `Model: <model> | Effort: <effort>` line in the run log, in the same format `runCodex` prints. Verified by test.
- [ ] **AC-12 (parsing bound).**
  - The `codex`-section loader accepts and validates only `models.mini`, `models.full` and `implement_effort.{XS,S,M,L,XL}`.
  - The shared config loader recognizes the existing `docs_freshness` and `ship` sections plus `codex`, which it accepts without validating.
  - A top-level `claude` key still produces the unknown-key warning.

  Verified by test.
- [ ] **AC-13 (contract sweep).**
  - A repo-wide grep, excluding `CHANGELOG.md`, `tasks/` and `docs/pipeline-invocations.md`, finds no remaining statement that Codex implement effort or the Codex models can only change by installing another canon release, or that implement effort "is not configurable" or has "no equivalent knob".
  - The `docs/decisions.md` entries named in Decision §7 carry "*(Superseded by …)*" notes pointing to the new entry, and the new entry contains the items listed there.
  - `docs/pipeline-orchestrator.md` (and its `templates/` mirror, via sync) documents the `codex` section, the precedence, the config-root and `--ship` rules, the new implement row and the XL-governs-delicate rule, and keeps the `max` CLI/model verification note.
  - Statements that remain true are left as they are: spec_review and cold-lens effort are not configurable, and Claude effort comes only from the matrix.

  The reviewer verifies by grep plus reading each listed doc.
- [ ] **AC-14 (error text).** The spawn-time invalid-effort message:
  - no longer says effort "is not configurable";
  - still attributes the condition to a bug in canon;
  - still states that `~/.codex/config.toml` cannot override it;
  - still contains no `src/` path.

  Verified by the updated assertion in `tests/run-task-code-review.test.ts`.
- [ ] **AC-15 (purity).** `src/lib/pipeline-policy.ts` still performs no I/O and reads no env; config values arrive through `PolicyConfig`. Verified by a grep of that file for `fs`, `process.env` and `readFile` finding nothing new.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/docs-freshness.ts` | Shared loader accepts a top-level `codex` key without validating it. New `codex`-section parser/validator (types, allowed sizes, allowed efforts, unknown-key collection) and a loader for the main checkout's section |
| `src/lib/pipeline-policy.ts` | `PolicyConfig` gains optional per-size implement effort overrides. The `codexMatrix()` implement row uses override ?? new default. Update the rationale comments; the file stays pure |
| `src/orchestrator/policy.ts` | The env snapshot keeps env-only model values (undefined when unset). `getCodexConfig` merges env > fresh `REPO_ROOT` `codex` section > built-in default; other getters keep using the snapshot without reading config |
| `src/orchestrator/agents/codex.ts` | Invalid-effort message text; cold-lens run-log Model/Effort line; pass effort, or the rejected value, into metric rows |
| `src/orchestrator/agents/claude.ts` | Pass resolved effort into session metric rows and `-` into sub-agent rows |
| `src/orchestrator/metrics.ts` | Write the trailing Effort cell. `METRICS_SKELETON` header and notes gain the column |
| `src/orchestrator/types.ts` | `MetricEntry` gains a required effort field |
| `src/orchestrator/env.ts` | The `CODEX_EFFORT_*` ignored-variable reason points to `codex.implement_effort` in `.canon/config.json` |
| `src/orchestrator/main.ts` | Startup validation of the `REPO_ROOT` `codex` section before any agent spawns (including `--dry-run`), skipped for `--ship` |
| `src/cli/commands/doctor.ts` | New check reporting the main checkout's `codex` section validity |
| `dist/cli/index.js` | Rebuilt |
| `dist/orchestrator/run-task.js` | Rebuilt |
| `templates/docs/pipeline-invocations.md` | Header and notes gain the Effort column (must match `METRICS_SKELETON`) |
| `docs/pipeline-invocations.md` | canon-ai's own header and separator gain the Effort column; rows untouched |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Codex matrix implement row, the `codex` config section, precedence, config root, `--ship` exemption, XL-governs-delicate, env table and `max` note updated; mirror via sync |
| `.canon/README.md`, `templates/.canon/README.md` | Document the `codex` section of `.canon/config.json`; mirror via sync |
| `README.md` | Config section documents the `codex` keys; doctor description covers the codex check |
| `docs/decisions.md` | New decision entry, plus superseded notes on the entries named in Decision §7 |
| `docs/product-context.md` | Fast/full tier lines state the new implement cells and that they are configurable |
| `docs/codebase-map.md` | Config loader row mentions the `codex` section; telemetry rows mention effort |
| `docs/architecture.md` | Telemetry description includes effort |
| `docs/patterns.md` | Pure Policy pattern: `policy.ts` passes env and config values into `PolicyConfig` |
| `tests/pipeline-policy.test.ts` | New implement literals, config-override and scope-bound rows, model precedence tests |
| `tests/docs-freshness.test.ts` | `codex`-section parse, error and warning cases; shared loader accepts `codex`; load-result shape |
| `tests/run-task-codex-config.test.ts` | New: run-level tests for AC-5 (main vs worktree), AC-6 startup/`--dry-run` failure, AC-7 mid-run edit, AC-8 `--ship` exemption |
| `tests/metrics.test.ts` | 10-cell rows, skeleton and template header parity, `entry()` helper supplies effort |
| `tests/claude-subagent-metrics.test.ts` | Row length and effort cell |
| `tests/run-task-code-review.test.ts` | Metric-row readers, cold-lens effort row and run-log line, updated error-text assertion |
| `tests/agent-backend.test.ts` | L implement effort `xhigh` |
| `tests/cli.test.ts` | Doctor codex check cases; upgrade header-sync fixtures with 10 columns |
| `tests/run-task-ship-helpers.ts` | Fixture rows tolerate the new header |
| `tests/run-task-ship-docs-fold.test.ts` | Fold of a 9-column fragment into a 10-column file; `recordMetric` call supplies effort |
| `tests/run-task-safety-routing.test.ts` | The `CANON_METRICS_FILE_OVERRIDE` test's inline subprocess `recordMetric` call (a JavaScript string, so type-check cannot flag it) supplies an explicit effort; keep its existing assertion that the override file receives the row, and also assert that the written row ends with that effort cell |

### Implementation Notes (non-binding; plan/implement own these)

- `policy.ts` currently bakes the built-in default model into the import-time snapshot (`CODEX_MODEL_MINI ?? CODEX_MODEL_DEFAULT ?? 'gpt-6-luna'`). A merge of "snapshot, then config" would never reach config. Keep env-only values in the snapshot and apply the default after config.
- `VALID_CODEX_EFFORTS` lives in `src/orchestrator/agents/codex.ts`. The config loader needs it, so moving it to a module both can import without a cycle is likely cleaner than importing from the agent module.
- Tests that resolve Codex config in-process read canon-ai's own `REPO_ROOT` config, which has no `codex` key today. Prefer an injectable config source for tests over relying on that.
- The guardrail retry in `main.ts` resolves config per member and writes no metric row. It needs no change beyond picking up the new resolution.

### Interaction Dependencies

- Every Codex invocation path resolves through `getCodexConfig`: spec_review, implement, the implement and code-review fix-ups, the guardrail retry, the cold-Codex lens, interactive mode and `--dry-run` printing.
- Claude config, size and loop-cap getters share `policyConfig()` but must not read the `codex` section.
- Every active-checkout config load must accept the `codex` key: startup `configRoot`, spec, QA, validation allowlist and base-drift, and the commit paths.
- `canon upgrade` header-only sync of `docs/pipeline-invocations.md`, and the `--ship` telemetry fold.
- `canon doctor` config reporting.

### Data Model Changes

- `.canon/config.json` gains an optional `codex` section. Older canon versions (≥ 3.10) treat it as an unknown top-level key and warn.
- Telemetry rows gain a trailing `Effort` cell, for 10 columns in all.
- `MetricEntry` gains a required effort field.
- `PolicyConfig` gains optional effort overrides.
- No `status.json` change.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — commit the rebuilt `dist/`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] `<E2E>` — N/A, no UI surface

## Docs Impact

The implementer edits these protected docs per Affected Files, since this task may leave them stale:

- `docs/architecture.md`
- `docs/codebase-map.md`
- `docs/patterns.md`
- `docs/product-context.md`
- `docs/decisions.md`
- `docs/pipeline-orchestrator.md`

The only docs-freshness path mapping that applies is `docs/pipeline-orchestrator.md` → its `templates/` mirror.

## Known Risks

- **Wrong-cell lookup (AC-2).** A size map keyed incorrectly could apply S's value to M. Distinct per-size fixture values catch it.
- **Config model never applied (AC-4).** The import-time snapshot already carries the built-in default, so a naive merge makes `codex.models` dead. Another failure mode lets config beat env. The spawned-process precedence cases cover both.
- **Blast radius of a bad edit (AC-5, AC-7).** If validation lands in the shared parser or in `policyConfig()`, a `codex` typo stops Claude phases, `claude`-mode runs, or a task through its worktree copy. AC-5's invalid-worktree-copy case and AC-7's Claude-lookup case catch that.
- **Root confusion (AC-5).** `getActiveCwd()` is the codebase default and `docs/patterns.md` pushes toward it. Using it here would make tasks in flight ignore main-checkout edits. The two-copy fixture catches it.
- **`--ship` blocked by tuning (AC-8).** Startup config loading dies on `!ok`, so the exemption must hold before that check.
- **In-process tests reading canon-ai's own config.** If canon-ai later adds a `codex` section to its own config, literal-pinned tests would break unless the config source is injectable.
- **String-embedded callers escape type-check (AC-9).** A `recordMetric` call inside a subprocess source string compiles regardless of the new required field and would write a row whose Effort cell is empty or `undefined`. AC-9's grep over every call site, plus the row assertion in the override test, covers it.
- **Mixed-width telemetry tables in adopters' repos.** Cosmetic, and documented in the release note. An external tool that asserts exactly 9 columns breaks; canon itself has no such reader.
- **Operator sets `max` on a CLI/model pair that rejects it.** Canon passes it through and Codex fails at spawn. The existing docs note on verified `max` pairs stays.
- **Mid-run malformed config (AC-7).** A task now stops at its next Codex call rather than only at startup. That is intended, and documented for operators who edit config during a run.

## Human Test Plan

1. In a scratch repo with canon installed, do a dry run for a small task with no Codex settings in the canon config file. Expected: the plan shows implement at `high` effort.
2. Add a Codex section setting small-task implement effort to `low`, then dry-run again. Expected: implement shows `low`; spec review and code review effort are unchanged.
3. Set that effort to a nonsense value and dry-run. Expected: it stops immediately with a message naming the bad value and listing the allowed ones. The health check reports the problem under its own Codex check, not under docs freshness.
4. With the nonsense value still in place, ship an already-approved task. Expected: shipping is not blocked by the Codex setting.
5. Fix the value. Set a mini model name in the config, then also set the mini-model environment variable to a different name for one run. Expected: that run uses the environment variable's model; without it, runs use the config's model.
6. Run a real small task through review and open the invocation log. Expected: new rows end with an Effort value; older rows show that cell blank.
7. While a task is between implement and review, change the effort in the main checkout's config. Expected: the next implement run (for example, after review requests changes) uses the new effort.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row (mirror pairs comma-joined), each with a specific change description
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] If this spec replaces existing behavior: replacement framing plus a grep AC (AC-1 implement literals, AC-13 contract sweep)
- [x] Non-Goals rules out the most tempting scope expansions; load-bearing exclusions backed by AC-3 and AC-12
- [x] Symbols named in ACs actually exist in the codebase (grep-verified: `getCodexConfig`, `codexMatrix`, `PolicyConfig`, `policyConfig`, `recordMetric`, `METRICS_SKELETON`, `MetricEntry`, `VALID_CODEX_EFFORTS`, `getActiveCwd`)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — feature/default change
- [x] (Refactors) N/A
- [x] *Judgment Calls* lists every judgment call with strongest alternative and Decided by
