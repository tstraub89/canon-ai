# Implementation Plan: ship-merge-method

> Written by: Claude | Implements: `tasks/ship-merge-method/spec.md`

## Approach

Add `ship.merge_method` (`squash` default | `rebase` | `merge`) to the shared `.canon/config.json` parser. Thread the resolved method from the run-start config load into `shipTasks`. Before `shipTasks` touches anything locally, discover open PRs through a new tri-state lookup (found / none / unreadable), fail closed on unreadable, and, only when at least one open PR exists, check `gh repo view` allowed-methods. `mergeOpenPRsAndPull` reuses the discovered PR numbers, passes the matching flag, and on the `'fail'` outcome returns a failure result so `shipTasks` can re-apply preserved telemetry before dying. Everything else is wording and docs.

Chosen over alternatives: the setting lives in config (not a flag, per spec Non-Goals); `mergeOpenPRsAndPull` returns a result object instead of taking the restore closure (keeps the restore in `shipTasks`, where the closure lives, and makes the failure message a pure, testable builder).

### Feasibility check

- **Exists:** confirmed by search. `parseDocsFreshnessConfig` / `loadDocsFreshnessConfig` (`src/orchestrator/docs-freshness.ts:51,91`), `findPRNumberExact` (`main.ts:2205`), `findOpenPRNumber` (`main.ts:2187`), `mergeOpenPRsAndPull` (`main.ts:2231`), `classifyMergeOutcome` / `isPRMerged`, `shipTasks` (`main.ts:2424`, sole caller `main.ts:4121`), `restorePreservedSharedDocDirt` closure (`main.ts:2559`), `checkDocsFreshness` (`doctor.ts:800`), `mergeReason` in `.claude/hooks/canon-guard.mjs:80`. Both fake-gh scripts exist (`tests/run-task-ship.test.ts:69`, `tests/run-task-safety.test.ts` ~line 296-370).
- **Real path:** `main()` loads config at `main.ts:4058` (`configRoot = REPO_ROOT` for `--ship`) → `shipTasks` (`main.ts:4121`) → gates → `assertTaskBranchPushed` → snapshots → `classifyAndPreserveSharedDocDirt` (`main.ts:2568`) → base switch → divergence gate → prefetch → `mergeOpenPRsAndPull` (`main.ts:2621`). The pre-flight goes after the snapshot loop (needs `branchByTaskId`) and **before** the `taskIds.some(... worktree)` preserve block. `die` is `process.exit`, so no `finally`.
- **Callers:** `findPRNumberExact` callers (`findOpenPRNumber`, `findMergedPRNumber`, closed lookups, `--pr` idempotence at `main.ts:1279/1287/1355`, `assertNoOpenPRForTask`, proof lookups) keep the `number | null` contract: it becomes a thin wrapper over the new tri-state lookup. `mergeOpenPRsAndPull` has one caller (`main.ts:2621`); its return type changes, so that call site is rewritten. `DocsFreshnessLoad` gains a field on the `ok: true` arm; consumers are `main.ts:4058`, `doctor.ts:802`, and `requireDocsFreshnessConfig` (reads `.config` only) plus `tests/docs-freshness.test.ts`. The deepEqual at `tests/docs-freshness.test.ts:98` (`{ ok: true, source: 'defaults', config: null, unknownKeys: [] }`) must gain `shipMergeMethod: 'squash'`; grep that file and `tests/cli.test.ts` for other literal load-result `deepEqual`s.
- **Tests that can fail:**
  - AC-5: fixture pins `FAKE_GH_PR_STATE=OPEN` plus `FAKE_GH_MERGE_FAIL=1`; pre-change code dies with the backup stranded and the append absent, so it is red first. Implementer: write the test and run it against the unmodified `mergeOpenPRsAndPull` flow before step 2's restore change to confirm red.
  - AC-3/AC-4: fixtures hold a pre-seeded telemetry append in a worktree-mode ship. If the pre-flight sat after `classifyAndPreserveSharedDocDirt`, the append would be reverted then stranded or moved, so the "append still present, branch unchanged" assertions fail.
  - AC-4(d): fake `pr list --state open` returns `[]` and the log must contain no `repo view`.
  - AC-1: no-`docs_freshness` configs with `ship` go through the early-return path that would skip `ship` if validation were placed after it.
  - After writing each, temporarily remove the fix (flag arg, pre-flight call, restore call) and confirm red (patterns.md "Prove each regression test can fail").
- **Predicates:**
  - `merge_method`: exact lowercase match against the three strings. `null`, `""`, `"Squash"`, numbers, arrays are invalid. `ship` as `null`, array or string is invalid (use `isObject`). `ship: {}` → `squash`.
  - Allowed-methods JSON: parse; require an object with the configured method's field `=== true` to allow. A non-boolean or missing field for the configured method, non-JSON, empty stdout, or non-zero exit is "could not read" (fail closed). The "allowed" list shown in the message includes only fields that are `=== true`; if none, print "none".
  - Open-PR listing: non-zero exit, empty/whitespace stdout, non-JSON, non-array → unreadable. A parsed array with no entry whose `headRefName === branch` and numeric `number` → `none`. Entries are matched exactly as today.
  - Branch dedupe (bundles share one branch) before listing; zero open PRs → no `gh repo view` call.
  - `ghAvailable === false` → skip the whole pre-flight; `mergeOpenPRsAndPull` behaves as today (no PRs).
- **Scope:** every file below is in the spec's Affected Files. `docs/codebase-map.md` and `docs/architecture.md` are QA's, not touched. `src/cli/commands/doctor.ts` is **not** edited (invalid values already fail through the shared parser; the existing detail strings stay so existing assertions hold); only `tests/cli.test.ts` gains a case.
- **Async/stateful:** synchronous code, one process. No cross-phase state: the method is a `shipTasks` argument, discovered PR numbers are a local map. Re-run after a failed or partial ship is safe: pre-flight is read-only, restore is idempotent (`restorePreservedSharedDocDirt` empties its list). Multi-branch partial case: an earlier PR merged, later fails; failure message names the merged PR(s) and says base not pulled (AC-5).
- **Spec contradictions:** none found. AC-9 prerequisite is met: `adopter-bypass-guards` shipped (#140, commit `54ba350`); `.claude/hooks/canon-guard.mjs` and `tests/canon-guard.test.ts` exist.

## Steps

### Step 1: Parse and validate `ship.merge_method`

Files: `src/orchestrator/docs-freshness.ts`, `tests/docs-freshness.test.ts`

- Export `SHIP_MERGE_METHODS = ['squash','rebase','merge'] as const` and `type ShipMergeMethod`.
- Extend the `ok: true` arm of `DocsFreshnessLoad` with `shipMergeMethod: ShipMergeMethod` (always resolved). Update the ENOENT return in `loadDocsFreshnessConfig` (`shipMergeMethod: 'squash'`) and both returns in `parseDocsFreshnessConfig`.
- In `parseDocsFreshnessConfig`: change the unknown-key filter to exclude `ship` as well as `docs_freshness`. **Before** the `!Object.hasOwn(value, 'docs_freshness')` early return, parse `ship`: absent → `squash`; non-object → `invalid(...)`; `ship` keys other than `merge_method` push `ship.<key>` onto `unknownKeys`; `merge_method` present but not one of the three → `invalid(...)`. Error text must contain `ship.merge_method` and `"squash", "rebase" or "merge"` (the non-object message names the same). Then the early return carries the resolved method, and the full path returns it as well.
- Tests (extend the existing cases near `tests/docs-freshness.test.ts:78-105`): each valid value with and without `docs_freshness`; invalid string and non-string (`1`, `null`) each in a no-`docs_freshness` config; non-object `ship` (`"x"`, `[]`, `null`); absent file, absent `ship`, `ship: {}` → `squash`; `{ship:{merge_method:'rebase'}}` yields no `ship` entry in `unknownKeys`; `ship: {typo:1}` warns `ship.typo`. Fix the line-98 deepEqual.

### Step 2: Tri-state PR lookup, pre-flight, method flag, restore on failed merge

Files: `src/orchestrator/main.ts`

1. Import `ShipMergeMethod` from `./docs-freshness.js`. Add near `classifyMergeOutcome`:
   ```ts
   const MERGE_FLAG: Record<ShipMergeMethod, string> = { squash: '--squash', rebase: '--rebase', merge: '--merge' };
   ```
2. Split `findPRNumberExact`: new `lookupPRNumberExact(branch, baseBranch, state): { kind: 'found'; number: number } | { kind: 'none' } | { kind: 'unreadable'; reason: string }` containing the current body (same `gh pr list` args, same exact-head match). `ghAvailable` false is handled by callers, so the lookup itself assumes gh. `findPRNumberExact` becomes `if (!ghAvailable) return null; const r = lookup...; return r.kind === 'found' ? r.number : null;`. Export `lookupPRNumberExact` only if a test seam needs it; otherwise keep it module-private.
3. Pure helper (exported for tests, follows the `classifyMergeOutcome` pattern): `parseAllowedMergeMethods(stdout: string): { ok: true; allowed: Record<ShipMergeMethod, boolean> } | { ok: false }`, mapping `squash→squashMergeAllowed`, `rebase→rebaseMergeAllowed`, `merge→mergeCommitAllowed`; any of the three non-boolean → `{ ok: false }` (fail closed).
4. Pure helper `formatMergeFailureMessage({ prNum, stderr, mergedEarlier: number[] }): string`: "Failed to merge PR #n: <stderr>" plus "No local cleanup ran; fix the cause and re-run `canon run <ids> --ship`." If `mergedEarlier.length`, add "PR #x already merged; the base branch has not been pulled yet." Pass the quoted id list built the same way `assertNoOpenPRForTask` does (`splitState.shellQuoteArg`).
5. In `shipTasks`, immediately after the snapshot loop and **before** `let preservedSharedDocDirt` / `classifyAndPreserveSharedDocDirt` (currently ~`main.ts:2553-2570`), add the pre-flight:
   - `const openPRByBranch = new Map<string, number>()`. If `ghAvailable`, loop over `[...new Set(branchByTaskId.values())]` in task order: `lookupPRNumberExact(branch, baseBranch, 'open')`. `unreadable` → `splitCli.die` ("--ship aborted: could not read the open-PR listing for <branch>: <reason>. Nothing was changed; re-running `--ship` is safe."). `found` → set map.
   - If `openPRByBranch.size > 0`: `splitGit.runCommand('gh', ['repo','view','--json','squashMergeAllowed,rebaseMergeAllowed,mergeCommitAllowed'])`. Non-ok or `parseAllowedMergeMethods` not ok → die ("could not read the repository's merge settings … nothing was changed; re-running is safe"). If `!allowed[method]` → die naming the method, `ship.merge_method` in `.canon/config.json`, and the allowed list (e.g. `squash, merge`, or `none`).
   - `baseBranch` is already defined at that point (used by the prefetch and divergence code below); confirm the declaration precedes the insertion, else hoist.
6. Signature: `function shipTasks(taskIds: string[], mergeMethod: ShipMergeMethod): void`. At the call site (`main.ts:4121`) pass the method from the run-start load: `docsConfig.ok ? docsConfig.shipMergeMethod : 'squash'` (the `die` on `!ok` already ran; don't assume TS narrows through `die`).
7. `mergeOpenPRsAndPull(taskIds, baseBranch, branchByTaskId, openPRByBranch, mergeMethod)`: replace `findOpenPRNumber(branch, baseBranch)` with `openPRByBranch.get(branch)`; progress line `Merging PR #n (branch → base) via ${mergeMethod}...`; args `['pr','merge', String(prNum), MERGE_FLAG[mergeMethod]]` and nothing else. Return type becomes `{ merged: boolean } | { failed: { prNum: number; stderr: string; mergedEarlier: number[] } }` (track `mergedEarlier` as PRs merged in this loop). On outcome `'fail'` return the failure instead of `die`.
8. In `shipTasks` at the call (~`main.ts:2621`): on the failure result call `restorePreservedSharedDocDirt()` **then** `splitCli.die(formatMergeFailureMessage(...))`. Adapt `const merged = ...` usage to the object (`result.merged`).
9. `assertNoOpenPRForTask` hint: replace "the human can merge PR #n manually and re-run --ship" wording with method-aware text. Keep what `adopter-bypass-guards` put there but make it name the configured method; it needs the method, so add a `mergeMethod: ShipMergeMethod` parameter and pass it from its callers (`main.ts` ~2630, in `shipTasks`). Text such as: "…merge PR #n outside canon (any method) and re-run --ship, or fix the cause. canon merges with `ship.merge_method` (currently <method>)". Read the current hint text first and edit minimally.
10. Generalize the stale squash comments listed in AC-6: `main.ts` ~1841, ~2180, ~2224 (doc comment "squash-merge it"), ~2531, ~2709, ~2774; any others that `grep -n -i squash src/orchestrator/main.ts` finds. The only remaining `squash` hits: the `MERGE_FLAG` mapping.

### Step 3: Fake gh and ship/safety tests

Files: `tests/run-task-ship.test.ts`, `tests/run-task-safety.test.ts`

Fakes (both scripts; mirror the same env names):
- `repo view` handler (before the final "unexpected gh args" fallthrough in the ship fake): `FAKE_GH_REPO_VIEW_FAIL=1` → stderr, exit 1; else print `{"squashMergeAllowed":…,"rebaseMergeAllowed":…,"mergeCommitAllowed":…}` computed from `FAKE_GH_ALLOWED_METHODS` (comma list; default `squash,rebase,merge`). Add `FAKE_GH_REPO_VIEW_MALFORMED=1` printing `not json` if cheap.
- `pr list` failure/malformed modes, applied when the requested state is `open`: `FAKE_GH_PR_LIST_FAIL=1` → exit 1; `FAKE_GH_PR_LIST_MALFORMED=1` → print `not json`, exit 0. (Not for `--state merged`, so later lookups behave unchanged.)
- ship fake `pr merge`: add `FAKE_GH_MERGE_FAIL=1` (stderr + exit 1, state file untouched, so the PR stays open). The safety fake already has it.
- Method recording: both fakes already log `$*` under `FAKE_GH_LOG` (confirm the safety fake does; add if not), so the merge flag lands in the log.

Tests (ship file; use the existing `prepareShipFixture`, `runCanon`, `markTaskWorktree`, `METRICS_SKELETON` helpers, and the setup shape of `--ship failed fold restores…` at ~`tests/run-task-ship.test.ts:1647`):
- AC-2 per-method: write `.canon/config.json` with `ship.merge_method` for `rebase` and `merge` in the fixture's local checkout (and default/absent for squash). Convert the existing `--ship merges without gh --delete-branch…` test (`:1382`) to the default case and add two siblings; each asserts `/^pr merge 107 --<flag>$/m` and `doesNotMatch` of the other two flags.
- AC-3: open PR (`FAKE_GH_OPEN_PR_NUMBER`, `FAKE_GH_PR_HEAD`, `FAKE_GH_PR_BASE`), `FAKE_GH_ALLOWED_METHODS=squash` with config `rebase`, worktree-mode with a seeded safe telemetry append. Assert non-zero exit, stderr names `rebase`, `ship.merge_method`, `squash`; log has no `pr merge`; current branch unchanged; the append is still in the working file; backup temp dir absent of backups; `tasks/<id>/` and status unchanged.
- AC-4: (a) `FAKE_GH_REPO_VIEW_FAIL=1`; (b) `FAKE_GH_PR_LIST_FAIL=1`; (c) `FAKE_GH_PR_LIST_MALFORMED=1`, each with the same no-change assertions as AC-3 and the specific message; (d) already-merged PR with `pr list --state open` returning `[]` (no `FAKE_GH_OPEN_PR_NUMBER`) and the existing merged-PR env, run through the existing happy path, asserting no `repo view` in the log and exit 0.
- AC-5: worktree-mode ship, seeded safe telemetry append, open PR pinned with `FAKE_GH_PR_STATE=OPEN`, `FAKE_GH_MERGE_FAIL=1`, `TMPDIR` pointed at `makeTmpDir(dir)` as in the fold-fail test. Assert non-zero exit, stderr names the PR and says no local cleanup ran and re-running is safe, the append is present, the backup file path from stdout (`backup: …`) no longer exists. Run it red against old code first.
- Pure-helper unit tests for `parseAllowedMergeMethods` (booleans, missing field, non-JSON) and `formatMergeFailureMessage` (with and without `mergedEarlier`; opposite-outcome pair per patterns.md "state-varying pair") if exported.
- Safety file: add the `repo view` handler and update the stale squash comment near ~line 6149 (the wrong-base PR test). Existing safety `--ship` tests must still pass with all methods allowed by default.

### Step 4: Help and `post-merge-sync` wording

Files: `src/orchestrator/cli.ts`, `src/task/index.ts`

- `cli.ts:47` `--ship` help: "Merge the open PR with the configured method (gh pr merge; squash by default, set `ship.merge_method` in `.canon/config.json`), delete its remote branch, …". Keep line wrapping style of neighboring help lines. No new flag in `RUN_ARGS` or `parseArgs`.
- `src/task/index.ts`: `post-merge-sync` summary (line ~63), usage (~77), output text (~1405, ~1420) and the comment (~1427) say "merge"/"PR merge" generically. Check whether a CLI test pins the old help text (`grep -rn 'squash merge\|squash-merge' tests`) and update those assertions with the new wording.
- Check `grep -n -i squash src/orchestrator/cli.ts src/task/index.ts`: only help text stating squash is the default may remain.

### Step 5: Guard hook wording (AC-9)

Files: `.claude/hooks/canon-guard.mjs`, `tests/canon-guard.test.ts`

- `mergeReason`: say `--ship` merges with the project's configured method (`ship.merge_method`, squash by default) rather than "squash-merges", and drop the sentence telling rebase/merge-commit projects to merge manually and then run `--ship` for cleanup; replace with a pointer to `ship.merge_method`. Keep "canon guard:" prefix, `canon run ${ids} --ship` and the bundle sentence verbatim (tests match `/canon run foo --ship/`, `canon run foo baz --ship`). Allow/deny logic (`hasNonSquashStrategy` etc.) untouched.
- `tests/canon-guard.test.ts`: reason assertions at `:301,327,341,447` only match `canon run … --ship`; confirm with a run and adjust only if something pins the old squash phrasing.
- Mirror `templates/.claude/hooks/canon-guard.mjs` via sync (step 7).

### Step 6: Docs

Files: `docs/pipeline-orchestrator.md`, `.canon/README.md`, `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-pipeline/recovery.md`, `README.md`, `docs/decisions.md`, `docs/patterns.md`

- `docs/pipeline-orchestrator.md`: (a) `--ship` flag-table row (~l.100) → "merge … with the configured method (`ship.merge_method`, default squash)"; (b) `post-merge-sync` row (~l.128) and example comment (~l.147) → "after a PR merge"; (c) "Normal sequence" sentence (~l.562) → "`--ship` merges the PR itself with the configured method"; (d) replace "Note on merge strategy" (~l.564) with a `ship.merge_method` paragraph: values, default, the pre-flight (open-PR listing, then `gh repo view` allowed methods; skipped when no open PR / already merged; fails closed before any local change), the method-dependent notes (merge-commit → fast-forward pull in the protected-base flow; rebase can fail on conflicts squash accepts; rebase adds several commits per task to base); (e) "Shared-doc dirt at `--ship`" paragraph: add that a failed merge re-applies preserved telemetry appends and removes the backups before exit, and that a failed later PR after an earlier merged one leaves base unpulled (recovery: fix and re-run); (f) numbered order list: new first step "(1) pre-flight: …", renumber, generalize the merge step. The list is one long paragraph; renumber carefully through the tail items. Keep it read-through correct since the grep can't see it.
- `.canon/README.md` §"Project config (config.json)": document `ship.merge_method` (values, default, pre-flight) beside `docs_freshness`; add a `ship` example to the JSON block. Edit the root only (hook mirrors; step 7 verifies).
- `.claude/skills/canon-pipeline/SKILL.md` (~l.81, 84, 88, 169) and `recovery.md` (~l.12, 91, 100, 102): generalize "squash-merge" to "merge"; keep the genuinely squash-specific recovery symptoms (post-merge divergence) but phrase them as "squash or rebase merge" where true. Semantic care: rebase-merge matches squash for `post-merge-sync`; merge-commit usually fast-forwards.
- `README.md`: lines ~108, ~311, ~349 → "merges (squash by default; see `ship.merge_method`)"; the hooks bullet ~l.277 reconcile (AC-9): drop "Rebase and merge-commit merges remain allowed; after one, run `--ship` for cleanup" as the recommended path, state `--ship` uses the configured method; keep the hook's actual allow/deny behavior described accurately (rebase/merge-commit are still allowed by the hook). Config section (~l.376, "Configuring docs freshness"): add a `### Configuring the merge method` subsection after it (cheaper than retitling and keeps existing anchors that docs may link to; grep `Configuring docs freshness` across repo before deciding, since `.canon/README.md` cites it by name) with a `ship.merge_method` example.
- `docs/decisions.md`: new entry "`--ship` merge method is a repo-level config key, squash by default" with Why: no decision chose squash (extraction carry-over); one repo has one merge convention and a repo allowing several makes auto-detection ambiguous; explicit config makes `--ship`'s behavior readable from the repo; not a CLI flag because it doesn't vary per run. Method-neutralize the "squash merge" wording in the `--pr/--push` scaffold decision (~l.548 region). Root-only file: no `templates/` mirror (patterns.md pitfall); do not add a mirror row.
- `docs/patterns.md` "Decouple operation-success from cleanup-success": mark the `--squash` mention historical ("the pre-AC-14 … `--squash --delete-branch`" already reads historical; reword so no active claim) and replace the stale `main.ts:1397–1401` citation in the sibling "Use the attempted `prNum`" section with the function name `mergeOpenPRsAndPull`. Root-only.
- Verify with: `grep -rn -i squash docs/pipeline-orchestrator.md .canon/README.md .claude/skills/canon-pipeline/ README.md`.

### Step 7: Sync, build, validate

Files: `templates/.canon/README.md`, `templates/docs/pipeline-orchestrator.md`, `templates/.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/hooks/canon-guard.mjs`, `dist/orchestrator/run-task.js`, `dist/cli/index.js`

- `npm run sync-templates` (mirrors only; never edit `templates/` by hand), then `npm run sync-templates:check`.
- `npm run build` (committed `dist/` must match; `docs-freshness.ts` and `src/task/index.ts` bundle into the CLI).
- `npm run lint && npm run type-check && npm test && npm run docs-refs-check`. In a linked worktree expect only the known `run-task-safety` linked-worktree-guard-message failure if the diff doesn't touch it (reference: `npm ci` first).
- Handoff Changes table: declare every root file **and** each `templates/` mirror above (patterns.md: mirrors must be in both Affected Files and the handoff table); `docs/decisions.md` and `docs/patterns.md` have no mirrors.

## Testing Plan

- **Unit**: `tests/docs-freshness.test.ts` (parser, AC-1); `tests/cli.test.ts` (doctor: invalid `ship.merge_method` fails the config check including without `docs_freshness`; use the existing `doctor docs freshness` loop at ~l.4338 by adding `[JSON.stringify({ ship: { merge_method: 'octopus' } }), 'fail', /ship\.merge_method/]`); pure-helper tests for `parseAllowedMergeMethods` / `formatMergeFailureMessage`.
- **Integration (subprocess ship tests)**: `tests/run-task-ship.test.ts` — per-method merge flag, pre-flight reject, query-failure, `pr list` failure and malformed output, already-merged skip, failed-merge dirt restore (AC-2 to AC-5). Guard-hook tests re-run unchanged except for any pinned wording.
- **Regression proof**: for AC-3/4/5 and the per-method flag test, remove the corresponding fix line and confirm red before finalizing.
- **Manual**: the spec's Human Test Plan (requires a live GitHub repo). It is not run here; say so in the handoff.

## Rollback Plan

Revert the commit. The only persisted surface is the optional `ship` object in an adopter's `.canon/config.json`; an older canon would then report `ship` as an unknown key (warning only) and merge with squash. No `status.json` or task-artifact changes, no migrations.
