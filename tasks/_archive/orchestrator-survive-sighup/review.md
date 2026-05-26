# Code Review: orchestrator-survive-sighup

> Reviewer: Claude | Spec: `tasks/orchestrator-survive-sighup/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, unit tests, build, docs-refs-check — all Pass)
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: SIGHUP handler at module top-level via `warn()`, no `process.exit` | Pass | `scripts/run-task.ts:6-8` — handler installs before the `import.meta.url` guard, calls `warn(...)` only, no `process.exit`. |
| AC-2: Test asserts `child.exitCode === null` after SIGHUP | Pass | `tests/run-task-signals.test.ts:62-69` — 200ms delay, checks `exitCode` and `signalCode` both null, checks stderr for "SIGHUP received; ignoring". Deviation (self-signal harness) explicitly permitted by spec and documented. |
| AC-3: `streamProcess` uses `stdio: ['ignore', 'pipe', 'pipe']` | Pass | `scripts/run-task/agents/stream.ts:32` — only stdin slot changed; stdout/stderr capture and stall logic untouched. |
| AC-4: SIGINT still terminates; verified by test | Pass | `tests/run-task-signals.test.ts:72-81` — sends SIGINT, asserts `signal === 'SIGINT'`, `code === null`. |
| AC-5: `docs/patterns.md` Known Pitfalls entry covers pre-fix failure mode, post-fix behavior, BACKLOG pointer | Pass | Entry at `docs/patterns.md:174` within the Known Pitfalls section. Covers all three required elements. |
| AC-6: BACKLOG entry annotated with "survival fix shipped" parenthetical; checkbox stays open | Pass | `docs/BACKLOG.md` — parenthetical "survival fix shipped 2026-05-25; detach mode and heartbeat-detection layer remain open" prepended; `[ ]` not flipped. |

### Dropped Sections Check

- [x] Non-goals respected — no detach mode, no heartbeat, no `canon doctor` changes anywhere in the diff.
- [x] Known Risks addressed — SIGHUP handler is at module top-level; SIGINT behavior unchanged and tested; no Windows handling (canon only supports POSIX).
- [x] Human Test Plan satisfiable — manual steps remain valid with the shipped changes.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Tight, minimal implementation. The three source changes (entry-point SIGHUP handler, stdin `'ignore'`, `import.meta.url` guard) are exactly what the spec asked for. The test harness is focused and stable — self-signaling avoids the flakiness risk the spec flagged for external `process.kill`. The documented deviation (self-signal vs. external signal) is explicitly permitted in the spec. No correctness issues.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

**optional cleanup/nit** — `docs/patterns.md:174`: the new entry uses a `### ` section heading while existing Known Pitfalls entries use bold-prefixed bullets (`- **Module-load-time path constants...`). Content is complete and correct; this is a formatting inconsistency within the section. Either flatten to a bullet or promote the others to headings for consistency. Non-blocking.

#### Spec Gaps

(none)

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
