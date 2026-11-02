---
name: docs-audit
description: Audit canon-ai's active docs claim-by-claim against the code, triage the findings with Tim, apply the approved fixes, and leave the result validated and uncommitted. Use before cutting a minor release (docs/release-process.md "Cutting a release"), or when Tim asks to "audit the docs", "do a docs pass", "check the docs are accurate", or runs /docs-audit. canon-ai-local: not in CANON_OWNED, not shipped to adopters.
---

# docs-audit

A claim-level audit: parallel read-only agents check what each doc *says* against what the code *does*. `npm run docs-refs-check` and `npm run sync-templates:check` already catch broken paths and mirror drift; this skill covers the prose those checks can't see.

## 0. Before starting

- Run `git branch --show-current` and `git status --porcelain`. Audit `main` (the release ships from it), or a fresh branch off `origin/main`.
- Run `npm run docs-refs-check` and `npm run sync-templates:check` first; fix what they report so agents aren't re-finding it.

## 1. Audit (read-only, parallel)

Launch one **Sonnet** agent per group, in the background, in one message. Every brief says: the repo path and branch; READ-ONLY (no edits, no commits, never `cd` into `.canon/worktrees`); verify each factual claim against `src/`, `scripts/`, `.github/workflows/`, `package.json`, and `CHANGELOG.md` (newest entries are current behavior), and `tasks/_archive/<id>/` when needed; flag omissions an agent starting work would need; don't flag style, wording, or claims it couldn't check; for any doc with a `templates/` mirror, also flag adopter-facing text that breaks AGENTS.md §"Adopter Scope".

| Group | Docs |
|---|---|
| Core agent docs | `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/codebase-map.md` |
| Pipeline | `docs/pipeline-orchestrator.md` (flags, env vars, reroute, recovery, PR/ship: check each against `src/orchestrator/` and `canon --help`) |
| Patterns + decisions | `docs/patterns.md` (Trigger Table rows point at real sections and paths), `docs/decisions.md` (code still follows it? superseded without saying so? contradictions?), `docs/lessons-learned.md` (entries already promoted elsewhere or now false). Decisions are binding: judge only whether the doc matches reality |
| Product + release | `docs/product-context.md`, `docs/release-process.md` (against `.github/workflows/auto-release.yml` and `ci.yml`), root `README.md` (commands, flags, install steps, the recommended-permissions block against `src/`) |
| Skills + templates | `.claude/skills/canon-*/` and `.canon/templates/` (commands, flags, verdict names, headings, and paths they cite still exist and mean what they say) |

Add a group for any new long-lived doc that doesn't fit. `docs/BACKLOG.md`, `CHANGELOG.md`, `docs/task-quality-log.md`, and the dated reports (`docs/harness-audit-*.md`, `docs/canon-*-report.md`) are records: report stale lines in them, never propose edits as findings. Skip `docs/pipeline-invocations.md` (auto-logged metrics).

Required return format, most important first, under ~1200 words:

```
- doc file:line — the claim (short quote)
- verdict: WRONG | STALE | MISSING | OBSOLETE | DUPLICATE <doc:line> | CONTRADICTS <doc:line> | CODE DIVERGES | ADOPTER SCOPE
- evidence: source file + symbol (or command output)
- proposed fix: exact replacement text, or "delete"
```

…ending with one line: claims checked, and what couldn't be verified.

Save each report to the Claude session's scratchpad directory (never `tasks/`) as `findings-<group>.md`, and pass the absolute paths to the editing agents as it arrives (terse, one line per finding, with ids like K1, P1) — the editing agents read these.

## 2. Triage with Tim

Present one table (group, count, most serious items), recommend applying every WRONG / STALE / MISSING / DUPLICATE / ADOPTER SCOPE finding, and raise only real judgment calls (typically: archiving a superseded doc, a code-vs-doc conflict where the code may be the bug, removing dead code a doc describes). Code changes are never part of this pass: note them as follow-ups (an issue, or a `/canon-spec` task).

## 3. Apply (parallel, file-disjoint)

One **Sonnet** editing agent per group, each with an explicit list of files it alone may edit (no two agents share a file; anything shared, such as a `patterns.md` Trigger Table row, you do yourself afterward). Every brief says:

- verify each finding against source before editing; skip and report any that turn out wrong;
- cite files and symbol names, never line numbers;
- minimal, voice-matching edits; AGENTS.md/CLAUDE.md additions are one terse line;
- edit root copies only, never `templates/`; text in a mirrored file must make sense in an adopter's repo (AGENTS.md §"Adopter Scope");
- strict terminology (`docs/product-context.md`); punctuation outside quoted §"Heading" citations;
- if a heading is renamed, grep for `§"Old Heading"` citations and update them;
- don't stage or commit; finish with `npm run -s docs-refs-check`.

If an agent stops on a rate limit, resume it with SendMessage rather than starting a new one.

## 4. Validate and review

1. `npm run sync-templates`, then `npm run sync-templates:check` and `npm run docs-refs-check` both clean. If a skill or `.canon/templates/` file changed, also run `npm test` (some tests pin their content).
2. Spot-check every edit an agent reported as unverified.
3. `/canon-inline-review` on the uncommitted tree, steered at factual accuracy and adopter scope. Fix real findings.
4. Leave it uncommitted and ask Tim to commit (git consent is per action). Commit message notes the reviewer.
