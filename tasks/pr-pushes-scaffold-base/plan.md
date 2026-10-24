# Implementation Plan: pr-pushes-scaffold-base

> Written by: Claude | Implements: `tasks/pr-pushes-scaffold-base/spec.md`

## Approach

Move the scaffold base push out of the full-send tail and into the head of `commitHumanReviewFiles()`. That function is the single funnel for the full-send tail, `human_review --pr/--push`, and `complete --pr/--push`. `verifyBaseDivergence()` gets an opt-in `{ classifyMissingRemote: true }` option. Only `commitHumanReviewFiles` passes it, so `--ship` (`main.ts:2575`) keeps today's code path byte for byte. The push, the re-list and the gate decision then run in `main.ts`, in the order the spec fixes: fetch and list → push → re-list → decide.

Spec review verdict: **approved**, with no nits to carry.

### Feasibility check

- **Exists (searched, not recalled):** `getUnpushedBaseCommits` (`git.ts:203`), `classifySafeToPushCommit` (`git.ts:251`), `hasUnpushedScaffoldCommits` (`git.ts:269`), `gitSafeAt`/`gitSafeAtRaw` (`git.ts:43/49`; neither exposes the exit code, so the `ls-remote` probe follows the `spawnSync` pattern of `probeMergeConflicts`, `git.ts:62`), `verifyBaseDivergence` / `verifyBaseDivergenceFromData` (`validation.ts:1761/1775`), `pushScaffoldBaseCommitsForFullSend` (`main.ts:1382`), `commitHumanReviewFiles` (`main.ts:1500`), `scaffoldCommitHint` (`phases/implement.ts:12`), and the test helpers `setupFullSendTailFixture`, `runFullSendTailFixture`, `setupDivergentBaseRepo`, `makeGitFixture`, `writeExecutable` and `runMainInline` (`tests/run-task-safety.test.ts:1294-1360, 833, 885, 83`).
- **Git behaviour verified live on this machine:**
  - `git ls-remote --exit-code origin refs/heads/<b>` exits 2 when the branch is missing and 128 when the remote can't be reached.
  - ls-remote patterns are **tail-matched**: `ls-remote origin x` printed `refs/heads/feat/x`. The probe must therefore require an exact `refs/heads/<base>` line.
  - `git fetch origin <missing>` exits 128 with `couldn't find remote ref`.
  - `--remotes=origin` matches nested names such as `origin/task/t`.
  - A stale `refs/remotes/origin/*` ref hides commits until `git fetch --prune origin` removes it.
  - `git push origin <sha>:refs/heads/<b>` creates the branch and updates `refs/remotes/origin/<b>`.
  - A non-fast-forward push prints `! [rejected] … (fetch first)`, and git's hint text doesn't contain "protected".
- **Real path:** the three callers are `main.ts:3143-3144` (full-send tail, `createPR=true`), `main.ts:3177` (human_review) and `main.ts:3199` (complete). The tail's separate `pushScaffoldBaseCommitsForFullSend` call already does fetch, list, classify and push. That logic moves; it is not rewritten from scratch. `--ship` uses `verifyBaseDivergence` independently at `main.ts:2575`.
- **Callers of changed contracts:**
  - `verifyBaseDivergence` (the new optional parameter) has two callers: `main.ts:1507`, which opts in, and `main.ts:2575` (`--ship`), which doesn't.
  - `getUnpushedBaseCommits` (new optional upstream-ref parameter, default unchanged) is called from `validation.ts:1791`, `git.ts:270` and `main.ts:1387`, which this task deletes.
  - `scaffoldCommitHint` (parameter removed) is called from `implement.ts:76` and the unit test at `tests/run-task-safety.test.ts:1397-1402`.
  - `pushScaffoldBaseCommitsForFullSend` (removed) is called only from `main.ts:3143`.
- **Tests that can fail:** each new test's red-first input is named in Step 7. On the current code:
  - AC-1, AC-2 and AC-9 die with `Base divergence detected`.
  - AC-4 and AC-4b(i) leave origin without `feat/x`, because the fetch fails and the gate warns and skips.
  - AC-8(a) in full-send mode prints "may be protected".
  - AC-7 in full-send mode dies with `Full-send tail aborted: could not fetch`.
  - AC-6 fails against an implementation that skips the prune: the stale `origin/wip` covers both commits, the range is empty, and the creation push publishes the operator commit.
- **Predicates:**
  - Present remote with `commits.length === 0`: no push and no output.
  - Present remote with length ≥ 1: classify every commit, and push only if all are safe.
  - Missing remote with length 0: push the pinned tip. Missing remote with length ≥ 1: all safe means push the pinned tip; any unsafe commit means the missing-remote block.
  - Probe results: `present`, `missing` (exit 2, or exit 0 with no exact `refs/heads/<base>` line), or `error` (any other exit, or a spawn error, which is treated as a fetch failure).
  - `tipSha` is empty or `rev-parse` fails: this is a list failure and the run dies. One example is a local `<base>` that doesn't exist either; see Notes.
  - The `allowDivergentBase` flag is read only on the present-remote branches.
- **Scope:** every file touched below is in the spec's Affected Files. No `templates/docs/codebase-map.md` or `templates/docs/decisions.md` edits, because both are root-only.
- **Async/stateful:** everything is synchronous `spawnSync`. The stateful hazard is a concurrent base commit between the list and the push. Handle it as `patterns.md` §"Bind a gate or record to the state the action actually used" prescribes:
  - The push uses the tip SHA of the list it checked (present remote: `commits[0].sha`, as today; missing remote: the `tipSha` pinned before the range was listed).
  - The re-list after a successful push is `<pushedSha>..<base>`, so a commit that landed after the list still reaches the gate. The existing concurrent-operator test pins this.
  - Re-entry is idempotent: after a later gate dies, the next run sees an empty range and pushes nothing.

## Steps

### Step 1: git.ts helpers

Files: `src/orchestrator/git.ts`

1. `getUnpushedBaseCommits(baseBranch, cwd, upstreamRef = \`origin/${baseBranch}\`)`. Use `${upstreamRef}..${baseBranch}` in the `log` call. The default keeps every current caller's argv identical, and the existing probe-error shim matches `log origin/main..main`. Don't change the parsing.
2. Add a probe that requires an exact match:

   ```ts
   export type OriginBranchProbe = { kind: 'present' } | { kind: 'missing' } | { kind: 'error'; stderr: string };
   /** Full refs/heads/<base> match: ls-remote tail-matches patterns, so filter its output. */
   export function probeOriginBranch(baseBranch: string, cwd: string): OriginBranchProbe {
       const ref = `refs/heads/${baseBranch}`;
       const result = spawnSync('git', ['ls-remote', '--exit-code', 'origin', ref], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
       if (result.error) return { kind: 'error', stderr: result.error.message };
       if (result.status === 2) return { kind: 'missing' };
       if (result.status !== 0) return { kind: 'error', stderr: (result.stderr ?? '').trim() };
       const exact = (result.stdout ?? '').split('\n').some(line => line.split('\t')[1]?.trim() === ref);
       return exact ? { kind: 'present' } : { kind: 'missing' };
   }
   ```

3. Add `getLocalOnlyBaseCommits(baseBranch, cwd)`, returning `{ ok: true; tipSha: string; commits: {sha, subject}[] } | { ok: false; pruneFailed: boolean; stderr: string }`. Follow these steps in order:
   1. Run `gitSafeAtRaw(cwd, 'fetch', '--prune', 'origin')`. If it fails, return `{ ok: false, pruneFailed: true, stderr }` (later failures return `pruneFailed: false`) so the caller can warn and skip instead of dying.
   2. Run `gitSafeAt(cwd, 'rev-parse', '--verify', `${baseBranch}^{commit}`)`. Then run `gitSafeAtRaw(cwd, 'log', tipSha, '--not', '--remotes=origin', '--format=%H%x09%s')`, which lists from the **pinned SHA**, not the branch name. Parse it like `getUnpushedBaseCommits`; extract a small shared line parser if that reads cleaner.

   The prune is inside this helper so no caller can list from unpruned refs (spec Known Risks).
4. Add `classifyBasePushRejection(stderr: string): 'non-fast-forward' | 'other'`. It returns `'non-fast-forward'` when stderr contains `[rejected]` together with `non-fast-forward` or `fetch first`. A hook or protection rejection prints `[remote rejected]`, which `/\[rejected\]/` does not match, so it classifies as `'other'`.
5. Leave `classifySafeToPushCommitFromData`, `classifySafeToPushCommit`, the subject regexes and `hasUnpushedScaffoldCommits` byte-identical.

### Step 2: validation.ts, opt-in missing-remote classification and the block builder

Files: `src/orchestrator/validation.ts`

1. Extend the signature and leave the default path untouched:

   ```ts
   export type BaseDivergenceResult = { commits: { sha: string; subject: string }[]; ok: boolean; stderr: string; fetchFailed: boolean };
   export type MissingRemoteBaseDivergence = BaseDivergenceResult & { remoteMissing: true; tipSha: string };
   export function verifyBaseDivergence(baseBranch: string, cwd: string, options: { classifyMissingRemote?: boolean } = {}): BaseDivergenceResult | MissingRemoteBaseDivergence
   ```

2. In the fetch-failure branch, keep the `!fs.existsSync(cwd)` early return first. Then, only when `options.classifyMissingRemote` is set, call `probeOriginBranch`:
   - If the result is `missing`, call `getLocalOnlyBaseCommits`.
     - A prune failure warns with today's `Could not fetch origin/<base> (…). Skipping base-divergence check …` text and returns `{ commits: [], ok: true, stderr: '', fetchFailed: true }`.
     - A rev-parse or log failure returns `{ commits: [], ok: false, stderr, fetchFailed: false }`.
     - Success returns `{ commits, ok: true, stderr: '', fetchFailed: false, remoteMissing: true, tipSha }`.
   - If the result is `present` or `error`, fall through to today's warn and `fetchFailed: true`.
3. **Never add `remoteMissing` or `tipSha` keys on the present-remote or `--ship` paths, not even as `undefined`.** `tests/run-task-validation.test.ts` uses `node:assert/strict`, so the clean-path `deepEqual` at line 2374 would fail on an extra key.
4. Add `buildMissingRemoteBaseBlock(baseBranch, entries: { sha; subject; verdict: SafeToPushVerdict }[], modePrefix: string): string`. It returns these lines:
   - `${modePrefix} aborted: origin has no ${baseBranch} branch, and local ${baseBranch} has commits that are on no origin branch:`
   - One line per entry: `  ${sha7}  ${subject}  [canon-safe]`, or `  … [not canon-safe: ${reason}]`.
   - `Fix: push ${baseBranch} yourself (git push origin ${shellQuoteArg(baseBranch)}), then re-run.`
   - `--allow-divergent-base does not apply: the PR has no origin/${baseBranch} to target.`

   Reuse the existing `shellQuoteArg` that `verifyBaseDivergenceFromData` uses.
5. Leave `verifyBaseDivergenceFromData` text unchanged (AC-3 / AC-10).

### Step 3: main.ts, the shared push inside `commitHumanReviewFiles`

Files: `src/orchestrator/main.ts`

1. **Delete** `pushScaffoldBaseCommitsForFullSend` (`main.ts:1382-1418`) and its call at `main.ts:3143`. Leave the multi-branch guard at `main.ts:3126` untouched.
2. Add a private `pushScaffoldBaseCommits(...)` helper, or inline it. A helper is clearer. It runs at the top of `commitHumanReviewFiles`, replacing lines 1506-1520, and must finish before the docs-refs gate. Set `const modePrefix = createPR ? '--pr' : '--push';` (the full-send tail passes `createPR=true`, so it gets `--pr`) and `const rerun = \`canon run ${taskIds.join(' ')} ${createPR ? '--pr' : '--push'}\``. The logic:

   ```text
   d = verifyBaseDivergence(base, cwd, { classifyMissingRemote: true })
   if !d.ok → die(`${modePrefix} aborted: git error checking base divergence: could not list unpushed ${base} commits (${d.stderr || 'unknown error'}). Nothing was pushed.`)
   if d.fetchFailed → return (warning already printed; gate skipped, as today)

   if 'remoteMissing' in d:
       verdicts = classify each commit (inspect failure → die `${modePrefix} aborted: could not inspect ${sha7} on ${base} (…). Nothing was pushed.`)
       if any unsafe → die(buildMissingRemoteBaseBlock(...))            // flag ignored
       push = gitSafeAt(cwd, 'push', 'origin', `${d.tipSha}:refs/heads/${base}`)
       if !push.ok → die(rejectionMessage(..., creating: true))         // flag ignored
       info(commits.length === 0 ? createdLine : pushedLine(created))
       remaining = relist(d.tipSha)  → gate(remaining)
       return

   if d.commits.length === 0 → return                                    // silent
   verdicts = classify each (inspect failure → die as above)
   if all safe:
       tip = d.commits[0].sha
       push = gitSafeAt(cwd, 'push', 'origin', `${tip}:refs/heads/${base}`)
       if push.ok: info(pushedLine); remaining = relist(tip)
       else if !cliArgs.allowDivergentBase: die(rejectionMessage(..., creating: false))
       else: warn(`Scaffold commits were not pushed to origin/${base} (${kind}): ${push.stderr}`); remaining = d.commits
   else remaining = d.commits
   gate(remaining)
   ```

   - `relist(sha)` calls `getUnpushedBaseCommits(base, cwd, sha)`. If the list fails, die with `${modePrefix} aborted: pushed scaffold commits to origin/${base}, but could not re-list unpushed ${base} commits (${stderr}).` This message must not say "Nothing was pushed".
   - `gate(remaining)` is today's code: return if empty. Otherwise, without the flag, `die(verifyBaseDivergenceFromData(remaining, base))`; with the flag, the existing `--allow-divergent-base override: bypassing base-divergence gate. Divergent commits:` warning.
   - Pass no `--force`, no `-f` and no `-u`. Don't pull or rebase.
3. Message texts. Each one names the branch.
   - `pushedLine`: `Pushed ${n} unpushed ${base} commit(s) to origin/${base} (canon scaffold subjects; only task artifacts and pipeline telemetry):` followed by `  sha7  subject` lines, the format the existing test asserts. In the missing-remote non-empty case, append ` and created origin/${base}` after `origin/${base}`, keeping the `Pushed N unpushed <base> commit(s)` prefix.
   - `createdLine`: `Created origin/${base} at ${sha7}; every commit on local ${base} is already on an origin branch, so no new commit was published.`
   - Non-fast-forward rejection: `${modePrefix} aborted: origin/${base} has commits that local ${base} lacks, so canon could not push its scaffold commits.\n${push.stderr}\nFix: on ${base}, run \`git pull --rebase origin ${base}\`, then re-run \`${rerun}\`. A plain pull would create a merge commit, which canon will not push.`
     - It must not contain the word "protected".
   - Any other rejection: `${modePrefix} aborted: pushing ${base} scaffold commits to origin failed: ${push.stderr || 'unknown error'}\nThe base branch may be protected. Push or merge these commits to origin/${base} manually (they carry only task artifacts and pipeline telemetry), then re-run \`${rerun}\`.`
     - When `creating`, add `--allow-divergent-base does not apply when origin has no ${base}.`
   - No string may contain `Full-send` (AC-12). Pick the rejection kind with `classifyBasePushRejection(push.stderr)`.
4. The full-send tail now relies only on `commitHumanReviewFiles(taskIds, cwd, true)`. On a fetch failure it warns and skips instead of dying (AC-7).

### Step 4: implement-time hint

Files: `src/orchestrator/phases/implement.ts`

```ts
export function scaffoldCommitHint(baseBranch: string, unpushedScaffold: boolean | null): string | null {
    if (unpushedScaffold === false) return null;
    return `Scaffold committed to local ${baseBranch}; --pr, --push and full-send push it to origin/${baseBranch} ` +
        `when every unpushed ${baseBranch} commit carries only task artifacts and pipeline telemetry.`;
}
```

- Delete the `allFullSend` computation at `implement.ts:75` and drop the third argument at the call site.
- The wording must avoid `git push origin` (AC-11) and the AC-14 grep patterns ("tail pushes …", "pushes unpushed base commits only when").

### Step 5: CLI help (two independent renderers)

Files: `src/orchestrator/cli.ts`, `src/cli/index.ts`

Per `patterns.md` §"Operator-facing text …", both renderers must change in lockstep, keeping each file's own indentation.

- `--pr`: add `First pushes canon's own unpushed scaffold/telemetry commits on <base> to origin` and `(creating origin/<base> if missing); any other unpushed <base> commit blocks.`
- `--push`: change it to `Same allow-list and scaffold base push as --pr.`
- `--full-send`: add `; pushes canon scaffold commits to base like --pr`, or put it on a second line.
- `--allow-divergent-base`: add `If canon's scaffold base push is rejected, warns and continues.` and `Does not apply when origin has no <base> branch.` `src/cli/index.ts` currently has **no** `--allow-divergent-base` line. Check with `grep -n allow-divergent src/cli/index.ts`; if it's still absent, add the full option block mirroring `cli.ts`, because the spec asks for the same updates in both files.

### Step 6: docs and skill

Files: `README.md`, `docs/pipeline-orchestrator.md`, `.claude/skills/canon-pipeline/SKILL.md`, `docs/codebase-map.md`, `docs/decisions.md`; mirrors via `npm run sync-templates`

- **`README.md:260`:** replace the `--full-send … its tail also pushes unpushed base commits …` clause. The new text: `--pr` and `--push` first push canon's own unpushed scaffold and telemetry commits on the base, the same for full-send; any other unpushed base commit blocks unless `--allow-divergent-base` is set. Keep the rest of the paragraph.
- **`docs/pipeline-orchestrator.md`:**
  - **Line 94 (`--push`):** also pushes canon's scaffold commits to base (see the remote-boundary paragraph).
  - **Line 95 (`--pr`):** the same.
  - **Line 98 (`--allow-divergent-base`):** a rejected scaffold push warns and continues; the flag doesn't apply when origin has no `<base>`.
  - **Line 100 (`--full-send`):** drop the "pushes unpushed base commits only when…" sentence and point to the shared push.
  - **Line 302:** the last sentence of the scaffold paragraph becomes "The scaffold hint is printed only when an unpushed safe scaffold commit is detected; it says `--pr`, `--push` and full-send push the scaffold when every unpushed base commit carries only task artifacts and pipeline telemetry."
  - **Line 353:** rewrite the full-send sentences. The new text names the shared push, all-or-nothing on the classifier and the tip SHA push. It covers a missing `origin/<base>` (prune, local-only range, create the branch, the missing-remote block that the flag doesn't bypass) and the two rejection messages (non-fast-forward → `git pull --rebase`; other → may be protected). It also covers the `--allow-divergent-base` fallback on rejection and the fetch failure that warns and skips.
- **`.claude/skills/canon-pipeline/SKILL.md:74`:** add after "Pushes the task branch": "(first pushing canon's own unpushed scaffold commits on `base_branch`, or creating it on origin if missing)".
- **`docs/codebase-map.md:57`:** add that `commitHumanReviewFiles` pushes canon's classifier-safe scaffold commits ahead of the divergence decision via `probeOriginBranch`/`getLocalOnlyBaseCommits` in `git.ts`. Root copy only.
- **`docs/decisions.md`:** add a new `## --pr/--push push canon's own scaffold commits to base (2026-10)` entry, using the house **Decision / Why / Rule** shape (see line 424). Content:
  - **Decision:** `--pr`/`--push` are consent to push classifier-proven canon scaffold and telemetry commits, and to create a missing `origin/<base>` only when every local-only commit is canon-safe or none exists.
  - **Why:** every non-full-send task needed a manual base push. This reverses the non-goal recorded in `tasks/_archive/full-send-tail-push-and-watch/spec.md` (`--full-send` as the only consent).
  - **Rule:** the classifier and the all-or-nothing rule are the safety. Repos whose main accepts only PRs should use a pushable feature or integration branch as the task's base, or `--allow-divergent-base` plus the squash merge.

  Root only.
- Run `npm run sync-templates` and commit the regenerated `templates/docs/pipeline-orchestrator.md` and `templates/.claude/skills/canon-pipeline/SKILL.md`. **Both must be listed in the handoff Changes table** (`patterns.md` §"Declare templates/ mirrors").

### Step 7: tests

Files: `tests/run-task-safety.test.ts`, `tests/run-task-validation.test.ts`

**Fixture.** Extend `setupFullSendTailFixture(dir, addExtraCommit?, options: { fullSend?: boolean; baseBranch?: string } = {})`:
- `fullSend` defaults to `true`, so existing callers are unchanged. `false` sets `status.full_send = false` and keeps human_review `pending`, so `--pr`/`--push` take the human_review branch (`main.ts:3175`).
- `baseBranch` other than `main`: after pushing `main`, run `git checkout -b <base>`, set `status.base_branch`, then make the scaffold commit. Origin has no `<base>`.

Add a `runScaffoldFixture(fixture, dir, args, env)` that wraps `runMainInline` with `CANON_WORKTREES_ROOT`, `FAKE_GH_LOG` and `FAKE_GH_PR_STATE_FILE`, like `runFullSendTailFixture`. For argv logging, use a git shim in `fixture.fakeBins`: `printf "%s\n" "$*" >> "$GIT_ARGV_LOG"; exec "$REAL_GIT" "$@"`.

**New tests in `run-task-safety.test.ts`.** Each lists its red-first input.

| AC | Test | Key assertions |
|---|---|---|
| AC-1 | `--pr pushes a safe scaffold commit to base` | Origin `refs/heads/main` equals the scaffold tip. The gh log has `pr create`. Stdout matches `/Pushed 1 unpushed main commit\(s\)/` and has no `Full-send` and no `Base divergence detected`. The shim log has exactly one `push origin <tip>:refs/heads/main` line, and that line has no ` -f`/`--force`/` -u`. Red: the old code dies with divergence. |
| AC-2 | `--push pushes a safe scaffold commit to base` | Origin main equals the tip, and `refs/heads/task/task-a` exists on the bare origin. |
| AC-3 | `--pr refuses a safe scaffold plus an operator commit and pushes nothing` | The extra commit writes `operator-source.txt`. Non-zero exit; `Base divergence detected`; both short SHAs; `Fix: git push origin main`. Origin main is unchanged and no `pr create`. |
| AC-3 | Retitle `plain --pr still refuses an unpushed base commit without pushing it` | New title: `plain --pr refuses an unsafe (out-of-tasks/) unpushed base commit without pushing it`. Body unchanged. |
| AC-4 | `--pr creates a missing remote base from an all-safe scaffold` | `baseBranch: 'feat/x'`. Origin `refs/heads/feat/x` equals the scaffold tip; the gh log `pr create` line contains `--base feat/x` (check the fake's argv shape). Red: origin lacks `feat/x`. |
| AC-4b | (i) `--pr`; (ii) `--pr --allow-divergent-base`; (iii) a `pre-receive` hook rejecting `refs/heads/feat/x` with the flag set | Before the run, `git push origin feat/x:refs/heads/task/task-a`. (i)/(ii): origin `feat/x` equals the local tip, the `Created origin/feat/x at` line, and `pr create`. (iii): non-zero, `may be protected`, origin has no `feat/x`, no `pr create`. Read the hook's stdin (`while read o n r; do [ "$r" = refs/heads/feat/x ] && { echo "protected branch rejection" >&2; exit 1; }; done; exit 0`). |
| AC-5 | `missing remote base with an operator commit blocks even with --allow-divergent-base` | Origin has no feat/x; both commits are listed, marked `[canon-safe]` / `[not canon-safe`; output contains `push feat/x yourself` and `--allow-divergent-base does not apply`. In the flagged second run, `git ls-remote origin refs/heads/task/task-a` is empty. |
| AC-6 | `stale origin/* ref cannot hide local-only commits` | AC-5's fixture plus `git update-ref refs/remotes/origin/wip <operatorSha>`. The run blocks with the missing-remote message and origin has no feat/x. Red: drop the prune and the test turns red. |
| AC-7 | `fetch failure skips the base push without dying` | Variants `--pr` and full-send (`setupFullSendTailFixture` default). The shim runs `[ "$1" = fetch ] && { echo "fatal: unable to access 'https://example.invalid/': Could not resolve host" >&2; exit 128; }`. Origin main is unchanged; output matches `/Could not fetch origin\/main/` and `/Skipping base-divergence check/`; no `has no main branch`; output has no `Full-send tail aborted: could not fetch`. Don't assert the exit status. Red (full-send): the old code dies at the fetch. |
| AC-8(a) | `non-fast-forward rejection names git pull --rebase` | Variants `--pr` and full-send. After the fixture is built, a second clone of `originDir` commits and pushes to main. Non-zero; matches `/git pull --rebase/`; `doesNotMatch /protected/i` on combined output; origin main equals the other clone's commit. Red (full-send): the old code says "may be protected". |
| AC-8(b) | Hook rejects `refs/heads/main` (stdin-reading hook), `--pr` | Non-zero; `/may be protected/`; no `Full-send`. |
| AC-8(c) | The same hook, `--pr --allow-divergent-base` | Matches `/Scaffold commits were not pushed to origin\/main/` and `/--allow-divergent-base override/` plus the scaffold's short SHA; `pr create` present; origin main unchanged. The hook must let `task/task-a` through. |
| AC-9 | `--allow-divergent-base still pushes an all-safe scaffold` | Origin main equals the tip; `doesNotMatch /--allow-divergent-base override/`. |
| AC-10 | Fetch count | In the AC-10 full-send fixture with the argv shim, count the `fetch` lines before the `push origin <tip>:refs/heads/main` line: exactly 1. |

**Edits to existing tests in `run-task-safety.test.ts`:**
- `main full-send tail pushes an unpushed scaffold tip SHA…` (`:6512`): `/Full-send: pushed 2 unpushed main commit\(s\)/` becomes `/Pushed 2 unpushed main commit\(s\) to origin\/main/`. Nothing else changes.
- `full-send tail fails closed on a rejected base push and a commit-list probe error` (`:6597`): `/base branch may be protected/i` still matches. The probe-error assertion `/could not list unpushed main commits/` still matches because the new list die keeps that phrase. Change no other assertion.
- `full-send tail leaves every unsafe …` and `… pushes the checked tip but not a concurrent operator commit`: no edits. The concurrent test's shim matches `*:refs/heads/main`; the re-list via `<tip>..main` must surface the injected commit.
- Hint unit test (`:1397`): `scaffoldCommitHint('main', false)` is `null`. `scaffoldCommitHint('main', true)` equals `scaffoldCommitHint('main', null)`; it matches `/--pr, --push and full-send push it/` and doesn't match `/git push origin/`. Retitle to `scaffold hint is absent without safe commits and uses one wording for every mode`.
- `runImplementPhase` hint test (`:5400`, `:5438`): count `/--pr, --push and full-send push it to origin\/main/g` === 1 on the first run, and `doesNotMatch` it on the second.
- `main --push blocks when local base has unpushed commits` and `main --push --allow-divergent-base warns and proceeds …` use `setupDivergentBaseRepo`, whose commit touches root `unpushed-scaffold.txt`. That commit is unsafe, so neither test changes. Confirm both still pass.

**New tests in `run-task-validation.test.ts`** (import the new git helpers into the existing `../src/orchestrator/git.js` import block):
- `probeOriginBranch`:
  - `present` for `main`.
  - `missing` for `feat/x`.
  - `missing` for `x` when origin has `feat/x`: the tail-match guard.
  - `error` after `git remote set-url origin <nonexistent path>`.
- `verifyBaseDivergence` on a local-only `feat/x`:
  - Without options: `deepEqual` `{ commits: [], ok: true, stderr: '', fetchFailed: true }` (AC-13, the `--ship` path).
  - With `{ classifyMissingRemote: true }`: `remoteMissing === true`, `tipSha` equals the local tip, and the commits are the local-only ones.
  - With an unreachable origin and the option set: `fetchFailed: true` and no `remoteMissing` key.
- The existing clean-path `deepEqual` (`:2369`) still passes unchanged.
- `getLocalOnlyBaseCommits` prunes a stale `refs/remotes/origin/wip`.
- `buildMissingRemoteBaseBlock`: exact lines for one safe and one unsafe entry, with a quoted base containing a shell metacharacter.
- `classifyBasePushRejection`:
  - `' ! [rejected]        abc -> main (fetch first)'` → `non-fast-forward`.
  - `'… (non-fast-forward)'` → `non-fast-forward`.
  - `' ! [remote rejected] main -> main (pre-receive hook declined)'` → `other`.
  - `''` → `other`.

**Red-first proof:** for AC-1, AC-4, AC-4b(i), AC-7 (full-send) and AC-8(a) (full-send), run the new test against the pre-change `main.ts`/`validation.ts` (`git stash` only those source files, in the worktree, then pop) and record the red result in the handoff. For AC-6, temporarily skip the prune and confirm it turns red.

### Step 8: build and structural checks

- `npm run build`, then commit `dist/orchestrator/run-task.js` and `dist/cli/index.js`.
- `npm run sync-templates` and `npm run sync-templates:check`.
- AC-12: `git grep -n -E 'pushScaffoldBaseCommitsForFullSend|Full-send tail aborted: (could not|pushing)|Full-send: (pushed|not pushing)' -- src tests dist docs templates README.md .claude .canon` must return 0 hits.
- AC-14: `git grep -n -i -E 'tail (also |first )?pushes (unpushed|the checked|only)|pushes unpushed base commits only when' -- docs templates README.md src .claude` must return 0 hits.
- Then read each AC-14 surface once.

## Testing Plan

- **Unit** (`tests/run-task-validation.test.ts`): the probe, the missing-remote classification versus a fetch failure, the `--ship`-path skip (AC-13), the prune, the block builder, and the rejection classifier.
- **Integration** (`tests/run-task-safety.test.ts`, real bare-origin fixtures plus fake `gh`/`codex`/`claude` and a git argv shim): AC-1 to AC-11, as in the table above.
- **Validation:** `npm run lint && npm run type-check && npm test && npm run build && npm run sync-templates:check && npm run docs-refs-check`.
  - Per `reference_canon_tests_in_claude_worktree`, the run-task-safety linked-worktree guard test is the known unrelated failure inside a Claude worktree. Codex's sandbox may skip `gitDirWritable`-gated tests. Report any skipped test as **skipped**, not passed.
- **Manual:** the spec's Human Test Plan, steps 1–7, at human_review.

## Rollback Plan

This is a pure code and docs revert; there is no data or schema migration. After a revert, `--pr`/`--push` go back to dying on an unpushed scaffold commit, and the full-send tail regains its own push. Any base branches already created on origin, and scaffold commits already pushed, stay on origin. That is harmless: they hold only task artifacts or commits origin already had.

## Notes and interpretations

These are recorded in `notes.md` with the `[plan]` prefix.

1. **Re-list only after a successful push, from the pushed SHA.** When nothing was pushed, local state hasn't changed, so the first list feeds the gate. After a push, the re-list is `<pushedSha>..<base>` rather than `origin/<base>..<base>`. A successful non-force push proves origin holds that SHA, so the re-list doesn't depend on a fetch refspec updating the tracking ref. Both forms agree in the fixtures, because I verified that a SHA push updates `refs/remotes/origin/<base>`.
2. **Local `<base>` missing as well as remote:** today this warns and skips. Now `ls-remote` reports the base missing, `rev-parse` fails, and the run dies with the list-failure message, which fails closed. A PR could never open against that base anyway.
3. **Concurrent commits after creating a missing base:** once the base exists, the re-list feeds the ordinary divergence gate, and the flag applies there. The spec's "the flag changes nothing" covers the pre-creation decisions only.
4. **The list-failure die keeps the existing `git error checking base divergence:` text** and adds `could not list unpushed <base> commits`. That satisfies the spec's "names the base" while leaving AC-10's probe-error assertion unchanged. `--push` runs now get `--push aborted:` instead of the old hard-coded `--pr aborted:`.
5. **Help text:** `src/cli/index.ts` has no `--allow-divergent-base` entry today. Step 5 adds one, because the spec says to make the "same help-line updates" in both files.
