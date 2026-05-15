# Implementation Plan: prompt-fidelity-tests

> Written by: Claude | Implements: `tasks/prompt-fidelity-tests/spec.md`

## Approach

Three minimal production changes to make the test infrastructure portable, then the new test file
that uses them. Production changes are one-liners in existing functions — no new exports, no new
types. Test file follows the `mkdtempSync` + `finally` pattern already established in
`tests/run-task-validation.test.ts`.

## Steps

### Step 1: Patch `state.ts` — env-var overrides in `taskDirFor` and `statusFileFor`

Files: `scripts/run-task/state.ts`

In `taskDirFor(id)` (line 7), prepend:
```ts
const tasksDir = process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR;
return path.join(tasksDir, id);
```

In `statusFileFor(id)` (line 16), prepend:
```ts
if (process.env.CANON_TASKS_DIR_OVERRIDE) {
    return path.join(process.env.CANON_TASKS_DIR_OVERRIDE, id, 'status.json');
}
```
Leave the existing `resolveTaskCwd` body as the else branch. The guard keeps worktree-aware routing
intact for all non-test callers.

### Step 2: Patch `context.ts` — env-var override in `buildKnownPitfalls`

Files: `scripts/run-task/context.ts`

In `buildKnownPitfalls()` (line 56), replace:
```ts
const patternsPath = path.join(REPO_ROOT, 'docs/patterns.md');
```
with:
```ts
const patternsPath = process.env.CANON_PATTERNS_MD_PATH ?? path.join(REPO_ROOT, 'docs/patterns.md');
```
Everything else in the function (try/catch, regex, return format) is unchanged.

### Step 3: Create stub patterns file

Files: `tests/fixtures/patterns.stub.md`

Minimal fixed-content file with a `## Known Pitfalls` section so `buildKnownPitfalls` returns
deterministic output in tests:

```md
## Known Pitfalls

### Stub pitfall for testing

This is a stub pitfall used by prompt-fidelity tests.
```

### Step 4: Write `tests/run-task-prompts.test.ts` and capture goldens

Files: `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`

Structure mirrors `tests/run-task-validation.test.ts`:

1. **Setup block** (runs once before all tests):
   - `mkdtempSync` a temp dir
   - Write fixture files:
     - `<tmpDir>/test-pf-001/status.json` — minimal valid `StatusJson`: id, title, task_size `S`,
       delicate `false`, base_branch `"main"`, all phases `pending`, no worktree flag
     - `<tmpDir>/test-pf-001/spec.md` — sections present but no Affected Files table, no Known
       Risks (so `buildContextBlock` and `buildKnownRisks` return `''`)
     - `<tmpDir>/test-pf-001/plan.md` — one-line stub
     - `<tmpDir>/test-pf-001/handoff.md` — stub with an `## Iteration 1` section header (needed
       for `promptCodeReview` round-N variant)
     - `<tmpDir>/test-pf-001/review.md` — stub
   - Set `process.env.CANON_TASKS_DIR_OVERRIDE = tmpDir`
   - Set `process.env.CANON_PATTERNS_MD_PATH = path.resolve('tests/fixtures/patterns.stub.md')`

2. **Teardown block** (runs once after all tests):
   - `delete process.env.CANON_TASKS_DIR_OVERRIDE`
   - `delete process.env.CANON_PATTERNS_MD_PATH`
   - `fs.rmSync(tmpDir, { recursive: true, force: true })`

3. **Normalize helper**:
   ```ts
   import { REPO_ROOT } from '../scripts/run-task/env.js';
   function normalize(s: string): string {
       return s.replaceAll(REPO_ROOT, '<REPO_ROOT>');
   }
   ```

4. **Fixture state objects** (construct inline per test, not shared — makes each test readable):
   - `baseState`: `{ tasks: [{ taskId: 'test-pf-001', title: 'Test task', specReviewVerdict: '',
     iterations: 0, rerouteCount: 0, status: <StatusJson> }], tier: 'full', isBundle: false }`
   - Variants: `iterState` (iterations: 1), `rerouteState` (rerouteCount: 1,
     specReviewVerdict: 'approved')

5. **10 test cases** — one `test()` per builder call, named after the golden key:
   | Test name | Builder call | State variant |
   |---|---|---|
   | `promptSpec` | `promptSpec(baseState)` | base |
   | `promptSpecRevision` | `promptSpecRevision({...baseState, tasks: [{...task, specReviewVerdict: 'changes_requested'}]})` | base + verdict |
   | `promptSpecReview` | `promptSpecReview(baseState)` | base |
   | `promptPlan` | `promptPlan({...baseState, tasks: [{...task, specReviewVerdict: 'approved'}]})` | base + verdict |
   | `promptImplement_fresh` | `promptImplement(baseState, 'fresh')` | base |
   | `promptImplementRevisions` | `promptImplementRevisions(iterState)` | iter |
   | `promptImplementReroute` | `promptImplementReroute(rerouteState)` | reroute |
   | `promptCodeReview_round1` | `promptCodeReview(baseState)` | base |
   | `promptCodeReview_roundN` | `promptCodeReview(iterState)` | iter |
   | `promptQa` | `promptQa(baseState)` | base |

6. **Golden logic** per test:
   ```ts
   const actual = normalize(promptXxx(state));
   if (process.env.UPDATE_GOLDENS === '1') {
       goldens[key] = actual;
   } else {
       assert.equal(actual, goldens[key]);
   }
   ```
   After all tests, if `UPDATE_GOLDENS === '1'`, write `goldens` back to
   `tests/run-task-prompts.golden.json`.

7. Run `UPDATE_GOLDENS=1 npm test` once to capture the initial golden file. Commit both files.

## Testing Plan

- **Unit**: The new suite IS the test. `npm test` must pass after initial golden capture.
- **Manual**: Human test plan steps in spec (whitespace edit → failure → UPDATE_GOLDENS → pass).
- **E2E**: N/A.

## Rollback Plan

Purely additive — two production one-liners behind env-var guards, two new test files. Reverting
removes the test files and the env-var checks; no state, no schema changes, no behavior change for
non-test callers.
