# Code Review: post-ship-cleanup

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored-Claude (approve), cold-Claude (approve), cold-Codex (one P2). All returns valid.

## Stage 1 — Spec Compliance (gate)

| AC | Result | Note |
|---|---|---|
| AC-1 | Met | `STOPLIST` + `[a-z]{2,}` in `blast-radius.ts`; test asserts `['Widget','URLParser']`; red-first row present |
| AC-2 | Met | `gitGrep` returns `[]` only on status 1, throws otherwise; shim test covers status 1 and empty-stderr status 2 |
| AC-3 | Met | `excludedPath` checks `PIPELINE_TELEMETRY_FILE_SET`; test covers stem reference and identifier hit |
| AC-4 | Met | Pass-through control asserts non-empty block |
| AC-5 | Met | `<reason>` branch and `bare` parenthesis rule; bold/code/`<reason>` invalid cases and `N/A — no tests changed` valid case added |
| AC-6 | Met | `main.ts` comment names `validateHandoffAgainstSpec`; patterns/product-context name `classifyPreflightBlockers` with `validateHandoff()` as test-parity |
| AC-7 | Met | `/^:?-+:?$/` and `||` fallback, both tested |
| AC-8 | Met | P3–P5, P7 landed in root docs, mirrors, README, write-guide |
| AC-9 | Met | P6 test asserts exact header line |

- [x] Validation Outcomes table has no `Fail` results
- [x] All required validation checks were run
- [x] Red-first evidence recorded for red-first ACs
- [x] Non-goals respected
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan satisfiable

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality

### Findings

No `code-bug` or `spec-gap` findings survive. Nits:

1. **Parenthesized-evidence rejection** (`src/orchestrator/validation.ts:112`, and the `<reason>` check at `:110`) — flagged by 3 lenses (cold-Codex P2, cold-Claude, anchored as nit). Evidence like `(verified both entry points)` or `(N/A)` is rejected as a placeholder, and any evidence quoting `<reason>` is rejected. This is the behavior spec S1 prescribes: Decision S1 ("starts with `(` and ends with `)`", "containing the literal `<reason>`"), the Judgment Calls row "Placeholder shape" (decided by Author), and the Known Risks bullet "Placeholder rule" (accepted; the message names the fix). Cross-model agreement is acknowledged, not waved off: the cost is a one-round evidence retry, and the rejection message says how to fix it. Disagreement recorded here; a narrower exact-placeholder match is a possible follow-up if retries show up in practice. Altitude if pursued: spec change, not an implementation fix.
2. **Untested null-status (signal) branch of `gitGrep`** (`tests/blast-radius.test.ts`) — AC-2 requires only status 1 and empty-stderr status 2. Optional.
3. **Shared-fixture rewrite in P6 test** (`tests/run-task-prompts.test.ts`) — rewrites `spec.md` and restores in `finally`; safe while tests in the file run serially. Optional.

### Dismissed Cold Findings

- Dismissed (cold-Claude): separator `-+` turns a `| - | - |` data row into a separator — spec P1 explicitly requires `:?-+:?` to match GFM and sibling parsers.
- Dismissed (cold-Claude): `[a-z]{2,}` drops `APIv`/`UIx` tokens — spec B2 and Known Risks "Acronym shapes" accept this; map is advisory.
- Dismissed (cold-Claude): `STOPLIST` is case-sensitive, so `DONE`/`TODO` are not covered — spec B1 requires a case-sensitive exact-token list; `DONE` also fails the shape rules.
- Dismissed (cold-Claude): `??` → `||` only applied in `buildRelevantPitfalls` — swept `src/` for other `CANON_*` `??` reads; the rest are version, tasks-dir, or other overrides outside P2's scope (empty `CANON_TASKS_DIR_OVERRIDE` is not in this task).
- Dismissed (cold-Claude): `gitGrep` now throws on exit 2 with empty stderr — intended by spec B3; the caller's try/catch keeps the map fail-open (fail-open test covers it).
- Dismissed (cold-Claude): git-shim test fragile on Windows / without `node` on PATH — engines require Node, so `node` resolves; the existing fail-open test uses the same shim pattern. Low value.
- Dismissed (cold-Claude, duplicate of nit 3): shared `spec.md` fixture race — the runner is serial per file.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
