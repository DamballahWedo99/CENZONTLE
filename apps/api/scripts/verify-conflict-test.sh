#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════
# verify-conflict-test.sh — validación POST-merge del ConflictResolverService
# ═════════════════════════════════════════════════════════════════════════
#
# Reemplaza la "story V verifier" del seed previo (que costaba $1-2 USD en
# verifier LLM calls) por un script bash que cuesta $0 — usa gh CLI para
# descargar los archivos del sprint-batch branch y grep para confirmar que
# el ConflictResolverService produjo el outcome esperado.
#
# Usage:
#   REPO=<owner>/<repo> bash apps/api/scripts/verify-conflict-test.sh <BATCH_EPIC_ID_PREFIX>
#
#   REPO es OBLIGATORIO: el repositorio contra el que corrió el seed, en
#   formato `owner/repo`. No hay default — el script falla si no lo pasas.
#
#   El argumento es el prefix (primeros 8 chars) del epic.id que el seed
#   imprime al final: `epic.id.slice(0, 8)`. Ese prefix es el sufijo de
#   la branch del sprint-batch: `forge/sprint-batch-<PREFIX>`.
#
# Ejemplo:
#   REPO=mi-org/mi-app bash apps/api/scripts/verify-conflict-test.sh f66d7389
#
# Requiere:
#   - gh CLI autenticado al repo target indicado en REPO
#   - Los 4 PRs del seed minimal deben estar mergueados en el sprint-batch
#
# Exit codes:
#   0 — ambas capas PASS
#   1 — Capa A fail (line-union no preservó ambas líneas)
#   2 — Capa B fail (Sonnet semantic no preservó ambos markers)
#   3 — ambas fallaron
#   4 — error de pre-requisitos (gh CLI, branch no existe, etc.)
# ═════════════════════════════════════════════════════════════════════════

set -u  # error si var no seteada; NO usamos `set -e` porque queremos seguir
        # ejecutando todas las checks aunque alguna falle.

# ─── Config ────────────────────────────────────────────────────────────────
REPO="${REPO:-}"
PREFIX="${1:-}"

if [[ -z "$REPO" ]]; then
  echo "❌ Falta la variable de entorno REPO (obligatoria, sin default)."
  echo "   Indica el repositorio target en formato owner/repo:"
  echo "   REPO=mi-org/mi-app $0 <BATCH_EPIC_ID_PREFIX>"
  echo ""
  echo "   Ejemplo: REPO=mi-org/mi-app $0 f66d7389"
  exit 4
fi

# Validar formato de REPO. Sin esto, un typo (p. ej. `mi-app` sin owner) llega
# hasta `gh api` y aborta con "Branch no encontrada", mandando a depurar el
# seed en vez del valor mal escrito.
if [[ ! "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "❌ REPO inválido: '$REPO'. Esperado formato owner/repo (e.g. mi-org/mi-app)."
  exit 4
fi

if [[ -z "$PREFIX" ]]; then
  echo "❌ Uso: $0 <BATCH_EPIC_ID_PREFIX>"
  echo "   Ejemplo: $0 f66d7389"
  echo ""
  echo "   El prefix es los primeros 8 chars del epic.id que el seed imprimió."
  exit 4
fi

# Validar formato del prefix (8 chars hex)
if [[ ! "$PREFIX" =~ ^[a-f0-9]{8}$ ]]; then
  echo "❌ Prefix inválido: '$PREFIX'. Esperado 8 chars hex (e.g. f66d7389)."
  exit 4
fi

BRANCH="forge/sprint-batch-${PREFIX}"

echo "═══════════════════════════════════════════════════════════════════"
echo "  ConflictResolverService validation — sprint-batch ${PREFIX}"
echo "═══════════════════════════════════════════════════════════════════"
echo "  Repo:   ${REPO}"
echo "  Branch: ${BRANCH}"
echo ""

# ─── Pre-flight: gh CLI disponible ────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "❌ gh CLI no encontrado en PATH. Instala: brew install gh"
  exit 4
fi

# ─── Pre-flight: branch existe ────────────────────────────────────────────
echo "→ Verificando que la branch existe..."
if ! gh api "repos/${REPO}/branches/${BRANCH}" --silent 2>/dev/null; then
  echo "❌ Branch '${BRANCH}' no encontrada en ${REPO}."
  echo ""
  echo "   Posibles causas:"
  echo "   - El seed no se corrió (no hay epic con ese prefix)."
  echo "   - Ningún PR mergueó al sprint-batch (el primer merge crea la branch)."
  echo "   - El prefix está mal."
  echo ""
  echo "   Inspecciona PRs abiertos del epic:"
  echo "   gh pr list --repo ${REPO} --search '${PREFIX}' --state all"
  exit 4
fi
echo "  ✓ Branch existe"
echo ""

# ─── Listar PRs mergueados para forensics ─────────────────────────────────
echo "→ PRs mergueados al sprint-batch:"
gh pr list --repo "${REPO}" --base "${BRANCH}" --state merged \
  --json number,title,mergedAt \
  --jq '.[] | "  ✓ #\(.number) merged \(.mergedAt) — \(.title)"' \
  2>/dev/null || echo "  (ninguno todavía mergueado — el resolver no ha corrido)"
echo ""

# ─── Capa A check: .gitignore tiene AMBAS líneas ─────────────────────────
echo "═══════════════════════════════════════════════════════════════════"
echo "  Capa A — line-union deterministic (.gitignore)"
echo "═══════════════════════════════════════════════════════════════════"

gitignore_content=""
gitignore_fetch_ok=0
if gitignore_b64=$(gh api "repos/${REPO}/contents/.gitignore?ref=${BRANCH}" --jq '.content' 2>/dev/null); then
  gitignore_content=$(echo "$gitignore_b64" | base64 -d 2>/dev/null || echo "")
  gitignore_fetch_ok=1
fi

if [[ $gitignore_fetch_ok -eq 0 ]]; then
  echo "❌ No se pudo leer .gitignore del branch ${BRANCH}."
  echo "   (¿el repo no tiene .gitignore? ¿el branch no existe?)"
  capa_a_pass=0
else
  has_a1=0
  has_a2=0
  echo "$gitignore_content" | grep -qE "^# CENZONTLE-A1\s*$" && has_a1=1
  echo "$gitignore_content" | grep -qE "^# CENZONTLE-A2\s*$" && has_a2=1

  echo "  Marker '# CENZONTLE-A1' presente: $([ $has_a1 -eq 1 ] && echo '✓ SÍ' || echo '✗ NO')"
  echo "  Marker '# CENZONTLE-A2' presente: $([ $has_a2 -eq 1 ] && echo '✓ SÍ' || echo '✗ NO')"

  if [[ $has_a1 -eq 1 && $has_a2 -eq 1 ]]; then
    capa_a_pass=1
    echo ""
    echo "  ✅ Capa A PASS — ambos markers están en .gitignore post-merge."
    echo "     → El ConflictResolverService.tryResolveFileLayerA() resolvió"
    echo "       el conflict en texto plano (line-union strategy) correctamente."
  else
    capa_a_pass=0
    echo ""
    echo "  ❌ Capa A FAIL — falta al menos un marker en .gitignore."
    echo ""
    echo "  Diagnóstico posible:"
    echo "    - Solo 1 PR mergueó (no hubo conflict real → resolver no corrió)."
    echo "    - El resolver corrió pero su line-union descartó uno de los markers."
    echo "    - El segundo PR fue cerrado sin merge."
    echo ""
    echo "  Logs API a buscar:"
    echo "    grep 'conflict_resolver.*\.gitignore' <api-logs>"
  fi
fi
echo ""

# ─── Capa B check: MERGE_TEST.md tiene AMBOS markers ─────────────────────
echo "═══════════════════════════════════════════════════════════════════"
echo "  Capa B — Sonnet semantic judge (MERGE_TEST.md)"
echo "═══════════════════════════════════════════════════════════════════"

md_content=""
md_fetch_ok=0
if md_b64=$(gh api "repos/${REPO}/contents/MERGE_TEST.md?ref=${BRANCH}" --jq '.content' 2>/dev/null); then
  md_content=$(echo "$md_b64" | base64 -d 2>/dev/null || echo "")
  md_fetch_ok=1
fi

if [[ $md_fetch_ok -eq 0 ]]; then
  echo "❌ No se pudo leer MERGE_TEST.md del branch ${BRANCH}."
  echo "   (los PRs B1/B2 no mergueon, o el resolver lo borró)"
  capa_b_pass=0
else
  has_b1=0
  has_b2=0
  echo "$md_content" | grep -qF "B1-OK" && has_b1=1
  echo "$md_content" | grep -qF "B2-OK" && has_b2=1

  echo "  Marker 'B1-OK' presente: $([ $has_b1 -eq 1 ] && echo '✓ SÍ' || echo '✗ NO')"
  echo "  Marker 'B2-OK' presente: $([ $has_b2 -eq 1 ] && echo '✓ SÍ' || echo '✗ NO')"

  if [[ $has_b1 -eq 1 && $has_b2 -eq 1 ]]; then
    capa_b_pass=1
    echo ""
    echo "  ✅ Capa B PASS — ambos markers están en MERGE_TEST.md post-merge."
    echo "     → El ConflictResolverService.tryResolveFileLayerB() invocó"
    echo "       a Sonnet 4.6 y produjo un merge semántico integrando ambas"
    echo "       contribuciones (B1 + B2)."
  else
    capa_b_pass=0
    echo ""
    echo "  ❌ Capa B FAIL — falta al menos un marker en MERGE_TEST.md."
    echo ""
    echo "  Diagnóstico posible:"
    echo "    - Sonnet eligió un side del conflict y descartó el otro (no integró)."
    echo "    - Capa A respondió 'supported' por error para .md y resolvió mal."
    echo "    - Solo 1 PR mergueó (no hubo conflict real)."
    echo ""
    echo "  Logs API a buscar:"
    echo "    grep 'conflict_resolver.*MERGE_TEST' <api-logs>"
    echo "    grep 'forge.conflict_resolver.layer_b' <api-logs>"
  fi

  # Mostrar contenido para forensics si falló
  if [[ $capa_b_pass -eq 0 ]]; then
    echo ""
    echo "  Contenido actual de MERGE_TEST.md (primeras 30 líneas):"
    echo "  ┌─────────────────────────────────────────────"
    echo "$md_content" | head -30 | sed 's/^/  │ /'
    echo "  └─────────────────────────────────────────────"
  fi
fi
echo ""

# ─── Resumen final + exit code ────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════"
echo "  RESUMEN"
echo "═══════════════════════════════════════════════════════════════════"
printf "  Capa A (deterministic line-union):    %s\n" "$([ ${capa_a_pass:-0} -eq 1 ] && echo '✅ PASS' || echo '❌ FAIL')"
printf "  Capa B (Sonnet semantic judge):       %s\n" "$([ ${capa_b_pass:-0} -eq 1 ] && echo '✅ PASS' || echo '❌ FAIL')"
echo ""

# Compute exit code
if [[ ${capa_a_pass:-0} -eq 1 && ${capa_b_pass:-0} -eq 1 ]]; then
  echo "🎉 ConflictResolverService VALIDADO end-to-end. Listo para escalar"
  echo "   a stories reales (Popocatépetl) con confianza."
  exit 0
elif [[ ${capa_a_pass:-0} -eq 0 && ${capa_b_pass:-0} -eq 0 ]]; then
  echo "💥 AMBAS capas fallaron — bug serio en el resolver o el seed no se"
  echo "   ejecutó correctamente (PRs no mergueon)."
  exit 3
elif [[ ${capa_a_pass:-0} -eq 0 ]]; then
  echo "⚠️  Capa A falló — investigar lineUnionMerge en conflict-resolver.service.ts"
  exit 1
else
  echo "⚠️  Capa B falló — investigar tryResolveFileLayerB (Sonnet judge prompt)"
  exit 2
fi
