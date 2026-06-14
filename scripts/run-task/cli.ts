import fs from 'node:fs';

import type { CliArgs } from './types.js';

let exitReason: string | null = null;
let exitHandlersRegistered = false;
let markerWritten = false;
const originalProcessExit = process.exit.bind(process);

function describeExitReason(reason: unknown): string {
    if (reason instanceof Error) {
        return reason.message || reason.name;
    }
    return String(reason);
}

function writeExitMarker(code: number | string): void {
    // One marker per process exit. The signal shutdown path writes its marker
    // before the re-raise (Node's default signal action skips 'exit' handlers,
    // but if the signal is somehow caught after all, this prevents a double).
    if (markerWritten) return;
    markerWritten = true;
    const timestamp = new Date().toISOString();
    // Multi-line die() messages (auto-commit aborts, phase-mismatch banners)
    // must not split the marker across physical log lines — the marker's
    // contract is one grep-able line per exit.
    const reason = (exitReason ?? 'unspecified').replace(/\s*\r?\n\s*/g, ' · ').trim();
    const line = `■ orchestrator exit code=${code} [reason=${reason}] at ${timestamp}\n`;
    try {
        fs.writeSync(2, line);
    } catch {
        try {
            process.stderr.write(line);
        } catch {
            /* last-resort marker write failed */
        }
    }
}

export function setExitReason(reason: string): void {
    exitReason = reason;
}

// Signal-driven shutdown (canon stop, Ctrl-C, kill) re-raises the signal with
// Node's default action after cleanup, which terminates the process WITHOUT
// running 'exit' handlers — so the marker must be written from the shutdown
// hook before the re-raise. Registered via registerShutdownHook in main()
// (signals.ts stays leaf-pure; cli.ts stays dependency-free).
export function writeSignalExitMarker(sig: NodeJS.Signals | undefined): void {
    const name = sig ?? 'unknown signal';
    setExitReason(`terminated by ${name} (graceful shutdown — canon stop / Ctrl-C / kill)`);
    writeExitMarker(`signal:${name}`);
}

export function registerExitHandlers(): void {
    if (exitHandlersRegistered) return;
    exitHandlersRegistered = true;

    exitReason = null;

    const patchedProcessExit: typeof process.exit = (code?: number | string): never => {
        if (exitReason === null) {
            exitReason = `process.exit code=${String(code ?? 0)}`;
        }
        return originalProcessExit(code);
    };
    process.exit = patchedProcessExit;

    process.on('exit', code => {
        writeExitMarker(code);
        exitReason = null;
    });

    process.on('uncaughtException', err => {
        setExitReason(`uncaught exception: ${describeExitReason(err)}`);
        const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
        try {
            fs.writeSync(2, `${message}\n`);
        } catch {
            process.stderr.write(`${message}\n`);
        }
        process.exit(1);
    });

    process.on('unhandledRejection', reason => {
        setExitReason(`unhandled rejection: ${describeExitReason(reason)}`);
        const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
        try {
            fs.writeSync(2, `${message}\n`);
        } catch {
            process.stderr.write(`${message}\n`);
        }
        process.exit(1);
    });
}

export function die(message: string): never {
    setExitReason(message);
    console.error(`❌ ${message}`);
    process.exit(1);
}

export function info(message: string): void {
    console.log(`→ ${message}`);
}

export function warn(message: string): void {
    console.error(`⚠️  ${message}`);
}

export function printUsage(): void {
    console.log('Usage: canon run <TASK-ID...> [options]');
    console.log('');
    console.log('  Single task:  canon run fix-hover-state');
    console.log('  Bundle:       canon run fix-hover-state dark-tokens empty-cta');
    console.log('');
    console.log('  Bundle mode runs all tasks together per phase (one agent session each).');
    console.log('  Fast tier (S, non-delicate only) skips Codex spec review. Full tier (any M/L/XL');
    console.log('  or delicate task) runs the complete pipeline — any such task pulls the entire');
    console.log('  bundle to full tier.');
    console.log('');
    console.log('Options:');
    console.log('  --interactive, -I   Open interactive agent sessions');
    console.log('  --step, -1          Run one phase then stop');
    console.log('  --expect <phase>    Assert current phase before running');
    console.log('  --pr                At human_review: push branch and open a draft PR (requires gh).');
    console.log('                      Auto-commit allow-list: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, and');
    console.log('                      managed docs listed in spec.md\'s "### Affected Files" table. Dirty');
    console.log('                      files outside that set die with a remediation message.');
    console.log('                      Aborts if HEAD\'s tree differs from origin/<base> on files not in');
    console.log('                      spec\'s Affected Files (bypass with --force).');
    console.log('  --push              At human_review: push branch only, no PR (requires gh). Same');
    console.log('                      allow-list as --pr. Aborts if HEAD\'s tree differs from origin/<base>');
    console.log('                      on files not in spec\'s Affected Files (bypass with --force).');
    console.log('  --full-send         Skip the spec gate and auto-open a draft PR after clean QA');
    console.log('  --force             Acknowledge high-commitment combinations and bypass');
    console.log('                      explicit safety gates where documented (currently:');
    console.log('                      --full-send on delicate tasks, reroute amendment gate,');
    console.log('                      base-drift gate, and dirty REPO_ROOT worktree-start gate).');
    console.log('  --allow-divergent-base');
    console.log('                      At --push, --pr, and --ship: bypass only the commit-divergence');
    console.log('                      block when local <base> has commits not yet on origin/<base>.');
    console.log('                      Does NOT bypass the file-allow-list gate; use --force for that.');
    console.log('                      Independent of --force — both may be needed to pass both gates.');
    console.log('  --ship              Merge the open PR (calls gh pr merge --squash --delete-branch), tear');
    console.log('                      down the worktree, archive the task dir, and pull the base branch. Run');
    console.log('                      after the PR is approved — do NOT merge the PR manually first. If you');
    console.log('                      already merged externally, --ship detects the merged state and resumes');
    console.log('                      at cleanup.');
    console.log('  --dry-run           Print each planned phase and exit without spawning any LLM');
    console.log('  --reroute           Reset a task from human_review back into the post-review fix path after');
    console.log('                      human feedback. Full-tier tasks (M/L/XL or delicate) re-enter at');
    console.log('                      spec_review; fast-tier tasks (S) re-enter at implement.');
    console.log('                      Feedback channel: append a new section to tasks/<id>/spec.md describing');
    console.log('                      what to address. Codex re-reads spec.md only — additions to review.md');
    console.log('                      or PR comments are NOT consulted on reroute.');
    console.log('                      Pre-flight requires `## Amendment` on round 1 or `## Amendment Round N`');
    console.log('                      on round 2+. Bypass with --force. See CLAUDE.md "Reroute feedback');
    console.log('                      channel."');
}

export function parseArgs(argv: string[]): CliArgs {
    if (argv.length === 0) {
        printUsage();
        setExitReason('usage requested: no TASK-ID provided');
        process.exit(1);
    }
    if (argv[0] === '--help') {
        printUsage();
        setExitReason('help requested');
        process.exit(0);
    }

    const taskIds: string[] = [];
    let interactive = false;
    let step = false;
    let expectPhase: string | null = null;
    let push = false;
    let pr = false;
    let reroute = false;
    let ship = false;
    let dryRun = false;
    let fullSend = false;
    let force = false;
    let allowDivergentBase = false;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--interactive':
            case '-I':
                interactive = true;
                break;
            case '--step':
            case '-1':
                step = true;
                break;
            case '--expect':
                index += 1;
                if (index >= argv.length) die('--expect requires a phase argument');
                expectPhase = argv[index];
                break;
            case '--push':
                push = true;
                break;
            case '--pr':
                pr = true;
                break;
            case '--reroute':
                reroute = true;
                break;
            case '--full-send':
                fullSend = true;
                break;
            case '--force':
                force = true;
                break;
            case '--allow-divergent-base':
                allowDivergentBase = true;
                break;
            case '--ship':
                ship = true;
                break;
            case '--dry-run':
                dryRun = true;
                break;
            default:
                if (arg.startsWith('--')) die(`Unknown option: ${arg}`);
                taskIds.push(arg);
        }
    }

    if (reroute && fullSend) {
        die('--reroute and --full-send are mutually exclusive in a single invocation. Run --reroute first, then --full-send if you want to re-trust the result.');
    }

    if (taskIds.length === 0) die('At least one TASK-ID is required.');
    return { taskIds, interactive, step, expectPhase, push, pr, reroute, ship, dryRun, fullSend, force, allowDivergentBase };
}

export function validateTaskId(id: string): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
        die(`Invalid task ID '${id}'. Must be lowercase alphanumeric, hyphens, dots, or underscores.`);
    }
    if (id.includes('..')) {
        die(`Invalid task ID '${id}'. Must not contain '..'.`);
    }
}

export function isSynchronousMode(args: Partial<CliArgs>): boolean {
    return !!(args.pr || args.push || args.ship || args.step || args.expectPhase != null);
}
