### Re-run a sandbox probe under the same flags the pipeline uses before documenting it

*(2026-10-31, source: provider-neutral-vendor-wording)*

A backlog probe of Claude Code's opt-in sandbox (2026-09) ran in default permission mode and reported that network access was denied. Canon's headless sessions pass `--dangerously-skip-permissions`, and under that flag the same sandbox let `curl` through even with `network.allowedDomains` set. The earlier note was true for the mode it tested and wrong for canon's runs. A task that documents, trusts or relies on a permission or sandbox behavior must probe it with the exact flags canon passes, plus one control run in the default mode, and record the Claude Code version. Canonical example: the 2026-10-31 probe in `docs/BACKLOG.md` and the sandbox section of `README.md`.
