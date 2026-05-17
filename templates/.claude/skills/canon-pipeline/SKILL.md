---
name: canon-pipeline
description: Drive the canon task pipeline — kick off, advance phases, open PRs, ship, recover from auto-blocks, and reconcile branches after merges. Encodes operational patterns and snag-recovery flows; for orchestrator internals (model matrix, env vars, session-resume mechanics) see docs/pipeline-orchestrator.md.
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

### 4. Ship a merged task

After the PR squash-merges:

```bash
canon task post-merge-sync              # reconcile local branch with origin
canon run <task-id> --ship              # archive, delete task branch, push base branch
```

If the task targeted a release branch (`base_branch` in `status.json`), `--ship` archives there — not main.

`--ship` requires the task to be at `human_review`. If it refuses with "task is at: code_review" (or similar), the squash-merge captured a pre-progression `status.json`. Advance the phases manually — artifacts are on disk, so this is paperwork:

```bash
canon task phase <task-id> code_review done approved_with_nits
canon task phase <task-id> qa done
canon run <task-id> --ship
```

### 5. Release branches

**"Let's start vX.Y":**
1. Verify main is clean and in sync: `canon task post-merge-sync` if needed.
2. Initialize the release branch:
   ```bash
   canon task release-init X.Y.0
   ```
   Creates `release/vX.Y`, bumps `package.json`, inserts an empty `## vX.Y - unreleased` CHANGELOG block, commits, pushes.
3. Confirm: "Release branch `release/vX.Y` initialized and checked out."

**Creating a task on a release branch:** run `canon task new <id> "Title"` while checked out on `release/vX.Y`. The helper auto-detects the current branch and writes `base_branch: release/vX.Y`. Don't pass `--base` — auto-detect is the load-bearing convention.

**Creating a task for a release branch while NOT checked out on it:** check if `release/vX.Y` exists before acting. If yes, warn about uncommitted changes, switch to it, pull, then create the task. If no, ask: "release/vX.Y hasn't been initialized yet — want me to run `release-init`?"

**Hotfixes during a release cycle:** hotfixes go directly to main. After the hotfix lands, proactively offer: "Release branch `release/vX.Y` will need to absorb this — want me to merge main into it?"

**"Let's ship vX.Y":**
1. Verify all vX.Y task PRs are merged to `release/vX.Y`.
2. Swap `## vX.Y - unreleased` → `## vX.Y - YYYY-MM-DD` in CHANGELOG.md.
3. Commit and push.
4. Open the release PR: `gh pr create --base main --head release/vX.Y --title "vX.Y: <theme>"`.
5. After merge: `canon task post-merge-sync` on main, then tag and create a GitHub release.

**Always check working tree state before branch operations.** If `git status --porcelain` is non-empty, surface it and ask before proceeding. Never blow away uncommitted work.

### 6. Reroute after human rejection

If the user rejects at `human_review`:
1. Write rejection feedback into `spec.md` as an Amendment section (or into a note for small tweaks).
2. Reroute resets implement/code_review/qa to pending and flags Codex to read the amended spec:
   ```bash
   canon run <task-id> --reroute
   ```

---

## Snag recovery

These are patterns from real production use. Use them as first response, not last resort.

### Auto-block on `spec_review` or `code_review` (loop cap hit)

When the loop cap is hit, the pipeline writes an `escalations[]` entry and stops. Two paths:

**Path A — authorize more loops (simple cap bump):**
```bash
MAX_REVIEW_LOOPS=6 canon run <task-id>
```

**Path B — stale-context reset** (use when the latest review flagged phrases that no longer exist in the spec — a session-resume staleness artifact):
```bash
canon task reset-spec-review <task-id>
MAX_REVIEW_LOOPS=6 canon run <task-id>
```

`reset-spec-review` archives the existing review file as `*-prior-<N>.md` (so the next pass doesn't re-emit the same complaints), resets the phase to pending, clears verdict and iteration counter, and drops the session ID.

Stop the reviewer loop once findings turn wording-only. Self-grep for flagged phrases in the current spec/code before running another expensive review pass.

### Phase mismatch — pipeline routes to `spec` when you expected `spec_review`

Cause: `phases.spec_review.verdict === 'changes_requested'` is still set in `status.json` (the dispatcher routes to spec for revision before re-running spec_review).

Fix:
```bash
canon task reset-spec-review <task-id>
```

### `--ship` refuses: wrong phase

Cause: squash-merge captured a pre-progression `status.json`.

Fix (artifacts are on disk — this is paperwork):
```bash
canon task phase <task-id> code_review done approved_with_nits
canon task phase <task-id> qa done
canon run <task-id> --ship
```

### Local branch diverged from origin after a squash-merge

Symptom: `git pull --ff-only origin main` fails. Local has pipeline-telemetry commits that the squash-merge absorbed.

Fix:
```bash
canon task post-merge-sync
```

If local-only commits include real source changes (not just telemetry), the helper refuses and shows what's there — decide manually (push, rebase, cherry-pick).

### Parallel task PRs conflict on `tasks/<id>/*` at merge time

Cause: while task A's pipeline ran in its worktree, auto-commits touched task-A artifacts on task B's branch too. When task A merged and archived, task B's branch still has the in-flight versions.

Fix:
```bash
cd <task-B-worktree>
git fetch origin main
git rebase -X ours origin/main   # take main's side on task-A artifact conflicts
git push --force-with-lease origin task/<task-B-id>
```

### Agent auth 401 mid-pipeline

Fix: re-auth (`claude login`), then re-invoke the same `canon run` command. The pipeline resumes from the last completed phase. If the failed phase left `status.json` in `in_progress`, roll it back first:
```bash
canon task phase <task-id> <phase> pending
canon run <task-id>
```

## Pre-flight checklist before `--pr` or `--ship`

1. Working tree clean inside the worktree (no uncommitted source).
2. All ACs marked Met in `handoff.md` AC Coverage table.
3. Validation Outcomes table has no Fail rows except clearly-labeled unrelated-flake rows.
4. `done.md` exists (qa phase wrote it).
5. `review.md` shows `approved` or `approved_with_nits`.

If any are missing post-pipeline, manually advance or fix before `--pr` / `--ship`.

---

## Related

- `docs/pipeline-orchestrator.md` — orchestrator internals (model matrix, env vars, worktree, session resumption).
- `AGENTS.md` — workflow rules, roles, escalation, validation matrix, git/release.
- `CLAUDE.md` — Claude phase-specific guidance.
- `CODEX.md` — Codex phase-specific guidance.
- `/canon-status` — read task state and get recommended next action.
- `/canon-spec` — author a new task spec.
- `/canon-changelog` — draft release notes from completed tasks.
