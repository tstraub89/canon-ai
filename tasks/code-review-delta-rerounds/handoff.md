# Implementation Handoff: code-review-delta-rerounds

> Author: Codex | Spec: `tasks/code-review-delta-rerounds/spec.md` | Plan: `tasks/code-review-delta-rerounds/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts` | Pure full/delta scope resolver, ordered triggers, owned-path exclusions, and 400-line threshold. |
| `src/orchestrator/git.ts` | Range-based rename-aware paths and capped diffs, commit/ancestry probes, and delta line stats. |
| `src/orchestrator/review-archive.ts` | Numbered cold-Codex archive writer, strict header parser, previous-round lookup, and malformed-record detection. |
| `src/orchestrator/phases/code-review.ts` | Resolve one round/scope after pre-flight, select the cold-Codex base, archive findings for every bundle member, and pass the scope to the foreman. |
| `src/orchestrator/prompts/index.ts` | Share the prompt's round definition with the runner and render scope-aware prompt data. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Scope line, delta lens instructions, and the review.md scope-line instruction. |
| `.claude/agents/code-review-cold.md`, `templates/.claude/agents/code-review-cold.md` | Add the spec-blind sibling-site sweep and synchronized mirror. |
| `.canon/templates/review.md`, `templates/.canon/templates/review.md` | Show scope lines in the Round 1 and later-round expected shapes. |
| `scripts/docs-refs-check.mjs`, `templates/scripts/docs-refs-check.mjs` | Exempt only numbered cold-Codex archives under task directories. |
| `docs/decisions.md` | Record per-round scope and supersede the fixed cold-Codex base clause. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document the scope triggers, archive, delta lens shape, and current foreman prompt. |
| `tests/pipeline-policy.test.ts` | Cover each scope trigger, threshold boundary, delta result, and owned-path exclusions. |
| `tests/run-task-code-review.test.ts` | Cover round fallback, archive numbering, bundle output, pre-flight/failure exclusions, bases, retry lookup, ancestry, malformed records, and real-git rename paths. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Add delta-round golden and sibling sweep assertion; regenerate full-round goldens. |
| `tests/docs-refs-check.test.ts` | Assert archive exemption and review.md negative control. |
| `dist/orchestrator/run-task.js` | Rebuilt orchestrator bundle. |

## Canon Governance

The authoritative provenance stamp is in `status.json.canon`; this handoff does not duplicate it.

## Intent & Rationale

The runner now derives the same review round as the foreman prompt, uses a pure policy function to choose the cold-lens base, and records each successful cold-Codex result with the reviewed HEAD SHA. Delta rounds limit cold-Codex and cold-Claude to the fix range; anchored Claude retains the full task diff and task context. Rename-aware path collection and conservative fallbacks keep the scope decision from silently narrowing when review history changes.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Kept diff byte-cap logic inside the new range helper instead of extracting a separate private `capDiff`. | The existing wrapper delegates to one implementation, so no duplicate cap logic remains. | None. |
| Called the pure resolver on Round 1 and XL rounds instead of constructing those results in the runner. | Keeps trigger ordering and reason text in the pure policy module. | Strengthens AC-1 and AC-2. |
| Added malformed-archive detection and strict header parsing. | A missing record and an unparseable numbered record need distinct full-scope reasons. | Satisfies AC-5. |
| Left the optional codebase-map and product-context edits out. | Neither file currently describes the archive family in a place that needed updating; all required documentation is in the specified decision and orchestrator docs. | None. |

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-1 | Met | Pure resolver test rows cover triggers 1–5, boundary 400/401, delta, and excluded task/telemetry paths. |
| AC-2 | Met | Runner and prompt call one round resolver; stale counter test records archive round 1. |
| AC-3 | Met | Two invocations produce numbered archives; max+1 handles 1/2/10; bundle content matches; pre-flight and failed cold-Codex leave no archive. |
| AC-4 | Met | Runner test records base branch on full and previous SHA on delta. |
| AC-5 | Met | Real-git tests cover normal delta, retry against round N−1, non-ancestor, equal HEAD, missing/malformed records, and unresolved SHA. |
| AC-6 | Met | Delta golden retains both Claude lens spawns; runner calls cold-Codex on delta. |
| AC-7 | Met | Delta golden names scope/base/reason and supplies the delta while anchored Claude retrieves the full diff; existing full goldens gain only scope lines. |
| AC-8 | Met | Foreman and review scaffold direct one scope line per round. |
| AC-9 | Met | Cold-Claude charter gains sibling-site sweep and retains spec-blind prohibitions; mirror check passes. |
| AC-10 | Met | Numbered archive ref is exempt while the same broken ref in review.md fails. |
| AC-11 | Met | Decision and orchestrator docs updated; managed mirror synced. |
| AC-12 | Met | Working-tree diff contains none of the four prohibited files. |
| AC-13 | Met | Fresh build produced the declared dist delta; lint, type-check, full suite, docs refs, and template sync pass. Orchestrator owns the commit. |
| AC-14 | Met | Real-git rename fixture forces trigger 4 on source X; post-image-only negative-control mutation failed with actual path set Y versus expected X and Y. |

## Edge Cases Considered

- Retried round 2 ignores existing round-2 attempts and reads the newest valid round-1 archive.
- A previous SHA equal to HEAD or no longer ancestral forces a full review.
- Bundle members share identical findings and archive headers; a missing or disagreeing previous record prevents a delta scope.
- A numbered archive with a malformed header cannot become a review base.
- Rename line counting uses delete-plus-add, which may conservatively force a full review.
- Negative-control command: `node --test --test-name-pattern 'rename-aware delta path set' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-code-review.test.ts` with the path collector temporarily switched to `--name-only -M -z`. It failed as intended: actual `[Y]`, expected `[X, Y]`. The original collector was restored byte-for-byte, and the same targeted command passed.

## Blockers

- [ambiguity] An archive whose header is entirely unparseable cannot reveal which review round it belongs to. I treat a malformed numbered archive as an unusable previous record only when no valid archive for round N−1 exists, and force full review with an unparseable-record reason. This costs an extra full review in the ambiguous case and preserves coverage.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final source and tests. |
| `npm run type-check` | Pass | Final source and tests. |
| `npm test` | Pass | 1,244 passed, 1 skipped, 0 failed after golden regeneration. |
| Golden regeneration | Pass | `UPDATE_GOLDENS=1` scoped prompt test passed; full suite then passed against stored goldens. |
| `npm run build` | Pass | Fresh build emitted the orchestrator bundle listed above; CLI bundle stayed unchanged. |
| `npm run docs-refs-check` | Pass | All refs OK after the final doc edit and template sync. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| E2E | N/A | Spec Validation Required marks E2E N/A: no UI surface. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs implemented within the Affected Files cap
- [x] All required validation checks pass
- [x] Deviations and the malformed-record interpretation documented

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts` | Distinguish failed delta/prior-path and line-stat probes from empty results; name bundle-record disagreement. |
| `src/orchestrator/git.ts` | Return `null` on failed range probes, reject malformed numstat data, and support the pinned HEAD endpoint. |
| `src/orchestrator/phases/code-review.ts` | Pin HEAD before cold-Codex, fail through the phase exit convention if it is unavailable, force full scope on failed probes, and skip unused full-diff injection on delta rounds. |
| `src/orchestrator/prompts/index.ts` | Pass the presence of an injected delta diff into the foreman template. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Give cold-Claude a retrieval command if delta injection fails, name the anchored lens's full-diff command on delta rounds, and clarify sibling-site search. |
| `.claude/agents/code-review-cold.md`, `templates/.claude/agents/code-review-cold.md` | Clarify that the spec-blind lens may search code for sibling guards. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document failed-probe full fallback and delta-diff retrieval. |
| `tests/pipeline-policy.test.ts` | Pin failure and bundle-disagreement reasons. |
| `tests/run-task-code-review.test.ts` | Cover failed probes, real-git failure versus empty output, bundle mismatch/missing member, unavailable HEAD, and HEAD movement during cold review. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Pin the delta retrieval fallback, explicit anchored full diff, and sibling-site instruction; regenerate the delta golden. |
| `dist/orchestrator/run-task.js` | Rebuild the reviewed implementation. |

### Findings Addressed

| Review finding | Resolution |
|---|---|
| F1 — git probe errors narrowed the review | Range helpers return `null` on failure while an empty successful diff remains `[]`. The pure resolver forces full scope with the failed probe named. Runner and real-git tests cover all three probes. |
| F2 — missing injected delta diff looked empty | The delta prompt renders a `git diff <prevSHA>..HEAD` retrieval instruction when injection returns `null`; no empty diff block is shown. |
| F3 — archive SHA was read after cold-Codex | HEAD is resolved once before cold-Codex or Claude starts. Failure exits through `setExitReason` and exit code 1; the pinned SHA drives ancestry, delta probes, and the archive header. A test moves HEAD during the cold run and checks the archived SHA. |
| F4 — anchored lens lacked an explicit full diff on delta rounds | The delta-only anchored instruction now names `git diff <baseBranch>...HEAD` and says to give the full task diff, separate from the cold-Claude delta. The delta block is separated from the generic retrieval line. Docs and golden match. |
| F5 — cold-Claude's sibling sweep conflicted with truncated-diff context | The delta foreman prompt distinguishes inspection for truncated diff context from searching code for sibling guards. The cold agent description also names the sweep. Full-round rendered lens instructions remain unchanged to preserve AC-7; its charter still directs the sweep on every round. |
| N1 — bundle mismatch had a missing-record reason | Disagreeing SHA records now get their own full-scope reason; tests also cover a missing bundle member. The conservative malformed-header interpretation from Iteration 1 remains documented above. |

### AC Deltas

| AC | Result | Evidence |
|---|---|---|
| AC-1 | Met | Null probe facts force full with named reasons; pure policy rows added. |
| AC-3 / AC-5 | Met | Reviewed HEAD is pinned before cold-Codex; archive continues to hold that reviewed SHA, and no archive is written when HEAD cannot resolve. |
| AC-6 / AC-7 | Met | Delta foreman golden retains both lenses, explicitly separates their ranges, and provides a missing-diff retrieval path. Full-round goldens are unchanged in this iteration. |
| AC-9 | Met | Delta foreman instruction permits the sibling-site code search while preserving the spec-blind prohibitions. |
| AC-11 | Met | Orchestrator docs now describe the failed-probe and missing-diff behavior; mirror is synchronized. |
| AC-13 | Met | Fresh build is stable; the full suite and required checks pass. |

### Deviations

- The plan predated these review findings. The nullable probe results, pinned HEAD, and prompt fallback are contained within authorized files. No new module or dependency was added.

### Blockers

- None added in this iteration. The Iteration 1 `[ambiguity]` entry remains the chosen conservative interpretation for an archive with an entirely unparseable header.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final source and tests. |
| `npm run type-check` | Pass | Final source and tests. |
| `npm test` | Pass | 1,254 passed, 1 skipped, 0 failed after delta-golden regeneration. |
| `npm run build` | Pass | Repeated fresh build produced an identical orchestrator bundle hash. |
| `npm run docs-refs-check` | Pass | All refs OK before this handoff append; rechecked below after append. |
| `npm run sync-templates:check` | Pass | All managed mirrors in sync. |
| E2E | N/A | Spec Validation Required marks E2E N/A: no UI surface. |
| `git diff --check` | Pass | No whitespace errors. |
