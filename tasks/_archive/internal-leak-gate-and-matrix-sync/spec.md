# Spec: internal-leak-gate-and-matrix-sync — Close internal-leak gate gap, sync Validation Matrix, encode no-internals rule

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

Canon ships guidance (skills, templates, protected docs) into adopter repos via `canon upgrade`. That guidance must never point adopters at canon orchestration internals they don't have and can't change. The adopter-agent-file-redesign work (shipped v2.0.0) hit exactly this: a shipped skill referenced `implement.md`, a canon-internal per-phase prompt template under `scripts/run-task/prompts/templates/` that adopter repos don't contain. Three gaps remain:

1. **The leak gate has a blind spot.** `scripts/sync-canon-templates.mjs` flags backtick path refs in canon-managed markdown via `isCanonInternalTarget()`, which matches only refs that start with (or normalize to) `CANON_INTERNAL_PATH_PREFIXES = ['scripts/run-task/']`. A **bare basename** with no path component (e.g. `` `qa.md` ``) resolves to the source file's own directory, never matches the prefix, and escapes the gate — which is exactly how the v2.0.0 leak evaded it. A still-live instance exists: `.claude/skills/canon-changelog/SKILL.md:226` references `` `qa.md` `` (the internal prompt template `scripts/run-task/prompts/templates/qa.md`) by bare basename. Adopters who upgrade get a `qa.md` ref their `docs-refs-check` then flags as broken.

2. **The universal Validation Matrix is hand-duplicated with no drift guard.** The matrix is byte-identical in `scripts/run-task/prompts/templates/implement.md` (lines 41–49, runtime prompt, not shipped) and `.canon/templates/spec.md` (lines 50–58, shipped template). Nothing keeps them in sync; an edit to one silently drifts from the other.

3. **The principle is undocumented.** "Shipped guidance must not reference orchestration internals" is enforced nowhere durable and was never written down, so it keeps re-leaking.

## Decision

Three changes:

1. **Extend the leak gate** to also flag bare references to *internal-only* prompt-template basenames in canon-managed markdown. The internal-only set is defined as the basenames of `*.md` files under `scripts/run-task/prompts/templates/` that have **no counterpart** basename under `.canon/templates/`. This catches `qa.md`, `implement.md`, `spec-revision.md`, `code-review-foreman.md`, `plan-reroute.md`, `implement-reroute.md`, `implement-revisions.md`, and `spec-review-reroute.md`, while deliberately **not** flagging the colliding names `spec.md`, `plan.md`, and `spec-review.md` (which also name shipped `.canon/templates/*` files and task artifacts, so a bare ref to them is legitimate). Existing full-path prefix matching and code-fence skipping are unchanged.

2. **Add a drift-guard test** asserting the Validation Matrix table is byte-identical between `scripts/run-task/prompts/templates/implement.md` and `.canon/templates/spec.md`. No structural single-sourcing or runtime injection — the two files keep their own surrounding prose; only the matrix table must match.

3. **Fix the live leak** (reframe the `` `qa.md` `` reference so it names canon's QA *phase*, not the internal file) and **encode the principle** as a settled decision in `docs/decisions.md`.

## Non-Goals

- **Not** eliminating the matrix duplication structurally. No inject/generate/single-source machinery; the assert-equal test is the entire piece-2 deliverable. The matrix appearing in both files is intentional (didactic in `implement.md`, authorable template in `spec.md`).
- **Not** changing the Validation Matrix *content*. It is universal-by-design (change-type → check-category; adopters bind category → command in their own `docs/architecture.md`) and is correct as-is.
- **Not** flagging bare references to the colliding-name templates (`spec.md`, `plan.md`, `spec-review.md`). Full-path refs to their internal counterparts stay caught by the existing prefix check; the residual gap (a bare ref to a colliding-name internal template) is a documented, accepted limitation. **Why partial coverage is the right call here, not a half-fix:** the alternative — flag *every* bare ref to any basename under `scripts/run-task/prompts/templates/` and require an allowlist annotation for legitimate collisions — would produce false positives on legitimate bare task-artifact references already present in shipped content (e.g. `.claude/skills/canon-pipeline/SKILL.md:50` refers to `` `spec.md` `` / `` `spec-review.md` `` / `` `plan.md` `` as the *task artifacts* the operator reviews). That approach trades a low-likelihood residual for ongoing annotation friction on every legitimate bare artifact ref. The subtraction set closes the entire *observed* leak class (`qa.md`, `implement.md`, and the six other internal-only names) with zero false-positive friction; the residual — a writer typing bare `` `spec.md` `` *intending the internal spec-writing prompt template* rather than the shipped `.canon/templates/spec.md` or the task artifact — is low-likelihood because those three names overwhelmingly mean the shipped template or artifact in adopter-facing prose. Full-path refs to the internal counterparts remain caught regardless.
- **Not** modifying `docs-refs-check.mjs`, the orchestrator, `pipeline-policy.ts`, or any pipeline phase.
- **Not** auditing/reframing surfaces beyond the one leak found. A full sweep of `.claude/skills/**`, `templates/**`, `.canon/templates/**`, and the scaffold docs was completed during spec authorship; `qa.md` in `canon-changelog/SKILL.md` is the only genuine leak. All other internal-looking refs are legitimate task-artifact or adopter-overridable-template references.

## Acceptance Criteria

- [ ] AC-1: `scripts/sync-canon-templates.mjs`'s leak check flags a backtick reference to a bare internal-only prompt-template basename (no path component) inside any scanned canon-managed markdown file. Verify: a unit test in `tests/sync-canon-templates.test.ts` writes a canon-managed (wholesale-synced) markdown fixture containing bare `` `qa.md` `` and bare `` `implement.md` `` into a temp repo root, calls `findSyncErrors(root)` (the seam the existing leak tests use), and asserts a `[canon-internal-leak]` error is returned for each line.
- [ ] AC-2: The leak check does **not** flag bare references to `spec.md`, `plan.md`, or `spec-review.md` (the colliding names that also exist under `.canon/templates/`). Verify: a unit test writes a canon-managed markdown fixture containing each of those three bare backtick refs, calls `findSyncErrors(root)`, and asserts no `[canon-internal-leak]` error is produced for them.
- [ ] AC-3: The internal-only basename set is derived as (basenames of `*.md` in `scripts/run-task/prompts/templates/`) minus (basenames of `*.md` in `.canon/templates/`) — i.e., it is not a hand-maintained literal list that can drift from the actual template directories. Verify: by inspection of the implementation plus a `findSyncErrors(root)` test asserting `implement.md` (internal-only) is flagged and `spec.md` (colliding) is not, from the same markdown fixture.
- [ ] AC-4: Existing leak-gate behavior is preserved: full-path refs like `` `scripts/run-task/main.ts` `` and source-relative refs like `` `../scripts/run-task/main.ts` `` are still flagged; refs inside fenced code blocks are still skipped; refs that escape the repo root are still not flagged. Verify: the pre-existing tests in `tests/sync-canon-templates.test.ts` (lines ~279–384) still pass unchanged.
- [ ] AC-5: A test asserts the Validation Matrix table extracted from `scripts/run-task/prompts/templates/implement.md` is byte-identical to the table extracted from `.canon/templates/spec.md`. The extraction is anchored on the table header line `| Change Type | Required Check Categories |` and captures the contiguous run of `|`-prefixed lines that follows. Verify: the test passes on the current (identical) files; mutating one matrix row in either file makes it fail. The test must also assert the extracted block is non-empty in each file (no vacuous pass if the anchor is not found).
- [ ] AC-6: `.claude/skills/canon-changelog/SKILL.md` no longer contains a backtick reference to any internal-only prompt-template basename. The release-rules sentence is reframed to reference canon's QA *phase* (or equivalent) rather than the `qa.md` file, preserving the meaning that those rules are enforced at QA. Verify (structural, not a literal list): the extended leak gate (AC-8) reports no `[canon-internal-leak]` error for this file — i.e. no backtick ref in it resolves to an internal-only prompt template; and the reframed sentence still conveys that the release rules are enforced during canon's QA phase.
- [ ] AC-7: The mirror `templates/.claude/skills/canon-changelog/SKILL.md` matches the edited root file (kept in sync by the existing `sync-canon-templates` machinery). Verify: `npm run sync-templates:check` passes.
- [ ] AC-8: Running the leak gate over the whole repo (`npm run sync-templates:check`, which includes the leak scan) passes with the fixes in place — no `[canon-internal-leak]` errors remain. Verify: command exits 0.
- [ ] AC-9: `docs/decisions.md` gains a new decision entry (What / Why / Rule) stating that canon-managed/shipped guidance must not reference orchestration internals (`scripts/run-task/**`, `src/**`, per-phase prompt templates); adopters override `.canon/templates/*` task templates, but orchestration internals are off-limits and must not be named in shipped surfaces. The Rule references the leak gate in `scripts/sync-canon-templates.mjs` as the executable enforcement. Verify: the entry is present and names both the rule and its enforcement.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/sync-canon-templates.mjs` | Extend the leak check (`isCanonInternalTarget` / `findCanonInternalRefs` or a sibling) to flag bare internal-only prompt-template basenames. Derive the internal-only set from the two template directories (subtraction), not a literal list. Add a distinct failure message for the bare-basename case. Not CANON_OWNED → no `templates/` mirror. |
| `tests/sync-canon-templates.test.ts` | Add positive case (bare `qa.md` and bare `implement.md` flagged), negative case (bare `spec.md` / `plan.md` / `spec-review.md` NOT flagged), and confirm fenced-block + escape + full-path cases still behave. |
| `tests/validation-matrix-sync.test.ts` *(new)* | New test: extract the matrix table from `scripts/run-task/prompts/templates/implement.md` and `.canon/templates/spec.md`, assert byte-equality and non-emptiness. (Implementer may instead add this assertion to an existing suite; a new file is the recommended home.) |
| `.claude/skills/canon-changelog/SKILL.md` | Reframe line ~226: replace the `` inlined in `qa.md` `` clause so it references canon's QA phase, not the internal file. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Auto-synced mirror of the above; updated by the pre-commit/`sync-templates` machinery. Listed here so the `--pr` base-drift gate accepts it. |
| `docs/decisions.md` | New decision entry: shipped guidance must not reference orchestration internals; adopters override `.canon/templates/*`; the leak gate is the enforcement. |

### Interaction Dependencies

- **`docs-refs-check.mjs`** (adopter-side and repo-side): the leak gate exists precisely to prevent refs that this checker would later flag in adopter repos. The new check is additive and does not change `docs-refs-check` behavior.
- **Golden prompt snapshot** (`tests/run-task-prompts.golden.json`): only affected if `scripts/run-task/prompts/templates/implement.md` *content* changes. This task does not change `implement.md`, so the golden snapshot is untouched. (The matrix-sync test reads `implement.md` but does not modify it.)
- **`sync-templates` pre-commit hook / CI gate**: editing `.claude/skills/canon-changelog/SKILL.md` triggers the mirror sync; the leak fix must land before or with the gate extension so the gate passes on the same commit.

### Data Model Changes

None. No `status.json` schema change, no new persistent state.

## Validation Required

Universal change-type → check-category matrix (project command bindings are in `docs/architecture.md` §Validation):

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| UI / interaction changes | End-to-end tests |
| Content / SEO / metadata | Prerender / sitemap / feed regeneration |
| Schema / migration | Migration runner + manual review |
| Cross-platform | Subset of the above on each platform |

Applicable checks (canon-ai command bindings):

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; "suite runs clean," includes the new and existing `sync-canon-templates` tests and the new matrix-sync test
- [x] `npm run sync-templates:check` — canon-managed-mirror gate; must pass with the leak fix + gate extension (exercises the leak scan end-to-end, AC-8)
- [x] `npm run docs-refs-check` — Docs-references gate. Required because this task touches `docs/decisions.md`, `.claude/skills/canon-changelog/SKILL.md`, and `templates/.claude/skills/canon-changelog/SKILL.md`; per `docs/architecture.md` §Validation, docs-reference validation is required for any change touching `docs/`, `templates/`, or root-level agent files. Must pass clean (AC-7 and AC-9 introduce/edit refs in these surfaces)
- [ ] `npm run build` — **N/A.** `scripts/sync-canon-templates.mjs`, the test files, the skill markdown, and `docs/decisions.md` are not part of the published `dist/` bundle (which is built from `src/cli/index.ts` and `scripts/run-task.ts`). No `dist/` change → no build/`git diff dist/` gate.
- [ ] `<E2E>` — N/A (no runtime UI surface).

## Docs Impact

- `docs/decisions.md` — **changed by this task** (new entry, AC-9), not stale-risk.
- `docs/patterns.md` — no change required; the principle is captured as a decision, not a pitfall (per scope decision). The existing Validation Gate Discipline pattern already covers "tests are mandatory for new gate rules," which this task follows.
- `docs/architecture.md`, `docs/codebase-map.md`, `docs/product-context.md` — not affected.

## Known Risks

- **False positives from the subtraction set.** If a future contributor adds a `.canon/templates/qa.md` (etc.), `qa.md` would silently drop out of the internal-only set and stop being flagged. This is the intended collision-avoidance behavior, but it means the flaggable set is coupled to the template directories' contents. Mitigation: AC-3's test pins the current behavior (`implement.md` flagged, `spec.md` not); a directory change that alters the set would shift behavior only for the newly-colliding name. Acceptable.
- **Residual bare-collision gap.** A genuine bare-basename leak of `spec.md`/`plan.md`/`spec-review.md` pointing at the *internal* prompt template (rather than the artifact/template) is not catchable without false positives and is explicitly out of scope. Full-path refs to those internal templates remain caught. Documented in Non-Goals.
- **Matrix extraction robustness.** The matrix-sync test's anchor is the literal header `| Change Type | Required Check Categories |`. If a future edit renames that header in one file but not the other, the test must fail loudly (anchor missing → non-empty assertion fails) rather than pass vacuously. AC-5 requires the non-empty assertion to cover this.
- **Ordering on the fix commit.** If the gate extension lands without the `qa.md` reframe, the pre-commit/CI leak scan would block. The implement plan must apply the leak fix and the gate extension together so the same commit passes `sync-templates:check`.
- **Reframe must preserve meaning.** Dropping the `qa.md` clause entirely would lose the (true, useful) information that the release rules are enforced at QA. The reframe must keep that meaning while removing the internal file name (AC-6).

## Human Test Plan

1. Add a mention of one of canon's internal-only step files (by its short name) into a piece of canon's adopter-facing guidance, then run canon's content-consistency check.
   - Expected: the check fails, points at that line, and explains the named item is internal to canon — adopters won't have it, so it would break their setup.
2. Reword that mention to refer to canon's QA *step* rather than naming the internal item, then re-run the check.
   - Expected: the check passes.
3. Read the changelog-helper guidance that previously named an internal item.
   - Expected: it no longer names anything an adopter lacks, and still makes clear the release rules are enforced during QA.
4. Make the universal change-type/check table in one place differ by a row from its twin elsewhere, then run the test suite.
   - Expected: a test fails, reporting that the two copies of the table have drifted apart. Undoing the change makes it pass again.
5. Read the new architecture-decision entry.
   - Expected: it states plainly that canon's adopter-facing guidance must not point adopters at canon's internal machinery, that adopters customize their own task templates instead, and that an automated check now enforces this.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`).
