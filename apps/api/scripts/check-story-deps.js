#!/usr/bin/env node
/**
 * Verificación rápida de StoryDependency post-seed.
 *
 * Imprime las hard-deps de las stories del epic Popocatépetl creadas por
 * `seed-trivial-epic.js`. Esperado: 2 rows mostrando que la story C
 * (index.html) está blocked-by tanto A (info-card.html) como B (history.html).
 *
 * Uso:
 *   node apps/api/scripts/check-story-deps.js
 *
 * Reusa el cliente Prisma del API (no requiere psql en PATH).
 */
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const path = require('path');

// Prisma 7 requiere adapter explícito (no más `new PrismaClient()` solo).
// Mismo pattern que `seed-trivial-epic.js` para consistencia.
// Auto-cargar apps/api/.env si DATABASE_URL no está en el ambiente.
// Node ≥ 20 soporta `process.loadEnvFile()` nativo (sin lib dotenv).
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
  } catch {
    // .env no existe — caemos al error de abajo con guía clara.
  }
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL no está seteada y no se pudo cargar apps/api/.env');
  console.error('   Opción A: exportá manualmente:');
  console.error('     export DATABASE_URL="postgresql://..."');
  console.error('   Opción B: pasá flag explícito:');
  console.error('     node --env-file=apps/api/.env apps/api/scripts/check-story-deps.js');
  process.exit(1);
}
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  try {
    const stories = await prisma.story.findMany({
      where: {
        OR: [
          { title: { contains: 'Popocat' } },
          { title: { contains: 'info-card' } },
          { title: { contains: 'history' } },
          { title: { contains: 'index.html' } },
        ],
      },
      include: {
        blockedBy: {
          include: {
            blockedBy: { select: { title: true, id: true } },
          },
        },
      },
      orderBy: { title: 'asc' },
    });

    if (stories.length === 0) {
      console.log('⚠️  No se encontraron stories del epic Popocatépetl.');
      console.log('   ¿Corriste `node apps/api/scripts/seed-trivial-epic.js` primero?');
      process.exit(1);
    }

    console.log(`\n=== Stories del epic Popocatépetl (${stories.length} total) ===\n`);
    for (const s of stories) {
      const shortId = s.id.slice(0, 8);
      const depCount = s.blockedBy.length;
      console.log(`📄 ${s.title}`);
      console.log(`   id: ${shortId}  status: ${s.status}  deps: ${depCount}`);
      if (depCount === 0) {
        console.log(`   (sin dependencias — Wave 0)`);
      } else {
        for (const dep of s.blockedBy) {
          console.log(`   ← bloqueada por: "${dep.blockedBy.title}" (${dep.hardness})`);
        }
      }
      console.log();
    }

    const totalHardDeps = stories.reduce(
      (sum, s) => sum + s.blockedBy.filter((d) => d.hardness === 'hard').length,
      0,
    );
    console.log(`=== Resumen ===`);
    console.log(`Total stories: ${stories.length}`);
    console.log(`Hard dependencies: ${totalHardDeps}`);

    if (stories.length === 3 && totalHardDeps === 2) {
      console.log(`\n✅ DAG correcto: 3 stories, 2 hard-deps (Wave 0: A,B → Wave 1: C)`);
    } else {
      console.log(`\n⚠️  DAG inesperado — esperaba 3 stories + 2 hard-deps`);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
