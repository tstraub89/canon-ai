# Implementation Handoff: upgrade-destination-classification

> Author: Codex | Spec: `tasks/upgrade-destination-classification/spec.md` | Plan: `tasks/upgrade-destination-classification/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/cli/commands/upgrade.ts` | Replaced the fail-open boolean dirty check with destination classification (`absent`, `tracked-clean`, `tracked-dirty`, `untracked-existing`, `unverifiable`); added per-class refusal buckets/messages; routed docs-refs config scaffold through the same pending/refusal gate. |
| `tests/cli.test.ts` | Added regression coverage for untracked-existing, git-unverifiable, gitignored-existing, `--force`, `--check` parity, all-or-nothing refusal, per-class messages, README/source wording, and docs-refs config scaffold coverage; repaired non-git overwrite fixtures by committing their pre-upgrade state. |
| `README.md` | Updated the `canon upgrade` command row to describe locally modified, untracked-present, and git-unverifiable refusal classes. |
| `dist/cli/index.js` | Generated bundle update from `npm run build` so the published `canon` bin matches the source change. |

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

`canon upgrade` now classifies every pending destination before writing anything. Tracked-clean and absent paths remain writable, canon-identical files still short-circuit before the git gate, and tracked-dirty / untracked-existing / unverifiable paths refuse as an all-or-nothing set unless `--force` is passed.

The classifier asks git for trackedness before on-disk existence so locally deleted tracked files stay `tracked-dirty`. It uses `git ls-files` plus `git status --porcelain` so gitignored existing files cannot masquerade as tracked-clean. If git cannot answer, existing non-identical destinations classify `unverifiable`, while absent destinations still scaffold.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Added `printUpgradeRefusals()` instead of duplicating message blocks inline in `upgradeCmd()`. | Keeps `--check` and real-run refusal wording identical and lets tests assert the exact production output helper without mutating repo-local source template paths for a source-mode CLI subprocess. | Meets AC-9. |
| Kept `dist/cli/index.js` in the diff even though the spec Affected Files table omitted it. | `package.json` publishes `dist/cli/index.js` as the `canon` bin, `dist/` is tracked, and `npm run build` regenerated this file from the authorized source change. Dropping it would leave the package entrypoint stale. | No AC change; scope called out below. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 untracked sentinel | Met | Inverted the old untracked test; sentinel content remains and path lands in `refusals.untrackedExisting`. |
| AC-2 forced git failure | Met | Non-git existing managed target refuses as `unverifiable` without writing. |
| AC-3 absent target under git failure | Met | Non-git absent target scaffolds without `--force`. |
| AC-3b locally deleted tracked | Met | Existing deletion test still refuses; classifier checks trackedness before existence. |
| AC-4 gitignored-existing | Met | Fixture commits an exact `.gitignore` pattern and asserts porcelain is empty before verifying `untrackedExisting`. |
| AC-5 `--force` overrides refusal classes | Met | Existing tracked-dirty force test plus new untracked-existing and unverifiable force coverage. |
| AC-5b malformed `.gitignore` not force-overridable | Met | Existing malformed block test still asserts both normal and `--force` behavior. |
| AC-6 tracked-clean still writes | Met | Added explicit tracked-clean overwrite test. |
| AC-7 canon-identical without git | Met | Added explicit non-git byte-identical unchanged test. |
| AC-8 `--check` parity | Met | Table-driven parity test covers absent, canon-identical, tracked-clean, tracked-dirty, untracked-existing, and unverifiable. |
| AC-8b mixed pending all-or-nothing | Met | Untracked refusal withholds a tracked-clean target until a subsequent `--force` run writes both. |
| AC-9 per-class refusal messages | Met | `printUpgradeRefusals()` emits distinct tracked-dirty, untracked-existing, and unverifiable remedies; tested directly. |
| AC-10 design-comment replacement | Met | Source test asserts old fail-open phrases are absent and new class names are present. |
| AC-11 README wording | Met | README row updated and tested for untracked / unverifiable / `--force` wording. |
| AC-12 existing suite green and fixture changes accounted | Met | Full `npm test` passes; fixture repairs listed below. |
| AC-13 docs-refs config scaffold source covered | Met | New test refuses untracked non-identical `scripts/docs-refs-config.mjs` as `untrackedExisting`. |

## AC-12 Fixture Repairs

Each repaired test previously used a non-git temp dir with pre-existing non-identical content and was about overwrite/merge behavior, not git-unavailable safety. I added `gitInit()` + `gitAddCommit()` after setup so the destination is explicitly tracked-clean and the original test intent is preserved.

| Test | Reason |
|---|---|
| `runUpgrade: canon-owned skill file fully overwritten` | Existing non-identical file should model tracked-clean overwrite. |
| `runUpgrade: version bumped when .canon/version mismatches installed version` | Version mismatch should model tracked-clean overwrite. |
| `runUpgrade: task template (.canon/templates/spec.md) fully overwritten` | Existing task template should model tracked-clean overwrite. |
| `runUpgrade staleOverrides: differing override under default root is listed` | Canon template change should write before stale override nudge. |
| `runUpgrade staleOverrides: identical override content is suppressed` | Canon template change should write while suppressing identical override nudge. |
| `runUpgrade staleOverrides: --check uses wouldUpgrade and does not write` | Preview should report tracked-clean would-write instead of unverifiable refusal. |
| `runUpgrade staleOverrides: empty when override root is absent` | Canon template change should write with no override root. |
| `runUpgrade staleOverrides: stray files under the override root are ignored` | Canon template change should write while ignoring non-template override files. |
| `runUpgrade staleOverrides: honors CANON_TASKS_DIR_OVERRIDE and ignores the default root` | Canon template change should write while checking the custom override root. |
| `runUpgrade: .gitignore without canon block receives the block via pending queue` | Existing `.gitignore` should be tracked-clean before block insertion. |
| `runUpgrade --check: .gitignore reports wouldUpgrade without writing` | Preview should report tracked-clean `.gitignore` block insertion. |
| `runUpgrade: pre-split docs-refs checker scaffolds config and overwrites checker + .d.ts with a warning` | Checker and `.d.ts` overwrite should model tracked-clean cutover. |
| `runUpgrade: new docs-refs checker with missing config scaffolds config but does not defer` | Checker overwrite should model tracked-clean; missing config remains absent scaffold. |
| `runUpgrade: pre-split checker with config already present is overwritten WITH a warning` | Checker overwrite should model tracked-clean while existing config remains adopter-owned. |
| `runUpgrade: new docs-refs checker with config present upgrades normally and does not scaffold` | Checker overwrite should model tracked-clean while existing config remains adopter-owned. |
| `runUpgrade --check: cutover plans config scaffold without writing` | Preview should report tracked-clean checker overwrite and absent config scaffold. |
| `runUpgrade: header-only sync refreshes telemetry header + preserves rows` | Header-only sync should model tracked-clean overwrite. |
| `runUpgrade --check: header-only sync reports wouldUpgrade without writing` | Preview should report tracked-clean header-only sync. |
| `runUpgrade --check: reports wouldUpgrade without writing` | Preview should report tracked-clean skill overwrite. |

## Edge Cases Considered

- Gitignored managed targets: `git status --porcelain -- <path>` is intentionally empty in the test, proving the classifier is not relying on porcelain alone.
- Git probe errors: non-git directories refuse only existing non-identical destinations; absent destinations still scaffold and byte-identical files still short-circuit unchanged.
- Locally deleted tracked targets: retained tracked-dirty behavior for both normal managed files and docs-refs config scaffold decisions.
- Docs-refs config adopter ownership: tracked-clean existing config content is still left untouched; untracked/non-identical config content now routes through the refusal gate.

## Blockers

- `[scope]` The spec Affected Files table omitted `dist/cli/index.js`. Because `dist/cli/index.js` is tracked and is the published `canon` bin, I kept the `npm run build` output in the diff and Changes table. Reviewer/human should confirm this generated artifact is acceptable for this task scope.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 950 pass, 1 skipped, 0 fail. |
| `npm run build` | Pass | Regenerated `dist/cli/index.js`. |
| `npm run docs-refs-check` | Pass | All refs OK. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/cli/commands/upgrade.ts` | Made dirty git status win before trackedness so staged `git rm` classifies as `tracked-dirty`; switched `ls-files`/`status` parsing to NUL-delimited output; made unmapped destination classes fail closed as `unverifiable`; left dirty-present tracked docs-refs config files adopter-owned instead of queuing/refusing them. |
| `tests/cli.test.ts` | Added regression coverage for staged-deleted managed files and dirty-present tracked `scripts/docs-refs-config.mjs` behavior. |
| `dist/cli/index.js` | Regenerated bundle after the classifier revision. |

### Findings Addressed

- _correctness bug:_ staged deletion (`git rm`) was classified `absent` and silently recreated -> fixed by parsing dirty status first and adding `runUpgrade: staged-deleted tracked managed file is refused without --force`.
- _risk/guardrail:_ classifier `switch` default failed open -> fixed by making `absent` / `tracked-clean` explicit clean cases and routing default to `unverifiable`.
- _spec gap:_ dirty-present tracked `scripts/docs-refs-config.mjs` aborted unrelated upgrades -> resolved by treating present tracked config as adopter-owned unless it is untracked-existing or unverifiable; added regression coverage.
- _optional cleanup/nit:_ porcelain parsing used newline output and `line.slice(3)` -> hardened with `git ls-files -z` and `git status --porcelain=v1 -z`.
- _optional cleanup/nit:_ locally deleted docs-refs config branch looked redundant -> added a comment explaining why it queues the path for shared refusal.

### AC Deltas

- AC-3b remains Met and now covers both unstaged `rm` and staged `git rm` local deletion forms.
- AC-8 parity remains Met with unchanged class expectations.
- AC-13 remains Met for untracked non-identical docs-refs config; tracked dirty-present docs-refs config is now explicitly adopter-owned and left untouched.

### Re-run Validation

| Check | Result | Notes |
|---|---|---|
| `node --test --import tsx tests/cli.test.ts` | Pass | 165 pass, 0 fail. Targeted revision check. |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run build` | Pass | Regenerated `dist/cli/index.js`. |
| `npm run docs-refs-check` | Pass | All refs OK after the Iteration 2 handoff append. |
| `npm test` | Pass | 952 pass, 1 skipped, 0 fail. |
