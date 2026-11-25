# Spec: rest-forge-pr-calls — Route --pr / --ship GitHub calls through REST

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

GitHub issue #193 (and the text fixes from #184).

Canon's forge steps run `gh` porcelain commands, all through `splitGit.runCommand('gh', …)` in `src/orchestrator/main.ts`. Each of these runs on GitHub's **GraphQL** API:

| Operation | Today | Used by |
|---|---|---|
| Create draft PR | `gh pr create --draft --base --head --title` + `--body` / `--body-file` / `--fill` (`createDraftPRForTask`) | `--pr`, `--full-send` |
| Find PR by branch | `gh pr list --head <b> --state open\|merged\|closed --limit 1000 --json number,headRefName [--base]` (`lookupPRNumberExact`) | `--pr`, `--ship`, complete-state banner |
| PR fields | `gh pr view <n> --json url\|headRefOid\|state\|baseRefName --jq …` (`lookupPRUrl`, `getMergedPRHeadSha`, `isPRMerged`, `getPRBaseRefName`) | `--pr`, `--ship` merge proof |
| Merge | `gh pr merge <n> --squash\|--rebase\|--merge` (`MERGE_FLAG`) | `--ship` |
| Allowed merge methods | `gh repo view --json squashMergeAllowed,rebaseMergeAllowed,mergeCommitAllowed` (`MERGE_ALLOWED_FIELD`, `parseAllowedMergeMethods`) | `--ship` pre-flight |

Some environments allow GitHub's REST API but block `api.github.com/graphql`. A Claude Code cloud session is one example: there, `gh pr list` fails with `HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API`, while `gh api repos/{owner}/{repo}/…` succeeds. In those environments, `--pr` pushes the branch and then dies at PR creation, and `--ship` dies in its pre-flight ("could not read the open-PR listing"). That happens even when the PR was merged by hand, so archive, telemetry fold and worktree cleanup can't run. The run banner and `canon doctor` still say gh is fine.

**Confirmed (executed, this repository, 2026-11-25):**
- `gh pr list` returned the 403 above, and `gh api repos/{owner}/{repo}` succeeded.
- A session-local `gh` wrapper answered the five operations above over REST and passed everything else through. With it, `canon run --full-send` created draft PR #195 (`POST pulls`), and `--push` and `--ship` completed end to end. That included the pre-flight listing (`GET pulls?head=<owner>:<branch>&state=…`), merge settings (`GET repos/{owner}/{repo}`), the merge (`PUT pulls/195/merge`), and merge proof (`GET pulls/195`).
- A read-only probe showed that the REST `head` filter matches exactly: `<owner>:task/fix-codex-resume` returned 0 PRs, while `<owner>:task/fix-codex-resume-sandbox` returned 1.

**Sibling: the guard hook.** The canon-managed `.claude/hooks/canon-guard.mjs` blocks an agent's `gh pr merge` of a `task/<id>` PR (the agent should use `--ship`). It resolves the PR's head with `gh pr view <ref> [-R repo] --json headRefName` (`lookupPRHead`), which is GraphQL. The guard fails open on a failed lookup (`docs/decisions.md`), so in GraphQL-blocked environments it never blocks a merge given a PR number or URL. The safety check silently disappears in exactly the environments this task targets.

**#184 text fixes folded in:** the `canon doctor` and `canon init` gh hint says gh is "required for --pr / --push". `--push` never calls gh, and `--ship` does. The `canon run --help` `--force` list omits the docs-refs check at `--pr`/`--push`, which `--force` bypasses in `commitHumanReviewFiles`.

## Decision

Canon talks to GitHub for PR operations **only through `gh api` REST calls**, never through `gh pr …` or `gh repo view`. A new `src/orchestrator/forge.ts` module owns every forge call. `main.ts` calls the module, and the module's results keep the shapes and failure semantics callers rely on today:

- Create a draft PR (`POST repos/{owner}/{repo}/pulls`, draft). The body comes from the same sources as today: canon's PR body, the QA `pr-body.md`, the repo PR template, or a commit-log fallback in place of `--fill`.
- Find a PR by branch with an exact head match. The result stays three-way (`found` / `none` / `unreadable`), with the same base filtering, and covers every page of results.
- Read one PR by number: state (`OPEN` / `CLOSED` / `MERGED`, with merged meaning `merged_at` is set), head SHA, base ref, URL.
- Merge by number with the configured method (`PUT …/pulls/{n}/merge`, `merge_method`).
- Read the allowed merge methods from `GET repos/{owner}/{repo}` (`allow_squash_merge` / `allow_rebase_merge` / `allow_merge_commit`). Still fails closed when any of them is missing.

`--pr`, `--push`, `--full-send` and `--ship` behave exactly as today from the operator's view, except that they now work where GraphQL is blocked. The guard hook resolves a PR's head over REST too, so its merge block works in GraphQL-blocked environments. The #184 hint and help text is corrected.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| REST always vs fallback | Always REST | Porcelain first, REST fallback on a GraphQL error | One code path and one test surface. A fallback would recognise the proxy's 403 text, double the tested paths, and leave the GraphQL path untested in REST-only environments. `gh api` uses the same auth as porcelain; its host is set explicitly from `origin` (Amendment Round 1) | `Author` |
| Repo addressing | gh's `{owner}/{repo}` placeholders, resolved by `gh api` from the checkout's remote. They're used in the path and in the head filter (`head={owner}:<branch>`), so there's no separate owner lookup | Parse the slug from `git remote get-url origin` | The placeholders follow gh's own repo resolution, including `gh repo set-default`, which matches porcelain for the repo slug. The API host is not taken from it; see Amendment Round 1, which sets `--hostname` from `origin` | `Author` |
| `--fill` replacement | When no canon body, QA body or PR template is available, the body lists the branch's commit subjects (`origin/<base>..<branch>`, the remote base as `--fill` uses), one per line | Empty body | Closest to `--fill`'s commit-derived body. An empty body hides what the PR contains | `Author` |
| Size / delicate | M, not delicate | Delicate, because `--ship`'s merge proof gates branch deletion and archive | The merge-proof logic (which fields are compared, fail-closed rules, per-number confirmation) is unchanged; only its data source moves. AC-4 and AC-5 pin each mapped field. `docs/product-context.md`'s delicate list doesn't name forge calls | `Author` |
| Guard hook in scope | Fix the guard's PR-head lookup in this task | Separate follow-up task | Same root cause, and a sibling implementation; leaving it would ship a silently disabled safety check in exactly the environments this task targets. The change is one lookup function in a self-contained script. Moved into scope at the human's question | `Author` |
| Guard ref forms | Number or `#<n>` → `GET repos/<repo>/pulls/<n>` `head.ref`. A PR URL → the same read on the URL's host and repo (the URL wins over `-R`). `<owner>:<branch>` → the branch after the colon. Any other ref is a branch name and is its own head (no lookup). `-R`/`--repo` names the repo, and a `HOST/OWNER/REPO` value selects the host | List PRs for a branch ref over REST | `gh pr view <branch>` resolves the PR whose head is that branch, so the head is the ref itself. A lookup would add a call and a failure mode for the same answer | `Author` |
| #184 scope | Fix the two texts only (doctor/init hint, `--force` help list) | Also change which flags require gh (drop the `--push` gate, add a `--ship` gate) | Changing the gates is a behavior change with its own CLI tests; #184 asks for accurate text | `Author` |

## Non-Goals

- The guard hook does not start blocking `gh api -X PUT …/pulls/<n>/merge`. That bypass exists today; it's a new rule, not this lookup fix. Track it as a follow-up.
- The guard keeps failing open on a failed lookup (`docs/decisions.md`).
- No `canon doctor` GraphQL or REST probe. Always-REST makes one unnecessary.
- No change to which CLI flags require `gh` (`src/cli/deps.ts` gating).
- No merge-queue support. REST merge can't enqueue; canon's `--ship` already needs an immediate merge it can confirm.
- No draft → ready-for-review step. Canon never calls it today.
- No change to skills or operator prose that tells a human to run `gh` commands (e.g. the canon-pipeline skill's release steps).
- No change to recovery hint strings that suggest a `gh` command for the operator to run (e.g. "Verify the PR was merged: gh pr list …").
- No change to `docs/release-process.md` or `.github/workflows/`.

## Acceptance Criteria

- [ ] AC-1: No `src/` runtime code invokes gh porcelain PR or repo subcommands. Every `gh` call goes through one helper in `src/orchestrator/forge.ts` that always passes `api` as the first argument. A grep of `src/` for `runCommand('gh'` finds only that helper. The only remaining `pr create` / `pr list` / `pr view` / `pr merge` / `repo view` strings are human-facing recovery hints (Non-Goals). The branch lookup's `unreadable` reasons, which `--ship` prints, describe the REST listing, not `gh pr list`. Code comments that describe the old porcelain calls (the `lookupPRNumberExact` / `findOpenPRNumber` / merged-lookup blocks) are updated to the REST behavior. `MERGE_FLAG` (the `--squash`/`--rebase`/`--merge` flag map) no longer exists.
- [ ] AC-2: Every forge call lives in `src/orchestrator/forge.ts`. `main.ts` keeps no direct `runCommand('gh', …)` calls; it calls forge functions. Verify with grep.
- [ ] AC-3: **Create.** `--pr` and `--full-send` create a draft PR through `POST repos/{owner}/{repo}/pulls` with `draft=true`, the task branch as head, the task base as base, canon's title, and the body from (in order) canon's PR body, QA `pr-body.md`, the repo PR template, or a list of the branch's commit subjects. The existing "PR created" / reuse-existing-PR / wrong-base behavior and messages are unchanged, except two. "Draft PR created:" prints the new PR's URL (`html_url`). The body-fallback warning names the commit-subject fallback instead of `--fill`. The commit-subject fallback lists `origin/<base>..<branch>`. Verify with the updated `tests/run-task-safety-worktrees-pr.test.ts` and `tests/run-task-safety-scaffold-push.test.ts` cases, asserting the REST call and each body source, including the template case and the commit-subject case (body content pinned).
- [ ] AC-4: **Lookup.** The branch lookup lists PRs with an exact `head` filter (`{owner}:<branch>`) and, when given, a base filter. It covers every page. It still keeps only entries whose head branch equals the task branch. `merged` means `merged_at` is set; `closed` means closed and not merged. A failed or non-JSON response is `unreadable`, and `--ship`'s pre-flight still dies on `unreadable` with the existing message. Verify with ship pre-flight tests for found, none, unreadable (call fails) and malformed output, plus a forge test where the fake serves two pages and the only exact match is on page two.
- [ ] AC-5: **PR fields and merge proof.** A REST read of `pulls/{n}` supplies state, head SHA, base ref and URL. Merge state is always read fresh, never reused from a read made before the merge attempt. The state mapping is: open → `OPEN`, closed with `merged_at` → `MERGED`, else `CLOSED`. All `--ship` merge-proof outcomes are unchanged: pinned path, legacy path, wrong base, head mismatch, stale-remote recovery, and the URL fallback when the read fails. Verify that the existing `tests/run-task-ship-proof.test.ts` scenarios pass with the fake answering REST.
- [ ] AC-6: **Merge.** `--ship` merges through `PUT repos/{owner}/{repo}/pulls/{n}/merge` with `merge_method` set to the configured `ship.merge_method` (`squash` / `rebase` / `merge`). A failed merge call is still tolerated only when that same PR number reads back as merged. Verify by updating the per-method merge tests in `tests/run-task-ship-docs-fold.test.ts` to assert the REST call and method value, plus the merge-fail-but-merged and merge-fail-not-merged cases.
- [ ] AC-7: **Allowed methods.** The `--ship` pre-flight reads `allow_squash_merge`, `allow_rebase_merge` and `allow_merge_commit` from `GET repos/{owner}/{repo}`. It fails closed when the call fails or any of the three isn't a boolean, and it is skipped when there is no open PR, all as today. Verify with the updated `parseAllowedMergeMethods` unit test and the repo-view present/absent/fail/malformed ship tests.
- [ ] AC-8 (regression): a test runs `--pr` and `--ship` against a fake `gh` that fails every `pr …` and `repo view` invocation with `HTTP 403: GitHub GraphQL is not available` and answers only `gh api`. Both flows succeed. On the pre-change code this test fails at PR creation for `--pr` and at the pre-flight listing for `--ship`.
- [ ] AC-9: **#184 text.** The `canon doctor` gh hint (`src/cli/commands/doctor.ts`) and the `canon init` soft-dependency hint (`src/cli/deps.ts`) say gh is required for `--pr` / `--ship`, not `--pr` / `--push`. The `canon run --help` `--force` list (`src/orchestrator/cli.ts`) includes the docs-refs check at `--pr`/`--push`. Verify with grep, and update any test that pins the old strings.
- [ ] AC-10: **Docs.** `docs/pipeline-orchestrator.md` (and its `templates/docs/pipeline-orchestrator.md` mirror) no longer says `--ship` "checks `gh repo view`"; it describes reading the repository's merge settings. It states that canon's PR operations use GitHub's REST API through `gh api`. Its `--pr` body-resolution order ends in the commit-subject fallback instead of `--fill`, including the bundle sentence. The canon-pipeline skill's sentence that canon opens the draft PR "via `gh pr create`" describes canon's own behavior, so it is updated in both the root skill and its `templates/` mirror. `docs/patterns.md`'s merge-outcome and merge-confirmation entries (the `classifyMergeOutcome` / `isPRMerged` paragraphs) name the per-number REST read in place of `gh pr view <prNum> --json state`, and their canonical-implementation references point at the forge module where the function moved. `docs/codebase-map.md` gains a row for `src/orchestrator/forge.ts`. `npm run sync-templates:check` and `npm run docs-refs-check` pass.
- [ ] AC-11: The committed `dist/` matches a fresh `npm run build`.
- [ ] AC-12: **Guard hook.** `canon-guard.mjs` resolves the PR head for `gh pr merge <ref>` without gh porcelain. A numeric or `#<n>` ref reads `head.ref` from `GET repos/<repo>/pulls/<n>` (through `gh api`), using `-R`/`--repo` when given, else gh's `{owner}/{repo}`. A PR URL reads from the URL's host and repo (passing `--hostname` for a non-default host), and the URL wins over `-R`. An `<owner>:<branch>` ref resolves to the branch after the colon. Classification: a ref of all digits, or `#` followed by digits, is a number. A ref matching `http(s)://<host>/<owner>/<repo>/pull/<n>` is a URL. A ref containing `:` is `<owner>:<branch>`. Any other ref is a branch name and is treated as the head directly. A failed lookup still fails open. The root file and its `templates/.claude/hooks/canon-guard.mjs` mirror stay identical (`npm run sync-templates:check`). Verify with `tests/canon-guard.test.ts`: the fake gh answers only `gh api`, and porcelain `pr view` fails with the GraphQL 403. The guard blocks `gh pr merge <n>`, `gh pr merge '#<n>'`, `gh pr merge <url>`, `gh -R o/r pr merge <n>`, `gh pr merge owner:task/<id>` and `gh pr merge task/<id>` for task PRs, and allows non-task heads. It fails open when `gh api` fails. Existing `-R` forwarding assertions move to the REST path.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/forge.ts` | New module: REST create, branch lookup (paginated, exact head, three-way result), PR read, merge, allowed-methods read, commit-subject body fallback |
| `src/orchestrator/main.ts` | Replace direct `gh` calls and the gh field/flag maps with forge calls; keep caller contracts and messages |
| `src/orchestrator/cli.ts` | `--force` help lists the docs-refs check at `--pr`/`--push` |
| `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` | `lookupPRHead` reads `head.ref` over REST; branch refs resolve to themselves; mirror synced |
| `tests/canon-guard.test.ts` | Fake gh answers REST only; cover number, URL, `-R`, branch-ref and fail-open cases |
| `src/cli/commands/doctor.ts` | gh hint: required for `--pr` / `--ship` |
| `src/cli/deps.ts` | Soft-dependency gh hint: required for `--pr` / `--ship` |
| `tests/run-task-ship-helpers.ts` | Fake `gh` answers the REST calls (`gh api …`) from the same env/state knobs; porcelain PR/repo calls fail |
| `tests/run-task-safety-helpers.ts` | Same fake-`gh` change for the safety suites |
| `tests/run-task-ship-docs-fold.test.ts` | Merge-method and repo-settings assertions move to REST calls and field names |
| `tests/run-task-ship-proof.test.ts` | Assertions on gh calls move to REST (no-merge, no-repo-settings checks) |
| `tests/run-task-safety-worktrees-pr.test.ts` | PR create/list assertions move to REST; template-body case asserts the body content; the body-fallback warning assertion names the commit-subject fallback instead of `--fill` |
| `tests/run-task-safety-scaffold-push.test.ts` | PR create assertions (base, head) move to REST |
| `tests/run-task-safety-base-drift.test.ts` | Full-send PR-create failure path uses the REST fake |
| `tests/forge-rest.test.ts` | New: AC-8 GraphQL-blocked regression plus forge unit cases (state mapping, pagination, unreadable) |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Merge-settings wording; REST statement; body-resolution order ends in the commit-subject fallback |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | "opens a draft PR via `gh pr create`" describes canon's REST create |
| `docs/patterns.md` | Merge-outcome and merge-confirmation entries name the per-number REST read and the forge module |
| `docs/codebase-map.md` | Add the forge module row |
| `dist/` | Rebuilt bundles: `dist/orchestrator/run-task.js` and `dist/cli/index.js` both include touched code |

Other test files that set up the fake (`tests/run-task-safety-routing.test.ts`, `tests/run-task-safety-staging.test.ts`, `tests/run-task-codex-config.test.ts`, `tests/cli.test.ts`, `tests/agent-backend.test.ts`) need changes only if they assert gh argv. If one does, the implementer adds it and records it as a deviation.

### Implementation Notes (non-binding)

- `gh api --paginate` with `--slurp` (or a jq flatten) replaces `--limit 1000`. The lookup can pass `state=all` or `closed` and filter `merged_at` in code.
- `GET pulls/{n}` returns every field the three `pr view` helpers read. Don't cache state across the merge: `isPRMerged` after a failed merge and the post-merge proof must re-read. Caching immutable fields (base, URL) is fine.
- The create response has `number` and `html_url`. The existing re-list after create can stay, to keep the "die if not found" contract.
- `gh api` field flags: `-f` sends a raw string and never reads files; `-F` reads `@<file>` and types `true`/numbers. Send the body with `-F body=@<file>` (or `--input` with a JSON payload) and the draft flag as `-F draft=true`. Any `-f`/`-F` switches the method to POST unless `-X` is given, so list and read calls pass `-X GET` explicitly. `--paginate --slurp` returns an array of pages to flatten (gh 2.89.0 here supports both).
- `runCommand` runs in REPO_ROOT. gh resolves `{owner}/{repo}` from that checkout's remotes, the same way porcelain does today.

### Interaction Dependencies

- The `--ship` ordering (pre-flight listing → allowed methods → head prefetch → merge → proof → cleanup) is unchanged; only each step's data source moves.
- The complete-state banner and full-send summary print the PR URL through the forge read, with the existing origin-slug fallback.
- The guard hook runs in the agent's Bash tool context, not the orchestrator. It can't import the forge module (it's a standalone shipped script), so it carries its own small REST lookup.

### Data Model Changes

None. The `.pr-number` sidecar and `status.json` are unchanged.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`. Run the full suite; a check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`; the committed `dist/` matches a fresh build
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

E2E: N/A. canon has no end-to-end suite; Problem records the live run against PR #195.

## Docs Impact

- `docs/pipeline-orchestrator.md`, `docs/patterns.md`, `docs/codebase-map.md`: edited (Affected Files).
- `docs/architecture.md`: lists gh as a driven CLI; still accurate.
- `docs/decisions.md`: the guard-hook entry ("fails open on failed lookups") is still accurate. `docs/codebase-map.md`'s guard-hook row: QA checks it still reads correctly. QA should consider whether a decision entry for "forge calls use REST" belongs there.
- README: the gh install note ("needed for `--pr` and `--ship`; not for `--push`") already disagrees with the CLI gate, which still requires gh for `--push`. That mismatch predates this task and is left as is, since the gating is a Non-Goal; QA should log it as a follow-up.

## Known Risks

- **Merge-proof regression** is the highest-stakes risk, because `--ship` deletes the remote branch and removes the worktree on a positive proof. A wrong state mapping (for example treating `closed` as merged) would delete an unmerged branch. Mitigation: AC-5 runs every existing merge-proof scenario against the REST fake, and the forge unit tests pin the state mapping for open, closed-unmerged and closed-merged.
- **Head filter owner.** The REST `head` filter needs the head repo's owner. Canon pushes task branches to origin, so the owner of `{owner}/{repo}` is correct. A PR opened from a fork wouldn't match, the same as today.
- **Pagination.** A single page caps at 100. Without pagination, a repo with many PRs for the same branch name could miss the exact match `--limit 1000` covers today. AC-4 covers this.
- **Missing merge-settings fields for low-permission tokens.** If GitHub omits the `allow_*` fields for a token, `--ship` fails closed with the existing message, the same as a malformed gh response today. This is observed with admin permission only.
- **A fake gh can't validate real `gh api` flags.** Every automated test runs against an argv-matching fake, so a wrong flag (`-f` vs `-F`, a missing `-X GET`, unflattened `--slurp` output) could pass tests and fail live. Mitigations: the Implementation Notes pin the flag rules, forge unit tests assert the exact argv for each call, and the Human Test Plan runs `--pr` and `--ship` against real GitHub in a GraphQL-blocked environment.
- **Guard false negatives.** If the guard's REST read fails (auth, network, wrong repo), it fails open, as today. AC-12's fail-open case pins that this stays the behavior, rather than the guard blocking every merge.
- **Multiple remotes.** gh's `{owner}/{repo}` follows `gh repo set-default` for the repo slug, as porcelain does today. The host comes from `origin` (Amendment Round 1); a `set-default` repo on a different host than `origin` is unsupported.

## Human Test Plan

1. In an environment where GitHub's GraphQL API is blocked but REST works (for example a Claude Code cloud session), run a small task through the pipeline and open its pull request.
2. Expected: the draft pull request opens with the QA-written description.
3. Mark it ready, then ship the task.
4. Expected: the pull request is merged with the configured method, the task is archived, and its working copy is cleaned up, with no GitHub API errors.
5. Repeat steps 1–4 in an ordinary environment. Expected: the same results.
6. Run the environment check. Expected: the GitHub CLI hint says it is needed for opening and shipping pull requests.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row, each with a specific change description
- [x] Plan steps (fast tier) reference actual function/file names from the codebase (N/A: full tier)
- [x] If this spec replaces existing behavior: framed as one replacement with grep ACs (AC-1, AC-2)
- [x] Non-Goals rules out the most tempting scope expansions; load-bearing exclusions backed by AC-1/AC-2 scope
- [x] Symbols named in ACs actually exist in the codebase (grep-verified)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)

## Amendment Round 1 — API host follows `origin`; guard `-R` parsing (code_review round 2, S1 + N1)

**Why.** Code review found that the *Repo addressing* judgment call was wrong about the host. `gh api` fills `{owner}/{repo}` from gh's own base-repo resolution (remotes, `gh repo set-default`), the same as `gh pr`. It does **not** take the API host from that repo: `--hostname` defaults to `GH_HOST`, or to gh's default host (`github.com` when the user is logged in there). `gh pr` sends calls to the host of the resolved repo. So an adopter whose `origin` is a GitHub Enterprise host, and who is also logged in to `github.com`, would have every forge call sent to the wrong host. The guard's cwd fallback (`repos/{owner}/{repo}` with no `--hostname`) has the same flaw. Round 2 also found that the guard handles some `-R` values gh accepts badly, and falls back to the cwd repo when it can't parse one (N1).

**Confirmation (executed, gh 2.89.0).** In a throwaway repo whose `origin` is `https://ghe.example/o/r.git`, with gh logged in to both `github.com` and `ghe.example` (temp `GH_CONFIG_DIR`, `GH_DEBUG=api`):
- `gh api repos/{owner}/{repo}` logged `Request to https://api.github.com/repos/o/r`. The slug came from the Enterprise remote, but the request went to github.com.
- `gh pr view 1` logged `Request to https://ghe.example/api/graphql`, so porcelain follows the remote's host.

The mismatch is therefore real and deterministic.

**Trace of the guard `-R` handling** (current `lookupPRHead`, deterministic):
- `-R https://ghe.example/o/r.git` strips the scheme to `ghe.example/o/r.git`, which splits into 3 parts. The endpoint becomes `repos/o/r.git/pulls/12`, the wrong repo name.
- `-R git@ghe.example:o/r` has no `://` to strip. It splits on `/` into `['git@ghe.example:o','r']`, 2 parts, giving the endpoint `repos/git@ghe.example:o/r/pulls/12`.
- `-R a/b/c/d` gives 4 parts, which matches neither branch. It falls back to `repos/{owner}/{repo}` and so reads PR 12 of the local repo.

**Change to the Decision.** Every forge `gh api` call, and the guard's cwd-repo lookup, passes `--hostname <host>`, where `<host>` is the host of the `origin` remote URL. The `https://`/`http://`, `ssh://` and scp-style `user@host:owner/repo` forms are all accepted. Userinfo and port are dropped, and the host is lowercased. When `origin` is missing or its URL can't be parsed, no `--hostname` is passed (gh's default applies, as in the current code). `{owner}/{repo}` placeholders stay as they are.

**Superseded judgment calls.** The *REST always vs fallback* and *Repo addressing* rows, and the *Multiple remotes* risk, are edited in place so they no longer claim shared host resolution. The host decision is this row:

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| API host source | Host of `origin`, passed as `--hostname`; omitted when it can't be derived | Also derive owner/repo from `origin` and drop the placeholders | Canon pushes task branches to `origin`, so its host is the forge canon talks to. Keeping the placeholders preserves gh's `set-default` and fork resolution for the repo slug. Deriving the slug too would change which repo a fork-workflow PR targets | `Author` |

**Known Risks (*Multiple remotes*, as edited).** If `gh repo set-default` points at a repo on a different host from `origin`, the host follows `origin`. This combination isn't supported; canon pushes to `origin` in any case.

### Acceptance Criteria

- **AC-13 — forge host.** Every `gh api` argv the forge module builds carries `--hostname <origin host>` when `origin` parses. Forge unit tests pin the argv for each case:
  - an `https://github.com/o/r.git` origin → `--hostname github.com`;
  - a scp-form `git@ghe.example:o/r.git` origin → `--hostname ghe.example`;
  - an `ssh://git@ghe.example:2222/o/r` origin → `--hostname ghe.example`;
  - no `origin` remote → no `--hostname` flag.

  The suites that use the existing fake gh keep passing; the fake tolerates `--hostname`.
- **AC-14 — guard host and `-R` parsing.** In `.claude/hooks/canon-guard.mjs` and its mirror:
  - The cwd fallback (a number ref with no `-R`) passes `--hostname <origin host>` by the same rules as AC-13.
  - A `-R` value is parsed case-insensitively for the scheme. A trailing `/` and a trailing `.git` are stripped. The scp form `git@host:owner/repo` and the `ssh://` form are accepted.
  - A non-empty `-R` that still doesn't resolve to `OWNER/REPO` or `HOST/OWNER/REPO` makes the guard skip the lookup. This fails open, with no cwd fallback.

  `tests/canon-guard.test.ts` covers each of these and asserts the logged endpoint and `--hostname`.
- **AC-15 — red-first.** Run the AC-13 Enterprise-origin cases and the AC-14 cases (the Enterprise-origin cwd fallback, `.git`, scp form, and unparseable `-R` with no cwd read) against the pre-amendment implementation, i.e. the task branch HEAD before this amendment's fix. They must fail for the stated reason: a missing or wrong `--hostname`, a wrong endpoint, or a cwd fallback. They pass after the fix. Record both runs in the handoff's Red-First Evidence.

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/forge.ts` | Derive the `origin` host once per call and add `--hostname` to every `gh api` argv |
| `tests/forge-rest.test.ts` | AC-13 argv cases (needs a git-remote seam or a temp repo) |
| `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` | AC-14: origin host on the cwd fallback; `-R` parsing; no cwd fallback for unparseable `-R`; mirror synced |
| `tests/canon-guard.test.ts` | AC-14 cases with endpoint and `--hostname` assertions |
| `dist/` | Rebuild |

`GH_REPO`/`GH_HOST` env-prefix handling in the guard (round 2, N2) predates this task and stays a Non-Goal.

## Amendment Round 2 — only pass a host gh knows (code_review round 2, SG1)

**Why.** Amendment Round 1 passes `origin`'s host to `gh api --hostname` as written. Two common setups that work on `main` break as a result:
- An SSH host alias such as `git@github-work:o/r.git`: `gh` resolves aliases for its own remote matching, but `github-work` isn't an API host.
- The SSH-over-443 host `ssh.github.com`.

**Confirmation (executed, gh 2.89.0, same throwaway config as Amendment Round 1).**
- `gh api --hostname ssh.github.com repos/o/r` logged `Request to https://api.ssh.github.com/repos/o/r`. `gh api` does no host normalisation.
- `gh api --hostname GitHub.com …` logged `https://api.GitHub.com/…`, so the case isn't normalised either.
- `gh auth token --hostname` exits 0 for `ghe.example` (logged in) and for `ssh.github.com` (gh normalises it to `github.com` for auth). It exits 1 for `github-work`.

These cases fail deterministically under Amendment Round 1's rule.

**Change to Amendment Round 1's rule** (it replaces "passes `--hostname <host>` where `<host>` is the host of the `origin` remote URL"):
1. Parse `origin`'s host as in Amendment Round 1, including the lowercasing.
2. **Normalise** it: `github.com` and any host ending in `.github.com` become `github.com`.
3. Pass `--hostname <normalised host>` **only when** `gh auth token --hostname <normalised host>` exits 0. Its stdout is discarded and never logged. Otherwise pass no `--hostname`, and gh's default host applies, as on `main` for `gh api`.

The result may be cached for the process. The guard's cwd fallback follows the same rule. An explicit host from `-R HOST/OWNER/REPO` or a PR URL is normalised by step 2 but not gated by step 3, because the user named it.

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Host gating | Normalise `*.github.com`, then pass the host only if gh is logged in to it | Resolve SSH aliases with `ssh -G` | Aliases resolve to hosts gh has no login for, or to `github.com`, which is the default anyway. One offline `gh auth token` check covers aliases, typos and hosts gh doesn't know, with no ssh dependency. An Enterprise host reached through an SSH alias, with a multi-host login, falls back to gh's default host. That's a Known Risk | `Author` |

**Known Risk.** An Enterprise `origin` that's written as an SSH alias, combined with a gh login on more than one host, falls back to gh's default host. Workaround: set `GH_HOST`.

### Acceptance Criteria

- **AC-16 — host gating.** The forge unit tests pin the argv for each case below, and the guard tests pin the same rule for the cwd fallback:
  - `git@github-work:o/r.git` with `gh auth token` failing → no `--hostname`;
  - `ssh://git@ssh.github.com:443/o/r.git` → `--hostname github.com`;
  - an Enterprise origin with `gh auth token` succeeding → `--hostname ghe.example`;
  - an Enterprise origin with `gh auth token` failing → no `--hostname`.

  AC-13's cases still hold with gh logged in. The token is never written to any log, test output or error message.
- **AC-17 — red-first.** The alias and `ssh.github.com` cases fail against the current branch HEAD, before this amendment, because of the wrong `--hostname`, and pass after. Record both runs in the handoff's Red-First Evidence.

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/forge.ts` | Host normalisation and `gh auth token` gating |
| `tests/forge-rest.test.ts` | AC-16 cases |
| `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` | The same rule on the cwd fallback; normalise explicit hosts; mirror synced |
| `tests/canon-guard.test.ts` | AC-16 guard cases |
| `dist/` | Rebuild |
