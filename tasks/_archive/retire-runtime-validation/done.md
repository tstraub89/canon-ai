# Done: retire-runtime-validation — Retire runtime_validation pipeline phase

## What Changed

The `runtime_validation` orchestrator phase is gone. The pipeline now flows directly from `implement` → `code_review` with no intermediate orchestrator-run check step.

In its place, every implement prompt now receives an `## Affected files (committed diff vs base branch)` section listing which files differ from the base branch on this task's branch. Codex uses that list to apply predicate-gated checks from the spec's *Validation Required* section — skipping expensive checks (e.g., E2E) when the predicate condition (e.g., `src/` changed) isn't met, and recording the skip in the Validation Outcomes table. On the first implement pass (no prior commits), Codex runs the full check matrix.

The unshipped `.canon/phases.ts` project-policy extension point is also retired. Adopters extend validation by widening Codex's sandbox permissions in their project-owned `.codex/config.toml` and running project scripts — not through canon-side policy modules. `.canon/README.md` now documents this entry point.

## Files Changed

Over 50 files across scripts, templates, tests, and docs. Key areas:

| Area | What happened |
|---|---|
| `scripts/run-task/types.ts` | `runtime_validation` removed from `PHASE_ORDER`; `runtimeIterations*` fields dropped from `TaskContext` |
| `scripts/run-task/main.ts` | Phase dispatch, routing branch, verdict reads, and `runtimeIterations*` population all removed |
| `scripts/run-task/phases/runtime-validation.ts` | **Deleted** |
| `scripts/pipeline-policy.ts` | `RuntimeCheck` type and `RUNTIME_CHECKS` constant removed |
| `scripts/run-task/git.ts` | New `getAffectedFiles()` helper (and `parseNameStatusOutput()` seam) added |
| `scripts/run-task/prompts/index.ts` | Runtime-failure plumbing removed; `affectedFiles` parameter added to the three implement prompt builders |
| `scripts/run-task/prompts/templates/implement*.md` | `## Affected files` section added to implement, revisions, and reroute templates; runtime-failures block removed from revisions template |
| `scripts/task.sh` | Phase removed from phase order, verdict handling, iteration mutation, null-case shim, and help text |
| `.canon/templates/status.json` + mirror | `runtime_validation` phase block removed from new-task scaffold |
| `.canon/templates/handoff.md` + mirror | "Runtime Validation Outcomes" example block removed |
| `.canon/README.md` + mirror | New section on project-specific validation via `.codex/config.toml` |
| `AGENTS.md`, `CLAUDE.md`, `CODEX.md` + mirrors | Phase removed from pipeline diagrams, handoff sequence, validation-authority paragraph, commit-ownership text, and review instructions |
| `README.md` | Pipeline flow text updated |
| `docs/pipeline-orchestrator.md` + mirror | Phase docs, env var row, and registry docs removed; routing prose collapsed to code-review reroutes only |
| `docs/architecture.md`, `docs/product-context.md`, `docs/BACKLOG.md` | Phase references removed or retired in place |
| `.claude/skills/canon-pipeline/SKILL.md`, `canon-status/SKILL.md` + mirrors | Phase flow, recovery subsection, and status-pointer bullet removed |
| `src/cli/index.ts` | Phase removed from CLI help strings |
| `tasks/_archive/runtime-validation-phase/done.md` | Supersession pointer prepended |
| `tests/run-task-runtime-validation.test.ts` | **Deleted** (532-line dedicated suite) |
| `tests/run-task-validation.test.ts` | `getAffectedFiles()` tests added; migration-tolerance parser test added; "runtime_validation has no gate" test removed |
| `tests/run-task-prompts.test.ts` | `runtimeIterations*` fixture fields removed; affected-files prompt assertions added |
| `tests/run-task-prompts.golden.json` | Regenerated — no "runtime" substring survives |
| Other test fixtures | `runtime_validation` blocks removed from four fixture files |

## How to Test

Follow the [Human Test Plan](spec.md#human-test-plan) in the spec. Key steps:

1. **Check the archive pointer**: open `tasks/_archive/runtime-validation-phase/done.md` and confirm the supersession pointer appears near the top.
2. **Scaffold a fresh task**: `canon task new test-retirement-smoke "Smoke test"`. Open its `status.json` — confirm **no** `runtime_validation` block, and that the phase order goes `implement → code_review` directly.
3. **Run the pipeline**: take that test task through implement. Verify the Codex implement prompt contains the new `## Affected files (committed diff vs base branch)` section with the "No prior commits…" wording on the first pass, and a file list on subsequent passes.
4. **Verify task.sh rejects the retired phase**: `./scripts/task.sh phase <id> runtime_validation done` should exit non-zero with "unknown phase".
5. **Legacy in-flight task** (if one exists): confirm `canon run <id>` proceeds past `implement` directly to `code_review` without error. If the task's `status` pointer is currently `runtime_validation`, run `canon task phase <id> code_review pending` first, then `canon run <id>`.
6. **Structural grep**: from repo root, run `git grep -nE 'runtime[_-]validation|RUNTIME_CHECKS|RuntimeCheck|runtimeValidation|Runtime Validation|runtimeIterations'`. Every match must be in the allow-list: `CHANGELOG.md`, `docs/decisions.md`, `docs/lessons-learned.md`, `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/BACKLOG.md` (retired-in-place entries only), `tasks/_archive/**`, `tasks/retire-runtime-validation/**`.

## Test Results

All validation checks passed:

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 232 tests (231 pass, 1 skipped); baseline was 237 (net −5: large runtime suite deleted, new `getAffectedFiles` / migration-tolerance / affected-files prompt tests added) |
| `npm run build` | Pass — `dist/cli/index.js` built cleanly |
| Golden regeneration | Pass — `grep -i runtime tests/run-task-prompts.golden.json` returns no matches |
| Mirror diffs | Pass — all canon-managed sections are byte-identical to their `templates/` counterparts |
| `task.sh` rejection | Pass — `runtime_validation` exits non-zero with "unknown phase" |
| Structural grep (AC-39) | Pass — matches only in allow-listed paths |
| E2E | N/A — canon-ai has no UI |

## Decisions Made

- **No `.canon/phases.ts` extension point.** The idea was to let adopters register runtime checks via canon-side policy modules. This is retired along with the phase. Adopters extend validation by adding checks to their own `package.json` scripts and widening Codex's sandbox in `.codex/config.toml`. The extension point was never shipped, so no migration is needed.
- **Legacy `status.json` tolerance, not active migration.** Tasks created before this merges retain a `runtime_validation` block in their `status.json`. The parser ignores it on read (the phase is gone from `PHASE_ORDER`) and preserves it on write (unknown fields pass through). No one-shot migration runs; the block quietly becomes inert.
- **Affected-files is empty on first implement.** On the very first implement pass (no commits yet), `getAffectedFiles()` returns `[]`, and the prompt tells Codex to run the full check matrix. Predicate gating is only meaningful on revision passes where prior commits exist.

## Mid-Phase Recovery (for in-flight tasks at merge time)

If any task's `status` pointer is `runtime_validation` when this merges:

```bash
canon task phase <task-id> code_review pending
canon run <task-id>
```

The task resumes from `code_review`. The stale `runtime_validation` block in `status.json` is preserved but ignored.

## Open Questions

None. The decisions.md entry ("Validation runs inside agent phases") is the settled authority.

---

## Proposed Changelog

**No changelog entry.** The spec explicitly excludes one: v1.0.0 has no external adopters yet; this task folds in-place per the project's pre-distribution policy (see `docs/decisions.md`). No version bump.

When canon-ai reaches first adoption and releases, the human may wish to note in the 1.0.0 block:

- **Removed**: `runtime_validation` orchestrator phase — implement now routes directly to `code_review`.
- **Added**: Affected-files section in implement prompts — Codex receives the committed diff path set for predicate-gated validation checks specified in the spec's *Validation Required* section.
