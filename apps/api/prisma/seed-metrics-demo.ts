/**
 * Seed DEMO para verificar — SIN gastar tokens de Anthropic — que funcionan:
 *   1. Las gráficas del dashboard /factory (Factory Capacity + Token Burn).
 *   2. El merge gate con la sección "Stories sin completar" (doom loop).
 *
 * Por qué $0: el feature es 100% read-side. El endpoint /factory/metrics y el
 * merge view solo LEEN filas de AgentRun. La DB no distingue si una fila la
 * creó un worker real (corriendo `claude` → $) o este INSERT. Fabricamos
 * AgentRuns con el shape correcto y el feature los lee idéntico.
 *
 * Uso:
 *   pnpm --filter api exec ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-metrics-demo.ts
 *   # limpiar después:
 *   pnpm --filter api exec ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-metrics-demo.ts --clean-only
 *
 * TODO lo creado lleva el prefijo ⟦DEMO-METRICS⟧ en su nombre — el cleanup
 * borra exactamente eso y nada más. Es idempotente: re-correrlo limpia y
 * recrea. NO toca data real del usuario.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/** Marcador en el `name` de toda entidad demo — ancla del cleanup. */
const PREFIX = '⟦DEMO-METRICS⟧';
const HOUR = 3_600_000;
const MINUTE = 60_000;

/** PRNG determinista (mulberry32) — mismo seed produce la misma data. */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260519);
const randInt = (min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;

/**
 * generatorUsage sintético — mismo shape que persiste el worker real.
 * `scale` modula el volumen de tokens para que el Token Burn chart tenga
 * variación hora a hora.
 */
function genUsage(scale: number) {
  const totalInputTokens = randInt(15_000, 90_000) * scale;
  const totalOutputTokens = randInt(3_000, 18_000) * scale;
  const totalCacheCreationInputTokens = randInt(5_000, 30_000) * scale;
  const totalCacheReadInputTokens = randInt(40_000, 280_000) * scale;
  // Pricing aproximado Haiku 4.5: $1/MTok in, $5/MTok out, $0.10/MTok cache_read.
  const totalCostUsd = Number(
    (
      (totalInputTokens + totalCacheCreationInputTokens) * 1e-6 +
      totalOutputTokens * 5e-6 +
      totalCacheReadInputTokens * 1e-7
    ).toFixed(4),
  );
  return {
    callsCount: randInt(1, 3),
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationInputTokens,
    totalCacheReadInputTokens,
    totalCostUsd,
    totalDurationMs: randInt(20, 70) * MINUTE,
    totalDurationApiMs: randInt(10, 40) * MINUTE,
    totalNumTurns: randInt(8, 40),
  };
}

/** Verdict con el shape canónico de CriterionVerdictDto. */
function verdict(
  criterionId: string,
  label: string,
  status: 'passed' | 'failed' | 'skipped',
  reason?: string,
) {
  return {
    criterionId,
    label,
    kind: criterionId,
    command: status === 'passed' ? `npm run ${criterionId}` : null,
    exitCode: status === 'failed' ? 1 : 0,
    output: null,
    status,
    ...(reason ? { reason } : {}),
  };
}

async function cleanup(): Promise<void> {
  // Initiative cascade → Epic → Story → AgentRun (y EpicPod). Borramos
  // Initiative PRIMERO para que no queden AgentRuns apuntando a los nodos
  // cuando borremos ComputeNode (esa FK no tiene onDelete: Cascade).
  const initiatives = await prisma.initiative.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  const nodes = await prisma.computeNode.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  const pods = await prisma.pod.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  console.log(
    `🧹 Cleanup: ${initiatives.count} initiative(s) (cascade → epics/stories/runs), ` +
      `${nodes.count} node(s), ${pods.count} pod(s).`,
  );
}

async function main(): Promise<void> {
  const cleanOnly = process.argv.includes('--clean-only');

  // Cleanup siempre primero — idempotencia: re-correr limpia y recrea.
  await cleanup();
  if (cleanOnly) {
    console.log('✅ --clean-only: data demo eliminada. Nada recreado.');
    return;
  }

  const now = Date.now();

  // ── Compute Fleet: 2 nodos online, 5 slots totales ───────────────────
  // lastHeartbeat = now: un nodo cuenta como "online" solo si su heartbeat
  // tiene <10min de antigüedad (isNodeOnline en MetricsService — correcto:
  // en prod un worker heartbeatea cada ~30s). Como el seed es data ESTÁTICA,
  // los nodos caducan 10min después de correrlo → currentCapacityTotal cae a
  // 0. Eso es comportamiento correcto del fleet, no un bug. Para ver los 2
  // nodos online en el dashboard, abre /factory dentro de ~10min del seed, o
  // re-corre el seed para refrescar los heartbeats.
  const nodeAlpha = await prisma.computeNode.create({
    data: {
      name: `${PREFIX} Node Alpha`,
      type: 'mac_mini',
      os: 'macOS 15.3',
      location: 'Demo',
      ip: '10.0.0.10',
      status: 'online',
      totalSlots: 3,
      lastHeartbeat: new Date(now),
    },
  });
  const nodeBeta = await prisma.computeNode.create({
    data: {
      name: `${PREFIX} Node Beta`,
      type: 'cloud_vm',
      os: 'Ubuntu 24.04',
      location: 'Demo',
      ip: '10.0.0.11',
      status: 'online',
      totalSlots: 2,
      lastHeartbeat: new Date(now),
    },
  });
  const nodeIds = [nodeAlpha.id, nodeBeta.id];

  // ── Pod + Initiative + Epic enqueued ─────────────────────────────────
  const pod = await prisma.pod.create({
    data: {
      name: `${PREFIX} Pod Demo`,
      description: 'Pod sintético para verificación de métricas',
      color: '#3B82F6',
    },
  });
  const initiative = await prisma.initiative.create({
    data: {
      name: `${PREFIX} Iniciativa Demo`,
      description: 'Iniciativa sintética — borrar con --clean-only',
      owner: 'demo-seed',
    },
  });
  const batchId = randomUUID();
  const epic = await prisma.epic.create({
    data: {
      title: `${PREFIX} Checkout Redesign`,
      markdown: '## Descripción\nEpic demo para verificar el merge gate.',
      status: 'in_progress',
      priority: 'high',
      startDate: new Date(now - 7 * 24 * HOUR),
      targetDate: new Date(now + 7 * 24 * HOUR),
      initiativeId: initiative.id,
      enqueuedAt: new Date(now - 24 * HOUR),
      enqueuedBatchId: batchId,
      forgeBranch: 'forge/demo-checkout-redesign',
      pods: { create: [{ podId: pod.id }] },
    },
  });

  // ── 5 Stories: 3 done, 2 blocked (doom loop) ─────────────────────────
  // Story.status terminal hace que awaitingHumanGate sea true → el merge
  // gate se renderiza → la sección "Stories sin completar" muestra D y E.
  const storyDefs = [
    { title: 'Rediseñar formulario de pago', status: 'done' as const },
    { title: 'Integrar pasarela Stripe', status: 'done' as const },
    { title: 'Validación de tarjeta en cliente', status: 'done' as const },
    { title: 'Migrar carrito a nuevo schema', status: 'blocked' as const },
    { title: 'Refactor del checkout context', status: 'blocked' as const },
  ];
  const stories = [];
  for (const def of storyDefs) {
    const story = await prisma.story.create({
      data: {
        title: def.title,
        status: def.status,
        storyPoints: randInt(2, 8),
        epicId: epic.id,
        podId: pod.id,
      },
    });
    stories.push({ ...story, demoStatus: def.status });
  }

  // ── AgentRuns ────────────────────────────────────────────────────────
  // (a) Runs históricos: ~18 runs `completed` distribuidos en 24h. Alimentan
  //     los charts (capacity overlap + token burn por hora). startedAt en
  //     horas pasadas, repartidos round-robin entre las 5 stories y 2 nodos.
  let runCount = 0;
  for (let i = 0; i < 18; i++) {
    const story = stories[i % stories.length];
    const hoursAgo = 23 - Math.floor((i / 18) * 19); // de 23h atrás a ~4h atrás
    const startedAt = new Date(
      now - hoursAgo * HOUR - randInt(0, 55) * MINUTE,
    );
    const durationMs = randInt(12, 48) * MINUTE;
    await prisma.agentRun.create({
      data: {
        storyId: story.id,
        nodeId: nodeIds[i % nodeIds.length],
        branch: `forge/demo-checkout-redesign/story-${i}`,
        status: 'completed',
        startedAt,
        completedAt: new Date(startedAt.getTime() + durationMs),
        lastProgressAt: new Date(startedAt.getTime() + durationMs),
        attempts: randInt(1, 2),
        exitCode: 0,
        generatorUsage: genUsage(randInt(1, 3)),
      },
    });
    runCount++;
  }

  // (b) Latest run por story — define su estado actual en getBatchDetail
  //     (que toma el AgentRun más reciente por startedAt). startedAt en las
  //     últimas ~3h para garantizar que son los "latest".
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const startedAt = new Date(now - (3 - i * 0.4) * HOUR);
    const isBlocked = story.demoStatus === 'blocked';

    if (!isBlocked) {
      // Story done — run completed, generatorUsage poblado.
      await prisma.agentRun.create({
        data: {
          storyId: story.id,
          nodeId: nodeIds[i % nodeIds.length],
          branch: `forge/demo-checkout-redesign/story-latest-${i}`,
          status: 'completed',
          startedAt,
          completedAt: new Date(startedAt.getTime() + 35 * MINUTE),
          lastProgressAt: new Date(startedAt.getTime() + 35 * MINUTE),
          attempts: 1,
          exitCode: 0,
          generatorUsage: genUsage(2),
        },
      });
      runCount++;
      continue;
    }

    // Story blocked — run failed con doom loop. El primer blocked es una
    // REGRESIÓN, el segundo un ESTANCAMIENTO (cubre ambos doomLoopKind).
    const isRegression = i === 3;
    const errorMessage = isRegression
      ? 'Doom loop detectado en attempt 3 — REGRESIÓN: passedCount efectivo bajó de 3 a 1 (delta=-2). El agente rompió criterios que antes pasaban. Escalando a humano sin grace.'
      : 'Doom loop detectado en attempt 3 — ESTANCAMIENTO: passedCount efectivo no aumentó (1 → 1). El agente está atorado en los mismos criterios fallidos. Escalando a humano.';
    // dodVerification: 3 attempts. extractFailureInfo mergea across attempts
    // (last-wins) → la checklist del merge view muestra el veredicto final de
    // CADA criterio. El último attempt lista los 7-8 criterios del DoD con
    // mezcla de passed/failed/skipped para que la checklist se vea completa.
    const lastAttemptVerdicts = isRegression
      ? [
          verdict('code-written', 'Código escrito', 'passed'),
          verdict('technical-design', 'Diseño técnico respetado', 'passed'),
          verdict(
            'tests-passing',
            'Tests pasan',
            'failed',
            'La migración de schema rompió 5 tests que pasaban en attempt 1 (cart.spec.ts, checkout.spec.ts).',
          ),
          verdict('no-errors', 'Sin errores de tipo/lint', 'passed'),
          verdict(
            'acceptance-criteria',
            'Criterios de aceptación',
            'failed',
            'El carrito ya no persiste los items tras la migración — criterio de aceptación #2 falla.',
          ),
          verdict('security-scan', 'Sin vulnerabilidades nuevas', 'passed'),
          verdict('docs-updated', 'Documentación actualizada', 'passed'),
          verdict(
            'pr-created',
            'PR creado',
            'skipped',
            'Sandbox mode — no se abre PR real.',
          ),
        ]
      : [
          verdict('code-written', 'Código escrito', 'passed'),
          verdict('technical-design', 'Diseño técnico respetado', 'passed'),
          verdict('tests-passing', 'Tests pasan', 'passed'),
          verdict(
            'no-errors',
            'Sin errores de tipo/lint',
            'failed',
            'tsc reporta 7 errores de tipo en checkout-context.tsx — sin cambios entre attempt 2 y 3.',
          ),
          verdict(
            'acceptance-criteria',
            'Criterios de aceptación',
            'failed',
            'El refactor dejó el checkout sin validar el código postal — criterio de aceptación #4 no se cumple.',
          ),
          verdict('security-scan', 'Sin vulnerabilidades nuevas', 'passed'),
          verdict(
            'pr-created',
            'PR creado',
            'skipped',
            'Sandbox mode — no se abre PR real.',
          ),
        ];
    await prisma.agentRun.create({
      data: {
        storyId: story.id,
        nodeId: nodeIds[i % nodeIds.length],
        branch: `forge/demo-checkout-redesign/story-latest-${i}`,
        status: 'failed',
        startedAt,
        completedAt: new Date(startedAt.getTime() + 52 * MINUTE),
        lastProgressAt: new Date(startedAt.getTime() + 52 * MINUTE),
        attempts: 3,
        exitCode: 1,
        errorMessage,
        generatorUsage: genUsage(3),
        dodVerification: [
          {
            attempt: 1,
            verdicts: [
              verdict('code-written', 'Código escrito', 'passed'),
              verdict('tests-passing', 'Tests pasan', 'passed'),
            ],
          },
          {
            attempt: 2,
            verdicts: [
              verdict('code-written', 'Código escrito', 'passed'),
              verdict('tests-passing', 'Tests pasan', 'failed', 'Regresión parcial.'),
            ],
          },
          { attempt: 3, verdicts: lastAttemptVerdicts },
        ],
      },
    });
    runCount++;
  }

  console.log('✅ Seed demo creado:');
  console.log(`   • 2 ComputeNodes online (5 slots)`);
  console.log(`   • 1 Epic enqueued con 5 stories (3 done, 2 blocked)`);
  console.log(`   • ${runCount} AgentRuns (18 históricos + 5 latest)`);
  console.log('');
  console.log('🔗 Verifica en el browser:');
  console.log(`   • Gráficas:  /factory  (Factory Capacity + Token Burn con data real)`);
  console.log(`   • Merge gate: /factory/batch/${batchId}`);
  console.log(`     → debe mostrar el PendingGateCard con la sección`);
  console.log(`       "Stories sin completar" (2 stories: 1 Regresión, 1 Estancamiento)`);
  console.log(`       y el checkbox de confirmación bloqueando "Approve & Merge".`);
  console.log('');
  console.log('🧹 Para limpiar: re-corre este script con --clean-only');
}

main()
  .catch((e) => {
    console.error('❌ Seed falló:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
