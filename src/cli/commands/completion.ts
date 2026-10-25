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
    valueFlagKinds: Record<string, CompletionValueKind>; positionals: CompletionSlot[]; freeTextSlots: number[];
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
    const dependsOn: Record<number, number> = {};
    slots.forEach((slot, i) => { if (slot.kind === 'reviewVerdict' && phase >= 0) dependsOn[i] = phase; if (slot.kind === 'fieldValue' && field >= 0) dependsOn[i] = field; });
    return {
        path, flags: [...new Set([...decl.booleanFlags, ...decl.valueFlags, ...(decl.equalsValueFlags ?? []), '--help', '-h'])],
        booleanFlags: [...decl.booleanFlags], valueFlags: [...decl.valueFlags], equalsValueFlags: [...(decl.equalsValueFlags ?? [])],
        valueFlagKinds: Object.fromEntries(decl.valueFlags.map(f => [f, decl.completion?.valueFlags?.[f] ?? 'none'])),
        positionals: slots, freeTextSlots: [...(decl.freeTextSlots ?? [])], dependsOn,
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
function renderBash(model: CompletionModel): string {
    const commands = model.commands.map(c => c.path[0]).join(' ');
    const task = taskCmd(model)!;
    const subs = (task.subcommands ?? []).map(c => c.path[1]).join(' ');
    const phaseValues = q(model.values.phase.join(' '));
    const statusValues = q(model.values.phaseStatus.join(' '));
    const acceptValues = q(model.values.acceptPhase.join(' '));
    const fieldValues = q(model.values.settableField.join(' '));
    const sizeValues = q(model.values.taskSize.join(' '));
    const channels = q(model.values.updateChannel.join(' '));
    const shells = q(model.values.shell.join(' '));
    const specVerdicts = q(model.verdictsByPhase.spec_review.join(' '));
    const codeVerdicts = q(model.verdictsByPhase.code_review.join(' '));
    const boolValues = q([...new Set(Object.values(model.valuesByField).flat())].join(' '));
    const flagCases = records(model).map(c => `${q(c.path.join(' '))}) printf '%s\\n' ${q(c.flags.join(' '))} ;;`).join(' ');
    const taskIdPaths = records(model).filter(c => c.positionals[0]?.kind === 'taskId').map(c => q(c.path.join(' '))).join('|');
    return `# Generated by canon's completion command.
_canon_task_ids() { ( common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0; root=\${common%/*}; [ -d "$root/tasks" ] || exit 0; shopt -s nullglob; shopt -u failglob 2>/dev/null; for d in "$root"/tasks/*/; do d=\${d%/}; n=\${d##*/}; case $n in _*|.*) continue;; esac; printf '%s\\n' "$n"; done ); }
_canon_candidates() {
  local cur="$1"; shift; local -a w=("$@"); local n=0 i=0 cmd= sub= path= flag= val= kind=
  cmd=\${w[0]}; sub=\${w[1]}; path="$cmd"; [ "$cmd" = task ] && [ -n "$sub" ] && path="task $sub"
  if [ -z "$cmd" ]; then if [[ "$cur" == -* ]]; then printf '%s\\n' ${q(model.globalFlags.join(' '))}; else printf '%s\\n' ${q(commands)}; fi; return; fi
  if [ "$cmd" = task ] && [ -z "$sub" ]; then printf '%s\\n' ${q(subs)}; return; fi
  if [[ "$cur" == -* ]]; then case "$path" in ${flagCases} *) printf '%s\\n' ${q(model.globalFlags.join(' '))} ;; esac; return; fi
  shift; [ "$cmd" = task ] && [ -n "$sub" ] && shift
  local pending=0 word; for word in "$@"; do if [ "$pending" -eq 1 ]; then pending=0; val=; continue; fi; case "$word" in --expect|--until) pending=1; val=phase;; --channel) pending=1; val=updateChannel;; --reason|--timeout|--ref|--base) pending=1;; --*=*) continue;; -*) continue;; *) n=$((n+1));; esac; done
  [ "$pending" -eq 1 ] || val=
  if [ -n "$val" ]; then case "$val" in phase) printf '%s\\n' ${phaseValues};; updateChannel) printf '%s\\n' ${channels};; esac; return; fi
  if [ "$path" = 'task phase' ]; then case "$n" in 0) _canon_task_ids;; 1) printf '%s\\n' ${phaseValues};; 2) printf '%s\\n' ${statusValues};; 3) case "\${w[3]}" in spec_review) printf '%s\\n' ${specVerdicts};; code_review) printf '%s\\n' ${codeVerdicts};; esac;; esac; return; fi
  if [ "$path" = 'task accept' ]; then if [ "$n" -eq 0 ]; then _canon_task_ids; else printf '%s\\n' "$(_canon_task_ids) ${acceptValues}"; fi; return; fi
  if [ "$path" = 'task set' ]; then case "$n" in 0) _canon_task_ids;; 1) printf '%s\\n' ${fieldValues};; 2) case "\${w[3]}" in task_size) printf '%s\\n' ${sizeValues};; title|base_branch) ;; *) printf '%s\\n' ${boolValues};; esac;; esac; return; fi
  case "$path" in ${taskIdPaths}) _canon_task_ids;; completion) printf '%s\\n' ${shells};; esac
}
_canon() { local cur=\${COMP_WORDS[COMP_CWORD]}; local -a words=(); local i; for ((i=1;i<COMP_CWORD;i++)); do words+=("\${COMP_WORDS[i]}"); done; COMPREPLY=( $(compgen -W "$(_canon_candidates "$cur" "\${words[@]}")" -- "$cur") ); }
complete -F _canon canon
`;
}
function renderZsh(model: CompletionModel): string {
    const commands = q(model.commands.map(c => c.path[0]).join(' '));
    const task = taskCmd(model)!;
    const subs = q((task.subcommands ?? []).map(c => c.path[1]).join(' '));
    const flagCases = records(model).map(c => `${q(c.path.join(' '))}) items=${q(c.flags.join(' '))}; print -l -- ` + '${(s: :)items};;').join(' ');
    const taskIdPaths = records(model).filter(c => c.positionals[0]?.kind === 'taskId').map(c => q(c.path.join(' '))).join('|');
    const taskIdPathPattern = taskIdPaths;
    const phase = q(model.values.phase.join(' '));
    const status = q(model.values.phaseStatus.join(' '));
    const accept = q(model.values.acceptPhase.join(' '));
    const fields = q(model.values.settableField.join(' '));
    const sizes = q(model.values.taskSize.join(' '));
    const channels = q(model.values.updateChannel.join(' '));
    const shells = q(model.values.shell.join(' '));
    const specVerdicts = q(model.verdictsByPhase.spec_review.join(' '));
    const codeVerdicts = q(model.verdictsByPhase.code_review.join(' '));
    const boolValues = q([...new Set(Object.values(model.valuesByField).flat())].join(' '));
    return `# Generated by canon's completion command.
_canon_task_ids() { emulate -L zsh; local common root d n; common=$(command git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0; root=\${common%/*}; [[ -d $root/tasks ]] || return 0; for d in $root/tasks/*(/N); do n=\${d:t}; [[ $n == _* || $n == .* ]] && continue; print -r -- $n; done }
_canon_candidates() {
  emulate -L zsh; local cur=$1; shift; local -a w=("$@"); local cmd=\${w[1]-} sub=\${w[2]-} cmdpath=$cmd word val= pending=0 n=0 items
  if [[ -z $cmd ]]; then if [[ $cur == -* ]]; then items=${q(model.globalFlags.join(' '))}; else items=${commands}; fi; print -l -- \${(s: :)items}; return; fi
  cmdpath=$cmd; if [[ $cmd == task && -z $sub ]]; then items=${subs}; print -l -- \${(s: :)items}; return; fi
  if [[ $cmd == task && -n $sub ]]; then cmdpath="task $sub"; shift; shift; else shift; fi
  if [[ $cur == -* ]]; then case "$cmdpath" in ${flagCases} *) print -l -- ${q(model.globalFlags.join(' '))};; esac; return; fi
  for word in "$@"; do if (( pending )); then pending=0; val=; continue; fi; case $word in --expect|--until) pending=1; val=phase;; --channel) pending=1; val=updateChannel;; --reason|--timeout|--ref|--base) pending=1;; --*=*) continue;; -*) continue;; *) (( n++ ));; esac; done
  if (( pending )); then case $val in phase) items=${phase};; updateChannel) items=${channels};; esac; print -l -- \${(s: :)items}; return; fi
  if [[ $cmdpath == 'task phase' ]]; then case $n in 0) _canon_task_ids;; 1) items=${phase}; print -l -- \${(s: :)items};; 2) items=${status}; print -l -- \${(s: :)items};; 3) case \${w[4]} in spec_review) items=${specVerdicts}; print -l -- \${(s: :)items};; code_review) items=${codeVerdicts}; print -l -- \${(s: :)items};; esac;; esac; return; fi
  if [[ $cmdpath == 'task accept' ]]; then if (( n == 0 )); then _canon_task_ids; else _canon_task_ids; items=${accept}; print -l -- \${(s: :)items}; fi; return; fi
  if [[ $cmdpath == 'task set' ]]; then case $n in 0) _canon_task_ids;; 1) items=${fields}; print -l -- \${(s: :)items};; 2) case \${w[4]} in task_size) items=${sizes}; print -l -- \${(s: :)items};; title|base_branch) ;; *) items=${boolValues}; print -l -- \${(s: :)items};; esac;; esac; return; fi
  case $cmdpath in ${taskIdPathPattern}) _canon_task_ids;; completion) items=${shells}; print -l -- \${(s: :)items};; esac
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
    const flagCases = records(model).map(c => `${q(c.path.join(' '))}) string split ' ' -- ${q(c.flags.join(' '))};;`).join(' ');
    const taskIdPaths = records(model).filter(c => c.positionals[0]?.kind === 'taskId').map(c => c.path.join(' ')).join('|');
    const valuesCases = Object.entries(model.values).map(([kind, values]) => `${kind}) string split ' ' -- ${q(values.join(' '))};;`).join(' ');
    const verdictCases = Object.entries(model.verdictsByPhase).map(([phase, values]) => `${phase}) string split ' ' -- ${q(values.join(' '))};;`).join(' ');
    const fieldCases = Object.entries(model.valuesByField).map(([field, values]) => `${field}) string split ' ' -- ${q(values.join(' '))};;`).join(' ');
    const valueFlagCases = records(model).flatMap(c => c.valueFlags.map(f => `${q(`${c.path.join(' ')}:${f}`)}) set valKind ${c.valueFlagKinds[f]};;`)).join(' ');
    const valueFlagNames = records(model).flatMap(c => c.valueFlags).join(' ');
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
  set -l words (commandline -opc)
  set -l cur (commandline -ct)
  set -l countWords (count $words)
  if test $countWords -le 1
    if string match -q -- '-*' $cur; string split ' ' -- ${globalFlags}; else string split ' ' -- ${commands}; end
    return
  end
  set -l cmd $words[2]
  set -l sub ''
  set -l cmdpath $cmd
  set -l rest
  if test $cmd = task
    if test $countWords -le 2; string split ' ' -- ${subcommands}; return; end
    set sub $words[3]
    set cmdpath "task $sub"
    set -e words[1..3]
    set rest $words
  else
    set -e words[1..2]
    set rest $words
  end
  if string match -q -- '-*' $cur
    switch $cmdpath
      ${flagCases}
      case '*'; string split ' ' -- ${globalFlags}
    end
    return
  end
  set -l n 0
  set -l pending 0
  set -l valKind none
  set -l priorFlag ''
  set -l valueFlags (string split ' ' -- ${q(valueFlagNames)})
  for word in $rest
    if test $pending -eq 1
      set pending 0
      set valKind none
      continue
    end
    if contains -- $word $valueFlags
      set pending 1
      set priorFlag $word
      switch "$cmdpath:$word"
        ${valueFlagCases}
      end
      continue
    end
    if string match -q -- '*=*' $word
      continue
    end
    if string match -q -- '-*' $word
      continue
    end
    set n (math $n + 1)
  end
  if test $pending -eq 1
    switch $valKind
      ${valuesCases}
    end
    return
  end
  if test "$cmdpath" = 'task phase'
    switch $n
      case 0; __canon_task_ids
      case 1; string split ' ' -- ${q(model.values.phase.join(' '))}
      case 2; string split ' ' -- ${q(model.values.phaseStatus.join(' '))}
      case 3
        switch $rest[2]
          ${verdictCases}
        end
    end
    return
  end
  if test "$cmdpath" = 'task accept'
    if test $n -eq 0; __canon_task_ids; else __canon_task_ids; string split ' ' -- ${q(model.values.acceptPhase.join(' '))}; end
    return
  end
  if test "$cmdpath" = 'task set'
    switch $n
      case 0; __canon_task_ids
      case 1; string split ' ' -- ${q(model.values.settableField.join(' '))}
      case 2
        switch $rest[2]
          ${fieldCases}
        end
    end
    return
  end
  switch $cmdpath
    case ${(taskIdPaths.split('|').map(x=>q(x)).join('|'))}; __canon_task_ids
    case completion; string split ' ' -- ${q(model.values.shell.join(' '))}
  end
end
complete -c canon -f -a '(__canon_candidates)'
`;
}
export function tcshFlagProgram(model: CompletionModel): string {
    const rows = records(model).map(c=>`${c.path.join(' ')}\\t${c.flags.join(' ')}`).join('\\n').replace(/'/g, "'\\''");
    return `BEGIN { split("${rows.replace(/"/g,'\\"')}", lines, "\\n"); split(ENVIRON["COMMAND_LINE"], w, " "); cmd=w[2]; subcmd=w[3]; path=cmd; if (cmd == "task" && subcmd != "") path=cmd " " subcmd; for (i in lines) { split(lines[i], row, "\\t"); if (row[1] == path) { print row[2]; exit } } if (cmd == "task" && subcmd == "") { print "${taskCmd(model)?.flags.join(' ')}"; exit } print "${model.globalFlags.join(' ')}" }`;
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
    if (shell === undefined) fail(`Missing shell. Expected one of: ${COMPLETION_SHELLS.join(', ')}.\nRun 'canon completion --help' for usage.`);
    if (shell.startsWith('-')) fail(unknownOptionMessage('completion', shell));
    if (!(COMPLETION_SHELLS as readonly string[]).includes(shell)) fail(`Unknown shell: ${shell}. Expected one of: ${COMPLETION_SHELLS.join(', ')}.\nRun 'canon completion --help' for usage.`);
    io.out(renderCompletion(shell as CompletionShell, buildCompletionModel(registry, globalFlags)).trimEnd());
}
