The new scope resolver allows delta reviews for delicate tasks that are not XL, contrary to the stated full-review policy. Type-checking and tests pass, but the tests only cover delicate tasks when they are also XL.

Review comment:

- [P2] Force full review for delicate tasks — /Users/tstraub/canon-ai/.canon/worktrees/code-review-delta-rerounds/src/lib/pipeline-policy.ts:45-45
  When a task is marked delicate but its effective size is not XL, this condition does not force a full review, so later rounds can be delta-scoped. The intended policy is full review for delicate tasks regardless of size; check `facts.delicate` independently of the XL condition.