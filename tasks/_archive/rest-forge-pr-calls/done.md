# Completion Summary: rest-forge-pr-calls — Route --pr / --ship GitHub calls through REST

> For the human. This is what you need to know.

## What Changed

canon's `--pr`, `--full-send` and `--ship` now reach GitHub through its REST API, called via `gh api`, instead of the `gh pr …` and `gh repo view` commands, which run on GitHub's GraphQL API. In environments where GraphQL is blocked (a Claude Code cloud session is one), `--pr` used to push the branch and then fail at PR creation, and `--ship` used to stop in its pre-flight check even when the PR had been merged by hand. Both now work there, and they behave the same in ordinary environments. A new forge module owns every GitHub call that canon makes. The PR-merge guard hook now looks up a PR's head over REST too, so its block on `gh pr merge` of task PRs works where GraphQL is blocked; before, it failed open silently. The API host comes from the `origin` remote's host and is passed only when `gh` is logged in to it. The #184 text fixes are in: the doctor and init hints say gh is needed for `--pr` and `--ship` (not `--push`), and `canon run --help` lists the docs-refs check among the checks `--force` skips at `--pr` and `--push`.

## Files Changed

- `src/orchestrator/forge.ts` — new module: REST PR create, paginated exact-head branch lookup, PR read, merge, allowed-merge-method read, host selection, commit-subject body fallback.
- `src/orchestrator/main.ts` — calls the forge module; no direct `gh` calls remain; proof and recovery wording updated.
- `src/orchestrator/cli.ts` — `--force` help lists the docs-refs check at `--pr`/`--push`.
- `src/cli/commands/doctor.ts` — gh hint: required for `--pr` / `--ship`.
- `src/cli/deps.ts` — init soft-dependency gh hint: required for `--pr` / `--ship`.
- `.claude/hooks/canon-guard.mjs` and `templates/.claude/hooks/canon-guard.mjs` — PR-head lookup over REST; origin-host gating; `-R` and PR-URL parsing; mirror kept identical.
- `.claude/skills/canon-pipeline/SKILL.md` and `templates/.claude/skills/canon-pipeline/SKILL.md` — PR creation described as REST.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — REST PR operations, merge-settings wording, body-resolution order ending in the commit-subject fallback.
- `docs/patterns.md` — merge-outcome and merge-confirmation entries name the per-PR REST read and the forge module.
- `docs/codebase-map.md` — forge module row.
- `dist/cli/index.js` and `dist/orchestrator/run-task.js` — rebuilt bundles.
- Tests: `tests/forge-rest.test.ts` (new), `tests/canon-guard.test.ts`, `tests/run-task-safety-helpers.ts`, `tests/run-task-ship-helpers.ts`, `tests/run-task-safety-worktrees-pr.test.ts`, `tests/run-task-safety-scaffold-push.test.ts`, `tests/run-task-ship-docs-fold.test.ts`, `tests/run-task-ship-proof.test.ts`.

## How to Test

1. In an environment where GitHub's GraphQL API is blocked but its REST API works (for example a Claude Code cloud session, where `gh pr list` fails with a GraphQL 403), run a small task with `canon run <id> --pr`.
   Expected: the branch pushes and a draft pull request opens, with the QA-written description. If no description source exists, the body lists the branch's commit subjects.
2. Mark the pull request ready for review and merge it by hand, or let the task reach its merge step.
3. Run `canon run <id> --ship`.
   Expected: the pull request is merged with the configured merge method, the task is archived, and its working copy is cleaned up, with no GitHub API errors.
4. Repeat steps 1–3 in an ordinary environment.
   Expected: the same results.
5. Run `canon doctor`.
   Expected: the GitHub CLI hint says gh is needed for opening and shipping pull requests, not for pushing.
6. In a task session, have the agent try to merge a task pull request with `gh pr merge <number>`.
   Expected: the guard blocks it and points to `canon run <id> --ship`. This also holds when GraphQL is blocked.

## Test Results

These are the implementer's recorded results from the latest validation table in `tasks/rest-forge-pr-calls/handoff.md` (Iteration 4, Amendment Round 2). QA did not re-run them.

| Check | Result | Notes |
|---|---|---|
| Lint | Pass | |
| Type-check | Pass | |
| Unit tests (`npm test`) | Pass | 2,317 passed, 0 failed, 1 skipped in the handoff run. The final code review's anchored lens reported 2,319 passed on commit `d2fc137`. The counts differ and were not reconciled. |
| Build | Pass | Rebuilt both declared `dist/` bundles. |
| `npm run sync-templates:check` | Pass | Guard mirror in sync. |
| `npm run docs-refs-check` | Pass | |
| `git diff --check` | Pass | |
| E2E | Skipped | The spec records no E2E suite in canon (N/A). |
| Red-first (AC-8, AC-15, AC-17) | Recorded | Pre-fix failures against the base commit and the earlier amendment commit are in the handoff's Red-First Evidence. |
| Live GitHub run (spec Human Test Plan) | Not run | See Human Verification Required. |

## Human Verification Required

None.

Handoff pre-merge checklist. QA cannot confirm these items:
- [ ] Version correct: not decided here. The release step picks the bump tier.
- [ ] Changelog updated: not yet. The draft entry is in Proposed Changelog.
- [ ] PR body current: drafted in `tasks/rest-forge-pr-calls/pr-body.md`. Re-check the PR after `--pr` opens it.
- [ ] Final CI/CD checks green: not visible from this session.
- [ ] Final diff matches spec intent: reviewed by the automated code-review lenses only. A human has not checked it.

The spec's Human Test Plan (steps 1–6, against live GitHub in a GraphQL-blocked environment) has not been run. The fake-`gh` tests cover these flows, but they cannot check real `gh api` flags.

## Proposed Changelog

- **`--pr`, `--full-send` and `--ship` work where GitHub's GraphQL API is blocked.** canon now calls GitHub's REST API through `gh api` for draft PR creation, the branch lookup, the merge and its merge proof. Before this, `--pr` failed at PR creation and `--ship` stopped in its pre-flight check in those environments, even when the PR had been merged by hand.
- **The merge guard works where GraphQL is blocked.** The guard hook reads a PR's head over REST, so its block on `gh pr merge` of task PRs still applies there, instead of failing open silently.
- **The draft PR body falls back to the branch's commit subjects.** When there is no canon body, QA body or PR template, the body lists the branch's commits instead of using `gh pr create --fill`.
- **Corrected gh requirement text.** `canon doctor` and `canon init` say gh is needed for `--pr` and `--ship`, not `--push`. `canon run --help` lists the docs-refs check among the checks `--force` skips at `--pr` and `--push`.

## Judgment Calls to Confirm

These spec rows were marked `Author` in the spec's Judgment Calls table. None was explicitly confirmed during spec review.

- REST always vs fallback — chose always REST; alternative: porcelain first, REST fallback on a GraphQL error.
- Repo addressing — chose gh's `{owner}/{repo}` placeholders; alternative: parse the slug from `origin`.
- `--fill` replacement — chose the branch's commit subjects (`origin/<base>..<branch>`) when no other body exists; alternative: an empty body.
- Size and delicate — chose M, not delicate; alternative: delicate, because the merge proof gates branch deletion and archive.
- Guard hook in scope — chose fixing the guard's PR-head lookup in this task; alternative: a separate follow-up task.
- Guard ref forms — chose number or `#<n>` via REST read, PR URL via the URL's host and repo, `<owner>:<branch>` as the branch, and any other ref as its own head; alternative: list PRs for a branch ref over REST.
- #184 scope — chose the two text fixes only; alternative: also change which flags require gh.
- API host source (Amendment Round 1) — chose the `origin` host, passed as `--hostname`; alternative: also derive owner and repo from `origin` and drop the placeholders.
- Host gating (Amendment Round 2) — chose normalizing `*.github.com` to `github.com` and passing the host only when `gh auth token --hostname` succeeds; alternative: resolve SSH aliases with `ssh -G`. Known risk: an Enterprise origin written as an SSH alias, with gh logged in to several hosts, falls back to gh's default host. The workaround is `GH_HOST`.

## Decisions Made

- **Auth probe before API calls.** The forge and the guard run `gh auth token --hostname <host>` and discard its output. This is a narrow exception to AC-1's "always passes `api` first" wording, which Amendment Round 2 requires. The probe reads only the exit status, and successful and failed probes are cached per process.
- **Owner-qualified branch filter.** The PR head filter percent-encodes the separator (`{owner}%3A<branch>`). gh expands the legacy `:owner`, `:repo` and `:branch` placeholders inside query strings, so a branch such as `repo-x` broke the exact filter in review. The guard uses path endpoints and has no such filter.
- **Pagination without `--slurp`.** The branch lookup uses `gh api --paginate --jq '.[]'` and parses one JSON object per line, so it works on older gh versions. A successful empty listing counts as `none`. A failed or malformed listing counts as `unreadable`.
- **Draft PR payload.** The create call sends its JSON payload from a temp file via `--input`.
- **Guard `-R` handling.** A valid `-R OWNER/REPO` passes no `--hostname`, as gh does. An empty `-R` counts as absent and uses the cwd repo. A non-empty malformed `-R` skips the REST read and fails open, with no cwd fallback. An explicit host from `-R HOST/…` or a PR URL is normalized but not probed.
- **Draft PR body footer.** `tasks/rest-forge-pr-calls/pr-body.md` has no "Generated with Claude Code" footer, following the QA prompt's rule that the body reads as written by the engineer. The session's attribution instruction asks for that footer on pull requests this session creates. Canon opens this PR with `--pr`, not this session. Confirm which rule applies before `--pr` runs.
- **No commits, no changelog edit.** QA did not commit anything and did not edit `CHANGELOG.md`.

## Open Questions

- Should `docs/decisions.md` gain an entry that canon's forge calls use REST through `gh api`? The spec's Docs Impact asks QA to consider it. QA did not add one, because a new decision is the human's call.
- Is the Amendment Round 2 known risk acceptable as written: an Enterprise origin written as an SSH alias, with gh logged in to several hosts, falls back to gh's default host? The spec's workaround is `GH_HOST`. The docs do not mention it yet (see the nit on `docs/pipeline-orchestrator.md` in Follow-ups).

## Follow-ups

| Category | Follow-up | Tracked |
|---|---|---|
| scope | `src/orchestrator/main.ts` keeps the github.com-only fallback (`parseOriginRepoSlug`) when a REST PR read fails for an Enterprise host. The handoff recorded it as a follow-up candidate; host changes were scoped to the forge and guard. | #198 |
| scope | The guard's `GH_REPO` / `GH_HOST` command-prefix handling. The spec records it as a Non-Goal that predates this task. | #197 |
| risk | The guard does not block `gh api -X PUT …/pulls/<n>/merge`, so a task PR can still be merged that way. This bypass exists today. The spec's Non-Goals say to track it as a follow-up. | #197 |
| scope | The README gh install note says gh is needed for `--pr` and `--ship` and not for `--push`. The CLI still requires gh for `--push`. The gating is a Non-Goal, so the operator should fix the note or the gate. | #198 |
| nit | Guard: the PR-URL regex is case-sensitive, so `gh pr merge HTTPS://github.com/o/r/pull/12` fails open. The `-R` parsing is case-insensitive. Add the `i` flag and strip a `:port` before `--hostname` (round-1 N1). | #197 |
| nit | `.claude/hooks/canon-guard.mjs` comment "Mirrors parseRemoteHost in canon-ai's forge module" sits above `normaliseGhHost` and points adopters at canon-ai source they cannot open (round-1 N2). | #197 |
| nit | Same guard comment, "mirrors canon's forge behavior", overstates the match because the forge also gates on gh auth (round-2 R2-N4). | #197 |
| nit | `src/orchestrator/main.ts` `reportOrCreatePR` discards the created PR number and re-lists PRs. If the re-list fails, canon dies even though it has the number (round-1 N3). | #198 |
| nit | `src/orchestrator/main.ts` `establishMergeProof` makes separate reads for the same PR. Immutable fields could share one read; merge state must stay fresh (round-1 N4). | #198 |
| nit | `tasks/rest-forge-pr-calls/spec.md` AC-1 still says every gh call "always passes `api` as the first argument". Amendment Round 2 overrides it. Note the stale wording (round-1 N5). | dropped |
| nit | `tasks/rest-forge-pr-calls/handoff.md` has duplicate "Iteration 2" headings and no Iteration 3 section, so the chronology is out of order (round-1 N6, round-2 R2-N1). | dropped |
| nit | `tests/forge-rest.test.ts` "two pages" test name overstates what it covers (round-1 N7). | #198 |
| nit | `src/orchestrator/forge.ts`: when the listing call fails with stderr, the `unreadable` reason is raw gh stderr with no "GitHub REST pull-request listing" prefix (round-1 N8). | #198 |
| nit | `src/orchestrator/main.ts`: some reflowed comments are very long or start lowercase, and the `findMergedPRNumber` comment still cites the gh porcelain issue (round-1 N9). | #198 |
| nit | `docs/pipeline-orchestrator.md` REST statement could say how the API host is chosen and mention the `GH_HOST` workaround for SSH-alias Enterprise origins (round-1 N10). | #198 |
| nit | `tests/forge-rest.test.ts` fake returns the match for any endpoint; a comment saying the argv assertion is what pins the regression would help (round-2 R2-N2). | #198 |
| nit | `tests/forge-rest.test.ts` should name gh's `:owner\|:repo\|:branch` placeholder pattern in a comment, because the stub cannot prove real gh leaves `{owner}%3A` alone (round-2 R2-N3). | #198 |
| nit | Earlier review round (`tasks/rest-forge-pr-calls/review-prior-2.md`, reviewed at `389251c`; not re-listed in the final round): a successful empty listing now maps to `none`. Record the change of meaning in the handoff, or use a sentinel filter. | #198 |
| nit | Earlier review round: with `GH_FORCE_TTY` or `CLICOLOR_FORCE` set, gh prints multi-line colored JSON, so every listing becomes `unreadable`. This fails closed. Clear those variables or set `NO_COLOR=1` in the forge runner. | #198 |
| nit | Earlier review round: forge test fixtures include `[]` and a raw scalar that real gh does not print, and the malformed-line and `{}`-line parse paths are untested. | #198 |
| nit | Earlier review round: the merge-fail-but-merged test sets every per-PR read to MERGED, so it shows a GET follows the PUT but not that the post-failure read caused the outcome. | #198 |
| nit | Earlier review round: `object()` is checked twice in the forge listing parser, and the `!entry` guard is redundant. | #198 |
| observation | The fake-`gh` tests cannot validate real `gh api` flags (spec Known Risk). A scheduled or manual live check against gh 2.89 or newer would catch a wrong flag before users do. | #198 |

## Quality Log

- Spec verdict: approved
- Human reroute?: Yes
- Dropped ACs: 2
- Validation gaps: 0
- Notes: Two code_review spec_gap halts were answered with spec amendments and reroutes (SG1 host rule, Round 1 host and -R handling). Dropped ACs were AC-4 (head filter, F1) and AC-6 (merge-fail-but-merged test, C1). All 17 ACs were Met in the final code review.

## Root Cause

- context-missing: The spec assumed `gh api` resolves the API host the same way `gh pr` does. With an Enterprise origin, `gh api` sent requests to github.com. Found in spec review and fixed by Amendment Round 1.
- spec-gap: The rule to pass the `origin` host as `--hostname` broke SSH host aliases and `ssh.github.com`. Found at code_review and fixed by Amendment Round 2 (SG1).
- spec-gap: The spec never defined how the guard parses `-R`. `.git` suffixes, scp-form and host-qualified values were mishandled. Found at code_review and fixed in Amendment Round 1.
- context-missing: The plan's live check did not cover gh's legacy `:owner` / `:repo` / `:branch` placeholders in query strings. A branch such as `repo-x` broke the exact head filter (F1, round 1).
- plan-error: The plan chose `--paginate --slurp` from a check on gh 2.89.0, which needs a newer gh than the floor. Round 1 changed it to `--paginate --jq` (C2).
- execution: The merge-fail-but-merged end-to-end test was missing (C1, AC-6).
- context-conflicting: AC-1's "always passes `api` first" conflicted with Amendment Round 2's `gh auth token` probe. Resolved in favor of the later amendment (Reroute 2).
- context-conflicting: After Amendment 1, the judgment calls and Known Risks still stated the old host-resolution claim. Spec review sent the spec back three times before it was approved with nits.
- execution: The first implement handoff had an unescaped pipe in its Self-Check row, which the pre-flight check rejected.

Maintenance: lessons-learned.md plus this task’s fragment have 18 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
