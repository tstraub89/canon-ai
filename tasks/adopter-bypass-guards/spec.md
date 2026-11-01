# Spec: adopter-bypass-guards — Ship a Claude Code hook that redirects agents away from pipeline bypasses

> Written by: Claude | Review by: spec reviewer
> Status: draft (revised after spec_review round 1: worktree-root anchoring; round 2: self-contained parsing contract replaces the private-source port; round 3: shell rules scoped to the Bash tool, PowerShell sessions documented as file-edit-rule-only per the human's decision; round 4: the `status.json` root lookup runs from the target's nearest existing ancestor, not the payload `cwd`, so AC-2's absolute-path external-worktree case resolves to that worktree's root)

## Problem

Canon's pipeline relies on agents going through canon's own commands for three things:
- **State changes:** `canon task phase` / `set` / `accept` / `reset-*`.
- **Run monitoring:** `canon run`, then `canon watch`.
- **PR creation and shipping:** `canon run <id> --pr`, then `--ship`.

Today those rules are prose only, in skills, docs and operator memory, and agents keep taking the shortcuts:

- **Hand-rolled run monitoring.** Agents pipe `canon run` or `canon watch` into `tail` or `grep`, or poll `.canon-run.log` with `sleep` and `tail`.
  - Pipes buffer canon's live progress and mask its exit code.
  - Polling misses the halt states that `canon watch` classifies.
  - The operator's notes record 5+ corrections across two repos.
  - The canon-ai maintainer already runs a private user-level Claude Code hook that blocks the pipe form. `docs/BACKLOG.md` recorded that guard as "explicitly NOT porting".
- **Hand edits to `status.json`.** Agents edit `tasks/<id>/status.json` directly instead of using `canon task` helpers, which has reset loop counters and forced phase states. Some canon text actively invites this:
  - The spec and spec-revision prompts say to "flag … `delicate: true` in `status.json`".
  - Several orchestrator and task-CLI errors end with "Edit status.json", "migrate status.json manually" or "Fix the malformed files".
  - The shipped orchestrator doc says task fields are "Set in `status.json` at task creation".
- **Manual PR merge.** Agents run `gh pr merge` on a task PR instead of `canon run <id> --ship`, which skips worktree cleanup and archiving. Two orchestrator recovery messages tell the reader to run `gh pr create` or `gh pr merge --squash` by hand.

This task adopts the pattern Sentry's Junior agent calls "a little determinism": refuse the bypass at the tool boundary with a message that says what to use instead and to retry, rather than adding more prose. Claude Code `PreToolUse` hooks are that boundary for Claude-driven sessions.

Canon ships no Claude Code hooks today; `templates/.claude/` holds only skills and agents. Canon has never written an adopter's `.claude/settings.json`, which `AGENTS.md` lists as adopter-owned. Its existing pattern for settings guidance is recommend-only:
- the `RECOMMENDED_ALLOW` list in `canon doctor`;
- a README block that a drift test keeps in sync;
- a consent-gated merge in the `/canon-init` skill.

## Decision

Ship a canon-managed Claude Code `PreToolUse` hook script that denies three bypass classes, each with an instructive reason. Keep registration recommend-only, and reword canon text that invites a bypass.

1. **Hook script.** A single Node script at `.claude/hooks/canon-guard.mjs` joins the canon-managed set. `canon init` installs it and `canon upgrade` keeps it current, the same way skills ship.
   - It reads the hook payload from stdin and returns a deny decision with a reason when a rule matches.
   - It allows the call otherwise, and also on any internal error, missing field or unparseable input (fail-open).
   - It needs only Node, which canon already requires.
   - Relative paths are resolved against the payload's `cwd`. The `status.json` rule's working-tree root lookup runs with the target file's nearest existing ancestor directory as its working directory (Decision 2), so a target in a different working tree than `cwd` resolves to that tree's root. Every other git lookup (current branch for Decision 4) runs in the payload's `cwd`.
2. **Rule: `status.json` writes.** The hook denies a write to a task status file. A task status file is `tasks/<task-id>/status.json` where:
   - the path, resolved against `cwd`, sits directly under the root of the git working tree that contains it (the toplevel of the file's nearest existing ancestor directory), and that root has a `.canon/` directory;
   - `<task-id>` matches canon's task-id rule (`^[a-z0-9][a-z0-9._-]*$`, no `..`).

   Anchoring on the file's own working tree, not on `cwd` or a configured worktrees location, covers the main checkout and every canon task worktree wherever it lives: the default `.canon/worktrees/<id>/`, a custom `CANON_WORKTREES_ROOT` (absolute, or relative to the project root such as `../dev-worktrees`), and a pre-layout worktree. Each is its own git working tree whose root carries the tracked `.canon/` files. The rule does not read `CANON_WORKTREES_ROOT`, so it does not depend on the hook process seeing that variable.

   Two kinds of write count:
   - **Edit, Write and MultiEdit** tool calls on that path.
   - **Bash commands that write that path**, meaning it is the target of:
     - an in-place `sed -i` or `perl -i`;
     - an output redirect (`>`, `>>`) whose target is that path;
     - a `tee` whose file argument is that path.

   Everything else is allowed, including:
   - reads, and reads whose output is redirected elsewhere;
   - `.canon/templates/status.json`, `tasks/_templates/…` and `tasks/_archive/…`;
   - any `tasks/…/status.json` that is not directly under a working-tree root (for example `src/tasks/foo/status.json`);
   - a `tasks/<id>/status.json` in a git working tree with no `.canon/` directory, or outside any git working tree.

   There is no agent-usable override. The reason lists the command for each intent (`canon task phase`, `canon task set`, `canon task accept`, `canon task reset-spec-review` / `reset-code-review`). For a change none of them covers, it tells the agent to stop and give the human the exact edit to apply. In a headless pipeline session, the agent records that request in the task's `notes.md` and ends its turn.
3. **Rule: hand-rolled run monitoring.** The hook denies a Bash command that is either of these:
   - `canon run` or `canon watch` with its output feeding a pipe (`|` or `|&`), unless the `canon run` form is `--dry-run` or `--help`;
   - a `tail -f` or `tail -F` on a `.canon-run.log` file, or a loop (`while`, `until` or `for`) that runs `sleep` and also reads a `.canon-run.log` file.

   Single reads (`cat`, `tail -n N`, `sleep N && tail -n N …`) are allowed, as are pipes from other `canon` subcommands (`canon task …`, `canon doctor`).

   Recognized invocations:
   - `canon`, `canon-dev`, `npx canon`, and `node <path>/dist/cli/index.js`;
   - with wrapper prefixes `env`, leading `VAR=`, `command`, `exec`, `time`, `nohup` and `sudo`.

   Recognition is quote-, heredoc- and comment-aware, so a pipe character inside a quoted argument is not a pipe. The **Command parsing contract** below defines this behavior; it binds Rules 2–4.

   The reason depends on the mode:
   - For detaching forms (`canon run` without a foreground flag, and `canon watch`): run `canon run <id>` bare, since it detaches, then `canon watch <id>` with no pipe, in the background if the tool caps duration.
   - For the foreground modes (`--pr`, `--push`, `--ship`, `--step`, `--expect`): run the same command without the pipe, since it runs in the foreground and prints its own result.
4. **Rule: squash or default merge of task PRs.** The hook denies a Bash `gh pr merge` whose target PR's head is a `task/*` branch, unless the command passes `--rebase` or `--merge`. The target PR may be named by number, URL or branch, or be implicitly the current branch.
   - The reason points to `canon run <id> --ship`, which squash-merges and then archives and cleans up.
   - Rebase and merge-commit merges stay allowed. `--ship` cannot perform them, and the shipped orchestrator doc already tells those projects to merge outside canon and then run `--ship`. The deny reason repeats that guidance.
   - `gh pr create` is not denied. The `--pr` recovery path legitimately creates a PR by hand, and manual creation skips no canon cleanup.
   - If the head cannot be determined (a lookup failure or timeout), the call is allowed.
5. **Recommend-only registration.** Canon never writes `.claude/settings.json` or `settings.local.json`.
   - A single exported constant holds the hooks snippet that registers the script.
   - The README gains a hooks section whose JSON block a drift test keeps identical to that constant. The section states that the shell rules (Decision 2's Bash forms, 3 and 4) apply to Claude Code's Bash tool only, and that sessions using the PowerShell tool (the Windows default) are covered only by the Edit/Write/MultiEdit `status.json` rule.
   - `canon doctor` warns, never fails, when neither settings file registers the script for all of `Bash`, `Edit`, `Write` and `MultiEdit`, or when the script file is missing. The warning includes the snippet text.
   - `canon upgrade` prints a one-line notice when the script is installed but not registered, pointing at `canon doctor`.
   - The `/canon-init` skill's settings phase offers to merge the snippet alongside the permissions, with the same owner consent. Its "purely ergonomics" framing is updated to cover the guard.
   - canon-ai registers the hook in its own `.claude/settings.json`, merged into the existing `hooks` key so the `SessionStart` hook is preserved (dogfood).
6. **Reword text that invites a denied action.** Agents read these messages, and following one would hit a deny with no way forward. Each is rewritten to name the canon command where one exists, or to address the human:
   - Spec and spec-revision prompts: the `delicate: true` line says `canon task set <id> delicate true`.
   - `state.ts` field-validation errors ("Edit status.json"):
     - for `base_branch`, name `canon task set <id> base_branch <branch>`, valid before branching;
     - for every other field, say to ask the human to correct it in `status.json`.
   - Bundle `base_branch` mismatch (`git.ts`, `main.ts`): name `canon task set <id> base_branch <branch>` before branching, else ask the human.
   - Topology lock (`task/index.ts`): "migrate status.json manually" becomes "ask the human to migrate status.json".
   - `canon task list` malformed-status error (`task/index.ts`): "Fix the malformed files" becomes "ask the human to repair the malformed status.json files or remove the task dir".
   - `--ship` recovery messages (`main.ts`):
     - the manual `gh pr merge --squash` suggestion becomes "rerun `canon run <id> --ship`; if it keeps failing, the human can merge the PR manually and rerun `--ship`";
     - the manual `gh pr create` suggestion is kept, since it is allowed, and gains "then rerun `--ship`".
   - `docs/pipeline-orchestrator.md` (shipped):
     - the Task Sizing Fields lead-in "Set in `status.json` at task creation" names `canon task new` / `canon task set`;
     - the `worktree` row's "set it to `false`" names `canon task set <id> worktree false`;
     - the `set` row's "migrating `status.json` manually" says to ask the human.

   The doc also gains a short hook note under the `canon watch` section (new text; no "do not pipe" guidance exists today).

### Command parsing contract (binding for Rules 2–4)

The hook writes its own parser to this contract. It is self-contained: no external source is needed. It restates the behavior of the maintainer's existing user-level guard parser, which has run in production, so the AC-3 cases match how that guard already behaves.

1. **Simple commands.** A Bash command string splits into simple commands, each a list of words plus the operator that ends it. The separators are `|`, `|&`, `||`, `&&`, `;`, `;;`, `&` and newline. `|&` counts as a pipe, the same as `|`.
2. **Redirection `&` is not a separator.** An `&` right after `<` or `>`, or right before `>`, belongs to the word (`2>&1`, `>&2`, `&>file`).
3. **Quotes and escapes.** Single quotes are literal up to the next `'`. Double quotes run to the next unescaped `"`, and a backslash inside them escapes the next character. Outside quotes, a backslash escapes the next character, and backslash-newline is a line continuation. Quotes are removed from the resulting words. Nothing inside quotes produces a separator or a word boundary.
4. **Comments.** A `#` at the start of a word starts a comment that runs to the end of the line; it produces no words. A `#` inside a word (`a#b`) is literal.
5. **Heredocs.** `<<DELIM`, `<<-DELIM`, `<<'DELIM'` and `<<"DELIM"` register a heredoc. At the next newline, its body lines are skipped up to and including the terminator line (with `<<-`, leading tabs are ignored when matching it). Body lines produce no words and no separators. `<<<` (here-string) is not a heredoc.
6. **Invocation detection.** A simple command invokes canon when, after skipping leading `VAR=value` assignments and wrapper words (`env`, `command`, `exec`, `time`, `nohup`, `npx`, `sudo`), the next word's basename is `canon` or `canon-dev`, or that word's basename is `node` and the word after it ends in `dist/cli/index.js`. A leading `(`, `{` or `$(` on a word is ignored for this check. The subcommand is the first word after the program that does not start with `-`.
7. **Pipe test.** A canon invocation "feeds a pipe" when its simple command ends with `|` or `|&`.
8. **Redirect targets** (Rule 2). A write target is the word after a redirect operator word (`>`, `>>`, `>|`, `&>`, `&>>`, or a file-descriptor form such as `1>`), or the remainder of a word that begins with one of those operators (`>tasks/foo/status.json`). Input redirects (`<`) and `/dev/*` targets are never write targets.
9. **Accepted gaps (false allows).** Command substitution inside double quotes (`x="$(canon run foo | tail)"`) is plain text. Commands built indirectly (`eval`, `bash -c '…'`, `python -c`) are not inspected.

### Implementation Notes (non-binding; owned by plan/implement)

- **Deny output.** Prefer the structured `hookSpecificOutput.permissionDecision: "deny"` with `permissionDecisionReason` over exit code 2, so the reason reaches the agent verbatim.
- **Snippet.** A `PreToolUse` entry with matcher `Bash|Edit|Write|MultiEdit` and a `command` hook that is a no-op when the script is absent. For example, `test -f "$CLAUDE_PROJECT_DIR/.claude/hooks/canon-guard.mjs" && node "$CLAUDE_PROJECT_DIR/.claude/hooks/canon-guard.mjs" || true`, with a timeout above the PR-lookup timeout. Invoking via `node` avoids depending on the exec bit, which `canon upgrade` writes do not preserve.
- **Parser shape.** A single-pass character scanner that tracks the current word, the pending heredoc delimiters and the current simple command fits the contract well. Rules 2–4 share it.
- **PR head resolution.** Use `gh pr view <ref> --json headRefName` with about a 3s timeout, or `git branch --show-current` in `cwd` for the implicit form.

## Non-Goals

- **Writing adopter settings.** Canon does not create, merge or modify `.claude/settings.json` or `settings.local.json` in `init`, `upgrade` or `doctor`. Only the consent-gated skill step may, as for permissions today.
- **Codex coverage.** Claude Code hooks cannot reach Codex sessions, and canon ships no Codex config.
- **PowerShell tool coverage.** The shell rules parse POSIX-shell commands from Claude Code's Bash tool only. The snippet does not register the PowerShell tool, and the hook does not parse PowerShell syntax; a second shell grammar is out of proportion for a habit guardrail. On Windows sessions using the PowerShell tool, only the Edit/Write/MultiEdit `status.json` rule applies. The README and the decision entry say so (Decision 5, AC-12), so the feature's claims match its coverage. Adding PowerShell support is a possible follow-up if Windows adopters ask for it.
- **A base-branch commit rule.** Dropped during scoping. It would block `/canon-changelog` commits and follow-up commits on PR branches.
- **Denying `gh pr create`.** See Decision 4.
- **Making `--ship`'s merge strategy configurable.** That is a separate follow-up. Rule 4 allows `--rebase` and `--merge` instead.
- **An agent-usable override for the `status.json` rule.** It was rejected during review: an environment bypass cannot apply to Edit and Write tool calls, and would teach agents to always prefix it. The human makes such edits.
- **Other audit candidates.** These are follow-up tasks: a `--ship` dirty-worktree guard, detecting spec edits after implement starts, a public-repo leak scan, ask-before-`--pr`/`--ship`, worktree-boundary writes, and hand-rolled `status.json` reads for run state.
- **Tamper-proofing.** The hook is a guardrail against habit, not a security boundary. Coverage targets the observed forms, and a sufficiently indirect command (`python -c`, `cp`) is a false allow by design.
- **Changing the maintainer's user-level guards.** Retiring them once this ships is a separate local step.
- **Pipeline-session exemptions.** The rules apply the same inside orchestrator-spawned Claude sessions. AC-10 checks that no pipeline prompt instructs a denied action.

## Acceptance Criteria

- [ ] **AC-1: Managed and installed.** `.claude/hooks/canon-guard.mjs` is in the canon-managed set.
  - `canon init` on a fresh repo creates it.
  - `canon upgrade` restores it after a local edit, subject to upgrade's existing dirty-file rules.
  - `npm run sync-templates:check` passes with its `templates/` mirror.
  - Its mirror is added to the adopter leak-token scan list.

  Verified by `tests/cli.test.ts` init and upgrade cases, and the leak test.
- [ ] **AC-2: `status.json` writes denied, neighbors allowed.** Unit tests in a new `tests/canon-guard.test.ts` run the script as a subprocess, with `cwd` set to a temp git repo that has a committed `.canon/` file, so its linked worktrees carry one too.

  **Denied**, with a reason naming `canon task phase` / `set` / `accept` and the give-the-human-the-edit fallback:
  - Edit or Write on `tasks/foo/status.json`;
  - Edit or Write on `.canon/worktrees/foo/tasks/foo/status.json`, where that directory is a linked worktree of the temp repo;
  - Edit or Write, and `sed -i`, on `tasks/foo/status.json` inside a linked worktree created outside the project (a sibling directory, as `CANON_WORKTREES_ROOT=../wt` would place it), both by absolute path from a `cwd` in the main checkout and by relative path from a `cwd` inside that worktree. The test does not set `CANON_WORKTREES_ROOT` in the hook's environment;
  - `sed -i … tasks/foo/status.json`;
  - `jq … > tasks/foo/status.json`;
  - `echo x >> tasks/foo/status.json`;
  - `echo x >tasks/foo/status.json` (operator attached to the target);
  - `… | tee tasks/foo/status.json`.

  **Allowed**:
  - Read of `tasks/foo/status.json`;
  - `cat tasks/foo/status.json`;
  - `cat tasks/foo/status.json 2>/dev/null`;
  - `jq '.phases' tasks/foo/status.json > /tmp/x.json`;
  - `sed -n '1,5p' tasks/foo/status.json`;
  - `git commit -m "fix > tasks/foo/status.json"` (quoted text);
  - `cat tasks/foo/status.json | tee /tmp/x`;
  - Edit on `.canon/templates/status.json`;
  - Edit on `tasks/_templates/status.json`;
  - Edit on `tasks/_archive/foo/status.json`;
  - Edit on `src/tasks/foo/status.json`;
  - Edit on `tasks/foo/spec.md`;
  - Edit on `tasks/foo/status.json` in a separate temp git repo with no `.canon/` directory.
- [ ] **AC-3: Hand-rolled monitoring denied, neighbors allowed.** Unit tests.

  **Denied**, with the detaching-form reason (bare `canon run`, then `canon watch`):
  - `canon run foo | tail`;
  - `canon watch foo |& grep x`;
  - `npx canon run foo | cat`;
  - `canon-dev watch foo | head`;
  - `node ~/x/dist/cli/index.js watch foo | tail`;
  - `env X=1 canon watch foo | head`;
  - `exec canon run foo | tail`;
  - `canon run foo 2>&1 | tail` (`2>&1` is not a separator);
  - `cd x && canon watch foo | head` (second simple command);
  - `canon watch foo \` newline `| head` (line continuation).

  **Denied**, with the foreground reason (run without the pipe):
  - `canon run foo --ship | tail`;
  - `canon run foo --pr | cat`.

  **Denied** as log polling:
  - `tail -f tasks/foo/.canon-run.log`;
  - `while sleep 5; do tail -n 5 tasks/foo/.canon-run.log; done`.

  **Allowed**:
  - `canon run foo`;
  - `canon watch foo`;
  - `canon task status foo | jq .`;
  - `canon doctor | head`;
  - `canon run foo --dry-run | less`;
  - `canon run --help | head`;
  - `echo "canon run foo | tail"`;
  - `git commit -m 'canon watch foo | head'`;
  - `ls # canon run foo | tail` (comment);
  - a heredoc whose body line is `canon run foo | tail` (for example `cat <<'EOF' > notes.txt` … `EOF`), and the same with `<<-EOF` and a tab-indented terminator;
  - `canon run foo 2>&1`;
  - `canon run foo; echo done | cat` (the pipe belongs to `echo`);
  - `grep 'canon run' log.txt | head`;
  - `tail -n 50 tasks/foo/.canon-run.log`;
  - `sleep 60 && tail -n 20 tasks/foo/.canon-run.log`.
- [ ] **AC-4: Squash or default merge of task PRs denied.** Unit tests stub the `gh` and `git` lookups with PATH shims.

  **Denied**, with a reason naming `canon run <id> --ship` and the rebase/merge-commit guidance:
  - `gh pr merge 12 --squash`, where PR 12's head is `task/foo`;
  - `gh pr merge 12`, same head;
  - `gh pr merge` with `cwd` on `task/foo`.

  **Allowed**:
  - `gh pr merge 12 --rebase` and `gh pr merge 12 --merge` (head `task/foo`);
  - `gh pr merge 13 --squash`, where the head is `release/v1.2`;
  - `gh pr create --head task/foo …`;
  - `gh pr edit 12 --body x`;
  - `gh pr checks 12`;
  - `gh pr merge 12` when the head lookup fails or times out.
- [ ] **AC-5: Fail-open.** Each of these exits 0 with no deny output. Verified by unit tests.
  - malformed JSON on stdin;
  - an unknown `tool_name`;
  - a missing `tool_input`;
  - a missing `cwd`;
  - a thrown internal error, forced via a test seam.
- [ ] **AC-6: Missing script is a no-op.** Running the exported snippet's command string with `CLAUDE_PROJECT_DIR` pointing at a directory without the script exits 0 and writes nothing to stdout. Verified by a test that executes the snippet command through `sh -c`.
- [ ] **AC-7: Adopter-safe, actionable reasons.**
  - No deny reason names a canon-internal path (`src/`, `scripts/`, `tests/`) or a canon-ai-only convention.
  - Every reason ends with an instruction to retry using the named command, or to hand the change to the human.

  Verified by a unit test over one reason per rule and mode.
- [ ] **AC-8: Recommend-only registration.**
  - **Snippet constant.** A single exported constant holds the snippet.
  - **README.** The README hooks section's JSON block equals that constant, enforced by a drift test in `tests/cli.test.ts` modeled on the `RECOMMENDED_ALLOW` README test. The section states the coverage scope from Decision 5: the shell rules apply to the Bash tool only, and PowerShell-tool sessions get only the `status.json` file-edit rule. Verified by reading the section.
  - **Registered tools.** The snippet's matcher names exactly `Bash`, `Edit`, `Write` and `MultiEdit`, and not `PowerShell`. Verified by a unit test on the constant.
  - **Doctor.** `canon doctor` warns, and does not fail, including the snippet text, when:
    - (a) no settings file registers the script;
    - (b) the registration's matcher omits any of `Bash`, `Edit`, `Write` or `MultiEdit`;
    - (c) the script file is missing.

    It emits no warning when a full registration exists and the file is present. Verified by doctor tests.
  - **Upgrade.** `canon upgrade` prints the not-registered notice when the script is present but unregistered, and stays silent when it is registered. Verified by an upgrade test.
  - **No settings writes.** After `canon init` and then `canon upgrade` in a fresh repo, `.claude/settings.json` does not exist. Verified by test.
- [ ] **AC-9: canon-init offers the merge.**
  - The `/canon-init` skill's settings phase offers to merge the hooks snippet with the permissions, under the same owner-consent rule.
  - Its phase title and its "purely ergonomics" line no longer describe the phase as permissions-only.

  Verified by reading the skill. The mirror sync passes.
- [ ] **AC-10: No canon text invites a denied action.**
  - **Rewording.** Every message and doc line listed in Decision 6 is reworded as specified. The prompt golden fixture is regenerated, and any test pinning the old wording is updated.
  - **Zero-match grep.** Over `src/`, `.claude/skills/`, `.canon/templates/`, `.canon/README.md`, `docs/pipeline-orchestrator.md` and `templates/`, excluding `.canon/worktrees/`, each of these patterns returns zero matches:
    - `Edit status.json`;
    - `migrate .status.json. manually`;
    - `Fix the malformed files`;
    - `delicate: true. in .status.json`;
    - `gh pr merge \$\{[^}]*\} --squash`;
    - `Set in .status.json. at task creation`.
  - **Prompt sweep.** `src/orchestrator/prompts/` contains no instruction to run `gh pr merge`, pipe `canon run` or `canon watch`, or edit `status.json`. Verified by a grep for `gh pr merge`, `canon run[^|]*\|` and `status\.json` there, with each remaining hit manually classified in `handoff.md` as a mention, not an instruction.
- [ ] **AC-11: Dogfood registration.** canon-ai's `.claude/settings.json` registers the hook with the exported snippet. Its existing `hooks.SessionStart` entry is unchanged. `canon doctor` run in canon-ai emits no hook warning. Verified by diff and a doctor run.
- [ ] **AC-12: Decision and docs recorded.** Verified by reading each. `npm run docs-refs-check` passes.
  - `docs/decisions.md` gains an entry. It states that canon ships guard hooks as a canon-managed script with recommend-only registration, why, its relation to "Canon ships zero owned content into adopter agent files", the rejected agent override, and the Bash-tool-only scope of the shell rules (PowerShell sessions get only the file-edit rule).
  - The `docs/BACKLOG.md` "Explicitly NOT porting … shell-guard hook" clause says the pipe guard is now ported.
  - The README's "Current scope" line claiming canon ships `.claude/settings.json` is corrected.
  - `.canon/hooks/README.md` no longer says canon-ai "ships no hooks" without qualification. Its hooks are orchestrator shell hooks, distinct from the Claude Code guard.
  - The `docs/codebase-map.md` hooks row names the guard script.
  - The `src/orchestrator/detach.ts` header comment no longer recommends `tail -f` on the run log.

## Design

### Affected Files

| File | Change |
|---|---|
| `.claude/hooks/canon-guard.mjs` | New hook script: three rules, fail-open, mode-specific deny reasons. |
| `templates/.claude/hooks/canon-guard.mjs` | Generated mirror. |
| `src/lib/canon-owned.ts` | Add the hook script to `CANON_OWNED`. |
| `src/cli/commands/doctor.ts` | Exported hooks-snippet constant; registration/file-presence warning. |
| `src/cli/commands/upgrade.ts` | Not-registered notice after syncing the script. |
| `README.md` | Hooks section with the snippet; correct the "Current scope" settings claim. |
| `.claude/skills/canon-init/SKILL.md` | Settings phase offers the hooks snippet with consent; retitle/reframe. |
| `templates/.claude/skills/canon-init/SKILL.md` | Generated mirror. |
| `.claude/settings.json` | Register the hook for canon-ai, preserving `SessionStart` (dogfood). |
| `src/orchestrator/state.ts` | Reword "Edit status.json" field-validation errors. |
| `src/orchestrator/git.ts` | Reword bundle `base_branch` mismatch error. |
| `src/orchestrator/main.ts` | Reword bundle mismatch error and the two `--ship` manual-`gh` recovery messages. |
| `src/orchestrator/detach.ts` | Header comment drops the `tail -f` recommendation. |
| `src/task/index.ts` | Reword the topology-lock and malformed-status errors. |
| `src/orchestrator/prompts/templates/spec.md` | `delicate` line names `canon task set`. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Same. |
| `docs/pipeline-orchestrator.md` | Reword Task Sizing lead-in, `worktree` row, `set` row; add hook note under `canon watch`. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror. |
| `tests/canon-guard.test.ts` | New: rule, fail-open, snippet no-op and reason tests (AC-2–AC-7). |
| `tests/cli.test.ts` | Init/upgrade install, leak-scan list, README drift, doctor warning, upgrade notice, no-settings-write tests. |
| `tests/run-task-prompts.golden.json` | Regenerated. |
| `docs/decisions.md` | New decision entry. |
| `docs/BACKLOG.md` | Update the "NOT porting" clause. |
| `docs/codebase-map.md` | Hooks row names the guard script. |
| `.canon/hooks/README.md` | Qualify "ships no hooks". |
| `dist/cli/index.js` | Rebuilt bundle. |
| `dist/orchestrator/run-task.js` | Rebuilt bundle. |

### Interaction Dependencies

- **Concurrent task `spec-manifest-lint`.** It shares these files with this task: `src/orchestrator/main.ts`, `src/orchestrator/prompts/templates/spec-revision.md`, `tests/run-task-prompts.golden.json`, `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `docs/BACKLOG.md`, `docs/codebase-map.md` and both `dist/` bundles. Launch this task's pipeline after that one ships.
- **Pipeline Claude sessions** load the worktree's committed `.claude/settings.json`, so in canon-ai the hook fires inside them.
  - Pipeline agents run `canon task phase …`, which stays allowed.
  - AC-10's prompt sweep checks that no prompt steers them into a deny.
  - A worktree cut before the script existed hits the AC-6 no-op path.
- **`tests/recovery-hints.test.ts`** registers `src/` lines naming `--reroute` and similar recovery commands. Reworded messages that newly name a registry-pattern command must be registered there.
- **The maintainer's user-level guards** may double-deny in canon-ai and its adopter. That is harmless.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] E2E — not applicable (CLI, no UI)

## Docs Impact

- `docs/decisions.md`, `docs/pipeline-orchestrator.md`, `docs/codebase-map.md`: edited (Affected Files).
- `docs/product-context.md`: None. Flow 1 already defers setup details to the README and `/canon-init`.

## Known Risks

- **False denials stall agents (highest risk).** A deny an agent can't satisfy wastes a turn or a whole phase. Mitigations:
  - AC-2 to AC-4 pin the allowed neighbors, including read-plus-redirect forms, non-root `tasks/` paths, non-task PRs, rebase and merge-commit merges, other `canon` subcommands, quoted text and single log reads.
  - AC-5 and AC-6 make every failure an allow.
  - AC-10 removes canon text that steers into a deny.
- **Command-parsing gaps.** Shell parsing is heuristic. A false allow is acceptable; a false deny is a problem. The Command parsing contract matches a parser already used in production, and AC-2/AC-3 pin its quote, comment, heredoc, `2>&1` and line-continuation cases, which are the main false-deny traps. Contract item 9 lists the accepted false allows.
- **Path anchoring.** The working-tree root is resolved from the target file's nearest existing ancestor, since Write may create the file in a directory that does not exist yet. If that lookup fails (no repo, git missing, timeout), the rule allows, per fail-open. A non-canon repo that happens to keep `tasks/<id>/status.json` at its root is excluded by the `.canon/` check. A canon-adopting repo's own unrelated `tasks/<id>/status.json` would be denied, but that path is canon's task layout by definition.
- **Untracked `.canon/`.** If an adopter gitignores `.canon/` entirely, its linked worktrees have no `.canon/` and their status files fall outside the rule (a false allow; the main checkout is still covered). Accepted: `canon init` scaffolds `.canon/` as tracked content.
- **Lookup cost.** One `git rev-parse --show-toplevel` per Edit/Write/MultiEdit whose path ends in `tasks/<id>/status.json`; other paths skip the lookup by a string check first.
- **`gh` lookup latency and failure.** A timeout or an auth failure must allow (AC-4). The snippet timeout must exceed the lookup timeout.
- **Headless sessions and the human fallback.** A pipeline agent that hits the `status.json` deny cannot ask anyone. The reason's "record in `notes.md` and end the turn" branch keeps it from looping. AC-10's sweep makes this path unlikely.
- **PowerShell sessions are unguarded for shell bypasses.** On Windows, Claude Code's PowerShell tool can pipe `canon run`, write `status.json` via shell, or run `gh pr merge` without the hook firing. Accepted by the human's scoping decision (Non-Goals); the README and decision entry state the gap so no adopter assumes coverage it does not have. Revisit if Windows adopters report the bypasses.
- **Doctor noise.** Adopters who decline hooks see a warning on every `doctor` run. This is accepted as the opt-in nudge, matching the permissions warning.

## Human Test Plan

1. In a fresh test repo, run canon's init. Expected: the guard script is installed and no Claude settings file is created. The doctor check warns that the hook isn't registered and shows the snippet.
2. Add the snippet to the project's Claude settings and run doctor again. Expected: no hook warning.
3. In a Claude Code session there, ask the agent to change a task's size by editing its status file directly. Expected: the edit is refused with a message naming canon's command, and the agent then uses it. Asking it to *read* the status file still works.
4. Ask the agent to start a pipeline run and follow it by piping the output into tail. Expected: refused, with directions to run it bare and use canon's watch command.
5. On a task with an open PR, ask the agent to squash-merge it with the GitHub CLI. Expected: refused, with directions to use canon's ship command. A rebase merge of that PR, or merging a release PR, is not refused.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, feature
- [x] (Refactors) — N/A, feature
