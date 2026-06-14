# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] The CANON_DETACHED env guard is too broad in detached-pipeline subprocesses because agent/test children inherit the flag; stripping --reroute from the detached child argv keeps the skip scoped to the re-exec child.

