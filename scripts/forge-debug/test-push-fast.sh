#!/usr/bin/env bash
#
# test-push-fast.sh — Encola una épica y monitorea el agent_run en vivo
#
# Lo que hace:
#   1. Verifica precondiciones (API up, worker corriendo desde el worktree)
#   2. Resetea el state del epic (agent_runs + stories backlog + branches GitHub)
#   3. Encola la épica via SQL (UPDATE epics SET enqueuedAt=NOW(), enqueuedBatchId=<uuid>)
#   4. Tailea agent_runs en la BD cada 2s, mostrando: status, attempts, branch, exitCode
#   5. Termina cuando hay un run terminal (completed/failed/abandoned) o timeout
#
# El worker debe ESTAR corriendo previamente desde este worktree para que
# los logs nuevos (preflight + recovery) se emitan. Si no está corriendo, el
# script te avisa y termina.
#
# Uso:
#   ./test-push-fast.sh                          # epic default
#   ./test-push-fast.sh --epic <uuid>
#   ./test-push-fast.sh --timeout 600            # esperar hasta 10 min (default 300s)
#   ./test-push-fast.sh --no-reset               # encola sin resetear (peligroso)
#   ./test-push-fast.sh --help

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────
EPIC_ID="fd82750f-60f1-45c3-ae90-8caf0bf96639"
TIMEOUT_SECONDS=300
SKIP_RESET=false
PSQL_BIN="/opt/homebrew/opt/postgresql@15/bin/psql"
PG_HOST="127.0.0.1"
PG_USER="cenzontle"
PG_DB="cenzontle"
export PGPASSWORD="${PGPASSWORD:-cenzontle_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Args ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --epic)      EPIC_ID="$2"; shift 2 ;;
    --timeout)   TIMEOUT_SECONDS="$2"; shift 2 ;;
    --no-reset)  SKIP_RESET=true; shift ;;
    --help|-h)   sed -n '3,21p' "$0"; exit 0 ;;
    *)           echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Colores ───────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_BOLD=""; C_DIM=""
fi
ok()   { echo "${C_GREEN}✓${C_RESET} $*"; }
fail() { echo "${C_RED}✗${C_RESET} $*"; }
warn() { echo "${C_YELLOW}⚠${C_RESET} $*"; }
hdr()  { echo ""; echo "${C_BOLD}━━━ $* ━━━${C_RESET}"; }

# ── Helpers ───────────────────────────────────────────────────────────────
psql_q() { "$PSQL_BIN" -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"; }
psql_value() { psql_q -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
short_id() { echo "${1:0:8}"; }

# ── Stage 0: precondiciones ───────────────────────────────────────────────
hdr "Stage 0 — Precondiciones"

if ! lsof -i :3001 -P -n 2>/dev/null | grep -q LISTEN; then
  fail "API no está corriendo en :3001. Arrancá 'pnpm dev' primero."
  exit 1
fi
ok "API corriendo en :3001"

WORKER_LINES=$(ps aux 2>/dev/null | grep -E "tsx.*src/cli.ts|factory-worker" | grep -v grep || true)
if [[ -z "$WORKER_LINES" ]]; then
  warn "Worker NO está corriendo. Arrancalo en otra tab con:"
  echo ""
  echo "  cd $(dirname $(dirname $SCRIPT_DIR))"
  echo "  export FACTORY_WORKER_USE_USER_SESSION=1 FACTORY_WORKER_ALLOW_INSECURE=1"
  echo "  export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-..."
  echo "  unset ANTHROPIC_API_KEY"
  echo "  pnpm --filter @cenzontle/worker dev -- start"
  echo ""
  read -r -p "¿Continuar igualmente? (y/N) " ans
  [[ "$ans" =~ ^[yY]$ ]] || exit 0
else
  # Detectar si ALGUNO de los procesos del worker tiene path de worktree.
  # Buscamos `.claude/worktrees/` directamente — más robusto que extraer
  # el path completo (los procesos pueden tener tsx loader sin `apps/worker`).
  if echo "$WORKER_LINES" | grep -q "/.claude/worktrees/"; then
    WORKTREE_NAME=$(echo "$WORKER_LINES" | grep -oE "/\.claude/worktrees/[^/]+" | head -1)
    ok "Worker corre desde WORKTREE (logs nuevos activos): ${C_DIM}${WORKTREE_NAME}${C_RESET}"
  else
    warn "Worker corre desde REPO PRINCIPAL, NO worktree."
    warn "Los logs nuevos (preflight + recovery) NO van a aparecer."
    warn "Sugerido: matá el worker actual y arrancalo desde el worktree."
    read -r -p "¿Continuar igualmente? (y/N) " ans
    [[ "$ans" =~ ^[yY]$ ]] || exit 0
  fi
fi

# Verificar epic existe
if ! psql_value "SELECT id FROM epics WHERE id = '$EPIC_ID'" | grep -q .; then
  fail "Epic '$EPIC_ID' no existe en la BD."
  exit 1
fi
EPIC_TITLE=$(psql_value "SELECT title FROM epics WHERE id = '$EPIC_ID'")
ok "Epic encontrada: $EPIC_TITLE"

STORY_COUNT=$(psql_value "SELECT COUNT(*) FROM stories WHERE \"epicId\" = '$EPIC_ID'")
if [[ "$STORY_COUNT" == "0" ]]; then
  fail "El epic no tiene stories. El worker no tendrá qué procesar."
  exit 1
fi
ok "Stories del epic: $STORY_COUNT"

# ── Stage 1: reset ────────────────────────────────────────────────────────
if ! $SKIP_RESET; then
  hdr "Stage 1 — Reset del state (replay-epic.sh --reset)"
  if [[ -x "$SCRIPT_DIR/replay-epic.sh" ]]; then
    "$SCRIPT_DIR/replay-epic.sh" --reset --epic "$EPIC_ID" 2>&1 | tail -15
  else
    warn "replay-epic.sh no encontrado o no ejecutable, salteando reset"
  fi
else
  warn "--no-reset activo: NO se borraron agent_runs ni branches GitHub previos"
fi

# ── Stage 2: encolar via SQL ──────────────────────────────────────────────
hdr "Stage 2 — Encolar épica via SQL"

BATCH_ID=$(uuidgen | tr 'A-Z' 'a-z')
echo "  batchId nuevo: $BATCH_ID"

psql_q -c "
UPDATE epics
SET \"enqueuedAt\" = NOW(),
    \"enqueuedBatchId\" = '$BATCH_ID',
    \"updatedAt\" = NOW()
WHERE id = '$EPIC_ID';
" >/dev/null

ok "Epic encolada (enqueuedAt = NOW)"
echo "  El worker la va a detectar en su próximo poll (cada 5s)."

# ── Stage 3: monitor en vivo ──────────────────────────────────────────────
hdr "Stage 3 — Monitor de agent_runs (timeout ${TIMEOUT_SECONDS}s)"
echo "  Refrescando cada 2s. Termina cuando hay un run terminal o timeout."
echo ""
printf "  %-10s %-12s %-3s %-44s %-10s %s\n" "RUN_ID" "STATUS" "ATT" "BRANCH" "EXIT" "ERROR (60c)"
echo "  $(printf '─%.0s' {1..120})"

START=$(date +%s)
LAST_SNAPSHOT=""
TERMINAL_REACHED=false

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  if [[ $ELAPSED -ge $TIMEOUT_SECONDS ]]; then
    warn "Timeout (${TIMEOUT_SECONDS}s) alcanzado sin run terminal."
    break
  fi

  # Una línea por run, formato compacto
  SNAPSHOT=$(psql_q -tAc "
SELECT
  LEFT(ar.id, 8) || '|' ||
  ar.status::text || '|' ||
  ar.attempts || '|' ||
  COALESCE(LEFT(ar.branch, 44), '-') || '|' ||
  COALESCE(ar.\"exitCode\"::text, '-') || '|' ||
  COALESCE(LEFT(ar.\"errorMessage\", 60), '')
FROM agent_runs ar
JOIN stories s ON s.id = ar.\"storyId\"
WHERE s.\"epicId\" = '$EPIC_ID'
ORDER BY ar.\"startedAt\" DESC;
" 2>/dev/null)

  if [[ "$SNAPSHOT" != "$LAST_SNAPSHOT" ]]; then
    # Re-imprimir solo cuando hay cambio
    echo ""
    printf "  ${C_DIM}[t+%03ds]${C_RESET}\n" "$ELAPSED"
    while IFS='|' read -r run_id status attempts branch exit_code err; do
      [[ -z "$run_id" ]] && continue
      local_color=""
      case "$status" in
        completed) local_color="$C_GREEN" ;;
        failed|abandoned) local_color="$C_RED" ;;
        running|in_progress|claimed) local_color="$C_YELLOW" ;;
      esac
      printf "  %-10s ${local_color}%-12s${C_RESET} %-3s %-44s %-10s %s\n" \
        "$run_id" "$status" "$attempts" "$branch" "$exit_code" "$err"
    done <<< "$SNAPSHOT"
    LAST_SNAPSHOT="$SNAPSHOT"

    # ¿Algún run en estado terminal?
    if echo "$SNAPSHOT" | awk -F'|' '{print $2}' | grep -qE "^(completed|failed|abandoned)$"; then
      TERMINAL_REACHED=true
      break
    fi
  fi

  sleep 2
done

# ── Stage 4: resumen final ────────────────────────────────────────────────
hdr "Stage 4 — Resumen"

if ! $TERMINAL_REACHED; then
  warn "No se alcanzó estado terminal. El worker puede no estar procesando."
  echo ""
  echo "Diagnóstico sugerido:"
  echo "  1. ¿El worker realmente está corriendo? → pgrep -af 'apps/worker/src/cli'"
  echo "  2. ¿El worker está haciendo poll? → buscá 'claim.poll' en sus logs"
  echo "  3. ¿La épica aparece in-queue? → SELECT enqueuedAt FROM epics WHERE id = '$EPIC_ID'"
  exit 1
fi

echo ""
echo "Estado final de runs del epic:"
psql_q -c "
SELECT LEFT(id, 8) AS run_id, status::text, attempts, branch, \"exitCode\",
       LEFT(\"errorMessage\", 100) AS error,
       \"startedAt\"::time AS started, \"completedAt\"::time AS completed
FROM agent_runs ar
WHERE ar.\"storyId\" IN (SELECT id FROM stories WHERE \"epicId\" = '$EPIC_ID')
ORDER BY \"startedAt\" DESC;
" 2>&1

echo ""
echo "${C_BOLD}Próximos pasos para inspeccionar el push:${C_RESET}"
echo ""
echo "  1. En la terminal del worker, buscá estos eventos en orden:"
echo "       ${C_DIM}grep -E 'git.clone|git.workdir.snapshot|git.push.preflight|git.push' worker.log${C_RESET}"
echo ""
echo "  2. Si ves ${C_GREEN}git.push.preflight.no_origin${C_RESET} → el bug del workdir reapareció"
echo "     Si ves ${C_GREEN}git.push.preflight.recovery_applied${C_RESET} → el auto-fix funcionó"
echo "     Si ves ${C_GREEN}git.push.ok${C_RESET} → el push completó exitosamente"
echo ""
echo "  3. Branches generados en GitHub (si hubo push):"
SHORT=$(short_id "$EPIC_ID")
REPO=$(psql_value "SELECT owner || '/' || repo FROM code_repositories WHERE \"isActive\" = true LIMIT 1")
if [[ -n "$REPO" ]]; then
  echo "       gh api repos/$REPO/branches --jq '.[] | select(.name | startswith(\"forge/epic-$SHORT/\")) | .name'"
fi
