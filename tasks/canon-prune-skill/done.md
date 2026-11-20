# Completion Summary: canon-prune-skill — Add /canon-prune: periodic multi-agent prune of the permanent docs

> For the human. This is what you need to know.

## What Changed

Adds `/canon-prune`, a skill you run by hand about monthly, or after a model-generation change. It reads the project's permanent docs (patterns, decisions, architecture, any pitfall docs the patterns doc routes to, and the agent instruction files) rule by rule. For each rule it proposes one verdict: delete, relocate, merge, or keep. Rules stated in more than one place become one merge. It writes nothing until you approve each row, and it never commits. The skill drafts a `docs: canon-prune` commit message that records what was removed and which rules you reviewed and kept, so the next run skips them unless their evidence changed. It leaves the lessons buffer and canon's own managed files alone.

Also: `/canon-sweep` gets one clause so a lesson that was once a permanent rule removed by a prune counts as a prior occurrence. The local `docs-audit` skill (canon-ai only, not shipped) gets a prune pass over canon-ai's own managed files. The skill is registered wherever the shipped skills are listed, so `canon init` and `canon upgrade` install it and `canon doctor` checks for it.

## Files Changed

- `.claude/skills/canon-prune/SKILL.md` — new skill (root copy).
- `templates/.claude/skills/canon-prune/SKILL.md` — synced mirror of the new skill.
- `.claude/skills/canon-sweep/SKILL.md` — one recurrence clause in Stage B.
- `templates/.claude/skills/canon-sweep/SKILL.md` — synced mirror of the clause.
- `.claude/skills/docs-audit/SKILL.md` — canon-ai-local prune pass over the managed set (not shipped, not in `CANON_OWNED`).
- `.claude/skills/canon-init/SKILL.md` and `templates/.claude/skills/canon-init/SKILL.md` — two allowlist entries and the high-level canon-mention guidance.
- `src/lib/canon-owned.ts` — registers the new skill as canon-managed.
- `src/cli/commands/doctor.ts` — `canon-prune` added to the skill check and to the recommended allowlist. The nudge text is unchanged.
- `dist/cli/index.js` — rebuilt output (the only `dist/` file that changed).
- `tests/cli.test.ts` — doctor coverage for the missing and present skill, and the updated skill count.
- `README.md` — skill table row, allowlist JSON block, install sentence, and one high-level canon-mention sentence after the discovery nudge.
- `.claude/settings.json` — canon-ai's own allowlist: `Skill(canon-prune)` and `Skill(canon-prune:*)`.
- `docs/lessons-learned.md` and `templates/docs/lessons-learned.md` — one sentence pointing to `/canon-prune` for the permanent docs.
- `CHANGELOG.md` — `[Unreleased]` Added and Changed entries. Not edited by QA.

## How to Test

1. In a project with permanent docs, run `/canon-prune`. Expected: it lists the docs it will review, including any pitfall docs the patterns doc routes to. It says it will not touch the lessons buffer or canon's managed files. It changes nothing yet.
2. Review the proposals. Expected: they arrive in batches per doc group, with merges last. Each row shows the exact edit, its destination and its evidence. Any row that would take a pitfall out of implement prompts is marked "removes from implement prompts".
3. Approve some rows, reject one, and edit one. Expected: only approved and edited rows change, the docs checks pass, nothing is committed, and you get a draft commit message whose "Reviewed and kept" list includes the rejected row.
4. Commit that message and run the prune again. Expected: the rejected row is not proposed again unless its text or evidence has changed. Skipped rows are listed in the run summary.
5. In a repo that has not run `canon upgrade`, run `canon doctor`. Expected: it warns that `canon-prune` is missing and lists the two allowlist entries as recommended.

## Test Results

These results are recorded in `tasks/canon-prune-skill/handoff.md` (final run after iteration 3). QA did not re-run them. Lint, type-check and build were last run in iteration 1; iterations 2 and 3 changed only Markdown and task artifacts, so they were not re-run.

| Check | Result |
|---|---|
| Lint (`npm run lint`) | Pass (iteration 1) |
| Type-check (`npm run type-check`) | Pass (iteration 1) |
| Unit tests (`npm test`) | Pass: 2,248 passed, 1 skipped, 0 failed (iteration 3) |
| E2E tests | N/A: canon-ai has no UI surface |
| Build (`npm run build`) | Pass (iteration 1); `dist/cli/index.js` is the only `dist/` change |
| Template sync (`npm run sync-templates:check`) | Pass (iteration 3) |
| Docs refs (`npm run docs-refs-check`) | Pass, "All refs OK" (iteration 3) |
| `git diff --check` | Pass (iteration 3) |

## Human Verification Required

None.

Pre-merge checklist. These items could not be confirmed in QA:

- [ ] Version correct: the version is decided at the release step, not here.
- [ ] Changelog updated if needed: the entries are drafted under `[Unreleased]`, and the release step finalizes them.
- [ ] PR body current: `tasks/canon-prune-skill/pr-body.md` was written in QA. Check it again after `--pr`.
- [ ] Final CI/CD checks green: not checked in QA.
- [ ] Final diff matches spec intent: the review and the handoff say so, but a human read of the final diff has not been done.

## Proposed Changelog

The entries below are already drafted under `[Unreleased]` in `CHANGELOG.md`. QA did not edit that file. The version and the release tier are decided at release time.

- **New `/canon-prune` skill prunes the permanent docs.** It reviews patterns, decisions, architecture, routed pitfall docs and agent files rule by rule with parallel inventory agents; proposes delete, relocate, merge or keep with evidence and human approval per row; and flags pitfalls that would leave implement prompts. It drafts a `docs: canon-prune` commit message recording reviewed-and-kept rules, and never touches the lessons buffer or canon-managed files. It is installed by `canon init` / `canon upgrade` and checked by `canon doctor`. Until you run `canon upgrade` and add `Skill(canon-prune)` and `Skill(canon-prune:*)` to `.claude/settings.json`, `canon doctor` warns about the missing skill and both missing allowlist entries. The README and `/canon-init` advise keeping canon mentions in agent files at a high level.
- **`/canon-sweep` checks whether a lesson used to be a permanent rule.** Before claiming recurrence, it runs `git log -S` on the permanent docs and counts a rule removed by a prune as a prior occurrence.

## Judgment Calls to Confirm

- New skill rather than a permanent-docs mode of `/canon-sweep` — chosen: new skill; alternative: a second mode inside canon-sweep (the cadence, multi-agent shape and inputs differ, and a mode would blur the sweep's trigger).
- Sweep change — chosen: one Stage B clause, counted only when the removing commit is marked `docs: canon-prune` or has a `Canon-Prune:` trailer; alternative: leave canon-sweep untouched and accept that recurrences cannot be traced to a prune.
- Delete criteria — chosen: the skill's own delete list, and a project duplicate is always merge, never delete; alternative: reference canon-sweep's Stage A wholesale (it would let two copies both be deleted).
- Implement-prompt guard — chosen: flag every verdict that removes a pitfall-selection source, and keep a path-citing H3 home for pitfall merges; alternative: no special handling, rely on per-row approval.
- Verb for a cheaper carrier — chosen: "relocate"; alternative: "demote", which already means a pitfall dropped by the implement-prompt size cap.
- Lessons buffer — chosen: out of scope (the sweep's job); alternative: include it so one pass covers everything.
- Agent model — chosen: a light model for inventory and apply agents, with synthesis in the invoking session; alternative: inherit the session model everywhere.

## Decisions Made

- **Section reference form.** `docs-refs-check` rejected a literal backticked heading, so the skill cites `docs/patterns.md` §"Known Pitfalls" in the resolvable form. The check resolves the reference, and the handoff records that it fails when the heading is renamed.
- **Clause wording in the sweep.** Per review round 1, a `git log -S` hit counts only when it removes the phrase in a prune-marked commit. A hit that merely adds or rewords the phrase does not count.
- **Managed files in docs-audit.** Per review round 1, the "describes a canon mechanism" delete rule and the high-level-only rule do not apply to canon-ai's managed files, since documenting those mechanisms is their job.
- **Prune record.** The commit message uses the subject `docs: canon-prune` and also a `Canon-Prune: <date>` trailer, so the lookup still works after a squash merge keeps the body.
- **Stopped after round 3.** The third review round found another selection path the guard prose missed. The foreman chose not to run a fourth implement round. It recorded the remaining gaps as follow-ups, with a note that the cold-Claude lens signalled `changes_requested` while the anchored lens approved with nits. That disagreement is real and is listed under Open Questions.

## Open Questions

- Should the four remaining guard gaps in Follow-ups (rows 1–4) block the ship, or is it acceptable to ship with them recorded as known risk? The anchored review says approve with nits. The cold-Claude lens says changes requested. The foreman chose the first.
- Should the "no new canon subcommand" non-goal be lifted so the implement-prompt guard can become a shared helper that computes the tags? The review argues that prose patches are not converging. Lifting the non-goal is a scope decision, so it is yours to make.

## Follow-ups

| Category | Follow-up | Tracked |
|---|---|---|
| risk | Adding the first H3 under a prose-only Known Pitfalls section turns off the prose fallback (`src/orchestrator/pitfalls.ts`, lines 174–189). A merge into that section drops the prose from every implement prompt with no tag. Review round 3, item 1. | untracked |
| risk | Nothing says who computes the guard tag for sections in other docs that Trigger Table rows target. The invoking session should check each non-keep row against those table targets before triage. Review round 3, item 2. | untracked |
| risk | Renaming or retitling a heading that a row targets breaks or redirects the row. `sectionHeading` in `src/orchestrator/pitfalls.ts` matches exact, then prefix. Review round 3, item 3. | untracked |
| risk | Scope discovery reads only the `Read this doc` table. The guard also treats whole-document targets in other Known Pitfalls and Trigger Table tables as sources, so a prune can skip checking them. It fails safe, since unreviewed docs are not pruned. Review round 3, item 4. | untracked |
| nit | The sweep recurrence check counts a prune relocate or merge as a removal, because `git log -S` is per file. The optional fix counts only rules listed under `Deleted:` in the prune record. Review round 2, finding 2. | untracked |
| nit | PRUNE rows for files that no regular docs-audit group owns (`.canon/README.md` and three code-review agent definitions) have no clear editing agent. Review round 2, finding 3. | untracked |
| nit | The guard over-tags tables that sit inside H3 entry bodies under Known Pitfalls (`knownPitfallsIndexTables`). It fails safe. Review round 3, optional nit. | untracked |
| nit | "A Known Pitfalls doc" as a merge home is no longer defined by the guard's list. Wording only. Review round 3, optional nit. | untracked |
| scope | The version number and changelog finalization happen at release through `/canon-changelog` and human sign-off. The `[Unreleased]` entries are drafted and need that step. | post-ship |
| observation | Move the implement-prompt guard into a shared helper that reports which implement-prompt sources an edit would remove. This would replace the prose selector and needs the no-new-subcommand non-goal lifted. Review round 3. | untracked |
| observation | Add a `canon doctor` per-file size budget warning once the first real prune runs produce data. The spec deliberately defers it. | untracked |
| observation | Run the prune on canon-ai's own docs and on an adopter repo. The spec did not run it as part of this task. | untracked |
| observation | Orchestrator prompt-template candidates surfaced by the docs-audit prune pass are listed as follow-ups, not edited (spec AC-15). Those templates are not canon-managed. | untracked |

## Quality Log

- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 2
- Validation gaps: 0
- Notes: Three code-review rounds; guard selection gaps recurred in rounds 1–2, and round 3 was approved with nits after a cold-Claude changes_requested signal.

## Root Cause

- spec-gap: the spec's implement-prompt guard named only Known Pitfalls H3s and routed-doc H3s, not routing-table rows, the no-H3 prose fallback, or Trigger Table targets, which the runtime also selects (round 1, finding 2; AC-7 Partial).
- context-conflicting: the spec said canon-managed files are never read, but the skill cites canon-sweep §"Preconditions" and §"Step 2", which live in that set (round 1, finding 1).
- context-conflicting: docs-audit applied the adopter-facing "describes a canon mechanism" delete rule to canon's own mechanism docs (round 1, finding 3; AC-15 Partial).
- execution: the sweep recurrence clause counted any `git log -S` hit, although the spec said "removed by a prune" (round 1, finding 4).
- execution: the round 2 fix listed guard surfaces one by one instead of stating the general selector, so whole-document Trigger Table targets were still missed (round 2, R2-1; fixed in round 3).
