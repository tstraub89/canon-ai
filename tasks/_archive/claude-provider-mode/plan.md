# Implementation Plan: claude-provider-mode

> Written by: Claude | Implements: `tasks/claude-provider-mode/spec.md`

## Approach

The provider is a per-task pin (`status.json.provider`). `canon run` resolves it once, at startup, into a run-scoped `Provider`. The pure policy maps it to a `RoleAssignment`, and every backend lookup takes that assignment explicitly. The assignment travels on `PipelineState` (new required `provider` field) into the phase runners and prompt builders. Code in `main.ts` that has no `PipelineState` (recovery, fix-up, park, reroute, banners) reads a module-level `runProvider` that `main()` pins once; outside `main()`, such as in tests, it falls back to the task's stored provider. Sessions gain a parallel `session_backends` tag map. `state.ts` is the only writer and clearer of that map, and a new `usableSessionId` helper checks the tag where each slot is used. Mixed mode stays byte-identical because every role-holder string is computed from the mixed assignment, which yields today's literals.

Spec review verdict: **approved**, with no findings or nits to fold in.

### Feasibility check

- **Exists:** All of these were confirmed by search: `DEFAULT_ROLE_ASSIGNMENT`, `roleBackendId`, `requiredAgentBackends`, `phaseSessionSlot` (`src/lib/pipeline-policy.ts:364-384`); `agentBackendFor` (`src/orchestrator/agents/backend.ts:47`); `claudeBackend.resolveConfig` guard (`claude.ts:313-318`); `AgentSessionError` (`errors.ts`); `storeSessionId` / `getStoredSessionId` / `clearSessionPair` / `LEGACY_SESSION_SLOTS` (`state.ts:475-509`); `withAgentSessionPark` / `parkAgentSessionFailure` (`main.ts:3585-3612`); `retryAgentForPhase` (`main.ts:3497`); `fixUpOwnArtifactRefs` / `fixUpImplementArtifactRefs` (`main.ts:484-570`); `printDryRunPlan` (`main.ts:1756`); `checkDeps` (`main.ts:3929`, `src/cli/deps.ts:24`); `HARD_DEPS` (`deps.ts:9`, built at module load); doctor `requiredAgents` (`doctor.ts:729`); `writeColdCodexArchive` (`review-archive.ts:19`); `CODEX_STARTUP` / `CLAUDE_HEADLESS` / `toResumePrompt` (`prompts/helpers.ts`); `SETTABLE_FIELDS` / `TASK_SET_FIELD_VALUES` / `REDIRECT_MESSAGES` (`src/task/index.ts:27-43`). Completion already builds its model from `SETTABLE_FIELDS` and `TASK_SET_FIELD_VALUES` (`completion.ts:58-59`), so `src/cli/commands/completion.ts` needs **no change**. Only its golden changes.
- **Real path:** `main()` → `checkDeps` → (dry-run | reroute | loop) → `buildPipelineState` → `withAgentSessionPark(runPhase)` → phase runner → `agentBackendFor(role).run` → `runClaude`/`runCodex`. After the phase, `main` stores the session (`main.ts:4209-4218`), then `checkAndRoute` runs: evidence, retry, fix-up, then the commit. Parts of the work already exist on this path. `withAgentSessionPark` is the single park boundary. `clearSessionPair` is the single clear helper, and both resets in `task/index.ts`, both reroute clears and the no-diff guard already use it. Doctor already filters binaries and the Codex trust check by `requiredAgents`, so only the source of that set changes. `writeColdCodexArchive` takes an arbitrary body, so `review-archive.ts` needs **no change**.
- **Callers:**
  - `roleBackendId`: `requiredAgentBackends`, `backend.ts`, and `tests/run-task-validation.test.ts:4357`.
  - `requiredAgentBackends`: `deps.ts`, `doctor.ts`, `main.ts:3931`, and the `policy.ts` re-export.
  - `agentBackendFor`: `main.ts:564,1774,3501,3912,4217`; `spec.ts:39,55`; `spec-review.ts:104`; `plan.ts:22`; `implement.ts:91`; `qa.ts:36`; `code-review.ts:419,454` (through `deps`). Test stubs: `tests/run-task-code-review.test.ts:299` plus direct `deps.agentBackendFor('cold_reviewer')` calls at `1482,1484,1517,1519,1570,1572,1607,1609`, which need the second argument for type-check; `tests/recovery-hints.test.ts:1003` (a stub implementation, so fewer parameters still type-check); and the inline scripts in `tests/agent-backend.test.ts:57,130`, which would crash at runtime without an assignment.
  - `storeSessionId`: `main.ts:4215` and `tests/agent-backend.test.ts:98`.
  - `getStoredSessionId`: `main.ts:561,3166-3173,3504`. All three move to `usableSessionId`. The raw reader stays for tests.
  - `clearSessionPair`: `task/index.ts:1115,1186`, `main.ts:3065,3083`, `implement.ts:132`. It keeps its contract and now also drops the tag.
  - `AgentSessionError` constructor: `claude.ts`, `codex.ts`, `code-review.ts`. The new field is optional, so only `claude.ts` changes.
  - `runClaude`: only `claude.ts:323`.
  - `deps.checkDeps`: `init.ts:76` (no-arg, unchanged) and `tests/agent-backend.test.ts:121,143`.
  - `buildPipelineState`: `main.ts` (4 sites), `tests/run-task-safety.test.ts` (8), `tests/run-task-reroute-preflight.test.ts` (1). The parameter is optional, so no test change is needed.
  - `PipelineState` literals: `tests/run-task-prompts.test.ts` (`makeState` plus inline bundle states), `tests/recovery-hints.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-safety.test.ts` (2). Each gains `provider: 'mixed'`.
- **Tests that can fail:** Each test in the Testing Plan names the state that drives it through the changed path. Before handoff, the implementer reverts each wiring line once and confirms the test turns red. Examples: drop the `storeSessionId` in park and the AC-6 slot assertion fails; drop the `provider === 'claude'` branch in code review and the AC-10 "cold review not called" stub assertion fails.
- **Predicates:** see "Predicates and boundaries" below. Every condition the steps introduce is listed there with its boundary values.
- **Scope:** Every file changed below is in Affected Files. Two Affected Files entries need no edit, and the handoff should say so: `src/orchestrator/review-archive.ts` (the writer already takes any body) and `src/cli/commands/completion.ts` (it already derives from the task metadata). `templates/docs/pipeline-orchestrator.md` changes only through `npm run sync-templates`. `src/orchestrator/context.ts`, `src/orchestrator/agents/codex.ts`, `implement.md` and `implement-revisions.md` are **not** in scope and are not edited. See step 6 for how the park-resume prompt works around `context.ts`.
- **Async/stateful:**
  - **Once per run.** `runProvider` is assigned once in `main()` (step 7a) and never re-read. The detached child re-resolves at its own start, which is still one read per process.
  - **Park ordering.** The session is stored before `autoBlockPhase`. Both are read-modify-write per task with no agent running in between.
  - **Mismatch clearing.** `usableSessionId` clears per task in one atomic `writeStatus` each.
  - **Ownership.** No `sessions.` or `session_backends.` write happens outside `state.ts` (Known Risk: tag/clear drift). The reviewer should grep for direct writes.

### Predicates and boundaries

| Predicate | Values and states it must handle |
|---|---|
| `CANON_PROVIDER` (`resolveProviderSetting`) | `undefined` and `''` resolve to `mixed`. `'mixed'` and `'claude'` are exact, case-sensitive matches. `'codex'` gets the Codex-only message. `'Claude'`, `' claude'`, `'MIXED'` and `'bogus'` get the invalid message. There is no trimming. |
| `status.provider` (`resolveTaskProvider`) | `undefined` (key absent) resolves to `mixed`. `'mixed'` and `'claude'` are valid. `null`, `''`, `'codex'`, `'Claude'` and any non-string are refused with the AC-1 message, naming the task and the `status.json` source. Validation is **not** added to `validateStatus`, so `canon task list/status/set` keep working on a bad pin and `task set` can fix it. |
| Bundle provider | Absent counts as `mixed`. More than one distinct resolved value is refused, naming every task and its provider. An invalid member is refused first with its own message. |
| Session tag (`storedSessionBackend`) | No tag: the mixed assignment's backend for that slot's role. `'claude'` or `'codex'`: used as is. Any other string (hand edit): a mismatch, so canon warns and clears. |
| `usableSessionId` | No session (no role key and no legacy key) returns `null` with no warning. Tag equals the current backend: return the id. Tag differs: warn with slot, stored backend and current backend; clear the pair and tag on every bundle member; return `null`. |
| Park store | Requires all of: provider `'claude'`; phase `implement` or `spec_review`; `error.agent === 'claude'`; `error.sessionId` a non-empty string. Otherwise nothing is written, including for mixed tasks, other phases, and failures with no session id. |
| Implement park-resume entry | Requires provider `'claude'`, `!isRevision`, `!isRerouted`, `tasks.some(t => implement.status === 'blocked')` (a park blocks every member, so `some` and `every` agree), and `resumeId !== null`. The id comes from `usableSessionId`, so it is Claude-tagged or legacy-attributed to Claude. Under `claude`, an untagged implementer session is attributed to Codex and is cleared, never resumed. |
| spec_review re-review preamble | `resumeId !== null && (state.provider === 'mixed' \|\| specReviewCheck.count > 0)`. `count` is the max of `spec_review.iterations_current_loop`, which only a `changes_requested` round increments and which approval and reroute reset to 0. |
| Orchestrator cold lens | `providerRunsColdLens(provider)` is `provider === 'mixed'`. |
| `canon task set provider` slot clear | For each slot that holds a session (role or legacy key), clear it when its recorded backend (tag or mixed attribution) differs from the new assignment's backend for that role. Setting the same provider again clears nothing. See notes `[plan]` 2. |

## Steps

### Step 1: Pure provider policy and Claude cells for spec_review and implement

Files: `src/lib/pipeline-policy.ts`

1. Add the provider type and its parser. Keep the module pure: `grep -c "process.env"` must stay 0.
   ```ts
   export type Provider = 'mixed' | 'claude';
   export const PROVIDERS: readonly Provider[] = ['mixed', 'claude'];
   export type ProviderParse = { ok: true; provider: Provider } | { ok: false; codex: boolean };
   export function parseProvider(raw: unknown): ProviderParse {
       if (raw === 'mixed' || raw === 'claude') return { ok: true, provider: raw };
       return { ok: false, codex: raw === 'codex' };
   }
   /** `subject` names the source, e.g. `CANON_PROVIDER='codex'` or `Task 'x' has provider "Claude" in status.json`. */
   export function providerErrorMessage(subject: string, codex: boolean): string {
       return `${subject}${codex ? ': Codex-only mode is not supported yet.' : ' is not a supported provider.'} Accepted values: ${PROVIDERS.join(', ')}.`;
   }
   ```
2. Rename `DEFAULT_ROLE_ASSIGNMENT` to an exported `MIXED_ROLE_ASSIGNMENT` with the same six entries. Add `CLAUDE_ROLE_ASSIGNMENT`, with all six roles set to `'claude'`, and `roleAssignmentFor(provider: Provider): RoleAssignment`. Add `providerRunsColdLens(provider)`, which returns `provider === 'mixed'`.
3. Make `assignment` a **required** second parameter of `roleBackendId(role, assignment)`, and make `requiredAgentBackends(assignment)` required too. Both defaults go away (AC-3).
4. Add the display names and role-holder helper, used by prompts and messages (pure, so there is no import cycle with `agents/`):
   ```ts
   export const AGENT_BACKEND_DISPLAY_NAMES: Readonly<Record<AgentBackendId, string>> = { claude: 'Claude', codex: 'Codex' };
   export function roleHolderName(role: AgentRole, assignment: RoleAssignment): string {
       return AGENT_BACKEND_DISPLAY_NAMES[roleBackendId(role, assignment)];
   }
   ```
5. Claude cells:
   - Change `ClaudePhase` to `'spec' | 'spec_review' | 'plan' | 'implement' | 'code_review' | 'qa'`.
   - Add `PolicyConfig.claudeModelSpecReview` and `claudeModelImplement` (both `string | null`).
   - Add `CLAUDE_CELLS.spec_review` and `.implement` as copies of the `spec` row: light/medium for XS–S, strong/medium for M–L, strong/high for XL.
   - In `claudePinFor`, return `config.claudeModelSpecReview` / `config.claudeModelImplement` for every size.
   - Add `IMPLEMENT_BUDGET_BY_SIZE` = `{ XS: '10.00', S: '15.00', M: '25.00', L: '40.00', XL: '60.00' }`.
   - In `BUDGET_BY_PHASE_AND_SIZE`, map `spec_review` to `SINGLE_PASS_BUDGET_BY_SIZE` and `implement` to `IMPLEMENT_BUDGET_BY_SIZE`.
   - Add both rows to `claudeMatrix`'s return.
   - Extend the block comment above `CLAUDE_CELLS` with one line: these two rows are reached only on `claude`-provider tasks.

### Step 2: Provider resolution in the orchestrator policy

Files: `src/orchestrator/policy.ts`

1. Add `claudeModelSpecReview: process.env.CLAUDE_MODEL_SPEC_REVIEW ?? null` and `claudeModelImplement: process.env.CLAUDE_MODEL_IMPLEMENT ?? null` to `config`, using the same `??` form as the other pins, and pass both through `policyConfig()`.
2. Add the resolvers. `CANON_PROVIDER` must appear in `src/` only in this file (AC-1 grep), so doctor and messages import the constant.
   ```ts
   export const PROVIDER_ENV_VAR = 'CANON_PROVIDER';
   export type ProviderResolution = { ok: true; provider: Provider } | { ok: false; message: string };
   export function resolveProviderSetting(env: NodeJS.ProcessEnv = process.env): ProviderResolution {
       const raw = env[PROVIDER_ENV_VAR];
       if (raw === undefined || raw === '') return { ok: true, provider: 'mixed' };
       const parsed = parseProvider(raw);
       return parsed.ok ? parsed : { ok: false, message: providerErrorMessage(`${PROVIDER_ENV_VAR}='${raw}'`, parsed.codex) };
   }
   export function resolveTaskProvider(taskId: string, status: Pick<StatusJson, 'provider'>): ProviderResolution {
       if (status.provider === undefined) return { ok: true, provider: 'mixed' };
       const parsed = parseProvider(status.provider);
       return parsed.ok ? parsed : { ok: false, message: providerErrorMessage(
           `Task '${taskId}' has provider ${JSON.stringify(status.provider)} in status.json`, parsed.codex)
           + ` Fix it with \`canon task set ${taskId} provider <${PROVIDERS.join('|')}>\`.` };
   }
   export function resolveBundleProvider(entries: readonly { taskId: string; status: StatusJson }[]): ProviderResolution {
       // first invalid member wins; then refuse >1 distinct provider:
       // `Cannot run tasks with different providers together: a (claude), b (mixed). Run them separately, or align them with \`canon task set <id> provider <mixed|claude>\`.`
   }
   ```
   `env` is read inside the function, never at import, so importing with `CANON_PROVIDER=bogus` does not throw.
3. Extend the re-exports: `roleAssignmentFor`, `MIXED_ROLE_ASSIGNMENT`, `PROVIDERS`, `providerRunsColdLens`, `roleHolderName`, `AGENT_BACKEND_DISPLAY_NAMES`, and types `Provider`, `RoleAssignment`.

### Step 3: Backends, session-id-carrying errors, and Claude worker startup text

Files: `src/orchestrator/agents/backend.ts`, `src/orchestrator/agents/errors.ts`, `src/orchestrator/agents/claude.ts`, `src/orchestrator/prompts/helpers.ts`

1. `backend.ts`: change the signature to `export function agentBackendFor(role: AgentRole, assignment: RoleAssignment): AgentBackend` → `roleBackendId(role, assignment) === 'claude' ? …`. Update the doc comment on `AgentBackend`: Claude's `AgentSessionError` carries the stream's session id when one was seen.
2. `errors.ts`: add `readonly sessionId: string | null` (constructor option `sessionId?: string | null`, default `null`).
3. `claude.ts`:
   - `resolveConfig`: allow `spec_review` and `implement` in the guard, so it throws only for `human_review`.
   - In `attempt()`, the session id is already resolved (lines 234-239) before the failure throws. Pass `sessionId` into the `stalled`, `exit_code` and `signal` `AgentSessionError`s. `spawn_error` has none.
   - Add a final optional parameter to `runClaude`: `headless = CLAUDE_HEADLESS`. Use it in `effectivePrompt` instead of the constant.
   - In `claudeBackend.run`, pass `request.phase === 'implement' || request.phase === 'spec_review' ? CLAUDE_WORKER_HEADLESS : CLAUDE_HEADLESS`. Mixed never sends those phases to Claude, so the 15-row parity test is unaffected.
   - Use `displayName: AGENT_BACKEND_DISPLAY_NAMES.claude`.
4. `helpers.ts`:
   - Add `CLAUDE_WORKER_STARTUP`, identical to `CODEX_STARTUP` except the "missing from the commit" paragraph ends: `…do not run \`git add\`/\`git commit\` to recover — the orchestrator owns commits and the recovery path.` This removes the "the sandbox blocks `.git` writes by design" clause (AC-12c).
   - Add `CLAUDE_BLOCKERS_RULE = 'Always end by writing the phase artifact and running the phase command(s) listed at the end of this prompt, including when you recorded Blockers — a session that ends without them stalls the pipeline.'` and `CLAUDE_WORKER_HEADLESS = \`${CLAUDE_HEADLESS}\n\n${CLAUDE_BLOCKERS_RULE}\``.
   - The rule goes in the headless preamble rather than the startup block because `toResumePrompt` strips startup blocks. In the preamble it also reaches resumed and park-resumed sessions (AC-12d).
   - Add `CLAUDE_WORKER_STARTUP` to `toResumePrompt`'s strip list.
   - Add `startupFor(role: 'implementer' | 'spec_reviewer', assignment)`, which returns `CLAUDE_WORKER_STARTUP` when the role's backend is `claude` and `CODEX_STARTUP` otherwise.

### Step 4: Status schema, backend-tagged sessions, and provider-switch clearing

Files: `src/orchestrator/types.ts`, `src/orchestrator/state.ts`

1. `types.ts`:
   - Add `provider?: string` to `StatusJson`. It is deliberately loose, because hand edits are validated by `resolveTaskProvider`. Comment: absent means `mixed`.
   - Add `session_backends?: Partial<Record<SessionSlot, string>>` (orchestrator-owned).
   - Add `provider: Provider` to `PipelineState`, imported as a type from `../lib/pipeline-policy.js`.
2. `state.ts` (all tag writes and clears live here):
   ```ts
   export function storeSessionId(taskIds: string[], slot: SessionSlot, sessionId: string, backend: AgentBackendId): void
       // writes sessions[slot] and session_backends[slot] = backend on every member
   export function clearSessionPair(status, slot): void
       // existing deletes + delete status.session_backends?.[slot]; drop the map when empty
   function storedSessionBackend(status: StatusJson, slot: SessionSlot): string
       // status.session_backends?.[slot] ?? roleBackendId(slot, MIXED_ROLE_ASSIGNMENT)
   export function usableSessionId(taskIds: string[], slot: SessionSlot, assignment: RoleAssignment): string | null {
       const status = readStatus(taskIds[0]);
       const id = status.sessions?.[slot] ?? status.sessions?.[LEGACY_SESSION_SLOTS[slot]] ?? null;
       if (!id) return null;
       const stored = storedSessionBackend(status, slot); const current = roleBackendId(slot, assignment);
       if (stored === current) return id;
       warn(`Stored ${slot} session ${id.slice(0, 8)}... was created by ${stored}, but ${slot} now runs on ${current}; clearing it and starting fresh.`);
       for (const taskId of taskIds) { const s = readStatus(taskId); clearSessionPair(s, slot); writeStatus(taskId, s); }
       return null;
   }
   /** Mutates; returns the slots it cleared (only slots that held a role or legacy session). */
   export function clearSessionsForAssignment(status: StatusJson, assignment: RoleAssignment): SessionSlot[]
   ```
   `SessionSlot` values are also `AgentRole` names, so `roleBackendId(slot, …)` type-checks. Import `warn` from `./cli.js` (`die` is already imported). Keep `getStoredSessionId` as the raw reader.

### Step 5: Phase runners

Files: `src/orchestrator/phases/spec.ts`, `spec-review.ts`, `plan.ts`, `implement.ts`, `qa.ts`, `code-review.ts`

In every runner: `const assignment = roleAssignmentFor(state.provider);` (import from `../policy.js`), then `agentBackendFor(<role>, assignment)`.

- **spec.ts, plan.ts, qa.ts:** pass the assignment only. Their log text names Claude, which is accurate under both presets.
- **spec-review.ts:**
  - Resolve `backend` before the log line and write ``info(`Phase: spec_review (${backend.displayName} reviews spec${…})`)``.
  - Fast-tier gate banner: `` `  ✋  SPEC GATE — Review before ${roleHolderName('implementer', assignment)} implements.` ``.
  - `recordFastTierSpecApproval(taskId, reviewerName)` note: `` `> Fast tier: ${reviewerName} spec review skipped — …` `` with the rest verbatim.
  - Re-review preamble: `const isReReview = resumeId !== null && (state.provider === 'mixed' || specReviewCheck.count > 0);`. This keeps mixed identical and removes the false preamble on a Claude park resume (AC-7). See notes `[plan]` 3.
- **implement.ts:**
  - Resolve `backend` first and log `` `Phase: implement (${backend.displayName}${…})` ``. Add `', resume after park'` to `phaseLabel` when parked.
  - Park-resume entry, after `wasImplementInProgress`:
    ```ts
    const isParkResume = state.provider === 'claude' && !isRevision && !isRerouted && resumeId !== null
        && tasks.some(t => t.status.phases.implement?.status === 'blocked');
    const shouldResume = isRevision || isRerouted || isResume || isParkResume;
    // prompt chain: isRevision → isRerouted → isResume → isParkResume → fresh
    : isParkResume ? promptImplementParkResume(state, lastParkReason(tasks), affectedFiles, baseBranch)
    ```
    `lastParkReason(tasks)` is the `reason` of `tasks[0].status.escalations` last entry with `phase === 'implement'`, or `null`. `parkAgentSessionFailure` writes that escalation.
  - No-diff guard: interpolate `backend.displayName` into the three warning lines and the escalation reason. Under mixed the text is unchanged ("Codex revision iteration…", "Codex believed…", "Dropping the stored Codex session…", "…— Codex resumed-session hallucination signature…"). The guard keeps clearing via `clearSessionPair`, which now drops the tag.
- **code-review.ts:**
  ```ts
  const assignment = roleAssignmentFor(state.provider);
  let coldFindings: string | null = null;
  if (providerRunsColdLens(state.provider)) {
      // existing block unchanged: coldBackend = deps.agentBackendFor('cold_reviewer', assignment) … hard-fail … write review-cold-codex.md … writeColdCodexArchive(…, coldReview.findings) … info(`→ cold-codex review …`)
      coldFindings = coldReview.findings;
  } else {
      for (const t of tasks) fs.rmSync(path.join(taskDirFor(t.taskId), 'review-cold-codex.md'), { force: true });
      for (const t of tasks) deps.writeColdCodexArchive(taskDirFor(t.taskId), {
          round: roundN, reviewedSha: headSha, scope: scope.scope, base: scope.base, reason: scope.reason,
      }, CLAUDE_MODE_COLD_RECORD_BODY);
      info(`→ no orchestrator cold lens in Claude mode (${taskIds.join(', ')}); round record written`);
  }
  const backend = deps.agentBackendFor('reviewer', assignment);
  … promptCodeReview(state, baseBranch, scopedDiff, coldFindings, { ...scope, deltaDiff }, outOfScopeFiles)
  ```
  Use `const CLAUDE_MODE_COLD_RECORD_BODY = 'No orchestrator cold lens runs in Claude mode. The foreman\'s spec-blind cold-Claude sub-agent is this round\'s cold review; this record exists so later rounds can resolve delta scope.\n';`. The header format is untouched, so `parseColdCodexArchiveHeader` and delta scope keep working.

### Step 6: Prompt builders and templates

Files: `src/orchestrator/prompts/index.ts`, templates `spec-review.md`, `spec-review-reroute.md`, `plan.md`, `plan-reroute.md`, `qa.md`, `code-review-foreman.md`

1. In `index.ts`, add a local helper `function names(state)` that returns `{ author, specReviewer, implementer, reviewer }` from `roleHolderName(role, roleAssignmentFor(state.provider))`. Also `vendorList(state)`, which joins the display names of `requiredAgentBackends(assignment)` in order (mixed gives `Claude, Codex`; claude gives `Claude`), and `crossReviewRule(state)`:
   - Mixed (author ≠ spec reviewer and implementer ≠ reviewer): returns exactly `No agent reviews its own output. Claude writes specs → Codex reviews specs. Codex writes code → Claude reviews code.`, built from the names.
   - Otherwise: `No session reviews its own output. The spec author's session writes specs → a separate reviewer session reviews them. The implementer's session writes code → a separate review session, with a spec-blind lens, reviews it.`
2. Builders:
   - `promptSpec`: `` `… Be concrete — ${n.implementer} implements directly from this.` ``.
   - `promptSpecReview` (both branches): `startup: startupFor('spec_reviewer', assignment)` and pass `specReviewer`, `implementer` and `crossReviewRule` (and `author` only if you also replace "grilled Claude"; that is optional because it renders identically).
   - `promptPlan` (both branches): pass `implementer` and `specReviewer`.
   - `promptImplement`, `promptImplementRevisions`, `promptImplementReroute` (non-resumed): `startupFor('implementer', assignment)`.
   - `promptQa`: pass `vendorList` and `implementer`.
3. Template edits. Each literal becomes a variable that renders today's text under mixed:
   - `spec-review.md:17`: `the reviewer ({{specReviewer}})`.
   - `spec-review.md:34`: `{{implementer}} can resolve`.
   - `spec-review.md:44` and `spec-review-reroute.md:20`: `**Cross-review rule**: {{{crossReviewRule}}}`.
   - `plan.md:9`: `{{implementer}} implements directly from this plan.`
   - `plan-reroute.md:5`: `{{specReviewer}} has reviewed the amendment.`
   - `plan-reroute.md:13`: `a record of {{implementer}}'s prior work`.
   - `qa.md:43`: `({{vendorList}}, canon, an LLM)`.
   - `qa.md:84`: `after {{implementer}} static validation`.
   - Use `{{{…}}}` only where the value can contain characters Mustache would escape. Escaping is disabled anyway (`render.ts`).
4. Add `promptImplementParkResume(state, parkReason, affectedFiles, baseBranch)`:
   ```ts
   const body = promptImplement(state, 'fresh', affectedFiles, baseBranch).replace(
       '- Mode: **fresh** — first implementation pass — no prior work on this phase',
       '- Mode: **park-resume** — the previous implement session stopped before finishing; work in the tree may be partial');
   return [
       `Your previous implementation session stopped before it finished${parkReason ? ` (park reason: ${parkReason})` : ''}.`,
       'Work in the working tree may be partial. Check `git status` and `git diff` against the base branch to see what exists; do not assume any step is done.',
       '',
       'Continue the implementation against each task\'s spec.md and plan.md. Then:',
       '1. Run the project\'s validation commands (the validation matrix below and each spec\'s "Validation Required" section) and record results.',
       '2. Write handoff.md for each task (intent/rationale, deviations, AC coverage, validation outcomes).',
       '3. Run canon task to mark implement done for each task.',
       '',
       body,
   ].join('\n');
   ```
   The mode line is produced by `context.ts`, which is out of scope, so the replace is pinned by a test (step 10). It must not contain "already complete". See notes `[plan]` 1.
5. Foreman two-lens rendering. Add view flag `coldLens: providerRunsColdLens(state.provider)` and wrap every cold-Codex passage in `{{#coldLens}}…{{/coldLens}}`, with a `{{^coldLens}}…{{/coldLens}}` two-lens alternative where a sentence is needed. Put section tags on their own lines (Mustache drops standalone tag lines) or inline within a line, so the mixed render stays byte-identical; the golden test checks this.
   - **Line 12:** keep the three-input text in mixed. For Claude: `Your job is to synthesize two review inputs: the anchored Claude lens and the cold-Claude lens. You spawn both as isolated sub-agents, collect their findings, adjudicate them using the spec (which you hold and the cold lens does not), then write one \`review.md\` and set the verdict.` This drops "Do not run `codex` yourself".
   - **Line 21:** "All three lenses" becomes "Both lenses" for Claude.
   - **Lines 59–74:** the whole `## Injected Cold-Codex Findings` section, including the "do not treat a missing cold-Codex lens as approval evidence" branch, is mixed-only.
   - **Line 120:** mixed-only. For Claude keep only `Do not let a Claude lens see another lens's output.`
   - **Line 128:** "three lens inputs" becomes "two lens inputs" for Claude.
   - **Line 132:** the "Cross-model agreement…" sentence is mixed-only.
   - **Line 134:** for Claude: `For cold-Claude findings, verify each against the diff/code. A finding that does not hold gets recorded as \`Dismissed (cold-Claude): <finding> - <reason>\`.`
   - **Line 136:** for Claude: "a verified cold-Claude finding".
   - **Line 158:** the archive-header sentence is mixed-only.
   - **Line 163:** for Claude, only the `Dismissed (cold-Claude): ...` entry.
   - Then grep the Claude render for `/cold-Codex|codex review|\bCodex\b/` (AC-11).

### Step 7: Orchestrator wiring

Files: `src/orchestrator/main.ts`

**a. Run-scoped provider.** Near `cliArgs`:
```ts
let runProvider: Provider | null = null;
export function setRunProviderForTest(provider: Provider | null): void { runProvider = provider; }
function providerFor(taskIds: readonly string[]): Provider {
    if (runProvider) return runProvider;
    const resolved = splitPolicy.resolveBundleProvider(taskIds.map(taskId => ({ taskId, status: splitState.readStatus(taskId) })));
    if (!resolved.ok) die(resolved.message);
    return resolved.provider;
}
const assignmentFor = (taskIds: readonly string[]): RoleAssignment => splitPolicy.roleAssignmentFor(providerFor(taskIds));
```

**b. `checkDeps`.**
- Move the per-task `status.json` existence loop to the top.
- Then, unless `cliArgs.ship`, set `runProvider = providerFor(taskIds)`. This also covers dry-run and the AC-2/AC-4 refusals, which happen before reroute, full-send, snapshot or any agent write.
- Then the agent binary loop: `for (const dep of splitPolicy.requiredAgentBackends(splitPolicy.roleAssignmentFor(runProvider ?? 'mixed')))`. The `?? 'mixed'` is reachable only on `--ship`, which skips agent deps anyway. Prefer guarding the loop with `!skipAgentDeps && runProvider` so there is no implicit default.
- The labels stay as they are.
- See notes `[plan]` 5 on the reorder.

**c. `buildPipelineState(taskIds, provider: Provider = providerFor(taskIds))`.** Return `{ tasks, tier, isBundle, provider }`. `main` keeps calling it with one argument, which yields `runProvider`.

**d. `runPhase`.** Remove the four up-front `getStoredSessionId` reads. Inside each branch call `splitState.usableSessionId(taskIds, <slot>, assignment)`, with `assignment = splitPolicy.roleAssignmentFor(state.provider)`: `author` for spec, `spec_reviewer` for spec_review, `implementer` for implement, `reviewer` for code_review. A stale `implementer` slot reaching spec_review must produce no warning (AC-5).

**e. Main loop session store (`4209-4218`).** Write `splitState.storeSessionId(taskIds, slot, lastSessionId, phaseResult.agent)` and get the label from `agentBackendFor(role, splitPolicy.roleAssignmentFor(state.provider)).displayName`.

**f. `parkAgentSessionFailure`.** Before `autoBlockPhase`:
```ts
const slot = phase === 'implement' || phase === 'spec_review' ? splitPolicy.phaseSessionSlot(phase) : null;
if (slot && error.agent === 'claude' && error.sessionId && providerFor(taskIds) === 'claude') {
    splitState.storeSessionId(taskIds, slot, error.sessionId, 'claude');
}
```

**g. `retryAgentForPhase`.** Use `assignment = assignmentFor([taskId])`, `backend = agentBackendFor(role, assignment)` and `sessionId = slot ? splitState.usableSessionId([taskId], slot, assignment) : null`.

**h. Fix-up.**
- Add `agent: AgentBackendId` to the `fixUpOwnArtifactRefs` opts and use it in the "no … session is available" warning instead of the hard-coded `phase === 'implement' ? 'codex' : 'claude'`.
- `fixUpImplementArtifactRefs`: `assignment = assignmentFor(taskIds)`; `sessionId = usableSessionId(taskIds, 'implementer', assignment)`; `agentBackendFor('implementer', assignment)`; `agent: roleBackendId('implementer', assignment)`.
- The QA fix-up in `checkAndRoute` uses `agentBackendFor('qa', assignmentFor(taskIds))` and `agent: roleBackendId('qa', …)`.

**i. `printDryRunPlan`.** Use `agentBackendFor(role, splitPolicy.roleAssignmentFor(state.provider))`.

**j. Role-holder strings.** Use `splitPolicy.roleHolderName(role, assignmentFor(taskIds))`:
- `--force` bypass warning (`2943`): `` `${implementer} will re-implement…` ``.
- Fast-tier reroute note (`3095`): `` `Note: ${implementer} will re-read spec.md…` ``.
- Spec-gate banner (`3814`): `` `  ${specReviewer} reviews:` ``.
- Implement-evidence warning (`3666`): `` `${implementer} marked implement done but…` ``.

Messages gated on `lastCodexExitStatus` stay as they are.

### Step 8: Task CLI

Files: `src/task/index.ts` (and `src/cli/commands/completion.ts`, which needs no change)

1. `taskNew`: immediately after `validateTaskId(id)` and the title check, before any `mkdirSync`:
   ```ts
   const providerSetting = resolveProviderSetting();
   if (!providerSetting.ok) throw new Error(`Error: ${providerSetting.message}`);
   ```
   Set `status.provider = providerSetting.provider` beside `status.base_branch`. `taskCmd`'s catch prints the message and exits 1 with no stack trace, and no directory is created.
2. Add `'provider'` to `SETTABLE_FIELDS` (append after `human_spec_gate`) and `provider: PROVIDERS` to `TASK_SET_FIELD_VALUES`.
3. In `taskSetValue`, add a `case 'provider'`:
   ```ts
   const parsed = parseProvider(value);
   if (!parsed.ok) throw new Error(`Error: ${providerErrorMessage(`invalid provider '${value}'`, parsed.codex)}`);
   status.provider = parsed.provider;
   const cleared = clearSessionsForAssignment(status, roleAssignmentFor(parsed.provider));
   return cleared.length > 0
       ? [`Cleared stored ${cleared.join(', ')} session(s) on task ${taskId}: they ran on a different agent backend than provider '${parsed.provider}' uses. The next run starts those roles fresh.`]
       : [];
   ```
   It throws before any write, so `status.json` is unchanged on refusal. The worktree window is already routed by `taskSet` → `resolveTaskCwd`.
4. Add `session_backends` to `REDIRECT_MESSAGES` with the same text as `sessions`, and add it to the `phases || sessions || …` redirect check.

### Step 9: Dependency checks

Files: `src/cli/deps.ts`, `src/cli/commands/doctor.ts`

1. `deps.ts`: replace the module-level `HARD_DEPS` with `function hardDeps(assignment: RoleAssignment): Dep[]`, then:
   ```ts
   export function checkDeps(available = isAvailable, setting: ProviderResolution = resolveProviderSetting()): void {
       if (!setting.ok) { console.error(setting.message); process.exit(1); }
       const missing = hardDeps(roleAssignmentFor(setting.provider)).filter(d => !available(d.cmd));
   ```
   Import from `../orchestrator/policy.js`. `init.ts` keeps calling `checkDeps()`.
2. `doctor.ts`:
   ```ts
   const providerSetting = resolveProviderSetting();
   const provider = providerSetting.ok ? providerSetting.provider : 'mixed';
   const requiredAgents = new Set(requiredAgentBackends(roleAssignmentFor(provider)));
   ```
   Add a first env check, `checkProvider(providerSetting)`, with label `provider`:
   - pass: `` `${provider} (from ${PROVIDER_ENV_VAR}; checks this setting, not the providers pinned on existing tasks)` ``.
   - fail: `providerSetting.message`.

   On failure the binary checks use the mixed set, which is the conservative choice. The Codex project-trust check stays gated on `requiredAgents.has('codex')`.

### Step 10: Tests

Files: the test files in Affected Files. Use `UPDATE_GOLDENS=1 npm test` only for the **new** golden keys. Then diff `tests/run-task-prompts.golden.json` and confirm no existing key changed (AC-12a).

- **`tests/pipeline-policy.test.ts`**
  - Add `CLAUDE_MODEL_SPEC_REVIEW`, `CLAUDE_MODEL_IMPLEMENT` and `CANON_PROVIDER` to the scrub lists (around line 324).
  - AC-1 rows:
    - `parseProvider` for `mixed`, `claude`, `codex`, `Claude`, `''`, `bogus`.
    - `roleAssignmentFor('mixed')` deep-equals today's six roles; `'claude'` maps all six to claude.
    - `providerErrorMessage` names `mixed` and `claude`, and the codex variant says "Codex-only mode is not supported yet".
    - A subprocess imports `src/orchestrator/policy.ts` with `CANON_PROVIDER=bogus` and exits 0, then calls `resolveProviderSetting()` for unset, `''`, `mixed`, `claude`, `codex`, `bogus`. Set env after import, per patterns.md.
    - Assert `fs.readFileSync('src/lib/pipeline-policy.ts')` has no `process.env`, and `git grep -l CANON_PROVIDER -- src` returns only `src/orchestrator/policy.ts`. Run it with `process.cwd()`.
  - AC-8 rows for spec_review and implement at XS/S/M/L/XL: models, efforts, the two budget curves, and delicate promoting to XL. Precedence rows cover each pin, `CLAUDE_MODEL_LIGHT`, `CLAUDE_MODEL_STRONG`, `CLAUDE_MODEL` and `CLAUDE_BUDGET` for both phases. Existing rows stay unchanged.
- **`tests/agent-backend.test.ts`**
  - Scrub regex (line 43): add `CANON_PROVIDER`. Every subprocess env in this file (`79`, `127`, `140`) goes through one `scrubbedEnv()` helper.
  - Parity script: import `MIXED_ROLE_ASSIGNMENT` and call `agentBackendFor(role, MIXED_ROLE_ASSIGNMENT)`. The expected values are unmodified (AC-14).
  - State test: `storeSessionId([...], role, 'next', 'codex')`.
  - `init probes`: `checkDeps(probe, { ok: true, provider: 'mixed' })` still expects `['git','claude','codex','gh']`. Add a claude row that expects `['git','claude','gh']`, and an invalid-setting row that exits 1 with the message in a subprocess.
  - AC-5 table, five cases × four slots, in a subprocess under `CANON_TASKS_DIR_OVERRIDE`:
    - (a) tagged, same backend: resumed.
    - (b) tagged, different backend: `null`; the warning names slot, stored and current backend; role and legacy keys and the tag are cleared on both bundle members.
    - (c) untagged role key under mixed: resumed.
    - (d) untagged under claude for spec_reviewer or implementer: treated as (b); for author or reviewer: resumed.
    - (e) legacy key only: follows (c)/(d).
  - Also `clearSessionPair` removes the tag.
  - `clearSessionsForAssignment`: Codex `spec_reviewer` and `implementer` plus a Claude `author` → `['spec_reviewer','implementer']`, `author` kept. Switching back to mixed from a state holding only Claude author and reviewer sessions → `[]`.
  - AC-13: doctor and init are covered in cli.test. Here add `resolveBundleProvider` cases: absent + claude refused with both names; all claude → claude.
- **`tests/task-cli.test.ts`** (AC-2):
  - `task new` with `CANON_PROVIDER=claude`, unset, and `bogus`. For `bogus`, expect a non-zero exit, the message, no `at ` stack line, and no task dir.
  - `task set provider claude|mixed` succeeds; `codex` and `bogus` exit non-zero naming the accepted values, with `status.json` byte-identical.
  - `task set … session_backends x` is refused with the sessions redirect.
  - The AC-5 switch case through the CLI: the cleared-slots note is printed.
  - A worktree-routing case modelled on the test at `tests/task-cli.test.ts:649`: only the worktree copy gains `provider`.
- **`tests/completion.test.ts`** and **`tests/completion.golden.json`:**
  - Line 35: the expected keys include `provider`.
  - Line 39: the SETTABLE comparison includes it.
  - Lines 402–407: `fields` gains `provider`, so both values run through `taskSet`.
  - Regenerate the golden with `UPDATE_GOLDENS=1`.
- **`tests/run-task-validation.test.ts:4357`:** `roleBackendId(role, MIXED_ROLE_ASSIGNMENT)`.
- **`tests/run-task-code-review.test.ts`**
  - Add `provider: 'mixed'` to the `PipelineState` literal.
  - Pass `MIXED_ROLE_ASSIGNMENT` at the direct `deps.agentBackendFor('cold_reviewer')` calls.
  - AC-10, provider `claude`: the stub `agentBackendFor('cold_reviewer', …)` returns a backend whose `coldReview` records calls; assert zero calls. A pre-seeded `review-cold-codex.md` is gone. `review-cold-codex-run-1.md` parses via `parseColdCodexArchiveHeader`, with round 1 and the HEAD SHA.
  - A round-2 fixture (iterations 1, a real Stage 1 `review.md`, the round-1 record, HEAD a descendant within the threshold) resolves `scope: 'delta'`.
  - The existing mixed tests, including the hard-fail with `agent === 'codex'`, are unchanged.
- **`tests/recovery-hints.test.ts`:** add `provider: 'mixed'` to its `PipelineState` literal. The stub signature is fine as is.
- **`tests/run-task-prompts.test.ts`** and the golden:
  - `makeState` and the inline bundle states get `provider: 'mixed'`.
  - AC-11: new golden keys `promptCodeReview:claude:round1` and `promptCodeReview:claude:round2` for a `provider: 'claude'` state; assert that neither matches `/cold-Codex|codex review|\bCodex\b/`.
  - AC-12b: a separate vendor-free fixture task. Its spec's Affected Files must list no file whose content names a vendor, because `buildContextBlock` inlines Affected Files contents; list none, or a temp file. `CANON_PATTERNS_MD_PATH` already points at the stub. Render every exported builder in `prompts/index.ts`: `promptArtifactFixup`, `promptSpec`, `promptSpecRevision`, `promptSpecReview` (first-pass and reroute), `promptPlan` (both), `promptImplement`, `promptImplementResume`, `promptImplementParkResume`, `promptImplementRevisions`, `promptImplementReroute` (fresh and resumed), `promptCodeReview`, `promptQa`. Also the retry prompt text: export a small `retryPrompt` builder from `main.ts`, or assert on the prompt captured by the AC-9 retry test. Assert none matches `/\bCodex\b/`.
  - AC-12c: extend the strip test at line 526 to Claude-provider spec-review and implement prompts; they contain `CLAUDE_WORKER_STARTUP`, not "sandbox blocks", and state the orchestrator owns commits.
  - AC-6 prompt pin: `promptImplementParkResume` contains `park-resume` and "may be partial", and contains neither "already complete" nor "no prior work on this phase".
- **`tests/run-task-safety.test.ts`.** Model the main-level tests on `main parks a failed plan durably…` (line 10602) and `main parks a stalled Codex implement session` (10643), which use `makeGitFixture` + `writeReviewLoopFixture` + `setupInvocationLoggingCliTools` + `runReviewLoopMain`.
  - **Env scrub.** `childEnvWithoutTasksOverride` and `runReviewLoopMain`'s env also delete `CANON_PROVIDER`, `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT`.
  - **No-codex PATH helper.** Symlink `process.execPath` as `node` and the resolved `git` into a temp dir, then `PATH = fakeBins:linkDir:/usr/bin:/bin`. Delete the fake `codex` from `fakeBins` and assert as a precondition that `which codex` fails under that env. On a dev machine the real `codex` usually sits beside `node`, so the precondition is what lets the test fail.
  - **AC-3.**
    - A `claude` task at spec_review (full tier, S, `human_spec_gate: false`) with no codex runs through spec_review → plan → implement (`FAKE_AGENT_COMPLETE_SEQUENCE`). The argv log shows `claude` with `--model sonnet --effort medium` for spec_review and implement; `phases.spec_review.agent` and `phases.implement.agent` are `'claude'`. Stop before code_review: let the sequence end at implement and expect the code_review pre-flight to park, or use `--step` twice.
    - The same fixture with `provider: 'mixed'` and a codex fake logs `codex` for both.
    - **Pin test:** a `claude` task at spec with `human_spec_gate: true`. The spec fake's `FAKE_AGENT_EDIT_SCRIPT` rewrites `status.provider = 'mixed'`. spec_review is still logged as `claude`, and the run exits 0 at the gate.
  - **AC-4.** Task A `claude`, task B absent: non-zero exit, both `id (provider)` in the output, both `status.json` byte-identical, empty agent log. Repeat with B `mixed`.
  - **AC-2 run refusal.** `provider: "codex"` and `"Claude"` exit non-zero with the AC-1 text before any agent log line.
  - **AC-6.**
    - A claude fake for implement prints a real-shaped init event `{"type":"system","subtype":"init","session_id":"<uuid>",…}` and exits 1. Expect exit 2, `implement` blocked, `sessions.implementer === uuid`, `session_backends.implementer === 'claude'`.
    - Rerun with a succeeding fake: the argv contains `--resume <uuid>`; the `-p` text contains "stopped before it finished" and "may be partial", and does not contain "already complete".
    - A failing fake with no session output writes no slot; the rerun has no `--resume`, and the prompt is the normal implement prompt (`Mode: **fresh**`).
    - A revision-state park (`iterations_current_loop: 1`) reruns with the revision prompt.
  - **AC-7.**
    - A `claude` first-pass spec_review fake prints the init uuid and exits 1: the slot is stored and tagged. The rerun has `--resume <uuid>` and no "has been revised since your last review".
    - A `claude` spec_review with `spec_review.iterations_current_loop: 1` and a stored Claude-tagged session gets the preamble.
    - A `mixed` task whose Claude plan or code_review fake fails with a session id stores nothing.
  - **AC-9.**
    - `canon run --dry-run` on a `claude` S task prints `spec_review: Claude / sonnet / medium` and `implement: Claude / sonnet / medium`, and exits 0.
    - `retryAgentForPhase(taskId, 'implement', note)` and `(…, 'spec_review', …)`, in a subprocess with a Claude-tagged slot, spawn `claude` with the matrix model and `--resume`.
    - `fixUpImplementArtifactRefs` resumes `claude`: reuse the `implement docs-refs fix-up resumes Codex…` fixture (line 8676) with `provider: 'claude'` and a Claude-tagged implementer session.
  - **AC-5 use-site checks.** `retryAgentForPhase` with a Codex-tagged implementer on a `claude` task returns `'no_session'` after the warning. `fixUpImplementArtifactRefs` with the same state makes no resume.
  - **AC-12e** (`claude` vs `mixed` pairs):
    - The implement phase log line is `Phase: implement (Claude` vs `(Codex`.
    - The fast-tier reroute note (`--reroute` on a fast-tier task) is `Note: Claude will re-read` vs `Codex`.
    - The no-diff escalation reason contains `Claude resumed-session` vs `Codex resumed-session`. Use the revision no-diff fixture from the test at line 10991.
    - Assert `match` on one side and `doesNotMatch` on the other (patterns.md: a state-varying pair).
  - Existing `PipelineState` literals get `provider: 'mixed'`.
- **`tests/cli.test.ts`** (AC-13): doctor with `CANON_PROVIDER=claude` and a PATH holding only `git`, `claude` and `node` passes the binary checks, emits no `codex project trust` line, and prints `from CANON_PROVIDER`. Unset fails on missing `codex`. `bogus` prints a failed `provider` check carrying the message, with no stack. `canon init`'s dependency check: claude passes without codex; unset fails naming codex. Find the existing doctor and init fixtures in `tests/cli.test.ts` and reuse them.

### Step 11: Docs

Files: `docs/decisions.md`, `docs/pipeline-orchestrator.md` (then `npm run sync-templates` → `templates/docs/pipeline-orchestrator.md`), `docs/codebase-map.md`, `docs/architecture.md`

- **`docs/decisions.md`** is root-only, so it gets no mirror row. Add three What/Why/Rule entries per Decision §12:
  - (a) Claude-mode review independence is separate sessions plus spec-blind lenses, not a second model family.
  - (b) The orchestrator cold lens and its hard-fail apply to mixed mode only, and the per-round record is always written.
  - (c) The provider pin with backend-tagged sessions supersedes the "pin the provider per task at creation" constraint.
  
  Add one-line pointers in "Two distinct agents (Claude + Codex), never reviewing own output" (line 43) and "Phases route by role through agent backends (2026-10)" (line 558). Also add a Sessions-paragraph note on `session_backends`.
- **`docs/pipeline-orchestrator.md`** gets the following. It must contain no `§"…"` pointers into `decisions.md`; write "see docs/decisions.md" in prose instead.
  - Env-var rows for `CANON_PROVIDER`, `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT`.
  - spec_review and implement rows in the Claude Model/Effort (line 232) and Budget (245) matrices, marked "Claude mode only".
  - A Claude-mode code review paragraph: no cold lens, a two-lens foreman, a round record still written, and the old `review-cold-codex.md` removed.
  - `canon task set <id> provider …` and its slot clearing.
  - An update to the park paragraph (line 408) for Claude-mode implement and spec_review keeping their session.
  - In Session Resumption (line 437): backend tags, the use-time check, and the Claude-mode park resume.
- **`docs/codebase-map.md`:** update the `state.ts` row (line 37) for tagged sessions and `usableSessionId`. Add `policy.ts` provider resolution near line 52, and `deps.ts` computing required binaries at check time.
- **`docs/architecture.md`:** update the status.json contract section (line 100) for the `provider` and `session_backends` optional fields, and the session paragraph (line 169) for backend tags.

### Step 12: Build and validate

Run `npm run build`, which rewrites `dist/cli/index.js` and `dist/orchestrator/run-task.js`. Then run `npm run type-check`, `npm run lint`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`. In the worktree, run `npm ci` first. Before handing off, run `git grep -nE "(agentBackendFor|roleBackendId|requiredAgentBackends)\(\s*('[a-z_]+'\s*)?\)" -- src` (expect no output) and `git grep -nE "sessions(\?)?\.[a-z_]+ =|session_backends" -- src ':!src/orchestrator/state.ts' ':!src/orchestrator/types.ts' ':!src/task/index.ts'` (expect no direct writes). List every Affected Files entry that needed no edit in the handoff, with the reason.

## Testing Plan

- **Unit:** pipeline-policy rows (AC-1, AC-8); session-tag table and slot clearing (AC-5); prompt goldens and the vendor-free renders (AC-11, AC-12a–d); code-review deps tests (AC-10); completion (AC-2).
- **Integration (subprocess `main`, fake agents, no-codex PATH):** AC-2 run refusal, AC-3, AC-4, AC-6, AC-7, AC-9, AC-12e, AC-13 run check. Doctor and init via `tests/cli.test.ts`.
- **E2E:** N/A (no UI).
- **Manual:** the spec's Human Test Plan. A live Claude run must confirm that a budget-exhausted `claude -p` stream carries a `session_id` (init event or result event) that `runClaude`'s capture finds. The fakes copy the init-event shape, but a field path only a live run can confirm needs one live run before shipping (patterns.md). Note this in the handoff and PR body.

## Rollback Plan

Revert the merge commit. `provider` and `session_backends` are optional, and their absence means today's behavior. Tasks created after the change keep a `"provider"` key that the reverted code ignores, because `StatusJson` parsing is untyped JSON. A `claude`-pinned task in flight at revert time would silently run as mixed; switch it back with a hand edit or let it run mixed. There is no data migration.

## Reroute Plan

### Round Scope

This round covers the amendment (AC-16 to AC-19): in Claude mode the per-round record is written as `review-round-N.md`, and the round lookup reads both families. The original ACs are implemented and committed (`cc87035`, `b87d2c0`). The archived review `review-prior-1.md` ended Round 2 at **approved with nits**. Its Round 1 findings F1–F4 are verified fixed, and no `code-bug` or `spec-gap` finding is still open, so no prior finding is binding this round. Its optional nits stay out of scope. The amendment review approved with no nits. The working tree is clean apart from the task artifacts.

- **Exists:** these were confirmed by search, not recalled:
  - In `src/orchestrator/review-archive.ts`: `COLD_CODEX_ARCHIVE_PREFIX`, `COLD_CODEX_ARCHIVE_RE`, `writeColdCodexArchive`, `parseColdCodexArchiveHeader`, `findColdCodexArchiveForRound`, `hasMalformedColdCodexArchive`.
  - In `src/orchestrator/phases/code-review.ts`: `CodeReviewPhaseDeps` with those three keys (`:83-85`) and `defaultDeps` (`:103-105`). The record lookup is at `:391-399`. The Claude-mode branch at `:458-464` currently calls `deps.writeColdCodexArchive(…, 'No orchestrator cold lens runs in Claude mode.')`.
  - `resolveCodeReviewScope`'s `prev === null` reason chain (`src/lib/pipeline-policy.ts:47-51`).
  - Test helpers `makeDeps` (`tests/run-task-code-review.test.ts:283-301`) and `realGitDeps` (`:340-349`), and the existing Claude-mode test (`:1781`).
  - The untyped deps stub in `tests/recovery-hints.test.ts:990-1002`.
- **Real path:** `runCodeReviewPhase` runs `resolveCodeReviewRound`, then builds `records` by calling `deps.findColdCodexArchiveForRound(taskDir, roundN-1)` per task (skipped on round 1 and XL). `agreed`, `previousRecordsDisagree` and `previousArchiveMalformed` (via `deps.hasMalformedColdCodexArchive`) are derived from `records` and passed to `resolveCodeReviewScope`. The lens branch then writes the record. The round header format, `parseColdCodexArchiveHeader` and the per-family numbering already do what the new family needs. Only the family regex, the writer entry point and the lookup/malformed scans change.
- **Callers:**
  - `findColdCodexArchiveForRound` / `hasMalformedColdCodexArchive`:
    - In `src`: only `code-review.ts` (deps).
    - Tests: `run-task-code-review.test.ts`, both direct calls and deps overrides at `:296-297, 346-347, 1501-1502, 1576, 1634, 1669-1679, 1720, 1798-1814`, and the `recovery-hints.test.ts:1000-1001` stub.
    - The names, signatures and return types stay as they are. Their behavior widens to both families. In a dir that holds only one family the result is identical, so every existing direct call keeps its expected value.
  - `writeColdCodexArchive`: the mixed branch, plus test seeding. It stays byte-identical.
  - The only other reader of the filename is `scripts/docs-refs-check.mjs:521`, which skips `review-cold-codex-run-N.md` as noisy. That script is not in scope, and it needs no change because `review-round-N.md` holds no backticked refs (see Step R1).
- **Tests that can fail:** each AC-17 case seeds a record family that today's lookup does not read, or a state that it reads but resolves wrongly:
  - (a) and (c) seed only `review-round-1.md`. Today the lookup returns `null`, so they run full scope with the "no cold-Codex archive record" reason, not `delta`.
  - (d) seeds both families with different SHAs. Today the lookup reads only cold-Codex and returns `delta`.
  - The malformed case seeds a malformed `review-round-1.md`. Today the reason is "no …", not "unparseable …".
  - AC-16 asserts `review-round-1.md` exists and no `review-cold-codex-run-*` exists. Today's code writes the opposite.
  - (b) seeds the cold-Codex family, so it already passes today. It is a regression pin for the switch direction, not a red test. The handoff should label it that way.
- **Predicates:** the per-task lookup takes `c` (newest cold-Codex record with `round === N−1`) and `r` (the same for `review-round-`):

  | `c` | `r` | Result |
  |---|---|---|
  | null | null | null |
  | set | null | `c` |
  | null | set | `r` |
  | set | set, `c.reviewedSha === r.reviewedSha` | `r` (an arbitrary but deterministic pick; only `reviewedSha` is consumed) |
  | set | set, SHAs differ | null, and the conflict probe returns true |

  The file regexes match `\d+` only, exactly like today. Number 0 still matches. Non-numeric names and suffixed names (`review-round-1.md.bak`) are ignored. The `review-prior-N.md` family is a different prefix and is never read. Malformed means any file in either family whose header fails to parse or cannot be read. Both families run through the same parser, so a CRLF header is accepted in both.
- **Scope:** every file below is in the amendment's or the original Design's `### Affected Files` table. `parseAffectedFilesFromSpec` takes the union of `## Design` and `## Amendment`. The original table supplies `src/lib/pipeline-policy.ts`, `tests/pipeline-policy.test.ts` and `tests/recovery-hints.test.ts` (Step R2). `scripts/docs-refs-check.mjs` is not touched.
- **Async/stateful:** N/A. These are synchronous per-task-dir file writes. Numbering is per family, and the lookup matches on the header's round rather than the file number, so equal numbers across families are harmless (amendment Known Risks).

Decision recorded in notes `[plan]` 7: a same-round SHA conflict gets its own honest full-scope reason. It is a new pure-policy fact, not a reuse of "no record" or "bundle members disagree", both of which would misstate the cause. Notes `[plan]` 8: the exported function names stay cold-Codex-named to avoid deps-key churn across tests, and get JSDoc instead.

### Step R1: Round-record family in `src/orchestrator/review-archive.ts`

1. Add `export const ROUND_RECORD_PREFIX = 'review-round-';` and `const ROUND_RECORD_RE = /^review-round-(\d+)\.md$/;`.
2. Extract a private `writeNumberedRecord(taskDir, re, prefix, header, body)` holding today's writer body: numeric max+1 within `re`, `"` → `'` in the reason, and the same header line and blank line. `writeColdCodexArchive(taskDir, header, findings)` delegates with the cold family, so its output is byte-identical (AC-18). Add `export function writeRoundRecord(taskDir, header): string`, which delegates with the round family and a fixed body:
   ```ts
   const ROUND_RECORD_BODY = 'Code-review round record. No lens findings: the header above is the round state that delta scope reads.\n';
   ```
   The body has no backticks, so docs-refs-check finds no refs in it. It names no vendor.
3. Extract a private `newestRecordForRound(taskDir, names, re, round)` holding today's within-family rule: sort numerically descending, return the first readable file whose parsed header has `round === round`.
4. Add a private `roundRecordsForRound(taskDir, round): { cold, neutral }`. It does one `readdirSync`, returning `{ cold: null, neutral: null }` on error, then calls `newestRecordForRound` for each family. Rewrite the exported functions on top of it:
   - `findColdCodexArchiveForRound(taskDir, round)`: if both records are set and their `reviewedSha`s differ, return `null`. Otherwise return `neutral ?? cold`.
   - `export function hasConflictingRoundRecords(taskDir, round): boolean`: both set and the SHAs differ.
   - `hasMalformedColdCodexArchive(taskDir)`: test each name against both regexes, keeping today's parse/read-failure rule.
   - Add a one-line JSDoc on the two existing exported functions saying they read both the `review-cold-codex-run-` and `review-round-` families.

### Step R2: Conflict reason in the pure scope policy

- `src/lib/pipeline-policy.ts`:
  - Add `previousRecordConflict?: boolean` to `CodeReviewScopeFacts`, next to `previousRecordsDisagree`.
  - In the `prev === null` chain, insert it after `previousRecordsDisagree` and before `previousArchiveMalformed`, with the reason `'round records for the previous round disagree on the reviewed commit'`.
  - Every existing reason string is unchanged, and the order of the existing branches is preserved. The two flags are mutually exclusive in practice: `previousRecordsDisagree` requires every record to be non-null, and a conflict makes that task's record null.
- `tests/pipeline-policy.test.ts`: add a row beside the existing reason rows (`:40-41`): `['conflicting round records', { prevRecord: null, previousRecordConflict: true }, /round records for the previous round disagree/]`. Existing rows are untouched.

### Step R3: Code-review phase wiring in `src/orchestrator/phases/code-review.ts`

1. Import `hasConflictingRoundRecords` and `writeRoundRecord`. Add both to `CodeReviewPhaseDeps` (typed `typeof …`) and to `defaultDeps`, next to the existing archive keys.
2. After `previousArchiveMalformed` (`:398-399`), add:
   ```ts
   const previousRecordConflict = records.some((record, index) =>
       record === null && deps.hasConflictingRoundRecords(taskDirFor(tasks[index].taskId), roundN - 1));
   ```
   Pass `previousRecordConflict` into `resolveCodeReviewScope`.
3. Change the Claude-mode branch (`:458-464`) to keep the `review-cold-codex.md` removal and replace the `deps.writeColdCodexArchive(…, 'No orchestrator cold lens runs in Claude mode.')` call with `deps.writeRoundRecord(taskDirFor(t.taskId), { round: roundN, reviewedSha: headSha, scope: scope.scope, base: scope.base, reason: scope.reason })`. The mixed branch is untouched.
4. Leave the foreman prompt alone (amendment Non-Goal). Its Claude branch already says "the numbered round record" with no filename (`code-review-foreman.md:160`).

### Step R4: Tests

- **`tests/recovery-hints.test.ts:1000-1001`:** add `hasConflictingRoundRecords() { return false; },` and `writeRoundRecord() {},` to the untyped stub so every deps key exists. The fixture is mixed, but a missing key would crash at runtime if a later fixture reached the null-record path.
- **`tests/run-task-code-review.test.ts`:**
  - `makeDeps`: add `hasConflictingRoundRecords: () => false` and `writeRoundRecord`.
  - `realGitDeps`: also assign the real `hasConflictingRoundRecords`.
  - Import `writeRoundRecord`, `hasConflictingRoundRecords` and `ROUND_RECORD_PREFIX`.
  - **AC-16 and AC-17(a): update the existing Claude-mode test** (`:1781`). It is a Claude-mode test, so AC-18 does not freeze it.
    - Round 1 writes `review-round-1.md` with the round-1 header, which `findColdCodexArchiveForRound(dir, 1)` returns.
    - Round 1 writes no file starting with `review-cold-codex-run-` and no `review-cold-codex.md`, and the stale `review-cold-codex.md` is removed.
    - The content does not match `/No orchestrator cold lens/` (the old body) and does not match `/\bCodex\b/`.
    - Round 2 writes `review-round-2.md` with `scope=delta` and `base = round-1 reviewedSha`.
    - Replace the old `review-cold-codex-run-1.md` content assertion.
  - **New `AC-17 round lookup across record families` test.**
    - Setup: use `withTempTasksAsync` + `writeRoundTwoTask`. Start from `makeDeps` with the real `findColdCodexArchiveForRound`, `hasMalformedColdCodexArchive` and `hasConflictingRoundRecords`. `resolveCommit` maps `HEAD` → `'b'.repeat(40)`, and other refs → themselves, so the stub ancestry and path probes reach `delta`. One sub-case per fresh task id:
    - **(b) mixed r1 → Claude r2.** Seed `writeColdCodexArchive(dir, { round: 1, reviewedSha: 'a'.repeat(40), … }, 'prior')`, then run a `claude` state. Assert `review-round-1.md` has `round=2 scope=delta base=aaaa…`.
    - **(c) Claude r1 → mixed r2.** Seed `writeRoundRecord(dir, { round: 1, reviewedSha: 'a'.repeat(40), … })`, then run a `mixed` state; the stub cold backend succeeds. Assert:
      - `findColdCodexArchiveForRound(dir, 2)` is `delta` with base `aaaa…`;
      - the new file is `review-cold-codex-run-1.md`;
      - `review-cold-codex.md` is written;
      - the only `review-round-` file is still the seeded one (AC-18: a mixed round writes no neutral record).
    - **(d) conflict.** Seed both families at round 1 with `'a'.repeat(40)` and `'c'.repeat(40)`, then run a `claude` state. Assert the new round-2 record has `scope=full` and `reason="round records for the previous round disagree on the reviewed commit"`.
    - **(d′) agreement.** Seed both at round 1 with the same SHA. Assert `delta`.
    - **Malformed.** Write `review-round-1.md` with the content `'malformed header\n'`, then run a `claude` state. Assert the round-2 reason matches `/unparseable cold-Codex archive record/`, the same text the existing mixed malformed test asserts (`:1615`).
  - **Unit test: per-family numbering.** Seed `review-round-1.md`, `-2.md` and `-10.md` with valid headers, plus `review-cold-codex-run-1.md` through `-12.md` (or just `-12.md`). Assert:
    - `writeRoundRecord` returns `review-round-11.md`;
    - `writeColdCodexArchive` returns `review-cold-codex-run-13.md`;
    - `hasConflictingRoundRecords(dir, 1)` follows the SHAs seeded.
  - Existing mixed tests and their expected values are unchanged (AC-18).
- **Golden check:** run `git diff -- tests/run-task-prompts.golden.json` after the suite and expect no change. Neither the foreman prompt nor any reason string reached by existing fixtures changes.

### Step R5: Docs (AC-19)

- **`docs/pipeline-orchestrator.md:482`.** Rewrite the record sentences:
  - Mixed-mode invocations add `review-cold-codex-run-N.md`, and the unnumbered file keeps the latest findings.
  - Claude-mode invocations add `tasks/<id>/review-round-N.md`, which has the same header and no lens findings, and remove any stale unnumbered findings file.
  - Each family numbers max+1 on its own.
  - The round N−1 lookup reads both families, taking the newest matching file within each. If the two families disagree on the reviewed SHA, the round runs full scope.
  - Then run `npm run sync-templates`, which updates `templates/docs/pipeline-orchestrator.md`.
- **`docs/decisions.md` §"Provider-scoped orchestrator cold lens (2026-10)" (`:579-585`).**
  - **Why:** replace "without inventing a second archive format" with "the neutral record reuses the archive's header format under a lens-neutral filename".
  - **Rule:** replace the `review-cold-codex-run-N.md` sentence and "The numbered filename remains for compatibility" with: "Claude mode writes a numbered `review-round-N.md` record (header only, no lens findings); the delta-scope lookup reads both record families, so a provider switch between rounds keeps delta scope."
  - Leave the 2026-09 cold-Codex archive entry (`:370-374`) as is: it describes mixed mode and is still true.
- **Verify:** `git grep -n "review-cold-codex-run" -- docs templates/docs`. Read every hit and confirm none attributes that file to Claude mode.

### Step R6: Build and validate

- Run `npm run build`, which rewrites `dist/cli/index.js` and `dist/orchestrator/run-task.js`.
- Then run `npm run type-check`, `npm run lint`, `npm test`, `npm run sync-templates:check` and `npm run docs-refs-check`.
- Mutation checks before handoff; confirm each red, then restore:
  - Make `findColdCodexArchiveForRound` read only the cold family: (a), (c) and malformed go red.
  - Drop the conflict branch: (d) goes red.
  - Revert the Claude branch to `writeColdCodexArchive`: AC-16 goes red.
- In the handoff, list `scripts/docs-refs-check.mjs` as deliberately untouched, with the reason given in Round Scope.
