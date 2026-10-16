# Spec: configurable-docs-freshness — Configurable QA docs freshness via `.canon/config.json`

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

QA's "Docs freshness — Two-checkpoint" step scans a hardcoded list of five protected docs (`docs/architecture.md`, `docs/codebase-map.md`, `docs/patterns.md`, `docs/product-context.md`, `docs/decisions.md`), written as literals in the QA prompt template. Projects keep other long-lived docs that drift with code just as often (an API contract, an env-var reference, CI process docs, the root `AGENTS.md`). None of them are in QA's scope, so every task can be locally correct while the project-level picture decays (public issue #87).

The commit side has the same gap. QA may only commit edits to `PIPELINE_MANAGED_DOCS` (`src/orchestrator/worktree.ts`). An adopter whose QA keeps a project doc current, for example `docs/ROADMAP.md`, hits `QA-end commit aborted: working tree has dirty files outside the QA-end allowlist`, and there is no extension point (public issue #7). `docs/BACKLOG.md` already names a central adopter config, `.canon/config.json`, as the design-of-record home for "protected docs".

Two existing defects ride along:

1. **The prompt and the allowlist disagree.** The QA prompt names five docs. `PIPELINE_MANAGED_DOCS` has six: it also includes `docs/pipeline-orchestrator.md`.
2. **QA edits to `pipeline-orchestrator.md` don't survive in adopter repos.** In an adopter repo, `docs/pipeline-orchestrator.md` is a `CANON_OWNED` file (`src/lib/canon-owned.ts`). `canon upgrade` overwrites it, or refuses to run while it is dirty, so admitting QA edits to it there is wrong. It belongs in the set only in canon-ai, where the root copy is authoritative.

These sites read the managed-doc constants today, with the behavior shown:

| Site | Today |
|---|---|
| `commitQaArtifacts` (QA-end commit) | admits all of `PIPELINE_MANAGED_DOCS` unconditionally |
| `commitHumanReviewFiles` (`--pr` / `--push` human-review commit) | admits a spec Affected Files entry only if it is in `PIPELINE_MANAGED_DOCS` (`main.ts` ~1257); admits all of it once any member has `qa.status === 'done'` |
| `verifyBaseDrift` → `buildAffectedFilesAllowlist({admitManagedDocs})` | admits every Affected Files entry; adds all of `PIPELINE_MANAGED_DOCS` at QA-done |
| code_review pre-flight (`phases/code-review.ts`) and the full-send scope check (`main.ts`) | `admitManagedDocs: true` unconditionally |
| `classifyAndPreserveSharedDocDirt` (`--ship`, against the main checkout) | classifies dirty `PIPELINE_SHARED_DOCS` as managed (abort) or telemetry (preserve) |

## Decision

Add an adopter-owned project config file, `.canon/config.json`. Its first and only field in this task is `docs_freshness`:

```json
{
  "docs_freshness": {
    "protected": ["docs/architecture.md", "docs/codebase-map.md"],
    "paths": {
      "api/**": ["docs/api-contract.md", "docs/environment-variables.md"],
      "**": ["docs/ROADMAP.md"]
    },
    "flag_only": ["AGENTS.md"]
  }
}
```

- **`protected`** (optional): **replaces** canon's default protected set. When absent, the defaults are the five docs above, without `docs/pipeline-orchestrator.md`. `protected` is how a project narrows the set; to add docs, use `paths`.
- **`paths`** (optional): maps a repo-relative glob to the docs that QA must check whenever the task touches a matching path. `"**"` matches every path, including dotfiles and paths inside dot-directories, so a doc mapped from `"**"` applies to every task.
- **`flag_only`** (optional): docs that QA reports as stale instead of editing.
- **No file, or no `docs_freshness` key**: behavior equals today's, except that `docs/pipeline-orchestrator.md` leaves the default set.

### Two derived sets, with separate jobs

The orchestrator derives two sets deterministically:

- **The admitted set** decides which docs may be committed.
  - It is `(protected ∪ every doc named in any paths value) − flag_only`.
  - It depends only on the config, never on the diff.
  - It replaces `PIPELINE_MANAGED_DOCS` at every site in the Problem table, with the same timing each site has today:
    - unconditional at `commitQaArtifacts`, the code_review pre-flight and the full-send scope check;
    - at QA-done in `commitHumanReviewFiles` and `verifyBaseDrift`.
  - `commitHumanReviewFiles` admits an Affected Files entry when it is in the admitted set or in `flag_only`. A spec can therefore assign a flag-only doc to the implementer explicitly. Other Affected Files entries are filtered as today.
  - `--ship` dirt classification treats telemetry files as telemetry, as today, and every configured doc (`protected ∪ paths values ∪ flag_only`) as managed.
- **The QA prompt set** decides what QA is told to check.
  - It is the protected set, plus every doc that `paths` maps from a glob matching at least one path in the task's diff.
  - **The diff** is the rename-aware three-dot committed diff `<base>...HEAD` that `getAffectedFiles` already computes, with both sides of a rename counted. For a bundle it is the bundle's shared diff.
  - `tasks/**` paths and the pipeline telemetry files are excluded before matching.
  - The QA prompt set splits into **editable** (minus `flag_only`) and **flagged** (intersected with `flag_only`).
  - The QA prompt lists the editable docs to scan and correct, generated from the resolved set rather than literals. When the editable set is empty, the bullet says no docs are configured for correction.
  - When the flagged set is non-empty, the prompt lists those docs and tells QA to report each stale statement in a `## Docs drift` section of `done.md`, and not to edit those docs. When it is empty, the instruction is absent.
  - If the diff probe fails, the prompt uses the protected set only, and the orchestrator prints a warning naming the failure and the mapped docs it couldn't evaluate.

Since admission doesn't depend on the diff, a QA-edited mapped doc stays admitted through `--reroute`, re-review and `--pr`, even when a later round no longer touches the mapped path. QA's authority over configured docs then matches its current authority over managed docs. The only thing that gets more selective is what QA is told to look at.

### Spec authorship

The spec and spec-revision prompts show the project's `paths` map when it is non-empty, with an instruction: for any path the spec puts in Affected Files that matches a glob, name the mapped docs in Docs Impact, and list a mapped doc in Affected Files only if the implementer should edit it.

The `/canon-spec` skill's context-loading phase gains the same instruction, telling the author to read the project's docs-freshness config if one exists. The spec template's Docs Impact and Affected Files guidance stops saying "five protected docs" and describes the protected and mapped docs instead.

### Loading, validation, fail-closed

**One loader serves every consumer.** It reads the config from the checkout the consumer already operates in: the active checkout (the task worktree when one exists) for phases and human-review commits, and the main checkout for `--ship` classification.

**Malformed means any of the following:**

- the file is not valid JSON, or the top level is not an object;
- `docs_freshness` is present but not an object;
- `protected` or `flag_only` is not an array of non-empty strings;
- `paths` is not an object whose values are arrays of non-empty strings;
- a doc path is absolute, contains a `..` segment, or contains glob metacharacters;
- a `paths` key is empty, starts with `/` or `./`, or contains a `..` segment;
- a doc path in any of the three lists is a pipeline telemetry file (`docs/lessons-learned.md`, `docs/task-quality-log.md`, `docs/pipeline-invocations.md`) or lies under `tasks/`.

**Why the last rule.** Telemetry files and task artifacts are already admitted unconditionally by their own rules, and the QA prompt separately tells QA to append to the lessons buffer. Letting the config name them would create contradictions the resolver can't settle: a flag-only lessons buffer would be both required and forbidden in the same QA prompt, and still admitted by the telemetry rule; a protected telemetry file would flip `--ship` classification from preserve to abort. Rejecting the overlap keeps the three classes (task artifacts, telemetry, configured docs) disjoint, so each site's existing telemetry and task-artifact handling stays exactly as it is.

**Every load fails closed.** Any consumer that hits a malformed config stops the run non-zero with one message format naming `.canon/config.json` and the specific problem. No consumer falls back to defaults.

**Run-start check.** `canon run` validates the config once at start-up for every invocation form: plain, `--pr`, `--push`, `--ship`, `--reroute`, `--dry-run`, `--full-send`. It runs before any heartbeat, lock, status change, reroute or ship action, including `--ship`'s branch-fetch preflight. It validates the copy the invocation's consumers will read, chosen by mode:

- **`--ship`**: the main checkout, because `--ship`'s only consumer (shared-doc dirt classification) reads the main checkout. A malformed worktree copy does not block `--ship`; a malformed main copy does, even when the worktree copy is valid.
- **Every other form**: the task worktree if the task has one and it exists, otherwise the main checkout.

**Unknown keys** (top-level, or inside `docs_freshness`) are not errors, so a future field doesn't break older canon. `canon run` prints one stderr warning per run naming each unknown key, so a misspelled field such as `docsFreshness` or `protected_docs` is visible.

### `canon doctor`

`doctor` always reports a docs-freshness line in its Config section:

- **pass**, naming the source: "canon defaults (no config file)", or the config with counts of protected docs, mappings and flag-only docs;
- **fail** on a malformed config, with the loader's message;
- **warn** on unknown keys, on a configured doc that does not exist, and on a `paths` glob that matches no tracked file.

### Ownership and shipped text

- **Adopter-owned.** `.canon/config.json` is not in `CANON_OWNED`. `canon init` doesn't create it, and `canon upgrade` never creates, modifies or refuses on it.
- **canon-ai's own copy.** canon-ai gets a `.canon/config.json` whose `protected` is the five defaults plus `docs/pipeline-orchestrator.md`, which preserves canon-ai's current behavior.
- **Shipped text must not trip `docs-refs-check` in a repo without the file.** Every adopter-facing mention lives in a `CANON_OWNED` markdown file and must not produce a `docs-refs-check` failure in an adopter repo that has no config file and none of the example docs. Mentions are either unbackticked prose or inside fenced code blocks, which `docs-refs-check` skips.

## Non-Goals

- **`canon init` does not scaffold `.canon/config.json`.** Having the `/canon-init` grill write it is a follow-up.
- **No other `config.json` fields.** That rules out `validation_bindings`, `delicate_domains`, worktree settings and the rest of the BACKLOG entry.
- **The diff never narrows commit admission.** Admission is config-only by design; the diff only shapes the QA prompt.
- **No new runtime dependency.** `package.json` `dependencies` stay empty. Glob matching may use Node built-ins or a small in-repo matcher, as long as it has the dot-path semantics above.
- **No doc-side markers or frontmatter discovery.**
- **No change to `done.md`'s template.** The `## Docs drift` section is prompt-driven and appears only when flagged docs exist.

## Acceptance Criteria

- [ ] **AC-1 (resolver, pure):** A pure resolver takes the parsed config (or none) and a diff path list. It returns the protected set, the admitted set, the configured set, and the QA prompt editable and flagged sets, as defined in Decision. Table-driven unit tests cover:
  - no config, giving the five defaults, with `docs/pipeline-orchestrator.md` absent from every set;
  - `protected` replacing the defaults, including `[]`;
  - a mapped doc in the admitted set regardless of the diff;
  - a `paths` glob matching and not matching the diff, which changes only the prompt sets;
  - `"**"` matching a diff of only dotfile and dot-directory paths (e.g. `.github/workflows/ci.yml`, `.claude/skills/x/SKILL.md`, `.env.example`);
  - `api/**` matching `api/.internal/x.ts`;
  - `tasks/<id>/spec.md` and telemetry paths excluded from matching;
  - multiple globs mapping one doc, with no duplicates;
  - a `flag_only` doc that is protected, one that is mapped, and one that is neither: excluded from the admitted set, present in the configured set, and flagged only when it is in the prompt set.
- [ ] **AC-2 (loader validation):** Each malformed form listed in Decision has a unit test asserting a distinct message naming `.canon/config.json` and the offending key or path. The telemetry/task-artifact rule is tested once per list: `docs/lessons-learned.md` in `protected`, in a `paths` value, and in `flag_only`, plus a `tasks/x/spec.md` doc path, each rejected with a message naming the path. An absent file, `{}`, and unknown-keys-only all load as defaults. Unknown keys are returned as warnings, not errors.
- [ ] **AC-3 (run-start refusal):** Using the in-process `main()` harness in `tests/run-task-ship.test.ts` (fake agent CLIs, `CANON_NO_DETACH=1`), a temp repo with a malformed `.canon/config.json` makes `canon run <id>` exit non-zero with the loader's message. The test asserts that `status.json` is byte-identical and that no heartbeat or lock file exists afterwards. It repeats for `--ship`, `--reroute` and `--dry-run`. Two `--ship` source tests pin the mode rule: a malformed main-checkout config with a valid worktree config exits non-zero with the loader's message and leaves `status.json` byte-identical; a valid main-checkout config with a malformed worktree config does not fail with the loader's message. A separate test asserts an unknown-key warning on stderr, with the run otherwise proceeding.
- [ ] **AC-4 (mid-run load fails closed):** A unit test for each consumer type shows that a malformed config read after start-up stops with the loader's message and does not fall back to defaults. The consumer types are the QA prompt build, the QA-end commit, the `--pr` human-review commit, and `--ship` classification.
- [ ] **AC-5 (QA prompt):** The QA template no longer hardcodes the doc list; the five literal doc paths no longer appear in its Docs freshness bullet (grep AC on `qa.md`). Rendered-prompt tests assert:
  - with no config, exactly the five defaults are listed;
  - a mapped doc whose glob matches the fixture diff appears, and one whose glob doesn't is absent;
  - a matched `flag_only` doc appears only under the `## Docs drift` instruction;
  - with no flagged docs, the drift instruction is absent;
  - with an empty editable set, the bullet says no docs are configured for correction;
  - when the diff probe fails, only protected docs are listed, and a warning names the failure.

  The `promptQa` goldens are regenerated. The AC-11 relocation test's `Two-checkpoint` token still passes.
- [ ] **AC-6 (admission everywhere uses the admitted set):** Tests show, at each site in the Problem table:
  - a mapped doc is admitted;
  - a `flag_only` doc is rejected unless the spec's Affected Files lists it (at `commitHumanReviewFiles` and `verifyBaseDrift`);
  - `docs/pipeline-orchestrator.md` is rejected under the defaults and admitted when `protected` lists it.

  Timing is unchanged at each site: unconditional where it is today, QA-done-gated where it is today. A reroute regression test shows a mapped doc that QA committed passing the code_review pre-flight on a later round whose diff no longer touches the mapped glob. `--ship` classification tests show a dirty mapped doc and a dirty `flag_only` doc classified as managed (abort), and a telemetry file preserved.
- [ ] **AC-7 (`PIPELINE_MANAGED_DOCS` replaced):** Replace `PIPELINE_MANAGED_DOCS` and the managed half of `PIPELINE_SHARED_DOCS` with the resolver plus a default-protected constant. `grep -rn 'PIPELINE_MANAGED_DOCS' src/ tests/ docs/pipeline-orchestrator.md templates/` returns zero results, including comments and test titles. Abort, warning and help text (`src/cli/index.ts`, `src/orchestrator/cli.ts`) that named the managed docs now describes the protected and configured docs. The stderr-regex tests are updated.
- [ ] **AC-8 (spec authorship surfaces):**
  - With a non-empty `paths`, the rendered `promptSpec` and `promptSpecRevision` contain the glob-to-docs map and the instruction from Decision. Without one, they equal today's goldens. Goldens cover both cases.
  - `.canon/templates/spec.md`'s Docs Impact section and Affected Files blockquote describe the protected docs plus mapped docs. Neither says "Five protected docs" nor lists `pipeline-orchestrator` as a default (grep AC on the root file and its `templates/` mirror).
  - The `/canon-spec` skill's Phase 1 carries the config-reading instruction.
- [ ] **AC-9 (`canon doctor`):** A new check, wired into the Config section, returns:
  - pass with the source line for an absent config and for a valid one;
  - fail for a malformed config;
  - warn for an unknown key, a missing configured doc, and a glob matching no tracked file.

  Each status is unit-tested in the existing doctor style (temp dir, `checkX(dir)`, status plus detail regex).
- [ ] **AC-10 (adopter-owned):** `.canon/config.json` is absent from `CANON_OWNED`, `templates/`, and doctor's `EXPECTED_TEMPLATES`. A `cli.test.ts` test runs `canon upgrade` in a repo with a customized config and asserts that the file is byte-identical and that no refusal is reported. A `canon init` test asserts that the file is not created.
- [ ] **AC-11 (canon-ai dogfood):** canon-ai's `.canon/config.json` sets `protected` to the five defaults plus `docs/pipeline-orchestrator.md`, and `canon doctor` in canon-ai passes the docs-freshness line.
- [ ] **AC-12 (docs and shipped text):**
  - `.canon/README.md` stops claiming every file in `.canon/` is canon-managed, and carves out `config.json` as adopter-owned.
  - The root `README.md` gains a "Configuring docs freshness" subsection under "Getting started" that shows the schema, the replace semantics of `protected`, and `flag_only`.
  - Every `docs/pipeline-orchestrator.md` paragraph that restates managed-doc admission now describes the admitted set and the QA prompt set: the allow-list section, the code_review pre-flight paragraph, and the `--ship` shared-doc dirt paragraph.
  - The `docs/BACKLOG.md` `.canon/config.json` entry records the shipped `docs_freshness` slice and reconciles its `protected_docs` field name.
  - A test runs `docs-refs-check` over the shipped `CANON_OWNED` markdown in a fixture adopter tree with no `.canon/config.json` and asserts no failures.
  - `npm run docs-refs-check` and `npm run sync-templates:check` pass, and no adopter-facing text names a canon-internal `src/**` path.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/docs-freshness.ts` | New: loader and validator for `.canon/config.json`; pure resolver (protected / admitted / configured / QA prompt editable + flagged sets); default-protected constant; dot-aware glob matching |
| `src/orchestrator/worktree.ts` | Remove `PIPELINE_MANAGED_DOCS`; remove or rework `PIPELINE_SHARED_DOCS` |
| `src/orchestrator/main.ts` | `commitQaArtifacts`, `commitHumanReviewFiles` (incl. the Affected-Files filter), the full-send scope check, `classifyAndPreserveSharedDocDirt` read the resolver; run-start config validation and unknown-key warning in `main()` before heartbeat/ship/reroute; abort/warning text |
| `src/orchestrator/validation.ts` | `buildAffectedFilesAllowlist` admits a caller-supplied doc set; `verifyBaseDrift` passes the admitted set at QA-done; shared-doc dirt helpers take the configured set |
| `src/orchestrator/phases/code-review.ts` | Pre-flight scope check admits the admitted set |
| `src/orchestrator/phases/qa.ts` | Compute the filtered diff and QA prompt sets; pass to `promptQa`; probe-failure warning |
| `src/orchestrator/phases/spec.ts` | Pass the configured `paths` map to `promptSpec` / `promptSpecRevision` |
| `src/orchestrator/prompts/index.ts` | `promptQa`, `promptSpec`, `promptSpecRevision` accept and render the doc lists / map |
| `src/orchestrator/prompts/templates/qa.md` | Docs freshness bullet renders the resolved list; empty-set wording; conditional `## Docs drift` instruction |
| `src/orchestrator/prompts/templates/spec.md` | Conditional docs-map block |
| `src/orchestrator/prompts/templates/spec-revision.md` | Conditional docs-map block |
| `src/orchestrator/cli.ts` | Allow-list help text |
| `src/cli/index.ts` | Allow-list help text |
| `src/cli/commands/doctor.ts` | New docs-freshness check in the Config section |
| `.canon/templates/spec.md` | Docs Impact and Affected Files guidance wording |
| `templates/.canon/templates/spec.md` | Synced mirror |
| `.canon/README.md` | Carve out `config.json` as adopter-owned |
| `templates/.canon/README.md` | Synced mirror |
| `.claude/skills/canon-spec/SKILL.md` | Phase 1: read the docs-freshness config if present |
| `templates/.claude/skills/canon-spec/SKILL.md` | Synced mirror |
| `.canon/config.json` | New: canon-ai dogfood config |
| `docs/pipeline-orchestrator.md` | Allow-list, code_review pre-flight and `--ship` dirt paragraphs |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror |
| `README.md` | "Configuring docs freshness" subsection |
| `docs/BACKLOG.md` | `.canon/config.json` entry: shipped slice, field-name reconciliation |
| `docs/codebase-map.md` | New module; qa.md Docs Freshness line |
| `docs/patterns.md` | QA-done widening references |
| `dist/cli/index.js` | Rebuilt via `npm run build` |
| `dist/orchestrator/run-task.js` | Rebuilt via `npm run build` |
| `tests/docs-freshness.test.ts` | New: resolver and loader tables (AC-1, AC-2, AC-4 loader half) |
| `tests/run-task-ship.test.ts` | Run-start refusal (AC-3); `--ship` classification (AC-6) |
| `tests/run-task-safety.test.ts` | QA-end and human-review admission tests (AC-4, AC-6, AC-7) |
| `tests/run-task-validation.test.ts` | `buildAffectedFilesAllowlist` / `verifyBaseDrift` / pre-flight tests (AC-6) |
| `tests/run-task-prompts.test.ts` | QA and spec prompt tests (AC-5, AC-8) |
| `tests/run-task-prompts.golden.json` | Regenerated goldens |
| `tests/cli.test.ts` | Doctor check, upgrade preservation, init non-scaffold (AC-9, AC-10) |
| `tests/docs-refs-check.test.ts` | Shipped-markdown fixture without a config (AC-12) |

### Interaction Dependencies

- **Bundles.** One shared branch and diff. The QA prompt set is computed once from the bundle diff. The QA-done timing rule (any member done) is unchanged.
- **Template overrides.** Projects with a `tasks/_templates/spec.md` override keep their old Docs Impact wording. `canon upgrade`'s stale-override nudge already reports that.
- **Goldens.** QA and spec goldens change, regenerated with `UPDATE_GOLDENS=1 npm test`.

### Data Model Changes

New adopter-owned `.canon/config.json` (schema in Decision). No `status.json` change.

### Implementation Notes (non-binding; plan owns these)

- `path.matchesGlob` on Node 24 does not match dot segments with `*`/`**` (verified: `matchesGlob('.github/x', '**')` is false). Options include a small in-repo glob-to-regex matcher with dot matching, or retrying the match against a dot-escaped transform. Pick whichever the AC-1 table pins cheapest.
- The `main()` harness in `tests/run-task-ship.test.ts` imports source directly, so AC-3 does not depend on a fresh `dist/`.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`: the full suite runs clean
- [x] `npm run build`: `dist/` must match a fresh build
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E: N/A, no UI surface

## Docs Impact

- `docs/pipeline-orchestrator.md`: several paragraphs rewritten (in Affected Files).
- `docs/codebase-map.md`: new module, and the qa.md description changes.
- `docs/patterns.md`: QA-done widening references.
- `docs/decisions.md`: likely an entry: "`.canon/config.json` is adopter-owned and fails closed; `protected` replaces the defaults; commit admission is config-only, and the diff only shapes the QA prompt".
- `docs/product-context.md`: unaffected.

## Known Risks

- **Admission regression on a delicate surface.** Five sites move to a new set at once. AC-6 pins admitted and rejected cases per site and keeps each site's timing. Code review should trace each verdict and recovery path (`canon task accept`, `--reroute`, `reset-*`) against the admitted set.
- **Admission is broader than the prompt.** QA may commit an edit to any configured doc, not only the ones it was told about this round. This is the same trust model as today's managed docs, and accepted so that reroutes and re-reviews can't strand legitimate QA edits.
- **A self-widening task.** A task that edits `.canon/config.json` changes its own admitted set, because consumers read the active checkout. The config edit still needs an Affected Files row, so it is visible in the spec and PR. Accepted.
- **Telemetry and task artifacts can't be configured.** An adopter who wants QA to flag, rather than append to, a telemetry file gets a load error. That's deliberate: telemetry has its own unconditional writer and admission rule, and a config overlap would contradict both (spec-review F1). If a real need appears, it's a separate change to the telemetry rules, not to this config.
- **`--ship` checks a different copy.** `--ship` validates the main checkout's config, other forms the worktree's. A task that fixed a malformed config on its branch can still be refused by `--ship` until the main checkout's copy is fixed. That's correct: `--ship` classifies main-checkout dirt with the main-checkout config.
- **Fail-closed can stall recovery.** A malformed config blocks `--ship` and `--reroute` too. The message names the file and the problem, and the fix is a JSON edit. Accepted in exchange for never running with a silently wrong allowlist.
- **Glob semantics drift from adopter intuition.** Dot paths are the known trap (Node's matcher skips them). AC-1 pins dot-path behavior for `**` and `dir/**`. A key like `./api/**` is rejected rather than silently matching nothing.
- **Shipped prose breaking adopter `docs-refs-check`.** A backticked config or example path in canon-owned markdown would fail in every adopter repo without the file, while canon-ai's own check passes because canon-ai has one. AC-12's fixture test is the guard.

## Human Test Plan

1. In a scratch project with no docs config, run a small task through QA. Expected: the QA summary and commit behave as before, and an edit to the canon-shipped pipeline reference doc is refused at the QA-end commit.
2. Add a config mapping an API folder to an API reference doc. Run a task that changes a file in that folder. Expected: QA's instructions name the API reference doc, QA corrects anything stale in it, and the edit commits without an allowlist error.
3. Run a task that doesn't touch the API folder. Expected: QA isn't asked to check the API reference doc.
4. Mark the root agent file as flag-only and map it from "everything". Run a task that changes only a hidden config folder. Expected: the QA summary has a "Docs drift" section covering that file, and the file is unchanged.
5. List the lessons-learned buffer as a flag-only doc, then run any task. Expected: the run stops immediately with a message saying pipeline telemetry files can't be configured.
6. Misspell the config's top-level field and run a task. Expected: the run prints a warning naming the unknown field.
7. Break the config file (for example, delete a closing brace). Run doctor, then run any task, then try to ship one. Expected: doctor fails the docs-freshness line, and each command stops immediately with a message naming the config file and the problem.
8. Run the upgrade command in a project that has a config. Expected: the config is untouched.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, feature (the 5-vs-6 drift is resolved by construction and pinned by AC-1/AC-5)
- [x] (Refactors) — N/A, feature
