#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CANON_END = '<!-- canon:end -->';
const CANON_START_RE = /<!-- canon:start[^>]* -->/;
const TARGET_FILES = ['CLAUDE.md', 'AGENTS.md'];

function usage() {
    console.error('Usage: node tools/strip-canon-block.mjs [--check|--dry-run]');
}

function parseArgs(argv) {
    let check = false;
    for (const arg of argv) {
        if (arg === '--check' || arg === '--dry-run') {
            check = true;
        } else {
            usage();
            throw new Error(`unknown flag: ${arg}`);
        }
    }
    return { check };
}

function isGitTreeDirty(cwd) {
    const result = spawnSync('git', ['status', '--porcelain'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0 || result.error) return true;
    for (const line of (result.stdout ?? '').split('\n')) {
        if (!line.trim()) continue;
        if (line.startsWith('??')) continue;
        return true;
    }
    return false;
}

function stripCanonBlock(content, file) {
    const startMatch = CANON_START_RE.exec(content);
    const endIndex = content.indexOf(CANON_END);

    if (!startMatch && endIndex === -1) {
        return { kind: 'unchanged', message: `${file}: no canon block found` };
    }
    if (!startMatch) {
        return { kind: 'error', message: `${file}: found canon:end without canon:start` };
    }
    if (endIndex === -1) {
        return { kind: 'error', message: `${file}: found canon:start without canon:end` };
    }
    if (endIndex < startMatch.index) {
        return { kind: 'error', message: `${file}: canon:end appears before canon:start` };
    }

    const nextContent =
        content.slice(0, startMatch.index) +
        content.slice(endIndex + CANON_END.length);

    if (nextContent === content) {
        return { kind: 'unchanged', message: `${file}: no canon block found` };
    }
    return { kind: 'changed', content: nextContent, message: `${file}: would strip canon block` };
}

function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(2);
    }

    const cwd = process.cwd();
    const results = [];
    let hasError = false;

    for (const file of TARGET_FILES) {
        const path = join(cwd, file);
        if (!existsSync(path)) {
            results.push({ file, kind: 'missing', message: `${file}: not found, skipping` });
            continue;
        }
        const content = readFileSync(path, 'utf8');
        const result = stripCanonBlock(content, file);
        if (result.kind === 'error') hasError = true;
        results.push({ file, path, ...result });
    }

    for (const result of results) {
        const stream = result.kind === 'error' ? process.stderr : process.stdout;
        stream.write(`${result.message}\n`);
    }

    if (hasError) process.exit(1);

    const changed = results.filter(result => result.kind === 'changed');
    if (options.check || changed.length === 0) return;

    if (isGitTreeDirty(cwd)) {
        console.error('Refused: git tree has tracked changes or git status is unavailable. Commit/stash them or rerun with --check.');
        process.exit(1);
    }

    for (const result of changed) {
        writeFileSync(result.path, result.content);
        console.log(`${result.file}: stripped canon block`);
    }
}

main();
