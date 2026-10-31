# Spec: provider-neutral-vendor-wording — Make user-facing role and vendor wording match CANON_PROVIDER

> Written by: Claude | Review by: spec reviewer
> Status: draft

## Problem

canon 3.16 added `CANON_PROVIDER=mixed|claude`. `docs/pipeline-orchestrator.md` §"Provider Selection" and its `CANON_PROVIDER` env-var row are the source of truth:
- `mixed` (the default) keeps Claude as author, planner, code reviewer and QA, and Codex as spec reviewer, implementer and orchestrator cold code-review lens.
- `claude` runs every role on Claude Code. Code review uses two Claude lenses (anchored and cold sub-agents). Codex is not required and doctor skips the Codex project-trust check.
- Codex-only mode is not supported.

The provider-mode task (tstraub89/canon-ai#135) changed the rendered prompts and operator messages. It deliberately left user-facing prose to this follow-up (its Non-Goals: README, skills, `.canon/templates/*`, `AGENTS.md`, CLI help, doc prose). The Codex PR bot then flagged README and CLI-help statements that are false for a `claude`-provider user:

- **README.md.** The install line and Prerequisites present Codex as required. "How it works" says Codex *is* the implementer and spec reviewer. The tier and `delicate` lines say Codex reviews specs and that `delicate` moves Codex to the full model. Both `canon doctor` descriptions say it checks Codex and codex project trust unconditionally. The trust model presents the Codex `--sandbox workspace-write` bullet as unconditional. The privacy bullet says code goes to OpenAI and that "`code_review` using both" providers, which is false in Claude mode, where only Anthropic receives code.
- **`src/orchestrator/cli.ts` `RUN_USAGE`.** Says the fast tier "skips Codex spec review" and that "Codex re-reads spec.md" on reroute.
- **`src/lib/pipeline-policy.ts` scope reasons.** The strings `'unparseable cold-Codex archive record for the previous round'` and `'no cold-Codex archive record for the previous round'` can render into a Claude-mode `review.md` **Scope:** line. Claude mode writes `review-round-N.md` round records instead of cold-Codex archives (`ROUND_RECORD_PREFIX` in `src/orchestrator/review-archive.ts`), and the archive scan reads both families, so these strings can surface in a run where no Codex lens exists.
- **Skills.**
  - canon-spec: "Codex implements against written ACs", "a Codex `spec_review` pass earns its keep", "Codex reviews the spec, then … Codex implements", the "Codex spec review skipped" approval note, and others.
  - canon-spec-review: "previews what Codex's `spec_review` phase would surface", "pre-empts Codex spec_review iterations".
  - canon-pipeline: "halts at the human spec gate after Codex approves the spec".
  - canon-status: "Codex iterating (round N)".
- **`.canon/templates/*`.** Bylines "Review by: Codex" (spec.md), "Reviewer: Codex" (spec-review.md) and "Author: Codex" (handoff.md). review.md says "Codex reads only the latest round's section" (line 5), "Did Codex's `handoff.md` pass", "Codex will re-implement" and "Things Codex had to guess at". It also describes three lenses including "a cold-Codex lens … from a different model family" without qualification.
- **`.canon/README.md`.** Says canon runs Codex with `--sandbox workspace-write` "(writes within the worktree, plus network access)". This contradicts the README, which says network is off unless the user's Codex config enables it. `src/orchestrator/agents/codex.ts` passes only `--sandbox workspace-write` and sets no network override, so the README is right.
- **`docs/pipeline-orchestrator.md`.** About 35 unqualified lines:
  - The fast- and full-tier diagrams ("Codex implements", "Codex iterates", "Codex reviews spec").
  - "Codex `spec_review` is skipped" and "Codex runs a real spec review".
  - The sizing rows.
  - "promotes Codex spec review and implementation to the full model".
  - "Codex runs them during `implement`".
  - The "Codex as operator" closing line ("lean on Codex for the phases canon assigns to it").
  - The `MAX_CONTEXT_BYTES` row ("injected into Codex's implement prompt").
  - The operator section's opening ("Claude and Codex sessions spawned by the orchestrator").
  - The `/canon-spec-review` bullet ("Codex's spec_review would surface … tends to miss").
  - The park, failure and reroute prose: "after Codex `spec_review` completes", "an unavailable cold-Codex review", "**Crashed Codex `spec_review` parks…**", "Codex may record `Fail – unrelated`", "If Codex returns `changes_requested`…".
- **`AGENTS.md`.** The Roles table has a "Codex — Implementer, spec reviewer" row. Shared Norms says "Claude writes specs; Codex reviews specs. Codex writes code; Claude reviews code."
- **`docs/product-context.md`.** Glossary rows (Spec: "reviewed by Codex"; Handoff: "the artifact Codex writes"; Review: "pre-obtains a cold-Codex diff review"; Tier: "skips Codex spec review"), the tier bullets, and the near-term roadmap line about the cold-Codex third lens.
- **Smaller sites.** `docs/patterns.md` and its adopter seed `templates/docs/patterns.md` ("pre-injects … pitfalls into Codex's implement prompt"). The `templates/docs/task-quality-log.md` seed. The template "Author" column and "Pitfalls auto-injected into Codex implement prompts" in `docs/codebase-map.md`. In `docs/architecture.md`: the external-CLI list and diagram (which present `codex` as always driven), the spec-review and implement steps ("Codex spec review", "orchestrator spawns Codex"), "especially `codex` during implement", and "an unobtainable cold-Codex lens". The `docs/patterns.md` checkAndRoute pitfall ("A returning non-interactive Codex `spec_review` crash"). The stale sentence in `docs/decisions.md` §"Phases route by role through agent backends (2026-10)" saying the only assignment is spec_reviewer/implementer/cold_reviewer → Codex, which §"Per-task provider pins and backend-tagged sessions (2026-10)" superseded.

The README trust model also omits the opt-in Claude sandbox that the provider-mode spec deferred here. The `docs/BACKLOG.md` probe (2026-09-04, Claude Code 2.1.252/2.1.260, headless `-p` under the default permission mode) found the following. `sandbox.enabled` plus `autoAllowBashIfSandboxed` in `.claude/settings.json` let a write inside cwd and `npm --version` run, blocked `curl` with a network-outbound violation, and blocked a write outside cwd. It should ship as an opt-in adopter setting, with `sandbox.network.allowedDomains` / `excludedCommands` as the escape hatches, not as a default. That probe did not run under `--dangerously-skip-permissions`, which canon's headless Claude sessions always pass. While writing this spec (2026-10-31), I re-ran it under canon's real flags: Claude Code 2.1.312, headless `claude -p --dangerously-skip-permissions`, in a throwaway repo whose `.claude/settings.json` enabled the sandbox, with a control run in default mode.
- **Filesystem writes are confined.** A Bash write to a path in `$HOME` outside the repo failed with "operation not permitted" in both modes. Writes inside the repo and under `$TMPDIR` succeeded.
- **Network is not confined under the bypass flag.** `curl` to example.com/example.org succeeded under `--dangerously-skip-permissions`, both with no network settings and with `sandbox.network.allowedDomains` limited to one unrelated domain. The default-mode control denied the same request with a `deny network-outbound` sandbox violation. The bypass flag evidently auto-approves the sandbox's per-domain network prompts.
- **The escape hatch is auto-approved by default.** A Bash call with `dangerouslyDisableSandbox: true` wrote outside the repo. With `sandbox.allowUnsandboxedCommands: false` the same call was refused and the write failed.

So in canon's headless runs the opt-in sandbox is a filesystem-write fence for Bash, provided `allowUnsandboxedCommands` is false. It is not a network fence. The README's closing trust paragraph already says narrower confinement "is on the roadmap"; it must be reconciled with the new text.

## Decision

Make every user-facing statement about who does what true under both providers. Do not change any behavior.

1. **Name roles, not vendors, where the holder depends on the provider.** "The spec reviewer", "the implementer", "the cold lens". Each surface that explains roles states the mapping once: in `mixed` (default) Codex holds spec review, implementation and the orchestrator cold code-review lens; in `claude` every role runs on Claude Code and code review uses two Claude lenses. Vendor names stay where a statement is only true of one provider, and such a line names that provider's mode on the same line ("in mixed mode").
2. **README gets a short provider subsection** in "How it works". It replaces the two-bullet "Claude Code is the architect / Codex CLI is the implementer" framing with the role list and the `mixed`/`claude` mapping, says how to pick one (`CANON_PROVIDER`, pinned per task at creation, switchable with `canon task set <id> provider`), says Codex-only mode is not supported, and links `docs/pipeline-orchestrator.md` for mechanics. It must not imply that Claude mode has cross-model review independence (`docs/decisions.md` §"Claude-provider review independence (2026-10)"). Claude mode gets independence from separate sessions and spec-blind lenses.
3. **README setup and trust statements are provider-conditional.**
   - Install line and Prerequisites: Codex CLI is needed for `mixed` (the default) and for `/canon-inline-review`, which wraps `codex review` under either provider. It is not needed for `claude`.
   - Both `canon doctor` descriptions: Codex presence and codex project trust are checked when `CANON_PROVIDER` is `mixed` (the default).
   - Trust model: the Codex sandbox bullet applies to mixed mode, and the model says plainly that in `claude` mode spec review and implementation also run as Claude sessions under `--dangerously-skip-permissions`, with no OS-level write confinement by default. The privacy bullet says what each provider sends where: mixed sends to Anthropic and OpenAI, with mixed-mode `code_review` using both. Claude mode sends only to Anthropic, except that `/canon-inline-review`, if used, sends the diff to OpenAI.
4. **README documents the opt-in Claude sandbox** as a trust-model bullet or short subsection: what it is, a `.claude/settings.json` snippet (`sandbox.enabled`, `sandbox.autoAllowBashIfSandboxed`, `sandbox.allowUnsandboxedCommands: false`), and `excludedCommands` for validation commands that must run unsandboxed. It states plainly what it does and does not do under canon's headless flags, per the Problem's probe: Bash writes outside the working directory and temp dir are blocked; network is not confined, because `--dangerously-skip-permissions` auto-approves the sandbox's network prompts; the escape hatch must be closed with `allowUnsandboxedCommands: false`; Claude's built-in file edit tools are not covered. It is opt-in, and canon neither scaffolds nor requires it.
5. **CLI help and the two scope-reason strings become provider-neutral.** `RUN_USAGE` says the fast tier skips the spec-review phase and that the implementer re-reads `spec.md` on reroute. The scope reasons say "round record" instead of "cold-Codex archive record".
6. **Fix the `.canon/README.md` network contradiction** to match README: Codex network follows the user's Codex config. Also mark that paragraph as mixed mode.

## Non-Goals

- **Any behavior change.** No argv, prompt, routing, policy-value or default changes. The only `src/` edits are the `RUN_USAGE` text and the two scope-reason strings (AC-1, AC-2).
- **Renaming identifiers or files that contain "codex"**: `review-cold-codex*.md`, `CODEX_MODEL_*`, legacy session keys, the `status.json` `canon.codex_cli` field and `agent: "codex"` template defaults, and the "Codex Model/Effort Matrix" heading (it stays accurate as the mixed-mode Codex matrix; AC-8 adds a lead sentence).
- **Changing the README permission allowlist block.** It is pinned equal to `RECOMMENDED_ALLOW` (which contains `Bash(codex *)`) by `tests/cli.test.ts`.
- **Making the Claude sandbox a default**, scaffolding it from `canon init`/`upgrade`, adding a doctor check for it, or replacing `--dangerously-skip-permissions`.
- **Implying Codex-only support**, or implying Claude mode has cross-model review independence.
- **Rendered prompt templates** in `src/orchestrator/prompts/templates/`. They are already provider-gated by #135, and `tests/run-task-prompts.golden.json` stays unchanged.
- **`AGENTS.md` line 3** ("scaffolds a Claude + Codex spec-driven pipeline"). It is pinned by `tests/cli.test.ts`, and mixed is the default.
- **Mentions of Codex that stay true under both providers**:
  - `/init` in "Claude Code or Codex".
  - "Codex auto-loads `AGENTS.md` natively".
  - `/canon-inline-review` and `codex review` text.
  - canon-spec's description of inline work ("asks Codex for review at intervals").
  - canon-spec-review's quoted trigger phrase "what would Codex catch".
  - The README roadmap Phase 2 line naming Codex CLI among pluggable implementers. (The "Not in scope for MVP" adapter line, "assumed Claude Code + Codex CLI", does change: AC-6(e).)
- **canon-ai's own `docs/task-quality-log.md`**, which records canon-ai's historical mixed-mode runs (telemetry, not guidance); only the adopter seed `templates/docs/task-quality-log.md` changes.
- **Allowlist explanations that list `codex` among commands canon may drive** (README "Skip the permission prompts" intro, canon-init SKILL.md allowlist step). They describe the shared `RECOMMENDED_ALLOW` set, which includes `codex` under either provider.
- **`docs/decisions.md`** beyond the one stale sentence in AC-8. Historical decision headings (e.g. §"Fast tier (XS non-delicate) skips Codex spec review") keep their titles.

## Acceptance Criteria

Surface set **S** for the grep ACs: `README.md AGENTS.md src/orchestrator/cli.ts .claude/skills .canon/templates .canon/README.md docs/pipeline-orchestrator.md docs/product-context.md docs/patterns.md docs/codebase-map.md docs/architecture.md templates`. A hit that also contains "mixed" (case-insensitive) on the same line is a permitted mode-qualified statement.

- [ ] **AC-1 — `RUN_USAGE` is provider-neutral.** `RUN_USAGE` in `src/orchestrator/cli.ts` contains no `Codex`. It still says the fast tier (XS, non-delicate) skips the spec-review phase, and that on reroute the implementer re-reads `spec.md` only, not review.md or PR comments. Verify with a new assertion in `tests/cli-args.test.ts` that `RUN_USAGE` does not match `/Codex/`, plus the existing usage tests passing.
- [ ] **AC-2 — Scope reasons are provider-neutral.** `grep -rn "cold-Codex archive record" src tests dist` returns nothing (test fixtures carrying the old string change too). The two scope reasons in `src/lib/pipeline-policy.ts` now say "round record" (e.g. `'no round record for the previous round'`) and keep their meaning. The tests that assert the old strings (`tests/pipeline-policy.test.ts`, `tests/run-task-code-review.test.ts`) assert the new ones. No other `pipeline-policy.ts` line changes (`git diff -U0 -- src/lib/pipeline-policy.ts` shows only those two string lines).
- [ ] **AC-3 — No unqualified "Codex spec review".** `grep -rnE "Codex('s)? .?spec[_ ]review\b" <S> | grep -vi mixed` returns nothing. The word boundary leaves "Codex spec reviewer" unmatched; the optional `'s` catches the possessive form.
- [ ] **AC-4 — No unqualified Codex role-holder verbs.** `grep -rnE "\bCodex('s)? (implements|implement prompts?|iterates|reads|re-reads|parses|may record|returns|re-implements?|writes code|reviews (the )?specs?|runs (a real )?spec review|had to guess|will)\b|Codex's .?handoff" <S> | grep -vi mixed` returns nothing.
- [ ] **AC-5 — Artifact templates name roles.** `grep -rnE '(Review by|Reviewer|Author): Codex' .canon/templates templates/.canon/templates` returns nothing. The bylines name the role (e.g. "Review by: spec reviewer", "Author: implementer"). review.md's lens description says the cold-Codex lens is present in mixed mode and that Claude mode has the anchored and cold-Claude lenses only. Its `Dismissed (cold-Codex)` instruction says it applies in mixed mode, and its line-5 per-round note names the implementer. `grep -n 'cold-Codex' README.md .canon/templates/*.md .claude/skills/*/SKILL.md docs/product-context.md docs/architecture.md | grep -vi mixed` returns nothing.
- [ ] **AC-6 — README setup and doctor statements are conditional.** In `README.md`:
  - (a) Prerequisites and Install state that Codex CLI is required for `mixed` (the default) and for `/canon-inline-review`, and not for `CANON_PROVIDER=claude`. The install command still shows how to install all three packages, or shows a Claude-only variant next to it.
  - (b) Both `canon doctor` descriptions (Install section and command table) say Codex presence and codex project trust are checked only when `CANON_PROVIDER` is `mixed`/unset, and at least one says doctor checks that environment setting, not providers pinned on existing tasks (so mixed-pinned tasks still need Codex). The command-table text still contains `Claude Code (≥ 2.1.72)`, which the floor test pins.
  - (c) A provider subsection under "How it works" covers everything in Decision §2, including the sentence that Codex-only mode is not supported. It replaces the two vendor bullets; `grep -n "plays the \*\*implementer\*\*" README.md` returns nothing.
  - (d) The tier and `delicate` lines (failure-mode table row, tier bullets, `delicate` paragraph) describe spec review and implementation by role, and give the mixed-mode full-model promotion as a mixed-mode statement.
  - (e) The "Not in scope for MVP" adapter line no longer says Codex CLI is assumed; it says Claude Code is assumed, plus Codex CLI in mixed mode.

  Verify by reading the named sections and with AC-3/AC-4/AC-5.
- [ ] **AC-7 — README trust model is correct for both providers.**
  - (a) `grep -n "using both" README.md` returns nothing except a line that also says "mixed".
  - (b) The privacy bullet says Claude mode sends prompts and repository context only to Anthropic, and names `/canon-inline-review` as the exception that sends to OpenAI.
  - (c) The Codex `--sandbox workspace-write` bullet is labelled as mixed mode.
  - (d) The trust-model intro's "`--interactive` opens ordinary Claude Code and Codex sessions" says Codex sessions appear only for Codex-held roles.
  - (e) The trust model contains a sentence stating that in `claude` mode spec review and implementation also run as Claude sessions under `--dangerously-skip-permissions`, with no OS-level write confinement unless the user opts into the Claude sandbox (AC-9).
- [ ] **AC-8 — Docs, skills and AGENTS.md read correctly under both providers.**
  - `AGENTS.md`: the Roles table lists roles with the holder per provider, or a Codex row qualified "mixed mode" plus a note that Claude mode runs every role on Claude. The Shared Norms cross-review line keeps the rule that no agent reviews its own output and states the mixed-mode vendor split as mixed mode.
  - `docs/product-context.md`: the Spec, Handoff, Review and Tier glossary rows, the tier bullets, and the roadmap line are role-based or mixed-qualified.
  - `docs/pipeline-orchestrator.md`: the operator section's opening names pipeline agents without implying Codex always runs; the tier diagrams name roles, or show a mixed mapping beside a Claude-mode note; the park/failure paragraphs (crashed spec_review, unavailable cold lens) and the `Fail – unrelated` paragraph are role-based or mixed-qualified. The "Codex as operator" closing paragraph scopes "the phases canon assigns to it" to mixed mode. The Codex Model/Effort Matrix section opens with a sentence saying it applies to Codex-held roles in mixed mode.
  - `docs/decisions.md` §"Phases route by role through agent backends (2026-10)": the "only assignment remains …" sentence describes the mixed assignment and points to §"Per-task provider pins and backend-tagged sessions (2026-10)".
  - `docs/codebase-map.md`: the template table's Author column and the pitfalls-injection row name roles. `docs/architecture.md`: the external-CLI list and diagram say `codex` is driven in mixed mode; the spec-review and implement steps, the worktree-CWD line and the park bullet name roles or are mixed-qualified.
  - Verify by reading each named site, plus AC-3/AC-4.
- [ ] **AC-9 — Opt-in Claude sandbox is documented without overclaiming.**
  - (a) `README.md` contains a JSON snippet with `"sandbox"`, `"enabled": true`, `"autoAllowBashIfSandboxed": true` and `"allowUnsandboxedCommands": false`, and names `excludedCommands` as the way to let validation commands that need system paths run unsandboxed.
  - (b) The text says the sandbox is opt-in and that canon neither scaffolds nor requires it.
  - (c) It says the sandbox confines Bash subprocesses only, that it blocks their writes outside the working directory and temp dir, and that Claude's built-in file edit tools are not covered.
  - (d) It says network is **not** confined in canon's headless runs, because canon passes `--dangerously-skip-permissions` and that flag auto-approves the sandbox's network prompts, even when `network.allowedDomains` is set. It also says that without `allowUnsandboxedCommands: false` a session can step outside the sandbox and be auto-approved. It names the Claude Code version the behavior was observed on (2.1.312), so readers know it may change.
  - (e) It contains no sentence claiming the sandbox makes headless Claude sessions equivalent to Codex's `workspace-write`, and the closing trust paragraph's "narrower confinement is on the roadmap" sentence is reconciled with it (e.g. the opt-in exists; a verified default is still on the roadmap).
  - (f) `docs/BACKLOG.md`'s sandbox entry records the 2026-10-31 probe under `--dangerously-skip-permissions` (filesystem confined, network not, escape hatch closed only by `allowUnsandboxedCommands: false`) and says the opt-in documentation shipped. Network confinement under canon's headless flags stays open.
  - Verify by reading.
- [ ] **AC-10 — `.canon/README.md` matches README on Codex network.** `grep -n "plus network access" .canon/README.md templates/.canon/README.md` returns nothing. The paragraph says Codex's sandbox applies to fresh headless Codex runs in mixed mode, and that network follows the user's Codex config.
- [ ] **AC-11 — Skills are role-based.** The canon-spec, canon-spec-review, canon-pipeline and canon-status SKILL.md files describe spec review, implementation and iteration by role. Wording that names Codex is either mixed-qualified or one of the permitted cases in Non-Goals. canon-spec's fast-tier `spec-review.md` approval note reads "spec review skipped" without "Codex". Verify with AC-3/AC-4 over `.claude/skills`, and by reading the four files.
- [ ] **AC-12 — Mirrors, refs and suite are clean.** `npm run sync-templates:check`, `npm run docs-refs-check`, `npm run build`, `npm run type-check`, `npm run lint` and `npm test` pass. The rebuilt `dist/` is committed (CI runs `git diff --exit-code -- dist/`). `tests/run-task-prompts.golden.json` and `tests/completion.golden.json` are unchanged (`git diff --quiet -- tests/run-task-prompts.golden.json tests/completion.golden.json`).

### Implementation Notes (non-binding; owned by plan/implement)

- Edit root canon-managed files (skills, `.canon/templates/*`, `.canon/README.md`, `docs/pipeline-orchestrator.md`), then run `npm run sync-templates`. README, AGENTS.md, `docs/product-context.md`, `docs/patterns.md`, `docs/codebase-map.md`, `docs/architecture.md` and `docs/decisions.md` are not mirrored. `templates/docs/patterns.md` and `templates/docs/task-quality-log.md` are independent adopter seeds; edit them by hand.
- Don't rename headings that other docs cite with `§"…"`. Add qualifying sentences instead. A section-level note is fine for readability, but each gated line still needs to pass AC-3/AC-4 (e.g. name the role in diagrams rather than relying on the note).
- One way to phrase the mapping: "Spec review, implementation and the orchestrator's cold code-review lens run on Codex in `mixed` mode (the default) and on Claude Code in `claude` mode."
- `sandbox.allowUnsandboxedCommands: false` was confirmed effective by the probe (Problem). Don't recommend `network.allowedDomains` as a confinement under canon's flags: the probe showed it doesn't restrict network there.

## Design

### Affected Files

| File | Change |
|---|---|
| `README.md` | Install/Prerequisites, provider subsection replacing the vendor bullets, tier/`delicate` lines, both doctor descriptions, trust-model sandbox, Claude-mode and privacy bullets, `--interactive` line, opt-in Claude sandbox, closing roadmap sentence, "Not in scope for MVP" adapter line. |
| `src/orchestrator/cli.ts` | `RUN_USAGE`: fast-tier and reroute lines become provider-neutral. |
| `src/lib/pipeline-policy.ts` | Two scope-reason strings: "cold-Codex archive record" → "round record". |
| `dist/cli/index.js` | Rebuilt by `npm run build` (bundles `RUN_USAGE`). |
| `dist/orchestrator/run-task.js` | Rebuilt by `npm run build` (bundles `RUN_USAGE` and the scope reasons). |
| `tests/cli-args.test.ts` | Assert `RUN_USAGE` has no `Codex`. |
| `tests/pipeline-policy.test.ts` | Update expected scope-reason strings. |
| `tests/run-task-code-review.test.ts` | Update expected scope-reason strings and fixtures carrying them. |
| `.claude/skills/canon-spec/SKILL.md` | Role-based pipeline wording; fast-tier approval note. |
| `.claude/skills/canon-spec-review/SKILL.md` | Role-based description of what spec_review would surface. |
| `.claude/skills/canon-pipeline/SKILL.md` | Spec-gate-after-approval line; matrix pointer. |
| `.claude/skills/canon-status/SKILL.md` | "implementer iterating (round N)". |
| `.canon/templates/spec.md` | Byline. |
| `.canon/templates/spec-review.md` | Byline. |
| `.canon/templates/handoff.md` | Byline (keep the `codex_cli` version row). |
| `.canon/templates/review.md` | Line-5 per-round note, reroute, handoff and guess lines name roles; lens description and `Dismissed (cold-Codex)` mixed-qualified. |
| `.canon/README.md` | Mixed-mode qualifier; network statement matches README. |
| `docs/pipeline-orchestrator.md` | Operator section (opening and closing), tier diagrams and bullets incl. the `/canon-spec-review` bullet, sizing rows, `delicate` default text, validation paragraph, matrix lead sentence, `MAX_CONTEXT_BYTES` row, spec-gate timing line, park/failure paragraphs (cold lens, crashed spec_review), `Fail – unrelated` paragraph, reroute-amendment paragraph. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Mirror, via `npm run sync-templates`. |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Mirror. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirror. |
| `templates/.claude/skills/canon-status/SKILL.md` | Mirror. |
| `templates/.canon/templates/spec.md` | Mirror. |
| `templates/.canon/templates/spec-review.md` | Mirror. |
| `templates/.canon/templates/handoff.md` | Mirror. |
| `templates/.canon/templates/review.md` | Mirror. |
| `templates/.canon/README.md` | Mirror. |
| `templates/docs/pipeline-orchestrator.md` | Mirror. |
| `AGENTS.md` | Roles table and Shared Norms cross-review line. |
| `docs/product-context.md` | Glossary rows, tier bullets, roadmap line. |
| `docs/patterns.md` | "Codex's implement prompt" (line 10) → implementer's prompt; checkAndRoute pitfall's "Codex `spec_review` crash" mixed-qualified. |
| `templates/docs/patterns.md` | Same line (adopter seed). |
| `templates/docs/task-quality-log.md` | Role-based wording for the two Codex lines. |
| `docs/codebase-map.md` | Template table Author column; pitfalls-injection row. |
| `docs/architecture.md` | External-CLI list and diagram, spec-review/implement steps, worktree-CWD line, park bullet. |
| `docs/decisions.md` | The one stale "only assignment remains …" sentence (AC-8). |
| `docs/BACKLOG.md` | Sandbox entry status line (AC-9f). |

### Interaction Dependencies

- `tests/cli.test.ts` pins README content (Claude Code floor, allowlist JSON, `/init` section, "Codex auto-loads `AGENTS.md` natively", "Where to Go Deeper") and `AGENTS.md` line 3. Those strings must survive.
- `tests/run-task-prompts.test.ts` pins skill phrases (none contain "Codex") and root/mirror skill lists.
- `tests/sync-canon-templates.test.ts` enforces root/mirror parity.
- `tests/run-task-safety.test.ts` pins the mixed spec-gate banner `SPEC GATE — Review before Codex implements.`, which is runtime text and unchanged.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] E2E — N/A, no UI

## Docs Impact

`docs/pipeline-orchestrator.md`, `docs/product-context.md`, `docs/patterns.md`, `docs/codebase-map.md`, `docs/architecture.md` and `docs/decisions.md` are edited directly (Affected Files). No other protected doc should go stale.

## Known Risks

- **Overclaiming the Claude sandbox.** The probe was a single Claude Code version (2.1.312) on macOS, with one model (haiku) issuing the commands. Behavior under `--dangerously-skip-permissions` may change between releases or differ on Linux. AC-9 requires the doc to state the observed limits (network open, escape hatch needs closing), name the version, and not claim parity with Codex's `workspace-write`.
- **Mixed-mode accuracy regressions.** A role-neutral rewrite can drop a true mixed-mode fact, for example that `delicate` moves the Codex cells to the full model, or that the cold-Codex lens is flat at mini/high. Each rewritten line keeps its mixed-mode fact as a mixed-qualified clause rather than deleting it.
- **The "mixed" permitted bucket is a soft gate.** A line can mention "mixed" and still be wrong. AC-6–AC-11 add reading checks of the named sections on top of the greps.
- **Breaking test-pinned strings** (README floor, allowlist, `/init` section, `AGENTS.md` line 3). Covered by the Non-Goals and AC-12.
- **docs-refs-check anchors.** Renaming a cited heading breaks it. The Implementation Notes say to add sentences rather than rename.
- **Paraphrases the greps miss** (e.g. "the OpenAI agent writes the code"). The implementer reads each Affected File's Codex mentions (`grep -n -i codex <file>`) rather than relying on the patterns alone.

## Human Test Plan

1. Read the README's "How it works", "Getting started" and "Trust model" sections as a new user who only has Claude Code installed. Expected: you can tell Codex is optional for you, how to pick Claude-only mode, that `canon doctor` won't demand Codex, that your code goes only to Anthropic unless you use the inline-review helper, and that Claude-only runs have no OS sandbox by default.
2. Read the same sections as a default (mixed) user. Expected: everything that was true before is still stated: Codex reviews specs, implements and runs the cold review lens; code goes to both providers; the Codex sandbox description is still accurate.
3. Read the new Claude sandbox section. Expected: it's clearly optional, shows the settings to add, and is honest that it only fences shell commands, doesn't stop file edits, and doesn't block network access in canon's unattended runs.
4. Run `canon run --help`. Expected: no vendor name in the tier or reroute lines.
5. Open a fresh task's spec, spec-review and handoff templates. Expected: bylines name the role, not Codex.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — wording sweep
- [x] (Refactors) N/A — no behavior preserved/refactored
