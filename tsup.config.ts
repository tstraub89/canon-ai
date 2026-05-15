import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node24',
    outDir: 'dist',
    clean: true,
    splitting: false,
    bundle: true,
    banner: { js: '#!/usr/bin/env node' },
    define: { 'process.env.CANON_VERSION': JSON.stringify(version) },
});
