// scripts/run-task/detach.ts
//
// Orchestrator detach mode. When canon run is invoked with stdout NOT a TTY
// (the typical case inside Claude Code's Bash tool, CI, piped invocations),
// the parent process spawns a detached child that inherits its own session
// via `detached: true` (setsid) and exits. The child runs the actual pipeline
// in a process group separate from the parent's harness pgroup — so when the
// harness later kills its own children (operator-session resume, terminal
// close, etc.), the orchestrator survives.
//
// Context: this is fix 2 of the three-fix orchestrator-death plan in
// docs/BACKLOG.md ("Orchestrator dies silently in background mode"). Fix 1
// (#105) makes the orchestrator survive SIGHUP. Fix 3 (heartbeat, shipped
// 06bb7ed) detects deaths. This module prevents the most common observed
// kill class: harness pgroup termination during session resume.
//
// Operator UX:
//   - canon run <id>          (non-TTY → auto-detach; prints PID + log path)
//   - canon stop <id>         (reads .canon-pid, SIGTERM → SIGKILL escalation)
//   - canon doctor            ("Active orchestrators" already reports
//                              heartbeat freshness; PID comes from heartbeat)
//   - tail -f tasks/<id>/.canon-run.log  (live output of the detached run)
//
// Opt-out: CANON_NO_DETACH=1 in env forces foreground mode regardless of
// TTY state. Useful in CI that prefers the harness to manage the lifecycle
// (e.g., wants the parent's exit code to reflect the run).
//
// Files this module owns:
//   - tasks/<id>/.canon-pid       (one line: PID of the detached orchestrator)
//   - tasks/<id>/.canon-run.log   (combined stdout + stderr of the run)

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Narrowed signature for the one spawn shape we actually call. The full
// `typeof spawn` is heavily overloaded — using it as a public seam forces
// test fakes to satisfy every overload. We only need one call site.
export type SpawnImpl = (
    command: string,
    args: readonly string[],
    options: {
        detached?: boolean;
        stdio?: ('ignore' | 'inherit' | 'pipe' | number)[];
        env?: NodeJS.ProcessEnv;
    },
) => ChildProcess;

// Set by the parent on the detached child's env. Presence means "you are
// the child — don't re-detach in a loop." The disable flag overrides this
// only in the parent direction (it disables the FIRST detach); the child
// always sees CANON_DETACHED=1 and proceeds straight to the pipeline.
export const DETACH_CHILD_FLAG = 'CANON_DETACHED';
export const DETACH_DISABLE_FLAG = 'CANON_NO_DETACH';

const PID_FILENAME = '.canon-pid';
const LOG_FILENAME = '.canon-run.log';

export interface ShouldAutoDetachOptions {
    stdout?: NodeJS.WriteStream;
    env?: NodeJS.ProcessEnv;
}

/**
 * True when this process should respawn itself as a detached child. Four
 * gates, in order:
 *
 *   1. If we're already the detached child (env flag set), don't re-detach.
 *   2. If the operator set CANON_NO_DETACH=1, honor it — they want sync.
 *   3. If we're inside Node's `--test` runner, never detach. Test children
 *      that import main.ts and call main() rely on synchronous side-effects
 *      visible to the parent test process; backgrounding the orchestrator
 *      would make every test see "Detached." and exit immediately. Node
 *      announces test mode via `--test` (or `--test-only`) in execArgv.
 *   4. If stdout is a TTY, the operator is at an interactive terminal —
 *      stay foreground so Ctrl-C semantics work naturally.
 */
export function shouldAutoDetach(options: ShouldAutoDetachOptions = {}): boolean {
    const env = options.env ?? process.env;
    const stdout = options.stdout ?? process.stdout;
    if (env[DETACH_CHILD_FLAG] === '1') return false;
    if (env[DETACH_DISABLE_FLAG] === '1') return false;
    if (isUnderNodeTestRunner()) return false;
    if (stdout.isTTY) return false;
    return true;
}

function isUnderNodeTestRunner(): boolean {
    // Node propagates --test into spawned children via execArgv only when
    // it was explicitly inherited; for safety we check both this process's
    // execArgv AND the NODE_OPTIONS env var (which is how spawned children
    // typically receive the flag). Either signal is sufficient.
    if (process.execArgv.some((arg) => arg === '--test' || arg === '--test-only')) return true;
    const nodeOpts = process.env.NODE_OPTIONS ?? '';
    if (/\B--test(\b|-only\b)/.test(nodeOpts)) return true;
    return false;
}

export interface DetachAndExitOptions {
    taskIds: string[];
    resolveTaskDir: (taskId: string) => string;
    // Full process.argv from the parent. The detached child re-executes the
    // same binary with the same script + args.
    argv: readonly string[];
    // Override for tests; defaults to process.execPath.
    execPath?: string;
    // Override for tests; defaults to spawn from node:child_process.
    spawnImpl?: SpawnImpl;
    // Override for tests; defaults to process.exit. Always called with 0 on
    // success; tests can capture instead of terminating the runner.
    exit?: (code: number) => never;
    // Override for tests; defaults to process.stdout.write / stderr.write.
    stdoutWrite?: (s: string) => void;
    stderrWrite?: (s: string) => void;
}

/**
 * Respawn the orchestrator as a detached child and exit the parent.
 *
 * Pre-conditions:
 *   - shouldAutoDetach() returned true.
 *   - All CLI validation has already passed in the parent — once we detach,
 *     any error becomes invisible to the operator (it lands in the log file
 *     only). Detach AFTER argument parsing, dependency checks, ship one-shots,
 *     reroute reset/validation, and pipeline-state validation.
 *
 * Post-conditions:
 *   - Returns `never`: the parent process has called exit(0).
 *   - The detached child is running with `CANON_DETACHED=1` in its env so
 *     when it re-enters main() and re-evaluates shouldAutoDetach(), it
 *     proceeds straight to the pipeline.
 *   - For each task in `taskIds`, `tasks/<id>/.canon-pid` contains the
 *     child's PID (one line, plain integer).
 *   - Combined stdout + stderr of the child is appended to
 *     `tasks/<taskIds[0]>/.canon-run.log`. Subsequent tasks in a bundle
 *     share the primary task's log (the orchestrator's output is per-run,
 *     not per-task).
 */
export function detachAndExit(options: DetachAndExitOptions): never {
    const exit = options.exit ?? ((code: number): never => process.exit(code));
    const stdoutWrite = options.stdoutWrite ?? ((s: string): void => { process.stdout.write(s); });
    const stderrWrite = options.stderrWrite ?? ((s: string): void => { process.stderr.write(s); });
    const spawnFn = options.spawnImpl ?? spawn;
    const execPath = options.execPath ?? process.execPath;

    if (options.taskIds.length === 0) {
        // Nothing to detach FOR. Surface the bug to the operator instead of
        // silently producing an orphaned child. Caller should have filtered
        // earlier; this is defense-in-depth.
        stderrWrite('canon: detachAndExit called with no task IDs (internal bug)\n');
        return exit(1);
    }

    const primaryDir = options.resolveTaskDir(options.taskIds[0]);
    try {
        fs.mkdirSync(primaryDir, { recursive: true });
    } catch (error) {
        stderrWrite(`canon: cannot create task dir for log file: ${(error as Error).message}\n`);
        return exit(1);
    }

    const logPath = path.join(primaryDir, LOG_FILENAME);
    let logFd: number;
    try {
        logFd = fs.openSync(logPath, 'a');
    } catch (error) {
        stderrWrite(`canon: cannot open ${logPath}: ${(error as Error).message}\n`);
        return exit(1);
    }

    // Spawn the detached child with the same exec path and argv. Stdin is
    // ignored (children don't read it; this was already the design from
    // PR #105's stdin → 'ignore' fix). Stdout and stderr both go to logFd
    // — the child's own console.log/console.error appends to the run log.
    // detached: true → setsid() on POSIX, new session/pgroup. The harness's
    // pgroup-kill cannot reach across this boundary.
    // The parent has already applied the reroute reset before reaching the
    // detach gate. If the child re-executes with --reroute still present, it
    // repeats the reset and dies because the task is no longer at the
    // pre-reroute phase.
    //
    // Why strip the flag rather than guard the reset on CANON_DETACHED: that
    // env var is inherited by EVERY subprocess the orchestrator spawns (agent
    // runners, test children), so a `process.env.CANON_DETACHED !== '1'` guard
    // on the reset would also suppress it in those nested main() contexts — not
    // just in this detached child. Stripping --reroute here is scoped precisely
    // to the re-exec child this function creates. Do not "simplify" back to an
    // env guard.
    const args = options.argv.slice(1).filter(arg => arg !== '--reroute'); // [scriptPath, ...userArgs]
    const child = spawnFn(execPath, args, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, [DETACH_CHILD_FLAG]: '1' },
    });

    // After spawn the fd is held by the child; the parent doesn't need it.
    try { fs.closeSync(logFd); } catch { /* already closed */ }

    if (child.pid == null) {
        stderrWrite('canon: detached spawn failed (no PID returned)\n');
        return exit(1);
    }

    // Write .canon-pid for EVERY task in the bundle. `canon stop <any-id>`
    // can then find the run regardless of which task ID the operator
    // happens to remember. Failures are surfaced (not swallowed): if one
    // task's pid file fails to write, `canon stop <that-id>` falls back to
    // .heartbeat.json's pid field — but only once the child has written
    // the first heartbeat. Until then, that task ID is unreachable; the
    // operator deserves to know.
    const pidWriteFailures: Array<{ taskId: string; reason: string }> = [];
    for (const taskId of options.taskIds) {
        try {
            const dir = options.resolveTaskDir(taskId);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, PID_FILENAME), `${child.pid}\n`, 'utf8');
        } catch (error) {
            pidWriteFailures.push({
                taskId,
                reason: (error as Error).message,
            });
        }
    }
    if (pidWriteFailures.length > 0) {
        stderrWrite(
            `canon: warning — failed to write .canon-pid for ${pidWriteFailures.length} task(s):\n`,
        );
        for (const failure of pidWriteFailures) {
            stderrWrite(`  - ${failure.taskId}: ${failure.reason}\n`);
        }
        stderrWrite(
            `  canon stop <id> will fall back to .heartbeat.json (parent writes the initial record below).\n`,
        );
    }

    // No bootstrap heartbeat write. An earlier attempt had the parent write
    // an initial heartbeat record for the child's PID, but codex flagged
    // (review of bc7672a) that this record looks identical to a real child
    // tick — a child that crashes during boot leaves the parent's record
    // looking fresh for HEARTBEAT_STALE_AFTER_MS, masking the death from
    // canon doctor and tempting canon stop to signal a possibly-recycled
    // PID. Instead, the canon-pid present + no heartbeat case is resolved
    // by isCanonProcess() — a process-cmdline check that verifies the PID
    // actually belongs to canon. See src/cli/commands/stop.ts.

    stdoutWrite(
        `\nDetached canon run.\n` +
        `  PID:   ${child.pid}\n` +
        `  Tasks: ${options.taskIds.join(', ')}\n` +
        `  Log:   ${logPath}\n` +
        `  Stop:  canon stop ${options.taskIds[0]}\n` +
        `  Watch: tail -f ${logPath}\n\n`,
    );

    // Detach the child from the parent's event loop so the parent can exit
    // without waiting. The OS-level process is independent (own session,
    // own pgroup).
    child.unref();

    return exit(0);
}

/**
 * Read .canon-pid for a task. Returns null when the file is missing,
 * unreadable, or malformed. Used by `canon stop` and operator tooling that
 * needs to find the live orchestrator's PID.
 */
export function readCanonPid(taskDir: string): number | null {
    const file = path.join(taskDir, PID_FILENAME);
    try {
        const raw = fs.readFileSync(file, 'utf8').trim();
        const pid = Number.parseInt(raw, 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

/**
 * Best-effort removal of .canon-pid. Called on clean orchestrator shutdown
 * (via the signals.ts shutdown-hook registry) and by `canon stop` after
 * confirming the process is no longer alive.
 */
export function removeCanonPid(taskDir: string): void {
    try {
        fs.unlinkSync(path.join(taskDir, PID_FILENAME));
    } catch {
        // Already gone — fine.
    }
}

/** Resolve the run log path for a task. Useful for `canon stop` to point
 * the operator at the right file when reporting stale state. */
export function runLogPathFor(taskDir: string): string {
    return path.join(taskDir, LOG_FILENAME);
}

// Note: an earlier iteration of this module exported `cmdlineLooksLikeCanon`
// and `isCanonProcess` for `canon stop` to verify a PID actually belonged to
// canon via `ps -p <pid> -o command=`. Codex flagged that substring-regex
// approach with two P1s on PR #113: (1) the standard npm `.bin/canon` shim
// produces a cmdline without "canon-ai" or "run-task", so the check missed
// real canon orchestrators; (2) the loose substring match could false-positive
// on any unrelated process whose argv happened to mention either token.
// The replacement is wait-for-heartbeat polling in src/cli/commands/stop.ts —
// the heartbeat file is written by canon code so its existence is a definitive
// proof of life that no cmdline heuristic can match.
