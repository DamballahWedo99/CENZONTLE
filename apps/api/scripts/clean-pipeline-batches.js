/**
 * Borra (una vez) las 3 épicas del Pipeline Board confirmadas por el usuario:
 *   - [REACT-TEST] *  (throwaway)
 *   - [FAST-TEST] *   (throwaway)
 *   - Homepage Web PoC (id fd82750f...)  ← confirmado borrar
 * Borra agent_runs primero, luego las épicas (stories + epic_pods cascadean).
 * Usa la BD nativa (DATABASE_URL del .env del API).
 * Correr (desde apps/api): node --env-file=.env scripts/clean-pipeline-batches.js
 */
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const HOMEPAGE_POC_ID = 'fd82750f-60f1-45c3-ae90-8caf0bf96639';

(async () => {
  if (!process.env.DATABASE_URL) { console.error('✗ DATABASE_URL no set'); process.exit(1); }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const epics = await prisma.epic.findMany({
      where: {
        OR: [
          { title: { startsWith: '[REACT-TEST]' } },
          { title: { startsWith: '[FAST-TEST]' } },
          { id: HOMEPAGE_POC_ID },
        ],
      },
      select: { id: true, title: true, enqueuedBatchId: true, stories: { select: { id: true } } },
    });

    if (epics.length === 0) { console.log('No hay épicas que coincidan. Nada que borrar.'); return; }

    console.log(`Épicas a borrar (${epics.length}):`);
    epics.forEach((e) => console.log(`  - "${e.title.slice(0, 55)}" [${e.id.slice(0, 8)}] · ${e.stories.length} story/ies · batch ${e.enqueuedBatchId ? e.enqueuedBatchId.slice(0, 8) : '—'}`));

    const storyIds = epics.flatMap((e) => e.stories.map((s) => s.id));
    if (storyIds.length) {
      const r = await prisma.agentRun.deleteMany({ where: { storyId: { in: storyIds } } });
      console.log(`\nagent_runs borrados: ${r.count}`);
    }
    const del = await prisma.epic.deleteMany({ where: { id: { in: epics.map((e) => e.id) } } });
    console.log(`épicas borradas: ${del.count} (stories + epic_pods cascadean por FK onDelete)`);
    console.log('\n✓ Pipeline Board limpio.');
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error('✗ Error:', e.message); process.exit(1); });
