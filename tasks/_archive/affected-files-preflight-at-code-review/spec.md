# Spec: affected-files-preflight-at-code-review — Catch files outside Affected Files at the code_review pre-flight instead of --pr

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

GitHub issue #46. Scope enforcement against the spec's `### Affected Files` happens only at the very end. When the implementer adds a file the spec doesn't list (typically a test helper or fixture):

- **implement auto-commit** (`autoCommitCode`) checks only that every dirty file has a `handoff.md` Changes-table row. The implementer lists the helper there, so it passes.
- **code_review pre-flight** (`runCodeReviewPhase` in `src/orchestrator/phases/code-review.ts`) checks the handoff against the diff (`verifyHandoffAgainstDiff`, `classifyPreflightBlockers`) but never compares the diff's file set with Affected Files. The lenses at most flag it as a nit.
- **`--pr`** (`commitHumanReviewFiles` in `src/orchestrator/main.ts`, via `verifyBaseDrift` in `src/orchestrator/validation.ts`) compares the tree diff against Affected Files and aborts with "not in the spec's Affected Files".

So an already-reviewed file is rejected after the full pipeline has run, and the only recovery is an operator edit to the spec followed by `--pr` again. Observed on canon 3.1.1.

A second false alarm in the same gate: `verifyBaseDrift` diffs the tree two-dot against `origin/<base>` (`getTreeDriftFiles`). When the base branch advances mid-run (e.g., an operator docs commit on `main`), files changed only on the base show up as "not in the spec's Affected Files". That message points at scope when the actual fix is to merge or rebase the base into the task branch.

Mechanism confirmed by code trace. It is deterministic: `autoCommitCode`'s coverage check and the pre-flight classifiers never read `parseAffectedFilesFromSpec`; only `verifyBaseDrift` does.

## Decision

1. **One allowlist builder.** Extract the allowlist construction from `verifyBaseDrift` into one shared builder used by both gates: Affected Files from `## Design` and `## Amendment*` sections (via `parseAffectedFilesFromSpec`, including directory-form prefixes), `PIPELINE_TELEMETRY_FILES`, and the bundle members' `tasks/<id>/` directories. The caller decides whether `PIPELINE_MANAGED_DOCS` are admitted. `--pr` keeps today's rule (admitted once `qa` is done). The code_review pre-flight always admits them, so it is never stricter than `--pr` will be after QA.
2. **Scope check at code_review pre-flight.** Before any cold-Codex or Claude session, the pre-flight compares the task's own changes (`<base>...HEAD`, three-dot, rename-aware so both paths of a rename count) against the allowlist, using the union of all bundle members' allowlists.
   - **Normal run:** if any file is out of scope, `code_review` halts for a human before any review runs. The message lists the files and gives both fixes: (a) add them to the spec's Affected Files (in the task worktree) and re-run `canon run <id>`; or (b) reroute with a note telling the implementer to remove them. The halt does not bump review-loop counters (`iterations_current_loop`, `iterations_total`, `preflight_rejections_*`). It also doesn't make the next review render as a later round: if the halt happened before the first review, the next review is still Round 1.
   - **Full-send run** (`status.full_send === true`): no halt, and the orchestrator does **not** amend the spec itself. It continues into review and passes the out-of-scope file list to the code-review foreman prompt. The foreman, which holds the spec and the diff, judges each file and records one of three outcomes:
     1. **Appropriate scope expansion** (the file is needed to meet the ACs and fits the spec's intent): the foreman appends an `## Amendment` section to the task's `spec.md` with a `### Affected Files` table row for the file and a one-line reason naming it a full-send scope expansion.
     2. **Spec miss** (the spec should have listed it; e.g. a fixture or a rebuilt artifact the author forgot): same amendment, with the reason naming it a spec miss.
     3. **Should not have been changed** (outside the task's intent, or a change the implementer had no business making): no amendment; the foreman writes a finding that the file must be reverted or removed and sets `changes_requested`.
     `review.md` lists each out-of-scope file with its outcome and reason. After the foreman session ends, the orchestrator re-checks: every listed file must now be in Affected Files (via `parseAffectedFilesFromSpec`) or the verdict must be `changes_requested`. If neither holds, `code_review` fails closed with an auto-block naming the unjudged files. On the next round, amended files are in scope and not re-listed; reverted files are gone from the diff.
3. **Clearer `--pr` base-advance message.** In the `--pr` base-drift abort, drift files that the task itself did not change (absent from `<origin/base>...HEAD`) are reported under a "the base branch advanced — merge or rebase it into the task branch" message. Task-changed out-of-scope files keep the existing "not in the spec's Affected Files" message. If both kinds are present, both lists are shown. The gate blocks in every case, exactly as today; only the wording changes.
4. **Implement prompt clarity.** `src/orchestrator/prompts/templates/implement.md`'s Scope Discipline rule 1 says explicitly that new helpers, fixtures, and test files count against the Affected Files cap.

## Non-Goals

- **No directory-prefix matching changes** (#14). The builder reuses today's trailing-slash prefix semantics.
- **No automatic scope amendment in normal (non-full-send) runs, and no orchestrator-written amendment in any run.** Only the foreman amends, and only in full-send. Backed by AC-4 and AC-5.
- **No change to how `--pr` computes its diff** (still two-dot vs `origin/<base>`) or to whether it blocks. Backed by AC-8.
- **No change to `autoCommitCode`'s handoff coverage checks.**

## Acceptance Criteria

- [ ] AC-1: **Shared builder, no fork.** One exported builder produces the allowlist (exact paths + prefixes) for a set of task IDs, with a flag for admitting `PIPELINE_MANAGED_DOCS`. `verifyBaseDrift` and the new pre-flight check both call it, and `verifyBaseDrift`'s existing tests still pass unchanged. Verify: unit tests for the builder in `tests/run-task-validation.test.ts` (Design + Amendment rows, directory prefix, telemetry, task dirs, managed-docs flag on/off); reviewer confirms `verifyBaseDrift` no longer builds its own set.
- [ ] AC-2: **Pure scope check.** A `*FromData` function takes the task's changed paths (rename pairs expanded to both paths) and the allowlist and returns the out-of-scope paths. Verify: unit tests with positive and negative cases, including a rename whose new path is out of scope, a path under an allowed directory prefix, and a managed doc admitted at code_review.
- [ ] AC-3: **Normal-run halt.** A test drives `runCodeReviewPhase` with a diff containing a file outside Affected Files and `full_send` unset. `code_review` ends blocked before `runColdCodexReview` or `runClaude` is called; the escalation reason lists the file and both fixes; `iterations_current_loop`, `iterations_total`, and `preflight_rejections_*` are unchanged. Verify: test with stubbed deps asserting no agent calls and the counter values.
- [ ] AC-4: **Resume after spec edit.** After the AC-3 halt, adding the file to the spec's Affected Files and re-running enters `code_review` with the pre-flight passing and renders Round 1 (if no prior review existed). Verify: test.
- [ ] AC-5: **Full-send hands the list to the foreman.** Same setup with `full_send: true`: no halt, `spec.md` is unchanged by the orchestrator, `runColdCodexReview` and `runClaude` are called, and the foreman prompt names each out-of-scope file and instructs the three-outcome judgment (scope expansion or spec miss → append an `## Amendment` with an exact `### Affected Files` table row and a reason; should-not-have → finding + `changes_requested`) and the per-file record in `review.md`. When there are no out-of-scope files, or in a normal run, the prompt renders no such block. Verify: runner test with stubbed deps (spec.md byte-unchanged before `runClaude`, both agents called); a new golden key for the foreman prompt with out-of-scope files; existing foreman goldens unchanged.
- [ ] AC-6: **Post-foreman enforcement.** After the foreman session in a full-send run with out-of-scope files: (a) if every listed file is now returned by `parseAffectedFilesFromSpec`, the phase proceeds normally with the foreman's verdict; (b) if the verdict is `changes_requested`, it routes back to implement as usual; (c) if a listed file is neither amended nor covered by a `changes_requested` verdict, `code_review` auto-blocks, and the reason names the unjudged file. Verify: three runner tests with a stub foreman that writes each outcome.
- [ ] AC-7: **In-scope diffs are unaffected.** A diff whose files are all in Affected Files, task dirs, telemetry, or managed docs passes the new check, and the existing pre-flight behavior (format/regression/blocked buckets) is unchanged. Verify: existing pre-flight tests pass; a new passing-case test.
- [ ] AC-8: **`--pr` base-advance wording.** The `--pr` base-drift abort separates drift files the task changed from files changed only on the base. The base-only list is labelled as the base branch having advanced, with merge/rebase guidance. The out-of-scope list keeps "not in the spec's Affected Files". The gate still aborts in all drift cases. Verify: unit tests on the classification (`*FromData` style) for all-base-only, all-task, and mixed inputs, plus a reviewer check of the message text.
- [ ] AC-9: **Implement prompt.** `implement.md` Scope Discipline rule 1 names new helpers, fixtures, and test files as counting against the Affected Files cap. Verify: regenerated goldens in `tests/run-task-prompts.golden.json` show only that change for implement prompts.
- [ ] AC-10: **Build and suite.** `npm run build` output committed and matching; lint, type-check, full test suite (with `UPDATE_GOLDENS=1` regeneration), docs-refs-check, and `sync-templates:check` pass.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/validation.ts` | Extract the allowlist builder from `verifyBaseDrift`; add the pure scope-check function; add the base-only vs task-changed drift classification. |
| `src/orchestrator/phases/code-review.ts` | Add the scope check to the `runCodeReviewPhase` pre-flight: normal-run halt; full-send hand-off of the out-of-scope list to the prompt; post-foreman enforcement (AC-6). |
| `src/orchestrator/prompts/index.ts` | `promptCodeReview` accepts the out-of-scope list and renders the full-send judgment block. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Full-send out-of-scope judgment block (three outcomes, amendment format, `review.md` record); renders only when the list is non-empty. |
| `src/orchestrator/main.ts` | `commitHumanReviewFiles` base-drift abort message split into base-advanced vs out-of-scope lists. |
| `src/orchestrator/git.ts` | Helper for the task's rename-aware three-dot changed paths if an existing one (`getAffectedFiles` / `parseNameStatusOutput`) doesn't already fit. |
| `src/orchestrator/prompts/templates/implement.md` | Scope Discipline rule 1 wording. |
| `tests/run-task-validation.test.ts` | Builder, scope-check, and drift-classification unit tests. |
| `tests/run-task-code-review.test.ts` | Halt, resume, full-send hand-off, post-foreman enforcement, in-scope cases. |
| `tests/run-task-prompts.test.ts` | Golden state for a foreman prompt with out-of-scope files. |
| `tests/run-task-prompts.golden.json` | Regenerated implement goldens; new foreman golden key. |
| `dist/orchestrator/run-task.js` | Rebuilt output. |
| `dist/cli/index.js` | Rebuilt output if the build rewrites it. |
| `docs/pipeline-orchestrator.md` | Describe the code_review Affected-Files pre-flight (normal-run halt and its two fixes; full-send foreman judgment and post-foreman enforcement) and the `--pr` base-advanced vs out-of-scope message split. |
| `templates/docs/pipeline-orchestrator.md` | Derived mirror of the root guide; regenerate with `npm run sync-templates`, do not hand-edit. |

### Interaction Dependencies

- **Delta re-rounds (shipped in `code-review-delta-rerounds`, PR #61)** changed `runCodeReviewPhase` and the foreman template. The new pre-flight check goes before `taskPhase(..., 'in_progress')`; the out-of-scope block is independent of full/delta scope and renders in either.
- **Full-send + reroute:** reroute clears `full_send` today, so a rerouted task gets the normal-run halt.
- **Bundles:** one check over the combined diff against the union allowlist. In full-send, the foreman prompt tells the foreman which member spec(s) to amend. It picks the member whose ACs the file serves, and the enforcement check accepts an amendment in any member's spec.
- **The QA-end commit and `--pr`** read `## Amendment*` Affected Files via `parseAffectedFilesFromSpec`, so full-send amendments flow through without other changes.

### Data Model Changes

None to `status.json`. In full-send runs, the code-review foreman may append an `## Amendment` section to `spec.md`.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite, with regenerated goldens
- [x] `npm run build` — committed `dist/` must match
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check` — the `templates/` guide mirror matches the root copy
- [ ] E2E — N/A

## Docs Impact

- `docs/pipeline-orchestrator.md` (and its `templates/` mirror via `npm run sync-templates`): the code_review pre-flight description and the `--pr` base-drift description. Both paths are in Affected Files.
- `docs/decisions.md`: not edited during implement. QA's Docs Freshness sweep may add an entry (the code_review pre-flight owns Affected-Files enforcement; in full-send the foreman judges out-of-scope files) if it judges one warranted.

## Known Risks

- **Stricter than `--pr`:** if the pre-flight allowlist differs from what `--pr` accepts after QA, it would halt valid work. The shared builder plus always admitting managed docs at code_review prevents that (AC-1, AC-2).
- **Halt state and re-run:** an auto-block must be resumable with just a spec edit and `canon run`. If the blocked status needs a reset command, the halt message must say so, and AC-4 pins the path.
- **Round rendering:** writing a pre-flight block into `review.md` could make the next real review render as Round N. AC-3/AC-4 require Round 1 to survive.
- **Full-send amendment format:** the parser only reads an exact `### Affected Files` H3 inside an `## Amendment*` section, and an LLM may get it slightly wrong. The post-foreman enforcement (AC-6c) catches a malformed or missing amendment and auto-blocks instead of letting `--pr` fail later.
- **Foreman leniency:** the foreman may label everything a scope expansion. Its classification and reason are recorded per file in `review.md` and the amendment reason, so it's visible in the PR diff, where full-send puts human review.
- **Dist artifacts:** a canon-on-canon task that forgets to declare a rebuilt `dist/` file will now halt at code_review instead of `--pr`. That's the intended earlier catch.

## Human Test Plan

1. Run a task where the implementer adds a small helper file the spec didn't list.
2. Expected: the pipeline stops before code review and tells you which file is out of scope, with two ways to fix it.
3. Add the file to the spec's file list and run the pipeline again. Expected: code review proceeds normally.
4. Run the same scenario as a full-send task. Expected: no stop. The code review says whether the helper was a reasonable addition, a spec oversight, or something that should be removed. In the first two cases, the opened PR shows a spec addendum listing the helper and why; in the third, the pipeline sends it back to be removed.
5. While a task runs, land an unrelated commit on the base branch, then open the PR. Expected: the error says the base branch moved ahead and to merge or rebase, not that the file is out of scope.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism (deterministic, by code trace); red-first coverage via AC-3 (halt fails on pre-fix code, since no check exists) and AC-8
