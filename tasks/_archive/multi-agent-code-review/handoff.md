# Implementation Handoff: multi-agent-code-review

> Author: Codex | Spec: `tasks/multi-agent-code-review/spec.md` | Plan: `tasks/multi-agent-code-review/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `.claude/agents/code-review-anchored.md` | Added the anchored lens agent definition that applies the current Stage 1 / Stage 2 code-review charter and returns structured findings to the foreman without writing artifacts or setting verdicts. |
| `.claude/agents/code-review-cold.md` | Added the spec-blind cold lens agent definition that reviews only the diff/base ref and returns structured adversarial findings to the foreman. |
| `.canon/templates/review.md` | Added foreman-oriented review sections, dismissed cold findings, and the `Spec gap` verdict checkbox for round 1 and re-review rounds. |
| `.canon/templates/status.json` | Added `spec_gap` to the verdict-values template hint. |
| `AGENTS.md` | Documented the code-review foreman/lens workflow, `spec_gap` bundle behavior, and human-amendment routing. |
| `CLAUDE.md` | Updated Claude code-review responsibilities for the synthesis foreman, anchored/cold lenses, and `spec_gap` handling. |
| `dist/cli/index.js` | Rebuilt CLI output after verdict-help changes. |
| `dist/scripts/run-task.js` | Rebuilt run-task bundle after prompt, routing, validation, and template import changes. |
| `docs/pipeline-orchestrator.md` | Updated bundle semantics, routing table, and prompt/diff injection notes for foreman/lens code review and `spec_gap`. |
| `scripts/run-task/main.ts` | Intercepts code-review `spec_gap` verdicts before fall-through, auto-blocks `code_review` with an escalation, and prints the human triage/resume path. |
| `scripts/run-task/prompts/index.ts` | Registers `code-review-foreman.md` and makes `promptCodeReview()` always render the foreman prompt while preserving round detection and scoped diff injection. |
| `scripts/run-task/prompts/templates/code-review-foreman.md` | Added the foreman prompt that spawns the anchored and cold lenses, dedups/reconciles findings, classifies altitude, writes `review.md`, and sets the verdict. |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | Marked the old round-1 prompt as retained for the anchored lens charter reference rather than direct review dispatch. |
| `scripts/run-task/prompts/templates/code-review-round-n.md` | Marked the old round-N prompt as retained for the anchored lens charter reference rather than direct review dispatch. |
| `scripts/run-task/types.ts` | Added `spec_gap` to `_VERDICT_VALUES` / `Verdict` and updated the counter-reset comment. |
| `scripts/run-task/validation.ts` | Added checked-checkbox extraction for `Spec gap`, so code-review phase gates can match the verdict in `review.md`. |
| `src/cli/index.ts` | Added `spec_gap` to the `canon task phase` help verdict list. |
| `src/lib/canon-owned.ts` | Registered the two new Claude agent lens definitions as canon-owned files. |
| `src/task/index.ts` | Added `spec_gap` to runtime verdict validation, runtime error text, and review counter behavior. |
| `templates/.canon/templates/review.md` | Synced the review-template mirror with the new foreman sections and `Spec gap` checkbox. |
| `templates/.canon/templates/status.json` | Synced the status-template mirror with the `spec_gap` verdict hint. |
| `templates/.claude/agents/code-review-anchored.md` | Added adopter mirror for the anchored lens definition. |
| `templates/.claude/agents/code-review-cold.md` | Added adopter mirror for the cold lens definition. |
| `templates/AGENTS.md` | Synced adopter AGENTS content with the foreman/lens and `spec_gap` documentation. |
| `templates/CLAUDE.md` | Synced adopter CLAUDE content with the foreman/lens and `spec_gap` documentation. |
| `templates/docs/pipeline-orchestrator.md` | Synced adopter pipeline-orchestrator docs with the new code-review routing and prompt model. |
| `tests/run-task-counter-schema.test.ts` | Added coverage that `spec_gap` increments total review iterations and resets the current loop/preflight counters like an approval. |
| `tests/run-task-extract-verdict.test.ts` | Added checked `Spec gap` extraction tests for bolded, unbolded latest-round, unchecked, and misspelled cases. |
| `tests/run-task-prompts.golden.json` | Regenerated code-review prompt goldens after switching to the foreman prompt. |
| `tests/run-task-prompts.test.ts` | Added assertion that `promptCodeReview()` renders the synthesis foreman and both lens subagent types. |
| `tests/run-task-safety.test.ts` | Added subprocess coverage that `checkAndRoute('code_review')` blocks on `spec_gap`, appends an escalation, and does not advance `qa`. |
| `tests/run-task-validation.test.ts` | Added code-review phase-gate coverage for `spec_gap` with the `Spec gap` checkbox checked. |
| `tests/task-cli.test.ts` | Added runtime CLI/task-helper coverage that `canon task phase ... code_review done spec_gap` is accepted and writes counters. |

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

`code_review` now runs as a synthesis foreman by prompt contract: the phase session receives the normal Claude code-review tier, spawns an anchored lens and a spec-blind cold lens, reconciles their outputs, writes the single review artifact, and records the verdict the existing dispatcher consumes. The Node changes stay focused on deterministic safety: verdict validation, checked-verdict parsing, `spec_gap` routing, template/docs sync, canon-owned registration, and tests around those surfaces.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| No edit to `scripts/run-task/agents/claude.ts`. | Existing `runClaude()` already starts the phase session at the selected `code_review` model/effort and gives it the active checkout. The lens mechanism is Claude agent definitions with no model override, so the lenses inherit the foreman's selected tier without a runner branch. | Meets AC-1 and AC-8; avoids unnecessary hot-path runner churn. |
| No Node synthesis/dedup layer added. | This matches the spec decision that synthesis is all-LLM for the MVP; deterministic tests cover the phase boundary, verdict plumbing, routing, and prompt contract. | Meets AC-4 and AC-11 as written; synthesis quality remains in the Human Test Plan. |
| Old code-review round templates were retained with charter-reference comments. | `promptCodeReview()` no longer returns them for direct review. Keeping them available preserves the current anchored-review charter text for future lens refinement without a second dispatch path. | Meets AC-2 and AC-7. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: structure | Met | `PHASE_ORDER` is unchanged in `scripts/run-task/types.ts`; `promptCodeReview()` renders `code-review-foreman.md`; routing and counters remain under `code_review`. |
| AC-2: anchored lens | Met | `.claude/agents/code-review-anchored.md` applies Stage 1/Stage 2/test-integrity review and explicitly forbids writing `review.md` or running `canon task phase`. |
| AC-3: cold lens + isolation | Met | `.claude/agents/code-review-cold.md` and `code-review-foreman.md` constrain the cold lens to diff/base ref only and explicitly forbid spec, AC, handoff, review, notes, and canon-doc context. |
| AC-4: adjudication/synthesis outcomes | Met | `code-review-foreman.md` instructs dedup, cold-vs-spec dismissal with recorded spec reason, altitude classification, and no novel full diff re-review by the foreman. |
| AC-5: altitude + verdict + routing | Met | `code-review-foreman.md` maps code-bugs to `changes_requested` and spec gaps to `spec_gap`; `scripts/run-task/main.ts` intercepts `spec_gap`, calls `autoBlockPhase()`, appends escalation state, and exits before `qa` fall-through. |
| AC-6: fail-loud phase level | Met | `scripts/run-task/validation.ts` now recognizes `Spec gap` while preserving the existing filled-artifact/verdict-match gate; tests cover accepted `spec_gap` and rejected missing/mismatched verdicts. |
| AC-7: effects to delete | Met | `promptCodeReview()` now returns only the foreman prompt; the direct single-review prompt path is no longer selected for `code_review`. |
| AC-8: models reuse existing tier | Met | No policy matrix was added or changed; both lens defs declare no model override and inherit the foreman's existing `code_review` tier, which remains covered by `tests/pipeline-policy.test.ts`. |
| AC-9: single artifact + re-review | Met | `code-review-foreman.md` instructs one `tasks/<id>/review.md`; round-N prompt text says both lenses re-run from scratch after each implement reroute. |
| AC-10: verdict plumbing all seven surfaces | Met | Updated `scripts/run-task/types.ts`, `src/task/index.ts`, `src/cli/index.ts`, `.canon/templates/status.json` and mirror, `scripts/run-task/validation.ts`, `.canon/templates/review.md` and mirror, and `scripts/run-task/main.ts`. |
| AC-11: testing matrix | Met | Added deterministic tests for verdict extraction, phase gate, CLI/runtime acceptance, counters, `spec_gap` routing, and prompt subagent contract; existing policy tests cover code-review tier resolution. |
| AC-12: docs | Met | Updated root and mirrored `AGENTS.md`, `CLAUDE.md`, `docs/pipeline-orchestrator.md`, registered/mirrored lens agent defs, and passed template sync plus docs refs checks. |

## Edge Cases Considered

- Mixed bundles: a `spec_gap` from any task blocks the whole bundle for human amendment, matching the spec's bundle semantics.
- Cold-lens truncation: the foreman prompt allows changed-file inspection only for omitted diff context and keeps the cold lens spec-blind.
- Malformed or missing `review.md` verdicts: the existing phase gate still rejects unfilled/mismatched artifacts instead of silently approving.
- Re-review after implementation reroute: the foreman prompt forces both lenses to rerun from scratch instead of reusing prior lens conclusions.

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
| Linting (`npm run lint`) | Pass | Completed with no lint errors. |
| Type checking (`npm run type-check`) | Pass | Completed with no type errors. |
| Unit tests (`npm test`) | Pass | Full suite passed: 753 passing, 1 skipped. |
| Full build (`npm run build`) | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| Docs references (`npm run docs-refs-check`) | Pass | Re-run after handoff write; all refs OK. |
| Canon-managed template sync (`npm run sync-templates:check`) | Pass | All canon-managed files reported in sync. |
| End-to-end tests | not_configured | Spec marks E2E N/A per `docs/architecture.md`; no E2E surface in canon-ai. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>` (local `release/v1.10` and `origin/release/v1.10` both at `b2ff160664c8fb83d2f315e6d35865b735815def`)

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
