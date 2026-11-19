### A contract sweep must cover relational claims and operator instructions, not just literal defaults

*(date 2026-11-19, source: codex-config-models-effort)*

A sweep that searched only for the changed literals and the named decision entries missed two stale restatements in review: a clause saying M and L were identical on implement, and a generic "make config edits in your worktree" instruction. Both were still true before the change and false after it. Before closing a default or config-location change, also search for comparisons between sizes or tiers ("identical to", "same as"), and for broad how-to lines about where to edit config or settings, in the docs, templates and root guidance. Treat each hit as a restatement to check, not a literal to replace.

### A required field on a shared type does not reach code that builds the call as a string

*(date 2026-11-19, source: codex-config-models-effort)*

Adding a required field to a record type gives no type-check error to a call site that runs inside a subprocess source string, such as a JavaScript snippet passed to `node -e`. The call then writes a row with the field missing. When a type gains a required field, grep the whole tree, including test fixtures that build code as strings, for every call site, and assert on the written output, not only on the type.

### A fixture that makes the precondition malformed hides the behaviour it was meant to test

*(date 2026-11-19, source: codex-config-models-effort)*

A run-level test that wrote malformed JSON into the main checkout to check that a worktree ignores the main checkout's settings stopped passing for the reason it was written for: a new reader failed on the malformed file before the ownership check ran. Keep the malformed-file case in its own test, and give the test under study a file that is valid JSON with invalid settings. Confirm the test fails under a deliberate mutation of the code it guards.
