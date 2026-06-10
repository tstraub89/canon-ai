## Summary

- `canon upgrade` now detects when a canon task template changed by the upgrade has a customized project override (`tasks/_templates/<name>` or the `CANON_TASKS_DIR_OVERRIDE` equivalent) and prints a heads-up listing each affected override with a copy-pasteable `diff` command for manual reconciliation.
- The nudge is informational only — override files are never written or staged, exit codes are unchanged, and dry-run (`--check`) behavior is preserved. The `--force` path fires the nudge when it force-writes a dirty template (the scenario most likely to have in-flight customizations).
- `taskTemplateOverrideRoot()` is now exported from `src/task/index.ts` so the upgrade path resolves the override root through the same function `canon task new` already uses, including `CANON_TASKS_DIR_OVERRIDE` support.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js` after `src/cli/commands/upgrade.ts` and `src/task/index.ts` changes; committed)

## Notes

- The detection derives the set of template basenames directly from `CANON_OWNED` (no hand-maintained second list) so it stays in sync automatically as templates are added or removed — a drift-guard test asserts this.
- Byte-identical overrides are suppressed: an override that already matches the new canon template content is not listed even when the template was changed by the run.
- The `staleOverrides` computation is placed after the dirty-refusal branch so the contract "non-empty only when the run actually wrote something" holds at every return point, including for programmatic `runUpgrade()` callers.
