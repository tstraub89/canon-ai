# Implementation Plan: rest-forge-pr-calls

> Written by: Claude | Implements: `tasks/rest-forge-pr-calls/spec.md`

## Approach

Move every GitHub call that canon makes into a new `src/orchestrator/forge.ts`, and send them all through one helper that runs `gh api …` (REST). `main.ts` keeps its small wrappers (`findOpenPRNumber`, `findMergedPRNumber`, `isPRMerged`, `getMergedPRHeadSha`, `getPRBaseRefName`, `lookupPRUrl`) and their `ghAvailable` gating. Their bodies now call the forge module, so no call site has to change. Both test fakes for `gh` switch to REST: they answer `gh api` from the same env/state knobs as today, and they fail every `gh pr …` and `gh repo view` call with the GraphQL 403. Every existing ship and safety suite then also acts as a regression check for AC-8. The guard hook gets its own small REST lookup, because it can't import `src/`.

Spec review verdict was `approved` with no items, so nothing is carried in from review.

### Feasibility check

- **Exists:** these were found by grep. Every porcelain call is in `src/orchestrator/main.ts`: `createDraftPRForTask` (main.ts:1271, two `runCommand('gh'` calls at :1293 and :1321), `lookupPRUrl` (:1399), `getMergedPRHeadSha` (:2118), `isPRMerged` (:2127), `getPRBaseRefName` (:2133), `lookupPRNumberExact` (:2300), the merge in `mergeOpenPRsAndPull` (:2351), and the `repo view` in the ship pre-flight (:2658). Also found: `MERGE_FLAG` / `MERGE_ALLOWED_FIELD` / `parseAllowedMergeMethods` (:113–131), `splitGit.runCommand` (`src/orchestrator/git.ts:12`, cwd `REPO_ROOT`), `CommandResult` (`src/orchestrator/types.ts`), the guard's `lookupPRHead` (`.claude/hooks/canon-guard.mjs:633`), the fake gh scripts (`tests/run-task-ship-helpers.ts:69` `setupFakeTools`, `tests/run-task-safety-helpers.ts:241` `setupFakeCliTools`), and the guard shim (`tests/canon-guard.test.ts:113` `makeGhShim`). No other `src/` file calls `gh`. `src/cli/deps.ts` and `doctor.ts` only check that the binary exists.
- **Real path:** `--pr` runs `commitHumanReviewFiles`, then `reportOrCreatePR` (main.ts:1361), which calls `findOpenPRNumber`, `createDraftPRForTask`, `findOpenPRNumber` again, and pins the number in the sidecar. The complete-state banner runs `inspectCompleteState` → `findOpenPRNumber` + `lookupPRUrl`. `--ship` runs: pre-flight `lookupPRNumberExact(…,'open')` (main.ts:2648), then repo settings (:2658), then the head prefetch `resolveProofPRNumberForPrefetch` → `getMergedPRHeadSha` (:2751), then `mergeOpenPRsAndPull` (merge + `isPRMerged`), then `assertOriginTaskBranchAbsent` (`findMergedPRNumber` + `getMergedPRHeadSha`, :2047), then `establishMergeProof` (`isPRMerged` + `getPRBaseRefName` + `findMergedPRNumber`). Verified live in this session (gh 2.89.0, REST reachable): `gh api -X GET --paginate --slurp 'repos/{owner}/{repo}/pulls?state=closed&head={owner}:<branch>&base=main&per_page=100'` returned `[[{…"number":195,"state":"closed"…}]]`, which confirms gh fills `{owner}` inside the query string and that `--slurp` returns an array of pages. `gh api -X GET 'repos/{owner}/{repo}'` returned the three `allow_*` booleans.
- **Callers:** `lookupPRNumberExact` is called by `findPRNumberExact` (→ `findOpenPRNumber` from :1371, :1379, :1447, :2161, :2249; → `findMergedPRNumber` from :2047, :2161, :2224) and directly by the pre-flight (:2648). `isPRMerged` is called at :2210 and :2354. `getMergedPRHeadSha` at :2049 and :2751. `getPRBaseRefName` at :2213. `lookupPRUrl` at :1374 and :1451 (the full-send summary prints the URL through the same function). `createDraftPRForTask` is called only at :1378. `parseAllowedMergeMethods` is imported by `tests/run-task-ship-docs-fold.test.ts:10`. `classifyMergeOutcome` is imported by `tests/run-task-safety-worktrees-pr.test.ts:7` and stays in main.ts. None of the wrappers change their return contract.
- **Tests that can fail:** the fakes fail porcelain with the 403. So on pre-change code, every `--pr` test dies at `gh pr create` or `gh pr list`, and every `--ship` test with an open PR dies at the pre-flight listing. That is how AC-8 fails without the change. The forge pagination test serves the exact match only on page two, so a version that reads only page one returns `none`. The state-mapping test feeds `closed` with `merged_at: null`, so a version that maps `closed` to `MERGED` fails. For the guard, the shim fails `pr view` with the 403, so the old `lookupPRHead` fails open and every "denies" case fails.
- **Predicates:**
  - `merged_at` counts as merged only when it is a non-empty string; `null`, absent, and `""` all mean not merged.
  - `state` maps only `"open"` and `"closed"`. Any other value, or a missing state, gives `state: null`, which reads as unreadable/not merged and fails closed.
  - `head.sha` still has to pass the existing 40-hex check in main.ts.
  - Branch-lookup pages must be an array of arrays. Anything else, including empty stdout, is `unreadable`. `[]` (zero pages) and `[[]]` are both `none`.
  - Each `allow_*` value must be a boolean. A missing field or a string `"true"` fails closed.
  - Guard ref classification: `^#?\d+$` is a number. The URL regex is checked before the colon rule, because URLs contain `:`. `owner:` (empty branch) resolves to `""`, which is not `task/`, so the merge is allowed. A `-R` value with any segment count other than 2 or 3 fails open.
- **Scope:** every file below is in the spec's Affected Files. The four non-listed test files the spec names conditionally (`run-task-safety-routing`, `-staging`, `codex-config`, `cli`, `agent-backend`) don't assert gh argv. `run-task-codex-config.test.ts` only sets ship-fake env knobs, and those keep their meaning, so no change is planned there. The `templates/` mirror for `.claude/skills/canon-pipeline/SKILL.md` is listed.
- **Async/stateful:** this is synchronous `spawnSync` code. The only state is "don't cache PR state across the merge". `readPR` is never memoized, and every `isPRMerged` call re-reads. Create writes its payload to a `mkdtemp` directory and removes it in `finally`, so there is no shared temp path and a crash leaves no stale file to read.

### Decisions recorded (also in notes.md)

1. **Create payload** goes through `--input <tmp>/payload.json` with `-X POST`, not `-f`/`-F` fields. The spec allows this ("or `--input` with a JSON payload"). One JSON file carries title, head, base, body and `draft: true`. That avoids `-F` typing a numeric title, and the fake can parse it with `node`.
2. **Commit-subject fallback format** is `- <subject>` per line, oldest first (`git log --reverse --format=%s origin/<base>..<branch>`), joined with `\n`. That matches the bullet list gh's `--fill` builds for multi-commit branches. If the git log fails, or lists no commits, the body is `""` and canon warns. PR creation is never aborted for a missing fallback body.
3. **Guard `--hostname`** is passed whenever the URL or the `-R HOST/OWNER/REPO` value names a host explicitly, including `github.com`. This is a superset of the spec's "for a non-default host". It is still correct when `GH_HOST` points somewhere else.
4. **Branch lookup** filters by the `base` query param *and* checks `base.ref === baseBranch` in code, as defense in depth. That gives the same result as today's `--base`.

## Steps

### Step 1: Create the forge module

Files: `src/orchestrator/forge.ts`

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as splitGit from './git.js';
import type { CommandResult } from './types.js';
import type { ShipMergeMethod } from './docs-freshness.js';

export type GhRunner = (argv: string[]) => CommandResult;
const defaultRunner: GhRunner = argv => splitGit.runCommand('gh', argv);   // the ONLY runCommand('gh' in src/
let runner: GhRunner = defaultRunner;
export function setGhRunnerForTest(next: GhRunner | null): void { runner = next ?? defaultRunner; }
function ghApi(args: string[]): CommandResult { return runner(['api', ...args]); }

const REPO = 'repos/{owner}/{repo}';
// Keep '/' and ':' literal (valid in a query); encode everything else.
function encodeQueryValue(value: string): string {
    return encodeURIComponent(value).replace(/%2F/gi, '/').replace(/%3A/gi, ':');
}
```

Exports (pin these argv shapes exactly; the forge tests assert them):

1. `lookupPRByBranch(branch: string, baseBranch: string | null, state: 'open' | 'merged' | 'closed'): ExactPRLookup`
   - Move `type ExactPRLookup` here from main.ts and export it.
   - The query is `state=${state === 'open' ? 'open' : 'closed'}&head={owner}:${encodeQueryValue(branch)}` + (base ? `&base=${encodeQueryValue(base)}` : '') + `&per_page=100`.
   - argv: `['-X', 'GET', '--paginate', '--slurp', `${REPO}/pulls?${query}`]`.
   - Failure: `{ kind: 'unreadable', reason: stderr.trim() || 'GitHub REST pull-request listing (gh api) exited unsuccessfully' }`. Empty stdout gives `'GitHub REST pull-request listing returned empty output'`. A JSON parse failure gives `'… returned malformed JSON'`. If the top level, or any page, isn't an array: `'… did not return a JSON array of pages'`.
   - Flatten the pages. For each object entry keep it only if `head.ref === branch`, `typeof number === 'number'`, `baseBranch === null || base.ref === baseBranch`, and the state matches: `open` requires `entry.state === 'open'`; `merged` requires `isMergedAt(entry.merged_at)`; `closed` requires `entry.state === 'closed' && !isMergedAt(entry.merged_at)`. The first match is `found`; otherwise `none`.
   - Rewrite the doc comment for the REST behavior. Pagination replaces `--limit 1000`, and the exact `head` filter plus the in-code check replaces prefix filtering (AC-1).
2. `readPR(prNum: number): { ok: true; pr: PRFields } | { ok: false }`, where `PRFields = { state: 'OPEN' | 'CLOSED' | 'MERGED' | null; headSha: string | null; baseRef: string | null; url: string | null }`.
   - argv: `['-X', 'GET', `${REPO}/pulls/${prNum}`]`.
   - A non-ok result, unparsable JSON, or a non-object returns `{ ok: false }`.
   - State: `'open'` → `OPEN`; `'closed'` with `isMergedAt(merged_at)` → `MERGED`; `'closed'` otherwise → `CLOSED`; anything else → `null`.
   - `headSha = typeof head?.sha === 'string' && head.sha ? head.sha : null`. `baseRef` comes from `base.ref` and `url` from `html_url` the same way.
   - Fields are tolerant one by one, so a missing `head.sha` doesn't hide `state`. That keeps today's per-field `pr view` failure semantics.
   - **No caching.**
3. `isPRMerged(prNum: number): boolean` returns `readPR(prNum)` ok with `pr.state === 'MERGED'`. Every call re-reads. Move the merge-confirmation doc text here (patterns.md points at it).
4. `mergePR(prNum: number, method: ShipMergeMethod): CommandResult`. argv: `['-X', 'PUT', `${REPO}/pulls/${prNum}/merge`, '-f', `merge_method=${method}`]`.
5. `readAllowedMergeMethods(): { ok: true; allowed: Record<ShipMergeMethod, boolean> } | { ok: false }`. argv: `['-X', 'GET', REPO]`. A non-ok result gives `{ ok: false }`; otherwise return `parseAllowedMergeMethods(stdout)`.
6. `parseAllowedMergeMethods(stdout)` is moved from main.ts unchanged, except the field map becomes `MERGE_ALLOWED_FIELD = { squash: 'allow_squash_merge', rebase: 'allow_rebase_merge', merge: 'allow_merge_commit' }`. Export it.
7. `createDraftPR(opts: { base: string; head: string; title: string; body: string }): { ok: true; number: number | null; url: string | null } | { ok: false; stderr: string }`.
   - `const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-pr-'))`, then write `payload.json` = `JSON.stringify({ title, head, base, body, draft: true })`.
   - argv: `['-X', 'POST', `${REPO}/pulls`, '--input', payloadPath]`.
   - `finally { fs.rmSync(dir, { recursive: true, force: true }) }`.
   - On ok, parse stdout leniently. `number` and `html_url` become null if they're missing or unparsable; an exit of 0 still counts as created.
8. `commitSubjectsBody(branch: string, baseBranch: string): { ok: true; body: string } | { ok: false; reason: string }`.
   - Run `splitGit.gitSafe('log', '--reverse', '--format=%s', `origin/${baseBranch}..${branch}`)`.
   - On failure: `{ ok: false, reason: stderr || 'git log failed' }`.
   - On success: split on newlines, trim, drop empty lines, and map each to `- ${s}`, joined with `\n`. The result may be `''`.
   - `gitSafe` runs in `REPO_ROOT`, where branch refs are shared with worktrees.

Helper: `function isMergedAt(v: unknown): boolean { return typeof v === 'string' && v.length > 0; }`.

### Step 2: Wire `main.ts` to the forge module

Files: `src/orchestrator/main.ts`

- Add `import * as splitForge from './forge.js';`. Delete `MERGE_FLAG`, `MERGE_ALLOWED_FIELD`, `parseAllowedMergeMethods` and the `ExactPRLookup` type from main.ts (AC-1). Re-export with `export { parseAllowedMergeMethods } from './forge.js';`, or repoint the test import (Step 5). Prefer repointing the test and not re-exporting.
- `lookupPRNumberExact` → delete it. Replace its uses (in `findPRNumberExact` and the pre-flight at :2648) with `splitForge.lookupPRByBranch`. Keep `findPRNumberExact`/`findOpenPRNumber`/`findMergedPRNumber` and their comments. Update the comment blocks above `findOpenPRNumber`/`lookupPRNumberExact`, and the "Detected by `gh pr list --state merged …`" comment in `assertOriginTaskBranchAbsent` (:2036–2039), so they describe the REST listing (AC-1).
- `getMergedPRHeadSha`: `const r = splitForge.readPR(prNum); if (!r.ok) return null; const sha = r.pr.headSha; …` and keep the 40-hex check.
- `isPRMerged`: delete it from main.ts. Call `splitForge.isPRMerged` at :2210 and :2354, keeping the `ghAvailable` guard at :2210, which is already in the `if`. At :2354 `ghAvailable` is implied (merge ran).
- `getPRBaseRefName`: return `readPR` → `pr.baseRef` (null on failure).
- `lookupPRUrl`: `if (ghAvailable) { const r = splitForge.readPR(prNum); if (r.ok && r.pr.url) return r.pr.url; }`, then the existing origin-slug fallback, unchanged.
- `mergeOpenPRsAndPull`: `const result = splitForge.mergePR(prNum, mergeMethod);`. The rest is unchanged. `isPRMerged(prNum)` re-reads fresh.
- Ship pre-flight (:2657–2673): `const parsed = splitForge.readAllowedMergeMethods();`. The die messages are unchanged.
- `createDraftPRForTask`: rewrite the body resolution as a single string:
  ```ts
  let body = resolveCanonPrBody(taskIds, title);
  if (body === null) {
      const activeCwd = splitWorktree.getActiveCwd(taskIds);
      const qa = resolveQaPrBody(taskIds, activeCwd);
      if (qa.kind === 'body-file') body = fs.readFileSync(qa.path, 'utf8');
      else {
          warn(`PR body fallback (${qa.reason}) — falling back to repo PR template or the branch's commit subjects`);
          const templatePath = findPullRequestTemplate(activeCwd) ?? findPullRequestTemplate(REPO_ROOT);
          if (templatePath) body = fs.readFileSync(templatePath, 'utf8');
          else {
              const subjects = splitForge.commitSubjectsBody(branchName, baseBranch);
              if (!subjects.ok) warn(`Could not list the branch's commit subjects for the PR body (${subjects.reason}); opening the draft PR with an empty body.`);
              body = subjects.ok ? subjects.body : '';
          }
      }
  }
  const created = splitForge.createDraftPR({ base: baseBranch, head: branchName, title, body });
  if (!created.ok) die(`Failed to create draft PR: ${created.stderr || 'unknown error'}`);
  info(`Draft PR created: ${created.url ?? branchName}`);
  ```
  Keep the worktree-template comment, and rewrite the `--fill` / non-tty comment for the REST create. `reportOrCreatePR`'s re-list after create stays as it is.
- Update the comments that mention porcelain in `reportOrCreatePR`'s doc block ("can't die on `gh pr create`'s…") so they say "PR create", and in `resolveCanonPrBody`'s doc ("`--body` value to pass to `gh pr create`" → "body for the REST draft-PR create; `null` falls through to the QA body, template, or commit subjects").
- Afterwards, verify with `grep -n "runCommand('gh'" src -r`: there should be exactly one hit, in forge.ts. Also run `grep -rnE "'pr', '(create|list|view|merge)'|'repo', 'view'|MERGE_FLAG" src`, which should return nothing.

### Step 3: #184 text fixes

Files: `src/cli/commands/doctor.ts`, `src/cli/deps.ts`, `src/orchestrator/cli.ts`

- doctor.ts:877 and deps.ts:16: change `(required for --pr / --push)` to `(required for --pr / --ship)`. Leave the deps.ts:46–48 gating unchanged (Non-Goal).
- cli.ts `--force` help (lines 35–39): add the docs-refs check. For example: `--full-send on delicate tasks, reroute amendment gate,` / `base-drift gate, docs-refs check at --pr/--push,` / `dirty REPO_ROOT worktree-start gate,` / `and spec manifest pre-flight before plan/implement).` Keep the 22-column indent.
- Run `grep -rn "required for --pr / --push\|bypass\b" tests` and update any test that pins the old strings. None was found at plan time; check again.

### Step 4: Convert the fake `gh` scripts to REST

Files: `tests/run-task-ship-helpers.ts`, `tests/run-task-safety-helpers.ts`

Rewrite both fakes with the same structure. Keep every existing env knob and its meaning (`FAKE_GH_OPEN_PR_NUMBER`, `FAKE_GH_MERGED_PR_NUMBER`, `FAKE_GH_PR_*`, `FAKE_GH_STATE_FILE` / `FAKE_GH_PR_STATE_FILE`, `FAKE_GH_*_FAIL`, `FAKE_GH_*_MALFORMED`, `FAKE_GH_ALLOWED_METHODS`, `FAKE_GH_CREATE_*` / `FAKE_GH_PR_CREATE_*`, `FAKE_GH_MERGE_FAIL/ERROR`), so the test bodies only change where they assert argv.

- Keep the first line, which logs `$*` to `FAKE_GH_LOG`.
- **Porcelain:** `if [ "${1:-}" = "pr" ] || { [ "${1:-}" = "repo" ] && [ "${2:-}" = "view" ]; }` → print `HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API` to stderr and `exit 1`.
- **`api`:** parse the args with a `while` loop: `-X` → method, `--input` → input file, `-f` → field (record `merge_method=`), `--paginate`/`--slurp` → skip, `--hostname` → skip 2, and anything else is the endpoint. Split the endpoint at `?`: path = before and query = after. Read query params with `sed -n 's/.*[?&]state=\([^&]*\).*/\1/p'` (and the same for `head` and `base`). Strip the head's `{owner}:` prefix with `${head#*:}`.
  - `GET …/pulls?…` (list): apply `FAKE_GH_PR_LIST_FAIL` / `_MALFORMED` when `state=open`, as today. `state=open` uses the open candidate; `state=closed` uses the merged candidate. Emit the slurped shape `[[{"number":N,"state":"open"|"closed","merged_at":null|"2026-01-01T00:00:00Z","head":{"ref":"H"},"base":{"ref":"B"}}]]`, or `[[]]` when there's no candidate or the base doesn't match. Keep the existing base-mismatch behavior: the safety fake drops the entry when `FAKE_GH_STATE_BASE` and the requested base differ. Emit `base.ref` as the candidate base, or the requested base when the candidate base is unset, so that the defensive `base.ref` check in Step 1 doesn't drop entries that the old fake returned.
  - `POST …/pulls` (create): apply `FAKE_GH_PR_CREATE_FAIL` / `_ERROR` in the safety fake. Read head/base from the input file with `node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(p.head+"|"+p.base)' "$input"`. If `FAKE_GH_CREATE_PAYLOAD` is set, `cp "$input" "$FAKE_GH_CREATE_PAYLOAD"`. Write the state file as today. Print `{"number":N,"html_url":"URL"}`.
  - `PUT …/pulls/<n>/merge`: same behavior as today's `pr merge` branch, including the safety fake's `git push origin --delete` and the state-file clear.
  - `GET …/pulls/<n>` (read): build one JSON object from today's per-field sources.
    - `state`: when the old fake printed `OPEN`/`MERGED`/`CLOSED` (ship fake: `${FAKE_GH_PR_STATE:-${STATE_STATUS:-MERGED}}`; safety fake: `$FAKE_GH_PR_STATE`, else fail), map OPEN→`"open"`,null; MERGED→`"closed"`,`"2026-01-01T00:00:00Z"`; CLOSED→`"closed"`,null. When the old field lookup would have failed, emit `"state":null`.
    - `head.sha`: from `FAKE_GH_HEAD_REF_OID`, else `null`.
    - `base.ref` and `html_url`: the same precedence as today, else `null`.
  - `GET repos/{owner}/{repo}` (no `/pulls`): `FAKE_GH_REPO_VIEW_FAIL` / `_MALFORMED` as today, and print `{"allow_squash_merge":…,"allow_rebase_merge":…,"allow_merge_commit":…}`.
- Leave the final `unexpected gh args` exit 1 unchanged.
- In `run-task-ship-helpers.ts`, update `assertNoPrMergeInvoked` to `assert.doesNotMatch(log, /\/merge( |$)/m)` (the REST merge endpoint). Also add `export function assertNoRepoSettingsRead(log)` matching `/^api -X GET repos\/\{owner\}\/\{repo\}$/m`, or inline that regex where tests asserted `/repo view/`.
- In `run-task-safety-helpers.ts`, set `FAKE_GH_CREATE_PAYLOAD: path.join(dir, 'gh-create-payload.json')` in the two env builders that already set `FAKE_GH_LOG` (≈:1338, :1355). Add `export function readGhCreatePayload(dir: string): { title: string; head: string; base: string; body: string; draft: boolean } | null`.

### Step 5: Update the existing test assertions

Files: `tests/run-task-ship-docs-fold.test.ts`, `tests/run-task-ship-proof.test.ts`, `tests/run-task-safety-worktrees-pr.test.ts`, `tests/run-task-safety-scaffold-push.test.ts`, `tests/run-task-safety-base-drift.test.ts`

- **ship-docs-fold**
  - Import `parseAllowedMergeMethods` from `../src/orchestrator/forge.js`, and switch its fixtures (:44–47) to `allow_squash_merge` / `allow_rebase_merge` / `allow_merge_commit`. Add a case where one field is the string `"true"`, which gives `{ ok: false }`.
  - Per-method loop (:307): iterate `['squash','rebase','merge']` and assert `^api -X PUT repos/\{owner\}/\{repo\}/pulls/107/merge -f merge_method=${method}$`, and that the other two methods are absent.
  - At :386–388, `pr merge` becomes the merge-endpoint regex, and `repo view` becomes the repo-settings GET regex.
  - Find the merge-fail-but-merged and merge-fail-not-merged cases (they use `FAKE_GH_MERGE_FAIL`). They should pass unchanged; if either asserts argv, move it to REST.
- **ship-proof:** at :177, `/repo view/` becomes the repo-settings GET regex. The `assertNoPrMergeInvoked` callers need no change. Every scenario must pass unchanged (AC-5).
- **worktrees-pr**
  - Fallback-warning assertion at :1255 → `/PR body fallback \(pr-body\.md not found\) — falling back to repo PR template or the branch's commit subjects/`.
  - At :1259, replace the `--body-file` assertion with `^api -X POST repos/\{owner\}/\{repo\}/pulls --input /m`.
  - **Make the test at :1216 table-driven over the four body sources** (Slow Test Discipline: same fixture, distinct outcomes). Assert `readGhCreatePayload(dir)` for each:
    - (a) `CANON_PR_BODY='Body for $LABEL'` → body `Body for task-a`, with no fallback warning.
    - (b) a populated `tasks/task-a/pr-body.md` in the worktree → body equals the file content.
    - (c) no pr-body plus a `.github/pull_request_template.md` in the worktree → body equals the template content. Check how the current test gets a template (the fake git may stub it) and write one into `worktreeDir` if needed.
    - (d) no pr-body and no template, with `FAKE_GIT_LOG_OUTPUT='first subject\nsecond subject'` → body `- first subject\n- second subject`, and the git log contains `log --reverse --format=%s origin/main..task/task-a`.
    - In every row, assert `draft === true`, `head === 'task/task-a'`, `base === 'main'`, and that stdout contains `Draft PR created: https://github.com/x/y/pull/` (the `html_url`).
  - :1851 and :1987: `^pr create /m` becomes `^api -X POST repos/\{owner\}/\{repo\}/pulls --input /m`. :2056 and :2071 are the `doesNotMatch` versions of the same thing.
  - Update the `classifyMergeOutcome` test titles only if they read wrong (optional).
- **scaffold-push:** `^pr create /m` becomes the REST POST regex throughout (:157, 182, 224, 237, 264, 283, 319, 324, 359). At :197, assert `readGhCreatePayload(dir)?.base === 'feat/x'` instead of the argv `--base`, and also assert `head`.
- **base-drift** (:748): `FAKE_GH_PR_CREATE_FAIL` now fails the REST POST. Keep the expected `Failed to create draft PR: draft PR creation failed` message, and change any argv assertion near it to REST.

### Step 6: Add the forge unit tests and the AC-8 regression test

Files: `tests/forge-rest.test.ts`

- **Unit tests** (fast, no subprocess): import from `../src/orchestrator/forge.js` and use `setGhRunnerForTest`. The fake runner records argv and returns canned `CommandResult`s. Reset it in `afterEach` (`setGhRunnerForTest(null)`).
  - Argv for every call. Each argv starts with `api` and must match the Step 1 shapes exactly, including `-X GET` on list, read and repo, `--paginate --slurp`, `head={owner}:task/x`, `&base=main`, and `-f merge_method=rebase`. For create, assert `--input` and read the payload file *inside* the fake runner, because it is deleted afterwards. Then assert that the file no longer exists after the call.
  - Pagination: stdout `[[{"number":1,"state":"open","head":{"ref":"task/x-sandbox"},"base":{"ref":"main"}}],[{"number":2,"state":"open","head":{"ref":"task/x"},"base":{"ref":"main"}}]]` → `{kind:'found', number:2}`.
  - Three-way results:
    - `none` on `[[]]` and `[]`.
    - `unreadable` on a failed runner (the reason includes stderr), on empty stdout, on `not json`, on `{}`, and on `[{}]` (a page that is not an array).
    - Base check: an entry with `base.ref` `dev` is `none` for base `main`.
    - Merged vs closed: a `closed` entry with `merged_at` set is found for `merged` and not for `closed`. A `closed` entry with `merged_at: null` is the reverse.
  - `readPR` state mapping: open → OPEN; closed with merged_at → MERGED; closed with null → CLOSED; closed with `""` → CLOSED; `state: "weird"` → null. A failed runner or non-JSON gives `{ok:false}`. A missing `head.sha` keeps `state`.
  - `isPRMerged` re-reads: call it twice with the runner switching OPEN → MERGED and assert two runner invocations and `false` then `true`.
  - `readAllowedMergeMethods`: present, absent field, runner fail, malformed.
  - `commitSubjectsBody`: this uses real git, so either skip it here (it's covered end-to-end by Step 5 row (d)) or test it in a temp repo with `origin/main..task/x` refs. Prefer to skip it and rely on row (d).
- **AC-8 regression** (two subprocess tests). Both rely on the Step 4 fakes, which fail porcelain with the GraphQL 403:
  - `--pr`: mirror the `commitHumanReviewFiles(createPR = true)` fixture (worktrees-pr :1797) or the `main --pr on complete` fixture, using `setupFakeCliTools` + `setupFakeGit`. Assert exit 0, that the gh log contains no line starting with `pr ` or `repo `, and that it contains the REST POST and list lines.
  - `--ship`: mirror the ship-docs-fold per-method fixture (`prepareShipFixture` + `runCanon` with `FAKE_GH_OPEN_PR_NUMBER`/`MERGED`/`HEAD_REF_OID`). Assert exit 0, `Deleted remote branch`, and the same no-porcelain log check.
  - Add a comment that on pre-change code these die at PR creation and at the pre-flight listing respectively.

### Step 7: Guard hook REST lookup

Files: `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs`, `tests/canon-guard.test.ts`

- Replace `lookupPRHead(ref, repo, cwd)`:
  ```js
  const PR_URL = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
  function resolvePRTarget(ref, repo) {
      const num = /^#?(\d+)$/.exec(ref);
      if (num) { const r = parseRepoArg(repo); return r ? { kind: 'pr', number: num[1], ...r } : { kind: 'unknown' }; }
      const url = PR_URL.exec(ref);
      if (url) return { kind: 'pr', host: url[1], repo: `${url[2]}/${url[3]}`, number: url[4] };   // URL wins over -R
      const colon = ref.indexOf(':');
      if (colon !== -1) return { kind: 'branch', head: ref.slice(colon + 1) };
      return { kind: 'branch', head: ref };
  }
  function parseRepoArg(repo) {   // null → gh placeholders; OWNER/REPO; HOST/OWNER/REPO
      if (repo === null || repo === undefined) return { host: null, repo: '{owner}/{repo}' };
      const parts = repo.split('/');
      if (parts.length === 2 && parts.every(Boolean)) return { host: null, repo };
      if (parts.length === 3 && parts.every(Boolean)) return { host: parts[0], repo: `${parts[1]}/${parts[2]}` };
      return null;   // unrecognized -R → fail open
  }
  function lookupPRHead(ref, repo, cwd) {
      const target = resolvePRTarget(ref, repo);
      if (target.kind === 'branch') return target.head || null;
      if (target.kind !== 'pr') return null;
      const result = spawnSync('gh', [
          'api', ...(target.host ? ['--hostname', target.host] : []),
          '-X', 'GET', `repos/${target.repo}/pulls/${target.number}`,
      ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GH_TIMEOUT_MS });
      if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return null;
      try { const pr = JSON.parse(result.stdout); const head = isRecord(pr) && isRecord(pr.head) ? pr.head.ref : null; return typeof head === 'string' && head ? head : null; }
      catch { return null; }
  }
  ```
  `mergeRule` is unchanged. A failed lookup still yields `null`, which fails open. Update any comment near the lookup that says `gh pr view`.
- Run `npm run sync-templates` and then `npm run sync-templates:check` so the mirror is identical.
- Tests: rewrite `makeGhShim`.
  - Log `$*`.
  - If `$1` is `pr`, print the GraphQL 403 to stderr and exit 1.
  - If `$1` is not `api`, exit 1.
  - Otherwise take the last argument as the endpoint, `n="${endpoint##*/}"`. Case 12 prints `{"head":{"ref":"task/foo"}}`, 13 prints `{"head":{"ref":"release/v1.2"}}`, 98 runs `exec sleep 5`, and anything else exits 1.
  - Change the `repoFlagCases` assertion (:338) from `/-R owner\/repo/` to `/repos\/owner\/repo\/pulls\/12/`.
  - Add these cases to the deny loop (each must also satisfy the existing reason assertions):
    - `gh pr merge '#12'`
    - `gh pr merge https://github.com/owner/repo/pull/12`. Its log matches `--hostname github.com` and `repos/owner/repo/pulls/12`.
    - `gh -R other/repo pr merge https://ghe.example.com/owner/repo/pull/12`. The log matches `--hostname ghe.example.com` and `repos/owner/repo/pulls/12`, and does not match `other/repo`, which shows the URL wins.
    - `gh -R ghe.example.com/owner/repo pr merge 12`. The log matches `--hostname ghe.example.com` and `repos/owner/repo/pulls/12`.
    - `gh pr merge 12` with no `-R`. The log matches `repos/{owner}/{repo}/pulls/12`.
    - `gh pr merge owner:task/foo` and `gh pr merge task/foo`. For both, assert the gh log stays empty (no lookup).
  - Add to the allow loop: `gh pr merge release/v1.2` (branch ref, non-task) and `gh pr merge owner:release/v1.2`.
  - Keep `lookup failure` (99) and `lookup timeout fails open` (98) as they are. They are now the "fails open when `gh api` fails" case.

### Step 8: Docs

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md`, `docs/patterns.md`, `docs/codebase-map.md`

- `docs/pipeline-orchestrator.md`
  - :404: the order ends `… → repo PR template file → a list of the branch's commit subjects (\`origin/<base>..<branch>\`)`. The bundle sentence: "fall back to the template/commit-subject path". Add one sentence near the `--pr` / `--ship` section: "Canon's PR operations (create, lookup, read, merge, and the merge-settings read) use GitHub's REST API through `gh api`, so they work where GitHub's GraphQL API is blocked."
  - :602: "checks `gh repo view` to confirm" → "reads the repository's merge settings to confirm".
  - `docs/pipeline-orchestrator.md` is in `CANON_OWNED` (`src/lib/canon-owned.ts:27`). Run `npm run sync-templates` to update the `templates/docs/` mirror; don't edit the mirror by hand.
- canon-pipeline SKILL.md:80: "opens a draft PR via `gh pr create` targeting `base_branch`" → "opens a draft PR (through GitHub's REST API) targeting `base_branch`". Leave the `gh pr edit` operator instruction and line 128 alone (Non-Goals). Then sync the mirror.
- `docs/patterns.md`
  - "Decouple operation-success…" (:214): the canonical implementation becomes `classifyMergeOutcome({ exitOk, mergeConfirmed })` in `src/orchestrator/main.ts` + `isPRMerged(prNum)` in `src/orchestrator/forge.ts`. Also change "`gh` exited non-zero on the delete step" only if it reads wrong; it's historical, so leave it.
  - "Use the attempted `prNum`…" (:218): "When tolerating a failed merge call, confirm the **specific PR number** … (`isPRMerged(prNum)` — a fresh REST read of `pulls/<prNum>`, merged when `merged_at` is set)". The canonical implementation is `mergeOpenPRsAndPull` in `src/orchestrator/main.ts` with `isPRMerged` in `src/orchestrator/forge.ts`.
- `docs/codebase-map.md`: add a row after the Git-plumbing row (:39): `| GitHub forge calls (REST via \`gh api\`) | \`src/orchestrator/forge.ts\` | Draft-PR create, exact-head branch lookup (paginated, found/none/unreadable), per-number PR read, merge, merge-settings read, commit-subject body fallback; \`setGhRunnerForTest\` seam |`. The guard-hook row (:185) still reads correctly; leave it.

### Step 9: Validate and rebuild

Run, from the worktree:
`npm run build && npm run type-check && npm run lint && npm test && npm run sync-templates:check && npm run docs-refs-check`.

Commit the rebuilt `dist/orchestrator/run-task.js` and `dist/cli/index.js` (AC-11). Run the AC-1/AC-2 greps from Step 2 and record their output in the handoff.

## Testing Plan

- **Unit:** `tests/forge-rest.test.ts` covers argv shapes, pagination (match on page two), the three-way lookup, the base check, merged/closed filtering, the `readPR` state mapping, fresh re-reads, and allowed methods. It also covers the `parseAllowedMergeMethods` REST fields in `tests/run-task-ship-docs-fold.test.ts`.
- **Integration (existing suites on REST-only fakes):** ship-proof (every merge-proof scenario, AC-5), ship-docs-fold (merge method, merge-fail tolerance, repo-settings present/absent/fail/malformed, AC-6/AC-7), safety worktrees-pr (four body sources with body content pinned, URL print, idempotent/wrong-base, AC-3/AC-4), scaffold-push (base/head in the payload), and base-drift (create failure).
- **Regression:** the AC-8 `--pr` and `--ship` runs in `tests/forge-rest.test.ts` against fakes that answer only `gh api`.
- **Guard:** `tests/canon-guard.test.ts` covers number, `#n`, URL, URL over `-R`, `HOST/OWNER/REPO`, `owner:branch`, bare branch, non-task allows, and fail-open on api failure and timeout.
- **E2E:** N/A. The spec's Human Test Plan covers the live GitHub run.

## Questions recorded (unattended session)

- The CLAUDE.md norm "ask before committing" doesn't apply to this phase: the plan commits nothing, and implement commits are orchestrator-owned.

## Reroute Plan

### Round Scope

This round covers Amendment 1 (AC-13, AC-14, AC-15) and nothing else. AC-1 through AC-12 are implemented at HEAD `bd37a01` (two implement iterations). Code review round 2 marked them Met, and the full suite passed (2268/0/0). Do not re-plan or re-touch them.

Archived review (`review-prior-1.md`) disposition:
- F1–F5 and R1: resolved in iteration 2, and confirmed in round 2. No work.
- S1 (spec gap, host addressing): Amendment 1 supersedes it. That is this round's main work (AC-13, AC-14 first bullet).
- N1 (`-R` forms resolve to the wrong repo or fall back to cwd): Amendment 1 promotes it to AC-14. In scope.
- N2 (`GH_REPO`/`GH_HOST` env prefixes): Amendment 1 makes it a Non-Goal. No work.
- Round-2 nits (the no-op `notEqual`, the stub reset outside `try/finally`, `--slurp` min version, dropped `errors[]`, "gh api exited" wording): optional. Not in scope. If Step 3 rewrites the forge test setup, the stub reset moves into hooks anyway.
- Spec-review nit (malformed-origin argv case): cheap and pins the stated Decision, so Step 3 includes it.

Feasibility:
- **Exists:** found by grep. `ghApi` (`src/orchestrator/forge.ts:19`) is the single gh entry point, and every forge export (`lookupPRByBranch`:44, `readPR`:64, `mergePR`:75, `readAllowedMergeMethods`:77, `createDraftPR`:86) goes through it. The test seams `setGhRunnerForTest`/`setGitLogRunnerForTest` are at forge.ts:17–18. `splitGit.gitSafe` is at `src/orchestrator/git.ts:39` (cwd `REPO_ROOT`). In the guard: `lookupPRHead` is at `.claude/hooks/canon-guard.mjs:633`, `readPRHead` (already takes `host`) at :652, and `spawnSync` is imported at :4. In the tests: `makeGhShim` is at `tests/canon-guard.test.ts:112` (it already skips `--hostname`) and the `repoFlagCases` loop at :315–355. The ship/safety fakes parse `api` args at `tests/run-task-ship-helpers.ts:75` and `tests/run-task-safety-helpers.ts:246`; neither names `--hostname` today. `main.ts:1343` `parseOriginRepoSlug` is github.com-only and is used only for the URL fallback. It is out of scope and must not be reused for the host.
- **Real path:** every `--pr`/`--ship` forge call runs `main.ts` wrapper → forge export → `ghApi` → `runner(['api', …])` → `splitGit.runCommand('gh', …)` in `REPO_ROOT`. Adding the host inside `ghApi` covers all of them. Nothing on this path passes `--hostname` today. The guard's number-ref path is `mergeRule` (:526) → `lookupPRHead` → `readPRHead`. The URL-ref branch already passes the URL's host. The `-R` branch (:640–648) does the broken parsing that AC-14 replaces.
- **Callers:** `ghApi`'s callers are the five forge exports above. None of their return contracts change; only argv gains `--hostname`. `lookupPRHead`'s only caller is `mergeRule`, whose contract (string head or `null` = fail open) is unchanged. The new "unparseable `-R` → `null`" is already the fail-open value.
- **Tests that can fail:** see Step 3 and Step 5. Forge: an Enterprise origin stubbed through the origin-reader seam. At `bd37a01` `ghApi` never adds `--hostname`, so the exact-argv `deepEqual` fails. Guard: the fixture repo gets `git remote add origin https://ghe.example/o/r.git`. The old code passes no `--hostname` on the cwd fallback, emits `repos/o/r.git/…` for a `.git` `-R`, emits `repos/git@ghe.example:o/r/…` for the scp form, and does a cwd read for `-R a/b/c/d`. Each assertion is on the exact logged argv line, or on the log being absent.
- **Predicates:** origin-host parse and `-R` parse. Boundary values are listed in Steps 1 and 4: empty or whitespace URL, a local path or `file://` origin (no host → null), port, userinfo, uppercase scheme or host, trailing `/` then `.git`, empty owner/repo segments, 1/4/5 segments, and `-R ""`.
- **Scope:** forge.ts, `tests/forge-rest.test.ts`, the guard and its mirror, `tests/canon-guard.test.ts` and `dist/` are in Amendment 1's Affected Files. The two fake-gh helpers (Step 2) are in the original Affected Files. The amendment's AC-13 says "the fake tolerates `--hostname`". No docs change: grep found no doc that claims how `gh api` picks its host (`docs/pipeline-orchestrator.md:602` says only "through GitHub REST using `gh api`"). The AC-13/AC-14 rules are therefore not restated anywhere.
- **Async/stateful:** N/A. Synchronous `spawnSync`. The origin host is read on every `ghApi` call, as the amendment says ("once per call"), with no memoization, so there is no stale state. The test seam is module-global and must be reset in `afterEach`.

### Step 1: Origin host in the forge module (AC-13)

File: `src/orchestrator/forge.ts`

- Add `export function parseRemoteHost(url: string): string | null`:
  - `const s = url.trim(); if (!s) return null;`
  - Scheme form: `/^(?:https?|ssh):\/\/(?:[^@/]*@)?([^/:?#]+)(?::\d*)?(?:[/?#]|$)/i`. This drops userinfo and port. `git://`, `file://`, and any other scheme return null (only the forms in the amendment's Decision are accepted).
  - scp form, tried only when `s` has no `://`: `/^(?:[^@/:]+@)?([^/:]+):(?!\/)/`. A plain local path (`/tmp/origin.git`, `../o.git`) has no `host:` prefix and returns null.
  - Return the host lowercased. An empty capture returns null.
- Add an origin-reader seam next to the existing ones:
  ```ts
  export type OriginUrlReader = () => CommandResult;
  const defaultOriginUrlReader: OriginUrlReader = () => splitGit.gitSafe('remote', 'get-url', 'origin');
  let originUrlReader = defaultOriginUrlReader;
  export function setOriginUrlReaderForTest(next: OriginUrlReader | null): void { originUrlReader = next ?? defaultOriginUrlReader; }
  function originHost(): string | null { const r = originUrlReader(); return r.ok ? parseRemoteHost(r.stdout) : null; }
  ```
  Keep this separate from `gitLogRunner`. Existing tests stub that runner for `git log` only, and sharing it would feed them `remote get-url` calls.
- Change `ghApi`: `const host = originHost(); return runner(['api', ...(host ? ['--hostname', host] : []), ...argv]);`. `--hostname` goes directly after `api`, which is the shape the forge tests pin. The `{owner}/{repo}` placeholders stay unchanged.
- AC-1/AC-2 still hold: `git remote get-url` goes through `gitSafe`, not `runCommand('gh'`. Re-run `grep -rn "runCommand('gh'" src` and expect one hit.
- Add a short comment above `ghApi`: gh fills `{owner}/{repo}` from its base-repo resolution but takes the API host from `--hostname`/`GH_HOST`, so the host is pinned to `origin`.

### Step 2: Fakes tolerate `--hostname` explicitly

Files: `tests/run-task-ship-helpers.ts:75`, `tests/run-task-safety-helpers.ts:246`

In each inline node arg loop, add `else if(a[i]==="--hostname"){i++;}` before the endpoint fallthrough. The ship/safety fixtures use a local bare `origin.git` path, so `parseRemoteHost` returns null and no `--hostname` is sent today. This is robustness only, and AC-13 requires that the fake tolerates the flag. No test-body changes are expected; the existing suites must stay green unmodified.

### Step 3: Forge unit tests (AC-13, red-first)

File: `tests/forge-rest.test.ts`

- Add top-level `beforeEach(() => setOriginUrlReaderForTest(() => ({ ok: false, stdout: '', stderr: 'no origin' })))` and an `afterEach` that resets all three seams (`setGhRunnerForTest(null)`, `setGitLogRunnerForTest(null)`, `setOriginUrlReaderForTest(null)`). Every existing argv pin then stays host-less and doesn't depend on the worktree's real `origin`. Without this, those pins would pick up `--hostname github.com` from canon-ai's own remote.
- New test `forge passes --hostname from origin on every gh api call`. For each origin case, stub the reader, record argv from one call of each of `lookupPRByBranch`, `readPR`, `mergePR`, `readAllowedMergeMethods` and `createDraftPR`, and assert `argv.slice(0, 3)`:
  - `https://github.com/o/r.git` → `['api', '--hostname', 'github.com']`
  - `git@ghe.example:o/r.git` → `['api', '--hostname', 'ghe.example']`
  - `ssh://git@ghe.example:2222/o/r` → `['api', '--hostname', 'ghe.example']`
  - no origin (`ok: false`) → `argv[1]` is `'-X'` (no flag)
  - unparseable origin (`ok: true`, stdout `/tmp/local/origin.git`) → no flag (spec-review nit)
  Also pin one complete argv for the Enterprise case, e.g. `['api', '--hostname', 'ghe.example', '-X', 'GET', 'repos/{owner}/{repo}/pulls/7']`.
- Add a direct `parseRemoteHost` table: uppercase `HTTPS://GHE.Example/o/r` → `ghe.example`; `http://user:pw@h:8080/o/r` → `h`; `''`, whitespace, `file:///x`, `/abs/path` and `rel/path` → null.
- **Red-first (AC-15):** write these tests first. The seam export doesn't exist at `bd37a01`, so a straight run would fail on import and not for the stated reason. Create a scratch checkout of `bd37a01` (same method as iteration 2's red-first, outside the worktree) and add only a **seam-only stub**: `setOriginUrlReaderForTest` stores the reader, `ghApi` never consults it, and `parseRemoteHost` returns null. That is the pre-fix behavior plus test plumbing. Run the forge test file there. The Enterprise and github.com cases must fail on the missing `--hostname` in the argv `deepEqual`; the parse-table cases fail on null. Record the stub in the Red-First row so the reviewer can see exactly what the "pre-fix" tree contained. Then implement Step 1 and re-run.

### Step 4: Guard host and `-R` parsing (AC-14)

Files: `.claude/hooks/canon-guard.mjs`, then `npm run sync-templates` for `templates/.claude/hooks/canon-guard.mjs`

- Add `parseRemoteHost(url)`, the same rules as Step 1, duplicated because the guard can't import `src/` (spec, Interaction Dependencies). Add a comment that it mirrors `parseRemoteHost` in canon-ai's forge module. Code comments are exempt from the adopter-scope rule.
- Add `lookupOriginHost(cwd)`: `spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', stdio: ['ignore','pipe','ignore'], timeout: 3000 })`. Return null on error, non-zero exit or non-string stdout; otherwise return `parseRemoteHost(stdout)`. Use the same shape as `lookupCurrentBranch`.
- Add `parseRepoValue(value)`, which returns `{ host: string|null, owner, name }` or `null`:
  1. `s = value.trim()`. A scheme form `/^(?:https?|ssh):\/\/(?:[^@/]*@)?([^/:]+)(?::\d*)?\/(.*)$/i` gives host = lowercased m[1] and rest = m[2].
  2. Otherwise, if `s` has no `://` and matches scp `/^(?:[^@/:]+@)?([^/:]+):([^/].*)$/`, host = lowercased m[1] and rest = m[2].
  3. Otherwise host = undefined and rest = `s`.
  4. `rest = rest.replace(/\/+$/, '').replace(/\.git$/, '')`. Strip trailing slashes first, then `.git` (`o/r.git/` → `o/r`).
  5. `parts = rest.split('/')`. Any empty part returns null.
  6. Host from step 1/2: exactly 2 parts gives `{host, owner, name}`; anything else returns null (URL with extra path segments → fail open).
  7. No host: 2 parts → `{host: null, …}`; 3 parts → `{host: parts[0].toLowerCase(), owner: parts[1], name: parts[2]}`; anything else returns null.
- Rewrite the number branch of `lookupPRHead`. The URL, `owner:branch` and branch branches are unchanged.
  ```js
  const number = ref.replace(/^#/, '');
  if (typeof repo === 'string' && repo.trim() !== '') {
      const parsed = parseRepoValue(repo);
      if (!parsed) return null;                       // fail open, no cwd fallback (AC-14)
      return readPRHead(`repos/${parsed.owner}/${parsed.name}/pulls/${number}`, cwd, parsed.host);
  }
  return readPRHead(`repos/{owner}/{repo}/pulls/${number}`, cwd, lookupOriginHost(cwd));
  ```
- **Interpretation (recorded in notes.md):** `-R OWNER/REPO` with no host passes no `--hostname`. That matches gh's own `-R OWNER/REPO` semantics (default host / `GH_HOST`) and the AC-14 text, which applies the origin host only to the cwd fallback. A whitespace-only `-R` counts as absent and uses the cwd fallback ("non-empty" in AC-14). The PR-URL branch keeps its URL host as written; it is not lowercased, since AC-14 doesn't ask for it and it already works.

### Step 5: Guard tests (AC-14, red-first)

File: `tests/canon-guard.test.ts`

Inside `task PR merge rule denies every merge strategy…`, or in a new sibling test using `withCanonRepo` + `makeGhShim`, so the shim's `*/12` → `task/foo` still applies. Read the log as lines, and assert on an exact line or on its absence. A substring regex would let `repos/o/r.git/pulls/12` satisfy `repos/o/r`.

- **Enterprise origin cwd fallback:** `git -C fixture.repo remote add origin https://ghe.example/o/r.git` (remove it afterwards, or use a dedicated fixture, so earlier cases keep no origin). Run `gh pr merge 12`. Expect a deny and the log line `api -X GET --hostname ghe.example repos/{owner}/{repo}/pulls/12`.
- **scp-form origin:** set the origin to `git@GHE.example:o/r.git`. Expect `--hostname ghe.example`.
- **No origin:** the existing fixture. `gh pr merge 12` logs `api -X GET repos/{owner}/{repo}/pulls/12`.
- **`-R` cases** (each denied, exact line asserted):
  - `-R https://ghe.example/o/r.git` → `api -X GET --hostname ghe.example repos/o/r/pulls/12`
  - `-R HTTPS://ghe.example/o/r/` → the same
  - `-R git@ghe.example:o/r` → the same
  - `-R ssh://git@ghe.example:2222/o/r.git` → the same
  - `-R ghe.example/o/r.git` → the same
  - `-R o/r.git` → `api -X GET repos/o/r/pulls/12`
- **Unparseable `-R`** (fail open, no read): `-R a/b/c/d`, `-R https://ghe.example/o/r/tree/main` and `-R ghe.example:` → `denied === false`, and the gh log file does not exist (no `gh api` call at all; this pins "no cwd fallback").
- The existing `repoFlagCases` assertions stay. Tighten the two host-qualified ones to exact lines only if they already pass unchanged.
- **Red-first (AC-15):** before Step 4, run the new cases against the `bd37a01` guard. No seam is needed; the test drives the real script. Expected failures: no `--hostname` on the Enterprise cwd fallback; `repos/o/r.git/…` for `.git`; `repos/git@ghe.example:o/r/…` for scp; a cwd read (deny + log) for `-R a/b/c/d`. Record the exact failing subtests, then implement and re-run.

### Step 6: Mirror, rebuild, validate, handoff

- `npm run sync-templates`, then `npm run sync-templates:check`.
- `npm run build`, and commit `dist/` only if it changed. `forge.ts` is bundled into `dist/orchestrator/run-task.js`, so it will.
- Run in full: `npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check`. Report any check that fails or can't run as exactly that.
- `grep -rn "runCommand('gh'" src` must return exactly the forge helper (AC-1 regression check).
- Handoff: append `## Iteration 3 — Amendment 1` with an AC delta table (AC-13, AC-14, AC-15) and a Red-First Evidence table with two rows. The forge row names the seam-only stub on `bd37a01`; the guard row is the plain `bd37a01` guard. Each row gives the command, the failing subtests and reasons, and the post-fix result. Record the Step 4 interpretations there as deviations or interpretations.

### Questions recorded (unattended)

- The amendment adds no docs row. No doc restates the host rule (grep above), so this round has no docs change. QA may consider one sentence in `docs/pipeline-orchestrator.md` near line 602, "the API host follows `origin`". That is not done here, to stay inside the amendment's Affected Files.
- `main.ts` `parseOriginRepoSlug` (URL fallback, github.com-only) still builds a github.com URL for an Enterprise origin when the REST read fails. It predates this task and is outside the amendment. Logged for QA as a follow-up candidate.

## Reroute Plan Round 2

### Round Scope

This round covers Amendment Round 2 (AC-16, AC-17) and nothing else. Amendment Round 1 (AC-13–AC-15) and AC-1–AC-12 are implemented at HEAD `389251c`, and the worktree holds no uncommitted `src/`, `tests/`, guard or `dist/` changes. Do not re-plan or re-touch them, except where the steps below edit the Amendment-1 host code and tests in place.

Archived review (`review-prior-2.md`) disposition:
- C1 (merge-fail-but-merged ship test) and C2 (`--slurp`): fixed in iteration 2, and confirmed in review round 2. No work.
- SG1 (literal origin host breaks SSH aliases and `ssh.github.com`): Amendment Round 2 resolves it. This is the round's work.
- N1–N10 and R2-N1–R2-N6: optional nits. Not in scope. N3 (PR-URL regex lacks `i`; a URL port reaches `--hostname`) and N9 (docs don't say the host follows `origin`) are untouched. Step 3 lowercases and normalises the URL host only because Amendment 2 requires normalising explicit hosts.
- Spec-review nit (Amendment Round 2): pin an explicit `-R` or PR-URL host such as `api.github.com` → `--hostname github.com`. It's cheap and pins the amendment's "normalise explicit hosts" row, so Step 4 includes it.

Feasibility:
- **Exists:** found by grep. `src/orchestrator/forge.ts`: `parseRemoteHost`:23, `originHost`:32, `ghApi`:38, the seams `setGhRunnerForTest`/`setOriginUrlReaderForTest`:20/22, and `defaultRunner`:13, the only `runCommand('gh'` in `src`. `.claude/hooks/canon-guard.mjs`: `lookupPRHead`:633 (URL branch :634–638, `-R` branch :643–646, cwd fallback :648), `lookupOriginHost`:662, `parseRepoValue`:673, `readPRHead`:701, `GH_TIMEOUT_MS`:12. Tests: `makeGhShim` at `tests/canon-guard.test.ts:112`. Its line 115 exits 1 for any non-`api` argv, so it must learn `auth token`. The Amendment-1 host block is at :425–476. The forge host test is at `tests/forge-rest.test.ts:104`, with `beforeEach`/`afterEach` seam resets at :10–15.
- **Real path:** forge: every export → `ghApi` → `originHost()` → `runner(['api', …])`. The host gate goes inside `ghApi`, between `originHost()` and building the argv, so all five exports get it. Guard: `mergeRule` (:526) → `lookupPRHead` → `readPRHead(endpoint, cwd, host)`. Only the cwd fallback (:648) is gated. The `-R` host (:646) and the URL host (:638) are normalised only.
- **Callers:** `ghApi` is private, and its five callers' return contracts are unchanged. `setGhRunnerForTest`/`setOriginUrlReaderForTest` are used only in `tests/forge-rest.test.ts` (grep). They gain a cache-clear side effect. `lookupPRHead` has one caller (`mergeRule`), and its contract (head string, or `null` = fail open) is unchanged. The ship/safety fake gh helpers (`tests/run-task-ship-helpers.ts:71`, `tests/run-task-safety-helpers.ts:243`) exit 1 for non-`api` argv. Their fixtures use a local bare-path `origin`, so `parseRemoteHost` returns null, no auth probe runs, and they need no change.
- **Tests that can fail:** forge: at HEAD, `ghApi` passes the raw parsed host, so the alias origin sends `--hostname github-work` (the test expects none), `ssh.github.com` sends `--hostname ssh.github.com` (the test expects `github.com`), and the Enterprise-with-auth-failing case sends `--hostname ghe.example` (the test expects none). Guard: at HEAD, the alias origin logs one line, `api -X GET --hostname github-work …`, where the test expects the two-line sequence in Step 4. The `-R`/URL `api.github.com` cases log `--hostname api.github.com` where the test expects `github.com`. The new tests use only exports that exist at HEAD, so they fail on the assertion and not on import.
- **Predicates:** `normaliseGhHost(h)`: `github.com` → `github.com`; `ssh.github.com` and `api.github.com` → `github.com`. `notgithub.com` and `github.com.evil.example` are unchanged, because the check is exact-equal or `endsWith('.github.com')` and never `includes`. The input is already lowercased, but normalise lowercases again so an explicit host such as `GitHub.com` can't slip through. Auth gate: "known" only when the probe exits with status exactly 0. A spawn error (gh missing), a non-zero exit and a timeout (status `null`) all mean "not known", so no `--hostname` is passed. A null or empty parsed host means no probe and no flag.
- **Scope:** `forge.ts`, `tests/forge-rest.test.ts`, the guard and its mirror, `tests/canon-guard.test.ts` and `dist/` are all in Amendment 2's Affected Files. No other file changes.
- **Async/stateful:** forge has a process-lifetime cache `Map<string, boolean>` keyed by the normalised host, which the amendment allows ("may be cached for the process"). Stale state: a login made mid-run isn't seen until the next process, which is acceptable for a single `canon run`. Ownership: module-global, so both test setters clear it, or test order would leak results. The guard is one process per hook call, so it gets no cache. Everything is synchronous `spawnSync`, so re-entry and cancellation are N/A.

**Contradiction (recorded in notes.md, `[plan]`):** AC-1 says every `gh` call goes through one helper that "always passes `api` as the first argument". Amendment 2 mandates a `gh auth token --hostname` probe. The newest amendment wins. The probe goes through the same `runner` seam (`defaultRunner` → the single `runCommand('gh'`), so the AC-1/AC-2 grep still finds exactly one hit. Every forge call that reaches GitHub's API is still `gh api`. `gh auth token` is a local, offline credential read, not porcelain, so AC-1's intent (no GraphQL porcelain) holds. The spec is not edited.

### Step 1: Host normalisation and auth gate in the forge (AC-16)

File: `src/orchestrator/forge.ts`

- Add a private `function normaliseGhHost(host: string): string { const h = host.toLowerCase(); return h === 'github.com' || h.endsWith('.github.com') ? 'github.com' : h; }`. Keep it unexported, so the red-first tests don't depend on a new export.
- Add `const ghHostKnown = new Map<string, boolean>();` and `function apiHost(): string | null`:
  ```ts
  const raw = originHost();
  if (!raw) return null;
  const host = normaliseGhHost(raw);
  let known = ghHostKnown.get(host);
  if (known === undefined) {
      known = runner(['auth', 'token', '--hostname', host]).ok; // stdout (the token) is discarded, never logged or returned
      ghHostKnown.set(host, known);
  }
  return known ? host : null;
  ```
- `ghApi` uses `apiHost()` in place of `originHost()`. The argv shape is unchanged (`['api', '--hostname', host, …]`, or no flag).
- `setGhRunnerForTest` and `setOriginUrlReaderForTest` each call `ghHostKnown.clear()`.
- Update the comment above `ghApi`: the host comes from `origin`, `*.github.com` is normalised to `github.com`, and the host is passed only when `gh auth token --hostname` succeeds. Otherwise gh's default host (or `GH_HOST`) applies.
- Don't put the probe's stdout or stderr into any error, warning or `unreadable` reason. `apiHost` reads only `.ok`.

### Step 2: Forge tests (AC-16, AC-17 red-first, AC-13 still holds)

File: `tests/forge-rest.test.ts`

Write these before Step 1 (see the red-first note below).

- Add a helper in the file, `stubGh(authHosts: string[])`. It returns `{ apiCalls, authCalls }`. Its runner records each `['auth', 'token', '--hostname', h]` argv into `authCalls` and returns `result('gho_FAKE_TOKEN_SHOULD_NOT_LEAK', true)` when `h` is in `authHosts`, else `result('', false, 'not logged in')`. It records every other argv into `apiCalls` and answers with the same routing as the existing host test. Route by `argv.at(-1)` or `argv.some(a => a.includes(…))`, not by `argv.includes('/pulls?')`, which matches whole elements only (nit N4; fixing the routing here is incidental, not a scope item).
- Rewrite the existing `forge passes the parsed origin host to every REST call` test (:104) on that helper with `authHosts` = `['github.com', 'ghe.example']`. The AC-13 cases keep their expected hosts. Assert on `apiCalls` (5 entries). Add `assert.deepEqual(authCalls, [['auth', 'token', '--hostname', expectedHost]])`: one probe for five calls, which pins the cache. The `/tmp/local/origin.git` case asserts `authCalls` is empty.
- New test `forge gates --hostname on gh auth and normalises github.com subdomains (AC-16)`. Each row runs all five exports and asserts on every `apiCalls` argv and on `authCalls`:
  | origin | authHosts | expected `--hostname` | expected probe host |
  |---|---|---|---|
  | `git@github-work:o/r.git` | `['github.com']` | none | `github-work` |
  | `ssh://git@ssh.github.com:443/o/r.git` | `['github.com']` | `github.com` | `github.com` |
  | `https://ghe.example/o/r.git` | `['ghe.example']` | `ghe.example` | `ghe.example` |
  | `https://ghe.example/o/r.git` | `[]` | none | `ghe.example` |
  | `https://api.github.com/o/r` | `['github.com']` | `github.com` | `github.com` |
  | `https://notgithub.com/o/r` | `['notgithub.com']` | `notgithub.com` | `notgithub.com` |
  "None" means `argv[1] !== '--hostname'` and no element equals `'--hostname'`. Also pin one complete argv: the `ssh.github.com` `readPR(7)` call is `['api', '--hostname', 'github.com', '-X', 'GET', 'repos/{owner}/{repo}/pulls/7']`.
- Add a token-leak test (AC-16, "never written to any log, test output or error message"). Use the Enterprise origin with auth OK and make every api call fail with `result('', false, 'HTTP 502')`. Call each export and capture `console.log`/`console.warn`/`console.error` with `t.mock.method`. Assert the token string appears nowhere: not in `JSON.stringify` of `apiCalls`, not in the return values (the lookup's `unreadable` reason, `readPR` fields, the `mergePR`/`createDraftPR` results), and not in captured console output.
- **Red-first (AC-17):** with the tests written and `src/` still at HEAD `389251c`, run `node --test --import ./tests/md-loader-register.mjs --import tsx tests/forge-rest.test.ts`. No stub is needed: every seam these tests use exists at HEAD. Expected failures: the alias row (`--hostname github-work` present), the `ssh.github.com` row (`ssh.github.com` ≠ `github.com`), the Enterprise auth-failing row, the `api.github.com` row, and the `authCalls` deepEquals (HEAD makes no probe). Record the failing subtests and reasons, then implement Step 1 and re-run green.

### Step 3: Guard normalisation and auth gate (AC-16)

Files: `.claude/hooks/canon-guard.mjs`, then `npm run sync-templates` for `templates/.claude/hooks/canon-guard.mjs`

- Add `normaliseGhHost(host)` with the same rule as Step 1, and a comment saying it mirrors the forge module.
- Add `ghKnowsHost(host, cwd)`: `spawnSync('gh', ['auth', 'token', '--hostname', host], { cwd, stdio: 'ignore', timeout: GH_TIMEOUT_MS })`. With `stdio: 'ignore'` the token is never captured. Return `!result.error && result.status === 0`.
- In `lookupPRHead`:
  - cwd fallback (:648): `const origin = lookupOriginHost(cwd); const host = origin ? normaliseGhHost(origin) : null; return readPRHead(…, cwd, host && ghKnowsHost(host, cwd) ? host : null);`
  - `-R` branch (:646): pass `parsed.host ? normaliseGhHost(parsed.host) : null`. This is not gated, because the user named the host.
  - URL branch (:638): pass `normaliseGhHost(host)`. It isn't gated. This also lowercases the URL host. A port stays in place (nit N3, out of scope).
- A cwd fallback with a parseable origin now runs two gh spawns in sequence, each bounded by `GH_TIMEOUT_MS`. If the probe times out, the guard proceeds without `--hostname` and does not fail open early.

### Step 4: Guard tests (AC-16, AC-17 red-first)

File: `tests/canon-guard.test.ts`

Write these before Step 3.

- `makeGhShim`: before the `!= api` line (:115), add a branch for `auth token`. When `$1 = auth` and `$2 = token`, it reads the host from `$4`. If that host appears in the space-separated `CANON_GUARD_GH_AUTH_HOSTS`, it prints `gho_FAKE_TOKEN_SHOULD_NOT_LEAK` and exits 0; otherwise it exits 1. The existing log line (:114) already records the probe's argv, which never contains the token.
- In the Amendment-1 block (:425–476), give `runLogged` an optional `authHosts` argument that sets `CANON_GUARD_GH_AUTH_HOSTS`. Update the existing cwd-fallback expectations:
  - https Enterprise origin with `authHosts='ghe.example'` → lines `['auth token --hostname ghe.example', 'api -X GET --hostname ghe.example repos/{owner}/{repo}/pulls/12']`.
  - The scp `GHE.example` origin gives the same two lines.
  - No origin → unchanged (one line, no probe).
- New cwd-fallback cases (AC-16), each with an exact `deepEqual` on the lines, and each denied, because the shim's `*/12` still resolves to `task/foo`:
  - origin `git@github-work:o/r.git`, `authHosts='github.com'` → `['auth token --hostname github-work', 'api -X GET repos/{owner}/{repo}/pulls/12']`
  - origin `ssh://git@ssh.github.com:443/o/r.git`, `authHosts='github.com'` → `['auth token --hostname github.com', 'api -X GET --hostname github.com repos/{owner}/{repo}/pulls/12']`
  - origin `https://ghe.example/o/r.git`, `authHosts=''` → `['auth token --hostname ghe.example', 'api -X GET repos/{owner}/{repo}/pulls/12']`
- Explicit host cases (spec-review nit), not gated, so no probe line. With `authHosts=''`:
  - `gh -R api.github.com/o/r pr merge 12` → `['api -X GET --hostname github.com repos/o/r/pulls/12']`
  - `gh pr merge https://api.github.com/o/r/pull/12` → the same line.
  - `-R https://ghe.example/o/r.git` with `authHosts=''` still gives `--hostname ghe.example`, which proves explicit hosts skip the gate.
- Token: for the gated cases, assert that `result.stdout`, `result.reason` and the log file contents don't contain `gho_FAKE_TOKEN_SHOULD_NOT_LEAK`.
- The existing `-R` parse cases (:458–466) and the unparseable `-R` cases stay unchanged: explicit hosts aren't probed, so they still log one line.
- **Red-first (AC-17):** run `node --test --import ./tests/md-loader-register.mjs --import tsx tests/canon-guard.test.ts` with the guard at HEAD. Expected failures: the alias case (one line with `--hostname github-work`), the `ssh.github.com` case (`--hostname ssh.github.com`, no probe), the Enterprise auth-failing case, the `api.github.com` `-R`/URL cases, and the updated Enterprise cwd cases (HEAD makes no probe line). Record them, then implement Step 3 and re-run green.

### Step 5: Mirror, rebuild, validate, handoff

- `npm run sync-templates`, then `npm run sync-templates:check`.
- `npm run build`. `forge.ts` is bundled, so `dist/` changes; commit it.
- Run in full: `npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check`. Report any check that fails or can't run as exactly that. Review round 2 noted that the full `npm test` wasn't re-run last iteration (R2-N1), so run it this time.
- `grep -rn "runCommand('gh'" src` must still return exactly `forge.ts:13`.
- `grep -rn "gho_\|auth token" src .claude/hooks` should show only the probe call sites, with no logging of probe output.
- Handoff: append `## Iteration 4 — Amendment Round 2` with:
  - an AC delta table (AC-16, AC-17, and AC-13 re-confirmed with gh logged in);
  - a Red-First Evidence table with two rows (forge and guard). Each row gives the command run on HEAD `389251c` source, the failing subtests and reasons, and the post-fix result;
  - an Interpretations entry for the AC-1 "first argument is `api`" contradiction above, and one for the per-process forge cache;
  - under Blockers, SG1 marked as resolved by Amendment Round 2.

### Questions recorded (unattended)

- AC-1's "always passes `api` as the first argument" conflicts with Amendment 2's mandated `gh auth token` probe. Plan: the newest amendment wins. The probe shares the single `runCommand('gh'` site, so the grep form of AC-1/AC-2 holds. Recorded in notes.md; the spec is not edited.
- Should the forge cache "not logged in" results too? Plan: yes, both outcomes are cached per host per process. Re-probing on every call would add a gh spawn to each forge call for no practical gain within one run.
