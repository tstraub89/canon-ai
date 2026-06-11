# Implementation Handoff: recovery-surface-hardening

> Author: Codex | Spec: `tasks/recovery-surface-hardening/spec.md` | Plan: `tasks/recovery-surface-hardening/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `src/task/index.ts` | Added a pre-mutation review-verdict guard for `canon task accept` on `spec_review` and `code_review`, with `--force` bypass warnings. |
| `scripts/run-task/main.ts` | Scoped spec-gap reroute amendment pre-flight to tasks whose `code_review` verdict is `spec_gap`; writes a default-absent `reroute_exempt` marker for non-gap siblings and clears it on later non-exempt reroutes. |
| `scripts/run-task/validation.ts` | Taught `checkRerouteEvidence` to treat `reroute_exempt: true` siblings as first-pass for spec-review and plan evidence gates. |
| `scripts/run-task/prompts/index.ts` | Added verdict-aware reroute-exempt prompt lines so approved siblings keep the original approved wording while `changes_requested` / `needs_re_review` siblings point implementers at existing review findings. |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | Made amendment-review instructions exempt-aware so non-gap siblings are not asked for missing amendment sections. |
| `scripts/run-task/prompts/templates/plan-reroute.md` | Made reroute-plan instructions exempt-aware so non-gap siblings are not asked for missing reroute-plan sections. |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Made generic exempt-task instructions defer to the per-task line, preserving failing sibling review obligations. |
| `tests/task-cli.test.ts` | Added direct accept coverage for missing review verdicts, forced override, bundle atomic refusal, `spec_review` parity, and `needs_re_review` sanctioning. |
| `tests/run-task-reroute-preflight.test.ts` | Added mixed-bundle spec-gap reroute coverage, exempt sibling evidence-gate coverage, second-reroute round-heading regression coverage, and failing-sibling prior-verdict preservation for both review-failure verdicts. |
| `tests/run-task-prompts.test.ts` | Added prompt flavor coverage for approved and failing reroute-exempt siblings across spec-review, plan, and implement reroute prompts. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt golden fixture after the implement-reroute template wording changed. |
| `docs/pipeline-orchestrator.md` | Updated operator recovery docs for verdictless accept refusal and spec-gap-only amendment requirements in mixed bundles. |
| `templates/docs/pipeline-orchestrator.md` | Synced the derived template copy of the pipeline orchestrator docs. |
| `dist/cli/index.js` | Regenerated bundled CLI output from the source changes. |
| `dist/scripts/run-task.js` | Regenerated bundled orchestrator output from the source changes. |

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

Implemented the recovery hardening at the existing gates. `taskAccept` now performs a read-only scan for empty review verdicts before any rollback snapshot or status write, so single-task and bundle refusal is atomic unless `--force` is explicit. Spec-gap reroute pre-flight checks amendment headings only for tasks whose current code-review verdict is `spec_gap`; non-gap siblings are marked with a current-round exemption so spec-review and plan evidence gates do not demand amendment artifacts from unchanged specs. The reroute amendment adds verdict-aware prompt semantics: exempt siblings also retain their pre-reset verdict so approved siblings can ride the bundle, while failing siblings keep their existing review findings binding during implementation.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Kept `reroute_exempt` as a locally narrowed additive status marker instead of adding it to `scripts/run-task/types.ts`. | The spec's source Affected Files did not include `scripts/run-task/types.ts`, and `checkRerouteEvidence` already treats status JSON as `unknown` at the boundary. This preserves the planned behavior without expanding scope. | None; AC-5/6/8 are covered by tests. |
| Updated and synced `docs/pipeline-orchestrator.md` plus `templates/docs/pipeline-orchestrator.md`. | The spec's Docs Impact section called out this doc if its recovery wording was stale; `sync-templates:check` requires the derived template copy to match. | None; docs now match the implemented recovery contract. |
| Used "passing" language in failing-sibling prompt lines instead of the plan's literal "approved" negation. | AC-9 requires failing sibling lines not describe the task as approved. Avoiding the word entirely makes the line-level assertion stronger and prevents false matches on negated wording such as "do not treat as approved." | None; AC-9 prompt tests assert failing-sibling lines do not contain `approved`. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `tests/task-cli.test.ts` asserts single-task `code_review` and `spec_review` refusal with no verdict, message content, unchanged `status.json`, and no notes audit line. |
| AC-2 | Met | `tests/task-cli.test.ts` asserts `--force` sanctions a verdictless `spec_review`, advances status, and writes the notes audit line. The same guarded path is shared by `code_review`. |
| AC-3 | Met | Existing sanction tests still pass for `spec_gap` and `changes_requested`; a new `needs_re_review` regression test confirms non-empty verdicts are not blocked. |
| AC-4 | Met | `tests/task-cli.test.ts` asserts bundled `code_review` and `spec_review` refusal names only the verdictless task and leaves every task's status and notes unchanged. |
| AC-5 | Met | `tests/run-task-reroute-preflight.test.ts` now reroutes a mixed `spec_gap`/`approved` bundle with only the gap task amended and asserts reroute bookkeeping plus sibling exemption. |
| AC-6 | Met | `checkRerouteEvidence` returns first-pass behavior for `reroute_exempt: true`; `tests/run-task-reroute-preflight.test.ts` covers both spec-review and plan evidence checks. |
| AC-7 | Met | The pre-flight skip is gated by `isSpecGapReroute`; human-review reroutes still check every task. Existing human-review reroute tests passed in the full suite. |
| AC-8 | Met | `tests/run-task-reroute-preflight.test.ts` asserts a second spec-gap reroute requires exact `## Amendment Round 2` headings for both a task with stale `## Amendment` and a previously exempt task with no amendment headings. |
| AC-9 | Met | `tests/run-task-reroute-preflight.test.ts` covers `changes_requested` and `needs_re_review` siblings rerouting without B amendments and preserving `reroute_exempt_prior_verdict`; `tests/run-task-prompts.test.ts` asserts implement-reroute lines name the exact prior verdict, point at review findings, and do not contain `approved`. Spec-review and plan reroute lines also avoid approved wording for failing siblings. |
| AC-10 | Met | `tests/run-task-reroute-preflight.test.ts` asserts `checkRerouteEvidence` still returns first-pass behavior for an exempt sibling carrying `reroute_exempt_prior_verdict: 'changes_requested'`. |
| AC-11 | Met | Existing AC-5/6/8 tests still pass; approved-sibling prompt wording is preserved by the approved prior-verdict path; post-reroute status tests assert `reroute_exempt_prior_verdict` survives after `code_review.verdict` is cleared. |

## Edge Cases Considered

- Verdictless accept refusal runs before `git rev-parse HEAD`, rollback snapshots, status writes, and notes writes, so a bundle cannot partially mutate.
- `--force` bypass keeps current sanction behavior and emits per-task warnings for verdictless review phases.
- Only `reroute_exempt === true` bypasses reroute evidence checks; malformed or absent values fall back to the existing fail-closed reroute logic.
- Later reroutes delete `reroute_exempt` for gap tasks and human-review reroutes, so exemptions do not leak across rounds.
- The existing round counter still advances on every reroute entry, so previously exempt siblings require the next round heading if they become a gap task later.
- `reroute_exempt_prior_verdict` is written before the code-review verdict reset and deleted whenever the exemption is absent, so prompt flavoring has the old verdict without leaking stale values.
- The implement-reroute template's generic exempt guidance defers to per-task lines because approved and failing exempt siblings have different obligations.

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
| `lint` (`npm run lint`) | Pass | |
| `type-check` (`npm run type-check`) | Pass | |
| `unit tests` (`npm test`) | Pass | Full suite: 832 pass, 1 skipped. Focused `tests/run-task-prompts.test.ts` and `tests/run-task-reroute-preflight.test.ts` also passed after reroute edits. |
| `build` (`npm run build`) | Pass | Regenerated `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | |
| `docs-refs-check` (`npm run docs-refs-check`) | Pass | |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>`

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
