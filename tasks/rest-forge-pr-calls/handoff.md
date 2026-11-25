# Implementation Handoff: rest-forge-pr-calls

> Author: Codex | Spec: `tasks/rest-forge-pr-calls/spec.md` | Plan: `tasks/rest-forge-pr-calls/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.claude/hooks/canon-guard.mjs` | Normalize explicit GitHub subdomain hosts and gate cwd-origin hosts on `gh auth token`; keep explicit user-named hosts ungated. |
| `.claude/skills/canon-pipeline/SKILL.md` | Describe canon PR creation through REST. |
| `dist/cli/index.js` | Rebuilt CLI bundle from the updated sources. |
| `dist/orchestrator/run-task.js` | Rebuilt orchestrator bundle with REST forge calls and authenticated, normalized origin-host selection. |
| `docs/codebase-map.md` | Added the forge REST module row with a complete three-column table entry. |
| `docs/patterns.md` | Corrected merge helper locations and described REST merge confirmation. |
| `docs/pipeline-orchestrator.md` | Documented REST PR operations and neutral PR base/head field names. |
| `src/cli/commands/doctor.ts` | Corrected the gh requirement hint. |
| `src/cli/deps.ts` | Corrected the init soft-dependency gh hint. |
| `src/orchestrator/cli.ts` | Updated `--force` help text for the docs-refs check. |
| `src/orchestrator/forge.ts` | Normalize origin hosts, gate `--hostname` on `gh auth token`, cache the probe per process, and percent-encode the PR head filter separator to protect branch names from gh placeholder expansion. |
| `src/orchestrator/main.ts` | Routed forge operations through the REST module and updated proof/recovery wording. |
| `templates/.claude/hooks/canon-guard.mjs` | Synced the guard's host normalization and auth-gating changes. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced the REST PR description. |
| `templates/docs/pipeline-orchestrator.md` | Synced the REST and proof-field documentation. |
| `tests/canon-guard.test.ts` | Pinned cwd-origin auth gating, alias fallback, GitHub subdomain normalization, explicit host behavior, and token non-disclosure. |
| `tests/forge-rest.test.ts` | Pinned auth gating and normalized hostname argv across every forge operation, probe caching, token non-disclosure, and safe owner-qualified head-filter encoding. |
| `tests/run-task-safety-helpers.ts` | Made the REST fake tolerate `--hostname`. |
| `tests/run-task-safety-scaffold-push.test.ts` | Pinned the draft payload and commit-subject body for a custom task base. |
| `tests/run-task-safety-worktrees-pr.test.ts` | Pinned REST create payloads for canon, QA, and repository-template body sources. |
| `tests/run-task-ship-docs-fold.test.ts` | Pinned REST merge method and repository settings behavior. |
| `tests/run-task-ship-helpers.ts` | Made the ship REST fake tolerate `--hostname`. |
| `tests/run-task-ship-proof.test.ts` | Pinned REST merge-proof behavior. |

## Canon Governance

The task provenance remains in the task status artifact's `canon` object.

## Intent & Rationale

The forge adapter reads the `origin` URL, normalizes `github.com` subdomains, and passes a host as `--hostname` only when `gh auth token --hostname` succeeds. It leaves `{owner}/{repo}` placeholders intact so gh continues to resolve the repository slug using its base-repo selection. The guard applies the same gated rule to cwd lookups and normalizes explicit hosts from a repo override or PR URL without gating those user-named hosts.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Amendment Round 2 adds `gh auth token` before forge calls and cwd guard lookups. | Newest amendment explicitly requires this offline probe; it shares the sole `runCommand('gh'` runner, while all API calls still use `gh api`. | AC-1's literal “api first” wording has this narrow probe exception; see Interpretations. |

## Interpretations

- An empty or whitespace-only `-R` is treated as absent, so a numeric ref uses the cwd repo and its `origin` host. This follows AC-14's distinction between a non-empty invalid override and no override.
- A valid `-R OWNER/REPO` has no explicit host and omits `--hostname`, matching gh's default-host behavior. A valid `-R HOST/OWNER/REPO` or host-bearing URL supplies its own host.
- `github.com` and any `*.github.com` host normalize to `github.com`; other hosts are lowercased and preserved.
- Cwd-origin hosts are passed to gh only when `gh auth token --hostname <host>` exits successfully. Failed probes are cached too, for the process lifetime. The test runner and origin-reader seams clear that cache.
- Explicit hosts named by `-R` or a PR URL are normalized but not auth-gated, as Amendment Round 2 directs.
- The auth probe's stdout and stderr are discarded; no token output participates in API errors or lookup reasons.
- The accepted Amendment Round 2 risk remains: an Enterprise origin written as an SSH alias can fall back to gh's default host when gh is logged in to multiple hosts; setting `GH_HOST` is the documented workaround.

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-1 | Met | `src/orchestrator/forge.ts` is the only `runCommand('gh', ...)` caller and prepends `api`; `MERGE_FLAG` is absent and remaining porcelain strings are operator-facing recovery text. |
| AC-2 | Met | `src/orchestrator/main.ts` calls forge exports and contains no direct gh invocation. |
| AC-3 | Met | REST draft payload assertions cover canon body, QA body, repository template, and commit-subject fallback; custom base/head and `draft: true` are pinned. |
| AC-4 | Met | Paginated exact-head lookup percent-encodes the owner/branch separator so gh cannot expand branch prefixes as placeholders; base filtering, state classification, malformed/failure handling, and page-two matching are covered. |
| AC-5 | Met | REST PR reads provide state, head SHA, base ref, and URL; state mapping and exact read argv are pinned; ship proof scenarios passed. |
| AC-6 | Met | Tests pin REST merge calls for each configured `merge_method` and fresh per-PR merge confirmation. |
| AC-7 | Met | Tests cover REST `allow_*` fields, missing/malformed responses, and the no-open-PR skip. |
| AC-8 | Met | GraphQL-blocked PR creation and ship scenarios passed; pre-fix red runs are preserved below. |
| AC-9 | Met | Doctor, init, and `canon run --help` text reflect the corrected gh requirements and docs-refs bypass. |
| AC-10 | Met | Pipeline docs and mirrors, canon-pipeline skill and mirror, patterns, and codebase map describe REST behavior. |
| AC-11 | Met | `npm run build` completed and regenerated the declared `dist/` bundles. |
| AC-12 | Met | Guard REST lookup covers numbers, URLs, branch refs, explicit repos, supported suffixes, and fail-open lookup errors. |
| AC-13 | Met | Forge tests cover GitHub HTTPS, Enterprise scp, Enterprise SSH with port, absent origin, and an unparseable local-path origin; all five API operations receive the expected host argv. |
| AC-14 | Met | Guard tests pin HTTPS and scp origin hosts, absent-origin behavior, URL/scp/host-path `-R` forms, `.git` and slash cleanup, and no REST lookup for malformed non-empty overrides. The template mirror is synchronized. |
| AC-15 | Met | Forge and guard regression cases failed against pre-amendment code for the missing/wrong host or endpoint and passed after the fix; evidence follows. |
| AC-16 | Met | Forge and guard tests pin alias fallback, `ssh.github.com` normalization, logged-in and unauthenticated Enterprise origins, explicit-host normalization, probe caching, and token non-disclosure. |
| AC-17 | Met | Both AC-16 regression suites failed against pre-amendment HEAD `389251c` for incorrect/missing host gating and passed after implementation; red-first evidence is recorded below. |

## Edge Cases Considered

- Origin parsing accepts HTTP, HTTPS, SSH, and scp-style URLs; trims userinfo and ports; lowercases the host; and returns no host for malformed URLs or local paths.
- `-R` cleanup strips trailing slashes and `.git`; URL values with extra path segments or invalid owner/repo segments fail open without a read.
- Empty `-R` uses cwd-repo resolution, while malformed non-empty `-R` never triggers a cwd-repo read.
- The forge reads the origin URL for each API call, while caching the auth-probe result by normalized host for the process.

## Blockers and Follow-ups

- SG1 from review round 1 is resolved by Amendment Round 2's normalized, auth-gated host rule.
- Follow-up candidate: `src/orchestrator/main.ts` retains the pre-existing GitHub.com-only PR URL fallback when a REST PR read fails for an Enterprise host. This amendment scoped host changes to the forge and guard; the fallback was not changed.
- `GH_REPO` / `GH_HOST` command-prefix handling remains a stated Non-Goal.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-8 (`--pr`) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='main --pr on complete logs the pr-body fallback' tests/run-task-safety-worktrees-pr.test.ts` | `main` `c505f3785771bb4b3e2490ef492167ab06cd5f47`, with the REST fake/test copied into `/tmp/rest-forge-red-first-Utm6RA` | PR creation exited 1 on the GraphQL-blocked fake's HTTP 403. | Passed in the focused suites and full `npm test`. |
| AC-8 (`--ship`) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='proves pinned merged PR' tests/run-task-ship-proof.test.ts` | `main` `c505f3785771bb4b3e2490ef492167ab06cd5f47`, with the REST fake/test copied into the same scratch checkout | Ship pre-flight listing exited 1 on the fake's GraphQL HTTP 403. | Passed in the focused suites and full `npm test`. |
| AC-15 (AC-13 forge) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='parseRemoteHost|forge passes the parsed origin host' tests/forge-rest.test.ts` | Pre-amendment task HEAD `bd37a016250473774325de35dc34b3ac0c041024`, archived at `/tmp/rest-forge-ac13-red`; copied in the new test and added seam-only `setOriginUrlReaderForTest` and `parseRemoteHost` stubs. The stubbed `ghApi` ignored the origin reader. | 9 failed, 6 passed: supported remote hosts parsed as null and HTTPS/scp/SSH forge calls lacked `--hostname`; no-origin and malformed-origin cases retained their expected no-host behavior. | All forge tests passed after implementation, including exact argv for every API call. |
| AC-15 (AC-14 guard) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='task PR REST lookup follows origin host' tests/canon-guard.test.ts` | Pre-amendment task HEAD `bd37a016250473774325de35dc34b3ac0c041024`, archived at `/tmp/rest-forge-ac13-red` with only the new guard test copied in | 18 failed, 2 passed: origin host missing, `.git`/scp paths wrong, and malformed `-R` values reached the cwd lookup. | All guard cases passed after implementation, including endpoint and no-read assertions. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/forge-rest.test.ts` pins the exact auth probe and API argv for every forge operation across logged-in, unknown-host, alias, GitHub-subdomain, and Enterprise cases; it asserts one cached probe and that the fake token appears in no result or captured console output. `tests/canon-guard.test.ts` pins exact probe/API log sequences for cwd origins and explicit `-R`/URL hosts and asserts the token is absent from returned results and logs. Both suites failed against HEAD `389251c` on the wrong/missing host behavior, then passed after the fix. Original REST creation, pagination, merge state, and ship-proof assertions remain in the affected suites. |
| Restatement sweep | Searched `src/`, `.claude/hooks/`, `templates/.claude/hooks/`, `tests/`, and docs for `--hostname`, `gh auth token`, `github.com`, `origin host`, and the prior literal-host phrasing. Forge and guard use the same normalization predicate; the guard template is synchronized. No additional doc claims a different host rule. `rg -n "runCommand\\('gh'" src` returns only the runner in `src/orchestrator/forge.ts`; recovery hints remain intentional. |
| Sibling parity | All five forge API operations use `ghApi` and therefore share normalized host gating and the process cache. The guard cwd fallback probes and gates, while explicit `-R` and PR URL hosts normalize without probing, matching the spec. Tests cover both forms and the template mirror is synchronized. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 2,317 passed, 0 failed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/orchestrator/run-task.js`. |
| `npm run sync-templates:check` | Pass | All managed mirrors are synchronized. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `git diff --check` | Pass | No whitespace errors. |

## Iteration 2 — addressing review round 1

### Findings Addressed

| Finding | Resolution |
|---|---|
| F1 — gh expands legacy placeholders inside the query filter | Encoded the separator between `{owner}` and the branch as `%3A`, and stopped decoding `%3A` in `encodeQuery`. This keeps names such as `repo-x` and `branch/foo` intact while the request reaches GitHub as the owner-qualified `head` filter. Added an exact argv regression assertion for `repo-x`. |
| N2 — adopter-facing guard comment referred to canon-ai's forge module | Reworded and repositioned the comment in `.claude/hooks/canon-guard.mjs`; synchronized `templates/.claude/hooks/canon-guard.mjs`. |
| N7 — pagination test name overstated its fake | Renamed the test to describe that it parses paginated NDJSON and filters the exact head/base. |
| N6 — missing iteration-scoped Self-Check | Added this iteration's Self-Check below; it records whole-branch evidence for the changed rows. |

### AC Delta

| AC | Update |
|---|---|
| AC-4 | Owner-qualified head filters preserve the literal branch when its first word matches a gh legacy placeholder. The new test pins the encoded endpoint and matching PR result. |

### Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/forge-rest.test.ts` now asserts the exact request endpoint `head={owner}%3Arepo-x`; reverting the encoding or restoring `%3A` decoding makes the assertion fail. It also checks the exact task branch query and paginated NDJSON behavior. Earlier forge/guard tests continue to pin AC-1–AC-17 host, merge, create, and proof behavior; the previous AC-17 red-first rows remain in the handoff. The four affected suites passed 209/209. |
| Restatement sweep | Searched `src`, `tests`, `docs`, `templates`, and `.claude` for `head={owner}:`, `head={owner}%3A`, `head={owner}`, and `encodeQuery(branch)`. The runtime and tests now use the encoded separator; no stale raw-colon query restatement remains. Checked the shipped guard comment and its template mirror: both describe the standalone host-resolution helper without directing adopters to canon-ai source. No out-of-scope restatement required edits. |
| Sibling parity | `lookupPRByBranch` is shared by `--pr` and `--ship`, so the encoded filter covers both. The guard constructs PR-number path endpoints and has no branch-name query filter; its mirror is synchronized. Forge integration and ship-proof suites passed. |

### Validation

| Check | Result | Notes |
|---|---|---|
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/forge-rest.test.ts tests/run-task-safety-worktrees-pr.test.ts tests/run-task-ship-proof.test.ts tests/run-task-ship-docs-fold.test.ts` | Pass | 209 passed, 0 failed. |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run build` | Pass | Rebuilt `dist/` after the forge change. |
| `npm run sync-templates:check` | Pass | Guard source and mirror are synchronized. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `git diff --check` | Pass | No whitespace errors. |

## Iteration 4 — Amendment Round 2

### AC Delta

| AC | Result | Evidence |
|---|---|---|
| AC-13 | Reconfirmed | Existing origin-host cases pass when gh auth recognizes the normalized host; all five forge API operations use that selection. |
| AC-16 | Met | `tests/forge-rest.test.ts` and `tests/canon-guard.test.ts` cover alias fallback, `ssh.github.com` and `api.github.com` normalization, Enterprise auth success/failure, and ungated explicit hosts. Both pin that probe tokens never appear in outputs or logs. |
| AC-17 | Met | The new forge and guard host-selection tests failed against current pre-amendment HEAD `389251c` for the specified incorrect host behavior; both passed after implementation. |

### Red-First Evidence

| AC | Command and pre-fix state | Observed failure against `389251c` | Post-fix result |
|---|---|---|---|
| AC-17 forge | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/forge-rest.test.ts`; only `tests/forge-rest.test.ts` had the new test changes. | 12 failures among 29 tests: no auth probe was issued; `github-work` was passed as `--hostname`, `ssh.github.com` and `api.github.com` were not normalized, and an unauthenticated Enterprise host was still passed. | 29 passed, 0 failed. |
| AC-17 guard | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/canon-guard.test.ts`; only the test and its fake gh shim had the new changes. | The cwd fallback made no auth probe and sent the literal SSH alias/subdomain or unauthenticated Enterprise host; explicit `api.github.com` hosts were not normalized. | 157 passed, 0 failed. |

### Interpretations

- Amendment Round 2's required `gh auth token --hostname` is a narrow exception to AC-1's “api first” wording. The probe uses the existing `runner` and sole `runCommand('gh'` call site; actual forge operations still call `gh api`.
- The forge caches both successful and failed host probes per normalized host for the process. Test setters clear the cache. The guard runs per hook invocation and does not cache.
- Probe stdout and stderr are discarded. A failed probe means no `--hostname`, leaving gh's default host or `GH_HOST` behavior in effect.

### Blockers

- SG1 is resolved by Amendment Round 2's normalized and authenticated host rule. No blockers remain for this task.

### Validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 2,317 passed, 0 failed, 1 skipped. |
| `npm run build` | Pass | Rebuilt both declared `dist/` bundles. |
| `npm run sync-templates:check` | Pass | Guard mirror synchronized. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates` | Pass | Synchronized the guard template mirror. |
| `rg -n "runCommand\('gh'" src` | Pass | Only `src/orchestrator/forge.ts` matched. |
| `rg -n 'gho_\\|auth token' src .claude/hooks` | Pass | Only the forge and guard probe call sites matched; probe output is discarded. |

## Ready for Review

- [x] All original and amended ACs are met; SG1 is resolved by Amendment Round 2.
- [x] Full validation matrix passed.
- [x] Red-first evidence covers AC-8, AC-15, and AC-17.
- [x] No blocking issues remain in the amended scope.

## Iteration 1 — addressing pre-flight rejection

### Pre-Flight Item Addressed

| Item | Resolution |
|---|---|
| Baseline `## Self-Check` Restatement sweep row had unescaped regex alternation pipes in its search expression, which split the Markdown table row into extra cells. | Repaired the baseline row in place using separate `rg -e` patterns, removing internal pipe characters; the row now has exactly two cells (`Check` and `Evidence`). No source or test changes were needed. |

### Validation

| Check | Result | Notes |
|---|---|---|
| `npm run docs-refs-check` | Pass | Re-run after repairing the handoff table. |
| `git diff --check` | Pass | No whitespace errors. |

## Iteration 2 — addressing review round 1

### Findings Addressed

| Finding | Resolution |
|---|---|
| C1 — missing AC-6 merge-fail-but-merged proof | Added an end-to-end `--ship` test asserting the failed `PUT`, a later per-number `GET`, the tolerated warning, and archive/branch cleanup. The existing merge-fail-not-merged test now also asserts a per-number `GET` after the failed `PUT`. |
| C2 — `--slurp` requires a recent gh version | Changed PR listing to `--paginate --jq '.[]'`; `src/orchestrator/forge.ts` parses one JSON result object per output line, and treats successful empty output as no matches. Updated both fake-gh helpers and exact argv/page-two tests to use newline-delimited results. |
| N1 — recovery text overstated the guard | Restored precise wording that the guard blocks `gh pr merge` of task PRs. |

### AC Delta

| AC | Update |
|---|---|
| AC-4 | Pagination no longer depends on `--slurp`; the exact argv assertion pins `--paginate --jq '.[]'`, and the forge fake returns a page-two match as newline-delimited JSON. |
| AC-6 | Both merge-failure outcomes now prove a fresh `GET repos/{owner}/{repo}/pulls/{n}` happens after the attempted merge; only the merged read-back proceeds to cleanup. |

### Blockers

- [spec-gap] SG1 remains open: Amendment 1's literal origin-host rule may break SSH host aliases and `ssh.github.com` normalization. The implementation still follows AC-13 as written; changing host resolution requires a human spec amendment.

### Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/forge-rest.test.ts` pins the `--paginate --jq .[]` argv and newline-delimited second-page match; reverting to `--slurp` fails the exact argv assertion and cannot parse that fixture. `tests/run-task-safety-worktrees-pr.test.ts` pins the updated listing argv. In `tests/run-task-ship-docs-fold.test.ts`, both merge-failure tests require a `/pulls/107` GET after the failed merge PUT; the merged case also requires the tolerated warning, successful command, and archive/branch cleanup. These assertions fail if the new proof read is removed or if failed merges are always treated as success/failure without the fresh state. The final affected-suite run passed all 249 tests. |
| Restatement sweep | Searched `src/`, `tests/`, `docs/`, and template surfaces for `--slurp`, `--jq`, `direct merges of task PRs`, and `gh pr merge`. Runtime listing and both fakes now use jq output; the only remaining `--slurp` mentions are explanatory spec text and its general flag-risk note, neither describes the implementation contract. The recovery hint now names the exact guarded command; other recovery hints remain intentional Non-Goals. No out-of-scope files needed edits. |
| Sibling parity | Checked `lookupPRByBranch` as the shared lookup for `--pr` and `--ship`, both REST fake helpers, the forge unit fake, and the merge-failure ship path. All listing fakes consume `--jq` and emit one object per result; both merge-failure outcomes assert the fresh per-number read, with cleanup allowed only after merged proof. |

### Validation

| Check | Result | Notes |
|---|---|---|
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/forge-rest.test.ts tests/run-task-ship-docs-fold.test.ts tests/run-task-ship-proof.test.ts tests/run-task-safety-worktrees-pr.test.ts tests/run-task-safety-scaffold-push.test.ts` | Pass | 249 passed, 0 failed. |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run build` | Pass | Regenerated `dist/cli/index.js` and `dist/orchestrator/run-task.js`. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `git diff --check` | Pass | No whitespace errors. |
