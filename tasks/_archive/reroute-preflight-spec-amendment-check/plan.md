# Implementation Plan: reroute-preflight-spec-amendment-check

> Written by: Claude | Implements: `tasks/reroute-preflight-spec-amendment-check/spec.md`

## Approach

A new validation helper `verifyRerouteAmendment` in `scripts/run-task/validation.ts` does a text-grep on `tasks/<id>/spec.md` to enforce the asymmetric heading requirement. The helper is invoked from `rerouteFromHumanReview` in `scripts/run-task/main.ts` at the same point the existing phase-validation loop sits — **before** any `status.json` mutation. `--force` bypasses with a stderr warning per task.

Two regexes — one per round-bucket — and a strict-equality check on the captured round number. No git plumbing. No state in `status.json`. The implement-reroute prompt template is updated in lockstep so Codex sees the same convention the gate enforces.

Implementation order: helper + unit tests first (proves the regex behavior in isolation), then call-site wiring + integration tests (proves the rerouteFromHumanReview path), then UX surface (`--help` + prompt + docs), then build + commit.

## Steps

### Step 1: Add `verifyRerouteAmendment` to `scripts/run-task/validation.ts`

Files: `scripts/run-task/validation.ts`

Add an exported function near the top of the file (after `parseValidationRequiredChecks` at line 134; before `parseValidationOutcomeRows` at line 163). Signature per AC-1:

```ts
export function verifyRerouteAmendment(
    taskId: string,
    requiredRound: number,
    cwd: string,
): { amended: boolean; reason: string } {
    const specPath = path.join(cwd, 'tasks', taskId, 'spec.md');
    let content: string;
    try {
        content = fs.readFileSync(specPath, 'utf8');
    } catch {
        return { amended: false, reason: `spec.md missing at ${specPath}` };
    }

    if (requiredRound === 1) {
        // Round 1: bare `## Amendment` (or `## Amendment Round 1`, which also matches).
        if (/^#{2,6}\s+Amendment\b/im.test(content)) {
            return { amended: true, reason: '' };
        }
        return {
            amended: false,
            reason: `no \`## Amendment\` heading found in ${specPath} (round 1 reroute requires the bare 'Amendment' heading)`,
        };
    }

    // Round 2+: strict `## Amendment Round N` where N === requiredRound.
    const matches = content.matchAll(/^#{2,6}\s+Amendment\s+Round\s+(\d+)\b/gim);
    let seenRound: number | null = null;
    for (const match of matches) {
        const n = Number(match[1]);
        if (n === requiredRound) {
            return { amended: true, reason: '' };
        }
        if (seenRound === null) seenRound = n;
    }
    if (seenRound !== null) {
        return {
            amended: false,
            reason: `found \`## Amendment Round ${seenRound}\` in ${specPath}, expected \`## Amendment Round ${requiredRound}\``,
        };
    }
    return {
        amended: false,
        reason: `no \`## Amendment Round ${requiredRound}\` heading found in ${specPath}`,
    };
}
```

Note: `fs` and `path` are already imported at the top of the file (used by `parseValidationRequiredChecks`). No new imports needed.

### Step 2: Unit tests for `verifyRerouteAmendment`

Files: `tests/run-task-validation.test.ts`

Add 9 new tests per AC-5. Insertion point: near the existing `parseValidationRequiredChecks` test block (around line 362) — follow the same `withTempDir` + `fs.mkdtempSync` fixture pattern.

Fixture shape per test (all cases use a temporary directory with `tasks/<id>/spec.md`):

```ts
void test('verifyRerouteAmendment: round 1 accepts `## Amendment`', () => {
    withTempDir('verify-reroute-amendment-r1-amendment-', dir => {
        const taskId = 'task-x';
        const specPath = path.join(dir, 'tasks', taskId, 'spec.md');
        fs.mkdirSync(path.dirname(specPath), { recursive: true });
        fs.writeFileSync(specPath, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'New direction.',
            '',
        ].join('\n'), 'utf8');

        const result = verifyRerouteAmendment(taskId, 1, dir);
        assert.equal(result.amended, true);
        assert.equal(result.reason, '');
    });
});
```

Cases:
- A: `## Amendment`, round 1 → `amended: true`
- B: `### amendment` (h3, lowercase), round 1 → `amended: true`
- C: `## Amendment Round 1`, round 1 → `amended: true` (strict form satisfies loose check)
- D: no `## Amendment` heading, round 1 → `amended: false`, reason mentions "round 1 reroute requires"
- E: only `## Follow-up`, round 1 → `amended: false` (legacy variant rejected); reason names the missing `## Amendment` requirement
- F: `## Amendment Round 2`, round 2 → `amended: true`
- G: only `## Amendment Round 1`, round 2 → `amended: false`; reason names found round (1) and expected round (2)
- H: only `## Amendment` (no "Round 2"), round 2 → `amended: false`; reason names the missing `## Amendment Round 2` heading
- I: spec.md missing entirely, any round → `amended: false`; reason starts with `spec.md missing at`

Add import for the new symbol at the top of the file (the existing imports already reference other validation helpers; add `verifyRerouteAmendment` to the named imports from `'../scripts/run-task/validation.js'`).

Reference pattern: existing tests like `parseValidationRequiredChecks returns checked validation requirements and ignores unchecked rows` (tests/run-task-validation.test.ts around line 226 — confirmed location during spec authoring).

### Step 3: Wire into `rerouteFromHumanReview` in `scripts/run-task/main.ts`

Files: `scripts/run-task/main.ts`

Modify `rerouteFromHumanReview` (currently lines 1730-1788). The new logic sits between the existing phase-validation loop and the status-mutation loop.

Current structure (lines 1730-1740):

```ts
function rerouteFromHumanReview(taskIds: string[]): void {
    for (const taskId of taskIds) {
        const currentPhase = getCurrentPhase(splitState.readStatus(taskId));
        if (currentPhase !== 'human_review') {
            splitCli.die(`--reroute requires all tasks to be at human_review. '${taskId}' is at: ${currentPhase}`);
        }
    }
    splitCli.info(`Rerouting: human_review → implement (resetting implement, code_review, qa)`);
    let clearedFullSend = false;
    for (const taskId of taskIds) {
        const status = splitState.readStatus(taskId);
        // ... existing mutation logic
    }
}
```

Insert a new pre-flight loop after the phase-validation loop (after line 1736) and before the `splitCli.info` at line 1737. The new loop:

1. Reads each task's status.json
2. Computes `requiredRound = (status.phases.implement?.reroute_count ?? 0) + 1`
3. Resolves the per-task `cwd` via `resolveTaskCwd(taskId)` (already imported from `state.ts`)
4. Calls `verifyRerouteAmendment(taskId, requiredRound, cwd)`
5. Aggregates failing tasks into an array `failures: Array<{ taskId, specPath, requiredRound, reason }>`

After the loop:
- If `failures.length > 0 && !cliArgs.force`: build the multi-line abort message per AC-2 (one block per failing task naming taskId / spec.md path / required round / expected heading / reason; plus the `Bypass with --force...` instruction and the `docs/pipeline-orchestrator.md` pointer). Call `splitCli.die(message)`.
- If `failures.length > 0 && cliArgs.force`: emit one stderr warning per failing task per AC-3 (using `splitCli.warn` or direct `process.stderr.write` — check which is the project convention by looking at how `--force` overrides are emitted elsewhere; e.g., the base-drift override at `main.ts:941` uses `splitCli.info` for the override notice).

Reference pattern: the existing base-drift gate at `main.ts:909-942` follows the same shape — collect failures, branch on `cliArgs.force`, emit either `splitCli.die` or a warning + proceed.

Estimated diff size: ~35 lines added (the pre-flight loop + failures-aggregation + abort/warning emission).

### Step 4: Integration tests in new file `tests/run-task-reroute-preflight.test.ts`

Files: `tests/run-task-reroute-preflight.test.ts` (NEW)

Pattern: import `rerouteFromHumanReview` (or invoke via spawn of `dist/cli/index.js`/`node --import tsx scripts/run-task.ts <id> --reroute`). Look at `tests/run-task-harness.test.ts:49-65` for the `runValidateTaskId` spawn pattern — adapt it to invoke `--reroute`.

Tests per ACs 7, 8, 9, 10:

- **AC-7 — no-force abort**: scaffold a task at `human_review` (write a minimal status.json with `phases.human_review.status: pending` and earlier phases marked `done`). spec.md is the default template (no Amendment heading). Invoke `--reroute` without `--force`. Assert non-zero exit, stderr contains the expected abort message fragments (task ID, required round = 1, "`## Amendment` heading"), and status.json is unchanged after invocation.
- **AC-8 — force bypass**: same fixture but with `--force`. Assert exit 0, stderr contains the AC-3 warning line, status.json shows `phases.implement.status === 'pending'`, `phases.implement.rerouted === true`, `phases.implement.reroute_count === 1`.
- **AC-9 — bundle multi-failure**: scaffold two tasks at `human_review`, neither with Amendment headings. Invoke `--reroute` on both without `--force`. Assert non-zero exit, stderr names both task IDs, both status.jsons untouched.
- **AC-10 — multi-round boundary**: scaffold a task at `human_review` with `phases.implement.reroute_count: 1` (simulating one prior reroute). spec.md has `## Amendment` (round-1 form). Invoke `--reroute` — assert it fails with the round-2 expectation error. Edit spec.md to add `## Amendment Round 2`. Invoke again — assert success and status.json shows `reroute_count` is still 1 at pre-flight time (will be incremented to 2 by `rerouteFromHumanReview`'s mutation step).

Each test uses `fs.mkdtempSync` + `CANON_TASKS_DIR_OVERRIDE` env var to point canon at the temp tasks dir (see `tests/run-task-harness.test.ts:30-46` for the `withTempTaskSpec` pattern). Worktree-mode setup is NOT required for these tests because they don't exercise the worktree-mirror path — they only test the gate logic given a tasks dir.

### Step 5: Update `canon run --help` text for `--reroute`

Files: `scripts/run-task/cli.ts`

Locate the existing `--reroute` help block at lines 48-52. Insert one line per AC-6 between the existing description and the "See CLAUDE.md" pointer:

```ts
console.log('  --reroute           Reset a task from human_review back to implement after human feedback.');
console.log('                      Append an "Amendment" section to spec.md; codex re-reads spec.md. notes.md');
console.log('                      or PR comments are NOT consulted on reroute. See CLAUDE.md "Reroute');
console.log('                      feedback channel" for the contract.');
```

Becomes:

```ts
console.log('  --reroute           Reset a task from human_review back to implement after human feedback.');
console.log('                      Append an "Amendment" section to spec.md; codex re-reads spec.md. notes.md');
console.log('                      or PR comments are NOT consulted on reroute.');
console.log('                      Pre-flights require `## Amendment` in spec.md for round 1, or');
console.log('                      `## Amendment Round N` for round 2+. Bypass with --force.');
console.log('                      See CLAUDE.md "Reroute feedback channel" for the contract.');
```

### Step 6: Update `implement-reroute.md` prompt template

Files: `scripts/run-task/prompts/templates/implement-reroute.md`

Current line 15:

```
1. Read tasks/<id>/spec.md top-to-bottom. Scan for any section added after the original spec (e.g. "Amendment", "Round N", "Follow-up", "Post-review"). Those are the new requirements.
```

Replace with (using the round number that the prompt-construction code already interpolates into context — verify the interpolation pattern in `scripts/run-task/agents/codex.ts` or wherever this prompt is loaded; if no current interpolation, add one via the same mechanism other prompts use):

```
1. Read tasks/<id>/spec.md top-to-bottom. The operator's new direction is under a heading determined by reroute round:
   - Round 1: `## Amendment`
   - Round 2 and beyond: `## Amendment Round N` (where N is the current round number)

   The current reroute round for this task is {ROUND_NUMBER}. Locate that heading and treat its content as the new requirements. Ignore prior-round sections (e.g., when implementing Round 2, do NOT re-implement Round 1's directives — they were addressed in the prior iteration).
```

Implementation note: if the prompt currently has no `{ROUND_NUMBER}` interpolation, add it. The orchestrator already has `phases.implement.reroute_count` in scope at prompt-construction time. The interpolation mechanism: check how other prompts inject task-specific data (e.g., `taskId`, `baseBranch`) and follow the same pattern.

If the prompt-construction code uses string templating (e.g., `.replace('{taskId}', ...)`), add `{ROUND_NUMBER}` to the same call. If it uses a template literal (TS), thread `rerouteCount` through.

### Step 7: Documentation update in `docs/pipeline-orchestrator.md`

Files: `docs/pipeline-orchestrator.md`

Locate § Reroute feedback channel (search for the heading). Append a paragraph after the existing content describing:

1. The asymmetric heading requirement (`## Amendment` for round 1; `## Amendment Round N` for round 2+).
2. The pre-flight check behavior — what fails it, what passes it.
3. The `--force` bypass.
4. The rationale.
5. Explicit note that legacy variants ("Follow-up", "Post-review") are no longer accepted.

Reference style: match the existing paragraph format in that section.

### Step 8: Rebuild dist + run validation

Files: `dist/cli/index.js`, `dist/scripts/run-task.js` (regenerated)

After all source changes, run:

```bash
npm run build
```

Then run all validation per spec:

```bash
npm run lint
npm run type-check
npm test
npm run docs-refs-check
```

Each must pass. Commit `dist/` deltas alongside source per the dist-freshness CI gate.

## Testing Plan

- **Unit**: 9 new tests in `tests/run-task-validation.test.ts` covering all branches of `verifyRerouteAmendment` (round 1 accept/reject, round 2+ strict match/mismatch/insufficient-form, missing file).
- **Integration**: 4 new tests in `tests/run-task-reroute-preflight.test.ts` (AC-7 through AC-10) — exercising the full `rerouteFromHumanReview` flow with realistic status.json + spec.md fixtures.
- **Manual**: per Human Test Plan in spec.md — 8 steps covering round-1 happy/fail, round-2 boundary, `--force`, bundle, and legacy-variant rejection.

## Rollback Plan

This task is purely additive — no schema changes, no data migration. To revert:

1. Revert the merge commit.
2. Re-run `npm run build`.

Adopters who already received this gate via `canon upgrade` would need to either pull a fix-forward release or live with the slightly-stricter `--reroute` behavior (which `--force` bypasses).

No interaction with `status.json` shape, no field reads or writes beyond the existing `phases.implement.reroute_count`. Reverting is symmetric to landing.
