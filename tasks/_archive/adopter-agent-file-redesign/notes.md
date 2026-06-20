# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `templates/scripts/docs-refs-check.mjs` is still a shipped mirror with `AGENTS.md` / `CLAUDE.md` references, but the spec only names the root `scripts/docs-refs-check.mjs` allow-list entry.
[spec] Round-4 resolution: `templates/scripts/docs-refs-check.mjs` (`:38`/`:253`/`:265`/`:336`) is the auto-synced mirror of the allow-listed root `scripts/docs-refs-check.mjs` and is unchanged by this task — explicitly added to AC-1's allow-list (category a) rather than to Affected Files (nothing edited there). Same pattern for `templates/docs/codebase-map.md:96` (independent adopter stub, correct "Adopter-owned, when present" framing → allow-listed, category e). The other three round-4 BLOCKING sites (`README.md:108`, `product-context.md:58`/`:82`/`:95`, `patterns.md:101`/`:192`/`:193`) ARE edited and were added to the relevant ACs + Affected Files rows.
[implement] `tests/cli.test.ts` root-agent-file assertions need `WORKTREE_ROOT`, not `REPO_ROOT`; the latter still points at the supervising checkout in linked-worktree runs and shows stale AGENTS.md / CLAUDE.md content.
[implement-revision] `docs-refs-check` also parses backtick-like path text inside `handoff.md`; keeping deviation notes free of section-title suffixes avoids false broken-ref hits.
[implement-reroute] `npm test` appends phase telemetry rows to `docs/pipeline-invocations.md` in this worktree; strip those rows before handoff or the docs file stays dirty even when the suite passes.
[implement-revision] The AGENTS/CLAUDE split test now needs to assert the four actual operator norms, not just the retired `Always-On Operator Norms` heading, or the guard can false-pass.




