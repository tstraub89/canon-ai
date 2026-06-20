# Code Review: vacate-adopter-md

> Reviewer: Claude | Spec: `tasks/vacate-adopter-md/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [ ] Validation Outcomes table has no `Fail` results — **FALSE.** The table reports `npm run docs-refs-check` = Pass ("All refs OK") and `npm test` = Pass ("873 pass"). Re-run against the current tree: `docs-refs-check` **exits 1** with 2 broken refs, and `npm test` fails (the `run-task-safety` `--pr`/full-send tests abort on the docs-refs gate). The table is inaccurate. See CB-1.
- [x] All checks required by the spec's "Validation Required" section were run
- [ ] No required checks were skipped without justification — checks were run but their reported outcomes do not reflect the final tree state.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 — `DELIMITED` no longer manages the two files | Pass | `src/lib/canon-owned.ts:28` `DELIMITED = [] as const`; grep shows no `AGENTS.md`/`CLAUDE.md` membership. |
| AC-2 — Delimited machinery retained and functional | Pass | `mergeDelimited` + `CANON_START_RE`/`CANON_END` retained (now exported, `upgrade.ts:20-21,31-44`); delimited loop retained as a no-op (`upgrade.ts:209+`), loop var widened to `readonly string[]`. Fixture tests for `mergeDelimited` / `mergeDelimitedForSync` retained and pass. |
| AC-3 — A file re-addable to `DELIMITED` with no code change | Pass (with caveat) | Machinery retained per AC-2. **Caveat:** the delimited canon-internal-leak guard + marker validation in `sync-canon-templates.mjs` now have zero reachable test coverage (their tests were removed because `DELIMITED_SYNC` is empty). Re-adding a future file would inherit an unguarded leak scan. Not blocking — see RG-1. |
| AC-4 — Template files deleted | Pass | [templates/CLAUDE.md](templates/CLAUDE.md) + [templates/AGENTS.md](templates/AGENTS.md) deleted; no `src/` path reads them by name. |
| AC-5 — `canon init` adds neither file | Pass | `tests/cli.test.ts` asserts a real-template `init` creates neither file. |
| AC-6 — `init` detects existing agent files without promising a merge protocol | Pass | `hasExistingAgentFiles()` uses direct `existsSync` (`init.ts`); grill note rewritten; `git grep -ni 'merge protocol' src/cli/commands/init.ts` empty; tests cover present/absent and assert the note lacks "merge protocol". |
| AC-7 — `canon upgrade` leaves the files byte-identical | Pass | `tests/cli.test.ts` asserts both files unchanged after upgrade with arbitrary content. |
| AC-8 — Migration tool contract | Pass (with low nit) | `tools/strip-canon-block.mjs` implements strip/no-op/partial-marker/dirty-tree-refusal/`--check`-reports-regardless/idempotent; tests cover all enumerated branches. Hardening gap (fail-open git guard) noted as CB-3. |
| AC-9 — Migration tool does not ship | Pass | `package.json` `files` has no `tools/` entry; tarball excludes the tool. |
| AC-10 — canon-ai's own files have no markers and are slimmed; must-survive content retained | **Fail** | Markers gone, files materially slimmed (good). But of the four named must-survive norms, **two are absent with no surviving home** ("default toward smaller models / lower effort"; "don't intervene in full-tier `spec_review` auto-revision") and one is only weakly present ("ask before committing" → reduced to "inspect staged/dirty state before commits", `CLAUDE.md` §Pull Requests). Only "never self-review inline work" (`CLAUDE.md:58`) fully survives. See CB-2. |
| AC-11 — No operator rule orphaned by the slim | **Partial** | `docs/codebase-map.md` cross-refs repointed correctly (`:165`, `:180`, `:192-193`); most mapping rows verified (spec-authorship → `canon-spec/SKILL.md`; Implementation Rules/Validation Matrix → `implement.md:20-51`; code-review → `code-review-anchored.md`). **But** the two AC-10 norms above are genuinely orphaned: `git grep` finds no home for "smaller model / lower effort" or the spec_review-auto-revision rule anywhere under `scripts/run-task/prompts/` or `.claude/`. Couples to CB-2. (The "Human Escalation Contract → implement.md" row is Task A's territory and out of scope here; not assessed.) |
| AC-12 — N5 resolved | Pass | `qa.md:46` now reads `patterns.md / decisions.md`; golden regenerated. |
| AC-13 — Stale managed/scaffolded/delimited refs swept | Pass | Sweep grep returns only corrected negative-assertion lines (e.g. README "does not scaffold", decisions.md "not members of CANON_OWNED or DELIMITED"). No merge-protocol/`canon:end` framing survives in skills/docs. |
| AC-14 — README updated | Pass | Adopter-owned statement + corrected `canon upgrade` description + no-self-review recommended-practice note all present. |
| AC-15 — `docs/decisions.md` updated | Pass | New end-state entry added; stale "delimited AGENTS.md/CLAUDE.md" (`:159`) and guidance-docs list (`:133`) corrected. |
| AC-16 — `canon doctor` stops enforcing the two files | Pass | `checkAgentFile` + its two calls deleted from `doctor.ts`; `git grep checkAgentFile src` empty; test asserts the discovery nudge warns (not fails) on absent files. |
| AC-17 — CI git-install smoke updated | Pass (CI not run locally) | `ci.yml` drops the two `test -f` asserts, retains `canon doctor`. Remote CI not runnable from this session; local `canon doctor` passes with both files absent (enabled by AC-16). CI on the task branch is the runtime check. |
| AC-18 — Build, golden, full validation clean | **Fail** | `dist/` rebuilt cleanly (no unrelated drift), golden regenerated, lint / type-check / `sync-templates:check` pass. **But `npm run docs-refs-check` exits 1 and `npm test` fails** against the current tree — root cause CB-1. AC-18 requires all of these green. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — the `templates/docs/*` mirror edits are correctly-synced root→mirror reflections, not scope creep (`sync-templates:check` passes).
- [x] Known Risks addressed or documented as accepted
- [ ] Human Test Plan is satisfiable by the implementation — **Item 5 fails:** a read-through of the slimmed files will *not* find "prefer smaller models" or the "don't intervene in spec_review auto-revision" habit, which item 5 explicitly asks the human to confirm are present. Tied to CB-2.

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

> Stage 1 fails on three gates: the inaccurate Validation Outcomes table (CB-1, also breaks AC-18), the AC-10 must-survive contract (CB-2), and the coupled AC-11 orphan. Stage 2 quality findings are recorded below for efficiency (they were already gathered by both lenses and are cheap for Codex to fix in the same round) but the verdict is driven by Stage 1.

## Stage 2 — Findings (recorded for the re-implementation round)

### Summary

The mechanical core of the task is sound: `DELIMITED` is emptied with the machinery intact, templates deleted, `canon init`/`upgrade`/`doctor`/CI re-scoped, the migration tool implemented to contract, the AC-13 sweep clean, and dist/golden rebuilt cleanly. Test deletions (~185 lines in `cli.test.ts`, ~255 in `sync-canon-templates.test.ts`) are legitimate removals of tests for now-deleted code, replaced with positive assertions — not coverage dropped to pass. Three things block: a self-referential handoff-artifact ref that breaks docs-refs-check (and thus the full suite), the under-delivery of AC-10's must-survive operator norms, and a low-severity fail-open in the migration tool's dirty-tree guard.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped. Each is `code-bug`.

- **CB-1 — `handoff.md:71` cites deleted templates with backticks → docs-refs-check fails → 6 test failures.** `[code-bug]` `tasks/vacate-adopter-md/handoff.md:71`. The AC-4 row writes [templates/AGENTS.md](templates/AGENTS.md) and [templates/CLAUDE.md](templates/CLAUDE.md) in **backticks**; `docs-refs-check` treats backtick path-refs in `handoff.md` as live citations and both files are deleted → `Found 2 broken refs`, exit 1 (verified by re-running `npm run docs-refs-check`). This cascades into the `run-task-safety` `--pr`/full-send tests, which abort on the docs-refs gate — accounting for the `npm test` failures the handoff's table reports as Pass. The Changes table at `handoff.md:31-32` already uses the correct markdown-link form for these same files; line 71 missed the pattern. **Fix:** rewrite the two refs on line 71 as `[templates/AGENTS.md](templates/AGENTS.md)` / `[templates/CLAUDE.md](templates/CLAUDE.md)` (matching lines 31-32), then re-run `npm run docs-refs-check` and `npm test` and correct the Validation Outcomes table to reflect the real results. (Flagged by anchored lens; foreman-verified.)

- **CB-2 — AC-10 must-survive operator norms missing from the slimmed files (and orphaned per AC-11).** `[code-bug]` `CLAUDE.md` / `AGENTS.md`. The spec Design "Must survive" contract names four always-on norms. Verified state after the slim:
  - "never self-review inline work" — **present** (`CLAUDE.md:58`). ✓
  - "ask before committing" — **only weakly present**: reduced to "inspect staged/dirty state before commits" (`CLAUDE.md` §Pull Requests). That is staging hygiene, not the explicit ask-consent norm.
  - "default toward smaller models / lower effort" — **absent.** `git grep` finds no home in `CLAUDE.md`, `AGENTS.md`, `scripts/run-task/prompts/`, or `.claude/`.
  - "don't intervene in full-tier `spec_review` auto-revision" — **absent.** No home anywhere.

  Honest context for Codex: three of these four were also **not present verbatim in the pre-slim `main` files** (verified via `git show main:CLAUDE.md`/`AGENTS.md`), so this is an under-delivery of the spec's positive contract, not a regression of pre-existing text. But AC-10 ("still contain the must-survive content"), AC-11 (no orphaned rule), and Human Test Plan item 5 all require these norms to be present in the slimmed operator files, and the implementer can satisfy them with a few short lines. **Fix:** add the two fully-absent norms (and tighten "ask before committing" to explicit consent) to `CLAUDE.md`'s always-on operator context — e.g. alongside the existing §Cross-Review / §Pull Requests / Quick refs. These are 1-2 lines each. (Flagged by anchored lens; foreman-verified the orphan via grep.)

- **CB-3 — Migration tool's dirty-tree guard fails open on git error.** `[code-bug]` (low severity) `tools/strip-canon-block.mjs:33`. `isGitTreeDirty` returns `false` ("clean, safe to write") whenever the `git status` subprocess exits non-zero or errors (`if (result.status !== 0 || result.error) return false`). If git is unavailable or the cwd is not a git repo, the AC-8(c) write guard is silently bypassed and the tool overwrites `CLAUDE.md`/`AGENTS.md` with no safety net — the opposite of the guard's intent. Blast radius is low (the tool is non-shipped and targets a finite set of known git repos), so this does not independently drive the verdict, but fail-closed is the correct contract and a one-line change. **Fix:** treat a git failure as dirty/unknown and refuse the write (or print a clear error and exit non-zero). Add a test for the non-repo / git-unavailable path. (Flagged by cold lens.)

#### Risk / Guardrails

- **RG-1 — Delimited leak-guard + marker-validation now unreachable from tests.** `[code-bug-adjacent / accept-or-note]` `scripts/sync-canon-templates.mjs`. With `DELIMITED_SYNC` empty, the `findCanonInternalRefsInDelimitedRegion`/`...InDelimitedTail` leak scan and the delimited marker validation in `findSyncErrors` no longer run via the public entry point, and the tests exercising them were removed. The machinery is retained (AC-2 satisfied) but is now untested, weakening AC-3's "re-addable with no code change" safety net. This is inherent to vacating the list (the functions are private and the loop is empty), so it is not implementer negligence. **Suggested:** either add a thin direct unit test over the still-importable helpers, or accept it explicitly with a one-line note in the handoff. Not blocking on its own. (Flagged by anchored lens.)

#### Optional Cleanup / Nit

- **N1 — `strip-canon-block.mjs` emits two messages on a successful write.** `tools/strip-canon-block.mjs:66,96,111`. A `changed` result's message is `"<file>: would strip canon block"` (printed in the report loop), then `"<file>: stripped canon block"` is printed after the write — so a real write logs both "would strip" and "stripped". Cosmetic. Consider suppressing the "would" line in write mode.
- **N2 — Dead defensive branch.** `tools/strip-canon-block.mjs:63-65`: once both markers are present and ordered, the slice always changes the string, so the `nextContent === content` re-check is unreachable. Harmless.
- **N3 — Multi-block / interleaved-marker edge cases.** `tools/strip-canon-block.mjs:43-57` strips only the first block and a `start … end … start` interleaving would orphan a trailing `start`. Acceptable for the single-block legacy files in scope; out of scope to fully guard, but worth a comment noting the single-block assumption.
- **N4 — strip-canon-block tests don't dirty the strip *target* itself.** `tests/strip-canon-block.test.ts` dirties `README.md` (a non-target) for the dirty-tree refusal test; the realistic scenario (adopter has hand-edited `CLAUDE.md`) is not exercised. Guard is whole-tree so behavior is correct; coverage is just narrower than the real case.

#### Spec Gaps

(none — CB-2's root cause is an implementation under-delivery against a well-specified contract, fixable by the implementer without a spec change, so it is a code-bug rather than a spec_gap.)

### Dismissed Cold Findings

> Cold-lens findings dropped because the spec shows the behavior is intended.

- Dismissed (cold): "Dead delimited loop / unreachable `mergeDelimited` + leaked `CANON_END`/`CANON_START_RE` exports in `upgrade.ts`" — **intended.** AC-2/AC-3 (and Non-Goals) explicitly require the machinery to be retained as a no-op for a future re-add, and AC-2 permits exporting the marker constants for the migration tool.
- Dismissed (cold): "`init.ts` existing-file detection semantic shift (`skipped.some` → `existsSync`)" — **intended.** Plan Step 3 / AC-6 require this rewire precisely because the deleted templates would never appear in `skipped` again.
- Dismissed (cold): "Two `test -f` lines removed from `ci.yml`" — **intended.** AC-17 requires removing them; the surrounding smoke block stays internally consistent.
- Dismissed (cold): "Large test deletions (~185 / ~255 lines)" — **intended and verified legitimate.** AC-16 + plan nit-2 require removing the `checkAgentFile` tests and the stale delimited `runUpgrade`/sync tests; they are replaced with positive tests for the new behavior. Not coverage-dropped-to-pass.
- Dismissed (cold): "dist artifacts changed" — **informational, no finding.** The dist diff is consistent with the source changes (`checkAgentFile` removed, `hasExistingAgentFiles` added, `DELIMITED = []`, de-suffixed marker constants, qa.md prompt string edit); no unrelated drift.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

**Must fix before re-review:** CB-1 (handoff ref → docs-refs/test failures, also clears AC-18), CB-2 (AC-10/AC-11 must-survive norms). **Should fix while in there:** CB-3 (fail-open guard), RG-1 (accept or add a thin test). N1-N4 are optional.

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

## Round 2 — verifying iteration 2's response to round 1

Iteration 2 (`handoff.md` §"Iteration 2 — addressing review round 1") targeted the three Round 1 code-bugs. All three are genuinely fixed (foreman-verified, not papered over); the anchored lens re-ran the full AC table and the gate now passes. The cold lens raised a new high-severity CHANGELOG finding that is a **base-drift false positive** (dismissed — see below).

### Stage 1 — Acceptance Criteria Re-Check

- [x] Validation Outcomes / Iteration-2 Re-run tables have no `Fail` and now match the tree — foreman re-ran `npm run docs-refs-check` → `All refs OK`; anchored lens re-ran `npm test` → all pass.
- [x] All required checks were run; reported outcomes now reflect the final tree state.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged) | `src/lib/canon-owned.ts:28` `DELIMITED = [] as const`. |
| AC-2 | Met (unchanged) | `mergeDelimited` + exported `CANON_START_RE`/`CANON_END` (`upgrade.ts:20-21,31`); delimited loop retained as no-op. Fixture merge tests pass. |
| AC-3 | Met (unchanged) | Machinery retained; RG-1 residual (private leak/marker validators untested while `DELIMITED` empty) carried forward, accepted by implementer. |
| AC-4 | Met (unchanged) | [templates/AGENTS.md](templates/AGENTS.md) + [templates/CLAUDE.md](templates/CLAUDE.md) deleted; no `src/` path reads them. |
| AC-5 | Met (unchanged) | `tests/cli.test.ts` asserts `init` creates neither file. |
| AC-6 | Met (unchanged) | `hasExistingAgentFiles()` direct `existsSync`; grill note carries no "merge protocol"; present/absent tests. |
| AC-7 | Met (unchanged) | `tests/cli.test.ts` asserts both files byte-identical after upgrade. |
| AC-8 | **Met (CB-3 fixed)** | `tools/strip-canon-block.mjs:33` `isGitTreeDirty` now `return true` on git error/non-repo (fails closed); `--check` still returns before the guard (`main():102`) so it reports regardless of tree. New test exercises the git-unavailable write-refusal with a real assertion. |
| AC-9 | Met (unchanged) | `package.json` `files` has no `tools/` entry. |
| AC-10 | **Met (CB-2 fixed)** | New `## Always-On Operator Norms` (`CLAUDE.md:20-23`) carries all four must-survive norms explicitly; markers gone; CLAUDE.md still materially smaller (~89 vs 227 lines). |
| AC-11 | **Met (orphan closed)** | The two previously-orphaned norms (smaller-model default `CLAUDE.md:21`; spec_review non-intervention `CLAUDE.md:22`) now have their surviving home in `CLAUDE.md` — the spec Design names CLAUDE.md as the home for always-on norms no skill re-states. Codebase-map cross-refs still repointed. |
| AC-12 | Met (unchanged) | `qa.md:46` reads `patterns.md / decisions.md`; golden regenerated. |
| AC-13 | **Met (re-swept clean)** | Sweep grep returns only corrected negative-assertion lines; the iteration-2 CLAUDE.md additions reintroduced no stale managed/delimited framing. |
| AC-14 | Met (unchanged) | README adopter-owned + corrected `upgrade` desc + no-self-review note. |
| AC-15 | Met (unchanged) | decisions.md end-state entry + corrected stale refs. |
| AC-16 | Met (unchanged) | `checkAgentFile` gone from src/dist/tests; discovery nudge warns (not fails). |
| AC-17 | Met (CI is runtime check) | `ci.yml` drops the two `test -f` asserts, retains `canon doctor`. |
| AC-18 | **Met (CB-1 fixed)** | `docs-refs-check` → `All refs OK` (foreman-verified); full `npm test` passes; no artifact cites a deleted file in backticks. |

### Verifying Round 1 findings

- _correctness bug CB-1_ (handoff backtick refs → docs-refs-check fail → cascading test failures) → **addressed** ✓. `handoff.md:71` now uses markdown-link form `[templates/AGENTS.md](templates/AGENTS.md)` matching lines 31-32; the review-artifact citations were patched to the same form. `npm run docs-refs-check` re-run by foreman → `All refs OK`. AC-18 now Met.
- _correctness bug CB-2_ (AC-10 must-survive norms missing/orphaned) → **addressed** ✓. `CLAUDE.md:20-23` adds the four norms explicitly: (a) ask before committing, (b) smallest model / lowest reasoning effort, (c) don't intervene in full-tier `spec_review` auto-revision, (d) never self-review inline work. AC-10 + AC-11 now Met; Human Test Plan item 5 now satisfiable.
- _correctness bug CB-3_ (migration-tool dirty-tree guard failed open on git error) → **addressed** ✓. `tools/strip-canon-block.mjs:33` now fails closed (`return true` on `result.status !== 0 || result.error`); new `tests/strip-canon-block.test.ts` case runs the tool in a non-git temp dir and asserts non-zero exit + file preserved. The `--check`-reports-regardless behavior is preserved (guard gates writes only).
- _risk/guardrail RG-1_ (delimited leak-guard/marker-validation untested while `DELIMITED` empty) → **accepted as known residual** (unchanged from Round 1 disposition). Implementer recorded it in the handoff with a note to add direct tests / a test seam when a future file re-enters `DELIMITED`. Not blocking.
- _nits N1-N4_ → not addressed, deferred as cosmetic/out-of-scope. Acceptable.

### New findings (only NEW issues introduced by iteration 2's changes)

(none — iteration 2 added four norm lines to `CLAUDE.md`, a fail-closed guard line + test to the migration tool, and fixed artifact citations. No new code-bug or spec-gap introduced. AC-13 re-swept clean confirms the CLAUDE.md additions did not reintroduce stale framing.)

### Optional Cleanup / Nit (non-blocking, carried or minor)

- **N5 — `handoff.md:169` test-count drift.** Iteration-2 Re-run table says "874 pass, 1 skipped"; the foreman/anchored independent runs report all-pass with the previously-skipped test running. Discrepancy is in the safe direction (zero failures either way). Cosmetic.
- **N1-N3 (carried from Round 1)** — `strip-canon-block.mjs`: writes an untracked target without recovery path (the dirty guard ignores `??` lines); dead `nextContent === content` branch (`:63-65`); first-occurrence-only block handling. All low-severity edge cases on a non-shipped one-off tool with a single-block contract; non-blocking.

### Dismissed Cold Findings

- **Dismissed (cold): "CHANGELOG.md `[Unreleased]` section wiped — 5 staged entries deleted with no replacement" (claimed high)** — **base-drift false positive.** The cold lens ran a two-dot `git diff main`; `main` advanced from this task's merge-base (`b8d0279`) to `b6fc2ae`, which is where those `[Unreleased]` entries were added *after* the task branched. The three-dot `git diff main...HEAD -- CHANGELOG.md` is **empty** and `git log main..HEAD -- CHANGELOG.md` shows **no** task commit touched CHANGELOG.md. The task did not change CHANGELOG (correct — spec Non-Goals: "No version bump or CHANGELOG version line; QA proposes entry text only"). Foreman-verified.
- **Dismissed (cold): "migration tool orphaned/unwired — only its own test invokes it" (med)** — intended. Spec AC-9 + Non-Goals require the tool to be **non-shipped** (`tools/` excluded from `package.json` `files`) and manually run by the finite set of pre-2.0.0 adopters; it is deliberately not wired into `init`/`upgrade`/CI/docs.
- **Dismissed (cold): "`init.ts:104` 'Existing files (will be merged during grill):' header contradicts the no-merge model" (low)** — the header prints for the `skipped` scaffold set only. With [templates/AGENTS.md](templates/AGENTS.md)/[templates/CLAUDE.md](templates/CLAUDE.md) deleted, the agent files can never enter `skipped` (detection was rewired to `existsSync`; AC-5/AC-6), so this header never fires for them. AC-6's no-merge requirement targets the agent-file grill note, which was correctly rewritten. The header applies to docs scaffold files, which the grill does fill — out of scope here.
- **Dismissed (cold): "guard refuses outside a git repo, diverging from BACKLOG's deprecate-in-place design" (low)** — the refuse-on-unknown (fail-closed) behavior is exactly the CB-3 fix this round and the safe choice; it does not risk overwriting a file in an unknown git state.
- **Dismissed (cold): dead delimited loop / empty-`DELIMITED` type widening / test deletions / dist+CI consistency** — all intended (AC-2/AC-3 retain machinery as a dormant no-op; test deletions are legitimate removal of tests-for-deleted-code with real replacements; dist/CI consistent), same dispositions as Round 1.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> All three Round 1 code-bugs fixed and verified; no new code-bugs or spec-gaps. The cold lens's high-severity CHANGELOG finding is a verified base-drift artifact (task never touched CHANGELOG). Remaining items (N1-N3, N5) are optional low-severity cleanup on a non-shipped tool and an artifact wording drift — none block. Ship-able; nits optional.

## Round 3 — post-reroute re-review (reroute #1 amendment)

This is the first code review after **reroute #1**. Round 2 had reached `approved_with_nits`; the human then directed an amendment (spec `## Amendment`) that the reroute carried through `spec_review → plan → implement`. The amendment **delta** (the only new work since the Round 2 approval): drop the `AGENTS.md`/`CLAUDE.md` read-instructions from the pipeline prompt helpers (`scripts/run-task/prompts/helpers.ts`), add `docs/lessons-learned.md` to canon-ai's own `CLAUDE.md` conversational reading list, regenerate the prompt golden, rebuild `dist/`. `handoff.md` is a complete rewrite covering all original ACs (AC-1..18) plus the amendment ACs (AC-A1..A4).

Both lenses ran on the clean three-dot merge-base diff (`8c1d2ab...HEAD`), so the Round 2 base-drift CHANGELOG artifact does not recur. **Anchored lens signal: approve** (Stage 1 pass, full AC table Met, independently re-ran validation → 877 pass). **Cold lens signal: changes_requested** — adjudicated below; every driving finding resolves to intended-per-spec or non-blocking. Foreman independently re-ran the gate (`docs-refs-check` → `All refs OK`; `sync-templates:check` → in sync) and verified the amendment + carried-fix surfaces by grep/read.

### Stage 1 — Acceptance Criteria Re-Check

- [x] Validation Outcomes reflect the final tree — foreman re-ran `npm run docs-refs-check` → `All refs OK`, `npm run sync-templates:check` → in sync; anchored lens re-ran full `npm test` → all pass. (Handoff table says "876 pass, 1 skipped"; live runs report all-pass — safe-direction drift only, see N6.)
- [x] All required checks were run; reported outcomes match the final tree.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged) | `src/lib/canon-owned.ts:28` `DELIMITED = [] as const`; no root-agent-file membership. |
| AC-2 | Met (unchanged) | `mergeDelimited` + exported `CANON_START_RE`/`CANON_END` (`upgrade.ts`); delimited loop retained as no-op; fixture merge tests pass. |
| AC-3 | Met (unchanged) | Machinery retained; RG-1 residual (private leak/marker validators untested while `DELIMITED` empty) carried forward, accepted. |
| AC-4 | Met (unchanged) | [templates/AGENTS.md](templates/AGENTS.md) + [templates/CLAUDE.md](templates/CLAUDE.md) deleted; no `src/` path reads them. |
| AC-5 | Met (unchanged) | `tests/cli.test.ts` asserts `init` creates neither file. |
| AC-6 | Met (unchanged) | `hasExistingAgentFiles()` direct `existsSync`; grill note carries no "merge protocol"; present/absent tests. Reroute did not touch `init.ts`. |
| AC-7 | Met (unchanged) | `tests/cli.test.ts` asserts both files byte-identical after upgrade. |
| AC-8 | Met (unchanged, CB-3 holds) | `tools/strip-canon-block.mjs:33` fails closed (`return true` on `status!==0||error`); `--check` reports regardless of tree. |
| AC-9 | Met (unchanged) | `package.json` `files` has no `tools/` entry. |
| AC-10 | Met (re-confirmed) | `git grep canon:start\|canon:end CLAUDE.md AGENTS.md` empty; all four must-survive norms present at `CLAUDE.md:20-23`. Reroute touched `CLAUDE.md` (added the lessons-learned reading-list line) but did not disturb the norms block. |
| AC-11 | Met (re-confirmed) | The two previously-orphaned norms still homed at `CLAUDE.md:21-22`; codebase-map cross-refs still repointed. |
| AC-12 | Met (unchanged) | `qa.md:46` reads `patterns.md / decisions.md`; golden regenerated. |
| AC-13 | Met (re-swept clean) | Foreman re-derived the sweep grep → only corrected negative-assertion lines; the amendment's `CLAUDE.md` edit reintroduced no stale managed/delimited framing. |
| AC-14 | Met (unchanged) | README adopter-owned + corrected `upgrade` + no-self-review note. |
| AC-15 | Met (unchanged) | decisions.md end-state entry + corrected stale refs. |
| AC-16 | Met (re-confirmed) | `git grep checkAgentFile src tests dist` empty; discovery nudge warns (not fails). |
| AC-17 | Met (CI is runtime check) | `ci.yml` drops the two `test -f` asserts, retains `canon doctor`. Remote CI not runnable here. |
| AC-18 | Met (re-verified) | dist rebuilt with no unrelated drift; golden regenerated; `docs-refs-check`/`sync-templates:check`/lint/type-check/`npm test` all green. |
| AC-A1 | **Met (new)** | `helpers.ts:5` `CLAUDE_STARTUP` = "Read docs/patterns.md before starting." (no `AGENTS.md`); `:13` `CODEX_STARTUP` = "Read docs/patterns.md and docs/codebase-map.md before starting."; `:49` resumed-session note = "(architecture docs, etc.)" — `AGENTS.md` dropped. Remaining reads name only knowledge-corpus docs. |
| AC-A2 | **Met (new)** | `git grep -nE 'AGENTS\.md\|CLAUDE\.md' -- scripts/run-task/prompts/` returns no matches (foreman-verified). |
| AC-A3 | **Met (new)** | `CLAUDE.md:32` conversational reading list now has "Skim for any work: `docs/lessons-learned.md` (recent distilled memory)". |
| AC-A4 | **Met (new)** | Golden regenerated — `+` side has zero `Read AGENTS.md`, new startup phrasings present, only the startup-constant-bearing prompt rows + qa.md changed (no structural drift); `dist/scripts/run-task.js` rebuilt; build/test/docs-refs/sync-templates green. |

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

### Verifying the reroute delta + carried fixes

- _amendment AC-A1/A2_ (drop agent-file read-instructions from prompt helpers) → **delivered** ✓ (three edits at `helpers.ts:5,13,49`; structural grep empty). Removing the read-instruction left no dangling reference — the surviving startup reads (`docs/patterns.md`, `docs/codebase-map.md`, `docs/lessons-learned.md`, `docs/architecture.md`, `docs/product-context.md`) all name files that still exist; prompt assembly is unaffected.
- _amendment AC-A3_ (`lessons-learned` in CLAUDE.md reading list) → **delivered** ✓ (`CLAUDE.md:32`).
- _amendment AC-A4_ (golden + dist) → **delivered** ✓; golden reflects only the helper + qa.md changes, no unrelated drift (foreman + anchored both confirmed).
- _Round-1 CB-1_ (handoff backtick deleted-template refs → docs-refs fail) → **still fixed** ✓; `grep -nE '`templates/(AGENTS\|CLAUDE)\.md`' handoff.md` returns nothing; `docs-refs-check` → `All refs OK`.
- _Round-1 CB-2_ (must-survive operator norms) → **still present** ✓; all four norms intact at `CLAUDE.md:20-23`; the reroute's CLAUDE.md edit added a reading-list line elsewhere and did not disturb them.
- _Round-1 CB-3_ (fail-closed git guard) → **still present** ✓ (`strip-canon-block.mjs:33`).

### New findings (NEW since the Round 2 approval)

The only new work is the amendment delta, and it is clean — **no new code-bug or spec-gap**. The cold lens (spec-blind, fresh) re-discovered some pre-reroute items at finer granularity; the one substantive item is recorded as a non-blocking nit:

- **N7 — `--apply`/`--stage` exit-1-on-errors lost its only direct CLI test.** `[risk/coverage — non-blocking]` `tests/sync-canon-templates.test.ts`. The original implementation (plan nit-2, already reviewed in Round 2) deleted `applySync CLI exits 1 (not 0) when errors are present`, which triggered the error via a **delimited pair** — a trigger made impossible by empty `DELIMITED`. After the deletion, no remaining test spawns `--apply`/`--stage` and asserts a non-zero exit on errors; all surviving exit-1 tests drive `--check` (`tests/sync-canon-templates.test.ts:265,378`). **Why this does not block:** (a) the production exit logic (`scripts/sync-canon-templates.mjs:449` `return errors.length > 0 ? 1 : 0`) is **completely unchanged** by this task; (b) it structurally mirrors the still-tested `--check` branch (`:433`), both fed by the same `buildSyncPlan().errors`; (c) the deletion is **outside the reroute delta** and was already adjudicated legitimate in Round 2; (d) the load-bearing CI gate (`sync-templates:check`) uses `--check`, which retains coverage. This is coverage *thinning* on unchanged code, not a test-integrity cover-up or a correctness regression. **Recommended (optional):** add one test spawning `--apply` (or `--stage`) against a still-live error class (wholesale-missing or canon-internal-leak fixture) asserting exit 1, to re-pin the fail-closed `--apply` contract (PR #102 P1). Cheap; can be a small follow-up. (Cold lens; foreman-verified the gap and re-classified from the cold lens's `changes_requested` to non-blocking.)

### Dismissed Cold Findings

> Cold-lens findings dropped because the spec shows the behavior is intended, or because they are pre-existing/out-of-scope items already adjudicated.

- **Dismissed (cold): "`strip-canon-block.mjs --check` exits 0 even when a block would be stripped → fail-open if used as a CI gate" (med/med)** — **intended.** Spec AC-8(d) defines `--check`/`--dry-run` as report-only ("report only and write nothing"), not a drift gate; the tool is non-shipped and manually run against a finite set of pre-2.0.0 adopters (AC-9 + Non-Goals). Exit 0 in report mode is the contract. The cold lens itself hedged ("if ever intended as a gate").
- **Dismissed (cold): "migration tool not wired into `package.json` scripts / CI" (low)** — **intended.** AC-9 + Non-Goals require it non-shipped and manually invoked; no automated wiring is in scope.
- **Dismissed (cold): "`init.ts:104` 'Existing files (will be merged during grill):' banner contradicts the no-merge model" (low)** — **out of scope / already dismissed in Round 2.** The banner prints for the `skipped` *scaffold-doc* set; with the agent templates deleted and detection rewired to `existsSync` (AC-5/AC-6), agent files never enter `skipped`, so it never fires for them. AC-6's no-merge requirement targets the agent-file grill note, which was correctly rewritten. The banner string is pre-existing and untouched by this task.
- **Dismissed (cold): "`tests/docs-refs-check.test.ts:308-319` writes a fixture named [templates/AGENTS.md](templates/AGENTS.md) now alluding to a deleted file" (low)** — **non-issue.** The test is pre-existing (not in this diff), self-contained (writes its own temp file), and still passes; it is not a dangling reference. Misleading example name at most; out of this task's scope.
- **Dismissed (cold): "first-canon-block-only handling" / "dead `nextContent === content` guard" (low)** — carried Round-1 nits N3 / N2 on the non-shipped single-block-contract tool; accepted, non-blocking.
- **Dismissed (cold): large test deletions, dead delimited loop, empty-`DELIMITED` type widening, dist/CI consistency** — all intended (AC-2/AC-3 retain machinery as a dormant no-op; deletions are legitimate removal of tests-for-deleted-code; dist/CI consistent with source). Same dispositions as Rounds 1–2.

### Optional Cleanup / Nit (non-blocking, carried)

- **N6 — `handoff.md` test-count drift.** Validation table says "876 pass, 1 skipped"; live foreman/anchored runs report all-pass with the previously-skipped test running. Safe-direction discrepancy (zero failures either way). Cosmetic; same class as Round 2's N5.
- **N1–N4 (carried)** — `strip-canon-block.mjs` cosmetic edge cases (double "would strip"/"stripped" log; first-block-only; dirty-tree test dirties a non-target). Low-severity on a non-shipped one-off tool. Non-blocking.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> The reroute delta (AC-A1..A4) is clean and complete; all three Round-1 code-bugs and the Round-2 fixes survived the reroute; the AC-13 sweep re-derives clean. No surviving code-bug or spec-gap. The cold lens's `changes_requested` signal was driven by findings that are either intended-per-spec (`--check` report-only, non-shipped tool) or pre-existing/out-of-scope; its one substantive item (N7, the `--apply` exit-1 coverage gap) is a narrow coverage thinning on unchanged, already-approved code with equivalent `--check` coverage intact — recommended as an optional follow-up, not a blocker. Bouncing the whole task back through implement for that gap would be disproportionate to its blast radius. Ship-able; nits optional.
