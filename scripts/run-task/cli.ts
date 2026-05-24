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
    console.log('  --force             Acknowledge high-commitment combinations (currently: --full-send on a delicate task)');
    console.log('  --ship              Merge the open PR (calls gh pr merge --squash --delete-branch), tear');
    console.log('                      down the worktree, archive the task dir, and pull the base branch. Run');
    console.log('                      after the PR is approved — do NOT merge the PR manually first. If you');
    console.log('                      already merged externally, --ship detects the merged state and resumes');
    console.log('                      at cleanup.');
    console.log('  --dry-run           Print each planned phase and exit without spawning any LLM');
    console.log('  --reroute           Reset a task from human_review back to implement after human feedback.');
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
    let fullSend = false;
    let force = false;

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
    return { taskIds, interactive, step, expectPhase, push, pr, reroute, ship, dryRun, fullSend, force };
}

export function validateTaskId(id: string): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
        die(`Invalid task ID '${id}'. Must be lowercase alphanumeric, hyphens, dots, or underscores.`);
    }
    if (id.includes('..')) {
        die(`Invalid task ID '${id}'. Must not contain '..'.`);
    }
}
