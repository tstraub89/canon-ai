import { taskCmd as runTaskCommand } from '../../task/index.js';

export function taskCmd(args: string[]): void {
    runTaskCommand(args);
}
