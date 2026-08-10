# Spec Review: worktree-workspace-node-modules-links

> Reviewer: Codex | Spec: `tasks/worktree-workspace-node-modules-links/spec.md`

## Shape Check

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- **Non-blocking nit — distinguish an absent destination from other realpath failures in the logging contract.** Decision line 61 says every unresolvable `<worktree>/<ws>` — explicitly including a missing path — is skipped with a warning, while AC-5 line 112 says an absent workspace directory is skipped with an info-level message. The safe behavior is identical and the surrounding intent makes the resolution clear for plan: preserve the normal absent-directory case as info-level, and reserve the warning required by AC-3 for a dangling symlink, permission failure, or resolved escape.

### Missing Edge Cases

(none)

### Type Safety / Interface Gaps

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings: **Blocking — the amendment leaves the Decision in direct conflict with amended AC-10.** The amendment changes AC-10 to permit one deliberate behavior change for repos without a `workspaces` field: final-segment `node_modules` paths are rejected before directory-prefix staging. However, the Decision still states categorically, “Repos without a `workspaces` field see no behavior change” (`spec.md:72`). That sentence is normative and now contradicts AC-10 (`spec.md:117`) and the amendment’s explanation (`spec.md:200–203`). Qualify the Decision sentence with the same named exception (a concise cross-reference to AC-10 is sufficient) so the integrated spec has one coherent no-workspaces contract. The AC-8 fixture correction is constructible and verifiable: the current safety test creates a real workspace `node_modules` directory with an untracked child and asserts porcelain reports the child path, matching the amended parenthetical. The original bug mechanism remains confirmed in Problem and retains red-first regression ACs, so the 3-role checkpoint adds no separate blocker this round.

## Amendment Review

- [x] **Approved**

> Findings: None. The revised Decision now incorporates AC-10's named no-workspaces exception, so the amendment and the approved behavioral contract agree. AC-8's tracked-parent/untracked-child fixture is constructible under `git status --porcelain=v1 -uall`, and AC-10 distinguishes exact final-segment `node_modules` entries from permitted vendored descendants. The amendment remains spec-only and in scope; the original Problem evidence and red-first ACs continue to satisfy the 3-role checkpoint.
