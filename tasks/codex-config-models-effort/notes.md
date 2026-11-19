# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[spec_review] `tests/run-task-safety-routing.test.ts:768` embeds a `recordMetric` call in a subprocess JavaScript string, so a required `MetricEntry` field does not produce a type-check error there. Include this caller when updating the effort contract. Its existing targeted test passes on the current code (1 passed, 0 skipped).

[spec] Round 2: added tests/run-task-safety-routing.test.ts to Affected Files and AC-9 (string-embedded recordMetric caller). Re-grepped recordMetric across src/tests/scripts: no other string-embedded callers.

[plan] Spec is silent on an unparseable main-checkout `.canon/config.json` in worktree mode (shared loader reads the worktree copy, so main's JSON error was invisible before). Plan treats it as a hard error on the Codex path (startup + each Codex resolution), since "no section" would silently ignore Codex settings. This flips `tests/run-task-ship-docs-fold.test.ts` "dry-run config source: worktree invalid, main opposite" — plan changes that fixture's main file from `{` to `{"docs_freshness": 5}` to keep its intent. Human may veto at human_review.
[plan] `VALID_CODEX_EFFORTS` moves to `src/lib/pipeline-policy.ts` (re-exported from agents/codex.ts): leaving it in agents/codex.ts would create policy → docs-freshness → agents/codex → policy cycle.
[plan] Test injection uses an optional `root` parameter on `getCodexConfig`/`requireCodexSection` plus spawned processes with a temp cwd, not a new env var (a new env knob would be an unlisted judgment call).

- [implement] The pre-existing dry-run config-root fixture assumed malformed main-checkout JSON could be ignored when the worktree file was valid. Codex's required main-checkout read now makes that case fail before resolution; docs-freshness/ship still use their existing roots. Updated that in-scope fixture accordingly.
- [implement] Doctor's docs-freshness check also warns about missing default protected docs in a scratch repo. The independent Codex-check fixture supplies an empty protected set so its Pass assertion tests section isolation rather than missing fixture files.
- [implement-revision] A cross-checkout ownership fixture needs syntactically valid JSON with semantically invalid settings in the checkout that should be ignored. Malformed JSON can fail an independent section reader first and erase the property the test was meant to guard. Split ignored main docs/ship settings from malformed-main and malformed-worktree JSON; the two success assertions fail under a scratch mutation that makes the Codex loader validate main's docs/ship settings.
