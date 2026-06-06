import { doctorCmd } from './commands/doctor.js';
import { initCmd } from './commands/init.js';
import { runCmd } from './commands/run-task.js';
import { watchCmd } from './commands/watch.js';
import { stopCmd } from './commands/stop.js';
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
  canon stop <id>             Stop a detached canon run (SIGTERM → SIGKILL after 10s).
                                During the launch window before the child writes its first
                                heartbeat, waits up to CANON_STOP_WAIT_MS for proof of life
                                (default 30000) before deciding whether to signal.
  canon watch <id>            Blocking observer for an already-detached canon run.
                                Waits for idle / checkpoint / death / timeout and prints
                                one final summary line to stdout. Progress and any log
                                tailing go to stderr.
                                Flags: --until <phase>, --timeout <dur>, --follow, -f
                                Exit codes: 0 healthy stop/until, 2 usage/nothing/read
                                error/ambiguous_pid/launch-window timeout, 3 auto-block, 4 death,
                                5 timeout.
  canon update                Update the canon-ai package itself
  canon upgrade               Sync vendored files to match the installed version

Typical workflow:
  canon task new <id> "Title"   Create the task dir, then write spec.md
                                  conversationally with Claude Code
  canon run <id>                Run the pipeline (after spec is approved)
  canon run <id> --pr           Open a draft PR when the task reaches human_review

Pipeline phases (in order):
  spec → spec_review → plan → implement → code_review → qa → human_review

canon task subcommands:
  new <id> "Title" [--base <branch>]
                          Scaffold tasks/<id>/ from .canon/templates/. Auto-detects
                          base branch from current checkout; --base to override.
  list                    Show all tasks and their current phase
  status <id>             Show full status.json detail for a task
  phase <id> <phase> <status> [verdict]
                          Update a phase and re-derive the top-level status pointer.
                            phases:   spec | spec_review | plan | implement |
                                      code_review | qa | human_review
                            status:   pending | in_progress | done | changes_requested | blocked
                            verdict:  approved | approved_with_nits | changes_requested | needs_re_review | spec_gap
                                      (verdict applies to spec_review and code_review only)
  reset-spec-review <id>  Clear state for a fresh spec-review pass after an auto-block.
                          Zeroes iterations, clears verdict, archives prior spec-review.md.
  post-merge-sync [<branch>]
                          After a squash-merge PR lands, reconcile local branch with origin.
                          Hard-resets if the only divergence is pipeline telemetry; refuses
                          if real unmerged work is present.

canon run options:
  --step, -1              Run one phase then stop
  --expect <phase>        Fail fast if current phase doesn't match
                            phases: spec | spec_review | plan | implement |
                                    code_review | qa | human_review
  --interactive, -I       Open interactive agent sessions (default: non-interactive)
  --pr                    At human_review: push branch and open a draft PR (requires gh).
                          Auto-commit allow-list: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, and
                          managed docs listed in spec.md's "### Affected Files" table. Dirty
                          files outside that set die with a remediation message.
                          Aborts if HEAD's tree differs from origin/<base> on files not in
                          spec's Affected Files (bypass with --force).
  --push                  At human_review: push branch only, no PR (requires gh). Same allow-list
                          as --pr. Aborts if HEAD's tree differs from origin/<base> on files not
                          in spec's Affected Files (bypass with --force).
  --full-send             Skip the spec gate and auto-open a draft PR after clean QA
  --force                 Acknowledge high-commitment combinations (currently: --full-send on a delicate task)
  --ship                  Merge the open PR (calls gh pr merge --squash --delete-branch), tear
                          down the worktree, archive the task dir, and pull the base branch. Run
                          after the PR is approved — do NOT merge the PR manually first. If you
                          already merged externally, --ship detects the merged state and resumes
                          at cleanup.
  --dry-run               Print planned phases without running any agents
  --reroute               Reset a task from human_review back into the post-review fix path after
                          human feedback. Full-tier tasks (M/L/XL or delicate) re-enter at
                          spec_review; fast-tier tasks (S) re-enter at implement.
                          Feedback channel: append a new section to tasks/<id>/spec.md describing
                          what to address. Codex re-reads spec.md only — additions to review.md
                          or PR comments are NOT consulted on reroute. See CLAUDE.md "Reroute
                          feedback channel."

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
