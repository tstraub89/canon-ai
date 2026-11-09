# Completion Summary: support-node-26 — Support Node 26 alongside Node 24

> For the human. This is what you need to know.

## What Changed

canon-ai now declares Node 26 as a supported runtime next to Node 24. The `engines` range in `package.json` and the lockfile is `24.x || 26.x`, so installing canon on Node 26 no longer prints an unsupported-engine warning. `canon doctor` passes on Node 24 and 26, warns on any other major from 24 up (Node 25, 27, 28 and so on, which are untested or non-LTS), and still fails below 24. CI runs the test suite on both Node 24.x and 26.x, with six version-labelled test jobs. The lint, type-check, build-freshness and docs jobs stay on Node 24.x. The test-only `.md` prompt loader moved to `module.registerHooks()`, which removes the Node 26 `DEP0205` deprecation warning. The README, CONTRIBUTING, AGENTS.md, and architecture and release docs now describe both majors and the new job names.

Before this PR merges, a human must update the GitHub `main` branch ruleset. The old required test checks (`test (shard N/3)`) never report again after this lands, so the swap is a required human step (see Human Verification Required).

## Files Changed

- `package.json` — `engines.node` set to `24.x || 26.x`.
- `package-lock.json` — root `engines` regenerated with `npm install --package-lock-only`.
- `.github/workflows/ci.yml` — test job is a Node 24.x/26.x × shard 1–3 matrix with version-labelled names; `checks` stays on 24.x; required-check comments updated.
- `.github/dependabot.yml` — `@types/node` comment says the types track the `engines` floor.
- `src/cli/commands/doctor.ts` — exported `SUPPORTED_NODE_MAJORS`; `checkNodeVersion` takes an optional version (defaults to `process.version`) and returns pass, warn, or fail.
- `dist/cli/index.js` — rebuilt bundle for the doctor change.
- `tests/cli.test.ts` — host-dependent Node check test replaced by the seven-row verdict table; new drift test that compares `SUPPORTED_NODE_MAJORS` with the majors in `package.json` `engines`.
- `tests/md-loader-register.mjs` — `register()` replaced with `registerHooks({ load })`; `CANON_NO_DETACH` kept.
- `tests/md-loader-hooks.mjs` — `load` is now synchronous (`readFileSync`).
- `README.md` — three Node version statements updated.
- `CONTRIBUTING.md` — Node prerequisite updated.
- `AGENTS.md` — Commands line updated.
- `docs/architecture.md` — runtime, CI summary, cross-platform row, Jobs paragraph, test job description, and merge-gate check list updated.
- `docs/release-process.md` — required test jobs wording changed to six jobs across Node 24.x and 26.x.

## How to Test

1. On a machine with Node 24, run `canon doctor`. Expected: the Node line shows a checkmark and no failures.
2. On a machine with Node 26, install canon from this branch's build and run `canon doctor`. Expected: no unsupported-engine warning during install, and the Node line shows a checkmark.
3. If Node 25 is available, run `canon doctor` on it. Expected: the Node line shows a warning naming 24 and 26 as supported, and the summary still says canon should work.
4. On the PR, check the CI list. Expected: six test jobs (three labelled Node 24.x, three labelled Node 26.x) plus the `checks` job, all green.
5. Before merging, update the `main` ruleset as described in Human Verification Required.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` on Node 24.21.0 | Pass — 2,147 passed, 0 failed, 1 skipped (sandbox: `REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree`, because `.git/` writes are restricted in this worktree) |
| `npm test` on Node 26.13.0 | Pass — 2,147 passed, 0 failed, 1 skipped (same sandbox skip); `DEP0205` count 0 |
| Scoped Node-check tests on Node 24 and 26 | Pass (per handoff) |
| `node dist/cli/index.js doctor` on Node 24.21.0 and 26.13.0 | Pass — ✓ on the Node line, exit 0 on both |
| `npm run build` | Pass — second build left `dist/cli/index.js` byte-identical |
| Lockfile regeneration (`npm install --package-lock-only`) | Pass — second run left `package-lock.json` byte-identical |
| `npm run docs-refs-check` | Pass — `All refs OK` |
| E2E | deferred_by_spec — `tasks/support-node-26/spec.md` Validation Required: "N/A (no UI surface)" |

Not run by QA or implement: the Node 26 CI shards on Linux (they run only after `--pr`), Human Test Plan step 2 (install from a PR build on Node 26), and step 3 (Node 25 doctor run). The `REPO_ROOT` sandbox skip is unverified, not passing.

## Human Verification Required

- `[human_pending]` **GitHub `main` ruleset swap (required before `--ship`).** After CI reports the six new test jobs green on the PR, replace the three old required checks (`test (shard 1/3)`, `test (shard 2/3)`, `test (shard 3/3)`) with `test (node 24.x, shard 1/3)` through `test (node 26.x, shard 3/3)`. Keep `checks` required. Until this is done, the old names never report, so this PR and later PRs stall at "Expected — waiting". Other open PRs must rebase onto the new `main` to report the new names. Source: handoff.md Blockers. `--ship` uses plain `gh pr merge` with no admin bypass, so do this swap before running `--ship`.
- Node 26 CI shards on Linux: confirm all six test jobs report and pass on the PR. This is the first Linux run on Node 26.
- Human Test Plan steps 2 and 3 (Node 26 install from the PR build; Node 25 doctor warning). Not run.
- Handoff Validation pre-merge checklist:
  - [ ] Version correct — not decided; version and bump tier are set at the release step.
  - [ ] Changelog updated — pending the release step (see Proposed Changelog).
  - [ ] PR body current — `tasks/support-node-26/pr-body.md` is drafted; re-check after `--pr`.
  - [ ] Final CI/CD checks green — not yet observed.
  - [ ] Final diff matches spec intent — human review.

## Proposed Changelog

- Node 26 is now a supported runtime alongside Node 24. canon declares `24.x || 26.x` in its `engines` range, so installing on Node 26 no longer prints an unsupported-engine warning.
- `canon doctor` passes on Node 24 and 26. It warns on other Node majors from 24 up (such as 25 and 27), which are untested, and still fails below 24. A warning does not fail the run.

## Judgment Calls to Confirm

- **`engines` range form** — chose `24.x || 26.x`, which lists exactly what CI tests; alternative: `>=24`, which claims Node 28+ before anything has run on it.
- **Build floor** — kept tsup `target: 'node24'` and `@types/node` `^24`; alternative: bump `@types/node` to `^26`, which would let 26-only APIs type-check and then break on 24.
- **Doctor fail floor** — hard-coded at 24, tied to the build floor and separate from `SUPPORTED_NODE_MAJORS`; alternative: derive the floor from the supported-majors constant so one edit moves everything.
- **Doctor/engines drift guard** — a test asserts that `SUPPORTED_NODE_MAJORS` equals the majors in `package.json` `engines`; alternative: no guard, rely on review.

## Decisions Made

- The host-dependent Node check test is replaced by an injected-version table (AC-4), so no Node check test depends on the host's Node version.
- The loader keeps its file names (`tests/md-loader-register.mjs`, `tests/md-loader-hooks.mjs`), so the roughly 15 spawned-subprocess tests that pass `--import` to it need no change.
- The `docs/architecture.md` merge-gate paragraph was rewritten to name the six new checks. The sentence about repository admins bypassing the ruleset was removed in the same edit (a deviation from plan recorded in handoff.md). See Open Questions.
- Single-version jobs (`checks`, `auto-release`, `docs-refs-check`) stay on 24.x, as the spec's Judgment Call and AC-3 set.

## Open Questions

- **Admin-bypass sentence.** The code review (nit) flagged that the removed admin-bypass sentence in `docs/architecture.md` is still true, and that it explains why canon's direct pushes to `main` work. Should it be restored? The review also suggested trimming the one-time ruleset-migration sentence from the merge-gate paragraph after merge. Neither change was made in QA. Both are non-blocking.
- **Spec inconsistency.** Spec Judgment Call row 1 mentions an admin bypass, while Known Risks requires the human ruleset swap before merge. The implementation follows Known Risks. The spec was not edited.
- **Fail-detail literal.** The fail detail hard-codes `24+` separately from the build-floor constant. The review suggested a comment tying the two. Not changed.

## Root Cause

None.

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 1
- Notes: Node 26 CI shards and the main-ruleset swap are unverified until the PR runs; the linked-worktree REPO_ROOT test skipped on both Node runs.

Maintenance: lessons-learned.md plus this task’s fragment have 34 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
