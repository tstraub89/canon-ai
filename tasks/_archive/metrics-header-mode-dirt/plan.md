# Implementation Plan: metrics-header-mode-dirt

> Written by: Claude | Implements: `tasks/metrics-header-mode-dirt/spec.md`

## Approach

These are two independent fixes.

**#183** reuses the existing header-block merge, `mergeHeaderOnly`, so that a narrower fragment header is replaced by `METRICS_SKELETON`'s whole header block before `recordMetric` appends.

**#16** adds one raw-diff mode probe in `classifyAndPreserveSharedDocDirt`. The probe's result reaches the pure classifier as an optional input, which is checked first and fails closed.

Feasibility check:

- **Exists:** these were found by searching the code.
  - `recordMetric` and `METRICS_SKELETON` (`src/orchestrator/metrics.ts`).
  - `mergeHeaderOnly` (`src/cli/commands/upgrade.ts:94`). `tests/cli.test.ts:8` imports it from `upgrade.js`, and `upgrade.ts:370` uses it.
  - `classifySharedDocDirtFromData`, `SharedDocEntryInput`, `classifySharedDocSetFromData` and `buildSharedDocAbortMessage` (`src/orchestrator/validation.ts`).
  - `classifyAndPreserveSharedDocDirt` (`src/orchestrator/main.ts:2365`).
  - `gitSafeAtRaw` (`src/orchestrator/git.ts:49`).
  - The spawned dirt fixture in `tests/run-task-ship-docs-fold.test.ts:547`, and `makeGitFixture` (`tests/run-task-ship-helpers.ts:36`).
- **Real path:**
  - **#183:** `recordMetric` resolves the fragment path, writes the skeleton when the file is missing, and appends a row. The repair goes between the existence check and the append.
  - **#16:** `classifyAndPreserveSharedDocDirt` runs `git status`, then builds the entries (only `' M'` reads content), then calls `classifySharedDocSetFromData`, then dies or preserves. The probe joins the entry build.
- **Callers:**
  - `classifySharedDocDirtFromData` has only one caller, `classifySharedDocSetFromData`, plus the tests.
  - `classifyAndPreserveSharedDocDirt` is called from `shipTasks` and from the spawned test fixture.
  - `mergeHeaderOnly` is used by `upgrade.ts` and `tests/cli.test.ts`. If it moves, `upgrade.ts` re-exports it, so that test import still resolves unchanged.
- **Tests that can fail:**
  - **AC-1** writes a fragment with a 9-column header. On `main` the header stays at 9 columns, so the test fails.
  - **AC-4** runs `chmod +x` with `core.fileMode=true`. On `main` the classifier returns clean, the fixture exits 0, and the test fails.
- **Predicates:**
  - **Header width:** compare the number of cells in the existing `| Timestamp |` line with the skeleton's. Only fewer cells triggers a repair. No `Timestamp` line, or `mergeHeaderOnly` returning `null`, means no rewrite. An equal or wider header is left alone.
  - **Mode input:** it can be `'changed'`, `'unchanged'`, `'unknown'`, or `undefined`. `undefined` counts as unchanged, so existing callers and tests keep working. The mode is checked before the porcelain code, so it also covers `MM` and similar codes.
  - **Probe:** a path missing from `--raw` output means unchanged. A non-zero exit or a malformed record means unknown for every dirty doc.
- **Scope:** every file below is in Affected Files. The `src/lib` move is optional and listed there.
- **Async/stateful:** N/A, because everything is synchronous.

## Steps

### Step 1: #183 header repair

Files: `src/lib/markdown-table.ts` (new), `src/cli/commands/upgrade.ts`, `src/orchestrator/metrics.ts`

1. Move `mergeHeaderOnly`, with its separator regex, to `src/lib/markdown-table.ts`. Re-export it from `upgrade.ts` (`export { mergeHeaderOnly } from '../../lib/markdown-table.js'`) and keep `upgrade.ts`'s own use. Upgrade behavior doesn't change.
2. In `recordMetric`, after the existence check and before appending, read the file. If its first `| Timestamp |` line has fewer `|`-delimited cells than the skeleton header's, write `mergeHeaderOnly(METRICS_SKELETON, existing)` back. Skip the write when the result is `null`.

### Step 2: #16 classifier input

Files: `src/orchestrator/validation.ts`

1. Add `type SharedDocModeState = 'changed' | 'unchanged' | 'unknown'`.
2. Add an optional fifth parameter `mode?: SharedDocModeState` to `classifySharedDocDirtFromData`, and an optional `mode` field to `SharedDocEntryInput`. Pass the field through from `classifySharedDocSetFromData`.
3. At the top of the classifier, right after the `porcelainCode === null` → clean check:
   - `'changed'` returns abort with "has an uncommitted file-mode change; commit or revert it".
   - `'unknown'` returns abort with "file mode could not be checked".

### Step 3: #16 probe

Files: `src/orchestrator/main.ts`

1. In `classifyAndPreserveSharedDocDirt`, when `dirty.length > 0`, run `gitSafeAtRaw(REPO_ROOT, 'diff', '--raw', '-z', '--', ...dirty)`.
2. Parse the output into records. Each is a `:old new oldsha newsha status` header followed by NUL and the path, then NUL.
3. Build a map from each path (NFC-normalized, like `porcelainByPath`) to `'changed'` when the modes differ.
4. Every dirty path not in the map is `'unchanged'`. A failed command or a malformed record makes every path `'unknown'`.
5. Pass `mode` on each entry.

### Step 4: tests

Files: `tests/metrics.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-ship-docs-fold.test.ts`

- **AC-1 and AC-2** use the existing `fixture` and `entry` helpers and set the fragment's contents directly.
- **AC-3** adds new pure cases:
  - changed with identical content;
  - changed with an append;
  - managed changed with an edit;
  - unknown;
  - `MM` with changed.

  Leave the existing calls untouched.
- **AC-4** follows the spawned fixture at :547:
  - `git config core.fileMode true`, then `fs.chmodSync(doc, 0o755)`;
  - expect a non-zero exit, stderr starting with `--ship aborted: uncommitted shared-doc edits` and naming the mode change, and the mode and content unchanged afterwards;
  - skip when `process.platform === 'win32'`.
- **Red-first:** run AC-1 and AC-4 against `main`'s source before the fix and record both runs in the handoff.

### Step 5: docs and build

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `dist/`

Add one sentence to the "Shared-doc dirt at `--ship`" paragraph: a file-mode change on a shared doc, or a mode that can't be checked, also aborts before anything merges. Then run `npm run sync-templates`, `npm run build` and the full validation set.

## Testing Plan

- **Unit:** Step 4, plus the full `npm test`.
- **E2E:** N/A. The real-git AC-4 test covers the integration path.
- **Manual:** optional `chmod` plus `--ship` on a scratch repo. The Human Test Plan covers it.

## Rollback Plan

Revert the commit. There is no data or schema impact. A repaired fragment header stays repaired, and that is harmless.
