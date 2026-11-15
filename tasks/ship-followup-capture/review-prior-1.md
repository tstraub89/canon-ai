# Code Review: ship-followup-capture

> Reviewer: Claude | Spec: `tasks/ship-followup-capture/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored Claude (returned `STAGE_1: fail`), cold Claude (7 findings), cold Codex (1 finding, injected). All three returned in charter format.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did the implementer's `handoff.md` pass all applicable checks?

- [ ] Validation Outcomes table has no `Fail` results — `npm test` is `Fail – unrelated`, but all five failures are caused by this diff's new qa gate (see Stage 1 gaps). The anchored lens re-ran the three named files and reproduced the same five failures, each with `check-phase-gate: done.md has no ## Follow-ups section`.
- [ ] All checks required by the spec's "Validation Required" section were run — run, but `npm test` ("suite runs clean") is not clean.
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC — no red-first ACs.
- [x] Self-Check evidence in the effective record is not contradicted by the diff — the Restatement-sweep and Sibling-parity rows name the out-of-scope gaps honestly.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: done.md template Follow-ups section | Pass | `.canon/templates/done.md` adds the section after Open Questions with header, six categories, four Tracked forms, `\|`, `None.`; Open Questions no longer mentions follow-ups; mirror synced. |
| AC-2: QA prompt Follow-ups rules | Pass | `src/orchestrator/prompts/templates/qa.md` covers all four sources, mapping, `risk` default, `[spec-gap]`, nits, Docs drift rows, Tracked values, escaping, `None.`; prompt test + golden updated. |
| AC-3: Parser + unit tests | Pass (with code-bug below) | `src/orchestrator/followups.ts` and `tests/followups.test.ts` cover every listed case. The `None.`-plus-prose acceptance (Finding 1) is outside the listed cases but violates the `None.`-alone contract. |
| AC-4: qa gate rejects missing/unparseable | Partial | `src/orchestrator/validation.ts` gate and tests cover all four cases through `checkPhaseGate` and `taskPhase`. The QA stdout-salvage caller now crashes on rejection instead of "QA repairs it in the normal way" (Decision item 4) — Finding 2. |
| AC-5: ship lists post-ship + untracked blocks | Pass | `tests/run-task-ship-docs-fold.test.ts` asserts both blocks after "Shipped", exact rows, instruction lines, exit 0, archive. |
| AC-6: no blocks for None./dropped/reference-only | Pass | Both cases asserted, no warning. |
| AC-7: bundle grouping | Pass | One Untracked block, rows grouped by task id in order. |
| AC-8: one warning per missing/unparseable/no-file | Pass | Three cases assert exit 0, archive, exactly one warning. |
| AC-9: externally-merged resume path | Pass | External-merge test asserts the Untracked block. |
| AC-10: listing is read-only | Pass | Archived done.md byte-compared with the task-branch version; gh log has no `issue`. |
| AC-11: canon-pipeline skill human_review step | Pass | SKILL.md §2b + post-ship paragraph cover all required points; mirror synced. |
| AC-12: no config key, no gh issue | Pass | No config change; `rg "'issue'" src` empty. |
| AC-13: restatement surfaces consistent and complete | Partial | All listed surfaces updated, but `.claude/skills/canon-pipeline/recovery.md:103` (and mirror) restates the manual `qa done` recipe without the new gate, so the "complete set" claim is false — Finding 4. |
| AC-14: decisions.md entry | Pass | `docs/decisions.md` entry covers all four points. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — the implementer stopped at the Affected Files cap and recorded three `[scope]` Blockers rather than editing outside it.
- [ ] Known Risks addressed or documented as accepted — "The new qa gate blocks QA" risk materialized on the salvage path (Finding 2).
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Stage 1 fails on the required `npm test` and on AC-4/AC-13 partials. Per the foreman protocol the cold-lens findings are still adjudicated below; the anchored Stage 2 did not run.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Anchored Stage 2: not run — Stage 1 failed. The findings below come from Stage 1 gaps and the cold lenses. The parser, gate, and ship listing are well-built and well-tested within scope; the blocking problems are (a) one in-scope parser bug and (b) three consequences of an Affected Files list that omitted the gate's other callers, fixtures, and one restating doc. (b) cannot be fixed by implement without a spec amendment.

### Findings

#### Correctness Bugs

1. **[code-bug] `None.` is accepted alongside other prose, silently discarding items** — `src/orchestrator/followups.ts:40-41`. Flagged by cold-Codex; verified. With no table, `visibleBody.some(line => /^none\.?$/i.test(line))` accepts the section if *any* line is `None.`. Input: `## Follow-ups` / `None.` / `- Fix the retry loop later.` → parses as zero rows; the qa gate passes and `--ship` lists nothing, losing exactly the soft-worded items this task exists to capture. The template and prompt say "write `None.` alone". Fix: with no table, accept only when `None.` is the sole visible body line; otherwise unparseable. Add a unit test.

#### Risk / Guardrails

(none beyond the spec gaps below)

#### Optional Cleanup / Nit

- **Template placeholder row parses as a real follow-up** — `.canon/templates/done.md:65` (cold-Claude, verified). `| (category) | (what remains and why it matters) | untracked |` is a valid row; if QA leaves it, `--ship` prints `- [(category)] (what remains and why it matters)`. Low: it is visible to the human as untracked. Optionally have the parser treat that exact row as unparseable/placeholder.
- **Doubled period in the gate message** — `src/orchestrator/validation.ts:1020` (cold-Claude, verified). The missing-section reason ends in `` `None.` `` and the gate appends `. Fix done.md…`, producing `` `None.`. Fix ``. Adopter-visible text.
- **Ship warning says "missing" for any read/parse error** — `src/orchestrator/main.ts:2826-2830` (cold-Claude, verified). The catch covers `readFileSync` and `parseFollowups`, so EACCES/EISDIR or a parser exception is reported as "done.md is missing". Narrow the catch or include the error message.

#### Spec Gaps

These three share one root: the spec's Affected Files omits the gate's other callers, the fixtures the spec's own Implementation Notes predicted would break, and one restating doc. Implement is capped at Affected Files, so each needs an `## Amendment` before it can be fixed.

2. **[spec-gap] QA stdout-salvage path crashes the run** — `src/orchestrator/phases/qa.ts:62`. Flagged by anchored and cold-Claude (2 lenses). After salvaging a done.md without Follow-ups, `taskPhase(taskId, 'qa', 'done')` throws from the new gate; nothing in `runQaPhase` catches it, so the orchestrator exits 1 with qa `in_progress` and no repair route (reproduced by `tests/run-task-safety-providers.test.ts`, stack at `runQaPhase (qa.ts:62)`). The diff guards the sibling caller (`tryEvidenceAdvance` in `src/orchestrator/main.ts` pre-checks `followupsProblem`); this one is left unguarded. The spec asked to "confirm ... that salvage paths go through the same gate" but did not list `src/orchestrator/phases/qa.ts`. Amendment should add the file and state the behavior: on gate rejection, salvage leaves qa un-advanced with a repair note (same route as `tryEvidenceAdvance`), never throws.
3. **[spec-gap] Required `npm test` fails: five existing QA fixtures lack the section** — `tests/run-task-safety-base-drift.test.ts:1831`, `tests/run-task-safety-providers.test.ts:27` (×3), `tests/run-task-safety-routing.test.ts:1536`. Flagged by anchored lens and the implementer's own Blocker. The failures are caused by this diff, so `Fail – unrelated` is mislabelled; Validation Required demands a clean suite. Spec Implementation Notes predicted "Fixtures that drive QA through the qa → done gate need a done.md with the section" but Affected Files left these files out. Two of the providers/routing cases also exercise Finding 2 and should be updated together with it.
4. **[spec-gap] Stale restatement of the manual `qa done` recipe** — `.claude/skills/canon-pipeline/recovery.md:103` and `templates/.claude/skills/canon-pipeline/recovery.md:103`. Flagged by anchored lens and the implementer's Blocker. AC-13 declares its surface list complete; this recipe now hits the new gate with no mention of the section (AGENTS.md "Code Review Rules": stale restatement is P2). Amendment should add the root file (mirror via sync).

### Dismissed Cold Findings

- Dismissed (cold-Claude): pre-check path vs gate path split (`splitState.taskDirFor` vs `taskRootForGate(resolveTaskCwd)`) in `src/orchestrator/main.ts` `tryEvidenceAdvance` - speculative (self-rated low confidence) with no concrete divergent scenario; the pre-check reuses the same path the existing `isDoneMdTemplate` pre-check already uses, so it introduces no new split.
- Dismissed (cold-Claude): strict header matching (`**Category**`, `Follow-ups`) makes the gate bounce - spec-intended: Implementation Notes say "Classify the table by its header row" and AC-3 requires a non-matching header to be reported as unparseable; the gate message names the exact expected header, so QA can repair it.
- Dismissed (cold-Claude): ANSI/OSC escapes in follow-up cells printed by `--ship` - done.md is a reviewed artifact committed in the operator's own repo, and canon already prints other agent-written artifact text to the terminal; no new trust boundary.

Cold-Codex's single finding survives as Finding 1.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Verdict rationale: Finding 1 is an in-scope code-bug, which per the foreman protocol makes the verdict `changes_requested` even though Findings 2-4 are spec gaps. **Operator note:** implement can fix Finding 1 and the nits, but cannot clear Findings 2-4 or make `npm test` clean without an `## Amendment` to `tasks/ship-followup-capture/spec.md` adding `src/orchestrator/phases/qa.ts`, the three `tests/run-task-safety-*.test.ts` files, and `.claude/skills/canon-pipeline/recovery.md` (with its mirror) to Affected Files, plus the salvage behavior in Finding 2. Amending before the next implement round avoids a guaranteed `spec_gap` on Round 2.


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

---

## Validation Gate

## Pre-Flight Rejection

**BLOCKED — pre-flight rejected before full review:**

### Fix the code

- Validation Outcomes row marked Fail – unrelated cites a file changed by this task: `npm test`. A failure in a file you modified is yours to fix; if genuinely unrelated, cite a file outside your diff. (cited changed file: done.md)

You broke one or more required checks. Fix the regression, re-run the failing check, and update the Validation Outcomes row. Use `Fail – unrelated` only when the failure is genuinely outside your changed files and the Notes cite a specific file/line reference outside your diff.

## Verdict

- [x] **Changes requested** — address the items above and resubmit.
