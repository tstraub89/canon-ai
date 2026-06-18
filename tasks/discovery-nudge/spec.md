# Spec: discovery-nudge — Discovery nudge — recommend the canon orientation line via doctor + README

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

This is Task B of the "canon vacates adopter `CLAUDE.md`/`AGENTS.md`" program (Task A `relocate-rules-to-prompts` shipped; the JIT channel now carries every operating rule). Task C will strip canon's managed block out of adopter `CLAUDE.md`/`AGENTS.md` entirely, making those files **purely adopter-owned** (like `.claude/settings.json` already is).

Once the block is gone, a fresh operator-Claude session in an adopter repo has no ambient signal that the repo uses canon — it might just start coding instead of routing work through `/canon-spec`. Discovery of canon's skills survives via their system-prompt descriptions, but a one-line "this repo uses canon; use the pipeline" orientation in `CLAUDE.md` materially improves the odds the operator engages the pipeline rather than freelancing.

Canon needs to make that orientation line available **without writing into the adopter's `CLAUDE.md`** — because not owning that file is the entire point of the program. Canon already has the exact pattern for "we want content in an adopter-owned file but we don't own the file": `RECOMMENDED_ALLOW` (canon never writes `.claude/settings.json`; it *recommends* the allowlist via `canon doctor` + README, and the adopter adds it). The discovery nudge should mirror that pattern.

This task installs the **recommend-machinery** now. It is a near-no-op until Task C strips the block (while the canon block exists, `CLAUDE.md` mentions "canon", so the check passes); it becomes load-bearing the moment C lands.

## Decision

Add a **recommend-only** discovery nudge, mirroring `RECOMMENDED_ALLOW` exactly. Canon recommends the nudge; it never seeds or writes it into an adopter's `CLAUDE.md`.

- A single-source `RECOMMENDED_NUDGE` constant holds the recommended ~3-line orientation text.
- `canon doctor` gains a **loose, warn-only** check: it warns (never fails) when *neither* `CLAUDE.md` *nor* `AGENTS.md` mentions canon, and points the operator at the recommended line. It passes whenever either file mentions canon — a deliberately lenient presence check, never an exact-string match (rewording must never trigger a nag).
- `README.md` documents the recommended nudge line, kept in lockstep with the constant by a drift test (same mechanism as the `RECOMMENDED_ALLOW` ↔ README block).

Canon does **not** write the nudge into adopter files. For existing pre-C adopters, Task C's one-off migration script inserts the nudge while it strips the block; for fresh adopters, `doctor` + README recommend it (and the conversational `/canon-init` grill can include it when it generates their docs).

## Non-Goals

- **NOT seeding or writing the nudge into any adopter file** — no changes to `src/cli/commands/init.ts`, `templates/CLAUDE.md`, or `templates/AGENTS.md`. Recommend-only is the design, not an accident; see AC-6.
- **NOT** the Task C vacate (stripping the block, `DELIMITED` removal, README opinion-move) or the one-off migration script.
- **NOT** making the nudge managed or enforced — the softness (advisory, adopter-owned) is the feature. `doctor` warns; it never fails or blocks on a missing nudge.
- **NOT** changing the relocated rules from Task A.

## Acceptance Criteria

- [ ] **AC-1 (single-source constant):** `src/cli/commands/doctor.ts` exports a `RECOMMENDED_NUDGE` constant (mirroring `RECOMMENDED_ALLOW`) holding the recommended orientation text — roughly: *"This project uses canon, a spec-first multi-agent pipeline. Route new features / fixes / refactors through the canon skills (start with `/canon-spec`) rather than implementing directly."* Verify: the constant exists and is exported; exact wording is an implementation detail.
- [ ] **AC-2 (loose warn-only doctor check):** `canon doctor` includes a new sibling check in the "Canon setup" `canonChecks` group (alongside the existing `checkAgentFile` calls) that reads `CLAUDE.md` and `AGENTS.md` and returns `status: 'warn'` **iff neither** file mentions canon (case-insensitive substring, e.g. `/canon/i`); returns `'pass'` if either mentions it; **never** returns `'fail'`, and **never** does an exact-string match against the nudge text. Verify: AC-6 test — a fixture where neither file mentions canon → `warn`; a fixture where either does → `pass`.
- [ ] **AC-3 (advisory surfaces the recommendation):** the warn-check's `detail` derives from `RECOMMENDED_NUDGE` (tells the operator to add the canon discovery line to `CLAUDE.md` and what it says) — not a generic message. Verify: the warn `detail` contains text from `RECOMMENDED_NUDGE`.
- [ ] **AC-4 (README documents it):** `README.md` documents the recommended discovery nudge as a short subsection near the adoption / `canon init` docs, showing the recommended line. Verify: README contains the nudge text.
- [ ] **AC-5 (drift test):** a test asserts the README-documented nudge text equals `RECOMMENDED_NUDGE`, mirroring the existing `RECOMMENDED_ALLOW` ↔ README drift test (`tests/cli.test.ts` ~line 2259). Verify: the test exists and passes; editing one without the other fails CI.
- [ ] **AC-6 (recommend-only — no adopter-file writes):** canon writes the nudge into **no** adopter file. `git diff <base>...HEAD -- src/cli/commands/init.ts templates/CLAUDE.md templates/AGENTS.md` is **empty**. This is the structural guard on the load-bearing "recommend, don't seed" decision. Verify: the diff is empty + a doctor-check test confirms `doctor` only reads (never writes) `CLAUDE.md`/`AGENTS.md`.
- [ ] **AC-7 (build artifact current):** after the `doctor.ts` change, the committed `dist/` matches a fresh `npm run build` — verify with `npm run build` then `git diff --exit-code -- dist/` is clean. The regenerated artifact is `dist/cli/index.js` (the sole CLI bundle; tsup emits no sourcemap — verified). Declare every regenerated `dist/` file in the handoff Changes table so the `--pr` base-drift gate passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/doctor.ts` | Add exported `RECOMMENDED_NUDGE` constant (mirror `RECOMMENDED_ALLOW` ~line 34); add a sibling `checkCanonDiscoveryNudge(cwd)` loose warn-only check; register it in the `canonChecks` array (~line 639, after the two `checkAgentFile` calls) |
| `README.md` | Add a short "discovery nudge" subsection near the adoption / `canon init` docs (~README:103-129) documenting the recommended line; keep in lockstep with `RECOMMENDED_NUDGE` |
| `tests/cli.test.ts` | Add the doctor-check test (warn when neither file mentions canon; pass when either does; read-only) and the `RECOMMENDED_NUDGE` ↔ README drift test (mirror the `RECOMMENDED_ALLOW` test ~line 2259) |
| `dist/cli/index.js` | Build artifact — regenerated by `npm run build` (bundles the edited `doctor.ts`) |

### Interaction Dependencies

- **Task C** depends on this: C's vacate is what makes the check load-bearing, and C's one-off migration script reuses `RECOMMENDED_NUDGE` to insert the nudge while stripping the block.
- No change to `init`/`upgrade`/templates → no interaction with the scaffold or `mergeDelimited`.

### Data Model Changes

None.

## Validation Required

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; includes the new doctor-check + drift tests
- [x] `npm run build` — `dist/cli/index.js` regenerated; committed dist matches fresh build
- [x] `npm run docs-refs-check` — README edit has no broken refs
- [ ] E2E — N/A (no UI surface)

## Docs Impact

- `docs/codebase-map.md` — the `canon doctor` entry lists its checks; QA may add the new discovery-nudge check. Heads-up, not a change here.
- `docs/decisions.md` — optional: a short entry recording "the discovery nudge is recommend-only (mirrors `RECOMMENDED_ALLOW`), canon never writes adopter `CLAUDE.md`" — QA decides whether it's worth a settled-decision entry or rides under the broader vacate program. Heads-up only.

## Known Risks

- **Over-strict check = alarm fatigue (highest risk).** An exact-string or narrow match would nag any adopter who reworded/moved the nudge, training people to ignore `doctor`. Mitigation: AC-2 mandates a loose case-insensitive `canon` presence test, warn-only, never exact-match. (A case-insensitive `canon` match also matches "canonical" — an accepted false-*pass*; under-warning is the safe direction. Word-boundary matching is an optional implementation refinement.)
- **Scope creep into seeding.** The tempting wrong move is to also seed the nudge in `init`/`templates`. AC-6 structurally forbids it (empty diff on those files) — recommend-only is the decision.
- **Pre-C no-op confusion.** While the canon block still exists, `CLAUDE.md` mentions "canon" so the check passes and appears to do nothing. This is intended — the check is the post-vacate backstop. A reviewer should not flag it as dead; it activates when Task C strips the block.
- **README ↔ constant drift.** Mitigated by AC-5's drift test.

## Human Test Plan

1. In this repo (whose `CLAUDE.md`/`AGENTS.md` mention canon), run `canon doctor`. **Expected:** the new discovery-nudge check passes — no warning — because canon is mentioned. Overall doctor behavior is unchanged.
2. In a throwaway directory with a `CLAUDE.md` that does **not** mention canon, run `canon doctor`. **Expected:** a non-blocking **warning** recommending you add the canon discovery line, showing the recommended text. `doctor` does not fail or block on it.
3. Run `canon init` and `canon upgrade` in a test repo and inspect `CLAUDE.md`. **Expected:** neither command adds or changes any nudge — canon recommends the line, it never writes it for you.
4. Read the README adoption section. **Expected:** it documents the recommended discovery nudge line.
5. Confirm the project's own checks pass: lint, type-check, tests, build, docs-refs.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — `RECOMMENDED_ALLOW`, `checkAgentFile`, `canonChecks` in `doctor.ts`; the drift test in `tests/cli.test.ts`
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names) — uses command/behavior language a canon operator reads
- [x] Validation Required has at least one entry marked `- [x]`
