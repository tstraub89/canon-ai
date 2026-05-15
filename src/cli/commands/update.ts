import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function detectInstallType(pkgDirOverride?: string): 'local' | 'global' | 'npx' {
    const dir = pkgDirOverride ?? packageDir;
    if (dir.includes('/_npx/') || dir.includes('\\_npx\\')) return 'npx';
    // Check the package's own install path — handles subdirectory invocations correctly
    const nodeModulesIdx = dir.lastIndexOf('/node_modules/');
    if (nodeModulesIdx !== -1) {
        const projectRoot = dir.slice(0, nodeModulesIdx);
        if (existsSync(join(projectRoot, 'package.json'))) return 'local';
    }
    return 'global';
}

export function updateCmd(_args: string[]): void {
    const cwd = process.cwd();
    const installType = detectInstallType();

    if (installType === 'npx') {
        console.log('\nRunning via npx — no persistent install to update.');
        console.log('To apply the latest templates, run:\n');
        console.log('  npx canon-ai@latest upgrade\n');
        return;
    }

    let cmdArgs: string[];

    if (installType === 'local') {
        cmdArgs = ['update', 'canon-ai'];
        console.log('\nUpdating canon-ai (local devDependency)...\n');
    } else {
        cmdArgs = ['install', '-g', 'canon-ai@latest'];
        console.log('\nUpdating canon-ai (global install)...\n');
    }

    const result = spawnSync('npm', cmdArgs, { stdio: 'inherit', cwd });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }

    console.log('\ncanon-ai updated. Run `canon upgrade` to sync vendored files in this repo.\n');
}
