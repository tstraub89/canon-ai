<!-- round=2 reviewed_sha=389251c6c15e3be10d3137bec827a2e548d9c509 scope=delta base=8d098d1fac27a5cd9cfd926a78b668fc1e8b08b3 reason="delta" -->

PR listing output may contain multiline JSON objects, which the new line-by-line parser rejects. This can make PR lookups fail for valid responses.

Review comment:

- [P1] Parse jq output without assuming one-line objects — /home/user/canon-ai/.canon/worktrees/rest-forge-pr-calls/src/orchestrator/forge.ts:72-74
  When GitHub returns a PR, `gh api --jq '.[]'` can pretty-print each object across multiple lines. Splitting stdout on newlines then parsing each line makes the first `{` fail as malformed JSON, so PR lookup returns `unreadable` and blocks flows that depend on it. Use compact JSON output or parse the complete jq output instead.