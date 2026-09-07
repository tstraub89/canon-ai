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

void test('line-citation refs: approximate-line hedge (~N) is stripped before path validation', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/hedge-ok.md',
                [
                    'Single: `scripts/fixture-target.ts:~140`.',
                    'Range: `scripts/fixture-target.ts:~140-160`.',
                    'Hedged range end: `scripts/fixture-target.ts:~140-~160`.',
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

void test('line-citation refs: hedged ref to a missing file reports the full cited ref text', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/hedge-missing.md', 'See `src/does-not-exist.ts:~140`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/hedge-missing.md',
                    line: 1,
                    ref: '`src/does-not-exist.ts:~140`',
                    reason: 'missing file',
                },
            ]);
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

void test('section refs: markdown-link carrier with a repo-root-relative path is validated', () => {
    // The prose convention `[`docs/x.md`](docs/x.md) §"Heading"` was invisible
    // to the checker: the backtick-path pattern requires §" right after the
    // closing backtick, and the anchor-link pattern requires a `#`. This is the
    // carrier that leaked three canon-ai-only decisions.md pointers to adopters
    // in 2026-07.
    // Source at the repo root, where the repo-root and markdown-relative
    // spellings agree — this asserts the carrier is validated at all. The
    // divergent case (a root-relative path written from inside `docs/`) has its
    // own test below.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'README.md',
                'See [`docs/section-target.md`](docs/section-target.md) §"Missing Heading".\n',
            );
            writeFile(root, 'docs/section-target.md', '# Title\n\n## Target Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'README.md',
                    line: 1,
                    ref: '[`docs/section-target.md`](docs/section-target.md) §"Missing Heading"',
                    reason: 'heading not found',
                },
            ]);
        },
    );
});

void test('section refs: markdown-link carrier with a sibling-relative path is validated', () => {
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/section-source.md',
                [
                    'Good: [`section-target.md`](section-target.md) §"Target Heading".',
                    'Bad: [`section-target.md`](section-target.md) §"Missing Heading".',
                    '',
                ].join('\n'),
            );
            writeFile(root, 'docs/section-target.md', '# Title\n\n## Target Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/section-source.md',
                    line: 2,
                    ref: '[`section-target.md`](section-target.md) §"Missing Heading"',
                    reason: 'heading not found',
                },
            ]);
        },
    );
});

void test('section refs: path and pointer inside one backtick pair is a section ref, not a missing file', () => {
    // `` `docs/x.md §"Heading"` `` used to be read by the bare-backtick
    // validator as one absurd filename and reported as `missing file` —
    // technically a failure, but it misdirected the author to the path instead
    // of the heading. Both the pass and fail cases now route to the section
    // validator.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/section-source.md',
                [
                    'Good: `docs/section-target.md §"Target Heading"`.',
                    'Bad: `docs/section-target.md §"Missing Heading"`.',
                    '',
                ].join('\n'),
            );
            writeFile(root, 'docs/section-target.md', '# Title\n\n## Target Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/section-source.md',
                    line: 2,
                    ref: '`docs/section-target.md §"Missing Heading"`',
                    reason: 'heading not found',
                },
            ]);
        },
    );
});

void test('section refs: markdown-link carrier to a genuinely missing file reports missing file', () => {
    // Plain-text link label on purpose: a backticked label (`` [`docs/nope.md`](docs/nope.md) ``)
    // is independently a class-1 backtick ref, so it would add a second
    // `missing file` finding for the same line and obscure what this asserts.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/section-source.md',
                'See [the missing doc](docs/nope.md) §"Some Heading".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/section-source.md',
                    line: 1,
                    ref: '[the missing doc](docs/nope.md) §"Some Heading"',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('section refs: a malformed inline pointer escapes neither validator', () => {
    // Codex P2 on this change: `hasInlineSectionPointer` suppressed the
    // bare-backtick file check with a looser pattern than the one the section
    // validator recognizes, so `` `docs/x.md §""` `` fell through both and was
    // reported by nobody. Suppression is now anchored to mirror carrier 2
    // exactly — anything the section validator won't claim stays claimed by the
    // file validator.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/malformed.md',
                [
                    'Empty pointer: `docs/nope.md §""`.',
                    'Unterminated pointer: `docs/nope.md §"Heading`.',
                    '',
                ].join('\n'),
            );
        },
        root => {
            const findings = runChecks(root);
            assert.equal(findings.length, 2);
            assert.deepEqual(findings.map(finding => finding.line), [1, 2]);
            for (const finding of findings) {
                assert.equal(finding.reason, 'missing file');
            }
        },
    );
});

void test('section refs: markdown-link carrier prefers true markdown resolution over the repo-root form', () => {
    // Codex P2 on this change: trying the repo-root spelling first let a link
    // that renders elsewhere be validated against a same-named file at the
    // repo root. The sibling file the renderer actually reaches wins.
    makeTempRepo(
        root => {
            writeFile(root, 'docs/sub/source.md', 'See [target](target.md) §"Sibling Heading".\n');
            writeFile(root, 'docs/sub/target.md', '# Title\n\n## Sibling Heading\n');
            writeFile(root, 'target.md', '# Decoy\n\n## Decoy Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('section refs: a repo-root-relative link path that a renderer cannot follow is its own finding', () => {
    // The section pointer is still checked against the file the author meant
    // (so an adopter-scope leak is not masked), and the unrenderable link path
    // is reported separately rather than swallowing both checks.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'docs/source.md',
                'See [`docs/target.md`](docs/target.md) §"Missing Heading".\n',
            );
            writeFile(root, 'docs/target.md', '# Title\n\n## Target Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/source.md',
                    line: 1,
                    ref: '[`docs/target.md`](docs/target.md) §"Missing Heading"',
                    reason: 'link path does not resolve from this file',
                },
                {
                    file: 'docs/source.md',
                    line: 1,
                    ref: '[`docs/target.md`](docs/target.md) §"Missing Heading"',
                    reason: 'heading not found',
                },
            ]);
        },
    );
});

void test('section refs: gitignored alternate spelling does not silence a resolvable target', () => {
    // Codex P2 on this change: `candidates.some(gitIgnored)` skipped the whole
    // ref when EITHER spelling was ignored, so a real heading error behind a
    // tracked source-relative target went unreported. The gitignore skip now
    // applies to the candidate actually selected, and to the nothing-resolves
    // case it exists for.
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', 'docs/target.md\n');
            writeFile(root, 'docs/sub/source.md', 'See [target](target.md) §"Missing Heading".\n');
            writeFile(root, 'docs/sub/target.md', '# Title\n\n## Real Heading\n');
            writeFile(root, 'docs/target.md', '# Ignored\n\n## Missing Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/sub/source.md',
                    line: 1,
                    ref: '[target](target.md) §"Missing Heading"',
                    reason: 'heading not found',
                },
            ]);
        },
    );
});

void test('section refs: gitignored target is still skipped when no spelling resolves', () => {
    // The CI-consistency skip must survive the reordering above: on a fresh
    // clone the ignored file is absent, so nothing resolves and the ref must
    // stay silent rather than fail as a missing file.
    makeTempRepo(
        root => {
            spawnSync('git', ['init', '--quiet'], { cwd: root });
            writeFile(root, '.gitignore', 'docs/generated.md\n');
            writeFile(root, 'docs/source.md', 'See `docs/generated.md` §"Some Heading".\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('section refs: a target escaping the repo is not stat-ed outside the worktree', () => {
    // Codex P2 round 2: `isAllowedDocTarget` only inspects the first path
    // segment, so `docs/../../../outside.md` cleared the allow-list and the
    // repo-root fallback candidate resolved outside `repoRoot`. Candidates are
    // now confined to the repo, matching the containment `normalizeAnchorLinkPath`
    // already enforces on the markdown-resolved path.
    makeTempRepo(
        root => {
            // A real file just outside the fixture root, reachable only by escaping.
            fs.writeFileSync(
                path.join(root, '..', 'docs-refs-check-outside.md'),
                '# Outside\n\n## Escaped Heading\n',
                'utf8',
            );
            writeFile(
                root,
                'docs/escape.md',
                [
                    'Link carrier: [x](docs/../../docs-refs-check-outside.md) §"Escaped Heading".',
                    'Backtick carrier: `docs/../../docs-refs-check-outside.md` §"Escaped Heading".',
                    '',
                ].join('\n'),
            );
        },
        root => {
            try {
                assert.deepEqual(runChecks(root), []);
            } finally {
                fs.rmSync(path.join(root, '..', 'docs-refs-check-outside.md'), { force: true });
            }
        },
    );
});

void test('anchor links: an out-of-repo target is skipped, matching section-ref containment', () => {
    // Codex P2 round 3: the section-ref path confined its candidates to the
    // repo while the anchor path still resolved `../outside.md` from the source
    // directory and validated a file no other clone has. The two validators now
    // apply the same containment. An in-repo parent-relative link still works.
    makeTempRepo(
        root => {
            fs.writeFileSync(
                path.join(root, '..', 'docs-refs-check-outside-anchor.md'),
                '# Outside\n\n## Escaped Heading\n',
                'utf8',
            );
            writeFile(root, 'AGENTS.md', '# Title\n\n## In Repo Heading\n');
            writeFile(
                root,
                'docs/nested/source.md',
                [
                    'Escapes: [x](../../../docs-refs-check-outside-anchor.md#escaped-heading).',
                    'In repo: [y](../../AGENTS.md#in-repo-heading).',
                    '',
                ].join('\n'),
            );
        },
        root => {
            try {
                assert.deepEqual(runChecks(root), []);
            } finally {
                fs.rmSync(path.join(root, '..', 'docs-refs-check-outside-anchor.md'), { force: true });
            }
        },
    );
});

void test('adopter scope: an unparseable CANON_OWNED manifest leaves the guard inert, not partial', () => {
    // Codex P2 round 2: a partial manifest is worse than none — a shipped file
    // missing from the set stops being policed, silently. An array that never
    // closes must yield nothing rather than the entries found so far.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'src/lib/canon-owned.ts',
                "export const CANON_OWNED = [\n    'docs/shipped-guide.md',\n",
            );
            writeFile(root, 'docs/decisions.md', '# Decisions\n\n## Canon Only Section\n');
            writeFile(root, 'templates/docs/decisions.md', '# Decisions\n');
            writeFile(
                root,
                'docs/shipped-guide.md',
                'See `docs/decisions.md` §"Canon Only Section".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('adopter scope: CANON_OWNED entries survive brackets and slashes inside quoted paths', () => {
    // Codex P2 round 2: the previous regex parse broke on `]`, `//`, or `/*`
    // inside a string literal — truncating the manifest and silently dropping
    // adopter-scope coverage for every entry after it.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'src/lib/canon-owned.ts',
                [
                    'export const CANON_OWNED = [',
                    "    'docs/odd]name.md', // trailing [comment] with ]",
                    "    'docs/odd*name.md', /* block ] comment */",
                    "    'docs/shipped-guide.md',",
                    '] as const;',
                    '',
                ].join('\n'),
            );
            writeFile(root, 'docs/decisions.md', '# Decisions\n\n## Canon Only Section\n');
            writeFile(root, 'templates/docs/decisions.md', '# Decisions\n');
            // Last entry in the list: only reachable if the odd names and the
            // bracket-bearing comments did not truncate the parse.
            writeFile(
                root,
                'docs/shipped-guide.md',
                'See `docs/decisions.md` §"Canon Only Section".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/shipped-guide.md',
                    line: 1,
                    ref: '`docs/decisions.md` §"Canon Only Section"',
                    reason: 'heading not found in adopter scaffold copy (templates/docs/decisions.md)',
                },
            ]);
        },
    );
});

void test('adopter scope: CANON_OWNED entries behind comments are parsed correctly', () => {
    // Codex P2 on this change: the manifest parser stopped at the first `]` and
    // then took every quoted substring, so a comment containing `]` truncated
    // the list and a commented-out entry counted as owned — either way the
    // guard silently misclassifies a file. Comments are stripped first.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'src/lib/canon-owned.ts',
                [
                    'export const CANON_OWNED = [',
                    "    // 'docs/not-owned.md', // retired [see BACKLOG]",
                    '    /* block [comment] */',
                    "    'docs/shipped-guide.md',",
                    '] as const;',
                    '',
                ].join('\n'),
            );
            writeFile(
                root,
                'docs/decisions.md',
                '# Decisions\n\n## Canon Only Section\n',
            );
            writeFile(root, 'templates/docs/decisions.md', '# Decisions\n');
            // Owned despite following the bracket-bearing comments: must be scoped.
            writeFile(
                root,
                'docs/shipped-guide.md',
                'See `docs/decisions.md` §"Canon Only Section".\n',
            );
            // Commented out, so NOT owned: must stay unscoped.
            writeFile(
                root,
                'docs/not-owned.md',
                'See `docs/decisions.md` §"Canon Only Section".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/shipped-guide.md',
                    line: 1,
                    ref: '`docs/decisions.md` §"Canon Only Section"',
                    reason: 'heading not found in adopter scaffold copy (templates/docs/decisions.md)',
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

// --- Adopter scope -------------------------------------------------------
//
// canon ships every CANON_OWNED file verbatim, but the scaffold docs it ships
// alongside (`docs/decisions.md` and friends) become the adopter's own content.
// A section pointer from a shipped file into a scaffold doc must therefore
// resolve against `templates/docs/<file>`, not canon-ai's filled-in copy.
// Fixtures below are deliberately list-driven — `docs/shipped-guide.md` is not
// a real canon path, so a pass proves the guard reads CANON_OWNED rather than
// recognizing filenames.
function writeAdopterScopeFixture(
    root: string,
    options: { canonOwned?: string[] } = {},
): void {
    const canonOwned = options.canonOwned ?? ['docs/shipped-guide.md'];
    if (canonOwned.length > 0) {
        writeFile(
            root,
            'src/lib/canon-owned.ts',
            [
                'export const CANON_OWNED = [',
                ...canonOwned.map(rel => `    '${rel}',`),
                '] as const;',
                '',
                'export const DELIMITED = [] as const;',
                '',
            ].join('\n'),
        );
    }
    // canon-ai's own copy carries both sections; the adopter scaffold carries
    // only the one canon actually ships.
    writeFile(
        root,
        'docs/decisions.md',
        '# Decisions\n\n## Versioning and release policy\n\n## Canon Only Section\n',
    );
    writeFile(
        root,
        'templates/docs/decisions.md',
        '# Decisions\n\n## Versioning and release policy\n',
    );
}

void test('adopter scope: CANON_OWNED file naming a scaffold-only section fails', () => {
    makeTempRepo(
        root => {
            writeAdopterScopeFixture(root);
            writeFile(
                root,
                'docs/shipped-guide.md',
                'See [`decisions.md`](decisions.md) §"Canon Only Section".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/shipped-guide.md',
                    line: 1,
                    ref: '[`decisions.md`](decisions.md) §"Canon Only Section"',
                    reason: 'heading not found in adopter scaffold copy (templates/docs/decisions.md)',
                },
            ]);
        },
    );
});

void test('adopter scope: CANON_OWNED file naming a section present in the scaffold passes', () => {
    makeTempRepo(
        root => {
            writeAdopterScopeFixture(root);
            writeFile(
                root,
                'docs/shipped-guide.md',
                'See `docs/decisions.md` §"Versioning and release policy".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('adopter scope: non-CANON_OWNED file may name canon-ai-only sections freely', () => {
    // Negative control: the same ref from a file that never ships is fine, and
    // resolves against the repo-root copy where the section exists.
    makeTempRepo(
        root => {
            writeAdopterScopeFixture(root);
            writeFile(
                root,
                'docs/internal-notes.md',
                'See [`decisions.md`](decisions.md) §"Canon Only Section".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('adopter scope: the templates/ mirror of a CANON_OWNED file is checked too', () => {
    // The mirror ships the same bytes, so it carries the same leak.
    makeTempRepo(
        root => {
            writeAdopterScopeFixture(root);
            writeFile(
                root,
                'templates/docs/shipped-guide.md',
                'See `docs/decisions.md` §"Canon Only Section".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'templates/docs/shipped-guide.md',
                    line: 1,
                    ref: '`docs/decisions.md` §"Canon Only Section"',
                    reason: 'heading not found in adopter scaffold copy (templates/docs/decisions.md)',
                },
            ]);
        },
    );
});

void test('adopter scope: shipped markdown under a hidden directory is scanned and scoped', () => {
    // Codex P2 on PR #212: `walkMarkdownTree` skips directories beginning with
    // `.`, and no configured root reaches `.claude/**` or `.canon/**` — where
    // 20 of canon's 21 owned markdown files live. Membership in
    // `shippedSources` was therefore moot for almost every shipped file, so a
    // dangling section pointer in a skill or task template still shipped
    // silently. Owned markdown is now collected regardless of directory layout.
    makeTempRepo(
        root => {
            writeAdopterScopeFixture(root, {
                canonOwned: ['.claude/skills/example/SKILL.md', '.canon/templates/done.md'],
            });
            writeFile(
                root,
                '.claude/skills/example/SKILL.md',
                'See `docs/decisions.md` §"Canon Only Section".\n',
            );
            // The `templates/` mirror of a hidden-directory owned file is
            // equally unreachable by the walker, and ships the same bytes.
            writeFile(
                root,
                'templates/.canon/templates/done.md',
                'See `docs/decisions.md` §"Canon Only Section".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: '.claude/skills/example/SKILL.md',
                    line: 1,
                    ref: '`docs/decisions.md` §"Canon Only Section"',
                    reason: 'heading not found in adopter scaffold copy (templates/docs/decisions.md)',
                },
                {
                    file: 'templates/.canon/templates/done.md',
                    line: 1,
                    ref: '`docs/decisions.md` §"Canon Only Section"',
                    reason: 'heading not found in adopter scaffold copy (templates/docs/decisions.md)',
                },
            ]);
        },
    );
});

void test('shipped markdown is scanned for every ref class, not only adopter scope', () => {
    // A broken file ref in a shipped skill is an adopter-facing bug too — the
    // point of collecting these files is that they ship, not that one validator
    // needs them.
    makeTempRepo(
        root => {
            writeFile(
                root,
                'src/lib/canon-owned.ts',
                "export const CANON_OWNED = [\n    '.claude/skills/example/SKILL.md',\n] as const;\n",
            );
            writeFile(
                root,
                '.claude/skills/example/SKILL.md',
                'See `scripts/never-existed.ts`.\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: '.claude/skills/example/SKILL.md',
                    line: 1,
                    ref: '`scripts/never-existed.ts`',
                    reason: 'missing file',
                },
            ]);
        },
    );
});

void test('adopter scope: anchor links into scaffold-only docs are scoped too, self-anchors are not', () => {
    makeTempRepo(
        root => {
            writeAdopterScopeFixture(root);
            writeFile(
                root,
                'docs/shipped-guide.md',
                [
                    '# Shipped Guide',
                    '',
                    '## Local Heading',
                    '',
                    'Self: [here](#local-heading).',
                    'Scaffold-safe: [policy](decisions.md#versioning-and-release-policy).',
                    'Leak: [rationale](decisions.md#canon-only-section).',
                    '',
                ].join('\n'),
            );
        },
        root => {
            assert.deepEqual(runChecks(root), [
                {
                    file: 'docs/shipped-guide.md',
                    line: 7,
                    ref: '[rationale](decisions.md#canon-only-section)',
                    reason: 'anchor not found in adopter scaffold copy (templates/docs/decisions.md)',
                },
            ]);
        },
    );
});

void test('adopter scope: refs between two CANON_OWNED docs resolve against the root copy', () => {
    // Owned files are byte-identical mirrors, so their headings ship as-is and
    // need no scaffold re-resolution.
    makeTempRepo(
        root => {
            writeAdopterScopeFixture(root, {
                canonOwned: ['docs/shipped-guide.md', 'docs/shipped-reference.md'],
            });
            writeFile(
                root,
                'docs/shipped-guide.md',
                'See `docs/shipped-reference.md` §"Owned Heading".\n',
            );
            writeFile(root, 'docs/shipped-reference.md', '# Reference\n\n## Owned Heading\n');
            writeFile(root, 'templates/docs/shipped-reference.md', '# Reference\n\n## Owned Heading\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('adopter scope: guard is inert with no src/lib/canon-owned.ts (adopter repo)', () => {
    // In an adopter repo there is no CANON_OWNED manifest and no templates/
    // tree, so nothing is treated as shipped — an adopter doc pointing at its
    // own decisions.md sections is exactly the intended usage.
    makeTempRepo(
        root => {
            writeAdopterScopeFixture(root, { canonOwned: [] });
            writeFile(
                root,
                'docs/shipped-guide.md',
                'See [`decisions.md`](decisions.md) §"Canon Only Section".\n',
            );
        },
        root => {
            assert.deepEqual(runChecks(root), []);
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

void test('line-citation refs: comma-space compound ranges resolve the existing file', () => {
    makeTempRepo(root => {
        writeFile(root, 'scripts/fixture-target.ts', 'export {};\n');
        writeFile(root, 'docs/spaced-citations.md', [
            'See `scripts/fixture-target.ts:191-197, 103-110`.',
            'See `scripts/fixture-target.ts:~191–~197, ~103—110`.',
            'See `scripts/fixture-target.ts#L191-L197, L103-L110`.',
        ].join('\n'));
    }, root => assert.deepEqual(runChecks(root), []));
});

void test('line-citation refs: spaced ranges work in symbol, section and link carriers', () => {
    makeTempRepo(root => {
        writeFile(root, 'scripts/fixture-target.ts', 'export function example() {}\n');
        writeFile(root, 'docs/fixture-target.md', '## Example\n');
        writeFile(root, 'docs/citation-carriers.md', [
            '`example()` in `scripts/fixture-target.ts:1-2, 3-4`.',
            '`docs/fixture-target.md` §"Example".',
            '`docs/fixture-target.md:1-2, 3-4` §"Example".',
            '[Example](scripts/fixture-target.ts#L1-L2, L3-L4)',
            '[Example](scripts/fixture-target.ts#L1-L2,L3-L4)',
        ].join('\n'));
    }, root => assert.deepEqual(runChecks(root), []));
});
