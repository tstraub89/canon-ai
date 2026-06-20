# Plan: adopter-agent-file-redesign

> Written by: Claude | Implements: `tasks/adopter-agent-file-redesign/spec.md`

## Approach

Strip canon's remaining references to `AGENTS.md`/`CLAUDE.md` as rule-homes or pipeline-read targets across docs, skills, and CLI banners; extend `checkCanonDiscoveryNudge` to two warn states; rewrite the files as the audience-split end-state (shared overview in `AGENTS.md`, `@AGENTS.md` import + four-norm section in `CLAUDE.md`); and keep tests in lockstep with source changes.

The AC-1 grep was run during planning and identified the complete work set. Steps are ordered source → skills → docs → content rewrites → decisions record → tests → build+validate. Template mirrors auto-sync for all CANON_OWNED edits via the pre-commit hook; declare both root and mirror in the handoff Changes table.

---

## Step 1 — AC-11: Fix `existingAgentFilesNoticeLines()` in `src/cli/commands/init.ts`

**File**: `src/cli/commands/init.ts:25–30`

Drop the "grill will read them as project context" claim. Replace the function body:

```ts
export function existingAgentFilesNoticeLines(): string[] {
    return [
        '\nNote: existing AGENTS.md / CLAUDE.md detected — they are adopter-owned;',
        'canon does not insert, merge, or read managed content into them.',
    ];
}
```

`AGENT_FILES` and `hasExistingAgentFiles` are unchanged.

---

## Step 2 — AC-5: Extend `checkCanonDiscoveryNudge` in `src/cli/commands/doctor.ts`

**File**: `src/cli/commands/doctor.ts:194–211`

Split the current single warn state into two:

- **(i) Neither file exists** → warn, detail advises running the built-in `/init`
- **(ii) Files exist but neither mentions canon** → warn, detail advises adding the nudge (current wording)

Pass case is unchanged (either mentions canon → pass). Neither state returns `'fail'`.

```ts
export function checkCanonDiscoveryNudge(cwd: string): Check {
    const filenames = ['CLAUDE.md', 'AGENTS.md'];
    const existingFiles = filenames.filter(f => existsSync(join(cwd, f)));

    if (existingFiles.length === 0) {
        return {
            label: 'canon discovery nudge',
            status: 'warn',
            detail:
                'no AGENTS.md or CLAUDE.md found — run the built-in `/init` (Claude Code) or Codex init to generate a high-level project overview, then add the discovery nudge below',
        };
    }

    const mentionsCanon = existingFiles.some(filename => {
        const path = join(cwd, filename);
        return /canon/i.test(readFileSync(path, 'utf8'));
    });

    if (mentionsCanon) {
        return { label: 'canon discovery nudge', status: 'pass' };
    }

    return {
        label: 'canon discovery nudge',
        status: 'warn',
        detail: `add this to CLAUDE.md:\n${RECOMMENDED_NUDGE}`,
    };
}
```

---

## Step 3 — AC-1: Repoint reroute banner in `scripts/run-task/cli.ts`

**File**: `scripts/run-task/cli.ts:157–159`

Replace:
```
    console.log('                      on round 2+. Bypass with --force. See CLAUDE.md "Reroute feedback');
    console.log('                      channel."');
```
With:
```
    console.log('                      on round 2+. Bypass with --force. See docs/pipeline-orchestrator.md');
    console.log('                      §"Reroute Feedback Channel".');
```

---

## Step 4 — AC-1: Repoint reroute banner in `src/cli/index.ts`

**File**: `src/cli/index.ts:96–99`

Replace the last two lines of the `--reroute` help block from `See CLAUDE.md "Reroute feedback channel."` to `See docs/pipeline-orchestrator.md §"Reroute Feedback Channel".`

---

## Step 5 — AC-1/AC-3: Fix `.claude/skills/canon-init/SKILL.md`

**File**: `.claude/skills/canon-init/SKILL.md` (CANON_OWNED → `templates/` auto-syncs)

**5a. Phase 0** (lines 22–26): Remove the "If CLAUDE.md/AGENTS.md exists, read it" instructions. Phase 0 body becomes detect-only:

```markdown
## Phase 0 — Check for existing canon files

Before doing anything else, check whether `AGENTS.md` or `CLAUDE.md` exists in the
project root. If either is present, note it — they are adopter-owned; canon does not
insert, merge, or read managed content into them. Any project context from auto-loaded
files is already in your session.
```

**5b. Related section** (line 182): Replace:
```
- `AGENTS.md` / `CLAUDE.md` — adopter-owned operator context when present (read at Phase 0).
```
With (allow-listed adopter-owned framing, no read instruction):
```
- `AGENTS.md` / `CLAUDE.md` — adopter-owned, when present; generate via the built-in `/init` (Claude Code or Codex).
```

---

## Step 6 — AC-3: Fix `.claude/skills/canon-init/write-guide.md`

**File**: `.claude/skills/canon-init/write-guide.md:65–70` (CANON_OWNED → `templates/` auto-syncs)

Replace the "Agent config files — adopter-owned" section. Remove the "read them as project context" instruction:

```markdown
## Agent config files — adopter-owned

`AGENTS.md` and `CLAUDE.md` are fully adopter-owned. Canon does not insert, modify, or read managed content into either file. Adopters generate them via the built-in `/init` (Claude Code or Codex). Any content already loaded into your session is available — do not explicitly read or rewrite them.
```

---

## Step 7 — AC-1: Fix `.claude/skills/canon-spec/SKILL.md`

**File**: `.claude/skills/canon-spec/SKILL.md` (CANON_OWNED → `templates/` auto-syncs)

**7a. Phase 1 "Load context"** (lines 35–36): Remove both `AGENTS.md` and `CLAUDE.md` bullets. Both agents auto-load their respective files; an explicit read instruction is redundant. Preserve the Validation Matrix note by adding it as a parenthetical after the `docs/` list:

```markdown
> The Validation Matrix is inline in `.canon/templates/spec.md`; the sizing table lives in `docs/pipeline-orchestrator.md`.
```

**7b. Related/Also section** (line 198): Remove:
```
- `CLAUDE.md` — operator context; spec-writing rules of thumb are in this skill above.
```

---

## Step 8 — AC-1: Strip CLAUDE.md Related refs from `canon-spec-review` and `canon-pipeline` skills

**Files** (both CANON_OWNED → `templates/` auto-syncs):

- `.claude/skills/canon-spec-review/SKILL.md:148`: Remove:
  ```
  - `CLAUDE.md` — operator context; Agent C's rules of thumb are listed in this skill above.
  ```
- `.claude/skills/canon-pipeline/SKILL.md:184`: Remove:
  ```
  - `CLAUDE.md` — operator context (phases, spec authorship, code-review rules of thumb).
  ```

CLAUDE.md auto-loads in the Claude Code session; this is redundant and frames it as a rule-home.

---

## Step 9 — AC-1/AC-2: Fix `docs/patterns.md`

**File**: `docs/patterns.md` (not CANON_OWNED; no `templates/` mirror)

**9a.** Line 12 layering-rule callout: `Ambient operator norms specific to canon-ai are in [\`CLAUDE.md\`](../CLAUDE.md).` →
`Conversational-operator norms for canon-ai are in [\`CLAUDE.md\`](../CLAUDE.md) (auto-loaded by Claude at session start).`

**9b.** Line 56 Phase Addition step 8: `any always-on operator implications in \`CLAUDE.md\`` → `the conversational-operator norms in \`CLAUDE.md\` (if the phase changes what the human-facing Claude session must or must not do)`

**9c.** Line 101 Known Pitfalls preamble: `Always-on operator habits live in [\`CLAUDE.md\`](../CLAUDE.md).` →
`Conversational-operator norms (commit consent, model defaults, etc.) live in [\`CLAUDE.md\`](../CLAUDE.md).`

**9d.** Lines 192–193 Quick Reference table: Replace the two `(see CLAUDE.md Quick Refs ...)` cells with `(see \`docs/pipeline-orchestrator.md\`)` on both rows.

**9e.** Trigger-table Lint/TS suppression row (near line 21): Replace `| (rule, no canonical file) |` with `` | `scripts/run-task/prompts/templates/implement.md` (Lint & Type Safety Policy section) | ``

---

## Step 10 — AC-1/AC-2: Fix `docs/codebase-map.md`

**File**: `docs/codebase-map.md`

**10a.** Line ~22 Entry-Points table row `Claude (architect/reviewer) guide | CLAUDE.md`: verify the description column doesn't claim "rules live here" or "pipeline reads". If it says "reusable rules are delivered JIT via skills/prompts" (or equivalent), it's allow-listed. If not, update description to: `Adopter-owned; conversational-operator norms for canon-ai sessions (auto-loaded by Claude Code)`.

**10b.** Line 100 protected-docs preamble: `These must stay current — agents read them at session start (per phase rules in \`CLAUDE.md\`).` → `These must stay current — the pipeline reads the protected \`docs/\*\` corpus at session start; phase-specific rules arrive just-in-time via prompt templates and skills.`

**10c.** Lines 192–193 AGENTS.md/CLAUDE.md file-navigation rows: The description "Ambient operator context; reusable rules are delivered JIT via skills/prompts" is already correct framing. Verify neither row claims "pipeline reads" and neither is framed as a rule-home. If the description starts with "Ambient operator context" it's allow-listed (e) — leave unchanged. If it uses different phrasing, update to: `Adopter-owned; auto-loaded at session start`.

---

## Step 11 — AC-2/AC-1: Fix `docs/product-context.md`

**File**: `docs/product-context.md`

**11a.** Line 82: Remove `AGENTS.md` from the orchestrator-surfaces list. Replace `scripts/run-task/`, `pipeline-policy.ts`, templates, `AGENTS.md`\` with `scripts/run-task/`, `pipeline-policy.ts`, templates`.

**11b.** Line 95: `Canon's general definition (from \`CLAUDE.md\`): \`delicate: true\`...` — the definition attribution is stale (CLAUDE.md is becoming `@AGENTS.md` + four norms; the delicate definition isn't one of them). Remove the attribution: `Canon's general definition: \`delicate: true\`...` (or repoint to `docs/pipeline-orchestrator.md` if that's where it's documented).

**11c.** Line 119: `canon-ai ships an opinionated communication norm for agents. From \`AGENTS.md\`:` — The norm will still live in the rewritten `AGENTS.md` shared overview (cross-review + comms norms are dual-useful and belong there per AC-6). Reframe to avoid implying AGENTS.md is a canon rule-home: `canon-ai ships an opinionated communication norm for agents. The shared project overview documents it:`

---

## Step 12 — AC-2/AC-1: Fix `docs/pipeline-orchestrator.md`

**File**: `docs/pipeline-orchestrator.md` (CANON_OWNED → `templates/` auto-syncs)

Scan the full doc for any prose that claims "the pipeline reads the project's operator context" in `AGENTS.md`/`CLAUDE.md` or frames them as rule delivery surfaces for the pipeline. Correct each instance to: "the pipeline reads the protected `docs/*` corpus and receives rules just-in-time via prompt templates and skills — it does not read adopter agent files."

Line 467 `- \`AGENTS.md\` / \`CLAUDE.md\` — adopter-owned operator context, when present.` is a Related-References entry, allow-listed (e) — leave it unchanged.

---

## Step 13 — AC-1/AC-3/AC-4: Fix `README.md`

**File**: `README.md`

**13a.** Line 108: Replace the current sentence ending `if they already exist, \`/canon-init\` reads them as project context.` Cut the read claim; add the `/init` recommendation:

```markdown
`AGENTS.md` and `CLAUDE.md` are adopter-owned. Canon does not scaffold, modify, or read them — generate them with the built-in `/init` (Claude Code's `/init` command or Codex init), which produces a high-level codebase overview. Add the discovery nudge below so future sessions notice canon immediately.
```

**13b.** Line 305: Replace `\`docs/patterns.md\`, \`docs/decisions.md\`, and \`AGENTS.md\` are.` with `\`docs/patterns.md\`, \`docs/decisions.md\`, and the \`docs/\` knowledge corpus are.`

**13c. AC-4**: Add a new subsection near the `/canon-init` getting-started section:

```markdown
### Generate your agent files with the built-in `/init`

After setting up canon, generate your agent files using your tool's built-in init
command. Claude Code's `/init` produces `CLAUDE.md`; Codex's init produces `AGENTS.md`.
These files contain a high-level codebase overview that each agent auto-loads at
session start.

**Optional consolidation**: place the shared overview once in `AGENTS.md` and have
`CLAUDE.md` import it with a single line:

```text
@AGENTS.md
```

Then append only Claude-specific operator norms below the import. Claude Code expands
`@path` imports into context at launch (recursive, up to 5 hops); Codex auto-loads
`AGENTS.md` natively. Both agents converge on one shared overview while operator-only
norms stay out of Codex's context.
```

---

## Step 14 — AC-1: Verify `docs/architecture.md`

**File**: `docs/architecture.md`

Lines 126 and 153 are both allow-listed (g) — accurate operational/CI descriptions:
- Line 126: worktree shield note ("supervisor's view of `AGENTS.md`, etc. is shielded")
- Line 153: CI path filter ("re-include root operator docs (`AGENTS.md`, `CLAUDE.md`)")

No edits required. Confirm neither line claims pipeline reads them for rules.

---

## Step 15 — AC-9: Update `docs/decisions.md`

**File**: `docs/decisions.md`

**15a.** Find the "Canon ships zero owned content into adopter agent files" entry. Locate the Rule line ending in `If a repo already has them, canon setup reads them as adopter-owned context only.` Replace only that final sentence:

Before: `If a repo already has them, canon setup reads them as adopter-owned context only.`

After: `Canon detects their presence (the \`canon init\` scaffold notice + \`canon doctor\` discovery nudge) but does not read, modify, or generate them — the built-in \`/init\` (Claude Code or Codex) is the tool that generates them.`

Verify: `git grep -n "reads them as adopter-owned context only" -- docs/decisions.md` returns nothing.

**15b.** Append at the end of `docs/decisions.md`:

```markdown
### Agent files are tool-native `/init` output; canon references none

**Decision**: `AGENTS.md` and `CLAUDE.md` are produced by the tool-native `/init` command (Claude Code's `/init` → `CLAUDE.md`; Codex init → `AGENTS.md`) as a high-level codebase overview for each agent. Canon does not generate, manage, instruct agents to read, or ship rules into these files.

**Why**: Both agents auto-load their respective files at session start; canon's operating rules arrive just-in-time via prompt templates, skills, and agent charters. Pointing an agent at a file it already loaded is noise; pointing at a rule that now lives in a prompt/skill creates a stale second home. The vacate program (Tasks A/B/C) stopped shipping managed content into the files; this record closes the loop by removing the remaining instructional/descriptive references.

**Rule**: The only canon references to `AGENTS.md`/`CLAUDE.md` that remain are: (a) operational code that detects their presence (`init.ts` scaffold notice, `doctor.ts` discovery nudge); (b) decision records; (c) README's adopter recommendation to use the built-in `/init`; (d) test files; (e) adopter-owned framing without read instructions; (f) canon-ai's own consolidation artifacts (`CLAUDE.md`'s `@AGENTS.md` import + four-norm section, `AGENTS.md`'s self-reference in its Local Convention note); (g) accurate operational/CI descriptions (CI path filters, worktree-shield notes). `AGENTS.md` and `CLAUDE.md` remain outside `CANON_OWNED` and `DELIMITED`. Adopters are recommended (not required) to consolidate via `CLAUDE.md` = `@AGENTS.md` + operator addendum.
```

---

## Step 16 — AC-6: Rewrite `AGENTS.md` as shared high-level overview

**File**: `AGENTS.md`

Full rewrite. Required sections per AC-6:
- What canon is + pipeline phases + "route work through the `/canon-*` skills"
- Roles table
- Cross-review rule and communication norm (dual-useful — both agents need these)
- Commands
- Structure/conventions
- "Where to go deeper" doc-pointer map (links to `docs/` homes or skills, not reproduced prose)
- Operational notes (agent memory, per-task notes, observability, local convention)

The four conversational-operator norms must NOT appear here. After writing, verify:
```bash
grep -nE 'ask before committing|never self.review|default.*smaller model|don.t intervene.*spec_review' AGENTS.md
```
→ returns nothing.

---

## Step 17 — AC-6: Rewrite `CLAUDE.md` to `@AGENTS.md` import + four-norm section

**File**: `CLAUDE.md`

Full rewrite to exactly two parts:
1. `@AGENTS.md` import line (with an optional one-line comment)
2. A short "Conversational Operator Norms" section with exactly the four norms:
   - Commit consent (ask before committing outside the pipeline)
   - Never self-review inline work (use `/canon-inline-review` or `codex review`)
   - Default toward smaller models / lower effort
   - Don't intervene in full-tier `spec_review` auto-revision

After writing, verify:
```bash
grep -nE 'ask before committing|never self.review|default.*smaller model|don.t intervene.*spec_review' CLAUDE.md
```
→ returns all four.

---

## Step 18 — AC-5/AC-11/AC-4: Update `tests/cli.test.ts`

**File**: `tests/cli.test.ts`

**18a. Init notice test** (~line 845): Drop the `/project context/` assertion; add assertions for the new no-read phrasing:

```ts
const notice = existingAgentFilesNoticeLines().join('\n');
assert.match(notice, /existing AGENTS\.md \/ CLAUDE\.md detected/);
assert.match(notice, /adopter-owned/);
assert.doesNotMatch(notice, /merge protocol/i);
assert.doesNotMatch(notice, /project context/i);
assert.doesNotMatch(notice, /will read them/i);
```

**18b. `checkCanonDiscoveryNudge` tests**: Update the existing absent-files test (`'doctor canon setup: absent AGENTS.md and CLAUDE.md produce warning nudge, not fail'`) to assert the `/init` advice is present. Add a new explicit absent-files test and a present-but-silent test that verifies the two warn branches are distinct. Keep the pass-case test (`'checkCanonDiscoveryNudge: either file mentioning canon → pass'`) unchanged.

New/updated tests:
```ts
void test('checkCanonDiscoveryNudge: no agent files → warn with /init advice', () => {
    withTempDir(dir => {
        const check = checkCanonDiscoveryNudge(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /\/init/i);
        assert.doesNotMatch(check.detail ?? '', /This project uses canon/);
    });
});

void test('checkCanonDiscoveryNudge: files present but silent → warn with nudge advice', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Project instructions.\n');
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Agent instructions.\n');
        const check = checkCanonDiscoveryNudge(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /This project uses canon/);
        assert.doesNotMatch(check.detail ?? '', /\/init/i);
    });
});
```

---

## Step 19 — AC-10/AC-8: Build, sync, and validate

Run in order:

```bash
npm run build
npm run sync-templates
npm run lint
npm run type-check
npm test
npm run docs-refs-check
npm run sync-templates:check
```

If `docs-refs-check` flags dangling paths (from the CLAUDE.md slim-down), repoint those references and re-run. If `sync-templates:check` fails, a CANON_OWNED edit wasn't synced — run `npm run sync-templates` and re-run the check.

---

## Step 20 — AC-1: Final grep + extend Affected Files

Run the full AC-1 grep before closing the handoff:

```bash
git grep -nE 'AGENTS\.md|CLAUDE\.md' -- \
  src/ scripts/ .claude/skills/ \
  docs/pipeline-orchestrator.md docs/codebase-map.md docs/product-context.md \
  docs/patterns.md docs/architecture.md docs/decisions.md \
  README.md AGENTS.md CLAUDE.md \
  templates/.claude/ templates/docs/ \
  2>/dev/null | grep -v dist/ | grep -v tasks/ | grep -v CHANGELOG.md \
  | grep -v lessons-learned | grep -v BACKLOG | grep -v task-quality-log \
  | grep -v '\-report\.md' | grep -v 'harness-audit'
```

Every surviving line must map to allow-list category (a)–(g) from the spec. Add any file touched but not yet in the spec's Affected Files table to the handoff Changes table before `--pr`.

Also verify AC-7: `git grep -nE "'AGENTS\.md'|'CLAUDE\.md'" -- src/lib/canon-owned.ts` returns nothing.

---

## Pitfall notes

- **Declare both root and templates/ mirror in handoff**: every CANON_OWNED file edited (steps 5–8 and 12) has a `templates/` mirror that auto-syncs via the pre-commit hook. Declare both paths in the handoff Changes table.
- **Steps 2 and 18 are coupled**: the new warn messages in `checkCanonDiscoveryNudge` must match the assertions in tests. Do not finalize one without the other.
- **AC-7 structural check**: confirm no CANON_OWNED/DELIMITED addition for AGENTS.md or CLAUDE.md.
- **`docs-refs-check` may flag the slimmed CLAUDE.md**: any doc that had a `[text](../CLAUDE.md#section)` link to a section that no longer exists will trip the checker. Fix by repointing to `docs/pipeline-orchestrator.md` or the relevant skill.

---

## Reroute Plan

### Context

The amendment (Round 1) fills six content gaps found in independent cold-reviews of the already-shipped `AGENTS.md` and `README.md`. The baseline audience-split structure is correct and must not change. Scope is **doc-content only** — `AGENTS.md` and `README.md`. Neither file is canon-owned (not in `CANON_OWNED`/`DELIMITED`; verified absent from `templates/`), so no mirror sync and no `dist/` rebuild are needed. The AC-1 strip post-condition still applies to any new text added to `AGENTS.md`.

Prior plan Steps 1–20 are complete as implemented. Only the delta below is new work.

### Delta

**Step R1 — A2: Add "what canon is" opener to `AGENTS.md`**

Prepend a 2–3 sentence opener before the existing first heading. It must state: (1) what canon is — a TypeScript/Node CLI (npm package); (2) what it does — scaffolds a Claude + Codex spec-driven pipeline into other repositories; (3) that it dogfoods on itself (canon runs canon on canon — which is why `tasks/`, worktree isolation, and `templates/` mirrors exist). Verify: a fresh reader of `AGENTS.md` alone learns the product, the stack, and the self-hosting fact. Then re-run the AC-1 strip grep over `AGENTS.md` to confirm the new opener introduces no "read `AGENTS.md`/`CLAUDE.md`" instruction or rule-home framing.

**Step R2 — A3: Add managed-set caveat to `Conventions` in `AGENTS.md`**

In the `Conventions` section, after the "edit the root copy, run `npm run sync-templates`" guidance, add a clarifying sentence: `AGENTS.md` and `CLAUDE.md` are **not** in the managed set — they have no `templates/` mirror and edits to them require no sync. The caveat must not claim either file is canon-owned.

**Step R3 — A6: Restore `CANON_OWNED` pointer in `Conventions` in `AGENTS.md`**

In the `Conventions` section, add a pointer to `src/lib/canon-owned.ts` as the home of the `CANON_OWNED` / `DELIMITED` split. This was dropped in the rewrite and is useful to whoever adds a managed file. One sentence or bullet is sufficient.

**Step R4 — A4: Add stack build/test signal to `AGENTS.md`**

Add a one-line stack signal naming the npm commands — `npm run build`, `npm test`, `npm run lint`, `npm run type-check` — so a fresh agent learns the language/build without a docs hop. A natural location is beside the `docs/architecture.md` pointer in "Where to Go Deeper" or in a short standalone paragraph. Do not duplicate the detailed validation bindings from `docs/architecture.md`; one sentence suffices with a link to that doc.

**Step R5 — A5: Add `docs/release-process.md` to "Where to Go Deeper" in `AGENTS.md`**

Add a `docs/release-process.md` entry to the "Where to Go Deeper" doc-pointer map. It is a frequent operator activity and currently unlinked.

**Step R6 — A1: Add `@AGENTS.md` consolidation guidance to `README.md`**

At the agent-file recommendation section in `README.md` (near the built-in `/init` guidance, currently around line 106), add or extend guidance to document the optional `CLAUDE.md` = `@AGENTS.md` consolidation for adopters who generate both agent files. The guidance must explain that `@AGENTS.md` in `CLAUDE.md` causes Claude Code to expand the shared overview into context at launch, while Codex auto-loads `AGENTS.md` natively, so both agents converge on one shared overview. Verify by grep: `@AGENTS.md` appears in `README.md` in a consolidation-guidance context (a hit beyond the discovery-nudge `CLAUDE.md` block). This AC was previously false-passed — re-verify explicitly, do not trust the prior Pass.

**Step R7 — Validate**

Run in order (no `dist/` rebuild needed — no source change):

```bash
npm run lint
npm run type-check
npm test
npm run docs-refs-check
npm run sync-templates:check
```

Then run the A1 grep check:
```bash
grep -n '@AGENTS\.md' README.md
```
Confirm at least one hit appears in the consolidation-guidance context (not only within the discovery-nudge block).

Then re-run the AC-1 strip grep scoped to the two amended files to confirm no new rule-home or read-instruction framing was introduced:
```bash
git grep -nE 'AGENTS\.md|CLAUDE\.md' -- AGENTS.md README.md
```
Every surviving line must still map to allow-list categories (a)–(g) from the spec.
