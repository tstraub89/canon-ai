# QA Summary: adopter-agent-file-redesign

## What Changed

Canon now treats adopter agent files (`AGENTS.md` / `CLAUDE.md`) as built-in `/init` output. Tools like Claude Code's `/init` and Codex's `init` produce them as high-level codebase overviews. Canon does not generate, manage, or instruct agents to read them.

Three concrete areas changed. First, the `canon-spec`, `canon-spec-review`, `canon-pipeline`, and `canon-init` skills no longer include agent-file load instructions or "reads them as project context" claims. Key docs (`docs/patterns.md`, `docs/codebase-map.md`, `docs/product-context.md`, `docs/pipeline-orchestrator.md`) are reframed: the pipeline reads the protected `docs/*` corpus and JIT prompt/skill guidance — not adopter agent files. Every surviving reference falls into an allow-listed category (operational code, decision record, CI path description, test file, or "adopter-owned" framing).

Second, the README and `/canon-init` are re-scoped. The README now directs adopters to generate their agent files via their tool's built-in `/init` and documents the optional `CLAUDE.md = @AGENTS.md` + operator-norms consolidation pattern. `/canon-init` is described as generating only the `docs/` knowledge corpus.

Third, canon-ai dogfoods the audience-split. `AGENTS.md` is rewritten as the shared high-level overview (what canon is, phases, roles, cross-review and communication norms, commands, conventions, and a doc-pointer map). `CLAUDE.md` is reduced to the `@AGENTS.md` import plus the four conversational-operator norms (commit consent, never self-review inline, prefer smaller models, don't intervene in `spec_review` auto-revision). The operator norms do not appear in `AGENTS.md`, so Codex gets only the shared overview. `canon doctor` gains a second warn branch: when neither agent file exists it now advises running the built-in `/init`. The `canon init` detection notice drops the read-as-context claim. CLI and run-task reroute banners are repointed from the removed `CLAUDE.md` reroute section to `docs/pipeline-orchestrator.md`. `docs/decisions.md` is updated with both a correction (drops the trailing "reads them as adopter-owned context only" sentence from the existing entry) and a new entry recording the agent-files-via-`/init` end state.

Code review (Iteration 2) returned one finding: a dangling Phase 4 cross-reference in `canon-init/SKILL.md` that pointed at removed write-guide guidance. Fixed and re-synced to the template mirror.

After an independent human review (Iteration 3), six doc-content gaps were surfaced and addressed: (A1) README was missing the `@AGENTS.md` consolidation guidance despite AC-4 having been marked Met; (A2) `AGENTS.md` lacked a product/stack/self-hosting opener; (A3) the managed-set caveat (`AGENTS.md`/`CLAUDE.md` have no `templates/` mirror; no sync needed) was missing; (A4) the npm build/test/lint command line was missing; (A5) `docs/release-process.md` was absent from the deeper-doc map; (A6) the `src/lib/canon-owned.ts` pointer was missing from Conventions. All six were added to `AGENTS.md` and `README.md`, with corresponding test assertions added to `tests/cli.test.ts`.

A final code review round (Iteration 4) tightened the audience-split test in `tests/cli.test.ts` to assert the four actual operator norm texts are absent from `AGENTS.md` (not just the retired section heading), closing a false-pass gap in the regression guard.

## Files Changed

| File | Change |
|---|---|
| `.claude/skills/canon-init/SKILL.md` | Dropped agent-file read instructions; removed dangling write-guide cross-reference (Iter 2) |
| `.claude/skills/canon-init/write-guide.md` | Reworded adopter-owned section — no read/rewrite claim |
| `.claude/skills/canon-pipeline/SKILL.md` | Removed stale `CLAUDE.md` operator-context reference |
| `.claude/skills/canon-spec-review/SKILL.md` | Removed stale `CLAUDE.md` operator-context reference |
| `.claude/skills/canon-spec/SKILL.md` | Removed `AGENTS.md` / `CLAUDE.md` load instructions and stale related reference |
| `AGENTS.md` | Rewritten as shared project overview |
| `CLAUDE.md` | Reduced to `@AGENTS.md` import + four conversational-operator norms |
| `README.md` | Reframed around built-in `/init`; added `@AGENTS.md` consolidation option |
| `dist/cli/index.js` | Rebuilt: reroute banner repointed to `docs/pipeline-orchestrator.md` |
| `dist/scripts/run-task.js` | Rebuilt: reroute banner repointed to `docs/pipeline-orchestrator.md` |
| `docs/codebase-map.md` | Updated Claude-guide row, protected-docs preamble, doctor summary |
| `docs/decisions.md` | Corrected existing vacate entry; added agent-files-via-`/init` decision |
| `docs/patterns.md` | Reworded layering guidance; repointed lint/type-safety trigger cell |
| `docs/pipeline-orchestrator.md` | Clarified: pipeline reads `docs/*` corpus + JIT guidance, not agent files |
| `docs/product-context.md` | Reframed: agent files are adopter-owned `/init` output |
| `scripts/run-task/cli.ts` | Reroute banner repointed to `docs/pipeline-orchestrator.md` |
| `src/cli/commands/doctor.ts` | Added absent-files `/init` warn branch |
| `src/cli/commands/init.ts` | Reworded existing-agent-file notice: adopter-owned, no read claim |
| `src/cli/index.ts` | Reroute help text repointed to `docs/pipeline-orchestrator.md` |
| `tests/cli.test.ts` | Updated doctor/init assertions; WORKTREE_ROOT fix for root-file split test; added AGENTS opener/stack/managed-set/canon-owned/release-process assertions (Iter 3); strengthened audience-split test with four operator-norm text absence assertions (Iter 4) |
| `templates/.claude/skills/canon-init/SKILL.md` | Mirror: dangling cross-reference fix (Iter 2) |
| `templates/.claude/skills/canon-init/write-guide.md` | Mirror: adopter-owned section reword |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirror: stale reference removed |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Mirror: stale reference removed |
| `templates/.claude/skills/canon-spec/SKILL.md` | Mirror: load instructions removed |
| `templates/docs/pipeline-orchestrator.md` | Mirror: clarification about protected corpus |

## How to Test

```
npm run lint
npm run type-check
npm test
npm run docs-refs-check
npm run sync-templates:check
npm run build
```

Human verification steps (spec Human Test Plan):

1. **Doctor absent-files warn.** In a fresh folder with canon set up but no `CLAUDE.md` / `AGENTS.md`, run `canon doctor`. Confirm it warns with a suggestion to run the built-in `/init` — no error, no fail, just an advisory.
2. **Doctor silent-files warn.** Create a `CLAUDE.md` with unrelated content (no canon mention) and run `canon doctor` again. Confirm the suggestion shifts to adding the canon orientation line rather than running `/init`.
3. **`@AGENTS.md` import resolves.** Open a fresh Claude session in this repo. Confirm it surfaces the high-level canon overview plus the four conversational-operator norms, confirming the `@AGENTS.md` import expands correctly.
4. **README bootstrap story.** Read the README getting-started section. Confirm it directs adopters to the built-in `/init` for agent files, mentions the optional `@AGENTS.md` consolidation, and does not claim `/canon-init` creates those files.
5. **Skills and docs free of read instructions.** Skim the canon skills and docs. Confirm none tell an agent to "read" the agent files or claim a canon rule lives inside them.
6. **Codex session has no operator norms.** Open a fresh Codex session. Confirm it receives canon's high-level orientation and does not see the four Claude-only operator norms (model preference, commit consent, never self-review, don't intervene in `spec_review`).

## Test Results

| Check | Result | Notes |
|---|---|---|
| `lint` | Pass | Re-ran after final test fix and root-agent-file rewrite |
| `type-check` | Pass | Re-ran after final test fix and root-agent-file rewrite |
| `unit tests` | Pass | Final suite passed after fixing root-file assertion to read `WORKTREE_ROOT` |
| `build` | Pass | Rebuilt tracked `dist/` bundles for CLI/banner changes |
| `docs-refs` | Pass | Clean after doc/skill reference sweep; re-ran after Iter 2 |
| `sync-templates:check` | Pass | Clean after syncing root skills and mirrors; re-ran after Iter 2 and Iter 3 |
| `A1 grep` (`git grep -n '@AGENTS\.md' README.md`) | Pass | Confirms consolidation guidance in README beyond the discovery-nudge block |
| `AC-1 strip grep` (AGENTS.md + README.md) | Pass | New opener does not reintroduce read/rule-home framing |
| `E2E` | not_configured | Spec: no UI/runtime surface |

## Human Verification Required

None.

## Decisions Made

- **Agent files are the job of the tool-native `/init`, not canon.** Claude Code `/init` → `CLAUDE.md`; Codex `init` → `AGENTS.md`. Canon neither generates nor reads them. Recorded in `docs/decisions.md`.
- **Audience-split by content, not file count.** `AGENTS.md` holds everything useful to both agents; `CLAUDE.md` holds only the import + the four norms Codex has no use for. Operator-only instructions stay out of Codex's context.
- **`canon doctor` is warn-only for agent files.** Both warn branches (absent files and silent files) never return `fail`.
- **`@AGENTS.md` consolidation is a documented option, not a mandate.** Adopters choose whether to consolidate.

## Open Questions

None — all ACs met; code review approved with nits (no blocking findings in either iteration).

## Proposed Changelog

> Entry text only — no version proposed. This task folds into the pending unreleased block.

**Changed**

- **`/canon-init` is now scoped to the `docs/` knowledge corpus; agent files come from the tool-native built-in `/init`.** `README.md` now directs adopters to generate `AGENTS.md` and `CLAUDE.md` via their tool's built-in `/init` (Claude Code `/init`, Codex init) rather than via `/canon-init`. The optional `CLAUDE.md = @AGENTS.md` consolidation pattern (import the shared overview, append operator-only norms) is now documented. The `canon init` detection notice, `/canon-init` skill, and surrounding docs and skills drop stale "reads agent files as project context" claims. Ships to adopters via `canon upgrade`.

**Added**

- **`canon doctor` warns when neither `CLAUDE.md` nor `AGENTS.md` exists.** The discovery-nudge check gains a second warn branch: when neither file is present, the detail advises running the built-in `/init` to generate a high-level codebase overview. The existing warn branch (a file exists but neither mentions canon) is unchanged. Still warn-only; never `fail`. Ships to adopters via `canon upgrade`.

---

Maintenance: lessons-learned.md has 16 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
