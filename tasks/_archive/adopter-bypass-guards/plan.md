# Implementation Plan: adopter-bypass-guards

> Written by: Claude | Implements: `tasks/adopter-bypass-guards/spec.md`

## Approach

Write one dependency-free Node ESM script, `.claude/hooks/canon-guard.mjs`, that reads a Claude Code `PreToolUse` payload from stdin and either prints a structured deny or prints nothing (allow). It contains a single-pass shell scanner implementing the spec's **Command parsing contract**, plus three rule functions that consume the scanner's simple commands. Everything is wrapped in one try/catch that turns any failure into an allow. The script joins `CANON_OWNED`, so `canon init` (which copies all of `templates/`) installs it and `canon upgrade` restores it. Registration stays recommend-only. A snippet constant in `doctor.ts` drives a doctor warning, an upgrade notice, the README block (drift-tested), the `/canon-init` skill text, and canon-ai's own `.claude/settings.json`. Separately, reword the canon messages and doc lines from Decision 6 so no canon text steers an agent into a deny.

Spec review verdict: **approved**, no nits. This plan makes no spec changes.

### Feasibility check

- **Exists:** `CANON_OWNED` is in `src/lib/canon-owned.ts:1` and already holds a `.mjs` entry (`scripts/docs-refs-check.mjs`), so the sync script and upgrade copy non-markdown files. `scaffoldTemplates` in `src/cli/commands/init.ts` copies every file under `templates/` recursively, so init needs no code change. The `runUpgrade` loop over `CANON_OWNED` (`upgrade.ts:374`) queues a missing file for writing and routes it through the dirty-refusal queue. The `RECOMMENDED_ALLOW` constant (`doctor.ts:40`), `checkRecommendedPermissions` (`doctor.ts:510`), the `configChecks` list in `doctorCmd` (`doctor.ts:765`), the README drift test (`tests/cli.test.ts:3730`) and `ADOPTER_SHIPPED_PATHS` (`tests/cli.test.ts:3845`) all exist as the spec assumes. `.claude/hooks/` does not exist yet, and `.claude/settings.json` is tracked with a `hooks.SessionStart` entry. Golden regeneration is `UPDATE_GOLDENS=1 npm test` (`tests/run-task-prompts.test.ts:196`).
- **Real path:** Claude Code runs the snippet command and pipes the payload JSON to it. The payload carries `tool_name`, `tool_input.file_path` (Edit/Write/MultiEdit) or `tool_input.command` (Bash), and `cwd`. Nothing in canon runs on this path today. Doctor: `doctorCmd` builds `configChecks` and calls `printCheck`. Upgrade: `upgradeCmd` (`upgrade.ts:559`) prints after `runUpgrade`.
- **Callers:** The error contract changes only in message text. Callers:
  - `validateBranchField` (`state.ts:389`) is called from `validateStatus` (`state.ts:412-413`, for `branch` and `base_branch`) and from `canon task set base_branch` (`task/index.ts:1526`).
  - `validateNonNegativeInt` is called only from `validateStatus`.
  - The bundle-mismatch `die`s are at `main.ts:2466` and `git.ts:195`.
  - The `--ship` recovery messages are at `main.ts:1996` and `main.ts:2162`. The topology lock is at `task/index.ts:1575`, and the malformed-list error at `task/index.ts:356`.
  - A grep of `tests/` for `Edit status.json`, `merge the PR manually`, `migrate status.json manually`, `Fix the malformed` and `open + merge a PR` returns no hits, so no test pins the old wording. The golden fixture pins the two prompt templates.
- **Tests that can fail:** Each AC-2/3/4 case is a payload that enters the specific rule branch. Without the script, or with that rule removed, every "Denied" case prints no deny and fails. The "Allowed" cases each target one false-deny trap: quotes, comments, heredocs, `2>&1`, non-root paths, and fd-dup redirects. AC-6 runs the snippet in a directory without the script. Doctor and upgrade cases flip registration on and off. The README drift test fails if the README block or the constant changes alone.
- **Predicates:** These are spelled out in Steps 1–3:
  - the task-id regex (empty, `_archive`, `_templates`, `..`);
  - the matcher parse (`""`, `"*"`, absent, a partial list);
  - the merge flags (`--rebase`/`-r`, `--merge`/`-m`, both absent);
  - the foreground flags (`--pr`, `--push`, `--ship`, `--step`/`-1`, `--expect`);
  - `tail` follow flags (`-f`, `-F`, `--follow`, `--follow=*`, clusters such as `-fn`);
  - the `sed`/`perl` in-place flags (`-i`, `-i.bak`, `--in-place`, `--in-place=*`, `-pi`, `-pi.bak`);
  - an fd-dup redirect target (`&1`, `&-`, a digit after `>&`) and a `/dev/*` target. Neither is a write target.
- **Scope:** Every file below is in the spec's Affected Files. Contradictions are listed under "Spec contradictions"; none widens scope.
- **Async/stateful:** The hook is a one-shot process with no persistent state. Both external lookups (`git rev-parse`, `gh pr view`/`git branch`) use `spawnSync` with a `timeout`, and a timeout or any non-zero exit means allow. There is no re-entry or cancellation concern. The snippet's `timeout` (10s) exceeds the 3s `gh` lookup timeout.

### Spec contradictions / judgment calls (also in `notes.md`)

1. **AC-10 grep pattern `migrate .status.json. manually` cannot match the current text.** The text is `migrate status.json manually` with no backticks. Each `.` must eat a character, so the pattern never matches, and the doc row says "migrating". Decision 6 still requires both rewordings, and this plan does them. Step 7 adds a supplementary grep, `status\.json.? manually`, so the check is not vacuous.
2. **AC-4 "PATH shims" for git.** The implicit-branch case uses a real temp git repo checked out on `task/foo`, not a git shim. This is stricter, because it exercises the real `git branch --show-current`. `gh` is shimmed.
3. **`main.ts:1996` ("open + merge a PR (gh pr create …)").** Decision 6 keeps the `gh pr create` suggestion and adds "then rerun `--ship`". The plan also drops "+ merge" from that line. Merging a task PR by hand is what Rule 4 denies, and `--ship` merges the open PR itself through `mergeOpenPRsAndPull`.

## Steps

### Step 1: The hook script

Files: `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` (generated), `src/lib/canon-owned.ts`

1. Add `'.claude/hooks/canon-guard.mjs'` to `CANON_OWNED`, after the agent entries.
2. Write the script: plain JS, ESM, Node built-ins only (`fs`, `path`, `child_process`, `os`). Keep comments sparse. The file ships to adopters, so its comments and strings must not name `src/`, `scripts/`, `tests/` or canon-ai internals. Shape:

```js
#!/usr/bin/env node
// canon guard — Claude Code PreToolUse hook. Denies pipeline bypasses with an
// instruction to use canon's own command instead. Any error allows the call.
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

function main() {
    if (process.env.CANON_GUARD_TEST_THROW === '1') throw new Error('test seam');
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    const reason = evaluate(payload);  // string | null
    if (reason) process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }));
}
try { main(); } catch { /* fail-open */ }
process.exit(0);
```

   `evaluate(payload)`:
   - Return null unless `payload` is an object, `payload.cwd` is a non-empty string, and `payload.tool_input` is an object. This covers AC-5's missing `cwd` and `tool_input`.
   - For `Edit`, `Write` or `MultiEdit`: return the status reason if `isTaskStatusFile(tool_input.file_path, cwd)`.
   - For `Bash`: if `tool_input.command` is a string, run `scan(command)` once, then try `statusRuleBash`, `monitorRule` and `mergeRule` in that order and return the first reason.
   - Any other `tool_name` returns null.

3. **Scanner** `scan(src) → Cmd[]`, where `Cmd = { words: Word[], redirects: {op, target}[], end: string }` and `Word = { text: string }`. It is a single pass over characters (Contract 1–5):
   - **Separators** (unquoted): `|&`, `||`, `|`, `&&`, `;;`, `;`, `&`, newline. Check longest first. Each ends the current Cmd with `end` set to the operator (`'\n'` for newline, `''` at EOF). An empty Cmd (no words) is still recorded, so `end` is preserved but harmless.
   - **Redirect operators** (unquoted), recognized at the start of a word or when the word so far is all digits (an fd prefix): `>>`, `>|`, `>&`, `>`, `<<<`, `<<-`, `<<`, `<&`, `<`, and `&>>`, `&>` when `&` is followed by `>`. This keeps `&` that touches `<`/`>` out of the separators (Contract 2). Record `{op, target}`, where `target` is the next word's text. A target that begins right after the operator (`>tasks/x`) is the rest of that word (Contract 8).
     - `>&` or `<&` followed by a digit or `-`: an fd dup, with no file target.
     - `<<`/`<<-`: the target word is the heredoc delimiter (quotes removed). Push `{delim, stripTabs}` to `pendingHeredocs`.
     - `<<<`: the next word is consumed as input, not a heredoc.
     - Redirect words are not added to `words`.
   - **Quotes and escapes** (Contract 3):
     - `'…'` is literal.
     - In `"…"`, a backslash escapes the next character.
     - Outside quotes, `\` escapes the next character, and `\<newline>` is removed (line continuation).
     - Quote characters are removed from the word text. Nothing inside quotes is a separator, an operator or a word boundary.
   - **Comments** (Contract 4): an unquoted `#` at the start of a word skips to just before the next newline.
   - **Heredocs** (Contract 5): when a newline separator is consumed and `pendingHeredocs` is non-empty, skip lines in queue order until a line equals the delimiter. With `<<-`, strip leading tabs before comparing. The terminator line is consumed too. Skipped lines produce nothing.
   - `$(`, `(`, `{` stay part of the word text. Only invocation detection strips them (Contract 6).
4. **Invocation helper** `program(cmd) → { name, args: string[] } | null` (Contract 6):
   - Strip a leading `(`, `{` or `$(` from the first word.
   - Skip leading words matching `/^[A-Za-z_][A-Za-z0-9_]*=/` and wrapper words `env`, `command`, `exec`, `time`, `nohup`, `npx`, `sudo`.
   - Return the basename of the next word and the remaining words.
   - `isCanon(p)`: the name is `canon` or `canon-dev`; or the name is `node` and the first arg ends with `dist/cli/index.js` (then shift that arg off).
   - The subcommand is the first arg not starting with `-`.
   - The same helper also gives `gh`, `tail`, `sed`, `perl` and `tee` detection for the other rules.
5. **Task status file test** `isTaskStatusFile(p, cwd)`:
   - Return false for anything that is not a non-empty string.
   - Expand a leading `~/` to `os.homedir()`, then `abs = path.resolve(cwd, p)`.
   - Cheap check first: `path.basename(abs) === 'status.json'`, `basename(dirname(dirname(abs))) === 'tasks'`, and `id = basename(dirname(abs))` matches `/^[a-z0-9][a-z0-9._-]*$/` and does not include `..`. This alone rejects `_archive`, `_templates`, `.canon/templates/status.json` and empty ids. On a miss, return false without spawning anything.
   - `candidateRoot = dirname(dirname(dirname(abs)))`. Walk up from `dirname(abs)` to the nearest existing directory, then run `spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: ancestor, timeout: 3000, encoding: 'utf8' })`. Use the ancestor as `cwd`, not the payload `cwd` (Decision 1).
   - Return false on a non-zero exit, error or timeout.
   - Return true only if `realpathSync(toplevel) === realpathSync(candidateRoot)` and `join(toplevel, '.canon')` is a directory. Wrap the `realpathSync` calls in try/catch → false. macOS `/var` vs `/private/var` makes canonicalizing both sides mandatory (`docs/patterns.md`, "Canonicalize real git worktree paths").
6. **Rule 2, Bash form** (`statusRuleBash(cmds, cwd)`): for each Cmd, deny if any of these is a task status file:
   - (a) the target of a redirect whose op is `>`, `>>`, `>|`, `&>`, `&>>` or an fd-prefixed form of those, skipping fd dups and targets starting with `/dev/`;
   - (b) a non-option arg of a `tee` program;
   - (c) a non-option arg of `sed` when any arg matches `/^-i/`, `/^--in-place/`, or a short cluster `/^-[a-zA-Z]*i/` (covers `-i`, `-i.bak`, `-Ei`);
   - (d) a non-option arg of `perl` when any short-option cluster contains `i` (`-i`, `-pi`, `-pi.bak`, `-i.bak`).

   Input redirects are never targets.
7. **Rule 3** (`monitorRule(cmds)`):
   - **Pipe form:** a Cmd whose `program` is canon with subcommand `run` or `watch`, and `end` is `|` or `|&`.
     - Exempt `run` when its args include `--dry-run` or `--help`.
     - Choose the reason: for `run` with any of `--pr`, `--push`, `--ship`, `--step`, `-1`, `--expect` (`--expect` may carry `=value`), use the foreground reason. Otherwise (`run` without them, or `watch`), use the detaching reason.
   - **tail follow:** a `tail` program with an arg matching `-f`, `-F`, `--follow`, `--follow=…` or a short cluster containing `f`/`F` (`/^-[a-zA-Z]*[fF]/`, excluding `--…`), and any arg whose basename is `.canon-run.log`. Use the detaching reason.
   - **Poll loop:** walk Cmds while tracking loop depth.
     - A Cmd whose first word (after stripping `(`/`{`) is `while`, `until` or `for` increments the depth.
     - A Cmd whose first word is `done` (or whose words include a `done` in command position) decrements it.
     - Inside depth > 0, after skipping the keywords `while`, `until`, `do`, `then`, `else`, `if`, `!` at the head, note `sawSleep` if the head program is `sleep`.
     - Note `sawLog` if any word in the Cmd has basename `.canon-run.log`.
     - Deny when both are seen inside the same outermost loop. `while sleep 5; do tail -n 5 log; done` produces Cmds `[while sleep 5]`, `[do tail -n 5 …]` and `[done]`, which satisfies this. `sleep 60 && tail …` has depth 0, so it is allowed.
8. **Rule 4** (`mergeRule(cmds, cwd)`):
   - Match a Cmd whose `program` name is `gh`, with args `pr` then `merge`.
   - Allow if the remaining args include `--rebase`, `-r`, `--merge` or `-m`, or a short cluster containing `r`/`m` with no value flag.
   - Find the PR ref: the first arg not starting with `-`, skipping the values of the value flags `-t/--subject`, `-b/--body`, `-F/--body-file`, `-A/--author-email`, `--match-head-commit`, `-R/--repo` (an `--x=value` form carries its own value). Remember the `-R` value.
   - Head lookup:
     - With a ref: `spawnSync('gh', ['pr', 'view', ref, ...(repo ? ['-R', repo] : []), '--json', 'headRefName', '--jq', '.headRefName'], { cwd, timeout: GH_TIMEOUT_MS, encoding: 'utf8' })`.
     - Without a ref: `spawnSync('git', ['branch', '--show-current'], { cwd, timeout: 3000 })`.
     - `GH_TIMEOUT_MS = Number(process.env.CANON_GUARD_GH_TIMEOUT_MS) || 3000` (test seam, so the timeout case doesn't take 3s).
     - A non-zero exit, error, timeout or empty output means allow.
   - Deny when the trimmed head starts with `task/`. The reason fills in `<id>` as the head minus `task/`.
9. **Reasons.** Use one builder per rule and mode. Each starts with `canon guard:`, avoids canon-internal paths and ends with a retry or hand-to-human instruction (AC-7). Wording to use, adjusting only for fit:
   - **status:** `` canon guard: tasks/<id>/status.json is canon's task state — change it only through canon. Use `canon task phase <id> <phase> <status>` for phase state, `canon task set <id> <field> <value>` for task fields (title, task_size, delicate, human_spec_gate, worktree, base_branch, provider), `canon task accept <id> <phase>` to accept a phase, or `canon task reset-spec-review <id>` / `canon task reset-code-review <id>` to clear a review loop. If none of these covers the change, stop and give the human the exact edit to apply; in a headless pipeline session, record that request in tasks/<id>/notes.md and end your turn. Retry with the matching canon command, or hand the edit to the human. `` Substitute the real id when the path gave one.
   - **detaching:** `` canon guard: don't pipe `canon run` / `canon watch` or poll the run log — a pipe buffers canon's live output and masks its exit code, and polling misses the halt states `canon watch` reports. Run `canon run <id>` bare (it detaches and prints the PID and log path), then `canon watch <id>` with no pipe, in the background if your tool caps command duration. Retry that way. ``
   - **foreground:** `` canon guard: `canon run … <flag>` runs in the foreground and prints its own result; a pipe buffers that output and masks the exit code. Retry the same command without the pipe. ``
   - **merge:** `` canon guard: this PR's head is task/<id>, a canon task branch. Squash and default merges of task PRs go through `canon run <id> --ship`, which squash-merges and then archives the task and cleans up its worktree and branches. If the project merges with rebase or merge commits, rerun this command with --rebase or --merge, then run `canon run <id> --ship` for cleanup. Retry with `canon run <id> --ship`. ``
10. Run `npm run sync-templates` to create the mirror, then `npm run sync-templates:check`.

### Step 2: Guard tests

Files: `tests/canon-guard.test.ts` (new)

Follow `tests/cli.test.ts` conventions: `void test(...)`, `node:assert/strict`, mkdtemp plus `rmSync` cleanup. Use `process.cwd()` for the script path (`path.join(process.cwd(), '.claude/hooks/canon-guard.mjs')`), never a `REPO_ROOT`-style constant (patterns.md, worktree rule).

- **Helper** `runGuard(payload: unknown | string, opts?: { env?, cwd? })`: `spawnSync(process.execPath, [SCRIPT], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...opts.env } })`. It returns `{ status, denied: boolean, reason: string }`, parsing stdout as JSON when non-empty. Assert `status === 0` in every case.
- **Fixture** `makeCanonRepo()`:
  - `git init -q -b main`, set user.name and user.email, write `.canon/README.md`, commit.
  - Add linked worktrees with `git worktree add -q .canon/worktrees/foo -b task/foo` and `git worktree add -q ../<sibling>/wt -b task/bar`, the second a sibling directory outside the repo.
  - Create `tasks/foo/` in each.
  - Make a second temp repo with no `.canon/`.
- **AC-2:** one test per listed case:
  - Edit, Write and MultiEdit (`tool_input.file_path`).
  - Bash (`tool_input.command`), with `cwd` set as each case names. That covers absolute paths from the main checkout and relative paths from inside the sibling worktree, with `CANON_WORKTREES_ROOT` deleted from the env.
  - Denied cases assert the reason matches `/canon task phase/`, `/canon task set/`, `/canon task accept/` and `/give the human the exact edit/`.
  - Allowed cases include Read (`tool_name: 'Read'`) and the no-`.canon` repo.
- **AC-3:** one test per case.
  - Detaching-mode denies assert `/canon watch <id>` with no pipe/`; foreground-mode denies assert `/without the pipe/` and `doesNotMatch` `/canon watch/` (a state-varying pair, per the patterns.md clause-builder rule).
  - The heredoc cases use real newlines and a real tab in `<<-EOF`.
  - The line-continuation case uses `'canon watch foo \\\n| head'`.
- **AC-4:** create a temp `bin/` with an executable `gh` shim (`writeExecutable`-style `#!/bin/sh`). It switches on `$3`: `12` prints `task/foo`, `13` prints `release/v1.2`, `99` does `exit 1`, `98` does `sleep 5`. Run with `PATH=<bin>:${process.env.PATH}`.
  - The timeout case sets `CANON_GUARD_GH_TIMEOUT_MS=300`.
  - The implicit `gh pr merge` case uses `cwd` in a real repo whose current branch is `task/foo`.
  - Allowed `gh pr create`/`edit`/`checks` cases point the shim at `exit 1` too, to prove no lookup is needed.
- **AC-5:**
  - stdin `'{not json'`;
  - `{ tool_name: 'Frobnicate', tool_input: {}, cwd }`;
  - `{ tool_name: 'Edit', cwd }` with no `tool_input`;
  - `{ tool_name: 'Edit', tool_input: { file_path: <abs status path> } }` with no `cwd`;
  - a deny-worthy Edit payload with `CANON_GUARD_TEST_THROW=1`.

  Each asserts exit 0 and empty stdout.
- **AC-6:** import `RECOMMENDED_GUARD_HOOKS` from `../src/cli/commands/doctor.ts`, extract `hooks.PreToolUse[0].hooks[0].command`, and run `spawnSync('sh', ['-c', command], { env: { ...process.env, CLAUDE_PROJECT_DIR: emptyTmp }, input: '{}' })`. Assert exit 0 and empty stdout. Add a positive twin: `CLAUDE_PROJECT_DIR` is a temp dir holding a copy of the script, and a deny payload produces a deny. This proves the no-op test isn't vacuous.
- **AC-7:** collect one reason per rule and mode (status, detaching, foreground, log poll, merge). Assert none matches `/\b(src|scripts|tests)\//`, and each one's last sentence matches `/(Retry|hand the edit to the human)/`.
- **Can-fail check:** temporarily return null from one rule, confirm its tests go red, then restore.

### Step 3: Snippet constant, doctor warning, upgrade notice

Files: `src/cli/commands/doctor.ts`, `src/cli/commands/upgrade.ts`, `tests/cli.test.ts`

1. In `doctor.ts`, next to `RECOMMENDED_ALLOW`:

```ts
export const GUARD_HOOK_PATH = '.claude/hooks/canon-guard.mjs';
export const GUARD_HOOK_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit'] as const;
// Kept identical to the README "Guard hooks" json block — drift-tested in tests/cli.test.ts.
export const RECOMMENDED_GUARD_HOOKS = {
    hooks: {
        PreToolUse: [{
            matcher: 'Bash|Edit|Write|MultiEdit',
            hooks: [{
                type: 'command',
                command: 'test -f "$CLAUDE_PROJECT_DIR/.claude/hooks/canon-guard.mjs" && node "$CLAUDE_PROJECT_DIR/.claude/hooks/canon-guard.mjs" || true',
                timeout: 10,
            }],
        }],
    },
} as const;
```

2. Add `guardHookRegistration(cwd): 'full' | 'partial' | 'none'`.
   - Read `.claude/settings.json` and `.claude/settings.local.json`. A missing or invalid file contributes nothing; the permissions check already reports invalid JSON.
   - For each `hooks.PreToolUse[]` entry with an inner `hooks[]` item whose `command` is a string containing `canon-guard.mjs`, collect the tools its `matcher` covers:
     - a missing, empty or `*` matcher means all four tools;
     - otherwise strip `^$()` and split on `|`, trimming each part.
   - Take the union across both files. All four tools present means `full`; some means `partial`; none means `none`.
   - Narrow unknown JSON with type guards. No `any` (patterns.md lint policy).
3. Add `checkGuardHook(cwd): Check` with label `GUARD_HOOK_PATH`. Every warn detail ends with `:\n` plus `JSON.stringify(RECOMMENDED_GUARD_HOOKS, null, 2)`.
   - Script missing: warn, "missing — run `canon upgrade` to restore it; register it in .claude/settings.json with".
   - `none`: warn, "not registered in .claude/settings.json or .claude/settings.local.json — merge this into hooks (see the canon-ai README "Guard hooks")".
   - `partial`: warn, "registered, but its matcher misses `<tools>` — use matcher Bash|Edit|Write|MultiEdit".
   - `full` with the file present: pass, "registered".
   - Push it into `configChecks` after `checkRecommendedPermissions(cwd)`. Status is never `fail`.
4. In `upgrade.ts`, export `guardHookNotice(cwd: string): string | null`. It returns a one-line notice when `existsSync(join(cwd, GUARD_HOOK_PATH))` and `guardHookRegistration(cwd) !== 'full'`:
   `Heads-up: .claude/hooks/canon-guard.mjs is installed but not registered as a Claude Code hook — run \`canon doctor\` for the settings snippet.`
   Import it from `./doctor.js`; `doctor.ts` doesn't import `upgrade.ts`, so there is no cycle. In `upgradeCmd`'s non-check path, print it (plus a blank line) just before the final "Orchestrator scripts…" or "No canon-managed files…" line. Canon writes no settings anywhere.
5. Tests in `tests/cli.test.ts`. Reuse the `withTempDir` and `writeSettings` helpers near line 1613.
   - **Leak scan:** add `'templates/.claude/hooks/canon-guard.mjs'` to `ADOPTER_SHIPPED_PATHS`.
   - **Init:** `scaffoldTemplates(projectDir, path.join(WORKTREE_ROOT, 'templates'))` creates `.claude/hooks/canon-guard.mjs` with the template's bytes, and `.claude/settings.json` does not exist.
   - **Upgrade:** follow the existing `runUpgrade(projectDir, pkgDir)` git-fixture tests (around lines 3100–3130).
     - The script is absent: `upgraded` includes it, and the file matches the template.
     - The script is committed, then edited and left dirty: it is refused under `refusals.trackedDirty`, and `{ force: true }` restores it.
   - **Doctor:**
     - `checkGuardHook`: no settings → warn whose detail contains `JSON.stringify(RECOMMENDED_GUARD_HOOKS, null, 2)`.
     - matcher `Bash|Edit` → warn naming `Write` and `MultiEdit`.
     - full registration, file present → pass.
     - full registration, file missing → warn.
     - registration only in `settings.local.json` → pass.
   - **Upgrade notice:** `guardHookNotice` returns a string when the file exists and is unregistered, null when registered, and null when the file is missing. Add one CLI test, `runCanonCliIn(dir, ['upgrade'])` in a scaffolded git repo, asserting that stdout contains `not registered`.
   - **No settings writes:** in a fresh git repo, run `runCanonCliIn(dir, ['init'])` and then `['upgrade']`, and assert `.claude/settings.json` is absent. Check how the existing init control test at about line 1097 invokes init without prompts.
   - **Matcher:** `RECOMMENDED_GUARD_HOOKS.hooks.PreToolUse[0].matcher.split('|')` deep-equals `[...GUARD_HOOK_TOOLS]`, and doesn't include `PowerShell`.
   - **README drift**, modeled on the test at line 3730: extract `/### Guard hooks[\s\S]*?```json\n([\s\S]*?)\n```/`, `JSON.parse` it and `deepEqual` it to `RECOMMENDED_GUARD_HOOKS`.

### Step 4: README, `/canon-init` skill, dogfood settings

Files: `README.md`, `.claude/skills/canon-init/SKILL.md`, `templates/.claude/skills/canon-init/SKILL.md` (generated), `.claude/settings.json`

1. **README.** Add a `### Guard hooks (recommended)` section after "Skip the permission prompts" and before "Trust model". It says:
   - `canon init` installs `.claude/hooks/canon-guard.mjs`, and `canon upgrade` keeps it current.
   - Canon never edits your settings, so registration is opt-in.
   - What it denies: hand edits of `tasks/<id>/status.json`; piping `canon run` or `canon watch`, or polling the run log; squash or default `gh pr merge` of `task/*` PRs. Each deny names the canon command to use.
   - The ```json block, which is exactly `JSON.stringify(RECOMMENDED_GUARD_HOOKS, null, 2)`.
   - Merge it into the existing `hooks` key.
   - `canon doctor` warns until it is registered.
   - **Scope:** the shell rules apply only to Claude Code's Bash tool. Sessions using the PowerShell tool (the Windows default) get only the Edit/Write/MultiEdit `status.json` rule. Codex sessions are not covered.
   - It is a guardrail against habit, not a security boundary.

   Also fix "Current scope" line 414: replace "`.claude/settings.json` — Claude Code permissions + SessionStart hook" with "`.claude/hooks/canon-guard.mjs` — Claude Code guard hook (registration is recommend-only; canon never writes `.claude/settings.json`)". Add "guard-hook registration" to the `canon doctor` row of the Key commands table (line 306).
2. **Skill.** Edit `.claude/skills/canon-init/SKILL.md` Phase 5:
   - Retitle it "Phase 5 — Set up Claude permissions and guard hook (optional)".
   - Add a step after the permissions merge: read the `.claude/hooks/canon-guard.mjs` line in `canon doctor`; if it isn't registered, ask the owner whether to add canon's guard hook; on yes, merge the `hooks.PreToolUse` entry (show the same JSON as the constant) into `.claude/settings.json`, preserving existing `hooks` keys such as `SessionStart`; on no, skip.
   - The consent wording mirrors the permissions step.
   - Replace "This is purely ergonomics." with a line saying the allowlist is ergonomics, while the guard hook makes canon refuse pipeline bypasses with a pointer to the right command.
   - Phase 6's `git add .claude/settings.json` line already covers it; make its wording "if Phase 5 modified it" still true.
   - Run `npm run sync-templates`.
3. **Dogfood.** Edit `.claude/settings.json`: add `"PreToolUse": [ … ]` under `hooks`, copied exactly from the constant, and leave `SessionStart` byte-identical. This file is local to canon-ai and not managed, so it has no mirror.

### Step 5: Reword text that invites a denied action

Files: `src/orchestrator/state.ts`, `src/orchestrator/git.ts`, `src/orchestrator/main.ts`, `src/task/index.ts`, `src/orchestrator/prompts/templates/spec.md`, `src/orchestrator/prompts/templates/spec-revision.md`, `tests/run-task-prompts.golden.json`

1. **`state.ts`.** Add a small local helper:

```ts
function statusFieldFix(taskId: string, fieldName: string): string {
    return fieldName === 'base_branch'
        ? `Fix it with \`canon task set ${taskId} base_branch <branch>\` (only before the task branches), or ask the human to correct it in status.json.`
        : `Ask the human to correct ${fieldName} in status.json.`;
}
```

   Replace the trailing `Edit status.json.` in the three `validateBranchField` throws and the `validateNonNegativeInt` throw (`fieldPath`) with `${statusFieldFix(...)}`.
2. **Bundle mismatch, `git.ts:195` and `main.ts:2466`.** Replace `Edit status.json to align before invoking.` with ``Align them with `canon task set <id> base_branch <branch>` before the tasks branch; once branched, ask the human to fix status.json.``
3. **`main.ts:1996`.** Change it to ``    - If unmerged work: open a PR (gh pr create --base … --head … ...), then re-run `canon run <ids> --ship` — it merges the open PR.`` Keep the existing `shellQuoteArg` interpolations, and use the task ids in scope at that call site; check the enclosing function for the id variable.
4. **`main.ts:2162`.** Change it to:

   ```
   This can happen during gh transient hiccups. Re-run `canon run <id> --ship`; if it keeps failing, the human can merge PR #${prNum} manually and re-run --ship.
   ```

   `assertNoOpenPRForTask` receives only `branchName`. Either add a `taskIds` parameter at its call site(s) or phrase it as "re-run --ship" without the id. Prefer the latter if adding the parameter would touch more than the caller. There must be no `gh pr merge ${…} --squash` left.
5. **`task/index.ts:1575`.** Change it to `'Topology changes are only allowed before branching; recreate the task or ask the human to migrate status.json.'`
6. **`task/index.ts:356`.** Change it to `… see INVALID: rows above. Ask the human to repair the malformed status.json files or remove the task dir.`
7. **Prompts.** In both `spec.md:27` and `spec-revision.md:28`, change "flag these categories as `delicate: true` in `status.json`" to "flag these categories with `canon task set <id> delicate true`". Then run `UPDATE_GOLDENS=1 npm test` and check that the golden diff contains only these lines.
8. Run `npm test -- tests/recovery-hints.test.ts`, or the full suite. None of the new strings matches `HINT_PATTERN` (`--reroute|reset-code-review|reset-spec-review|canon task accept`), so no registry rows are expected. If the test reports an unregistered site, register it as the existing entries do.

### Step 6: Docs and comments

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` (generated), `docs/decisions.md`, `docs/BACKLOG.md`, `docs/codebase-map.md`, `.canon/hooks/README.md`, `src/orchestrator/detach.ts`

1. **`docs/pipeline-orchestrator.md`:**
   - Line 188: change it to "Set by `canon task new` at task creation; change them with `canon task set <id> <field> <value>`:".
   - The `worktree` row: "set it to `false`" becomes "run `canon task set <id> worktree false`".
   - The `set` row (line 124): "points operators at recreating the task or migrating `status.json` manually" becomes "points operators at recreating the task or asking the human to migrate `status.json`".
   - After line 67 ("Do not hand-roll a poll loop…"), add a short hook note: if the project registers canon's guard hook (README "Guard hooks"), Claude Code refuses a piped `canon run`/`canon watch` and run-log polling, and names this flow instead.
   - Run `npm run sync-templates`. This file is managed and has a mirror.
2. **`docs/decisions.md`.** Append "## Guard hooks: canon-managed script, recommend-only registration (2026-11)" in the **What / Why / Rule** format of the last entry (line 587). Cover:
   - **What:** the script and its three rules, with registration recommend-only through doctor, upgrade, the README and `/canon-init`.
   - **Why:** prose norms kept being bypassed, and a deny with a redirect at the tool boundary is cheap determinism.
   - **Relation to "Canon ships zero owned content into adopter agent files":** the script is a canon-owned file in `.claude/hooks/`, not content inside an adopter agent file or settings; settings stay adopter-owned.
   - **Rejected:** an agent-usable override (an env bypass can't apply to Edit/Write, and it would train agents to always prefix it).
   - **Scope:** Bash-tool-only shell rules, PowerShell sessions get only the file-edit rule, Codex is not covered.
   - **Rule:** fail-open, and canon never writes `.claude/settings.json` or `settings.local.json`.

   This file is root-only, so it gets no mirror row (patterns.md, "Declare `templates/` mirrors…").
3. **`docs/BACKLOG.md:31`.** Change "the `~/.claude` shell-guard hook" to say that the pipe guard is now ported as canon's shipped Claude Code guard hook (`.claude/hooks/canon-guard.mjs`), while the rest of that user-level hook stays operator-local.
4. **`docs/codebase-map.md`.** Add a row near line 157: `| Claude Code guard hook | .claude/hooks/canon-guard.mjs | PreToolUse deny for status.json writes, piped canon run/watch and log polling, and squash merges of task PRs; registration snippet RECOMMENDED_GUARD_HOOKS in src/cli/commands/doctor.ts |`. Format the paths in backticks to match the table. Also update the line-157 "Claude permissions + SessionStart hook" row to mention the PreToolUse guard registration.
5. **`.canon/hooks/README.md`.** Change "Absence is the default — canon-ai itself ships no hooks." to say that canon ships no orchestrator hooks here, so absence is the default. Add that these are orchestrator shell hooks, distinct from the Claude Code guard hook canon installs at `.claude/hooks/canon-guard.mjs`. This file is not in `CANON_OWNED`, so it has no mirror.
6. **`src/orchestrator/detach.ts:23`.** Replace the `tail -f tasks/<id>/.canon-run.log` bullet with a note that `canon watch <id>` streams the run and reports how it ended; read the run log with a single `tail -n` if needed.

### Step 7: Build and validate

Files: `dist/cli/index.js`, `dist/orchestrator/run-task.js`

1. Run `npm run build` (tracked `dist/`).
2. Run `npm run type-check && npm run lint && npm test && npm run sync-templates:check && npm run docs-refs-check`.
3. **AC-10 zero-match grep:**

   ```
   grep -rnE 'Edit status.json|migrate .status.json. manually|Fix the malformed files|delicate: true. in .status.json|gh pr merge \$\{[^}]*\} --squash|Set in .status.json. at task creation' src .claude/skills .canon/templates .canon/README.md docs/pipeline-orchestrator.md templates --exclude-dir=worktrees
   ```

   Also run the supplementary `grep -rnE 'status\.json.? manually'` over the same set (see contradiction 1). Both must return nothing.
4. **AC-10 prompt sweep:** `grep -rnE 'gh pr merge|canon run[^|]*\||status\.json' src/orchestrator/prompts/`. Classify every hit in `handoff.md` as a mention or an instruction; there must be zero instructions.
5. **AC-11:** run `node dist/cli/index.js doctor` in the worktree and confirm the `.claude/hooks/canon-guard.mjs` line passes.
6. **Handoff Changes table:** list every Affected File, including both `templates/` mirrors and both `dist/` bundles.

## Testing Plan

- **Unit:** `tests/canon-guard.test.ts` covers AC-2 through AC-7, one test per listed case. `tests/cli.test.ts` covers AC-1 (init, upgrade and leak list) and AC-8 (README drift, matcher, doctor warning states, upgrade notice, no settings writes). Regenerate the golden fixture for the AC-10 prompt rewording.
- **E2E:** not applicable.
- **Manual:** AC-9 and AC-12 by reading the files; AC-10 by grep plus handoff classification; AC-11 by a doctor run. The Human Test Plan in the spec covers a live Claude Code session. The deny-output field path (`hookSpecificOutput.permissionDecision`) is only fully proven by a live session; flag that in the handoff and PR body (patterns.md, "keep its fakes honest").

## Rollback Plan

Revert the commit. The script is a new managed file, so adopters who upgraded keep a stale but harmless copy, and the snippet's `test -f … || true` makes a removed script a no-op. No data or `status.json` schema changes. canon-ai's own `.claude/settings.json` registration reverts with the commit.

## Open questions recorded (unattended session)

- `assertNoOpenPRForTask` has no task id in scope (Step 5.4). The plan prefers id-free wording over widening the signature. The implementer may thread the id if that is a one-call-site change.
