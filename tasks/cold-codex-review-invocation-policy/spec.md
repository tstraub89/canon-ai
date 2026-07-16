# Spec: cold-codex-review-invocation-policy — Cold-Codex review lens gets canon-resolved effort and a telemetry row

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The cold-Codex `code_review` lens bypasses canon's Codex invocation policy, producing two verified defects (GitHub issue #195, filed by an external adopter on v2.2.0; triaged into `docs/BACKLOG.md` §"🐛 Harness Bugs" on 2026-07-12):

1. **Effort inheritance can hard-block the mandatory lens.** Ordinary Codex invocations pass `-c model_reasoning_effort=<effort>` on the argv (`scripts/run-task/agents/codex.ts:53`), overriding whatever sits in the user's `~/.codex/config.toml`. `runColdCodexReview` (`codex.ts:128-179`) spawns bare `codex exec review --json --base <base> -m <model>` with no effort override, so the review inherits the user-level `model_reasoning_effort`. The Codex CLI accepts only `none|minimal|low|medium|high|xhigh`; a user-level value outside that set (the reporter had `ultra`) makes the CLI reject the invocation before any review output exists. Because the cold lens is hard-fail by design (`docs/decisions.md` §"Cold-Codex code-review lens"), this kills every `code_review` on that machine — a confirmed production incident, not a theoretical hardening concern.
2. **The cold lens writes no telemetry.** Ordinary Codex invocations call `recordMetric` in a `finally` block (`codex.ts:124`); `runColdCodexReview` never calls it. A required ~10-minute model invocation is invisible to cost/latency/failure/audit telemetry, falsifying `docs/pipeline-invocations.md`'s stated contract ("One row per agent invocation").

**How the mechanism was confirmed**: (a) source verification on `main` 2026-07-12 — the ordinary path has the effort flag and `recordMetric` at the lines above; the cold path has neither; (b) the reporter's live reproduction in issue #195 — with global effort `ultra`, the cold review dies with the CLI's invalid-value rejection before any artifact exists, and re-running the same review with an explicit `-c model_reasoning_effort=xhigh` completes (631s), confirming both the failure mechanism and that `codex exec review` accepts the `-c model_reasoning_effort` override; (c) a grep of the live `docs/pipeline-invocations.md` (716 rows): zero rows with `phase=code_review` + `agent=codex`.

## Decision

Route the cold-Codex review through the same invocation policy as fresh/resumed Codex calls:

- **Effort is canon-resolved via the policy matrix.** `codexMatrix()` in `scripts/pipeline-policy.ts` gains a `code_review` phase row. Per human decision: **effort `high` at every size** (XS/S/M/L/XL); **model stays `codexModelMini` at every size** (today's behavior via `getColdCodexModel`, unchanged — including XL/delicate). The cold review passes that effort explicitly as `-c model_reasoning_effort=<effort>` on the argv, an invocation-scoped override; canon never reads or mutates `~/.codex/config.toml`.
- **Effort is validated before spawning.** All non-interactive Codex invocations (fresh, resumed, cold) validate the canon-resolved effort against the CLI-valid set `none|minimal|low|medium|high|xhigh` before spawning. An invalid value fails fast with a message naming the invalid resolved value, the valid set, and stating that canon's per-invocation `-c model_reasoning_effort` override supersedes any user-level `model_reasoning_effort`. (Effort is matrix-driven with no env knob, so this guard protects against future matrix edits and CLI drift, and gives the operator an actionable message instead of a raw CLI rejection.)
- **Every cold-review attempt records exactly one telemetry row** via `recordMetric`, wrapped in `finally` like the ordinary path: `agent: 'codex'`, `phase: 'code_review'`, `taskId: taskIds.join('+')` (one row per invocation — matching the bundle contract of one cold review per `code_review` invocation), `iteration: maxIter` (the same round attribution the Claude foreman row already passes at `code-review.ts:356`, so the cold row shows the code_review round number instead of `-` on repeated rounds), model, duration, `status: 'ok' | 'failed'`, and tokens when the `--json` stream provides `turn.completed` usage (parsed the way `runCodex` already does; `-` otherwise). A pre-spawn validation failure still records a `failed` row. The `phase=code_review` + `agent=codex` combination never appears today, so the cold row is cleanly distinguishable from the Claude foreman's `code_review` row (`agent=claude`).

The cold review's success gate (non-empty findings + `turn.completed` seen + no spawn error/stall/signal; exit code deliberately not gating) and the hard-fail contract (no graceful two-Claude-lens fallback; halt before any Claude session) are unchanged.

## Non-Goals

- **No model upgrade for the cold lens.** It stays `codexModelMini` at all sizes, including XL/delicate — upgrading is a separate cost decision. Bounded positively by AC-1's matrix cells.
- **No new effort env knob.** `CODEX_EFFORT_DEFAULT`/`CODEX_EFFORT_DELICATE` stay retired (`scripts/run-task/env.ts:59-60`); effort remains matrix-driven. `CODEX_MODEL_MINI`/`CODEX_MODEL_DEFAULT` keep applying to the model as today.
- **No change to the hard-fail contract** — a failed cold review still halts `code_review` before any Claude session, with no fallback verdict.
- **No foreman prompt changes.** `promptCodeReview` and the golden fixture `tests/run-task-prompts.golden.json` are untouched (structural bound: AC-8).
- **No backfill** of historical telemetry rows in `docs/pipeline-invocations.md`.
- **No changes to Claude invocation paths** (`scripts/run-task/agents/claude.ts`).

## Acceptance Criteria

- [ ] **AC-1 (policy matrix)**: `CodexPhase` in `scripts/pipeline-policy.ts` includes `'code_review'`, and `codexMatrix()` returns for `code_review` the cell `{ model: config.codexModelMini, effort: 'high' }` at every size XS/S/M/L/XL. Verify: `tests/pipeline-policy.test.ts` gains a test row asserting each of the five cells (per the Pure Policy + Test Discipline pattern); `npm test` green.
- [ ] **AC-2 (replace the model-only resolver)**: The cold review's configuration resolves through the shared policy path (`getCodexConfig('code_review', tasks)` in `scripts/run-task/phases/code-review.ts`), returning model **and** effort. This replaces `getColdCodexModel`; the symbol `getColdCodexModel` must not exist anywhere after the change. Verify: `grep -rn "getColdCodexModel" scripts/ tests/ src/` returns zero hits.
- [ ] **AC-3 (cold argv, red-first)**: `runColdCodexReview` spawns exactly `['exec', 'review', '--json', '-c', 'model_reasoning_effort=<effort>', '--base', <base>, '-m', <model>]` — the effort pair added, still no `--sandbox` flag. Verify: the existing exact-argv `deepEqual` test in `tests/run-task-code-review.test.ts` (fake `codex` binary via the `codexBinary` option) is updated to the new expected argv; the updated expectation fails against pre-fix code (missing `-c` pair) and passes after.
- [ ] **AC-4 (fresh/resumed argv)**: Exact-argv assertions cover the fresh and resumed `runCodex` paths, pinning the complete flag set and order — fresh: `exec --json -c model_reasoning_effort=<effort> --sandbox workspace-write <prompt> -m <model> -C <cwd>`; resumed: `exec resume <id> --json -c model_reasoning_effort=<effort> <prompt> -m <model>` (the prompt element may be matched by placeholder/pattern rather than literal text). Verify: assertions added/tightened in the fake-agent-bin capture seam (`tests/run-task-reroute-preflight.test.ts` `writeFakeAgentBins`/`readCapture`) or an equivalent unit seam; `npm test` green.
- [ ] **AC-5 (effort validation)**: A canon-resolved effort outside `none|minimal|low|medium|high|xhigh` causes fresh, resumed, and cold Codex invocations to fail before spawning, with an error message containing (a) the invalid value, (b) the valid set, and (c) a statement that canon's per-invocation `-c model_reasoning_effort` override supersedes any user-level `model_reasoning_effort` setting. Verify: unit tests feed an invalid effort to each of the three spawn sites separately — (a) the cold path, (b) the fresh `runCodex` path, and (c) the resumed `runCodex` path (with a `resumeId`) — each asserting the fake codex binary was never invoked and the message carries all three elements, so the guard is proven wired at all three sites rather than inferred from one.
- [ ] **AC-6 (telemetry row, red-first)**: A successful cold review appends exactly one row to the metrics file via `recordMetric`: `agent=codex`, `phase=code_review`, `taskId=<taskIds.join('+')>`, `iteration` equal to the code_review round (`maxIter`, matching the foreman row — not `-`), the resolved model, a duration, `status=ok`, and tokens when the stream emitted `turn.completed` usage. Verify: test using the `CANON_METRICS_FILE_OVERRIDE` seam asserts exactly one `code_review`+`codex` row, that its iteration cell matches the foreman row's rather than `-`, and that the row is distinct from any `agent=claude` foreman row; the test fails on pre-fix code (zero such rows) and passes after.
- [ ] **AC-7 (failed attempts also log exactly once)**: A failed cold-review attempt — spawn failure, stall/signal, empty findings, or pre-spawn invalid-effort — records exactly one row with `status=failed`. Verify: **two** failure-mode tests via `CANON_METRICS_FILE_OVERRIDE`, each asserting one `failed` row and zero `ok` rows — (a) an *ordinary* in-stream failure (empty findings or a stream truncated before `turn.completed`, i.e. `success:false` from the normal return path) and (b) the pre-spawn invalid-effort path. Covering both proves the recording fires on the return path and on the guard path, not just one.
- [ ] **AC-8 (existing contracts preserved)**: The cold review's success-gate semantics and the hard-fail-before-any-Claude-session behavior are unchanged — the existing failure tests in `tests/run-task-code-review.test.ts` (empty output, truncated stream, `coldSuccess:false` → `process.exit(1)`) still pass, updated only for the new deps/signature shape. `tests/run-task-prompts.golden.json` has no diff. Verify: `npm test` green; the branch diff does not contain the golden fixture.
- [ ] **AC-9 (token parsing parity)**: `runColdCodexReview`'s stream handler reads `turn.completed` `usage.input_tokens + usage.output_tokens` the same way `runCodex` does, and tolerates streams with no usage (row shows `-`). Verify: one telemetry test emits usage in the fake stream and asserts the row's token count; one emits none and asserts `-`.
- [ ] **AC-10 (docs)**: `docs/decisions.md` §"Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" is amended — the "no new `codexMatrix` phase exists" clause is replaced with the new policy-resolved model+effort statement — and `docs/pipeline-orchestrator.md` §"Codex Model/Effort Matrix" gains a `code_review` (cold lens) row: mini / high at every size. `docs/decisions.md` is updated **root-only** — it is not in `CANON_OWNED` (`src/lib/canon-owned.ts`), so it has no `templates/` mirror and the sync hook must not touch it; the existing `templates/docs/decisions.md` is an intentionally generic adopter scaffold with no cold-lens section, and mirroring canon-ai's internal decision into it would collapse that root/template distinction. Only `docs/pipeline-orchestrator.md` (which *is* in `CANON_OWNED`) has a required mirror, `templates/docs/pipeline-orchestrator.md`, synced by the pre-commit hook. Verify: `npm run sync-templates:check` passes (confirming the pipeline-orchestrator mirror is aligned and no unexpected decisions mirror is emitted) and `npm run docs-refs-check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/pipeline-policy.ts` | Add `'code_review'` to `CodexPhase`; add `code_review` row to `codexMatrix()` (mini / `high` at all five sizes) with a comment noting the flat-high human decision and the model-stays-mini rationale |
| `scripts/run-task/agents/codex.ts` | `runColdCodexReview` gains an effort parameter and an optional metrics context; argv gains the `-c model_reasoning_effort=<effort>` pair; stream handler widened to parse `turn.completed` usage; `recordMetric` in `finally`; shared pre-spawn effort validation used by `runCodex` (fresh + resumed) and the cold path |
| `scripts/run-task/phases/code-review.ts` | Replace the `getColdCodexModel` dep with a policy-backed config resolver (`getCodexConfig('code_review', tasks)`); pass effort + metrics context (`taskId: taskIds.join('+')`, `phase: 'code_review'`, `iteration: maxIter` matching the foreman row at ~line 356, `activeCwd`) at the cold-review call site (~line 326-341) |
| `tests/pipeline-policy.test.ts` | Test rows for the five new `code_review` matrix cells |
| `tests/run-task-code-review.test.ts` | Updated exact-argv `deepEqual` (AC-3); effort-validation test (AC-5); telemetry ok/failed/token tests (AC-6, AC-7, AC-9); deps-stub rename fallout (AC-2, AC-8) |
| `tests/run-task-reroute-preflight.test.ts` | Fresh/resumed exact-argv tightening (AC-4) |
| `tests/run-task-safety.test.ts` | Replace four placeholder effort values with CLI-valid ones so pre-existing failure-ladder tests still reach their intended failure branches under the new pre-spawn guard (in-scope deviation recorded in handoff/done) |
| `docs/decisions.md` | Amend the 2026-06 cold-Codex-lens entry (AC-10; land during implement, before handoff — code_review verifies AC-10). **Root-only — not in `CANON_OWNED`, has no `templates/` mirror; do not edit `templates/docs/decisions.md`.** |
| `docs/pipeline-orchestrator.md` | Add the cold-lens row to the Codex Model/Effort Matrix (AC-10; land during implement, before handoff — code_review verifies AC-10). Canon-managed → its mirror auto-syncs (see Generated Artifacts). |

**Generated artifacts** (must appear in the handoff Changes table when rewritten):

| File | Change |
|---|---|
| `dist/scripts/run-task.js` | Rebuilt — bundles `scripts/run-task/**` and `scripts/pipeline-policy.ts` |
| `dist/cli/index.js` | Rebuilt if the shared source bundles into the CLI entry point too (declare defensively; CI enforces committed `dist/` = fresh build) |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror of the matrix-doc update (the pre-commit hook regenerates it because `docs/pipeline-orchestrator.md` is in `CANON_OWNED`) |

> `templates/docs/decisions.md` is deliberately **absent** here: `docs/decisions.md` is not canon-managed, so no mirror is generated. Adding it to the handoff Changes table would fail the `code_review` pre-flight, since it will not appear in the branch diff.

### Interaction Dependencies

- **`code_review` pre-flight hard-fail path** (`code-review.ts:314-320`): the new pre-spawn validation failure and the telemetry-on-failure row must compose with the existing halt-before-Claude behavior, not alter it.
- **Bundle mode**: one cold review per invocation over the combined diff; the flat-high effort curve makes bundle size-mixing moot for resolution (`getCodexConfig` already takes the task list and resolves effective size, and every `code_review` cell is identical), but the telemetry row is per-invocation with the joined taskId — mirroring the Claude foreman row's labeling.
- **Model env overrides**: `CODEX_MODEL_MINI`/`CODEX_MODEL_DEFAULT` continue to flow through `policyConfig()` into the matrix cell.
- **Metrics test seam**: `CANON_METRICS_FILE_OVERRIDE` (`scripts/run-task/metrics.ts`) redirects rows in spawned test processes — required by the telemetry ACs so tests never touch the real `docs/pipeline-invocations.md`.

### Data Model Changes

None persistent. Type-level only: the `CodexPhase` union in `scripts/pipeline-policy.ts` widens by one member; `runColdCodexReview`'s signature gains effort + metrics-context parameters. `MetricEntry` and `ColdCodexReviewResult` shapes are unchanged.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; includes the new policy rows, argv, validation, and telemetry tests
- [x] `npm run build` — required: `scripts/run-task/**` and `scripts/pipeline-policy.ts` bundle into `dist/`; committed `dist/` must match a fresh build
- [x] `npm run docs-refs-check` — docs and task artifacts change
- [x] `npm run sync-templates:check` — the canon-managed doc `pipeline-orchestrator.md` changes, so its mirror must stay aligned (`decisions.md` is root-only, no mirror)

## Docs Impact

- `docs/decisions.md` — the 2026-06 cold-Codex-lens entry's "no new `codexMatrix` phase exists" clause becomes false; amended per AC-10 (root-only edit; no template mirror).
- `docs/pipeline-orchestrator.md` — Codex Model/Effort Matrix gains the cold-lens row; the cold-lens description in the code_review section should mention the canon-resolved effort.
- `docs/codebase-map.md`, `docs/patterns.md`, `docs/architecture.md`, `docs/product-context.md` — no expected impact.

## Known Risks

- **Codex CLI drift**: the valid-effort set (`none|minimal|low|medium|high|xhigh`) is hardcoded from the CLI's own error message (codex-cli 0.144.x); a future CLI could change it. The guard's failure message names the set, so a stale list fails loudly and actionably rather than silently. The `-c model_reasoning_effort` override on `exec review` is confirmed working by the issue's own reproduction on the current CLI.
- **Token availability on `exec review`**: no captured real `codex exec review` stream in-repo proves `turn.completed` carries `usage` for the review subcommand; test fixtures assume the same schema as `exec`. AC-9's tolerance path (`-` when absent) means a usage-less stream degrades telemetry gracefully rather than failing the review.
- **Trickiest AC is AC-7** (failed attempts log exactly once): the cold path has multiple failure exits (pre-spawn validation, spawn error, stall/signal, empty findings). Two interacting hazards for the implementer: (1) the phase layer calls `process.exit(1)` *after* `runColdCodexReview` returns (`code-review.ts:338`), so a `finally`-based `recordMetric` inside `runColdCodexReview` fires on the normal `success:false` return before that exit — good; but (2) `process.exit()` does **not** run pending `finally` blocks (the existing `runCodex` spawn-error/stall/signal branches at `codex.ts:98/103/108` exit inside the try and skip its `finally`), so the pre-spawn invalid-effort guard must record its `failed` row **before** any in-function exit and must not rely on `finally` if it calls `process.exit`/`die`. AC-7's two tests exist to catch both the return-path and guard-path recording; the risk is recording zero rows on the guard path or double-recording when a failure is seen both in-stream and post-stream.
- **Exact-argv test brittleness**: full `deepEqual` pins flag order, so any future flag addition breaks these tests. That is deliberate — the tests exist to make invocation-policy drift loud.
- **Effort raise is a behavior change for adopters**: the cold lens previously ran at whatever the user's config said (often the CLI default `medium`); it now always runs at `high` — somewhat higher cost/latency per review, uniform across sizes. This is a canon-supplied-default change (minor, per the versioning policy) and should be called out in the changelog when released.
- **Sensitive surface — flagged `delicate: true`**: this touches the orchestrator's Codex invocation policy (a hot path — an undetected bug hard-fails `code_review` for every task, exactly the #195 incident class) and adds an analytics/telemetry row. Both fall under the delicate categories, so `status.json` sets `delicate: true` and `human_spec_gate: true`. Consequence: review chains run at the full model and the pipeline stops at the human spec gate after Codex approves.

## Human Test Plan

1. In your personal Codex configuration, set the reasoning effort to a value the Codex tool itself rejects (the original reporter used "ultra"), then run any canon task through its code review.
2. Expected: the independent Codex review completes normally — canon's own effort setting takes precedence for canon-run reviews — and your personal configuration file is byte-for-byte unchanged afterward.
3. Open the pipeline invocations log after the run. Expected: exactly one new row for the Codex code-review lens, showing the model used, how long it took, its status, and token usage where available — as its own row, separate from the Claude review row.
4. Optional failure check: temporarily make the review unable to run at all (for example, make the Codex command unavailable for that run). Expected: the run halts with a clear message, and the log still gains exactly one row for the attempt, marked failed.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed (source verification + reporter's live repro + telemetry grep); *Acceptance Criteria* includes red-first regression-test ACs (AC-3, AC-6)
