# PR Body: support-node-26 - Support Node 26 alongside Node 24

## Summary

- Declare Node 26 as a supported runtime next to Node 24: `engines.node` is `24.x || 26.x` in `package.json` and the `package-lock.json` root entry.
- `canon doctor`'s Node check passes on 24 and 26, warns on other majors from 24 up (25, 27, 28+), and still fails below 24. The supported-majors list is one exported constant, and a unit test keeps it equal to the `engines` majors.
- CI runs the test shards on Node 24.x and 26.x: six jobs named `test (node N, shard M/3)`. `checks`, `auto-release` and `docs-refs-check` stay on 24.x.
- The test-only `.md` prompt loader moves from `module.register()` to `module.registerHooks()`, which removes the Node 26 `DEP0205` warning.
- README, CONTRIBUTING, AGENTS.md, `docs/architecture.md` and `docs/release-process.md` now name both majors and the new job names.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (Node 24.21.0 and 26.13.0: 2,147 passed, 0 failed, 1 sandbox skip; zero `DEP0205` lines on 26)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt and committed `dist/cli/index.js`; a second build is byte-identical)

## Notes

<!--
Anything reviewers should know that isn't obvious from the diff — behavior
changes that don't show up in tests, follow-up tasks already filed, risk
callouts, manual verification steps run. Optional.
-->

- **Ruleset swap before merge.** The `main` ruleset still requires the three old `test (shard N/3)` checks, which this PR no longer reports. Once the six new `test (node …)` jobs are green on this PR, the three old names need to be replaced with the six new ones in the branch ruleset, keeping `checks` required. Other open PRs need to rebase onto `main` to pick up the new names.
- **Node 26 on Linux is first exercised by this PR's CI.** Local runs were on macOS. The new Node 26 shards are the first Linux run on that version.
- **Sandbox skip.** `REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree` skips in restricted worktrees because it needs `.git/` writes. It skipped on both Node runs and passed nothing new.

Judgment calls (not explicitly confirmed during spec review):

- I wrote the `engines` range as `24.x || 26.x`, which lists exactly what CI tests. `>=24` would claim support for Node 28+ before anything has run on it.
- I kept the build floor at tsup `node24` and `@types/node` `^24`, so 26-only APIs can't type-check and then break on 24.
- The doctor fail threshold is a literal 24, separate from the supported-majors constant. Dropping 24 later should be a deliberate change to the build target, types and doctor together.
- The drift test reads `package.json` through `process.cwd()`, not the repo-root constant, so it checks the checkout the suite runs in.
