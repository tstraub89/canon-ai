# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Node 24.15 `fs.globSync('packages/**')` traverses ordinary nested directories and `node_modules`, whereas an executed `npm pkg get name --workspaces` fixture selected only package directories and excluded the installed dependency. The same npm command accepted a `../outside` workspace and `globSync` returned the escaping relative path, so a repo-relative workspace-to-worktree mapping needs both npm-package filtering and an explicit containment rule.

[spec] Reproduced both spec_review findings independently on Node 24.15.0 and folded the fixture table into Problem. Extra datum the review did not have: `fs.globSync`'s `exclude` callback is invoked with a *mix* of basenames and repo-relative paths (`'node_modules'` and `'packages/a/node_modules'` both appear), so `exclude` is safe only as a traversal-pruning optimization — the `node_modules`-segment rejection has to be a post-filter on results. Contract is now a five-rule "eligible workspace directory" definition in Decision (declared / directory / has package.json / no node_modules segment / contained in REPO_ROOT via lexical `..` rejection *and* realpath containment), with containment inside the resolver so neither consumer can bypass it. Deliberate divergence from npm: canon does not require the workspace manifest to declare a `name` (npm hard-errors on that, so the sets coincide in any installable repo).

[spec_review] Source-root containment does not prove destination containment when an existing task branch represents an otherwise eligible workspace path as an out-of-worktree symlink. A temp fixture confirmed that joining `<worktree>/<ws>/node_modules` and applying the specified missing-entry `symlinkSync` creates `node_modules` in the external target. Separately, npm 11.12.1 successfully installed a fixture whose workspace manifest had no `name`, so the revised spec's claimed npm hard-error is inaccurate but does not change the intended no-parse resolver rule.

[spec] Round 2: reproduced both findings independently before revising. (1) npm 11.12.1 `pkg get name --workspaces` on a `{"version":"1.0.0"}`-only manifest exits 0 returning `{"a": {}}` — npm keys the workspace by *directory basename*, so its selector is "directory containing a package.json", i.e. exactly rule 3. The correction strengthens the no-parse rule instead of making it a divergence; the false hard-error claim is gone from Non-Goals and Known Risks. (2) Destination escape reproduced: `existsSync(<wt>/<ws>)` follows the symlink → child classifies `missing` → `symlinkSync` lands in the outside tree. New rule + AC-3.

[spec] Extra datum neither review round had, and it changes what AC-3 can demand: `git status --porcelain=v1 -uall` never descends through a symlinked directory — a fixture with `packages/a -> <outside>` reports the single entry `packages/a` when untracked and nothing once committed. So porcelain can never emit `<ws>/node_modules` in the escaping state, and a git-fixture test for the *gate* half of destination containment would be vacuous by construction. AC-3 mandates a direct predicate call with a synthesized `PorcelainEntry` for that half and states why. Guard against a future round asking for the git fixture anyway.

[spec] Containment is now one helper with three call sites (rule 5 source, linker destination, gate destination) rather than per-consumer logic — divergence between consumers was already a listed risk, and the round-1 bug was precisely a containment check that existed on one side only. Segment-wise comparison is pinned by a `<parent>/wt` vs `<parent>/wt-evil` case, mirroring the existing `/repo` vs `/repo-evil` rule.

[spec] Skip-vs-abort asymmetry is deliberate and now stated: linker skips a non-contained destination (fail closed = write nothing), gate marks it non-exempt (fail closed = don't wave through). Recorded in Known Risks so review doesn't read it as an inconsistency.

[spec_review] The workspace-level gate exemption also needs a no-worktree boundary. `getActiveCwd()` returns `REPO_ROOT` for `worktree: false`, making the proposed candidate and expected workspace paths identical; the current probe was executed with a repo-local `node_modules` symlink pointing to an arbitrary outside directory and returned `verified-symlink` because it compared the entry's realpath to itself. That behavior is pre-existing for the root entry, but widening it would newly exempt adopter-created nested workspace symlinks that canon never created.

[implement] The guard-specific red runs reproduced both delicate failures against the actual new paths: omitting destination containment added `node_modules` beside an outside sentinel, and omitting the active-worktree comparison let an adopter-created workspace symlink pass the QA gate with exit 0. Restoring the guards made both targeted tests green; the fresh build touched only `dist/scripts/run-task.js`, not `dist/cli/index.js`.

[implement-revision] A directory-form Affected Files entry is a second staging authority, not only an allowlist predicate: filtering a verified workspace link out of `dirtyEntries` is insufficient if a later `git add -A -- <prefix>` can sweep it back in. Stage the admitted dirty descendants individually and reject every path containing a `node_modules` segment at both decisions.

[implement-revision] Repair-on-rerun makes existing worktrees an active verification path. Tests that advertise an existing worktree through fake `git worktree list` output must create the directory too; the old placeholder passed only because `ensureWorktree()` returned before touching it.

[implement-revision] Directory-form Affected Files must remain a directory pathspec: porcelain v1 path strings are presentation data (C-quoted and rename-expanded), not safe `git add` arguments. Preserve the prefix and append literal exclusion pathspecs only for canonical eligible workspace `node_modules` destinations.

[implement-revision] Partial-link recovery needs a missing-only mode, not replay of initial setup. On reuse, verify that the canonical task path is the branch's registered worktree, repair only absent workspace links, suppress repeated resolver warnings, and leave existing root/workspace/`.env*` entries plus foreign worktrees untouched.

[implement-revision] Git path comparison must decode both full C quoting and quotePath=false selective escapes before NFC normalization. Generating only the default quoted spelling fails for embedded quotes/backslashes and for macOS precomposition.

[implement-revision] Porcelain v1's textual ` -> ` separator is not safe to split without respecting quoting: an untracked path can contain that literal sequence. At an untracked-only safety gate, the `?? ` raw payload is unambiguously one path and should be recovered before applying C-quote decoding; staged/rename entries must remain non-exempt.

[implement-revision] Exemption and protection need different sets: exemption considers only verified untracked canon links, while the safety gate must reject every remaining path whose final segment is `node_modules`. A single normalized path decision should drive both allowlisting and stage-path selection; vendored descendants remain valid because their final segment is not `node_modules`.

[implement-revision] A negative git pathspec is still an explicit path mention. Supplying an exclusion for a gitignored real directory can make `git add` error after partially staging siblings. Build exclusions only from porcelain-visible entries already verified as exempt, never from every theoretically eligible workspace destination.




[implement-reroute] The AC-8 amendment replaces an impossible bare-directory porcelain claim with the fixture shape Git actually emits under `-uall`: an untracked child inside the real `node_modules` directory. The existing test already asserts that exact child entry before exercising the gate, so the reroute required fresh verification and handoff correction but no production or test edit.
