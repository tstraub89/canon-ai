# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

- spec: Revised after spec_review round 1 (AC-8 had no defined output channel). Interpretation chosen: crash reason goes to a stderr diagnostic; stdout summary line unchanged. Signal-terminated markers count as non-zero and report death.
- [plan] No spec gaps. Deviation in mechanism only: classifyIdle reads ctx.taskDir/ctx.statusFile directly (no RunContext change); pid-evidence check also requires the pid not be live (probeAlive) to honor the spec's 'pid dead' premise.
- [implement-reroute] `writeExitMarker` can append its marker directly after non-newline stderr output, but Amendment AC-12 explicitly requires line-start parsing and the writer is a non-goal; anchored parsing therefore intentionally ignores such a marker.

[plan] Reroute 1: writeExitMarker emits no leading newline, so a marker following un-terminated stderr output sits mid-line and the spec-mandated `^` anchor (AC-12) will miss it (falls back to step_done). Implemented as specced; writer change is a Non-Goal. Consider a follow-up to prefix the marker with a newline.

[plan] reroute round 2: leading-newline risk from round 1 is resolved by the amendment (tail-anchored regex). Existing mid-line test at tests/watch.test.ts:569 asserts null for a marker that now matches; replace it per AC-12'.

- [implement-reroute] The Round 2 amendment resolves the line-start risk by requiring unanchored marker search constrained by the ISO timestamp at end of line/file; the writer remains unchanged.

[2026-10-20] Operator accepted code_review via `canon task accept` — sanctioned (agent verdict overridden). Reason: Only remaining finding (classifyAttach on late attach) is an explicit Non-Goal and yields nothing_to_watch, not a false healthy report; filed as a follow-up issue. Flaky run-task-signals test passes in isolation; QA reruns the full suite..
