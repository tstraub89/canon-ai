# Spec: scope-pr-auto-commit-to-affected-files-v2 — Scope `--pr` auto-commit allow-list to spec's Affected Files

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`commitHumanReviewFiles()` at [scripts/run-task/main.ts:887](../../scripts/run-task/main.ts:887) admits any dirty file matching `humanReviewAllowedPath()` at [main.ts:637](../../scripts/run-task/main.ts:637): `tasks/<id>/**` OR any file in `PIPELINE_SHARED_DOCS` ([worktree.ts:24](../../scripts/run-task/worktree.ts:24)). `PIPELINE_SHARED_DOCS` is the union of `PIPELINE_TELEMETRY_FILES` and `PIPELINE_MANAGED_DOCS` — including managed docs like `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`. The unconditional managed-docs carve-out is the inert-ifying surface for **cross-pipeline contamination Mode 2** ([docs/BACKLOG.md:454](../../docs/BACKLOG.md:454)): when canon's worktree-to-worktree managed-doc sync leaks Task A's edits into Task B's worktree, B's `--pr` allows the foreign content into B's PR — attributing A's work to B and (in the gallery_wall incident) referencing a file that only exists on A's branch.

Detected externally by `docs-refs-check` CI; canon itself emits no signal.

## Decision

**Tighten the `--pr` commit allow-list from `{tasks/<id>/**, PIPELINE_SHARED_DOCS}` to `{tasks/<id>/**, PIPELINE_TELEMETRY_FILES, (spec.AffectedFiles ∩ PIPELINE_MANAGED_DOCS)}`. All four existing gates in `commitHumanReviewFiles` keep their existing `die()` semantics — only the allow-list shrinks.**

- **Task dirs** (`tasks/<id>/**`) stay always-allowed (artifact commits at human_review).
- **`PIPELINE_TELEMETRY_FILES`** ([worktree.ts:9](../../scripts/run-task/worktree.ts:9)) stay always-allowed — `lessons-learned.md`, `task-quality-log.md`, `pipeline-invocations.md`. Append-only is an *operation* property, not a *content* property: appended entries can reference per-task content (specific task IDs, file paths only on one branch) that DOES propagate via canon's worktree sync, so telemetry IS a contamination vector — just per-row instead of per-section. v2 leaves telemetry's auto-allow unchanged from today (strict tightening of today's PIPELINE_SHARED_DOCS allow-list — telemetry was allowed before, still allowed now). The structural fix for telemetry contamination is the deferred sync rewrite (BACKLOG entry at [docs/BACKLOG.md:467](../../docs/BACKLOG.md)); this task does not address it.
- **`PIPELINE_MANAGED_DOCS`** ([worktree.ts:15](../../scripts/run-task/worktree.ts:15)) — `architecture.md`, `codebase-map.md`, `decisions.md`, `patterns.md`, `pipeline-orchestrator.md`, `product-context.md` — are no longer auto-allowed. A managed doc is committable only if it appears in the spec's `### Affected Files` table.
- **Non-managed Affected Files entries** (source files, test files, fixtures, templates — anything NOT in `PIPELINE_MANAGED_DOCS`) do NOT enter the human_review allow-list. Those files should have been committed during the implement phase via `autoCommitCode()` using the handoff Changes table at [validation.ts:617](../../scripts/run-task/validation.ts:617); if they are dirty at human_review, today's die fires unchanged. The Affected Files carve-out narrows `PIPELINE_MANAGED_DOCS` from "all allowed" to "only those listed in Affected Files" — it does not widen the allow-list to any new file category. This keeps the change a strict tightening of today's behavior.

When `commitHumanReviewFiles` encounters a dirty file outside the new union, today's hard-die at [main.ts:938](../../scripts/run-task/main.ts:938) fires with an **updated, actionable error message**:

> `Human review commit aborted: working tree has dirty files outside the human_review allowlist.`
> `  <path>`
> `The allowlist is: tasks/<id>/, PIPELINE_TELEMETRY_FILES, and PIPELINE_MANAGED_DOCS entries listed in your spec's '### Affected Files' table.`
> `If this is a managed doc this task legitimately edits, add it to spec.md '### Affected Files' and rerun.`
> `If this is a source or test file, it should have been committed during the implement phase — investigate why it is dirty now (cross-pipeline contamination from a sibling worktree's managed-doc sync is one possibility) and revert with: git checkout HEAD -- <path>`

The other three gates ([main.ts:949](../../scripts/run-task/main.ts:949) empty-allowed-set, [main.ts:961](../../scripts/run-task/main.ts:961) pre-stage check, [main.ts:985](../../scripts/run-task/main.ts:985) post-stage check) keep their existing die messages unchanged — they now naturally die on more cases (managed docs outside Affected Files) but the message shape is intentionally the same to minimize blast radius.

**Additionally**, when a dirty file is in the resolved `affectedManagedDocs` set (which is `PIPELINE_MANAGED_DOCS ∩ spec.AffectedFiles` by construction) and gets committed, an advisory warning fires per file before the stage loop:

> `WARNING: docs/codebase-map.md has uncommitted edits and is in PIPELINE_MANAGED_DOCS — run \`git diff HEAD -- docs/codebase-map.md\` to verify these are this task's work before --ship.`

The warning is advisory (does not block); it's the operator's nudge to spot-check for the same-file overlap residual (see Known Risks).

The Affected Files set is parsed once at the top of `commitHumanReviewFiles` by reading each task's `tasks/<id>/spec.md`, locating the `### Affected Files` H3 table inside the `## Design` section, and extracting the first column with the same strict grammar as `parseHandoffPathCell()` ([validation.ts:665](../../scripts/run-task/validation.ts:665)). The parsed paths are then **filtered to the intersection with `PIPELINE_MANAGED_DOCS`** to produce `affectedManagedDocs: Set<string>`. For bundles, the filtered set is the union across tasks. `affectedManagedDocs` is threaded through `humanReviewAllowedPath()` (widened signature) and `buildHumanReviewStagePaths()` (widened signature) so all four gates see the same union. Non-managed paths from Affected Files are intentionally dropped at this filter — they are not part of the human_review allow-list.

## Non-Goals

- **Fix 1 (pre-`--pr` base-drift check)** — separate task, BACKLOG line 460. Catches Mode 1 and a wider set of Mode 2 cases by diffing against `origin/<base>`. Independent of this fix.
- **Worktree-to-worktree managed-doc sync rewrite** — BACKLOG entry at [docs/BACKLOG.md:467](../../docs/BACKLOG.md). Required for the same-file-overlap residual; intentionally deferred.
- **Warn-and-skip behavior for out-of-scope dirty files** — v1 of this task (archived at [tasks/_archive/scope-pr-auto-commit-to-affected-files/](../../tasks/_archive/scope-pr-auto-commit-to-affected-files/)) tried this approach and hit five spec_review CRs on the gate-state-machine interactions. v2 keeps die semantics at every gate; the only change is the allow-list shape and one error message.
- **Hard-fail mode flag / `--force` escape** — no new flag. The remediation steps in the error message are sufficient.
- **`autoCommitCode()` (implement-phase commit)** — already scoped via the handoff Changes table at [validation.ts:617](../../scripts/run-task/validation.ts:617). Not touched.
- **`mirrorHumanReviewDocsToCwd()`** at [main.ts:642](../../scripts/run-task/main.ts:642) — REPO_ROOT → worktree mirroring stays as-is. The mirror only writes to *clean* destination paths (line 650 explicitly skips dirty dests), so it isn't the contamination vector.
- **Changing the spec template structure** beyond a one-line note under `### Affected Files`. The parser meets the existing H3-under-`## Design` shape.
- **Forcing all in-flight tasks to update their specs.** Specs written before this change may omit managed docs that QA touches. Their `--pr` will die with the new actionable message; operator fix-forward is to add the missing entry. Not a regression — the current bug is the opposite shape (over-permissive).

## Acceptance Criteria

- [ ] AC-1: `parseAffectedFilesFromSpec(taskId: string)` is exported from [scripts/run-task/validation.ts](../../scripts/run-task/validation.ts) with signature `(taskId: string) => { files: string[]; malformed: Array<{ cell: string; reason: string }> }` — same shape as `parseHandoffChangesRows` at [validation.ts:617](../../scripts/run-task/validation.ts:617). Implementation reads `tasks/<taskId>/spec.md`, extracts the body of the `## Design` section via `extractSectionBodies(content, /^## Design\b/)` from `markdown-table.ts`, parses the `### Affected Files` H3 table via `parseTableH3(designBody, 'Affected Files')`, and applies `parseHandoffPathCell` to each first-column cell. Returns paths from `kind === 'ok'` cells in `files` and the cell + reason from `kind === 'malformed'` cells in `malformed`. Verify by reading the source.

- [ ] AC-2: When `tasks/<taskId>/spec.md` is missing, unreadable, has no `## Design` section, or has no `### Affected Files` H3 inside `## Design`, the parser returns `{ files: [], malformed: [] }` without throwing. Verify with four unit-test fixtures in `tests/run-task-validation.test.ts`: (a) positive — spec with three valid rows returns three paths; (b) missing spec.md file → empty result; (c) spec.md without `## Design` → empty result; (d) spec.md with `## Design` but without `### Affected Files` H3 → empty result.

- [ ] AC-3: `humanReviewAllowedPath()` at [main.ts:637](../../scripts/run-task/main.ts:637) is widened to signature `(taskIds: string[], affectedManagedDocs: ReadonlySet<string>, filePath: string) => boolean`. The body returns `true` iff: `path` is `tasks/<taskId>` or starts with `tasks/<taskId>/` for some taskId, OR `PIPELINE_TELEMETRY_FILES.includes(path)`, OR `affectedManagedDocs.has(path)`. No reference to `PIPELINE_SHARED_DOCS` remains in the function body. The intersection-with-`PIPELINE_MANAGED_DOCS` filter happens at the caller (AC-5), so the function body itself does not need to re-check `PIPELINE_MANAGED_DOCS`. Verify by reading the source.

- [ ] AC-4: `buildHumanReviewStagePaths()` at [main.ts:660](../../scripts/run-task/main.ts:660) is widened to signature `(taskIds: string[], affectedManagedDocs: ReadonlySet<string>, dirtyEntries: readonly PorcelainEntry[]) => string[]`. The body iterates `task-dirs ∪ PIPELINE_TELEMETRY_FILES ∪ [...affectedManagedDocs]` instead of `task-dirs ∪ PIPELINE_SHARED_DOCS`. The function still returns only paths that appear in `dirtyEntries`. Verify by reading the source.

- [ ] AC-5: `commitHumanReviewFiles()` at [main.ts:887](../../scripts/run-task/main.ts:887) builds the resolved `affectedManagedDocs` set ONCE at the top of the function (after `mirrorHumanReviewDocsToCwd`, before the porcelain query). For each task ID, call `parseAffectedFilesFromSpec(taskId)`; for each `f` in `parsed.files`, add to `affectedManagedDocs` only if `splitWorktree.PIPELINE_MANAGED_DOCS.includes(f)` — the intersection filter happens here so the helper signatures stay clean. Emit `warn()` per malformed cell with the message `"<taskId> spec.md Affected Files row malformed: <reason>"` (task ID prefix matters for bundle mode). The resolved `affectedManagedDocs` set is then passed into all three `humanReviewAllowedPath()` call sites at lines 938, 961, 985 and into `buildHumanReviewStagePaths()` at line 947. Verify by reading the source: a single parse-filter-union call site, the filtered set passed downward; non-managed Affected Files entries are dropped at this filter and never reach the allow-list helpers.

- [ ] AC-6: The die message at [main.ts:938](../../scripts/run-task/main.ts:938) is updated to the multi-line actionable form from Decision (includes the path, the allow-list shape naming "PIPELINE_MANAGED_DOCS entries listed in your spec's '### Affected Files' table", the managed-doc remediation, the source/test-file remediation, and the "git checkout HEAD --" remediation). The die at lines 949, 961, and 985 keep their existing messages unchanged. Verify by reading the source and checking the new message string contains all of: the substring "allowlist", "PIPELINE_MANAGED_DOCS", "Affected Files", "implement phase", and "git checkout HEAD --".

- [ ] AC-7: When a path is in the resolved `affectedManagedDocs` set AND appears in `dirtyEntries`, a one-line advisory `warn()` fires before the stage loop with the exact text: `"WARNING: <path> has uncommitted edits and is in PIPELINE_MANAGED_DOCS — run \`git diff HEAD -- <path>\` to verify these are this task's work before --ship."` The file IS committed (the warning is advisory, not blocking). The warning fires once per matching path. (`affectedManagedDocs` is already filtered to managed docs by AC-5, so the check is just `affectedManagedDocs.has(path)`.) Verify with a unit test: spec lists `docs/codebase-map.md` in Affected Files, worktree has dirty `docs/codebase-map.md`, function emits exactly one advisory warning matching the path and proceeds to commit.

- [ ] AC-8: `tests/run-task-validation.test.ts` covers `parseAffectedFilesFromSpec`: the four cases of AC-2 plus (e) malformed row (cell content `` `<path>` ``) appears in `malformed` with a reason mentioning "template placeholder"; (f) backtick form (`` `path/foo.ts` ``) and markdown-link form (`[path/foo.ts](url)`) both extract correctly via `parseHandoffPathCell` (one smoke test each, not full re-coverage of `parseHandoffPathCell`'s rules).

- [ ] AC-9: `tests/run-task-safety.test.ts` covers `commitHumanReviewFiles`'s allow-list semantics: (a) **out-of-scope managed doc dies** — spec lists no managed docs, worktree has dirty `docs/codebase-map.md`, function dies with the new multi-line message; (b) **in-scope managed doc commits + advisory** — spec lists `docs/codebase-map.md`, worktree has dirty `docs/codebase-map.md`, function commits and emits exactly one advisory warning; (c) **telemetry file commits without advisory** — worktree has dirty `docs/lessons-learned.md`, spec doesn't list it, function commits without any advisory warning; (d) **bundle union** — `task-a` lists `docs/codebase-map.md`, `task-b` lists `docs/patterns.md`, bundle invocation with both dirty commits both; (e) **malformed row warning** — spec has one valid row + one row with `` `<path>` `` placeholder, function emits the task-ID-prefixed malformed warning and treats the placeholder cell's content as absent from the allow-list; (f) **non-managed Affected Files entry dies** — spec lists `scripts/run-task/main.ts` (a source file, not in `PIPELINE_MANAGED_DOCS`) in Affected Files, worktree has dirty `scripts/run-task/main.ts`, function dies with the new multi-line message and the file is NOT committed (proves the Affected Files carve-out is restricted to `PIPELINE_MANAGED_DOCS` and cannot smuggle late source edits into the PR); (g) **mixed managed + non-managed entries** — spec lists both `docs/codebase-map.md` and `tests/run-task-safety.test.ts` in Affected Files, worktree has dirty `docs/codebase-map.md` only (the test file is clean), function commits the managed doc and emits the advisory; same spec with worktree dirty `tests/run-task-safety.test.ts` only dies (proves per-path filtering, not all-or-nothing). Follow the existing fixture pattern at [tests/run-task-safety.test.ts:1428](../../tests/run-task-safety.test.ts:1428).

- [ ] AC-10: `.canon/templates/spec.md` and `templates/.canon/templates/spec.md` both gain a one-line note immediately under `### Affected Files`: `"> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row."`. Both files updated in the same commit (per `feedback_canon_delimited_files_template_parallel_edit` memory — installed `canon upgrade` pulls from `templates/` and lags root edits). Verify by reading both files.

- [ ] AC-11: `docs/pipeline-orchestrator.md` `## Auto-Branch + Auto-Commit` section is updated. The current sentence at [docs/pipeline-orchestrator.md:216](../../docs/pipeline-orchestrator.md:216) (`"At human_review with --push or --pr, the orchestrator auto-commits task artifacts, telemetry, and the managed docs listed in PIPELINE_MANAGED_DOCS before pushing."`) is replaced with prose naming the new allow-list (`{tasks/<id>/**, PIPELINE_TELEMETRY_FILES, (PIPELINE_MANAGED_DOCS ∩ files listed in spec.md '### Affected Files')}`), explaining the die behavior on out-of-scope dirty files, calling out explicitly that non-managed Affected Files entries (source/test files) do NOT enter the human_review allow-list and must be committed in implement phase, and the advisory warning when a managed doc is committed via Affected Files. Verify by reading the updated section.

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Add exported `parseAffectedFilesFromSpec(taskId: string): { files: string[]; malformed: Array<{ cell: string; reason: string }> }`. Place adjacent to `parseHandoffChangesRows` at [validation.ts:617](../../scripts/run-task/validation.ts:617). Implementation: `fs.readFileSync(taskDirFor(taskId) + '/spec.md', 'utf8')` wrapped in a try/catch that returns `{ files: [], malformed: [] }` on any read failure; `extractSectionBodies(content, /^## Design\b/)`; if no Design body, return empty; `parseTableH3(designBody, 'Affected Files')` for each design body; for each row's first column value, call `parseHandoffPathCell(firstColumn)`; `kind === 'ok'` → `files.add(path)`; `kind === 'malformed'` → `malformed.push({ cell, reason })`. Return `{ files: [...files], malformed }`. |
| `scripts/run-task/main.ts` | (1) Widen `humanReviewAllowedPath` signature to `(taskIds: string[], affectedManagedDocs: ReadonlySet<string>, filePath: string)`; replace `splitWorktree.PIPELINE_SHARED_DOCS.some(...)` with `splitWorktree.PIPELINE_TELEMETRY_FILES.includes(filePath) || affectedManagedDocs.has(filePath)`. (2) Widen `buildHumanReviewStagePaths` signature to `(taskIds: string[], affectedManagedDocs: ReadonlySet<string>, dirtyEntries: readonly PorcelainEntry[])`; replace the `for (const relPath of PIPELINE_SHARED_DOCS)` loop with two loops — one over `PIPELINE_TELEMETRY_FILES`, one over `affectedManagedDocs` — both adding to `stagePaths` only if a dirty entry matches. (3) Inside `commitHumanReviewFiles`, after `mirrorHumanReviewDocsToCwd(cwd)` and before the porcelain query at line 893, insert: `const affectedManagedDocs = new Set<string>(); for (const taskId of taskIds) { const parsed = splitValidation.parseAffectedFilesFromSpec(taskId); for (const f of parsed.files) { if (splitWorktree.PIPELINE_MANAGED_DOCS.includes(f)) affectedManagedDocs.add(f); } parsed.malformed.forEach(m => warn(\`${taskId} spec.md Affected Files row malformed: ${m.reason}\`)); }`. The `PIPELINE_MANAGED_DOCS` filter is critical: it ensures that non-managed Affected Files entries (source/test files) do NOT enter the allow-list. (4) Update the three `humanReviewAllowedPath(taskIds, ...)` call sites at lines 938, 961, 985 to pass `affectedManagedDocs` as the new second argument; update `buildHumanReviewStagePaths(taskIds, dirtyEntries)` at line 947 to pass `affectedManagedDocs` as the new second argument. (5) Replace the `die()` message at line 940-944 with the multi-line actionable form from Decision. (6) After `const stagePaths = new Set(buildHumanReviewStagePaths(...))` at line 947, iterate the staged set: for each path where `affectedManagedDocs.has(path)` (already filtered to managed docs by step 3), emit one `warn()` matching AC-7's text. |
| `tests/run-task-validation.test.ts` | Add `describe('parseAffectedFilesFromSpec', ...)` block covering AC-2 (a-d) and AC-8 (e-f). Use `fs.mkdtempSync` for isolated fixture dirs per the test-writing-pitfalls memory in [docs/patterns.md](../../docs/patterns.md) "Test-writing pitfalls". |
| `tests/run-task-safety.test.ts` | Add `describe('commitHumanReviewFiles allow-list', ...)` block covering AC-9's five cases. Follow the existing fixture pattern at line 1428: build a temp git repo with a worktree, populate the dirty state, populate `tasks/<id>/spec.md` with the desired Affected Files table, invoke `commitHumanReviewFiles` (use `createPR=false` to avoid `gh` requirement), assert on the resulting commit and any captured warn/die output. |
| `.canon/templates/spec.md` | Add the one-line note under `### Affected Files` per AC-10. |
| `templates/.canon/templates/spec.md` | Same edit, same commit (parallel-edit per memory). |
| `docs/pipeline-orchestrator.md` | Update the `## Auto-Branch + Auto-Commit` section per AC-11. |

### Interaction Dependencies

- **`syncWorktreeTelemetry` and worktree-to-worktree managed-doc sync** ([scripts/run-task/worktree.ts](../../scripts/run-task/worktree.ts)) — unchanged. The sync is the contamination vector; this task only catches the resulting bad commit attempt at the die gate. Sync rewrite is a separate BACKLOG entry.
- **`autoCommitCode()` (implement-phase commit)** — unchanged. Implement commits are already scoped via the handoff Changes table; Affected Files is a `--pr`-only construct.
- **`commitTaskArtifactsToBase()`** ([git.ts:83](../../scripts/run-task/git.ts:83)) — unchanged. Commits only `tasks/<id>/**` to base; orthogonal.
- **`reportOrCreatePR()` / `createDraftPRForTask()`** — unchanged. Downstream of the commit; only affected via "commit didn't happen, no PR opens" path.

### Data Model Changes

None. No `status.json` schema changes. Template structural change is a single one-line note inside the existing `### Affected Files` H3 — does not alter the table format or section position.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — run the full suite
- [ ] `build` — N/A; no build step beyond type-check
- [ ] `E2E` — N/A; no UI

## Docs Impact

- **`docs/codebase-map.md`** — the `## Pipeline Orchestration` table already points at `validation.ts` for handoff parsing; the new `parseAffectedFilesFromSpec` is discoverable from the existing pointer. QA-phase Claude audits.
- **`docs/patterns.md`** — "Validation Gate Discipline" pattern already covers the parser-extension shape. Optionally add a Known Pitfalls entry distilling the v1 lesson ("downgrading a die to a warn in a tightly-coupled function with multiple gates means enumerating every gate's interaction first — the operator-facing simplicity of warn-and-skip can mask the implementation cost"); QA decides.
- **`docs/decisions.md`** — "Auto-commit owned by the orchestrator" decision still holds. The narrowing is consistent with its rule.
- **`docs/lessons-learned.md`** — QA distills the contamination-Mode-2 + path-level-allow-list limitation lesson plus the v1 → v2 pivot lesson.
- **`docs/pipeline-orchestrator.md`** — updated per AC-11.

## Known Risks

- **Same-file overlap residual.** When two parallel tasks both list the same managed doc in their Affected Files (both legitimately edit `docs/codebase-map.md`), the path-level allow-list lets both through and the leaked content from sibling sync still lands in the PR. AC-7's advisory warning is the operator's signal to spot-check. The structural fix is the sync rewrite (BACKLOG entry at [docs/BACKLOG.md:467](../../docs/BACKLOG.md)). Flag in `done.md` so the human knows the residual exists and what catches it.
- **QA legitimately edits a managed doc not in Affected Files.** If QA-phase Claude updates `docs/codebase-map.md` as part of the QA "Docs Freshness" sweep but the spec didn't list it, `--pr` dies with the new actionable message. Recovery: operator adds the file to spec's Affected Files (then reruns `--pr`) or reverts the QA edit. AC-10's template note is the proactive nudge; Claude should list managed docs Claude expects QA to touch when authoring the spec.
- **Spec written before Affected Files convention extended.** Existing in-flight tasks may have managed docs that QA touches without spec listing. Their `--pr` will die with the new message and the operator fixes forward by updating Affected Files. Not a regression — the current bug is over-permissive.
- **Parser-only safety net for malformed Affected Files.** A malformed row (placeholder `` `<path>` `` slipping past spec_review) means that path isn't in the allow-list. The dirty file then dies at line 938 with the new actionable message. AC-5's task-ID-prefixed malformed warning at the top of `commitHumanReviewFiles` is the secondary signal so the operator knows the spec row is the culprit (not contamination).
- **`tests/run-task-safety.test.ts` fixture complexity.** Behavior tests require simulating a worktree with dirty files + a populated spec.md. Follow the existing pattern at line 1428. Use non-gitignored fixture names per the test-writing-pitfalls memory.
- **Telemetry contamination residual (NOT addressed by v2).** `PIPELINE_TELEMETRY_FILES` (`lessons-learned.md`, `task-quality-log.md`, `pipeline-invocations.md`) stay auto-allowed. The original v2 framing claimed these "aren't the contamination vector" because they're append-only — that was wrong. Append-only is operation-level; the appended content can carry per-task references (task IDs, file paths) that propagate via worktree sync into sibling task PRs the same way managed-doc content does, just per-row instead of per-section. v2 explicitly does NOT close this — the allow-list is a strict tightening of today's behavior, so the telemetry shape is the same as today (not regressed, not fixed). The structural fix belongs in the deferred sync rewrite (BACKLOG entry at [docs/BACKLOG.md:467](../../docs/BACKLOG.md)): telemetry appends should land in REPO_ROOT only, never in worktrees that then sync content across pipelines.
- **Delicate surface.** `commitHumanReviewFiles` is on canon-ai's listed delicate surface ("Auto-commit logic" in [docs/product-context.md](../../docs/product-context.md)). Full-tier review chain with upgraded model is appropriate. The change is allow-list-narrowing only — no die path is added, removed, or relaxed, and no new file category enters the allow-list. The new die at 938 fires on a strict superset of today's die cases: it dies on (a) managed docs not listed in Affected Files (new — today these were allowed unconditionally) and (b) all paths that died today (task-dir-outside paths, non-managed source/test files, etc. — unchanged). Non-managed paths listed in Affected Files die exactly as they would have today; the Affected Files carve-out is intersected with `PIPELINE_MANAGED_DOCS` precisely so it cannot create a new commit path for source/test files. Other gates (lines 949, 961, 985) fire on exactly the same shape of cases as today plus the natural consequence of the narrowed `humanReviewAllowedPath` check.

## Human Test Plan

> Simulates the original cross-pipeline contamination Mode 2 by hand.

1. From `release/v1.4` with the merged fix in place, create two side-by-side tasks: `canon task new task-a "..."` and `canon task new task-b "..."`. Write a spec for `task-a` that lists `docs/codebase-map.md` in its `### Affected Files` table. Write a spec for `task-b` that lists a *different* file (e.g. `docs/patterns.md`) but NOT `docs/codebase-map.md`.
2. Run `canon run task-a` to implement and edit `docs/codebase-map.md` legitimately.
3. Simulate the sibling-pipeline sync leak: copy `task-a`'s modified `docs/codebase-map.md` into `task-b`'s worktree manually.
4. In `task-b`, write a trivial change to the file `task-b`'s spec DOES list. Run `canon run task-b --pr`.
5. Expected: the orchestrator dies before opening the PR with a message naming `docs/codebase-map.md` as outside the allow-list. The message lists the allow-list shape, suggests adding to Affected Files OR running `git checkout HEAD -- docs/codebase-map.md`. The PR does NOT open.
6. Operator runs `git checkout HEAD -- docs/codebase-map.md` in the `task-b` worktree, then reruns `canon run task-b --pr`. PR opens with only `task-b`'s in-spec changes.
7. Repeat with the same-file overlap case: list `docs/codebase-map.md` in BOTH specs' Affected Files, run the leak simulation, run `--pr` on `task-b`. Expected: the file IS committed (same-file residual; path-level allow-list can't distinguish), AND a one-line advisory warning fires inviting the operator to `git diff HEAD -- docs/codebase-map.md` to spot-check before `--ship`.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry checked (or "None" with justification)
