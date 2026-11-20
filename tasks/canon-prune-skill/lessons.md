### A skill's restated selector drifts from the code that selects; state the general rule, then check each path

*(2026-11-19, source: canon-prune-skill)*

The prune skill's implement-prompt guard listed the content that pitfall selection injects one surface at a time. Each review round found a path the list missed: routing-table rows, the no-H3 prose fallback, Trigger Table targets, then whole-document targets. Each enumerated fix moved the gap instead of closing it. Prevention: when a doc or skill restates what the runtime selects, write the general selector (for example, "every source the code reads for this section"), then check it against each code path in the selector's source, including fallbacks and whole-document targets. Do not add one more named case per round. Canonical example: `buildIndexRows` and the linked-target handling in `src/orchestrator/pitfalls.ts`.

---

### A "never read" rule needs its exceptions named where the skill cites a heading inside that set

*(2026-11-19, source: canon-prune-skill)*

The prune spec said canon-managed files are never read. The skill still told the agent to run the preflight in canon-sweep §"Preconditions" and to take a home from canon-sweep §"Step 2", and both sections sit in that managed set. The contradiction went to review as a correctness bug. Prevention: when a rule says a set is never read or edited and a skill points at a heading in that set, state the exception in the same sentence, name the exact sections, and say which parts of them apply (here, only the three preflight checks). Otherwise the agent either skips the reference or breaks the rule.
