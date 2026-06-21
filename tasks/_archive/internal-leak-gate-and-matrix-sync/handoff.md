# Implementation Handoff: internal-leak-gate-and-matrix-sync

> Author: Codex | Spec: `tasks/internal-leak-gate-and-matrix-sync/spec.md` | Plan: `tasks/internal-leak-gate-and-matrix-sync/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/sync-canon-templates.mjs` | Added a computed `INTERNAL_ONLY_TEMPLATE_BASENAMES` set derived from `scripts/run-task/prompts/templates/*.md` minus `.canon/templates/*.md`; bare internal-only basenames now trip `canon-internal-leak`; leak messages share a helper that distinguishes bare template filenames from path refs. |
| `tests/sync-canon-templates.test.ts` | Added coverage for bare internal-only basename leaks (`qa.md`, `implement.md`), explicit collision exemptions (`spec.md`, `plan.md`, `spec-review.md`), and a seam assertion that `implement.md` is in the derived internal-only set while `spec.md` is not. |
| `tests/validation-matrix-sync.test.ts` | New drift-guard test extracts the Validation Matrix from `scripts/run-task/prompts/templates/implement.md` and `.canon/templates/spec.md`, asserts both blocks are non-empty, and compares them byte-for-byte. |
| `.claude/skills/canon-changelog/SKILL.md` | Reframed the release-rules sentence to point at canon's QA phase instead of naming `qa.md`. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Synced mirror of the changelog skill update. |
| `docs/decisions.md` | Added a new decision entry stating shipped guidance must not name orchestration internals and that `scripts/sync-canon-templates.mjs` enforces the rule. |
| `tasks/internal-leak-gate-and-matrix-sync/notes.md` | Appended an implementation note about the module-load-time derivation of the internal-only basename set. |
| `tasks/internal-leak-gate-and-matrix-sync/status.json` | Pipeline-managed task metadata now reflects the worktree branch and implement-in-progress phase state. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Extended the leak gate so canon-managed markdown catches bare references to canon-internal prompt-template basenames that adopters do not have, while preserving the existing full-path, relative-path, code-fence, and repo-escape behavior. Added a direct drift test for the universal Validation Matrix so the duplicated tables in `implement.md` and `.canon/templates/spec.md` cannot silently diverge. Reframed the changelog guidance and added a durable decision entry so the rule is explicit in shipped guidance and backed by the executable leak gate.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `scripts/sync-canon-templates.mjs`'s leak check flags a backtick reference to a bare internal-only prompt-template basename (no path component) inside any scanned canon-managed markdown file. | Met | Covered by `scripts/sync-canon-templates.mjs:27-39,71-92,140-167,309-355` and `tests/sync-canon-templates.test.ts:303-334`. |
| AC-2: The leak check does not flag bare references to `spec.md`, `plan.md`, or `spec-review.md`. | Met | Covered by `tests/sync-canon-templates.test.ts:336-355`. |
| AC-3: The internal-only basename set is derived from the template directories, not a hand-maintained literal list. | Met | `scripts/sync-canon-templates.mjs:27-39` derives the set from the actual directories; `tests/sync-canon-templates.test.ts:303-334` pins `implement.md` in the set and `spec.md` out of it. |
| AC-4: Existing leak-gate behavior is preserved for full-path refs, relative refs, fenced blocks, and repo escapes. | Met | The existing tests remain in `tests/sync-canon-templates.test.ts:281-299,358-425` and passed unchanged. |
| AC-5: Validation Matrix extracted from `scripts/run-task/prompts/templates/implement.md` matches `.canon/templates/spec.md` byte-for-byte and is non-empty in both files. | Met | Covered by `tests/validation-matrix-sync.test.ts:6-31`. |
| AC-6: `.claude/skills/canon-changelog/SKILL.md` no longer contains a backtick reference to an internal-only basename and the sentence is reframed around canon's QA phase. | Met | Covered by `.claude/skills/canon-changelog/SKILL.md:222-226` and the synced mirror. |
| AC-7: `templates/.claude/skills/canon-changelog/SKILL.md` matches the edited root file. | Met | `npm run sync-templates:check` passed after syncing the mirror. |
| AC-8: Running the leak gate over the whole repo passes with no `[canon-internal-leak]` errors. | Met | `npm run sync-templates:check` exited 0. |
| AC-9: `docs/decisions.md` gains a new decision entry stating shipped guidance must not reference orchestration internals, with the leak gate as enforcement. | Met | Covered by `docs/decisions.md:161-167`. |

## Edge Cases Considered

- Bare basename collisions are intentionally exempt for `spec.md`, `plan.md`, and `spec-review.md`, because those names also belong to adopter-facing task artifacts and shipped templates.
- Code-fenced refs remain ignored, so examples in fenced snippets do not trigger the leak gate.
- The matrix extractor fails closed if the anchor header disappears or the block is empty, avoiding a vacuous pass.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite passed: 882 passed, 1 skipped. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |
| `npm run build` | not_configured | Spec marked this N/A. |
| `<E2E>` | not_configured | Spec marked this N/A. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

