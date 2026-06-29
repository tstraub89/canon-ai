# Completion Summary: canon-snapshot-robustness — CANON_UPSTREAM_REPO env override + non-submodule vendored-mode detection

> For the human. This is what you need to know.

## What Changed

Fixed two provenance-stamp gaps in `captureCanonSnapshot()` that produced incorrect attribution when canon is run under non-native adoption patterns. First: `upstream_repo` was hardcoded to `tstraub89/canon-ai`; it now reads from a `CANON_UPSTREAM_REPO` env var at call time (trimmed; empty/whitespace falls back to the default const), so forks and mirrors can correct their attribution via an env var without touching any code. Second: `orchestrator_commit` detection previously only recognized git submodule layouts; a plain `git clone` of canon nested inside a host repo fell through to native, stamping canon's own HEAD as the orchestrator commit instead of the host's HEAD. A new parent-toplevel probe closes the gap: when the superproject query returns empty but the parent directory resolves to a distinct git toplevel, canon is treated as vendored and the host HEAD is recorded. Both changes use the existing injectable `runGitAt` test seam so all new cases are covered by unit tests without a real multi-repo layout. Implementation was a clean single pass; bundled with `task-metadata-helpers`.

## Files Changed

- `scripts/run-task/canon-snapshot.ts` — call-time `CANON_UPSTREAM_REPO` override (trimmed, non-empty) and parent-toplevel enclosing-repo probe for plain-vendored detection.
- `tests/run-task-canon-snapshot.test.ts` — new fixtures: env override (set/unset/empty/whitespace), plain-vendored detection, native fallback (no enclosing repo; parent equals own toplevel), probe-failure degradation.
- `docs/decisions.md` — env-override clause appended to the existing `CANON_UPSTREAM_REPO` provenance Rule.
- `dist/cli/index.js` — rebuilt (CLI bundle includes `canon-snapshot.ts` via `refreshCanonSnapshotAtPath`).
- `dist/scripts/run-task.js` — rebuilt (orchestrator bundle).

## How to Test

1. **Default (no override):** Create a task in a normal canon-ai checkout. Inspect `tasks/<id>/status.json.canon.upstream_repo` — should read `tstraub89/canon-ai`; `orchestrator_commit` should match `git rev-parse HEAD`.
2. **Env override:** `CANON_UPSTREAM_REPO=myorg/my-fork canon task new env-test "test"`. Inspect the stamp — `upstream_repo` should read `myorg/my-fork`.
3. **Empty override (fallback):** `CANON_UPSTREAM_REPO= canon task new empty-test "test"` — stamp should fall back to `tstraub89/canon-ai`.
4. Expected: forks/mirrors can correct their attribution via the env var; a host repo that vendors canon as a plain folder gets the host's commit recorded rather than a copy of canon's own HEAD.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite passed. |
| `npm run build` | Pass | Both `dist/cli/index.js` and `dist/scripts/run-task.js` rebuilt. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | deferred_by_spec | `docs/decisions.md` is not a canon-managed template-mirrored file. Spec: §Validation Required — "docs/decisions.md is not a canon-managed/template-mirrored file, so sync-templates:check is N/A for this task." |

## Human Verification Required

None.

## Proposed Changelog

> Entry text only. Version number and bump tier are decided at the release step.

**Canon provenance stamps now correctly attribute forks, mirrors, and plain-vendored layouts.** `captureCanonSnapshot()` reads `upstream_repo` from the `CANON_UPSTREAM_REPO` env var at call time (falling back to the default `'tstraub89/canon-ai'`; empty or whitespace-only values are ignored). An orchestrator running as a plain git clone nested inside a host repo now stamps the host's HEAD as `orchestrator_commit` instead of copying canon's own HEAD.

## Decisions Made

- **Empty/whitespace-only env var falls back to the const, not an empty stamp.** A bare `??` would let `CANON_UPSTREAM_REPO=""` write an empty string; the implementation trims and treats whitespace-only as unset.
- **Parent-toplevel comparison uses `path.resolve()`.** Raw string equality fails on trailing-slash or relative-path variations.
- **Symlinked and tarball-extracted layouts are best-effort.** When the probe finds no enclosing repo it degrades to native silently — no worse than today. Accepted as Non-Goals in spec.
- **No new env-var plumbing in `env.ts`.** The read stays local to `canon-snapshot.ts` to keep the symbol's documented single home intact.

## Open Questions

None.
