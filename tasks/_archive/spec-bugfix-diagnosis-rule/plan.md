# Plan: spec-bugfix-diagnosis-rule — Re-home the diagnose/reproduce rule + red-first test into the spec-authoring surfaces

> Written by: Claude | Spec: `tasks/spec-bugfix-diagnosis-rule/spec.md`

## Overview

Two text-only edits to existing canon-managed files, then a template sync and validation run. No code changes, no new files, no schema changes.

Files changed:
- `.claude/skills/canon-spec/SKILL.md` (root)
- `.canon/templates/spec.md` (root)
- `templates/.claude/skills/canon-spec/SKILL.md` (generated mirror — do NOT edit directly)
- `templates/.canon/templates/spec.md` (generated mirror — do NOT edit directly)

---

## Step 1 — Edit `.claude/skills/canon-spec/SKILL.md`: add bug-fix entry to "Spec-writing rules of thumb"

In Phase 5, find the **"Spec-writing rules of thumb"** block. It currently ends with:

```
- **Refactor specs need hard structural caps**: size cap, explicit deletion expectations per symbol, grep AC for disappeared symbols.
```

Append the following bullet **immediately after** that final line (before the blank line and `⛔ STOP` that follows):

```markdown
- **Bug and flake-fix specs — confirmed-mechanism checkpoints**: Three roles each own a checkpoint — the spec author states the *verified* mechanism in *Problem*; the `spec_review` phase challenges whether the fix addresses a confirmed root cause; the implementer reproduces before fixing. For the author's checkpoint: (1) *Problem* must state **how** the failure mechanism was confirmed (deterministic reproduction, trace, or forced repro) — not merely assert a plausible cause. (2) *Acceptance Criteria* must include a **red-first regression-test AC**: a test that fails on the pre-fix code for the stated reason and passes after the fix; the red step proves the mechanism was confirmed, not just assumed. (3) **Within-reason escape**: when the mechanism is environment-bound (shallow clone, deploy-only behavior, a race) and a faithful repro is impractical, *Problem* must say so and name a deterministic alternative (integration fixture or documented manual repro) — not a silent omission.
```

## Step 2 — Edit `.claude/skills/canon-spec/SKILL.md`: add bug-fix item to the Phase 5 self-check list

In Phase 5, find the **self-check list** block that precedes the `⛔ STOP — present the spec...` line. It currently ends with:

```
- [ ] Symbols named in ACs actually exist in the codebase — grep-verify before presenting
```

Append the following item **immediately after** that final line:

```markdown
- [ ] (Bug/flake fixes) *Problem* states how the failure mechanism was confirmed — not just a plausible cause; *Acceptance Criteria* includes a red-first regression-test AC or an explicit within-reason escape with a deterministic alternative
```

## Step 3 — Edit `.canon/templates/spec.md`: add bug-fix guidance to the Problem section

Find the `## Problem` section. It currently reads:

```
## Problem

What is broken, missing, or suboptimal? Be specific. Link to user feedback, bugs, or roadmap items if available.
```

Replace it with:

```markdown
## Problem

What is broken, missing, or suboptimal? Be specific. Link to user feedback, bugs, or roadmap items if available.

> **For a bug or flake fix:** State *how* the failure mechanism was confirmed (deterministic reproduction, trace, or forced repro) — not merely a plausible cause. If the mechanism is environment-bound and a faithful repro is impractical, say so and name the deterministic alternative used instead (integration fixture or documented manual repro). An unverified mechanism is a blocking concern at the `spec_review` phase.
```

## Step 4 — Edit `.canon/templates/spec.md`: add bug-fix guidance to the Acceptance Criteria section

Find the `## Acceptance Criteria` section. It currently reads:

```
## Acceptance Criteria

Checklist of verifiable outcomes. Each item must be testable.

- [ ] AC-1: ...
```

Insert the following blockquote **between** the "Checklist of verifiable outcomes" line and the first `- [ ] AC-1:` line:

```markdown
> **For a bug or flake fix:** Include a regression-test AC that fails on the pre-fix code for the stated reason and passes after the fix (red-first). If a direct test is impractical, the AC must say so and name the deterministic alternative — not a silent omission.
```

## Step 5 — Edit `.canon/templates/spec.md`: add bug-fix item to the Spec Quality Checklist

Find the `## Spec Quality Checklist` section. It currently ends with:

```
- [ ] Validation Required has at least one entry marked `- [x]` (not `- [ ]`). `- [ ]` is a placeholder; the spec author flips required checks to `- [x]` before marking spec done. The orchestrator's code_review pre-flight blocks if no `[x]` items are present.
```

Append the following item **immediately after** that final line:

```markdown
- [ ] (Bug/flake fixes) *Problem* states how the failure mechanism was confirmed; *Acceptance Criteria* includes a red-first regression-test AC (or an explicit within-reason escape with a deterministic alternative)
```

## Step 6 — Regenerate the `templates/` mirrors

Run:
```bash
npm run sync-templates
```

This regenerates `templates/.claude/skills/canon-spec/SKILL.md` and `templates/.canon/templates/spec.md` from the edited root files. Do not manually edit the mirrors.

## Step 7 — Run the validation suite

Run all required checks in sequence:

```bash
npm run lint
npm run type-check
npm test
npm run sync-templates:check
npm run docs-refs-check
```

All must exit zero. `npm run build` is **not required** — no `src/**` files changed.

If `sync-templates:check` fails: re-run `npm run sync-templates` and confirm the root files were saved before syncing.

If `docs-refs-check` fails: the added blockquote introduced a broken path reference — verify the blockquote text is all prose with no file paths.

---

## Verification spot-checks (for the handoff)

After the validation suite passes, run these to confirm AC coverage:

```bash
# AC-1: mechanism-confirmation instruction in both files
git grep -n "mechanism was confirmed\|mechanism.*confirmed" .claude/skills/canon-spec/SKILL.md .canon/templates/spec.md

# AC-2: red-first regression-test instruction in both files
git grep -n "red-first\|fails on the pre-fix" .claude/skills/canon-spec/SKILL.md .canon/templates/spec.md

# AC-3: within-reason escape in both files
git grep -n "within-reason\|impractical" .claude/skills/canon-spec/SKILL.md .canon/templates/spec.md

# AC-5: no internal path references (must return nothing)
git grep -n "scripts/run-task" .claude/skills/canon-spec/SKILL.md .canon/templates/spec.md
```

AC-1 through AC-3 must return matches; AC-5 must return nothing.

---

## Reroute Plan

### Delta

The amendment adds AC-7 (new) and tightens AC-3's escape predicate. The prior plan's Steps 1–7 remain valid for the original ACs; the steps below address only what changed. Prior plan spot-check greps carry over — run them again after these edits plus the new AC-7 grep below.

**Step R1 — Fix AC-7 violation in `.canon/templates/spec.md` Problem section (line 10)**

The last sentence of the Problem blockquote currently reads:

```
An unverified mechanism is a blocking concern at the `spec_review` checkpoint.
```

Replace it with author-obligation framing that names the fast-tier gap:

```
Satisfying this is your obligation before marking the spec done — on fast-tier (S, non-delicate) tasks the `spec_review` checkpoint is skipped and no reviewer will catch an unverified mechanism.
```

Full resulting blockquote:

```markdown
> **For a bug or flake fix:** State how the failure mechanism was confirmed (deterministic reproduction, trace, or forced repro) rather than merely naming a plausible cause. If the mechanism is environment-bound and a faithful repro is impractical, say so and name the deterministic alternative used instead (integration fixture or documented manual repro). Satisfying this is your obligation before marking the spec done — on fast-tier (S, non-delicate) tasks the `spec_review` checkpoint is skipped and no reviewer will catch an unverified mechanism.
```

**Step R2 — Tighten AC-3 escape predicate in `.canon/templates/spec.md` AC section (line 24)**

The AC blockquote currently opens the escape with "If a direct test is impractical" — the amended AC-3 requires the identical two-part predicate everywhere. Replace:

```
If a direct test is impractical, the AC must say so and name the deterministic alternative rather than omitting verification.
```

With:

```
If the mechanism is environment-bound and a faithful repro is impractical, the AC must say so and name the deterministic alternative rather than omitting verification.
```

**Step R3 — Expand "within-reason escape" shorthand in both self-check items (P4)**

Both checklist items use the bare shorthand without the inline condition. Fix both:

`.canon/templates/spec.md` line 100 — replace:

```
- [ ] (Bug/flake fixes only) *Problem* states how the failure mechanism was confirmed; *Acceptance Criteria* includes a red-first regression-test AC or an explicit within-reason escape with a deterministic alternative
```

With:

```
- [ ] (Bug/flake fixes only) *Problem* states how the failure mechanism was confirmed; *Acceptance Criteria* includes a red-first regression-test AC or an explicit within-reason escape (environment-bound mechanism, faithful repro impractical) with a deterministic alternative
```

`.claude/skills/canon-spec/SKILL.md` line 145 — same replacement (text is identical):

```
- [ ] (Bug/flake fixes only) *Problem* states how the failure mechanism was confirmed; *Acceptance Criteria* includes a red-first regression-test AC or an explicit within-reason escape with a deterministic alternative
```

→

```
- [ ] (Bug/flake fixes only) *Problem* states how the failure mechanism was confirmed; *Acceptance Criteria* includes a red-first regression-test AC or an explicit within-reason escape (environment-bound mechanism, faithful repro impractical) with a deterministic alternative
```

**Step R4 — Align anti-pattern phrasing in `.claude/skills/canon-spec/SKILL.md` rule-of-thumb (P4)**

Line 152 currently says `rather than merely asserting a cause`; spec.md already says `rather than merely naming a plausible cause`. P4 requires both to use the tighter form (a real confirmed cause still "asserts" something, but it does name the mechanism). Replace in the SKILL.md bullet:

```
rather than merely asserting a cause
```

With:

```
rather than merely naming a plausible cause
```

**Step R5 — Regenerate `templates/` mirrors**

```bash
npm run sync-templates
```

Both `templates/.canon/templates/spec.md` and `templates/.claude/skills/canon-spec/SKILL.md` regenerate from the edited roots. Do not manually edit them.

**Step R6 — Run validation suite**

```bash
npm run lint
npm run type-check
npm test
npm run sync-templates:check
npm run docs-refs-check
```

All must exit zero.

**Step R7 — AC-7 spot-check**

```bash
# AC-7: self-enforcing framing; must show "no reviewer will catch" in both files
git grep -n "no reviewer will catch\|no reviewer" .canon/templates/spec.md .claude/skills/canon-spec/SKILL.md

# AC-3 (updated): both-part predicate present wherever escape is stated
git grep -n "environment-bound" .canon/templates/spec.md .claude/skills/canon-spec/SKILL.md
```

AC-7 grep must return at least one match in `spec.md`. AC-3 grep must return matches in both files with no occurrence of "impractical" that lacks an adjacent "environment-bound" on the same line or in the same blockquote.

---

## Reroute Plan Round 2

### Delta

Round 1 is complete — Steps 1–7 and Reroute R1–R7 shipped the 4 static surfaces (`.claude/skills/canon-spec/SKILL.md`, `.canon/templates/spec.md`, and their `templates/` mirrors) with all original ACs and AC-7 met.

Amendment Round 2 adds the **3 runtime prompt surfaces** (AC-8, AC-9) and requires a rebuilt `dist/` and a regenerated prompt golden (AC-11). Steps below address only that delta. All prior plan steps and spot-check greps remain in force.

**Step R2-1 — Read the shipped wording from `.claude/skills/canon-spec/SKILL.md`**

Before editing runtime prompts, read the bug/flake-fix rules-of-thumb bullet as it currently exists in `.claude/skills/canon-spec/SKILL.md` (the canonical Round 1 source). This is the exact wording that must appear verbatim in both runtime prompt files (AC-10 requires no divergent phrasing).

**Step R2-2 — Add the rules-of-thumb bullet to `scripts/run-task/prompts/templates/spec.md`**

Open `scripts/run-task/prompts/templates/spec.md`. Find the **"Spec-writing rules of thumb"** block — it ends with the existing refactor-spec bullet:

```
- **Refactor specs need hard structural caps**: size cap, explicit deletion expectations per symbol, grep AC for disappeared symbols.
```

Append the bug/flake-fix bullet **immediately after** that line (same position as in `SKILL.md` Step 1). Copy the wording verbatim from `SKILL.md` — do not re-draft it. The bullet must carry the identical two-part escape predicate ("environment-bound AND a faithful repro is impractical") and the identical anti-pattern ("name the confirmed mechanism, not merely a plausible cause").

**Step R2-3 — Add the same bullet to `scripts/run-task/prompts/templates/spec-revision.md`**

Open `scripts/run-task/prompts/templates/spec-revision.md`. Apply the identical insertion — same location in the rules-of-thumb block, same verbatim wording. The revision prompt is used when a spec is `changes_requested`; it carries the same authoring guidance.

**Step R2-4 — Add the conditional self-check item to `scripts/run-task/prompts/index.ts`**

Open `scripts/run-task/prompts/index.ts`. Find the `selfCheck` constant (rendered into the `spec.md` prompt via `{{{selfCheck}}}`). Read the self-check item as currently written in `.canon/templates/spec.md`'s Spec Quality Checklist — it should already carry the expanded escape condition from Round 1 ("environment-bound mechanism, faithful repro impractical"). Append the identical item to `selfCheck`, preserving the existing markdown checklist format. Do not abbreviate the escape predicate.

**Step R2-5 — Build the bundle**

```bash
npm run build
```

This bakes the updated `index.ts` and runtime prompt templates into `dist/scripts/run-task.js`. Required by AC-11; the spec explicitly marks `npm run build` as required for Amendment Round 2.

**Step R2-6 — Regenerate the prompt golden**

```bash
UPDATE_GOLDENS=1 npm test
```

The `promptSpec` output now includes the new self-check item; the golden fixture (`tests/run-task-prompts.golden.json`) must be regenerated to reflect it. Running with `UPDATE_GOLDENS=1` writes the new snapshot in place; the subsequent plain `npm test` call in Step R2-7 confirms the golden matches.

**Step R2-7 — Run the full validation suite**

```bash
npm run lint
npm run type-check
npm test
npm run sync-templates:check
npm run docs-refs-check
```

All must exit zero. `sync-templates:check` confirms the static managed-file mirrors are still aligned. `npm test` (without `UPDATE_GOLDENS`) confirms the regenerated golden matches the built prompt output.

**Step R2-8 — Update the handoff**

In `tasks/spec-bugfix-diagnosis-rule/handoff.md`, append a new `## Iteration 2 — addressing Amendment Round 2` section. Add a Changes row for each file changed in this iteration:

| File | What Changed |
|---|---|
| `scripts/run-task/prompts/templates/spec.md` | Added bug/flake-fix rules-of-thumb bullet (confirmed mechanism + red-first regression-test AC + two-part within-reason escape). |
| `scripts/run-task/prompts/templates/spec-revision.md` | Same bullet added; revision prompt now carries identical authoring guidance. |
| `scripts/run-task/prompts/index.ts` | Added conditional bug/flake-fix self-check item to `selfCheck` constant (rendered via `{{{selfCheck}}}` in spec prompt). |
| `tests/run-task-prompts.golden.json` | Regenerated prompt golden to reflect updated `selfCheck` content in `promptSpec` output. |
| `dist/scripts/run-task.js` | Rebuilt bundle to bake in runtime prompt + `index.ts` changes. |

Update the Validation Outcomes table: flip `npm run build` from `not_configured` to `Pass`. Add rows for `UPDATE_GOLDENS=1 npm test` (golden regeneration, `Pass`) and plain `npm test` (golden verification, `Pass`).

Update the AC Coverage table: mark AC-8, AC-9, AC-10, and AC-11 as Met with evidence greps.

**Step R2-9 — AC spot-checks**

```bash
# AC-8: rules-of-thumb bullet in both runtime prompts
git grep -n "confirmed mechanism" scripts/run-task/prompts/templates/spec.md scripts/run-task/prompts/templates/spec-revision.md

# AC-9: self-check item in index.ts; golden contains it
git grep -n "Bug/flake fixes" scripts/run-task/prompts/index.ts
git grep -n "Bug/flake fixes" tests/run-task-prompts.golden.json

# AC-10: wording consistency — no stray "impractical" without "environment-bound" nearby
git grep -n "environment-bound" .claude/skills/canon-spec/SKILL.md .canon/templates/spec.md scripts/run-task/prompts/templates/spec.md scripts/run-task/prompts/templates/spec-revision.md scripts/run-task/prompts/index.ts

# AC-11: dist is up to date
git diff --exit-code -- dist/
```

AC-8 grep must return matches in both runtime prompt files. AC-9 greps must return matches in both `index.ts` and the golden. AC-10 grep must show "environment-bound" adjacent to every escape statement across all five files. AC-11 must return nothing (clean dist).
