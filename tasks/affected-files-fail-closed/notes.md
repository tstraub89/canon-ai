# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Read-only execution against the current checkout confirmed a nonexistent base produces `gitSafeAtRaw.ok: false` with git stderr, `getPathsInRange: null`, and `getAffectedFiles: []`. Also confirmed the existing full-send scope helper exempts entire mixed bundles containing `changes_requested`, `needs_re_review`, or `spec_gap`, even when a sibling is approved. The proposed “any approved” failure block conflicts with that precedence (F1 in spec-review.md). No implementation changes or full-suite validation were performed in this review phase.

[spec] Round 2: resolved spec-review F1. B now keeps the existing bundle precedence on diff failure (spec_gap halt > requested-changes reroute > scope-failure block only for bundles that would advance); AC-2 extended with mixed-bundle cases; exemption rule must have one shared source with findUnjudgedFullSendFilesFromData.

[plan] Spec contradiction at caller A: the spec mandates "This failure cannot be bypassed with --force." but `getAffectedFiles(origin/<base>)` runs only inside `if (!cliArgs.force)`, so --force would skip the computation and proceed. The message would be false. Plan decision: compute the task-changed set before the --force branch so a three-dot failure dies even under --force. This makes the message true, matches the tree-diff sibling, and follows the Non-Goal "No --force bypass". It is pinned by an extra --force test in tests/run-task-safety.test.ts. Scope is unchanged (main.ts only). Human: confirm this is the intended --force semantics.
[plan] Caller D uses `null` (vs `undefined` = no block) as the could-not-determine signal to the implement prompt builders, so existing builder call sites and golden entries stay untouched.
