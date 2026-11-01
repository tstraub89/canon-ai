# Completion Summary: spec-manifest-lint — Reject malformed Affected Files manifests when the spec is marked done

> For the human. This is what you need to know.

## What Changed

A spec's `### Affected Files` table is the scope list that the implement preload, the `code_review` scope pre-flight, and the `--pr`/`--push` base-drift gate all read. Before this change, several malformed shapes lost paths silently or only warned, and the loss surfaced late, after implement and review budget was spent. Now the manifest is checked when the spec is marked done, and again before planning and before implementation start. Any problem is reported with its section, row number, and a fix hint.

Fenced code examples and HTML-commented tables no longer count as scope. Before, a fenced example table placed ahead of the real one displaced the real rows, and a commented-out table was read as live scope. Every consumer now reads the same scan, so the lint and the parser agree on which tables exist.

The lint rejects six shapes: fused cells, header-less table blocks, malformed path cells, ignored or duplicated `Affected Files` headings, and an empty first cell that hides a backticked path. Directory entries, comma-joined paths, and specs with no scope table stay valid. `CANON_SKIP_PHASE_GATE` and `--force` remain the escape hatches.

## Files Changed

- `src/orchestrator/markdown-table.ts` — shared manifest scan that skips fences and real HTML comments (inline code is protected); the manifest parser runs on it.
- `src/orchestrator/validation.ts` — manifest lint, issue formatter, plan/implement pre-flight reader, and the spec-done gate integration.
- `src/orchestrator/main.ts` — spec evidence recovery returns "not advanced" with the issues; `--force` forwarded to plan entry.
- `src/orchestrator/phases/plan.ts` — plan-entry pre-flight across every bundle member, before any agent or state change.
- `src/orchestrator/phases/implement.ts` — implement-entry pre-flight across every bundle member, before agents, scaffold commits, or branch setup.
- `src/orchestrator/cli.ts` — `--force` help lists the manifest pre-flight.
- `src/orchestrator/prompts/index.ts` — canonical manifest contract, used in the spec self-check.
- `src/orchestrator/prompts/templates/spec-revision.md` — states the contract for revisions.
- `.canon/templates/spec.md` and `templates/.canon/templates/spec.md` — contract under Affected Files and in the author checklist.
- `.claude/skills/canon-spec/SKILL.md` and `templates/.claude/skills/canon-spec/SKILL.md` — self-check restates the contract and the gate.
- `.claude/skills/canon-spec-review/SKILL.md` and `templates/.claude/skills/canon-spec-review/SKILL.md` — structural item 3 narrowed to completeness; format is noted as gate-enforced.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — gate, evidence recovery, pre-flights, bypasses, and full-send interaction.
- `docs/codebase-map.md` — the Affected Files parser entry now names the shared scan and the lint.
- `docs/lessons-learned.md` — removed the fused-row entry, since the rule is now enforced.
- `docs/BACKLOG.md` — the Affected Files half of "Shift the `--pr` artifact-format gates left" is marked done; the docs-refs half stays open.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt tracked bundles.
- Tests: `tests/markdown-table.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-safety.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` (regenerated), `tests/task-cli.test.ts` (one worktree-routing fixture given a canonical Design manifest; its assertions are unchanged).

## How to Test

1. Start a new task. In its spec, put two file paths in one Affected Files row, separated by a double bar (`||`). Run `canon task phase <id> spec done`. Expected: canon refuses, names the row by number, and says to put one file per row.
2. Fix the row and run the same command. Expected: it advances.
3. Rename the heading to `### Affected files` (lowercase) and run the command again. Expected: canon refuses and shows the exact heading it expects. A spec whose title merely mentions Affected Files is not flagged.
4. Write a spec with no Affected Files table and mark it done. Expected: it advances.
5. Let a task reach the human spec gate, break a row in its table, and start the pipeline. Expected: canon stops before planning, lists the problem, and gives the fix. Starting again with the force option proceeds with a warning.
6. On a task that needs a reroute, add an amendment whose table has a malformed row and start the reroute. Expected: canon stops before implementation starts, with the same kind of message.
7. Put a fenced example `### Affected Files` table before the real one. Expected: only the real table's files count in the scope checks.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 1,925 tests: 1,924 passed, 0 failed, 1 skipped (linked-worktree root test that skips under restricted git writes) |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| Scoped parser and validation tests | Pass — 279 tests across `tests/markdown-table.test.ts` and `tests/run-task-validation.test.ts` (amendment pass) |
| AC-6 red-first regressions (fenced displacement, commented table) | Fail on pre-fix parser as expected (`['example.ts']` and `['real.ts', 'old.ts']`), pass after fix |
| Mutation checks (spec gate, evidence pre-check, plan pre-flight, implement pre-flight, main force forwarding) | Each removal fails its targeted test; source restored |
| Archive calibration | 127 archived specs scanned; 15 flagged (fused-cells 3, malformed-path 4, ignored-heading 9; header-less, empty-first-cell, and duplicate-heading 0). Zero consumer path-array differences from the base parser. Archives not edited. |
| E2E | Not applicable — CLI with no UI, per the spec |

## Human Verification Required

None.

Pre-merge checklist (not yet confirmed):
- [ ] Version correct — unversioned at QA; the release step decides
- [ ] Changelog updated if needed — draft below; release step applies it
- [ ] PR body current — `tasks/spec-manifest-lint/pr-body.md` drafted
- [ ] Final CI/CD checks green — not checked from QA
- [ ] Final diff matches spec intent — the human test plan above should confirm it

## Proposed Changelog

Scope check: the gate, the pre-flights, and the parser fix all change what users see from canon, so they qualify. Version tier is for the release step to decide.

### Added

- **`canon task phase <id> spec done` rejects malformed Affected Files tables.** It lists every problem in one message, with the section, the row number, and the fix. Covered shapes: several files in one cell, a table with no header row, a path cell that cannot be read as a file, an ignored or duplicate heading, and an empty first cell hiding a path. Specs with no scope table still pass.
- **Plan and implement entry check the scope manifest before any agent runs.** A malformed table auto-blocks the phase and exits non-zero, with the fix and the rerun command. `--force` proceeds with a warning that lists the issues. This also catches manifests edited after spec review, at the human spec gate, or in a reroute amendment.

### Fixed

- **Fenced code examples and HTML-commented tables no longer count as scope.** A fenced example table placed before the real one used to hide the real rows, and a commented-out table was treated as live scope.

## Decisions Made

- **Spec-gate scope is a gate, not a new command.** Lint runs inside `canon task phase … spec done`, evidence recovery, and the plan and implement pre-flights. No `canon task lint` was added.
- **The shared scan was added as a manifest-only path.** The base extraction helper keeps its output for other consumers (handoff iterations, review rounds, the Quality Log section). Changing it would have altered those outputs, which the spec's AC-8 forbids. The manifest parser runs on the new scan.
- **Inline code is protected from the comment check.** Archive calibration found that a literal `<!--` inside backticks in a Change cell hid a live table. The scan now keeps inline code intact and removes only real comments. Pinned in `tests/markdown-table.test.ts`.
- **Duplicate exact headings are rejected even when the second has no table.** AC-5 is unconditional; only AC-4 requires a table under the heading. The plan's narrower rule was dropped.
- **Plan-only "unclosed block" issue kind was omitted.** A fence or comment that never closes hides content silently instead of raising an error. Adding a rejection there would expand the grammar. This is recorded as a residual risk (see Open Questions).
- **`--full-send` on delicate tasks runs the plan and implement pre-flights as warnings.** Delicate full-send requires `--force` (`src/orchestrator/main.ts`), so those runs bypass the pre-flight. The spec-done gate still enforces. Not widened.
- **Archive samples were classified as real silent-loss defects.** Three fused-cell hits are unescaped `||` in Change-column code. They fail AC-1 as written, which flags any extra backticked token. The column-1 scope path survives in each case. The same applies to the nine ignored-heading hits.
- **Review disposition.** Code review ran three rounds. Round 1 found an AC-8 test that read a live spec and a set of over-hiding parser cases. Round 2 found underscore-emphasized headings (N1) and `<!-->` short comments (N2). Round 3 approved with nits, with no correctness bugs remaining. Each round was fixed with red-first evidence in `tasks/spec-manifest-lint/handoff.md`.

## Open Questions

- **Unterminated fence or comment still hides the rest of the spec without an error.** This is the late, silent loss the task targets, in a narrower case. Code review raised it in rounds 1 through 3 and recommended a follow-up. Closing it means adding a lint kind, which the spec's non-goal "no grammar change beyond skipping fenced and commented content" currently forbids. Needs your call on the non-goal.
- **Foreman-written full-send amendments are not linted.** `src/orchestrator/prompts/templates/code-review-foreman.md` (lines 87–88) does not carry the manifest contract, so a foreman amendment table is never checked by the lint. Fixing it needs a scope amendment, since that file is outside this task's Affected Files.
- **Unlinted residual shapes.** Setext headings, 1–3-space indented headings, blockquoted headings, tables without leading pipes, and markdown-link path tokens inside fused or empty-first-cell rows still pass silently. Code review dismissed them as residual, not regressions.
- **Docs-refs half of BACKLOG item (b)** — running docs-refs validation at spec or pre-implement — stays open.
- **Interrupted implement with a broken spec** can pick misleading resume wording (review item R5). Deferred; no state corruption found.

Maintenance: lessons-learned.md plus this task's fragment have 26 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 3
- Validation gaps: 0
- Notes: Code review caught gaps in AC-4, AC-6, and AC-8 across three rounds (inline-code comment markers, underscore headings, short HTML comments) and approved with nits on round 3.
