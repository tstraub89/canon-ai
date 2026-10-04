<!-- round=1 reviewed_sha=3958b4c5104f0079190fbf215f4f0edae9c5606c scope=full base=main reason="Round 1 (initial review)" -->

The diff-probe result now distinguishes an empty diff from a failed probe, and the callers either fail closed at review/commit gates or use a conservative full-check prompt. The updated tests cover these paths, and type-checking passes.