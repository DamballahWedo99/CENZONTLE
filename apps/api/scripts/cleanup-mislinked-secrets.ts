/**
 * One-shot cleanup: rompe vínculos `linkedSecretId` incorrectos en
 * `story_technical_dependencies` que se crearon antes del fix de
 * `resolveAllStoryDependenciesByVendor` (2026-05-04).
 *
 * Bug original: el bulk-resolve filtraba solo por `vendor`, así que crear
 * un secret de `AMADEUS_CLIENT_ID` también marcaba como `resolved` las deps
 * de `AMADEUS_CLIENT_SECRET`, `AMADEUS_HOSTNAME`, etc. (mismo vendor pero
 * secrets distintos).
 *
 * Este script identifica esos rows mal-vinculados (donde el title normalizado
 * de la dep NO coincide con el name normalizado del secret) y los desvincula
 * (`linkedSecretId = NULL`, `status = 'identified'`).
 *
 * Idempotente: re-ejecutarlo no toca rows ya correctos.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function normalizeTitle(title: string): string {
  return title
    .replace(
      /^(github\s+secret|secret|credencial|credential|token|api\s+key)\s*:\s*(?=[A-Z_])/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  try {
    // Paso 1: SELECT diagnóstico — traemos todas las deps con linkedSecretId,
    // junto con el name del secret correspondiente.
    const linked = await prisma.storyTechnicalDependency.findMany({
      where: { linkedSecretId: { not: null } },
      select: {
        id: true,
        title: true,
        vendor: true,
        storyId: true,
        linkedSecretId: true,
      },
    });

    if (linked.length === 0) {
      console.log('No hay deps con linkedSecretId. Nada que hacer.');
      return;
    }

    // Para cada dep, traer el secret y comparar normalized titles.
    const secretIds = Array.from(
      new Set(linked.map((d) => d.linkedSecretId!).filter(Boolean)),
    );
    const secrets = await prisma.externalSecret.findMany({
      where: { id: { in: secretIds } },
      select: { id: true, name: true, vendor: true },
    });
    const secretById = new Map(secrets.map((s) => [s.id, s]));

    const mislinked = linked.filter((d) => {
      const s = secretById.get(d.linkedSecretId!);
      if (!s) return false; // secret huérfano — separar
      return normalizeTitle(d.title) !== normalizeTitle(s.name);
    });

    const orphaned = linked.filter((d) => !secretById.has(d.linkedSecretId!));

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('DIAGNÓSTICO');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total deps con linkedSecretId: ${linked.length}`);
    console.log(`Deps mal-vinculadas (title NO coincide con secret.name): ${mislinked.length}`);
    console.log(`Deps con secret huérfano (linkedSecretId apunta a secret borrado): ${orphaned.length}`);

    if (mislinked.length > 0) {
      console.log('\nDeps mal-vinculadas que serán desvinculadas:');
      console.log('─────────────────────────────────────────────');
      for (const d of mislinked) {
        const s = secretById.get(d.linkedSecretId!)!;
        console.log(
          `  - dep.id=${d.id.slice(0, 8)}… title="${d.title}" vendor="${d.vendor ?? '∅'}"`,
        );
        console.log(
          `    → secret.name="${s.name}" vendor="${s.vendor ?? '∅'}"`,
        );
        console.log(
          `    → normalized: dep="${normalizeTitle(d.title)}" vs secret="${normalizeTitle(s.name)}"`,
        );
      }
    }
    if (orphaned.length > 0) {
      console.log('\nDeps con secret huérfano (también serán desvinculadas):');
      console.log('─────────────────────────────────────────────');
      for (const d of orphaned) {
        console.log(
          `  - dep.id=${d.id.slice(0, 8)}… title="${d.title}" → linkedSecretId=${d.linkedSecretId} (secret no existe)`,
        );
      }
    }

    if (mislinked.length === 0 && orphaned.length === 0) {
      console.log('\n✓ No hay rows que limpiar. Todo correctamente vinculado.');
      return;
    }

    // Paso 2: UPDATE — desvincular las mal-linkeadas y huérfanas.
    const idsToUnlink = [...mislinked, ...orphaned].map((d) => d.id);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`APLICANDO UPDATE — desvinculando ${idsToUnlink.length} rows`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const result = await prisma.storyTechnicalDependency.updateMany({
      where: { id: { in: idsToUnlink } },
      data: {
        linkedSecretId: null,
        status: 'identified',
        resolutionNotes: '',
      },
    });

    console.log(`✓ UPDATE aplicado: ${result.count} rows desvinculadas.`);
    console.log('  Las deps quedan en status="identified" — el user las puede re-resolver');
    console.log('  proveyendo el secret correcto para cada title.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
