# Code Review: multi-agent-code-review

> Reviewer: Claude | Spec: `tasks/multi-agent-code-review/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

> **Bootstrap note.** This task restructures the `code_review` phase itself. It was reviewed under the *old* single-session machinery (the new foreman/lens machinery only takes effect after this lands), so this is a direct anchored review plus an adversarial cold read of the routing/plumbing performed in-session — not the two-subagent foreman flow this task introduces.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks? **Yes** — and independently re-run by the reviewer (delicate task, review-gate hot path):

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

| Check | Handoff claim | Reviewer re-run |
|---|---|---|
| `npm run type-check` | Pass | **Pass** (clean) |
| Touched tests (`node --test` for the 6 changed test files) | Pass | **Pass** (343/343) |
| `npm run lint` | Pass | **Pass** (clean) |
| `npm run sync-templates:check` | Pass | **Pass** (all in sync) |
| `npm run docs-refs-check` | Pass | **Pass** (all refs OK) |
| `npm run build` → `dist/` drift | Pass | **Pass** (`git status` on `dist/` empty after fresh build) |

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 (structure: foreman spawns 2 isolated lenses, writes single review.md + verdict; no `PHASE_ORDER` change) | Met | `promptCodeReview()` renders `code-review-foreman.md` which spawns `code-review-anchored` + `code-review-cold` via the Task tool; `PHASE_ORDER` unchanged in `types.ts`. Foreman is prompt-driven; the phase still spawns one Claude session (`phases/code-review.ts:222`). |
| AC-2 (anchored lens = current charter unchanged, returns findings to foreman) | Met | `.claude/agents/code-review-anchored.md` carries Stage 1 AC-compliance + Stage 2 quality + test-integrity, and explicitly forbids writing `review.md` / running `canon task phase`. |
| AC-3 (cold lens, diff-only, no spec injected) | Met (see Risk-1) | Foreman prompt (`code-review-foreman.md:45-51`) injects diff + base ref only and is told not to give the cold lens spec/AC/canon context; cold agent def reinforces. Isolation is prompt-enforced, not sandboxed — see Risk-1. |
| AC-4 (adjudication: dedup + cold-vs-spec reconciliation; no foreman re-review) | Met | `code-review-foreman.md:53-61` instructs dedup ("flagged by both lenses"), `Dismissed (cold): … - <spec reason>`, and "Do not perform a new full diff review for novel bugs." |
| AC-5 (altitude + verdict + routing: `spec_gap` halts, must NOT fall through to qa) | Met | `main.ts:2537-2564` intercepts `spec_gap` **before** the changes_requested/fall-through logic, calls `autoBlockPhase` + `process.exit(2)`. Verified by `tests/run-task-safety.test.ts`. `changes_requested`/`needs_re_review` → implement; approvals fall through to qa (unchanged). |
| AC-6 (fail-loud at phase boundary) | Met | `phases/code-review.ts:234` resets to pending when `review.md` is the unfilled template; `checkPhaseGate` (`validation.ts:966-983`) rejects a filled-but-no-checked-verdict artifact and a status↔artifact verdict mismatch. No silent approve path. |
| AC-7 (delete old direct-review path; no dual path) | Met | `promptCodeReview()` unconditionally renders the foreman; the round-1/round-n templates survive only as inert registry entries with "retained as charter reference" headers, never selected for dispatch (grep-confirmed). See Nit-1. |
| AC-8 (models reuse existing code_review tier; no new matrix; no haiku) | Met (see Risk-2) | No `pipeline-policy.ts` change; lens defs declare no `model` → inherit the foreman's tier (the spec's authorized "pin or inherit" choice). Runtime tier of the spawned lenses is not unit-coverable — see Risk-2. |
| AC-9 (single artifact; re-review re-runs both lenses from scratch) | Met | Foreman writes one `review.md`; `code-review-foreman.md:13-14` ("Both lenses re-run from scratch") + fresh sub-agent spawn each round satisfy the "any implement cycle invalidates prior approvals" invariant. |
| AC-10 (verdict plumbing across all seven surfaces) | Met | (1) `types.ts` union; (2) `src/task/index.ts` `VALID_VERDICTS` **and** `assertValidVerdict()` error text; (3) `src/cli/index.ts` help; (4) `.canon/templates/status.json` + mirror `_verdict_values`; (5) `validation.ts` `extractCheckedVerdict` regex (`:873`) **and** `PHASE_GATE_CONFIG` code_review acceptance; (6) `.canon/templates/review.md` + mirror `Spec gap` checkbox; (7) `main.ts` routing. All confirmed present. |
| AC-11 (deterministic-surface tests) | Met | Verdict extraction (`run-task-extract-verdict`), phase gate (`run-task-validation`), CLI/runtime acceptance (`task-cli`), counters (`run-task-counter-schema`), `spec_gap` routing/no-qa-advance (`run-task-safety`), foreman+lens prompt contract (`run-task-prompts` + regenerated golden). All pass. |
| AC-12 (docs + canon-owned registration + mirrors) | Met | `CLAUDE.md` / `AGENTS.md` / `docs/pipeline-orchestrator.md` updated + mirrored; lens defs registered in `src/lib/canon-owned.ts` and mirrored to `templates/.claude/agents/`; `sync-templates:check` + `docs-refs-check` pass. |

### Dropped Sections Check

- [x] Non-goals respected — no new phase, no FP-revalidation pass, no third lens, no Node synthesis layer, no full-send auto-amend. All Non-Goals held.
- [x] Known Risks addressed or accepted — the coverage-seam, all-LLM-not-unit-testable, and high-blast-radius risks are accepted by design and reflected in the implementation (deterministic net tested; synthesis quality → HTP).
- [x] Human Test Plan satisfiable — all 8 HTP steps are exercisable against the shipped structure (they are the validation path for synthesis quality, by design).

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality

### Summary

Clean, surgical implementation that correctly resolves the spec's central design tension (all-LLM foreman, no Node synthesis layer) by leaving the deterministic Node surface as the only thing it touches: verdict plumbing across all seven enumerated surfaces, `spec_gap` interception that halts before the qa fall-through, and reuse of the existing `isTemplateUnfilled` + `checkPhaseGate` net for fail-loud. The phase file `phases/code-review.ts` needs no change because the foreman is purely prompt-driven and the existing single-session spawn already provides the dispatch + fail-loud path — a legitimate consequence of the all-LLM decision. No correctness bugs found; the two risk items below are exactly the things the spec's own Known Risks defer to human testing.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **Risk-1 — Cold-lens isolation is prompt-enforced, not sandboxed.** AC-3 calls the isolation a "hard contract," but the cold agent inherits all tools (no `tools:` field in `.claude/agents/code-review-cold.md`), so it *can* `Read` `spec.md` if it disregards its instructions. The foreman never *injects* spec content (the contract is met on the injection side), and this is the strongest mechanism available within the spec's chosen all-LLM design — so it meets AC-3 as written. Flagging because "hard contract" reads stronger than the mechanism delivers. If a future run shows the cold lens leaking into spec-aware reasoning, a `tools:` allow-list that drops `Read` (or restricts it to the diff) would harden it. Not blocking.
- **Risk-2 — Lens model tier is runtime-inherited and not unit-verifiable.** The spec *verified model pinning*; the implementer chose *inheritance* (no `model:` field) — authorized by Design ("pin or inherit — pick at implement time"). But AC-11(4)'s test covers the *policy function* for the foreman, not the model the spawned sub-agents actually run at. Whether the lenses run at opus on a delicate task (AC-8) depends on Claude Code's headless-session subagent inheritance behavior, which no test in this PR exercises. This is the single most important thing to confirm on the first real exercise of the new gate (the spec's own Known Risk: "validate on a planted-bug task first"; HTP steps 5 & 7). Not blocking — but do not assume the tier without observing it once.

#### Optional Cleanup / Nit

- **Nit-1 — `handoff.md` deviation table is incomplete.** It documents the `claude.ts` non-edit but not that `scripts/run-task/phases/code-review.ts` was left untouched despite the spec's Affected Files naming it the primary "restructure" target. The omission is harmless (the all-LLM approach makes the restructure unnecessary, and the spec's Design authorizes it), but a reviewer cross-referencing Affected Files → Changes would otherwise flag a missing file. Worth a one-line deviation row.
- **Nit-2 — Dead template registry entries.** `code-review-round-1.md` / `-round-n.md` remain imported into the `TEMPLATES` map though nothing dispatches them. The "retained as charter reference" comment is fine, but the live anchored charter now lives in `.claude/agents/code-review-anchored.md`; the retained prompt files will drift from it over time. Consider deleting them in a follow-up once the anchored lens def is settled.

#### Spec Gaps

(none) — the spec was unusually thorough (AC-10 pre-enumerated all seven plumbing surfaces, Codex spec_review caught the runtime/type divergence), and the implementation matched it.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

> The two risk items are confirm-during-human-testing items the spec already anticipated (Known Risks + HTP), not code defects; the two nits are optional. No correctness bugs or spec gaps. Approving with nits. **Before relying on the new gate, the human must run HTP step 2 (spec_gap halt), step 6 (fail-loud), and confirm Risk-2 (lens model tier) on a planted-bug delicate task.**

---

<!--
On re-review, append below this line:

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
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
