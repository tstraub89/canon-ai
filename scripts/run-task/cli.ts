import type { CliArgs } from './types.js';

export function die(message: string): never {
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
    console.log('Usage: npx tsx scripts/run-task.ts <TASK-ID...> [options]');
    console.log('');
    console.log('  Single task:  npx tsx scripts/run-task.ts fix-hover-state');
    console.log('  Bundle:       npx tsx scripts/run-task.ts fix-hover-state dark-tokens empty-cta');
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
    console.log('  --push              Push branch at human_review');
    console.log('  --pr                Push + create draft PR at human_review');
    console.log('  --reroute           Reset from human_review back to implement AND re-invoke the pipeline');
    console.log('  --ship              Merge open PR, pull, archive task, commit+push, clean branches');
    console.log('  --dry-run           Print each planned phase and exit without spawning any LLM');
}

export function parseArgs(argv: string[]): CliArgs {
    if (argv.length === 0) {
        printUsage();
        process.exit(1);
    }
    if (argv[0] === '--help') {
        printUsage();
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

    if (taskIds.length === 0) die('At least one TASK-ID is required.');
    return { taskIds, interactive, step, expectPhase, push, pr, reroute, ship, dryRun };
}

export function validateTaskId(id: string): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
        die(`Invalid task ID '${id}'. Must be lowercase alphanumeric, hyphens, dots, or underscores.`);
    }
    if (id.includes('..')) {
        die(`Invalid task ID '${id}'. Must not contain '..'.`);
    }
}
