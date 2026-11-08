# Completion Summary: path-scoped-pitfalls — Inject only pitfalls and lessons relevant to Affected Files

> For the human. This is what you need to know.

## What Changed

The implement and implement-reroute prompts no longer paste the whole `## Known Pitfalls` section into the implementer's context. A new selector reads the spec's Affected Files and injects only the pitfalls and lessons that cite those files, in full. Everything else is a one-line title, and every index row (the area table that maps docs or sections to path globs) stays visible. The block has a fixed byte cap (about 24 KB); when it is exceeded, full entries are demoted to titles first, then titles and index rows are truncated with counts. Split-doc layouts now work: a Known Pitfalls index row whose path glob matches an Affected File pulls that doc's matching entries in, and lists the doc's other entries as titles with a pointer to open it. Matching `docs/lessons-learned.md` entries appear under their own heading. Park-resume inherits the change through the fresh implement prompt. The old `buildKnownPitfalls` is gone. Docs, the adopter scaffold, the init write guide, and the README now describe the new behavior and the full-path citation convention. The spec went through one behavior amendment (Amendment 1) after code review found the table-membership and target-cell rules underspecified.

## Files Changed

- `src/orchestrator/pitfalls.ts` — new relevance selector: entries, index tables, token matching, dedup, area and title index, cap
- `src/orchestrator/context.ts` — `buildKnownPitfalls` removed, along with its unused worktree import
- `src/orchestrator/prompts/index.ts` — fresh implement and implement-reroute call the new selector
- `tests/pitfalls.test.ts` — unit tests for the spec's ACs, including the real canon-ai `docs/patterns.md` Lint row and the Validation Gate Discipline section
- `tests/fixtures/patterns.stub.md` — one matching and one unrelated path-citing pitfall
- `tests/fixtures/pitfalls-docs/docs/lessons-learned.md` — fixture lesson for the lessons channel
- `tests/run-task-prompts.test.ts` — golden fixture spec restructured to `## Design` / `### Affected Files`; docs-root override; empty-diff call-site test; park-resume coverage
- `tests/run-task-prompts.golden.json` — regenerated fresh, reroute, and reroute-resumed snapshots
- `docs/patterns.md` — "How to use this doc" describes relevance selection
- `templates/docs/patterns.md` — selection guidance and one-H3-per-pitfall format with a full-path example (scaffold, not a managed mirror)
- `.claude/skills/canon-init/write-guide.md` and `templates/.claude/skills/canon-init/write-guide.md` — cite full paths or globs; index split docs before the H3 entries with a `Read this doc` column
- `README.md` — pitfalls and lessons described as selected by Affected Files
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — `CANON_PATTERNS_MD_PATH` scope; new test-only docs-root override
- `docs/codebase-map.md` — Patterns entry and the new selector module
- `dist/orchestrator/run-task.js` — rebuilt tracked bundle

## How to Test

1. Start a small task whose spec lists, under `### Affected Files`, a file that some entry in `docs/patterns.md` cites by full path.
2. Open the implementer's prompt in the run log.
3. Expected: that pitfall appears in full. Other pitfalls appear as one-line titles. The Known Pitfalls portion is a small fraction of its former ~51 KB.
4. Expected: the Trigger Table section for that file (for example "Validation Gate Discipline" for `src/orchestrator/git.ts`) appears in full.
5. Expected: if a lesson in `docs/lessons-learned.md` cites the changed file, it appears under a lessons heading.
6. Expected: the area index still lists every Known Pitfalls index row, with the matched ones marked.
7. Optional: point the task at a file no pitfall cites. Expected: titles and the area index only, no full entries.

## Test Results

These results come from `handoff.md` § Validation Outcomes. QA did not re-run the suite.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean |
| `npm run type-check` | Pass | Clean |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js` |
| `npm test` | Pass | 2,144 passed, 1 skipped, 0 failed. The skipped test is the linked-worktree `REPO_ROOT` write test; this environment restricts `.git/` writes, so it did not run here. |
| `node --import tsx --test tests/pitfalls.test.ts` | Pass | 19 focused tests |
| `npm run docs-refs-check` | Pass | Final check after the handoff rewrite |
| `npm run sync-templates:check` | Pass | Final check after syncing the write-guide mirror |
| `git diff --check` | Pass | No whitespace errors |
| E2E | Not applicable | No E2E step in this task's Validation Required list |

## Human Verification Required

None.

Pre-merge checklist (items I cannot confirm from here):
- [ ] Version correct — not decided; the release step owns it (see Proposed Changelog)
- [ ] Changelog updated if needed — not edited; QA proposes entry text only
- [x] PR body current — `tasks/path-scoped-pitfalls/pr-body.md` written in this QA pass
- [ ] Final CI/CD checks green — not run in this phase; `gh pr checks` after the PR is opened
- [x] Final diff matches spec intent — the final code review verdict is "Approved with nits", and all 16 ACs are marked Pass in `review.md`

## Proposed Changelog

Scope check against `docs/decisions.md` § "Versioning and release policy": this changes what the implement prompt contains for every adopter, which is user-visible. It is in scope. The version tier is the release step's call.

### Changed

- **Implementers see the pitfalls and lessons that touch their task's files.** The implement and implement-reroute prompts no longer inject the whole `## Known Pitfalls` section. They select the entries that cite a path from the spec's Affected Files, the Trigger Table sections for those files, and the lessons that name them. Other pitfalls appear as one-line titles, within a size cap. Split pitfall docs are indexed by path glob, so the implementer knows which doc to open. Pitfall entries should cite full repository paths to be selected; the scaffold's `docs/patterns.md` format shows the convention.

## Judgment Calls to Confirm

- Index rows in the block — every index row becomes a one-line area index, with matched rows marked; alternative: only cross-cutting rows as pointers.
- Unmatched lessons — not listed; alternative: a title index for all lessons.
- Bare file-name tokens (`index.ts`) — never match; alternative: match on basename.
- Which tables count as index tables — the Trigger Table and tables under `## Known Pitfalls`; alternative: every table in `docs/patterns.md`.
- Byte cap — a fixed constant (about 24 KB) with no env var; alternative: a `MAX_PITFALLS_BYTES` override.
- Test seam — a test-only docs-root env override; alternative: thread a docs-root parameter through every prompt builder.
- Scaffold pitfall format — one H3 per pitfall citing full paths; alternative: keep the blockquote-under-category format.
- Index tables after the first H3 are not supported (Amendment 1) — they are entry content; alternative: a content-heuristic classifier, which three review rounds showed misclassified explanatory tables.
- Target-cell detection — header hint ("section", "doc", "read this"), then a fixed content precedence; alternative: content-only precedence, which broke a real layout in each of three review rounds.

## Decisions Made

- **Lessons example scope ends at the first unfenced `---` or the next H1/H2.** The spec excludes lessons under an H2 starting with "Example", but the real `docs/lessons-learned.md` puts every real lesson below `## Example entry`, separated by `---`. Read literally, the lessons channel would select nothing. Recorded in `tasks/path-scoped-pitfalls/notes.md`.
- **Cap demotion within a channel: largest body first, ties broken by later document position.** The spec orders channels but does not define order within one.
- **Legacy `## Known Pitfalls` with no H3 entries contributes no entry.** The spec defines entries as H3s. Left as an open question below.
- **Amendment 1 (table membership and target-cell precedence)** was added to `spec.md` after code review round 3 raised two spec gaps. The change went through the reroute path.

## Open Questions

- **Legacy Known Pitfalls layouts with no H3s.** A `## Known Pitfalls` section that holds only a table or prose injects nothing from that section. Should the selector fall back to the whole section? The spec says no; the human decides.
- **Silent omission (accepted Known Risk).** A pitfall that matters but cites only a basename, a symbol, or a root-level file (`package.json`) never matches. Its title still appears. Candidate follow-up if it bites.
- **Directory-only Affected Files (follow-up).** Matching is one-way from entry tokens to Affected Files. An Affected File of `src/orchestrator/` (a directory) therefore selects nothing. Dismissed in review as spec-defined; worth a decision.
- **Scaffold example path.** `templates/docs/patterns.md` uses `app/src/store/**` as an example. A review nit suggested a clearly fake path; the handoff does not say it was changed.
- **Lost test coverage (review nit).** The golden restructure removed coverage for the `none (spec has no Affected Files table)` header branch. A small dedicated test would restore it.

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: Yes
- Dropped ACs: 0
- Validation gaps: 1
- Notes: Code review halted on two spec gaps (table membership, target-cell precedence); Amendment 1 and a reroute followed. Skipped linked-worktree write test is environment-gated.

## Root Cause

- spec-gap: the spec did not define how to tell an index table from an explanatory table inside an entry (code review round 3, finding A); fixed by Amendment 1.
- spec-gap: the spec gave no precedence for choosing a row's target cell when several cells resolve (code review round 3, finding B); fixed by Amendment 1.
- execution: the round-1 target-cell scoring let a `.md` key cell become the row target, dropping the section match (code review round 2, finding 1); the fix introduced the round-3 regressions above.

Maintenance: lessons-learned.md plus this task's fragment have 33 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
