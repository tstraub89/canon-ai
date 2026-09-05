#!/usr/bin/env node
/**
 * install-git-hooks.mjs
 *
 * Contributor-only wrapper around `simple-git-hooks`, invoked by `npm run hooks`.
 * It handles environments where the bare CLI would fail.
 *
 * Skip cases (silent exit 0 — install proceeds, no hooks installed):
 *
 *   1. **No `.git/` at all.** Adopters consuming canon-ai as a dependency
 *      (`npm install canon-ai` in their project, or `npm install -g
 *      canon-ai`) have no `.git/` at this script's cwd (which is canon-ai's
 *      install dir under `node_modules/canon-ai/`). Adopters should never
 *      have canon-ai-dev's pre-commit hook installed.
 *
 *   2. **`simple-git-hooks` binary not installed.** Global install
 *      (`npm install -g canon-ai`) strips devDependencies; the bare CLI
 *      would emit "command not found" (exit 127) and tank the install.
 *
 *   3. **`.git` is a file (git worktree).** simple-git-hooks's `_setHook`
 *      uses `path.join(projectRoot, '.git', 'hooks')` unconditionally
 *      (see `node_modules/simple-git-hooks/simple-git-hooks.js:177-198`)
 *      and fails with ENOTDIR on the worktree's `.git` file. Skip
 *      silently here — running the CLI would tank the install.
 *
 * Known limitation of skip case 3: a developer who only ever `npm install`s
 * in a worktree (and never in the main checkout) ends up with a clean
 * install but no pre-commit hook in the shared gitdir. Mitigation: canon
 * dev workflow includes running `npm install` in the main checkout at
 * least once; once the hook is in `<main>/.git/hooks/pre-commit`, every
 * worktree inherits it via git's hook resolution. A more aggressive fix
 * (writing the worktree's hook to the shared gitdir directly) was rejected
 * because it would break commits in main pre-merge of any task that adds
 * a new hook command — `<main>/.git/hooks/pre-commit` would call a script
 * that doesn't exist in main's `package.json` yet.
 *
 * Lives in `scripts/` (not in `CANON_OWNED`) — ships in the npm tarball
 * via the `files` glob but isn't installed into adopter repos.
 */

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cwd = process.cwd();
const gitPath = path.join(cwd, '.git');

// Skip case 1: no `.git/` at all — adopter / global install.
if (!existsSync(gitPath)) process.exit(0);

// Skip case 2: simple-git-hooks not installed (devDeps stripped).
const binPath = path.join(cwd, 'node_modules', '.bin', 'simple-git-hooks');
if (!existsSync(binPath)) process.exit(0);

// Skip case 3: worktree (`.git` is a file). simple-git-hooks would
// fail with ENOTDIR. See the docstring above for the known limitation.
if (!statSync(gitPath).isDirectory()) process.exit(0);

// Main checkout: delegate to simple-git-hooks CLI.
// `status === null` when the child couldn't be spawned or was killed by
// a signal — treat as failure so npm doesn't silently report success on
// a broken hook install. (Previously `?? 0` masked this — Codex P3 on
// canon-docs-dedup PR #102.)
const result = spawnSync(binPath, [], { cwd, stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
