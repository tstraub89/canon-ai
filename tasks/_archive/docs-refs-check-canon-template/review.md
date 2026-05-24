# Code Review: docs-refs-check-canon-template

## Validation Gate

**BLOCKED — pre-flight rejected handoff before full review:**

- Validation Required section is missing from spec.md

## Verdict

- [x] **Changes requested** — fix the above and resubmit handoff.

---

## Round 4

### Stage 1 — Spec compliance

**Pre-flight note**: The prior three rounds blocked on "Validation Required section is missing from spec.md." That claim is incorrect — `spec.md` has a `## Validation Required` section with all six entries checked. The prior blocks were false. Proceeding with full review.

**Validation gate**: All required checks in Validation Outcomes table are Pass. No Fail results. `docs-refs-check` verified live — exits 0 with "All refs OK". `dist/cli/index.js` is committed per the diff. Stage 1 gate: pass.

**AC cross-reference**

| AC | Status | Verified |
|---|---|---|
| AC-1: `scripts/docs-refs-check.mjs` exists with shebang and attribution header. | Met | File present; starts `#!/usr/bin/env node`; attribution comment block in diff. |
| AC-2: Four ref classes each with positive and negative test. | Met | `tests/docs-refs-check.test.ts` has pass+fail fixtures for file-path, symbol-in-file, section, and anchor (both same-file and cross-file anchor). |
| AC-3: `VALID_DIRS` near top with canon-ai-dev allowlist and adopter comment. | Met | Exact set matches spec: src, scripts, tests, docs, public, tasks, .github, .canon, .claude, .codex, templates. Comment present. |
| AC-4: Walk docs/tasks/templates/root agent files; skip node_modules/dist/hidden dirs. | Met (deviation documented) | Templates/ collected but skipped via `isNoisySourceFile` — documented deviation with sound rationale (parameterized content). Non-goals explicitly carve out `.canon/templates/*.md`; deviation is slightly broader but creates no blind spots since live docs are already validated via their real paths. |
| AC-5: Exit 0 on clean, non-zero on broken; stderr format `<file>:<line>: <ref> — <reason>`. | Met | Tests verify both exit-code paths; live run confirms `All refs OK` exit 0. |
| AC-6: `"docs-refs-check"` npm script added; existing scripts unchanged. | Met | Verified in `package.json` diff. |
| AC-7: `"files"` array expanded to include `"scripts/"`. | Met | `package.json` diff shows expansion; handoff confirms `npm pack --dry-run` verified. |
| AC-8: `CANON_OWNED` gains `'scripts/docs-refs-check.mjs'` with first-script comment. | Met | `upgrade.ts` diff and `dist/cli/index.js` diff both show the entry. |
| AC-8b: `templates/scripts/docs-refs-check.mjs` byte-identical to root script. | Met | `diff` returns empty output (verified live). |
| AC-9: `npm run docs-refs-check` step between type-check and test in `ci.yml`. | Met | Actual position: type-check → docs-refs-check → build → test; satisfies "between type-check and `npm test`". |
| AC-9b: New doc-only workflow covers paths ci.yml skips. | Met | `.github/workflows/docs-refs-check.yml` paths: AGENTS.md, CLAUDE.md, CODEX.md, docs/\*\*, tasks/\*\*, !tasks/_templates/\*\*, .github/\*\*/*.md — matches ci.yml's exclude list. |
| AC-10: `docs/architecture.md` gains `docs-refs-check` validation row. | Met | Row present in diff. |
| AC-11: `AGENTS.md` validation matrix gains "Docs references" row. | Met | Row present in diff. |
| AC-12: `docs/codebase-map.md` gains validator row. | Met | Row present in diff. |
| AC-13: Adopter-facing CI paragraph in `docs/architecture.md` CI section. | Met | Paragraph added after "Concurrency" line in CI section. |
| AC-14: `tests/docs-refs-check.test.ts` exists with `fs.mkdtempSync` fixtures. | Met | File present; `mkdtempSync` confirmed in source; 419 tests pass per handoff. |
| AC-15: Gate passes on this PR after cleanup commits. | Met | Live run: `All refs OK`, exit 0. |
| AC-16: `CHANGELOG.md` 1.4.0 Added entry. | Met | Entry present in diff with attribution. |
| AC-17: lint, type-check, tests, build, dist freshness. | Met | All Pass per Validation Outcomes; `dist/cli/index.js` committed per diff. |

**Non-goals**: respected — no canon doctor integration, no JSON-file allowlist under `.canon/`, no CI workflow shipped to adopters.

**Known Risks**: addressed — pre-existing drift cleaned (gate passes), test isolation via `mkdtempSync`, mirror convention documented.

**Human Test Plan**: satisfiable — manual gate and CI integration steps are straightforward.

**Stage 1 verdict: PASS.** Proceeding to Stage 2.

---

### Stage 2 — Code quality

**`optional cleanup/nit`** `docs/architecture.md:154` — The "Each job runs in order" sentence was already wrong before this task (it said `npm test → npm run build`, but actual ci.yml had `build → test`). This task opened the file to add AC-10 and AC-13 content but didn't update this sentence. It now omits `docs-refs-check` entirely and still has the build/test order reversed. The accurate sequence is: `npm ci → npm audit → npm run lint → npm run type-check → npm run docs-refs-check → npm run build → npm test`. Agents read this line to understand CI — it should match the actual workflow. Does not require Codex iteration; can be fixed inline if desired.

**`optional cleanup/nit`** `scripts/docs-refs-check.mjs.d.ts:1` — `declare module '*.mjs'` is a wildcard ambient declaration. It applies to every `.mjs` import in the project, not just `docs-refs-check.mjs`. Currently non-breaking (type-check passes, no other `.mjs` files are imported as modules), but a future test or source file importing a different `.mjs` script would silently resolve to `{ Finding, runChecks, VALID_DIRS, main }`. A named module path (`declare module '../scripts/docs-refs-check.mjs'`) or a co-located `.d.mts` file would scope the declaration precisely. Does not require Codex iteration.

---

### Verdict

- [x] **Approved with nits** — all ACs met, gate passes live, no correctness bugs. The two nits are cleanup items that do not require Codex iteration.
