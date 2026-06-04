# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] Removing the release-init block also removed `readJsonFile` at first; that helper is still shared by live task paths in `src/task/index.ts`, so lint surfaced the regression immediately and I restored it before validation.


