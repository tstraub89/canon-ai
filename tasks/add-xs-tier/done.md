# Completion Summary: add-xs-tier — Add XS task size as the new fast-tier floor

> For the human. This is what you need to know.

## What Changed

This task introduces `XS` as the new fast-tier task size and graduates `S` to full tier. Before this change, `S` was simultaneously the smallest pipeline task and the tier that skipped Codex spec review — two ideas that became a problem when a fast-tier S bug fix shipped with a wrong premise because no spec review ran. Now `XS` is the fast-tier floor: it's the smallest way into the pipeline, runs spec and plan in one combined Claude session, and skips Codex `spec_review` because its spec has little-to-no premise worth challenging. `S` keeps all of its existing model and effort values but is now full-tier — it gets a separate plan and a Codex `spec_review` pass, making `spec_review` the formal XS→S dividing line. The change covers two coordinated dimensions: a policy, routing, and test update to introduce XS and re-route S, and a repo-wide consistency sweep across all live guidance surfaces (runtime prompt templates, operator skills, docs, CLI help, README) to replace the stale `fast-tier (S)` label with `XS` across four distinct label families. All tests pass (896 pass, 1 skipped), the structural guidance-consistency greps returned zero matches, and the build, sync, and docs-refs checks all passed clean.

## Files Changed

| File | What Changed |
|---|---|
| `scripts/pipeline-policy.ts` | Added `XS` to `TaskSize`, `SIZE_ORDER`, budget, loop defaults, Codex/Claude matrices, fast-tier routing (`detectTier`, `isPlanCombined`), and `maxSize` floor; updated policy comments |
| `tests/pipeline-policy.test.ts` | Added XS routing/matrix/budget/loop-cap cases; flipped S expectations to full tier |
| `tests/run-task-reroute-preflight.test.ts` | Added `XS` to reroute fixture helper type; moved fast-tier reroute fixture from `taskSize: 'S'` → `'XS'` |
| `tests/run-task-safety.test.ts` | Moved two fast-tier spec-gate fixtures from `task_size: 'S'` → `'XS'` |
| `.claude/skills/canon-spec/SKILL.md` | Added inline→XS→S size guidance, shifted light/grill split to XS vs S+, updated bug-fix and full-tier guidance |
| `docs/pipeline-orchestrator.md` | Updated tier definitions, sizing fields/guide, Codex matrix, env-var size bands, spec-gate timing, loop caps, reroute guidance, and spec-review references |
| `docs/product-context.md` | Updated glossary and tier summary for XS fast tier, S+ full tier, and the new valid size set |
| `docs/decisions.md` | Rewrote fast-tier decision around XS; added inline→XS→S boundary decision |
| `docs/architecture.md` | Updated `task_size` enum to `XS \| S \| M \| L \| XL` |
| `.canon/templates/spec.md` | Bug/flake fast-tier rule-of-thumb updated S → XS |
| `scripts/run-task/prompts/templates/spec.md` | Runtime spec prompt fast-tier rule-of-thumb updated S → XS |
| `scripts/run-task/prompts/templates/spec-revision.md` | Runtime spec-revision prompt fast-tier rule-of-thumb updated S → XS |
| `.claude/skills/canon-spec-review/SKILL.md` | Updated full-tier/fast-tier membership wording and size placeholder to include XS |
| `.claude/skills/canon-pipeline/SKILL.md` | Updated pre-flight and reroute tier guidance for XS fast tier and S+ full tier |
| `.claude/skills/canon-inline-review/SKILL.md` | Removed old "XS = inline/below-pipeline" terminology |
| `.claude/skills/canon-status/SKILL.md` | Updated loop-cap warning band to `XS/S/M` |
| `scripts/run-task/cli.ts` | Updated `canon run` help text for XS fast tier and S+ full-tier reroute |
| `src/cli/index.ts` | Updated top-level CLI reroute help for XS fast tier and S+ full-tier reroute |
| `README.md` | Updated public tier/reroute descriptions; stopped calling inline work "XS" |
| `dist/cli/index.js` | Rebuilt CLI bundle |
| `dist/scripts/run-task.js` | Rebuilt orchestrator bundle |
| `tests/run-task-prompts.golden.json` | Regenerated prompt golden after runtime prompt template edits |
| `templates/docs/pipeline-orchestrator.md` | Synced canon-managed mirror |
| `templates/.canon/templates/spec.md` | Synced canon-managed mirror |
| `templates/.claude/skills/canon-spec/SKILL.md` | Synced canon-managed mirror |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Synced canon-managed mirror |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced canon-managed mirror |
| `templates/.claude/skills/canon-inline-review/SKILL.md` | Synced canon-managed mirror |
| `templates/.claude/skills/canon-status/SKILL.md` | Synced canon-managed mirror |

## How to Test

1. Create a new task and set `task_size` to `XS` in `status.json`. Run `canon run <id>`. Confirm: spec and plan happen in a single combined Claude session, and the Codex spec-review step is skipped — exactly like the fast path worked with S before this change.
2. Create a task with `task_size: S` and run it. Confirm: the S task now gets a separate plan step and a Codex `spec_review` pass, but the effort level feels lighter than M (medium effort, not high). This is the new intended behavior for S.
3. Open `.claude/skills/canon-spec/SKILL.md` and `docs/pipeline-orchestrator.md`. Confirm: both clearly explain when to pick XS over inline work, and when to step up to S (framed around whether the spec premise is worth Codex reviewing). Neither should say the smallest pipeline tier is S, and neither should use "XS" to mean inline/below-pipeline work.
4. Run `canon run` on any existing in-flight S task. Confirm it routes full tier with a separate plan and spec_review. This is the intended graduation behavior — not a regression.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | `eslint scripts/ tests/ src/` passed |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` passed |
| `npm test` | Pass | 896 pass, 1 skipped, 0 fail |
| `npm run build` | Pass | Built `dist/cli/index.js` and `dist/scripts/run-task.js` |
| `UPDATE_GOLDENS=1 npm test` | Pass | 896 pass, 1 skipped, 0 fail; prompt golden regenerated |
| `npm run sync-templates` | Pass | Synced all canon-managed mirrors |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync |
| `npm run docs-refs-check` | Pass | All refs OK |
| Guidance-consistency gate — Family A/B/D `rg` sweeps | Pass | All three families returned zero matches on live surfaces |

## Human Verification Required

No `human_pending` items remain in the Validation Outcomes table.

**Pre-merge checklist — confirm before merging:**

- [ ] Version bump: this change adds a new `task_size` value and changes S routing — confirm the bump tier with `/canon-changelog`
- [ ] Changelog entry finalized and committed separately from code changes
- [ ] PR body current (`tasks/add-xs-tier/pr-body.md`)
- [ ] Final CI/CD checks green on the PR
- [ ] Final diff matches spec intent — specifically: confirm that no remaining `task_size: 'S'` test fixture relies on fast-tier behavior (three fixtures were moved to XS; six were intentionally left at S because their assertions are tier-agnostic)

## Decisions Made

- **XS clones S's current effort values exactly.** XS gets the same `mini/medium` Codex rows and `medium` Claude rows as the current S. No effort or model values changed; only the tier assignment and routing flipped.
- **S behavior change is intentional, not a regression.** Existing S tasks now incur `spec_review` + a separate plan on their next `canon run`. This is the whole point of the task.
- **`maxSize` floor moved from `'S'` to `'XS'`** so an all-XS bundle correctly reports nominal/effective size as `'XS'` rather than silently flooring to `'S'`.
- **Family C guidance surfaces verified positively.** Because `S/M/L/XL` is a substring of `XS/S/M/L/XL`, a "stale string absent" zero-grep gate is impossible for Family C. Each size-set surface was verified positively by targeted ACs.
- **Family A gate redesigned from brittle literal shapes to a word-bounded PCRE invariant (`\bS[\s,)\x60]*non-delicate`).** The original pattern list missed three separator variants; the invariant catches all of them and cannot match post-change `XS` since the `S` is always preceded by `X`.
- **One deviation from plan:** The `canon-spec` skill's "Topics to work through for M+" shorthand was also updated to "full-tier tasks" to keep S+ correctly scoped after graduation.

## Open Questions

- **In-flight S tasks at adopter repos**: Any existing `status.json` with `task_size: S` will route full tier on the next `canon run` after upgrade. This is intentional per the spec's Non-Goals. No migration shim was added. Confirm this is acceptable for any known active adopter tasks.

## Proposed Changelog

### Added

**`XS` task size — the new fast-tier floor.** Tasks sized `XS` run the fast tier (spec and plan combined in one Claude session, Codex `spec_review` skipped) — the smallest way into the pipeline. Use `XS` for more than a trivial one-file inline edit (>1 file, or real logic) but whose spec has little-to-no premise worth challenging: it buys the pipeline's cross-review direction (Codex implements against written ACs, Claude reviews), written ACs, a plan, and a real `code_review`. The inline → XS → S decision rule is documented in the spec-authoring skill and the pipeline orchestrator doc. Ships to adopters via `canon upgrade`.

### Changed

**`S` tasks now run the full pipeline.** `S` tasks get a separate plan and a Codex `spec_review` pass at `S`'s existing medium-effort row — the same pipeline treatment as `M/L/XL`, but lighter. `spec_review` is the formal XS→S dividing line: choose `XS` when the spec premise needs no Codex challenge, `S` when it does. No effort, model, budget, or loop-cap value changed for any existing size. Ships to adopters via `canon upgrade`.
