# Architecture Decisions

> Why things are the way they are. Agents: do not re-propose alternatives to settled decisions without strong justification and human approval.

## How to use this doc

Each decision documents a settled architectural choice — what was chosen, why, and the rule that follows. The point is to prevent future agents (and humans) from re-debating questions that are already resolved.

A good decision entry has three sections:

1. **What** was decided (one sentence)
2. **Why** (the reasoning and tradeoffs)
3. **Rule** (what agents should/shouldn't do as a result)

Decisions can be reopened, but only with **strong justification and human approval** — not because an agent prefers a different style. If a decision turns out to be wrong, write a new entry that supersedes it and notes what changed.

---

## Example decision: Testing Framework

> *(Synthetic example — replace with your project's real decisions.)*

**Decision**: Use `<your test runner>` for unit tests. `<your e2e tool>` for end-to-end.

**Why**: `<short justification — what tradeoffs led here>`. Specifically: `<the alternative considered and why it was rejected>`.

**Rule**: No `<rejected alternative>`. Unit tests go in `<tests-dir>`. E2E tests go in `<e2e-dir>`.

---

> **TODO[canon]: Add real decisions for your project below. Common categories to cover at MVP:**
>
> - **Stack** — language, framework, build tool, package manager
> - **State** — store/context choice, mutation discipline
> - **Styling** — CSS approach, token system, dark mode
> - **Data** — persistence, caching, sync
> - **Auth** — provider, session model, escalation rules
> - **Payments / billing** (if applicable) — provider, webhook handling
> - **Analytics** — provider, event-naming convention
> - **Deployment** — platform, CI/CD, environment management
> - **Testing** — runners, conventions, coverage rules
>
> Not every category needs an entry on day 1 — populate as decisions get made.

## Adding New Decisions

When making a significant architectural choice, add it here with:
1. **What** was decided
2. **Why** (the reasoning and tradeoffs)
3. **Rule** (what agents should/shouldn't do)

This prevents future agents from re-debating settled questions.
