# Architecture

> System overview. The 30,000-foot view of how the project is structured. Agents read this when orienting for the first time, when the task touches core data flow, or when the task crosses architectural boundaries.

## How to use this doc

This is the *map* of the codebase, not a tutorial on building features. It should answer questions like:

- What's the tech stack?
- How does data flow from user input to persistent storage?
- Where do major boundaries live (frontend/backend, app/worker, client/server)?
- What are the load-bearing libraries / frameworks the project depends on?

Anything that would change if you migrated to a different framework belongs here. Patterns within the framework belong in `docs/patterns.md`.

---

## Tech Stack

> **TODO[canon]: Document the project's stack at a high level.**

- **Language**: `<e.g., TypeScript / Python / Go>`
- **Framework**: `<e.g., Next.js / Django / Rails>`
- **State management**: `<store choice>`
- **Persistence**: `<DB / IndexedDB / files>`
- **Auth**: `<provider>`
- **Deployment**: `<platform>`
- **Testing**: `<runners>`
- **CI**: `<provider + key gates>`

## High-Level Architecture

> **TODO[canon]: A diagram or block description of how the major pieces fit together. ASCII art is fine for an MVP. Cover:**
>
> - Frontend / backend / worker boundaries (if any)
> - Where state lives (client, server, both)
> - Sync model (offline-first, server-of-record, hybrid)
> - External services the system depends on

```
┌─────────────────┐      ┌─────────────────┐
│   Frontend      │ ──→  │   Backend       │
│   (browser)     │ ←──  │   (serverless)  │
└─────────────────┘      └─────────────────┘
        │                        │
        ↓                        ↓
   Local storage          External services
```

## Data Flow

> **TODO[canon]: Walk through what happens for the most common user action. Where does input enter? What state mutates? What persists, and where? What gets sent to external services?**

## Boundaries & Contracts

> **TODO[canon]: Document the major interfaces between subsystems. Examples:**
>
> - Frontend ↔ backend API contract (where the schema lives)
> - Worker ↔ main thread RPC protocol
> - Storage layer interface

## Cross-Cutting Concerns

> **TODO[canon]: Document concerns that span the whole system:**
>
> - Auth and session lifecycle
> - Error tracking and observability
> - Feature flags / experimentation
> - Internationalization
> - Accessibility
