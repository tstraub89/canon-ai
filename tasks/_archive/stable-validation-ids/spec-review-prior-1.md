# Spec Review: stable-validation-ids

> Reviewer: Codex | Spec: `tasks/stable-validation-ids/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Claimed red-first fixtures fail on the current code for their stated reasons
- [x] Required-ID and informational-label identities can remain in separate key spaces
- [ ] Existing outcome semantics are preserved — see the informational
      `Fail – unrelated` conflict below
- [ ] Every mandated rejection message points to a valid recovery state

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- **Blocking — the Decision incorrectly adds anti-laundering enforcement to
  informational `Fail – unrelated` rows while simultaneously requiring unchanged
  semantics.** Decision item 4 says informational rows remain subject to an existing
  “anti-laundering path,” and item 8/Non-Goals promise all `Fail – unrelated` semantics
  stay unchanged (`spec.md:29`, `33`, `42`). In the current implementation, the
  reference requirement and changed-file anti-laundering checks run only while
  iterating *required* checks (`validation.ts:622-648`). The non-required scan
  explicitly blocks plain `Fail` only when the result is **not** `Fail – unrelated`
  (`validation.ts:658-675`), and the suite pins that contract with “leaves non-required
  Fail – unrelated rows on the accept path” (`run-task-validation.test.ts:3155-3162`).
  A targeted current-code fixture made the informational row cite the task-changed
  `src/app.ts:42`; classification still returned no issues, confirming there is no
  informational anti-laundering path today. Following item 4 literally would change a
  tested Result-state route and violate AC-7/Non-Goals; preserving the test would
  violate item 4. Decide the intended behavior. If this task is semantics-preserving,
  remove the informational anti-laundering claim and add an AC-8 case proving
  informational `Fail – unrelated` remains accepted. If expanding anti-laundering is
  intentional, state that behavior change explicitly, remove the unchanged-semantics
  claims, and add required positive/negative tests and routing/message coverage.

- **Blocking — the mandated blank-label fix offers an impossible `VAL-<n>` recovery.**
  Decision item 5 and AC-21 require the rejection to say “give the informational row a
  non-empty `Check` label or assign it a `VAL-<n>` ID” (`spec.md:30`, `70`). But an
  informational row is, by definition, not a spec-required item and must not receive an
  invented VAL ID (`spec.md:29`, `45`). Assigning a new ID produces the unknown-ID
  defect; reusing a required ID already present in the same table produces the
  duplicate-row defect. Thus one of the two prescribed repairs necessarily causes the
  next gate failure—the exact serial-respawn pattern this task is meant to eliminate.
  Make the handoff-local recovery simply “give the informational row a non-empty stable
  label.” If the row was actually intended to answer a required check, the alternative
  must say to use that check's **existing spec ID** and replace/remove the mistaken row,
  not to assign a new VAL ID.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

(none)

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)
