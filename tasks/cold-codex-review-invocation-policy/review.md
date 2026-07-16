# Code Review: cold-codex-review-invocation-policy

> Reviewer: Claude | Spec: `tasks/cold-codex-review-invocation-policy/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Lens agreement this round:** anchored Claude → approve; cold Claude → approve; cold Codex (GPT) → clean (no findings; changes align with policy matrix, add validation + telemetry, preserve failure behavior, pass all checks). Three-lens agreement, no code-bugs.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

`lint`, `type-check`, `test` (975 pass / 0 fail / 1 skip), `build` (only `dist/scripts/run-task.js` changed), `docs-refs-check`, and `sync-templates:check` all recorded `Pass`. Independently re-verified: the three most-affected suites (`run-task-code-review`, `pipeline-policy`, `run-task-reroute-preflight`) run 96/96 green.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: policy matrix | Pass | `scripts/pipeline-policy.ts:184-190` adds the `code_review` row `{ mini, high }` at XS/S/M/L/XL; `CodexPhase` widened at `:12`. Test rows at `tests/pipeline-policy.test.ts:154-160` assert all five cells; `:173` asserts delicate-M (effective XL) still resolves `mini/high` (non-goal enforced). Pure Policy + Test Discipline honored. |
| AC-2: replace the model-only resolver | Pass | `code-review.ts:33/48/327` use `getCodexConfig('code_review', tasks)` returning model **and** effort. `grep -rn getColdCodexModel scripts/ tests/ src/` → 0 hits. |
| AC-3: cold argv, red-first | Pass | `codex.ts:168` argv = `exec review --json -c model_reasoning_effort=<effort> --base <base> -m <model>`, no `--sandbox`. Exact `deepEqual` pin at `tests/run-task-code-review.test.ts:247-260`. |
| AC-4: fresh/resumed argv | Pass | Full `deepEqual` on both paths: fresh at `run-task-reroute-preflight.test.ts:892-904`, resumed at `:990-1000`; the generated prompt element is masked via `replaceCodexPrompt`, flag order otherwise fully pinned. |
| AC-5: effort validation | Pass | Shared `invalidCodexEffortMessage` guard at `codex.ts:38-39` (fresh/resumed) and `:153-165` (cold). Three no-spawn tests — cold `:293`, fresh `:314`, resumed `:334` — each assert the fake binary's sentinel was never created and the message carries all three required elements (invalid value, valid set, per-invocation-override-supersedes-user-config), via `assertInvalidEffortMessage`. |
| AC-6: telemetry row, red-first | Pass | `recordMetric` in `finally` at `codex.ts:221-231`. Test `:354-395` asserts exactly one `code_review`+`codex` row, `iteration` cell `2` (matches the seeded `agent=claude` foreman row, not `-`), distinct from that Claude row, and tokens `7`. |
| AC-7: failed attempts also log exactly once | Pass | Two tests: incomplete-stream return path (`:397-424`) and pre-spawn invalid-effort guard path (`:426-452`), each asserting one `failed` row / zero `ok` rows. Guard records **before** `die()` and sits **outside** the `try`, so `finally` does not also fire (no double-record); return/throw path records once via `finally`. Verified by trace against `die()` → `process.exit(1)` and synchronous `fs.appendFileSync`. |
| AC-8: existing contracts preserved | Pass | Empty-output / truncated-stream / `coldSuccess:false`→`process.exit(1)` tests pass, updated only for the new deps/signature. Golden fixture absent from the diff (`git diff --name-only main...HEAD` confirms 0 hits for `run-task-prompts.golden.json`). |
| AC-9: token parsing parity | Pass | `codex.ts:188-190` sums `usage.input_tokens + usage.output_tokens` on `turn.completed`, matching `runCodex`. Usage test asserts `7`; no-usage test (`:454-475`) asserts `-` while preserving `success:true`. |
| AC-10: docs | Pass | `docs/decisions.md:343` amended root-only (not in `CANON_OWNED`, no mirror); `docs/pipeline-orchestrator.md:220` and `docs/pipeline-orchestrator.md:224` gain the cold-lens matrix row + prose; `templates/docs/pipeline-orchestrator.md` synced. `templates/docs/decisions.md` correctly absent from the diff; `sync-templates:check` + `docs-refs-check` pass. |

### Dropped Sections Check

- [x] Non-goals respected — no model upgrade (cold lens stays `codexModelMini` at all sizes incl. XL/delicate), no new effort env knob, hard-fail contract unchanged, no foreman-prompt/golden change, no telemetry backfill, no Claude-path changes.
- [x] Known Risks addressed — the trickiest (AC-7 exactly-once) is handled exactly as the risk analysis prescribed; exact-argv brittleness is deliberate; usage-absent path degrades to `-`.
- [x] Human Test Plan satisfiable — invalid-effort override, one distinct telemetry row, and failed-attempt logging are all exercised by the implementation.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-scoped implementation of the #195 fix. The cold review now routes through the same table-driven policy boundary as other Codex calls, a shared pre-spawn guard rejects CLI-invalid efforts with an actionable message, and the cold path owns exactly one telemetry write per attempt. Notably, `runColdCodexReview` correctly returns (rather than `process.exit`-ing inside the `try`) on failure so its `finally` always fires — deliberately avoiding the counter-pattern present in the pre-existing `runCodex` failure branches. Argv construction is consistent across fresh/resumed/cold paths and the tests pin it exactly. No correctness bugs and no spec gaps.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **Telemetry asymmetry on the invalid-effort guard** — `scripts/run-task/agents/codex.ts:38-39` (nit-severity risk). Flagged independently by **both** the anchored and cold-Claude lenses. The shared guard is applied at both `runCodex` and `runColdCodexReview`, but only the cold path records a `failed` telemetry row on guard failure (`:154-164`); `runCodex`'s guard `die()`s with **zero** rows even though its callers pass a `metricsContext`. Verified spec-scoped: AC-6/AC-7 scope telemetry to the cold lens only, and AC-5 requires just fail-before-spawn at all three sites — so this is a conscious boundary, not an oversight, and it **cannot fire today** because every production caller (`implement`, `spec_review`, `code_review`) passes a matrix-resolved effort in the valid set. Non-blocking; recorded so a future consumer of `runCodex` telemetry treats the gap as intentional. Optional follow-up, not a Round-1 blocker.

#### Optional Cleanup / Nit

- **Red-first tests fail via signature mismatch, not the narrated assertion flip** — `tests/run-task-code-review.test.ts` (anchored lens). AC-3/AC-6 tests exercise the new 6-arg `runColdCodexReview` signature; against pre-fix code they fail on the positional-signature change rather than the clean "missing `-c` pair" / "zero codex rows" flip the AC narrative describes. Regression intent is still satisfied (red on old, green on new); noting only that the failure mode differs from the prose. No action.
- **1-based run-log line vs. 0-based `Iter` metric column** — `scripts/run-task/phases/code-review.ts:324,333` (cold-Claude lens). The human-facing log prints `iteration ${maxIter + 1}` while the metric records `iteration: maxIter`. This is **spec-intended**: AC-6 explicitly requires the cold row's iteration to equal `maxIter` to match the foreman `runClaude` row (`:361`), so the metrics table is internally consistent; only a reader correlating the run-log line to the `Iter` column would be off by one. No action.
- **Token cell sums input+output, header documents "input + cache + output"** — `scripts/run-task/agents/codex.ts:189` (cold-Claude lens). The new accounting mirrors the pre-existing `runCodex` convention (`:92`); the divergence is from the aspirational header text in `metrics.ts:20`, not from this diff's siblings. Out of scope to change here; noting for consistency.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): "`runCodex` `finally` is bypassed on spawnError/stalled/signal because `process.exit(1)` runs inside the `try`, so those paths record zero rows" — **pre-existing behavior, not changed by this diff, and out of scope.** The spec's Known Risks explicitly acknowledges it (`codex.ts:98/103/108` exit inside try, skip finally). The new `runColdCodexReview` correctly avoids this counter-pattern by returning instead of exiting. Verified real but not a defect introduced here.
- Dismissed (cold-Claude): "exact-argv `deepEqual` couples to the fixture task's spec_review size resolving effort to `high`" — verified real coupling, but it fails **loudly** (never vacuously) on size drift, and the spec's Known Risks declares this exact-argv brittleness deliberate ("the tests exist to make invocation-policy drift loud"). Working as intended.
- Dismissed (cold-Codex): no discrete findings to adjudicate — the injected cold-Codex lens returned a clean summary (changes align with the policy matrix, add effort validation + telemetry, preserve existing failure behavior, and pass test/type-check/lint/template-sync). Independently corroborated by both Claude lenses and my own checks; nothing to verify or drop.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

> Nits are optional. The only one worth a conscious decision is the `runCodex` telemetry asymmetry on the invalid-effort guard — spec-compliant and unable to fire today, but a candidate for a future one-line unification if `runCodex` failure telemetry ever matters. Nothing blocks shipping.

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
