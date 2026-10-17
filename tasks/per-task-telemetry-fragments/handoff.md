# Implementation Handoff: per-task-telemetry-fragments

> Author: Codex | Spec: `tasks/per-task-telemetry-fragments/spec.md` | Plan: `tasks/per-task-telemetry-fragments/plan.md`
>
> Complete current implementation, including Amendment 1 / reroute 1. This replaces the pre-amendment handoff; prior blockers are resolved below.

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/metrics.ts` | Fail-soft task metrics fragments, bundle-leader routing, call-time overrides, shared skeleton/path exports. |
| `src/orchestrator/quality-log.ts` | QA fragment routing and reusable row replacement; shared-log fold preserves earliest verdicts and adopter columns. |
| `src/orchestrator/telemetry-fold.ts` | Compute/apply/delete fold with rollback for ordinary filesystem failures, missing/empty-fragment handling, drift classification, and a state-parameterized post-fold recovery hint. |
| `src/orchestrator/main.ts` | Fold after merge proof before archive changes, stage shared metrics in archive commit, warn on shared-doc edits through both PR paths, and diagnose post-fold archive/commit/push failures. |
| `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/qa.md` | Render each member's lessons fragment, describe quality fragments, and count shared plus task lessons for maintenance signals. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt bundles. |
| `tests/metrics.test.ts` | Single/bundle routing, overrides, fail-soft writes, and real-git early-phase cleanliness. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Positive single/bundle fragment assertions; only the two QA golden keys changed. |
| `tests/run-task-ship.test.ts` | Ship fold/reconcile/archive staging, abort/retry, partial-apply rollback, real parallel squash merges, legacy/missing/empty fragments, ordering, PR warnings, and red-first post-fold failure diagnostics. |
| `tests/task-cli.test.ts` | Repeated qa → done writes one fragment row and preserves shared-log bytes and mtime. |
| `tests/run-task-quality-log.test.ts` | Header-name mapping, earliest verdict, adopter columns, stray removal, malformed-table rejection, and backslash round trips through QA writes/reruns and folds. |
| `docs/architecture.md` | QA step and telemetry flow describe fragments and ship folding. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Fragment lifecycle, legacy safeguards, warning, and ordered ship fold/staging step. |
| `docs/lessons-learned.md`, `templates/docs/lessons-learned.md` | Lessons arrive through ship; QA writes only its own fragment; combined buffer signal. |
| `docs/task-quality-log.md`, `templates/docs/task-quality-log.md` | Header describes QA fragment upserts folded on ship. |
| `.canon/templates/notes.md`, `templates/.canon/templates/notes.md` | Notes distill to task lessons during QA and reach shared lessons on ship. |
| `docs/codebase-map.md` | Three log rows and knowledge-flow note describe fragments and fold. |
| `docs/decisions.md` | Existing QA-upsert decision now records per-task fragments and ship folding. |
| `tests/run-task-safety.test.ts` | Worktree metrics-routing regression now checks the task fragment and unchanged shared logs in both checkouts. |
| `src/cli/commands/doctor.ts` | Shared quality-log creation messages now describe ship folding; existing statuses and parent-directory diagnostics remain. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Task runs write metrics, quality rows, and QA lessons inside their task directories. Bundle metrics retain the joined task label in the first member's fragment; lessons remain per member. Runtime writers are fail-soft and respect existing file overrides. Doctor continues reading the shared quality log.

Ship folds merged fragments into the three shared logs after merge proof and before archive-state changes. It computes all contents first, replaces the shared docs, then consumes the fragments; ordinary apply errors restore docs/fragments. Quality folding reuses existing row placement and reconciliation, preserving the earliest Spec verdict, adopter columns, and unrelated rows while removing stray duplicates. Paired backslashes now decode correctly through QA history and folding. Folded task refs pass through the existing archive rewrite, and all three shared logs are staged in the archive commit. Legacy dirt handling and telemetry exemptions remain in place.

Amendment 1 adds a recovery hint after actual fold writes: archive/commit failures describe uncommitted or staged rows; a push failure describes the local archive commit that was not pushed. Both warn that fragments were already deleted, prohibit the relevant reset, name every folded doc, and point to the existing manual-recovery paragraph. Failures without shared-doc fold writes keep their previous diagnostics. commitArchiveChanges retains its exported result/throw contract; its push is the only throwing git call after a successful commit.

## Amendment and Review Findings

- **S1 / AC-12 resolved:** the worktree-routing regression reads the metrics fragment in the worktree, asserts both shared metrics docs are unchanged, and confirms the supervising task has no implement metrics fragment in this fixture.
- **S2 / AC-12 resolved:** doctor messages describe shared-log creation by the ship fold. Existing doctor tests do not assert the obsolete wording, so the amendment's conditional edit to `tests/cli.test.ts` was unnecessary; that file is unchanged and its checks pass.
- **S3 / AC-11 resolved as specified:** caught archive-move and push throws, extended commit-failure output, and retained documented manual recovery. Automatic repair/retry remains out of scope under the human's options (a)+(c) decision.
- **C1 retained:** backslash round-trip fix and regression through done.md judgment parsing, QA row writes/reruns, and repeated folds.
- **C2 retained:** both quality-log documents describe the fragment upsert and shared-log fold in their header and usage text.
- The previous reviewer-artifact reference blocker no longer reproduces; docs-reference validation passes. The prior out-of-scope safety-test blocker is resolved by the amendment's expanded cap and test update.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Original fold failure tests use a malformed shared quality table plus injected replacement/deletion errors instead of chmod fixtures. | Deterministic under elevated users and across platforms; checks restored state and successful retry without permission-based skips. | AC-5 covered. |
| Fold temporary files use exclusive unique names. | Avoid clobbering existing temp files; cleanup owns only files successfully created by the fold. | None. |
| Quality fragment target is computed inline from donePath rather than via another exported helper. | The caller already resolves worktree/override ownership; existing API remains unchanged. | AC-2 covered. |
| PR warning is in the shared reportOrCreatePR path. | Covers clean retries and commit-then-PR calls, including telemetry committed during the same call. | AC-9 covered. |
| Parallel fixture performs real local squash merges with a bare origin and fake forge. | Exercises git conflict behavior and both ship/archive commits without an external service. | AC-6 covered. |
| Doctor's missing-parent warning names ship creation without saying the fold cannot create the missing directory. | The fold creates parent directories; the literal suggested plan wording would be false. Existing warn status and parent-directory text remain. | AC-12 covered. |

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-1 | Met | Metrics tests cover header creation, unchanged shared log, bundle destination/label, call-time tasks/file overrides, mkdir, and fail-soft warnings. |
| AC-2 | Met | QA transition/rerun writes one fragment row and leaves shared-log bytes/mtime unchanged; omitted judgments preserve earlier values. Doctor remains a shared-doc reader. Backslashes survive reruns. |
| AC-3 | Met | Single/bundle prompt assertions name each real lessons path, reject placeholder/empty-id paths, and check the combined buffer count. Only the two QA golden keys differ from main. |
| AC-4 | Met | Ship tests verify metrics order without duplicated header, quality reconciliation/adopter cells/stray removal, archived refs, consumed fragments, and all three docs in the archive commit. |
| AC-5 | Met | Fold compute failure preserves docs/fragments/status and aborts before archive; retry succeeds. Injected partial replacement/deletion failures restore state. |
| AC-6 | Met | Real writers leave both branch shared-doc diffs empty; sequential real squash merges and ships preserve both tasks' metrics, quality rows, and lessons without conflicts. |
| AC-7 | Met | Legacy rows merged from the branch ship without fragments; missing shared docs are created when fragments contain rows/entries. |
| AC-8 | Met | Real git fixture remains clean under docs after spec/spec_review/plan metric writes. Worktree regression also verifies the new destination and both unchanged shared docs. |
| AC-9 | Met | Shared-doc edits warn and PR creation continues; no warning when shared docs are untouched. |
| AC-10 | Met | Required root/scaffold docs and managed mirrors describe fragments plus ship folding; the formerly missed usage sentence is corrected; sync and docs refs pass. |
| AC-11 | Met | Three red-first cases cover non-empty archive destination, commit failure, and push failure. Each now names docs, identifies row location, warns about deleted fragments/reset, and references manual recovery. Opposite-state assertions reject the wrong location text. Two no-fold cases assert no hint. |
| AC-12 | Met | Worktree routing assertion and doctor restatements updated; full npm test passes, including the safety suite. |

## Regression Checkpoint

Before editing the amendment's production code, ran:

`node --test --test-name-pattern='--ship post-fold failure hint:' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-ship.test.ts`

All three failed at the assertion expecting `/Failure after the telemetry fold/`:

| Case | Pre-fix observed output | Post-fix |
|---|---|---|
| Archive rename | Raw ENOTEMPTY stack; no recovery hint. Destination held a sentinel file so the real rename failed. | Pass: uncommitted/staged hint; source task remains; folded docs remain; fragments are gone. |
| Commit | Existing failed-to-commit abort prefix and simulated commit error; no recovery hint. | Pass: same prefix plus uncommitted/staged hint. |
| Push | Raw git push failure after successful archive commit; no recovery hint. | Pass: unpushed local archive-commit hint; local commit subject verified. |

Re-ran the same three cases plus the existing no-fold commit/push failures: all five passed. The earlier C1 checkpoint also reproduced doubled backslashes before its decoder fix; its QA-writer/repeated-fold regression remains green in the full suite.

## Edge Cases and Accepted Risks

- Missing and empty fragments are consumed/no-ops as appropriate; fold argument order is preserved. Malformed tables abort rather than silently discard telemetry.
- Runtime file overrides still take precedence and do not create missing override parents. Ship always targets the repository's shared logs.
- QA reruns omit unchanged judgment cells; explicit corrections remain supported. Shared/fragment history keeps an earlier shared Spec verdict.
- Ordinary fold I/O failures roll back prior writes and deleted fragments; rollback failures are surfaced.
- A process kill between shared writes and fragment consumption can duplicate metrics/lessons on retry; manual deduplication remains the accepted recovery.
- Post-fold archive/commit/push failures require manual recovery as the amendment explicitly accepts. The new hint diagnoses data location; it does not introduce automatic repair. Internal process exits during worktree teardown are outside the amendment's named rename/commit/push cases.
- Telemetry visibility remains delayed until ship. An older engine can archive new fragments without folding; retained fragments must then be recovered manually.

## Blockers

None. Amendment 1 supplies the previously missing scope and settles the post-fold recovery decision. No new ambiguity required a scope expansion.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | All source/test changes. |
| `npm run type-check` | Pass | Strict TypeScript; no suppressions added. |
| `npm run build` | Pass | Rebuilt both declared dist bundles. |
| `npm test` | Pass | 1,481 tests: 1,480 pass, zero fail, one skip. Includes all original and amendment regression cases. |
| `npm run sync-templates:check` | Pass | All managed mirrors aligned; existing manual-recovery paragraph retained. |
| `npm run docs-refs-check` | Pass | All refs OK before handoff rewrite; rechecked after artifact creation. |
| AC-11 targeted regression | Pass | Three pre-fix failures reproduced for the specified missing-hint reason; post-fix three hint cases plus two no-fold cases pass. |
| Worktree-routing regression | Pass | Direct Node runner with the runImplementPhase writes metrics name filter: one test passes. |
| Doctor quality-log checks | Pass | Direct Node runner with checkQualityLog name filter: all six pass; no old wording assertions needed updating. |
| Scope, cumulative coverage, whitespace, golden keys | Pass | 27 implementation files within original/amended cap; all cumulative paths declared in Changes. git diff --check passes. Golden diff changes only promptQa and promptQa_withTemplate. |
| E2E | deferred_by_spec | Spec Validation Required explicitly marks E2E N/A; real-git integration covers AC-6. |

## Ready for Review

- [x] All original and amendment ACs met.
- [x] All required checks pass.
- [x] Deviations and accepted risks documented.
