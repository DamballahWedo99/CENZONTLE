/**
 * Mock AI QA Matrix Generation Agent
 *
 * In production this would call an LLM API with context from the epic definition,
 * user stories, and acceptance criteria to generate a comprehensive QA traceability
 * matrix. For now we simulate the agent by matching story keywords against test case
 * templates and generating realistic QA test cases.
 */

import { Epic, UserStory, QAMatrix, QAMatrixRow, QATestCase, TestCasePriority, EpicQAMatrix, EpicQATest, EpicQATestCategory, GherkinScenario } from '@cenzontle/shared';

const testCaseTemplates: Record<string, { title: string; steps: string[]; expectedResult: string; priority: TestCasePriority }[]> = {
  pago: [
    { title: 'Validar procesamiento de pago exitoso', steps: ['Ingresar datos de pago válidos', 'Confirmar transacción', 'Verificar respuesta del gateway'], expectedResult: 'Pago procesado correctamente con confirmación', priority: 'critical' },
    { title: 'Validar manejo de pago rechazado', steps: ['Ingresar datos de pago inválidos', 'Intentar procesar', 'Verificar mensaje de error'], expectedResult: 'Error mostrado correctamente sin cobro duplicado', priority: 'critical' },
    { title: 'Validar timeout del gateway de pagos', steps: ['Simular timeout en gateway', 'Verificar reintentos', 'Validar estado final'], expectedResult: 'Transacción marcada como pendiente con reintento automático', priority: 'high' },
  ],
  checkout: [
    { title: 'Validar flujo completo de checkout', steps: ['Seleccionar productos', 'Agregar al carrito', 'Proceder al checkout', 'Completar pago'], expectedResult: 'Orden creada exitosamente', priority: 'critical' },
    { title: 'Validar carrito vacío', steps: ['Acceder a checkout sin productos', 'Verificar validación'], expectedResult: 'Redirección a catálogo con mensaje informativo', priority: 'medium' },
  ],
  autenticación: [
    { title: 'Validar login con credenciales válidas', steps: ['Ingresar email válido', 'Ingresar contraseña correcta', 'Click en iniciar sesión'], expectedResult: 'Sesión iniciada, redirección al dashboard', priority: 'critical' },
    { title: 'Validar bloqueo por intentos fallidos', steps: ['Ingresar contraseña incorrecta 5 veces', 'Verificar bloqueo temporal'], expectedResult: 'Cuenta bloqueada temporalmente con mensaje', priority: 'high' },
    { title: 'Validar expiración de sesión', steps: ['Iniciar sesión', 'Esperar tiempo de expiración', 'Intentar acción'], expectedResult: 'Redirección a login con mensaje de sesión expirada', priority: 'medium' },
  ],
  notificación: [
    { title: 'Validar envío de notificación email', steps: ['Disparar evento de notificación', 'Verificar cola de envío', 'Confirmar recepción'], expectedResult: 'Email recibido con contenido correcto', priority: 'high' },
    { title: 'Validar notificación push', steps: ['Configurar permisos push', 'Disparar notificación', 'Verificar recepción en dispositivo'], expectedResult: 'Notificación push recibida correctamente', priority: 'medium' },
  ],
  api: [
    { title: 'Validar respuesta exitosa del endpoint', steps: ['Enviar request con datos válidos', 'Verificar status 200', 'Validar schema de respuesta'], expectedResult: 'Respuesta correcta con schema válido', priority: 'critical' },
    { title: 'Validar manejo de errores 4xx/5xx', steps: ['Enviar requests inválidos', 'Verificar códigos de error', 'Validar mensajes'], expectedResult: 'Errores manejados correctamente con mensajes descriptivos', priority: 'high' },
    { title: 'Validar rate limiting', steps: ['Enviar múltiples requests rápidos', 'Verificar respuesta 429', 'Esperar y reintentar'], expectedResult: 'Rate limit aplicado correctamente', priority: 'medium' },
  ],
  migración: [
    { title: 'Validar integridad de datos migrados', steps: ['Ejecutar migración', 'Comparar registros origen vs destino', 'Verificar conteos'], expectedResult: '100% de registros migrados sin pérdida', priority: 'critical' },
    { title: 'Validar rollback de migración', steps: ['Ejecutar migración', 'Simular fallo', 'Ejecutar rollback', 'Verificar estado original'], expectedResult: 'Datos restaurados al estado previo', priority: 'critical' },
  ],
  reporte: [
    { title: 'Validar generación de reporte', steps: ['Seleccionar parámetros', 'Generar reporte', 'Verificar datos'], expectedResult: 'Reporte generado con datos correctos', priority: 'high' },
    { title: 'Validar exportación a Excel/PDF', steps: ['Generar reporte', 'Exportar en formato seleccionado', 'Abrir archivo'], expectedResult: 'Archivo exportado correctamente', priority: 'medium' },
  ],
  inventario: [
    { title: 'Validar actualización de inventario', steps: ['Realizar venta', 'Verificar decremento de stock', 'Validar historial'], expectedResult: 'Stock actualizado en tiempo real', priority: 'critical' },
    { title: 'Validar alertas de stock bajo', steps: ['Reducir stock por debajo del umbral', 'Verificar notificación', 'Validar dashboard'], expectedResult: 'Alerta generada y visible en dashboard', priority: 'high' },
  ],
};

const defaultTestCases = [
  { title: 'Validar flujo principal (happy path)', steps: ['Ejecutar flujo completo con datos válidos', 'Verificar resultado esperado'], expectedResult: 'Flujo completado exitosamente', priority: 'critical' as TestCasePriority },
  { title: 'Validar manejo de errores', steps: ['Ejecutar flujo con datos inválidos', 'Verificar mensajes de error'], expectedResult: 'Errores manejados correctamente', priority: 'high' as TestCasePriority },
  { title: 'Validar rendimiento bajo carga', steps: ['Ejecutar con múltiples usuarios concurrentes', 'Medir tiempos de respuesta'], expectedResult: 'Tiempos dentro de SLA definido', priority: 'medium' as TestCasePriority },
];

function findBestTemplate(story: UserStory): { title: string; steps: string[]; expectedResult: string; priority: TestCasePriority }[] {
  const text = (story.title + ' ' + story.description).toLowerCase();

  let bestKey: string | null = null;
  let bestScore = 0;

  for (const key of Object.keys(testCaseTemplates)) {
    // Count how many times the keyword appears in the story text
    const regex = new RegExp(key, 'gi');
    const matches = text.match(regex);
    const score = matches ? matches.length : 0;

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestKey && bestScore > 0) {
    return testCaseTemplates[bestKey];
  }

  return [];
}

function generateTestCasesForStory(story: UserStory, storyIndex: number): QATestCase[] {
  const matchedTemplates = findBestTemplate(story);
  const cases: QATestCase[] = [];
  const usedTitles = new Set<string>();
  let caseIdx = 0;

  // Add matched template test cases
  for (const template of matchedTemplates) {
    if (usedTitles.has(template.title)) continue;
    usedTitles.add(template.title);
    cases.push({
      id: `tc-${Date.now()}-${storyIndex}-${++caseIdx}`,
      title: template.title,
      description: `Caso de prueba para: ${story.title}`,
      steps: template.steps,
      expectedResult: template.expectedResult,
      status: 'pending',
      priority: template.priority,
      assignedTo: null,
      automationStatus: 'to_automate',
      linkedDefects: [],
      executionHistory: [],
      trend: null,
    });
  }

  // Add 1-2 default test cases to ensure minimum 2 cases per story
  for (const defaultCase of defaultTestCases) {
    if (cases.length >= Math.max(2, matchedTemplates.length + 1)) break;
    if (usedTitles.has(defaultCase.title)) continue;
    usedTitles.add(defaultCase.title);
    cases.push({
      id: `tc-${Date.now()}-${storyIndex}-${++caseIdx}`,
      title: defaultCase.title,
      description: `Caso de prueba genérico para: ${story.title}`,
      steps: defaultCase.steps,
      expectedResult: defaultCase.expectedResult,
      status: 'pending',
      priority: defaultCase.priority,
      assignedTo: null,
      automationStatus: 'to_automate',
      linkedDefects: [],
      executionHistory: [],
      trend: null,
    });
  }

  // Guarantee at least 2 test cases
  if (cases.length < 2) {
    for (const defaultCase of defaultTestCases) {
      if (cases.length >= 2) break;
      if (usedTitles.has(defaultCase.title)) continue;
      usedTitles.add(defaultCase.title);
      cases.push({
        id: `tc-${Date.now()}-${storyIndex}-${++caseIdx}`,
        title: defaultCase.title,
        description: `Caso de prueba genérico para: ${story.title}`,
        steps: defaultCase.steps,
        expectedResult: defaultCase.expectedResult,
        status: 'pending',
        priority: defaultCase.priority,
        assignedTo: null,
        automationStatus: 'to_automate',
        linkedDefects: [],
        executionHistory: [],
        trend: null,
      });
    }
  }

  return cases;
}

/** Simulates an AI agent generating a QA traceability matrix from an epic and its stories. */
export async function generateQAMatrix(epic: Epic, stories: UserStory[]): Promise<QAMatrix> {
  // Simulate AI thinking time (2-4s)
  await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 2000));

  const rows: QAMatrixRow[] = stories.map((story, index) => {
    const testCases = generateTestCasesForStory(story, index);

    return {
      storyId: story.id,
      storyTitle: story.title,
      storyJiraKey: story.tracker?.externalKey ?? '',
      acceptanceCriteria: story.po.acceptanceCriteria,
      testCases,
      coverage: 0, // All test cases start as pending, so 0% coverage
    };
  });

  const now = new Date().toISOString();

  return {
    id: `qa-matrix-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    epicId: epic.id,
    rows,
    generatedAt: now,
    generatedBy: 'ai',
    updatedAt: now,
  };
}

// === EPIC-LEVEL (SYSTEMIC) QA GENERATION ===

const epicTestTemplates: Record<string, Record<EpicQATestCategory, { title: string; scenarios: string[]; priority: TestCasePriority }[]>> = {
  pago: {
    integration: [
      { title: 'Integración gateway de pagos con servicio de órdenes', scenarios: ['Crear orden → procesar pago → confirmar orden', 'Pago fallido → orden cancelada automáticamente', 'Webhook de confirmación actualiza estado de orden'], priority: 'critical' },
      { title: 'Integración con servicio de notificaciones post-pago', scenarios: ['Pago exitoso → email de confirmación', 'Pago fallido → email con instrucciones', 'Reembolso → notificación al cliente'], priority: 'high' },
    ],
    e2e: [
      { title: 'Flujo completo de compra: selección → checkout → pago → confirmación', scenarios: ['Usuario selecciona producto, completa datos, paga con tarjeta y recibe confirmación', 'Usuario con carrito múltiple, aplica cupón, paga y verifica montos', 'Usuario invitado vs registrado completa el mismo flujo'], priority: 'critical' },
    ],
    performance: [
      { title: 'Procesamiento de pagos bajo carga concurrente', scenarios: ['100 transacciones simultáneas con tiempo de respuesta < 3s', 'Pico de 500 usuarios en checkout sin degradación', 'Throughput mínimo de 50 TPS sostenido'], priority: 'high' },
    ],
    security: [
      { title: 'Cumplimiento PCI-DSS en manejo de datos de tarjeta', scenarios: ['Datos de tarjeta nunca almacenados en logs', 'Tokenización antes de transmisión', 'Encriptación TLS 1.3 en todas las comunicaciones'], priority: 'critical' },
      { title: 'Prevención de fraude y doble cobro', scenarios: ['Idempotencia en procesamiento de pagos', 'Detección de patrones sospechosos', 'Rate limiting por usuario en endpoint de pago'], priority: 'critical' },
    ],
    compatibility: [
      { title: 'Checkout funcional en principales navegadores y dispositivos', scenarios: ['Chrome, Firefox, Safari, Edge en desktop', 'Safari iOS, Chrome Android en mobile', 'Formulario de pago responsive en todas las resoluciones'], priority: 'high' },
    ],
    reliability: [
      { title: 'Resiliencia ante caída de procesador de pagos', scenarios: ['Failover a procesador secundario < 5s', 'Cola de reintentos para pagos pendientes', 'Recuperación automática al restaurar servicio'], priority: 'critical' },
    ],
    safety: [
      { title: 'Validar protecciones contra cobros duplicados', scenarios: ['Idempotencia en reintentos de pago', 'Bloqueo de doble-click en botón de pagar', 'Confirmación obligatoria antes de procesar pago'], priority: 'critical' },
    ],
    usability: [
      { title: 'Validar experiencia de checkout accesible', scenarios: ['Formulario de pago navegable por teclado', 'Mensajes de error descriptivos y accesibles', 'Indicadores visuales de progreso del pago'], priority: 'medium' },
    ],
    maintainability: [
      { title: 'Validar modularidad del módulo de pagos', scenarios: ['Procesadores de pago intercambiables via interfaz', 'Tests unitarios del módulo de pagos > 80%', 'Documentación OpenAPI actualizada'], priority: 'medium' },
    ],
  },
  plataforma: {
    integration: [
      { title: 'Integración entre microservicios del ecosistema', scenarios: ['Comunicación API-to-API entre servicios core', 'Contratos OpenAPI validados entre consumer y provider', 'Circuit breaker activado ante fallo de dependencia'], priority: 'critical' },
    ],
    e2e: [
      { title: 'Flujo principal de usuario en la plataforma', scenarios: ['Login → navegación → acción principal → logout', 'Onboarding de nuevo usuario completo', 'Flujo de autoservicio sin intervención humana'], priority: 'critical' },
    ],
    performance: [
      { title: 'Rendimiento de la plataforma bajo carga esperada', scenarios: ['P95 latencia < 2s para endpoints principales', 'Core Web Vitals: LCP < 2.5s, FID < 100ms, CLS < 0.1', 'Tiempo de carga inicial < 3s en conexión 3G'], priority: 'high' },
    ],
    security: [
      { title: 'Auditoría de seguridad de la plataforma', scenarios: ['OWASP Top 10 sin vulnerabilidades críticas', 'Headers de seguridad configurados (CSP, HSTS, X-Frame)', 'Autenticación y autorización validadas en todos los endpoints'], priority: 'critical' },
    ],
    compatibility: [
      { title: 'Compatibilidad cross-browser y cross-device', scenarios: ['Funcionalidad completa en últimas 2 versiones de browsers principales', 'Diseño responsive funcional en mobile, tablet y desktop', 'Accesibilidad WCAG 2.1 AA en flujos principales'], priority: 'high' },
    ],
    reliability: [
      { title: 'Alta disponibilidad de la plataforma', scenarios: ['Uptime > 99.9% medido mensualmente', 'Recuperación ante fallo < 5 minutos (RTO)', 'Pérdida de datos < 1 minuto (RPO)'], priority: 'high' },
    ],
    safety: [
      { title: 'Validar protecciones operativas de la plataforma', scenarios: ['Operaciones admin requieren 2FA', 'Límites de rate configurables por endpoint', 'Alertas automáticas ante comportamiento anómalo'], priority: 'high' },
    ],
    usability: [
      { title: 'Validar experiencia de usuario inclusiva', scenarios: ['WCAG 2.1 AA en todos los flujos principales', 'Soporte para lectores de pantalla', 'Internacionalización correcta en todos los textos'], priority: 'medium' },
    ],
    maintainability: [
      { title: 'Validar mantenibilidad de la plataforma', scenarios: ['Cobertura de tests > 75%', 'Complejidad ciclomática < 15 por función', 'Zero warnings en linter/type-check'], priority: 'medium' },
    ],
  },
};

const defaultEpicTestTemplates: Record<EpicQATestCategory, { title: string; scenarios: string[]; priority: TestCasePriority }[]> = {
  integration: [
    { title: 'Validar integración entre componentes de la épica', scenarios: ['Comunicación correcta entre módulos', 'Manejo de errores en comunicación inter-módulo', 'Consistencia de datos entre componentes'], priority: 'high' },
  ],
  e2e: [
    { title: 'Validar flujo de usuario end-to-end', scenarios: ['Flujo principal (happy path) completo', 'Flujos alternativos y excepcionales', 'Flujo con datos límite'], priority: 'critical' },
  ],
  performance: [
    { title: 'Validar rendimiento bajo carga esperada', scenarios: ['Tiempos de respuesta dentro de SLA bajo carga normal', 'Comportamiento bajo pico de carga (2x normal)', 'Sin memory leaks en operación prolongada'], priority: 'medium' },
  ],
  security: [
    { title: 'Validar controles de seguridad', scenarios: ['Autenticación requerida en endpoints protegidos', 'Autorización basada en roles funcional', 'Datos sensibles encriptados en tránsito y reposo'], priority: 'high' },
  ],
  compatibility: [
    { title: 'Validar compatibilidad cross-platform', scenarios: ['Funcionalidad en navegadores principales', 'Diseño responsive en diferentes resoluciones'], priority: 'medium' },
  ],
  reliability: [
    { title: 'Validar resiliencia ante fallos', scenarios: ['Recuperación automática ante fallo de dependencia', 'Degradación graceful cuando un servicio no está disponible'], priority: 'high' },
  ],
  safety: [
    { title: 'Validar restricciones operativas y fail-safe', scenarios: ['Operaciones destructivas requieren confirmación', 'Rollback automático ante estado inconsistente', 'Advertencias claras antes de acciones irreversibles'], priority: 'high' },
  ],
  usability: [
    { title: 'Validar accesibilidad y experiencia de usuario', scenarios: ['Navegación completa por teclado', 'Cumplimiento WCAG 2.1 AA en flujos principales', 'Contraste y legibilidad en modo claro y oscuro'], priority: 'medium' },
  ],
  maintainability: [
    { title: 'Validar testabilidad y modularidad del código', scenarios: ['Cobertura de tests unitarios > 70%', 'Sin dependencias circulares entre módulos', 'APIs documentadas con contratos OpenAPI'], priority: 'medium' },
  ],
};

function findBestEpicTemplate(epic: Epic): Record<EpicQATestCategory, { title: string; scenarios: string[]; priority: TestCasePriority }[]> | null {
  const text = (epic.title + ' ' + epic.description + ' ' + epic.scopeDescription).toLowerCase();
  let bestKey: string | null = null;
  let bestScore = 0;

  for (const key of Object.keys(epicTestTemplates)) {
    const regex = new RegExp(key, 'gi');
    const matches = text.match(regex);
    const score = matches ? matches.length : 0;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey && bestScore > 0 ? epicTestTemplates[bestKey] : null;
}

function scenarioToGherkin(scenario: string, index: number): GherkinScenario {
  // Parse "X → Y → Z" patterns into Given/When/Then
  const parts = scenario.split('→').map(s => s.trim());
  if (parts.length >= 3) {
    return {
      id: `gherkin-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 5)}`,
      name: parts[0],
      given: parts[0],
      when: parts[1],
      then: parts[parts.length - 1],
      tags: [],
    };
  }
  // Parse "X con Y" or single statement
  return {
    id: `gherkin-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 5)}`,
    name: scenario.slice(0, 60),
    given: 'El sistema está en estado operativo',
    when: scenario,
    then: 'El resultado es el esperado',
    tags: [],
  };
}

/** Simulates an AI agent generating an epic-level (systemic) QA matrix from an epic's context. */
export async function generateEpicQAMatrix(epic: Epic): Promise<EpicQAMatrix> {
  // Simulate AI thinking time (2-4s)
  await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 2000));

  const matchedTemplate = findBestEpicTemplate(epic);
  const template = matchedTemplate ?? defaultEpicTestTemplates;

  const tests: EpicQATest[] = [];
  const categories: EpicQATestCategory[] = ['integration', 'e2e', 'performance', 'security', 'compatibility', 'reliability', 'safety', 'usability', 'maintainability'];
  let testIdx = 0;

  for (const category of categories) {
    const categoryTests = template[category] ?? defaultEpicTestTemplates[category];
    for (const t of categoryTests) {
      tests.push({
        id: `epic-tc-${Date.now()}-${++testIdx}`,
        category,
        title: t.title,
        description: `Test sistémico de ${category} para: ${epic.title}`,
        scenarios: t.scenarios,
        gherkinScenarios: t.scenarios.map((s, sIdx) => scenarioToGherkin(s, sIdx)),
        dependencies: [],
        status: 'pending',
        priority: t.priority,
        assignedTo: null,
        automationStatus: category === 'e2e' || category === 'integration' ? 'to_automate' : 'manual',
        linkedDefects: [],
        riskLikelihood: t.priority === 'critical' ? 4 : t.priority === 'high' ? 3 : 2,
        riskImpact: t.priority === 'critical' ? 5 : t.priority === 'high' ? 4 : 3,
        executionHistory: [],
        trend: null,
      });
    }
  }

  const nfrCoverage: Record<EpicQATestCategory, number> = {
    integration: 0,
    e2e: 0,
    performance: 0,
    security: 0,
    compatibility: 0,
    reliability: 0,
    safety: 0,
    usability: 0,
    maintainability: 0,
  };

  const now = new Date().toISOString();

  return {
    id: `epic-qa-matrix-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    epicId: epic.id,
    tests,
    nfrCoverage,
    generatedAt: now,
    generatedBy: 'ai',
    updatedAt: now,
  };
}
