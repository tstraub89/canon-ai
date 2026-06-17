---
name: canon-inline-review
description: Use when the human wants an independent cross-review of below-pipeline work - uncommitted changes, one commit, or a whole branch before a PR. Triggers on "/canon-inline-review", "review my uncommitted changes", "codex review this", "cross-review before I commit", "review the last commit", and "review my branch". Not for spec compliance (use canon run / --reroute) or the pipeline's own code_review phase.
allowed-tools: Bash(git status *) Bash(git log *) Bash(git rev-parse *) Bash(git symbolic-ref *) Bash(codex review *) Bash(codex exec review *)
effort: medium
---

# canon-inline-review

Use this skill to drive an independent second-model review of below-pipeline work. It is for correctness and quality bugs in inline edits and XS fixes that are too small for a canon task.

## When to use

- Non-trivial inline edits
- XS fixes too small to justify a canon task
- Before committing or before opening a PR

Claude never self-reviews its own inline code. Use this skill to invoke Codex as the independent reviewer.

Scope bound: this catches correctness and quality bugs across models. It is not a spec-compliance gate; anything with acceptance criteria goes through `canon run` / `--reroute`, not this skill.

## Target-selection contract

Follow this as a guided procedure. The skill determines the target from operator intent; it does not infer intent from git history.

1. Read operator intent first from the request, the conversation, and `$ARGUMENTS`. Resolve the **target** and any **steering text** as two separate things — for the default (uncommitted) target they are *not* mutually exclusive, and dropping the steering is the most common way this skill goes wrong.
   - **Target — specific commit**: if intent names a commit SHA, "last commit", `HEAD`, or a `HEAD~N` reference, resolve it to a SHA with `git log -1 --format=%H <ref>` or `git rev-parse <ref>`, then use `--commit <SHA>`.
   - **Target — whole branch**: if intent names a branch or says "whole branch" / "pre-PR", use `--base <branch>`. Resolve the repository's default branch from `git symbolic-ref --short refs/remotes/origin/HEAD` and strip the `origin/` prefix; if that command exits non-zero (e.g. fresh clone or no `origin/HEAD` set), fall back to `main`.
   - **Target — uncommitted tree** (the default): use this when intent says "uncommitted" / "before commit" or gives no other target signal.
   - **Steering text**: any instruction about *what to look for* (e.g. "verify no behavior change", "watch for stale-closure risk") rather than which diff to review. It must reach the run:
     - For the **uncommitted** target, pass the steering as the positional `PROMPT` — prompt-only mode defaults to the uncommitted tree, so a bare prompt covers both the target and the steering. Do **not** fall back to bare `--uncommitted` when steering exists; that silently drops it and produces a cold review.
     - For a **`--commit`** or **`--base`** target, the selector and a prompt cannot be combined (see Mutual exclusivity). Keep the selector for scope correctness and state in your summary that the steering could not be passed to this run.
   - With **no** steering text and an uncommitted target, use bare `--uncommitted`.
2. If the request is still genuinely ambiguous after reading intent, use `AskUserQuestion` rather than guessing.
3. Run one read-only guard only: `git status --porcelain`.
   - This check exists only to prevent an empty working-tree review. It must not be used to infer whether the operator meant a commit or a branch.
   - If the resolved target reviews the uncommitted tree — literal `--uncommitted` **or** prompt-only mode (which defaults to the uncommitted tree) — and the tree is clean, do not run an empty review. Reconcile from the conversation or ask which target the operator wants.
4. State the chosen target and the scope it covers before running, then run the review.

Treat `codex exec review --help` as the version-pinned source of truth for the live flag set. Do not freeze the flag list in this skill when the installed CLI can tell you the current forms.

## Mutual exclusivity

A target selector (`--uncommitted`, `--commit <SHA>`, or `--base <branch>`) and a positional `PROMPT` cannot be combined. The CLI rejects that pair with `cannot be used with '[PROMPT]'`.

The practical consequence: **the only target you can steer is the uncommitted tree.** Prompt-only mode (`codex exec review "<PROMPT>"`) defaults to the uncommitted tree, so a bare prompt steers *and* targets the working tree at once — never add `--uncommitted` alongside it. A `--commit`/`--base` review cannot carry steering; if intent asks for both, the selector wins and you note the steering was dropped.

## Running the review

`codex review` is the shorthand for `codex exec review`. Use the shorthand when you want the concise form; treat `codex exec review` as the documented form.

Run non-interactively with the chosen selector:

- `codex exec review --uncommitted`
- `codex exec review --commit <SHA>`
- `codex exec review --base <branch>`
- `codex exec review "<PROMPT>"` to steer an uncommitted review (prompt-only; do not add `--uncommitted`)

Do not pipe stdin into the command. The `review` subcommand already runs non-interactively.

## Reporting findings

Summarize the review output concisely. Group findings by severity, then stop. Do not dump raw output into the session.

- If there are findings, report the important ones first and keep the summary short.
- If there are no findings, say so in one line.

## Gotchas

- `--commit <SHA>` reviews only that commit's diff, not the cumulative branch state.
- There is no multi-SHA or commit-range form.
- `--uncommitted` excludes already-committed work.
- A clean working tree makes `--uncommitted` a no-op.
