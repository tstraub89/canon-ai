import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    findStagedFilesOutsideHandoff,
    findUncoveredTrackedChanges,
    isDoneMdTemplate,
    extractDoneMdFromStdout,
} from '../src/orchestrator/validation.js';
import { parsePorcelain } from '../src/orchestrator/git.js';
import { PIPELINE_TELEMETRY_FILES } from '../src/orchestrator/worktree.js';

void test('parsePorcelain expands new directories when fed -uall output', () => {
    // `git status --porcelain -uall` emits one line per untracked file.
    const output =
        ' M src/components/WallTextures/Existing.tsx\n' +
        '?? src/components/WallTextures/WallTextureGrid.tsx\n' +
        '?? src/components/WallTextures/WallTextureGrid.module.css\n' +
        '?? src/components/WallTextures/TextureUploader.tsx\n';

    const dirty = parsePorcelain(output);

    assert.ok(dirty.has('src/components/WallTextures/Existing.tsx'));
    assert.ok(dirty.has('src/components/WallTextures/WallTextureGrid.tsx'));
    assert.ok(dirty.has('src/components/WallTextures/WallTextureGrid.module.css'));
    assert.ok(dirty.has('src/components/WallTextures/TextureUploader.tsx'));
});

void test('parsePorcelain without -uall collapses new directories — the wall-textures regression', () => {
    // `git status --porcelain` (default -unormal) emits one `?? dir/` line for
    // the entire new directory. The handoff-vs-dirty intersection then drops
    // every file inside, so they never get staged.
    const output =
        ' M src/components/WallTextures/Existing.tsx\n' +
        '?? src/components/WallTextures/\n';

    const dirty = parsePorcelain(output);

    // Tracked file shows up correctly.
    assert.ok(dirty.has('src/components/WallTextures/Existing.tsx'));
    // The collapsed directory entry is all we get.
    assert.ok(dirty.has('src/components/WallTextures/'));
    // Individual new files are NOT in the set — this is the bug.
    assert.ok(!dirty.has('src/components/WallTextures/WallTextureGrid.tsx'));
    assert.ok(!dirty.has('src/components/WallTextures/WallTextureGrid.module.css'));
});

void test('parsePorcelain handles renames by emitting both old and new paths', () => {
    const output = 'R  src/old/Name.tsx -> src/new/Name.tsx\n';

    const dirty = parsePorcelain(output);

    assert.ok(dirty.has('src/old/Name.tsx'));
    assert.ok(dirty.has('src/new/Name.tsx'));
});

void test('parsePorcelain keeps a literal arrow in a non-rename path intact', () => {
    const dirty = parsePorcelain(' M docs/a -> b.md\n');

    assert.ok(dirty.has('docs/a -> b.md'));
    assert.equal(dirty.size, 1);
});

void test('parsePorcelain strips surrounding quotes on paths with spaces', () => {
    const output = '?? "src/components/With Space/File.tsx"\n';

    const dirty = parsePorcelain(output);

    assert.ok(dirty.has('src/components/With Space/File.tsx'));
});

void test('parsePorcelain decodes octal-escaped non-ASCII paths as UTF-8', () => {
    // Default core.quotePath=true C-quotes every byte >= 0x80.
    const dirty = parsePorcelain('?? "docs/\\360\\237\\230\\200.md"\n M "docs/caf\\303\\251.md"\n');

    assert.deepEqual([...dirty], ['docs/😀.md', 'docs/café.md']);
});

void test('parsePorcelain decodes embedded quote, backslash, and control escapes', () => {
    const dirty = parsePorcelain(' M "docs/a\\"b\\\\c.md"\n?? "docs/tab\\there.md"\n');

    assert.deepEqual([...dirty], ['docs/a"b\\c.md', 'docs/tab\there.md']);
});

void test('parsePorcelain decodes both sides of a quoted rename', () => {
    const dirty = parsePorcelain('R  "docs/old \\360\\237\\230\\200.md" -> "docs/new\\\\name.md"\n');

    assert.deepEqual([...dirty], ['docs/old 😀.md', 'docs/new\\name.md']);
});

void test('parsePorcelain splits a rename on the arrow outside the quotes', () => {
    const dirty = parsePorcelain('R  "docs/a -> \\"b.md" -> docs/c.md\nC  docs/d.md -> "docs/e -> \\"f.md"\n');

    assert.deepEqual([...dirty], ['docs/a -> "b.md', 'docs/c.md', 'docs/d.md', 'docs/e -> "f.md']);
});

void test('parsePorcelain matches real git status output for non-ASCII and quoted names', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-porcelain-'));
    try {
        const git = (...args: string[]) => {
            const result = spawnSync('git', ['-c', 'core.quotePath=true', ...args], { cwd: repo, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            return result.stdout;
        };
        git('init', '-q');
        fs.mkdirSync(path.join(repo, 'docs'));
        const names = ['docs/😀.md', 'docs/a"b\\c.md'];
        for (const name of names) fs.writeFileSync(path.join(repo, name), 'x\n');

        const dirty = parsePorcelain(git('status', '--porcelain=v1', '-uall'));

        assert.deepEqual([...dirty].sort(), [...names].sort());
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

void test('findUncoveredTrackedChanges matches a quoted non-ASCII path against handoff', () => {
    const status = ' M "src/\\360\\237\\230\\200.ts"\n';

    assert.deepEqual(findUncoveredTrackedChanges(status, new Set(['src/😀.ts'])), []);
});

void test('parsePorcelain returns empty set for empty input', () => {
    assert.equal(parsePorcelain('').size, 0);
    assert.equal(parsePorcelain('   \n').size, 0);
});

void test('parsePorcelain rejects trimmed porcelain that loses the leading worktree column', () => {
    assert.throws(
        () => parsePorcelain('M api/claim-pro.ts\n'),
        /Preserve leading whitespace/
    );
});

// ── Auto-commit safety checks ──────────────────────────────────────────────

void test('findUncoveredTrackedChanges catches staged-only source changes outside handoff', () => {
    const status =
        'M  src/unrelated.ts\n' +
        ' M api/claim-pro.ts\n' +
        '?? asdf\n' +
        ' M tasks/example/notes.md\n' +
        ' M docs/pipeline-invocations.md\n';

    const uncovered = findUncoveredTrackedChanges(status, new Set(['api/claim-pro.ts']));

    assert.deepEqual(uncovered, ['M  src/unrelated.ts']);
});

void test('findUncoveredTrackedChanges flags a dirty managed doc absent from handoff', () => {
    const status =
        ' M docs/codebase-map.md\n' +
        ' M src/feature.ts\n';

    const uncovered = findUncoveredTrackedChanges(status, new Set(['src/feature.ts']));

    // Managed docs are NOT bypassed by the implement-phase reconciler — only
    // tasks/ and telemetry are. An implement-authored managed-doc edit not in
    // handoff.md must surface (abort the auto-commit) so it isn't committed
    // unreviewed. QA's own docs-freshness edits are handled separately, at the
    // QA-end commit.
    assert.deepEqual(uncovered, [' M docs/codebase-map.md']);
});

void test('findUncoveredTrackedChanges requires both sides of a rename to be in handoff', () => {
    const status = 'R  src/old.ts -> src/new.ts\n';

    assert.deepEqual(findUncoveredTrackedChanges(status, new Set(['src/new.ts'])), [
        'R  src/old.ts -> src/new.ts',
    ]);
    assert.deepEqual(findUncoveredTrackedChanges(status, new Set(['src/old.ts', 'src/new.ts'])), []);
});

void test('findStagedFilesOutsideHandoff catches files git commit would otherwise sweep in', () => {
    const staged =
        'api/claim-pro.ts\n' +
        'src/unrelated.ts\n' +
        'tasks/example/status.json\n';

    const unexpected = findStagedFilesOutsideHandoff(staged, new Set(['api/claim-pro.ts']));

    assert.deepEqual(unexpected, ['src/unrelated.ts', 'tasks/example/status.json']);
});

// ── PIPELINE_TELEMETRY_FILES ────────────────────────────────────────────────

void test('PIPELINE_TELEMETRY_FILES covers the two files the pipeline itself writes', () => {
    // docs/pipeline-invocations.md is appended by src/orchestrator/run-task.ts after
    // every agent invocation (duration + tokens). docs/task-quality-log.md is
    // appended by QA sub-Claude (per the QA prompt) with per-task quality
    // signals. Both get dirty between phases and must not block auto-commit.
    assert.ok(PIPELINE_TELEMETRY_FILES.includes('docs/pipeline-invocations.md'));
    assert.ok(PIPELINE_TELEMETRY_FILES.includes('docs/task-quality-log.md'));
});

// ── isDoneMdTemplate ────────────────────────────────────────────────────────

function withTempFile(contents: string | null, fn: (p: string) => void): void {
    const p = path.join(os.tmpdir(), `run-task-test-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
    if (contents !== null) fs.writeFileSync(p, contents);
    try { fn(p); } finally { try { fs.unlinkSync(p); } catch { /* ignore */ } }
}

void test('isDoneMdTemplate returns true when done.md is missing', () => {
    const p = path.join(os.tmpdir(), `run-task-test-missing-${Date.now()}.md`);
    assert.equal(isDoneMdTemplate(p), true);
});

void test('isDoneMdTemplate detects unfilled template via [TASK-ID] sentinel', () => {
    withTempFile('# Completion Summary: [TASK-ID] — [Title]\n\n## What Changed\n\nOne paragraph, plain English. No code jargon.\n', p => {
        assert.equal(isDoneMdTemplate(p), true);
    });
});

void test('isDoneMdTemplate detects unfilled template via the "<path>" files-changed sentinel', () => {
    withTempFile('# Completion Summary: my-task\n\n## Files Changed\n- `<path>` — brief note\n', p => {
        assert.equal(isDoneMdTemplate(p), true);
    });
});

void test('isDoneMdTemplate returns false for a real QA summary', () => {
    const real =
        '# QA Summary: wall-textures-polish\n\n' +
        '## Overview\n\n' +
        'This task redesigned the wall texture UI into a compact picker flow...\n\n' +
        '## Files Changed\n\n' +
        '| File | Change Summary |\n' +
        '|---|---|\n' +
        '| src/components/Properties/WallProperties.tsx | Compact icon-button row. |\n';
    withTempFile(real, p => {
        assert.equal(isDoneMdTemplate(p), false);
    });
});

// ── extractDoneMdFromStdout ─────────────────────────────────────────────────

void test('extractDoneMdFromStdout accepts a "QA Summary" heading', () => {
    const stdout = '# QA Summary: my-task\n\n## Overview\n\nStuff happened.\n';
    const out = extractDoneMdFromStdout(stdout);
    assert.ok(out.startsWith('# QA Summary: my-task'));
    assert.ok(out.endsWith('\n'));
});

void test('extractDoneMdFromStdout accepts a "Completion Summary" heading', () => {
    const stdout = '# Completion Summary: my-task\n\n## What Changed\n\nBody.\n';
    const out = extractDoneMdFromStdout(stdout);
    assert.ok(out.startsWith('# Completion Summary: my-task'));
});

void test('extractDoneMdFromStdout rejects stdout without a recognizable heading', () => {
    // Prevents overwriting a real template with random diagnostics if claude
    // printed an error message or a non-QA response.
    assert.equal(extractDoneMdFromStdout('some diagnostic noise\nno heading here\n'), '');
    assert.equal(extractDoneMdFromStdout('# Something Else\n\nbody\n'), '');
});

void test('extractDoneMdFromStdout returns empty for empty stdout', () => {
    assert.equal(extractDoneMdFromStdout(''), '');
    assert.equal(extractDoneMdFromStdout('   \n  \n'), '');
});

void test('extractDoneMdFromStdout trims leading whitespace before the heading', () => {
    const stdout = '\n\n# QA Summary: x\n\nBody.\n';
    const out = extractDoneMdFromStdout(stdout);
    assert.ok(out.startsWith('# QA Summary: x'));
});
