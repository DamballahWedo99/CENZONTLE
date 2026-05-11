/* eslint-disable @typescript-eslint/no-require-imports */
// Run with: node --env-file=.env scripts/queue-inspect.js
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  const epics = await prisma.epic.findMany({
    where: { enqueuedAt: { not: null } },
    select: { id: true, title: true, enqueuedAt: true },
    orderBy: { enqueuedAt: 'asc' },
  });
  console.log('\n=== ÉPICAS ENCOLADAS ===');
  if (epics.length === 0) {
    console.log('(vacío)');
  } else {
    console.table(
      epics.map((e) => ({
        id: e.id.slice(0, 8),
        title: e.title.slice(0, 60),
        enqueuedAt: e.enqueuedAt?.toISOString().slice(0, 19) ?? 'null',
      })),
    );
  }

  if (epics.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const epicIds = epics.map((e) => e.id);
  const stories = await prisma.story.findMany({
    where: { epicId: { in: epicIds } },
    select: { id: true, title: true, status: true, claimedAt: true },
  });
  console.log(`\n=== STORIES (${stories.length}) ===`);
  console.table(
    stories.map((s) => ({
      id: s.id.slice(0, 8),
      title: s.title.slice(0, 50),
      status: s.status,
      claimed: s.claimedAt ? 'sí' : '—',
    })),
  );

  const runs = await prisma.agentRun.findMany({
    where: { storyId: { in: stories.map((s) => s.id) } },
    select: { id: true, status: true, exitCode: true, prNumber: true, startedAt: true },
    orderBy: { startedAt: 'desc' },
    take: 15,
  });
  console.log(`\n=== AGENT_RUNS (últimos ${runs.length}) ===`);
  console.table(
    runs.map((r) => ({
      id: r.id.slice(0, 8),
      status: r.status,
      exit: r.exitCode ?? '—',
      pr: r.prNumber ?? '—',
      started: r.startedAt.toISOString().slice(11, 19),
    })),
  );

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
