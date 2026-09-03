# Implementation Plan: worktree-root-in-repo

> Written by: Claude | Implements: `tasks/worktree-root-in-repo/spec.md`

## Approach

Land the change in five layers, each independently testable before moving to the next:

1. **The default itself** (`env.ts`) — smallest possible diff, and every other step's tests depend on it.
2. **A prune before reuse** (`worktree.ts`) — pure addition, no control-flow change.
3. **The new run-entry refusal** (`main.ts` + a new `state.ts` export) — the one new mechanism in this task.
4. **The one-sentence message edit** (`state.ts`, `assertManagedInvocationRoot()`) — no logic change.
5. **Gitignore, docs, changelog, dist rebuild** — mechanical, but gated by the base-drift/mirror rules in `docs/patterns.md`.

Resolution itself (`resolveTaskCwd`, `findExistingWorktreeForBranch` ×2, `scanWorktreesForSecondaryOwnership`, `isOrphanedWorktreeState`, `getActiveCwd`, `resolveShipCwd`, `teardownWorktree`) is **not touched** anywhere in this plan — the spec's Non-Goals are load-bearing, not just documentation. If any step below seems to require touching one of those functions, stop and re-read the spec's "Why revision 4 deletes the root-scoping mechanism" section before proceeding — that path was rejected for a structural reason across three review rounds, not overlooked.

Every new path comparison in this task **must canonicalize both sides** (`fs.realpathSync`, or the existing `canonicalizePath()` in `state.ts`) before comparing — `docs/patterns.md` "macOS path canonicalization" pitfall, restated in the spec's Known Risks. The in-repo root now shares a filesystem prefix with `REPO_ROOT` (unlike the old sibling layout), so an un-realpath'd comparison that happened to work before can silently fail on macOS temp dirs (`/var` vs `/private/var`).

## Steps

### Step 1: Default root — `src/orchestrator/env.ts` (AC-1, part of AC-10)

Change the `WORKTREES_ROOT` default branch (line 68):

```ts
export const WORKTREES_ROOT = process.env.CANON_WORKTREES_ROOT
    ? path.resolve(REPO_ROOT, process.env.CANON_WORKTREES_ROOT)
    : path.resolve(REPO_ROOT, '.canon/worktrees');
```

Rewrite the `resolveRepoRoot()` comment at lines 32-33 (references `WORKTREES_ROOT = REPO_ROOT/../dev-worktrees`) so it describes the current default without the string `dev-worktrees`. Keep the rest of that comment (the `--git-common-dir` vs `--show-toplevel` rationale, the `resolveTaskCwd` pointer, the PR #42 note) — none of that changed.

`state.ts`'s `effectiveWorktreesRoot()` (line 9-18) already falls through to `WORKTREES_ROOT` when the env var is unset, so it needs no edit here — verify this by reading it again after Step 1, not by assumption.

**Test** (AC-1): new unit test(s) in `tests/run-task-safety.test.ts`, near the existing `effectiveWorktreesRoot` / `classifyInvocationRoot` block (~line 7686). With `CANON_WORKTREES_ROOT` unset, assert `WORKTREES_ROOT === path.join(REPO_ROOT, '.canon/worktrees')`, `effectiveWorktreesRoot() === path.join(REPO_ROOT, '.canon/worktrees')`, and `worktreePath('x') === path.join(REPO_ROOT, '.canon/worktrees', 'x')`. Canonicalize both sides of each comparison even though no temp dir is involved here — `REPO_ROOT` itself can be a symlinked path on macOS CI runners.

**Do not touch** `tests/run-task-safety.test.ts:7695-7699` (AC-2's relative-override test) — it already asserts `path.resolve(REPO_ROOT, '../dev-worktrees')` for an *explicit* `CANON_WORKTREES_ROOT=../dev-worktrees`, which is override behavior, not the default, and must keep passing unmodified.

### Step 2: Prune before reuse — `src/orchestrator/worktree.ts` (AC-5)

In `ensureWorktree()` (starts at line 297), add a prune call as the very first line of the function body, before `let wt = worktreePath(taskId);`:

```ts
export function ensureWorktree(taskId: string, branch: string, startPoint?: string): string {
    const pruneResult = gitSafe('worktree', 'prune');
    if (!pruneResult.ok) warn(`git worktree prune failed (continuing): ${pruneResult.stderr}`);
    ...
```

`gitSafe()` already runs at `REPO_ROOT` by default (`runCommand()` in `git.ts:11-13` hardcodes `cwd: REPO_ROOT`), so no explicit cwd argument is needed — do not add one. This must run before **both** branches of the existing `if (fs.existsSync(wt))` check, because both branches call `findExistingWorktreeForBranch()`, and the ordering requirement (Known Risks: "Prune ordering") is that `git worktree list` never sees a stale entry when the reuse decision consults it.

Use `gitSafe`, not `git` — a prune failure (rare: git binary hiccup) should not abort worktree creation; it should just mean the stale-registration bug this step exists to fix isn't fixed *this run*, which is no worse than pre-change behavior.

**Test** (AC-5, red-first): in `tests/run-task-safety.test.ts`, extend the existing `ensureWorktree` real-git test scaffolding (`runEnsureWorktreeInline`, ~line 1099). Sequence: create a worktree via `ensureWorktree`, `fs.rmSync(wt, { recursive: true, force: true })` to delete the directory by hand (not `git worktree remove`), confirm via `git worktree list --porcelain` in the harness that the stale registration is still present, call `ensureWorktree()` again for the same task/branch, then assert (a) the returned path exists on disk and (b) `git worktree list --porcelain` no longer lists it as `prunable` (or, more directly: that the path it lists now exists). Write this test against the *current* (pre-Step-2) code first and confirm it fails — the spec's AC explicitly requires red-first evidence — then apply Step 2 and confirm green.

### Step 3: The new run-entry refusal (AC-6, AC-7)

**3a. No change to resolution — add the negative-space test first.**

Before writing the guard, add the AC-6 regression test proving resolution stays location-blind, so a later mistake (accidentally scoping `resolveTaskCwd` while "helping" the guard) fails loudly:

- New real-git test in `tests/run-task-safety.test.ts`: on a temp repo with `CANON_WORKTREES_ROOT` unset, register a worktree for a task's branch at a path **outside** `.canon/worktrees` (e.g. a sibling temp dir), write that worktree's own `tasks/<id>/status.json` with `worktree: true` and a blank `branch` (so resolution takes the `scanWorktreesForSecondaryOwnership` path — mirror the existing bundle-secondary fixture at `tests/run-task-safety.test.ts:1706-1727` rather than inventing a new fixture shape), and assert `resolveTaskCwd(taskId)` returns that out-of-root path (canonicalize both sides).
- Run, unmodified: the bundle-secondary test (`tests/run-task-safety.test.ts:1706-1727`), the stale-worktree `INVALID` test in `tests/task-cli.test.ts` (~line 417), and AC-2's relative-override test (`tests/run-task-safety.test.ts:7695-7699`) — confirm they still pass after Step 1 and Step 3 land; do not edit them.
- `grep -n 'effectiveWorktreesRoot\|isContainedIn\|isPathInside' src/orchestrator/state.ts src/orchestrator/worktree.ts` — confirm no containment call appears inside `findExistingWorktreeForBranch()` (either copy — `worktree.ts:74` and `state.ts:194`) or `scanWorktreesForSecondaryOwnership()` (`state.ts:162`). Run this grep again after Step 3b to prove the guard didn't get folded into resolution by mistake.

**3b. Add the guard function — `src/orchestrator/state.ts`.**

Add a new exported function near `assertManagedInvocationRoot()` (after it, ~line 120), since it shares the same canonicalization helpers and the `CANON_TASKS_DIR_OVERRIDE` exemption pattern:

```ts
export function assertTaskWorktreeWithinRoot(taskId: string): void {
    if (process.env.CANON_TASKS_DIR_OVERRIDE) return;
    const resolved = resolveTaskCwd(taskId); // may die() itself (missing-worktree) — acceptable, see Known Risks
    if (resolved === REPO_ROOT) return;
    const worktreesRoot = effectiveWorktreesRoot();
    if (isPathInside(canonicalizePath(resolved), canonicalizePath(worktreesRoot))) return;
    die(
        `Task '${taskId}' resolves to a worktree outside canon's managed worktrees root:\n` +
        `  ${resolved}\n\n` +
        `Canon expects task worktrees under:\n` +
        `  ${worktreesRoot}\n\n` +
        `To run this task, either:\n` +
        `  - move the directory to ${path.join(worktreesRoot, taskId)} and run \`git worktree repair\`, or\n` +
        `  - set CANON_WORKTREES_ROOT to point at the directory's current location.\n`,
    );
}
```

Notes on this implementation:
- `resolveTaskCwd`, `effectiveWorktreesRoot`, `isPathInside`, and `canonicalizePath` are all already defined in this same file — no new imports needed, and `canonicalizePath`/`isPathInside` are currently private (`function`, not `export function`); leave them private, this new function is in the same module.
- Do **not** re-derive "is this a worktree at all" from `fs.existsSync` checks or directory-name conventions — `resolved === REPO_ROOT` is the correct and only "no worktree, or worktree disabled" signal, because that's exactly what `resolveTaskCwd` returns in both of those cases (AC-7(d)'s fresh-task-no-worktree case, and a task with `worktree: false`).
- The message must name (i) the resolved out-of-root path, (ii) the effective worktrees root, (iii) both remedies — all present above. It must not use the word "hand-created" (that phrasing is reserved for `assertManagedInvocationRoot()`'s message, and is exactly the phrasing AC-13(i) says is *wrong* to apply to a canon-created worktree).
- Read the env var the same way the value it's compared against was derived: `effectiveWorktreesRoot()` re-reads `process.env.CANON_WORKTREES_ROOT` on every call (unlike `worktree.ts`'s module-level `WORKTREES_ROOT` constant) — this matters for tests that set the env var after import (Implementation Notes' third bullet in the spec).

**3c. Call the guard from `src/orchestrator/main.ts` (AC-7).**

Insert immediately after line 3454 (`splitEnv.warnWorktreesRootMismatch();`), before the `skipAgentDeps` line (3455) — i.e. before `checkDeps`, before the early-heartbeat resolver is even constructed, before `guardConcurrentRun`, before the `--dry-run` exit, and before the `--ship` branch:

```ts
if (!cliArgs.ship) {
    for (const taskId of cliArgs.taskIds) {
        splitState.assertTaskWorktreeWithinRoot(taskId);
    }
}
```

This single placement, gated only on `!cliArgs.ship`, satisfies every AC-7 sub-case without a second call site:
- `--dry-run` still hits it (placed before the `cliArgs.dryRun` exit at line 3506-3510) — AC-7 requires this.
- `--ship` is exempt via the explicit condition — confirmed by Interaction Dependencies: `shipTasks()` at line 3517 is unreachable from a refused run, but this check runs *before* line 3506 regardless, so ship must be excluded by condition, not by ordering.
- `--reroute` and `--full-send` are covered implicitly — they don't branch until after this point (`cliArgs.reroute` handling is at line 3521+, well after).
- No `.canon-pid` / `.heartbeat.json` is written before this point (`bootHeartbeatWithHooks` is at line 3501-3504, `guardConcurrentRun`'s resolver runs later at 3497-3499) — check this ordering holds after your edit by reading the surrounding ~30 lines again, since line numbers will have shifted by the time you're editing.
- Bundle mode: looping over every `cliArgs.taskIds` entry (not just `taskIds[0]`) means a secondary resolving to the leader's in-root worktree passes (AC-7(c) / Interaction Dependencies), and any single out-of-root task in a bundle refuses the whole run.

**Test** (AC-7): four real-git tests in `tests/run-task-safety.test.ts`, using `childEnvWithoutTasksOverride` (line 556) to clear the test-harness escape hatch (these tests must exercise the *real* guard, not the override fast-path) and `CANON_WORKTREES_ROOT` unset:
- (a) Register an out-of-root worktree owning the task (reuse the Step 3a fixture pattern). Spawn `canon run <id>` (or the equivalent inline entry point already used elsewhere in this file for `main()` — check how other tests in this file invoke `main()` as a subprocess, e.g. near the `commitHumanReviewFiles` / `--ship` tests, and follow that pattern rather than inventing a new one). Assert non-zero exit, assert the three message elements are present in combined stdout+stderr, and assert no `.canon-pid` / `.heartbeat.json` file exists afterward in either the task dir or the (non-existent, since refused) worktree dir.
- (b) Same setup, invoked with `--ship` — assert the refusal does **not** fire (ship may still fail or succeed for other reasons in the fixture; the assertion is specifically "not this message").
- (c) A task with an in-root worktree at a non-default directory name (i.e., not literally `.canon/worktrees/<task-id>`, but still nested under `.canon/worktrees/`) — assert the run proceeds past this check (it may still fail later for unrelated fixture reasons; assert specifically that the refusal message is absent, or that execution reached past the point where the guard would have exited).
- (d) A freshly created task with `worktree: true` but no worktree created yet (branch unset, no directory) — assert the run proceeds past this check.

### Step 4: The invocation-root message sentence — `src/orchestrator/state.ts` (AC-13(i))

In `assertManagedInvocationRoot()`'s `die()` call (lines 105-118), append one sentence. Do not change the classification logic, the two call sites (`src/task/index.ts:1554`, `src/orchestrator/main.ts:3452`), or the `CANON_TASKS_DIR_OVERRIDE` early return (line 97) — only the message string. Suggested insertion, appended after the existing final sentence ("...set CANON_WORKTREES_ROOT accordingly."):

```
This also covers a worktree canon itself created under an earlier default
worktrees-root location — to migrate it, move the directory under the
current root shown above and run `git worktree repair`.
```

Verify the result contains no occurrence of the string `dev-worktrees` (AC-10's grep will catch this, but check it directly here since this is the one message edit in the whole task that's easy to get wrong by copy-pasting from docs).

No test asserts this message's exact text today (confirmed during spec review — see `notes.md`); AC-13's own test (below) is what pins it, alongside the pre-existing pure `classifyInvocationRoot` tests (`tests/run-task-safety.test.ts:7570-7684`), which must keep passing **unmodified** as evidence the classifier itself wasn't touched (each already supplies an explicit `worktreesRoot`, so they exercise pure logic only).

**Test** (AC-13, both halves — do this after Step 3, since (ii) exercises the same fixture):
- (i) Real-git test: a linked worktree registered for the task's branch at a sibling path outside `<main>/.canon/worktrees`, with the task's `status.json` inside it. Invoke a `canon task` subcommand (e.g. `canon task status <id>`, via `taskCmd`) with `cwd` set to that sibling worktree directory. Assert non-zero exit, and assert the output names the invocation path, the effective worktrees root, and contains the new sentence from Step 4 (and does not contain `dev-worktrees`).
- (ii) Same fixture: invoke a **state-mutating** `canon task` subcommand (e.g. `canon task phase <id> <phase> in_progress`, or `canon task accept`) with `cwd` set to the **main checkout**. Assert the sibling worktree's `status.json` changed and the main checkout's own `tasks/<id>/status.json` did not.
- (iii) Confirm `tests/run-task-safety.test.ts:7570-7684` (the pure `classifyInvocationRoot` block) passes unmodified — this is the "classifier untouched" evidence per AC-13(c).

### Step 5: Comment-only cleanups (remainder of AC-10)

Three more comments reference `dev-worktrees` and must be rewritten without that string, with no other change to surrounding code:
- `src/orchestrator/main.ts:32-38` — the top-of-file comment describing worktree root location and the `additionalDirectories` guidance.
- `src/orchestrator/git.ts:281` — `ensureBranch()`'s comment ("...qa run in ../dev-worktrees/<id>/.").
- `src/orchestrator/state.ts:224` — `taskDirFor()`'s comment ("`dev-worktrees/<id>/` directory that happens to exist...").

After Steps 1-5: `grep -rn 'dev-worktrees' src/` must return **zero** hits (AC-10). Run this grep as a checkpoint before moving on — line numbers cited above will have drifted from earlier edits in this same task, so locate each comment by its surrounding function/text, not by trusting the line number literally.

Then: `npm run build`, and confirm `grep -c 'dev-worktrees' dist/cli/index.js dist/orchestrator/run-task.js` returns `0` for both (AC-10).

### Step 6: Gitignore pattern (AC-8)

Add `.canon/worktrees/` to `CANON_RUNTIME_GITIGNORE_PATTERNS` in `src/lib/canon-block.ts:4-9`:

```ts
export const CANON_RUNTIME_GITIGNORE_PATTERNS = [
    'tasks/**/.canon-pid',
    'tasks/**/.canon-run.log',
    'tasks/**/.heartbeat.json',
    'tasks/**/.pr-number',
    '.canon/worktrees/',
] as const;
```

This single constant drives `CANON_GITIGNORE_BLOCK` (same file), `canon init`/`canon upgrade`'s write path, and `checkRuntimeFilesGitignored()` in `src/cli/commands/doctor.ts:572-594` — no other source edit needed for AC-8's doctor behavior.

Then:
- Run `npm run sync-templates` so `templates/.gitignore` regenerates with the new pattern; verify with `npm run sync-templates:check`.
- Add the pattern to canon-ai's own root `.gitignore` inside the existing `# canon:start` / `# canon:end` block (canon-ai is itself an adopter, per Affected Files) — either by hand or by confirming `canon upgrade`'s own idempotent write does it; check `git status` afterward and stage it explicitly.

**Test** (AC-8): the existing constant-driven tests in `tests/cli.test.ts` and `tests/sync-canon-templates.test.ts` should pass unmodified (they read the constant, not a hardcoded list — confirm this by reading them, don't assume). Add one new test next to the existing `checkRuntimeFilesGitignored` block (`tests/cli.test.ts:1289-1319`), following the exact pattern of the `missing pattern is named in warning` test (line 1307): write a `.gitignore` containing only the four *prior* patterns (no `.canon/worktrees/`), call `checkRuntimeFilesGitignored(dir)`, assert `status === 'warn'` and the detail names the missing pattern.

### Step 7: Docs (AC-9)

`docs/pipeline-orchestrator.md`:
- Line ~252 (`CANON_WORKTREES_ROOT` table row): default value `../dev-worktrees` → `.canon/worktrees`.
- Line ~276 (Layout paragraph): `../dev-worktrees/<task-id>/` (sibling...) → `.canon/worktrees/<task-id>/` (inside the repo). Add one sentence each on the two trade-offs named in the spec: root-walking `**/` globs in project tooling should exclude `.canon/worktrees/`; `git clean -ffdx` (double force) or removing `.canon` destroys in-flight worktrees, while plain `git clean -fdx` skips them.
- Line ~178 ("each task gets its own sibling directory") — correct the "sibling" wording. **Grep-verify, don't trust the spec's cited line numbers exactly**: the spec's Affected Files table cites lines 178 and 274 for the two "sibling directory" occurrences, but as of this plan's drafting, `grep -n "sibling" docs/pipeline-orchestrator.md` shows the second occurrence at line 276, not 274 (the Layout paragraph itself, already covered above) — there may be only the one additional occurrence at line 178. Run `grep -n 'sibling' docs/pipeline-orchestrator.md` yourself before editing and fix every hit that describes the *location*, not just the two line numbers named in the spec. This is noted as a spec inaccuracy in `notes.md`.
- Add a short paragraph (near the Layout section) stating the upgrade behavior: a task whose worktree predates the move refuses to run (`canon run`) until the directory is moved to the new root (plus `git worktree repair`) or `CANON_WORKTREES_ROOT` is pinned to the old location; `canon` commands invoked from inside that old directory hit the pre-existing invocation-root refusal and must run from the main checkout, where `canon task` still reads and writes the task's real state; `--ship` on such a task still merges and archives it, leaving the old directory behind.
- Run `npm run sync-templates` to regenerate `templates/docs/pipeline-orchestrator.md`; verify with `npm run sync-templates:check`.

`docs/patterns.md:244` — the bundle-secondary paragraph: replace `dev-worktrees/<leader>/` with the new path form, e.g. `.canon/worktrees/<leader>/`. This file is **not** in `CANON_OWNED`/`DELIMITED` (verify with `grep -n 'patterns.md' src/lib/canon-owned.ts` — expect no hit) — it has no `templates/` mirror, so do not add or edit `templates/docs/patterns.md` for this change.

`docs/codebase-map.md:148` — the `additionalDirectories` row: keep the `../dev-worktrees` value as-is (canon-ai's own `.claude/settings.json` isn't changing per Non-Goals), but add a parenthetical marking it a legacy grant retained until in-flight pre-3.0.0 worktrees drain. This is the one permitted `dev-worktrees` survivor in `docs/` besides history files — AC-11 depends on it being exactly this one row.

**Verify** (AC-9): `npm run sync-templates:check`, `npm run docs-refs-check`, and `grep -rn 'dev-worktrees' docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md docs/patterns.md README.md` → zero hits.

### Step 8: Changelog (AC-12)

Add to `CHANGELOG.md` under `[Unreleased]` → `### Changed`, in the blockquote-callout style of the 2.9.0-era `Breaking (adopters)` entries (see `CHANGELOG.md:153` for the canonical example of this style — opens with `> **Breaking (adopters):**`). Cover, per AC-12: the new default; that an unmigrated task refuses to run with the two migration paths (move `../dev-worktrees/<id>` → `.canon/worktrees/<id>` + `git worktree repair`, or pin `CANON_WORKTREES_ROOT=../dev-worktrees`); that `--ship` on an unmigrated task still merges and archives but leaves the old directory behind; that a hand-deleted worktree directory is now pruned automatically on the next run; the two trade-offs from Step 7 (globs, `git clean -ffdx`), one sentence each; and that `canon` commands run from inside an unmigrated worktree directory are refused and must run from the main checkout instead.

**Verify**: read the entry against the AC-12 checklist above line by line; `npm run docs-refs-check`.

### Step 9: Rebuild dist (part of AC-10, and required per Validation Required)

`npm run build`, then verify `dist/cli/index.js` and `dist/orchestrator/run-task.js` are both regenerated and staged — this task's Affected Files table declares both explicitly, and the base-drift gate at `--pr` rejects an undeclared changed `dist/` file.

## Testing Plan

Run in this order (matches the step numbering above — later steps' tests depend on earlier steps' code being in place):

1. AC-1 (Step 1) — pure resolution test, no fixtures.
2. AC-5 (Step 2) — red-first: write the test against pre-Step-2 code, confirm it fails, then apply Step 2 and confirm it passes.
3. AC-6 (Step 3a) — write and confirm green **before** Step 3b exists, to prove it's testing today's already-correct behavior, not something Step 3b coincidentally makes true.
4. AC-7 (Step 3c) — four sub-cases, all real-git, all using `childEnvWithoutTasksOverride`.
5. AC-13 (Step 4) — reuses the AC-7(a)-style fixture; add the (ii) main-checkout-mutation half.
6. AC-8 (Step 6) — one new doctor test.
7. AC-2, AC-3 (pre-existing) — confirm both pass unmodified; do not re-run them as if they were new (they are regression pins, not new coverage).

Full-suite gate before considering implementation done: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (with a clean `git diff --exit-code dist/` after), `npm run sync-templates:check`, `npm run docs-refs-check`.

## Rollback Plan

No data migration — `status.json` schema is unchanged (Design § Data Model Changes: none), and worktree paths are always derived, never stored. Reverting this change means:
- adopters who already migrated (moved worktrees under `.canon/worktrees/`) would need to move them back or set `CANON_WORKTREES_ROOT` explicitly to keep working — document this only if a revert actually becomes necessary, not preemptively.
- the gitignore pattern addition is harmless to leave in place even after a revert (an unused ignore pattern is a no-op).
- this ships as a 3.0.0 rider per the spec; a revert before that release cuts is a plain branch revert with no adopter-visible history to unwind.
