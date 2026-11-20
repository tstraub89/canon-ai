# Spec: canon-prune-skill — Add /canon-prune: periodic multi-agent prune of the permanent docs

> Written by: Claude | Review by: spec reviewer
> Status: draft

## Problem

Canon's permanent docs only grow. `/canon-sweep` governs *inflow*: it decides which lessons-learned entries get promoted into `docs/patterns.md`, `docs/decisions.md`, `docs/architecture.md`, or the agent instruction files, and keeps the buffer small. Nothing governs the permanent docs themselves. A rule, once promoted, stays forever, even when its code path is gone, a test now enforces it, a later decision superseded it, or the same rule has been restated in three other docs. Every line in those docs is read by agents (the agent files in every session; the rest just in time), so dead and duplicated rules cost context and attention on every task, and eventually crowd out the rules that matter. An external reader raised exactly this: when and how does the canon get pruned?

Measured sizes of the permanent docs (2026-11-19):

| Repo | patterns | decisions | architecture | AGENTS + CLAUDE (always loaded) |
|---|---|---|---|---|
| canon-ai | 70 KB | 107 KB | 24 KB | 7.5 KB |
| A large adopter (≈530 archived tasks) | 172 KB | 82 KB | 31 KB | 30 KB |
| A second adopter | 87 KB | 48 KB | 71 KB | 77 KB |

**Experiments on the large adopter (read-only, 2026-11-19).**

*Duplicate detection.* Three ways of finding rules stated in more than one place across its five permanent docs were run and cross-scored:

- **One agent reading all five docs in full** found 99 duplicate clusters. It self-reported 75–80% confidence, lower inside long narrative pitfall sections.
- **Per-doc agents writing a one-line gist per rule, then one session comparing only the gists,** found 118 clusters. 83 of them overlap with the full-text set; each method found roughly 25–35 the other missed.
- **Lexical TF-IDF cosine over paragraph chunks** catches only 36 of the 99 full-text clusters at a 0.25 threshold (51 at 0.2), missing about half even of the near-verbatim ones. Its top hits include trigger-table and quick-reference rows that are intentional pointers, not duplicates.

*Overlap with canon's own shipped files.* An agent checked the adopter's 23 workflow and process rules against its installed canon-managed files:

- 8 are fully redundant: about 3 KB, roughly 1% of its docs.
- 14 are canon rules extended with project detail.
- 1 contradicts canon: the adopter's docs say canon injects only the `## Known Pitfalls` section into implement prompts, while the shipped `docs/pipeline-orchestrator.md` documents more.

The app-specific rules (about 90% of the text) had no overlap with canon.

**Conclusions this spec builds on:**

- Duplication is large (100+ clusters in one repo), so pruning is worth a tool.
- The gist inventory is the right detection method, because a per-rule inventory has to exist anyway for per-rule verdicts, which makes cross-doc comparison nearly free.
- A lexical-similarity command does not earn its place.
- Comparing an adopter's docs against canon's shipped files in bulk is not worth it. A narrow check of the rules that describe canon's own workflow catches the stale and contradictory ones.
- A repo can split its pitfalls into further docs. That adopter keeps a `docs/pitfalls/` directory, routed from the `Read this doc` / `Before touching` table under `## Known Pitfalls`, so a fixed file list misses them.
- Many "duplicates" are intentional summaries (trigger tables, quick-reference rows, an abbreviated copy of a canonical table in an agent file), and must be told apart from full restatements.

## Decision

Add a new canon-managed Claude Code skill, `/canon-prune`, that reviews a project's permanent docs rule by rule and proposes, per rule, one of four verdicts: delete, relocate, merge, or keep. It is the outflow counterpart to `/canon-sweep`. Like the sweep, it is human-invoked, proposes everything before writing anything, and never commits. Unlike it, it is run sparingly: about monthly, or after a model-generation change. Separately, extend canon-ai's local `docs-audit` skill so it can apply the same verdicts to canon-ai's own canon-managed files, which ship to every adopter.

### `/canon-prune` workflow

1. **Preconditions and scope.**

   *Preflight.* Before any write, the skill runs the same preflight as canon-sweep (§"Preconditions" in that skill), which the skill references rather than restates.

   *In scope:*
   - `docs/patterns.md`, `docs/decisions.md` and `docs/architecture.md`.
   - Every doc listed in the `Read this doc` / `Before touching` table directly under `## Known Pitfalls` in `docs/patterns.md`, if the project keeps one. These are discovered from the doc, not from a fixed list.
   - The project's agent instruction files (`AGENTS.md`, `CLAUDE.md`), if it keeps them.

   *Out of scope:*
   - `docs/lessons-learned.md`, which is the sweep's job.
   - Every file canon manages. The skill names that set concretely as the files an adopter receives from `canon init` and `canon upgrade`: everything under `.canon/` except `config.json`, the `canon-*` skills, the review agent definitions canon installs, and `docs/pipeline-orchestrator.md`.

   Canon-managed files are never read, inventoried or edited.

2. **Inventory and evidence (parallel, read-only).** One agent per doc group, launched together on a light model (for example `sonnet`). The default groups are:
   - `docs/patterns.md` together with the pitfall docs it routes to;
   - `docs/decisions.md`;
   - `docs/architecture.md` together with the agent instruction files.

   Each agent splits its docs into rules: heading-level entries, table rows, or bullets carrying an instruction. Per rule, it returns:
   - its location;
   - its **form**: `rule` (states the requirement in full) or `pointer` (an index, trigger, or quick-reference row, or a one-line "see X");
   - a one-line gist of what it requires;
   - the evidence below;
   - a proposed verdict with exact replacement text, or "delete".

   Inventory agents never propose `delete` because a rule is covered elsewhere. They flag it, and step 3 decides.

   Evidence, all cheap:
   - **Provenance:** the commit (and task, when the project archives tasks) that added the rule, via `git log -S` / `git log -G`. This recovers the original failure that the sweep stripped when it promoted the rule.
   - **Still true:** the paths, symbols, commands and flags it names still exist.
   - **Describes canon:** whether the rule describes how canon itself works (what it injects, routes, gates, or checks). See "High-level canon mentions only" below.
   - **Enforced now:** a test, lint check, hook or gate now catches the mistake.
   - **Superseded:** a later decision replaced it, including any inline "superseded" annotation left in place.
   - **Citations:** whether task artifacts since the rule landed (reviews, handoffs, notes, done summaries) cite it or record tripping over it. Never-cited is a candidate signal only, because a preventive rule that works leaves no trace.

3. **Cross-doc comparison (main session).** Compare the gists of every `rule`-form entry to find rules stated in more than one place. `pointer` entries are never duplicates. Before proposing a merge, re-read the source text of each entry in the candidate cluster to confirm the requirements match. Each confirmed cluster gets one **merge** verdict:
   - The home is chosen with the table in canon-sweep §"Step 2 — Choose the smallest carrier". A pitfall's home may be any doc in the `Read this doc` table, not only `docs/patterns.md`.
   - Every other copy becomes a one-line pointer or is deleted.
   - Inventory verdicts on a clustered entry are replaced by the cluster's merge verdict, so two copies are never both deleted.

4. **Triage with the human.** The skill presents verdict tables, one row per non-keep verdict. Each delete, relocate and merge row carries its exact edit, destination and evidence. Tables are presented in batches (one per doc group, merges last) so a large run stays reviewable. The human approves, flips, or edits each row. Nothing is written before approval.

5. **Apply and validate.** After the preflight passes, file-disjoint editing agents apply the approved rows: no two agents edit one file, and the main session makes shared edits afterward. The docs validation runs. If any non-doc file changed (for a relocate to a code comment), the project's full validation commands run too. The skill then hands back a summary and a **drafted commit message** (step 6), and does not commit.

6. **Prune record in git history.** The drafted commit message uses a fixed subject prefix, for example `docs: canon-prune`. Its body lists each removed, relocated or merged rule with its one-line reason. It also lists rules that were proposed but the human kept, under a "Reviewed and kept" heading with the reason. At the start of a run, the skill reads the most recent such commit (`git log --grep`). It does not re-propose a "Reviewed and kept" rule unless the evidence for it has changed since that commit. No separate log file exists.

   *Matching across runs.* Each "Reviewed and kept" entry records:
   - the rule's doc path and heading (or table-row key);
   - the proposed verdict;
   - the evidence that drove the proposal.

   On the next run, a rule matches an entry when the doc path and heading match. If no match is found that way (for example, after a rename), the gist is the fallback. A matched rule is re-proposed only when:
   - its text changed since the prune commit (checked with `git diff <prune-commit> -- <doc>`), or
   - any recorded evidence item now reads differently (for example, a named path disappeared, a check now enforces it, or a later decision superseded it).

   Otherwise it is skipped, and the skip is listed in the run's summary so the human can see what was not re-proposed.

### Verdicts

- **delete**: the rule is obsolete, superseded, enforced by a check, self-evident, or describes canon's own mechanism. A rule that duplicates another project rule is never a delete; it is a merge.
- **relocate**: same rule, cheaper carrier. Move it from an always-loaded agent file to a just-in-time doc, or from a doc to a one-line comment at the code site.
- **merge**: one home for a rule stated more than once, with every other copy reduced to a pointer or removed.
- **keep**: the rule stays as is.

### High-level canon mentions only

A project's docs and agent files may say that the project uses canon, and how and when at a high level: which skills or flows to use for what, and where the project's own canon-related conventions live. They don't describe canon's mechanisms (what the orchestrator injects, how phases route, what a gate checks, which file canon reads). Those descriptions belong to canon's own shipped docs, and a project copy goes stale when canon changes. The skill proposes:
- `delete` for a rule that only describes a canon mechanism;
- an edit that keeps only the project's own convention, for a rule that mixes a mechanism description with one.

It does not need to read canon's own files to make that call, so canon-managed files are never read.

The same rule is stated where agent files and docs get written, not only where they get pruned:
- **README §"Discovery nudge (recommended)".** One sentence after the nudge block. Keep canon mentions at that level: that the project uses canon, and how and when. Don't copy canon's mechanisms into agent files or docs, because canon's own docs carry them and a copy goes stale. The nudge block itself is unchanged, because a test pins it to `canon doctor`'s recommended text.
- **The `canon-init` skill.** The same guidance where it discusses adopter agent files (its agent-file check and its Related entry for `AGENTS.md` / `CLAUDE.md`). It is worded as advice to the human, since canon never writes those files.

"Relocate" is deliberately not called "demote", which canon already uses for a pitfall dropped from the implement prompt by the size cap.

### Implement-prompt guard

Entries under `## Known Pitfalls` in `docs/patterns.md`, and the H3 entries in the docs its `Read this doc` table routes to, are injected into implement prompts when their backticked paths match a task's affected files. Any verdict that would remove such an entry or strip its path citations is marked "removes from implement prompts" in its triage row. That covers a delete, a relocate out of it, a merge whose home is elsewhere, and rewrite text that drops paths. A merge whose rule is a pitfall keeps its home as a path-citing H3 in one of those docs.

### Default stance: remove and measure

Removing or moving text is cheap and reversible through git, so the skill never requires proving a rule is unneeded before proposing to remove it. **Ablation** is an optional step the human may request for a specific high-stakes rule, never a default. It means re-running the original failure scenario with a subagent given the docs minus the rule. "Measure" runs on git history:
- the prune commit records what left (step 6);
- the sweep's recurrence check uses `git log -S` to recognize a new lesson that used to be a permanent rule.

### Sweep hook

canon-sweep gets one clause in §"Stage B — Is the evidence sufficient? → Evaluate promotion": before claiming recurrence, check `git log -S` on the permanent docs for whether the lesson was once a permanent rule removed by a prune. If it was, treat that history as a prior occurrence. This is the only change to canon-sweep.

### canon-ai's own canon-managed files: a prune pass in `docs-audit`

canon-ai's local `docs-audit` skill (not shipped) gains a prune pass over canon-ai's canon-managed set (`CANON_OWNED`). It uses `/canon-prune`'s verdicts and implement-prompt guard by reference and adds proposed deletions to its existing triage. It edits root copies only; its existing validation step (sync, docs refs, `npm test` when a skill or template changed) covers the result. Candidates in canon-ai's orchestrator prompt templates, which aren't canon-managed, are listed as follow-ups, not edited.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Ship the doctor size-budget warning in this task | Skill only; budget warning is a follow-up | Ship a `canon doctor` per-file budget warning (built-in defaults) alongside | No basis yet for a threshold; the first prune runs produce the data | `Human` |
| Scope of one run | All permanent docs in one multi-agent pass, about monthly | One named doc per run | Duplication sits across files; a cross-doc pass makes merge first-class | `Human` |
| Duplicate detection method | Gist inventory per doc, compared in the main session, confirmed against source text | One full-text agent reading every doc; or lexical/embedding similarity tooling | Experiment: gists found 118 clusters vs full-text 99 (83 shared) at near-zero marginal cost; TF-IDF recall ~36–51% | `Human` |
| Home for a merged or relocated rule | canon-sweep's Step 2 home table, approved per row | Always keep the always-loaded agent-file copy | One routing rule for both skills; a wrong move recurs via lessons and the sweep re-promotes it | `Human` |
| Ablation | Optional, human-requested per rule | Default for rules that look self-evident now | Text removal is cheap and reversible; measure going forward instead of testing up front | `Human` |
| Canon-managed files in adopter repos | Never read, inventoried or edited | Read in full as a comparison set; or a narrow check of canon-describing rules against them | Experiment: ~1% fully redundant; the one contradiction found was a project doc describing a canon mechanism, which the high-level-only rule removes without reading canon's files | `Human` |
| How project docs may mention canon | High level only (that it's used, how and when); mechanism descriptions are deleted | Allow mechanism descriptions and check them against canon's files for staleness | Mechanism copies go stale when canon changes; canon's own docs are the one home | `Human` |
| Where the high-level-only rule is stated | `/canon-prune`, the README's "Discovery nudge" section, and the `canon-init` skill | `/canon-prune` only | Stating it where agent files get written prevents the drift instead of only cleaning it up | `Human` |
| canon-ai's own canon-managed files | A prune pass in the existing local `docs-audit` skill | A second local skill, or a canon-ai branch inside the shipped skill | docs-audit already audits that set with OBSOLETE/DUPLICATE verdicts and the same validation; no canon-ai logic ships | `Human` |
| Prune record | Drafted commit message with a fixed prefix listing removed and reviewed-and-kept rules; no log file | A bounded HTML comment log in a doc | Git history already holds removals; the message adds the rejected rows plain history can't show | `Human` |
| New skill vs a permanent-docs mode of `/canon-sweep` | New skill | A second mode inside canon-sweep | Different cadence (monthly vs buffer-driven), multi-agent shape, and inputs (rebuilt evidence vs fresh buffer); a mode would double canon-sweep's size and blur its trigger | `Author` |
| Sweep change | One Stage B clause: check `git log -S` for a removed permanent rule before claiming recurrence | Leave canon-sweep untouched and accept that recurrences can't be traced to a prune | Without it, "measure" in remove-and-measure has no mechanism | `Author` |
| Delete criteria | The skill's own delete list; a project-duplicate is always merge, never delete; canon-sweep's Stage A is not imported | Reference canon-sweep's Stage A wholesale | Stage A is written for buffer entries: its "already covered" means delete there but must mean merge here, and importing it lets two copies both be deleted | `Author` |
| Implement-prompt guard | Flag every verdict that removes a Known Pitfalls entry or its path citations; pitfall merges keep a path-citing H3 home | No special handling; rely on per-row human approval | A pointer row looks harmless in triage, but silently drops the rule from every future implement prompt | `Author` |
| Verdict name for a cheaper carrier | "relocate" | "demote" | "demote" already means a pitfall dropped by the implement-prompt size cap | `Author` |
| Lessons-learned buffer | Out of scope (sweep's job) | Include it so a single pass covers everything | Two skills owning one file would conflict | `Author` |
| Agent model | Light model for inventory and apply agents; synthesis in the invoking session | Inherit the session model everywhere | Inventory and mechanical edits don't need the strongest model; the experiments ran on `sonnet` | `Author` |

## Non-Goals

- No `canon doctor` size or token budget check and no new `.canon/config.json` key (follow-up after real runs). Backed by AC-12.
- No similarity tooling: no TF-IDF, MinHash, or embeddings, and no new `canon` subcommand. Backed by AC-12.
- No change to canon-sweep beyond the single Stage B clause. Backed by AC-11.
- No automatic, scheduled, or QA-emitted trigger for the prune. It is human-invoked only.
- No canon-ai-specific logic in the shipped skill. Backed by AC-3.
- No second canon-ai-local skill. canon-ai's managed set is handled inside `docs-audit`.
- No edits to canon-ai's orchestrator prompt templates (`src/orchestrator/prompts/templates/`). They aren't canon-managed files, and editing one means a rebuild and golden regeneration. `docs-audit` lists candidates there as follow-ups.
- Not running a prune on any repo as part of this task.

## Acceptance Criteria

- [ ] AC-1: `.claude/skills/canon-prune/SKILL.md` exists with frontmatter `name: canon-prune`. **Verify:** read the frontmatter; compare the two descriptions side by side.
  - The `description`:
    - triggers on "/canon-prune" and on phrases about pruning or trimming the permanent docs or the canon;
    - says the skill is human-invoked only;
    - says it is not for the lessons-learned buffer, which is `/canon-sweep`'s.
  - The `allowed-tools` list includes `Agent`, `AskUserQuestion`, the file read and edit tools, `canon task list`, and these git read commands: `git log`, `git show`, `git status`, `git branch`, `git diff`, `git worktree list`.
  - Neither skill's description claims "prune the permanent docs" for itself, apart from canon-prune.
- [ ] AC-2: The skill body prescribes the six-step workflow in the Decision section, in order. **Verify:** read the file.
  - The preflight is referenced to canon-sweep §"Preconditions", not restated.
  - Scope discovery reads the `Read this doc` / `Before touching` table under `## Known Pitfalls`, gated on the project keeping one.
  - The lessons buffer and the canon-managed set are out of scope.
- [ ] AC-3: The skill names the canon-managed set concretely, as in Decision step 1, and never reads, inventories or edits it. It states the high-level-only rule from the Decision section: a project may say it uses canon and how and when, but a rule that describes a canon mechanism gets a `delete`, and a mixed rule gets an edit that keeps only the project's own convention. The skill contains no canon-ai-specific branch. **Verify:** read the file. `grep -n -i 'canon-ai' .claude/skills/canon-prune/SKILL.md` returns no match, or only matches naming the canon-ai maintainers as the recipient of upstream reports.
- [ ] AC-4: Inventory agents are read-only, run on a light model, and are split into the default doc groups from Decision step 2. **Verify:** read the file.
  - Each returns per rule: location, form (`rule` or `pointer`), gist, the six evidence items, and a proposed verdict with exact text.
  - Inventory agents never propose `delete` on the grounds that a rule is covered by another project doc.
- [ ] AC-5: Cross-doc comparison works only on `rule`-form entries. **Verify:** read the file.
  - Each candidate cluster is confirmed against the source text before a merge is proposed.
  - The home is chosen via canon-sweep §"Step 2 — Choose the smallest carrier", with routed pitfall docs as valid pitfall homes.
  - A cluster's merge verdict replaces the inventory verdicts of its members.
- [ ] AC-6: The skill defines exactly four verdicts, `delete`, `relocate`, `merge` and `keep`, with the meanings and the delete list given in the Decision section. It states that a project duplicate is always `merge`, never `delete`. **Verify:** read the file. `grep -n -i demote .claude/skills/canon-prune/SKILL.md` returns no line that names a verdict.
- [ ] AC-7: The skill states the implement-prompt guard from the Decision section. **Verify:** read the file.
  - Every verdict that would remove a Known Pitfalls or routed pitfall H3, or strip its path citations, is marked "removes from implement prompts" in its row.
  - A pitfall merge keeps a path-citing H3 home.
- [ ] AC-8: The skill states the remove-and-measure default, with ablation optional and human-requested. No step requires proving a rule unneeded before proposing removal. **Verify:** read the file.
- [ ] AC-9: Triage and apply follow Decision steps 4–5. **Verify:** read the file.
  - Triage is batched per doc group with merges last, and each row is approved individually before any write.
  - Editing agents are file-disjoint.
  - The docs validation always runs; the project's full validation also runs when a non-doc file changed.
  - Nothing is committed.
- [ ] AC-10: The skill drafts the prune commit message from Decision step 6. At the start of a run it reads the most recent such commit and skips "Reviewed and kept" rules whose evidence hasn't changed. It creates no log file. **Verify:** read the file.
  - The message has a fixed subject prefix.
  - It lists removed, relocated and merged rules with reasons.
  - It has a "Reviewed and kept" list. Each entry records the doc path, the heading or row key, the proposed verdict, and the evidence.
  - A kept rule is re-proposed only when its text changed since that commit or a recorded evidence item now reads differently. Matching uses path and heading, with the gist as a fallback.
  - Skipped rules are listed in the run summary.
- [ ] AC-11: canon-sweep's §"Stage B — Is the evidence sufficient? → Evaluate promotion" gains one clause: before claiming recurrence, check `git log -S` on the permanent docs for a prior permanent rule removed by a prune, and count it as a prior occurrence. **Verify:** `git diff main -- .claude/skills/canon-sweep/SKILL.md` shows only that clause; the mirror is synced.
- [ ] AC-12: The diff is free of the deferred machinery. **Verify:** read the diff and grep the source.
  - Outside `dist/`, the only changed source files are `src/lib/canon-owned.ts` and `src/cli/commands/doctor.ts`.
  - The `doctor.ts` change is limited to the `checkSkills` list and `RECOMMENDED_ALLOW`.
  - No new key appears in the `.canon/config.json` parser's top-level allowlist.
  - No new subcommand appears in `canon --help`.
- [ ] AC-13: The skill obeys AGENTS.md §"Adopter Scope". **Verify:** `npm run sync-templates:check` (which includes the internal-path leak gate) and `npm run docs-refs-check` both pass; then a manual read.
  - Every path it names exists in an adopter repo, or is gated on existing.
  - It names no canon-ai source paths and backticks no internal prompt-template file name.
  - Every `§"…"` reference points to a heading that exists in canon-sweep or the adopter scaffolds.
- [ ] AC-14: `/canon-prune` is wired everywhere the shipped skills are listed. **Verify:** `npm test` passes, and a repo-wide `grep -rn 'canon-sweep'` (excluding `tasks/`, `node_modules/`, `dist/`) shows `canon-prune` beside it at every live skill listing.
  - `CANON_OWNED` in `src/lib/canon-owned.ts` includes the skill, and its `templates/` mirror is in sync.
  - `checkSkills` in `src/cli/commands/doctor.ts` lists `canon-prune`.
  - `RECOMMENDED_ALLOW` includes `Skill(canon-prune)` and `Skill(canon-prune:*)`.
  - The README carries the new skill in its "Skip the permission prompts" JSON block (which matches `RECOMMENDED_ALLOW`), its skill table, and its "Claude Code skills installed by `canon init`" sentence.
  - The `canon-init` skill's permission allowlist includes both entries.
  - canon-ai's tracked `.claude/settings.json` allowlist includes both entries.
  - The `checkSkills` tests in `tests/cli.test.ts` cover the new skill, and the "all … skills present" test title states the new count.
- [ ] AC-15: canon-ai's local `.claude/skills/docs-audit/SKILL.md` gains a prune pass over the `CANON_OWNED` set, as described in the Decision section. **Verify:** read the file; confirm `docs-audit` is still absent from `CANON_OWNED`.
  - It uses `/canon-prune`'s verdicts and implement-prompt guard by reference.
  - It feeds proposed deletions into its existing triage and edits root copies only.
  - It lists orchestrator prompt-template candidates as follow-ups.
- [ ] AC-16: The "How to use this doc" section of `docs/lessons-learned.md` and of the adopter scaffold `templates/docs/lessons-learned.md` gains one sentence. It says the permanent docs the sweep promotes into are pruned separately by the human-invoked `/canon-prune` skill, with no trigger threshold. **Verify:** `grep -n canon-prune` matches once in each file.
- [ ] AC-18: The README's §"Discovery nudge (recommended)" gains one sentence after the nudge block. It says to keep canon mentions at a high level (that the project uses canon, and how and when) and not to copy canon's mechanisms into agent files or docs. `canon-init`'s root and mirror copies give the same guidance where the skill discusses `AGENTS.md` / `CLAUDE.md`. **Verify:**
  - Read both files.
  - The nudge block and `RECOMMENDED_NUDGE` are unchanged, and the README-vs-`RECOMMENDED_NUDGE` test still passes.
  - `git diff main -- src/cli/commands/doctor.ts` touches no `RECOMMENDED_NUDGE` line.
- [ ] AC-17: The `[Unreleased]` section of `CHANGELOG.md` has an Added entry for `/canon-prune`, modeled on the 3.2.0 `/canon-sweep` entry, plus a line for the sweep's new recurrence check. The entry says adopters see `canon doctor` warnings for the missing skill and the two missing allowlist entries until they run `canon upgrade` and update their `.claude/settings.json`. **Verify:** read the section.

## Design

### Affected Files

| File | Change |
|---|---|
| `.claude/skills/canon-prune/SKILL.md`, `templates/.claude/skills/canon-prune/SKILL.md` | New skill (root authoritative; mirror synced via `npm run sync-templates`) |
| `.claude/skills/canon-sweep/SKILL.md`, `templates/.claude/skills/canon-sweep/SKILL.md` | One Stage B clause (root edit + synced mirror) |
| `.claude/skills/docs-audit/SKILL.md` | canon-ai-local: add the prune pass over `CANON_OWNED` (no mirror) |
| `src/lib/canon-owned.ts` | Add the skill path to `CANON_OWNED` |
| `src/cli/commands/doctor.ts` | Add `canon-prune` to `checkSkills`'s list and two `RECOMMENDED_ALLOW` entries |
| `dist/cli/index.js` | Rebuilt output of the `src/` changes (the only `dist/` artifact containing these symbols) |
| `tests/cli.test.ts` | Extend the `checkSkills` all-present and missing-warning tests, and update the test title's skill count |
| `README.md` | Skill table row, "Skip the permission prompts" allowlist entries, the "skills installed by `canon init`" sentence, one high-level-mentions sentence after the "Discovery nudge" block |
| `.claude/skills/canon-init/SKILL.md`, `templates/.claude/skills/canon-init/SKILL.md` | Add the two `Skill(canon-prune…)` entries to the offered permission allowlist, plus the high-level-mentions guidance where it discusses agent files (root edit + synced mirror) |
| `.claude/settings.json` | canon-ai's own allowlist: the two `Skill(canon-prune…)` entries |
| `docs/lessons-learned.md` | One sentence in "How to use this doc" pointing to `/canon-prune` for the permanent docs |
| `templates/docs/lessons-learned.md` | Same sentence in the hand-edited adopter scaffold (not a mirror) |
| `CHANGELOG.md` | `[Unreleased]` Added entries |

### Interaction Dependencies

- **canon-sweep.** canon-prune references its §"Preconditions" and §"Step 2 — Choose the smallest carrier" by exact heading. `docs-refs-check` scans shipped skills and resolves `§"…"` references; the implementer confirms that it checks skill-to-skill references, and if it doesn't, says so in the handoff.
- **Implement-prompt injection.** Pitfall injection reads `## Known Pitfalls` entries and routed pitfall docs by path citation; the implement-prompt guard exists to protect it. This task changes nothing in the injection code.
- **`canon doctor`.** In every adopter that hasn't upgraded, `checkSkills` warns about the missing skill. `checkRecommendedPermissions` also warns about the two new allowlist entries until the adopter adds them to `.claude/settings.json`, which canon never writes. Both are expected and match how canon-sweep shipped. AC-17 documents them.
- **Sync and docs checks.** The sync script's leak gate and `docs-refs-check`'s adopter-scope check both run on the new skill.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (full suite)
- [x] `npm run build` (the `doctor.ts` change rebuilds `dist/`; the committed `dist/` must match)
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

E2E: N/A, since canon-ai has no UI surface (`docs/architecture.md` §Validation).

## Docs Impact

`docs/codebase-map.md`: its skills row lists `CANON_OWNED` skills plus the canon-ai-local `docs-audit`. That stays accurate, because no new local skill is added. No other protected doc should go stale.

## Known Risks

- **Silent loss from implement prompts.** A pitfall reduced to a pointer, or moved, drops out of injection with no visible effect. Mitigation: the guard (AC-7) marks every such row.
- **Over-eager deletion.** An agent may label a working preventive rule as never cited. Mitigation: never-cited is only a candidate signal, every delete row shows its evidence, and the human approves per row. The prune commit record and the sweep's `git log -S` check make a mistaken deletion traceable when the lesson recurs.
- **Double deletion of a duplicated rule.** Mitigation: inventory agents never delete on "covered elsewhere", and cluster verdicts replace member verdicts (AC-4, AC-5).
- **Pointer vs. restatement misjudged.** Mitigation: the per-rule form tag, plus re-reading the source text before a merge (AC-4, AC-5).
- **A high-level canon mention misread as a mechanism.** A line like "use `/canon-spec` for new tasks" is high-level usage and stays. Mitigation: the skill gives one example of each kind, and the human approves every delete row.
- **The canon-managed list in the skill drifts from `CANON_OWNED`.** The skill names the set by kind (everything under `.canon/` except `config.json`, the `canon-*` skills, the installed review agent definitions, `docs/pipeline-orchestrator.md`), not by enumerating files. A future canon-managed doc outside those kinds would need a skill edit. The existing restatement rule in AGENTS.md §"Code Review Rules" covers that at review time.
- **Prose drift between canon-prune and canon-sweep.** References use exact headings. If `docs-refs-check` doesn't resolve skill-to-skill references, a canon-sweep heading rename breaks them silently. The implementer reports which applies.
- **A large run.** The gist lists stay small (about 520 lines for the largest adopter measured), and triage is batched per doc group. A repo much larger than that may need synthesis split by topic. Not designed now.
- **Missed listing sites.** Mitigation: AC-14's repo-wide `canon-sweep` grep.

## Human Test Plan

1. After upgrading canon in a project, run the doctor check. Expected: it reports the new prune skill as installed, and lists the two new permission entries as recommended if they aren't granted yet.
2. In a project with permanent docs, start the prune skill. Expected:
   - It lists which docs it will review, including any extra pitfall docs the patterns doc routes to.
   - It says it won't touch the lessons buffer or canon's own files.
   - It changes nothing yet.
3. Review the proposals. Expected:
   - They arrive in batches per doc group, with merges last.
   - Each row shows the exact edit, its destination and the evidence behind it.
   - Duplicates show which copy stays and which become pointers.
   - Any change that would take a pitfall out of the implementer's prompt is called out.
4. Approve some rows, reject one, and edit one. Expected: only the approved and edited rows are applied, the docs checks pass, nothing is committed, and the skill gives you a draft commit message that lists the rejected row under "Reviewed and kept".
5. Commit with that message and start the prune again. Expected: the rejected row isn't proposed again.
6. Expected throughout: no proposal deletes a summary or index table just because it repeats the names of the rules it points to, and no rule disappears from every doc at once.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row (comma-joined paths for the same change), each with a specific change description.
- [x] Plan steps (fast tier) reference actual function/file names from the codebase (N/A: full tier)
- [x] If this spec replaces existing behavior: N/A (additive; the sweep clause is an addition)
- [x] Non-Goals rules out the most tempting scope expansions; load-bearing exclusions backed by AC-3, AC-11, AC-12
- [x] Symbols named in ACs actually exist in the codebase (`CANON_OWNED`, `checkSkills`, `RECOMMENDED_ALLOW`, canon-sweep headings grep-verified)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A: feature
- [x] (Refactors) N/A: feature
- [x] *Judgment Calls* lists every judgment call with strongest alternative and Decided by
