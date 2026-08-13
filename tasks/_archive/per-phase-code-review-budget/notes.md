# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] `npm test -- tests/pipeline-policy.test.ts` still ran the full suite because `package.json`'s test script already expands `tests/*.test.ts`; use exact `npm test` for the required full-suite validation record.

