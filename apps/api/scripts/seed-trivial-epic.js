/* eslint-disable @typescript-eslint/no-require-imports */
// Run with: node --env-file=.env scripts/seed-trivial-epic.js
//
// Crea una épica trivial con 1 historia para probar HITO 1.5/1.6/2/4/5 +
// Tier 1 Harness (DoD verifier) E2E sin pasar por la UI de generación de
// épicas. La historia es un toggle binario: "crear archivo .md".
//
// La épica queda automáticamente encolada (enqueuedAt + enqueuedBatchId) —
// AMBOS son requeridos para que listQueue del backend la muestre en
// "IN QUEUE" del Pipeline Board (filter `e.enqueuedAt && e.enqueuedBatchId`).
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  console.log('--- Seed trivial epic ---\n');

  // 1. Pod — usa el primero existente, o crea uno default
  let pod = await prisma.pod.findFirst();
  if (!pod) {
    pod = await prisma.pod.create({
      data: {
        name: 'Forge Test',
        description: 'Pod de prueba para validación E2E del Forge',
        color: '#6366f1',
      },
    });
    console.log(`✓ Pod creado: ${pod.name} (${pod.id.slice(0, 8)})`);
  } else {
    console.log(`✓ Pod existente: ${pod.name} (${pod.id.slice(0, 8)})`);
  }

  // 2. Initiative — usa la primera existente, o crea una default
  let initiative = await prisma.initiative.findFirst();
  if (!initiative) {
    initiative = await prisma.initiative.create({
      data: {
        title: 'Validación del Forge E2E',
        markdown: '# Validación del Forge\n\nIniciativa de prueba para encolar épicas triviales y validar el flujo del Forge.',
        priority: 'low',
        startDate: new Date(),
        targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 días
      },
    });
    console.log(`✓ Initiative creada: ${initiative.title} (${initiative.id.slice(0, 8)})`);
  } else {
    console.log(`✓ Initiative existente: ${initiative.title} (${initiative.id.slice(0, 8)})`);
  }

  // 3. Épica trivial con markdown mínimo
  const epicTitle = `Forge smoke test ${new Date().toISOString().slice(11, 19)}`;
  const epicMarkdown = [
    '## Descripción',
    '',
    'Épica trivial para validar el flow E2E del Forge. La historia crea un archivo markdown en el repo destino.',
    '',
    '## Beneficios cualitativos',
    '',
    '- Valida que el worker clona, ejecuta claude, hace commit + push, y abre PR sin gastar tokens significativos.',
    '',
    '## Beneficios cuantitativos',
    '',
    '- Costo aproximado: $0.01-0.05 USD con Haiku 4.5 (generator) + Sonnet 4.6 (DoD verifier).',
    '',
    '## Medición de beneficios',
    '',
    '- 1 PR abierto automáticamente en el repo destino con el archivo creado.',
    '',
    '## Alcance',
    '',
    '- La historia crea un único archivo markdown en el root del repo.',
    '- NO modifica código existente.',
    '- NO instala dependencias.',
    '',
    '## Criterios de aceptación',
    '',
    '- 1 PR abierto.',
    '- El PR contiene exactamente un archivo nuevo con el contenido especificado.',
    '- Tests del repo destino siguen pasando (no rompemos nada).',
    '',
    '## Mejoras tecnológicas',
    '',
    '- Ninguna — esta es una épica de prueba.',
    '',
    '## Canales y flujos impactados',
    '',
    '- Ninguno.',
    '',
    '## Dependencias de terceros',
    '',
    '- Ninguna.',
  ].join('\n');

  const epic = await prisma.epic.create({
    data: {
      title: epicTitle,
      markdown: epicMarkdown,
      status: 'in_progress',
      priority: 'low',
      startDate: new Date(),
      targetDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      initiativeId: initiative.id,
      // Encolar inmediatamente — AMBOS campos son requeridos para que
      // listQueue del backend la muestre en "IN QUEUE" del Pipeline Board.
      // El filter explícito es `e.enqueuedAt && e.enqueuedBatchId`.
      enqueuedAt: new Date(),
      enqueuedBatchId: randomUUID(),
    },
  });
  console.log(`✓ Épica creada y encolada: "${epic.title}" (${epic.id.slice(0, 8)})`);

  // Asociar pod a la épica via EpicPod (tabla pivote)
  await prisma.epicPod.create({
    data: { epicId: epic.id, podId: pod.id },
  });
  console.log(`✓ EpicPod asociación creada`);

  // 4. 1 Historia trivial con criterios de aceptación claros
  const stories = [
    {
      title: 'Crear FORGE_TEST.md con contenido inicial',
      detail: [
        '## Historia de usuario',
        '',
        'Como operador del Forge, quiero validar que el worker puede crear archivos en el repo destino, para confirmar que el flow E2E funciona (incluyendo Tier 1 Harness con DoD verifier).',
        '',
        '## Criterios de aceptación',
        '',
        '1. Existe un archivo `FORGE_TEST.md` en el root del repo.',
        '2. El contenido del archivo es exactamente:',
        '   ```',
        '   # Forge Test',
        '   ',
        '   Hello from CENZONTLE Forge — historia ejecutada.',
        '   ```',
        '3. El commit message es claro y descriptivo.',
      ].join('\n'),
    },
  ];

  for (const [idx, s] of stories.entries()) {
    const story = await prisma.story.create({
      data: {
        title: s.title,
        status: 'backlog',
        epicId: epic.id,
        podId: pod.id,
        storyPoints: 1,
      },
    });
    console.log(`  ✓ Historia ${idx + 1}/${stories.length}: "${s.title}" (${story.id.slice(0, 8)})`);
    // El detail con criterios va en vault/markdown — pero como el prompt
    // builder usa epic.markdown, no story.markdown, los criterios viajan
    // implícitos vía título de la story por ahora. Si quisieras pasarlos
    // explícitos, el prompt builder tendría que recibirlos también.
  }

  console.log('\n--- LISTO ---');
  console.log(`Epic ID: ${epic.id}`);
  console.log(`Stories: 1, status='backlog', enqueuedAt=NOW()`);
  console.log(`\nPara que el worker la claim:`);
  console.log(`  1. Activa "Forge: write" en tu repo en /factory/settings → Código`);
  console.log(`  2. Reinicia worker: pkill -f "factory-worker start" && factory-worker start`);
  console.log(`  3. En 5s el worker debería empezar a claim historias del epic`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
