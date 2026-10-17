# Code Review: per-task-telemetry-fragments

> Reviewer: Claude | Spec: `tasks/per-task-telemetry-fragments/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

This is the first review after reroute 1 (Amendment 1). The pre-reroute review is archived in `review-prior-1.md`. Lens returns: anchored-Claude (valid, Stage 1 pass, signal `approve`), cold-Claude (valid, 12 findings, signal `changes_requested`), cold-Codex (injected, 1 finding, P2).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results. The anchored lens re-ran the full suite in the worktree: 1481 tests, 1481 pass, 0 fail. It also re-ran lint, type-check, `sync-templates:check` and `docs-refs-check`, and all exit 0. After `npm run build`, `git status -- dist` is empty.
- [x] All checks required by the spec's "Validation Required" section were run. E2E is N/A per the spec.
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Metrics go to the fragment | Met | `metrics.ts` is unchanged since the prior round. `tests/metrics.test.ts` covers fragment routing, the bundle leader, both overrides and fail-soft writes, and it passes. |
| AC-2: Quality row goes to the fragment | Met | The task-cli and quality-log tests pass: one fragment row, first verdict kept, shared doc untouched. Doctor still reads the shared doc. |
| AC-3: QA prompt targets the lessons fragment | Met | `promptQa` renders `lessonsFragments` per task. The single and bundle assertions pass, and the golden file changes only the two QA keys. |
| AC-4: `--ship` folds and removes fragments | Met | The staged paths include all three shared docs. The (a)–(e) ship tests pass. |
| AC-5: Failed fold leaves `--ship` re-runnable | Met | The fold runs after the merge-proof gate and before the archive loop (`main.ts:2325`). The abort/retry tests pass. |
| AC-6: Parallel tasks don't conflict | Met | The real squash-merge parallel test passes. |
| AC-7: Missing fragments are a no-op | Met | The legacy no-op and skeleton-creation tests pass. |
| AC-8: Early-phase metrics leave main checkout clean | Met | The temp-repo test passes, and the worktree regression asserts the row is in the fragment. |
| AC-9: `--pr` warns on shared-doc drift | Met | The warning lives in `reportOrCreatePR`, and both the warn and no-warn tests pass. |
| AC-10: Docs and templates describe the new flow | Met | A grep across the AC-10 files, skills, `.canon/templates`, prompt templates and mirrors found no claim that runs write the shared logs directly. Sync and refs checks pass. One residual adopter-scaffold phrase is listed below as nit N6. |
| AC-11: Post-fold failures print recovery hint, red-first | Met | The anchored lens checked red-first itself. It ran HEAD's ship tests against the pre-amendment tree (037af38), and all three hint tests failed: rename with a raw ENOTEMPTY stack, commit and push with no hint. They pass on HEAD. The opposite-state text is pinned with `doesNotMatch`. |
| AC-12: Restatements updated | Met | `run-task-safety.test.ts` now checks `tasks/<id>/metrics.md` and keeps the shared-doc-unchanged checks. The doctor messages at `doctor.ts:304,310` now describe the ship fold. |

Prior-round findings: C1 (backslash round-trip) and C2 (quality-log doc wording) remain fixed. S1, S2 and S3 are resolved per Amendment 1.

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted (including the amendment's manual-recovery risk)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is sound. Fold placement, compute-then-apply with rollback, quality reconciliation that reuses `replaceTaskRow`, and the single parameterized `formatPostFoldFailureHint` all match the spec. The hint is pinned by state-varying tests. The surviving findings are low-severity hardening and wording items on rare legacy or recovery paths, and none produces wrong output on the normal ship path.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **N2 — Preserved sibling dirt is not named in the fold-abort or post-fold messages.** Flagged by 2 lenses: anchored and cold-Claude. Classified as a non-blocking nit: the path needs legacy dirt plus a failure, the backup path is already printed, and the same gap exists today. Location: `src/orchestrator/main.ts:2325-2335` and the archive catch block near `main.ts:2403`.
  - In a worktree-mode ship, `classifyAndPreserveSharedDocDirt` (`main.ts:2215`) reverts the shared docs and moves legacy append-dirt into a tmp backup.
  - A fold-failure `die`, or a post-fold failure before the re-apply loop, exits without re-applying that dirt. Neither message names the backup, and the earlier `Preserving ... backup:` info line is the only pointer.
  - This only arises with old-engine dirt (a transitional case), and the merge-proof `die` has the same pre-existing gap.
  - Suggested follow-up: append the backup path to both messages.

#### Optional Cleanup / Nit

- **N1** (anchored), `docs/pipeline-orchestrator.md:513` and its mirror: the "Failure after the telemetry fold" paragraph doesn't say that after a push failure the `chore: archive` commit already exists locally and only the push needs retrying.
- **N3** (anchored), `src/cli/commands/doctor.ts:301-305`: the missing-parent branch still `warn`s and tells the user to "create the directory". The fold does `mkdirSync(..., { recursive: true })`, so that advice is now unnecessary. The handoff records this as a deliberate deviation.
- **N4** (anchored), `tests/run-task-ship.test.ts:1704-1746`: all three post-fold hint tests run in non-worktree mode, so no test covers worktree mode with preserved dirt plus a post-fold failure.
- **N5** (cold-Claude), `src/orchestrator/main.ts:2322`: the comment "Fold before teardown … so failures are re-runnable" only holds for fold failures. After a post-fold failure, a plain retry is blocked by the dirt classifier until manual recovery, which is documented. Narrow the comment.
- **N6** (cold-Claude), `templates/docs/patterns.md:75`: the adopter scaffold still says "QA only appends to the buffer". QA now appends to its task's lessons fragment, which `--ship` folds into the buffer. The point of the sentence, that QA never promotes, still holds. Reword to "QA only appends lessons (via its fragment)".
- **N7** (cold-Claude), `src/orchestrator/prompts/templates/qa.md:49-50`: the rendered `{{{lessonsFragments}}}` list starts at column 0 inside an indented list continuation, so it renders as top-level bullets. The lead-in also says "each member's" for single-task runs. The text is legible to the agent and pinned by the golden file, so this is cosmetic.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Dismissed (cold-Codex), also flagged by cold-Claude: fold of metrics/lessons is not crash-idempotent.** If the process is killed after the shared docs are replaced and before the fragments are unlinked, a retry duplicates metrics rows and lessons. The behavior is real, and two models flagged it, but the spec explicitly accepts it.
  - Spec Known Risks: "if the process is killed after the shared docs are written and before the fragments are deleted, a re-run folds the metrics rows and lessons entries twice … the accepted recovery is to hand-delete the duplicates before committing."
  - Amendment 1 Known Risks: "A self-healing re-run was rejected as new logic on a delicate path for a rare failure."
  - cold-Claude's variant (fragments restored from HEAD by hand during recovery, then re-folded) is the same accepted class.
- **Dismissed (cold-Claude): worktree-only fragment rows are destroyed by `teardownWorktree`.** The spec's Decision says "Fragments are read from the main checkout's task directory". `commitQaArtifacts` (`main.ts:847`) commits all allowed `tasks/<id>/` dirt at QA end, so fragments ride the task branch into the merge. Uncommitted worktree writes after that point carried the same loss window before this change.
- **Dismissed (cold-Claude): `die()` paths inside the archive try block skip the hint.** `taskSnapshot` dies only for an id with no snapshot, but snapshots are populated for every `taskId` before the merge (`main.ts:2191-2201`), and the status re-reads were validated pre-merge. That makes the path unreachable in practice. Amendment 1 scopes the hint to the archive move, commit and push, all of which are caught.
- **Dismissed (cold-Claude): `commitTaskArtifactsToBase` still absorbs `PIPELINE_TELEMETRY_FILES` dirt.** This is explicitly retained by Non-Goals ("No removal of the legacy safety nets … the absorb-telemetry half of `commitTaskArtifactsToBase`").
- **Dismissed (cold-Claude): a malformed shared quality log now aborts `--ship` instead of warning.** This is spec-intended: "If computing or writing fails, `--ship` aborts with the shared docs unchanged and the fragments intact". Fail-soft is specified for run-time fragment writes only. Aborting keeps telemetry from being silently discarded, and the abort is re-runnable (AC-5).
- **Dismissed (cold-Claude): non-worktree ships sweep unrelated `docs/pipeline-invocations.md` dirt into the archive commit.** This is accepted in Known Risks ("Non-worktree ships … a small, transitional widening").
- **Dismissed (cold-Claude): `stageArchiveChanges` ignores `git add` failures.** This predates the task (`main` `main.ts:1952`, unchanged by the diff), and a `git add` failure on a tracked doc followed by a successful commit is implausible.
- **Dismissed (cold-Claude): backslash halving in `splitTableRowCells` may corrupt cells.** The renderer escapes `\` → `\\` (`quality-log.ts:89`), so halving is the matching decoder. This was the prior round's C1 fix, with round-trip tests. A hand-written `\\` decodes to `\` and re-renders as `\\`, which is byte-stable.
- **Dismissed (cold-Claude): the metrics skeleton header "One row per agent invocation" is stale.** It is still true: there is one row per invocation, and only the arrival time changed.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
