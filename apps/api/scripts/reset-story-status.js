#!/usr/bin/env node
/**
 * Reset el status de stories que matcheen un título (substring) a 'backlog'
 * + clear de `claimedAt`. Útil para desbloquear stories en estado 'failed'
 * que querés que el worker re-claim sin re-seedear el batch entero.
 *
 * Reusa el cliente Prisma del API (no requiere psql en PATH).
 *
 * Uso:
 *   node apps/api/scripts/reset-story-status.js <titleSubstring>
 *
 * Ejemplos:
 *   node apps/api/scripts/reset-story-status.js info-card.html
 *   node apps/api/scripts/reset-story-status.js "Popocat"
 *
 * Si no se pasa argumento, imprime usage y sale sin hacer nada (defensa
 * contra accidentes del tipo `node script.js` que afectaría TODAS las stories).
 */
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const path = require('path');

// Auto-cargar apps/api/.env si DATABASE_URL no está en el ambiente.
// Node ≥ 20.x soporta `process.loadEnvFile()` nativamente (sin dependencia
// extra como `dotenv`). Buscamos el .env relativo al script para que el
// usuario pueda correr `node script.js` desde CUALQUIER directorio sin
// tener que pasar `--env-file=...` manualmente.
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    process.loadEnvFile(envPath);
  } catch (err) {
    // .env no existe o no es legible — caemos al chequeo de abajo.
  }
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL no está seteada y no se pudo cargar apps/api/.env');
  console.error('   Opción A: exportá la variable manualmente:');
  console.error('     export DATABASE_URL="postgresql://..."');
  console.error('   Opción B: corré el script con flag explícito:');
  console.error('     node --env-file=apps/api/.env apps/api/scripts/reset-story-status.js <filter>');
  process.exit(1);
}

const titleFilter = process.argv[2];
if (!titleFilter || titleFilter.trim().length === 0) {
  console.error('Usage: node reset-story-status.js <titleSubstring>');
  console.error('');
  console.error('Examples:');
  console.error('  node reset-story-status.js info-card.html');
  console.error('  node reset-story-status.js "Popocat"');
  console.error('');
  console.error('NO se pasó filtro — abort para evitar reset accidental masivo.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  try {
    // PASS 1: encontrar las stories que matchean para mostrar al operador
    // ANTES de modificar (preview defensivo).
    const matching = await prisma.story.findMany({
      where: { title: { contains: titleFilter } },
      select: {
        id: true,
        title: true,
        status: true,
        claimedAt: true,
        epicId: true,
      },
    });

    if (matching.length === 0) {
      console.log(`⚠️  No matching stories with title containing "${titleFilter}"`);
      process.exit(0);
    }

    console.log(`\n=== Stories matching "${titleFilter}" (${matching.length}) ===\n`);
    for (const s of matching) {
      const claimMark = s.claimedAt ? '🔒 claimed' : '🆓 unclaimed';
      console.log(`  ${s.id.slice(0, 8)}  status=${s.status.padEnd(12)} ${claimMark}  ${s.title}`);
    }

    // PASS 2: aplicar el reset (status='backlog', claimedAt=null)
    const result = await prisma.story.updateMany({
      where: { title: { contains: titleFilter } },
      data: { status: 'backlog', claimedAt: null },
    });

    console.log(`\n✅ Reseteadas ${result.count} stor${result.count === 1 ? 'y' : 'ies'} a status='backlog', claimedAt=null`);
    console.log(`   El worker las re-claimeará en el próximo poll (5s).`);

    // Bonus: si hay AgentRun con status='running' o 'claimed' para estas
    // stories, marcarlos como 'failed' para que no queden zombie en la queue.
    const orphanRunsResult = await prisma.agentRun.updateMany({
      where: {
        storyId: { in: matching.map((s) => s.id) },
        status: { in: ['running', 'claimed'] },
      },
      data: {
        status: 'failed',
        errorMessage: 'Run abandoned via reset-story-status.js (story re-set to backlog)',
        completedAt: new Date(),
      },
    });

    if (orphanRunsResult.count > 0) {
      console.log(`✅ Cerrados ${orphanRunsResult.count} AgentRun zombies (status running/claimed → failed)`);
    }

    console.log(`\nProximos pasos:`);
    console.log(`  1. Verificar que el worker está corriendo: ps aux | grep factory-worker`);
    console.log(`  2. Si no está corriendo: FACTORY_WORKER_ALLOW_INSECURE=1 factory-worker start`);
    console.log(`  3. Esperar el próximo poll (~5s) y monitorear logs por claim.received`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
