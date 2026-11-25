### When a suite fails only inside the agent sandbox, reproduce on clean main before calling it a regression

*(2026-11-25, source: fix-codex-resume-sandbox)*

Three test files (`tests/agent-backend.test.ts`, `tests/agent-prompt-argv.test.ts`, `tests/blast-radius.test.ts`) use fake `claude` and `codex` binaries. Inside the Codex Linux sandbox those fakes return empty output, so six checks fail, and the same failures reproduce on clean `main`. The implementer had to note that the `npm test` failure was environmental, and the operator had to re-run the suite outside the sandbox before accepting the work. Prevention: when a suite fails only under the agent's sandbox, run the same command on the base branch in the same sandbox, and then outside it, before treating the failure as a regression or as a reason to edit tests. Record both results in the Validation Outcomes table. The fake-binary tests are the usual case, because they spawn child processes that the sandbox constrains.
