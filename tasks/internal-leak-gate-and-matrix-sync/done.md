# Done: internal-leak-gate-and-matrix-sync — Close internal-leak gate gap, sync Validation Matrix, encode no-internals rule

## What Changed

Three gaps left by the v2.0.0 adopter-agent-file-redesign work are now closed.

**Leak gate extended to catch bare internal-only basenames.** The sync-templates leak check previously only flagged backtick path references that started with `scripts/run-task/` — a bare filename like `` `qa.md` `` matched nothing and slipped through. The gate now also flags bare references to any basename that belongs exclusively to canon's internal prompt templates (files under `scripts/run-task/prompts/templates/` with no counterpart in `.canon/templates/`). The internal-only set is derived at load time by set subtraction from the two template directories, so it stays correct automatically as templates are added or removed. The three colliding names (`spec.md`, `plan.md`, `spec-review.md`) are intentionally excluded because those names also refer to adopter-facing task artifacts and shipped `.canon/templates/` files.

**Live leak fixed.** The `/canon-changelog` skill's release-rules guidance referenced `` `qa.md` `` — an internal prompt template adopters don't have, which would cause `docs-refs-check` failures in upgraded adopter repos. The sentence is reframed to reference canon's QA phase instead of naming the internal file. The meaning is preserved; the broken reference is gone. The synced `templates/` mirror was updated automatically.

**Validation Matrix drift guard added.** The universal change-type → check-category table appears in two places: the internal `implement.md` prompt template and the shipped `.canon/templates/spec.md` scaffold. Nothing was keeping them in sync. A new test (`tests/validation-matrix-sync.test.ts`) extracts each table by anchoring on the header line, asserts non-emptiness in both files, and compares them byte-for-byte. Drifting one row in either file now fails the test suite.

**No-internals rule encoded.** `docs/decisions.md` gains a new entry — "Canon-shipped guidance never names orchestration internals" — stating the rule, why it exists, and pointing at `scripts/sync-canon-templates.mjs` as the executable enforcement.

## Files Changed

| File | Change |
|---|---|
| `scripts/sync-canon-templates.mjs` | Added `INTERNAL_ONLY_TEMPLATE_BASENAMES` set-subtraction; bare internal-only basenames now trip `[canon-internal-leak]`; `describeLeakTarget` helper distinguishes bare-basename from path-prefix messages |
| `tests/sync-canon-templates.test.ts` | New tests: bare `qa.md`/`implement.md` flagged; bare `spec.md`/`plan.md`/`spec-review.md` not flagged; live set membership assertions for AC-3 |
| `tests/validation-matrix-sync.test.ts` *(new)* | Drift guard: extracts and byte-compares the Validation Matrix from `scripts/run-task/prompts/templates/implement.md` and `.canon/templates/spec.md` |
| `.claude/skills/canon-changelog/SKILL.md` | Reframed release-rules sentence to reference canon's QA phase, not the internal `qa.md` file |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Auto-synced mirror of the above |
| `docs/decisions.md` | New decision entry: shipped guidance must not name orchestration internals; leak gate is the enforcement |

## How to Test

**Automated (all must pass):**
```
npm run lint
npm run type-check
npm test
npm run sync-templates:check
npm run docs-refs-check
```

**Human Test Plan (from spec):**

1. Add a mention of one of canon's internal-only step files (by its short name) into a piece of canon's adopter-facing guidance, then run canon's content-consistency check. Expected: the check fails, points at that line, and explains the named item is internal to canon.
2. Reword that mention to refer to canon's QA *step* rather than naming the internal item, then re-run the check. Expected: the check passes.
3. Read the changelog-helper guidance that previously named an internal item. Expected: it no longer names anything an adopter lacks, and still makes clear the release rules are enforced during QA.
4. Make the universal change-type/check table in one place differ by a row from its twin elsewhere, then run the test suite. Expected: a test fails reporting that the two copies have drifted. Undoing the change makes it pass.
5. Read the new architecture-decision entry. Expected: it states plainly that canon's adopter-facing guidance must not point adopters at canon's internal machinery, that adopters customize their own task templates instead, and that an automated check now enforces this.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 882 passed, 1 skipped |
| `npm run sync-templates:check` | Pass — no `[canon-internal-leak]` errors |
| `npm run docs-refs-check` | Pass |
| `npm run build` | `deferred_by_spec` — Spec §Validation: `scripts/sync-canon-templates.mjs`, test files, skill markdown, and `docs/decisions.md` are not part of the published `dist/` bundle; no `dist/` change. |
| E2E | `deferred_by_spec` — Spec §Non-Goals: no runtime UI surface. |

## Human Verification Required

None.

## Decisions Made

- **Bare-basename collision exemption is intentional.** `spec.md`, `plan.md`, and `spec-review.md` appear in both `scripts/run-task/prompts/templates/` and `.canon/templates/`, so they are excluded from the internal-only set and not flagged. Flagging them would produce false positives on legitimate task-artifact references in shipped skills. The residual gap (a writer accidentally using a bare ref to the *internal* template rather than the artifact) is documented as an accepted limitation.
- **No structural single-sourcing for the Validation Matrix.** A drift-guard test is the entire deliverable for piece 2. The matrix appearing in both files is intentional — didactic in `implement.md`, authorable template in `spec.md`.

## Open Questions

None.

## Proposed Changelog

**Scope note:** `scripts/sync-canon-templates.mjs` and the new test files are internal tooling that do not ship to adopters. The `docs/decisions.md` entry is internal documentation. The only user-facing change is the `/canon-changelog` skill fix: the old `qa.md` reference would cause `docs-refs-check` failures in adopter repos after `canon upgrade`.

**Proposed entry (Fixed):**

> **`/canon-changelog`'s release-rules guidance no longer contains a broken reference to `qa.md`, a canon-internal file adopters don't have.** The phrase "inlined in `qa.md`" was a bare backtick ref to an internal per-phase prompt template absent from adopter repos — `docs-refs-check` would flag it as a missing file in any upgraded repo. The sentence is reframed to say the release rules are enforced during canon's QA phase, preserving the meaning while removing the invalid reference. Ships to adopters via `canon upgrade`.

**Proposed version bump:** patch — single bug fix in a shipped skill; no new user-visible behavior.

---

Maintenance: lessons-learned.md has 17 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
