# Code Review: rebaseline-claude-matrix-for-5-5

> Reviewer: Claude | Spec: `tasks/rebaseline-claude-matrix-for-5-5/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

This review was synthesized by a foreman from three lenses:
- an **anchored Claude lens**, which applied the Stage 1 / Stage 2 charter;
- a **cold-Claude lens**, which read only the diff and base ref;
- a **cold-Codex lens**, which the orchestrator ran beforehand.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

**Summary.**
- The resolver logic and all 20 default cells match the spec's Decision table, and all three lenses agree. No lens found a runtime-behavior bug in `src/`.
- The round is blocked by two spec gaps and one code bug:
  - **Spec gaps SG-1 and SG-2.** `npm test` fails, and CI's dist-freshness gate fails. Both come from files the spec's ACs force to change but its Affected Files omit. The implementer stayed in scope and flagged both.
  - **Code bug CB-1.** The AC-3 precedence tests leave several boundaries unasserted. Mutation testing confirmed that regressions at those boundaries pass the suite.
- Because a code bug is present, the verdict is `changes_requested`. The spec gaps still need a human amendment to Affected Files (see Spec Gaps); the implement revision cannot close them.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [ ] Validation Outcomes table has no `Fail` results
  - `npm test` fails: 1318 pass, 1 fail. The anchored and cold-Claude lenses each reproduced this.
  - The handoff labels the row `Fail – unrelated`, but its own note says the required removal caused the failure. It is a task-caused `Fail`; see SG-1.
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Separately, `npm run build` succeeds, but the committed `dist/cli/index.js` does not match a fresh build; see SG-2.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Matrix | Pass | `CLAUDE_MATRIX_TABLE` covers all 20 cells, matching the Decision table. The delicate-M and empty-list tests are present. The old tables and comments are gone, and the budget tests are unmodified and pass. |
| AC-2: No xhigh; old helpers gone | Pass | The effort test covers every cell plus delicate. `rg xhigh src/lib/pipeline-policy.ts` returns only the Codex comment at `:212`. The old-helper `rg` has no hits. The Codex tests are unmodified and pass. |
| AC-3: Override precedence | Partial | Every enumerated case exists, and effort is checked for every cell in every case. The case `CLAUDE_MODEL` + `CLAUDE_MODEL_LIGHT` ("the light cells use the tier var") asserts only 2 of 7 light cells. No tier variable is asserted at L, XL, or delicate. See CB-1. |
| AC-4: One resolver, accurate warning | Pass | The `env.ts` `rg` returns only the legacy entry at `:74`, and `process.env.CLAUDE_MODEL` is read only in `policy.ts`. "not applied to qa" has no hits. The new message is asserted by a test. |
| AC-5: Orchestrator doc | Pass | `## Claude Model/Effort Matrix` is at `docs/pipeline-orchestrator.md:228` with concrete models. The LIGHT/STRONG rows are added, the five pin rows state scope and model-only replacement, `_LARGE` is explained, and the tuning sentence is rewritten. The mirror is in sync. |
| AC-6: Stale claims elsewhere | Pass | `product-context.md:91`, `README.md:89`, and the `PolicyConfig` and `effectiveSize` comments are corrected. The sweep `rg` returns only Codex hits. |
| AC-7: Decision record | Pass | The entry is at `docs/decisions.md:438`, after the 2026-09 Codex entry. It has the table, evidence, precedence, pinned-adopter effort change, and rollback. |
| AC-8: Mirrors and bundle | Partial | The mirror is synced, `dist/orchestrator/run-task.js` is fresh, and the golden file is unchanged. The committed `dist/cli/index.js` is stale, which is a spec gap (SG-2). |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work): Codex, budget, and loop-cap behavior are unchanged; there are no prompt edits and no `low` effort; pins are kept; the `decisions.md` diff is append-only.
- [x] Known Risks addressed or documented as accepted: the budget caps and `CLAUDE_BUDGET` escape hatch, the pinned-adopter effort loss, and the early-data caveat are carried into the decision entry.
- [x] Human Test Plan is satisfiable by the implementation: `--dry-run` prints the Claude model and effort per phase, and `warnLegacyEnvVars` runs before the dry-run exit.

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Stage 1 fails on the validation gate (spec gaps SG-1 and SG-2) and on AC-3 Partial (code bug CB-1). Stage 2 still ran, because the gate failure's root cause is the spec rather than code that is about to change, and because the cold-lens findings have to be adjudicated regardless.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is small and correct:
- `resolveClaudeModel` applies the order pin → tier variable → legacy `CLAUDE_MODEL` → default exactly as the spec's Decision states.
- `src/orchestrator/policy.ts` is now the single resolver.
- The nullable pin types survive the JSON round trip in the subprocess tests.

The weaknesses are in the test suite, which under-asserts the precedence boundaries (CB-1), and in adopter-doc completeness (R-1). The remaining items are doc drift and cleanup.

### Findings

#### Correctness Bugs

- **CB-1 [code-bug; test integrity]: the AC-3 precedence tests leave boundaries unasserted.**
  - Found by the anchored lens, with mutations run in a scratch copy. The foreman confirmed each gap by reading the tests.
  - **`CLAUDE_MODEL_STRONG` is asserted only at M.** See `tests/pipeline-policy.test.ts:352`; the custom-string case at `:416` is also M only. No test asserts a tier variable at L, XL, or delicate.
    - Mutation: change `resolveClaudeModel` to `tierModel = size === 'XL' ? null : …`.
    - Result: all 103 policy tests still pass, although an adopter's `CLAUDE_MODEL_STRONG` would be silently ignored on the XL and delicate spec, plan, and code_review cells, the most expensive ones.
  - **Legacy + LIGHT asserts only XS spec and M qa among the light cells.** See `tests/pipeline-policy.test.ts:402`.
    - Mutation: restore the pre-task fallback `?? process.env.CLAUDE_MODEL` on `claudeModelPlan`, `claudeModelReview`, and `claudeModelReviewLarge` in `src/orchestrator/policy.ts:20-22`.
    - Result: all tests pass. Yet with `CLAUDE_MODEL=x CLAUDE_MODEL_LIGHT=y`, XS/S plan and review get `x`, which violates the Decision.
    - This mutation is the pre-task code shape, so it is the most plausible regression.
  - **Per-phase pin tests check only one other phase, at M.** See `tests/pipeline-policy.test.ts:361-373`. For example, a `CLAUDE_MODEL_QA` leak into plan or code_review would not be caught.
  - **Fix.**
    - In the legacy + LIGHT case, assert every cell: all light cells (XS/S × spec/plan/code_review, plus qa at every size) and all strong cells.
    - Add a legacy + STRONG case.
    - Assert `CLAUDE_MODEL_STRONG` at M, L, XL, and delicate M for spec, plan, and code_review.
    - In each pin test, assert that every other phase keeps its default at every size.
    - The simplest shape is to iterate `CLAUDE_MATRIX_TABLE` with a per-case expected-model function.

#### Risk / Guardrails

- **R-1 [code-bug; low-medium]: the shipped orchestrator doc never mentions legacy `CLAUDE_MODEL`.**
  - Flagged by the anchored and cold-Claude lenses.
  - The Environment Variables table (`docs/pipeline-orchestrator.md:252-265` and its `templates/` mirror) documents pins and tier variables, but not layer 3 of the precedence.
  - The full order is written only in `docs/decisions.md`, which does not ship. Meanwhile the runtime deprecation warning tells adopters `CLAUDE_MODEL` is still honored.
  - Failure scenario: an adopter sets `CLAUDE_MODEL=opus CLAUDE_MODEL_LIGHT=haiku`. The shipped docs don't tell them that QA and the XS/S cells get `haiku` while `CLAUDE_MODEL` covers only the strong cells.
  - Fix: add a `CLAUDE_MODEL` row stating that it is a deprecated catch-all that applies to any cell whose phase pin and tier variable are both unset. Then run `npm run sync-templates`.

#### Optional Cleanup / Nit

- **N-1:** The new decision entry at `docs/decisions.md:438` has no `**Supersedes**` line. It overturns the 1.11.0 entry's Claude cells, and the older **Rule** at `docs/decisions.md:230` ("Claude `qa` effort (`medium` vs. `high` per `claudeMatrix()`'s `buildMedium`)") is now false. The spec forbids rewriting historical entries, so add a Supersedes line to the new entry naming both. (cold-Claude; two findings merged.)
- **N-2:** The file header at `src/lib/pipeline-policy.ts:7-8` still says "Env-var resolution + legacy-shim warnings stay in run-task.ts". That contradicts the new comment at `:83`. Resolution is now in `src/orchestrator/policy.ts`, and the warnings are in `src/orchestrator/env.ts`. (cold-Claude and anchored.)
- **N-3:** `docs/pipeline-orchestrator.md:171,186-187` still say size and `delicate` drive only Codex model and effort ("full Codex model, high implement effort"). They now select the Claude cell too. (anchored.)
- **N-4:** In `docs/pipeline-orchestrator.md:262`, the `CLAUDE_MODEL_REVIEW` row says "Does not reach XL." It should say "XL/delicate", because a delicate XS–L task promotes to XL. (anchored.)
- **N-5:** In `docs/pipeline-orchestrator.md:261`, "pins the `plan` model at every size" overstates XS. The fast tier has no separate plan session; the combined session uses the `spec` cell. This predates the task, but the new wording makes the claim explicit. Add a parenthetical. (cold-Claude.)
- **N-6:** `docs/product-context.md:90` says the fast tier has "Lower model effort". That no longer holds for Claude, where XS through L are all medium. (cold-Claude.)
- **N-7:** An empty env value counts as set. For example, `CLAUDE_MODEL_STRONG=` passes `--model ''` to every M+ spec, plan, and review cell (`src/orchestrator/policy.ts:19-26`). The pins behaved this way before; the two new variables inherit it. Consider normalizing `''` to `null`. (cold-Claude and anchored.)
- **N-8:** Tier and effort come from predicates (`claudeTierFor` and `claudeEffortFor`, `src/lib/pipeline-policy.ts:250-258`) rather than a literal table. That departs from the table-driven rule in `docs/patterns.md` §"Pure Policy + Test Discipline". The per-cell tests catch drift, so this is not a live bug. A literal `Record<ClaudePhase, Record<TaskSize, { tier, effort }>>` would make a one-cell retune a one-cell edit. It would also restore the compile-time exhaustiveness lost with the `{} as Record<…>` casts at `:280`. (anchored.)
- **N-9:** The new entry's evidence line drops the `tstraub89/canon-ai#68` reference for the 422-task analysis. (anchored.)
- **N-10:** The handoff Validation Outcomes row for `npm test` should read `Fail` with a pointer to the Blocker, not `Fail – unrelated`. (anchored.)

#### Spec Gaps

These need a human amendment to the spec's `### Affected Files`. The implementer cannot close them under the Affected Files scope cap, and it correctly declined to try.

- **SG-1 [spec-gap; blocks `npm test`]: the spec's claim that nothing outside `env.ts` reads the removed fields is false.**
  - Flagged by the anchored and cold-Claude lenses; each reproduced the failure.
  - AC-4 mandates removing `config.maxReviewLoops` and its siblings from `src/orchestrator/env.ts`. The spec's Decision asserts that "none of which is read outside `env.ts` today", which is false.
  - The case at `tests/run-task-harness.test.ts:38` reads `m.config.maxReviewLoops` at `:24`, through a spawned `--eval` import that type-check cannot see. It now throws `SyntaxError: "undefined" is not valid JSON` at `:33`. The same test passes on `main`.
  - Amend: add `tests/run-task-harness.test.ts` to Affected Files and delete that case. Its coverage is duplicated through `policyConfig()` at `tests/pipeline-policy.test.ts:178`. Alternatively, repoint it to `policyConfig()`.
- **SG-2 [spec-gap; blocks CI]: the committed `dist/cli/index.js` is stale.**
  - Flagged by the anchored and cold-Claude lenses; each verified it with a fresh `git archive` build.
  - The CLI bundle inlines `src/orchestrator/env.ts`, so a fresh `npm run build` deletes 23 lines: `parseMaxReviewLoops` and the removed `config` block.
  - CI's "Verify committed dist/ matches a fresh build" step (`.github/workflows/ci.yml:83-91`) will fail.
  - AC-8 and Affected Files name only `dist/orchestrator/run-task.js`, so the implementer restored the CLI bundle.
  - Amend: add `dist/cli/index.js` to Affected Files.
  - The working tree currently holds an uncommitted rebuilt copy from a review-time build.
- **SG-3 [spec-gap; low]: two docs now misdescribe the resolver this task consolidated.**
  - The spec's Docs Impact says `docs/patterns.md` and `docs/codebase-map.md` need no change.
  - `docs/patterns.md:37` says "Env-var resolution lives in `src/orchestrator/env.ts`; the module receives a fully resolved `PolicyConfig`". `docs/codebase-map.md:65` says `env.ts` holds "all env-var config".
  - A future implementer following `patterns.md` would rebuild the duplicate resolver this task removed.
  - Amend: add both docs. Neither is in `CANON_OWNED`, so there is no mirror to update.

**Instructions for the implement revision:**
- **Required:** fix CB-1.
- **Recommended in the same pass:** R-1 and N-1 through N-8. All of them are in Affected Files.
- **Do not** edit `tests/run-task-harness.test.ts`, and do not commit `dist/cli/index.js`. Until the spec is amended, keep both in Blockers and apply N-10.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the legacy warning's "still honored as a fallback for every Claude phase" misleads when a tier variable is set.
  - AC-4 mandates exactly this wording ("says the variable is honored as a fallback for every Claude phase").
  - "Fallback" correctly implies lower precedence.
  - The adopter-facing gap about where `CLAUDE_MODEL` sits is R-1.
- Dismissed (cold-Claude): `resolveClaudeModel` uses `!== null` rather than `!= null`, so an `undefined` field would count as set.
  - The `PolicyConfig` fields are typed `string | null`.
  - Both constructors (`TEST_CONFIG` and `policyConfig()`) produce `null`, and the JSON round trip preserves it.
  - No producer of `undefined` exists, so this is hypothetical.
- Dismissed (cold-Claude): an in-flight task that resumes a Claude session across a canon upgrade silently switches cells.
  - This is inherent to any default change shipped by release, not a defect of this diff.
  - The spec's Interaction Dependencies already states that the new matrix applies from the next release.
- Dismissed (cold-Claude): `tests/pipeline-policy.test.ts` imports `src/orchestrator/env.ts`, and `loadPolicyConfigForEnv` builds paths from `process.cwd()`.
  - AC-4 requires a test that asserts the `env.ts` legacy message, so the import is needed.
  - `process.cwd()` is the pattern `docs/patterns.md` prescribes for worktree-correct subprocess tests.
- Cold-Codex had nothing to dismiss: it reported no actionable findings.
  - It checked type-check and build only.
  - It did not surface the `npm test` failure or the dist-freshness gap (SG-1 and SG-2), which both Claude lenses caught independently.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

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

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Full — base `main` — reason: delicate

Reviewed SHA `5e1c1c3` against the working-tree spec, which includes the operator's manifest correction dated 2026-09-29. That correction adds four files to Affected Files: `tests/run-task-harness.test.ts`, `dist/cli/index.js`, `docs/patterns.md`, and `docs/codebase-map.md`.

All three lenses signal approve:
- The anchored lens re-ran lint, type-check, the targeted policy suite (105/105), and the full `npm test` (1321 pass, 0 fail).
- The anchored and cold-Claude lenses each built HEAD in a `git archive` scratch copy. The rebuilt `dist/` matches the committed `dist/` byte for byte, including `dist/cli/index.js`.
- Cold-Codex reported no findings.

### Stage 1 — Acceptance Criteria Re-Check

**Validation gate: pass.**
- The handoff's `### Re-run validation` table is authoritative and has no `Fail` rows.
- The Round 1 `npm test` row is kept as history and relabelled `Fail`, as N-10 asked.
- Every non-task file in `main...HEAD` is in the amended Affected Files.

| AC | Status | Notes |
|---|---|---|
| AC-1: Matrix | Met | `CLAUDE_MATRIX_TABLE` (`tests/pipeline-policy.test.ts:269-286`) covers all 20 cells. Delicate M is at `:288-296` and the empty-list case at `:495-503`. The budget tests are not in the diff and pass. |
| AC-2: No xhigh; old helpers gone | Met | The effort test at `:298-307` covers every cell plus delicate. `rg xhigh src/lib/pipeline-policy.ts` returns only the Codex comment at `:212`, and the old-helper `rg` has no hits. `ClaudeCell.effort` is typed `'medium' \| 'high'`, so the compiler rejects any other value. |
| AC-3: Override precedence | Met | Every enumerated case is present, and each walks all 20 cells (`:335-439`). The loader removes all 8 `CLAUDE_MODEL*` variables and checks effort for every cell on every load. Both Round 1 mutations now fail the suite. |
| AC-4: One resolver, accurate warning | Met | The `env.ts` `rg` returns only `:74`, and `process.env.CLAUDE_MODEL` is read only in `src/orchestrator/policy.ts`. There are no hits for "not applied to qa". The new message is asserted at `:441-448`. |
| AC-5: Orchestrator doc | Met | The matrix section is at `docs/pipeline-orchestrator.md:228`. The LIGHT/STRONG rows and five pin rows state their scope and that a pin replaces the model only. `_LARGE` is explained, and the new `CLAUDE_MODEL` row is at `:265`. The mirror is in sync. |
| AC-6: Stale claims elsewhere | Met | `product-context.md:90-91`, `README.md:89`, and the `PolicyConfig` and `effectiveSize` comments are corrected. The sweep `rg` returns only Codex hits. |
| AC-7: Decision record | Met | `docs/decisions.md:438` has the table and the evidence, including #68. Precedence is at `:453`, **Supersedes** at `:455`, and the pinned-adopter change and rollback at `:457`. Historical entries are untouched. |
| AC-8: Mirrors and bundle | Met | The mirror is in sync, both bundles are fresh, and the golden fixture is unchanged. The manifest correction authorizes `dist/cli/index.js`. |

### Verifying Round 1 findings

- **Correctness bug CB-1, the AC-3 precedence tests left boundaries unasserted: addressed.**
  - Every override case now walks the whole table, and STRONG is also checked at delicate M. A legacy+STRONG case was added (`tests/pipeline-policy.test.ts:350-427`).
  - The anchored lens re-ran both mutations in scratch copies:
    - the XL-skip mutation now fails 4 tests;
    - restoring the `?? process.env.CLAUDE_MODEL` fallback on the plan and review pins now fails 2 tests.
- **Risk/guardrail R-1, legacy `CLAUDE_MODEL` was undocumented for adopters: addressed.** The row is at `docs/pipeline-orchestrator.md:265` and in the mirror. A wording nit remains (N2-3).
- **Nit N-1, no Supersedes line: addressed** (`docs/decisions.md:455`).
- **Nit N-2, stale file header: addressed** (`src/lib/pipeline-policy.ts:7-8`).
- **Nit N-3, Codex-only wording for size and delicate: addressed** (`docs/pipeline-orchestrator.md:171,186-187`).
- **Nit N-4, the XL wording for `CLAUDE_MODEL_REVIEW`: addressed** (`:262`).
- **Nit N-5, the `CLAUDE_MODEL_PLAN` scope: addressed** (`:261`). It is accurate: the fast tier uses the `spec` cell (`src/orchestrator/phases/spec.ts:54`).
- **Nit N-6, "Lower model effort" on the fast tier: addressed** (`docs/product-context.md:90`).
- **Nit N-7, empty values counted as set: addressed, limited to the two new tier variables** (`src/orchestrator/policy.ts:24-25`, tested at `:343-348`). The existing pins and legacy `CLAUDE_MODEL` keep their behavior from before the task, which is reasonable given the spec's no-pin-changes non-goal. The resulting inconsistency is N2-2.
- **Nit N-8, predicates instead of a literal table: addressed.** `CLAUDE_CELLS` is a literal 4×5 `Record` (`src/lib/pipeline-policy.ts:252-281`). `claudeMatrix` has no casts, so exhaustiveness is enforced at compile time.
- **Nit N-9, the dropped #68 reference: addressed** (`docs/decisions.md:451`).
- **Nit N-10, the mislabelled `npm test` row: addressed** (the row now reads `Fail`).
- **Spec gaps SG-1, SG-2, and SG-3: resolved by the operator's manifest correction.**
  - SG-1: the harness test now reads `policyConfig()` with the same inputs and assertions.
  - SG-2: `dist/cli/index.js` is fresh.
  - SG-3: `docs/patterns.md:37` and `docs/codebase-map.md:65-66` now name `src/orchestrator/policy.ts` as the only resolver.

### New findings (only NEW issues introduced by Iteration 2's changes)

No code bugs and no spec gaps remain. Everything below is an optional nit.

- **N2-1 [nit; test coverage] Two precedence pairs have no test.** Flagged by the anchored and cold-Claude lenses; the foreman confirmed by reading the tests.
  - **"Phase pin beats legacy `CLAUDE_MODEL`" is never asserted.** No case sets a pin together with `CLAUDE_MODEL` (`tests/pipeline-policy.test.ts:336-436`). Mutation F from the anchored lens checks legacy before the pin and still passes all 105 tests. `CLAUDE_MODEL` plus `CLAUDE_MODEL_REVIEW` is the most likely config for an adopter to carry over.
  - **"Pin beats tier" is tested only for the light tier at XS** (`:429-433`). Mutation G lets `CLAUDE_MODEL_STRONG` beat a pin and also passes.
  - **Why this is a nit, not blocking:**
    - The resolver is correct.
    - AC-3's enumerated cases are all met.
    - Either regression would need the resolver order itself to change, which is less plausible than Round 1's case of restoring the fallback on a single line.
  - **Suggested fix:** add a `CLAUDE_MODEL` + `CLAUDE_MODEL_REVIEW` + `CLAUDE_MODEL_STRONG` case that walks the table.
- **N2-2 [nit] Empty-string handling is split and undocumented** (`src/orchestrator/policy.ts:19-26`). Flagged by the anchored and cold-Claude lenses.
  - The two tier variables use `||`, so an empty value means unset.
  - The five pins and `CLAUDE_MODEL` use `??`, so an empty value passes through as `--model ''`.
  - `warnLegacyEnvVars` uses a truthy check (`src/orchestrator/env.ts:86`), so `CLAUDE_MODEL=` is honored with no warning.
  - This is not a regression: the pins and legacy variable behaved the same way on `main`. No test locks down the `??` side, though.
  - **Suggested fix:** add a short comment at `:24-25` explaining the split. Normalizing the pins would change behavior and would need a spec decision.
- **N2-3 [nit; wording] The `CLAUDE_MODEL` row can be read as a global rule** (`docs/pipeline-orchestrator.md:265` and the mirror). Flagged by the anchored and cold-Claude lenses.
  - "Only where no phase pin or light/strong tier variable is set" can be read as "only when no tier variable is set anywhere". The real rule is per cell.
  - **Suggested wording:** "for any cell whose phase pin and tier variable are both unset".
- **N2-4 [nit] The retargeted harness test duplicates an existing one.** Flagged by the anchored and cold-Claude lenses.
  - `tests/run-task-harness.test.ts:38` now has the same title and checks the same thing as `tests/pipeline-policy.test.ts:178`.
  - This is what the manifest asked for ("same inputs and assertions"), but a failure would appear twice under one name.
  - **Suggested fix:** give it a distinct title, or delete one copy in a later cleanup.
- **N2-5 [nit; wording] Three comments and doc rows are slightly inaccurate:**
  - `src/lib/pipeline-policy.ts:83-84`: "passes raw env values" no longer holds, because LIGHT and STRONG are now normalized (anchored).
  - `src/lib/pipeline-policy.ts:110-111`: the `effectiveSize` comment describes only the XL column's effect, not what the field does in general (cold-Claude).
  - `docs/pipeline-orchestrator.md:187`: the `delicate` row leaves out that delicate also moves XS/S Claude spec, plan, and review to opus (anchored).

### Dismissed Cold Findings

- **Dismissed (cold-Claude): budget caps are unchanged while M/L moves to Opus.** This is spec-intended. The Non-Goals say "No Codex matrix, Codex env var, budget, or loop-cap changes", and Known Risks → "Budget caps" accepts the risk with `CLAUDE_BUDGET` as the escape hatch. The decision entry at `docs/decisions.md:457` records it.
- **Dismissed (cold-Claude): a resumed Claude session switches model across an upgrade.** This is the same finding dismissed in Round 1. Every default change shipped by release has this effect, and the spec's Interaction Dependencies already say the matrix applies from the next release.
- **Dismissed (cold-Claude): the `!== null` checks would let `undefined` pass as a model.** This is the same finding dismissed in Round 1.
  - The fields are typed `string | null`, and both constructors produce `null`.
  - Nothing currently produces `undefined`.
- **Dismissed (cold-Claude): "Current run still honors it" prints even when both tier variables fully override `CLAUDE_MODEL`.**
  - The suffix is shared by every entry in `LEGACY_FALLBACK_ENV_VARS` (`src/orchestrator/env.ts:87`).
  - `main` behaves the same way when all pins are set.
  - The wording "honored as a fallback" is what AC-4 prescribes, and it stays accurate.
- **Dismissed (cold-Claude): `README.md:89` overstates what delicate upgrades.** The sentence matches the scope AC-6 prescribes: "the upgrade covers spec, plan, code review, and Codex spec review and implementation, not QA or the cold-Codex lens". Across sizes, delicate does upgrade the model, effort, or both on each of those phases.
- **Dismissed (cold-Claude): the pure-policy test file imports `src/orchestrator/env.ts`.** This is the same finding dismissed in Round 1: AC-4 requires a test that asserts the `env.ts` legacy message. The untested pin-vs-legacy pair it also raised is kept as N2-1.
- **Dismissed (cold-Claude): the XS combined spec+plan session ignores `CLAUDE_MODEL_PLAN` and now runs Sonnet.** This is spec-intended. The Decision table sets the XS `spec` cell to light, and the new `CLAUDE_MODEL_PLAN` row (`docs/pipeline-orchestrator.md:261`) documents that the pin does not reach the fast tier.
- **Cold-Codex had no findings to dismiss.**

**Operator notes (not findings against the code):**
- The manifest correction to `spec.md` is still uncommitted in the working tree. Make sure it is committed with the task artifacts before `--pr`, so the late Affected Files gate reads the amended manifest.
- The spec's Docs Impact line (`spec.md:161`) still says `codebase-map.md` and `patterns.md` "need no change", which contradicts the correction.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
