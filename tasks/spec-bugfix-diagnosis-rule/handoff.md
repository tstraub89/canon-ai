# Implementation Handoff: spec-bugfix-diagnosis-rule

> Author: Codex | Spec: `tasks/spec-bugfix-diagnosis-rule/spec.md` | Plan: `tasks/spec-bugfix-diagnosis-rule/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `.claude/skills/canon-spec/SKILL.md` | Added bug/flake-fix-only guidance to the spec-writing rules of thumb and the self-check list: confirm the failure mechanism in *Problem*, require a red-first regression-test AC, and use the within-reason escape with a deterministic alternative when a faithful repro is impractical. |
| `.canon/templates/spec.md` | Added bug/flake-fix-only guidance to the *Problem* section, *Acceptance Criteria* section, and Spec Quality Checklist so spec authors are told how to document a confirmed mechanism, a red-first regression-test AC, and the within-reason escape. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Regenerated mirror of the root skill file; now matches the new bug/flake-fix authoring guidance verbatim. |
| `templates/.canon/templates/spec.md` | Regenerated mirror of the root spec template; now matches the new bug/flake-fix authoring guidance verbatim. |

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

Re-homed the bug/flake-fix diagnosis rule onto the author-facing surfaces a spec writer actually reads, while keeping the wording conditional so feature/refactor specs are unchanged. The reroute wording now makes the `spec_review` obligation self-enforcing for the author on fast-tier tasks instead of implying a reviewer backstop. The root files were edited first and the `templates/` mirrors were regenerated from them to keep the managed pairs aligned.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none / describe what changed from the plan and why)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: mechanism-confirmation instruction in both surfaces | Met | The root skill bullet and the spec template `Problem` blockquote both state that bug/flake-fix specs must explain how the mechanism was confirmed. |
| AC-2: red-first regression-test AC in both surfaces | Met | The root skill bullet and the spec template `Acceptance Criteria` blockquote both require a regression-test AC that fails pre-fix for the stated reason and passes after. |
| AC-3: within-reason escape in both surfaces | Met | Both surfaces require saying why a faithful repro is impractical and naming a deterministic alternative instead of skipping verification. |
| AC-4: guidance stays bug/flake-fix conditional | Met | The added passages are explicitly scoped to bug/flake fixes; no unconditional item was added to the general rule list or general template checklist. |
| AC-5: no internal path references in the added text | Met | Verified with `git grep -n "scripts/run-task" .claude/skills/canon-spec/SKILL.md .canon/templates/spec.md`, which returned no matches. |
| AC-6: templates mirrors regenerated and in sync | Met | `npm run sync-templates:check` exited zero after the root edits and mirror regeneration. |
| AC-7: `spec_review` framing is self-enforcing and fast-tier aware | Met | The template now says the obligation is the author's to satisfy before the spec is marked done, and explicitly says fast-tier (S, non-delicate) tasks skip `spec_review` so no reviewer will catch an unverified mechanism. The skill mirrors that framing. |

## Edge Cases Considered

- The author-facing text stays concept-linked to the `spec_review` checkpoint without naming an internal prompt path, so the shipped guidance is compatible with the template sync gate.
- The bug/flake-fix scope guard prevents feature/refactor specs from inheriting a mandatory reproduction burden or red-first AC.
- The within-reason escape still requires a deterministic alternative, so environment-bound bugs do not silently lose verification.
- The `spec_review` mention no longer relies on reviewer enforcement; fast-tier tasks are told directly that the author must close the loop before marking the spec done.

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
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite passed. |
| `npm run sync-templates:check` | Pass | Confirmed root and mirror files are aligned. |
| `npm run docs-refs-check` | Pass | Confirmed the new prose introduces no broken refs. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js` after the runtime prompt and self-check updates so the shipped bundle matches source. |

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

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `scripts/run-task/prompts/templates/spec.md` | Added the bug/flake-fix rules-of-thumb bullet with the confirmed-mechanism requirement, the red-first regression-test AC requirement, and the two-part environment-bound escape predicate. |
| `scripts/run-task/prompts/templates/spec-revision.md` | Added the same bug/flake-fix rules-of-thumb bullet to keep reroute prompts aligned with the fresh-spec prompt. |
| `scripts/run-task/prompts/index.ts` | Updated the spec prompt self-check so bug/flake-fix specs must name the confirmed mechanism and include either a red-first regression-test AC or the two-part deterministic escape. |
| `tests/run-task-prompts.golden.json` | Regenerated the prompt snapshot so the spec prompt and spec-revision prompt now include the amended rules-of-thumb text. |
| `dist/scripts/run-task.js` | Rebuilt bundle that carries the prompt/template/self-check updates into the shipped CLI artifact. |
| `docs/pipeline-invocations.md` | Appended the reroute/validation entries from this round so the task telemetry stays current. |

### Findings addressed

- _spec gap:_ the runtime fresh-spec and reroute prompts now both carry the bug/flake-fix rule with the identical two-part escape predicate.
- _spec gap:_ the runtime spec prompt self-check now requires the confirmed mechanism plus red-first regression-test coverage, or the explicit environment-bound deterministic escape.
- _artifact drift:_ the prompt snapshot and bundled `dist/scripts/run-task.js` were regenerated after the prompt text changed.
- _telemetry:_ validation and reroute history for this round were appended to `docs/pipeline-invocations.md`.

### AC deltas

| AC | Status | Notes |
|---|---|---|
| AC-8: rules-of-thumb bullet present in both runtime prompts with identical two-part escape predicate | Met | `scripts/run-task/prompts/templates/spec.md` and `scripts/run-task/prompts/templates/spec-revision.md` now share the same bug/flake-fix guidance. |
| AC-9: runtime self-check includes the conditional bug/flake-fix item and the regenerated golden renders it | Met | `scripts/run-task/prompts/index.ts` now injects the conditional item and `tests/run-task-prompts.golden.json` reflects it. |
| AC-10: wording is consistent across all rules-of-thumb surfaces and all self-check homes | Met | The bug/flake-fix guidance now uses the same anti-pattern wording and the same environment-bound/impractical escape predicate everywhere. |
| AC-11: dist matches a fresh build and the prompt golden is regenerated | Met | `npm run build` rebuilt `dist/scripts/run-task.js`, and `UPDATE_GOLDENS=1 npm test` refreshed `tests/run-task-prompts.golden.json`. |

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-ran successfully after the prompt/self-check updates. |
| `npm run type-check` | Pass | Re-ran successfully after the prompt/self-check updates. |
| `npm test` | Pass | Re-ran with `UPDATE_GOLDENS=1` to refresh `tests/run-task-prompts.golden.json`; the suite passed. |
| `npm run build` | Pass | Required by the amended spec because the runtime prompts bundle into `dist/scripts/run-task.js`; rebuild completed successfully. |
