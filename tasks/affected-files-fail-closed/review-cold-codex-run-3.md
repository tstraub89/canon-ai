<!-- round=3 reviewed_sha=b11b51abf2c3506f20e282009757883a4d426eec scope=full base=main reason="delicate" -->

The affected-file probe now distinguishes an empty diff from a failed diff, and the callers handle failures conservatively or preserve existing routing precedence. Type-check and lint pass; no actionable regressions were found.