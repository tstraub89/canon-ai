# PR Body: cold-lens-full-model-l-xl - Cold-Codex review lens uses the full model at L and XL/delicate

## Summary

- The mixed-mode cold-Codex review in `code_review` now runs on the full Codex model for effective size L and XL. Delicate tasks and any bundle with an L, XL, or delicate member are covered by the same rule.
- XS, S, and M keep the mini model. Effort stays `high` at every size. No `spec_review`, `implement`, or Claude-side cell changes.
- The change is a two-cell edit in the `code_review` row of `codexMatrix()` in `src/lib/pipeline-policy.ts`, plus tests that pin the matrix and check the literal `-m` argument through the real Codex backend.
- `CODEX_MODEL_FULL` (and the deprecated `CODEX_MODEL_DELICATE`) now also steers the lens at L/XL. `CODEX_MODEL_MINI` steers it at XS–M.
- Docs that said the cold lens was flat mini are updated: the pipeline guide and its template mirror, the README delicate passages, the canon-pipeline recovery skill and its mirror, and `docs/BACKLOG.md`. A new dated section in `docs/decisions.md` records the decision and supersedes only the model clause of the 2026-06 cold-lens entry.
- Rollback is to install the previous canon release. There is no per-phase Codex override.

Why: post-PR defect-fix rates rise with task size, and the in-pipeline lens was rarely finding anything on the mini model. The evidence is thin (one replay that found the serious misses, one that found nothing), so this is a bounded bet. The `docs/BACKLOG.md` entry tracks the re-measurement.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Only `dist/orchestrator/run-task.js` changes on rebuild. `dist/cli/index.js` rebuilds byte-identical because it has no `codexMatrix` cells. This is why it is not in the diff.
- The new full-model cells run at `high` effort. `xhigh` was considered and rejected on cost, since the motivating replay ran at `high`.
- Cost: an L, XL, or delicate task now gets a full-model cold review, and so does a small task bundled with one of them. The `[Unreleased]` changelog bullet says so.
- Adopters who set `CODEX_MODEL_FULL` to an expensive model will see it on the cold lens at L/XL too.
- Nits left open from review: the `CODEX_MODEL_MINI` purpose text, the changelog's omission of the `CODEX_MODEL_DELICATE` fallback, and some curly apostrophes in new doc text. These are non-blocking.
- The live model check from the spec's human test plan (a real L, M, and delicate run, reading the model from the invocation log) has not been run yet.

Judgment calls:

- Effort for the new full-model cells is `high`, not `xhigh`. I chose `high` to match XL `spec_review` and `implement` and to avoid the roughly 1.5–2× cost of `xhigh`. That was not explicitly confirmed during spec review.
- Rollback is "install the previous release" rather than a new `CODEX_MODEL_REVIEW` override. A new env var would add surface with its own docs and tests, so I parked that idea in `docs/BACKLOG.md`. That was not explicitly confirmed during spec review.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
