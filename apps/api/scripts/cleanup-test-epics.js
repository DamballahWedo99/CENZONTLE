/* eslint-disable @typescript-eslint/no-require-imports */
//
// Limpia épicas de pruebas matching prefixes conocidos de test:
//   - "Forge smoke test"   (smoke tests del Forge)
//   - "[E2E TEST]"         (seed-staging-ready-epic.js)
//   - "[TEST]"             (test E2E genérico)
// Postgres ON DELETE CASCADE se encarga de Stories, AgentRuns,
// StoryDependencies y StoryTechnicalDependencies.
//
// Uso:
//   node scripts/cleanup-test-epics.js                            # dry-run, preserva más reciente por prefix
//   node scripts/cleanup-test-epics.js --confirm                  # ejecuta delete, preserva más reciente
//   node scripts/cleanup-test-epics.js --confirm --include-latest # ejecuta delete, NO preserva (cleanup total)
//
// Skip seguro: si una épica candidata tiene runs activos (claimed | running),
// la salta con warning para no matar workers en vivo.
//
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const TITLE_PREFIXES = [
  'Forge smoke test',
  'Forge DAG test',     // seed-trivial-epic.js (épica Popocatépetl)
  'Conflict Minimal',   // seed-conflict-stress-test-minimal.js
  '[E2E TEST]',         // seed-staging-ready-epic.js
  '[TEST]',
];
const ACTIVE_RUN_STATUSES = ['claimed', 'running'];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const includeLatest = args.includes('--include-latest');

(async () => {
  // 1. Lista todas las épicas matching CUALQUIERA de los prefixes,
  //    ordenadas más reciente primero.
  const matching = await prisma.epic.findMany({
    where: {
      OR: TITLE_PREFIXES.map((prefix) => ({ title: { startsWith: prefix } })),
    },
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

  const prefixesLabel = TITLE_PREFIXES.map((p) => `"${p}"`).join(' | ');

  if (matching.length === 0) {
    console.log(`No hay épicas matching ${prefixesLabel}. Nada que hacer.`);
    await prisma.$disconnect();
    return;
  }

  // Si hay 1 y NO se pasó --include-latest, preserve por safety (mantener
  // forensics del último smoke test). Con --include-latest, borra todo
  // incluyendo la más reciente.
  if (matching.length === 1 && !includeLatest) {
    console.log(
      `Solo hay 1 épica matching ${prefixesLabel} — preservada por default.`,
    );
    console.log(`  ✓ KEEP "${matching[0].title}" (${matching[0].id.slice(0, 8)})`);
    console.log(`Si querés borrarla también, corré con --confirm --include-latest`);
    await prisma.$disconnect();
    return;
  }

  // 2. Determinar candidatas vs preservada:
  //    - Sin --include-latest: la primera (más reciente) se preserva
  //    - Con --include-latest: TODAS son candidatas
  const keep = includeLatest ? null : matching[0];
  const candidates = includeLatest ? matching : matching.slice(1);
  console.log(`\nÉpicas matching ${prefixesLabel}: ${matching.length}\n`);
  if (keep) {
    console.log(`  ✓ KEEP    "${keep.title}" (${keep.id.slice(0, 8)})  ${keep.createdAt.toISOString()}`);
  }

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
    const flagHint = includeLatest ? ' --confirm --include-latest' : ' --confirm';
    console.log(`Para ejecutar: node scripts/cleanup-test-epics.js${flagHint}`);
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

  const keepMsg = keep ? ` KEEP: "${keep.title}".` : ' (cleanup total — sin preservar).';
  console.log(`\n✓ ${deletedCount}/${toDelete.length} épica(s) borradas.${keepMsg}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
