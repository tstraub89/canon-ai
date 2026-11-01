# Spec: ship-merge-method — Let --ship merge with the repo's configured method

> Written by: Claude | Review by: spec reviewer
> Status: draft (revised after spec_review round 1)

## Problem

`canon run <id> --ship` always merges the task PR with `gh pr merge <n> --squash` (`mergeOpenPRsAndPull` in `src/orchestrator/main.ts`). Projects whose repository allows only rebase-merge or merge-commit cannot use canon's merge step. `docs/pipeline-orchestrator.md` §"Note on merge strategy" tells them to merge outside canon and then run `--ship`. That workaround is what forces a guard hook to allow `gh pr merge --rebase/--merge` on task branches.

**Why squash today.** No decision chose it. `--squash` came over unchanged in the 2026-05-07 extraction of the orchestration core. The v1.9.0 release-agnostic docs pass added the "Note on merge strategy" paragraph and explicitly left the behavior unchanged (`tasks/_archive/release-agnostic-surface/spec.md`). `docs/decisions.md` has no entry that selects squash.

**Audit: what in `--ship` depends on squash.** All of the following were traced in code:

- **Merge proof before local branch deletion** (`establishMergeProof`, `establishPRHeadAncestryProof`). This proves the merge from the forge's `MERGED` state and the PR's `baseRefName`, plus `git merge-base --is-ancestor <local tip> <PR headRefOid>`. It never looks for the task's commits on base. GitHub keeps `headRefOid` at the original branch tip under all three methods. **Strategy-agnostic as-is.**
- **`assertOriginTaskBranchAbsent`** compares the remote tip with the merged PR head. **Strategy-agnostic as-is.**
- **Local branch cleanup** uses `git branch -D` (force), and its safety comes from the proof gate, not from ancestry. **Correct as-is.** Only the comment "safe to force — squash-merged" is stale.
- **Telemetry fold, archive commit, quality log.** These read fragments from the merged tree and use fixed commit subjects. No dependence on a merge SHA or message. **Strategy-agnostic as-is.**
- **Scaffold-push classifier and base-divergence gate** (`classifySafeToPushCommit`, `verifyBaseDivergence`). These see only local-only base commits. In the normal flow `--pr` pushes scaffold commits before the PR opens, and the post-merge pull fast-forwards. Later tasks see an empty range under any method. **Strategy-agnostic as-is.**
- **`post-merge-sync`** (`taskPostMergeSync`, `src/task/index.ts`). It compares trees, not patches:
  - rebase-merge behaves exactly like squash;
  - merge-commit usually takes the fast-forward path.
  **Behavior correct as-is.** Its help and output text say "squash".
- **Protected-base flow** (`docs/decisions.md` §"--pr/--push push canon's own scaffold commits to base"). Merge-commit makes the scaffold commit an ancestor of origin's base, so the ship-time pull fast-forwards. That is better than squash. Rebase-merge behaves the same as squash. The decision text ties the escape to "the squash merge" and needs rewording.
- **Failure hazard (pre-existing, confirmed by trace).** In `shipTasks`, `classifyAndPreserveSharedDocDirt` backs up the supervising checkout's safe telemetry appends and reverts them. It does this before the branch switch, the divergence gate and `mergeOpenPRsAndPull`.
  - When `gh pr merge` fails and `isPRMerged` is false, `mergeOpenPRsAndPull` calls `splitCli.die("Failed to merge PR …")`.
  - `restorePreservedSharedDocDirt` never runs, so the operator's telemetry appends survive only as a temp backup whose path was logged.
  - A disallowed merge method is a reliable way to hit this. So are a merge queue, pending required checks, and branch protection, which become more likely once non-squash methods are in use.

The only behavior that is actually hard-coded is the `--squash` argument. Everything else is wording.

## Decision

- **New setting.** Add a repo-level setting `ship.merge_method` to `.canon/config.json`. It takes `"squash"`, `"rebase"` or `"merge"`, and an absent setting means `"squash"`. `--ship` passes the matching `gh pr merge` flag: `--squash`, `--rebase` or `--merge`.
- **Pre-flight check.** Before `--ship` changes anything locally, it checks that the repository allows the configured method, but only when it is about to merge at least one open PR. It reads the repo's allowed-methods settings through `gh`. To know whether any PR will merge, it first lists each task branch's open PRs and tells a confirmed-empty listing apart from an unreadable one. If the listing cannot be read, the method is not allowed, or the settings cannot be read, `--ship` stops before any local change. The message names the configured method, the setting, and the methods the repo allows.
- **Restore on failed merge.** If the merge itself fails and the PR is not merged, `--ship` re-applies any telemetry appends it preserved before it exits.
- **Docs and wording.** Every user-facing string and doc that says `--ship` "squash-merges" now describes the configured method. The "merge outside canon" note becomes documentation of the setting.

Squash remains the default, so repos without the setting behave as before, apart from the new pre-flight read.

## Non-Goals

- **No CLI flag on `canon run` and no auto-detecting the method from repository settings.**
  - No flag, because the method doesn't change from run to run.
  - No auto-detect, because a repo that allows several methods leaves the choice ambiguous, and an explicit setting makes what `--ship` will do readable from the repo.
  - AC-1 pins the setting's only home: `cli.ts` declares no merge-method flag.
- **No change to what the `adopter-bypass-guards` hook allows or denies.** This task only corrects that hook's wording (AC-9).
- **No per-task or per-bundle merge method.**
- **No change to the merge proof, `assertOriginTaskBranchAbsent`, the scaffold classifier, the base-divergence gate, or `taskPostMergeSync` logic.** Wording-only edits to these are allowed.
- **No custom merge commit subject or body**, and no `--subject`, `--body`, `--auto` or `--match-head-commit` on the merge call.
- **No merge-queue support.** A queued or pending merge still fails the merge step, which now at least restores dirt (AC-5).
- **canon-ai's own repo stays squash-only.** `docs/release-process.md` and canon-ai's own `.canon/config.json` are unchanged.
- **Restoring preserved dirt covers only the failed-merge exit.** Other `die` paths between preservation and restore (base switch, divergence gate, pull) are out of scope.

## Acceptance Criteria

- [ ] **AC-1 — Config key parsed and validated.** The `.canon/config.json` parser in `src/orchestrator/docs-freshness.ts` accepts a top-level `ship` object, and `ship` is no longer reported as an unknown key.
  - **Validated independently of `docs_freshness`.** `ship` is validated whether or not `docs_freshness` is present. Today `parseDocsFreshnessConfig` returns early when `docs_freshness` is absent, and that early return must not skip `ship`.
  - **Where the method lives.** A successful load result carries the resolved merge method as a field separate from the docs-freshness `config`, so `config: null` (no `docs_freshness`) still carries the method.
  - **Values:**
    - `merge_method` must be one of `squash`, `rebase` or `merge`;
    - any other value, or a non-object `ship`, makes the load return `ok: false` with a message naming `ship.merge_method` and the allowed values;
    - unknown keys inside `ship` warn through the existing unknown-key path;
    - an absent config file, an absent `ship`, or a `ship` object with no `merge_method` resolves to `squash`.

  Verify with unit tests for:
  - each valid value, with and without `docs_freshness` present;
  - an invalid string and a non-string, each also in a config that has no `docs_freshness`;
  - a non-object `ship`;
  - absent file, absent `ship`, and `ship: {}` each resolving to `squash`;
  - no unknown-key warning for `ship`.

  Also verify that `canon doctor` reports an invalid value as a failure, including in a config with no `docs_freshness`. `src/orchestrator/cli.ts` declares no merge-method flag: `RUN_ARGS` has no merge-method entry in `booleanFlags` or `valueFlags`, and `parseArgs` has no merge-method case. Help prose may name the setting.
- [ ] **AC-2 — Merge uses the configured method.** `--ship` reads the setting from the main checkout, the same root it already uses for config at ship time. It invokes `gh pr merge <n>` with exactly one of `--squash`, `--rebase` or `--merge`, matching the setting. Verify with a ship test per method. Each asserts the fake-gh log with an anchored whole-line match (`/^pr merge <n> --<flag>$/m`, the form the existing `--squash` assertion uses). That rules out any other method flag and the `--subject`, `--body`, `--auto` and `--match-head-commit` flags. The existing literal `--squash` assertion in `tests/run-task-ship.test.ts` becomes the `squash`/default case.
- [ ] **AC-3 — Pre-flight rejects a disallowed method before any local change.** When at least one task branch has an open PR, `--ship` queries the repository's allowed merge methods before preserving or reverting shared-doc dirt, switching branches, or merging. If the configured method is not allowed, `--ship` exits non-zero with a message naming:
  - the configured method,
  - `ship.merge_method` in `.canon/config.json`,
  - the methods the repo allows.

  Verify with a ship test where the fake gh reports the configured method as disallowed. The test asserts:
  - no `pr merge` call;
  - the current branch is unchanged;
  - a pre-seeded safe telemetry append in the supervising checkout is still present and unchanged;
  - task status and `tasks/<id>/` are unchanged.
- [ ] **AC-4 — Pre-flight fails closed on unreadable PR listing or settings, and is skipped only on a confirmed-empty listing.**
  - If the allowed-methods query fails, `--ship` exits non-zero before any local change. The message says the repo's merge settings could not be read.
  - If the open-PR listing for a task branch fails (`gh` exits non-zero, or its output is empty, not JSON, or not an array), `--ship` exits non-zero before any local change. The message says the open-PR listing could not be read and that re-running `--ship` is safe. An unreadable listing is never treated as "no open PR". The shared `findPRNumberExact`/`findOpenPRNumber` helpers keep their `number | null` contract for their other callers; the pre-flight uses a listing path that distinguishes the two cases.
  - Only a successfully parsed empty result (the PR was merged outside canon) skips the pre-flight: no allowed-methods query is made and `--ship` proceeds to its existing cleanup path.
  - When `gh` is unavailable (`ghAvailable` false), `--ship` behaves as it does today and the pre-flight is skipped, because no merge is attempted.

  Verify with ship tests: (a) a fake-gh allowed-methods query failure, (b) a fake-gh `pr list` failure (non-zero exit) with an open PR, and (c) a `pr list` returning malformed JSON, each with the same no-change assertions as AC-3 (no `pr merge` call, branch unchanged, seeded telemetry append untouched, task state unchanged); and (d) an already-merged PR whose fake-gh `pr list --state open` returns `[]` and whose log contains no allowed-methods query. The fake gh gains a `pr list` failure mode and a malformed-output mode (AC-8).
- [ ] **AC-5 — Failed merge restores preserved telemetry dirt.** When the merge step fails and the PR is not merged (the `classifyMergeOutcome` `'fail'` outcome), `--ship` re-applies every preserved telemetry append to the supervising checkout and removes the backups before exiting non-zero. The failure message also tells the operator that no local cleanup ran and that they can fix the cause and re-run `--ship`. If an earlier PR in the same run already merged, the message names it and says the base branch has not been pulled yet.

Verify with a red-first test. The fixture is a worktree-mode ship with:
- a safe telemetry append in the supervising checkout;
- a PR that is explicitly open, with `FAKE_GH_PR_STATE=OPEN` or an equivalent pinned open state. The ship fake's `pr view` otherwise defaults to `MERGED`, which turns the failure into the tolerated path and would make the test pass vacuously;
- fake gh set to fail `pr merge` without merging.

The test asserts that the append is present in the file after exit, that the backup file is gone, and that the exit is non-zero. The test must fail on the pre-change code, where the append is missing.
- [ ] **AC-6 — User-facing text names the real method.**
  - The merge progress line and the `assertNoOpenPRForTask` recovery hint in `src/orchestrator/main.ts` print the configured method, not "squash".
  - The `--ship` help in `src/orchestrator/cli.ts` describes merging with the configured method.
  - The `post-merge-sync` usage, help and output text in `src/task/index.ts` say "merge" generically.
  - Every source comment in those three files that describes `--ship`'s merge as a squash is generalized. Today these sit at `main.ts` ~1841, ~2181, ~2225, ~2532, ~2710 and ~2775, and `task/index.ts` ~1427.

  Verify: `grep -n -i 'squash' src/orchestrator/main.ts src/orchestrator/cli.ts src/task/index.ts` returns only:
  - the `'squash'` method value and the `'--squash'` flag literal in the method mapping or type;
  - help or doc text stating that squash is the default.

  Nothing may describe `--ship` as always squashing.
- [ ] **AC-7 — Docs describe the setting.**
  - `docs/pipeline-orchestrator.md`:
    - replaces the "Note on merge strategy" paragraph with documentation of `ship.merge_method`: its values, its default, and the pre-flight check;
    - updates the `--ship` row in the flag table, the `post-merge-sync` table row and its example comment, and the "Normal sequence" sentence that says `--ship` calls `gh pr merge --squash` itself;
    - adds the pre-flight check to the numbered `--ship` order list as a new first step, and generalizes the merge step;
    - adds the failed-merge re-apply to the "Shared-doc dirt at `--ship`" paragraph;
    - notes the method-dependent cases: merge-commit gives a fast-forward pull in the protected-base flow, and rebase-merge can fail on conflicts that squash would accept.
  - `.canon/README.md` §"Project config (config.json)" documents the `ship.merge_method` key alongside `docs_freshness`, and the mirror at `templates/.canon/README.md` is synced.
  - The `.claude/skills/canon-pipeline/SKILL.md` and `.claude/skills/canon-pipeline/recovery.md` squash references are generalized.
  - `README.md`:
    - its three `--ship` "squash-merge" references say "merges (squash by default; see `ship.merge_method`)";
    - the config section (today headed "Configuring docs freshness") gains a `ship.merge_method` example. The plan decides whether to retitle the section or add a subsection.
  - `docs/decisions.md` adds an entry recording that squash stays the default and other methods are a repo-level config key, not a flag. The entry also records why.
  - The `--pr/--push` decision's "the squash merge" wording becomes method-neutral.
  - `docs/patterns.md` §"Decouple operation-success from cleanup-success" drops the literal `--squash` from the historical description, or marks it historical, and updates its stale line citation.
  - `npm run sync-templates` mirrors the root copies, and `npm run sync-templates:check` and `npm run docs-refs-check` pass.

  Verify: `grep -rn -i 'squash' docs/pipeline-orchestrator.md .canon/README.md .claude/skills/canon-pipeline/ README.md` shows only default/value mentions, and no text tells rebase or merge-commit projects to merge outside canon. Because the grep cannot see the order list or the dirt paragraph, the reviewer reads both.
- [ ] **AC-8 — Fakes stay honest.** Both fake-gh scripts (in `tests/run-task-ship.test.ts` and `tests/run-task-safety.test.ts`):
  - record the merge method flag they receive;
  - answer the allowed-methods query from test-controlled state, with all methods allowed by default so existing ship tests pass unchanged, plus a query-failure mode;
  - support a `pr list` failure mode and a malformed-output mode for the open-PR listing (needed by AC-4);
- support a merge-failure mode in which `pr merge` exits non-zero without marking the PR merged. The safety fake already has `FAKE_GH_MERGE_FAIL`; the ship fake gains an equivalent.

  Every existing ship and safety test passes. `npm test` runs clean.
- [ ] **AC-9 — The guard hook's wording matches.** This task lands after `adopter-bypass-guards`, which is further along. It reconciles every string that task ships claiming `--ship` only squash-merges or that rebase and merge-commit projects must merge outside canon. That includes:
  - the deny reason for the hook's PR-merge rule in `.claude/hooks/canon-guard.mjs`;
  - any README hooks-section restatement;
  - that task's rewording of the `assertNoOpenPRForTask` recovery hint in `main.ts`, which AC-6 then makes method-aware rather than replaces.

  The hook's allow/deny behavior is unchanged. Verify: `grep -n -i 'squash\|outside canon' .claude/hooks/canon-guard.mjs README.md` shows no claim that `--ship` always squashes or that other methods need a manual merge. The hook's existing tests pass, with reason-text assertions updated to the new wording. If `adopter-bypass-guards` has not shipped when this task's pipeline starts, the planner stops and flags it rather than editing a file that does not exist.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/docs-freshness.ts` | Parse and validate the `ship` object and `merge_method`. Expose the resolved method (default `squash`). Stop reporting `ship` as unknown. |
| `src/orchestrator/main.ts` | Tri-state open-PR lookup (found / confirmed none / unreadable) behind `findPRNumberExact`; pre-flight fails closed on unreadable. `mergeOpenPRsAndPull`: method flag from config, method-aware progress line. New allowed-methods pre-flight in `shipTasks` before `classifyAndPreserveSharedDocDirt`. Restore preserved dirt on the `'fail'` merge outcome. Recovery hint in `assertNoOpenPRForTask`. Stale squash comments. |
| `src/orchestrator/cli.ts` | `--ship` help text only. No new flag declarations. |
| `.claude/hooks/canon-guard.mjs` | PR-merge rule deny-reason wording only (AC-9). Behavior unchanged. |
| `templates/.claude/hooks/canon-guard.mjs` | Mirror via `npm run sync-templates`. |
| `tests/canon-guard.test.ts` | Update reason-text assertions to the new wording, if any assert the squash phrasing. |
| `.canon/README.md` | §"Project config (config.json)": document `ship.merge_method`. |
| `templates/.canon/README.md` | Mirror via `npm run sync-templates`. |
| `src/task/index.ts` | `post-merge-sync` usage, help and output wording only. |
| `src/cli/commands/doctor.ts` | Only if needed so the config check's detail or label covers the `ship` key. Invalid values already fail through the shared parser. |
| `tests/run-task-ship.test.ts` | Fake gh: method recording, allowed-methods query with a failure mode, and a merge-failure mode. Per-method merge tests, pre-flight tests (AC-3, AC-4) and the failed-merge dirt-restore test (AC-5). |
| `tests/run-task-safety.test.ts` | Fake gh: allowed-methods query answering (all allowed by default) and method recording. Generalize the stale squash comment near the wrong-base PR test. |
| `tests/docs-freshness.test.ts` | Parser cases for AC-1. |
| `tests/cli.test.ts` | Doctor config check: invalid `ship.merge_method` fails the config check. |
| `docs/pipeline-orchestrator.md` | Replace the merge-strategy note. Update the flag table, the post-merge-sync rows and ship step (3). |
| `templates/docs/pipeline-orchestrator.md` | Mirror via `npm run sync-templates`. |
| `.claude/skills/canon-pipeline/SKILL.md` | Generalize squash wording. |
| `.claude/skills/canon-pipeline/recovery.md` | Generalize squash wording. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirror via sync. |
| `templates/.claude/skills/canon-pipeline/recovery.md` | Mirror via sync. |
| `README.md` | `--ship` descriptions. `ship.merge_method` in the config section. Hooks-section wording, if it restates the squash claim (AC-9). |
| `docs/decisions.md` | New merge-method decision entry. Method-neutral wording in the `--pr/--push` scaffold decision. |
| `docs/patterns.md` | Historical `--squash` mention and stale line citation in §"Decouple operation-success from cleanup-success". |
| `dist/orchestrator/run-task.js` | Rebuilt (`npm run build`). |
| `dist/cli/index.js` | Rebuilt: `docs-freshness.ts` and `src/task/index.ts` bundle into the CLI. |

### Implementation Notes (non-binding; owned by plan/implement)

- **Allowed-methods query.** `gh repo view --json squashMergeAllowed,rebaseMergeAllowed,mergeCommitAllowed` resolves the repo the same way `gh pr merge` does. Map `squash→squashMergeAllowed`, `rebase→rebaseMergeAllowed`, `merge→mergeCommitAllowed`.
- **Deciding whether the pre-flight runs.** It needs to know whether any branch has an open PR before preservation, and `findPRNumberExact` returns `null` for both "no PR" and a failed or malformed `gh pr list`. Split out a lookup that returns a tri-state (found number / confirmed none / unreadable), have `findPRNumberExact` delegate to it so its other callers (`--pr` idempotence, `assertNoOpenPRForTask`, merge-proof lookups) keep their behavior, and hoist the discovery so `mergeOpenPRsAndPull` can reuse the pre-flight's result instead of querying twice.
- **Restore on failed merge.** `restorePreservedSharedDocDirt` is a closure in `shipTasks`, and `die` calls `process.exit`, so `try`/`finally` won't run. Either pass the closure in, or have `mergeOpenPRsAndPull` return a failure that `shipTasks` handles before dying.
- **Where the method lives in the load result.** For example, add `shipMergeMethod` beside `config` on the `ok: true` result. Doctor's detail line, which keys off `config === null`, may mention it.
- **Config loading.** Run-start already calls `loadDocsFreshnessConfig(REPO_ROOT)` for `--ship`. Thread the resolved method from there rather than re-reading the file.

### Interaction Dependencies

- **Single config file.** Every canon consumer that loads `.canon/config.json` (QA, spec, validation, doctor, run-start) shares the parser. An invalid `ship.merge_method` therefore stops all of them, not just `--ship`, which matches the existing "malformed config stops every consumer" rule. This is intended, and Docs Impact notes it.
- **Bundles and multi-branch ships.** A bundle shares one branch and PR, so it gets one merge with one method. Independent branches shipped together merge in sequence with the same method. If a later PR fails, for example on a rebase conflict, after an earlier one merged, `--ship` dies before the base pull. The result is one PR merged, the base not pulled, and nothing archived. AC-5 restores the telemetry edits and names this state in the message. Recovery is to fix the remaining PR (for example, rebase it) and re-run `--ship`, which treats the already-merged task through its existing external-merge path.
- **Guard hook (`adopter-bypass-guards`).** That task is at plan and lands first. It ships a hook that denies squash/default `gh pr merge` on task PRs, with reason text saying `--ship` squash-merges. It also rewords the `assertNoOpenPRForTask` hint. AC-9 reconciles that wording. Whether the hook should also deny `--rebase`/`--merge` once `--ship` can do them is a separate follow-up.

### Data Model Changes

`.canon/config.json` gains an optional top-level `ship` object, `{ "merge_method": "squash" | "rebase" | "merge" }`. No `status.json` or task-artifact changes.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` (committed `dist/` must match)
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] E2E — N/A, no UI surface

## Docs Impact

- `docs/pipeline-orchestrator.md`, `docs/decisions.md` and `docs/patterns.md` are edited by the implementer (listed in Affected Files).
- `docs/codebase-map.md` may need a line noting that the config parser in `docs-freshness.ts` now also owns `ship` settings. QA corrects it; the implementer does not.
- `docs/architecture.md`: QA checks whether its config description mentions only docs freshness.

## Known Risks

- **Pre-flight adds a network call and a new failure mode** for every repo, including default-squash repos. A transient `gh repo view` failure now blocks a ship that would have succeeded. This is accepted, because it fails closed before any change and a re-run recovers. AC-4 keeps the check away from the already-merged path, so it never blocks cleanup after an external merge.
- **Allowed is not sufficient.** Branch protection, required checks, merge queues and rebase conflicts can still reject an allowed method. AC-5 makes that failure recoverable rather than lossy, but `--ship` still stops.
- **Unreadable listing read as "no PR".** `findPRNumberExact` collapses a failed listing into `null`. If the pre-flight reused it unchanged, a transient `gh pr list` failure would skip the guard and let `classifyAndPreserveSharedDocDirt` revert telemetry and switch branches. AC-4 requires the tri-state lookup and tests exit-code and malformed-output failures. Residual: a listing that succeeds but is stale is indistinguishable from truth and is out of scope.
- **Pre-flight placement.** If the check lands after `classifyAndPreserveSharedDocDirt` or the base switch, AC-3's "no local change" guarantee silently fails. The AC-3 test must seed dirt and assert that it is untouched and the branch is unchanged, not just that the merge was skipped.
- **Shared parser blast radius.** A validation bug in the new `ship` parsing breaks every consumer of `.canon/config.json`, not just ship. AC-1's tests must include absent-key and absent-file cases so default repos can't regress.
- **Early return skips `ship`.** If `ship` validation is added after the parser's existing no-`docs_freshness` early return, a `ship`-only config silently resolves to squash and invalid values pass. AC-1's no-`docs_freshness` cases exist to catch this.
- **Vacuous AC-5 test.** The ship fake reports PRs as `MERGED` by default. Without a pinned open state the failure path never runs, and the normal restore makes the test pass on old code. AC-5 pins the open state.
- **Partial multi-branch ship.** See Interaction Dependencies. The recovery is a re-run, and the message must say so.
- **Fake-gh drift.** Two independent fake-gh scripts exist. Updating only one leaves the other's tests passing vacuously, or failing on the new `repo view` call. AC-8 covers both.
- **Rebase-merge history shape.** Under rebase, the base gains several commits per task, including canon's `chore: QA artifacts …` and `chore: add task artifacts …` commits. This is cosmetic, and changelog tooling that scans `git log` sees more subjects. The ship docs note it, and the setting stays opt-in.

## Human Test Plan

1. In a repo that allows only squash merges, ship a task without any merge setting. Expected: it merges and cleans up exactly as before.
2. Add a merge setting of "rebase" to the project's canon config in a repo that allows rebase merging, then ship a task. Expected: the PR shows as rebased on GitHub, and canon finishes cleanup and archives the task.
3. Set the merge setting to "merge" in a repo that does not allow merge commits, leave an uncommitted telemetry note in the main checkout, and ship. Expected: canon stops before touching anything. It names the setting and the methods the repo allows, and the note and the current branch are unchanged.
4. Set the merge setting to an invalid value and run the doctor command. Expected: the config check fails and names the allowed values.
5. Merge a PR on GitHub yourself, then ship. Expected: canon skips the merge and the settings check and completes cleanup.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — AC-5 fixes a pre-existing bug: the mechanism is a deterministic control-flow trace (`die` in `mergeOpenPRsAndPull` before `restorePreservedSharedDocDirt`), and AC-5 is red-first
- [x] (Refactors) N/A — feature; the Problem audit records each strategy-dependent behavior anyway
