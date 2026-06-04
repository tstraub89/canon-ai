# Spec: retire-codex-md — Retire CODEX.md — no tool reads it

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`CODEX.md` is a canon invention that **no tool reads**. Verified against the live wiring and vendor docs:

- The **Codex CLI** auto-loads `AGENTS.md` (then `AGENTS.override.md` / `project_doc_fallback_filenames`), walking `~/.codex` → repo-root → cwd. It has **no notion of `CODEX.md`**, and fallback filenames are consulted only when `AGENTS.md` is *absent* at a level — so they can't supplement it. (OpenAI Codex docs, May 2026.)
- Canon's orchestrator never helps: `codex` is spawned as `codex -m <model> -C <cwd> <prompt>` (`scripts/run-task/agents/codex.ts`), and `CODEX_STARTUP` (`scripts/run-task/prompts/helpers.ts`) tells Codex to read `AGENTS.md`, `docs/patterns.md`, `docs/codebase-map.md` — never `CODEX.md`. No prompt template injects it.
- The only path into Codex's context is the soft "See `CODEX.md` for full Codex guidance" pointer at `AGENTS.md:200`, which the model may or may not follow.

So `CODEX.md` is a **declared file with no executable reader** — the inverse of the drift class `docs/decisions.md:162` calls a bug. Meanwhile the file is propped up by machinery that assumes it exists (`DELIMITED` sync, `canon init` scaffolding, `canon doctor`, `docs-refs-check`, a CI `test -f CODEX.md`), so it can't simply be deleted. Its content is ~all duplicated in `AGENTS.md` + the orchestrator prompt templates; the **only** unique, load-bearing content is the file-revert mechanics under "Iterating After Review."

The correct model (and the cross-tool `AGENTS.md` standard): `AGENTS.md` is the tool-agnostic source of truth *and the only file Codex reliably reads*; `CLAUDE.md` is Claude Code's natively-loaded file. There is no per-tool `CODEX.md`.

## Decision

Retire `CODEX.md` from canon. Concretely:

1. **Rescue** the one piece of unique content — the file-revert mechanics ("Iterating After Review" in `CODEX.md`) — into `AGENTS.md`, which Codex reads natively.
2. **Stop shipping it**: remove `CODEX.md` from every machinery list that creates, syncs, checks, or asserts it; delete the root `CODEX.md` and its `templates/` mirror from canon's own repo.
3. **Warn, don't auto-delete, for existing adopters**: `canon doctor` flags a present `CODEX.md` as deprecated and suggests deletion; it never mutates or recreates the file. `canon upgrade` simply stops managing it (it falls out of `DELIMITED`). Adopters who already committed a `CODEX.md` keep it (now orphaned) until they choose to delete it.
4. **Sweep all references** so docs and machinery flip in lockstep — no window where a doc describes a two-file world the code hasn't shipped.

## Non-Goals

- **Not** changing how `CLAUDE.md` loads `AGENTS.md` (the documented `@AGENTS.md` import idiom is a separate, optional polish — explicitly out of scope here).
- **Not** auto-deleting or rewriting any adopter's existing `CODEX.md` on `upgrade`/`init` (warn only).
- **Not** rewriting historical records: `CHANGELOG.md` and `docs/BACKLOG.md` mentions of `CODEX.md` stay as-is (they describe what happened, not current behavior).
- **Not** migrating CODEX.md content that is already covered elsewhere (spec-review checklist → `spec-review.md` prompt; validation result enum → `.canon/templates/handoff.md` + `qa.md`/`done.md`; "ACs binding / plan is guidance" → `implement.md` prompt + `AGENTS.md`). Only the file-revert mechanics move.

## Acceptance Criteria

- [ ] **AC-1 (content rescue, no loss):** The file-revert mechanics currently in `CODEX.md` "Iterating After Review" — `git restore` is blocked in the sandbox; byte-perfect revert via `git show origin/<base-branch>:<path>`; the perfect-revert (drop from all Changes tables) vs imperfect-revert (list with residual-diff note) handling — are present in `AGENTS.md` after the change, materially intact.
- [ ] **AC-2 (file removed):** Root `CODEX.md` and `templates/CODEX.md` no longer exist in canon's repo.
- [ ] **AC-3 (out of canon-managed sets):** `CODEX.md` is removed from `DELIMITED` (`src/lib/canon-owned.ts`), `AGENT_FILES` (`src/cli/commands/init.ts`), and `ROOT_MARKDOWN_FILES` (`scripts/docs-refs-check.mjs`). `npm run sync-templates:check` passes with no `CODEX.md` entry.
- [ ] **AC-4 (`canon init` stops shipping it):** Running `canon init` in a fresh repo creates `AGENTS.md` and `CLAUDE.md` but **not** `CODEX.md`. The `/canon-init` skill (`.claude/skills/canon-init/SKILL.md`, `write-guide.md`) no longer reads, creates, merges, or `git add`s `CODEX.md`.
- [ ] **AC-5 (`canon doctor` warn semantics):** In a repo where `CODEX.md` is **absent**, `canon doctor` shows no `CODEX.md` failure or warning. In a repo where `CODEX.md` is **present**, `canon doctor` emits a **warn** (not fail) stating it is deprecated/unread and safe to delete. `canon doctor` never creates, edits, or deletes the file.
- [ ] **AC-6 (`canon upgrade` stops managing it):** After removal from `DELIMITED`, `canon upgrade` neither recreates, modifies, nor deletes a `CODEX.md` in an adopter repo.
- [ ] **AC-7 (CI updated):** `.github/workflows/ci.yml` no longer contains a `test -f CODEX.md` assertion, and the `CODEX.md` path-filter globs (the `!CODEX.md` / `CODEX.md` re-include pairs) are removed from both `ci.yml` and `.github/workflows/docs-refs-check.yml`. CI passes on the PR.
- [ ] **AC-8 (references swept, lockstep):** Every non-historical reference to `CODEX.md` is removed or rewritten to the two-file model, including the `AGENTS.md` pointers, the `CLAUDE.md` canon-managed-file convention note, the `/canon-init` and `/canon-pipeline` skills, and the protected docs listed in Affected Files. `npm run docs-refs-check` passes (no dangling ref to the deleted file).
- [ ] **AC-9 (structural allow-list — regenerated, not assumed):** After the change, `git grep -n "CODEX\.md"` must show **no occurrence in any file this task owns** — the canon-managed surface (root canon docs, `src/`, `scripts/`, the three skills, the two CI workflows, and the `templates/` mirrors), except the **intentional** ones: the deprecation-warning string in `src/cli/commands/doctor.ts` (and its compiled form in `dist/cli/index.js`) and the test that exercises it. Occurrences remaining in **historical artifacts** (`CHANGELOG.md`, `docs/BACKLOG.md`, `docs/packaging-plan.md` — the dated design-session capture — and `tasks/_archive/**`) and in **other tasks' live artifacts** (`tasks/<other-id>/**`, e.g. `bundle-preflight-atomic-rejection`, `codex-code-review-phase`) are **out of scope and allowed — do not rewrite them** (editing another task's spec mid-flight corrupts its state). **The implementer MUST regenerate the residual list with `git grep` against the working tree and record it in the handoff; the spec reviewer MUST re-run the grep** and confirm every residual occurrence is historical, another task's artifact, or an intentional warn/test/dist reference — never a missed canon surface. Do not treat this spec's Affected Files table or any hardcoded enumeration as the allow-list.
- [ ] **AC-10 (tests reflect intended behavior):** `tests/cli.test.ts` expected-file arrays no longer list `CODEX.md` / `templates/CODEX.md`; `tests/sync-canon-templates.test.ts` comments referencing `CODEX.md` are corrected. A test covers the `canon doctor` deprecation-warn behavior (present → warn; absent → silent). Full suite passes. No test is edited merely to accommodate a regression.
- [ ] **AC-11 (build artifact declared + regenerated):** `npm run build` is run and the regenerated `dist/cli/index.js` is committed; it is listed in Affected Files so the `--pr` base-drift gate accepts it.

## Design

### Affected Files

> Removal allow-list is authoritative via `git grep` (AC-9), not this table — this table lists what the implementer is expected to touch. Line numbers below are **approximate hints**, not contracts: grep for the named symbol/string, not the number.
>
> **`templates/` is not uniformly auto-synced.** Files in `CANON_OWNED`/`DELIMITED` (`templates/AGENTS.md`, `templates/CLAUDE.md`, the two skills, `templates/docs/pipeline-orchestrator.md`, `templates/scripts/docs-refs-check.mjs`) are derived mirrors — edit the root and let `npm run sync-templates` flush them; do **not** hand-edit. The lone exception is `templates/docs/codebase-map.md` (an independently-maintained adopter scaffold, in neither set) — it must be hand-edited.

| File | Change |
|---|---|
| `AGENTS.md` | Migrate the file-revert mechanics from CODEX.md (e.g. adjacent to "Per-iteration artifact convention" or as a short "Reverting files during iteration" note). Remove the `CODEX.md` pointers/refs at lines ~10, ~163, ~194, ~200 (rewrite to the two-file model; the line-200 "see CODEX.md for full Codex guidance" pointer goes away — Codex guidance is AGENTS.md + injected prompt). |
| `templates/AGENTS.md` | Auto-synced from root by the pre-commit hook / `npm run sync-templates` — do not hand-edit. |
| `CLAUDE.md` | Line ~25: drop `CODEX.md` from the "AGENTS.md / CLAUDE.md / CODEX.md" harness mention. Line ~227 (canon-managed-file convention note): remove `CODEX.md` from the `DELIMITED` description. |
| `templates/CLAUDE.md` | Auto-synced — do not hand-edit. |
| `CODEX.md` | **Delete.** |
| `templates/CODEX.md` | **Delete.** |
| `src/lib/canon-owned.ts` | Remove `'CODEX.md'` from `DELIMITED`. |
| `src/cli/commands/init.ts` | Remove `'CODEX.md'` from `AGENT_FILES` (stops `canon init` scaffolding it). |
| `src/cli/commands/doctor.ts` | Replace `checkAgentFile(cwd, 'CODEX.md')` with a deprecation-aware check: warn iff present (deprecated/unread/safe-to-delete), pass/omit when absent. Never mutates the file. |
| `scripts/docs-refs-check.mjs` | Remove `'CODEX.md'` from `ROOT_MARKDOWN_FILES`. |
| `src/cli/commands/upgrade.ts` | Update the `// --- Delimited files (AGENTS.md, CLAUDE.md, CODEX.md) ---` comment (~161) to drop `CODEX.md`. Behavior already follows from the `DELIMITED` removal — this is the comment + an AC-9 occurrence, not a logic change. |
| `dist/cli/index.js` | Regenerated by `npm run build` (bundles the `src/cli` + `canon-owned` changes). Declared per the build-artifact rule. |
| `.github/workflows/ci.yml` | Remove `test -f CODEX.md`; remove the `!CODEX.md` / `CODEX.md` path-filter pairs in both the `push` and `pull_request` blocks. |
| `.github/workflows/docs-refs-check.yml` | Remove the `CODEX.md` path-filter entry. |
| `.claude/skills/canon-init/SKILL.md` | Stop reading (`if CODEX.md exists, read it`), `git add`ing, and listing `CODEX.md` (lines ~22, ~113, ~138). |
| `.claude/skills/canon-init/write-guide.md` | Remove `CODEX.md` from the agent-config merge protocol (lines ~15, ~67). |
| `.claude/skills/canon-pipeline/SKILL.md` | Remove the `CODEX.md — Codex phase-specific guidance` line (~151). |
| `docs/codebase-map.md` | Remove the `Codex guide \| CODEX.md` row and other `CODEX.md` references (~23, ~74, ~142, ~153). |
| `templates/docs/codebase-map.md` | **Hand-edit — NOT auto-synced** (`docs/codebase-map.md` is in neither `CANON_OWNED` nor `DELIMITED`, so `sync-templates` leaves this mirror alone). This is the starter scaffold `canon init` ships to adopters; remove its `CODEX.md` row/refs so new adopters don't receive a doc describing a file they no longer get. |
| `docs/pipeline-orchestrator.md` | Remove `CODEX.md` from the scaffolded-files list and the per-agent guidance line (~399, ~407). (Mirror `templates/docs/pipeline-orchestrator.md` auto-synced.) |
| `docs/product-context.md` | Remove `CODEX.md` from the `canon init` scaffolding list (~57). |
| `docs/patterns.md` | Update the layering-rule reference and handoff-doc reference (~12, ~56) to the two-file model. |
| `docs/architecture.md` | Update the CI path-filter description that lists `CODEX.md` (~153). |
| `docs/decisions.md` | Update the declared-vs-executable rule references from three files to two (~162, ~172). |
| `README.md` | Remove `CODEX.md` from the file lists / descriptions (~106, ~237, ~259). |
| `tests/cli.test.ts` | Remove `CODEX.md` / `templates/CODEX.md` from expected-file arrays (~1953, ~1957, ~2005, ~2022); add coverage for the doctor deprecation-warn behavior. |
| `tests/sync-canon-templates.test.ts` | Correct the `CODEX.md` comments (~300, ~432). |
| `templates/.claude/skills/canon-init/SKILL.md` | Auto-synced mirror of `.claude/skills/canon-init/SKILL.md` (CANON_OWNED) — flushed by `npm run sync-templates` when the root changed; do not hand-edit. Declared so the `--pr` base-drift gate accepts the regenerated mirror. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Auto-synced mirror of `.claude/skills/canon-pipeline/SKILL.md` — same as above. |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror of `docs/pipeline-orchestrator.md` — same as above. |
| `templates/scripts/docs-refs-check.mjs` | Auto-synced mirror of `scripts/docs-refs-check.mjs` — same as above. |

**Leave untouched (historical):** `CHANGELOG.md`, `docs/BACKLOG.md`, and `docs/packaging-plan.md`. The last is a dated design-session capture (its own header: "Captured from design session 2026-05-15 … reference doc for implementation planning") — its three-file (`AGENTS.md` / `CLAUDE.md` / `CODEX.md`) mentions record what was *planned*, not current behavior, so sweeping them would falsify the record. `docs-refs-check` does **not** force a sweep: the one backtick ref (`` `CODEX.md` ``) is gated out by the `validDirs` check (its top-level segment is not a valid dir), and the rest are bare prose or inside a fenced block. (If canon later wants this obsolete design doc *deleted* wholesale, that's a separate curation decision — out of scope here.)

### Interaction Dependencies

- `canon-owned.ts`'s `DELIMITED` is consumed by `scripts/sync-canon-templates.mjs` and `src/cli/commands/upgrade.ts` — removing the entry changes what `upgrade`/`sync` manage. Re-run `sync-templates:check` to confirm consistency.
- This task's worktree branches off `release/v1.9`, which already carries the just-committed flake-rule change (`4f83b83`) that touches `AGENTS.md`/`CLAUDE.md`/`spec-review.md`. The content-rescue edit to `AGENTS.md` must layer on top of that commit, not revert it.
- `canon init` (the CLI command, `init.ts`) and `/canon-init` (the Claude skill) are **two independent scaffolding paths** — both must stop emitting `CODEX.md`.
- **`templates/docs/codebase-map.md` is a non-synced scaffold, not a derived mirror.** `sync-templates` only touches `CANON_OWNED` + `DELIMITED`; `docs/codebase-map.md` is in neither, so editing the root does not flush this template. The reviewer re-running AC-9's grep should expect a hand-edit here, not treat the residual as "should've auto-synced" or as out-of-scope.

### Data Model Changes

None. (`DELIMITED` / `AGENT_FILES` / `ROOT_MARKDOWN_FILES` are static string arrays, not persisted data.)

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `build` (`npm run build`) — required; regenerates and must commit `dist/cli/index.js`
- [x] `docs-refs` (`npm run docs-refs-check`)
- [x] `sync-templates` (`npm run sync-templates:check`)
- [ ] CI smoke (`canon init` + `canon doctor` in a clean env) — runs on CI only; record as `human_pending`, verified on the PR.

## Docs Impact

Protected docs touched (all listed in Affected Files): `docs/codebase-map.md`, `docs/pipeline-orchestrator.md`, `docs/product-context.md`, `docs/patterns.md`, `docs/architecture.md`, `docs/decisions.md`. QA should confirm none still reference `CODEX.md` as a live file.

## Known Risks

- **CI workflow can't be fully exercised locally.** The `ci.yml` smoke job runs `canon init` in a clean shimmed env; a missed `CODEX.md` reference (or a half-removed path-filter glob pair) only surfaces on CI. Mitigation: grep both workflow files carefully; the path-filter globs come in `!CODEX.md` + `CODEX.md` pairs — remove both halves. The CI run on the PR is the real gate (`human_pending`).
- **Allow-list completeness.** A large-removal task's references are easy to under-count from memory; AC-9 mandates regenerating the list via `git grep` (and the spec reviewer re-running it against the current tree). A missed reference fails `docs-refs-check` or leaves a stale doc.
- **Declared-vs-executable lockstep.** Per `docs/decisions.md:162`, the doc edits and the machinery edits must land together (this is one atomic task, so they do) — do not let a doc claim the two-file model while code still ships three.
- **Build artifact drift.** `dist/cli/index.js` must be rebuilt and committed; the `--pr` base-drift gate rejects an undeclared/ stale artifact. It is declared in Affected Files.
- **Adopter orphan files (intended, not a bug).** Existing adopters keep their committed `CODEX.md`; `upgrade` stops touching it and `doctor` nudges deletion. No auto-mutation by design.
- **Sizing:** `task_size: L`, **not** `delicate`. The blast radius is real (adopter machinery) but the failure modes are *loud* — `sync-templates:check`, `docs-refs-check`, the CI `test -f`/smoke, and the test suite all fail closed — so canon's own gates catch them rather than letting a silent regression through. Bump to `delicate` at the gate if you'd rather run the upgraded review over the adopter-facing surface.

## Human Test Plan

1. In a throwaway empty directory, run `canon init`. **Expected:** it creates `AGENTS.md` and `CLAUDE.md` but there is **no** `CODEX.md`.
2. In that same directory, run `canon doctor`. **Expected:** the canon-files section lists `AGENTS.md` and `CLAUDE.md` as healthy and says **nothing** about `CODEX.md` (no error, no warning).
3. Create an empty `CODEX.md` in that directory, then run `canon doctor` again. **Expected:** a **warning** (not a failure) that `CODEX.md` is deprecated / not read by any tool / safe to delete. The file is left untouched.
4. Run `canon upgrade` in that directory. **Expected:** `CODEX.md` is neither recreated nor modified nor deleted.
5. In canon's own repo, confirm there is no longer a `CODEX.md`, and that the guidance on how Codex reverts a file during a review iteration (the `git show origin/<base>:<path>` technique) is findable in `AGENTS.md`.
6. Confirm the PR's CI checks pass.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; plan is a pipeline phase)
- [x] Known Risks covers failure modes for the trickiest ACs (CI workflow, allow-list, lockstep, build artifact)
- [x] Human Test Plan uses product language only (operator-facing `canon` commands, no code/internals)
- [x] Validation Required has at least one entry marked `- [x]`
