import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../scripts/docs-refs-check.mjs';

function makeTempRepo(
    setup: (root: string) => void,
    run: (root: string) => void,
): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-refs-check-'));
    try {
        setup(root);
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

function runCli(scriptPath: string, repoRoot: string) {
    return spawnSync(process.execPath, [scriptPath, repoRoot], {
        encoding: 'utf8',
    });
}

const scriptPath = path.resolve('scripts/docs-refs-check.mjs');

void test('backtick file-path refs: existing path passes', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/backtick-ok.md', 'See `scripts/fixture-target.ts`.\n');
            writeFile(root, 'scripts/fixture-target.ts', 'export const fixtureTarget = true;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('backtick file-path refs: missing path fails', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/backtick-missing.md', 'See `scripts/missing-target.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/backtick-missing.md',
                    line: 1,
                    ref: '`scripts/missing-target.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('symbol-in-file refs: symbol present passes', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/symbol-ok.md', 'See `FixtureSymbol` in `src/fixture.ts`.\n');
            writeFile(root, 'src/fixture.ts', 'export const FixtureSymbol = 1;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('symbol-in-file refs: symbol missing fails', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/symbol-missing.md', 'See `MissingSymbol` in `src/fixture.ts`.\n');
            writeFile(root, 'src/fixture.ts', 'export const ExistingSymbol = 1;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/symbol-missing.md',
                    line: 1,
                    ref: '`MissingSymbol` in `src/fixture.ts`',
                    reason: 'symbol not found',
                },
            ]);
        },
    );
});

void test('section refs: existing heading passes', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/section-source.md', 'See `docs/section-target.md` §"Target Heading".\n');
            writeFile(root, 'docs/section-target.md', '# Title\n\n## Target Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('section refs: missing heading fails', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/section-source.md', 'See `docs/section-target.md` §"Missing Heading".\n');
            writeFile(root, 'docs/section-target.md', '# Title\n\n## Target Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/section-source.md',
                    line: 1,
                    ref: '`docs/section-target.md` §"Missing Heading"',
                    reason: 'heading not found',
                },
            ]);
        },
    );
});

void test('anchor links: same-file anchor passes', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/anchors.md', '# Title\n\n## Anchor Heading\n\n[link](#anchor-heading)\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('anchor links: same-file missing anchor fails', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/anchors.md', '# Title\n\n## Anchor Heading\n\n[link](#missing-anchor)\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/anchors.md',
                    line: 5,
                    ref: '[link](#missing-anchor)',
                    reason: 'anchor not found',
                },
            ]);
        },
    );
});

void test('anchor links: cross-file anchor passes', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'README.md', '[link](docs/target.md#cross-file-heading)\n');
            writeFile(root, 'docs/target.md', '# Title\n\n## Cross File Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('anchor links: cross-file missing anchor fails', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'README.md', '[link](docs/target.md#missing-anchor)\n');
            writeFile(root, 'docs/target.md', '# Title\n\n## Cross File Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'README.md',
                    line: 1,
                    ref: '[link](docs/target.md#missing-anchor)',
                    reason: 'anchor not found',
                },
            ]);
        },
    );
});

void test('templates/** markdown is scanned (broken ref in templates/AGENTS.md is reported)', () => {
    // Regression for Codex P1 review finding on PR #98: templates/** was
    // wholesale excluded from scanning, so broken refs in canon-shipped
    // template docs propagated to adopters via `canon upgrade` silently.
    makeTempRepo(
        root => {
            writeFile(root, 'templates/AGENTS.md', 'See `scripts/missing-target.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'templates/AGENTS.md',
                    line: 1,
                    ref: '`scripts/missing-target.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('templates/docs/**/*.md is also scanned (not just root-level templates)', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'templates/docs/codebase-map.md', 'See `scripts/missing.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'templates/docs/codebase-map.md',
                    line: 1,
                    ref: '`scripts/missing.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('anchor links: relative-path cross-file anchor passes when target exists', () => {
    // Regression for Codex P2 review finding on PR #98: relative-path
    // anchor link targets (e.g., `../AGENTS.md#section`) were silently
    // skipped by the allow-list because `isAllowedDocTarget` only accepts
    // root-style paths. They must be validated like absolute targets.
    makeTempRepo(
        root => {
            writeFile(root, 'docs/source.md', '[link](../AGENTS.md#validation-matrix)\n');
            writeFile(root, 'AGENTS.md', '# Title\n\n## Validation Matrix\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('anchor links: relative-path cross-file missing anchor fails', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/source.md', '[link](../AGENTS.md#missing-section)\n');
            writeFile(root, 'AGENTS.md', '# Title\n\n## Validation Matrix\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/source.md',
                    line: 1,
                    ref: '[link](../AGENTS.md#missing-section)',
                    reason: 'anchor not found',
                },
            ]);
        },
    );
});

void test('docs-refs-check exits 0 with empty stderr on a clean fixture', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/clean.md', 'Plain prose only.\n');
        },
        root => {
            const result = runCli(scriptPath, root);
            assert.equal(result.status, 0);
            assert.equal(result.stderr, '');
            assert.match(result.stdout, /All refs OK/);
        },
    );
});

void test('docs-refs-check exits non-zero and reports a broken ref on stderr', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/broken.md', 'See `scripts/missing-target.ts`.\n');
        },
        root => {
            const result = runCli(scriptPath, root);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /docs\/broken\.md:1: `scripts\/missing-target\.ts` — missing file/);
            assert.match(result.stderr, /Found 1 broken ref/);
        },
    );
});
