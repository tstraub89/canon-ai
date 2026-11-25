# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[implement] `tsx` CLI startup fails in this sandbox when it tries to create `/tmp/tsx-0/*.pipe` (`EPERM`), but running the same script with `node --import tsx` works. Use the direct Node loader form to verify template sync here.

- implement (operator): In this cloud container, `tests/agent-backend.test.ts`, `tests/agent-prompt-argv.test.ts` and `tests/blast-radius.test.ts` fail inside Codex's Linux sandbox (`codex sandbox -c sandbox_mode="workspace-write"`) on clean `main` too (6 fails in agent-backend, the fake `claude`/`codex` binaries return empty output). They pass outside the sandbox. So the `npm test` Fail row is environmental, not a regression. The operator re-ran the suite outside the sandbox before accepting implement. Operator also reverted an out-of-scope README wording change that Codex made to work around a sandbox-only docs-refs failure.
- human_review (operator): CodeRabbit PR #195 flagged that .canon/README.md doesn't name the cold-review lens as a sandbox exception. The human_review allowlist rejects that file post-implement; the gap is pre-existing, so it's tracked under #196 (which rewrites the same sentence) instead of a reroute.
