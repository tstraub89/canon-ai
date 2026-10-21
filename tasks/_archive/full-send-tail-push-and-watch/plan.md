# Implementation Plan: full-send-tail-push-and-watch

> Written by: Claude | Implements: `tasks/full-send-tail-push-and-watch/spec.md`

## Approach

Two independent changes, plus a hint fix and docs:

1. **Watch** (`src/cli/commands/watch.ts`). Add one predicate, `isFullSendTailPending(status)`, and consult it in the three classifiers that currently treat `human_review` as a stop: `classifyIdle`, `classifyAttach` and `orchestratorStillProgressing`. In that state a live pid means "keep blocking", and otherwise `findCrashEvidence` decides between `death` and the existing `checkpoint` / `nothing_to_watch` fallthrough.
2. **Tail push** (`src/orchestrator/git.ts` + `src/orchestrator/main.ts`). Add a safe-to-push predicate to `git.ts`: exact subject regex, single parent, every changed path under `tasks/` or in `PIPELINE_TELEMETRY_FILES`. It has a pure `*FromData` seam and a probe wrapper. A new `pushScaffoldBaseCommitsForFullSend()` in `main.ts` runs inside the full-send tail branch, right before `commitHumanReviewFiles(taskIds, cwd, true)`. It fetches, lists, classifies, and pushes `<tipSha>:refs/heads/<base>`, or dies.
3. **Hint** (`src/orchestrator/phases/implement.ts`). Print the `Scaffold committed` line only when a no-fetch probe finds an unpushed safe-to-push commit. Use full-send wording when every task is full-send. If the probe fails, print today's advice.

Why this placement: the push lives in the tail branch of `runPhase('human_review')`, not inside `commitHumanReviewFiles`. That function also serves `--pr`/`--push`, and the spec requires those paths to stay unchanged. Placing it there keeps `--pr`/`--push` byte-identical with no new flag threaded through `cliArgs`. It also leaves the #103 drift-gate rewrite inside `commitHumanReviewFiles` untouched.

### Feasibility check

- **Exists:** all of these were confirmed by grep/read:
  - In `src/cli/commands/watch.ts`: `classifyIdle` (l.416), `classifyAttach` (l.324), `findCrashEvidence` (l.391), `orchestratorStillProgressing` (l.520), and `reportInitialFailure`'s `death` case (l.693).
  - In `src/orchestrator/git.ts`: `getUnpushedBaseCommits` (l.174, `git log origin/<base>..<base> --format=%H%x09%s`), `gitSafeAt` / `gitSafeAtRaw` (l.43/49), and `commitTaskArtifactsToBase` (l.111).
  - `PIPELINE_TELEMETRY_FILES` (`src/orchestrator/worktree.ts:9`, already imported in `git.ts`).
  - In `src/orchestrator/main.ts`: `shouldRunFullSendTail` (l.1162), the tail branch calling `commitHumanReviewFiles(taskIds, cwd, true)` (l.~2834), and `die`/`info`/`warn` aliases (l.112–114).
  - `StatusJson.full_send?: boolean` (`types.ts:105`).
  - Canon task-id regex `^[a-z0-9][a-z0-9._-]*$` (`src/task/index.ts:65`).
  - Test helpers: `makeGitFixture`, `setupDivergentBaseRepo`, `makeHumanReviewPendingStatus`, `setupFakeGit`, `setupFakeCliTools`, `runNodeInline`, `childEnvWithoutTasksOverride`, `combinedOutput` (`tests/run-task-safety.test.ts`), plus `makeContext`, `makeStatus`, `writeExitLog`, `exitLine`, `runWatchCommand`, `makeClock` (`tests/watch.test.ts`).
- **Real path:**
  - Tail: `main()` → `runPhase('human_review')` → `shouldRunFullSendTail` → `checkPhaseGate` loop → **[new push]** → `commitHumanReviewFiles` → `verifyBaseDivergence`. That gate re-fetches and re-lists, so it already re-checks whatever the push left behind (e.g. the AC-7 operator commit).
  - Watch: `watchCmd` → `classifyAttach` (initial, post-wait, per-poll) → `orchestratorStillProgressing` → grace → `classifyIdle`. Today, the `human_review` early return in `classifyIdle` (l.447) and the `currentPhase !== 'human_review'` skip in `classifyAttach` (l.368) are exactly what hide the death.
- **Callers:**
  - `classifyIdle` / `classifyAttach` / `orchestratorStillProgressing`: only `watchCmd` and `tests/watch.test.ts` call them (`grep -rn` in `src/`).
  - `classifyIdle` gains a new `live` kind. `summarizeIdle` and `watchCmd`'s idle switch must handle it (Step 2).
  - `getUnpushedBaseCommits`: its contract is unchanged; it is reused as-is.
  - `commitTaskArtifactsToBase`: has one caller (`implement.ts`). See the deviation note below.
- **Tests that can fail:** every red-first test is listed with its red input in the Testing Plan (AC-1/2/3/4/8 red against pre-change code; the AC-5 rename variant is red against a `--name-only -M` check; AC-7 is red against a push of the branch name).
- **Predicates:** subject regexes, path rule, parent count, empty range, and the hint's three-way result are spelled out with their boundaries in Steps 1 and 4.
- **Scope:** every file in the steps is in the spec's Affected Files. Deviation: the spec's Affected Files row says `commitTaskArtifactsToBase` "reports whether it committed". No caller needs it, because the spec's hint rule keys on the unpushed-commit probe (which also counts commits left by an earlier call), not on whether this call committed. **Do not add the return value.** Recorded in `notes.md` `[plan]`.
- **Async/stateful:**
  - Watch is a poll loop over files. Live-pid precedence handles a resumed tail behind a stale marker from its own earlier death. `findCrashEvidence`'s mtime freshness rule handles stale markers from earlier runs.
  - Push: the operator could commit concurrently, which is handled by pushing the SHA, not the branch name (AC-7).
  - Re-entry after a partial tail (push succeeded, later gate died): the next run's list is empty, so there is no push and no line.
  - Bundles: `shouldRunFullSendTail` is all-tasks (`every`), so the push runs once per invocation.

### Unattended decisions (recorded for veto)

- The new internal `IdleClassification` kind `live` is never emitted as a summary reason. The spec's "no new watch reason or exit code" holds.
- When some unpushed commit disqualifies, canon prints one `info` line naming the first disqualifying commit and why, then falls through to the existing divergence die. This is additive diagnostics, and it adds no new failure path.
- A fetch failure in the tail now dies (spec: fail closed). Previously `verifyBaseDivergence` warned and skipped on a fetch failure. Under full-send the PR push needs the network anyway, so this is an accepted behavior change.

## Steps

### Step 1: Safe-to-push predicate in `git.ts`

Files: `src/orchestrator/git.ts`

Add these near `getUnpushedBaseCommits`:

```ts
const CANON_TASK_ID_PATTERN = '[a-z0-9][a-z0-9._-]*'; // mirrors the id check in src/task/index.ts
const SCAFFOLD_ARTIFACTS_SUBJECT = new RegExp(`^task\\(${CANON_TASK_ID_PATTERN}\\): commit artifacts pre-pipeline$`);
const SCAFFOLD_TELEMETRY_SUBJECT = new RegExp(
    `^chore: absorb pre-implement telemetry into scaffold for ${CANON_TASK_ID_PATTERN}(?:, ${CANON_TASK_ID_PATTERN})*$`,
);

export function isScaffoldCommitSubject(subject: string): boolean;

export type SafeToPushVerdict = { safe: true } | { safe: false; reason: string };

export function classifySafeToPushCommitFromData(input: {
    subject: string; parentCount: number; paths: readonly string[];
}): SafeToPushVerdict;

export function classifySafeToPushCommit(sha: string, subject: string, cwd: string):
    | { ok: true; verdict: SafeToPushVerdict }
    | { ok: false; stderr: string };
```

Rules for `classifySafeToPushCommitFromData`, in this order:

1. If `!isScaffoldCommitSubject(subject)`, return `{ safe: false, reason: 'subject is not a canon scaffold subject' }`. The regexes are anchored `^…$` (whole-subject match). A suffix (`… pre-pipeline (amended)`), a prefix (`wip: task(x): …`), an empty subject, or `task()` all fail.
2. If `parentCount > 1`, return `{ safe: false, reason: 'merge commit' }`. A root commit (`parentCount === 0`) is allowed; its paths come from `--root`.
3. Find the first path `p` that is neither `p.startsWith('tasks/')` nor in `PIPELINE_TELEMETRY_FILES`, and return `{ safe: false, reason: \`changes ${p} outside tasks/ and pipeline telemetry\` }`. A root-level file named exactly `tasks` does **not** qualify. An empty `paths` (empty commit) qualifies, since it carries no content.
4. Otherwise return `{ safe: true }`.

`classifySafeToPushCommit` probes the commit:

- It checks the subject first and returns `{ ok: true, verdict }` without probing when the subject fails. This keeps git calls off the common "operator commit" path.
- Parents: `gitSafeAt(cwd, 'rev-list', '--parents', '-n', '1', sha)` → `stdout.split(/\s+/).filter(Boolean).length - 1`. If the result is not ok or has no tokens, return `{ ok: false, stderr }`.
- Paths: `gitSafeAtRaw(cwd, 'diff-tree', '--no-commit-id', '--root', '-r', '--name-only', '--no-renames', '-z', sha)` → `stdout.split('\0').filter(Boolean)`. If the result is not ok, return `{ ok: false, stderr }`.
  - `--no-renames` splits a rename into delete + add, so the outside pre-image is reported. That makes the `docs/patterns.md` `--name-status` pitfall inapplicable.
  - `-z` avoids C-quoting (`docs/patterns.md`, "Porcelain output C-quotes paths").
  - `--root` makes a root commit list its files.
  - A merge emits nothing under `diff-tree -r` without `-m`/`-c`, which is why merges are rejected on parent count, not on paths.

Also add the hint probe, which does not fetch:

```ts
/** true/false = whether local <base> has an unpushed safe-to-push commit; null = probe failed. */
export function hasUnpushedScaffoldCommits(baseBranch: string, cwd: string): boolean | null
```

- It calls `getUnpushedBaseCommits(baseBranch, cwd)`. If that is not ok, return `null`.
- Otherwise it iterates the commits through `classifySafeToPushCommit`. Any `ok: false` returns `null`. The first `safe: true` returns `true`. If neither happens, return `false`. An empty list returns `false`.

Do **not** change `commitTaskArtifactsToBase`'s signature (see the Scope deviation).

### Step 2: Watch reports a dead tail, keeps watching a live one

Files: `src/cli/commands/watch.ts`

1. Add a predicate near `findFirstBlockedPhase`:
   ```ts
   // Full-send task whose post-QA tail (scaffold push + draft PR) has not finished.
   function isFullSendTailPending(status: StatusJson): boolean {
       return status.full_send === true
           && status.status === 'human_review'
           && (status.phases.human_review?.status ?? 'pending') === 'pending';
   }
   ```
2. Extend `IdleClassification` with `| { kind: 'live'; state: string; pid: number }`. In `summarizeIdle`, add `case 'live': throw new Error('summarizeIdle called for live result');`, following the `reportInitialFailure` `live` precedent.
3. Make two changes to `classifyIdle`, inside `if (state === 'human_review') {` and before the checkpoint return:
   ```ts
   if (isFullSendTailPending(status)) {
       if (orchestratorLive) return { kind: 'live', state, pid: ctx.resolvedPid as number };
       const crashReason = findCrashEvidence(ctx, taskId, probeAlive, primaryTaskId, orchestratorLive);
       if (crashReason) return { kind: 'death', state, pid: ctx.resolvedPid ?? undefined, reason: crashReason };
   }
   ```
   A live pid takes precedence over any marker, and is checked first. With no pid and no evidence, the existing checkpoint return runs unchanged.
4. In `classifyAttach`, inside `if (status) {` and before the existing `currentPhase` block (i.e. after the `launchWindow` check):
   ```ts
   if (isFullSendTailPending(status)) {
       if (orchestratorLive) return { kind: 'live', pid: ctx.resolvedPid as number, state };
       const heartbeatPrimary = …same primaryId derivation as below…;
       const reason = findCrashEvidence(ctx, taskId, probeAlive, primaryId, orchestratorLive);
       if (reason) return { kind: 'death', state, hint: `run \`canon run ${taskId}\` to resume`, reason };
   }
   ```
   Hoist the existing `heartbeatPrimary` / `primaryId` lines so both blocks share them. Leave the `currentPhase !== 'human_review'` guard on the existing block as it is, because non-full-send behavior is unchanged.
5. In `orchestratorStillProgressing`, after the blocked check: `if (isFullSendTailPending(status)) return true;` (liveness was already established above), then the existing return. Update the function's header comment to say that a full-send tail at pending `human_review` is still progressing, not a stop.
6. In `watchCmd`'s idle tail, right after `const idleResult = classifyIdle(...)`:
   ```ts
   if (idleResult.kind === 'live') {
       reportPhasePointer(freshCtx);
       if (parsed.follow) tailRunLog(freshCtx, taskId, { stderr }, tailState, rememberedPrimaryTaskId ?? undefined);
       continue;
   }
   ```
   This must come before `emitSummary`. Add no `case 'live'` to the exit switch, because TS narrowing after the `continue` makes it unreachable. If TS exhaustiveness still demands one, return the same `continue` behaviour.
7. Make no change to `findCrashEvidence`, `--until`/`phaseSettled`, `reportInitialFailure` (its `death` case already prints `canon watch: <reason>; run \`canon run <id>\` to resume` and exits 4), or heartbeat code.

### Step 3: Full-send tail push in `main.ts`

Files: `src/orchestrator/main.ts`

Add this next to `shouldRunFullSendTail`:

```ts
function pushScaffoldBaseCommitsForFullSend(taskIds: string[], cwd: string): void {
    const baseBranch = splitGit.getBaseBranch(taskIds);
    const fetchResult = splitGit.gitSafeAt(cwd, 'fetch', 'origin', baseBranch);
    if (!fetchResult.ok) die(`Full-send tail aborted: could not fetch origin/${baseBranch} (${fetchResult.stderr || 'unknown error'}). Nothing was pushed.`);
    const unpushed = splitGit.getUnpushedBaseCommits(baseBranch, cwd);
    if (!unpushed.ok) die(`Full-send tail aborted: could not list unpushed ${baseBranch} commits (${unpushed.stderr || 'unknown error'}). Nothing was pushed.`);
    if (unpushed.commits.length === 0) return;
    for (const commit of unpushed.commits) {
        const result = splitGit.classifySafeToPushCommit(commit.sha, commit.subject, cwd);
        if (!result.ok) die(`Full-send tail aborted: could not inspect ${commit.sha.slice(0, 7)} on ${baseBranch} (${result.stderr || 'unknown error'}). Nothing was pushed.`);
        if (!result.verdict.safe) {
            info(`Full-send: not pushing ${baseBranch}; ${commit.sha.slice(0, 7)} ${commit.subject} is not safe to push (${result.verdict.reason}).`);
            return; // the divergence gate in commitHumanReviewFiles dies as today
        }
    }
    const tipSha = unpushed.commits[0].sha;
    const push = splitGit.gitSafeAt(cwd, 'push', 'origin', `${tipSha}:refs/heads/${baseBranch}`);
    if (!push.ok) die(
        `Full-send tail aborted: pushing ${baseBranch} scaffold commits to origin failed: ${push.stderr || 'unknown error'}\n` +
        `The base branch may be protected. Push or merge these commits to origin/${baseBranch} manually ` +
        `(they carry only task artifacts and pipeline telemetry), then re-run \`canon run ${taskIds.join(' ')}\`.`,
    );
    info(
        `Full-send: pushed ${unpushed.commits.length} unpushed ${baseBranch} commit(s) to origin/${baseBranch} ` +
        `(canon scaffold subjects; only task artifacts and pipeline telemetry):\n` +
        unpushed.commits.map(c => `  ${c.sha.slice(0, 7)}  ${c.subject}`).join('\n'),
    );
}
```

- **Tip choice:** `commits[0]` is the tip. Once merges are rejected, the range is a linear single-parent chain, and `git log` walks such a chain newest-first. The push sends the listed SHA, never the branch name, so a concurrent operator commit on `<base>` stays local. The divergence gate's own re-list then catches it (AC-7).
- **Call site:** in the `shouldRunFullSendTail` branch, after the `checkPhaseGate` loop and immediately before `commitHumanReviewFiles(taskIds, cwd, true);`: `pushScaffoldBaseCommitsForFullSend(taskIds, cwd);`.
  - A rejected phase gate therefore pushes nothing.
  - `--allow-divergent-base` needs no special handling: the push runs first, and the existing override then applies to whatever remains.
- **Dies go through `die`, not the throwing `git()` helper.**
- **Message phrases pinned by tests:** `Full-send: pushed`, `may be protected`, `Nothing was pushed`.
- **Fake-git compatibility:** existing fake-git full-send tests keep passing. `setupFakeGit` answers `fetch origin main` with exit 0 and `log origin/main..main` with empty output by default, so the new step returns before any unrecognized git call.

### Step 4: Accurate scaffold hint

Files: `src/orchestrator/phases/implement.ts`

Replace the unconditional `info(...)` after `commitTaskArtifactsToBase(...)`:

```ts
const scaffoldBase = getBaseBranch(taskIds);
const unpushedScaffold = hasUnpushedScaffoldCommits(scaffoldBase, REPO_ROOT);
const allFullSend = taskIds.every(id => readStatus(id).full_send === true);
if (unpushedScaffold === null || (unpushedScaffold && !allFullSend)) {
    info(`Scaffold committed to local ${scaffoldBase}; run \`git push origin ${scaffoldBase}\` to keep origin in sync and avoid base-divergence at --push/--pr/--ship.`); // today's text, unchanged
} else if (unpushedScaffold) {
    info(
        `Scaffold committed to local ${scaffoldBase}; the full-send tail pushes unpushed ${scaffoldBase} commits ` +
        `that carry only task artifacts and pipeline telemetry, and stops if any other commit is unpushed on ${scaffoldBase}.`,
    );
}
```

- Import `hasUnpushedScaffoldCommits` from `../git.js` and `REPO_ROOT` from `../env.js`.
- `commitTaskArtifactsToBase` uses process-cwd `git()` (REPO_ROOT), so probe the same checkout.
- The three-way result:
  - `false` → no line, including the no-commit, nothing-unpushed case.
  - `null` → today's advice, whatever the full-send state.
  - `true` → wording chosen by `every()` full-send (`docs/patterns.md`, bundle `every()`).

### Step 5: Docs

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` (via `npm run sync-templates`), `README.md`

- **Watch exit-code table** (l.~37/40):
  - The `0` row adds that for a full-send task at pending `human_review` the checkpoint is reported only after the orchestrator has exited with no crash evidence.
  - The `4` row adds that a dead full-send tail (the post-QA push/PR step died at `human_review`) reports as a crash. While the orchestrator pid is alive during the tail, watch keeps blocking even if the heartbeat is stale.
- **`--full-send` row** (l.~100): before opening the draft PR, the tail pushes unpushed `<base>` commits whose subject is a canon scaffold subject and whose changes stay under `tasks/` and pipeline telemetry. It pushes the checked tip SHA, not the branch, and stops at the base-divergence gate if any other commit is unpushed.
- **Scaffold-to-base paragraph** (l.~302): the `Scaffold committed` hint prints only when local `<base>` has unpushed scaffold commits. Under full-send it says the tail pushes them.
- **Base-divergence paragraph** (l.~351): under `--full-send`, safe-to-push commits (exact scaffold subject; only `tasks/`/telemetry paths, renames split; no merges) are pushed before this gate runs. A fetch, probe or push failure aborts the tail. `--push`/`--pr`/`--ship` are unchanged.
- **README "Git side effects need a flag"** (l.260): extend the `--full-send` sentence. It says that full-send also pushes unpushed base-branch commits that carry only task artifacts and pipeline telemetry before opening the PR, and stops if any other commit is unpushed.
- **Sync and constraints:**
  - `README.md` is not canon-managed, so it needs no mirror.
  - `docs/pipeline-orchestrator.md` is in `CANON_OWNED`, so run `npm run sync-templates`.
  - Adopter-scope rule: describe the behavior without naming canon-ai source paths.
- Leave `docs/decisions.md` and `docs/codebase-map.md` alone; the spec's Docs Impact gives them to QA.

### Step 6: Build

Run `npm run build` and commit `dist/cli/index.js` and `dist/orchestrator/run-task.js`. List both in the handoff Changes table along with the `templates/docs/pipeline-orchestrator.md` mirror.

## Testing Plan

### `tests/watch.test.ts` (AC-1, AC-2, AC-3)

Shared fixture `makeTailStatus(taskDir, fullSend = true)`:

- `makeContext({ taskDir, statusFile, statusResult: { kind: 'ok', file: statusFile, status: { ...makeStatus('human_review', { qa: done, code_review: done/approved, human_review: { status: 'pending', agent: 'human' } }), full_send: fullSend } } })`.
- Write the log with `writeExitLog(taskDir, [exitLine(code, reason, new Date(now).toISOString())])`.
- Backdate `status.json` with `fs.utimesSync(statusFile, now/1000 - 10, now/1000 - 10)`, following `classifyIdle: fresh non-zero marker is death with reason`.

Tests:

- **AC-1:**
  - `classifyIdle` on the code=1 fixture with no pid returns `death`, with `reason` matching the marker reason. *Red:* the pre-change code returns `checkpoint`.
  - The code=0 marker gives `checkpoint`.
  - `full_send: false` with a fresh code=1 marker gives `checkpoint`.
  - `classifyIdle: checkpoint when human_review settled` stays untouched.
- **AC-2:**
  - `classifyAttach` on the AC-1 fixture returns `death` with that reason. *Red:* `nothing_to_watch`.
  - `watchCmd` (`runWatchCommand(['t1'], { gatherContextImpl: () => ctx, probeAliveImpl: throws ESRCH, nowImpl, sleepImpl })`): exit 4, stdout `['state=human_review reason=death\n']`, stderr matches the marker reason and `canon run t1`.
- **AC-3:** ctx with `canonPid`/`resolvedPid: 7777`, `probeAlive` returning true, `heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, NOW - 10 * 60_000) }` (stale), and two variants: no log, or a fresh code=1 log.
  - `classifyIdle(ctx, 't1', () => true, NOW).kind === 'live'`. *Red:* `checkpoint`.
  - `classifyAttach(...).kind === 'live'`. *Red:* `nothing_to_watch`.
  - `orchestratorStillProgressing(...) === true`. *Red:* `false`.
  - `watchCmd(['t1', '--timeout', '30s'])` with that ctx on every gather exits 5 (`reason=timeout`), and stdout contains neither `checkpoint` nor `death`. *Red:* exit 2 `nothing_to_watch` at attach.

### `tests/run-task-safety.test.ts` (AC-4 … AC-8)

**Pure predicate rows** (cheap, no git), on `classifySafeToPushCommitFromData` / `isScaffoldCommitSubject`:

- safe: `task(task-a): commit artifacts pre-pipeline` with `tasks/task-a/spec.md`
- safe: `chore: absorb pre-implement telemetry into scaffold for a, b` with `docs/pipeline-invocations.md`
- unsafe: suffix subject, prefix subject, `task(): …`
- unsafe: `parentCount: 2`
- unsafe: path `src/x.ts`
- unsafe: path `tasks` (no slash)
- safe: empty paths

**New fixture helper** `setupScaffoldDivergentBaseRepo(dir, taskId, extra?: (localDir) => void)`:

- Uses `makeGitFixture` → `{ localDir, originDir }`.
- Commits and **pushes** a tracked `src/module.ts` plus `docs/pipeline-invocations.md`.
- Then, on local `main` and unpushed:
  - (a) `tasks/<id>/spec.md` committed as `task(<id>): commit artifacts pre-pipeline`
  - (b) a `docs/pipeline-invocations.md` edit committed as `chore: absorb pre-implement telemetry into scaffold for <id>` (**spec-review nit: the telemetry positive case**)
- Then runs `extra?.(localDir)`.
- Then does the `checkout -b task/<id>`, `writeTaskStatus(makeHumanReviewPendingStatus(...))`, `writeAffectedFilesSpec(..., [])` as in `setupDivergentBaseRepo`, plus the `handoff.md` with `## Validation Outcomes` that the existing full-send tail tests write (so `checkPhaseGate('human_review')` passes).
- Returns `{ localDir, originDir, localTip }`, where `localTip = rev-parse main` after setup.

**Driver:** drive the tail through `main()` with `process.argv = ['node','canon',taskId,'--full-send']` using the `runNodeInline(..., childEnvWithoutTasksOverride({ PATH: fakeBins… , FAKE_GH_LOG }), localDir)` shape of `main --push blocks when local base has unpushed commits` (real git, fake `claude`/`codex`/`gh` via `setupFakeCliTools`). Assert with `originMain = git --git-dir <originDir> rev-parse main`.

Tests:

- **AC-4 positive** (`extra` adds the copy-case commit (c): `cp src/module.ts tasks/<id>/module-copy.ts`, committed with the exact scaffold subject):
  - `originMain === localTip`
  - output matches `/Full-send: pushed 3 unpushed main commit/` and lists all three short SHAs
  - output does not match `/Base divergence detected/`
  - Don't assert that the PR opened; later gates are out of scope.
  - *Red:* pre-change dies with `Base divergence detected`, and `originMain` is the pre-run value.
- **AC-4 control:** the same fixture with `'--pr'` instead of `'--full-send'` dies with `Base divergence detected`, and `originMain` is unchanged.
- **AC-5:** one test per variant, or one test looping over the variants with a fresh `withTempDir` each. Each variant adds one extra commit via `extra`:
  - arbitrary subject `fix: operator change` touching `src/module.ts`
  - suffix near-miss `task(<id>): commit artifacts pre-pipeline (amended)` touching only `tasks/<id>/x.md`
  - embedded near-miss `wip: task(<id>): commit artifacts pre-pipeline` touching only `tasks/<id>/y.md`
  - exact subject touching `tasks/<id>/z.md` **and** `src/module.ts`
  - exact subject whose only change is `git mv src/module.ts tasks/<id>/module.ts`. This is red against a `--name-only -M` probe, which would report only the `tasks/` path.
  - a merge: `git checkout -b side main~0`, commit `tasks/<id>/side.md` with the scaffold subject, `git checkout main`, make a scaffold commit on main too so the merge is non-trivial, then `git merge --no-ff -m 'task(<id>): commit artifacts pre-pipeline' side`

  Each variant asserts that `originMain` is unchanged, the output matches `/Base divergence detected/`, and there is no `Full-send: pushed` line.
- **AC-6 push rejected:** before running, write an executable `<originDir>/hooks/pre-receive` that does `echo "protected branch hook declined" >&2; exit 1`. Expect:
  - non-zero exit
  - stderr matches `/protected branch hook declined/` and `/may be protected/`
  - `originMain` is unchanged
  - the `FAKE_GH_LOG` file has no `pr create` line
- **AC-6 probe failures:** use the fake-git shape of `main --full-send --force advances to draft PR …` (`setupFakeGit`, `FAKE_GIT_LOG`, status with `full_send`).
  - (i) `FAKE_GIT_BASE_LOG_FAIL=1`: dies with `/could not list unpushed main commits/` and `/Nothing was pushed/`.
  - (ii) `FAKE_GIT_UNPUSHED_BASE_COMMITS=$'abc1234\ttask(task-a): commit artifacts pre-pipeline'`: the `rev-list --parents` probe hits fake git's `unexpected git args` exit 1, and the run dies with `/could not inspect abc1234/`.
  - Both assert that `FAKE_GIT_LOG` has no line matching `/^push origin [^ ]+:refs\/heads\/main$/m` and that `FAKE_GH_PR_STATE_FILE` was not created.
  - Plus (iii), real git: `git remote set-url origin <dir>/missing.git` dies with `/could not fetch origin\/main/` and pushes nothing.
- **AC-7 concurrent operator commit:**
  - Resolve the real git (`execFileSync('sh', ['-c', 'command -v git'])`) before the PATH change.
  - Put a wrapper `git` first on PATH. When `$1 = push`, `$2 = origin`, `$3` ends in `:refs/heads/main`, and the marker file is absent, the wrapper touches the marker and creates an operator commit on `main` with plumbing so the task-branch checkout is untouched:
    - `blob=$(printf 'operator\n' | "$REAL_GIT" hash-object -w --stdin)`
    - `GIT_INDEX_FILE=$OP_INDEX "$REAL_GIT" read-tree main`
    - `… update-index --add --cacheinfo "100644,$blob,src/operator.ts"`
    - `tree=$(… write-tree)`
    - `c=$("$REAL_GIT" commit-tree "$tree" -p main -m 'operator source change')`
    - `"$REAL_GIT" update-ref refs/heads/main "$c"`
    - write `$c` to `$OP_SHA_FILE`
  - In every case the wrapper then does `exec "$REAL_GIT" "$@"`.
  - Assert that `originMain === localTip` (the checked tip), that `git --git-dir <originDir> cat-file -e <opSha>` fails, and that the output matches `/Base divergence detected/` naming the operator commit's short SHA.
  - *Red* against an implementation that pushes `main` by name.
- **AC-8 hint:** base these on `runImplementPhase writes metrics and task artifacts only in the worktree after scaffold commit` (same `spawnSync` + `runImplementPhase` driver).
  - (i) No-commit case: commit **and push** `tasks/<id>/` and the telemetry baseline before running. The output does not match `/Scaffold committed/`. *Red:* the pre-change code prints it.
  - (ii) The existing test (unpushed scaffold, not full-send) keeps asserting exactly one `git push origin main`. It is unchanged and still passes, because the scaffold commit is safe-to-push.
  - (iii) The same as (ii) with `full_send: true` in the status: output matches `/the full-send tail pushes unpushed main commits/` and does not match `/git push origin main/`.

### Validation (AC-10)

Run `npm run build && npm run type-check && npm run lint && npm test`, then `npm run sync-templates:check` and `npm run docs-refs-check`. `dist/` is committed. Per `docs/patterns.md`, subprocess tests must take their cwd from the active worktree (`WORKTREE_ROOT`), as the existing helpers already do.

## Open questions (unattended — interpretation chosen)

- `commitTaskArtifactsToBase` return value: not added. See Feasibility → Scope.
- The hint probe failing under full-send prints today's push advice, per the spec's literal rule, rather than the full-send wording.
