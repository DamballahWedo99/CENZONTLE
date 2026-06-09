/**
 * Imprime el estado del último AgentRun de una story + el resumen de DoD
 * (status por criterio). Útil para ver el outcome de un run del Forge sin
 * leer los logs del worker. Usa la misma conexión que el API (BD nativa).
 *
 * Correr (desde apps/api):
 *   node --env-file=.env scripts/check-run-status.js <storyId>
 */
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const storyId = process.argv[2];
if (!storyId) {
  console.error('Uso: node --env-file=.env scripts/check-run-status.js <storyId>');
  process.exit(1);
}

(async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { title: true, status: true },
    });
    if (!story) {
      console.log(`Story ${storyId} no existe.`);
      return;
    }
    console.log(`Story: ${story.title.slice(0, 70)}`);
    console.log(`Story.status: ${story.status}`);

    const run = await prisma.agentRun.findFirst({
      where: { storyId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, exitCode: true, attempts: true, branch: true, dodVerification: true, startedAt: true },
    });
    if (!run) {
      console.log('Aún SIN agent_run (el worker todavía no la claimó).');
      return;
    }
    console.log(`\nRun ${run.id.slice(0, 8)} → status=${run.status} exitCode=${run.exitCode ?? '?'} attempts=${run.attempts} branch=${run.branch ?? '?'}`);

    // dodVerification es un array de attempts: [{ attempt, verdicts: [{ kind, label, status, reason }] }]
    const dod = run.dodVerification;
    if (Array.isArray(dod) && dod.length > 0) {
      const last = dod[dod.length - 1];
      const verdicts = Array.isArray(last?.verdicts) ? last.verdicts : [];
      console.log(`\nDoD (attempt ${last.attempt ?? '?'}): ${verdicts.length} criterio(s)`);
      for (const v of verdicts) {
        const mark = v.status === 'passed' ? '✓' : v.status === 'failed' ? '✗' : v.status === 'skipped' ? '–' : '?';
        console.log(`  ${mark} [${v.status}] ${v.kind ?? v.label}: ${(v.reason ?? '').slice(0, 90)}`);
        // Para los failed, volcamos el output completo (stdout/stderr del comando)
        // para diagnóstico — ahí está el error real (ej. por qué falló el lint).
        if (v.status === 'failed' && v.output) {
          console.log(`    ── output ──\n${String(v.output).split('\n').map((l) => `    ${l}`).join('\n')}`);
        }
      }
    } else {
      console.log('\n(sin dodVerification todavía — el run aún no llegó a la fase DoD)');
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
