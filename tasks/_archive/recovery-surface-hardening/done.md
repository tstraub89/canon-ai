# Completion Summary: recovery-surface-hardening — Guard canon task accept against missing verdicts; scope reroute amendment pre-flight to spec_gap tasks

> For the human. This is what you need to know.

## What Changed

Two operator-recovery gaps from v1.11.0 are now closed, plus an amendment that hardened the exemption logic for failing-verdict siblings.

**Verdict guard on `canon task accept`** — Previously, running `canon task accept myTask code_review --reason "..."` before the review phase had ever run would silently advance the task with no review recorded. The command now refuses before touching any state, prints a clear message naming the task and pointing at `--force` as the explicit bypass. In bundle mode it checks every task atomically before mutating any of them. Blocked-but-empty-verdict reviews (e.g. from an infrastructure halt) also require `--force` — the intended fail-closed direction. Reviews with real verdicts (`spec_gap`, `changes_requested`, etc.) sanction exactly as before.

**Mixed-bundle spec_gap reroute** — When a bundle blocked at `code_review` with one task at `spec_gap` and a sibling already `approved`, the recovery banner correctly told the operator to amend only the gap task's spec — but the reroute pre-flight demanded an `## Amendment` heading from every task in the bundle, including the approved one. Non-gap siblings are now exempt from the amendment requirement for that reroute round; a `reroute_exempt` marker lets the downstream spec-review and plan evidence gates treat them as first-pass. Exemptions clear on later reroutes so round-heading numbering stays collision-free. Human-review-entry reroutes are unchanged — every task must amend.

**Failing-sibling verdict preservation** (Amendment, AC-9/10/11) — The original exemption treated every non-spec_gap sibling as if it were approved, which would silently drop unresolved `changes_requested` or `needs_re_review` findings during a spec_gap reroute. The exemption now stores the pre-reset verdict as `reroute_exempt_prior_verdict`. Approved siblings continue to ride the reroute with approved-flavor prompts; failing siblings get a different implement-reroute prompt that names the prior verdict and directs the implementer at the existing `review.md` findings. `reroute_exempt_prior_verdict` is written before verdict-clearing reset and deleted when the exemption is absent, preventing cross-round contamination.

## Files Changed

- `src/task/index.ts` — Verdict-exists guard in `taskAccept` for `spec_review`/`code_review` phases; pre-mutation, per-task, `--force` bypass
- `scripts/run-task/main.ts` — Spec-gap reroute pre-flight scoped to gap tasks only; `reroute_exempt` and `reroute_exempt_prior_verdict` marker lifecycle
- `scripts/run-task/validation.ts` — `checkRerouteEvidence` treats `reroute_exempt: true` siblings as first-pass for spec-review and plan evidence gates
- `scripts/run-task/prompts/index.ts` — Verdict-aware reroute-exempt prompt lines (approved vs. failing flavor)
- `scripts/run-task/prompts/templates/implement-reroute.md` — Generic exempt guidance defers to per-task lines
- `scripts/run-task/prompts/templates/spec-review-reroute.md` — Exempt-aware amendment-review instructions
- `scripts/run-task/prompts/templates/plan-reroute.md` — Exempt-aware reroute-plan instructions
- `tests/task-cli.test.ts` — New cases: verdictless accept refusal (single-task and bundle), forced override, spec_review parity, needs_re_review regression
- `tests/run-task-reroute-preflight.test.ts` — Mixed-bundle spec-gap reroute cases; evidence-gate coverage; second-reroute round-heading regression; failing-sibling prior-verdict preservation for both review-failure flavors
- `tests/run-task-prompts.test.ts` — Prompt flavor coverage for approved and failing exempt siblings across spec-review, plan, and implement reroute prompts
- `tests/run-task-prompts.golden.json` — Regenerated after implement-reroute template wording change
- `docs/pipeline-orchestrator.md` — Operator recovery docs updated for verdictless-accept refusal and spec-gap-only amendment requirement
- `templates/docs/pipeline-orchestrator.md` — Derived template synced
- `dist/cli/index.js` — Rebuilt from `src/task/index.ts` changes
- `dist/scripts/run-task.js` — Rebuilt from `main.ts`, `validation.ts`, prompts changes

## How to Test

The spec's Human Test Plan:

1. Create a throwaway task (`canon task new scratch-test "Scratch"`). Before running any review, run `canon task accept scratch-test code_review --reason "test"`. Expected: the command exits non-zero, names the task, states no review verdict exists, and suggests running the review or using `--force`. The task's `status.json` is unchanged — no `sanctioned` verdict, no notes audit line.

2. Repeat with `canon task accept scratch-test code_review --reason "test" --force`. Expected: the command proceeds normally, writes `verdict: sanctioned` and `status: done` in `status.json`, and appends an audit line to `notes.md`.

3. On a two-task bundle where one task's code review returned `spec_gap` and the other is `approved`: amend only the gap task's `spec.md` with an `## Amendment` section, then run `canon run <gapTask> <approvedTask> --reroute`. Expected: the reroute proceeds without aborting on the approved task, and the bundle runs through spec_review → plan → implement → code_review without demanding amendment evidence from the approved task's spec.

## Test Results

| Check | Result | Notes |
|---|---|---|
| Lint | Pass | |
| Type-check | Pass | |
| Unit tests | Pass | 832 pass, 1 skipped — includes new task-cli, reroute-preflight, and prompts test cases |
| Build | Pass | `dist/cli/index.js` and `dist/scripts/run-task.js` regenerated |
| sync-templates:check | Pass | |
| docs-refs-check | Pass | |

## Human Verification Required

None.

## Decisions Made

- **`reroute_exempt` marker kept local, not added to `scripts/run-task/types.ts`.** The spec's Affected Files did not include `types.ts`, and `checkRerouteEvidence` already treats `status.json` as `unknown` at the boundary. Keeping the marker local with explicit runtime narrowing stays within spec scope without expanding the shared type surface. Documented in handoff as a deviation.

- **Failing-sibling prompt lines use "passing" language rather than negating "approved".** AC-9 asserts the line must not contain "approved"; using an affirmative construction (naming the prior verdict, pointing at review findings) avoids false positives on negated wording like "do not treat as approved."

- **`reroute_exempt_prior_verdict` written before verdict-clearing reset and deleted when exemption is absent.** This ensures failing-sibling prompt flavor survives the reroute's state transition without leaking stale values into subsequent rounds.

## Open Questions

None. Both BACKLOG Harness Bug entries from PR #154 are resolved.

## Proposed Changelog

Target version: **1.11.1** (patch — bug fixes to the 1.11.0 operator-recovery surface; already the target version).

```markdown
### Fixed

- **`canon task accept` refuses to sanction a review phase with no recorded verdict.**
  Previously, running `canon task accept <id> code_review --reason "..."` before the review
  had run silently wrote `sanctioned` and advanced the task — skipping review entirely.
  It now exits non-zero with an actionable message naming the task and pointing to `--force`
  as the explicit bypass. Bundle invocations refuse atomically before mutating any task.

- **Mixed-bundle spec_gap reroutes no longer abort on non-gap sibling tasks.**
  When a bundle blocked at `code_review` with one task in `spec_gap` and another `approved`,
  amending only the gap task's spec and running `canon run A B --reroute` aborted on B for
  a missing `## Amendment` — contradicting the recovery banner's own guidance to amend only
  the gap task. Non-gap siblings are now exempt from the amendment requirement for that reroute
  round and pass downstream evidence gates without amendment artifacts. Siblings with unresolved
  `changes_requested` or `needs_re_review` verdicts are also exempt from amendment requirements
  but keep their prior review findings binding — the implement prompt names the prior verdict and
  directs the implementer at the existing `review.md`. Exemptions clear on subsequent reroutes so
  round-heading numbering stays collision-free.
```
