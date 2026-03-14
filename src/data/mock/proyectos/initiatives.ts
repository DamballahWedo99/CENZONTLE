import { Initiative, InitiativeStatus } from '@/types/proyectos';

export const mockInitiatives: Initiative[] = [
  {
    id: 'init-1',
    name: 'Modernización de Plataforma Digital',
    description:
      'Migración completa del stack tecnológico a microservicios, rediseño de experiencia web y optimización de infraestructura cloud para soportar el crecimiento proyectado 2026-2027.',
    status: InitiativeStatus.Active,
    startDate: '2026-01-06',
    targetDate: '2026-12-31',
    owner: 'VP de Tecnología',
    epicIds: ['epic-1', 'epic-2', 'epic-3', 'epic-4'],
    documents: [],
  },
  {
    id: 'init-2',
    name: 'Integración de Pagos Multi-procesador',
    description:
      'Implementar soporte para múltiples procesadores de pago con retry inteligente, monitoreo en tiempo real y reconciliación automática para mejorar la tasa de aprobación.',
    status: InitiativeStatus.Active,
    startDate: '2026-01-06',
    targetDate: '2026-06-30',
    owner: 'Director de Pagos',
    epicIds: ['epic-5', 'epic-6', 'epic-7', 'epic-8'],
    documents: [],
  },
  {
    id: 'init-3',
    name: 'Programa de Lealtad v2.0',
    description:
      'Rediseño del programa de lealtad con motor de puntos dinámico, catálogo de recompensas expandido e integración con partners estratégicos.',
    status: InitiativeStatus.Planning,
    startDate: '2026-03-01',
    targetDate: '2026-09-30',
    owner: 'Directora de Lealtad',
    epicIds: ['epic-9', 'epic-10', 'epic-11'],
    documents: [],
  },
];
