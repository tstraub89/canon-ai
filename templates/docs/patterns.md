# Implementation Patterns

> Concrete patterns from the actual codebase. Follow these when implementing similar functionality. This prevents agents from inventing new patterns when established ones exist.

## How to use this doc

This is the project's hard-won implementation knowledge. It has two main sections:

1. **Trigger Table** — at the top, an index agents skim to jump to the relevant section. If your task touches an area listed here, the pointed-at section is likely load-bearing for what you're doing.
2. **Known Pitfalls** — failure modes that have bitten the project before, with the rule that prevents them. The orchestrator pre-injects task-relevant pitfalls into Codex's implement prompt; agents still need this file open for spec authorship and code review.

## Trigger Table — Scan This First

Use this index to jump to the relevant section instead of reading the whole file. If your task touches an area below, the pointed-at section is likely load-bearing.

> **TODO[canon]: Replace these examples with rows that map your project's areas to the patterns/pitfalls relevant to them.**

| Area touched | Section in this file | Key files |
|---|---|---|
| _example: mutating shared state_ | Project State Mutation | `<state store>` |
| _example: adding a new context provider_ | Context Provider Tree | `<provider tree file>` |
| _example: cross-component events_ | Custom Events | `<event bus file>` |
| _example: heavy computation_ | Worker / Background Job | `<worker file>` |
| _example: error reporting_ | Error Hygiene | `<telemetry file>` |
| _example: lint / TS suppression / `any`_ | Lint & Type Safety Policy | (rule, no canonical file) |

## Patterns

> Each pattern documents an established way of doing something in the codebase, so new code matches existing code rather than inventing a parallel approach.
>
> **TODO[canon]: Document the patterns that matter for your project. Aim for ~5–15 patterns at MVP; add more as recurring conventions emerge. Each pattern should have:**
> - **Where it lives** (1–2 canonical files to read for the pattern)
> - **When to use it** (the trigger condition)
> - **The pattern itself** (code shape, types, rules)
> - **Anti-patterns to avoid** (what NOT to do)

### Example pattern: State Mutation Through a Single Chokepoint

> *(Synthetic example — replace with your project's real patterns.)*

**Files**: `src/example/store.ts`, `src/example/useApi.ts`

**Usage**:
```typescript
runCommand(
  resourceId,
  { kind: 'resource.update', label: 'Update resource', source: 'user_action' },
  (state) => ({ ...state, name: 'new name' })
);
```

**Rules**:
- The mutator is a **pure function** — receives the current state as readonly input and returns a fresh modified state.
- Every change to shared state goes through this chokepoint — never mutate directly.
- Multi-step mutations: wrap in a single `runCommand` for atomic undo.

## Lint & Type Safety Policy

> Always-applicable rules, regardless of stack. Edit the language-specific bits to match yours.

Suppressing lint or type errors is a last resort, not a convenience escape hatch. Each suppression hides a diagnostic that exists to catch real bugs. Follow these rules:

**Lint suppression comments**

Never add a suppression comment without a written justification on the same line explaining *why the rule is wrong for this specific case*. If you can't write that justification, the rule is almost certainly right and the code needs to change instead.

**`any` / dynamic typing**

`any` propagates silently — once it enters a call chain every downstream consumer loses type safety. When the shape is truly unknown at the boundary (raw network responses, JSON parsing, third-party callbacks), type it as `unknown` and narrow it explicitly.

## Known Pitfalls

> Hard-won lessons from past mistakes. Violating them causes subtle bugs.
>
> **TODO[canon]: This is where the project's accumulated wisdom lives. Each pitfall should follow the format below. Initially empty for new projects — entries land here when a human promotes durable lessons from `docs/lessons-learned.md` during a sweep (see that file → "How to use this doc"). QA only appends to the buffer; it never promotes into this doc.**

### Pitfall format

Each entry should be a short paragraph (3–8 lines) with this shape:

> **Short imperative title naming the rule, not the bug.** *(Title is the lesson — a future reader scanning headings should learn the rule from titles alone.)*
> 
> The actual rule, then the failure mode it prevents (specific incident or class of bug), then the concrete prevention (what to grep for, what to verify, where the canonical example lives). Reference symbols/files via the `` `SYMBOL` in `path/file.ts` `` form so `npm run docs-refs-check` can validate them.

### Example pitfall

> **Always reset derived state when the source identifier changes.**
>
> When a record references another by ID, computed fields (caches, transforms, ephemeral selections) calibrated for the old reference can survive an ID swap and produce stale-data bugs that are visible to users but invisible in logs. The fix is to reset every derived field at every site that writes the ID — there's no single chokepoint for this. Canonical reset helper: `<your-reset-function>` in `<path>`. Grep all writers of the ID field before adding a new one.

### Browser & Platform Quirks

> *(If applicable to your project — mobile/web/desktop platform-specific gotchas land here.)*

### State Management

> *(If applicable — framework-specific state pitfalls.)*

## Quick Reference: "I Want To..."

> **TODO[canon]: Once you have ~5 patterns documented, add a quick-reference table that maps common intentions to the right pattern + starting file.**

| I want to... | Follow this pattern | Start at |
|---|---|---|
| _example: mutate state_ | `runCommand` / store action | `<store file>` |
| _example: show user feedback_ | `showToast` / notification system | `<toast utility>` |
