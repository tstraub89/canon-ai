## Summary

- Rewrote `/canon-pipeline` skill §5 from a single release-branch-per-version walkthrough into a model-neutral core plus four named recipes (release-branch-per-version, trunk-from-main, tag-from-main, no versioning); each recipe defers to the adopter's own release policy doc as the source of truth; `base_branch` is called out as per-task so hybrid repos are first-class
- Neutralized the two residual release-branch assumptions in `/canon-changelog` (base-detection heuristic and finalize-mode version-bump note) without changing any other behavior
- Added a "Canon prescribes no release model to adopters" decision entry to `docs/decisions.md` as a durable anti-regression guard; corrected stale `dev`-branch parentheticals in the existing versioning entry

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [ ] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed) — N/A: skills and docs are not bundled; no source change

## Notes

Documentation-only change — no orchestrator source, `dist/`, `AGENTS.md`, `CLAUDE.md`, or `docs/release-process.md` modifications. The `templates/.claude/skills/` mirrors for both skills are auto-synced by the pre-commit hook; both root and mirror paths appear in the handoff Changes table.

Two optional nits from code review are not addressed and can be cleaned up as a follow-up: a duplicate "check working tree state" guard at the end of §5 in the pipeline skill (the preamble copy is more effective), and the new decisions.md Rule's enumeration omits `docs/pipeline-orchestrator.md` from the CANON_OWNED list.
