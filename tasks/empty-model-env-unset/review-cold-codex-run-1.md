<!-- round=1 reviewed_sha=3cb58eeecc453f376ad52f8a588379c57739bde4 scope=full base=main reason="Round 1 (initial review)" -->

The change consistently treats blank or whitespace-only model environment variables as unset, trims non-empty model values, and leaves non-model settings unchanged. The updated tests cover fallback behavior, warnings, and trimmed values; no actionable defects were found.