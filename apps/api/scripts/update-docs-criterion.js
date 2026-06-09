/**
 * Sincroniza la descripción del criterio DoD `docs-updated` en la BD existente
 * con la regla determinística nueva (ver dod.service.ts DEFAULT_DOD_CRITERIA).
 * El gate del worker es determinístico igual; esta descripción es lo que el
 * AGENTE ve en su prompt → le dice exactamente qué satisface el check, así
 * cumple de forma fiable. Idempotente (update por kind @unique).
 *
 * Correr (desde apps/api): node --env-file=.env scripts/update-docs-criterion.js
 */
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const KIND = 'docs-updated';
const DESCRIPTION =
  'Si tu cambio toca código de aplicación, DEBES actualizar documentación en el mismo PR. Regla concreta (el worker la verifica DETERMINÍSTICAMENTE: si el diff toca código, debe tocar también un archivo de docs): actualizá el README con lo que aplique — qué hace la feature, cómo correrla, estructura del proyecto. Escalá la doc al tamaño del cambio: una sección corta en el README para algo simple; para una decisión arquitectónica significativa (elección de patrón, contrato de API, trade-off de diseño) agregá además un ADR en docs/adr/NNNN-titulo.md (un archivo NUEVO por decisión — así no genera conflictos entre historias del mismo sprint). Basta con tocar un archivo de docs (README, cualquier *.md, docs/**, AGENTS.md o CLAUDE.md). Cambios SOLO de config (deps/lockfile) no requieren docs.';

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL no está set. Corré con: node --env-file=.env scripts/update-docs-criterion.js');
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const existing = await prisma.dodCriterion.findUnique({ where: { kind: KIND }, select: { id: true } });
    if (!existing) {
      console.log(`⚠ No existe el criterio "${KIND}" en la BD. Nada que actualizar (¿catálogo sin docs-updated?).`);
      return;
    }
    await prisma.dodCriterion.update({
      where: { kind: KIND },
      data: { description: DESCRIPTION },
    });
    console.log(`✓ Descripción de "${KIND}" actualizada (regla determinística + ADR escalonado).`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
