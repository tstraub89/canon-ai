## Summary

- Move the pipeline orchestrator (44 files under `scripts/run-task/`, plus its entry point and shared policy module) into `src/orchestrator/` and `src/lib/pipeline-policy.ts`, so shipped product code lives under `src/` like the rest of the codebase instead of being mixed into `scripts/` with dev tooling.
- Narrow `scripts/` down to the tooling that actually never ships (`docs-refs-check.mjs`, `install-git-hooks.mjs`, etc.), and narrow `package.json`'s `files` list to match — the published tarball no longer carries ~14k lines of raw orchestrator source that duplicated the compiled bundle.
- Sweep every reference to the old paths across docs, tests, build config, and gating scripts (~340 lines across 40+ files); rewrite two doc passages that would otherwise read as self-contradictory now that the orchestrator is a subset of `src/**` rather than a sibling of it.
- Fix two test-harness bugs this move exposed: one test resolved a repo-source path from the wrong git checkout in a linked worktree (silently loading stale code), and one leak guard silently scanned nothing because its target path didn't exist where it was looking.
- No behavior change anywhere — this is a pure relocation, verified with a byte-for-byte-behavioral rebuild.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Also ran and passing, since this touches build/packaging: `npm run sync-templates:check`, `npm pack --dry-run --json` (confirms the tarball only ships `scripts/install-git-hooks.mjs`, no raw orchestrator source), and a direct exec of both the standalone bundle and the CLI spawn path (`node dist/orchestrator/run-task.js --help`, `node dist/cli/index.js run --help`).
- Went through two code-review rounds. Round 1 caught the two test-harness bugs above (both fixed here) plus two small drift-risk nits (a stale comment reference, one backlog doc line left describing pre-move packaging behavior). Round 2 verified all fixes from scratch — full suite green with zero skips — and flagged one more latent instance of the same test-root-resolution pattern at a site this task's changes touch tangentially; fixing it here would have been a third round of narrowing on the same root, so it's called out as a follow-up task instead (normalize how tests resolve repo-source paths in a worktree, in one shared helper) rather than patched piecemeal.
- No changelog entry — this is an internal reorganization with no adopter-visible behavior change (see `docs/decisions.md` §"Versioning and release policy").
