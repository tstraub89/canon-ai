# Implementation Plan: canon-prune-skill

> Written by: Claude | Implements: `tasks/canon-prune-skill/spec.md`

## Approach

The change is mostly prose. It adds one new canon-managed skill (`.claude/skills/canon-prune/SKILL.md`), puts one clause in canon-sweep, adds a prune pass to the local `docs-audit` skill, and wires the new skill into every place the shipped skills are listed (`CANON_OWNED`, `checkSkills`, `RECOMMENDED_ALLOW`, README, canon-init, canon-ai's `.claude/settings.json`, tests, CHANGELOG). The only code edits are two array literals in `src/`, followed by a rebuild of `dist/cli/index.js`. Steps 1–3 hold the prose that carries the behavior; Steps 4–8 are mechanical wiring.

The spec-review nit (AC-10: a stable locator and comparison rule for "Reviewed and kept" rows) is already answered by the spec's own step 6, "Matching across runs". This plan pins down the remaining mechanics in Step 1 §"Step 6": the exact commit-body format, the row key, and the lookup command.

**Feasibility check**

- **Exists:** confirmed by grep. `CANON_OWNED` is in `src/lib/canon-owned.ts`, with canon-sweep at line 12. In `src/cli/commands/doctor.ts`, `RECOMMENDED_ALLOW` holds canon-sweep at lines 88–89 and `checkSkills` holds `skillNames` at line 401. In `tests/cli.test.ts` the `checkSkills` tests are at lines 1389–1434 (titled "all eight skills present") and the README-vs-`RECOMMENDED_ALLOW` test is at line 3919. canon-sweep has the headings `## Preconditions`, `### Stage B — Is the evidence sufficient? → Evaluate promotion` and `## Step 2 — Choose the smallest carrier`. The `templates/docs/patterns.md` scaffold has `## Known Pitfalls` and the `Read this doc` / `Before touching` guidance at line 79. README has `### Discovery nudge (recommended)` at line 194, the skill table at line 177, the allowlist JSON at lines 220–263 and the "skills installed by `canon init`" sentence at line 492. canon-init has its agent-file check (Phase 0, line 20), its allowlist (line 140) and its Related entry for `AGENTS.md` / `CLAUDE.md` (line 205). `docs-audit` exists and is tracked, and so is `.claude/settings.json`. The sync script creates the mirror directories for new entries (`mkdirSync(..., { recursive: true })`).
- **Real path:** `canon init` / `canon upgrade` copy every `CANON_OWNED` path from `templates/`, so adding the path plus `npm run sync-templates` is enough to ship the skill. `canon doctor` reaches `checkSkills(cwd)` (doctor.ts:884) and `checkRecommendedPermissions`, which diffs against `RECOMMENDED_ALLOW` (line 650). `docs-refs-check` scans every `CANON_OWNED` markdown file, including hidden `.claude/**` ones (`collectMarkdownFiles`, `shippedSources`). It validates a section ref only in the forms `` `path.md` §"Heading" `` or `` `path.md §"Heading"` ``, so a bare `canon-sweep §"Preconditions"` would go unchecked. No existing skill-to-skill section ref was found, so Step 1 writes the refs in the path form and Step 9 proves they resolve.
- **Callers:** `checkSkills` returns the same `Check` shape, and its only caller is `runDoctor`. `RECOMMENDED_ALLOW` is read by `checkRecommendedPermissions` and by tests: `cli.test.ts` lines 1681–1738 spread the whole array, so they adapt automatically, and the README drift test at line 3919 compares it to the README. No error contract changes.
- **Tests that can fail:** (a) in the "all operational skills missing" test (line 1404), a new `assert.match(..., /canon-prune/)` fails without the `doctor.ts` change. (b) A new "canon-prune specifically checked" test, with every other skill present and canon-prune absent, expects `warn`. Without the change it returns `pass`. (c) The README-vs-`RECOMMENDED_ALLOW` test fails if only one side of the two allowlists is updated. The "all nine skills present" test passes even without the `doctor.ts` change, because it only adds a file. It is updated for the count and coverage, not as a regression test.
- **Predicates:** the code adds none. In the skill, the preconditions that read files are each gated on the file existing: the `Read this doc` table "if the project keeps one", `AGENTS.md` / `CLAUDE.md` "if it keeps them", the shipped checker script "if present". The prior-prune lookup handles three states: no prior prune commit (nothing to skip), a commit with an empty "Reviewed and kept" list, and a matched entry.
- **Scope:** every file below appears in the spec's Affected Files: the two canon-prune paths, the two canon-sweep paths, docs-audit, canon-owned.ts, doctor.ts, `dist/cli/index.js`, `tests/cli.test.ts`, README, the two canon-init paths, `.claude/settings.json`, the two lessons-learned files and CHANGELOG. A grep of `.canon/README.md` and `.canon/templates/` found no further skill listing site. `docs/BACKLOG.md` mentions canon-sweep only as a record, not as a listing, so it is not edited.
- **Async/stateful:** N/A.

**Notes for the implementer**

- `docs/lessons-learned.md` is in `PIPELINE_TELEMETRY_FILES` (`src/orchestrator/worktree.ts`). Auto-commit accepts it (`autoCommitAllowedSourceBypass`) and the handoff diff reconciliation exempts it. `--pr` will warn that the branch edits a shared log. That warning is expected for this one-sentence edit, so list the file in the handoff Changes table anyway.
- Three synced mirrors appear in the diff: `templates/.claude/skills/canon-prune/SKILL.md`, `templates/.claude/skills/canon-sweep/SKILL.md` and `templates/.claude/skills/canon-init/SKILL.md`. Declare each one in the handoff Changes table (`docs/patterns.md` §"Declare `templates/` mirrors…"). `templates/docs/lessons-learned.md` is **not** a mirror. Edit it by hand. Its "How to use" paragraph 2 already differs from the root copy, which has the `/canon-sweep` parenthetical.
- **Grep traps in the new skill:** never write "demote" (AC-6) or "canon-ai" (AC-3). In particular, do not carry over canon-sweep's sentence "If this repository *is* the canon-ai source…". The skill never names `src/`, `scripts/` internals (other than the shipped `scripts/docs-refs-check.mjs`), `templates/`, or a prompt-template file name (AC-13).
- **Placeholder refs:** do not write a backticked `something.md` followed by `§"…"` as a placeholder or example inside the skill. `docs-refs-check` will try to resolve it. In examples and format blocks, write locators as `<doc path> :: <heading>` (see Step 1 §"Step 6").

## Steps

### Step 1: Write the `/canon-prune` skill

Files: `.claude/skills/canon-prune/SKILL.md` (new; root is authoritative)

Model the voice, structure and density on `.claude/skills/canon-sweep/SKILL.md`. Below is the section outline with the load-bearing strings. The prose is yours; every bullet below must be present.

**Frontmatter (AC-1):**

```yaml
---
name: canon-prune
description: Use when the human asks to prune, trim, slim, or dedupe the project's permanent docs or "the canon" (`docs/patterns.md`, `docs/decisions.md`, `docs/architecture.md`, any pitfall docs they route to, and the agent instruction files) — phrases like "prune the docs", "trim the canon", "the permanent docs are bloated", "find duplicated rules", or explicit `/canon-prune` invocation. Human-invoked only; run it about monthly or after a model-generation change, never on an entry count. Proposes a delete, relocate, merge, or keep verdict per rule and writes nothing until the human approves each row. Not for the lessons-learned buffer (`docs/lessons-learned.md`), which is `/canon-sweep`'s, and never reads or edits canon-managed files.
allowed-tools: Read AskUserQuestion Agent Glob Grep Edit Write Bash(git log *) Bash(git show *) Bash(git status *) Bash(git branch *) Bash(git diff *) Bash(git worktree list) Bash(canon task list) Bash(node scripts/docs-refs-check.mjs*)
effort: medium
---
```

The allowlist is canon-sweep's list plus `Agent` and the shipped checker command. Leave canon-sweep's description untouched. It claims only `docs/lessons-learned.md`, so AC-1's "neither claims the permanent docs" holds.

**Body outline, in this order:**

1. `# Permanent-Docs Prune`: one paragraph. This is the outflow counterpart to `/canon-sweep`: the sweep decides what enters the permanent docs, and the prune decides what leaves them. Every line is read by agents, so dead and duplicated rules cost attention on every task.
2. `## When to use`: the human asks. Cadence is about monthly, or after a model-generation change. Never start on your own, and no entry count or size threshold triggers it.
3. `## Scope` (AC-2, AC-3):
   - *In scope:* `docs/patterns.md`, `docs/decisions.md`, `docs/architecture.md`. Also every doc listed in the `Read this doc` / `Before touching` table directly under `## Known Pitfalls` in `docs/patterns.md`, if the project keeps one: discover these by reading the table, never from a fixed list. Also `AGENTS.md` and `CLAUDE.md`, if the project keeps them.
   - *Out of scope:* `docs/lessons-learned.md` (the sweep's job). Also every file canon manages, named concretely as the files an adopter receives from `canon init` and `canon upgrade`: everything under `.canon/` except `config.json`, the `canon-*` skills, the review agent definitions canon installs under `.claude/agents/`, `docs/pipeline-orchestrator.md`, and the guard hook and docs-refs checker script canon installs.
   - The literal sentence: "Canon-managed files are never read, inventoried or edited."
   - Step 1 of the workflow tells the human which docs will be reviewed (including any routed pitfall docs) and states that the lessons buffer and canon's own files are untouched (Human Test Plan item 2).
4. `## Verdicts` (AC-6): exactly four, as defined in the spec's Decision §"Verdicts".
   - **delete**: obsolete, superseded, enforced by a check, self-evident, or describes canon's own mechanism.
   - **relocate**: same rule, cheaper carrier (from an always-loaded agent file to a just-in-time doc, or from a doc to a one-line comment at the code site).
   - **merge**: one home, every other copy reduced to a pointer or removed.
   - **keep**.
   - The sentence: "A rule that duplicates another project rule is never a `delete`; it is a `merge`."
   - Do not use the word "demote" anywhere. The cheaper-carrier verdict is only ever "relocate".
5. `## High-level canon mentions only` (AC-3): state the **canonical sentence** below verbatim. Steps 7 and 8 reuse the same sentence (`docs/patterns.md` §"A rule homed on multiple guidance surfaces…", part 3, canonical text):

   > Keep canon mentions in agent files and docs at a high level: that the project uses canon, and how and when (which skills or flows to use for what, and where the project's own canon conventions live). Don't copy canon's mechanisms (what canon injects into prompts, how phases route, what a gate checks, which files canon reads) into them: canon's own docs carry those, and a copy goes stale when canon changes.

   Then the verdict rule: `delete` for a rule that only describes a canon mechanism, and an edit that keeps only the project's own convention for a mixed rule. The skill makes this call without reading canon's files. Give one example of each kind:
   - keep: "Use `/canon-spec` for new features."
   - delete: "canon injects only the `## Known Pitfalls` section into implement prompts."
   - mixed: a rule that states the project's own pitfall-routing convention and also explains how canon injects pitfalls. Keep the first part, drop the second.
6. `## Implement-prompt guard` (AC-7): entries under `## Known Pitfalls` in `docs/patterns.md`, and the H3 entries in the docs its `Read this doc` table routes to, are injected into implement prompts when their backticked paths match a task's affected files. Mark any verdict that would remove such an entry or strip its path citations with the literal tag **"removes from implement prompts"** in its triage row. That covers a delete, a relocate out of it, a merge whose home is elsewhere, and rewrite text that drops paths. A merge whose rule is a pitfall keeps its home as a path-citing H3 in one of those docs.
7. `## Default stance: remove and measure` (AC-8): removal is cheap and reversible through git, so no step requires proving a rule unneeded before proposing to remove it. Ablation (re-running the original failure with a subagent given the docs minus the rule) is optional, only on the human's request, per rule, and never a default. Measurement uses the Step 6 prune record and the sweep's `git log -S` recurrence check.
8. `## Step 1 — Preconditions and scope` (AC-2):
   - Triage is read-only. Before applying anything, run the preflight in `.claude/skills/canon-sweep/SKILL.md` §"Preconditions" and stop if any check fails. Reference it this way; do not restate its bullets.
   - Read the prior prune record (Step 6 lookup) before launching agents.
   - Resolve the in-scope list, tell the human, change nothing.
9. `## Step 2 — Inventory and evidence` (AC-4):
   - Launch one read-only agent per doc group with the `Agent` tool, all in one message, on a light model (for example `model: sonnet`). Default groups:
     1. `docs/patterns.md` plus its routed pitfall docs;
     2. `docs/decisions.md`;
     3. `docs/architecture.md` plus the agent instruction files.
   - Brief: READ-ONLY, no edits or commits; never read canon-managed files.
   - Split into rules: heading-level entries, table rows, or bullets carrying an instruction.
   - Per-rule return fields: location (`<doc path> :: <heading>`, plus ` :: <row key>` for a table row, where the row key is the row's first cell); **form** `rule` | `pointer`; a one-line gist; the six evidence items; a proposed verdict with exact replacement text, or "delete".
   - The six evidence items, named exactly:
     1. **Provenance**: the commit, and the task when the project archives tasks, via `git log -S` / `git log -G`.
     2. **Still true**: the paths, symbols, commands and flags it names still exist.
     3. **Describes canon**: see §"High-level canon mentions only".
     4. **Enforced now**: a test, lint check, hook or gate now catches the mistake.
     5. **Superseded**: a later decision replaced it, including inline "superseded" annotations.
     6. **Citations**: task artifacts since the rule landed cite it or record tripping over it. Never-cited is a candidate signal only.
   - The sentence: "Inventory agents never propose `delete` because a rule is covered by another project doc; they flag the overlap, and Step 3 decides."
10. `## Step 3 — Cross-doc comparison` (AC-5): this runs in the invoking session.
    - Compare gists of `rule`-form entries only. `pointer` entries are never duplicates.
    - Before proposing a merge, re-read the source text of every entry in a candidate cluster and confirm the requirements match.
    - Choose the home with the table in `.claude/skills/canon-sweep/SKILL.md` §"Step 2 — Choose the smallest carrier". A pitfall's home may be any doc in the `Read this doc` table.
    - Every other copy becomes a one-line pointer or is deleted.
    - The cluster's merge verdict replaces its members' inventory verdicts, so two copies are never both deleted.
    - Summary and index tables are pointers. Don't delete one for repeating the names of the rules it points to (Human Test Plan item 6).
11. `## Step 4 — Triage with the human` (AC-9):
    - One table per doc group, merges last, one row per non-keep verdict. Each delete, relocate and merge row shows the exact edit, the destination and the evidence, plus the guard tag where it applies.
    - Suggested columns: `| # | Location | Verdict | Edit / destination | Evidence | Guard |`.
    - Ask with `AskUserQuestion` per batch. The human approves, flips or edits each row. Nothing is written before approval.
    - Rejected rows become "Reviewed and kept" rows for Step 6.
    - Ablation is offered only if the human asks for it on a specific row.
12. `## Step 5 — Apply and validate` (AC-9):
    - Re-run the preflight.
    - Apply the approved rows with file-disjoint editing agents on a light model. No two agents edit one file; the invoking session makes shared edits afterward.
    - Then run the docs validation: the shipped docs-refs checker `node scripts/docs-refs-check.mjs`, if the project has it, plus any docs check listed in the validation section of `docs/architecture.md`. If any non-doc file changed (a relocate to a code comment), also run the project's full validation commands from that section.
    - Do not commit.
13. `## Step 6 — Prune record` (AC-10): draft the commit message in exactly this shape, inside a fenced `text` block in the skill:

    ```text
    docs: canon-prune (<a> deleted, <b> relocated, <c> merged, <d> reviewed and kept)

    Deleted:
    - <doc path> :: <heading>[ :: <row key>] — <one-line reason>
    Relocated:
    - <doc path> :: <heading>[ :: <row key>] → <destination> — <reason>
    Merged:
    - <home doc path> :: <heading> ← <other locations> — <reason>

    Reviewed and kept:
    - <doc path> :: <heading>[ :: <row key>] | proposed: <verdict> | evidence: <the evidence items that drove the proposal> | kept because: <reason>

    Canon-Prune: <YYYY-MM-DD>
    ```

    - **Lookup at run start:** `git log -1 --format=%H --grep='^docs: canon-prune' --grep='^Canon-Prune:'`. Multiple `--grep` patterns are ORed, so the trailer still matches after a squash-merge rewrites the subject. Read the commit with `git show <sha>`. If none is found, nothing is skipped.
    - **Match:** a current rule matches a "Reviewed and kept" entry when the doc path and the heading (plus the row key for a table row) match. If neither matches, for example after a rename, fall back to comparing the gist against the recorded rule.
    - **Re-propose only when** `git diff <sha> -- <doc path>` shows a hunk inside the rule's text, or any recorded evidence item now reads differently: a named path is gone, a check now enforces it, or a later decision supersedes it.
    - Otherwise skip the rule and list each skipped rule in the run summary.
    - No log file is created.
    - **Hand off:** give counts, the skipped list, and follow-ups such as code-comment relocations that need review, or a rule reported to the canon maintainers. Then present the drafted message. Do not commit.
14. `## What this skill does not do`: it doesn't touch the lessons buffer, read or edit canon-managed files, run on a schedule or a size threshold, commit, or ablate by default.

### Step 2: Add the canon-sweep recurrence clause

Files: `.claude/skills/canon-sweep/SKILL.md`

In §"Stage B — Is the evidence sufficient? → Evaluate promotion", extend only the **Recurrence** bullet. Append to it:

> Also check whether the lesson was once a permanent rule that a `/canon-prune` run removed: run `git log -S '<key phrase>' -- docs/patterns.md docs/decisions.md docs/architecture.md AGENTS.md CLAUDE.md` (plus any pitfall docs `docs/patterns.md` routes to), and if it was, count that history as a prior occurrence.

The `--` keeps git from erroring on a path the project doesn't keep. Change nothing else in the file (AC-11).

### Step 3: Add the docs-audit prune pass

Files: `.claude/skills/docs-audit/SKILL.md` (canon-ai-local, no mirror)

- In §"1. Audit", add one row to the group table: **Prune (canon-managed set)**. Its scope is the root copies of the markdown files in `CANON_OWNED` (`src/lib/canon-owned.ts`). The agent applies `/canon-prune`'s verdicts and implement-prompt guard by reference: write `` `.claude/skills/canon-prune/SKILL.md` §"Verdicts" `` and `§"Implement-prompt guard"` in the same path form. It also checks for rules duplicated across shipped files and the root docs.
- Extend the return-format verdict list with `PRUNE delete | PRUNE relocate | PRUNE merge <doc:line>`, plus the guard tag where it applies.
- In §"2. Triage with Tim", proposed PRUNE rows join the existing table. Recommend each one individually, never as a batch apply.
- In §"3. Apply", the existing "root copies only, never `templates/`" rule covers these edits. Add a single line: candidates found in `src/orchestrator/prompts/templates/` (not canon-managed) are listed as follow-ups, never edited.
- §"4. Validate" already runs sync, docs-refs and `npm test` when a skill or template changed. No change there.
- Do **not** add docs-audit to `CANON_OWNED` (AC-15).

### Step 4: Register the skill in `src/`

Files: `src/lib/canon-owned.ts`, `src/cli/commands/doctor.ts`

- `CANON_OWNED`: insert `'.claude/skills/canon-prune/SKILL.md',` directly after the canon-sweep entry.
- `RECOMMENDED_ALLOW`: insert `'Skill(canon-prune)', 'Skill(canon-prune:*)',` after the two canon-sweep entries.
- `checkSkills` `skillNames`: append `'canon-prune'`.
- Touch no `RECOMMENDED_NUDGE` line, no config-parser allowlist and no command registration (AC-12, AC-18).

### Step 5: Sync the mirrors and build

Run `npm run sync-templates`. It creates `templates/.claude/skills/canon-prune/SKILL.md` and updates the canon-sweep and canon-init mirrors (run it again after Step 7). Then run `npm run build`, and confirm that `git diff --stat -- dist/` lists only `dist/cli/index.js`. Any other `dist/` file means an unintended source change. Stop and report it.

### Step 6: Update the tests

Files: `tests/cli.test.ts`

- Line 1389: rename the test to `'checkSkills: all nine skills present → pass'` and add `'canon-prune'` to its array.
- The "all operational skills missing" test (around line 1404): add `assert.match(check.detail ?? '', /canon-prune/);`.
- Add a new test after the canon-changelog test, modeled on it: `'checkSkills: canon-prune specifically checked — missing canon-prune warns even with others present'`. Create every other skill (canon-init, spec, pipeline, status, changelog, spec-review, inline-review, sweep), then assert `status === 'warn'`, that the detail matches `/canon-prune/`, and that it does not match `/canon-sweep/`.
- No change is needed for the `RECOMMENDED_ALLOW` spread tests or the README drift test. They must pass once Step 7 updates the README.

### Step 7: Update the listing sites and the high-level-mentions guidance

Files: `README.md`, `.claude/skills/canon-init/SKILL.md`, `.claude/settings.json`, `docs/lessons-learned.md`, `templates/docs/lessons-learned.md`, `CHANGELOG.md`

- **README:**
  - Skill table: add a row after `/canon-sweep`: `` | `/canon-prune` | Pruning the permanent docs (patterns, decisions, architecture, agent files) — delete, relocate, or merge rules, human-approved; about monthly | ``.
  - "Skip the permission prompts" JSON: add `"Skill(canon-prune)", "Skill(canon-prune:*)"` after the canon-sweep pair, and fix the commas so the block still parses (the test runs `JSON.parse` on it).
  - Line 492 sentence: append `, \`/canon-prune\` (prune the permanent docs)`.
  - §"Discovery nudge (recommended)": after the closing fence of the ```` ```text ```` block, add one paragraph containing the canonical sentence from Step 1 verbatim. Leave the block itself unchanged.
- **canon-init:**
  - Line 140 allowlist: add `"Skill(canon-prune)", "Skill(canon-prune:*)"` to the canon-sweep line, with a trailing comma on the sweep pair as needed.
  - Phase 0 (agent-file check, line 20): append advice to the human. If they add canon guidance to `AGENTS.md` / `CLAUDE.md`, give them the canonical sentence verbatim, framed as advice ("Pass this on to the project owner:"). Canon never writes those files.
  - Related entry for `AGENTS.md` / `CLAUDE.md` (line 205): append "; keep canon mentions there at a high level (see Phase 0)".
  - Then run `npm run sync-templates` again.
- **`.claude/settings.json`:** add the two entries after `Skill(canon-sweep:*)`, and keep the JSON valid.
- **`docs/lessons-learned.md`** and **`templates/docs/lessons-learned.md`**, §"How to use this doc": after the "The goal: this file is a *staging area*…" paragraph, add this sentence to both files:

  > The permanent docs the sweep promotes into are pruned separately: a human runs the `/canon-prune` skill when they choose to, and no entry count or size threshold triggers it.

  `grep -n canon-prune` must match exactly once in each file (AC-16).
- **`CHANGELOG.md` `[Unreleased]`:**
  - Under `### Added`, modeled on the 3.2.0 `/canon-sweep` entry: **New `/canon-prune` skill prunes the permanent docs.**
    - What it reviews: patterns, decisions, architecture, routed pitfall docs and agent files, rule by rule, with parallel inventory agents.
    - What it proposes: delete, relocate, merge or keep, with evidence, approved per row; it flags pitfalls that would leave implement prompts.
    - It drafts a `docs: canon-prune` commit message that records reviewed-and-kept rules, and never touches the lessons buffer or canon-managed files.
    - Installed by `canon init` / `canon upgrade` and checked by `canon doctor`. Until you run `canon upgrade` and add `Skill(canon-prune)` and `Skill(canon-prune:*)` to `.claude/settings.json`, `canon doctor` warns about the missing skill and the two missing allowlist entries.
    - The README and `/canon-init` now advise keeping canon mentions in agent files at a high level.
  - Under `### Changed`: **`/canon-sweep` checks whether a lesson used to be a permanent rule.** Before claiming recurrence, it runs `git log -S` on the permanent docs and counts a rule a prune removed as a prior occurrence.

### Step 8: Check that the canonical sentence matches across carriers

Run `grep -rn "Keep canon mentions in agent files and docs at a high level" README.md .claude/skills/canon-prune/SKILL.md .claude/skills/canon-init/SKILL.md`. Expect one match per file, with identical text after the match point. Record the output in the handoff.

### Step 9: Validate

Run every command in Validation Required: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (then `git diff --exit-code -- dist/` after committing the rebuilt file), `npm run sync-templates:check`, `npm run docs-refs-check`.

Also prove that the skill-to-skill section refs resolve. This answers the spec's Interaction Dependencies question:
1. Temporarily change `§"Preconditions"` in canon-prune to `§"PreconditionsX"`.
2. Run `npm run docs-refs-check` and confirm it reports the broken ref.
3. Revert the change and re-run the check clean.
4. Report both runs in the handoff. If it does **not** catch the broken ref, say so plainly; that is the Known Risk the spec names.

Then run the AC greps and record their output:
- `grep -n -i 'canon-ai' .claude/skills/canon-prune/SKILL.md` (expect no match);
- `grep -n -i demote .claude/skills/canon-prune/SKILL.md` (expect no verdict line);
- `git diff main -- .claude/skills/canon-sweep/SKILL.md` (expect only the clause);
- `git diff main -- src/cli/commands/doctor.ts` (expect no `RECOMMENDED_NUDGE` line);
- `grep -rn 'canon-sweep' --exclude-dir=tasks --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git .` (expect `canon-prune` beside it at every live listing; CHANGELOG history and BACKLOG records excepted).

## Testing Plan

- **Unit:** see Step 6. The new canon-prune-specific test and the new assert in the all-missing test fail without the `doctor.ts` change. The README-vs-`RECOMMENDED_ALLOW` test fails if only one allowlist is updated. The rest of the full `npm test` suite guards the existing pins (nudge text, guard-hook block, `CANON_OWNED` template basenames).
- **E2E:** N/A, since canon-ai has no UI surface.
- **Manual:** this plan runs no prune on any repo (Non-Goals). Reading the skill against AC-1 through AC-10 and AC-13 is the code-review check. The Human Test Plan covers real use after release.

## Rollback Plan

Revert the commit. The change is additive. Adopters who upgraded keep a now-unmanaged `canon-prune` skill file until they delete it, and `canon doctor` stops checking for it. There is no data migration.

## Open questions (unattended run)

- The commit-record marker is a `Canon-Prune: <date>` trailer, in addition to the `docs: canon-prune` subject prefix, so the lookup survives a squash-merge subject rewrite. This was chosen by the plan, within the spec's "for example `docs: canon-prune`". It is recorded in `notes.md`.
- The concrete canon-managed list also names the guard hook and the checker script, which the spec's by-kind list omits. Neither is a doc, so this changes nothing in scope; it only makes the "never read" list accurate. It is recorded in `notes.md`.
