### Renaming a required CI job strands the branch ruleset until a human edits it

*(2026-11-08, source: support-node-26)*

A branch ruleset that requires a CI job by name keeps waiting on that name after a rename: the old check never reports again, so PRs sit at "Expected — waiting" and a plain `gh pr merge` can be refused. The ruleset lives outside the repo, so no file change fixes it. Before merging a task that renames or adds required-check jobs, list the old and new names in `done.md` as a pending human step that comes before `--ship`, and confirm the new names have reported green on the PR. The worked example is the `test (shard N/3)` → `test (node N, shard M/3)` rename in `.github/workflows/ci.yml`.
