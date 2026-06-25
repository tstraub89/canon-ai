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
