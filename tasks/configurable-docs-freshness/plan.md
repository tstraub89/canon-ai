# Implementation Plan: configurable-docs-freshness

> Written by: Claude | Implements: `tasks/configurable-docs-freshness/spec.md`

## Approach

One new module, `src/orchestrator/docs-freshness.ts`, owns everything about the config: it parses and validates `.canon/config.json`, resolves the five sets with a pure function, and matches globs. Every consumer calls it with the checkout it already works in (`cwd` / `activeCwd` / `REPO_ROOT`). Consumers never fall back to defaults on a bad file. One wrapper, `requireDocsFreshnessConfig(root)`, `die()`s with the loader's message, and every consumer goes through it. Nothing is cached across phases, which matches the patterns.md rule against in-memory cross-phase state. Each consumer re-reads the file. That costs one small sync read per site.

`PIPELINE_MANAGED_DOCS` and `PIPELINE_SHARED_DOCS` are deleted. The admitted set replaces them at each Problem-table site, and each site keeps its timing. `buildAffectedFilesAllowlist` stops taking a boolean and takes the doc list itself (`admittedDocs`). The two "unconditional" callers (code_review pre-flight and the full-send scope check) share a new helper, `buildAdmittedAllowlist(taskIds, configRoot)`, so both get one tested wiring.

Glob matching uses a small in-repo matcher, not `path.matchesGlob`, because `**` and `*` must match dot segments (spec Implementation Notes: Node's matcher has no `dot` option). Supported syntax: `**` (any number of segments, including none), `*` (any run of non-`/` characters, leading dot included), `?` (one non-`/` character) and `{a,b}` (one level of alternation, alternatives may contain `*`/`?`). Every other character is literal. That covers the AC-1 table and the common `src/**/*.{ts,tsx}` form, and it is small enough to pin with a table.

### Feasibility check

- **Exists:** confirmed by grep. `PIPELINE_MANAGED_DOCS` / `PIPELINE_SHARED_DOCS` / `PIPELINE_TELEMETRY_FILES` live in `src/orchestrator/worktree.ts:9-24`. `commitQaArtifacts` is at `main.ts:884`, `commitHumanReviewFiles` at `main.ts:1172` (Affected-Files filter at ~1257, QA-done union at ~1270), `classifyAndPreserveSharedDocDirt` at `main.ts:2038` (unexported), the full-send scope check at `main.ts:~3280`, and `main()` at `main.ts:3534`. `buildAffectedFilesAllowlist` / `verifyBaseDrift` are at `validation.ts:1537/1665`. The pre-flight is at `phases/code-review.ts:367`. `getAffectedFiles` (rename-aware three-dot, both sides via `parseNameStatusOutput`) is at `git.ts:451`. Other pieces found: `promptQa` / `promptSpec` / `promptSpecRevision` in `prompts/index.ts`, Mustache `renderTemplate` in `prompts/render.ts`, the doctor Config section at `doctor.ts:713`, and `resolveTaskCwd` at `state.ts:324`.
- **Real path:**
  - QA-end: `checkAndRoute` → `commitQaArtifacts(taskIds, getActiveCwd(taskIds))` (`main.ts:3449`).
  - `--pr` / `--push`: `commitHumanReviewFiles(taskIds, cwd, …)` (`main.ts:2794/2827/2849`) → `verifyBaseDrift(taskIds, base, cwd)`.
  - code_review: `runCodeReviewPhase` → pre-flight with `activeCwd = deps.getActiveCwd`.
  - Full-send: `checkAndRoute` with `cwd = getActiveCwd`.
  - `--ship`: `shipTasks` → `classifyAndPreserveSharedDocDirt()` on `REPO_ROOT`, and only when some task is worktree-mode.
  - QA prompt: `runQaPhase` → `promptQa`.
  - Spec prompts: `runSpecPhase` → `promptSpec` / `promptSpecRevision`.

  No existing code reads any config file today.
- **Callers:**
  - `buildAffectedFilesAllowlist` has 3 callers: `validation.ts:1697`, `code-review.ts:367` and `main.ts:3280`. All three are updated.
  - `verifyBaseDrift` has 1 caller (`main.ts:1215`). Its signature is unchanged; it loads the config from its `cwd`.
  - `promptQa` / `promptSpec` / `promptSpecRevision` each have one production caller (`qa.ts`, `spec.ts`). New parameters are optional, so the golden tests keep compiling.
  - `buildHumanReviewStagePaths(taskIds, affectedManagedDocs, …)` has an unchanged signature. Callers pass the new set, and the tests at `run-task-safety.test.ts:2757/2791` pass `new Set(DEFAULT_PROTECTED_DOCS)` instead.
- **Tests that can fail:**
  - Mapped-doc admission fails today: a dirty `docs/api.md` with a config mapping it dies at QA-end with "outside the QA-end allowlist".
  - `docs/pipeline-orchestrator.md` rejection under defaults fails today, because it is in `PIPELINE_MANAGED_DOCS`.
  - The pre-flight reroute regression feeds a diff containing only `docs/api.md` (mapped from `api/**`), with no `api/` path. Today that doc is out of scope.
  - Run-start refusal: today a malformed file is ignored and the run proceeds, writing a heartbeat for `--reroute`/plain runs.
  - QA prompt tests fail today because the bullet is literal.
  - The AC-12 fixture test goes red when a backticked `.canon/config.json` is added to a shipped file. Verified empirically: a fixture built from a copy of `templates/`, plus `src/lib/canon-owned.ts` and `.claude/settings.json`, gives `runChecks(...) → []`. Appending a backticked `.canon/config.json` to the fixture's `.canon/README.md` gives a `missing file` finding.
- **Predicates:**
  - `protected: []` gives an empty protected set. The admitted set is then only mapped docs, and the prompt says nothing is configured for correction.
  - Absent `docs_freshness` and `{}` give defaults.
  - A diff of `[]` gives the protected set only. A diff probe failure (`null`) gives the protected set only, plus a warning.
  - A diff of only `tasks/**` or telemetry paths matches nothing after filtering.
  - A flag-only doc that is in neither the protected set nor the mapped docs is in the configured set only.
  - `paths: {}` means the spec prompt shows no map block.
  - A JSON `null` top level, an array top level, or a non-object `docs_freshness` are each malformed.
  - Unknown keys produce warnings only.
  - QA-done timing uses the existing `some(qa.status === 'done')` / per-task loops unchanged.
- **Scope:** every file below is in the spec's Affected Files except one carve-out: `tests/run-task-code-review.test.ts` (the pre-flight harness) is **not** listed, so this plan doesn't edit it. The pre-flight wiring is covered through the shared `buildAdmittedAllowlist` helper in `tests/run-task-validation.test.ts`. The existing code-review tests pass unchanged, because their temp `activeCwd` has no config and the defaults include every doc they use (`docs/codebase-map.md` etc.). Recorded in notes.md.
- **Async/stateful:** no async changes. The run-start check is read-only and runs before any heartbeat, `.canon-pid`, status write, reroute or ship action. A detached child re-enters `main()` and re-validates. That is harmless, and the child's warning goes to its log, so each process warns once.

### Spec observations (recorded in notes.md)

1. `docs/decisions.md` is in Docs Impact ("likely an entry") but not in Affected Files, so this plan doesn't edit it. QA can add the entry: under canon-ai's own config, `docs/decisions.md` is protected and admitted at QA-end.
2. AC-4's `--ship` consumer test needs to reach `classifyAndPreserveSharedDocDirt` past the run-start check, which reads the same file and prints the same message. Step 5 exports that function (main.ts is in scope) and tests it directly in a subprocess.
3. A doc path written as `./docs/x.md` is not in the spec's exhaustive malformed list, and it would never equal a porcelain path. The plan keeps the spec's list as written. Open question for the human: should a leading `./` on doc paths be rejected too?

## Steps

### Step 1: `src/orchestrator/docs-freshness.ts` (new)

Imports: `node:fs`, `node:path`, `die` from `./cli.js`, and `PIPELINE_TELEMETRY_FILES` from `./worktree.js`. Doctor already pulls `state.js`/`env.js` through `run-context.js`, so importing `worktree.js` adds no new load-time side effect for `canon doctor`.

```ts
export const DOCS_FRESHNESS_CONFIG_PATH = '.canon/config.json';
export const DEFAULT_PROTECTED_DOCS = [
    'docs/architecture.md', 'docs/codebase-map.md', 'docs/patterns.md',
    'docs/product-context.md', 'docs/decisions.md',
] as const;   // order = today's qa.md order

export interface DocsFreshnessConfig {      // normalized; absent lists stay undefined
    protected?: readonly string[];
    paths?: Readonly<Record<string, readonly string[]>>;
    flagOnly?: readonly string[];
}
export type DocsFreshnessLoad =
    | { ok: true; source: 'defaults' | 'file'; config: DocsFreshnessConfig | null; unknownKeys: string[] }
    | { ok: false; message: string };

export function parseDocsFreshnessConfig(raw: string): DocsFreshnessLoad   // pure; tests drive this
export function loadDocsFreshnessConfig(root: string): DocsFreshnessLoad   // ENOENT → {ok, source:'defaults', config:null, unknownKeys:[]}
export function requireDocsFreshnessConfig(root: string): DocsFreshnessConfig | null  // !ok → die(message); never warns
export function matchesDocsGlob(pattern: string, filePath: string): boolean
export interface DocsFreshnessSets {
    protected: string[]; flagOnly: string[]; admitted: string[]; configured: string[];
    promptEditable: string[]; promptFlagged: string[]; unevaluatedMappedDocs: string[];
}
export function resolveDocsFreshness(config: DocsFreshnessConfig | null, diff: readonly string[] | null): DocsFreshnessSets
export function formatUnknownKeysWarning(unknownKeys: readonly string[]): string
```

**Loader / validator.** `parseDocsFreshnessConfig` produces one distinct message per AC-2 form. Every message starts with `.canon/config.json is invalid: ` and ends with ` Fix the file (or delete it to use canon's defaults), then re-run.`. Messages name the offending key or path:

- `JSON.parse` throws → `not valid JSON (<err.message>).`
- Top level is `null`, an array, or not an object → `the top level must be a JSON object.`
- `docs_freshness` present but not a plain object → `"docs_freshness" must be an object.`
- `protected` / `flag_only` not an array, or any entry not a non-empty string → `"docs_freshness.protected" must be an array of non-empty strings.` (same shape for `flag_only`)
- `paths` not a plain object → `"docs_freshness.paths" must be an object mapping globs to arrays of doc paths.`. A value not an array of non-empty strings → `"docs_freshness.paths["<key>"]" must be an array of non-empty strings.`
- Doc path (any list) absolute (`path.posix.isAbsolute || path.win32.isAbsolute`) or with a `..` segment (`p.split(/[\\/]/).includes('..')`) → `doc path "<p>" in docs_freshness.<list> must be repo-relative with no ".." segment.`
- Doc path containing any of `* ? [ ] { }` → `doc path "<p>" in docs_freshness.<list> must not contain glob characters.`
- `paths` key empty, starting with `/` or `./`, or with a `..` segment → `paths key "<k>" must be a non-empty repo-relative glob that does not start with "/" or "./" and has no ".." segment.`
- Doc path in `PIPELINE_TELEMETRY_FILES`, or equal to `tasks` or under `tasks/` → `doc path "<p>" in docs_freshness.<list> is a pipeline telemetry file or task artifact; pipeline telemetry files and tasks/ paths can't be configured.`

  This message must contain the phrase "telemetry files … can't be configured" (Human Test Plan 5).

`<list>` is `protected`, `flag_only` or `paths["<key>"]`. Check order is shape errors first, then key checks, then per-doc checks. The telemetry and `tasks/` rule applies to all three lists.

Unknown keys: top-level keys other than `docs_freshness` are reported as the bare key. Keys inside `docs_freshness` other than `protected`, `paths` and `flag_only` are reported as `docs_freshness.<key>`. `{}`, `{"docs_freshness": {}}` and unknown-keys-only all load as `ok: true` with defaults semantics. `config` is `null` when `docs_freshness` is absent, or a `DocsFreshnessConfig` with all lists undefined. A read error other than `ENOENT` (`EISDIR`, `EACCES`) → `ok: false` with `could not be read (<code>).`

`formatUnknownKeysWarning(keys)` → `.canon/config.json: unknown key(s) ignored: <k1>, <k2>. Check for a misspelled field (for example docs_freshness).`

**Glob matcher.** `matchesDocsGlob` compiles the pattern to an anchored RegExp (cache in a `Map<string, RegExp>`; it is pure). Split on `/`. A segment that is exactly `**` becomes:

- `.*` when it is the whole pattern;
- `(?:.*/)?` when followed by more segments (leading or middle);
- `/.*` appended to the previous segment when it is last (`api/**` → `^api/.*$`, so `apix/y` does not match).

Within other segments, `*` (and a `**` embedded in a segment) → `[^/]*`, `?` → `[^/]`, `{a,b}` → `(?:a|b)` with each alternative converted the same way, and an unbalanced `{` is literal. Everything else is regex-escaped. No dot special-casing, so dot segments match.

**Resolver.** All lists are deduped with insertion order kept.

- `protected = config?.protected ?? DEFAULT_PROTECTED_DOCS`
- `mapped` = every `paths` value in key order
- `flagOnly = config?.flagOnly ?? []`
- `admitted = (protected ∪ mapped) − flagOnly`
- `configured = protected ∪ mapped ∪ flagOnly`
- Diff filtering drops `tasks` / `tasks/**` and `PIPELINE_TELEMETRY_FILES` entries.
- When `diff === null`: `promptSet = protected` and `unevaluatedMappedDocs = mapped − protected`. Otherwise `promptSet = protected ∪ docs of every key that matches at least one filtered path`, and `unevaluatedMappedDocs = []`.
- `promptEditable = promptSet − flagOnly`, and `promptFlagged = promptSet ∩ flagOnly`.

`docs/pipeline-orchestrator.md` is never a default.

### Step 2: Delete the managed-doc constants

Files: `src/orchestrator/worktree.ts`

Delete `PIPELINE_MANAGED_DOCS` and `PIPELINE_SHARED_DOCS`, and keep `PIPELINE_TELEMETRY_FILES`. The compiler then shows every remaining reference. Update the `main.ts:65` re-export block only if it touches these names (it re-exports telemetry only).

### Step 3: Admission in `validation.ts`

Files: `src/orchestrator/validation.ts`

- Change `buildAffectedFilesAllowlist(taskIds, options: { admittedDocs: readonly string[] })`. Callers pass `[]` where they passed `admitManagedDocs: false`. Drop the `PIPELINE_MANAGED_DOCS` import.
- Add an exported helper used by both unconditional callers:
  ```ts
  export function buildAdmittedAllowlist(taskIds: readonly string[], configRoot: string): AffectedFilesAllowlist {
      const sets = resolveDocsFreshness(requireDocsFreshnessConfig(configRoot), null);
      return buildAffectedFilesAllowlist(taskIds, { admittedDocs: sets.admitted });
  }
  ```
- `verifyBaseDrift(taskIds, baseBranch, cwd)`: call `requireDocsFreshnessConfig(cwd)` **first**, before the fetch, so that a malformed config fails closed even offline. Keep the existing per-task `qa.status === 'done'` loop and pass `admittedDocs: anyQaDone ? sets.admitted : []`. A flag-only doc listed in Affected Files is already admitted by the Affected-Files loop, which is the required behavior.
- `SharedDocClass` and the `classify*FromData` helpers keep their shape; the configured set is supplied by the caller in Step 5. No change is needed beyond the doc-comment if one names managed docs.

### Step 4: Pre-flight and full-send scope check

Files: `src/orchestrator/phases/code-review.ts`, `src/orchestrator/main.ts`

- `code-review.ts:367`: `const allowlist = buildAdmittedAllowlist(taskIds, activeCwd);` (`activeCwd` comes from `deps.getActiveCwd`, which tests already stub to a temp dir).
- `main.ts:~3280` full-send block: `splitValidation.buildAdmittedAllowlist(taskIds, cwd)`. Same placement, still inside the `affected.ok` branch, so verdict routing (`spec_gap` / `isFullSendScopeCheckExempt`) is untouched.

### Step 5: Commit sites and `--ship` classification in `main.ts`

Files: `src/orchestrator/main.ts`

- **`commitQaArtifacts(taskIds, cwd)`:** first line `const docSets = resolveDocsFreshness(requireDocsFreshnessConfig(cwd), null);` and `const admittedDocs = new Set(docSets.admitted);`. That replaces `affectedManagedDocs` everywhere in the function (allowlist, stage paths, staged-before check). The abort message becomes:
  `The allowlist is: tasks/<id>/, PIPELINE_TELEMETRY_FILES, and the admitted docs (the protected docs plus any docs mapped in .canon/config.json, minus flag-only docs).`
- **`commitHumanReviewFiles(taskIds, cwd, createPR)`:** load at the **top**, before `verifyBaseDivergence`, so the run fails before any fetch or push.
  - `admitted = new Set(sets.admitted)`, `flagOnly = new Set(sets.flagOnly)`.
  - In the Affected-Files loop, replace the `PIPELINE_MANAGED_DOCS.includes(filePath)` branch with `admitted.has(filePath) || flagOnly.has(filePath)`. Rename the local to `affectedDocs`.
  - QA-done union: `for (const doc of sets.admitted) affectedDocs.add(doc);`. The `flagOnly` docs are not unioned, so a flag-only doc is admitted only through Affected Files.
  - The advisory warning (`main.ts:~1360`) becomes `WARNING: ${relPath} has uncommitted edits and is a configured doc — run …`.
  - Allowlist abort text: `The allowlist is: tasks/<id>/, PIPELINE_TELEMETRY_FILES, protected, mapped, or flag-only docs listed\nin your spec's '### Affected Files' table (directory-form entries like 'dist/' match subpaths),\nand all admitted docs (protected plus mapped, minus flag-only) once qa.status = done (QA's Docs Freshness auto-allowlist).` Keep the remaining lines ("If this is a managed doc…" becomes "If this is a configured doc…").
  - `die('Human review commit aborted: no dirty task artifacts, telemetry, or managed docs to commit.')` → "…or configured docs…".
- **`classifyAndPreserveSharedDocDirt()`:** export it. First line `const configured = resolveDocsFreshness(requireDocsFreshnessConfig(REPO_ROOT), null).configured;` and `const sharedDocs = [...PIPELINE_TELEMETRY_FILES, ...configured];`. Use `sharedDocs` for the `git status --` pathspec and the dirty filter. `docClass` = `configured.includes(relPath) ? 'managed' : 'telemetry'`. The two lists are disjoint by the loader rule.
- Update the `isPipelineOwnedPath` doc-comment (`main.ts:322`) if it names managed docs. It doesn't need to; leave it unless a stale constant name appears.

### Step 6: Run-start validation in `main()`

Files: `src/orchestrator/main.ts`

Insert right after `checkDeps(cliArgs.taskIds, skipAgentDeps);` and before `earlyHeartbeatTaskIds` / `guardConcurrentRun`. That position precedes every heartbeat, `.canon-pid`, status write (`refreshCanonSnapshotsAtPaths`, `enableFullSend`), `--dry-run`, `--ship` and `--reroute`:

```ts
validateDocsFreshnessAtRunStart(cliArgs.taskIds, cliArgs.ship);

function validateDocsFreshnessAtRunStart(taskIds: string[], ship: boolean): void {
    const root = ship || taskIds.length === 0 ? REPO_ROOT : splitState.resolveTaskCwd(taskIds[0]);
    const loaded = loadDocsFreshnessConfig(root);
    if (!loaded.ok) die(loaded.message);
    if (loaded.unknownKeys.length > 0) warn(formatUnknownKeysWarning(loaded.unknownKeys));
}
```

`resolveTaskCwd` already returns "the task worktree if it exists, otherwise `REPO_ROOT`" (content-based scan, `state.ts:324`). A bundle shares the leader's worktree, so `taskIds[0]` is correct. `--ship` always reads `REPO_ROOT`.

### Step 7: QA prompt

Files: `src/orchestrator/phases/qa.ts`, `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/qa.md`

- `prompts/index.ts`:
  ```ts
  export type QaDocsFreshnessPrompt = { editable: readonly string[]; flagged: readonly string[] };
  export function promptQa(state, prTemplate?: string | null,
      docs: QaDocsFreshnessPrompt = { editable: DEFAULT_PROTECTED_DOCS, flagged: [] }): string
  ```
  Add view fields `docsEditable: docs.editable.map(d => `\`${d}\``).join(', ')` and `docsFlagged` (same format). Use empty strings for empty lists, so Mustache sections are falsy.
- `qa.md`: replace the Docs freshness bullet. Keep the literal `**Docs freshness — Two-checkpoint**` (the AC-11 relocation test greps `Two-checkpoint`), and keep no doc path literals in the bullet:
  ```
  - **Docs freshness — Two-checkpoint**: {{#docsEditable}}scan these docs ({{{docsEditable}}}) for references that {{docsScope}} *contradicts* — a renamed symbol, a moved file, a behavior this task changed — and correct those stale references. That is the only edit QA makes to permanent docs.{{/docsEditable}}{{^docsEditable}}no docs are configured for correction in this project, so QA makes no edits to permanent docs under this step.{{/docsEditable}} Do not add new lessons, pitfalls, or decisions here, and do not promote buffer entries — promotion is the human sweep, not Docs freshness.
  {{#docsFlagged}}
  - **Docs drift (flag only)**: also check {{{docsFlagged}}} for statements {{docsScope}} makes stale. Do **not** edit these docs. Report each stale statement in a `## Docs drift` section of done.md (doc, the stale statement, and what is now true). Omit the section if nothing is stale.
  {{/docsFlagged}}
  ```
  The flagged instruction must appear **only** in that block. AC-5 asserts that a matched flag-only doc appears only under the drift instruction.
- `phases/qa.ts`: add an exported, injectable resolver and use it:
  ```ts
  export type QaDocsDeps = { getBaseBranch: typeof getBaseBranch; getAffectedFiles: typeof getAffectedFiles };
  export function resolveQaDocsFreshness(taskIds: string[], activeCwd: string,
      deps: QaDocsDeps = { getBaseBranch, getAffectedFiles }): QaDocsFreshnessPrompt {
      const config = requireDocsFreshnessConfig(activeCwd);
      const base = deps.getBaseBranch(taskIds);
      const affected = deps.getAffectedFiles(base, activeCwd);
      const sets = resolveDocsFreshness(config, affected.ok ? affected.files : null);
      if (!affected.ok) warn(`Docs freshness: could not compute the task diff vs ${base} (${affected.stderr || 'unknown error'}); the QA prompt lists protected docs only. Mapped docs not evaluated: ${sets.unevaluatedMappedDocs.join(', ') || 'none'}.`);
      return { editable: sets.promptEditable, flagged: sets.promptFlagged };
  }
  ```
  In `runQaPhase`, compute `activeCwd` before the call (it already does), then call `promptQa(state, resolvedPrTemplate, resolveQaDocsFreshness(taskIds, activeCwd))`. Bundles share one cwd and base, so the bundle diff is computed once.

### Step 8: Spec and spec-revision prompts

Files: `src/orchestrator/phases/spec.ts`, `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/spec.md`, `src/orchestrator/prompts/templates/spec-revision.md`

- `prompts/index.ts`: `promptSpec(state, docsPaths?: Readonly<Record<string, readonly string[]>>)` and the same for `promptSpecRevision`. Add a shared builder:
  ```ts
  function buildDocsMapBlock(docsPaths): string   // '' when undefined or no keys
  ```
  Its text:
  ```
  **Docs-freshness map** — this project maps code paths to docs QA keeps current:
  - `api/**` → `docs/api-contract.md`, `docs/environment-variables.md`
  For every path you put in Affected Files that matches one of these globs, name the mapped docs in Docs Impact. List a mapped doc in Affected Files only if the implementer should edit it.
  ```
  Pass it as view key `docsMapBlock`.
- Templates: add, on their own lines, `{{#docsMapBlock}}` / `{{{docsMapBlock}}}` / `{{/docsMapBlock}}`. In `spec.md` they go immediately before `**Spec-writing rules of thumb**`; in `spec-revision.md`, before its `**Spec-writing rules of thumb**`. Include one blank line inside the section after the content, so a truthy render keeps paragraph spacing. Standalone section-tag lines are stripped by Mustache. **Verify that the no-map render is byte-identical to the existing `promptSpec` / `promptSpecRevision` goldens before regenerating anything.** If it isn't, adjust the newline placement until it is. AC-8 requires those goldens to stay unchanged.
- `phases/spec.ts`: in both branches, `const docsPaths = requireDocsFreshnessConfig(activeCwd)?.paths;`. Hoist `activeCwd` above the call (it's already computed in each branch). Pass it to the prompt builder.

### Step 9: Help text

Files: `src/cli/index.ts`, `src/orchestrator/cli.ts`

Both `--pr` blocks: replace `managed docs listed in spec.md's "### Affected Files" table.` with wording that keeps the column width, e.g.

```
Auto-commit allow-list: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, and
protected/configured docs listed in spec.md's "### Affected Files" table
(all admitted docs once QA is done). Dirty files outside that set die with
a remediation message.
```

Edit both renderers identically, per the patterns.md "independently-authored duplicates" pitfall.

### Step 10: `canon doctor`

Files: `src/cli/commands/doctor.ts`

Add `export function checkDocsFreshness(cwd: string, listTracked = defaultListTracked): Check` with label `Docs freshness`:

- `loadDocsFreshnessConfig(cwd)` returns `!ok` → `{ status: 'fail', detail: message }`.
- Source `defaults` (no file) → pass, `detail: 'canon defaults (no config file)'`.
- Otherwise collect warnings:
  - each unknown key;
  - each configured doc (`resolveDocsFreshness(config, null).configured`) where `!existsSync(join(cwd, doc))` → `configured doc missing: <doc>`;
  - each `paths` key matching no tracked file → `glob matches no tracked file: <key>`.

  `defaultListTracked(cwd)` = `spawnSync('git', ['ls-files', '-z'], { cwd })`. On failure, add one warning `could not list tracked files to check globs` rather than failing.
- No warnings → pass with `detail: '.canon/config.json: N protected, M mapping(s), K flag-only'`. When `config` is null (file present but no `docs_freshness`), report the default count. The detail must say the defaults are used, e.g. `.canon/config.json (no docs_freshness; canon defaults)`.

Wire it into `configChecks` after `checkRuntimeFilesGitignored(cwd)`. Don't touch `EXPECTED_TEMPLATES`.

### Step 11: Templates, skill, READMEs, docs

Files: `.canon/templates/spec.md`, `.canon/README.md`, `.claude/skills/canon-spec/SKILL.md`, `docs/pipeline-orchestrator.md`, `README.md`, `docs/BACKLOG.md`, `docs/codebase-map.md`, `docs/patterns.md`, then `npm run sync-templates` for the three `templates/` mirrors.

**Shipped-text rule.** It applies to `.canon/templates/spec.md`, `.canon/README.md`, the skill and `docs/pipeline-orchestrator.md`, which are all `CANON_OWNED`. Never backtick a slash path to the config file or to an example doc. Write "the project's docs-freshness config (config.json in the .canon directory)" in prose, or put examples in a fenced block. A bare backticked `config.json` (no slash) is safe, because docs-refs-check skips slash-less tokens outside its valid dirs. Don't name any `src/**` path.

- `.canon/templates/spec.md`:
  - Affected Files blockquote (line 35): "Any protected or mapped doc that you expect QA to touch, or that the implementer should edit, must be listed here. Protected docs default to architecture, codebase-map, decisions, patterns and product-context; the project's docs-freshness config can replace them and map code paths to more docs. Telemetry files … do not need a row."
  - Docs Impact (line 75): "Name any protected doc (by default architecture, codebase-map, decisions, patterns, product-context) or any doc that the project's docs-freshness config maps from a path this task touches, that might go stale if this task ships. This is a heads-up, not a change; the update happens at QA. Use "None" if…"
  - Neither may say "Five protected docs" or list `pipeline-orchestrator`.
- `.canon/README.md`: rewrite the opening as "Files in this directory are managed by canon, except config.json (see below). Do not edit the managed ones directly." Add a `## Project config (config.json)` section saying it is adopter-owned, `canon init` doesn't create it, `canon upgrade` never touches it, and its `docs_freshness` field is described in the canon-ai README. Include the fenced JSON example.
- `.claude/skills/canon-spec/SKILL.md` Phase 1: add a bullet: "If the project has a docs-freshness config (config.json in the .canon directory), read its docs_freshness.paths map. For any path you'll put in Affected Files that matches a glob, name the mapped docs in Docs Impact, and list a mapped doc in Affected Files only if the implementer should edit it."
- `docs/pipeline-orchestrator.md`:
  - QA-end paragraph (331): "…plus any dirty PIPELINE_TELEMETRY_FILES or **admitted docs**…".
  - Allow-list bullets (337): replace the `PIPELINE_MANAGED_DOCS` bullet with an "Admitted docs" bullet. It defines protected (defaults = the five, or the config's `protected`), mapped and flag-only, and defines admitted as `(protected ∪ mapped) − flag_only`, config-only, never diff-dependent. Affected Files admission covers admitted or flag-only docs, and QA-done widening covers the full admitted set. Add one sentence on the QA prompt set (protected, plus docs mapped from globs the task diff touches; flag-only docs are reported in done.md's "Docs drift" section, not edited) and on fail-closed loading.
  - 343 carve-out: "admitted or flag-only docs listed in Affected Files".
  - 347 base-drift: "any admitted doc".
  - 349 pre-flight: "always admitting the admitted docs".
  - 509/511 `--ship`: "Dirty configured docs (protected, mapped, or flag-only) abort…".

  Remove every `PIPELINE_MANAGED_DOCS` token (AC-7 grep covers this file and `templates/`).
- `README.md`: new `### Configuring docs freshness` subsection under "Getting started", after "Customizing task templates". It contains:
  - the fenced schema example from the spec;
  - `protected` replaces the defaults (and how to add docs via `paths` with `"**"`);
  - `paths` glob syntax (`**`, `*`, `?`, `{a,b}`, dot paths match);
  - `flag_only` → the Docs drift section;
  - the file is adopter-owned and fails closed (a malformed file stops runs and doctor fails);
  - telemetry and `tasks/` paths can't be listed.
- `docs/BACKLOG.md` config entry: note that the `docs_freshness` slice shipped (protected / paths / flag_only). Replace the `protected_docs` bullet with "`protected_docs` → shipped as `docs_freshness.protected` (replace semantics) plus `paths` / `flag_only`". Fix "hardcoded as `PIPELINE_SHARED_DOCS`" (now gone). Mark issue #7's `extraProtectedDocs` as covered by `paths` with `"**"`.
- `docs/codebase-map.md`: add a table row `Docs-freshness config | src/orchestrator/docs-freshness.ts | .canon/config.json loader/validator, pure set resolver, dot-aware glob matcher`. Update the line-81 qa.md description to say the Docs Freshness list is rendered from the resolved config. Add one line under "Protected Docs" saying the QA protected set is configurable via the project config and canon-ai's own config keeps `docs/pipeline-orchestrator.md` in it.
- `docs/patterns.md`:
  - line 135: "dirty managed docs" → "dirty admitted docs";
  - line 200 parenthetical: "`docs/` admitted docs (see the docs-freshness config) are auto-allowlisted … once `qa.status === 'done'`".
- Run `npm run sync-templates`, then `npm run sync-templates:check`. The mirrors are `templates/.canon/templates/spec.md`, `templates/.canon/README.md`, `templates/.claude/skills/canon-spec/SKILL.md` and `templates/docs/pipeline-orchestrator.md`. List each in the handoff Changes table.

### Step 12: canon-ai dogfood config

Files: `.canon/config.json` (new)

```json
{
  "docs_freshness": {
    "protected": [
      "docs/architecture.md",
      "docs/codebase-map.md",
      "docs/patterns.md",
      "docs/product-context.md",
      "docs/decisions.md",
      "docs/pipeline-orchestrator.md"
    ]
  }
}
```

This file is not added to `CANON_OWNED`, and the sync script won't mirror it.

### Step 13: Tests

Files: the test files in Affected Files. Use `process.cwd()`, never `REPO_ROOT`, for any read of a task-edited repo file (patterns.md pitfall).

- **`tests/docs-freshness.test.ts`** (new, AC-1, AC-2, AC-4 loader half):
  - Table-driven `resolveDocsFreshness` cases:
    - every AC-1 bullet;
    - `docs/pipeline-orchestrator.md` absent from all sets under defaults;
    - `protected: []`;
    - mapped doc admitted with diff `[]`;
    - match and non-match changing only the prompt sets;
    - `"**"` with only `.github/workflows/ci.yml`, `.claude/skills/x/SKILL.md` and `.env.example`;
    - `api/**` with `api/.internal/x.ts`;
    - `api/**` vs `apix/y.ts` (no match);
    - `tasks/t/spec.md` and `docs/lessons-learned.md` excluded;
    - two globs → one doc, deduped;
    - flag-only that is protected, mapped, and neither;
    - `diff: null` → protected only, plus `unevaluatedMappedDocs`.
  - A `matchesDocsGlob` table that includes `src/**/*.{ts,tsx}`, `docs/*.md` vs `docs/sub/x.md`, and `?`.
  - `parseDocsFreshnessConfig` gets one test per malformed form, each asserting `/\.canon\/config\.json/` plus its distinct key or path. The telemetry rule gets one row each for `protected`, a `paths` value and `flag_only`, plus `tasks/x/spec.md`.
  - `{}`, `{"docs_freshness":{}}` and unknown-only load `ok` with defaults, and unknown keys come back in `unknownKeys`.
  - `loadDocsFreshnessConfig` on a temp dir: absent file → defaults; directory at the path → `ok: false`.
- **`tests/run-task-safety.test.ts`** (AC-4, AC-6, AC-7):
  - Replace the `PIPELINE_MANAGED_DOCS` import and uses with `DEFAULT_PROTECTED_DOCS` (2757/2791). Retitle "auto-allowlists PIPELINE_MANAGED_DOCS once qa.status is done" → "…admitted docs…". Change `assert.match(result.stderr, /PIPELINE_MANAGED_DOCS/)` (5976) to the new wording (`/admitted docs/`). Reword the comments at 5961/6156/6294.
  - `commitQaArtifacts`:
    - real-git, in-process: a config mapping `"src/**": ["docs/api.md"]` with dirty `docs/api.md` → committed, tree clean;
    - real-git, in-process: `protected` listing `docs/pipeline-orchestrator.md` with that file dirty → committed;
    - `runNodeInline` + fake git: defaults with ` M docs/pipeline-orchestrator.md` → dies with the allowlist message;
    - `runNodeInline` + fake git: flag-only `AGENTS.md` dirty → dies;
    - `runNodeInline`: malformed config → non-zero, stderr matches the loader message, and `git.log` has no `commit` line.
  - `commitHumanReviewFiles` via `runHumanReviewCommit` (write config to `harness.dir/.canon/config.json`):
    - mapped doc admitted at QA-done;
    - flag-only doc rejected at QA-done unless `writeAffectedFilesSpec` lists it (then committed);
    - `docs/pipeline-orchestrator.md` rejected under defaults at QA-done and admitted when `protected` lists it;
    - qa `in_progress` + mapped doc not in Affected Files → rejected, which pins the timing;
    - malformed config → loader message, and no `fetch`/`push` in `git.log`.
  - AC-4 QA prompt build: a `runNodeInline` script calling `resolveQaDocsFreshness(['task-a'], dir, { getBaseBranch: () => 'main', getAffectedFiles: () => ({ ok: true, files: [] }) })` with a malformed config → non-zero, loader message.
- **`tests/run-task-validation.test.ts`** (AC-6):
  - Rewrite the 2023 test to `{ admittedDocs: [] }` / `{ admittedDocs: [...DEFAULT_PROTECTED_DOCS] }`.
  - Retitle 2228 ("…auto-allowlists admitted docs").
  - Drop the `PIPELINE_MANAGED_DOCS` import.
  - `verifyBaseDrift` (real-git fixtures, config written into `localDir`, uncommitted is fine because the loader reads disk):
    - mapped doc committed + QA-done → no drift;
    - same + QA pending → drift;
    - flag-only doc committed + QA-done → drift, unless the spec lists it;
    - `docs/pipeline-orchestrator.md` under defaults + QA-done → drift; with `protected` listing it → no drift.
  - `buildAdmittedAllowlist` (pre-flight / full-send path), reroute regression: config `"api/**": ["docs/api.md"]`, spec lists `src/other.ts`, and `verifyBaseDriftFromData(['docs/api.md', 'src/other.ts'], …)` → `[]`. That shows a later round whose diff no longer touches `api/**` still admits the QA-committed doc. Also `docs/pipeline-orchestrator.md` is out of scope under defaults and in scope when protected.
- **`tests/run-task-ship.test.ts`** (AC-3, AC-4 ship half, AC-6 ship):
  - AC-3 via `runCanon(localDir, …)`, with a malformed `.canon/config.json` written into the main checkout:
    - plain run, `--reroute`, `--dry-run` and `--ship` each → non-zero, stderr matches the loader message, `tasks/<id>/status.json` byte-identical (read before and after), and no `.heartbeat.json` or `.canon-pid` in the task dir.
  - `--ship` source pair, using `prepareSharedWorktreeShipFixture` with the worktree env that fixture's existing tests pass:
    - malformed main + valid worktree config → loader message, status byte-identical;
    - valid main + malformed worktree config → `doesNotMatch` loader message.
  - Recommended extra: plain run with valid main + malformed worktree → loader message (pins the non-ship rule).
  - Unknown key: `--dry-run` with `{"docsFreshness":{}}` → exit 0 and stderr names `docsFreshness`.
  - AC-6 ship: `prepareShipFixture` with `initialFiles` including a committed `.canon/config.json` (`"src/**": ["docs/api.md"]`, `flag_only: ["AGENTS.md"]`), plus `docs/api.md` and `AGENTS.md`, then `markTaskWorktree`:
    - dirty `docs/api.md` → abort naming it;
    - dirty `AGENTS.md` → abort;
    - pure-append telemetry with the config present → preserved (mirror the existing preserve test).
  - AC-4 ship: add a small inline runner (copy `runCanon`'s spawn shape) that imports `main.ts` and calls `classifyAndPreserveSharedDocDirt()` with `cwd` = a fixture whose main config is malformed → non-zero, loader message.
- **`tests/run-task-prompts.test.ts`** (AC-5, AC-8):
  - Grep AC: read `src/orchestrator/prompts/templates/qa.md` from `process.cwd()`, find the line containing `Two-checkpoint`, and assert none of the five default paths appears in it.
  - Rendered tests:
    - `promptQa(baseState)` lists exactly the five defaults and no `pipeline-orchestrator`;
    - `resolveQaDocsFreshness` with stubbed deps and a temp config shows a matched mapped doc present and an unmatched one absent;
    - a matched flag-only doc appears only after the `Docs drift` marker and not in the Two-checkpoint line;
    - no flagged docs → no `Docs drift`;
    - `{ editable: [], flagged: [] }` → "no docs are configured for correction";
    - probe failure (`getAffectedFiles` → `{ ok: false, stderr: 'boom' }`) → protected only, and a `console.error` capture (temporarily replace `console.error`) contains `boom` and the mapped doc.
  - Goldens:
    - add `promptSpec_withDocsMap` / `promptSpecRevision_withDocsMap` (pass a map);
    - assert `promptSpec(baseState)` / `promptSpecRevision(specRevisionState)` still equal the existing goldens;
    - regenerate with `UPDATE_GOLDENS=1 npm test`, then diff the golden file. Only the `promptQa*` entries (bullet text) and the two new keys may change.
  - Grep `.canon/templates/spec.md` and `templates/.canon/templates/spec.md` (from `process.cwd()`) for no `Five protected docs` and no `pipeline-orchestrator`. Grep the canon-spec SKILL.md (root and mirror) for the config instruction.
- **`tests/cli.test.ts`** (AC-9, AC-10, AC-11):
  - `checkDocsFreshness` on temp dirs:
    - absent → pass + `/canon defaults/`;
    - valid → pass + counts;
    - malformed → fail;
    - unknown key → warn;
    - missing configured doc → warn;
    - glob matching no tracked file → warn (`git init` + commit one file, or inject `listTracked`).
  - `checkDocsFreshness(process.cwd())` → pass (AC-11).
  - AC-10:
    - `CANON_OWNED` excludes `.canon/config.json`;
    - `fs.existsSync(path.join(process.cwd(), 'templates/.canon/config.json'))` is false;
    - `EXPECTED_TEMPLATES` has no `config.json`;
    - `runUpgrade(projectDir, pkgDir)` with a customized `.canon/config.json` leaves it byte-identical, with no refusal mentioning it (follow the existing `runUpgrade` fixture helpers);
    - running init (follow the existing init test shape) doesn't create `.canon/config.json`.
- **`tests/docs-refs-check.test.ts`** (AC-12): `makeTempRepo` fixture that:
  - copies `path.join(process.cwd(), 'templates')` recursively into the root;
  - copies `src/lib/canon-owned.ts` to `src/lib/canon-owned.ts`, so the scanner includes shipped `.claude/**` / `.canon/**` markdown;
  - writes `.claude/settings.json` `{}` plus empty `AGENTS.md` / `CLAUDE.md` / `package.json`, which are adopter-owned files canon expects;
  - has no `.canon/config.json`.

  Assert `runChecks(root, { adopterConfig: null })` deep-equals `[]`. The baseline was verified clean on the current tree once `.claude/settings.json` exists.

### Step 14: Build and validate

`npm run build` (rebuilds `dist/cli/index.js` and `dist/orchestrator/run-task.js`), then:

- `npm run type-check`
- `npm run lint`
- `npm test`
- `npm run docs-refs-check`
- `npm run sync-templates:check`
- `grep -rn 'PIPELINE_MANAGED_DOCS' src/ tests/ docs/pipeline-orchestrator.md templates/` (must be empty)
- `grep -rn 'PIPELINE_SHARED_DOCS' src/ tests/` (must be empty)

## Testing Plan

- **Unit**: resolver, glob and loader tables (`tests/docs-freshness.test.ts`); doctor check; prompt rendering and goldens; `buildAffectedFilesAllowlist` / `buildAdmittedAllowlist` / `verifyBaseDrift`.
- **Integration (subprocess)**: run-start refusal across plain, `--reroute`, `--dry-run` and `--ship` via the `main()` harness. Mid-run fail-closed checks for QA prompt build, QA-end commit, the human-review commit and `--ship` classification. Admission at each commit site with real and fake git.
- **E2E**: N/A (no UI).
- **Manual**: Human Test Plan 1–8 in the spec. Run `canon doctor` in canon-ai and confirm the Docs freshness line passes.

## Rollback Plan

Revert the PR. No `status.json` or data migration. Adopters who created a config file keep it, and older canon ignores it (it never read the file). canon-ai's own `.canon/config.json` can stay or be deleted. A revert restores `docs/pipeline-orchestrator.md` to the managed set, which is the pre-change behavior.
