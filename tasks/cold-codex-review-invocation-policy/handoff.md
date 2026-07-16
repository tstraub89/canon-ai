# Implementation Handoff: cold-codex-review-invocation-policy

> Author: Codex | Spec: `tasks/cold-codex-review-invocation-policy/spec.md` | Plan: `tasks/cold-codex-review-invocation-policy/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/pipeline-policy.ts` | Added the cold `code_review` Codex policy row (mini / high at every effective size). |
| `scripts/run-task/agents/codex.ts` | Added shared effort validation, cold-review effort argv, token parsing, and exactly-once cold telemetry. |
| `scripts/run-task/phases/code-review.ts` | Resolved the cold model and effort through `getCodexConfig` and supplied bundle/round metrics context. |
| `tests/pipeline-policy.test.ts` | Covered all five cold-review policy cells and delicate promotion behavior. |
| `tests/run-task-code-review.test.ts` | Added exact cold argv, three no-spawn effort guards, and successful/failed/no-usage telemetry coverage. |
| `tests/run-task-reroute-preflight.test.ts` | Pinned complete fresh and resumed Codex argv shapes, masking only generated prompt text. |
| `tests/run-task-safety.test.ts` | Replaced invalid placeholder Codex efforts with `high` so existing spawn/non-zero/stall/signal ladders reach their intended branches under the new guard. |
| `docs/decisions.md` | Updated the cold-lens decision to describe policy-resolved model/effort and the mini/high boundary. |
| `docs/pipeline-orchestrator.md` | Documented the cold-lens policy row and invocation-scoped effort override. |
| `templates/docs/pipeline-orchestrator.md` | Synced the canon-managed orchestrator documentation mirror. |
| `dist/scripts/run-task.js` | Rebuilt the published orchestrator bundle from the changed policy and runner sources. |

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

The cold review now uses the same table-driven policy boundary as other Codex calls. A shared pre-spawn guard rejects values the Codex CLI cannot accept, while the cold path passes its resolved effort explicitly and owns one telemetry write for every real pipeline attempt. The phase supplies bundle and round attribution, preserving the existing hard-fail-before-Claude contract.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added `tests/run-task-safety.test.ts` after the full suite exposed four invalid placeholder effort values; the resumed user instruction authorized finishing the scoped blocker. | AC-5 intentionally validates every `runCodex` call before spawning, so the existing failure-ladder fixture must supply a CLI-valid effort to test later subprocess branches. | No behavioral AC change; restores the pre-existing AC-8 safety assertions under the new AC-5 contract. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1: policy matrix | Met | All five cells and delicate promotion pass the full suite. |
| AC-2: replace the model-only resolver | Met | `getCodexConfig('code_review', tasks)` supplies model and effort; the retired symbol has zero hits under `scripts/`, `tests/`, and `src/`. |
| AC-3: cold argv, red-first | Met | The exact-argv test failed pre-fix on the missing `-c` pair and now passes with no cold `--sandbox` flag. |
| AC-4: fresh/resumed argv | Met | Full `deepEqual` assertions cover both paths and mask only the generated prompt element. |
| AC-5: effort validation | Met | Separate fresh, resumed, and cold tests assert exit 1, no fake-binary invocation, the invalid value, valid set, and user-config precedence. |
| AC-6: telemetry row, red-first | Met | A successful cold review writes one distinct Codex row with joined task ID, round, resolved model, duration, status, and summed usage. |
| AC-7: failed attempts also log exactly once | Met | Normal incomplete-stream and pre-spawn guard tests each assert exactly one failed row and zero ok rows. |
| AC-8: existing contracts preserved | Met | Cold empty/truncated/hard-fail tests and existing Codex failure ladders pass; the prompt golden is unchanged. |
| AC-9: token parsing parity | Met | Usage totals input plus output; absent usage produces `-` without failing the successful review. |
| AC-10: docs | Met | Root-only decision amended, orchestrator matrix/invocation docs updated, and the managed mirror is byte-aligned. |

## Edge Cases Considered

- Invalid policy effort is rejected before any fresh, resumed, or cold process spawn.
- A cold guard failure records before `die()` so real `process.exit()` cannot skip the row.
- Incomplete streams, empty findings, spawn errors, stalls, and signals retain the existing unsuccessful result path and record failure through `finally`.
- Completed streams without usage preserve success while rendering a dash in telemetry.
- Delicate/XL resolution remains mini/high for the cold lens even though other Codex phases can select the full model.

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
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed with exit 0. |
| `npm run type-check` | Pass | TypeScript completed with exit 0. |
| `npm test` | Pass | 975 passed, 0 failed, 1 skipped. |
| `npm run build` | Pass | Rebuilt both entry points; only `dist/scripts/run-task.js` changed. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files are in sync. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

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
