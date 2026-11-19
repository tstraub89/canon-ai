## Summary

- Codex models and Codex implement effort can now be set per repository under a new optional `codex` section in `.canon/config.json`. Keys left out fall back to the built-in defaults, key by key.
- The implement effort defaults drop one notch: XS `xhigh` → `medium`, S `xhigh` → `high`, M `max` → `high`, L `max` → `xhigh`. XL and delicate stay on the full model at `high`. Spec and code review effort is unchanged.
- Precedence is env var, then config, then built-in default. Existing `CODEX_MODEL_MINI` and `CODEX_MODEL_FULL` overrides, including the deprecated names, still win.
- The main checkout's `codex` section is read at startup and at each Codex call, so an edit on main reaches a task already in flight. A task worktree's copy is never validated or applied.
- Invalid `codex` values stop the run before any agent spawns, with a message that names the key, the value and the allowed set. `canon doctor` reports the section under its own check. Plain `--ship` skips the section, so a bad value cannot block merge or archive.
- Every telemetry row gets a trailing Effort cell. Rows written before the upgrade keep nine cells and show a blank Effort cell.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Measured on the previous release, the XS and S implement effort roughly doubled implement time with no matching drop in review rounds. The XS and S changes rest on that data. The M and L defaults are a judgment call, not a measured result. Please check them against the next few M and L runs.
- Judgment calls not explicitly confirmed during spec review:
  - Unknown keys warn, but a wrong type, an invalid effort or an unknown size key is a hard error. I chose this so a bad effort setting cannot be silently ignored and corrupt the measurement this change is meant to enable.
  - Effort config covers the `implement` row only. spec_review and the cold-Codex lens keep their current effort.
  - A metric row with no effort to record gets `-`, and a rejected effort value is logged as written.
  - Doctor reports the `codex` section as its own check, so a Codex error does not sit under the docs-freshness "delete the file" hint.
  - The invalid-effort error keeps its "bug in canon" attribution and no longer says effort is "not configurable".
  - Model and effort compatibility is not validated. Effort is checked only against the model-agnostic set. `max` is still only verified on the CLI/model pairs the docs already name.
- Malformed JSON in the main checkout's `.canon/config.json` now stops every non-ship run at startup, including worktree tasks and `claude`-mode runs. An unreadable file cannot provide a `codex` section, so I chose a hard stop over a silent fallback to defaults.
- The CHANGELOG entry is not in this PR. It will be written at release time, and it needs to cover the new defaults, the `codex` section, and the Effort column for upgraders.
