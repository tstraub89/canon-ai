# Spec: vacate-adopter-md — Vacate canon-managed content from adopter CLAUDE.md/AGENTS.md; slim canon-ai's own

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon currently ships a large canon-managed block into every adopter's `CLAUDE.md` (220 lines) and `AGENTS.md` (363 lines) via the delimited-merge mechanism (`DELIMITED` in `src/lib/canon-owned.ts`; `canon upgrade` / the sync hook merge the block in, preserving the adopter's tail below `<!-- canon:end -->`). This forces a multi-hundred-line prepend onto adopters who already have substantial agent files, and it bloats every pipeline/operator session's auto-loaded context.

This is the final task of a three-task program (A `relocate-rules-to-prompts` and B `discovery-nudge`, both shipped, unreleased on `main`). Task A already relocated every pipeline-consumed canon rule out of `AGENTS.md`/`CLAUDE.md` and into the per-phase prompt templates, agent charters, and skills that consume them — so the shipped block is now **redundant**: agents get their rules just-in-time, not from these files. `docs/decisions.md` §"JIT rule delivery" already authorizes the cleanup: *"The vacate task removes the now-redundant canon-block copies."* Task B added a recommend-only discovery nudge (warn-only `canon doctor` check) so a fresh session still learns the repo uses canon once the block is gone.

What remains (this task): stop shipping the block, stop managing those two files on `upgrade`, give existing adopters a clean one-off migration, and — because canon-ai dogfoods canon — slim canon-ai's *own* now-redundant operator files so it stops paying for duplicated context every session.

## Decision

Make `CLAUDE.md` and `AGENTS.md` fully adopter-owned. Concretely:

1. **Remove `AGENTS.md` and `CLAUDE.md` from `DELIMITED`** (it becomes empty), but **keep the delimited-merge machinery intact** (`mergeDelimited`, the marker constants, the `upgrade`/sync delimited loops). The mechanism stays available for a future file where canon legitimately owns a header region but not the body (e.g. a managed `docs/pipeline-invocations.md` header). Consequence: `canon upgrade` and the sync hook no longer touch `CLAUDE.md`/`AGENTS.md`.
2. **Delete `templates/CLAUDE.md` and `templates/AGENTS.md`** so `canon init` scaffolds neither file — a new repo gets nothing added to either file. `init` still detects pre-existing agent files (to inform the grill) without depending on those templates.
3. **Provide a one-off, non-shipped migration tool** (`tools/strip-canon-block.mjs`) that strips the legacy `canon:start…canon:end` block from an existing adopter's `CLAUDE.md`/`AGENTS.md`, preserving everything outside the block. Needed because `upgrade` no longer migrates them. Runs against the finite, non-growing set of pre-2.0.0 adopters (canon-ai maintainer's repos, James's submodule repo).
4. **Slim canon-ai's own root `CLAUDE.md`/`AGENTS.md`** to a deliberately-minimal local operator doc: remove the now-inert delimiter markers and drop the rules that Task A relocated into skills/prompts, keeping only ambient operator context not covered on-trigger by a skill. Because these files have left `DELIMITED` and the templates are deleted, they are now purely canon-ai-local — nothing syncs or ships them — so this is a self-contained, reversible edit with zero adopter impact.
5. **Resolve deferred nit N5**: the QA prompt lists `AGENTS.md` as a lesson-promotion target. With canon no longer treating `AGENTS.md` as a rules home, drop it from that list.
6. **Update outward and authority surfaces**: README (no longer managed; optional no-self-review practice; corrected `upgrade` description) and `docs/decisions.md` (record the end state; fix the stale "delimited AGENTS.md/CLAUDE.md" reference).

This is a breaking change for adopters (their `.canon`-managed `CLAUDE.md`/`AGENTS.md` stop being managed and require the one-off migration), so it is the trigger for the program's `2.0.0` major — but the version bump itself is the separate release step, not this task.

## Non-Goals

- **No version bump or CHANGELOG version line.** This task lands unreleased on `main`; the release step owns `2.0.0`. QA proposes changelog **entry text only**, never a version/bump tier (per `docs/decisions.md` §Versioning).
- **Do not retire the delimited-merge machinery.** `mergeDelimited`, `CANON_START_RE`, `CANON_END`, and the `upgrade`/sync delimited loops must still exist and still work after this task — only the two list entries are removed. A future file can be re-added to `DELIMITED` with no further code change. (Backed by AC-2 + AC-3.)
- **Do not ship the migration tool in the npm package.** It lives outside `package.json` `files`; adopters who vendor canon as a submodule get it via the repo, not the published package. (Backed by AC-9.)
- **Do not add a `canon doctor` residual-block detector.** The finite migration set + the tool cover it; a permanent shipped check for a ~zero post-migration audience cuts against the program's subtractive goal.
- **Do not run the migration tool against canon-ai's own files.** canon-ai keeps its curated (slimmed) content; the tool is for adopters whose block was pure canon redundancy.
- **Do not re-touch Task A's relocated prompts/charters/skills or Task B's discovery nudge.** This task assumes Task A's relocation is complete and correct.
- **Do not seed the discovery nudge into any file.** Task B settled recommend-only; `init` adds nothing.

## Acceptance Criteria

- [ ] **AC-1 — `DELIMITED` no longer manages the two files.** After the change, `DELIMITED` in `src/lib/canon-owned.ts` contains neither `AGENTS.md` nor `CLAUDE.md`. Verify: `git grep -n "AGENTS.md\|CLAUDE.md" src/lib/canon-owned.ts` shows no `DELIMITED` membership for those two paths.
- [ ] **AC-2 — Delimited machinery retained and still functional.** `mergeDelimited` (currently exported from `src/cli/commands/upgrade.ts`) and the marker constants `CANON_START_RE`/`CANON_END` (currently private in `upgrade.ts` and `scripts/sync-canon-templates.mjs`) remain present with unchanged behavior; the `upgrade` and sync-hook loops that iterate `DELIMITED` remain present (now iterating an empty list as a no-op). If the migration tool imports the marker constants rather than inlining them, exporting them is an acceptable mechanic. Verify: the existing fixture-based `mergeDelimited` / `mergeDelimitedForSync` tests in `tests/cli.test.ts` and `tests/sync-canon-templates.test.ts` remain present and pass (they exercise the machinery via fixtures, independent of `DELIMITED` contents).
- [ ] **AC-3 — A file can be re-added to `DELIMITED` with no code change.** Demonstrated by AC-2's retained tests; no new code path is required to manage a future delimited file. (Contract assertion; no separate runtime check.)
- [ ] **AC-4 — Template files deleted.** `templates/CLAUDE.md` and `templates/AGENTS.md` do not exist after the change. Verify: both paths absent from the working tree (`git status` shows them deleted) and `git grep` finds no code path that reads them by name.
- [ ] **AC-5 — `canon init` adds neither file.** Running `canon init` in a fresh directory with no pre-existing `CLAUDE.md`/`AGENTS.md` creates neither file. Verify: a test (extending the init tests in `tests/cli.test.ts`) asserts that after `init` in a temp dir, `CLAUDE.md` and `AGENTS.md` do not exist.
- [ ] **AC-6 — `canon init` still detects pre-existing agent files for the grill.** When `CLAUDE.md` and/or `AGENTS.md` already exist in the target dir, `init`'s grill-launch note about existing agent files still fires, and the detection does not depend on the deleted templates. Verify: a test asserts the "existing agent files" path is taken when those files pre-exist and not taken when they don't.
- [ ] **AC-7 — `canon upgrade` does not touch `CLAUDE.md`/`AGENTS.md`.** With a `CLAUDE.md` (or `AGENTS.md`) present that contains arbitrary content, `canon upgrade` leaves it byte-identical. Verify: a test asserts upgrade does not modify a pre-existing `CLAUDE.md`/`AGENTS.md` (they are in neither `DELIMITED` nor `CANON_OWNED`).
- [ ] **AC-8 — Migration tool exists with the specified contract.** `tools/strip-canon-block.mjs` exists and, for each of `CLAUDE.md` and `AGENTS.md` in the target repo: (a) if both markers are present, removes the `canon:start`-through-`canon:end` block inclusive and preserves all content outside it; (b) if markers are absent, leaves the file unchanged and reports a no-op; (c) refuses to write and exits non-zero if the target git tree is dirty; (d) supports `--check`/`--dry-run` (report only, write nothing); (e) is idempotent (a second run is a no-op). Verify: a test file under `tests/` drives the tool over fixtures covering present-block, absent-block, idempotency, and dirty-tree-refusal (refusal may be asserted via a unit-level check of the dirty-tree guard).
- [ ] **AC-9 — Migration tool does not ship.** `tools/strip-canon-block.mjs` is not included by `package.json` `files`. Verify: `files` lists no `tools/` entry; `npm pack --dry-run` (or equivalent inspection) does not include the tool.
- [ ] **AC-10 — canon-ai's own files have no delimiter markers and are slimmed.** Root `CLAUDE.md` and `AGENTS.md` contain no `<!-- canon:start -->` or `<!-- canon:end -->` markers, are materially smaller (the relocated rules are gone), and still contain the "must survive" content from the Design contract. Verify: `git grep -n "canon:start\|canon:end" CLAUDE.md AGENTS.md` returns nothing; a reviewer confirms the slim follows the plan's partition and the must-survive norms remain.
- [ ] **AC-11 — No operator rule is orphaned by the slim.** Every section removed from canon-ai's `CLAUDE.md`/`AGENTS.md` in the slim has a surviving home in a named skill (`.claude/skills/canon-*`) or per-phase prompt (`scripts/run-task/prompts/templates/*`). Verify: the handoff includes a mapping table (dropped section → surviving home with `file` reference); the reviewer spot-checks each.
- [ ] **AC-12 — N5 resolved.** In `scripts/run-task/prompts/templates/qa.md`, the lesson-promotion target list no longer names `AGENTS.md` (it reads `patterns.md / decisions.md`). Verify: `git grep -n "patterns.md / decisions.md" scripts/run-task/prompts/templates/qa.md` matches and the same line no longer contains `AGENTS.md`. Regenerate `tests/run-task-prompts.golden.json`.
- [ ] **AC-13 — Stale "managed CLAUDE.md/AGENTS.md" references swept.** No shipped or authority surface still describes `CLAUDE.md`/`AGENTS.md` as canon-managed/delimited. Verify: a `git grep` for "delimited" + "AGENTS.md"/"CLAUDE.md" and for "managed" near those filenames across `README.md`, `docs/`, and `.claude/skills/` surfaces every hit, and each is updated to reflect the new reality (build the grep allow-list from the *current* tree, not the Affected Files table).
- [ ] **AC-14 — README updated.** README states `CLAUDE.md`/`AGENTS.md` are adopter-owned (not canon-managed), corrects the `canon upgrade` description accordingly, and adds an optional "recommended practice" note: when doing below-pipeline work, don't self-review — get an independent cross-review (the `/canon-inline-review` skill, or `codex review` if not running canon). Verify: reviewer confirms the three edits are present.
- [ ] **AC-15 — `docs/decisions.md` updated.** A new decision entry records the end state (canon ships zero managed content into adopter `CLAUDE.md`/`AGENTS.md`); the existing stale reference to "the delimited `AGENTS.md` / `CLAUDE.md`" in the "Canon prescribes no release model" entry is corrected. Verify: reviewer confirms both.
- [ ] **AC-16 — Build, golden, and full validation are clean.** `dist/` is rebuilt (src changes), `tests/run-task-prompts.golden.json` is regenerated (qa.md change), and lint / type-check / unit tests / docs-refs all pass. Verify: Validation Outcomes table shows each as Pass with no `Fail`.

## Design

### canon-ai slim — contract

Slim canon-ai's root `CLAUDE.md`/`AGENTS.md` to ambient operator context only. The **principle**: keep what a skill/prompt does *not* carry on-trigger; drop what Task A already relocated into skills/prompts. The two binding contracts (everything else is a plan decision):

- **Must survive** (positive contract — losing any of these is the failure mode): the always-on operator norms that no skill re-states on trigger — ask before committing, never self-review inline work, default toward smaller models / lower effort, don't intervene in full-tier `spec_review` auto-revision — plus the Role/two-mode/spec-gate framing and thin pointers to the `/canon-*` skills and `docs/pipeline-orchestrator.md`.
- **No orphaned rule** (AC-11): any content dropped from the files must have a surviving home in a named skill or prompt.

The exact section-by-section partition and destinations are deferred to the plan (Claude-authored after `spec_review`), which produces the AC-11 mapping table; the implementer executes that partition.

### Migration tool contract

`tools/strip-canon-block.mjs` — a Node ES module, runnable directly (`node tools/strip-canon-block.mjs [--check]`), operating on the current working directory's `CLAUDE.md` and `AGENTS.md`. It removes the `canon:start…canon:end` block (inclusive) and preserves all surrounding content; no-op + clear message when markers are absent (gracefully handles the submodule repo whose block may be stale/missing); refuses on a dirty git tree; `--check`/`--dry-run` reports without writing; idempotent. May import `CANON_START_RE`/`CANON_END` (retained) or inline them.

### Affected Files

| File | Change |
|---|---|
| `src/lib/canon-owned.ts` | Remove `AGENTS.md`/`CLAUDE.md` from `DELIMITED` (→ empty list). Machinery and exports unchanged. |
| `src/cli/commands/init.ts` | Rewire existing-agent-file detection (currently inferred from the scaffold skip-list) to a direct presence check, since the templates are gone; `init` scaffolds neither file. |
| `templates/CLAUDE.md` | Delete. |
| `templates/AGENTS.md` | Delete. |
| `tools/strip-canon-block.mjs` | New. One-off migration tool per the contract above (non-shipped). |
| `CLAUDE.md` | Slim per the keep/drop partition; remove delimiter markers. |
| `AGENTS.md` | Slim per the keep/drop partition; remove delimiter markers. |
| `scripts/run-task/prompts/templates/qa.md` | N5: drop `AGENTS.md` from the lesson-promotion target list. |
| `tests/run-task-prompts.golden.json` | Regenerate (qa.md change). |
| `README.md` | Mark `CLAUDE.md`/`AGENTS.md` adopter-owned; correct `canon upgrade` description; add optional no-self-review practice note. |
| `docs/decisions.md` | New end-state entry; fix stale "delimited AGENTS.md/CLAUDE.md" reference in the release-model entry. |
| `tests/cli.test.ts` | Update for empty `DELIMITED`; add AC-5/AC-6/AC-7 init+upgrade assertions; keep fixture-based `mergeDelimited` tests (AC-2). |
| `tests/sync-canon-templates.test.ts` | Update for empty `DELIMITED`; keep fixture-based merge tests (AC-2). |
| `tests/strip-canon-block.test.ts` | New. Drives the migration tool over fixtures (AC-8). |
| `dist/**` | Rebuilt artifacts (src changes). |

> Build-generated artifacts: `dist/**` is regenerated by `npm run build` and `tests/run-task-prompts.golden.json` by `UPDATE_GOLDENS=1 npm test`; both are committed and listed above so the `--pr` base-drift gate accepts them.

### Interaction Dependencies

- **Pre-commit sync hook** (`scripts/sync-canon-templates.mjs --stage`): once `CLAUDE.md`/`AGENTS.md` leave `DELIMITED` and the templates are deleted, the hook no longer attempts to sync them. `npm run sync-templates:check` (CI) must stay green with the empty `DELIMITED`.
- **`canon doctor` discovery nudge** (Task B): unchanged; still passes because canon-ai's slimmed `CLAUDE.md` still mentions canon. It becomes the load-bearing discovery surface for adopters whose block is stripped.
- **Pipeline startup constants** (`CODEX_STARTUP`/`CLAUDE_STARTUP`): they instruct agents to read `AGENTS.md`/`CLAUDE.md`. After the slim those files hold only adopter/canon-ai-local content (rules come via injected prompts), so the instruction degrades gracefully to "read the project's own agent file." No change required, but verify nothing in the pipeline relies on the canon block's content.

### Data Model Changes

None. `DELIMITED` becomes an empty array; its type is unchanged.

## Validation Required

| Change Type | Required Check Categories |
|---|---|
| Source (`src/`), build artifacts | Linting, type checking, unit tests, full build |
| Prompt template (`qa.md`) | Golden regeneration + unit tests |
| Docs / README / cross-references | Docs references |

- [x] `npm run lint`
- [x] `npm run build` — rebuild `dist/` (src changes are baked into the bundle)
- [x] `npm test` — full suite; also run `UPDATE_GOLDENS=1 npm test` once to regenerate the golden after the qa.md edit, then confirm a clean `npm test`
- [x] `npm run docs-refs-check` — README + docs edits and any changed cited paths
- [ ] E2E — N/A (no UI/runtime surface)

## Docs Impact

- `docs/decisions.md` — **changed by this task** (AC-15): new end-state entry + corrected release-model reference.
- `docs/patterns.md`, `docs/architecture.md`, `docs/codebase-map.md`, `docs/product-context.md` — review for stale "managed CLAUDE.md/AGENTS.md" or "delimited" language during the AC-13 sweep; update any hit. `docs/codebase-map.md` may reference the templates being deleted — verify and fix.

## Known Risks

- **Slim orphans an operator rule (highest risk).** If a dropped section's content is *not* actually carried by a skill/prompt, the operator silently loses ambient guidance. Mitigated by AC-11's mapping audit and by the conservative keep-list (keep all always-on norms + connective tissue). Reversible: canon-ai's files are local-only after this task, so a missed keep is a one-line restore with no adopter/release impact. The Human Test Plan includes a read-through of the slimmed files.
- **Codex implementing a judgment-heavy doc rewrite.** The slim is content curation, not mechanical edits. Mitigated by pinning the keep/drop partition at section granularity in Design so the implementer follows a partition rather than exercising judgment, plus the AC-11 audit and human read-through.
- **`init` detection regression.** Rewiring existing-agent-file detection off the (deleted) scaffold skip-list could silently always-report "no existing files," breaking the grill's merge note. Mitigated by AC-6's two-way test (present and absent).
- **Migration tool corrupts an adopter file.** A bad regex/slice could drop content outside the block. Mitigated by the dirty-tree refusal (clean reviewable diff), `--check`, idempotency, and AC-8 fixture coverage including content-outside-block preservation.
- **Empty `DELIMITED` breaks an assumption.** A test or code path may assume `DELIMITED` is non-empty. Mitigated by AC-2/AC-7 and updating `tests/cli.test.ts` / `tests/sync-canon-templates.test.ts`.
- **Missed stale reference.** A shipped surface still calling the files "managed" would mislead adopters. Mitigated by AC-13's `git grep` sweep built from the current tree.

## Human Test Plan

1. In a scratch copy of a repo that still has the old canon block in its `CLAUDE.md`/`AGENTS.md`, run the migration tool in check mode and confirm it reports it would remove the canon block and nothing else. Run it for real and confirm: the block is gone, everything you wrote outside the block is untouched, and running it a second time reports nothing to do. Confirm it refuses to run when the repo has uncommitted changes.
2. In a brand-new empty folder, initialize canon and confirm it does **not** create a `CLAUDE.md` or `AGENTS.md`. In a folder that already has those files, initialize canon and confirm it still notices them and offers to merge canon guidance during setup.
3. In a repo that already has a `CLAUDE.md`, run the canon upgrade command and confirm your `CLAUDE.md` is left exactly as it was.
4. Read canon-ai's own slimmed `CLAUDE.md` and `AGENTS.md` end to end. Confirm they still tell you who does what, the two operating modes, the spec gate, the always-on habits (ask before committing, never self-review inline work, prefer smaller models), and where to find the rest (the canon skills and the orchestrator doc) — and that nothing you actually rely on day-to-day went missing.
5. Confirm the project's published package would not include the migration tool.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; pipeline writes the plan)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
