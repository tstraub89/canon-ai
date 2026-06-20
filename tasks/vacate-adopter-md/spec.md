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
2. **Delete `templates/CLAUDE.md` and `templates/AGENTS.md`** so `canon init` scaffolds neither file — a new repo gets nothing added to either file. `init` still detects pre-existing agent files (to inform the grill) without depending on those templates, and its grill-launch note stops promising a canon "merge protocol" on those files — they are adopter-owned, read as context, never merged (AC-6).
3. **Provide a one-off, non-shipped migration tool** (`tools/strip-canon-block.mjs`) that strips the legacy `canon:start…canon:end` block from an existing adopter's `CLAUDE.md`/`AGENTS.md`, preserving everything outside the block. Needed because `upgrade` no longer migrates them. Runs against the finite, non-growing set of pre-2.0.0 adopters (canon-ai maintainer's repos, James's submodule repo).
4. **Slim canon-ai's own root `CLAUDE.md`/`AGENTS.md`** to a deliberately-minimal local operator doc: remove the now-inert delimiter markers and drop the rules that Task A relocated into skills/prompts, keeping only ambient operator context not covered on-trigger by a skill. Because these files have left `DELIMITED` and the templates are deleted, they are now purely canon-ai-local — nothing syncs or ships them — so this is a self-contained, reversible edit with zero adopter impact.
5. **Resolve deferred nit N5**: the QA prompt lists `AGENTS.md` as a lesson-promotion target. With canon no longer treating `AGENTS.md` as a rules home, drop it from that list.
6. **Update outward and authority surfaces**: README (no longer managed; optional no-self-review practice; corrected `upgrade` description) and `docs/decisions.md` (record the end state; fix the stale "delimited AGENTS.md/CLAUDE.md" reference).
7. **Re-scope `canon doctor` and the CI smoke to the no-scaffold reality.** `canon doctor` stops treating absent/undelimited `CLAUDE.md`/`AGENTS.md` as failures — Task B's `checkCanonDiscoveryNudge` (warn-only, already wired into `doctorCmd`) becomes the sole agent-file check; the CI git-install smoke stops asserting `canon init` created the two files. Without this, a fresh post-`2.0.0` repo satisfies AC-5 yet `canon doctor` and CI report the now-adopter-owned files as broken/missing.
8. **Sweep stale "managed/scaffolded/delimited" references** out of every shipped/authority surface — docs and the `/canon-init` skill (whose grill currently scans "below `<!-- canon:end -->`" and runs a canon-block merge protocol for these files) — so nothing still describes canon as owning them (AC-13).

This is a breaking change for adopters (their `.canon`-managed `CLAUDE.md`/`AGENTS.md` stop being managed and require the one-off migration), so it is the trigger for the program's `2.0.0` major — but the version bump itself is the separate release step, not this task.

## Non-Goals

- **No version bump or CHANGELOG version line.** This task lands unreleased on `main`; the release step owns `2.0.0`. QA proposes changelog **entry text only**, never a version/bump tier (per `docs/decisions.md` §Versioning).
- **Do not retire the delimited-merge machinery.** `mergeDelimited`, `CANON_START_RE`, `CANON_END`, and the `upgrade`/sync delimited loops must still exist and still work after this task — only the two list entries are removed. A future file can be re-added to `DELIMITED` with no further code change. (Backed by AC-2 + AC-3.)
- **Do not ship the migration tool in the npm package.** It lives outside `package.json` `files`; adopters who vendor canon as a submodule get it via the repo, not the published package. (Backed by AC-9.)
- **Do not add a `canon doctor` residual-block detector.** The finite migration set + the tool cover it; a permanent shipped check for a ~zero post-migration audience cuts against the program's subtractive goal.
- **Do not run the migration tool against canon-ai's own files.** canon-ai keeps its curated (slimmed) content; the tool is for adopters whose block was pure canon redundancy.
- **Do not re-touch Task A's relocated prompts/charters/skills or Task B's discovery nudge.** This task assumes Task A's relocation is complete and correct.
- **Do not seed the discovery nudge into any file.** Task B settled recommend-only; `init` adds nothing.
- **Do not change `checkCanonDiscoveryNudge`.** It shipped in Task B and becomes the sole `canon doctor` agent-file check by *removing the other two checks*, not by editing it.
- **Do not change the CI path filters** (`ci.yml` `paths:` lists that re-run CI when `AGENTS.md`/`CLAUDE.md` change). canon-ai still has those files; only the in-test presence asserts and the "canon-managed / sync-templates" *rationale prose* (in `docs/architecture.md`) change.
- **Do not rewrite `docs/BACKLOG.md` or `docs/lessons-learned.md`.** Both are internal append-only history; their references to the old managed model are an accurate record, not a stale shipped surface. They are explicitly out of the AC-13 sweep.

## Acceptance Criteria

- [ ] **AC-1 — `DELIMITED` no longer manages the two files.** After the change, `DELIMITED` in `src/lib/canon-owned.ts` contains neither `AGENTS.md` nor `CLAUDE.md`. Verify: `git grep -n "AGENTS.md\|CLAUDE.md" src/lib/canon-owned.ts` shows no `DELIMITED` membership for those two paths.
- [ ] **AC-2 — Delimited machinery retained and still functional.** `mergeDelimited` (currently exported from `src/cli/commands/upgrade.ts`) and the marker constants `CANON_START_RE`/`CANON_END` (currently private in `upgrade.ts` and `scripts/sync-canon-templates.mjs`) remain present with unchanged behavior; the `upgrade` and sync-hook loops that iterate `DELIMITED` remain present (now iterating an empty list as a no-op). If the migration tool imports the marker constants rather than inlining them, exporting them is an acceptable mechanic. Verify: the existing fixture-based `mergeDelimited` / `mergeDelimitedForSync` tests in `tests/cli.test.ts` and `tests/sync-canon-templates.test.ts` remain present and pass (they exercise the machinery via fixtures, independent of `DELIMITED` contents).
- [ ] **AC-3 — A file can be re-added to `DELIMITED` with no code change.** Demonstrated by AC-2's retained tests; no new code path is required to manage a future delimited file. (Contract assertion; no separate runtime check.)
- [ ] **AC-4 — Template files deleted.** `templates/CLAUDE.md` and `templates/AGENTS.md` do not exist after the change. Verify: both paths absent from the working tree (`git status` shows them deleted) and `git grep` finds no code path that reads them by name.
- [ ] **AC-5 — `canon init` adds neither file.** Running `canon init` in a fresh directory with no pre-existing `CLAUDE.md`/`AGENTS.md` creates neither file. Verify: a test (extending the init tests in `tests/cli.test.ts`) asserts that after `init` in a temp dir, `CLAUDE.md` and `AGENTS.md` do not exist.
- [ ] **AC-6 — `canon init` detects pre-existing agent files for the grill *without promising a merge protocol*.** When `CLAUDE.md` and/or `AGENTS.md` already exist in the target dir, `init`'s grill-launch note about existing agent files still fires, and the detection does not depend on the deleted templates. The note must **no longer** state that the grill "will run the merge protocol on them automatically" (`src/cli/commands/init.ts:151-153`); it must reflect the adopter-owned / no-merge reality — i.e. the grill reads pre-existing agent files as project context and does not insert or merge a canon-managed block. Verify: (a) a test asserts the "existing agent files" path is taken when those files pre-exist and not taken when they don't; (b) `git grep -niI 'merge protocol' -- src/cli/commands/init.ts` returns nothing — no `src/` CLI string still promises a canon merge for `AGENTS.md`/`CLAUDE.md`; (c) the reviewer confirms the replacement note carries no other "managed/merged canon block" framing for the two files. **Out of scope:** the pre-existing `.gitignore` `canon:start`/`canon:end` marker warning at `init.ts:66` is about the adopter's `.gitignore` managed block, not the agent files — leave it untouched. (This closes the gap that AC-13's sweep, which excludes `src/`, would otherwise leave; surfaced by Codex `spec_review`.)
- [ ] **AC-7 — `canon upgrade` does not touch `CLAUDE.md`/`AGENTS.md`.** With a `CLAUDE.md` (or `AGENTS.md`) present that contains arbitrary content, `canon upgrade` leaves it byte-identical. Verify: a test asserts upgrade does not modify a pre-existing `CLAUDE.md`/`AGENTS.md` (they are in neither `DELIMITED` nor `CANON_OWNED`).
- [ ] **AC-8 — Migration tool exists with the specified contract.** `tools/strip-canon-block.mjs` exists and, for each of `CLAUDE.md` and `AGENTS.md` in the target repo: (a) if both markers are present, removes the `canon:start`-through-`canon:end` block inclusive and preserves all content outside it; (b) if markers are absent, leaves the file unchanged and reports a no-op; (c) in **write mode**, refuses to write and exits non-zero if the target git tree is dirty; (d) supports `--check`/`--dry-run`, which report only and write nothing — and therefore run **regardless of git-tree state** (the dirty-tree guard gates writes only, so check/dry-run never refuse); (e) is idempotent (a second run is a no-op). Verify: a test file under `tests/` drives the tool over fixtures covering present-block, absent-block, idempotency, dirty-tree write-refusal, and `--check`-on-a-dirty-tree-still-reports (refusal/precedence may be asserted via a unit-level check of the dirty-tree guard).
- [ ] **AC-9 — Migration tool does not ship.** `tools/strip-canon-block.mjs` is not included by `package.json` `files`. Verify: `files` lists no `tools/` entry; `npm pack --dry-run` (or equivalent inspection) does not include the tool.
- [ ] **AC-10 — canon-ai's own files have no delimiter markers and are slimmed.** Root `CLAUDE.md` and `AGENTS.md` contain no `<!-- canon:start -->` or `<!-- canon:end -->` markers, are materially smaller (the relocated rules are gone), and still contain the "must survive" content from the Design contract. Verify: `git grep -n "canon:start\|canon:end" CLAUDE.md AGENTS.md` returns nothing; a reviewer confirms the slim follows the plan's partition and the must-survive norms remain.
- [ ] **AC-11 — No operator rule is orphaned by the slim.** Every section removed from canon-ai's `CLAUDE.md`/`AGENTS.md` in the slim has a surviving home in a named skill (`.claude/skills/canon-*`) or per-phase prompt (`scripts/run-task/prompts/templates/*`). Any other doc that cross-referenced a dropped section (e.g. `docs/codebase-map.md:165/180` pointing at `AGENTS.md`/`CLAUDE.md` for handoff/authorship rules) is repointed to the surviving home. Verify: the handoff includes a mapping table (dropped section → surviving home with `file` reference, plus any repointed cross-references); the reviewer spot-checks each.
- [ ] **AC-12 — N5 resolved.** In `scripts/run-task/prompts/templates/qa.md`, the lesson-promotion target list no longer names `AGENTS.md` (it reads `patterns.md / decisions.md`). Verify: `git grep -n "patterns.md / decisions.md" scripts/run-task/prompts/templates/qa.md` matches and the same line no longer contains `AGENTS.md`. Regenerate `tests/run-task-prompts.golden.json`.
- [ ] **AC-13 — Stale "managed/scaffolded/delimited CLAUDE.md/AGENTS.md" references swept.** No shipped or authority surface still describes `CLAUDE.md`/`AGENTS.md` as canon-managed, canon-scaffolded, or delimited (nor instructs scanning/merging around `<!-- canon:end -->` for them). The allow-list, built from the *current* tree during this revision, is: `README.md`; `docs/pipeline-orchestrator.md` (:295 `AGENTS.md §Docs Freshness` cross-ref, :461 "files canon scaffolded"); `docs/architecture.md` (:153 "canon-managed root files … sync-templates:check"); `docs/product-context.md` (:57 "scaffolds `AGENTS.md`, `CLAUDE.md`"); `docs/decisions.md` (:133 guidance-docs list, :159 "the delimited `AGENTS.md` / `CLAUDE.md`"); `.claude/skills/canon-init/SKILL.md` (:24 scan-below-`canon:end`, :112 "merge protocol for `AGENTS.md` / `CLAUDE.md`"); `.claude/skills/canon-init/write-guide.md` (:15, :67 merge-protocol / content-below-`canon:end`). For the three **CANON_OWNED** files in that list (the two `canon-init` skill files and `docs/pipeline-orchestrator.md`), their `templates/` mirrors must also be updated/staged (root→`templates/` sync; per the canon-managed-file convention and `docs/lessons-learned.md`). **Excluded from the sweep**: `docs/BACKLOG.md` and `docs/lessons-learned.md` (internal append-only history; see Non-Goals). **`src/` is also outside this grep by design** — the one user-facing source string that names these files in a managed/merge context (the `init.ts` grill note) is covered by AC-6, and the only other `src/` references are the `DELIMITED` definition (AC-1) and an internal code comment (AC-2/`upgrade.ts` row); no other `src/` CLI output asserts canon owns these files (verified at spec time via `git grep` of `src/`). Verify: after the edits, `git grep -nI -e 'AGENTS\.md' -e 'CLAUDE\.md' -- README.md docs/ .claude/skills/ ':!docs/BACKLOG.md' ':!docs/lessons-learned.md' ':!tasks/' | grep -iE 'manage|delimit|scaffold|canon:end|canon:start|merge protocol'` returns no line that still asserts canon owns/manages these files (re-derive the allow-list from the current tree at implement time in case of drift, not solely from this list).
- [ ] **AC-14 — README updated.** README states `CLAUDE.md`/`AGENTS.md` are adopter-owned (not canon-managed), corrects the `canon upgrade` description accordingly, and adds an optional "recommended practice" note: when doing below-pipeline work, don't self-review — get an independent cross-review (the `/canon-inline-review` skill, or `codex review` if not running canon). Verify: reviewer confirms the three edits are present.
- [ ] **AC-15 — `docs/decisions.md` updated.** A new decision entry records the end state (canon ships zero managed content into adopter `CLAUDE.md`/`AGENTS.md`); the existing stale reference to "the delimited `AGENTS.md` / `CLAUDE.md`" in the "Canon prescribes no release model" entry is corrected. Verify: reviewer confirms both.
- [ ] **AC-16 — `canon doctor` stops enforcing the two files; the discovery nudge is the sole agent-file check.** The two `checkAgentFile(cwd, 'AGENTS.md')` / `checkAgentFile(cwd, 'CLAUDE.md')` calls are removed from `doctorCmd`'s `canonChecks` (`src/cli/commands/doctor.ts:669-670`), and the now-unused `checkAgentFile` function (`doctor.ts:197-207`) and its four unit tests (`tests/cli.test.ts:307-335`) are deleted. `checkCanonDiscoveryNudge` (Task B, warn-only) remains as the discovery surface. Verify: in a temp dir containing neither file, `doctorCmd`'s canon checks produce **no** `status: 'fail'` attributable to `AGENTS.md`/`CLAUDE.md` (a test asserts this), and `git grep -n "checkAgentFile" src` returns nothing.
- [ ] **AC-17 — CI git-install smoke updated for the no-scaffold reality.** In `.github/workflows/ci.yml`, the git-install smoke job no longer asserts `test -f AGENTS.md` / `test -f CLAUDE.md` after `canon init` (`ci.yml:125-126`), and the subsequent `canon doctor` step (`ci.yml:129`) exits 0 with both files absent (enabled by AC-16). The CI `paths:` filters are left unchanged (Non-Goals). Verify: the two `test -f` lines are gone, the `canon doctor` invocation remains, and CI is green on the task branch (CI itself is the runtime check).
- [ ] **AC-18 — Build, golden, and full validation are clean.** `dist/` is rebuilt (src changes), `tests/run-task-prompts.golden.json` is regenerated (qa.md change), and lint / type-check / unit tests / docs-refs all pass. Verify: Validation Outcomes table shows each as Pass with no `Fail`.

## Design

### canon-ai slim — contract

Slim canon-ai's root `CLAUDE.md`/`AGENTS.md` to ambient operator context only. The **principle**: keep what a skill/prompt does *not* carry on-trigger; drop what Task A already relocated into skills/prompts. The two binding contracts (everything else is a plan decision):

- **Must survive** (positive contract — losing any of these is the failure mode): the always-on operator norms that no skill re-states on trigger — ask before committing, never self-review inline work, default toward smaller models / lower effort, don't intervene in full-tier `spec_review` auto-revision — plus the Role/two-mode/spec-gate framing and thin pointers to the `/canon-*` skills and `docs/pipeline-orchestrator.md`.
- **No orphaned rule** (AC-11): any content dropped from the files must have a surviving home in a named skill or prompt.

The exact section-by-section partition and destinations are deferred to the plan (Claude-authored after `spec_review`), which produces the AC-11 mapping table; the implementer executes that partition.

### Migration tool contract

`tools/strip-canon-block.mjs` — a Node ES module, runnable directly (`node tools/strip-canon-block.mjs [--check]`), operating on the current working directory's `CLAUDE.md` and `AGENTS.md`. It removes the `canon:start…canon:end` block (inclusive) and preserves all surrounding content; no-op + clear message when markers are absent (gracefully handles the submodule repo whose block may be stale/missing); in write mode refuses on a dirty git tree; `--check`/`--dry-run` reports without writing and runs regardless of tree state (the dirty-tree guard gates writes only); idempotent. May import `CANON_START_RE`/`CANON_END` (retained) or inline them.

### `canon doctor` + CI + `/canon-init` re-scope

A fresh post-`2.0.0` repo has neither `CLAUDE.md` nor `AGENTS.md` (AC-5), so three surfaces that currently *require* those files must stop:

- **`canon doctor`**: today `doctorCmd` runs `checkAgentFile` for both files, which returns `fail` when a file is missing; `doctorCmd` then `process.exit(1)` on any fail. Remove the two calls (AC-16). Task B's `checkCanonDiscoveryNudge` (already in `canonChecks`, warn-only) is the replacement: it warns if neither `CLAUDE.md` nor `AGENTS.md` mentions canon, never fails. Net effect: doctor advises on discovery, never blocks on file presence.
- **CI git-install smoke**: drops the two `test -f` asserts; the `canon doctor` step that follows then passes because of AC-16 (AC-17).
- **`/canon-init` skill**: its Phase 0 ("scan below `<!-- canon:end -->`") and the write-guide merge protocol assume canon ships a delimited block into these files. With no block shipped, those steps are stale. Collapse them to: detect pre-existing `AGENTS.md`/`CLAUDE.md` (still useful context for the grill), treat the whole file as adopter-owned, do not scaffold or merge a canon block. Exact prose is deferred to the plan (judgment-heavy, like the canon-ai slim); the AC-13 sweep is the structural backstop that no "managed/merge/`canon:end`" framing for these files survives.

### Affected Files

| File | Change |
|---|---|
| `src/lib/canon-owned.ts` | Remove `AGENTS.md`/`CLAUDE.md` from `DELIMITED` (→ empty list). Machinery and exports unchanged. |
| `src/cli/commands/upgrade.ts` | Machinery unchanged (AC-2 — `mergeDelimited`, the delimited loop, marker constants all stay). Only generalize the now-stale illustrative comment `// --- Delimited files (AGENTS.md, CLAUDE.md) ---` (`:208`) so it no longer names the two files that left `DELIMITED`. If the migration tool imports the marker constants, export them here (AC-2 permits this). |
| `src/cli/commands/init.ts` | Rewire existing-agent-file detection (currently inferred from the scaffold skip-list) to a direct presence check, since the templates are gone; `init` scaffolds neither file. Also rewrite the `launchGrill()` note (`:151-153`) that currently promises the grill "will run the merge protocol on them automatically" — reflect the adopter-owned / no-merge reality (AC-6). |
| `src/cli/commands/doctor.ts` | AC-16: remove the two `checkAgentFile(cwd, 'AGENTS.md'\|'CLAUDE.md')` calls from `canonChecks` (`:669-670`) and delete the now-unused `checkAgentFile` function (`:197-207`). `checkCanonDiscoveryNudge` (Task B) stays as the sole agent-file/discovery check. |
| `.github/workflows/ci.yml` | AC-17: remove the `test -f AGENTS.md` / `test -f CLAUDE.md` smoke asserts (`:125-126`) so the git-install smoke + subsequent `canon doctor` pass with neither file scaffolded. Leave the `paths:` filters unchanged. |
| `templates/CLAUDE.md` | Delete. |
| `templates/AGENTS.md` | Delete. |
| `tools/strip-canon-block.mjs` | New. One-off migration tool per the contract above (non-shipped). |
| `CLAUDE.md` | Slim per the keep/drop partition; remove delimiter markers. |
| `AGENTS.md` | Slim per the keep/drop partition; remove delimiter markers. |
| `scripts/run-task/prompts/templates/qa.md` | N5: drop `AGENTS.md` from the lesson-promotion target list. |
| `tests/run-task-prompts.golden.json` | Regenerate (qa.md change). |
| `README.md` | Mark `CLAUDE.md`/`AGENTS.md` adopter-owned; correct `canon upgrade` description; add optional no-self-review practice note (AC-14, AC-13). |
| `docs/decisions.md` | New end-state entry; fix stale "delimited AGENTS.md/CLAUDE.md" reference in the release-model entry (`:159`) and the guidance-docs list (`:133`) (AC-15, AC-13). |
| `docs/architecture.md` | AC-13: drop "canon-managed root files … sync-templates:check" framing for `AGENTS.md`/`CLAUDE.md` at `:153` (they no longer sync). PIPELINE_MANAGED_DOC — list here so the auto-commit allow-list accepts it. |
| `docs/product-context.md` | AC-13: `:57` no longer says `canon init` scaffolds `AGENTS.md`/`CLAUDE.md`. PIPELINE_MANAGED_DOC — listed for the auto-commit allow-list. |
| `docs/pipeline-orchestrator.md` | AC-13: `:461` ("files canon scaffolded") and `:295` (`AGENTS.md §Docs Freshness` cross-ref) reflect the new reality. CANON_OWNED → its `templates/` mirror updates with it. |
| `templates/docs/pipeline-orchestrator.md` | AC-13 mirror of the above (root→`templates/` sync; staged for the `--pr` base-drift gate). |
| `.claude/skills/canon-init/SKILL.md` | AC-13: `:24` (scan-below-`canon:end`) and `:112` (merge protocol for `AGENTS.md`/`CLAUDE.md`) — collapse the canon-block merge framing to "adopter-owned; not scaffolded/merged" (exact prose deferred to plan). CANON_OWNED. |
| `templates/.claude/skills/canon-init/SKILL.md` | AC-13 mirror (root→`templates/` sync; staged for base-drift gate). |
| `.claude/skills/canon-init/write-guide.md` | AC-13: `:15`, `:67` — drop the `AGENTS.md`/`CLAUDE.md` merge-protocol / content-below-`canon:end` steps. CANON_OWNED. |
| `templates/.claude/skills/canon-init/write-guide.md` | AC-13 mirror (root→`templates/` sync; staged for base-drift gate). |
| `tests/cli.test.ts` | Update for empty `DELIMITED`; add AC-5/AC-6/AC-7 init+upgrade assertions and the AC-16 "doctor doesn't fail on absent agent files" assertion; delete the four `checkAgentFile` unit tests (`:307-335`) and its import; keep fixture-based `mergeDelimited` tests (AC-2). |
| `tests/sync-canon-templates.test.ts` | Update for empty `DELIMITED`; keep fixture-based merge tests (AC-2). |
| `tests/strip-canon-block.test.ts` | New. Drives the migration tool over fixtures (AC-8). |
| `docs/codebase-map.md` | Repoint the two wiring-map references (`:165`, `:180`) that name `AGENTS.md`/`CLAUDE.md` as the home of handoff/authorship rules — to the JIT homes (per-phase prompt templates) those rules moved to in Task A / the slim. Bounded: repoint references, don't rewrite the maps. PIPELINE_MANAGED_DOC. |
| `templates/docs/architecture.md` | AC-13 `templates/` mirror of `docs/architecture.md`: corrected stale root-agent-file authority/sync references (documented handoff deviation — managed-doc roots are auto-allowlisted but their mirrors are not). |
| `templates/docs/product-context.md` | AC-13 `templates/` mirror of `docs/product-context.md`: corrected `canon init` scaffolding claim. |
| `templates/docs/decisions.md` | AC-13 `templates/` mirror of `docs/decisions.md`: corrected stale release-policy root-agent-file references. |
| `templates/docs/codebase-map.md` | AC-13 `templates/` mirror of `docs/codebase-map.md`: corrected root-agent-file authority references. |
| `scripts/run-task/prompts/helpers.ts` | Amendment: drop the `AGENTS.md`/`CLAUDE.md` read-instructions from `CLAUDE_STARTUP` (`:5`), `CODEX_STARTUP` (`:13`), and the resumed-session note (`:49`). Bundled into `dist/`; feeds the prompt golden. |
| `dist/` | Rebuilt artifacts (src changes). |

> Build-generated artifacts: `dist/` is regenerated by `npm run build` and `tests/run-task-prompts.golden.json` by `UPDATE_GOLDENS=1 npm test`; both are committed and listed above so the `--pr` base-drift gate accepts them.

### Interaction Dependencies

- **Pre-commit sync hook** (`scripts/sync-canon-templates.mjs --stage`): once `CLAUDE.md`/`AGENTS.md` leave `DELIMITED` and the templates are deleted, the hook no longer attempts to sync them. `npm run sync-templates:check` (CI) must stay green with the empty `DELIMITED`.
- **`canon doctor`** (Task B discovery nudge): the two `checkAgentFile` presence checks are removed (AC-16); `checkCanonDiscoveryNudge` itself is unchanged and still passes because canon-ai's slimmed `CLAUDE.md` still mentions canon. It becomes the load-bearing (warn-only) discovery surface for adopters whose block is stripped.
- **Pipeline startup constants** (`CODEX_STARTUP`/`CLAUDE_STARTUP`): they instruct agents to read `AGENTS.md`/`CLAUDE.md`. **Superseded by `## Amendment` below** — the original "No change required" judgment was wrong: the instruction is dead weight (Claude Code auto-loads `CLAUDE.md`, Codex auto-loads `AGENTS.md` when present; the instruction dangles when a no-scaffold adopter has neither), so the amendment removes it entirely. Rules already arrive via the injected per-phase prompts.

### Data Model Changes

None. `DELIMITED` becomes an empty array; its type is unchanged.

## Validation Required

| Change Type | Required Check Categories |
|---|---|
| Source (`src/`: `canon-owned.ts`, `init.ts`, `doctor.ts`), build artifacts | Linting, type checking, unit tests, full build |
| Prompt template (`qa.md`) | Golden regeneration + unit tests |
| Docs / README / cross-references | Docs references |
| CI workflow (`ci.yml` git-install smoke) | CI run on the task branch (the smoke job is the runtime check for AC-17) |

- [x] `npm run lint`
- [x] `npm run build` — rebuild `dist/` (src changes are baked into the bundle)
- [x] `npm test` — full suite; also run `UPDATE_GOLDENS=1 npm test` once to regenerate the golden after the qa.md edit, then confirm a clean `npm test`
- [x] `npm run docs-refs-check` — README + docs edits and any changed cited paths
- [ ] E2E — N/A (no UI/runtime surface)

## Docs Impact

- `docs/decisions.md` — **changed** (AC-15): new end-state entry + corrected release-model (`:159`) and guidance-docs (`:133`) references.
- `docs/architecture.md` — **changed** (AC-13): `:153` "canon-managed root files … sync-templates:check" framing for `AGENTS.md`/`CLAUDE.md` corrected.
- `docs/product-context.md` — **changed** (AC-13): `:57` no longer claims `canon init` scaffolds the two files.
- `docs/pipeline-orchestrator.md` (+ `templates/` mirror) — **changed** (AC-13): `:461`, `:295`.
- `docs/codebase-map.md` — **changed**: `:165`, `:180` wiring pointers repointed off `AGENTS.md`/`CLAUDE.md` (see Affected Files; tied to AC-11's no-orphan audit).
- `docs/patterns.md` — review during the AC-13 sweep; update only if a hit surfaces.

## Known Risks

- **Slim orphans an operator rule (highest risk).** If a dropped section's content is *not* actually carried by a skill/prompt, the operator silently loses ambient guidance. Mitigated by AC-11's mapping audit and by the conservative keep-list (keep all always-on norms + connective tissue). Reversible: canon-ai's files are local-only after this task, so a missed keep is a one-line restore with no adopter/release impact. The Human Test Plan includes a read-through of the slimmed files.
- **Codex implementing a judgment-heavy doc rewrite.** The slim is content curation, not mechanical edits. Mitigated by pinning the keep/drop partition at section granularity in Design so the implementer follows a partition rather than exercising judgment, plus the AC-11 audit and human read-through.
- **`init` detection regression.** Rewiring existing-agent-file detection off the (deleted) scaffold skip-list could silently always-report "no existing files," breaking the grill's merge note. Mitigated by AC-6's two-way test (present and absent).
- **Migration tool corrupts an adopter file.** A bad regex/slice could drop content outside the block. Mitigated by the dirty-tree refusal (clean reviewable diff), `--check`, idempotency, and AC-8 fixture coverage including content-outside-block preservation.
- **Empty `DELIMITED` breaks an assumption.** A test or code path may assume `DELIMITED` is non-empty. Mitigated by AC-2/AC-7 and updating `tests/cli.test.ts` / `tests/sync-canon-templates.test.ts`.
- **Missed stale reference.** A shipped surface still calling the files "managed" would mislead adopters. Mitigated by AC-13's `git grep` sweep built from the current tree. **Source-side CLI strings are a separate blind spot** — AC-13's sweep deliberately excludes `src/`, so a shipped `console.log` (e.g. the `init.ts` grill note promising a "merge protocol") could otherwise survive a clean sweep; AC-6 closes this for the one user-facing string, and the spec-time `src/` grep confirmed there are no others. (Surfaced by Codex `spec_review`; see also `docs/lessons-learned.md` — ownership-change sweeps must include shipped CLI output, not only docs.)
- **`canon doctor` / CI still require the vacated files.** The original spec stopped scaffolding the files but left `canon doctor` (`process.exit(1)` on a missing-file `fail`) and the CI smoke (`test -f`) enforcing them — a fresh repo would pass AC-5 yet fail doctor/CI. Mitigated by AC-16 (remove the checks; rely on the warn-only nudge) + AC-17 (drop the smoke asserts), with the CI run itself as the end-to-end check. Surfaced by Codex `spec_review`.
- **`/canon-init` skill drives a now-impossible merge.** Left unchanged, the grill would scan for a `canon:end` block that no longer ships and run a merge protocol with nothing to merge. Mitigated by AC-13 (the skill files + their `templates/` mirrors are in scope) and the Design re-scope note; exact prose lands in the plan.

## Human Test Plan

1. In a scratch copy of a repo that still has the old canon block in its `CLAUDE.md`/`AGENTS.md`, run the migration tool in check mode and confirm it reports it would remove the canon block and nothing else. Run it for real and confirm: the block is gone, everything you wrote outside the block is untouched, and running it a second time reports nothing to do. Confirm it refuses to run when the repo has uncommitted changes.
2. In a brand-new empty folder, initialize canon and confirm it does **not** create a `CLAUDE.md` or `AGENTS.md`, and that setup never tries to insert or merge a canon-managed block into them. In a folder that already has those files, initialize canon and confirm it still notices them (reads them as project context for setup) without altering them.
3. In a brand-new folder, run the canon health check after initializing and confirm it does **not** flag the absent agent files as errors — at most a gentle suggestion to mention canon somewhere so the project is discoverable.
4. In a repo that already has a `CLAUDE.md`, run the canon upgrade command and confirm your `CLAUDE.md` is left exactly as it was.
5. Read canon-ai's own slimmed `CLAUDE.md` and `AGENTS.md` end to end. Confirm they still tell you who does what, the two operating modes, the spec gate, the always-on habits (ask before committing, never self-review inline work, prefer smaller models), and where to find the rest (the canon skills and the orchestrator doc) — and that nothing you actually rely on day-to-day went missing.
6. Confirm the project's published package would not include the migration tool.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; pipeline writes the plan)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`

## Amendment

**Origin**: Pre-merge review of PR #176 — Codex (`P2`, `helpers.ts:5,13`) and CodeRabbit (`CLAUDE.md` reading list). Supersedes the "No change required" note under *Interaction Dependencies → Pipeline startup constants*.

**Problem**: The pipeline startup helpers hard-instruct every agent to "Read `AGENTS.md`" (`CLAUDE_STARTUP` `helpers.ts:5`; `CODEX_STARTUP` `:13`) and name it in the resumed-session note (`:49`). With the agent files now adopter-owned and not scaffolded, this is dead weight: Claude Code auto-loads `CLAUDE.md` and Codex auto-loads `AGENTS.md` when present, so the instruction is redundant; when a fresh adopter has neither, every pipeline session is pointed at a path that does not exist. The universal rules already arrive via the injected per-phase prompts, so dropping the instruction loses nothing.

**Decision**: Remove all `AGENTS.md`/`CLAUDE.md` read-instructions and references from the pipeline prompt layer (`scripts/run-task/prompts/`). Do **not** make them conditional — drop them. Agents rely on their auto-loaded agent file (if the adopter maintains one) plus the injected prompt rules and the scaffolded knowledge-corpus docs, which the startup text continues to name.

**Out of scope — tracked as a separate follow-up task**: recommending adopters keep `AGENTS.md`; having `/canon-init` generate a high-level starter when one is absent; pointing `CLAUDE.md` at `AGENTS.md`; and a `canon doctor` advisory for missing agent files. This amendment only removes the dead-weight prompt references.

### Amendment Acceptance Criteria

- **AC-A1** — `CLAUDE_STARTUP` (`helpers.ts:5`) and `CODEX_STARTUP` (`helpers.ts:13`) no longer instruct reading `AGENTS.md`/`CLAUDE.md`; remaining startup reads name only scaffolded knowledge-corpus docs (`docs/patterns.md`, `docs/codebase-map.md`, `docs/lessons-learned.md`, …). The resumed-session note (`helpers.ts:49`) no longer names `AGENTS.md`.
- **AC-A2** (structural) — `git grep -nE 'AGENTS\.md|CLAUDE\.md' -- scripts/run-task/prompts/` returns no matches.
- **AC-A3** — `docs/lessons-learned.md` is added to canon-ai's own `CLAUDE.md` conversational-session reading list (CodeRabbit finding); the pipeline helpers already skim it.
- **AC-A4** — `tests/run-task-prompts.golden.json` regenerated for the helper change and `dist/` rebuilt; `npm test`, `npm run build`, `npm run docs-refs-check`, `npm run sync-templates:check` all pass.

### Amendment Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`UPDATE_GOLDENS=1 npm test` then `npm test` — golden regen)
- [x] `build` (`npm run build` — dist bundles the helper change)
- [x] `docs-refs-check` (`npm run docs-refs-check`)
