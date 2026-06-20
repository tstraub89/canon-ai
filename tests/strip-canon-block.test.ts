import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WORKTREE_ROOT = process.cwd();
const TOOL_PATH = path.join(WORKTREE_ROOT, 'tools', 'strip-canon-block.mjs');
const CANON_START = '<!-- canon:start -->';
const CANON_END = '<!-- canon:end -->';

function withGitFixture(run: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-canon-block-'));
    try {
        runGit(dir, ['init']);
        runGit(dir, ['config', 'user.email', 'test@example.com']);
        runGit(dir, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
        runGit(dir, ['add', 'README.md']);
        runGit(dir, ['commit', '-m', 'init']);
        run(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function runGit(cwd: string, args: string[]): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runTool(cwd: string, args: string[] = []) {
    return spawnSync(process.execPath, [TOOL_PATH, ...args], {
        cwd,
        encoding: 'utf8',
    });
}

function seedTracked(cwd: string, rel: string, content: string): void {
    fs.writeFileSync(path.join(cwd, rel), content);
    runGit(cwd, ['add', rel]);
    runGit(cwd, ['commit', '-m', `seed ${rel}`]);
}

void test('strip-canon-block: write mode strips block and preserves outside content', () => {
    withGitFixture(dir => {
        const content = `before\n${CANON_START}\nmanaged\n${CANON_END}\nafter\n`;
        seedTracked(dir, 'CLAUDE.md', content);

        const result = runTool(dir);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /CLAUDE\.md: stripped canon block/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'before\n\nafter\n');
    });
});

void test('strip-canon-block: absent markers are a no-op', () => {
    withGitFixture(dir => {
        seedTracked(dir, 'CLAUDE.md', '# CLAUDE\n\nProject content.\n');

        const result = runTool(dir);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /CLAUDE\.md: no canon block found/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '# CLAUDE\n\nProject content.\n');
    });
});

void test('strip-canon-block: start-only partial marker exits non-zero and preserves file', () => {
    withGitFixture(dir => {
        const content = `before\n${CANON_START}\nmanaged\n`;
        seedTracked(dir, 'CLAUDE.md', content);

        const result = runTool(dir);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /found canon:start without canon:end/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), content);
    });
});

void test('strip-canon-block: end-only partial marker exits non-zero and preserves file', () => {
    withGitFixture(dir => {
        const content = `before\nmanaged\n${CANON_END}\nafter\n`;
        seedTracked(dir, 'CLAUDE.md', content);

        const result = runTool(dir);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /found canon:end without canon:start/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), content);
    });
});

void test('strip-canon-block: missing files are skipped', () => {
    withGitFixture(dir => {
        const result = runTool(dir);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /CLAUDE\.md: not found, skipping/);
        assert.match(result.stdout, /AGENTS\.md: not found, skipping/);
    });
});

void test('strip-canon-block: check mode reports without writing', () => {
    withGitFixture(dir => {
        const content = `before\n${CANON_START}\nmanaged\n${CANON_END}\nafter\n`;
        seedTracked(dir, 'CLAUDE.md', content);

        const result = runTool(dir, ['--check']);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /CLAUDE\.md: would strip canon block/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), content);
    });
});

void test('strip-canon-block: check mode runs on a dirty tree', () => {
    withGitFixture(dir => {
        const content = `before\n${CANON_START}\nmanaged\n${CANON_END}\nafter\n`;
        seedTracked(dir, 'CLAUDE.md', content);
        fs.appendFileSync(path.join(dir, 'README.md'), 'dirty\n');

        const result = runTool(dir, ['--check']);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /CLAUDE\.md: would strip canon block/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), content);
    });
});

void test('strip-canon-block: write mode refuses on a dirty tree', () => {
    withGitFixture(dir => {
        const content = `before\n${CANON_START}\nmanaged\n${CANON_END}\nafter\n`;
        seedTracked(dir, 'CLAUDE.md', content);
        fs.appendFileSync(path.join(dir, 'README.md'), 'dirty\n');

        const result = runTool(dir);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Refused: git tree has tracked changes/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), content);
    });
});

void test('strip-canon-block: write mode refuses when git status is unavailable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-canon-block-no-git-'));
    try {
        const content = `before\n${CANON_START}\nmanaged\n${CANON_END}\nafter\n`;
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'), content);

        const result = runTool(dir);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /git status is unavailable/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), content);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('strip-canon-block: second run is an idempotent no-op', () => {
    withGitFixture(dir => {
        const content = `before\n${CANON_START}\nmanaged\n${CANON_END}\nafter\n`;
        seedTracked(dir, 'CLAUDE.md', content);

        const first = runTool(dir);
        assert.equal(first.status, 0, first.stderr);
        runGit(dir, ['add', 'CLAUDE.md']);
        runGit(dir, ['commit', '-m', 'strip']);

        const second = runTool(dir);
        assert.equal(second.status, 0, second.stderr);
        assert.match(second.stdout, /CLAUDE\.md: no canon block found/);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'before\n\nafter\n');
    });
});

void test('strip-canon-block: strips both agent files in one run', () => {
    withGitFixture(dir => {
        seedTracked(dir, 'CLAUDE.md', `c-before\n${CANON_START}\nmanaged\n${CANON_END}\nc-after\n`);
        seedTracked(dir, 'AGENTS.md', `a-before\n${CANON_START}\nmanaged\n${CANON_END}\na-after\n`);

        const result = runTool(dir);

        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'c-before\n\nc-after\n');
        assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'a-before\n\na-after\n');
    });
});
