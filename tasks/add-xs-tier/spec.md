# Spec: add-xs-tier — Add XS task size as the new fast-tier floor

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

canon's fast tier (spec+plan collapsed into one Claude session, Codex `spec_review` skipped) is currently bound to `task_size: S`. That conflates two different ideas under one size:

1. **"There's almost no spec premise worth reviewing"** — the spec is just a list of ACs, so skipping `spec_review` is correct.
2. **"This is genuinely small."**

These came apart in the spec-premise review program's origin incident: a fast-tier S bug fix shipped with a *wrong premise* precisely because no `spec_review` ran. The fix for the premise-rigor gap was task 1 (`spec-bugfix-diagnosis-rule`, shipped). This task fixes the *tier* gap: today there is no size between "do it inline" and "S that skips spec_review." Anything that warrants written ACs, a plan, and a real `code_review` — but whose spec has no premise to challenge — is forced to be S, which then *also* skips spec_review even when it shouldn't, or is bumped to M and pays for full-effort everything it doesn't need.

We introduce **XS** as the new fast-tier floor and graduate **S** to full tier:

- **XS** = the floor where running the pipeline beats doing the change inline. More than a trivial one-file inline change (>1 file, or real logic), but with little-to-no spec premise worth reviewing. XS is the *smallest way into the pipeline*, so choosing it over inline buys you the pipeline's properties — **Codex implements against written ACs, Claude reviews** (the inverse of inline's Claude-implements / Codex-reviews), plus a plan to ground it and a real `code_review`. (Those properties belong to running the pipeline at all, of which XS is the floor — they are not unique to XS; what *is* specific to XS is that it's the cheapest tier that has them and still skips `spec_review`.) XS clones today's S model/effort exactly and remains the only fast-tier size (spec+plan combined, `spec_review` skipped).
- **S** keeps every one of its current effort values but graduates to **full tier**: it now runs a separate plan and a Codex `spec_review` (at its existing `mini/medium` row). `spec_review` is the XS→S dividing line precisely because S is the first size with enough premise to be worth challenging.

This must not collapse S into M. S becomes "full pipeline at all-`medium` effort"; M remains "full pipeline at all-`high` effort." They differ on four effort cells (spec, plan, implement, code_review) and tie only on `spec_review` (`mini/medium`) and qa (`medium`).

**Second dimension — the guidance-consistency sweep.** Introducing XS and graduating S contradicts size/tier guidance that is hard-coded across the shipped surfaces (runtime prompt templates, the prompt golden, operator skills, `.canon/templates/spec.md`, CLI help, `README.md`, and several `docs/`). Leaving any of it stale ships *self-contradicting guidance* — the exact failure this dimension exists to prevent. A repo-wide structural sweep (not a hand-enumerated list — enumeration is what under-scoped the first four `spec_review` rounds) shows the contradiction has **four distinct families**, each a different string shape:

- **Family A — fast-tier identity names S.** `fast-tier (S, non-delicate)` / `Fast tier (S non-delicate)` / `fast-tier tasks (S)` / `trivial tasks (S, ...)`. Once XS is the fast tier, every one of these is false and must name **XS**. Task 1 (`spec-bugfix-diagnosis-rule`) itself wrote `on fast-tier (S, non-delicate) tasks the spec_review checkpoint is skipped` into the rule-of-thumb carriers last week.
- **Family B — full-tier / `spec_review` membership omits S.** `M/L/XL/delicate`, `M, L, XL, or delicate`, `M/L/XL or delicate` — every place that enumerates which sizes are full tier / get `spec_review` / re-enter at `spec_review`. Once S graduates, S *is* full tier, so each list must include S (becomes `S/M/L/XL...`). All 19 live occurrences are membership claims; none is a legitimate effort-band reference (the Codex matrix expresses effort by table rows and the phrase "XL or delicate", never a bare `M/L/XL` effort label).
- **Family C — size-set enumerations omit XS.** `<S/M/L/XL>`, `S | M | L | XL`, `S` (trivial)…, and the env-var budget/review tiers `S/M`, `S/M/L`. Every list of the valid sizes must gain XS.
- **Family D — a terminology collision: "XS" already means inline.** `README.md` and the `canon-inline-review` skill already use "**XS**" to mean *"a fix too small for a canon task — do it inline."* That directly contradicts the new formal XS, which **is** a pipeline task (the fast-tier floor; Codex implements, Claude reviews). These surfaces must stop calling inline/below-pipeline work "XS" (rephrase to "trivial"/"below-pipeline").

So flipping the policy is inseparable from making every live guidance surface consistent with the post-change invariant. The gate is structural (per-family greps), with an enumerated worklist as an aid — but the gate, not the list, is the authority.

## Decision

Add `XS` to the task-size matrix in `scripts/pipeline-policy.ts` as a clone of today's S model/effort values, make XS the sole fast-tier size, and move S to full tier without changing any S effort value. Update the policy's two size-keyed routing surfaces (`detectTier` and `isPlanCombined`) and the `maxSize` floor so XS routes as fast tier and reports correctly as nominal/effective size. Mirror the change across the table-driven tests, the model/effort + sizing-guide docs, and add the inline→XS→S size-selection rule to the size-selection guidance surfaces. Then sweep every live guidance surface to the post-change invariant (the four families above). No existing S/M/L/XL effort value changes; no new model rows; delicate still promotes to XL.

## Non-Goals

- **No change to any existing S/M/L/XL effort or model value.** Only XS is added (cloning S's values), and S's tier flips. The Codex `implement` row for M stays `mini/high`, etc.
- **No `--size` CLI flag.** `canon task new` has no size argument today (size is set in `status.json`); this task does not add one.
- **No change to the `status.json` default size** — it stays `M` (`.canon/templates/status.json`).
- **No migration shim for in-flight S tasks.** After this ships, an existing or new S task simply routes full tier (gets `spec_review` + separate plan) on its next `canon run`. That is intended, not a regression.
- **No change to `delicate` behavior** — `delicate: true` still promotes effective size to XL. XS does not interact with delicate beyond appearing in `SIZE_ORDER`.
- **No budget change for any existing size.** XS budget = `5.00` (same as S/M).
- **No edit to historical / planning records.** `CHANGELOG.md`, `docs/lessons-learned.md`, and `docs/BACKLOG.md` carry the old `fast-tier (S)` label, the old `M/L/XL` membership wording, and the informal "XS = inline" usage as accurate descriptions of past/planned state (including `docs/BACKLOG.md`'s description of *this* task). Rewriting them would falsify the record. They are excluded from the sweep (the gate excludes them by path). The same exclusion applies to point-in-time **analysis reports and telemetry** that carry old size-band wording as accurate historical record — `docs/canon-opus48-gpt55-report.md`, `docs/harness-audit-2026-06.md`, `docs/task-quality-log.md` — and to the **superseded-state comment** at `scripts/pipeline-policy.ts:120` ("the old caps (2 for S/M…)"); none is swept. *(The bundled runtime prompts and their golden are **in scope** — they hard-code the family-A `(S)` label and must be swept; see AC-18/AC-19.)*

## Acceptance Criteria

> Not a bug/flake fix (feature/policy change), so the red-first regression-test AC is N/A. Policy verification is via the table-driven `tests/pipeline-policy.test.ts` suite extended with XS cases; guidance-sweep verification is the structural gate in AC-18.

### Matrix & type (scripts/pipeline-policy.ts)

- [ ] AC-1: `TaskSize` (line 10) is `'XS' | 'S' | 'M' | 'L' | 'XL'`. Verify: `grep -n "type TaskSize" scripts/pipeline-policy.ts` shows `XS` first; `npm run type-check` passes (the `Record<TaskSize, …>` literals force every matrix/budget table to gain an XS key or compilation fails).
- [ ] AC-2: `SIZE_ORDER` (line 68) is `['XS', 'S', 'M', 'L', 'XL']` (XS at index 0, the new floor).
- [ ] AC-3: `BUDGET_BY_SIZE` includes `XS: '5.00'`; S/M/L/XL values unchanged (`5.00`/`5.00`/`10.00`/`20.00`).
- [ ] AC-4: `defaultMaxReviewLoops('XS') === 3` (XS joins the 3-loop branch alongside S and M); L/XL stay 5.
- [ ] AC-5: In `codexMatrix`, the XS row equals today's S row: `spec_review.XS = { model: codexModelMini, effort: 'medium' }` and `implement.XS = { model: codexModelMini, effort: 'medium' }`. The S rows are unchanged (`spec_review.S` and `implement.S` both still present).
- [ ] AC-6: In `claudeMatrix`, every per-phase table includes an XS entry equal to today's S entry: `spec.XS`, `plan.XS`, `qa.XS` resolve to `effort: 'medium'`, and `code_review.XS = { model: claudeModelReview, effort: 'medium' }`. No existing S/M/L/XL entry changes.

### Routing (the two size-keyed surfaces + the floor)

- [ ] AC-7: `detectTier` returns `'fast'` **only** when every task is XS and non-delicate; a single S (non-delicate) task now returns `'full'`. Verify via tests: `detectTier([{task_size:'XS'}]) === 'fast'`, `detectTier([{task_size:'S'}]) === 'full'`, `detectTier([{task_size:'XS'},{task_size:'S'}]) === 'full'`, and any `delicate` XS task → `'full'`.
- [ ] AC-8: `isPlanCombined` returns `true` only for a non-delicate XS task: `isPlanCombined({task_size:'XS'}) === true`, `isPlanCombined({task_size:'S'}) === false`, `isPlanCombined({task_size:'XS', delicate:true}) === false`. (This is the second size-keyed surface, distinct from `detectTier`.)
- [ ] AC-9: `getNominalSize` and `getEffectiveSize` return `'XS'` for an all-XS non-delicate bundle (`[{task_size:'XS'}]`). This requires `maxSize` to seed at the XS floor rather than `'S'`, so an all-XS bundle is not silently reported as `S`. A delicate XS task still promotes via `getEffectiveSize` → `'XL'` (delicate path unchanged).
- [ ] AC-10: `getPipelinePolicy([{task_size:'XS'}], cfg)` yields `tier: 'fast'`, `planCombined: true`, `maxReviewLoops: 3`, `effectiveSize: 'XS'`, and `codex('implement') === { model: codexModelMini, effort: 'medium' }`. `getPipelinePolicy([{task_size:'S'}], cfg)` yields `tier: 'full'`, `planCombined: false`, and an unchanged S codex/claude resolution.

### Comments describing the fast-tier invariant

- [ ] AC-11: The load-bearing comments in `scripts/pipeline-policy.ts` that describe the fast-tier invariant name **XS**, not S. Verify: `grep -nE "fast tier|fast-tier|plan collapse|skips? .*spec review" scripts/pipeline-policy.ts` returns no comment claiming S is the fast tier; the `PipelinePolicy.planCombined` doc (≈line 60), the `detectTier` comment (≈line 93), the `isPlanCombined` comment (≈line 102), and the `codexMatrix` "S row unused" note (≈line 142, now describing the XS `spec_review` row as the unused-but-kept one) all reference XS. The `detectTier` comment's full-tier list (line 93, currently "any M/L/XL,…") also gains S (Family B). Additionally, the **shared-band comments** that group sizes by a current per-size value gain XS where XS shares S's band — the loop-cap default (≈line 43 `3 for S/M`; ≈line 122 `New floor: 3 for S/M`) and the review-model band (≈line 193 `Sonnet for S/M/L`) — Family C. The historical note at ≈line 120 (`The old caps (2 for S/M…)`) describes superseded state and is **left unchanged**.

### Tests (pipeline-policy matrix + non-policy orchestration fixtures)

- [ ] AC-12: The Codex-matrix, Claude-matrix, routing (tier + `planCombined`), budget, and loop-cap test tables in `tests/pipeline-policy.test.ts` each gain XS cases asserting AC-1…AC-10 above, and add/adjust an S case asserting S now routes full tier (`tier: 'full'`, `planCombined: false`, `spec_review` resolved). The shared-band comment (≈line 161 `Sonnet for S/M/L`) and the loop-cap test name (≈line 226 `defaultMaxReviewLoops: 3 for S/M, 5 for L/XL`) gain XS to match the new XS-in-band assertions (Family C). `npm test` passes.
- [ ] AC-12b: **The non-policy orchestration tests that exercise the fast-tier path via `task_size: 'S'` are moved to `'XS'` so they keep testing the fast tier after S graduates** (otherwise their assertions invert or vacate when S becomes full tier, and `npm test` fails). Exactly three fixtures are tier-dependent:
  - **`tests/run-task-reroute-preflight.test.ts`** — the `RerouteStatusOptions.taskSize` helper type (lines 38–40, currently `'S' | 'M' | 'L' | 'XL'`) gains `'XS'`; the fast-tier reroute test `rerouteFromHumanReview fast-tier leaves spec_review and plan untouched and resumes at implement` (line 677; fixture at line 684) seeds `taskSize: 'XS'`. Rationale: this test asserts the **fast-tier** reroute contract (spec_review/plan left untouched, resume at implement); for a full-tier task reroute resets spec_review, so leaving the fixture at `'S'` would make the assertions describe the wrong path.
  - **`tests/run-task-safety.test.ts`** — both fast-tier spec-gate tests seed `task_size: 'XS'`: `fast-tier spec review keeps the gate when a bundle mixes full-send and normal tasks` (line 2383; fixture line 2391) and `fast-tier spec review skips the gate when every task is full-send` (line 2437; fixture line 2445). Rationale: these assert that `runSpecReviewPhase` leaves `spec_review.status === 'pending'` (the fast-tier *skip*) while the spec gate still fires; at full tier `spec_review` would actually run, so the fixtures must be XS to keep exercising the skip path.
  - Verify: after the change all three tests assert the fast-tier path for an XS fixture and `npm test` passes. **The remaining `task_size: 'S'` fixtures in `tests/` use S as an arbitrary valid size (their assertions do not depend on the tier boundary) and must NOT be changed**: `tests/run-task-canon-snapshot.test.ts`, `tests/run-task-validation.test.ts` (two fixtures), `tests/run-task-counter-schema.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-ship.test.ts`, `tests/task-cli.test.ts`. (The prompt golden's `Tier / task size: full / S` line is produced by an explicit `tier: 'full'` override in `makeTask` at `tests/run-task-prompts.test.ts:165`, not by policy resolution, so S graduating to full tier does not change it — the only golden change is the AC-21 rule-of-thumb `(S)`→`(XS)` flip.)

### Size-selection guidance (the inline→XS→S rule + matrix docs)

- [ ] AC-13: `.claude/skills/canon-spec/SKILL.md` is updated in two places: (a) the **size-assessment list** (≈lines 70–77) lists **XS** above S and states the inline→XS→S decision rule in these terms — inline = Claude implements + `codex review` at intervals, no ACs/plan/task; **XS** = more than a trivial one-file inline change (>1 file, or real logic) but with little-to-no spec premise worth reviewing — it's the smallest way into the pipeline, so choosing it over inline buys the pipeline's cross-review direction (Codex implements against written ACs, Claude reviews — the inverse of inline) plus a plan and a real `code_review`; **S** = the spec now carries enough logic/risk that a Codex `spec_review` pass earns its keep. The guidance frames the cross-review flip as a property of *running the pipeline* (which XS is the floor of), not unique to XS; the text makes clear `spec_review` is the XS→S dividing line. (b) The **grill-mode split** (≈lines 78–80, currently "For S tasks: …" light path vs "For M / L / XL / delicate tasks — grill mode") shifts so the light path is **XS** and the grill path is **S / M / L / XL / delicate** (S now full-tier).
- [ ] AC-14: `docs/pipeline-orchestrator.md` reflects fast tier = XS and S = full tier everywhere it states the boundary. Specifically: the **tier-definition headers** (≈line 151 `**Fast tier** (all tasks S, non-delicate)` → `(all tasks XS, non-delicate)` — Family A; ≈line 161, "Full tier (any task … or delicate)" gains S — Family B) and the **bundle-mode line** (≈line 175, "any M/L/XL/delicate pulls the bundle to full tier" gains S); the **Task Sizing Fields table** (≈line 185, `task_size` values become `XS \| S \| M \| L \| XL` and "S is fast-tier; M+ runs the full pipeline" becomes "XS is fast-tier; S+ runs the full pipeline" — Families A+C); the **task sizing guide table** (≈lines 195–200) gains an XS row with the inline→XS→S framing; the **Codex model/effort matrix** (≈lines 214–219) gains an XS column = S values and shows S running `spec_review` (no longer "— (skipped)"); the **env-var size enumerations** (≈line 229 `Code review for S/M/L` → includes XS; ≈line 232 budget tier `S/M 5.00` → includes XS; ≈line 243 `CODEX_MODEL_MINI … S/M/L non-delicate phases` → includes XS, since XS resolves to the mini model; ≈line 245 `MAX_REVIEW_LOOPS … 3 for S/M` → includes XS, since XS resolves to a 3-loop cap — all Family C); the **human-spec-gate timing notes** (≈line 319 "Fast tier (S, non-delicate)" → XS — Family A; ≈line 320 "Full tier (M/L/XL/delicate)" gains S — Family B); the **reroute description** (≈line 421 "any M/L/XL task or any delicate task" gains S — Family B; ≈line 431 `Fast-tier reroute … S, non-delicate tasks re-enter` → `XS, non-delicate` — Family A); the **auto-block loop-cap note** (≈line 338 `3 for S/M, 5 for L/XL` → `3 for XS/S/M` — Family C); and the **two `/canon-spec-review` recommendation lines** (≈lines 5, 472, "for M/L/XL or delicate tasks" gains S — Family B).
- [ ] AC-15: `docs/product-context.md` updated in three places: the **Tier glossary row** (≈line 41 — "Fast tier (S non-delicate)…" → XS (Family A), "Full tier (M/L/XL or any delicate)" gains S (Family B)); the **Task size glossary row** (≈line 42 — gains `XS` and its meaning, Family C); and the **Tiers, Sizes, and Authorization** section (≈lines 90–91 — fast tier = `XS` non-delicate; full tier = anything `S`, `M`, `L`, `XL`, or `delicate`).
- [ ] AC-16a: `docs/decisions.md` "Fast tier … skips Codex spec review" entry (≈lines 81–87) is rewritten so the heading, Decision, and Why name **XS** as the fast-tier size (Family A: line 81 heading, line 83 `task_size: S` → `XS`, line 85 "trivial tasks (S, non-delicate)" → XS, line 87 "Don't add spec_review work to S non-delicate tasks" → "XS non-delicate tasks" — this phrasing is caught by the AC-18 Family A invariant gate), the "Reserving Codex spec review for M/L/XL/delicate tasks" clause gains S (Family B, line 85), and the stale Rule advice "size it M" becomes "size it S" (S now gets spec_review, line 87). The rewritten entry must be internally consistent post-graduation: its advice and stated invariant agree that **XS** is what skips `spec_review`.
- [ ] AC-16b: A short new `docs/decisions.md` entry is added documenting the inline→XS→S boundary and why XS exists (the rationale in *Problem*): XS is the floor where the pipeline beats inline; `spec_review` is the XS→S dividing line because S is the first size with spec premise worth challenging.
- [ ] AC-17: `docs/architecture.md` (≈line 106) size enum reads `XS | S | M | L | XL` (Family C).

### Guidance-consistency sweep (the second dimension — structural gate)

- [ ] AC-18: **The post-change invariant holds on every live guidance surface, enforced by a per-family structural gate.** The invariant: *fast tier = XS, non-delicate; full tier (separate plan + Codex `spec_review`) = S, M, L, XL, or any `delicate`; the valid size set = XS/S/M/L/XL; "XS" denotes the smallest pipeline task, never inline/below-pipeline work.* "Live surfaces" = the repo minus `.git`, `tasks/**`, `node_modules`, `dist/**`, `templates/**` (these regenerate from source via AC-20/21/22) and the three historical/planning records `CHANGELOG.md`, `docs/lessons-learned.md`, `docs/BACKLOG.md` (excluded by path). The gate is the union of these greps; each must return **zero** matches after the change:
  - **Family A** (fast-tier identity must name XS, not S). The first four patterns catch the parenthetical `(S…)` shapes; the fifth is a single **invariant** pattern — *a bare, word-bounded `S` adjacent to "non-delicate"* — that catches every remaining fast-tier-identity phrasing regardless of separator (comma, backtick, paren, or space). It matches the three shapes the parenthetical patterns miss — `**Fast tier** (all tasks S, non-delicate)` (`docs/pipeline-orchestrator.md:151`), `… S, non-delicate tasks re-enter …` (`docs/pipeline-orchestrator.md:431`), and `` `S` non-delicate `` (`docs/product-context.md:90`) — and, because the `S` is word-bounded, it does **not** match the post-change `XS` in any of them (`XS, non-delicate`, `` `XS` non-delicate ``, etc. all have the `S` preceded by `X`):
    ```
    rg -nP --hidden -g '!.git' -g '!tasks/**' -g '!node_modules' -g '!dist/**' -g '!templates/**' \
       -g '!CHANGELOG.md' -g '!docs/lessons-learned.md' -g '!docs/BACKLOG.md' \
       -g '!tests/pipeline-policy.test.ts' \
       -e 'fast[- ]tier \(S[ ,)]' -e 'Fast tier \(S' -e 'fast-tier tasks \(S\)' -e 'trivial tasks \(S' \
       -e '\bS[\s,)\x60]*non-delicate'
    ```
    The `\bS…non-delicate` invariant requires PCRE (`-nP`). `tests/pipeline-policy.test.ts` is excluded from **this family only** because its `{ name: 'S non-delicate', … }` / `isPlanCombined: only S non-delicate` test labels describe a genuine **S** task (which still exists after S graduates to full tier — only its *tier* changes), so those strings are not stale fast-tier-identity claims; that file's tier-relevant content is governed positively by AC-12 (the `only S` → `only XS` rename and the flipped S routing case). The prompt golden (`tests/run-task-prompts.golden.json`) is deliberately **kept in-gate**: its `(S, non-delicate)` text is bundled prompt content that the AC-21 regen flips to `(XS, non-delicate)`, so a forgotten regen trips this gate.
  - **Family B** (full-tier / `spec_review` membership must include S — lookbehind because the fixed form `S/M/L/XL` *contains* `M/L/XL`):
    ```
    rg -nP --hidden -g '!.git' -g '!tasks/**' -g '!node_modules' -g '!dist/**' -g '!templates/**' \
       -g '!CHANGELOG.md' -g '!docs/lessons-learned.md' -g '!docs/BACKLOG.md' \
       -e '(?<!S/)M/L/XL' -e '(?<!S, )M, L, XL'
    ```
  - **Family D** (no live surface calls inline/below-pipeline work "XS"): on the `canon-inline-review` skill, `rg -nw 'XS' .claude/skills/canon-inline-review/SKILL.md` returns zero; repo-wide, the phrasings that denote inline work as XS return zero:
    ```
    rg -nP --hidden -g '!.git' -g '!tasks/**' -g '!node_modules' -g '!dist/**' -g '!templates/**' \
       -g '!CHANGELOG.md' -g '!docs/lessons-learned.md' -g '!docs/BACKLOG.md' \
       -e 'XS\s+(fixes|changes|inline|edits|tweaks)' -e '(inline|below-pipeline)\b[^.\n]{0,12}\bXS\b' -e 'XS\b[^.\n]{0,40}too small'
    ```
  This structural gate — not the AC-19 enumeration — is the authority. **Family C is verified by the positive targeted ACs (AC-13/14/15/17 and AC-19's spec-review-template row), not a zero-gate**: the fixed enumeration `XS/S/M/L/XL` contains the old `S/M/L/XL` as a substring, so a "stale string absent" gate is impossible; each size-set surface is asserted to read with XS instead. This decomposition (invariant + per-family gate, structural where a zero-gate is sound and positive where it isn't) is what the first four `spec_review` rounds lacked — they hand-narrowed one family's grep and kept missing the others.
- [ ] AC-19: **Implementer worklist (complete as of this revision; subordinate to the AC-18 gate).** Every surface below is updated to the invariant. The bug-fix rule-of-thumb parenthetical `on fast-tier (S, non-delicate) tasks the spec_review checkpoint is skipped` reads `(XS, non-delicate)` in all four rule-of-thumb carriers. Grouped by family:
  - **A — fast-tier identity → XS:** `.canon/templates/spec.md:10`, `scripts/run-task/prompts/templates/spec.md:16`, `scripts/run-task/prompts/templates/spec-revision.md:17`, `.claude/skills/canon-spec/SKILL.md:152`, `scripts/pipeline-policy.ts:60,102`, `.claude/skills/canon-spec-review/SKILL.md:3,17`, `.claude/skills/canon-pipeline/SKILL.md:55,158`, `scripts/run-task/cli.ts:118,153`, `src/cli/index.ts:95`, `docs/decisions.md:81,83,85,87`, `docs/product-context.md:41,90`, `docs/pipeline-orchestrator.md:151,319,431`, `README.md:73` (`fast-tier tasks (S)`). Plus a *precision* edit (not a stale `(S)` label, so not gate-caught): `README.md:62` reads "Fast tier (small tasks)" — tighten to name **XS** so the README floor matches the invariant.
  - **B — full-tier/`spec_review` membership → add S:** `scripts/pipeline-policy.ts:93`, `scripts/run-task/cli.ts:118,152`, `src/cli/index.ts:94`, `docs/decisions.md:85`, `docs/product-context.md:41`, `docs/pipeline-orchestrator.md:5,161,175,320,421,472`, `.claude/skills/canon-spec/SKILL.md:177,196`, `.claude/skills/canon-spec-review/SKILL.md:3,16`, `.claude/skills/canon-pipeline/SKILL.md:56,156`, `README.md:73`.
  - **C — size-set / shared-band enumeration → add XS:** `docs/architecture.md:106`, `docs/product-context.md:42`, `docs/pipeline-orchestrator.md:185,229,232,243,245,338`, `.claude/skills/canon-spec/SKILL.md:70-77`, `.claude/skills/canon-spec-review/SKILL.md:102` (`<S/M/L/XL>` → `<XS/S/M/L/XL>`), `.claude/skills/canon-status/SKILL.md:63` (`3 for S/M` → `3 for XS/S/M`), plus the shared-band code comments per AC-11 (`scripts/pipeline-policy.ts:43,122,193`) and the band comment + loop-cap test name per AC-12 (`tests/pipeline-policy.test.ts:161,226`). **Excluded — historical/analysis/telemetry band references left as accurate point-in-time records:** `scripts/pipeline-policy.ts:120` ("the old caps (2 for S/M…)"), `docs/task-quality-log.md` (telemetry rows), `docs/harness-audit-2026-06.md`, `docs/canon-opus48-gpt55-report.md`.
  - **D — "XS" must stop denoting inline work:** `README.md:126,155`, `.claude/skills/canon-inline-review/SKILL.md:10,15` (rephrase to "trivial"/"below-pipeline"). Excluded (historical/planning): `CHANGELOG.md:51`, `docs/BACKLOG.md:16,18,1136,1144`.

### Build, golden, sync, and full validation

- [ ] AC-20: `npm run build` is run and the regenerated `dist/` (compiled `pipeline-policy` + CLI) is committed; `git diff --exit-code dist/` is clean after commit (CI git-diff gate).
- [ ] AC-21: `UPDATE_GOLDENS=1 npm test` regenerates `tests/run-task-prompts.golden.json` to reflect the edited runtime prompt templates (the `(S)`→`(XS)` flip in `promptSpec`/`promptSpecRevision`); the regenerated golden is committed and a plain `npm test` then passes against it. (Note: the golden is **not** gate-excluded in AC-18, so a forgotten regen surfaces as a Family-A grep failure.)
- [ ] AC-22: `npm run sync-templates` is run so the `templates/` mirrors of the edited **canon-managed** files are regenerated; `npm run sync-templates:check` passes. The sync covers only files in `CANON_OWNED` (`src/lib/canon-owned.ts`) — of the surfaces this task edits, that is `docs/pipeline-orchestrator.md`, `.canon/templates/spec.md`, and the five `.claude/skills/{canon-spec,canon-spec-review,canon-pipeline,canon-inline-review,canon-status}/SKILL.md` files. The other edited docs (`docs/product-context.md`, `docs/decisions.md`, `docs/architecture.md`) and source files (`scripts/**`, `src/cli/index.ts`, `README.md`) are **not** in `CANON_OWNED`, so `sync-templates` does not produce or touch any `templates/` mirror for them. (Edit root files only; the mirrors listed in Affected Files are derived.)
- [ ] AC-23: `npm run lint`, `npm run type-check`, and `npm test` all pass.

## Design

### Affected Files

**A. Matrix / routing / tests**

| File | Change |
|---|---|
| `scripts/pipeline-policy.ts` | Add `'XS'` to `TaskSize`; prepend to `SIZE_ORDER`; add `XS: '5.00'` to `BUDGET_BY_SIZE`; XS branch (→3) in `defaultMaxReviewLoops`; add XS rows (= clone of S values) to `codexMatrix` (`spec_review`, `implement`) and to `claudeMatrix` (`buildHigh`, `buildMedium`, `codeReviewMatrix`); flip `detectTier` fast-condition from `=== 'S'` to `=== 'XS'`; flip `isPlanCombined` from `=== 'S'` to `=== 'XS'`; seed `maxSize` accumulator at the `'XS'` floor so an all-XS bundle reports nominal/effective `'XS'`; update fast-tier-invariant comments (≈lines 60, 93, 102, 142) to name XS and add S to the line-93 full-tier list; update the shared-band comments (≈lines 43, 122 loop cap; ≈line 193 review model) to include XS, leaving the historical "old caps" note (≈line 120) unchanged (AC-11). No S/M/L/XL value changes. |
| `tests/pipeline-policy.test.ts` | Extend the matrix, routing, budget, and loop-cap tables with XS cases (AC-1…AC-10); flip the `'S non-delicate'` routing case (≈line 45) from `tier:'fast'/planCombined:true` to `tier:'full'/planCombined:false`; rename the `isPlanCombined` test (≈line 212) `only S` → `only XS`; update the band comment (≈line 161) and loop-cap test name (≈line 226) to include XS (AC-12). |
| `tests/run-task-reroute-preflight.test.ts` | Add `'XS'` to the `RerouteStatusOptions.taskSize` helper type (lines 38–40); move the fast-tier reroute test's fixture (line 684) from `taskSize: 'S'` → `'XS'` (AC-12b). No other fixture in this file is tier-dependent. |
| `tests/run-task-safety.test.ts` | Move the two fast-tier spec-gate tests' fixtures (lines 2391, 2445) from `task_size: 'S'` → `'XS'` so they keep exercising the fast-tier spec_review skip (AC-12b). |

**B. Size-selection guidance (inline→XS→S rule) + matrix docs**

| File | Change |
|---|---|
| `.claude/skills/canon-spec/SKILL.md` | Size-assessment list + inline→XS→S decision rule + grill-split shift (AC-13); full-tier membership lines 177/196 gain S (AC-19 Family B); bug-fix rule-of-thumb line 152 `(S)`→`(XS)` (AC-19 Family A). |
| `docs/pipeline-orchestrator.md` | Both tier headers (Fast ≈151 Family A, Full ≈161 Family B), bundle line, sizing-fields table, sizing guide, model/effort matrix, env-var enumerations (≈229/232/243/245), auto-block loop-cap note (≈338), human-gate notes, both reroute lines (full ≈421 Family B, fast ≈431 Family A), and the two `/canon-spec-review` lines — all to the invariant (AC-14). |
| `docs/product-context.md` | Tier glossary row (line 41), Task-size glossary row (line 42), Tiers/Sizes section (lines 90–91) (AC-15). |
| `docs/decisions.md` | Rewrite fast-tier entry (XS, "size it S", membership gains S; AC-16a); add inline→XS→S decision entry (AC-16b). |
| `docs/architecture.md` | Size enum `XS \| S \| M \| L \| XL` (line 106; AC-17). |

**C. Guidance-consistency sweep — remaining surfaces (AC-18 gate / AC-19 worklist)**

| File | Change |
|---|---|
| `.canon/templates/spec.md` | Bug-fix rule-of-thumb parenthetical (line 10) `(S, non-delicate)` → `(XS, non-delicate)` (Family A). |
| `scripts/run-task/prompts/templates/spec.md` | Bug-fix rule-of-thumb (line 16) `(S)` → `(XS)` (Family A; bundles into `dist/` + golden). |
| `scripts/run-task/prompts/templates/spec-revision.md` | Bug-fix rule-of-thumb (line 17) `(S)` → `(XS)` (Family A; bundles into `dist/` + golden). |
| `.claude/skills/canon-spec-review/SKILL.md` | Fast-tier auto-approve layer `(S)` → `(XS)` (lines 3, 17, Family A); full-tier membership `(M/L/XL/delicate)` gains S (lines 3, 16, Family B); `<S/M/L/XL>` report placeholder → `<XS/S/M/L/XL>` (line 102, Family C). |
| `.claude/skills/canon-pipeline/SKILL.md` | Fast-tier state/re-entry notes name XS (lines 55, 158, Family A); full-tier state/re-entry notes gain S (lines 56, 156, Family B). |
| `.claude/skills/canon-inline-review/SKILL.md` | Stop denoting inline/below-pipeline work as "XS" (lines 10, 15 → "trivial"/"below-pipeline"; Family D). |
| `.claude/skills/canon-status/SKILL.md` | Loop-cap default band (line 63 `3 for S/M` → `3 for XS/S/M`; Family C). |
| `scripts/run-task/cli.ts` | Fast-tier help `(S)` → `(XS)` (lines 118, 153, Family A); full-tier help gains S (lines 118, 152, Family B). |
| `src/cli/index.ts` | Reroute help: fast-tier `(S)` → `(XS)` (line 95, Family A); full-tier `(M/L/XL or delicate)` gains S (line 94, Family B). |
| `README.md` | Fast-tier bullet "Fast tier (small tasks)" → name XS (line 62, precision); reroute line `fast-tier tasks (S)` → `(XS)` + full-tier `(M/L/XL or delicate)` gains S (line 73, Families A+B); stop calling inline work "XS" (lines 126, 155, Family D). |

**D. Generated / mirror (not hand-edited; produced by build/golden/sync — listed for the `--pr` base-drift allowlist)**

| File | Change |
|---|---|
| `dist/` | Rebuilt via `npm run build` (AC-20); directory-form entry matches the regenerated `dist/cli/index.js` + `dist/scripts/run-task.js`. |
| `tests/run-task-prompts.golden.json` | Regenerated via `UPDATE_GOLDENS=1 npm test` after the runtime-prompt edits (AC-21). |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror of the only edited `docs/` file in `CANON_OWNED` (AC-22). |
| `templates/.canon/templates/spec.md` | Auto-synced mirror (AC-22). |
| `templates/.claude/skills/canon-spec/SKILL.md` | Auto-synced mirror of the edited skill (AC-22). |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Auto-synced mirror of the edited skill (AC-22). |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Auto-synced mirror of the edited skill (AC-22). |
| `templates/.claude/skills/canon-inline-review/SKILL.md` | Auto-synced mirror of the edited skill (AC-22). |
| `templates/.claude/skills/canon-status/SKILL.md` | Auto-synced mirror of the edited skill (AC-22). |

> **Not synced**: editing `docs/product-context.md`, `docs/decisions.md`, `docs/architecture.md` does **not** touch `templates/docs/{product-context,decisions,architecture}.md` — those docs are not in `CANON_OWNED`, their `templates/` snapshots are unmanaged and unchanged by this task, and they will not appear in the diff.
> **Not edited** (historical/planning records, excluded from AC-18): `CHANGELOG.md`, `docs/lessons-learned.md`, `docs/BACKLOG.md`.

### Interaction Dependencies

- `scripts/run-task/types.ts` imports `TaskSize` from `pipeline-policy.ts`; widening the union is source-compatible (no edit needed, but it recompiles).
- The orchestrator reads `planCombined`/`tier` from `getPipelinePolicy` and `isPlanCombined` per-task — both updated here. No orchestrator logic changes; it consumes the policy's outputs.
- `status.json.task_size` is typed `TaskSize?`; existing tasks with `S`/`M`/etc. are unaffected. A task may now be authored with `"XS"`.

### Data Model Changes

`TaskSize` union gains the member `'XS'`. This is additive and backward-compatible — no existing `status.json` value becomes invalid, and there is no runtime validator that would reject the new member. No schema migration required.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite (the table-driven `pipeline-policy.test.ts` is the primary policy gate)
- [x] `npm run build` — `pipeline-policy.ts` + CLI compile into `dist/`; commit `dist/` and confirm `git diff --exit-code dist/` is clean
- [x] `UPDATE_GOLDENS=1 npm test` — regenerate `tests/run-task-prompts.golden.json` after the runtime-prompt edits; commit it; plain `npm test` then passes
- [x] `npm run sync-templates` + `npm run sync-templates:check` — regenerate and verify the `templates/` mirrors of edited `CANON_OWNED` files
- [x] Docs references (`npm run docs-refs-check` per `docs/architecture.md` §Validation) — several docs edited
- [x] Guidance-consistency gate (AC-18) — the Family A / B / D `rg` sweeps return zero matches on live surfaces; Family C verified by the positive size-enum ACs

## Docs Impact

- `docs/product-context.md`, `docs/decisions.md`, `docs/architecture.md` are **changed** by this task (see Affected Files) — not merely at risk of staleness.
- `docs/pipeline-orchestrator.md` is changed (tier defs, sizing fields/guide, model/effort matrix, env vars, human-gate notes, reroute, skill refs).
- `docs/codebase-map.md`, `docs/patterns.md` — no change expected.

## Known Risks

- **The sweep is a four-family, repo-wide change — scope is the main risk.** Rounds 1–4 each surfaced a *new* label family rather than a missed instance of one family (scope-expansion); the round-5 redesign answered that by (a) sweeping the whole repo structurally up front, (b) framing AC-18 as an invariant + per-family gate rather than a hand-enumerated list, and (c) keeping AC-19 as a complete-but-subordinate worklist. **Round 6 was the opposite shape — one missed *instance* of Family A** (the `**Fast tier** (all tasks S, non-delicate)` header at `docs/pipeline-orchestrator.md:151`, plus the analogous `S, non-delicate tasks re-enter` and `` `S` non-delicate `` phrasings), because Family A's gate was still a list of literal `(S…)` shapes. This revision closes that by replacing the brittle shape-list with a word-bounded **invariant** pattern (`\bS…non-delicate`) that catches every separator variant and cannot match the post-change `XS`, with `tests/pipeline-policy.test.ts` excluded from that family only (its `S non-delicate` fixtures describe a still-existing S task, not stale guidance). The same completeness pass found and folded in Family C's shared-band siblings (the `S/M`/`S/M/L` env-var, loop-cap, and review-model bands XS now joins, since XS clones S's values), excluding only historical/telemetry records. The residual risk is a surface in a phrasing none of the gates anticipate; the positive doc ACs (AC-13…AC-17) and Codex `spec_review` are the backstop. The policy change and the sweep are inseparable (shipping one without the other ships self-contradicting guidance), so they stay one task — see *Problem*.
- **Family D is a true terminology collision, not a stale label.** `README.md` and `canon-inline-review` currently use "XS" to mean inline/too-small-for-a-task; the new formal XS is the opposite (the smallest *pipeline* task). If the sweep misses these, the repo ships a doc that calls the same term two contradictory things. Rephrase inline usages to "trivial"/"below-pipeline"; the legitimate new "XS = fast tier" mentions (e.g. `README.md:62`) stay.
- **Family B gate needs a lookbehind.** The fixed form `S/M/L/XL` contains the old `M/L/XL` as a substring, so a naive "stale string absent" grep can never pass. AC-18's Family-B gate uses `rg -P` with `(?<!S/)` / `(?<!S, )`. Family C can't be zero-gated at all (the fixed enum contains the old one) — it is verified positively per surface. A reviewer that expects a single flat "the string is gone" gate will mis-read this; the asymmetry is intentional and documented in AC-18.
- **`sync-templates` covers only `CANON_OWNED`.** Round-4 `spec_review` correctly caught that an earlier revision claimed `sync-templates` regenerates `templates/docs/{product-context,decisions,architecture}.md`; it does not (those docs aren't in `CANON_OWNED`). AC-22 and the mirror table now reflect that only `docs/pipeline-orchestrator.md` (plus the edited `.canon/templates/spec.md` and four skills) has an auto-synced mirror.
- **Missing an XS matrix cell.** Mitigated by the type system: `BUDGET_BY_SIZE` and every `claudeMatrix`/`codexMatrix` table are `Record<TaskSize, …>`, so omitting XS anywhere is a compile error (`npm run type-check`). The two places *not* caught by exhaustiveness are `defaultMaxReviewLoops` (a conditional, AC-4) and `maxSize`'s seed value (AC-9) — both have dedicated ACs.
- **The second routing surface.** `isPlanCombined` (AC-8) is keyed on the size string independently of `detectTier`. Flipping only `detectTier` would leave per-task plan-collapse logic wrong for XS/S. Both are required ACs.
- **`maxSize` floor bug (AC-9).** `maxSize` starts its accumulator at `'S'` and only climbs via `SIZE_ORDER.indexOf`. With XS prepended at index 0, an all-XS bundle would never climb above the `'S'` seed and would mis-report nominal/effective size as `S`. Because XS clones S's values, budget/loops/matrix would be *coincidentally* correct, but `getNominalSize`/`getEffectiveSize` would lie and the SIZE_ORDER semantics would break. Seed must move to the floor.
- **Not every `task_size: 'S'` test fixture is tier-dependent (AC-12b).** Flipping S to full tier breaks only the fixtures whose *assertions* encode the fast-tier contract (spec_review skipped, plan combined, fast-tier reroute) — three fixtures across `run-task-reroute-preflight.test.ts` and `run-task-safety.test.ts`, plus the reroute helper type. The other six `task_size: 'S'` fixtures (canon-snapshot, validation ×2, counter-schema, prompts, ship, task-cli) use S only as an arbitrary valid size and would pass at either tier; changing them is needless churn and risks altering what they actually test. AC-12b enumerates both the change-set and the leave-alone set explicitly, and `npm test` (AC-23) is the backstop that catches any misclassification in either direction. One subtle case verified: the prompt golden's `full / S` line comes from an explicit `tier: 'full'` override in `makeTask`, not policy, so it is unaffected by S's tier flip.
- **S behavior change is intended, not a regression.** Existing S tasks now incur `spec_review` + a separate plan on next run. This is the whole point; called out in Non-Goals so review doesn't flag it as drift.
- **`--pr` base-drift on the `templates/` mirrors.** The five mirror files in table D are declared in Affected Files specifically because the base-drift gate auto-allowlists managed-doc *roots* post-QA but not their `templates/` mirrors. They are regenerated by `npm run sync-templates`, never hand-edited.
- **Golden drift.** Editing the runtime prompt templates changes the bundled prompt text; the prompt golden (`tests/run-task-prompts.golden.json`) must be regenerated (AC-21) or `npm test` fails. Because the golden is *not* gate-excluded in AC-18, a forgotten regen also trips the Family-A grep — a deliberate double-check.

## Human Test Plan

1. Create a new task and set its size to the new smallest size ("XS"). Run it through the pipeline.
2. Expected: the task runs the fast path — spec and plan happen together, and the Codex spec-review step is skipped — exactly like the smallest tasks did before this change.
3. Create a task at the next size up ("S") and run it.
4. Expected: unlike before, the S task now gets a separate plan and a Codex spec-review pass — the same review treatment the larger sizes get — but still at the lighter effort level (it should not feel as heavy or slow as a default "M" task).
5. Open the size guidance in the spec authoring skill and the pipeline orchestrator doc.
6. Expected: there is clear advice on when to pick "XS" versus just doing the change inline, and when to step up to "S" — framed around whether the spec has anything worth reviewing. No surface should still say the smallest pipeline tier is "S," and nothing should describe "XS" as work too small to be a task.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier: delicate); ACs name real symbols (`detectTier`, `isPlanCombined`, `maxSize`, `SIZE_ORDER`, `BUDGET_BY_SIZE`, `defaultMaxReviewLoops`, `codexMatrix`, `claudeMatrix`), grep-verified against `scripts/pipeline-policy.ts`
- [x] Known Risks covers failure modes for the trickiest ACs (the four-family scope, the lookbehind/positive gate asymmetry, the two routing surfaces, the maxSize floor, the sync-set boundary)
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has entries marked `- [x]`
- [x] (Bug/flake fixes; N/A for features/refactors) — N/A: this is a policy/feature change, not a bug fix; verification is the table-driven test suite extended with XS cases (AC-12) plus the structural guidance gate (AC-18)
