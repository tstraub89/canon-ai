# Spec Review: update-install-root-provenance

> Reviewer: Codex | Spec: `tasks/update-install-root-provenance/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns. The problem and confirmed mechanisms are correctly scoped to the updater half, and the revised acceptance decomposition is implementable.

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

- **[nit]** The AC-2 fixture sketch names `install/package.json` and `install/node_modules/canon-ai/`, but not `install/.canon/`. The successful post-fix subprocess must write `.canon/provenance.json` under that root. The plan should either seed the `.canon/` directory or make recursive parent creation an explicit writer contract.

- **[nit]** `GIT_TERMINAL_PROMPT=0` is a load-bearing non-interactive behavior in Decision items 6–7 and the implementation notes, but the fake-git acceptance path does not assert the environment value. Have the fake git record or reject the env so a resolver that accidentally permits credential prompts cannot pass the tests.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- **[nit]** The plan should define the resolver result shape explicitly: stable announcement/provenance need both the selected strict final tag (`X.Y.Z`) and the peeled 40-hex commit, while named-ref/SHA paths only need the commit. This is an implementation-level contract, not a blocking spec ambiguity, but making it explicit will keep the injected resolver and command-runner tests aligned.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
