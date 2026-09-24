# Code Review: default-codex-models-to-gpt-6-generation

> Reviewer: Claude | Spec: `tasks/default-codex-models-to-gpt-6-generation/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

This spec was amended after Round-1 implementation and reroute (round 1, human-approved). AC-11/12/13 supersede AC-3/AC-4's original location; all other ACs stand. Verified against the current diff and code, not just handoff claims.

| AC | Status | Notes |
|---|---|---|
| AC-1: Defaults bumped in both config copies | Pass | `src/orchestrator/env.ts` and `src/orchestrator/policy.ts` both fall back to `gpt-6-luna` / `gpt-6-sol`; override chains byte-identical; `git grep -n "gpt-6-luna\|gpt-6-sol"` on the two files returns exactly 4 lines. |
| AC-2: No current-state surface names retired defaults | Pass | Spec's grep for `gpt-5\.6-(luna\|sol)` across the named surfaces returns zero; `docs/pipeline-orchestrator.md` table and its `templates/` mirror show the new defaults; `npm run sync-templates:check` passes per handoff. |
| AC-3: Headless paragraph conveys (a)-(d) | Pass (relocated per Amendment) | Content lives in the new exported `CODEX_HEADLESS` in `src/orchestrator/prompts/helpers.ts`, not `CODEX_STARTUP`, per the amendment's Decision. All four sub-points present. |
| AC-4: Narrow ask/approval precedence | Pass (relocated) | Precedence line is in `CODEX_HEADLESS`; `git grep -n "AGENTS.md\|CLAUDE.md" -- src/orchestrator/prompts/helpers.ts` returns zero. |
| AC-5: Dead branch-sync instruction replaced | Pass | `CODEX_STARTUP` now reads "Branch state: the orchestrator manages it — do not fetch, pull, rebase, or push; read the working tree as-is."; grep for `Branch sync\|git fetch\|git pull` across `helpers.ts` and the golden returns zero. |
| AC-6: Three "stop" instructions reworded | Pass | `implement.md` Scope Discipline rule 1 and its Red-First Checkpoint, plus `implement-revisions.md`'s red-first bullet, all now read "do not make that edit / do not implement on the premise — record the labelled Blocker … then finish the remaining in-scope work, the handoff, and the phase command." Banned original phrases absent (grep confirmed). |
| AC-7: Resume stripping still works | Pass | New test in `tests/run-task-prompts.test.ts` asserts `toResumePrompt` strips `CODEX_STARTUP` and starts with `[Resumed session` for spec-review, fresh-implement, and implement-revisions prompts; passes. |
| AC-8: Stale "5.6-generation" pointers updated | Pass | `docs/product-context.md` and the `codexMatrix` comment in `src/lib/pipeline-policy.ts` now name the GPT-6 generation; grep for `5\.6-generation` returns zero. |
| AC-9: Dated `docs/decisions.md` entry | Pass | New "Model-generation re-baseline (2026-09)" entry covers (a) minor-change framing, (b) Astra rejection on cost, (c) Luna trade-off numbers, (d) the M/L code_review follow-up measurement, (e) the `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` rollback, (f) the prompt-audit outcome (4 fixes, `spec-review.md` unchanged), (g) effort-tier re-eval as a separate future task. The 2026-07 5.6 entry is left intact. |
| AC-10: Build and goldens current | Pass | `npm run build` produces zero `dist/` drift post-diff; goldens regenerated (`UPDATE_GOLDENS=1 npm test`) and `npm test` then passes clean (1224/1224 in this review's own run; handoff records 1223/1 skipped — see nit below, not a regression). |
| AC-11: Headless block gated on non-interactive runs | Pass | `CODEX_STARTUP` no longer contains "Headless session" — only `CODEX_HEADLESS` does. `runCodex` (`src/orchestrator/agents/codex.ts:42-43`) prepends `CODEX_HEADLESS` to `renderedPrompt` only when `!interactive`, for both fresh and resumed calls, before dispatch. Because the block is prepended to the fully-rendered prompt (whose own last lines are the phase command instructions), "listed at the end of this prompt" stays literally true. `retryAgentForPhase`'s non-interactive call routes through this same `runCodex`, so it inherits the gate without a separate call-site change. |
| AC-12: Test coverage for both modes | Pass | `tests/run-task-code-review.test.ts:592+` exercises real `runCodex` via a fake `codex` binary on `PATH` capturing `process.argv`, covering fresh non-interactive (headless block present, prompt ends with the original text), resumed non-interactive (headless block present alongside the `[Resumed session` banner), and interactive (headless block absent, prompt passed through verbatim). |
| AC-13: Amendment artifacts current | Pass | Golden JSON contains zero "Headless session" occurrences (relocated to the new constant, not exercised by template-render goldens); AC-7's resume-strip test still passes; the `docs/decisions.md` entry's closing sentence states the headless block applies only to non-interactive runs and that `--interactive`/`-I` keeps operator-present behavior; build and required checks pass. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — no changes to `spec-review.md`, `implement-reroute.md`, `code-review-foreman.md`, Claude lens charters, `runColdCodexReview`, or Claude model defaults.
- [x] Known Risks addressed or documented as accepted — bias-to-action wording ties completion to *authorized* work (AC-3c intact); precedence line stays narrowly scoped (AC-4 intact); resume-strip whitespace risk covered by AC-7's test; goldens diff was reviewed for scope, not just regenerated blindly.
- [x] Human Test Plan is satisfiable by the implementation — an unattended run now gets the headless/bias-to-action framing and the reworded scope-cap language, and an `--interactive` run does not.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-scoped change. The amendment's relocation of headless guidance out of `CODEX_STARTUP` into a call-site-gated `CODEX_HEADLESS` is the right shape: it's enforced once inside `runCodex` rather than patched at each caller, so every non-interactive invocation (including `retryAgentForPhase`) inherits it automatically. All three lenses (anchored Claude, cold-Claude, cold-Codex) independently signed off with no correctness bugs, guardrail violations, or spec gaps; the only findings are two low-severity test-fragility nits and one immaterial numeric discrepancy in a handoff table.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Test selector fragility in the new `runCodex` argv test** (flagged by 2 lenses: anchored Claude, cold-Claude) — `tests/run-task-code-review.test.ts:~611` locates the captured prompt via `args.find(arg => arg.includes('prompt'))`, a substring match against argv rather than a positional or flag-aware extraction. It works today because no other argv element (model id, effort flag, cwd, sandbox flags) happens to contain the literal substring "prompt," but a future flag name or model id containing that substring would make `.find()` silently pick the wrong element instead of failing loudly. Low severity — the test is well-covered in spirit (fault-injection-verified per the cold-Claude lens) and this is a robustness nit, not a bug in production code or in what the test currently proves.
- **Regex-scoped structural assertion** (anchored Claude, low confidence) — `tests/run-task-prompts.test.ts:737-739` extracts the `CODEX_STARTUP` export body via a non-greedy `[\s\S]*?;\n` regex to check it excludes headless text. Currently correct (no mid-string `;` followed by a literal newline), but coupled to incidental formatting rather than a named export boundary. Purely a future-maintenance nit.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): none — the injected cold-Codex summary reported no actionable regressions and covered fresh/resumed/interactive test coverage; nothing to reconcile.
- Dismissed (cold-Claude): handoff.md Iteration 2 test-count claim ("1,223 passed, 1 skipped") vs. this review's own `npm test` run showing 1,224 passed, 0 skipped — not dismissed as a false claim, but not blocking: more tests passed and nothing failed, consistent with the known environment-dependent `gitDirWritable`-gated skip (see `docs/lessons-learned.md`'s "a `skipped` test in a handoff is unverified" caution). Recorded here as a note for the record, not as a finding that drives verdict.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
