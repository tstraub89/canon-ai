# Plan: ship-merge-proof — Single-shot --ship with forge-proof merge verification

> Written by: Claude | Spec: `tasks/ship-merge-proof/spec.md`

## Approach

Three orthogonal changes land together:
1. **Pin PR number at `--pr`** — `reportOrCreatePR` writes `pr.number` to every task's `status.json`, commits, and pushes so a later `--ship` can read it without a branch-name query.
2. **Positive merge proof before deletion** — a new proof pass in `shipTasks` establishes forge-proof evidence per task before any teardown; the destructive `git branch -D` is gated on this proof, not the fast-forward.
3. **Ungate fast-forward + tolerate already-deleted remote** — `assertLocalBaseInSyncWithOrigin` pulls instead of dying when the base is strictly behind; `assertOriginTaskBranchAbsent` swallows "remote ref does not exist."

Implementation is ordered foundation-first: types → template → helpers → call-site changes → tests → docs → build.

---

## Step 1 — Add `pr?: { number: number }` to `StatusJson` (`scripts/run-task/types.ts`)

Add the optional field to `StatusJson` above the `phases` field:

```typescript
pr?: { number: number };
```

The TypeScript type is `number` for DX. The on-disk value is treated as untrusted at the boundary in `readPinnedPrNumber` (Step 3b). No migration shim needed — the field is optional and absence is the valid legacy state.

---

## Step 2 — Document the optional field in `.canon/templates/status.json`

Add a `_`-prefixed documentation key after the `"worktree"` key (before `"phases"`), following the existing comment-field convention:

```json
"_pr": "optional: { number: <PR number> } — set by --pr, read by --ship for forge-proof merge verification. Absence is valid (legacy/pre-PR state).",
```

Do **not** add a live `"pr"` key — absence is the correct scaffold default; new tasks start without a PR number.

After writing, run `npm run sync-templates:check` to confirm the mirror alignment; the pre-commit hook auto-syncs `templates/`.

---

## Step 3 — Add three new helpers in `scripts/run-task/main.ts`

Place all three in the "Ship (archive)" section alongside `getMergedPRHeadSha()` and `isPRMerged()` (~line 1443). Keeping the new `gh` query in one place limits the fake-gh test double surface.

### Step 3a — `getPRBaseRefName(prNum: number): string | null`

Reads `baseRefName` from a merged PR. Mirrors `getMergedPRHeadSha` exactly:

```typescript
function getPRBaseRefName(prNum: number): string | null {
    if (!ghAvailable) return null;
    const result = splitGit.runCommand('gh', ['pr', 'view', String(prNum), '--json', 'baseRefName', '--jq', '.baseRefName']);
    if (!result.ok) return null;
    const ref = result.stdout.trim();
    return ref || null;
}
```

### Step 3b — `readPinnedPrNumber(status: StatusJson): number | null`

AC-11b: type the `pr` field as `unknown` at the boundary and narrow explicitly; never cast directly to the declared TypeScript type.

```typescript
function readPinnedPrNumber(status: StatusJson): number | null {
    // Cast through unknown so the compiler forces an explicit narrowing check
    // rather than trusting the declared type against corrupt on-disk data (AC-11b).
    const pr = (status as unknown as { pr?: unknown }).pr;
    if (typeof pr !== 'object' || pr === null) return null;
    const num = (pr as { number?: unknown }).number;
    if (typeof num !== 'number' || !Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
    return num;
}
```

### Step 3c — `MergeProofResult` type alias and `establishMergeProof` function

Add the return-type alias near the other type aliases at the top of the Ship section:

```typescript
type MergeProofResult = { proven: true } | { proven: false; reason: string };
```

Then the function. Proof precedence follows the spec exactly:

```typescript
function establishMergeProof(
    status: StatusJson,
    branchName: string,
    localTip: string,
    baseBranch: string,
): MergeProofResult {
    const pinnedPrNum = readPinnedPrNumber(status);

    if (ghAvailable && pinnedPrNum !== null) {
        // Primary path: pinned PR + gh reachable (AC-2, AC-2b, AC-9).
        if (!isPRMerged(pinnedPrNum)) {
            return { proven: false, reason: `Pinned PR #${pinnedPrNum} is not in MERGED state.` };
        }
        const prBase = getPRBaseRefName(pinnedPrNum);
        if (prBase !== baseBranch) {
            return {
                proven: false,
                reason: `Pinned PR #${pinnedPrNum} was merged into '${prBase ?? 'unknown'}', not '${baseBranch}' (merged into wrong base — AC-2b).`,
            };
        }
        const prHead = getMergedPRHeadSha(pinnedPrNum);
        if (prHead !== localTip) {
            return {
                proven: false,
                reason:
                    `Pinned PR #${pinnedPrNum} head ${prHead?.slice(0, 7) ?? 'unknown'} does not match ` +
                    `local tip ${localTip.slice(0, 7)} — possible branch-name reuse or unpushed commits.`,
            };
        }
        return { proven: true };
    }

    if (ghAvailable) {
        // Fallback: legacy task with no pinned number (AC-5).
        // findMergedPRNumber is already base-filtered (see its doc comment at ~line 1433).
        const mergedPrNum = findMergedPRNumber(branchName, baseBranch);
        if (mergedPrNum !== null) {
            const prHead = getMergedPRHeadSha(mergedPrNum);
            if (prHead === localTip) return { proven: true };
            return {
                proven: false,
                reason:
                    `Fallback merged PR #${mergedPrNum} head ${prHead?.slice(0, 7) ?? 'unknown'} does not ` +
                    `match local tip ${localTip.slice(0, 7)} — possible branch-name reuse (AC-3).`,
            };
        }
        return {
            proven: false,
            reason:
                `No merged PR found for ${branchName} → ${baseBranch}. ` +
                `Verify the PR was merged, then re-run --ship. ` +
                `Recovery: push the branch, confirm via \`gh pr list --head ${branchName} --state merged\`, and re-run.`,
        };
    }

    // gh unavailable — cannot prove.
    return {
        proven: false,
        reason:
            `gh CLI is not available; cannot verify merge proof. ` +
            `Re-run --ship when gh is reachable, or delete the local branch manually (\`git branch -D ${branchName}\`) ` +
            `and re-run to take the no-branch archive path (AC-8).`,
    };
}
```

**Key invariant**: `getMergedPRHeadSha` returns `headRefOid` — the pre-squash task-branch tip that was pushed — not the squash commit on base. Comparing `headRefOid` to `localTip` is why the proof works despite squash-merge severing base-branch ancestry.

---

## Step 4 — Ungate the fast-forward in `assertLocalBaseInSyncWithOrigin` (`main.ts:~1247`)

**Current**: when `behind > 0`, die with a "rebase before --ship" message.

**New**: when `behind > 0 && ahead === 0`, fast-forward with `git pull --ff-only`; when diverged (`behind > 0 && ahead > 0`), die with a clearer message (AC-6).

Update the JSDoc to reflect the new behavior. Replace the `die(...)` call after `if (Number.isNaN(behind) || behind === 0) return;`:

```typescript
// Distinguish pure fast-forward from diverged base.
const localAheadResult = gitSafe('rev-list', '--count', `origin/${baseBranch}..HEAD`);
const ahead = localAheadResult.ok ? Number.parseInt(localAheadResult.stdout, 10) : NaN;
if (!Number.isNaN(ahead) && ahead > 0) {
    die(
        `Local ${baseBranch} has diverged from origin/${baseBranch} (${behind} behind, ${ahead} ahead). ` +
        `Resolve with \`git rebase origin/${baseBranch}\` and re-run --ship.`,
    );
}
// behind > 0, ahead === 0: pure fast-forward — non-destructive, no proof required (AC-6).
info(`Local ${baseBranch} is ${behind} commit${behind === 1 ? '' : 's'} behind origin/${baseBranch}; fast-forwarding...`);
git('pull', '--ff-only', 'origin', baseBranch);
```

The `git()` call (not `gitSafe`) dies if the pull fails, which handles any edge case where `--ff-only` refuses.

---

## Step 5 — Tolerate "remote ref does not exist" in `assertOriginTaskBranchAbsent` (`main.ts:~1397`)

In the merged-PR recovery block, change the unconditional `die` on delete failure to tolerate the "already gone" case (AC-13):

```typescript
const del = splitGit.gitSafe('push', 'origin', `--delete`, branchName);
if (!del.ok) {
    if (del.stderr.includes('remote ref does not exist')) {
        // Remote branch already gone — this is the desired end-state (AC-13).
        splitCli.info(
            `Remote branch ${branchName} is already absent ("remote ref does not exist"). ` +
            `No-op delete — continuing cleanup.`,
        );
    } else {
        splitCli.die(
            `--ship aborted: detected merged PR #${mergedPrNum} for ${branchName}, but ` +
            `\`git push origin --delete ${branchName}\` failed: ${del.stderr.trim() || 'unknown error'}. ` +
            `Delete the remote branch manually and re-run --ship.`,
        );
    }
}
```

All other delete failures still die (unchanged).

---

## Step 6 — Pin the PR number in `reportOrCreatePR` (`main.ts:~840`) — AC-1, AC-1b

### Step 6a — `recordPinnedPRNumber` helper

Add adjacent to `reportOrCreatePR` in the `--pr` section:

```typescript
function recordPinnedPRNumber(
    taskIds: string[],
    prNum: number,
    branchName: string,
    cwd: string,
): void {
    let anyChanged = false;
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        if (readPinnedPrNumber(status) === prNum) continue; // Idempotent
        status.pr = { number: prNum };
        splitState.writeStatus(taskId, status);
        anyChanged = true;
    }
    if (!anyChanged) return;

    // Stage the updated status.json files relative to cwd (worktree or REPO_ROOT).
    for (const taskId of taskIds) {
        gitSafeAt(cwd, 'add', '--', path.join('tasks', taskId, 'status.json'));
    }
    const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
    const pinCommit = gitSafeAt(cwd, 'commit', '-m', `chore: record pr.number for ${label}`);
    if (!pinCommit.ok) {
        // "nothing to commit" is not an error (idempotent re-run); other failures warn.
        if (!pinCommit.stderr.includes('nothing to commit')) {
            warn(`Could not commit pr.number recording: ${pinCommit.stderr.trim()}. Number is persisted on disk.`);
        }
        return;
    }
    const pushResult = gitSafeAt(cwd, 'push', 'origin', branchName);
    if (!pushResult.ok) {
        warn(`Could not push pr.number commit: ${pushResult.stderr.trim()}. Number is persisted on disk.`);
    }
}
```

### Step 6b — Change `reportOrCreatePR` signature to accept `cwd`

```typescript
function reportOrCreatePR(taskIds: string[], branchName: string, cwd: string): void {
    if (!ghAvailable) die('--pr requires the gh CLI, but it is not available.');
    const baseBranch = splitGit.getBaseBranch(taskIds);
    const openPR = findOpenPRNumber(branchName, baseBranch);

    let prNum: number;
    if (openPR !== null) {
        const prUrl = lookupPRUrl(openPR);
        info(formatExistingPRMessage(openPR, prUrl));
        prNum = openPR;
    } else {
        createDraftPRForTask(taskIds, branchName);
        // createDraftPRForTask returns void; look up the just-created PR number.
        const newPR = findOpenPRNumber(branchName, baseBranch);
        if (newPR === null) {
            warn('Could not retrieve PR number after creation — pr.number will not be pinned this run.');
            return;
        }
        prNum = newPR;
    }

    recordPinnedPRNumber(taskIds, prNum, branchName, cwd);
}
```

### Step 6c — Update both call sites in `commitHumanReviewFiles`

`cwd` is already in scope at both call sites:

- Line 1093: `reportOrCreatePR(taskIds, branchName, cwd)`
- Line 1192: `reportOrCreatePR(taskIds, branchName, cwd)`

`reportOrCreatePR` is not exported; these are the only two call sites.

**Ordering**: `reportOrCreatePR` is called after the push at both sites (lines 1091 and 1187 push first), so `recordPinnedPRNumber`'s follow-up commit+push lands after the artifacts commit — both on the same task branch, which is fine.

**Bundle (AC-10b)**: `reportOrCreatePR` already receives all `taskIds`. `recordPinnedPRNumber` iterates them and writes the same `prNum` to every bundle member's `status.json`, then commits/pushes once.

---

## Step 7 — Insert the proof pass in `shipTasks` (`main.ts:~1798`) — AC-2 through AC-10

Insert the following block **after `runPostMergeHook()` and before `const archiveDir = ...`**. This window is the only safe location: merge is complete (PR state is final), worktree teardown has not started (local branches still readable).

```typescript
// Establish merge proof per task before any teardown or branch deletion.
// Bundle all-or-nothing: collect all failures first, then die once (AC-10).
const proofFailures: Array<{ taskId: string; reason: string }> = [];
for (const taskId of taskIds) {
    const branchName = taskSnapshot(taskId).branch;
    if (!splitGit.branchExistsLocally(branchName)) {
        // Local branch absent: deletion is a no-op, no proof required (AC-8).
        continue;
    }
    const tipResult = splitGit.gitSafe('rev-parse', branchName);
    if (!tipResult.ok || !tipResult.stdout.trim()) {
        proofFailures.push({ taskId, reason: `Could not resolve local tip for ${branchName}.` });
        continue;
    }
    const localTip = tipResult.stdout.trim();
    // Re-read status post-merge (same pattern as the archive loop below).
    const taskStatus = splitState.readStatus(taskId);
    const result = establishMergeProof(taskStatus, branchName, localTip, baseBranch);
    if (!result.proven) {
        proofFailures.push({ taskId, reason: result.reason });
    }
}
if (proofFailures.length > 0) {
    const lines = proofFailures.map(({ taskId, reason }) => `  ${taskId}: ${reason}`);
    splitCli.die(
        `--ship aborted: merge proof could not be established for the following task(s):\n` +
        `${lines.join('\n')}\n\n` +
        `Recovery:\n` +
        `  - Verify the PR was merged: \`gh pr list --head <branch> --state merged\`.\n` +
        `  - If merged but proof fails (stale branch after reuse), delete the local branch\n` +
        `    (\`git branch -D <branch>\`) and re-run --ship — the no-branch path archives without proof (AC-8).\n` +
        `  - \`--force\` does NOT bypass this gate (AC-9).`,
    );
}
```

**`--force` non-bypass (AC-9)**: the block above does not inspect `cliArgs.force`. No code needed; the omission is intentional. `--force` bypasses the docs-refs gate and the base-drift gate only.

**Local tip timing (Known Risks)**: `rev-parse <branchName>` is evaluated before `teardownWorktree` runs inside the archive loop below. A worktree holds a branch ref that is still resolvable until `git worktree remove` executes. The ordering is correct.

---

## Step 8 — New test file `tests/run-task-ship.test.ts`

### Step 8a — Extract or copy the fake-cli-tools setup

The fake-gh in `run-task-safety.test.ts` (`setupFakeCliTools`) needs one new case in the `gh pr view` block for `--json baseRefName`. Two options:

1. **Extract** `setupFakeCliTools` (and its dependencies `writeExecutable`, `setupFakeGit`) into `tests/fixtures/fake-cli-tools.ts`, add the `baseRefName` case, and import in both test files.
2. **Copy** the function into `run-task-ship.test.ts` with the addition.

**Use option 1** (extract) — avoids 100+ lines of duplication. The new `baseRefName` case in the `gh pr view` block:

```sh
if [ "$json" = "baseRefName" ]; then
  if [ -n "${FAKE_GH_BASE_REF_NAME:-}" ]; then printf "%s\\n" "$FAKE_GH_BASE_REF_NAME"; exit 0; fi
  exit 1
fi
```

New env var: `FAKE_GH_BASE_REF_NAME` — the base ref name to return for `gh pr view --json baseRefName`.

Also add to fake-git (needed for proof pass in `shipTasks`):
- `git rev-parse <FAKE_GIT_TASK_BRANCH>` → emit `FAKE_GIT_TASK_BRANCH_TIP` (40-char SHA env var)
- `git branch -D <branch>` → exit 0 (log to `FAKE_GIT_LOG` if set)
- `git pull --ff-only origin <base>` → exit 0

### Step 8b — Test table

All tests spawn the canon CLI via subprocess with `CANON_TASKS_DIR_OVERRIDE` + `PATH` prepended with fake-tool dir. Each sets up a minimal `status.json` at `human_review` or `complete` phase with the relevant `pr`, `branch`, and `base_branch` fields.

| Test name | AC | Key setup | Key assertion |
|---|---|---|---|
| `--pr pins pr.number (create path)` | AC-1 | No open PR; `FAKE_GH_PR_CREATE_NUMBER=101` | `status.json` has `pr.number === 101` |
| `--pr pins pr.number (existing-PR path)` | AC-1 | `FAKE_GH_PR_NUMBER=77` pre-set | `status.json` has `pr.number === 77` |
| `--pr exits clean (no dirty status.json)` | AC-1b | Run `--pr`; then check working tree | `git status` shows clean for `tasks/<id>/status.json` |
| `--pr idempotent on re-run` | AC-1b | Run `--pr` twice | Second run makes no new commit (git log length unchanged) |
| `--pr bundle writes number to all members` | AC-10b | Two-task bundle | Both `status.json` files have same `pr.number` |
| `--ship happy path (all three checks pass)` | AC-2 | `pr.number` set; `FAKE_GH_PR_STATE=MERGED`; `FAKE_GH_BASE_REF_NAME=main`; `FAKE_GH_HEAD_REF_OID=<localTip>` | Task archived, local branch deleted |
| `--ship refuses: merged into wrong base` | AC-2b | `pr.number` set; `MERGED`; head matches; `FAKE_GH_BASE_REF_NAME=wrong-base` | Exits non-zero; task dir survives; branch survives |
| `--ship refuses: head SHA mismatch (branch reuse)` | AC-3 | `pr.number` set; `MERGED`; `FAKE_GH_HEAD_REF_OID=<stale-sha>` ≠ local tip | Exits non-zero; branch survives |
| `--ship refuses: never merged` | AC-4 | No merged PR; `FAKE_GH_PR_STATE` absent | Exits non-zero |
| `--ship fallback proof (no pinned number)` | AC-5 | No `pr.number` in status; `FAKE_GH_PR_NUMBER` (merged); head SHA matches local tip | Task archived, branch deleted |
| `--ship fast-forward is ungated` | AC-6 | `!merged` fallback; `FAKE_GIT_BEHIND=3`; `FAKE_GIT_AHEAD=0` | Fast-forward runs; no die; proof gate still fires |
| `abort-then-re-run completes in one shot` | AC-7 | PR already MERGED; base behind; head SHA matches | Single --ship archives without manual pull |
| `--ship refuses: base synced but unproven (P1 #2)` | AC-7b | `behind=0`; no merged PR matching local tip | Exits non-zero without archiving (manual pull bypass is inert) |
| `--ship: branch already absent → archive proceeds` | AC-8 | Local branch does not exist | Archives without proof; no error |
| `--force does not bypass proof gate` | AC-9 | Same as AC-3 but with `--force` flag | Still exits non-zero |
| `bundle all-or-nothing: one task fails proof` | AC-10 | Two tasks; task A proven, task B not; both local branches exist | Neither task archived; neither branch deleted |
| `malformed pr field fails closed` | AC-11b | `pr: { number: "not-a-number" }` in status.json | Falls through to fallback or dies; never deletes branch on unvalidated cast |
| `assertOriginTaskBranchAbsent tolerates already-deleted remote` | AC-13 | Fake-git `push --delete` → "remote ref does not exist" | --ship continues cleanup without error |

Follow the `CANON_METRICS_FILE_OVERRIDE` pattern from `run-task-safety.test.ts` to prevent writes to the real `docs/pipeline-invocations.md` during tests.

---

## Step 9 — Update `tests/run-task-validation.test.ts` — AC-11

Add two rows to the existing status-parse test table:

1. Status with `pr: { number: 42 }` → `validateStatus` passes without throwing.
2. Status without `pr` field (legacy shape) → `validateStatus` still passes unchanged.

---

## Step 10 — Update `docs/pipeline-orchestrator.md` (Shipping & Post-Merge Reconciliation, ~line 418)

**Replace** the sentence at ~line 428 that describes `assertLocalBaseInSyncWithOrigin` dying with a "rebase first" message. New paragraph to add after the existing `--ship` sequence list:

> **Forge-proof deletion gate**: `--ship` requires positive merge evidence before deleting any local task branch. When `pr.number` is recorded in `status.json` (set at `--pr` time), proof requires all three: the pinned PR is in `MERGED` state, its `baseRefName` matches the task's `base_branch`, and its `headRefOid` matches the local task-branch tip. For legacy tasks without a pinned number, the fallback finds the most-recently-merged PR for the branch and requires the same head-SHA match. When the local task branch is already absent, no proof is required (no data to lose). **`--force` does not bypass the proof gate** — the die message names the manual recovery path (delete the local branch to take the no-branch path, or verify and re-run when `gh` can confirm the merge).

> **Ungated fast-forward**: when no PR was merged this run (already-merged cleanup path) and the local base is strictly behind `origin/<base>`, `--ship` fast-forwards via `git pull --ff-only` without requiring proof — the fast-forward is non-destructive. The proof gate then runs before the local branch deletion step.

---

## Step 11 — Update `CLAUDE.md` (--ship Quick Ref, `--pr` → `--ship` bullet)

Append to the existing `--ship` bullet in the Quick Refs section:

> `--ship` requires forge-proof merge evidence (pinned PR state + base-ref match + head-SHA match) before deleting the local task branch. `--force` does not bypass this gate. When the local branch is already absent, proof is skipped (no data to lose — AC-8 path).

---

## Step 12 — Build

```bash
npm run build
```

Rebuilds `dist/scripts/run-task.js` and `dist/cli/index.js`. Commit both dist artifacts.

Verification checklist:
```bash
npm run lint
npm run type-check
npm test
npm run docs-refs-check
npm run sync-templates:check
```

---

## Rollback

No data migration. The `pr` field in `status.json` is optional; removing it from `types.ts` and rolling back the code leaves existing status files parseable. The only externally visible change is the new commit per `--pr` run recording the PR number — that commit can be reverted on the branch before shipping.

---

## Reroute Plan

### Delta

The amendment corrects the merge-proof comparison from **strict SHA equality** (`prHead === localTip`) to **ancestor-or-equal** (`git merge-base --is-ancestor <localTip> <headRefOid>`), and adds the **materialize-or-die** requirement for the `headRefOid` object (AC-14, AC-15). Prior plan steps for types, templates, fast-forward ungating, remote-delete tolerance, PR-number pinning, docs, and build are unchanged and already landed. Only the proof logic and tests change.

#### Step A — Pre-fetch `headRefOid` before the squash-merge removes `origin/<branch>` (`main.ts`)

The round-1 proof block runs **after** `mergeOpenPRsAndPull()`, but `--delete-branch` removes `origin/<branch>` during the merge — so the `headRefOid` commit object may be absent locally at proof time (AC-15).

Fix: in `shipTasks()`, **before** calling `mergeOpenPRsAndPull()`, record the PR head SHA for each task whose local branch exists and ensure its commit object is materialized locally. Add a helper `prefetchPRHeads(taskIds: string[], baseBranch: string): Map<string, string>`:

- For each task with a local branch present, determine the PR number (pinned or via `findOpenPRNumber(branchName, baseBranch)` — the PR is open at this point).
- Call `getMergedPRHeadSha()`-equivalent but against an **open** PR: use `gh pr view <prNum> --json headRefOid --jq .headRefOid` (same shape, works on open PRs).
- Materialize: attempt `git fetch origin refs/pull/<prNum>/head` (GitHub's immutable ref) or, if unavailable, `git fetch origin <headRefOid>` (by SHA). If fetch fails but the object is already present locally (`git cat-file -e <sha> 2>/dev/null` exits 0), that is sufficient.
- Store `taskId → headRefOid` in the returned `Map`; if a SHA could not be materialized, store `null`.

Call `prefetchPRHeads` and capture its result before the merge runs. Pass the map into `establishMergeProof` so it avoids a second `gh` call and uses the pre-fetched SHA.

If `prefetchPRHeads` cannot resolve the SHA for a task (returns `null`), `establishMergeProof` treats the proof as **unestablished → die** (AC-15). Never assume; never skip.

#### Step B — Replace strict equality with ancestor-or-equal in `establishMergeProof` (`main.ts`)

In both the pinned-PR path and the legacy-fallback path, replace:

```typescript
if (prHead !== localTip) {
    return { proven: false, reason: `... does not match local tip ...` };
}
return { proven: true };
```

With:

```typescript
if (prHead === null) {
    return { proven: false, reason: `headRefOid could not be resolved for PR #${prNum} — unproven → die (AC-15).` };
}
// Ancestor-or-equal: git merge-base --is-ancestor exits 0 when localTip ⊆ merged head.
const ancestorCheck = gitSafe('merge-base', '--is-ancestor', localTip, prHead);
if (!ancestorCheck.ok) {
    return {
        proven: false,
        reason:
            `Local tip ${localTip.slice(0, 7)} is not an ancestor of PR head ${prHead.slice(0, 7)} ` +
            `— possible branch-name reuse or local-only commits not included in the merged PR (AC-3).`,
    };
}
return { proven: true };
```

Update the `establishMergeProof` signature to accept `prefetchedHeads: Map<string, string | null>` (keyed by task branch name) and use the pre-fetched SHA instead of calling `getMergedPRHeadSha` inside the function. This keeps the `gh` round-trips in one place and uses already-materialized objects for the `merge-base` call.

The `--is-ancestor` exit code is 0 for true (ancestor or equal), non-zero for false or error — `gitSafe` `.ok` maps that correctly.

#### Step C — Update `tests/run-task-ship.test.ts` for ancestor-or-equal semantics

The fake-gh's `headRefOid` must now point to commits that exist in the real git fixture repo so `git merge-base --is-ancestor` can run against them. Changes:

1. **Build commit chains in fixtures.** For tests that check ancestor-vs-equal:
   - AC-2 (happy path, exact equality): local tip SHA == `FAKE_GH_HEAD_REF_OID` → unchanged, still passes.
   - AC-14 (behind-local ancestor ships, **new**): create two commits in the fixture repo; set the local task-branch tip to the *first* commit and `FAKE_GH_HEAD_REF_OID` to the *second* commit (a descendant). `git merge-base --is-ancestor <first> <second>` exits 0 → proof passes → archives and deletes the local branch in a single `--ship`.
   - AC-15 (unmaterializable head → die, **new**): set `FAKE_GH_HEAD_REF_OID` to a SHA that does not exist in the fixture repo and ensure the fake-git `fetch` fails for it. Assert `--ship` exits non-zero with a "unproven → die" message; local branch survives.
   - AC-3 (branch reuse — unrelated head): `FAKE_GH_HEAD_REF_OID` is a SHA from a different, unrelated commit line → `--is-ancestor` exits non-zero → dies. Already passing logic, but update the fixture comment to document why it fails-closed under ancestor-or-equal.

2. **Fake-git must support `merge-base --is-ancestor`**. Add a handler in the fake-git script:
   - `git merge-base --is-ancestor <tipSHA> <headSHA>`: if both SHAs exist in the real fixture repo under `GIT_DIR`, delegate to the real `git merge-base --is-ancestor` call (using the fixture repo's `.git`). This keeps the test honest — the ancestor check runs against real git state, not a stub.

3. **Fake-git `fetch` for pre-fetch step**. Add a handler:
   - `git fetch origin refs/pull/<num>/head`: if `FAKE_GIT_ALLOW_FETCH_PR_HEAD=1` env var is set, no-op (object already in repo); otherwise exit non-zero to simulate AC-15 unmaterializable case.
   - `git fetch origin <sha>`: same pattern.
   - `git cat-file -e <sha>`: delegate to real git against fixture repo.

4. **Remove the two tests that asserted strict SHA equality failure** (if any tested `prHead !== localTip` for the behind-local case). Replace with AC-14's ancestor fixture.

#### Step D — Update `docs/pipeline-orchestrator.md` and `CLAUDE.md`

In the prose added by round-1 (Step 10 and Step 11 of the original plan), replace every instance of "head-SHA match" / "headRefOid matches the local task-branch tip" with "local task-branch tip is an ancestor of, or equal to, `headRefOid`." Add a note that if `headRefOid` cannot be materialized locally, the proof is unestablished and `--ship` dies (AC-15).

Sync check (`npm run sync-templates:check`) covers the template mirrors — no separate edit needed for `templates/`.

#### Step E — Build and verify

```bash
npm run lint
npm run type-check
npm test          # AC-14 and AC-15 fixtures must pass
npm run docs-refs-check
npm run sync-templates:check
npm run build     # rebuild dist/scripts/run-task.js and dist/cli/index.js
```
