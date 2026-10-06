# Implementation Handoff: rearm-spec-gate

> Author: Codex | Spec: `tasks/rearm-spec-gate/spec.md` | Plan: `tasks/rearm-spec-gate/plan.md`
>
> Iteration 1 — initial implementation.

## Changes

| File | What Changed |
|---|---|
| `src/task/index.ts` | Made `human_spec_gate` settable with validated booleans, delicate-task disarm refusal, atomic full-send clearing note, reroute guidance for completed spec review, corrected full-send refusal, and task-new command hint. |
| `tests/task-cli.test.ts` | Covered gate set/disarm, invalid values and byte preservation, full-send interaction, delicate behavior, warning matrix, worktree routing, task-new guidance, and refusal/list wording. |
| `tests/run-task-reroute-preflight.test.ts` | Added coverage that a re-armed gate halts after approved full-tier reroute review and consumes its latch. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt bundled CLI outputs. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented the settable contract, false latch semantics, reroute behavior, and full-send interaction; synced mirror. |
| `docs/decisions.md` | Updated full-send clearing paths. This root-only document has no managed mirror. |
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Replaced manual status edits with canon task commands; synced mirror. |

## Intent & Rationale

The task setter now owns gate changes and preserves existing worktree routing. It validates and refuses before writing when appropriate, then performs one atomic status write. Arming clears `full_send` in that write when needed, and prints state-specific operator guidance after the write.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None. | Implemented the planned source, tests, docs, skill updates, and generated outputs. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Tests cover case-insensitive booleans, timestamp/status derivation, invalid input, and byte-identical refusal. |
| AC-2 | Met | Tests verify `full_send` clears with the gate in one update and note names the real task id; no note when already false. |
| AC-3 | Met | Test verifies disarming leaves `full_send` true. |
| AC-4 | Met | Tests verify delicate disarm refusal is byte-identical and names the forced full-send command; arming succeeds. |
| AC-5 | Met | Updated refusal assertion; `full_send` remains redirected with `--reroute` and no stale “not durable metadata” wording. |
| AC-6 | Met | Tests cover completed review, started review pending, and unstarted warning cases for both values. |
| AC-7 | Met | Removed gate redirect/refusal path; unknown-field settable list includes the gate; structural greps are clean. |
| AC-8 | Met | Reroute preflight test observes the gate banner, exit 0, and consumed latch without orchestrator source changes. |
| AC-9 | Met | Task creation points to `canon task set <id> <field> <value>` rather than editing status. |
| AC-10 | Met | Pipeline docs, decision, skill, and managed mirrors describe the revised contract without stale latch semantics. |
| AC-11 | Met | `git diff --name-only main` has no `src/orchestrator/` or `src/lib/pipeline-policy.ts` paths. |

## Edge Cases Considered

- Invalid booleans and delicate disarm refusal throw before the atomic write.
- Arming on a task already in full-send clears both flags together; disarming does not change full-send.
- Existing worktree routing was exercised with distinct repository and worktree status copies.
- A completed `spec_review` uses full-tier reroute guidance; a fast-tier reroute is not advertised as a gate recovery.

## Blockers

- [ambiguity] AC-6 explicitly requires `human_spec_gate false` on a `spec_review`-done task to print neither the reroute note nor the generic started-task warning, although that task has started. Followed the specific AC case: suppress the generic warning for either gate value once `spec_review` is done; arming prints the reroute note, disarming prints neither. This interpretation is also recorded in `tasks/rearm-spec-gate/notes.md`.
- No unresolved implementation blockers.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,349 passed, 0 failed, 1 skipped. The skipped `REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree` test reports `.git/ writes are restricted in this environment`; that case remains unverified here. |
| `npm run build` | Pass | Generated both declared `dist/` bundles. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| E2E | N/A | Spec marks this N/A: no UI surface. |
| Structural greps and scope check | Pass | No `not durable metadata` or `self-clearing` in `src/`; skill has no manual status-edit instruction; no prohibited orchestrator paths in branch diff. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `tests/task-cli.test.ts` | Strengthened the `full_send` refusal assertion to require `--reroute` and reject `not durable metadata`. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Added full-tier reroute halt and fast-tier reroute behavior to the single-use latch section; synced mirror. |

### Findings addressed

- _correctness bug / AC-10:_ Added the full-tier and fast-tier reroute behavior to §"Spec gate is a single-use latch" in the root doc and managed mirror.
- _correctness bug / test integrity / AC-5:_ The refusal test now checks for both `canon run --full-send` and `--reroute`, and asserts the obsolete phrase is absent.
- _optional cleanup/nit:_ Left the compound gate test intact; splitting it is not needed to address this round's findings.

### AC deltas

- AC-5: Partial → Met; test pins the complete corrected refusal wording.
- AC-10: Partial → Met; latch section now states full-tier reroute re-engagement and fast-tier reroute non-engagement.

### Spec-level findings noted

- [ambiguity] The review notes the AC-mandated completed-review message can be unhelpful immediately after a gate halt because reroute admission begins later. Kept the AC-required `full-tier canon run --reroute <id>` guidance; changing or appending an alternate recovery command would contradict the current AC/known-risk wording and requires a spec decision.
- [ambiguity] The review notes that changing `delicate` to false, disarming the gate, then restoring `delicate` can bypass the delicate disarm friction. Interpreted AC-4 literally as guarding `human_spec_gate false` when the task is delicate at that call; adding a guard to `delicate` mutations is outside the listed contract and needs a spec decision.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/task-cli.test.ts` | Pass | 74 passed, 0 failed, 0 skipped. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| `npm run build` | Pass | Rebuilt both declared `dist/` bundles. |
| `npm test` | Pass | 1,349 passed, 0 failed, 1 skipped. The same environment-restricted linked-worktree test noted in Iteration 1 remains unverified. |
