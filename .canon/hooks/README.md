# Project hooks

Drop project-specific scripts here. The orchestrator (`scripts/run-task.ts`) checks for these files at well-defined points in the pipeline and runs them when present. Absence is the default — canon-ai itself ships no hooks.

## Available hooks

### `post-merge.sh`

Runs after task PRs merge to the base branch and before `--ship` archives the task directory. Good for:

- Regenerating derived files (sitemaps, indexes, manifests) that need to reflect the just-merged changes
- Syncing dates / timestamps in content files
- Refreshing build-time caches that don't auto-invalidate

The orchestrator runs the script via `bash <hook-path>` from the repo root, so the file does not need to be executable — the bash invocation works regardless of the execute bit. The script should:

- Be self-contained (don't assume the orchestrator passes args or env)
- Stage and commit any changes it produces (`git add ... && git commit -m "..."`)
- Exit non-zero only on hard failure — recoverable issues should warn and continue, since the orchestrator treats hook failures as non-fatal and logs a warning

Example skeleton:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Regenerate sitemap if content changed since last index
if git log --name-only --pretty=format: HEAD~1..HEAD | grep -q '^content/'; then
  npm run sitemap || { echo "sitemap regen failed (non-fatal)"; exit 0; }
  if [ -n "$(git status --porcelain public/sitemap.xml)" ]; then
    git add public/sitemap.xml
    git commit -m "chore: regenerate sitemap post-merge"
  fi
fi
```

## Adding new hook points

The set of hooks the orchestrator checks is defined in `scripts/run-task.ts`. Adding a new hook means adding a new check site there and a new `<name>.sh` convention here.
