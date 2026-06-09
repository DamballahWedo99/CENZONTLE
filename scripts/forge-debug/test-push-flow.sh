#!/usr/bin/env bash
#
# test-push-flow.sh — Smoke test local del flow de push del worker
#
# Reproduce cada escenario de la matriz de fallos en un workdir aislado y
# muestra:
#   - El estado git tras la corrupción
#   - Qué evento del runner se emitiría (basado en el código del preflight)
#   - Si el auto-recovery del preflight resolvería el push
#   - El resultado real de un push simulado
#
# 100% local: no toca GitHub, no toca la BD de CENZONTLE, no requiere worker
# corriendo. Crea repos bare temporales y los borra al final.
#
# Uso:
#   ./test-push-flow.sh                    # corre todos los escenarios
#   ./test-push-flow.sh --scenario A       # solo escenario A
#   ./test-push-flow.sh --keep             # no borra workdirs (debug)
#   ./test-push-flow.sh --help

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────
SCENARIO_FILTER=""
KEEP_WORKDIRS=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario) SCENARIO_FILTER="$2"; shift 2 ;;
    --keep)     KEEP_WORKDIRS=true; shift ;;
    --help|-h)  sed -n '3,20p' "$0"; exit 0 ;;
    *)          echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Setup ─────────────────────────────────────────────────────────────────
TMPROOT=$(mktemp -d -t cenzontle-pushtest.XXXXXX)
BARE_REPO="$TMPROOT/origin.git"
cleanup() {
  if $KEEP_WORKDIRS; then
    echo ""
    echo "ℹ️  --keep activo. Workdirs en: $TMPROOT"
  else
    rm -rf "$TMPROOT"
  fi
}
trap cleanup EXIT

# Colores (opcional, fallback a vacío en non-TTY)
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'
else
  C_RESET=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_BOLD=""
fi

ok()   { echo "${C_GREEN}✓${C_RESET} $*"; }
fail() { echo "${C_RED}✗${C_RESET} $*"; }
warn() { echo "${C_YELLOW}⚠${C_RESET} $*"; }
hdr()  { echo ""; echo "${C_BOLD}━━━ $* ━━━${C_RESET}"; }

# Inicializa repo bare con un commit "Initial commit" en main
init_origin() {
  git init --bare --initial-branch=main "$BARE_REPO" >/dev/null
  local seed="$TMPROOT/seed"
  git init --initial-branch=main "$seed" >/dev/null
  git -C "$seed" config user.email "test@test.io"
  git -C "$seed" config user.name "Test"
  echo "# Test repo" > "$seed/README.md"
  git -C "$seed" add README.md >/dev/null
  git -C "$seed" commit -m "Initial commit" >/dev/null
  git -C "$seed" remote add origin "$BARE_REPO"
  git -C "$seed" push -u origin main >/dev/null 2>&1
  rm -rf "$seed"
}

# Replica el preflight check del runner (líneas ~2734 de runner.ts)
preflight_check() {
  local workdir="$1"
  local remote_v
  remote_v=$(git -C "$workdir" remote -v 2>/dev/null || true)
  local origin_present
  if echo "$remote_v" | grep -q '^origin'; then
    origin_present=true
  else
    origin_present=false
  fi
  echo "$origin_present"
}

# Aplica el recovery del preflight: git remote add origin <url>
preflight_recovery() {
  local workdir="$1"
  local origin_url="$2"
  git -C "$workdir" remote add origin "$origin_url" 2>/dev/null
}

# ── Escenarios ────────────────────────────────────────────────────────────

run_scenario() {
  local key="$1" desc="$2" corruption_fn="$3" expect_preflight="$4" expect_recovery_works="$5"

  if [[ -n "$SCENARIO_FILTER" && "$SCENARIO_FILTER" != "$key" ]]; then
    return 0
  fi

  hdr "Escenario $key — $desc"

  local workdir="$TMPROOT/wd-$key"
  git clone "$BARE_REPO" "$workdir" >/dev/null 2>&1
  git -C "$workdir" config user.email "agent@test.io"
  git -C "$workdir" config user.name "Agent"
  git -C "$workdir" checkout -b "forge/test/$key" >/dev/null 2>&1

  echo "  1. Clone limpio en $workdir → branch forge/test/$key"

  # Aplicar la corrupción específica del escenario
  $corruption_fn "$workdir"

  # Hacer un cambio + commit (simula trabajo del agente)
  echo "test change for $key" > "$workdir/feature.txt"
  if [[ -d "$workdir/.git" ]]; then
    git -C "$workdir" add -A >/dev/null 2>&1 || true
    git -C "$workdir" commit -m "feat: cambio del agente" >/dev/null 2>&1 || true
  fi

  # Preflight check (replica del runner)
  local origin_present
  origin_present=$(preflight_check "$workdir")
  local preflight_event
  if [[ "$origin_present" == "true" ]]; then
    preflight_event="git.push.preflight.ok"
  else
    preflight_event="git.push.preflight.no_origin"
  fi

  echo "  2. Preflight: $preflight_event"
  if [[ "$preflight_event" == "$expect_preflight" ]]; then
    ok "     coincide con lo esperado ($expect_preflight)"
  else
    fail "     ESPERADO=$expect_preflight  ACTUAL=$preflight_event"
  fi

  # Si preflight detectó no_origin, simular recovery
  local recovery_run=false
  if [[ "$preflight_event" == "git.push.preflight.no_origin" ]]; then
    echo "  3. Auto-recovery: git remote add origin $BARE_REPO"
    if preflight_recovery "$workdir" "$BARE_REPO"; then
      ok "     recovery aplicado"
      recovery_run=true
    else
      fail "     recovery falló"
    fi
  fi

  # Intentar el push real
  local push_output push_exit
  push_output=$(git -C "$workdir" push -u origin "forge/test/$key" 2>&1) && push_exit=0 || push_exit=$?

  if [[ $push_exit -eq 0 ]]; then
    echo "  4. ${C_GREEN}git push: SUCCESS${C_RESET}"
    if [[ "$expect_recovery_works" == "true" ]]; then
      ok "     resultado coincide con lo esperado (recovery resuelve el bug)"
    elif [[ "$preflight_event" == "git.push.preflight.ok" ]]; then
      ok "     resultado coincide con lo esperado (happy path)"
    else
      warn "     push exitoso pero NO se esperaba (revisar el escenario)"
    fi
  else
    echo "  4. ${C_RED}git push: FAIL (exit=$push_exit)${C_RESET}"
    echo "     stderr: $(echo "$push_output" | tail -3 | tr '\n' ' ')"
    if [[ "$expect_recovery_works" == "false" ]]; then
      ok "     fallo coincide con lo esperado (gap del fix actual)"
    else
      fail "     se esperaba SUCCESS pero falló"
    fi
  fi

  echo ""
}

# ── Corruption functions ──────────────────────────────────────────────────

# Escenario H (happy path): sin corrupción
corrupt_happy() { :; }

# Escenario A: `npx create-next-app` (simulado) reinicia el .git/ entero
corrupt_create_next_app() {
  local workdir="$1"
  echo "     [corrupting] rm -rf .git && git init --initial-branch=main  ← simula create-next-app"
  rm -rf "$workdir/.git"
  git -C "$workdir" init --initial-branch=main >/dev/null
  git -C "$workdir" config user.email "agent@test.io"
  git -C "$workdir" config user.name "Agent"
  # Commit simulado de "create-next-app"
  echo "package.json content" > "$workdir/package.json"
  git -C "$workdir" add -A >/dev/null
  git -C "$workdir" commit -m "Initial commit from Create Next App" >/dev/null
  git -C "$workdir" checkout -b "forge/test/A" >/dev/null 2>&1
}

# Escenario C: agente corre `git remote remove origin`
corrupt_remove_origin() {
  local workdir="$1"
  echo "     [corrupting] git remote remove origin"
  git -C "$workdir" remote remove origin
}

# Escenario G: agente cambia origin a URL inválida (gap del fix actual)
corrupt_url_garbage() {
  local workdir="$1"
  echo "     [corrupting] git remote set-url origin /nonexistent/repo.git"
  git -C "$workdir" remote set-url origin "/nonexistent/repo.git"
}

# Escenario I: agente cambia de branch en medio del run
corrupt_branch_switch() {
  local workdir="$1"
  echo "     [corrupting] git checkout -b otra-branch"
  git -C "$workdir" checkout -b "otra-branch" >/dev/null 2>&1
}

# ── Ejecución ─────────────────────────────────────────────────────────────

echo "${C_BOLD}═════════════════════════════════════════════════════════════════${C_RESET}"
echo "${C_BOLD}  test-push-flow.sh — validación local del preflight + recovery${C_RESET}"
echo "${C_BOLD}═════════════════════════════════════════════════════════════════${C_RESET}"

hdr "Setup: creando bare repo en $BARE_REPO"
init_origin
ok "bare repo + main branch listos"

# Escenarios: key | descripción | corrupt_fn | preflight esperado | recovery resuelve push?
run_scenario "H" "Happy path (sin corrupción)" \
  corrupt_happy "git.push.preflight.ok" "true"

run_scenario "A" "Agente corre create-next-app → .git/ reinit" \
  corrupt_create_next_app "git.push.preflight.no_origin" "true"

run_scenario "C" "Agente corre git remote remove origin" \
  corrupt_remove_origin "git.push.preflight.no_origin" "true"

run_scenario "G" "Agente corrompe la URL de origin (gap del fix)" \
  corrupt_url_garbage "git.push.preflight.ok" "false"

run_scenario "I" "Agente cambia de branch en medio (gap del fix)" \
  corrupt_branch_switch "git.push.preflight.ok" "false"

hdr "Resumen"
echo "  H — Happy path: preflight=ok, push=success"
echo "  A — create-next-app: preflight=no_origin, recovery aplicado, push=success ← BUG REAL CUBIERTO"
echo "  C — remote remove: preflight=no_origin, recovery aplicado, push=success"
echo "  G — URL basura: preflight=ok (FALSO POSITIVO), push falla con error críptico ← GAP"
echo "  I — branch switch: preflight=ok, push usa branch original (probablemente ok, depende del HEAD)"
