## Summary

- Adds `CANON_PROVIDER=claude`, which routes every pipeline role to the Claude CLI. With it set, Codex is not required; `canon doctor` and `canon init` check only for `git` and `claude`.
- Pins the provider per task in `status.json` at `canon task new`. Tasks without a pin keep the existing mixed routing. `canon task set <id> provider claude|mixed` switches a task and clears any stored session that belongs to the other backend. Mixed-provider bundles are refused before any agent starts. `codex` is refused as a provider for now.
- Stores a session tagged with its backend, so a session from one backend is never resumed by the other.
- On Claude-provider tasks, a failed implement or spec-review run keeps its session, and the next `canon run` resumes the unfinished work. Spec review's "revised since your last review" note now appears only after a changes-requested round.
- Claude-provider code review runs the anchored and spec-blind Claude reviewers and skips the Codex cold review. The numbered round record is still written, so delta scope works from round 2.
- Gives Claude-held spec-review and implement their own model, effort and budget defaults. `CLAUDE_BUDGET` still overrides them.
- Mixed-mode argv, prompts, goldens and defaults are unchanged.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- The suite was run with `CANON_PROVIDER=claude`, `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT` exported, to confirm the test scrubs hold. The full run has one skipped test, which the handoff does not name. It is probably the `.git/`-writes test in `tests/run-task-safety.test.ts`; check it in CI.
- `npm run sync-templates:check` passes. It is not in the template checklist above.
- Budget parks have been exercised only with fake `claude` executables. A real subscription run and a real budget exhaustion are still to do. The implement budget curve ($10–$60) is a first guess and should be calibrated from the first Claude-mode runs.
- Claude implementers run unsandboxed and rely on the prompt to leave commits to the orchestrator. No commit detection was added.
- Left for follow-up: the wording sweep across README, skills and `.canon/templates/*`, and a few optional review nits (`--ship` and `--dry-run` refuse an invalid pin; the park-resume prompt pastes the raw escalation reason).
