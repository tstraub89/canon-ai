# Plan: canon-spec-review-rename — Rename canon-review skill to canon-spec-review

## Approach

Pure rename — no behavior changes. 14 hand-edited source files, then tooling generates the derived artifacts (`templates/` mirrors + `dist/`). The plan is ordered to keep the README↔`RECOMMENDED_ALLOW` lockstep and to avoid leaving the codebase in a broken intermediate state during validation.

**Key constraint**: `npm run sync-templates` writes mirrors by path but never deletes — the orphaned `templates/.claude/skills/canon-review/` must be `git rm`'d before the sync-check gate will pass.

---

## Step 1 — Rename the skill directory and update SKILL.md

Rename `.claude/skills/canon-review/` → `.claude/skills/canon-spec-review/` (create the new dir, move the file, remove the old dir).

In `.claude/skills/canon-spec-review/SKILL.md`, make exactly 5 name-occurrence updates:

1. **Frontmatter `name:`** — `canon-review` → `canon-spec-review`
2. **Frontmatter `description:` trigger phrase** — `"/canon-review"` → `"/canon-spec-review"`
3. **H1 heading** — `# canon-review` → `# canon-spec-review`
4. **Usage line** (`usage is`) — `/canon-review <task-id>` → `/canon-spec-review <task-id>`
5. **Report header** in the Synthesize section — `# /canon-review for \`<task-id>\`` → `# /canon-spec-review for \`<task-id>\``

No other changes to the SKILL.md body.

---

## Step 2 — Update `src/lib/canon-owned.ts`

In `src/lib/canon-owned.ts`, in the `CANON_OWNED` array (line 10):

```
'.claude/skills/canon-review/SKILL.md',
```
→
```
'.claude/skills/canon-spec-review/SKILL.md',
```

---

## Step 3 — Update `src/cli/commands/doctor.ts` (two spots, same file)

**3a. `skillNames` array** (`checkSkills`, line 251):

```
['canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog', 'canon-review', 'canon-inline-review']
```
→
```
['canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog', 'canon-spec-review', 'canon-inline-review']
```

**3b. `RECOMMENDED_ALLOW` array** (lines 78–79):

```
    'Skill(canon-review)',
    'Skill(canon-review:*)',
```
→
```
    'Skill(canon-spec-review)',
    'Skill(canon-spec-review:*)',
```

Both changes must land in the same edit to keep `RECOMMENDED_ALLOW` and `README.md` in lockstep (the `cli.test.ts` `deepEqual` test enforces this — see Step 7).

---

## Step 4 — Update `README.md` (three spots)

**4a. Allowlist JSON block** (lines 177–178, inside the "Skip the permission prompts" section):

```json
      "Skill(canon-review)",
      "Skill(canon-review:*)",
```
→
```json
      "Skill(canon-spec-review)",
      "Skill(canon-spec-review:*)",
```

**4b. Skill-catalog table row** (line 113):

```
| `/canon-review` | Pre-flighting a spec before invoking the pipeline |
```
→
```
| `/canon-spec-review` | Pre-flighting a spec before invoking the pipeline |
```

**4c. Installed-skills prose list** (line 264):

```
`/canon-review` (pre-flight a spec)
```
→
```
`/canon-spec-review` (pre-flight a spec)
```

---

## Step 5 — Update sibling skills (root copies only)

Edit each root SKILL.md for the prose/grant change only. The `templates/` mirrors are sync-generated (Step 9).

**5a. `.claude/skills/canon-init/SKILL.md`** (line 142) — grant snippet:
```
           "Skill(canon-review)", "Skill(canon-review:*)"
```
→
```
           "Skill(canon-spec-review)", "Skill(canon-spec-review:*)"
```

**5b. `.claude/skills/canon-pipeline/SKILL.md`** (line 186) — cross-link:
```
- `/canon-review` — adversarial pre-pipeline spec review before invoking the pipeline.
```
→
```
- `/canon-spec-review` — adversarial pre-pipeline spec review before invoking the pipeline.
```

**5c. `.claude/skills/canon-spec/SKILL.md`** (line 186) — cross-link:
```
- `/canon-review` — adversarial pre-pipeline review of the spec. Recommended for M/L/XL or delicate tasks before invoking the pipeline.
```
→
```
- `/canon-spec-review` — adversarial pre-pipeline review of the spec. Recommended for M/L/XL or delicate tasks before invoking the pipeline.
```

**5d. `.claude/skills/canon-status/SKILL.md`** (line 102) — cross-link:
```
- `/canon-review` — pre-flight a spec before invoking the pipeline.
```
→
```
- `/canon-spec-review` — pre-flight a spec before invoking the pipeline.
```

---

## Step 6 — Update `docs/pipeline-orchestrator.md` (3 references)

Three occurrences (lines 5, 171, 472). Replace each `/canon-review` → `/canon-spec-review`. Root copy only; the `templates/` mirror is sync-generated.

Line 5 (introductory cross-reference):
```
see `/canon-review`.
```
→
```
see `/canon-spec-review`.
```

Line 171 (optional pre-pipeline self-review paragraph):
```
the operator can run `/canon-review <task-id>`
```
→
```
the operator can run `/canon-spec-review <task-id>`
```

Line 472 (Related section):
```
- `/canon-review` — adversarial pre-pipeline spec review (multi-agent fan-out) for M/L/XL or delicate tasks.
```
→
```
- `/canon-spec-review` — adversarial pre-pipeline spec review (multi-agent fan-out) for M/L/XL or delicate tasks.
```

---

## Step 7 — Update `tests/cli.test.ts`

Line 408, the seven-skill `for` loop:
```
for (const skill of ['canon-init', 'canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog', 'canon-review', 'canon-inline-review']) {
```
→
```
for (const skill of ['canon-init', 'canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog', 'canon-spec-review', 'canon-inline-review']) {
```

The `README ↔ RECOMMENDED_ALLOW deepEqual` test passes automatically once Steps 3b and 4a both carry the new grants.

---

## Step 8 — Update `.claude/settings.json` (hygiene; not shipped)

Lines 63–64:
```json
      "Skill(canon-review)",
      "Skill(canon-review:*)",
```
→
```json
      "Skill(canon-spec-review)",
      "Skill(canon-spec-review:*)",
```

---

## Step 9 — Update forward-looking dev docs

**`docs/decisions.md`** (line 178) — update the in-progress backlog reference:
```
a spec-contradiction lint in `/canon-review`.
```
→
```
a spec-contradiction lint in `/canon-spec-review`.
```

**`docs/BACKLOG.md`** — update the two prose references:
- Line 632: `Distinct from \`/canon-review\`` → `Distinct from \`/canon-spec-review\``
- Line 654: `\`/canon-review\` skill` header and occurrence → `\`/canon-spec-review\` skill`

---

## Step 10 — Add CHANGELOG.md entry

Add to the existing `## [Unreleased]` section's `### Changed` block (append after the existing paragraph):

```markdown
- **The pre-pipeline spec-preview skill is renamed `/canon-spec-review` (was `/canon-review`).** The new name aligns with the pipeline phase it pre-empts (`spec_review`) and disambiguates from the sibling `/canon-inline-review` skill (code-diff review). Behavior is unchanged — same three-sub-agent fan-out, same BLOCKING/STRONG/NIT report, same read-only advisory output. **Upgrading adopters**: `canon upgrade` is additive-only and will not remove the old `.claude/skills/canon-review/` directory. After upgrading, delete it manually: `rm -rf .claude/skills/canon-review/`.
```

Do not edit any existing CHANGELOG entries.

---

## Step 11 — Remove orphaned templates mirror

Run:
```
git rm -r templates/.claude/skills/canon-review/
```

The sync hook regenerates mirrors by writing paths from `CANON_OWNED` — it does not prune directories not in the list. The old `templates/.claude/skills/canon-review/SKILL.md` must be explicitly removed or `npm run sync-templates:check` will report a stale file.

---

## Step 12 — Run sync-templates to regenerate all mirrors

```
npm run sync-templates
```

This regenerates (and stages) the `templates/` mirrors for all edited root canon-owned files:
- `templates/.claude/skills/canon-spec-review/SKILL.md` (new)
- `templates/.claude/skills/canon-init/SKILL.md`
- `templates/.claude/skills/canon-pipeline/SKILL.md`
- `templates/.claude/skills/canon-spec/SKILL.md`
- `templates/.claude/skills/canon-status/SKILL.md`
- `templates/docs/pipeline-orchestrator.md`

Verify that `templates/.claude/skills/canon-review/` is gone (Step 11) and that the new mirror dir exists.

---

## Step 13 — Rebuild dist

```
npm run build
```

Bundles the updated `doctor.ts` (`skillNames`, `RECOMMENDED_ALLOW`) and `canon-owned.ts` (`CANON_OWNED`) into `dist/cli/index.js`. Do not hand-edit `dist/`.

---

## Step 14 — Run full validation suite

```
npm run lint
npm run type-check
npm test
npm run build && git diff --exit-code -- dist/
npm run sync-templates:check
npm run docs-refs-check
```

All must pass. Specific things each gate catches:
- `npm test` — the seven-skill list (AC-3) and README↔`RECOMMENDED_ALLOW` `deepEqual` (AC-4)
- `sync-templates:check` — templates mirror is current; old mirror dir absent (AC-2)
- `git diff --exit-code -- dist/` — dist is current after rebuild (AC-6)
- `docs-refs-check` — no broken backtick path refs introduced by the edits

---

## Step 15 — Structural grep gate (AC-9)

After all edits and generated artifacts are in place, run:

```
git grep -n 'canon-review'
```

Expected hits only in:
- `CHANGELOG.md` (historical entries + new adopter-guidance entry)
- `tasks/_archive/**` (archived audit trail)
- `tasks/canon-spec-review-rename/**` (this task's own artifacts)

Any hit outside this allow-list = a missed occurrence that must be fixed before handoff.

---

## Handoff notes for Codex

- **Over-broad replace is the primary risk** — `canon-review` appears in CHANGELOG history and archived task artifacts that must NOT be touched. Work file-by-file against this plan rather than running a global find/replace.
- **Two-spot atomicity in doctor.ts** — `skillNames` and `RECOMMENDED_ALLOW` are both in `src/cli/commands/doctor.ts`; update them in the same file edit.
- **README↔RECOMMENDED_ALLOW atomicity** — the `deepEqual` test in `cli.test.ts` fails if either side is updated without the other. Steps 3b and 4a must both be done before running the test suite.
- **Generated paths must appear in handoff Changes table** — `dist/cli/index.js`, `templates/.claude/skills/canon-review/SKILL.md` (deleted), `templates/.claude/skills/canon-spec-review/SKILL.md` (new), and all five re-synced `templates/` mirrors (`canon-init`, `canon-pipeline`, `canon-spec`, `canon-status`, `pipeline-orchestrator.md`) are produced by tooling but land in `git diff <base>...HEAD` — list each in the handoff Changes table or the diff↔handoff reconciler will reject the push.
