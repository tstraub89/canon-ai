# Plan: archive-review-on-reroute

> Written by: Claude | Implemented by: Codex

## Spec-review nits incorporated (all `approved_with_nits`)

1. **Stub exception scoped to reroute only.** `taskResetCodeReview` must keep archiving an existing `review.md` unconditionally (today's behavior — no test covers "leave the stub"). Only `rerouteFromHumanReview` gets the stub-skip. Implemented via an `options.skipUnfilledTemplate` flag on the shared helper (Step 1) rather than baking the stub check into the helper unconditionally — the reroute call site opts in, the reset-code-review call site doesn't.
2. **AC-3 "no test file edits."** Read as: don't touch the *existing* `reset-code-review` test cases/assertions in `tests/task-cli.test.ts`. AC-6 adds a brand-new test to the same file — that's additive, not an edit to an existing case, and is required by AC-6/the Affected Files table.
3. **Golden case for the exempt-sibling line.** Do **not** add a new recorded golden fixture with an exempt sibling. The existing golden-recorded fixtures (`rerouteState` etc. in `tests/run-task-prompts.test.ts`) never carry a `reroute_exempt` task, so `promptSpecReview`/`promptImplementReroute`'s golden-recorded outputs don't exercise the changed line at all — regenerating with `UPDATE_GOLDENS=1` is expected to produce **no diff** in `tests/run-task-prompts.golden.json` for this change. AC-12's "confined to the reroute-prompt entries affected by AC-8" is satisfied by an empty diff; treat any non-empty diff as a defect to investigate, not something to force through.

## Step 1 — Shared archive/lookup module: `src/orchestrator/review-archive.ts` (new file)

This **substitutes** for the spec's `src/orchestrator/state.ts` Affected Files row. Reason: the stub check must reuse `isTemplateUnfilled` from `src/orchestrator/validation.ts`, and `validation.ts` already imports from `state.ts` (`readStatus`, `taskDirFor` — see `validation.ts:8`). Adding the reverse edge (`state.ts` → `validation.ts`) would create an import cycle. A new leaf-ish module that depends on `validation.ts` (which itself only depends on `state.ts`, `cli.ts`, `git.ts`, `markdown-table.ts`, `worktree.ts` — none of which will ever import this new module) has no cycle risk. `main.ts`, `src/task/index.ts`, and `prompts/index.ts` already sit "above" both `state.ts` and `validation.ts` in the dependency graph (task/index.ts already imports from `../orchestrator/validation.js`; main.ts already imports from `./validation.js` as `splitValidation`), so all three call sites can import this new module freely.

```ts
import fs from 'node:fs';
import path from 'node:path';
import { isTemplateUnfilled } from './validation.js';

export const REVIEW_ARCHIVE_PREFIX = 'review-prior-';

const REVIEW_ARCHIVE_RE = /^review-prior-(\d+)\.md$/;

// One directory scan backs both the allocator and the lookup so the two can
// never disagree about "the newest archive" (see spec Known Risks — an
// allocator/lookup split that scans separately is the exact drift this
// avoids).
function newestReviewArchiveNumber(taskDir: string): number {
    let entries: string[];
    try {
        entries = fs.readdirSync(taskDir);
    } catch {
        return 0;
    }
    let max = 0;
    for (const name of entries) {
        const match = REVIEW_ARCHIVE_RE.exec(name);
        if (match) max = Math.max(max, Number(match[1]));
    }
    return max;
}

/** Numeric max over `review-prior-(\d+)\.md` — not lexicographic (AC-2). */
export function findNewestReviewArchive(taskDir: string): string | null {
    const n = newestReviewArchiveNumber(taskDir);
    return n > 0 ? `${REVIEW_ARCHIVE_PREFIX}${n}.md` : null;
}

/**
 * Renames `<taskDir>/review.md` to the next `review-prior-<n>.md` (highest
 * existing + 1). Returns the archive filename, or null if there was nothing
 * to archive (file absent, or — when `skipUnfilledTemplate` is set — the file
 * is still the pristine unfilled-template scaffold).
 *
 * `skipUnfilledTemplate` defaults to false so `taskResetCodeReview` keeps its
 * existing behavior (archives unconditionally, matching current tests).
 * `rerouteFromHumanReview` passes `true` (AC-4).
 */
export function archivePriorReview(
    taskDir: string,
    options: { skipUnfilledTemplate?: boolean } = {},
): string | null {
    const reviewPath = path.join(taskDir, 'review.md');
    let content: string;
    try {
        content = fs.readFileSync(reviewPath, 'utf8');
    } catch {
        return null;
    }
    if (options.skipUnfilledTemplate && isTemplateUnfilled(content)) return null;
    const archiveName = `${REVIEW_ARCHIVE_PREFIX}${newestReviewArchiveNumber(taskDir) + 1}.md`;
    fs.renameSync(reviewPath, path.join(taskDir, archiveName));
    return archiveName;
}
```

Do not add a `CANON_TASKS_DIR_OVERRIDE`-style env read here — callers pass an already-resolved `taskDir` (from `taskDirFor(taskId)` or the test's own fixture path), matching how `bundleHasRealPriorReview` and `writePreflightReviewArtifacts` already do it (see `prompts/index.ts:453`, `phases/code-review.ts:195`).

## Step 2 — `src/task/index.ts`: `taskResetCodeReview` becomes a caller

Add to the import block (alongside the existing `'../orchestrator/validation.js'` import at line 7-12):

```ts
import { archivePriorReview } from '../orchestrator/review-archive.js';
```

Replace the inline rename loop at `~1120-1126`:

```ts
const reviewPath = path.join(taskDir, 'review.md');
if (fs.existsSync(reviewPath)) {
    let n = 1;
    while (fs.existsSync(path.join(taskDir, `review-prior-${n}.md`))) n += 1;
    fs.renameSync(reviewPath, path.join(taskDir, `review-prior-${n}.md`));
    console.log(`Archived prior review.md → review-prior-${n}.md`);
}
```

with:

```ts
const archivedReview = archivePriorReview(taskDir);
if (archivedReview) {
    console.log(`Archived prior review.md → ${archivedReview}`);
}
```

No other line in `taskResetCodeReview` changes (AC-3). The `spec-review-prior-` loop in `taskResetSpecReview` (~1077-1081) is untouched — it keeps its own lowest-unused scan (Non-Goals).

## Step 3 — `src/orchestrator/main.ts`: `rerouteFromHumanReview` archives + drops the stale session

Add near the top import block:

```ts
import { archivePriorReview } from './review-archive.js';
```

### 3a. Fail-closed archive pass (AC-10)

Insert a new loop **after** the amendment-failure handling block and the `splitCli.info('Rerouting: ...')` banner, but **before** the existing per-task status-mutation loop (`for (const taskId of taskIds) { const status = splitState.readStatus(taskId); ...`). This is the exact point where "no `status.json` mutation has happened yet for any task in this invocation" holds.

```ts
const archivedReviewByTask = new Map<string, string | null>();
for (const taskId of taskIds) {
    const taskDir = taskDirFor(taskId);
    let archived: string | null;
    try {
        archived = archivePriorReview(taskDir, { skipUnfilledTemplate: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const completed = [...archivedReviewByTask.entries()]
            .filter(([, name]) => name !== null)
            .map(([id, name]) => `${id} → ${name}`)
            .join(', ') || 'none';
        die(
            `--reroute aborted: failed to archive tasks/${taskId}/review.md: ${message}\n` +
            `  No task's status.json was modified. Already-completed archives before the failure (nothing was lost — content is preserved on disk): ${completed}.`
        );
    }
    archivedReviewByTask.set(taskId, archived);
    if (archived) {
        splitCli.info(`Archived tasks/${taskId}/review.md → ${archived} (post-reroute review starts a fresh round 1).`);
    }
}
```

`taskDirFor` is already aliased at `main.ts:118` (`const taskDirFor = splitState.taskDirFor;`) and already resolves worktree-canonically (`resolveTaskCwd` under the hood) — this is the same resolver `bundleHasRealPriorReview` and the code-review phase use, so it's consistent with "route through the worktree-canonical resolvers" (spec Decision, last line).

`die()` (`src/orchestrator/cli.ts:97`) prints to stderr and calls `process.exit(1)` — it never returns, so the mutation loop below genuinely never runs once any archive throws. This satisfies AC-10 without restructuring the mutation loop itself.

Note: this loop runs for **every** task in `taskIds`, including exempt siblings on a spec-gap bundle reroute — per spec's Interaction Dependencies, exempt siblings' reviews restart at round 1 too, so they're archived like everyone else. Don't filter by `isSpecGapReroute` / exempt status here.

### 3b. Drop `sessions.claude_review` (AC-7, Decision item 2)

Inside the existing per-task mutation loop, add this near the `codeReview` block (after the existing `clearPhaseOperatorAcceptance(codeReview);` line, ~2607), **unconditionally** (both tiers — code_review runs on fast and full tier alike, unlike `codex_spec_review` which is full-tier-only and already scoped inside `if (isFullTierReroute)`):

```ts
if (status.sessions && Object.hasOwn(status.sessions, 'claude_review')) {
    delete status.sessions.claude_review;
}
```

Place it as a sibling statement to the existing `codex_spec_review` deletion, not nested inside the `if (isFullTierReroute)` block. Match the `Object.hasOwn` guard style already used in `taskResetCodeReview` (`src/task/index.ts:1141`) rather than the bare `delete status.sessions.codex_spec_review` style at line 2627 (both are safe on an optional field, but the guarded form is what the existing reset helper does and keeps the two "drop this session" code paths visibly parallel).

No other line in the mutation loop changes.

## Step 4 — `src/orchestrator/prompts/index.ts`: repoint the two exempt-sibling lines (AC-8)

Add to the import block (alongside the existing `import { taskDirFor } from '../state.js';` at line 7):

```ts
import { findNewestReviewArchive } from '../review-archive.js';
```

Add a small helper near `bundleHasRealPriorReview` (~line 447):

```ts
// The prompt looks the archive up on disk at render time rather than being
// handed the filename from the reset — a run that dies after the reset and
// is resumed by a later plain `canon run` (no --reroute) re-renders this
// prompt in a process that never called archivePriorReview, so any in-memory
// handoff would dangle. If nothing is archived (edge case: no reset ever ran,
// or the review.md was a stub and left in place), fall back to the original
// bare `review.md` wording rather than naming a file that doesn't exist.
function priorReviewReference(taskId: string): string {
    const archived = findNewestReviewArchive(taskDirFor(taskId));
    return archived ? `tasks/${taskId}/${archived}` : `tasks/${taskId}/review.md`;
}
```

Update the two exempt-sibling lines that currently hard-code `tasks/${t.taskId}/review.md`:

**`promptSpecReview`, ~line 168:**

```ts
return `- \`${t.taskId}\`: "${t.title}" — EXEMPT from amendment (verdict was \`${exemptInfo.priorVerdict}\`; spec was not amended). No Amendment section exists — review the spec as-is under first-pass rules. Prior review findings in ${priorReviewReference(t.taskId)} remain binding; do NOT describe this task as passing.`;
```

**`promptImplementReroute`, ~line 400:**

```ts
return `- \`${t.taskId}\`: "${t.title}" — EXEMPT from amendment (verdict was \`${exemptInfo.priorVerdict}\`). There is no Amendment section in tasks/${t.taskId}/spec.md. Your prior review findings at ${priorReviewReference(t.taskId)} remain binding — read that file and address ALL findings from the most recent review round before submitting. Do NOT treat this task as passing. Your previous handoff is at tasks/${t.taskId}/handoff.md.`;
```

Leave every other line in both functions untouched — in particular the **advancing**-verdict exempt branches (`promptSpecReview` ~166, `promptImplementReroute` ~398) name only `handoff.md`/nothing and are explicitly unchanged per AC-8. `bundleHasRealPriorReview` (~447) and `promptCodeReview`'s round-forcing logic are unchanged — they already work correctly off an absent `review.md`.

## Step 5 — `docs/pipeline-orchestrator.md` §"Human Reroute" (AC-11)

Insert a new paragraph after the existing uncommitted-state paragraph (ends `docs/pipeline-orchestrator.md:464`, "...or equivalent) in that window.") and before the "If Codex returns `changes_requested`..." paragraph (line 466):

```markdown
Reroute also archives each named task's `review.md` to `review-prior-<n>.md` in the task's active directory — `<n>` one greater than the highest archive number already present there (1 when none exist) — and drops the stored `sessions.claude_review` ID, so the post-reroute code review starts a genuine round 1 instead of resuming a session that remembers the pre-reroute rounds. A `review.md` that is still the pristine unfilled template (code_review never ran before the reroute) is left in place — nothing to archive, and no `review-prior-*.md` is created. Findings from an archived review remain binding; reroute prompts for exempt siblings point at the archived file, not the (now-absent) `review.md`.
```

Do not touch the `reset-code-review` row (`docs/pipeline-orchestrator.md:122`) — its existing description (archives, zeroes counters, drops `claude_review`) is already accurate and doesn't mention numbering internals.

`templates/docs/pipeline-orchestrator.md` regenerates via the pre-commit sync hook — do not hand-edit it (per `docs/patterns.md` "Canon templates auto-sync from root").

## Step 6 — Tests

All new tests below live in `tests/run-task-reroute-preflight.test.ts` unless noted (matches the spec's Affected Files table). That file already has the `withTempDir`, `writeTaskStatus`, `initGitRepo`, `worktreeTasksRoot`, `makeRerouteStatus`/`makeCodeReviewBlockedStatus`, `writeSpec`, `runReroute`, `readStatus`, and `runCheckAndRoute` helpers — reuse them; don't reinvent.

### 6a. New `writeReview` seeding helper (used by several ACs below)

Add next to `writeSpec` (~line 93), with **append-if-exists, write-if-absent** semantics — mirroring how `writePreflightReviewArtifacts` (`phases/code-review.ts:182-225`) actually behaves, so it can faithfully reproduce both the pre-fix wedge (append after surviving stale content) and the post-fix clean state (no stale content to append to):

```ts
function writeReview(root: string, taskId: string, content: string): void {
    const reviewPath = path.join(root, 'tasks', taskId, 'review.md');
    fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
    let existing = '';
    try { existing = fs.readFileSync(reviewPath, 'utf8'); } catch { /* absent — fresh write */ }
    const next = existing ? `${existing.replace(/\s*$/, '')}\n\n${content}` : content;
    fs.writeFileSync(reviewPath, next, 'utf8');
}
```

### 6b. AC-1 — red-first regression: post-reroute round-1 review parses cleanly

New test, worktree-backed single task (mirror the fixture shape in the existing full-tier reset test at ~966-988):

1. `writeTaskStatus` into both `tasksRoot` and the worktree copy for a task at `human_review` (or `code_review` blocked — any admitted entry phase), full tier.
2. `writeSpec` with an `## Amendment` section (required for the amendment pre-flight to pass).
3. `writeReview` into the **worktree** copy with a filled Stage-1 template plus a trailing `## Round 2` section whose `### Verdict for this round` has `- [x] Changes requested` checked — mirror the repro shape from `spec.md`'s Problem section.
4. `runReroute(dir, [taskId], false)` → assert `status === 0`.
5. Assert `review.md` does not exist and `review-prior-1.md` exists (in the worktree task dir) and its content contains `## Round 2`.
6. Call `writeReview` again on the same worktree task dir with a filled template whose `## Final Verdict` has `- [x] **Approved**` checked and **no** `## Round` heading — this is "the way the foreman does it" (round 1 doesn't wrap in a `## Round 1` heading, per `code-review-foreman.md:99`, cited in spec.md step 4).
7. In the **same test process** (no subprocess needed — `checkPhaseGate` doesn't touch `cliArgs`), temporarily set `process.env.CANON_TASKS_DIR_OVERRIDE = worktreeTasksRoot(worktreesRoot, taskId)` (save/restore the previous value, following the pattern in `tests/run-task-validation.test.ts:82-91`), then call `checkPhaseGate(taskId, 'code_review', 'approved')` and assert `{ ok: true }`.

This is red-first: on pre-fix code, step 4 leaves `review.md` un-archived, so step 6's append lands after the surviving `## Round 2` block, and step 7's `checkPhaseGate` call returns `ok: false` with a verdict-mismatch reason (the stale `changes_requested` from `## Round 2` wins per `extractCheckedVerdict`'s last-round scoping) — exactly the mechanism in `spec.md`'s Problem section.

### 6c. AC-2 — allocator/lookup invariant, gapped + two-digit fixture

Standalone unit test (no reroute machinery, no git) importing `archivePriorReview`, `findNewestReviewArchive` directly from `'../src/orchestrator/review-archive.js'`:

1. `withTempDir`, create a task dir with `review-prior-2.md`, `review-prior-10.md` (arbitrary distinct contents), and a populated `review.md` (any real content, not a stub).
2. Call `archivePriorReview(taskDir)` (no options — default behavior, matches `taskResetCodeReview`'s call shape) and assert it returns `'review-prior-11.md'` and that file now exists with the pre-call `review.md` content.
3. Assert `findNewestReviewArchive(taskDir) === 'review-prior-11.md'`.
4. Assert `review-prior-2.md` and `review-prior-10.md` are byte-unchanged (read before/after, compare).
5. Assert `review.md` no longer exists.

This single fixture kills both a gap-filling allocator (would produce `review-prior-1.md`, lookup would still point at `review-prior-10.md`) and a lexicographic lookup (would return `review-prior-2.md` as "newest").

### 6d. AC-3 — no changes to existing `reset-code-review` tests

No new test — this AC is satisfied by *not touching* `tests/task-cli.test.ts:850-913` (the existing reset-code-review test bodies/assertions). Verify at the end of implementation with `git diff` on that file's existing test ranges before adding the new AC-6 test.

### 6e. AC-4 — template-stub `review.md` is not archived on reroute

New test: worktree-backed task, admitted entry phase, `review.md` in the worktree copy left as the literal pristine scaffold (the unfilled template — copy it verbatim from `.canon/templates/review.md`, whose placeholder sentinel is what `isTemplateUnfilled` in `src/orchestrator/validation.ts` matches on). Run `runReroute`, assert status 0, assert `review.md` still exists in the worktree copy (byte-unchanged) and no `review-prior-*.md` was created.

### 6f. AC-5 — repeat reroutes number monotonically across a deleted archive

Extend or add a test that: reroutes a task once (round 1) with a filled review.md (creates `review-prior-1.md`), simulates a fresh round-1 review being written (or just leaves it — a populated `review.md` is enough to exercise the next reroute), reroutes the **same task a second time** (round 2 — needs an `## Amendment Round 2` heading per the amendment convention) — assert `review-prior-2.md` created and `review-prior-1.md` untouched. Then `fs.rmSync` the worktree's `review-prior-1.md`, populate `review.md` again, reroute a **third** time (`## Amendment Round 3`) — assert the new archive is `review-prior-3.md` (never a reused `review-prior-1.md`) and `review-prior-2.md` is byte-unchanged.

### 6g. AC-6 — worktree-canonical routing (in `tests/task-cli.test.ts`)

Add a new test cloned from the shape of `task reset-code-review routes to the task worktree status.json` (`tests/task-cli.test.ts:2309-2396`), but exercising the reroute path instead: real `git worktree add`, a `review.md` in **both** the supervising checkout's task dir and the worktree's task dir, run the reroute (via the same subprocess pattern `runReroute` uses, or `runTaskCmd`-equivalent if a reroute CLI entry point exists — otherwise spawn `rerouteFromHumanReview` the same way `run-task-reroute-preflight.test.ts`'s `runReroute` does, pointed at the real worktree via `CANON_WORKTREES_ROOT`), and assert: the worktree's `review.md` is archived to `review-prior-1.md`, the supervising checkout's `review.md` is **byte-unchanged** (still present, untouched — the reroute never touches REPO_ROOT's copy).

### 6h. AC-7 — `sessions.claude_review` dropped, `codex_spec_review` unaffected on fast tier

New test (or extend 6f/6b's fixture): a task whose `status.json` (worktree copy) carries `sessions: { claude_review: 'stale-session', codex: 'keep-me' }`. Reroute it. Assert the written status has no `claude_review` key. Add a companion assertion (can piggyback on the existing full-tier test at ~966 which already checks `codex_spec_review` is dropped) that a **fast-tier** task's `sessions.codex_spec_review`, if present, is left untouched by a fast-tier reroute (only full-tier drops it) — mirrors the existing tier-gated assertion pattern already in that test file.

### 6i. AC-8 — production-sequence prompt repoint

Extend the existing mixed spec_gap bundle fixture at `tests/run-task-reroute-preflight.test.ts:926` (`rerouteFromHumanReview preserves <verdict> verdict for exempt failing sibling`) — or add a sibling test right after it — so:

1. The exempt sibling's worktree task dir carries `review-prior-2.md`, `review-prior-10.md` (arbitrary content), and a populated `review.md` holding distinguishable "findings under test" text (e.g. `## Stage 1\n\n- [ ] AC-1: needs work\n`).
2. Run the real `runReroute` over the bundle.
3. In a subprocess `-e` script (extend `runReroute`'s existing seam, or add a sibling helper) that, after calling `rerouteFromHumanReview`, imports `buildPipelineState` and `promptSpecReview`/`promptImplementReroute` from the same `MAIN_URL`/prompts module and prints both rendered prompts to stdout for the parent process to assert on. (Implementation note in spec.md flags this exact approach as acceptable, including "a second subprocess invocation over the same fixture dir" as a valid alternative to one shared process.)
4. Assert, for the exempt sibling's line in each rendered prompt: it names `review-prior-11.md` (the archive the reroute just created, containing the pre-reroute `review.md` content), it does **not** name `review-prior-10.md`, and it does not name the bare `tasks/<id>/review.md` path (match the full path, not a `review\.md` substring, so `review-prior-11.md` can't accidentally satisfy a naive negative check).

### 6j. AC-9 — evidence hole closed

New test:

1. Set up a task (worktree-backed, any tier) with `status='code_review'`, `code_review.status` at a state consistent with a completed review, and a **populated** worktree `review.md` whose trailing verdict is `approved` (plain filled template, no `## Round` heading is fine — this only needs to be a real, non-stub artifact).
2. Reroute it (`runReroute`) — this archives the `approved` `review.md` per the fix.
3. Directly mutate the written worktree `status.json` to move the phase pointer back to `code_review` without any fresh review being written: set `implement.status = 'done'` (and, for a full-tier task, also `spec_review.status = 'done'` and `plan.status = 'done'`) while leaving `code_review.status = 'pending'`/`verdict = ''` — i.e., simulate "implement (and spec_review/plan) finished again, code_review hasn't run yet." Do **not** create any `review.md`.
4. Call `tryEvidenceAdvance(taskId, 'code_review')` — reuse or extend the `runCheckAndRoute`-style subprocess helper already in this file (or add a small sibling `runTryEvidenceAdvance` following the same pattern) since `tryEvidenceAdvance` lives in `main.ts` and this file's convention is to exercise `main.ts` exports via a fresh subprocess rather than importing the module into the test's own process.
5. Assert `advanced === false` and the note indicates the artifact is missing/still-template (not a stale-verdict advance).

Red-first framing: on pre-fix code, step 2 would leave `review.md` on disk with its `approved` verdict intact, so step 4 would return `advanced: true, verdict: 'approved'` — the exact false-advance the AC guards against.

### 6k. AC-10 — archive failure fails closed, two-task bundle, second task fails

New test using a monkey-patched `fs.renameSync` inside the `runReroute` subprocess (extend the `-e` script inline, following the same "arbitrary script in the same process" pattern the harness already uses):

```ts
// inside the -e script, before calling rerouteFromHumanReview:
import fs from 'node:fs';
const originalRename = fs.renameSync;
fs.renameSync = (from, to) => {
    if (String(from).includes('task-b')) throw new Error('EACCES: injected failure for task-b');
    return originalRename(from, to);
};
```

Set up a two-task bundle (`task-a`, `task-b`) both at an admitted reroute phase, each with a populated (non-stub) `review.md` in their worktree copies. Run the reroute. Assert:
- The process exits non-zero and stderr names `task-b` and the injected rename failure.
- Both tasks' `status.json` (worktree copies) are **byte-unchanged** from before the reroute call (read them before and after, compare).
- `task-a`'s `review.md` **was** renamed to `review-prior-1.md` on disk (the completed rename is not undone) and the stderr message reports it as an already-completed archive.

This pins the two-pass ordering (Decision item, AC-10): archive pass 1 fully precedes the status-mutation pass 2, and a mid-pass-1 failure aborts before pass 2 starts for *any* task, not just the failing one.

### 6l. AC-8 static half — `tests/run-task-prompts.test.ts`

Update both existing exempt-line assertion sites (~lines 333-386):

- The `for (const priorVerdict of [...])` block (~354-387): change the fixture at line 369 from `fs.writeFileSync(path.join(exemptDir, 'review.md'), reviewTemplate);` to instead write `review-prior-1.md` with that same content (simulating the post-archive on-disk state a real reroute would leave behind) — **and delete/don't write a `review.md`** at that path, since post-fix a real exempt sibling never has a `review.md` at this point.
- Update the assertion at line 374 — `assert.match(specReviewLine, /review\.md/);` — to `assert.match(specReviewLine, /review-prior-1\.md/);` (rewrite, don't delete, per spec.md AC-8's explicit instruction).
- Update the implement-reroute assertion at line 383 (`assert.match(implementLine, /review\.md/);`) the same way: `assert.match(implementLine, /review-prior-1\.md/);`.
- The other exempt-line test at line 318-352 (`reroute prompts mark reroute_exempt siblings exempt instead of directing them at an Amendment`) uses the **advancing**-verdict exempt branch (`isAdvancingPriorVerdict` true), which names only `handoff.md` and is unchanged — verify it doesn't need edits (it shouldn't, per AC-8's explicit carve-out for the advancing-verdict line).

After these edits, run `UPDATE_GOLDENS=1 npm test` and confirm `tests/run-task-prompts.golden.json` has **no diff** (per the nit resolution above) — if it does, that's a defect to investigate before committing, not something to accept silently.

## Step 7 — Validation

Run in this order, fixing forward on any failure before moving on:

1. `npm run lint`
2. `npm run type-check`
3. `npm test` (full suite)
4. `UPDATE_GOLDENS=1 npm test` only if the golden diff check in 6l needs regenerating — otherwise skip; commit only if `tests/run-task-prompts.golden.json` actually changed (expected: no change, per the nit resolution)
5. `npm run build` — rebuild `dist/orchestrator/run-task.js` and `dist/cli/index.js` (both bundle the new `review-archive.ts` transitively); commit the `dist/` delta
6. `npm run sync-templates:check` — confirms `templates/docs/pipeline-orchestrator.md` mirrors the Step 5 doc edit (the pre-commit hook regenerates it; this just verifies)

## Handoff notes for `handoff.md`

- Affected Files should list `src/orchestrator/review-archive.ts` as **new**, and update the manifest row that named `src/orchestrator/state.ts` in the spec to point at this file instead (per the spec's own escape hatch: "If the implementer instead creates a small dedicated artifact-helpers module, that new file substitutes for this row — update this manifest row at implement time").
- Call out the three nit resolutions (Step 1 numbered list at the top of this plan) explicitly in the handoff's Deviations section — they're spec-review nits, not spec violations, but code_review should see the reasoning rather than infer it.
