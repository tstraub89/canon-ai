# Spec: spec-manifest-lint — Reject malformed scope manifests before planning and implementation

> Written by: Claude | Review by: spec reviewer
> Status: draft (revised after spec_review round 1: red-first requirement for AC-6; shape 3 wording narrowed)

## Problem

The spec's `### Affected Files` table is canon's scope manifest. The implement prompt preloads it. The `code_review` pre-flight builds its allowlist from it, and so does the `--pr`/`--push` base-drift gate. All three read it through one parser: `parseAffectedFilesFromSpec` → `extractSectionBodies` + `parseAllTablesH3` + `parseHandoffPathCell`. That parser loses paths in several shapes. Some losses are silent and some produce only a warning, and every consumer only warns. The failure therefore shows up late, usually as an out-of-scope auto-block at `code_review` entry or a scope-drift abort at `--pr`, after implement and review budget is spent.

Shapes confirmed by reading `src/orchestrator/markdown-table.ts` and `src/orchestrator/validation.ts`, and by in-memory probes during spec review:

1. **Fused cells (silent).** `parseAllTablesH3` maps cells only up to the header's column count. `` | `a.ts` | change || `b.ts` | change | `` loses `b.ts` with no diagnostic. This bit `agent-backend-role-routing` and is recorded as a lessons-learned entry.
2. **Header-less blocks (silent).** Every contiguous `|` block's first line becomes that block's header. A table split by a blank or note line, or a table with no separator row, loses the first file row of the affected block.
3. **Malformed path cells (warn-only, late).** `parseHandoffPathCell` fails a cell in two ways:
   - A *structural* failure drops the whole cell, every path in it. Examples: prose before the path, or a second backticked token in the annotation (`` `old.ts` → `new.ts` ``, `` `dist/` (rebuilt by `npm run build`) ``).
   - A *per-path* failure drops only the offending token and keeps valid comma-joined siblings. Examples: a `<path>` placeholder, an absolute path, or a glob. For instance, `` `a.ts`, `<path>` `` returns `a.ts` plus a placeholder diagnostic (executed during spec review).

   Either way, the dropped path is only reported as a warning at `code_review` or `--pr`, and nothing earlier checks.
4. **Ignored headings (silent).** Only an exact `### Affected Files` line inside an H2 matching `/^## Design\b/` or `/^## Amendment\b/` is parsed. A table under `### Affected files`, `#### Affected Files` or `### Amendment Affected Files`, or an exact heading under another H2 such as `## Scope` or `## Amendments`, yields zero rows with no warning.
5. **Duplicate exact heading (silent).** `parseAllTablesH3` reads only the first `### Affected Files` in each H2 body. A second exact heading's table in the same `## Design` or `## Amendment…` body is dropped.
6. **Fenced or commented manifest content (silent; a parser bug this task fixes).** `extractSectionBodies` and `parseAllTablesH3` do not skip fenced code blocks, and they read `|` lines inside `<!-- -->` comments. A fenced example `### Affected Files` before the real one becomes the parsed table and displaces the real rows. A commented-out table is parsed as live scope.

   **Confirmed mechanism (deterministic).** Neither function tracks fence state. `parseAllTablesH3` anchors on the first line equal to `### Affected Files` in the H2 body, then ends that section at the next `#`–`###` line. When a fenced example heading comes first, its table is read, and the real heading after it ends the section, so the real table is never reached. For comments, `extractSectionBodies` uses comment-hiding only to find H1/H2 boundaries and returns the body with commented lines intact. `parseAllTablesH3` then reads any commented table that has its own header and separator row as live rows.

   **How confirmed:** executed probes of `extractSectionBodies` + `parseAllTablesH3` against the current source, run by the spec reviewer and re-run while revising this spec:
   - A `## Design` body with a fenced `### Affected Files` table listing `example.ts`, then the real heading and table listing `real.ts`, returns only `example.ts`.
   - A real table listing `real.ts`, plus a `<!-- -->`-wrapped table (header, separator, `old.ts` row) under the same heading, returns both `real.ts` and `old.ts`. This holds whether the commented table comes before or after the live one.
   - A lone commented `|` row right after a live table is *not* returned today. It is lost as a header-less block (shape 2), so it is not a red-first case for shape 6.

   Fixed inputs take the same branch every run, so an executed probe is sufficient evidence for this mechanism class. AC-6 carries the red-first regression test.
7. **Empty first cell (silent).** A row with an empty column 1 is skipped even when the row's other cells mention a path.

The operator's notes record about nine bites of this family across canon-ai and an adopter repo. `docs/BACKLOG.md` carries "Shift the `--pr` artifact-format gates left" (b): run Affected-Files/docs-refs validation at spec or pre-implement.

Today the manifest is never validated before `code_review`. `checkPhaseGate('spec')` checks only that `spec.md` exists and is not the unfilled template.

## Decision

Add a **manifest lint** that reports every shape above as an error. Each error names the section, the row where applicable, and a fix-it hint. It runs at two kinds of points:

1. **Early, agent-fixable: the `spec` phase gate.** `canon task phase <id> spec done` runs the lint after the existing template check and refuses to advance on any issue, printing all of them. Conversational authoring, the pipeline's spec phase and spec revisions all run this command, so all three are covered. The orchestrator's evidence recovery for the spec phase (`tryEvidenceAdvance('spec')`) runs the same lint before it tries to advance. On failure it returns "not advanced" with the issues as its note, so the agent's one-shot retry receives them instead of the run crashing. The existing `CANON_SKIP_PHASE_GATE` bypass still skips the gate.
2. **Backstop, orchestrator-owned: a pre-flight at plan entry and at implement entry.** Before the `plan` phase's agent runs, and before the `implement` phase's agent runs, the orchestrator lints each task's spec. On any issue it auto-blocks that phase before any agent runs and exits non-zero, the same way the `code_review` scope pre-flight does. It prints the issues and the recovery: fix the table in the active checkout's `spec.md` and rerun `canon run <id>`. `--force` bypasses it with a warning that lists the issues. This one backstop covers every path that changes the manifest without a fresh `spec done`:
   - spec edits after spec_review `changes_requested`;
   - edits at the human spec gate;
   - `canon task reset-spec-review` (which writes `spec: done` without the gate);
   - every `--reroute` amendment, including spec_gap reroutes, since a reroute resumes at implement entry;
   - any foreman `## Amendment (full-send scope)` table present by then.

The lint reads the manifest the way the consumers do. It shares the consumers' scan, so the lint and the parser cannot disagree about which tables exist. Shape 6 is fixed at the source rather than only reported: the shared scan skips fenced code blocks and HTML comments for every consumer. A fenced example is then neither parsed nor an error, and commented rows stop counting as scope.

The accepted manifest grammar does not otherwise change:
- Every cell `parseHandoffPathCell` accepts today stays accepted, including directory entries with a trailing `/` and comma-joined paths.
- A spec with no Affected Files table stays valid.
- The later consumers keep their behavior, apart from no longer reading fenced or commented content.

### Implementation Notes (non-binding; owned by plan/implement)

- **Shape.** A pure function over spec markdown returning issues `{ section, row?, kind, message }`, plus a wrapper that reads `spec.md` from the same task dir the caller used (honor `checkPhaseGate`'s `taskDirOverride`; use the active checkout in the orchestrator pre-flights).
- **Shared scan.** Prefer one raw scanner (sections, headings, table blocks with raw rows) that both `parseAllTablesH3`/`extractSectionBodies` and the lint consume. `scanAllTables` in `markdown-table.ts` already skips fences and is a candidate base. Section selection must keep the consumer's `\b` boundaries (`## Design Notes` matches; `## Amendments` does not).
- **Cell checks.** Reuse `parseHandoffPathCell` for the cell verdict. `validateExtractedPath` is module-private and needs an export or a shared helper.
- **Pipe counting.** Use the existing escape-aware pipe splitter for fused-cell detection.
- **Gating on paths.** To avoid false positives on prose, gate fused-cell and empty-first-cell errors on the extra or ignored cells containing a backticked token. An unescaped `|` in Change-column prose, or a `| | notes |` continuation row, then does not fail.
- **Bundles.** The plan and implement pre-flights should lint every task in the bundle, including siblings a spec_gap reroute skips for the amendment-heading check.

## Non-Goals

- **No grammar change** beyond skipping fenced and commented content. Directory entries, comma-joined paths, backtick-free trailing annotations and the `| File | Change |` header naming stay as they are.
- **No judgment checks.** Wording like "implementer's choice" or "may add", operator-owned paths such as `CHANGELOG.md`, and anything requiring knowledge of the diff are out.
- **No completeness checks.** Missing `templates/` mirrors, missing rebuilt `dist/` outputs and "files only read for context" stay with `spec_review` and `/canon-spec-review`.
- **No new CLI command.** There is no `canon task lint`; the gates are the surface.
- **No re-linting of archived tasks**, and no migration of existing specs. In-flight tasks are linted only when they next pass a gate point: `spec done`, plan entry or implement entry, including reroutes. A latent defect then blocks at that point, with `--force` as the escape.
- **No docs-refs-check shift-left.** BACKLOG item (b)'s docs-refs half stays open.
- **The Claude Code hook work** is a separate task (`adopter-bypass-guards`).

## Acceptance Criteria

- [ ] **AC-1: Fused cells rejected.** A manifest row with more cells than its header, where an extra cell contains a backticked token (including the `||` form), fails the lint. The error names the section and 1-based data-row number and says to put one file per row. Extra cells holding only prose do not fail. Verified by unit tests for both.
- [ ] **AC-2: Header-less blocks rejected.** A manifest table block whose first `|` line is not followed by a separator row fails the lint. The error says that row is being read as a header. This covers both a table with no separator and a table split by a blank line or note line, where the second block is header-less. Verified by unit tests for both cases.
- [ ] **AC-3: Malformed path cells rejected.** Every column-1 cell that `parseHandoffPathCell` reports malformed fails the lint, citing the row and the parser's own reason. Tested cases:
  - prose before the path;
  - `` `old.ts` → `new.ts` ``;
  - `` `dist/` (rebuilt by `npm run build`) ``;
  - `` `a.ts` (also `b.ts`) ``;
  - a `` `<path>` `` placeholder;
  - an absolute path;
  - a glob.

  A test also proves that `` `a.ts`, `b.ts` `` and `` `dist/` `` with a backtick-free annotation pass. Verified by unit tests.
- [ ] **AC-4: Ignored headings rejected.** A heading fails the lint when its text contains "Affected Files" (case-insensitive), its section contains a `|` table, and the parser would not read it. That means it is not exactly `### Affected Files` directly inside an H2 matching `/^## Design\b/` or `/^## Amendment\b/`. The error names the heading as written and the expected form. Verified by unit tests:
  - Fails: `### Affected files`, `#### Affected Files` (outside an exact section), `### Amendment Affected Files`, exact `### Affected Files` under `## Scope`, exact `### Affected Files` under `## Amendments`.
  - Passes: a spec title or prose heading containing "Affected Files" with no table, such as this spec's own H1.
- [ ] **AC-5: Duplicate exact heading rejected.** A second exact `### Affected Files` inside the same `## Design` or `## Amendment…` body fails the lint, naming the section. Tables under separate H2s, such as Design plus Amendment Round 2, pass. Verified by unit tests.
- [ ] **AC-6: Fenced and commented content excluded at the source.** For every consumer of the manifest, a `### Affected Files` heading or table inside a fenced code block or an HTML comment is neither parsed nor linted. A spec with a fenced example followed by the real table yields exactly the real table's paths from `parseAffectedFilesFromSpec`. Commented rows are not returned. Verified by unit tests.

  **Red-first regression test.** Two cases are written first and run against the pre-fix parser:
  - the fenced-displacement case: a fenced `example.ts` table, then the real `real.ts` table, both in `## Design`;
  - the commented-table case: a real `real.ts` table plus a `<!-- -->`-wrapped table with its own header and separator listing `old.ts`, under the same heading.

  Both must fail on the pre-fix parser, the first because the result is `['example.ts']` rather than `['real.ts']`, the second because `old.ts` is returned. Both must then pass after the fix. The handoff records both runs: the failing pre-fix output with the received value, and the passing post-fix result.
- [ ] **AC-7: Empty first cell rejected.** A row with an empty column 1 and a backticked token in another cell fails the lint with its row number. A fully empty row and a prose-only continuation row pass. Verified by unit tests.
- [ ] **AC-8: Valid manifests pass, consumers unchanged.** The lint returns no issues for:
  - a spec with no Affected Files table;
  - the canonical one-path-per-row table;
  - comma-joined paths;
  - directory entries;
  - tables in both `## Design` and `## Amendment Round 2`;
  - this task's own spec.

  The existing `tests/markdown-table.test.ts` and validation suites pass with only added cases, and the only parser output change is AC-6's. Verified by test run.
- [ ] **AC-9: Spec gate hard-fails.** For a non-template spec with any lint issue, `checkPhaseGate(<id>, 'spec')` returns `ok: false`. Its reason lists every issue and includes the instruction to fix the `### Affected Files` table and rerun `canon task phase <id> spec done`. It returns `ok: true` for a clean spec and reads the spec at `taskDirOverride` when given. With `CANON_SKIP_PHASE_GATE` set, `canon task phase <id> spec done` advances regardless. Verified by unit tests in `tests/run-task-validation.test.ts`.
- [ ] **AC-10: Evidence recovery parks instead of crashing.** `tryEvidenceAdvance(<id>, 'spec')` on a non-template spec with lint issues returns `{ advanced: false }` with a note listing the issues. It does not throw, and the spec phase is not marked done. Verified by a unit test that would throw on the pre-change code path once AC-9 lands.
- [ ] **AC-11: Plan and implement pre-flights block, `--force` bypasses.** When `canon run <id>` is about to start the `plan` phase or the `implement` phase and any task in the run has a lint issue in its active-checkout spec, the phase is auto-blocked before any agent session starts. The run exits non-zero. The output lists the issues per task and says to fix the table and rerun `canon run <id>`. With `--force`, the phase proceeds and a warning lists the issues. Verified by tests covering:
  - plan entry after a human-gate spec edit;
  - implement entry on a `--reroute` whose amendment table is malformed;
  - `--force` on each;
  - a clean spec proceeding unchanged.
- [ ] **AC-12: Adopter-safe messages.** No lint, gate or pre-flight message names a canon-internal path (`src/`, `markdown-table`, `validation.ts`) or a parser function name. Verified by a test asserting the formatted output for one issue of each kind contains none of those substrings.
- [ ] **AC-13: Restatements updated.** These surfaces state the manifest contract and that marking the spec done enforces it, with a pre-flight backstop before planning and implementation:
  - the spec template's Affected Files section;
  - the pipeline spec prompt's self-check;
  - the spec-revision prompt;
  - the `/canon-spec` skill self-check.

  The contract is: exact `### Affected Files` H3, one per `## Design` or `## Amendment…` H2; one file per row; extra paths comma-joined in column 1; notes in the Change column; no backticked paths in notes.

  In the template checklist, the prompt self-check and the `/canon-spec` self-check, the line "Affected Files lists specific files (not directories)" is replaced by the contract statement. Directory entries remain allowed, so the old wording must not remain on those three surfaces; verified by grep.

  The `/canon-spec-review` structural item (3) narrows to completeness and notes that format is gate-enforced. It keeps the tokens `### Affected Files`, `## Design` and "generated"/"rebuilt", which `tests/run-task-prompts.test.ts` pins.

  `docs/pipeline-orchestrator.md` describes the gate, the evidence-recovery behavior, the pre-flights and their bypasses, including the `--force` row. The `--force` help text in `canon run --help` lists the new pre-flight.

  Verified by reading each surface. `npm run sync-templates:check` passes, and the prompt golden fixture is regenerated and passes.
- [ ] **AC-14: Lessons and backlog updated.** The `docs/lessons-learned.md` entry "Put one Affected Files entry per table row; the scope parser drops a fused second entry silently" is removed, because its rule is now mechanized. The `docs/BACKLOG.md` item "Shift the `--pr` artifact-format gates left" (b) records the Affected Files half as done and the docs-refs half as open. Verified by reading both.
- [ ] **AC-15: Archive calibration.** The implementer runs the lint over every `tasks/_archive/*/spec.md` and records in `handoff.md` the count of specs flagged per issue kind, with up to three sampled hits per kind. Each sample is classified as a real silent-loss defect or a false positive, and any false positive is fixed in the lint before handoff. Verified by the handoff section's presence and Stage 1 review of the samples. Archived specs are not edited.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/markdown-table.ts` | Shared raw scan (sections, headings, blocks, raw rows) that skips fences and HTML comments; `parseAllTablesH3`/`extractSectionBodies` consume it. |
| `src/orchestrator/validation.ts` | Manifest lint and issue formatting; spec-phase gate integration; export or share the per-path validator. |
| `src/orchestrator/main.ts` | `tryEvidenceAdvance('spec')` lint pre-check; plan/implement pre-flight wiring and `--force` handling if routed here. |
| `src/orchestrator/phases/plan.ts` | Plan-entry lint pre-flight (auto-block, exit non-zero). |
| `src/orchestrator/phases/implement.ts` | Implement-entry lint pre-flight (auto-block, exit non-zero). |
| `src/orchestrator/cli.ts` | `--force` help text lists the manifest pre-flight. |
| `src/orchestrator/prompts/index.ts` | Spec prompt `selfCheck`: replace the "not directories" line with the manifest contract. |
| `src/orchestrator/prompts/templates/spec-revision.md` | State the manifest contract for revisers. |
| `tests/markdown-table.test.ts` | Shared-scan tests, fence/comment exclusion (AC-6). |
| `tests/run-task-validation.test.ts` | Lint unit tests (AC-1–AC-8, AC-12), spec-gate tests (AC-9). |
| `tests/run-task-safety.test.ts` | Evidence-recovery (AC-10) and plan/implement pre-flight tests (AC-11). |
| `tests/run-task-reroute-preflight.test.ts` | Reroute-to-implement pre-flight case (AC-11). |
| `tests/run-task-prompts.test.ts` | Keep the canon-spec-review item (3) token pins passing; add a pin for the new contract line if useful. |
| `tests/run-task-prompts.golden.json` | Regenerated for prompt wording changes. |
| `tests/recovery-hints.test.ts` | Register any new `src/` message naming `--reroute` or other registry-pattern commands. |
| `.canon/templates/spec.md` | Affected Files guidance and checklist line restate the contract. |
| `templates/.canon/templates/spec.md` | Generated mirror. |
| `.claude/skills/canon-spec/SKILL.md` | Self-check line restates the contract and the gate. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Generated mirror. |
| `.claude/skills/canon-spec-review/SKILL.md` | Structural item (3) narrows to completeness; keeps pinned tokens. |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Generated mirror. |
| `docs/pipeline-orchestrator.md` | Document the gate, evidence recovery, pre-flights, `--force` row. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror. |
| `docs/codebase-map.md` | Update the "Spec Affected Files parser" entry for the shared scan and lint. |
| `docs/lessons-learned.md` | Remove the fused-row entry (AC-14). |
| `docs/BACKLOG.md` | Record shift-left item (b)'s Affected Files half as done (AC-14). |
| `dist/cli/index.js` | Rebuilt bundle. |
| `dist/orchestrator/run-task.js` | Rebuilt bundle. |

### Interaction Dependencies

- **`checkPhaseGate('spec')`** is reached from `canon task phase … spec done` (agents and operators), `runSpecPhase`, and `tryEvidenceAdvance('spec')`. The last now pre-checks the lint and returns "not advanced" instead of letting `taskPhase` throw, because `recoverPhaseForTask` does not catch throws.
- **`taskPhase` appends a generic "Resolution:" line** after any gate reason. The lint reason must be actionable on its own; that trailing line is unchanged.
- **The plan and implement pre-flights** sit on phase-entry routing, a delicate surface. They must run before any agent session and must not consume review-loop budget. They follow the `code_review` scope pre-flight's auto-block-and-exit pattern.
- **Parser consumers** see one behavior change, the fence and comment exclusion (AC-6):
  - implement-prompt preload;
  - the `code_review` scope pre-flight;
  - the full-send post-review check;
  - the human_review commit allowlist;
  - the `--pr`/`--push` base-drift gate.
- **`canon task reset-spec-review`** keeps writing `spec: done` directly. The plan-entry pre-flight is its backstop.

### Data Model Changes

None. No `status.json` fields, no artifact schema changes.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run build` (dist is tracked and must be rebuilt)
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] E2E — not applicable (CLI, no UI)

## Docs Impact

- `docs/pipeline-orchestrator.md`, `docs/codebase-map.md` — edited (Affected Files).
- `docs/patterns.md` — the "Declare `templates/` mirrors…" pitfall restates manifest expectations; QA should confirm consistency.

## Known Risks

- **False positives block every spec and every plan start (highest risk; delicate).** An over-eager check would stop adopters at `spec done` and again at plan entry. Mitigations:
  - AC-8 pins the valid shapes.
  - AC-1 and AC-7 gate on backticked tokens, so prose isn't flagged.
  - AC-4 requires a table under the heading.
  - AC-15 calibrates against the whole archive.
  - `CANON_SKIP_PHASE_GATE` and `--force` remain as escapes.
- **Fence/comment exclusion changes consumer output.** A spec that relied on a commented-out row counting as scope would now see it as out of scope at `code_review`. That's intended, but it is the one behavior change to existing consumers, and AC-6 pins it.
- **Pre-flight on routing code.** A wrong placement could block a phase that shouldn't be linted or skip a reroute path. AC-11 tests plan entry, reroute-to-implement entry and `--force`. The plan should enumerate every route into plan and implement (normal, fast-tier combined spec+plan, reroute, spec_gap reroute, resume after block) and confirm each passes through the pre-flight.
- **Fast tier.** Fast tier writes spec and plan in one session and advances `spec`, `spec_review` and `plan` by helper commands. The `spec done` gate catches it there. The plan pre-flight never runs because plan is already done, so the implement pre-flight is the fast-tier backstop.
- **Parser drift.** If the lint re-implements section and table scanning instead of sharing it, the lint and consumers will diverge. The shared-scan note and AC-6 exist to prevent this.
- **Escaped pipes.** `\|` inside cells must not count as extra cells.

## Human Test Plan

1. Write a new task's spec with an Affected Files table where two files share one row, separated by a double bar. Mark the spec done. Expected: canon refuses, names the row, and tells you to put one file per row.
2. Fix the row and mark the spec done again. Expected: it advances.
3. Put the table under a lowercase "Affected files" heading and mark done. Expected: canon refuses and tells you the exact heading it expects. A spec whose title merely mentions Affected Files is not flagged.
4. Write a spec with no Affected Files table and mark it done. Expected: canon refuses and tells you to add the table under the Design section (changed by the Amendment).
5. Let a task reach the human spec gate, then break a row in its table and start the pipeline. Expected: canon stops before planning, lists the problem, and tells you how to fix it. Starting it again with the force option proceeds with a warning.
6. On a task that needs a reroute, add an amendment whose table has a malformed row and start the reroute. Expected: canon stops before implementation starts, with the same kind of message.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — applies to AC-6 only (the rest is a new feature): shape 6 in *Problem* states the deterministic mechanism and the executed probe that confirmed it, and AC-6 carries the red-first regression test
- [x] (Refactors) — N/A, feature

## Amendment

Post-PR review (Codex and CodeRabbit on the draft PR) found three gaps in the round-1 contract. The operator approved the scope change below.

1. **A missing manifest is an error.** This replaces the round-1 rule that "a spec with no Affected Files table stays valid": both that sentence in Decision and the AC-8 "a spec with no Affected Files table" passing case are superseded.
   - A spec whose `## Design` section has no exact `### Affected Files` table fails the lint with a `missing-manifest` issue telling the author to add one under `## Design`. A spec with no `## Design` section at all fails the same way.
   - Without a manifest, the `code_review` scope pre-flight's allowlist holds only telemetry and admitted docs, so every changed source file blocks there. A spec with no table was therefore never a working shape: 3 of 127 archived specs lack the exact heading, all pre-convention and using an `## Affected Files` H2.
   - `## Amendment…` sections stay optional: a behavioral amendment may add no files.
   - The manifest contract text (`SPEC_MANIFEST_CONTRACT` and its restatements) is now accurate as written. `docs/pipeline-orchestrator.md`'s "a spec with no scope table is valid" sentence (and its mirror) is replaced with the requirement.
2. **An unclosed fence or HTML comment is an error.** When the shared scan reaches end of file inside an open code fence or `<!--` comment, the lint reports an `unclosed-block` issue naming the construct and its opening line. Before this, everything after it was hidden silently, which could hide the whole manifest. Hiding the content stays; only the silent pass changes. This is not a grammar change: well-formed fences and comments behave exactly as in round 1.
Human Test Plan step 4 is updated in place to expect a refusal, matching item 1.

3. **The full-send foreman gets the row contract.** `code-review-foreman.md`'s instructions for appending an `## Amendment (full-send scope)` table carry the manifest row contract and one valid two-column example row (path in the first column, reason in the Change column). That way, a foreman-written row is never malformed and dropped from scope.

### Amendment ACs

- [ ] **AC-A1:** The lint returns a `missing-manifest` issue for a spec with a `## Design` section but no exact `### Affected Files` table under it, and for a spec with no `## Design` section. It returns none for a spec whose `## Design` has a valid table and whose `## Amendment` section has no table. The spec gate (AC-9) and the plan/implement pre-flights (AC-11) fail on it. Verified by unit tests, replacing the AC-8 no-table passing case.
- [ ] **AC-A2:** The lint returns an `unclosed-block` issue, naming the fence or comment and its 1-based opening line, for a spec ending inside an unclosed fence (including one opened before `## Design`) or an unclosed `<!--`. Well-formed fences and comments produce no issue. Verified by unit tests, red-first: the unclosed-fence-before-Design and unclosed-comment cases return no issues on the pre-amendment lint (current-source probes confirmed this during amendment review) and the expected `unclosed-block` issue after; record both runs in `handoff.md`.
- [ ] **AC-A3:** The foreman prompt's full-send amendment instructions include the manifest contract and a valid example row. A test asserts the rendered foreman prompt contains the contract text, and that the example row passes the lint. The prompt golden fixture is regenerated.
- [ ] **AC-A4:** `docs/pipeline-orchestrator.md` and its mirror state that a manifest is required under `## Design` and that unclosed fences or comments are rejected. A grep for "a spec with no scope table is valid" returns zero matches in `docs/`, `templates/` and `src/`. Verified by grep.
- [ ] **AC-A5:** The AC-15 archive calibration is re-run with the new checks. `handoff.md` records the per-kind counts for `missing-manifest` and `unclosed-block`, with a classification of each hit. Archived specs are not edited.

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/markdown-table.ts` | Report the open fence/comment state at end of scan. |
| `src/orchestrator/validation.ts` | `missing-manifest` and `unclosed-block` lint issues and messages. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Manifest contract and example row for full-send amendments. |
| `src/orchestrator/prompts/index.ts` | Pass the contract into the foreman prompt if rendered from a constant. |
| `tests/markdown-table.test.ts` | Open-state reporting tests. |
| `tests/run-task-validation.test.ts` | AC-A1, AC-A2 tests; replace the no-table passing case. |
| `tests/run-task-safety.test.ts` | Update pre-flight fixtures that relied on a table-less spec passing. |
| `tests/task-cli.test.ts` | Give the worktree `task phase … spec done` fixture a valid `## Design` manifest; a table-less spec is now refused. |
| `tests/run-task-prompts.test.ts` | AC-A3 foreman-prompt assertions. |
| `tests/run-task-prompts.golden.json` | Regenerated. |
| `docs/pipeline-orchestrator.md` | Replace the "no scope table is valid" sentence; document both new checks. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror. |
| `dist/cli/index.js` | Rebuilt bundle. |
| `dist/orchestrator/run-task.js` | Rebuilt bundle. |
