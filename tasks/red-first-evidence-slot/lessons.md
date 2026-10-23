### Test guidance prose by the clause it must enforce, not by separate keywords

*(2026-10-22, source: red-first-evidence-slot)*

A test that pins a reviewer charter with independent substring matches (one for a heading, one for a term, each found somewhere in the section) keeps passing after the one clause that makes a check closable is deleted, because each keyword still appears elsewhere. This task's review flagged it: a Stage 1 item whose late-evidence clause makes a gap recoverable would have had no test that fails without it. The same test also sliced the template from the first HTML comment, so an added earlier comment would have moved the slice silently. Rule of thumb: when a test pins guidance prose, match the specific clause as one phrase and assert that phrase within the exact section it belongs to, and check that removing the clause turns the test red.
