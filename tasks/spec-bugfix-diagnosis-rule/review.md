# Code Review: spec-bugfix-diagnosis-rule

> Reviewer: Claude | Spec: `tasks/spec-bugfix-diagnosis-rule/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (`npm run build` correctly marked `not_configured` with an explicit spec citation for the docs-only change)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: mechanism-confirmation instruction in both surfaces | Pass | `.canon/templates/spec.md` Problem blockquote and `.claude/skills/canon-spec/SKILL.md` rules-of-thumb bullet both direct the author to state how the failure mechanism was confirmed (repro / trace / forced repro), explicitly gated to bug/flake fixes. Templates mirrors are byte-identical to root files. |
| AC-2: red-first regression-test AC instruction in both surfaces | Pass | Both surfaces require a regression-test AC that fails pre-fix for the stated reason and passes after. Present in spec.md AC-section blockquote and SKILL.md rule-of-thumb bullet. |
| AC-3: within-reason escape in both surfaces | Pass | Both surfaces carry the escape for environment-bound / impractical repro cases with a requirement to name a deterministic alternative. (See Stage 2 Finding 1 — the AC-section callout uses a weaker predicate than the other two locations.) |
| AC-4: guidance stays bug/flake-fix conditional | Pass | Every added passage is explicitly gated: "(Bug/flake fixes only)" on checklist items; "Bug and flake-fix specs…" subject heading on rule-of-thumb; "For a bug or flake fix:" prefix on blockquotes. No unconditional new requirement added to the general self-check or rules-of-thumb sections. |
| AC-5: no internal path references in added text | Pass | `spec_review` appears as a concept/phase name only; `git grep "scripts/run-task"` in both root files returns nothing. |
| AC-6: templates mirrors regenerated and in sync | Pass | Handoff records `npm run sync-templates:check` exited zero; diff confirms root files and `templates/` mirrors are byte-identical. |

### Dropped Sections Check

- [x] Non-goals respected — spec_review prompt unchanged, `docs/patterns.md` untouched, no tier/matrix/code_review changes, no new template section
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

All four changed files (two root files + two `templates/` mirrors) are correct and symmetric. ACs are met. The implementation is a clean, additive docs edit with no code or schema impact. Two P3 spec-gaps survive adjudication: an escape-predicate inconsistency between the two added blockquotes in `spec.md`, and a framing issue that could mislead fast-tier authors — exactly the audience this task is designed to reach.

### Findings

#### Correctness Bugs

None.

#### Risk / Guardrails

None.

#### Optional Cleanup / Nit

- **P4** [spec-gap] "within-reason escape" is used as shorthand in both checklist items but is never defined in the added (or existing) inline text — the inline guidance uses "impractical" / "environment-bound," not the phrase "within-reason escape." A spec author skimming only the checklist encounters undefined terminology. Low friction in practice since the defining blockquote appears immediately above the checklist. *(cold lens, medium confidence — flagged by both lenses in related forms)*

- **P4** [spec-gap] Phrasing divergence: the Problem-section blockquote in `spec.md` says "merely naming a plausible cause" while the SKILL.md rule-of-thumb says "merely asserting a cause." "Asserting a cause" is a weaker prohibition — you can assert a real, confirmed cause — so the SKILL wording is slightly looser than the spec.md wording. Minor, but the two homes now carry different anti-patterns. *(flagged by both lenses, low-medium confidence)*

- **P4** [spec-gap] The new checklist item in `spec.md` and `SKILL.md` is conditional ("Bug/flake fixes only") but uses the same `- [ ]` marker as all other items, with no adjacent guidance clarifying that conditional items can be intentionally left unchecked on non-bug specs. No existing checklist items in the template are conditional, so there is no prior art for authors to pattern-match against. *(cold lens, medium confidence)*

#### Spec Gaps

**Finding 1 — P3 [spec-gap] AC-section escape predicate is weaker than the rest of the guidance** *(flagged by both lenses; cold at high confidence, anchored implicitly via "within-reason" note)*

The Problem-section blockquote in `spec.md` and the SKILL.md rule-of-thumb both state the two-part escape condition: "environment-bound **and** a faithful repro is impractical." The AC-section blockquote in `spec.md` states only: "If a direct test is impractical…" — omitting "environment-bound."

`.canon/templates/spec.md`:24 / `templates/.canon/templates/spec.md`:24

This inconsistency widens the AC-section escape beyond the intended condition. An author could invoke it for any test that is merely difficult (slow, flaky fixture, complex setup) rather than specifically environment-bound (shallow clone, deploy-only, race), which would make the escape routine rather than exceptional. The spec (AC-3) defines the escape as "when the mechanism is environment-bound and a faithful repro is impractical" — the AC-section blockquote must mirror that two-part predicate.

**Fix:** Add "environment-bound and" to the AC-section blockquote: "If the mechanism is environment-bound and a direct test is impractical, the AC must say so…"

---

**Finding 2 — P3 [spec-gap] "blocking concern at spec_review" misleads fast-tier authors** *(anchored lens, medium confidence)*

The Problem-section blockquote ends: "An unverified mechanism is a blocking concern at the `spec_review` checkpoint."

This framing is accurate for full-tier tasks. But fast-tier bug fixes — the primary target audience named in the spec's Problem section — skip `spec_review` entirely. An author on a fast-tier S task reads the guidance, confirms they understood the rule, then reads "a blocking concern at spec_review" and could reasonably interpret this as "Codex will enforce it at review" — when in fact there is no Codex spec_review for their task class. The sentence that was meant to underscore urgency becomes a subtle permission slip for the exact tier that has no safety net.

`.canon/templates/spec.md`:10 / `templates/.canon/templates/spec.md`:10

**Fix:** Remove or rephrase to make the self-authoring obligation explicit rather than pointing at a downstream reviewer. For example: "An unverified mechanism must be resolved before the spec can be marked done — on fast-tier tasks, no reviewer will catch it." Alternatively, drop the sentence (the blockquote already says "name the confirmed mechanism, not a plausible cause" — the framing is in the imperative, which is self-enforcing).

### Dismissed Cold Findings

- **Dismissed (cold):** "`canon-spec-review/SKILL.md` Agent C checklist not updated" — explicitly out of scope per spec Non-Goals: "No change to the `spec_review` checkpoint prompt. The reviewer-side rule stays exactly as written; this task adds the author-side checkpoint the reviewer rule already names; it does not move or remove the reviewer rule." The existing reviewer-side rule in the `spec_review` checkpoint already contains the enforcement; this task's scope is the author-side home only.

- **Dismissed (cold):** "Flake-specific guidance gap — 'environment-bound' doesn't cover probabilistic failures" — "forced repro" is already named as a valid confirmation method alongside "deterministic reproduction" and "trace," which is the canonical approach for a flake (inject a delay or artificial condition to make the probabilistic failure deterministic). The escape with a named deterministic alternative handles the case where forced repro is also impractical. The guidance is sufficient; the cold lens concern is addressed by existing text.

- **Dismissed (cold):** "Phrasing 'blocking concern at spec_review' could be misread as 'Codex will catch it'" — partially absorbed into Finding 2 above, where the concern is the fast-tier framing; the "permission slip" reading is the P3 finding, not a separate dismissable concern.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [x] **Spec gap** — root cause is the spec, not the code; halt for human instead of routing to implement

**Root-cause summary:** Finding 1 (AC-section escape predicate inconsistency) and Finding 2 (fast-tier framing) are both spec-gaps in the produced guidance text, not implementation errors against the task spec. The implementation faithfully executed the spec's ACs as written; the gaps are in the guidance wording itself, which the spec's ACs did not fully constrain. The right path is a human call on whether to tighten the two sentences in the diff and re-run, or accept the current wording and close.

---

## Round 2 — verifying iteration 1's response to round 1

### Stage 1 — Acceptance Criteria Re-Check

Both Round 1 P3 spec-gap findings were addressed via spec amendment (Amendment section + AC-7) and re-implementation.

| AC | Status | Notes |
|---|---|---|
| AC-1: mechanism-confirmation instruction in both surfaces | Met | `.canon/templates/spec.md` Problem blockquote and `.claude/skills/canon-spec/SKILL.md` rule-of-thumb bullet both direct the author to state how the mechanism was confirmed, gated to bug/flake fixes. |
| AC-2: red-first regression-test AC in both surfaces | Met | Both surfaces require a regression-test AC that fails pre-fix for the stated reason and passes after. |
| AC-3: within-reason escape with identical two-part predicate in all locations | Met | All escape-predicate occurrences carry both parts — "environment-bound AND a faithful repro is impractical": Problem blockquote (spec.md:10), AC blockquote (spec.md:24), checklist item (spec.md:100 — "(environment-bound mechanism, faithful repro impractical)"), SKILL rule (SKILL.md:152). Note: the diff as delivered showed "direct test" in the AC blockquote; the actual committed file reads "faithful repro" — consistent across all locations. Round 1 Finding 1 is fully resolved. |
| AC-4: guidance stays bug/flake-fix conditional | Met (unchanged from round 1) | Every added passage remains conditional; no unconditional item added to the general sections. |
| AC-5: no internal path references | Met (unchanged from round 1) | No orchestration-internal path references in either added passage (AC-5 grep clean). |
| AC-6: templates mirrors in sync | Met (unchanged from round 1) | Root and mirror files are byte-identical for both pairs. |
| AC-7: spec_review framing is self-enforcing and fast-tier aware | Met | spec.md:10: "Satisfying this is your obligation before marking the spec done; on fast-tier (S, non-delicate) tasks the `spec_review` checkpoint is skipped and no reviewer will catch an unverified mechanism." SKILL.md:152 mirrors the same self-enforcing framing. No wording implies reviewer enforcement as the backstop. Round 1 Finding 2 is fully resolved. |

### Verifying Round 1 findings

- _spec-gap:_ "AC-section escape predicate missing 'environment-bound and'" → resolved: spec.md:24 now reads "environment-bound and a faithful repro is impractical" ✓
- _spec-gap:_ "'blocking concern at spec_review' misleads fast-tier authors" → resolved: replaced with author-obligation framing + explicit fast-tier no-reviewer warning in both surfaces ✓

### New findings (Round 2)

None above P4 (nit). No new code-bugs or spec-gaps introduced by this iteration.

**P4 nits (optional — carry-forward from Round 1):**

- **P4** [nit] "within-reason escape" appears in the new checklist item as a label but is never defined by name in the added text — the blockquotes define the concept using the predicate ("environment-bound and a faithful repro is impractical") without assigning it a name. The Amendment's P4 guidance said to name the two-part condition inline, which was done in parentheses: "(environment-bound mechanism, faithful repro impractical)." The term itself remains undefined, which is minor given the inline definition. *(flagged by both lenses)*

- **P4** [nit] Phrasing divergence: spec.md:10 says "merely naming a plausible cause"; SKILL.md:152 says "rather than naming a plausible cause." "Merely" vs. "rather than" is cosmetically different; the Amendment asked for identical wording in both homes. *(anchored lens)*

- **P4** [nit] The conditional `- [ ]` checklist item has no note telling feature/refactor spec authors to skip it. An author of a non-bug-fix spec sees an unchecked item with no guidance on whether it is intentionally inapplicable. *(flagged by both lenses)*

**Dismissed Cold Findings (Round 2):**

- **Dismissed (cold):** "'AC must say so' (AC blockquote) vs. '*Problem* must say so' (SKILL rule)" — these are contextually complementary, not contradictory. The AC-section blockquote is inside the AC section of the spec template, directing authors on what the AC should contain; the SKILL rule is a spec-writing rule-of-thumb directing authors to document the escape in Problem. Both instructions together point at appropriate, complementary locations. The spec's AC-3 says "the spec must say so" without specifying which section. The anchored lens (with full spec) did not flag this as a violation.

- **Dismissed (cold):** "'Direct test' vs 'faithful repro' wording discrepancy" — the cold lens self-corrected after reading the actual file: both blockquotes in the committed spec.md use "faithful repro" consistently. The diff delivered to the foreman contained a stale "direct test" rendering; the committed state is internally consistent.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

---

## Round 3 — verifying iteration 2's response to round 2

### Stage 1 — Acceptance Criteria Re-Check

ACs 1–7 are unchanged from iteration 1; the anchored lens verified they remain intact. ACs 8–11 are new (Amendment Round 2) and cover the runtime prompt surfaces.

| AC | Status | Notes |
|---|---|---|
| AC-1: mechanism-confirmation instruction in both surfaces | Met (unchanged from Round 2) | `.canon/templates/spec.md` Problem blockquote and `.claude/skills/canon-spec/SKILL.md` rule-of-thumb both say "name the confirmed mechanism, not merely a plausible cause," gated to bug/flake fixes. |
| AC-2: red-first regression-test AC in both surfaces | Met (unchanged from Round 2) | Both surfaces require a regression-test AC that fails pre-fix for the stated reason and passes after. |
| AC-3: within-reason escape with identical two-part predicate | Met (unchanged from Round 2) | All escape-predicate occurrences carry "environment-bound AND a faithful repro is impractical." |
| AC-4: guidance stays bug/flake-fix conditional | Met (unchanged from Round 2) | Every added passage remains conditional; no unconditional item added to general sections. |
| AC-5: no internal path references | Met (unchanged from Round 2) | `spec_review` referenced by concept only; `git grep "scripts/run-task"` clean in both root files. |
| AC-6: templates mirrors in sync | Met (unchanged from Round 2) | Root and mirror files byte-identical for both pairs. |
| AC-7: spec_review framing is self-enforcing and fast-tier aware | Met (unchanged from Round 2) | Self-enforcing framing with explicit fast-tier no-reviewer callout on all author-facing surfaces. |
| AC-8: rules-of-thumb bullet in both runtime prompts with identical two-part predicate | Met | `git grep -n "confirmed mechanism and red-first"` returns `scripts/run-task/prompts/templates/spec.md:16` and `scripts/run-task/prompts/templates/spec-revision.md:17`. Both state "environment-bound and a faithful repro is impractical" — neither omits the environment-bound conjunct. |
| AC-9: runtime self-check in index.ts + golden reflects it | Met | `scripts/run-task/prompts/index.ts:99` contains the conditional self-check item verbatim. `tests/run-task-prompts.golden.json` `promptSpec` field renders it identically. `promptSpecRevision` also renders it (strictly more coverage than AC-9 requires). |
| AC-10: wording consistent across all four rules-of-thumb + all three self-check homes | Met | Round 2 P4 nit (b) resolved: SKILL.md rule-of-thumb now reads "not merely a plausible cause" matching all other surfaces. Same two-part escape predicate everywhere. No "within-reason escape" undefined shorthand in any checklist item. |
| AC-11: dist matches fresh build + golden regenerated | Met | `dist/scripts/run-task.js` contains the new rule-of-thumb text and self-check item. Handoff records `npm run build` Pass and `npm test` Pass (with `UPDATE_GOLDENS=1`). No uncommitted dist delta. |

### Verifying Round 2 findings

- _spec-gap:_ "AC-section escape predicate missing 'environment-bound and'" → resolved in prior iteration; confirmed at AC-3 above ✓
- _spec-gap:_ "'blocking concern at spec_review' misleads fast-tier authors" → resolved in prior iteration; confirmed at AC-7 above ✓

### New findings (Round 3 — only NEW issues from Amendment Round 2 changes)

None above P4 (nit). No new code-bugs or spec-gaps introduced by iteration 2.

**P4 nits (carry-forward and new):**

- **P4** [nit] SKILL.md uses a colon delimiter ("**…red-first test**: For a bug…") while the runtime prompt surfaces use an em-dash ("**…red-first test** — For a bug…"). Pre-existing cross-file style distinction consistent with each surface's existing conventions; body text is word-for-word identical. *(flagged by both lenses)*

- **P4** [nit] The conditional `- [ ]` checklist item in all three self-check homes has no skip instruction for non-bug-fix authors. The "(Bug/flake fixes; N/A for features/refactors)" prefix is the only signal. *(carry-forward from Round 2, flagged by both lenses)*

- **P4** [nit] `.canon/templates/spec.md` Problem blockquote says "name the deterministic alternative **used** instead" (past tense, implying prior execution) while the rule-of-thumb and AC blockquote say "name **a** deterministic alternative" (prospective). Minor tense inconsistency in the escape clause. *(cold lens, medium confidence)*

### Dismissed Cold Findings (Round 3)

- **Dismissed (cold):** "Problem callout and AC callout each say 'say so' in their section, but the selfCheck only enforces the AC predicate — author could pass by only declaring the escape in the AC." The three callouts are complementary by design: the Problem blockquote guides the Problem section, the AC blockquote guides the AC section, and the selfCheck enforces the AC obligation. An author following all three produces a complete spec. The selfCheck's scope (AC-only) matches the narrower verifiable claim; the Problem blockquote creates a matching but separately readable obligation. Not a structural inconsistency.

- **Dismissed (cold):** "Author-facing surfaces say 'name the confirmed mechanism' but don't say 'state HOW you confirmed it.'" The "name the confirmed mechanism, not merely a plausible cause" phrasing was the exact wording from Round 1's implementation, accepted as satisfying AC-1 in both prior rounds by the anchored lens. The "confirmed vs. plausible" contrast conveys the verification expectation. Not a new defect introduced by Amendment Round 2. Carry-forward P4 at most; the anchored lens (with full spec context) re-verified AC-1 as Met unchanged from Round 2.

- **Dismissed (cold):** "Pre-existing SKILL.md self-check lacks the 'plan steps reference actual function/file names' item found in .canon/templates/spec.md checklist." Pre-existing gap out of scope for this diff — neither the original implementation nor Amendment Round 2 introduced this divergence.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

All 11 ACs met. Amendment Round 2 implementation (runtime prompts, index.ts, golden, dist) correctly satisfies ACs 8–11. Carry-forward P4 nits plus two new minor observations; none are blockers.

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
