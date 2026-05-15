import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const taskScript = join(packageDir, 'scripts/task.sh');

export function taskCmd(args: string[]): void {
    if (!existsSync(taskScript)) {
        console.error(`task.sh not found at ${taskScript}`);
        process.exit(1);
    }

    const result = spawnSync('bash', [taskScript, ...args], {
        stdio: 'inherit',
        cwd: process.cwd(),
    });

    process.exit(result.status ?? (result.error ? 1 : 0));
}
