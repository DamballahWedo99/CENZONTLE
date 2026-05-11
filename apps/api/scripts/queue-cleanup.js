/* eslint-disable @typescript-eslint/no-require-imports */
// Run with: node --env-file=.env scripts/queue-cleanup.js
//
// Desencola todas las épicas (epic.enqueuedAt = NULL) para arrancar limpio.
// NO toca agent_runs históricos (forensics se preservan). NO toca stories
// que estén en backlog (ya están limpias). Si hay stories con claimedAt
// pendiente, las resetea a NULL para evitar locks zombi.
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  console.log('\n--- ANTES ---');
  const beforeEpics = await prisma.epic.count({ where: { enqueuedAt: { not: null } } });
  const beforeClaimed = await prisma.story.count({ where: { claimedAt: { not: null } } });
  console.log(`Épicas encoladas: ${beforeEpics}`);
  console.log(`Stories con claimedAt activo: ${beforeClaimed}`);

  if (beforeEpics === 0 && beforeClaimed === 0) {
    console.log('\nNada que limpiar — queue vacía.');
    await prisma.$disconnect();
    return;
  }

  console.log('\n--- LIMPIANDO ---');
  const [epicResult, storyResult] = await prisma.$transaction([
    prisma.epic.updateMany({
      where: { enqueuedAt: { not: null } },
      data: { enqueuedAt: null },
    }),
    prisma.story.updateMany({
      where: { claimedAt: { not: null } },
      data: { claimedAt: null },
    }),
  ]);
  console.log(`Épicas desencoladas: ${epicResult.count}`);
  console.log(`Stories con claimedAt reseteado: ${storyResult.count}`);

  console.log('\n--- DESPUÉS ---');
  const afterEpics = await prisma.epic.count({ where: { enqueuedAt: { not: null } } });
  const afterClaimed = await prisma.story.count({ where: { claimedAt: { not: null } } });
  console.log(`Épicas encoladas: ${afterEpics}`);
  console.log(`Stories con claimedAt activo: ${afterClaimed}`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
