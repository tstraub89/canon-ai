# Implementation Plan: relocate-rules-to-prompts

> Written by: Claude | Implements: `tasks/relocate-rules-to-prompts/spec.md`

## Approach

Content relocation into existing surfaces, in order from most mechanically isolated (JIT prompt templates — no side effects beyond the golden snapshot) to least isolated (docs and tests). No new files are created; all edits go into files the spec named. The pre-commit hook auto-syncs `templates/` mirrors, so Codex only edits root files.

## Plan notes (decisions resolved here, not left to implement)

**spec-review-reroute.md**: Spec says "carry cross-review/diagnose anchors if its phase needs them (reconcile in plan)." Reroute spec-review is still Codex reviewing Claude's amendment — cross-review rule applies. Diagnose 3-role applies any time a spec addresses a flake/bug. **Decision**: add both tokens to `spec-review-reroute.md`.

**Scope Discipline rule 1**: Spec note says "plan confirms whether to add rule 1's explicit 'Affected Files is the scope cap' statement." The current `implement.md` does not name Affected Files as the scope cap. **Decision**: include rule 1 in `implement.md` alongside rules 2 & 3.

**`promptImplementResume` in `index.ts`**: Not in spec Affected Files but contains a hardcoded `AGENTS.md "Validation Matrix"` string that is a JIT surface dependency. **Decision**: update it in the same pass as `helpers.ts`; list `scripts/run-task/prompts/index.ts` in the handoff Changes table.

**Code-review rules distribution**:
- Foreman gets: baseline-diff on release branches, `git -C`, don't-infer-git-invariant, cross-cutting helper consolidation.
- Anchored lens gets: verify-handoff-via-git-diff, delicate cross-cutting guards, don't-infer-git-invariant.
- Cold lens gets: one diff-local observation about inconsistently applied guards (avoid exact `cross-cutting` phrase; no spec-aware tokens added).

**Spec-writing rules placement in JIT `spec.md` / `spec-revision.md`**: These templates are thin with `{{{instructions}}}`, `{{{selfCheck}}}` etc. The rules of thumb belong as a static section immediately before `{{{selfCheck}}}`.

---

## Steps

### Step 1 — `implement.md`: inline Validation Matrix + implementation rules

File: `scripts/run-task/prompts/templates/implement.md`

**Edit A** (line 20): Replace the "See…the matrix in AGENTS.md" clause in the validation-run sentence with the inline Validation Matrix table:

Replace:
```
Run ALL applicable validation checks before writing handoff. See "Validation Required" in each spec.md and the matrix in AGENTS.md. Required checks must be recorded as Pass or Fail; do not mark a required check N/A unless the spec explicitly removed it.
```

With:
```
Run ALL applicable validation checks before writing handoff. See "Validation Required" in each spec.md. The universal change-type → check-category matrix:

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| UI / interaction changes | End-to-end tests |
| Content / SEO / metadata | Prerender / sitemap / feed regeneration |
| Schema / migration | Migration runner + manual review |
| Cross-platform | Subset of the above on each platform |

For which command runs each category: see `docs/architecture.md` §Validation (project command bindings). Required checks must be recorded as Pass or Fail; do not mark a required check N/A unless the spec explicitly removed it.
```

**Edit B**: After the "**Spec ACs are binding. Plan approach is guidance.**" block (after the `[ambiguity]` bullet) and before the "Run ALL applicable" sentence (now edited above), insert an **Implementation Rules** section:

```markdown
## Implementation Rules

**Safe-First Rules** — always applicable regardless of stack:
1. For storage, reload, sync, or data-affecting flows: ship the safer guarded behavior first.
2. Behavior that reloads the app, replaces local state, or dismisses user work must be gated by explicit user action.
3. Prefer shared types over duplicating signatures.

**Scope Discipline** — always applicable; the spec is the contract:
1. **Affected Files is the scope cap.** If satisfying an AC genuinely requires editing files outside the spec's *Affected Files* table, stop, document the gap in `handoff.md` under *Blockers*, and surface it for human attention. Do not silently expand scope.
2. **No unauthorized new abstractions.** Do not introduce new top-level modules, services, packages, or routing layers that the spec did not authorize. Minor refactors within an authorized file are fine; new abstractions are an architecture decision and belong in the spec.
3. **No incidental dependency changes.** Do not add, remove, upgrade, or downgrade dependencies (or their pinned versions) unless the spec explicitly requests it.

**Lint & Type Safety Policy** — always applicable:
1. **Suppressing a lint or type error is a last resort**, not a convenience escape hatch. Never add a suppression without a same-line justification explaining *why the rule is wrong for this specific case*.
2. **`any` / dynamic typing**: When the shape is truly unknown at the boundary, type as `unknown` and narrow explicitly.

**Parsing Structured Input** — always applicable when implementing a parser for author-facing structured input:
Parse cell-by-cell with explicit rejection, not a permissive whole-string regex. Anchor each cell to exactly one expected shape and reject malformed cells with a specific reason at the parse boundary.

```

Presence tokens after this step: `ship the safer guarded behavior first`, `No unauthorized new abstractions`, `No incidental dependency changes`, `Suppressing a lint or type error is a last resort`, `Parse cell-by-cell with explicit rejection`, `Migration runner + manual review`.

---

### Step 2 — `implement-revisions.md`: revert / cumulative-diff / deleted-file rules

File: `scripts/run-task/prompts/templates/implement-revisions.md`

After the "Spec ACs remain binding. If the review identifies a dropped AC, restore it." line and before the "Append to `tasks/<id>/notes.md`" line, insert:

```markdown
**Iteration rules:**

- **Reverting a file**: For a byte-perfect revert to the task baseline, use `git show origin/<base-branch>:<path>` (read-only git, always allowed) and write the output to the file.
  - *Perfect revert* (file no longer in `git diff base...HEAD`): delete it from all prior iteration Changes tables in `handoff.md`.
  - *Imperfect revert* (trailing newline or other residual remains): add it to the current iteration's Changes table with "Reverted to original (describe residual diff)".
- **Referencing deleted (or not-yet-created) files in artifacts**: `docs-refs-check` flags a backtick path-ref to a file that does not exist. Referencing deleted paths in the handoff Changes-table first column must use `[path](path)` markdown-link form only — backtick form fails both checks.
- **Rerouted / revised tasks — the pre-flight diff is cumulative**: the verifier checks the union of all Changes tables against `git diff <base>...HEAD`. Before submitting, run `git diff <base>...HEAD --name-only` and confirm every listed path is covered by at least one Changes-table row across ALL iterations.

```

Presence tokens: `git show origin/`, `Referencing deleted`, `the pre-flight diff is cumulative`.

---

### Step 3 — `spec-review.md` + `spec-review-reroute.md`: cross-review + Diagnose 3-role

**`spec-review.md`** (`scripts/run-task/prompts/templates/spec-review.md`)

1. Replace the `(See AGENTS.md §"Diagnose Before You Fix".)` parenthetical in the bug/flake-fix bullet with the inline 3-role text:

Old ending of that bullet:
```
...An unverified mechanism is a blocking Shape Check concern. (See AGENTS.md §"Diagnose Before You Fix".)
```

New ending:
```
...An unverified mechanism is a blocking Shape Check concern. Each role owns a checkpoint: the spec author states the *verified* mechanism in *Problem*; the reviewer (Codex) challenges whether the proposed fix addresses a confirmed root cause; the implementer reproduces before fixing and reports the repro in the handoff.
```

2. After the verdict rules block (after `**Batch related nits.**`) and before `If you encounter surprising codebase behavior`, add:

```markdown
**Cross-review rule**: No agent reviews its own output. Claude writes specs → Codex reviews specs. Codex writes code → Claude reviews code.

```

Presence tokens: `No agent reviews its own output`, `Each role owns a checkpoint`.

**`spec-review-reroute.md`** (`scripts/run-task/prompts/templates/spec-review-reroute.md`)

After the "Grounding rule" line and before the "**Verdict rules**" block, add the same two blocks (identical tokens, same prose):

```markdown
**Cross-review rule**: No agent reviews its own output. Claude writes specs → Codex reviews specs. Codex writes code → Claude reviews code.

**Diagnose before you fix — 3-role checkpoint**: For any amendment addressing a bug or flake fix, each role owns a checkpoint: the spec author states the *verified* mechanism in *Problem*; the reviewer challenges whether the proposed fix addresses a confirmed root cause; the implementer reproduces before fixing. An unverified mechanism is a blocking Shape Check concern.

```

---

### Step 4 — `qa.md`: inline Release Rules, Handoff Validation, Output Format, Docs Freshness, Code-is-Canonical, Commit Ownership

File: `scripts/run-task/prompts/templates/qa.md`

**Edit A — Proposed Changelog (step 3 in the prompt)**:

Replace:
```
   - Read AGENTS.md §"Release Rules" for the project's changelog audience and SemVer interpretation before writing. Apply the project's defined scope.
```
With:
```
   - **Canon release rules (non-negotiable)**: (1) Agents do not bump versions or land changelog edits without explicit scope authorization. (2) The QA step proposes a draft changelog entry text only — not the version number. (3) Changelog + version bump are committed separately from code changes (when a project versions its releases). (4) No major versioning surprises: if a task introduces a breaking change the spec didn't flag, raise it before shipping.
   - Read `docs/decisions.md` §"Versioning and release policy" for this project's changelog scope and SemVer interpretation. If CHANGELOG.md exists, read the top of it to calibrate on scope and voice.
```

**Edit B — Docs freshness line**:

Replace:
```
- **Docs freshness**: scan the protected docs in AGENTS.md (architecture.md, codebase-map.md, patterns.md, product-context.md, decisions.md) for references that {{docsScope}} *contradicts*
```
With:
```
- **Docs freshness — Two-checkpoint**: scan the five protected docs (`docs/architecture.md`, `docs/codebase-map.md`, `docs/patterns.md`, `docs/product-context.md`, `docs/decisions.md`) for references that {{docsScope}} *contradicts*
```

**Edit C — New rules block after the `docs/task-quality-log.md` append bullet**:

After "- Append one row per task to docs/task-quality-log.md (see that file for column definitions)." and before the docs-freshness bullet (now Edit B above), insert:

```markdown
**Handoff Validation pre-merge checklist** (include in `done.md` Human Verification section if any item cannot be confirmed):
- [ ] Version correct (per project policy; skip if unversioned)
- [ ] Changelog updated if needed (per project policy; skip if unversioned)
- [ ] PR body current
- [ ] Final CI/CD checks green
- [ ] Final diff matches spec intent

**Output Format for Human** — `done.md` must contain:
1. One-paragraph plain-English summary
2. Files changed
3. How to test (product-level steps, not code)
4. Test results table
5. Decisions made during implementation
6. Open questions needing human input

**Code is Canonical; Docs Reference Symbols**: Code is the source of truth for anything derivable from code: numbers, thresholds, file locations, function signatures, type shapes, observable behavior. Docs that restate these facts inline rot silently — reference the symbol or path; do not restate the value.

**Commit Ownership** — three change categories:
- Code changes → task branch, committed by the orchestrator after Codex static validation.
- Pre-implement scaffold → base branch, committed by the orchestrator before first implement.
- Changelog + version bump (if versioned) → separate commit, human + Claude, after human_review.

```

Presence tokens: `Agents do not bump versions` (via "Agents do not bump versions or land changelog edits"), `Handoff Validation`, `One-paragraph plain-English summary`, `Two-checkpoint`, `Code is Canonical`, `Commit Ownership`.

---

### Step 5 — `spec.md` + `spec-revision.md` JIT templates: spec-writing rules of thumb

**`scripts/run-task/prompts/templates/spec.md`**

Immediately before the `{{{selfCheck}}}` block, add:

```
**Spec-writing rules of thumb** — apply when writing each spec:

- **Name effects to DELETE** — frame supersession as replacement, not add-plus-remove. State: "replace `oldFn` with `newFn`; `oldFn` must not exist after" — not separate "Add" and "Remove" bullets.
- **Prefer positive or structural assertions** over prose negations for load-bearing constraints. Back a "must not" with a grep AC or positive reframe; bare prose negation is fragile.
- **Symbols named in ACs must exist** — grep for every function or symbol an AC names; verify its return shape matches the spec's assumed data contract before marking spec done.
- **Behavioral contracts, not mechanics** — ACs describe observable behavior; defer implementation mechanics (signatures, constant names, precise algorithms) to plan/implement.
- **At ≥3 spec_review iterations, read the round-over-round shape** — label each round *edge-fine-tune* (missed path, single validator) or *scope-expansion* (new sub-problem each round). If scope-expansion, redesign the AC rather than iterate further.
- **Refactor specs need structural caps** — provide hard size caps, explicit deletion expectations per symbol, and an allow-list grep AC for any symbol that must disappear.
- **UI spatial / gesture tasks** — flag "visual positioning — expect human iteration" or "runtime debugging required" in *Known Risks*.

```

**`scripts/run-task/prompts/templates/spec-revision.md`**

After `Address every \`changes_requested\` finding in each spec.md.` and before `When done, run:`, add the same rules block (identical prose and tokens).

Presence tokens in both: `Name effects to DELETE`, `Prefer positive or structural assertions`.

---

### Step 6 — `helpers.ts` + `index.ts`: startup constants + rewire resume prompt

**`scripts/run-task/prompts/helpers.ts`**

1. Append to `CLAUDE_STARTUP` (add a line before the closing `'`):
```
'\nTone is project taste; honest signal is canon discipline — surface real disagreement rather than yielding to politeness.'
```

2. Append to `CODEX_STARTUP` (add after the `[pipeline]` label paragraph, before the closing `'`):
```
'\n' +
'Communication: tone is project taste; honest signal is canon discipline — surface real disagreement rather than yielding to politeness.\n' +
'\n' +
'Branch sync (non-pipeline sessions): `git fetch origin && git pull --rebase origin <branch>` before starting work. If `origin/<base>` is ahead, sync and rerun local validation before PR handoff. If `<base>` moves during review, resync and rerun validation. In pipeline sessions the orchestrator manages branch state — read the worktree state as-is; do not run pull/push.'
```

**`scripts/run-task/prompts/index.ts`** (the `promptImplementResume` function)

Replace:
```
'1. Run the project\'s validation commands (see AGENTS.md "Validation Matrix" and each spec\'s "Validation Required" section) and record results.',
```
With:
```
'1. Run the project\'s validation commands (see the Validation Matrix in `implement.md` and each spec\'s "Validation Required" section) and record results.',
```

Presence tokens: `honest signal is canon` in both `CLAUDE_STARTUP` and `CODEX_STARTUP`, `pull --rebase` in `CODEX_STARTUP`.

---

### Step 7 — `code-review-foreman.md`: foreman-scoped code-review rules

File: `scripts/run-task/prompts/templates/code-review-foreman.md`

After the `{{{startup}}}` render block and before the `Your job is to spawn two review lenses` sentence (i.e., at the very top of the substantive prose), add:

```markdown
## Code-Review Rules of Thumb (Foreman)

- **Reviewer diffs against the task baseline, not `main`, on release branches**: on a shared release branch ahead of `main`, always diff against the task's baseline — diffing against `main` attributes unrelated work to the task.
- **Use `git -C <absolute-path>` for every worktree git op, not `cd` + git**: when operating across REPO_ROOT and a task worktree, `git -C /absolute/path` avoids silent cwd reversion between tool calls.
- **Don't infer one git invariant from another**: `git status --porcelain` empty ≠ origin matches HEAD; "origin/<branch> exists" ≠ origin matches HEAD; "PR exists" ≠ "PR is in the expected state." Do the actual check directly.
- **A cross-cutting invariant belongs in one shared helper, not patched per call site**: when the same rule must hold at multiple enforcement points, implement it once. The tell: findings come back round after round as the *same bug class at a new location*. At ≥3 sites, extract the shared helper and route all sites through it.

```

Presence tokens: `task baseline`, `git -C`, `cross-cutting`.

---

### Step 8 — `.claude/agents/code-review-anchored.md`: anchored-lens rules

File: `.claude/agents/code-review-anchored.md`

After the `## Stage 2 - Code Quality` section (after the `Report every issue...` paragraph and before the `## Return Format` heading), add:

```markdown
## Code-Review Rules of Thumb (Anchored Lens)

- **Verify handoff claims by running `git diff HEAD -- <file>`**: the auto-commit step can silently drop edits not in the handoff Changes table — don't trust the handoff claim; diff the working tree to confirm fixes landed.
- **Delicate-task review must audit cross-cutting guards at every mutation entry point**: when a `delicate: true` task refactors a state/data layer, explicitly verify that auth, gating, and payment guards still hold at every mutation chokepoint — not just at the call sites the spec called out.
- **Don't infer one git invariant from another**: `git status --porcelain` empty ≠ origin matches HEAD; "origin/<branch> exists" ≠ origin matches HEAD. Do the actual check directly, not a proxy.

```

---

### Step 9 — `.claude/agents/code-review-cold.md`: cold-lens diff-relevant note

File: `.claude/agents/code-review-cold.md`

After the `Review adversarially for bugs the diff introduces:` sentence and before `Report every issue you find`, insert one diff-local note (no spec tokens):

```markdown
**Diff-local pattern**: when you see the same safety check, guard, or invariant applied at multiple call sites but a new call site introduced by this diff is missing it, flag it — an inconsistently applied guard is a correctness gap regardless of intent.

```

This does NOT add `Name effects to DELETE`, `Prefer positive or structural assertions`, `task baseline`, or `git -C`.

---

### Step 10 — `canon-spec/SKILL.md`: inline spec-writing rules + rewire refs

File: `.claude/skills/canon-spec/SKILL.md`

**Edit A — Phase 1 context-load list**: Replace the `CLAUDE.md` bullet:
```
- `CLAUDE.md` — your role and spec authorship guidelines
```
With:
```
- `CLAUDE.md` — your role and operator-facing context (spec-writing rules of thumb are in this skill's Phase 5 self-check below)
```

**Edit B — Phase 5 self-check block**: After the existing `- [ ] Non-Goals rules out...` bullet and before the `**⛔ STOP — present the spec and wait for approval.**` line, add:

```markdown
**Spec-writing rules of thumb** (apply when writing ACs and structure):
- **Name effects to DELETE**: frame supersession as replacement ("replace `oldFn` with `newFn`; `oldFn` must not exist after"), not separate add/remove bullets.
- **Prefer positive or structural assertions** over prose negations for load-bearing constraints. Back a "must not" with a grep AC or positive reframe.
- **Symbols in ACs must exist** — grep for every named function or symbol; verify return shape matches the spec's assumed data contract.
- **Behavioral contracts, not mechanics** — ACs describe observable behavior; defer implementation mechanics to plan/implement.
- **At ≥3 spec_review iterations, label each round**: *edge-fine-tune* (missed path, single validator) or *scope-expansion* (new sub-problem). If scope-expansion, redesign rather than iterate.
- **Refactor specs need hard structural caps**: size cap, explicit deletion expectations per symbol, grep AC for disappeared symbols.

```

**Edit C — Related section**: 
- Replace `- \`AGENTS.md\` — workflow rules, validation matrix; \`docs/pipeline-orchestrator.md\` — sizing guide.`
  with: `- \`docs/pipeline-orchestrator.md\` — pipeline internals, sizing guide, model/effort matrix. The Validation Matrix is now inline in \`implement.md\` and in \`.canon/templates/spec.md\`.`
- Replace `- \`CLAUDE.md\` — spec authorship guidelines.`
  with: `- \`CLAUDE.md\` — operator context; spec-writing rules of thumb are in this skill above.`

---

### Step 11 — `canon-spec-review/SKILL.md`: inline Agent C rules + rewire refs

File: `.claude/skills/canon-spec-review/SKILL.md`

**Edit A — Agent C scope line**: Replace:
```
Subagent type: `general-purpose`. Scope: "Audit against canon's spec-writing rules of thumb from CLAUDE.md."
```
With:
```
Subagent type: `general-purpose`. Scope: "Audit against canon's spec-writing rules of thumb."
```

**Edit B — Agent C Goal block**: Replace the existing Goal text with:
```
Goal: check these spec-quality rules:
(1) **Name effects to DELETE** — when a change supersedes prior code, is it framed as a single replacement, not separate add/remove bullets?
(2) **Prefer positive or structural assertions** — are load-bearing "must not" constraints backed by a grep AC or positive reframe, not just prose negation?
(3) **Affected Files** — files that will *change* are listed; files only read for context are not.
(4) **Validation Required** — section present AND has at least one `- [x]` checked entry (or an explicit checked "None — <reason>"). A section with zero `[x]` entries is a failing check.
(5) **Non-goals** — rule out the most tempting scope expansions.
(6) **Human Test Plan** — product language only; no code, no file paths.
(7) **Known Risks** — names actual failure modes for the trickiest ACs.
(8) **Symbols in ACs exist** — for any named function or symbol, has the author grepped for it and verified the return shape matches the spec's assumed data contract?
```

**Edit C — Related section**: Replace:
```
- `CLAUDE.md` §"Spec Authorship Guidelines" — the rules of thumb Agent C audits against.
```
With:
```
- `CLAUDE.md` — operator context; Agent C's rules of thumb are listed in this skill above.
```

---

### Step 12 — `canon-pipeline/SKILL.md`: rewire Related refs

File: `.claude/skills/canon-pipeline/SKILL.md`

In the **Related** section:
- Replace `- \`AGENTS.md\` — workflow rules, roles, escalation, validation matrix, git/release.`
  with: `- \`docs/pipeline-orchestrator.md\` — orchestrator internals, model matrix, reroute, ship mechanics (the primary reference for this skill).`
- Replace `- \`CLAUDE.md\` — Claude phase-specific guidance.`
  with: `- \`CLAUDE.md\` — operator context (phases, spec authorship, code-review rules of thumb).`

---

### Step 13 — `canon-changelog/SKILL.md`: rewire AGENTS.md §Release Rules refs

File: `.claude/skills/canon-changelog/SKILL.md`

Four replacements:

1. In the "When sources are absent" / "No `docs/decisions.md §...`" fallback: replace `\`AGENTS.md §"Release Rules"\` for propose-only behavior discipline` with `` `docs/decisions.md §"Versioning and release policy"` for propose-only behavior discipline (canon general rules: agents don't auto-bump; QA proposes entry only; version bump is a separate commit; no major surprises) ``.

2. In Phase 3 "Synthesize" opening: replace `Read \`AGENTS.md §"Release Rules"\` if present and the top of \`CHANGELOG.md\` before writing.` with `Read \`docs/decisions.md\` §"Versioning and release policy" if present (project changelog scope, SemVer tier, and audience) and the top of \`CHANGELOG.md\` before writing.`

3. In Phase 3 "Find non-entries" bullet: replace `(from \`AGENTS.md §"Release Rules"\` if present, otherwise infer...` with `(from \`docs/decisions.md §"Versioning and release policy"\` if present, otherwise infer...`

4. In Related section: replace `- \`AGENTS.md\` §"Release Rules" — optional policy layer this skill consults when present.` with `- \`docs/decisions.md §"Versioning and release policy"\` — project changelog scope and SemVer interpretation. Canon's general release rules (propose-only, separate bump commit, no major surprises) are inlined in \`qa.md\`.`

---

### Step 14 — `canon-init/SKILL.md`: rewire Related section

File: `.claude/skills/canon-init/SKILL.md`

The Phase 0 AGENTS.md reference ("If `AGENTS.md` exists, read it.") and Phase 6 git-add command are legitimate file-manipulation references (canon-init reads/stages AGENTS.md as files); keep them as-is. Only the Related section has a rule-dependency pointer:

Replace:
```
- `AGENTS.md` — workflow rules; the `## Release Rules` section governs how `/canon-changelog` calibrates.
```
With:
```
- `AGENTS.md` — workflow rules (read at Phase 0). Release Rules now inline in `qa.md`; `/canon-changelog` reads `docs/decisions.md §"Versioning and release policy"` for project scope.
```

---

### Step 15 — `.canon/templates/spec.md`: AC-12b + AC-13 (Validation Required + Docs Impact)

File: `.canon/templates/spec.md`

**Edit A — "Validation Required" section**: Replace:
```markdown
## Validation Required

Which checks apply (from `AGENTS.md` validation matrix). Edit the list below to match the checks defined for this project.

- [ ] `<lint>`
- [ ] `<type-check>`
- [ ] `<unit tests>` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [ ] `<build>`
- [ ] `<E2E>`
```
With:
```markdown
## Validation Required

Universal change-type → check-category matrix (project command bindings are in `docs/architecture.md` §Validation):

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| UI / interaction changes | End-to-end tests |
| Content / SEO / metadata | Prerender / sitemap / feed regeneration |
| Schema / migration | Migration runner + manual review |
| Cross-platform | Subset of the above on each platform |

Mark applicable checks with `- [x]` (replace `<...>` with the project's actual commands from `docs/architecture.md` §Validation):

- [ ] `<lint>`
- [ ] `<type-check>`
- [ ] `<unit tests>` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [ ] `<build>`
- [ ] `<E2E>`
```

**Edit B — "Docs Impact" section**: Replace:
```markdown
## Docs Impact

Which protected docs (see `AGENTS.md` "Docs Freshness") might need updating if this task ships? "None" if this is a bug fix or internal-only change.
```
With:
```markdown
## Docs Impact

Five protected docs (`docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/product-context.md`). Name any that might go stale if this task ships — this is a heads-up, not a change; the actual update happens at QA. "None" if this is a bug fix or internal-only change.
```

Presence tokens: `Migration runner + manual review`, `heads-up, not a change`.

---

### Step 16 — `.canon/templates/done.md`: repoint changelog scope

File: `.canon/templates/done.md`

In the **Proposed Changelog** section, replace:
```
Apply the project's changelog scope (AGENTS.md §"Release Rules") and the "would a user notice" test.
```
With:
```
Apply the project's changelog scope (`docs/decisions.md` §"Versioning and release policy") and the "would a user notice" test.
```

---

### Step 17 — `.canon/templates/status.json`: repoint `_full_send`

File: `.canon/templates/status.json`

Replace:
```json
"_full_send": "true → skip spec gate + auto-open draft PR after clean QA. See AGENTS.md Full-send mode."
```
With:
```json
"_full_send": "true → skip spec gate + auto-open draft PR after clean QA. See docs/pipeline-orchestrator.md §Full-send mode."
```

---

### Step 18 — `docs/architecture.md`: make §Validation self-contained

File: `docs/architecture.md`

In the **Validation** section:

**Edit A — preamble**: Replace:
```
`AGENTS.md` §"Validation Matrix" defines the canon-supplied **categories** of check that apply to different change types. The bindings below say what each category means concretely for canon-ai.
```
With:
```
The bindings below say what each category means concretely for canon-ai. The universal change-type → check-category matrix (which *categories* apply to which change types) is inlined in `implement.md` and in `.canon/templates/spec.md` "Validation Required".
```

**Edit B — table header**: Replace:
```
| Category (from AGENTS.md) | canon-ai binding |
```
With:
```
| Category | canon-ai binding |
```

---

### Step 19 — `docs/decisions.md`: add JIT rule delivery decision

File: `docs/decisions.md`

Read the file to match the existing entry format, then append:

```markdown
## JIT rule delivery: canon rules injected per phase, not ambient auto-loaded

**Decided**: 2026-06-17

Canon's operating rules are delivered just-in-time per consuming phase via the injected prompt templates (`implement.md`, `qa.md`, `spec-review.md`, etc.), agent charters (`.claude/agents/`), and skills (`.claude/skills/`) — not via ambient auto-load of `AGENTS.md` / `CLAUDE.md` in every pipeline session.

**Why**: previously, every phase auto-loaded all rules through AGENTS.md/CLAUDE.md. This meant code-review lenses carried spec-writing guidance they never use, and the implement prompt carried QA rules. Scoping each rule to the specific phase that consumes it shrinks each phase's prompt to its own job and reduces cross-rule attention dilution.

**Consequence**: after this task, `AGENTS.md` / `CLAUDE.md` canon-block content is fully redundant with the JIT surfaces — the canon blocks remain present (not yet vacated) but are no longer the sole home for any pipeline-facing rule. The vacate task (tracked in `docs/BACKLOG.md`) removes the now-redundant copies.
```

---

### Step 20 — `docs/codebase-map.md`: update content-role notes

File: `docs/codebase-map.md`

Read the file. Locate the notes for `scripts/run-task/prompts/helpers.ts` and `scripts/run-task/prompts/templates/qa.md` (or whatever section covers prompt templates). Update:
- `helpers.ts` entry: note that `CODEX_STARTUP` and `CLAUDE_STARTUP` now carry communication-norms ("honest signal is canon") and git workflow alongside startup doc-read instructions.
- `qa.md` template entry: note that it now carries Docs Freshness two-checkpoint, Handoff Validation checklist, Release Rules, Code-is-Canonical, and Commit Ownership rules inline (no longer pointing at AGENTS.md §Release Rules for any of these).

---

### Step 21 — `tests/run-task-prompts.test.ts`: add AC-11 structural test

File: `tests/run-task-prompts.test.ts`

Add a new `void test(...)` block before the final `interactive runClaude omits --max-budget-usd` test. The test reads files from disk and asserts presence/absence tokens:

```typescript
void test('AC-11 — structural relocation: presence tokens appear in destinations, absence tokens do not bleed', () => {
    function readRepoFile(relPath: string): string {
        return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    }

    // Presence tokens (AC-1)

    const impl = readRepoFile('scripts/run-task/prompts/templates/implement.md');
    assert.match(impl, /ship the safer guarded behavior first/);
    assert.match(impl, /No unauthorized new abstractions/);
    assert.match(impl, /No incidental dependency changes/);
    assert.match(impl, /Suppressing a lint or type error is a last resort/);
    assert.match(impl, /Parse cell-by-cell with explicit rejection/);
    assert.match(impl, /Migration runner \+ manual review/);

    const implRev = readRepoFile('scripts/run-task/prompts/templates/implement-revisions.md');
    assert.match(implRev, /git show origin\//);
    assert.match(implRev, /the pre-flight diff is cumulative/);
    assert.match(implRev, /Referencing deleted/);

    const specRevTpl = readRepoFile('scripts/run-task/prompts/templates/spec-review.md');
    assert.match(specRevTpl, /No agent reviews its own output/);
    assert.match(specRevTpl, /Each role owns a checkpoint/);

    const qa = readRepoFile('scripts/run-task/prompts/templates/qa.md');
    assert.match(qa, /Agents do not bump versions/);
    assert.match(qa, /Handoff Validation/);
    assert.match(qa, /One-paragraph plain-English summary/);
    assert.match(qa, /Two-checkpoint/);
    assert.match(qa, /Code is Canonical/);
    assert.match(qa, /Commit Ownership/);

    const specJit = readRepoFile('scripts/run-task/prompts/templates/spec.md');
    assert.match(specJit, /Name effects to DELETE/);
    assert.match(specJit, /Prefer positive or structural assertions/);

    const specRevJit = readRepoFile('scripts/run-task/prompts/templates/spec-revision.md');
    assert.match(specRevJit, /Name effects to DELETE/);
    assert.match(specRevJit, /Prefer positive or structural assertions/);

    const canonSpec = readRepoFile('.claude/skills/canon-spec/SKILL.md');
    assert.match(canonSpec, /Name effects to DELETE/);
    assert.match(canonSpec, /Prefer positive or structural assertions/);

    const canonSpecReview = readRepoFile('.claude/skills/canon-spec-review/SKILL.md');
    assert.match(canonSpecReview, /Name effects to DELETE/);
    assert.match(canonSpecReview, /Prefer positive or structural assertions/);

    const helpers = readRepoFile('scripts/run-task/prompts/helpers.ts');
    assert.match(helpers, /honest signal is canon/);
    assert.match(helpers, /pull --rebase/);

    const scaffoldSpec = readRepoFile('.canon/templates/spec.md');
    assert.match(scaffoldSpec, /Migration runner \+ manual review/);
    assert.match(scaffoldSpec, /heads-up, not a change/);

    // Absence tokens (AC-8): spec surfaces must NOT contain code-review-craft signatures
    assert.doesNotMatch(specJit, /task baseline/);
    assert.doesNotMatch(specJit, /git -C/);
    assert.doesNotMatch(specRevJit, /task baseline/);
    assert.doesNotMatch(specRevJit, /git -C/);
    assert.doesNotMatch(specRevTpl, /task baseline/);
    assert.doesNotMatch(specRevTpl, /git -C/);

    // code-review surfaces must NOT contain spec-writing-craft signatures
    const foreman = readRepoFile('scripts/run-task/prompts/templates/code-review-foreman.md');
    assert.doesNotMatch(foreman, /Name effects to DELETE/);
    assert.doesNotMatch(foreman, /Prefer positive or structural assertions/);

    const anchored = readRepoFile('.claude/agents/code-review-anchored.md');
    assert.doesNotMatch(anchored, /Name effects to DELETE/);
    assert.doesNotMatch(anchored, /Prefer positive or structural assertions/);

    const cold = readRepoFile('.claude/agents/code-review-cold.md');
    assert.doesNotMatch(cold, /Name effects to DELETE/);
    assert.doesNotMatch(cold, /Prefer positive or structural assertions/);

    // AC-13 scaffold sweep: .canon/templates/ must have zero AGENTS.md / CLAUDE.md refs
    const scaffoldDir = path.join(REPO_ROOT, '.canon/templates');
    const walk = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.flatMap(e =>
            e.isDirectory()
                ? walk(path.join(dir, e.name))
                : [path.join(dir, e.name)],
        );
    };
    for (const filePath of walk(scaffoldDir)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const rel = path.relative(REPO_ROOT, filePath);
        assert.doesNotMatch(
            content,
            /AGENTS\.md|CLAUDE\.md/,
            `Scaffold ${rel} still references AGENTS.md or CLAUDE.md`,
        );
    }
});
```

---

### Step 22 — Regenerate golden fixture, run full validation suite, build

Run in order:

1. `UPDATE_GOLDENS=1 npm test` — regenerate `tests/run-task-prompts.golden.json` after all prompt-template edits.
2. `npm test` — verify all tests pass including new AC-11 test.
3. `npm run lint`
4. `npm run type-check`
5. `npm run sync-templates:check` — verifies `templates/` mirrors are synced (pre-commit hook will auto-sync on commit; this is a pre-commit sanity check).
6. `npm run docs-refs-check` — verifies no broken refs in edited skills/docs.
7. `npm run build` — regenerate `dist/scripts/run-task.js`; commit the updated `dist/` alongside source.

**Template mirrors**: The pre-commit hook auto-syncs `templates/` from root canon-managed files. Both root and mirror must appear in the handoff Changes table. Mirrors to declare: `templates/.claude/agents/code-review-anchored.md`, `templates/.claude/agents/code-review-cold.md`, `templates/.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-changelog/SKILL.md`, `templates/.claude/skills/canon-init/SKILL.md`, `templates/.canon/templates/spec.md`, `templates/.canon/templates/done.md`, `templates/.canon/templates/status.json`.

---

### Step 23 — Verify AC-6: AGENTS.md / CLAUDE.md unchanged

```bash
git diff <base>...HEAD -- AGENTS.md CLAUDE.md templates/AGENTS.md templates/CLAUDE.md
```

Expected: empty. If any diff appears, something went wrong in an earlier step.

---

## Ordering

Steps 1–20 are independent of each other (disjoint files). Steps 21–23 must follow steps 1–20:
- Step 21 (test code) can be done alongside 1–20.
- Step 22 (`UPDATE_GOLDENS=1 npm test`) must run after all template edits; `npm test` must run after golden regeneration.
- Step 23 (AC-6 verification) must run after all edits are staged.

## Testing Plan

- **AC-11 structural test** added in Step 21 — presence/absence tokens + scaffold sweep.
- **Golden fixture** regenerated in Step 22 — validates all prompt-builder output matches expected.
- **Full suite** (`npm test`) — regression coverage for all existing behavior.
- **Manual (Human Test Plan)**: run a normal canon task through implement and code_review after the change; verify Codex still honors scope discipline and the Validation Matrix (confirming rules reach Codex via the prompt, not auto-load).

## Rollback Plan

All changes are additive content insertions or text replacements in markdown/TypeScript files — no schema changes, no new files, no orchestrator logic changes. Revert is `git revert <sha>` or reset to base. No data migration concerns; no persistent state changes.

---

## Reroute Plan

### Delta

The base spec (Steps 1–23 above) is fully implemented and shipped. This section covers only the three-finding amendment (AC-A1, AC-A2, AC-A3). Steps 1–23 still apply and are not repeated.

---

#### Step R1 — `scripts/run-task/prompts/templates/spec.md`: add escalation triggers (AC-A1)

File: `scripts/run-task/prompts/templates/spec.md`

In the **Spec-writing rules of thumb** block added by Step 5, append an escalation-trigger bullet immediately before the `{{{selfCheck}}}` block (after the existing rules-of-thumb bullets):

```markdown
- **Sensitive-surface escalation** — flag these categories as `delicate: true` in `status.json` and call them out in *Known Risks*: auth, billing / payments, privacy / data handling, destructive operations, schema / data-model migrations, analytics-event changes. The human spec gate is where such tasks stop for review.
```

Presence tokens required: `auth`, `billing`, `privacy`, `destructive`, `schema`, `analytics` — all six must appear verbatim.

---

#### Step R2 — `scripts/run-task/prompts/templates/spec-revision.md`: add escalation triggers (AC-A1)

File: `scripts/run-task/prompts/templates/spec-revision.md`

In the **Spec-writing rules of thumb** block added by Step 5, append the identical escalation-trigger bullet from Step R1. Same six tokens required.

---

#### Step R3 — `scripts/run-task/prompts/templates/qa.md`: remove version-bump ask (AC-A2)

File: `scripts/run-task/prompts/templates/qa.md`

The base implementation added (Step 4 Edit A) a Release Rules block containing: `"(2) The QA step proposes a draft changelog entry text only — not the version number."` This non-negotiable rule is correct.

The contradiction is a **separate line** (~line 20 in the original file, now shifted) that asks the QA agent for a "Proposed version bump per the project's SemVer interpretation." Locate and remove that line. The changelog **entry-text** proposal must remain — only the version-bump ask is removed.

After the edit, `qa.md` must not contain any instruction to propose, suggest, or choose a version number or bump tier.

---

#### Step R4 — `.canon/templates/done.md`: remove Proposed version field (AC-A2)

File: `.canon/templates/done.md`

The scaffold's changelog/QA section contains a `**Proposed version**` (or `Proposed version bump`) field. Remove that field while keeping the changelog entry-text proposal. The done.md scaffold must not ask the author to fill in a version number.

---

#### Step R5 — `docs/decisions.md`: reconcile Minor bump ownership (AC-A2)

File: `docs/decisions.md`

In §"Versioning and release policy", find the **Agent authorization** tiers. The current Minor entry reads approximately: "**Minor**: agents propose the bump in `done.md` (draft changelog entry)." This contradicts the new rule that QA proposes entry text only.

Change the Minor tier so the bump-tier decision is owned by the release/changelog step (e.g., the `canon-changelog` skill + human), not by QA / `done.md`. Retain the Patch and Major tier language unless it also assigns bump proposals to QA. After the edit, no authorization tier in this section should direct QA or `done.md` to propose a version or bump tier.

---

#### Step R6 — `.claude/skills/canon-changelog/SKILL.md`: fix description capitalization (AC-A3)

File: `.claude/skills/canon-changelog/SKILL.md`

In the YAML frontmatter `description:` line, the reference currently reads `§"Versioning and Release Policy"` (title-case "Release"). Change to `§"Versioning and release policy"` (lowercase "release"), matching the actual `docs/decisions.md` heading and the skill body.

Verify: `grep` the description line for `Versioning and release policy` (lowercase).

---

#### Step R7 — `tests/run-task-prompts.test.ts`: extend AC-11 for escalation triggers (AC-A1)

File: `tests/run-task-prompts.test.ts`

In the AC-11 structural test block added by Step 21, after the existing `specJit` and `specRevJit` presence-token assertions, add assertions for all six escalation-trigger tokens in both templates:

```typescript
// AC-A1: escalation triggers present in both spec JIT templates
for (const token of ['auth', 'billing', 'privacy', 'destructive', 'schema', 'analytics']) {
    assert.match(specJit, new RegExp(token), `spec.md missing escalation trigger: ${token}`);
    assert.match(specRevJit, new RegExp(token), `spec-revision.md missing escalation trigger: ${token}`);
}
```

---

#### Step R8 — Template mirrors (AC-7)

The pre-commit hook auto-syncs all `templates/` mirrors from root canon-managed files. The following mirrors will be regenerated automatically on commit; both root and mirror must appear in the handoff Changes table:

- `templates/.canon/templates/done.md` (mirror of Step R4)
- `templates/.claude/skills/canon-changelog/SKILL.md` (mirror of Step R6)

`scripts/run-task/prompts/templates/` files have no `templates/` mirrors (they are not `CANON_OWNED` agent/skill charters) — no action needed for Steps R1–R3.

---

#### Step R9 — Regenerate golden fixture, validate, build

Same sequence as Step 22:

1. `UPDATE_GOLDENS=1 npm test` — regenerate golden fixture after Steps R1–R2 template edits.
2. `npm test` — verify all tests pass including the extended AC-11 assertions.
3. `npm run lint`
4. `npm run type-check`
5. `npm run sync-templates:check`
6. `npm run docs-refs-check`
7. `npm run build` — regenerate `dist/scripts/run-task.js`; commit updated `dist/` alongside source.

---

#### Step R10 — Verify AC-6 still holds

```bash
git diff <base>...HEAD -- AGENTS.md CLAUDE.md templates/AGENTS.md templates/CLAUDE.md
```

Expected: empty. None of the amendment files touch these paths.
