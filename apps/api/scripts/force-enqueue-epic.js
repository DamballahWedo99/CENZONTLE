/* eslint-disable @typescript-eslint/no-require-imports */
// Run with: node --env-file=.env scripts/force-enqueue-epic.js [epicId]
//
// Toma una épica existente y la deja LISTA para el Forge sin pasar por la
// UI de protocolos (Definición / Diagrama / 3 VoBos). Es un atajo para
// validar el flow E2E sin gastar tokens en generación de diagramas.
//
// Operaciones:
//  1. Cambia/asegura los 9 headings requeridos en epic.markdown
//  2. Inserta un diagrama mock (`type: 'business'`) en epic.diagrams
//  3. Marca los 3 VoBos como `status: 'approved'`
//  4. Confirma que enqueuedAt está set
//
// Si no se pasa epicId, toma la última épica encolada.
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const REQUIRED_HEADINGS = [
  '## Objetivo',
  '## Beneficios cualitativos',
  '## Beneficios cuantitativos',
  '## Medición de beneficios',
  '## Alcance',
  '## Criterios de aceptación',
  '## Mejoras tecnológicas',
  '## Canales y flujos impactados',
  '## Dependencias de terceros',
];

(async () => {
  const argEpicId = process.argv[2];
  let epic;
  if (argEpicId) {
    epic = await prisma.epic.findUnique({ where: { id: argEpicId } });
    if (!epic) {
      console.error(`✗ Epic ${argEpicId} no encontrada`);
      process.exit(1);
    }
  } else {
    epic = await prisma.epic.findFirst({
      where: { enqueuedAt: { not: null } },
      orderBy: { enqueuedAt: 'desc' },
    });
    if (!epic) {
      console.error('✗ No hay épicas encoladas. Pasa epicId como argumento.');
      process.exit(1);
    }
  }
  console.log(`→ Epic: "${epic.title}" (${epic.id.slice(0, 8)})`);

  // 1. Markdown — agregar headings faltantes al final si no existen
  let markdown = epic.markdown;
  const headingRegex = (h) => new RegExp(`^${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm');
  const missing = REQUIRED_HEADINGS.filter((h) => !headingRegex(h).test(markdown));
  if (missing.length > 0) {
    console.log(`  Agregando ${missing.length} heading(s) faltantes: ${missing.join(', ')}`);
    const sectionTexts = {
      '## Objetivo':
        'Validar el flow E2E del Forge creando archivos markdown triviales — sin lógica de negocio compleja, solo confirmar que clone/commit/push/PR funcionan.',
      '## Beneficios cualitativos': 'Confianza en el pipeline antes de épicas reales.',
      '## Beneficios cuantitativos': 'Costo aproximado: $0.01 USD con Haiku 4.5.',
      '## Medición de beneficios': '3 PRs abiertos automáticamente en el repo destino.',
      '## Alcance': 'Crear 3 archivos markdown triviales. NO modifica código existente.',
      '## Criterios de aceptación': '3 PRs abiertos, uno por historia, con el archivo correspondiente.',
      '## Mejoras tecnológicas': 'Ninguna — épica de prueba.',
      '## Canales y flujos impactados': 'Ninguno.',
      '## Dependencias de terceros': 'Ninguna.',
    };
    for (const h of missing) {
      markdown += `\n\n${h}\n\n${sectionTexts[h] ?? '(placeholder)'}`;
    }
  } else {
    console.log('  ✓ Todos los headings ya presentes');
  }

  // 2. Diagrama mock con type='business'
  const currentDiagrams = (epic.diagrams ?? []);
  const hasBusiness = Array.isArray(currentDiagrams) && currentDiagrams.some((d) => d?.type === 'business');
  let newDiagrams = currentDiagrams;
  if (!hasBusiness) {
    console.log('  Agregando diagrama mock type=business');
    newDiagrams = [
      ...(Array.isArray(currentDiagrams) ? currentDiagrams : []),
      {
        type: 'business',
        nodes: [
          { id: 'n1', type: 'actor', label: 'Operador del Forge' },
          { id: 'n2', type: 'service', label: 'Repositorio de la app' },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', label: 'commits' }],
        generatedAt: new Date().toISOString(),
        generatedBy: 'force-enqueue-script',
      },
    ];
  } else {
    console.log('  ✓ Diagrama de negocio ya presente');
  }

  // 3. VoBos: aprobar los 3
  const now = new Date().toISOString();
  const approval = (role) => ({
    status: 'approved',
    approvedAt: now,
    approvedBy: 'force-enqueue-script',
    role,
    comment: 'Auto-aprobado por script de validación E2E del Forge.',
  });
  const data = {
    markdown,
    diagrams: newDiagrams,
    poApproval: approval('po'),
    tlApproval: approval('tl'),
    qaApproval: approval('qa'),
  };
  // 4. enqueuedAt — idempotente, solo si no estaba
  if (!epic.enqueuedAt) {
    data.enqueuedAt = new Date();
    console.log('  Seteando enqueuedAt');
  } else {
    console.log(`  ✓ enqueuedAt ya estaba set: ${epic.enqueuedAt.toISOString()}`);
  }

  await prisma.epic.update({ where: { id: epic.id }, data });
  console.log('\n✓ Epic actualizada — protocolos completos en DB.');
  console.log('  Recarga la UI de la épica para ver todos los círculos en verde.');
  console.log('  El worker ya puede claim sus stories.');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
