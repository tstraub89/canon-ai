# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Live check (gh 2.89.0, this session): gh fills `{owner}` inside the endpoint's query string (`pulls?head={owner}:<branch>`), and `--paginate --slurp` returns an array of pages. `GET repos/{owner}/{repo}` returns the `allow_*` booleans.
- [plan] Interpretation: the draft-PR create sends its JSON payload with `--input <tmpfile>` (the spec allows either form). The commit-subject fallback is `- <subject>` lines, oldest first. If `git log` fails, the PR still opens with an empty body and a warning.
- [plan] Interpretation: the guard passes `--hostname` whenever a URL or a `-R HOST/OWNER/REPO` value names a host, including github.com. This covers the spec's "for a non-default host" and more. An unrecognized `-R` shape fails open.
- [plan] Branch lookup also checks `base.ref` in code, on top of the `base` query param (defense in depth). The test fakes must emit `base.ref`.
