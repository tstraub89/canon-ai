# Implementation Plan: codex-config-models-effort

> Written by: Claude | Implements: `tasks/codex-config-models-effort/spec.md`

## Approach

The work is a new `codex`-section loader in `src/orchestrator/docs-freshness.ts` that reads only the main checkout (`REPO_ROOT`). `src/orchestrator/policy.ts` merges it in on the `getCodexConfig` path only (env > config > built-in). The pure policy gains optional per-size implement-effort overrides and the new defaults. `main.ts` adds a startup validation call, doctor adds a separate check, and every telemetry row gets a trailing `Effort` cell. Other policy getters keep using the import-time env snapshot and never touch the `codex` section, so a `codex` typo cannot stop Claude phases, size lookups or loop caps.

Spec review was `approved` with no nits.

**Decisions this plan pins (the spec leaves them open):**

1. **`VALID_CODEX_EFFORTS` moves to `src/lib/pipeline-policy.ts`.** A bare `as const` array keeps that file pure (AC-15). `src/orchestrator/agents/codex.ts` imports it and re-exports it under the same name, so existing importers keep working. Leaving it in `agents/codex.ts` would create an import cycle: `policy.ts` → `docs-freshness.ts` → `agents/codex.ts` → `policy.ts`. No new `src/` module is added.
2. **Config injection for tests: an optional `root` parameter, not an env knob.** The new signatures are `loadCodexSection(root)`, `requireCodexSection(root = REPO_ROOT)` and `getCodexConfig(phase, tasks, root = REPO_ROOT)`. Production callers pass nothing. Tests pass a temp directory, or spawn a process whose cwd is a temp directory, which makes `REPO_ROOT` that directory. That keeps in-process tests off `~/canon-ai/.canon/config.json`.
3. **Failure mode: `die()`, not `throw`.** This follows `requireDocsFreshnessConfig` and `runCodex`'s invalid-effort guard. A throw on the dry-run path prints a stack (see the comment above `resolveBundleProvider` in `main()`).
4. **Codex error messages have their own builder.** The shared `invalid()` appends "or delete it to use canon's defaults", which the spec forbids for this section.
5. **An unparseable main-checkout `.canon/config.json` is a hard error on the Codex path.** If the JSON cannot be parsed, the `codex` settings it holds cannot be known, and silently using defaults would corrupt the measurement this task exists for. This also covers worktree-mode runs, where the shared loader reads the worktree copy and never sees main's file. One existing test pins the old behavior and is updated in Step 9. Recorded in `notes.md` with a `[plan]` prefix.
6. **Startup predicate: `!cliArgs.ship || cliArgs.dryRun`.** This mirrors the provider-pin line in `main()`. `--ship --dry-run` takes the dry-run branch, which resolves Codex configs, so it validates. Plain `--ship` skips validation.
7. **`policyConfig()` keeps returning env ?? built-in default.** It never reads config, because Claude, size and loop-cap getters use it and `tests/pipeline-policy.test.ts` asserts on its `codexModelMini`/`codexModelFull`. Only `getCodexConfig` applies env ?? config ?? default. The `??` operator is kept, so an empty-string env var still wins, exactly as today.

**Feasibility check:**

- **Exists:** The following were all found by grep or read:
  - `getCodexConfig`, `policyConfig`, `codexMatrix`, `PolicyConfig`, `VALID_CODEX_EFFORTS` and `invalidCodexEffortMessage`;
  - `recordMetric`, `METRICS_SKELETON` and `MetricEntry`;
  - `parseDocsFreshnessConfig`, `loadDocsFreshnessConfig`, `formatUnknownKeysWarning` and `checkDocsFreshness`;
  - `mergeHeaderOnly` and `foldMetricsFragment`;
  - the test helpers `runReviewLoopMain`, `writeReviewLoopFixture`, `runNodeInline` and `makeBootstrappedTaskWorktreeFixture` (in `tests/run-task-safety-helpers.ts`), and `prepareShipFixture`, `prepareSharedWorktreeShipFixture`, `runCanon` and `writeRel` (in `tests/run-task-ship-helpers.ts`).

  `tests/run-task-codex-config.test.ts` is new. Both helper files are imported, not edited, except `tests/run-task-ship-helpers.ts`, which is in Affected Files.
- **Real path:** Every Codex invocation calls `codexBackend.resolveConfig` → `getCodexConfig` (`src/orchestrator/agents/codex.ts`). That covers `run` (spec_review, implement, the fix-ups and the guardrail retry) and `coldReview`. `printDryRunPlan` in `main.ts` calls `backend.resolveConfig` too. Startup currently loads `loadDocsFreshnessConfig(configRoot)`, where `configRoot` is the worktree in worktree mode and `REPO_ROOT` for `--ship`, and never reads `codex`.
- **Callers:**
  - `getCodexConfig` is called only from `codexBackend.resolveConfig` and `tests/agent-backend.test.ts`. The new parameter is optional.
  - `recordMetric` callers: the code-reading callers are `agents/codex.ts` (three sites) and `agents/claude.ts` (two sites). The test callers are `tests/metrics.test.ts`, `tests/run-task-code-review.test.ts:1232`, `tests/run-task-ship-docs-fold.test.ts:781`, and the string-embedded caller at `tests/run-task-safety-routing.test.ts:768`.
  - `invalidCodexEffortMessage` is used by the `runCodex`/`runColdCodexReview` guards and asserted in `tests/run-task-code-review.test.ts` and `tests/pipeline-policy.test.ts`.
  - The shared `parseDocsFreshnessConfig` is used by `main.ts` (startup, base-drift and commit paths), `validation.ts`, `phases/qa.ts`, `phases/spec.ts` and doctor. Its only change is to accept `codex` as a known key.
- **Tests that can fail:** Each test is listed in the Testing Plan with the input that drives it through the changed path. Two are guards that pass on current code: AC-8, because today `codex` is only an unknown key that warns, and the AC-10 fold-append. Both are labelled as guards. AC-10 also gets one assertion against the real template, which fails before the change.
- **Predicates:** The loader's boundary values are enumerated in Step 2. They include a missing file, a top level that is not an object, `codex` set to `null`, `[]` or a string, whitespace-only and non-string models, a lowercase size key, non-string or empty-string efforts, an empty `implement_effort`, and an unknown key at each level.
- **Scope:** Every file changed below is in the spec's Affected Files. `tests/run-task-safety-helpers.ts`, `src/orchestrator/telemetry-fold.ts` and `src/cli/commands/upgrade.ts` are read or imported but not changed. Header-only upgrade and the fold already behave as AC-10 needs.
- **Async/stateful:** The `codex` section is read synchronously on each Codex resolution, with no cache. The only module state is a per-process "unknown-key warning already printed" flag in `policy.ts`. An editor writing a half-saved file mid-run can make the next resolution die. That is the intended "mid-run malformed config" behavior and is already in the spec's Known Risks.

**Contract-sweep dispositions (AC-13).** These come from a repo-wide grep for "not configurable", "no equivalent knob", "no effort override", "effort … override", "previous canon release", "fixed phase", "xhigh", "implement effort" and `CODEX_MODEL_MINI`. It excludes `CHANGELOG.md`, `tasks/`, `docs/pipeline-invocations.md` and the historical reports `docs/harness-audit-2026-06.md` and `docs/canon-opus48-gpt55-report.md`.

| Hit | Disposition |
|---|---|
| `src/orchestrator/agents/codex.ts` "Effort is not configurable … fixed phase/size matrix" | Change (Step 6) |
| `src/orchestrator/env.ts` `CODEX_EFFORT_*` reason "no equivalent knob" | Change (Step 7) |
| `src/lib/pipeline-policy.ts` implement comment and cells | Change (Step 1) |
| `docs/pipeline-orchestrator.md` §"Codex Model/Effort Matrix": "fixed phase × size matrix", the implement row, "Effort comes only from this matrix; there is no Codex effort environment override", and the M/L-at-`max` sentence | Change (Step 11) |
| `docs/pipeline-orchestrator.md` env table, the `max` paragraph ("install the previous canon release. There is no effort environment override") and the shipped-defaults paragraph | Change (Step 11). No built-in cell uses `max` any more; keep the verified CLI/model note |
| `docs/pipeline-orchestrator.md` line 241 (`spec_review` at `high`) and line 200 (`delicate` row) | Leave; still true |
| `docs/product-context.md` fast/full tier lines | Change (Step 12) |
| `docs/decisions.md` 2026-10 entry: the Decision "No effort override …", the Rule's restore-by-release sentences and "the effort cells remain in force" | Superseded note (Step 12) |
| `docs/decisions.md` 2026-11 GPT-6.2 entry "Effort cells … unchanged" | Superseded note (Step 12) |
| `docs/decisions.md` :232 (already superseded; "no Codex effort environment override exists" is still true), :525 (spec_review restore-by-release), :548 (Claude effort), :655 (cold-lens cells; "no per-phase Codex model override exists" is still true) | Leave |
| README "each worktree reads its branch's copy" and "Malformed config stops runs, including reroute and ship" | Qualify for `codex`: read from the main checkout and skipped by `--ship` (Step 12) |
| `docs/architecture.md` "`.canon/config.json` settings … are read from the active checkout" | Qualify for `codex` (Step 12) |
| `docs/pipeline-orchestrator.md` admitted-docs paragraph "Every form reads the active checkout except `--ship`" | Qualify for `codex` (Step 11) |
| `tests/pipeline-policy.test.ts` implement rows, `tests/agent-backend.test.ts:71` `'max'` and the `tests/run-task-code-review.test.ts:251` comment | Change (Steps 8–9) |
| `tests/run-task-code-review.test.ts` `'max'` acceptance and the interactive `'max'` call | Leave; `max` is still a valid effort |

## Steps

### Step 1: Pure policy — effort set, overrides, new defaults

Files: `src/lib/pipeline-policy.ts`

- Add `export const VALID_CODEX_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;` and `export type CodexEffort = (typeof VALID_CODEX_EFFORTS)[number];`.
- `SIZE_ORDER` is already exported. The loader uses it as the allowed size-key set.
- `PolicyConfig` gains `codexImplementEffort?: Partial<Record<TaskSize, string>>`, optional so existing `TEST_CONFIG` literals still compile. Add a comment: "per-size implement effort overrides from the main checkout's `.canon/config.json` `codex.implement_effort`; the orchestrator validates them before they reach here."
- Add a module constant `DEFAULT_CODEX_IMPLEMENT_EFFORT: Record<TaskSize, string> = { XS: 'medium', S: 'high', M: 'high', L: 'xhigh', XL: 'high' }`.
- In `codexMatrix()`, write the `implement` row as `effort: config.codexImplementEffort?.[size] ?? DEFAULT_CODEX_IMPLEMENT_EFFORT[size]` for each of the five cells. Keep the cells explicit, per Pure Policy; a small `implementEffort(size)` helper is fine. Leave the `spec_review` and `code_review` rows untouched.
- Rewrite the `implement:` rationale comment. It should cover:
  - the defaults are one step down from 3.15 (XS medium, S high, M high, L xhigh), and XL/delicate stays full/high;
  - the 2026-11 re-measurement showed XS/S time roughly doubled with no measured return, and M/L are a judgment call;
  - the row is overridable per size through `PolicyConfig.codexImplementEffort`, whose `XL` key governs delicate tasks;
  - see `docs/decisions.md`.
- Update the file-header comment: "Env-var and config resolution live in orchestrator/policy.ts". Add no imports beyond types, and no `fs` or `process.env` (AC-15).

### Step 2: `codex`-section parser and loader

Files: `src/orchestrator/docs-freshness.ts`

- In `parseDocsFreshnessConfig`, change the known-key list to `['docs_freshness', 'ship', 'codex']`. Do not descend into `codex`. Neither the startup load, spec, QA, validation and commit loads, nor doctor's docs check will then validate or warn on it.
- Add the following, importing `VALID_CODEX_EFFORTS`, `SIZE_ORDER` and the `TaskSize`/`CodexEffort` types from `../lib/pipeline-policy.js`:

  ```ts
  export interface CodexSectionConfig {
      models: { mini?: string; full?: string };
      implementEffort: Partial<Record<TaskSize, CodexEffort>>;
  }
  export type CodexSectionLoad =
      | { ok: true; source: 'defaults' | 'file'; section: CodexSectionConfig; unknownKeys: string[] }
      | { ok: false; message: string };
  export function parseCodexSection(raw: string): CodexSectionLoad
  export function loadCodexSection(root: string): CodexSectionLoad
  ```

- **Message builder.** Add a private `invalidCodex(problem)` that returns:

  `.canon/config.json in the main checkout has an invalid "codex" section: ${problem} Fix that key in the main checkout's .canon/config.json, then re-run.`

  The JSON-parse and read failures use the same prefix: `.canon/config.json in the main checkout could not be parsed, so its "codex" section cannot be read (${err}). Fix the JSON, then re-run.` No message mentions deleting the file. Render values with `JSON.stringify(value)`; `undefined` cannot occur, because only present keys are checked.
- **Predicates.** Return the first error, matching the existing loader's style:

  | Input | Result |
  |---|---|
  | File missing (ENOENT) | `{ ok: true, source: 'defaults', section: { models: {}, implementEffort: {} }, unknownKeys: [] }` |
  | Unreadable (other error) or JSON parse error | Hard error (Decision 5) |
  | Top level not an object | Hard error, `the top level must be a JSON object.` |
  | No `codex` key | `ok`, `source: 'file'`, empty section. Other sections are ignored, even invalid ones. AC-12 bounds parsing to `codex` |
  | `codex` is `null`, an array, a string or a number | `"codex" must be an object (got <json>).` |
  | `codex.models` present but not an object | `"codex.models" must be an object (got <json>).` |
  | `codex.implement_effort` present but not an object | `"codex.implement_effort" must be an object (got <json>).` |
  | `models.mini`/`models.full` not a string, or whitespace-only after trim | `"codex.models.mini" must be a non-empty string (got <json>).` A valid value is stored as given, matching how env model values are passed through |
  | `implement_effort` key not in `SIZE_ORDER` (case-sensitive, so `m` and `XXL` are errors) | `"codex.implement_effort.XXL" is not a task size; allowed: XS|S|M|L|XL.` |
  | `implement_effort` value not a string, or not in `VALID_CODEX_EFFORTS` (including `""`) | `"codex.implement_effort.M" is "ultra"; allowed: none|minimal|low|medium|high|xhigh|max.` |
  | `implement_effort: {}` | `ok`, no overrides |
  | Unknown key under `codex` (e.g. `reasoning`) | `unknownKeys` gets `codex.reasoning` |
  | Unknown key under `codex.models` | `unknownKeys` gets `codex.models.<key>` |

- Build `implementEffort` as a fresh object holding only validated size keys, so no prototype keys or extras are carried.
- `loadCodexSection(root)` reads `path.join(root, DOCS_FRESHNESS_CONFIG_PATH)` with the same try/ENOENT shape as `loadDocsFreshnessConfig`.
- Reuse `formatUnknownKeysWarning` for `codex.*` keys.

### Step 3: Orchestrator policy — merge env > config > default on the Codex path only

Files: `src/orchestrator/policy.ts`

- Change the snapshot to env-only: `codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? null`, with the same pattern for `Full`/`CODEX_MODEL_DELICATE`.
- Export `DEFAULT_CODEX_MODEL_MINI = 'gpt-6-luna'` and `DEFAULT_CODEX_MODEL_FULL = 'gpt-6.2-sol'`.
- `policyConfig()` returns `config.codexModelMini ?? DEFAULT_CODEX_MODEL_MINI`, with the same pattern for full. Its behavior is unchanged and it never reads config.
- Add:

  ```ts
  let codexUnknownKeysWarned = false;
  export function requireCodexSection(root: string = REPO_ROOT): CodexSectionConfig {
      const loaded = loadCodexSection(root);
      if (!loaded.ok) die(loaded.message);
      if (loaded.unknownKeys.length > 0 && !codexUnknownKeysWarned) {
          codexUnknownKeysWarned = true;
          warn(formatUnknownKeysWarning(loaded.unknownKeys));
      }
      return loaded.section;
  }
  export function codexPolicyConfig(section: CodexSectionConfig): PolicyConfig {
      return {
          ...policyConfig(),
          codexModelMini: config.codexModelMini ?? section.models.mini ?? DEFAULT_CODEX_MODEL_MINI,
          codexModelFull: config.codexModelFull ?? section.models.full ?? DEFAULT_CODEX_MODEL_FULL,
          codexImplementEffort: section.implementEffort,
      };
  }
  export function getCodexConfig(phase: CodexPhase, tasks: readonly TaskContext[], root: string = REPO_ROOT): CodexModelConfig {
      return getPipelinePolicy(toPolicyInputs(tasks), codexPolicyConfig(requireCodexSection(root))).codex(phase);
  }
  ```

- Import `REPO_ROOT` from `./env.js` (already imported for `parseMaxReviewLoops`), `die`/`warn` from `./cli.js`, and `loadCodexSection`, `formatUnknownKeysWarning` and the `CodexSectionConfig` type from `./docs-freshness.js`. No cycle results: `docs-freshness` → `worktree` → `git`/`state` never imports `policy`.
- `getClaudeConfig`, `getNominalSize`, `getEffectiveSize` and `getMaxReviewLoops` keep `policyConfig()` and stay untouched (AC-7, AC-12).

### Step 4: Startup validation, skipped for `--ship`

Files: `src/orchestrator/main.ts`

Immediately after the existing block in `main()` (the `loadDocsFreshnessConfig(configRoot)` load and its `die`/`warn` lines), add:

```ts
// The codex section is operator policy read from the main checkout, never the task worktree.
// --ship spawns no agent, so Codex tuning must not block merge/archive; --dry-run resolves Codex configs.
if (!cliArgs.ship || cliArgs.dryRun) splitPolicy.requireCodexSection();
```

Use whichever namespace `main.ts` already imports `./policy.js` under; it is `splitPolicy` at the provider-pin line. This sits before the concurrent-run guard, the heartbeat and every state write, so an invalid section stops `--dry-run`, plain runs, `--reroute`, `--pr` and `--full-send` with no file changes.

The call runs in `claude` provider mode too: the section is validated there but has no effect. `shipTasks` and the shared `docsConfig` handling stay as they are.

### Step 5: Telemetry Effort column

Files: `src/orchestrator/types.ts`, `src/orchestrator/metrics.ts`

- `MetricEntry` gains `effort: string;` after `model`, as a required field.
- In `recordMetric`, append the cell after Status: `... | ${entry.status} | ${safeCell(entry.effort)} |\n`. The value can be an arbitrary rejected string, so it goes through `safeCell`.
- In `METRICS_SKELETON`, the header becomes `| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status | Effort |` with a 10-column separator. Add one note line after the Sub-agent note:

  `> Effort: the reasoning effort canon passed to the agent (for a Codex invocation refused before spawn, the rejected value); \`-\` where canon passes none, as on \`claude:<agent type>\` rows. Rows logged before this column existed have no Effort cell.`

### Step 6: Agent backends supply effort; cold-lens run-log line; error text

Files: `src/orchestrator/agents/codex.ts`, `src/orchestrator/agents/claude.ts`

**`codex.ts`:**

- Delete the local `VALID_CODEX_EFFORTS`, then add `import { VALID_CODEX_EFFORTS } from '../../lib/pipeline-policy.js';` and `export { VALID_CODEX_EFFORTS };`.
- `runCodex`'s `finally` `recordMetric` adds `effort`. Do not add a row on its early invalid-effort `die`; today it records none.
- `runColdCodexReview`:
  - the invalid-effort row adds `effort`, which is the rejected value;
  - the `finally` row adds `effort`;
  - after the invalid-effort guard and before `streamProcess`, add `info(\`Model: ${model} | Effort: ${effort}\`);`, byte-identical in format to `runCodex` (AC-11).
- Replace the "Effort is not configurable — canon resolves it from a fixed phase/size matrix, so this is a bug in canon rather than in your setup." sentence of `invalidCodexEffortMessage` with:

  `canon validates every effort it resolves, including values from .canon/config.json, before passing it on, so reaching this check is a bug in canon rather than in your setup.`

  Keep the `~/.codex/config.toml` / "per-invocation override supersedes it" sentence and the "Please report …" tail. Add no `src/` path (AC-14).

**`claude.ts`:** the session row adds `effort` (the resolved effort passed to `runClaude`). The sub-agent rows add `effort: '-'`.

### Step 7: Retired-env deprecation reason

Files: `src/orchestrator/env.ts`

Change both `CODEX_EFFORT_*` reasons to:

`implement effort is set per task size in .canon/config.json (codex.implement_effort); no effort environment variable exists`

The printed line becomes `⚠️  CODEX_EFFORT_DEFAULT is no longer honored — implement effort is set per task size in .canon/config.json (codex.implement_effort); no effort environment variable exists.`

### Step 8: Doctor `codex` check

Files: `src/cli/commands/doctor.ts`

- Add `export function checkCodexConfig(cwd: string): Check`, labelled `Codex config`, using `loadCodexSection(cwd)`. `doctorCmd`'s `cwd` is `resolveProjectRoot()`, which is already the main checkout.
- Outcomes:
  - `!ok` → `fail` with `loaded.message`;
  - `source === 'defaults'` or an empty section → `pass`, `canon defaults (no codex section)`;
  - otherwise `pass`, or `warn` when `unknownKeys` is non-empty. The detail lists the configured keys, e.g. `.canon/config.json: models.mini=cfg-mini; implement_effort XS=low, M=high`, followed by `formatUnknownKeysWarning(...)` when there are unknown keys.
- Append it to `configChecks` right after `checkDocsFreshness(cwd)`, regardless of provider.
- Leave `checkDocsFreshness` untouched. Through the shared parser it now ignores `codex`, so a `codex` error never shows under "Docs freshness".

### Step 9: Tests

Files: see the Testing Plan for assertions. Files touched:

- `tests/pipeline-policy.test.ts`
- `tests/docs-freshness.test.ts`
- `tests/run-task-codex-config.test.ts` (new)
- `tests/metrics.test.ts`
- `tests/claude-subagent-metrics.test.ts`
- `tests/run-task-code-review.test.ts`
- `tests/agent-backend.test.ts`
- `tests/cli.test.ts`
- `tests/run-task-ship-helpers.ts`
- `tests/run-task-ship-docs-fold.test.ts`
- `tests/run-task-safety-routing.test.ts`

Mechanical updates:

- `tests/agent-backend.test.ts:71`: the implement expectation `'max'` becomes `'xhigh'`, because the fixture is L.
- `tests/run-task-safety-routing.test.ts:768`: add `effort: 'high'` to the inline subprocess `recordMetric` string. Keep the existing "override file receives the row" assertion, and add an assertion that the written row ends with `| high |`.
- `tests/run-task-ship-docs-fold.test.ts:781`: add `effort: 'high'`.
- `tests/run-task-ship-docs-fold.test.ts` "dry-run config source: worktree … main opposite": its `worktreeInvalid=false` case writes `{` to main and a valid worktree copy, and expects exit 0. Per Decision 5, main's unparseable file now stops dry-run on the Codex path. To keep that test's intent (the shared loader reads the worktree copy), change only that case's main fixture from `{` to `{"docs_freshness": 5}`. That file is invalid for the shared loader, so the test still proves the worktree copy is what the shared loader reads, but it has no `codex` section. Its assertions (exit 0, no `is invalid`) need no change. Leave the `worktreeInvalid=true` branch and its `not valid JSON` match as they are. The new file covers the unparseable-main case. A grep of `tests/` for `.canon/config.json` fixtures found no other non-ship run that pairs an unparseable main file with a valid worktree copy.
- `tests/run-task-ship-helpers.ts` `telemetryFragments`: leave its 9-cell rows under the now 10-column `METRICS_SKELETON`. They are the legacy-width case the fold must append unchanged. If any assertion compares the folded header literally, update it to the 10-column header.

### Step 10: Telemetry headers

Files: `templates/docs/pipeline-invocations.md`, `docs/pipeline-invocations.md`

- Template: replace the header and separator with the 10-column versions. Add the same Effort note line as `METRICS_SKELETON`; `tests/metrics.test.ts` asserts the note lines are equal.
- canon-ai's own `docs/pipeline-invocations.md`: change only the note block, header and separator to match the template. Leave every row byte-identical. Use Edit on those lines, not a rewrite.
- Expected side effects. `docs/pipeline-invocations.md` is a pipeline telemetry file, so:
  - the diff→handoff check exempts it;
  - listing it in the handoff is fine because it is in the diff;
  - `--pr` will print its "shared telemetry doc changed" warning and still open the PR. That warning is expected for this task.

### Step 11: Orchestrator doc (managed) and its mirror

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` (via `npm run sync-templates`; never hand-edit the mirror)

**§"Codex Model/Effort Matrix":**

- "fixed phase × size matrix" becomes "a phase × size matrix; the `implement` row and both model tiers are configurable (below)".
- The implement row becomes `mini / medium | mini / high | mini / high | mini / xhigh | full / high`.
- Replace "Effort comes only from this matrix; there is no Codex effort environment override. M/L implement runs … at `max` …" with:
  - only the `implement` row's effort is configurable, through `codex.implement_effort`, and no effort environment variable exists;
  - the XL/delicate cell is full/high, with the existing rationale;
  - `spec_review` and cold-lens efforts are fixed.

**New subsection "Codex settings in `.canon/config.json`":**

- Show the JSON shape from spec Decision §1.
- Every key is optional and falls back key by key.
- `implement_effort` takes the keys `XS|S|M|L|XL`. `XL` also governs delicate tasks, and a bundle resolves its largest or delicate member's cell.
- Precedence chains, from spec Decision §2.
- Config root: the main checkout's file only, committed or not. It is re-read at every Codex invocation, so an edit reaches a task in flight at its next Codex call. A task worktree's copy is ignored. A non-worktree task's own edit takes effect.
- Validation: hard errors versus unknown-key warnings, checked at startup (including `--dry-run`) and at each Codex invocation. A mid-run bad edit stops the next Codex invocation.
- `--ship` neither reads nor validates the section.
- In `claude` mode the section is validated but has no effect.
- `canon doctor` reports it under its own "Codex config" check.

**Model overrides table:** say each env var overrides `codex.models.mini`/`full`. Change the defaults column to "`codex.models.mini`, else `gpt-6-luna`", with the same pattern for full.

**Deprecation line:** add that `CODEX_EFFORT_*` are ignored and that implement effort is set in `codex.implement_effort`.

**`max` paragraph:** no built-in cell uses `max`. If you set `max` in `codex.implement_effort`, the CLI and model must accept it; this was verified only with Codex CLI 0.164.0 and `gpt-6-luna`. On failure, upgrade the CLI, use a model that accepts it, or lower the configured effort. Keep the shipped-defaults paragraph, and add that models can also be set in `codex.models`.

**Telemetry:** wherever this doc describes `docs/pipeline-invocations.md` columns (grep `Tokens`), add Effort.

**Admitted-docs paragraph** (the "Malformed config stops every consumer … Every form reads the active checkout except `--ship`, which reads the main checkout." sentences): add that the `codex` section is the exception. It is read from the main checkout at startup and at each Codex invocation, and `--ship` skips it.

Run `npm run sync-templates`, then `npm run sync-templates:check`.

### Step 12: Other docs

Files: `.canon/README.md` (+ `templates/.canon/README.md` via sync), `README.md`, `docs/decisions.md`, `docs/product-context.md`, `docs/codebase-map.md`, `docs/architecture.md`, `docs/patterns.md`

**`.canon/README.md`:**

- In "Project config", add a sentence on the optional `codex` section: models and per-size implement effort, read only from the main checkout's copy and skipped by `--ship`.
- Add `"codex": { "implement_effort": { "S": "medium" } }` to the example JSON.
- Point to "Codex settings" in `docs/pipeline-orchestrator.md`, which adopters have.

**`README.md`:**

- Add a "### Configuring Codex models and effort" subsection after "Configuring the merge method", with the keys, precedence, main-checkout root, `--ship` exemption and an example.
- In "Configuring docs freshness", qualify two sentences:
  - "each worktree reads its branch's copy" becomes "(except the `codex` section, which is always read from the main checkout)";
  - "Malformed config stops runs, including reroute and ship" gains "an invalid `codex` section stops runs but not `--ship`".
- In the doctor descriptions at lines ~192 and ~337, add "the `codex` section of `.canon/config.json`".

**`docs/decisions.md`:**

- Append a new entry at the end: `## Codex models and implement effort in .canon/config.json (2026-11)`. Its **Decision** covers the config shape, the new defaults, the precedence chain, the main-checkout root re-read per Codex invocation, the `--ship` exemption, the Effort telemetry column and the minor release. Its **Why** includes the evidence table and the "Median time outside implementation" sentence verbatim from spec §Problem, plus the statement that the M/L defaults are judgment, not a measured result. Its **Rule** says: roll back effort by editing `codex.implement_effort`; measure by the Effort column; and older rows' blank Effort cell means "unknown".
- 2026-10 entry (`## Codex implement effort raised; full-model default → GPT-6.1 Sol (2026-10)`): append `*(Superseded by "Codex models and implement effort in .canon/config.json (2026-11)" below: effort is now configurable per size and the defaults were lowered.)*` to the Decision paragraph. In the Rule paragraph, replace the trailing note "*(Full-model default superseded by …; the effort cells remain in force.)*" with "*(Full-model default superseded by "Full-model default → GPT-6.2 Sol (2026-11)" below; the effort cells and the restore-by-release rule are superseded by "Codex models and implement effort in .canon/config.json (2026-11)" below.)*". Do not rewrite the entry's text.
- 2026-11 GPT-6.2 entry: after the Decision paragraph's "Effort cells, routing, and the override env-var chains are unchanged." add `*(Effort cells and the model precedence chain superseded by "Codex models and implement effort in .canon/config.json (2026-11)" below.)*`.

**`docs/product-context.md`:**

- Fast tier: "Codex implementation mini/medium".
- Full tier: "mini/high at S and M, mini/xhigh at L, and full/high at XL/delicate". These are the defaults, configurable per size in `.canon/config.json` (`codex.implement_effort`). Repoint the decision citation to the new entry.

**`docs/codebase-map.md`:**

- Line 40, docs-freshness row: "(also `ship.merge_method` and the main-checkout `codex` section)".
- Line 74, `policy.ts` row: "merges env > main-checkout `codex` config > default on the Codex path".
- Line 89 (telemetry writer) and line 132 (per-invocation telemetry): "(duration, tokens, effort)".

**`docs/architecture.md`:**

- Line 98: "duration, tokens and effort".
- Line 131: after the active-checkout sentence, add "The `codex` section is the exception: it is read from the main checkout at startup and at every Codex invocation, and `--ship` skips it."

**`docs/patterns.md`, §"Pure Policy + Test Discipline":** `src/orchestrator/policy.ts` reads policy env values and, on the Codex path only, the main checkout's `.canon/config.json` `codex` section, and passes both in as `PolicyConfig`. The pure policy still does no I/O.

Run `npm run sync-templates` again for `.canon/README.md`.

### Step 13: Validation and dist

Run, in order, after the last `src/` edit:

1. `npm run build` — this rebuilds `dist/cli/index.js` and `dist/orchestrator/run-task.js`. List both in the handoff Changes table, and do not `git add`/`git commit` them; the orchestrator commits. `tests/cli.test.ts` scans both `dist/` files for leaked dev tokens, so build before testing.
2. `npm run type-check`
3. `npm run lint`
4. `npm test`
5. `npm run docs-refs-check`
6. `npm run sync-templates:check`
7. AC-9 grep: `git grep -n "recordMetric(" -- src tests`. Read every call site, including the string at `tests/run-task-safety-routing.test.ts`, and confirm it passes `effort`.
8. AC-15 grep: `grep -nE "\bfs\b|process\.env|readFile" src/lib/pipeline-policy.ts` finds nothing.
9. AC-13 sweep grep (the disposition table's pattern) shows only "Leave" hits.

## Testing Plan

**Unit / in-process:**

- **`tests/pipeline-policy.test.ts`:**
  - *AC-1.* `CODEX_MATRIX` implement rows become literals XS `medium`, S `high`, M `high`, L `xhigh`, XL `full/high`. They fail on old code because those cells were `xhigh`/`max`. Delicate-M keeps full/high.
  - *AC-2.* Use `getPipelinePolicy([s(size)], { ...TEST_CONFIG, codexImplementEffort: { XS: 'low', S: 'minimal', M: 'none', L: 'medium' } })`. Assert each size's literal and that XL stays `high`. A second fixture with only `{ M: 'low' }` checks that the other sizes stay at AC-1 defaults. `{ XL: 'xhigh' }` with `[s('S', true)]` gives `xhigh`. A bundle `[s('XS'), s('L')]` with distinct per-size values resolves L's value. These fail on old code because there is no override.
  - *AC-3 (guard; passes on current code).* Set every implement key to `low`. Every `spec_review` and `code_review` Codex cell keeps its literal: spec_review XS `medium`, everything else `high`. `claude(phase)` for all phases and sizes equals the result without the override.
  - *AC-4 (spawned, env read at import).* Add a helper beside `loadPolicyConfigForEnv` that uses `runNodeInline` from `tests/run-task-safety-helpers.ts` with `CODEX_MODEL_*` explicitly unset. It calls `getCodexConfig(phase, [{ status: { task_size: 'M' } }] as never, tmpRoot)`, where `tmpRoot` holds `{"codex":{"models":{"mini":"cfg-mini","full":"cfg-full"}}}`, or no file for the "nothing set" case. For each tier, assert six cases with distinct literals (`env-mini`, `legacy-mini`, `cfg-mini`; `env-full`, `legacy-full`, `cfg-full`; full uses XL or delicate):
    - env only → `env-*`;
    - deprecated only → `legacy-*`;
    - config only → `cfg-*`;
    - nothing → `gpt-6-luna`/`gpt-6.2-sol`. Also assert the full `{ model, effort }` object for implement: M → `{ gpt-6-luna, high }` and XL → `{ gpt-6.2-sol, high }`, so AC-1 is checked through `getCodexConfig` as well as the pure matrix;
    - all three → `env-*`;
    - deprecated + config → `legacy-*`.

    "Config only" fails on old code (no config path) and on a naive snapshot-then-config merge (the default wins).
  - Keep the existing "shipped Codex model defaults" test unchanged: it asserts `policyConfig()` is env ?? default.
  - Keep "every Codex matrix effort is one the validator accepts".
- **`tests/docs-freshness.test.ts`:**
  - Shared parser: `{"codex": 5}` and `{"codex": {"anything": 1}}` give `ok`, no `codex` unknown keys (AC-5 and AC-12). These fail on old code, where `codex` was an unknown key. `{"claude": {}}` still gives unknown key `claude` (AC-12; guard, passes on current code).
  - `parseCodexSection` cases from the Step 2 table. For AC-6, each message contains the key and the JSON value, and the allowed set where one applies: `codex` not an object, `codex.models` not an object, `codex.implement_effort` not an object, `models.mini: ""`, `models.mini: "  "`, `models.full: 5`, `implement_effort.M: "ultra"`, `implement_effort.M: 3`, `implement_effort.XXL`, `implement_effort.m`.
  - No message contains "delete".
  - `{"codex":{"reasoning":1,"models":{"x":1}}}` gives `ok` with unknown keys `codex.reasoning` and `codex.models.x`.
  - `{"docs_freshness": 5, "codex": {...valid}}` parses `ok`: the codex loader ignores other sections (AC-12).
  - Load-result shape for a missing file (`source: 'defaults'`), and `{}` (`source: 'file'`, empty section).
- **`tests/metrics.test.ts`:**
  - `entry()` gains `effort: 'high'`.
  - Row regexes end `| ok | high |`.
  - The cell-count assertion `9` becomes `10`.
  - Add `assert.ok(METRICS_SKELETON.includes('| Status | Effort |'))`, and that the template's header and separator lines equal `METRICS_SKELETON`'s, not just the notes.
  - Effort escaping: `effort: 'a|b'` is written escaped and still gives 10 cells.
- **`tests/claude-subagent-metrics.test.ts`:**
  - The session row's 10th cell is the effort passed to `runClaude`, and sub-agent rows are `-`.
  - The hostile-input length assertion changes from `9` to `10`.
- **`tests/run-task-code-review.test.ts`:**
  - Cold-lens ok row `[9] === 'high'` (AC-9).
  - Invalid-effort row `[9] === 'ultra'`: the rejected value.
  - The test's pre-seeded `recordMetric` call adds `effort: 'medium'`.
  - *AC-11.* In the successful cold-review test, capture `console.log` and assert a line `→ Model: gpt-mini | Effort: high`. It fails on old code, which printed no such line.
  - *AC-14.* `assertInvalidEffortMessage` adds `assert.doesNotMatch(message, /not configurable/)` and `assert.match(message, /bug in canon/)`, and keeps the `~/.codex/config.toml`, "supersedes" and no-`src/` assertions. Update the comment at :251, which now says no adopter config feeds effort.
- **`tests/cli.test.ts`:**
  - *AC-10.* Upgrade fixtures: the template header becomes 10 columns and the project keeps 9-cell rows. Assert the rows are byte-identical (existing) and the header line now ends `| Status | Effort |`.
  - Add one assertion `mergeHeaderOnly(fs.readFileSync('templates/docs/pipeline-invocations.md'), <9-col project>)` contains `| Effort |` with rows unchanged. It fails before Step 10.
  - *Doctor:* `checkCodexConfig` on a missing file → pass `canon defaults (no codex section)`. A valid section → pass, and the detail names the keys. `implement_effort.M: "ultra"` → fail, the message names the key and allowed set and does not contain "delete", and `checkDocsFreshness` on the same dir is not `fail`. `codex.reasoning` → warn.
- **`tests/run-task-ship-docs-fold.test.ts`:** a fold of the 9-cell fragment (`telemetryFragments`) into a 10-column shared file appends those rows unchanged under the 10-column header. This is a guard; the fold is already header-agnostic.

**Run-level, `tests/run-task-codex-config.test.ts` (new).** Import harnesses from `tests/run-task-safety-helpers.ts` and `tests/run-task-ship-helpers.ts`; do not edit `run-task-safety-helpers.ts`.

- *AC-6 startup and `--dry-run`.* Use `makeGitFixture`, `writeReviewLoopFixture(localDir, 'dry', 'spec_review', 0)`, and main `.canon/config.json` = `{"codex":{"implement_effort":{"M":"ultra"}}}`. Run `runReviewLoopMain(..., ['--dry-run'])`. Expect exit 1, stderr matching `codex.implement_effort.M` and the allowed set, no `^\s+at ` stack line, no `agent-invocations.log`, and status.json byte-identical. Repeat without `--dry-run` (a plain `--step` run). These fail on old code, which only warned about an unknown key.
- *Decision 5 (unparseable main config).* This must use a worktree fixture. Without a worktree, `configRoot` is the main checkout and the shared loader dies on `{` first, so the test would pass on current code. Use the AC-5 worktree fixture below with main = `{` and a valid worktree copy `{}`, then `--dry-run`. Expect a non-zero exit with the codex loader's `could not be parsed, so its "codex" section cannot be read` text. It fails on old code, where the shared loader read only the worktree copy.
- *AC-6 warning once.* Main config `{"codex":{"reasoning":"x"}}`, a full-tier mixed task at spec_review, `--dry-run`. Exit 0, and exactly one stderr match for `codex\.reasoning`. It must hold across startup plus the two Codex resolutions mixed-mode dry-run makes (`spec_review`, `implement`; `code_review`'s primary role is Claude).
- *AC-1/AC-2 run-level smoke.* Same fixture with `implement_effort: { M: 'low' }` and `models.mini: 'cfg-mini'`, M task. Dry-run stdout contains `- implement: Codex / cfg-mini / low` and `- spec_review: Codex / cfg-mini / high`.
- *AC-5 config root.* Use a real worktree fixture: `prepareSharedWorktreeShipFixture` or `makeBootstrappedTaskWorktreeFixture`. Rewrite the worktree copy of the task's status.json so the first non-done phase is `implement`. Main config gets `implement_effort.M: 'low'` and `models.mini: 'main-mini'`. The worktree copy gets `implement_effort.M: 'minimal'` and `models.mini: 'wt-mini'` in one variant, and `{"codex": 5}` (invalid) in another. Run `--dry-run` with `CANON_WORKTREES_ROOT` pointed at the fixture. Expect exit 0 and `- implement: Codex / main-mini / low` in both variants. This fails if resolution used `getActiveCwd()`, or if the shared loader validated `codex`.
- *AC-4 routing per invocation type, and AC-7 stop-before-spawn.* Use `runNodeInline` with `cwd` = a temp dir holding `.canon/config.json` with `models.mini: 'cfg-mini'`, which makes `REPO_ROOT` that temp dir. Put a fake `codex` on `PATH` that appends its argv as JSON to a log (pattern: `tests/agent-backend.test.ts` PARITY harness). Call `codexBackend.run` for `spec_review` and for `implement`, and `codexBackend.coldReview` for `code_review`, with S tasks. Assert each logged argv carries `-m cfg-mini`.
- *AC-5 live reload and AC-7, in one spawned script, same cwd approach:*
  1. Write `{M: 'low'}` and print `getCodexConfig('implement', M)`.
  2. Rewrite to `{M: 'medium'}` and print again.
  3. Rewrite to `{"codex":{"implement_effort":{"M":"ultra"}}}`.
  4. Print `getClaudeConfig('spec', M)`, `getNominalSize`, `getEffectiveSize` and `getMaxReviewLoops`; they must succeed.
  5. Call `codexBackend.run(...)` with the fake `codex`.

  Expect stdout `low`, then `medium`, then the Claude, size and loop-cap values. Expect exit 1 with the AC-6 message on stderr and no fake-codex log line from step 5.
- *AC-8 `--ship` exemption (guard).* Copy `--ship does not resolve an invalid provider pin`: `prepareShipFixture(dir, [id], { prNumbers, initialFiles: { '.canon/config.json': '{"codex":{"implement_effort":{"M":"ultra"}}}' } })`, then `runCanon(localDir, [id, '--ship'], ...)` with the MERGED fake-gh env. Expect status 0, `expectArchivedAndDeleted`, and no `codex` error text. Also run `[id, '--ship', '--dry-run']`, which must fail with the codex message (Decision 6). Label the plain-ship case a guard: it passes on old code, where `codex` was only an unknown key.

**E2E:** N/A (no UI).

**Manual:** the spec's Human Test Plan, run by the human at human_review.

## Rollback Plan

Revert the PR. No data migration is needed:

- Rows written with the 10th Effort cell stay in adopters' `docs/pipeline-invocations.md`. Under a reverted 9-column header they render with an extra trailing cell. That is cosmetic, and canon has no 9-column reader.
- A `codex` section left in `.canon/config.json` becomes an unknown key again under older canon, which warns and does not fail.
- To restore the old effort without reverting the code, set `codex.implement_effort` to `{ "XS": "xhigh", "S": "xhigh", "M": "max", "L": "max" }`.

## Open Questions Recorded (unattended)

- **Unparseable main config in worktree mode is now a hard error on the Codex path (Decision 5).** The spec is silent on this. The alternative, treating the file as "no section", silently ignores settings, which the spec's strictness rationale rejects. Logged in `notes.md`.
- **`docs/decisions.md` :525, :548 and :655 keep "install the previous canon release" wording.** They are about spec_review, Claude effort and cold-lens cells, which this task leaves non-configurable, so they remain true.
