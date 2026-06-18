---
name: canon-pipeline
description: Use when an existing canon task needs the pipeline driven forward — invoking `canon run`, advancing a single phase, opening the draft PR, shipping a merged task, or recovering from a snag (auto-block hit, phase mismatch, post-merge branch divergence, agent auth failure). Also for release and shipping operations: finalization, hotfix absorption, and any release model (release-branch, trunk, tag, or no-versioning). Don't use to author a new spec (use `/canon-spec`) or check pipeline status (use `/canon-status`).
allowed-tools: Read Glob Grep Bash(canon task *) Bash(canon run *) Bash(git *) Bash(gh *)
effort: medium
---

# Pipeline Operations

This skill drives `canon run`. It encodes:
- common command patterns (start, advance, ship, open PRs)
- pre-flight checks before invoking the pipeline
- snag-recovery flows (auto-block reset, phase mismatch, post-merge sync)

For orchestrator internals — pipeline tiers, the Codex model/effort matrix, env-var defaults, worktree mechanics, session-resumption, auto-commit guardrails — read `docs/pipeline-orchestrator.md` on demand.

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

**Pre-flight before kicking off:**
- Working tree is clean — commit or stash any pending edits. The orchestrator auto-commits task artifacts but will not touch source files outside `handoff.md`'s Changes table.
- `tasks/<id>/status.json`: `task_size`, `delicate`, `human_spec_gate`, `worktree` set correctly.
- **Fast-tier (S, non-delicate)**: spec + plan written, `phases.spec_review = { "status": "done", "verdict": "approved" }`, `phases.plan.status = "done"`, `human_spec_gate = false`.
- **Full-tier (M/L/XL/delicate)**: spec written, `phases.spec.status = "done"`, `phases.spec_review.status = "pending"`.

### 2. Advance one phase

```bash
canon run <task-id> --step --expect <phase>
```

Use `--expect` whenever you have a specific next phase in mind — it fails fast on phase mismatch instead of silently running the wrong phase.

Valid phases: `spec | spec_review | plan | implement | code_review | qa | human_review`

### 3. Open a draft PR

```bash
canon run <task-id> --pr
```

Pushes the task branch and opens a draft PR via `gh pr create` targeting `base_branch` from `status.json`. After it runs, read `tasks/<id>/handoff.md` and verify the auto-generated PR body matches actual scope — rewrite via `gh pr edit <num> --body-file ...` if code-review iterations expanded scope beyond the initial handoff.

### 4. Ship an approved task

After the PR is marked ready and approved — do **not** merge it manually:

```bash
canon run <task-id> --ship              # squash-merge the PR, pull base, tear down worktree, archive, clean up branches
```

`--ship` runs `gh pr merge --squash --delete-branch` itself, then pulls/fast-forwards the base branch, proves the merge (forge-proof gate) before deleting any local task branch, tears down the worktree, and archives `tasks/<id>/`. If the PR was already merged externally, `--ship` detects that and picks up at cleanup — and `canon task post-merge-sync` exists as a recovery helper if the local base has diverged after an external squash-merge, not as a standard pre-ship step.

If the task targeted a release branch (`base_branch` in `status.json`), `--ship` merges and archives there — not main.

`--ship` requires the task to be at `human_review` (or `complete`). If it refuses with "task is at: code_review" (or similar), the squash-merge captured a pre-progression `status.json`. Advance the phases manually — artifacts are on disk, so this is paperwork. Use the verdict actually checked in `tasks/<task-id>/review.md` (`approved` or `approved_with_nits`) — the phase gate rejects a verdict that doesn't match the artifact:

```bash
canon task phase <task-id> code_review done <verdict-from-review.md>
canon task phase <task-id> qa done
canon run <task-id> --ship
```

### 5. Release and shipping operations

Canon's `--pr` / `--ship` / `base_branch` mechanics are **model-neutral**. The `base_branch` field is recorded in `status.json` **per task** at creation, so a single repository may use different release models for different task surfaces — pick the model that matches the work at hand.

**Hybrid repos are first-class**: a project with one surface on versioned release branches and another shipping straight to the main line can use different `base_branch` values per task with no global setting. Canon supports all shapes because the per-task `base_branch` is the only release-model knob the orchestrator reads.

**Authority pointer**: For every recipe below, your project's own `decisions.md §Versioning and Release Policy` (and/or your project's release doc) is the source of truth for version numbers, changelog policy, branch strategy, and tag conventions. Canon provides mechanics; your project's policy provides decisions.

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

### 6. Reroute after human rejection

`--reroute` is allowed from `human_review` and from a `code_review` block with a `spec_gap` verdict.

1. Write the new requirements into `spec.md` as an Amendment section — **required**, not optional: the reroute pre-flight gate aborts unless the heading `## Amendment` (round 1) or `## Amendment Round N` (round 2+) exists. A note elsewhere doesn't count. Edit the worktree copy if a worktree exists.
2. Reroute re-enters at the tier's review altitude:
   ```bash
   canon run <task-id> --reroute
   # Full tier (M/L/XL/delicate) re-enters at spec_review — amendment gets reviewed, plan refreshed:
   canon run <task-id> --step --expect spec_review
   # Fast tier (S, non-delicate) re-enters directly at implement:
   canon run <task-id> --step --expect implement
   ```
3. If the amendment review blocks with `changes_requested`, revise the Amendment section and re-run plain `canon run <task-id>` — **not** `--reroute` (that would start a new reroute round).

---

## Snag recovery

When the pipeline gets stuck — auto-block on a review loop, phase mismatch, `--ship` refusing, branch divergence after squash-merge, parallel-task artifact conflicts, or agent auth 401 — see [recovery.md](recovery.md). Each scenario has a documented diagnosis and fix.

## Pre-flight checklist before `--pr` or `--ship`

1. Working tree clean inside the worktree (no uncommitted source).
2. All ACs marked Met in `handoff.md` AC Coverage table.
3. Validation Outcomes table has no Fail rows except clearly-labeled unrelated-flake rows.
4. `done.md` exists (qa phase wrote it).
5. `review.md` shows `approved` or `approved_with_nits`.

If any are missing post-pipeline, manually advance or fix before `--pr` / `--ship`.

---

## Related

- `docs/pipeline-orchestrator.md` — orchestrator internals, model matrix, reroute, ship mechanics (the primary reference for this skill).
- `CLAUDE.md` — operator context (phases, spec authorship, code-review rules of thumb).
- `/canon-status` — read task state and get recommended next action.
- `/canon-spec` — author a new task spec.
- `/canon-spec-review` — adversarial pre-pipeline spec review before invoking the pipeline.
- `/canon-changelog` — draft release notes from completed tasks.
- `/canon-init` — fill canon scaffold docs on a fresh project.
