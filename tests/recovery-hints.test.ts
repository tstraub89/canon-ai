import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

type HintSite =
  | { file: string; snippet: string; kind: 'actionable'; covers: ReadonlyArray<{ state: string; test: string }> }
  | { file: string; snippet: string; kind: 'exempt'; reason: string };
const HINT_PATTERN = /--reroute|reset-code-review|reset-spec-review|canon task accept/;
const HINT_SITES: readonly HintSite[] = [

  {
    file: 'src/orchestrator/cli.ts',
    snippet: "    booleanFlags: ['--interactive', '-I', '--step', '-1', '--pr', '--push', '--full-send', '--force', '--allow-divergent-base', '--ship', '--dry-run', '--reroute'],",
    kind: 'exempt',
    reason: 'Not an actionable recovery hint: usage, help, or argv handling',
  },


  {
    file: 'src/task/index.ts',
    snippet: "    phase: { command: 'task phase', usage: `Usage: canon task phase <TASK-ID> <phase> <status> [verdict]\\n\\nPhases: ${PHASE_ORDER.join(' | ')}\\nPipeline phases (in order): ${PHASE_ORDER.join(' → ')}\\nStatuses: ${[...VALID_STATUSES].join(' | ')}\\nVerdicts: ${[...VALID_VERDICTS].join(' | ')}\\n(verdict applies to spec_review and code_review only; sanctioned is written via canon task accept --reason)`, ...noTaskFlags },",
    kind: 'exempt',
    reason: 'Not an actionable recovery hint: usage, help, or argv handling',
  },
  {
    file: 'src/task/index.ts',
    snippet: "    accept: { command: 'task accept', usage: 'Usage: canon task accept <TASK-ID...> <phase> [--reason \"<text>\"] [--force]\\n\\nAccept implement, or sanction spec_review/code_review with an audit reason. --reason is required for spec_review and code_review. --force bypasses the missing-verdict and dirty-tree guards.', booleanFlags: ['--force'], valueFlags: ['--reason'] },",
    kind: 'exempt',
    reason: 'Not an actionable recovery hint: usage, help, or argv handling',
  },
  {
    file: 'src/task/index.ts',
    snippet: "    'reset-spec-review': { command: 'task reset-spec-review', usage: 'Usage: canon task reset-spec-review <TASK-ID>\\n\\nClear state for a fresh spec-review pass after an auto-block. Zeroes iterations, clears verdict, archives prior spec-review.md.', ...noTaskFlags },",
    kind: 'exempt',
    reason: 'Not an actionable recovery hint: usage, help, or argv handling',
  },
  {
    file: 'src/task/index.ts',
    snippet: "    'reset-code-review': { command: 'task reset-code-review', usage: 'Usage: canon task reset-code-review <TASK-ID>\\n\\nClear state for a fresh code-review pass after an auto-block. Zeroes loop counters, clears verdict, archives prior review.md.', ...noTaskFlags },",
    kind: 'exempt',
    reason: 'Not an actionable recovery hint: usage, help, or argv handling',
  },
  {
    file: 'src/task/index.ts',
    snippet: "    throw new Error('Error: usage: canon task accept <TASK-ID...> <phase> [--reason \"<text>\"] [--force]');",
    kind: 'exempt',
    reason: 'Not an actionable recovery hint: usage, help, or argv handling',
  },
  {
    "file": "src/orchestrator/cli.ts",
    "snippet": "    '  --reroute           Reset a task from any phase reached after a completed implement round',",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/orchestrator/cli.ts",
    "snippet": "case '--reroute':",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/orchestrator/cli.ts",
    "snippet": "die('--reroute and --full-send are mutually exclusive in a single invocation. Run --reroute first, then --full-send if you want to re-trust the result.');",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: refusal or abort explains a rejected invocation"
  },
  {
    "file": "src/orchestrator/detach.ts",
    "snippet": "// detach gate. If the child re-executes with --reroute still present, it",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/orchestrator/detach.ts",
    "snippet": "// just in this detached child. Stripping --reroute here is scoped precisely",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/orchestrator/detach.ts",
    "snippet": "const args = options.argv.slice(1).filter(arg => arg !== '--reroute'); // [scriptPath, ...userArgs]",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "* operator already manually committed and ran `canon task accept`.",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "splitCli.info('Auto-commit skipped — implement phase was operator-accepted (canon task accept) and HEAD still matches the accepted SHA.');",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "`--reroute requires every named task's current phase to be code_review, qa, or human_review — ` +",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "`--reroute aborted: spec.md amendment required before reroute.\\n` +",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: refusal or abort explains a rejected invocation"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "`--reroute aborted: failed to archive tasks/${taskId}/review.md: ${message}\\n` +",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: refusal or abort explains a rejected invocation"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "// This same invocation drives the rerouted pipeline — bare --reroute auto-detaches",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "splitCli.info(`combine the flags in this one command: \\`canon run <id> --reroute --step --expect ${stepPhase}\\`.`);",
    "kind": "exempt",
    "reason": "Emitted while describing a reroute invocation already in progress; this is flag-combination advice, not a next-step recovery command."
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "const recovery = taskIds.map(id => `canon task reset-code-review ${id}`).join('; ');",
    "kind": "actionable",
    "covers": [
      {
        "state": "code_review blocked by reviewer",
        "test": "reviewer block covers a mixed bundle, and reset restores the review phase"
      }
    ]
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "for (const id of taskIds) console.log(`    canon task reset-code-review ${id}`);",
    "kind": "actionable",
    "covers": [
      {
        "state": "code_review blocked by reviewer",
        "test": "reviewer block covers a mixed bundle, and reset restores the review phase"
      }
    ]
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "console.log('  After revising, re-run the normal pipeline command (NOT --reroute):');",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "`  FIX: add ${amendHeadings.map(a => `${a.heading} to tasks/${a.id}/spec.md`).join('; ')}, then: canon run ${taskIds.join(' ')} --reroute\\n` +",
    "kind": "actionable",
    "covers": [
      {
        "state": "spec_gap halt reroute_count 0",
        "test": "spec_gap fix hint at reroute_count 0: the printed heading and reroute are accepted"
      },
      {
        "state": "spec_gap halt reroute_count 1",
        "test": "spec_gap fix hint at reroute_count 1: the printed heading and reroute are accepted"
      },
      {
        "state": "bundle with one spec_gap member",
        "test": "spec_gap fix hint in a bundle names a heading only for the spec_gap task and its reroute is accepted"
      }
    ]
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "`  BLESS: canon task accept ${taskIds.join(' ')} code_review --reason \"<why>\"`;",
    "kind": "actionable",
    "covers": [
      {
        "state": "spec_gap halt",
        "test": "spec_gap bless hint: the printed accept command sanctions code_review and advances to qa"
      }
    ]
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "console.log(`    canon run ${taskIds.join(' ')} --reroute`);",
    "kind": "actionable",
    "covers": [
      {
        "state": "spec_gap halt",
        "test": "spec_gap fix hint at reroute_count 0: the printed heading and reroute are accepted"
      },
      {
        "state": "spec_gap halt reroute_count 1",
        "test": "spec_gap fix hint at reroute_count 1: the printed heading and reroute are accepted"
      },
      {
        "state": "bundle with one spec_gap member",
        "test": "spec_gap fix hint in a bundle names a heading only for the spec_gap task and its reroute is accepted"
      }
    ]
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "console.log(`    canon task accept ${taskIds.join(' ')} code_review --reason \"<why this gap is acceptable>\"`);",
    "kind": "actionable",
    "covers": [
      {
        "state": "spec_gap halt",
        "test": "spec_gap bless hint: the printed accept command sanctions code_review and advances to qa"
      }
    ]
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "// --reroute alone DETACHES: rerouteFromHumanReview() (above) runs in the",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "// a bare `--reroute` to follow progress.",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "// --reroute --step stays foreground because --step is in the synchronous",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "//   Full tier: canon run <id> --reroute --step --expect spec_review",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/orchestrator/main.ts",
    "snippet": "//   Fast tier: canon run <id> --reroute --step --expect implement",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/orchestrator/phases/code-review.ts",
    "snippet": "`handoff.md Validation Outcomes rows, run \\`canon task reset-code-review <id>\\` for each ` +",
    "kind": "actionable",
    "covers": [
      {
        "state": "code_review pre-flight where every issue is blocked",
        "test": "code_review pre-flight auto-block: the printed reset-code-review is accepted and the re-run passes pre-flight"
      }
    ]
  },
  {
    "file": "src/orchestrator/review-archive.ts",
    "snippet": "* reset-code-review keeps its historical unconditional archival behavior.",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/orchestrator/review-loop.ts",
    "snippet": "const resetCommands = taskIds.map(id => `canon task reset-spec-review ${id}`).join('; ');",
    "kind": "actionable",
    "covers": [
      {
        "state": "spec entry, revision not done",
        "test": "main blocks a capped spec loop before revision, re-blocks on resume, and its advertised reset works"
      },
      {
        "state": "spec_review entry, revision done",
        "test": "spec loop cap at spec_review entry: the printed reset-spec-review is accepted"
      }
    ]
  },
  {
    "file": "src/orchestrator/review-loop.ts",
    "snippet": "const resetCommands = taskIds.map(id => `canon task reset-code-review ${id}`).join('; ');",
    "kind": "actionable",
    "covers": [
      {
        "state": "implement entry",
        "test": "main blocks a capped code loop before implementation side effects, re-blocks, and its advertised reset works"
      },
      {
        "state": "code_review entry",
        "test": "code loop cap at code_review entry: the printed reset-code-review is accepted"
      }
    ]
  },
  {
    "file": "src/orchestrator/types.ts",
    "snippet": "* Set by `canon task accept <id> implement` when an operator has manually",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/orchestrator/types.ts",
    "snippet": "* HEAD SHA at the time of `canon task accept`. Pairs with `operator_accepted`",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "full_send: 'persisted in status.json until `canon run --reroute` clears it or arming the gate with `canon task set <id> human_spec_gate true` does. Use `canon run --full-send <id>` to enable it; the delicate-task guard requires `--force`.',",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "phases: 'nested orchestrator-owned state. Use `canon task phase`, `canon task reset-spec-review`, `canon task reset-code-review`, or `canon task accept` instead.',",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "sessions: 'nested orchestrator-owned state. Use `canon task phase`, `canon task reset-spec-review`, `canon task reset-code-review`, or `canon task accept` instead.',",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "escalations: 'nested orchestrator-owned state. Use `canon task phase`, `canon task reset-spec-review`, `canon task reset-code-review`, or `canon task accept` instead.',",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "    '  reset-spec-review <TASK-ID>                Reset an auto-blocked spec review',",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "    '  reset-code-review <TASK-ID>                Reset an auto-blocked code review',",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "`Use \\`canon task accept <id> ${phase} --reason \"<why>\"\\` instead so operator_accepted audit fields and notes.md are written.`",
    "kind": "actionable",
    "covers": [
      {
        "state": "code_review spec_gap halt",
        "test": "task phase sanctioned redirect: the printed accept command is accepted from a spec_gap halt"
      },
      {
        "state": "spec_review sanctioned redirect",
        "test": "task phase spec_review sanctioned redirect emits and accepts the spec_review command"
      }
    ]
  },
  {
    "file": "src/task/index.ts",
    "snippet": "if (ids.length === 0) throw new Error('Error: usage: canon task accept <TASK-ID...> <phase> [--reason \"<text>\"] [--force]');",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "`Error: 'canon task accept' supports implement, spec_review, and code_review phases. ` +",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "`[${today()}] Operator accepted ${phaseArg} via \\`canon task accept\\` — ` +",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "const noteLine = `[${today()}] Operator accepted implement phase via \\`canon task accept\\` — auto-commit will be skipped.${options.force ? ' (--force)' : ''}`;",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: descriptive state, audit, or pointer text"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "if (!id) throw new Error('Error: usage: canon task reset-spec-review <TASK-ID>');",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "if (!id) throw new Error('Error: usage: canon task reset-code-review <TASK-ID>');",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "throw new Error(`Error: reset-code-review only operates on tasks currently at code_review. Current phase: ${currentPhase}.`);",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: refusal or abort explains a rejected invocation"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "// `canon run --reroute` is accepted.",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "return `Note: spec_review is already done on task ${id}. The armed gate fires after the next spec_review, which a full-tier reroute runs: add an amendment to the spec, then run \\`canon run --reroute ${id}\\`.`;",
    "kind": "actionable",
    "covers": [
      {
        "state": "code_review",
        "test": "spec gate done note: the printed reroute is accepted and the armed gate fires from code_review, qa and human_review"
      },
      {
        "state": "qa",
        "test": "spec gate done note: the printed reroute is accepted and the armed gate fires from code_review, qa and human_review"
      },
      {
        "state": "human_review",
        "test": "spec gate done note: the printed reroute is accepted and the armed gate fires from code_review, qa and human_review"
      }
    ]
  },
  {
    "file": "src/task/index.ts",
    "snippet": "    throw new Error('Error: usage: canon task accept <TASK-ID...> <phase> [--reason \"<text>\"] [--force]');",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "case 'reset-spec-review':",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/task/index.ts",
    "snippet": "case 'reset-code-review':",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: usage, help, or argv handling"
  },
  {
    "file": "src/task/templates.ts",
    "snippet": "// scaffold) and the review re-scaffold that runs after `--reroute` and",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  },
  {
    "file": "src/task/templates.ts",
    "snippet": "// `canon task reset-code-review` archive a filled review.md. Keeping both",
    "kind": "exempt",
    "reason": "Not an actionable recovery hint: source comment stripped from runtime output"
  }
];

export function checkHintRegistry(
  sources: ReadonlyMap<string, string>,
  sites: readonly HintSite[],
  testSources: readonly string[],
): string[] {
  const failures: string[] = [];
  for (const [file, source] of sources) {
    source.split('\n').forEach((line, index) => {
      if (HINT_PATTERN.test(line) && !sites.some(site => site.file === file && line.includes(site.snippet))) {
        failures.push(
          `${file}:${index + 1}: unregistered recovery-command hint: ${line.trim()} — ` +
          'add a HINT_SITES entry in tests/recovery-hints.test.ts (actionable with covering tests, or exempt with a reason).',
        );
      }
    });
  }

  for (const site of sites) {
    const lines = (sources.get(site.file) ?? '').split('\n').filter(line => line.includes(site.snippet));
    if (lines.length === 0) {
      failures.push(
        `${site.file}: stale HINT_SITES snippet not found: ${site.snippet} — ` +
        'the hint was reworded or removed; update or delete the entry.',
      );
    } else if (lines.length > 1) {
      failures.push(
        `${site.file}: HINT_SITES snippet matches ${lines.length} lines: ${site.snippet} — ` +
        'lengthen it until it is unique in the file.',
      );
    } else if (!HINT_PATTERN.test(lines[0])) {
      failures.push(`${site.file}: stale HINT_SITES snippet no longer names a recovery command: ${site.snippet}`);
    }

    if (site.kind === 'exempt') {
      if (!site.reason.trim()) failures.push(`${site.file}: exempt HINT_SITES entry has blank reason: ${site.snippet}`);
      continue;
    }
    if (site.covers.length === 0) failures.push(`${site.file}: actionable HINT_SITES entry has no covering tests: ${site.snippet}`);
    for (const cover of site.covers) {
      const escaped = cover.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const declaration = new RegExp("\\btest\\(\\s*(['\"`])" + escaped + "\\1");
      if (!testSources.some(testSource => declaration.test(testSource))) {
        failures.push(
          `${site.file}: actionable hint ${site.snippet} names covering test "${cover.test}", ` +
          'which no tests/*.test.ts declares — write the chained fixture or fix the title.',
        );
      }
    }
  }
  return failures;
}

function loadSources(root = process.cwd()): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
      } else {
        sources.set(path.relative(root, filePath).split(path.sep).join('/'), fs.readFileSync(filePath, 'utf8'));
      }
    }
  };
  walk(path.join(root, 'src'));
  return sources;
}

function loadTests(root = process.cwd()): string[] {
  return fs.readdirSync(path.join(root, 'tests'))
    .filter(file => file.endsWith('.test.ts'))
    .map(file => fs.readFileSync(path.join(root, 'tests', file), 'utf8'));
}

const ROOT = process.cwd();
const MD_LOADER = path.join(ROOT, 'tests/md-loader-register.mjs');
const TSX_LOADER = path.join(ROOT, 'node_modules/tsx/dist/loader.mjs');
const MAIN_URL = pathToFileURL(path.join(ROOT, 'src/orchestrator/main.ts')).href;
function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-hints-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo(dir: string): string {
  const cwd = path.join(dir, 'repo');
  fs.mkdirSync(cwd);
  git(cwd, 'init', '-q', '--initial-branch=main');
  git(cwd, 'config', 'user.email', 'fixture@example.test');
  git(cwd, 'config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(cwd, 'seed.txt'), 'seed\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'base');
  return cwd;
}

function writeStatus(tasksRoot: string, id: string, status: Record<string, unknown>): void {
  const taskDir = path.join(tasksRoot, id);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
}

function statusFor(id: string, reroutes = 0, verdict = 'spec_gap'): Record<string, unknown> {
  return {
    id,
    title: id,
    status: 'code_review',
    branch: `task/${id}`,
    base_branch: 'main',
    task_size: 'M',
    delicate: false,
    human_spec_gate: false,
    full_send: false,
    worktree: false,
    phases: {
      spec: { status: 'done', agent: 'claude' },
      spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 1 },
      plan: { status: 'done', agent: 'claude' },
      implement: { status: 'done', agent: 'codex', reroute_count: reroutes },
      code_review: { status: 'done', agent: 'claude', verdict, iterations: 1, iterations_current_loop: 1 },
      qa: { status: 'pending', agent: 'claude' },
      human_review: { status: 'pending', agent: 'human' },
    },
    escalations: [],
    sessions: {},
  };
}

function fixtureTask(cwd: string, id: string, reroutes = 0, verdict = 'spec_gap'): string {
  const tasksRoot = path.join(cwd, 'tasks');
  writeStatus(tasksRoot, id, statusFor(id, reroutes, verdict));
  const taskDir = path.join(tasksRoot, id);
  fs.writeFileSync(path.join(taskDir, 'spec.md'), [
    '# Spec',
    '',
    '## Design',
    '',
    '### Affected Files',
    '',
    '| File | Change |',
    '|---|---|',
    '| `seed.txt` | fixture |',
    '',
    '## Validation Required',
    '',
    '- [x] `npm test`',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(taskDir, 'review.md'), '# Code Review\n\n## Final Verdict\n\n- [x] **Spec Gap**\n');
  fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
    '# Handoff',
    '',
    '## Changes',
    '',
    '| File | Change |',
    '|---|---|',
    '| `seed.txt` | fixture |',
    '',
    '## AC Coverage',
    '',
    '| AC | Status | Evidence |',
    '|---|---|---|',
    '| AC-1 | Met | fixture |',
    '',
    '## Validation Outcomes',
    '',
    '| Check | Result | Notes |',
    '|---|---|---|',
    '| `npm test` | Pass | fixture |',
    '',
  ].join('\n'));
  return tasksRoot;
}

function runInline(cwd: string, script: string, env: NodeJS.ProcessEnv = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, ['--import', MD_LOADER, '--import', TSX_LOADER, '-e', script], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CANON_NO_DETACH: '1',
      CANON_METRICS_FILE_OVERRIDE: path.join(cwd, 'metrics.md'),
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function setupCodex(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const codex = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const ids = (process.env.FAKE_AGENT_TASK_IDS || process.env.FAKE_AGENT_TASK_ID || '').split(',').filter(Boolean);
for (const id of ids) {
  const taskDir = path.join(process.cwd(), 'tasks', id);
  const statusPath = path.join(taskDir, 'status.json');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  status.phases.spec_review.status = 'done';
  status.phases.spec_review.verdict = 'approved';
  status.status = 'plan';
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\\n');
  fs.writeFileSync(path.join(taskDir, 'spec-review.md'), '# Spec Review\\n\\n## Verdict\\n\\n- [x] **Approved**\\n');
}
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fixture' }));
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
`;
  const claude = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const ids = (process.env.FAKE_AGENT_TASK_IDS || process.env.FAKE_AGENT_TASK_ID || '').split(',').filter(Boolean);
for (const id of ids) {
  const taskDir = path.join(process.cwd(), 'tasks', id);
  const statusPath = path.join(taskDir, 'status.json');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  status.phases.plan.status = 'done';
  status.status = 'implement';
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\\n');
  fs.writeFileSync(path.join(taskDir, 'plan.md'), '# Plan\\n\\nFixture plan.\\n');
}
console.log(JSON.stringify({ type: 'result', session_id: 'fixture', usage: {} }));
`;
  fs.writeFileSync(path.join(dir, 'codex'), codex, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'claude'), claude, { mode: 0o755 });
}

function emitSpecGap(cwd: string, tasksRoot: string, ids: string[]): { output: string; reason: string } {
  const result = runInline(cwd, `
    import { checkAndRoute } from ${JSON.stringify(MAIN_URL)};
    await checkAndRoute('code_review', ${JSON.stringify(ids)});
  `, { CANON_TASKS_DIR_OVERRIDE: tasksRoot });
  assert.equal(result.status, 2, result.stderr + result.stdout);
  const statuses = ids.map(id => JSON.parse(fs.readFileSync(path.join(tasksRoot, id, 'status.json'), 'utf8')) as {
    escalations: Array<{ reason: string }>;
  });
  return { output: result.stdout + result.stderr, reason: statuses[0].escalations.at(-1)?.reason ?? '' };
}

function runPrinted(
  command: string,
  cwd: string,
  tasksRoot: string,
  id: string,
  phase: string | null = 'spec_review',
  ids = [id],
): { status: number | null; stdout: string; stderr: string } {
  const filled = command.replaceAll('<id>', id).replace(/"<[^>]+>"/g, '"fixture reason"');
  const tokens = filled.match(/"[^"]*"|\S+/g)?.map(token => token.replace(/^"|"$/g, '')) ?? [];
  assert.equal(tokens[0], 'canon');
  if (tokens[1] === 'task') {
    const script = `
      import { taskCmd } from ${JSON.stringify(path.join(ROOT, 'src/task/index.ts'))};
      taskCmd(${JSON.stringify(tokens.slice(2))});
    `;
    return runInline(cwd, script, { CANON_TASKS_DIR_OVERRIDE: tasksRoot });
  }
  const args = [...tokens.slice(2), '--step', ...(phase ? ['--expect', phase] : [])];
  const bin = path.join(cwd, 'fake-bin');
  setupCodex(bin);
  const script = `
    import { main } from ${JSON.stringify(MAIN_URL)};
    process.argv = ['node', 'canon', ...${JSON.stringify(args)}];
    await main();
  `;
  return runInline(cwd, script, {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    CANON_TASKS_DIR_OVERRIDE: tasksRoot,
    FAKE_AGENT_TASK_ID: id,
    FAKE_AGENT_TASK_IDS: ids.join(','),
    FAKE_AGENT_LOG: path.join(cwd, 'agents.log'),
  });
}

function runLoopCap(cwd: string, tasksRoot: string, id: string, phase: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const bin = path.join(cwd, 'cap-fake-bin');
  setupCodex(bin);
  const script = `
    import { main } from ${JSON.stringify(MAIN_URL)};
    process.argv = ['node', 'canon', ${JSON.stringify(id)}, '--step', '--expect', ${JSON.stringify(phase)}];
    await main();
  `;
  return runInline(cwd, script, {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    CANON_TASKS_DIR_OVERRIDE: tasksRoot,
    MAX_REVIEW_LOOPS: '3',
    FAKE_AGENT_TASK_ID: id,
    FAKE_AGENT_LOG: path.join(cwd, 'agents.log'),
  });
}

function endStatus(tasksRoot: string, id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(tasksRoot, id, 'status.json'), 'utf8')) as Record<string, unknown>;
}

function derive(status: Record<string, unknown>): string {
  const phases = status.phases as Record<string, { status?: string }>;
  return ['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review']
    .find(phase => phases[phase]?.status !== 'done') ?? 'complete';
}

void test('recovery hint registry covers every recovery-command line in src', () => {
  assert.deepEqual(checkHintRegistry(loadSources(), HINT_SITES, loadTests()), []);
});

void test('recovery hint registry reports unregistered, stale and uncovered entries', () => {
  const unregistered = checkHintRegistry(new Map([['src/x.ts', "die('run canon run a --reroute');"]]), [], []);
  assert.match(unregistered.join('\n'), /unregistered recovery-command hint/);
  const stale = checkHintRegistry(new Map([['src/x.ts', '']]), [
    { file: 'src/x.ts', snippet: 'missing --reroute', kind: 'exempt', reason: 'old' },
  ], []);
  assert.match(stale.join('\n'), /stale HINT_SITES snippet/);
  const uncovered = checkHintRegistry(new Map([['src/x.ts', 'run --reroute']]), [
    { file: 'src/x.ts', snippet: 'run --reroute', kind: 'actionable', covers: [{ state: 'x', test: 'no such recovery test' }] },
  ], []);
  assert.match(uncovered.join('\n'), /names covering test/);
});

void test('spec_gap fix hint at reroute_count 0: the printed heading and reroute are accepted', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/gap');
  const tasks = fixtureTask(cwd, 'gap', 0);
  const emitted = emitSpecGap(cwd, tasks, ['gap']);
  const reasonHeading = emitted.reason.match(/FIX: add (## Amendment(?: Round \d+)?) to tasks\/gap\/spec\.md/)?.[1];
  const outputHeading = emitted.output.match(/add a (## Amendment(?: Round \d+)?) section/)?.[1];
  assert.equal(reasonHeading, '## Amendment');
  assert.equal(outputHeading, reasonHeading);
  fs.appendFileSync(path.join(tasks, 'gap/spec.md'), `\n${reasonHeading}\n\nFixture amendment.\n`);
  const command = emitted.output.match(/canon run gap --reroute/)?.[0];
  assert.ok(command, emitted.output);
  assert.ok(emitted.reason.includes(command));
  const result = runPrinted(command, cwd, tasks, 'gap');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const status = endStatus(tasks, 'gap');
  const phases = status.phases as Record<string, { status: string }>;
  assert.equal(phases.spec_review.status, 'done');
  assert.equal(phases.code_review.status, 'pending');
  assert.ok(fs.existsSync(path.join(tasks, 'gap/review-prior-1.md')));
}));

void test('spec_gap fix hint at reroute_count 1: the printed heading and reroute are accepted', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/gap');
  const tasks = fixtureTask(cwd, 'gap', 1);
  fs.appendFileSync(path.join(tasks, 'gap/spec.md'), '\n## Amendment\n\nPrior reroute.\n');
  const emitted = emitSpecGap(cwd, tasks, ['gap']);
  const reasonHeading = emitted.reason.match(/FIX: add (## Amendment(?: Round \d+)?) to tasks\/gap\/spec\.md/)?.[1];
  const outputHeading = emitted.output.match(/add a (## Amendment(?: Round \d+)?) section/)?.[1];
  assert.equal(reasonHeading, '## Amendment Round 2');
  assert.equal(outputHeading, reasonHeading);
  fs.appendFileSync(path.join(tasks, 'gap/spec.md'), `\n${reasonHeading}\n\nFixture amendment.\n`);
  const command = emitted.output.match(/canon run gap --reroute/)?.[0];
  assert.ok(command, emitted.output);
  const result = runPrinted(command, cwd, tasks, 'gap');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const status = endStatus(tasks, 'gap');
  const phases = status.phases as Record<string, { status: string; reroute_count?: number }>;
  assert.equal(phases.spec_review.status, 'done');
  assert.equal(phases.implement.reroute_count, 2);
  assert.ok(fs.existsSync(path.join(tasks, 'gap/review-prior-1.md')));
}));

void test('spec_gap scope hint uses a scope-only heading that does not satisfy a later reroute', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/gap');
  const tasks = fixtureTask(cwd, 'gap', 1);
  fs.appendFileSync(path.join(tasks, 'gap/spec.md'), '\n## Amendment\n\nPrior reroute.\n');
  const status = endStatus(tasks, 'gap');
  status.full_send = true;
  writeStatus(tasks, 'gap', status);
  fs.writeFileSync(path.join(cwd, 'scope-leak.txt'), 'outside affected files\n');
  git(cwd, 'add', 'scope-leak.txt');
  git(cwd, 'commit', '-m', 'add unscoped full-send file');
  const emitted = emitSpecGap(cwd, tasks, ['gap']);
  const scopeHeading = '## Amendment (full-send scope)';
  const reasonScopeNote = emitted.reason.split('before blessing, ')[1]?.split(' or remove')[0] ?? '';
  const outputScopeNote = emitted.output.split('Before blessing, ')[1]?.split(' or remove')[0] ?? '';
  const suggestedHeading = reasonScopeNote.match(/under (## Amendment(?: Round \d+| \(full-send scope\))?)/)?.[1];
  assert.ok(suggestedHeading, reasonScopeNote);
  fs.appendFileSync(path.join(tasks, 'gap/spec.md'), `\n${suggestedHeading}\n\n| File | Reason |\n| --- | --- |\n| scope-leak.txt | Full-send scope fixture |\n`);
  const bless = emitted.output.match(/canon task accept gap code_review --reason "<why this gap is acceptable>"/)?.[0];
  assert.ok(bless, emitted.output);
  const blessed = runPrinted(bless, cwd, tasks, 'gap');
  assert.equal(blessed.status, 0, blessed.stdout + blessed.stderr);
  assert.equal(derive(endStatus(tasks, 'gap')), 'qa');
  const reroute = emitted.output.match(/canon run gap --reroute/)?.[0];
  assert.ok(reroute, emitted.output);
  const refused = runPrinted(reroute, cwd, tasks, 'gap');
  assert.notEqual(refused.status, 0, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /expected heading: ## Amendment Round 2/);
  assert.ok(reasonScopeNote.includes(scopeHeading), reasonScopeNote);
  assert.ok(outputScopeNote.includes(scopeHeading), outputScopeNote);
  assert.doesNotMatch(reasonScopeNote, /## Amendment Round 2/);
  assert.doesNotMatch(outputScopeNote, /## Amendment Round 2/);
}));

void test('spec_gap fix hint in a bundle names a heading only for the spec_gap task and its reroute is accepted', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/bundle');
  const tasks = fixtureTask(cwd, 'gap-a', 1);
  fixtureTask(cwd, 'ok-b', 0, 'approved');
  fs.appendFileSync(path.join(tasks, 'gap-a/spec.md'), '\n## Amendment\n\nPrior reroute.\n');
  for (const id of ['gap-a', 'ok-b']) {
    const statusPath = path.join(tasks, id, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
    status.branch = 'task/bundle';
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  }
  fs.writeFileSync(path.join(cwd, 'seed.txt'), 'task implementation\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'fixture implementation');
  const emitted = emitSpecGap(cwd, tasks, ['gap-a', 'ok-b']);
  assert.match(emitted.reason, /## Amendment Round 2 to tasks\/gap-a\/spec\.md/);
  assert.doesNotMatch(emitted.reason, /FIX:[^\n]*tasks\/ok-b/);
  fs.appendFileSync(path.join(tasks, 'gap-a/spec.md'), '\n## Amendment Round 2\n\nFixture amendment.\n');
  const command = emitted.output.match(/canon run gap-a ok-b --reroute/)?.[0];
  assert.ok(command, emitted.output);
  const result = runPrinted(command, cwd, tasks, 'gap-a', 'implement', ['gap-a', 'ok-b']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(((endStatus(tasks, 'gap-a').phases) as Record<string, { status: string }>).implement.status, 'done');
  assert.equal(((endStatus(tasks, 'ok-b').phases) as Record<string, { status: string }>).implement.status, 'done');
}));

void test('spec_gap bless hint: the printed accept command sanctions code_review and advances to qa', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/gap');
  const tasks = fixtureTask(cwd, 'gap');
  const emitted = emitSpecGap(cwd, tasks, ['gap']);
  const command = emitted.output.match(/canon task accept gap code_review --reason "<why this gap is acceptable>"/)?.[0];
  assert.ok(command, emitted.output);
  assert.ok(emitted.reason.includes('canon task accept gap code_review --reason "<why>"'));
  const result = runPrinted(command, cwd, tasks, 'gap');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const status = endStatus(tasks, 'gap');
  const phases = status.phases as Record<string, { status: string; verdict?: string; operator_accepted?: boolean }>;
  assert.equal(phases.code_review.verdict, 'sanctioned');
  assert.equal(phases.code_review.operator_accepted, true);
  assert.equal(phases.code_review.status, 'done');
  assert.equal(derive(status), 'qa');
}));

void test('task phase sanctioned redirect: the printed accept command is accepted from a spec_gap halt', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/gap');
  const tasks = fixtureTask(cwd, 'gap');
  emitSpecGap(cwd, tasks, ['gap']);
  const rejected = runInline(cwd, `
    import { taskCmd } from ${JSON.stringify(path.join(ROOT, 'src/task/index.ts'))};
    taskCmd(['phase', 'gap', 'code_review', 'done', 'sanctioned']);
  `, { CANON_TASKS_DIR_OVERRIDE: tasks });
  assert.notEqual(rejected.status, 0);
  const command = rejected.stderr.match(/canon task accept <id> code_review --reason "<why>"/)?.[0];
  assert.ok(command, rejected.stderr);
  const accepted = runPrinted(command, cwd, tasks, 'gap');
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  const phases = endStatus(tasks, 'gap').phases as Record<string, { operator_accepted?: boolean }>;
  assert.equal(phases.code_review.operator_accepted, true);
}));

void test('task phase spec_review sanctioned redirect emits and accepts the spec_review command', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/spec-accept');
  const tasks = fixtureTask(cwd, 'spec-accept');
  const status = endStatus(tasks, 'spec-accept');
  status.status = 'spec_review';
  const phases = status.phases as Record<string, { status: string; verdict?: string }>;
  phases.spec_review.status = 'changes_requested';
  phases.spec_review.verdict = 'changes_requested';
  phases.plan.status = 'pending';
  phases.implement.status = 'pending';
  phases.code_review.status = 'pending';
  writeStatus(tasks, 'spec-accept', status);
  const rejected = runInline(cwd, `
    import { taskCmd } from ${JSON.stringify(path.join(ROOT, 'src/task/index.ts'))};
    taskCmd(['phase', 'spec-accept', 'spec_review', 'done', 'sanctioned']);
  `, { CANON_TASKS_DIR_OVERRIDE: tasks });
  assert.notEqual(rejected.status, 0);
  const command = rejected.stderr.match(/canon task accept <id> spec_review --reason "<why>"/)?.[0];
  assert.ok(command, rejected.stderr);
  const accepted = runPrinted(command, cwd, tasks, 'spec-accept');
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  const result = endStatus(tasks, 'spec-accept');
  const nextPhases = result.phases as Record<string, { status: string; verdict?: string; operator_accepted?: boolean }>;
  assert.equal(nextPhases.spec_review.status, 'done');
  assert.equal(nextPhases.spec_review.verdict, 'sanctioned');
  assert.equal(nextPhases.spec_review.operator_accepted, true);
  assert.equal(derive(result), 'plan');
}));

void test('code_review pre-flight auto-block: the printed reset-code-review is accepted and the re-run passes pre-flight', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/preflight');
  const tasks = fixtureTask(cwd, 'preflight');
  const handoff = path.join(tasks, 'preflight/handoff.md');
  fs.writeFileSync(handoff, fs.readFileSync(handoff, 'utf8').replace(
    '| `npm test` | Pass | fixture |', '| `npm test` | blocked | CI runner unavailable |',
  ));
  const runReview = () => runInline(cwd, `
    import { runCodeReviewPhase } from ${JSON.stringify(path.join(ROOT, 'src/orchestrator/phases/code-review.ts'))};
    import { readStatus } from ${JSON.stringify(path.join(ROOT, 'src/orchestrator/state.ts'))};
    const id = 'preflight';
    const status = readStatus(id);
    const review = status.phases.code_review;
    const task = {
      taskId: id,
      title: id,
      specReviewVerdict: 'approved',
      iterations: review.iterations ?? 0,
      iterations_current_loop: review.iterations_current_loop ?? 0,
      iterations_total: review.iterations_total ?? 0,
      rerouteCount: 0,
      status,
    };
    const deps = {
      verifyBranch() {},
      getBaseBranch() { return 'main'; },
      getActiveCwd() { return process.cwd(); },
      getAffectedFiles() { return { ok: true, files: [] }; },
      verifyHandoffAgainstDiff() { return []; },
      getMaxReviewLoops() { return 3; },
      resolveCommit() { return 'fixture-head'; },
      getEffectiveSize() { return 'M'; },
      getCodexConfig() { return { model: 'fixture', effort: 'low' }; },
      async runColdCodexReview() { return { success: true, findings: '' }; },
      writeColdCodexArchive() {},
      findColdCodexArchiveForRound() { return null; },
      hasMalformedColdCodexArchive() { return false; },
      getClaudeConfig() { return { model: 'fixture', effort: 'low', budget: 1 }; },
      getScopedDiff() { return ''; },
      async runClaude() {
        fs.writeFileSync(path.join(process.cwd(), 'agent-called.txt'), 'yes');
        return { sessionId: 'fixture', exitCode: 0 };
      },
    };
    await runCodeReviewPhase({ tasks: [task], tier: 'full', isBundle: false }, false, null, deps);
  `, { CANON_TASKS_DIR_OVERRIDE: tasks });
  const blocked = runReview();
  assert.equal(blocked.status, 2, `exit ${blocked.status}: ${blocked.stderr}${blocked.stdout}`);
  const status = endStatus(tasks, 'preflight');
  assert.equal(((status.phases) as Record<string, { status: string }>).code_review.status, 'blocked');
  const reason = ((status.escalations) as Array<{ reason: string }>).at(-1)?.reason ?? '';
  const emitted = blocked.stdout + blocked.stderr;
  const command = emitted.match(/canon task reset-code-review <id>/)?.[0];
  assert.ok(command, emitted);
  assert.ok(reason.includes(command), JSON.stringify(status.escalations));
  assert.match(reason, /only blocked validation rows/);

  fs.writeFileSync(handoff, fs.readFileSync(handoff, 'utf8').replace(
    '| `npm test` | blocked | CI runner unavailable |', '| `npm test` | Pass | fixture |',
  ));
  const reset = runPrinted(command, cwd, tasks, 'preflight');
  assert.equal(reset.status, 0, reset.stdout + reset.stderr);
  const pending = endStatus(tasks, 'preflight').phases as Record<string, { status: string }>;
  assert.equal(pending.code_review.status, 'pending');
  assert.equal(pending.implement.status, 'done');
  const resumed = runReview();
  assert.equal(resumed.status, 0, resumed.stderr + resumed.stdout);
  assert.doesNotMatch(resumed.stdout + resumed.stderr, /Validation pre-flight FAILED/);
  assert.equal(fs.readFileSync(path.join(cwd, 'agent-called.txt'), 'utf8'), 'yes');
}));

void test('spec gate done note: the printed reroute is accepted and the armed gate fires from code_review, qa and human_review', () => withTempDir(dir => {
  for (const phase of ['code_review', 'qa', 'human_review']) {
    const root = path.join(dir, phase);
    fs.mkdirSync(root, { recursive: true });
    const cwd = makeRepo(root);
    git(cwd, 'checkout', '-b', `task/${phase}`);
    const tasks = fixtureTask(cwd, phase, 0, 'approved');
    const status = endStatus(tasks, phase);
    const phases = status.phases as Record<string, { status: string; verdict?: string }>;
    phases.code_review.status = phase === 'code_review' ? 'pending' : 'done';
    if (phase === 'human_review') phases.qa.status = 'done';
    if (phase === 'human_review') phases.human_review.status = 'pending';
    writeStatus(tasks, phase, status);
    assert.equal(derive(endStatus(tasks, phase)), phase);
    const note = runInline(cwd, `
      import { taskCmd } from ${JSON.stringify(path.join(ROOT, 'src/task/index.ts'))};
      taskCmd(['set', ${JSON.stringify(phase)}, 'human_spec_gate', 'true']);
    `, { CANON_TASKS_DIR_OVERRIDE: tasks });
    assert.match(note.stdout, /armed gate fires after the next spec_review/);
    const command = note.stdout.match(/canon run --reroute [\w-]+/)?.[0];
    assert.ok(command, note.stdout);
    fs.appendFileSync(path.join(tasks, phase, 'spec.md'), '\n## Amendment\n\nFixture amendment.\n');
    const rerouted = runPrinted(command, cwd, tasks, phase);
    assert.equal(rerouted.status, 0, rerouted.stdout + rerouted.stderr);
    assert.match(rerouted.stdout, /SPEC GATE/);
    assert.equal(endStatus(tasks, phase).human_spec_gate, false);
  }
}));

void test('spec loop cap at spec_review entry: the printed reset-spec-review is accepted', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/spec-cap');
  const tasks = fixtureTask(cwd, 'spec-cap');
  const status = endStatus(tasks, 'spec-cap');
  status.status = 'spec_review';
  const phases = status.phases as Record<string, Record<string, unknown>>;
  phases.spec_review = { status: 'pending', agent: 'codex', verdict: '', iterations: 3, iterations_current_loop: 3, iterations_total: 3 };
  phases.plan.status = 'pending';
  phases.implement.status = 'pending';
  writeStatus(tasks, 'spec-cap', status);
  fs.writeFileSync(path.join(tasks, 'spec-cap/spec-review.md'), '# Spec Review\n\nPrior review.\n');

  const blockedRun = runLoopCap(cwd, tasks, 'spec-cap', 'spec_review');
  assert.equal(blockedRun.status, 2, blockedRun.stderr + blockedRun.stdout);
  const blocked = endStatus(tasks, 'spec-cap');
  const reason = ((blocked.escalations) as Array<{ reason: string }>).at(-1)?.reason ?? '';
  const command = reason.match(/canon task reset-spec-review ([\w-]+)/)?.[0];
  assert.ok(command, reason);
  assert.ok((blockedRun.stdout + blockedRun.stderr).includes(command));
  const reset = runPrinted(command, cwd, tasks, 'spec-cap');
  assert.equal(reset.status, 0, reset.stdout + reset.stderr);
  const resetStatus = endStatus(tasks, 'spec-cap');
  const resetPhases = resetStatus.phases as Record<string, { status: string; iterations_current_loop?: number }>;
  assert.equal(resetPhases.spec_review.status, 'pending');
  assert.equal(resetPhases.spec_review.iterations_current_loop, 0);
  assert.ok(fs.existsSync(path.join(tasks, 'spec-cap/spec-review-prior-1.md')));
}));

void test('code loop cap at code_review entry: the printed reset-code-review is accepted', () => withTempDir(dir => {
  const cwd = makeRepo(dir);
  git(cwd, 'checkout', '-b', 'task/code-cap');
  const tasks = fixtureTask(cwd, 'code-cap', 0, '');
  const status = endStatus(tasks, 'code-cap');
  status.status = 'code_review';
  const phases = status.phases as Record<string, Record<string, unknown>>;
  phases.code_review = {
    status: 'pending', agent: 'claude', verdict: '', iterations: 3, iterations_current_loop: 3,
    iterations_total: 3, preflight_rejections_current_loop: 0,
  };
  writeStatus(tasks, 'code-cap', status);
  fs.writeFileSync(path.join(tasks, 'code-cap/review.md'), '# Code Review\n\nPrior review.\n');

  const blockedRun = runLoopCap(cwd, tasks, 'code-cap', 'code_review');
  assert.equal(blockedRun.status, 2, blockedRun.stderr + blockedRun.stdout);
  const blocked = endStatus(tasks, 'code-cap');
  const reason = ((blocked.escalations) as Array<{ reason: string }>).at(-1)?.reason ?? '';
  const command = reason.match(/canon task reset-code-review ([\w-]+)/)?.[0];
  assert.ok(command, reason);
  assert.ok((blockedRun.stdout + blockedRun.stderr).includes(command));
  const reset = runPrinted(command, cwd, tasks, 'code-cap');
  assert.equal(reset.status, 0, reset.stdout + reset.stderr);
  const resetStatus = endStatus(tasks, 'code-cap');
  const resetPhases = resetStatus.phases as Record<string, { status: string }>;
  assert.equal(resetPhases.code_review.status, 'pending');
  assert.equal(resetPhases.implement.status, 'done');
}));
