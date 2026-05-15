import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { checkDepForFlag } from '../deps.js';

// dist/cli/index.js → ../../ = package root (node_modules/canon-ai/ when installed)
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const runTaskScript = join(packageDir, 'scripts/run-task.ts');

function resolveTsx(): string {
    const candidates = [
        join(packageDir, 'node_modules/.bin/tsx'),  // canon-ai's own (most reliable)
        join(packageDir, '../.bin/tsx'),             // adopter's node_modules/.bin
    ];
    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    return 'tsx';
}

export function runCmd(args: string[]): void {
    for (const arg of args) {
        checkDepForFlag(arg);
    }

    const result = spawnSync(resolveTsx(), [runTaskScript, ...args], {
        stdio: 'inherit',
        cwd: process.cwd(),
    });

    process.exit(result.status ?? 1);
}
