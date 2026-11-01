# Spec Review: spec-manifest-lint

> Reviewer: spec reviewer | Spec: `tasks/spec-manifest-lint/spec.md`

## Shape Check

no concerns

The new lint addresses verified scope loss at appropriate phase boundaries. The parser correction in AC-6 has a confirmed deterministic mechanism and explicit red-first tests with handoff evidence requirements.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality beyond the explicitly intended fence/comment exclusion

Re-read the current spec and inspected the markdown scanner, manifest/path parsing, phase gate, evidence recovery, plan/implement dispatch, reroute state handling, scope consumers, guidance surfaces, and managed-file registry.

Executed current-source probes confirm the specified regression fixtures: the fenced example returns only `example.ts`; a commented table returns `old.ts` alongside `real.ts`, whether it precedes or follows the live table. The task's own manifest parses to 28 existing paths with no malformed cells.

## Issues Found

### Correctness Issues

None.

### Missing Edge Cases

None.

### Type Safety / Interface Gaps

None.

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase

Remaining verification belongs to implementation: execution of the new gates and bypasses, bundle/worktree coverage, and archive false-positive calibration. No implementation validation results are claimed by this review.

## Amendment Review

- [x] **Changes requested**

### Findings

1. **P2 — Require red-first evidence for the hidden-content fix.** `tasks/spec-manifest-lint/spec.md:254`: AC-A2 addresses the scanner silently accepting an unclosed fence/comment that can hide the entire manifest, but requires only unit tests. It carries neither a red-first regression-test requirement nor the permitted environment-bound escape. The existing diagnosis and red-first requirement cover AC-6's different, well-formed-content cases; the checklist at line 236 still says only AC-6 is a bug fix. This misses the required three-role checkpoint for the amendment's hidden-content defect. Add its confirmed deterministic mechanism to Problem and require AC-A2 tests to fail against the pre-amendment code, pass after the fix, and have both runs recorded by the implementer. Include a valid manifest followed by an unclosed construct so the new missing-manifest check cannot accidentally satisfy the regression test.

   Reviewer confirmation: executed current-source probes of `lintSpecManifest` and `scanSpecManifest`. An unclosed backtick fence or HTML comment on line 1 followed by a canonical Design manifest returns no sections and `issues: []`. Appending either unclosed construct after the same valid manifest retains the section but still returns `issues: []`. Inspection of `visibleMarkdownLines` confirms that open state hides subsequent lines and is discarded on return. These establish the deterministic mechanism; they do not replace the implementer's red-first obligation. AC-A1's deliberate reversal of the no-manifest exemption is a contract change, not the basis of this finding.

2. **P2 — Reconcile the existing human test with the required-manifest rule.** `tasks/spec-manifest-lint/spec.md:222`: Human Test Plan step 4 still instructs the operator to mark a spec with no Affected Files table done and expect it to advance. AC-A1 now requires the identical input to fail. The amendment explicitly supersedes Decision and AC-8 but leaves this verification instruction contradictory, so a conforming implementation fails the written human test. Supersede or revise step 4 to expect rejection and the instruction to add the table under Design.

### Integration and scope

The additional scanner state, lint kinds, foreman guidance, tests, documentation mirrors, and rebuilt bundles fit the declared Affected Files union. The optional amendment table remains compatible with a required Design manifest. No prior settled findings were reopened, and no implementation handoff, code-review artifact, or QA summary was read. Verification here was limited to source inspection and the focused in-memory probes above; no implementation suite results are claimed.

## Amendment Review

- [x] **Approved**

### Findings

no findings

### Shape and integration

Reviewed the current amendment and its integration with the complete spec. Requiring a Design manifest explicitly supersedes the original no-table exemption, while allowing an amendment without a table. The Human Test Plan now expects rejection for a missing manifest. AC-A2 requires red-first tests asserting the specific `unclosed-block` kind and reporting both runs, so rejection solely for a missing manifest cannot satisfy it. The amendment's deterministic explanation and cited probes establish the hidden-content mechanism.

The new issue kinds feed the existing spec gate, evidence recovery, and plan/implement pre-flights through their shared lint function. The foreman contract/example requirement, documentation changes, archive calibration, and generated artifacts have verifiable criteria and fit the combined Affected Files scope.

### Verification and remaining risk

Re-opened the scanner, lint, gate callers, contract constant, foreman template, and pipeline documentation. Fresh current-source probes confirmed that unclosed fences/comments before Design hide its section and return no issues; unclosed constructs after a valid manifest also return no issues. Valid-manifest and table-less-amendment controls return no issues. The current task spec lints cleanly, and all 29 distinct declared paths exist.

Remaining verification is implementation work: red-first/post-fix runs, opening-line diagnostics, gate behavior with the new kinds, rendered foreman assertions, and archive calibration. No implementation suite results are claimed. No handoff, code-review artifact, or QA summary was read.
