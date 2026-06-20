# Plan: vacate-adopter-md

> Written by: Claude (pipeline plan phase)
> Spec verdict: approved_with_nits — nits addressed inline below.

## Nit resolutions from spec-review

**Nit 1 — Migration-tool partial-marker and missing-file behavior**: The tool must handle four cases explicitly: (a) both markers present → strip block; (b) neither marker present → no-op, exit 0; (c) only one marker present → non-zero exit, no write, clear error message; (d) file not present → no-op, exit 0. Tests cover all four. This closes the "silently ignore or corrupt a malformed legacy block" gap.

**Nit 2 — AC-4 and fixture tests**: The `sync-canon-templates.test.ts` `delimited sync` test writes `AGENTS.md` / `templates/AGENTS.md` as fixtures and calls `checkSync`/`applySync`, which would produce false AC-4 grep hits. Fix: strip the `checkSync`/`applySync` assertions from that test (DELIMITED_SYNC is now `[]`; those assertions fail). Keep only the `mergeDelimitedForSync` string-level function call (the AC-2 fixture-based test). For `cli.test.ts`: the CLAUDE.md upgrade tests that create a local `tmplDir` don't reference the production `templates/` path, so AC-4's grep is not affected — but those tests are stale (DELIMITED is empty; `runUpgrade` no longer merges CLAUDE.md). Replace them with a "runUpgrade ignores CLAUDE.md/AGENTS.md after DELIMITED is empty" assertion.

---

## Steps

Execute in order; each step builds on the prior.

---

### Step 1 — `src/lib/canon-owned.ts`: empty `DELIMITED` (AC-1)

Change:
```typescript
export const DELIMITED = ['AGENTS.md', 'CLAUDE.md'] as const;
```
To:
```typescript
export const DELIMITED = [] as const;
```

The loop `for (const rel of DELIMITED)` in `upgrade.ts` becomes a no-op. The type changes from `readonly ['AGENTS.md', 'CLAUDE.md']` to `readonly []`. No other logic change.

---

### Step 2 — `src/cli/commands/upgrade.ts`: generalize comment + export constants (AC-2)

Two edits:

1. Line 208: change the stale illustrative comment:
   ```typescript
   // --- Delimited files (AGENTS.md, CLAUDE.md) ---
   ```
   to:
   ```typescript
   // --- Delimited files ---
   ```

2. Add `export` to the two marker constants (currently `const`) so the migration tool (Step 6) can import them instead of inlining:
   ```typescript
   export const CANON_END = '<!-- canon:end -->';
   export const CANON_START_RE = /<!-- canon:start[^>]* -->/;
   ```

No other logic changes to `upgrade.ts`. `mergeDelimited`, the delimited loop, and all other machinery are untouched.

---

### Step 3 — `src/cli/commands/init.ts`: rewire detection + update grill note (AC-5, AC-6)

**Problem**: `hasExistingAgentFiles` currently uses `skipped.some(f => AGENT_FILES.has(f))`. Once `templates/CLAUDE.md`/`templates/AGENTS.md` are deleted (Step 5), `scaffoldTemplates` never tries to copy them, so they never appear in `skipped`. Detection silently breaks.

**Fix 1 — detection**: Replace:
```typescript
const hasExistingAgentFiles = skipped.some(f => AGENT_FILES.has(f));
```
with:
```typescript
const hasExistingAgentFiles = [...AGENT_FILES].some(f => existsSync(join(cwd, f)));
```
Both `existsSync` and `join` are already imported at the top of the file.

**Fix 2 — grill note** in `launchGrill()` (lines 151–155). Replace:
```typescript
if (hasExistingAgentFiles) {
    console.log('\nNote: existing AGENTS.md / CLAUDE.md detected — the grill');
    console.log('will run the merge protocol on them automatically.');
}
```
with:
```typescript
if (hasExistingAgentFiles) {
    console.log('\nNote: existing AGENTS.md / CLAUDE.md detected — the grill');
    console.log('will read them as project context. They are adopter-owned;');
    console.log('canon does not insert or merge a managed block into them.');
}
```
No "merge protocol" framing anywhere in the grill note (AC-6b). The `AGENT_FILES` set at line 19 is kept unchanged — it drives both detection and the grill note.

---

### Step 4 — `src/cli/commands/doctor.ts`: remove `checkAgentFile` (AC-16)

1. Delete the `checkAgentFile` function (lines 197–207):
   ```typescript
   export function checkAgentFile(cwd: string, filename: string): Check { ... }
   ```

2. Remove the two calls from `canonChecks` (lines 669–670):
   ```typescript
   checkAgentFile(cwd, 'AGENTS.md'),
   checkAgentFile(cwd, 'CLAUDE.md'),
   ```
   Leave `checkCanonDiscoveryNudge(cwd)` — it is the sole agent-file/discovery check.

---

### Step 5 — Delete `templates/CLAUDE.md` and `templates/AGENTS.md` (AC-4)

```
git rm templates/CLAUDE.md templates/AGENTS.md
```

Both files deleted. After Step 1–4, no production code in `src/` refers to them by name. AC-4 verification: `git grep` finds no code path reading these by name.

---

### Step 6 — `tools/strip-canon-block.mjs`: create the migration tool (AC-8, AC-9)

**File**: `tools/strip-canon-block.mjs` (new; not in `package.json` `files` — `tools/` is not listed).

Node ES module, runnable as `node tools/strip-canon-block.mjs [--check|--dry-run]`. Operates on `CLAUDE.md` and `AGENTS.md` in `process.cwd()`.

Import `CANON_START_RE` and `CANON_END` from `../src/cli/commands/upgrade.js` (exported in Step 2) — or inline them as literals if the relative import causes resolution issues from a `.mjs` tool.

Per-file behavior (applies to both `CLAUDE.md` and `AGENTS.md`):

| Condition | Behavior |
|---|---|
| File absent | No-op; report `"<file>: not found, skipping"` |
| Neither marker present | No-op; report `"<file>: no canon block found"` |
| Both markers present, `--check` | Report `"<file>: would strip canon block"`, no write |
| Both markers present, write mode, clean tree | Strip block inclusive; write cleaned content |
| Both markers present, write mode, dirty tree | Refuse; exit non-zero; no write |
| Only one marker present | Exit non-zero; no write; name the missing marker |

Dirty-tree detection: `git status --porcelain` on cwd. Untracked lines (`??`) do not count; any other status character = dirty.

Idempotent: after the block is stripped, second run hits "no canon block found" → no-op → exit 0.

CLI flags: `--check` and `--dry-run` are synonyms for report-only mode. Unknown flags → print usage; exit non-zero.

Exit codes: 0 = success or clean no-op; non-zero = refused (dirty tree, partial markers, unknown flag).

---

### Step 7 — `.github/workflows/ci.yml`: remove smoke asserts (AC-17)

Remove lines (currently around 125–126):
```yaml
          test -f AGENTS.md
          test -f CLAUDE.md
```

Leave `test -d .canon/templates`, `test -d .claude/skills`, the `canon doctor` invocation, and `canon task new`. `canon doctor` now passes without the two files because `checkAgentFile` is gone (Step 4).

---

### Step 8 — `scripts/run-task/prompts/templates/qa.md`: N5 fix (AC-12)

Line 46 (currently): `… (patterns.md / decisions.md / AGENTS.md) and pruning …`

Change `patterns.md / decisions.md / AGENTS.md` → `patterns.md / decisions.md`.

After this edit, regenerate the golden (see Step 15).

---

### Step 9 — Slim canon-ai's root `CLAUDE.md` (AC-10, AC-11)

Remove the `<!-- canon:start -->` (first line) and `<!-- canon:end -->` (~line 364) markers — delete those lines only, no other structural change from removing them.

**Keep/drop partition** (section by section):

| Section | Disposition | Surviving home if dropped |
|---|---|---|
| `## Role` (two modes, spec gate, pipeline rule, modifying-canon note) | **KEEP** | — |
| `## Starting a New Session` (both subsections) | **KEEP** | — |
| `## Task Workflow` — intro + `**Orchestrator mechanics**` pointer + `**Quick refs**` bullet list | **KEEP** | — |
| `### Writing a Spec` | **DROP** | `.claude/skills/canon-spec/SKILL.md` |
| `### Writing a Plan (S tasks — conversational)` | **DROP** | `.claude/skills/canon-pipeline/SKILL.md` |
| `### Writing a Plan (full tier — pipeline phase)` | **DROP** | `scripts/run-task/prompts/templates/plan.md` |
| `### Reviewing Code` | **DROP** | `.claude/agents/code-review-anchored.md`, `.claude/agents/code-review-cold.md` |
| `### Writing QA Summary` | **DROP** | `scripts/run-task/prompts/templates/qa.md` |
| `### Opening a PR (at human_review)` | **DROP** | `.claude/skills/canon-pipeline/SKILL.md` |
| `## Spec Authorship Guidelines` + `### Spec-writing rules of thumb` | **DROP** | `.claude/skills/canon-spec/SKILL.md` |
| `### Code-review rules of thumb` | **DROP** | `.claude/agents/code-review-anchored.md` |
| `## Review Responsibilities` | **KEEP** (slim to one sentence pointing to the anchored/cold agent charters) | — |
| `## Cross-review for inline and XS work` | **KEEP** | — |
| `## Codebase Navigation` | **KEEP** | — |
| `## Known Patterns & Pitfalls` | **KEEP** | — |
| `## Commands` | **KEEP** | — |
| `## Pull Requests` | **KEEP** | — |
| `## CI` | **KEEP** | — |
| `### Canon-managed file convention` | **KEEP** (update: remove "add delimiter-preserved files like `AGENTS.md` and `CLAUDE.md` to `DELIMITED`" — `DELIMITED` is now empty; change to a note that `DELIMITED` exists for future delimiter-preserved files but is currently empty) | — |

**Result**: CLAUDE.md retains the Role framing, session startup reading lists, the Quick refs operator checklist, the always-on norms (ask before committing, never self-review inline work, default toward smaller models), and thin pointers to skills/docs. Spec authorship, code-review, QA, and PR subsections are gone.

The `## Task Workflow` section retains ONLY its intro and Quick refs bullet list; the six subsections below (Writing a Spec, Writing a Plan ×2, Reviewing Code, Writing QA Summary, Opening a PR) are all dropped.

---

### Step 10 — Slim canon-ai's root `AGENTS.md` (AC-10, AC-11)

Current structure: entire file is the canon block (`<!-- canon:start -->` line 1 to `<!-- canon:end -->` ~line 364) + a canon-ai-local note below the end marker.

Remove `<!-- canon:start -->` (line 1) and `<!-- canon:end -->` (~line 364) markers.

**Keep/drop partition**:

| Section | Disposition | Surviving home if dropped |
|---|---|---|
| `## Agents` table + cross-review rule + communication norms | **KEEP** (keep the table and one-liner on each norm; drop the extended prose) | — |
| `**Agent memory**` (append-only lessons) + `**Per-task notes**` convention | **KEEP** | — |
| `**Workflow observability**` (pipeline-invocations.md, task-quality-log.md) | **KEEP** | — |
| `## Mission` | **DROP** (subsumed by the Agents table + CLAUDE.md) | CLAUDE.md |
| `## Workflow` (all subsections: Pipeline Tiers, Full-send, Bundle, Handoff Protocol, Orchestrator, Commit Ownership, Spec Lifecycle, Docs Freshness, Code-is-Canonical) | **DROP** | `docs/pipeline-orchestrator.md`; per-phase prompt templates; `.claude/skills/canon-pipeline/SKILL.md` |
| `## Roles (Summary)` | **DROP** | `CLAUDE.md` |
| `### Code Review Responsibilities` | **DROP** | `.claude/agents/code-review-anchored.md`, `.claude/agents/code-review-cold.md` |
| `## Human Escalation Contract` | **DROP** | `scripts/run-task/prompts/templates/implement.md` (Task A relocation) |
| `## Quick Start: Most Missed Rules` | **DROP** | Per-phase prompt templates |
| `## Implementation Rules` (Safe-First, Scope Discipline, Lint & Type, Diagnose Before Fix, Parsing) | **DROP** | `scripts/run-task/prompts/templates/implement.md` |
| `## Validation Matrix` | **DROP** | `scripts/run-task/prompts/templates/implement.md` |
| `## Git and PR Workflow` | **DROP** | Per-phase prompt templates |
| `## Release Rules` | **DROP** | `.claude/skills/canon-pipeline/SKILL.md` |
| `## Handoff Validation` | **DROP** | `.canon/templates/handoff.md` |
| `## Output Format for Human` | **DROP** | `scripts/run-task/prompts/templates/qa.md` |
| Canon-ai local note (below old `<!-- canon:end -->`) | **KEEP** (update: remove "add delimiter-preserved files like `AGENTS.md` and `CLAUDE.md` to `DELIMITED`"; `DELIMITED` is now empty) | — |

**Result**: AGENTS.md becomes a short file (~25–35 lines) with the Agents role table, cross-review rule, communication-norms note, agent memory/per-task-notes convention, workflow observability note, and the updated local note.

> **Spot-check before submitting** (AC-11): read 4–5 surviving homes from the table above and confirm the expected content is present. This task assumes Task A (`relocate-rules-to-prompts`) is complete and correct — do not re-touch its content.

---

### Step 11 — AC-13 sweep: docs and skill files

Run the AC-13 grep first to get the current hit list (may differ from spec's allow-list if drift occurred):
```
git grep -nI -e 'AGENTS\.md' -e 'CLAUDE\.md' -- README.md docs/ .claude/skills/ ':!docs/BACKLOG.md' ':!docs/lessons-learned.md' ':!tasks/' | grep -iE 'manage|delimit|scaffold|canon:end|canon:start|merge protocol'
```
Fix every hit. Per-file changes:

**`README.md`** (AC-14):
- State `CLAUDE.md`/`AGENTS.md` are adopter-owned, not canon-managed.
- Correct the `canon upgrade` description: it no longer merges a managed block into agent files; it skips them.
- Add an optional "recommended practice" note: for below-pipeline or inline work, get an independent cross-review via `/canon-inline-review` (or `codex review` if not running canon) rather than self-reviewing.

**`docs/decisions.md`** (AC-15):
- Add a new decision entry: "Canon ships zero managed content into adopter `CLAUDE.md`/`AGENTS.md`." Include the why (Task A relocated rules to JIT prompts/skills, making the canon block redundant; these files are now adopter-owned context for operators and agents).
- Fix stale "delimited `AGENTS.md` / `CLAUDE.md`" reference in the "Canon prescribes no release model" entry (`:159`).
- Fix the guidance-docs list at `:133` that describes `AGENTS.md`/`CLAUDE.md` as managed.

**`docs/architecture.md`**:
- Update the line at `:153` that says "canon-managed root files … sync-templates:check" for `AGENTS.md`/`CLAUDE.md`. They no longer sync; only `CANON_OWNED` files do. Rephrase to reflect this.

**`docs/product-context.md`**:
- Fix `:57`: `canon init` no longer scaffolds `AGENTS.md`/`CLAUDE.md`.

**`docs/pipeline-orchestrator.md`** (CANON_OWNED — root; sync `templates/` mirror after editing):
- Fix `:461`: "files canon scaffolded" — remove or correct references to `AGENTS.md`/`CLAUDE.md` being scaffolded.
- Fix `:295`: `AGENTS.md §Docs Freshness` cross-ref — repoint to the surviving location (`docs/pipeline-orchestrator.md` itself or the JIT prompt that carries the rule).

After editing, run `npm run sync-templates` to update `templates/docs/pipeline-orchestrator.md`.

**`.claude/skills/canon-init/SKILL.md`** (CANON_OWNED — root; sync `templates/` mirror after editing):
- Phase 0 (`:24`): Replace "scan for content **below** the `<!-- canon:end -->` delimiter" with: "read each file as adopter-owned project context — the whole file is adopter content; canon does not insert or manage a block."
- `:112`: Remove the "merge protocol for `AGENTS.md` / `CLAUDE.md`" reference from the Phase 4 pointer to `write-guide.md`. The pointer to `write-guide.md` itself can stay (for the other docs sections); just remove the framing that implies a canon-block merge for these files.

After editing, run `npm run sync-templates` to update `templates/.claude/skills/canon-init/SKILL.md`.

**`.claude/skills/canon-init/write-guide.md`** (CANON_OWNED — root; sync `templates/` mirror after editing):
- Section "Agent config files — merge protocol" (`:15`, `:67`): Replace the entire merge-protocol section with a brief adopter-owned note:

  Replace the section with:
  ```markdown
  ## Agent config files — adopter-owned

  `AGENTS.md` and `CLAUDE.md` are fully adopter-owned. Canon does not insert or manage a block in either file.

  If pre-existing files were detected in Phase 0, read them as project context — use what's there to inform the docs you write in Phase 4 (terminology, team conventions, known pitfalls). Do not rewrite or restructure the agent files themselves.
  ```

After editing, run `npm run sync-templates` to update `templates/.claude/skills/canon-init/write-guide.md`.

**`docs/codebase-map.md`** (AC-11 repointing):
- `:165` (Phase Addition wiring map): Change `→ AGENTS.md (handoff sequence + workflow diagram)` to `→ docs/pipeline-orchestrator.md` (the actual home post-Task A).
- `:180` (Artifact lifecycle wiring map): Change `→ relevant section in AGENTS.md (handoff protocol) and CLAUDE.md (authorship rules)` to `→ per-phase prompt templates in scripts/run-task/prompts/templates/`.
- `:192–193` (entry-point table rows for `AGENTS.md`/`CLAUDE.md`): Update the `detail` column to reflect "Ambient operator context (adopter-owned; rules delivered JIT via skills/prompts)" rather than "workflow source of truth" / "All agents follow this."

---

### Step 12 — Tests: `tests/cli.test.ts` (AC-5, AC-6, AC-7, AC-16, nit-2)

**Imports**: Remove `checkAgentFile` from the `doctor.js` import line.

**Delete**: The four `checkAgentFile` unit tests (lines ~307–335).

**Delete**: `runUpgrade: real templates dir produces valid merged CLAUDE.md` (line ~2250) — `templates/CLAUDE.md` no longer exists; the test expects `upgraded.includes('CLAUDE.md')` which will never be true.

**Replace** the three stale CLAUDE.md-via-DELIMITED `runUpgrade` tests (lines ~861–936) with a single test:
- **`runUpgrade: CLAUDE.md and AGENTS.md ignored after DELIMITED is empty`**: Create `CLAUDE.md` and `AGENTS.md` with arbitrary content in the project dir; call `runUpgrade`; assert neither appears in `upgraded`, neither appears in `skipped` with a delimiter-error message, and their content is byte-identical after the call.

**Add** (AC-5): `init: fresh directory creates neither CLAUDE.md nor AGENTS.md` — call `scaffoldTemplates(tmpDir, realTemplatesDir)`; assert `!existsSync(join(tmpDir, 'CLAUDE.md'))` and `!existsSync(join(tmpDir, 'AGENTS.md'))`.

**Add** (AC-6 — present path): `init: pre-existing AGENTS.md detected via direct existsSync` — write an `AGENTS.md` to temp dir; call the detection logic (or `initCmd` in the temp dir); assert the grill note fires (either via console capture or by extracting the `hasExistingAgentFiles` logic into a testable helper). Also assert the grill output does NOT contain "merge protocol".

**Add** (AC-6 — absent path): `init: no existing agent files → grill note does not fire` — empty temp dir; assert neither `CLAUDE.md` nor `AGENTS.md` grill note is emitted.

**Add** (AC-7): `runUpgrade: existing CLAUDE.md with arbitrary content left byte-identical` — create `CLAUDE.md` with plain content (no canon delimiters) in project dir; call `runUpgrade`; assert `CLAUDE.md` not in `upgraded` and content unchanged.

**Add** (AC-16): `doctorCmd: no fail for absent AGENTS.md and CLAUDE.md` — call `checkCanonDiscoveryNudge` (and confirm it warns, not fails) in a temp dir without those files. Assert no Check with `status: 'fail'` is returned by the canon-checks family. Simplest implementation: assert `checkCanonDiscoveryNudge(emptyDir).status === 'warn'` (not `'fail'`).

**Update** `ADOPTER_SHIPPED_PATHS` (~line 2395): Remove `'templates/AGENTS.md'`, `'templates/CLAUDE.md'`, `'AGENTS.md'`, and `'CLAUDE.md'` from the array. Update the comment to note these are no longer shipped to adopters.

---

### Step 13 — Tests: `tests/sync-canon-templates.test.ts` (AC-2, nit-2)

**Update** the `delimited sync preserves templates outside-delimiter content and ignores root tail` test (lines ~83–137):
- Keep the `mergeDelimitedForSync` function call and its assertion (lines ~109–119) — this is the AC-2 fixture-based unit test.
- Remove the `checkSync`/`applySync` assertions (DELIMITED_SYNC is now `[]`; `checkSync` no longer detects AGENTS.md drift).
- Optionally rename the test to: `mergeDelimitedForSync: preserves outside-delimiter content and ignores root tail`.

No other changes needed. `seedCanonFixture`'s DELIMITED_SYNC loop becomes a no-op — that's correct. The `mergeDelimitedForSync returns null` test (line ~139) uses string fixtures — unaffected.

---

### Step 14 — `tests/strip-canon-block.test.ts` (new, AC-8)

Drive `tools/strip-canon-block.mjs` via `spawnSync` in a temp dir initialized as a git repo. Use `git init` + `git add` + `git commit` to create a clean state; make files dirty when needed for dirty-tree tests.

Test cases (minimum coverage):

1. **Both markers present, write mode, clean tree** → block stripped, content outside block preserved; exit 0.
2. **Neither marker present** → file unchanged; exit 0; stdout mentions "no canon block found".
3. **Partial markers — start only** → exit non-zero; file unchanged.
4. **Partial markers — end only** → exit non-zero; file unchanged.
5. **File absent** → exit 0; stdout mentions "not found".
6. **`--check` mode, block present** → reports "would strip"; exits 0; file unchanged.
7. **`--check` mode, dirty git tree** → reports (no refusal); exits 0 (dirty-tree guard does not apply in check mode).
8. **Write mode, dirty git tree** → refuses; exits non-zero; file unchanged.
9. **Idempotent** → run twice on a file without markers; second run exits 0, no-op.
10. **Both files** → seed both `CLAUDE.md` and `AGENTS.md` with canon blocks; single tool run strips both; exit 0.

---

### Step 15 — Build, golden regeneration, and full validation (AC-18)

1. `npm run build` — rebuild `dist/` (Step 1–4 source changes baked in).
2. `UPDATE_GOLDENS=1 npm test` — regenerate `tests/run-task-prompts.golden.json` for the qa.md change (Step 8).
3. `npm test` — full suite must pass clean (including new strip-canon-block tests).
4. `npm run lint` — must pass.
5. `npm run docs-refs-check` — must pass (README and docs edits verified).

CI run on the task branch is the end-to-end check for AC-17 (git-install smoke).

---

## AC-11 mapping table

Every section removed from canon-ai's files has a surviving home:

| Dropped from | Section | Surviving home |
|---|---|---|
| `CLAUDE.md` | `### Writing a Spec` | `.claude/skills/canon-spec/SKILL.md` |
| `CLAUDE.md` | `### Writing a Plan (S / full)` | `.claude/skills/canon-pipeline/SKILL.md`; `scripts/run-task/prompts/templates/plan.md` |
| `CLAUDE.md` | `### Reviewing Code` | `.claude/agents/code-review-anchored.md`; `.claude/agents/code-review-cold.md` |
| `CLAUDE.md` | `### Writing QA Summary` | `scripts/run-task/prompts/templates/qa.md` |
| `CLAUDE.md` | `### Opening a PR` | `.claude/skills/canon-pipeline/SKILL.md` |
| `CLAUDE.md` | `## Spec Authorship Guidelines` + rules of thumb | `.claude/skills/canon-spec/SKILL.md` |
| `CLAUDE.md` | `### Code-review rules of thumb` | `.claude/agents/code-review-anchored.md` |
| `AGENTS.md` | `## Mission` | `CLAUDE.md` (Role section) |
| `AGENTS.md` | `## Workflow` (all subsections) | `docs/pipeline-orchestrator.md`; `scripts/run-task/prompts/templates/`; `.claude/skills/canon-pipeline/SKILL.md` |
| `AGENTS.md` | `### Code Review Responsibilities` | `.claude/agents/code-review-anchored.md`; `.claude/agents/code-review-cold.md` |
| `AGENTS.md` | `## Human Escalation Contract` | `scripts/run-task/prompts/templates/implement.md` (Task A relocation) |
| `AGENTS.md` | `## Quick Start: Most Missed Rules` | Per-phase prompt templates in `scripts/run-task/prompts/templates/` |
| `AGENTS.md` | `## Implementation Rules` | `scripts/run-task/prompts/templates/implement.md` |
| `AGENTS.md` | `## Validation Matrix` | `scripts/run-task/prompts/templates/implement.md` |
| `AGENTS.md` | `## Git and PR Workflow` | Per-phase prompt templates |
| `AGENTS.md` | `## Release Rules` | `.claude/skills/canon-pipeline/SKILL.md` |
| `AGENTS.md` | `## Handoff Validation` | `.canon/templates/handoff.md` |
| `AGENTS.md` | `## Output Format for Human` | `scripts/run-task/prompts/templates/qa.md` |

Cross-references in `docs/codebase-map.md` that pointed at dropped sections are repointed in Step 11 (lines `:165`, `:180`, `:192–193`).

---

## Notes for implementer (Codex)

- Do **not** re-touch Task A's (`relocate-rules-to-prompts`) prompt/charter content. Read those files for AC-11 spot-check only.
- Do **not** run the migration tool against canon-ai's own `CLAUDE.md`/`AGENTS.md`. The slim in Steps 9–10 is the canonical edit.
- For CANON_OWNED files edited in Step 11 (`docs/pipeline-orchestrator.md`, `.claude/skills/canon-init/SKILL.md`, `.claude/skills/canon-init/write-guide.md`): edit the root copy, then run `npm run sync-templates` to update the `templates/` mirror. Verify both root and mirror are dirty with `git status` before including them in the handoff.
- The `AGENT_FILES` set in `init.ts` line 19 (`new Set(['AGENTS.md', 'CLAUDE.md'])`) is retained — only the detection mechanism changes from `skipped.some(...)` to `existsSync`.
- `runUpgrade` stale CLAUDE.md tests (lines ~861–936) construct their own local `tmplDir` — these do not reference the production `templates/` path. Delete them entirely; the `mergeDelimited` function behavior is still covered by the string-fixture unit tests.
- The `ADOPTER_SHIPPED_PATHS` constant in `cli.test.ts` (~line 2395) uses `existsSync` to skip missing paths — so removing `templates/AGENTS.md`/`templates/CLAUDE.md` from the array is the correct change (not relying on the graceful skip). Do remove them.

---

## Reroute Plan

### Delta

The original implementation (Steps 1–15) is complete. This reroute adds the **amendment delta only**: strip `AGENTS.md`/`CLAUDE.md` read-instructions from the pipeline prompt helpers and add `docs/lessons-learned.md` to canon-ai's own `CLAUDE.md` reading list.

Implement these steps in order; all prior plan steps already shipped and need no revisiting.

---

#### Reroute Step A — `scripts/run-task/prompts/helpers.ts`: drop agent-file read-instructions (AC-A1, AC-A2)

Three targeted edits:

1. **`CLAUDE_STARTUP` (`:5`)**: remove `AGENTS.md` from the opening read list.
   ```
   // Before:
   'Read AGENTS.md and docs/patterns.md before starting.\n' +
   // After:
   'Read docs/patterns.md before starting.\n' +
   ```

2. **`CODEX_STARTUP` (`:13`)**: remove `AGENTS.md` from the opening read list.
   ```
   // Before:
   'Read AGENTS.md, docs/patterns.md, and docs/codebase-map.md before starting.\n' +
   // After:
   'Read docs/patterns.md and docs/codebase-map.md before starting.\n' +
   ```

3. **`toResumePrompt` (`:49`)**: remove `AGENTS.md,` from the parenthetical in the resumed-session banner.
   ```
   // Before:
   'Skip startup boilerplate re-reads (AGENTS.md, architecture docs, etc.)'
   // After:
   'Skip startup boilerplate re-reads (architecture docs, etc.)'
   ```

After editing, run the AC-A2 structural check:
```
git grep -nE 'AGENTS\.md|CLAUDE\.md' -- scripts/run-task/prompts/
```
Expected: no output.

---

#### Reroute Step B — `CLAUDE.md`: add `docs/lessons-learned.md` to conversational-session reading list (AC-A3)

In the `## Starting a New Session → Conversational Session` reading list (current lines 31–33), add `docs/lessons-learned.md` as a skim-for-any-work entry. The current list:

```markdown
- Always read: `AGENTS.md`, this file
- When writing a spec: `docs/product-context.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/codebase-map.md`
- When orienting or resuming after a gap: `docs/architecture.md` and in-progress tasks under `tasks/`
```

Add a new bullet between "Always read" and "When writing a spec":
```markdown
- Skim for any work: `docs/lessons-learned.md` (recent distilled memory)
```

The "Always read" bullet is unchanged; the two existing context-conditional bullets remain.

---

#### Reroute Step C — Build, golden regeneration, and full validation (AC-A4)

1. `npm run build` — rebuild `dist/` with the helpers.ts change baked in.
2. `UPDATE_GOLDENS=1 npm test` — regenerate `tests/run-task-prompts.golden.json` (the helpers change flows into the CLAUDE/CODEX startup prompt snapshots).
3. `npm test` — full suite must pass.
4. `npm run lint` — must pass.
5. `npm run docs-refs-check` — must pass (CLAUDE.md edit adds a docs reference).
6. `npm run sync-templates:check` — must pass (`CLAUDE.md` is not CANON_OWNED so no template sync needed; confirm no unsynced mirrors).

---

### Notes for implementer (Reroute)

- The three helpers.ts edits are mechanical — do not restructure the constant strings or add conditional logic.
- `CLAUDE.md` is canon-ai-local after this task (not in `CANON_OWNED`, no `templates/` mirror); edit the root file only.
- The `QA_STARTUP` constant already reads `docs/lessons-learned.md` (`helpers.ts:28`) — confirm it is untouched.
- The golden regeneration will update the CLAUDE_STARTUP/CODEX_STARTUP snapshot rows; verify the diff shows only the `AGENTS.md` removal, nothing else.
