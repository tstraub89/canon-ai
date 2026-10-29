# PR Body: agent-backend-role-routing - Route pipeline phases through role-keyed agent backends

## Summary

- Pipeline phases now ask for an agent by role (author, spec reviewer, implementer, reviewer, cold reviewer, QA). A backend module owns the vendor details, so phases and `main.ts` no longer name Claude or Codex when they run an agent.
- Under the current assignment, every agent invocation is unchanged: binary, flags, model, effort, budget, working directory and prompt. Unit tests pin each call site.
- Sessions are stored under role names (`author`, `spec_reviewer`, `implementer`, `reviewer`). Phase-to-slot is explicit, so plan's one-off run cannot overwrite spec's session.
- Reads check the role name first and fall back to the old slot names, so in-flight tasks resume without a migration. Writes go only to role names. Reset and reroute clear the role name and the old name together.
- `phases[].agent` now records the backend that ran each agent phase. Routing no longer reads it.
- Two deliberate fixes: tasks whose phase entry was created by `canon task` now store, resume and retry sessions; QA's `done.md` recovery reads the agent's text before the raw output.
- Required agent binaries are derived from the role map. `canon init` and `canon doctor` still check both, and doctor still runs every check.
- No provider setting is added. This is groundwork for a Claude-only mode in a follow-up.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- The checks above passed on the implementation's final run. QA did not rerun them. `npm run sync-templates:check` also passed; the template is unchanged.
- Session IDs are valid only for the backend that created them. Nothing enforces this yet, because there is only one assignment. The follow-up provider-mode task must pin the provider per task.
- A live run with real Claude and Codex credentials was not done. Please run a small task from spec through QA before merging; the fake-binary tests cover how commands are built, not the agents' responses.
- An older canon engine that clears legacy keys leaves role keys alone, so a newer engine could resume a stale role-key session after a downgrade. This path is outside the forward-compatibility contract and is accepted.
