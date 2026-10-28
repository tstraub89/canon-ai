# Implementation Plan: agent-backend-role-routing

> Written by: Claude | Implements: `tasks/agent-backend-role-routing/spec.md`

## Approach

The work adds a pure role layer in `src/lib/pipeline-policy.ts` and one backend object per vendor (`claudeBackend` in `agents/claude.ts`, `codexBackend` in `agents/codex.ts`). Both implement an `AgentBackend` interface declared in a new `agents/backend.ts`, which also exports `agentBackendFor(role)`. Phases and `main.ts` call `agentBackendFor(role).run({...})`, `.coldReview({...})` or `.resolveConfig(phase, tasks)`. They no longer touch `runClaude` / `runCodex` / `runColdCodexReview` / `getClaudeConfig` / `getCodexConfig`, which stay unchanged as backend internals. Session slots move to role keys through four `state.ts` helpers: read with legacy fallback, write the role key only, clear the pair, and record the phase agent. Routing comes from the phase (`phasePrimaryRole`, `phaseSessionSlot`) and never from `phases[].agent`.

The runner internals (`runClaude`, `runCodex`, `runColdCodexReview`) keep their argv construction byte-for-byte. The one change inside `runCodex` is that it now returns the `agent_message` text it already collects. This is what makes AC-3 tractable. Each parity test drives the real call site against a fake binary on `PATH` that logs `{agent, argv, cwd}`. It compares that log with (a) an oracle run of the unchanged legacy runner, called with exactly the arguments the pre-change call site passed, and (b) literal model, effort and budget tokens under a scrubbed env. On-disk argv fixtures were rejected because prompts embed per-run temp paths and no fixture file is in Affected Files (spec Implementation Notes are non-binding; recorded in notes).

Spec-review nits are folded in. Nit 1: AC-8 red-first uses the fake-`claude`-on-PATH harness next to `tests/run-task-safety.test.ts` "QA failure rejects before partial stdout can salvage done.md". Nit 2: every backend request carries the originating `phase`, and an AC-3 case pins distinct `CLAUDE_MODEL_SPEC` / `CLAUDE_MODEL_PLAN`.

### Feasibility check

- **Exists:** All of the following were confirmed by grep/read:
  - runners: `runClaude` (`agents/claude.ts:87`), `runCodex` (`agents/codex.ts:30`), `runColdCodexReview` (`agents/codex.ts:153`)
  - config getters: `getClaudeConfig` / `getCodexConfig` (`policy.ts`)
  - session helpers: `storeSessionId` / `getStoredSessionId` (`state.ts:475-486`)
  - `CodeReviewPhaseDeps` (`code-review.ts:70`)
  - in `main.ts`: `retryAgentForPhase` (`:3507`), the storage block (`:4235-4262`), `fixUpImplementArtifactRefs` (`:563`), the QA fix-up (`:3937`), orchestrator `checkDeps` (`:3959`) and `printDryRunPlan` (`:1760`)
  - reroute session deletes (`main.ts:3071`, `:3092`)
  - the hallucination clear (`implement.ts:141`)
  - reset clears (`task/index.ts:1115`, `:1188`)
  - `checkDeps` / `isAvailable` (`cli/deps.ts`); `doctorCmd` env/config checks (`doctor.ts:724-753`)
  - test harnesses: `setupInvocationLoggingCliTools` / `runReviewLoopMain` / `prepareReviewEntryMainFixture` (`tests/run-task-safety.test.ts:396, 750`), and the retry subprocess pattern (`tests/run-task-reroute-preflight.test.ts:2102`)

  `src/task/index.ts` already imports from `../orchestrator/state.js`. `src/cli/*` can import `src/lib/pipeline-policy.ts`, which is pure.
- **Real path:** Each phase handler calls a runner, then `runPhase` (`main.ts:3171`) returns a `PhaseRunResult` to the main loop. The loop sets `lastClaudeSessionId` / `lastCodexSessionId`, then the storage block keys on the *pre-phase snapshot* `state.tasks[0].status.phases[phase].agent`, then `checkAndRoute`, then recovery `retryAgentForPhase` (keys on the on-disk `agent`). Existing code that already does part of the work: `runClaude`'s stale-resume retry, and `storeSessionId` writing every bundle member.

  **One additional `main.ts` site not in AC-3's list:** `printDryRunPlan` (`main.ts:1775-1782`) calls `getClaudeConfig` / `getCodexConfig`. It is not an invocation, but AC-2's grep covers it, so Step 8 converts it and keeps its output text identical.
- **Callers:**
  - `runCodeReviewPhase` deps: `tests/run-task-code-review.test.ts:~260-300` (`makeDeps`) and `tests/recovery-hints.test.ts:~990-1010` (inline script).
  - `storeSessionId` / `getStoredSessionId`: `main.ts` only.
  - `retryAgentForPhase`: `recoverPhaseForTask` (`main.ts:3594`), `tests/run-task-reroute-preflight.test.ts:2135, 2177`.
  - `checkDeps` (cli): `src/cli/commands/init.ts:76`.
  - `PhaseRunResult.agent` consumers: `main.ts:4235-4237` only.
  - `runCodex` result consumers: `implement.ts`, `spec-review.ts`, `main.ts:568`, and tests that call `runCodex` directly (`run-task-code-review.test.ts:1000+`). Adding a field is additive.
- **Tests that can fail:**
  - AC-6(a): status with `phases.implement.agent: ""` plus a stored implementer session. Pre-change `retryAgentForPhase` returns `'no_session'` at `main.ts:3510`, so no `codex exec resume` lands in the argv log.
  - AC-6(b): `phases.spec.agent: ""` plus a fake claude emitting `session_id`. The pre-change storage block matches neither branch, so `sessions` has no new key.
  - AC-8: the fake claude prints a stream-json `result` event whose `result` is `"# QA Summary\n\n…"`. In raw stdout the newline is the escaped `\n`, so `extractDoneMdFromStdout(capturedStdout)` finds no `^# QA Summary` line, salvage writes nothing, and the done.md assertion fails.
  - AC-5: seed both keys of every pair. The pre-change reroute/reset/hallucination code leaves the role keys in place.
  - AC-4(a–d): legacy-only, role-only and both-present seeds through `getStoredSessionId` and `storeSessionId`. Pre-change, the role keys are ignored.
- **Predicates:**
  - Slot read: `sessions[slot] ?? sessions[legacy] ?? null`. `undefined` and `null` count as absent and fall through. `''` counts as present and is returned unchanged, as `?? null` does today, so no behavior moves for the empty-string edge. Missing `sessions` returns `null`.
  - `phasePrimaryRole('human_review')` is `null`, so `retryAgentForPhase` returns `'no_session'` silently, as it does today for agent `human`.
  - `phaseSessionSlot('plan' | 'qa' | 'human_review')` is `null`, so nothing is stored. Retry warns "no … session ID stored" and returns `'no_session'`; today's Claude plan/qa path does the same.
  - `recordPhaseAgent` skips a missing phase entry (never creates one) and writes only when the value differs.
  - `PhaseRunResult.agent === null` (preflight rejection) records nothing and stores nothing.
  - `sessionId === null` (interactive or preflight) stores nothing, as today.
- **Scope:** Every file the steps touch is in Affected Files, with one exception. **Contradiction:** the spec's Affected Files table fuses the `tests/run-task-validation.test.ts` row and the `dist/cli/index.js` row onto one line (`… || \`dist/cli/index.js\` | Rebuilt. |`). Running `parseAffectedFilesFromSpec` drops `dist/cli/index.js` (verified). This task changes that bundle (`deps.ts`, `doctor.ts`, `pipeline-policy.ts`, `task/index.ts`), so code_review pre-flight will auto-block on it as out of scope. The plan does not edit the spec. Recorded in `notes.md` `[plan]` for the human to split the row before code_review. The implementer still rebuilds and commits `dist/cli/index.js`, because CI diffs dist.
- **Async/stateful:**
  - `lastClaudeSessionId` and `lastCodexSessionId` collapse into one module-level `lastSessionId`, reset on every phase iteration.
  - The QA fix-up runs in `checkAndRoute('qa')` right after `runPhase('qa')` in the same iteration, so `lastSessionId` is QA's session there, as `lastClaudeSessionId` is today.
  - `recordPhaseAgent` and `storeSessionId` run read-modify-write on status before `checkAndRoute`, in the same order as today's store. No new cross-phase state.
  - Bundle: stores and agent records go to every member. Reads use member 0 for runs and the task's own status for per-task retry, as today.

## Steps

### Step 0: Parity harness first, against the pre-change code

Files: `tests/agent-backend.test.ts` (new), `tests/run-task-safety.test.ts`

Write the AC-3 harness and rows **before** touching `src/`, run them green against today's code, and record that in the handoff. That proves each oracle matches the pre-change call site. Write rows that drive a call site through an exported function, and make no assertion that needs the new API yet. Rows that need the new API (the backend-level spec/plan pin case) come in Step 9.

- **Fake binary.** Write executable `claude` and `codex` shims into a temp `bins/` dir. Use the `writeExecutable` pattern from run-task-safety. Each shim appends `JSON.stringify({ agent, argv: process.argv.slice(1 or 2), cwd: process.cwd() })` to `$FAKE_AGENT_ARGV_LOG`.
  - The claude shim echoes `{"type":"result","result":"ok","session_id":"$FAKE_CLAUDE_SESSION_ID"}`.
  - The codex shim echoes `thread.started`, one `item.completed` `agent_message`, and `turn.completed`, so the cold review succeeds.
  - Both exit 0.

  Also add `cwd: process.cwd()` to the logger line inside `setupInvocationLoggingCliTools` (run-task-safety) so its existing users gain cwd.
- **Scrubbed env.** Run every row in a `runNodeInline`-style subprocess. Delete these from the env: `CLAUDE_MODEL`, `CLAUDE_MODEL_SPEC`, `CLAUDE_MODEL_PLAN`, `CLAUDE_MODEL_REVIEW`, `CLAUDE_MODEL_REVIEW_LARGE`, `CLAUDE_MODEL_QA`, `CLAUDE_MODEL_LIGHT`, `CLAUDE_MODEL_STRONG`, `CLAUDE_BUDGET`, `CODEX_MODEL_MINI`, `CODEX_MODEL_DEFAULT`, `CODEX_MODEL_FULL`, `CODEX_MODEL_DELICATE`, `MAX_REVIEW_LOOPS`. `policy.ts` reads env at module load, so these must be set or unset in the child env, not in-process. Literal assertions then use the shipped defaults; for example, an `L` non-delicate task gives Claude spec `opus` / `medium` / `10.00` and Codex implement `gpt-6-luna` / `max`.
- **Oracle per row.** In the same subprocess, after driving the call site with `FAKE_AGENT_ARGV_LOG=a.jsonl`, call the legacy runner directly with `FAKE_AGENT_ARGV_LOG=b.jsonl` and today's arguments for that site:
  - prompt from the same prompt builder over the same `state`
  - `getClaudeConfig` / `getCodexConfig` for the same phase
  - the same `resumeId`, `cwd` and `wrapForResume`

  `deepEqual` the a/b entries, then assert the literal `--model`, `--effort` / `model_reasoning_effort=`, and `--max-budget-usd` tokens. The runners stay as internals, so the oracle stays importable after the refactor.
- **Rows, mapped to AC-3's numbering:**
  - 1–2: `runSpecPhase(state, false, null)` and `runSpecPhase` with `specReviewVerdict: 'changes_requested'` and a resume id. **Spec passes no `cwd`, so runClaude defaults to REPO_ROOT; keep it that way.**
  - 3: `runSpecReviewPhase`, full tier, with `null` and then a resume id.
  - 4: `runPlanPhase`.
  - 5–7: `runImplementPhase` fresh, resume (`implement.status: 'in_progress'`, stored id, `wrapForResume` true), and rerouted (`implement.rerouted: true`, `wrapForResume` false). Use a git fixture; copy the minimal `makeGitFixture` / worktree-false setup from run-task-safety if needed. **Placement:** if the git setup is too heavy to duplicate, put rows 5–7 in `tests/run-task-safety.test.ts` next to its implement fixtures. Both files are in scope.
  - 8–10: `runCodeReviewPhase` round 1 and round 2+ (`iterations_current_loop: 1`, resume id). Pass deps whose git/validation entries are stubbed like `makeDeps` in run-task-code-review, but whose agent entries are the **real** ones: today `runClaude`, `runColdCodexReview`, `getClaudeConfig` and `getCodexConfig`; after Step 7, the real `agentBackendFor`. The cold lens oracle is `runColdCodexReview(scope.base, cfg.model, cfg.effort, activeCwd, metrics)`.
  - 11: `runQaPhase`.
  - 12: the implement artifact fix-up. Extend the existing run-task-safety test "review-entry docs-refs fix-up resumes the stored implement session in the task worktree" (`:2147`). It already logs argv. Assert the full argv equals `['exec','resume','stored-implement-session','--json','-c',`model_reasoning_effort=${effort}`, `${CODEX_HEADLESS}\n\n${promptArtifactFixup(...)}`, '-m', model]` and that cwd is the worktree. `wrapForResume=false` means no resume wrapper.
  - 13–14: `retryAgentForPhase(taskId, 'implement' | 'spec_review', note)` and `retryAgentForPhase(taskId, 'code_review' | 'spec', note)`, following `tests/run-task-reroute-preflight.test.ts:2102`. Assert the retry cwd and the absence of metrics rows.
  - 15: the QA fix-up. Follow the run-task-safety QA docs-refs fix-up test (grep `qa_fixup` / `Artifact fix-up` in that file). Assert the resumed `--resume <qa-session>` argv, cwd and budget.

### Step 1: Pure role model

Files: `src/lib/pipeline-policy.ts`, `src/orchestrator/policy.ts`, `src/orchestrator/types.ts`

In `pipeline-policy.ts`, after the `ClaudePhase` / `CodexPhase` types, add:

```ts
export type PipelinePhase = 'spec' | 'spec_review' | 'plan' | 'implement' | 'code_review' | 'qa' | 'human_review';
export type AgentRole = 'author' | 'spec_reviewer' | 'implementer' | 'reviewer' | 'cold_reviewer' | 'qa';
export type AgentBackendId = 'claude' | 'codex';
export type SessionSlot = 'author' | 'spec_reviewer' | 'implementer' | 'reviewer';
export type RoleAssignment = Record<AgentRole, AgentBackendId>;

export const AGENT_ROLES: readonly AgentRole[] = ['author', 'spec_reviewer', 'implementer', 'reviewer', 'cold_reviewer', 'qa'];
// The only assignment; there is deliberately no way to select another (provider modes are a follow-up).
export const DEFAULT_ROLE_ASSIGNMENT: RoleAssignment = { author: 'claude', spec_reviewer: 'codex', implementer: 'codex', reviewer: 'claude', cold_reviewer: 'codex', qa: 'claude' };
const PHASE_PRIMARY_ROLE: Record<PipelinePhase, AgentRole | null> = { spec: 'author', spec_review: 'spec_reviewer', plan: 'author', implement: 'implementer', code_review: 'reviewer', qa: 'qa', human_review: null };
// Explicit per phase, not derived from the role: spec and plan share `author`, but only spec stores a session.
const PHASE_SESSION_SLOT: Record<PipelinePhase, SessionSlot | null> = { spec: 'author', spec_review: 'spec_reviewer', plan: null, implement: 'implementer', code_review: 'reviewer', qa: null, human_review: null };

export function roleBackendId(role: AgentRole, assignment: RoleAssignment = DEFAULT_ROLE_ASSIGNMENT): AgentBackendId { return assignment[role]; }
export function phasePrimaryRole(phase: PipelinePhase): AgentRole | null { return PHASE_PRIMARY_ROLE[phase]; }
export function phaseSessionSlot(phase: PipelinePhase): SessionSlot | null { return PHASE_SESSION_SLOT[phase]; }
/** Unique backend ids in first-appearance order over AGENT_ROLES (today: ['claude', 'codex']). */
export function requiredAgentBackends(assignment: RoleAssignment = DEFAULT_ROLE_ASSIGNMENT): AgentBackendId[] { ... }
```

Name the pure function `roleBackendId`, not `backendForRole`, so it can't be confused with `agentBackendFor` in Step 2. Add no `process.env`; AC-1 greps for it.

In `policy.ts`, re-export the four functions and the new types alongside the existing type re-exports. Add no env reads.

In `types.ts`:
- Replace `export type SessionSlot = 'claude_spec' | …` with a type re-export from pipeline-policy.
- Change `StatusJson.sessions` to role keys `author`, `spec_reviewer`, `implementer` and `reviewer` (`string | null`, optional), plus the legacy optional keys `claude_spec`, `claude_review`, `codex` and `codex_spec_review`, under a `/** Legacy (pre-role) keys: read-only fallback, cleared in pairs, never written. */` comment. Keep the deprecated `claude` key.
- Change `PhaseRunResult` to `{ agent: AgentBackendId | null; sessionId; exitCode } | null`.
- Add `text: string` to `CodexRunResult`.

The `PHASE_ORDER`-derived `Phase` must stay assignable to `PipelinePhase`. Type-check catches drift, because `main.ts` passes `Phase` values into these functions.

### Step 2: Backend interface and the two backends

Files: `src/orchestrator/agents/backend.ts` (new), `src/orchestrator/agents/claude.ts`, `src/orchestrator/agents/codex.ts`

`backend.ts`:

```ts
export type AgentMetricsContext = { taskId: string; phase: string; iteration?: number; activeCwd?: string };
export type AgentRunRequest = {
    role: AgentRole;
    phase: PipelinePhase;          // originating phase: drives config (spec vs plan pins differ under `author`)
    tasks: readonly TaskContext[];
    prompt: string;
    interactive: boolean;
    resumeId: string | null;
    metricsContext?: AgentMetricsContext;
    cwd?: string;                  // omitted → runner default (REPO_ROOT); never substitute activeCwd here
    wrapForResume?: boolean;       // Codex only; Claude ignores it
};
export type AgentRunResult = { backend: AgentBackendId; sessionId: string | null; exitCode: number | null; capturedStdout: string; text: string };
export type ColdReviewRequest = { role: AgentRole; phase: PipelinePhase; tasks: readonly TaskContext[]; baseBranch: string; cwd: string; metricsContext?: AgentMetricsContext };
export type AgentConfig = { model: string; effort: string; budget?: string };
/**
 * Failure semantics differ per backend and are intentionally not unified:
 * claude throws AgentSessionError on any non-zero exit; codex throws only on spawn error,
 * stall, or signal, and returns a non-zero exitCode with a warning otherwise.
 * coldReview is provisional (mirrors `codex exec review --base`); claude reports it unsupported.
 */
export interface AgentBackend {
    readonly id: AgentBackendId;
    readonly displayName: string;   // 'Claude' | 'Codex' — dry-run/log labels only
    resolveConfig(phase: PipelinePhase, tasks: readonly TaskContext[]): AgentConfig;
    run(request: AgentRunRequest): Promise<AgentRunResult>;
    coldReview(request: ColdReviewRequest): Promise<ColdCodexReviewResult>;
}
export function agentBackendFor(role: AgentRole): AgentBackend {
    return roleBackendId(role) === 'claude' ? claudeBackend : codexBackend;
}
```

Import `claudeBackend` / `codexBackend` as values. `claude.ts` and `codex.ts` import only *types* from `backend.ts` (`import type`), so there is no runtime import cycle. `ColdCodexReviewResult` stays exported from `codex.ts`; backend.ts type-imports it.

In `claude.ts`, add at the bottom:

```ts
export const claudeBackend: AgentBackend = {
    id: 'claude', displayName: 'Claude',
    resolveConfig(phase, tasks) { return getClaudeConfig(asClaudePhase(phase), tasks); },
    async run(r) {
        const cfg = getClaudeConfig(asClaudePhase(r.phase), r.tasks);
        const result = await runClaude(r.prompt, r.interactive, r.resumeId, cfg.model, cfg.effort, cfg.budget, r.metricsContext, r.cwd);
        return { backend: 'claude', sessionId: result.sessionId, exitCode: result.exitCode, capturedStdout: result.capturedStdout, text: result.processedText };
    },
    coldReview() { return Promise.reject(new Error('The claude agent backend does not support cold review.')); },
};
```

- `asClaudePhase` throws `Error` for a phase outside `spec | plan | code_review | qa`. That is a programming error, unreachable under the only assignment.
- `r.cwd` passed as `undefined` lets runClaude's default (REPO_ROOT) apply, which preserves spec's REPO_ROOT cwd.
- Import `getClaudeConfig` from `../policy.js`.

In `codex.ts`:
- In `runCodex`, return `text: displayChunks.join('\n\n')` on the headless path and `text: ''` on the interactive path. Change nothing else in runCodex.
- Add `codexBackend`. `run` calls `runCodex(r.prompt, r.interactive, r.resumeId, cfg.model, cfg.effort, r.metricsContext, r.cwd, r.wrapForResume ?? true)`; when `r.cwd` is undefined, the default param applies.
- `coldReview` calls `runColdCodexReview(r.baseBranch, cfg.model, cfg.effort, r.cwd, r.metricsContext)`, with `cfg = getCodexConfig('code_review', r.tasks)`.
- `asCodexPhase` guards `spec_review | implement | code_review`.

### Step 3: State helpers (role write, legacy-fallback read, pair clear, agent record)

Files: `src/orchestrator/state.ts`

```ts
// The only place legacy slot names live (plus the optional fields in types.ts).
const LEGACY_SESSION_KEY = { author: 'claude_spec', spec_reviewer: 'codex_spec_review', implementer: 'codex', reviewer: 'claude_review' } as const satisfies Record<SessionSlot, keyof NonNullable<StatusJson['sessions']>>;

export function readSessionSlot(status: StatusJson, slot: SessionSlot): string | null {
    const sessions = status.sessions;
    return sessions?.[slot] ?? sessions?.[LEGACY_SESSION_KEY[slot]] ?? null;
}
/** Removes the role key and its legacy key. Returns true when either existed. */
export function clearSessionSlot(status: StatusJson, slot: SessionSlot): boolean { ... Object.hasOwn + delete both ... }
export function storeSessionId(taskIds: string[], slot: SessionSlot, sessionId: string): void   // role key only; legacy untouched
export function getStoredSessionId(taskIds: string[], slot: SessionSlot): string | null { return readSessionSlot(readStatus(taskIds[0]), slot); }
/** Record which backend ran a phase's primary role. Skips missing entries; writes only on change. */
export function recordPhaseAgent(taskIds: string[], phase: Phase, backend: AgentBackendId): void
```

### Step 4: Simple phases (spec, plan, spec_review, qa)

Files: `src/orchestrator/phases/spec.ts`, `plan.ts`, `spec-review.ts`, `qa.ts`

Replace each `getClaudeConfig` / `getCodexConfig` plus runner pair with:

```ts
const result = await agentBackendFor('author').run({ role: 'author', phase: 'spec', tasks, prompt: promptSpec(...), interactive, resumeId: null, metricsContext: {...} });
return { agent: result.backend, sessionId: result.sessionId, exitCode: result.exitCode };
```

Per-file specifics:
- **spec:** both branches **omit `cwd`**. Today's calls pass no cwd.
- **plan:** `role: 'author'`, `phase: 'plan'`, `cwd: activeCwd`.
- **spec_review:** `role: 'spec_reviewer'`, `cwd: activeCwd`. Keep the fast-tier `return null`.
- **qa:** `role: 'qa'`, `cwd: activeCwd`.

Remove the `agents/claude.js` / `agents/codex.js` and `getClaudeConfig` / `getCodexConfig` imports. No phase file may contain `'claude'` or `'codex'` in quotes, comments included (AC-2 grep). Leave the operator `info()` texts ("Claude revises specs…") unchanged.

AC-8 salvage in `qa.ts`:

```ts
if (!state.isBundle && (result.text || result.capturedStdout)) {
    ...
    if (isDoneMdTemplate(donePath)) {
        const salvaged = extractDoneMdFromStdout(result.text) || extractDoneMdFromStdout(result.capturedStdout);
```

Change the warning text only if needed; "from captured stdout" may stay.

### Step 5: Implement phase

Files: `src/orchestrator/phases/implement.ts`

Use `agentBackendFor('implementer').run({ role: 'implementer', phase: 'implement', tasks, prompt: implementPrompt, interactive, resumeId: shouldResume ? resumeId : null, metricsContext: {...}, cwd: activeCwd, wrapForResume: !isRerouted })`. In the hallucination path, replace `delete s.sessions.codex` with `if (clearSessionSlot(s, 'implementer')) writeStatus(taskId, s);`. That changes nothing when the key is absent; today it writes whenever `s.sessions` exists, and either is fine. Keep the warn and auto-block texts, which say "Codex" in operator wording.

### Step 6: Code-review phase

Files: `src/orchestrator/phases/code-review.ts`

- `CodeReviewPhaseDeps`: remove `getClaudeConfig`, `getCodexConfig`, `runColdCodexReview` and `runClaude`, and add `agentBackendFor: typeof agentBackendFor`. Mirror the change in `defaultDeps`.
- Preflight rejection returns `{ agent: null, sessionId: null, exitCode: 0 }`.
- Cold lens:

  ```ts
  const coldBackend = deps.agentBackendFor('cold_reviewer');
  const coldReview = await coldBackend.coldReview({ role: 'cold_reviewer', phase: 'code_review', tasks, baseBranch: scope.base, cwd: activeCwd, metricsContext: {...} });
  ```

  On failure, `throw new AgentSessionError({ agent: coldBackend.id, ... })`, with the same reason text.
- Foreman: `deps.agentBackendFor('reviewer').run({ role: 'reviewer', phase: 'code_review', tasks, prompt, interactive, resumeId: reviewResumeId, metricsContext, cwd: activeCwd })`. Return `{ agent: result.backend, ... }`.

### Step 7: `main.ts`: storage, retry, reroute, fix-ups, record, deps

Files: `src/orchestrator/main.ts`

- **Imports.** Drop `import * as splitClaude` and `import * as splitCodex`. Import `agentBackendFor` from `./agents/backend.js`, and `phasePrimaryRole` / `phaseSessionSlot` / `requiredAgentBackends` via `splitPolicy` (or directly).
- **Module state.** Replace `lastClaudeSessionId` / `lastCodexSessionId` with `let lastSessionId: string | null = null;`. Comment: the session of the phase just run; the QA fix-up resumes it in-process. Keep `lastCodexExitStatus = phaseResult?.agent === 'codex' ? (phaseResult.exitCode ?? 0) : 0`, which is the named failure-semantics quirk.
- **Storage block (`:4235`).** Replace it with:

  ```ts
  lastSessionId = phaseResult?.sessionId ?? null;
  ...
  if (currentPhase !== 'complete' && currentPhase !== 'human_review') {
      if (phaseResult?.agent) {
          splitState.recordPhaseAgent(taskIds, currentPhase, phaseResult.agent);
          const slot = splitPolicy.phaseSessionSlot(currentPhase);
          if (slot && lastSessionId) {
              splitState.storeSessionId(taskIds, slot, lastSessionId);
              splitCli.info(`${agentBackendFor(splitPolicy.phasePrimaryRole(currentPhase)!).displayName} session stored (${slot}): ${lastSessionId.slice(0, 8)}...`);
          }
      }
      await checkAndRoute(currentPhase, taskIds);
  }
  ```

  Rewrite the cluster comment above it to name role slots: spec → author, code_review → reviewer, spec_review → spec_reviewer, implement → implementer; plan and qa are not stored. Keep the per-slot rationale and drop the legacy names (AC-5 grep).
- **`runPhase` (`:3171`).** Read `getStoredSessionId(taskIds, 'author' | 'reviewer' | 'spec_reviewer' | 'implementer')`, rename the locals, and rewrite the comments without legacy names.
- **`retryAgentForPhase` (`:3507`).**

  ```ts
  const role = splitPolicy.phasePrimaryRole(phase);
  if (!role) return 'no_session';
  const backend = agentBackendFor(role);
  const slot = splitPolicy.phaseSessionSlot(phase);
  const sessionId = slot ? splitState.readSessionSlot(status, slot) : null;
  if (!sessionId) { warn(`Cannot retry ${phase} for ${taskId}: no ${backend.id} session ID stored.`); return 'no_session'; }
  ...prompt unchanged...
  warn(`Retrying ${backend.id} session ...`);
  ...retryCwd unchanged...
  await backend.run({ role, phase, tasks: retryTasks, prompt, interactive: false, resumeId: sessionId, cwd: retryCwd });  // no metricsContext, as today
  ```

  The per-vendor "not a Codex/Claude-run phase" guards go away, because the role now derives from the phase. Build `retryTasks` once. Rewrite the slot comment without legacy names.
- **Reroute (`:3071`, `:3092`).** Use `splitState.clearSessionSlot(status, 'reviewer')` always, and `clearSessionSlot(status, 'spec_reviewer')` inside `if (isFullTierReroute)`.
- **Implement fix-up (`:563`).**

  ```ts
  const sessionId = splitState.getStoredSessionId(taskIds, 'implementer');
  ...
  runSession: agentBackendFor('implementer').run({ role: 'implementer', phase: 'implement', tasks: fixupTaskContexts(taskIds), prompt, interactive: false, resumeId: sessionId, metricsContext: { taskId: taskIds[0], phase: 'implement_fixup', activeCwd: cwd }, cwd, wrapForResume: false })
  ```

  Return `exitCode === 0`. In the no-session warning, take the agent name from `agentBackendFor(opts.phase === 'implement' ? 'implementer' : 'qa').id` instead of the literal ternary. That ternary does not fail an AC grep, but routing on phase is the point of the task.
- **QA fix-up (`:3937`).** Set `const sessionId = lastSessionId;`. Then call `agentBackendFor('qa').run({ role: 'qa', phase: 'qa', tasks: fixupTaskContexts(taskIds), prompt, interactive: false, resumeId: sessionId, metricsContext: { taskId: taskIds[0], phase: 'qa_fixup', activeCwd: cwd }, cwd })` and return `true`.
- **`printDryRunPlan` (`:1775`).** For each phase other than human_review and fast-tier spec_review:

  ```ts
  const role = phasePrimaryRole(phase); const backend = agentBackendFor(role); const cfg = backend.resolveConfig(phase, tasks);
  console.log(`  - ${phase}: ${backend.displayName} / ${cfg.model} / ${cfg.effort}`);
  ```

  Output text stays identical.
- **Orchestrator `checkDeps` (`:3959`).** Use `for (const dep of splitPolicy.requiredAgentBackends())`. Keep the label map.
- **Grep check.** Run `grep -nE "\b(runClaude|runCodex|runColdCodexReview)\(|getClaudeConfig|getCodexConfig|agents/(claude|codex)\.js|claude_spec|claude_review|codex_spec_review" src/orchestrator/main.ts`. It must print nothing.

### Step 8: Task CLI resets, deps and doctor

Files: `src/task/index.ts`, `src/cli/deps.ts`, `src/cli/commands/doctor.ts`

- **`task/index.ts`.** Import `clearSessionSlot` from `../orchestrator/state.js`.
  - `reset-spec-review`: `clearSessionSlot(status, 'author')`, message `… verdict cleared, author session dropped)`.
  - `reset-code-review`: `clearSessionSlot(status, 'reviewer')`, message `… verdict cleared, reviewer session dropped)`.

  No test asserts the old message strings (grep `session dropped` in tests: none).
- **`deps.ts`.**

  ```ts
  const GIT_DEP: Dep = { cmd: 'git', installHint: 'https://git-scm.com/downloads' };
  const AGENT_DEPS: Record<AgentBackendId, Dep> = { claude: {...today's hint}, codex: {...today's hint} };
  export function requiredHardDeps(agents: readonly AgentBackendId[] = requiredAgentBackends()): Dep[] { return [GIT_DEP, ...agents.map(a => AGENT_DEPS[a])]; }
  export function checkDeps(available: (cmd: string) => boolean = isAvailable): void   // HARD_DEPS → requiredHardDeps(); isAvailable → available
  ```

  Import from `../../lib/pipeline-policy.js`. Order stays git, claude, codex.
- **`doctor.ts`.** Set `const agents = requiredAgentBackends();`.
  - The env checks keep today's order: `checkBinary('claude')` and `checkClaudeVersion()` when `agents.includes('claude')`, and `checkBinary('codex')` when `agents.includes('codex')`.
  - The config checks include `checkCodexProjectTrust(cwd)` only when `agents.includes('codex')`, in the same position.

### Step 9: Tests

Files: `tests/pipeline-policy.test.ts`, `tests/agent-backend.test.ts`, `tests/run-task-code-review.test.ts`, `tests/recovery-hints.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/run-task-safety.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-validation.test.ts`

See the Testing Plan. Rewire the existing deps fixtures first:
- **`makeDeps`** in run-task-code-review: provide `agentBackendFor: role => role === 'cold_reviewer' ? fakeCold : fakeReviewer`. The fakes record the same `cold:${model}:${effort}:${cwd}:…` / `foreman` events; take model and effort from a stub `resolveConfig` returning today's fixture values, so existing assertions such as `mini-from-policy` keep their meaning.
- **recovery-hints** inline deps (`:999-1006`): use the same replacement, returning `{ id: 'claude', displayName: 'Claude', resolveConfig, run, coldReview }`. Keep the `agent-called.txt` side effect inside `run`.

### Step 10: Docs

Files: `docs/pipeline-orchestrator.md`, then `npm run sync-templates`, which writes `templates/docs/pipeline-orchestrator.md`; `docs/patterns.md`; `docs/codebase-map.md`; `docs/decisions.md`

- **`pipeline-orchestrator.md`.**
  - Line 125 (`reset-spec-review`): "drops the stored `author` session (and its pre-upgrade legacy key) so the next pass runs against a fresh Claude spec session."
  - Line 126: the same edit with `reviewer`.
  - Line 438: the four slots are `sessions.author`, `sessions.reviewer`, `sessions.implementer` and `sessions.spec_reviewer`, chosen by phase. `spec_reviewer` stays separate so it never clobbers the implement session. Tasks started before the upgrade keep their old vendor-named keys; reads fall back to them, writes go only to the role keys, and every clear removes both. Phase `agent` fields now record which backend ran the phase rather than route it. Also fix "prior `claude_review` session" → "prior `reviewer` session".
  - Line 503: "drops the stored `reviewer` session".

  Don't name a legacy key in adopter-facing text except as "pre-upgrade vendor-named keys"; this file ships to adopters. Naming `claude_spec` etc. once, in parentheses, as the legacy names is acceptable, since adopters' in-flight status files carry them.
- **`patterns.md:146`.** Replace "clear the session slot (e.g., `sessions.codex_spec_review`)" with "clear the session slot through `clearSessionSlot()` (e.g., the `spec_reviewer` slot), which removes the role key and its legacy key together. A hand-deleted legacy key alone no longer forces a fresh session."
- **`codebase-map.md`.** Add a row: `Agent backends | src/orchestrator/agents/backend.ts | AgentBackend interface + agentBackendFor(role); phases and main.ts route by role (pipeline-policy.ts phasePrimaryRole / phaseSessionSlot), never by phases[].agent`. Update row 33's description to "Claude and Codex backends wrapping the subprocess runners".
- **`decisions.md`.** Append "## Phases route by role through agent backends (2026-10)" in the existing **Decision** / **Why** / **Rule** shape:
  - **Decision:** six roles; phase → role and phase → slot maps; the role-keyed slots `author`, `spec_reviewer`, `implementer` and `reviewer`, with a legacy read fallback and pair clears; `phases[].agent` is a record.
  - **Why:** vendor-keyed slots and the routing-by-agent-string hazard; the foundation for provider modes.
  - **Rule:** today's assignment and cross-model review are unchanged (§"Two distinct agents" still holds). A session id is valid only for the backend that created it, so any future provider mode must pin the provider per task at creation (Decision 6). Per-backend failure semantics stay asymmetric.

### Step 11: Build and validate

Run `npm run build` and commit `dist/cli/index.js` and `dist/orchestrator/run-task.js`. Then run `npm run lint`, `npm run type-check`, `npm test`, `npm run sync-templates:check` and `npm run docs-refs-check`, plus the AC greps:

```bash
grep -c "process.env" src/lib/pipeline-policy.ts                                   # 0
grep -rnE "agents/(claude|codex)\.js" src/orchestrator/phases src/orchestrator/main.ts   # none
grep -nE "\b(runClaude|runCodex|runColdCodexReview)\(" src/orchestrator/main.ts     # none
grep -rnE "\b(getClaudeConfig|getCodexConfig)\b" src/orchestrator/phases src/orchestrator/main.ts  # none
grep -rnE "'(claude|codex)'" src/orchestrator/phases                               # none
grep -rnE "(claude_spec|claude_review|codex_spec_review)" src                      # state.ts + types.ts only
grep -rniE "CANON_PROVIDER|provider_mode|--provider" src                           # none
git diff --name-only main...HEAD -- src/orchestrator/prompts/ tests/run-task-prompts.golden.json   # empty
```

The prompts goldens must not move. If `run-task-prompts` tests fail, a prompt was touched; revert it.

## Testing Plan

- **Unit (`tests/pipeline-policy.test.ts`, AC-1):** Add three table-driven tests:
  - (a) `roleBackendId` for each of the six roles
  - (b) `phasePrimaryRole` over every `PHASE_ORDER` phase, including `human_review → null`
  - (c) `phaseSessionSlot` over every phase, including plan/qa/human_review → null

  Also cover `requiredAgentBackends()` returning `['claude', 'codex']`, and a fixture assignment with every role on `claude` returning `['claude']` (AC-7 derivation).
- **`tests/agent-backend.test.ts` (new):**
  - **AC-3:** the 15 parity rows from Step 0, unless rows 5–7 or 12/15 live in run-task-safety. Add the pin case: in a subprocess with `CLAUDE_MODEL_SPEC=spec-pin` and `CLAUDE_MODEL_PLAN=plan-pin`, call `agentBackendFor('author').run({ phase: 'spec' })` and `.run({ phase: 'plan' })` on identical tasks and assert `--model spec-pin` / `--model plan-pin` in the argv log. Add a `printDryRunPlan` check only if the function is reachable via `main()` with `--dry-run` cheaply; otherwise rely on grep plus type-check.
  - **AC-4:** for each of the four slots, (a) legacy-only, (b) role-only and (c) both, through `getStoredSessionId`, and (d) `storeSessionId` writes the role key and leaves the legacy key byte-equal. Use `CANON_TASKS_DIR_OVERRIDE` with a temp tasks root, in a subprocess or with the env set before the dynamic import, following how run-task-safety does it. The artifact fix-up read of a legacy `codex` key is covered end-to-end by the existing test at run-task-safety `:2147`, which seeds `codex: 'stored-implement-session'` and asserts the resume. Keep that test passing unchanged, and add a sibling that seeds `implementer` only.
  - **AC-7:** `checkDeps(probe)` where the probe returns false for `claude` and `codex`. Intercept `process.exit` (replace it with a throwing stub, restore it in `finally`) and capture `console.error`; assert both `✗ claude` and `✗ codex` appear. Also assert that `requiredHardDeps().map(d => d.cmd)` deep-equals `['git', 'claude', 'codex']`.
  - **Backend unit:** `claudeBackend.coldReview` rejects. `codexBackend.run` returns `text` equal to the joined `agent_message` texts. `claudeBackend.run` returns `text === processedText`.
- **`tests/recovery-hints.test.ts`:** Rewire the deps. **AC-6(a), red-first:** status with `phases.implement.agent: ""` and `sessions.implementer: 'retry-session'`. Call `retryAgentForPhase(taskId, 'implement', 'evidence')` in a subprocess with fake codex on PATH. Assert that the argv log contains `exec resume retry-session` and that the return is not `'no_session'`. Run it against the pre-change code first and note the failure in the handoff.
- **`tests/run-task-safety.test.ts`:**
  - **AC-5 hallucination:** a revision implement with no source diff, seeded with `implementer` + `codex` + `author` + `claude_spec`. Only `implementer` and `codex` are removed, on every bundle member. Find the existing hallucination test (grep `hallucination signature`) and extend it with both keys.
  - **AC-8, red-first:** next to "QA failure rejects before partial stdout can salvage done.md". The fake `claude` prints `{"type":"result","result":"# QA Summary\n\nAll checks passed.\n","session_id":"qa-1"}` and exits 0. Run `runQaPhase` and assert that `done.md` exists and starts with `# QA Summary`. If the salvage's `taskPhase(…,'qa','done')` gate trips on fixture gaps, seed what the gate needs (for example `pr-body.md`) rather than weakening the done.md assertion.
  - **AC-6(b)/(c):**
    - (b), red-first: use `runReviewLoopMain` with `--step`, a `spec`-phase fixture whose `phases.spec.agent` is `""`, `FAKE_CLAUDE_SESSION_ID=spec-sess` and `FAKE_AGENT_COMPLETE_PHASE=spec`. Assert `sessions.author === 'spec-sess'` and that `phases.spec.agent === 'claude'` covers (c) for spec.
    - (c), the remaining phases: one `--step` per phase (spec_review → codex, plan → claude, implement → codex, code_review → claude, qa → claude), or a `FAKE_AGENT_COMPLETE_SEQUENCE` run. Assert each `phases[p].agent`.

    The spec lists these under `run-task-validation.test.ts`. They are placed here because the main-loop harness lives here; both files are in Affected Files.
  - Existing legacy-key seeds (`codex: 'resume-1234567890'`, `claude_spec` / `claude_review` resets at `:8456-8564`) must pass unchanged through the fallback and pair clears.
- **`tests/run-task-code-review.test.ts`:** **AC-6(d):** a preflight rejection (`verifyHandoffAgainstDiff` returns an issue) returns `agent: null`. Then drive the storage step, or assert at the main level via a `--step` run in run-task-safety, that `phases.code_review.agent` keeps its seeded value, for example `'seeded'`. The minimal form asserts `runCodeReviewPhase(...)` resolves `{ agent: null, sessionId: null }` and that `recordPhaseAgent` is never reached, because main records only when `agent` is non-null. Prefer the main-level form if the harness allows.
- **`tests/run-task-reroute-preflight.test.ts` (AC-5 reroute):** The fixtures at `:1765` / `:1831` gain role keys alongside the legacy keys (`spec_reviewer`, `reviewer`, `implementer`, `author`).
  - Full tier: `spec_reviewer`, `codex_spec_review`, `reviewer` and `claude_review` are removed; `implementer`, `codex`, `author` and `claude_spec` remain.
  - Non-full tier: `reviewer` and `claude_review` are removed; `spec_reviewer` and `codex_spec_review` remain.

  Keep the `:838` / `:886` test passing.
- **`tests/task-cli.test.ts` (AC-5 resets):** At `:1120` / `:1191` / `:1346` / `:2782`, seed both keys plus an unrelated pair. `reset-spec-review` removes exactly `author` and `claude_spec`; `reset-code-review` removes exactly `reviewer` and `claude_review`.
- **`tests/run-task-validation.test.ts` (AC-11):** Read `.canon/templates/status.json` from `process.cwd()`. For each `PHASE_ORDER` phase except `human_review`, `phases[p].agent === roleBackendId(phasePrimaryRole(p)!)`; `human_review.agent === 'human'`.
- **E2E:** N/A.

## Open questions (unattended; interpretation chosen)

- **Affected Files row fusion.** `dist/cli/index.js` is unparseable in the spec, so code_review pre-flight would flag it. The plan does not edit the spec; the human should split the row before code_review. Logged in `notes.md`.
- **Parity oracle.** The oracle is a live legacy-runner call plus literal tokens, not an on-disk argv fixture. Rationale is in Approach.
- **Empty-string session ids.** The `??` semantics are kept, so `''` counts as present. This keeps today's behavior rather than tightening it.
