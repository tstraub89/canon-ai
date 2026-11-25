## Summary

- Resumed non-interactive Codex runs now pass `-c sandbox_mode="workspace-write"`, so they get the same write sandbox as fresh runs. Before this, a revision, pre-flight retry, handoff fix-up, or guardrail retry on a resumed session could run read-only. When the operator's Codex config had no sandbox mode and the project was not trusted, the implementer could not write, and the task auto-blocked at the review-loop cap.
- Fresh, interactive, and cold-review argv are unchanged.
- The README trust model, the canon README and its template mirror, the codebase map, and the two decisions passages now describe the sandbox by mode, so they no longer say resumes are unsandboxed.
- `dist/orchestrator/run-task.js` is rebuilt to match `src/orchestrator/agents/codex.ts`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- The new regression test runs `runCodex` against a fake `codex` that logs its argv and asserts the full resume array. It fails on the pre-fix argv, which is missing the `-c` pair. Its original run is recorded in the task handoff.
- Three test files that use fake binaries (`tests/agent-backend.test.ts`, `tests/agent-prompt-argv.test.ts`, `tests/blast-radius.test.ts`) fail inside the Codex sandbox even on `main`. `npm test` was run unsandboxed: 2250 pass, 0 fail.
- The template check was run as `node --import tsx scripts/sync-canon-templates.mjs --check` because the npm wrapper fails inside the sandbox. It passes.
- Judgment calls to review:
  - I wrote the override value as the quoted TOML string `sandbox_mode="workspace-write"` rather than the unquoted form used for the effort flag. The quoted form is valid TOML and doesn't depend on Codex's raw-string fallback.
  - I kept `--sandbox workspace-write` on the fresh path. Switching fresh runs to the `-c` form would widen the diff and change argv that existing tests pin.
  - I didn't add an explicit cwd on resume. `codex exec resume` has no `-C`, and resumed runs already spawn in the session's original directory.
  - If your Codex config sets a stricter `sandbox_mode`, resumed runs now override it to `workspace-write`, matching fresh runs. Tell me if you'd rather keep the operator setting on resumes.
