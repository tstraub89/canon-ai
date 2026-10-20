# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

- spec: Revised after spec_review round 1 (AC-8 had no defined output channel). Interpretation chosen: crash reason goes to a stderr diagnostic; stdout summary line unchanged. Signal-terminated markers count as non-zero and report death.
- [plan] No spec gaps. Deviation in mechanism only: classifyIdle reads ctx.taskDir/ctx.statusFile directly (no RunContext change); pid-evidence check also requires the pid not be live (probeAlive) to honor the spec's 'pid dead' premise.
