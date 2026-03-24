/**
 * Mock AI Story Generation Agent
 *
 * In production this would call an LLM API with context from the epic definition,
 * the business diagram, and the existing microservices repositories to generate
 * structured user stories. For now we simulate the agent by parsing the epic fields
 * and generating realistic stories.
 */

import { Epic, UserStory, StoryStatus } from '@cenzontle/shared';

interface StoryTemplate {
  keywords: string[];
  stories: Array<{
    titleTemplate: string;
    descriptionTemplate: string;
    acceptanceCriteria: string[];
    points: number;
    labels: string[];
  }>;
}

const storyTemplates: StoryTemplate[] = [
  {
    keywords: ['checkout', 'compra', 'boleto', 'carrito'],
    stories: [
      {
        titleTemplate: 'Implementar flujo de selección de productos',
        descriptionTemplate: 'Como usuario, quiero poder seleccionar productos y agregarlos al carrito para proceder con la compra.',
        acceptanceCriteria: ['El usuario puede agregar/eliminar items', 'Se muestra resumen actualizado', 'Validación de disponibilidad en tiempo real'],
        points: 8, labels: ['frontend', 'checkout'],
      },
      {
        titleTemplate: 'Desarrollar pantalla de resumen de compra',
        descriptionTemplate: 'Como usuario, quiero ver un resumen detallado de mi compra antes de confirmar el pago.',
        acceptanceCriteria: ['Desglose de precios visible', 'Impuestos calculados correctamente', 'Opción de aplicar cupón/descuento'],
        points: 5, labels: ['frontend', 'checkout'],
      },
      {
        titleTemplate: 'Integrar validación de datos del comprador',
        descriptionTemplate: 'Como sistema, necesito validar los datos del comprador antes de procesar el pago.',
        acceptanceCriteria: ['Validación de email en tiempo real', 'Validación de datos fiscales', 'Mensajes de error claros'],
        points: 3, labels: ['backend', 'validation'],
      },
    ],
  },
  {
    keywords: ['pago', 'payment', 'procesador', 'transacción', 'cobro'],
    stories: [
      {
        titleTemplate: 'Implementar integración con procesador de pagos',
        descriptionTemplate: 'Como sistema, necesito procesar pagos de forma segura a través del procesador configurado.',
        acceptanceCriteria: ['Tokenización de tarjetas', 'Manejo de errores del procesador', 'Logging de transacciones'],
        points: 13, labels: ['backend', 'payments'],
      },
      {
        titleTemplate: 'Desarrollar pantalla de selección de método de pago',
        descriptionTemplate: 'Como usuario, quiero seleccionar entre diferentes métodos de pago disponibles.',
        acceptanceCriteria: ['Mostrar métodos habilitados', 'Validación por tipo de tarjeta', 'Soporte para pagos alternativos'],
        points: 5, labels: ['frontend', 'payments'],
      },
      {
        titleTemplate: 'Implementar confirmación y recibo de pago',
        descriptionTemplate: 'Como usuario, quiero recibir confirmación inmediata de mi pago con un recibo detallado.',
        acceptanceCriteria: ['Pantalla de confirmación', 'Envío de email con recibo', 'Descarga de comprobante PDF'],
        points: 5, labels: ['fullstack', 'payments'],
      },
    ],
  },
  {
    keywords: ['microservicio', 'api', 'servicio', 'backend', 'migración'],
    stories: [
      {
        titleTemplate: 'Definir contratos de API del servicio',
        descriptionTemplate: 'Como desarrollador, necesito contratos OpenAPI claros para integrar con el nuevo servicio.',
        acceptanceCriteria: ['Spec OpenAPI 3.1 documentada', 'Ejemplos de request/response', 'Versionado de endpoints'],
        points: 5, labels: ['backend', 'api'],
      },
      {
        titleTemplate: 'Implementar health checks y readiness probes',
        descriptionTemplate: 'Como SRE, necesito endpoints de health y readiness para monitoreo del servicio.',
        acceptanceCriteria: ['Endpoint /health funcional', 'Readiness probe con verificación de dependencias', 'Métricas de latencia expuestas'],
        points: 3, labels: ['backend', 'infra'],
      },
      {
        titleTemplate: 'Configurar pipeline de CI/CD del servicio',
        descriptionTemplate: 'Como desarrollador, necesito un pipeline automatizado para build, test y deploy.',
        acceptanceCriteria: ['Build automatizado en PR', 'Tests unitarios e integración', 'Deploy a staging automático'],
        points: 5, labels: ['devops', 'ci-cd'],
      },
    ],
  },
  {
    keywords: ['monitoreo', 'dashboard', 'métricas', 'alerta', 'observabilidad'],
    stories: [
      {
        titleTemplate: 'Diseñar e implementar dashboard de métricas',
        descriptionTemplate: 'Como operador, quiero un dashboard con las métricas clave del sistema en tiempo real.',
        acceptanceCriteria: ['Métricas actualizadas cada 30s', 'Filtros por rango de fechas', 'Drill-down por dimensión'],
        points: 8, labels: ['frontend', 'monitoring'],
      },
      {
        titleTemplate: 'Configurar alertas automáticas',
        descriptionTemplate: 'Como SRE, quiero alertas automáticas cuando las métricas excedan umbrales configurados.',
        acceptanceCriteria: ['Alertas por Slack y email', 'Umbrales configurables sin deploy', 'Escalamiento automático'],
        points: 5, labels: ['backend', 'monitoring'],
      },
    ],
  },
  {
    keywords: ['lealtad', 'punto', 'loyalty', 'recompensa', 'redención'],
    stories: [
      {
        titleTemplate: 'Implementar motor de reglas de acumulación',
        descriptionTemplate: 'Como sistema, necesito calcular puntos de lealtad según reglas dinámicas configurables.',
        acceptanceCriteria: ['Reglas configurables por segmento', 'Multiplicadores por temporada', 'Cálculo en < 100ms'],
        points: 13, labels: ['backend', 'loyalty'],
      },
      {
        titleTemplate: 'Desarrollar flujo de redención de puntos',
        descriptionTemplate: 'Como usuario, quiero canjear mis puntos por productos o servicios del catálogo.',
        acceptanceCriteria: ['Verificación de balance en tiempo real', 'Confirmación antes del canje', 'Actualización inmediata de saldo'],
        points: 8, labels: ['fullstack', 'loyalty'],
      },
      {
        titleTemplate: 'Crear estado de cuenta de puntos',
        descriptionTemplate: 'Como usuario, quiero ver mi historial de acumulación y redención de puntos.',
        acceptanceCriteria: ['Historial paginado', 'Filtros por tipo de movimiento', 'Balance actual prominente'],
        points: 5, labels: ['frontend', 'loyalty'],
      },
    ],
  },
  {
    keywords: ['reconciliación', 'contable', 'conciliación', 'discrepancia'],
    stories: [
      {
        titleTemplate: 'Implementar ingesta de archivos de procesadores',
        descriptionTemplate: 'Como sistema, necesito procesar archivos de conciliación de cada procesador de pagos.',
        acceptanceCriteria: ['Soporte para formatos CSV y XML', 'Validación de integridad', 'Logging de archivos procesados'],
        points: 8, labels: ['backend', 'reconciliation'],
      },
      {
        titleTemplate: 'Desarrollar algoritmo de matching automático',
        descriptionTemplate: 'Como sistema, necesito hacer match automático entre transacciones internas y del procesador.',
        acceptanceCriteria: ['Match por ID de transacción', 'Match fuzzy por monto/fecha', 'Tasa de auto-match > 95%'],
        points: 13, labels: ['backend', 'reconciliation'],
      },
    ],
  },
  {
    keywords: ['mobile', 'app', 'ios', 'android', 'nativo'],
    stories: [
      {
        titleTemplate: 'Implementar navegación nativa del flujo',
        descriptionTemplate: 'Como usuario móvil, quiero una navegación fluida y nativa en la app.',
        acceptanceCriteria: ['Transiciones nativas iOS/Android', 'Gesture navigation', 'Deep linking funcional'],
        points: 5, labels: ['mobile', 'ux'],
      },
      {
        titleTemplate: 'Integrar autenticación biométrica',
        descriptionTemplate: 'Como usuario, quiero confirmar acciones con Face ID o huella digital.',
        acceptanceCriteria: ['Face ID en iOS', 'Fingerprint en Android', 'Fallback a PIN'],
        points: 8, labels: ['mobile', 'security'],
      },
    ],
  },
  {
    keywords: ['partner', 'integración', 'api externa', 'tercero'],
    stories: [
      {
        titleTemplate: 'Diseñar API de integración para partners',
        descriptionTemplate: 'Como partner, necesito una API clara y documentada para integrarme con el sistema.',
        acceptanceCriteria: ['Documentación OpenAPI', 'Sandbox de pruebas', 'Autenticación OAuth2'],
        points: 8, labels: ['backend', 'integration'],
      },
      {
        titleTemplate: 'Implementar portal de onboarding de partners',
        descriptionTemplate: 'Como partner, quiero un portal self-service para registrar y configurar mi integración.',
        acceptanceCriteria: ['Registro automatizado', 'Generación de API keys', 'Dashboard de métricas'],
        points: 8, labels: ['fullstack', 'integration'],
      },
    ],
  },
];

// Fallback stories when no keywords match
const defaultStories = [
  {
    titleTemplate: 'Definir y documentar requisitos técnicos',
    descriptionTemplate: 'Como equipo, necesitamos documentar los requisitos técnicos detallados para esta épica.',
    acceptanceCriteria: ['Documento de requisitos completo', 'Revisado por tech lead', 'Aprobado por stakeholders'],
    points: 3, labels: ['documentation'],
  },
  {
    titleTemplate: 'Implementar lógica de negocio principal',
    descriptionTemplate: 'Como sistema, necesito implementar la lógica de negocio core definida en la épica.',
    acceptanceCriteria: ['Lógica implementada según spec', 'Tests unitarios > 80%', 'Code review aprobado'],
    points: 13, labels: ['backend'],
  },
  {
    titleTemplate: 'Desarrollar interfaz de usuario',
    descriptionTemplate: 'Como usuario, quiero una interfaz intuitiva para interactuar con la funcionalidad.',
    acceptanceCriteria: ['Diseño responsive', 'Accesibilidad WCAG 2.1', 'Tests de UI'],
    points: 8, labels: ['frontend'],
  },
  {
    titleTemplate: 'Configurar tests de integración',
    descriptionTemplate: 'Como desarrollador, necesito tests de integración para validar el flujo end-to-end.',
    acceptanceCriteria: ['Tests E2E del flujo principal', 'Cobertura > 70%', 'Integración con CI/CD'],
    points: 5, labels: ['testing'],
  },
];

function extractText(epic: Epic): string {
  return [
    epic.title, epic.description, epic.scopeDescription,
    epic.teamsInvolved, epic.impactedChannels, epic.impactedFlows,
    epic.thirdPartyDependencies, epic.technologicalImprovements,
    epic.impactSabreLevel, epic.acceptanceCriteria,
  ].join(' ').toLowerCase();
}

/** Simulates an AI agent generating user stories from an epic's definition. */
export async function generateStories(epic: Epic, podIds: string[]): Promise<UserStory[]> {
  // Simulate AI thinking time (2-4s)
  await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 2000));

  const text = extractText(epic);
  const matched: UserStory[] = [];
  const usedTitles = new Set<string>();
  let storyIdx = 0;

  // Match templates by keywords
  for (const template of storyTemplates) {
    if (template.keywords.some((kw) => text.includes(kw))) {
      for (const story of template.stories) {
        if (usedTitles.has(story.titleTemplate)) continue;
        usedTitles.add(story.titleTemplate);
        const podId = podIds[storyIdx % podIds.length];
        const now = new Date().toISOString();
        matched.push({
          id: `story-gen-${Date.now()}-${++storyIdx}`,
          title: story.titleTemplate,
          description: story.descriptionTemplate,
          status: StoryStatus.Backlog,
          storyPoints: story.points,
          epicId: epic.id,
          podId,
          productOwnerId: null,
          sprintId: null,
          jiraKey: null,
          labels: story.labels,
          po: {
            background: '',
            objective: story.titleTemplate,
            userStory: story.descriptionTemplate,
            whatHowWhen: { what: '', how: '', when: '' },
            acceptanceCriteria: story.acceptanceCriteria,
            additionalNotes: '',
          },
          technical: {
            architecture: '',
            integrationFlow: '',
            validations: [],
            errorHandling: [],
            implementationChecklist: [],
          },
          qa: {
            testingStrategy: '',
            linkedQAMatrixId: null,
          },
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // Ensure minimum stories
  if (matched.length < 3) {
    for (const story of defaultStories) {
      if (usedTitles.has(story.titleTemplate)) continue;
      if (matched.length >= 5) break;
      usedTitles.add(story.titleTemplate);
      const podId = podIds[storyIdx % podIds.length];
      const now = new Date().toISOString();
      matched.push({
        id: `story-gen-${Date.now()}-${++storyIdx}`,
        title: story.titleTemplate,
        description: story.descriptionTemplate,
        status: StoryStatus.Backlog,
        storyPoints: story.points,
        epicId: epic.id,
        podId,
        productOwnerId: null,
        sprintId: null,
        jiraKey: null,
        labels: story.labels,
        po: {
          background: '',
          objective: story.titleTemplate,
          userStory: story.descriptionTemplate,
          whatHowWhen: { what: '', how: '', when: '' },
          acceptanceCriteria: story.acceptanceCriteria,
          additionalNotes: '',
        },
        technical: {
          architecture: '',
          integrationFlow: '',
          validations: [],
          errorHandling: [],
          implementationChecklist: [],
        },
        qa: {
          testingStrategy: '',
          linkedQAMatrixId: null,
        },
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return matched;
}
