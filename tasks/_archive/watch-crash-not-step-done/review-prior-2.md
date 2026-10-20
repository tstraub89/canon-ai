# Code Review: watch-crash-not-step-done

> Reviewer: Claude | Spec: `tasks/watch-crash-not-step-done/spec.md`

Synthesized by the foreman from the anchored Claude lens, the cold-Claude lens, and the pre-obtained cold-Codex findings.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no unexplained `Fail` results (`npm test` fail is `tests/run-task-signals.test.ts:359`, outside the task's files; lens judged it an unrelated timing flake)
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Fresh non-zero marker test; reason carried; red-first run recorded in handoff |
| AC-2 | Pass | Dead resolved pid gives death; live pid keeps step_done |
| AC-3 | Pass | Existing clean step_done test unchanged |
| AC-4 | Pass | Final code=0 marker stays step_done |
| AC-5 | Pass | Marker 20s older than status mtime stays step_done |
| AC-6 | Pass | Parser tests: last wins, truncated tail, absent/malformed, signal code |
| AC-7 | Pass | Exit 4, stdout exactly `state=plan reason=death` |
| AC-8 | Pass | One stderr diagnostic with reason and resume hint; SIGTERM case covered |
| AC-9 | Pass | Docs rows and prose updated; template mirror identical |
| AC-10 | Pass | Single unrelated flake recorded |
| AC-11 | Pass | `dist/cli/index.js` is in the committed diff; freshness check not re-run by the lens |
| AC-12 | Pass | Regex anchored at line start; mid-line-only test returns null |

### Dropped Sections Check

- [x] Non-goals respected
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality

### Summary

The implementation matches the written spec and is clean. One real defect survives, and its root cause is the spec: AC-12 mandates line-start anchoring while the Non-Goals forbid changing the marker writer, and `writeExitMarker` (`src/orchestrator/cli.ts:28`) appends the marker with no leading newline. When the agent's final stderr chunk lacks a trailing newline, the marker lands mid-line and is ignored, so the original false `step_done` returns.

### Findings

#### Correctness Bugs

(none — the surviving finding's root cause is the spec; see Spec Gaps)

#### Risk / Guardrails

(none beyond the spec gap below)

#### Optional Cleanup / Nit

- (anchored, cold-Claude) `tests/watch.test.ts` combined classifyIdle test: the "clean marker → step_done" case passes with or without the marker check (code 0 is excluded regardless of timestamp), and the one-second tolerance boundary is untested. Split cases and add a boundary case if convenient.
- (anchored) `src/cli/commands/watch.ts:442-455`: crash-evidence checks could move into a small helper to keep `classifyIdle` flat.

#### Spec Gaps

- **Unterminated stderr hides the exit marker** — `src/orchestrator/run-context.ts:35-36` (flagged by cold-Codex P2 and the anchored lens, 2 lenses; verified against `cli.ts:28`, which writes `■ orchestrator exit …\n` with no leading newline). Spec AC-12 requires `^`-anchored matching so marker-like text mid-line cannot match, and the writer is a Non-Goal. The two together make this valid output sequence undetectable: agent stderr with no trailing newline, then the exit marker. The AC-12 mid-line test (`error: saw ■ …` as the only line) is shaped identically to this case, so a code-only fix would contradict a spec-mandated test. The spec must choose: (a) have the writer emit a leading newline when needed (lifts a Non-Goal), or (b) relax the parse (for example accept a mid-line marker only as the file's final line) and amend AC-12. Handoff acknowledges the behavior as intentional.

### Dismissed Cold Findings

- Dismissed (cold-Claude): dead resolvedPid returns death before the marker is consulted, so a clean exit leaving stale runtime files reads as a crash — spec Decision 1 states this precedence explicitly, and a clean exit removes both files; stale files imply an unclean exit.
- Dismissed (cold-Claude): only the last 64 KiB of the log is scanned — spec Known Risks prescribes tail-only reading; the marker is written at exit, so it is normally at the tail.
- Dismissed (cold-Claude): the `changes_requested` branch lacks crash evidence — explicit Non-Goal (a settled reviewer verdict is a real stop).
- Dismissed (cold-Claude): mtime heuristic can hide a crash after a human `canon task phase`/`accept`, or label a deliberate non-zero exit as death — the guard and "more truthful" non-zero-exit behavior are documented in spec Known Risks.
- Dismissed (cold-Claude): the reason is not surfaced at attach-time or in_progress death emitters — `classifyAttach` and the launch-window path are Non-Goals; stdout contract is unchanged by design.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [x] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
