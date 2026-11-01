# Spec Review: provider-pin-agent-free-paths

> Reviewer: spec reviewer | Spec: `tasks/provider-pin-agent-free-paths/spec.md`

## Shape Check

No concerns. The mechanism is deterministic and the trace matches the code: `main()` resolves the bundle provider at `src/orchestrator/main.ts:4040` inside the startup try block, before the dry-run branch (4104) and the ship branch (4114). `runProvider` is a nullable module-level and `providerForTasks` falls back to re-resolving, which is why the spec gates on `ship && !dryRun`. Red-first ACs (AC-1, AC-2, AC-7) are present.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

Checked: `checkDeps` only calls `assignmentForTasks` under `!skipAgentDeps` (3943/3964). Other `providerForTasks`/`roleName` consumers are in the phase loop, reroute and agent run paths, not `shipTasks` (starts at 2425). `validateStatus` is called from `readStatusFromPath` (`state.ts:430`), so keeping the read on `--ship` preserves the clean malformed-file refusal. `doctor.ts:729-734` matches the described `mixed` guess.

## Issues Found

### Correctness Issues

(none)

### Missing Edge Cases

(none)

### Type Safety / Interface Gaps

(none)

### Nits for the plan phase

- Skipping only the `resolveBundleProvider` call means the `.map` callback (task-id validation, status.json existence check, read and validate) must still run for `--ship`. Structure it as map-then-conditionally-resolve rather than wrapping the whole try block.
- `runProvider` stays `null` on the ship path; `providerForTasks` would re-resolve and throw if a later change reaches it. The spec's Known Risks already covers this.
- AC-7's "no line names `codex`" assertion should match the check label, not the word anywhere in output, since the provider error text could mention other things.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
