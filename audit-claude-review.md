# Independent Claude review

## First pass

I reviewed the source (not the claims), traced every call site that the changed code gates, and checked the four scope items. **No P1 blocking issues.** All four behaviors are implemented soundly:

- **Symlink refusal** runs before any write on both paths, and `initCmd` asserts `.gitignore`/`.canon/version` before `scaffoldTemplates` fires, so a refusal leaves the tree untouched. Parent-segment walking and dangling links are covered (`lstatSync` doesn't follow).
- **Shutdown supervision**: I enumerated every `process.exit()` in `src/orchestrator/**` that could race the grace window. All of them sit downstream of an `await streamProcess(...)` (`claude.ts:192-208`, `codex.ts:115-125`, `codex.ts:203`, phase handlers), so the `isShuttingDown()` gates in `stream.ts:104,121` genuinely close the premature-advance path. `runInteractiveClaude` (`claude.ts:20`) never registers a child, but it also isn't detached, so it's unaffected. The structural "node:* only" guard still holds (`node:timers/promises`). Normal Ctrl-C costs ~50-100ms extra, bounded at 4s — inside `canon stop`'s 10s escalation. `dist/` is rebuilt and contains the new logic.
- **Byte-offset tailing** fixes the real bug (byte offset used as a string index) and the loop bounds, decoder reset, and `fd` lifetime are correct.
- **`stripLineCitation`** is only reached via the whole-backtick-span capture at `docs-refs-check.mjs:626,763`, so `,[ \t]*` is exercised as the tests assume, and the anchoring makes over-stripping implausible.

Findings below.

---

### P2 — `assertNoSymlinkDestinations` rethrows non-ENOENT stat errors, crashing read-only `canon upgrade --check`

`src/lib/scaffold-paths.ts:10-18`

Only `ENOENT` breaks the segment walk; every other errno is rethrown. If a regular file sits where canon expects a directory (e.g. a file named `scripts` or `.canon`), `lstatSync` on the next segment throws `ENOTDIR` and it propagates. `runUpgrade`'s assert is at `src/cli/commands/upgrade.ts:280`, ahead of the `options.check` return at line 499, so `canon upgrade --check` — which writes nothing and today reports its plan fine — now dies with a raw `ENOTDIR` stack (no top-level catch in `src/cli/index.ts:146`). `ENOTDIR` is also semantically the same signal as `ENOENT` here: a regular-file parent means no symlink can exist deeper.

Compounding it, the intentional refusal `throw` at line 12 is *inside* the `try`, so it falls into its own `catch` and only survives because the manufactured `Error` has no `.code`. That's load-bearing on an accident.

Smallest sound fix — hoist the throw out of the `try` and treat `ENOTDIR` like `ENOENT`:

```ts
let entry;
try {
    entry = lstatSync(current);
} catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') break;
    throw error;
}
if (entry.isSymbolicLink()) throw new Error(`Refusing to write ${relativePath}: ...`);
```

---

### P3 — `watch --follow` replays an entire log when the primary task id flips

`src/cli/commands/watch.ts:523,529-533`

`identity` folds `logPath` together with `dev:ino`, and any mismatch resets `position` to `0`. But `primaryLogTaskId` (line 498) returns `task_ids[0]` only while the heartbeat is `found`, and falls back to the watched `taskId` otherwise. On a multi-task run watched by a non-primary id, heartbeat removal at run end flips `logPath` to a different file, and the whole of that log is dumped to stderr in one burst. The old code didn't fully reset on a path switch (it only reset when the new file was smaller), so this is a new failure mode for the same scenario, introduced by making path part of the reset key.

Smallest fix — distinguish "same file, new inode" (rotation: read from 0) from "different file" (newly tracked: start at the end, matching the first-poll rule):

```ts
const pathChanged = tailState.identity != null && !tailState.identity.startsWith(`${logPath}:`);
if (identity !== tailState.identity || stat.size < tailState.position) {
    tailState.position = pathChanged ? stat.size : 0;
    tailState.decoder = new StringDecoder('utf8');
}
```

---

### P3 — the #15 fix lands in `stripLineCitation` but not `isLineCitationTarget`, so compound citations still false-positive in three carriers

`scripts/docs-refs-check.mjs:474-476`, consumed at `:781`, `:801`, `:865`

`isLineCitationTarget` still matches only a *single* trailing citation. A compound citation in the symbol carrier — `` `forwardAndExit()` in `src/orchestrator/signals.ts:79-108, 110-111` `` — isn't recognized, so the guard at line 781 doesn't `continue`, `src` passes the `validDirs` gate, and `existsSync` fails → a bogus "missing file" CI finding. Same for section refs (`:801`) and markdown links (`:865`).

This is pre-existing (the no-space form `:10,20` already fails there), so it is not a regression from this patch — but it is the same defect class #15 names, and leaving the two predicates divergent is what let the gap hide. Smallest fix, which keeps the two functions definitionally consistent:

```js
function isLineCitationTarget(target) {
    return stripLineCitation(target) !== target;
}
```

Note this slightly widens the `#L` branch (`stripLineCitation` allows `L?` on the second number where `isLineCitationTarget` requires `L`) — that widening is in the correct direction, but it's a behavior change worth naming if you take it.

---

### P3 — README documents the symlink refusal for `upgrade` only

`README.md:241` vs `README.md:256`

The error text says "before running canon init or upgrade", and `initCmd`/`scaffoldTemplates` do refuse, but the `canon init` row still reads only "Install canon into the current repo." Add a clause mirroring the upgrade row.

---

**Not findings, checked and deliberately not raised:** the second `assertNoSymlinkDestinations` in `runUpgrade` (line 524) is redundant against line 280 at a single instant, but it re-checks after `classifyDestinations` shells out to git — a defensible TOCTOU narrowing, not dead code. Signaling `-pid` after a leader has been reaped carries a theoretical PID-reuse exposure; that's the hypothetical-race class you asked me to leave alone, and the 4s bound makes it negligible. The gutted comment block in `signals.ts` keeps the rule and drops the war story, which matches how you've asked always-loaded docs to be trimmed.

## Follow-up

All four findings were addressed. Claude reviewed the focused correction set and returned:

All four corrections resolve their findings, and I found no new bug in them. No remaining actionable findings.

**Verification detail:**

- **`src/lib/scaffold-paths.ts`** — the refusal `throw` is now outside the `try`, so it no longer relies on the manufactured `Error` lacking `.code`, and `ENOTDIR` breaks the segment walk alongside `ENOENT`. That is the right equivalence: a regular-file parent means no symlink can exist deeper. `runUpgrade --check` now reaches its plan return. The new `cli.test.ts` case asserts both the plan contents and that nothing was written.

- **`watch.ts` tail** — splitting `path` out of `identity` gives the three distinct behaviors correctly: path switch → EOF (matching the first-poll rule, no replay), same path + inode change → 0 (rotation), same path + `size < position` → 0 (truncation). The early `return` on path switch is inside the `try`, so `fd` still closes via `finally`, and `stat.size - position` is guaranteed positive at the `allocUnsafe` call because the `===` return and the two reset branches cover every other ordering. Decoder is reset on both reset paths. The test's size-padded replacement at poll 3 is what forces the inode branch rather than the size branch — that's a deliberate and correct distinction.

- **`isLineCitationTarget`** — delegating makes the two predicates definitionally consistent, and `stripLineCitation` returns its input unchanged on no-match, so `!==` is a sound "did strip" predicate. The `#L` widening is the one behavior change, in the direction you named.

- **README** — init row now mirrors the upgrade row and matches the error text's "canon init or upgrade".

Checked and not raised: `let entry;` is TS's evolving-`any`, which is legal under `noImplicitAny` and narrows to `Stats` at the `isSymbolicLink()` call — no type-check risk. A target that strips to the empty string (`:12`) is now classified as a citation target; it's unreachable through the backtick-span capture and matches the prior behavior class.
