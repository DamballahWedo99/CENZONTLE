const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
(async () => {
  const epic = await p.epic.findFirst({
    where: { title: { startsWith: 'Forge DAG test' } },
    orderBy: { createdAt: 'desc' },
  });
  if (!epic) { console.log('No epic found'); return await p.$disconnect(); }
  console.log('Epic:', epic.title);
  console.log('  batchId:', epic.enqueuedBatchId);
  console.log('  enqueuedAt:', epic.enqueuedAt);
  console.log('Stories:');
  const stories = await p.story.findMany({ where: { epicId: epic.id }, select: { title: true, status: true } });
  stories.forEach(s => console.log(`  ${s.status.padEnd(12)} ${s.title}`));
  await p.$disconnect();
})();
