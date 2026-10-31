# Completion Summary: provider-neutral-vendor-wording — Make user-facing role and vendor wording match CANON_PROVIDER

> For the human. This is what you need to know.

## What Changed

Canon can now run every role on Claude Code (`CANON_PROVIDER=claude`), but most of the user-facing text still said Codex does the spec review, the implementing and the cold review. This change rewrites that text. Each statement now names the role first, and then says who holds it in each mode: Codex in `mixed` (the default), Claude Code in `claude`. The README gets a provider section, its setup, doctor and trust-model lines are conditioned on the provider, and it documents the opt-in Claude sandbox with the limits seen in a fresh probe. The CLI help and the two review-scope reason strings are provider-neutral. The skills, artifact bylines, `.canon/README.md` and the operator docs are updated the same way. No behavior, prompt, routing or default changed. The one exception is the wording of text the program prints.

## Files Changed

- `README.md` — provider subsection, setup and doctor conditions, tier and `delicate` lines, privacy and trust model, opt-in Claude sandbox section, roadmap and adapter lines.
- `src/orchestrator/cli.ts` — `RUN_USAGE` fast-tier and reroute lines name the phase and implementer role.
- `src/lib/pipeline-policy.ts` — two scope reasons say "round record" instead of "cold-Codex archive record".
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles.
- `tests/cli-args.test.ts` — asserts `RUN_USAGE` has no Codex and names the roles.
- `tests/pipeline-policy.test.ts`, `tests/run-task-code-review.test.ts` — expectations and fixtures carry the new scope-reason strings.
- `.claude/skills/canon-spec/SKILL.md`, `.claude/skills/canon-spec-review/SKILL.md`, `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-status/SKILL.md` — role-based or mixed-qualified wording (plus their `templates/` mirrors).
- `.canon/templates/spec.md`, `.canon/templates/spec-review.md`, `.canon/templates/handoff.md`, `.canon/templates/review.md` — bylines name roles; review lens and dismissal lines are mixed-qualified (plus `templates/` mirrors).
- `.canon/README.md` — Codex sandbox paragraph is mixed-mode; network follows the user's Codex config (plus `templates/` mirror).
- `docs/pipeline-orchestrator.md` — operator, tier, matrix, failure and reroute prose (plus `templates/` mirror).
- `AGENTS.md` — Roles table and cross-review line qualified by provider.
- `docs/product-context.md`, `docs/patterns.md`, `docs/codebase-map.md`, `docs/architecture.md`, `docs/decisions.md` — glossary, pitfall, template-author and CLI-mode wording; one stale decision sentence now points to the later Claude assignment decision.
- `templates/docs/patterns.md`, `templates/docs/task-quality-log.md` — adopter seeds.
- `docs/BACKLOG.md` — sandbox entry records the 2026-10-31 probe under canon's headless flags; network confinement stays open.
- `tests/`, `templates/` mirrors and `dist/` are regenerated or updated as listed above.

## How to Test

1. Run `canon run --help`. Expected: the fast-tier and reroute lines name the spec-review phase and the implementer, with no vendor name.
2. Open the README "How it works" section as a user with only Claude Code installed. Expected: a provider section explains `CANON_PROVIDER=claude`, Codex is optional, and Codex-only mode is not supported.
3. In the README "Trust model", read the Claude sandbox section. Expected: it is opt-in, shows the `.claude/settings.json` snippet, and says that network is not confined under canon's headless flags and that `allowUnsandboxedCommands: false` is required to close the escape hatch.
4. Start a fresh task. Expected: `spec.md`, `spec-review.md` and `handoff.md` have bylines for the spec reviewer and the implementer, not Codex.
5. Check the default (mixed) README text. Expected: Codex still reviews specs, implements, runs the cold lens, and code goes to both providers.

## Test Results

Results below are copied from the latest `## Validation Outcomes` table in `tasks/provider-neutral-vendor-wording/handoff.md`. QA did not re-run them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | **Fail – unrelated**: one failure at `tests/task-cli.test.ts:1238` (reset-code-review fixture gets the older supervising-checkout scaffold). Isolated repro command is in handoff.md. |
| `npm run build` | Pass |
| `npm run sync-templates` / `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| AC greps (AC-2 to AC-5, AC-6c, AC-7a, AC-10) | Pass |
| Golden files (`tests/run-task-prompts.golden.json`, `tests/completion.golden.json`) unchanged | Pass |
| E2E | deferred_by_spec — spec `Validation Required` marks E2E N/A because there is no UI |

Acceptance criterion AC-12 requires `npm test` to pass, so AC-12 is **partial**. The failing test is outside the Affected Files. The handoff says it comes from the worktree template and test path, but no baseline run on `main` confirms that. Code review recorded it as verified environment-bound.

## Human Verification Required

None. No `human_pending` checks remain in handoff.md.

Pre-merge checklist items QA could not confirm:
- [ ] Version correct — the release step decides this; QA proposed no version.
- [ ] Changelog updated — the proposed entry below still needs the human's final text and the release step.
- [x] PR body current — `tasks/provider-neutral-vendor-wording/pr-body.md` is filled in.
- [ ] Final CI/CD checks green — not run in this QA pass; `npm test` already fails locally as recorded above.
- [x] Final diff matches spec intent — code review (`tasks/provider-neutral-vendor-wording/review.md`) approved with nits, and every AC except AC-12 is recorded as met in the handoff.

## Proposed Changelog

Scope test: these are user-visible in the CLI help, the README and the templates adopters receive, so they qualify. The version and bump tier are left to the release step.

### Changed

- **Role and vendor wording in the README, CLI help and artifact templates now matches `CANON_PROVIDER`.** Spec review, implementation and the cold code-review lens are described by role, with the holder named per mode: Codex in `mixed` (the default), Claude Code in `claude`. Setup, `canon doctor`, the tier descriptions and the privacy notes say which provider each step needs. The README has a new provider section, and Codex-only mode is not supported.
- **`canon run --help` names the implementer and the spec-review phase** where it used to name Codex.
- **The spec, spec-review and handoff templates name the spec reviewer and implementer** in their bylines.
- **The review scope line says "round record" instead of "cold-Codex archive record"** for Claude-mode runs.
- **The README documents an opt-in Claude sandbox** with a `.claude/settings.json` snippet. It confines Bash writes outside the repo. It does not confine network under canon's headless flags, and canon does not turn it on.

### Fixed

- **`.canon/README.md` no longer says Codex network access is on by default**; it follows the user's Codex configuration.

## Decisions Made

- Role-first wording with the provider mapping on the same line, not a separate vendor-per-role table in each doc. Lines that are only true of one provider keep the vendor name and say "in mixed mode".
- The Claude sandbox is documented as opt-in and not scaffolded or checked by `canon doctor`, per the spec's Non-Goals.
- The 2026-09 backlog sandbox note is kept and marked as a default-permissions result, rather than rewritten, so its history stays visible.
- The `Dismissed (cold-Codex)` instruction in the review template is mixed-mode only.

## Open Questions

- **`npm test` failure (`tests/task-cli.test.ts:1238`).** Is it caused by this change's template edits, or does it also fail on `main`? Neither was checked against a baseline. A run of that test on `main` would settle it. Until then, AC-12 stays partial.
- **Status-skill capitalization.** Code review noted a lowercase "implementer iterating (round N)." line in `.claude/skills/canon-status/SKILL.md`. It was not changed in this task. Decide whether to fix it in a follow-up.
- **Claude sandbox limits.** The probe ran on one Claude Code version (2.1.312, macOS, haiku). The README names that version. Re-run before you describe the sandbox as stronger than that probe showed.

Maintenance: lessons-learned.md plus this task's fragment have 24 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: npm test fails at tests/task-cli.test.ts:1238 (unrelated, not baseline-checked), so AC-12 is partial; all other checks pass per handoff.md.
