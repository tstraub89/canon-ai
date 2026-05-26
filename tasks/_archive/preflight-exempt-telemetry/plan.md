# Implementation Plan: preflight-exempt-telemetry

> Written by: Claude | Implements: `tasks/preflight-exempt-telemetry/spec.md`

## Approach

One-line functional change: widen `HANDOFF_DIFF_EXEMPT_PATHS` in [scripts/run-task/validation.ts:888](scripts/run-task/validation.ts:888) from `new Set([])` to a set containing every `PIPELINE_TELEMETRY_FILES` entry. The diff→handoff loop ([validation.ts:948-953](scripts/run-task/validation.ts:948)) and rename loop ([validation.ts:955-963](scripts/run-task/validation.ts:955)) already consult this set — no control-flow changes. `PIPELINE_TELEMETRY_FILES` is already imported on line 5, no new import. Add two unit tests, regenerate `dist/`, run the validation matrix.

Why this shape vs. alternatives: the spec's *Decision* section already argues this over the implement-baseline-SHA option and the broader PIPELINE_MANAGED_DOCS exemption — narrowest fix that resolves PR #107, with zero loss of catch power (Codex never writes telemetry files).

## Steps

### Step 1: Widen the exemption set + update the comment

Files: `scripts/run-task/validation.ts`

Replace the current declaration at lines 888-901:

```ts
const HANDOFF_DIFF_EXEMPT_PATHS: ReadonlySet<string> = new Set([]);

// Pipeline-owned task artifacts (anything under `tasks/<active-id>/`) never need
// to appear in the handoff Changes table — they describe the implementation,
// they are not part of it. ...
function isPipelineOwnedTaskArtifact(filePath: string, taskIds: readonly string[]): boolean {
    return taskIds.some(id => filePath === `tasks/${id}` || filePath.startsWith(`tasks/${id}/`));
}
```

with:

```ts
// Pipeline telemetry files are written by Claude QA (`done.md` phase) and by
// the orchestrator itself (`pipeline-invocations.md` logging), never by Codex.
// On a fresh implement+code_review cycle this didn't matter — the first
// implement run produced an empty `baseRef...HEAD` for telemetry. Post-reroute,
// the prior cycle's QA commits to these files sit in `baseRef...HEAD` and
// would otherwise demand handoff coverage from Codex's fresh implement run.
// Discovered via gallery_wall PR #107 (2026-05-26) — Codex's round-2 fix
// dutifully added telemetry rows to its Changes table, misattributing QA's
// work to Codex and producing a fossilized handoff. Exempting telemetry here
// keeps the handoff honest. The handoff→diff direction (telemetry listed in
// handoff but absent from diff) is still checked above.
const HANDOFF_DIFF_EXEMPT_PATHS: ReadonlySet<string> = new Set<string>(PIPELINE_TELEMETRY_FILES);

// Pipeline-owned task artifacts (anything under `tasks/<active-id>/`) never need
// to appear in the handoff Changes table — they describe the implementation,
// they are not part of it. ...
function isPipelineOwnedTaskArtifact(filePath: string, taskIds: readonly string[]): boolean {
    return taskIds.some(id => filePath === `tasks/${id}` || filePath.startsWith(`tasks/${id}/`));
}
```

(Keep the existing `isPipelineOwnedTaskArtifact` comment block unchanged — only the comment ABOVE `HANDOFF_DIFF_EXEMPT_PATHS` is being added/replaced.)

Note: `PIPELINE_TELEMETRY_FILES` is typed `readonly [...]` (a tuple-literal `as const`). `new Set<string>(PIPELINE_TELEMETRY_FILES)` widens it to `Set<string>` cleanly.

### Step 2: Add the two unit tests

Files: `tests/run-task-validation.test.ts`

Insert immediately after the existing test at line 925 (`'verifyHandoffAgainstDiffFromData rejects a diff file missing from all handoffs'`, which ends around line 938):

```ts
void test('verifyHandoffAgainstDiffFromData exempts PIPELINE_TELEMETRY_FILES from diff→handoff check', () => {
    // Regression: gallery_wall PR #107 (2026-05-26). Post-reroute, prior-cycle
    // QA commits to telemetry files appeared in `baseRef...HEAD` and triggered
    // diff→handoff failures even though Codex did not write them this cycle.
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: [
                'src/foo.ts',
                'docs/lessons-learned.md',
                'docs/pipeline-invocations.md',
                'docs/task-quality-log.md',
            ],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['src/foo.ts'],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

void test('verifyHandoffAgainstDiffFromData still rejects non-telemetry diff files missing from handoff when telemetry is also present', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: ['docs/lessons-learned.md', 'src/baz.ts'],
            handoffFilesByTask: makeHandoffMap({
                'task-a': [],
            }),
        },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('src/baz.ts'));
    assert.ok(!issues[0].includes('lessons-learned'));
});
```

Use `makeHandoffMap` (defined at line 49) — same helper every other sibling test uses.

### Step 3: Regenerate dist + run validation matrix

Files: `dist/cli/index.js`, `dist/scripts/run-task.js`

Run in order:

```
npm run lint
npm run type-check
npm test
npm run build
npm run docs-refs-check
npm run sync-templates:check
```

`npm run build` (= `tsup` + `scripts/normalize-dist-paths.mjs` postbuild) regenerates both dist files. Commit any dist deltas alongside the source change — CI runs `npm run build && git diff --exit-code -- dist/` (`docs/architecture.md` §Validation, "Full build" row) and fails on stale dist.

## Testing Plan

- **Unit**: two new `void test(...)` blocks in `tests/run-task-validation.test.ts` per Step 2. Patterned on the existing 11 `verifyHandoffAgainstDiffFromData` tests. No mocks, no fixtures — `verifyHandoffAgainstDiffFromData` takes pure data.
- **E2E**: N/A per `docs/architecture.md` (no UI surface).
- **Manual**: per the spec's Human Test Plan — inspect `dist/cli/index.js` for `HANDOFF_DIFF_EXEMPT_PATHS` and confirm it lists the three telemetry paths. Inspect the new comment block in `validation.ts` to confirm the "why" reads cleanly.

## Rollback Plan

Trivial revert. The change is one constant initializer + one comment block + two unit tests + regenerated dist. Reverting restores the empty exemption set and the pre-fix behavior (false-positive on telemetry post-reroute). No data migration; no schema changes; no protocol changes.
