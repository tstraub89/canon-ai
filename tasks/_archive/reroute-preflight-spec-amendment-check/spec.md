# Spec: reroute-preflight-spec-amendment-check — Pre-flight check: --reroute requires `## Amendment Round N` heading in spec.md

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Operator-Claude (and human operators) can run `canon run <id> --reroute` from `human_review` without first amending `tasks/<id>/spec.md` with the new direction. When that happens, Codex re-implements against an unchanged spec → produces the same implementation → ships the same bug.

This was reproduced live during 1.4 development (GP project, 2026-05-23): operator-Claude saw Codex's findings on a PR, copied the findings into `review.md`, then ran `--reroute`. Codex re-read `spec.md` (unchanged), implemented identically, and the same regression shipped.

The docs half — `canon run --help` guidance for `--reroute`, plus updated `docs/pipeline-orchestrator.md` Reroute feedback channel text — landed in commit `58d2552` (PR #95 lineage). This task adds the **mechanical guard**: a pre-flight check at `--reroute` time that aborts unless the operator has labeled the new round of direction with `## Amendment Round N` in spec.md.

## Decision

Apply an **asymmetric heading requirement** based on how many reroutes have already happened on this task:

- **First reroute** (operator is entering round 1): spec.md must contain a heading matching `## Amendment` (case-insensitive, heading levels h2–h6). The bare keyword is sufficient — no round number required yet.
- **Subsequent reroutes** (operator is entering round 2 or beyond): spec.md must contain `## Amendment Round N` (case-insensitive, h2–h6) where N equals the round the operator is about to enter. The round number is the disambiguator that becomes necessary only when multiple rounds coexist.

Both branches anchor on the same root keyword `Amendment`. No `Follow-up` / `Post-review` / other variants accepted — those encourage label drift and split operator attention across synonyms. One word, one convention.

The check is a text grep — no git plumbing, no state in `status.json`.

When `canon run <ids> --reroute` is invoked from `human_review`, run a per-task pre-flight check **before** mutating any `status.json`. For each task:

1. Compute `requiredRound = (status.phases.implement.reroute_count ?? 0) + 1`. The pre-flight runs **before** the increment at `main.ts:1753`, so `requiredRound` is the round the operator is about to enter.
2. Read `tasks/<id>/spec.md`.
   - If `requiredRound === 1`: pass iff the regex `/^#{2,6}\s+Amendment\b/im` matches. (Note: `## Amendment Round 1` also matches this regex — using the strict form on round 1 is allowed.)
   - If `requiredRound >= 2`: pass iff the regex `/^#{2,6}\s+Amendment\s+Round\s+(\d+)\b/im` matches AND the captured `\d+` equals `requiredRound`.
3. If the check fails, abort the entire `--reroute` invocation with a per-task error message naming the task ID, the expected heading text, and a pointer to `docs/pipeline-orchestrator.md` § Reroute feedback channel.
4. `--force` bypasses the check (operator may have legitimate reasons — e.g., they want Codex to re-implement against the existing spec). The bypass writes a one-line stderr notice naming each task and the bypass reason.

Update the reroute prompt template (`scripts/run-task/prompts/templates/implement-reroute.md`) to inject the round number and direct Codex to focus on the matching section. The prompt expects `## Amendment` for round 1 and `## Amendment Round N` for round 2+. Codex should ignore prior-round sections when implementing a later round. Legacy variants ("Follow-up", "Post-review") are dropped from the prompt.

The check fires only on `--reroute` (which is `human_review`-only per the existing phase guard at `main.ts:1733`).

## Non-Goals

- **Validating Amendment content quality.** We check for the heading; we don't lint what comes under it. If the operator writes the right heading followed by empty content, the check passes. That's an operator-discipline failure, not a tooling failure.
- **Walking git history or tracking spec.md state in status.json.** No `phases.implement.spec_sha_at_reroute` field; no commit anchor; no diff. The single signal is the heading in the spec.md text.
- **Forcing round-numbered labels on first reroute.** The asymmetric design keeps friction low for the common case (0–1 reroute). If/when a task hits round 2, the disambiguator becomes required automatically.
- **Accepting `## Follow-up` or `## Post-review` headings.** The current prompt's loose synonym set encourages label drift; this task narrows the convention to a single root keyword (`Amendment`). The pre-flight gate enforces it.
- **Auto-incrementing N for the operator** (e.g., reading the current `reroute_count` and inserting the heading on the operator's behalf). The operator authors spec.md; the gate verifies.
- **Cross-task content checks** in bundle reroutes. The check is per-task; each task in a bundle is checked against its own `reroute_count`.

## Acceptance Criteria

- [ ] **AC-1**: A new exported function `verifyRerouteAmendment(taskId: string, requiredRound: number, cwd: string): { amended: boolean; reason: string }` lives in `scripts/run-task/validation.ts`. Behavior:
  - If `requiredRound === 1`: `amended === true` iff `tasks/<id>/spec.md` (read from `cwd`) contains a heading matching `/^#{2,6}\s+Amendment\b/im`. (The strict form `## Amendment Round 1` also matches this regex.)
  - If `requiredRound >= 2`: `amended === true` iff spec.md contains a heading matching `/^#{2,6}\s+Amendment\s+Round\s+(\d+)\b/im` AND the captured `\d+` equals `requiredRound`.
  The `reason` field is empty on `amended: true` and human-readable on `amended: false` — distinguishing the round-1 miss ("no `## Amendment` heading found"), the round-2+ no-match ("no `## Amendment Round N` heading found"), the round-2+ mismatch ("found Round X, expected Round Y"), and the missing-file case. Verify by reading the source and by the unit tests in AC-5.
- [ ] **AC-2**: `rerouteFromHumanReview` in `scripts/run-task/main.ts` calls `verifyRerouteAmendment` for each task ID **after** the existing `currentPhase !== 'human_review'` validation loop and **before** any `splitState.writeStatus` call. The `requiredRound` argument is computed as `(status.phases.implement?.reroute_count ?? 0) + 1` — i.e., the round the operator is about to enter. If any task returns `amended: false` and `cliArgs.force === false`, the function `splitCli.die`s with a multi-line message that:
  - Names each failing `taskId`, its `spec.md` path, the per-task `requiredRound`, the expected heading text (`## Amendment` for round 1; `## Amendment Round N` for round 2+), and the per-task `reason` from the helper,
  - Quotes the bypass instruction `Bypass with --force if you have verified the lack of amendment is intentional.`,
  - Points at `docs/pipeline-orchestrator.md` § Reroute feedback channel.
  Verify by inspecting the call site at `main.ts:1730` and by the integration test in AC-7.
- [ ] **AC-3**: When `cliArgs.force === true` AND at least one task fails the check, `rerouteFromHumanReview` proceeds with reroute but emits a single warning line per failing task to stderr. The warning names the task ID, the required round, and the heading that was expected — e.g., `⚠ --force bypass: <taskId> spec.md missing required Round <N> amendment heading; Codex will re-implement against the existing spec.`. Verify by integration test in AC-8.
- [ ] **AC-4**: `verifyRerouteAmendment` reads spec.md via `fs.readFileSync(path.join(cwd, 'tasks', taskId, 'spec.md'), 'utf8')` — consistent with other validation helpers in the file. If the file does not exist, the helper returns `{ amended: false, reason: 'spec.md missing at <path>' }` (NOT a thrown error — the caller's abort message includes this reason). Verify by reading the source and by the unit test that covers the missing-file case.
- [ ] **AC-5**: `tests/run-task-validation.test.ts` gains seven new tests for `verifyRerouteAmendment`:
  - **Round 1 cases**:
    - Case A: `amended: true` when spec.md contains `## Amendment` and `requiredRound === 1`
    - Case B: `amended: true` when spec.md contains `### amendment` (h3, lowercase) and `requiredRound === 1` — proves the regex is case-insensitive and accepts h2–h6
    - Case C: `amended: true` when spec.md contains `## Amendment Round 1` (strict form on round 1 still satisfies) and `requiredRound === 1`
    - Case D: `amended: false` when `requiredRound === 1` and spec.md has no `## Amendment` heading
    - Case E: `amended: false` when `requiredRound === 1` and spec.md only has `## Follow-up` (legacy variant; rejected to enforce the single-keyword convention)
  - **Round 2+ cases**:
    - Case F: `amended: true` when spec.md contains `## Amendment Round 2` and `requiredRound === 2`
    - Case G: `amended: false` when `requiredRound === 2` and spec.md only has `## Amendment Round 1` — `reason` must name both the seen round (1) and the expected round (2)
    - Case H: `amended: false` when `requiredRound === 2` and spec.md only has the round-1 form `## Amendment` (insufficient at round 2+; loose form doesn't carry forward)
  - **Edge case**:
    - Case I: `amended: false` with `reason` mentioning the missing file when spec.md does not exist
  Note: the test count (nine cases) is preserved from the prior iteration — Case B now covers h3 + lowercase together; Case E exercises the rejection of legacy variants explicitly. Each test uses `fs.mkdtempSync` for fixtures following the pattern in existing tests (e.g., the `tests/run-task-validation.test.ts:362` neighborhood). Verify by running `npm test` and observing the new test names.
- [ ] **AC-6**: `canon run --help` text for `--reroute` (in `scripts/run-task/cli.ts:48-52`) gains a short note describing the asymmetric requirement: round 1 requires `## Amendment` in spec.md; round 2+ requires `## Amendment Round N`; bypass with `--force`. Inserted between the existing description and the "See CLAUDE.md" pointer. Verify by running `canon run --help` and reading the output.
- [ ] **AC-7**: Integration test in `tests/run-task-reroute-preflight.test.ts` (NEW file): a task at `human_review` with spec.md missing the Amendment Round 1 heading invokes the CLI entry point WITHOUT `--force` → exits non-zero with the AC-2 error message; `status.json` is untouched. Verify by running `npm test`.
- [ ] **AC-8**: Same test file as AC-7: same scenario but WITH `--force` → exits 0; `status.json` shows `phases.implement.status === 'pending'`, `phases.implement.rerouted === true`, and `phases.implement.reroute_count === 1`; stderr contains the AC-3 warning. Verify by running `npm test`.
- [ ] **AC-9**: Bundle reroute (multiple task IDs) reports ALL failing tasks in the abort message — not just the first one. So if 3 tasks all fail the check and `--force` is not passed, the error names all 3 with their spec.md paths, expected round numbers, and per-task reasons; `status.json` is untouched for all 3. Verify by integration test (extension of the AC-7 fixture).
- [ ] **AC-10**: Multi-round reroute test in the same integration file: a task with `phases.implement.reroute_count === 1` (i.e., one prior reroute already happened) invokes `--reroute`. spec.md contains the round-1 form `## Amendment` from the prior reroute but NOT `## Amendment Round 2`. The check fails — the round-2+ branch requires the strict label, not just the bare `## Amendment`. The error message indicates the round-1 form is insufficient at round 2+ and shows the expected heading. Adding `## Amendment Round 2` and re-running succeeds. Verify by running `npm test`. This is the boundary case that justifies the asymmetric design: round 1's bare keyword does NOT carry forward.
- [ ] **AC-11**: `scripts/run-task/prompts/templates/implement-reroute.md` line 15 is updated to:
  - Inject the current round number (the post-increment `reroute_count`, i.e., the round Codex is being asked to implement).
  - For round 1: direct Codex to scan for `## Amendment` in spec.md.
  - For round 2+: direct Codex to find the specific `## Amendment Round N` heading where N matches the injected round, and ignore prior-round sections when implementing.
  Legacy variants ("Follow-up", "Post-review") are explicitly removed from the prompt. Verify by reading the updated prompt and by inspecting the prompt-construction code in `scripts/run-task/agents/codex.ts` (or wherever this prompt is loaded) to confirm the round number is interpolated.
- [ ] **AC-12**: `docs/pipeline-orchestrator.md` § Reroute feedback channel gains a paragraph documenting (a) the asymmetric heading requirement (round 1 = `## Amendment`; round 2+ = `## Amendment Round N`), (b) the pre-flight check behavior, (c) the `--force` bypass syntax, and (d) the rationale ("operator-Claude pattern-matched `--reroute` without amending spec.md → Codex re-implemented identically → same bug shipped"; strict label only when disambiguation is actually needed). The doc also explicitly notes that legacy variants ("Follow-up", "Post-review") are no longer accepted. Verify by reading the doc.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Add `verifyRerouteAmendment(taskId, requiredRound, cwd)` near the existing `parseValidationRequiredChecks` family (around line 134). ~25 lines including the regex match + missing-file fallback + reason-string assembly. |
| `scripts/run-task/main.ts` | Modify `rerouteFromHumanReview` (currently lines 1730-1788) to invoke `verifyRerouteAmendment` per task after the phase-validation loop. Compute `requiredRound` per task. Aggregate failing tasks. Add the multi-line abort message + per-task `--force` warning emit. Threads `cliArgs.force` (already in scope via the module-level `cliArgs`). ~30 lines added. |
| `scripts/run-task/cli.ts` | Add the one-line `--reroute` help note per AC-6. ~1 line added. |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Update line 15 to narrow the scan target to `## Amendment Round N` and inject the round number. ~2-3 lines changed. |
| `tests/run-task-validation.test.ts` | Add the six unit tests per AC-5 (Cases A-F). Use the existing `withTempDir` + `fs.mkdtempSync` pattern from neighboring tests. ~100 lines added. |
| `tests/run-task-reroute-preflight.test.ts` | NEW. Integration tests for AC-7, AC-8, AC-9, AC-10 (no-force abort, --force bypass, bundle multi-failure, multi-round). ~150 lines. |
| `docs/pipeline-orchestrator.md` | Add paragraph in § Reroute feedback channel per AC-12. ~8-10 lines. |
| `templates/docs/pipeline-orchestrator.md` | Mirror the same § Reroute feedback channel paragraph so adopters receive the doc change via `canon upgrade`. Canon-delimited parallel-edit convention (`feedback_canon_delimited_files_template_parallel_edit`). |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` to reflect main.ts + validation.ts changes. |
| `dist/cli/index.js` | Regenerated by `npm run build` to reflect cli.ts help text. (Empirically unchanged — cli.ts bundles into dist/scripts/run-task.js, not dist/cli/index.js; left in spec for completeness.) |
| `scripts/run-task/prompts/index.ts` | Inject the round number (`rerouteRound`) into the implement-reroute prompt and update the per-task `taskLines` context line to reference only `## Amendment` / `## Amendment Round N` (dropping legacy variants). |
| `tests/run-task-prompts.golden.json` | Refreshed snapshot for the reroute prompt template after `rerouteRound` injection. Regenerated via `UPDATE_GOLDENS=1 npm test`. |
| `tests/run-task-safety.test.ts` | Updated the reroute/full_send safety fixture to use a worktree-backed spec so it exercises the real reroute path after the new pre-flight. |

### Interaction Dependencies

- **`--force` flag semantics** — currently used to bypass base-drift check (`scripts/run-task/main.ts:918`) and `--full-send` on delicate tasks. Adding a third bypass site is consistent with the existing pattern (single `--force` covers all bypass-worthy gates in one invocation). Operators who pass `--force` for one reason should be aware it also covers this new gate; the warning line per AC-3 keeps that visible.
- **Bundle mode** — `canon run <a> <b> <c> --reroute` reroutes all listed tasks. The pre-flight runs per-task. If any task fails AND `--force` is absent, the entire invocation aborts before any `status.json` mutation (consistent with the existing phase-check loop at `main.ts:1731-1736` which aborts the bundle if any task isn't at `human_review`).
- **Worktree mode** — for worktree-mode tasks (the default), the `cwd` passed to `verifyRerouteAmendment` must be the worktree path (where the operator's spec.md edits land). `rerouteFromHumanReview` resolves this via `resolveTaskCwd(taskId)` per task. **However** — there is a known issue (BACKLOG: "parseAffectedFilesFromSpec reads from REPO_ROOT in worktree mode") where some parsers ignore the cwd parameter. `verifyRerouteAmendment` MUST use the cwd argument and MUST be tested with worktree-mode fixtures (AC-7 covers this). Do not silently fall back to REPO_ROOT.
- **`reroute_count` semantics** — the field is incremented at `main.ts:1753` AFTER pre-flight. So at pre-flight time, the field reflects the count of PRIOR reroutes; `requiredRound = (reroute_count ?? 0) + 1` is the round being entered. First-ever reroute has `reroute_count === 0` (or undefined), requiring `## Amendment Round 1`.
- **Implement-reroute prompt** — currently directs Codex to look for "Amendment / Round N / Follow-up / Post-review" sections. AC-11 narrows this to `## Amendment Round N` with the round number injected. **Backwards compatibility risk**: tasks in flight that already used the legacy form (e.g., a task at `human_review` with `## Follow-up` from a previous reroute) will fail the new check. Mitigation: this is shipping in 1.4 with no in-flight tasks using legacy reroute headings; the BACKLOG and task-quality-log don't show any. If discovered post-ship, `--force` is the escape.
- **Spec template** — `.canon/templates/spec.md` does not currently mention the Amendment Round N convention. Out of scope for THIS task (the convention is operator-time, not spec-author-time), but worth a follow-up to add an "Amendments" header guidance section to the template.

### Data Model Changes

None. No new fields in `status.json`. No new templates. The check reads exclusively from spec.md text + the existing `reroute_count` field.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — full suite, including the new unit tests in `tests/run-task-validation.test.ts` and the new integration tests in `tests/run-task-reroute-preflight.test.ts`
- [x] `docs-refs-check` (`npm run docs-refs-check`) — the gate just shipped; this PR runs through it.
- [x] `build` (`npm run build`) — REQUIRED. Changes to `scripts/run-task/{validation,main,cli}.ts` regenerate `dist/`. Per [docs/architecture.md](../../docs/architecture.md) Validation section, committed `dist/` must match a fresh build; CI runs `git diff --exit-code -- dist/` and fails on staleness. Implementer must `npm run build` and commit `dist/` deltas alongside source.
- [ ] `E2E` — N/A; no UI

## Docs Impact

- `docs/pipeline-orchestrator.md` — § Reroute feedback channel gains the pre-flight check paragraph + canonical heading documentation (AC-12).
- `canon run --help` — `--reroute` description gains the one-line note (AC-6).

No other protected docs need updates.

## Known Risks

- **Operator uses a heading variant neither regex matches**: e.g., `## Amendment - Round 1` (extra punctuation) or `## Amendment Round One` (word number). The check fails; error message names the expected heading text verbatim so the operator can copy/paste. Discipline-enforcing tools fail closed.
- **Round 1 → Round 2 boundary surprise**: an operator who used `## Amendment` on round 1 might assume the same form works on round 2 and get an abort. The error message must clearly say "round 2+ requires the strict `## Amendment Round N` form" so this is a one-time learning moment, not a recurring frustration. AC-10's test ensures this exact case is covered.
- **Multi-task bundle, mixed reroute counts**: tasks A and B both at `human_review`, A has `reroute_count=1` (entering round 2) and B has `reroute_count=0` (entering round 1). Each is checked with the appropriate branch. If A is missing `## Amendment Round 2` and B has `## Amendment`, A fails and B passes — error names only A.
- **Operator amends spec.md with the right heading but Codex's reroute pass somehow still no-ops**. Out of scope — the guard verifies the heading; the implement-reroute prompt (AC-11) is the second layer that directs Codex to the matching content.
- **Worktree-mode regression**: the prior BACKLOG entry on `parseAffectedFilesFromSpec` reading REPO_ROOT instead of the worktree is the same class of bug. The implementer MUST use the `cwd` argument throughout `verifyRerouteAmendment` and the integration tests MUST set up worktree-mode fixtures.
- **No content under the heading**: operator writes the right heading and nothing else. The check passes. Codex reads spec.md and finds the heading with empty content. Same outcome as no heading. Mitigated by AC-11's prompt update + operator discipline.

## Human Test Plan

1. From `release/v1.4` with this task merged, pick a small task currently at `human_review` (or scaffold one with `canon task new` and manually advance it through phases via `canon task phase` for testing purposes). Confirm `tasks/<id>/spec.md` does NOT contain a `## Amendment` heading.
2. Run `canon run <id> --reroute` without editing `spec.md`. Expected: the command exits non-zero, names the task, says the round-1 reroute requires `## Amendment` in spec.md, and points at the spec amendment guidance. `status.json` is unchanged.
3. Add a `## Amendment` section to `tasks/<id>/spec.md` with at least one line of guidance content. Run the same command. Expected: the command proceeds; `status.json` shows the reroute applied.
4. Let the pipeline run a second time to `human_review`. Without further edits to spec.md (the `## Amendment` from round 1 is still there), run `canon run <id> --reroute`. Expected: the command exits non-zero — round 2 requires `## Amendment Round 2` even though `## Amendment` was accepted at round 1.
5. Add `## Amendment Round 2` (with content) to spec.md. Run the reroute. Expected: succeeds.
6. (Force bypass) Reset a task to `human_review` with no `## Amendment` heading. Run `canon run <id> --reroute --force`. Expected: command proceeds, prints a warning line naming the task and required round, and `status.json` shows the reroute applied.
7. (Bundle case) Scaffold two tasks both at `human_review` with no `## Amendment` headings. Run `canon run <a> <b> --reroute`. Expected: abort lists both tasks with their expected headings; neither status.json is mutated.
8. (Legacy variant rejection) Add `## Follow-up` (instead of `## Amendment`) to a task at `human_review` and run `--reroute`. Expected: the check fails — `## Follow-up` is no longer accepted.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names) — *Note: canon's "human" is the operator/developer; the language is appropriate for that audience.*
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`)
