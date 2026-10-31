# PR Body: provider-neutral-vendor-wording - Make user-facing role and vendor wording match CANON_PROVIDER

## Summary

- Rewrites user-facing role and vendor wording so it is true under both `CANON_PROVIDER=mixed` (the default) and `CANON_PROVIDER=claude`. Roles are named first, and each statement says who holds the role in each mode.
- README: adds a provider section under "How it works", makes the install, Prerequisites, `canon doctor`, tier, `delicate` and privacy lines provider-conditional, and documents the opt-in Claude sandbox with its observed limits.
- CLI help (`RUN_USAGE`) and the two review scope-reason strings no longer name Codex. The scope reasons say "round record", since Claude-mode runs write round records rather than cold-Codex archives.
- Skills, artifact bylines (`spec.md`, `spec-review.md`, `handoff.md`), `review.md`, `.canon/README.md`, `AGENTS.md`, and the operator docs are updated to match. Mixed-mode facts are kept and qualified.
- No behavior, prompt, routing or default changes. The prompt golden files are unchanged.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [ ] `npm test` — fails with one reproducible failure at `tests/task-cli.test.ts:1238`, outside this change's files (see Notes)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- `npm test` fails at `tests/task-cli.test.ts:1238`: the reset-code-review fixture gets an older scaffold than the expected worktree template. I have not confirmed on `main` that it fails there too. Isolated repro is in `tasks/provider-neutral-vendor-wording/handoff.md`. Because of this, the spec's AC-12 is partial.
- The Claude sandbox section was checked on Claude Code 2.1.312 with headless `claude -p --dangerously-skip-permissions`. Under those flags, Bash writes outside the repo are blocked, network is not confined, and `allowUnsandboxedCommands: false` is needed to close the escape hatch. The sandbox is opt-in; canon neither scaffolds nor requires it. `docs/BACKLOG.md` records the probe.
- `tests/cli.test.ts` pins README strings and the permission allowlist, so those are unchanged.
