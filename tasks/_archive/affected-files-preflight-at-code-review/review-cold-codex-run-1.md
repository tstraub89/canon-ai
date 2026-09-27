<!-- round=1 reviewed_sha=8e035575972236fec36c33d7a7904f5450caf131 scope=full base=main reason="Round 1 (initial review)" -->

The new full-send scope gate can accept unamended out-of-scope files based on a changes-requested verdict that may concern an unrelated issue. Type-check and lint pass, but this weakens the intended scope enforcement.

Review comment:

- [P2] Tie changes-requested verdicts to each out-of-scope file — /Users/tstraub/canon-ai/.canon/worktrees/affected-files-preflight-at-code-review/src/orchestrator/phases/code-review.ts:438-441
  When a full-send review has multiple out-of-scope files, a `changes_requested` verdict for any unrelated issue exempts every unamended file from the post-review check. The review can therefore pass with some files never judged; verify that each unamended path is covered by a finding requiring its removal, rather than treating the bundle-wide verdict as sufficient.