### A nullish fallback never fires on an extractor that returns an empty string

*(2026-10-28, source: agent-backend-role-routing)*

Chaining `extract(a) ?? extract(b)` does nothing when `extract` returns `''` on no match, because `??` only falls through on `null` or `undefined`. The QA done-summary salvage shipped that way. Code review caught it: the raw-stdout fallback never ran, so a summary that appeared only in the agent's text was lost. Prevention: before using `??` to chain a parser, read its no-match return value. If it is `''`, use `||` or test the result for emptiness. Add a fixture where the first source yields no match and check that the second source is used. Canonical example: the `extractDoneMdFromStdout` fallback in `src/orchestrator/phases/qa.ts`, with the no-match return in `src/orchestrator/validation.ts`.

---

### Put one Affected Files entry per table row; the scope parser drops a fused second entry silently

*(2026-10-28, source: agent-backend-role-routing)*

A spec whose Affected Files table had two file entries on one row (the second one after a `||`) lost the second file with no malformed-cell diagnostic. The scope check then halted code review with a pre-flight rejection for a file the spec appeared to list. The planner found it only by running the parser. Prevention: after writing an Affected Files table, run `parseAffectedFilesFromSpec` (in `src/orchestrator/validation.ts`) and confirm every intended path comes back, and keep exactly one file per table row. This applies to any spec that changes a generated file the pipeline must also rebuild, such as a committed `dist/` bundle.
