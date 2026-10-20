### Anchor a log-marker parser on the marker's tail, not its line start

*(2026-10-20, source: watch-crash-not-step-done)*

A writer that appends an exit marker without a leading newline puts the marker mid-line whenever the output before it lacked a trailing newline. A parser anchored with `^` misses that marker and falls back to the wrong answer; here a real crash was reported as `step_done`. The spec's first amendment added line-start anchoring, and the second reversed it after code review: the regex matches anywhere and requires the ISO timestamp to end the line or file, which also rejects a tail cut mid-marker. Rule of thumb: when parsing a marker a process writes on exit, anchor on the fixed suffix the writer always emits, and test both a marker that follows unterminated output and a truncated tail.

---

### Don't use files an exit handler deletes as crash evidence

*(2026-10-20, source: watch-crash-not-step-done)*

A `process.on('exit')` cleanup that removes runtime files runs on every exit path, clean or not, so the files' absence says nothing about how the process ended. Here the pid and heartbeat files were gone after a crash just as after a clean step exit. Only an exit line written outside that cleanup told the two apart. Rule of thumb: before using a pid or heartbeat file to detect a crash, grep for the cleanup that removes it. If it runs on all exits, only a surviving file is evidence of an unclean exit, and an absent file proves nothing.

---

### When fixing a state classifier, list every entry point that reads the same state

*(2026-10-20, source: watch-crash-not-step-done)*

The crash fix went into the idle classifier, but `canon watch` also classifies at attach time, and the spec's Non-Goals left that path alone. A crash that happened before watch attached still reports `nothing_to_watch` (exit 2), and cold review flagged it as a spec_gap that the operator then accepted. The bug also sat in an earlier specific return (pending-after-done → `step_done`) that shadowed the generic `death` fallback, so the fallback was never reached. Rule of thumb: before scoping a fix to how a status shape is classified, grep every function that classifies that shape (attach-time, loop-time, `--until`), fix each one or name it as a non-goal with its user-visible result, and check whether an early return matches the crash shape before the fallback.
