# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] `EXPECTED_TEMPLATES` in `src/cli/commands/doctor.ts` was module-private, so the drift-guard test needed the symbol exported instead of duplicating the template list.

