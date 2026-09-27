# Plan: affected-files-preflight-at-code-review

> Spec review verdict: **approved**, no nits. This plan follows the spec's Design table order. Read `tasks/affected-files-preflight-at-code-review/spec.md` in full before starting — this plan assumes it's open alongside.

## Design decisions this plan is making on the spec's behalf

The spec leaves some implementation choices open ("if an existing one doesn't already fit"). Resolve them as follows — don't re-litigate:

1. **AC-2's "pure scope-check function" is the existing `verifyBaseDriftFromData`.** Its signature (`diffFiles, allowedPaths, taskIds, allowedPrefixes) => string[]`) already does exactly what AC-2 describes: take changed paths + an allowlist, return out-of-scope paths, with `tasks/<id>/` exemption built in. Reuse it verbatim at the code_review call site instead of writing a parallel `findOutOfScopeFiles`-style wrapper (patterns.md "route new path through the existing safety queue" / "don't fork a parallel path"). Add AC-2's new test cases (rename-out-of-scope, prefix, managed-doc-admitted) to the existing `verifyBaseDriftFromData` test block.
2. **`src/orchestrator/git.ts` needs no new helper.** `getAffectedFiles(baseRef, cwd)` (three-dot, `-M -z`, already rename-expanding — see `parseNameStatusOutput`) is exactly "the task's rename-aware three-dot changed paths." The spec's Affected Files row for `git.ts` is conditional ("if an existing one... doesn't already fit") — it does fit. Do not touch `git.ts`. (Ironic but real: touching it unnecessarily would itself be an out-of-scope edit under the very gate this task builds.)
3. **`verifyBaseDrift`'s return shape does not change.** AC-1 requires its existing tests keep passing unchanged, and two of them (`tests/run-task-validation.test.ts` lines ~2014 and ~2029) do a full `assert.deepEqual(result, {...})` — any new key breaks them. For AC-8's base-advanced/task-changed split, `commitHumanReviewFiles` in `main.ts` computes its own three-dot task-changed set (via the already-imported `getAffectedFiles`) and calls a new pure classifier directly. `verifyBaseDrift` itself is only refactored internally (its allowlist-building loop calls the new shared builder) — inputs/outputs unchanged.
4. **The normal-run halt writes nothing to `review.md`.** It uses `autoBlockPhase` + `process.exit(2)`, mirroring the existing "all-blocked validation rows" auto_block path's *exit* behavior but not its `writePreflightReviewArtifacts` artifact write (that helper's `ClassifiedBlocker` shape doesn't fit an out-of-scope-file list, and the spec doesn't require a `review.md` write — only that `iterations_current_loop`/`iterations_total`/`preflight_rejections_*` stay unchanged and a human-readable reason exists, which `escalations` + console `warn` already provide). This also keeps AC-4's "renders Round 1" trivially true: nothing touches `review.md`'s `## Stage 1` heading, so `bundleHasRealPriorReview` still returns `false`.
5. **Resume path is `canon task reset-code-review <id>`, not a bare re-run.** `autoBlockPhase` sets `phases.code_review.status = 'blocked'`. Per `src/task/index.ts` `taskResetCodeReview`, resuming from `blocked` requires that command (it's also what the existing infra-blocked-only auto_block path tells the operator to run — see `code-review.ts`'s existing `auto_block` reason string). Mirror that wording in the new halt message and in AC-4's test.
6. **Full-send bundle gate uses `every()`, not `some()`.** `tasks.every(t => t.status.full_send === true)` — matches `spec-review.ts`'s existing `allFullSend` pattern and patterns.md's "Bundle-gate conditions must use every(), not some()" pitfall.
7. **Post-foreman enforcement (AC-6) skips when any task's `review.md` came back template-unfilled.** If the foreman didn't write a real review, the phase is already being reset to `pending` for retry by the existing per-task loop; layering the scope auto-block on top of that would auto-block a task that's actually just retrying.

---

## Step 1 — `src/orchestrator/validation.ts`: shared allowlist builder (AC-1)

Extract the allowlist-construction loop currently inlined in `verifyBaseDrift` (around line 1612-1644) into a standalone exported function, placed just above `verifyBaseDriftFromData` (around line 1524):

```ts
export type AffectedFilesAllowlist = {
    paths: ReadonlySet<string>;
    prefixes: readonly string[];
};

// Shared by verifyBaseDrift (--pr base-drift) and the code_review scope
// pre-flight (runCodeReviewPhase). Both gates must agree on what "in scope"
// means, or the pre-flight could be stricter than --pr and halt valid work
// that would have sailed through later — see spec Known Risks "Stricter than
// --pr". PIPELINE_MANAGED_DOCS admission is the caller's call: --pr admits
// them only once qa.status is done (verifyBaseDrift decides that per-call,
// same as today); the code_review pre-flight always admits them.
export function buildAffectedFilesAllowlist(
    taskIds: readonly string[],
    options: { admitManagedDocs: boolean },
): AffectedFilesAllowlist {
    const paths = new Set<string>(PIPELINE_TELEMETRY_FILES);
    const prefixes: string[] = [];
    for (const taskId of taskIds) {
        const parsed = parseAffectedFilesFromSpec(taskId);
        for (const filePath of parsed.files) {
            // Trailing-slash entries are directory-form scope (e.g., `dist/` covers
            // `dist/cli/index.js`). Kept with the slash so prefix matching is
            // boundary-correct: `dist/` does not accept `dist-other/foo`.
            if (filePath.endsWith('/')) {
                prefixes.push(filePath);
            } else {
                paths.add(filePath);
            }
        }
        for (const malformed of parsed.malformed) {
            warn(`${taskId} spec.md Affected Files row malformed: ${malformed.reason}`);
        }
    }
    if (options.admitManagedDocs) {
        for (const doc of PIPELINE_MANAGED_DOCS) paths.add(doc);
    }
    return { paths, prefixes };
}
```

Then rewrite `verifyBaseDrift` to call it, preserving its exact return shape (`{ drift, fetchFailed, diffFailed, diffError? }` — unchanged):

```ts
export function verifyBaseDrift(
    taskIds: string[],
    baseBranch: string,
    cwd: string,
): { drift: string[]; fetchFailed: boolean; diffFailed: boolean; diffError?: string } {
    const fetchResult = gitSafeAt(cwd, 'fetch', 'origin', baseBranch);
    if (!fetchResult.ok) {
        warn(/* unchanged */);
        return { drift: [], fetchFailed: true, diffFailed: false };
    }

    const driftResult = getTreeDriftFiles(`origin/${baseBranch}`, cwd);
    if (!driftResult.ok) {
        return { drift: [], fetchFailed: false, diffFailed: true, diffError: driftResult.stderr };
    }

    // QA's "Docs Freshness" sweep can promote lessons into PIPELINE_MANAGED_DOCS
    // for any bundle member; once ANY task's qa is done, widen for the whole
    // call (matches today's per-task-add-inside-the-loop behavior).
    let admitManagedDocs = false;
    for (const taskId of taskIds) {
        try {
            if (readStatus(taskId).phases.qa?.status === 'done') { admitManagedDocs = true; break; }
        } catch {
            // Missing/malformed status.json: leave admitManagedDocs as-is —
            // strictly safer than auto-widening on unreadable state.
        }
    }
    const allowlist = buildAffectedFilesAllowlist(taskIds, { admitManagedDocs });

    return {
        drift: verifyBaseDriftFromData(driftResult.files, allowlist.paths, taskIds, allowlist.prefixes),
        fetchFailed: false,
        diffFailed: false,
    };
}
```

Do not change `verifyBaseDriftFromData`'s signature or behavior.

## Step 2 — `src/orchestrator/validation.ts`: base-drift classification (AC-8)

Add a small pure function right after `verifyBaseDriftFromData` (or after `verifyBaseDrift`, either is fine):

```ts
export type BaseDriftClassification = {
    /** Drifted, but this task's own branch never touched it — the base branch advanced. */
    baseAdvanced: string[];
    /** Drifted AND this task's own three-dot diff touched it — a real scope violation. */
    taskChangedOutOfScope: string[];
};

export function classifyBaseDriftFilesFromData(
    driftFiles: readonly string[],
    taskChangedFiles: ReadonlySet<string>,
): BaseDriftClassification {
    const baseAdvanced: string[] = [];
    const taskChangedOutOfScope: string[] = [];
    for (const filePath of driftFiles) {
        if (taskChangedFiles.has(filePath)) {
            taskChangedOutOfScope.push(filePath);
        } else {
            baseAdvanced.push(filePath);
        }
    }
    return { baseAdvanced, taskChangedOutOfScope };
}
```

`driftFiles` here is `verifyBaseDrift`'s existing `.drift` output (already allowlist-filtered); `taskChangedFiles` is the task's own three-dot diff (`getAffectedFiles(baseBranch, cwd)`, computed by the caller — see Step 5). A drifted file the task's own branch changed is a real out-of-scope edit; one it never touched is base advancement.

Export both new functions and the new `AffectedFilesAllowlist` / `BaseDriftClassification` types alongside the existing exports.

## Step 3 — `src/orchestrator/phases/code-review.ts`: scope pre-flight (AC-3, AC-5, AC-6)

### 3a. Imports

Add to the existing `../validation.js` import:
```ts
import {
    classifyPreflightBlockers, isTemplateUnfilled, verifyHandoffAgainstDiff,
    buildAffectedFilesAllowlist, verifyBaseDriftFromData, parseAffectedFilesFromSpec, extractCheckedVerdict,
} from '../validation.js';
```

### 3b. The scope check itself

Insert right after the existing handoff pre-flight block's early-returns (i.e., right after the `return { agent: 'claude', sessionId: null, exitCode: 0 };` at the end of the `if (preflightFailed.length > 0)` block — around current line 315 — and before `const headSha = deps.resolveCommit('HEAD', activeCwd);`):

```ts
// Affected-Files scope pre-flight (issue #46): catch files outside the
// spec's Affected Files before any review agent runs. Reuses the same
// allowlist builder and out-of-scope classifier as the --pr base-drift gate
// (buildAffectedFilesAllowlist / verifyBaseDriftFromData) so this gate is
// never stricter than --pr will be after QA — unlike verifyBaseDrift, it
// always admits PIPELINE_MANAGED_DOCS (spec Decision point 1).
const scopeAllowlist = buildAffectedFilesAllowlist(taskIds, { admitManagedDocs: true });
const outOfScopeFiles = verifyBaseDriftFromData(
    [...changedFiles], scopeAllowlist.paths, taskIds, scopeAllowlist.prefixes,
);
// Bundle-gate rule: full-send must hold for EVERY task, not just one
// (patterns.md "Bundle-gate conditions must use every(), not some()").
const scopeFullSend = tasks.every(t => t.status.full_send === true);

if (outOfScopeFiles.length > 0 && !scopeFullSend) {
    const reason =
        `Code review pre-flight found file(s) outside the spec's Affected Files for task(s) ${taskIds.join(', ')}:\n` +
        outOfScopeFiles.map(f => `  ${f}`).join('\n') + '\n\n' +
        `Human triage required. Fix with either:\n` +
        `  (a) add the file(s) to the spec's '### Affected Files' table (in the task worktree), run ` +
        `\`canon task reset-code-review <id>\` for each bundle task, and re-run \`canon run\`; or\n` +
        `  (b) reroute with a note telling the implementer to remove the file(s).\n` +
        `This halt does not count as a code-review round or a pre-flight rejection — ` +
        `iterations_current_loop, iterations_total, and preflight_rejections_* are unchanged.`;
    warn('Affected-Files scope pre-flight FAILED — halting before Claude review:');
    warn(reason);
    autoBlockPhase(taskIds, 'code_review', codeReviewCheck.count, reason);
    process.exit(2);
}
```

`changedFiles` is the `Set` already built two lines above this insertion point (`const changedFiles = new Set(deps.getAffectedFiles(baseBranch, activeCwd));`) — reuse it, don't recompute.

This must run for **every** invocation (including `resumeId` resumes) since it's a pure pre-flight over current diff state, same as the existing handoff pre-flight above it.

### 3c. Threading the out-of-scope list into the foreman prompt (AC-5)

By the time execution reaches the `promptCodeReview` call, either `outOfScopeFiles` is empty, or it's non-empty **and** `scopeFullSend` is true (otherwise Step 3b already exited). So it's safe to always pass it through unconditionally — change:

```ts
const result = await deps.runClaude(promptCodeReview(state, baseBranch, scopedDiff, coldReview.findings, { ...scope, deltaDiff }), interactive, reviewResumeId, cfg.model, cfg.effort, cfg.budget, {
```
to:
```ts
const result = await deps.runClaude(promptCodeReview(state, baseBranch, scopedDiff, coldReview.findings, { ...scope, deltaDiff }, outOfScopeFiles), interactive, reviewResumeId, cfg.model, cfg.effort, cfg.budget, {
```

### 3d. Post-foreman enforcement (AC-6)

Replace the final loop (currently):
```ts
for (const t of tasks) {
    const reviewPath = path.join(taskDirFor(t.taskId), 'review.md');
    let reviewContent: string | null = null;
    try { reviewContent = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing */ }
    if (isTemplateUnfilled(reviewContent)) {
        warn(`[${t.taskId}] review.md is still the template after code_review run — sub-agent did not write it. Resetting to pending for retry.`);
        taskPhase(t.taskId, 'code_review', 'pending');
    }
}

return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
```
with:
```ts
let anyUnfilled = false;
const reviewContents = new Map<string, string | null>();
for (const t of tasks) {
    const reviewPath = path.join(taskDirFor(t.taskId), 'review.md');
    let reviewContent: string | null = null;
    try { reviewContent = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing */ }
    reviewContents.set(t.taskId, reviewContent);
    if (isTemplateUnfilled(reviewContent)) {
        warn(`[${t.taskId}] review.md is still the template after code_review run — sub-agent did not write it. Resetting to pending for retry.`);
        taskPhase(t.taskId, 'code_review', 'pending');
        anyUnfilled = true;
    }
}

// Full-send out-of-scope enforcement (AC-6): every file the pre-flight
// flagged must now be either amended into some bundle member's Affected
// Files, or covered by a changes_requested verdict this round. Skip while
// any task's review.md is still unfilled — that task is already being
// retried by the loop above.
if (scopeFullSend && outOfScopeFiles.length > 0 && !anyUnfilled) {
    const coveredFiles = new Set<string>();
    for (const t of tasks) {
        for (const filePath of parseAffectedFilesFromSpec(t.taskId).files) coveredFiles.add(filePath);
    }
    const anyChangesRequested = [...reviewContents.values()].some(
        content => content !== null && extractCheckedVerdict(content) === 'changes_requested',
    );
    const unjudged = outOfScopeFiles.filter(f => !coveredFiles.has(f));
    if (unjudged.length > 0 && !anyChangesRequested) {
        const reason =
            `Full-send code review did not judge out-of-scope file(s) for task(s) ${taskIds.join(', ')}: ` +
            `${unjudged.join(', ')}. Each must end up either in some bundle member's spec '### Affected Files' ` +
            `(via an '## Amendment' section) or covered by a 'changes_requested' verdict this round. Human triage required.`;
        warn(reason);
        autoBlockPhase(taskIds, 'code_review', codeReviewCheck.count, reason);
        process.exit(2);
    }
}

return { agent: 'claude', sessionId: result.sessionId, exitCode: result.exitCode };
```

## Step 4 — `src/orchestrator/prompts/index.ts`: thread the out-of-scope list (AC-5)

Add a 6th parameter to `promptCodeReview`:

```ts
export function promptCodeReview(
    state: PipelineState,
    baseBranch?: string,
    scopedDiff: ScopedDiff | null = null,
    coldCodexFindings: string | null = null,
    scopeInfo: CodeReviewScopeForPrompt | null = null,
    outOfScopeFiles: readonly string[] = [],
): string {
```

And add to the `render('code-review-foreman.md', {...})` view object (near the end, alongside `hasColdCodexFindings`):
```ts
hasOutOfScopeFiles: outOfScopeFiles.length > 0,
outOfScopeFilesList: outOfScopeFiles.map(f => `- \`${f}\``).join('\n'),
```

## Step 5 — `src/orchestrator/prompts/templates/code-review-foreman.md`: judgment block (AC-5)

Insert a new section after "## Injected Cold-Codex Findings" and before "## Foreman Protocol":

```markdown
{{#hasOutOfScopeFiles}}
## Full-Send Scope Judgment

The orchestrator found file(s) this task changed that are NOT in the spec's `### Affected Files` table. This is a full-send run, so instead of halting for a human, you must judge each one before writing `review.md`:

{{{outOfScopeFilesList}}}

For each file, decide exactly one outcome:
1. **Appropriate scope expansion** — the file is needed to meet the ACs and fits the spec's intent. Append an `## Amendment` section (or the next round-numbered `## Amendment Round N` if one already exists) to the owning task's `spec.md` with a `### Affected Files` table row for the file, plus a one-line reason naming it a full-send scope expansion.
2. **Spec miss** — the spec should have listed it (e.g. a fixture, a rebuilt artifact the implementer forgot). Same amendment mechanics, with the reason naming it a spec miss.
3. **Should not have been changed** — outside the task's intent, or the implementer had no business making this edit. Do not amend the spec. Write a finding that the file must be reverted or removed, and set this round's verdict to `changes_requested`.

In a bundle, amend whichever member task's spec the file actually serves.

Record every file's outcome and reason in `review.md`. The orchestrator re-checks after your session ends: every file listed above must be present in some bundle member's Affected Files (via your amendment), or the verdict must be `changes_requested`. An unjudged file auto-blocks the phase.
{{/hasOutOfScopeFiles}}

{{^hasOutOfScopeFiles}}
{{/hasOutOfScopeFiles}}
```

(The empty inverted-section stub above is optional cosmetic padding — omit it if the template renderer already collapses cleanly; check `renderTemplate`'s mustache-lite behavior on an absent block before adding filler.)

## Step 6 — `src/orchestrator/main.ts`: split the `--pr` base-drift message (AC-8)

In `commitHumanReviewFiles`, the block currently at (approximately) lines 1224-1252:

```ts
} else if (baseDriftResult.drift.length > 0) {
    if (!cliArgs.force) {
        die(
            `--pr aborted: base-drift detected. Files in the tree diff between origin/${baseBranch}\n` +
            ... (single list + guidance) ...
        );
    }
    warn(
        `--force override: base-drift detected; proceeding at user request. Drifted files:\n` +
        baseDriftResult.drift.map(filePath => `  ${filePath}`).join('\n')
    );
}
```

Replace with a version that classifies before building the message. `splitGit` and `splitValidation` are already imported under those aliases in this file — use them:

```ts
} else if (baseDriftResult.drift.length > 0) {
    const taskChangedFiles = new Set(splitGit.getAffectedFiles(baseBranch, cwd));
    const { baseAdvanced, taskChangedOutOfScope } = splitValidation.classifyBaseDriftFilesFromData(
        baseDriftResult.drift, taskChangedFiles,
    );
    if (!cliArgs.force) {
        const sections: string[] = ['--pr aborted: base-drift detected.'];
        if (baseAdvanced.length > 0) {
            sections.push(
                `\nThe base branch advanced while this task ran. These file(s) changed only on\n` +
                `origin/${baseBranch}, not on this task's branch:\n` +
                baseAdvanced.map(filePath => `  ${filePath}`).join('\n') + `\n` +
                `Fix: merge or rebase the base branch into the task branch, then rerun:\n` +
                `  git fetch origin ${baseBranch} && git rebase origin/${baseBranch}\n` +
                `  (or: git merge origin/${baseBranch})`
            );
        }
        if (taskChangedOutOfScope.length > 0) {
            sections.push(
                `\nThese file(s) were changed by this task but are not in the spec's Affected Files\n` +
                `(and not task-dir/telemetry/managed-docs):\n` +
                taskChangedOutOfScope.map(filePath => `  ${filePath}`).join('\n') + `\n` +
                `The allowlist is: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, files listed in\n` +
                `your spec's '### Affected Files' table (directory-form entries like 'dist/' match\n` +
                `subpaths), and PIPELINE_MANAGED_DOCS (auto-allowlisted once qa.status = done).\n` +
                `If this is a legitimate task change, add the path to spec.md '### Affected Files' and\n` +
                `rerun. For a rename, list BOTH the old and new paths.\n` +
                `Recovery if this is unexpected (cross-pipeline contamination, or a stray task-branch\n` +
                `commit):\n` +
                `  - reset a specific file to base's content:\n` +
                `      git checkout origin/${baseBranch} -- <path> && git commit -m 'revert drift on <path>'\n` +
                `  - revert the offending task-branch commit entirely:\n` +
                `      git revert <sha>`
            );
        }
        sections.push(`\nBypass with --force if you've verified the drift is intentional.`);
        die(sections.join('\n'));
    }
    warn(
        `--force override: base-drift detected; proceeding at user request. Drifted files:\n` +
        baseDriftResult.drift.map(filePath => `  ${filePath}`).join('\n')
    );
}
```

Notes:
- `baseBranch` here is the **local** branch name (matches the existing `getAffectedFiles(baseBranch, activeCwd)` usage pattern in `code-review.ts` — three-dot against the local ref is "what did this branch contribute," which is exactly the task-changed set we need).
- Every file in `baseDriftResult.drift` lands in exactly one of `baseAdvanced` / `taskChangedOutOfScope` — the two sections above are the only two branches; both can render together (spec: "If both kinds are present, both lists are shown").
- The `--force` warn path is unchanged (still lists the full undifferentiated `.drift`) — the spec only requires the message split on the abort path.

## Step 7 — `src/orchestrator/prompts/templates/implement.md`: Scope Discipline wording (AC-9)

Current rule 1 (around line 28):
> 1. **Affected Files is the scope cap.** If satisfying an AC genuinely requires editing files outside the spec's *Affected Files* table, do not make that edit. Record the gap in `handoff.md` under *Blockers* — the handoff is how it reaches a human — then finish the remaining in-scope work, the handoff, and the phase command. Do not silently expand scope.

Append one sentence:
> This includes new helpers, fixtures, and test files you introduce during implementation — they count against the cap the same as any other file; adding one outside Affected Files is scope expansion, not free housekeeping.

## Step 8 — Regenerate goldens (AC-5, AC-9)

Run `UPDATE_GOLDENS=1 npm test` after Steps 4, 5, and 7 land, so `tests/run-task-prompts.golden.json` picks up:
- The implement-prompt wording change (all `implement`/`implement-revisions`/`implement-reroute` golden keys shift slightly).
- A **new** golden key for the foreman prompt with out-of-scope files (add the test first — see Step 9 — then regenerate).

Diff the regenerated golden file before committing: only the implement-prompt keys and the one new foreman key should change. If any *other* key moves, something in Steps 4-5 leaked into an unrelated template path — investigate before committing.

## Step 9 — Tests

### `tests/run-task-validation.test.ts`

Add near the existing `verifyBaseDriftFromData` tests (~line 1948-2005):
- `buildAffectedFilesAllowlist`: Design row, Amendment row, directory prefix, telemetry always-present, `admitManagedDocs: true` includes all `PIPELINE_MANAGED_DOCS`, `admitManagedDocs: false` excludes them, malformed row warns via `captureConsoleError` (mirror the existing `verifyBaseDrift: malformed affected-file rows warn` test's pattern).
- `verifyBaseDriftFromData` (AC-2's new cases, added to the existing block): a rename whose **new** path is out of scope (`parseNameStatusOutput('R100\0old\0new\0')`, allowlist missing `new` → drift includes `new`), a path under an allowed directory prefix, a managed doc present only because it's in the passed-in allowlist (construct the allowlist via `buildAffectedFilesAllowlist(ids, { admitManagedDocs: true })` to prove the code_review call shape works end to end).
- `classifyBaseDriftFilesFromData` (AC-8): all-base-only (`taskChangedFiles` empty, all drift → `baseAdvanced`), all-task (`taskChangedFiles` = full drift set → all `taskChangedOutOfScope`), mixed (some in each), empty drift → both arrays empty.

### `tests/run-task-safety.test.ts` (base-drift message split, AC-8)

Update the existing test **`commitHumanReviewFiles base-drift gate dies when the base branch advanced outside Affected Files`** (currently ~line 6230) — this is the exact repro for the spec's "second false alarm." Strengthen its assertions to be genuinely red-first for this AC:
```ts
assert.match(output, /base branch advanced/);
assert.doesNotMatch(output, /not in the spec's Affected Files/);
```
(keep the existing `base-drift detected`, `docs\/BACKLOG\.md`, and `doesNotMatch(.../src\/orchestrator\/main\.ts\s*$/m)` assertions — they still hold). Verify this test fails on pre-fix code (it will: pre-fix, the single die() message only ever says "not in the spec's Affected Files", never "base branch advanced").

The existing test **`commitHumanReviewFiles base-drift gate dies on drift outside the allowlist`** (~line 6147) uses the shared fake-git harness (`setupFakeGit`'s catch-all `diff` handler returns `FAKE_GIT_DRIFT_FILES` for *any* non-`--cached` diff call, so the new three-dot `getAffectedFiles` call in `commitHumanReviewFiles` will echo the same file back as "task-changed"). This correctly classifies `docs/BACKLOG.md` as `taskChangedOutOfScope` in that test, so its existing assertions (`Affected Files`, `git checkout origin/main -- <path>`, `git revert <sha>`) should keep passing unchanged — confirm this rather than assuming it; if it doesn't, the fake-git catch-all needs no changes (don't touch `setupFakeGit`; this is a fixture-shape fact to verify, not a fixture change).

### `tests/run-task-code-review.test.ts` (AC-3 through AC-7)

Add a `getAffectedFiles` override to the relevant tests' `deps` (the `makeDeps` helper's default is `() => []`; override per-test to `() => ['src/extra-helper.ts']` or similar to simulate an out-of-scope file).

- **AC-3 (normal-run halt)**: `writeTask` a task, override `deps.getAffectedFiles = () => ['src/extra-helper.ts']` (a file `writeTask`'s fixture spec doesn't list — the fixture spec has no `## Design` / `### Affected Files` section at all, so `parseAffectedFilesFromSpec` returns `{ files: [] }` and everything is out-of-scope by default; this is the simplest fixture). Assert: `process.exit(2)` is thrown (mirror the `isProcessExitError` + `process.exit` stub pattern from the "stops the whole bundle before foreman" test), `deps.runColdCodexReview`/`deps.runClaude` were never called (assert `events` doesn't contain `'cold:...'` or `'foreman'`), `readStatus('reject').phases.code_review.status === 'blocked'`, and `iterations_current_loop`/`iterations_total`/`preflight_rejections_current_loop`/`preflight_rejections_total` are all still `0` (unchanged from the fixture's initial values).
- **AC-4 (resume after spec edit)**: after the AC-3 halt, call `taskResetCodeReview(taskId)` (import from `../src/task/index.js`) — mirror `src/task/index.ts`'s guard: this only works because `autoBlockPhase` left `code_review.status === 'blocked'` with `implement.status === 'done'`, which `deriveTopLevelStatus` reports as `code_review`. Then rewrite `spec.md` to include `src/extra-helper.ts` in a `### Affected Files` table (so `parseAffectedFilesFromSpec` returns it), and re-run `runCodeReviewPhase`. Assert the run proceeds past the scope check (cold-Codex and foreman ARE called this time) and `resolveCodeReviewRound(tasks)` (or the rendered prompt) shows Round 1.
- **AC-5 (full-send hand-off)**: same out-of-scope fixture, but set `full_send: true` on the task's status (all bundle members, if testing a bundle). Assert: no `process.exit`, `spec.md`'s bytes are unchanged before `runClaude` is invoked (snapshot `fs.readFileSync(specPath)` inside a stubbed `onClaude` callback, mirroring the existing `onClaude` assertion pattern in "runs cold-Codex before the foreman"), both `runColdCodexReview` and `runClaude` ARE called, and the rendered prompt (assert on the string passed into `runClaude`) contains `Full-Send Scope Judgment` and the file path.
- **AC-6 (post-foreman enforcement)**, three variants, each stubbing `onClaude` to write a specific `review.md` shape before returning:
  - (a) foreman amends: `onClaude` writes `spec.md` with the file added to `### Affected Files` AND writes a filled `review.md` with a `## Stage 1` heading and an `approved` verdict. Assert: no auto-block, function returns normally.
  - (b) foreman sets `changes_requested`: `onClaude` writes a filled `review.md` with verdict `changes_requested` (file NOT added to spec). Assert: no auto-block (the existing routing already sends this to `implement` via the verdict — this test only needs to prove the scope enforcement doesn't ALSO auto-block on top of it).
  - (c) foreman does neither: `onClaude` writes a filled `review.md` with verdict `approved` and does NOT amend `spec.md`. Assert: `process.exit(2)` is thrown, and the escalation reason (read from `status.escalations` or the captured `warn` output) names the specific unjudged file.
- **AC-7 (in-scope diffs unaffected)**: existing tests that don't set `deps.getAffectedFiles` to return anything (default `() => []`) already exercise this path implicitly — confirm they still pass. Add one explicit test: `deps.getAffectedFiles = () => ['src/foo.ts']` where `src/foo.ts` IS the file already in the fixture's `handoff.md` Changes table — this alone doesn't put it in `spec.md`'s Affected Files, so also write a `### Affected Files` table into the fixture's `spec.md` naming `src/foo.ts`. Assert the run proceeds normally (existing pre-flight/format/regression behavior unchanged) with no scope halt.

## Step 10 — `docs/pipeline-orchestrator.md` (+ mirror)

Two insertion points:

1. Near the base-drift paragraph (~line 331, "the base-drift check fetches `origin/<base>`..."): add a paragraph immediately after describing the code_review pre-flight version of this gate:

   > Before `--pr`'s base-drift check ever runs, the `code_review` phase pre-flight runs the same allowlist check against the task's own three-dot diff (`git diff <base>...HEAD`). In a normal run, any file outside the allowlist halts the bundle before any review agent runs — the halt message names the file(s) and gives two fixes: add them to the spec's `### Affected Files` and run `canon task reset-code-review <id>` per bundle task before re-running, or reroute with a note to remove them. This halt does not consume code-review loop budget. In a full-send run (`status.full_send === true` for every bundle member), the pre-flight does not halt; instead it hands the out-of-scope file list to the code-review foreman, which judges each file (scope expansion, spec miss, or revert-and-`changes_requested`) and records an `## Amendment` in `spec.md` when appropriate. The orchestrator re-checks after the foreman's session: an unjudged file auto-blocks the phase.

2. Update the sentence describing the base-drift message (~line 331, "Any diff path outside the spec's `### Affected Files`... is drift and aborts the run."): add a clause noting the message now distinguishes the two causes:

   > ...is drift and aborts the run. The abort message separates the two causes: files the base branch changed that this task never touched are reported as "the base branch advanced" with merge/rebase guidance, while files this task's own three-dot diff touched are reported as "not in the spec's Affected Files" with the existing Affected-Files guidance. Both lists render together when both kinds of drift are present; the gate still aborts in either case.

After editing the root `docs/pipeline-orchestrator.md`, run `npm run sync-templates` to regenerate `templates/docs/pipeline-orchestrator.md` — do not hand-edit the mirror. Verify with `npm run sync-templates:check`.

## Step 11 — Validation

Run in this order (matches the spec's Validation Required):
```bash
npm run lint
npm run type-check
UPDATE_GOLDENS=1 npm test   # regenerate goldens once, review the diff
npm test                    # confirm the suite is green against the committed goldens
npm run build                # dist/orchestrator/run-task.js, dist/cli/index.js if it rewrites
npm run docs-refs-check
npm run sync-templates:check
```

List `dist/orchestrator/run-task.js` (and `dist/cli/index.js` if it changes) in the handoff Changes table per the spec's Affected Files row — these are rebuilt, not hand-edited.

## Handoff notes

- Record in `handoff.md` under AC Coverage that AC-2's "pure scope-check function" and AC-8's "git.ts helper" were satisfied by reuse (Decision points 1-2 above) rather than new code — a reviewer scanning the diff for a new `findOutOfScope*`-named export or a `git.ts` change should not treat their absence as a miss.
- If `renderTemplate`'s mustache-lite implementation doesn't need the empty `{{^hasOutOfScopeFiles}}...{{/hasOutOfScopeFiles}}` stub in Step 5 (check `src/orchestrator/prompts/render.ts` — most inverted-section usage elsewhere in this template omits the empty-else form entirely), drop it; it was included only as a "check before assuming" flag, not a requirement.
