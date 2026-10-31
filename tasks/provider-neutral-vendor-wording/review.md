# Code Review: provider-neutral-vendor-wording

> Reviewer: Claude | Spec: `tasks/provider-neutral-vendor-wording/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results — one `Fail – unrelated` row (`npm test`, `tests/task-cli.test.ts:1238`), verified environment-bound; see note
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (none — wording sweep, no red-first ACs)

**Note on the `npm test` failure.** The foreman reproduced it with the handoff's isolated command. `canon task reset-code-review` renders the scaffold through `resolveTaskTemplateSource()` (`src/task/templates.ts`), whose `resolveProjectRoot()` resolves to the supervising checkout when run from a linked worktree. That checkout's `.canon/templates/review.md` still has the pre-change text, while the test's expectation reads `process.cwd()` (the worktree's updated template). The two differ only because this diff edits `review.md` inside a linked worktree; in CI or a normal checkout they are the same file. Both Claude lenses independently agreed. Not a defect in this diff, but it is argued rather than observed passing — confirm the test is green in PR CI before merge.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `RUN_USAGE` provider-neutral | Pass | `src/orchestrator/cli.ts` fast-tier and reroute lines name the phase/implementer; new `tests/cli-args.test.ts` assertion passes; `dist/` rebuilt. |
| AC-2: Scope reasons provider-neutral | Pass | `grep -rn "cold-Codex archive record" src tests dist` empty; `git diff -U0 main -- src/lib/pipeline-policy.ts` shows only the two strings; tests updated and passing. |
| AC-3: No unqualified "Codex spec review" | Pass | Literal grep over S minus "mixed" returns nothing. |
| AC-4: No unqualified Codex role-holder verbs | Pass | Literal grep over S minus "mixed" returns nothing. |
| AC-5: Artifact templates name roles | Pass | Byline grep empty; `cold-Codex` grep minus "mixed" empty; review.md lens text, `Dismissed (cold-Codex)` instruction and line-5 note match. |
| AC-6: README setup/doctor conditional | Pass | Install note and Prerequisites conditional; both doctor descriptions conditional and match `doctor.ts` (`requiredAgents.has('codex')`), env-vs-pin caveat present, `Claude Code (≥ 2.1.72)` kept; "Roles and providers" subsection covers Decision §2 incl. Codex-only unsupported; `plays the **implementer**` grep empty; tier/`delicate`/MVP lines done. |
| AC-7: README trust model both providers | Pass | Only `using both` hit is mixed-qualified; privacy, `--interactive`, mixed-labelled Codex sandbox, and Claude-mode no-confinement sentence present. |
| AC-8: Docs, skills, AGENTS.md | Pass | Anchored lens read every named site (AGENTS roles/norms, product-context glossary/tiers/roadmap, pipeline-orchestrator operator/diagrams/park/`Fail – unrelated`/matrix lead, decisions.md sentence, codebase-map, architecture). |
| AC-9: Opt-in Claude sandbox | Pass | Snippet with all four keys, `excludedCommands`, opt-in/not scaffolded, Bash-only, file-edit tools uncovered, network not confined, escape hatch, version 2.1.312, no parity claim, closing paragraph reconciled; BACKLOG re-probe entry with network still open. |
| AC-10: `.canon/README.md` network | Pass | `plus network access` grep empty in root and mirror; paragraph mixed-qualified; matches `src/orchestrator/agents/codex.ts` (no network override). |
| AC-11: Skills role-based | Pass | Four skills read; remaining Codex mentions are Non-Goal exemptions; fast-tier note reads "spec review skipped". |
| AC-12: Mirrors, refs, suite | Partial (environment-bound) | sync-templates:check, docs-refs-check, build, type-check, lint pass; goldens unchanged; `npm test` single failure is the linked-worktree artifact above. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

> If Stage 1 fails: summarize the gaps above, mark Stage 2 as "Not run — Stage 1 failed," and stop. Codex will re-implement; re-review runs both stages from scratch.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A clean, disciplined wording sweep. All three lenses returned approve; cold-Codex reported no findings. Behavior is unchanged (only the two scope-reason strings and `RUN_USAGE` text move in `src/`), mixed-mode facts are retained as mixed-qualified clauses, pinned strings survive, and every new factual claim the lenses checked against source (doctor gating, `canon task set … provider`, Claude XL cells, Codex sandbox argv) holds. What survives is a handful of low-severity doc-precision nits, none blocking.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Sandbox section does not mention `--add-dir`** (flagged by 2 lenses: anchored, cold-Claude) — `README.md:297`. The 2.1.312 probe ran in a plain throwaway repo; canon's headless Claude sessions also receive `--add-dir <main checkout>` (`src/orchestrator/agents/claude.ts`). Whether sandboxed Bash may write to added directories, and whether git in a linked worktree (which writes to the main repo's `.git/worktrees/<name>`) still works, were not probed. The text matches the spec's Decision §4 and is labelled "as observed", so this is precision, not a wrong claim; a one-clause caveat would make it more honest. Altitude: spec-gap-adjacent wording; non-blocking.
- **`.claude/agents/code-review-{anchored,cold}.md:6` still say "canon's three-lens review pipeline"** (cold-Claude, verified). Both are `CANON_OWNED` and ship to adopters; Claude mode runs two lenses. Outside the spec's surface set S and Affected Files, so the implementer correctly did not touch them; worth a follow-up one-word fix ("multi-lens").
- **"Network follows your Codex config" drops the true default** (anchored) — `README.md:276`, `.canon/README.md`. `workspace-write` has network off by default; the old "off unless your Codex config enables it" was more informative. The new wording is what spec Decision §6 asked for. `.canon/README.md`'s "your mixed-mode Codex config" also implies a mode-specific config that does not exist.
- **`docs/product-context.md:21` still says "two AI agents (an architect and an implementer)"** (anchored). README's matching sentence was rewritten to "pipeline roles"; this one was not in the spec's named-site list.
- **Lowercase status note** (cold-Claude) — `.claude/skills/canon-status/SKILL.md:68` "implementer iterating (round N)." should be capitalized.
- **Quick-start install line** (cold-Claude) — `README.md:26` says two packages suffice for `CANON_PROVIDER=claude` without noting the variable must be set before `canon task new` / `canon doctor`. Covered a few sections later (provider pinning, doctor caveat); optional.
- **Two names for one artifact** (anchored) — the scope reason now says "round record" while the mixed foreman prompt calls it the "numbered cold-Codex archive header". Spec-chosen wording, and prompt templates are a Non-Goal; noted only.

#### Spec Gaps

(none — the nits above trace partly to the spec's enumerated surface set, but none is severe enough to halt for the human)

### Dismissed Cold Findings

- Dismissed (cold-Claude): "Claude Code 2.1.312" looks unverifiable or mistyped - the spec's Problem section records the spec author's 2026-10-31 probe on exactly that version; the README correctly cites it.
- Dismissed (cold-Claude): canon-spec-review trigger phrase "what would Codex catch" survives - explicitly listed as a permitted case in the spec's Non-Goals (a user trigger phrase, true under either provider).
- Dismissed (cold-Claude): `docs/decisions.md` decision body edited retroactively - AC-8 explicitly requires this sentence change, pointing to the superseding decision.
- Dismissed (cold-Claude): handoff template's "Codex CLI | `status.json.canon.codex_cli`" provenance row - pre-existing, and the spec's Affected Files says to keep the `codex_cli` row; renaming `codex_cli` is a Non-Goal.
- Dismissed (cold-Codex): none — cold-Codex returned no findings ("no actionable regressions"; template sync check passes).

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

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

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
