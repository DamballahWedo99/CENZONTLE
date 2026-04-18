#!/usr/bin/env bash
# SessionStart hook for CENZONTLE — portable across main repo and any worktree.
# - Detects current worktree/main via $CLAUDE_PROJECT_DIR.
# - Copies .env files from main repo if missing in this worktree.
# - Starts API/Web in background. Reclaims port only from sibling CENZONTLE procs.
# - Hardened: umask 077 (logs with secrets), mkdir -m 700, symlink guard,
#   flock against concurrent runs, re-verified PID kill (TOCTOU-safe),
#   sanitized worktree name, paths normalized with realpath.

set -u
umask 077  # logs may contain secrets from .env — user-only perms

# --- 0. Resolve paths dynamically and safely ----------------------------------
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  WORKTREE_RAW="$CLAUDE_PROJECT_DIR"
else
  WORKTREE_RAW="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
fi

# Normalize: resolve all symlinks so cwd comparisons against lsof work on macOS
# (kernel reports /private/var/..., not /var/...).
WORKTREE="$(cd "$WORKTREE_RAW" 2>/dev/null && pwd -P)" || exit 0
WORKTREE_NAME="$(basename "$WORKTREE")"

# Sanitize the name used in LOG_DIR — defense-in-depth even though basename is safe.
if [[ ! "$WORKTREE_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  exit 0
fi

if [[ "$WORKTREE" == */.claude/worktrees/* ]]; then
  MAIN_REPO_RAW="${WORKTREE%/.claude/worktrees/*}"
else
  MAIN_REPO_RAW="$WORKTREE"
fi
MAIN_REPO="$(cd "$MAIN_REPO_RAW" 2>/dev/null && pwd -P)" || exit 0

# --- 1. Log dir: user-only, never a symlink -----------------------------------
LOG_DIR="/tmp/cenzontle-${WORKTREE_NAME}"

# Refuse to proceed if a symlink was planted at $LOG_DIR (symlink attack).
if [[ -L "$LOG_DIR" ]]; then
  exit 0
fi
mkdir -m 700 -p "$LOG_DIR" 2>/dev/null || true
# Re-check after mkdir: still not a symlink, and it is a real dir.
if [[ ! -d "$LOG_DIR" ]] || [[ -L "$LOG_DIR" ]]; then
  exit 0
fi
chmod 700 "$LOG_DIR" 2>/dev/null || true

echo "[hook] $(date '+%F %T')  worktree=$WORKTREE_NAME  main=$MAIN_REPO" >> "$LOG_DIR/hook.log"

# --- 2. Mutex: only one hook instance at a time for this worktree -------------
# Prevents two concurrent Claude Code sessions from both seeing "port free"
# and double-starting pnpm dev. Uses mkdir for portability (flock is GNU-only,
# absent on macOS by default).
LOCK_DIR="$LOG_DIR/.hook.lock.d"
release_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Stale-lock recovery: treat a lock dir older than 2 min as abandoned.
  if [[ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +2 2>/dev/null)" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null
    mkdir "$LOCK_DIR" 2>/dev/null || { exit 0; }
    echo "[hook] recovered stale lock" >> "$LOG_DIR/hook.log"
  else
    echo "[hook] another instance holds the lock — skipping" >> "$LOG_DIR/hook.log"
    exit 0
  fi
fi
trap release_lock EXIT INT TERM

# --- 3. Copy env files if missing (only from worktree, not main -> main) ------
copy_if_missing() {
  local src="$1" dst="$2"
  if [[ -f "$src" && ! -f "$dst" ]]; then
    cp "$src" "$dst" 2>/dev/null && \
      echo "[hook] copied $(basename "$src") → worktree" >> "$LOG_DIR/hook.log"
  fi
}

if [[ "$WORKTREE" != "$MAIN_REPO" ]]; then
  copy_if_missing "$MAIN_REPO/apps/web/.env.local" "$WORKTREE/apps/web/.env.local"
  copy_if_missing "$MAIN_REPO/apps/api/.env"       "$WORKTREE/apps/api/.env"
fi

# --- 4. Port ownership & sibling reclaim --------------------------------------
port_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }

# Returns the cwd of a PID, normalized (symlinks resolved).
pid_cwd() {
  local pid="$1" raw
  raw="$(lsof -p "$pid" 2>/dev/null | awk '$4=="cwd" {print $NF; exit}')"
  [[ -z "$raw" ]] && return 1
  (cd "$raw" 2>/dev/null && pwd -P) || printf '%s' "$raw"
}

# Classify owner and return "<kind>:<pid>". kind ∈ {free,self,sibling,foreign}.
port_owner() {
  local port="$1" pid cwd
  pid="$(port_pid "$port")"
  [[ -z "$pid" ]] && { echo "free:"; return; }
  cwd="$(pid_cwd "$pid")" || cwd=""
  if [[ -n "$cwd" && "$cwd" == "$WORKTREE"* ]]; then
    echo "self:$pid"
  elif [[ -n "$cwd" && "$cwd" == "$MAIN_REPO"* ]]; then
    echo "sibling:$pid"
  else
    echo "foreign:$pid"
  fi
}

# Find ALL PIDs whose cwd is inside MAIN_REPO but NOT inside WORKTREE.
# Captures supervisors (turbo, pnpm, nest, next), their children, AND zombies
# from previous sessions — essential because killing just the port-binder
# leaves the supervisor, which instantly respawns a new binder.
# Filtered by command signature to avoid touching unrelated node processes.
find_sibling_pids() {
  local candidates pids_csv pid cwd ncwd
  candidates="$(pgrep -f '(pnpm( |$)|turbo( |$)|next dev|next-server|nest( |$)|@nestjs/cli|next/dist/bin/next)' 2>/dev/null)"
  [[ -z "$candidates" ]] && return 0
  pids_csv="$(echo "$candidates" | paste -sd, -)"
  lsof -p "$pids_csv" 2>/dev/null | awk '$4=="cwd"{print $2, $NF}' | while read -r pid cwd; do
    [[ -z "$cwd" ]] && continue
    ncwd="$(cd "$cwd" 2>/dev/null && pwd -P)" || continue
    if [[ "$ncwd" == "$MAIN_REPO"/* && "$ncwd" != "$WORKTREE"* && "$ncwd" != "$WORKTREE" ]]; then
      echo "$pid"
    fi
  done | sort -u
}

# Kill every sibling process (tree + zombies) and verify ports free up.
reclaim_siblings() {
  local pids
  pids="$(find_sibling_pids)"
  [[ -z "$pids" ]] && return 0
  local count
  count=$(echo "$pids" | wc -l | tr -d ' ')
  echo "[hook] reclaiming $count sibling pids: $(echo "$pids" | tr '\n' ' ')" >> "$LOG_DIR/hook.log"
  echo "$pids" | xargs kill -TERM 2>/dev/null || true
  sleep 2
  pids="$(find_sibling_pids)"
  if [[ -n "$pids" ]]; then
    echo "[hook] SIGKILL stubborn siblings: $(echo "$pids" | tr '\n' ' ')" >> "$LOG_DIR/hook.log"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

start_bg() {
  local name="$1" filter="$2" port="$3" log="$LOG_DIR/${name}.log"
  (
    cd "$WORKTREE" || exit
    nohup pnpm --filter "$filter" dev >"$log" 2>&1 &
    disown 2>/dev/null || true
  ) &
  disown 2>/dev/null || true
  echo "[hook] started $name (log: $log)" >> "$LOG_DIR/hook.log"
  # Wait briefly for the port to bind so the next hook instance (racing with
  # ours under the lock) sees the port as owned instead of free.
  local tries=0
  while (( tries < 10 )) && ! lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; do
    sleep 0.5
    ((tries++)) || true
  done
}

ensure_server() {
  local name="$1" filter="$2" port="$3"
  local info kind pid
  info="$(port_owner "$port")"
  kind="${info%%:*}"
  pid="${info#*:}"
  case "$kind" in
    free)
      start_bg "$name" "$filter" "$port"
      ;;
    self)
      echo "[hook] $name port $port already owned by this worktree — skipping" >> "$LOG_DIR/hook.log"
      ;;
    sibling)
      # Shouldn't happen here — reclaim_siblings ran first. Log and skip.
      echo "[hook] $name port $port still held by sibling (pid $pid) after reclaim — skipping" >> "$LOG_DIR/hook.log"
      ;;
    foreign)
      echo "[hook] $name port $port held by foreign process (pid $pid) — leaving alone" >> "$LOG_DIR/hook.log"
      ;;
  esac
}

# --- 5. Reclaim siblings first (tree-wide) ------------------------------------
# Pre-classify: only reclaim if at least one target port is sibling-owned.
owner_api="$(port_owner 3001)"; kind_api="${owner_api%%:*}"
owner_web="$(port_owner 3000)"; kind_web="${owner_web%%:*}"
if [[ "$kind_api" == "sibling" || "$kind_web" == "sibling" ]]; then
  reclaim_siblings
fi

# --- 6. Preflight: node_modules must exist ------------------------------------
# A fresh worktree has no node_modules; pnpm would fail with "next: command
# not found" in the background log where nobody sees it.
if [[ ! -d "$WORKTREE/node_modules" ]]; then
  echo "[hook] ABORT: $WORKTREE/node_modules missing — run 'pnpm install' in this worktree to enable dev servers" >> "$LOG_DIR/hook.log"
  exit 0
fi

# --- 7. Start servers ---------------------------------------------------------
ensure_server "api" "api" 3001
ensure_server "web" "web" 3000

exit 0
