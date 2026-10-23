# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[plan] Classification judgment calls (no one to ask in an unattended session; I went with the interpretation in plan.md §Open Questions):
- `main.ts:2963` (the post-reroute "combine the flags … `canon run <id> --reroute --step --expect …`") is classified exempt as an alternate invocation form. Run literally from the post-reroute state it would be refused, because spec_review/implement are not reroute-admitted. If review calls it actionable, AC-5 rewords it.
- `orchestrator/cli.ts:236` (`--reroute` + `--full-send` refusal, "Run --reroute first") is classified exempt as an argv refusal.
- `task/index.ts:374` (the `task phase … sanctioned` redirect to `canon task accept`) is classified actionable. Only the code_review form gets a fixture, from a spec_gap halt. Whether the spec_review form is accepted is accept's own state contract (Non-Goal).
- `specGateDoneNote` ("add an amendment", no round) is left as is; the spec says it is not wrong. At reroute_count ≥ 1, a bare `## Amendment` aborts with a message that names the expected heading.
[plan] AC-4 placement: the heading rule moves into a new exported `rerouteAmendmentHeading(status)` in main.ts. rerouteFromHumanReview's pre-flight and the spec_gap hint both call it, so the hint cannot drift from the pre-flight check. validation.ts is not in Affected Files, so the helper lives in main.ts.

[implement] The current-tree scan finds 56 matching source lines: 11 actionable registry entries and 45 exempt entries. The registry stays tied to the final source tree, and its real-tree assertion checks that all actionable entries name declared fixture tests.

[implement-revision] A fixture that writes a plausible top-level `status` field can still exercise a different phase: phase identity is derived from `status.phases`. Assert the derived phase before testing a state-specific hint. Likewise, test a loop-cap hint through the phase runner or `main()`, because calling only the loop evaluator never exercises the operator-facing emitter or escalation persistence.

[implement-revision] `## Amendment (full-send scope)` contributes Affected Files entries but is intentionally excluded from the human `--reroute` amendment gate. A scope hint that recommends the next `## Amendment Round N` lets BLESS pre-satisfy a later reroute without a human amendment; test by following the emitted scope instruction, blessing, then running the printed reroute.
