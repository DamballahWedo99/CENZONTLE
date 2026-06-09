/**
 * Agrega (idempotente) el criterio DoD `code-security` al catálogo EXISTENTE.
 *
 * `DEFAULT_DOD_CRITERIA` solo siembra catálogos VACÍOS — una BD ya sembrada no
 * recibe los kinds nuevos. Este script hace `upsert` por `kind` (que es @unique)
 * para insertar `code-security` sin tocar los demás criterios. Reversible:
 * borrar la fila por kind. Usa la MISMA conexión que el API (adapter-pg +
 * DATABASE_URL del .env del API → Postgres nativo en :5432, no el de Docker).
 *
 * Correr (desde apps/api):  node --env-file=.env scripts/add-code-security-criterion.js
 */
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const KIND = 'code-security';
const TEXT = 'Revisión de seguridad del código (HIGH = bloqueante)';
const DESCRIPTION =
  'Revisión de seguridad profunda del diff (réplica del comando /security-review de Claude Code): un agente de seguridad independiente audita el código nuevo de tu branch buscando vulnerabilidades de ALTA confianza y explotabilidad real — injection (SQL/command/template/NoSQL), path traversal, auth/authz bypass, secretos hardcodeados, crypto débil, RCE por deserialización, XSS, exposición de datos sensibles. Solo los findings HIGH (directamente explotables: RCE, data breach, auth bypass) bloquean la historia; los MEDIUM se reportan para visibilidad pero no fallan. NO introduzcas código que cruce un boundary de privilegio sin validar, que interpole input no saneado en queries/comandos/HTML, ni que loguee secretos en plaintext.';

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL no está set. Verificá apps/api/.env');
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const before = await prisma.dodCriterion.findMany({
      orderBy: { position: 'asc' },
      select: { kind: true, position: true },
    });
    console.log(`Catálogo actual: ${before.length} criterio(s)`);
    before.forEach((c) => console.log(`  [${String(c.position).padStart(2)}] ${c.kind ?? '(custom)'}`));

    const existing = before.find((c) => c.kind === KIND);
    if (existing) {
      console.log(`\n✓ "${KIND}" YA existe (position ${existing.position}). No se hace nada (idempotente).`);
      return;
    }

    // Posición = max + 1 (lo agrega al final; el operador puede reordenar en la UI).
    const maxPosition = before.reduce((m, c) => Math.max(m, c.position), -1);
    const created = await prisma.dodCriterion.create({
      data: { kind: KIND, text: TEXT, description: DESCRIPTION, position: maxPosition + 1 },
      select: { id: true, kind: true, position: true },
    });
    console.log(`\n✓ Insertado "${created.kind}" en position ${created.position} (id ${created.id}).`);

    const after = await prisma.dodCriterion.findMany({
      orderBy: { position: 'asc' },
      select: { kind: true, position: true },
    });
    console.log(`\nCatálogo final: ${after.length} criterio(s)`);
    after.forEach((c) => console.log(`  [${String(c.position).padStart(2)}] ${c.kind ?? '(custom)'}`));
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
