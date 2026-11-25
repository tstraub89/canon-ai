---
name: canon-pipeline
description: Use when an existing canon task needs the pipeline driven forward — invoking `canon run`, advancing a single phase, opening the draft PR, shipping a merged task, or recovering from a snag (auto-block hit, phase mismatch, post-merge branch divergence, agent auth failure). Also for release and shipping operations: finalization, hotfix absorption, and any release model (release-branch, trunk, tag, or no-versioning). Don't use to author a new spec (use `/canon-spec`) or check pipeline status (use `/canon-status`).
allowed-tools: Read Glob Grep Bash(canon task *) Bash(canon run *) Bash(canon watch *) Bash(canon stop *) Bash(git *) Bash(gh *)
effort: medium
---

# Pipeline Operations

This skill drives `canon run`. It encodes:
- common command patterns (start, advance, ship, open PRs)
- pre-flight checks before invoking the pipeline
- snag-recovery flows (auto-block reset, phase mismatch, post-merge sync)

For orchestrator internals — pipeline tiers, the model/effort matrices, env-var defaults, worktree mechanics, session-resumption, auto-commit guardrails — read `docs/pipeline-orchestrator.md` on demand. Per-repository Codex models and implement effort live in the `codex` section of the repository's canon config, and `canon run <id> --dry-run` prints each primary phase's model and effort without spawning an agent (it omits the mixed-mode cold Codex review lens, which resolves separately).

## Command reference

```bash
canon run <id> [flags]
canon task <subcommand> [args]
```

## Pipeline phases (in order)

```
spec → spec_review → plan → implement → code_review → qa → human_review
```

## Do NOT use this skill for

- Authoring a spec (use `/canon-spec`)
- Reading task status (use `/canon-status`)
- Drafting changelog entries (use `/canon-changelog`)

---

## Standard flows

### 1. Start a task's pipeline

After spec (and, for fast-tier tasks, plan) is approved:

```bash
canon run <task-id>
```

Add `--step --expect <phase>` if you want one phase at a time with a guard. Add `MAX_REVIEW_LOOPS=N` when the default loop cap is too low for a complex spec.

In Claude Code `canon run` detaches after about a second and prints a PID and log path. Run `canon watch <task-id>` (do not pipe it, do not tail the log) to wait for the run to settle. It prints one summary line and exits 0 on a healthy stop, 3 on an auto-block, 4 on death, 5 on timeout. `canon stop <task-id>` terminates a detached run. `--step`, `--pr` and `--ship` run in the foreground and need no watch. Use `--timeout 5m` (exit 5 means re-invoke) when your shell tool caps command duration; exit 2 covers several cases, so read the summary's `reason` field: `launch_window_timeout` means the orchestrator may still be starting (re-run `canon watch`), while nothing-to-watch or unreadable state means check `canon task status <id>`.

**What happens after `canon run` (full-tier, no `--full-send`):** the pipeline runs the spec reviewer *first*, then **halts at the human spec gate after the spec reviewer approves the spec** (before `plan`). In mixed mode Codex is the spec reviewer; in `claude` mode that role runs on Claude Code. `human_spec_gate` is a single-use latch that fires *after* `spec_review`, never before it — so seeing the run go straight into `spec_review` with the gate still `true` is correct, not a skipped gate. Review `spec.md` + `spec-review.md`, including the `Author` rows in the spec's *Judgment Calls* section (calls the human has not explicitly made, including any the spec reviewer's revisions added), then re-run `canon run <id>` to pass the gate into `plan`. **Under `--full-send` there is no halt:** the gate is pre-cleared, so the pipeline flows `spec_review → plan → … → draft PR` uninterrupted (on a `delicate` task `--full-send` also needs `--force`). (Fast-tier without full-send: the gate sits at `spec_review` entry and is usually pre-cleared during plan-writing. Full mechanics: `docs/pipeline-orchestrator.md` §"Spec gate is a single-use latch".)

**Pre-flight before kicking off:**
- Working tree is clean — commit or stash any pending edits. The orchestrator auto-commits task artifacts but will not touch source files outside `handoff.md`'s Changes table.
- `tasks/<id>/status.json`: `task_size`, `delicate`, `human_spec_gate`, `worktree` set correctly.
- **Fast-tier (XS, non-delicate)**: spec + plan written, `phases.spec_review = { "status": "done", "verdict": "approved" }`, `phases.plan.status = "done"`, `human_spec_gate = false`.
- **Full-tier (S/M/L/XL/delicate)**: spec written, `phases.spec.status = "done"`, `phases.spec_review.status = "pending"`.

### 2. Advance one phase

```bash
canon run <task-id> --step --expect <phase>
```

Use `--expect` whenever you have a specific next phase in mind — it fails fast on phase mismatch instead of silently running the wrong phase.

Valid phases: `spec | spec_review | plan | implement | code_review | qa | human_review`

### 2b. Decide follow-ups at human review

Before `--pr`, read `tasks/<id>/done.md` → `## Follow-ups`. For each `untracked` row, ask the human to choose one of four options: file it now, write it after merge (`post-ship`), drop it, or fix it in this task with `canon run <id> --reroute` and an amendment. Offer all `nit` rows as one batch. Before filing an item, confirm it is still open in the current tree. File accepted items the project's way (issue tracker, backlog, or its established convention); if no convention is evident, ask the human where to file it. Record each outcome in the row's Tracked cell (`dropped`, `post-ship`, a link, `#<n>`, or `task:<id>`) before `--pr`. A row fixed in this task is no longer a follow-up: remove it from the table and note the fix under Decisions Made. In worktree mode, edit the worktree's copy. Full-send skips this human_review stop, so its follow-ups first appear at `--ship`.

### 3. Open a draft PR

```bash
canon run <task-id> --pr
```

Pushes the task branch (first pushing canon's own unpushed scaffold commits on `base_branch`, or creating it on origin if missing when every local-only commit is canon-safe or already published) and opens a draft PR through GitHub REST via `gh api` targeting `base_branch` from `status.json`. After it runs, read `tasks/<id>/handoff.md` and verify the auto-generated PR body matches actual scope — rewrite via `gh pr edit <num> --body-file ...` if code-review iterations expanded scope beyond the initial handoff.

`--pr` aborts if merging `origin/<base>` conflicts or the branch changes files outside the spec's `### Affected Files` table (after QA, QA-managed docs, telemetry and the tasks' own artifacts are also allowed). Resolve a merge conflict in the branch; for an intentional out-of-scope change, fix the table or amend the spec. Don't reach for `--force`. `--push` pushes without opening a PR.

### 4. Ship an approved task

After the PR is marked ready and approved — do **not** merge it manually:

```bash
canon run <task-id> --ship              # merge the PR (squash by default), pull base, tear down worktree, archive, clean up branches
```

`--ship` merges with the configured method (`ship.merge_method`, squash by default), deletes the remote task branch, then pulls/fast-forwards the base branch, proves the merge (forge-proof gate) before deleting any local task branch, tears down the worktree, and archives `tasks/<id>/`. If the PR was already merged externally, `--ship` detects that and picks up at cleanup — and `canon task post-merge-sync` exists as a recovery helper if the local base has diverged after an external squash or rebase merge, not as a standard pre-ship step.

If the task targeted a release branch (`base_branch` in `status.json`), `--ship` merges and archives there — not main.

`--ship` requires the task to be at `human_review` (or `complete`). If it refuses with "task is at: code_review" (or similar), the squash or rebase merge captured a pre-progression `status.json`. Advance the phases manually — artifacts are on disk, so this is paperwork. Use the verdict actually checked in `tasks/<task-id>/review.md` (`approved` or `approved_with_nits`) — the phase gate rejects a verdict that doesn't match the artifact:

```bash
canon task phase <task-id> code_review done <verdict-from-review.md>
# Before marking qa done, make sure done.md has a parseable ## Follow-ups section (None. or the table).
canon task phase <task-id> qa done
canon run <task-id> --ship
```

After `--ship`, write the rows in the **Post-ship follow-ups** block in the post-ship docs commit on the base branch. Put each row in the **Untracked follow-ups** block to the human for a decision. A `Follow-ups … not listed` warning means the section is missing or unparseable; inspect the archived `done.md` by hand.

### 5. Release and shipping operations

Canon's `--pr` / `--ship` / `base_branch` mechanics are **model-neutral**. The `base_branch` field is recorded in `status.json` **per task** at creation, so a single repository may use different release models for different task surfaces — pick the model that matches the work at hand.

**Hybrid repos are first-class**: a project with one surface on versioned release branches and another shipping straight to the main line can use different `base_branch` values per task with no global setting. Canon supports all shapes because the per-task `base_branch` is the only release-model knob the orchestrator reads.

**Authority pointer**: For every recipe below, your project's own `docs/decisions.md` §"Versioning and release policy" (and/or your project's release doc) is the source of truth for version numbers, changelog policy, branch strategy, and tag conventions. Canon provides mechanics; your project's policy provides decisions.

**Always check working tree state before branch operations.** If `git status --porcelain` is non-empty, surface it and ask before proceeding. Never blow away uncommitted work.

---

#### Recipe: release-branch-per-version

One release branch per version (`release/vX.Y`). Tasks land on the release branch; a merge PR ships the whole release to the default branch.

1. Check out `release/vX.Y` (initialize it per your project's release doc if it doesn't exist yet — this skill does not run initialization commands).
2. `canon task new <id> "Title"` — auto-detects `base_branch: release/vX.Y`.
3. Run the pipeline normally. `--ship` merges the task to `release/vX.Y`.
4. **Hotfixes during a release cycle**: hotfixes go directly to the default branch. After the hotfix lands, offer: "Release branch `release/vX.Y` will need to absorb this — want me to merge the default branch into it?"
5. **Finalize**: once all vX.Y tasks are merged, use `/canon-changelog finalize` to stamp the unreleased block with today's date.
6. **Ship the release**: `gh pr create --base <default-branch> --head release/vX.Y --title "vX.Y: <theme>"`. After merge, `canon task post-merge-sync` on the default branch. Tag and GitHub release steps live in your project's release doc.

---

#### Recipe: trunk-from-main

All tasks target the project's default branch (`main` or `master`). No separate release branch.

1. `canon task new <id> "Title"` while on the default branch — auto-detects `base_branch: main` (or `master`).
2. Run the pipeline normally. `--ship` merges the task directly to the default branch.
3. Version bumps, changelog entries, and tags are handled on the default branch per your project's versioning policy — not prescribed by canon.

---

#### Recipe: tag-from-main

Tasks land on the default branch; releases are marked with a tag rather than a release branch.

1. Same as trunk-from-main for task targeting and pipeline execution.
2. After the desired set of tasks ships, create a tag from the default branch per your project's tag convention. Canon does not manage tag creation or GitHub release publication — those belong to your project's release doc.

---

#### Recipe: no versioning

Tasks land on the default branch; no version numbers, no CHANGELOG, no tags.

1. `canon task new <id> "Title"` on the default branch.
2. Run the pipeline. `--ship` merges to the default branch.
3. Skip all versioning, changelog, and tagging steps. Use `/canon-changelog` only if and when your project adopts a CHANGELOG.

### 6. Reroute once implementation has begun

`--reroute` is allowed once implementation has begun: current phase `code_review`, `qa`, or `human_review` (any status or verdict), or `implement` when implement is in progress or blocked, code review is blocked, or code review already ran in the current loop (a review round or a pre-flight rejection). In a bundle, a sibling at implement pending with no current-loop activity is admitted alongside a task that qualifies when both belong to the same non-empty task branch. Name every task of a shared-branch bundle in one reroute; a reroute that names only part of it is refused before any state changes, and the message lists the missing tasks. A task admitted as a sibling still needs its own Amendment section.

**Deciding to reroute a task is a human decision, not something an agent driving canon infers on its own** — even under `--full-send` or another autonomous mode, get an explicit human decision before invoking `--reroute`.

1. Write the new requirements into `spec.md` as an Amendment section — **required**, not optional (unless this is a spec_gap-entry reroute, where only the `spec_gap` tasks need one; approved siblings ride along): the reroute pre-flight gate aborts unless the heading `## Amendment` (round 1) or `## Amendment Round N` (round 2+) exists. A note elsewhere doesn't count. Edit the worktree copy if a worktree exists.
2. Reroute re-enters at the tier's review altitude:
   ```bash
   canon run <task-id> --reroute        # detaches and runs the whole rerouted pipeline; follow with canon watch <task-id>
   # One phase at a time instead, in a single invocation:
   # Full tier (S/M/L/XL/delicate) re-enters at spec_review — amendment gets reviewed, plan refreshed:
   canon run <task-id> --reroute --step --expect spec_review
   # Fast tier (XS, non-delicate) re-enters directly at implement:
   canon run <task-id> --reroute --step --expect implement
   ```
3. On a full-tier reroute an armed `human_spec_gate` halts after the amendment's `spec_review`; re-arm or clear it with `canon task set <id> human_spec_gate true|false` before rerouting. A delicate task refuses `false`: let the gate halt, review the amendment, and resume with `canon run <id>` (`docs/pipeline-orchestrator.md` §"Spec gate is a single-use latch").
4. If the amendment review blocks with `changes_requested`, revise the Amendment section and re-run plain `canon run <task-id>` — **not** `--reroute` (that would start a new reroute round).

---

## Snag recovery

When the pipeline gets stuck — auto-block on a review loop, phase mismatch, `--ship` refusing, branch divergence after squash or rebase merge, parallel-task artifact conflicts, or agent auth 401 — see [recovery.md](recovery.md). Each scenario has a documented diagnosis and fix.

## Pre-flight checklist before `--pr` or `--ship`

1. Working tree clean inside the worktree (no uncommitted source).
2. All ACs marked Met in `handoff.md` AC Coverage table.
3. Validation Outcomes table has no Fail rows except clearly-labeled unrelated-flake rows.
4. `done.md` exists (qa phase wrote it).
5. Follow-ups are decided (no `untracked` rows) or deliberately left for `--ship` to surface.
6. `review.md` shows `approved` or `approved_with_nits`.

If any are missing post-pipeline, manually advance or fix before `--pr` / `--ship`.

---

## Related

- `docs/pipeline-orchestrator.md` — orchestrator internals, model matrix, reroute, ship mechanics (the primary reference for this skill).
- `/canon-status` — read task state and get recommended next action.
- `/canon-spec` — author a new task spec.
- `/canon-spec-review` — adversarial pre-pipeline spec review before invoking the pipeline.
- `/canon-changelog` — draft release notes from completed tasks.
- `/canon-init` — fill canon scaffold docs on a fresh project.
