### Check `git ls-files` before planning around a path's tracked state

*(2026-10-27, source: codex-implement-effort-xhigh)*

A commit titled "stop committing dist/" existed on the base branch, but `git ls-files dist` still listed `dist/cli/index.js` and `dist/orchestrator/run-task.js`. A plan written from the commit title would have treated `dist/` as untracked and skipped the rebuild-and-commit step, so the committed bundle would have gone stale. Before a plan assumes a path is or isn't tracked, run `git ls-files <path>` and read the result, not the commit message. For `dist/`, a source change means `npm run build` and committing the rebuilt declared bundles.
