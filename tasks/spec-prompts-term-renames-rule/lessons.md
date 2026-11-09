### Delete unused Validation Required placeholders instead of leaving them unchecked

*(2026-11-09, source: spec-prompts-term-renames-rule)*

The spec's Validation Required list kept an unchecked `<E2E>` line from the template, and the implementer could not tell whether it was a required check or a placeholder. It logged an ambiguity blocker and had to decide on its own that E2E was N/A for a prompt-template-only change. Prevention: when a spec has no end-to-end surface, delete the `<E2E>` line rather than leaving it unchecked, and write the N/A reason in the spec. Before handoff, grep the spec's Validation Required section for any `<...>` placeholder that is still unchecked.
