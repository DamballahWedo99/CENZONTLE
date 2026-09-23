import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Sample-data seed for the Projects domain.
 *
 * It is IDEMPOTENT and ADDITIVE: everything is written with `upsert` against
 * fixed ids (or against `Pod.name`, which is UNIQUE), so running it twice
 * leaves the database in the same state. It never deletes and never overwrites
 * data it did not create: a pod that already exists under your own name is
 * reused untouched.
 * The previous version ran `deleteMany()` on the domain tables and also
 * referenced the `productOwner` / `podProductOwner` models, dropped from the
 * schema in 8e3b2a0 — it failed to compile before it ever reached the database.
 *
 * Scope: Pod, Initiative, Epic, EpicPod and Story. The Definition of Done
 * catalog (`dod_criteria`) is NOT seeded here: the migrations populate it
 * (`20260508233000_add_dod_criteria`, `20260508250000_dod_evidence_based_defaults`)
 * and `DodService.resetDefaults()` is the only other legitimate writer.
 *
 * The epic's narrative document is a Postgres column (`Epic.markdown`) and this
 * seed writes it below. `Story` has no markdown column, so story prose lives in
 * the vault (GitHub). Either way this seed points at no vault file: every row it
 * creates leaves `vaultPath` null.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Fixed ids (valid UUID v4) that make the seed reproducible: re-running it
// updates the same rows instead of creating duplicates.
const INITIATIVE_ID = 'b1000000-0000-4000-8000-000000000001';
const EPIC_ID = 'c1000000-0000-4000-8000-000000000001';
const STORY_IDS = {
  catalog: 'd1000000-0000-4000-8000-000000000001',
  cart: 'd1000000-0000-4000-8000-000000000002',
  checkoutUi: 'd1000000-0000-4000-8000-000000000003',
} as const;

const POD_SEEDS = [
  {
    id: 'a1000000-0000-4000-8000-000000000001',
    name: 'Plataforma',
    description: 'Servicios de backend, APIs y modelo de datos.',
    color: '#3b82f6',
  },
  {
    id: 'a1000000-0000-4000-8000-000000000002',
    name: 'Experiencia Web',
    description: 'Frontend web, design system y accesibilidad.',
    color: '#22c55e',
  },
] as const;

/**
 * The 9 level-2 headings are the contract that both the epic generator agent and
 * the frontend editor expect (see `epic-generation.service.ts`). If you change
 * them here, change them there too.
 */
const EPIC_MARKDOWN = `## Objetivo

Construir el flujo de compra de la tienda de ejemplo, desde el catálogo hasta
la confirmación del pedido, para tener un recorrido end-to-end con el que
probar la plataforma sin datos de ningún cliente real.

## Beneficios cualitativos

- Un recorrido completo y navegable para demos y onboarding de nuevas personas.
- Menos fricción al evaluar cambios: hay un caso de uso concreto sobre el que razonar.

## Beneficios cuantitativos

- Onboarding de una persona nueva en < 1 día en vez de varios.
- 3 historias de ejemplo disponibles desde el primer arranque local.

## Medición de beneficios

- Tiempo desde \`git clone\` hasta ver datos en la UI (medido a mano en onboarding).
- Número de historias visibles en el tablero tras correr \`prisma db seed\`.

## Alcance

En alcance:

- Listado de productos con búsqueda simple.
- Carrito persistente por sesión.
- Pantalla de checkout con resumen del pedido.

Fuera de alcance:

- Cobros reales o integración con cualquier pasarela de pago.
- Envíos, impuestos y devoluciones.

## Criterios de aceptación

1. El listado de productos responde en menos de 300 ms con el dataset de ejemplo.
2. Agregar un producto al carrito actualiza el total sin recargar la página.
3. La pantalla de checkout muestra los ítems, el subtotal y el total del pedido.

## Mejoras tecnológicas

- Establece el patrón de módulo NestJS + cliente tipado que reusan las demás épicas.
- Deja un dataset de ejemplo estable para tests de integración.

## Canales y flujos impactados

- Canal: web (desktop y mobile).
- Flujos: descubrimiento de catálogo, carrito y checkout.

## Dependencias de terceros

- Ninguna. La épica de ejemplo es deliberadamente autocontenida para poder
  correrla sin credenciales externas.
`;

async function main() {
  // 1. Pods — upsert by `name` (UNIQUE). If the pod already exists under a
  // different id, keep that id and use it for the relations below.
  const pods = new Map<string, string>();
  for (const pod of POD_SEEDS) {
    const row = await prisma.pod.upsert({
      where: { name: pod.name },
      // Empty `update` on purpose. Unlike every row below, a Pod is matched by
      // its NAME — a natural key a real team may already be using. Writing
      // `description`/`color` here would overwrite that team's row, which a
      // sample seed has no business doing. An existing pod is left exactly as
      // it is and only reused for the relations.
      update: {},
      create: { id: pod.id, name: pod.name, description: pod.description, color: pod.color },
    });
    pods.set(pod.name, row.id);
  }

  const platformPodId = pods.get('Plataforma')!;
  const webPodId = pods.get('Experiencia Web')!;

  // 2. Initiative.
  await prisma.initiative.upsert({
    where: { id: INITIATIVE_ID },
    update: {
      name: 'Tienda de ejemplo',
      description:
        'Iniciativa de ejemplo para explorar CENZONTLE: una tienda online mínima con catálogo, carrito y checkout.',
      status: 'active',
      startDate: new Date('2026-01-05T00:00:00Z'),
      targetDate: new Date('2026-06-30T00:00:00Z'),
      owner: 'Equipo de Producto',
    },
    create: {
      id: INITIATIVE_ID,
      name: 'Tienda de ejemplo',
      description:
        'Iniciativa de ejemplo para explorar CENZONTLE: una tienda online mínima con catálogo, carrito y checkout.',
      status: 'active',
      startDate: new Date('2026-01-05T00:00:00Z'),
      targetDate: new Date('2026-06-30T00:00:00Z'),
      owner: 'Equipo de Producto',
    },
  });

  // 3. Epic. The `update` touches descriptive fields only: the Forge timestamps
  // (enqueuedAt, stagingApprovedAt, qaStartedAt, releaseApprovedAt…) are left
  // intact so a re-run cannot resurrect or overwrite the state of a batch in
  // flight.
  await prisma.epic.upsert({
    where: { id: EPIC_ID },
    update: {
      title: 'Checkout de la tienda de ejemplo',
      markdown: EPIC_MARKDOWN,
      priority: 'high',
    },
    create: {
      id: EPIC_ID,
      title: 'Checkout de la tienda de ejemplo',
      markdown: EPIC_MARKDOWN,
      status: 'draft',
      priority: 'high',
      startDate: new Date('2026-02-02T00:00:00Z'),
      targetDate: new Date('2026-04-30T00:00:00Z'),
      initiativeId: INITIATIVE_ID,
    },
  });

  // 4. Epic ↔ pod assignment (join table with a composite PK).
  for (const podId of [platformPodId, webPodId]) {
    await prisma.epicPod.upsert({
      where: { epicId_podId: { epicId: EPIC_ID, podId } },
      update: {},
      create: { epicId: EPIC_ID, podId },
    });
  }

  // 5. Stories.
  const stories = [
    {
      id: STORY_IDS.catalog,
      title: 'Listar productos del catálogo',
      podId: platformPodId,
      storyPoints: 3,
      labels: ['backend', 'api'],
    },
    {
      id: STORY_IDS.cart,
      title: 'Agregar y quitar productos del carrito',
      podId: platformPodId,
      storyPoints: 5,
      labels: ['backend'],
    },
    {
      id: STORY_IDS.checkoutUi,
      title: 'Pantalla de checkout con resumen del pedido',
      podId: webPodId,
      storyPoints: 5,
      labels: ['frontend', 'ui'],
    },
  ];

  for (const story of stories) {
    await prisma.story.upsert({
      where: { id: story.id },
      update: {
        title: story.title,
        podId: story.podId,
        storyPoints: story.storyPoints,
        labels: story.labels,
      },
      create: {
        id: story.id,
        title: story.title,
        epicId: EPIC_ID,
        podId: story.podId,
        status: 'backlog',
        storyPoints: story.storyPoints,
        labels: story.labels,
      },
    });
  }

  console.log(
    `Seed complete (idempotent): ${POD_SEEDS.length} pods, 1 initiative, 1 epic, ${stories.length} stories.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    // exitCode instead of process.exit(): lets the `finally` close the
    // connection before the process exits.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
