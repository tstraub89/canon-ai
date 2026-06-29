# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] The vendored-mode fallback now probes the parent directory's git top-level too, so fake git fixtures need explicit responses for `rev-parse --show-toplevel` at both the repo root and its parent.
[implement] `CANON_UPSTREAM_REPO` override is call-time and trims whitespace before falling back, so env tests need to mutate `process.env` after import rather than relying on module load state.
[implement-reroute] Review artifacts can trip `docs-refs-check` even when they are not part of the implementation surface, so path-like prose in `tasks/*/review.md` needs the same citation hygiene as docs and handoffs.
