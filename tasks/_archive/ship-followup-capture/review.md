# Code Review: ship-followup-capture

> Reviewer: Claude | Spec: `tasks/ship-followup-capture/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored Claude (`STAGE_1: pass`, 8 Stage 2 findings, signal approve), cold Claude (10 findings, signal changes_requested), cold Codex (1 finding, injected). All three returned in charter format. This round follows the post-review reroute; the pre-reroute review is archived at `tasks/ship-followup-capture/review-prior-1.md`, and all four of its blocking findings are resolved (the `None.`-plus-prose bug in `src/orchestrator/followups.ts`, plus Amendment AC-15/16/17).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did the implementer's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results — full `npm test` reported passing in the handoff; the anchored lens re-ran the seven touched suites (641/641 pass) and `sync-templates:check` / `docs-refs-check` (pass).
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC — AC-15's red-first row ran against `7537f6e`, whose `src/orchestrator/phases/qa.ts` has no catch; the failure matches the spec's stated reason.
- [x] Self-Check evidence in the effective record is not contradicted by the diff

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: done.md template Follow-ups section | Pass | `.canon/templates/done.md` section after Open Questions with header, six categories, four Tracked forms, `\|`, `None.`; mirror synced. |
| AC-2: QA prompt Follow-ups rules | Pass | `src/orchestrator/prompts/templates/qa.md` covers all four sources, mapping, `risk` default, `[spec-gap]`, nits, Docs drift rows, Tracked values, escaping, `None.`; prompt test + golden updated. |
| AC-3: Parser + unit tests | Pass | `src/orchestrator/followups.ts` + `tests/followups.test.ts`; prior `None.`-plus-prose bug fixed and tested. |
| AC-4: qa gate rejects missing/unparseable | Pass | `src/orchestrator/validation.ts` gate; tested via `checkPhaseGate` and `taskPhase`. |
| AC-5: ship lists post-ship + untracked blocks | Pass | `tests/run-task-ship-docs-fold.test.ts`. |
| AC-6: no blocks for None./dropped/reference-only | Pass | Tested; no warning. |
| AC-7: bundle grouping | Pass | One Untracked block grouped by task id. |
| AC-8: one warning per missing/unparseable/no-file | Pass | Three cases: exit 0, archived, one warning. |
| AC-9: externally-merged resume path | Pass | External-merge test asserts the Untracked block. |
| AC-10: listing is read-only | Pass | Archived done.md byte-compared; no `gh issue` call. |
| AC-11: canon-pipeline skill human_review step | Pass | `.claude/skills/canon-pipeline/SKILL.md` §2b + post-ship paragraph; mirror synced. |
| AC-12: no config key, no gh issue | Pass | No config change; no `'issue'` in `src`. |
| AC-13: restatement surfaces consistent and complete | Pass | Recovery-guide gap closed by AC-17; anchored grep for `qa done` found no other stale restatement. |
| AC-14: decisions.md entry | Pass | `docs/decisions.md` entry covers all four points. |
| AC-15: salvage path does not throw on gate rejection | Pass | `src/orchestrator/phases/qa.ts` catches only `check-phase-gate:` errors, warns, leaves qa not done; blocked branch unchanged and first; new test in `tests/run-task-safety-providers.test.ts` passes. |
| AC-16: five fixtures gain a valid section | Pass | All five carry `## Follow-ups` / `None.`; suites pass. |
| AC-17: recovery guide names the section | Pass | `.claude/skills/canon-pipeline/recovery.md` and mirror updated; sync check passes. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted — the salvage-path instance of "the new qa gate blocks QA" is now handled (AC-15).
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The parser, qa gate, salvage handling, and ship listing are tight and well covered; every AC is met and the prior round's blocking findings are resolved. What survives is low-severity polish, three of it carried over unchanged from the prior round's nits. No code-bug or spec-gap survives adjudication.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none blocking — see nits)

#### Optional Cleanup / Nit

1. **Template placeholder row passes the gate and prints as a real follow-up** — `.canon/templates/done.md:65`, `src/orchestrator/followups.ts`. Flagged by 2 lenses (anchored, cold-Claude; carried from the prior round). If QA leaves `| (category) | (what remains and why it matters) | untracked |`, `qa done` succeeds and `--ship` prints `- [(category)] (what remains and why it matters)`. Kept as a nit, not a code-bug: it surfaces visibly as an `untracked` row that the human_review step (SKILL.md §2b) puts to the human, so nothing is lost silently, and the spec deliberately keeps unknown categories (see the cold-Codex dismissal). Optional fix: have the parser reject that exact scaffold row as unfilled.
2. **Doubled period in the gate message** — `src/orchestrator/validation.ts:1022` with `src/orchestrator/followups.ts:79`. Flagged by 2 lenses; carried from the prior round. Adopters see `` …or the line `None.`. Fix done.md, then rerun… ``; the AC-15 salvage warning repeats it.
3. **Ship warning reports any read or parse failure as "missing"** — `src/orchestrator/main.ts:2829-2832`. Flagged by 2 lenses; carried from the prior round. The bare `catch` turns EACCES/EISDIR or a parser exception into "done.md is missing". Narrow to ENOENT or include the error message.
4. **Salvage catch keys on a string prefix built elsewhere** — `src/orchestrator/phases/qa.ts:67` matches `check-phase-gate:` from `src/task/index.ts:474` with no shared constant (anchored). The AC-15 test would catch a rewording; a shared constant would remove the coupling.
5. **Unclosed fence hides the heading and yields a misleading "no section" message** — `src/orchestrator/followups.ts:69` ignores `scanSpecManifest`'s `unclosed` result (cold-Claude). Message quality only; the gate still rejects.
6. **Recovery-guide sentence breaks the lead-in colon** — `.claude/skills/canon-pipeline/recovery.md:101` sits between "…doesn't match the artifact:" and the bash block (anchored). Move it above the lead-in or into the block as a comment.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): reject follow-up categories outside `FOLLOWUP_CATEGORIES` - spec-intended. `tasks/ship-followup-capture/spec.md` Decision item 6 says "A row whose category is not one of the six values is still listed, with its category shown as written", and AC-3 requires a unit test that "an unknown category [is] kept as written". Rejecting them would break an AC. (Related placeholder-row concern kept as nit 1.)
- Dismissed (cold-Claude): `None.` form rejected when other prose remains, while a table tolerates prose - spec-intended and the prior round's own fix: the template and prompt say "write `None.` alone", and the prior review required `None.` to be the sole visible line so prose items aren't silently discarded. The gate message names the fix.
- Dismissed (cold-Claude): formatted or pluralized header (`**Category**`, `Follow-ups`) hard-fails - spec-intended: AC-3 requires a non-matching header to be reported unparseable, and the gate message names the exact expected header. Same dismissal as the prior round.
- Dismissed (cold-Claude): pipe inside an inline-code cell splits the cell - matches GFM table semantics (pipes split cells inside code spans too); the template and prompt document `\|` escaping, and the gate message says so.
- Dismissed (cold-Claude): pre-check path (`splitState.taskDirFor`) vs gate path (`taskRootForGate(resolveTaskCwd)`) in `tryEvidenceAdvance` - self-rated low confidence with no concrete divergent scenario; it reuses the path the existing `isDoneMdTemplate` pre-check already uses. Same dismissal as the prior round.
- Dismissed (cold-Claude): external-merge ship test shares the fixture used by other tests - not a test-integrity problem: that fixture *is* the external-merge resume path, so the AC-9 test exercises it; other tests reusing it adds coverage of the same path rather than weakening AC-9.
- Dismissed (cold-Claude): missing unit tests for prose-plus-`None.` and formatted header - both covered (`tests/followups.test.ts:42-48` for prose-plus-`None.`; AC-3's non-matching-header case). The placeholder-row case is covered by nit 1.

Anchored-lens items not carried as findings:
- Salvage warning's manual-rerun advice may read as the next step while the orchestrator's one-shot retry runs (`src/orchestrator/phases/qa.ts:69`) - self-rated low confidence; the message is the gate's own and accurate.
- AC-15 test covers `runQaPhase` alone, not the downstream `recoverPhaseForTask` retry - not a spec gap: the spec's "existing 'phase did not reach done' path" is the orchestrator's existing recovery handling, which `tryEvidenceAdvance`'s new `followupsProblem` pre-check (`src/orchestrator/main.ts:3665-3671`) correctly refuses to advance through. Behavior matches the spec; an end-to-end test would be extra coverage.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Verdict rationale: Stage 1 passes on all 17 ACs with a clean validation record; no code-bug or spec-gap survives. The six nits are optional; QA should list them as `nit` follow-ups.

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
