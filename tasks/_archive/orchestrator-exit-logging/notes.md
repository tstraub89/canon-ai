# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] The exit marker is emitted from the `process.on('exit')` hook; the tests only become stable if codex/crash fixtures let the process reach a natural exit after the failure path runs.
