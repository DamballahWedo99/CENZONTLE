#!/usr/bin/env bash
#
# replay-epic.sh — Resetea una épica al estado pre-Forge para poder replayarla
# y observar de nuevo qué hace el worker. Útil para debugging del flow:
#
#   "creó la story → push → consolidación al sprint-batch → preview"
#
# Modos:
#   ./replay-epic.sh                       # Snapshot only (default, no destructivo)
#   ./replay-epic.sh --reset               # Borra agent_runs + branches GitHub + reset stories
#   ./replay-epic.sh --reset --epic <uuid> # Misma operación sobre otra épica
#   ./replay-epic.sh --help
#
# Lo que HACE en --reset:
#   1. Borra todos los agent_runs cuyo storyId pertenezca a esta épica
#   2. Resetea stories a status='backlog', limpia claimedAt
#   3. Borra branches forge/epic-<short8>/* del repo GitHub asociado
#   4. NO toca: epic, stories metadata, initiative, pods, vault
#
# Después de --reset, andá a la UI del epic y dispará "Enqueue to Forge" para
# arrancar un run nuevo limpio. El script imprime el link directo al final.
#
# Requisitos:
#   - psql nativo Homebrew (/opt/homebrew/opt/postgresql@15/bin/psql)
#   - gh CLI autenticado (gh auth status)
#   - PGPASSWORD=cenzontle_dev (exportado o hardcodeado abajo)

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────
EPIC_ID="fd82750f-60f1-45c3-ae90-8caf0bf96639"
RESET=false
DRY_RUN=false
PSQL_BIN="/opt/homebrew/opt/postgresql@15/bin/psql"
PG_HOST="127.0.0.1"
PG_USER="cenzontle"
PG_DB="cenzontle"
export PGPASSWORD="${PGPASSWORD:-cenzontle_dev}"

# ── Args ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset)    RESET=true; shift ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --epic)     EPIC_ID="$2"; shift 2 ;;
    --help|-h)
      sed -n '3,28p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────
psql_q() {
  "$PSQL_BIN" -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"
}

run_sql() {
  local sql="$1"
  if $DRY_RUN; then
    echo "[DRY-RUN] would execute:"
    echo "  $sql"
  else
    psql_q -c "$sql"
  fi
}

short_id() { echo "${1:0:8}"; }

# ── Sanity check ──────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════"
echo "  replay-epic.sh  →  epic $EPIC_ID"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

if ! psql_q -tAc "SELECT 1 FROM epics WHERE id = '$EPIC_ID'" 2>/dev/null | grep -q 1; then
  echo "❌ Epic '$EPIC_ID' no existe en la BD nativa."
  echo "   Verificá la URL en la UI o pasá --epic <uuid> con el id correcto."
  exit 1
fi

# ── Snapshot del estado actual ────────────────────────────────────────────
echo "── Estado actual ─────────────────────────────────────"
psql_q -c "
SELECT
  e.title AS epic_title,
  e.status::text AS epic_status,
  i.name AS initiative,
  (SELECT COUNT(*) FROM stories WHERE \"epicId\" = e.id) AS stories_total,
  (SELECT COUNT(*) FROM stories WHERE \"epicId\" = e.id AND status::text != 'backlog') AS stories_in_progress,
  (SELECT COUNT(*) FROM agent_runs ar JOIN stories s ON s.id = ar.\"storyId\" WHERE s.\"epicId\" = e.id) AS agent_runs_total
FROM epics e LEFT JOIN initiatives i ON i.id = e.\"initiativeId\"
WHERE e.id = '$EPIC_ID';
"

echo ""
echo "── Stories de este epic ──────────────────────────────"
psql_q -c "
SELECT LEFT(id, 8) AS story_id, title, status::text, \"claimedAt\"::timestamp(0)
FROM stories WHERE \"epicId\" = '$EPIC_ID' ORDER BY \"createdAt\";
"

echo ""
echo "── Agent runs previos (los borraremos en --reset) ────"
psql_q -c "
SELECT LEFT(ar.id, 8) AS run_id, ar.status::text, ar.attempts, ar.branch, ar.\"exitCode\"
FROM agent_runs ar JOIN stories s ON s.id = ar.\"storyId\"
WHERE s.\"epicId\" = '$EPIC_ID' ORDER BY ar.\"startedAt\" DESC;
"

# ── Branches GitHub que matchean ──────────────────────────────────────────
SHORT="$(short_id "$EPIC_ID")"
echo ""
echo "── Branches GitHub forge/epic-$SHORT/* ───────────────"
# Detectar repo activo desde code_repositories (primer repo isActive=true)
REPO_OWNER_REPO=$(psql_q -tAc "SELECT owner || '/' || repo FROM code_repositories WHERE \"isActive\" = true LIMIT 1;" 2>/dev/null || echo "")
if [[ -z "$REPO_OWNER_REPO" ]]; then
  echo "  ⚠️  No hay code_repository activo — saltando inspección GitHub."
else
  echo "  repo: $REPO_OWNER_REPO"
  gh api "repos/$REPO_OWNER_REPO/branches" --jq ".[] | select(.name | startswith(\"forge/epic-$SHORT/\")) | .name" 2>/dev/null || echo "  (ninguna)"
fi

# ── Si no es --reset, terminamos acá ──────────────────────────────────────
if ! $RESET; then
  echo ""
  echo "ℹ️  Modo snapshot. Sin --reset no se modifica nada."
  echo ""
  echo "   Para resetear y replayar:"
  echo "     $0 --reset"
  echo ""
  echo "   Para preview sin ejecutar:"
  echo "     $0 --reset --dry-run"
  exit 0
fi

# ── RESET ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  --reset activado  (dry-run=$DRY_RUN)"
echo "═══════════════════════════════════════════════════════════════════"

echo ""
echo "[1/4] Borrando agent_runs de las stories del epic..."
run_sql "
DELETE FROM agent_runs ar
USING stories s
WHERE ar.\"storyId\" = s.id AND s.\"epicId\" = '$EPIC_ID';
"

echo ""
echo "[2/4] Reseteando stories del epic a status='backlog' y limpiando claimedAt..."
run_sql "
UPDATE stories
SET status = 'backlog', \"claimedAt\" = NULL, \"updatedAt\" = NOW()
WHERE \"epicId\" = '$EPIC_ID';
"

echo ""
echo "[3/4] Borrando branches GitHub forge/epic-$SHORT/*..."
if [[ -n "$REPO_OWNER_REPO" ]]; then
  BRANCHES=$(gh api "repos/$REPO_OWNER_REPO/branches" --jq ".[] | select(.name | startswith(\"forge/epic-$SHORT/\")) | .name" 2>/dev/null || echo "")
  if [[ -z "$BRANCHES" ]]; then
    echo "  (ninguna branch que borrar)"
  else
    while IFS= read -r br; do
      [[ -z "$br" ]] && continue
      if $DRY_RUN; then
        echo "  [DRY-RUN] would delete: $br"
      else
        # GitHub: DELETE refs/heads/<branch>
        echo "  borrando: $br"
        gh api -X DELETE "repos/$REPO_OWNER_REPO/git/refs/heads/$br" 2>&1 | head -3 || true
      fi
    done <<< "$BRANCHES"
  fi
else
  echo "  (sin repo activo, skip)"
fi

echo ""
echo "[4/4] Verificación final"
psql_q -c "
SELECT
  (SELECT COUNT(*) FROM agent_runs ar JOIN stories s ON s.id = ar.\"storyId\" WHERE s.\"epicId\" = '$EPIC_ID') AS runs_remaining,
  (SELECT COUNT(*) FROM stories WHERE \"epicId\" = '$EPIC_ID' AND status::text != 'backlog') AS stories_not_backlog;
"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  ✓ Reset completo"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "  Próximo paso: abrí la UI y disparale al Forge:"
echo "  → http://localhost:3000/proyectos/epicas/$EPIC_ID?tab=definicion"
echo ""
echo "  O via API (necesitás un JWT de Auth0 en \$JWT):"
echo "  → curl -X POST http://localhost:3001/api/factory/queue/enqueue/$EPIC_ID \\"
echo "         -H \"Authorization: Bearer \$JWT\""
echo ""
echo "  Mirá los logs del worker filtrando por los eventos nuevos:"
echo "  → tail -f <log> | grep -E 'preflight|snapshot|git.push'"
