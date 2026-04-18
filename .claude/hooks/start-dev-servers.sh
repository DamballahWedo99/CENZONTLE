#!/usr/bin/env bash
# SessionStart hook for CENZONTLE worktree `stoic-sammet-3ed7eb`.
# - Copies .env files from main repo if missing in this worktree.
# - Starts API (port 3001) and Web (port 3000) in background if not already listening.
# - Idempotent: safe to run on every session start.
# - Non-blocking: uses nohup + & so the session starts without waiting on pnpm.

set -u  # undefined vars are errors; do NOT `set -e` (we want best-effort, not abort)

MAIN_REPO="/Users/damballahwedo911/Desktop/GAM/CENZONTLE"
WORKTREE="/Users/damballahwedo911/Desktop/GAM/CENZONTLE/.claude/worktrees/stoic-sammet-3ed7eb"
LOG_DIR="/tmp/cenzontle-stoic-sammet-3ed7eb"
mkdir -p "$LOG_DIR" 2>/dev/null || true

# --- 1. Copy env files if missing ---------------------------------------------

copy_if_missing() {
  local src="$1"
  local dst="$2"
  if [[ -f "$src" && ! -f "$dst" ]]; then
    cp "$src" "$dst" 2>/dev/null && echo "[hook] copied $(basename "$src") → worktree" >> "$LOG_DIR/hook.log"
  fi
}

copy_if_missing "$MAIN_REPO/apps/web/.env.local" "$WORKTREE/apps/web/.env.local"
copy_if_missing "$MAIN_REPO/apps/api/.env"       "$WORKTREE/apps/api/.env"

# --- 2. Start dev servers if ports are free -----------------------------------

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

start_bg() {
  local name="$1"
  local filter="$2"
  local log="$LOG_DIR/${name}.log"
  # Detach via setsid+nohup so the process survives the hook exit.
  (
    cd "$WORKTREE" || exit
    nohup pnpm --filter "$filter" dev >"$log" 2>&1 &
    disown 2>/dev/null || true
  ) &
  disown 2>/dev/null || true
  echo "[hook] started $name (log: $log)" >> "$LOG_DIR/hook.log"
}

if ! port_in_use 3001; then
  start_bg "api" "api"
fi

if ! port_in_use 3000; then
  start_bg "web" "web"
fi

# SessionStart hooks can emit JSON on stdout to inject context.
# We stay silent (suppressed) to avoid noise — the user already knows from this conversation.
exit 0
