# Code Review: qa-drafts-pr-body

> Reviewer: Claude | Spec: `tasks/qa-drafts-pr-body/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All six required checks (lint, type-check, test, build, docs-refs-check, sync-templates:check) report Pass. E2E is `not_configured`, matching the spec's `- [ ] E2E — N/A (no UI surface)` marking. No Fail or unexplained gaps.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: QA writes a filled body | Met | `qa.md` step 4 instructs QA to write `tasks/<id>/pr-body.md` using injected template or default skeleton. Template injection flows through `runPhase` → `runQaPhase` → `promptQa` → Mustache render. `.canon/templates/pr-body.md` stub exists. |
| AC-2: outward-facing, no footprint | Met | `qa.md` explicitly forbids "canon", "Claude", "AI", "generated", or any attribution. Default skeleton (Summary / Changes / How to Test / Notes for Reviewer) contains no inward-facing sections. `done.md` code paths unchanged. |
| AC-3: `--pr` precedence | Met | `createDraftPRForTask` calls `resolveCanonPrBody` first; on null, calls `resolveQaPrBody`; on `body-file` uses `--body-file`, otherwise falls to template/`--fill`. Precedence is CANON_PR_BODY → populated pr-body.md → repo PR template → `--fill`. `main.ts:779–814`. |
| AC-4: soft fallback + log | Met | `warn(\`PR body fallback (${qaPrBody.reason}) — falling back to repo PR template or --fill\`)` emitted on fallback; no phase is blocked or errored on absence/stub. `main.ts:794`. |
| AC-5: bundles fall back | Met | `resolveQaPrBody` returns `{ kind: 'fallback', reason: 'bundle: ...' }` for `taskIds.length !== 1`. Bundle log path covered in `tests/run-task-safety.test.ts`. |
| AC-6: artifact registration | Met | `pr-body.md` in `TASK_ARTIFACT_FILES` (worktree.ts), `CANON_OWNED` (canon-owned.ts), `.canon/templates/pr-body.md` + mirror in `templates/.canon/templates/pr-body.md`. `tests/cli.test.ts` extended. `sync-templates:check` passed. |
| AC-7: "populated" is well-defined | Met | `isPrBodyTemplate` in `validation.ts:643–651` with sentinels `[pr-body-stub]` and the task-id placeholder string; both are present in the stub template. Missing-file case returns true (stub). Tests cover missing, stub, and populated. |
| AC-8: no regression | Met | `resolveCanonPrBody` called first and unchanged. `isDoneMdTemplate` hard gate in `qa.ts` is unchanged. `resolveCanonPrBody` tests still pass per handoff. |

### Dropped Sections Check

- [x] Non-goals respected — bundle synthesis not implemented; no `/canon-pr` skill; no default PR template file added; no backfill/migration; no change to `CANON_PR_BODY` semantics; no hard QA phase gate on pr-body.md
- [x] Known Risks addressed — canon-attribution forbidden in prompt; worktree-first resolution matches `--pr`'s own precedence; stub-detector sentinels cover both directions; `done.md` gate unchanged; reroute overwrite accepted as known
- [x] Human Test Plan satisfiable — the drafted `pr-body.md`, `--pr` body-file path, fallback behavior, and CANON_PR_BODY override are all verifiable from a running pipeline

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, tightly scoped implementation. Codex threaded the resolved PR template through the call chain (resolvePhase → runQaPhase → promptQa → Mustache) without introducing new abstractions. The stub detector (`isPrBodyTemplate`) mirrors the `isDoneMdTemplate` pattern precisely. Body-resolution order in `createDraftPRForTask` is easy to follow and the fallback path is well-logged. No unauthorized expansions beyond the spec's Affected Files.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `optional cleanup/nit`: For bundle QA runs, `resolvedPrTemplate` is resolved and injected into the QA prompt even though the prompt instructs QA to skip the pr-body step for bundles. The model will (correctly) skip per the "For single tasks only" instruction, but the PR template text is still present in the prompt, burning tokens needlessly for multi-task bundles. Low-friction fix would be `const resolvedPrTemplate = state.isBundle ? null : (qaTemplatePath ? fs.readFileSync(...) : null)` in `runPhase`. Non-blocking — the model behavior is correct as-is.

#### Spec Gaps

(none)

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

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
