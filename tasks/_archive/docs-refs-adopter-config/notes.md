# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] The docs-refs config split will need a repo-root-aware test seam, not just a module-global helper, so the missing-config/malformed-config cases can run against temp fixtures without reading the real sibling config.
[implement] Dirty-refusal on the cutover scaffold only fires when `scripts/docs-refs-config.mjs` is a tracked deletion. A dirty existing file leaves `docs-refs-config.mjs` "already present", so the cutover path never queues the scaffold.
[implement-reroute] The amendment makes the checker CLI repo-root-relative: `main()` must load `scripts/docs-refs-config.mjs` from the repo being checked, not from the checker module's sibling. The upgrade cutover also now has to treat config scaffolding and checker deferral as separate decisions.

