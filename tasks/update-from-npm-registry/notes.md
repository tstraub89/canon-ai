# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

- [implement] The real npm registry lookup for an absent package/version exits non-zero but emits a parseable E404 JSON object on stdout; the implementation distinguishes that from network/check failures.
- [implement] The sandbox's default npm cache is not writable because it contains root-owned files; `npm pack --dry-run` passed using `/private/tmp/canon-update-npm-cache`.
- [implement-revision] Git realpath canonicalization matters when asserting the local install cwd on macOS: `/var/folders/...` resolves to `/private/var/folders/...`.
- [implement-revision] Matching npm probe cwd is insufficient for global installs because npm's global command ignores project-local registry configuration; the probe must carry `--global` semantics.
- [implement-reroute] The red-first fixture confirmed npm's default local save behavior would write `^8.2.0`; `--save-exact` is required to preserve the selected release pin.
- [implement-reroute] `npm install --package-lock-only` could not unlink the sandbox's pre-existing `node_modules/.package-lock.json`, but still left the intended root lockfile metadata-only diff.
- [implement-revision] Registry-path provenance tests must assert the complete persisted record, not only file existence, because the stable path is the new behavior and its source/version/SHA pairing is the core AC-4 contract.
