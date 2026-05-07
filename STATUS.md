# canon-ai — Bootstrap Status

> Generated: 2026-05-07. Reflects the v0.0.1 initial extraction.

## Built

- **Orchestrator** (`scripts/run-task.ts`, ~4100 lines): full multi-agent pipeline. Phase routing, worktree isolation, session resumption, auto-block on runaway review loops, bundle mode, `--reroute` / `--ship` semantics, auto-commit guardrails, telemetry flush.
- **Policy module** (`scripts/pipeline-policy.ts`, 193 lines): pure tier / sizing / model-effort matrix / loop-cap routing. Table-tested.
- **Task helper** (`scripts/task.sh`, ~600 lines): `new` / `list` / `status` / `phase` / `reset-spec-review` / `post-merge-sync` / `release-init`. `release-init` package.json + CHANGELOG bumps are conditional on file existence (works for non-Node projects).
- **Tests** (`tests/`, 58 passing): `pipeline-policy.test.ts`, `run-task-parse-porcelain.test.ts`, `run-task-validation.test.ts`.
- **Workflow rules** (`AGENTS.md` / `CLAUDE.md` / `CODEX.md`): generalized — strips source-project tech-stack specifics, keeps the load-bearing structure and discipline. Implementation Rules sections are TODO[canon] placeholders.
- **Task lifecycle templates** (`tasks/_templates/`, 8 files): genericized. Validation tables use placeholder commands; path references use `<path>`.
- **Knowledge corpus templates** (`docs/`, 8 files): detailed scaffolding with format explainers, synthetic examples, and TODO[canon] markers. `pipeline-orchestrator.md` is fully populated (it's pipeline-specific). The other 7 are scaffolding for the user to fill in.
- **Agent CLI configs** (`.codex/config.toml`, `.claude/settings.json`): minimal allowlist for the pipeline's bash needs, SessionStart hook surfacing in-progress tasks.
- **Top-level scaffolding**: `LICENSE` (proprietary), `package.json`, `tsconfig.json`, `.gitignore`, `README.md` as product spec.

## Stubbed (`TODO[canon]:` markers)

- `AGENTS.md` — Validation Matrix table content, Implementation Rules sections (State / Styling / Perf / Testing / Gating / Assets / Analytics)
- `CLAUDE.md` — Codebase Navigation section, Commands section, CI section
- `CODEX.md` — Validation Checklist content
- `docs/patterns.md` — trigger table rows + actual patterns + Known Pitfalls (currently 1 example pattern + 1 example pitfall to show shape)
- `docs/decisions.md` — empty for the user. Canon's recommended-default policy for the `delicate` flag is documented in `docs/pipeline-orchestrator.md` instead, since it's load-bearing for the orchestrator's tier promotion rather than a per-project decision.
- `docs/codebase-map.md` — actual file maps
- `docs/lessons-learned.md` — currently empty by design (entries land here from QA distillation)
- `docs/task-quality-log.md` — currently empty by design (rows land here per task)
- `docs/product-context.md` — actual product overview, terminology, flows, business rules
- `docs/architecture.md` — tech stack, high-level diagram, data flow

## Not extracted (deferred to Phase 2+)

- **Bootstrap CLI** (Layer 2) — the codebase analyzer that auto-populates `docs/`. The product hypothesis worth validating after Layer 1 settles.
- **Claude Code skills** (`.claude/skills/`) — `/pipeline`, `/spec`, `/status`, `/changelog`. Claude Code-specific; defer until adapter strategy is decided.
- **Other agent-CLI adapters** — Gemini CLI, Aider, etc. Implementer slot is intentionally Codex-CLI-only for MVP.
- **External-API citation tooling** (`docs-check.mjs` / `docs-refs-check.mjs`) — useful but project-specific in the source. Re-add once a canon-ai-native version is written.
- **Source-project-specific scripts** — content/asset generation, manifest sync, third-party-platform CLIs (build-skip, deploy hooks, etc.). All explicitly out of scope; the canon-ai pipeline is project-stack-agnostic.

## Known TODO markers in the code

A few `TODO[canon]:` markers were left where the operator should customize for their project. Notably:

- `scripts/run-task.ts` `runPostMergeHook()` — currently a no-op. Override for project-specific post-merge work (regenerating derived files, syncing manifests, etc.) by either editing this function or providing a `.canon/hooks/post-merge.sh` script (see the function's doc comment).

## Verification

- All 58 unit tests pass: `npm test`
- TypeScript compiles cleanly: `npx tsc --noEmit -p tsconfig.json`
- `task.sh` validates via `bash -n` (syntax check)

## Suggested next moves

1. **Smoke test the pipeline end-to-end on canon-ai itself.** Create a trivial task (`./scripts/task.sh new test-pipeline "Test the pipeline"`), write a one-AC spec by hand, run `npx tsx scripts/run-task.ts test-pipeline`. See what breaks. The Layer 2 hypothesis depends on Layer 1 *actually working* on a fresh project.
2. **Use canon-ai on the next fresh project.** That's the real validation — does it accelerate or slow down a from-scratch project? Calibrate after the first several tasks.
3. **Then** invest in Phase 2 (the bootstrap CLI). Building it before Phase 1 validation risks productizing the wrong thing.

## Open questions

- **Project-name resolution** is currently env-var-or-package.json. Is that good enough, or should there be an explicit `canon.config.json`?
- **TODO[canon] markers in templates** — should these be CLI-clearable (a `canon init --strip-todos` command), or are they intended to stay as guidance until manually edited away?
- **License decision**: proprietary works for now, but if Layer 2 ships as a paid service and Layer 1 is the OSS hook, MIT/Apache for Layer 1 is probably right. Defer until Phase 2 scoping.
- **Worktree layout**: `WORKTREES_ROOT` is now overridable via `CANON_WORKTREES_ROOT` env var. Default remains `../dev-worktrees` (sibling). Some projects may prefer in-tree `.canon-worktrees/` or another layout — exposed knob but no opinion enforced.
