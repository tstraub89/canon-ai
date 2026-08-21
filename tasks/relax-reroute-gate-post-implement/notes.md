# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Generalizing reroute exemptions solely by Amendment presence exposes states the current exempt-task prompts never supported: an unamended `spec_gap` task is sent back to implementation even though the router says implementation cannot resolve it, and an empty-verdict `code_review` task is told to address findings in a `review.md` that may not exist.

[spec_review] `docs/pipeline-orchestrator.md` is canon-managed and syncs to tracked `templates/docs/pipeline-orchestrator.md`; both paths must be declared when the doc changes.

[spec_review] The revised scope found a second independently rendered CLI help surface: `src/orchestrator/cli.ts` prints the old `human_review`-only rule through `parseArgs()`, separately from `src/cli/index.ts`.

[spec_review] Reroute phase prompts currently encode the origin as `human_review` in `src/orchestrator/context.ts` and all three reroute templates/builders. Admitting `code_review` and pre-completion `qa` makes that runtime context false even though the exemption state remains unchanged.

[spec] Round-2 findings accepted in full and both are scope-expansion, not fine-tuning. Sweeping for the second finding's failure class (a live prompt string whose premise the widened gate invalidates) turned up a third instance the review did not name: `src/orchestrator/prompts/templates/qa.md` asks QA to answer `Human reroute?` by checking for a `human_review` rejection, so a task rerouted from `code_review`/`qa` would truthfully answer No and blind that quality-log column.

[spec] The entry phase is unrecoverable at prompt-render time — the reset loop returns `code_review`/`qa`/`human_review` to `pending` before any reroute prompt renders. So reroute prompts can only be made phase-*neutral*, not phase-aware, without a new persisted field. The banner (emitted pre-reset) is the one surface that can still name the real entry state.

[spec] A `doesNotMatch` assertion pinned to a phrase the same change deletes from the codebase becomes vacuously true. `tests/run-task-prompts.test.ts`'s bundle-banner guard is exactly that shape and has to be re-pointed at the replacement phrase, not just left passing.

[spec_review] `Human reroute?` is intentionally a human-review-rejection metric, not an any-reroute metric: the QA prompt and quality-log column define it that way, `docs/decisions.md` explicitly excludes `reroute_count` because it conflates `spec_gap` recovery, and an existing row records a documented `spec_gap` reroute as `No`. Rewording only QA guidance would silently redefine the same historical column.

[spec] Round-3 finding accepted in full; it is a scope *contraction*, not another hardening round. AC-11 withdrawn: the round-2 sweep item (3) was my error, not a spec gap. Verified the reviewer's three claims directly — `docs/task-quality-log.md:26` defines the column as a human_review rejection, `docs/decisions.md` §"Task quality-log row upserted at the qa → done transition" states the rule "Do not derive `Human reroute?` from a reroute counter" and rejects `reroute_count` *because* it conflates reroute origins, and the `ship-shared-doc-dirt-preservation` row records `No` beside a documented spec_gap reroute. `No` for a code_review/qa-origin reroute is the column's definition working, not a blind spot.

[spec] Withdrawing AC-11 strengthened AC-11-new (was AC-12): the golden diff now has a two-directional assertion — six reroute entries change AND `promptQa`/`promptQa_withTemplate` must be byte-unchanged. A contraction that removes a surface from scope can convert a "review the diff carefully" instruction into a checkable invariant.

[spec] AC-9's repo-wide grep needed an explicit widening of its leave-as-is classification (2 hit classes → 4). Dropping a file from scope is not enough when a grep AC still sweeps it: the qa.md `Human reroute?` bullet and the quality-log definition row both mention `human_review` as a precondition — for answering a metric, not for using `--reroute` — so an implementer running the grep would otherwise "fix" exactly what round 3 told us not to touch.

[spec_review] AC-9's `docs/`-wide current-rule sweep also reaches dated, resolved history in `docs/BACKLOG.md`; the closed operator-review-recovery entry deliberately preserves the former “hard-guarded to human_review” rule and error. Historical records need an explicit exclusion/classification rather than being rewritten to satisfy a live-contract grep.

[spec] Round-4 findings accepted in full, both verified against the tree first. The blocking one (AC-9's grep reaching `docs/BACKLOG.md:93-95`) is edge-fine-tune, not scope-expansion — but it was the second consecutive round to grow AC-9's leave-as-is enumeration (round 3: 2→4 classes; round 4 would make 5). Ran the sweep directly to test whether enumeration could converge: it cannot — `docs/BACKLOG.md` alone carries ~12 reroute/`human_review` co-occurrences and `CHANGELOG.md` 3, all dated records. So the fix is the scope *rule*, not the fifth exception.

[spec] Generalizable: when a grep AC's exception list grows on consecutive review rounds, the AC is mis-scoped, not under-specified. Replacing "enumerate the permitted hits" with two closed-form rules (dated records excluded as a class; within live files only contract-stating prose counts) ends the growth. Adding one more exception per round is the tell.

[spec] A "must not be edited" clause over telemetry docs needs a two-tier split or it is guaranteed to fail: `docs/task-quality-log.md` / `lessons-learned.md` / `pipeline-invocations.md` are orchestrator-appended at QA, so they legitimately appear in the task's diff. The checkable invariant is "additive only — no pre-existing line modified", while never-canon-written docs (`BACKLOG.md`, `CHANGELOG.md`) can take the stricter "absent from the diff" check.

[spec] Heading renames are not uniformly safe or unsafe — the discriminator is whether shipped code cites the text. `docs/pipeline-orchestrator.md` §"Human Reroute" is pinned by three paths (`src/cli/index.ts:110`, `src/orchestrator/cli.ts:159`, `src/orchestrator/main.ts:2511`) and keeps its heading; `.claude/skills/canon-pipeline/SKILL.md:148` is pinned by nothing but its own `templates/` mirror and gets renamed. Grep the exact heading text before deciding either way.

[spec] Line numbers in a spec AC drift under the implementer's own edits. Kept them as locators but declared the quoted current text the binding anchor, so the AC stays checkable after the first file is touched.

[implement] The plan's suggested Human Reroute warning cited a canon-ai-only `docs/patterns.md` heading that does not exist in the adopter scaffold; `docs-refs-check` rejected both the root doc and its mirror. Kept the safety warning self-contained so the shipped guidance remains valid in arbitrary adopter repos.
