# Code Review: code-review-codex-lens

> Reviewer: Claude | Spec: `tasks/code-review-codex-lens/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

> **Bootstrap note.** This task *adds* the cold-Codex third lens, but the orchestrator runs from the pre-merge base checkout — so this task's own `code_review` ran the current **two-lens** path (anchored Claude + cold-Claude). No live cold-Codex lens was available this round (this is the same bootstrap property the original multi-agent code-review task had; see spec Known Risks). The first true 3-lens exercise is the next task that runs `code_review` after this merges (Human Test Plan).

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Foreman re-ran independently and confirms green: `npm run type-check`, `npm run lint`, `npm run sync-templates:check`, the AC-10 structural grep gate (zero matches), and the targeted suites (`tests/run-task-code-review.test.ts` + `tests/run-task-prompts.test.ts` — 39 pass / 0 fail). The anchored lens additionally re-ran `npm run build` (dist clean), `npm run docs-refs-check`, and golden regeneration — all green.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: cold-Codex before foreman, mini model, verbatim artifact | Pass | `phases/code-review.ts:327-348` runs `runColdCodexReview()` before `runClaude()`, writes `review-cold-codex.md` per task; no parsing of findings. Mini model wired via `defaultDeps.getColdCodexModel: () => policyConfig().codexModelMini`. |
| AC-2: unavailable review stops before foreman/qa, re-runnable | Pass | `code-review.ts:332-339` `setExitReason` + `process.exit(1)` before any foreman/artifact write; no graceful 2-lens fallback. Bundle test asserts no foreman, qa stays pending, no artifact. Recovery mirrors `implement`/`spec_review` Codex-failure halt. |
| AC-3: cold = unprompted/unanchored branch diff | Pass | `codex.ts:135` `['exec','review','--json','--base',baseBranch,'-m',model]` — no custom prompt, no spec injection, no artifact filtering. |
| AC-4: run-log duration line, no metrics-schema change | Pass | `Date.now()` bracket + `info('→ cold-codex review (...): Ns')` (`code-review.ts:328-348`); `runColdCodexReview` does not call `recordMetric`; `metrics.ts`/`MetricEntry`/`pipeline-invocations.md` untouched. |
| AC-5: bundle contract (one review, fan-out, atomic failure) | Pass | Single `runColdCodexReview` call (not looped); artifact fanned out to every task dir (`:341-347`); failure exits before any member advances. Covered by the 2-task bundle test. |
| AC-6: foreman gets fresh cold-Codex findings each round | Pass | `promptCodeReview(..., coldReview.findings)`; resumed round-2 foreman still receives the full prompt (incl. injection) via `toResumePrompt`. Re-obtained each round. |
| AC-7: foreman spawns two Claude lenses only, runs no codex | Pass | `code-review-foreman.md:54-69` spawns `code-review-anchored` + `code-review-cold`; "Do not run `codex` yourself" (:12, :69). |
| AC-8: two separate reconciliations + no-off-AC dismissal + cross-model rule | Pass | Template :77-81 separates "hold against code" (cold lenses) from "in spec scope" (anchored only), forbids off-AC dismissal of *verified* cold findings, and adds the cross-model-agreement guard. |
| AC-9: lens-count wording → three on live surfaces | Pass | Foreman template, `.canon/templates/review.md` (lines 7, 77), both agent charters (line 6) updated; mirrors synced. |
| AC-10: structural sweep returns zero matches | Pass | Foreman re-ran the exact `rg` command — zero matches. |
| AC-11: decisions :202 rewritten + :193 generalized | Pass | Near-clone caution scoped to same-model; cross-family decorrelation named as the exception. |
| AC-12: parked-Codex-phase decision rewritten | Pass | Records cold-Codex adopted in-pipeline on fresh human direction; PR-level Codex retained as backstop. |
| AC-13: new design decision entry | Pass | "Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail" entry covers orchestrator-run-vs-foreman tradeoff, sequential-vs-concurrent, bundle contract, hard-fail-no-new-verdict. |
| AC-14: tests (a/b/c/d) | Pass | `run-task-code-review.test.ts` covers ordering+artifact+mini-model, hard-fail-before-foreman, bundle single-run/atomic-failure; prompt test covers injected slot + 3-lens framing; golden regenerated. |
| AC-15: docs | Pass | `pipeline-orchestrator.md` + `product-context.md` updated; orchestrator mirror synced. |
| AC-16: build/sync/validation | Pass | All gates green (see Validation Gate above). |

### Dropped Sections Check

- [x] Non-goals respected — no new verdict / no `codex_error`, no `codexMatrix` phase, no new agent definition, no concurrent execution, no metrics-schema change, no artifact-filtering; all honored.
- [x] Known Risks addressed or documented as accepted — bootstrap (can't self-test 3 lenses), sequential latency, hard-fail-vs-liveness, off-AC dismissal, bundle mis-scoping all carried over and handled.
- [x] Human Test Plan is satisfiable by the implementation — the post-merge dogfood path is the intended first exercise.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A clean, well-scoped implementation of a delicate orchestrator hot-path change. The design correctly keeps cold-Codex *outside* the foreman so failure handling stays deterministic (the orchestrator owns the subprocess and hard-stops before any Claude session), reuses the existing `streamProcess`/NDJSON capture path, and reads the mini model from policy config rather than a new matrix phase or magic literal. The `CodeReviewPhaseDeps` injection seam is a legitimate test seam (the real `runColdCodexReview` is separately covered by fake-binary unit tests), not a coverage dodge. Both lenses converged on the same substantive code area; the one finding the cold lens elevated to a blocker is a behavior the spec affirmatively and deliberately specifies (see Dismissed Cold Findings). No surviving finding can corrupt downstream task state or produce a wrong verdict — the residual edges degrade gracefully and are mitigated by the foreman's verify-don't-relay discipline.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions. None blocking; flagged for the post-merge dogfood (Human Test Plan).

- **`codex exec review --base` diff range vs. the foreman's three-dot scoped diff** (`codex.ts:135` vs `code-review.ts:352`; flagged by *both* lenses, low confidence). The Claude lenses get `getScopedDiff()` = `git diff <base>...HEAD` (three-dot). Codex computes its own range from `--base`; if it were two-dot or included the working tree, the cold-Codex lens and the Claude lenses could review slightly different surfaces. Mitigants: the invocation is operator-confirmed, the branch is frozen post-`implement` with a clean worktree at `code_review`, and worst case is Codex seeing base-advancement context the foreman would dismiss as off-task. **Verify in the dogfood** (spec Interaction Dependencies asked to confirm `--base`'s scope) — not a code-bug.
- **`--sandbox` omitted on the review subprocess** (`codex.ts:135`; anchored, low confidence). `runCodex` passes `--sandbox workspace-write` for non-resumed sessions; `runColdCodexReview` passes none. For a read-only review this is appropriate, and the operator-confirmed invocation omits it. If `codex exec review` ever tried to prompt for approval, `streamProcess`'s stall timer would trip → `success:false` → fail-closed. Acceptable.

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **Discarded `durationMs`** (`codex.ts:167` / `code-review.ts:330`; cold, high confidence): `runColdCodexReview` returns `durationMs`, but the phase recomputes its own `Date.now()` bracket and ignores the returned value. Harmless redundancy — use one or drop the returned field.
- **Optional hardening of the success predicate for the partial-capture edge** (`codex.ts:158-162`): the success check ignores `result.exitCode` *by spec design* (see Dismissed Cold Findings). The residual edge the cold lens raised — a complete first `agent_message` followed by a non-zero-exit crash that drops later messages — is low-probability (items arrive as atomic `item.completed` events) and degrades gracefully. If ever observed in the dogfood, a future hardening could `warn()` on a non-zero exit *with* captured text (without flipping it to failure, which the spec forbids). Not required for v1.
- **`hasColdCodexFindings: coldCodexFindings !== null`** (`prompts/index.ts:523`; anchored, medium confidence): keys on `!== null`, so an empty-string findings body would render the "has findings" branch. Unreachable in production (empty findings → `success:false` → phase exits before `promptCodeReview`), but a latent footgun if a future caller passes `''`.
- **No direct test that `getColdCodexModel` resolves to `policyConfig().codexModelMini`** (`tests/run-task-code-review.test.ts`; anchored, low confidence): phase tests assert the injected sentinel flows through; the production resolver one-liner is verified only by inspection (`code-review.ts:47`). A regression swapping it to `codexModelDefault`/a literal would pass all tests. Coverage nit on AC-1's "resolved mini model" guarantee.
- **Misleading diagnostic on Codex output-format drift** (`codex.ts:144`; cold, low confidence): non-JSON stream lines are silently swallowed (consistent with the sibling `runCodex`), so a CLI output-format change reports identically to "Codex unavailable." Fail-closed and correct, but an operator can't distinguish drift from an outage. Optional future diagnostic improvement.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong.

(none)

### Dismissed Cold Findings

> Cold-lens findings dropped because the spec shows the behavior is intended. Include the spec reason. (Verified against the code first — not dismissed for being off-AC.)

- **Dismissed (cold): "`runColdCodexReview` success predicate ignores `result.exitCode`, unlike the sibling `runCodex`" — high severity / medium confidence.** Verified against the code: the predicate is `findings.trim().length > 0 && !spawnError && !stalled && !signal`, deliberately not gated on `exitCode`. The spec *affirmatively specifies* this: AC-2 — "a review that runs is a success whose findings flow to the foreman, regardless of how Codex signals findings"; and Known Risks — "exit 0 whether clean or findings-present, so 'review couldn't be obtained' = no `agent_message` / error, **not a non-zero-on-findings code**." `runCodex` checks `exitCode` because its success semantic is "did the phase complete" (verified afterward via `status.json`); `runColdCodexReview`'s semantic is "did we capture a review." Gating on a non-zero exit would *regress liveness* (hard-stopping the pipeline whenever Codex exits non-zero for a benign teardown reason after producing a complete review) — the opposite of what the spec wants. This is a spec-explicit design choice, **not** an off-AC dismissal of a real bug; the cold (spec-blind) lens correctly flagged it as suspicious without seeing that choice. The residual partial-capture edge is carried above as an optional future-hardening nit.
- **Dismissed (cold): "no `recordMetric` for the cold-Codex review — invisible to telemetry" — low/medium severity.** Verified: `runColdCodexReview` has no `recordMetric` call. AC-4 *explicitly forbids* a metrics-schema change ("does not add a `MetricEntry` field… does not touch `scripts/run-task/metrics.ts` or `types.ts` — the run-log line *is* the telemetry"). The duration is intentionally a run-log `info()` line only. Spec-intended.
- **Dismissed (cold): "`code_review` set to `in_progress` before the fallible cold review → premature state mutation" — low/medium severity.** Verified: `taskPhase(..., 'in_progress')` runs at `:325`, before the cold review at `:329`. This mirrors the established `implement`/`spec_review` pattern (status set in-progress, then the fallible Codex call; on failure the run exits and is re-runnable). The anchored lens confirmed re-dispatch correctly re-enters `code_review`. Intended/consistent, not a defect.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

> Synthesis note: the cold-Claude lens returned `changes_requested`, driven by the exit-code finding above. As foreman holding the spec, I dismissed it as spec-intended (with cited evidence) and carried its residual edge as an optional nit — exactly the cold-vs-spec reconciliation the foreman exists to perform. No code-bug or spec-gap survives; the remaining items are optional cleanups and low-confidence risks to watch during the post-merge dogfood.
