# Completion Summary: configurable-docs-freshness — Configurable QA docs freshness via .canon/config.json

> For the human. This is what you need to know.

## What Changed

Adopters can now list their own long-lived docs in `.canon/config.json` under `docs_freshness`, and QA will keep them current. The config maps source-path globs to the docs QA must check when a task touches matching paths, names docs QA should flag rather than edit, and optionally replaces the default protected-doc set. Before this change, QA's list of five docs was hardcoded in the prompt, and the commit allowlist was a separate hardcoded set of six, so the two disagreed. Both now come from one loader and one resolver. A malformed config stops every run command (plain run, `--ship`, `--reroute`, `--pr`, `--push`, full-send) before any state is written, and the message names the file and the problem. Unknown keys only warn. `canon doctor` gets a docs-freshness line, `canon init` does not scaffold the file, and `canon upgrade` leaves it alone. canon-ai's own dogfood config lists the same six docs as before, so canon-ai's behavior does not change. Adopters' default set drops `docs/pipeline-orchestrator.md`, which is a canon-owned file in their repos.

## Files Changed

Source (`src/`):
- `src/orchestrator/docs-freshness.ts` — new: config loader, validator, resolver, and dot-aware glob matcher.
- `src/orchestrator/main.ts` — run-start config check, QA-end and human-review commit admission, full-send scope check, `--ship` dirt classification.
- `src/orchestrator/validation.ts` — allowlist and base-drift helpers take the admitted set.
- `src/orchestrator/worktree.ts` — retired the hardcoded managed-doc constant; shared-doc list reworked.
- `src/orchestrator/phases/qa.ts`, `phases/code-review.ts`, `phases/spec.ts` — pass the resolved sets into prompts and the pre-flight scope check.
- `src/orchestrator/prompts/index.ts` and `prompts/templates/qa.md`, `spec.md`, `spec-revision.md` — render the doc lists and map; conditional "Docs drift" instruction.
- `src/orchestrator/cli.ts`, `src/cli/index.ts` — allow-list help text.
- `src/cli/commands/doctor.ts` — docs-freshness check.

Canon-managed files and mirrors:
- `.canon/templates/spec.md`, `.canon/README.md`, `.claude/skills/canon-spec/SKILL.md`, `docs/pipeline-orchestrator.md`, and their `templates/` mirrors.
- `.canon/config.json` — new, canon-ai dogfood config.

Docs:
- `README.md` — "Configuring docs freshness" subsection.
- `docs/BACKLOG.md`, `docs/codebase-map.md`, `docs/patterns.md`.

Build output: `dist/cli/index.js`, `dist/orchestrator/run-task.js`.

Tests: `tests/docs-freshness.test.ts` (new), `tests/run-task-ship.test.ts`, `tests/run-task-safety.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-prompts.test.ts` plus regenerated `tests/run-task-prompts.golden.json`, `tests/cli.test.ts`, `tests/docs-refs-check.test.ts`.

Task artifacts: `handoff.md`, `notes.md`, `review.md`, plus the review-cold-codex files.

## How to Test

1. In a project with no config file, run a small task through QA. Expected: QA and its commit behave as before, except `docs/pipeline-orchestrator.md` is no longer a default protected doc in your repo.
2. Add `.canon/config.json` mapping a folder (for example `api/**`) to an API reference doc. Run a task that changes a file in that folder. Expected: QA's prompt names that doc, QA can correct it, and the QA-end commit succeeds.
3. Run a task that doesn't touch that folder. Expected: QA isn't asked to check that doc.
4. Put a doc in `flag_only`. Run a task. Expected: QA reports it under "Docs drift" and does not edit it.
5. Break the config (delete a closing brace), then run `canon doctor`, run a task, and try `--ship`. Expected: doctor's docs-freshness line fails, and each command stops before changing any state, naming the file and the problem.
6. Add an unknown top-level key. Expected: a warning naming the key; the run proceeds.
7. Run `canon upgrade` in a project that has a config. Expected: the config is byte-identical afterwards.
8. In canon-ai, run `canon doctor`. Expected: the docs-freshness line reads "6 protected, 0 mappings, 0 flag-only."

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass (re-run in QA, exit 0) |
| `npm run type-check` | Pass (re-run in QA, exit 0) |
| `npm test` | Pass (re-run in QA: 1445 tests, 1445 passed, 0 failed, 0 skipped) |
| `npm run docs-refs-check` | Pass (re-run in QA: "All refs OK") |
| `npm run build` | Pass (from the implement-iteration-2 validation; not re-run in QA) |
| `npm run sync-templates:check` | Pass (from the implement-iteration-2 validation; not re-run in QA) |
| Scoped docs-freshness and ship suites | Pass (101/101, implement-iteration-2) |
| E2E | N/A — spec: no UI surface |

The implement-iteration-2 run had six `npm test` failures and one `docs-refs-check` failure, both caused by a bad example path in `review.md`. Both gates pass on the current tree.

## Human Verification Required

None. The latest validation table has no `human_pending` checks.

Pre-merge checklist items this QA pass could not confirm:
- [ ] Version correct — not decided here; the release step decides the bump.
- [ ] Changelog updated — the entry text is proposed below; the release step lands it.
- [ ] PR body current — `pr-body.md` is drafted; re-check it when `--pr` runs.
- [ ] Final CI/CD checks green — no PR exists yet, so CI has not run.
- [ ] Final diff matches spec intent — the handoff shows all 37 changed non-task files match the Affected Files rows; a human should confirm the intent.

## Proposed Changelog

### Added

- **`.canon/config.json` sets which docs QA keeps fresh.** A project can list its own long-lived docs under `docs_freshness`: map source-path globs to the docs QA must check when a task touches them, name docs QA should flag rather than edit, or replace the default protected set. `canon doctor` reports the file's status, and a malformed file stops every run command before it changes any state.

### Changed

- **QA's docs-freshness list comes from the project's config.** The QA prompt names only the docs that apply to the task's changes, and the commit allowlist uses the same set, so the two no longer disagree.
- **`docs/pipeline-orchestrator.md` is no longer a default protected doc in adopter repos.** It is a canon-owned file there, and `canon upgrade` overwrites it. canon-ai keeps it in its own config.

### Fixed

- **QA can keep a project doc current without an allowlist abort.** A doc listed in the config is admitted at the QA-end commit, the human-review commit, and `--ship`, so QA edits to it no longer trip the "outside the QA-end allowlist" error.

## Decisions Made

- **Telemetry files and `tasks/` paths are rejected anywhere in `docs_freshness`,** not only in `flag_only`. A protected telemetry file would otherwise flip `--ship` classification. This came from spec review; the spec states it.
- **`--ship` validates the main checkout's config; other commands validate the worktree's config.** `--ship` classifies main-checkout dirt, so it uses that copy. The README says to commit the config before running worktree tasks.
- **Leading `./` in doc values is accepted and normalized,** not rejected. The spec's malformed list doesn't cover it, and literal comparison would silently never admit such a path. The implementer chose this; tests pin it. Telemetry and task-artifact aliases stay rejected.
- **Glob syntax:** `**`, `*`, `?`, and one-level `{a,b}`, all dot-matching, with everything else literal. This uses an in-repo matcher, not `path.matchesGlob`.
- **The run-start check uses the existing orphan probe and `getActiveCwd`,** not `resolveTaskCwd`. The direct call broke an existing completed-task PR-body recovery test. This deviates from the plan and keeps that behavior.
- **Round 2 review findings 2–4 were deferred** as optional, per the review's own non-blocking classification. Finding 1 was fixed with real-git regressions.

## Open Questions

- **Review nit 1 (open):** the `--ship` dirt guard still mis-parses a filename that contains ` -> `. It is the same parsing class as the fixed bug, and the review ranks it below blocking. Fix before merge, or file a follow-up?
- **Review nit 4 (open):** the example config in `README.md` (around line 319) and `.canon/README.md` lists `AGENTS.md` under `flag_only`, but no mapping selects it, so the example's entry is dead. The review suggests adding it to the `"**"` mapping. QA did not edit the README; the fix is small and yours to decide.
- **Self-widening config (accepted in spec):** a task can list `.canon/config.json` itself as a doc value. Rejecting that is a small follow-up spec change if you want it.
- **Docs Impact decision entry not written:** the spec suggested a `docs/decisions.md` entry for the adopter-owned config and fail-closed behavior. It was not in Affected Files, and QA doesn't add decisions. Decide whether to write it.
- **Spec Human Test Plan not run:** the spec lists eight product-level scenarios (see "How to Test"). No human run is recorded.
- **First spec-review verdict:** `status.json` keeps only the latest verdict (`approved`). Its counters (`changes_requested_total: 1`, `iterations_total: 2`) imply the first verdict was `changes_requested`. That inference is recorded in the Quality Log below.
- **Maintenance:** none. `docs/lessons-learned.md` has 11 entries after this QA pass, below the ~15 threshold.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Spec review needed one round (first verdict inferred from status.json counters); code review round 2 approved with nits, and the open nits are listed under Open Questions.
