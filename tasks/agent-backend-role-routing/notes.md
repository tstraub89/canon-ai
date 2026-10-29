# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[spec_review] QA has no injected-runner parameter today: runQaPhase directly imports runClaude. For AC-8 red-first coverage, use the existing fake-CLI/PATH pattern (run-task-safety QA failure test), or establish a behavior-preserving seam before applying the salvage fix. Focused current-source assertions confirmed raw stream-json misses salvage while its plain-text result succeeds.

[spec_review] The author backend still needs the originating phase for policy lookup: spec and plan share a role but honor different model pins. Focused assertions confirmed distinct spec/plan pins resolve differently on identical task inputs.
spec_review: folded both Codex nits into spec (phase-aware config resolution in Decision 2 + AC-3 case; AC-8 red-first via fake claude on PATH) before clearing gate, on human direction.

[plan] SPEC GAP (scope manifest): the `### Affected Files` table fuses two rows on one line (`tests/run-task-validation.test.ts | … || \`dist/cli/index.js\` | Rebuilt. |`). `parseAffectedFilesFromSpec` drops `dist/cli/index.js` (verified by running the parser). This task changes the CLI bundle (deps.ts, doctor.ts, pipeline-policy.ts, task/index.ts), so code_review pre-flight will auto-block on dist/cli/index.js as out of scope. Fix: split that line into two table rows before code_review. Plan did not edit the spec.
[plan] AC-2's main.ts getter grep also covers printDryRunPlan (main.ts ~1775), which AC-3's call-site list omits (not an invocation). Plan converts it via backend.resolveConfig + displayName with identical output.
[plan] AC-3 oracle = live legacy-runner call with today's call-site args plus literal model/effort/budget tokens under a scrubbed env — not an on-disk argv fixture (prompts embed per-run temp paths; no fixture file in Affected Files).
[plan] AC-6(b)/(c) tests placed in run-task-safety.test.ts (main-loop harness lives there) rather than run-task-validation.test.ts as the spec's table suggests; both files are in scope.

[implement] Red-first checkpoint against 9675e2f2713e31e7c41445eee607e2d5b39c03b8: empty-agent implement retry returned no_session; empty-agent spec did not store author; QA result-event text did not produce done.md. All three assertion failures reproduced before non-test edits and pass after routing/salvage changes.

[implement] Captured the legacy runners' session argv baseline before non-test changes (15 session scenarios, including both fix-ups and both retry backends); fake-binary call-site parity now compares phase/retry wiring with the preserved legacy runner entry points. Cold-review parity pins exec review --base separately. Spec intentionally keeps its omitted cwd, while plan/spec_review/implement/review/QA preserve active cwd.

[implement] Confirmed the plan's malformed Affected Files observation with parseAffectedFilesFromSpec: dist/cli/index.js is omitted with no malformed-cell diagnostic because its literal row is fused onto the validation-test row. Both build bundles are explicitly named by the spec and were rebuilt; the spec/parser were left unchanged. Handoff records the downstream scope-gate concern.

[implement] Docs-refs subprocess fixtures need fs.realpathSync on the checker script path on macOS; the /var alias otherwise misses the script's ESM direct-run guard and falsely returns a clean check. This behavior is already documented by the existing installDocsRefsChecker helper.
code_review preflight: fixed fused Affected Files row (dist/cli/index.js) introduced by conversational spec edit; re-running.
