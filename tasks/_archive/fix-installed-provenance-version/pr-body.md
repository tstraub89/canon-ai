## Summary

- Fix canon's task provenance stamp recording the adopter's own commit as canon's identity when canon runs as an installed npm package (global CLI or project dependency) — the stamp discriminated only "vendored submodule" vs. "native checkout" by git topology, so an installed canon fell through to the native branch and picked up the driving repo's `HEAD` as its own (#196).
- Installed-package runs now record `<unavailable>` for the canon commit and a new `canon_version` field naming the executing canon's version instead, while preserving the canon repo slug (including a `CANON_UPSTREAM_REPO` override) and the driving repository's own commit as `orchestrator_commit`.
- Native and vendored modes are unchanged aside from also gaining `canon_version`; a linked worktree of canon's own source still classifies as native, and an installed canon nested inside a submodule adopter still classifies as installed-package (not vendored) — both were misclassification traps caught during spec review and are now covered by dedicated regression tests.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- No production code reads this stamp today — it's an audit/provenance trail only — so this is a truthfulness fix, not a functional one; nothing else changes behavior.
- Baking an exact canon source SHA into `dist` was considered and rejected: committed `dist/` must byte-match a fresh build under CI, and a git SHA changes the moment it's committed while the tagged release is a post-build squash-merge, so a self-referential SHA can never satisfy that gate. Version-only identity is the fix, not a stopgap.
- Classification order matters: installed-package detection (canon's own source path under `node_modules`/`_npx`) runs *before* the git-topology superproject probe, so an installed canon inside a submodule adopter doesn't get misclassified as vendored and re-stamp the adopter's HEAD as canon's.
- Spec review ran six rounds (mostly hardening the two misclassification edge cases above) before landing; code review converged cleanly in one round with no blocking findings across all three review lenses.
