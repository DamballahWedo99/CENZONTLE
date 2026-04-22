/**
 * Mocks de `ProposedStory` para visualizar el DAG de `blockedBy` en staging
 * sin tener que correr el agente completo. Cubren patrones clásicos:
 *
 *   - Historia raíz sin deps (migración)
 *   - Cadena lineal (migración → modelo → endpoint)
 *   - Diamante (endpoint → [frontend, email] que ambos dependen de él)
 *   - Historia paralela sin deps (dashboard de reportes)
 *
 * Reasons cubiertos: migration_order, shared_model, api_contract,
 * sequential_logic. Hardness: hard + soft mezclados.
 *
 * Activar con query param `?mockStoryDeps=true` en la URL de una épica. Ver
 * `EpicFullPage.tsx` para el toggle.
 */

import type { ProposedStory } from '@cenzontle/shared';
import type { StoryDependencyItem } from '@/lib/api/epics';

const MOCK_EPIC_ID = '__mock__';
const MOCK_POD_ID = '__mock-pod__';

// clientIds fijos para poder referenciar entre mocks (las relaciones
// `blockedBy` apuntan a `storyClientId`).
const ID_MIGRATION = 'ai-story-mock-migration';
const ID_MODEL = 'ai-story-mock-model';
const ID_ENDPOINT = 'ai-story-mock-endpoint';
const ID_FRONTEND = 'ai-story-mock-frontend';
const ID_EMAIL = 'ai-story-mock-email';
const ID_DASHBOARD = 'ai-story-mock-dashboard';

/** Shell mínimo de ProposedStory — solo los campos que el card renderiza. */
function mockStory(overrides: Partial<ProposedStory> & {
  clientId: string;
  title: string;
  description: string;
  storyPoints: number;
}): ProposedStory {
  const base = {
    epicId: MOCK_EPIC_ID,
    podId: MOCK_POD_ID,
    sprintId: null,
    status: 'backlog',
    labels: [],
    po: {
      background: '',
      objective: '',
      userStory: '',
      whatHowWhen: { what: '', how: '', when: '' },
      acceptanceCriteria: [],
      additionalNotes: '',
    },
    technical: {
      architecture: '',
      integrationFlow: '',
      validations: [],
      errorHandling: [],
      implementationChecklist: [],
    },
    qa: { testingStrategy: '', linkedQAMatrixId: null },
  };
  return { ...base, ...overrides } as unknown as ProposedStory;
}

export const MOCK_PROPOSED_STORIES: ProposedStory[] = [
  // 1. Raíz: migración de tablas
  mockStory({
    clientId: ID_MIGRATION,
    title: 'Crear tablas `payments` y `payment_attempts`',
    description:
      'Migración Prisma que introduce el modelo relacional de pagos. Columnas: amount, currency, status, attempts.',
    storyPoints: 3,
    labels: ['migration', 'backend'],
    // Sin blockedBy — es la raíz del DAG
  }),

  // 2. Modelo/DTO compartido
  mockStory({
    clientId: ID_MODEL,
    title: 'Modelo y DTO `Payment` compartido',
    description:
      'Type `Payment` en `@cenzontle/shared` + DTO con class-validator. Usado por backend y frontend.',
    storyPoints: 2,
    labels: ['shared', 'dto'],
    blockedBy: [
      {
        storyClientId: ID_MIGRATION,
        hardness: 'hard',
        reason: 'migration_order',
        description: 'El DTO refleja las columnas de la tabla; debe construirse DESPUÉS de la migración.',
      },
    ],
  }),

  // 3. Endpoint — depende de migración Y modelo (diamante-padre)
  mockStory({
    clientId: ID_ENDPOINT,
    title: 'Endpoint `POST /api/checkout/charge`',
    description:
      'Recibe un `PaymentDto`, llama a Stripe, persiste el resultado. Expone la respuesta al frontend.',
    storyPoints: 5,
    labels: ['backend', 'api'],
    blockedBy: [
      {
        storyClientId: ID_MIGRATION,
        hardness: 'hard',
        reason: 'migration_order',
        description: 'El endpoint escribe en la tabla `payments`; requiere el schema.',
      },
      {
        storyClientId: ID_MODEL,
        hardness: 'hard',
        reason: 'shared_model',
        description: 'Valida el body con `PaymentDto` del paquete shared.',
      },
    ],
  }),

  // 4. Frontend — depende del endpoint (soft: puede arrancar con mock)
  mockStory({
    clientId: ID_FRONTEND,
    title: 'Frontend: formulario de checkout',
    description:
      'Captura datos de tarjeta (vía Stripe Elements), envía al endpoint, muestra confirmación o error.',
    storyPoints: 5,
    labels: ['frontend', 'ui'],
    blockedBy: [
      {
        storyClientId: ID_ENDPOINT,
        hardness: 'soft',
        reason: 'api_contract',
        description: 'Consume `POST /api/checkout/charge`. Puede arrancar con mock hasta que el endpoint esté.',
      },
    ],
  }),

  // 5. Email — depende del endpoint (diamante: ambos hijos del endpoint)
  mockStory({
    clientId: ID_EMAIL,
    title: 'Email transaccional de confirmación',
    description:
      'Al completar un payment con status=succeeded, disparar email con el recibo vía SendGrid.',
    storyPoints: 3,
    labels: ['backend', 'email'],
    blockedBy: [
      {
        storyClientId: ID_ENDPOINT,
        hardness: 'hard',
        reason: 'sequential_logic',
        description: 'Solo se puede enviar el email después de que el endpoint confirme el payment.',
      },
    ],
  }),

  // 6. Dashboard — paralelo (sin deps con el resto del batch)
  mockStory({
    clientId: ID_DASHBOARD,
    title: 'Dashboard de reportes de payment',
    description:
      'Vista de admin que agrega los payments por día. SELECT queries de solo lectura a la tabla.',
    storyPoints: 3,
    labels: ['frontend', 'admin'],
    // Sin blockedBy — puede desarrollarse en paralelo al resto del batch
  }),
];

/**
 * Mock equivalente del DAG tal como lo retornaría el endpoint
 * `GET /epicas/:id/story-dependencies` DESPUÉS de aceptar todas las
 * propuestas. Shape diferente al ProposedStory — este es la vista
 * "post-persistencia" con storyIds reales en vez de clientIds.
 *
 * Reutilizamos los mismos títulos que `MOCK_PROPOSED_STORIES` para mantener
 * coherencia visual entre la tab Historias (antes de aceptar) y la tab
 * Dependencias (después de aceptar).
 */
export const MOCK_STORY_DEPENDENCIES: StoryDependencyItem[] = [
  {
    story: { id: 'mock-id-model', title: 'Modelo y DTO `Payment` compartido' },
    blockedBy: [
      {
        story: { id: 'mock-id-migration', title: 'Crear tablas `payments` y `payment_attempts`' },
        hardness: 'hard',
        reason: 'migration_order',
        description:
          'El DTO refleja las columnas de la tabla; debe construirse DESPUÉS de la migración.',
      },
    ],
  },
  {
    story: { id: 'mock-id-endpoint', title: 'Endpoint `POST /api/checkout/charge`' },
    blockedBy: [
      {
        story: { id: 'mock-id-migration', title: 'Crear tablas `payments` y `payment_attempts`' },
        hardness: 'hard',
        reason: 'migration_order',
        description: 'El endpoint escribe en la tabla `payments`; requiere el schema.',
      },
      {
        story: { id: 'mock-id-model', title: 'Modelo y DTO `Payment` compartido' },
        hardness: 'hard',
        reason: 'shared_model',
        description: 'Valida el body con `PaymentDto` del paquete shared.',
      },
    ],
  },
  {
    story: { id: 'mock-id-frontend', title: 'Frontend: formulario de checkout' },
    blockedBy: [
      {
        story: { id: 'mock-id-endpoint', title: 'Endpoint `POST /api/checkout/charge`' },
        hardness: 'soft',
        reason: 'api_contract',
        description:
          'Consume `POST /api/checkout/charge`. Puede arrancar con mock hasta que el endpoint esté.',
      },
    ],
  },
  {
    story: { id: 'mock-id-email', title: 'Email transaccional de confirmación' },
    blockedBy: [
      {
        story: { id: 'mock-id-endpoint', title: 'Endpoint `POST /api/checkout/charge`' },
        hardness: 'hard',
        reason: 'sequential_logic',
        description:
          'Solo se puede enviar el email después de que el endpoint confirme el payment.',
      },
    ],
  },
];
