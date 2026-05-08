# Changelog

> Internal changelog for canon-ai's `dev` branch. Not present on `main` (which is the portable template).
> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [0.1.0] — 2026-05-07

### Added

- Post-commit handoff verification at code-review pre-flight: the pipeline now cross-checks the committed diff against every bundle member's handoff Changes table and rejects with a labelled bundle-level finding when they diverge — catching both hallucinated handoff entries and silent edits not mentioned in any handoff. See [`tasks/handoff-verifier/done.md`](tasks/handoff-verifier/done.md) for the full task summary.

## [0.0.1] — 2026-05-07

Initial extraction of canon from its embedded source project. Pipeline built but unverified end-to-end. See [`STATUS.md`](STATUS.md).
