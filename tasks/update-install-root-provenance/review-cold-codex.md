The update logic is otherwise well covered, but global provenance is not persisted when the command is invoked from a repository subdirectory.

Review comment:

- [P2] Find the repository root before writing global provenance — /Users/tstraub/canon-ai/dev-worktrees/update-install-root-provenance/src/cli/commands/update.ts:489-497
  When a global install is updated from a nested directory such as `/repo/packages/app`, this checks only `cwd/.canon`; it misses `/repo/.canon`, prints that provenance was not recorded, and leaves the invoking repository without the required record even though the install succeeds. Resolve the invoking repository root before choosing the provenance destination.