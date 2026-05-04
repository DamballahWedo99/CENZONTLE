import { Epic, EpicDependency, EpicStatus, Priority } from '@cenzontle/shared';

export const mockEpics: Epic[] = [
  // === Initiative 1: Modernización de Plataforma Digital ===
  {
    id: 'epic-1',
    title: 'Rediseño de Checkout Web',
    markdown: `## Descripción

Rediseño completo del flujo de checkout con nuevo diseño, optimización de conversión y soporte para múltiples métodos de pago.

## Beneficios cualitativos

Mejor experiencia de usuario, reducción de fricción en el proceso de compra, mayor confianza del cliente en la plataforma.

## Beneficios cuantitativos

Incremento del 15% en tasa de conversión, reducción del 25% en abandono de carrito, aumento del 10% en ticket promedio.

## Medición de beneficios

A/B testing contra flujo actual, métricas de funnel en Google Analytics, tasa de conversión por paso del checkout.

## Alcance

Incluye rediseño visual, nuevo flujo de 3 pasos, integración de múltiples métodos de pago, optimización mobile-first.

## Criterios de aceptación

Flujo completo funcional con al menos 3 métodos de pago, tiempo de carga < 2s, accesibilidad WCAG 2.1 AA.

## Mejoras tecnológicas

Migración de jQuery a React, implementación de lazy loading, uso de Web Components para embeds.

## Canales y flujos impactados

Canales: Web desktop, Web mobile, Progressive Web App.

Flujos: Compra de boletos, ancillaries, upgrades, paquetes vacacionales.

## Dependencias de terceros

DEUNA (procesador de pagos), Stripe (fallback), Google Pay / Apple Pay APIs.`,
    status: EpicStatus.InProgress,
    priority: Priority.High,
    initiativeId: 'init-1',
    podIds: ['pod-1', 'pod-2'],
    startDate: '2026-01-13',
    targetDate: '2026-04-30',
    createdAt: '2026-01-06T10:00:00Z',
    updatedAt: '2026-03-05T14:30:00Z',
    documents: [
      { id: 'doc-1', name: 'Checkout_Wireframes_v2.pdf', type: 'pdf', url: '#', uploadedBy: 'Ana García', uploadedAt: '2026-01-20', size: '4.2 MB' },
      { id: 'doc-2', name: 'Payment_Flow_Diagram.png', type: 'diagram', url: '#', uploadedBy: 'Carlos López', uploadedAt: '2026-02-05', size: '1.8 MB' },
      { id: 'doc-3', name: 'Conversion_Metrics_Baseline.xlsx', type: 'excel', url: '#', uploadedBy: 'Ana García', uploadedAt: '2026-02-12', size: '890 KB' },
    ],
    diagrams: [],
    dependencies: [
      {
        id: 'dep-1-1',
        title: 'Dependencia técnica: Microservicios de Pagos',
        description: 'El nuevo checkout requiere que los microservicios de pagos estén desacoplados del monolito para poder integrar la nueva arquitectura de frontend.',
        type: 'technical',
        direction: 'depends_on',
        scheduling: 'finish-to-start',
        status: 'in_progress',
        severity: Priority.High,
        isBlocking: true,
        targetEpicId: 'epic-2',
        targetExternalName: null,
        owner: 'Carlos López',
        dueDate: '2026-03-31',
        resolutionNotes: 'El equipo de plataforma está priorizando el microservicio de payments para desbloquear checkout.',
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-03-01T14:00:00Z',
      },
      {
        id: 'dep-1-2',
        title: 'Dependencia externa: DEUNA Payments API',
        description: 'Integración con la API v3 de DEUNA para soporte de tokenización y pagos recurrentes en el nuevo checkout.',
        type: 'external',
        direction: 'depends_on',
        scheduling: 'finish-to-start',
        status: 'identified',
        severity: Priority.Critical,
        isBlocking: true,
        targetEpicId: null,
        targetExternalName: 'DEUNA Payments API',
        owner: 'Ana García',
        dueDate: '2026-04-15',
        resolutionNotes: '',
        createdAt: '2026-01-20T10:00:00Z',
        updatedAt: '2026-02-28T09:00:00Z',
      },
      {
        id: 'dep-1-3',
        title: 'Dependencia cross-team: App Móvil Checkout',
        description: 'El equipo de mobile necesita que el diseño y la API del checkout web estén definidos para replicar la experiencia en nativo.',
        type: 'cross-team',
        direction: 'depended_on_by',
        scheduling: 'start-to-start',
        status: 'identified',
        severity: Priority.Medium,
        isBlocking: false,
        targetEpicId: 'epic-4',
        targetExternalName: null,
        owner: 'Roberto Méndez',
        dueDate: null,
        resolutionNotes: '',
        createdAt: '2026-02-01T10:00:00Z',
        updatedAt: '2026-02-01T10:00:00Z',
      },
    ],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  {
    id: 'epic-2',
    title: 'Migración a Microservicios',
    markdown: `## Descripción

Descomposición del monolito en microservicios independientes con API Gateway, service mesh y observabilidad centralizada.

## Beneficios cualitativos

Mayor resiliencia del sistema, despliegues independientes por equipo, mejor aislamiento de fallos.

## Beneficios cuantitativos

Reducción del 40% en tiempo de despliegue, 99.95% de uptime (vs 99.5% actual), reducción del 30% en incidentes P1.

## Medición de beneficios

Métricas de DORA (deployment frequency, lead time, MTTR, change failure rate), dashboards de SLOs.

## Alcance

Decomposición en 8 microservicios core: auth, booking, payments, inventory, pricing, notifications, users, analytics.

## Criterios de aceptación

Cada servicio desplegable independientemente, latencia p99 < 200ms, cobertura de tests > 80%.

## Mejoras tecnológicas

Kubernetes, service mesh (Istio), distributed tracing (Jaeger), event-driven architecture (Kafka).

## Canales y flujos impactados

Canales: Todos — cambio transparente para canales externos.

Flujos: Todos los flujos internos de backend.

## Dependencias de terceros

AWS (EKS), Datadog (observabilidad), Confluent (Kafka managed).`,
    status: EpicStatus.InProgress,
    priority: Priority.Critical,
    initiativeId: 'init-1',
    podIds: ['pod-4'],
    startDate: '2026-01-13',
    targetDate: '2026-08-31',
    createdAt: '2026-01-06T10:00:00Z',
    updatedAt: '2026-03-01T09:15:00Z',
    documents: [],
    diagrams: [],
    dependencies: [
      {
        id: 'dep-2-1',
        title: 'Dependencia técnica: API Gateway v2',
        description: 'El equipo de API Gateway necesita que los microservicios estén desplegados para configurar el routing y la autenticación centralizada.',
        type: 'technical',
        direction: 'depended_on_by',
        scheduling: 'finish-to-start',
        status: 'in_progress',
        severity: Priority.High,
        isBlocking: true,
        targetEpicId: 'epic-3',
        targetExternalName: null,
        owner: 'Carlos López',
        dueDate: '2026-06-30',
        resolutionNotes: 'Se está trabajando en la definición de contratos de API para cada microservicio.',
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-03-01T09:15:00Z',
      },
      {
        id: 'dep-2-2',
        title: 'Dependencia de recursos: Platform Infrastructure',
        description: 'El equipo de Platform Infrastructure debe provisionar los clusters de Kubernetes y configurar la infraestructura base antes de los despliegues.',
        type: 'resource',
        direction: 'depends_on',
        scheduling: 'finish-to-start',
        status: 'resolved',
        severity: Priority.Medium,
        isBlocking: false,
        targetEpicId: null,
        targetExternalName: 'Platform Infrastructure Team',
        owner: 'Diego Ramírez',
        dueDate: '2026-02-15',
        resolutionNotes: 'Clusters de EKS provisionados y configurados en staging y producción. Listo para despliegues.',
        createdAt: '2026-01-10T10:00:00Z',
        updatedAt: '2026-02-14T16:00:00Z',
      },
    ],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  {
    id: 'epic-3',
    title: 'API Gateway v2',
    markdown: `## Descripción

Implementación de nuevo API Gateway con rate limiting, autenticación centralizada, versionado de APIs y documentación automática.

## Beneficios cualitativos

Seguridad centralizada, mejor experiencia de desarrolladores internos y externos, control de tráfico unificado.

## Beneficios cuantitativos

Reducción del 60% en endpoints duplicados, ahorro de 200hrs/año en mantenimiento de auth, 0 brechas de seguridad en APIs.

## Medición de beneficios

Inventario de APIs antes/después, tickets de soporte relacionados con auth, security audit reports.

## Alcance

Nuevo gateway basado en Kong/AWS API Gateway, migración de todos los endpoints actuales, documentación OpenAPI 3.1.

## Criterios de aceptación

Todos los endpoints migrados, rate limiting funcional, autenticación OAuth2/JWT centralizada, docs auto-generadas.

## Mejoras tecnológicas

Kong Gateway, OAuth2 con PKCE, OpenAPI 3.1, developer portal con Swagger UI.

## Canales y flujos impactados

Canales: Todos los canales que consumen APIs internas.

Flujos: Autenticación, autorización, todos los flujos que pasan por API.

## Dependencias de terceros

Kong Inc. (soporte enterprise), Auth0 (identity provider).`,
    status: EpicStatus.Draft,
    priority: Priority.Medium,
    initiativeId: 'init-1',
    podIds: ['pod-4', 'pod-1'],
    startDate: '2026-04-01',
    targetDate: '2026-07-31',
    createdAt: '2026-01-06T10:00:00Z',
    updatedAt: '2026-02-15T11:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  {
    id: 'epic-4',
    title: 'App Móvil Checkout Nativo',
    markdown: `## Descripción

Implementación nativa del flujo de checkout en iOS y Android con Apple Pay, Google Pay y biometría.

## Beneficios cualitativos

Experiencia nativa fluida, mayor confianza con biometría, paridad de funcionalidad con web.

## Beneficios cuantitativos

Incremento del 20% en conversión móvil, reducción del 35% en tiempo de checkout, 4.5+ rating en stores.

## Medición de beneficios

Firebase Analytics, App Store / Play Store ratings, comparativo de conversión web vs nativo.

## Alcance

Flujo de checkout nativo iOS/Android, integración Apple Pay y Google Pay, autenticación biométrica pre-pago.

## Criterios de aceptación

Checkout funcional en iOS 16+ y Android 12+, Apple Pay y Google Pay integrados, Face ID / fingerprint para confirmar pago.

## Mejoras tecnológicas

Swift UI, Jetpack Compose, SDK de pagos compartido iOS/Android, deep linking para retomar compras.

## Canales y flujos impactados

Canales: App iOS, App Android.

Flujos: Compra de boletos mobile, ancillaries, notificaciones push de estado de pago.

## Dependencias de terceros

Apple (Apple Pay SDK), Google (Google Pay SDK), DEUNA (procesador).`,
    status: EpicStatus.InProgress,
    priority: Priority.High,
    initiativeId: 'init-1',
    podIds: ['pod-5', 'pod-1'],
    startDate: '2026-02-01',
    targetDate: '2026-06-30',
    createdAt: '2026-01-20T10:00:00Z',
    updatedAt: '2026-03-08T16:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  // === Initiative 2: Integración de Pagos Multi-procesador ===
  {
    id: 'epic-5',
    title: 'Soporte Multi-procesador',
    markdown: `## Descripción

Abstracción de procesadores de pago para soportar DEUNA, Stripe, Adyen y procesadores locales con routing inteligente.

## Beneficios cualitativos

Eliminación de vendor lock-in, mayor disponibilidad de pagos, flexibilidad para negociar tarifas.

## Beneficios cuantitativos

Incremento del 8% en tasa de aprobación global, reducción del 15% en costos de procesamiento, 0 downtime por falla de procesador.

## Medición de beneficios

Tasa de aprobación por procesador, costo por transacción, uptime del servicio de pagos.

## Alcance

Capa de abstracción de procesadores, routing inteligente basado en BIN/país/monto, failover automático.

## Criterios de aceptación

Al menos 3 procesadores integrados, routing configurable sin deploy, failover < 5s, dashboard de métricas por procesador.

## Mejoras tecnológicas

Patrón Strategy para procesadores, circuit breaker pattern, configuración dinámica con feature flags.

## Canales y flujos impactados

Canales: Todos — transparente para el usuario final.

Flujos: Todos los flujos de pago: boletos, ancillaries, suscripciones, reembolsos.

## Dependencias de terceros

DEUNA, Stripe, Adyen, procesadores locales (Prosa, Banorte).`,
    status: EpicStatus.InProgress,
    priority: Priority.Critical,
    initiativeId: 'init-2',
    podIds: ['pod-1'],
    startDate: '2026-01-13',
    targetDate: '2026-03-31',
    createdAt: '2026-01-06T10:00:00Z',
    updatedAt: '2026-03-09T10:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [
      {
        id: 'dep-5-1',
        title: 'Dependencia técnica: Checkout Web',
        description: 'La abstracción multi-procesador requiere que el nuevo flujo de checkout esté definido para alinear las interfaces de pago.',
        type: 'technical',
        direction: 'depends_on',
        scheduling: 'finish-to-start',
        status: 'blocked',
        severity: Priority.Critical,
        isBlocking: true,
        targetEpicId: 'epic-1',
        targetExternalName: null,
        owner: 'Ana García',
        dueDate: '2026-03-15',
        resolutionNotes: 'Bloqueado hasta que el checkout web defina las interfaces finales de integración con procesadores.',
        createdAt: '2026-01-13T10:00:00Z',
        updatedAt: '2026-03-09T10:00:00Z',
      },
    ],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  {
    id: 'epic-6',
    title: 'Retry Engine',
    markdown: `## Descripción

Motor de reintentos inteligente con estrategias configurables, circuit breaker y fallback entre procesadores.

## Beneficios cualitativos

Recuperación automática de transacciones fallidas, mejor experiencia del usuario ante errores temporales.

## Beneficios cuantitativos

Recuperación del 12% de transacciones declinadas, incremento de $2.5M MXN/mes en revenue recuperado.

## Medición de beneficios

Tasa de recuperación por retry, revenue incremental por transacciones recuperadas, latencia adicional por retry.

## Alcance

Motor de reintentos con backoff exponencial, circuit breaker por procesador, fallback a procesador alternativo.

## Criterios de aceptación

Retry configurable por tipo de error, circuit breaker funcional, métricas en tiempo real de recuperación.

## Mejoras tecnológicas

Circuit breaker pattern (Resilience4j), exponential backoff, dead letter queue para fallos permanentes.

## Canales y flujos impactados

Canales: Todos — transparente para el usuario.

Flujos: Flujo de cobro, reintentos automáticos, notificaciones de estado.

## Dependencias de terceros

Procesadores de pago (para políticas de retry por procesador).`,
    status: EpicStatus.Done,
    priority: Priority.High,
    initiativeId: 'init-2',
    podIds: ['pod-1'],
    startDate: '2026-01-13',
    targetDate: '2026-02-28',
    createdAt: '2026-01-06T10:00:00Z',
    updatedAt: '2026-02-25T17:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  {
    id: 'epic-7',
    title: 'Panel de Monitoreo de Pagos',
    markdown: `## Descripción

Dashboard en tiempo real de métricas de pagos: tasas de aprobación, latencias, errores por procesador y alertas configurables.

## Beneficios cualitativos

Visibilidad operativa completa, detección proactiva de problemas, toma de decisiones basada en datos.

## Beneficios cuantitativos

Reducción del 50% en MTTR de incidentes de pagos, eliminación de reportes manuales (ahorro 40hrs/mes).

## Medición de beneficios

MTTR de incidentes de pagos, tiempo dedicado a reportes manuales, cantidad de alertas accionables.

## Alcance

Dashboard real-time con métricas por procesador, alertas configurables, exportación de reportes, drill-down por transacción.

## Criterios de aceptación

Datos en tiempo real (< 30s delay), al menos 10 métricas clave, alertas por Slack y email, exportación CSV/PDF.

## Mejoras tecnológicas

WebSockets para real-time, D3.js para visualizaciones, Elasticsearch para queries de alto volumen.

## Canales y flujos impactados

Canales: Herramienta interna — no impacta canales de cliente.

Flujos: Monitoreo operativo, gestión de incidentes, reportería ejecutiva.

## Dependencias de terceros

Elastic Cloud (Elasticsearch), PagerDuty (alertas), Slack (notificaciones).`,
    status: EpicStatus.InProgress,
    priority: Priority.Medium,
    initiativeId: 'init-2',
    podIds: ['pod-1', 'pod-2'],
    startDate: '2026-02-01',
    targetDate: '2026-04-30',
    createdAt: '2026-01-20T10:00:00Z',
    updatedAt: '2026-03-07T12:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  {
    id: 'epic-8',
    title: 'Reconciliación Automática',
    markdown: `## Descripción

Sistema automático de reconciliación de transacciones entre procesadores y el sistema contable, con manejo de discrepancias.

## Beneficios cualitativos

Eliminación de reconciliación manual, detección temprana de discrepancias, auditoría completa.

## Beneficios cuantitativos

Ahorro de 120hrs/mes en reconciliación manual, detección de discrepancias en < 1hr (vs 48hrs actual).

## Medición de beneficios

Horas dedicadas a reconciliación, tiempo de detección de discrepancias, porcentaje de auto-conciliación.

## Alcance

Ingesta de archivos de procesadores, matching automático con transacciones internas, workflow de resolución de discrepancias.

## Criterios de aceptación

Auto-conciliación del 95% de transacciones, alertas automáticas para discrepancias, interfaz de resolución manual.

## Mejoras tecnológicas

ETL pipelines (Airflow), matching algorithms, workflow engine para resolución.

## Canales y flujos impactados

Canales: Herramienta interna — Finanzas y Tesorería.

Flujos: Reconciliación diaria, reportes financieros, auditoría.

## Dependencias de terceros

Procesadores (formatos de archivo de conciliación), SAP (sistema contable).`,
    status: EpicStatus.Draft,
    priority: Priority.Medium,
    initiativeId: 'init-2',
    podIds: ['pod-1'],
    startDate: '2026-04-01',
    targetDate: '2026-06-30',
    createdAt: '2026-01-20T10:00:00Z',
    updatedAt: '2026-01-20T10:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  // === Initiative 3: Programa de Lealtad v2.0 ===
  {
    id: 'epic-9',
    title: 'Motor de Puntos Dinámico',
    markdown: `## Descripción

Nuevo motor de acumulación y redención de puntos con reglas dinámicas, multiplicadores por temporada y segmentación de clientes.

## Beneficios cualitativos

Programa de lealtad más atractivo, personalización por segmento, flexibilidad para campañas.

## Beneficios cuantitativos

Incremento del 25% en engagement del programa, aumento del 18% en repeat purchases, reducción del 10% en churn.

## Medición de beneficios

NPS del programa, tasa de redención, repeat purchase rate, churn rate por segmento.

## Alcance

Motor de reglas dinámicas, multiplicadores configurables, segmentación de clientes, API de acumulación y redención.

## Criterios de aceptación

Reglas configurables sin deploy, al menos 5 segmentos de cliente, API con latencia < 100ms.

## Mejoras tecnológicas

Rules engine (Drools), event-driven accrual, real-time segmentation.

## Canales y flujos impactados

Canales: Web, App, Call center, Counters.

Flujos: Acumulación de puntos, redención, estado de cuenta, campañas promocionales.

## Dependencias de terceros

Sabre (frequent flyer), partners de coalición (hoteles, renta de autos).`,
    status: EpicStatus.InProgress,
    priority: Priority.High,
    initiativeId: 'init-3',
    podIds: ['pod-3'],
    startDate: '2026-03-01',
    targetDate: '2026-06-30',
    createdAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-03-08T14:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  {
    id: 'epic-10',
    title: 'Catálogo de Recompensas',
    markdown: `## Descripción

Rediseño del catálogo con categorización inteligente, recomendaciones personalizadas y experiencia de canje mejorada.

## Beneficios cualitativos

Mejor descubrimiento de recompensas, experiencia de canje simplificada, mayor percepción de valor del programa.

## Beneficios cuantitativos

Incremento del 30% en tasa de redención, aumento del 20% en satisfacción con el catálogo.

## Medición de beneficios

Tasa de redención, encuestas de satisfacción, tiempo promedio de canje, search-to-redeem conversion.

## Alcance

Nuevo catálogo con categorías dinámicas, motor de recomendaciones, flujo de canje en 2 clics, wishlist.

## Criterios de aceptación

Catálogo con al menos 500 productos, recomendaciones personalizadas, canje en máximo 2 pasos.

## Mejoras tecnológicas

Algolia (search), ML-based recommendations, headless CMS para contenido del catálogo.

## Canales y flujos impactados

Canales: Web, App móvil.

Flujos: Exploración de catálogo, canje de puntos, tracking de envíos.

## Dependencias de terceros

Algolia (search), proveedores de productos, operador logístico.`,
    status: EpicStatus.Draft,
    priority: Priority.Medium,
    initiativeId: 'init-3',
    podIds: ['pod-3', 'pod-2'],
    startDate: '2026-05-01',
    targetDate: '2026-08-31',
    createdAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-02-15T10:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
  {
    id: 'epic-11',
    title: 'Integración con Partners',
    markdown: `## Descripción

APIs de integración con aerolíneas partner, hoteles y servicios terrestres para acumulación y redención cruzada.

## Beneficios cualitativos

Ecosistema de lealtad expandido, mayor valor percibido del programa, diferenciación competitiva.

## Beneficios cuantitativos

Incremento del 15% en acumulación total, 10 nuevos partners integrados, aumento del 12% en engagement.

## Medición de beneficios

Volumen de transacciones cross-partner, nuevos partners onboarded, puntos acumulados/redimidos con partners.

## Alcance

APIs de acumulación y redención para partners, portal de onboarding, dashboard de métricas por partner.

## Criterios de aceptación

API REST documentada, proceso de onboarding < 2 semanas, reconciliación automática con partners.

## Mejoras tecnológicas

API-first design, webhook-based notifications, partner portal con self-service.

## Canales y flujos impactados

Canales: APIs externas para partners, backoffice interno.

Flujos: Acumulación cruzada, redención en partners, reconciliación inter-empresa.

## Dependencias de terceros

Aerolíneas SkyTeam, cadenas hoteleras, Sabre (interline), IATA (estándares).`,
    status: EpicStatus.Draft,
    priority: Priority.Low,
    initiativeId: 'init-3',
    podIds: ['pod-3', 'pod-4'],
    startDate: '2026-06-01',
    targetDate: '2026-09-30',
    createdAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-02-15T10:00:00Z',
    documents: [],
    diagrams: [],
    dependencies: [],
    poApproval: null,
    tlApproval: null,
    qaMatrix: null,
    qaApproval: null,
    epicQAMatrix: null,
    designs: [],
    designSkipped: false,

  },
];
