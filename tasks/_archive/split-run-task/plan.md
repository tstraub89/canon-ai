# Plan: split-run-task — Split run-task.ts monolith into modules

> Written by: Claude | Implements: `tasks/split-run-task/spec.md`

## Spec-review nits (incorporated)

Both nits from spec-review are already resolved in the tightened spec text (commit `b35ffef`):

1. **Unassigned symbols**: AC-2 now explicitly lists `PIPELINE_TELEMETRY_FILES` in `worktree.ts`, porcelain parsers in `git.ts`, diff-verification test seams in `validation.ts`, and `isDoneMdTemplate`/`extractDoneMdFromStdout` in `validation.ts`.
2. **`state.ts` ↔ `prompts/helpers.ts` cycle**: resolved by relocating `toResumePrompt` to `prompts/helpers.ts`. The DAG is preserved: `prompts/helpers.ts` → `state.ts` (for `resolveTaskCwd`); `state.ts` must NOT import from `prompts/`.

One additional discrepancy noted in `notes.md`: AC-3 and `docs/patterns.md` reference `canPhaseAdvance()` as one of four phase-aware switches, but this function does not exist in the current codebase — only three switches exist (`PHASE_ORDER`, `runPhase`, `checkAndRoute`). This plan preserves the three existing switches in `main.ts` and does not introduce `canPhaseAdvance`.

---

## Implementation ordering principle

Extract modules bottom-up (low-dependency first) so each new file compiles cleanly as it is written. Dependency graph (arrows = "imports from"):

```
types.ts ← everything
env.ts ← everything that needs REPO_ROOT
  ↓
metrics.ts, cli.ts, git.ts, state.ts
  ↓
policy.ts, task-sh.ts, validation.ts, context.ts, worktree.ts
  ↓
agents/stream.ts ← agents/claude.ts, agents/codex.ts
  ↓
prompts/render.ts, prompts/helpers.ts ← prompts/index.ts
  ↓
phases/*.ts ← main.ts ← scripts/run-task.ts (entry point)
```

`types.ts` and `env.ts` import NOTHING from the new tree (only Node.js built-ins). All relative imports in the new tree require `.js` extensions (NodeNext module resolution).

---

## Step 1 — Install mustache and capture golden tests (MANDATORY FIRST STEP)

**Why first**: goldens capture pre-refactor behavior. If captured after extraction they only prove "new code matches itself" — useless as a behavior guard.

### 1a — Add mustache

Run `npm install mustache && npm install --save-dev @types/mustache`. Verify `package.json` gains both entries.

### 1b — Write `tests/run-task-prompts.test.ts`

Import all nine prompt builders directly from `'../scripts/run-task.ts'` (the monolith — not yet split). Build `PipelineState` fixture objects that exercise each builder's conditional branching:

| Builder | Required fixture variants |
|---|---|
| `promptSpec` | fast-tier (`isPlanCombined=true`); full-tier; solo task; bundle |
| `promptSpecRevision` | solo task; bundle |
| `promptSpecReview` | solo task; bundle |
| `promptPlan` | solo task; bundle |
| `promptImplement` | `mode='fresh'`; `mode='resume'`; solo; bundle |
| `promptImplementRevisions` | solo task; bundle |
| `promptImplementReroute` | solo; bundle (with `reroute_count > 0`) |
| `promptCodeReview` | `maxIter=0` (round-1); `maxIter=1` (round-N); solo; bundle |
| `promptQa` | solo task; bundle |

**Golden capture approach**: call each builder with each fixture, snapshot the result as an inline string constant in the test file. Assert `builder(fixture) === GOLDEN_STRING` using strict equality.

Run `npm test` to confirm the golden tests pass before any extraction begins. Commit: `chore(split-run-task): capture pre-refactor golden prompt tests`.

---

## Step 2 — Create directory structure

Create: `scripts/run-task/`, `scripts/run-task/agents/`, `scripts/run-task/phases/`, `scripts/run-task/prompts/`, `scripts/run-task/prompts/templates/`.

---

## Step 3 — Extract `scripts/run-task/types.ts`

**Source**: lines ~37–202 (PHASE_ORDER through CommandResult), `ImplementMode` (~line 1236), `SessionSlot` (~line 1004).

**Move**:
```
PHASE_ORDER, _PHASE_STATUS_VALUES, _VERDICT_VALUES    (const arrays)
Phase, PhaseStatus, Verdict, CurrentPhase              (derived type aliases)
isPhaseStatus(), isVerdict()                           (type guards)
PhaseEntry, Escalation, StatusJson, CliArgs
TaskContext, PipelineState, CommandResult, MetricEntry
ImplementMode, SessionSlot
```

**Do NOT include** `StreamResult` — that moves to `agents/stream.ts`.

Exports: all as named exports. No default export. No imports from the new tree.

---

## Step 4 — Extract `scripts/run-task/env.ts`

**Source**: lines ~20–35 (path constants), ~161–167 (timeouts), ~227–334 (legacy env vars + config).

**Critical path-resolution change**: The current file is at `scripts/run-task.ts` so `REPO_ROOT = path.resolve(__dirname, '..')`. The new file is at `scripts/run-task/env.ts` so it must be:
```typescript
const REPO_ROOT = path.resolve(__dirname, '../..'); // two levels up
```
Every other module imports `REPO_ROOT` from `./env.js` (or relative equivalent). No other module computes `__dirname`-based paths.

**Exports**: `REPO_ROOT`, `TASKS_DIR`, `TASK_SH`, `WORKTREES_ROOT`, `STALL_TIMEOUT_MS`, `STALL_KILL_GRACE_MS`, `LEGACY_FALLBACK_ENV_VARS`, `LEGACY_IGNORED_ENV_VARS`, `config`, `warnLegacyEnvVars`, `warnWorktreesRootMismatch`, `resolveProjectName`.

**Imports**: `node:url`, `node:path`, `node:fs` only — nothing from the new tree.

---

## Step 5 — Extract `scripts/run-task/metrics.ts`

**Source**: lines ~152–159 (METRICS_FILE), ~201–220 (recordMetric).

`lastClaudeSessionId` (line 188) and `lastClaudeStdout` (line 180) are module-level globals currently near this section. They are NOT metrics. They become return values from `runClaude` — see Step 15.

**Move**: `METRICS_FILE`, `recordMetric`.

**Exports**: both. **Imports**: `../env.js` (REPO_ROOT), `../types.js` (MetricEntry), `node:fs`, `node:path`.

---

## Step 6 — Extract `scripts/run-task/cli.ts`

**Source**: lines ~409–509.

**Move**: `die`, `info`, `warn`, `printUsage`, `parseArgs`, `validateTaskId`.

**Exports**: all. **Imports**: `../types.js` (CliArgs, Phase, PHASE_ORDER), `node:process`.

---

## Step 7 — Extract `scripts/run-task/git.ts`

**Source**: lines ~556–779 (runCommand through verifyBranch), ~2388–2422 (PorcelainEntry, parsePorcelainEntries, parsePorcelain).

**Move**:
```
runCommand(), runCommandOrDie()
git(), gitSafe(), gitSafeAt(), gitSafeAtRaw()
commitTaskArtifactsToBase()
getCurrentBranch(), branchExistsLocally(), getBaseBranch(), getDefaultBaseBranch()
commitsAheadOfBase(), isCommandAvailable()
ensureBranch(), verifyBranch()
PorcelainEntry (type), stripPorcelainQuotes(), parsePorcelainEntries(), parsePorcelain()
```

**Do NOT move** `extractSection()` and `replaceMarkdownSection()` (~lines 2364–2379) — those are private helpers for `autoCommitCode()` which stays in `main.ts`.

**`commitTaskArtifactsToBase` signature change**: this function currently reads `TASK_ARTIFACT_FILES` from module scope. After the split, `TASK_ARTIFACT_FILES` lives in `worktree.ts`, and `worktree.ts` imports from `git.ts` — creating a cycle. Resolution: change the signature to accept the file list as a parameter:
```typescript
function commitTaskArtifactsToBase(taskIds: string[], artifactFiles: ReadonlySet<string>): void
```
Callers (in `main.ts`) import `TASK_ARTIFACT_FILES` from `worktree.js` and pass it in.

**Exports**: all — `parsePorcelainEntries` and `parsePorcelain` were already exported; keep them exported.

**Imports**: `../types.js`, `../env.js` (REPO_ROOT, TASKS_DIR, config), `../cli.js` (die, info, warn), `../state.js` (taskDirFor, readStatus), `node:child_process`, `node:fs`, `node:path`.

---

## Step 8 — Extract `scripts/run-task/state.ts`

**Source**: lines ~513–551 (path helpers + status I/O), ~1006–1018 (storeSessionId, getStoredSessionId). `toResumePrompt` (~line 1019) is **not** included — it moves to `prompts/helpers.ts`.

**Move**: `taskDirFor`, `statusFileFor`, `resolveTaskCwd`, `readStatus`, `writeStatus`, `deriveTopLevelStatus`, `storeSessionId`, `getStoredSessionId`.

**Exports**: all. **Imports**: `../types.js` (StatusJson, CurrentPhase, PHASE_ORDER, SessionSlot), `../env.js` (TASKS_DIR, REPO_ROOT), `../cli.js` (die), `node:fs`, `node:path`.

**DAG constraint**: `state.ts` must NOT import anything from `prompts/`. This will be verified during code review by grepping for `prompts/` imports inside `state.ts`.

---

## Step 9 — Extract `scripts/run-task/policy.ts`

**Source**: lines ~336–387.

**Move**: `policyConfig`, `toPolicyInputs`, `getClaudeConfig`, `getCodexConfig`, `detectTier`, `isPlanCombined`, `getMaxReviewLoops`, `getNominalSize`, `getEffectiveSize`.

**Exports**: all, plus re-export the pipeline-policy types used by other modules: `ClaudeModelConfig`, `CodexModelConfig`, `PipelineTier`, `PolicyConfig`, `PolicyInput`, `TaskSize`, `ClaudePhase`, `CodexPhase`.

**Imports**: `../types.js`, `../state.js` (readStatus), `../env.js`, `../pipeline-policy.js` (note: from `scripts/run-task/policy.ts`, the relative path to `scripts/pipeline-policy.ts` is `'../pipeline-policy.js'`).

---

## Step 10 — Extract `scripts/run-task/task-sh.ts`

**Source**: lines ~2274–2277.

**Move**: `runTaskShFor`.

**Exports**: `runTaskShFor`. **Imports**: `../env.js` (TASK_SH, REPO_ROOT), `../git.js` (runCommandOrDie), `node:path`.

---

## Step 11 — Extract `scripts/run-task/validation.ts`

**Source**: lines ~1034–1145 (validateHandoff through escapeRegExp), ~2462–2637 (DONE_MD_TEMPLATE_SENTINELS through verifyHandoffAgainstDiff).

**Move**:
```
escapeRegExp()
validateHandoff(), canonicalizeValidationCheck(), parseValidationRequiredChecks()
ValidationOutcomeRow (type), parseValidationOutcomeRows()
isPassResult(), isNAResult()
validateHandoffAgainstSpec()
findUncoveredTrackedChanges(), findStagedFilesOutsideHandoff()
DONE_MD_TEMPLATE_SENTINELS, isDoneMdTemplate(), extractDoneMdFromStdout()
parseHandoffFiles(), HANDOFF_DIFF_EXEMPT_PATHS
HandoffDiffInputs (type), verifyHandoffAgainstDiffFromData(), parseDiffNameStatus()
verifyHandoffAgainstDiff()
```

**Do NOT move** `autoCommitAllowedSourceBypass()` and `toFileSet()` — private helpers for `autoCommitCode()` which stays in `main.ts`. Do NOT move `appendAutoCommitDebug()` — same reason.

**Exports**: all moved symbols. Symbols that were already exported (`validateHandoffAgainstSpec`, `findUncoveredTrackedChanges`, `findStagedFilesOutsideHandoff`, `isDoneMdTemplate`, `extractDoneMdFromStdout`, `verifyHandoffAgainstDiffFromData`, `verifyHandoffAgainstDiff`, `parsePorcelain`, `parsePorcelainEntries`) — wait, the last two are in `git.ts` per Step 7. All others exported.

**Imports**: `../types.js`, `../state.js` (taskDirFor), `../env.js` (REPO_ROOT), `../git.js` (gitSafe, gitSafeAt, PorcelainEntry, parsePorcelain), `../cli.js` (info, warn), `node:fs`, `node:path`.

---

## Step 12 — Extract `scripts/run-task/context.ts`

**Source**: lines ~1146–1403.

**Move**: `extractAffectedFiles`, `buildContextBlock`, `buildKnownPitfalls`, `buildKnownRisks`, `summarizePreloadStatus`, `extractValidationChecks`, `extractAcSummary`, `buildImplementStateHeader`.

**Exports**: all. **Imports**: `../types.js` (PipelineState, TaskContext, ImplementMode), `../state.js` (taskDirFor, readStatus), `../env.js` (REPO_ROOT, TASKS_DIR), `../cli.js` (warn), `node:fs`, `node:path`.

---

## Step 13 — Extract `scripts/run-task/worktree.ts`

**Source**: lines ~170–174 (PIPELINE_TELEMETRY_FILES), ~763–999 (worktree functions), ~914–927 (TASK_ARTIFACT_FILES).

**Move**:
```
TASK_ARTIFACT_FILES (const Set — currently at ~line 914)
PIPELINE_TELEMETRY_FILES (const array — currently at ~line 170, already exported)
worktreePath(), isWorktreeEnabled(), getActiveCwd()
findExistingWorktreeForBranch(), ensureWorktree(), teardownWorktree()
flushWorktreeTelemetry(), syncWorktreeArtifacts(), syncWorktreeTelemetry()
```

**Exports**: all including both constants. **Imports**: `../types.js`, `../env.js` (REPO_ROOT, WORKTREES_ROOT, TASKS_DIR), `../git.js` (git, gitSafe, gitSafeAt, runCommand), `../state.js` (taskDirFor, readStatus, writeStatus), `../metrics.js` (recordMetric), `../cli.js` (info, warn, die), `node:fs`, `node:path`, `node:child_process`.

---

## Step 14 — Extract `scripts/run-task/agents/stream.ts`

**Source**: lines ~1824–1989.

**Move**: `StreamResult` (type), `streamProcess`, `formatLiveTick`.

**Exports**: all. **Imports**: `../../env.js` (STALL_TIMEOUT_MS, STALL_KILL_GRACE_MS), `node:child_process`, `node:readline`.

---

## Step 15 — Extract `scripts/run-task/agents/claude.ts`

**Source**: lines ~1990–2165.

**Critical change — remove module-level globals**: `runClaude` currently writes two module-level side effects: `lastClaudeStdout` (line 180) and `lastClaudeSessionId` (line 188). After the split these globals are deleted. Define a new return type:

```typescript
export type ClaudeRunResult = StreamResult & {
    sessionId: string | null;
    processedText: string; // replaces lastClaudeStdout
};
```

Change `runClaude`'s return type from `Promise<StreamResult>` to `Promise<ClaudeRunResult>`. Populate `sessionId` and `processedText` in the returned object from what was previously written to the globals. The globals `lastClaudeSessionId` and `lastClaudeStdout` in `run-task.ts` are deleted — not moved anywhere.

**Exports**: `CLAUDE_RESUME_NOT_FOUND_RE`, `runClaude`, `ClaudeRunResult` (type).

**Imports**: `./stream.js`, `../../env.js` (REPO_ROOT, STALL_TIMEOUT_MS), `../../cli.js` (info, warn), `../../types.js`, `../../prompts/helpers.js` (toResumePrompt), `node:fs`, `node:path`.

---

## Step 16 — Extract `scripts/run-task/agents/codex.ts`

**Source**: lines ~2167–2269.

**Critical change — remove module-level globals**: `runCodex` currently writes `lastCodexSessionId` (line 402) and `lastCodexExitStatus` (line 405). The exit code is already in `StreamResult.exitCode`; the session ID needs to be returned. Define:

```typescript
export type CodexRunResult = StreamResult & {
    sessionId: string | null;
};
```

Change return type to `Promise<CodexRunResult>`. Populate `sessionId` from what was written to `lastCodexSessionId`. Delete `lastCodexSessionId` and `lastCodexExitStatus` from `run-task.ts`.

**Exports**: `runCodex`, `CodexRunResult` (type).

**Imports**: `./stream.js`, `../../env.js`, `../../cli.js`, `../../types.js`, `../../prompts/helpers.js` (toResumePrompt — confirm whether `runCodex` uses it), `node:child_process`.

---

## Step 17 — Extract `scripts/run-task/prompts/render.ts`

**New file** (no source lines — new adapter).

```typescript
import Mustache from 'mustache';

// Disable HTML escaping: templates are markdown, not HTML. Matches current
// behavior where TypeScript string interpolation never escapes.
Mustache.escape = (text: string) => text;

export function renderTemplate(template: string, view: object): string {
    return Mustache.render(template, view);
}
```

**Exports**: `renderTemplate`. **Imports**: `mustache` package only.

---

## Step 18 — Extract `scripts/run-task/prompts/helpers.ts`

**Source**: lines ~1019–1030 (toResumePrompt — relocated from state area), ~1406–1446 (CLAUDE_STARTUP, CODEX_STARTUP, QA_STARTUP, taskList, phaseCommands).

**Move**: `toResumePrompt` (relocated), `CLAUDE_STARTUP`, `CODEX_STARTUP`, `QA_STARTUP`, `taskList`, `phaseCommands`.

**Exports**: all. **Imports**: `../types.js` (TaskContext, Phase), `../state.js` (resolveTaskCwd), `../env.js` (REPO_ROOT, TASKS_DIR), `node:path`, `node:fs`.

---

## Step 19 — Create prompt template files

For each of the nine prompt builders in `run-task.ts`, extract the static prose into a Mustache `.md` template file under `scripts/run-task/prompts/templates/`. Dynamic values become `{{varName}}` placeholders. Conditionals use `{{#condition}}...{{/condition}}` / `{{^condition}}...{{/condition}}`.

### Template extraction for each builder

Read each builder function in `run-task.ts`, identify every static string segment and every dynamic insertion, and write the corresponding template. A view object with exactly those field names is constructed by the builder in Step 20.

**`templates/spec.md`** — from `promptSpec()` (~lines 1449–1489):
Slots: startup, taskList, phaseCommands, tier label (`{{#isPlanCombined}}spec+plan{{/isPlanCombined}}{{^isPlanCombined}}spec{{/isPlanCombined}}`), contextBlock, specTemplateContents, knownPitfalls.

**`templates/spec-revision.md`** — from `promptSpecRevision()` (~lines 1490–1511):
Slots: startup, taskList, phaseCommands, specReviewContent, contextBlock.

**`templates/spec-review.md`** — from `promptSpecReview()` (~lines 1512–1560):
Slots: startup, taskList, phaseCommands, specContents (joined spec content), contextBlock.

**`templates/plan.md`** — from `promptPlan()` (~lines 1561–1583):
Slots: startup, taskList, phaseCommands, specContents, specReviewVerdicts, knownPitfalls, contextBlock.

**`templates/implement.md`** — from `promptImplement()` (~lines 1584–1624):
Handles both fresh and resume modes via a `{{stateHeader}}` variable (the mode-specific header pre-rendered by `buildImplementStateHeader`). Slots: startup, taskList, phaseCommands, stateHeader, contextBlock, knownPitfalls, knownRisks, validationChecks, acSummary.

**`templates/implement-revisions.md`** — from `promptImplementRevisions()` (~lines 1625–1659):
Slots: startup, taskList, phaseCommands, stateHeader, reviewContent, contextBlock, knownPitfalls, knownRisks.

**`templates/implement-reroute.md`** — from `promptImplementReroute()` (~lines 1660–1708):
Slots: startup, taskList, phaseCommands, stateHeader, rerouteCount, contextBlock, knownPitfalls, knownRisks.

**`templates/code-review-round-1.md`** — from `promptCodeReview()` (~lines 1709–1786) when `maxIter === 0`:
Slots: startup, taskList, phaseCommands, contextBlock, diffContent.

**`templates/code-review-round-n.md`** — from `promptCodeReview()` when `maxIter > 0`:
Slots: startup, taskList, phaseCommands, iterationCount, reviewContext, contextBlock.

**`templates/qa.md`** — from `promptQa()` (~lines 1787–1821):
Slots: startup, taskList, phaseCommands, contextBlock.

### Whitespace fidelity

After writing each template, update the import in the test (if using the new path) and run `npm test` to catch whitespace divergence immediately. Mustache can add/remove trailing newlines around section blocks. If divergence is unavoidable, adjust the template to trim/pad output to match the golden, and document in `handoff.md` Deviations.

### Template loading convention (for Step 20)

```typescript
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname_prompts = dirname(fileURLToPath(import.meta.url));
const specTemplate = readFileSync(join(__dirname_prompts, 'templates/spec.md'), 'utf8');
// ... one const per template
```

---

## Step 20 — Extract `scripts/run-task/prompts/index.ts`

For each prompt builder, refactor to:
1. Construct a `view` object with all dynamic values (matching template slot names)
2. Return `renderTemplate(template, view)`

The builders shrink to data prep + dispatch. The prose lives in `.md` files.

**Exports**: `promptSpec`, `promptSpecRevision`, `promptSpecReview`, `promptPlan`, `promptImplement`, `promptImplementRevisions`, `promptImplementReroute`, `promptCodeReview`, `promptQa`.

**Imports**: `./render.js`, `./helpers.js`, `../context.js`, `../types.js`, `../state.js` (as needed), `../policy.js` (detectTier, isPlanCombined), `node:fs`, `node:path`, `node:url`.

**After completing this step, run `npm test`.** The golden suite must pass — this is the behavior-identity gate for the entire template migration.

---

## Step 21 — Extract per-phase handlers

Extract each phase's `case` body from `runPhase()` into a dedicated file under `scripts/run-task/phases/`. Add a `PhaseHandlerResult` type to `types.ts`:

```typescript
export type PhaseHandlerResult = {
    claudeResult?: ClaudeRunResult;  // from agents/claude.ts
    codexResult?: CodexRunResult;    // from agents/codex.ts
};
```

Each handler exports: `async function run(state: PipelineState, cliArgs: CliArgs): Promise<PhaseHandlerResult>`.

`main.ts`'s `runPhase` calls each handler and reads `result.claudeResult.sessionId`, `result.claudeResult.processedText`, `result.codexResult.sessionId`, `result.codexResult.exitCode` from the returned object. These replace the previous module-global reads.

### `phases/spec.ts`
Extract `case 'spec'` (~lines 3662–3685). Imports: `../prompts/index.js` (promptSpec, promptSpecRevision), `../agents/claude.js`, `../policy.js`, `../task-sh.js`, `../types.js`, `../state.js`.

### `phases/spec-review.ts`
Extract `case 'spec_review'` (~lines 3687–3759). The fast-tier gate branch calls `process.exit(0)` directly — preserve this. Imports: `../prompts/index.js`, `../agents/codex.js`, `../policy.js`, `../task-sh.js`, `../types.js`, `../state.js`, `../cli.js`.

### `phases/plan.ts`
Extract `case 'plan'` (~lines 3762–3781). Imports: `../prompts/index.js`, `../agents/claude.js`, `../policy.js`, `../task-sh.js`, `../types.js`.

### `phases/implement.ts`
Extract `case 'implement'` (~lines 3783–4024). Largest handler. Note: `autoCommitCode` is called from `checkAndRoute` in `main.ts` after the implement phase completes — it is NOT called from inside this handler. Imports: `../prompts/index.js`, `../agents/codex.js`, `../agents/claude.js`, `../policy.js`, `../task-sh.js`, `../types.js`, `../state.js`, `../worktree.js`, `../cli.js`.

### `phases/code-review.ts`
Extract `case 'code_review'` (~lines 4025–4037). Includes the `validateHandoff` preflight and `verifyHandoffAgainstDiff` call before the agent runs. Imports: `../prompts/index.js`, `../agents/claude.js`, `../policy.js`, `../task-sh.js`, `../validation.js`, `../worktree.js`, `../types.js`, `../state.js`, `../cli.js`.

### `phases/qa.ts`
Extract `case 'qa'` (~lines 4038–4083). The QA salvage path reads `processedText` from the ClaudeRunResult:
```typescript
// was: if (!state.isBundle && lastClaudeStdout) {
// now: if (!state.isBundle && claudeResult.processedText) {
const salvaged = extractDoneMdFromStdout(claudeResult.processedText);
```
Imports: `../prompts/index.js`, `../agents/claude.js` (ClaudeRunResult), `../policy.js`, `../task-sh.js`, `../validation.js` (isDoneMdTemplate, extractDoneMdFromStdout), `../state.js`, `../types.js`, `../cli.js`, `node:fs`, `node:path`.

---

## Step 22 — Write `scripts/run-task/main.ts`

The orchestration hub. Contains the phase dispatcher, routing logic, auto-commit, ship flow, and `main()`.

### Module-level state (NOT exported)

```typescript
let cliArgs: CliArgs = { /* defaults from current run-task.ts line 390 */ };
let ghAvailable = false;
```

These two remaining globals live in `main.ts` only. Functions outside `main.ts` that need `cliArgs` receive it as a parameter. `ghAvailable` is used by PR helpers which all stay in `main.ts`.

### Replacing the removed globals in the orchestration loop

```typescript
// Store session IDs from phase handler results instead of module globals:
const result = await runPhase(currentPhase, state, cliArgs);
// was: if (slot && lastClaudeSessionId) storeSessionId(..., lastClaudeSessionId)
// now: if (slot && result.claudeResult?.sessionId) storeSessionId(..., result.claudeResult.sessionId)

// Pass codex exit code to checkAndRoute instead of reading a global:
// was: checkAndRoute(phase, taskIds)   — reads lastCodexExitStatus internally
// now: checkAndRoute(phase, taskIds, result.codexResult?.exitCode ?? 0)
```

Update `checkAndRoute` signature: `async function checkAndRoute(phase: Phase, taskIds: string[], lastCodexExitCode: number): Promise<void>`.

### Content retained in `main.ts`

All content from `run-task.ts` not moved to a dedicated module:

- Phase helpers: `getCurrentPhase`, `getPhaseStatus`, `getVerdict`, `getIterations`, `getPhaseIterations`, `getTitle`, `autoBlockPhase`
- `buildPipelineState`, `assertSamePhase`, `routeBackTo`
- Recovery logic: `recoverPhaseForTask`, `EvidenceResult` (interface), `extractCheckedVerdict`, `readArtifact`, `isTemplateUnfilled`, all evidence-based recovery functions (~lines 4127–4300)
- Auto-commit: `extractSection`, `replaceMarkdownSection`, `autoCommitAllowedSourceBypass`, `toFileSet`, `appendAutoCommitDebug`, `verifyHandoffFilesCommitted`, `autoCommitCode`, `autoCommitArtifacts`
- PR helpers: `extractValidationChecklist`, `extractExternalApiStatus`, `readDocsMap`, `runDocsCheckFlaggedPackages`, `formatMissedCitationsWarning`, `buildPrBody`, `resolveTaskBranch`, `pushBranch`, `createDraftPr`
- Ship helpers: `shipTasks`, `rerouteFromHumanReview`, `assertLocalBaseInSyncWithOrigin`, `assertTaskBranchPushed`, `assertOriginTaskBranchAbsent`, `assertNoOpenPRForTask`, `findOpenPRNumber`, `mergeOpenPRsAndPull`, `runPostMergeHook`, `maybeCreateGitHubRelease`, `rewriteArchivedTaskRefs`
- `checkDeps`, `main()` async function

**Export**: `main` function (imported by the entry point). No other exports needed from this file.

---

## Step 23 — Gut `scripts/run-task.ts` to thin entry point

Replace all 4545 lines with:

```typescript
import { fileURLToPath } from 'node:url';
import { main } from './run-task/main.js';

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
    main().catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
```

`npx tsx scripts/run-task.ts <id>` and `npm run run-task` continue to work unchanged — the entry point path is preserved.

---

## Step 24 — Update test imports

**`tests/run-task-parse-porcelain.test.ts`**: change import path from `'../scripts/run-task.ts'` → `'../scripts/run-task/git.js'`.

**`tests/run-task-validation.test.ts`**: change import path from `'../scripts/run-task.ts'` → `'../scripts/run-task/validation.js'`.

**`tests/run-task-prompts.test.ts`** (created in Step 1): update import from `'../scripts/run-task.ts'` → `'../scripts/run-task/prompts/index.js'`.

`tests/pipeline-policy.test.ts`: no change.

---

## Step 25 — Update documentation

**`docs/codebase-map.md`**: Replace the `scripts/run-task.ts` entry (currently described as a 4500-line monolith) with a `scripts/run-task/` section. Include a table mapping each module file to its concern (one row per module). Describe the `scripts/run-task.ts` entry point separately as "thin entry point — delegates to `main.ts`".

**`docs/architecture.md`** (Validation section): Update text that says "parsers in `run-task.ts`" → point at `scripts/run-task/validation.ts` (handoff validation parsers) and `scripts/run-task/git.ts` (porcelain parsers).

**`docs/patterns.md`** (update "Files:" lines in pattern entries):
- **Phase Addition Discipline**: update `scripts/run-task.ts (4 switch statements)` → `scripts/run-task/main.ts`. Note in the body that `PHASE_ORDER` is defined in `scripts/run-task/types.ts` and imported by `main.ts`. Note that `canPhaseAdvance` appears in this doc but does not exist in the current codebase.
- **Validation Gate Discipline**: update `validateHandoff()` / `verifyHandoffAgainstDiff()` references → `scripts/run-task/validation.ts`; `autoCommitCode()` → `scripts/run-task/main.ts`.
- **State Schema Discipline**: update `run-task.ts` parser references → `scripts/run-task/state.ts`.

---

## Step 26 — Validation pass

Run in order:

1. **`npm run lint`** — fix any issues (missing exports, unused imports, lint rule violations from the split).

2. **`npm run type-check`** — verify all `.js` extensions on relative imports:
   ```bash
   grep -rn "from '\.\." scripts/run-task/ tests/ | grep -v "\.js'" | grep -v "node_modules"
   ```
   Also verify `REPO_ROOT` computes `'../..'` in `env.ts`.

3. **`npm test`** — all suites must pass:
   - `tests/run-task-prompts.test.ts` — golden-output verification (behavior-identity gate)
   - `tests/run-task-parse-porcelain.test.ts` — imports from `git.js`
   - `tests/run-task-validation.test.ts` — imports from `validation.js`
   - `tests/pipeline-policy.test.ts` — unchanged

If golden tests fail: the divergence is almost certainly Mustache whitespace. Inspect the diff, adjust the template to match, and document in `handoff.md` Deviations if the adjustment is non-obvious.

---

## Step ordering summary

| Step | Deliverable | Gate |
|---|---|---|
| 1 | `tests/run-task-prompts.test.ts` + goldens | `npm test` passes |
| 2 | Directory skeleton | — |
| 3–13 | Core modules: types, env, metrics, cli, git, state, policy, task-sh, validation, context, worktree | Each compiles |
| 14–16 | Agent modules: stream, claude (with ClaudeRunResult), codex (with CodexRunResult) | Each compiles |
| 17–20 | Prompt modules: render, helpers, 11 templates, index | `npm test` (golden suite) |
| 21 | Phase handlers (6 files) | Each compiles |
| 22 | `main.ts` (orchestration hub) | Compiles |
| 23 | Thin entry point | Full tree compiles |
| 24 | Test imports updated | `npm test` passes (full suite) |
| 25 | Docs updated | — |
| 26 | Final lint + type-check + test | All three pass |
