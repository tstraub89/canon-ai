import { doctorCmd } from './commands/doctor.js';
import { initCmd } from './commands/init.js';
import { runCmd } from './commands/run-task.js';
import { watchCmd } from './commands/watch.js';
import { stopCmd } from './commands/stop.js';
import { taskCmd } from './commands/task.js';
import { updateCmd } from './commands/update.js';
import { upgradeCmd } from './commands/upgrade.js';
import { completionCmd } from './commands/completion.js';
import { COMMAND_REGISTRY, GLOBAL_FLAGS } from './registry.js';

const [,, command, ...args] = process.argv;

function printHelp(): void {
    console.log(`canon-ai — spec-first multi-agent coding pipeline

Usage: canon <command> [args]

Commands:
  init                Set up canon in the current repo
  doctor              Verify environment and canon setup
  task <subcommand>   Create tasks and track pipeline phases
  run <id...>         Run the pipeline for one or more tasks
  watch <id>          Wait on a detached run; print one summary line
  stop <id>           Stop a detached canon run
  update              Update the canon-ai package itself
  upgrade             Sync vendored files to match the installed version
  completion <shell>  Print a shell completion script

Typical workflow:
  canon task new <id> "Title"   Create the task dir, then write spec.md with Claude Code
  canon run <id>                Run the pipeline (after the spec is approved)
  canon watch <id>              Wait for a detached run to settle
  canon run <id> --pr           Open a draft PR when the task reaches human_review

Global:
  --version, -v       Print canon-ai version
  --help, -h          Show this help

Run 'canon <command> --help' for details.`);
}

function printVersion(): void {
    // Resolved at build time via tsup define
    console.log(process.env.CANON_VERSION ?? 'dev');
}

switch (command) {
    case 'doctor':
        doctorCmd(args);
        break;
    case 'init':
        initCmd(args);
        break;
    case 'run':
        runCmd(args);
        break;
    case 'stop':
        stopCmd(args);
        break;
    case 'task':
        taskCmd(args);
        break;
    case 'watch':
        watchCmd(args);
        break;
    case 'update':
        updateCmd(args);
        break;
    case 'upgrade':
        upgradeCmd(args);
        break;
    case 'completion':
        completionCmd(args, COMMAND_REGISTRY, GLOBAL_FLAGS);
        break;
    case '--version':
    case '-v':
        printVersion();
        break;
    case '--help':
    case '-h':
    case undefined:
        printHelp();
        break;
    default:
        console.error(`Unknown command: ${command}\n`);
        printHelp();
        process.exit(1);
}
