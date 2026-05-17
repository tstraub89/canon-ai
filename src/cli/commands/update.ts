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

// canon-ai is distributed via a private GitHub repo (not the npm registry yet),
// so update commands target the github URL with --install-links. See README §Install
// for the install command. Switch back to `canon-ai@latest` (and drop --install-links)
// if/when canon ships to npm proper.
const CANON_GITHUB_SOURCE = 'github:tstraub89/canon-ai';

export function updateCmd(_args: string[]): void {
    const cwd = process.cwd();
    const installType = detectInstallType();

    if (installType === 'npx') {
        console.log('\nRunning via npx — no persistent install to update.');
        console.log('To apply the latest templates, re-run from the latest source:\n');
        console.log(`  npx --install-links ${CANON_GITHUB_SOURCE} upgrade\n`);
        return;
    }

    let cmdArgs: string[];

    if (installType === 'local') {
        cmdArgs = ['install', '--save-dev', '--install-links', CANON_GITHUB_SOURCE];
        console.log('\nUpdating canon-ai (local devDependency, from GitHub)...\n');
    } else {
        cmdArgs = ['install', '-g', '--install-links', CANON_GITHUB_SOURCE];
        console.log('\nUpdating canon-ai (global install, from GitHub)...\n');
    }

    const result = spawnSync('npm', cmdArgs, { stdio: 'inherit', cwd });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }

    console.log('\ncanon-ai updated. Run `canon upgrade` to sync vendored files in this repo.\n');
}
