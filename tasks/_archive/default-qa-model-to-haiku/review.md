# Code Review: default-qa-model-to-haiku

**Scope:** Full — base `main` — reason: Round 1 (initial review).

Inputs: anchored Claude lens (approve), cold-Claude lens (approve), cold-Codex (no findings).

## Stage 1: Validation Gate

Result: pass.

| AC | Status | Note |
|---|---|---|
| AC-1 matrix cells | Met | QA cells return `claude-haiku-5-5` / `medium` at every size and delicate M; other cells unchanged. |
| AC-2 QA precedence | Met | New test covers pin, legacy, light/strong isolation, all sizes, medium effort. |
| AC-3 legacy warning | Met | Names `CLAUDE_MODEL_QA`, keeps every-phase fallback wording; test asserts it. |
| AC-4 docs sweep | Met | Orchestrator doc, product-context, `effectiveSize` comment updated; no stale restatements found by any lens. |
| AC-5 no new knob | Met | No new `CLAUDE_MODEL_*` identifier; new tier value `'qa'` has no env var. |
| AC-6 decisions entry | Met | Entry placed after the Codex implement entry, with all required parts and three supersede notes. |
| AC-7 mirror/build | Met | Template mirror matches root; `dist/orchestrator/run-task.js` rebuilt and contains the model ID. |

## Stage 2: Findings

No surviving blocking findings.

Nits (optional, not blocking):
- `src/lib/pipeline-policy.ts:303` — the QA special-case branch precedes the tier lookup (anchored + cold-Claude, flagged by 2 lenses). Spec explicitly left the representation to the implementer, and the decisions entry records the revisit trigger. No action.
- `docs/pipeline-orchestrator.md:268` — rollback hint mentions `sonnet` / previous light-tier model but not the prior-`CLAUDE_MODEL=Y` case; covered in the decisions entry and the `CLAUDE_MODEL` row. Optional wording.

## Dismissed Cold Findings

- Dismissed (cold-Claude): CHANGELOG.md:156 stale "QA runs Sonnet" — that line is in the released 3.11.0 section (historical); the spec's Non-Goals exclude CHANGELOG edits (`/canon-changelog` drafts at release).
- Dismissed (cold-Claude): no runtime warning for `CLAUDE_MODEL_LIGHT` adopters — spec scopes the change to docs/decisions with a recorded rollback (Known Risks "Pinned adopters change silently"); a new warning is not an AC.
- Dismissed (cold-Claude): empty-string `CLAUDE_MODEL_QA` handling unverified — spec Non-Goals keep today's `??` behavior in `src/orchestrator/policy.ts`.
- Dismissed (cold-Claude): phase-pin test QA assertion no longer exercises pin vs tier — spec AC-2 mandates that exact assertion change, and the new precedence test covers the QA pin explicitly.
- Dismissed (cold-Claude): `docs/harness-audit-2026-06.md:138` "qa sonnet/med" — historical doc, excluded by spec Non-Goals.
- Cold-Codex: no findings.

## Final Verdict

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
