# QA Summary: retire-codex-md — Retire CODEX.md — no tool reads it

## What Changed

`CODEX.md` was a declared canon file with no executable reader: the Codex CLI auto-loads `AGENTS.md` and has no notion of `CODEX.md`; the orchestrator prompt templates never injected it. This task removes the file entirely and updates all machinery that created, synced, checked, or asserted it.

**Content rescue.** The one piece of unique content — the file-revert mechanics (`git show origin/<base-branch>:<path>` technique, plus the perfect-revert / imperfect-revert split) — was migrated into `AGENTS.md`, where Codex reads it natively.

**`canon init`** now scaffolds only `AGENTS.md` and `CLAUDE.md`. `CODEX.md` is no longer created or `git add`ed.

**`canon doctor`** emits a deprecation _warn_ (not a failure) when `CODEX.md` is present in a repo, explaining it is unread and safe to delete. When absent, `doctor` is silent — no error, no warning.

**`canon upgrade`** no longer manages `CODEX.md`. Existing adopter files become orphaned; they are never auto-deleted or auto-modified.

**CI workflows** (`ci.yml`, `docs-refs-check.yml`) had their `CODEX.md` path-filter pairs and the `test -f CODEX.md` smoke assertion removed.

**All references swept.** Protected docs, skills (`canon-init`, `canon-pipeline`), README, and templates were updated to the two-file model. `npm run docs-refs-check` and `npm run sync-templates:check` both pass. Historical mentions in `CHANGELOG.md`, `docs/BACKLOG.md`, and `docs/packaging-plan.md` were intentionally left intact (they describe past intent, not current behavior).

## Files Changed

32 files across 2 commits:

- **Deleted:** `CODEX.md` and its `templates/` mirror
- **Source:** `src/lib/canon-owned.ts`, `src/cli/commands/doctor.ts`, `src/cli/commands/init.ts`, `src/cli/commands/upgrade.ts`
- **Build artifact:** `dist/cli/index.js` (rebuilt)
- **Tests:** `tests/cli.test.ts`, `tests/sync-canon-templates.test.ts`
- **Workflows:** `.github/workflows/ci.yml`, `.github/workflows/docs-refs-check.yml`
- **Skills:** `.claude/skills/canon-init/SKILL.md`, `.claude/skills/canon-init/write-guide.md`, `.claude/skills/canon-pipeline/SKILL.md`
- **Docs:** `AGENTS.md`, `CLAUDE.md`, `README.md`, `scripts/docs-refs-check.mjs`, `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/pipeline-orchestrator.md`, `docs/product-context.md`
- **Templates (synced/hand-edited):** `templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/.claude/skills/canon-init/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md`, `templates/docs/codebase-map.md`, `templates/docs/pipeline-orchestrator.md`, `templates/scripts/docs-refs-check.mjs`

## How to Test

Follow the Human Test Plan from the spec:

1. In a throwaway empty directory, run `canon init`. **Expected:** creates `AGENTS.md` and `CLAUDE.md` — no `CODEX.md`.
2. In that same directory, run `canon doctor`. **Expected:** the canon-files section lists `AGENTS.md` and `CLAUDE.md` as healthy; nothing about `CODEX.md`.
3. Create an empty `CODEX.md` in that directory, then run `canon doctor` again. **Expected:** a **warning** (not a failure) stating `CODEX.md` is deprecated / not read by any tool / safe to delete. The file is left untouched.
4. Run `canon upgrade` in that directory. **Expected:** `CODEX.md` is neither recreated, modified, nor deleted.
5. In canon's own repo, confirm there is no longer a `CODEX.md`, and that the `git show origin/<base>:<path>` file-revert guidance is findable in `AGENTS.md`.
6. Confirm the PR's CI checks pass.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Clean on the final tree. |
| `type-check` (`npm run type-check`) | Pass | Clean on the final tree. |
| `unit tests` (`npm test`) | Pass | 704 passed, 0 failed, 1 skipped (sandbox-dependent linked-worktree anchor check). |
| `build` (`npm run build`) | Pass | `dist/cli/index.js` regenerated and committed. |
| `docs-refs` (`npm run docs-refs-check`) | Pass | "All refs OK" — verified after the handoff artifact fix. |
| `sync-templates` (`npm run sync-templates:check`) | Pass | "All canon-managed files in sync". |
| `CI smoke` (`canon init` + `canon doctor` in a clean env) | Pass | Verified green on PR #129 CI (the clean-shim `canon init` / `canon doctor` step in the test job). |

## Human Verification Required

- **CI smoke test** (`canon init` + `canon doctor` in a clean env): The GitHub Actions smoke job runs `canon init` in a shimmed environment that cannot be fully reproduced locally. **✓ Verified:** PR #129 CI is green — the smoke step (`canon init` → AGENTS.md + CLAUDE.md, no CODEX.md → `canon doctor`) passed; no stale workflow path filters caused failures.

## Decisions Made

- **Warn, not fail, for existing `CODEX.md`.** Adopters who have committed a `CODEX.md` get a `canon doctor` deprecation warning nudging deletion; `upgrade` stops managing it silently. No auto-deletion by design.
- **Historical docs untouched.** `CHANGELOG.md`, `docs/BACKLOG.md`, and `docs/packaging-plan.md` retain their `CODEX.md` mentions. They record past decisions, not current behavior, and `docs-refs-check` does not flag them.
- **Markdown-link form for deleted-file handoff entries.** When a Changes table must reference a deleted file path, using markdown-link syntax (not backtick) avoids `docs-refs-check` scanning the ref as a live path. Backtick file-path refs to deleted files trip the checker even when the deletion is intentional.

## Open Questions

None. All ACs met; CI smoke is the only remaining gate.

## Proposed Changelog

*Audience: canon-ai adopters (operators running `canon init`, `canon upgrade`, `canon doctor`).*

### Removed

- **`canon init` and `canon upgrade` no longer scaffold or manage `CODEX.md`.** The Codex CLI reads `AGENTS.md` natively; `CODEX.md` was never read by any tool. `canon init` now scaffolds only `AGENTS.md` and `CLAUDE.md`. If your repo has an existing `CODEX.md`, run `canon doctor` — it emits a deprecation warning and leaves the file untouched; delete it when ready. `canon upgrade` never auto-deletes it. The file-revert mechanics that previously lived only in `CODEX.md` are now in `AGENTS.md` where Codex reads them.

**Proposed version bump:** Rolls into the current Unreleased block (no independent bump needed). The entry goes in `### Removed` alongside the existing `canon task release-init` removal. When this block ships as `v1.9.0`, the minor bump covers both removals.
