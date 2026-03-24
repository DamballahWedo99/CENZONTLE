/**
 * Mock AI Epic Generation Agent
 *
 * Generates structured epics from an initiative's description and context.
 * In production this would call an LLM API with the initiative definition,
 * existing epics in the portfolio, and organizational context to propose
 * well-scoped epics with business fields pre-filled.
 */

import { Epic, EpicStatus, Priority, Initiative } from '@cenzontle/shared';

interface EpicTemplate {
  keywords: string[];
  epics: Array<{
    titleTemplate: string;
    descriptionTemplate: string;
    qualitativeBenefits: string;
    quantitativeBenefits: string;
    scopeDescription: string;
    acceptanceCriteria: string;
    technologicalImprovements: string;
    teamsInvolved: string;
    impactedChannels: string;
    priority: Priority;
    suggestedPodKeywords: string[];
  }>;
}

const epicTemplates: EpicTemplate[] = [
  {
    keywords: ['plataforma', 'digital', 'modernización', 'modernizar', 'web', 'frontend'],
    epics: [
      {
        titleTemplate: 'Rediseño de experiencia de usuario en plataforma web',
        descriptionTemplate: 'Modernización completa de la interfaz de usuario de la plataforma web para mejorar la experiencia del cliente, incluyendo nuevo design system, optimización de performance y accesibilidad.',
        qualitativeBenefits: 'Mejora significativa en la experiencia del usuario, reducción de fricción en flujos principales, mayor accesibilidad y cumplimiento de estándares WCAG 2.1.',
        quantitativeBenefits: 'Reducción del 30% en tasa de abandono, mejora del 25% en Core Web Vitals, incremento del 15% en conversión.',
        scopeDescription: 'Incluye: nuevo design system, componentes reutilizables, migración de páginas principales, optimización de assets y lazy loading.',
        acceptanceCriteria: 'LCP < 2.5s, FID < 100ms, CLS < 0.1. Todas las páginas principales migradas al nuevo design system. Cobertura de pruebas > 80%.',
        technologicalImprovements: 'Migración a React Server Components, implementación de design system con Tailwind, CDN optimizado.',
        teamsInvolved: 'Frontend Digital, UX/UI, Performance Engineering',
        impactedChannels: 'Web Desktop, Web Mobile, PWA',
        priority: Priority.High,
        suggestedPodKeywords: ['frontend', 'digital', 'web'],
      },
      {
        titleTemplate: 'Migración de APIs legacy a arquitectura de microservicios',
        descriptionTemplate: 'Descomposición de la API monolítica en microservicios independientes con contratos bien definidos, mejorando la escalabilidad y el tiempo de despliegue.',
        qualitativeBenefits: 'Mayor agilidad en despliegues, escalamiento independiente de servicios, mejor aislamiento de fallos.',
        quantitativeBenefits: 'Reducción del 60% en tiempo de deploy, mejora del 40% en tiempo de respuesta de APIs críticas.',
        scopeDescription: 'Descomposición de 5 dominios principales: usuarios, reservas, pagos, notificaciones y catálogo.',
        acceptanceCriteria: 'Cada microservicio desplegable de forma independiente, contratos OpenAPI documentados, circuit breakers implementados.',
        technologicalImprovements: 'Kubernetes, service mesh con Istio, API Gateway centralizado, observabilidad con Datadog.',
        teamsInvolved: 'Platform Infrastructure, Backend Engineering, DevOps',
        impactedChannels: 'Todos los canales digitales',
        priority: Priority.Critical,
        suggestedPodKeywords: ['platform', 'infrastructure', 'backend'],
      },
      {
        titleTemplate: 'Implementación de sistema de caché distribuido',
        descriptionTemplate: 'Implementar capa de caché distribuido para reducir la latencia y la carga en los servicios de datos principales.',
        qualitativeBenefits: 'Mayor resiliencia ante picos de tráfico, mejor experiencia para el usuario final con respuestas más rápidas.',
        quantitativeBenefits: 'Reducción del 50% en latencia P95, reducción del 35% en costos de infraestructura de base de datos.',
        scopeDescription: 'Redis cluster para sesiones y datos de catálogo, CDN edge caching para assets estáticos, invalidación inteligente.',
        acceptanceCriteria: 'Cache hit rate > 85%, P95 latency < 200ms, estrategia de invalidación documentada y probada.',
        technologicalImprovements: 'Redis Cluster, CloudFront edge locations, cache invalidation patterns.',
        teamsInvolved: 'Platform Infrastructure, Backend Engineering',
        impactedChannels: 'Web, Mobile, API partners',
        priority: Priority.High,
        suggestedPodKeywords: ['platform', 'infrastructure', 'backend'],
      },
    ],
  },
  {
    keywords: ['pago', 'payment', 'procesador', 'cobro', 'transacción', 'checkout'],
    epics: [
      {
        titleTemplate: 'Integración de procesador de pagos multi-proveedor',
        descriptionTemplate: 'Implementación de arquitectura de pagos que soporte múltiples procesadores (DEUNA, Adyen, Stripe) con routing inteligente basado en tasa de éxito, costo y disponibilidad.',
        qualitativeBenefits: 'Mayor resiliencia en procesamiento de pagos, menor dependencia de un solo proveedor, mejor tasa de aprobación.',
        quantitativeBenefits: 'Incremento del 8% en tasa de aprobación, reducción del 15% en costos de procesamiento, 99.95% uptime.',
        scopeDescription: 'Router de pagos, integración con 3 procesadores, panel de monitoreo, conciliación automatizada.',
        acceptanceCriteria: 'Failover automático < 5s, routing basado en reglas configurables, reportes de conciliación diarios.',
        technologicalImprovements: 'Payment Gateway abstraction layer, tokenización PCI-DSS, webhooks asíncronos.',
        teamsInvolved: 'Payments Backend, Payments Frontend, Compliance',
        impactedChannels: 'Web, Mobile, Contact Center',
        priority: Priority.Critical,
        suggestedPodKeywords: ['payments', 'backend'],
      },
      {
        titleTemplate: 'Implementación de métodos de pago alternativos',
        descriptionTemplate: 'Agregar soporte para métodos de pago alternativos como OXXO Pay, transferencia bancaria, Buy Now Pay Later y pagos con puntos.',
        qualitativeBenefits: 'Mayor inclusión financiera, más opciones para el cliente, diferenciación competitiva.',
        quantitativeBenefits: 'Incremento del 12% en conversión del checkout, captura de segmento sin tarjeta de crédito.',
        scopeDescription: 'Integración OXXO Pay, transferencia SPEI, BNPL con proveedor seleccionado, redención de puntos.',
        acceptanceCriteria: 'Cada método de pago funcional end-to-end, confirmación asíncrona para métodos offline, UX unificada.',
        technologicalImprovements: 'Webhooks para pagos asíncronos, estado de pago en tiempo real, notificaciones push.',
        teamsInvolved: 'Payments Backend, Frontend Digital, Mobile Experience',
        impactedChannels: 'Web, App Mobile',
        priority: Priority.High,
        suggestedPodKeywords: ['payments', 'frontend'],
      },
      {
        titleTemplate: 'Sistema de conciliación y reportes financieros',
        descriptionTemplate: 'Desarrollo de sistema automatizado de conciliación entre procesadores de pago, registros internos y sistema contable, con generación de reportes en tiempo real.',
        qualitativeBenefits: 'Eliminación de procesos manuales de conciliación, detección temprana de discrepancias, auditoría automatizada.',
        quantitativeBenefits: 'Reducción del 90% en tiempo de conciliación diaria, de 4 horas a 25 minutos automatizados.',
        scopeDescription: 'Ingesta de archivos de procesadores, algoritmo de matching, dashboard de discrepancias, reportes configurables.',
        acceptanceCriteria: 'Matching rate > 98%, alertas automáticas por discrepancias > $100, reportes generados antes de 8am.',
        technologicalImprovements: 'ETL pipeline con Apache Airflow, data warehouse para reportes, dashboards Grafana.',
        teamsInvolved: 'Payments Backend, Data Engineering, Finance',
        impactedChannels: 'Sistemas internos, Portal de administración',
        priority: Priority.Medium,
        suggestedPodKeywords: ['payments', 'backend', 'data'],
      },
    ],
  },
  {
    keywords: ['lealtad', 'loyalty', 'punto', 'reward', 'programa', 'milla'],
    epics: [
      {
        titleTemplate: 'Motor de acumulación de puntos y millas',
        descriptionTemplate: 'Implementación del motor de reglas para acumulación de puntos basado en actividad del cliente, nivel de membresía y promociones vigentes.',
        qualitativeBenefits: 'Reglas de acumulación más flexibles, personalización por segmento, mayor engagement del programa.',
        quantitativeBenefits: 'Incremento del 20% en participación activa del programa, 15% más transacciones por miembro activo.',
        scopeDescription: 'Motor de reglas configurable, integración con POS y canales digitales, retroactividad de promociones.',
        acceptanceCriteria: 'Reglas procesadas en < 500ms, soporte para 10+ tipos de acumulación, panel de administración de reglas.',
        technologicalImprovements: 'Rules engine basado en eventos, CQRS para balance de puntos, event sourcing.',
        teamsInvolved: 'Loyalty Backend, Mobile Experience, Data Analytics',
        impactedChannels: 'App Mobile, Web, POS en aeropuerto',
        priority: Priority.High,
        suggestedPodKeywords: ['loyalty', 'mobile'],
      },
      {
        titleTemplate: 'Portal de redención y catálogo de premios',
        descriptionTemplate: 'Desarrollo del catálogo de premios y flujo de redención de puntos, incluyendo vuelos, upgrades, productos de partners y experiencias.',
        qualitativeBenefits: 'Mayor variedad de opciones de redención, proceso simplificado, integración con ecosistema de partners.',
        quantitativeBenefits: 'Incremento del 35% en tasa de redención, reducción del 50% en llamadas al call center por redención.',
        scopeDescription: 'Catálogo de premios, flujo de redención, integración con partners, historial de canjes.',
        acceptanceCriteria: 'Catálogo con 50+ opciones, redención en < 3 clicks, confirmación instantánea.',
        technologicalImprovements: 'API de catálogo dinámico, integración REST con partners, sistema de inventory en tiempo real.',
        teamsInvolved: 'Loyalty Backend, Frontend Digital, Partner Integration',
        impactedChannels: 'App Mobile, Web',
        priority: Priority.Medium,
        suggestedPodKeywords: ['loyalty', 'frontend', 'mobile'],
      },
    ],
  },
  {
    keywords: ['mobile', 'app', 'ios', 'android', 'nativo', 'aplicación'],
    epics: [
      {
        titleTemplate: 'App móvil nativa con experiencia offline-first',
        descriptionTemplate: 'Desarrollo de aplicación móvil nativa para iOS y Android con soporte offline, notificaciones push y autenticación biométrica.',
        qualitativeBenefits: 'Experiencia nativa fluida, acceso offline a boarding passes, login sin fricción.',
        quantitativeBenefits: 'Incremento del 40% en adopción mobile, reducción del 25% en llamadas al contact center.',
        scopeDescription: 'Navegación nativa, offline storage, biometric auth, push notifications, deep linking.',
        acceptanceCriteria: 'App funcional en modo avión para boarding pass, login biométrico < 2s, push delivery > 95%.',
        technologicalImprovements: 'React Native con módulos nativos, SQLite para offline, Firebase para push.',
        teamsInvolved: 'Mobile Experience, Backend Engineering, UX/UI',
        impactedChannels: 'App iOS, App Android',
        priority: Priority.High,
        suggestedPodKeywords: ['mobile', 'experience'],
      },
      {
        titleTemplate: 'Check-in digital y boarding pass móvil',
        descriptionTemplate: 'Implementación del flujo completo de check-in digital desde la app con generación de boarding pass con código QR y integración con sistemas aeroportuarios.',
        qualitativeBenefits: 'Eliminación de filas en counter, proceso de check-in desde cualquier lugar, boarding pass siempre disponible.',
        quantitativeBenefits: 'Reducción del 60% en check-in en counter, ahorro operativo en personal de counter.',
        scopeDescription: 'Flujo de check-in (selección de asiento, documentos, equipaje), QR boarding pass, integración DCS.',
        acceptanceCriteria: 'Check-in funcional 24h antes del vuelo, QR escaneable en gates, funcional offline.',
        technologicalImprovements: 'Integración Sabre DCS, generación QR local, sincronización eventual.',
        teamsInvolved: 'Mobile Experience, Airport Systems, Backend Engineering',
        impactedChannels: 'App iOS, App Android',
        priority: Priority.Critical,
        suggestedPodKeywords: ['mobile', 'experience'],
      },
    ],
  },
  {
    keywords: ['monitoreo', 'observabilidad', 'dashboard', 'métricas', 'alertas'],
    epics: [
      {
        titleTemplate: 'Plataforma de observabilidad centralizada',
        descriptionTemplate: 'Implementación de stack completo de observabilidad con métricas, logs y trazas distribuidas para todos los servicios de la plataforma.',
        qualitativeBenefits: 'Detección proactiva de incidentes, reducción de MTTR, visibilidad end-to-end de transacciones.',
        quantitativeBenefits: 'Reducción del 50% en MTTR, detección de anomalías 15 min antes de que impacten al usuario.',
        scopeDescription: 'Dashboards operativos, alerting inteligente, tracing distribuido, log aggregation.',
        acceptanceCriteria: 'Dashboards para cada servicio, alertas con < 1% false positives, trazas end-to-end funcionales.',
        technologicalImprovements: 'Datadog APM, OpenTelemetry, Grafana dashboards, PagerDuty integration.',
        teamsInvolved: 'Platform Infrastructure, SRE, DevOps',
        impactedChannels: 'Sistemas internos, Operaciones',
        priority: Priority.High,
        suggestedPodKeywords: ['platform', 'infrastructure'],
      },
    ],
  },
];

// Default fallback epics for initiatives that don't match any template
const defaultEpicTemplates: EpicTemplate['epics'] = [
  {
    titleTemplate: 'Análisis y diseño de arquitectura',
    descriptionTemplate: 'Fase de análisis técnico y diseño de la arquitectura de la solución, incluyendo evaluación de alternativas, diagramas de componentes y plan de implementación.',
    qualitativeBenefits: 'Base técnica sólida para el desarrollo, reducción de riesgo técnico.',
    quantitativeBenefits: 'Reducción del 30% en retrabajo por decisiones técnicas anticipadas.',
    scopeDescription: 'Documento de arquitectura, diagramas C4, evaluación de stack tecnológico, POC de componentes críticos.',
    acceptanceCriteria: 'Documento de arquitectura aprobado por el comité técnico, POC validado con métricas de performance.',
    technologicalImprovements: 'A definir según análisis.',
    teamsInvolved: 'Arquitectura, Tech Leads',
    impactedChannels: 'A definir según alcance',
    priority: Priority.High,
    suggestedPodKeywords: [],
  },
  {
    titleTemplate: 'Desarrollo de funcionalidad core',
    descriptionTemplate: 'Implementación de la funcionalidad principal del proyecto, incluyendo backend, frontend y pruebas de integración.',
    qualitativeBenefits: 'Entrega del valor principal del proyecto, funcionalidad lista para uso.',
    quantitativeBenefits: 'Cumplimiento del 80% de los requerimientos funcionales principales.',
    scopeDescription: 'APIs principales, interfaz de usuario, flujos de negocio core, pruebas de integración.',
    acceptanceCriteria: 'Todos los flujos principales funcionales, cobertura de pruebas > 70%, sin bugs críticos.',
    technologicalImprovements: 'Según la arquitectura definida en la fase de análisis.',
    teamsInvolved: 'Desarrollo Backend, Frontend, QA',
    impactedChannels: 'A definir',
    priority: Priority.Critical,
    suggestedPodKeywords: [],
  },
  {
    titleTemplate: 'Pruebas integrales y estabilización',
    descriptionTemplate: 'Fase de pruebas end-to-end, corrección de bugs, optimización de performance y preparación para producción.',
    qualitativeBenefits: 'Software estable y confiable, listo para producción.',
    quantitativeBenefits: 'Cobertura de pruebas > 85%, 0 bugs críticos en producción durante primer mes.',
    scopeDescription: 'Pruebas E2E, pruebas de carga, security testing, runbook de deployment.',
    acceptanceCriteria: 'Todas las pruebas pasando, performance targets met, plan de rollback documentado.',
    technologicalImprovements: 'Pipeline CI/CD optimizado, blue-green deployment.',
    teamsInvolved: 'QA, DevOps, SRE',
    impactedChannels: 'Todos los canales afectados',
    priority: Priority.Medium,
    suggestedPodKeywords: [],
  },
];

function extractInitiativeText(initiative: Initiative): string {
  return [initiative.name, initiative.description].join(' ');
}

function matchPods(
  suggestedKeywords: string[],
  pods: Array<{ id: string; name: string }>,
): string[] {
  if (suggestedKeywords.length === 0 || pods.length === 0) return [pods[0]?.id].filter(Boolean);

  const matched: string[] = [];
  for (const pod of pods) {
    const podName = pod.name.toLowerCase();
    if (suggestedKeywords.some((kw) => podName.includes(kw))) {
      matched.push(pod.id);
    }
  }
  return matched.length > 0 ? matched : [pods[0].id];
}

export async function generateEpics(
  initiative: Initiative,
  pods: Array<{ id: string; name: string }>,
  existingEpicCount: number,
): Promise<Epic[]> {
  // Simulate AI thinking time
  await new Promise((resolve) => setTimeout(resolve, 2500 + Math.random() * 2000));

  const text = extractInitiativeText(initiative).toLowerCase();

  // Score each template by keyword matches
  let bestScore = 0;
  let bestTemplate: EpicTemplate | null = null;

  for (const template of epicTemplates) {
    const score = template.keywords.filter((kw) => text.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = template;
    }
  }

  const epicSources = bestTemplate && bestScore > 0 ? bestTemplate.epics : defaultEpicTemplates;

  const now = new Date().toISOString();
  const startKey = existingEpicCount + 201;

  return epicSources.map((template, idx) => {
    const podIds = matchPods(
      template.suggestedPodKeywords.map((k) => k.toLowerCase()),
      pods,
    );

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + idx * 30); // stagger by 30 days

    const targetDate = new Date(startDate);
    targetDate.setDate(targetDate.getDate() + 90); // 90-day sprints

    return {
      id: `epic-ai-${Date.now()}-${idx}`,
      title: template.titleTemplate,
      description: template.descriptionTemplate,
      qualitativeBenefits: template.qualitativeBenefits,
      quantitativeBenefits: template.quantitativeBenefits,
      benefitsMeasurement: 'Se medirá mediante dashboards de métricas automatizados y revisiones trimestrales con stakeholders.',
      scopeDescription: template.scopeDescription,
      acceptanceCriteria: template.acceptanceCriteria,
      technologicalImprovements: template.technologicalImprovements,
      businessPriority: `Prioridad ${template.priority} — alineada con los objetivos de ${initiative.name}.`,
      teamsInvolved: template.teamsInvolved,
      impactedChannels: template.impactedChannels,
      impactedFlows: 'A detallar durante la fase de análisis.',
      impactSabreLevel: 'Requiere evaluación de impacto Sabre.',
      thirdPartyDependencies: 'A identificar durante la fase de diseño.',
      status: EpicStatus.Draft,
      priority: template.priority,
      initiativeId: initiative.id,
      podIds,
      jiraKey: null,
      startDate: startDate.toISOString().split('T')[0],
      targetDate: targetDate.toISOString().split('T')[0],
      documents: [],
      diagrams: [],
      dependencies: [],
      poApproval: null,
      tlApproval: null,
      qaMatrix: null,
      qaApproval: null,
      epicQAMatrix: null,

      createdAt: now,
      updatedAt: now,
    };
  });
}
