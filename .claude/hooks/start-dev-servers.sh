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

# --- 4. Port ownership helpers ------------------------------------------------
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

# Kill a specific PID, BUT re-verify its cwd is still under MAIN_REPO first.
# Closes the TOCTOU window between port_owner and the actual kill: if the
# sibling died and an unrelated process got the PID or the port, we bail out.
kill_if_still_sibling() {
  local pid="$1" cwd
  cwd="$(pid_cwd "$pid" 2>/dev/null)" || return 0  # process gone — nothing to do
  if [[ -z "$cwd" || "$cwd" != "$MAIN_REPO"* ]]; then
    echo "[hook] pid $pid no longer a CENZONTLE process — refusing to kill" >> "$LOG_DIR/hook.log"
    return 1
  fi
  kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    # Re-verify again before SIGKILL (ultra-paranoid, very short TOCTOU window).
    cwd="$(pid_cwd "$pid" 2>/dev/null)" || return 0
    [[ "$cwd" == "$MAIN_REPO"* ]] && kill -9 "$pid" 2>/dev/null || true
  fi
  return 0
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
      echo "[hook] $name port $port held by sibling CENZONTLE worktree (pid $pid) — reclaiming" >> "$LOG_DIR/hook.log"
      if kill_if_still_sibling "$pid"; then
        start_bg "$name" "$filter" "$port"
      fi
      ;;
    foreign)
      echo "[hook] $name port $port held by foreign process (pid $pid) — leaving alone" >> "$LOG_DIR/hook.log"
      ;;
  esac
}

# --- 5. Start servers ---------------------------------------------------------
ensure_server "api" "api" 3001
ensure_server "web" "web" 3000

exit 0
