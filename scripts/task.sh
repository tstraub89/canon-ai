#!/usr/bin/env bash
# canon-ai task management — lightweight CLI for the multi-agent pipeline.
# Usage: ./scripts/task.sh <command> [args]
#
# Requires: jq, git

set -euo pipefail

TASKS_DIR="tasks"
TEMPLATES_DIR="$TASKS_DIR/_templates"

check_jq() {
  if ! command -v jq &>/dev/null; then
    echo "Error: jq is required. Install it with: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
  fi
}

# When a task has an active worktree, that worktree's status.json is canonical
# during the pipeline (the orchestrator reads/writes there via resolveTaskCwd).
# Edits to REPO_ROOT's copy from a manual `./scripts/task.sh phase ...` would
# silently drift from what the pipeline sees.
#
# Returns the directory that owns the canonical tasks/<id>/ for this task:
# - The worktree path if `task/<id>` is checked out in a worktree
# - The current working directory otherwise
#
# Echoes the resolved path. Stderr-prints a `[task.sh] routed to <path>` note
# when routing to a worktree, so the operator can see where the edit landed.
resolve_task_cwd() {
  local id="$1"
  if ! command -v git &>/dev/null; then
    echo "."
    return
  fi
  # `git worktree list --porcelain` emits "worktree <path>\n... branch refs/heads/<branch>".
  # Pair them and find the one whose branch is task/<id>.
  local worktree_path
  worktree_path=$(git worktree list --porcelain 2>/dev/null | awk -v branch="refs/heads/task/$id" '
    /^worktree / { wt = substr($0, 10); next }
    /^branch / && $2 == branch { print wt; exit }
  ')
  if [ -n "$worktree_path" ] && [ -d "$worktree_path/$TASKS_DIR/$id" ]; then
    # Don't re-route if we're already inside the worktree.
    local pwd_real wt_real
    pwd_real=$(cd "$PWD" && pwd -P)
    wt_real=$(cd "$worktree_path" && pwd -P)
    if [ "$pwd_real" != "$wt_real" ]; then
      echo "[task.sh] routed to worktree: $worktree_path" >&2
    fi
    echo "$worktree_path"
    return
  fi
  echo "."
}

usage() {
  cat <<'EOF'
Usage: ./scripts/task.sh <command> [args]

Commands:
  new <TASK-ID> <title> [--base <branch>]
                          Create a new task from templates. Auto-detects
                          base_branch from current git checkout (use
                          --base to override). The base_branch field in
                          status.json determines what the task branches
                          off and what its PR targets.
  list                    Show all tasks and their current phase
  status <TASK-ID>        Show detailed status of a task
  phase <TASK-ID> <phase> <status> [verdict]
                          Update a task phase
                          Phases: spec, spec_review, plan, implement, runtime_validation, code_review, qa, human_review
                          Status: pending, in_progress, done, changes_requested, blocked
                          Verdict (optional, spec_review/runtime_validation/code_review only):
                            approved, approved_with_nits, changes_requested, needs_re_review
  reset-spec-review <TASK-ID>
                          Fully clear router-relevant state for a fresh
                          spec_review pass after an auto-block. Marks spec
                          done, sets spec_review back to pending with
                          iterations=0 and verdict cleared, archives the
                          existing spec-review.md as spec-review-prior-<N>.md
                          (so it doesn't bias the next reviewer), and drops
                          the claude_spec session id.
  post-merge-sync [<branch>]
                          After a task PR squash-merges, reconcile the local
                          branch with origin. Auto-detects current branch
                          (or pass an explicit branch arg). If local is
                          "ahead" only via redundant pipeline-telemetry /
                          status.json edits that the squash merge has
                          absorbed, hard-reset to origin. If local has real
                          new work that's not on origin, refuse and prompt
                          for manual decision. Works on main or release/*.
  release-init <version>  Initialize a release branch (release/v<MAJ.MIN>)
                          off main with the version bumped and an empty
                          in-progress CHANGELOG block. After this, run
                          'task.sh new' on the release branch to create
                          tasks that branch and merge against it. Final
                          release = single squash-merge release branch →
                          main carrying everything.

Examples:
  ./scripts/task.sh new feat-r-shortcut "R shortcut for frame orientation swap"
  ./scripts/task.sh new feat-x "X" --base release/v1.6
  ./scripts/task.sh release-init 1.6.0
  ./scripts/task.sh list
  ./scripts/task.sh status feat-r-shortcut
  ./scripts/task.sh phase feat-r-shortcut spec done
  ./scripts/task.sh reset-spec-review feat-r-shortcut
  ./scripts/task.sh post-merge-sync
  ./scripts/task.sh post-merge-sync release/v1.6
EOF
}

validate_task_id() {
  local id="$1"
  if [[ ! "$id" =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
    echo "Error: invalid task ID '$id'. Must be lowercase alphanumeric, hyphens, dots, or underscores. No slashes, spaces, or leading special characters."
    exit 1
  fi
  if [[ "$id" == *..* ]]; then
    echo "Error: invalid task ID '$id'. Must not contain '..'."
    exit 1
  fi
}

cmd_new() {
  check_jq
  local id="" title="" base_branch=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --base)
        base_branch="${2:?--base requires a branch name}"
        shift 2
        ;;
      --base=*)
        base_branch="${1#--base=}"
        shift
        ;;
      *)
        if [ -z "$id" ]; then
          id="$1"
        elif [ -z "$title" ]; then
          title="$1"
        else
          echo "Error: unexpected argument '$1'."
          exit 1
        fi
        shift
        ;;
    esac
  done
  if [ -z "$id" ] || [ -z "$title" ]; then
    echo "Error: usage: ./scripts/task.sh new <TASK-ID> <title> [--base <branch>]"
    exit 1
  fi
  validate_task_id "$id"
  # Reject newlines — embedded LF breaks the sed substitution pattern
  if [[ "$title" == *$'\n'* ]]; then
    echo "Error: title must be single-line (no embedded newlines)."
    exit 1
  fi
  local task_dir="$TASKS_DIR/$id"

  if [ -d "$task_dir" ]; then
    echo "Error: Task directory $task_dir already exists."
    exit 1
  fi

  # Auto-detect base branch from current git checkout when not explicitly set.
  # Tasks branch off whatever branch is checked out at creation time — `main`
  # for normal tasks, `release/<v>` when working on a multi-task release.
  if [ -z "$base_branch" ]; then
    if command -v git &>/dev/null; then
      base_branch="$(git branch --show-current 2>/dev/null || echo main)"
    fi
    base_branch="${base_branch:-main}"
  fi

  mkdir -p "$task_dir"

  # Copy templates, escaping special chars in id/title for sed safety
  local escaped_id escaped_title
  escaped_id=$(printf '%s' "$id" | sed 's/[&/\]/\\&/g')
  escaped_title=$(printf '%s' "$title" | sed 's/[&/\]/\\&/g')

  for tmpl in "$TEMPLATES_DIR"/*.md "$TEMPLATES_DIR"/*.json; do
    [ -f "$tmpl" ] || continue
    local basename
    basename=$(basename "$tmpl")
    sed -e "s/\[TASK-ID\]/$escaped_id/g" -e "s/\[Title\]/$escaped_title/g" "$tmpl" > "$task_dir/$basename"
  done

  # Set dates, base branch, and metadata in status.json.
  local today
  today=$(date +%Y-%m-%d)
  local tmp="$task_dir/status.json.tmp"
  jq --arg id "$id" --arg title "$title" --arg date "$today" --arg base "$base_branch" \
    '.id = $id | .title = $title | .created = $date | .updated = $date | .base_branch = $base' \
    "$task_dir/status.json" > "$tmp" && mv "$tmp" "$task_dir/status.json"

  echo "Created task: $task_dir"
  echo "Files:"
  ls -1 "$task_dir"
  echo ""
  echo "Next: Write the spec in $task_dir/spec.md"
  echo ""
  echo "  Defaults: task_size=M, delicate=false, human_spec_gate=true, base_branch=$base_branch"
  echo "  Edit $task_dir/status.json to adjust before running the pipeline."
}

cmd_list() {
  check_jq
  if [ ! -d "$TASKS_DIR" ] || [ -z "$(ls -d "$TASKS_DIR"/*/status.json 2>/dev/null)" ]; then
    echo "No tasks found."
    return
  fi

  printf "%-25s %-40s %s\n" "TASK" "TITLE" "CURRENT PHASE"
  printf "%-25s %-40s %s\n" "----" "-----" "-------------"

  for status_file in "$TASKS_DIR"/*/status.json; do
    local dir id title phase
    dir=$(dirname "$status_file")
    id=$(basename "$dir")

    if [ "$id" = "_templates" ]; then continue; fi

    title=$(jq -r '.title // "(untitled)"' "$status_file")
    # Derive current phase the same way cmd_phase does: walk phases in
    # canonical order and return the first one not marked "done", or
    # "complete" if every phase is done. Must match the derivation in
    # cmd_phase and scripts/run-task.ts deriveTopLevelStatus() so a
    # malformed/legacy status file can't make `list` and the orchestrator
    # disagree on where a task is.
    phase=$(jq -r '
      def phase_order: ["spec","spec_review","plan","implement","runtime_validation","code_review","qa","human_review"];
      . as $doc |
      def phase_status($p):
        if $p == "runtime_validation" and ($doc.phases[$p]? == null) then "done"
        else ($doc.phases[$p]?.status // "pending") end;
      (phase_order | map(select(phase_status(.) != "done")) | first // "complete")
    ' "$status_file")
    printf "%-25s %-40s %s\n" "$id" "$title" "$phase"
  done
}

cmd_status() {
  check_jq
  local id="${1:?Task ID required}"
  validate_task_id "$id"
  local task_cwd
  task_cwd=$(resolve_task_cwd "$id")
  local status_file="$task_cwd/$TASKS_DIR/$id/status.json"

  if [ ! -f "$status_file" ]; then
    echo "Error: No status.json found for task $id"
    exit 1
  fi

  jq '.' "$status_file"
}

cmd_phase() {
  check_jq
  local id="${1:?Task ID required}"
  validate_task_id "$id"
  local phase="${2:?Phase required (spec, spec_review, plan, implement, runtime_validation, code_review, qa, human_review)}"
  local status="${3:?Status required (pending, in_progress, done, changes_requested, blocked)}"
  local verdict="${4:-}"

  # Validate phase
  case "$phase" in
    spec|spec_review|plan|implement|runtime_validation|code_review|qa|human_review) ;;
    *)
      echo "Error: invalid phase '$phase'. Must be one of: spec, spec_review, plan, implement, runtime_validation, code_review, qa, human_review"
      exit 1
      ;;
  esac

  # Validate status
  case "$status" in
    pending|in_progress|done|changes_requested|blocked) ;;
    *)
      echo "Error: invalid status '$status'. Must be one of: pending, in_progress, done, changes_requested, blocked"
      exit 1
      ;;
  esac

  # Route to the worktree's status.json if one exists for this task. The
  # worktree's copy is canonical during the pipeline; manual edits to the
  # REPO_ROOT copy when a worktree is active silently drift.
  local task_cwd
  task_cwd=$(resolve_task_cwd "$id")
  local status_file="$task_cwd/$TASKS_DIR/$id/status.json"

  if [ ! -f "$status_file" ]; then
    echo "Error: No status.json found for task $id (looked in $task_cwd/$TASKS_DIR/$id/)"
    exit 1
  fi

  # Validate verdict usage
  if [ -n "$verdict" ]; then
    if [ "$phase" != "spec_review" ] && [ "$phase" != "runtime_validation" ] && [ "$phase" != "code_review" ]; then
      echo "Error: verdict is only valid for spec_review, runtime_validation, and code_review phases"
      exit 1
    fi
    case "$verdict" in
      approved|approved_with_nits|changes_requested|needs_re_review) ;;
      *)
        echo "Error: invalid verdict '$verdict'. Must be one of: approved, approved_with_nits, changes_requested, needs_re_review"
        exit 1
        ;;
    esac
  fi

  # Reject out-of-order phase transitions: all prior phases must be done first
  if [ "$status" != "pending" ]; then
    local prior_check
    prior_check=$(jq -r --arg phase "$phase" '
      def phase_order: ["spec","spec_review","plan","implement","runtime_validation","code_review","qa","human_review"];
      . as $doc |
      def phase_status($p):
        if $p == "runtime_validation" and ($doc.phases[$p]? == null) then "done"
        else ($doc.phases[$p]?.status // "pending") end;
      (phase_order | to_entries | map(select(.value == $phase)) | first.key) as $idx |
      if $idx > 0 then
        [ phase_order[:$idx][] as $p | select(phase_status($p) != "done") | $p ] |
        if length > 0 then "blocked:" + join(",") else "ok" end
      else "ok" end
    ' "$status_file")
    if [[ "$prior_check" == blocked:* ]]; then
      local blocked_phases="${prior_check#blocked:}"
      echo "Error: cannot mark $phase as $status — prior phases not done: $blocked_phases"
      exit 1
    fi
  fi

  local today
  today=$(date +%Y-%m-%d)
  local tmp="${status_file}.tmp"
  # Top-level `.status` is always DERIVED from `.phases` — it's a convenience
  # pointer, not authoritative. Rule: the first phase (in canonical order) whose
  # status is not "done" is the current phase; if every phase is done, the task
  # is "complete". This means `--reroute` and `--ship` don't need to touch the
  # top-level pointer — they rewrite phase statuses and derivation does the rest.
  jq --arg phase "$phase" --arg status "$status" --arg date "$today" --arg verdict "$verdict" \
    'def phase_order: ["spec","spec_review","plan","implement","runtime_validation","code_review","qa","human_review"];
     def phase_status($doc; $p):
       if $p == "runtime_validation" and ($doc.phases[$p]? == null) then "done"
       else ($doc.phases[$p]?.status // "pending") end;
     def derive_top_level:
       . as $doc |
       (phase_order | map(select(phase_status($doc; .) != "done")) | first // "complete");
      (if .phases[$phase] == null then
        .phases[$phase] = (
          if $phase == "runtime_validation" then
            {"status": "pending", "agent": "orchestrator", "verdict": "", "iterations": 0,
             "iterations_current_loop": 0, "iterations_total": 0,
             "changes_requested_total": 0, "auto_block_count": 0}
          else
            {"status": "pending", "agent": ""}
          end
        )
      else . end) |
     .phases[$phase].status = $status | .updated = $date |
     if ($verdict != "") and (.phases[$phase] | has("verdict")) then .phases[$phase].verdict = $verdict else . end |
     (if ($phase == "code_review" or $phase == "spec_review" or $phase == "runtime_validation")
       then .phases[$phase].iterations_current_loop //= (.phases[$phase].iterations // 0) |
         .phases[$phase].iterations_total //= (.phases[$phase].iterations // 0) |
         .phases[$phase].changes_requested_total //= 0 |
         .phases[$phase].auto_block_count //= 0 |
         if ($verdict == "changes_requested" or $verdict == "needs_re_review") then
           .phases[$phase].iterations_current_loop += 1 |
           .phases[$phase].iterations_total += 1 |
           .phases[$phase].changes_requested_total += 1 |
           .phases[$phase].iterations = .phases[$phase].iterations_current_loop
         elif ($verdict == "approved" or $verdict == "approved_with_nits") then
           .phases[$phase].iterations_total += 1 |
           .phases[$phase].iterations_current_loop = 0 |
           .phases[$phase].iterations = 0
         else . end
       else . end) |
     .status = derive_top_level' \
    "$status_file" > "$tmp" && mv "$tmp" "$status_file"
  if [ -n "$verdict" ]; then
    echo "Updated $id: $phase → $status (verdict: $verdict)"
  else
    echo "Updated $id: $phase → $status"
  fi
}

cmd_reset_spec_review() {
  check_jq
  local id="${1:-}"
  if [ -z "$id" ]; then
    echo "Error: usage: ./scripts/task.sh reset-spec-review <TASK-ID>"
    exit 1
  fi
  validate_task_id "$id"
  local task_cwd
  task_cwd=$(resolve_task_cwd "$id")
  local task_dir="$task_cwd/$TASKS_DIR/$id"
  local status_file="$task_dir/status.json"
  if [ ! -f "$status_file" ]; then
    echo "Error: no status.json at $status_file"
    exit 1
  fi

  # Archive existing spec-review.md as spec-review-prior-<N>.md so the next
  # reviewer doesn't read it and re-emit the same prior-round complaints.
  if [ -f "$task_dir/spec-review.md" ]; then
    local n=1
    while [ -f "$task_dir/spec-review-prior-$n.md" ]; do
      n=$((n + 1))
    done
    mv "$task_dir/spec-review.md" "$task_dir/spec-review-prior-$n.md"
    echo "Archived prior spec-review.md → spec-review-prior-$n.md"
  fi

  # Reset spec → done, spec_review → pending (iterations 0, verdict ''),
  # and drop claude_spec session id so the router can't resume the old
  # changes_requested context.
  local tmp="${status_file}.tmp"
  jq 'def phase_order: ["spec","spec_review","plan","implement","runtime_validation","code_review","qa","human_review"];
      def phase_status($doc; $p):
        if $p == "runtime_validation" and ($doc.phases[$p]? == null) then "done"
        else ($doc.phases[$p]?.status // "pending") end;
      def derive_top_level:
        . as $doc |
        (phase_order | map(select(phase_status($doc; .) != "done")) | first // "complete");
      .phases.spec.status = "done" |
      .phases.spec_review.status = "pending" |
      .phases.spec_review.iterations = 0 |
      .phases.spec_review.iterations_current_loop = 0 |
      .phases.spec_review.verdict = "" |
      (if (.sessions // {}) | has("claude_spec") then del(.sessions.claude_spec) else . end) |
      .updated = (now | strftime("%Y-%m-%d")) |
      .status = derive_top_level' \
    "$status_file" > "$tmp" && mv "$tmp" "$status_file"
  echo "Reset $id: spec → done, spec_review → pending (iter=0, verdict cleared, claude_spec session dropped)"
}

cmd_post_merge_sync() {
  # Detect if local <branch> is "ahead via redundant pipeline-telemetry /
  # status.json edits absorbed by a squash merge" and hard-reset, OR if local
  # has real new work, refuse and prompt for manual decision.
  #
  # Branch resolution: explicit arg → current branch → 'main' fallback.
  # Works for release branches too — running this on `release/v1.6` will
  # reconcile against `origin/release/v1.6`.
  if ! command -v git &>/dev/null; then
    echo "Error: git is required."
    exit 1
  fi

  local target_branch="${1:-}"
  if [ -z "$target_branch" ]; then
    target_branch="$(git branch --show-current 2>/dev/null || echo '')"
  fi
  if [ -z "$target_branch" ]; then
    echo "Error: could not determine current branch (detached HEAD?). Pass branch as arg."
    exit 1
  fi

  local current
  current="$(git branch --show-current 2>/dev/null || echo '')"
  if [ "$current" != "$target_branch" ]; then
    echo "Error: post-merge-sync expects you to be on '$target_branch' (you are on '$current')."
    exit 1
  fi

  # Refuse to run if there are uncommitted local changes — the hard-reset path
  # would silently destroy them. Mirrors the guard in cmd_release_init.
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "Error: working tree is dirty. Commit or stash local changes before running post-merge-sync."
    exit 1
  fi

  echo "→ Fetching origin/$target_branch..."
  git fetch origin "$target_branch" >/dev/null 2>&1 || { echo "Error: git fetch failed."; exit 1; }

  local ahead behind
  ahead="$(git rev-list --count origin/"$target_branch".."$target_branch" 2>/dev/null || echo 0)"
  behind="$(git rev-list --count "$target_branch"..origin/"$target_branch" 2>/dev/null || echo 0)"

  if [ "$ahead" = "0" ] && [ "$behind" = "0" ]; then
    echo "✓ $target_branch is in sync with origin/$target_branch."
    return 0
  fi

  if [ "$ahead" = "0" ] && [ "$behind" -gt "0" ]; then
    echo "→ $target_branch is $behind commit(s) behind origin/$target_branch, fast-forwarding..."
    git pull --ff-only origin "$target_branch"
    return 0
  fi

  # ahead > 0: check whether local commits modify only telemetry / task-state
  # files (pipeline accumulators that get squash-absorbed) vs real source.
  local source_paths
  source_paths="$(git diff --name-only origin/"$target_branch".."$target_branch" 2>/dev/null \
    | grep -Ev '^(docs/pipeline-invocations\.md|docs/task-quality-log\.md|docs/lessons-learned\.md|tasks/)' \
    || true)"

  if [ -z "$source_paths" ]; then
    echo "→ $target_branch is $ahead commit(s) ahead of origin/$target_branch, but only via"
    echo "  pipeline telemetry / task-state edits that have been absorbed by squash merges."
    echo "  Hard-resetting to origin/$target_branch..."
    git reset --hard "origin/$target_branch"
    echo "✓ $target_branch reset to origin/$target_branch ($(git log -1 --format=%h))."
    return 0
  fi

  echo "⚠️  $target_branch is $ahead commit(s) ahead of origin/$target_branch with non-telemetry changes:"
  echo ""
  echo "$source_paths" | sed 's/^/    /'
  echo ""
  echo "Refusing to hard-reset. Either push these commits to origin"
  echo "(\`git push origin $target_branch\`) if they're real work, or rebase manually"
  echo "if they conflict with the squash merge."
  exit 1
}

cmd_release_init() {
  # Initialize a release branch with a version bump and an empty in-progress
  # changelog block. After this, individual tasks branch off the release
  # branch (auto-detected by `task.sh new`), merge back into it via PRs, and
  # the final release lands as a single squash-merge release/<v> → main.
  #
  # Convention: bump version immediately so test deployments off the release
  # branch surface the new version. Changelog stays in `## v<X.Y.Z> - unreleased`
  # form until the final release; bullets get appended naturally as tasks ship.
  local version="${1:-}"
  if [ -z "$version" ]; then
    echo "Error: usage: ./scripts/task.sh release-init <version>"
    echo "       e.g.: ./scripts/task.sh release-init 1.6.0"
    exit 1
  fi
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must be semver (e.g. 1.6.0). Got: $version"
    exit 1
  fi
  if ! command -v git &>/dev/null || ! command -v jq &>/dev/null; then
    echo "Error: git and jq are required."
    exit 1
  fi

  # "1.6.0" → "v1.6"; "1.0.5" → "v1.0.5". `${version%.0}` only strips a
  # trailing ".0", so non-zero patch versions pass through unchanged.
  local short="v${version%.0}"
  local branch="release/$short"

  # Pre-flight: must be on main, working tree clean.
  local current
  current="$(git branch --show-current 2>/dev/null || echo '')"
  if [ "$current" != "main" ]; then
    echo "Error: release-init expects you to start on 'main' (you are on '$current')."
    exit 1
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "Error: working tree is dirty. Commit or stash first."
    exit 1
  fi

  # Verify main is in sync with origin/main.
  echo "→ Fetching origin/main..."
  git fetch origin main >/dev/null 2>&1 || { echo "Error: git fetch failed."; exit 1; }
  local behind
  behind="$(git rev-list --count main..origin/main 2>/dev/null || echo 0)"
  if [ "$behind" -gt "0" ]; then
    echo "Error: local main is $behind commit(s) behind origin/main. Pull first."
    exit 1
  fi

  # Verify the release branch doesn't already exist locally or on remote.
  if git rev-parse --verify "$branch" >/dev/null 2>&1; then
    echo "Error: branch '$branch' already exists locally."
    exit 1
  fi
  if git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
    echo "Error: branch '$branch' already exists on origin."
    exit 1
  fi

  echo "→ Creating $branch off main..."
  git checkout -b "$branch" main

  # Project-specific version + changelog handling. canon-ai's release-init
  # is opinionated about Node-style projects (package.json, CHANGELOG.md) but
  # tolerant of their absence — for non-Node projects, the branch creation
  # + push still happens and version-tracking files are skipped.
  local files_to_add=()

  if [ -f "package.json" ]; then
    echo "→ Bumping package.json version to $version..."
    local pkg_tmp="package.json.tmp"
    jq --arg v "$version" '.version = $v' package.json > "$pkg_tmp" && mv "$pkg_tmp" package.json
    files_to_add+=(package.json)

    if [ -f "package-lock.json" ]; then
      echo "→ Bumping package-lock.json..."
      local lock_tmp="package-lock.json.tmp"
      # package-lock has the version twice — at top level and inside packages.""
      jq --arg v "$version" '.version = $v | .packages[""].version = $v' package-lock.json > "$lock_tmp" && mv "$lock_tmp" package-lock.json
      files_to_add+=(package-lock.json)
    fi
  fi

  if [ -f "CHANGELOG.md" ]; then
    echo "→ Inserting empty changelog block for $short..."
    local changelog_tmp="CHANGELOG.md.tmp"
    awk -v ver="$short" '
      NR == 1 { print; print ""; print "## " ver " - unreleased"; print ""; print "<!-- Bullets land here as tasks for " ver " ship. The single squash-merge of release/" ver " → main carries this entry to production. -->"; next }
      { print }
    ' CHANGELOG.md > "$changelog_tmp" && mv "$changelog_tmp" CHANGELOG.md
    files_to_add+=(CHANGELOG.md)
  fi

  # Commit + push.
  if [ ${#files_to_add[@]} -gt 0 ]; then
    git add "${files_to_add[@]}"
    git commit -m "chore: initialize $branch (version $version)"
  else
    # Non-Node project, no CHANGELOG: still commit something so the branch can be pushed.
    git commit --allow-empty -m "chore: initialize $branch (version $version, no version files to bump)"
  fi
  git push -u origin "$branch"

  echo ""
  echo "✓ Release branch $branch initialized and pushed."
  echo ""
  echo "Next steps:"
  echo "  1. Create tasks on this branch: ./scripts/task.sh new <id> <title>"
  echo "     (auto-detects base_branch=$branch from your current checkout)"
  echo "  2. Each task PR targets $branch (not main)."
  echo "  3. As tasks ship, append bullets to the v$short block in CHANGELOG.md."
  echo "  4. When ready: open PR $branch → main, squash-merge for the release."
}

# Main dispatch
case "${1:-}" in
  new)               shift; cmd_new "$@" ;;
  list)              cmd_list ;;
  status)            shift; cmd_status "$@" ;;
  phase)             shift; cmd_phase "$@" ;;
  reset-spec-review) shift; cmd_reset_spec_review "$@" ;;
  post-merge-sync)   shift; cmd_post_merge_sync "$@" ;;
  release-init)      shift; cmd_release_init "$@" ;;
  *)                 usage ;;
esac
