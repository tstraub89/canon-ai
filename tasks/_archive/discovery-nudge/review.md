# Code Review: discovery-nudge

> Reviewer: Claude | Spec: `tasks/discovery-nudge/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All five required checks (lint, type-check, test, build, docs-refs-check) recorded Pass. E2E correctly marked `not_configured` with justification (no UI surface).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: single-source constant | Pass | `RECOMMENDED_NUDGE` exported from `src/cli/commands/doctor.ts:88`; 3-line orientation text joined by `\n`; imported and used in the drift test. |
| AC-2: loose warn-only doctor check | Pass | `checkCanonDiscoveryNudge` at `doctor.ts:209` uses `/canon/i` substring test; returns `warn` when neither file mentions canon, `pass` when either does; no `fail` return path exists. |
| AC-3: advisory surfaces recommendation | Pass | Warn `detail` at `doctor.ts:224` is `` `add this to CLAUDE.md:\n${RECOMMENDED_NUDGE}` ``; test asserts presence of `CLAUDE.md`, `/canon/i`, and `This project uses canon`. |
| AC-4: README documents it | Pass | README lines 131–139 contain the `### Discovery nudge (recommended)` subsection with the fenced text block. |
| AC-5: drift test | Pass | `tests/cli.test.ts:2320` extracts the fenced block and asserts equality to `RECOMMENDED_NUDGE`; regex and trim logic verified against actual README content. |
| AC-6: recommend-only — no adopter-file writes | Pass | `git diff main...HEAD -- src/cli/commands/init.ts templates/CLAUDE.md templates/AGENTS.md` is empty; no `writeFile`/`appendFile` in `doctor.ts`; read-only test verifies file contents unchanged after check. |
| AC-7: build artifact current | Pass | `dist/cli/index.js` in the diff; on-disk file confirmed correct (lines 948–950: `checkAgentFile AGENTS.md`, `checkAgentFile CLAUDE.md`, `checkCanonDiscoveryNudge`). |

### Dropped Sections Check

- [x] Non-goals respected — no changes to `init.ts`, `templates/CLAUDE.md`, or `templates/AGENTS.md`
- [x] Known Risks addressed — alarm-fatigue risk mitigated by `/canon/i` loose check; scope-creep risk blocked by AC-6; pre-C no-op risk documented in spec and accepted
- [x] Human Test Plan is satisfiable — doctor invocation in a canon repo (passes) and a non-canon directory (warns) are both verifiable with the shipped CLI

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, minimal implementation that mirrors the `RECOMMENDED_ALLOW` pattern precisely. The constant, check function, README subsection, and drift test are well-coordinated. The logic is simple and correct; the read-only invariant is validated by the test. No correctness bugs or risk items.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **`tests/cli.test.ts:362`** — The "either file → pass" fixture only covers the AGENTS.md-has-canon case; the CLAUDE.md-alone path (the first element in the `['CLAUDE.md', 'AGENTS.md']` array) is not directly exercised. The `.some()` logic is symmetric so this isn't a correctness gap, but a two-fixture version would close the coverage hole. Flagged by both lenses; low severity. (Anchored + Cold)
- **`tests/cli.test.ts`** — No fixture for the neither-file-exists path (`existsSync` returns false for both → `warn`). The `existsSync` guard makes this safe, but the path is untested. Low severity. (Cold)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Dismissed (cold): `/canon/i` matches "canonical"** — The spec explicitly accepts this: "A case-insensitive `canon` match also matches 'canonical' — an accepted false-*pass*; under-warning is the safe direction." (spec §Known Risks)
- **Dismissed (cold): dist duplication — two `checkAgentFile(cwd, "AGENTS.md")` in context lines** — Verified false alarm. Actual `dist/cli/index.js` on disk has the correct sequence: `checkAgentFile AGENTS.md`, `checkAgentFile CLAUDE.md`, `checkCanonDiscoveryNudge` (lines 948–950). The diff fed to the cold lens contained misleading context lines.
- **Dismissed (cold): `path` variable shadow** — `doctor.ts` imports `path` as destructured `{ join, sep as pathSep }`, not a namespace import. The local `const path = join(cwd, filename)` inside the `.some()` callback has no real name collision. The bundler renamed it `path11` as a precaution but no module-level shadowing risk exists.
- **Dismissed (cold): warn `detail` doesn't assert full `RECOMMENDED_NUDGE` verbatim** — The three spot-check assertions (`CLAUDE.md`, `/canon/i`, `This project uses canon`) are sufficient for the AC-3 verification requirement. Full verbatim assertion is the drift test's job (AC-5).
- **Dismissed (cold): only checks `CLAUDE.md` and `AGENTS.md`, not other agent files** — Specced behavior: AC-2 explicitly names `CLAUDE.md` and `AGENTS.md` as the targets.

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
