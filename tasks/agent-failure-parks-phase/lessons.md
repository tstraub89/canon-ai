### Park a typed agent failure at one boundary, and reopen bundle members only where no agent runs after routing

*(2026-10-20, source: agent-failure-parks-phase)*

When a failed agent session must stop a run durably, throw a typed error from the wrapper and catch only that type at one loop boundary; rethrow everything else. Returning a failed result instead lets phase post-processing treat truncated stdout as a finished result: a QA phase would salvage `done.md` from partial output. If the park also reopens completed bundle members, that is safe only while no agent session runs after the routing writes; this task's argument depended on that ordering. Before adding an agent call after a verdict or routing write, check whether a park at that point would reopen members that routing already moved on. Keep the bundle partial-completion integration test as the tripwire.
