/**
 * create-react-test-epic.js — Crea (y encola) una épica de prueba con UNA
 * historia que pide una página React básica, para validar E2E los verifiers
 * nuevos del DoD: code-security (/security-review headless), security-scan
 * diferencial, verifierError→skipped y retry.
 *
 * Por qué Prisma y no psql: el repo tiene Postgres DUAL en :5432 (Docker +
 * nativo Homebrew, mismas creds). `psql -h localhost` puede pegar en la BD
 * EQUIVOCADA. Usando el adapter-pg con el DATABASE_URL del .env del API,
 * pegamos SIEMPRE en la misma BD que usa el API (la que el worker consulta).
 *
 * El repo destino y el baseBranch NO se setean acá: el backend los resuelve al
 * claim (CodeRepository global + integration branch `forge/sprint-batch-<id8>`
 * creada desde `dev`). Solo creamos épica+story+enqueue; el worker hace el resto.
 *
 * Correr (desde apps/api):
 *   node --env-file=.env scripts/create-react-test-epic.js            # crea + encola
 *   node --env-file=.env scripts/create-react-test-epic.js --no-enqueue
 *   node --env-file=.env scripts/create-react-test-epic.js --cleanup  # borra los [REACT-TEST] previos
 */
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const MARKER = '[REACT-TEST]';
const args = new Set(process.argv.slice(2));
const DO_CLEANUP = args.has('--cleanup');
const DO_ENQUEUE = !args.has('--no-enqueue');

// La instrucción para el agente es el TÍTULO de la story (no hay campo
// description, y sin vaultPath el prompt builder se basa en el título + contexto
// de la épica). Por eso el título es una spec auto-contenida y clara.
const STORY_TITLE =
  `${MARKER} Crear un componente React de bienvenida "Welcome": un encabezado ` +
  `"Bienvenido a CENZONTLE" y un párrafo corto que describa la app, ubicándolo ` +
  `en la carpeta idiomática del repo (app/ o src/ según el framework). Mantenerlo ` +
  `simple y presentacional, sin lógica ni dependencias nuevas.`;

const EPIC_MARKDOWN = [
  '## Descripción',
  '',
  'Épica de PRUEBA E2E del Forge para validar los verifiers de DoD nuevos',
  '(code-security, security-scan diferencial, retry). Una sola historia: una',
  'página/componente React de bienvenida básico.',
  '',
  '## Criterios de aceptación',
  '',
  '- Existe un componente React "Welcome" con un encabezado y un párrafo.',
  '- Renderiza sin errores de tipo ni lint.',
  '- No introduce dependencias ni vulnerabilidades nuevas.',
].join('\n');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL no está set. Corré con: node --env-file=.env scripts/create-react-test-epic.js');
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // ── Cleanup ───────────────────────────────────────────────────────────
    if (DO_CLEANUP) {
      const marked = await prisma.epic.findMany({
        where: { title: { startsWith: MARKER } },
        select: { id: true, stories: { select: { id: true } } },
      });
      if (marked.length === 0) {
        console.log(`Cleanup: 0 épicas ${MARKER} para borrar.`);
      } else {
        const storyIds = marked.flatMap((e) => e.stories.map((s) => s.id));
        // agent_runs primero (por si no cascadean desde story), luego epics
        // (stories + epic_pods cascadean desde el epic via onDelete: Cascade).
        if (storyIds.length > 0) {
          await prisma.agentRun.deleteMany({ where: { storyId: { in: storyIds } } });
        }
        const del = await prisma.epic.deleteMany({ where: { title: { startsWith: MARKER } } });
        console.log(`Cleanup: borradas ${del.count} épica(s) ${MARKER} (+ ${storyIds.length} story/ies + sus runs).`);
      }
      if (!args.has('--cleanup-and-create')) {
        return;
      }
    }

    // ── Precondiciones: una iniciativa y un pod cualquiera ──────────────────
    const initiative = await prisma.initiative.findFirst({ select: { id: true, name: true } });
    if (!initiative) {
      console.error('✗ No hay ninguna Initiative en la BD. Creá una en la UI antes de correr esto.');
      process.exit(1);
    }
    const pod = await prisma.pod.findFirst({ select: { id: true, name: true } });
    if (!pod) {
      console.error('✗ No hay ningún Pod en la BD. Creá uno en la UI antes de correr esto.');
      process.exit(1);
    }

    // ── Crear épica + story + link pod ──────────────────────────────────────
    const now = new Date();
    const target = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const enqueuedBatchId = DO_ENQUEUE ? randomUUID() : null;

    const epic = await prisma.epic.create({
      data: {
        title: `${MARKER} Página React básica ${now.toISOString()}`,
        markdown: EPIC_MARKDOWN,
        status: 'in_progress',
        priority: 'low',
        startDate: now,
        targetDate: target,
        initiativeId: initiative.id,
        // Encolar = set enqueuedAt + enqueuedBatchId (mismo modelo que el botón
        // "Subir al Forge", pero saltando el coverage gate de la API — OK para test).
        ...(DO_ENQUEUE ? { enqueuedAt: now, enqueuedBatchId } : {}),
        pods: { create: [{ podId: pod.id }] },
        stories: {
          create: [
            {
              title: STORY_TITLE,
              status: 'backlog',
              storyPoints: 1,
              podId: pod.id,
              vaultPath: null, // sin vault → prompt builder usa el título
            },
          ],
        },
      },
      select: { id: true, title: true, stories: { select: { id: true } } },
    });

    const storyId = epic.stories[0].id;
    console.log('');
    console.log(`✓ Épica creada: ${epic.id}`);
    console.log(`✓ Story creada: ${storyId}`);
    console.log(`  Iniciativa: ${initiative.name} (${initiative.id})`);
    console.log(`  Pod: ${pod.name} (${pod.id})`);
    if (DO_ENQUEUE) {
      console.log(`✓ ENCOLADA (batchId ${enqueuedBatchId}). El worker la claim en el próximo poll (≤5s).`);
    } else {
      console.log('⚠ NO encolada (--no-enqueue). Encolá desde la UI o re-corré sin el flag.');
    }

    console.log('');
    console.log('━━━ Cómo verificar que los verifiers nuevos corrieron ━━━');
    console.log('');
    console.log('1) Corré el worker DESDE ESTE WORKTREE (no el binario global):');
    console.log('   pnpm --filter @cenzontle/worker dev -- start');
    console.log('');
    console.log('2) En los logs del worker, buscá estos eventos (grep -E):');
    console.log("   code-security:      'dod.code_security.spawn'  → '.verdict'  (status passed/failed, high/medium)");
    console.log("   security-scan diff: 'dod.security_scan.differential'  (outcome + headCount/baseCount/newCount)");
    console.log("   retry (si infra falla): 'dod.verifier_agent.retry'");
    console.log("   resumen DoD:        'forge.verify.completed'  (incluye verifierErrors)");
    console.log('');
    console.log('   Ejemplo: el worker corre en foreground; en otra terminal podés filtrar su log con:');
    console.log("   ... | grep -E 'code_security|security_scan.differential|verifier_agent.retry|verify.completed'");
    console.log('');
    console.log(`3) UI: http://localhost:3000/proyectos/epicas/${epic.id}`);
    console.log(`   Cleanup al terminar: node --env-file=.env scripts/create-react-test-epic.js --cleanup`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
