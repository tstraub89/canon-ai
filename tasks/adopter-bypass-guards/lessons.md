### Enumerate option forms per tool before writing a command matcher

*(2026-11-01, source: adopter-bypass-guards)*

A regex over a CLI's flags misses valid invocations and over-matches flag values. Two review rounds found bypasses the spec's AC list did not name: `gh -R owner/repo pr merge` (a global repo flag before the subcommand) skipped the merge rule, and Perl switch clusters were read as in-place edits because any `i` matched. Perl value-taking switches (`-M`, `-F`, `-C`, `-D`) consume their own text, so `-Fi` is a read, while `-lpi` and `-0777pi` are in-place. A fix that narrowed one pattern regressed another. Prevention: before writing a matcher for a CLI, read that CLI's option grammar (its `--help` or parser) and enumerate leading global flags, value-taking short flags, and clustered short flags. Add an allow case and a deny case for each form, and check the flag position as well as the subcommand.
