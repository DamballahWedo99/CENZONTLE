/* eslint-disable @typescript-eslint/no-require-imports */
//
// Limpia épicas de pruebas (matching "Forge smoke test"), preservando la
// más reciente. Postgres ON DELETE CASCADE se encarga de Stories,
// AgentRuns, StoryDependencies y StoryTechnicalDependencies.
//
// Uso:
//   node scripts/cleanup-test-epics.js              # dry-run (lista qué se borraría)
//   node scripts/cleanup-test-epics.js --confirm    # ejecuta el delete
//
// Skip seguro: si una épica candidata tiene runs activos (claimed | running),
// la salta con warning para no matar workers en vivo.
//
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const TITLE_PREFIX = 'Forge smoke test';
const ACTIVE_RUN_STATUSES = ['claimed', 'running'];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');

(async () => {
  // 1. Lista todas las épicas matching el prefix, ordenadas más reciente primero.
  const matching = await prisma.epic.findMany({
    where: { title: { startsWith: TITLE_PREFIX } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      stories: {
        select: {
          id: true,
          agentRuns: { select: { id: true, status: true } },
        },
      },
    },
  });

  if (matching.length === 0) {
    console.log(`No hay épicas matching "${TITLE_PREFIX}". Nada que hacer.`);
    await prisma.$disconnect();
    return;
  }

  if (matching.length === 1) {
    console.log(
      `Solo hay 1 épica matching "${TITLE_PREFIX}" — ya estás en el estado deseado.`,
    );
    console.log(`  ✓ KEEP "${matching[0].title}" (${matching[0].id.slice(0, 8)})`);
    await prisma.$disconnect();
    return;
  }

  // 2. La primera del array es la más reciente — esa la preservamos.
  const [keep, ...candidates] = matching;
  console.log(`\nÉpicas matching "${TITLE_PREFIX}": ${matching.length}\n`);
  console.log(`  ✓ KEEP    "${keep.title}" (${keep.id.slice(0, 8)})  ${keep.createdAt.toISOString()}`);

  // 3. Para cada candidata, decide DELETE o SKIP según runs activos.
  const toDelete = [];
  const toSkip = [];
  for (const epic of candidates) {
    const totalStories = epic.stories.length;
    const activeRuns = epic.stories
      .flatMap((s) => s.agentRuns)
      .filter((r) => ACTIVE_RUN_STATUSES.includes(r.status));
    const totalRuns = epic.stories.flatMap((s) => s.agentRuns).length;

    if (activeRuns.length > 0) {
      toSkip.push({ epic, totalStories, totalRuns, activeRuns: activeRuns.length });
      console.log(
        `  ⚠ SKIP    "${epic.title}" (${epic.id.slice(0, 8)})  ${epic.createdAt.toISOString()} ` +
          `— ${activeRuns.length} run(s) activos`,
      );
    } else {
      toDelete.push({ epic, totalStories, totalRuns });
      console.log(
        `  ✗ DELETE  "${epic.title}" (${epic.id.slice(0, 8)})  ${epic.createdAt.toISOString()} ` +
          `— ${totalStories} stor${totalStories === 1 ? 'y' : 'ies'}, ${totalRuns} run(s) (cascade)`,
      );
    }
  }

  if (toDelete.length === 0) {
    console.log(`\nNo hay épicas borrables (todas tienen runs activos). Nada que hacer.`);
    await prisma.$disconnect();
    return;
  }

  // 4. Dry-run vs ejecutar.
  if (!confirm) {
    console.log(
      `\nDRY-RUN — ${toDelete.length} épica(s) serían borradas (con cascade de stories+runs+deps).`,
    );
    console.log(`Para ejecutar: node scripts/cleanup-test-epics.js --confirm`);
    if (toSkip.length > 0) {
      console.log(`(${toSkip.length} épica(s) saltadas por tener runs activos)`);
    }
    await prisma.$disconnect();
    return;
  }

  console.log(`\nEjecutando borrado de ${toDelete.length} épica(s)...`);
  let deletedCount = 0;
  for (const { epic } of toDelete) {
    try {
      await prisma.epic.delete({ where: { id: epic.id } });
      console.log(`  ✓ Borrada "${epic.title}" (${epic.id.slice(0, 8)})`);
      deletedCount++;
    } catch (err) {
      console.error(
        `  ✗ ERROR borrando "${epic.title}" (${epic.id.slice(0, 8)}): ${err.message}`,
      );
    }
  }

  console.log(`\n✓ ${deletedCount}/${toDelete.length} épica(s) borradas. KEEP: "${keep.title}".`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
