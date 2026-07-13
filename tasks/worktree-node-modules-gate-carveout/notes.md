# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `commitHumanReviewFiles()` branches on `dirtyEntries.length` before allowlist classification and later dies on `stagePaths.size === 0`; a verified `node_modules` symlink-only dirty tree therefore needs to be treated as clean/irrelevant for those decisions, not just omitted from the unexpected-path list.

[spec] Round-1 revision: rescoped the human-review exemption from "classification-only" to "absent from the commit-relevant dirty set for all dirty-tree decisions" (retry@1220, no-dirty@1249, no-stage die@1279), since commitHumanReviewFiles is only ever reached with --push/--pr so a symlink-only tree should take the clean-tree push/PR path. Confirmed the QA-end/human-review asymmetry is real (QA-end's no-stage is a `return`@838, human-review's is a `die`@1279) and documented it as deliberate. AC-2 now requires a symlink-only-tree `--push` regression test that proceeds to push (no gh stub needed).

[implement] Red-first run of the new node_modules gate tests against pre-fix code failed as expected: QA-end aborted on `?? node_modules` outside the QA-end allowlist, and human-review aborted on `?? node_modules` outside the human_review allowlist before pushing. The package-script form `npm test -- --test-name-pattern "node_modules"` also triggered an unrelated Node/tsx loader attempt to treat `node_modules` as a test target; direct/full test runs were used after implementation.

[implement] Required `npm run build` rewrote `dist/scripts/run-task.js`; the spec's Affected Files table omitted generated dist output even though `docs/architecture.md` requires committed dist to match a fresh build for `scripts/run-task/**` changes.

