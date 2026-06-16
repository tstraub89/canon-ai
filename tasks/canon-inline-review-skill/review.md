# Code Review: canon-inline-review-skill

> Reviewer: Claude | Spec: `tasks/canon-inline-review-skill/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review, post-reroute implementation). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The `codex exec review --uncommitted` smoke test is marked `blocked` (sandbox restriction — `Operation not permitted`), not `Fail`. This is a credible `blocked` entry (sandbox infrastructure, not code defect) and does not constitute a failing gate.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Skill exists at `.claude/skills/canon-inline-review/SKILL.md` with valid frontmatter — `name: canon-inline-review`, `description` with trigger phrases, `allowed-tools`, `effort` | Pass | File exists; `name: canon-inline-review` matches directory; `description` carries trigger phrases including `/canon-inline-review`, "review my uncommitted changes", "review my branch"; `allowed-tools` grants codex review invocations and read-only git inspection; `effort: medium` present. |
| AC-2: Skill drives an actual cross-review — determines target from operator intent/context, runs `codex review` / `codex exec review` non-interactively, surfaces findings concisely | Pass | SKILL.md encodes the full workflow: guided target-selection contract, non-interactive `codex exec review` invocation, and a reporting contract requiring a concise severity-grouped summary. Live smoke test was sandbox-blocked per handoff; Human Test Plan steps 1–3 remain satisfiable by the human. |
| AC-3: Skill selects target from operator intent/context (not git-state inference); no `git log`-based committed-work detection; one `git status --porcelain` guard only; `AskUserQuestion` on genuine ambiguity; `codex exec review --help` as version-pinned source of truth; selector-XOR-prompt mutual exclusivity stated; `codex review` shorthand noted | Pass | Steps (a)–(d) of the guided procedure are all present. No `git log @{u}..HEAD` or `git log <base>..HEAD` remains (grep confirmed by anchored lens). XOR mutual exclusivity and shorthand relationship are explicit. `codex exec review --help` is named as live flag source of truth. Note on AC-3(e): the amendment specified `--sandbox read-only`; the installed codex-cli 0.139.0 does not expose this flag and rejects it at the wrapper. The skill documents the CLI's default read-only behavior with an explicit rationale — a credible documented deviation consistent with the spec's Known Risks instruction to derive flags from `--help`, not freeze a list. Not a silent drop. |
| AC-4: Skill states scope bound — correctness/quality bugs across models, not a spec-compliance gate; ACs go through `canon run` / `--reroute` | Pass | Scope-bound sentence present at SKILL.md line 20. |
| AC-5: CLAUDE.md's "Cross-review for inline and XS work" section replaced by ≤2-line norm + `/canon-inline-review` pointer; detailed invocation forms removed | Pass | `grep -c 'codex review --uncommitted' CLAUDE.md` returns `0`; the one-sentence norm plus the skill pointer are present. Section heading retained (without the `(codex review)` parenthetical). |
| AC-6: Skill registered on all required surfaces — `CANON_OWNED`, `checkSkills()`, `RECOMMENDED_ALLOW`, skill-enumeration tests, README allowlist block, `.claude/settings.json`; full validation suite passes | Pass | All six surfaces updated. `dist/cli/index.js` rebuilt. Handoff deviation (README drift tests read from `WORKTREE_ROOT` not `REPO_ROOT`) is documented with valid rationale: in a linked worktree the supervising checkout's README is stale; the test must read the worktree's edited copy. All validation checks pass per Validation Outcomes table. |

### Dropped Sections Check

- [x] Non-goals respected — no pipeline code_review changes, no deep CLAUDE.md slim, no canon-review rename, no pre-commit hook automation
- [x] Known Risks addressed or documented as accepted — skill explicitly notes stdin-hang avoidance, selector-XOR-prompt constraint, target-selection gotchas, and the `--sandbox` CLI constraint
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean implementation. All registration surfaces are updated in lockstep, the rerouted SKILL.md procedure is clear and enforces intent-from-context correctly, and the CLAUDE.md replacement is appropriately minimal. Two low-severity nits survive. No correctness bugs and no spec gaps.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `optional cleanup/nit` — **Anchored lens.** `.claude/skills/canon-inline-review/SKILL.md:47`: "The installed `codex exec review --help` surface does not expose a separate `--sandbox` flag" is a point-in-time claim about codex-cli 0.139.0. If a future CLI version adds `--sandbox`, this sentence becomes misleading. The `--help` instruction on line 37 already covers this correctly. Consider reframing as "as of this writing" or dropping the rationale sentence entirely since the `--help` deferral is the durable form.

- `optional cleanup/nit` — **Cold lens.** `.claude/skills/canon-inline-review/SKILL.md:28`: The default-branch resolution instruction says "strip the `origin/` prefix, then fall back to `main` if needed" without describing how to detect a `git symbolic-ref` non-zero exit (e.g., fresh clone or non-standard remote). Claude as the executing agent would see the error in the bash tool result, but spelling out "if the command exits non-zero, use `main`" would make the fallback unambiguous.

### Dismissed Cold Findings

- **Dismissed (cold): `AskUserQuestion` not in `allowed-tools`** — `AskUserQuestion` is a Claude Code built-in tool that is always available to skills without explicit `allowed-tools` listing. No other skill in the project grants it explicitly; it is not gated by the Bash permission model. The spec at AC-3(d) explicitly requires it, and the implementation follows the spec.

- **Dismissed (cold): No targeted single-skill isolation test for `canon-inline-review`** — The spec's AC-6 requires the skill-enumeration tests to pass with the expanded seven-skill set, which they do. An isolation test analogous to the `canon-changelog` one is not required by any AC. Follows the existing pattern for all other skills.

- **Dismissed (cold): `canon-review` absent from "all operational skills missing" test assertion** — This gap predates this diff and is not introduced by it. The cold lens correctly surfaced it; it is out of scope for this task.

- **Dismissed (cold): `dist/cli/index.js` duplicate `const skillNames`** — The diff presentation showed two `+` lines for the same declaration before the truncation marker. Anchored lens confirmed no duplicate in the actual file. Diff presentation artifact only.

- **Dismissed (cold): WORKTREE_ROOT vs REPO_ROOT asymmetry in tests** — Intentional and documented in the handoff: operational docs live in the supervising checkout (correctly read from `REPO_ROOT`); the README was edited in the worktree (must be read from `WORKTREE_ROOT`). No correctness issue.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** — root cause is the spec, not the code; halt for human instead of routing to implement
