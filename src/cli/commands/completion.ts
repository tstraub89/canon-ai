import { handlePreScan, type ArgDeclaration, type CompletionSlot, type CompletionValueKind, unknownOptionMessage } from '../../lib/cli-args.js';
import { SIZE_ORDER } from '../../lib/pipeline-policy.js';
import { PHASE_ORDER } from '../../orchestrator/types.js';
import { ACCEPT_PHASES, SETTABLE_FIELDS, TASK_SET_FIELD_VALUES, VALID_STATUSES, VALID_VERDICTS } from '../../task/index.js';
import { UPDATE_CHANNELS } from './update.js';
import type { RegistryCommand } from '../registry.js';

export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish', 'tcsh'] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];
export const COMPLETION_USAGE = [
    'Usage: canon completion <bash|zsh|fish|tcsh>', '', 'Print a shell completion script for canon.',
    'Install in bash by adding this line to ~/.bashrc:', '  eval "$(canon completion bash)"',
    'Install in zsh by adding this line to ~/.zshrc after compinit:', '  eval "$(canon completion zsh)"',
    'Install in fish by adding this line to ~/.config/fish/config.fish:', '  canon completion fish | source',
    'For tcsh, write the script once with `canon completion tcsh > ~/.canon-completion.tcsh`, then add `source ~/.canon-completion.tcsh` to ~/.tcshrc. A multi-line script does not survive backtick eval.',
].join('\n');
export const COMPLETION_ARGS: ArgDeclaration = { command: 'completion', usage: COMPLETION_USAGE, booleanFlags: [], valueFlags: [], rejectPositionals: true, freeTextSlots: [0], completion: { positionals: [{ kind: 'shell' }] } };

export interface CompletionCommandModel {
    path: string[]; flags: string[]; booleanFlags: string[]; valueFlags: string[]; equalsValueFlags: string[];
    valueFlagKinds: Record<string, CompletionValueKind>; positionals: CompletionSlot[];
    dependsOn: Record<number, number>; subcommands?: CompletionCommandModel[];
}
export interface CompletionModel {
    commands: CompletionCommandModel[]; globalFlags: string[];
    values: Record<Exclude<CompletionValueKind, 'taskId'|'none'|'reviewVerdict'|'fieldValue'>, string[]>;
    verdictsByPhase: Record<string, string[]>; valuesByField: Record<string, string[]>;
}

function modelCommand(name: string, decl: ArgDeclaration, path: string[], subcommands?: Readonly<Record<string, ArgDeclaration>>): CompletionCommandModel {
    const slots = [...(decl.completion?.positionals ?? [])];
    const phase = slots.findIndex(s => s.kind === 'phase');
    const field = slots.findIndex(s => s.kind === 'settableField');
    const variadicIndex = slots.findIndex(s => s.variadic);
    if (variadicIndex >= 0 && slots.length - variadicIndex > 2) {
        throw new Error(`Completion declaration ${path.join(' ')} has more than one fixed positional slot after a variadic slot`);
    }
    const dependsOn: Record<number, number> = {};
    slots.forEach((slot, i) => { if (slot.kind === 'reviewVerdict' && phase >= 0) dependsOn[i] = phase; if (slot.kind === 'fieldValue' && field >= 0) dependsOn[i] = field; });
    return {
        path, flags: [...new Set([...decl.booleanFlags, ...decl.valueFlags, ...(decl.equalsValueFlags ?? []), '--help', '-h'])],
        booleanFlags: [...decl.booleanFlags], valueFlags: [...decl.valueFlags], equalsValueFlags: [...(decl.equalsValueFlags ?? [])],
        valueFlagKinds: Object.fromEntries([...new Set([...decl.valueFlags, ...(decl.equalsValueFlags ?? [])])].map(f => [f, decl.completion?.valueFlags?.[f] ?? 'none'])),
        positionals: slots, dependsOn,
        ...(subcommands ? { subcommands: Object.entries(subcommands).map(([sub, d]) => modelCommand(sub, d, [...path, sub])) } : {}),
    };
}

export function buildCompletionModel(registry: readonly RegistryCommand[], globalFlags: readonly string[]): CompletionModel {
    const verdictsByPhase: Record<string, string[]> = {
        spec_review: [...VALID_VERDICTS].filter(v => v !== 'sanctioned' && v !== 'spec_gap'),
        code_review: [...VALID_VERDICTS].filter(v => v !== 'sanctioned'),
    };
    return {
        commands: registry.map(c => modelCommand(c.name, c.decl, [c.name], c.subcommands)), globalFlags: [...globalFlags],
        values: {
            phase: [...PHASE_ORDER], phaseStatus: [...VALID_STATUSES], acceptPhase: [...ACCEPT_PHASES],
            settableField: [...SETTABLE_FIELDS], taskSize: [...SIZE_ORDER], updateChannel: [...UPDATE_CHANNELS], shell: [...COMPLETION_SHELLS],
        }, verdictsByPhase, valuesByField: Object.fromEntries(Object.entries(TASK_SET_FIELD_VALUES).map(([k,v]) => [k, [...(v ?? [])]])),
    };
}

function q(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }
function taskCmd(model: CompletionModel): CompletionCommandModel | undefined { return model.commands.find(c => c.path[0] === 'task'); }
function records(model: CompletionModel): CompletionCommandModel[] {
    return model.commands.flatMap(c => [c, ...(c.subcommands ?? [])]);
}
function positionalAction(kind: CompletionValueKind, record: CompletionCommandModel, slotIndex: number, shell: 'bash' | 'zsh' | 'fish', model: CompletionModel): string {
    const print = (values: readonly string[]) => shell === 'fish'
        ? `string split ' ' -- ${q(values.join(' '))}`
        : shell === 'zsh' ? `items=${q(values.join(' '))}; print -l -- \${(s: :)items}` : `printf '%s\\n' ${values.map(q).join(' ')}`;
    if (kind === 'taskId') return shell === 'fish' ? '__canon_task_ids' : '_canon_task_ids';
    if (kind === 'reviewVerdict') {
        const dependency = record.dependsOn[slotIndex];
        const phaseRef = shell === 'bash' ? `\${positionals[${dependency}]}` : shell === 'zsh' ? `\${positionals[${dependency + 1}]}` : `$positionals[${dependency + 1}]`;
        const entries = Object.entries(model.verdictsByPhase).map(([phase, values]) => shell === 'fish'
            ? `case ${q(phase)}\n          ${print(values)}`
            : `${q(phase)}) ${print(values)} ;;`).join(shell === 'fish' ? '\n' : ' ');
        return shell === 'fish' ? `switch ${phaseRef}\n          ${entries}\n        end` : `case ${phaseRef} in ${entries} esac`;
    }
    if (kind === 'fieldValue') {
        const dependency = record.dependsOn[slotIndex];
        const fieldRef = shell === 'bash' ? `\${positionals[${dependency}]}` : shell === 'zsh' ? `\${positionals[${dependency + 1}]}` : `$positionals[${dependency + 1}]`;
        const entries = Object.entries(model.valuesByField).map(([field, values]) => shell === 'fish'
            ? `case ${q(field)}\n          ${print(values)}`
            : `${q(field)}) ${print(values)} ;;`).join(shell === 'fish' ? '\n' : ' ');
        return shell === 'fish' ? `switch ${fieldRef}\n          ${entries}\n        end` : `case ${fieldRef} in ${entries} esac`;
    }
    const values = model.values[kind as keyof CompletionModel['values']];
    return values ? print(values) : ':';
}
function valueFlagCaseEntries(model: CompletionModel, shell: 'bash' | 'zsh' | 'fish'): string {
    return records(model).flatMap(record => Object.entries(record.valueFlagKinds).map(([flag, kind]) => {
        const key = q(`${record.path.join(' ')}:${flag}`);
        return shell === 'fish'
            ? `case ${key}\n          set pending 1\n          set valKind ${kind}\n          set equalsAllowed ${record.equalsValueFlags.includes(flag) ? 1 : 0}\n          continue`
            : `${key}) pending=1; val=${kind}; equalsAllowed=${record.equalsValueFlags.includes(flag) ? 1 : 0}; continue ;;`;
    })).join(shell === 'fish' ? '\n        ' : ' ');
}
function equalsFlagCaseEntries(model: CompletionModel, shell: 'bash' | 'zsh' | 'fish'): string {
    return records(model).flatMap(record => record.equalsValueFlags.map(flag => {
        const prefix = q(`${record.path.join(' ')}:${flag}=`);
        return shell === 'fish'
            ? `case ${q(`${record.path.join(' ')}:${flag}=*`)}\n          continue`
            : `${prefix}*) continue ;;`;
    })).join(shell === 'fish' ? '\n        ' : ' ');
}
function valueKindCaseEntries(model: CompletionModel, shell: 'bash' | 'zsh' | 'fish'): string {
    const entries: Array<[string, readonly string[]]> = [...Object.entries(model.values), ['taskId', []]];
    return entries.map(([kind, values]) => {
        const taskIds = shell === 'fish' ? '__canon_task_ids' : '_canon_task_ids';
        if (kind === 'taskId') return shell === 'fish' ? `case ${kind}\n          ${taskIds}` : `${kind}) ${taskIds} ;;`;
        const action = shell === 'fish' ? `string split ' ' -- ${q(values.join(' '))}`
            : shell === 'zsh' ? `items=${q(values.join(' '))}; print -l -- \${(s: :)items}`
                : `printf '%s\\n' ${values.map(q).join(' ')}`;
        return shell === 'fish' ? `case ${kind}\n          ${action}` : `${kind}) ${action} ;;`;
    }).join(shell === 'fish' ? '\n        ' : ' ');
}
function positionalCaseEntries(model: CompletionModel, shell: 'bash' | 'zsh' | 'fish'): string {
    return records(model).flatMap(record => {
        const slots = record.positionals;
        const variadicIndex = slots.findIndex(slot => slot.variadic);
        if (variadicIndex >= 0 && variadicIndex === slots.length - 1) {
            const action = positionalAction(slots[variadicIndex].kind, record, variadicIndex, shell, model);
            const path = q(record.path.join(' '));
            return [shell === 'fish'
                ? `case ${q(`${record.path.join(' ')}:*`)}\n      if test $n -ge ${variadicIndex}\n        ${action}\n      end`
                : `${path}:*) if [ "$n" -ge ${variadicIndex} ]; then ${action}; fi ;;`];
        }
        if (variadicIndex >= 0 && variadicIndex < slots.length - 1) {
            const taskIds = positionalAction(slots[variadicIndex].kind, record, variadicIndex, shell, model);
            const trailing = slots.slice(variadicIndex + 1).map((slot, offset) => positionalAction(slot.kind, record, variadicIndex + offset + 1, shell, model));
            const path = q(record.path.join(' '));
            if (shell === 'fish') return [`case ${q(`${record.path.join(' ')}:*`)}\n      if test $n -le ${variadicIndex}\n        ${taskIds}\n      else\n        ${taskIds}\n        ${trailing.join('\n        ')}\n      end`];
            return [`${path}:*) if [ "$n" -le ${variadicIndex} ]; then ${taskIds}; else ${taskIds}; ${trailing.join('; ')}; fi ;;`];
        }
        return slots.map((slot, index) => {
            const action = positionalAction(slot.kind, record, index, shell, model);
            return shell === 'fish'
                ? `case ${q(`${record.path.join(' ')}:${index}`)}\n      ${action}`
                : `${q(`${record.path.join(' ')}:${index}`)}) ${action} ;;`;
        });
    }).join(shell === 'fish' ? '\n    ' : ' ');
}
function renderBash(model: CompletionModel): string {
    const task = taskCmd(model)!;
    const flags = records(model).map(c => `${q(c.path.join(' '))}) printf '%s\\n' ${c.flags.map(q).join(' ')} ;;`).join(' ');
    const valueFlags = valueFlagCaseEntries(model, 'bash');
    const equalsFlags = equalsFlagCaseEntries(model, 'bash');
    const valueKinds = valueKindCaseEntries(model, 'bash');
    const positionals = positionalCaseEntries(model, 'bash');
    return `# Generated by canon's completion command.
_canon_task_ids() { ( common=$(command git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0; root=\${common%/*}; [ -d "$root/tasks" ] || exit 0; shopt -s nullglob; shopt -u failglob 2>/dev/null; for d in "$root"/tasks/*/; do d=\${d%/}; n=\${d##*/}; case $n in _*|.*) continue;; esac; printf '%s\\n' "$n"; done ); }
_canon_candidates() {
  local cur="$1"; shift; local -a w=("$@") positionals=(); local cmd= sub= path= pending=0 val=none word n=0 equalsAllowed=0
  cmd=\${w[0]-}; sub=\${w[1]-}; path="$cmd"
  if [ "$cmd" = task ] && [ -n "$sub" ] && [[ "$sub" != -* ]]; then path="task $sub"; fi
  if [ -z "$cmd" ]; then if [[ "$cur" == -* ]]; then printf '%s\\n' ${model.globalFlags.map(q).join(' ')}; else printf '%s\\n' ${model.commands.map(c => q(c.path[0])).join(' ')}; fi; return; fi
  if [[ "$cur" == -* ]]; then case "$path" in ${flags} *) printf '%s\\n' ${model.globalFlags.map(q).join(' ')} ;; esac; return; fi
  if [ "$cmd" = task ] && [ -z "$sub" ]; then printf '%s\\n' ${(task.subcommands ?? []).map(c => q(c.path[1])).join(' ')}; return; fi
  shift; if [ "$cmd" = task ] && [ -n "$sub" ] && [[ "$sub" != -* ]]; then shift; fi
  for word in "$@"; do
    if [ "$pending" -eq 1 ]; then if [ "$word" = '=' ] && [ "$equalsAllowed" -eq 1 ]; then continue; fi; pending=0; val=none; equalsAllowed=0; if [ "$word" = '=' ]; then continue; fi; continue; fi
    case "$path:$word" in ${valueFlags} esac
    case "$path:$word" in ${equalsFlags} esac
    case "$word" in '=') continue;; -*) continue;; esac
    positionals+=("$word")
  done
  if [ "$pending" -eq 1 ]; then if [[ "$cur" == =* ]] && [ "$equalsAllowed" -ne 1 ]; then return; fi; case "$val" in ${valueKinds} esac; return; fi
  n=\${#positionals[@]}
  case "$path:$n" in ${positionals} *) : ;; esac
}
_canon() { local cur=\${COMP_WORDS[COMP_CWORD]} candidate; local -a words=(); COMPREPLY=(); local i; for ((i=1;i<COMP_CWORD;i++)); do words+=("\${COMP_WORDS[i]}"); done; while IFS= read -r candidate; do [[ $candidate == "$cur"* ]] && COMPREPLY+=("$candidate"); done < <(_canon_candidates "$cur" "\${words[@]}"); }
complete -F _canon canon
`;
}
function renderZsh(model: CompletionModel): string {
    const commands = q(model.commands.map(c => c.path[0]).join(' '));
    const task = taskCmd(model)!;
    const subs = q((task.subcommands ?? []).map(c => c.path[1]).join(' '));
    const flags = records(model).map(c => `${q(c.path.join(' '))}) items=${q(c.flags.join(' '))}; print -l -- \${(s: :)items} ;;`).join(' ');
    const valueFlags = valueFlagCaseEntries(model, 'zsh');
    const equalsFlags = equalsFlagCaseEntries(model, 'zsh');
    const valueKinds = valueKindCaseEntries(model, 'zsh');
    const positionals = positionalCaseEntries(model, 'zsh');
    return `# Generated by canon's completion command.
_canon_task_ids() { emulate -L zsh; local common root d n; common=$(command git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0; root=\${common%/*}; [[ -d $root/tasks ]] || return 0; for d in $root/tasks/*(/N); do n=\${d:t}; [[ $n == _* || $n == .* ]] && continue; print -r -- $n; done }
_canon_candidates() {
  emulate -L zsh; local cur=$1; shift; local -a w=("$@") positionals=(); local cmd sub cmdpath word val=none pending=0 n=0 items equalsAllowed=0
  cmd=\${w[1]-}; sub=\${w[2]-}; cmdpath=$cmd
  if [[ -z $cmd ]]; then if [[ $cur == -* ]]; then items=${q(model.globalFlags.join(' '))}; else items=${commands}; fi; print -l -- \${(s: :)items}; return; fi
  if [[ $cmd == task && -n $sub && $sub != -* ]]; then cmdpath="task $sub"; fi
  if [[ $cur == -* ]]; then case "$cmdpath" in ${flags} *) items=${q(model.globalFlags.join(' '))}; print -l -- \${(s: :)items};; esac; return; fi
  if [[ $cmd == task && -z $sub ]]; then items=${subs}; print -l -- \${(s: :)items}; return; fi
  if [[ $cmd == task && -n $sub && $sub != -* ]]; then shift; shift; else shift; fi
  for word in "$@"; do
    if (( pending )); then if [[ $word == = && $equalsAllowed == 1 ]]; then continue; fi; pending=0; val=none; equalsAllowed=0; if [[ $word == = ]]; then continue; fi; continue; fi
    case "$cmdpath:$word" in ${valueFlags} esac
    case "$cmdpath:$word" in ${equalsFlags} esac
    case $word in = ) continue;; -* ) continue;; esac
    positionals+=("$word")
  done
  if (( pending )); then if [[ $cur == \\=* && $equalsAllowed != 1 ]]; then return; fi; case $val in ${valueKinds} esac; return; fi
  n=\${#positionals[@]}
  case "$cmdpath:$n" in ${positionals} *) : ;; esac
}
_canon() { local -a c; c=("\${(@f)$(_canon_candidates "\${words[CURRENT]}" "\${(@)words[2,CURRENT-1]}")}"); c=(\${c:#}); compadd -a c }
if (( $+functions[compdef] )); then compdef _canon canon; else print -u2 'canon completion: compdef not found; load compinit before this line'; fi
`;
}
function renderFish(model: CompletionModel): string {
    const commands = q(model.commands.map(c => c.path[0]).join(' '));
    const globalFlags = q(model.globalFlags.join(' '));
    const task = taskCmd(model)!;
    const subcommands = q((task.subcommands ?? []).map(c => c.path[1]).join(' '));
    const flags = records(model).map(c => `case ${q(c.path.join(' '))}\n      string split ' ' -- ${q(c.flags.join(' '))}`).join('\n    ');
    const valueFlags = valueFlagCaseEntries(model, 'fish');
    const equalsFlags = equalsFlagCaseEntries(model, 'fish');
    const valueKinds = valueKindCaseEntries(model, 'fish');
    const positionals = positionalCaseEntries(model, 'fish');
    return `# Generated by canon's completion command.
function __canon_task_ids
  set -l common (command git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); or return 0
  set -l root (string replace -r '/[^/]*$' '' -- $common)
  test -d "$root/tasks"; or return 0
  for d in $root/tasks/*/
    set -l n (string replace -r '.*/' '' -- (string replace -r '/$' '' -- $d))
    string match -q -- '_*' $n; and continue
    string match -q -- '.*' $n; and continue
    printf '%s\\n' $n
  end
end
function __canon_candidates
  set -l cur
  set -l words
  if test (count $argv) -gt 0
    set cur $argv[1]
    set -e argv[1]
    set words canon $argv
  else
    set words (commandline -opc)
    set cur (commandline -ct)
  end
  set -l countWords (count $words)
  if test $countWords -le 1
    if string match -q -- '-*' $cur; string split ' ' -- ${globalFlags}; else string split ' ' -- ${commands}; end
    return
  end
  set -l cmd $words[2]
  set -l sub ''
  set -l cmdpath $cmd
  set -l wantsSubcommands 0
  if test "$cmd" = task
    if test $countWords -le 2
      set wantsSubcommands 1
    else if string match -q -- '-*' $words[3]
      set wantsSubcommands 1
    else
      set sub $words[3]
      set cmdpath "task $sub"
      set -e words[1..3]
    end
  else
    set -e words[1..2]
  end
  if string match -q -- '-*' $cur
    switch "$cmdpath"
      ${flags}
      case '*'
        string split ' ' -- ${globalFlags}
    end
    return
  end
  if test $wantsSubcommands -eq 1
    string split ' ' -- ${subcommands}
    return
  end
  set -l pending 0
  set -l equalsAllowed 0
  set -l valKind none
  set -l positionals
  for word in $words
    if test $pending -eq 1
      if test "$word" = '='; and test $equalsAllowed -eq 1; continue; end
      set pending 0
      set valKind none
      set equalsAllowed 0
      if test "$word" = '='; continue; end
      continue
    end
    switch "$cmdpath:$word"
        ${valueFlags}
    end
    switch "$cmdpath:$word"
        ${equalsFlags}
    end
    if test "$word" = '='; continue; end
    if string match -q -- '-*' $word; continue; end
    set positionals $positionals $word
  end
  if test $pending -eq 1
    if string match -q -- '=*' $cur; and test $equalsAllowed -ne 1; return; end
    switch $valKind
        ${valueKinds}
      case '*'
        true
    end
    return
  end
  set -l n (count $positionals)
  switch "$cmdpath:$n"
    ${positionals}
    case '*'
      true
  end
end
complete -c canon -f -a '(__canon_candidates)'
`;
}
export function tcshFlagProgram(model: CompletionModel): string {
    const rows = records(model).map(c=>`${c.path.join(' ')}\\t${c.flags.join(' ')}`).join('\\n').replace(/'/g, "'\\''");
    return `BEGIN { split("${rows.replace(/"/g,'\\"')}", lines, "\\n"); split(ENVIRON["COMMAND_LINE"], w, " "); cmd=w[2]; subcmd=w[3]; path=cmd; if (cmd == "task" && substr(subcmd,1,1) == "-") subcmd=""; if (cmd == "task" && subcmd != "") path=cmd " " subcmd; for (i in lines) { split(lines[i], row, "\\t"); if (row[1] == path) { print row[2]; exit } } if (cmd == "task" && subcmd == "") { print "${taskCmd(model)?.flags.join(' ')}"; exit } print "${model.globalFlags.join(' ')}" }`;
}
function renderTcsh(model: CompletionModel): string {
    const cmdNames = model.commands.map(c=>c.path[0]).join(' ');
    const task = taskCmd(model)!;
    const awk = tcshFlagProgram(model).replace(/[\r\n]/g, ' ').replace(/'/g, "'\\''");
    return `# Generated by canon's completion command.\ncomplete canon 'p/1/(${cmdNames} ${model.globalFlags.join(' ')})/' 'C/-/\`awk '\\''${awk}'\\''\`/' 'n/task/(${(task.subcommands ?? []).map(c=>c.path[1]).join(' ')})/'\n`;
}
export function renderCompletion(shell: CompletionShell, model: CompletionModel): string {
    const script = shell === 'bash' ? renderBash(model) : shell === 'zsh' ? renderZsh(model) : shell === 'fish' ? renderFish(model) : renderTcsh(model);
    return `${script.trimEnd()}\n`;
}
export function completionCmd(args: string[], registry: readonly RegistryCommand[], globalFlags: readonly string[], deps: { stdout?: (s:string)=>void; stderr?: (s:string)=>void; exit?: (code:number)=>never } = {}): void {
    const io = { out: deps.stdout ?? console.log, err: deps.stderr ?? console.error, exit: deps.exit ?? ((code:number): never => process.exit(code)) };
    handlePreScan(COMPLETION_ARGS, args, io);
    const shell = args[0];
    const fail = (message: string): never => { io.err(message); return io.exit(1); };
    if (shell === undefined) return fail(`Missing shell. Expected one of: ${COMPLETION_SHELLS.join(', ')}.\nRun 'canon completion --help' for usage.`);
    if (shell.startsWith('-')) return fail(unknownOptionMessage('completion', shell));
    if (!(COMPLETION_SHELLS as readonly string[]).includes(shell)) return fail(`Unknown shell: ${shell}. Expected one of: ${COMPLETION_SHELLS.join(', ')}.\nRun 'canon completion --help' for usage.`);
    io.out(renderCompletion(shell as CompletionShell, buildCompletionModel(registry, globalFlags)).trimEnd());
}
