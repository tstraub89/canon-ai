# Implementation Plan: artifact-lint-agent-fixup

> Written by: Claude | Implements: `tasks/artifact-lint-agent-fixup/spec.md`

## Approach

Add one shared async fix-up loop in `src/orchestrator/main.ts`. It does five things:

1. Runs the canon checker as a CLI in the tree being committed.
2. Filters the findings to the phase's own artifacts.
3. Resumes the owning agent session, at most 2 times, with a purpose-built prompt.
4. Guards scope with a content snapshot taken before and after each session.
5. Falls back to today's behavior with a warning.

Two thin wrappers feed it:
- implement: Codex resume, used by both auto-commit entry points.
- QA: Claude resume, using the in-process QA session id.

`autoCommitCode` and `commitQaArtifacts` stay synchronous and unchanged. The fix-up runs *before* them, so every existing die and message path is preserved byte-for-byte. AC-2 and AC-3 rely on that.

Alternatives rejected:
- **Making `autoCommitCode` async.** Many inline tests call it synchronously, and its early-return paths (operator-accepted, empty Changes table) would need the fix-up threaded through each one.
- **Parsing the hook output.** This is a spec Non-Goal.

### Feasibility check

- **Exists.** Verified by search:
  - `autoCommitCode` (`src/orchestrator/main.ts:407`).
  - `retryImplementAutoCommitAtReviewEntry` (`:388`), whose only src caller is the main loop (`:3815`).
  - `commitQaArtifacts` (`:874`).
  - `checkAndRoute` cases `'implement'` (`:3461`) and `'qa'` (`:3534`).
  - `operatorAcceptedImplement` (`:373`).
  - `retryAgentForPhase` (`:3113`), the pattern for the Codex/Claude resume config.
  - `lastClaudeSessionId` module var (`:88`), set from the QA `phaseResult` before `checkAndRoute` (`:3821`).
  - The `--pr` docs-refs gate spawn pattern (`:1192-1213`).
  - `runCodex(prompt, interactive, resumeId, model, effort, metricsContext, cwd, wrapForResume)` (`src/orchestrator/agents/codex.ts:30`). It **returns** non-zero exits and throws `AgentSessionError` only for spawn, stall or signal.
  - `runClaude(...)` (`src/orchestrator/agents/claude.ts:58`). It **throws** `AgentSessionError` on a non-zero exit and falls back internally when a resume target is not found.
  - The checker CLI (`scripts/docs-refs-check.mjs:936`). It takes repoRoot from `process.cwd()`, loads `<cwd>/scripts/docs-refs-config.mjs`, prints `file:line: ref — reason` lines plus `Found N broken ref(s)` to stderr, and exits 1 (or 0 with `All refs OK`).
  - Verified empirically in `/tmp`: a backticked missing path is reported as `missing file`, and `[x](x)` to a missing path is **not** reported. The script imports only node builtins, so it can be copied into a fixture as-is.
- **Real path.**
  - Implement: `main()` loop → `withAgentSessionPark(runPhase('implement'))` → session stored to `sessions.codex` (`:3843`) → `checkAndRoute('implement')` → `autoCommitCode`. `sessions.codex` is therefore fresh when the fix-up reads it.
  - Review entry: `main()` loop → `retryImplementAutoCommitAtReviewEntry` (outside the park wrapper) → `autoCommitCode`.
  - QA: `runQaPhase` runs Claude in `getActiveCwd(taskIds)` (`src/orchestrator/phases/qa.ts:37-46`) → `checkAndRoute('qa')` → `commitQaArtifacts(taskIds, getActiveCwd(taskIds))`.
  - Nothing today runs the checker before these commits. The only existing run is the `--pr` gate.
- **Callers.**
  - `retryImplementAutoCommitAtReviewEntry` becomes `async`. Callers: `main.ts:3815` (add `await`) and the `runReviewEntryRetryInline` test helper (`tests/run-task-safety.test.ts:1287`, change it to `return m.retry…(...)` so the promise is awaited).
  - `autoCommitCode`, `commitQaArtifacts` and `checkAndRoute` keep their signatures.
  - `promptQa`, `promptImplement*`: only template text changes.
- **Tests that can fail.**
  - AC-1 and AC-4: a handoff line with backticked `src/components/missing-widget.tsx`, plus a pre-commit hook running the checker. Pre-change, this dies with `Auto-commit failed:`.
  - AC-7: QA writes `done.md` with backticked `src/removed-by-task.ts`. Pre-change, the committed blob `git show HEAD:tasks/<id>/done.md` still contains the backtick form.
  - AC-5: the fake resume edits the already-dirty `initial-fixture.txt` or the task's `status.json`.
  - AC-6: the fake resume exits 1.
  - AC-8: the golden and structural asserts fail until the templates change.
- **Predicates.**
  - Checker result:
    - script absent → skip silently.
    - exit 0 → clean.
    - exit non-zero with ≥1 parsed finding line → findings.
    - exit non-zero with 0 parsed lines (crash or unparseable output), or a spawn error → "could not run" warning, no fix-up.
  - Filtered findings: an empty list means "nothing to fix". This covers AC-3 case 4: findings only in `review.md` or `docs/`.
  - Session id: `null` or `''` both count as no session.
  - Attempts: the loop runs `attempt = 1..2` inclusive and stops early when findings reach 0.
  - Session outcome:
    - Codex: ok iff no throw and `exitCode === 0`. A `null` exit code also counts as failure.
    - Claude: ok iff no throw.
  - Snapshot probe failure: before the session, skip the fix-up (do not run an unguarded session). After the session, stop the run (fail closed).
- **Scope.** Every changed file is in the spec's Affected Files:
  - `main.ts`, `validation.ts`, `prompts/index.ts`, the four templates and the new `artifact-fixup.md` template.
  - `docs/architecture.md`, `docs/pipeline-orchestrator.md` and its mirror `templates/docs/pipeline-orchestrator.md`, `docs/decisions.md`.
  - The two test files, the golden fixture, and the two dist files.
  - Unit tests for the new validation helpers go in `tests/run-task-safety.test.ts`, because `tests/run-task-validation.test.ts` is **not** in Affected Files (recorded in notes).
- **Async/stateful.**
  - The fix session runs after `checkAndRoute` has routed implement or QA to `done`. Catch `AgentSessionError` locally so `withAgentSessionPark` never sees it, which would reopen a done phase.
  - Non-`AgentSessionError` errors propagate. They are bugs, the same policy as the park boundary.
  - At the review-entry retry there is no park wrapper, so the same local catch prevents a crash.
  - No state is persisted across processes. The QA session id lives only in `lastClaudeSessionId` (spec Non-Goal: no QA slot).
  - Resumed sessions keep their original project root. Pass the same cwd they were created with: implement uses `getActiveCwd(taskIds)`, as `runImplementPhase` does. QA uses `getActiveCwd(taskIds)`, as `runQaPhase` does, **not** `retryAgentForPhase`'s `REPO_ROOT`.
  - Don't touch `lastCodexExitStatus`, `lastCodexSessionId` or `sessions.*` from the fix-up.

## Steps

### Step 1: Checker runner and finding filter (validation.ts)

Files: `src/orchestrator/validation.ts`

Add the following exports near the other handoff and artifact helpers. Use the `*FromData`-style pure seam per patterns "Validation Gate Discipline".

```ts
export type DocsRefsFinding = { file: string; line: number; ref: string; reason: string; raw: string };
export type DocsRefsRunResult =
    | { kind: 'absent' }
    | { kind: 'clean' }
    | { kind: 'findings'; findings: DocsRefsFinding[] }
    | { kind: 'error'; output: string };

/** Pure: parse the checker's stderr lines (`file:line: ref — reason`). */
export function parseDocsRefsFindings(stderr: string): DocsRefsFinding[]
/** Pure: keep findings whose `file` is one of `artifactPaths` (repo-relative POSIX). */
export function filterArtifactFindings(findings: readonly DocsRefsFinding[], artifactPaths: readonly string[]): DocsRefsFinding[]
/** Spawn `node <scriptPath>` with cwd = the tree being committed (same shape as the --pr gate). */
export function runDocsRefsCheck(cwd: string, scriptPath: string): DocsRefsRunResult
```

- The parser regex is `/^(.+?):(\d+): (.+) — (.+)$/`, applied per line. The separator is an em dash surrounded by spaces, matching `printFindings` in the checker. Skip the `Found N broken ref` line and anything else that does not match. `raw` keeps the original line for prompts and warnings.
- `runDocsRefsCheck`:
  - Return `absent` when `!fs.existsSync(scriptPath)`.
  - Otherwise call `spawnSync('node', [scriptPath], { cwd, stdio: ['ignore','pipe','pipe'], encoding: 'utf8' })`.
  - `status === 0` → `clean`.
  - Spawn error or non-zero status with no parsed findings → `error` carrying the trimmed stderr/stdout.
  - Otherwise → `findings`.
- Do not pass a repoRoot argument. The CLI must default to `cwd` so it loads the adopter's `scripts/docs-refs-config.mjs` from the committed tree (spec Implementation Notes).
- `spawnSync` import: check whether validation.ts already imports `node:child_process`; add it if not.
- The caller passes the script path (`path.join(REPO_ROOT, 'scripts', 'docs-refs-check.mjs')`, as the `--pr` gate does). That keeps validation.ts free of an `env.js` import and leaves a seam for tests.

### Step 2: Fix-up prompt template and builder

Files: `src/orchestrator/prompts/templates/artifact-fixup.md` (new), `src/orchestrator/prompts/index.ts`

- Register the template in `TEMPLATES` and add the default import, the same as the other `.md` modules (`src/orchestrator/prompts/index.ts:13-37`).
- Builder:

```ts
export function promptArtifactFixup(input: {
    phase: 'implement' | 'qa';
    findings: readonly string[];      // raw checker lines, already filtered
    artifacts: readonly string[];     // repo-relative own-artifact paths for the whole bundle
    attempt: number;
    maxAttempts: number;
}): string
```

- The template is Mustache, rendered unescaped by `renderTemplate`. Required content, in this order:
  1. Header: `ARTIFACT FIX-UP ({{attempt}}/{{maxAttempts}}): before committing, canon ran docs-refs-check and found broken references in task artifacts you wrote:` followed by the finding lines, each indented four spaces so backticks in them don't nest.
  2. Phase lock, verbatim except for the phase: `The {{phase}} phase is already complete. This turn overrides the session instructions above about finishing with a phase command: do not run \`canon task phase\` or any other \`canon\` command.`
  3. Scope: `Edit only these files:` followed by the artifact list. Then: `Do not change any other file — including notes.md, status.json, and source or test files. Canon compares the working tree before and after this turn and stops the run if anything else changed.` For implement, add: `Do not run git add or git commit; the orchestrator commits after this turn.`
  4. The canonical citation rule (Step 3), verbatim.
  5. `Fix each listed reference — correct the path, switch a missing file to the markdown-link form, or rephrase it as plain prose if it is not a file reference. Reply with tool calls only.`
- The builder joins `findings` and `artifacts` into pre-rendered strings (`findingsBlock`, `artifactsBlock`) before rendering, so the template needs no Mustache sections.
- Name no canon-ai file, to respect adopter scope. `docs-refs-check` is fine because adopters receive the checker.

### Step 3: Citation guidance in the four phase templates

Files: `src/orchestrator/prompts/templates/implement.md`, `implement-reroute.md`, `implement-revisions.md`, `qa.md`

Use this exact canonical sentence. Per patterns, a rule homed on multiple surfaces is copied verbatim and pinned from one test constant:

> `**Citing files in task artifacts:** cite every repository file by its full path from the repository root, including any workspace or package prefix — never a path relative to a package or to the current directory. For a file that does not exist — one this task deleted, or one only planned — use the markdown-link form \`[path](path)\` instead of backticks, because \`docs-refs-check\` reports a backticked path to a missing file as a broken reference.`

Do **not** add a backticked example path such as a `src/...` file. The template `.md` files are scanned by the repo's own `docs-refs-check`, and a backticked nonexistent example would fail AC-10.

Placement:
- `implement.md`: a paragraph right after the line `For each task, write tasks/<id>/handoff.md using the template…` (`:58`).
- `implement-reroute.md`: a paragraph right after step 7, "**Rewrite handoff.md**" (`:22`).
- `implement-revisions.md`: replace the existing bullet at `:41` ("**Referencing deleted (or not-yet-created) files in artifacts**…") with a bullet holding the canonical sentence, followed by its table-specific tail: ` In the handoff Changes-table first column this is the only accepted form for a deleted path — backtick form fails both checks.` Keep that tail so the Changes-table parser rule isn't lost.
- `qa.md`: a standalone paragraph right after numbered item 4 (pr-body.md), so it governs both done.md and pr-body.md.

### Step 4: Scope-guard snapshot (main.ts)

Files: `src/orchestrator/main.ts`

```ts
type ScopeSnapshot = Map<string, string>; // path → `${XY}:${sha256|absent|dir|symlink:<target>}`
function snapshotOutsideArtifacts(cwd: string, taskIds: readonly string[]): { ok: true; snap: ScopeSnapshot } | { ok: false; error: string }
export function diffScopeSnapshots(before: ScopeSnapshot, after: ScopeSnapshot, exempt: ReadonlySet<string>): string[] // sorted changed paths
```

- Source of entries:
  - `gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall')` → `splitGit.parsePorcelainEntries` (decoded paths). Use every path of each entry (both sides of a rename; reuse `porcelainEntryPaths`).
  - Always add `tasks/<id>/status.json` for each bundle id, even when clean, so the spec's status.json coverage doesn't depend on dirtiness.
- Value per path: the entry's two status columns plus a content fingerprint.
  - `lstat`: missing → `absent`; symlink → `symlink:<readlink>`; directory → `dir`; file → sha256 of its bytes (`node:crypto`).
  - Paths that only show up in `after` are differences, because `before` lacks them (new dirt on a previously clean file).
- Exempt set, built by the caller:
  - The phase's own artifacts for every bundle id.
  - Canon-runtime files canon itself writes during a session, for every bundle id: `tasks/<id>/metrics.md` (recordMetric) and `tasks/<id>/.heartbeat.json`, `.canon-pid`, `.canon-run.log`. The last three are gitignored in adopters but not in test fixtures.
  - Nothing else. Telemetry docs are **not** exempt: canon doesn't write them mid-session, so any change there came from the agent.
- `ok: false` when the status probe fails. Patterns: "Write-safety guards must fail closed".

### Step 5: Shared fix-up loop (main.ts)

Files: `src/orchestrator/main.ts`

```ts
const ARTIFACT_FIXUP_MAX_ATTEMPTS = 2;

async function fixUpOwnArtifactRefs(opts: {
    phase: 'implement' | 'qa';
    taskIds: string[];
    cwd: string;
    sessionId: string | null;
    artifactNames: readonly string[];           // ['handoff.md'] | ['done.md', 'pr-body.md']
    runSession: (prompt: string) => Promise<boolean>; // true = session succeeded
}): Promise<void>
```

Algorithm:

1. Compute `artifacts = taskIds × artifactNames` → `tasks/<id>/<name>`.
2. Run `check = runDocsRefsCheck(cwd, path.join(REPO_ROOT, 'scripts', 'docs-refs-check.mjs'))`.
   - `absent` / `clean` → return.
   - `error` → `warn('Artifact fix-up skipped: docs-refs-check could not run in <cwd>:\n<output>')` and return.
3. `own = filterArtifactFindings(check.findings, artifacts)`. If empty → return silently (AC-3 case 4).
4. If `!sessionId`:
   - Warn: `docs-refs-check found broken references in the {phase} artifacts, but no {agent} session is available to fix them:\n<raw lines>`.
   - Add the phase-specific consequence line:
     - implement: `Committing as before; a pre-commit hook that runs docs-refs-check will reject the commit.`
     - QA: `Fix them before --pr; its docs-refs gate will stop on them.`
   - Return.
5. For `attempt = 1..ARTIFACT_FIXUP_MAX_ATTEMPTS`:
   1. Take the pre-session snapshot: `pre = snapshotOutsideArtifacts(cwd, taskIds)`. If `!pre.ok`, warn that the fix-up was skipped because the working tree could not be inspected, then return. Never run an unguarded session.
   2. `info('Artifact fix-up (attempt N/2): resuming the {phase} session to fix N broken reference(s) in <artifact list>.')`. This is the spec's "one info line per fix-up attempt".
   3. Run the session:
      - `ok = await opts.runSession(promptArtifactFixup({ phase, findings: own.map(f => f.raw), artifacts, attempt, maxAttempts }))`.
      - Wrap it in `try { … } catch (e) { if (!isAgentSessionError(e)) throw e; warn(…e.reason…); ok = false; }`.
   4. Take the post-session snapshot, `post = snapshotOutsideArtifacts(...)`.
      - If `!post.ok`, `die('Artifact fix-up stopped the run: could not inspect the working tree after the fix session (<error>). Nothing was committed; inspect the tree before re-running.')`.
      - Otherwise compute `changed = diffScopeSnapshots(pre.snap, post.snap, exempt)`.
   5. If `changed.length > 0`, `die('Artifact fix-up stopped the run: the {phase} fix session changed files outside its own artifacts:\n    <paths>\nNothing was committed. Review and revert those changes, then re-run canon run <ids>.')`.
      - This runs **before** the session-failure check, so a failed session that still edited files is caught.
      - `die` exits 1 and sets the exit reason. Nothing is committed because the caller's commit hasn't run.
   6. If `!ok`, warn that the fix session failed, list the remaining findings plus the phase consequence line, and return.
   7. Re-check: the same `runDocsRefsCheck` and filter.
      - `absent` / `error` → warn and return.
      - 0 own findings → `info('Artifact fix-up fixed the broken references.')` and return.
      - Otherwise set `own` to the new list and continue.
6. After the loop: `warn('docs-refs-check still reports broken references in the {phase} artifacts after 2 fix-up attempts:\n<raw lines>\n<consequence line>')`.

Snapshots are taken per attempt, so attempt 2's own artifact edits from attempt 1 are already in `pre`. That doesn't matter, because own artifacts are exempt anyway.

### Step 6: Implement wiring — both entry points

Files: `src/orchestrator/main.ts`

```ts
async function fixUpImplementArtifactRefs(taskIds: string[], cwd: string): Promise<void> {
    if (operatorAcceptedImplement(taskIds, cwd)) return; // autoCommitCode skips the commit too
    const sessionId = splitState.readStatus(taskIds[0]).sessions?.codex ?? null; // bundle shares one implement session
    await fixUpOwnArtifactRefs({
        phase: 'implement', taskIds, cwd, sessionId, artifactNames: ['handoff.md'],
        runSession: async prompt => {
            const cfg = splitPolicy.getCodexConfig('implement', fixupTaskContexts(taskIds));
            const result = await splitCodex.runCodex(prompt, false, sessionId!, cfg.model, cfg.effort,
                { taskId: taskIds[0], phase: 'implement_fixup', activeCwd: cwd }, cwd, false);
            return result.exitCode === 0;
        },
    });
}
```

- Add `fixupTaskContexts(taskIds)`. It builds `TaskContext[]` from `readStatus` for **every** bundle id, using the same zeroed shape `retryAgentForPhase` builds (`:3155-3168`), so policy sees the bundle's max size and delicate flag. Don't refactor `retryAgentForPhase`.
- Run always headless (`interactive = false`), even under `--interactive`. This is a single-purpose turn.
- `wrapForResume = false`: the prompt is purpose-built. `CODEX_HEADLESS` is still prepended by `runCodex`, and the prompt's phase-lock line overrides its "run the phase command" instruction.
- `checkAndRoute` `case 'implement'`:
  ```ts
  case 'implement': {
      const cwd = splitWorktree.getActiveCwd(taskIds);
      await fixUpImplementArtifactRefs(taskIds, cwd);
      autoCommitCode(taskIds, cwd);
      return;
  }
  ```
- `retryImplementAutoCommitAtReviewEntry` becomes `export async function …: Promise<boolean>`. Insert `await fixUpImplementArtifactRefs(taskIds, cwd);` between the `info('Retrying the implement auto-commit…')` line and `autoCommitCode(...)`.
- At `main.ts:3815`, add `await`.
- No park wrapper exists on this path. The local `AgentSessionError` catch in Step 5 is what keeps a failed session from crashing (AC-4).

### Step 7: QA wiring

Files: `src/orchestrator/main.ts`

```ts
case 'qa': {
    const cwd = splitWorktree.getActiveCwd(taskIds);
    const qaSessionId = lastClaudeSessionId; // set from this process's QA phaseResult just before checkAndRoute
    await fixUpOwnArtifactRefs({
        phase: 'qa', taskIds, cwd, sessionId: qaSessionId, artifactNames: ['done.md', 'pr-body.md'],
        runSession: async prompt => {
            const cfg = splitPolicy.getClaudeConfig('qa', fixupTaskContexts(taskIds));
            await splitClaude.runClaude(prompt, false, qaSessionId!, cfg.model, cfg.effort, cfg.budget,
                { taskId: taskIds[0], phase: 'qa_fixup', activeCwd: cwd }, cwd);
            return true; // runClaude throws AgentSessionError on non-zero exit
        },
    });
    commitQaArtifacts(taskIds, cwd);
    return;
}
```

- `checkAndRoute` has a single caller, the main loop (`:3848`). It runs immediately after `lastClaudeSessionId` is assigned from that phase's result, so the id is the QA session's, or null for an interactive or session-less run. That gives AC-7's no-session case.
- The QA-end commit is unchanged. Remaining findings warn and the pipeline reaches `human_review`.
- runClaude's built-in resume-not-found fallback (fresh session plus the same prompt) is accepted per the Non-Goals. The scope guard still applies.

### Step 8: Docs

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` (via `npm run sync-templates`), `docs/decisions.md`, `docs/architecture.md`

- `docs/pipeline-orchestrator.md` §Auto-Branch + Auto-Commit: add a paragraph after the "If an auto-commit fails…" paragraph. It covers:
  - Before either implement auto-commit (post-implement and the review-entry retry), canon runs the shipped docs-refs checker in the active checkout.
  - If the checker reports broken refs in a bundle task's handoff.md, canon resumes the stored Codex implement session with the findings, at most 2 times. Findings in other files are ignored.
  - With no session, a failed session, or findings remaining, canon warns and commits as before.
  - The QA-end commit gets the same treatment for done.md and pr-body.md, using the in-process QA session. Remaining findings warn, and `--pr`'s gate is unchanged.
  - Scope guard: any change outside the phase's own artifacts (including status.json) during a fix session stops the run with nothing committed.
- §Session Resumption: in the sentence "Plan and QA sessions are intentionally one-offs (never stored)", add that QA's session id is still resumed in-process once, for the artifact fix-up above, and is never persisted.
- Run `npm run sync-templates`, then `npm run sync-templates:check`. The mirror lands in the diff, so list it in the handoff Changes table (patterns: "Declare templates/ mirrors").
- `docs/decisions.md` "Auto-commit owned by the orchestrator": append one sentence to **Rule**. Before committing, the orchestrator may resume the implementer to fix broken references in its own handoff (bounded, scope-guarded); the commit itself stays orchestrator-owned. This doc is root-only: **no** mirror row.
- `docs/architecture.md` step 8 (`:85`): append one sentence. Before staging, it runs docs-refs-check and resumes the implement session (≤2 times) to fix broken refs in handoff.md. Root-only, no mirror.
- Do not edit `docs/BACKLOG.md`. The spec leaves it for QA.

### Step 9: Tests — harness extension

Files: `tests/run-task-safety.test.ts`

Extend `setupInvocationLoggingCliTools` with **opt-in** env vars only, so every existing test's behavior is byte-identical:
- `FAKE_AGENT_ARGV_LOG`: if set, append one JSON line `{"agent":"codex","argv":[...]}` per invocation, using `node -e` with `"$@"`. Keep `FAKE_AGENT_LOG`'s one-name-per-line format, because many tests assert `['codex']`.
- `FAKE_AGENT_EDIT_SCRIPT`: if set, run `node "$FAKE_AGENT_EDIT_SCRIPT" <agent> "$@"` after logging. A non-zero exit from it becomes the fake agent's exit code (`|| exit $?`). The script receives argv, so it can tell a resume from the first run: codex `exec resume <id>`, claude `--resume <id>`.
- `FAKE_AGENT_SKIP_COMPLETE_ON_RESUME=1`: don't run the completer on resume invocations. Without it, the completer rewrites status.json during a fix session and trips the scope guard.
- `FAKE_CODEX_THREAD_ID` / `FAKE_CLAUDE_SESSION_ID`: if set, the fake prints `{"type":"thread.started","thread_id":…}` (codex) or `{"type":"result","result":"ok","session_id":…}` (claude) to stdout, so the real session-storage path runs.

Fixture helpers:
- `installDocsRefsChecker(repoDir, { hook: boolean })`:
  - Copy `path.join(WORKTREE_ROOT, 'scripts', 'docs-refs-check.mjs')` into `<repo>/scripts/` and commit it in the baseline.
  - With `hook`, write `.git/hooks/pre-commit` as `#!/bin/sh\nexec node scripts/docs-refs-check.mjs\n` (mode 755). The hook lives in the common git dir, so worktrees inherit it.
- `makeBootstrappedTaskWorktreeFixture`: `mkdirSync(path.dirname(...), {recursive:true})` before writing `initialFiles`, so `scripts/docs-refs-check.mjs` can be passed as an initial file.
- **Pitfall:** `makeGitFixture` has no `.gitignore`. `runReviewLoopMain` puts `agent-invocations.log` inside the repo, and the fake appends to it during the fix session, which trips the scope guard. In every new test, override `FAKE_AGENT_LOG` (and the argv log) to paths under `dir`, outside the repo, via `extraEnv`.
- `runReviewEntryRetryInline`: `return m.retryImplementAutoCommitAtReviewEntry(...)` so the now-async call is awaited.

### Step 10: Tests — AC coverage

Files: `tests/run-task-safety.test.ts`

Model the implement tests on `'main runs the first implement pass when MAX_REVIEW_LOOPS=0 on a genuinely fresh task'` (`:7228`): `writeReviewLoopFixture` plus a fake codex that edits `initial-fixture.txt` and `FAKE_AGENT_COMPLETE_PHASE: 'implement'`. Add:
- `installDocsRefsChecker`.
- A handoff line `- \`src/components/missing-widget.tsx\` reused` appended to `handoff.md`.
- `FAKE_CODEX_THREAD_ID`.
- `FAKE_AGENT_SKIP_COMPLETE_ON_RESUME=1`.

Each test asserts **exit status and stdout together** (`combinedOutput`).

- **AC-1** (red-first, hook on): on resume, the edit script rewrites the line to `[src/components/missing-widget.tsx](src/components/missing-widget.tsx)`.
  - Exactly one argv entry whose argv contains `exec`,`resume`,`<thread id>`.
  - Exit 0, and HEAD advanced with `initial-fixture.txt` in `git show --name-only HEAD`.
  - `status.json` `status === 'code_review'` and implement `done`.
  - Stdout matches `/Artifact fix-up \(attempt 1\/2\)/`.
  - Record the pre-change red run (`Auto-commit failed:`) in the handoff.
- **AC-2** (hook on, the edit script never fixes):
  - Exactly 2 resume entries.
  - Output matches `/after 2 fix-up attempts/` and names `missing-widget.tsx`, then `/Auto-commit failed:/`, with exit 1 and HEAD unchanged.
  - Implement `done`, not blocked. Code_review `iterations_current_loop` and `preflight_rejections_current_loop` stay `0`/unset.
  - Interpretation: these mirror the counters asserted by `'main stops before code_review preflight when the review-entry retry commit fails'` (`:1539`). That is the main-driven failing-hook case named in AC-2.
- **AC-3** (zero codex resume entries in each):
  1. Checker installed, clean handoff, hook `exit 1`: `/Auto-commit failed:/`.
  2. No checker (existing fixtures, unchanged): exit 0.
  3. Checker plus broken ref but no `FAKE_CODEX_THREAD_ID`, and no pre-seeded `sessions.codex`: warning `/no codex session is available/`, then today's behavior. Without a hook, the commit succeeds.
  4. Broken ref only in `tasks/<id>/review.md`, or only in a committed `docs/notes-page.md`: no fix-up and no fix-up warning.

  The existing failing-hook tests must pass unchanged.
- **AC-4**: `prepareReviewEntryMainFixture(…, false, true)` plus `installDocsRefsChecker` into the base via `initialFiles`, hook on, `sessions.codex` pre-seeded in the fixture status, and the broken handoff line. The fixture's fake codex is replaced with a harness-backed one.
  - The resume fixes the line, the retry commits, and the run proceeds into code_review (exit 0, `/Retrying the implement auto-commit/`, one resume entry with the seeded id).
  - Second case: no hook, and the resume exits 1. No crash: exit 0, the commit lands, the task enters code_review, and nothing is blocked.
- **AC-5**: the edit script on resume appends to the already-dirty `initial-fixture.txt`.
  - Exit 1, output names `initial-fixture.txt` under `/changed files outside its own artifacts/`, HEAD unchanged.
  - Variant: it edits `tasks/<id>/status.json` (adds a key), and the output names that path.
  - QA variant: in the AC-7 fixture, the resume writes a new committed-file edit (e.g. modifies `initial-fixture.txt`). Exit 1, the path is named, and no `chore: QA artifacts` commit exists.
- **AC-6**:
  - Implement, no hook: the resume exits 1. Implement stays `done` (not `blocked`), no escalation is added, the commit lands, and status reaches `code_review`.
  - QA: the claude resume exits 1, so `runClaude` throws `AgentSessionError`, which is caught. Output matches `/fix session failed/`, the task reaches `human_review`, and QA is not blocked.
- **AC-7**: a QA fixture modeled on the force-accept→QA test (`:7330`, `FAKE_AGENT_COMPLETE_PHASE: 'qa'`).
  - Install the checker **without** a hook. A hook would turn the never-fixed case into a QA-end commit die.
  - The first claude invocation's edit script writes a complete `done.md` citing backticked `src/removed-by-task.ts`. Set `FAKE_CLAUDE_SESSION_ID`.
  - The implementer must confirm which `done.md` sections the QA evidence check needs.
  - Fixed: one `--resume <id>` entry, and `git show HEAD:tasks/<id>/done.md` contains `[src/removed-by-task.ts](src/removed-by-task.ts)` and not the backtick form. Red-first: pre-change, the committed blob still has the backtick form; record that in the handoff.
  - Never fixed: 2 resume entries, warning, `human_review`.
  - No session id (`FAKE_CLAUDE_SESSION_ID` unset): warning, zero resume entries, `human_review`.
- **Unit tests** (same file):
  - `parseDocsRefsFindings`: an em-dash line, a `Found N` line skipped, a garbage line skipped, a path containing `:`.
  - `filterArtifactFindings`: bundle paths kept, `review.md` and `docs/` dropped.
  - `diffScopeSnapshots`: new path, changed hash, changed XY, exempt path ignored, identical maps → `[]`.

### Step 11: Prompt tests and goldens

Files: `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`

- Add `const CITATION_RULE = '<canonical sentence from Step 3>'`. Assert it is included in `promptImplement(...)` fresh, `promptImplementRevisions`, `promptImplementReroute`, `promptQa`, and both fix-up prompts. Use the existing golden states.
- New golden keys:
  - `promptArtifactFixup_implement`: one task, `handoff.md`, attempt 1/2, two finding lines.
  - `promptArtifactFixup_qa`: `done.md` + `pr-body.md`.
- Structural asserts on both: `/do not run `canon task phase`/` and `/phase is already complete/`.
- Regenerate with `UPDATE_GOLDENS=1 npm test`. Then run `npm test` without it and review the golden diff: only the four template-driven keys plus the two new keys should change.

### Step 12: Build and validate

- `npm run build`, then commit `dist/cli/index.js` and `dist/orchestrator/run-task.js`. The orchestrator owns the commit.
- `npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check`.
- The handoff Changes table lists every file above, including `templates/docs/pipeline-orchestrator.md`. Cite paths in full, following the new rule.

## Testing Plan

- **Unit**: the checker output parser, the artifact filter, and the snapshot diff (Step 10), plus prompt goldens and the citation-rule pins (Step 11).
- **Integration** (`main()` in-process with fake agents and real git): AC-1 through AC-7 as listed in Step 10.
- **E2E**: N/A (spec).
- **Manual**: the spec's Human Test Plan. A real implement run whose handoff cites a nonexistent path should log `Artifact fix-up (attempt 1/2)` and enter code_review.

## Open questions / interpretations (unattended plan session)

- **AC-2 "counters equal today's main-driven failing-hook test."** That test (`:1539`) runs at code_review entry and asserts code_review `preflight_rejections_current_loop`/`iterations_current_loop` = 0. The plan asserts the same counters plus implement `done` for the post-implement path.
- **Metrics rows** for fix sessions use phase labels `implement_fixup` / `qa_fixup`. Nothing parses metrics by phase name (`src/orchestrator/telemetry-fold.ts` only folds rows), and distinct labels keep fix-up cost visible without inflating implement/QA counts.
- **Fix-up always runs headless**, even under `--interactive`.
