# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] Red-first reroute regression reproduced the exact stale-round verdict mismatch: a fresh appended approval was ignored while the surviving Round 2 `changes_requested` verdict won. A separate discriminating evidence run advanced code_review from a stale approved artifact when the archive pass was removed.

[implement] Golden regeneration intentionally produced no diff: recorded prompt fixtures do not contain a non-advancing reroute-exempt sibling, so the changed archive pointer is covered by the static exempt-line assertions and the real reroute→render production-sequence test instead.
