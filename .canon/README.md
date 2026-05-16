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

After running `canon upgrade`, check whether structural changes landed in the
canonical template that you should incorporate into your override:

```bash
diff .canon/templates/spec.md tasks/_templates/spec.md
```

## Project-specific validation checks during `implement`

Configure Codex sandbox permissions in the project-owned `.codex/config.toml`
when validation needs more access than the default implement sandbox provides.
Real checks should live in project scripts such as `package.json` commands (or
the local equivalent), not in canon-side policy modules.
