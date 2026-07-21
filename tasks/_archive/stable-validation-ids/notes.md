# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Stable IDs cannot key empty-ID informational validation rows without an
explicit secondary identity contract: direct empty-string keys clobber sibling rows,
while per-row synthetic keys prevent later re-run rows from overriding earlier results.
When a cumulative latest-outcome map permits anonymous rows, specify both same-table
multiplicity and cross-iteration override semantics before retiring the old prose key.

[spec] Resolved the blocker with a bounded within-handoff identity for informational
rows (Decision item 4): required rows key by VAL-<n>, informational rows key by their
normalized Check label (case-fold + whitespace-collapse + trim — NO backtick/last-word/
dash heuristic), in a separate key space. This preserves every current informational
behavior (non-required Fail + human_pending) and CANNOT reproduce the false-missing
class, because label identity is matched only baseline↔own-re-run rows, never across the
spec↔handoff boundary where the old canonicalizer's false-missing defects arose. The
reviewer's two failure modes are pinned red-first: AC-19 (two distinct-label informational
rows — neither state lost) and AC-20 (same-label re-run overrides a repaired informational
Fail/human_pending). Rejected alternatives: forcing VAL-ids on informational rows (kills
typo/unknown-ID detection unless a second grammar is added; more author burden), and
forbidding informational Fail/human_pending (drops the anti-laundering guardrail; breaks
AC-12).

[spec_review] A regression test that protects a new design from a naive implementation
is not automatically red-first. The implement prompt parks with `[wrong-premise]` when
a red-first AC already passes on the baseline, so spec review must execute each claimed
red fixture against current code rather than infer discrimination from the AC's intent.

[spec] Round-2 resolution (iter 2→3). Round-shape label: EDGE-FINE-TUNE, not
scope-expansion — both round-2 findings harden the label-identity design introduced in
round 1 (a test-premise correctness fix + one missing format defect), not a new
sub-problem per round. So revise, don't redesign. Verified both blocking claims against
`validation.ts` before editing. Fixes:
(1) AC-19 re-cut to genuinely red-first — two informational labels distinct under the new
full-label normalizer but colliding under the OLD canonicalizer's last-word rule
(`Manual QA: cross-browser check` + `Accessibility check` both → `check`), so one state is
lost pre-fix. AC-20 de-designated to design-invariant (green pre-fix; same-label re-run
override already works via same canonical key) with an explicit "do not run as red-first"
note so the implementer won't park it `[wrong-premise]`.
(2) New AC-21 (red-first): a blank/whitespace-only-label informational row was silently
dropped by `computeLatestValidationResults`'s `if (!check) continue` (lines 48-49, 62-64),
hiding a `Fail`/`human_pending`. Now a fail-closed format defect on both the implement-end
and pre-flight surfaces. Reconciled AC-2's "distinct label" → "non-empty stable label"
(the old wording contradicted the deliberate same-label last-wins/override rule the gate
accepts). Decision items 4+5 and the validation.ts Affected-Files row updated to match.

[spec_review] `Fail – unrelated` anti-laundering currently applies only to required
validation checks. `classifyPreflightBlockersFromData` deliberately leaves a
non-required/informational `Fail – unrelated` row on the accept path even when its Notes
cite a task-changed file; specs promising unchanged Result semantics must not describe
that row as retaining an existing informational anti-laundering path.

[spec] Round-3 resolution (iter 3→4). Round-shape label: EDGE-FINE-TUNE, not
scope-expansion — both round-3 findings are spec-accuracy corrections to the
informational-identity contract from rounds 1-2 (a false claim + a self-defeating
message string), NOT a new sub-problem. Problem shape is unchanged across all three
rounds ("match validation by stable VAL-n; handle informational rows without
reviving prose fragility"), and findings narrow each round. So revise, not redesign.
Verified both blocking claims against validation.ts before editing.
Fixes:
(1) Removed the false "informational rows retain an anti-laundering path" claim
(Decision items 4+8). Confirmed against code: the Fail–unrelated reference-requirement
+ changed-file anti-laundering path lives in classifyValidationChecks, which
classifyPreflightBlockersFromData runs ONLY over data.requiredChecks
(validation.ts:666 → 622-648); the non-required scan (667-675) flags plain Fail but
explicitly exempts Fail–unrelated (line 670), and run-task-validation.test.ts:3155-3162
pins that a non-required Fail–unrelated row is left on the accept path. Informational
rows get ONLY the plain-Fail regression (exempting Fail–unrelated) + human_pending
counting. Item 8 rewritten to state the required-vs-informational split explicitly
(anti-laundering is and always was required-only, keyed by VAL-n).
(2) Added the reviewer-requested positive test to AC-8: an informational Fail–unrelated
row is accepted unchanged even when its Notes cite a task-changed file — converts the
existing accept-path test to the ID grammar; fails if an implementation extends
anti-laundering to informational rows. This is the semantics-preserving guard.
(3) Fixed the impossible "or assign it a VAL-<n> ID" recovery in Decision item 5 + AC-21.
A fresh invented ID → unknown-ID defect; a reused required ID → duplicate-row defect —
either reproduces the exact serial-respawn this task kills. New recovery: give the row a
non-empty Check label; if it was meant to answer a required check, use that check's
EXISTING VAL-n and delete the mistaken row — never invent a new ID.

[spec_review] `checkImplementEvidence` currently has independent early returns for an
empty Changes table, malformed Changes paths, validation defects, an all-gitignored
Changes set, and paths that are neither present nor tracked deletions. A spec promising
"all deterministic defects" in one note needs combination coverage across those
applicable classes (or a narrower promise), not only the malformed-path + validation
incident fixture.

[spec_review] The two Validation Required readers do not currently select the same
rows: `extractValidationChecks` includes unchecked `[ ]` placeholders in the implement
state header, while `parseValidationRequiredChecks` includes only checked `[x]` rows.
A shared ID grammar cannot by itself guarantee equal required-ID sets while that
checkbox-selection difference remains binding.

[spec_review] `checkImplementEvidence`'s early-return predicates are not all mutually
compatible: empty Changes excludes malformed Changes, and all-gitignored excludes the
nonexistent-verifiable-path branch. Consolidation coverage needs a matrix of compatible,
prerequisite-aware fixtures; one fixture cannot trigger every current condition without
inventing false downstream defects.

[spec_review] `buildImplementStateHeader` currently flattens validation checks from all
bundle members into one unqualified `Set<string>` and one `Required validation:` line.
Once IDs are intentionally reusable per task, two bundle members can both expose
`VAL-1` with different prose and the header no longer identifies which handoff owns
which ID; bundle-oriented ID rendering must retain task ownership.

[abandoned 2026-07-21] Task superseded before implementation. After 6 spec_review
rounds (one auto-block at round 3, resumed via `canon task reset-spec-review` +
`MAX_REVIEW_LOOPS`), the operator called the question: the stable-VAL-ID feature was
over-scoped for the actual problem. Verified against decisions.md "Validation runs
inside agent phases" — Claude Stage 1 review is already the designated validation
verifier, and the deterministic spec↔handoff prose matching this task tried to make
robust (via stable IDs) was a low-value layer that couldn't catch the real failure
modes anyway. Pivoted to a much smaller INLINE change (approach "B"): DELETE the prose
matching entirely (`canonicalizeValidationCheck` gone), keep only the structural,
literal-Result-value checks in the pre-flight gate (no unexplained Fail, no unfilled
placeholder, blocked-triage, anti-laundering), and let Stage 1 review own per-required-
check coverage. No stable IDs, no template format change, no hard cutover. Shipped
inline (not through the pipeline) per the S-sized-canon-self-repair norm, with
`codex review` before commit. This spec is preserved for the reasoning trail; it was
NOT implemented as written. See docs/lessons-learned.md (2026-07-21) for the process
lesson, and the inline commit for the actual change.
