# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] The Claude interactive path needed a custom `spawn` wrapper because `runCommandOrDie()` inherits stderr and cannot inspect the unknown-`--effort` failure text after the fact.

