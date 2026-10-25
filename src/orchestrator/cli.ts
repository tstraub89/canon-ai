import fs from 'node:fs';

import type { CliArgs } from './types.js';
import { handlePreScan, type ArgDeclaration } from '../lib/cli-args.js';

export const RUN_USAGE = [
    'Usage: canon run <TASK-ID...> [options]',
    '',
    '  Single task:  canon run fix-hover-state',
    '  Bundle:       canon run fix-hover-state dark-tokens empty-cta',
    '',
    '  Bundle mode runs all tasks together per phase (one agent session each).',
    '  Fast tier (XS, non-delicate only) skips Codex spec review. Full tier (any S/M/L/XL',
    '  or delicate task) runs the complete pipeline — any such task pulls the entire',
    '  bundle to full tier.',
    '',
    'Options:',
    '  --interactive, -I   Open interactive agent sessions',
    '  --step, -1          Run one phase then stop',
    '  --expect <phase>    Assert current phase before running',
    '  --pr                At human_review: push branch and open a draft PR (requires gh).',
    "                      First pushes canon's own unpushed scaffold/telemetry commits on <base> to origin",
    '                      (creating origin/<base> if missing); any other unpushed <base> commit blocks.',
    '                      Auto-commit allow-list: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, and',
    '                      protected/configured docs listed in spec.md\'s "### Affected Files"',
    '                      table (all admitted docs once QA is done). Dirty files outside',
    '                      that set die with a remediation message.',
    '                      Aborts if merging origin/<base> conflicts, or branch changes files',
    '                      outside spec\'s Affected Files (bypass with --force).',
    '  --push              At human_review: push branch only, no PR (requires gh). Same',
    '                      allow-list and scaffold base push as --pr. Aborts if merging origin/<base> conflicts, or',
    '                      branch changes files outside spec\'s Affected Files (bypass with --force).',
    '  --full-send         Skip the spec gate and auto-open a draft PR after clean QA;',
    '                      pushes canon scaffold commits to base like --pr.',
    '  --force             Acknowledge high-commitment combinations and bypass',
    '                      explicit safety gates where documented (currently:',
    '                      --full-send on delicate tasks, reroute amendment gate,',
    '                      base-drift gate, and dirty REPO_ROOT worktree-start gate).',
    '  --allow-divergent-base',
    '                      At --push, --pr, and --ship: bypass only the commit-divergence',
    '                      block when local <base> has commits not yet on origin/<base>.',
    "                      If canon's scaffold base push is rejected, warns and continues.",
    '                      At --pr/--push, does not apply when origin has no <base> branch.',
    '                      Does NOT bypass the base-drift gate; use --force for that.',
    '                      Independent of --force — both may be needed to pass both gates.',
    '  --ship              Merge the open PR (gh pr merge --squash), delete its remote branch, tear',
    '                      down the worktree, archive the task dir, and pull the base branch. Run',
    '                      after the PR is approved — do NOT merge the PR manually first. If you',
    '                      already merged externally, --ship detects the merged state and resumes',
    '                      at cleanup.',
    '  --dry-run           Print each planned phase and exit without spawning any LLM',
    '  --reroute           Reset a task once implementation has begun: current phase code_review,',
    '                      qa, or human_review, or implement when it is in progress or blocked,',
    '                      its code review is blocked, or a code review already ran in the current loop',
    '                      (a review round or a pre-flight rejection).',
    '                      Bundles also admit an approved implement-pending sibling with no current-loop',
    '                      activity alongside a qualifying task on the same non-empty task branch.',
    '                      Full-tier tasks (S/M/L/XL or delicate) re-enter at spec_review; fast-tier',
    '                      tasks (XS) re-enter at implement.',
    '                      Feedback channel: append a new section to tasks/<id>/spec.md describing',
    '                      what to address. Codex re-reads spec.md only — additions to review.md',
    '                      or PR comments are NOT consulted on reroute.',
    '                      Pre-flight requires `## Amendment` on round 1 or `## Amendment Round N`',
    '                      on round 2+. Bypass with --force. See docs/pipeline-orchestrator.md',
    '                      §"Human Reroute."',
].join('\n');
export const RUN_ARGS: ArgDeclaration = {
    command: 'run', usage: RUN_USAGE,
    booleanFlags: ['--interactive', '-I', '--step', '-1', '--pr', '--push', '--full-send', '--force', '--allow-divergent-base', '--ship', '--dry-run', '--reroute'],
    valueFlags: ['--expect'],
    completion: { positionals: [{ kind: 'taskId', variadic: true }], valueFlags: { '--expect': 'phase' } },
};

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
    console.log(RUN_USAGE);
}

export function parseArgs(argv: string[]): CliArgs {
    handlePreScan(RUN_ARGS, argv, { out: printUsage, err: console.error, exit: code => process.exit(code) });
    if (argv.length === 0) {
        printUsage();
        setExitReason('usage requested: no TASK-ID provided');
        process.exit(1);
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
                if (arg.startsWith('-')) die(`Unknown option: ${arg}\nRun 'canon run --help' for usage.`);
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
