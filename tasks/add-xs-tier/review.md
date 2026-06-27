# Code Review: add-xs-tier

> Reviewer: Claude | Spec: `tasks/add-xs-tier/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

> **Foreman note — stale pre-flight rejection cleared.** An earlier orchestrator pre-flight wrote a "Pre-Flight Rejection" block here claiming every handoff file was "listed in handoff but not in diff." That block predated the implement commit `2241868`. I verified the current three-dot diff (base `15cbfc7`…HEAD) contains all 29 files in the handoff Changes table and the handoff↔diff reconciliation now passes. The rejection was obsolete and has been replaced by this real round-1 review.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Handoff Validation Outcomes lists all nine required checks (lint, type-check, `npm test`, build, `UPDATE_GOLDENS=1 npm test`, sync-templates, sync-templates:check, docs-refs-check, AC-18 `rg` sweeps) as Pass. The anchored lens independently re-ran type-check, lint, the policy suite (55/55), the two moved orchestration files under the project loader (130/130), `npm run build` + `git diff --exit-code dist/` (clean), `sync-templates:check` (in sync), `docs-refs-check` (OK), and all four AC-18 gates (zero matches). Confirmed.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `pipeline-policy.ts:10` `TaskSize = 'XS' \| 'S' \| 'M' \| 'L' \| 'XL'`, XS first; type-check passes (Record<TaskSize,…> exhaustiveness). |
| AC-2 | Pass | `pipeline-policy.ts:68` `SIZE_ORDER = ['XS','S','M','L','XL']`, XS at index 0. |
| AC-3 | Pass | `BUDGET_BY_SIZE` gains `XS:'5.00'` (`:70`); S/M/L/XL unchanged. |
| AC-4 | Pass | `defaultMaxReviewLoops` XS joins the 3-branch (`:127`); test asserts `('XS')===3`. |
| AC-5 | Pass | codexMatrix `spec_review.XS`/`implement.XS` = S row (`:148`,`:155`); S rows retained. |
| AC-6 | Pass | claudeMatrix `buildHigh`/`buildMedium`/`codeReviewMatrix` each gain XS=medium (`:181`,`:191`,`:207`); no S/M/L/XL change. |
| AC-7 | Pass | `detectTier` flips to `!== 'XS'` (`:97`); tests cover XS→fast, S→full, mixed→full, delicate-XS→full. |
| AC-8 | Pass | `isPlanCombined` flips to `=== 'XS'` (`:106`); tests cover XS true / S false / delicate-XS false. |
| AC-9 | Pass | `maxSize` seed flips `'S'`→`'XS'` (`:78`); nominal/effective XS tests + delicate-XS→XL. Floor genuinely moved. |
| AC-10 | Pass | `getPipelinePolicy` XS row → fast/planCombined:true/loops:3/effective:XS; S row → full/planCombined:false. |
| AC-11 | Pass | Comments at ~60/93/102/142 name XS; line-93 full-tier list gains S; shared-band comments (~43/122 loop-cap, ~193 review-model) gain XS; historical "old caps (2 for S/M…)" at ~120 left **unchanged** (correct). |
| AC-12 | Pass | Codex/Claude/routing/budget/loop tables gain XS; `'S non-delicate'` routing case flipped to full; `only S`→`only XS` rename; band comment + loop-cap test name updated. 55/55 pass. |
| AC-12b | Pass | Exactly the three tier-dependent fixtures moved S→XS (reroute helper type + fixture; two safety fixtures); all six leave-alone S fixtures confirmed untouched. Moved tests still assert the fast-tier contract. |
| AC-13 | Pass | `canon-spec` SKILL: size list adds XS above S with inline→XS→S rule; grill split shifted to XS light / S+ grill. |
| AC-14 | Pass | `pipeline-orchestrator.md`: both tier headers, bundle line, sizing-fields table, sizing guide (XS row), Codex matrix (XS column; S now runs spec_review), env-var bands, gate timing, auto-block cap, both reroute lines, two spec-review lines. |
| AC-15 | Pass | `product-context.md`: Tier glossary row, Task-size row gains XS, Tiers/Sizes section to invariant. |
| AC-16a | Pass | `decisions.md` fast-tier entry rewritten around XS; membership gains S; "size it M"→"size it S". |
| AC-16b | Pass | New `decisions.md` entry for the inline→XS→S boundary. |
| AC-17 | Pass | `architecture.md:106` enum `XS \| S \| M \| L \| XL`. |
| AC-18 | Pass | Foreman + anchored lens independently re-ran Family A/B/D gates and `rg -nw 'XS'` on canon-inline-review — all zero. Family C verified positively per surface. Golden kept in-gate and clean. |
| AC-19 | Pass | Worklist surfaces updated across policy/tests/docs/skills/CLI help/README/prompt templates/inline terminology; subordinate to the AC-18 gate, which passes. |
| AC-20 | Pass | `dist/` rebuilt; `git diff --exit-code dist/` clean after fresh build; bundle shows `SIZE_ORDER=["XS",…]`, `XS:"5.00"`, `!== "XS"`, `=== "XS"`. |
| AC-21 | Pass | Golden regenerated: promptSpec/promptSpecRevision rule-of-thumb `(S…)`→`(XS…)`; `full / S` line correctly unchanged (explicit override, not policy). |
| AC-22 | Pass | `sync-templates:check` reports in sync; seven `templates/` mirrors present; product-context/decisions/architecture correctly not mirrored. |
| AC-23 | Pass | lint, type-check, `npm test` (896 pass / 1 skip / 0 fail) all pass. |

### Dropped Sections Check

- [x] Non-goals respected — no S/M/L/XL effort or model value changed (verified S rows byte-identical); no `--size` flag; status.json default still `M`; XS budget `5.00`; delicate still promotes to XL.
- [x] Known Risks addressed — maxSize floor (AC-9), second routing surface (AC-8), Family-B lookbehind / Family-C positive-gate asymmetry, sync-templates CANON_OWNED boundary, golden drift, leave-alone fixtures all handled.
- [x] Human Test Plan satisfiable — XS routes fast, S routes full at medium effort, size guidance present in the canon-spec skill and orchestrator doc.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality

### Summary

A clean, surgical policy change. `XS` threads through every `Record<TaskSize, …>` table (so omissions are compile errors), the two independent size-keyed surfaces (`detectTier`, `isPlanCombined`) are both flipped, and the `maxSize` accumulator seed is correctly moved to the new floor so an all-XS bundle reports XS rather than coincidentally-correct-but-lying `S`. The XS cells are genuinely byte-equal to the S cells; no existing S/M/L/XL value changed. The repo-wide guidance sweep holds under independent structural gates. Tests assert real values — the load-bearing `S non-delicate: fast→full / planCombined true→false` flip is re-asserted across `ROUTING_TABLE`, `detectTier`, and `isPlanCombined`, not deleted or weakened, and the fast-tier fixtures were correctly re-pointed at XS so they keep exercising the fast path.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Mixed-bundle size label sorts lexicographically, not by size** — `scripts/run-task/context.ts:172` (cold lens; `code-bug`-adjacent but **out of scope / pre-existing**). The implement-phase banner builds `mixed (${[...sizes].sort().join(',')})`; lexicographic sort puts `XS` last (`X` > `L/M/S`) even though it is the smallest. This file is **not** in the task diff, the sort was already not size-ordered before XS (`['S','M','L','XL'].sort()` → `['L','M','S','XL']`), and the label is **display-only** — routing uses `getEffectiveSize`/`getNominalSize` (`context.ts:173-174`), which order via `SIZE_ORDER` correctly. Introducing XS only makes this latent cosmetic disorder slightly more visible in the rare mixed-bundle banner. Confidence high, severity low. Optional follow-up: `[...sizes].sort((a,b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b))`. Does not block.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Empty-bundle / unsized-task path** (cold + anchored) — Dismissed: intended and tested. `maxSize` seeds at `'XS'` while the `?? 'M'` default for an unsized task is unchanged, so an unsized task still routes full-tier/M; an empty bundle now resolves to XS/fast, which `tests/pipeline-policy.test.ts` asserts explicitly. Both lenses confirmed this is a clean bill, not a bug.
- **"old caps (2 for S/M…)" comment narration** (cold + anchored, `pipeline-policy.ts:~120`) — Dismissed: AC-11 explicitly requires this historical note be left unchanged; it describes superseded state accurately.
- **XS `spec_review` doc shows "— (skipped)" while the matrix keeps an XS `spec_review` cell** (anchored) — Dismissed: intended per AC-5/AC-11 ("unused but kept for testability"); the operator-facing "skipped" statement is correct because XS fast tier skips Codex spec review.
- **No S-at-full-tier orchestration fixture added** (anchored) — Dismissed: spec AC-12b explicitly scopes the orchestration fixture changes to the three tier-dependent ones and leaves the boundary coverage to the `pipeline-policy.test.ts` unit suite.

### Out-of-band observation (not a diff finding)

- The working tree has an unrelated uncommitted edit to `docs/pipeline-invocations.md` (pipeline telemetry), not part of this task's diff. Flagged so the operator doesn't sweep it into the task commit; no action required for this review.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

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
