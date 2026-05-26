import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as syncCanonTemplatesRaw from '../scripts/sync-canon-templates.mjs';

type SyncCanonTemplatesModule = {
    applySync(repoRoot: string): string[];
    checkSync(repoRoot: string): string[];
    findSyncErrors(repoRoot: string): string[];
    mergeDelimitedForSync(rootContent: string, templatesContent: string): string | null;
};

const syncCanonTemplates = syncCanonTemplatesRaw as SyncCanonTemplatesModule;

const scriptPath = path.resolve('scripts/sync-canon-templates.mjs');
const tsxBin = path.resolve(process.platform === 'win32' ? 'node_modules/.bin/tsx.cmd' : 'node_modules/.bin/tsx');

function withTempDir(run: (root: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-canon-templates-'));
    try {
        run(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function writeFile(root: string, relPath: string, content: string): void {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
}

/**
 * Populates the temp root with placeholder content for every canon-managed
 * file (both root + templates/) so the strict "missing on both sides" gate
 * doesn't fire on tests that only care about a specific drift scenario.
 * Tests overwrite the paths they're exercising after calling this.
 */
function seedCanonFixture(root: string): void {
    const sync = syncCanonTemplatesRaw as unknown as {
        WHOLESALE_SYNC: readonly string[];
        DELIMITED_SYNC: readonly string[];
    };
    const placeholderWholesale = 'placeholder\n';
    const placeholderDelimited = '# placeholder\n<!-- canon:start -->\n<!-- canon:end -->\n';
    for (const rel of sync.WHOLESALE_SYNC) {
        writeFile(root, rel, placeholderWholesale);
        writeFile(root, `templates/${rel}`, placeholderWholesale);
    }
    for (const rel of sync.DELIMITED_SYNC) {
        writeFile(root, rel, placeholderDelimited);
        writeFile(root, `templates/${rel}`, placeholderDelimited);
    }
}

function runCheckCli(root: string) {
    return spawnSync(tsxBin, [scriptPath, '--check'], {
        cwd: root,
        encoding: 'utf8',
    });
}

void test('wholesale sync moves root content to templates and stays one-way', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        writeFile(root, 'docs/pipeline-orchestrator.md', 'root pipeline\n');
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'stale pipeline\n');

        assert.deepEqual(syncCanonTemplates.checkSync(root), ['templates/docs/pipeline-orchestrator.md']);
        assert.deepEqual(syncCanonTemplates.applySync(root), ['templates/docs/pipeline-orchestrator.md']);
        assert.equal(fs.readFileSync(path.join(root, 'docs/pipeline-orchestrator.md'), 'utf8'), 'root pipeline\n');
        assert.equal(fs.readFileSync(path.join(root, 'templates/docs/pipeline-orchestrator.md'), 'utf8'), 'root pipeline\n');
        assert.deepEqual(syncCanonTemplates.checkSync(root), []);
    });
});

void test('delimited sync preserves templates outside-delimiter content and ignores root tail', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        const rootAgents = [
            '# AGENTS',
            '',
            '<!-- canon:start -->',
            'root-canon-content',
            '<!-- canon:end -->',
            'root-tail',
            '',
        ].join('\n');
        const templatesAgents = [
            '# AGENTS',
            '',
            '<!-- canon:start -->',
            'stale-content',
            '<!-- canon:end -->',
            'adopter-tail',
            '',
        ].join('\n');

        writeFile(root, 'AGENTS.md', rootAgents);
        writeFile(root, 'templates/AGENTS.md', templatesAgents);

        assert.equal(
            syncCanonTemplates.mergeDelimitedForSync(rootAgents, templatesAgents),
            [
                '# AGENTS',
                '',
                '<!-- canon:start -->',
                'root-canon-content',
                '<!-- canon:end -->',
                'adopter-tail',
                '',
            ].join('\n'),
        );
        assert.deepEqual(syncCanonTemplates.checkSync(root), ['templates/AGENTS.md']);
        assert.deepEqual(syncCanonTemplates.applySync(root), ['templates/AGENTS.md']);
        assert.equal(
            fs.readFileSync(path.join(root, 'templates/AGENTS.md'), 'utf8'),
            [
                '# AGENTS',
                '',
                '<!-- canon:start -->',
                'root-canon-content',
                '<!-- canon:end -->',
                'adopter-tail',
                '',
            ].join('\n'),
        );
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'templates/AGENTS.md'), 'utf8'), /root-tail/);
        assert.deepEqual(syncCanonTemplates.checkSync(root), []);
    });
});

void test('mergeDelimitedForSync returns null when either side is missing canon markers', () => {
    assert.equal(syncCanonTemplates.mergeDelimitedForSync('# AGENTS\nplain\n', '# AGENTS\n<!-- canon:start -->\nbody\n<!-- canon:end -->\n'), null);
    assert.equal(syncCanonTemplates.mergeDelimitedForSync('# AGENTS\n<!-- canon:start -->\nbody\n<!-- canon:end -->\n', '# AGENTS\nplain\n'), null);
});

void test('checkSync CLI exits 0 for clean fixtures and 1 for drifted fixtures', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        writeFile(root, 'docs/pipeline-orchestrator.md', 'same content\n');
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'same content\n');
        writeFile(root, 'AGENTS.md', [
            '# AGENTS',
            '',
            '<!-- canon:start -->',
            'same',
            '<!-- canon:end -->',
            '',
        ].join('\n'));
        writeFile(root, 'templates/AGENTS.md', [
            '# AGENTS',
            '',
            '<!-- canon:start -->',
            'same',
            '<!-- canon:end -->',
            '',
        ].join('\n'));

        const clean = runCheckCli(root);
        assert.equal(clean.status, 0, clean.stderr);
        assert.match(clean.stdout, /All canon-managed files in sync/);
        assert.equal(clean.stderr, '');

        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'drifted content\n');
        const drifted = runCheckCli(root);
        assert.equal(drifted.status, 1, drifted.stdout);
        assert.match(drifted.stderr, /\[wholesale\] templates\/docs\/pipeline-orchestrator\.md differs from docs\/pipeline-orchestrator\.md/);
    });
});

void test('applySync is idempotent on a freshly synced fixture', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        writeFile(root, 'docs/pipeline-orchestrator.md', 'root pipeline\n');
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'stale pipeline\n');

        assert.deepEqual(syncCanonTemplates.applySync(root), ['templates/docs/pipeline-orchestrator.md']);
        assert.deepEqual(syncCanonTemplates.applySync(root), []);
    });
});

void test('pre-commit hook stages templates changes into the same git commit', () => {
    withTempDir(root => {
        const hookPath = path.join(root, '.git/hooks/pre-commit');
        const rootDoc = path.join(root, 'docs/pipeline-orchestrator.md');
        const templateDoc = path.join(root, 'templates/docs/pipeline-orchestrator.md');

        const git = (args: string[]): string => {
            const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr ?? result.stdout ?? `git ${args.join(' ')} failed`);
            return result.stdout.trim();
        };

        git(['init']);
        git(['config', 'user.email', 'sync@example.com']);
        git(['config', 'user.name', 'Sync Example']);
        seedCanonFixture(root);
        writeFile(root, 'docs/pipeline-orchestrator.md', 'root v1\n');
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'templates v1\n');

        fs.mkdirSync(path.dirname(hookPath), { recursive: true });
        fs.writeFileSync(hookPath, [
            '#!/bin/sh',
            'set -eu',
            `"${tsxBin}" "${scriptPath}" --stage`,
            '',
        ].join('\n'), 'utf8');
        fs.chmodSync(hookPath, 0o755);

        git(['add', 'docs/pipeline-orchestrator.md']);
        git(['commit', '-m', 'test']);

        const changedFiles = git(['log', '-1', '--name-only', '--pretty=format:']).split('\n').filter(Boolean);
        assert.ok(changedFiles.includes('docs/pipeline-orchestrator.md'));
        assert.ok(changedFiles.includes('templates/docs/pipeline-orchestrator.md'));
        assert.equal(fs.readFileSync(rootDoc, 'utf8'), 'root v1\n');
        assert.equal(fs.readFileSync(templateDoc, 'utf8'), 'root v1\n');
    });
});

// --- Error cases (Codex P1 on PR #102) -----------------------------------
// Before this fix, buildSyncPlan logged these to stderr and continued —
// `--check` returned 0 with "All canon-managed files in sync" even when a
// canon-managed file was corrupted. Each case below must:
//   - surface via findSyncErrors (programmatic API)
//   - exit the --check CLI with status 1 and a descriptive stderr message

void test('findSyncErrors flags a wholesale target whose source is missing', () => {
    withTempDir(root => {
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'orphaned\n');
        const errors = syncCanonTemplates.findSyncErrors(root);
        // Empty temp dirs trip the "missing on both sides" check for every
        // other canon-managed file too — assert the specific pattern is
        // present rather than asserting total count.
        assert.ok(
            errors.some(e => /\[wholesale\] templates\/docs\/pipeline-orchestrator\.md exists but source docs\/pipeline-orchestrator\.md is missing/.test(e)),
            `expected "exists but source missing" error; got: ${errors.join(' | ')}`,
        );
    });
});

void test('findSyncErrors flags wholesale canon-managed source missing on both sides', () => {
    withTempDir(root => {
        // Don't write either side — covers the "deleted from both, but still
        // in CANON_OWNED" corruption. Codex P1 round 2 on PR #102.
        const errors = syncCanonTemplates.findSyncErrors(root);
        // Every entry in WHOLESALE_SYNC is missing in an empty repo, so all of
        // them fire. The important thing: each fires with the "no source, no
        // mirror" message, not silent success.
        assert.ok(errors.length > 0, 'expected at least one error for an empty repo');
        for (const error of errors) {
            assert.match(error, /no source, no mirror/);
        }
    });
});

void test('findSyncErrors flags delimited canon-managed source missing on both sides', () => {
    withTempDir(root => {
        // Set up every WHOLESALE_SYNC entry so only the DELIMITED loop produces
        // errors. The AGENTS.md / CLAUDE.md / CODEX.md sources are absent on
        // both sides; the delimited loop must flag each.
        for (const wholesalePath of (syncCanonTemplatesRaw as unknown as { WHOLESALE_SYNC: readonly string[] }).WHOLESALE_SYNC) {
            writeFile(root, wholesalePath, 'placeholder\n');
            writeFile(root, `templates/${wholesalePath}`, 'placeholder\n');
        }
        const errors = syncCanonTemplates.findSyncErrors(root);
        const delimitedErrors = errors.filter(e => e.startsWith('[delimited]'));
        assert.ok(delimitedErrors.length > 0, 'expected delimited errors for missing AGENTS/CLAUDE/CODEX sources');
        for (const error of delimitedErrors) {
            assert.match(error, /no source, no mirror|cannot sync/);
        }
    });
});

void test('checkSync CLI exits 1 when a wholesale source is missing but the target exists', () => {
    withTempDir(root => {
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'orphaned\n');
        const result = runCheckCli(root);
        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /\[wholesale\] templates\/docs\/pipeline-orchestrator\.md exists but source/);
        assert.doesNotMatch(result.stdout, /All canon-managed files in sync/);
    });
});

void test('findSyncErrors flags a delimited templates/ file missing canon markers', () => {
    withTempDir(root => {
        writeFile(root, 'AGENTS.md', '# AGENTS\n<!-- canon:start -->\nbody\n<!-- canon:end -->\n');
        writeFile(root, 'templates/AGENTS.md', '# AGENTS\nplain — markers gone\n');
        const errors = syncCanonTemplates.findSyncErrors(root);
        assert.ok(
            errors.some(e => /\[delimited\] templates\/AGENTS\.md is missing canon delimiters/.test(e)),
            `expected "templates AGENTS missing markers" error; got: ${errors.join(' | ')}`,
        );
    });
});

void test('checkSync CLI exits 1 when a delimited templates/ file is missing canon markers', () => {
    withTempDir(root => {
        writeFile(root, 'AGENTS.md', '# AGENTS\n<!-- canon:start -->\nbody\n<!-- canon:end -->\n');
        writeFile(root, 'templates/AGENTS.md', '# AGENTS\nplain — markers gone\n');
        const result = runCheckCli(root);
        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /\[delimited\] templates\/AGENTS\.md is missing canon delimiters/);
        assert.doesNotMatch(result.stdout, /All canon-managed files in sync/);
    });
});

void test('findSyncErrors flags a delimited root file missing canon markers', () => {
    withTempDir(root => {
        writeFile(root, 'AGENTS.md', '# AGENTS\nplain — markers gone\n');
        writeFile(root, 'templates/AGENTS.md', '# AGENTS\n<!-- canon:start -->\nbody\n<!-- canon:end -->\n');
        const errors = syncCanonTemplates.findSyncErrors(root);
        assert.ok(
            errors.some(e => /\[delimited\] source AGENTS\.md is missing canon delimiters/.test(e)),
            `expected "source AGENTS missing markers" error; got: ${errors.join(' | ')}`,
        );
    });
});

void test('findSyncErrors flags a delimited pair where neither side has canon markers', () => {
    withTempDir(root => {
        writeFile(root, 'AGENTS.md', '# AGENTS\nno markers here\n');
        writeFile(root, 'templates/AGENTS.md', '# AGENTS\nno markers here either\n');
        const errors = syncCanonTemplates.findSyncErrors(root);
        assert.ok(
            errors.some(e => /\[delimited\] both AGENTS\.md and templates\/AGENTS\.md are missing canon delimiters/.test(e)),
            `expected "both AGENTS missing markers" error; got: ${errors.join(' | ')}`,
        );
    });
});

void test('applySync CLI exits 1 (not 0) when errors are present', () => {
    withTempDir(root => {
        // Set up a clean wholesale pair AND a broken delimited pair.
        writeFile(root, 'docs/pipeline-orchestrator.md', 'same\n');
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'same\n');
        writeFile(root, 'AGENTS.md', '# AGENTS\n<!-- canon:start -->\nbody\n<!-- canon:end -->\n');
        writeFile(root, 'templates/AGENTS.md', '# AGENTS\nno markers\n');

        const result = spawnSync(tsxBin, [scriptPath, '--apply'], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /\[delimited\] templates\/AGENTS\.md is missing canon delimiters/);
        // The broken file is NOT overwritten (still plain).
        assert.equal(fs.readFileSync(path.join(root, 'templates/AGENTS.md'), 'utf8'), '# AGENTS\nno markers\n');
    });
});
