# Product Context

> Source of truth for user-visible behavior, terminology, and product rules. Agents read this when their task touches user-facing logic.

## How to use this doc

This file documents the *product*, not the *code*. It exists because:

1. Code shows *what* happens, not *why* the user sees it that way.
2. Terminology drift causes UI bugs (one part of the app says "Project," another says "Workspace" for the same thing).
3. Business rules — pricing tiers, gating, free-vs-paid feature splits — need a single source of truth that's not buried in conditional code.

Rule of thumb: if a non-engineer (product owner, designer, marketing) needed to understand the product, they should be able to read this doc and get a complete picture without reading code.

---

## Product Overview

> **TODO[canon]: A 1–2 paragraph elevator pitch for the product. What it is, who it's for, why it exists.**

## Core Concepts & Terminology

> **TODO[canon]: Define the nouns the product uses with users. Be strict about consistency — every user-visible string should pick from this glossary.**

| Term | Definition |
|---|---|
| _Project_ | _example: a saved instance of the user's primary work artifact_ |
| _User_ | _example: anyone with an account_ |
| _Free user_ / _Paid user_ | _example: tier distinction_ |

## Primary User Flows

> **TODO[canon]: Document the 3–5 core flows. Each should describe what the user does, not how the code works.**

### Flow 1: First-time user lands

1. ...
2. ...

### Flow 2: ...

1. ...

## Tiers, Sizes, and Authorization

This section covers how this project uses the canon `task_size` × `delicate` matrix. Canon's general definitions live in the pipeline prompts and `docs/pipeline-orchestrator.md`; this section names project-specific surfaces.

### `delicate` flag — project-specific domains

> **TODO[canon]: List the project-specific surfaces that warrant `delicate: true`. Canon's general bar: a regression here has unbounded blast radius — an undetected bug is materially harder to recover from than a normal bug. Common adopter examples: auth, billing, payments, persistent-storage migrations, security-relevant cryptography, regulated-data handling (PHI, PII). Add the surfaces unique to your project.**

- *(domain 1)*
- *(domain 2)*
- *(...)*

## Free vs Paid Feature Split

> *(If your product has tiers — otherwise skip this section.)*
>
> **TODO[canon]: Enumerate which features are gated behind paid tiers and which are free. This is the single source of truth that gating code points back to. When a new feature is added, it must be listed here as Free or Paid before shipping.**

| Feature | Tier | Notes |
|---|---|---|
| _example: bulk export_ | Paid | |
| _example: basic export (single file)_ | Free | |

## Business Rules

> **TODO[canon]: Document rules that aren't obvious from the UI but affect product behavior. Examples:**
>
> - Trial period length and what unlocks during it
> - Refund policy
> - Account deletion / data retention
> - Email cadence / opt-in defaults
> - Geographic restrictions (consent gating, etc.)

## Voice & Tone

> **TODO[canon]: Document the project's voice if user-facing copy is part of agent work. Examples: formal vs casual, error-message style (apologetic vs direct), use of exclamation points, etc.**
