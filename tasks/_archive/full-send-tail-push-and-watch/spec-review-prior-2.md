# Spec Review: full-send-tail-push-and-watch

> Reviewer: Codex | Spec: `tasks/full-send-tail-push-and-watch/spec.md`

## Shape Check

(no concerns)

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- **Blocking — clean-stop behavior contradicts the referenced crash-evidence helper.** For a full-send task at pending `human_review`, if a dead PID still resolves from runtime files and there is no fresh exit marker, Decision 1 says to report `checkpoint` because there is no live PID or marker (`spec.md:44`). But `findCrashEvidence()` treats a resolved dead PID as crash evidence and returns a death reason before checking the marker (`src/cli/commands/watch.ts:398-400`). Since the spec directs both entry points to use that helper (`spec.md:39-41`), this fixture would report `death`, contrary to the clean-stop rule. Define the intended outcome and add a case for a dead resolvable PID without a marker; the existing helper treats that state as a crash.

### Missing Edge Cases

- Decision 2 says a scaffold-record write failure must warn and leave the commit unrecorded, but no AC exercises that write failure. AC-7 covers an unreadable record at tail-read time, which is a different failure. Add a deterministic write-failure case proving the commit is not accepted for push and the run reaches the existing divergence failure.

### Type Safety / Interface Gaps

- None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (see blocking issue above)
