// Keep this module free of side effects: tests import it while the CLI entrypoint dispatches on argv at import.
import { DOCTOR_ARGS } from './commands/doctor.js';
import { INIT_ARGS } from './commands/init.js';
import { STOP_ARGS } from './commands/stop.js';
import { UPDATE_ARGS } from './commands/update.js';
import { UPGRADE_ARGS } from './commands/upgrade.js';
import { WATCH_ARGS } from './commands/watch.js';
import { COMPLETION_ARGS } from './commands/completion.js';
import { RUN_ARGS } from '../orchestrator/cli.js';
import { TASK_ARGS, TASK_SUBCOMMAND_ARGS } from '../task/index.js';
import type { ArgDeclaration } from '../lib/cli-args.js';

export interface RegistryCommand { name: string; decl: ArgDeclaration; subcommands?: Readonly<Record<string, ArgDeclaration>> }
export const COMMAND_REGISTRY: readonly RegistryCommand[] = [
    { name: 'init', decl: INIT_ARGS }, { name: 'doctor', decl: DOCTOR_ARGS },
    { name: 'task', decl: TASK_ARGS, subcommands: TASK_SUBCOMMAND_ARGS },
    { name: 'run', decl: RUN_ARGS }, { name: 'watch', decl: WATCH_ARGS }, { name: 'stop', decl: STOP_ARGS },
    { name: 'update', decl: UPDATE_ARGS }, { name: 'upgrade', decl: UPGRADE_ARGS },
    { name: 'completion', decl: COMPLETION_ARGS },
];
export const GLOBAL_FLAGS = ['--help', '-h', '--version', '-v'] as const;
