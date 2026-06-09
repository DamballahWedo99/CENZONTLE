/**
 * seed-homepage-poc.js — Crea (y opcionalmente encola) la épica PoC
 * "Homepage Web — Landing de vuelos". Equivalente reusable de la épica original
 * (que no tenía seed). Replicable on-demand para demos.
 *
 *   node --env-file=.env scripts/seed-homepage-poc.js            # crea (NO encola)
 *   node --env-file=.env scripts/seed-homepage-poc.js --enqueue  # crea Y encola al Forge
 *   node --env-file=.env scripts/seed-homepage-poc.js --cleanup  # borra las previas
 *
 * OJO: encolar dispara un run real del Forge (en el run original costó ~$46 y
 * tardó horas). Por eso NO encola por default.
 */
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const args = new Set(process.argv.slice(2));
const DO_ENQUEUE = args.has('--enqueue');
const DO_CLEANUP = args.has('--cleanup');
const TITLE = 'Homepage Web — Landing de vuelos (PoC)';

const EPIC_MD = [
  '## Descripción',
  '',
  'Landing page de Aerovía (aerolínea comercial): un buscador de vuelos como hero',
  'más una sección de destinos destacados. Frontend React + TypeScript con Vite.',
  '',
  '## Criterios de aceptación',
  '',
  '- **Header**: logo "Aerovía" + navegación (Vuelos, Destinos, Ayuda).',
  '- **Hero con buscador de vuelos**: campos Origen, Destino, Fecha de salida y botón "Buscar".',
  '  - Si el usuario busca sin Origen, mostrar el error "Selecciona un aeropuerto de origen"',
  '    bajo el campo, y marcar el campo con borde rojo (clase `border-red-500`).',
  '- **Destinos destacados**: grid de tarjetas con imagen, ciudad y precio "desde".',
  '  - Filtro por categoría (Playa / Ciudad / Naturaleza). Si el filtro no tiene resultados,',
  '    mostrar el placeholder centrado "Sin destinos en esta categoria por ahora".',
  '- **Imagen hero**: si la imagen falla al cargar, aplicar un color de fallback.',
  '- **Calidad**: responsive (móvil + desktop), accesible (roles/aria), sin errores de lint/type-check,',
  '  build de producción OK, y tests (Vitest) para el happy path + los casos de error descritos.',
  '- **Docs**: README con qué hace, estructura y cómo correrlo.',
].join('\n');

const STORY_TITLE =
  'Implementar la landing de vuelos de Aerovía en React + TypeScript (Vite): header con logo y nav; ' +
  'hero con buscador (Origen/Destino/Fecha/Buscar) que valida Origen requerido mostrando ' +
  '"Selecciona un aeropuerto de origen" con borde rojo; grid de destinos destacados con filtro por ' +
  'categoría y placeholder "Sin destinos en esta categoria por ahora" cuando no hay resultados; ' +
  'imagen hero con color de fallback si falla; responsive y accesible; tests (Vitest) del happy path ' +
  'y los casos de error; lint/type-check/build en verde; README con estructura y cómo correrlo.';

(async () => {
  if (!process.env.DATABASE_URL) { console.error('✗ DATABASE_URL no set'); process.exit(1); }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    if (DO_CLEANUP) {
      const prev = await prisma.epic.findMany({ where: { title: { startsWith: 'Homepage Web — Landing de vuelos' } }, select: { id: true, stories: { select: { id: true } } } });
      const sids = prev.flatMap((e) => e.stories.map((s) => s.id));
      if (sids.length) await prisma.agentRun.deleteMany({ where: { storyId: { in: sids } } });
      const d = await prisma.epic.deleteMany({ where: { title: { startsWith: 'Homepage Web — Landing de vuelos' } } });
      console.log(`Cleanup: ${d.count} épica(s) previa(s) borrada(s).`);
      if (!args.has('--enqueue') && !args.has('--create')) return;
    }

    const initiative = await prisma.initiative.findFirst({ select: { id: true, name: true } });
    const pod = await prisma.pod.findFirst({ select: { id: true, name: true } });
    if (!initiative || !pod) { console.error('✗ Falta una Initiative o un Pod en la BD.'); process.exit(1); }

    const now = new Date();
    const batchId = DO_ENQUEUE ? randomUUID() : null;
    const epic = await prisma.epic.create({
      data: {
        title: TITLE,
        markdown: EPIC_MD,
        status: 'in_progress',
        priority: 'critical',
        startDate: now,
        targetDate: new Date(now.getTime() + 7 * 86400000),
        initiativeId: initiative.id,
        ...(DO_ENQUEUE ? { enqueuedAt: now, enqueuedBatchId: batchId } : {}),
        pods: { create: [{ podId: pod.id }] },
        stories: { create: [{ title: STORY_TITLE, status: 'backlog', storyPoints: 5, podId: pod.id, vaultPath: null }] },
      },
      select: { id: true, stories: { select: { id: true } } },
    });

    console.log(`✓ Épica creada: ${epic.id}  ("${TITLE}")`);
    console.log(`✓ Story creada: ${epic.stories[0].id}`);
    console.log(`  Iniciativa: ${initiative.name} · Pod: ${pod.name}`);
    if (DO_ENQUEUE) console.log(`✓ ENCOLADA (batch ${batchId}). ⚠ Si el worker está arriba, dispara un run real (caro: ~$46 / horas en el original).`);
    else console.log('• NO encolada. Para correrla: enviála al Forge desde la UI, o re-corré con --enqueue.');
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error('✗ Error:', e.message); process.exit(1); });
