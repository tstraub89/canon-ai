<!-- round=1 reviewed_sha=5f0fd5d59f03cdac8725d68f68d8952caea5d9a8 scope=full base=main reason="Round 1 (initial review)" -->

The patch assigns conflicting severity to the same judgment-call omission in the self-review skill and the pipeline spec-review prompt. This can produce inconsistent review outcomes.

Review comment:

- [P2] Align the judgment-call severity across review prompts — /Users/tstraub/canon-ai/.canon/worktrees/spec-judgment-calls/.claude/skills/canon-spec-review/SKILL.md:71-71
  When the self-review skill finds an unlisted judgment call, it classifies it as STRONG, but the spec-review prompt classifies the same finding as Blocking and requires `changes_requested`. This can make the recommended pre-pipeline review treat a spec as ready when the pipeline reviewer would reject it; align the severity across both paths. This contradicts the review contract guidance in [AGENTS.md](AGENTS.md) §Code Review Rules.