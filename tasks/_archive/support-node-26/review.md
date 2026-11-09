# Code Review: support-node-26

> Reviewer: Claude (foreman synthesis) | Spec: `tasks/support-node-26/spec.md`

Synthesized from the anchored Claude lens, the cold-Claude lens, and the pre-obtained cold-Codex findings (no code defects found).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (none apply; handoff states so)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Engines | Pass | `package.json` and lockfile root both `24.x \|\| 26.x`. |
| AC-2: CI test matrix | Pass | node `['24.x','26.x']` × shard `[1,2,3]`; setup-node from matrix; name `test (node N, shard M/3)`. |
| AC-3: Single-version jobs stay on 24 | Pass | `checks` on 24.x; `auto-release.yml` and `docs-refs-check.yml` unmodified. |
| AC-4: Doctor verdict table | Pass | `checkNodeVersion(version = process.version)`; test covers all 7 rows, labels, details; host-dependent test replaced. |
| AC-5: Drift guard | Pass | Exported `SUPPORTED_NODE_MAJORS` drives pass and warn detail; test compares to engines majors; mutation observation in handoff. |
| AC-6: Doctor ✓ on supported runtimes | Pass | Handoff records ✓ on Node 24.21.0 and 26.13.0 (not re-run by review). |
| AC-7: `dist/` fresh | Pass | `dist/cli/index.js` diff matches the `doctor.ts` change. |
| AC-8: Loader on `registerHooks` | Pass | No bare `register`; `registerHooks({ load })`; `CANON_NO_DETACH` kept. Zero DEP0205 on Node 26 is the handoff's claim. |
| AC-9: Build floor unchanged | Pass | tsup `node24`, `@types/node ^24.13.3`. |
| AC-10: Docs agree | Pass | Supported-version prose, job names, required-check list, Dependabot and `ci.yml` comments updated. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted (ruleset swap recorded as `[human_pending]`)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Small, tight change: doctor logic, drift guard, CI matrix, synchronous test loader and docs all agree on Node 24/26. No correctness bugs survived. One doc regression (a standing fact deleted from a protected doc) and a few nits.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

- **nit, doc regression** (`docs/architecture.md:169`, anchored lens): the Merge gate rewrite deleted the standing statement that repository admins bypass the ruleset, which also explains why canon's direct pushes to `main` (task scaffolds, archives, changelog bullets) work. That fact is still true; AC-10 only required updating the check list. Restore the admin-bypass sentence and keep the "no bypass for this PR" point in the human step. Altitude: code-bug-adjacent doc nit, non-blocking.
- **nit** (`docs/architecture.md:169`, anchored lens; related cold-Claude/cold-Codex note on the ruleset swap, flagged by 3 lenses): "Before this change merges, a human must replace…" is a one-time migration instruction in a permanent doc and goes stale after merge. The spec explicitly requires the swap to be surfaced pending in `done.md`; consider trimming the sentence from the doc after merge.
- **nit** (`tests/cli.test.ts:1198`, anchored lens): drift test reads `package.json` via `process.cwd()`; other tests may anchor on `REPO_ROOT`/`import.meta`. Works under `npm test` from the root.
- **nit** (`doctor.ts:251`, anchored and cold-Claude lenses): fail detail hard-codes `24+` separately from `NODE_BUILD_FLOOR`. Spec prescribes the literal and a separate floor (Judgment Call "Doctor fail floor"); a comment tying them would help.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): ruleset still requires old `test (shard N/3)` names and nothing enforces the swap — spec Known Risks and Judgment Calls already decide this (human step before `--ship`, surfaced in `done.md`); out-of-repo, Decided by Human.
- Dismissed (cold-Claude): `auto-release.yml` and `docs-refs-check.yml` stay on 24.x — spec Judgment Call "Runtime for single-version CI jobs" (Human) and AC-3; deliberate oldest-floor policy, not a defect.
- Dismissed (cold-Claude): `registerHooks` interaction with tsx hook order and stability on every 24.x minor — spec Implementation Notes confirm hook order; the handoff reports full suites passing on Node 24.21.0 and 26.13.0; spec records no ExperimentalWarning on 24.14–24.21. Low confidence, unsubstantiated.
- Dismissed (cold-Claude): `SUPPORTED_NODE_MAJORS`, `NODE_BUILD_FLOOR` and engines are three hand-kept values — spec Judgment Calls "Doctor fail floor" and "drift guard" deliberately separate the floor and guard the supported set with a test.
- Dismissed (cold-Claude): tests no longer assert the real `process.version` passes — AC-4 explicitly replaces the host-dependent test; `runDistCli` doctor exit-code tests still run the real runtime. The `match(/\d+/)` engines parse is the spec's Implementation Note; a range like `>=24 <27` is not the declared form.
- Dismissed (cold-Claude): `dist/` reproducibility on Node 26 untested — CI freshness gate runs on the `checks` job (Node 24.x) by design; speculative.
- Dismissed (cold-Codex): no code defects found — nothing to adjudicate.

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
-->
