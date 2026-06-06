# Spec: preflight-failure-routing — Classify code-review pre-flight failures and route by who-can-fix-it

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

The `code_review` pre-flight (`scripts/run-task/phases/code-review.ts`) deterministically rejects an invalid handoff before spending a Claude review session. Today it treats every blocker the same way: it writes one BLOCKED block to `review.md` ending in `Changes requested — fix the above and resubmit handoff`, bumps `preflight_rejections_current_loop`, and routes back to implement. That single framing conflates two structurally different failure classes:

1. **The handoff document is malformed** (missing AC Coverage table, malformed Changes rows, unfilled template) — Codex should *fix the handoff*.
2. **A required check genuinely failed** (`Fail` / `blocked` validation row) — Codex should *fix the code*, or the failure isn't fixable from the implement side at all.

By framing a real validation failure as "resubmit handoff," the gate points Codex at the document instead of the regression. Combined with the accepted escape token `Fail – unrelated`, Codex's path of least resistance becomes relabeling the row (`Fail` → `blocked` → `Fail – unrelated`) until the gate stops complaining, rather than fixing the break. Because re-implementing cannot make a genuine regression pass on the cited token alone, every implement→pre-flight cycle is structurally doomed and the run burns the entire review cap before auto-blocking.

Worse, the accept path has a laundering hole: a `Fail – unrelated` row with a file reference in Notes is accepted by `validateHandoffAgainstSpec` (validation.ts ~L554) **even when the cited failing file is one the task itself changed**. A Codex-introduced regression in a file the task edited can be labeled "not my fault" and sail past the deterministic gate into Claude review.

**Discovered** via GalleryPlanner's `smartfill-decode-failure-persist` task: Codex broke an E2E test in `e2e/specs/editor.spec.ts` (a file the task modified), the pre-flight rejected on `Fail` then `blocked` with "fix your handoff" framing, and the task accumulated pre-flight rejections toward the cap instead of being told to fix the regression it introduced.

This is an instance of the failure mode named in `docs/decisions.md` "Validation runs inside agent phases" — *"Interpreting a real failure as pre-existing/unrelated when it's actually consequential to the task"* — for which that decision designates Claude's Stage 1 assessment as the guardrail. This task strengthens that guardrail with a deterministic, non-judgment layer (a file you changed is not "unrelated") and fixes the routing/messaging so Codex is told to fix the right thing.

## Decision

At the `code_review` pre-flight, classify each blocker into one of three buckets and route by who can fix it. The buckets and their behavior:

| Bucket | What triggers it | Message framing in `review.md` | Route |
|---|---|---|---|
| **Format** | Handoff-structure problems: missing/placeholder AC Coverage table, malformed Changes-table rows, unfilled handoff template, handoff↔diff mismatch, a required check missing from the table | "fix your handoff" — name the structural problem | Pre-flight rejection → implement |
| **Regression** | A required check genuinely failed on the task's own work: a plain `Fail` row; **or** a `Fail – unrelated` row whose cited file is in the task's branch diff (the laundering guard) | "you broke `<check>` — fix the code. If the failure is genuinely outside the files you changed, record it as `Fail – unrelated` with a specific file/line reference in Notes" | Pre-flight rejection → implement |
| **Infra/blocked** | `blocked` rows (infrastructure unavailable: CI down, network out) are the **only** blocker | "infrastructure was unavailable — human triage required; re-implementing cannot resolve this" | **Halt: auto-block `code_review` for human triage** (does NOT route to implement) |

Routing rules:

- **Priority — never strand fixable work.** If *any* implement-fixable blocker is present (format or regression), the pre-flight routes back to implement, even if a `blocked` row is also present. The halt path fires **only** when infra `blocked` rows are the sole remaining blocker.
- **Mixed fixable blockers stack their framing — never drop one.** A single handoff can carry both format and regression blockers at once (e.g., a malformed Changes row *and* a real `Fail`). Both are real and both must be fixed, so the `review.md` rejection emits **both** framings (the handoff-fix items and the code-fix items), not one chosen by precedence. The implement route is unchanged; only the message accumulates. (`blocked` rows that accompany fixable blockers are noted for context but do not trigger the halt — see the priority rule.)
- **Regression and format rejections keep today's counter mechanics**: they bump `preflight_rejections_current_loop` (the existing combined `iterations + preflight` loop cap still applies) and do **not** touch `iterations_current_loop`. Only the *message framing* changes for these, not the counter or the route.
- **The accept path is unchanged for genuinely-unrelated failures.** A `Fail – unrelated` row with a valid file reference whose cited file is **not** in the task's diff continues to pass the pre-flight and proceeds to Claude review, where Claude assesses credibility in Stage 1.

**Defense-in-depth (declared-canon layer).** Independently of the deterministic guard, the declared-canon Stage 1 instruction and the agent prompts are updated to state that a file the task itself modified cannot be called "unrelated." This complements the settled decision (Claude owns the credibility judgment) and catches the subtler "file not in diff but failure is still consequential" cases the deterministic check cannot.

**Effects to remove (paired with the adds above):**
- The undifferentiated `## Validation Gate / BLOCKED — pre-flight rejected handoff before full review` block whose verdict line is always `Changes requested — fix the above and resubmit handoff` is replaced by bucket-specific framing. Format-class rejections keep handoff-fix framing; regression-class rejections get code-fix framing; the blocked-only path produces a triage/halt message, not a "resubmit handoff" line.
- The unconditional accept of a `Fail – unrelated` row in `validateHandoffAgainstSpec` (currently: accept whenever Notes has a file ref) gains the in-diff rejection branch.

## Non-Goals

- **Not** changing the loop-cap math, the combined `iterations + preflight` cap formula, or any counter mechanics. Regression/format rejections remain pre-flight rejections under the existing cap.
- **Not** adding new `status.json` fields. The halt path reuses the existing `autoBlockPhase` mechanism; classification is computed at pre-flight time and not persisted as new state.
- **Not** broadening Claude's credibility judgment beyond the in-diff rule (the rest of the `Fail – unrelated` assessment stays as designed in `docs/decisions.md`).
- **Not** changing the `Fail – unrelated` Notes-format requirement (still needs a specific file/line reference).
- **Not** changing what counts as a `blocked` vs `Fail` vs `Fail – unrelated` result state — only how the pre-flight routes and messages on them.
- **Not** touching bundle-cap aggregation or per-task vs bundle counter logic.

## Acceptance Criteria

- [ ] **AC-1 (laundering guard rejects own-file "unrelated"):** A handoff whose Validation Outcomes has a `Fail – unrelated` row whose Notes cite a file present in the task's branch diff against base is classified **regression** and rejected at pre-flight — it is no longer accepted. *Verify:* unit test in `tests/run-task-validation.test.ts` — a `Fail – unrelated` row citing an in-diff file produces a regression-class issue; the same row citing a file **not** in the diff produces no issue from this rule.
- [ ] **AC-2 (genuinely-unrelated accept path preserved):** A `Fail – unrelated` row with a valid file/line reference whose cited file is **not** in the task's branch diff still passes the pre-flight (no issue raised by the unrelated-fail check), so the handoff proceeds to Claude review. *Verify:* unit test asserting no issue for a not-in-diff cited file with a valid reference.
- [ ] **AC-3a (format blocker → handoff-fix framing):** When the pre-flight rejects on a format-class blocker (missing/placeholder AC Coverage, malformed Changes row, unfilled handoff template, handoff↔diff mismatch, missing required check), the `review.md` rejection names the structural problem and uses handoff-fix framing. *Verify:* unit test asserting a format-only rejection's `review.md` carries handoff-fix framing. (How the implementation distinguishes buckets internally — enum, route-decision + message-selector, etc. — is mechanics, deferred to plan/implement; the AC fixes only the observable framing + route.)
- [ ] **AC-3b (regression blocker → code-fix framing):** When the pre-flight rejects on a regression-class blocker (a plain `Fail` row, or an AC-1 in-diff `Fail – unrelated` rejection), the `review.md` rejection uses code-fix framing that names the failing check and tells Codex to use `Fail – unrelated` with a specific reference only if the failure is genuinely outside its changed files — **not** the "resubmit handoff" line. *Verify:* unit test asserting a regression rejection's `review.md` carries code-fix framing and does not contain the old "resubmit handoff" verdict line.
- [ ] **AC-3c (mixed fixable blockers stack both framings):** A handoff carrying both a format blocker and a regression blocker produces a `review.md` rejection containing **both** the handoff-fix items and the code-fix items (neither is dropped by precedence), and routes to implement. *Verify:* unit test on a handoff with a malformed Changes row plus a plain `Fail` — both framings present, route is implement.
- [ ] **AC-4 (regression/format routing + counters unchanged):** A regression-class or format-class pre-flight rejection routes back to implement and increments `preflight_rejections_current_loop` while leaving `iterations_current_loop` unchanged (combined cap behavior preserved). *Verify:* test inspecting `status.json` after the rejection — `preflight_rejections_current_loop` incremented, `iterations_current_loop` unchanged, top-level routes to implement.
- [ ] **AC-5 (infra-blocked halts for human):** When the **only** pre-flight blockers are infra `blocked` rows, the pre-flight auto-blocks the `code_review` phase (human triage) instead of routing to implement, and the message states infrastructure was unavailable and re-implementation cannot resolve it. *Verify:* test — a handoff whose sole blocker is a `blocked` row results in `code_review` auto-blocked (not routed to implement) with a triage message.
- [ ] **AC-6 (priority — fixable work wins over halt):** When both a fixable blocker (format or regression) and an infra `blocked` row are present, the pre-flight routes to implement and does **not** halt. *Verify:* test with a mixed handoff (regression row + blocked row) asserting the route is implement, not auto-block.
- [ ] **AC-7 (declared-canon defense-in-depth):** The declared Stage 1 rule and agent prompts state that a file the task modified cannot be labeled "unrelated." Updated surfaces: `CLAUDE.md` Stage 1 validation-gate rule (~L113), `AGENTS.md` `Fail – unrelated` result-state rule (~L107), `scripts/run-task/prompts/templates/code-review-round-1.md` (~L29), and `scripts/run-task/prompts/templates/implement.md` (~L22, the instruction that tells Codex when to record `Fail – unrelated`). *Verify:* grep each file for the new clause; `npm run sync-templates:check` passes (CLAUDE.md/AGENTS.md are canon-managed); `npm run docs-refs-check` passes; the prompt-snapshot golden is regenerated (`UPDATE_GOLDENS=1 npm test`) because `code-review-round-1.md` and `implement.md` are covered by `tests/run-task-prompts.golden.json`.
- [ ] **AC-8 (in-diff match tolerates a line-number suffix):** The in-diff guard recognizes a cited token of the form `<path>:<line>` (and `<path>:<line>:<col>`) as referring to the changed file `<path>`. *Verify:* unit test — Notes citing `e2e/specs/editor.spec.ts:1231` with `e2e/specs/editor.spec.ts` in the diff is recognized as in-diff. (Exact matching algorithm is mechanics — deferred to plan/implement — but the suffix-tolerance behavior is required and tested.)
- [ ] **AC-9 (test coverage per Validation Gate Discipline):** Each new/changed classification and routing branch has a positive and negative test row in `tests/run-task-validation.test.ts`, and any new pure helper exposes a `*FromData`-style test seam (no real git repo required for the classification logic). *Verify:* the test file covers all three buckets, the in-diff guard (both directions), the priority rule, and the suffix-tolerant match.
- [ ] **AC-10 (implement-revision prompt is bucket-neutral, not handoff-biased):** The pre-flight branch of the implement-revision prompt (`promptImplementRevisions` in `scripts/run-task/prompts/index.ts` → `implement-revisions.md`) fires on *every* fixable pre-flight rejection — format **and** regression — because it keys off `preflight_rejections_current_loop > 0` and the bucket is not persisted (see Non-Goals). Today that branch hardcodes "this is an input-validation failure … not a code-quality finding," "Fix the handoff itself," and "Source-code changes are usually unnecessary" — which directly contradicts a regression-class rejection that just told Codex (in `review.md`) to fix the code. The prompt must be made **bucket-neutral**: it must not assert that the failure is necessarily a handoff-format problem, must not state that source changes are usually unnecessary, and must direct Codex to read the pre-flight block in `review.md` and follow whichever framing it carries (fix the handoff, fix the code, or both). *Verify:* in `tests/run-task-prompts.test.ts`, the existing **pre-flight-branch** test (`promptImplementRevisions selects pre-flight branch when preflight counter is >= 1`, which renders the `preflight_rejections_current_loop > 0` branch via a `preflightTask`) gains direct assertions on the rendered output: `assert.doesNotMatch` for each retired phrase — `/input-validation failure/`, `/Fix the handoff itself/`, `/Source-code changes are usually unnecessary/` — and `assert.match` for the neutral authority wording that points Codex at the `review.md` pre-flight block. The `promptImplementRevisions` golden is **not** the right target: it is generated from `iterState` (`iterations: 1`, no pre-flight counter), so it renders the *review-findings* branch and never contains the pre-flight copy — regenerating it could "pass" AC-10 while the pre-flight branch stays handoff-biased. (The prompt stays *neutral*, not *bucket-aware* — re-deriving the bucket in the implement phase would require persisting classification, which Non-Goals forbids.)

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Add the in-diff laundering guard to the `Fail – unrelated` accept branch in `validateHandoffAgainstSpec` (reject when a cited file is in the task's changed-files set). Thread the task's changed-files set into `validateHandoff` / `validateHandoffAgainstSpec`. Add a pure, `*FromData`-style classification helper that takes the aggregated blockers (+ changed files) and returns each blocker's bucket (format / regression / blocked) so routing and messaging are computed from one tested source. Add the suffix-tolerant cited-file matcher. |
| `scripts/run-task/phases/code-review.ts` | Compute the task's changed-files set (branch diff vs base — reuse what the handoff↔diff check already derives) and pass it into validation. Replace the single undifferentiated BLOCKED block with bucket-specific framing written to `review.md`. Route by classification: implement (existing `taskPhasePreflightRejected`) when any fixable blocker is present; `autoBlockPhase` for the blocked-only halt. Preserve the append-vs-overwrite `review.md` handling and the non-`## Round` heading convention already in this file (the pre-flight block stays under `## Validation Gate` / `## Pre-Flight Rejection`, which is where the revision prompt directs Codex — keep those heading names so AC-10's pointer stays valid). |
| `scripts/run-task/prompts/index.ts` | **(AC-10)** Make the `hasPreflightFindings` branch of `promptImplementRevisions` bucket-neutral. The `reviewLines` text for pre-flight currently asserts the rejection "lists handoff-format issues … usually a malformed Validation Outcomes table or missing AC Coverage rows" — rewrite it to point Codex at the `review.md` pre-flight block without prejudging the bucket. (The `iterBanner` / `handoffAppend` labels that say "pre-flight handoff rejection" should drop "handoff" so they read "pre-flight rejection" — exact wording is deferred mechanics, but it must not imply the failure is necessarily format-class.) Do **not** change `shouldUseImplementRevision` selection logic in `phases/implement.ts` — selecting the revision prompt on `preflight_rejections_current_loop > 0` is correct; only the prompt *content* is wrong. |
| `scripts/run-task/prompts/templates/implement-revisions.md` | **(AC-10)** Replace the `{{#hasPreflightFindings}}` block's copy ("This is an input-validation failure … not a code-quality finding," "Fix the handoff itself," "Source-code changes are usually unnecessary") with bucket-neutral wording that defers to the `review.md` pre-flight block's framing (fix the handoff, fix the code, or both). |
| `tests/run-task-validation.test.ts` | Positive/negative rows for: the in-diff guard (own-file rejected, not-own-file accepted), three-bucket classification, the priority rule (mixed → implement), and the suffix-tolerant match. |
| `tests/run-task-prompts.test.ts` | **(AC-10)** Add the pre-flight-branch assertions to the existing `promptImplementRevisions selects pre-flight branch when preflight counter is >= 1` test: `doesNotMatch` the three retired phrases (`input-validation failure`, `Fix the handoff itself`, `Source-code changes are usually unnecessary`) and `match` the neutral review.md-authority wording. **Also update this test's existing banner assertion** — it currently asserts `assert.match(output, /addressing pre-flight handoff rejection/)` (line ~371); if the `index.ts` change drops "handoff" from the banner (recommended), this assertion must move to the new banner text or it will fail. This is the verification surface for AC-10 (the golden does not render the pre-flight branch — see AC-10). |
| `tests/run-task-prompts.golden.json` | Regenerate via `UPDATE_GOLDENS=1 npm test` after the prompt-template edits. The fixture covers `promptCodeReview_round1` and `promptImplement`, which change via AC-7's edits to `code-review-round-1.md` + `implement.md`. (The `promptImplementRevisions` golden renders the *review-findings* branch, which AC-10 does **not** touch — AC-10 changes only the pre-flight branch, asserted directly in `tests/run-task-prompts.test.ts` above. If the regen shows a `promptImplementRevisions` diff, that is unexpected — investigate before committing.) Commit the regenerated fixture; CI's `npm test` fails on a stale golden. |
| `dist/scripts/run-task.js` | Build artifact. `scripts/run-task/**` (validation, code-review phase, prompts) recompiles into this bundle via `npm run build`; commit the delta. |
| `dist/cli/index.js` | Build artifact. `scripts/run-task/validation.ts` bundles into **both** `dist/scripts/run-task.js` and `dist/cli/index.js` (see `docs/lessons-learned.md` — the `--pr` base-drift gate rejects an undeclared changed dist file). Commit this delta too. |
| `templates/AGENTS.md` | Synced mirror of `AGENTS.md` (in `DELIMITED`, `src/lib/canon-owned.ts`). The pre-commit hook / `npm run sync-templates` refreshes it from the root edit (AC-7); declared so the `sync-templates:check` gate and `--pr` base-drift gate pass. Edit the root only. |
| `templates/CLAUDE.md` | Synced mirror of `CLAUDE.md` (in `DELIMITED`). Same as above — refreshed from the root edit (AC-7); do not hand-edit. |
| `CLAUDE.md` | Extend the Stage 1 validation-gate rule (~L113): a `Fail – unrelated` entry is invalid when the cited file is one the task changed — you cannot call a file you modified "unrelated." |
| `AGENTS.md` | Extend the `Fail – unrelated` result-state rule (~L107) with the same clause. |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | Extend the reviewer instruction (~L29) with the in-diff clause. |
| `scripts/run-task/prompts/templates/implement.md` | Extend Codex's instruction (~L22): record `Fail – unrelated` only for failures outside your Affected Files — a failure in a file you changed is yours; fix it. |

> **Generated/synced/snapshot outputs (must be committed, not just source):** `scripts/run-task/**` recompiles into **both** `dist/scripts/run-task.js` and `dist/cli/index.js` via `npm run build` — commit both deltas (CI runs `npm run build && git diff --exit-code -- dist/`, and the `--pr` base-drift gate rejects any undeclared changed file). `templates/CLAUDE.md` / `templates/AGENTS.md` are synced from the root copies by the pre-commit hook / `npm run sync-templates` — edit the roots only. The prompt-snapshot fixture `tests/run-task-prompts.golden.json` must be regenerated with `UPDATE_GOLDENS=1 npm test` after AC-7's prompt-template edits (`code-review-round-1.md`, `implement.md` → the `promptCodeReview_round1` / `promptImplement` goldens). AC-10's `implement-revisions.md` edit touches only the pre-flight branch, which the golden does **not** render — AC-10 is verified by direct assertions in `tests/run-task-prompts.test.ts`, not the golden. All of these are in Affected Files above so the base-drift allow-list admits them.

### Interaction Dependencies

- **Combined loop cap** (`code-review.ts` L34–61): unchanged. Regression/format rejections still feed `preflight_rejections_current_loop`; the cap remains the backstop when Codex genuinely can't fix a regression. The halt path is a *separate* terminal exit that does not interact with the cap counter.
- **`shouldUseImplementRevision`** (`scripts/run-task/phases/implement.ts` L11–25): already keys off `preflight_rejections_current_loop > 0` to select the revision prompt and have Codex read `review.md`. Regression rejections keep bumping that counter, so Codex still gets the revision prompt and reads the (now code-fix-framed) `review.md`. **The selection logic needs no change** — but the revision prompt *content* it triggers does (AC-10). `promptImplementRevisions` (`prompts/index.ts`) renders `implement-revisions.md`, whose `{{#hasPreflightFindings}}` branch currently tells Codex the rejection is "an input-validation failure … not a code-quality finding," to "Fix the handoff itself," and that "Source-code changes are usually unnecessary." That copy fires for *every* fixable pre-flight rejection — including a regression-class one — and contradicts the code-fix framing this task writes to `review.md` before Codex ever reads it. The bucket is not persisted (Non-Goals), so the prompt cannot re-derive it in the implement phase; the fix is to make the prompt **neutral** and defer to `review.md`'s framing. This is the lone change to the revision path; the counter mechanics, the route, and the selection predicate are all untouched.
- **`autoBlockPhase`** (`scripts/run-task/state.ts`): reused as-is for the blocked-only halt; the resume instructions in the message must tell the human how to recover (triage infra, then re-run).

### Data Model Changes

None. No new `status.json` fields; classification is computed at pre-flight time and not persisted. The halt reuses the existing auto-block phase state.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added." After editing any prompt template (AC-7, AC-10), regenerate the snapshot with `UPDATE_GOLDENS=1 npm test`, then re-run `npm test` to confirm it passes against the committed golden
- [x] `npm run build` — `scripts/run-task/**` changes recompile **both** `dist/scripts/run-task.js` and `dist/cli/index.js`; commit both deltas (CI fails on stale `dist/`)
- [x] `npm run sync-templates:check` — `CLAUDE.md` / `AGENTS.md` are canon-managed; the `templates/` mirror must stay aligned
- [x] `npm run docs-refs-check` — touches `CLAUDE.md` / `AGENTS.md` / task docs

## Docs Impact

- `CLAUDE.md` and `AGENTS.md` are edited as part of the change itself (AC-7), so they ship updated.
- Consider a `docs/lessons-learned.md` append at QA (the "fix your handoff vs fix the code" framing lesson). No other protected-doc updates expected. `docs/decisions.md` already covers the unrelated-fail guardrail; this task strengthens but does not reverse it, so no new decision entry is required (the implementer may note the deterministic-layer addition in the existing entry if it reads as drift).

## Known Risks

- **Cited-file extraction from free-text Notes is fuzzy.** Notes is prose (`Fail – unrelated: e2e/specs/editor.spec.ts:1231 (Editor › ...)`). The in-diff guard must extract path-like tokens and match them against the changed-files set with a defined rule (strip a trailing `:line`/`:line:col`, then match a cited token against changed-file paths). Over-loose matching risks false "regression" classifications (rejecting a legitimately-unrelated failure); over-tight matching re-misses the laundering case. The matching rule must be explicit and unit-tested in both directions (AC-1, AC-8). This is the riskiest AC.
- **Bundle mode:** the changed-files set derived from the worktree diff is the bundle union. Using the union for the in-diff guard is intentionally safe — a file changed by *any* bundle member should not be called "unrelated." Confirm the per-task `validateHandoff` loop passes the (union) changed-files set consistently and document the chosen behavior in `notes.md`.
- **Declared/executable drift (per `docs/decisions.md`):** AC-7 adds the rule to declared canon (CLAUDE.md/AGENTS.md/prompts) *and* AC-1 enforces it executably. Both must land together; a declared rule without the executable guard (or vice versa) is a half-landed change and a Stage 1 review failure for this very task.
- **`review.md` append/overwrite handling is already subtle** (the non-`## Round` heading convention exists so `extractCheckedVerdict` keeps parsing the latest real verdict). The bucket-specific framing must preserve that convention — don't introduce a `## Round`-prefixed heading for the pre-flight block.
- **Halt-path recoverability:** auto-blocking on infra-blocked must emit a clear resume path (how to reset and re-run after infra is restored), consistent with the existing cap-hit auto-block message. A halt with no recovery guidance strands the task.
- **AC-10 neutral prompt ↔ pre-flight block coupling:** the implement-revision prompt is made *neutral* and defers to `review.md` for the actual fix instruction. That only works if the bucket-specific framing (AC-3a/3b/3c) reliably lands in the pre-flight block where the prompt points it (`## Validation Gate` / `## Pre-Flight Rejection`). If `code-review.ts` renames or relocates that block, the neutral prompt's pointer goes stale and Codex loses its instruction. Keep the heading names stable and verify the golden + a regression-bucket integration check together: prompt points at the block, block carries code-fix framing. A neutral prompt without code-fix framing in `review.md` is worse than today (Codex gets no direction at all), so both halves must land together — same declared/executable-drift discipline as AC-1/AC-7.
- **Residual gaps in the `Fail – unrelated` in-diff guard (documented, not in scope to close):** Three edge cases pass the deterministic guard and proceed to Claude Stage 1 review, which is the designed backstop for credibility judgment: (1) `:line`-only reference with no filename (e.g. `:1231` alone) — `extractCitedFilePaths` emits nothing, guard skips, row accepted; not a realistic attack surface since it provides no file identity. (2) Basename false positive — when two files share a basename (e.g. `src/utils/editor.spec.ts` and `test/utils/editor.spec.ts`), the last-segment scan (AC-1c) will fire if either is in the diff; this over-catches but in the safe direction (Codex gets a "fix the code" instruction at worst). (3) URL-style citations (`https://github.com/.../editor.spec.ts#L42`) — `#L42` is not stripped by the `:line` pattern; the URL is extracted but not matched; row accepted. Not a realistic attack surface. All three pass to Claude Stage 1 where the credibility judgment lives per `docs/decisions.md`.

## Human Test Plan

1. Take a task where the implementer introduced a real failure in a check covering a file it changed (e.g., it edited a test file and a test in that file now fails), and where the handoff labels that failure as "unrelated."
2. Run the review step. Expected: the pre-flight rejects with a message telling the implementer it broke the check and must fix the code — not a message telling it to fix the handoff document — and the task goes back for another implementation pass rather than accepting the "unrelated" label.
3. Take a task where a check failed for a reason genuinely outside the files the task touched, properly labeled "unrelated" with the failing file named. Run the review step. Expected: the handoff is accepted into full review (the reviewer then judges credibility) — it is not bounced.
4. Take a task whose only outstanding problem is that the test infrastructure was unavailable (e.g., the check could not run at all). Run the review step. Expected: the task stops and asks for human triage of the infrastructure, rather than repeatedly sending the work back for re-implementation.
5. Take a task whose handoff is structurally incomplete (missing the acceptance-criteria coverage table). Run the review step. Expected: the message tells the implementer to fix the handoff document, and the work goes back for another pass.

---

## Amendment

**Problem (discovered post-implementation via CodeRabbit P2 on PR #138):** `extractCitedFilePaths` strips `:line`/`:line:col` suffixes and `./` prefixes but does not normalize absolute paths or bare basenames before the `changedFiles.has(citedPath)` set lookup. The `changedFiles` set contains repo-relative paths from `git diff` (e.g. `e2e/specs/editor.spec.ts`). So:

- An absolute path citation like `/workspace/canon-ai/e2e/specs/editor.spec.ts:1231` → stripped to `/workspace/canon-ai/e2e/specs/editor.spec.ts` → `has()` returns false → guard passes → regression laundered.
- A bare basename like `editor.spec.ts:1231` (common in test-runner stack traces) → stripped to `editor.spec.ts` → `has()` returns false → guard passes → regression laundered.

Both paths bypass the laundering guard AC-1 was designed to close. The spec's AC-1 and AC-8 enumerated `:line` suffix stripping but assumed cited paths would be repo-relative; the normalization requirement for absolute paths and the non-matching treatment of bare basenames were unspecified.

**Change:** Two fixes in `scripts/run-task/validation.ts`:

1. **Tighten the outer `hasFileRef` check** (line ~571): the current regex `/\w+\.\w+|:\d+/` accepts a bare basename like `editor.spec.ts` (matches `\w+\.\w+`). Change it to require either a path separator (`/`) in the token OR a `:line` reference. A bare basename with no line number and no path — e.g. `editor.spec.ts` — is rejected as insufficient for a `Fail – unrelated` claim. A `filename.ext:line` form (e.g. `editor.spec.ts:1231`) still passes and proceeds to Claude Stage 1 review.

2. **Normalize absolute paths in `extractCitedFilePaths`** before the `changedFiles.has()` lookup: if a cited path starts with `/` (or a Windows-style drive letter), walk suffixes from the right to find the longest suffix that matches a key in `changedFiles`. If a suffix matches, use it for the comparison; if none matches, the path is treated as not-in-diff (safe — it won't falsely classify as a regression).

**New ACs:**

- [ ] **AC-1a (absolute-path citation → in-diff match):** A `Fail – unrelated` Notes entry citing an absolute path that resolves to a repo-relative path in the task's diff (e.g. `/abs/path/to/repo/e2e/specs/editor.spec.ts:1231`) is recognized as citing an in-diff file and classified as a regression blocker. *Verify:* unit test — absolute path citation whose suffix matches a changed file → regression issue emitted.
- [ ] **AC-1b (bare basename without `:line` → rejected at outer check):** A `Fail – unrelated` Notes entry citing only a bare filename with no path separator and no `:line` reference (e.g. `editor.spec.ts` alone) is rejected by the tightened `hasFileRef` check — it does not reach the in-diff guard. A form with a line reference (e.g. `editor.spec.ts:1231`) passes the outer check and then goes through the in-diff guard (AC-1c): if the basename matches a changed file it is classified as regression; if it does not match it proceeds to Claude Stage 1 review. *Verify:* unit test — bare basename with no `/` and no `:line` → `Fail – unrelated` row rejected (hasFileRef fails); same basename with `:line` appended → passes outer check (subject to AC-1c in-diff check).

**Affected files (amendment additions only):**

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Tighten `hasFileRef` regex; extend `extractCitedFilePaths` with absolute-path suffix matching. |
| `tests/run-task-validation.test.ts` | Two new test rows: AC-1a (absolute path → regression) and AC-1b (bare basename without `:line` → outer rejection; with `:line` → passes). |

---

## Amendment Round 2

**Problem (discovered via CodeRabbit P2 on PR #139, after Amendment 1 shipped):** The Amendment 1 fix closed bare-basename-without-`:line` at the outer check, but `editor.spec.ts:1231` (basename + `:line`) still slips through: `hasSpecificFailUnrelatedReference` fires on the `:line` component (returns true), `extractCitedFilePaths` emits `editor.spec.ts` (no path separator, has extension — passes the filter), and `matchAgainstChangedFiles` does `changedFiles.has('editor.spec.ts')` — an exact match against repo-relative paths — which returns false. Guard passes. Regression laundered.

The matching hierarchy after Amendment 1 was: (1) absolute path → suffix walk, (2) relative with `/` → exact match. The bare-basename case (no `/`, no absolute prefix) was left as an exact-match attempt that always fails.

**Full matching threat model (enumerated before writing this amendment to avoid a fourth round):**

| Citation form | After Amendment 1 | Correct outcome |
|---|---|---|
| `e2e/specs/editor.spec.ts` | exact match ✓ | caught |
| `e2e/specs/editor.spec.ts:1231` | exact match after strip ✓ | caught |
| `/abs/path/e2e/specs/editor.spec.ts:1231` | suffix walk ✓ | caught |
| `editor.spec.ts` (no line) | rejected at outer check ✓ | not reached |
| `editor.spec.ts:1231` (basename + line) | `has('editor.spec.ts')` = false 🔴 | **miss — this PR** |
| `:1231` alone (line only, no file) | `extractCitedFilePaths` emits nothing → guard skips → accepted | passes to Claude Stage 1 (documented gap, not a practical attack surface) |
| Two files share a basename (false positive) | after fix: basename match fires on both | safe direction — overcatches, documented |
| URL citation `https://.../editor.spec.ts#L42` | `#L42` not stripped; URL not matched | passes to Claude Stage 1 (not a realistic attack surface) |

**Change:** Extend `matchAgainstChangedFiles` (`validation.ts` line ~433) with a third branch: when the cited path has no path separator (it's a bare basename after `:line` stripping), scan `changedFiles` for any entry whose last path segment matches the basename. If any matches, return true.

This closes the `editor.spec.ts:1231` case. The two documented gaps (`:line`-only reference, URL citations) pass to Claude Stage 1 review where credibility is assessed — both are degenerate inputs a real implementer wouldn't write as a laundering attempt.

**New ACs:**

- [ ] **AC-1c (basename + `:line` citation → in-diff match via last-segment scan):** A `Fail – unrelated` Notes entry of the form `editor.spec.ts:1231` (basename with extension + `:line`, no path separator) is matched against `changedFiles` by comparing the basename against the last path segment of each changed file. If any changed file has that basename, the entry is classified as a regression blocker. *Verify:* unit test — `editor.spec.ts:1231` in Notes with `e2e/specs/editor.spec.ts` in `changedFiles` → regression issue emitted. *And* a basename that does NOT appear as the last segment of any changed file → no regression issue (genuinely-unrelated accept path preserved).
- [ ] **AC-1d (known limitations documented in Known Risks):** The Known Risks section documents the three remaining gaps (`:line`-only reference, same-basename false positive, URL citations) with their safe-direction rationale. *Verify:* Known Risks section contains entries for each.

**Affected files (round 2 additions only):**

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Extend `matchAgainstChangedFiles` with last-segment basename scan when no path separator present. |
| `tests/run-task-validation.test.ts` | Two new test rows: AC-1c (basename+line → caught) and AC-1c negative (non-matching basename → not caught). |

---

## Amendment Round 3

**Problem (discovered via CodeRabbit P2 on PR #139, after Amendment Round 2 shipped):** The original `validateHandoff` contained an explicit all-row scan (`hasFail`) that blocked on any `Fail` result anywhere in the Validation Outcomes table, including rows for checks Codex ran voluntarily that are NOT listed in the spec's `Validation Required` section. The refactor in this task replaced that with `classifyValidationChecks(requiredChecks, ...)` which only iterates the spec's checked `[x]` items. Non-required `Fail` rows are now silently ignored — a task can proceed to Claude review with an explicitly failed non-required check.

This is a direct behavioral regression from the old `validateHandoff` gate. All other result states on non-required rows (`Fail – unrelated`, `blocked`, `Pass`, `pending`) were never flagged by the old `hasFail` scan and remain consistent between old and new behavior. Only plain `Fail` on non-required rows is the regression.

**Change:** In `classifyPreflightBlockersFromData` (`validation.ts` line ~643), add a pass over all `latestResults` values after `classifyValidationChecks` runs. For any row where `isFailResult(row.result) && !isUnrelatedFailResult(row.result)` is true (plain `Fail` only — explicitly excluding `Fail – unrelated` which has its own accept/laundering-guard path) AND the row's canonical key is NOT already covered by `requiredChecks` (to avoid double-counting), emit a `regression`-bucket blocker with code-fix framing. The set of canonical required-check keys is pre-computed from `data.requiredChecks` (or empty when `requiredChecks` is null) before the scan. Non-required `Fail – unrelated` rows remain on the accept path (proceed to Claude Stage 1) — unchanged from the original pre-flight behavior.

**New AC:**

- [ ] **AC-11 (non-required plain-Fail row → regression blocker):** When the Validation Outcomes table contains a plain `Fail` row for a check that is NOT in the spec's `Validation Required` section, the pre-flight classifies it as a `regression`-bucket blocker (code-fix framing). A `Pass` row for a non-required check produces no blocker. A `Fail – unrelated` row for a non-required check is NOT classified as a regression blocker — it remains on the accept path (unchanged behavior). *Verify:* unit tests — (a) non-required `Fail` → regression issue emitted; (b) non-required `Pass` → no issue; (c) non-required `Fail – unrelated` with valid file ref → no regression issue from this rule; (d) a required check with `Fail` is not double-counted (only one blocker emitted).

**Affected files (round 3 additions only):**

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Add all-row plain-Fail scan (`isFailResult && !isUnrelatedFailResult`) in `classifyPreflightBlockersFromData`, skipping already-required canonical keys. |
| `tests/run-task-validation.test.ts` | Four new test rows per AC-11 verify clause: (a) non-required Fail → blocker, (b) non-required Pass → no blocker, (c) non-required Fail–unrelated → no regression blocker, (d) required Fail not double-counted. |

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; plan written by pipeline)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
