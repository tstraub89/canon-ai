# Spec Review: relocate-rules-to-prompts

> Reviewer: Codex | Spec: `tasks/relocate-rules-to-prompts/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

(none)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

(none)

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- None found.

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> 1. **AC-A2 contradicts the approved Release Rules relocation.** The base spec is a preservation/relocation task: `qa.md` is supposed to receive the existing Release Rules, and AC-6 keeps `AGENTS.md` unchanged. But the amendment now instructs implementation to soften the QA rule so QA "MAY note a *suggested* bump tier" in `qa.md` / `.canon/templates/done.md` (spec.md:277). The current source rule in `AGENTS.md` is stricter: "The QA step proposes a draft changelog *entry* in `done.md` — the entry text only" and "QA does **not** propose, choose, or re-litigate the version number or bump tier" (AGENTS.md:342-343). The fact that `docs/decisions.md` says minor bumps are proposed in `done.md` (docs/decisions.md:136-139) is a real policy tension, but this amendment cannot resolve it by changing the JIT prompt while leaving the canon source untouched. Either keep the relocation faithful by removing the QA/done.md bump-tier proposal, or explicitly scope a policy change that reconciles `AGENTS.md`, `docs/decisions.md`, `qa.md`, and `.canon/templates/done.md` together. As written, the amendment weakens a rule the approved base spec said to relocate unchanged.
>
> 2. **AC-A1's mechanical verification can pass while dropping one listed escalation trigger.** AC-A1 says the spec templates must carry the sensitive-surface categories including "analytics-event changes" (spec.md:276), but its grep verification and AC-11 extension list only `auth`, `billing`, `privacy`, `destructive`, and `schema` (spec.md:276, 291). An implementation could omit analytics-event escalation language and still satisfy the specified grep/test. Add `analytics` (or a more distinctive `analytics-event changes` token) to the required verification for both `spec.md` and `spec-revision.md`; preferably use distinctive tokens or word-boundary checks so `auth` cannot be satisfied accidentally by unrelated words.

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> 1. **AC-A2 leaves `docs/decisions.md` contradicting the new QA/done.md rule.** The revised AC-A2 now correctly requires QA to propose changelog entry text only and removes version / bump-tier proposals from `qa.md` and `.canon/templates/done.md` (spec.md:277, 286-287). But the same AC cites `docs/decisions.md` §"Versioning and release policy" as part of the policy alignment (spec.md:277), and the current decision entry still says **Minor** changes mean "agents propose the bump in `done.md`" (docs/decisions.md:136-139). If implementation only changes the files listed in the amendment table, the final shipped surfaces will disagree: QA/done.md will forbid bump suggestions while the protected release-policy doc says to put them in `done.md`. Add `docs/decisions.md` to the amendment's affected files and update that rule to match the new release-step ownership, or remove the `docs/decisions.md` alignment claim and explicitly explain why that existing policy text remains valid despite QA/done.md no longer carrying a bump proposal.

## Amendment Review

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

> Findings: None.
