# Done: vacate-adopter-md

## What Changed

Canon no longer ships any managed content into adopter `CLAUDE.md` or `AGENTS.md`. Both files are now fully adopter-owned. This is the final task of the three-part program (`relocate-rules-to-prompts` → `discovery-nudge` → this task). Task A already moved every pipeline-consumed rule out of the broadcast blocks into per-phase prompts, charters, and skills; the shipped block was redundant. This task removes canon's ownership of the two files, cleans up all downstream surfaces that assumed ownership, and slims canon-ai's own copies to ambient operator context.

**Core changes:**

- **`DELIMITED` is now empty.** `src/lib/canon-owned.ts` no longer lists `AGENTS.md` or `CLAUDE.md` in `DELIMITED`. The delimiter-merge machinery (`mergeDelimited`, marker constants, upgrade/sync loops) is retained for future use — `canon upgrade` and the sync hook now no-op on these two files. A file can be re-added to `DELIMITED` with no code change (AC-2, AC-3).
- **Templates deleted.** The `templates/` copies of `CLAUDE.md` and `AGENTS.md` are removed. `canon init` no longer scaffolds either file in a fresh repo (AC-5). When those files pre-exist, init detects them via a direct presence check and notes them as adopter-owned context — without promising to merge a canon block (AC-6).
- **`canon upgrade` leaves agent files untouched.** With neither file in `DELIMITED` or `CANON_OWNED`, upgrade performs no write on `CLAUDE.md`/`AGENTS.md` regardless of their content (AC-7).
- **Migration tool added** (`tools/strip-canon-block.mjs`). One-off non-shipped tool for existing adopters. Removes the `<!-- canon:start -->…<!-- canon:end -->` block from `CLAUDE.md`/`AGENTS.md`, preserving all content outside it. In write mode, refuses when the git tree is dirty — and fails closed when `git status` itself errors, treating unknown state as dirty. `--check`/`--dry-run` runs regardless of tree state. Idempotent (AC-8, AC-9).
- **`canon doctor` re-scoped.** The two `checkAgentFile` presence checks that would exit non-zero when either file was absent are removed, along with the now-unused `checkAgentFile` function and its unit tests. `checkCanonDiscoveryNudge` (shipped in Task B, warn-only) is now the sole agent-file check (AC-16).
- **CI smoke updated.** The `test -f AGENTS.md` and `test -f CLAUDE.md` assertions are removed from the git-install smoke job; `canon doctor` step passes with both files absent via the doctor re-scope (AC-17).
- **Stale "managed/scaffolded/delimited" references swept** (AC-13). README, docs, shipped skills (`canon-init/SKILL.md` and `write-guide.md`), and scaffold template mirrors (`templates/docs/*.md`) all updated. Four scaffold template mirrors (`templates/docs/architecture.md`, `decisions.md`, `product-context.md`, `codebase-map.md`) were added to the sweep as a deviation from the original Affected Files list — `docs-refs-check` validates them in fixture repos and stale authority claims there would have broken the check.
- **Pipeline startup constants amended** (amendment, AC-A1–A4). `CLAUDE_STARTUP`, `CODEX_STARTUP`, and the resumed-session note in `scripts/run-task/prompts/helpers.ts` no longer instruct agents to read `AGENTS.md`/`CLAUDE.md`. Rules arrive via injected per-phase prompts; the explicit instruction was dead weight that dangled in fresh adopter repos where neither file exists. Golden snapshot regenerated.
- **Canon-ai's own files slimmed.** Root `CLAUDE.md` and `AGENTS.md` stripped of delimiter markers and the rules Task A relocated. `CLAUDE.md` retains all always-on operator norms (ask before committing, never self-review inline work, default to smaller models, don't intervene in full-tier `spec_review` auto-revision) plus role/mode/spec-gate framing and skill pointers. `docs/lessons-learned.md` added to the conversational-session reading list (AC-10, AC-A3). The handoff AC-11 mapping table documents every dropped section's surviving home.
- **Deferred nit N5 resolved.** `scripts/run-task/prompts/templates/qa.md` lesson-promotion target now reads `patterns.md / decisions.md` with no `AGENTS.md` entry (AC-12).

## Files Changed

| File | Change |
|---|---|
| `src/lib/canon-owned.ts` | `DELIMITED` → empty list |
| `src/cli/commands/upgrade.ts` | Exported marker constants for migration tool; generalized stale comment; widened loop variable |
| `src/cli/commands/init.ts` | Rewired existing-agent-file detection to direct presence check; replaced merge-protocol grill note |
| `src/cli/commands/doctor.ts` | Removed `checkAgentFile` function and its two calls; deleted its four unit tests |
| `.github/workflows/ci.yml` | Removed `test -f AGENTS.md` / `test -f CLAUDE.md` smoke asserts |
| `CLAUDE.md` | Slimmed; delimiter markers removed; always-on norms made explicit; `docs/lessons-learned.md` added to reading list |
| `AGENTS.md` | Slimmed; delimiter markers removed |
| `README.md` | Marked agent files adopter-owned; corrected `canon upgrade` description; added independent-review note |
| `docs/decisions.md` | New end-state decision entry; corrected stale "delimited AGENTS.md/CLAUDE.md" references |
| `docs/architecture.md` | Corrected "canon-managed root files … sync-templates:check" framing |
| `docs/product-context.md` | Corrected `canon init` scaffolding claim |
| `docs/pipeline-orchestrator.md` | Removed root agent files as customization targets for canon-owned workflow rules |
| `docs/codebase-map.md` | Wiring-map references repointed from root agent files to JIT skills/prompts |
| `.claude/skills/canon-init/SKILL.md` | Phase 0 rescoped: "read as adopter-owned context, no merge protocol" |
| `.claude/skills/canon-init/write-guide.md` | Agent-file merge protocol replaced with adopter-owned context guidance |
| `scripts/run-task/prompts/helpers.ts` | Removed `AGENTS.md`/`CLAUDE.md` read instructions from `CLAUDE_STARTUP`, `CODEX_STARTUP`, and resumed-session note |
| `scripts/run-task/prompts/templates/qa.md` | Lesson-promotion target: `AGENTS.md` removed, now `patterns.md / decisions.md` |
| `tools/strip-canon-block.mjs` | New non-shipped migration tool |
| `tests/strip-canon-block.test.ts` | New fixture-driven test suite for migration tool |
| `tests/cli.test.ts` | No-scaffold/no-upgrade/no-doctor-fail behavior; `checkAgentFile` tests removed; AC-5/6/7/16 assertions added |
| `tests/sync-canon-templates.test.ts` | Updated for empty `DELIMITED`; fixture-level merge tests retained |
| `tests/run-task-prompts.golden.json` | Regenerated after qa.md and helpers.ts edits |
| [templates/AGENTS.md](templates/AGENTS.md) | Deleted |
| [templates/CLAUDE.md](templates/CLAUDE.md) | Deleted |
| `templates/.claude/skills/canon-init/SKILL.md` | Synced mirror |
| `templates/.claude/skills/canon-init/write-guide.md` | Synced mirror |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror |
| `templates/docs/architecture.md` | Corrected stale root-agent-file authority references (deviation) |
| `templates/docs/decisions.md` | Corrected stale release-policy root-agent-file references (deviation) |
| `templates/docs/product-context.md` | Corrected `canon init` scaffolding claim (deviation) |
| `templates/docs/codebase-map.md` | Corrected root-agent-file authority references (deviation) |
| `dist/cli/index.js` | Rebuilt |
| `dist/scripts/run-task.js` | Rebuilt |

## How to Test

The spec's Human Test Plan covers the adopter-facing surface:

1. **Migration tool** — in a scratch copy of a repo that still has the legacy canon block in `CLAUDE.md`/`AGENTS.md`, run `node tools/strip-canon-block.mjs --check` and confirm it reports it would remove only the canon block. Run it for real: confirm the block is gone, content outside it is untouched, a second run reports nothing to do. Confirm it refuses to write when the repo has uncommitted changes.
2. **Fresh `canon init`** — in a new empty folder, run `canon init` and confirm neither `CLAUDE.md` nor `AGENTS.md` is created, and that setup never inserts or merges a canon block into them. In a folder that already has those files, run `canon init` and confirm it notices them (uses them as project context) without altering them.
3. **`canon doctor` with no agent files** — in a new folder, run `canon doctor` after init and confirm it does not flag absent agent files as errors. At most a gentle discovery nudge is expected.
4. **`canon upgrade` leaves agent files alone** — in a repo with a `CLAUDE.md`, run `canon upgrade` and confirm the file is byte-identical after.
5. **Canon-ai own files** — read the slimmed root `CLAUDE.md` and `AGENTS.md` end-to-end and confirm they still communicate: who does what, the two operating modes, the spec gate, the always-on habits (ask before committing, never self-review inline work, prefer smaller models), and where to find more (the canon skills and `docs/pipeline-orchestrator.md`).
6. **Package contents** — confirm `npm pack --dry-run` excludes `tools/strip-canon-block.mjs`.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-run after reroute helper/`CLAUDE.md` changes. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` passed. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| `UPDATE_GOLDENS=1 npm test` | Pass | Golden regenerated; 876 pass, 1 skipped. |
| `npm test` | Pass | Clean full suite; 876 pass, 1 skipped. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm pack --dry-run` | Pass | `tools/strip-canon-block.mjs` excluded from tarball (AC-9). |
| `git grep` — delimiter markers | Pass | No `canon:start`/`canon:end` in root `CLAUDE.md` or `AGENTS.md` (AC-10). |
| `git grep` — `checkAgentFile` | Pass | No remaining references in `src/`, `tests/`, or `dist/` (AC-16). |
| `git grep` — prompt-layer agent-file refs | Pass | No `AGENTS.md`/`CLAUDE.md` references in `scripts/run-task/prompts/` (AC-A2). |
| AC-13 stale-reference sweep | Pass | No stale managed/scaffolded/delimited framing found in README/docs/skills/templates after sweep. |
| E2E | deferred_by_spec | No UI/runtime surface; spec marks E2E as N/A. |

## Human Verification Required

None.

## Decisions Made

- **Delimited machinery retained** with an empty list rather than deleted. A future file type can be re-added to `DELIMITED` with no code change (AC-2, AC-3).
- **Migration tool not shipped.** Excluded from the npm package; adopters who vendor canon as a submodule get it via the repo. A permanent shipped check for the post-migration era would cut against the program's subtractive goal.
- **No `canon doctor` residual-block detector.** The finite migration set (canon-ai's repos + James's submodule repo) and the one-off tool cover it.
- **`init` detection rewired** from scaffold skip-list inference to a direct presence check, since the templates are deleted (AC-6).
- **Dirty-tree guard fails closed on git-status errors.** The initial implementation failed open when `git status` itself errored (treating unknown as clean). Changed to refuse — unknown state means refuse write (AC-8 strengthened, implementation revision).
- **Amendment added post-spec-review**: cleared `CLAUDE_STARTUP`/`CODEX_STARTUP`/resumed-session note of agent-file read instructions (AC-A1–A4). The explicit instruction was dead weight that dangled in fresh adopter repos where neither file exists.
- **Four scaffold template mirrors** added to the AC-13 sweep as a deviation from the original Affected Files list. `docs-refs-check` validates scaffold templates in fixture repos; stale authority claims there produce broken refs during implementation.

## Open Questions

None. All ACs and amendment ACs met; the Human Test Plan items above are the remaining adopter-facing verification.

## Proposed Changelog

_Audience: adopters who run `canon`. Scope test: "would an adopter notice this change?" Per the spec Non-Goals, version assignment belongs to the release step — not QA._

This is a **breaking change** warranting a major version bump (2.0.0 per the program design): `canon init` no longer scaffolds `CLAUDE.md`/`AGENTS.md`, `canon upgrade` no longer manages them, and existing adopters whose files contain the legacy canon block must run the one-off migration tool.

Proposed entries for the **[Unreleased]** section:

---

### Breaking Changes

- **`canon init` no longer scaffolds `CLAUDE.md` or `AGENTS.md`.** Both files are now fully adopter-owned; canon delivers its rules just-in-time through skills, per-phase prompt templates, and agent charters. **Migration for existing adopters**: if your `CLAUDE.md` or `AGENTS.md` contains a `<!-- canon:start -->…<!-- canon:end -->` block, run the one-off migration tool (`node tools/strip-canon-block.mjs`) to strip it; content outside the block is preserved and unchanged. Files without the block need no action. A second run after a clean migration reports nothing to do.

- **`canon upgrade` no longer touches `CLAUDE.md` or `AGENTS.md`.** These files are no longer in the managed-file list; upgrade neither inserts, merges, nor removes content from them.

### Changed

- **`canon doctor` no longer fails when `CLAUDE.md` or `AGENTS.md` is absent.** The two hard-fail presence checks are removed. The warn-only discovery nudge (shipped in a prior release) remains as the sole agent-file check — it passes silently when either file already mentions canon, and emits a soft suggestion when neither does.

---

Maintenance: `docs/lessons-learned.md` has 15 entries; a human lessons sweep is due (see `docs/lessons-learned.md` → "How to use this doc").
