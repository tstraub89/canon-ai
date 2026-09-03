# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on this repository (**Security → Report a
vulnerability**). You will get an acknowledgement within a few days and a fix or
mitigation plan once the report is confirmed.

Include the canon version (`canon --version`), how canon was installed, and the
smallest reproduction you can share. Task artifacts under `tasks/<id>/` are
often the fastest way to show what an agent session did.

## What counts

canon spawns headless Claude Code and Codex sessions that read and write an
adopter's repository and run its validation commands. Reports we especially
want:

- Ways for content an agent reads (a spec, a handoff, a PR body, a file in the
  repo) to escalate what the pipeline does beyond the task's declared scope.
- Path handling that lets a task id, branch name, or artifact path escape the
  `tasks/` directory or the task worktree.
- Anything that causes canon to push, merge, publish, or delete outside the
  documented `--pr` / `--ship` flows.
- Supply-chain problems in the published npm package or the release workflow.

The trust model canon operates under, including why pipeline sessions run
without interactive permission prompts, is described in the README under
"Trust model".

## Supported versions

Only the latest release on npm receives security fixes.
