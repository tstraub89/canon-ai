# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Read-only execution against the current checkout confirmed a nonexistent base produces `gitSafeAtRaw.ok: false` with git stderr, `getPathsInRange: null`, and `getAffectedFiles: []`. Also confirmed the existing full-send scope helper exempts entire mixed bundles containing `changes_requested`, `needs_re_review`, or `spec_gap`, even when a sibling is approved. The proposed “any approved” failure block conflicts with that precedence (F1 in spec-review.md). No implementation changes or full-suite validation were performed in this review phase.

[spec] Round 2: resolved spec-review F1. B now keeps the existing bundle precedence on diff failure (spec_gap halt > requested-changes reroute > scope-failure block only for bundles that would advance); AC-2 extended with mixed-bundle cases; exemption rule must have one shared source with findUnjudgedFullSendFilesFromData.

[plan] Spec contradiction at caller A: the spec mandates "This failure cannot be bypassed with --force." but `getAffectedFiles(origin/<base>)` runs only inside `if (!cliArgs.force)`, so --force would skip the computation and proceed. The message would be false. Plan decision: compute the task-changed set before the --force branch so a three-dot failure dies even under --force. This makes the message true, matches the tree-diff sibling, and follows the Non-Goal "No --force bypass". It is pinned by an extra --force test in tests/run-task-safety.test.ts. Scope is unchanged (main.ts only). Human: confirm this is the intended --force semantics.
[plan] Caller D uses `null` (vs `undefined` = no block) as the could-not-determine signal to the implement prompt builders, so existing builder call sites and golden entries stay untouched.

[implement] Red-first regressions reproduced the current fail-open behavior: approved full-send single/bundle routes exited 0 instead of 2; failed pre-flight diffs became format rejections with changes_requested; the drift message advised rebase, and --force proceeded. After the result union and caller handling were added, all 13 targeted cases passed. The --force probe now runs before the override branch, following the spec's no-bypass rule and the plan decision.

[implement-revision] Round 1: verifyBaseDrift skips its gate when the origin/base fetch fails, so the unreadable-scope SPEC GAP note cannot promise that --pr will catch scope after BLESS. Updated the note/banner to require scope verification before blessing. Also verified that canon task set base_branch is locked once a branch is recorded; the optional recovery hint therefore broadens the diagnostics without suggesting that unusable command. Red-first single/bundle SPEC GAP cases failed on the old assurance before production edits, then passed after removing it.

[implement-revision] Round 2: scope-probe recovery wording must respect the verdict gate it appears under. A plain canon run from blocked code_review can start another review, so the SPEC GAP note must direct the operator to choose FIX (--reroute after amendment) or BLESS, not suggest an independent rerun. The ordinary approved/unjudged scope-block rerun hint remains unchanged. Strengthened single/bundle SPEC GAP assertions failed on the old rerun wording and passed after replacing it.
