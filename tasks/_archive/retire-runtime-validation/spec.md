# Spec: retire-runtime-validation — Retire runtime_validation pipeline phase

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The `runtime_validation` phase exists as an orchestrator-run witness layer against agents fabricating Pass results. The thesis is wrong:

1. **Empirical**: agents don't fabricate test execution. The real failure modes (skipping checks the spec didn't crisply require; misclassifying real failures as "unrelated"; summarizing partial-pass results as "tests pass") are spec-clarity and interpretation failures, not execution failures. They happen regardless of *who* ran the check. Stage 1 code review (Claude reading the outcomes table against the diff and the spec) is the only layer that catches these — and that layer is unaffected by who ran the check.

2. **Architectural**: there is no trust asymmetry between "what the orchestrator runs" and "what Codex runs in its sandbox" — both execute in the operator's terminal. Codex's tighter default sandbox is OpenAI's shipping choice, configurable per phase via `.codex/config.toml`. The witness boundary is theater.

The full reframe is settled in `docs/decisions.md` "Validation runs inside agent phases (supersedes orchestrator-run `runtime_validation`)". That entry authorizes this task. The retirement also kills the unshipped `.canon/phases.ts` project-policy extension point design — adopters extend validation via Codex's sandbox + project scripts, not via canon-side policy modules.

Currently shipped:
- `runtime_validation` phase between `implement` and `code_review` in `PHASE_ORDER`.
- A phase handler (`scripts/run-task/phases/runtime-validation.ts`) that executes registered `RUNTIME_CHECKS`, writes `## Runtime Validation Outcomes` to `handoff.md`, and routes back to implement on failure.
- A single registered check: `{ name: 'orchestrator-phase-smoke', command: 'echo orchestrator-phase-smoke-ok' }` — pure smoke, no real validation work.
- Phase plumbing across `main.ts`, `pipeline-policy.ts`, `task.sh`, `.canon/templates/status.json`, the handoff template, AGENTS.md, multiple docs, and a 532-line dedicated test file.

## Decision

Retire `runtime_validation` as a pipeline phase. The orchestrator no longer dispatches it, no longer routes through it, no longer maintains its phase block in `status.json`. The "Validation authority boundary" rule in AGENTS.md is removed; going forward there is exactly one validation outcomes section, Codex-authored in `## Validation Outcomes` during `implement`.

Replace its predicate-gating role with an `affectedFiles` set the orchestrator pre-computes from the committed diff and injects into Codex's implement prompt. Per-task gating ("run e2e only if `src/` changed") becomes prompt-shaped logic Codex applies during implement, not orchestrator-side TypeScript predicates.

Rely on JSON's natural extra-field tolerance for in-flight tasks: a `status.json` written before this change still has a `runtime_validation` phase block; the post-retirement parser ignores it. Tasks mid-`runtime_validation` at merge time require a one-step manual recovery (documented in `done.md`).

`.codex/config.toml` is confirmed project-owned (not in `CANON_OWNED`); `.canon/README.md` gains a paragraph telling adopters this is where they widen sandbox permissions for project-specific checks during `implement`.

## Non-Goals

- **No new project-policy extension point.** The unshipped `.canon/phases.ts` loader idea is retired with this phase. Adopters extend via `.codex/config.toml` (sandbox permissions) and their project's own `package.json` scripts.
- **No rename or restructure of Codex's `## Validation Outcomes` section in `handoff.md`.** That section stays exactly as-is.
- **No changes to Stage 1 / Stage 2 code review structure.** The two-stage gate is unaffected.
- **No reopening of the validation-authority debate.** The decision is settled in `docs/decisions.md`.
- **No version bump and no CHANGELOG entry.** v1.0.0 has no external adopters yet; this folds in-place.
- **No auto-shim for tasks mid-`runtime_validation` phase.** Documented manual recovery suffices.
- **No deletion or restructure of the existing `tasks/_archive/runtime-validation-phase/` artifacts.** Only an appended pointer line.

## Acceptance Criteria

### Phase removal

- [ ] **AC-1**: `runtime_validation` is removed from `PHASE_ORDER` in `scripts/run-task/types.ts:12`. The constant is `['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review']`.
- [ ] **AC-2**: The `runRuntimeValidationPhase` import (`scripts/run-task/main.ts:9`) is removed.
- [ ] **AC-3**: The `'runtime_validation'` literal is removed from `getVerdict()`'s phase parameter type in `scripts/run-task/main.ts:129`. The parameter type becomes `'spec_review' | 'code_review'`.
- [ ] **AC-4**: The `runtimeValidation = status.phases.runtime_validation` extraction in `scripts/run-task/main.ts:151` is removed along with any downstream reads that become unused.
- [ ] **AC-5**: The `if (phase === 'runtime_validation')` early-return branch at `scripts/run-task/main.ts:660` is removed.
- [ ] **AC-6**: The `runPhase()` dispatch branch at `scripts/run-task/main.ts:1251-1252` is removed.
- [ ] **AC-7**: The `runtimeIterations*` fields (`runtimeIterations`, `runtimeIterations_current_loop`, `runtimeIterations_total`) are removed from the `TaskContext` declaration in `scripts/run-task/types.ts:101-103` and from every consumer:
  - `scripts/run-task/main.ts` `buildPipelineState` population at lines ~1446-1477 (both occurrences).
  - `scripts/run-task/context.ts:165` reads `runtimeIterations_current_loop` to drive a revision-header branch; the branch and any text it produced (e.g., "addressing runtime-check failures" headers) are removed along with the field.
  - `scripts/run-task/phases/implement.ts:15-17` destructures `runtimeIterations_current_loop` to decide whether an implement pass is a revision; the field is dropped from the destructure and the condition is reduced to `iterations_current_loop > 0`.
  - `scripts/run-task/prompts/index.ts:157, 209, 221` reads `runtimeIterations` to decide whether to emit a `## Runtime check failures to address` block and the per-iteration `runtime-check-output/.../iter-<N>` artifact path; the read sites, the block-emission branch, and the artifact path are removed entirely.
  - `tests/run-task-prompts.test.ts:125-140` includes `runtimeIterations`, `runtimeIterations_current_loop`, and `runtimeIterations_total` in the test fixture / partial-task helper; those keys are removed.
  After AC-7, `grep -n "runtimeIterations" scripts tests` returns no matches.
- [ ] **AC-8**: The `case 'runtime_validation':` branch in `checkAndRoute()` at `scripts/run-task/main.ts:1586-1602` is removed.
- [ ] **AC-9**: `scripts/run-task/phases/runtime-validation.ts` is deleted entirely.
- [ ] **AC-10**: `RUNTIME_CHECKS` (`scripts/pipeline-policy.ts:204-206`) and `type RuntimeCheck` (`scripts/pipeline-policy.ts:194-202`) are removed.
- [ ] **AC-11**: The default-block injection in `scripts/run-task/state.ts:111-112` (which adds a `runtime_validation` block to parsed status.json if missing) is removed. After retirement, the parser neither reads nor writes the block.
- [ ] **AC-11a**: `scripts/run-task/validation.ts` is purged of `runtime_validation` plumbing:
  - The `cleanRuntimeCheckName` helper and the `parseTable('Runtime Validation Outcomes', ...)` baseline/round parsing (lines ~131-153) are removed; nothing else parses that section after retirement.
  - The `runtime_validation: {}` entry in the phase-gate-config map (line ~508) is removed; `getVerdict()`'s narrowed phase parameter (AC-3) prevents reintroduction.
  - Any comment fragments referring to `runtime_validation` (e.g., line ~499 "runtime_validation has no per-task artifact file", line ~562 "Verdict required but not parseable from an artifact (runtime_validation)") are removed or rewritten so no `runtime_validation` substring survives in this file.
- [ ] **AC-11b**: `scripts/run-task/prompts/index.ts` is purged of runtime-check plumbing:
  - The `import { RUNTIME_CHECKS } from '../../pipeline-policy.js'` (line 8) and `import { sanitizeRuntimeCheckName } from '../phases/runtime-validation.js'` (line 11) are removed.
  - The implement-revision rendering branch that consumes `runtimeIterations`, `RUNTIME_CHECKS`, `sanitizeRuntimeCheckName`, and `artifactReadingHint` (lines ~157-229 — the `## Runtime check failures to address` block builder) is deleted in full. Any helper local to this block becomes dead code and is also removed.
  - The `hasRuntimeFailures` / `runtimeFailureEntries` / `runtimeFailureCount` view-model fields passed into the Mustache render of `implement-revisions.md` are removed at every render call site (initial pass, reroute, resume); the template no longer references them after AC-11c.
- [ ] **AC-11c**: `scripts/run-task/prompts/templates/implement-revisions.md` is purged of all runtime-check copy:
  - The entire `{{#hasRuntimeFailures}}` … `{{/hasRuntimeFailures}}` block (lines 17-42 — the "## Runtime check failures to address" section, including the `### Check: ...` per-failure subsection, the artifacts pointer, the captured-stderr fence, and the "Discipline" list) is deleted.
  - The `{{^hasReviewFindings}}` branch (lines 46-48) — which exists only to handle the runtime-failures-without-review-findings case — is deleted entirely. After deletion, the post-block content collapses to just the `{{#hasReviewFindings}}` "APPEND to handoff.md" instructions (current line 44) followed by the unconditional closing lines.
  - The always-rendered closing line "Spec ACs remain binding. If the review or runtime check identifies a dropped AC, restore it." (current line 50) is rewritten to "Spec ACs remain binding. If the review identifies a dropped AC, restore it." — drop the `or runtime check` phrase.
  - After AC-11c, the template's rendered output for the revision case contains no "runtime" substring (case-insensitive).
- [ ] **AC-11d**: `tests/run-task-prompts.golden.json` is regenerated to reflect the new `implement-revisions.md` rendering. Codex regenerates by running the project's standard golden-update workflow (Codex confirms the exact command in `handoff.md` — typically `npm test -- --update-snapshots` or equivalent; if no automated update exists, hand-edit the file). After regeneration, `grep -i runtime tests/run-task-prompts.golden.json` returns no matches. The unit suite passes with the regenerated golden.

### task.sh

- [ ] **AC-12**: All four `phase_order` jq defs in `scripts/task.sh` (lines 271, 355, 405, 482) have `"runtime_validation"` removed from the array.
- [ ] **AC-13**: The null-case shim `if $p == "runtime_validation" and ($doc.phases[$p]? == null) then "done"` (`scripts/task.sh:274, 358, 407`) is removed at all occurrences. With the phase removed entirely, it's dead code.
- [ ] **AC-14**: The phase validation case statement at `scripts/task.sh:302, 308-310` no longer accepts `runtime_validation`. Running `./scripts/task.sh phase <id> runtime_validation done` exits non-zero with the existing "unknown phase" error.
- [ ] **AC-15**: The verdict-allowing list at `scripts/task.sh:338-339` (and the iteration-mutation jq at line 414, 425) no longer references `runtime_validation`.
- [ ] **AC-16**: The help text at `scripts/task.sh:97, 99` no longer lists `runtime_validation`.

### Templates

- [ ] **AC-17**: The `runtime_validation` phase block is removed from `.canon/templates/status.json:34-43`.
- [ ] **AC-18**: The `runtime_validation` phase block is removed from `templates/.canon/templates/status.json` at the corresponding location. The two files remain byte-identical after the edit (canon owns both copies and `canon upgrade` syncs them).
- [ ] **AC-19**: The "Runtime Validation Outcomes" example block (`.canon/templates/handoff.md:84-121`, and the parallel block in `templates/.canon/templates/handoff.md`) is removed from both copies. The remaining template structure is unchanged. The Codex-authored `## Validation Outcomes` section is untouched.

### `affectedFiles` machinery

- [ ] **AC-20**: A new pure helper `getAffectedFiles(baseRef: string, cwd: string): string[]` is added to `scripts/run-task/git.ts`. It runs `git diff <baseRef>...HEAD --name-status -M` (reusing the existing pattern in `verifyHandoffAgainstDiffFromData()` at `scripts/run-task/validation.ts:713`), expands rename rows into both pre-image and post-image paths, returns a sorted deduped array. On any git failure or empty diff, returns `[]`.
- [ ] **AC-21**: The `getAffectedFiles()` helper is unit-tested in `tests/run-task-validation.test.ts` (new describe block; same file because the helper sits adjacent to `verifyHandoffAgainstDiffFromData()`'s test coverage). Cases: empty diff returns `[]`; a non-renamed change returns one path; a renamed file returns both pre-image and post-image paths sorted; a deletion is included; a binary-modified file is included. Use the existing `*FromData` seam pattern — accept raw `--name-status` output as input rather than requiring a real git repo.
- [ ] **AC-22**: `affectedFiles` is computed and threaded into the implement prompt builders at the call site that invokes them (`scripts/run-task/phases/implement.ts` or equivalent — Codex confirms during implementation which entry point invokes the prompt builders). The prompt-builder functions `promptImplement()`, `promptImplementRevisions()`, and `promptImplementReroute()` in `scripts/run-task/prompts/index.ts` accept an `affectedFiles: readonly string[]` parameter and pass it into their template renders. `promptImplementResume()` does not receive this parameter (resume is a slim continuation of an in-progress session; the parent invocation already supplied the context).
- [ ] **AC-23**: The implement prompt templates `scripts/run-task/prompts/templates/implement.md`, `implement-revisions.md`, and `implement-reroute.md` gain a new `## Affected files (committed diff vs base branch)` section. The two branches use the following copy verbatim (templating syntax adapts to the existing render machinery — Codex matches whatever style the surrounding templates already use):

  **Non-empty `affectedFiles`**:
  ```
  ## Affected files (committed diff vs base branch)

  The following files have committed changes on this task's branch vs `<base-branch-name>`:

  - `<path-1>`
  - `<path-2>`
  - ...

  Use this set when applying predicate-gated checks from the spec's *Validation Required* section. If a check is gated (e.g., "run e2e only if `src/` changed"), evaluate the predicate against the affected-files set; when the predicate is false, skip the check and record the skip in the Validation Outcomes table with the predicate's verbatim condition in the Notes column. When no predicate gates a check in the spec, run the check unconditionally.
  ```

  **Empty `affectedFiles`**:
  ```
  ## Affected files (committed diff vs base branch)

  No prior commits on this task's branch yet. Apply the full default check matrix from the spec's *Validation Required* section — every check runs unconditionally on this first implement pass. Predicate gating is meaningful only once the task branch has committed changes.
  ```

  Codex may make minor wording tweaks for parallelism with adjacent template sections (e.g., capitalization, punctuation) but must preserve the load-bearing instructions: (1) where to find the predicate (spec's *Validation Required*), (2) what to do when the predicate is false (skip + record), (3) what to do when no predicate applies (run unconditionally), and (4) the empty-set first-pass behavior (apply full matrix).
- [ ] **AC-24**: An integration-style unit test in `tests/run-task-validation.test.ts` (or a new prompt-builder test file if Codex judges it cleaner — confirm location in `plan.md`) asserts: (a) empty `affectedFiles` produces the "No prior commits…" branch in the rendered implement prompt; (b) a non-empty list produces a bullet list of paths under the section header.

### Migration tolerance

- [ ] **AC-25**: A new test in `tests/run-task-validation.test.ts` loads a fixture status.json containing a `runtime_validation` phase block (the pre-retirement shape) and asserts: (a) `parseStatus()` (or whichever helper resolves the next phase pointer) does not throw; (b) the resolved next phase after `implement` is `code_review`, not `runtime_validation`; (c) a write-roundtrip through the parser preserves the legacy `runtime_validation` block on the file (tolerance, not stripping — see Known Risks).

### AGENTS.md

- [ ] **AC-26**: The "Validation authority boundary" paragraph at `AGENTS.md:96` is removed. No replacement paragraph; the bullet above it (handoff sequence step 4, Codex authoring `Validation Outcomes`) carries the remaining authority statement.
- [ ] **AC-27**: The handoff sequence step 5 at `AGENTS.md:90` (orchestrator runs registered runtime checks) is deleted entirely. Subsequent steps renumber: old step 6 (Claude reads handoff + diff) becomes step 5, and so on down to step 9 (human tests) becoming step 8. Any inline references elsewhere in `AGENTS.md` matching `step [0-9]` are checked and updated.
- [ ] **AC-28**: The "Commit Ownership" line at `AGENTS.md:127` is updated from "after implement passes Codex-reported static validation and before runtime_validation/code_review" to "after implement passes Codex-reported static validation and before code_review".
- [ ] **AC-28a**: The Fast-tier and Full-tier pipeline diagrams in `AGENTS.md:43` and `AGENTS.md:53` are rewritten so the `Orchestrator runtime validation →` line is removed and Codex's implement step flows directly to Claude's code review. The surrounding bullet describing the tier is updated to drop any mention of orchestrator runtime validation. The summary paragraph below each diagram (if it mentions runtime validation) is updated to match.
- [ ] **AC-28b**: `templates/AGENTS.md` receives the same edits as AC-26, AC-27, AC-28, and AC-28a at the parallel line numbers. After edits, `diff AGENTS.md templates/AGENTS.md` shows only differences that already existed before this task (canon owns both copies; the canon block is byte-identical inside the `<!-- canon:start -->` / `<!-- canon:end -->` fence). Codex confirms byte-identity within the canon fence in `handoff.md`.

### Docs

- [ ] **AC-29**: `docs/pipeline-orchestrator.md`: all `runtime_validation` references at lines 61, 181, 225, 231, 251 are removed or rewritten. The pipeline diagram/flow text reads `implement → code_review` with no intermediate phase. The MAX_REVIEW_LOOPS list at line 181 enumerates only `spec_review` and `code_review`. The `ORCHESTRATOR_CHECK_TIMEOUT_MS` env var row at line 182 is removed entirely (no remaining consumer). The "Runtime Validation Phase" section (lines ~229-251) and any composability prose referencing runtime-validation reroutes (e.g., line 317 "runtime-validation reroutes include `## Runtime check failures to address`") are deleted; the composability prose collapses to code-review reroutes only.
- [ ] **AC-29a**: `templates/docs/pipeline-orchestrator.md` receives the same edits as AC-29 at the parallel line numbers (`templates/docs/pipeline-orchestrator.md:61, 181, 182, 225, 229-251, 317`). After edits the file's canon-managed portion is byte-identical to `docs/pipeline-orchestrator.md` (canon owns this mirror via `canon upgrade`). Codex confirms byte-identity in `handoff.md`.
- [ ] **AC-30**: `docs/architecture.md`: the auto-block phase list at line 169 and the "9. Runtime validation:" bullet at line 86 are removed. The flow text reads `implement → code_review` directly.
- [ ] **AC-31**: `docs/product-context.md`: the "near-term: project-policy extension points for real runtime_validation checks" sentence at lines 128-129 is rewritten to reflect the decision — adopters extend via `.codex/config.toml` and project scripts. No future "additional named extension slots beyond `runtime_validation`" reference remains.
- [ ] **AC-32**: `docs/BACKLOG.md` is updated in three places:
  1. The **`verdict_source` field on phase blocks** entry's *Scope* line currently reads `tracking iterative phase blocks ('spec_review', 'code_review', 'runtime_validation')` (line ~399). Edit it to `('spec_review', 'code_review')`. The rest of the entry (deferred status, sequencing, effort) stays — verdict-source tracking still applies to the two remaining iterative phases.
  2. The **deepsec / cwd-mismatch bug** entry (line ~362) currently lists `scripts/run-task/phases/runtime-validation.ts:188` as a confirmed call site. Since that file is deleted in AC-9, the runtime-validation call site is removed from the *Confirmed call sites* list. If the entry's remaining call sites still represent live bug surface, keep the entry and edit only the call-site list; if removing the runtime-validation call site leaves no live surface, retire the entire entry with a one-line `> **Retired** 2026-05-16 — superseded by retire-runtime-validation` note.
  3. The **`RuntimeCheck.cwd: 'repo_root'` test coverage gap** entry (lines ~404-407) is moot — both the type and the file it covered are being deleted. Retire the entry in place with `> **Retired** 2026-05-16 — moot after retire-runtime-validation deletes `RuntimeCheck`.`. Do not delete the entry body; the retirement note preserves the historical record while marking it inactive. The retired entry's residual `RuntimeCheck` and `runtime-validation.ts` substrings are allow-listed by AC-39 (BACKLOG is in the allow-list update there) — see AC-39.
- [ ] **AC-33**: `src/cli/index.ts` lines 29, 40, 57: all three phase-list strings in help text drop `runtime_validation`.
- [ ] **AC-34**: `.canon/README.md` gains a new section (title: "Project-specific validation checks during `implement`") explaining that adopters configure Codex's sandbox permissions in their project-owned `.codex/config.toml` (one paragraph, ~5 lines), and that real checks live in their `package.json` scripts (or equivalent) rather than canon-side policy modules. The same content lands in `templates/.canon/README.md`. Both files remain byte-identical to each other.
- [ ] **AC-34a**: `README.md` line 55's pipeline flow text `spec → spec_review → human gate → plan → implement → runtime_validation → code_review → qa → human_review` is rewritten to remove `runtime_validation`, reading `spec → spec_review → human gate → plan → implement → code_review → qa → human_review`.
- [ ] **AC-34b**: Root agent docs `CLAUDE.md` and `CODEX.md` are updated to remove all `runtime_validation` references:
  - `CLAUDE.md:101` "After implement, the orchestrator runs any registered runtime validation checks before code review." → "After implement, the orchestrator advances directly to code review." (or equivalent — preserve surrounding sentence flow).
  - `CLAUDE.md:109` Stage 1 validation-gate bullet drops the "Also read the orchestrator-authored Runtime Validation Outcomes section if present; failed runtime checks should have routed back before code review." sentence; the rest of the bullet (Codex `Validation Outcomes` table check) stays.
  - `CODEX.md:8-9` Fast-tier and Full-tier flow lines drop the `→ runtime validation →` segment so each line flows `Codex implements → Claude reviews`.
  - `CODEX.md:52` paragraph beginning "After implement, the orchestrator may run registered runtime checks…" is removed entirely (whole paragraph). The next subsection ("Iterating After Review") becomes the immediate successor of the implement subsection.
  - `CODEX.md:56` subsection lead "When Claude writes `tasks/TASK-ID/review.md` with changes requested, or when runtime validation reroutes with check failures:" is shortened to "When Claude writes `tasks/TASK-ID/review.md` with changes requested:".
  - The runtime-failures bullet at `CODEX.md:60` ("For runtime failures, read `tasks/<id>/runtime-check-output/...` before proposing a fix; fix the product/code path…") and the runtime-checks bullet at `CODEX.md:66` ("runtime checks rerun after implement closes.") are removed.
- [ ] **AC-34c**: `templates/CLAUDE.md` and `templates/CODEX.md` receive the same edits as AC-34b at the parallel line numbers. Both files have a canon-managed block bounded by `<!-- canon:start -->` / `<!-- canon:end -->`; after edits, the canon blocks in the root files and the templates are byte-identical. Codex confirms in `handoff.md`.
- [ ] **AC-34d**: Canon skill docs are updated to remove all `runtime_validation` references:
  - `.claude/skills/canon-pipeline/SKILL.md` lines 32, 35, 71, 211, 217, 219: drop `runtime_validation` from the phase-flow string, delete the paragraph describing the orchestrator-run runtime-validation phase, drop `runtime_validation` from the valid-phases list, and delete the entire `### `runtime_validation` failed — task didn't reach code_review` recovery subsection.
  - `.claude/skills/canon-status/SKILL.md:64`: delete the `runtime_validation.status = "changes_requested"` bullet.
  - `templates/.claude/skills/canon-pipeline/SKILL.md` and `templates/.claude/skills/canon-status/SKILL.md` receive the same edits at parallel line numbers; the canon-managed portion of each remains byte-identical to its root counterpart (canon owns these mirrors).

### Tests

- [ ] **AC-35**: `tests/run-task-runtime-validation.test.ts` is deleted entirely.
- [ ] **AC-36**: The `runtime_validation` block is removed from fixture status.json objects in `tests/run-task-harness.test.ts` (lines 74, 88-94), `tests/run-task-canon-snapshot.test.ts` (line 37), and `tests/run-task-counter-schema.test.ts` (line 37). The fixtures continue to load and pass their existing assertions.
- [ ] **AC-37**: The "checkPhaseGate: runtime_validation has no gate" test in `tests/run-task-validation.test.ts:782-790` is removed.
- [ ] **AC-37a**: `tests/pipeline-policy.test.ts` is updated to drop the `RUNTIME_CHECKS` import (line 10) and the `assert.deepEqual(RUNTIME_CHECKS, [...])` block (line 192) along with any setup it depends on. After AC-37a, the file contains no `RUNTIME_CHECKS` or `RuntimeCheck` substring.
- [ ] **AC-37b**: `tests/run-task-prompts.test.ts` is updated to drop the three `runtimeIterations*` keys from the test fixture/partial-task helper at lines 125-140. After AC-37b, the file contains no `runtimeIterations` substring.

### Tombstone

- [ ] **AC-38**: A pointer line is prepended to `tasks/_archive/runtime-validation-phase/done.md` (after the existing H1 title, before existing content) reading: `> **Superseded** by docs/decisions.md "Validation runs inside agent phases (supersedes orchestrator-run runtime_validation)" — 2026-05-15. The phase shipped in this task is retired by task retire-runtime-validation.`. The rest of `done.md` and the directory's other artifacts are untouched.

### Structural verification

- [ ] **AC-39**: After all changes are made, `git grep -nE 'runtime[_-]validation|RUNTIME_CHECKS|RuntimeCheck|runtimeValidation|Runtime Validation|runtimeIterations'` on the worktree returns matches **only** in the historical allow-list below. Any match outside the allow-list is an AC-39 failure. Codex documents the grep output in `handoff.md` under *Validation Outcomes* (either pasting the full output, or explicitly listing each remaining match grouped by allow-list path).

  **Allow-list (historical / archival paths the task does not edit)**:
  - `CHANGELOG.md` — historical release entries.
  - `docs/decisions.md` — the superseding entry and the supersedes reference (verified untouched in `a71e2ae`).
  - `docs/lessons-learned.md` — entries citing the prior `runtime-validation-phase` task.
  - `docs/pipeline-invocations.md` — orchestrator-appended telemetry log; never hand-edited.
  - `docs/task-quality-log.md` — historical QA entries (`runtime-validation-phase` row, `counter-schema-migration` notes).
  - `docs/BACKLOG.md` — only the *retired-in-place* entries from AC-32 (`> **Retired** 2026-05-16 — …` markers preserve the historical record). Live (non-retired) entries must be clean.
  - `tasks/_archive/**` — every archived task artifact (any subdirectory). Archived task directories are historical snapshots of completed work; they may legitimately contain `runtime_validation` / `RuntimeCheck` / `runtimeIterations` substrings because they were written when the phase existed. Concrete current matches (non-exhaustive — listed so reviewer can spot-check rather than enumerate): `tasks/_archive/runtime-validation-phase/**` (the prior shipping task), `tasks/_archive/counter-schema-migration/**` (handoff/done/plan/notes/review/spec/status), `tasks/_archive/prompt-fidelity-tests/status.json`, and `tasks/_archive/scope-review-diff/{handoff.md,status.json}`. The blanket `tasks/_archive/**` allow-list also future-proofs: any task archived between spec-write and merge inherits the rule without further spec edits.
  - `tasks/retire-runtime-validation/**` — this task's own artifacts (spec, spec-review, plan, handoff, review, done, notes).

  Paths explicitly NOT in the allow-list (and that AC-1 through AC-37b are responsible for clearing): root `AGENTS.md`, root `CLAUDE.md`, root `CODEX.md`, `templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/CODEX.md`, `README.md`, `docs/pipeline-orchestrator.md`, `docs/architecture.md`, `docs/product-context.md`, `templates/docs/pipeline-orchestrator.md`, `.claude/skills/**`, `templates/.claude/skills/**`, all `scripts/**`, `src/cli/index.ts`, `.canon/templates/**`, `templates/.canon/templates/**`, `tests/**`, and any live (non-retired) `docs/BACKLOG.md` entry.
- [ ] **AC-40**: `npm run lint`, `npm run type-check`, `npm test`, and `npm run build` all pass. The unit suite shows a non-zero test-count delta (deletions plus additions) — Codex records both numbers in `handoff.md`.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/types.ts` | Remove `runtime_validation` from `PHASE_ORDER`. Drop the `runtimeIterations`, `runtimeIterations_current_loop`, `runtimeIterations_total` fields from the `TaskContext` declaration (lines 101-103). |
| `scripts/run-task/main.ts` | Drop the phase-handler import, dispatch branch in `runPhase()`, route branch in `checkAndRoute()`, the early-return branch at line 660, `getVerdict()` type narrowing, `runtimeValidation` extraction at line 151, and all `runtimeIterations*` population in `buildPipelineState`. |
| `scripts/run-task/state.ts` | Remove the default-block injection at lines 111-112 that synthesizes a `runtime_validation` block when missing. Parser becomes pure-passthrough for legacy blocks (ignores them on read; preserves them on write). |
| `scripts/run-task/phases/runtime-validation.ts` | **Delete entirely.** |
| `scripts/run-task/phases/implement.ts` | Drop the `runtimeIterations_current_loop` destructure (lines 15-17) and reduce the revision-detection predicate to `iterations_current_loop > 0`. Also threads `affectedFiles` into the prompt builders per AC-22. |
| `scripts/run-task/context.ts` | Drop the `runtimeIterations_current_loop` read at line ~165 and the revision-header branch it gates (the runtime-validation failure-text branch). Header logic collapses to the code-review revision path. |
| `scripts/run-task/validation.ts` | Remove `cleanRuntimeCheckName`, the `parseTable('Runtime Validation Outcomes', ...)` baseline/round parsing (~lines 131-153), the `runtime_validation: {}` entry in the phase-gate-config map (~line 508), and any `runtime_validation` comment fragments (~lines 499, 562). |
| `scripts/run-task/prompts/index.ts` | Remove `RUNTIME_CHECKS` and `sanitizeRuntimeCheckName` imports (lines 8, 11). Delete the implement-revision branch that emits `## Runtime check failures to address` and the `runtime-check-output/.../iter-<N>` artifact path (~lines 157-229). Add `affectedFiles: readonly string[]` parameter to `promptImplement()`, `promptImplementRevisions()`, `promptImplementReroute()`. Pass it into renders. `promptImplementResume()` unchanged. |
| `scripts/pipeline-policy.ts` | Remove `RUNTIME_CHECKS` constant and `RuntimeCheck` type. |
| `scripts/run-task/git.ts` | Add `getAffectedFiles(baseRef, cwd)` helper exposing the path-set computation. Reuse the existing `--name-status -M` pattern from `verifyHandoffAgainstDiffFromData()`. |
| `scripts/run-task/prompts/templates/implement.md` | Add the `## Affected files (committed diff vs base branch)` section with the two-branch (empty vs non-empty) wording specified in `plan.md`. |
| `scripts/run-task/prompts/templates/implement-revisions.md` | Add the `## Affected files (committed diff vs base branch)` section (AC-23). Also delete the entire `{{#hasRuntimeFailures}}` block (lines 17-42), the `{{^hasReviewFindings}}` branch (lines 46-48), and rewrite the closing "Spec ACs remain binding" line to drop the `or runtime check` phrase (AC-11c). |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Same section addition as above. |
| `scripts/task.sh` | Drop `runtime_validation` from all four `phase_order` jq defs, the case-statement validation list, the verdict-allowing list, the iteration-mutation jq, the null-case shim, and the help text. |
| `.canon/templates/status.json` | Remove the `runtime_validation` phase block. |
| `templates/.canon/templates/status.json` | Same removal — keep byte-identical to the canonical copy. |
| `.canon/templates/handoff.md` | Remove the "Runtime Validation Outcomes" example block. |
| `templates/.canon/templates/handoff.md` | Same removal — keep byte-identical. |
| `.canon/README.md` | Add the "Project-specific validation checks during `implement`" section. |
| `templates/.canon/README.md` | Same addition — keep byte-identical. |
| `AGENTS.md` | Remove "Validation authority boundary" paragraph, remove/renumber handoff sequence step 5, update "Commit Ownership" wording, and rewrite the Fast/Full-tier flow diagrams at lines 43 and 53 to remove the orchestrator-runtime-validation arrow. |
| `templates/AGENTS.md` | Apply the same edits as `AGENTS.md`; canon-managed block remains byte-identical. |
| `CLAUDE.md` | Rewrite line 101 (orchestrator advances directly to code review) and drop the runtime-validation-outcomes sentence from the Stage 1 validation-gate bullet at line 109. |
| `templates/CLAUDE.md` | Apply the same edits as `CLAUDE.md`; canon-managed block remains byte-identical. |
| `CODEX.md` | Rewrite the Fast/Full-tier flow lines (8, 9), delete the orchestrator-runtime-checks paragraph (52), shorten the "Iterating After Review" lead (56), and remove the runtime-failures bullets (60, 66). |
| `templates/CODEX.md` | Apply the same edits as `CODEX.md`; canon-managed block remains byte-identical. |
| `README.md` | Drop `runtime_validation` from the pipeline flow text at line 55. |
| `docs/pipeline-orchestrator.md` | Remove all `runtime_validation` references (lines 61, 181, 182, 225, 229-251, 317) and update the phase flow text. |
| `templates/docs/pipeline-orchestrator.md` | Apply the same edits as `docs/pipeline-orchestrator.md`; canon-managed portion remains byte-identical. |
| `docs/architecture.md` | Remove the `9. Runtime validation` bullet and update the auto-block phase list. |
| `docs/product-context.md` | Rewrite the near-term section to drop the project-policy extension-point promise. |
| `docs/BACKLOG.md` | Edit the verdict-source entry (line 399). Edit the deepsec/cwd-mismatch entry (line 362) to remove the deleted runtime-validation call site; retire the entry if no live call sites remain. Retire the `RuntimeCheck.cwd: 'repo_root'` coverage-gap entry (lines 404-407) in place with the `> **Retired** 2026-05-16 — …` marker. |
| `.claude/skills/canon-pipeline/SKILL.md` | Remove all `runtime_validation` references at lines 32, 35, 71, 211, 217, 219 per AC-34d. |
| `.claude/skills/canon-status/SKILL.md` | Delete the `runtime_validation.status` recovery bullet at line 64. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Apply the same edits as `.claude/skills/canon-pipeline/SKILL.md`. |
| `templates/.claude/skills/canon-status/SKILL.md` | Apply the same edits as `.claude/skills/canon-status/SKILL.md`. |
| `src/cli/index.ts` | Remove `runtime_validation` from the three phase-list strings in help text. |
| `tasks/_archive/runtime-validation-phase/done.md` | Prepend the supersession pointer line. |
| `tests/run-task-runtime-validation.test.ts` | **Delete entirely.** |
| `tests/pipeline-policy.test.ts` | Drop the `RUNTIME_CHECKS` import (line 10) and the `assert.deepEqual(RUNTIME_CHECKS, [...])` block (line 192). |
| `tests/run-task-prompts.test.ts` | Drop the three `runtimeIterations*` keys from the test fixture / partial-task helper at lines 125-140. |
| `tests/run-task-prompts.golden.json` | Regenerate after the `implement-revisions.md` template edits land (AC-11d). After regeneration, the file contains no "runtime" substring (case-insensitive). |
| `tests/run-task-harness.test.ts` | Drop `runtime_validation` from status.json fixtures. |
| `tests/run-task-canon-snapshot.test.ts` | Drop `runtime_validation` from fixture. |
| `tests/run-task-counter-schema.test.ts` | Drop `runtime_validation` from fixture. |
| `tests/run-task-validation.test.ts` | Remove the "runtime_validation has no gate" test. Add the `getAffectedFiles()` test suite (AC-21). Add the implement-prompt rendering test (AC-24) if scoped here per `plan.md`. Add the migration-tolerance parser test (AC-25). |

### Interaction Dependencies

- **Worktree-isolated self-modification**: this task modifies the orchestrator that runs it. Per `CLAUDE.md` "Modifying canon's own harness or policy," the supervising orchestrator runs from the main checkout while edits land in the worktree, so the pipeline running this task is shielded from its own edits mid-run. The retirement applies to *future* tasks after this PR merges.
- **In-flight task migration**: tasks created before this merges have a `runtime_validation` phase block in their `status.json`. Post-retirement parsers ignore the block (extra field tolerance). Tasks whose top-level `status` pointer is currently `runtime_validation` at merge time require manual recovery: `canon task phase <id> code_review pending` then re-run. This is documented in `done.md`.
- **Codex sandbox permissions**: the new prompt-shaped predicate gating relies on Codex being able to run project-specific checks during `implement`. For canon-ai itself, the relevant checks (`npm run lint`, `npm run type-check`, `npm test`) already work in Codex's default sandbox. Adopters with checks needing wider permissions (e.g., network access for staging smoke, Playwright with browser binaries) update `.codex/config.toml` — the README addition documents this entry point.

### Data Model Changes

The `runtime_validation` phase block is removed from `.canon/templates/status.json`. New tasks scaffolded after merge do not have this block. Legacy tasks created before merge retain the block in their existing `status.json`; the parser ignores it on read and preserves it on write (AC-25's roundtrip assertion enforces preservation).

`TaskContext` (the prompt-builder input type) drops its `runtimeIterations*` fields if declared there. Confirm during implement.

`type RuntimeCheck` and `RUNTIME_CHECKS` are removed from `scripts/pipeline-policy.ts`. The `check.when?.(status, affectedFiles)` predicate shape is no longer a canon-side type — adopters who want predicate gating apply it in their Codex prompt instructions (informed by the spec's *Validation Required* section).

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — the full suite. Expect a net test-count change (deletion of `run-task-runtime-validation.test.ts`, removal of the "no gate" test) offset by additions (`getAffectedFiles()` suite, prompt-rendering test, migration-tolerance test). Codex records both numbers in `handoff.md`.
- [x] `npm run build` — tsup build of the published `canon-ai` package surface. Required because this task edits `src/cli/index.ts` (help text) and the build emits the CLI bundle adopters install.
- [x] Custom: `git grep -nE 'runtime[_-]validation|RUNTIME_CHECKS|RuntimeCheck|runtimeValidation|Runtime Validation|runtimeIterations'` returns matches only in the allow-list paths from AC-39. Codex pastes the full grep output (or "no matches outside allow-list") in `handoff.md`.
- [ ] E2E — N/A (canon-ai has no UI; `docs/architecture.md` Validation section lists this as N/A).

## Docs Impact

- **`AGENTS.md`** + **`templates/AGENTS.md`** — handoff sequence, validation authority paragraph, commit-ownership line, and Fast/Full-tier flow diagrams all rewritten (AC-26, AC-27, AC-28, AC-28a, AC-28b).
- **`CLAUDE.md`** + **`templates/CLAUDE.md`** — line 101 (orchestrator-advances-to-code-review) rewritten; Stage 1 runtime-validation-outcomes sentence at line 109 removed (AC-34b, AC-34c).
- **`CODEX.md`** + **`templates/CODEX.md`** — Fast/Full-tier flow lines (8, 9), orchestrator-runtime-checks paragraph (52), iterating-after-review subsection lead (56), and runtime-failures bullets (60, 66) all updated or removed (AC-34b, AC-34c).
- **`README.md`** — pipeline flow text at line 55 (AC-34a).
- **`docs/pipeline-orchestrator.md`** + **`templates/docs/pipeline-orchestrator.md`** — phase flow, MAX_REVIEW_LOOPS scope, `ORCHESTRATOR_CHECK_TIMEOUT_MS` row, Runtime Validation Phase section, and post-review composability prose all updated (AC-29, AC-29a).
- **`docs/architecture.md`** — runtime validation bullet in the lifecycle, auto-block phase list (AC-30).
- **`docs/product-context.md`** — near-term roadmap (extension-point promise retracted) (AC-31).
- **`docs/BACKLOG.md`** — verdict-source entry edited; deepsec/cwd-mismatch entry edited or retired; `RuntimeCheck.cwd: 'repo_root'` coverage-gap entry retired in place (AC-32).
- **`.canon/README.md`** + **`templates/.canon/README.md`** — new section on `.codex/config.toml` ownership (AC-34).
- **`.claude/skills/canon-pipeline/SKILL.md`**, **`.claude/skills/canon-status/SKILL.md`**, and their `templates/` mirrors — phase-flow string, recovery subsection, status-pointer bullet all updated (AC-34d).
- **`docs/decisions.md`** — already contains the superseding decision (committed `a71e2ae`); no change needed (the supersedes-reference text remains and is allow-listed by AC-39).
- **`docs/codebase-map.md`** — verified no `runtime_validation` references via grep; no change.
- **Historical / archival paths** (no edits — allow-listed by AC-39): `CHANGELOG.md`, `docs/lessons-learned.md`, `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `tasks/_archive/**` (any archived task directory — currently includes `runtime-validation-phase`, `counter-schema-migration`, `prompt-fidelity-tests`, `scope-review-diff`), and `tasks/retire-runtime-validation/**`.

QA phase confirms protected docs are consistent before writing `done.md`.

## Known Risks

- **Declared/Executable drift trap.** Per `docs/decisions.md` "Declared Canon vs Executable Canon," changes to canon's harness must keep declared rules (AGENTS.md, CLAUDE.md, CODEX.md) and executable behavior (scripts, templates) in lockstep. AC-39's grep is the structural check that prevents partial removal. **Specific risk**: removing the phase from `PHASE_ORDER` but leaving the dispatch branch in `runPhase()` produces a silent-skip footgun (per `docs/patterns.md` "Adding a phase that updates only some switch statements"). Symmetric risk on removal — Codex must edit all three switches (`PHASE_ORDER`, `runPhase()`, `checkAndRoute()`) atomically.
- **`TaskContext` field cascade.** `runtimeIterations*` is populated in `buildPipelineState` and likely declared in `TaskContext` (or wherever the prompt-builder input type lives) — Codex must trace the type, drop the fields at declaration and all population sites, and confirm no template still references `{{runtimeIterations}}` or similar. A leftover template reference would render empty without throwing — silent regression of prompt content.
- **Renumbering AGENTS.md handoff steps.** Step 5 is being removed. Steps 6-9 become 5-8. Inline references elsewhere in the file (e.g., "see step 7") need updating. AC-27 calls this out explicitly.
- **`templates/` mirror divergence.** Many root files have `templates/` mirrors that must change in lockstep: `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/pipeline-orchestrator.md`, `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-status/SKILL.md`, `.canon/templates/status.json`, `.canon/templates/handoff.md`, and `.canon/README.md`. Some (e.g., `AGENTS.md`, `CLAUDE.md`, `CODEX.md`) carry a `<!-- canon:start --> ... <!-- canon:end -->` fence and byte-identity is required only inside that fence — the section below `canon:end` is project-specific and may differ. Others (the `.canon/templates/**` files, the SKILL.md files) are byte-identical end-to-end. Codex's post-edit check uses `diff <root> <template>` for byte-identical files and `diff <(sed -n '/canon:start/,/canon:end/p' <root>) <(sed -n '/canon:start/,/canon:end/p' <template>)` for fence-scoped files. Either way, the diff must produce no output for the canon-managed region.
- **State-loading silent stripping.** Removing `state.ts:111-112` (the default-block injection) is correct, but the parser's write-path must not silently *strip* unknown fields when writing status.json back. If a strict-shape serializer erases the legacy `runtime_validation` block on first write, the tolerance posture degrades. AC-25's write-roundtrip assertion catches this. If the parser strips, Codex flags it in handoff and we re-grill (likely switching to a one-shot active migration).
- **`affectedFiles` empty-set on first implement.** On the first implement invocation, the task branch has no commits vs base — `affectedFiles` is `[]`. The prompt's empty-set branch tells Codex to apply the full default check matrix. If a future spec's *Validation Required* relies on predicate gating *on the first pass*, this design fails for that case. Acceptable for now — predicate gating's main use case is "skip the expensive e2e suite on doc-only revisions," which only matters after at least one round.
- **`task.sh` null-case shim removal.** AC-13 removes the forward-tolerance shim that treated missing `runtime_validation` blocks as `done`. After AC-13, a legacy task that *somehow* still has the block but is loaded by post-retirement `task.sh` will see the block ignored (the case statement no longer accepts the phase name). Worth confirming Codex doesn't accidentally leave the shim in place while the case-statement is removed (the inverse — case removed, shim kept — would let `task.sh` silently no-op on `runtime_validation` invocations, masking errors).
- **Delicate-task review burden.** This task is `delicate: true` because it touches `PHASE_ORDER` + dispatch switches + status.json schema (per canon-ai's `delicate` domain list in `docs/product-context.md`). Per `CLAUDE.md` "Delicate-task review must audit cross-cutting guards at every mutation entry point," the reviewer confirms that every site reading or writing the `runtime_validation` block is either removed or made tolerant. AC-39's grep is the structural backstop, but reviewer reads the diff carefully — silent regressions in this surface corrupt every task that runs after merge.

## Human Test Plan

1. Pull the merged change to your local `dev`. Confirm `tasks/_archive/runtime-validation-phase/done.md` shows the supersession pointer near the top.
2. Create a fresh test task: `canon task new test-retirement-smoke "Smoke test after runtime_validation retirement"`. Inspect the scaffolded `tasks/test-retirement-smoke/status.json` — confirm there is **no** `runtime_validation` phase block. The phase order in the file goes `implement → code_review` directly.
3. Open `tasks/test-retirement-smoke/spec.md` and write a one-line spec (any trivial change). Mark the spec phase done in `status.json`. Run `canon run test-retirement-smoke --step --expect plan` and confirm the orchestrator dispatches Claude to write a plan — no errors about `runtime_validation`.
4. Walk the test task through to `implement`. Confirm the implement prompt (visible in the Codex transcript or the agent invocation log) contains the new `## Affected files (committed diff vs base branch)` section with the "No prior commits…" wording.
5. Once `implement` finishes and auto-commit lands, force a re-implement by setting the code-review verdict to `changes_requested` (or wait for a real review iteration). On the second implement pass, confirm the implement prompt's `## Affected files` section now lists the path Codex modified in the prior pass.
6. Run `./scripts/task.sh phase test-retirement-smoke runtime_validation done` — expect a non-zero exit with an "unknown phase" error.
7. If you had an in-flight task at merge time whose `status.json` still has a `runtime_validation` block: confirm `canon run <id>` proceeds past `implement` directly to `code_review` without complaining about the legacy block. If the task was mid-`runtime_validation` at merge, run `canon task phase <id> code_review pending` then `canon run <id>` — task continues.
8. Open `.canon/README.md` and confirm the new "Project-specific validation checks during `implement`" section is present and readable. Same for `templates/.canon/README.md`.
9. Run `git grep -nE 'runtime[_-]validation|RUNTIME_CHECKS|RuntimeCheck|runtimeValidation|Runtime Validation|runtimeIterations'` from the repo root. Confirm every match is in AC-39's allow-list: `CHANGELOG.md`, `docs/decisions.md`, `docs/lessons-learned.md`, `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/BACKLOG.md` (only inside the *retired-in-place* entries from AC-32), `tasks/_archive/**` (any archived task directory), and `tasks/retire-runtime-validation/**`. Any match outside that set is a regression.

Expected: every step passes without manual workaround beyond the one documented in step 7's mid-phase recovery.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full-tier task; plan written by pipeline Claude after Codex spec review)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names) — partial exception: file/path names appear because canon-ai's "product owner" IS an engineer testing pipeline behavior, and the test plan must verify file-level outcomes. Intentional for canon-on-canon tasks.
- [x] Validation Required has at least one entry checked (or "None" with justification)
