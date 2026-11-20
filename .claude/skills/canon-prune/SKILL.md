---
name: canon-prune
description: Use when the human asks to prune, trim, slim, or dedupe the project's permanent docs or "the canon" (`docs/patterns.md`, `docs/decisions.md`, `docs/architecture.md`, any pitfall docs they route to, and the agent instruction files) — phrases like "prune the docs", "trim the canon", "the permanent docs are bloated", "find duplicated rules", or explicit `/canon-prune` invocation. Human-invoked only; run it about monthly or after a model-generation change, never on an entry count. Gives every rule a verdict (delete, relocate, merge, or keep), shows the human every proposed change plus a count of kept rules, and writes nothing until the human approves each proposed change. Not for the lessons-learned buffer (`docs/lessons-learned.md`), which is `/canon-sweep`'s. Canon-managed files are not prune input; the skill reads only the two canon-sweep sections named in its workflow as operating instructions.
allowed-tools: Read AskUserQuestion Agent Glob Grep Edit Write Bash(git log *) Bash(git show *) Bash(git status *) Bash(git branch *) Bash(git diff *) Bash(git worktree list) Bash(canon task list) Bash(node scripts/docs-refs-check.mjs*)
effort: medium
---

# Permanent-Docs Prune

`/canon-sweep` decides what enters the permanent docs; `/canon-prune` decides what leaves them. Every line is read by agents, so dead and duplicated rules cost attention on every task.

## When to use

Run only when the human asks, about monthly or after a model-generation change. Never start on your own; no entry count or size threshold triggers a run.

## Scope

In scope: `docs/patterns.md`, `docs/decisions.md`, and `docs/architecture.md`; every non-managed document listed in the `Read this doc` / `Before touching` table directly under `docs/patterns.md` §"Known Pitfalls", if the project keeps that table (discover destinations by reading it, never from a fixed list); and `AGENTS.md` and `CLAUDE.md`, if the project keeps them. If a routed destination is canon-managed, it remains out of scope and is not read.

Out of scope: `docs/lessons-learned.md`, which belongs to `/canon-sweep`; and, as prune input, every file canon manages: everything under `.canon/` except `config.json`, the `canon-*` skills, the review agent definitions canon installs under `.claude/agents/`, `docs/pipeline-orchestrator.md`, the guard hook canon installs, and the docs-refs checker script canon installs. Canon-managed files are never reviewed, inventoried or edited as prune input. The only canon-managed text this skill reads is the two canon-sweep sections named below, solely as operating instructions.

## Verdicts

- **delete** — obsolete, superseded, enforced by a check, self-evident, or describes a canon mechanism.
- **relocate** — the same rule in a cheaper carrier, such as moving it from an always-loaded agent file to a just-in-time doc, or from a doc to a one-line comment at the code site.
- **merge** — one home for a rule stated more than once, with every other copy reduced to a pointer or removed.
- **keep** — the rule stays as is.

A rule that duplicates another project rule is never a `delete`; it is a `merge`.

## High-level canon mentions only

Keep canon mentions in agent files and docs at a high level: that the project uses canon, and how and when (which skills or flows to use for what, and where the project's own canon conventions live). Don't copy canon's mechanisms (what canon injects into prompts, how phases route, what a gate checks, which files canon reads) into them: canon's own docs carry those, and a copy goes stale when canon changes.

A project convention such as “Use `/canon-spec` for new features” stays. A statement such as “canon injects only the Known Pitfalls section into implement prompts” describes a canon mechanism and gets `delete`. For a mixed rule that states the project's own pitfall-routing convention and also explains how canon injects pitfalls, propose an edit that keeps only the project convention. Make this call without reading canon's files.

## Implement-prompt guard

`docs/patterns.md`, and every doc that one of its tables points to, can feed implement prompts. Which parts get selected is canon's concern, and it can change; this skill doesn't try to predict it. Mark every non-keep verdict that edits one of those docs with the literal tag **removes from implement prompts** in its triage row, so the human checks it before approving. The tag means the edit may change what implement prompts receive, not that it certainly does. A pitfall `merge` keeps its home as a path-citing H3 in a Known Pitfalls doc.

## Default stance: remove and measure

Removal or movement is cheap and reversible through git; no step requires proving a rule unneeded before proposing removal. Ablation means rerunning the original failure scenario with a subagent given the docs minus that rule. Offer it only when the human requests it for a specific high-stakes rule; it is never the default. Measure through the Step 6 prune record and `/canon-sweep`'s `git log -S` recurrence check.

## Step 1 — Preconditions and scope

Triage is read-only. At run start, read the latest prune record as described in Step 6, before launching inventory agents. Discover and tell the human which in-scope docs will be reviewed, including routed pitfall docs; state that the lessons buffer and canon-managed files will not be used as prune input. Change nothing. For the apply preflight, only the three check bullets in `.claude/skills/canon-sweep/SKILL.md` §"Preconditions" apply; its step numbers and separate “Read before triaging” list belong to the lessons sweep and are not part of this workflow. These three checks are operating instructions, not prune input.

## Step 2 — Inventory and evidence

Launch one read-only `Agent` per doc group together, using a light model (for example `sonnet`). The default groups are:

1. `docs/patterns.md` plus its routed pitfall docs;
2. `docs/decisions.md`;
3. `docs/architecture.md` plus the agent instruction files.

Each agent must not edit or commit and must never read canon-managed files. Split docs into rules: heading-level entries, table rows, or bullets carrying an instruction. Return one row per rule with: location (`<doc path> :: <heading>`, plus ` :: <row key>` for a table row, using its first cell); form, exactly `rule` (states the requirement in full) or `pointer` (an index, trigger, quick-reference row, or one-line “see X”); a one-line gist; all six evidence items below; and a proposed verdict with exact replacement text, or `delete`.

Evidence for every rule:

1. **Provenance** — the adding commit and, if the project archives tasks, task, using `git log -S` / `git log -G`.
2. **Still true** — whether named paths, symbols, commands, and flags still exist.
3. **Describes canon** — whether it describes how canon itself works; use “High-level canon mentions only.”
4. **Enforced now** — whether a test, lint check, hook, or gate catches the mistake.
5. **Superseded** — whether a later decision replaced it, including an inline “superseded” annotation.
6. **Citations** — whether task artifacts since it landed cite it or record tripping over it. Never-cited is only a candidate signal.

Inventory agents never propose `delete` because a rule is covered by another project doc; they flag the overlap, and Step 3 decides.

## Step 3 — Cross-doc comparison

In the invoking session, compare gists of `rule`-form entries only; `pointer` entries are never duplicates. Before proposing a merge, reread every source entry in a candidate cluster and confirm the requirements match. Choose the home using `.claude/skills/canon-sweep/SKILL.md` §"Step 2 — Choose the smallest carrier"; a routed pitfall doc is a valid pitfall home. Reduce every other copy to a one-line pointer or remove it. The cluster's `merge` verdict replaces its members' inventory verdicts, so two copies are never both deleted. Summary and index tables are pointers: do not delete one merely because it repeats the names of rules it points to.

## Step 4 — Triage with the human

First state how many rules end Step 3 with a `keep` verdict in each doc group (after merges replace member verdicts), and show that keep list if the human asks; any kept rule can be turned into a proposal there. Then present one verdict table per doc group for deletes and relocates, then all merges as one final table, with one row per non-keep verdict. Within each table, pre-marked “previously kept” rows come last. Each delete, relocate, and merge row shows the exact edit, destination, and evidence, plus the implement-prompt guard tag where it applies. Suggested columns: `| # | Location | Verdict | Edit / destination | Evidence | Guard |`.

Ask with `AskUserQuestion` for each batch. The human approves, flips, or edits each row individually; nothing is written before approval. Rejected rows become “Reviewed and kept” entries for Step 6. Offer ablation only if the human asks for it on a specific row.

## Step 5 — Apply and validate

Run those same three preflight checks immediately before applying. Apply approved rows with file-disjoint editing agents on a light model: no two agents edit the same file, and the invoking session makes shared edits afterward. Always run docs validation: the shipped docs-refs checker, if the project has it, and any docs check listed in the validation section of `docs/architecture.md`. If any non-doc file changed, such as for a code-comment relocation, also run the project's full validation commands from that section. These project-specific validation commands may prompt for permission. Do not commit.

## Step 6 — Prune record

Draft a commit message in this exact shape:

```text
docs: canon-prune (<a> deleted, <b> relocated, <c> merged, <d> reviewed and kept)

Deleted:
- <doc path> :: <heading>[ :: <row key>] — <one-line reason>
Relocated:
- <doc path> :: <heading>[ :: <row key>] → <destination> — <reason>
Merged:
- <home doc path> :: <heading> ← <other locations> — <reason>

Reviewed and kept:
- <doc path> :: <heading>[ :: <row key>]  | proposed: <verdict> | evidence: <the evidence items that drove the proposal> | kept because: <reason>

Canon-Prune: <YYYY-MM-DD>
```

At run start, look up the latest record with `git log -1 --format=%H --grep='^docs: canon-prune' --grep='^Canon-Prune:'`. The patterns are ORed, so the trailer still finds a squash-merged record. Read it with `git show <sha>`. The record never hides a rule. In Step 4, any non-keep row at a location that a “Reviewed and kept” entry names (doc path, heading, and row key for a table row) is shown pre-marked “previously kept on <record date>: <kept because>” at the end of its table. The mark is information only: the human still decides each row individually. Pre-mark a row only when it is not a merge row, exactly one current rule sits at that location, and exactly one record entry names it; show every other row unmarked, in ordinary triage. The new record's “Reviewed and kept” list holds the rules kept in this run only. A rule that wasn't triaged this run simply loses its marking; it is never hidden. Create no log file.

Hand back the counts and follow-ups such as code-comment relocations needing review, then present the drafted message. Do not commit.

## What this skill does not do

It does not touch the lessons buffer, use canon-managed files as prune input, start on a schedule or size threshold, commit, or run ablation by default. Its only reads from canon-managed files are the two canon-sweep sections identified as operating instructions in Steps 1 and 3.
