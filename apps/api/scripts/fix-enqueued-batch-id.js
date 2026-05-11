/* eslint-disable @typescript-eslint/no-require-imports */
// Asigna enqueuedBatchId a TODAS las épicas que tienen enqueuedAt set pero
// el batchId null. El listQueue() del backend exige ambos para mostrar la
// épica en el Pipeline Board ("IN QUEUE").
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  const candidates = await prisma.epic.findMany({
    where: { enqueuedAt: { not: null }, enqueuedBatchId: null },
    select: { id: true, title: true },
  });
  if (candidates.length === 0) {
    console.log('No hay épicas que arreglar (todas tienen enqueuedBatchId).');
    await prisma.$disconnect();
    return;
  }
  console.log(`Arreglando ${candidates.length} épica(s):`);
  for (const e of candidates) {
    const batchId = randomUUID();
    await prisma.epic.update({
      where: { id: e.id },
      data: { enqueuedBatchId: batchId },
    });
    console.log(`  ✓ "${e.title}" (${e.id.slice(0, 8)}) → batchId=${batchId.slice(0, 8)}`);
  }
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
