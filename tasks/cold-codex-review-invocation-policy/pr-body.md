# PR Body: cold-codex-review-invocation-policy - Cold-Codex review lens gets canon-resolved effort and a telemetry row

## Summary

- Route the cold-Codex `code_review` lens through the same invocation policy as every other Codex call, so it no longer inherits the operator's personal `~/.codex/config.toml` reasoning-effort setting.
- Fixes #195: an effort value the Codex CLI itself rejects (a user had `ultra`) used to hard-block `code_review` on that machine with zero diagnostic trail, since the cold lens wrote no telemetry either.
- The cold lens now resolves effort from a new `code_review` row in the Codex policy matrix (`high` at every task size XS–XL; model stays mini/unchanged) and passes it explicitly on the invocation, never touching the user's config file.
- Every cold-review attempt — success or failure — now writes exactly one telemetry row to `docs/pipeline-invocations.md`, matching the existing per-invocation contract other Codex calls already follow.
- Added a shared pre-spawn guard that rejects any resolved effort value outside the Codex CLI's accepted set (`none|minimal|low|medium|high|xhigh`) before spawning, applied to all three Codex call sites (fresh, resumed, and cold).

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt; only `dist/scripts/run-task.js` changed)

## Notes

- The effort raise is a real behavior change for adopters: the cold lens previously ran at whatever effort the CLI defaulted to (often `medium`), and now always runs at `high` — higher cost/latency per review, uniform across sizes. Called out in the changelog draft.
- The invalid-effort guard is shared across all three Codex call sites, but only the cold path currently records a `failed` telemetry row when the guard itself rejects an effort pre-spawn — the ordinary `runCodex` guard `die()`s with no row. This can't fire today because every production caller passes a matrix-resolved, already-valid effort; flagged in code review as a non-blocking asymmetry for future unification if `runCodex` failure telemetry ever matters.
- This task's own `code_review` ran against the currently-published `canon-ai` package, not this branch, so the new cold-Codex telemetry row and effort override haven't fired live yet in this repo's own `docs/pipeline-invocations.md` — that will happen on the first `code_review` run after this ships.
- Three-lens code review (anchored Claude, cold Claude, cold Codex) reached full agreement: approved with nits, no correctness bugs, no spec gaps.
