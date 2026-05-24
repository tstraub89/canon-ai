# QA Summary: scope-pr-auto-commit-to-affected-files-v2

> Phase: QA | Agent: Claude | Date: 2026-05-22

## What Changed

`canon run --pr` previously auto-committed any dirty file matching `tasks/<id>/**` OR any file in `PIPELINE_SHARED_DOCS` — which included all six managed docs (`docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/architecture.md`, `docs/product-context.md`, `docs/pipeline-orchestrator.md`) unconditionally. This over-permissive allow-list was the enabling surface for cross-pipeline contamination Mode 2: when canon's worktree-to-worktree managed-doc sync leaks Task A's edits into Task B's worktree, Task B's `--pr` would silently include Task A's managed-doc content in the wrong PR and branch. This produced the gallery_wall incident where a foreign doc reference to a file that only existed on the sibling branch slipped into the PR and was caught by `docs-refs-check` CI — not by canon itself.

The fix tightens the `--pr` auto-commit allow-list from `{tasks/<id>/**, PIPELINE_SHARED_DOCS}` to `{tasks/<id>/**, PIPELINE_TELEMETRY_FILES, (PIPELINE_MANAGED_DOCS ∩ spec's Affected Files)}`:

- **Telemetry files** (`lessons-learned.md`, `task-quality-log.md`, `pipeline-invocations.md`) remain always-allowed. v2's allow-list is a strict tightening of today's behavior — telemetry was allowed before, still allowed now. NOTE: telemetry IS a contamination vector (appended rows can reference task-specific content that propagates via worktree sync), but closing that requires changing where appends land — deferred to the sync rewrite BACKLOG entry. See "Open Questions" below.
- **Managed docs** (`architecture.md`, `codebase-map.md`, `decisions.md`, `patterns.md`, `pipeline-orchestrator.md`, `product-context.md`) are no longer auto-allowed. A managed doc is committable at `--pr` time only if it appears in the spec's `### Affected Files` table.
- **Source/test/template files** listed in Affected Files are intentionally **not** widened into the human_review allow-list. Those must be committed during the implement phase. The Affected Files carve-out is strictly `PIPELINE_MANAGED_DOCS`-intersected; it cannot smuggle late source file edits into the PR.
- When a dirty file falls outside the allow-list, the existing hard-die fires with an **updated actionable message** that names the allow-list shape, the managed-doc remedy (add to Affected Files), the source-file remedy (investigate why it's dirty — cross-pipeline sync is one cause), and the revert command (`git checkout HEAD -- <path>`).
- When a managed doc IS in the allow-list and gets committed, a one-line **advisory warning** fires before the stage loop inviting the operator to `git diff HEAD -- <path>` before `--ship`. This is the guardrail for the residual same-file overlap case (both tasks legitimately list the same managed doc — path-level filter can't distinguish the content ownership).

New `parseAffectedFilesFromSpec(taskId)` function in `validation.ts` reads the spec's `## Design → ### Affected Files` H3 table using the existing `extractSectionBodies` + `parseTableH3` + `parseHandoffPathCell` primitives. Missing spec, missing section, or missing H3 all return empty gracefully. Malformed rows emit a task-ID-prefixed warning at commit time and are excluded from the allow-list.

Both spec templates (`.canon/templates/spec.md` and `templates/.canon/templates/spec.md`) gained a one-line note under `### Affected Files` reminding spec authors to list managed docs they expect QA to touch, and that telemetry files are auto-committed.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Added exported `parseAffectedFilesFromSpec(taskId)` |
| `scripts/run-task/main.ts` | Tightened `humanReviewAllowedPath`, `buildHumanReviewStagePaths`, and `commitHumanReviewFiles`; updated die message; added advisory warning |
| `tests/run-task-validation.test.ts` | New parser test block — 6 cases covering valid parse, missing spec, missing sections, malformed, and format variants |
| `tests/run-task-safety.test.ts` | New allow-list safety test block — 7 cases covering all allow-list paths and edge cases |
| `.canon/templates/spec.md` | Added managed-doc note under `### Affected Files` |
| `templates/.canon/templates/spec.md` | Same edit (parallel-edit per project convention) |
| `docs/pipeline-orchestrator.md` | Updated `## Auto-Branch + Auto-Commit` section with new allow-list shape, die behavior, non-managed exclusion, and advisory warning |

## How to Test

**Automated**: Run `npm test` — 387 tests pass, 1 skipped. New test blocks cover:
- `parseAffectedFilesFromSpec`: valid parse (3 rows → 3 paths), missing spec file → empty, no Design section → empty, no Affected Files H3 → empty, malformed placeholder → malformed array, backtick and markdown-link formats both extract correctly.
- `commitHumanReviewFiles` allow-list: out-of-scope managed doc dies with new message, in-scope managed doc commits + advisory fires, telemetry commits without advisory, bundle unions both tasks' affected managed docs, malformed row warning with task ID prefix, non-managed Affected Files entry (source file) dies, mixed managed/non-managed per-path filtering.

**Manual (from spec Human Test Plan)**:
1. Create two tasks from `release/v1.4` with the merged fix. Task-a spec lists `docs/codebase-map.md` in Affected Files; task-b spec lists a different managed doc but NOT `docs/codebase-map.md`.
2. Run task-a to legitimately edit `docs/codebase-map.md`.
3. Manually copy task-a's modified `docs/codebase-map.md` into task-b's worktree (simulates sibling sync leak).
4. Run `canon run task-b --pr`. **Expected**: dies before opening PR, message names `docs/codebase-map.md` as outside the allow-list with remediation steps. PR does not open.
5. Run `git checkout HEAD -- docs/codebase-map.md` in task-b's worktree, then rerun `--pr`. **Expected**: PR opens with only task-b's in-spec changes.
6. Repeat with both specs listing `docs/codebase-map.md` (same-file overlap). **Expected**: file IS committed (path-level filter — residual), advisory warning fires, operator directed to spot-check with `git diff HEAD`.

## Test Results

| Check | Result |
|---|---|
| `lint` | Pass |
| `type-check` | Pass |
| `unit tests` | Pass (387 pass, 1 skipped) |
| `build` | N/A (no build step beyond type-check) |
| `E2E` | N/A (no UI) |

Code review: approved in one round. Stage 1: all 11 ACs passed, no dropped sections. Stage 2: one optional nit (advisory warning loop iterates stagePaths before the empty-set die — functionally correct, cosmetic only). No correctness bugs, no spec gaps.

## Decisions Made

- **Die semantics kept at every gate** — the v1 of this task (archived at `tasks/_archive/scope-pr-auto-commit-to-affected-files/`) tried warn-and-skip for out-of-scope dirty files and encountered five spec_review changes_requested on gate-state-machine interactions. v2 keeps die semantics at all gates and only narrows the allow-list, producing a smaller blast radius and simpler implementation.
- **`PIPELINE_MANAGED_DOCS` filter at the call site, not in the helper** — `parseAffectedFilesFromSpec` returns all Affected Files paths; the intersection with `PIPELINE_MANAGED_DOCS` happens in `commitHumanReviewFiles` so the helper signature stays clean and non-managed paths never enter the allow-list.
- **Advisory warning is non-blocking** — the same-file overlap residual (two tasks listing the same managed doc, contaminated content may leak through) cannot be detected at the path level without reading file content. The advisory is the operator's signal to spot-check before `--ship`; the structural fix is the sync rewrite (BACKLOG).
- **Telemetry files left unconditionally allowed (residual, not fix)** — `lessons-learned.md`, `task-quality-log.md`, `pipeline-invocations.md` stay auto-allowed. v2 was originally framed as "telemetry isn't a contamination vector because append-only"; that framing was wrong (appended content can reference task-specific data that propagates via worktree sync). The right fix is at the sync layer — telemetry appends should land in REPO_ROOT only — not at the auto-commit gate. Requiring task authors to list telemetry in Affected Files would be the wrong semantics (telemetry is appended *by the orchestrator*, not by the task). Deferred to the sync rewrite BACKLOG entry; v2 ships as a strict tightening of today's behavior without regressing or fixing the telemetry case.

## Open Questions

- **Spec residual note**: specs written before this change that have QA touching managed docs (e.g. `docs/codebase-map.md`) without listing them in Affected Files will get a die at `--pr`. Recovery is to add the entry to spec's Affected Files before rerunning. No action required now, but worth a heads-up when landing on `release/v1.4`.
- **Same-file overlap residual**: path-level filter cannot catch content-level contamination when two tasks both legitimately list the same managed doc. The advisory warning is the only guard until the sync rewrite ships (BACKLOG entry at `docs/BACKLOG.md:467`).
- **Telemetry contamination residual**: per-task content in `lessons-learned.md` / `task-quality-log.md` / `pipeline-invocations.md` appends (task IDs, file paths only on one branch) propagates via worktree sync and lands in the wrong PR — same shape as Mode 2, just per-row instead of per-section. v2 doesn't close this because the structural fix (telemetry appends land in REPO_ROOT only) belongs in the sync rewrite. Surfacing this here so the operator knows v2 catches the high-frequency managed-doc case but leaves the lower-frequency telemetry case as a known gap.

---

## Proposed Changelog

> Audience: canon-ai adopters (operators running canon in their repos). Changelog scope per AGENTS.md §"Release Rules": adopter-visible behavior only; internal pipeline mechanics go in lessons-learned or decisions.

### Proposed entry — under `## [1.4.0] — unreleased`, `### Fixed`

**`--pr` auto-commit no longer silently includes foreign managed-doc edits from sibling worktrees.** Previously, `canon run --pr` allowed any dirty file in `PIPELINE_MANAGED_DOCS` (`docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/architecture.md`, `docs/product-context.md`, `docs/pipeline-orchestrator.md`) to be committed unconditionally. When canon's worktree-to-worktree managed-doc sync leaked a sibling task's edits into the current worktree, those foreign edits would silently land in the wrong PR. The allow-list now requires managed docs to be explicitly listed in the spec's `### Affected Files` table. Dirty managed docs outside that list cause `--pr` to die with an actionable message: add the file to Affected Files (if this task legitimately edits it) or revert with `git checkout HEAD -- <path>` (if it's contamination). Telemetry files (`lessons-learned.md`, `task-quality-log.md`, `pipeline-invocations.md`) remain unconditionally committed and do not need Affected Files entries — this is a strict tightening of today's allow-list, not a complete fix; telemetry's per-row cross-pipeline contamination shape remains as a known residual addressed by the deferred sync rewrite. An advisory warning fires when a managed doc IS committed via the Affected Files carve-out, inviting a `git diff HEAD` spot-check before `--ship` for the same-file overlap case.

**Proposed version bump**: no bump — this fix lands in the existing unreleased `1.4.0` block. Behavioral tightening on a delicate surface with no schema changes.
