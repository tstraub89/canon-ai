### Infer a flag's value from the flag, not from the token before the current one

*(2026-10-24, source: per-command-help)*

A pre-scan that decides a token is the value of the previous flag by looking one token back will misfire when that previous token is a complete `--flag=value` form, because the equals form consumes nothing after it. Here `--help` placed after `--timeout=5s` or `--base=main` was silently dropped, and only code review caught it. Prevention: when a look-behind attributes a token to an earlier flag, list the self-contained forms (`--flag=value`), test the token right after each one, and test the token after a value that was itself consumed. Write those regression tests against production declarations; a synthetic declaration with a free-text slot can make them pass with the bug still present. Canonical example: the look-behind removed from `preScanArgs()` in `src/lib/cli-args.ts`, with the help-after-value cases in `tests/cli-args.test.ts`.
