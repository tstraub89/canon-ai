# QA Summary: preflight-failure-routing

## What Changed

The `code_review` pre-flight gate now classifies each rejection by who can fix it, instead of emitting one uniform "resubmit handoff" message for every blocker.

**Before:** Every pre-flight blocker produced the same message — "fix your handoff, resubmit" — regardless of whether the problem was a malformed handoff document or a real test regression. A Codex implementer seeing "fix the handoff" after breaking a test had no signal to fix the code; the path of least resistance was relabeling the `Fail` row until the gate accepted it. A `Fail – unrelated` entry citing a file the task itself changed would sail past the gate into full Claude review, giving a regression a free pass if the file reference in Notes looked plausible.

**After:** Three buckets, routed by who can fix it:

| Failure class | What triggers it | Message | Route |
|---|---|---|---|
| **Format** | Missing AC Coverage table, malformed Changes row, unfilled handoff template, handoff↔diff mismatch | "Fix the handoff" with the structural problem named | → implement |
| **Regression** | A plain `Fail` row; or a `Fail – unrelated` row whose cited file is in the task's own diff (the laundering guard) | "Fix the code — you broke `<check>`; use `Fail – unrelated` only for failures genuinely outside your changed files" | → implement |
| **Infra/blocked** | `blocked` rows are the *only* remaining blocker | "Infrastructure was unavailable — re-implementation cannot resolve this; human triage required" | **Halt: auto-block for human triage** |

Mixed fixable blockers (e.g., a malformed Changes row *and* a real `Fail`) stack both framings in the rejection — neither is dropped by precedence.

The laundering guard compares the file token in the `Fail – unrelated` Notes field (stripping any `:line`/`:line:col` suffix) against the task's changed-files set from the branch diff. A genuinely-unrelated failure — cited file not in the diff — still passes and proceeds to Claude Stage 1 review as before.

The implement-revision prompt was also rewritten to be bucket-neutral: it no longer asserts the rejection is a handoff-format problem, no longer says "source-code changes are usually unnecessary," and instead directs Codex to read the `## Validation Gate` / `## Pre-Flight Rejection` block in `review.md` for the actual fix instruction.

Declared canon was updated with the same rule: a `Fail – unrelated` entry is invalid when the cited file is one the task itself modified. This now appears in `AGENTS.md`, `CLAUDE.md`, and both reviewer and implementer prompt templates.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Added `extractCitedFilePaths` (suffix-tolerant path extraction), `classifyPreflightBlockersFromData` (three-bucket classifier), in-diff laundering guard in `validateHandoffAgainstSpec`. |
| `scripts/run-task/phases/code-review.ts` | Replaced the undifferentiated pre-flight block with `determinePreflightRoute` + `buildPreflightReviewBlock`; routes to `autoBlockPhase` for blocked-only, `taskPhasePreflightRejected` for all fixable blockers. |
| `scripts/run-task/prompts/index.ts` | Made the `hasPreflightFindings` branch of `promptImplementRevisions` bucket-neutral. |
| `scripts/run-task/prompts/templates/implement-revisions.md` | Replaced handoff-only framing with neutral "read the pre-flight block in review.md and follow whichever instruction it carries." |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | Added reviewer instruction: a file the task modified cannot be labeled "unrelated." |
| `scripts/run-task/prompts/templates/implement.md` | Added implementer instruction: record `Fail – unrelated` only for failures outside your Affected Files. |
| `tests/run-task-validation.test.ts` | New tests for cited-path extraction, three-bucket classification, laundering guard (both directions), priority rule, suffix-tolerant match, and review-block framing. |
| `tests/run-task-prompts.test.ts` | Added pre-flight branch assertions: `doesNotMatch` for retired phrases, `match` for neutral review.md-authority wording. |
| `tests/run-task-prompts.golden.json` | Regenerated for `code-review-round-1.md` and `implement.md` template changes. |
| `AGENTS.md` | Extended `Fail – unrelated` result-state rule with the own-file clause. |
| `CLAUDE.md` | Extended Stage 1 validation-gate rule with the own-file clause. |
| `templates/AGENTS.md` | Synced mirror of AGENTS.md. |
| `templates/CLAUDE.md` | Synced mirror of CLAUDE.md. |
| `dist/scripts/run-task.js` | Rebuilt bundle. |

## How to Test

Follow the Human Test Plan from the spec:

1. **Regression-class rejection (laundering guard):** Take a task where the implementer broke a check in a file it changed and labeled the failure `Fail – unrelated` with that file's path in Notes. Run the review step. Expected: the pre-flight rejects with a message telling the implementer to fix the *code* — not the handoff document — and the task routes back to implement.

2. **Genuinely-unrelated accept path preserved:** Take a task with a `Fail – unrelated` row whose cited file is legitimately not in the task's diff (valid reference). Run the review step. Expected: the handoff passes pre-flight and proceeds to full Claude review.

3. **Infra-blocked halt:** Take a task whose only problem is a `blocked` row (infrastructure was unavailable). Run the review step. Expected: the task auto-blocks for human triage — it does not loop back to implement.

4. **Format-class rejection:** Take a task with a structurally incomplete handoff (missing the AC Coverage table). Run the review step. Expected: the message tells the implementer to fix the handoff document; the task routes back to implement.

5. **Mixed rejection stacks both framings:** Take a task with both a malformed Changes row and a real `Fail` row. Run the review step. Expected: the rejection message contains both "Fix the handoff" items and "Fix the code" items; routes to implement, not auto-block.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Ran `UPDATE_GOLDENS=1 npm test` once to refresh prompt snapshots; final normal run passed. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js`; `dist/cli/index.js` remained byte-identical. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |

## Human Verification Required

None.

## Decisions Made

- **Pure route/message helpers in `code-review.ts`** (`determinePreflightRoute`, `buildPreflightReviewBlock`) rather than inline code: the spec required unit assertions on framing and routing without spawning a full orchestrator session. Exporting these helpers keeps that coverage lightweight.
- **`dist/cli/index.js` omitted from the Changes table:** `npm run build` left this artifact byte-identical in this worktree. Listing a net-zero file would create a false handoff↔diff mismatch. The spec Affected Files declares it, satisfying the base-drift gate; the Changes table omits it because no actual delta landed.
- **Bundle behavior for the laundering guard:** the changed-files set is computed from the bundle-wide three-dot diff (`getAffectedFiles`). Every per-task classifier receives the union, so no bundled task can call a file changed by a peer "unrelated."

## Open Questions

None.

## Proposed Changelog

Audience: canon-ai contributors and adopters (see `docs/decisions.md` §"Versioning and release policy").

**Proposed version: 1.10.0 (minor)** — new validation gate behavior (laundering guard, infra-halt path) and new agent-facing messaging; no breaking changes to templates, `status.json` schema, or workflow expectations.

```markdown
### Fixed

- **Pre-flight now tells the implementer to fix the code, not the handoff, when a real check failed.** Every pre-flight blocker previously produced the same "resubmit handoff" rejection regardless of whether the problem was a document structure issue or a genuine test regression. The gate now classifies each blocker: format problems (missing AC Coverage table, malformed Changes row, unfilled template) still say "fix the handoff"; a real `Fail` row says "fix the code" and names the failing check. Infrastructure failures (`blocked` rows) halt for human triage instead of sending the work back for another implementation pass. Mixed fixable blockers stack both instructions so neither is dropped.

### Added

- **`Fail – unrelated` entries citing a file the task itself changed are now rejected deterministically at pre-flight.** A regression can no longer pass the pre-flight gate by labeling a failure "unrelated" when the cited file is one the task modified. The file reference in Notes is compared against the task's branch diff (tolerating `:line`/`:line:col` suffixes); if it matches, the failure is classified as a regression blocker regardless of the `Fail – unrelated` label. Entries citing a file genuinely outside the diff still pass and proceed to Claude Stage 1 review as before. The same rule is now stated in the Stage 1 reviewer instruction, the Codex implementer prompt, and the declared-canon docs (`AGENTS.md`, `CLAUDE.md`).
```

Human finalizes phrasing and version.
