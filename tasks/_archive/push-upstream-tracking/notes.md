# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] `tests/run-task-ship.test.ts`'s fake `gh` helper persists PR state via `FAKE_GH_STATE_FILE`, not `FAKE_GH_PR_STATE_FILE`; the wrong env var makes `--pr` fail when it tries to pin the created PR number.
[implement] The push-failure regression test has to seed at least one allowed dirty task artifact; a clean tree exits before `git push`, so it never exercises the `die("Human review push failed: ...")` branch.
