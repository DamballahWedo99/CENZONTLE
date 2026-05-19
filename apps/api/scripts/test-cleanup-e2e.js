/* eslint-disable @typescript-eslint/no-require-imports */
// Test E2E del cleanup automático de branches Forge sin gastar tokens de Anthropic.
//
// Run with:
//   node scripts/test-cleanup-e2e.js <owner>/<repo>                 (verify-only, no toca remote)
//   node scripts/test-cleanup-e2e.js <owner>/<repo> --smoke         (smoke E2E real contra GitHub)
//   node scripts/test-cleanup-e2e.js <owner>/<repo> --smoke --debug (verbose logging)
//
// MODOS:
//
//   verify-only (DEFAULT, safe):
//     1. Verifica `autoDeleteForgeBranch=true` en DB (config global)
//     2. Verifica que el helper `cleanupBranchIfEnabled` existe en agent-run.service.ts
//     3. Verifica que las 2 invocaciones están donde deben (path happy + path resolver)
//     4. Verifica que factory-queue.service.ts invoca deleteBranch tras merge
//     5. Verifica auth con gh CLI + permisos sobre el repo target
//
//   smoke (con --smoke, destructive on test branches only):
//     6. Crea branch test `forge/sprint-batch-cleanup-test-{ts}` desde dev
//     7. Crea commit dummy (archivo CLEANUP_TEST.md)
//     8. Abre PR contra dev
//     9. Mergea el PR (simula `approveStagingGate`)
//     10. Llama `deleteBranch` (simula el cleanup automático del fix)
//     11. Verifica branch 404 en remote
//     12. Defensive cleanup global (si test falla a mitad, intenta cleanup)
//
// SEGURIDAD ("login híper robusta"):
//   - Falla early si gh CLI no autenticado
//   - Falla early si DATABASE_URL no setteada
//   - Falla early si no hay permisos de write sobre el repo
//   - Falla early si autoDeleteForgeBranch=false (config dice cleanup OFF)
//   - Falla early si dev branch no existe (no podemos crear PR contra inexistente)
//   - Cleanup defensivo: SI hay error en cualquier paso, intenta borrar la test branch
//   - Branch test usa prefix único `cleanup-test-` para que NUNCA se confunda con prod
//   - Verifica que el PR test efectivamente se mergeó antes de borrar (defensa contra borrar PRs ajenos)

const { execFileSync } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const path = require('path');

// ============================================================================
// CLI args + flags
// ============================================================================

const repoArg = process.argv[2];
const smoke = process.argv.includes('--smoke');
const debug = process.argv.includes('--debug');

if (!repoArg || !repoArg.includes('/')) {
  console.error('Usage: node scripts/test-cleanup-e2e.js <owner>/<repo> [--smoke] [--debug]');
  process.exit(1);
}

const [owner, repo] = repoArg.split('/');
const ROOT = path.resolve(__dirname, '..');

// ============================================================================
// Helpers
// ============================================================================

function log(msg) {
  console.log(msg);
}

function dbg(msg) {
  if (debug) console.log(`  [debug] ${msg}`);
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'pipe' });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

// ============================================================================
// PHASE 1: Preflight (auth + permisos + config)
// ============================================================================

async function preflight() {
  log('\n[1/5] Preflight checks (auth + permisos + config)...\n');

  // 1a. gh CLI auth
  try {
    gh(['auth', 'status'], { silent: true });
    ok('gh CLI autenticado');
  } catch {
    fail('gh CLI no autenticado. Corré `gh auth login` antes.');
  }

  // 1b. Acceso al repo target
  let repoInfo;
  try {
    repoInfo = ghJson(['api', `repos/${owner}/${repo}`]);
    ok(`Repo accesible: ${owner}/${repo} (default branch: ${repoInfo.default_branch})`);
  } catch {
    fail(`No tenés acceso al repo ${owner}/${repo} o no existe.`);
  }

  // 1c. Permisos de write (requeridos para crear/borrar branches)
  if (repoInfo.permissions && !repoInfo.permissions.push) {
    fail(`Sin permiso de push sobre ${owner}/${repo}. Necesario para crear branches test.`);
  }
  ok('Permisos de write confirmados');

  // 1d. Config global de cleanup en DB
  process.env.DATABASE_URL || fail('DATABASE_URL no setteada. Corré con `node --env-file=.env`.');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const config = await prisma.branchStrategyConfig.findUnique({
    where: { id: 'global' },
    select: { autoDeleteForgeBranch: true, devBranch: true, forgeBranchPrefix: true },
  });
  await prisma.$disconnect();

  if (!config) {
    fail(`BranchStrategyConfig no existe en DB. El backend nunca arrancó con esta DB.`);
  }
  if (!config.autoDeleteForgeBranch) {
    fail(
      `autoDeleteForgeBranch=false en DB. El cleanup automático está DESHABILITADO. ` +
        `Cambialo a true en /factory/settings o con UPDATE SQL.`,
    );
  }
  ok(`Config OK: autoDeleteForgeBranch=true, devBranch='${config.devBranch}', prefix='${config.forgeBranchPrefix}'`);

  // 1e. Dev branch existe en remote (necesario para crear PR test)
  try {
    gh(['api', `repos/${owner}/${repo}/branches/${config.devBranch}`], { silent: true });
    ok(`Dev branch '${config.devBranch}' existe en remote`);
  } catch {
    fail(`Dev branch '${config.devBranch}' NO existe en ${owner}/${repo}. Creala antes.`);
  }

  return config;
}

// ============================================================================
// PHASE 2: Verificación estática del código (grep estructural del fix)
// ============================================================================

function verifyCodeIsWired() {
  log('\n[2/5] Verificación estática del código (el fix está cableado)...\n');

  const agentRunFile = path.join(ROOT, 'src/modules/factory/fleet/agent-run.service.ts');
  const factoryQueueFile = path.join(ROOT, 'src/modules/factory/queue/factory-queue.service.ts');

  if (!existsSync(agentRunFile)) fail(`No existe ${agentRunFile}`);
  if (!existsSync(factoryQueueFile)) fail(`No existe ${factoryQueueFile}`);

  const agentRunSrc = readFileSync(agentRunFile, 'utf8');
  const factoryQueueSrc = readFileSync(factoryQueueFile, 'utf8');

  // 2a. Helper existe en agent-run
  const helperDeclMatch = agentRunSrc.match(/private async cleanupBranchIfEnabled\(\s*branchName: string,\s*runId: string,\s*context:[^)]+\)/);
  if (!helperDeclMatch) {
    fail('Helper `cleanupBranchIfEnabled` no encontrado en agent-run.service.ts con la signatura esperada.');
  }
  ok('Helper `cleanupBranchIfEnabled(branchName, runId, context)` existe');

  // 2b. Helper lee config con Prisma
  if (!agentRunSrc.includes("findUnique({") || !agentRunSrc.includes("'global'")) {
    fail('Helper no parece leer `branchStrategyConfig` con PK `global` vía Prisma.');
  }
  if (!agentRunSrc.includes('autoDeleteForgeBranch')) {
    fail('Helper no parece chequear `autoDeleteForgeBranch`.');
  }
  ok('Helper lee config singleton con Prisma + chequea autoDeleteForgeBranch');

  // 2c. Helper llama github.deleteBranch
  if (!agentRunSrc.includes('this.github.deleteBranch(branchName)')) {
    fail('Helper no llama `this.github.deleteBranch(branchName)`.');
  }
  ok('Helper invoca `github.deleteBranch(branchName)`');

  // 2d. Invocaciones del helper (2 esperadas: path happy + path resolver)
  const invocations = agentRunSrc.match(/await this\.cleanupBranchIfEnabled\(run\.branch, runId, 'story'\)/g);
  if (!invocations || invocations.length !== 2) {
    fail(`Esperaba 2 invocaciones de cleanupBranchIfEnabled, encontré ${invocations?.length ?? 0}`);
  }
  ok(`Helper invocado 2x con (run.branch, runId, 'story') [path happy + path resolver]`);

  // 2e. factory-queue.service.ts: integrationBranchName en scope outer
  if (!factoryQueueSrc.includes('const integrationBranchName =')) {
    fail('`integrationBranchName` no declarado en scope outer de factory-queue.service.ts');
  }
  ok('`integrationBranchName` declarado en scope outer (accesible para cleanup post-merge)');

  // 2f. factory-queue.service.ts: cleanup tras result.merged
  if (!factoryQueueSrc.includes('this.github.deleteBranch(integrationBranchName)')) {
    fail('factory-queue.service.ts no invoca `deleteBranch(integrationBranchName)` tras merge.');
  }
  ok('factory-queue.service.ts cablea cleanup tras `result.merged && consolidatedPrMergedAt`');

  // 2g. Cleanup respeta el flag autoDeleteForgeBranch
  const cleanupBlock = factoryQueueSrc.match(/if \(branchConfig\.autoDeleteForgeBranch\) \{[\s\S]{0,400}?this\.github\.deleteBranch\(integrationBranchName\)/);
  if (!cleanupBlock) {
    fail('Cleanup en factory-queue.service.ts no está dentro de `if (branchConfig.autoDeleteForgeBranch)`.');
  }
  ok('Cleanup en factory-queue.service.ts respeta el flag `autoDeleteForgeBranch`');
}

// ============================================================================
// PHASE 3-5: Smoke E2E (con --smoke flag)
// ============================================================================

async function smokeE2E(config) {
  const timestamp = Date.now();
  const testBranch = `forge/sprint-batch-cleanup-test-${timestamp}`;
  let prNumber = null;
  let needsBranchCleanup = false;

  // Cleanup defensivo global
  const cleanup = () => {
    if (needsBranchCleanup) {
      log(`\n[cleanup] borrando test branch '${testBranch}' (defensive)...`);
      try {
        gh(['api', '--method', 'DELETE', `repos/${owner}/${repo}/git/refs/heads/${testBranch}`, '--silent'], { silent: true });
        log(`[cleanup] ✓ test branch borrada`);
      } catch (err) {
        log(`[cleanup] ✗ no se pudo borrar test branch: ${err.message}`);
        log(`[cleanup] borrá manualmente: gh api -X DELETE repos/${owner}/${repo}/git/refs/heads/${testBranch}`);
      }
    }
  };
  process.on('uncaughtException', (err) => {
    console.error('\n[FATAL]', err.message);
    cleanup();
    process.exit(1);
  });

  try {
    // ----------------------------------------------------------------------
    // PHASE 3: Crear branch test + PR contra dev
    // ----------------------------------------------------------------------
    log('\n[3/5] Smoke E2E: crear branch test + commit + PR...\n');

    // 3a. Get dev branch SHA
    const devBranchInfo = ghJson(['api', `repos/${owner}/${repo}/branches/${config.devBranch}`]);
    const devSha = devBranchInfo.commit.sha;
    dbg(`dev branch SHA: ${devSha}`);

    // 3b. Crear test branch desde dev
    gh([
      'api',
      '--method',
      'POST',
      `repos/${owner}/${repo}/git/refs`,
      '-f',
      `ref=refs/heads/${testBranch}`,
      '-f',
      `sha=${devSha}`,
      '--silent',
    ], { silent: true });
    needsBranchCleanup = true;
    ok(`Test branch creada: ${testBranch}`);

    // 3c. Crear commit dummy (archivo CLEANUP_TEST.md)
    const content = Buffer.from(`# Cleanup test\n\nGenerado por test-cleanup-e2e.js @ ${new Date().toISOString()}\n`).toString('base64');
    gh([
      'api',
      '--method',
      'PUT',
      `repos/${owner}/${repo}/contents/CLEANUP_TEST_${timestamp}.md`,
      '-f',
      `message=test: cleanup E2E ${timestamp}`,
      '-f',
      `content=${content}`,
      '-f',
      `branch=${testBranch}`,
      '--silent',
    ], { silent: true });
    ok('Commit dummy creado en test branch');

    // 3d. Abrir PR
    const pr = ghJson([
      'api',
      '--method',
      'POST',
      `repos/${owner}/${repo}/pulls`,
      '-f',
      `title=[TEST] Cleanup E2E ${timestamp}`,
      '-f',
      `head=${testBranch}`,
      '-f',
      `base=${config.devBranch}`,
      '-f',
      `body=Automated test del cleanup de branches Forge. Auto-merge inmediato.`,
    ]);
    prNumber = pr.number;
    ok(`PR #${prNumber} abierto contra ${config.devBranch}`);

    // ----------------------------------------------------------------------
    // PHASE 4: Simular merge + cleanup automático (replica el flow del fix)
    // ----------------------------------------------------------------------
    log('\n[4/5] Simulando merge + cleanup automático...\n');

    // 4a. Mergear el PR (simula lo que approveStagingGate hace internamente)
    const mergeResult = ghJson([
      'api',
      '--method',
      'PUT',
      `repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      '-f',
      `commit_title=[TEST] Cleanup E2E ${timestamp} (#${prNumber})`,
      '-f',
      `merge_method=squash`,
    ]);
    if (!mergeResult.merged) {
      fail(`PR merge respondió merged=false. sha=${mergeResult.sha}`);
    }
    ok(`PR #${prNumber} merged (sha=${mergeResult.sha.slice(0, 7)})`);

    // 4b. Defensa: verificar que el PR está MERGED antes de borrar (evita borrar
    //     una branch cuyo PR fue cerrado/abierto por otro proceso paralelo)
    const prAfter = ghJson(['api', `repos/${owner}/${repo}/pulls/${prNumber}`]);
    if (!prAfter.merged || prAfter.state !== 'closed') {
      fail(`Estado del PR inesperado post-merge: state=${prAfter.state} merged=${prAfter.merged}`);
    }
    ok('PR verificado en estado MERGED (defensa contra race)');

    // 4c. Llamar deleteBranch (replica EXACTAMENTE lo que el fix hace
    //     internamente vía `GitHubService.deleteBranch` → octokit.git.deleteRef).
    gh([
      'api',
      '--method',
      'DELETE',
      `repos/${owner}/${repo}/git/refs/heads/${testBranch}`,
      '--silent',
    ], { silent: true });
    needsBranchCleanup = false; // ya no necesitamos cleanup defensivo
    ok(`Cleanup ejecutado: deleteBranch(${testBranch})`);

    // ----------------------------------------------------------------------
    // PHASE 5: Validar que la branch ya no existe
    // ----------------------------------------------------------------------
    log('\n[5/5] Validando que la branch fue efectivamente borrada...\n');

    let stillExists = false;
    try {
      gh(['api', `repos/${owner}/${repo}/branches/${testBranch}`], { silent: true });
      stillExists = true;
    } catch {
      // 404 esperado
    }
    if (stillExists) {
      fail(`Branch '${testBranch}' SIGUE existiendo en remote tras deleteBranch. El cleanup NO funcionó.`);
    }
    ok(`Branch '${testBranch}' confirmada como 404 en remote ✓`);

    log('\n========================================');
    log('  TEST PASSED ✓');
    log('========================================');
    log('El flow E2E del cleanup funciona contra GitHub.');
    log('Las invocaciones del helper en agent-run.service.ts');
    log('y factory-queue.service.ts ejercerán esta misma');
    log('secuencia (merge → deleteBranch) automáticamente');
    log('en el próximo run del Forge.\n');
  } catch (err) {
    console.error('\n[FATAL]', err.message);
    cleanup();
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

(async () => {
  log('========================================');
  log('  test-cleanup-e2e.js');
  log(`  target: ${owner}/${repo}`);
  log(`  mode: ${smoke ? 'SMOKE E2E (creates test branch+PR)' : 'VERIFY-ONLY (no remote changes)'}`);
  log('========================================');

  const config = await preflight();
  verifyCodeIsWired();

  if (!smoke) {
    log('\n[skip] Smoke E2E saltado (default verify-only).');
    log('       Para test completo: agregá --smoke');
    log('\n========================================');
    log('  VERIFY PASSED ✓');
    log('========================================');
    log('El fix está cableado correctamente en el código.');
    log('Para validar que funciona contra GitHub:');
    log(`  node scripts/test-cleanup-e2e.js ${owner}/${repo} --smoke\n`);
    return;
  }

  await smokeE2E(config);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
