import { doctorCmd } from './commands/doctor.js';
import { initCmd } from './commands/init.js';
import { runCmd } from './commands/run-task.js';
import { taskCmd } from './commands/task.js';
import { updateCmd } from './commands/update.js';
import { upgradeCmd } from './commands/upgrade.js';

const [,, command, ...args] = process.argv;

function printHelp(): void {
    console.log(`
canon-ai — spec-first multi-agent coding pipeline

Usage:
  canon init                  Set up canon in the current repo
  canon doctor                Verify environment and canon setup
  canon task <sub> [args]     Create tasks and track pipeline phases
  canon run <id> [opts]       Run the pipeline for a task
  canon update                Update the canon-ai package itself
  canon upgrade               Sync vendored files to match the installed version

Typical workflow:
  canon task new <id> "Title"   Create the task dir, then write spec.md
                                  conversationally with Claude Code
  canon run <id>                Run the pipeline (after spec is approved)
  canon run <id> --pr           Open a draft PR when the task reaches human_review

Pipeline phases (in order):
  spec → spec_review → plan → implement → runtime_validation → code_review → qa → human_review

canon task subcommands:
  new <id> "Title" [--base <branch>]
                          Scaffold tasks/<id>/ from .canon/templates/. Auto-detects
                          base branch from current checkout; --base to override.
  list                    Show all tasks and their current phase
  status <id>             Show full status.json detail for a task
  phase <id> <phase> <status> [verdict]
                          Update a phase and re-derive the top-level status pointer.
                            phases:   spec | spec_review | plan | implement |
                                      runtime_validation | code_review | qa | human_review
                            status:   pending | in_progress | done | changes_requested | blocked
                            verdict:  approved | approved_with_nits | changes_requested | needs_re_review
                                      (verdict applies to spec_review and code_review only)
  reset-spec-review <id>  Clear state for a fresh spec-review pass after an auto-block.
                          Zeroes iterations, clears verdict, archives prior spec-review.md.
  post-merge-sync [<branch>]
                          After a squash-merge PR lands, reconcile local branch with origin.
                          Hard-resets if the only divergence is pipeline telemetry; refuses
                          if real unmerged work is present.
  release-init <version>  Create release/v<MAJ.MIN> off main with version bumped and an
                          empty in-progress CHANGELOG block.

canon run options:
  --step, -1              Run one phase then stop
  --expect <phase>        Fail fast if current phase doesn't match
                            phases: spec | spec_review | plan | implement |
                                    runtime_validation | code_review | qa | human_review
  --interactive, -I       Open interactive agent sessions (default: non-interactive)
  --pr                    At human_review: push branch and open a draft PR (requires gh)
  --push                  At human_review: push branch only (requires gh)
  --ship                  Post-merge cleanup: archive task dir (run after PR merges, not before)
  --dry-run               Print planned phases without running any agents
  --reroute               Reset a task from human_review back to implement

Global:
  --version           Print canon-ai version
  --help              Show this help
`);
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
    case 'task':
        taskCmd(args);
        break;
    case 'update':
        updateCmd(args);
        break;
    case 'upgrade':
        upgradeCmd(args);
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
