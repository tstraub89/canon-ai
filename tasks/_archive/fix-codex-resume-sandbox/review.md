# Code Review: fix-codex-resume-sandbox

> Reviewer: Claude (foreman synthesis) | Spec: `tasks/fix-codex-resume-sandbox/spec.md`

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Inputs: anchored Claude lens, cold-Claude lens, cold-Codex findings (injected). Archive: `tasks/fix-codex-resume-sandbox/review-cold-codex-run-1.md`.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results (handoff reports `npm test` run outside the Codex sandbox; lenses did not re-run)
- [x] Required checks were run
- [x] No required checks skipped without justification
- [x] Red-first evidence recorded for AC-2
- [x] Self-Check evidence not contradicted by the diff

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `src/orchestrator/agents/codex.ts:80-82` resume argv matches; fake-`codex` test in `tests/agent-backend.test.ts` asserts the full array |
| AC-2 | Pass | Red-First Evidence row records the pre-fix failure (missing `-c` pair) |
| AC-3 | Pass | Fresh, interactive, and cold-review argv untouched |
| AC-4 | Pass | Parity, safety-scaffold fix-up, and reroute-preflight resume assertions updated |
| AC-5 | Pass | README, `.canon/README.md` + mirror, codebase-map, both decisions passages updated |
| AC-6 | Pass | `dist/orchestrator/run-task.js` diff matches the `codex.ts` change |

### Dropped Sections Check

- [x] Non-goals respected
- [x] Known Risks addressed
- [x] Human Test Plan satisfiable

### Stage 1 Verdict

- [x] **Pass**
- [ ] **Fail**

## Stage 2 — Code Quality

### Summary

A minimal, correct change: the resume argv gains `-c sandbox_mode="workspace-write"` before the prompt, with tests and docs aligned. No surviving code-bugs or spec-gaps.

### Findings

#### Correctness Bugs

(none)

#### Nits (optional)

- Nit (anchored): `tasks/fix-codex-resume-sandbox/handoff.md` Changes table README row still mentions removing a stale local-settings reference that the Deviations row says the operator reverted; the README diff confirms only the Trust model bullet changed.
- Nit (anchored): `tasks/fix-codex-resume-sandbox/handoff.md` Ready for Review "deviations documented" box is unchecked although the Deviations table is filled.
- Nit (anchored, low confidence): `tests/agent-backend.test.ts:31-60` mutates `process.env.PATH` in-process; restored in `finally` and safe under serial `node:test`.

### Dismissed Cold Findings

- Dismissed (cold-Claude): literal `sandbox_mode="workspace-write"` could drift from the fresh `sandboxFlags` — the spec's Judgment Calls deliberately keep the fresh flag form; the two syntaxes differ by necessity (`exec resume` has no `--sandbox`), and tests pin both.
- Dismissed (cold-Claude): unverified that `codex exec resume` accepts `-c` at that position — spec records an executed repro on codex-cli 0.172.0 using this exact override; `--help` lists `-c`.
- Dismissed (cold-Claude): tracked `dist/` risks drift — AC-6 requires the committed bundle to match a fresh build, and the diff matches `codex.ts` exactly.
- Dismissed (cold-Codex): no findings reported.

## Final Verdict

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
