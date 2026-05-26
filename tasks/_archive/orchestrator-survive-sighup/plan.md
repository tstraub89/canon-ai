# Implementation Plan: orchestrator-survive-sighup

> Written by: Claude | Implements: `tasks/orchestrator-survive-sighup/spec.md`

## Approach

Two surgical edits to canon's process-management surface (a SIGHUP handler at the orchestrator entry point + child-stdin detachment in the agent spawner), one new signal-handling test file, and two doc updates. No refactoring, no architectural change — the goal is to stop the orchestrator from dying on SIGHUP without touching anything else.

The entry point at `scripts/run-task.ts` is currently 5 lines: an import, a `main()` call, and a catch. The SIGHUP handler goes at the top of that file as one of the first statements, before `void main()`, so it's installed before any `await` boundary. The stdio change in `streamProcess` is a one-character substitution (`'inherit'` → `'ignore'`) at `agents/stream.ts:32`.

The new test file follows the existing `run-task-<topic>.test.ts` naming convention from `tests/`. It uses Node's built-in `node:test` and spawns a child Node process to assert SIGHUP-survival and SIGINT-termination behaviors.

## Steps

### Step 1: Install SIGHUP handler in the orchestrator entry point

Files: `scripts/run-task.ts`

Current state (5 lines):

```ts
import { main } from './run-task/main.js';

void main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
});
```

Add a SIGHUP handler before `void main()`:

```ts
import { main } from './run-task/main.js';
import { warn } from './run-task/cli.js';

process.on('SIGHUP', () => {
    warn('SIGHUP received; ignoring (orchestrator survives supervising-shell exit).');
});

void main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
});
```

Why this placement: per spec Known Risks, the handler MUST be at module top-level (synchronous, before any `await`). `void main()` is the async boundary; the `process.on('SIGHUP', ...)` registration completes before the event loop starts spinning, which is what we need. SIGINT is intentionally NOT registered — Node's default behavior (terminate on SIGINT) is preserved, satisfying AC-4.

`warn` is the existing helper at [`scripts/run-task/cli.ts:12`](../../scripts/run-task/cli.ts). It writes a yellow `WARN:` prefix to stderr — the stream that `streamProcess` captures into the log via the pipe at [`agents/stream.ts:61-71`](../../scripts/run-task/agents/stream.ts), so the warn line lands in `/tmp/canon-run-*.log` automatically.

### Step 2: Sever child stdin from the supervising tty

Files: `scripts/run-task/agents/stream.ts`

At line 32, change:

```ts
const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
});
```

To:

```ts
const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
});
```

One character substitution. No other change to the file. This is safe because Codex and Claude both receive their prompts as CLI arguments (verified during spec authoring — `agents/codex.ts:49` positional arg, `agents/claude.ts:106` `-p` flag), not via stdin. With `'ignore'`, the children get immediate EOF on a `/dev/null`-equivalent stdin, which is fine because they never read from it.

### Step 3: Add signal-handling test

Files: `tests/run-task-signals.test.ts` (new)

Two test cases using `node:test` and `node:child_process.spawn`:

```ts
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// Path to the orchestrator entry point. Use a no-op invocation (--help or an
// unknown task id) that exits quickly when SIGNAL is NOT sent, so the test
// only succeeds if signal handling works as expected.
const ENTRY = path.resolve('scripts/run-task.ts');

test('SIGHUP does not terminate the orchestrator', async () => {
    // Spawn a child that loads the entry module (importing it installs the SIGHUP handler)
    // but stays alive on its own (e.g., a small inline script that imports run-task.ts
    // and then awaits a never-resolving promise).
    const child = spawn(
        'node',
        ['--import', 'tsx', '-e', `
            await import('${ENTRY}');
            // Keep the process alive so SIGHUP has something to fail to kill.
            await new Promise(() => {});
        `],
        { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    // Give the import time to install the handler.
    await new Promise((r) => setTimeout(r, 500));

    // Send SIGHUP and wait.
    child.kill('SIGHUP');
    await new Promise((r) => setTimeout(r, 500));

    // Assert process is still alive.
    assert.equal(child.exitCode, null, 'orchestrator should survive SIGHUP');
    assert.equal(child.signalCode, null, 'orchestrator should not be signal-terminated');

    // Cleanup.
    child.kill('SIGKILL');
});

test('SIGINT terminates the orchestrator (default behavior preserved)', async () => {
    const child = spawn(/* same shape as above */);
    await new Promise((r) => setTimeout(r, 500));

    child.kill('SIGINT');

    // Wait for exit.
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    // SIGINT default is to terminate with the signal.
    assert.equal(exit.signal, 'SIGINT', 'orchestrator should still terminate on SIGINT');
});
```

**Implementer note**: the exact spawn shape may need tweaking — the `--import tsx` approach runs TypeScript directly without a build step, matching how the existing tests run (`node --test --import tsx tests/*.test.ts` per `package.json`). If a fully-importable entry that doesn't kick off `main()` is needed (since the current entry calls `void main()` at import time), refactor `scripts/run-task.ts` to export the handler installation as a function and call it inline — keeps the test cleanly isolated from the rest of the orchestrator.

If the test ends up flaky on CI due to the 500ms timing, bump to 1000ms. Per the spec's Known Risks, this is acceptable.

### Step 4: Update `docs/patterns.md`

Files: `docs/patterns.md`

Append a "Known Pitfalls" entry under the existing section:

```markdown
### Orchestrator process death on supervising-shell exit (fixed)

Pre-fix: when `canon run <id>` was backgrounded inside Claude Code's bash tool (or any shell that later exited), the Node orchestrator died silently from the SIGHUP cascade. No log message, no stall warning — `/tmp/canon-run-*.log` would just stop being written mid-Codex-turn. `pgrep` would return nothing. The 10-minute stall timer at [`env.ts:50`](../scripts/run-task/env.ts) didn't help because it lived inside the dying process.

Post-fix (this task): the orchestrator installs `process.on('SIGHUP', warn-and-ignore)` at module top-level in [`scripts/run-task.ts`](../scripts/run-task.ts), and child agents are spawned with `stdio[0] === 'ignore'` so they don't inherit the supervising tty. The orchestrator survives supervising-shell death; the stall timer remains armed and is now the load-bearing detection layer for hung agents.

Remaining gaps documented in `docs/BACKLOG.md`: detach mode for backgrounded invocations + heartbeat-based detection for SIGKILL / OOM / panic / sleep classes that SIGHUP-ignore can't cover.
```

(Exact wording can be tuned during implement — the load-bearing parts are the pre/post-fix description, the file references, and the BACKLOG pointer.)

### Step 5: Update `docs/BACKLOG.md` orchestrator-death entry

Files: `docs/BACKLOG.md`

Find the entry titled "Orchestrator dies with supervising bash because it has no SIGHUP handler..." in § "🐛 Harness Bugs". Do NOT flip the `[ ]` to `[x]` — the entry still covers detach mode + heartbeat, which remain open. Instead, add a parenthetical at the top of the entry:

```markdown
- [ ] **Orchestrator dies with supervising bash...** *(surfaced 2026-05-25 during `worktree-canonical-task-state` real-run; **survival fix shipped via `orchestrator-survive-sighup` 2026-05-<dd>** — detach mode and heartbeat-detection layer remain open)*
```

(Date filled in by the implementer at commit time.)

## Testing Plan

- **Unit**: `tests/run-task-signals.test.ts` — two cases (SIGHUP-ignore, SIGINT-still-kills). Validates AC-2 and AC-4 directly.
- **E2E**: N/A — no UI/server surface to exercise. The signal-handling test IS the E2E for this fix.
- **Manual**: human test plan from the spec (steps 1-7) — operator runs canon, closes the parent terminal, confirms the orchestrator survives via `pgrep` and `tail -f` shows the SIGHUP warn line. Counter-test: SIGINT still kills.

## Rollback Plan

Trivially revertible: revert the three lines in `scripts/run-task.ts` (the import + the `process.on` block) and the one character in `agents/stream.ts:32` (`'ignore'` → `'inherit'`). Deletes the test file and doc additions. No data migration, no schema change, no behavior change for foreground invocations means rollback is risk-free.

The only failure mode worth thinking about: if Step 2 turns out to break Codex/Claude in a way Agent B's verification missed (i.e., one of the CLIs DOES read from stdin in a code path nobody noticed), the rollback for Step 2 alone is sufficient — Step 1 (SIGHUP-ignore) is independently safe and worth keeping. Codex/Claude on inherited stdin would still die when the parent tty goes away, but the orchestrator would survive and the stall timer would fire — a partial improvement.
