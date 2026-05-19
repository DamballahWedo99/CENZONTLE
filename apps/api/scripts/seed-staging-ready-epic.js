/* eslint-disable @typescript-eslint/no-require-imports */
// Run with:
//   cd apps/api && node --env-file=.env scripts/seed-staging-ready-epic.js <owner>/<repo>
//
// Seedea un Epic + Stories + AgentRuns + integration branch real en GitHub para
// que vos puedas:
//   1. Ir a la UI (/factory/batch/{batchId})
//   2. Click "Approve & Merge to DEV"
//   3. Ingresar password (step-up auth)
//   4. Observar que el cleanup automático del fix BORRA la integration branch
//
// Cost: $0 — no spawn de worker, no Anthropic API call, no DoD verifier.
// Las stories quedan marcadas como status='done' con AgentRun completed
// simulado (mismo shape que el flow real produce, pero sin ejecutar nada).
//
// El único componente "real" es el integration branch en GitHub: necesita
// existir en remote porque approveStagingGate abre PR contra ella y la mergea.
//
// SAFETY:
//   - El epic se crea con title prefix "[E2E TEST]" para que sea obvio en la UI
//   - El batch ID es timestamped — fácil de identificar y borrar
//   - Falla early si: no DB, no gh CLI auth, no dev branch existe, no repo writable
//   - Cleanup defensivo: si script falla a mitad, intenta borrar epic + branch
//
// ESTADO POST-SEED:
//   Epic:
//     - status='in_progress'
//     - enqueuedAt=now, enqueuedBatchId=<UUID>
//     - forgeBranch='forge/sprint-batch-XXXX'
//     - stagingApprovedAt=NULL (UI muestra "Approve & Merge to DEV")
//   Stories (2):
//     - status='done'
//     - AgentRun completed con exitCode=0
//   GitHub:
//     - Branch forge/sprint-batch-XXXX existe (cortada desde dev)
//     - Commit dummy STAGING_TEST_*.md
//     - SIN PR consolidated abierto (lo abre approveStagingGate)

const { randomUUID } = require('crypto');
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const repoArg = process.argv[2];
if (!repoArg || !repoArg.includes('/')) {
  console.error('Usage: node scripts/seed-staging-ready-epic.js <owner>/<repo>');
  process.exit(1);
}
const [owner, repo] = repoArg.split('/');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function gh(args, opts = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'pipe',
  });
}
function ghJson(args) {
  return JSON.parse(gh(args));
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.error(`\n  ✗ ${msg}`);
  process.exit(1);
}

(async () => {
  console.log('\n========================================');
  console.log('  seed-staging-ready-epic.js');
  console.log(`  target: ${owner}/${repo}`);
  console.log('========================================\n');

  let createdEpic = null;
  let createdBranch = null;

  // Cleanup defensivo si seed falla a mitad
  const cleanup = async (err) => {
    console.error('\n[seed] FALLO — limpiando...');
    if (err) console.error(err.message);
    if (createdEpic) {
      try {
        await prisma.epic.delete({ where: { id: createdEpic.id } });
        console.error('[cleanup] epic borrado');
      } catch (e) {
        console.error(`[cleanup] no pude borrar epic: ${e.message}`);
      }
    }
    if (createdBranch) {
      try {
        gh(['api', '--method', 'DELETE', `repos/${owner}/${repo}/git/refs/heads/${createdBranch}`, '--silent'], { silent: true });
        console.error(`[cleanup] branch ${createdBranch} borrada`);
      } catch (e) {
        console.error(`[cleanup] no pude borrar branch: ${e.message}`);
      }
    }
    await prisma.$disconnect();
    process.exit(1);
  };
  process.on('uncaughtException', cleanup);

  try {
    // ========================================================================
    // PHASE 1: Preflight
    // ========================================================================
    console.log('[1/4] Preflight (gh + DB + dev branch)...\n');

    process.env.DATABASE_URL || fail('DATABASE_URL no setteada. Corré con node --env-file=.env');

    try {
      gh(['auth', 'status'], { silent: true });
      ok('gh CLI autenticado');
    } catch {
      fail('gh CLI no autenticado. Corré `gh auth login`.');
    }

    const branchConfig = await prisma.branchStrategyConfig.findUnique({
      where: { id: 'global' },
      select: { devBranch: true, forgeBranchPrefix: true, autoDeleteForgeBranch: true },
    });
    if (!branchConfig) fail('BranchStrategyConfig no existe en DB. El backend nunca arrancó con esta DB.');
    if (!branchConfig.autoDeleteForgeBranch) {
      console.log('  ⚠️  autoDeleteForgeBranch=false — el cleanup NO va a borrar la branch tras merge.');
      console.log('     Si querés validar el fix, activalo: UPDATE branch_strategy_config SET "autoDeleteForgeBranch"=true WHERE id=\'global\';');
    } else {
      ok('autoDeleteForgeBranch=true (cleanup automático activo)');
    }

    let devSha;
    try {
      const devInfo = ghJson(['api', `repos/${owner}/${repo}/branches/${branchConfig.devBranch}`]);
      devSha = devInfo.commit.sha;
      ok(`Dev branch '${branchConfig.devBranch}' existe (SHA ${devSha.slice(0, 7)})`);
    } catch {
      fail(`Dev branch '${branchConfig.devBranch}' no existe en ${owner}/${repo}.`);
    }

    // ========================================================================
    // PHASE 2: DB Setup (Initiative + Pod + ComputeNode + Epic + Stories + AgentRuns)
    // ========================================================================
    console.log('\n[2/4] DB setup (initiative + pod + node + epic + stories + runs)...\n');

    // Initiative — find or create
    let initiative = await prisma.initiative.findFirst({ where: { name: 'E2E Test Initiative' } });
    if (!initiative) {
      initiative = await prisma.initiative.create({
        data: {
          name: 'E2E Test Initiative',
          description: 'Iniciativa sintética para tests E2E del cleanup de branches',
          owner: 'seed-script',
        },
      });
      ok(`Initiative creada: ${initiative.id.slice(0, 8)}`);
    } else {
      ok(`Initiative reusada: ${initiative.id.slice(0, 8)} (E2E Test Initiative)`);
    }

    // Pod — find or create un pod sintético
    let pod = await prisma.pod.findFirst({ where: { name: 'E2E Test Pod' } });
    if (!pod) {
      pod = await prisma.pod.create({
        data: {
          name: 'E2E Test Pod',
          description: 'Pod sintético para seed E2E',
          color: '#10b981',
        },
      });
      ok(`Pod creado: ${pod.id.slice(0, 8)}`);
    } else {
      ok(`Pod reusado: ${pod.id.slice(0, 8)} (E2E Test Pod)`);
    }

    // ComputeNode — find or create (necesario para AgentRun.nodeId)
    let node = await prisma.computeNode.findFirst({ where: { name: 'E2E Test Node' } });
    if (!node) {
      node = await prisma.computeNode.create({
        data: {
          name: 'E2E Test Node',
          type: 'local',
          status: 'offline',
        },
      });
      ok(`ComputeNode creado: ${node.id.slice(0, 8)}`);
    } else {
      ok(`ComputeNode reusado: ${node.id.slice(0, 8)} (E2E Test Node)`);
    }

    // Epic — crea uno nuevo
    const timestamp = Date.now();
    const batchId = randomUUID();
    const epicShortPrefix = randomUUID().slice(0, 8);
    const integrationBranch = `${branchConfig.forgeBranchPrefix}${epicShortPrefix}`;

    const epic = await prisma.epic.create({
      data: {
        id: `${epicShortPrefix}-${randomUUID().slice(9)}`,
        title: `[E2E TEST] Cleanup validation ${new Date(timestamp).toISOString()}`,
        markdown: '## Descripción\n\nEpic sintética para validar cleanup E2E. No tocar manualmente.',
        status: 'in_progress',
        priority: 'low',
        startDate: new Date(),
        targetDate: new Date(timestamp + 86400000),
        enqueuedAt: new Date(),
        enqueuedBatchId: batchId,
        forgeBranch: integrationBranch,
        forgeBranchCreatedAt: new Date(),
        forgeBranchBaseSha: devSha,
        initiativeId: initiative.id,
        pods: {
          create: [{ podId: pod.id }],
        },
      },
    });
    createdEpic = epic;
    ok(`Epic creado: ${epic.id.slice(0, 8)} (batch ${batchId.slice(0, 8)})`);

    // Stories — 2 stories triviales, ambas done
    const story1 = await prisma.story.create({
      data: {
        title: 'Crear SETUP.md placeholder',
        status: 'done',
        epicId: epic.id,
        podId: pod.id,
      },
    });
    const story2 = await prisma.story.create({
      data: {
        title: 'Crear TESTS.md placeholder',
        status: 'done',
        epicId: epic.id,
        podId: pod.id,
      },
    });
    ok(`Stories creadas: 2 (ambas status='done')`);

    // AgentRuns — uno por story, marcados como completed
    await prisma.agentRun.createMany({
      data: [
        {
          storyId: story1.id,
          nodeId: node.id,
          status: 'completed',
          branch: `forge/epic-${epicShortPrefix}/story-${story1.id.slice(0, 8)}`,
          exitCode: 0,
          lastProgressAt: new Date(),
        },
        {
          storyId: story2.id,
          nodeId: node.id,
          status: 'completed',
          branch: `forge/epic-${epicShortPrefix}/story-${story2.id.slice(0, 8)}`,
          exitCode: 0,
          lastProgressAt: new Date(),
        },
      ],
    });
    ok('AgentRuns creados: 2 (ambos status="completed", exitCode=0)');

    // ========================================================================
    // PHASE 3: GitHub Setup (integration branch + commit dummy)
    // ========================================================================
    console.log('\n[3/4] GitHub setup (integration branch real)...\n');

    // 3a. Crear integration branch desde dev
    gh([
      'api',
      '--method',
      'POST',
      `repos/${owner}/${repo}/git/refs`,
      '-f',
      `ref=refs/heads/${integrationBranch}`,
      '-f',
      `sha=${devSha}`,
      '--silent',
    ], { silent: true });
    createdBranch = integrationBranch;
    ok(`Integration branch creada: ${integrationBranch}`);

    // 3b. Crear commit dummy con marker
    const content = Buffer.from(
      `# Staging Test\n\nEpic: ${epic.id}\nBatch: ${batchId}\nGenerado: ${new Date().toISOString()}\n\nEste commit es sintético para validar el cleanup E2E.\n`,
    ).toString('base64');
    gh([
      'api',
      '--method',
      'PUT',
      `repos/${owner}/${repo}/contents/STAGING_TEST_${timestamp}.md`,
      '-f',
      `message=test: staging gate E2E ${timestamp}`,
      '-f',
      `content=${content}`,
      '-f',
      `branch=${integrationBranch}`,
      '--silent',
    ], { silent: true });
    ok(`Commit dummy: STAGING_TEST_${timestamp}.md`);

    // ========================================================================
    // PHASE 4: Output con instrucciones
    // ========================================================================
    console.log('\n[4/4] Listo para validación manual desde la UI\n');

    console.log('========================================');
    console.log('  SEED COMPLETE ✓');
    console.log('========================================\n');
    console.log('📍 Batch ID:        ', batchId);
    console.log('📍 Epic ID:         ', epic.id);
    console.log('📍 Integration branch:', integrationBranch);
    console.log('📍 Stories done:    ', '2/2');
    console.log('📍 Pod (necesario para acceso):', pod.id.slice(0, 8), '(E2E Test Pod)');
    console.log('\n──────────────────────────────────────────');
    console.log('  PRÓXIMOS PASOS (UI):');
    console.log('──────────────────────────────────────────');
    console.log(`  1. Login con role TechLead o AltaGerencia`);
    console.log(`  2. Abrir: http://localhost:3000/factory/batch/${batchId}`);
    console.log(`     (o el dominio donde corre tu web — el path es el mismo)`);
    console.log(`  3. Esperás ver el banner "Awaiting Human Gate" con el botón`);
    console.log(`     "Approve & Merge to DEV" (verde, esquina inferior)`);
    console.log(`  4. Click → ingresar tu password real → "Approve & Merge"`);
    console.log(`  5. Observar que:`);
    console.log(`     - El PR consolidated se abre + mergea a ${branchConfig.devBranch}`);
    console.log(`     - La branch '${integrationBranch}' SE BORRA automáticamente`);
    console.log(`     - El batch aparece en "Staged" del Pipeline Board\n`);
    console.log('──────────────────────────────────────────');
    console.log('  VALIDACIÓN POST-CLICK (fuera de la UI):');
    console.log('──────────────────────────────────────────');
    console.log(`  gh api repos/${owner}/${repo}/branches/${integrationBranch}`);
    console.log(`  (debería responder 404 — el cleanup la borró)\n`);
    console.log('  Si la rama SIGUE existiendo tras click + Approve, el fix tiene un bug.\n');

    if (!branchConfig.autoDeleteForgeBranch) {
      console.log('  ⚠️  RECORDATORIO: autoDeleteForgeBranch=false en DB.');
      console.log('     El cleanup NO se va a ejecutar — vas a ver la branch persistir.');
      console.log('     Activalo antes del click:\n');
      console.log(`     psql $DATABASE_URL -c "UPDATE branch_strategy_config SET \\"autoDeleteForgeBranch\\"=true WHERE id='global';"\n`);
    }

    await prisma.$disconnect();
  } catch (err) {
    await cleanup(err);
  }
})().catch((e) => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});
