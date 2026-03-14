/**
 * Mock AI QA Matrix Generation Agent
 *
 * In production this would call an LLM API with context from the epic definition,
 * user stories, and acceptance criteria to generate a comprehensive QA traceability
 * matrix. For now we simulate the agent by matching story keywords against test case
 * templates and generating realistic QA test cases.
 */

import { Epic, UserStory, QAMatrix, QAMatrixRow, QATestCase, TestCasePriority } from '@/types/proyectos';

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
      storyJiraKey: story.jiraKey,
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
