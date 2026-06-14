import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    NOISY_SOURCE_PATHS,
    VALID_DIRS,
    loadAdopterConfig,
    mergeAdopterConfig,
    runChecks,
} from '../scripts/docs-refs-check.mjs';

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

async function makeTempRepoAsync(
    setup: (root: string) => void | Promise<void>,
    run: (root: string) => void | Promise<void>,
): Promise<void> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-refs-check-'));
    try {
        await setup(root);
        await run(root);
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

void test('line-citation refs: ascii hyphen, en-dash, and em-dash all pass', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/line-cites.md',
                [
                    'ASCII: `scripts/fixture-target.ts:10-20`.',
                    'En-dash: `scripts/fixture-target.ts:30–40`.',
                    'Em-dash: `scripts/fixture-target.ts:50—60`.',
                    'Single line: `scripts/fixture-target.ts:5`.',
                    'GitHub anchor: `scripts/fixture-target.ts#L10-L20`.',
                    'GitHub en-dash: `scripts/fixture-target.ts#L30–L40`.',
                    '',
                ].join('\n'),
            );
            writeFile(root, 'scripts/fixture-target.ts', 'export const fixtureTarget = true;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('line-citation refs: comma-list citation on an existing file passes', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/comma-list-ok.md',
                'See `scripts/fixture-target.ts:151,254`.\n',
            );
            writeFile(root, 'scripts/fixture-target.ts', 'export const fixtureTarget = true;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('line-citation refs: missing file reports the full cited ref text', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/comma-list-missing.md',
                'See `src/does-not-exist.ts:151,254`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/comma-list-missing.md',
                    line: 1,
                    ref: '`src/does-not-exist.ts:151,254`',
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

void test('NOISY_SOURCE_PATHS: directory-prefix skip silences files under that tree, not adjacent names', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/archive/old.md', 'See `scripts/nonexistent.ts`.\n');
            writeFile(root, 'docs/archive-notes/file.md', 'See `scripts/nonexistent.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root, { skipPaths: ['docs/archive'] }), [
                {
                    file: 'docs/archive-notes/file.md',
                    line: 1,
                    ref: '`scripts/nonexistent.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('NOISY_SOURCE_PATHS: exact-file skip silences only that file, not paths that string-start-with it', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/changelogs.md', 'See `scripts/nonexistent.ts`.\n');
            writeFile(root, 'docs/changelogs.md-notes/file.md', 'See `scripts/nonexistent.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root, { skipPaths: ['docs/changelogs.md'] }), [
                {
                    file: 'docs/changelogs.md-notes/file.md',
                    line: 1,
                    ref: '`scripts/nonexistent.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('NOISY_SOURCE_PATHS: trailing slash on entry is normalized away', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/archive/old.md', 'See `scripts/nonexistent.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root, { skipPaths: ['docs/archive/'] }), []);
        },
    );
});

void test('config merge: bare defaults exclude templates, real config re-adds templates', async () => {
    const bare = mergeAdopterConfig(null);
    assert.ok(!bare.validDirs.has('templates'));
    assert.ok(!bare.markdownRootDirs.includes('templates'));

    const configPath = path.resolve('scripts/docs-refs-config.mjs');
    const adopterConfig = await loadAdopterConfig(configPath);
    assert.ok(adopterConfig);

    const merged = mergeAdopterConfig(adopterConfig);
    assert.ok(merged.validDirs.has('templates'));
    assert.ok(merged.markdownRootDirs.includes('templates'));
});

void test('module exports VALID_DIRS as a Set and NOISY_SOURCE_PATHS as an array', () => {
    assert.ok(VALID_DIRS instanceof Set);
    assert.ok(Array.isArray(NOISY_SOURCE_PATHS));
});

void test('config merge: noisySourcePaths skips archive sources only when configured', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/archive/inside.md', 'See `scripts/missing.ts`.\n');
            writeFile(root, 'docs/visible/outside.md', 'See `scripts/missing.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root, { adopterConfig: null }), [
                {
                    file: 'docs/archive/inside.md',
                    line: 1,
                    ref: '`scripts/missing.ts`',
                    reason: 'missing file',
                },
                {
                    file: 'docs/visible/outside.md',
                    line: 1,
                    ref: '`scripts/missing.ts`',
                    reason: 'missing file',
                },
            ]);

            assert.deepEqual(runChecks(root, { adopterConfig: { noisySourcePaths: ['docs/archive'] } }), [
                {
                    file: 'docs/visible/outside.md',
                    line: 1,
                    ref: '`scripts/missing.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('config merge: validDirs validates infra refs only when configured', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/allowlist.md', 'See `infra/foo.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root, { adopterConfig: null }), []);

            assert.deepEqual(runChecks(root, { adopterConfig: { validDirs: ['infra'] } }), [
                {
                    file: 'docs/allowlist.md',
                    line: 1,
                    ref: '`infra/foo.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('config merge: markdownRootDirs walks documentation only when configured', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'documentation/broken.md', 'See `scripts/missing.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root, { adopterConfig: null }), []);

            assert.deepEqual(runChecks(root, { adopterConfig: { markdownRootDirs: ['documentation'] } }), [
                {
                    file: 'documentation/broken.md',
                    line: 1,
                    ref: '`scripts/missing.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('malformed config degrades to defaults without throwing', async () => {
    await makeTempRepoAsync(
        root => {
            writeFile(root, 'docs/fallback.md', 'See `scripts/missing.ts`.\n');
        },
        async root => {
            const syntaxErrorPath = path.join(root, 'scripts', 'docs-refs-config.mjs');
            fs.mkdirSync(path.dirname(syntaxErrorPath), { recursive: true });
            fs.writeFileSync(syntaxErrorPath, 'export const validDirs = [\n', 'utf8');
            assert.equal(await loadAdopterConfig(syntaxErrorPath), null);

            const wrongShapePath = path.join(root, 'scripts', 'docs-refs-config-wrong-shape.mjs');
            fs.writeFileSync(
                wrongShapePath,
                [
                    "export const noisySourcePaths = 'docs/archive';",
                    "export const validDirs = 'infra';",
                    "export const markdownRootDirs = 'documentation';",
                    '',
                ].join('\n'),
                'utf8',
            );
            // Wrong-shape exports are no longer rejected at the loader — it is a
            // thin pass-through. mergeAdopterConfig is the single validator and
            // coerces the non-array values back to canon defaults, so a
            // wrong-shape config is equivalent to no config at all.
            assert.deepEqual(
                mergeAdopterConfig(await loadAdopterConfig(wrongShapePath)),
                mergeAdopterConfig(null),
            );

            assert.deepEqual(runChecks(root, { adopterConfig: await loadAdopterConfig(wrongShapePath) }), [
                {
                    file: 'docs/fallback.md',
                    line: 1,
                    ref: '`scripts/missing.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('partial config file: a single exported array is honored, not dropped', async () => {
    await makeTempRepoAsync(
        root => {
            writeFile(root, 'docs/archive/inside.md', 'See `scripts/missing.ts`.\n');
            writeFile(root, 'docs/visible/outside.md', 'See `scripts/missing.ts`.\n');
        },
        async root => {
            // A real adopter config FILE that exports ONLY noisySourcePaths and
            // omits validDirs / markdownRootDirs. The old all-or-nothing loader
            // returned null here, silently dropping the skip entry. The single
            // exported array must survive the file-load path.
            const configPath = path.join(root, 'scripts', 'docs-refs-config.mjs');
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, "export const noisySourcePaths = ['docs/archive'];\n", 'utf8');

            assert.deepEqual(runChecks(root, { adopterConfig: await loadAdopterConfig(configPath) }), [
                {
                    file: 'docs/visible/outside.md',
                    line: 1,
                    ref: '`scripts/missing.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('isPlaceholderTarget: backtick ref containing ... is treated as placeholder', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/ellipsis.md', 'See `src/...`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('NOISY_SOURCE_PATHS: module default skip list is consulted when no options are passed', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/archive/old.md', 'See `scripts/nonexistent.ts`.\n');
        },
        root => {
            NOISY_SOURCE_PATHS.push('docs/archive');
            try {
                assert.deepEqual(runChecks(root), []);
            } finally {
                NOISY_SOURCE_PATHS.length = 0;
            }

            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/archive/old.md',
                    line: 1,
                    ref: '`scripts/nonexistent.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('docs-refs-check CLI: repoRoot config is loaded from the target repo, not the checker install location', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'scripts/docs-refs-config.mjs',
                [
                    "export const noisySourcePaths = [];",
                    "export const validDirs = ['infra'];",
                    "export const markdownRootDirs = ['documentation'];",
                    '',
                ].join('\n'),
            );
            writeFile(root, 'documentation/broken.md', 'See `infra/missing.ts`.\n');
        },
        root => {
            const result = runCli(scriptPath, root);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /documentation\/broken\.md:1: `infra\/missing\.ts` — missing file/);
            assert.match(result.stderr, /Found 1 broken ref/);
        },
    );
});

void test('tasks/<id>/notes.md is exempt: hypothetical ref to a missing file passes', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'tasks/example-task/notes.md',
                'Codex tried `scripts/never-existed.ts` but it did not exist.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('tasks/<id>/spec-review.md is exempt: hypothetical ref to a missing file passes', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'tasks/example-task/spec-review.md',
                'The spec should test against `docs/imagined-fixture.md`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('tasks/<id>/handoff.md is NOT exempt: broken ref still fails (record of real work)', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'tasks/example-task/handoff.md',
                'Changes touched `scripts/never-existed.ts`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'tasks/example-task/handoff.md',
                    line: 1,
                    ref: '`scripts/never-existed.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('symbol-in-file refs: placeholder symbol (contains ...) passes even when target exists', () => {
    // Regression for the canon-docs-dedup done.md failure on
    // `<!-- canon:start -->...<!-- canon:end -->` in `AGENTS.md`. The
    // target exists; the symbol contains `...` and is a placeholder
    // describing a marker range, not a literal string to find. Symmetric
    // with the target-side `...` handling shipped in PR #101.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/symbol-placeholder.md',
                'Edit between `<!-- canon:start -->...<!-- canon:end -->` in `AGENTS.md`.\n',
            );
            writeFile(root, 'AGENTS.md', '<!-- canon:start -->\n\nstuff\n\n<!-- canon:end -->\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('symbol-in-file refs: common identifier names (id, name, task) are NOT placeholders for symbol validation', () => {
    // Codex P2 round 4: PLACEHOLDER_SEGMENTS is path-oriented and would
    // silently bypass real symbol refs whose names happen to overlap
    // (`id`, `name`, `task`, etc.). The narrower isPlaceholderSymbol
    // only short-circuits on the `...` marker-range pattern.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/symbol-named-id.md',
                'See `id` in `src/types.ts`.\n',
            );
            writeFile(root, 'src/types.ts', 'export const counter = 1;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/symbol-named-id.md',
                    line: 1,
                    ref: '`id` in `src/types.ts`',
                    reason: 'symbol not found',
                },
            ]);
        },
    );
});

void test('symbol-in-file refs: non-placeholder symbol genuinely missing still fails (negative control)', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/symbol-real-miss.md',
                'See `GenuinelyMissingSymbol` in `src/fixture.ts`.\n',
            );
            writeFile(root, 'src/fixture.ts', 'export const ExistingSymbol = 1;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/symbol-real-miss.md',
                    line: 1,
                    ref: '`GenuinelyMissingSymbol` in `src/fixture.ts`',
                    reason: 'symbol not found',
                },
            ]);
        },
    );
});

void test('gitignored target paths are skipped (no finding when target is gitignored)', () => {
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', '.claude/settings.local.json\n');
            writeFile(
                root,
                'docs/gitignored-ref.md',
                'See `.claude/settings.local.json`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored target paths are skipped when a symlinked 128-causer appears in the same fixture', () => {
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', 'docs/real/ignored.md\n');
            fs.mkdirSync(path.join(root, 'docs', 'real'), { recursive: true });
            fs.mkdirSync(path.join(root, 'content'), { recursive: true });
            fs.writeFileSync(path.join(root, 'content', 'through-symlink.md'), '# Symlink target\n');
            fs.symlinkSync(path.join(root, 'content'), path.join(root, 'docs', 'link'), 'dir');
            writeFile(
                root,
                'docs/gitignored-line-cited-ref.md',
                'See `docs/link/through-symlink.md` and `docs/real/ignored.md:151,254`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored skip survives parent-relative anchor links elsewhere in the repo', () => {
    // Regression for Codex review on this change: `../AGENTS.md` from a
    // nested doc gets fed raw into `git check-ignore`, which exits 128
    // ("outside repository") and tanks the whole batch. Without the
    // safe-filter, the gitignored skip would silently disable itself
    // for the entire run.
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', '.claude/settings.local.json\n');
            writeFile(root, 'AGENTS.md', '# Title\n\n## Section\n');
            writeFile(
                root,
                'docs/nested/source.md',
                'See [section](../../AGENTS.md#section). Also ref `.claude/settings.local.json`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored skip survives backtick refs to outside-repo paths in scanned docs', () => {
    // Regression for Codex P1: this repo has docs with refs like
    // `` `../dev-worktrees` `` (e.g., docs/codebase-map.md). Without
    // the outside-repo safety filter in collectGitIgnoredTargets, those
    // make git check-ignore exit 128 and silently disable the
    // gitignored skip for the whole run.
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', '.claude/settings.local.json\n');
            writeFile(
                root,
                'docs/refs.md',
                'See `../dev-worktrees` and `.claude/settings.local.json`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored skip survives slash-command backtick refs in scanned docs', () => {
    // Regression for Codex P1 round 3: this repo's docs contain refs
    // like `` `/canon-spec` ``. Git treats those as absolute paths and
    // exits 128, which would tank the whole batch and disable the
    // gitignored skip.
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', '.claude/settings.local.json\n');
            writeFile(
                root,
                'docs/refs.md',
                'Run `/canon-spec` then ref `.claude/settings.local.json`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored markdown source files are skipped from scanning (self-anchor false positive)', () => {
    // Codex P2 round 3: a generated/local-only `docs/generated.md`
    // with `[link](#missing-anchor)` would otherwise produce an
    // "anchor not found" finding even though the source file itself
    // is gitignored.
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', 'docs/generated.md\n');
            writeFile(
                root,
                'docs/generated.md',
                '# Generated\n\n[link](#missing-anchor)\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored markdown source files with spaces are still skipped from scanning', () => {
    // Regression for Amendment Round 2: the source-file gitignore pass
    // must still accept real path names with spaces. If it shares the
    // candidate-only poison filter, this gitignored source file would
    // be dropped from ignoredSources and scanned locally.
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', 'docs/generated report.md\n');
            writeFile(
                root,
                'docs/generated report.md',
                '# Generated Report\n\n[link](#missing-anchor)\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored target paths with spaces are skipped when the citation is in a scanned doc', () => {
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', 'docs/has space.md\n');
            writeFile(
                root,
                'docs/space-cited-ref.md',
                'See `docs/has space.md:151,254`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored skip degrades to no-skip outside a git repo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-refs-check-no-repo-'));
    try {
        writeFile(
            root,
            'docs/no-repo.md',
            'See `.claude/settings.local.json:151,254`.\n',
        );
        assert.deepEqual(runChecks(root), [
            {
                file: 'docs/no-repo.md',
                line: 1,
                ref: '`.claude/settings.local.json:151,254`',
                reason: 'missing file',
            },
        ]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('gitignored skip applies to relative anchor-link paths (./gitignored.md#anchor)', () => {
    // Anchor links commonly use relative paths from nested docs. After
    // normalization to repo-relative POSIX, the gitignore lookup should
    // still match. Codex P2 follow-up to the parent-relative correctness
    // fix above.
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', 'docs/generated.md\n');
            writeFile(root, 'docs/source.md', 'See [section](./generated.md#anchor).\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('gitignored skip does not silence other genuinely missing paths (negative control)', () => {
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', '.claude/settings.local.json\n');
            writeFile(
                root,
                'docs/mixed-refs.md',
                'Gitignored `.claude/settings.local.json` plus missing `scripts/genuinely-missing.ts`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/mixed-refs.md',
                    line: 1,
                    ref: '`scripts/genuinely-missing.ts`',
                    reason: 'missing file',
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
