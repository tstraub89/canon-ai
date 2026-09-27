# Plan: code-review-delta-rerounds

> Spec: `tasks/code-review-delta-rerounds/spec.md` | Spec review verdict: approved (no nits, no changes requested)

This plan implements the spec's per-round scope resolver, the delta-scoped cold-Codex/foreman shape, and the numbered cold-Codex archive, in dependency order: low-level git/archive helpers first, then the pure resolver, then prompt plumbing, then the orchestrator wiring that ties them together, then agent/template/docs edits, then tests, then build.

Read `docs/patterns.md` §"Pure Policy + Test Discipline" and §"Use `--name-status`, not `--name-only`" before starting — both are load-bearing here.

---

## Step 1 — `src/orchestrator/git.ts`: generalize path/diff helpers, add ancestry helpers

Today `getAffectedFiles(baseRef, cwd)` (git.ts:418) hardcodes `${baseRef}...HEAD` and `getScopedDiff(baseBranch, cwd, capBytes)` (git.ts:183) hardcodes the same range. Both need a range other than `<x>...HEAD` for the delta/prior-change-set computations, so extract the range from the fixed endpoint:

1. Add `export function getPathsInRange(rangeExpr: string, cwd: string): string[]` — moves the body of `getAffectedFiles` (the `git diff <rangeExpr> --name-status -M -z` call + `parseNameStatusOutput`) behind an arbitrary range string instead of `${baseRef}...HEAD`.
2. Rewrite `getAffectedFiles(baseRef, cwd)` to `return getPathsInRange(\`${baseRef}...HEAD\`, cwd);` — same exported signature and behavior, now backed by the shared primitive. Do not touch `getTreeDriftFiles` (it has its own two-dot semantic and its own tests; leave it as-is).
3. Add a private `capDiff(raw: string, capBytes: number): ScopedDiff` extracting the byte-cap logic currently inline in `getScopedDiff` (the `Buffer.byteLength` check + `truncateUtf8` call).
4. Add `export function getScopedDiffInRange(rangeExpr: string, cwd: string, capBytes = 50_000): ScopedDiff | null` — `git diff <rangeExpr>` + `capDiff`.
5. Rewrite `getScopedDiff(baseBranch, cwd, capBytes)` to `return getScopedDiffInRange(\`${baseBranch}...HEAD\`, cwd, capBytes);`.
6. Add `export function resolveCommit(ref: string, cwd: string): string | null` — `gitSafeAt(cwd, 'rev-parse', '--verify', \`${ref}^{commit}\`)`; return the trimmed stdout on success, `null` on failure (unresolvable ref).
7. Add `export function isAncestorCommit(ancestorRef: string, descendantRef: string, cwd: string): boolean` — `gitSafeAt(cwd, 'merge-base', '--is-ancestor', ancestorRef, descendantRef).ok`.
8. Add `export type DeltaFileStat = { path: string; added: number; deleted: number }` and `export function getDeltaLineStats(prevSha: string, cwd: string): DeltaFileStat[]`:
   - `gitSafeAtRaw(cwd, 'diff', \`${prevSha}..HEAD\`, '--numstat', '--no-renames')` (two-dot; `--no-renames` per the spec's Implementation Notes — it counts a rename as delete+add, which over-counts toward `full`, the accepted safe direction, and avoids the `-z` rename-triplet parsing hazard the spec calls out).
   - Split `result.stdout` on `\n`, skip blank lines, split each line on `\t` into `[addedRaw, deletedRaw, ...pathParts]`, join `pathParts` back with `\t` as the path (numstat paths can theoretically contain tabs; this mirrors the tolerance level of `getUnpushedBaseCommits`, an existing helper with the same shape). `added`/`deleted` are `0` when the raw field is `-` (binary file), else `Number(...)`.
   - On `!result.ok`, return `[]` (fail toward "no delta lines counted," which — combined with an empty path set — will not trip trigger 5; ancestry/existence checks are the actual safety net for a broken git call, not this one).

No behavior change for any existing caller of `getAffectedFiles` or `getScopedDiff` — same signatures, same output. Existing tests for both must still pass unmodified.

---

## Step 2 — `src/orchestrator/review-archive.ts`: cold-Codex archive helpers

Mirror the existing `review-prior-` numeric max+1 pattern (`newestReviewArchiveNumber` / `findNewestReviewArchive`), but for a **new** artifact family with a header, alongside the existing exports (don't touch `archivePriorReview`, `rescaffoldReview`, or the `REVIEW_ARCHIVE_PREFIX` family — those keep governing `review.md` rotation on reroute/reset, per the spec's Non-Goal).

```ts
export const COLD_CODEX_ARCHIVE_PREFIX = 'review-cold-codex-run-';
const COLD_CODEX_ARCHIVE_RE = new RegExp(`^${COLD_CODEX_ARCHIVE_PREFIX}(\\d+)\\.md$`);

export type ColdCodexArchiveHeader = {
    round: number;
    reviewedSha: string;
    scope: 'full' | 'delta';
    base: string;
    reason: string;
};
```

1. `newestColdCodexArchiveNumber(taskDir: string): number` — same `fs.readdirSync` + regex-match + `Math.max` scan as `newestReviewArchiveNumber`, against `COLD_CODEX_ARCHIVE_RE`. (Two independent numeric families in the same directory — `review-prior-N.md` and `review-cold-codex-run-N.md` — never collide because their prefixes differ; each keeps its own counter.)
2. `export function writeColdCodexArchive(taskDir: string, header: ColdCodexArchiveHeader, findings: string): string`:
   - Compute `n = newestColdCodexArchiveNumber(taskDir) + 1`, `name = \`${COLD_CODEX_ARCHIVE_PREFIX}${n}.md\``.
   - Sanitize `header.reason` by replacing any `"` with `'` (it can end up embedding a file path or a number; never a literal double-quote in practice, but the header parser below assumes none).
   - Write `` `<!-- round=${header.round} reviewed_sha=${header.reviewedSha} scope=${header.scope} base=${header.base} reason="${sanitizedReason}" -->\n\n${findings}` `` to `path.join(taskDir, name)`.
   - Return `name`.
3. `export function parseColdCodexArchiveHeader(content: string): ColdCodexArchiveHeader | null` — regex `` /^<!--\s*round=(\d+)\s+reviewed_sha=(\S+)\s+scope=(full|delta)\s+base=(\S+)\s+reason="([^"]*)"\s*-->/ `` against the start of `content`; return `null` on no match, else the typed object (`round: Number(m[1])`).
4. `export function findColdCodexArchiveForRound(taskDir: string, round: number): ColdCodexArchiveHeader | null`:
   - `fs.readdirSync(taskDir)`, filter to `COLD_CODEX_ARCHIVE_RE` matches, for each parse its number and (via `fs.readFileSync` + `parseColdCodexArchiveHeader`) its header.
   - Keep only headers where `header.round === round`.
   - Among those, return the header from the **highest-numbered filename** (not necessarily the only one — a retried round can leave more than one archive claiming the same round number; "newest wins" is what makes the retry-then-succeed case resolve correctly). Return `null` if none match or `taskDir` doesn't exist (wrap `readdirSync` in try/catch returning `null` on `ENOENT`, matching `findNewestReviewArchive`'s tolerance for a missing directory being a valid "no archives yet" state).

---

## Step 3 — `src/lib/pipeline-policy.ts`: pure scope resolver

Add alongside the existing exports, per the "Pure Policy + Test Discipline" pattern — no I/O, no filesystem, all inputs passed in.

```ts
export const CODE_REVIEW_DELTA_LINE_THRESHOLD = 400;

export type CodeReviewPrevRecord = {
    reviewedSha: string;
    exists: boolean;       // resolveCommit(reviewedSha, ...) succeeded
    isAncestor: boolean;   // only meaningful when exists
    equalsHead: boolean;   // only meaningful when exists
} | null;

export type CodeReviewScopeFacts = {
    isRound1: boolean;
    effectiveSize: TaskSize;
    delicate: boolean;              // for reason wording only — effectiveSize alone can't distinguish nominal-XL from delicate-promoted-XL
    baseBranch: string;
    prevRecord: CodeReviewPrevRecord;
    deltaPaths: readonly string[];          // rename-aware paths in <prevSHA>..HEAD, UNFILTERED (may include tasks/<id>/ and telemetry paths)
    priorChangeSetPaths: readonly string[]; // rename-aware paths in <baseBranch>...<prevSHA>, UNFILTERED
    deltaFileStats: readonly { path: string; added: number; deleted: number }[]; // UNFILTERED
    taskIds: readonly string[];
    telemetryFiles: readonly string[];
};

export type CodeReviewScope = {
    scope: 'full' | 'delta';
    base: string;   // baseBranch on full, prevRecord.reviewedSha on delta
    reason: string; // human-readable; one of the trigger reasons below, or 'delta'
};

export function resolveCodeReviewScope(facts: CodeReviewScopeFacts): CodeReviewScope
```

Implementation:

1. A private `isOwnedPath(filePath, taskIds, telemetryFiles)`: `taskIds.some(id => filePath === \`tasks/${id}\` || filePath.startsWith(\`tasks/${id}/\`)) || telemetryFiles.includes(filePath)`. (This is the same predicate as `isPipelineOwnedPath` in `main.ts` / `isPipelineOwnedDirtyPath` in `git.ts` — do **not** import either of those into this module; `src/lib/` must stay independent of `src/orchestrator/`. This is a deliberate, small, accepted duplication — 2 lines, already duplicated twice in the codebase before this task. Flag it in `notes.md` as a candidate for a future consolidation task; do not attempt that consolidation here.)
2. Trigger order (first match wins):
   - `facts.isRound1` → `{ scope: 'full', base: facts.baseBranch, reason: 'Round 1 (initial review)' }`.
   - `facts.effectiveSize === 'XL'` → `{ scope: 'full', base: facts.baseBranch, reason: facts.delicate ? 'delicate' : 'XL task size' }`.
   - `facts.prevRecord === null` → reason `'no cold-Codex archive record for the previous round'`.
   - `!facts.prevRecord.exists` → reason `` `previous reviewed commit ${facts.prevRecord.reviewedSha} does not resolve` ``.
   - `!facts.prevRecord.isAncestor` → reason `` `previous reviewed commit ${facts.prevRecord.reviewedSha} is not an ancestor of HEAD` ``.
   - `facts.prevRecord.equalsHead` → reason `'previous reviewed commit equals HEAD'`.
   - (all four `prevRecord`-derived branches return `{ scope: 'full', base: facts.baseBranch, reason }`.)
   - Filter `deltaPaths` and `priorChangeSetPaths` through `isOwnedPath` (drop owned paths from both sets). If any filtered `deltaPaths` entry is not in the filtered `priorChangeSetPaths` set → `{ scope: 'full', base: facts.baseBranch, reason: \`${path} is outside the previous round's change set\` }` (first offending path found; deterministic — iterate `deltaPaths` in its given order).
   - Filter `deltaFileStats` to drop entries whose `path` is owned; sum `added + deleted` over the rest. If `sum > CODE_REVIEW_DELTA_LINE_THRESHOLD` → `{ scope: 'full', base: facts.baseBranch, reason: \`delta line count ${sum} exceeds ${CODE_REVIEW_DELTA_LINE_THRESHOLD}\` }`.
   - Else → `{ scope: 'delta', base: facts.prevRecord.reviewedSha, reason: 'delta' }`.

Note `facts.prevRecord` is non-null by construction once control reaches the path/line checks (all four null/invalid branches already returned) — narrow with a non-null assertion or an early-return pattern that lets TypeScript infer it.

### Tests — `tests/pipeline-policy.test.ts` (AC-1)

Add a new `describe`-less block of `void test(...)` rows (matching the file's existing flat style) importing `resolveCodeReviewScope`, `CODE_REVIEW_DELTA_LINE_THRESHOLD`, and the fact/scope types. One row per trigger, all with synthetic facts (no real git):

- Round 1 → `full`, reason matches `/Round 1/`.
- `effectiveSize: 'XL', delicate: false` → `full`, reason `'XL task size'`.
- `effectiveSize: 'XL', delicate: true` → `full`, reason `'delicate'`.
- `prevRecord: null` → `full`, reason matches `/no cold-Codex archive record/`.
- `prevRecord: { reviewedSha: 'deadbeef', exists: false, ... }` → `full`, reason matches `/does not resolve/`.
- `prevRecord: { exists: true, isAncestor: false, ... }` → `full`, reason matches `/not an ancestor/`.
- `prevRecord: { exists: true, isAncestor: true, equalsHead: true }` → `full`, reason matches `/equals HEAD/`.
- Trigger 4: `deltaPaths: ['src/a.ts']`, `priorChangeSetPaths: ['src/b.ts']` → `full`, reason matches `/outside the previous round's change set/`.
- Trigger 4 exclusion row: `deltaPaths: ['tasks/my-task/handoff.md', 'docs/lessons-learned.md']` (a task-artifact path and a telemetry path, neither in `priorChangeSetPaths`), `taskIds: ['my-task']`, `telemetryFiles: ['docs/lessons-learned.md']` → **`delta`** (both excluded, so trigger 4 doesn't fire) — this is the AC-1 exclusion row.
- Trigger 5 boundary: `deltaFileStats` summing to exactly `400` → `delta`; summing to `401` → `full`, reason matches `/exceeds 400/`.
- Trigger 5 exclusion: a `deltaFileStats` entry whose `path` is a task-artifact path and whose added+deleted alone would exceed 400, plus real code lines under 400 → `delta` (the task-artifact lines don't count).
- A clean `delta` row with none of the triggers firing → `{ scope: 'delta', base: <reviewedSha> }`.

---

## Step 4 — `src/orchestrator/prompts/index.ts`: shared round definition + scope-aware `promptCodeReview`

1. Export the round definition so the runner uses the identical values `promptCodeReview` renders (AC-2):

```ts
export function resolveCodeReviewRound(tasks: readonly TaskContext[]): { isRound1: boolean; roundN: number; maxIter: number } {
    const rawMaxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
    const maxIter = bundleHasRealPriorReview(tasks.map(t => t.taskId)) ? rawMaxIter : 0;
    return { isRound1: maxIter === 0, roundN: maxIter + 1, maxIter };
}
```

   Replace the inline `rawMaxIter`/`maxIter`/`isRound1`/`roundN` computation at the top of `promptCodeReview` (index.ts:487-494) with a call to `resolveCodeReviewRound(tasks)` — same values, single source of truth. `bundleHasRealPriorReview` stays private (only `resolveCodeReviewRound` needs to call it).

2. Add a scope parameter to `promptCodeReview`:

```ts
export type CodeReviewScopeForPrompt = {
    scope: 'full' | 'delta';
    base: string;
    reason: string;
    deltaDiff: ScopedDiff | null; // only meaningful when scope === 'delta'
};

export function promptCodeReview(
    state: PipelineState,
    baseBranch?: string,
    scopedDiff: ScopedDiff | null = null,
    coldCodexFindings: string | null = null,
    scopeInfo: CodeReviewScopeForPrompt | null = null,
): string
```

   Inside, after the existing `isRound1`/`roundN` block:

```ts
const isDeltaScope = scopeInfo?.scope === 'delta';
const scopeWord = scopeInfo?.scope === 'delta' ? 'Delta' : 'Full';
const scopeBaseOut = scopeInfo?.base ?? resolvedBaseBranch;
const scopeReasonOut = scopeInfo?.reason ?? 'Round 1 (initial review)';
// On a delta round, suppress the inline full diff (anchored lens retrieves it
// by command instead) so the prompt injects the — much smaller — delta diff
// in its place, per the spec's budget note.
const effectiveScopedDiff = isDeltaScope ? null : scopedDiff;
const hasDiff = effectiveScopedDiff !== null;
```

   (Replace the existing `const hasDiff = scopedDiff !== null;` line and the `diffView` block's use of `scopedDiff` with `effectiveScopedDiff`.)

   Add a delta-diff view:

```ts
const deltaDiff = isDeltaScope ? scopeInfo!.deltaDiff : null;
const deltaDiffView = {
    isDeltaScope,
    deltaBase: scopeInfo?.base ?? '',
    deltaDiffContent: deltaDiff?.diff ?? '',
    deltaDiffTruncated: deltaDiff?.truncated ?? false,
    deltaReason: scopeReasonOut,
};
```

   Pass `scopeWord`, `scopeBaseOut` (as `scopeBase`), `scopeReasonOut` (as `scopeReason`), and `...deltaDiffView` into the `render('code-review-foreman.md', { ... })` call alongside the existing fields.

3. No change to `promptQa` or any other prompt builder.

---

## Step 5 — `src/orchestrator/prompts/templates/code-review-foreman.md`: scope line + delta instructions

This template is **not** in `CANON_OWNED` (only `.claude/agents/*.md` and `.canon/templates/*` are) — no `templates/` mirror needed for this file.

1. In the **Spawn Claude Lenses** section, replace the cold-Claude lens bullet:

```
**Cold-Claude lens** (`subagent_type: code-review-cold`)
{{#isDeltaScope}}
- This round is delta-scoped ({{{deltaReason}}}). Give it the delta diff shown below (`{{{deltaBase}}}..HEAD`) and the delta base ref only — not the full task diff.
{{/isDeltaScope}}
{{^isDeltaScope}}
- Give it the full diff and base ref only.
{{/isDeltaScope}}
- Do not give it `spec.md`, ACs, handoff rationale, canon docs, known risks, or your anchored-lens prompt.
- If it needs to inspect files for truncated diff context, constrain it to changed files only and preserve the spec-blind framing.
- It returns structured findings to you. It must not write `review.md` or run `canon task phase`.
```

2. Add a new block immediately after the existing `{{#hasDiff}}...{{/hasDiff}}` / `{{^hasDiff}}...{{/hasDiff}}` diff block (which, on a delta round, now renders its `{{^hasDiff}}` branch — "Retrieve the task diff with `git diff {{{baseBranch}}}...HEAD`" — since `hasDiff` is false when `isDeltaScope` is true; that sentence is exactly the anchored lens's retrieval instruction, so no wording change needed there):

```
{{#isDeltaScope}}
Delta diff (`{{{deltaBase}}}..HEAD`) — this is what the cold-Claude lens should review, not the full diff above:

```diff
{{{deltaDiffContent}}}
```
{{#deltaDiffTruncated}}
> Delta diff truncated at 50 000 bytes. Give the cold-Claude lens the visible delta first; for the omitted remainder, direct it to `git diff {{{deltaBase}}}..HEAD` directly.
{{/deltaDiffTruncated}}
{{/isDeltaScope}}
```

3. Add one scope line, rendered on every round (not just delta), right after the `{{#isRound1}}...{{/isRound1}}` / `{{^isRound1}}...{{/isRound1}}` round-banner block:

```
**Scope:** {{{scopeWord}}} — base `{{{scopeBase}}}` — reason: {{{scopeReason}}}
```

4. In the **"4. Write `review.md`"** section, add one sentence right after "Round 1 fills the existing template structure directly...":

```
Every round — the Round 1 body and each `## Round N` section — includes one scope line near the top: `**Scope:** {{{scopeWord}}} — base \`{{{scopeBase}}}\` — reason: {{{scopeReason}}}`. This is the human-readable record; the orchestrator's own numbered cold-Codex archive header is the machine-readable one.
```

For a **full** round, the only rendered difference from today's prompt is the new scope line in two places (round banner area, and the review.md-writing instruction) — `{{#isDeltaScope}}` blocks are false and render nothing, and the diff/lens-instruction sections are byte-identical to today. This is what makes AC-7's "existing goldens differ only by the scope line" true.

---

## Step 6 — `src/orchestrator/phases/code-review.ts`: wire it together

This is the integration step. Extend `CodeReviewPhaseDeps` and `defaultDeps` with the new git/policy/archive functions (`getEffectiveSize` from `../policy.js`; `resolveCommit`, `isAncestorCommit`, `getPathsInRange`, `getDeltaLineStats`, `getScopedDiffInRange` from `../git.js`; `findColdCodexArchiveForRound`, `writeColdCodexArchive` from `../review-archive.js`). Import `resolveCodeReviewScope`, `CODE_REVIEW_DELTA_LINE_THRESHOLD` from `../../lib/pipeline-policy.js`, `resolveCodeReviewRound` from `../prompts/index.js`, and `PIPELINE_TELEMETRY_FILES` from `../worktree.js`.

Insert the scope-resolution block **after** the existing pre-flight rejection handling (the pre-flight path already `return`s before this point) and **before** the `runColdCodexReview` call:

```ts
const { isRound1, roundN } = resolveCodeReviewRound(tasks); // AC-2: same values promptCodeReview renders
const effectiveSize = deps.getEffectiveSize(tasks);
const delicate = tasks.some(t => t.status.delicate ?? false);

let scope: CodeReviewScope;
let deltaDiff: ScopedDiff | null = null;

if (isRound1) {
    scope = { scope: 'full', base: baseBranch, reason: 'Round 1 (initial review)' };
} else if (effectiveSize === 'XL') {
    scope = { scope: 'full', base: baseBranch, reason: delicate ? 'delicate' : 'XL task size' };
} else {
    // Per-member lookup for the previous round's archived record. Bundle rule:
    // ALL members must have a record AND agree on the reviewed SHA, or the
    // round is full (see docs/patterns.md "Bundle-gate conditions must use
    // every(), not some()").
    const perMemberRecords = tasks.map(t =>
        deps.findColdCodexArchiveForRound(taskDirFor(t.taskId), roundN - 1),
    );
    const allPresent = perMemberRecords.every((r): r is NonNullable<typeof r> => r !== null);
    const allAgree = allPresent && perMemberRecords.every(r => r!.reviewedSha === perMemberRecords[0]!.reviewedSha);

    let prevRecord: CodeReviewPrevRecord = null;
    if (allAgree) {
        const reviewedSha = perMemberRecords[0]!.reviewedSha;
        const resolved = deps.resolveCommit(reviewedSha, activeCwd);
        const exists = resolved !== null;
        const isAnc = exists && deps.isAncestorCommit(reviewedSha, 'HEAD', activeCwd);
        const head = deps.resolveCommit('HEAD', activeCwd);
        const equalsHead = exists && head !== null && resolved === head;
        prevRecord = { reviewedSha, exists, isAncestor: isAnc, equalsHead };
    }

    const deltaPaths = prevRecord?.exists
        ? deps.getPathsInRange(`${prevRecord.reviewedSha}..HEAD`, activeCwd)
        : [];
    const priorChangeSetPaths = prevRecord?.exists
        ? deps.getPathsInRange(`${baseBranch}...${prevRecord.reviewedSha}`, activeCwd)
        : [];
    const deltaFileStats = prevRecord?.exists
        ? deps.getDeltaLineStats(prevRecord.reviewedSha, activeCwd)
        : [];

    scope = resolveCodeReviewScope({
        isRound1: false,
        effectiveSize,
        delicate,
        baseBranch,
        prevRecord,
        deltaPaths,
        priorChangeSetPaths,
        deltaFileStats,
        taskIds,
        telemetryFiles: PIPELINE_TELEMETRY_FILES,
    });

    if (scope.scope === 'delta') {
        deltaDiff = deps.getScopedDiffInRange(`${scope.base}..HEAD`, activeCwd);
    }
}
```

Then:

1. Change the `runColdCodexReview` call site to use `scope.base` instead of `baseBranch`:

```ts
const coldReview = await deps.runColdCodexReview(scope.base, coldCfg.model, coldCfg.effort, activeCwd, { ... });
```

2. After the existing `review-cold-codex.md` write loop (keep it exactly as-is — verbatim latest-round content, AC-3's "unchanged role" requirement) and only when `coldReview.success` (a failed cold review already `process.exit(1)`s before this point, so no archive is written on failure — satisfies AC-3's "failed cold-Codex runs write no archive"), write the numbered archive to every member:

```ts
const headSha = deps.resolveCommit('HEAD', activeCwd) ?? 'HEAD';
for (const t of tasks) {
    deps.writeColdCodexArchive(taskDirFor(t.taskId), {
        round: roundN,
        reviewedSha: headSha,
        scope: scope.scope,
        base: scope.base,
        reason: scope.reason,
    }, coldReview.findings);
}
```

   (The pre-flight-rejection early return already happens before this whole block, so "pre-flight-rejected invocations write no archive" is automatic — no extra guard needed.)

3. Pass scope info into `promptCodeReview`:

```ts
const result = await deps.runClaude(
    promptCodeReview(state, baseBranch, scopedDiff, coldReview.findings, {
        scope: scope.scope,
        base: scope.base,
        reason: scope.reason,
        deltaDiff,
    }),
    interactive, reviewResumeId, cfg.model, cfg.effort, cfg.budget,
    { taskId: taskIds.join('+'), phase: 'code_review', iteration: maxIter, activeCwd },
    activeCwd,
);
```

   (`scopedDiff` is still computed exactly as today via `deps.getScopedDiff(baseBranch, activeCwd)` — unchanged; `promptCodeReview` itself decides whether to render it inline based on `scope.scope`, per Step 4.)

4. Leave the existing `maxIter` (from `t.iterations_current_loop`, used for resume-ID selection and the `info()` log line) untouched — that's a different concern (resume plumbing) than the round number now shared with the prompt, per the spec's Interaction Dependencies note ("resume behavior is unchanged").

### Tests — `tests/run-task-code-review.test.ts` (AC-2 through AC-6, AC-14)

The file already uses `CodeReviewPhaseDeps` dependency injection with stub functions (see the existing `getAffectedFiles: () => []` / `getScopedDiff: () => ({...})` stubs around line 254) — extend that pattern for the new deps. Add:

- **AC-3(a)**: two successive `runCodeReviewPhase` calls (round 1 then round 2, driven by bumping `iterations_current_loop` and writing a real `## Stage 1` into `review.md` between calls so `bundleHasRealPriorReview` sees a real prior round) produce `review-cold-codex-run-1.md` and `review-cold-codex-run-2.md` in the task dir, with headers whose `round` fields are `1` and `2` respectively and whose `reviewed_sha` differs if HEAD moved.
- **AC-3(b)**: pre-seed the task dir with `review-cold-codex-run-1.md`, `-2.md`, `-10.md`, run one more round, assert the new file is `review-cold-codex-run-11.md`.
- **AC-3(c)**: a fixture with an unmet handoff/diff mismatch (pre-flight rejection path) produces no new `review-cold-codex-run-*.md` file.
- **AC-3(d)**: a two-task bundle produces byte-identical `review-cold-codex-run-N.md` content in both task dirs.
- **AC-4**: stub `runColdCodexReview` to capture its first argument; assert it equals `baseBranch` on a round-1 (full) invocation and equals the previous round's `reviewed_sha` on a round-2 delta invocation (seed a `review-cold-codex-run-1.md` with a `full` header and a real, resolvable-in-the-fixture SHA — see the real-git note below).
- **AC-5** (needs real git, since ancestry/equality checks are real subprocess calls): use `initGitRepo`-style setup (see `tests/run-task-reroute-preflight.test.ts:32`) to build a tiny repo with a `main` branch, a task-branch commit A (round 1's reviewed SHA), and a later commit B (HEAD). Do **not** stub `resolveCommit`/`isAncestorCommit`/`getPathsInRange`/`getDeltaLineStats` in these tests — use the real `git.ts` exports against the fixture repo, only stubbing the agent-invocation deps (`runColdCodexReview`, `runClaude`). Cases:
  - Normal delta: commit A archived as round 1 (`full`), commit B is a small edit on top → round 2 resolves `delta` with `base` = A's SHA.
  - Retried round: seed *two* archives both claiming round 1 with different SHAs (simulating a crash-then-retry), plus a genuine round-2 attempt — assert the lookup uses the round-1 archive with the higher file number (the "completed" one), not round 2's own aborted archive.
  - Non-ancestor: rewrite the task branch (`git commit --amend` or a hard reset + new commit) so the round-1 archived SHA is no longer an ancestor of HEAD → round 2 resolves `full` with a reason matching `/not an ancestor/`.
  - `prevSHA == HEAD`: run round 2 with no new commits since round 1 → `full`, reason matches `/equals HEAD/`.
- **AC-6**: on a delta round, assert `runColdCodexReview` was still called (not skipped) and that `promptCodeReview`'s rendered output (call it directly, or capture the prompt passed to `runClaude`) still contains both `subagent_type: code-review-anchored` and `subagent_type: code-review-cold`.
- **AC-14**: real-git fixture — on `main`, create files `X` and `Y` with distinct content; branch off, commit 1 (round 1's reviewed SHA) deletes `Y`; commit 2 does `git mv X Y` (a real rename, since content differs, is detected by `-M`). Assert round 2 resolves `full` with a reason matching `/outside the previous round's change set/`. Add a comment in the test noting that building `deltaPaths` from `--name-only` instead of `--name-status` would produce `['Y']` only (which *is* in the prior change set, since prior deleted `Y`) and would wrongly resolve `delta` — this is the regression the test pins.

---

## Step 7 — `.claude/agents/code-review-cold.md`: sibling-site sweep instruction (AC-9)

Add one paragraph after the existing "Diff-local pattern" paragraph (between it and "Report every issue you find..."):

```
**Sibling-site sweep**: when the diff adds or changes a guard, check, or invariant, search the rest of the repository — not just the diff — for other call sites that need the same treatment, and report any missing ones as findings. This is a repository search, not a spec lookup: stay spec-blind. Do not read `spec.md`, `handoff.md`, `review.md`, canon docs, task notes, or acceptance criteria to decide what counts as a sibling site — go by the pattern visible in the diff itself.
```

Keep every existing prohibition (no spec/handoff/review/canon-docs/notes/ACs) verbatim — this is additive only. This file is `CANON_OWNED`; after editing, run `npm run sync-templates` so `templates/.claude/agents/code-review-cold.md` regenerates as a byte-identical mirror (or let the pre-commit hook do it — verify with `npm run sync-templates:check` either way). Declare both the root file and its `templates/` mirror in the handoff Changes table (per `docs/patterns.md` §"Declare `templates/` mirrors... in BOTH the spec Affected Files and the handoff Changes table" — the spec already lists both rows).

### Tests — `tests/run-task-prompts.test.ts` (AC-9)

Find the existing structural assertions over `.claude/agents/code-review-cold.md` (the file's existing spec-blind-prohibition checks) and add one more: `assert.match(cold, /[Ss]ibling.site sweep/)` (or similar) confirming the new instruction is present, without weakening any existing `assert.doesNotMatch` prohibition check in that block.

---

## Step 8 — `.canon/templates/review.md`: scope line in the expected-shape comment (AC-8)

In the Round 1 body, add the scope line placeholder right after the intro paragraph (before "## Stage 1"):

```
**Scope:** Full — base `<baseBranch>` — reason: Round 1 (initial review)
```

In the trailing `<!-- ... -->` comment block showing the `## Round N` expected shape (review.md:90-128), add the same line right after the `## Round N` heading, before `### Stage 1`:

```
**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">
```

This file is `CANON_OWNED` — same sync/declare requirements as Step 7 (`templates/.canon/templates/review.md` mirror).

---

## Step 9 — `scripts/docs-refs-check.mjs`: exempt numbered cold-Codex archives (AC-10)

In `isNoisySourceFile` (line 512), add one alternative to the existing regex disjunction:

```js
return (
    relPath === 'docs/BACKLOG.md' ||
    /(?:^|\/)templates\/(?:.*\/)?(spec|plan|notes|spec-review)\.md$/.test(relPath) ||
    /^tasks\/[^/]+\/(spec|plan|notes|spec-review)\.md$/.test(relPath) ||
    /^tasks\/[^/]+\/review-cold-codex-run-\d+\.md$/.test(relPath)
);
```

No `templates/` alternative needed for the archive pattern itself — archive files are runtime task artifacts, not scaffolded templates, and never appear under `templates/`. This file is `CANON_OWNED` — sync `templates/scripts/docs-refs-check.mjs` same as Steps 7-8.

### Tests — `tests/docs-refs-check.test.ts` (AC-10)

Follow the existing `makeTempRepo` + `writeFile` + `runChecks(root)` pattern (see `tests/docs-refs-check.test.ts:55-83`):

- Positive (exempted): `writeFile(root, 'tasks/foo/review-cold-codex-run-1.md', 'See \`scripts/nonexistent-target.ts\`.\n')` with no corresponding target file → `assert.deepEqual(runChecks(root), [])`.
- Negative (still checked): the identical broken ref inside `tasks/foo/review.md` instead → `runChecks(root)` still reports the missing-file finding (mirrors the existing "missing path fails" test at line 67, just under the `tasks/<id>/review.md` path instead of a `docs/` path — confirm `review.md` is inside a `markdownRootDirs` root the checker scans; `tasks/` should already be covered since `handoff.md`/`review.md` refs are explicitly called out as non-exempt in the file's own comment block around line 499).

---

## Step 10 — Docs

### `docs/decisions.md` (AC-11)

Add a new entry after the existing "Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" entry (decisions.md:344-356), superseding its `--base <baseBranch>` clause:

```markdown
---

## Per-round code-review scope: full vs. delta, with a numbered cold-Codex archive (2026-09)

**Decision**: Each `code_review` round resolves a scope — `full` or `delta` — via a pure resolver (`resolveCodeReviewScope` in `src/lib/pipeline-policy.ts`). A round is `full` when it is Round 1, the effective task size is XL (nominal or delicate), no usable previous cold-Codex archive record exists for round N−1, the delta touches a file outside the previous round's change set, or the delta exceeds a line threshold (`CODE_REVIEW_DELTA_LINE_THRESHOLD`, initially 400). Otherwise the round is `delta`: cold-Codex runs `--base <prevSHA>` instead of `--base <baseBranch>`, and the foreman directs the cold-Claude lens to review only `<prevSHA>..HEAD` while the anchored lens keeps the full diff, spec, handoff, and prior review. No lens is ever skipped.

Each round that obtains cold-Codex findings writes a new numbered archive (`tasks/<id>/review-cold-codex-run-N.md`, numbered by the same max+1 scan as `review-prior-N.md`) with a header recording the round, reviewed HEAD SHA, scope, base, and reason. `review-cold-codex.md` is unchanged — it still holds the latest round's verbatim findings.

**Supersedes**: The `--base <baseBranch>` clause of "Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" above — the base is now round-scope-dependent. The sequential-execution and hard-fail-on-no-findings rules from that entry are unchanged.

**Why**: Archive analysis of 72 multi-round three-lens tasks found later-round cold-lens findings split roughly evenly between real bugs inside the fix delta (the two cold lenses' actual unique value on a re-round) and nits/dismissed repeats from re-reviewing the whole diff from scratch every round. Scoping re-rounds to the delta keeps the two cold lenses reviewing what they're actually good at catching on a re-round, without dropping either lens or round 1's full-diff coverage.

**Rule**: Do not widen the `delta` scope trigger set without new archive-analysis evidence of an escape. `docs/pipeline-orchestrator.md` §"Code Review Diff Injection" and §"Per-Iteration Prompt Slimming" carry the mechanics.

---
```

### `docs/pipeline-orchestrator.md` (AC-11)

- §"Code Review Diff Injection" (pipeline-orchestrator.md:413-419): after the first paragraph, add a paragraph describing scope resolution — the trigger list (round 1, XL/delicate, no usable previous record, out-of-scope file, line threshold), that `--base` becomes `<prevSHA>` on a delta round, and that `review-cold-codex-run-N.md` archives every round's findings with a header (round, reviewed SHA, scope, base, reason) while `review-cold-codex.md` keeps holding only the latest round's verbatim text.
- §"Per-Iteration Prompt Slimming" (pipeline-orchestrator.md:421-458): the "Code review's slim shape" code block (lines 432-448) is stale — the actual template is the mustache-driven `code-review-foreman.md`, not the freeform pseudo-prompt shown there. Replace that block with an accurate summary: round 2+ still spawns both Claude lenses and re-obtains cold-Codex findings from scratch every round (unchanged); on a `delta` round the foreman prompt additionally states the scope/base/reason, gives the cold-Claude lens only the delta diff, and points the anchored lens at retrieving the full diff by command instead of inline (to stay within the prompt's byte budget) rather than re-injecting both diffs. Keep the surrounding "Cumulative artifacts," "Round-3+ tightening," "Anchor markers," "Session-neutral by design," and "Implementation note" subsections as-is — none of them are about the diff-injection mechanics this replaces.

This file is `CANON_OWNED` — sync `templates/docs/pipeline-orchestrator.md`.

### `docs/codebase-map.md` (optional, per spec's Docs Impact)

Add a line under the existing "Git plumbing and porcelain parsing" / "Pure routing policy" rows noting the new archive helpers live in `src/orchestrator/review-archive.ts` (extending the existing `review-prior-` row if one exists, or adding a new row) — check the file for whether `review-archive.ts` already has a Trigger-Table-style row before adding a duplicate.

### `docs/product-context.md` (optional, per spec's Docs Impact)

The spec's Docs Impact section estimated `review-cold-codex.md` was named around lines ~38 and ~128 of this file; a direct grep found no such occurrence at the time this plan was written, so treat that as a stale estimate rather than a location to edit blindly — grep `docs/product-context.md` for `cold-codex` / `cold-Codex` at implementation time and add one sentence there only if the file already documents `review.md`'s round-by-round shape and the new archive fits naturally alongside it. If it doesn't currently mention `review-cold-codex.md` at all, skip this file — it's marked "may need" in the spec, not required.

---

## Step 11 — Regenerate goldens, run validation

1. `npm run build` (rebuild `dist/`; commit the result — AC-13 requires committed `dist/` to match a fresh build).
2. `npm run lint`
3. `npm run type-check`
4. `UPDATE_GOLDENS=1 npm test` once to regenerate `tests/run-task-prompts.golden.json` for the changed `promptCodeReview` output (new scope line in existing round-1/round-N golden keys, per AC-7) and add the new delta-round golden key (construct a fixture task state that resolves to a `delta` scope and snapshot its rendered foreman prompt).
5. `npm test` (plain run) to confirm the regenerated goldens are now stable and every other test still passes.
6. `npm run docs-refs-check`
7. `npm run sync-templates:check`

Check the golden diff for the round-1/round-N keys by hand before committing: per AC-7, the only change should be the added scope line(s) — if anything else moved, a template edit leaked outside the intended conditional blocks.

---

## Notes for `notes.md`

Append (prefix `[plan]`): the `isOwnedPath` predicate in the new resolver duplicates `isPipelineOwnedPath` (`src/orchestrator/main.ts`) and `isPipelineOwnedDirtyPath` (`src/orchestrator/git.ts`) — three near-identical implementations of the same tasks/-prefix-or-telemetry-file check now exist. Consolidating them would require either moving the shared list into `src/lib/` (currently `PIPELINE_TELEMETRY_FILES` lives in `src/orchestrator/worktree.ts`, which pulls in `env.ts`/`state.ts` — not importable from `src/lib/` without breaking the "no I/O" pure-policy invariant) or accepting an orchestrator → lib import direction change. Out of scope for this task; worth a dedicated follow-up if a fourth instance appears.
