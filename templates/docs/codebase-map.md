# Codebase Map

> Quick-reference for agents. Start here to find the right file, then read `docs/architecture.md` for context.

## How to use this doc

This is a fast index, not a tutorial. Each row points an agent at the canonical file for an area of functionality. The goal: an agent looking at "where do I add X?" can scan this map and find the file in seconds, instead of grepping the whole repo.

Keep entries terse — one row per file/area, with at most a one-line note. Long explanations belong in `docs/patterns.md` or inline code comments.

**Refresh discipline**: When a task moves or renames a canonical file, update this map in the same PR. The QA phase scans for stale entries and flags them.

---

## Entry Points

> **TODO[canon]: Document the files an agent reads first when orienting.**

| What | Where |
|---|---|
| App entry | `<path>` |
| Core data model / types | `<path>` |
| Global config / constants | `<path>` |
| Routes / navigation | `<path>` |

## State & Data

> **TODO[canon]: Document state-layer files.**

| What | Where | Notes |
|---|---|---|
| _example: project state store_ | `<path>` | Source of truth for shared state |
| _example: write API wrapper_ | `<path>` | Binds store actions to whatever surface code consumes them |
| _example: persistence layer_ | `<path>` | IndexedDB / SQLite / etc. |

## UI / Components

> **TODO[canon]: Document major UI surfaces.**

| What | Where | Notes |
|---|---|---|
| _example: main canvas_ | `<path>` | |
| _example: navigation header_ | `<path>` | |
| _example: shared dialog_ | `<path>` | |

## Workers / Background

> **TODO[canon]: Document any worker, queue, or background job files.**

| What | Where | Notes |
|---|---|---|
| _example: heavy computation worker_ | `<path>` | |

## API / Backend

> **TODO[canon]: Document API routes / serverless functions / backend handlers.**

| What | Where | Notes |
|---|---|---|

## Tests

> **TODO[canon]: Document test layout.**

| What | Where | Notes |
|---|---|---|
| Unit tests | `<dir>` | |
| E2E tests | `<dir>` | |

## Config

> **TODO[canon]: Document config files an agent might need to edit.**

| What | Where | Notes |
|---|---|---|

## Feature Wiring Maps

> Cross-cutting features touch multiple surfaces. Use these as starting checklists, not exhaustive lists.
>
> **TODO[canon]: Document the wiring trail for common feature types in your project. Examples:**

**Add a new keyboard shortcut**:
> `<shortcut-registry>` → `<command-dispatch>` → `<help-doc>` → context menu entry if applicable

**Add a new API endpoint**:
> `<route-file>` → `<schema-validation>` → `<auth-middleware>` → `<test-file>`

**Add a gated/premium feature**:
> `<gating-context>` → `<feature-copy>` → feature implementation → `<analytics-event-map>`

## Agent Config

| What | Where | Notes |
|---|---|---|
| Workflow source of truth | `AGENTS.md` | All agents follow this |
| Claude instructions | `CLAUDE.md` | Architect + reviewer context |
| Codex instructions | `CODEX.md` | Implementer context |
| Agent permissions | .claude/settings.local.json | Allowlisted commands |
| Codex config | `.codex/config.toml` | Multi-agent + shell snapshot |
| Task artifacts | `tasks/` | Per-task specs, plans, reviews |
