# Implementation Plan: per-command-help

> Written by: Claude | Implements: `tasks/per-command-help/spec.md`

## Approach

Add one pure leaf module, `src/lib/cli-args.ts`, that holds the declaration type, the pre-scan, and the message builders. Every command gets an exported declaration object that carries its **usage string**. That way the AC-1 table test, the help path, and the unknown-flag path all read the same object. Each command calls the pre-scan first, before any side effect. Help prints `decl.usage` to stdout and exits 0. An unknown argument prints the shared message to stderr and exits with the command's existing non-zero code. `printHelp()` becomes a summary, and the detail it carried moves into the owning declarations' usage strings.

Two parsers that live inline today move into exported pure functions so AC-1(b) and AC-4 can test them without side effects: `parseTaskNewArgs()` comes out of `taskNew()`, and `parseTaskAcceptArgs()` comes out of the `accept` case in `taskCmd()`. `parseWatchArgs()` gets exported. Their behavior doesn't change.

Spec review verdict: **approved**, with no nits to carry.

**Feasibility check**

- **Exists:** all of these were confirmed by search:
  - `printHelp()` is at `src/cli/index.ts:12`.
  - `runCmd()` and its `checkDepForFlag()` loop are at `src/cli/commands/run-task.ts:10`. `checkDepForFlag()` and `checkDeps()` are in `src/cli/deps.ts`, which needs no change.
  - In `src/orchestrator/cli.ts`, `printUsage()` is at line 110 and `parseArgs()` at line 168, which honours `--help` only when it is `argv[0]`.
  - In `src/cli/commands/watch.ts`, `parseWatchArgs()` (line 229, not exported) and `printUsage(stderr)` (line 208) are both used by `watchCmd()` at line 654.
  - `stopCmd(args, deps)` is at `src/cli/commands/stop.ts:403`. It reads `args[0]` as the task id and takes an injected `kill`.
  - `parseUpdateArgs()` is at `src/cli/commands/update.ts:45` and `updateCmd(args, deps)` at line 434. `deps` takes `spawnRunner`, `gitRunner`, `npmViewRunner`, `exit`, `stdout`, and `stderr`.
  - `parseUpgradeArgs()` is at `src/cli/commands/upgrade.ts:534`. `upgradeCmd()` at line 547 calls it with no try/catch, which is where the stack trace comes from.
  - `initCmd(_args)` (`src/cli/commands/init.ts:70`) calls `checkDeps()` first. `doctorCmd(_args)` (`src/cli/commands/doctor.ts:719`) ignores its args.
  - In `src/task/index.ts`: `usage()` is at line 47, `taskNew()` at line 181, `taskSet()` at line 1547 with positional `[id, field, value]`, and `taskCmd()` at line 1611. `taskCmd()` calls `assertManagedInvocationRoot()` inside its `try`, before the `switch`.
  - In `src/task/index.ts`, `VALID_VERDICTS`, `VALID_STATUSES`, `SETTABLE_FIELDS`, and `PHASE_ORDER` are all defined or imported at the top of the module.
- **Real path:**
  - `canon run …` goes `src/cli/index.ts` → `runCmd()` → `checkDepForFlag()` per arg (`gh` probe) → spawn `dist/orchestrator/run-task.js` → `main()` → `parseArgs()`. Help has to be resolved in `runCmd()` before the probe and the spawn. `parseArgs()` also gets the pre-scan, so a direct `run-task.js --help` call behaves the same way.
  - `canon task …` goes `src/cli/commands/task.ts` → `taskCmd()`. The managed-root check runs before dispatch. That's the existing code AC-3 has to get ahead of.
- **Callers:**
  - `parseArgs()`: `src/orchestrator/main.ts:3967` and `tests/run-task-cli.test.ts`.
  - `parseUpdateArgs()`: `updateCmd()` and `tests/cli.test.ts:506-519`.
  - `parseUpgradeArgs()`: `upgradeCmd()` and `tests/cli.test.ts:3028-3038`.
  - Watch's `printUsage(stderr)`: only its usage-error path.
  - `taskNew(args)`: `taskCmd()` and direct calls in `tests/task-cli.test.ts`. Keep its signature.
  - `usage()`: only `taskCmd()`'s default branch.
  - `orchestrator/cli.ts` `printUsage()`: only `parseArgs()`.
  - Only the update and upgrade parsers change their error contract (the message text). Their pinned tests are updated in Step 11.
- **Tests that can fail:** each AC-2/3/5 case below names an input that today hits the old path:
  - `run foo --help` → "Unknown option", exit 1.
  - `init --help` with no deps on `PATH` → `checkDeps()` exits 1.
  - `task --help` from a foreign worktree → dies in `assertManagedInvocationRoot()`.
  - `upgrade --bogus` → stack trace.
  - `stop foo --bogus` → silently ignored.
  - `run -z foo` → treated as a task id.
  - `watch foo --help` → exit 2 with a summary line.

  Every AC-3 case also gets a **control** assertion that the same fixture without `--help` hits the side effect, so the case can't pass vacuously.
- **Predicates:** the pre-scan rules are below in Step 1. Boundary values:
  - `-` and `--` count as dash-prefixed (unknown, unless in a free-text slot).
  - `''` counts as a positional.
  - `--help=x` is unknown, because only the exact `--help`/`-h` tokens request help.
  - A value flag in the last position consumes nothing and proceeds; the parser reports the missing value.
  - A value flag consumes the next token even when it is `--help` or dash-prefixed (AC-4).
  - `--base=` (empty) passes the pre-scan, and the parser's existing handling applies.
  - `--expect=plan` is unknown, because `run` never accepted `=` forms.
- **Scope:** every file the steps below change is in the spec's Affected Files. `src/cli/deps.ts` and `src/cli/commands/task.ts` are not changed.
- **Async/stateful:** N/A beyond exit ordering. The help path either returns normally (init, doctor, run wrapper, upgrade, task) or calls the injected `exit(0)` (watch, stop, update), so tests that stub `exit` keep working.

**Pre-existing bug fixed in passing (no spec change):** watch's `printUsage(stderr)` writes each line through a raw `process.stderr.write` with no trailing `\n`, so today the usage block comes out as one run-on line. Sharing one newline-terminated usage string (Decision 2) fixes it. I'm flagging it so the reviewer doesn't read the changed stderr shape as scope creep.

## Steps

### Step 1: Shared declaration + pre-scan module

Files: `src/lib/cli-args.ts` (new)

The module is pure, with no I/O and no imports from `src/orchestrator/`. It follows the leaf-module style of `src/lib/canon-block.ts`.

```ts
export interface ArgDeclaration {
    /** 'run', 'watch', 'task new', … — used for the Usage line check and the help pointer. */
    readonly command: string;
    /** Full usage text, newline-joined, no trailing newline. Must begin `Usage: canon <command>`. */
    readonly usage: string;
    /** Flags that take no value, including short aliases ('--step', '-1'). */
    readonly booleanFlags: readonly string[];
    /** Flags that consume the next token as their value ('--expect'). */
    readonly valueFlags: readonly string[];
    /** Subset of valueFlags whose parser also accepts '--flag=value'. */
    readonly equalsValueFlags?: readonly string[];
    /** 0-based positional slots where a dash-leading token is free text, not a flag. */
    readonly freeTextSlots?: readonly number[];
    /** update/upgrade: any bare positional is rejected ('Unexpected argument'). */
    readonly rejectPositionals?: boolean;
}

export type PreScanResult =
    | { kind: 'help' }
    | { kind: 'unknown'; arg: string }
    | { kind: 'unexpected'; arg: string }
    | { kind: 'proceed' };

export function preScanArgs(decl: ArgDeclaration, argv: readonly string[]): PreScanResult
export function helpPointer(command: string): string            // `Run 'canon ${command} --help' for usage.`
export function unknownOptionMessage(command: string, arg: string): string      // `Unknown option: ${arg}\n${helpPointer(command)}`
export function unexpectedArgumentMessage(command: string, arg: string): string // `Unexpected argument: ${arg}\n${helpPointer(command)}`
export function preScanErrorMessage(command: string, result: PreScanResult): string | null
```

The pre-scan is a single left-to-right walk. It records the first error and keeps scanning, so help wins over the error:

1. If `arg === '--help' || arg === '-h'`, return `help` immediately. That includes help in a positional or free-text slot (Decision 4).
2. If `booleanFlags` includes `arg`, continue.
3. If `valueFlags` includes `arg`, skip the next token (`i += 1`) whatever it is, then continue. This is what keeps `--reason "--help"` and `--until --help` literal.
4. If `arg` contains `=` and `equalsValueFlags` includes `arg.slice(0, arg.indexOf('='))`, continue.
5. If `arg.startsWith('-')`: when `freeTextSlots` includes the current positional index, count it as a positional (`pos += 1`). Otherwise set `firstError ??= { kind: 'unknown', arg }`.
6. Otherwise it's a bare token. If `rejectPositionals`, set `firstError ??= { kind: 'unexpected', arg }`; otherwise `pos += 1`.
7. At the end, return `firstError ?? { kind: 'proceed' }`.

Also export a convenience wrapper for the commands with plain console I/O:

```ts
export function handlePreScan(
    decl: ArgDeclaration,
    argv: readonly string[],
    io: { out: (text: string) => void; err: (text: string) => void; exit: (code: number) => never },
    errorExitCode = 1,
): 'proceed' | 'help'
```

On help it calls `io.out(decl.usage)` and returns `'help'`; the caller then returns or calls `exit(0)` in its own idiom. On an error it calls `io.err(message)` then `io.exit(errorExitCode)`. Watch doesn't use the wrapper (Step 5).

### Step 2: `run` declaration, usage, and parser

Files: `src/orchestrator/cli.ts`

- Turn `printUsage()`'s `console.log` lines into one `const RUN_USAGE = [ … ].join('\n')`, keeping the text as it is today. Then `printUsage()` becomes `console.log(RUN_USAGE)`. Today's text already lists every flag, including `--allow-divergent-base`.
- Export the declaration:

  ```ts
  export const RUN_ARGS: ArgDeclaration = {
      command: 'run', usage: RUN_USAGE,
      booleanFlags: ['--interactive', '-I', '--step', '-1', '--push', '--pr', '--reroute', '--full-send', '--force', '--allow-divergent-base', '--ship', '--dry-run'],
      valueFlags: ['--expect'],
  };
  ```

- In `parseArgs()`, keep the `argv.length === 0` branch, which prints usage and exits 1. Replace the `argv[0] === '--help'` check with `const scan = preScanArgs(RUN_ARGS, argv)`:
  - On `help`: `printUsage(); setExitReason('help requested'); process.exit(0);`
  - On `unknown`: `die(unknownOptionMessage('run', scan.arg))`.
- In the loop's `default:`, change `arg.startsWith('--')` to `arg.startsWith('-')` and use the builder, as a defensive belt. The pre-scan already guarantees the branch is unreachable for undeclared flags.

### Step 3: `run` wrapper resolves help before probing/spawning

Files: `src/cli/commands/run-task.ts`

At the top of `runCmd()`, before the `checkDepForFlag()` loop:

```ts
import { RUN_ARGS } from '../../orchestrator/cli.js';
import { handlePreScan } from '../../lib/cli-args.js';
…
if (handlePreScan(RUN_ARGS, args, { out: s => console.log(s), err: s => console.error(s), exit: c => process.exit(c) }) === 'help') return;
```

Unknown flags are rejected here too (exit 1, before the `gh` probe), so `canon run --pr --bogus` never probes. `orchestrator/cli.ts` imports only `fs` and types, so pulling it into the `dist/cli/index.js` bundle is safe.

### Step 4: `stop`

Files: `src/cli/commands/stop.ts`

- Add `export const STOP_ARGS: ArgDeclaration` with `command: 'stop'` and no flags. The `STOP_USAGE` begins `Usage: canon stop <task-id>` and carries the detail moving out of `printHelp()`: SIGTERM → SIGKILL after 10s, the launch-window wait, and `CANON_STOP_WAIT_MS` (default 30000).
- In `stopCmd()`, right after the deps bindings and before `const taskId = args[0]`:

  ```ts
  if (handlePreScan(STOP_ARGS, args, { out: stdout, err: stderr, exit }) === 'help') return exit(0);
  ```

  `stdout`/`stderr` here are line writers (`console.log` semantics), so pass the text without a trailing newline.
- Change the existing empty-args message to print `STOP_USAGE` instead of the bare `Usage: canon stop <task-id>` line. It still exits 1.

### Step 5: `watch`

Files: `src/cli/commands/watch.ts`

- Replace `printUsage(stderr)` with `const WATCH_USAGE = [ … ].join('\n')`. Keep today's content, which already has the exit codes, summary-line shape, and reasons. Fold in the `printHelp()` blurb: it blocks on an already-detached run, prints one final summary line to stdout, and sends progress/log tailing to stderr. Keep the literal `Exit codes: 0 healthy stop/until` phrase, because the retargeted `tests/cli.test.ts` assertion matches it. The first line stays `Usage: canon watch <task-id> [--until <phase>] [--timeout <dur>] [--follow|-f]`.
- Add `export const WATCH_ARGS: ArgDeclaration = { command: 'watch', usage: WATCH_USAGE, booleanFlags: ['--follow', '-f'], valueFlags: ['--until', '--timeout'], equalsValueFlags: ['--timeout'] }`.
- Export `parseWatchArgs` (needed for AC-1(b) and AC-6). Its behavior doesn't change.
- In `watchCmd()`, replace the `parseWatchArgs` block:

  ```ts
  const scan = preScanArgs(WATCH_ARGS, args);
  if (scan.kind === 'help') {
      stdout(`${WATCH_USAGE}\n`);        // no emitSummary — Decision 6
      return exit(0);
  }
  const parsed = scan.kind === 'unknown'
      ? { …emptyParsed, usageError: `Unknown option: ${scan.arg}` }
      : parseWatchArgs(args);
  if (parsed.usageError) {
      stderr(`${WATCH_USAGE}\n`);
      stderr(`canon watch: ${parsed.usageError}\n${helpPointer('watch')}\n`);
      emitSummary(stdout, { state: 'usage', reason: 'usage_error' });
      return exit(2);
  }
  ```

  The simplest form is a small branch that sets `usageError` from the scan and skips `parseWatchArgs`. Adding the pointer to every usage error is intentional: one code path, and the spec only requires it on the unknown-option path. Watch's `stdout`/`stderr` are raw writers, so include `\n` yourself.

### Step 6: `update`

Files: `src/cli/commands/update.ts`

- Add `export const UPDATE_ARGS: ArgDeclaration = { command: 'update', usage: UPDATE_USAGE, booleanFlags: [], valueFlags: ['--channel', '--ref'], rejectPositionals: true }`.
- `UPDATE_USAGE` begins `Usage: canon update [--channel main | --ref <ref|sha>]` and carries the `printHelp()` detail word for word. That covers the install-root resolution, the default pin to the latest final release, `.canon/provenance.json`, the `--channel main` / `--ref <ref>` / `--ref <40-hex-sha>` lines, and the mutual exclusion.
- In `updateCmd()`, right after the `exit`/`stdout`/`stderr` bindings (before `ownPackageName()` and any runner):

  ```ts
  if (handlePreScan(UPDATE_ARGS, args, { out: stdout, err: stderr, exit }) === 'help') return exit(0);
  ```

- In `parseUpdateArgs()`'s final `else`, throw `unknownOptionMessage('update', arg)` when `arg.startsWith('-')` and `unexpectedArgumentMessage('update', arg)` otherwise. That replaces `unknown flag '…'. Supported: …`. Leave the other `canon update:` errors alone.

### Step 7: `upgrade`

Files: `src/cli/commands/upgrade.ts`

- Add `export const UPGRADE_ARGS: ArgDeclaration = { command: 'upgrade', usage: UPGRADE_USAGE, booleanFlags: ['--check', '--dry-run', '--force', '--no-stage'], valueFlags: [], rejectPositionals: true }`.
- `UPGRADE_USAGE` begins `Usage: canon upgrade [--check|--dry-run] [--force] [--no-stage]`. Describe each flag from the `UpgradeOptions` doc comments (lines 12-19).
- In `parseUpgradeArgs()`, use the same two message builders as Step 6.
- In `upgradeCmd()`:
  - First, `if (handlePreScan(UPGRADE_ARGS, args, { out: console.log, err: console.error, exit: process.exit }) === 'help') return;`.
  - Then wrap `parseUpgradeArgs(args)` in `try/catch`. On error, call `console.error(message)` and `process.exit(1)`. That way no input can produce a stack trace.

### Step 8: `init` and `doctor`

Files: `src/cli/commands/init.ts`, `src/cli/commands/doctor.ts`

- Rename `_args` to `args`.
- Add `INIT_ARGS` and `DOCTOR_ARGS`, with no flags. Usage lines are `Usage: canon init` and `Usage: canon doctor`, each followed by a one-line description taken from today's summary lines.
- Make `if (handlePreScan(…) === 'help') return;` the **first** statement, ahead of `checkDeps()` in init and ahead of `process.cwd()` and the env checks in doctor.

### Step 9: `task` overview + per-subcommand declarations

Files: `src/task/index.ts`

- Rewrite `usage()` as the overview. Export it as `TASK_ARGS` (`command: 'task'`, no flags), with `TASK_USAGE` laid out as:

  ```
  Usage: canon task <subcommand> [args]

  Subcommands:
    new <TASK-ID> <title> [--base <branch>]   Create tasks/<id>/ from .canon/templates/
    list                                      Show all tasks and their current phase
    status <TASK-ID>                          Show full status.json detail
    phase <TASK-ID> <phase> <status> [verdict]
    accept <TASK-ID...> <phase> [--reason "<text>"] [--force]
    set <TASK-ID> <field> <value>
    reset-spec-review <TASK-ID>
    reset-code-review <TASK-ID>
    post-merge-sync [<branch>]

  Run 'canon task <subcommand> --help' for details.
  ```

  Each line gets a short description. Keep the signature lines exactly as they are today so the existing `HINT_SITES` usage exemptions keep matching where possible.
- Add `export const TASK_SUBCOMMAND_ARGS: Readonly<Record<string, ArgDeclaration>>` with nine entries. Each `command` is `task <sub>`, and each usage begins `Usage: canon task <sub> …`, carrying the `printHelp()` detail:
  - `new`: `valueFlags: ['--base']`, `equalsValueFlags: ['--base']`, `freeTextSlots: [1]`. The usage notes that the base branch is auto-detected from the current checkout and that `--base` overrides it.
  - `list`, `status`, `reset-spec-review`, `reset-code-review`, `post-merge-sync`: no flags. The reset entries keep the "Clear state for a fresh … pass after an auto-block. Zeroes …, clears verdict, archives prior …" text. `post-merge-sync` keeps its reconcile/hard-reset/refuse text.
  - `phase`: no flags. Build the usage from the module's constants so it can't drift:
    - phases: `PHASE_ORDER.join(' | ')`
    - pipeline order: `PHASE_ORDER.join(' → ')`. This is the moved "Pipeline phases (in order)" line.
    - statuses: `[...VALID_STATUSES].join(' | ')`
    - verdicts: `[...VALID_VERDICTS].join(' | ')`. Insertion order already renders `approved | approved_with_nits | changes_requested | needs_re_review | spec_gap | sanctioned`.
    - the literal note line `(verdict applies to spec_review and code_review only; sanctioned is written via canon task accept --reason)`.
  - `accept`: `booleanFlags: ['--force']`, `valueFlags: ['--reason']`. The usage says `--reason` is required for spec_review and code_review. Describe `--force` from its uses in `taskAccept()` (lines 684-873): it bypasses the missing-verdict and dirty-tree guards.
  - `set`: no flags, `freeTextSlots: [2]`. The usage lists `SETTABLE_FIELDS.join(', ')` and the redirect/immutable-field note.
- Extract `export function parseTaskNewArgs(args: readonly string[]): { id: string; title: string; baseBranch: string }` from `taskNew()`'s loop, including the `!id || !title` usage throw. `taskNew()` calls it. Extract `export function parseTaskAcceptArgs(rest: readonly string[]): { ids: string[]; phase: string; force: boolean; reason: string | undefined }` from the `accept` case, keeping the `rest.includes('--force')` quirk verbatim (Non-Goal). The `accept` case calls it.
- In `taskCmd()`, before the `try`'s `assertManagedInvocationRoot()`, add:

  ```ts
  const [subcommand, ...rest] = args;
  if (subcommand === '--help' || subcommand === '-h') { console.log(TASK_USAGE); return; }
  const decl = subcommand ? TASK_SUBCOMMAND_ARGS[subcommand] : undefined;
  if (decl && handlePreScan(decl, rest, { out: console.log, err: console.error, exit: process.exit }) === 'help') return;
  ```

  Put this inside the `try`, ahead of `assertManagedInvocationRoot()`, so the catch still handles anything unexpected. Also guard the lookup with `Object.hasOwn`, so `canon task constructor` doesn't index the prototype. Bare `canon task` and unknown subcommands keep today's "Unknown subcommand" + `usage()` + exit 1 path. That path now prints the overview.

### Step 10: Top-level summary

Files: `src/cli/index.ts`

Replace `printHelp()`'s body with this summary:

```
canon-ai — spec-first multi-agent coding pipeline

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

Typical workflow:
  canon task new <id> "Title"   Create the task dir, then write spec.md with Claude Code
  canon run <id>                Run the pipeline (after the spec is approved)
  canon watch <id>              Wait for a detached run to settle
  canon run <id> --pr           Open a draft PR when the task reaches human_review

Global:
  --version, -v       Print canon-ai version
  --help, -h          Show this help

Run 'canon <command> --help' for details.
```

The summary must not contain `--reroute`, `reset-*`, or `canon task accept`, so `src/cli/index.ts` drops out of the recovery-hint registry entirely. Afterwards, run the AC-8 grep: `grep -nE "allow-divergent-base|reset-spec-review <id>|--until <phase>|needs_re_review" src/cli/index.ts` must print nothing.

### Step 11: Tests

Files: `tests/cli-args.test.ts` (new), `tests/cli.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-cli.test.ts`, `tests/watch.test.ts`, `tests/stop.test.ts`, `tests/run-task-validation.test.ts`, `tests/recovery-hints.test.ts`

**`tests/cli-args.test.ts` (new)**
- `preScanArgs` unit cases:
  - help at positions 0, middle, and last
  - `-h`
  - help after an unknown → `help` (help wins)
  - `--help` as a value-flag value → `proceed`
  - `--help` in a free-text slot → `help`
  - a dash token in a free-text slot → `proceed`
  - a dash token in a non-free slot → `unknown`
  - `--base=main` → `proceed`
  - `--expect=plan` against `RUN_ARGS` → `unknown`
  - `-` → `unknown`
  - a trailing value flag with no value → `proceed`
  - a bare word with `rejectPositionals` → `unexpected`
  - first-error-wins between two unknowns
- **AC-1 table:** an array covering all 8 command declarations plus all 9 `TASK_SUBCOMMAND_ARGS` entries. Assert there are exactly 9 subcommand keys and that they equal the spec's list.
  - (a) Each usage `startsWith('Usage: canon ' + decl.command)` and `includes` every boolean, value, and equals flag.
  - (b) A per-command parser adapter plus a sample-value map (`--expect`: `plan`, `--until`: `plan`, `--timeout`: `5s`, `--channel`: `main`, `--ref`: `feature`, `--base`: `main`, `--reason`: `x`) feeds each declared flag, and each `--flag=value` form, to the real parser and asserts no `Unknown option`/`unknown flag` error. The adapters:
    - `parseArgs(['foo', …])`, via a copy of the `runParseArgs` stub from `tests/run-task-cli.test.ts`; assert `status === 0`.
    - `parseWatchArgs(['t1', …]).usageError == null`
    - `parseUpdateArgs`, `parseUpgradeArgs`, `parseTaskNewArgs(['foo', 'Title', …])`, `parseTaskAcceptArgs(['foo', 'code_review', …])`: none of these throws.
  - Flagless declarations pass (b) vacuously, which is fine.
  - Explicitly assert that the spec's named flags are present: `--allow-divergent-base`, `-1`, `--step`, `--timeout`, `--check`, `--dry-run`, `--force`, `--no-stage`, `--base`, `--reason`.
- **AC-4 (parse level):** `parseTaskAcceptArgs(['foo', 'code_review', '--reason', '--help']).reason === '--help'`, and `preScanArgs(TASK_SUBCOMMAND_ARGS.accept, sameArgs).kind === 'proceed'`.
- **AC-6 (parse level):** `parseWatchArgs(['foo', '--timeout=5s']).timeoutMs === 5000`.

**`tests/cli.test.ts`**
- Extend `runCanonCliIn` with an optional `env` argument. Add a `runDistCli(args, opts)` helper that spawns `process.execPath dist/cli/index.js`. It should assert that the file exists, with the same "run npm run build" message as `tests/task-cli.test.ts:2864`. Subprocesses with a non-repo `cwd` must use the absolute TSX loader path (`node_modules/tsx/dist/loader.mjs`, as `tests/task-cli.test.ts:15` does), not the bare `--import tsx`.
- Retarget `canon CLI help mentions watch` (line 1028): `canon --help` asserts the eight command names, `canon <command> --help`, and the AC-7 negatives (`--allow-divergent-base`, `Exit codes:`, `--channel main`, `set <id> <field> <value>`, `spec → spec_review` are all absent). Then `canon watch --help` matches `/Exit codes: 0 healthy stop\/until/`, and `canon update --help` matches `--channel main` and `--ref <40-hex-sha>`.
- **AC-2:**
  - Through `dist/cli/index.js`: `run foo --help` and `run -h`, each exit 0 with `Usage: canon run` on stdout.
  - Through tsx: `watch foo --help` (stdout has `Usage: canon watch` and no `state=`), `watch foo --bogus --help`, `stop --help`, `update --channel main --help`, and `--help`, all exit 0.
- **AC-3:** each case pairs a help assertion with a control.
  - **`init --help`:** run in an empty temp dir with `PATH` set to an empty temp bin dir (no `which`, so `checkDeps()` would fail). Expect exit 0, stdout `Usage: canon init`, and `readdirSync(dir)` still `[]`. Control: `init` with the same env exits 1.
  - **`upgrade --help`:** run in a temp dir holding one fixture file. Expect the listing unchanged and exit 0.
  - **`run --pr --help`:** run through `dist/cli/index.js` with the empty `PATH`. Expect exit 0 with usage. Control: `run --pr foo` with the same env exits 1 with `requires the GitHub CLI`.
  - **update:** in-process `updateCmd(['--help'], { spawnRunner, gitRunner, npmViewRunner, stdout, stderr, exit })` with spy runners. Assert all call counts are 0, stdout has `Usage: canon update`, and the exit code is 0.
- **AC-5:**
  - Through tsx: `init`, `doctor`, `watch`, `stop`, `update`, `upgrade` with `--bogus`. Expect exit 2 for watch and 1 otherwise, with stderr containing `Unknown option: --bogus` and `Run 'canon <cmd> --help' for usage.`
  - For `doctor --bogus`, assert stdout lacks doctor's check output (e.g. no `node v`). For `init --bogus` in an empty temp dir, assert the dir stays empty.
  - `upgrade --bogus` stderr does not match `/^\s+at /m`.
  - `upgrade foo` and `update foo`: `Unexpected argument: foo` plus the pointer.
  - Through `dist/cli/index.js`: `run --bogus foo`, and `run -z foo` → `Unknown option: -z`.
- Update the pinned assertions at lines 518 and 3038 to `/Unknown option: --unknown/` and `/Unknown option: --what/`. Add `parseUpdateArgs(['foo'])` → `/Unexpected argument: foo/`.

**`tests/task-cli.test.ts`**
- **AC-2:** spawn the CLI (tsx loader, `src/cli/index.ts task …`) with `CANON_TASKS_DIR_OVERRIDE` set to a temp tasks root:
  - `task accept foo code_review -h` → exit 0, `Usage: canon task accept`
  - `task new foo --help` → exit 0, and no `foo/` dir created
- **AC-3 foreign worktree:**
  - Fixture: `git init` a temp repo, commit one file, `git worktree add <tmp>/hand-wt -b hand`.
  - Spawn with `cwd` set to the worktree, an env copy that **deletes** `CANON_TASKS_DIR_OVERRIDE` and `CANON_WORKTREES_ROOT`, and the absolute tsx loader.
  - Expect `task --help` → exit 0 + `canon task <subcommand> --help`, and `task status foo --help` → exit 0 + `Usage: canon task status`.
  - **Control (required):** `task list` in the same fixture exits non-zero with `does not manage`. That proves the fixture actually reaches the guard. Pattern reference: `tests/run-task-safety.test.ts:5016`.
- **AC-4:** a fixture task at a state where `taskAccept(... 'code_review', { reason })` succeeds (reuse an existing code_review accept fixture in this file). Run `taskCmd(['accept', id, 'code_review', '--reason', '--help'])` in-process under `withEnv`. Assert the recorded reason is `--help` and that stdout has no `Usage:`. If no accept fixture makes this cheap, the parse-level assertion in `cli-args.test.ts` satisfies the AC's "or the parse result carries it" clause. Record which one you used in the handoff.
- **AC-5:** for each of the nine subcommands, run `--bogus` in a non-free position (`task new --bogus`, `task set foo --bogus x`, `task accept --bogus foo code_review`, others `task <sub> --bogus`). Expect exit 1, `Unknown option: --bogus`, `Run 'canon task <sub> --help' for usage.`, and no task dir or status change.
- **AC-6:** with the override set:
  - `task set foo title "-draft"` → `status.title === '-draft'`
  - `task new foo2 "-draft title"` → title recorded
  - `task new bar "Title" --base=main` → `base_branch === 'main'`
- Adjust any assertion on the old `usage()` text. Keep `bundled orchestrator help is invocable once from dist` (line 2863) unchanged; it must still pass.

**Other test files**
- **`tests/run-task-cli.test.ts`:** `parseArgs(['foo', '--help'])` → status 0, stdout `Usage: canon run`. `parseArgs(['-h'])` → 0. `parseArgs(['-z', 'foo'])` → status 1, stderr `Unknown option: -z` + pointer. `parseArgs(['foo', '--expect', '--help'])` → status 0 with `expectPhase === '--help'` (value stays literal; this is the parser result, not a help request).
- **`tests/watch.test.ts`:**
  - `runWatchCommand(['t1', '--help'], {})` → exitCode 0, stdout joined has `Usage: canon watch`, no `state=`, stderr empty.
  - `['t1', '--bogus']` → 2, stderr has `Unknown option: --bogus` and `Run 'canon watch --help' for usage.`, stdout is the `state=usage reason=usage_error` line.
  - `['t1', '--until', '--help']` → 2 with `Invalid phase for --until: --help` (AC-4).
  - The existing line-811 test stays green.
- **`tests/stop.test.ts`:** `stopCmd(['foo', '--help'], { kill: spy, … })` → exit 0, stdout usage, `kill` never called. `stopCmd(['foo', '--bogus'], …)` → exit 1, stderr message, `kill` never called. Reuse the deps shape at line 498.
- **`tests/run-task-validation.test.ts`:** line 309 stops reading `src/cli/index.ts`. Import `TASK_SUBCOMMAND_ARGS` from `../src/task/index.js` and match the same two regexes against `TASK_SUBCOMMAND_ARGS.phase.usage`.
- **`tests/recovery-hints.test.ts`:** delete the four `src/cli/index.ts` entries (lines 14-37). Run the test and add an `exempt` entry for each new usage line that matches `HINT_PATTERN`, with reason "Not an actionable recovery hint: usage, help, or argv handling". Expect new lines in `src/orchestrator/cli.ts` (`--reroute` lines now in the array form) and in `src/task/index.ts` (phase note, accept and reset usages, re-indented extracted `throw` lines). Update the stale snippets for lines whose indentation moved. Every snippet must match exactly one line.

### Step 12: Docs

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `docs/codebase-map.md`, `docs/BACKLOG.md`

- **`docs/pipeline-orchestrator.md`:** add one sentence under `### canon watch <id>`: "`canon watch --help` prints usage to stdout and exits 0 with no summary line; the summary-line contract covers watching, not help." Then run `npm run sync-templates` (don't edit the mirror by hand).
- **`docs/codebase-map.md`:**
  - In row 46 (`src/cli/index.ts`), change "`printHelp()`" to "`printHelp()` (command summary only; each command's usage lives with its declaration)".
  - Add a `src/lib/cli-args.ts` row (argument declarations, help/unknown pre-scan, message builders) and a `tests/cli-args.test.ts` row in the matching sections.
  - Line 181 (the "Add a new review verdict" chain): replace the `src/cli/index.ts` (help text) hop with `src/task/index.ts` (`task phase` usage, rendered from `VALID_VERDICTS`), and adjust "all four" so the count still matches the hops listed.
- **`docs/BACKLOG.md`** line 478: replace the sentence that starts "today only `canon --help` and `canon run --help` work…" with a note that per-command `--help` and the argument declarations in `src/lib/cli-args.ts` landed in `per-command-help`, and that completion should read those declarations.

### Step 13: Build and validate

Run `npm run build`, then commit both `dist/cli/index.js` and `dist/orchestrator/run-task.js`. Then run `npm run lint`, `npm run type-check`, `npm test`, `npm run sync-templates:check`, and `npm run docs-refs-check`. The `dist/` AC-2/3/5 cases need the build to come first.

## Testing Plan

- **Unit:** `tests/cli-args.test.ts` covers the pre-scan rules, the AC-1 declaration/usage/parser table, and the AC-4 and AC-6 parse-level cases. `tests/watch.test.ts`, `tests/stop.test.ts`, and `tests/run-task-cli.test.ts` drive the commands in-process with injected deps.
- **Subprocess:** `tests/cli.test.ts` covers the non-task commands, with the `run` cases going through `dist/cli/index.js`. `tests/task-cli.test.ts` covers the task subcommands, including the foreign-worktree fixture with the override unset and its control.
- **Retargeted:** the help assertions in `tests/cli.test.ts`, the verdict and sanctioned-note assertions in `tests/run-task-validation.test.ts`, and the `HINT_SITES` entries in `tests/recovery-hints.test.ts`. The handoff names every edited existing test and why (AC-9).
- **Red check:** before finalizing, revert the `taskCmd()` help hoist and confirm the foreign-worktree help test fails. Then revert the `runCmd()` pre-scan and confirm `run --pr --help` with the empty `PATH` fails.
- **E2E:** N/A (no UI surface).
