# Code Review: agent-backend-role-routing

> Reviewer: Claude | Spec: `tasks/agent-backend-role-routing/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored (STAGE_1 pass, OVERALL_SIGNAL changes_requested), cold-Claude (COLD_OVERALL_SIGNAL approve, 11 low findings), cold-Codex (no findings; "preserves the existing backend invocation behavior").

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (E2E N/A per spec)
- [x] Red-first evidence recorded for each red-first AC (AC-6(a), AC-6(b), AC-8 rows against 9675e2f) — see Risk item 2 for a confound in the AC-6 rows

The anchored lens re-ran type-check, lint and the new/parity tests (139/139 pass), and confirmed `dist/` matches a fresh build (only the outDir path comment differs).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: role/phase/slot maps pure and tested | Pass | Exports in `src/lib/pipeline-policy.ts`; table rows (a)(b)(c) plus human_review in `tests/pipeline-policy.test.ts`; `process.env` count 0. |
| AC-2: no vendor naming in phases/main | Pass | All four greps re-run: zero hits. |
| AC-3: byte-identical invocations | Pass | All 15 sites have parity rows; spec still passes no cwd; retry still passes no metricsContext; spec/plan model-pin case present. Expected values are computed through retained runners rather than stored literals (documented deviation) — see Nit 1. |
| AC-4: role-keyed slots, legacy read fallback | Pass | `getStoredSessionId` role-first `??` legacy (`src/orchestrator/state.ts:508`); writes role-only; four-slot matrix in `tests/agent-backend.test.ts`; implement fix-up uses the fallback read. |
| AC-5: pair clears | Pass | `clearSessionPair` at reset-spec-review, reset-code-review, fast/full reroute, hallucination path; tests seed all 8 keys; legacy-name grep hits only `state.ts`/`types.ts`. |
| AC-6: routing ignores `phases[].agent` | Pass | Retry/storage route by phase; `recordPhaseAgent`; preflight rejection returns `agent: null` and field unchanged. Red-first confound noted in Risk item 2. |
| AC-7: required binaries from role map | Pass | Derivation `{claude,codex}` / `{claude}` fixture; `deps.ts` injectable probe tested; `tests/cli.test.ts` untouched and passing. |
| AC-8: QA salvage reads text first | **Partial** | Gate and text-first ordering correct, red-first test present, but the stdout fallback is unreachable (Correctness Bug 1). |
| AC-9: prompts/goldens untouched | Pass | `git diff --name-only main...HEAD -- src/orchestrator/prompts/ tests/run-task-prompts.golden.json` empty. |
| AC-10: no provider-selection surface | Pass | Grep zero hits. |
| AC-11: status template guard | Pass | Template row in `tests/run-task-validation.test.ts`; template unchanged; sync check passes. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

AC-8 is Partial on one line of code; treated as a Stage 2 correctness bug rather than a Stage 1 gate failure since the rest of the implementation is complete and reviewable.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A clean, well-contained refactor: phases and `main.ts` reach agents only through `agentBackendFor(role)`, slot routing is by phase with a role-first legacy fallback, every clear site goes through one pair helper, and the sibling sweep (both Claude lenses) found no remaining direct runner/getter callers, legacy-only deletes, or stale slot-name restatements in docs, skills, `.canon/templates/` or prompts. cold-Codex found nothing. One real bug blocks: the AC-8 fallback is dead code. Two small test-integrity fixes ride along.

### Findings

#### Correctness Bugs

1. **`code-bug` — QA salvage stdout fallback never runs** (`src/orchestrator/phases/qa.ts:52`). Flagged by 2 lenses (anchored, cold-Claude); foreman-verified. `extractDoneMdFromStdout(result.text) ?? extractDoneMdFromStdout(result.capturedStdout)` relies on `??`, but `extractDoneMdFromStdout` returns `''` on no match (`src/orchestrator/validation.ts:861-862`), never null/undefined. So when `text` is non-empty but lacks a `# QA Summary` / `# Completion Summary` heading, or is `''`, the `capturedStdout` branch is skipped. AC-8 requires "tries `text` first, then falls back to `capturedStdout`." Fix: use `||` (or an explicit truthiness check), and add a test row where `text` has no summary heading but `capturedStdout` does, asserting `done.md` is salvaged from stdout.

#### Risk / Guardrails

2. **`code-bug` (test integrity, low) — AC-6(a) red-first test does not isolate the empty-agent cause** (`tests/run-task-safety.test.ts:10794`). Anchored lens. The test seeds `sessions.implementer`, a key that does not exist on 9675e2f, so it would fail on base even with `agent: 'codex'`; it proves the rename, not that routing ignores `phases[].agent`. Add a variant that seeds the **legacy** `sessions.codex` with `phases.implement.agent: ''` and asserts the retry resumes it (fails on base only because of the empty agent; passes now via fallback). AC-6(b) at `:10817` has the same confound but no clean isolation is available (base writes nothing for `''`, writes `claude_spec` for `'claude'`); leave it, or assert that *no* session key at all is written on base if that is easy.
3. **`code-bug` (test integrity, low) — misleading baseline provenance comment** (`tests/agent-backend.test.ts:8`). Flagged by 2 lenses (anchored, cold-Claude). "Invocation values captured before the routing refactor (9675e2f)" — the committed test imports `agentBackendFor`, which does not exist at 9675e2f, and computes expected argv at run time from the current config getters. Reword the comment to say what it actually pins (literal session flags/model/effort/budget under a scrubbed env, computed via retained runners), and correct the describe title if it claims to cover "all session call sites" (it exercises `agentBackendFor(role).run` directly; the per-site rows live in `run-task-safety` / `run-task-code-review`).

Non-blocking note for the human (cold-Claude, verified possible, accepted): running an **older** canon engine against a status file written by this one leaves role keys alone when that engine clears legacy keys (reset-*, reroute), so the newer engine later resumes the stale role-key session. This is a downgrade/mixed-version path outside the spec's forward-compat contract (Data Model Changes: "Compatibility comes from the read fallback alone"); worth remembering if canon-on-canon runs mix the global and dev engines on one task.

#### Optional Cleanup / Nit

1. AC-3 parity rows in `tests/run-task-safety.test.ts` / `tests/run-task-code-review.test.ts` build expected argv by calling the retained runners with a hand-copied pre-change call shape, not from stored literals (anchored + cold-Claude). Acceptable — the runners' argv construction is unchanged and the deviation is documented in the handoff — but the spec phase's no-cwd shape is never pinned literally in `tests/agent-backend.test.ts`. Optional: add one literal row with `cwd` omitted.
2. Backend methods use `this.resolveConfig` / `this.id` (`src/orchestrator/agents/claude.ts`, `codex.ts`), so a detached method throws; tests already need `.bind(coldBackend)` (`tests/run-task-code-review.test.ts:1483`). Reference the object by name instead. Flagged by 2 lenses.
3. `role` on `AgentRunRequest` / `ColdReviewRequest` (`src/orchestrator/agents/backend.ts`) is never read; a mismatched role is silently accepted.
4. `PipelinePhase` in `src/lib/pipeline-policy.ts` duplicates the `Phase` union in `types.ts`; inline `import('…').AgentBackendId` types in `state.ts` / `types.ts` could be top-level type imports.
5. Mis-indented `const cold = coldBackend.coldReview.bind(coldBackend);` in the "failed delta facts" hunk of `tests/run-task-code-review.test.ts` (~1643).
6. `phases[].agent` is not recorded when a session throws (`recordPhaseAgent` runs after `runPhase` returns, `src/orchestrator/main.ts`). Decision 4 is silent on the throw case; harmless because the field no longer drives routing. No change needed.
7. `docs/patterns.md` "Phase Addition Discipline" could mention the phase→role and phase→slot maps; the `Record<PipelinePhase, …>` types already force the compiler to flag a missing entry.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): QA salvage now actually writes files, so preamble before the heading lands in `done.md` - spec-intended: AC-8 and the audit row "QA `done.md` salvage … **Fixed deliberately**" make enabling text-based salvage the point; the whole-message extraction is pre-existing `extractDoneMdFromStdout` behavior, and Known Risks §Salvage source change accepts it.
- Dismissed (cold-Claude): explicit `null` role key falls through to a stale legacy id (`state.ts:508`) - no writer produces `null`: `storeSessionId` writes strings and `clearSessionPair` deletes keys; only a hand-edited status.json could reach it.
- Dismissed (cold-Claude): doctor gates binary/version/trust checks on the derived set but not `checkRecommendedPermissions` / `checkCodexMdDeprecated` - spec Decision 5 scopes the gating to exactly the agent-binary, Claude-version and Codex-trust checks; the others are unreachable as a difference under the only assignment and belong to the provider-mode follow-up.
- Dismissed (cold-Claude): resume paths don't verify a session id belongs to the resuming backend - spec Decision 6 and Non-Goals ("No tagging of session slots with a backend id") explicitly defer this to the follow-up, recorded in `docs/decisions.md`.
- Dismissed (cold-Claude): `claudeBackend.coldReview` rejects with a plain `Error` and the cold-review failure reason still says "cold-Codex" - unreachable under the only assignment; spec Decision 2 says the Claude backend reports cold review as unsupported and treats the interface as provisional, and Non-Goals exclude vendor-wording changes in operator messages and the cold-Codex naming.
- (cold-Claude test-integrity items on `tests/agent-backend.test.ts` and the parity rows were not dismissed; merged into Risk item 3 and Nit 1. The `this`-binding and indentation items are Nits 2 and 5.)
- cold-Codex: no findings to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Required this round: Correctness Bug 1 (fix + fallback test row), Risk 2 (legacy-key empty-agent retry variant), Risk 3 (comment/title accuracy). Nits are optional.

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Full — base `main` — reason: delicate

Lens returns: anchored (STAGE_1 pass, STAGE_2_FINDINGS none, OVERALL_SIGNAL approve), cold-Claude (11 findings, COLD_OVERALL_SIGNAL changes_requested), cold-Codex ("no actionable regressions in the changed code paths"). Iteration commit: 4922a29.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: Iteration 2 `### Re-run validation` has no `Fail` rows (lint, type-check, full suite 1792/1793 + 1 skip, build, sync-templates, docs-refs all Pass; E2E N/A per spec). The anchored lens re-ran lint and type-check (clean) and confirmed a fresh `npm run build` leaves `dist/` unchanged. Red-first evidence is present across the handoff: baseline rows for AC-6(a), AC-6(b), AC-8, plus the Iteration 2 rows for AC-8 (against c6c3e4f) and the isolated AC-6(a) legacy retry (against 9675e2f, independently reproduced by the anchored lens).

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | `src/lib/pipeline-policy.ts` maps and `tests/pipeline-policy.test.ts` rows untouched by 4922a29. |
| AC-2 | Met (unchanged from round 1) | No phase/main routing code in the delta. |
| AC-3 | Met | Only the comment/title of `tests/agent-backend.test.ts:8-10,29` changed; per-site parity rows unchanged and passing; `tests/run-task-code-review.test.ts:1644` indent fix is whitespace only. |
| AC-4 | Met (unchanged from round 1) | Role-first read with legacy fallback unchanged; new legacy-retry test exercises it again. |
| AC-5 | Met (unchanged from round 1) | `clearSessionPair` and call sites untouched. |
| AC-6 | Met | `tests/run-task-safety.test.ts:11071-11097` seeds only legacy `sessions.codex`: on 9675e2f the empty-agent case returns `RETRY=no_session` while the `'codex'` control resumes; both pass at HEAD. Isolates the empty-agent cause. |
| AC-8 | Met | `src/orchestrator/phases/qa.ts:52` uses `||`. Three output-selection cases at `tests/run-task-safety.test.ts:11099-11128`; anchored mutation check with `??` restored fails both fallback cases and passes text-wins. `dist/orchestrator/run-task.js:7119` carries `||`. |
| AC-9 | Met (unchanged from round 1) | No prompt/golden changes. |
| AC-10 | Met (unchanged from round 1) | No provider-selection surface. |
| AC-11 | Met (unchanged from round 1) | Template row and template unchanged. |

### Verifying Round 1 findings

- _correctness bug:_ "QA salvage stdout fallback never runs" → addressed (`src/orchestrator/phases/qa.ts:52`; tests `tests/run-task-safety.test.ts:11099-11128`; AC-8 now Met) ✓
- _risk/guardrail (test integrity):_ "AC-6(a) red-first doesn't isolate empty-agent cause" → addressed (`tests/run-task-safety.test.ts:11071-11097`, legacy-only seed with `'codex'` control) ✓
- _risk/guardrail (test integrity):_ "misleading baseline provenance comment/title" → addressed (`tests/agent-backend.test.ts:8-10,29`) ✓
- _nit 5 (indent):_ → addressed ✓. Other nits left as optional, as round 1 allowed.

### Stage 2 — New findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none blocking)

Non-blocking note for the human (cold-Claude, verified): reviving QA salvage from `result.text` (AC-8) makes the pre-existing "salvage → advance qa to done" branch (`src/orchestrator/phases/qa.ts:53-60`) live in real Claude runs. It was effectively dormant before, because raw stream-json lines never start with `# QA Summary`. If a QA session leaves `done.md` at the template and its final reply contains a `# QA Summary` / `# Completion Summary` heading, the reply (with any preamble) is written to `done.md` and `qa` is forced to `done`, even over a self-set `blocked`. This is spec-intended; see the dismissal below for the evidence. A one-line guard (skip the auto-advance when `qa` is `blocked`) would be a cheap follow-up if you want it.

#### Optional Cleanup / Nit

1. `src/lib/pipeline-policy.ts` `PipelinePhase` duplicates the `Phase` union in `src/orchestrator/types.ts` (carried from round 1 nit 4). Flagged again by cold-Claude.
2. The `coldReview` member of `AgentBackend` in `src/orchestrator/agents/backend.ts` returns the Codex-named `ColdCodexReviewResult`. The interface is declared provisional in spec Decision 2; the provider-mode follow-up can reshape it.
3. `recordPhaseAgent` and `storeSessionId` each do their own read-modify-write per task after a phase (`src/orchestrator/state.ts`, `main.ts` storage block); they could fold into one write.
4. The "author config preserves distinct spec and plan model pins" test in `tests/agent-backend.test.ts` does not scrub other `CLAUDE_MODEL*` vars, unlike the parity test. It is low risk because the per-phase vars take precedence.
5. `docs/decisions.md` has two blank lines before the new `## Phases route by role through agent backends (2026-10)` heading.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): QA salvage now fires from `result.text` and can mark QA done against the agent's intent - spec-intended. AC-8 requires "Salvage runs when either `text` or `capturedStdout` is non-empty. It tries `text` first". The spec's correctness-audit row for QA `done.md` salvage records the dormant-salvage miss as **Fixed deliberately**, and Known Risks covers the salvage source change. The done-advance branch is pre-existing salvage design for the exact case the QA prompt warns about: content emitted as chat instead of written (`src/orchestrator/prompts/templates/qa.md:9-10`). The QA prompt never instructs QA to self-block. The residual blocked-override edge is recorded above as a non-blocking human note.
- Dismissed (cold-Claude): fallback tests lock the whole raw transcript (including the JSON line) into `done.md` (`tests/run-task-safety.test.ts:11102-11123`) - not a test-integrity defect. The tests pin AC-8's required stdout fallback against `extractDoneMdFromStdout`'s unchanged contract: it returns the whole trimmed input on a heading match (`src/orchestrator/validation.ts:859-864`). The mutation check confirms the tests fail if the fallback is removed. Changing what the extractor emits is outside this refactor.
- Dismissed (cold-Claude): an explicit `null` role key falls through to a stale legacy id (`src/orchestrator/state.ts:508`) - same as round 1. No writer produces `null`: `storeSessionId` writes strings and `clearSessionPair` deletes keys.
- Dismissed (cold-Claude): mixed engine versions on one task resume the wrong session - same as round 1. A downgrade/mixed-version path outside the spec's forward-compat contract (Data Model Changes: "Compatibility comes from the read fallback alone"). It stays recorded as the round-1 non-blocking human note.
- Dismissed (cold-Claude): `retryAgentForPhase` and the fix-ups don't check that the recorded `phases[].agent` matches the resuming backend - spec Decision 6 and Non-Goals ("No tagging of session slots with a backend id") defer enforcement to the provider-mode follow-up. Decision 4 makes the field a record that "No routing decision reads". `docs/decisions.md` records the constraint.
- Dismissed (cold-Claude): phase banners and the cold-review failure message still hard-code "Claude"/"Codex"/"cold-Codex" - spec Non-Goals: "No changes to … vendor wording in operator-facing messages" and "No renaming of `review-cold-codex.md` … or the scope-reason strings". Under the only assignment the labels are accurate.
- (cold-Claude `PipelinePhase` duplication, `coldReview` type leak, double read-modify-write, env scrub and decisions.md blank line: verified and kept as Nits 1-5.)
- cold-Codex: no findings to dismiss.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

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

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

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
