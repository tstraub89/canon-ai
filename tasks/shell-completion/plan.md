# Implementation Plan: shell-completion

> Written by: Claude | Implements: `tasks/shell-completion/spec.md`

## Approach

Add `canon completion <shell>`. It builds one intermediate **model** from a side-effect-free command registry (`src/cli/registry.ts`) and the existing `ArgDeclaration`s, which gain an optional `completion` field. Four renderers turn that model into static scripts. Each script has two parts:

- a generated data section: per-command flags, value-flag kinds, positional slots, and value sets;
- a static interpreter written in that shell's own language. It walks the typed words the way `preScanArgs` does and prints candidates.

Task ids come from `git rev-parse --path-format=absolute --git-common-dir`, then its parent, then the directories under `tasks/`. Tab never starts node.

Spec review verdict was `approved` with no nits. Judgment calls the spec left to the plan (also recorded in `notes.md`):

1. **AC-1a, `task set` cases.** The `task_size` and boolean cases **read the field → value record** directly. There is no separate agreement test. AC-7 still exercises every record value through `canon task set`.
2. **Registry ↔ `completion.ts` import cycle.** `registry.ts` must import `COMPLETION_ARGS` from `completion.ts`. So `completion.ts` must **not** import the registry; it would hit a TDZ `ReferenceError` under ESM depending on evaluation order. `completionCmd` takes the registry as a parameter, and `src/cli/index.ts` passes `COMMAND_REGISTRY`. This also gives `index.ts` the registry import AC-3 requires, and lets tests pass a synthetic registry (AC-6a).
3. **`recovery-hints` snippets.** The `TASK_SUBCOMMAND_ARGS` entries are one-line object literals. Any inline `completion:` breaks `HINT_SITES` snippets, which match with `line.includes(snippet)` (`tests/recovery-hints.test.ts:466,476`) and end in `...noTaskFlags },` or `valueFlags: ['--reason'] },`. `RUN_ARGS` gets its metadata on a new line, so no edit is needed there. For the four task entries that carry snippets (`phase`, `accept`, `reset-spec-review`, `reset-code-review`), **append metadata inline and shorten those four snippets**: drop the trailing `, ...noTaskFlags },` / `, booleanFlags: ['--force'], valueFlags: ['--reason'] },` so each ends at the close of the usage string. The alternative was a separate completion record merged into the declarations. It adds indirection to the very declarations the spec wants to be the single source, so it was rejected.
4. **tcsh per-command flags.** tcsh `complete` is positional-only. To complete *the current command's* flags (AC-3b (c)) rather than a union, the `C/-/` pattern uses a backquoted `awk` program that reads the `COMMAND_LINE` environment variable tcsh sets for completion commands. AC-5 bans only `canon`/`node`/`npx`, so `awk` and `git` are allowed.

### Feasibility check

- **Exists (searched):**
  - `ArgDeclaration` and `preScanArgs`: `src/lib/cli-args.ts:1-55`
  - `INIT_ARGS`: `src/cli/commands/init.ts:19`
  - `DOCTOR_ARGS`: `doctor.ts:15`
  - `WATCH_ARGS`: `watch.ts:25`
  - `STOP_ARGS`: `stop.ts:58`
  - `UPDATE_ARGS` and `parseUpdateArgs`: `update.ts:56-80`; the `value !== 'main'` check is at :63
  - `UPGRADE_ARGS`: `upgrade.ts:30`
  - `RUN_ARGS`: `src/orchestrator/cli.ts:63-67`
  - in `src/task/index.ts`:
    - `TASK_ARGS` and `TASK_SUBCOMMAND_ARGS`: :61-74
    - `VALID_STATUSES`, `VALID_VERDICTS`, `REVIEW_PHASES`, `SETTABLE_FIELDS`: :24-28
    - `TASK_SIZE_VALUES`: :40
    - private `assertValidPhase`, `assertValidStatus`, `assertValidVerdict`: :360-385
    - the `taskAccept` phase chain: :607
    - the `taskSetValue` switch: :1487-1540
    - `taskCmd`: :1648
  - `PHASE_ORDER`: `src/orchestrator/types.ts`
  - private `SIZE_ORDER`: `src/lib/pipeline-policy.ts:121`
  - golden pattern: `tests/run-task-prompts.test.ts:183-226`
  - `runCanonCliIn`: `tests/cli.test.ts:66`
  - `gitDirWritable`: `tests/run-task-safety.test.ts:3544`
  - `isAvailable`: `src/cli/deps.ts:18`
  - the "mentions watch" test: `tests/cli.test.ts:1061`
  - the declaration list: `tests/cli-args.test.ts:49`
- **Real path:**
  - At runtime: `dist/cli/index.js`, then `switch (command)`, then the new `case 'completion'`, then `completionCmd(args, COMMAND_REGISTRY)`. That calls `handlePreScan(COMPLETION_ARGS, …)`, then `buildCompletionModel`, then `renderCompletion`, then stdout.
  - Nothing in canon does any of this today.
  - `taskCmd` already runs `handlePreScan` for each `task` subcommand. That is unchanged, and `handlePreScan` ignores `completion`.
- **Callers:**
  - `assertValidPhase/Status/Verdict`: called only inside `src/task/index.ts` (`taskPhase`, `taskPhasePreflightRejected`, `taskAccept`). Exporting them changes no contract.
  - `parseUpdateArgs`: called from `updateCmd` and tests. Same contract and byte-identical message.
  - `taskAccept`: called from `taskCmd` and tests. Same message.
  - `taskSetValue`: called only by `taskSet`.
  - `SIZE_ORDER`: becomes exported; `compareTaskSize` is unchanged.
- **Tests that can fail:**
  - AC-6(a) synthetic model: a renderer that skips `valueFlags` or subcommands omits `--zz-value` / `zz-sub`.
  - AC-6(b): a hand-added `'--bogus'` in a renderer is neither a model flag nor allowlisted.
  - AC-9 rows:
    - `task phase alpha plan done ` exercises the verdict gate (`plan` is not a review phase);
    - `watch --until plan ` exercises value-flag skipping (a miscount would offer phases);
    - `task accept alpha --reason x ` exercises the variadic slot plus value-flag skipping.
  - AC-4: the subdirectory and linked-worktree cases fail if a renderer uses `--show-toplevel` or a cwd-relative `tasks/`. The linked worktree has no `tasks/` of its own because `tasks/` is untracked in the fixture.
  - AC-1a: the existing pinned-message tests (`tests/cli.test.ts:523-524`, `tests/task-cli.test.ts:1367`) fail if the error text drifts.
- **Predicates:**
  - `--channel` check: `value` may be `undefined` (missing), `''`, or `'main'`. Use `value === undefined || !UPDATE_CHANNELS.includes(value)`. The message still prints `value ?? '(missing)'`.
  - Accept phase: runs after `assertValidPhase`, so only real phases reach it.
  - `task_size`: the value is a case-sensitive exact match, as today.
  - Booleans: compare the `toLowerCase()`d value against the record, as today. `TRUE` still passes.
  - Shell arg: missing; empty string (`canon completion ''` is an unknown shell); dash-prefixed in slot 0 (`freeTextSlots: [0]` lets preScan pass it, so `completionCmd` must report it as an unknown option); a second positional (preScan `unexpected`).
  - Positional counting in scripts: an empty current word; a value flag as the last completed word (complete its value); `--flag=value` for equals flags; an unknown dash word (not counted, except in a free-text slot, as in `preScanArgs`); `-h`/`--help` (counted only in a free-text slot).
  - Task-id glob: no matches; `_`/`.` prefixes; non-directories; bash `failglob`/`nullglob` user options.
- **Scope:** every file below is in the spec's Affected Files. `src/cli/registry.ts` keeps the spec's default path.
- **Async/stateful:** N/A. The command is synchronous and stateless, and the scripts are static.

## Steps

### Step 1: Completion types on `ArgDeclaration`

File: `src/lib/cli-args.ts`

Add these types and the optional field. `preScanArgs` and `handlePreScan` stay unchanged.

```ts
export type CompletionValueKind =
    | 'taskId' | 'phase' | 'phaseStatus' | 'reviewVerdict' | 'acceptPhase'
    | 'settableField' | 'fieldValue' | 'taskSize' | 'updateChannel' | 'shell' | 'none';
export interface CompletionSlot { kind: CompletionValueKind; variadic?: boolean }
export interface ArgCompletion {
    /** Ordered positional slots. At most one is variadic; fixed slots may follow it. */
    positionals?: readonly CompletionSlot[];
    /** Value kind per value flag; unlisted value flags are 'none'. */
    valueFlags?: Readonly<Record<string, CompletionValueKind>>;
}
// ArgDeclaration gains:  completion?: ArgCompletion;
```

The two dependent kinds take their context from a governing slot elsewhere in the same declaration:

- `reviewVerdict` reads the word in the slot of kind `phase`;
- `fieldValue` reads the word in the slot of kind `settableField`.

The model builder resolves the governing slot's index (Step 5). The declarations only name kinds.

### Step 2: Export value sets; inline checks read them (AC-1, AC-1a)

1. `src/lib/pipeline-policy.ts:121`: `export const SIZE_ORDER`. No other change.
2. `src/cli/commands/update.ts`:
   - Add `export const UPDATE_CHANNELS = ['main'] as const;`.
   - In `parseUpdateArgs`, replace the comparison with `if (value === undefined || !(UPDATE_CHANNELS as readonly string[]).includes(value))`. Keep the error string byte-identical, and keep `options.channel = 'main'`. Typing it as `value as UpdateOptions['channel']` is fine too.
   - Add to `UPDATE_ARGS`: `completion: { valueFlags: { '--channel': 'updateChannel' } }`.
3. `src/task/index.ts`:
   - Delete `TASK_SIZE_VALUES`, and import `SIZE_ORDER` from `../lib/pipeline-policy.js`.
   - Add these exports:

     ```ts
     export const ACCEPT_PHASES = ['implement', 'spec_review', 'code_review'] as const;
     const BOOLEAN_VALUES = ['true', 'false'] as const;
     export const TASK_SET_FIELD_VALUES: Readonly<Partial<Record<(typeof SETTABLE_FIELDS)[number], readonly string[]>>> = {
         task_size: SIZE_ORDER, delicate: BOOLEAN_VALUES, worktree: BOOLEAN_VALUES, human_spec_gate: BOOLEAN_VALUES,
     };
     ```

   - `taskAccept`: replace the `phaseArg !== 'implement' && …` chain with `if (!(ACCEPT_PHASES as readonly string[]).includes(phaseArg))`. The thrown message stays byte-identical.
   - `taskSetValue`:
     - `task_size`: `if (!TASK_SET_FIELD_VALUES.task_size?.includes(value))`;
     - `delicate`/`worktree` and `human_spec_gate`: `if (!TASK_SET_FIELD_VALUES[field]?.includes(normalized))`.

     Messages stay unchanged.
   - Export `assertValidPhase`, `assertValidStatus`, `assertValidVerdict`. Only `export` is added; the bodies are unchanged.
4. Verify by grep: `grep -rn "TASK_SIZE_VALUES\|phaseArg !== 'implement'\|value !== 'main'" src/` returns nothing.

### Step 3: Completion metadata on the declarations (AC-1)

- `src/orchestrator/cli.ts` `RUN_ARGS`: add a new line after `valueFlags`, so `HINT_SITES` is untouched.

  ```ts
      completion: { positionals: [{ kind: 'taskId', variadic: true }], valueFlags: { '--expect': 'phase' } },
  ```

- `src/cli/commands/watch.ts` `WATCH_ARGS`: `completion: { positionals: [{ kind: 'taskId' }], valueFlags: { '--until': 'phase' } }`. `--timeout` is unlisted, so it is `none`.
- `src/cli/commands/stop.ts` `STOP_ARGS`: `completion: { positionals: [{ kind: 'taskId' }] }`.
- `src/task/index.ts` `TASK_SUBCOMMAND_ARGS`, with the metadata appended inline before the closing ` }`:
  - `status`, `reset-spec-review`, `reset-code-review`: `completion: { positionals: [{ kind: 'taskId' }] }`
  - `phase`: positionals `taskId, phase, phaseStatus, reviewVerdict`
  - `accept`: `[{ kind: 'taskId', variadic: true }, { kind: 'acceptPhase' }]`
  - `set`: `taskId, settableField, fieldValue`
- `tests/recovery-hints.test.ts`: shorten the four snippets per Approach decision 3. Run that test file to confirm each snippet still matches exactly one line.

### Step 4: Command registry (AC-3)

New file `src/cli/registry.ts`. It holds only imports and `const`s, with no top-level calls.

```ts
export interface RegistryCommand { name: string; decl: ArgDeclaration; subcommands?: Readonly<Record<string, ArgDeclaration>> }
export const COMMAND_REGISTRY: readonly RegistryCommand[] = [
    { name: 'init', decl: INIT_ARGS }, { name: 'doctor', decl: DOCTOR_ARGS },
    { name: 'task', decl: TASK_ARGS, subcommands: TASK_SUBCOMMAND_ARGS },
    { name: 'run', decl: RUN_ARGS }, { name: 'watch', decl: WATCH_ARGS }, { name: 'stop', decl: STOP_ARGS },
    { name: 'update', decl: UPDATE_ARGS }, { name: 'upgrade', decl: UPGRADE_ARGS },
    { name: 'completion', decl: COMPLETION_ARGS },
];
export const GLOBAL_FLAGS = ['--help', '-h', '--version', '-v'] as const;
```

It imports from the modules listed under "Exists". `src/cli/index.ts` already loads all of them transitively, so the bundle does not grow. Add a short header comment saying this module must stay free of side effects because tests import it, and `src/cli/index.ts` dispatches on argv at import.

### Step 5: `src/cli/commands/completion.ts` — command, model, renderers

**Exports:**

- `COMPLETION_SHELLS = ['bash', 'zsh', 'fish', 'tcsh'] as const` and the type `CompletionShell`.
- `COMPLETION_USAGE`. It starts with `Usage: canon completion <bash|zsh|fish|tcsh>` and continues with a one-sentence description and these install lines:
  - bash: `eval "$(canon completion bash)"` in `~/.bashrc`
  - zsh: `eval "$(canon completion zsh)"` in `~/.zshrc`, **after** `compinit`
  - fish: `canon completion fish | source` in `~/.config/fish/config.fish`
  - tcsh: `canon completion tcsh > ~/.canon-completion.tcsh` once, then `source ~/.canon-completion.tcsh` in `~/.tcshrc`, with a note that a multi-line script does not survive backtick `eval`

  Do not mention canon-ai source paths (AC-11).
- `COMPLETION_ARGS: ArgDeclaration = { command: 'completion', usage: COMPLETION_USAGE, booleanFlags: [], valueFlags: [], rejectPositionals: true, freeTextSlots: [0], completion: { positionals: [{ kind: 'shell' }] } }`.

**Model.** Import value sets from `../../orchestrator/types.js` (`PHASE_ORDER`), `../../task/index.js` (`VALID_STATUSES`, `VALID_VERDICTS`, `ACCEPT_PHASES`, `SETTABLE_FIELDS`, `TASK_SET_FIELD_VALUES`), `../../lib/pipeline-policy.js` (`SIZE_ORDER`), and `./update.js` (`UPDATE_CHANNELS`). Use a type-only import of `RegistryCommand` from `../registry.js`; it is erased, so there is no runtime cycle.

```ts
export interface CompletionCommandModel {
    path: string[];                 // ['run'] or ['task','phase']
    flags: string[];                // boolean ∪ value ∪ equalsValue ∪ ['--help','-h'], de-duplicated, declaration order
    booleanFlags: string[]; valueFlags: string[]; equalsValueFlags: string[];
    valueFlagKinds: Record<string, CompletionValueKind>;   // every valueFlag; default 'none'
    positionals: CompletionSlot[]; freeTextSlots: number[];
    dependsOn: Record<number, number>;  // slot index → governing slot index (reviewVerdict→phase, fieldValue→settableField)
    subcommands?: CompletionCommandModel[];
}
export interface CompletionModel {
    commands: CompletionCommandModel[]; globalFlags: string[];
    values: Record<Exclude<CompletionValueKind, 'taskId'|'none'|'reviewVerdict'|'fieldValue'>, string[]>;
    verdictsByPhase: Record<string, string[]>;   // code_review: VALID_VERDICTS − sanctioned; spec_review: also − spec_gap
    valuesByField: Record<string, string[]>;     // from TASK_SET_FIELD_VALUES
}
export function buildCompletionModel(registry: readonly RegistryCommand[], globalFlags: readonly string[]): CompletionModel
export function renderCompletion(shell: CompletionShell, model: CompletionModel): string
export function completionCmd(args: string[], registry: readonly RegistryCommand[], globalFlags: readonly string[], deps?: { stdout?; stderr?; exit? }): void
```

**Renderers** read only the model. Every flag, command, subcommand, and value literal in a script comes from the model. The only hand-written tokens are shell syntax and the `git rev-parse` flags `--path-format` and `--git-common-dir`. This is what keeps AC-6(b) green.

**`completionCmd`** follows the `deps` style in `stop.ts`/`update.ts`:

1. `handlePreScan(COMPLETION_ARGS, args, io)`. This handles help (exit 0), a second positional (`unexpected`, exit 1), and an unknown flag in slot ≥ 1 (exit 1).
2. Shell missing: stderr `Missing shell. Expected one of: bash, zsh, fish, tcsh.\nRun 'canon completion --help' for usage.`, exit 1.
3. Shell starts with `-`: `unknownOptionMessage('completion', shell)`, exit 1.
4. Not in `COMPLETION_SHELLS` (including `''`): `Unknown shell: <x>. Expected one of: bash, zsh, fish, tcsh.\nRun 'canon completion --help' for usage.`, exit 1.
5. Otherwise write `renderCompletion(...)` (ending with exactly one `\n`) to stdout. Exit 0, or just return.

Never touch the filesystem, never read `process.cwd()`, and add no version or timestamp.

**Script contract**, shared by bash, zsh, and fish (the interpreter in each shell's idiom):

- `_canon_candidates WORD...` (fish: `__canon_candidates`, reading `commandline -opc` plus `commandline -ct`). It gets the words from `canon` through the current, possibly empty, word, and prints the **unfiltered** candidates one per line. The wrapper filters by prefix: `compgen -W` in bash, `compadd` in zsh, fish natively.
- **Algorithm:**
  1. Resolve the command path:
     - position 1 is the command;
     - if that command has subcommands and position 2 is complete, position 2 is the subcommand.
     - When the current word is the command slot, offer the commands, or the global flags if the current word starts with `-`.
     - When it is the subcommand slot, offer the `task` subcommands, or the `task` flags if it starts with `-`.
     - An unknown command or subcommand offers nothing.
  2. Walk the completed words after the path, as in `preScanArgs`:
     - `--help`/`-h`: counted as a positional only if the current position is a free-text slot;
     - a boolean flag: skip;
     - a value flag: skip it and its argument. If the value flag is the **last completed word**, the current word is its value: offer its kind's values and stop;
     - `X=…` where `X` is an equals-value flag: skip;
     - another `-…` word: skip, unless the current position is a free-text slot, in which case it counts;
     - anything else: record it as positional `p`, then increment.
  3. Current word starts with `-`: offer this command's `flags`.
  4. Otherwise pick the slot kinds for position `p`. With no variadic slot, use `slots[p]`. With a variadic slot at `v`:
     - `p < v`: `slots[p]`;
     - `p == v`: `slots[v]`;
     - `p > v`: `slots[v]` ∪ `slots[v+1]` (if any).

     That gives `accept`: position 0 offers ids, position ≥ 1 offers ids and accept phases.
  5. Map kinds to values:
     - `taskId`: the lookup function;
     - `reviewVerdict`: `verdictsByPhase[positional[dependsOn[i]]]`, or nothing;
     - `fieldValue`: `valuesByField[positional[dependsOn[i]]]`, or nothing;
     - `none`: nothing;
     - anything else: `model.values[kind]`.
- **Task ids**, written into each script and silent on every failure:
  - bash, run in a subshell so user glob options can't leak or error:
    `( common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0; root=${common%/*}; [ -d "$root/tasks" ] || exit 0; shopt -s nullglob; shopt -u failglob 2>/dev/null; for d in "$root"/tasks/*/; do d=${d%/}; n=${d##*/}; case $n in _*|.*) continue;; esac; printf '%s\n' "$n"; done )`.
  - zsh: `emulate -L zsh`, then the same `git` call, then `for d in $root/tasks/*(N/)`, filtering `_*`/`.*`.
  - fish: `set -l common (command git rev-parse … 2>/dev/null); or return 0`. Use `string replace -r '/[^/]*$' ''` for the parent and `for d in $root/tasks/*/`. Fish allows an unmatched glob in `for`. Use `string` rather than `path`, for fish 3.0.
- **bash specifics, which must run under 3.2:**
  - `_canon()` builds the words from `COMP_WORDS[0..COMP_CWORD]`. It **rejoins `X` `=` `Y` triples into `X=Y`**, because `COMP_WORDBREAKS` contains `=`; without this, `--timeout=5s` would miscount. If the current word is `=` or follows `=`, it offers nothing.
  - It then runs `local IFS=$'\n'; COMPREPLY=( $(compgen -W "$(_canon_candidates "${words[@]}")" -- "$cur") )`.
  - Register with `complete -F _canon canon`.
  - Avoid `declare -A`, `mapfile`/`readarray`, `${x,,}`, `compopt`, `[[ -v ]]`, and negative array indices. Use `case`-based lookup functions for per-path data.
- **zsh specifics:**
  - `_canon() { local -a c; c=("${(@f)$(_canon_candidates "${(@)words[1,CURRENT]}")}"); c=(${c:#}); compadd -a c }`.
  - Last lines: `if (( $+functions[compdef] )); then compdef _canon canon; else print -u2 'canon completion: compdef not found; load compinit before this line'; fi`. Keep it an if/else ending with status 0. Do not use a top-level `return`, because the script runs under `eval`.
- **fish specifics:** `complete -c canon -f -a '(__canon_candidates)'`. Flags are emitted as candidates, so their `--long` literals appear in the script (AC-6a). Use short builtin options (`-c`, `-f`, `-a`, `-r`, `-q`) so no unlisted `--long` tokens appear.
- **tcsh:**
  - A single `complete canon` with patterns in this order:
    1. `'p/1/(<commands> <global flags>)/'`
    2. `'C/-/`awk …`/'`, the current command's flags
    3. `'n/task/(<subcommands>)/'`
  - The awk program is one line. It must contain no `!` (tcsh history expansion), no `$` field references, and no newlines. It splits `ENVIRON["COMMAND_LINE"]` on spaces into `w`, treats `w[2]` as the command and `w[3]` as the subcommand when the command has subcommands, and prints that path's `flags`. For `task` with no known subcommand it prints the `task` flags. For an unknown command, or when `w[2]` itself starts with `-`, it prints the global flags.
  - Single quotes inside the tcsh single-quoted word are spliced with `'\''`.
  - Export a helper `tcshFlagProgram(model): string` so tests can run the awk program directly (Step 7).
- **Comments:** keep them minimal. Never write `node`, `npx`, a backtick followed by `canon`, `$(canon`, `src/`, `tests/`, or `BACKLOG` in a script (AC-5, AC-11). For example, write "Generated by canon's completion command." and not "Generated by `canon completion bash`".

### Step 6: Wire the CLI (AC-2, AC-3)

File: `src/cli/index.ts`

- Import `COMMAND_REGISTRY` and `GLOBAL_FLAGS` from `./registry.js`, and `completionCmd` from `./commands/completion.js`.
- Add `case 'completion': completionCmd(args, COMMAND_REGISTRY, GLOBAL_FLAGS); break;`.
- In `printHelp`, add `  completion <shell>  Print a shell completion script` after `upgrade`. The description starts at column 21, as on the other lines.

### Step 7: Tests

**`tests/completion.test.ts`** (new):

- **AC-1:**
  - `deepEqual` each listed declaration's `completion` against the expected slots and kinds: `RUN_ARGS`, `WATCH_ARGS`, `STOP_ARGS`, `UPDATE_ARGS`, `COMPLETION_ARGS`, and the `TASK_SUBCOMMAND_ARGS` entries `status`, `phase`, `accept`, `set`, `reset-*`.
  - Every `completion.valueFlags` key is in that declaration's `valueFlags`.
  - At most one slot is variadic.
  - `SIZE_ORDER` deep-equals `['XS','S','M','L','XL']`.
- **AC-2:** a `runCli(cwd, args)` helper mirroring `runCanonCliIn` (`tests/cli.test.ts:66`), run in `fs.mkdtempSync` dirs with no git and no `.canon`:
  - each shell: exit 0 and non-empty stdout;
  - `--help`, `-h`, and `bash -h`: exit 0, and the usage contains all four shells plus each install line, including "after compinit" and the tcsh `source` form;
  - missing shell, `powershell`, `bash zsh`, `--bogus`, `bash --bogus`: exit 1, with the last stderr line `Run 'canon completion --help' for usage.` and exactly two stderr lines;
  - two runs produce byte-identical stdout, which contains neither the temp path nor the version string;
  - the temp dir is still empty afterwards.
- **AC-5:** none of the four scripts matches `/\b(node|npx)\b|\$\(\s*canon\b|`\s*canon\b/`.
- **AC-11:** neither the usage nor any script matches `/\bsrc\/|\btests\/|BACKLOG/`.
- **AC-6:**
  - (a) For each shell, every token in scope appears in the rendered script. Scope for bash, zsh, and fish: commands, `task` subcommands, every model command's `flags`, and the global flags. Scope for tcsh: the same set (commands, subcommands, flags). Run this on the real model, and on a synthetic model built from `[...COMMAND_REGISTRY` plus `{ name: 'zz-cmd', decl: { command: 'zz-cmd', usage: 'Usage: canon zz-cmd', booleanFlags: ['--zz-bool'], valueFlags: ['--zz-value'], equalsValueFlags: ['--zz-eq'] } }`. Swap the `task` entry for one whose `subcommands` adds `'zz-sub'`.
  - (b) Collect `/--[A-Za-z][\w-]*/g` from each real script. Each match must be a model flag (including the global flags) or on that shell's allowlist (`--path-format`, `--git-common-dir` for bash, zsh, and fish; empty for tcsh, unless implementation proves otherwise and the reason is recorded). Also assert that every command and subcommand name in the model comes from the registry or a declaration.
- **AC-7:**
  - `parseWatchArgs(['foo','--until',p]).usageError === null` for each `PHASE_ORDER` value.
  - `assertValidPhase` and `assertValidStatus` accept every offered phase and status. `assertValidVerdict(phase, v)` accepts each value in `verdictsByPhase[phase]` for both review phases.
  - For each `ACCEPT_PHASES` value, call `taskAccept(['zz-missing'], phase)` inside a temp `CANON_TASKS_DIR_OVERRIDE`. The phase check runs before any task lookup (`src/task/index.ts:605-612`). Catch the error and assert it does **not** match `/supports implement, spec_review, and code_review/`.
  - `parseUpdateArgs(['--channel', c])` does not throw.
  - Every shell renders.
  - `task set`:
    1. Copy `.canon/templates/status.json` into `<tmp>/tasks/zz-task/status.json`, setting `id`, `branch: ''`, and `delicate: false`.
    2. With `CANON_TASKS_DIR_OVERRIDE` set, call `taskSet(['zz-task', field, value])` for every value. Iterate `human_spec_gate` before `delicate`.
    3. Assert `SETTABLE_FIELDS` equals the record keys ∪ `['title', 'base_branch']`, the explicit free-text list.
- **AC-8:** goldens use the `recordOrAssert` pattern from `tests/run-task-prompts.test.ts:183-226`, with keys `bash`, `zsh`, `fish`, `tcsh` in `tests/completion.golden.json`. Generate with `UPDATE_GOLDENS=1 npm test`. Neutral content only; the scripts don't depend on the fixture.
- **AC-9, syntax:**
  - `bash -n`, `zsh -n`, `fish --no-execute`, `tcsh -f -n` on each script written to a temp file.
  - Detect each shell with a local `which` probe (mirror `isAvailable`). Use `{ skip: 'zsh not installed' }` when absent, but when `process.env.CI` is set, fail with a message instead of skipping.
  - When tcsh is present, also run `tcsh -f -c 'source <file>; complete canon'` and assert exit 0 with `canon` in the output.
- **AC-9, tcsh flag program:** when `awk` is present, run `awk <tcshFlagProgram(model)>` with env `COMMAND_LINE='canon run --'`. Expect `--pr`, and no `--channel`. Repeat with `'canon task accept a --'`, which should give `--reason`.
- **AC-4 / AC-9 fixture**, built in `before()` in a temp dir:
  1. `git init -q`, set user config, commit a seed file.
  2. Create `tasks/alpha/`, `tasks/beta/`, `tasks/_archive/`, `tasks/.hidden/`, `tasks/plain-file`, and `sub/dir/`. Leave `tasks/` untracked.
  3. Probe `.git/` writability (local copy of the `gitDirWritable` shape). If writable, run `git worktree add --detach <tmp>/wt HEAD`.
- **AC-4 / AC-9 shell env:** `{ PATH: process.env.PATH, HOME: tmp, GIT_CEILING_DIRECTORIES: path.dirname(tmp) }`.
- **AC-4 / AC-9 bash smoke**, for each of `bash` (if present), and `/bin/bash` when `/bin/bash --version` reports 3.x:
  - `bash --norc --noprofile -c '. "$1"; shift; COMP_WORDS=("$@"); COMP_CWORD=$(( $# - 1 )); _canon; printf "%s\n" "${COMPREPLY[@]}"' _ <script> canon run ''`.
  - Run from the fixture root for every table row.
  - Run from root, `sub/dir`, and `wt` for `canon run ''`. The `wt` case uses `{ skip }` when the probe failed.
  - Run from a non-git temp dir and from a git repo without `tasks/`. Expect empty stdout **and** empty stderr.
  - Sort the output before exact comparisons.
- **AC-4 / AC-9 zsh smoke:**
  - `zsh -f -c 'compdef() { :; }; . "$1"; shift; _canon_candidates "$@"' _ <script> canon run ''`, filtering by the current-word prefix in the test.
  - Same rows and the same directory cases as bash.
- **AC-4 / AC-9 table rows:** exactly the spec's AC-9 table.
- **AC-9, `compdef` missing:** `zsh -f -c '. "$1"' _ <script>` gives exit 0 and stderr exactly `canon completion: compdef not found; load compinit before this line\n`.

**`tests/cli.test.ts`:**

- Add `'completion'` to the loop at :1064.
- New test: run `canon --help` and take the lines after `Commands:` up to the first blank line. The first word of each line, as a set, must equal `new Set(COMMAND_REGISTRY.map(c => c.name))`, compared in both directions.

**`tests/cli-args.test.ts:49`:** append `COMPLETION_ARGS` to `declarations`, imported from `../src/cli/commands/completion.ts`. It has no flags, so the adapter loop needs no branch. Add `preScanArgs(COMPLETION_ARGS, ['bash']).kind === 'proceed'` and `['bash','zsh']` → `'unexpected'`.

### Step 8: CI and docs (AC-10, AC-13)

- `.github/workflows/ci.yml`: before `- run: npm test`, add

  ```yaml
  - name: Install shells for completion tests
    run: sudo apt-get update && sudo apt-get install -y zsh fish tcsh
  ```

- `README.md`:
  - After the `### Install` section (before `### Set up in a repo`, :127), add `### Shell completion` with the four install lines from Step 5, the note that zsh's line goes after `compinit`, and the tcsh two-step.
  - Add a Key commands row (:264 table): `` | `canon completion <shell>` | Print a completion script for bash, zsh, fish, or tcsh; see Shell completion. | ``.
- `docs/product-context.md:127`: the command list `(init, doctor, upgrade, update, run, task, watch, stop)` gains `completion`.
- `docs/codebase-map.md`:
  - Add rows for `src/cli/commands/completion.ts` (the `canon completion` command, model builder, and four renderers) and `src/cli/registry.ts` (side-effect-free command registry and global flags).
  - Mention the registry import in the `src/cli/index.ts` row (:46).
  - Add a `tests/completion.test.ts` row next to `tests/cli-args.test.ts` (:131).
- `docs/architecture.md`:
  - :32: add "installs `zsh fish tcsh` via apt" to the CI list, before `npm test`.
  - :157: insert `apt install zsh fish tcsh` before `npm test` in the arrow chain. The chain currently ends `npm run build → npm test`, so match that order.
- `docs/BACKLOG.md:478-484`: replace the whole entry with a single unchecked item, the `util.parseArgs` follow-up: migrate each parser to Node's `util.parseArgs`, driven by the shared `ArgDeclaration`s (flags plus the `completion` metadata), so help, parsing, and completion share one source. Note that this also closes the `watch` parser-only-flag gap.

### Step 9: Build and validate

`npm run build`, which rebuilds `dist/cli/index.js` and `dist/orchestrator/run-task.js`. Then run `npm run lint && npm run type-check && npm test && npm run docs-refs-check && npm run sync-templates:check`.

The **handoff** must record:

1. The AC-6 failure demonstrations, run and then reverted:
   - (a) a renderer temporarily skipping `valueFlags` fails the synthetic-model test;
   - (b) a hand-added `'--bogus-flag'` in the bash renderer fails the allowlist test.
2. Which shell checks ran and which skipped, and why. Skipped means unverified, per Known Risks. fish is absent on the planner's machine, so the fish checks rely on CI.
3. Whether the `/bin/bash` 3.2 run happened.
4. Whether the linked-worktree case ran.

## Testing Plan

- **Unit:** `tests/completion.test.ts` (new); `tests/cli.test.ts`, `tests/cli-args.test.ts`, `tests/recovery-hints.test.ts` (four snippet edits). The existing `tests/task-cli.test.ts` and `tests/cli.test.ts` pinned messages must pass unchanged (AC-1a).
- **Shell:** syntax checks and the bash/zsh smoke tests are inside `tests/completion.test.ts`. CI installs zsh, fish, and tcsh.
- **E2E:** N/A, no UI.

## Notes for implement

- `src/` must keep the tokens `--reroute`, `reset-code-review`, `reset-spec-review`, and `canon task accept` out of `completion.ts` and `registry.ts`, including comments. The `recovery-hints` scan would otherwise demand new `HINT_SITES` entries. Renderers get subcommand names from the declarations.
- fish candidate flags: this plan assumes fish offers `-a` candidates that begin with `-` when the token starts with `-`. If CI or a manual check shows otherwise, add per-path `complete -c canon -n '<cond>' -a '<flags>'` lines that still carry the literal `--flag` tokens. Do not switch to `-l name`, which would drop the literals AC-6(a) checks. Record the outcome in the handoff.
