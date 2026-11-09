# Code Review: no-base-scaffold-commit

> Reviewer: Claude | Spec: `tasks/no-base-scaffold-commit/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored (STAGE_1 pass, signal approve), cold-Claude (22 findings, signal changes_requested), cold-Codex (no actionable findings). All three were present.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, test, build, sync-templates:check, docs-refs-check)
- [x] No required checks were skipped without justification (the one skipped test is the `gitDirWritable`-gated anchoring test at `tests/run-task-safety.test.ts`:3249, which this diff does not touch)
- [x] Red-first evidence recorded for each red-first AC. AC-7(a)–(d) and AC-8 rows ran against pre-fix `9174291` and show the "untracked working tree files would be overwritten" refusal.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: No base commits at bootstrap | Met | Real-git single and 2-task implement with no override: base SHA and `rev-list --all` unchanged, telemetry still dirty, REPO_ROOT `tasks/` still untracked. The anchored lens re-ran it. |
| AC-2: Scaffold reaches worktree untracked | Met | Identical bytes, `??` in the worktree, empty `main...HEAD`, ignored pid/heartbeat files not copied. An instrumented test shows status.json copied last and the secondary recorded before the leader. |
| AC-3: Branch start point unchanged | Met | Worktree argv is `worktree add -b task/<id> <wt> release/v1` with no fetch; the non-worktree release-base test is green. |
| AC-4: Copy never clobbers, resumable | Met | Committed, torn-down, interrupted, recorded-branch and recorded-interrupted variants pass. Gap: base-tracked task files are not covered, see Correctness Bug 1. |
| AC-5: Non-worktree no early commit | Met | Two implement runs leave `git log --all -- tasks/<id>` empty. |
| AC-6: QA-end commit carries scaffold | Met | The real `commitQaArtifacts` path tracks spec, plan and status. |
| AC-7: Ship clears exactly the collision set | Partial | (a)–(d) and (f) are real squash fixtures. The (e) test never reaches the clearing code, see Correctness Bug 2. |
| AC-8: post-merge-sync clears the same way | Met | Fast-forward and reset fixtures restore merged content and keep the unmerged backup. |
| AC-9: Hints name a step that works | Partial | The banner, the fast-forward guidance and the post-merge-sync messages are updated. The divergence hints still recommend a bare `git rebase`, which a stale copy blocks, see Correctness Bug 3. |
| AC-10: Divergence gate still guards | Met | Full-send opens the PR with no base push; an operator commit blocks at the same gate; the bypass tests are green. |
| AC-11: Non-worktree ship completes | Met | Real squash archives the task. A forced abort prints `git checkout task/<id>`, and running it restores status. |
| AC-12: Deleted machinery gone | Met | The exact `git grep` exits 1 with no output (re-run by the anchored lens). |
| AC-13: Restatements match new flow | Partial | The sweep is dispositioned and the mirrors and refs checks pass. Two in-scope docs are still stale (Correctness Bug 4). Two out-of-scope CLI help renderers are stale too (Spec Gap 1). |
| AC-14: Golden prompts regenerated | Met | Only `promptQa` and `promptQa_withTemplate` changed; dist carries the new text. |

### Dropped Sections Check

- [x] Non-goals respected (divergence/drift gates, archive commit, local-base start point and the `checkout HEAD -- status.json` step are unchanged)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

The Partial rows are narrow and are carried as Stage 2 findings below. No AC was dropped.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The core design works: the untracked copy, status.json-last ordering, fail-closed collision probes, clearing only after the merge, and real-squash ship fixtures. The red-first evidence is genuine. The blocking issue is a regression cold-Claude found: the task bootstrap is now fail-open when the task directory is already tracked on base. The other blocking items are a vacuous AC-7(e) test, two divergence hints that recommend a step a stale copy blocks, and two in-scope docs that still describe the old ship behavior. The CLI help renderers are a separate spec gap, because their files are outside Affected Files.

### Findings

#### Correctness Bugs

1. **[code-bug] Bootstrap silently drops REPO_ROOT task edits when `tasks/<id>/` is tracked on base** — `src/orchestrator/git.ts`:239-244 (`isPipelineOwnedDirtyPath` exempts all of `tasks/`), `src/orchestrator/git.ts`:280-287 (copy skipped when the worktree already has `status.json`). Source: cold-Claude. It filed two findings on this behavior: the bootstrap regression and the sibling guard.
   - **Failure:** `tasks/<id>/` is now untracked on base for the whole spec → spec_review → plan window. Any operator commit on base can sweep it in, including a broad `git add -A` for unrelated work. spec_review and plan then edit `spec.md` and `status.json` in REPO_ROOT (tracked-modified) and add `plan.md` (untracked). At implement, `git worktree add` checks out base's stale committed copies. The worktree now has a `status.json`, so `copyTaskScaffoldIntoWorktree` skips the whole task. `plan.md`, the revised spec and the advanced phase state never reach the worktree, and `recordWorktreeBranches` stamps the branch onto the stale status. `assertRepoRootCleanBeforeFirstWorktree` lets this through because it exempts all of `tasks/`. Nothing warns.
   - **Why it's new:** the deleted `commitTaskArtifactsToBase` ran `git add -- tasks/<id>` before branching, so the old engine carried this dirt into the worktree.
   - **Why code-bug:** the spec's copy condition is unchanged by the fix. The spec says the REPO_ROOT guard "still runs" and allows *untracked* `tasks/`. It says nothing about tracked task edits that no longer reach the worktree. Same rule as `docs/patterns.md`:228 (write-safety guards fail closed).
   - **Required:** on the first-creation worktree path, fail closed when REPO_ROOT and the fresh worktree disagree about a bundle member's task files: a tracked change under `tasks/<id>/` in REPO_ROOT, or a base-tracked `status.json` that would make the copy skip REPO_ROOT files the worktree lacks. Name the paths and tell the operator to commit them to base or revert them. Add a real-git test (no override) where base tracks `tasks/<id>/status.json` and REPO_ROOT has advanced it. The test must fail on the current code. If the fix turns out to need a change to the Decision's copy condition rather than a guard, stop and raise a `[spec-gap]` blocker.

2. **[code-bug, test integrity] The AC-7(e) test cannot fail** — `tests/run-task-ship.test.ts`:1958-1970. Source: anchored lens.
   - `syncBase: true` plus a pre-merged PR leaves local `main` equal to origin. `assertLocalBaseInSyncWithOrigin` returns at `behind === 0` (`src/orchestrator/main.ts`:1772) before `clearStaleTaskCopiesBeforePull` runs, so "nothing removed" holds trivially.
   - **Required:** put REPO_ROOT behind an origin that carries the squash, with `tasks/<id>/` tracked at REPO_ROOT HEAD. Assert that the clearing step runs and removes nothing.

3. **[code-bug] The divergence hints recommend a rebase that a stale task copy blocks** — `src/orchestrator/main.ts`:1779 and `src/task/index.ts`:1423-1425. Source: anchored lens.
   - Both still tell the operator to `git rebase origin/<base>` (or "rebase manually"). With a merged task's stale untracked copy in REPO_ROOT, that rebase hits the same "untracked working tree files would be overwritten" refusal. Neither path clears the copy before it stops.
   - AC-9 requires the `assertLocalBaseInSyncWithOrigin` guidance and the post-merge-sync messages to name a step that works.
   - **Required:** add the scoped `git clean -f -- tasks/<id>` step, or an equivalent that works, before the rebase in both hints.

4. **[code-bug, stale restatement] In-scope docs still describe the old ship behavior** — Source: anchored lens.
   - `docs/pipeline-orchestrator.md`:527 says "The fast-forward is non-destructive". It now deletes colliding untracked task copies first, and that deletion runs before the forge-proof gate.
   - `.claude/skills/canon-pipeline/SKILL.md`:81 and :84 still give the `--ship` order without the clearing step. Both files are in Affected Files, and AC-13 requires every `--ship`-order restatement to be updated.
   - Also, the new SKILL.md paragraph at :183 sits after the checklist's `---`, outside any heading. Place it under a fitting section.
   - Edit the root copies only; the sync hook regenerates the mirrors.

#### Risk / Guardrails

These are non-blocking. Fix them now if cheap; otherwise they are candidates for follow-ups.

- **Backup files the merged tree doesn't track reach the archive commit** — `src/orchestrator/main.ts` archive path with `clearIncomingTaskCollisions`. Flagged by 2 lenses (anchored, cold-Claude). Some REPO_ROOT backup files don't collide with the incoming tree, for example a pre-implement file the worktree run deleted. These move into `tasks/_archive/<id>/` and `git add -A` commits them in `chore: archive` straight to base. The old engine also archived files added to REPO_ROOT after bootstrap, so the only new case is files the branch deleted. Low likelihood.
- **Fetch-then-pull race** — `src/orchestrator/main.ts`:2228-2232 and :1784-1785. Flagged by 2 lenses. Collisions are computed against the fetched `origin/<base>`, but `git pull` fetches again. A merge that lands in between can make the pull refuse. Re-running `--ship` recovers. Using `merge --ff-only origin/<base>` against the probed ref would close the window.
- **Exact-path collisions only** — `src/orchestrator/git.ts`:310-318. Flagged by 2 lenses. A file/directory shape collision, or a case-only collision on a case-insensitive filesystem, still makes the pull refuse. This fails closed, so it is acceptable for now.
- **Phantom backup after an external ship** — cold-Claude. If another clone already shipped the task, the incoming tree tracks `tasks/_archive/<id>/`, not `tasks/<id>/`. The local untracked backup never collides, so it lingers and shows as in flight.
- **Orphaned-state re-attach** — `src/orchestrator/git.ts`:356. Anchored lens. This state used to die; it now re-attaches, which is fine when the branch exists locally. If the branch is gone, `ensureWorktree` without a start point branches from REPO_ROOT HEAD rather than `getBaseBranch`. This only arises in legacy or hand-edited states.
- **post-merge-sync probes from `process.cwd()`** — `src/task/index.ts`:1319. cold-Claude. Run from a subdirectory, the cwd-relative `ls-files`/`ls-tree` clear nothing, and the pull still refuses, so it fails safe. Resolving the repository top level would fix it.

#### Optional Cleanup / Nit

- `copyTaskScaffoldIntoWorktree` throws a raw `Error` for a missing marker or a copy failure, while a listing failure calls `die` (`src/orchestrator/git.ts`:276, :303). The bare `die` at `src/orchestrator/main.ts`:2229 bypasses `splitCli.die`. (cold-Claude, anchored)
- `copyFileSync` writes in place, so an interrupted copy can leave a truncated `status.json` that resume treats as present. Low likelihood. (cold-Claude)
- Clearing deletes alphabetically, so on a partial unlink failure a task's `status.json` can go before its siblings. Deleting the marker last would mirror the copy. (anchored)
- The new collision deaths in `--ship` don't call `restorePreservedSharedDocDirt`. This matches the existing merge-failure `die`. (cold-Claude)
- The deleted "writes … only in the worktree after scaffold commit" test checked that agent writes after bootstrap don't leak to REPO_ROOT. Nothing replaces that check. (anchored)
- `docs/BACKLOG.md`:40-41 still frames itself as "Layer 2" of the removed dirty-at-entry gate. (anchored)
- `docs/patterns.md`:136 says `tasks/<id>/` stays untracked until QA end. `autoCommitCode` can stage handoff-listed task paths earlier. (cold-Claude)
- The tracked-copy symlink-following in the copy: task dirs are canon-generated markdown/JSON, so this is very low risk. (cold-Claude, anchored)
- A multi-path `git checkout HEAD -- …` for orphaned status fails as a whole when one bundle member is untracked. This only matters for upgrade-time mixed bundles. (cold-Claude)
- On a non-worktree ship, a fetch failure in `assertLocalBaseInSyncWithOrigin` warns and continues while `tasks/<id>/` is absent. Later steps fail instead. (cold-Claude)

#### Spec Gaps

1. **[spec-gap] Two CLI help renderers still describe the old `--ship` and post-merge-sync behavior, and their files are outside Affected Files** — `src/cli/index.ts`:76-79 (post-merge-sync: "Hard-resets if the only divergence is pipeline telemetry", no mention of clearing), `src/cli/index.ts`:102-106 and `src/orchestrator/cli.ts`:146-150 (`--ship`: "tear down the worktree, archive the task dir, and pull the base branch"). Flagged by 2 lenses (anchored, cold-Claude) and by the handoff's `[scope]` blocker.
   - AC-13 requires these to be updated. `docs/patterns.md` (trigger-table row for operator-facing text duplicates) names exactly these two files, but the spec's `### Affected Files` table omits them. Implement cannot fix them without tripping the Affected Files cap.
   - **Needs a human spec amendment:** add `src/cli/index.ts` and `src/orchestrator/cli.ts` to `### Affected Files`, then implement makes the wording fix. Implement should not fix this before the amendment.
2. **Accepted interpretation (not blocking):** the handoff's `[ambiguity]` blocker restricts the collision set to `tasks/`. That matches the Implementation Notes and the Known Risks framing, and it is the safer reading. Optionally tighten the Decision wording at the next amendment.

### Dismissed Cold Findings

- Dismissed (cold-Claude): after a merge, tracked locally-modified REPO_ROOT task files make the pull refuse with "local changes would be overwritten". This is pre-existing: the old engine always tracked the REPO_ROOT copy on base, so the same refusal applied. This diff doesn't create that state outside the bootstrap path, which Correctness Bug 1 closes.
- Dismissed (cold-Claude): a missing worktree `status.json` on re-entry re-copies the stale backup. This is the spec-prescribed condition (spec Decision, "only when the worktree has no `tasks/<id>/status.json`"; AC-4(c) interrupted-copy resume).
- Dismissed (cold-Claude): clearing runs before the post-merge-sync clobber guard, and before a ship pull that can still fail. The spec prescribes this order (Decision: "before its fast-forward and before its untracked-clobber guard"; "after the merge is confirmed and immediately before the pull"; AC-8). The removed files are collisions the incoming tree carries.
- Dismissed (cold-Claude): the manual no-PR `git clean -f -- tasks/<id>` is broader than canon's clearing, and the banner doesn't say to check out base. The spec Decision prescribes removing "the task's untracked `tasks/<id>/` files from the main checkout before merging", and the banner does say "from the main checkout on <base>" (`src/orchestrator/main.ts`:1327).
- Dismissed (cold-Claude): post-merge-sync's task-only hard reset can delete another unmerged older-engine task's tracked copy. That behavior is pre-existing, since this diff leaves the `tasks/` divergence filter in `src/task/index.ts` unchanged. Only the message wording changed.
- Dismissed (cold-Claude): the test fixtures lack base-tracked or dirty task files at bootstrap. Not dismissed on substance; it is folded into Correctness Bug 1's required test.
- cold-Codex returned no actionable findings; nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

For implement: fix Correctness Bugs 1–4. Do not touch `src/cli/index.ts` or `src/orchestrator/cli.ts` until a human amends Affected Files (Spec Gap 1).

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Full — base `main` — reason: delicate

Lens returns: anchored (STAGE_1 pass, signal changes_requested), cold-Claude (19 findings, signal changes_requested), cold-Codex (no actionable regressions). All three were present.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the baseline and Iteration 2 Validation Outcomes tables have no `Fail`, and every required check was re-run. Red-first evidence is present across the handoff: the baseline rows against `9174291` for AC-7(a)–(d) and AC-8, plus the Iteration 2 rows against `cbb448b` for Bugs 1 and 3. The AC-7(e) mutation check (removing the clearing call turns it red) is recorded. Stage 1: **Pass**.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | The anchored lens confirmed with a real-git control that the new guard neither commits nor refuses for untracked task dirs. |
| AC-2 | Met (unchanged from round 1) | `copyTaskScaffoldIntoWorktree` is unchanged (`src/orchestrator/git.ts`:313-343). |
| AC-3 | Met (unchanged from round 1) | The start point is unchanged and the guard runs no fetch. |
| AC-4 | Met | Copy condition unchanged. The new guard (`src/orchestrator/git.ts`:274-304, called at :461) refuses the round-1 lost-file states. The guard over-refuses in some valid states, see Finding 1. |
| AC-5 | Met (unchanged from round 1) | The non-worktree path never reaches the guard. |
| AC-6 | Met (unchanged from round 1) | |
| AC-7 | Met | (e) now runs with main one real squash behind origin while tracking the task, and asserts the clearing probes ran and nothing was removed (`tests/run-task-ship.test.ts`:1958-1995). |
| AC-8 | Met (unchanged from round 1) | Only the hint text changed. |
| AC-9 | Met | Both code hints clean before rebasing (`src/orchestrator/main.ts`:1777-1783, `src/task/index.ts`:1423-1427), and real-git tests execute the printed steps. A doc sibling is still stale, see Finding 2. |
| AC-10 | Met (unchanged from round 1) | |
| AC-11 | Met (unchanged from round 1) | |
| AC-12 | Met | The exact `git grep` was re-run: exit 1, no output. |
| AC-13 | Partial | In-scope restatements in the doc and skill were fixed and the mirrors synced. Still stale: `.claude/skills/canon-pipeline/recovery.md`:105 (Finding 2), and the files outside Affected Files (Spec Gap 1). |
| AC-14 | Met (unchanged from round 1) | |

### Verifying Round 1 findings

- _correctness bug 1:_ "Bootstrap silently drops REPO_ROOT task edits when `tasks/<id>/` is tracked on base" → addressed (`src/orchestrator/git.ts`:274-304, :461; tests in `tests/run-task-safety.test.ts`). It refuses before branch or worktree creation, cannot be bypassed with `--force`, and fails closed on probe errors ✓. The fix introduces a false positive, see Finding 1.
- _correctness bug 2:_ "The AC-7(e) test cannot fail" → addressed (`tests/run-task-ship.test.ts`:1958-1990) ✓
- _correctness bug 3:_ "Divergence hints recommend a blocked rebase" → addressed in code (`src/orchestrator/main.ts`:1777-1783, `src/task/index.ts`:1423-1427) ✓. A doc sibling is still open, see Finding 2.
- _correctness bug 4:_ "In-scope docs still describe the old ship behavior" → addressed (`docs/pipeline-orchestrator.md`:529, `.claude/skills/canon-pipeline/SKILL.md`:81, :84, :183 heading) ✓
- _spec gap 1:_ "CLI help outside Affected Files" → still open. There is no spec amendment, and implement correctly left both files untouched.
- _round-1 risks and nits:_ the handoff gives an explicit deferred or retained disposition for each. Accepted as non-blocking.

### New findings (only NEW issues introduced by Iteration 2's changes)

#### Correctness Bugs

1. **[code-bug] The task-file guard refuses valid bootstraps and tells the operator to commit to base** — `src/orchestrator/git.ts`:277, :286. Flagged by 2 lenses (anchored, cold-Claude); both reproduced it in scratch repos.
   - **Cause:** every path from `git diff HEAD -- tasks/<id>/` goes into `missing` without checking whether the declared base tracks it.
   - **Shape 1:** a staged new task file that base doesn't track, e.g. `git add tasks/x/spec.md`. The copy would carry it, since `ls-files --cached --others` lists it.
   - **Shape 2:** the main checkout is on a branch other than the declared base, and that branch tracks and modifies task files that base doesn't track.
   - **Result:** both are refused with no `--force` escape. The fix the message prescribes, "Commit these task files to the declared base", is the base commit this task exists to remove. For shape 2 it can't even be done from that checkout.
   - **Why it's a bug:** the guard should refuse only content that a fresh branch from base would actually hide. The `versusBase ∩ inheritedPaths` set and the inherited-`status.json` sweep already cover those states, so the unconditional `dirty` addition is the defect.
   - **Message (anchored lens, plus a related cold-Claude note):** the single message covers two failure classes. For the second class, untracked files such as `plan.md` hidden by an inherited `status.json`, "revert them" means deleting the operator's plan. Give each class its own fix text (`docs/patterns.md` §Validation Gate Discipline).
   - **Required:** restrict the refusal to base-inherited paths whose content differs from base, plus files hidden by an inherited marker. Split the message by class. Add real-git cases that must pass: a staged new file absent from base, and REPO_ROOT on a non-base branch that tracks task files base doesn't.
   - **While there (optional):** the `--force` row at `docs/pipeline-orchestrator.md`:101 could also list this guard as not bypassed.

2. **[code-bug, stale restatement] `recovery.md` still recommends a bare rebase** — `.claude/skills/canon-pipeline/recovery.md`:105 ("decide manually (push, rebase, cherry-pick)"). Source: anchored lens.
   - This is the doc sibling of round-1 Bug 3. When a merged task's stale copy is present, a bare rebase hits the same untracked-overwrite refusal.
   - The file is in Affected Files. Add the scoped clean-before-rebase step, edit the root copy only, and let the sync hook update the mirror.

#### Risk / Guardrails (non-blocking)

- **Recorded-branch and orphaned-state re-attach skip both guards** — `src/orchestrator/git.ts`:418-433. Flagged by 2 lenses; it extends the round-1 deferred risk. If the recorded branch is gone locally, `ensureWorktree` without a start point cuts it from REPO_ROOT HEAD, runs neither `assertRepoRootCleanBeforeFirstWorktree` nor the new guard, and can reproduce the round-1 Bug 1 shape. This is only reachable from legacy or hand-edited states (REPO_ROOT status recording `worktree:true` plus a branch). It is still deferred, but it is now flagged twice and makes a good follow-up candidate.
- **Re-entry rewrites bundle members' branch records** — `src/orchestrator/git.ts`:431-433 (cold-Claude, low confidence). On the recorded-branch path, each implement entry copies and records every member. Changing bundle composition against an in-flight task could copy a secondary's stale backup and restamp its branch. This is operator misuse and unverified.
- **`ensureWorktree` returns early for an unregistered leftover directory**, and the copy then populates it (`src/orchestrator/worktree.ts`:293-298; cold-Claude, low confidence). The early return predates this change; the copy now makes that state fail-open instead of ENOENT.
- Round-1 risks carried forward unchanged, with deferred dispositions in the handoff:
  - non-colliding backup files reach the archive commit (re-flagged by cold-Claude);
  - the fetch-then-pull race;
  - exact-path-only collisions;
  - a phantom backup after an external ship;
  - post-merge-sync's cwd-relative probes;
  - ship continuing after a fetch failure (re-flagged by cold-Claude).

#### Optional Cleanup / Nit

- `src/orchestrator/main.ts`:1782: the rewritten hint ends with "re-run `--ship`". That path is only reachable with `--allow-divergent-base`, and after the rebase local base is still ahead, so a re-run without the flag stops at the divergence gate. The hint could also print concrete `tasks/<id>` lines for the `taskIds` in scope instead of a placeholder. (anchored)
- `src/orchestrator/git.ts`:280-283: a nonexistent local `base_branch` now surfaces as "Could not verify task files … unknown revision" rather than a "base not available locally" message. `src/orchestrator/git.ts`:292 re-parses `source.stdout` once per member. (anchored)
- `copyFileSync` follows symlinks (`src/orchestrator/git.ts`:330). Cold-Claude raised this to medium this round, but it is unchanged from round 1. It needs a symlink planted in REPO_ROOT's task dir, which an agent with REPO_ROOT write access could do anyway. Kept as a nit; a follow-up could `lstat` and skip.
- Non-atomic copy of the `status.json` marker (`src/orchestrator/git.ts`:330). Unchanged from round 1. (cold-Claude)
- The post-merge-sync reset message (`src/task/index.ts`:1410) asserts the task-file commits are "already carried by the merged base", which the code does not check. The underlying behavior predates this change. (cold-Claude)
- `warnBranchOnlyTasks` exit listeners accumulate across repeated `shipTasks` calls in one process (`src/orchestrator/main.ts`:2548). (cold-Claude)
- The deleted "writes … only in the worktree after scaffold commit" test still has no replacement covering agent writes after bootstrap. Carried from round 1. This is missing coverage, not a test that cannot fail. (cold-Claude)

#### Spec Gaps

1. **[spec-gap] Restatements in files outside Affected Files are still stale** (carried from round 1, extended).
   - `src/cli/index.ts`:76-79 and :102-106, and `src/orchestrator/cli.ts`:146-150: the CLI help gives the old `--ship` order and the old post-merge-sync description. Flagged by anchored; flagged by cold-Claude in round 1.
   - **New this round:** the source comment at `src/orchestrator/validation.ts`:1436-1437 says "the orchestrator commits task artifacts to the base branch before code_review runs". Cold-Claude flagged it and it is verified. AC-13 covers source comments, but `src/orchestrator/validation.ts` is not in Affected Files either.
   - **Needs a human amendment** adding `src/cli/index.ts`, `src/orchestrator/cli.ts` and `src/orchestrator/validation.ts` to `### Affected Files`. Implement should not touch these files until then.

### Dismissed Cold Findings

- Dismissed (cold-Claude): `clearIncomingTaskCollisions` is not limited to the shipped task ids and can delete a same-id local copy. The spec prescribes this keying: the Decision says it is "keyed on the incoming tree, not on task IDs", and Known Risks "Clearing scope (AC-7, AC-8)" explicitly accepts deleting operator edits to the REPO_ROOT copy of any task the pull will replace, with the printed list as notice.
- Dismissed (cold-Claude): the guard is skipped when `task/<id>` already exists, so an existing branch's tracked artifacts win over newer REPO_ROOT edits. The spec prescribes this: AC-4(a) requires the worktree files to equal the committed branch versions over a different stale REPO_ROOT copy.
- Dismissed (cold-Claude): post-merge-sync clears before the clobber check, a partial mutation. Spec-prescribed order (Decision: "before its fast-forward and before its untracked-clobber guard"; AC-8). Also dismissed in round 1.
- Dismissed (cold-Claude): the manual scoping in `recovery.md`:95 ("only the task you are about to merge") differs from the automatic sweep. This is not a contradiction. A manual operator cannot compute the collision set, so the conservative single-task rule is safe, and the automatic path clears only colliding (merged) files.
- Dismissed (cold-Claude): `CHANGELOG.md` `[Unreleased]` is empty. The QA phase proposes changelog text and the release step writes it (qa.md release rules). This is not a code-review item.
- Dismissed (cold-Claude, test integrity): no case covers a staged new file or a HEAD that isn't base. Not dismissed on substance; folded into Finding 1's required tests.
- cold-Codex reported no actionable regressions; nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

For implement: fix Findings 1–2 within the Affected Files. Leave Spec Gap 1's three files untouched until a human amends the spec.

## Round 3 — verifying iteration 3's response to round 2

**Scope:** Full — base `main` — reason: delicate

Lens returns: anchored (STAGE_1 pass, signal changes_requested on the carried spec gap), cold-Claude (21 findings, signal changes_requested), cold-Codex (one P2). All three were present. Under the round 3 rules, only correctness bugs and spec gaps can drive the verdict; nits and wording-only items are folded in or dropped.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the baseline and Iteration 2–3 Validation Outcomes tables have no `Fail`, and every required check was re-run. Red-first evidence is present across the handoff (baseline rows against `9174291`, Iteration 2 rows against `cbb448b`, Iteration 3 rows against `f374f50`). Stage 1: **Pass**.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | The guard only reads git state. |
| AC-2 | Met (unchanged from round 2) | `copyTaskScaffoldIntoWorktree` is unchanged. |
| AC-3 | Met | The new `other-head` test checks that `task/<id>` starts at local `main` while REPO_ROOT is on another branch. No fetch runs. |
| AC-4 | Met | The guard (`src/orchestrator/git.ts`:274-320, called at :477) still refuses the round-1 lost-file states: modified, staged or deleted inherited files; untracked files behind an inherited marker; bundle secondaries. It now accepts staged-new files, an off-base HEAD and a matching base. The anchored lens ran the 13 targeted tests, all passing. |
| AC-5 | Met (unchanged from round 2) | |
| AC-6 | Met (unchanged from round 2) | |
| AC-7 | Met (unchanged from round 2) | |
| AC-8 | Met (unchanged from round 2) | |
| AC-9 | Met | The doc sibling at `.claude/skills/canon-pipeline/recovery.md`:105 is fixed and its mirror is in sync. |
| AC-10 | Met (unchanged from round 2) | |
| AC-11 | Met (unchanged from round 2) | |
| AC-12 | Met | The exact `git grep` was re-run: no hits. |
| AC-13 | Partial | All in-scope restatements are aligned, and the template-sync and docs-refs checks were re-run and pass. The files outside Affected Files are still stale (Spec Gap 1). |
| AC-14 | Met (unchanged from round 2) | |

### Verifying Round 2 findings

- _correctness bug 1:_ "The task-file guard refuses valid bootstraps and tells the operator to commit to base" → addressed. The unconditional `diff HEAD` set is gone (`src/orchestrator/git.ts`:277-296), and each class has its own message (:298-320). The new accept cases (`tests/run-task-safety.test.ts`:10428-10470) fail on the pre-fix code and pin which refs the probes read ✓
- _correctness bug 2:_ "`recovery.md` still recommends a bare rebase" → addressed (`.claude/skills/canon-pipeline/recovery.md`:105, mirror synced) ✓
- _spec gap 1:_ "Restatements outside Affected Files" → still open. There is no amendment, and the three files are correctly untouched.

### New findings

#### Spec Gaps

1. **[spec-gap] Restatements in files outside Affected Files are still stale** (carried from rounds 1–2; flagged this round by anchored and cold-Claude).
   - `src/cli/index.ts`:76-79 and :102-106, and `src/orchestrator/cli.ts`:146-150: the CLI help gives the old `--ship` order and the old post-merge-sync description.
   - `src/orchestrator/validation.ts`:1436-1437: a source comment says the orchestrator commits task artifacts to base before code_review.
   - **Needs a human amendment** adding these three files to `### Affected Files`.
   - **In the same pass:** the `--ship` summaries in `README.md`:97 and :280 also omit the stale-copy clearing step (cold-Claude). README is in scope, but this is wording-only, so under the round 3 rules it does not drive the verdict on its own.

2. **[spec-gap] A task whose files are already tracked on base can no longer start implement in a PR-only repo** — `src/orchestrator/git.ts`:274-320 (the guard) with the spec Decision's copy condition. Source: cold-Claude (medium, high confidence). The anchored lens's identical-content false positive is folded in here.
   - **Failure:** suppose `tasks/<id>/` reached base before `canon run`, for example because the spec was merged through a PR. Every pre-implement phase then rewrites REPO_ROOT `tasks/<id>/status.json`. At implement, the guard reports the inherited `status.json` as changed, and also any untracked `plan.md` it hides, and refuses with no `--force` escape.
   - **Why the remedy doesn't work:** the only remedy is a new commit on local base. That commit trips the divergence gate at `--pr`, and it can't be pushed at all where every commit to base must come through a PR. That is the spec's own Problem item 3.
   - **Related false positive (anchored lens, reproduced):** when REPO_ROOT HEAD doesn't track a base-tracked path, an identical untracked copy still appears in `git diff <base>` as a deletion, so the guard refuses even though nothing would be lost.
   - **Why it's a spec gap, not a code bug:** the guard is the fail-closed behavior round 1 asked for. The real fix contradicts the spec Decision: "copied … only when the worktree has no `tasks/<id>/status.json`" and "never overwrites an existing destination file". On a fresh branch cut from base, the base-inherited task files are base's stale copy, and REPO_ROOT holds the newer pre-implement state.
   - **Decision for the human:** either
     - (a) keep the refusal and document that `tasks/<id>/` must not be committed to base before implement, or
     - (b) amend the Decision so that a fresh-branch bootstrap overwrites base-inherited task files with the REPO_ROOT copy. Existing branches still win, per AC-4(a).
   - Option (b) would also remove most of the guard, along with its false positives.

#### Risk / Guardrails (non-blocking; follow-up candidates)

- **A leftover unregistered worktree directory now fails open** — `src/orchestrator/worktree.ts`:294-298 with `src/orchestrator/git.ts`:479. cold-Claude flagged this in rounds 2 and 3. `ensureWorktree` returns an existing `.canon/worktrees/<id>` that isn't registered for the branch. The old record loop crashed with ENOENT there. Now the copy populates the directory, and git commands inside it resolve to REPO_ROOT's repository on base. Reaching this needs a manually damaged worktree directory. The early return itself predates this diff. Follow-up: verify the returned path is a registered worktree on the expected branch before copying.
- **Recorded-branch re-attach skips both guards** (`src/orchestrator/git.ts`:447-452). Both Claude lenses flagged it this round, carried from round 2. It is only reachable from legacy or hand-edited states.
- **The revision-round hallucination warning can no longer fire before QA** — `src/orchestrator/phases/implement.ts`:97-104 (cold-Claude). Copied `notes.md`, and `handoff.md`, stay `??` until the QA-end commit, so they always count as meaningful changes. The warning is a best-effort heuristic, so its silence doesn't change outputs.
- **The divergence-recovery re-run still needs `--allow-divergent-base`** (`src/orchestrator/main.ts`:1782, `.claude/skills/canon-pipeline/recovery.md`:105). Flagged by 2 lenses. After the rebase, local base is still ahead, so the suggested re-run without the flag stops at the gate again.
- **Refusal tests only run with REPO_ROOT on base** (anchored). Nothing pins that an off-base checkout still refuses a differing inherited file.
- Carried from earlier rounds: non-colliding backup files reach the archive commit; ship continuing after a fetch failure (both re-flagged by cold-Claude); the fetch-then-pull race; exact-path-only collisions.

### Dismissed Cold Findings

- Dismissed (cold-Codex, P2) and Dismissed (cold-Claude, data loss): clearing unlinks colliding untracked task files without checking that they are stale backups. Both lenses flagged it (cross-model), so here is the explicit spec evidence. The spec Decision says the helper "deletes exactly those files and prints each removed path … keyed on the incoming tree, not on task IDs". Known Risks "Clearing scope (AC-7, AC-8)" accepts deleting "operator edits made to the REPO_ROOT copy of any task the pull is about to replace (the wrong copy, per the worktree-canonical decision); the printed list is the notice", and explains why ID keying would deadlock. A human may still want a stronger guarantee; that would be a spec change, not a code fix.
- Dismissed (cold-Claude): worktree artifacts are untracked until QA end, so `git clean` or `git stash -u` loses them. Accepted in spec Known Risks ("Uncommitted window grows by the scaffold"), with the REPO_ROOT copy as the backup.
- Dismissed (cold-Claude): the "recorded-interrupted" branch of `readBootstrapStatus` is likely unreachable through `canon run`. That is a defensive path, and being unreachable produces no wrong behavior.
- Dismissed (cold-Claude): post-merge-sync and `--ship` clear before checks or pulls that can still fail. Spec-prescribed order (Decision; AC-8). Also dismissed in rounds 1–2.
- Dismissed (cold-Claude): the post-merge-sync task-only reset can drop an older-engine scaffold commit for an unmerged task. This is pre-existing: the `tasks/` divergence filter is unchanged by this diff.
- Dismissed (cold-Claude): `--full-send` no longer pushes older-engine scaffold commits after upgrade. Accepted in spec Known Risks ("In-flight tasks at upgrade").
- Dismissed (cold-Claude, test integrity): the AC-7(e) test never puts an untracked file at a HEAD-tracked path. The AC's condition is "tasks/<id>/ is already tracked at REPO_ROOT HEAD", which the test sets up, and the Iteration 2 mutation check shows it fails when the clearing wiring is removed. The `git rm --cached` corner is not the AC.
- Dismissed (cold-Claude): the non-worktree no-PR banner's `git clean` could delete uncommitted task files. The banner applies after `human_review`, when the QA-end and human_review commits have tracked the artifacts. The steps are the spec-prescribed remove-then-merge path.
- Dismissed (cold-Claude): the guard is skipped when `task/<id>` already exists. AC-4(a) prescribes that existing branch artifacts win. Also dismissed in round 2.
- Dropped under the round 3 rules (nits and wording): raw `Error` versus `die` in the copy; symlink-following in the copy; accumulating exit listeners; the deleted post-bootstrap leak test; hint tests that run git commands by hand; guard message wording and the doc naming mismatch (`docs/pipeline-orchestrator.md`:101 vs :306).

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap

Halting for the human. To unblock:
1. Amend `### Affected Files` to add `src/cli/index.ts`, `src/orchestrator/cli.ts` and `src/orchestrator/validation.ts` (Spec Gap 1).
2. Decide (a) or (b) for base-tracked task files at bootstrap (Spec Gap 2).
3. Reroute.
