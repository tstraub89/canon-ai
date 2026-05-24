# Code Review: prepr-base-drift-check

> Reviewer: Claude | Spec: `tasks/prepr-base-drift-check/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Notes: 407 tests, 406 pass, 1 skipped. The skip is pre-existing — no new test is marked skip, no spec AC required a skip.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `verifyBaseDriftFromData(diffFiles, allowedPaths, taskIds): string[]` exported from `validation.ts`, placed after `verifyHandoffAgainstDiffFromData`. Uses `Set.has` and `tasks/<id>/` prefix check per spec. |
| AC-2 | Pass | `getTreeDriftFiles(baseRef, cwd): { files, ok, stderr }` exported from `git.ts` adjacent to `getAffectedFiles`. Calls `gitSafeAtRaw(cwd, 'diff', baseRef, 'HEAD', '--name-status', '-M', '-z')` — two-dot, rename detection, correct. Returns stderr on failure. `getAffectedFiles` unchanged. |
| AC-3 | Pass | `verifyBaseDrift` exported from `validation.ts`. Fetch failure: warns + returns `fetchFailed: true`. Diff failure: no warn, returns `diffFailed: true` + stderr. Unions `PIPELINE_TELEMETRY_FILES` + `parseAffectedFilesFromSpec` files. Warns per malformed cell. Return shape matches spec. |
| AC-4 | Pass | Single call site in `commitHumanReviewFiles`, immediately after `mirrorHumanReviewDocsToCwd(cwd)` (line 905) and before `affectedManagedDocs` build (line 946). All four branches present. `diffFailed` is not bypassed by `--force`. No other logic in the function changed. |
| AC-5 | Pass | Die message at `main.ts:920–937` verified: contains `tasks/<id>/**`, `PIPELINE_TELEMETRY_FILES`, `Affected Files`, `git rebase origin/`, `git checkout origin/`, `git revert`, `rename`, `--force`. `git checkout HEAD --` does NOT appear in the base-drift die message (it only appears in the pre-existing dirty-tree message at line 1013, which is unchanged). The safety test also asserts `doesNotMatch(output, /git checkout HEAD --/)`. |
| AC-6 | Pass | Bundle union test passes disjoint `task-a` + `task-b` allow-lists; both diff paths accepted. |
| AC-7 | Pass | Eight `verifyBaseDriftFromData` tests: (a) empty diff, (b) allowed spec path, (c) drift path, (d) task-dir path, (e) telemetry path, (f) bundle union, (g) deleted file as drift, (h) rename old-path drift with only new path in allowlist. All AC-7(a-h) sub-cases covered. |
| AC-8 | Pass | Five integration scenarios cover all four required scenarios plus diff-failure: allowed-path proceeds (a), drift dies with path + `--force` mention (b), `--push --force` warns and proceeds (c), real-git base-advance Mode 1 dies (d). Documented deviation: (c) uses `main()` + `process.argv` because `cliArgs.force` is module-level state — correct and documented. |
| AC-9 | Pass | `verifyBaseDrift: fetch failure warns and returns fetchFailed without drift` in `run-task-validation.test.ts`. Uses local git repo with missing origin; asserts `fetchFailed: true`, no die, correct warn text. |
| AC-10 | Pass | Two-layer coverage: validation test for `verifyBaseDrift` diff failure + safety test for `commitHumanReviewFiles` fails closed. Both assert `diffFailed: true` / non-zero exit and that `--force` does not bypass. |
| AC-11 | Pass | `parseArgs` in `cli.ts` unchanged (diff only shows `printUsage` changes). `cliArgs.force` consumed in two places: existing full-send-on-delicate gate and new base-drift gate. `diffFailed` not bypassed by `--force`. |
| AC-12 | Pass | `--pr` and `--push` help text updated in both `src/cli/index.ts` and `scripts/run-task/cli.ts` with the required sentence. |
| AC-13 | Pass | `docs/pipeline-orchestrator.md` paragraph names: where the check fires, what it catches (Mode 1 + wider Mode 2), complementarity with Fix 2's dirty-tree gate, rename-both-sides requirement, `--force` bypass, and that `--force` does not bypass diff-computation failure. |

### Dropped Sections Check

- [x] Non-goals respected — no auto-rebase, no `--allow-drift` flag, `--ship` unmodified, `getAffectedFiles` unchanged
- [x] Known Risks addressed — same-file Mode 1 residual explicitly deferred per spec; other risks (fetch latency, offline tolerance, rename burden) correctly not guarded against per spec
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceeding to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, additive implementation that mirrors the existing `verifyHandoffAgainstDiff` / `verifyHandoffAgainstDiffFromData` structural precedent exactly. The pure-data `*FromData` seam, the fetch/diff failure separation, and the `--force`-bypasses-drift-but-not-diff-failure asymmetry are all correct. The fake-git `diff` handler ordering in `run-task-safety.test.ts` is safe: the new `diff && != --cached` handler correctly skips when `${2:-}` is `--cached`, so it does not shadow the pre-existing `diff --cached --name-only` handler.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

## Final Verdict

- [x] **Approved** — ship as-is

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
