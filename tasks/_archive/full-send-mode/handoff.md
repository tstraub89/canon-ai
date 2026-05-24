# Implementation Handoff: full-send-mode

> Author: Codex | Spec: `tasks/full-send-mode/spec.md` | Plan: `tasks/full-send-mode/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `.canon/templates/status.json` | Added `full_send` defaulting to `false` and documented the field inline with `_full_send`. |
| `templates/.canon/templates/status.json` | Mirrored the status template update in lockstep with `.canon/templates/status.json`. |
| `scripts/run-task/types.ts` | Added `StatusJson.full_send`, `CliArgs.fullSend`, and `CliArgs.force`, with the full-send safety note on future human-interrupt gates. |
| `scripts/run-task/cli.ts` | Parsed `--full-send` and `--force`, added the mutual-exclusion guard for `--reroute`, and updated usage text. |
| `src/cli/index.ts` | Added `--full-send` and `--force` to the top-level `canon run` help output. |
| `src/cli/deps.ts` | Marked `--full-send` as requiring `gh` in dependency checks. |
| `scripts/run-task/main.ts` | Wired full-send into phase routing, PR creation, reroute clearing, the delicate `--force` check, and the full-send completion banner. |
| `scripts/run-task/phases/spec-review.ts` | Short-circuited the spec-gate interrupt when `status.full_send === true`. |
| `scripts/run-task/prompts/index.ts` | Passed the active full-send state into the spec-review prompt builder. |
| `scripts/run-task/prompts/templates/spec-review.md` | Added the conditional full-send rigor block for Codex spec review. |
| `.claude/skills/canon-spec/SKILL.md` | Added full-send detection, acknowledgment, force threading, and draft-PR invocation to the skill. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Mirrored the skill update in lockstep with the source copy. |
| `AGENTS.md` | Documented full-send mode for agents, including the `--force` rule and reroute behavior. |
| `templates/AGENTS.md` | Mirrored the AGENTS update in lockstep. |
| `CLAUDE.md` | Added operator-Claude guidance for passing `--full-send` and `--force`. |
| `templates/CLAUDE.md` | Mirrored the Claude guidance update in lockstep. |
| `CODEX.md` | Added Codex spec-review guidance for full-send mode. |
| `templates/CODEX.md` | Mirrored the Codex guidance update in lockstep. |
| `docs/decisions.md` | Recorded the full-send design decision and the rejected `manual_canon` framing. |
| `CHANGELOG.md` | Added the unreleased 1.4.0 adopter-facing entry for full-send mode. |
| `tests/task-cli.test.ts` | Updated default-behavior coverage to assert the new `full_send` default. |
| `tests/run-task-canon-snapshot.test.ts` | Added `full_send: false` to the canon snapshot fixture coverage. |
| `tests/run-task-counter-schema.test.ts` | Added `full_send: false` to the status schema fixture coverage. |
| `tests/run-task-prompts.test.ts` | Added prompt coverage for the full-send spec-review rigor block. |
| `tests/run-task-safety.test.ts` | Added dispatcher, reroute, delicate-gate, and full-send tail coverage. |
| `tests/run-task-cli.test.ts` | Added direct `parseArgs` coverage for `--full-send`, `--force`, and the reroute exclusion. |
| `dist/cli/index.js` | Rebuilt the CLI bundle so the checked-in dist matches the source changes. |
| `dist/scripts/run-task.js` | Rebuilt the run-task bundle so the checked-in dist matches the source changes. |

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

Full-send is implemented as a status-driven mode, not a separate pipeline. `canon run --full-send` writes `full_send: true` and clears `human_spec_gate` before routing begins, then the existing dispatcher treats a clean QA completion as the trigger to run the existing PR-creation path inline. That keeps the review chain intact, makes the mode resumable from `status.json`, and leaves reroute and delicate-task safety explicit instead of implicit.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| None | The implementation matched the approved plan and the spec, including the `createPR` refactor, full-send tail, prompt injection, and doc updates. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `status.json` templates now carry `full_send: false`; the default-behavior tests assert the new default. |
| AC-2 | Met | `--full-send` is parsed, persisted before routing, and exposed in both help surfaces. |
| AC-3 | Met | `--force` is parsed, documented, and enforced for delicate + full-send combinations with the spec message. |
| AC-4 | Met | The full-send tail runs the human-review gate, invokes the PR path, advances `human_review`, and prints the completion banner. |
| AC-4a | Met | `commitHumanReviewFiles(taskIds, cwd, createPR)` now accepts the explicit PR-creation switch and the call sites pass `cliArgs.pr`. |
| AC-4b | Met | The banner captures the PR URL via `inspectCompleteState` and falls back to the placeholder when needed. |
| AC-4c | Met | Multi-branch bundles are rejected before the gate or PR path runs. |
| AC-5 | Met | `human_review.status` is only advanced after the helper succeeds, preserving bundle atomicity and retry behavior. |
| AC-6 | Met | `rerouteFromHumanReview` clears `full_send`, prints the warning, and `parseArgs` rejects `--reroute --full-send`. |
| AC-7 | Met | The completion banner text matches the spec and prints the captured PR URL. |
| AC-8 | Met | The canon-spec skill now detects full-send intent, acknowledges it, threads `--force` for delicate tasks, and invokes `canon run --full-send`. |
| AC-9 | Met | The skill writes the full-send spec banner into `spec.md` rather than relying on template substitution. |
| AC-10 | Met | `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and their templates were updated in lockstep, plus changelog and decision notes. |
| AC-11 | Met | The spec-review prompt template injects the conditional full-send rigor paragraph when `status.full_send === true`. |
| AC-12 | Met | New and updated tests cover the CLI, defaults, dispatcher behavior, prompt injection, reroute clearing, and the delicate guard. |
| AC-13 | Met | `recordMetric()` honors `CANON_METRICS_FILE_OVERRIDE`; the spawned tests use isolated temp telemetry files, and the suite-end docs cleanliness assert passes. |

## Edge Cases Considered

- Full-send on a delicate task still needs `--force`, even if `full_send: true` was already hand-edited into `status.json`.
- `canon run --reroute` clears `full_send` but then resumes `implement` immediately, so the post-reroute state can already show `implement.status = in_progress`.
- Multi-branch bundles are rejected before `checkPhaseGate` or `commitHumanReviewFiles` can touch any task state.
- The PR URL banner uses a placeholder instead of failing if `inspectCompleteState` cannot observe the PR immediately after creation.
- The spec-review prompt only becomes stricter when `status.full_send === true`; normal tasks keep the existing review rubric.

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
| `lint` (`npm run lint`) | Pass | Final-state lint passed after the last assertion tweak. |
| `type-check` (`npm run type-check`) | Pass | Final-state type-check passed. |
| `test` (`npm test` — the full suite, including the new tests added per AC-12 and the AC-13 telemetry isolation coverage) | Pass | Final run passed: 370 tests passed, 1 test skipped by the sandboxed `.git`-write guard. |
| `build` (`npm run build`) | Pass | Final-state build passed and regenerated the checked-in `dist/` bundles. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/release/v1.4` (HEAD is ahead by 2 commits and not behind)

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

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
| `.claude/skills/canon-spec/SKILL.md` | Added the Phase 5 full-send spec banner instruction and the exact delicate-task acknowledgment block in Phase 6. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Mirrored the Phase 5 / Phase 6 full-send skill updates in lockstep with the source copy. |
| `scripts/run-task/main.ts` | Refreshed `ghAvailable` inside `commitHumanReviewFiles()` when PR creation is requested so direct helper coverage can reach the PR branch. |
| `tests/run-task-cli.test.ts` | Added standalone `--force` parsing coverage without `--full-send`. |
| `tests/run-task-safety.test.ts` | Added direct helper coverage for `commitHumanReviewFiles(createPR = false|true)`, the full-send gate failure paths, the hand-edited delicate+full_send guard, the PR URL placeholder fallback, and the draft-PR failure path. |
| `dist/scripts/run-task.js` | Rebuilt after the `commitHumanReviewFiles()` seam change. |
| `tasks/full-send-mode/notes.md` | Appended revision notes for the helper-test seam and PR banner fallback behavior. |

### Findings addressed

- _correctness bug:_ AC-8(e) missing the prescribed delicate/full-send acknowledgment text → fixed at `.claude/skills/canon-spec/SKILL.md:170` and `templates/.claude/skills/canon-spec/SKILL.md:170`.
- _correctness bug:_ AC-9 missing the spec banner write instruction → fixed at `.claude/skills/canon-spec/SKILL.md:131` and `templates/.claude/skills/canon-spec/SKILL.md:131`.
- _spec gap:_ AC-12 missing the standalone `--force` parse test, the direct `commitHumanReviewFiles()` PR-creation coverage, the hand-edited delicate/full_send rejection, the full-send gate failure path, and the PR fallback/failure cases → covered by `tests/run-task-cli.test.ts:82`, `tests/run-task-safety.test.ts:1298`, `tests/run-task-safety.test.ts:1359`, `tests/run-task-safety.test.ts:1487`, and `tests/run-task-safety.test.ts:1593`.

### AC deltas

- AC-8: was Partial → now Met (`.claude/skills/canon-spec/SKILL.md:170`)
- AC-9: was Partial → now Met (`.claude/skills/canon-spec/SKILL.md:131`)
- AC-12: was Partial → now Met (`tests/run-task-cli.test.ts:82`, `tests/run-task-safety.test.ts:1298`)

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Final-state lint passed after the iteration 2 fixes. |
| `type-check` (`npm run type-check`) | Pass | Final-state type-check passed after the iteration 2 fixes. |
| `test` (`npm test`) | Pass | 368 tests passed, 1 skipped by the sandboxed `.git`-write guard. |
| `build` (`npm run build`) | Pass | Final-state build passed and regenerated `dist/scripts/run-task.js`. |

## Iteration 3 — addressing reroute 1

### Changes

| File | What Changed |
|---|---|
| `scripts/run-task/metrics.ts` | Replaced the module-load-time telemetry file constant with `getMetricsFile()` / `CANON_METRICS_FILE_OVERRIDE` so tests can redirect telemetry writes away from the real repo docs. |
| `tests/run-task-safety.test.ts` | Made spawned canon processes inherit a unique temp telemetry file by default and added a direct `recordMetric()` override test. |
| `tests/task-cli.test.ts` | Added the suite-end docs cleanliness assert covering `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, and `docs/lessons-learned.md`. |
| `docs/lessons-learned.md` | Added the telemetry-pollution lesson distilled from the reroute. |
| `docs/pipeline-invocations.md` | Removed the polluted `task-a | implement` telemetry rows from the worktree so the final diff stays clean. |
| `docs/task-quality-log.md` | Added the QA log entry for the full-send-mode reroute, including the AC-13 pollution note. |
| `dist/scripts/run-task.js` | Rebuilt after the telemetry override change. |
| `tasks/full-send-mode/notes.md` | Added reroute notes about the telemetry override and suite-end cleanliness guard placement. |

### Findings addressed

- _spec gap:_ AC-13 new telemetry isolation requirement → fixed with `scripts/run-task/metrics.ts:7`, `tests/run-task-safety.test.ts:229`, and `tests/task-cli.test.ts:961`.
- _spec gap:_ AC-13(b) audit of other REPO_ROOT-derived modules → `scripts/run-task/worktree.ts` and `scripts/run-task/state.ts` were reviewed; no extra override was needed because the only write-path pollution was the metrics file and the existing task/worktree overrides already cover their mutable paths.
- _risk/guardrail:_ tests writing to real repo telemetry files → eliminated by redirecting spawned telemetry writes to temp paths and verifying the suite-end docs status stays clean.
- _docs coverage:_ `docs/lessons-learned.md`, `docs/pipeline-invocations.md`, and `docs/task-quality-log.md` are now listed in the handoff so the bundle verifier can see the AC-13 telemetry cleanup and QA-log artifacts.

### AC deltas

- AC-13: new amendment requirement → now Met (`scripts/run-task/metrics.ts:7`, `tests/run-task-safety.test.ts:229`, `tests/task-cli.test.ts:961`)

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Final-state lint passed after the reroute fixes. |
| `type-check` (`npm run type-check`) | Pass | Final-state type-check passed after the reroute fixes. |
| `test` (`npm test`) | Pass | 370 tests passed, 1 skipped by the sandboxed `.git`-write guard; the suite-end docs cleanliness assert passed. |
| `build` (`npm run build`) | Pass | Final-state build passed and regenerated `dist/scripts/run-task.js`. |

## Iteration 4 — addressing review round 3

### Changes

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | Switched the full-tier spec-gate bypass to `every(...)` so mixed bundles re-engage the gate for the whole invocation. |
| `scripts/run-task/phases/spec-review.ts` | Switched the fast-tier spec-gate bypass to `every(...)` so mixed bundles re-engage the gate for the whole invocation. |
| `tests/run-task-safety.test.ts` | Added fast-tier and full-tier mixed/all-full-send bundle coverage, plus fixtures for the auto-advance path. |
| `AGENTS.md` | Added the bundle-semantics sentence clarifying that every task must opt in for a bundle to skip the spec gate. |
| `templates/AGENTS.md` | Mirrored the bundle-semantics sentence in lockstep. |
| `dist/scripts/run-task.js` | Rebuilt after the gate-semantics change. |
| `tasks/full-send-mode/notes.md` | Recorded the fast-tier auto-advance artifact requirement discovered while proving the skip path. |

### Findings addressed

- _spec gap:_ AC-14 mixed-bundle bug (`some` bypassed the gate for normal tasks) → fixed at `scripts/run-task/main.ts:2162` and `scripts/run-task/phases/spec-review.ts:27`; both now use `every(...)`.
- _spec gap:_ AC-14 test matrix missing mixed/all-full-send coverage for both tiers → covered by `tests/run-task-safety.test.ts:1324`, `tests/run-task-safety.test.ts:1367`, `tests/run-task-safety.test.ts:1672`, and `tests/run-task-safety.test.ts:1715`.
- _risk/guardrail:_ bundle semantics needed durable docs wording → added to `AGENTS.md` and `templates/AGENTS.md` in lockstep.
- _optional cleanup/nit:_ fast-tier auto-advance requires populated `spec-review.md` and `plan.md` artifacts even when proving the skip path → captured in `tasks/full-send-mode/notes.md` and encoded in the new fixture helpers.

### AC deltas

- AC-14: was Partial → now Met (`scripts/run-task/main.ts:2162`, `scripts/run-task/phases/spec-review.ts:27`, `tests/run-task-safety.test.ts:1324`)

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Final-state lint passed after the AC-14 fixes. |
| `type-check` (`npm run type-check`) | Pass | Final-state type-check passed after the AC-14 fixes. |
| `test` (`npm test`) | Pass | 374 tests passed, 1 skipped by the sandboxed `.git`-write guard. |
| `build` (`npm run build`) | Pass | Final-state build passed and regenerated `dist/scripts/run-task.js`. |
