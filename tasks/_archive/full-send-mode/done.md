# QA Summary: full-send-mode

> **Full-send mode: spec to draft PR with no human interrupts**
> QA by: Claude | 2026-05-21

## What Changed

Canon now supports a **full-send mode** that eliminates both human interrupts in the standard pipeline — the spec gate and the pre-PR interrupt — and automatically opens a draft PR when QA passes.

**New behavior:**

- `canon run --full-send <id>` sets `full_send: true` and clears `human_spec_gate` before any phase runs, then runs the normal pipeline (spec_review → plan → implement → code_review → qa) and, on clean QA completion, runs the existing `--pr` flow inline and prints a completion banner with the draft PR URL.
- `canon run --force` is a new flag required alongside `--full-send` when the task has `delicate: true`. The combination is allowed (canon's upgraded-model review chains still run), but requires explicit acknowledgment. Without `--force`, the run exits non-zero before any phase with an informative message.
- `canon run --reroute` on a full-send task now clears `full_send: false` automatically and prints a `⚠ full_send cleared.` warning. Combining `--reroute` and `--full-send` in one invocation is rejected by `parseArgs`.
- **Retroactive enable**: `canon run --full-send` on a task already mid-pipeline (e.g., paused at the spec gate) rewrites the flag and resumes from the current phase.
- **`/canon-spec` skill** detects full-send intent from the `--full-send` flag or the natural-language phrase "full send"/"full-send" in `$ARGUMENTS`. When detected it prints an acknowledgment line before grilling, writes the spec with a full-send banner near the top, and invokes `canon run --full-send <id>` instead of stopping at the spec gate. Delicate tasks get a high-commitment acknowledgment block and `--force` is appended automatically.

**Supporting changes:**

- `commitHumanReviewFiles` refactored to accept an explicit `createPR: boolean` parameter so the full-send tail can force PR creation without setting `cliArgs.pr`.
- The spec_review prompt injects a conditional "full-send rigor" paragraph when `status.full_send === true`, raising Codex's review bar on the spec the human didn't read.
- Status template (`full_send: false` default) updated in both `.canon/templates/status.json` and `templates/.canon/templates/status.json` in lockstep.
- `AGENTS.md`, `CLAUDE.md`, `CODEX.md` and their six `templates/` mirrors all document full-send mode, operator-Claude NL detection, and Codex spec-review rigor expectations.
- `docs/decisions.md` records the design decision and the rejected `manual_canon` framing.

## Files Changed

28 files across implementation, tests, docs, and dist bundles:

**Core logic:** `scripts/run-task/main.ts`, `scripts/run-task/types.ts`, `scripts/run-task/cli.ts`, `scripts/run-task/phases/spec-review.ts`, `scripts/run-task/prompts/index.ts`, `scripts/run-task/prompts/templates/spec-review.md`, `scripts/run-task/metrics.ts`, `src/cli/index.ts`, `src/cli/deps.ts`

**Templates/config:** `.canon/templates/status.json`, `templates/.canon/templates/status.json`

**Skills:** `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md`

**Docs:** `AGENTS.md`, `templates/AGENTS.md`, `CLAUDE.md`, `templates/CLAUDE.md`, `CODEX.md`, `templates/CODEX.md`, `docs/decisions.md`, `CHANGELOG.md`

**Tests:** `tests/run-task-cli.test.ts` (new), `tests/run-task-safety.test.ts`, `tests/run-task-prompts.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-canon-snapshot.test.ts`, `tests/run-task-counter-schema.test.ts`

**Dist:** `dist/cli/index.js`, `dist/scripts/run-task.js`

## How to Test

Use the Human Test Plan from spec.md (8 steps). Key paths:

1. **Default stays unchanged**: `canon task new <id> "Title"` produces `full_send: false`, `human_spec_gate: true`. No new flag on `canon task new`.
2. **End-to-end full-send**: `canon task new try-full-send "Try"` → write a trivial spec → `canon run --full-send try-full-send`. Watch for spec gate skip, pipeline running through to QA, and the `✅ FULL-SEND COMPLETE — draft PR open.` banner. Confirm a draft PR appears on GitHub.
3. **`/canon-spec` conversational path**: `/canon-spec full send this: <description>`. Verify the acknowledgment line prints, spec gets the full-send banner, pipeline runs to draft PR.
4. **Retroactive enable**: run a task through to the spec gate (normal mode), then `canon run --full-send <id>`. Gate should clear and pipeline should continue through to draft PR.
5. **Reroute clears full-send**: `canon run --reroute <id>` on a full-send task → status shows `full_send: false` + `⚠ full_send cleared.` message.
6. **Delicate guard**: mark a task `delicate: true` in status.json, then `canon run --full-send <id>` without `--force` → should die with the AC-3 message. Repeat with `--force` → should proceed.
7. **Mutual exclusion**: `canon run --reroute --full-send <id>` → should die immediately.
8. **Retry after --pr failure**: simulate failure (e.g., revoke gh auth), run through QA, confirm `human_review` stays pending. Restore auth, re-run `canon run <id>`, confirm full-send tail retries and opens the PR.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (370 pass, 1 skipped — pre-existing sandboxed `.git`-write guard) |
| E2E tests | N/A |
| Build | Pass |

**Three code-review iterations plus one reroute**: Round 1 found three partially-met ACs (AC-8(e) missing the prescribed delicate/full-send acknowledgment text, AC-9 missing the spec banner write instruction in the skill, AC-12 missing several sub-tests). All three were fixed in iteration 2. Round 2 approved. Round 3 (via Codex's async PR-level review after the reroute) caught the AC-14 `some` → `every` bundle-gate bug; fixed in iteration 4.

**Second spec amendment (AC-14 — bundle `every` semantics)**: After the reroute fix landed (iteration 3), Codex's asynchronous PR-level review on commit `717e5d9` caught two P1 correctness bugs: both `scripts/run-task/main.ts:2162` (full-tier) and `scripts/run-task/phases/spec-review.ts:28` (fast-tier) used `statuses.some(t => t.full_send)` to decide whether to skip the spec gate. A single full-send task in a mixed bundle silently disabled the spec gate for every task in that bundle — including tasks the human hadn't opted into full-send. Both sites were changed to `every(t => t.full_send)`, four bundle-matrix tests added (full-tier mixed, full-tier all-full-send, fast-tier mixed, fast-tier all-full-send), and the `AGENTS.md` bundle-semantics sentence updated. Final test count: 374 passing.

**Post-QA reroute (AC-13 amendment)**: After code review passed, QA inspection surfaced a test pollution bug — new tests in `tests/run-task-safety.test.ts` were appending 11 `task-a | implement` entries to `docs/pipeline-invocations.md` in the real worktree. Root cause: `scripts/run-task/metrics.ts` computed `METRICS_FILE` as a module-load-time constant using `REPO_ROOT`; spawned child processes in tests inherited the real repo root and wrote telemetry there. Fix: replaced the constant with a `getMetricsFile()` function honoring a `CANON_METRICS_FILE_OVERRIDE` env var; spawned test processes now set that var to a temp path; a suite-end docs cleanliness assert in `tests/task-cli.test.ts` prevents recurrence. Polluted entries reverted from `docs/pipeline-invocations.md` before PR. This spawned AC-13 (test isolation against real telemetry) as a spec amendment and a reroute + iteration 3 to address it.

**Spec took 4 iterations with 1 auto-block**: The spec loop hit the 3-iteration cap before Codex approved it as `approved_with_nits`. The primary driver was `reportOrCreatePR` returning `void` — the spec's original design assumed it could pipe URLs through the return channel, which was unimplementable. Spec revisions added AC-4b (URL capture via `inspectCompleteState`) and AC-4c (single-branch constraint). No pipeline errors after spec stabilized.

## Decisions Made

- **URL capture reuses `inspectCompleteState`, not a refactored `reportOrCreatePR`**: `reportOrCreatePR` returns void. Rather than changing its signature (and all callers), the full-send tail calls `inspectCompleteState` after PR creation to retrieve the URL — the same path `printCompleteStateBanner` uses today. A defensive warn+placeholder path handles the rare case where the PR can't be observed immediately after creation.
- **Single-branch constraint for full-send bundles**: `commitHumanReviewFiles` already operates on one `cwd`/branch per call. Multi-branch full-send would require generalizing the `--pr` flow to open one PR per branch, which is its own task. Full-send rejects multi-branch bundles up front with an actionable message.
- **`--force` as a first-class CLI flag (not just a status.json edit)**: `parseArgs` previously died on `--force` with "Unknown option". Adding it as a real flag makes the delicate+full-send combination self-documenting and lets the skill auto-thread it.
- **`--reroute` clears `full_send` automatically**: reroutes signal that the prior result needed correction; auto-clearing prevents the next run from immediately re-opening a PR on the corrected implementation without the human reviewing it first.

## Open Questions

None. All ACs met, all validation checks pass, Human Test Plan satisfiable.

---

## Proposed Changelog

The 1.4.0 entry is already written in `CHANGELOG.md` by the implementation phase. Reproduced here for review:

```
### Added
- **Full-send mode for "spec to draft PR with no human interrupts."** `canon run --full-send <id>`
  now clears the spec gate, runs the normal pipeline, and opens a draft PR after QA without
  waiting for a human to re-invoke `--pr`. The conversational `/canon-spec` skill detects
  full-send intent from either `--full-send` or natural-language "full send" / "full-send"
  phrasing and carries the same mode through to the pipeline. Delicate tasks require `--force`
  to acknowledge the higher-commitment combination, and `--reroute` clears the mode so a retried
  run starts from a fresh human review decision.

### Changed
- **`CLAUDE.md` no longer claims `base_branch` is "typically `dev`".** Replaced with
  "auto-detected from the current git checkout — `main` for one-off work or whatever
  release-accumulation branch your project uses."
```

**Proposed version bump: 1.3.2 → 1.4.0 (minor).** New user-facing mode with two new CLI flags (`--full-send`, `--force`), new skill behavior, and a new default field in every task's status.json. Additive and backwards-compatible (absent `full_send` field is equivalent to `false`). Both bullets pass the "would an adopter notice this?" test.
