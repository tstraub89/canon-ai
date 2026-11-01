# Code Review: provider-pin-agent-free-paths

> Reviewer: Claude | Spec: `tasks/provider-pin-agent-free-paths/spec.md`

Synthesized by the foreman from the anchored Claude lens and the cold-Claude lens (both returned valid charter-format results; neither missing).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results (one timing flake in an unrelated shutdown test passed on rerun, documented in handoff)
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (AC-1, AC-2, AC-7 rows against pre-fix code)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Ship test with `bogus` pin: exit 0, no `Invalid provider`, archived and branch deleted. Red-first row present. |
| AC-2 | Pass | Two-task bundle (`claude` + absent): exit 0, no mixed-bundle refusal, both archived. Red-first row present. |
| AC-3 | Pass | Existing safety test untouched in the diff. |
| AC-4 | Pass | `--dry-run` loop case: exit 1, `Invalid provider`, no stack, not archived, no agent log. |
| AC-5 | Pass | `--ship --dry-run` loop case: same assertions. Gate `!ship \|\| dryRun` keeps the clean refusal. |
| AC-6 | Pass | Malformed `status.json` on `--ship`: exit 1, no stack, task and branch kept. Fixture deviation (`bad branch`) documented. |
| AC-7 | Pass | Doctor with `bogus`: exit 1, `Accepted values` on provider line, `claude` line present, no `codex` line. |
| AC-8 | Pass | Existing doctor/init test untouched. |
| AC-9 | Pass | `docs/pipeline-orchestrator.md` provider paragraph. |
| AC-10 | Pass | Same paragraph. |
| AC-11 | Pass | `docs/architecture.md` and `docs/decisions.md` each gain the clause. |
| AC-12 | Pass | Template mirror matches root edit. |

### Dropped Sections Check

- [x] Non-goals respected (no change to `--dry-run`, parser, `init`/`task` commands, or new doctor status)
- [x] Known Risks addressed (gate excludes dry-run; startup read/validate retained; doctor keeps `claude`; ship-path provider consumers confirmed absent by both lenses)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

A small, well-scoped change. `main.ts` keeps the per-task `status.json` read/validation for every mode and skips only provider resolution for `--ship` without `--dry-run`; doctor derives the all-provider backend intersection from `PROVIDERS` instead of hard-coding. Tests cover each AC, including the stack-trace guards. No correctness defects found.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **Implicit ship-path guard** (flagged by 2 lenses; low severity): with `runProvider` null on `--ship`, a future provider consumer reachable from `shipTasks()` would re-resolve and throw with a stack. Both lenses traced `shipTasks`/`checkDeps` and found none today; spec Known Risks already records this and the code comment documents the dry-run side. Accepted, no action. Altitude: n/a (no defect).

#### Nits / Cleanup (non-blocking)

- `src/orchestrator/main.ts:4049` — `!cliArgs.ship || cliArgs.dryRun` is the negation of `skipAgentDeps` (`ship || dryRun`)... not identical (`ship && !dryRun` vs `ship || dryRun`), so the predicates mean different things; cold lens's drift concern is mild. Optional: name the condition.
- `tests/run-task-ship.test.ts` (AC-6 test) — `assert.match(result.stderr, /branch/)` is loose; matching the validation message would pin it better.
- `tests/cli.test.ts:4222` — the codex `doesNotMatch` regex depends on the `checkBinary` line format; the positive `claude` assertion partly guards against vacuous passing.

### Dismissed Cold Findings

- Dismissed (cold-Claude): `doctor.ts:726-729` empty `PROVIDERS` / future provider without claude would misbehave — `PROVIDERS` is a non-empty constant and the intersection is the correct semantics for any future provider set; theoretical only.
- Dismissed (cold-Claude): `--ship` carries an invalid pin into `_archive` — spec Decision explicitly says ship proceeds with no pin validation or notice; Non-Goals exclude a warning. Cold lens itself notes this is the stated intent.

## Final Verdict

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
