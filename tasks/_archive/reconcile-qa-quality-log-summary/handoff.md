# Implementation Handoff: reconcile-qa-quality-log-summary

> Author: Codex | Spec: `tasks/reconcile-qa-quality-log-summary/spec.md` | Plan: `tasks/reconcile-qa-quality-log-summary/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. Group only files that change together for the same reason; unrelated files read better on separate rows. Every listed path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/quality-log.ts` | Added the fail-soft, header-driven quality-log writer, judgment-block parser, duplicate reconciliation, placement/relocation, round-trip cell serializer, and path override. |
| `src/task/index.ts` | Invokes the writer after the durable status write whenever `taskPhase()` completes `qa`. |
| `scripts/run-task/prompts/templates/qa.md` | Replaced the blind append instruction with the five-cell `done.md` Quality Log contract. |
| `tests/run-task-quality-log.test.ts` | Added focused coverage for derivation, upsert, placement, reconciliation precedence, adopter columns, escaping, judgment preservation, and history isolation. |
| `tests/task-cli.test.ts` | Added transition-level red-first coverage, direct/operator dispatch, salvage-sequence, fail-soft, absent-log, and repository-path isolation regressions. |
| `tests/run-task-safety.test.ts` | Redirects QA evidence-advance logging to a fixture and asserts that path writes the task row. |
| `tests/run-task-prompts.golden.json` | Regenerated QA prompt goldens for the new `done.md` contract. |
| `dist/cli/index.js`, `dist/scripts/run-task.js` | Rebuilt both committed bundles from the changed source and prompt. |
| `docs/task-quality-log.md`, `templates/docs/task-quality-log.md` | Updated the root log and hand-maintained seed to describe upsert semantics and include `XS` in the size domain. |
| `docs/architecture.md` | Corrected the QA/telemetry flow and removed the false `autoBlockPhase()` append claim. |
| `docs/decisions.md` | Recorded the transition-owned, fail-soft upsert and the rejected unsound derivations. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

`taskPhase()` is the shared choke point for agent, salvage, evidence-advance, and operator QA completion. The implementation writes status first, then calls a doubly guarded quality-log writer: telemetry failure can warn but cannot roll back or block `qa → done`. The writer resolves cells by the live table header, preserves adopter columns, reconciles all copies of the current task by the spec's per-cell precedence, and atomically replaces the log file.

Red-first checkpoint: before production changes, `node --import tsx --test --test-name-pattern='qa completion reconciles quality-log review totals' tests/task-cli.test.ts` failed on the seeded `schedule-date-corrections` row with `AssertionError: '1' !== '6'`. The same command passed after the transition writer was integrated.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Kept the row splitter local to `quality-log.ts` instead of exporting private helpers from `markdown-table.ts`. | The plan proposed editing `markdown-table.ts`, but that file is outside the spec's binding Affected Files cap. The local parser intentionally mirrors its odd/even backslash grammar; tests verify serialized values through the existing public `parseTable()` API. | None; AC-4's exact round-trip and AC-4b's header mapping are covered without an out-of-scope API change. |
| Replaced the log through a sibling temp file and rename instead of writing it directly. | Atomic replacement avoids truncating a healthy log if the final write fails; cleanup remains best-effort and guarded so the fail-soft contract is unchanged. | Strengthens AC-7; no observable contract change. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1: derived counters, red-first | Met | Transition regression reproduced stale `1 / 1`, then proves `6 / 2`; unit coverage proves absent totals become `0 / 0`. |
| AC-1b: exact Date and Size binding | Met | Tests prove UTC write date ignores distinct created/updated sentinels, supports explicit/absent size, and adds the delicate suffix. |
| AC-2: exactly-one-row upsert | Met | Two writes converge to one task row with the second pass's counters and judgments. |
| AC-3: placement and relocation | Met | Periodic, anchorless, and below-Periodic stray fixtures all leave one row inside `## Log`. |
| AC-4: judgment cells and serialization | Met | All five cells write/preserve correctly; pipe, backslash-pipe, LF, and CRLF cases satisfy the declared round-trip/normalization contract. |
| AC-4b: header-driven adopter columns | Met | Insert/update tests cover an adopter column before a canon column; missing canon headers warn and leave the file unchanged. |
| AC-4c: duplicate precedence | Met | Conflicting inside/stray duplicates preserve earliest spec verdict, latest corrigible/adopter values, refreshed derivations, and byte-stable sibling lines. |
| AC-5: no reroute derivation | Met | The archived `reroute_count: 2` shape preserves QA's `Human reroute? = No`; reroute state is absent from writer inputs. |
| AC-6: all qa-done paths | Met | `taskCmd` covers agent/operator dispatch, the salvage statement sequence calls `taskPhase`, and the existing evidence-advance subprocess now asserts the row. |
| AC-7: fail-soft | Met | Malformed and unwritable paths warn while QA reaches done; absent logs are scaffolded with the row. Both integration and writer layers catch errors. |
| AC-8: attempt history untouched | Met | Tests retain status/review artifacts and sibling task rows byte-for-byte while only the target row changes. |
| AC-9: prompt and derived copies | Met | QA prompt, golden snapshots, and both dist bundles carry the new Quality Log block contract. |
| AC-10: stale prose | Met | Both log headers, size domains, all three architecture sites, and the false auto-block claim are corrected without rewriting historical rows. |
| AC-11: test isolation | Met | Call-time path override tests compare repository content/mtime and the evidence-advance subprocess uses only its fixture log. |
| AC-12: validation suite | Met | Lint, type-check, all 1,039 tests, build, and docs reference checks pass; fresh build generated the committed dist files. |

## Edge Cases Considered

- Missing or unreadable `done.md` supplies no current judgments and preserves reconciled history.
- A missing log is scaffolded; a malformed/incomplete/duplicate header is rejected without mutation.
- Task duplicates can be wholly in-table or split across the Log and Periodic sections.
- Adopter-added columns are preserved by header name and remain empty on insertion.
- Literal backslashes immediately before pipes retain parser parity; physical newlines normalize to spaces.
- Telemetry write/read/rename failures occur only after status persistence and cannot escape the guarded writer.
- A bundle remains per-member by construction because each member independently calls `taskPhase(taskId, 'qa', 'done')`.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Record every check in spec.md's Validation Required section here, plus any extra checks you ran. Required checks should not be marked `N/A` or `not_configured` — run the check or adjust the spec; the code reviewer verifies coverage against the spec. The `Check` cell is for human readability (the pre-flight gate no longer string-matches it against the spec), so write whatever names the check clearly — but keep a check's label identical across a baseline row and any later `### Re-run validation` row so its result updates in place.

| Check | Result | Notes |
|---|---|---|
| Red-first regression checkpoint | Pass | Pre-fix targeted run failed for the specified stale-counter reason (`'1' !== '6'`); post-fix targeted run passed. |
| `npm run lint` | Pass | ESLint completed with no findings. |
| `npm run type-check` | Pass | TypeScript no-emit check completed cleanly. |
| `npm test` | Pass | 1,039 tests: 1,038 passed, 1 environment skip, 0 failed. Re-run after final test edits. |
| `npm run build` | Pass | Both dist entry points rebuilt successfully; postbuild normalization completed. |
| `npm run docs-refs-check` | Pass | All references valid. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration, or a comma-separated list when files are tightly coupled — see the baseline Changes note above for the grouping guidance and token format. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
