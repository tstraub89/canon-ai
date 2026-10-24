# Spec: pr-pushes-scaffold-base — `--pr` and `--push` push canon's own scaffold commits to base

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

On the first `implement` call, canon commits the task scaffold to local `<base>` (`commitTaskArtifactsToBase`, `src/orchestrator/git.ts:138`), so the new worktree inherits it. Outside full-send, that commit is never pushed. At `--pr` or `--push`, `commitHumanReviewFiles` (`src/orchestrator/main.ts:1500`) runs the base-divergence gate (`verifyBaseDivergence`, `src/orchestrator/validation.ts:1775`). The gate sees the unpushed scaffold commit and dies with `Fix: git push origin <base>`. Every non-full-send task therefore needs one manual base push before its PR can open.

The full-send tail already removes that step:

- `pushScaffoldBaseCommitsForFullSend` (`main.ts:1382`) fetches the base and lists `origin/<base>..<base>`.
- It classifies every commit with `classifySafeToPushCommit` (`git.ts:251`). A commit is safe when it has an exact canon scaffold or telemetry subject, no merge parent, and changed paths only under `tasks/` or in `PIPELINE_TELEMETRY_FILES`.
- If every commit passes, it pushes the checked tip SHA. If any commit fails, it pushes nothing, and the divergence gate stops the run.

The task that built it treated `--full-send` as the consent to push, and recorded a base push from `--pr`/`--push` as a non-goal (`tasks/_archive/full-send-tail-push-and-watch/spec.md:32, :71`). The human has now decided that `--pr` and `--push` are consent enough for canon's own commits.

Two more defects in the current code shape this task:

1. **A base branch that origin doesn't have yet.** An operator may cut a feature branch locally and use it as the task's base. `git fetch origin <base>` then fails. The divergence gate treats that as a network failure, warns and skips (`validation.ts:1779-1789`). The full-send push dies at the same fetch (`main.ts:1384-1385`). No path pushes the base, so the PR targets a branch origin doesn't have.
2. **One message for every rejected push.** A non-fast-forward rejection, where origin's base has moved ahead of local, gets the same "The base branch may be protected" hint as a real protection rejection (`main.ts:1406-1410`).

The implement-time hint (`scaffoldCommitHint`, `src/orchestrator/phases/implement.ts:12-19`) also tells non-full-send operators to run `git push origin <base>` by hand. That wording becomes stale. Whether the hint prints at all stays keyed on `hasUnpushedScaffoldCommits` (`git.ts:269`, "any unpushed commit is safe"). That's fine because the new wording is conditional ("when every unpushed commit…"), so only the wording changes.

The abandoned `no-base-scaffold-commit` task tried to remove the base commit entirely. It stopped at a spec gap: the ship-time clear and restore paths it needed grew out of proportion to one manual push. Its spec and review, in that task's worktree, are the design record for repos whose base accepts only PRs.

## Decision

### One shared scaffold base push

Replace the full-send-only base push with one scaffold base push, used by full-send, `--pr` and `--push`. `pushScaffoldBaseCommitsForFullSend` is removed, and its old name must not exist afterwards. The full-send tail stops making its own push call and relies on `commitHumanReviewFiles`.

`commitHumanReviewFiles` reaches the push through its `human_review` callers and the `complete`-phase `--pr`/`--push` caller (`main.ts:3197-3200`), so all three get the push.

Order inside `commitHumanReviewFiles`. The full-send tail's existing order is kept: the push still comes before the docs-refs and base-drift gates.

1. Fetch `origin/<base>` once and list the unpushed `<base>` commits. This is the fetch and list the divergence gate does today.
2. If the list is non-empty and every commit is safe, push.
3. List the unpushed commits again.
4. Only then decide whether the divergence gate dies or warns.

`verifyBaseDivergence` can be split or parameterized to allow this. Its return value on the present-remote path keeps its current shape exactly: `{ commits, ok, stderr, fetchFailed }`, with no new fields. Any extra signal appears only on the missing-remote path.

### The push's contract

- **Range when `origin/<base>` exists:** `origin/<base>..<base>`, as today.
- **Range when origin has no `<base>` branch:**
  - A missing remote branch must be told apart from a fetch failure such as being offline or an auth error. Only the missing-branch case takes this path.
  - Before computing the range, canon prunes stale remote-tracking refs (for example `git fetch --prune origin`). A ref left over from a branch deleted on origin must not hide commits from the check.
  - The range is every commit reachable from local `<base>` and from no `origin/*` ref after the prune.
- **All or nothing:** every commit in the range must pass `classifySafeToPushCommit`, whose rules are unchanged. Otherwise nothing is pushed.
- **What is pushed:** the checked tip SHA, to `refs/heads/<base>`. No `--force`, no `-u`, no pull or rebase. If `origin/<base>` is missing, this push creates it.
- **Empty range, `origin/<base>` present:** nothing is pushed and nothing is printed.
- **Empty range, `origin/<base>` missing:** every commit on local `<base>` is already on some live origin branch (for example a task branch pushed earlier, or a branch `<base>` was cut from). Canon still creates the remote base: it pushes the local `<base>` tip SHA, resolved when the range was listed, to `refs/heads/<base>`. This publishes no new commit; it only creates the branch the PR will target. There is nothing to classify. The info line says canon created `origin/<base>` at that SHA. A rejected creation push dies with the matching rejection message below, before any task-branch push.
- **Fetch failure (not a missing branch):** the push is skipped, with no die. The divergence gate keeps today's warn-and-skip. This changes full-send, which used to die here.
- **List or inspect failure:** if listing the unpushed commits or inspecting one commit fails, the run dies with nothing pushed. The message names the base and the git error. It uses no "Full-send" wording and starts with the active mode's prefix (`--pr aborted:` / `--push aborted:`). For a full-send tail run, it uses the prefix that path passes. The existing `--pr aborted: git error checking base divergence: …` die is acceptable for the list failure.
- **After a successful push:** the gate's second list must show no divergent commits, so the gate neither dies nor prints the `--allow-divergent-base override` warning for the pushed commits.

### `--allow-divergent-base`

- **With `origin/<base>` present:**
  - The flag doesn't stop the push of an all-safe range.
  - If that push is rejected for any reason, canon warns that the scaffold commits weren't pushed (with the rejection reason) and falls through to today's override. It warns, lists the divergent commits and continues. This keeps today's escape for a protected base, where the scaffold reaches base through the squash merge.
  - With an unsafe commit present, the behavior is today's: nothing is pushed, the gate warns and the run continues.
- **With `origin/<base>` missing:** the flag changes nothing, because the PR has no branch to target. It doesn't stop the all-safe or empty-range creation push. It doesn't bypass the missing-remote block, and the block message says so. It doesn't turn a rejected creation push into a warning: that run dies.

### Block messages

There is one message per case. Each names the branch, and none pushes anything.

- **Unsafe commits, `origin/<base>` present:** today's `verifyBaseDivergenceFromData` text, unchanged, including `Fix: git push origin <base>`. The operator owns those commits.
- **Unsafe commits, `origin/<base>` missing:**
  - Says origin has no `<base>` branch.
  - Lists every local-only commit in the range, each marked as canon-safe or not.
  - Tells the operator to push `<base>` themselves and re-run.
  - States that `--allow-divergent-base` does not apply.
- **Push rejected as non-fast-forward** (`origin/<base>` present): says origin's `<base>` has commits that local `<base>` lacks, and tells the operator to run `git pull --rebase` on `<base>` and re-run. A plain pull would create a merge commit, and the classifier rejects merge commits. The message must not mention protection. Without `--allow-divergent-base`, the run dies.
- **Any other rejected push:** today's guidance ("may be protected; push or merge these commits manually, then re-run"), without full-send wording. Without `--allow-divergent-base`, the run dies. When the push was creating a missing `origin/<base>`, the run dies even with the flag.

### Hint and docs

- The success info line lists the pushed commits as today, without the "Full-send:" prefix.
- The implement-time hint becomes one sentence for all modes. It says canon's scaffold was committed to local `<base>`, and that `--pr`, `--push` and full-send push it when every unpushed `<base>` commit carries only task artifacts and pipeline telemetry. It must no longer tell the operator to run `git push origin <base>`. Remove its full-send parameter and update the call site.
- `--ship` is unchanged. A missing remote base still warns and skips there, exactly as today. The new missing-remote classification must not run on the `--ship` path; gate it behind a parameter or a separate probe used only by `commitHumanReviewFiles`.
- Add a `docs/decisions.md` entry. It records that `--pr`/`--push` are consent to push canon's own classifier-proven scaffold and telemetry commits to base, and reverses the archived non-goal with the reason. It also says that repos whose main accepts only PRs should use a pushable feature or integration branch as the task's base, or rely on `--allow-divergent-base` and the squash merge.

## Non-Goals

- **Pushing operator commits**, including onto a `<base>` that origin doesn't have yet. The push stays all-or-nothing on the classifier. Creating a missing `<base>` at a tip whose commits are all already on origin publishes no commit, so it is in scope.
- **Classifier changes:** no narrowing to the current task's ids or to `tasks/<id>/`, and no author check. `classifySafeToPushCommitFromData` and its subject regexes stay byte-identical.
- **Auto-pull, rebase or retry** after a non-fast-forward rejection.
- **Any `--ship` behavior change:** no base push, and its divergence gate, missing-remote skip and `assertLocalBaseInSyncWithOrigin` behave as today (AC-13).
- **Changes to `commitTaskArtifactsToBase`**, or to when the scaffold commit is made.
- **The `--ship` archive commit.**
- **Support for PR-only bases** beyond the decisions.md guidance and keeping the `--allow-divergent-base` escape.
- **A phase-gate change on plain `--pr`:** `checkPhaseGate` stays full-send-only.
- **A new CLI flag or opt-out.**
- **Changing the base-drift gate's own fetch.** A run still fetches again there. "One fetch" means one fetch before the divergence decision.

## Acceptance Criteria

Main-driven tests use the existing real-git fixture style from `tests/run-task-safety.test.ts`: a bare `origin.git` plus a clone, run with `runMainInline` and fake `gh`, `codex` and `claude`. Where an AC inspects git argv or counts fetches, the test adds a git shim on `PATH`, like the one in the existing probe-error test.

- [ ] **AC-1 (`--pr` pushes a safe scaffold).** Fixture: local `main` is one canon scaffold commit ahead of `origin/main` (`task(<id>): commit artifacts pre-pipeline`, touching only `tasks/<id>/` paths). The task is at `human_review`. Run `--pr`.
  - Bare origin's `refs/heads/main` equals the scaffold SHA.
  - The fake `gh` log shows the draft PR was created.
  - Output has the pushed-commits info line, with no "Full-send" and no `Base divergence detected`.
  - The git shim's argv for the base push contains the tip SHA refspec and neither `--force`/`-f` nor `-u`.
  - **Red-first:** fails on the pre-change code with the divergence die.
- [ ] **AC-2 (`--push` pushes a safe scaffold).** AC-1's fixture with `--push`. Origin's `main` advances to the scaffold SHA, and the task branch is pushed.
- [ ] **AC-3 (operator commit blocks, nothing pushed).** New test. Fixture: one safe scaffold commit plus one operator commit (a path outside `tasks/`), both unpushed on `main`. Run `--pr`.
  - Exit is non-zero, with the existing `Base divergence detected` message listing both commits and including `Fix: git push origin main`.
  - Origin's `main` is unchanged, and no PR is created.
  - The existing test "plain --pr still refuses an unpushed base commit without pushing it" keeps its fixture and assertions. Its single commit has a scaffold subject but touches a root-level path, so it is unsafe by path. It is retitled to say it refuses an unsafe (out-of-`tasks/`) unpushed base commit.
- [ ] **AC-4 (missing remote base, safe).** Fixture: the task's base is `feat/x`, created locally from `main` (`main` is pushed) plus one safe scaffold commit. Origin has no `feat/x`. Run `--pr`.
  - Origin gains `refs/heads/feat/x` at the scaffold SHA.
  - The PR is created against `feat/x`.
  - **Red-first.**
- [ ] **AC-4b (missing remote base, empty range).** AC-4's fixture, then push the scaffold commit to origin under another branch name (for example `git push origin feat/x:refs/heads/task/<id>`), so every commit on local `feat/x` is on a live origin branch. Origin still has no `feat/x`.
  - **(i)** Run `--pr`. Origin gains `refs/heads/feat/x` at local `feat/x`'s tip SHA. The PR is created against `feat/x`. Output has the created-base info line. **Red-first:** the pre-change code leaves origin without `feat/x`.
  - **(ii)** Same fixture with `--pr --allow-divergent-base`. Same outcome as (i).
  - **(iii)** Same fixture, plus a `pre-receive` hook on the bare origin that rejects `refs/heads/feat/x`. Run `--pr --allow-divergent-base`. Exit is non-zero with the other-rejection message. Origin still has no `feat/x`, and the fake `gh` log shows no PR creation.
- [ ] **AC-5 (missing remote base, operator commit).** AC-4's fixture plus one operator commit on `feat/x`.
  - Exit is non-zero, with the missing-remote block. It says origin has no `feat/x`, lists both local-only commits and marks which are canon-safe, says to push `feat/x` yourself and re-run, and says `--allow-divergent-base` doesn't apply.
  - Origin still has no `feat/x`.
  - A second run with `--allow-divergent-base` exits non-zero with the same block, and no task branch is pushed.
- [ ] **AC-6 (stale remote-tracking ref can't hide commits).** AC-5's fixture, plus a local `refs/remotes/origin/wip` pointing at the operator commit, for a branch that doesn't exist on the bare origin.
  - The run blocks with the missing-remote message and pushes nothing.
  - Origin still has no `feat/x`.
- [ ] **AC-7 (fetch failure is not a missing branch).** A git shim fails `fetch` with a network-style error while a safe scaffold commit is unpushed.
  - Nothing is pushed to base.
  - Output has today's "Could not fetch origin/<base> … Skipping base-divergence check" warning and no missing-remote block.
  - The run isn't killed by the base-push step. A later failure, such as the branch push, is allowed.
- [ ] **AC-8 (rejection messages).**
  - **(a)** Origin's `main` gets a commit that the clone lacks, then a local safe scaffold commit is added on top of the clone's stale `main`, then `--pr`.
    - The run dies with the non-fast-forward message: it names `git pull --rebase` and doesn't contain "protected".
    - Origin's `main` keeps only the other commit.
    - Red-first: run in full-send mode, where the pre-change code reaches the push and prints "may be protected".
  - **(b)** A `pre-receive` hook on the bare origin rejects pushes to `main`. Run `--pr`. The run dies with the other-rejection message: "may be protected", with no "Full-send".
  - **(c)** Same as (b) with `--pr --allow-divergent-base`.
    - The run warns that the scaffold commits weren't pushed, prints the override warning listing them, and creates the PR.
    - Origin's `main` is unchanged.
- [ ] **AC-9 (`--allow-divergent-base` still pushes when safe).** AC-1's fixture with `--pr --allow-divergent-base`. Origin's `main` advances to the scaffold SHA, and no `--allow-divergent-base override` warning is printed.
- [ ] **AC-10 (full-send regressions).** These existing tests still pass:
  - "full-send tail pushes an unpushed scaffold tip SHA before the divergence gate"
  - "full-send tail leaves every unsafe scaffold-looking commit off origin"
  - "full-send tail pushes the checked tip but not a concurrent operator commit"
  - "full-send tail fails closed on a rejected base push and a commit-list probe error"

  Only these expected message literals may change:
  - In the first test, the success-line assertion (`/Full-send: pushed 2 unpushed main commit\(s\)/`) adopts the mode-neutral success line. It still asserts the count (2) and the base (`main`).
  - In the last test, the rejected-push assertion follows the "other rejection" wording, and the probe-error assertion follows the list-failure die from the Decision. The "dies, nothing pushed" outcome must stay.

  No other assertion in these tests changes. In a full-send fixture with a git shim counting `fetch` calls, exactly one `fetch` runs before the divergence decision. The base-drift gate's later fetch is excluded.
- [ ] **AC-11 (hint).**
  - The `scaffoldCommitHint` unit test asserts one wording whether or not every task is full-send. That wording names `--pr`, `--push` and full-send pushing the scaffold, and doesn't contain `git push origin`.
  - The `runImplementPhase` test in `tests/run-task-safety.test.ts`, which currently asserts the `git push origin main` hint, asserts the new wording instead. It still expects the hint once on the first run and not on the second.
- [ ] **AC-12 (structural removal).**
  - `git grep -n -E 'pushScaffoldBaseCommitsForFullSend|Full-send tail aborted: (could not|pushing)|Full-send: (pushed|not pushing)' -- src tests dist docs templates README.md .claude .canon` returns zero hits.
  - The pattern covers every removed family: the function name, the four push-path dies (fetch, list, inspect, push), both info-line prefixes, and their `dist/` copies.
  - Out of scope and unchanged: the multi-branch bundle guard (`Full-send tail aborted: bundle spans multiple branches`, `src/orchestrator/main.ts:3126`) and its test assertion. The pattern above doesn't match it.
- [ ] **AC-13 (`--ship` unchanged).** A `verifyBaseDivergence`-level unit test, or a `--ship` test, shows that a missing remote base on the `--ship` path still produces today's warn-and-skip (`fetchFailed: true`, no commits). The existing clean-path `deepEqual` in `tests/run-task-validation.test.ts` still passes unchanged.
- [ ] **AC-14 (restatement sweep).** Every surface that describes the base push as full-send-only, or tells the operator to push the scaffold by hand at `--pr`/`--push`, is updated. Every such surface is in Affected Files: `README.md`, `docs/pipeline-orchestrator.md` and its mirror, `docs/codebase-map.md`, CLI help in both files, and the canon-pipeline skill's `--pr` line and its mirror.
  - Verify by reading each surface.
  - `git grep -n -i -E 'tail (also |first )?pushes (unpushed|the checked|only)|pushes unpushed base commits only when' -- docs templates README.md src .claude` returns zero hits.
- [ ] **AC-15 (decision recorded).** `docs/decisions.md` has the new entry described in Decision. It names the archived non-goal it reverses and gives the PR-only-base guidance.
- [ ] **AC-16 (build artifacts).** After `npm run build`, `git diff --exit-code dist/` is clean apart from the committed rebuild. `npm run sync-templates:check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/main.ts` | Replace `pushScaffoldBaseCommitsForFullSend` with the shared push inside `commitHumanReviewFiles`, in the order fetch and list → push → re-list → gate decision. Remove the full-send tail's separate call. Add the block, rejection and fallback messages, the mode-neutral success line, and the mode-prefixed list and inspect dies. |
| `src/orchestrator/git.ts` | Add a missing-remote-branch probe (full `refs/heads/<base>` match), the prune step, and a range helper for the missing-remote case. Reuse `getUnpushedBaseCommits` for the present-remote case. The classifier is unchanged. |
| `src/orchestrator/validation.ts` | Split or parameterize `verifyBaseDivergence` so `commitHumanReviewFiles` can push between list and decision and can opt into missing-remote classification. `--ship` stays on today's path. The present-remote return shape is unchanged. Add the missing-remote block message builder. |
| `src/orchestrator/phases/implement.ts` | `scaffoldCommitHint`: one mode-neutral wording, with the full-send parameter removed and the call site updated. |
| `src/orchestrator/cli.ts` | `--pr`, `--push`, `--full-send` and `--allow-divergent-base` help lines describe the scaffold base push and the flag's fallback. |
| `src/cli/index.ts` | Same help-line updates for `canon run --help`. |
| `tests/run-task-safety.test.ts` | AC-1 to AC-11 tests, including AC-4b. Retitle the plain `--pr` refusal test, update the hint assertions, and update only the expected literals AC-10 allows. |
| `tests/run-task-validation.test.ts` | Unit tests for missing-remote vs fetch-failure classification, the `--ship`-path skip (AC-13), and the new message builder. Existing literals and the clean-path `deepEqual` keep passing. |
| `README.md` | The "Git side effects need a flag" paragraph (~line 260): `--pr`/`--push` push canon's own scaffold commits, and other unpushed commits still block. |
| `docs/pipeline-orchestrator.md` | The `--push`, `--pr`, `--allow-divergent-base` and `--full-send` rows, the scaffold-to-base paragraph's hint sentence, and the remote-boundary paragraph: shared push, creating a missing remote base, prune, rejection messages, and the override fallback. |
| `templates/docs/pipeline-orchestrator.md` | Mirror, via `npm run sync-templates`. |
| `.claude/skills/canon-pipeline/SKILL.md` | The `--pr` line also mentions pushing canon's scaffold commits to base. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirror, via `npm run sync-templates`. |
| `docs/codebase-map.md` | Base-drift and base-divergence gates row: the shared scaffold push ahead of the divergence decision. Root copy only; `templates/docs/codebase-map.md` is an unsynced init scaffold and stays untouched. |
| `docs/decisions.md` | New entry. Root copy only; `templates/docs/decisions.md` is an unsynced init scaffold and stays untouched. |
| `dist/orchestrator/run-task.js` | Rebuilt. |
| `dist/cli/index.js` | Rebuilt (help text). |

### Interaction Dependencies

- **Full-send tail:** it loses its own push call and depends on `commitHumanReviewFiles`. On a fetch failure it now skips instead of dying (AC-7).
- **`complete`-phase `--pr`/`--push`** (`main.ts:3197-3200`): it inherits the push through `commitHumanReviewFiles`. This is intended.
- **`--ship`:** unchanged (AC-13).
- **Base-drift gate:** unchanged. It still runs after the push, with its own fetch.
- **The implement-time hint:** only its wording changes.

### Data Model Changes

None.

### Implementation Notes (non-binding; plan and implement own these)

- Missing-branch probe: `git ls-remote --exit-code origin refs/heads/<base>`. Exit 2 means missing; any other non-zero exit is a fetch or network failure.
- Prune before the missing-remote range: `git fetch --prune origin`. The range itself: `git log <base> --not --remotes=origin --format=%H%x09%s`.
- Non-fast-forward detection: the push's stderr contains `[rejected]` together with `non-fast-forward` or `fetch first`.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — the full suite runs clean
- [x] `npm run build`, with `dist/` committed in sync
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

- `docs/pipeline-orchestrator.md`, `docs/codebase-map.md` and `docs/decisions.md` are edited (see Affected Files).
- `docs/architecture.md`, `docs/patterns.md` and `docs/product-context.md` aren't expected to change. QA should confirm that the patterns doc's "Clean tree" pitfall and its push-SHA guidance still read correctly.

## Known Risks

- **Pushing to base is now routine and needs no prompt.** The safety rests entirely on the unchanged classifier and the all-or-nothing rule. The classifier accepts any task's scaffold and any `tasks/` path, by design (see Non-Goals). A sibling task's unpushed scaffold therefore rides along. That's harmless, but "your commit" is approximate.
- **Missing-remote range and stale refs.**
  - The prune removes refs for branches deleted on origin (AC-6).
  - If the prune fetch itself fails, the run must not compute the range from unpruned refs. Treat it as a fetch failure: skip the push and keep today's warn-and-skip.
  - A commit that sits on a *live* origin branch is genuinely published, so excluding it is correct.
- **Creating a missing remote base is a new outward action.** It happens whenever `--pr`/`--push` finds no `origin/<base>` and the local-only range is empty or all canon-safe. The operator chose `<base>` as the task's base, and the PR can't open without it, so `--pr`/`--push` is the consent. In the empty-range case the created branch contains only commits origin already has (AC-4b).
- **Non-fast-forward detection matches strings** in git's stderr. A git version with different wording falls through to the generic rejection message: the hint degrades, but the action is not wrong. AC-8(a) pins the current wording.
- **Push before later gates.** As in full-send today, a later docs-refs or base-drift abort leaves the scaffold commit on origin. The archived full-send spec accepted this as harmless; it now applies to every `--pr`/`--push`.
- **Full-send fetch-failure behavior** changes from dying to skipping. An offline full-send now fails at the branch push instead of at the base fetch.
- **`--allow-divergent-base` fallback on a rejected push.** On a protected base, the flag now means "try to push, and if refused, continue as before". An operator who expected the flag to suppress the push attempt sees one extra warning, and nothing else changes.

## Human Test Plan

1. Start a task on main, run it to human review, and open the PR without pushing main by hand. Expected: the PR opens, and canon says it pushed its scaffold commit to main.
2. Before opening the PR, make an unrelated commit of your own on local main, then open the PR. Expected: canon refuses, pushes nothing, and tells you to push main yourself.
3. Cut a new local feature branch that you haven't pushed. Start a task with that branch as its base, run it to human review, and open the PR. Expected: canon creates the feature branch on GitHub, and the PR targets it.
4. Repeat step 3, but push the task's own branch to GitHub yourself before opening the PR. Expected: canon still creates the feature branch on GitHub, and the PR targets it.
5. Repeat step 3, but commit some of your own work on the feature branch first. Expected: canon refuses, says GitHub has no such branch yet, and tells you to push it yourself, even if you pass the divergence override.
6. Get a task to human review. Have someone else push to main on GitHub while your local main is behind, then open the PR. Expected: canon says GitHub's main has moved ahead and tells you to rebase your local main onto it. It doesn't mention protection.
7. On a repo whose main rejects direct pushes, open the PR with the divergence override. Expected: canon warns that it couldn't push its scaffold commit, and still opens the PR.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase (N/A, full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A: this is a feature. The two defects in Problem are confirmed by reading the cited code paths. AC-4 and AC-8(a) cover them red-first.
- [x] (Refactors) N/A
