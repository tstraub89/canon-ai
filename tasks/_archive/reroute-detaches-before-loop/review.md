# Code Review: reroute-detaches-before-loop

> Reviewer: Claude | Spec: `tasks/reroute-detaches-before-loop/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review synthesized by the foreman from two lenses: an **anchored** lens (Stage 1 AC gate + Stage 2 quality, with spec/handoff) and a **cold** lens (diff-only, spec-blind). Both lenses returned an approve signal with only low-severity findings; the foreman independently re-verified the central AC-4 resume chain in `main.ts`/`detach.ts`.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Handoff Validation Outcomes records `Pass` for lint, type-check, `npm test` (865 pass / 1 skip / 0 fail), build (clean dist), `sync-templates:check`, and `docs-refs-check`; E2E is `deferred_by_spec` (spec marks it n/a — no E2E surface for the orchestrator). The anchored lens independently re-ran lint, type-check, the detach test file (22/22), `sync-templates:check`, `docs-refs-check`, and `npm run build` with `git diff --exit-code -- dist/` clean.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: synchronous-mode predicate does not reference `reroute` | Pass | `isSynchronousMode` (`cli.ts:250-252`) checks only `pr, push, ship, step, expectPhase`; `reroute` absent. Mirrored in `dist/scripts/run-task.js`. |
| AC-2: predicate extracted into pure, exported, unit-testable function | Pass | `export function isSynchronousMode(args: Partial<CliArgs>): boolean` in `cli.ts:250`; detach gate calls `splitCli.isSynchronousMode(cliArgs)` (`main.ts:3246`). |
| AC-3: unit test asserts the specified predicate rows | Pass | `tests/detach.test.ts:60-80` — `{reroute:true}`→false; `{pr}`/`{push}`/`{ship}`/`{step}`→true; `{expectPhase:'spec_review'}`→true; `{reroute,step}`→true; `{}`→false. |
| AC-4: detached child resumes from reset phase without re-running reroute reset | Pass | Argv-strip mechanism: `detach.ts:181` filters `--reroute` from the child argv. Child re-enters `main()` with `cliArgs.reroute` false → skips the reset at `main.ts:3188-3190` → never hits the `requires … human_review` guard; `CANON_DETACHED=1` keeps `shouldAutoDetach()` false so it enters the phase loop at the reset phase. Verified the source-order chain directly. Test at `tests/detach.test.ts:182` asserts child argv lacks `--reroute` and retains `CANON_DETACHED=1`. |
| AC-5: reroute reset + amendment-validation run in foreground parent before any detach | Pass | `rerouteFromHumanReview(cliArgs.taskIds)` at `main.ts:3189` precedes the detach gate at `main.ts:3246`; no reordering moves the reset after the gate. `die()` paths fire inline. |
| AC-6: detach comment no longer lists `--reroute` as a one-shot op | Pass | One-shot list at `main.ts:3218` is `--pr / --push / --ship`; `main.ts:3231-3242` separately explains bare `--reroute` detaches (both tiers enter the loop) and `--reroute --step` stays foreground. |
| AC-7: operator docs updated at all three touchpoints | Pass | (a) `docs/pipeline-orchestrator.md:21` removes `--reroute` from the synchronous list and adds the bare-reroute-detaches note. (b) `docs/pipeline-orchestrator.md` (the "Stepped runs must expect…" block) collapses both tiers to single combined `--reroute --step --expect <phase>` commands. (c) `CLAUDE.md` "Reroute step guards" rewritten to the single-command form + bare-reroute-detaches note. |
| AC-8: `templates/` mirrors synced + staged | Pass | `templates/CLAUDE.md` and `templates/docs/pipeline-orchestrator.md` match roots; `sync-templates:check` passes. |
| AC-9: `dist/scripts/run-task.js` rebuilt + committed | Pass | `npm run build` reproduces dist; `git diff --exit-code -- dist/` clean. Bundle reflects all three source edits (predicate, argv-strip, detach gate). |
| AC-10: full validation suite passes | Pass | All required checks green (re-verified by the anchored lens). |

### Dropped Sections Check

- [x] Non-goals respected — no change to `--pr/--push/--ship/--step/--expect` classification; fast-tier reroute stays one command; no new concurrent-launch guard added; no `--reroute`-reset-and-exit redesign; `docs-refs-check.mjs` untouched.
- [x] Known Risks addressed — the central re-exec double-reroute hazard is handled and tested (AC-4); two-orchestrator and visibility risks are the spec-accepted doc-only mitigation.
- [x] Human Test Plan satisfiable by the implementation.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality

### Summary

A tight, well-scoped fix on a delicate orchestrator surface. The change is internally consistent, the TS source and bundled dist agree, and test changes are purely additive (41 insertions, 0 deletions — no existing test weakened to accommodate a regression). The AC-4 deviation from the spec's recommended `CANON_DETACHED` env-guard to the argv-strip mechanism is documented with a credible rationale (`CANON_DETACHED=1` is inherited by subprocesses, so an env-only guard would wrongly skip the reset in nested `main()` calls) and AC-4's behavioral contract is mechanism-agnostic, so the substitution is within spec. All surviving findings are optional nits or spec-acknowledged risks; none block.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- `risk/guardrail` (spec-acknowledged) — `detach.ts:181`: the argv filter `filter(arg => arg !== '--reroute')` is value-blind and lives in `detachAndExit`, a shared chokepoint every detached run flows through, now coupled to a reroute-only string literal. Flagged by **both lenses**. It is safe today: `--reroute` is a pure boolean flag (no `=value` form — `parseArgs` `die`s on unknown `--reroute=…`), and the only way a `--reroute` token could appear as a *value* is `--expect --reroute`, which sets `expectPhase` → `isSynchronousMode` true → no detach → the filter never runs. The spec explicitly chose and accepted this tradeoff (Decision §, "argv-strip is acceptable only if the plan gives an explicit reason the env-guard is unworkable"), and the handoff supplies that reason. No action required; the coupling would only become a defect if a future `--reroute` alias/value-form is added or `expectPhase` is dropped from the predicate.
- `risk/guardrail` (low confidence) — cross-file (`main.ts:3189` → `detach.ts:182`): the detached child resumes correctly only because `rerouteFromHumanReview()` durably persists the new phase to `status.json` before the child is spawned and the child reads it fresh on re-exec. This is exactly canon's file-based-state architecture (in-memory cross-phase state is a documented anti-pattern in `docs/patterns.md`), so it is not a present bug — noting the implicit coupling for the record.

#### Optional Cleanup / Nit

- `optional cleanup/nit` — `detach.ts:177-181`: the strip-rationale comment explains *that* the child must not repeat the reset but does not name the rejected env-guard mechanism or *why* (CANON_DETACHED inheritance). That reasoning lives only in `handoff.md`. On this delicate surface, a future maintainer reading `detach.ts` in isolation could "simplify" back to an env-guard and reintroduce the nested-`main()` reset-skip bug. A one-line pointer ("env-guard rejected: CANON_DETACHED is inherited by nested main() invocations") would harden against that. (anchored)
- `optional cleanup/nit` — `tests/detach.test.ts:182`: the argv-strip test covers only a single trailing `--reroute`. It does not pin the pass-through direction (a normal argv without `--reroute` is forwarded unchanged) nor `--reroute` mid-argv or multiple occurrences. Adding a no-op pass-through assertion would guard against an over-eager future filter. (cold)
- `optional cleanup/nit` — `cli.ts:250`: `isSynchronousMode` takes `Partial<CliArgs>` (to accept object literals in the unit tests) while the sole production caller passes a full `CliArgs`. Minor type-safety widening driven by test ergonomics; acceptable, but worth a passing note. (cold)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold): "the extracted function name encodes a policy decision (reroute excluded) invisible at the call site — reader can't tell reroute was deliberately excluded vs. accidentally dropped" (`main.ts:3246`) — dropping `reroute` from the predicate *is* the intended change (AC-1), and the AC-6 comment block directly above the call site documents the exclusion. Behavior is by design.
- Reconciled (cold): the cold lens labeled the argv-strip alias/`=`-form concern a "correctness bug," but its own analysis confirms no live bug exists (parser `die`s on `--reroute=…`; `--expect --reroute` forces synchronous mode). Reclassified as the spec-acknowledged `risk/guardrail` above, not a correctness bug.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Nits are optional and non-blocking. The most valuable is the `detach.ts` comment pointer (records why the env-guard was rejected, on a delicate surface where a future "simplification" could regress).
