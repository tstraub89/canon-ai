# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[plan] AC-6 vs generic warning: spec says `human_spec_gate false` on a spec_review-done task prints neither the note nor the generic warning, but such a task is always "started" so the existing rule would warn. Interpretation: for field human_spec_gate with spec_review done, suppress the generic warning for both values (arm prints the note; disarm prints nothing). No spec change.
[plan] No other contradictions found; no orchestrator edits needed (AC-8 pins existing behavior).

[implement] AC-6 says disarming an already-reviewed task prints neither the reroute note nor the generic started-task warning, so `taskSet()` suppresses the generic warning for either gate value when `spec_review` is done. Other started states retain the warning.
