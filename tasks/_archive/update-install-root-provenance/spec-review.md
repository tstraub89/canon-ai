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

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> - **[blocking][integration]** The amendment says it supersedes the Known Risks “Credential prompts” entry (`spec.md:151`), but that entry remains unchanged in the earlier `Known Risks` section and still states the now-rejected premise that resolution needs the same authentication as npm's `github:` fetch. The combined spec therefore contains contradictory operational guidance. Remove or rewrite that old entry so the authoritative risk describes HTTPS-first/SSH-fallback resolution and the fail-closed behavior when both transports fail.
>
> - **[blocking][coverage]** AC-12 does not require the fallback matrix to run for both resolution paths, even though the amended contract explicitly covers stable tag listing and named-ref resolution alike (`spec.md:155`). A test suite could satisfy AC-12 using only stable resolution while `resolveNamedRef` remains HTTPS-only. Require the HTTPS-success, HTTPS-fails/SSH-succeeds, both-fail, and non-interactive-environment assertions for named-ref resolution as well as stable resolution (or explicitly parameterize AC-12 over both modes), including the downstream target/provenance equivalence in the fallback-success cases.

## Amendment Review

- [ ] **Approved**
- [x] **Approved with nits**
- [ ] **Changes requested**

> Findings:
>
> - **[nit][verification]** AC-12 now covers both stable tag listing and named-ref resolution, and its success/failure cases establish the required fallback outcomes. To make the transport contract harder to satisfy with a high-level fake alone, have the recorder assert that fallback attempts occur in HTTPS-then-SSH order and represent the same logical query (tag listing or refspec) in both the SSH-success and both-fail cases. This is non-blocking because the amended contract and per-path test matrix already identify the required behavior.
