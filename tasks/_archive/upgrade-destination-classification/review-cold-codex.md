The destination-classification change is largely sound and the test suite passes, but the new unconditional read of an existing docs-refs config can crash `canon upgrade` on a malformed non-file path. That regression makes the patch not fully correct.

Review comment:

- [P3] Guard the docs-refs config read before treating it as a file — /Users/tstraub/canon-ai/dev-worktrees/upgrade-destination-classification/src/cli/commands/upgrade.ts:453-458
  If `scripts/docs-refs-config.mjs` exists but is not a regular file (for example, a directory or a broken symlink), this new `readFileSync` path throws `EISDIR`/`ENOENT` before the classifier can refuse or skip it. The previous code never read an existing config at all, so this is a regression that turns a malformed checkout into a crash instead of a clean refusal or no-op.