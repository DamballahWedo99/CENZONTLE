#!/usr/bin/env bash
#
# create-fast-test-epic.sh — Crea una épica TRIVIAL para validar el flow del
# Forge en ~2-5 minutos en lugar de los 40+ que tarda una story real.
#
# Diseño:
#   - Reutiliza la iniciativa existente "Booking 2.0 (WEB)" como parent
#   - Crea 1 epic + 1 story con prompt mínimo (1 línea de trabajo)
#   - vaultPath = NULL → el worker no intenta leer del vault GitHub
#   - epicMarkdown/storyMarkdown vacíos → prompt corto
#   - El title incluye marker "[FAST-TEST]" para que --cleanup pueda borrarlos
#
# Uso:
#   ./create-fast-test-epic.sh                  # crea epic+story, NO encola
#   ./create-fast-test-epic.sh --enqueue        # crea Y encola al Forge
#   ./create-fast-test-epic.sh --cleanup        # borra TODOS los [FAST-TEST] previos
#   ./create-fast-test-epic.sh --cleanup --enqueue  # cleanup + crear + encolar
#   ./create-fast-test-epic.sh --help
#
# Notas:
#   - El test prompt pide a Claude modificar README.md con un timestamp.
#     Claude tarda ~1-2 min en hacerlo (vs 40min de la story compleja).
#   - El push debe funcionar SIEMPRE: solo modifica README, no toca workflows.
#     Eso confirma que el PAT está OK aunque NO tenga scope `workflow`.
#   - Si después querés un test que SÍ ejerza el bug del workflow, modificá
#     el prompt para que cree .github/workflows/test.yml.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────
DO_ENQUEUE=false
DO_CLEANUP=false
INITIATIVE_ID="6ffecb6d-0b97-483e-b06b-66903b4e781a"  # Booking 2.0 (WEB)
POD_ID="8e1e3cd1-18f4-4f04-ae99-a0cdf5f31df9"          # Prueba
TEST_MARKER="[FAST-TEST]"
PSQL_BIN="/opt/homebrew/opt/postgresql@15/bin/psql"
PG_HOST="127.0.0.1"
PG_USER="cenzontle"
PG_DB="cenzontle"
export PGPASSWORD="${PGPASSWORD:-cenzontle_dev}"

# ── Args ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --enqueue)   DO_ENQUEUE=true; shift ;;
    --cleanup)   DO_CLEANUP=true; shift ;;
    --help|-h)   sed -n '3,25p' "$0"; exit 0 ;;
    *)           echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Colores ───────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_GREEN=""; C_YELLOW=""; C_BOLD=""; C_DIM=""
fi
ok()   { echo "${C_GREEN}✓${C_RESET} $*"; }
warn() { echo "${C_YELLOW}⚠${C_RESET} $*"; }
hdr()  { echo ""; echo "${C_BOLD}━━━ $* ━━━${C_RESET}"; }

psql_q() { "$PSQL_BIN" -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"; }

# ── Cleanup ───────────────────────────────────────────────────────────────
if $DO_CLEANUP; then
  hdr "Cleanup — borrando todas las épicas con marker '$TEST_MARKER'"

  COUNT=$(psql_q -tAc "SELECT COUNT(*) FROM epics WHERE title LIKE '${TEST_MARKER}%';")
  if [[ "$COUNT" == "0" ]]; then
    ok "Nada que limpiar (0 épicas con marker)"
  else
    echo "Encontradas $COUNT épica(s) test. Borrando agent_runs → stories → epics..."
    psql_q -c "
      DELETE FROM agent_runs WHERE \"storyId\" IN (
        SELECT s.id FROM stories s JOIN epics e ON e.id = s.\"epicId\"
        WHERE e.title LIKE '${TEST_MARKER}%'
      );
      DELETE FROM stories WHERE \"epicId\" IN (
        SELECT id FROM epics WHERE title LIKE '${TEST_MARKER}%'
      );
      DELETE FROM epics WHERE title LIKE '${TEST_MARKER}%';
    " 2>&1 | tail -3
    ok "Cleanup completo"
  fi
fi

# ── Crear epic + story ────────────────────────────────────────────────────
hdr "Creando epic trivial '${TEST_MARKER} README timestamp'"

EPIC_ID=$(uuidgen | tr 'A-Z' 'a-z')
STORY_ID=$(uuidgen | tr 'A-Z' 'a-z')
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

EPIC_TITLE="${TEST_MARKER} README timestamp $TIMESTAMP"
STORY_TITLE="${TEST_MARKER} Agregar línea con timestamp al README"

# Validar precondiciones
if ! psql_q -tAc "SELECT 1 FROM initiatives WHERE id = '$INITIATIVE_ID'" | grep -q 1; then
  warn "Iniciativa '$INITIATIVE_ID' no existe. Aborto."
  exit 1
fi
if ! psql_q -tAc "SELECT 1 FROM pods WHERE id = '$POD_ID'" | grep -q 1; then
  warn "Pod '$POD_ID' no existe. Aborto."
  exit 1
fi

# INSERT epic
psql_q -c "
INSERT INTO epics (
  id, title, status, priority,
  \"startDate\", \"targetDate\",
  \"initiativeId\",
  documents, diagrams, dependencies, designs,
  \"createdAt\", \"updatedAt\"
) VALUES (
  '$EPIC_ID',
  '$EPIC_TITLE',
  'in_progress',
  'low',
  NOW(),
  NOW() + INTERVAL '7 days',
  '$INITIATIVE_ID',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  NOW(), NOW()
) RETURNING id, title;
" 2>&1 | tail -3

# INSERT story (vaultPath=NULL para que NO se intente leer del vault)
psql_q -c "
INSERT INTO stories (
  id, title, status, \"storyPoints\",
  \"epicId\", \"podId\",
  \"vaultPath\",
  \"createdAt\", \"updatedAt\"
) VALUES (
  '$STORY_ID',
  '$STORY_TITLE',
  'backlog',
  1,
  '$EPIC_ID',
  '$POD_ID',
  NULL,
  NOW(), NOW()
) RETURNING id, title;
" 2>&1 | tail -3

# Asignar el pod al epic (tabla epic_pods M2M)
psql_q -c "
INSERT INTO epic_pods (\"epicId\", \"podId\") VALUES ('$EPIC_ID', '$POD_ID')
ON CONFLICT DO NOTHING;
" 2>&1 | tail -2

ok "Epic creado: $EPIC_ID"
ok "Story creada: $STORY_ID"

# ── Enqueue ──────────────────────────────────────────────────────────────
if $DO_ENQUEUE; then
  hdr "Encolando al Forge"
  BATCH_ID=$(uuidgen | tr 'A-Z' 'a-z')
  psql_q -c "
UPDATE epics SET
  \"enqueuedAt\" = NOW(),
  \"enqueuedBatchId\" = '$BATCH_ID',
  \"updatedAt\" = NOW()
WHERE id = '$EPIC_ID';
  " 2>&1 | tail -2
  ok "Encolada (batchId: $BATCH_ID). El worker la claim en el próximo poll (≤5s)."
fi

# ── Resumen ─────────────────────────────────────────────────────────────
hdr "Próximos pasos"
echo ""
echo "  Epic ID:  $EPIC_ID"
echo "  Story ID: $STORY_ID"
echo ""
echo "  ${C_BOLD}Ver en la UI:${C_RESET}"
echo "    http://localhost:3000/proyectos/epicas/$EPIC_ID?tab=definicion"
echo ""
if ! $DO_ENQUEUE; then
  echo "  ${C_BOLD}Encolar al Forge:${C_RESET}"
  echo "    $0 --enqueue  # crea otra Y la encola (es un nuevo set, no la actual)"
  echo "    O via SQL:"
  echo "    PGPASSWORD=cenzontle_dev psql -h 127.0.0.1 -U cenzontle -d cenzontle -c \\"
  echo "      \"UPDATE epics SET \\\"enqueuedAt\\\"=NOW(), \\\"enqueuedBatchId\\\"='\$(uuidgen)' WHERE id='$EPIC_ID';\""
  echo ""
fi
echo "  ${C_BOLD}Monitorear runs en vivo (cada 2s, hasta terminal):${C_RESET}"
echo "    while true; do clear; PGPASSWORD=cenzontle_dev $PSQL_BIN -h 127.0.0.1 -U cenzontle -d cenzontle -c \\"
echo "      \"SELECT LEFT(id,8) AS run, status::text, attempts, branch, \\\"exitCode\\\" FROM agent_runs ar JOIN stories s ON s.id=ar.\\\"storyId\\\" WHERE s.\\\"epicId\\\"='$EPIC_ID';\"; sleep 2; done"
echo ""
echo "  ${C_BOLD}Cleanup cuando termines:${C_RESET}"
echo "    $0 --cleanup"
echo ""
echo "  ${C_DIM}Tip: este script imprime los IDs UUIDs únicos cada vez. Si vas a iterar, guardá los IDs.${C_RESET}"
