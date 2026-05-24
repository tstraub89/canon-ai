# QA Summary: reroute-preflight-spec-amendment-check

> QA by: Claude | 2026-05-24

## What Changed

`canon run --reroute` now performs a pre-flight check before touching any task's state. If `spec.md` doesn't contain an amendment heading, the command exits non-zero and names every failing task, the expected heading text, and a pointer to the reroute guidance. The check is asymmetric: round 1 accepts the loose `## Amendment` form; round 2 and beyond requires the strict `## Amendment Round N` form with the matching round number. Bypass with `--force` when intentionally re-implementing against the existing spec.

The root cause this fixes: operator-Claude ran `--reroute` during 1.4 development without amending `spec.md`, Codex re-read the unchanged spec, re-implemented identically, and the same regression shipped.

## Files Changed

- `scripts/run-task/validation.ts` — new `verifyRerouteAmendment()` helper (round-aware, missing-file fallback, per-case reason strings)
- `scripts/run-task/main.ts` — `rerouteFromHumanReview` runs pre-flight per task before any status write; aborts on failure unless `--force`; `--force` warns and proceeds
- `scripts/run-task/cli.ts` — `--reroute` help text documents the asymmetric requirement and `--force` bypass
- `scripts/run-task/prompts/index.ts` — threads reroute round number into prompt rendering context
- `scripts/run-task/prompts/templates/implement-reroute.md` — directs Codex to the matching amendment heading for the current round; drops legacy variant guidance
- `docs/pipeline-orchestrator.md` — § Reroute feedback channel: pre-flight behavior, heading contract, `--force` bypass, legacy-heading rejection
- `tests/run-task-validation.test.ts` — nine new unit tests (round-1 cases A–E, round-2+ cases F–H, missing-file edge case)
- `tests/run-task-reroute-preflight.test.ts` — new integration tests: no-force abort, `--force` bypass, bundle multi-failure, round-2 boundary
- `tests/run-task-safety.test.ts` — existing reroute/full_send safety fixture updated for worktree-backed spec
- `tests/run-task-prompts.golden.json` — reroute prompt snapshot refreshed
- `dist/scripts/run-task.js` — rebuilt

## How to Test

1. Pick or scaffold a task at `human_review` with no `## Amendment` heading in spec.md.
2. Run `canon run <id> --reroute`. Expected: non-zero exit, error names the task and expected heading, `status.json` unchanged.
3. Add `## Amendment` with content. Run the same command. Expected: reroute proceeds normally.
4. After the task returns to `human_review` a second time, run `--reroute` without adding `## Amendment Round 2`. Expected: failure — round 2 requires the strict form even though `## Amendment` passed at round 1.
5. Add `## Amendment Round 2` (with content) and re-run. Expected: succeeds.
6. (Force bypass) Run `canon run <id> --reroute --force` with no Amendment heading. Expected: per-task warning to stderr, reroute proceeds.
7. (Bundle) Run `canon run <a> <b> --reroute` with both tasks missing Amendment headings. Expected: abort names both tasks; neither `status.json` mutated.
8. (Legacy rejection) Add `## Follow-up` instead of `## Amendment`. Run `--reroute`. Expected: check fails.

## Test Results

All required validation checks passed per handoff:

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests (9 new + full suite) | Pass |
| docs-refs-check | Pass |
| Build (`dist/scripts/run-task.js`) | Pass |
| E2E | N/A — no UI surface |

## Decisions Made

- **Asymmetric heading requirement** (loose on round 1, strict on round 2+): friction stays minimal for the overwhelmingly common case (0–1 reroute); the round number is only required when multiple amendment sections actually coexist and disambiguation matters.
- **Single keyword, no synonyms**: `Follow-up` and `Post-review` are rejected. One convention enforced at the gate beats three loose synonyms that let the pre-flight pass while confusing Codex.
- **Text grep, not git history**: no `spec_sha_at_reroute` field. The heading in the current spec.md text is the only signal — simple, no schema migration.
- **`--force` bypasses with warning**: legitimate escape hatch; the warning per failing task makes the bypass visible without stopping the operator.

## Code Review Round 1 — Findings (all addressed inline post-QA)

Round 1 returned `changes_requested` with four findings. The operator addressed all four inline (commit `5da8e13` on the task branch) before opening the PR, rather than running a Round 2 implement iteration:

**F1 (correctness bug) — FIXED**: `scripts/run-task/prompts/index.ts:238`: `roundNum = maxReroute + 1` was passing `2` to the template on the first reroute, while the pre-flight had accepted `requiredRound = 1`. Codex would have been directed to find `## Amendment Round 2` on a spec that only had `## Amendment`. Fix: introduced `rerouteRound = maxReroute` for the template heading lookup (kept `roundNum` for the banner). Template `implement-reroute.md` now uses `{{rerouteRound}}`.

**F2 (correctness bug) — FIXED**: `tests/run-task-reroute-preflight.test.ts:216` asserted `found \`## Amendment Round 1\`` but the helper actually returns `found \`## Amendment\`` for that fixture. Updated the assertion to match the correct return.

**F3 (correctness bug) — FIXED**: `dist/scripts/run-task.js` regenerated via `npm run build`. Note: reviewer cited `dist/cli/index.js`, but the `--reroute` help text lives in `scripts/run-task/cli.ts` which bundles into `dist/scripts/run-task.js` (the binary `canon run --help` invokes). `dist/cli/index.js` was correctly unchanged.

**F4 (spec gap) — FIXED**: `scripts/run-task/prompts/index.ts:244` updated to drop legacy variants ("Follow-up", "Revision Notes") from the per-task context line. Per AC-11.

**Bonus regex tightening**: while fixing F2, discovered that `verifyRerouteAmendment`'s regex used `\s+` (which includes newlines), causing the helper to span `## Amendment` heading + body text "Round 1 amendment only." as if it were `## Amendment Round 1`. Tightened to `[ \t]+` so heading matches stay anchored to single lines. Applied to both round-1 and round-2+ regexes.

Full validation re-run after fixes: lint, type-check, 437 tests, docs-refs-check, build — all pass.

---

## Proposed Changelog

*Scope: adopter-visible `canon run` behavior changes.*

### For `[1.4.0]` — `Added`

- **`--reroute` now requires an `## Amendment` heading in spec.md before proceeding.** Running `canon run <id> --reroute` from `human_review` without first amending `spec.md` aborts before touching any task state and names each failing task, the expected heading, and a pointer to the reroute guidance. The heading requirement is asymmetric: round 1 requires `## Amendment` (loose form, round number optional); round 2 and beyond requires `## Amendment Round N` with the matching number. Legacy `## Follow-up` / `## Post-review` headings are no longer accepted. Bypass with `--force` when intentionally re-implementing against the existing spec — a warning line per failing task is emitted to stderr to keep the bypass visible.

**Proposed version bump:** no new bump — this is an `Added` item within the `[1.4.0]` unreleased block.
