# Implementation Plan: provider-neutral-vendor-wording

> Written by: Claude | Implements: `tasks/provider-neutral-vendor-wording/spec.md`

## Approach

A wording sweep with three tiny `src/` string edits. Spec review approved it with no nits. Work file by file. In each Affected File, read every Codex mention (`grep -n -i codex <file>`), not just the AC grep hits (Known Risks: paraphrases). Choose one of two edits for each mention:

- **Role-neutral rewrite.** Use this when the statement is about who holds a provider-dependent role: "the spec reviewer", "the implementer", "the cold lens", "the `spec_review` phase".
- **Mixed-mode qualifier on the same line.** Use this when the fact is only true of Codex ("in mixed mode", "(mixed mode)"). Keep the mixed-mode fact; don't delete it (Known Risks: mixed-mode accuracy).

Canonical mapping sentence, reused wherever a surface explains roles: *"Spec review, implementation and the orchestrator's cold code-review lens run on Codex in `mixed` mode (the default) and on Claude Code in `claude` mode, where code review uses two Claude lenses (anchored and cold)."*

Feasibility check:
- **Exists:** Confirmed by grep. Found `RUN_USAGE` (`src/orchestrator/cli.ts:6`, Codex at :13 and :61), the scope reasons (`src/lib/pipeline-policy.ts:53-54`), and their test asserts (`tests/pipeline-policy.test.ts:39,42`; `tests/run-task-code-review.test.ts:1615,1618,1682,1764,1860`). The built copies are in `dist/cli/index.js:115` and `dist/orchestrator/run-task.js:671`. Every doc and skill line cited below was read at the stated line number on `main` @ c8b2aae. `canon task set <id> provider` exists (`SETTABLE_FIELDS` in `src/task/index.ts:28`). Doctor's Codex checks are gated on `resolveProviderSetting()` (`src/cli/commands/doctor.ts:1`).
- **Real path:** `RUN_USAGE` is printed by `canon run --help` (`cli.ts:181`). `resolveCodeReviewScope()` returns `reason`, which code review writes into the `**Scope:**` line of review.md and the round or archive record. Nothing parses these reason strings: grep finds no consumer outside the tests. The template bylines aren't parsed by `src/` either (grep for `Review by|Reviewer: |Author: ` finds no hits). The fast-tier note the orchestrator writes (`src/orchestrator/phases/spec-review.ts:36`) is already provider-neutral runtime text and stays out of scope.
- **Callers:** `resolveCodeReviewScope` keeps its contract; only two literal strings change. The tests that match them are listed above, and no other src/test/doc code matches them (`grep -rn "archive record" docs .claude .canon README.md` finds only archived task files under `.canon/worktrees/`, which are not in scope).
- **Tests that can fail:** The new `tests/cli-args.test.ts` assertion `assert.doesNotMatch(RUN_USAGE, /Codex/)` fails today because of :13 and :61. The `pipeline-policy` case rows feed `prevRecord: null` (plus `previousArchiveMalformed: true`) straight into the changed branch. The new regexes fail against the old strings.
- **Predicates:** Regex boundaries. `/no round record for the previous round/` must not also match the existing `'round records for the previous round disagree…'` reason. It doesn't, because that reason has no "no " prefix and its word is plural "records". `/unparseable round record/` is unique. AC-3/AC-4 greps exempt any line containing "mixed" (case-insensitive), so a qualifier must sit on the **same physical line** as the vendor mention. In wrapped prose such as `.canon/README.md`, it has to go on the exact line that names Codex.
- **Scope:** Every file below is in Affected Files. The `templates/` hits outside mirrors are `templates/docs/patterns.md` and `templates/docs/task-quality-log.md`, and both are listed.
- **Async/stateful:** N/A.

Contradiction and spec gap (logged in `notes.md` with a `[plan]` prefix):
- AC-10's grep `"plus network access"` already returns nothing on `main`. The phrase wraps across `.canon/README.md:33-34` ("plus" / "network access"), so the grep can't fail. Step 6 rewrites the paragraph anyway. Verify AC-10 by reading.
- The concurrent task `no-base-scaffold-commit` is in code_review. Its worktree edits `src/lib/pipeline-policy.ts`, `tests/pipeline-policy.test.ts` and `tests/run-task-code-review.test.ts` near the same lines (its line numbers are offset by about 3). Whichever task merges second may need a trivial rebase. No action now.

Questions with no one to ask: none.

## Steps

### Step 1: `src/` strings and their tests (AC-1, AC-2)

Files: `src/orchestrator/cli.ts`, `src/lib/pipeline-policy.ts`, `tests/cli-args.test.ts`, `tests/pipeline-policy.test.ts`, `tests/run-task-code-review.test.ts`

- `cli.ts:13`: `'  Fast tier (XS, non-delicate only) skips the spec-review phase. Full tier (any S/M/L/XL',`. Keep the line width close to the current one; the continuation lines are unchanged.
- `cli.ts:61`: `'                      what to address. The implementer re-reads spec.md only — additions to review.md',`.
- `pipeline-policy.ts:53`: `'unparseable round record for the previous round'`. `:54`: `'no round record for the previous round'`. Change no other line. AC-2 checks this with `git diff -U0 -- src/lib/pipeline-policy.ts`.
- `tests/cli-args.test.ts`: add `RUN_USAGE` to the existing import from `'../src/orchestrator/cli.ts'` (line 11), then add:
  ```ts
  void test('RUN_USAGE names roles, not vendors', () => {
      assert.doesNotMatch(RUN_USAGE, /Codex/);
      assert.match(RUN_USAGE, /Fast tier \(XS, non-delicate only\) skips the spec-review phase/);
      assert.match(RUN_USAGE, /The implementer re-reads spec\.md only/);
  });
  ```
- `tests/pipeline-policy.test.ts:39`: `/no round record for the previous round/`. `:42`: `/unparseable round record/`. You may rename the case labels `'missing archive'` and `'unparseable archive'` to `'missing round record'` and `'unparseable round record'`.
- `tests/run-task-code-review.test.ts`: at :1615, :1682 and :1764 (the fixture string literal) change the text to `no round record` or `'no round record for the previous round'`. At :1618 and :1860 change it to `unparseable round record`. Don't rename the `review-cold-codex-run-*.md` filenames (Non-Goals).
- Check: `grep -rn "cold-Codex archive record" src tests` returns nothing. `dist` is cleared in Step 10.

### Step 2: Skills (AC-3, AC-4, AC-11)

Files: `.claude/skills/canon-spec/SKILL.md`, `.claude/skills/canon-spec-review/SKILL.md`, `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-status/SKILL.md`

**canon-spec:**
- :59: "Surprising or non-obvious constraints the implementer will need to know".
- :72: "(the implementer works against written ACs and a separate reviewer checks the code)". Alternatively, "(Codex implements against written ACs, Claude reviews, in mixed mode; in `claude` mode separate Claude sessions hold those roles)".
- :73: "enough logic/risk that a `spec_review` pass earns its keep".
- :80: leave the inline "asks Codex for review at intervals" (Non-Goals permits it).
- :165: "on full tier it catches what the `spec_review` phase tends to miss".
- :181: "on the fast tier no `spec_review` pass will catch the mismatch".
- :182: change both quoted notes to "…; spec review skipped". Keep the rest of the line.
- :196: "Invoke the pipeline: the spec reviewer reviews the spec, pipeline Claude writes the plan, the implementer implements, and pipeline Claude reviews and runs QA (in `mixed` mode Codex holds spec review and implementation; in `claude` mode every role runs on Claude Code):". Keep the trailing colon so the code block that follows still reads correctly.

**canon-spec-review:**
- :3 (frontmatter description): keep the trigger phrase `"what would Codex catch"`. Change "pre-empts Codex spec_review iterations" to "pre-empts `spec_review` iterations" and "since Codex spec_review auto-approves" to "since the fast tier auto-approves `spec_review`".
- :11: "Previews what the pipeline's `spec_review` phase would surface".
- :16: "pre-empts `spec_review` iterations".
- :17: "…the only gate before the implementer hits the spec at implement-time".
- Leave everything `tests/run-task-prompts.test.ts:709-765` asserts unchanged (`effort: high` and the charter tokens).

**canon-pipeline:**
- :15: "the Codex model/effort matrix" becomes "the model/effort matrices". This is the "matrix pointer" in Affected Files.
- :50: "the pipeline runs `spec_review` *first*, then **halts at the human spec gate after the spec reviewer approves the spec**".

**canon-status:**
- :68: `note: "implementer iterating (round N)."`

### Step 3: `.canon/templates/*` (AC-5)

Files: `.canon/templates/spec.md`, `.canon/templates/spec-review.md`, `.canon/templates/handoff.md`, `.canon/templates/review.md`

- `spec.md:3`: `> Written by: Claude | Review by: spec reviewer`. Leave everything `tests/run-task-prompts.test.ts:1069-1071` asserts unchanged.
- `spec-review.md:3`: `> Reviewer: spec reviewer | Spec: ...`.
- `handoff.md:3`: `> Author: implementer | Spec: ... | Plan: ...`. Keep the `codex_cli` version row.
- `review.md`:
  - :5: "…the implementer reads only the latest round's section to know what to address."
  - :7: "Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes …". Every physical line that names `cold-Codex` must also contain "mixed". If the paragraph is one line, it already does.
  - :17: "Did the implementer's `handoff.md` pass all applicable checks?"
  - :44: "The implementer will re-implement; …"
  - :74: "Things the implementer had to guess at because…"
  - :80: "…or, in mixed mode, `Dismissed (cold-Codex): <finding> - <reason>`."
- Don't start any line inside a fenced block with `# ` (the review.md heading parser treats it as a heading).

### Step 4: `docs/pipeline-orchestrator.md` (AC-3, AC-4, AC-8)

Don't rename any heading (keep `## Codex Model/Effort Matrix`). Edit line by line:
- :13: "Pipeline-phase agents (the Claude sessions, plus in mixed mode the Codex sessions, that the orchestrator spawns for …)".
- :15: leave it (it's about Codex as *operator*; no AC pattern).
- :17: "…lean on Codex for the phases canon assigns to it in mixed mode (spec review, implementation, and the cold code-review lens). That's canon's intended division of labor." The "(spec review, implementation, code review)" list becomes "(… the cold code-review lens)".
- :158-159 fast diagram: `Claude writes spec+plan → [human spec gate] → Implementer writes code →` / `Claude reviews code ↔ Implementer iterates → Claude writes QA summary → Human tests`. Right after the fenced block, add the canonical mapping sentence as its own line.
- :163: "- The `spec_review` phase is skipped; the human spec gate replaces it."
- :168-170 full diagram: `Claude writes spec → Spec reviewer reviews spec → [human spec gate] → Claude writes plan →` / `Implementer writes code → Claude reviews code ↔ Implementer iterates →`. Add the same mapping line after the block, or one shared note covering both diagrams placed after the full-tier block.
- :174: "- The spec reviewer runs a real spec review before the gate. …"
- :176: "Catches the class of issues the pipeline's `spec_review` would surface … gaps the `spec_review` phase tends to miss …".
- :178: "— the implementer runs them during `implement` and records outcomes in the handoff; …".
- :190: "…(including the `spec_review` phase)."
- :191: "Forces the XL bucket (in mixed mode the full Codex model; high Claude spec/plan/code-review effort, and in `claude` mode high Claude spec-review and implement effort too) regardless of nominal size." This is the `delicate` default text.
- :203: "…enough logic/risk in the spec that a `spec_review` pass earns its keep |".
- :212: "…promotes spec review and implementation to the XL cells (in mixed mode, the full Codex model), alongside stronger Claude review."
- After the `## Codex Model/Effort Matrix` heading (:216), make the first paragraph: "This matrix applies to Codex-held roles in mixed mode. In `claude` mode spec review and implementation use the Claude matrix below." Then keep "Codex model and effort come from …".
- :289 (`MAX_CONTEXT_BYTES`): "…preload injected into the implementer's implement prompt."
- :399: "- **Full tier (S/M/L/XL/delicate)**: after `spec_review` completes, before planning."
- :423: "…and, in mixed mode, an unavailable cold-Codex review park the current phase…".
- :425: "**Crashed Codex `spec_review` parks instead of advancing (mixed mode).**" Keep the rest. A Claude-provider spec-review crash is covered by :423's non-zero Claude exit.
- :427: "…the implementer may record `Fail – unrelated` …".
- :519: "…`review.md` alone is not sufficient — the spec reviewer and implementer read `spec.md` as the contract."
- :527: "If the spec reviewer returns `changes_requested` on a full-tier reroute amendment, …".
- Then run `grep -n -i codex docs/pipeline-orchestrator.md` and read every remaining hit. Hits already mixed-qualified (:228, :257, :480-488), the env-var rows (`CODEX_MODEL_*`), the version notes (:300-310) and :458 (legacy session keys) stay.

### Step 5: README (AC-6, AC-7, AC-9)

File: `README.md`. Strings pinned by `tests/cli.test.ts` must survive: the first `Claude Code (≥ X.Y.Z)` occurrence, the allowlist JSON block (the first ```` ```json ```` after `### Skip the permission prompts`), the `/init` heading, "Claude Code expands `@path` imports into context at launch", "Codex auto-loads `AGENTS.md` natively", `## Where to Go Deeper`, the discovery-nudge block, and the `| \`canon upgrade\` |` row.

- **Quick start (:20)**: keep the three-package command. Directly below the code block, add: "Codex CLI is needed for the default `mixed` provider and for `/canon-inline-review`. For Claude-only runs (`CANON_PROVIDER=claude`), `npm install -g @anthropic-ai/claude-code canon-ai` is enough."
- **Failure-mode row (:65)**: "…**`delicate: true` flag** that moves spec review and implementation to the XL cells (the full Codex model in mixed mode) and triggers extra review discipline |".
- **How it works (:68-72)**: replace "Canon orchestrates two AI coding CLIs:" and both vendor bullets with a short subsection (Decision §2, AC-6c):
  - Role list: author/architect (specs, plans), spec reviewer, implementer (code and handoff reports), code reviewer (a foreman over independent lenses), QA.
  - "**Providers.** `CANON_PROVIDER` picks who holds the roles. In `mixed` (the default), Claude Code is the author, planner, code reviewer and QA, and Codex CLI is the spec reviewer, implementer and the orchestrator's cold code-review lens. In `claude`, every role runs on Claude Code and code review uses two Claude lenses (anchored and cold). Codex-only mode is not supported. A task's provider is pinned when it is created; switch an existing task with `canon task set <id> provider <mixed|claude>`. See [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md#provider-selection) for the mechanics."
  - Independence sentence, with no cross-model claim for Claude mode: "Mixed mode gets review independence from a second model family; Claude mode gets it from separate sessions and spec-blind review lenses."
  - Keep the "A **human** is the product owner" line.
  - Ensure `grep -n "plays the \*\*implementer\*\*" README.md` returns nothing.
- **Tier bullets (:86-87)**: "skip the `spec_review` phase, human gate replaces it." and "every phase runs separately, and the spec reviewer checks specs before they reach the human."
- **`delicate` paragraph (:89)**: "…plus moves spec review and implementation to their XL cells (in mixed mode, the full Codex model); QA and, in mixed mode, the cold-Codex review lens stay on their regular cells." Both `cold-Codex` and "mixed" sit on this one line.
- **Prerequisites (:108)**: "- **Codex CLI** (default `mixed` provider and `/canon-inline-review`; not needed with `CANON_PROVIDER=claude`) — `npm install -g @openai/codex`".
- **Doctor, install section (:181)**: "it checks Node/git/Claude Code versions, allowlist coverage, and that any local Claude settings file is gitignored, plus the Codex version and codex project trust when `CANON_PROVIDER` is `mixed` or unset. Doctor checks that environment setting, not the providers pinned on existing tasks, so mixed-pinned tasks still need Codex."
- **Doctor, command table (:278)**: "Node/git versions, Claude Code (≥ 2.1.72), Codex CLI presence and codex project trust (when `CANON_PROVIDER` is `mixed`/unset), recommended-permission coverage …". Keep `Claude Code (≥ 2.1.72)` verbatim.
- **Trust model intro (:262)**: "`--interactive` opens ordinary Claude Code sessions, plus Codex sessions for Codex-held roles in mixed mode, under your own permission settings instead."
- **Claude bullet (:264)**: append "In `claude` mode spec review and implementation also run as Claude sessions under `--dangerously-skip-permissions`, with no OS-level write confinement unless you opt into the Claude sandbox below." (AC-7e)
- **Codex bullet (:265)**: "- **In mixed mode, fresh headless Codex runs use `--sandbox workspace-write`.** …". Leave the rest unchanged.
- **Privacy bullet (:268)**: "Each agent phase sends prompts and repository context to the provider running it. In mixed mode that is Anthropic for Claude phases and OpenAI for Codex phases, with mixed-mode `code_review` using both. In `claude` mode prompts and repository context go only to Anthropic; the exception is `/canon-inline-review`, which, if you use it, sends the diff to OpenAI. All of this goes through the Claude Code and Codex CLIs under whatever data terms your accounts have." Any line containing "using both" must contain "mixed".
- **New opt-in sandbox block** (AC-9): add `#### Optional: Claude Code sandbox` after the trust bullets and before the closing paragraph. It must come after the allowlist JSON block so the allowlist test's lazy match is unaffected. Content:
  - "Opt-in; canon neither scaffolds nor requires it."
  - A snippet to merge into `.claude/settings.json`:
    ```json
    {
      "sandbox": {
        "enabled": true,
        "autoAllowBashIfSandboxed": true,
        "allowUnsandboxedCommands": false,
        "excludedCommands": []
      }
    }
    ```
  - Say to list in `excludedCommands` any validation commands that need system paths and must run unsandboxed.
  - What it does under canon's headless flags, as observed on Claude Code 2.1.312: it confines Bash subprocesses only. Their writes outside the working directory and temp dir are blocked. Claude's built-in file edit tools are not covered.
  - What it doesn't do: network is **not** confined in canon's headless runs. Canon passes `--dangerously-skip-permissions`, and that flag auto-approves the sandbox's network prompts, even with `network.allowedDomains` set. Don't present `allowedDomains` as a confinement.
  - Without `allowUnsandboxedCommands: false`, a session can step outside the sandbox and be auto-approved.
  - "Behavior may change between Claude Code releases."
  - No sentence comparing it to, or claiming equivalence with, Codex's `workspace-write`.
- **Closing paragraph (:271)**: reconcile with the new block. "An opt-in Claude sandbox for shell commands exists (above). A verified default that replaces the blanket permission skip is still on the roadmap; the constraint to solve is …".
- **"Not in scope for MVP" (:406)**: "…— assumed Claude Code, plus Codex CLI in mixed mode".
- Leave :149, :157, :195, :201, :235 and the roadmap :428 (Non-Goals).

### Step 6: `.canon/README.md` (AC-10)

Lines 31-35: rewrite the paragraph as follows. "In mixed mode" must sit on the same physical line as "Codex".
```
Real checks should live in project scripts such as `package.json` commands (or
the local equivalent), not in canon-side policy modules.
In mixed mode, fresh headless Codex runs use `--sandbox workspace-write`
(writes confined to the worktree; network follows your mixed-mode Codex config)
— appropriate for the checks an `implement` phase typically runs (lint,
type-check, unit tests, build). In `claude` mode these checks run in Claude
sessions without that sandbox.
```
Every physical line that names Codex also contains "mixed". AC-3/AC-4 don't match this paragraph's wording, but AC-10's reading check does.

### Step 7: `AGENTS.md` (AC-4, AC-8)

- Roles table: keep the columns. Change the Codex row to `| Codex (mixed mode) | Implementer, spec reviewer, cold code-review lens | Code, handoff reports | Specs |`. Directly below the table, add: "In `claude` mode (`CANON_PROVIDER=claude`) every role runs on Claude Code, and code review uses two Claude lenses; see `docs/pipeline-orchestrator.md` §\"Provider Selection\"." Optionally qualify the Claude row's Reviews column ("Code").
- :38: "- Cross-review: no agent reviews its own output. In mixed mode, Claude writes specs and Codex reviews them; Codex writes code and Claude reviews it. In `claude` mode separate Claude sessions hold each side." It must still contain "Cross-review" (pinned by `tests/cli.test.ts:1905`). Line 3 stays unchanged.

### Step 8: Other docs (AC-5, AC-8, AC-9f)

- `docs/product-context.md`:
  - :35: "reviewed by the spec reviewer (full tier) or by the human (fast tier)".
  - :37: "The artifact the implementer writes after implementing…".
  - :38: "Multi-lens code review. In mixed mode the orchestrator pre-obtains a cold-Codex diff review; then a Claude foreman spawns…". Mixed must sit on the same line as `cold-Codex`.
  - :41: "skips the `spec_review` phase".
  - :90: "`spec_review` skipped (human gate replaces it). … (Claude light/medium; in mixed mode Codex implementation mini/xhigh)."
  - :91: "The spec reviewer runs spec review. In mixed mode Codex implement uses …". Keep the citations. One added clause can note that `claude` mode uses the Claude matrix's `spec_review`/`implement` rows.
  - :128: "…Mixed-mode cold review includes a cold-Codex third lens: …". Every `cold-Codex` occurrence on that line shares it with "Mixed".
- `docs/patterns.md`:
  - :10: "…pre-injects task-relevant pitfalls into the implementer's implement prompt…".
  - :252: "A returning non-interactive Codex `spec_review` crash (mixed mode)…". The qualifier just needs to be on that line.
- `templates/docs/patterns.md`: the same edit as `docs/patterns.md:10`. Edit by hand; it's an independent seed.
- `templates/docs/task-quality-log.md`:
  - :10: "→ implementer prompts or AC clarity need work."
  - :21: "First `spec_review` verdict (approved / …)".
- `docs/codebase-map.md`:
  - :97: "Claude writes; the spec reviewer reviews (full tier)".
  - :98: "Spec reviewer".
  - :100: "Implementer".
  - :117: "Pitfalls auto-injected into implementer implement prompts". The wording can be smoother.
  - :34, :73, :83 and :158 describe code, not roles; leave them.
- `docs/architecture.md`:
  - :27: "`claude` (Anthropic CLI), `codex` (OpenAI Codex CLI, mixed mode), `git`, `gh`".
  - :56: "• Spawns agent CLIs (claude; codex in mixed mode) …". Keep the box width: pad or trim spaces so the right `│` stays aligned.
  - :65: change `Codex CLI` to `Codex CLI(mixed)` or similar, at the same width. Alternatively, add a line under the diagram: "The Codex CLI box applies in mixed mode." Choose whichever keeps the alignment.
  - :82: "5. **Spec review**: the orchestrator spawns the spec reviewer (in mixed mode, `codex exec`) with the spec-review prompt and the spec file. The spec reviewer writes `spec-review.md`. …".
  - :84: "7. **Implement**: the orchestrator spawns the implementer (Codex in mixed mode, Claude in `claude` mode) with … The implementer edits files … writes `handoff.md`."
  - :111: "The spec reviewer and implementer parse `spec.md` headings; Claude parses `handoff.md`'s…".
  - :120: "(`claude`, plus `codex` in mixed mode)".
  - :127: "agent CLIs (especially the implementer during implement) run with CWD set to the worktree."
  - :170: optionally "Codex sessions (mixed mode) are similar."
  - :176: "…non-zero Claude exit, or, in mixed mode, an unobtainable cold-Codex lens…".
- `docs/decisions.md:564`: replace "The only assignment remains author/reviewer/qa → Claude and spec_reviewer/implementer/cold_reviewer → Codex." with "At this decision the only assignment was the mixed one (author/reviewer/qa → Claude, spec_reviewer/implementer/cold_reviewer → Codex); §\"Per-task provider pins and backend-tagged sessions (2026-10)\" later added the Claude assignment." Change nothing else in decisions.md.
- `docs/BACKLOG.md:11-` sandbox entry: add a sub-bullet after the 2026-09-04 probe bullets: "**Re-probed 2026-10-31 under canon's real flags (Claude Code 2.1.312, `claude -p --dangerously-skip-permissions`)**: Bash writes outside cwd/`$TMPDIR` blocked (filesystem confined); network **not** confined (the bypass flag auto-approves the sandbox's network prompts, even with `network.allowedDomains`); the `dangerouslyDisableSandbox` escape hatch is auto-approved unless `sandbox.allowUnsandboxedCommands: false`. Opt-in README documentation shipped (provider-neutral-vendor-wording). Open: network confinement under canon's headless flags." Leave the checkbox unchecked.

### Step 9: Sync mirrors

Run `npm run sync-templates`, then `npm run sync-templates:check`. Confirm that the ten mirror files in Affected Files changed and nothing else under `templates/` did (`git status --porcelain templates/`). The two hand-edited seeds (`templates/docs/patterns.md`, `templates/docs/task-quality-log.md`) aren't sync-managed. Check that sync didn't overwrite them.

### Step 10: Build and validate

Run `npm run build`. Only `dist/cli/index.js` and `dist/orchestrator/run-task.js` should change (`git status --porcelain dist/`). If another `dist/` file changes, stop and report it in the handoff: it's outside Affected Files. Then run the AC greps and the suite:

```bash
S=(README.md AGENTS.md src/orchestrator/cli.ts .claude/skills .canon/templates .canon/README.md docs/pipeline-orchestrator.md docs/product-context.md docs/patterns.md docs/codebase-map.md docs/architecture.md templates)
grep -rnE "Codex('s)? .?spec[_ ]review\b" "${S[@]}" | grep -vi mixed                       # AC-3: empty
grep -rnE "\bCodex('s)? (implements|implement prompts?|iterates|reads|re-reads|parses|may record|returns|re-implements?|writes code|reviews (the )?specs?|runs (a real )?spec review|had to guess|will)\b|Codex's .?handoff" "${S[@]}" | grep -vi mixed   # AC-4: empty
grep -rnE '(Review by|Reviewer|Author): Codex' .canon/templates templates/.canon/templates  # AC-5: empty
grep -n 'cold-Codex' README.md .canon/templates/*.md .claude/skills/*/SKILL.md docs/product-context.md docs/architecture.md | grep -vi mixed   # AC-5: empty
grep -rn "cold-Codex archive record" src tests dist                                       # AC-2: empty
grep -n "plays the \*\*implementer\*\*" README.md                                          # AC-6c: empty
grep -n "using both" README.md                                                            # AC-7a: only a line with "mixed"
git diff -U0 -- src/lib/pipeline-policy.ts                                                 # AC-2: two string lines only
git diff --quiet -- tests/run-task-prompts.golden.json tests/completion.golden.json && echo goldens-unchanged
npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check
```

These commands use zsh array syntax and run as-is in the Bash tool. Record each result honestly in the handoff's Validation Outcomes table.

## Testing Plan

- **Unit**:
  - New `RUN_USAGE` assertion in `tests/cli-args.test.ts` (Step 1).
  - Updated scope-reason regexes in `tests/pipeline-policy.test.ts` and `tests/run-task-code-review.test.ts`.
  - The existing README/AGENTS pins in `tests/cli.test.ts`, the skill pins in `tests/run-task-prompts.test.ts` and mirror parity in `tests/sync-canon-templates.test.ts` must stay green unchanged. The prompt and completion goldens must not change. If one changes, a step touched rendered prompt text, which is a Non-Goal; revert that edit.
- **Reading checks** (AC-6 to AC-11): reread README "How it works", "Getting started" and "Trust model" twice, once as a Claude-only user and once as a mixed user (Human Test Plan 1-3). Each mixed-mode fact that was true before must still be stated.
- **E2E**: N/A.
