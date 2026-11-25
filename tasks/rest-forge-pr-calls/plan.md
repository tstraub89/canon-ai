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
