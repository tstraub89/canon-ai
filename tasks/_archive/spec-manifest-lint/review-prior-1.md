# Code Review: spec-manifest-lint

> Reviewer: Claude | Spec: `tasks/spec-manifest-lint/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored Claude (returned, `STAGE_1: pass`, signal `changes_requested`), cold Claude (returned, signal `changes_requested`), cold Codex (pre-obtained, no findings). Reviewed commit `34470c8`.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did the implementer's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (Red-First Evidence row against pre-fix code, a [wrong-premise] Blocker, or the environment-bound escape's outcome)

Both AC-6 red-first cases are recorded against base `a4b4174` with the predicted received values (`['example.ts']`; `['real.ts','old.ts']`). The anchored lens re-ran the full suite in this worktree (1,906 tests, 0 failures, the linked-worktree test ran rather than skipped) and rebuilt `dist/` in a scratch copy (byte-identical); the cold lens independently confirmed the `dist/` rebuild and the parser/validation suites.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Fused cells rejected | Pass | Extra cells with a backticked token fail with section + data-row; prose extras and `\|` pass. Message wording is a Stage 2 risk item (R1). |
| AC-2: Header-less blocks rejected | Pass | Missing separator, blank-split and note-split cases tested. |
| AC-3: Malformed path cells rejected | Pass | All seven listed cells use the parser's own reason; comma siblings and annotated `dist/` pass. |
| AC-4: Ignored headings rejected | Pass | Five failing forms tested; title/prose without a table passes. Substring match has a false-positive edge (R2). |
| AC-5: Duplicate exact heading rejected | Pass | Deviation (rejects even with no table under the duplicate) matches AC-5's unconditional wording. |
| AC-6: Fenced/commented content excluded | Pass | Shared visibility scan; red-first recorded. But the scan over-hides content that is *not* a fence or comment (C2, C3). |
| AC-7: Empty first cell rejected | Pass | Row number correct; empty and prose continuations pass. |
| AC-8: Valid manifests pass, consumers unchanged | Partial | Listed shapes pass and the 127-spec archive differential is clean, but (a) the "this task's own spec" case reads the live task path and breaks once the task is archived (C1), and (b) C2/C3 are parser-output changes beyond AC-6 for inputs that are not fenced or commented. Routed through Stage 2 as code-bugs rather than failing the gate. |
| AC-9: Spec gate hard-fails | Pass | `checkPhaseGate` spec branch lists every issue + fix command; override and `CANON_SKIP_PHASE_GATE` tested. |
| AC-10: Evidence recovery parks | Pass | Returns `advanced:false` with note; mutation evidence shows the throw without the pre-check. |
| AC-11: Plan/implement pre-flights | Pass | Both run before any agent call or in-progress transition, iteration 0, exit 2; `--force` forwarded through main dispatch; bundle siblings linted; active checkout via `taskDirFor`. |
| AC-12: Adopter-safe messages | Pass | Test asserts no forbidden substrings across all kinds and both phases. |
| AC-13: Restatements updated | Pass | `SPEC_MANIFEST_CONTRACT` verbatim on the four carriers and pinned; "not directories" gone from them; spec-review item (3) narrowed with pinned tokens kept; docs/help updated; mirrors and goldens in sync. |
| AC-14: Lessons and backlog | Pass | Lesson removed; BACKLOG (b) split done/open. |
| AC-15: Archive calibration | Pass | Counts and classified samples present; comment-marker false positive fixed. Fused-cell "real loss" classification accepted (GFM splits on unescaped `\|`). |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The wiring is solid: spec gate, evidence recovery, and both phase-entry pre-flights are placed correctly, tested with mutation evidence, and the lint and the scope consumers genuinely share one scan. The problems are concentrated in the new visibility scanner, which now hides more than real fences and comments — producing exactly the silent whole-manifest loss this task exists to prevent, with the lint silent — plus one test that will break `main` after archiving. All three blocking items are small, localized fixes in `src/orchestrator/markdown-table.ts` and `tests/run-task-validation.test.ts`.

### Findings

#### Correctness Bugs

- **C1 — `code-bug` (test integrity) — `tests/run-task-validation.test.ts:4452`.** Flagged by 2 lenses (anchored, cold-Claude). The AC-8 test reads `tasks/spec-manifest-lint/spec.md` from `process.cwd()`. Shipping archives task dirs to `tasks/_archive/<id>/` (see commit `074b369`), after which `readFileSync` throws ENOENT and `npm test` fails on `main`; no other test reads a live task's spec. Fix: inline this spec's Affected Files section (or the whole spec) as a fixture string; don't depend on a mutable task artifact.
- **C2 — `code-bug` — `src/orchestrator/markdown-table.ts:194` (`visibleMarkdownLines` fence opener).** Flagged by 2 lenses (anchored, cold-Claude); foreman-verified by probe. The opener regex accepts a line that starts with an inline code span, e.g. `` ```foo``` is inline ``. CommonMark does not treat that as a fence (a backtick fence's info string cannot contain backticks), but the scanner opens a fence that never closes and hides the rest of the document. Probe: `## Problem` + that line + a valid `## Design` manifest → files `[]`, lint issues `[]`; the base parser returns `a.ts`. This is a parser-output change beyond AC-6 and a new silent-loss shape the lint does not report. `scanAllTables` uses the same regex but is unchanged by this diff, so only the new scanner needs fixing here. Fix: reject a backtick opener whose info string contains a backtick, and add a malformed-markdown test row (patterns.md §"Validation Gate Discipline" asks for explicit ones).
- **C3 — `code-bug` — `src/orchestrator/markdown-table.ts:210` (`visibleMarkdownLines` comment handling).** Flagged by cold-Claude; foreman-verified by probe. Any `<!--` outside inline code, mid-cell included, starts a comment that hides every later line until a `-->` appears. Probe: rows `` | `a.ts` | strip the <!-- marker | `` then `` | `b.ts` | x | `` → files `['a.ts']`, lint `[]`; the base parser returns both. Every later section, including amendments, is also hidden. Per CommonMark, an unclosed `<!--` mid-line is literal text; a block comment starts only when the line begins with `<!--` (≤3 spaces indent), and an inline comment must close on the same line. Fix: treat `<!--` as an opener only at line start or when its `-->` closes on the same line; add tests for both the mid-cell literal and a real multi-line block comment.

#### Risk / Guardrails

Address R1 and R2 in this revision. They are cheap, in-scope, and both affect a hard gate.

- **R1 — `code-bug` (low) — `src/orchestrator/validation.ts:1949` fused-cell message.** Anchored lens. All three real archive hits are unescaped `||` inside Change-column code, yet the message says "an extra path is not read. Put one file per row". patterns.md §"Validation Gate Discipline" asks for one actionable message per failure class. Add the escape hint (write `\|` for a literal pipe in a cell), so authors escape rather than restructure rows.
- **R2 — `code-bug` (low) — `src/orchestrator/validation.ts:1963` ignored-heading match.** Cold-Claude; foreman-verified (`### Unaffected Files` + a table → `ignored-heading`, which blocks `spec done`). `/affected files/i` matches inside "Unaffected". A word-boundary match (`/\baffected files\b/i`) still satisfies AC-4's "contains 'Affected Files'" and removes this false positive. "Tests for affected files" headings with tables do stay flagged per AC-4's wording; that is spec-intended.
- **R3 — non-blocking, recommended — unterminated real fence.** Anchored lens. A genuinely unclosed fence (or a ```` opener closed by ```) hides everything after it. That is CommonMark-correct and so within AC-6, but it still silently empties the manifest. The plan's dropped `unclosed-block` kind targeted exactly this. Consider a diagnostic when an unterminated fence hides a `## Design`/`## Amendment` or `### Affected Files` line. Implementer's call; record the decision in the handoff.
- **R4 — non-blocking, follow-up for human — foreman full-send amendment prompt.** Anchored lens. `src/orchestrator/prompts/templates/code-review-foreman.md:87-88` tells the foreman to write an exact `### Affected Files` row "plus a one-line reason" but doesn't carry the manifest contract. A foreman that puts a second backticked token in a column-1 note now auto-blocks the implement revision loop. The file is outside this task's Affected Files and isn't one of AC-13's enumerated surfaces, so changing it needs a scope amendment. Recorded for the human rather than required here.
- **R5 — non-blocking — `implement` 'blocked' state reused by park-resume.** Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/phases/implement.ts:104`: after a manifest auto-block, a claude-provider rerun with a stored implementer session takes the park-resume path and tells the agent "The previous session stopped before finishing: Spec manifest pre-flight…". In mixed mode an implement that was `in_progress` loses `isResume` and restarts fresh. This only happens on the interrupted-implement-then-broken-spec path, and the result is misleading prompt text or a fresh session, not corrupted state. Optional fix.

#### Optional Cleanup / Nit

- `src/orchestrator/validation.ts:1955`: malformed-path messages pass through parser reasons worded for handoffs ("handoff paths must be repo-relative", "so the diff→handoff check can match") and print the cell twice. (anchored)
- `src/orchestrator/validation.ts:1994`: "each task's active-checkout spec.md" is internal jargon for adopters; prefer "the task's spec.md (in its worktree, if it has one)". (anchored)
- `src/orchestrator/validation.ts:1937`: `hasToken` counts only backticked tokens, so markdown-link paths (`[b.ts](b.ts)`) in a fused or empty-first-cell row are still lost silently. This is spec-compliant (AC-1/AC-7 say backticks) and leaves a residual shape. Flagged by 2 lenses (anchored, cold-Claude).
- `src/orchestrator/validation.ts:1943-1946`: data-row numbering skips the line a header-less block swallowed as its header. (anchored)
- `src/orchestrator/markdown-table.ts:277`: `## Affected Files` with tables under H3 subsections is neither read nor flagged, because `sectionEnd` stops at the next H3. (anchored)
- `src/orchestrator/markdown-table.ts:172,183-232`: `parseAllTablesH3` now has no `src/` caller. Fence/comment masking also exists in three places (`computeCommentHiddenLines`, `scanAllTables`, `visibleMarkdownLines`) with different inline-code handling, which is parser-drift risk for the next change. The lint-vs-consumer drift the spec cared about is closed. Flagged by 2 lenses (anchored, cold-Claude).
- `src/orchestrator/markdown-table.ts:225`: `<!-- x -->### Affected Files` counts as a heading after comment stripping, and indented headings are neither read nor flagged. (cold-Claude)
- `docs/patterns.md:209`: "list each mirror … (a "Generated Artifacts" row)" can be read as a grouped prose row, which the new lint rejects. It is outside Affected Files; the spec's Docs Impact assigns this consistency check to QA. (anchored)
- `src/orchestrator/validation.ts:1984`: `lintSpecManifestForTasks` throws uncaught on read errors other than a missing file. (anchored, low confidence)

#### Spec Gaps

(none)

The R4 foreman-prompt surface could be read as a spec omission. It is recorded as a non-blocking follow-up rather than a `spec-gap`, because the code is correct against the written spec and the backstop catches the failure loudly.

### Dismissed Cold Findings

- Dismissed (cold-Claude): `--force` couples the manifest bypass to the other `--force` gates (full-send on delicate, reroute, base-drift, dirty REPO_ROOT). Spec §Decision item 2 states "`--force` bypasses it with a warning that lists the issues", and docs/pipeline-orchestrator.md documents it. The anchored lens raised the same coupling; both are spec-intended. Worth a human decision only if the coupling proves painful.
- Dismissed (cold-Claude): the new pre-flight blocks in-flight tasks whose specs predate the lint. Spec §Non-Goals: "In-flight tasks are linted only when they next pass a gate point … A latent defect then blocks at that point, with `--force` as the escape."
- Dismissed (cold-Claude): code_review entry runs no lint, so `canon task accept <id> implement` or a foreman approve-path amendment can reach code_review with a malformed manifest. `accept` is an explicit operator override that skips implement entry by design, and the existing scope pre-flight still fails closed at code_review, with a less specific message. The foreman-amendment half is covered by R4.
- Dismissed (cold-Claude): `HUMAN_AMENDMENT_HEADING_RE` (validation.ts:331) disagrees with the manifest scanner about what an amendment heading is. The diff does not touch that regex (verified: no hunk references it). It drives the reroute heading gate, not manifest scope, so the docs claim about scope consumers still holds.
- Dismissed (cold-Claude): the plan/implement auto-blocks exit 2 without `setExitReason`. They match the established `code_review` scope pre-flight pattern (`src/orchestrator/phases/code-review.ts:302-380`, `autoBlockPhase` + `process.exit(2)` with no `setExitReason`), which the spec told the implementer to follow. A broader consistency change belongs elsewhere.
- Dismissed (cold-Claude): the contract-agreement test skips the canon-spec-review skill and docs/pipeline-orchestrator.md. AC-13 deliberately narrows spec-review item (3) to completeness wording, and the docs describe the gates rather than restate the contract verbatim, so a verbatim pin cannot apply to either.
- Cold-Codex: no findings reported; nothing to dismiss. Its "no actionable regressions" summary is overridden by C1–C3, which were verified by probe and by code reading.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Required this round: C1, C2, C3, R1, R2. R3 and R5 are implementer's call, to be recorded in the handoff. R4 and the `docs/patterns.md` wording are human/QA follow-ups.

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

## Round 2 — verifying iteration response to round 1

**Scope:** Full — base `main` — reason: delicate

Lenses: anchored Claude (returned, `STAGE_1: pass`, signal `changes_requested`), cold Claude (returned, signal `changes_requested`), cold Codex (pre-obtained, no findings). Reviewed HEAD `286ca9f`. The handoff's response section is headed "Iteration 2 — addressing review round 1"; it is the only iteration section and is the one reviewed here. Red-first evidence was read across the whole handoff: the baseline AC-6 rows against `a4b4174` and the iteration rows against `34470c8`.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: no `Fail` rows, all required checks run, and red-first evidence is present for AC-6 (baseline) and for the C2/C3/R1/R2/C1 regressions (iteration). The anchored lens independently re-ran the full suite (1,913 tests, 0 failures, 0 skipped) and confirmed the rebuilt `dist/` matches source apart from an esbuild path comment. It also re-ran the archive differential: round-1 and round-2 path output is identical across all 127 specs, and 15 are flagged.

| AC | Status | Notes |
|---|---|---|
| AC-1: Fused cells rejected | Met | Predicate unchanged; message now carries the `\|` escape hint (`src/orchestrator/validation.ts:1949`), pinned by test. |
| AC-2: Header-less blocks | Met (unchanged from round 1) | |
| AC-3: Malformed path cells | Met (unchanged from round 1) | |
| AC-4: Ignored headings | Partial | `/\baffected files\b/i` (`validation.ts:1963`) no longer matches underscore-emphasized headings: `### _Affected Files_` + table → files `[]`, lint `[]` (foreman-verified). Finding N1. The five listed failing forms and the prose-title pass case still behave. |
| AC-5: Duplicate exact heading | Met (unchanged from round 1) | |
| AC-6: Fenced/commented content excluded | Partial | Real fences (backtick, tilde, tilde with backticks in info string) and real block comments stay hidden. But `<!-->` / `<!--->` (complete CommonMark comments) are treated as unclosed and hide the rest of the spec: files `[]`, lint `[]` (foreman-verified). Finding N2. This dates from round 1 and is only now surfaced. |
| AC-7: Empty first cell | Met (unchanged from round 1) | |
| AC-8: Valid manifests pass, consumers unchanged | Met | C1 fixture is static and matches the spec's table row-for-row; C2/C3 over-hiding is gone; archive output identical to round 1. |
| AC-9: Spec gate | Met (unchanged from round 1) | |
| AC-10: Evidence recovery | Met (unchanged from round 1) | |
| AC-11: Plan/implement pre-flights | Met (unchanged from round 1) | |
| AC-12: Adopter-safe messages | Met | New message text names no internals; adopter-safety test passes. |
| AC-13: Restatements | Met (unchanged from round 1) | No guidance surface changed this round. |
| AC-14: Lessons/backlog | Met (unchanged from round 1) | |
| AC-15: Archive calibration | Met | Recalibration (127 specs, 15 flagged, same per-kind counts) independently confirmed. |

### Verifying Round 1 findings

- _correctness bug C1:_ live task-spec read in test → addressed. `tests/run-task-validation.test.ts:4446` now uses a static fixture that matches the spec's table. ✓
- _correctness bug C2:_ inline triple-backtick opens a fence → addressed. `src/orchestrator/markdown-table.ts:196` rejects backtick openers with a backtick in the info string; tilde info strings are unaffected, per CommonMark. ✓
- _correctness bug C3:_ mid-cell `<!--` hides later rows → addressed. `markdown-table.ts:211-212` opens a comment only at line start (≤3 spaces) or when it closes on the same line; a real multi-line block comment is still hidden. ✓
- _risk R1:_ fused-cell escape hint → addressed. ✓
- _risk R2:_ `Unaffected Files` false positive → addressed, but the word-boundary form opened N1. Round 1 suggested that exact `\b` regex; the implementer applied it as written.
- _R3 (unterminated real fence), R5 (park-resume wording):_ deferred with recorded rationale → accepted. R3 is re-raised by cold-Claude this round; see Human follow-ups.
- _R4 (foreman amendment prompt), `docs/patterns.md` wording:_ unchanged, still human/QA follow-ups.

### New findings

#### Correctness bugs (required)

- **N1 — `code-bug` — `src/orchestrator/validation.ts:1963`.** Anchored lens; foreman-verified. `_` is a word character, so `\b` fails between `_` and `A`. `### _Affected Files_` or `### __Affected Files__` with a table under `## Design` is neither read by the parser nor flagged by the lint. That is a silent manifest loss, and it breaks AC-4, which says a heading containing "Affected Files" case-insensitively, with a table, and not read must fail. Fix: match unless the phrase is bordered by a letter, e.g. `/(?<![a-z])affected files(?![a-z])/i`. Add `### _Affected Files_` as a must-fail row and keep `### Unaffected Files` passing.
- **N2 — `code-bug` — `src/orchestrator/markdown-table.ts:211`.** Cold-Claude; foreman-verified. After consuming the 4-character `<!--` opener, the scanner searches for `-->` from `i + 4`. The overlapping close in `<!-->` and `<!--->` is therefore missed, and everything after it stays hidden. Probe: `<!-->` before a valid `## Design` manifest gives files `[]` and lint `[]`; `<!--->` gives the same. CommonMark treats both as complete comments. The round-1 code had the same behavior; it is reported now because cold-Claude found it this round. Fix: let the close search overlap the opener for these two forms (check `<!-->` and `<!--->` explicitly, or search from `i + 2`), and add a test for each.
- **N3 — `code-bug` (test integrity) — `tests/run-task-validation.test.ts:4571-4582`.** Anchored lens; foreman-verified. The closed-inline half of "revision C3: real block and closed inline comments still exclude their content" can't fail. `` | `a.ts` | live <!-- ignored --> note | `` produces the same paths and lint result whether or not the comment is stripped (probe: `['a.ts']`, `[]`). Fix: put something observable inside the inline comment, e.g. `` live <!-- `x` | `y` --> note ``, which would raise fused-cells if not stripped, and keep asserting a clean lint.

#### Optional cleanup / nit (non-blocking)

- `markdown-table.ts:211-212`: a mid-line `<!--` whose `-->` is on a later line now leaves the lines between visible. If they are `|` rows without a separator, the lint raises `header-less-block`, which fails closed and is loud. Under GFM they could be hidden inside an inline comment spanning lines. Consider adding a test that pins the intended behavior. Flagged by 2 lenses (anchored, cold-Claude). Low severity because it fails loud rather than losing paths silently.
- `markdown-table.ts:194`: the fence opener/closer accept a tab in `\s{0,3}`, while the comment rule uses spaces only. This is a consistency point. (anchored)
- `markdown-table.ts:208-213`: same-line comments are stripped before cells split, while GFM splits on `|` first. No consumer path change. (anchored)
- A fence indented 4+ spaces inside a list item isn't recognized, so a `|` example line inside it within an Affected Files section raises a loud `header-less-block`. (cold-Claude)
- `<!-- c --> | a | b |` treats the post-comment text as a table row, while CommonMark makes the line raw HTML. (cold-Claude)
- The lint doesn't flag tables without leading pipes, a header row that is itself a path, or `## Affected Files` with tables under H3 children. These are residual unread shapes, not regressions. (cold-Claude; the H2/H3 case was also in round 1)
- The manifest pre-flight runs before the review-loop cap check, so a capped task with a bad manifest records its escalation on `implement` first. (cold-Claude)
- A manifest block at first implement entry sets `implement: blocked`, which `isRerouteAdmitted` (`src/orchestrator/state.ts:459`) accepts. This makes `--reroute` admissible on a never-implemented task; the rerouted implement entry re-lints anyway. It is part of the accepted R5 family. (cold-Claude)
- `parseAllTablesH3` is exported but has no `src/` caller (carried from round 1). (cold-Claude)

### Human follow-ups (non-blocking for this verdict)

- **Unterminated real fence (round-1 R3), re-raised by cold-Claude at medium severity.** A stray ```` ``` ```` (or a ```` ```` ```` opener closed by ```) before `## Design` hides the rest of the spec. Files come back `[]`, the lint is clean, and the failure first appears at the code_review scope pre-flight or `--pr`. That is the late, silent loss this task targets. The implementer's deferral holds against the written spec: hiding is CommonMark-correct under AC-6, and spec §Non-Goals forbids grammar changes "beyond skipping fenced and commented content". Closing it, for example with an issue when an unterminated fence hides a `## Design`/`## Amendment`/`### Affected Files` line, needs a human decision on that Non-Goal. Recommended as a fast follow-up.
- **Foreman full-send amendment prompt (round-1 R4), now flagged by 2 lenses across rounds** (anchored round 1, cold-Claude round 2). `src/orchestrator/prompts/templates/code-review-foreman.md:87-88` doesn't carry `SPEC_MANIFEST_CONTRACT`, and `tests/run-task-prompts.test.ts:1368`'s agreement test doesn't pin it. A canon-authored amendment row can now auto-block a full-send implement revision. The file is outside Affected Files, so fixing it needs a scope amendment.
- `docs/patterns.md:209` mirror-row wording: still for QA, per the spec's Docs Impact.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the ignored-heading rule fires on headings like `### Affected Files we won't touch` or `### Risks to affected files` that have tables. AC-4 mandates exactly this: "A heading fails the lint when its text contains 'Affected Files' (case-insensitive), its section contains a `|` table, and the parser would not read it."
- Dismissed (cold-Claude): `--force` coupling, plus `reset-spec-review` skipping the spec gate. Spec §Decision item 2 says "`--force` bypasses it with a warning", and it names the plan pre-flight as `reset-spec-review`'s backstop. The behavior is spec-intended, as recorded in round 1.
- Dismissed (cold-Claude): `verifyRerouteAmendment` / `HUMAN_AMENDMENT_HEADING_RE` (`validation.ts:331`) still reads raw content. This diff doesn't touch it (round 1 checked). The new angle, a fenced-only `## Amendment` satisfying the reroute gate but adding no scope, fails closed at the code_review scope pre-flight. Aligning the visibility models is a separate change.
- Dismissed (cold-Claude): an integer-like header cell (`| File | 1 |`) reorders `Object.values(row)[0]`. This quirk is already on `main`, the trigger is not a realistic manifest header, and the AC-8 differential shows no consumer change.
- Dismissed (cold-Claude): tests read carriers via `process.cwd()`. docs/patterns.md (§"Known Pitfalls", worktree runs) prescribes `process.cwd()` for exactly this, so the active worktree is read rather than the stale REPO_ROOT copy. The foreman-carrier half is covered under Human follow-ups.
- Dismissed (cold-Claude): unterminated fence and foreman prompt as blocking code-bugs. They are verified, but they are recorded as human follow-ups above: the first is bounded by a spec Non-Goal and the second needs a scope amendment. The behavior is not dismissed as correct.
- Cold-Codex: no findings reported; nothing to dismiss. Its clean summary is overridden by N1–N3, which the foreman verified by probe.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Required: N1, N2, N3. All three are small and local, two in the scanner/lint and one in a test. Next round should be correctness-only.

## Round 3 — verifying iteration response to round 2

**Scope:** Full — base `main` — reason: delicate

Lenses: anchored Claude (returned, `STAGE_1: pass`, signal `approve`), cold Claude (returned, signal `changes_requested`), cold Codex (pre-obtained, no findings). Reviewed HEAD `d118fb9`. The handoff's response section is headed "Iteration 3 — addressing review round 2", the latest iteration section. Red-first evidence was read across the whole handoff: the baseline AC-6 rows (`a4b4174`), the Iteration 2 rows (`34470c8`), and the Iteration 3 N1/N2 rows plus the N3 mutation row (`286ca9f`).

Round 3 discipline applies: only correctness bugs and spec gaps drive the verdict, and nits are omitted.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: no `Fail` rows and all required checks run. The anchored lens re-ran `tests/run-task-safety.test.ts` without the sandbox restriction (379/379, 0 skipped) and 480 scoped tests. It ran mutation checks in a scratch copy, and each one fails only its own tests: reverting N1 to `\b`, disabling the short-comment branch for N2, and disabling same-line comment stripping for N3. The working tree matches HEAD under `src/`, `tests/` and `dist/`.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | `src/orchestrator/validation.ts:1949` |
| AC-2 | Met (unchanged from round 2) | |
| AC-3 | Met (unchanged from round 2) | |
| AC-4 | Met | `/(?<![a-z])affected files(?![a-z])/i` (`validation.ts:1963`). `_…_`, `__…__` and `**…**` headings are flagged; `Unaffected Files` and `Affected Filesystem` are not. Tests at `tests/run-task-validation.test.ts:4597-4605` fail under the `\b` mutation. |
| AC-5 | Met (unchanged from round 2) | |
| AC-6 | Met | `<!-->` and `<!--->` are consumed without opening comment state (`src/orchestrator/markdown-table.ts:211-213`). `<!-->` inside an open comment closes it correctly. The N3 test (`tests/run-task-validation.test.ts:4575`) now fails with fused-cells when inline stripping is disabled. |
| AC-7 | Met (unchanged from round 2) | |
| AC-8 | Met | Short comments no longer hide live scope; archive consumer paths are unchanged from round 2 (127 specs). |
| AC-9 | Met (unchanged from round 2) | |
| AC-10 | Met (unchanged from round 2) | |
| AC-11 | Met (unchanged from round 2) | |
| AC-12 | Met (unchanged from round 2) | No message text changed. |
| AC-13 | Met (unchanged from round 2) | No guidance surface changed. |
| AC-14 | Met (unchanged from round 2) | |
| AC-15 | Met | 127 specs, 15 flagged, per-kind counts unchanged. |

### Verifying Round 2 findings

- _correctness bug N1:_ underscore-emphasized heading missed → addressed (`validation.ts:1963`; AC-4 Met above) ✓
- _correctness bug N2:_ `<!-->` / `<!--->` hid the rest of the spec → addressed (`markdown-table.ts:211-213`; AC-6 Met above) ✓
- _test integrity N3:_ vacuous closed-inline half → addressed (`tests/run-task-validation.test.ts:4575`; mutation-confirmed) ✓

### New findings

(none that drive the verdict)

All anchored findings this round are nits, omitted under round-3 discipline. The cold-Claude findings are adjudicated below; none survive as a correctness bug or a blocking spec gap.

### Human follow-ups (non-blocking; carried forward and extended)

- **Unterminated real fence** (round 1 R3, round 2): unchanged. It still needs a human decision on spec §Non-Goals ("No grammar change beyond skipping fenced and commented content").
- **Foreman full-send amendment prompt** (round 1 R4, round 2): unchanged. Cold-Claude adds that on the approve path no plan or implement phase runs afterward, so a foreman-written amendment table is never linted, though it can still reach the code_review scope check and `--pr`. Fixing `src/orchestrator/prompts/templates/code-review-foreman.md:87-88` needs a scope amendment.
- **AC-4 predicate breadth (new, cold-Claude; foreman-verified).** A heading such as `## Amendment: affected files parsing`, or a spec title containing "affected files", is flagged `ignored-heading` when a table sits directly under it before the next H1–H3, even though that section is read correctly. This follows AC-4's literal predicate ("its text contains 'Affected Files' … its section contains a `|` table, and the parser would not read it"), so it is spec-intended. It fails loud and is fixed by renaming the heading. It is likely only in specs about this feature. Consider narrowing AC-4 in a follow-up so it skips the H2 section headings that are read.
- `docs/patterns.md:209` mirror-row wording: for QA, per the spec's Docs Impact.

### Dismissed Cold Findings

- Dismissed (cold-Claude): after a manifest block at first implement entry, `--reroute` is admitted on a never-implemented task (`src/orchestrator/state.ts:459`). Round 2 adjudicated this as part of the accepted R5 family. The rerouted path re-enters implement and re-runs the pre-flight, nothing is corrupted, and the effect is a looser admission check, not wrong output.
- Dismissed (cold-Claude): `hasToken` ignores markdown-link path tokens in fused or empty-first-cell rows. AC-1 and AC-7 specify backticked tokens, and Implementation Notes "gate on … a backticked token". This was recorded as a residual shape in rounds 1 and 2.
- Dismissed (cold-Claude): malformed-path is now a hard block for rows like `(none)`, un-backticked paths, or a non-file table under Affected Files. AC-3 mandates it: "Every column-1 cell that `parseHandoffPathCell` reports malformed fails the lint". AC-15 calibration classified the archive hits as real scope loss.
- Dismissed (cold-Claude): some silent-drop shapes remain unlinted: a Design table with no heading, a 1–3-space indented heading, a setext heading, a blockquoted heading. AC-4 defines the ignored-heading class, and these are residual shapes the base parser also never read, not regressions.
- Dismissed (cold-Claude): scanner CommonMark mismatches (text after a line-start closer, a comment-prefixed heading, a comment spanning cell pipes, escaped backticks). These were carried as low-severity nits in round 2. Each needs contrived input, and the archive differential shows no consumer path change.
- Dismissed (cold-Claude): `HUMAN_AMENDMENT_HEADING_RE` (`validation.ts:331`) diverges from the manifest scanner. It predates this diff and is untouched by it, as dismissed in rounds 1 and 2.
- Dismissed (cold-Claude): `--force` bypasses the manifest pre-flight, including for delicate full-send runs, and does not persist. Spec §Decision item 2 says "`--force` bypasses it with a warning". Re-blocking on a later plain run while the manifest is still malformed is the intended backstop.
- Dismissed (cold-Claude): `lintSpecManifestForTasks` has no try/catch, the recovery hint drops the original flags, and there is no `setExitReason`. These are nits; the auto-block matches the established code_review scope pre-flight pattern (`src/orchestrator/phases/code-review.ts:302-380`).
- Dismissed (cold-Claude): `parseAllTablesH3` is a dead export. This is a nit, carried from round 1.
- Dismissed (cold-Claude): the resume test rewrites spec.md to `# Spec: fixed`, which has no table. The test checks resume-after-block mechanics (the block clears and the phase proceeds once the lint is clean), and it fails if that path breaks. Acceptance of corrected tables is covered separately by the AC-8 valid-grammar tests, so the test is not vacuous.
- Dismissed (cold-Claude): the carrier test reads through `process.cwd()`. docs/patterns.md (§"Known Pitfalls", worktree runs) prescribes `process.cwd()`, as dismissed in round 2.
- Cold-Codex: no findings reported; nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

No correctness bugs or spec gaps survive. "With nits" covers only the human follow-ups above; the implementer has nothing further to address.
