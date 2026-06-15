# Plan: canon-inline-review-skill

> Spec verdict: approved_with_nits
> Nit 1 (human test plan language): no implementation change — noted for QA; done.md should rewrite test steps in product language without file-path references.
> Nit 2 (AC-3 user-facing input contract): resolved in Step 1 — the SKILL.md target-selection procedure explicitly pins how the skill derives the target from `$ARGUMENTS` + working-tree state.

## Sequencing note

This task (A) shares `CLAUDE.md` with the deep CLAUDE.md slim (B) and shares `canon-owned.ts` with the `canon-review`→`canon-spec-review` rename (C). Do not run B or C in parallel with this task.

## Step 1 — Create `.claude/skills/canon-inline-review/SKILL.md`

Create the directory and file from scratch. The file must contain:

### Frontmatter (YAML between `---` fences)

```yaml
name: canon-inline-review
description: "Use when the human asks for an independent cross-review of below-pipeline work — uncommitted changes, a specific commit, or the whole branch before a PR. Triggers on '/canon-inline-review', 'review my uncommitted changes', 'codex review this', 'cross-review before I commit', 'review the last commit', 'review my branch'. NOT for spec compliance (use canon run / --reroute) or for the pipeline's own code_review phase."
allowed-tools: Bash(git status*) Bash(git log*) Bash(git rev-parse*) Bash(git branch*) Bash(codex review*) Bash(codex exec review*)
effort: medium
```

### Body content

Write these sections in order:

#### When to use

Non-trivial inline edits and XS fixes too small to justify a canon task. Invoke before committing or before opening a PR. Claude never self-reviews its own inline code — this skill invokes Codex as the independent reviewer.

**Scope bound**: catches correctness and quality bugs across models. It is **not** a spec-compliance gate; anything with acceptance criteria goes through `canon run` / `--reroute`, not this skill.

#### Target-selection contract

This is a guided procedure — the skill determines the target, not the operator.

**(a) Read operator intent first.** Check `$ARGUMENTS`:
- If it names a commit SHA, "last commit", "HEAD", or a `HEAD~N` reference → resolve to a SHA via `git log -1 --format=%H <ref>` or `git rev-parse <ref>`, then use `--commit <SHA>`.
- If it names a branch or says "whole branch" / "pre-PR" → use `--base <default-branch>` (resolve the default branch via `git symbolic-ref refs/remotes/origin/HEAD --short | sed 's|origin/||'` or fall back to `main`).
- If it contains custom steering instructions (not a target selector) → use those as the positional PROMPT (prompt-only form; target defaults to the uncommitted tree).
- If `$ARGUMENTS` is empty → proceed to (b).

**(b) Inspect working-tree state.** Run `git status --porcelain`.
- **Clean tree**: `--uncommitted` would be a no-op. If no explicit target from (a), stop and ask: "The working tree is clean — did you mean to review a specific commit or the whole branch?"
- **Uncommitted changes present, no explicit override**: default to `--uncommitted`. State: "Reviewing uncommitted changes (staged + unstaged + untracked working-tree delta)."
- **Both uncommitted changes and unpushed commits present, no explicit target**: genuinely ambiguous. Ask: "You have uncommitted changes *and* local commits not yet pushed. Review only the uncommitted working-tree changes (`--uncommitted`) or the full branch since its base (`--base <branch>`)?"

**(c) Override from (a) takes precedence over (b).** When the operator names a target, use it regardless of working-tree state.

**(d) State the chosen target and its scope before running.** One line: what the review covers and why. Then run.

#### Mutual exclusivity (selector XOR prompt)

A target selector (`--uncommitted` / `--commit <SHA>` / `--base <branch>`) and a positional PROMPT **cannot be combined** — the CLI rejects the pair with `cannot be used with '[PROMPT]'`. Use prompt-only (no selector) when steering with custom instructions; the target then defaults to the uncommitted tree. This is observed behavior of codex-cli 0.139.0; it is not surfaced in `--help`.

#### Running the review

`codex review` is the shorthand for `codex exec review`. Both are equivalent; the documented form is `codex exec review`. The `review` subcommand runs non-interactively — no `< /dev/null` needed, no stdin-hang risk.

Run the chosen invocation (example: `codex review --uncommitted`). Wait for completion.

To get the live flag set for the installed codex version, run `codex exec review --help`. The flags pinned here (as of codex-cli 0.139.0) are `--uncommitted`, `--commit <SHA>`, `--base <branch>`, and the positional `[PROMPT]`.

#### Reporting findings

Summarize the findings concisely — do not dump raw output. Group by severity (bugs, then quality issues, then nits). If there are no findings, say so in one line. Protect the session's context; a wall of raw codex output is not a report.

#### Gotchas

- **`--commit <SHA>` reviews only that commit's own diff**, not the cumulative state up to it. For "everything I've done on this branch," use `--base <branch>`, not repeated `--commit` calls.
- **No multi-SHA or commit-range form.** To review a span, either commit the lot and use `--base`, or use `--base <branch>` directly.
- **`--uncommitted` excludes already-committed work.** If the human's change is already committed, `--uncommitted` misses it.
- **Clean working tree → `--uncommitted` is a no-op** (see target-selection contract (b)).

---

## Step 2 — Collapse the CLAUDE.md cross-review section

Replace the block at lines 209–220 in `CLAUDE.md` — the full `## Cross-review for inline and XS work (\`codex review\`)` section and its body — with:

```
## Cross-review for inline and XS work

Non-trivial inline edits and XS fixes too small for a canon task get an independent `codex review` before commit. Claude never self-reviews its own inline code; this is not a spec-compliance gate (anything with ACs goes through `canon run` / `--reroute`). Use the `/canon-inline-review` skill to drive the review — it handles target selection, runs the review, and reports findings.
```

Verify after: `grep -c 'codex review --uncommitted' CLAUDE.md` must return `0`.

---

## Step 3 — Register in `src/lib/canon-owned.ts`

In `src/lib/canon-owned.ts`, add `'.claude/skills/canon-inline-review/SKILL.md'` to `CANON_OWNED` immediately after `'.claude/skills/canon-review/SKILL.md'` (currently line 10), before the agent entries:

```ts
    '.claude/skills/canon-review/SKILL.md',
    '.claude/skills/canon-inline-review/SKILL.md',
    '.claude/agents/code-review-anchored.md',
```

Do not touch `DELIMITED`.

---

## Step 4 — Register in `src/cli/commands/doctor.ts`

Two edits:

**4a.** In `checkSkills()` at line ~249, add `'canon-inline-review'` to `skillNames`:
```ts
const skillNames = ['canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog', 'canon-review', 'canon-inline-review'];
```

**4b.** In `RECOMMENDED_ALLOW` at lines 78–79, append after `'Skill(canon-review:*)'`:
```ts
    'Skill(canon-inline-review)',
    'Skill(canon-inline-review:*)',
```

---

## Step 5 — Update `tests/cli.test.ts`

**5a.** Test at line 406 — rename and expand:
- Change test name from `'checkSkills: all six skills present → pass'` to `'checkSkills: all seven skills present → pass'`.
- Add `'canon-inline-review'` to the skill array (7 total: `canon-init`, `canon-spec`, `canon-pipeline`, `canon-status`, `canon-changelog`, `canon-review`, `canon-inline-review`).

**5b.** Test at line 425 (`'checkSkills: canon-init present but all operational skills missing → warn with names'`): no change needed — assertions check for `canon-spec`, `canon-pipeline`, `canon-status`, `canon-changelog` in the warning; adding `canon-inline-review` to `skillNames` means it also appears in the warning, which doesn't break those assertions.

**5c.** Test at line 439 (`'checkSkills: canon-changelog specifically checked…'`): no change needed — the fixture omits `canon-changelog` and `canon-review` (and will now also omit `canon-inline-review`); the assertion only checks that the warning mentions `canon-changelog`, which still holds.

---

## Step 6 — Grant in `.claude/settings.json`

In `.claude/settings.json`, append after `"Skill(canon-review:*)"` in `permissions.allow`:
```json
      "Skill(canon-inline-review)",
      "Skill(canon-inline-review:*)"
```

This file is canon-ai-local only — no `templates/` mirror exists and must not be created. The sync pipeline never touches `settings.json` (confirmed: `WHOLESALE_SYNC = [...CANON_OWNED]` in `scripts/sync-canon-templates.mjs` has no `settings.json` entry).

---

## Step 7 — Update `README.md`

Three edits:

**7a.** Skill catalog table (after the `/canon-review` row, around line 113): add:
```md
| `/canon-inline-review` | Independent cross-review of inline or XS changes before commit or PR |
```

**7b.** Prose skill summary (around line 261): append to the parenthetical list of installed skills:
```
…`/canon-status` (in-flight task map), `/canon-changelog` (release notes for versioned projects), `/canon-inline-review` (independent cross-review of below-pipeline work)
```

**7c.** "Skip the permission prompts" JSON block (after `"Skill(canon-review:*)"`, around line 177): add:
```json
      "Skill(canon-inline-review)",
      "Skill(canon-inline-review:*)"
```

This block is drift-tested against `RECOMMENDED_ALLOW` in `tests/cli.test.ts` — it must stay in lockstep with the Step 4b edit or `npm test` fails.

---

## Step 8 — Run validation

Run in this order:

1. `npm run lint`
2. `npm run type-check`
3. `npm test` — skill-enumeration and RECOMMENDED_ALLOW drift tests must pass
4. `npm run docs-refs-check` — path refs in CLAUDE.md and SKILL.md must resolve
5. `npm run build` — regenerates `dist/` (bundles `doctor.ts` + `canon-owned.ts`); commit `dist/`
6. `npm run sync-templates:check` — root and `templates/` mirrors in sync

The pre-commit hook (`sync-canon-templates.mjs --stage`) auto-creates and stages:
- `templates/.claude/skills/canon-inline-review/SKILL.md` (because it's in `CANON_OWNED`)
- Updates `templates/CLAUDE.md` (because `CLAUDE.md` is in `DELIMITED`)

Run `git status` before committing to confirm the sync hook staged the mirrors. Do not manually edit `templates/`.
