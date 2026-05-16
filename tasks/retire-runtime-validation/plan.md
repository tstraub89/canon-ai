# Plan: retire-runtime-validation — Retire runtime_validation pipeline phase

> Written by: Claude (pipeline session)

## Spec-review nits incorporated

- **AC-11d golden update command**: the exact command is `UPDATE_GOLDENS=1 npm test` (documented at `tests/run-task-prompts.test.ts:164`). Codex uses this unless implementation reveals a newer project script.
- **AC-20 purity note**: `getAffectedFiles()` is the impure wrapper (calls `gitSafeAtRaw`). A pure `parseNameStatusOutput(raw: string): string[]` function is the test seam — consistent with `verifyHandoffAgainstDiffFromData()` pattern already in `scripts/run-task/validation.ts`.

---

## Implementation order

Steps are ordered to keep the TypeScript type graph consistent: remove the type first, then callers, then tests, then add new code, then update docs.

---

### Step 1 — Core type + policy removal

**Files**: `scripts/run-task/types.ts`, `scripts/pipeline-policy.ts`

1. `scripts/run-task/types.ts:12` — Remove `'runtime_validation'` from `PHASE_ORDER`. Result: `['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review']` (AC-1).
2. `scripts/run-task/types.ts:101-103` — Remove the `runtimeIterations`, `runtimeIterations_current_loop`, and `runtimeIterations_total` fields from the `TaskContext` type declaration (AC-7 partial).
3. `scripts/pipeline-policy.ts` — Remove `type RuntimeCheck` (lines ~194-202) and the `RUNTIME_CHECKS` constant (lines ~204-206). Remove any import-only references in the same file that become dead (AC-10).

After this step: the `Phase` union no longer includes `'runtime_validation'`; `TaskContext` no longer carries `runtimeIterations*`; `RuntimeCheck` and `RUNTIME_CHECKS` are gone. TypeScript compilation will fail until callers are updated — that is expected and resolved across Steps 3-9.

---

### Step 2 — Delete the phase handler file

**File**: `scripts/run-task/phases/runtime-validation.ts`

Delete the file entirely (AC-9). Nothing in a later step resurrects it; the import at `scripts/run-task/main.ts:9` is removed in Step 3 and the import at `scripts/run-task/prompts/index.ts:11` is removed in Step 9.

---

### Step 3 — Clean up `main.ts`

**File**: `scripts/run-task/main.ts`

Make all removals in one edit pass:

1. **Line 9** — Remove the `runRuntimeValidationPhase` import (AC-2).
2. **Line ~129** — Narrow `getVerdict()`'s phase parameter type to `'spec_review' | 'code_review'` by removing `| 'runtime_validation'` (AC-3).
3. **Line ~151** — Remove `runtimeValidation = status.phases.runtime_validation` extraction and any downstream reads of `runtimeValidation` that become dead code (AC-4).
4. **Line ~660** — Remove the `if (phase === 'runtime_validation')` early-return branch (AC-5).
5. **Lines ~1251-1252** — Remove the `'runtime_validation'` dispatch case from `runPhase()` (AC-6).
6. **`checkAndRoute()` lines ~1586-1602** — Remove the `case 'runtime_validation':` branch entirely (AC-8).
7. **`buildPipelineState()` lines ~1446-1477** — Remove both occurrences of `runtimeIterations`, `runtimeIterations_current_loop`, and `runtimeIterations_total` population (AC-7 partial). Do not add zero-value fallbacks — the fields no longer exist on `TaskContext`.

---

### Step 4 — Clean up `state.ts`

**File**: `scripts/run-task/state.ts`

Remove lines ~111-112: the default-block injection that synthesizes a `runtime_validation` block when a parsed status.json is missing one (AC-11). Verify that the existing write path passes unknown fields through unchanged — if `writeStatus()` spreads or assigns the parsed object back without shape-filtering, it already satisfies AC-25's roundtrip requirement. Note any deviation in `handoff.md`.

---

### Step 5 — Clean up `validation.ts`

**File**: `scripts/run-task/validation.ts`

Remove all `runtime_validation` plumbing (AC-11a):

1. Remove the `cleanRuntimeCheckName(value: string): string` helper (~lines 131-133).
2. Remove the `computeLatestRuntimeResults()` function and the `parseTable('Runtime Validation Outcomes', ...)` + `parseTableH3(body, 'Re-run runtime validation')` parsing it contains (~lines 135-165). `computeLatestRuntimeResults` is only consumed from `scripts/run-task/prompts/index.ts` (removed in Step 9); remove the export.
3. Remove the `runtime_validation: {}` entry in the phase-gate-config map (~line 508).
4. Remove or rewrite comment fragments containing `runtime_validation` (~lines 499, 562) so no `runtime_validation` substring survives in this file.

---

### Step 6 — Clean up `context.ts`

**File**: `scripts/run-task/context.ts`

Remove the `runtimeIterations_current_loop` read at ~line 165 and the revision-header branch it gates — the branch that emitted an "addressing runtime-check failures" header (AC-7 partial). After removal, header logic collapses to the code-review revision path only.

---

### Step 7 — Clean up `phases/implement.ts` and thread `affectedFiles`

**File**: `scripts/run-task/phases/implement.ts`

1. Remove `runtimeIterations_current_loop` from `shouldUseImplementRevision()`'s destructure at lines 15-17. Reduce the predicate to `tasks.some(t => t.iterations_current_loop > 0)` (AC-7 partial).
2. Import `getAffectedFiles` from `'../git.js'` (added in Step 8 — Codex may forward-declare the import here or add it after Step 8).
3. Compute `affectedFiles` once, before the prompt selection block. The base branch is `tasks[0].status.base_branch ?? 'main'`; the cwd is `activeCwd` (already computed on line 48):
   ```typescript
   const baseBranch = tasks[0].status.base_branch ?? 'main';
   const affectedFiles = getAffectedFiles(baseBranch, activeCwd);
   ```
4. Thread into each prompt call site (AC-22):
   - `promptImplement(state, 'fresh', affectedFiles, baseBranch)` — fresh path
   - `promptImplementRevisions(state, affectedFiles, baseBranch)` — revision path
   - `promptImplementReroute(state, resumeId !== null, affectedFiles, baseBranch)` — reroute path
   - `promptImplementResume(state)` — **unchanged**; no `affectedFiles` parameter (AC-22 spec)

---

### Step 8 — Add `getAffectedFiles()` to `git.ts`

**File**: `scripts/run-task/git.ts`

Add two exports (AC-20, AC-21). `gitSafeAtRaw` is already exported from this module — reuse it directly. Place the new functions at the bottom of the file:

```typescript
export function parseNameStatusOutput(raw: string): string[] {
    const paths = new Set<string>();
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        // Rename lines: R<score>\told\tnew — include both sides
        if (parts.length === 3 && parts[0].startsWith('R')) {
            paths.add(parts[1]);
            paths.add(parts[2]);
        } else if (parts.length >= 2) {
            paths.add(parts[1]);
        }
    }
    return [...paths].sort();
}

export function getAffectedFiles(baseRef: string, cwd: string): string[] {
    const result = gitSafeAtRaw(cwd, 'diff', `${baseRef}...HEAD`, '--name-status', '-M');
    if (!result.ok || !result.stdout.trim()) return [];
    return parseNameStatusOutput(result.stdout);
}
```

`parseNameStatusOutput` is the pure test seam (accepts raw `--name-status` output). `getAffectedFiles` is the impure wrapper.

---

### Step 9 — Clean up and extend `prompts/index.ts`

**File**: `scripts/run-task/prompts/index.ts`

1. **Line 8** — Remove `import { RUNTIME_CHECKS } from '../../pipeline-policy.js'` (AC-11b).
2. **Line 11** — Remove `import { sanitizeRuntimeCheckName } from '../phases/runtime-validation.js'` (AC-11b).
3. Remove the `computeLatestRuntimeResults` import from `'../validation.js'` (it was removed in Step 5).
4. Delete the `buildRuntimeFailureEntries()` helper function entirely — it references `RUNTIME_CHECKS`, `sanitizeRuntimeCheckName`, and `task.runtimeIterations*` fields (AC-11b).
5. In `promptImplementRevisions()` (AC-11b + AC-22):
   - Remove `const maxRuntimeIter = ...`, `const hasRuntimeFailures = ...`, and `const runtimeFailureEntries = ...`.
   - Simplify `iterBanner` and `handoffAppend` to the `hasReviewFindings`-only branch: `[ITERATION ${iterationN} — addressing code review round ${priorRound}]`.
   - Remove `hasRuntimeFailures` and `runtimeFailureEntries` from the `render()` call.
   - Add `affectedFiles: readonly string[]` and `baseBranch: string` parameters to the function signature.
   - Add `affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch)` to the render view object.
6. Update `promptImplement()` (AC-22):
   - Add `affectedFiles: readonly string[]` and `baseBranch: string` parameters.
   - Add `affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch)` to the render view.
7. Update `promptImplementReroute()` (AC-22):
   - Add `affectedFiles: readonly string[]` and `baseBranch: string` parameters.
   - Add `affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch)` to the render view.
8. `promptImplementResume()` — no changes (AC-22 spec).
9. Add a private `buildAffectedFilesBlock(affectedFiles: readonly string[], baseBranch: string): string` helper that renders the two-branch wording from AC-23 verbatim:

   **Non-empty** — render:
   ```
   ## Affected files (committed diff vs base branch)

   The following files have committed changes on this task's branch vs `<baseBranch>`:

   - `<path-1>`
   - `<path-2>`
   - ...

   Use this set when applying predicate-gated checks from the spec's *Validation Required* section. If a check is gated (e.g., "run e2e only if `src/` changed"), evaluate the predicate against the affected-files set; when the predicate is false, skip the check and record the skip in the Validation Outcomes table with the predicate's verbatim condition in the Notes column. When no predicate gates a check in the spec, run the check unconditionally.
   ```

   **Empty** — render:
   ```
   ## Affected files (committed diff vs base branch)

   No prior commits on this task's branch yet. Apply the full default check matrix from the spec's *Validation Required* section — every check runs unconditionally on this first implement pass. Predicate gating is meaningful only once the task branch has committed changes.
   ```

**Template approach**: pass the pre-rendered block as `{{{affectedFilesBlock}}}` (triple-braces). This matches the `{{{reviewLines}}}` pattern already used in `promptImplementRevisions()` — no Mustache array iteration needed.

---

### Step 10 — Update implement prompt templates

**Files**: `scripts/run-task/prompts/templates/implement-revisions.md`, `scripts/run-task/prompts/templates/implement.md`, `scripts/run-task/prompts/templates/implement-reroute.md`

**`implement-revisions.md`** (AC-11c + AC-23):
1. Delete the entire `{{#hasRuntimeFailures}}` … `{{/hasRuntimeFailures}}` block at lines 17-42.
2. Delete the `{{^hasReviewFindings}}` … (closing `{{/hasReviewFindings}}`) branch at lines 46-48 — the fallback "APPEND … runtime failures addressed" instruction. After deletion, only the `{{#hasReviewFindings}}` "APPEND" instruction and the unconditional closing lines remain.
3. Rewrite line 50: remove `or runtime check` — becomes `Spec ACs remain binding. If the review identifies a dropped AC, restore it.`
4. Add `{{{affectedFilesBlock}}}` after `{{{startup}}}` and before the `{{#hasReviewFindings}}` block (place it at the same relative position as in the other templates — right after startup, before task-specific instructions).

**`implement.md`** (AC-23):
Add `{{{affectedFilesBlock}}}` after line 4 (`{{{startup}}}`), before "Tasks to implement:" (before the current `{{{taskLines}}}` section).

**`implement-reroute.md`** (AC-23):
Add `{{{affectedFilesBlock}}}` after `{{{startup}}}` / `{{{risksBlock}}}` / `{{{pitfallsBlock}}}` / `{{{contextBlock}}}` and before "Tasks with amended specs:" — consistent placement with the other templates.

Use triple-braces `{{{affectedFilesBlock}}}` throughout (no HTML escaping, same as `{{{stateHeader}}}` / `{{{startup}}}`).

---

### Step 11 — task.sh cleanup

**File**: `scripts/task.sh`

1. **All four `phase_order` jq defs** (lines 271, 355, 405, 482) — remove `"runtime_validation"` from each array literal (AC-12).
2. **Null-case shim** (lines 274, 358, 407 — three occurrences) — remove the entire `if $p == "runtime_validation" and ($doc.phases[$p]? == null) then "done"` conditional at each occurrence (AC-13).
3. **Phase validation case statement** (lines ~302, 308-310) — remove the `runtime_validation` case so `./scripts/task.sh phase <id> runtime_validation done` exits non-zero (AC-14).
4. **Verdict-allowing list and iteration-mutation jq** (lines ~338-339, ~414, ~425) — remove `runtime_validation` from each (AC-15).
5. **Help text** (lines ~97, 99) — remove `runtime_validation` from the phase list (AC-16).

---

### Step 12 — Template and handoff files

**Files**: `.canon/templates/status.json`, `templates/.canon/templates/status.json`, `.canon/templates/handoff.md`, `templates/.canon/templates/handoff.md`

1. Remove the `runtime_validation` phase block (lines 34-43) from `.canon/templates/status.json` (AC-17).
2. Apply the identical edit to `templates/.canon/templates/status.json`. Confirm byte-identity via `diff` (AC-18).
3. Remove the "Runtime Validation Outcomes" example block (lines 84-121) from `.canon/templates/handoff.md` (AC-19).
4. Apply the identical edit to `templates/.canon/templates/handoff.md`. Confirm byte-identity (AC-19).

---

### Step 13 — AGENTS.md + templates/AGENTS.md

**Files**: `AGENTS.md`, `templates/AGENTS.md`

1. **AC-26**: Remove the "Validation authority boundary" paragraph at `AGENTS.md:96`. No replacement.
2. **AC-27**: Delete handoff sequence step 5 (orchestrator runs registered runtime checks) at `AGENTS.md:90`. Renumber old steps 6-9 to steps 5-8. Search all inline `step [0-9]` references elsewhere in `AGENTS.md` and update them.
3. **AC-28**: Update the "Commit Ownership" wording at `AGENTS.md:127`: `"…before runtime_validation/code_review"` → `"…before code_review"`.
4. **AC-28a**: Rewrite the Fast-tier and Full-tier pipeline diagrams at `AGENTS.md:43` and `AGENTS.md:53` to remove the `Orchestrator runtime validation →` arrow. Update surrounding bullets/paragraphs to match.
5. **AC-28b**: Apply all four edits above to `templates/AGENTS.md`. Confirm byte-identity of the `<!-- canon:start --> … <!-- canon:end -->` fence:
   ```
   diff <(sed -n '/canon:start/,/canon:end/p' AGENTS.md) <(sed -n '/canon:start/,/canon:end/p' templates/AGENTS.md)
   ```

---

### Step 14 — CLAUDE.md, CODEX.md + their templates

**Files**: `CLAUDE.md`, `templates/CLAUDE.md`, `CODEX.md`, `templates/CODEX.md`

**`CLAUDE.md`** (AC-34b):
1. Line ~101: rewrite to "After implement, the orchestrator advances directly to code review."
2. Line ~109: remove the sentence "Also read the orchestrator-authored Runtime Validation Outcomes section if present; failed runtime checks should have routed back before code review."

**`CODEX.md`** (AC-34b):
1. Lines 8-9: remove `→ runtime validation →` from Fast-tier and Full-tier flow lines.
2. Line ~52: delete the entire paragraph beginning "After implement, the orchestrator may run registered runtime checks…".
3. Line ~56: shorten subsection lead to "When Claude writes `tasks/TASK-ID/review.md` with changes requested:".
4. Line ~60: remove the runtime-failures bullet.
5. Line ~66: remove the runtime-checks rerun bullet.

Apply identical edits to `templates/CLAUDE.md` and `templates/CODEX.md` (AC-34c). Confirm canon-fence byte-identity for each via diff.

---

### Step 15 — Docs and skill updates

Apply in any order; each is independent.

**`docs/pipeline-orchestrator.md`** (AC-29):
- Remove/rewrite all `runtime_validation` references at lines 61, 181, 225, 231, 251.
- Update phase flow text to `implement → code_review`.
- Remove the `ORCHESTRATOR_CHECK_TIMEOUT_MS` env var row (line 182).
- Delete the "Runtime Validation Phase" section (~lines 229-251).
- Collapse post-review composability prose at line ~317 to code-review reroutes only.
- Apply identical edits to `templates/docs/pipeline-orchestrator.md` (AC-29a). Confirm canon-portion byte-identity.

**`docs/architecture.md`** (AC-30):
- Remove the `9. Runtime validation:` bullet at line ~86.
- Remove `runtime_validation` from the auto-block phase list at line ~169.

**`docs/product-context.md`** (AC-31):
- Rewrite lines ~128-129: replace "near-term: project-policy extension points for real runtime_validation checks" with a sentence reflecting the settled decision — adopters extend via `.codex/config.toml` and project scripts.

**`docs/BACKLOG.md`** (AC-32):
1. `verdict_source` entry (~line 399): change `('spec_review', 'code_review', 'runtime_validation')` → `('spec_review', 'code_review')`.
2. `deepsec / cwd-mismatch bug` entry (~line 362): remove `scripts/run-task/phases/runtime-validation.ts:188` from the Confirmed call sites list. If no live call sites remain, retire the entry in place with `> **Retired** 2026-05-16 — superseded by retire-runtime-validation (all confirmed call sites deleted)`.
3. `RuntimeCheck.cwd: 'repo_root'` coverage-gap entry (~lines 404-407): retire in place — prepend `> **Retired** 2026-05-16 — moot after retire-runtime-validation deletes RuntimeCheck.` Do not delete the entry body.

**`README.md`** (AC-34a):
- Line ~55: remove `runtime_validation →` from the pipeline flow string. Result: `… → implement → code_review → …`.

**`.canon/README.md`** (AC-34):
- Add a new section titled "Project-specific validation checks during `implement`" (~5 lines) explaining: adopters configure Codex sandbox permissions in their project-owned `.codex/config.toml` (not in `CANON_OWNED`), and real checks live in their `package.json` scripts rather than canon-side policy modules. One paragraph.
- Apply the identical addition to `templates/.canon/README.md`. Confirm byte-identity.

**`src/cli/index.ts`** (AC-33):
- Lines 29, 40, 57: remove `runtime_validation` from all three phase-list strings in help text.

**`.claude/skills/canon-pipeline/SKILL.md`** (AC-34d):
- Lines 32, 35, 71: drop `runtime_validation` from phase-flow strings and valid-phases list.
- Lines ~211, 217, 219: delete the paragraph describing the orchestrator-run runtime-validation phase and the entire `### runtime_validation failed — task didn't reach code_review` recovery subsection.
- Apply identical edits to `templates/.claude/skills/canon-pipeline/SKILL.md`.

**`.claude/skills/canon-status/SKILL.md`** (AC-34d):
- Line ~64: delete the `runtime_validation.status = "changes_requested"` recovery bullet.
- Apply identical edit to `templates/.claude/skills/canon-status/SKILL.md`.

---

### Step 16 — Test file updates

**Delete** (AC-35):
- `tests/run-task-runtime-validation.test.ts` — delete the file entirely.

**Fixture cleanups** (AC-36):
- `tests/run-task-harness.test.ts` lines 74, 88-94: remove `runtime_validation` block from fixture status.json objects.
- `tests/run-task-canon-snapshot.test.ts` line 37: same.
- `tests/run-task-counter-schema.test.ts` line 37: same.

**Remove existing tests** (AC-37, AC-37a, AC-37b):
- `tests/run-task-validation.test.ts:782-790`: remove the `"checkPhaseGate: runtime_validation has no gate"` test.
- `tests/pipeline-policy.test.ts`: remove `RUNTIME_CHECKS` import (line 10) and the `assert.deepEqual(RUNTIME_CHECKS, [...])` block (~line 192) plus any dependent setup.
- `tests/run-task-prompts.test.ts:125-140`: remove the three `runtimeIterations*` keys from the test fixture/partial-task helper.

**Add new tests** (AC-21, AC-24, AC-25):

In `tests/run-task-validation.test.ts`, add three new `describe` blocks:

1. **`parseNameStatusOutput` (AC-21 — pure seam tests)**:
   - `parseNameStatusOutput('')` → `[]`
   - `parseNameStatusOutput('M\tsrc/foo.ts')` → `['src/foo.ts']`
   - `parseNameStatusOutput('R95\told.ts\tnew.ts')` → `['new.ts', 'old.ts']` (both sides, sorted)
   - `parseNameStatusOutput('D\tsrc/gone.ts')` → `['src/gone.ts']`
   - `parseNameStatusOutput('B\tbin/binary')` → `['bin/binary']`

2. **Implement prompt `affectedFiles` rendering (AC-24)**:
   - `buildAffectedFilesBlock([], 'main')` → output contains "No prior commits on this task's branch yet"
   - `buildAffectedFilesBlock(['src/a.ts', 'src/b.ts'], 'main')` → output contains a bullet list of both paths under `## Affected files`
   - Confirm location in `handoff.md` (here or a new prompt-builder test file).

3. **Migration-tolerance parser test (AC-25)**:
   - Load a fixture status.json containing a `runtime_validation` phase block.
   - `parseStatus()` does not throw.
   - Resolved next phase after `implement` is `code_review`, not `runtime_validation`.
   - Write-roundtrip via the serialization path preserves the legacy `runtime_validation` block.

**Regenerate golden (AC-11d)**:
- After all template edits land, run `UPDATE_GOLDENS=1 npm test`.
- Confirm `grep -i runtime tests/run-task-prompts.golden.json` returns no matches.
- Confirm suite passes.

---

### Step 17 — Tombstone

**File**: `tasks/_archive/runtime-validation-phase/done.md`

After the existing H1 title (first line), before existing content, prepend (AC-38):

```
> **Superseded** by docs/decisions.md "Validation runs inside agent phases (supersedes orchestrator-run runtime_validation)" — 2026-05-15. The phase shipped in this task is retired by task retire-runtime-validation.
```

---

### Step 18 — Structural verification and validation

Run in order (AC-39, AC-40):

1. `npm run lint` — must pass.
2. `npm run type-check` — must pass.
3. `npm test` — must pass. Record before/after test counts in `handoff.md`.
4. `npm run build` — must pass (builds the `canon-ai` CLI bundle from `src/cli/index.ts`).
5. Structural grep (AC-39):
   ```
   git grep -nE 'runtime[_-]validation|RUNTIME_CHECKS|RuntimeCheck|runtimeValidation|Runtime Validation|runtimeIterations'
   ```
   Every match must be in the AC-39 allow-list. Paste the full grep output in `handoff.md` under *Validation Outcomes* (or "no matches outside allow-list").

---

## Codex implementation notes

- **Template mirrors**: after each mirror edit, run `diff` and record the result in `handoff.md`. Files with `<!-- canon:start/end -->` fences: compare only the fenced region via `sed -n '/canon:start/,/canon:end/p'`. Files without fences (`.canon/templates/`, SKILL.md files): compare the whole file.
- **`runtimeIterations*` cascade check**: after Step 1 removes these fields from `TaskContext`, confirm no template file still references `{{runtimeIterations}}` or similar. A leftover reference renders empty without throwing — silent regression. The golden regeneration in Step 16 catches this.
- **AGENTS.md step renumbering (Step 13)**: after deleting step 5, search for all `step [0-9]` inline references in the file and update every one. Missing one produces a stale pointer in policy documentation.
- **`shouldUseImplementRevision()` export**: this function is exported and tested. After removing `runtimeIterations_current_loop` from its parameter type, the test in `tests/run-task-harness.test.ts` (or wherever it's tested) that passes the old shape must also be updated — treat as part of the fixture cleanups in Step 16.
- **Delicate-flag caution**: this task is `delicate: true`. After Steps 1-9, confirm every site in `main.ts`, `types.ts`, and `state.ts` that previously read or wrote the `runtime_validation` block is either removed or made tolerant. AC-39's grep is the structural backstop; the diff review is the safety net.
