# .canon/

Files in this directory are managed by canon. **Do not edit them directly.**

`canon upgrade` overwrites files here to keep them in sync with the installed
version of canon-ai. Any edits will be lost on the next upgrade.

## Customizing task templates

To override a task template for this project, copy it to `tasks/_templates/`:

```bash
cp .canon/templates/spec.md tasks/_templates/spec.md
```

`canon task new` checks `tasks/_templates/` first and falls back to
`.canon/templates/`. Files in `tasks/_templates/` are never touched by
`canon upgrade`.

After running `canon upgrade`, the command automatically flags any task-template
overrides that differ from a canon template changed by that upgrade. Those
override files are not updated automatically; review the delta and fold any
structural changes into your customization:

```bash
diff .canon/templates/spec.md tasks/_templates/spec.md
```

## Project-specific validation checks during `implement`

Real checks should live in project scripts such as `package.json` commands (or
the local equivalent), not in canon-side policy modules. Canon's pipeline runs
Codex with `--sandbox workspace-write` (writes within the worktree, plus
network access) — appropriate for the checks an `implement` phase typically
runs (lint, type-check, unit tests, build).
