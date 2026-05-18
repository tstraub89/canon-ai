#!/usr/bin/env node
// Post-build pass that normalizes path comments inside dist/.
//
// Why: tsup embeds the relative source path of each bundled module as a
// `// <path>` comment. When canon-ai is built from a git worktree whose
// `node_modules` is symlinked to the main checkout (canon's worktree setup
// does this for speed — see scripts/run-task/worktree.ts:147), tsup resolves
// the symlink and emits `// ../../canon-ai-dev/node_modules/foo/bar.js`.
// A clean CI checkout has a regular `node_modules` and emits `// node_modules/
// foo/bar.js`. Same bundle, two different byte sequences — fails the
// `Verify committed dist/ matches a fresh build` step.
//
// This script rewrites `// (../)+(<segments>/)*node_modules/` ->
// `// node_modules/` in every `dist/**/*.js` file so the committed dist/
// is reproducible regardless of where node_modules resolves. The leading
// `../` (one or more) is the marker that distinguishes a symlink-resolved
// relative path from an in-tree `// node_modules/...` comment that should
// be left alone. Intermediate path segments (e.g., `canon-ai-dev/`) are
// allowed between the `../` chain and `node_modules/`.
//
// Scope: canon-ai-specific. Adopter projects don't commit dist/ and don't
// hit this; nothing here ships in canon's public surface.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Use fileURLToPath rather than URL.pathname so checkout paths containing
// spaces or non-ASCII characters (which URL.pathname leaves percent-encoded)
// resolve to a real filesystem path.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(SCRIPT_DIR, '..', 'dist');
const RELATIVE_NODE_MODULES_COMMENT = /^\/\/ (?:\.\.\/)+(?:[^/\n]+\/)*node_modules\//gm;

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (full.endsWith('.js')) out.push(full);
    }
    return out;
}

let rewritten = 0;
for (const file of walk(DIST_DIR)) {
    const before = readFileSync(file, 'utf8');
    const after = before.replace(RELATIVE_NODE_MODULES_COMMENT, '// node_modules/');
    if (after !== before) {
        writeFileSync(file, after);
        rewritten++;
    }
}

if (rewritten > 0) {
    console.log(`normalize-dist-paths: rewrote ${rewritten} file(s)`);
}
