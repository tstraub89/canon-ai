# Code Review: watch-crash-not-step-done

> Reviewer: Claude | Spec: `tasks/watch-crash-not-step-done/spec.md`

Code review is synthesized by a foreman from three lenses: an anchored Claude lens, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator. This is the single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Fresh non-zero marker returns `death` with the reason carried. |
| AC-2 | Pass | Dead `resolvedPid` returns `death`. |
| AC-3 | Pass | No marker and no pid evidence falls through to the unchanged `step_done`. |
| AC-4 | Pass | `code=0` marker stays `step_done`. |
| AC-5 | Pass | Marker older than the status mtime by more than 1 s stays `step_done`. |
| AC-6 | Pass | Parser scans from the last line back, skips malformed lines, and returns null when none is well-formed. |
| AC-7 | Pass | Stable summary line, exit 4, no extra keys. |
| AC-8 | Pass | One stderr `canon watch:` diagnostic with the reason and resume hint. The `signal:SIGTERM` case is covered. |
| AC-9 | Pass | Exit-code rows and the stderr sentence are updated, the sentence sits after the code block, and the mirror is in sync. |
| AC-10 | Pass | Handoff reports 1499 passed, 1 skipped, 0 failed. Anchored lens re-ran `tests/watch.test.ts` (51 pass). |
| AC-11 | Partial (expected) | `dist/cli/index.js` is rebuilt and committed. The post-commit `git diff --exit-code -- dist/` check is run by the pipeline. |
| AC-12′ | Pass | Tail-anchored regex (`\s*$`), mid-line marker accepted, truncated tail rejected. |
| AC-13 | Pass | Candidate dirs cover the main-checkout and resolved primary, then the watched id. The newest marker by timestamp wins. `watchCmd` remembers the primary id from the last live heartbeat. |
| AC-14 | Pass | Worktree/main-checkout regression test is present and passes. |
| AC-15 | Pass | Bundle-secondary test is present and passes. |
| AC-16 | Pass | `tailRunLog` uses the same candidate resolution. |

### Dropped Sections Check

- [x] Non-goals respected (writer, `classifyAttach`, `changes_requested` branch, flags and exit codes untouched)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

The change is small and well contained. `classifyIdle()` gates `step_done` on dead-pid evidence and a fresh non-zero exit marker. One bounded tail parser lives in `run-context.ts`, and `watchCmd` carries the reason to stderr without touching the stdout summary contract. Tests cover parsing, classification, the tolerance boundary, the worktree/main-checkout split and bundles. No surviving code-bug or spec-gap.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

- `docs/pipeline-orchestrator.md` (~line 49): "the failure reason is printed on stderr" is true only for the idle-classification death path. The launch-window and attach death paths print no reason. Consider scoping the sentence to a run that dies after watch attached. (cold-Claude, `watch.ts` and docs)
- `tests/watch.test.ts` tolerance-boundary test (1000 ms vs 1001 ms) depends on `utimesSync` precision. It is stable on APFS and ext4 and could flake on coarse-mtime filesystems. (cold-Claude)
- `src/cli/commands/watch.ts` `classifyIdle` now takes five positional params. An options object would read better next time it grows. (anchored)
- `tailRunLog` takes the first candidate whose log exists, while `classifyIdle` takes the newest marker across candidates. They can differ only when logs exist in both the main checkout and a worktree. This is rare, and the tail stays on the primary's main-checkout log. (anchored, low confidence)

#### Spec Gaps

(none new)

Known and previously accepted, recorded here and not re-raised:
- A `canon watch` started after the run has already died still reports `nothing_to_watch` (exit 2), and a bundle secondary watched after death cannot learn the primary id. Both are the `classifyAttach` Non-Goal. The operator already accepted this as sanctioned at an earlier code_review round, and `done.md` lists it under Open Questions. (cold-Claude, 2 findings)

### Dismissed Cold Findings

- Dismissed (cold-Codex): "Anchor exit markers to the start of a log line" - Amendment Round 2 deliberately made the regex tail-anchored, not line-anchored. `writeExitMarker()` emits no leading newline, so a marker follows unterminated agent output mid-line, and line-start anchoring reintroduced the false `step_done` (see spec Amendment Round 2, AC-12′). A false positive needs agent output that ends in a full marker-shaped string with a valid ISO timestamp and `code≠0`, which is contrived. The writer stays a Non-Goal.
- Dismissed (cold-Claude): "`resolvedPid != null && !orchestratorLive` can misreport a clean `--step` stop as death when a stale heartbeat in another dir survives" - spec Decision 1 makes a surviving dead-pid record crash evidence. The scenario is speculative (low confidence), and no test or trace shows a clean exit leaving a pid behind.
- Dismissed (cold-Claude): "marker followed by more output, or more than 64 KB of later log, makes the reader return null" - the marker is written once, at process exit, as the last output. The 64 KiB tail bound is spec Known Risks guidance. A later `--step` run does not write to this log.
- Dismissed (cold-Claude): "status.json mtime guard can be masked by a later status write, and mixes clocks" - this is the spec's chosen design (Decision 2, AC-5, Known Risks "Clock/mtime granularity"). It biases toward reporting a crash, and the logs and status share one host.
- Dismissed (cold-Claude): "`canon stop` / Ctrl-C reports death (exit 4)" - spec Decision explicitly includes `signal:<NAME>` as non-zero and says this is intended. It is listed in `done.md` Open Questions for the operator to confirm.
- Dismissed (cold-Claude): "`statSync` failure treats a missing status file as fresh" - effectively dead code, because status was just read successfully. The bias toward death matches the spec's "prefer reporting a crash".
- Dismissed (cold-Claude): "`runLogCandidateDirs` test is environment-sensitive" - the test uses temp-dir paths and asserts the dedupe and ordering logic. It is not an invariant violation.
- Dismissed (anchored): `!orchestratorLive` redundancy, the greedy `(.*)` reason with quoted marker text, and the `readSync` short-read note - all low confidence, with no practical impact (a regular-file read of ≤64 KiB is complete, and the pid is already dead when this branch is reached).

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
