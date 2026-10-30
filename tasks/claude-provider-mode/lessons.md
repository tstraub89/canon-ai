### A request flag one backend honors is a silent no-op on the other backend

*(2026-10-30, source: claude-provider-mode)*

Routing a call site to a second backend exposes every per-request flag the first backend honored. `wrapForResume` was honored only by Codex. Once Claude-held roles reached the implement reroute and the artifact fix-up, the Claude backend ignored the flag: it prepended a resume banner and stripped the commit-ownership startup. Code review caught it in round 1. Prevention: when a call site moves to another backend, list every field of the request object and confirm each backend reads it. Then test the prompt each call site actually delivers on that backend. Canonical example: `claudeBackend.run` and `runClaude` in `src/orchestrator/agents/claude.ts`, compared with `runCodex` in `src/orchestrator/agents/codex.ts`.

---

### Key a resume entry on the writer that stored the session, not on the state it leaves

*(2026-10-30, source: claude-provider-mode)*

A resume predicate keyed on `blocked` plus a stored session admits every path that writes `blocked`, not only the park it was built for. Here a completed implement whose docs-refs fix-up threw an `AgentSessionError` parked through the same boundary and then resumed as "work may be partial". The outcome was benign, but the entry condition was accepted as a spec Known Risk rather than tested per writer. Prevention: for any resume predicate, list every path that writes the same state. Then either tag the stored session with the writer that created it, or add one regression per writer. Canonical example: the park boundary `withAgentSessionPark` in `src/orchestrator/main.ts`.

---

### Splicing another module's text with exact-string replace fails silently

*(2026-10-30, source: claude-provider-mode)*

When a spec keeps the owning module out of scope, a prompt builder that rewrites one sentence of that module's output with `.replace('…')` works until the source wording changes. Then the replacement does nothing and no test fails. Here the Claude implementer startup is built by replacing a sentence inside `CODEX_STARTUP`, and code review flagged it as fragile. Prevention: when a derived prompt replaces text it does not own, assert that the new text is present and the old text is absent. A wording change then fails the test instead of silently changing the prompt. Canonical example: `CLAUDE_IMPLEMENTER_STARTUP` in `src/orchestrator/prompts/helpers.ts`.
