#!/usr/bin/env bash
# SessionStart hook for CENZONTLE — portable across main repo and any worktree.
# - Detects current worktree/main via $CLAUDE_PROJECT_DIR.
# - Copies .env files from main repo if missing in this worktree.
# - Runs setup: pnpm install, build shared, prisma generate, lint.
# - Hardened: umask 077 (logs with secrets), mkdir -m 700, symlink guard,
#   mutex against concurrent runs, sanitized worktree name, paths normalized.

set -u
umask 077  # logs may contain secrets from .env — user-only perms

# --- 0. Resolve paths dynamically and safely ----------------------------------
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  WORKTREE_RAW="$CLAUDE_PROJECT_DIR"
else
  WORKTREE_RAW="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
fi

# Normalize: resolve all symlinks so cwd comparisons work on macOS
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

# --- 4. Fresh-worktree setup: pnpm install, build shared, prisma generate -----
setup_worktree() {
  local did_work=0
  local setup_log="$LOG_DIR/setup.log"

  # 1. pnpm install — creates node_modules with links to the pnpm store.
  if [[ ! -d "$WORKTREE/node_modules" ]]; then
    echo "[hook] setup: pnpm install (fresh worktree)" >> "$LOG_DIR/hook.log"
    if ! (cd "$WORKTREE" && pnpm install --prefer-offline) >>"$setup_log" 2>&1; then
      echo "[hook] setup ERROR: pnpm install failed — see $setup_log" >> "$LOG_DIR/hook.log"
      return 1
    fi
    did_work=1
  fi

  # 2. Build @cenzontle/shared — the api and web import from its dist output.
  if [[ -f "$WORKTREE/packages/shared/package.json" ]] && \
     [[ ! -f "$WORKTREE/packages/shared/dist/index.js" ]]; then
    echo "[hook] setup: build @cenzontle/shared" >> "$LOG_DIR/hook.log"
    if ! (cd "$WORKTREE" && pnpm --filter @cenzontle/shared build) >>"$setup_log" 2>&1; then
      echo "[hook] setup ERROR: shared build failed — see $setup_log" >> "$LOG_DIR/hook.log"
      return 1
    fi
    did_work=1
  fi

  # 3. Prisma generate — always run when schema exists.
  if [[ -f "$WORKTREE/apps/api/prisma/schema.prisma" ]]; then
    echo "[hook] setup: prisma generate" >> "$LOG_DIR/hook.log"
    if ! (cd "$WORKTREE" && pnpm --filter api exec prisma generate) >>"$setup_log" 2>&1; then
      echo "[hook] setup WARN: prisma generate failed (api may not start) — see $setup_log" >> "$LOG_DIR/hook.log"
    else
      did_work=1
    fi
  fi

  # 4. Lint — non-blocking validation. Log results so the agent sees issues early.
  echo "[hook] setup: running lint (non-blocking)" >> "$LOG_DIR/hook.log"
  if (cd "$WORKTREE" && pnpm lint) >>"$setup_log" 2>&1; then
    echo "[hook] setup: lint passed ✓" >> "$LOG_DIR/hook.log"
  else
    echo "[hook] setup WARN: lint has errors — see $setup_log" >> "$LOG_DIR/hook.log"
  fi

  [[ "$did_work" == "1" ]] && echo "[hook] setup complete" >> "$LOG_DIR/hook.log"
  return 0
}

if ! setup_worktree; then
  echo "[hook] ABORT: setup failed" >> "$LOG_DIR/hook.log"
  exit 0
fi

exit 0
