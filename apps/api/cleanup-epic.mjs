import { PrismaClient } from '@prisma/client';

const EPIC_ID = '5f3db0a3-f3f2-4eb8-ae35-e625952a31a1';
const p = new PrismaClient();

console.log('═══ ANTES DEL CLEANUP ═══\n');

const epicBefore = await p.epic.findUnique({
  where: { id: EPIC_ID },
  select: {
    id: true, title: true, enqueuedAt: true, enqueuedBatchId: true,
    forgeBranch: true,
    stories: { select: { id: true, title: true, status: true, claimedAt: true } },
  },
});

if (!epicBefore) {
  console.log(`Épica ${EPIC_ID} no encontrada.`);
  await p.$disconnect();
  process.exit(1);
}

console.log(`Epic: ${epicBefore.title}`);
console.log(`  enqueuedAt: ${epicBefore.enqueuedAt}`);
console.log(`  enqueuedBatchId: ${epicBefore.enqueuedBatchId}`);
console.log(`  forgeBranch: ${epicBefore.forgeBranch}`);
console.log(`  ${epicBefore.stories.length} stories:`);
for (const s of epicBefore.stories) {
  console.log(`    - ${s.id.slice(0, 8)} status=${s.status} claimedAt=${s.claimedAt ? s.claimedAt.toISOString() : 'null'} title="${s.title.slice(0, 50)}"`);
}

const activeRunsBefore = await p.agentRun.findMany({
  where: {
    storyId: { in: epicBefore.stories.map(s => s.id) },
    status: { in: ['claimed', 'running'] },
  },
  select: { id: true, storyId: true, status: true, startedAt: true },
});
console.log(`\n  AgentRuns activos asociados: ${activeRunsBefore.length}`);
for (const r of activeRunsBefore) {
  console.log(`    - run=${r.id.slice(0, 8)} story=${r.storyId.slice(0, 8)} status=${r.status} startedAt=${r.startedAt.toISOString()}`);
}

console.log('\n═══ EJECUTANDO CLEANUP ═══\n');

const result = await p.$transaction(async (tx) => {
  // 1. Abortar runs activos asociados a las stories de esta épica
  const abortedRuns = await tx.agentRun.updateMany({
    where: {
      storyId: { in: epicBefore.stories.map(s => s.id) },
      status: { in: ['claimed', 'running'] },
    },
    data: {
      status: 'abandoned',
      completedAt: new Date(),
      errorMessage: 'Manual reset (re-enqueue flow para recrear forge integration branch)',
    },
  });

  // 2. Reset de stories — backlog + claimedAt null
  const updatedStories = await tx.story.updateMany({
    where: { epicId: EPIC_ID },
    data: { status: 'backlog', claimedAt: null },
  });

  // 3. Des-encolar la épica
  const updatedEpic = await tx.epic.update({
    where: { id: EPIC_ID },
    data: { enqueuedAt: null, enqueuedBatchId: null },
  });

  return { abortedRuns: abortedRuns.count, updatedStories: updatedStories.count, updatedEpic };
});

console.log(`✓ AgentRuns abortados: ${result.abortedRuns}`);
console.log(`✓ Stories reset (status=backlog, claimedAt=null): ${result.updatedStories}`);
console.log(`✓ Epic des-encolada (enqueuedAt=null, enqueuedBatchId=null)`);

console.log('\n═══ DESPUÉS DEL CLEANUP ═══\n');

const epicAfter = await p.epic.findUnique({
  where: { id: EPIC_ID },
  select: {
    id: true, title: true, enqueuedAt: true, enqueuedBatchId: true,
    forgeBranch: true,
    stories: { select: { id: true, status: true, claimedAt: true } },
  },
});

console.log(`Epic: ${epicAfter.title}`);
console.log(`  enqueuedAt: ${epicAfter.enqueuedAt}`);
console.log(`  enqueuedBatchId: ${epicAfter.enqueuedBatchId}`);
console.log(`  forgeBranch: ${epicAfter.forgeBranch}`);
console.log(`  Stories:`);
for (const s of epicAfter.stories) {
  console.log(`    - ${s.id.slice(0, 8)} status=${s.status} claimedAt=${s.claimedAt ? s.claimedAt.toISOString() : 'null'}`);
}

const activeRunsAfter = await p.agentRun.count({
  where: {
    storyId: { in: epicAfter.stories.map(s => s.id) },
    status: { in: ['claimed', 'running'] },
  },
});
console.log(`\n  AgentRuns activos asociados: ${activeRunsAfter}`);

console.log('\n✓ Cleanup completo. Ahora puedes:');
console.log('  1. Verificar que el run de claude ya esté muerto en tu máquina (pkill -9 -f "claude -p")');
console.log('  2. Reiniciar pnpm run dev');
console.log('  3. PAUSAR el Forge desde /factory/settings → Kill Switch');
console.log('  4. Volver a encolar la épica desde el dashboard');
console.log('  5. Verificar que la integration branch aparece en GitHub');

await p.$disconnect();
