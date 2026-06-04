# Plan: retire-codex-md — Retire CODEX.md — no tool reads it

> Written by: Claude | Phase: plan

## Overview

Ordered steps for Codex to implement. Steps 1–6 touch source files; step 7 deletes the file and its template mirror; steps 8–12 sweep docs and skills; step 13 updates tests; step 14 runs sync-templates (flushes AGENTS.md and CLAUDE.md mirrors); step 15 runs build and all validation checks.

Do **not** hand-edit `templates/AGENTS.md` or `templates/CLAUDE.md` — those are derived mirrors flushed by `npm run sync-templates`. Do **hand-edit** `templates/docs/codebase-map.md` (not in `CANON_OWNED` or `DELIMITED`, so sync-templates ignores it).

---

## Step 1 — Rescue file-revert mechanics into AGENTS.md (AC-1)

File: `AGENTS.md`

The unique content from `CODEX.md` "Iterating After Review" (the `git restore` / `git show origin/<base>:<path>` revert mechanics) must land in AGENTS.md so Codex reads it natively. The right insertion point is immediately after the existing "**Per-iteration artifact convention**" block (~line 115, after the sentence ending "...the slim-prompt mechanism degrades to a fresh full re-prompt."), before the `### Pipeline Orchestrator` heading.

Insert the following block:

```markdown
**Reverting a file during iteration.** `git restore` is blocked in the sandbox. For a byte-perfect revert to the task baseline, use `git show origin/<base-branch>:<path>` (read-only git, always allowed) and write the output to the file — this avoids residual diffs like trailing newlines.

- **Perfect revert** (file no longer appears in `git diff base...HEAD`): delete it from *all* prior iteration Changes tables in `handoff.md` and do not add it to the current one. The pre-flight check validates the aggregate union against the final diff; a net-zero file left in any Changes table is a false `handoff→diff` error.
- **Imperfect revert** (file still appears in the diff, e.g. a trailing newline remains): add it to the current iteration's Changes table with "Reverted to original (describe residual diff)". Leaving a changed file out of all Changes tables is a `diff→handoff` error.
```

Also update the four existing CODEX.md pointer lines in AGENTS.md (confirm exact numbers with `grep -n "CODEX" AGENTS.md`):

- Line ~10: `` [`CLAUDE.md`](./CLAUDE.md) and [`CODEX.md`](./CODEX.md) add agent-specific context… `` → drop the `CODEX.md` clause; rewrite to: `` [`CLAUDE.md`](./CLAUDE.md) adds Claude-specific context but must not override this file. ``
- Line ~163: `…see \`CLAUDE.md\` and \`CODEX.md\` for phase-specific reading lists.` → `…see \`CLAUDE.md\` for phase-specific reading lists.`
- Line ~194: `` - Workflow/process — `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/pipeline-orchestrator.md`. `` → remove `` `CODEX.md`, ``
- Line ~200: `See \`CLAUDE.md\` for full Claude guidance … See \`CODEX.md\` for full Codex guidance …` → rewrite to: `See \`CLAUDE.md\` for full Claude guidance (spec authorship, code review rules, QA format). Codex guidance (implementation rules, handoff format, spec review approach) is in \`AGENTS.md\` directly and in the orchestrator's injected prompt — there is no separate \`CODEX.md\`.`

`templates/AGENTS.md` is auto-synced by `npm run sync-templates` — do not edit it.

---

## Step 2 — Remove CODEX.md from DELIMITED and update upgrade.ts comment (AC-3, AC-6)

**File: `src/lib/canon-owned.ts`**

Line 22: `export const DELIMITED = ['AGENTS.md', 'CLAUDE.md', 'CODEX.md'] as const;`

Change to: `export const DELIMITED = ['AGENTS.md', 'CLAUDE.md'] as const;`

This one edit drives AC-6 (`canon upgrade` behavior follows from DELIMITED at runtime — no other logic change required).

**File: `src/cli/commands/upgrade.ts`**

Line ~161: `// --- Delimited files (AGENTS.md, CLAUDE.md, CODEX.md) ---`

Change to: `// --- Delimited files (AGENTS.md, CLAUDE.md) ---`

This is a comment-only change; it is also an AC-9 occurrence on the canon-managed surface that must be cleared.

---

## Step 3 — Stop canon init from scaffolding CODEX.md (AC-4)

File: `src/cli/commands/init.ts`

Line 19: `const AGENT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'CODEX.md']);`

Change to: `const AGENT_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);`

Also update the `launchGrill()` console message at line ~152 that reads `existing AGENTS.md / CLAUDE.md / CODEX.md detected` — drop `/ CODEX.md`:
```ts
console.log('\nNote: existing AGENTS.md / CLAUDE.md detected — the grill');
```

---

## Step 4 — Replace doctor CODEX.md check with deprecation-warn semantics (AC-5)

File: `src/cli/commands/doctor.ts`

**Add** a new exported function `checkCodexMdDeprecated` after the existing `checkAgentFile` function (~line 195):

```ts
export function checkCodexMdDeprecated(cwd: string): Check | null {
    if (!existsSync(join(cwd, 'CODEX.md'))) return null;
    return {
        label: 'CODEX.md',
        status: 'warn',
        detail: 'deprecated — no tool reads this file; it is safe to delete',
    };
}
```

In `doctorCmd`, build `canonChecks` to call the new function once and spread conditionally:

```ts
const codexDeprecated = checkCodexMdDeprecated(cwd);
const canonChecks: Check[] = [
    checkAgentFile(cwd, 'AGENTS.md'),
    checkAgentFile(cwd, 'CLAUDE.md'),
    ...(codexDeprecated ? [codexDeprecated] : []),
    checkTemplates(cwd),
    checkCanonVersion(cwd),
    checkSkills(cwd),
];
```

The function must be exported so the unit tests in step 13 can import and call it directly.

---

## Step 5 — Remove CODEX.md from docs-refs-check ROOT_MARKDOWN_FILES (AC-3)

File: `scripts/docs-refs-check.mjs`

Line 38: `const ROOT_MARKDOWN_FILES = ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'README.md'];`

Change to: `const ROOT_MARKDOWN_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md'];`

`templates/scripts/docs-refs-check.mjs` is in `CANON_OWNED` — auto-synced in step 14, do not hand-edit.

---

## Step 6 — Update CLAUDE.md (AC-8)

File: `CLAUDE.md`

1. Line ~25 (harness mention): drop `CODEX.md` from `AGENTS.md / CLAUDE.md / CODEX.md` → `AGENTS.md / CLAUDE.md`
2. Line ~227 (canon-managed-file convention note): the `DELIMITED` description currently lists `CODEX.md`. Update to: `AGENTS.md` and `CLAUDE.md`.

`templates/CLAUDE.md` is auto-synced — do not hand-edit.

---

## Step 7 — Delete CODEX.md and templates/CODEX.md (AC-2)

```bash
git rm CODEX.md
git rm templates/CODEX.md
```

These are the only two file deletions in this task.

---

## Step 8 — Update CI workflows (AC-7)

**`.github/workflows/ci.yml`**

Three changes (confirm line numbers with `grep -n "CODEX" .github/workflows/ci.yml`):
1. Remove the `test -f CODEX.md` line (~line 116) in the Canon smoke test job.
2. In the `push` trigger block, remove both the `!CODEX.md` exclusion line (~line 15) and the `CODEX.md` re-include line (~line 18) — they are a pair; remove both or the filter breaks.
3. In the `pull_request` trigger block, remove both the `!CODEX.md` exclusion line (~line 33) and the `CODEX.md` re-include line (~line 36).

**`.github/workflows/docs-refs-check.yml`**

Remove the `CODEX.md` path-filter entry (~line 11).

---

## Step 9 — Update skill files (AC-4, AC-8)

**`.claude/skills/canon-init/SKILL.md`** (root copy — auto-synced to `templates/`)

Three locations (confirm with `grep -n "CODEX" .claude/skills/canon-init/SKILL.md`):
- Line ~22: Remove the `- If \`CODEX.md\` exists, read it.` bullet
- Line ~113: Change `…merge protocol for \`AGENTS.md\` / \`CLAUDE.md\` / \`CODEX.md\`…` → `…merge protocol for \`AGENTS.md\` / \`CLAUDE.md\`…`
- Line ~138: Change `git add docs/ AGENTS.md CLAUDE.md CODEX.md 2>/dev/null` → `git add docs/ AGENTS.md CLAUDE.md 2>/dev/null`

**`.claude/skills/canon-init/write-guide.md`** (root copy — auto-synced to `templates/`)

Two locations (confirm with `grep -n "CODEX" .claude/skills/canon-init/write-guide.md`):
- Line ~15: `Agent config files — merge protocol for \`AGENTS.md\` / \`CLAUDE.md\` / \`CODEX.md\`` → drop `/ \`CODEX.md\``
- Line ~67: `If any of \`AGENTS.md\`, \`CLAUDE.md\`, \`CODEX.md\` had project-specific content…` → `If any of \`AGENTS.md\`, \`CLAUDE.md\` had project-specific content…`

**`.claude/skills/canon-pipeline/SKILL.md`** (root copy — auto-synced to `templates/`)

Line ~147 (confirm with `grep -n "CODEX" .claude/skills/canon-pipeline/SKILL.md`): Remove the `- \`CODEX.md\` — Codex phase-specific guidance.` bullet.

---

## Step 10 — Update docs (AC-8)

For each file, run `grep -n "CODEX" <file>` first to confirm exact line numbers.

**`docs/codebase-map.md`** (~lines 23, 74, 142, 153):
- Line ~23: Remove the `| Codex (implementer) guide | \`CODEX.md\` |` table row
- Line ~74: `…per phase rules in \`CLAUDE.md\` / \`CODEX.md\`…` → `…per phase rules in \`CLAUDE.md\`…`
- Line ~142: `…\`CLAUDE.md\` / \`CODEX.md\` (authorship rules)` → `…\`CLAUDE.md\` (authorship rules)`
- Line ~156: Remove the `| Codex instructions | \`CODEX.md\` | Implementer context |` table row

**`templates/docs/codebase-map.md`** — NOT auto-synced; hand-edit this file to mirror the same removals as `docs/codebase-map.md`. This is the adopter scaffold that `canon init` ships to new projects.

**`docs/pipeline-orchestrator.md`** (~lines 399, 407): Remove `CODEX.md` from the scaffolded-files list and per-agent guidance line. `templates/docs/pipeline-orchestrator.md` is in `CANON_OWNED` — auto-synced in step 14.

**`docs/product-context.md`** (~line 57): Remove `CODEX.md` from the `canon init` scaffolding list.

**`docs/patterns.md`** (~lines 12, 56):
- Line ~12 (layering-rule): Drop `[\`CODEX.md\`](../CODEX.md)` from the sentence listing canon-supplied universal rules
- Line ~56 (Phase Addition Discipline): `…\`CLAUDE.md\` / \`CODEX.md\`` → `…\`CLAUDE.md\``

**`docs/architecture.md`** (~line 153): Update the CI path-filter description that lists `CODEX.md` to reflect its removal.

**`docs/decisions.md`** (~lines 162, 172): Update declared-vs-executable references from three files to two (`AGENTS.md` / `CLAUDE.md`).

**`README.md`** (~lines 106, 237, 259): Remove `CODEX.md` from file lists and descriptions. Rewrite to the two-file model.

---

## Step 11 — Update tests (AC-10)

**`tests/cli.test.ts`**

Four array entries to remove (exact lines confirmed via `grep -n "CODEX" tests/cli.test.ts`):
- Line ~1953: Remove `'CODEX.md',` from OPERATIONAL_DOCS
- Line ~1957: Remove `'templates/CODEX.md',` from OPERATIONAL_DOCS
- Line ~2005: Remove `'templates/CODEX.md',` from ADOPTER_SHIPPED_PATHS
- Line ~2022: Remove `'CODEX.md',` from ADOPTER_SHIPPED_PATHS

**Add two unit tests** for the doctor deprecation-warn behavior. Find the existing `checkAgentFile` unit tests as the placement anchor and insert nearby. Use whatever temp-dir helper pattern the surrounding tests use:

```ts
// When CODEX.md is absent, checkCodexMdDeprecated returns null (no check emitted)
test('checkCodexMdDeprecated returns null when CODEX.md is absent', (t) => {
    // temp dir with no CODEX.md
    const result = checkCodexMdDeprecated(emptyTempDir);
    assert.equal(result, null);
});

// When CODEX.md is present, checkCodexMdDeprecated returns a warn Check
test('checkCodexMdDeprecated returns warn when CODEX.md is present', (t) => {
    // temp dir with an empty CODEX.md
    const result = checkCodexMdDeprecated(tempDirWithCodexMd);
    assert.ok(result !== null);
    assert.equal(result!.status, 'warn');
    assert.match(result!.detail ?? '', /deprecated/);
});
```

Import `checkCodexMdDeprecated` from `../src/cli/commands/doctor.js` (follow the existing doctor import pattern in that test file).

**`tests/sync-canon-templates.test.ts`**

Three locations to correct (exact lines confirmed via `grep -n "CODEX" tests/sync-canon-templates.test.ts`):
- Line ~300 (comment): `// … The AGENTS.md / CLAUDE.md / CODEX.md sources are absent…` → `// … The AGENTS.md / CLAUDE.md sources are absent…`
- Line ~308 (assertion message): `'expected delimited errors for missing AGENTS/CLAUDE/CODEX sources'` → `'expected delimited errors for missing AGENTS/CLAUDE sources'`
- Line ~432 (comment): Update to remove the `CODEX.md at REPO_ROOT` reference; the tail-outside-delimiter note now applies only to `AGENTS.md` / `CLAUDE.md`.

Note: the test logic at line ~297 still exercises two DELIMITED entries (`AGENTS.md` and `CLAUDE.md`) and still expects at least one delimited error — no logic change needed, only the comment/message updates.

---

## Step 12 — Run sync-templates to flush derived mirrors (AC-3, AC-8)

```bash
npm run sync-templates
```

This flushes:
- `templates/AGENTS.md` (from `AGENTS.md` edits in step 1)
- `templates/CLAUDE.md` (from `CLAUDE.md` edits in step 6)
- `templates/.claude/skills/canon-init/SKILL.md` (from step 9)
- `templates/.claude/skills/canon-pipeline/SKILL.md` (from step 9)
- `templates/scripts/docs-refs-check.mjs` (from step 5)
- `templates/docs/pipeline-orchestrator.md` (from step 10)

Stage all auto-generated changes. Then verify:

```bash
npm run sync-templates:check
```

Must exit 0. No `CODEX.md` entry should appear.

---

## Step 13 — Build to regenerate dist/ (AC-11)

```bash
npm run build
```

Bundles `src/cli` changes (canon-owned.ts, init.ts, doctor.ts, upgrade.ts) into `dist/cli/index.js`. Stage `dist/cli/index.js`.

---

## Step 14 — Run all validation checks

```bash
npm run lint
npm run type-check
npm test
npm run docs-refs-check
npm run sync-templates:check
```

All must pass before writing `handoff.md`. `npm test` covers: expected-file arrays (AC-10), doctor deprecation-warn unit tests (AC-5/AC-10), sync-template delimited test (AC-10). `docs-refs-check` confirms no dangling `CODEX.md` refs on the canon-managed surface (AC-8).

---

## Step 15 — AC-9 grep and residual allow-list for handoff

Run:
```bash
git grep -n "CODEX\.md"
```

Record every remaining occurrence in `handoff.md`. Expected residuals that are **intentional and not failures**:
- `src/cli/commands/doctor.ts` — the `label: 'CODEX.md'` string in `checkCodexMdDeprecated` (intentional warn reference)
- `dist/cli/index.js` — compiled form of the above; intentional
- `tests/cli.test.ts` — the two new `checkCodexMdDeprecated` test bodies; intentional test coverage
- `CHANGELOG.md`, `docs/BACKLOG.md`, `docs/packaging-plan.md` — historical records; out of scope per spec Non-Goals
- `tasks/_archive/**` — archived task artifacts; out of scope
- `tasks/bundle-preflight-atomic-rejection/**`, `tasks/codex-code-review-phase/**`, `tasks/qa-drafts-pr-body/**`, `tasks/telemetry-discrimination-gate/**` — other live tasks' artifacts; out of scope per AC-9 (do not rewrite)
- `tasks/retire-codex-md/**` — this task's own spec/plan/notes; out of scope

Any occurrence in the canon-managed surface outside this list is a missed sweep — fix before submitting handoff.
