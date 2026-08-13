[spec_review] `package-lock.json` exists in the repo, so the new devDependency in AC-9 needs a lockfile update or the spec stays out of scope.
[spec_review] The revised Docs Impact note should probably mention the repo docs that describe validation / file wiring, not just `CLAUDE.md`.
[spec_review] `verifyHandoffAgainstDiff()` runs in code_review preflight and checks the committed diff against the handoff Changes table, so any sync-added templates files need to be listed there or the reviewer gate will reject the handoff.
[implement] `scripts/docs-refs-check.mjs.d.ts` was the existing ambient `*.mjs` declaration site; I widened it so `tests/sync-canon-templates.test.ts` could import the new sync script without `unsafe-call` noise.
[implement] `npm install --package-lock-only --ignore-scripts` hit EPERM on `node_modules/.package-lock.json` in the worktree, so I generated `package-lock.json` in a temp copy and copied the npm-produced file back into the repo.
[implement-reroute] The canon-delimited sync boundary behaved correctly during the placement fix: `npm run sync-templates` removed the old templates-side convention text, while the new project-additions note stayed root-only.
[implement-revision] Review preflight is sensitive to stale iteration rows in `handoff.md`; if a file is no longer part of the current diff, the row needs to be removed from the revision section instead of being carried forward.
[implement-revision] Review preflight also keys off the baseline Changes table, not just the latest iteration block; if a file drops out of the committed diff, delete its baseline row too.

