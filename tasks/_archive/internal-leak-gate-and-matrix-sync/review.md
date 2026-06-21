# Code Review: internal-leak-gate-and-matrix-sync

> Reviewer: Claude | Spec: `tasks/internal-leak-gate-and-matrix-sync/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (`npm run lint`, `npm run type-check`, `npm test`, `npm run sync-templates:check`, `npm run docs-refs-check` all Pass; `npm run build` and E2E marked `not_configured` per spec Non-Goals)
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: leak gate flags bare internal-only basename | Pass | `isCanonInternalTarget` at `scripts/sync-canon-templates.mjs:77-79` flags bare basenames in `INTERNAL_ONLY_TEMPLATE_BASENAMES`; test at `tests/sync-canon-templates.test.ts:303-334` writes `qa.md` and `implement.md` refs into a wholesale-synced file, calls `findSyncErrors`, and asserts exactly 2 `[canon-internal-leak]` errors. |
| AC-2: colliding names (spec.md, plan.md, spec-review.md) not flagged | Pass | Set subtraction excludes all three from `INTERNAL_ONLY_TEMPLATE_BASENAMES`; test at `tests/sync-canon-templates.test.ts:336-355` asserts zero `[canon-internal-leak]` errors for all three. |
| AC-3: internal-only set derived from directories, not literal list | Pass | `INTERNAL_ONLY_TEMPLATE_BASENAMES` at `scripts/sync-canon-templates.mjs:34-40` is computed via `readdirSync` of both template directories; AC-1 test also pins `internalOnlyTemplateBasenames.has('implement.md')` and `!internalOnlyTemplateBasenames.has('spec.md')` on the live exported set. |
| AC-4: existing leak-gate behavior preserved | Pass | Pre-existing tests for full-path refs, relative-path refs, fenced code blocks, and repo-escape refs all remain unchanged and pass. |
| AC-5: Validation Matrix drift guard | Pass | `tests/validation-matrix-sync.test.ts:1-32` extracts the matrix block from both files anchored on the exact header, asserts non-emptiness in each, and compares byte-for-byte. |
| AC-6: SKILL.md no longer references qa.md | Pass | `.claude/skills/canon-changelog/SKILL.md:226` now reads "enforced during canon's QA phase" — no backtick around `qa.md`; meaning is preserved. |
| AC-7: templates/ mirror in sync | Pass | `templates/.claude/skills/canon-changelog/SKILL.md` is byte-identical to the root; `npm run sync-templates:check` exited 0. |
| AC-8: leak gate passes for whole repo | Pass | `npm run sync-templates:check` exited 0 with no `[canon-internal-leak]` errors. |
| AC-9: decisions.md decision entry | Pass | `docs/decisions.md:161-172` adds "Canon-shipped guidance never names orchestration internals" with Decision / Why / Rule sections; Rule names `scripts/sync-canon-templates.mjs` as the enforcement. |

### Dropped Sections Check

- [x] Non-goals respected (no structural single-sourcing, no matrix content changes, no docs-refs-check changes, no audit beyond the one known leak)
- [x] Known Risks addressed or documented as accepted (collision-avoidance coupling, residual bare-collision gap, matrix anchor robustness, ordering constraint — all addressed per spec)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, minimal implementation. The `INTERNAL_ONLY_TEMPLATE_BASENAMES` set-subtraction at module load is the right design: it derives automatically from the two template directories and exposes the set for test pinning via `AC-3`. The `describeLeakTarget` helper correctly distinguishes bare-basename leaks from path-prefix leaks for actionable messages. The `isCanonInternalTarget` placement of the new guard (before the normalization path) correctly catches bare refs before they could escape via path resolution. The validation-matrix drift guard is minimal and correct. Three nits survive, all non-blocking.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Garbled first-create message** (`scripts/sync-canon-templates.mjs:355-358`, flagged by both lenses): When `describeLeakTarget` returns the basename-variant message ("…reference the phase name instead of the template filename"), the caller appends " in source tail would ship as…" without a separator, producing a run-on. Currently unreachable because `DELIMITED = [] as const` means no file hits this branch, but if a DELIMITED file is ever added the message would be confusing. Easy fix: end the `describeLeakTarget` return with a period, or restructure the caller to always append the tail-context separately.

- **`process.cwd()` path resolution in validation-matrix test** (`tests/validation-matrix-sync.test.ts:7-8`, flagged by both lenses): The matrix paths use `process.cwd()` rather than `import.meta.url`-relative resolution. The test runner invokes from repo root (per `package.json` test script), so this works today. An ENOENT from the wrong cwd would surface as an uncaught exception rather than a clean assertion failure. Cosmetic robustness issue; matches the existing test-suite convention.

- **`readdirSync` includes `.md`-named subdirectories** (`scripts/sync-canon-templates.mjs:29-31`, cold lens, low confidence): `readdirSync` without `withFileTypes` returns both files and directories; a subdirectory named `foo.md` inside either template dir would be added to the basenames set, producing a false-positive leak flag for bare refs to `foo.md`. Template dirs don't have such subdirectories today. Low-likelihood, low-severity.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Dismissed (cold): relative-path forms (`./qa.md`, `../qa.md`) evade the basename check.** Spec AC-1 explicitly scopes the new check to "bare basename (no path component)." A ref with `./` or `../` has a path component by definition and is out of scope. Full-path refs to internal templates are caught by the existing prefix check regardless.

- **Dismissed (cold): `internalOnlyTemplateBasenames` tests real filesystem set, not a controlled fixture.** `CANON_AI_ROOT` is resolved from the script's own `import.meta.url`, not from the test fixture's temp root. Even in temp-dir tests, the set is populated from the real canon checkout. The test asserting membership on the live set is the intended verification for AC-3. If `implement.md` were ever added to `.canon/templates/`, the set would correctly change and AC-3 would need updating — the right failure mode.

- **Dismissed (cold): `INTERNAL_ONLY_TEMPLATE_BASENAMES` is empty if `scripts/run-task/prompts/templates/` is absent.** Same `CANON_AI_ROOT` reasoning: the set is always populated from the real canon checkout. Adopter repos don't run this script (`scripts/sync-canon-templates.mjs` is not in `CANON_OWNED` and does not ship).

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
