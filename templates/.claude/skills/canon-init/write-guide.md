# Canon Init: Per-doc Write Guide

What to fill in each scaffold doc during Phase 4 of `/canon-init`. Use this as the section-by-section reference while writing — every bullet describes a section that should land in the final file (or be explicitly removed when not applicable).

Rule of thumb: real content for every section that applies; remove the section entirely if the project has no use for it. Never leave `<placeholder>` text or "TBD". If you discover mid-write that you're missing information for a section, ask one targeted question before writing it.

## Contents

- `docs/product-context.md` — product identity and delicate surfaces
- `docs/architecture.md` — tech stack, data flow, validation matrix, CI
- `docs/codebase-map.md` — file-level navigation
- `docs/decisions.md` — settled architectural decisions
- `docs/patterns.md` — implementation patterns and known pitfalls
- `docs/lessons-learned.md` — accumulating insights
- Agent config files — adopter-owned context

---

## `docs/product-context.md`

- **Product Overview**: 1–2 paragraph elevator pitch
- **Core Concepts & Terminology**: fill the glossary table with real terms; remove example rows
- **Primary User Flows**: 2–4 concrete flows the codebase supports
- **`delicate` flag domain examples**: the project-specific surfaces confirmed in the grill
- **Free vs. Paid Feature Split**: fill if applicable; remove this section if the product has no tiers
- **Business Rules**: non-obvious product rules (trial periods, data retention, geo restrictions, etc.); omit if none
- **Voice & Tone**: fill if there are user-facing copy conventions; remove if not relevant

## `docs/architecture.md`

- **Tech Stack**: fill the bullet list from confirmed inferences
- **High-Level Architecture**: a short block diagram or prose description of the major pieces
- **Data Flow**: walk through what happens for the most common user action (input → state mutation → persistence → external services)
- **Boundaries & Contracts**: API schema location, storage layer interface, any worker protocols
- **Validation table**: bind each category to the actual `npm run ...` (or equivalent) command; mark N/A with rationale for categories that don't apply
- **CI**: describe what runs on push and what blocks merges; state "no CI configured" if absent
- **Cross-Cutting Concerns**: fill only the subsections that exist in this project (auth lifecycle, error tracking, feature flags, i18n, accessibility)

## `docs/codebase-map.md`

- **Entry Points**: app entry point, core type definitions, global config, routes/navigation
- **State & Data**: fill with real file paths and one-line descriptions
- **UI / Components**: fill if this project has a UI; remove section if purely backend
- **Workers / Background**: fill if applicable; remove if not
- **API / Backend**: fill if applicable
- **Tests**: real test directory paths
- **Config**: real config file paths agents might need to edit
- **Feature Wiring Maps**: replace the placeholder wiring maps with 2–3 real feature trails specific to this project (e.g., "add a new API endpoint", "add a gated feature")

## `docs/decisions.md`

At least 3–5 entries covering major settled decisions: why this stack, why this auth approach, key architectural choices. Include the rationale, not just the decision.

## `docs/patterns.md`

- Implementation patterns the team has settled on: at least one per major layer (API, data, UI if applicable)
- **Known Pitfalls** section: fill with footguns from the grill session and codebase exploration
- Leave the template structure intact; fill each section that applies

## `docs/lessons-learned.md`

- Add any lessons surfaced during the grill (confirmed incidents, footguns, past regressions)
- Leave empty rather than fabricate — this doc grows over time with real tasks

## Agent config files — adopter-owned

`AGENTS.md` and `CLAUDE.md` are fully adopter-owned. Canon does not insert or modify a block in either file. If you want agent files, generate them with the built-in `/init` in Claude Code or Codex. Do not rewrite or restructure the agent files themselves.
