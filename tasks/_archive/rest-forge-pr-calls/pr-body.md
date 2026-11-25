## Summary

- Route every `--pr`, `--full-send` and `--ship` GitHub call through the REST API (`gh api`) instead of `gh pr …` and `gh repo view`, which run on GraphQL. The new `src/orchestrator/forge.ts` owns all of them.
- Fixes environments where GraphQL is blocked, such as Claude Code cloud sessions. Before this, `--pr` pushed the branch and then failed at PR creation, and `--ship` stopped in its pre-flight listing even when the PR had been merged by hand.
- The PR-merge guard hook reads a PR's head over REST as well, so its block on `gh pr merge` of task PRs still works in those environments. It used to fail open silently there.
- The API host is the `origin` remote's host, passed as `--hostname` only when `gh auth token` accepts it. `*.github.com` hosts normalize to `github.com`.
- Corrects the gh hints in `canon doctor` and `canon init` (gh is needed for `--pr` and `--ship`, not `--push`), and the `--force` list in `canon run --help`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Not run yet: the live check against GitHub in a GraphQL-blocked environment. The tests use a fake `gh` that answers only `gh api`, and they cannot check real `gh api` flags.
- The draft PR body falls back to the branch's commit subjects when there is no canon body, QA body or repo template, in place of `gh pr create --fill`.
- Judgment calls, which I did not confirm during spec review:
- REST for every call, with no GraphQL fallback. One code path, so the GraphQL path is not tested separately.
- Repo slug comes from gh's own `{owner}/{repo}` resolution, so `gh repo set-default` still applies. The host comes from `origin`.
- Commit-subject body fallback lists `origin/<base>..<branch>`, one subject per line, in place of `--fill`.
- Kept the task at M and not delicate, although the merge proof gates branch deletion and archive. The proof logic is unchanged; only its data source moved.
- Fixing the guard's PR-head lookup is in this change, not a separate task, because it was the same root cause and a silently disabled safety check.
- Guard ref handling: a number or `#<n>` reads the PR's head over REST, a PR URL uses its own host and repo, and `<owner>:<branch>` or a plain branch name is taken as the head directly.
- #184 is limited to the two text fixes. Which commands require gh is unchanged.
- Host gating: an `origin` host is used only when `gh auth token` accepts it. An Enterprise origin written as an SSH alias, with gh logged in to several hosts, falls back to gh's default host. Set `GH_HOST` to work around it.
