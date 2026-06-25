# Spec: spec-bugfix-diagnosis-rule — Re-home the diagnose/reproduce rule + red-first test into the spec-authoring surfaces

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon has a rule that a bug-fix spec must confirm the failure *mechanism* before committing to a fix — not encode the first plausible story that fit the symptom. That rule currently lives in exactly one place: the Codex `spec_review` checkpoint's prompt. Its own text assigns three role checkpoints — "the spec author states the *verified* mechanism in *Problem*; the reviewer (Codex) challenges whether the proposed fix addresses a confirmed root cause; the implementer reproduces before fixing" — but it is physically homed only in the reviewer's surface. The **spec author** never sees it: the `/canon-spec` skill and the `.canon/templates/spec.md` template (the two surfaces a spec author actually reads) say nothing about confirming a bug's mechanism.

Two consequences:

1. **Fast-tier (S, non-delicate) bug fixes skip `spec_review` entirely** (settled in `docs/decisions.md` §"Fast tier (S non-delicate) skips Codex spec review"). For that task class the rule reaches *nobody* — not the author (it's not on their surfaces) and not a reviewer (there is none).
2. Even on full-tier tasks, the author writes the *Problem* section before any review runs, so an author-side prompt catches a wrong premise one phase earlier and cheaper than the reviewer challenge does.

This was not hypothetical. A downstream adopter task (`fix-article-date-shallow-clone`) was a fast-tier S bug fix whose *Problem* section asserted an unverified claim about git's behavior on a shallow clone. It passed spec, code review, and QA clean, then a Codex PR-level review returned a P1: the whole premise was wrong, so the fix did not fix the bug. The fix shipped a regression test, but the test only exercised the new code path — it never reproduced the actual failure, so it could not have gone red on the unfixed code for the real reason. A red-first test would have failed *after* the fix too, exposing the wrong premise before QA.

The rule also lost its author-facing home historically: it used to be carried in canon-managed adopter agent files, and the v2.0.0 program that vacated canon content from those files (plus the rule-relocation work) re-homed it into the reviewer prompt only.

## Decision

Give the author-side checkpoint a home on the two surfaces a spec author reads — the `/canon-spec` skill and the `.canon/templates/spec.md` template — so that, **for a bug or flake fix**, the author is directed to:

1. **State in *Problem* how the failure mechanism was confirmed** (reproduction, trace, or forced repro), not merely assert a plausible cause.
2. **Include a regression-test AC that fails on the pre-fix code *for the stated reason* and passes after the fix** — red-first TDD applied to bug fixes. The diagnostic value is the red step: a test that cannot be made to fail on the unfixed code means the mechanism was not actually confirmed.
3. **Use the within-reason escape when a faithful repro is impractical** — when the mechanism is environment-bound (shallow clone, deploy-only behavior, a race), the spec must *say so* and supply a deterministic alternative (an integration fixture or a documented manual repro), rather than skipping verification silently.

The guidance is **scoped to bug/flake fixes**; feature and refactor spec authoring is unchanged. The existing reviewer-side rule in the `spec_review` checkpoint is **kept as-is** — this task adds the author-side checkpoint the reviewer rule already names; it does not move or remove the reviewer rule. The change is purely additive guidance on existing surfaces (no new template section, no behavior change to the pipeline).

## Non-Goals

- **No change to the `spec_review` checkpoint prompt.** The reviewer-side rule stays exactly as written; this task does not edit, move, or remove it.
- **No change to the `implement` phase surface.** The red-first regression-test AC *is* the implementer's reproduce-before-fixing checkpoint, expressed as a durable artifact — so the implement surface needs no separate instruction.
- **Not added to `docs/patterns.md`.** This is a canon-universal authoring rule, which per the patterns.md layering rule belongs in the skill/template (the just-in-time authoring surfaces), not in project-specific patterns.
- **No tier, matrix, or `code_review` changes.** Making fast-tier S tasks *get* spec review, and adding a cold-Codex review lens, are separate backlog tasks (Tasks 2 and 3 of the same program).
- **No new section in the spec template.** Additions land inside the existing *Problem*, *Acceptance Criteria*, and *Spec Quality Checklist* sections (guidance refinement, not a new managed surface).

## Acceptance Criteria

- [ ] AC-1: For a bug or flake fix, both the `/canon-spec` skill (`.claude/skills/canon-spec/SKILL.md`) and the spec template (`.canon/templates/spec.md`) direct the author to state in the *Problem* section **how the failure mechanism was confirmed** (reproduction / trace / forced repro), not merely to assert a cause. Verify: `git grep` in both files surfaces the mechanism-confirmation instruction, gated to bug/flake fixes.
- [ ] AC-2: Both surfaces direct the author to include a **regression-test AC that fails on the pre-fix code for the stated reason and passes after** (red-first). Verify: `git grep` in both files surfaces the red-first regression-test instruction.
- [ ] AC-3: Both surfaces carry the **within-reason escape**: when the mechanism is environment-bound and a faithful repro is impractical, the spec must say so and supply a deterministic alternative (integration fixture or documented manual repro) rather than skipping verification silently. Verify: the escape clause is present in both files.
- [ ] AC-4: The new guidance is **scoped to bug/flake fixes** — the general (feature/refactor) authoring flow gains no unconditional new requirement. Verify: every added passage is conditional (e.g. prefixed "For a bug or flake fix" / "(bug fixes only)"); no new unconditional item appears in the skill's general "Spec-writing rules of thumb" list or the template's general Spec Quality Checklist beyond the bug-fix-gated ones.
- [ ] AC-5: No added text references a canon orchestration internal path. The additions name the **`spec_review` checkpoint by concept/phase**, not by file path. Verify: `git grep -n "scripts/run-task" .claude/skills/canon-spec/SKILL.md .canon/templates/spec.md` returns nothing.
- [ ] AC-6: The `templates/` mirrors of both edited files are regenerated and in sync. Verify: `npm run sync-templates:check` exits zero.

## Design

### Affected Files

| File | Change |
|---|---|
| `.claude/skills/canon-spec/SKILL.md` | Phase 5: add a bug-fix entry to "Spec-writing rules of thumb" (state the confirmed mechanism in *Problem* + a red-first regression-test AC + the within-reason escape), and a conditional bug-fix item to the self-check list. Name the `spec_review` checkpoint by concept, never by internal path. |
| `.canon/templates/spec.md` | Add bug-fix-gated guidance to the *Problem* section (state how the mechanism was confirmed), to *Acceptance Criteria* (include a red-first regression-test AC), and a conditional bug-fix item to the *Spec Quality Checklist*. No new section. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Generated mirror — regenerated from the root skill by `npm run sync-templates`. |
| `templates/.canon/templates/spec.md` | Generated mirror — regenerated from the root template by `npm run sync-templates`. |

### Interaction Dependencies

- The reviewer-side rule in the `spec_review` checkpoint already names the author/reviewer/implementer checkpoints. The author-side wording added here must mirror that framing so the two homes do not drift; keep both pointing at the same concept (named, not path-linked, per `docs/decisions.md` §"Canon-shipped guidance never names orchestration internals").
- This task helps regardless of tier and is independent of the tier change (Task 2): on full-tier it front-loads what `spec_review` would catch; on fast-tier it is the only place the rule can land until S tasks gain spec review.

### Data Model Changes

None. No `status.json` schema, no code, no types.

## Validation Required

| Change Type | Required Check Categories |
|---|---|
| Docs/guidance edit to canon-managed root/template pairs | Linting, type checking, unit tests, canon-managed template sync, docs references |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite runs clean (no test asserts skill/template prose; this confirms nothing regressed)
- [x] `npm run sync-templates:check` — the load-bearing check: root↔`templates/` mirrors aligned
- [x] `npm run docs-refs-check` — required for `templates/`/skills/`.canon/` markdown edits; also confirms the additions introduce no broken refs
- [ ] `npm run build` — **not required**: this change touches no `src/**`, `scripts/run-task.ts`, `scripts/run-task/**`, or `scripts/pipeline-policy.ts`, so it produces no `dist/` delta.

## Docs Impact

None of the five protected docs (`architecture`, `codebase-map`, `decisions`, `patterns`, `product-context`) go stale. The change is consistent with the existing `docs/decisions.md` §"JIT rule delivery" decision (it adds a just-in-time home for a rule in its consuming surface) and does not alter any settled decision, so no decisions entry is needed.

## Known Risks

- **Wording drift between the two homes.** The rule now lives on the author surfaces *and* the reviewer prompt; the copies can diverge over time. Mitigation: mirror the reviewer-side three-checkpoint framing in intent; keep the author text concept-linked to the same `spec_review` checkpoint (AC-1/AC-2 pin the shared content).
- **Over-application to non-bug-fix specs.** If the guidance is not clearly gated, authors bolt a pointless "mechanism confirmed" line or a contrived test onto feature/refactor specs — friction with no value. Mitigation: AC-4 requires every passage to be bug-fix-conditional.
- **Leak-gate violation.** Referencing the internal `spec_review` prompt path in a shipped surface would fail `sync-templates:check`'s internal-path gate. Mitigation: AC-5 + name the checkpoint by concept.
- **Mirror drift.** Forgetting to regenerate the two `templates/` mirrors fails `sync-templates:check` and the `--pr` base-drift gate. Mitigation: AC-6 + both mirrors declared in Affected Files (and required again in the handoff Changes table).
- **The "within reason" escape becomes a routine skip.** Authors could lean on it to avoid writing any test. Mitigation: the escape requires *stating why* a direct repro is impractical *and* supplying a deterministic alternative — not a silent omission (AC-3).

## Human Test Plan

1. Begin writing a spec for a bug fix using canon. Confirm you are guided to explain *how* you confirmed the underlying cause (for example, by reproducing it), not just to assert it.
2. Confirm you are guided to include a test that would fail on the current, unfixed behavior and pass once the fix lands.
3. For a bug that only appears in a specific environment and is hard to reproduce directly, confirm the guidance lets you record *why* a direct test isn't practical and what reliable alternative you used instead — rather than skipping verification with no explanation.
4. Begin a spec for a new feature (not a bug fix) and confirm the new bug-fix guidance adds no extra steps or noise to it.
5. Expected: bug-fix specs now carry a confirmed cause and a failing-first test (or an explicit, justified alternative); feature and refactor specs are unchanged.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names — N/A at spec stage (full tier; plan written separately), but Affected Files and ACs name the actual surfaces and sections
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
