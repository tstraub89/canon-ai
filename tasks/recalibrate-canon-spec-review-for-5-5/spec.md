# Spec: recalibrate-canon-spec-review-for-5-5 — Recalibrate canon-spec-review for the Claude 5.5 generation

> Written by: Claude | Review by: Codex
> Status: draft
> Size: S | delicate: false (an opt-in operator pre-flight skill; not phase routing, a validation gate, or pipeline policy)

## Problem

`docs/decisions.md` §"Guardrail prompts carry an implicit model-strength calibration (2026-07)" requires every review-disposition prompt to be re-checked when the default model generation changes. It names unbounded scope and "silence" framing as the patterns to look for. The Claude 5.5 audit (§"Claude prompt calibration audit (2026-09)") covered the pipeline's phase prompts and the two code-review lens charters, but not the `/canon-spec-review` skill. That skill dispatches three review sub-agents at a spec (`.claude/skills/canon-spec-review/SKILL.md:40-92`). Reading it against the audit's findings turns up five issues. This is prompt calibration confirmed by reading the files cited, not a reproduced runtime regression.

1. **Delegation and writes are unbounded.** Agents A and C are `general-purpose` (`SKILL.md:55`, `:77`), which carries Edit, Write, Agent and Skill tools. The skill's "no file writes" rule (`SKILL.md:134`) is addressed to the skill itself; the sub-agents never see it. Anthropic's Sonnet 5.5 launch notes that the model more often launched Claude Code's review skills and made out-of-scope edits. The audit bounded the code-review lenses against exactly this.
2. **Agent B runs as the wrong agent type.** Agent B is `Explore` (`SKILL.md:65`). Claude Code now describes Explore as reading excerpts rather than whole files: it locates code and does not review or audit it. Agent B's job is the audit the skill itself calls its highest-value class (`SKILL.md:73`): verifying return shapes and call sites.
3. **The preview doesn't use the reviewer's rules.** The skill claims to preview Codex `spec_review`, but it does not carry that review's scope boundary (behavior the spec's Non-Goals exclude and verify as unaffected is a nit at most) or its blocking-vs-nit definitions. The scope boundary is the fix for the 5.6-era false-blocker failure recorded in the calibration decision. Without it, a literal model can report as BLOCKING a finding Codex would call a nit. Agent A is also told to "Apply the Shape Check rubric from canon's spec_review prompt" (`SKILL.md:55`), a prompt adopters cannot open (`docs/decisions.md` §"Canon-shipped guidance never names orchestration internals").
4. **Each agent is asked to both find and filter.** One calibration line tells every agent to stay silent unless a finding would cause real problems (`SKILL.md:51`). Each agent also assigns severity, and the synthesizer re-classifies (`SKILL.md:96-100`). The code-review calibration split these jobs: lenses report everything they find ("Coverage is your job; filtering is not.") and the foreman filters. Under the current wording a literal model can drop exactly the STRONG findings the report exists to surface early.
5. **The Affected Files check misses the parser's rule.** Check C3 (`SKILL.md:82`) asks only whether changed files are listed and context-only files are not. The orchestrator finds the table only under an exact `### Affected Files` H3 inside `## Design` or `## Amendment` (`src/orchestrator/markdown-table.ts:174`, `src/orchestrator/validation.ts:1081-1090`). Omitted generated or rebuilt outputs are a recurring late-gate failure (`docs/patterns.md` §"Declare `templates/` mirrors…").

Smaller drift in the same file:
- Diff review is pointed at raw `codex review` (`SKILL.md:20`, `:145`), not `/canon-inline-review`.
- The trivial-patch anti-pattern (`SKILL.md:142`) predates XS as the pipeline floor.
- The example at `SKILL.md:136` is a war story, not a rule.

## Decision

1. **One shared read-only lens charter.** Add `.claude/agents/spec-review-lens.md`, a canon-managed charter named `spec-review-lens`. All three angles dispatch to it.
   - **Tools:** exactly `Read`, `Grep`, `Glob`, `Bash`. The missing Agent and Skill tools bound delegation structurally; the missing Edit and Write tools remove direct edits. Bash stays because some Claude surfaces (the desktop app among them) expose no Grep or Glob tool; the previous `general-purpose` and `Explore` types had Bash too, so no new permission prompts result.
   - **Bash is read-only by instruction.** Only read-only commands (searching, listing, printing file ranges, read-only git history), with no redirects, in-place edits, or state-changing git.
   - **Stays in its lane.** The lens reviews the spec itself, spawns no sub-agents, invokes no skills, writes no files, runs no `canon` commands, and asks the user nothing.
   - **Grounding.** Every finding cites `file:line` or an AC number. A claim about code must come from re-opening the current file, not from memory.
   - **Coverage first.** The lens reports every finding it can back with a citation, each tagged with a severity. Filtering is the synthesizer's job. `[NO FINDINGS]` is a valid return, not a failure.
   - **Severity definitions** match Codex spec_review:
     - **BLOCKING:** would cause wrong behavior or a silent bug, or makes an AC unimplementable as written.
     - **NIT:** an implementation detail the implementer resolves by reading the codebase, a minor ambiguity with an obvious default, or a question the plan phase should answer.
     - **STRONG** (this skill only): nit-grade under those rules, but likely to cost a review round, so cheaper to fix now.
   - **The scope boundary** is carried with its full predicate. Behavior the spec's Non-Goals *explicitly exclude and verify as unaffected* is a NIT at most. The carve-out does not cover a change the spec should make but omitted (a required caller, parser, migration or test surface), a transitive effect of the change, or an internal contradiction between spec sections; those stay BLOCKING.
   - **Return format.** The charter owns the finding format the skill currently defines (`SKILL.md:44-49`).
2. **The skill dispatches and synthesizes.**
   - **Dispatch.** Step 2 sends a single message with three Agent calls, all `subagent_type: spec-review-lens`. Each call carries the spec inline plus its angle's scope and rubric. The angle rubrics stay in the skill:
     - A's four shape questions, stated inline. The pointer to the spec_review prompt is removed.
     - B's ground-truth verification, now by reading whole functions and call sites.
     - C's nine checks.
   - **Missing charter.** If the Agent tool rejects the `spec-review-lens` type, the skill stops and tells the human to run `canon upgrade` and then start a new Claude Code session, since agent types may load only at session start. It does not fall back to another agent type.
   - **The skill carries the rules synthesis applies.** The session running the skill never loads the lens charter, so SKILL.md states the same severity definitions and the same full-predicate scope boundary as Decision §1. The two files hold matching copies, and AC-3 pins both.
   - **Synthesis owns the silence default.** Step 3 does four things:
     - drops findings with no citation;
     - downgrades findings that fall inside the scope boundary;
     - de-dupes;
     - re-classifies on the strongest evidence.

     The per-agent calibration line is removed; silence is the default only for what reaches the report.
3. **Check C3 matches the parser.** The Affected Files table sits under a heading that is exactly `### Affected Files`, inside `## Design` (or an `## Amendment`). It lists every file the change writes, including generated mirrors and rebuilt outputs. Files read only for context stay out. A mismatched heading or a missing generated output is BLOCKING, because a pipeline gate rejects it later.
4. **Smaller drift.**
   - Both diff-review pointers name `/canon-inline-review`.
   - The trivial-patch anti-pattern is phrased around XS.
   - The war-story example (`SKILL.md:136`) is deleted.
5. **Registration.** Add the charter to `CANON_OWNED`, so `canon init` scaffolds it and `canon upgrade` installs it. Mirror both managed files into `templates/`, and rebuild `dist/`.
6. **Decision record.** The §"Claude prompt calibration audit (2026-09)" entry gains a short paragraph. It records that the `/canon-spec-review` sub-agents now run under one read-only `spec-review-lens` charter, with delegation bounded by its tool list, a coverage-first lens, and synthesis-side filtering.

## Non-Goals

- No change to the three-angle topology (shape / factual / spec-quality), the inline-report output shape, or the "no file writes, operator owns the decision" contract.
- No cold-Codex angle or other cross-family lens.
- No change to Codex's spec_review prompt, the code-review charters, or any pipeline prompt.
- No change to other skills that use `Explore` or `general-purpose` sub-agents (`/canon-spec`, `/canon-init`).
- No `model` or `effort` pin in the charter; the lens inherits from the session.
- No change to the skill's `effort: high`. After this change synthesis carries the filtering judgment, and the lenses may inherit the session's effort, so lowering it would weaken both.
- No `canon doctor` check for the charter.
- No new permission grants in the README block or `canon init`'s recommended allow list.
- No rewrite of the skill's descriptions in `docs/pipeline-orchestrator.md`, `README.md`, or other skills' Related sections. They stay accurate: three parallel sub-agents, structural / factual / spec-quality.

## Acceptance Criteria

**Rule for all prose ACs:** tests assert stable keyword tokens, not full sentences, and read files from `process.cwd()` (`docs/patterns.md` §worktree runs). Wording around the tokens is free. These assertions prove the text is present, not that a model will behave accordingly; the handoff must not claim otherwise.

- [ ] **AC-1: Charter tools bound delegation and writes.** A test reads `.claude/agents/spec-review-lens.md` and asserts:
  - frontmatter `name: spec-review-lens`;
  - the frontmatter tool list is exactly `Read`, `Grep`, `Glob` and `Bash`, in any order, and names no other tool (Agent, Skill, Edit and Write in particular).
- [ ] **AC-2: Charter body carries the lens contract.** The same test asserts tokens for each element of Decision §1:
  - Bash read-only use;
  - no sub-agents and no skills;
  - no file writes;
  - citation of `file:line` or AC number;
  - coverage first, with filtering left to the synthesizer;
  - `[NO FINDINGS]` as a valid return.
- [ ] **AC-3: Severity and scope boundary, full predicate, in both files.** For each of `.claude/agents/spec-review-lens.md` and `.claude/skills/canon-spec-review/SKILL.md`, the test asserts the file:
  - defines `BLOCKING`, `STRONG` and `NIT`;
  - states the scope boundary with both conditions: explicit exclusion (matching `/explicitly exclude/` or `Non-Goals`) and verification (matching `/verif\w* (as )?unaffected/`);
  - names the three exclusions: an omitted required change, a transitive effect, and an internal contradiction.

  The test also asserts that no line of either file states the carve-out with only one of the two conditions (`docs/patterns.md` §predicate integrity).
- [ ] **AC-4: Skill dispatches only to the charter.** A test reads `.claude/skills/canon-spec-review/SKILL.md` and asserts:
  - it contains `subagent_type: spec-review-lens` (or an equivalent unambiguous `spec-review-lens` dispatch for all three angles);
  - it matches none of `/general-purpose/`, `/\bExplore\b/`, or `/Shape Check rubric/`;
  - it keeps `Name effects to DELETE` and `Prefer positive or structural assertions`, so the existing AC-11 assertion at `tests/run-task-prompts.test.ts:855-857` still passes;
  - it names the missing-charter stop (`canon upgrade`).
- [ ] **AC-5: Silence default moved to synthesis.** A test asserts:
  - the skill no longer matches `/Calibration applied to every angle/`;
  - the synthesis step names the uncited-drop, scope-boundary downgrade, and de-dupe filters, each by a stable token.
- [ ] **AC-6: C3 matches the parser.** A test asserts that the skill's check C3 names:
  - the literal `### Affected Files` heading;
  - `## Design`;
  - generated or rebuilt outputs.
- [ ] **AC-7: Smaller drift.** A test asserts:
  - skill frontmatter still `effort: high`;
  - the skill contains `/canon-inline-review` and does not match `/codex review --/`;
  - the trivial-patch anti-pattern row mentions `XS`;
  - the skill matches neither `/worktree-canonical-task-state/` nor `/~15-min/`.
- [ ] **AC-8: Registration and mirrors.**
  - `src/lib/canon-owned.ts` `CANON_OWNED` contains `.claude/agents/spec-review-lens.md`.
  - `npm run sync-templates` produces `templates/.claude/agents/spec-review-lens.md` and updates `templates/.claude/skills/canon-spec-review/SKILL.md`, and `npm run sync-templates:check` passes. The leak gate means neither file may cite canon-internal orchestrator paths or internal-only prompt-template basenames.
  - `npm run build` is run and `dist/cli/index.js` contains `.claude/agents/spec-review-lens.md`, verified by a grep recorded in the handoff.
- [ ] **AC-9: Decision record.** `docs/decisions.md` §"Claude prompt calibration audit (2026-09)" gains the Decision §6 paragraph, verified by a grep for `spec-review-lens` inside that section, recorded in the handoff. `npm run docs-refs-check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `.claude/agents/spec-review-lens.md` | New shared read-only lens charter (Decision §1) |
| `templates/.claude/agents/spec-review-lens.md` | Generated mirror (new) |
| `.claude/skills/canon-spec-review/SKILL.md` | Dispatch to `spec-review-lens`, inline angle rubrics, severity definitions and scope boundary for synthesis, synthesis-side filtering, C3 extension, missing-charter stop, smaller drift (Decision §2–§4) |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Generated mirror |
| `src/lib/canon-owned.ts` | Add `.claude/agents/spec-review-lens.md` to `CANON_OWNED` |
| `dist/cli/index.js` | Rebuilt bundle (carries `CANON_OWNED`) |
| `tests/run-task-prompts.test.ts` | New structural test for AC-1–AC-7, beside the existing charter tests |
| `docs/decisions.md` | AC-9 paragraph (root-only doc; no mirror) |

### Implementation Notes (non-binding; owned by plan/implement)

- Claude Code sub-agent frontmatter takes a comma-separated `tools:` allowlist. The existing code-review charters declare none, so this is the first charter that restricts tools; the plan should confirm the field's syntax.
- The charter is modeled on `.claude/agents/code-review-cold.md`: a frontmatter `description` saying who dispatches it, a short role paragraph, then the rules and return format.
- The four shape questions and the blocking/nit and scope-boundary text can be paraphrased from Codex's spec_review prompt, but neither shipped file may cite that prompt's path or filename.

### Interaction Dependencies

- `canon upgrade` writes every `CANON_OWNED` file whose template exists and whose project copy is absent or different (`src/cli/commands/upgrade.ts:364-383`). Adopters therefore receive the charter and the updated skill in the same upgrade. A repo that vendors canon without running `canon upgrade` gets neither, or only the skill if files are copied by hand. The missing-charter stop (Decision §2) makes that failure loud rather than a silent fallback.
- The existing AC-11 structural test reads the skill for two Agent C tokens (`tests/run-task-prompts.test.ts:855-857`); both survive.
- The charter ships to adopters, so the adopter-scope guard in `docs-refs-check` and the `sync-templates` leak gate both apply to its text.
- The skill's own `allowed-tools` already grants `Agent` with no type restriction, so it needs no change.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run sync-templates:check` (after `npm run sync-templates`)
- [x] `npm run docs-refs-check`

## Docs Impact

- `docs/decisions.md`: the AC-9 paragraph, listed in Affected Files.
- The other protected docs are unaffected. `docs/pipeline-orchestrator.md`'s description of the skill stays accurate.

## Known Risks

- **Coverage-first floods the report.** Moving the silence default to synthesis could let noise through. The synthesizer's uncited-drop and scope-boundary downgrade are the counterweight, and `[NO FINDINGS]` stays explicitly valid, so the lens is not pushed to invent findings (the opposite 5.6-era failure).
- **Bash as a write path.** The read-only limit on Bash is prompt-level only. The structural bound covers what the Sonnet 5.5 note flagged (launching reviewers and review skills) and removes Edit and Write. A lens could still write through Bash against instructions; the skill's inline report and `git status` would make that visible to the operator.
- **The scope-boundary predicate drops a conjunct.** A shortened "if Non-Goals mention it, it's a nit" would widen the carve-out beyond Codex's and hide real blockers. AC-3 pins every conjunct and exclusion.
- **Old skill against new charter, or the reverse.** A partially upgraded adopter could have one without the other. A new skill with no charter stops loudly. An old skill with the new charter present never references it, so it is harmless.
- **The frontmatter `tools:` syntax is wrong or unsupported.** The lens would then either get no tools or silently inherit all of them. The plan confirms the syntax. The Human Test Plan exercises a real dispatch and checks that the lenses could read and search files.
- **Paraphrase drift from spec_review, or between the two copies.** The inlined definitions can diverge from Codex's prompt over time, and the charter and skill copies can diverge from each other. AC-3 pins the load-bearing tokens in both files. This is accepted: shipped guidance may not point at the prompt. The calibration rule already requires re-checking both at the next model bump.

## Human Test Plan

1. Start a new Claude Code session on this repo (so the new reviewer type is loaded) and run `/canon-spec-review` against a spec that has already been written, such as this task's spec.
2. Confirm the skill says it is dispatching three reviewers, and that all three return findings or an explicit "no findings".
3. Confirm the factual reviewer's findings cite specific file locations, showing it could search and read the code.
4. Confirm the report groups findings as BLOCKING, STRONG and NIT and ends with a recommendation.
5. Confirm a finding about behavior the spec explicitly rules out in Non-Goals is not reported as BLOCKING.
6. After the run, confirm the working tree shows no new or modified files.
7. Expected: the same report shape as today, with every reviewer staying read-only and none launching further reviewers or skills.
