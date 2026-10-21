### A scope guard over dirty paths must also snapshot HEAD

*(2026-10-21, source: artifact-lint-agent-fixup)*

A guard that fences what an agent session may change by comparing `git status` output misses a session that stages and commits a previously clean tracked file: the porcelain state returns to clean, so the guard sees nothing. This task's round 2 review caught that gap, and the fix added the resolved `HEAD` to every snapshot. The fix also needs the content of each dirty path, not just the set of paths, because an edit to an already-dirty file leaves the same path list. Rule of thumb: before writing a "the agent may not change X" guard, snapshot the content of every candidate path and the `HEAD` SHA, then compare both after the session. A test should have the session commit an edit to a clean tracked file, not only edit a dirty one.
