# QA Summary: discovery-nudge

## What Changed

`canon doctor` now includes a loose, warn-only check that surfaces the recommended canon orientation line when neither `CLAUDE.md` nor `AGENTS.md` mentions canon (case-insensitive). The check returns `warn` only — it never fails or blocks `doctor`. When a repo's agent files already mention canon (the current state of this repo), the check passes silently.

The recommended text is exported as `RECOMMENDED_NUDGE` from `src/cli/commands/doctor.ts`, mirroring the existing `RECOMMENDED_ALLOW` pattern. Canon still does not write this text into any adopter file — it recommends, never seeds.

This is Task B of the "canon vacates adopter CLAUDE.md/AGENTS.md" program. The check is a near-no-op today (existing adopter files mention canon) and becomes load-bearing when Task C strips the managed block.

## Files Changed

| File | Change |
|---|---|
| `src/cli/commands/doctor.ts` | Added exported `RECOMMENDED_NUDGE` constant; added `checkCanonDiscoveryNudge(cwd)` loose warn-only check; registered in the `Canon setup` checks group |
| `README.md` | Added `Discovery nudge (recommended)` subsection near adoption/setup docs with the recommended orientation line in a fenced block |
| `tests/cli.test.ts` | Added doctor-check coverage (warn/pass/read-only) and a README drift test asserting the README-documented text equals `RECOMMENDED_NUDGE` |
| `dist/cli/index.js` | Rebuilt CLI bundle to include the new doctor check |

## How to Test

1. **This repo (agent files mention canon):** run `canon doctor`. The new discovery-nudge check should pass silently — no warning, no behavior change to overall doctor output.
2. **A directory without canon in agent files:** create a minimal `CLAUDE.md` that doesn't mention "canon"; run `canon doctor`. Expected: a non-blocking warning recommending you add the canon discovery line, showing the text from `RECOMMENDED_NUDGE`.
3. **Confirm no seeding:** run `canon init` or `canon upgrade` in a test repo; confirm `CLAUDE.md` and `AGENTS.md` contain no nudge text written by canon.
4. **README:** read the adoption section in `README.md`; confirm the `Discovery nudge (recommended)` subsection appears with the recommended line.
5. **Drift test:** `npm test` — the drift test at `tests/cli.test.ts:2320` will fail if the README text and `RECOMMENDED_NUDGE` diverge.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass (new doctor-check + drift tests included) |
| `npm run build` | Pass — `dist/cli/index.js` rebuilt and committed |
| `npm run docs-refs-check` | Pass |
| E2E | Not applicable (no UI surface) |

## Human Verification Required

None.

## Decisions Made

- **Recommend, never seed.** Canon recommends the nudge via `doctor` + README; it never writes into adopter `CLAUDE.md`/`AGENTS.md`. AC-6 provides a structural guard (empty diff on `init.ts`, `templates/CLAUDE.md`, `templates/AGENTS.md`). This mirrors the `RECOMMENDED_ALLOW` pattern exactly.
- **Loose presence check, never exact-match.** The doctor check uses a case-insensitive `/canon/i` substring test. A rewording of the orientation line will never trigger a nag. Accepted false-pass: "canonical" also matches; under-warning is the safe direction.
- **Warn, never fail.** The check contributes no blocking failures to `canon doctor`. Operator adoption of the nudge is voluntary.

## Open Questions

None.

## Proposed Changelog

Suggested entry text for the next release — the release/changelog step assigns the version:

```markdown
### Added

- **`canon doctor` now recommends a canon orientation line when neither `CLAUDE.md` nor `AGENTS.md` mentions canon.** The check is warn-only and never fails — it surfaces the recommended one-line nudge (*"This project uses canon…"*) when neither agent file mentions canon, and passes silently when either does. The recommended text is available via `RECOMMENDED_NUDGE` exported from `doctor.ts`. A README subsection near the adoption/`canon init` docs documents the line; a drift test keeps the two in lockstep. This is part of the "canon vacates adopter CLAUDE.md/AGENTS.md" program — the check is a no-op while the managed block exists and becomes load-bearing when the block is stripped (Task C).
```
