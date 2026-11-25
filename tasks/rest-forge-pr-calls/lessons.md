### Pass gh api an owner-qualified filter that no gh placeholder can reach

*(2026-11-25, source: rest-forge-pr-calls)*

`gh api` expands `{owner}` and `{repo}`, and the legacy `:owner`, `:repo` and `:branch` placeholders, anywhere in the endpoint, query string included. A branch whose name starts with one of those words (for example `repo-x`) had its separator replaced, so the `head=` filter stopped being exact. The result was not wrong, because the code still checked `head.ref`, but the lookup paged through every PR in the repo. Prevention: percent-encode the separator in any query filter built from a user-controlled name (`%3A` for `:`), pin the exact argv for a branch with a placeholder-like prefix, and do not rely on a fake gh to show the encoding is needed, because it does not expand placeholders. Canonical example: `lookupPRByBranch` in `src/orchestrator/forge.ts`.

### Check the API host for each gh subcommand separately

*(2026-11-25, source: rest-forge-pr-calls)*

`gh api` and `gh pr` do not share a host. With an Enterprise `origin` and a github.com login, `gh api` sent requests to api.github.com while `gh pr` used the Enterprise host. `gh api --hostname` also does no normalization: `ssh.github.com` and SSH host aliases such as `git@github-work:` failed. Prevention: before writing a rule that picks an API host, run each gh subcommand with `GH_DEBUG=api` and compare the logged request URLs, and gate any `--hostname` on an offline check such as `gh auth token --hostname`. Canonical example: the host selection in `src/orchestrator/forge.ts`, and the same rule in `.claude/hooks/canon-guard.mjs`.
