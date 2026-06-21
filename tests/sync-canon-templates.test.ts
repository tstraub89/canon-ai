import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as syncCanonTemplatesRaw from '../scripts/sync-canon-templates.mjs';
import { CANON_GITIGNORE_BLOCK } from '../src/lib/canon-block.js';

type SyncCanonTemplatesModule = {
    applySync(repoRoot: string): string[];
    INTERNAL_ONLY_TEMPLATE_BASENAMES: ReadonlySet<string>;
    checkSync(repoRoot: string): string[];
    findSyncErrors(repoRoot: string): string[];
    mergeDelimitedForSync(rootContent: string, templatesContent: string): string | null;
};

const syncCanonTemplates = syncCanonTemplatesRaw as unknown as SyncCanonTemplatesModule;
const internalOnlyTemplateBasenames = syncCanonTemplates.INTERNAL_ONLY_TEMPLATE_BASENAMES;

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
    writeFile(root, 'templates/.gitignore', CANON_GITIGNORE_BLOCK);
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

void test('mergeDelimitedForSync: preserves outside-delimiter content and ignores root tail', () => {
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

void test('gitignore sync rewrites templates/.gitignore from the shared constant', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        writeFile(root, 'templates/.gitignore', 'stale\n');

        assert.deepEqual(syncCanonTemplates.checkSync(root), ['templates/.gitignore']);
        assert.deepEqual(syncCanonTemplates.applySync(root), ['templates/.gitignore']);
        assert.equal(fs.readFileSync(path.join(root, 'templates/.gitignore'), 'utf8'), CANON_GITIGNORE_BLOCK);
        assert.deepEqual(syncCanonTemplates.checkSync(root), []);
    });
});

void test('gitignore sync is clean when templates/.gitignore matches the shared constant', () => {
    withTempDir(root => {
        seedCanonFixture(root);

        assert.deepEqual(syncCanonTemplates.checkSync(root), []);
        assert.deepEqual(syncCanonTemplates.applySync(root), []);
    });
});

void test('gitignore sync first-creates missing templates/.gitignore without a source error', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        fs.rmSync(path.join(root, 'templates/.gitignore'));

        assert.deepEqual(syncCanonTemplates.checkSync(root), ['templates/.gitignore']);
        assert.deepEqual(syncCanonTemplates.findSyncErrors(root), []);
        assert.deepEqual(syncCanonTemplates.applySync(root), ['templates/.gitignore']);
        assert.equal(fs.readFileSync(path.join(root, 'templates/.gitignore'), 'utf8'), CANON_GITIGNORE_BLOCK);
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

void test('checkSync CLI exits 1 when a wholesale source is missing but the target exists', () => {
    withTempDir(root => {
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', 'orphaned\n');
        const result = runCheckCli(root);
        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /\[wholesale\] templates\/docs\/pipeline-orchestrator\.md exists but source/);
        assert.doesNotMatch(result.stdout, /All canon-managed files in sync/);
    });
});

// --- Canon-internal-leak guard ------------------------------------------
// Backtick refs to canon's orchestrator source (`scripts/run-task/...`)
// must not appear in canon-managed shipped content — adopter repos don't
// have those files, and the leak surfaces as broken refs in their
// `docs-refs-check.mjs` at upgrade time. Pre-1.6.1, four such refs leaked
// into 1.6.0 (operator docs and docs/pipeline-orchestrator.md), motivating
// this guard.

void test('findSyncErrors flags canon-internal leak in a wholesale-synced markdown file', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        writeFile(
            root,
            'docs/pipeline-orchestrator.md',
            'See `commitHumanReviewFiles` in `scripts/run-task/main.ts` for details.\n',
        );
        writeFile(
            root,
            'templates/docs/pipeline-orchestrator.md',
            'See `commitHumanReviewFiles` in `scripts/run-task/main.ts` for details.\n',
        );

        const errors = syncCanonTemplates.findSyncErrors(root);
        assert.ok(
            errors.some(e => /\[canon-internal-leak\] docs\/pipeline-orchestrator\.md:1 .*scripts\/run-task\/main\.ts/.test(e)),
            `expected canon-internal-leak error for docs/pipeline-orchestrator.md; got: ${errors.join(' | ')}`,
        );
    });
});

void test('findSyncErrors flags bare internal-only prompt-template basenames in wholesale-synced markdown', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        const content = [
            'See `qa.md` for canon QA rules.',
            'See `implement.md` for the implementation prompt.',
            '',
        ].join('\n');
        writeFile(root, 'docs/pipeline-orchestrator.md', content);
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', content);

        const errors = syncCanonTemplates.findSyncErrors(root);
        const leakErrors = errors.filter(e => e.startsWith('[canon-internal-leak]'));
        assert.equal(leakErrors.length, 2, `expected two canon-internal-leak errors; got: ${leakErrors.join(' | ')}`);
        assert.ok(
            leakErrors.some(e => /\[canon-internal-leak\] docs\/pipeline-orchestrator\.md:1 .*`qa\.md`/.test(e)),
            `expected canon-internal-leak error for bare \`qa.md\`; got: ${leakErrors.join(' | ')}`,
        );
        assert.ok(
            leakErrors.some(e => /\[canon-internal-leak\] docs\/pipeline-orchestrator\.md:2 .*`implement\.md`/.test(e)),
            `expected canon-internal-leak error for bare \`implement.md\`; got: ${leakErrors.join(' | ')}`,
        );
        assert.ok(
            internalOnlyTemplateBasenames.has('implement.md'),
            'expected implement.md to be in INTERNAL_ONLY_TEMPLATE_BASENAMES',
        );
        assert.ok(
            !internalOnlyTemplateBasenames.has('spec.md'),
            'expected spec.md to be excluded from INTERNAL_ONLY_TEMPLATE_BASENAMES',
        );
    });
});

void test('findSyncErrors does NOT flag bare colliding-name refs (spec.md, plan.md, spec-review.md)', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        const content = [
            'Review `spec.md` before editing.',
            'Review `plan.md` before editing.',
            'Review `spec-review.md` before editing.',
            '',
        ].join('\n');
        writeFile(root, 'docs/pipeline-orchestrator.md', content);
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', content);

        const errors = syncCanonTemplates.findSyncErrors(root);
        const leakErrors = errors.filter(e => e.startsWith('[canon-internal-leak]'));
        assert.deepEqual(
            leakErrors,
            [],
            `expected no [canon-internal-leak] errors for colliding-name bare refs; got: ${leakErrors.join(' | ')}`,
        );
    });
});

void test('findSyncErrors does NOT flag canon-internal refs inside fenced code blocks', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        // Fenced blocks are example/illustration territory — refs inside
        // them are not adopter-targeted assertions. Fence-aware scanning
        // mirrors docs-refs-check.mjs behavior.
        const fenced = [
            '',
            'Example only — do not copy:',
            '',
            '```',
            'grep scripts/run-task/main.ts',
            'cat `scripts/run-task/git.ts`',
            '```',
            '',
        ].join('\n');
        writeFile(root, 'docs/pipeline-orchestrator.md', fenced);
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', fenced);

        const errors = syncCanonTemplates.findSyncErrors(root);
        const leakErrors = errors.filter(e => e.startsWith('[canon-internal-leak]'));
        assert.deepEqual(
            leakErrors,
            [],
            `expected no canon-internal-leak errors for fenced refs; got: ${leakErrors.join(' | ')}`,
        );
    });
});

void test('findSyncErrors flags canon-internal leaks reached via source-file-relative refs', () => {
    // Codex P2 finding on the 1.6.1 hotfix-leak diff: a maintainer can
    // bypass the literal-prefix check by writing the ref as a relative
    // path from a nested doc, e.g., `../scripts/run-task/main.ts` from
    // `docs/pipeline-orchestrator.md`. Normalization resolves both forms
    // to the same canon-internal file.
    withTempDir(root => {
        seedCanonFixture(root);
        const relativeLeak = 'See `../scripts/run-task/main.ts` for the impl.\n';
        writeFile(root, 'docs/pipeline-orchestrator.md', relativeLeak);
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', relativeLeak);

        const errors = syncCanonTemplates.findSyncErrors(root);
        assert.ok(
            errors.some(e => /\[canon-internal-leak\] docs\/pipeline-orchestrator\.md:1 .*\.\.\/scripts\/run-task\/main\.ts/.test(e)),
            `expected canon-internal-leak error for relative ref; got: ${errors.join(' | ')}`,
        );
    });
});

void test('findSyncErrors does NOT flag refs that resolve outside the repo root', () => {
    // A relative ref that escapes the repo (`../../something`) cannot
    // resolve to a canon-internal file — it points outside the checkout
    // and would itself be a broken ref. Don't false-positive on it.
    withTempDir(root => {
        seedCanonFixture(root);
        const escapingRef = 'See `../../somewhere-else/main.ts` for details.\n';
        writeFile(root, 'docs/pipeline-orchestrator.md', escapingRef);
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', escapingRef);

        const errors = syncCanonTemplates.findSyncErrors(root);
        const leakErrors = errors.filter(e => e.startsWith('[canon-internal-leak]'));
        assert.deepEqual(
            leakErrors,
            [],
            `expected no canon-internal-leak errors for repo-escaping refs; got: ${leakErrors.join(' | ')}`,
        );
    });
});

void test('checkSync CLI exits 1 with a canon-internal-leak message when a leak is present', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        const leaky = 'See `scripts/run-task/validation.ts` for base-drift checks.\n';
        writeFile(root, 'docs/pipeline-orchestrator.md', leaky);
        writeFile(root, 'templates/docs/pipeline-orchestrator.md', leaky);

        const result = runCheckCli(root);
        assert.equal(result.status, 1, result.stdout);
        assert.match(
            result.stderr,
            /\[canon-internal-leak\] docs\/pipeline-orchestrator\.md:1 .*scripts\/run-task\/validation\.ts/,
        );
        assert.doesNotMatch(result.stdout, /All canon-managed files in sync/);
    });
});
