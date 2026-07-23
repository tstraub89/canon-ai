# Plan: recalibrate-spec-review-for-stronger-reviewer

> Spec: `tasks/recalibrate-spec-review-for-stronger-reviewer/spec.md` | Spec review: `tasks/recalibrate-spec-review-for-stronger-reviewer/spec-review.md` (verdict: `sanctioned` — operator override, see `status.json.phases.spec_review` and `notes.md`)

## Context for the implementer

The spec_review round-2 blocking finding (an executed prompt A/B eval) was overridden by the operator via `canon task accept` — that is a settled, out-of-scope decision for this task, not something to re-litigate or satisfy in implement. Do not build a precision/recall harness, a prompt-comparison script, or any executed eval artifact. The four behavioral changes below, plus the golden regen, build, and decisions.md entry, are the entire scope.

This plan gives exact before/after text for `scripts/run-task/prompts/templates/spec-review.md` — apply it verbatim (word-level precision matters for AC-1's `failure mode` grep and AC-5's phrase-preservation checks). Where this plan's prose differs from your own judgment on style, prefer this plan's wording; it was checked against the exact AC verification steps.

## Step 1 — Edit `scripts/run-task/prompts/templates/spec-review.md`

The file is 47 lines. Four edits, in file order. Everything not listed here (lines 1–12, the bug/flake bullet at line 17 containing `Each role owns a checkpoint`, the Verdict rules, Batch-related-nits note, Cross-review rule containing `No agent reviews its own output`, and the closing instructions) is unchanged — do not touch those, they're pinned by AC-5 (`tests/run-task-prompts.test.ts:687-688, 737-738`).

### Edit 1 (AC-1 — objective framing, clean spec is a valid outcome)

Current line 13:
```
**Your job is to find what's wrong or missing — not to validate what's there.** Approach this as the implementer: if you had to build this, what would break, be ambiguous, or be missing? Neutral or confirmatory review is a failure mode.
```

Replace with:
```
**Your objective: catch genuine blocking problems, precisely.** Read the spec as the implementer would: what would break, be ambiguous, or be missing? A spec with no blocking findings is a valid, expected result — approving a clean spec is not a shortfall in your review.
```

This removes the only occurrence of "failure mode" in the file (AC-1's grep target) and states the clean-spec-is-valid outcome once, up front.

### Edit 2 (AC-2 — whole-review silence default)

Current line 22 (the paragraph right after the Shape Check bullet list, before "Then for each task, actively probe implementability..."):
```
**Silence is the default.** Only flag a Shape Check concern if something is actually off — do not manufacture one. A real shape concern becomes the lead reason for a `changes_requested` verdict; write it under the Shape Check section in spec-review.md. If none, leave that section as "no concerns" and proceed.
```

Replace with:
```
**Silence is the default — for this whole review, Shape Check and implementability alike.** Only write a finding where something is actually off; do not manufacture one to fill a section or satisfy an obligation. A real shape concern becomes the lead reason for a `changes_requested` verdict; write it under the Shape Check section in spec-review.md. If none, leave that section as "no concerns" and proceed.
```

Then current line 24 (the implementability probe, immediately below):
```
Then for each task, actively probe implementability: Can this be implemented as written? Are ACs testable and unambiguous? Are edge cases handled? Are there type safety gaps? Are there file/interaction dependencies Claude missed? Does this conflict with existing patterns in the codebase?{{#isBundle}}
```

Replace with:
```
Then for each task, apply that same default while probing implementability: Can this be implemented as written? Are ACs testable and unambiguous? Are edge cases handled? Are there type safety gaps? Are there file/interaction dependencies Claude missed? Does this conflict with existing patterns in the codebase? An empty list here is a valid result, not a gap in your review.{{#isBundle}}
```

(Only the lead clause and the trailing sentence change; the probe questions themselves and the `{{#isBundle}}` tag are untouched.)

### Edit 3 (AC-3 — scope boundary with omitted-dependency carve-out)

Insert a new paragraph after the existing implementability block closes:
```
Then for each task, apply that same default while probing implementability: ...{{#isBundle}}
Also probe for cross-task conflicts or missing dependencies between tasks.{{/isBundle}}
{{#combined}}
Review plan.md for each task as well — flag if the approach is unsound.{{/combined}}
```
(first line already updated per Edit 2 above)

...and before the current line 29 (`**Classify every finding before deciding your verdict:**`).

New paragraph to insert (with a blank line on each side, matching the file's existing blank-line-between-paragraphs style):
```
**Scope boundary.** Pre-existing behavior the task's spec *explicitly excludes and verifies as unaffected* (for example, named in Non-Goals) is out of scope for this review — a nit at most, never blocking. This carve-out does not cover: a change the spec *should* make but omitted (a required caller, parser, migration, or test surface), a transitive effect of the change, or an internal contradiction between spec sections — those remain **blocking** implementability findings even though the affected code is pre-existing. The test is not "can I reach this code" — it's whether the spec named it out of scope and showed it stays unaffected.
```

### Edit 4 (AC-4 — Blocking-vs-nit calibration example)

Current lines 29–31:
```
**Classify every finding before deciding your verdict:**
- **Blocking**: would cause wrong behavior, a silent bug, or make an AC unimplementable as written. Requires `changes_requested`.
- **Non-blocking (nit)**: an implementation detail Codex can resolve by reading the codebase (prop flow, state threading, naming); a minor ambiguity with an obvious default; a question the plan phase should address. Does NOT require `changes_requested`.
```

Replace with (adds one bullet, everything else identical):
```
**Classify every finding before deciding your verdict:**
- **Blocking**: would cause wrong behavior, a silent bug, or make an AC unimplementable as written. Requires `changes_requested`.
- **Non-blocking (nit)**: an implementation detail Codex can resolve by reading the codebase (prop flow, state threading, naming); a minor ambiguity with an obvious default; a question the plan phase should address. Does NOT require `changes_requested`.
- *Example*: an under-specification whose intended value the surrounding task context makes obvious (e.g. a field name implied by an adjacent example or existing convention) is a nit for the plan phase, not Blocking.
```

### Post-edit self-check before moving to Step 2

Run:
```
grep -n "failure mode" scripts/run-task/prompts/templates/spec-review.md   # expect: no output
grep -n "No agent reviews its own output" scripts/run-task/prompts/templates/spec-review.md   # expect: 1 hit, unchanged line
grep -n "Each role owns a checkpoint" scripts/run-task/prompts/templates/spec-review.md   # expect: 1 hit, unchanged line
grep -n "task baseline\|git -C" scripts/run-task/prompts/templates/spec-review.md   # expect: no output
```
All four must come back exactly as annotated — this is what AC-1 and AC-5 verify. Do not touch `scripts/run-task/prompts/templates/spec-review-reroute.md` or `.canon/templates/spec-review.md` (Non-Goals; confirmed both are separate files on a separate render path — `promptSpecReview` in `scripts/run-task/prompts/index.ts:149-202` only renders `spec-review.md` when `implement.rerouted !== true`).

## Step 2 — Regenerate the golden snapshot (AC-6)

```
UPDATE_GOLDENS=1 npm test
npm test
```

Expected: the diff in `tests/run-task-prompts.golden.json` is confined to the `promptSpecReview` key. `git diff tests/run-task-prompts.golden.json` should show exactly one changed value; the other 15 keys (`promptSpec`, `promptSpecRevision`, `promptPlan`, `promptImplement_fresh`, `promptImplementRevisions`, `promptImplementReroute`, `promptCodeReview_round1`, `promptCodeReview_roundN`, `promptQa`, `promptSpecReview_reroute_round1`, `promptSpecReview_reroute_round2`, `promptSpecReview_reroute_bundle`, `promptPlan_reroute_round1`, `promptPlan_reroute_bundle`, `promptQa_withTemplate`) render other templates or the reroute branch and must be byte-identical to before. If any of those changed, the edit leaked outside `spec-review.md` — stop and re-check Step 1's diff (`git diff scripts/run-task/prompts/templates/spec-review.md`) for accidental edits outside the four blocks above.

`npm test` (second, unmodified-env run) must pass clean — this is also where AC-5's `AC-11 — structural relocation` test (`tests/run-task-prompts.test.ts:667`) re-validates the four grep assertions from the Step 1 self-check, now against the committed file.

## Step 3 — Rebuild the shipped bundle (AC-7)

```
npm run build
```

`scripts/run-task/prompts/templates/spec-review.md` is inlined into `dist/scripts/run-task.js` by tsup's `.md`-as-text loader (`tsup.config.ts:18`, `loader: { '.md': 'text' }`). Verify the recalibrated text made it in:
```
grep -n "catch genuine blocking problems, precisely" dist/scripts/run-task.js
```
Expect a hit. Commit the rebuilt `dist/scripts/run-task.js`.

Check `dist/cli/index.js` for drift:
```
git status --porcelain dist/cli/index.js
```
Per the spec's Interaction Dependencies note, this file does not import the prompt builders and is expected to stay byte-identical. If it shows as dirty, add it to the handoff Changes table (do not silently commit an undeclared dist artifact — the base-drift gate rejects that); if it's clean, do not add a row for it.

## Step 4 — Record the durable meta-insight in `docs/decisions.md` (AC-8)

Append a new entry at the end of the file (after the final existing entry, "Agent files come from built-in `/init`, not canon scaffolding"), following the file's established heading/Decision/Why/Rule shape and `(YYYY-MM)` dated-heading convention (see e.g. `## Model-generation re-baseline (2026-06)`, `## \`spec_review\` M effort raised medium → high (2026-07)`):

```markdown
---

## Guardrail prompts carry an implicit model-strength calibration (2026-07)

**Decision**: A guardrail prompt tuned to push a weaker model to find fault is not neutral once the model behind it gets stronger — the same wording shifts the reviewer's operating point. `spec_review`'s recalibration (this entry's trigger — `recalibrate-spec-review-for-stronger-reviewer`) is the first instance canon has explicitly diagnosed and corrected; treat it as the reference case for peer guardrails.

**Why**: Canon upgraded to the 5.6 Codex generation (`gpt-5.6-luna`/`gpt-5.6-sol`) without re-checking `spec_review`'s "push to find fault" framing, calibrated for an earlier, less literal reviewer. Three tasks in one week (`update-install-root-provenance`, `stable-validation-ids`, `fix-installed-provenance-version`) showed the same convergence failure — a new "blocking" finding manufactured each round on a spec whose shape was already sound, in one case attacking behavior the spec had explicitly placed in Non-Goals and verified unaffected. Vendor guidance for the generation (OpenAI's prompt guidance to state instructions once rather than push; CodeRabbit's benchmark finding the generation higher-recall/lower-precision than its predecessor, achieving precision only through stricter filtering) corroborates the mechanism: a strong, literal model executes a "keep pushing" instruction as intended, which is exactly the failure mode when the instruction is no longer necessary.

**Rule**: Whenever canon's default model generation is bumped for an agent role that carries a guardrail or review-disposition prompt (`spec_review`, `code_review` lenses, the code-review foreman's synthesis instructions, any future reviewer role), re-check that prompt's calibration against the new generation's disposition before assuming the existing wording still fits — don't wait for observed over- or under-firing across multiple tasks to notice. A "push harder" framing, a "silence is failure" framing, or an unbounded scope instruction are the specific patterns to look for; a stronger model executes them literally.
```

Run `npm run docs-refs-check` after the edit — it validates file/symbol/section references in markdown, not dates or a table of contents, so the entry above (which cites only the task ID as plain text, no backtick path/section refs) should pass without further changes.

## Step 5 — Full validation pass

Run in order (matches spec's Validation Required):
```
npm run lint
npm run type-check
npm test
npm run build
npm run docs-refs-check
npm run sync-templates:check
```
`sync-templates:check` is expected to stay green with no diff — neither `scripts/run-task/prompts/templates/spec-review.md` nor `docs/decisions.md` is in `CANON_OWNED`/`DELIMITED` (`src/lib/canon-owned.ts`), so this task has no `templates/` mirror to declare or regenerate.

## Handoff Changes table (for implement)

At minimum:
| File | Change |
|---|---|
| `scripts/run-task/prompts/templates/spec-review.md` | Four behavioral edits (AC-1–AC-4) |
| `tests/run-task-prompts.golden.json` | Regenerated `promptSpecReview` entry (AC-6) |
| `dist/scripts/run-task.js` | Rebuilt bundle carrying the recalibrated prompt (AC-7) |
| `docs/decisions.md` | New dated entry (AC-8) |

Add `dist/cli/index.js` only if Step 3's `git status --porcelain` check shows it dirty.

## Notes

No spec gaps encountered during planning — the spec's four behavioral changes, Affected Files, and Interaction Dependencies sections were sufficient to derive exact before/after text without further clarification. Nothing appended to `notes.md`.
