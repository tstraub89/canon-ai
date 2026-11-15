# Spec: ship-followup-capture — Capture done.md follow-ups at human review

> Written by: Claude | Review by: spec reviewer
> Status: draft

## Problem

QA records work that should happen after a task ships ("follow-ups") as prose in done.md, mostly under *Open Questions*. Nothing reads that prose again. Whether an item becomes tracked work depends on someone acting on it in a sitting with the human.

A trace of every QA-completed task in canon-ai and one adopter repo (628 archived tasks, 301 candidate done.md lines, 117 genuine follow-ups) found:

| Outcome | Count |
|---|---|
| Already tracked (issue or backlog entry) before ship | 41 |
| Tracked after ship | 22 |
| Never tracked, fixed later anyway | 7 |
| Never tracked, never fixed | 33 |
| Unclear | 14 |

- Of the 22 tracked after ship, nearly all landed within minutes to hours of ship. They were filed because the human asked, or the operator session offered and the human said yes. Nothing that missed that window was picked up later.
- The items that died were mostly soft-worded: "worth a follow-up task if it matters", "consider a follow-up issue", "needs a human to track". They were usually QA's own observations, plus some deferred review nits. Two were spot-checked as still live in the current tree.
- Stale-doc cleanups that done.md assigns to the operator after ship survived (26 of 28). They have an owner and a fixed moment: the post-ship docs commit.

So the loss is not a missing record. QA writes the items down. The loss is that nothing turns each item into a decision while the human is present.

Separately, *Open Questions* mixes "decide this" with "someone should do this later". The template text ("Anything that still needs your input or a follow-up task.") invites the second kind into a section nobody parses.

Two constraints shape the design:

- **The decision point is human_review, not `--ship`.** `--ship` usually runs non-interactively from an agent session's shell tool, and its subprocesses run with stdin closed, so a ship-time prompt would almost always be skipped. Human_review is a sitting where the human already reads done.md.
  - It is also where "fix this in this task instead" is still possible, via `--reroute`.
  - Decisions recorded there go into done.md on the task branch, so they ship in the task's own PR, with no extra base commit.
- **Backlog entries can't be written on the task branch.** A changed backlog file outside the spec's Affected Files blocks the gate that runs before `--pr` pushes. Writing it on base before ship leaves an unpushed non-scaffold commit, which blocks the next `--pr` and `--ship`. Backlog entries and other operator doc edits therefore stay in the post-ship docs commit the operator already makes; `--ship` names them.

## Decision

Make follow-ups a parseable table in done.md. At human_review, the operator session puts each one to the human and records the outcome in the table. `--ship` then lists what is left to write after the merge, plus anything still undecided.

1. **done.md gets a `## Follow-ups` section**, placed immediately after `## Open Questions`. It holds a three-column table, `| Category | Follow-up | Tracked |`, or the single line `None.` when there is nothing to list.
   - **Category** is one of: `correctness`, `risk`, `spec-gap`, `nit`, `scope`, `observation`.
   - **Follow-up** is one line saying what remains and why it matters. A literal pipe inside a cell is written `\|`.
   - **Tracked** is one of four things:
     - `untracked`: not yet decided.
     - `dropped`: decided not to do.
     - `post-ship`: to be written on base after the merge, as a backlog entry or a doc fix.
     - a reference to where it is tracked: a link, an issue reference such as `#42`, or another canon task written as `task:<id>` (for example `task:follow-up-task`). A bare task id is not a reference, because a bare slug cannot be told apart from free text such as `tbd`.
2. **Open Questions narrows to decisions only.** Its template guidance says it holds things that need the human's decision. Work recommended for later goes in Follow-ups.
3. **QA's inclusion rules.** QA lists:
   - Every handoff Blocker that describes work outside this task's scope, and every AC whose final status is Partial. Category `scope`. A Blocker labelled `[spec-gap]` gets category `spec-gap`.
   - Every code-review finding not resolved by the final review round, including findings the implementer recorded as deferred. The category follows the reviewer's labelling in review.md:
     - Correctness Bugs or `correctness bug` → `correctness`
     - Risk / Guardrails or `risk/guardrail` → `risk`
     - Spec Gaps → `spec-gap`
     - Optional Cleanup / Nit → `nit`
     - a later-round finding with no category label: QA picks the closest of those four, defaulting to `risk` when unsure.

     Nits are included; QA does not filter by worth.
   - Every edit QA leaves for the operator outside the task's scope, including each item it reports under *Docs drift*. Category `scope`, Tracked `post-ship`.
   - Every piece of later work QA itself recommends. Category `observation`. QA must not phrase later work as an Open Question.
   - Tracked starts as `untracked`, except for the `post-ship` rows above and items QA can see are already tracked, which get their reference.

   The section is required. A task with nothing to list writes `None.`
4. **QA cannot finish without a parseable Follow-ups section.** The qa phase gate rejects a done.md that lacks the section or whose table cannot be parsed, the same way it rejects an unfilled template. QA repairs it in the normal way. The gate is the same one `canon task phase <id> qa done` goes through.
5. **The canon-pipeline skill gives the operator a human_review step**, before `--pr`. For each `untracked` row:
   - Put it to the human with four options: file it now, write it after merge (`post-ship`), drop it, or fix it in this task (`--reroute` with an amendment). Offer nits as one batch.
   - Before filing, confirm the item is still open.
   - File accepted items the project's way. If the project has no evident convention, ask the human where.
   - Record the outcome in the Tracked cell of the task's done.md. Those edits ride in the task's PR like any task artifact.
6. **`--ship` lists what is left.** For each shipped task, after merge proof and before the task directory is archived, `--ship` reads the Follow-ups table from the task's done.md. After its final "Shipped" line it prints up to two blocks, grouped by task id, each row showing its category and text:
   - **Post-ship follow-ups:** rows whose Tracked cell is `post-ship`, ending with one line telling the operator to write them in the post-ship docs commit.
   - **Untracked follow-ups:** rows still `untracked`, ending with one line telling the operator to put them to the human.

   Other rules for this step:
   - A block with no rows is omitted.
   - The step never prompts, files anything, edits files, commits, or changes the exit code.
   - A missing done.md, a missing Follow-ups section, or a table it cannot parse produces one warning naming the task, and the ship continues.
   - It runs on the normal merge path and on the externally-merged resume path, for every task in a bundle.
7. **Row classification is fail-safe.**
   - A Tracked cell is read case-insensitively, ignoring surrounding whitespace and backticks.
   - Exactly `dropped` or `post-ship` means that state. A value that looks like a reference is tracked: a URL, `#<number>`, a markdown link, or `task:` followed by a valid canon task id (the same rule `canon task` applies to ids).
   - A bare word, including one shaped like a task id, is not a reference. `follow-up-task` and `tbd` both count as `untracked`; `task:follow-up-task` counts as tracked. `task:` followed by something that is not a valid task id (for example `task:` alone or `task:Foo Bar`) counts as `untracked`.
   - Anything else, including an empty cell or text such as `untracked (needs issue)`, counts as `untracked`. So an unclear row is shown rather than lost.
   - A row whose category is not one of the six values is still listed, with its category shown as written.
   - A row with the wrong number of cells makes the table unparseable.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Who turns follow-ups into decisions | The operator session, prompted by the skill; canon only lists | Canon prompts per item when stdin is a terminal and files with `gh issue create` or a configured backlog path | `--ship` usually runs without a terminal, so a prompt would almost always be skipped. All 22 successful filings happened in an operator sitting. Filing mechanics and config stay out of canon. | `Human` |
| When the decision happens | At human_review, before `--pr` | After `--ship`, with outcomes written back to the archived done.md | A post-ship write-back is a base commit that, left unpushed, blocks the next `--pr` and `--ship`. Human_review already has the human reading done.md, records decisions inside the task's PR, and still allows `--reroute`. | `Human` |
| Where backlog entries get written | In the operator's post-ship docs commit, listed by `--ship` as `post-ship` rows | Exempt the backlog file from the Affected Files check so entries go on the task branch | The post-ship docs commit is already how the human edits the backlog. An exemption needs a configured path and makes parallel task PRs conflict on the backlog file. | `Human` |
| Where follow-ups live | A separate `## Follow-ups` section; Open Questions narrows to decisions | Tag follow-up lines inside Open Questions | Mixed prose is what let soft items die; a dedicated section gives every item an explicit state | `Human` |
| Nits | Included, labelled `nit`, offered as one batch | Exclude nits, or let QA filter by worth | The QA model is too small to trust with "worth fixing" calls; the human judges, and batching keeps it fast | `Human` |
| Recording outcomes | A Tracked column in the table | No record beyond the issue or backlog entry itself | Makes "how often do follow-ups get dropped" a grep instead of a manual trace | `Human` |
| Missing or unparseable section at QA | The qa phase gate rejects it, so QA repairs it | Warn only at `--ship` | A ship-time warning comes after QA can repair anything; the gate catches it while QA is still running, and the ship warning stays as a backstop | `Author` |
| Unclear Tracked values | Treated as `untracked` (shown) | Treat as a reference (hidden) or reject the table | Showing an unclear row costs one question; hiding it is the silent loss this task exists to stop | `Author` |
| How a task-id reference is written | An explicit `task:<id>` prefix, recognized from the text alone | A bare id counted as tracked when it names an existing task directory, live or archived | The task id rule also matches free text like `tbd` or `todo`, so a bare id is ambiguous. A directory lookup depends on where the parser runs and on archive layout; the prefix is deterministic and keeps unclear values on the shown side | `Author` |
| When the blocks print | After the final "Shipped" line, with rows read before archive | Print as each task is read | The end of output is where an operator reads the result. Rows are lost if ship dies after archiving (see Known Risks). | `Author` |
| Category vocabulary | Fixed set of six values | Free-text category | A fixed set lets the operator batch nits and lets later audits group rows | `Author` |
| Docs drift items | Each also gets a `scope` / `post-ship` Follow-ups row | Leave them only in the Docs drift section | One list is what the operator works from; Docs drift keeps the detail | `Author` |
| How the QA rules get tested against real tasks | A one-off replay in the Human Test Plan, in a scratch copy of the repo | An automated test with a recorded model run | It checks model behavior once; a recorded-model fixture would freeze one output and test nothing about future runs | `Author` |

## Non-Goals

- Canon never prompts, files issues, writes to a backlog, or commits for follow-ups. There is no `gh issue` invocation and no new `.canon/config.json` key (AC-12).
- No exemption from the Affected Files check for a backlog file.
- `--ship` never fails or exits non-zero because of follow-ups (AC-8).
- No canon command that lists or queries follow-ups across archived tasks.
- No backfill of already-archived done.md files.
- No change to review.md categories, to how reviewers rate findings, to the handoff template, or to the human_review gate (including the `Acknowledged:` waiver).
- No change to `pr-body.md` content.
- Full-send is not changed. It skips the human_review stop, so its follow-ups are not decided before the PR. `--ship` still lists them as untracked.

## Acceptance Criteria

- [ ] AC-1: The done.md template has a `## Follow-ups` section immediately after `## Open Questions`.
  - It shows the `| Category | Follow-up | Tracked |` header, the six categories, the four Tracked forms (with the reference form's examples, including `task:<id>`), `\|` escaping, and the `None.` form.
  - The Open Questions guidance no longer mentions follow-ups: a case-insensitive search for `follow-up` in the template's Open Questions section returns no hits.
  - The canon-managed mirror is identical (`npm run sync-templates:check` passes).
  - The shipped template is still detected as an unfilled template and still contains no `Acknowledged:` waiver line (existing tests stay green).
- [ ] AC-2: The QA prompt instructs QA to write the Follow-ups section using Decision items 3 and 1: the four sources, the category mapping (including the later-round default and `[spec-gap]` Blockers), nits included without worth filtering, Docs drift items as rows, the starting Tracked values (a reference to another canon task written as `task:<id>`), `\|` escaping, `None.`, and no later work phrased as an Open Question.
  - The prompt's done.md section lists include Follow-ups.
  - A prompt test asserts that the QA prompt names the Follow-ups section and the `post-ship` and `nit` values.
  - The prompt golden fixtures are regenerated, and the prompt tests pass.
- [ ] AC-3: A done.md Follow-ups parser returns rows as category / text / tracked-state triples, with tracked state one of `untracked`, `dropped`, `post-ship` or `tracked`. Unit tests cover:
  - a valid table with every Tracked form
  - the `None.` form (zero rows, not an error)
  - a missing section (reported distinctly from zero rows)
  - a table whose header does not match, and a row with the wrong cell count (both reported as unparseable)
  - Decision item 7's classification: case and backtick insensitivity, empty and free-text cells counting as `untracked`, URL, `#<n>`, markdown-link and `task:<id>` references counting as tracked, a bare task-id-shaped word (such as `follow-up-task`) and a malformed `task:` value counting as `untracked`, and an unknown category kept as written
  - an escaped `\|` inside a cell
  - a table inside a fenced code block or HTML comment, which is ignored
  - a Follow-ups heading appearing twice, where the last one wins
- [ ] AC-4: The qa phase gate rejects a done.md with no Follow-ups section, or with an unparseable one, and accepts one with a valid table or `None.`. The same result applies through `canon task phase <id> qa done`. Tests cover all four cases.
- [ ] AC-5: `--ship` on a task whose Follow-ups table has `untracked`, `post-ship`, `dropped` and reference rows completes normally (merge, archive, exit 0). After its final "Shipped" line it prints:
  - a block whose heading contains `Post-ship follow-ups`, listing exactly the `post-ship` rows, followed by its operator instruction line
  - a block whose heading contains `Untracked follow-ups`, listing exactly the `untracked` rows, followed by its operator instruction line

  Verified by an integration test using the ship fixture harness.
- [ ] AC-6: `--ship` on a task whose section is `None.`, or whose rows are all `dropped` or references, prints neither block and no follow-up warning.
- [ ] AC-7: `--ship` for a bundle of two tasks, each with untracked rows, lists both tasks' rows in one block, grouped by task id.
- [ ] AC-8: `--ship` completes with exit 0, archives the task, and prints exactly one follow-up warning naming the task, for each of three states:
  - no Follow-ups section (the stub done.md the ship fixtures write)
  - an unparseable table
  - no done.md file (the fixture deletes it after setup)

  Each case is covered by a test.
- [ ] AC-9: The ship listing also runs on the externally-merged resume path. A test where the PR is already merged before `--ship` runs shows the `Untracked follow-ups` block.
- [ ] AC-10: The ship listing makes no file, git or `gh` changes.
  - In the AC-5 test, the archived done.md is byte-identical to the done.md on the task branch.
  - The fake `gh` invocation log contains no `issue` subcommand.
- [ ] AC-11: The canon-pipeline skill (and its mirror) documents the human_review step in Decision item 5: the four options, nits as one batch, confirm still open, file the project's way or ask, record in the Tracked cell before `--pr`. It also says what to do with each of the two `--ship` blocks.
  - It names no canon-internal source path (`npm run sync-templates:check` passes, including its shipped-guidance leak gate).
- [ ] AC-12: No new top-level or `ship.*` key is accepted by the `.canon/config.json` parser: an existing config test with an extra key still reports it as unknown. A search of `src/` for the pattern `'issue'` returns no hit in a `gh` argument list.
- [ ] AC-13: These surfaces describe the new behavior consistently, and this list is the complete set of surfaces that restate `--ship` or the done.md section contract:
  - the `--ship` usage text
  - the `--ship` flag row and the numbered ship-order list in the pipeline orchestrator doc (and its mirror), with step numbering consistent
  - the README `--ship` descriptions
  - the codebase map, with the new parser module
  - the product context's human flow, with the human_review follow-up step

  `npm run docs-refs-check` and `npm run sync-templates:check` pass.
- [ ] AC-14: `docs/decisions.md` gains an entry recording:
  - follow-ups are a parseable done.md table, required at QA
  - decisions happen at human_review, recorded in the table
  - `post-ship` rows are written in the operator's post-ship docs commit and listed by `--ship`
  - canon itself never prompts or files, because `--ship` runs non-interactively and tracking conventions are adopter-specific

## Design

### Affected Files

| File | Change |
|---|---|
| `.canon/templates/done.md`, `templates/.canon/templates/done.md` | Add `## Follow-ups` after Open Questions; narrow Open Questions to decisions |
| `src/orchestrator/prompts/templates/qa.md` | Follow-ups in the done.md section lists; inclusion rules, category mapping, starting Tracked values; no later work in Open Questions |
| `tests/run-task-prompts.golden.json` | Regenerate the QA prompt golden entries |
| `tests/run-task-prompts.test.ts` | Assert the QA prompt names Follow-ups, `post-ship` and `nit` |
| `src/orchestrator/followups.ts` | New: the Follow-ups table parser and row classification |
| `src/orchestrator/validation.ts` | qa phase gate rejects a missing or unparseable Follow-ups section |
| `src/orchestrator/main.ts` | In `shipTasks`, read follow-ups per task after merge proof and before archive (both merge paths); print the two blocks after the final "Shipped" line; one warning per missing or unparseable section |
| `src/orchestrator/cli.ts` | Mention the follow-up listing in the `--ship` usage text |
| `tests/followups.test.ts` | New: parser unit tests (AC-3) |
| `tests/run-task-validation.test.ts` | qa gate tests (AC-4) |
| `tests/run-task-ship-docs-fold.test.ts` | Ship integration tests (AC-5 through AC-10) |
| `tests/run-task-ship-helpers.ts` | Let ship fixtures write a custom done.md or remove it after setup (the stub always writes one) |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Add the human_review follow-up step and what to do with the two `--ship` blocks |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Update the `--ship` flag row and the numbered ship-order list |
| `README.md` | Update the `--ship` descriptions |
| `docs/codebase-map.md` | Add the parser module |
| `docs/product-context.md` | Add the human_review follow-up step to the human flow |
| `docs/decisions.md` | New decision entry (AC-14) |
| `dist/` | Rebuilt bundle output for the source changes |

### Implementation Notes (non-binding; plan/implement own these)

- **Parser:** use the fence- and comment-aware table scanners in the markdown-table module (`scanAllTables`, or `scanTableBlocks` over the visible-lines helper), restricted to the last `## Follow-ups` body. Classify the table by its header row. `parseTable` does not fit: it is first-match, not fence-aware, and needs the heading line.
- **qa gate:** the qa phase gate config currently runs `isDoneMdTemplate` as its custom check. The Follow-ups check composes with it. Confirm which repair route the existing gate rejection feeds (artifact fixup vs. operator), and that salvage paths go through the same gate.
- **Where ship reads done.md:** the repo-root task directory, after the pull and merge proof, before the per-task archive loop. Keep rows in memory. Nothing in this step may call `die`.
- **Existing tests:** every existing ship test's stub done.md lacks the section, so it will now print the missing-section warning. Confirm no existing test asserts an empty stderr. Fixtures that drive QA through the qa → done gate need a done.md with the section.
- **Template wording:** no new template line may begin with `Acknowledged:` or reintroduce the template-detection sentinel strings.

### Interaction Dependencies

- **human_review gate:** reads done.md only for `Acknowledged:` lines. Unaffected.
- **qa gate and its repair route:** gains a check (AC-4). In-flight tasks whose QA ran before this change are already past the gate and only see the ship warning.
- **`--reroute` from human_review:** a "fix it in this task" answer uses the existing reroute. QA reruns and rewrites the table.
- **`/canon-changelog`:** reads done.md's Proposed Changelog by heading. Unaffected.
- **docs-refs-check:** scans done.md, so backticked paths in Follow-ups rows must exist or use the markdown-link form QA already uses.
- **Telemetry fold at `--ship`:** the follow-up read adds no failure mode after the fold.

### Data Model Changes

- done.md gains a `## Follow-ups` table with Category, Follow-up and Tracked columns, a fixed category vocabulary, and Tracked values `untracked`, `dropped`, `post-ship` or a reference.
- No `status.json` or `.canon/config.json` change.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` (source changes affect `dist/`; commit the rebuilt output)
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] `<E2E>` — N/A, no end-to-end surface

## Docs Impact

- `docs/architecture.md`: the QA step description may want a mention of the Follow-ups section. It doesn't contradict the new behavior, so it is not in AC-13.

QA checks this.

## Known Risks

- **QA under-fills the section.** The gate guarantees the section exists, not that it's complete; the QA model may still leave later work in prose. The Human Test Plan replay checks real behavior on past tasks. If it shows misses, the fallback is a larger model for QA, outside this task.
- **The new qa gate blocks QA.** A parser bug would reject valid done.md files and stall QA for everyone. AC-3 and AC-4 test the accepted forms, including `None.`.
- **Noise.** With nits included, a long list could train a reflexive "drop all". Batching nits keeps it to one answer for all of them.
- **The operator skips the human_review step.** The skill is prose. `--ship` still lists untracked rows, with an instruction line, as a backstop.
- **Full-send tasks** skip human_review, so their follow-ups first surface at `--ship`, as untracked.
- **`post-ship` rows never written.** The row stays `post-ship` in the archive, so the miss is visible in a later audit, which is better than today.
- **Ship dies after archiving.** If the archive commit or push fails, the rows read earlier are never printed, and a re-run can't find the task. This is accepted as rare. The done.md in the archive still holds the table.
- **Pipes in cell text.** An unescaped `|` changes the cell count and makes the table unparseable. The qa gate catches this, so QA fixes it.

## Human Test Plan

1. Finish a task through QA. Confirm its completion summary has a Follow-ups table with a category and a status for each item, or says there are none.
2. At human review, in a Claude session:
   - Confirm the session asks you about each undecided follow-up, offering nits as one group, with four choices: file now, write after merge, drop, or fix in this task.
   - Pick a mix of answers. Confirm the table shows each outcome, and that those edits are part of the task's PR.
3. Ship the task. Confirm the ship ends with a short list of the "write after merge" items and an instruction to write them in the post-ship docs commit. Confirm undecided items appear in a separate list, and decided ones don't appear.
4. Ship a task with no follow-ups. Confirm neither list appears.
5. **Replay check on the QA step.** In a scratch copy of the repository that you will throw away, run the updated QA step against about five past tasks whose follow-ups we already traced. Include the one with the delicate-toggle gate bypass, the one about resuming a parked implement phase, and the one with the batch of worktree-link review nits.
   - Expected: every item that was later dropped appears in the new table, and review nits appear labelled as nits.
   - If items are missing, note which kinds, so the QA model choice can be revisited.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design` and at most one per `## Amendment…` section (a behavior-only amendment needs none), with one file per row: comma-join extra paths for the same change in the first column, put notes in the Change column, and never put a second backticked token in a first-column note (directory entries ending in `/` are fine). Marking the spec done enforces this format, and canon re-checks it before planning and implementation. Each row has a specific change description.
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] If this spec replaces existing behavior: frame it as one replacement ("replace X with Y; X must not exist after") and add a structural/grep AC when practical; use paired add/remove bullets only when true replacement framing doesn't fit
- [x] Non-Goals rules out the most tempting scope expansions; back load-bearing exclusions with a positive scope-bound or grep AC, not prose "NOT" alone
- [x] Symbols named in ACs actually exist in the codebase (grep-verify before marking spec done)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`). `- [ ]` is a placeholder; the spec author flips required checks to `- [x]` before marking spec done. The orchestrator's code_review pre-flight blocks if no `[x]` items are present.
- [x] (Bug/flake fixes; N/A for features/refactors) N/A — feature
- [x] (Refactors; N/A for features/bug fixes) N/A — feature
- [x] *Judgment Calls* lists every judgment call the spec makes, each with its strongest alternative and a Decided by value (`Human` or `Author`), or says `None — <reason>`

## Amendment

Code review round 1 found three surfaces the original Affected Files missed. All three follow from the new qa gate (AC-4).

**Problem (AC-15 mechanism, confirmed by trace).** The mechanism is deterministic. When QA streams done.md to stdout instead of writing it, the QA phase runner salvages the text, writes it to done.md, and calls `taskPhase(<id>, 'qa', 'done')` directly when the session did not block itself. With this task's change, `qa done` runs the qa evidence gate, which now returns a rejection when the Follow-ups section is missing or unparseable (the `followupsProblem` check in the phase gate). `taskPhase` throws on a rejected gate, and the salvage path has no handler, so the exception escapes the phase runner, the orchestrator exits, and qa stays `in_progress`. How it was confirmed: both Claude code-review lenses traced this path independently in round 1; the implementer reproduced it (the salvage fixtures in the providers and routing safety tests, given salvaged content without the section, fail through this throw); and the operator re-read the gate and `taskPhase` call chain on the task branch. No runtime-dependent factor is involved, so a trace plus fixture repro is sufficient evidence.

- [ ] AC-15: When QA's done.md is salvaged from captured stdout and the qa gate rejects it (for example, no Follow-ups section), the QA phase does not throw. It prints a warning with the gate's rejection message, leaves the salvaged done.md on disk, and leaves qa not done, so the run stops through the existing "phase did not reach done" path rather than crashing. The existing blocked-session rule is unchanged and checked first: if the QA session marked qa `blocked`, salvage only restores done.md and qa stays `blocked` whether or not the salvaged file would pass the gate. Otherwise a salvaged done.md that passes the gate still advances qa → done as before. Verify (red-first): a QA salvage regression test, written first, fails on the pre-fix salvage path because the gate rejection throws out of the QA phase runner, and passes after the fix. It asserts no throw, qa status not `done`, the warning printed, and done.md written; the existing salvage tests (with a valid section added) still advance qa to done, and the existing blocked-session salvage test still leaves qa `blocked`.
- [ ] AC-16: The five existing QA fixtures that supply done.md content without a Follow-ups section (one in the base-drift safety tests, three salvage cases in the providers safety tests, one in the routing safety tests) gain a valid section (`None.` is fine) and pass unchanged otherwise. Verify: `npm test` passes in full.
- [ ] AC-17: The canon-pipeline recovery guide's manual `canon task phase <task-id> qa done` recipe states that done.md must contain a valid Follow-ups section, consistent with the main skill. Verify: the recovery guide and its mirror name the section; `npm run sync-templates:check` passes.

### Affected Files

| File | Change |
|---|---|
| `src/task/index.ts` | Export the phase-gate error prefix as a shared constant so the salvage catch does not match a duplicated string (human_review nit, fixed inline) |
| `src/orchestrator/phases/qa.ts` | Catch a qa gate rejection on the stdout-salvage path: warn with the message, keep done.md, leave qa not done (AC-15) |
| `tests/run-task-safety-providers.test.ts` | Add a valid Follow-ups section to the three salvage fixtures; add the AC-15 rejected-salvage test |
| `tests/run-task-safety-base-drift.test.ts` | Add a valid Follow-ups section to the QA artifact fixture |
| `tests/run-task-safety-routing.test.ts` | Add a valid Follow-ups section to the QA salvage fixture |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Note that `qa done` requires a valid Follow-ups section (AC-17) |
