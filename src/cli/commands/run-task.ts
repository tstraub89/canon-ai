import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { checkDepForFlag } from '../deps.js';

// dist/cli/index.js → ../../ = package root (node_modules/canon-ai/ when installed)
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const runTaskScript = join(packageDir, 'dist/scripts/run-task.js');

export function runCmd(args: string[]): void {
    for (const arg of args) {
        checkDepForFlag(arg);
    }

    const result = spawnSync(process.execPath, [runTaskScript, ...args], {
        stdio: 'inherit',
        cwd: process.cwd(),
    });

    process.exit(result.status ?? 1);
}
