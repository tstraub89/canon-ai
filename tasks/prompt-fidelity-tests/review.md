# Code Review: prompt-fidelity-tests

## Round 1

### Stage 1 — Validation Gate

Pre-flight blocked with three "missing" items. Root cause: Codex wrote the Validation Outcomes
`Check` column using the command string (`` `npm run lint` ``) rather than the spec name +
command form (`` `lint` (`npm run lint`) ``). `canonicalizeValidationCheck` extracts the first
backtick token — `npm run lint` ≠ `lint` — so all three required checks failed to match.

**FIXED INLINE** — renamed the three Check column values in `handoff.md` to match the spec names:
- `` `npm run lint` `` → `` `lint` (`npm run lint`) ``
- `` `npm run type-check` `` → `` `type-check` (`npm run type-check`) ``
- `` `npm test` `` → `` `test` (`npm test`) ``

Trivial fix exception applies: naming mismatch only, no logic change, ≤ 3 lines, no other
findings requiring a Codex iteration.

### Stage 2 — Code Quality

Proceeding to full review after inline fix.

## Verdict

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested

## Round 3 — verifying iteration 2's response to round 2 + completing Stage 2

### Round 2 findings addressed

Round 2 pre-flight found two diff→handoff mismatches (`handoff.md` and `review.md` appeared in
the diff but were not listed in the Changes table). Both were addressed in commit `37513a1`:
- `tasks/prompt-fidelity-tests/handoff.md` → added to Changes table. **Addressed.**
- `tasks/prompt-fidelity-tests/review.md` → added to Changes table. **Addressed.**

No other round 2 findings.

### Stage 2 — Code Quality (first run; not performed in prior rounds)

**`scripts/run-task/state.ts`**: `taskDirFor` now resolves `CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR` before joining. `statusFileFor` handles the override with its own branch (`path.join(override, taskId, 'status.json')`), giving the same result as `path.join(taskDirFor(taskId), 'status.json')` when the override is set. Consistent and correct.

**`scripts/run-task/context.ts`**: One-liner env override (`?? path.join(REPO_ROOT, 'docs/patterns.md')`). Clean; preserves the existing regex/format path unchanged.

**`tests/run-task-prompts.test.ts`**:
- Fixture setup writes all required files to `mkdtempSync` dir, sets both env vars before any builder call, restores/removes in `after()`. AC-4 met correctly.
- `normalize` replaces `REPO_ROOT` globally; golden keys match the 10 builder/variant names from AC-3.
- `UPDATE_GOLDENS=1` accumulates into `goldens` map and writes on teardown; skips assertions. AC-6 met correctly.
- `recordOrAssert` comparison is `assert.equal(actual, goldens[key])` — if the golden key is missing and UPDATE_GOLDENS is unset, the test fails with `undefined`, which is the correct behavior (forces explicit golden bootstrap).
- `PATTERNS_STUB_PATH` and `GOLDEN_PATH` use `path.resolve` relative to CWD. These resolve correctly when `npm test` is run from the repo root.
- `codeReviewRoundNState` uses `iterations: 1` → prompt renders "REVIEW ROUND 2" (round = iterations + 1). Matches the golden output. Correct.

No correctness bugs or spec gaps found.

### Verdict

- [x] **Approved**
