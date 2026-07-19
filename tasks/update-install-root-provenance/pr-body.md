## Summary

- Fix `canon update` running `npm install` against the invocation directory instead of the directory it's actually installed in — invoking one project's `canon update` from an unrelated repo could silently add `canon-ai` as a devDependency there (#188).
- Fix the update source having no ref pin, so it could install unreleased `main` code that reports the same version as the last tagged release (#189, updater half).
- `canon update` now resolves its real install root (following symlinks), refuses to run unless a manifest at that root already lists `canon-ai` as a dependency, and by default installs the latest final release pinned to an exact commit SHA. `--channel main` and an extended `--ref <ref-or-40-char-sha>` give labeled development installs. Before installing it announces the install location and current/target version+commit; after a successful install it writes a provenance record under `.canon` (write-only for now — nothing reads it yet; `canon doctor` support is a follow-up task).

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt + committed `dist/cli/index.js`; re-verified byte-identical to a fresh build)

## Notes

- A red-first subprocess test reproduces #188 against the actual pre-fix committed build (fake `npm`/`git` on `PATH`, real subprocess) before proving the fix — see `tests/cli.test.ts`.
- One behavior change worth flagging: a globally pnpm-installed `canon-ai` now refuses instead of running `npm install -g` (which, on inspection, was already targeting npm's own global prefix rather than pnpm's real store — a silent no-op wrong-target install, not a working path). I reviewed this trade-off and accepted the stricter fail-closed behavior; a friendlier pnpm-aware refusal message is filed as a follow-up.
- `canon doctor` has zero changes in this diff by design — reading the provenance record is scoped to a separate follow-up task.
- The spec's Human Test Plan (self-update, cross-repo invocation, dev channel, missing-dependency refusal) is covered by the automated red-first/unit suite above; a manual run against a real install is still worth doing before merge.
