# Implementation Handoff: [TASK-ID]

> Author: Codex | Spec: `tasks/[TASK-ID]/spec.md` | Plan: `tasks/[TASK-ID]/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `<path>` | ... |

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

Brief explanation of the approach taken and why.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none / describe what changed from the plan and why)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not met | |
| AC-2: ... | Met / Partial / Not met | |

## Edge Cases Considered

- ...

## Blockers

- (none / list blockers — if an AC is infeasible, note it here rather than silently skipping)
- Label ambiguous ACs with `[ambiguity]` and document the interpretation you chose

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
| _(copy the exact check entry text from spec.md's Validation Required checklist — e.g. `` `lint` (`npm run lint`) ``)_ | Pass / Fail / not_configured / human_pending / deferred_by_spec / blocked | |

## Ready for Review

- [ ] All spec ACs met (see AC Coverage table above)
- [ ] All applicable validation checks pass (no failures)
- [ ] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

| File | What Changed |
|---|---|
| `<path>` | ... |

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
