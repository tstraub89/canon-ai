# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] Implement retry preservation only holds if the retry fixture keeps `sessions.codex` in `status.json`; a retry stub that rewrites status without sessions makes the rollback test look like a bug in `taskPhase`.
[implement] The implement success path still runs `autoCommitCode()`, so success-path fixtures need fake `git log` output even when no staging happens.
