import type { EpicDocumentSection } from '@cenzontle/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CopilotMessageRole = 'user' | 'assistant';

export interface CopilotDocPreview {
  id: string;
  name: string;
  sections: EpicDocumentSection[];
  format: 'pdf' | 'excel' | 'word' | 'csv';
  status: 'preview' | 'accepted' | 'rejected';
}

export interface CopilotMessage {
  id: string;
  role: CopilotMessageRole;
  content: string;
  timestamp: string;
  docPreview?: CopilotDocPreview;
}

export interface CopilotContext {
  entityType: string;
  entityTitle: string;
  entityDescription: string;
  entityLabel: string;
  fields: Record<string, string>;
  items: string[];
  diagramTypes: string[];
  existingDocs: string[];
}

// ─── Entity Labels ──────────────────────────────────────────────────────────

function entityNoun(ctx: CopilotContext): string {
  switch (ctx.entityType) {
    case 'initiative': return 'iniciativa';
    case 'epic': return 'epica';
    default: return ctx.entityType;
  }
}

function itemNoun(ctx: CopilotContext): string {
  switch (ctx.entityType) {
    case 'initiative': return 'epicas asociadas';
    case 'epic': return 'historias de usuario';
    default: return 'elementos';
  }
}

function itemNounSingular(ctx: CopilotContext): string {
  switch (ctx.entityType) {
    case 'initiative': return 'epica';
    case 'epic': return 'historia de usuario';
    default: return 'elemento';
  }
}

// ─── Suggested Prompts ──────────────────────────────────────────────────────

const epicPrompts: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Especificacion tecnica', prompt: 'Genera una especificacion tecnica detallada de esta epica' },
  { label: 'Plan de pruebas', prompt: 'Crea un plan de pruebas completo basado en las historias de usuario' },
  { label: 'Documento de alcance', prompt: 'Genera un documento de alcance y objetivos del proyecto' },
  { label: 'Reporte ejecutivo', prompt: 'Crea un reporte ejecutivo para presentar a stakeholders' },
  { label: 'Guia de usuario', prompt: 'Genera una guia de usuario para esta funcionalidad' },
  { label: 'Analisis de impacto', prompt: 'Analiza el impacto tecnico y de negocio de esta epica' },
];

const initiativePrompts: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Resumen ejecutivo', prompt: 'Genera un resumen ejecutivo de esta iniciativa' },
  { label: 'Analisis de inversion', prompt: 'Crea un analisis de inversion y retorno' },
  { label: 'Roadmap', prompt: 'Genera un documento de roadmap con fases e hitos' },
  { label: 'Reporte de stakeholders', prompt: 'Crea un reporte de avance para stakeholders' },
  { label: 'Analisis de riesgos', prompt: 'Analiza los riesgos de esta iniciativa' },
  { label: 'Documento de alcance', prompt: 'Genera un documento de alcance de la iniciativa' },
];

/** Backward-compatible export — returns epic prompts by default. */
export const suggestedPrompts = epicPrompts;

export function getSuggestedPrompts(entityType: string): ReadonlyArray<{ label: string; prompt: string }> {
  switch (entityType) {
    case 'initiative': return initiativePrompts;
    case 'epic':
    default: return epicPrompts;
  }
}

// ─── Intent Detection ────────────────────────────────────────────────────────

type CopilotIntent = 'generate' | 'refine' | 'answer';
type DocFormat = CopilotDocPreview['format'];

const GENERATE_KEYWORDS = [
  'genera', 'crea', 'documento', 'documentacion', 'especificacion',
  'reporte', 'plan', 'guia', 'notas', 'release', 'analisis',
  'resumen', 'roadmap', 'inversion',
];

const REFINE_KEYWORDS = [
  'mejora', 'refina', 'cambia', 'modifica', 'actualiza',
  'mas detalle', 'expande', 'reduce', 'simplifica',
];

const FORMAT_KEYWORDS: ReadonlyArray<[string, DocFormat]> = [
  ['excel', 'excel'],
  ['word', 'word'],
  ['csv', 'csv'],
  ['pdf', 'pdf'],
];

function hasDocPreviewInHistory(history: CopilotMessage[]): boolean {
  return history.some((m) => m.role === 'assistant' && m.docPreview);
}

function detectIntent(message: string, history: CopilotMessage[]): CopilotIntent {
  const lower = message.toLowerCase();

  if (REFINE_KEYWORDS.some((kw) => lower.includes(kw)) && hasDocPreviewInHistory(history)) {
    return 'refine';
  }

  if (GENERATE_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'generate';
  }

  return 'answer';
}

function detectFormat(message: string): DocFormat {
  const lower = message.toLowerCase();
  for (const [keyword, format] of FORMAT_KEYWORDS) {
    if (lower.includes(keyword)) return format;
  }
  return 'pdf';
}

// ─── Document Templates ──────────────────────────────────────────────────────

type DocTemplateKey =
  | 'technical-spec'
  | 'functional-spec'
  | 'test-plan'
  | 'executive-report'
  | 'user-guide'
  | 'impact-analysis'
  | 'scope-document'
  | 'release-notes'
  | 'architecture-doc'
  | 'risk-analysis'
  | 'initiative-summary'
  | 'investment-analysis'
  | 'roadmap-doc'
  | 'stakeholder-report';

interface DocTemplate {
  name: string;
  keywords: string[];
  entityTypes?: string[];
  sectionDefs: ReadonlyArray<{
    title: string;
    build: (ctx: CopilotContext) => string;
  }>;
}

function field(ctx: CopilotContext, key: string, fallback = 'Pendiente de definicion'): string {
  return ctx.fields[key] || fallback;
}

function itemList(ctx: CopilotContext, prefix?: (i: number) => string): string {
  if (ctx.items.length === 0) return `No hay ${itemNoun(ctx)} asociadas.`;
  const fmt = prefix ?? ((i) => `${i + 1}.`);
  return ctx.items.map((s, i) => `${fmt(i)} ${s}`).join('\n');
}

const TEMPLATES: Record<DocTemplateKey, DocTemplate> = {
  // ── Epic & general templates ────────────────────────────────────────────

  'technical-spec': {
    name: 'Especificacion Tecnica',
    keywords: ['tecnica', 'tecnico', 'technical', 'spec'],
    sectionDefs: [
      { title: 'Resumen Ejecutivo', build: (ctx) => `Especificacion tecnica para "${ctx.entityTitle}".\n\n${ctx.entityDescription}` },
      { title: 'Arquitectura Propuesta', build: (ctx) => `La solucion se construira considerando:\n\n${field(ctx, 'technologicalImprovements', 'Pendiente de definir la arquitectura.')}\n\nDiagramas disponibles: ${ctx.diagramTypes.length > 0 ? ctx.diagramTypes.join(', ') : 'Ninguno generado aun.'}` },
      { title: 'Componentes del Sistema', build: (ctx) => `Componentes derivados del alcance de "${ctx.entityTitle}".\n\n${field(ctx, 'scopeDescription')}` },
      { title: 'Dependencias Tecnicas', build: (ctx) => field(ctx, 'thirdPartyDependencies', 'Sin dependencias externas identificadas.') },
      { title: 'Plan de Implementacion', build: (ctx) => `Equipos involucrados: ${field(ctx, 'teamsInvolved', 'Por definir')}\nFecha inicio: ${field(ctx, 'startDate', 'N/A')}\nFecha objetivo: ${field(ctx, 'targetDate', 'N/A')}\n\n${itemNoun(ctx).charAt(0).toUpperCase() + itemNoun(ctx).slice(1)}:\n${itemList(ctx)}` },
      { title: 'Riesgos Tecnicos', build: (ctx) => `Nivel de impacto Sabre: ${field(ctx, 'impactSabreLevel', 'No definido')}\nFlujos impactados: ${field(ctx, 'impactedFlows', 'Ninguno identificado')}\nCanales impactados: ${field(ctx, 'impactedChannels', 'Por determinar')}` },
    ],
  },

  'functional-spec': {
    name: 'Especificacion Funcional',
    keywords: ['funcional', 'functional', 'requisitos', 'requerimientos'],
    sectionDefs: [
      { title: 'Objetivo', build: (ctx) => `Documentar los requisitos funcionales de "${ctx.entityTitle}" para asegurar claridad en el alcance.` },
      { title: 'Alcance Funcional', build: (ctx) => field(ctx, 'scopeDescription') },
      { title: 'Requisitos Funcionales', build: (ctx) => ctx.items.length > 0 ? `Requisitos derivados de ${itemNoun(ctx)}:\n\n${itemList(ctx, (i) => `RF-${String(i + 1).padStart(3, '0')}:`)}` : 'Pendiente de definir requisitos funcionales.' },
      { title: 'Requisitos No Funcionales', build: () => '- Rendimiento: Tiempo de respuesta < 3 segundos\n- Disponibilidad: 99.9% uptime\n- Seguridad: Cumplimiento con estandares corporativos\n- Escalabilidad: Soporte para crecimiento proyectado' },
      { title: 'Reglas de Negocio', build: (ctx) => `Prioridad de negocio: ${field(ctx, 'businessPriority', 'No definida')}\n\n${field(ctx, 'qualitativeBenefits', '')}` },
      { title: 'Criterios de Aceptacion', build: (ctx) => field(ctx, 'acceptanceCriteria', 'Pendiente de definir criterios de aceptacion.') },
    ],
  },

  'test-plan': {
    name: 'Plan de Pruebas',
    keywords: ['pruebas', 'testing', 'test', 'qa', 'calidad'],
    sectionDefs: [
      { title: 'Objetivo del Plan', build: (ctx) => `Definir la estrategia de pruebas para validar la correcta implementacion de "${ctx.entityTitle}".` },
      { title: 'Alcance de Pruebas', build: (ctx) => field(ctx, 'scopeDescription', `Cobertura completa del alcance definido en la ${entityNoun(ctx)}.`) },
      { title: 'Estrategia de Pruebas', build: () => '- Pruebas unitarias\n- Pruebas de integracion\n- Pruebas end-to-end\n- Pruebas de rendimiento\n- Pruebas de seguridad\n- Pruebas de regresion' },
      { title: 'Casos de Prueba', build: (ctx) => ctx.items.length > 0 ? ctx.items.map((s, i) => `### ${itemNounSingular(ctx).charAt(0).toUpperCase() + itemNounSingular(ctx).slice(1)}: ${s}\n- CP-${String(i + 1).padStart(3, '0')}-01: Flujo principal exitoso\n- CP-${String(i + 1).padStart(3, '0')}-02: Validacion de datos de entrada\n- CP-${String(i + 1).padStart(3, '0')}-03: Manejo de errores`).join('\n\n') : `No hay ${itemNoun(ctx)} para generar casos de prueba.` },
      { title: 'Criterios de Entrada/Salida', build: () => '**Entrada:**\n- Codigo desplegado en ambiente QA\n- Documentacion tecnica disponible\n- Datos de prueba preparados\n\n**Salida:**\n- Cobertura de codigo > 80%\n- 0 bugs criticos abiertos\n- Pruebas de regresion al 100%\n- Sign-off del QA Lead' },
      { title: 'Recursos Necesarios', build: (ctx) => `Equipos: ${field(ctx, 'teamsInvolved', 'Por definir')}\nDependencias externas: ${field(ctx, 'thirdPartyDependencies', 'Ninguna')}` },
    ],
  },

  'executive-report': {
    name: 'Reporte Ejecutivo',
    keywords: ['ejecutivo', 'executive', 'presentar', 'presentacion'],
    sectionDefs: [
      { title: 'Resumen Ejecutivo', build: (ctx) => `"${ctx.entityTitle}" es una ${entityNoun(ctx)} que busca entregar valor significativo al negocio.\n\n${ctx.entityDescription}` },
      { title: 'Estado Actual', build: (ctx) => `Prioridad: ${field(ctx, 'priority', 'No definida')}\n${itemNoun(ctx).charAt(0).toUpperCase() + itemNoun(ctx).slice(1)}: ${ctx.items.length}\nDocumentos generados: ${ctx.existingDocs.length}` },
      { title: 'Beneficios Esperados', build: (ctx) => `**Cualitativos:**\n${field(ctx, 'qualitativeBenefits', 'Pendiente de cuantificar.')}\n\n**Cuantitativos:**\n${field(ctx, 'quantitativeBenefits', 'Pendiente de cuantificar.')}\n\n**Medicion:**\n${field(ctx, 'benefitsMeasurement', 'Pendiente de definir metricas.')}` },
      { title: 'Riesgos y Mitigaciones', build: (ctx) => `Dependencias de terceros: ${field(ctx, 'thirdPartyDependencies', 'Ninguna')}\nCanales impactados: ${field(ctx, 'impactedChannels', 'Por determinar')}` },
      { title: 'Cronograma', build: (ctx) => `Inicio: ${field(ctx, 'startDate', 'Por definir')}\nFecha objetivo: ${field(ctx, 'targetDate', 'Por definir')}` },
      { title: 'Proximos Pasos', build: () => '1. Validacion de requisitos con stakeholders\n2. Aprobacion del Product Owner\n3. Inicio de sprint de desarrollo\n4. Revision de avance semanal' },
    ],
  },

  'user-guide': {
    name: 'Guia de Usuario',
    keywords: ['guia', 'usuario', 'manual', 'instrucciones', 'como'],
    sectionDefs: [
      { title: 'Introduccion', build: (ctx) => `Esta guia describe como utilizar las funcionalidades implementadas en "${ctx.entityTitle}".\n\n${ctx.entityDescription}` },
      { title: 'Requisitos Previos', build: (ctx) => `Canales disponibles: ${field(ctx, 'impactedChannels', 'Todos los canales habilitados.')}\nFlujos principales: ${field(ctx, 'impactedFlows', 'Consultar con el equipo de producto.')}` },
      { title: 'Guia Paso a Paso', build: (ctx) => ctx.items.length > 0 ? ctx.items.map((s, i) => `### ${i + 1}. ${s}\nDescripcion detallada de la funcionalidad y pasos para utilizarla.`).join('\n\n') : `Las funcionalidades se detallaran conforme se definan ${itemNoun(ctx)}.` },
      { title: 'Preguntas Frecuentes', build: () => '1. **Cuando estara disponible?**\n   Segun el cronograma del proyecto.\n\n2. **Necesito capacitacion?**\n   Se proporcionara material de capacitacion y soporte.\n\n3. **Donde reporto problemas?**\n   A traves del canal de soporte habitual o Jira.' },
      { title: 'Soporte', build: (ctx) => `Para soporte sobre "${ctx.entityTitle}", contactar al equipo asignado: ${field(ctx, 'teamsInvolved', 'Por definir')}.` },
    ],
  },

  'impact-analysis': {
    name: 'Analisis de Impacto',
    keywords: ['impacto', 'impact', 'afecta', 'consecuencias'],
    sectionDefs: [
      { title: 'Resumen de Impacto', build: (ctx) => `Analisis de impacto tecnico y de negocio para "${ctx.entityTitle}".\n\n${ctx.entityDescription}` },
      { title: 'Impacto en Canales', build: (ctx) => field(ctx, 'impactedChannels', 'Sin impacto en canales identificado.') },
      { title: 'Impacto en Flujos', build: (ctx) => field(ctx, 'impactedFlows', 'Sin impacto en flujos identificado.') },
      { title: 'Dependencias de Terceros', build: (ctx) => field(ctx, 'thirdPartyDependencies', 'Sin dependencias externas afectadas.') },
      { title: 'Mitigaciones', build: () => '1. Realizar pruebas de impacto en ambiente de staging\n2. Coordinar con equipos dependientes\n3. Planificar rollback para cada componente\n4. Monitoreo post-despliegue durante 72 horas' },
      { title: 'Recomendaciones', build: (ctx) => `Equipos involucrados: ${field(ctx, 'teamsInvolved', 'Por definir')}\n${itemNoun(ctx).charAt(0).toUpperCase() + itemNoun(ctx).slice(1)} afectadas: ${ctx.items.length}\n\nSe recomienda una evaluacion detallada antes de proceder con la implementacion.` },
    ],
  },

  'scope-document': {
    name: 'Documento de Alcance',
    keywords: ['alcance', 'scope', 'objetivos', 'objetivo'],
    sectionDefs: [
      { title: 'Objetivo del Proyecto', build: (ctx) => `Definir el alcance y objetivos de "${ctx.entityTitle}".\n\n${ctx.entityDescription}` },
      { title: 'Dentro del Alcance', build: (ctx) => field(ctx, 'scopeDescription') },
      { title: 'Fuera del Alcance', build: () => 'Los siguientes elementos quedan explicitamente fuera del alcance:\n- Funcionalidades no priorizadas en el backlog actual\n- Integraciones con sistemas no listados en las dependencias\n- Cambios en procesos de negocio no documentados' },
      { title: 'Supuestos', build: (ctx) => `- Los equipos asignados estaran disponibles segun el cronograma\n- Las dependencias externas estaran resueltas a tiempo\n- Fecha objetivo: ${field(ctx, 'targetDate', 'Por definir')}` },
      { title: 'Restricciones', build: (ctx) => `Equipos: ${field(ctx, 'teamsInvolved', 'Por definir')}\nDependencias: ${field(ctx, 'thirdPartyDependencies', 'Ninguna')}` },
      { title: 'Entregables', build: (ctx) => ctx.items.length > 0 ? `Entregables derivados de ${itemNoun(ctx)}:\n\n${itemList(ctx)}` : `Los entregables se definiran con ${itemNoun(ctx)}.` },
    ],
  },

  'release-notes': {
    name: 'Notas de Release',
    keywords: ['release', 'version', 'despliegue', 'deploy', 'lanzamiento', 'notas'],
    sectionDefs: [
      { title: 'Resumen de Version', build: (ctx) => `# ${ctx.entityTitle}\n\nVersion: 1.0\nFecha planificada: ${field(ctx, 'targetDate', 'Por definir')}` },
      { title: 'Nuevas Funcionalidades', build: (ctx) => ctx.items.length > 0 ? ctx.items.map((s) => `- ${s}`).join('\n') : `Sin ${itemNoun(ctx)} asociadas.` },
      { title: 'Mejoras', build: (ctx) => field(ctx, 'technologicalImprovements', 'Sin mejoras tecnologicas documentadas.') },
      { title: 'Correcciones', build: () => 'No hay correcciones incluidas en esta version.' },
      { title: 'Problemas Conocidos', build: () => 'No se han identificado problemas conocidos al momento del release.' },
      { title: 'Notas de Despliegue', build: () => '1. Validar en ambiente de staging\n2. Ejecutar smoke tests\n3. Desplegar en produccion en ventana de bajo trafico\n4. Monitorear metricas durante 1 hora post-despliegue' },
    ],
  },

  'architecture-doc': {
    name: 'Documento de Arquitectura',
    keywords: ['arquitectura', 'architecture', 'componentes', 'diseno tecnico'],
    sectionDefs: [
      { title: 'Vision General', build: (ctx) => `Arquitectura de la solucion para "${ctx.entityTitle}".\n\n${ctx.entityDescription}` },
      { title: 'Diagrama de Componentes', build: (ctx) => `Componentes propuestos:\n${field(ctx, 'technologicalImprovements', 'Pendiente de definir.')}\n\nDiagramas existentes: ${ctx.diagramTypes.length > 0 ? ctx.diagramTypes.join(', ') : 'Ninguno.'}` },
      { title: 'Flujos de Datos', build: (ctx) => field(ctx, 'impactedFlows', 'Pendiente de documentar flujos de datos.') },
      { title: 'Tecnologias Utilizadas', build: (ctx) => `Dependencias de terceros: ${field(ctx, 'thirdPartyDependencies', 'Ninguna identificada.')}\nNivel de impacto Sabre: ${field(ctx, 'impactSabreLevel', 'No evaluado')}` },
      { title: 'Decisiones de Diseno', build: () => '| Decision | Justificacion | Alternativas Consideradas |\n|----------|---------------|---------------------------|\n| Pendiente | Pendiente | Pendiente |' },
      { title: 'Escalabilidad', build: () => 'Consideraciones de rendimiento:\n- Tiempo de respuesta objetivo: < 3 segundos\n- Throughput esperado: Segun analisis de capacidad\n- Estrategia de cache: Por definir\n- Plan de monitoreo: Metricas de APM' },
    ],
  },

  'risk-analysis': {
    name: 'Analisis de Riesgos',
    keywords: ['riesgo', 'riesgos', 'risk', 'mitigacion', 'contingencia'],
    sectionDefs: [
      { title: 'Resumen de Riesgos', build: (ctx) => `Analisis de riesgos para "${ctx.entityTitle}".\n\n${ctx.entityDescription}` },
      { title: 'Matriz de Riesgos', build: () => '| ID | Riesgo | Probabilidad | Impacto | Nivel | Mitigacion |\n|----|--------|-------------|---------|-------|------------|\n| R1 | Retrasos en desarrollo | Media | Alto | Alto | Buffer de sprint + seguimiento diario |\n| R2 | Dependencias externas no disponibles | Baja | Critico | Alto | Mock services + contratos API |\n| R3 | Cambios de alcance | Media | Medio | Medio | Change control board |\n| R4 | Baja cobertura de pruebas | Baja | Alto | Medio | Metas de cobertura por sprint |\n| R5 | Problemas de rendimiento | Baja | Alto | Medio | Pruebas de carga tempranas |' },
      { title: 'Analisis Detallado', build: (ctx) => `Dependencias externas: ${field(ctx, 'thirdPartyDependencies', 'Ninguna')}\nImpacto en Sabre: ${field(ctx, 'impactSabreLevel', 'No evaluado')}\nMejoras tecnologicas: ${field(ctx, 'technologicalImprovements', 'Pendiente')}` },
      { title: 'Plan de Mitigacion', build: (ctx) => `Prioridad de negocio: ${field(ctx, 'businessPriority', 'No definida')}\nCanales impactados: ${field(ctx, 'impactedChannels', 'Por determinar')}\nEquipos involucrados: ${field(ctx, 'teamsInvolved', 'Por definir')}` },
      { title: 'Plan de Contingencia', build: () => '1. Establecer checkpoints semanales de revision de riesgos\n2. Mantener plan de rollback actualizado\n3. Asegurar disponibilidad de equipo de soporte\n4. Documentar lecciones aprendidas' },
    ],
  },

  // ── Initiative-specific templates ───────────────────────────────────────

  'initiative-summary': {
    name: 'Resumen de Iniciativa',
    keywords: ['resumen', 'summary', 'resumen ejecutivo'],
    entityTypes: ['initiative'],
    sectionDefs: [
      { title: 'Resumen Ejecutivo', build: (ctx) => `"${ctx.entityTitle}" (${ctx.entityLabel}) es una iniciativa estrategica orientada a generar valor de negocio.\n\n${ctx.entityDescription}` },
      { title: 'Epicas Asociadas', build: (ctx) => ctx.items.length > 0 ? `Esta iniciativa se compone de las siguientes epicas:\n\n${itemList(ctx)}` : 'No hay epicas asociadas a esta iniciativa.' },
      { title: 'Beneficios Proyectados', build: (ctx) => `**Cualitativos:**\n${field(ctx, 'qualitativeBenefits', 'Pendiente de definir.')}\n\n**Cuantitativos:**\n${field(ctx, 'quantitativeBenefits', 'Pendiente de cuantificar.')}\n\n**Medicion:**\n${field(ctx, 'benefitsMeasurement', 'Pendiente de definir metricas.')}` },
      { title: 'Cronograma', build: (ctx) => `Inicio: ${field(ctx, 'startDate', 'Por definir')}\nFecha objetivo: ${field(ctx, 'targetDate', 'Por definir')}\nDuracion estimada: ${field(ctx, 'estimatedDuration', 'Por determinar')}` },
      { title: 'Equipos', build: (ctx) => `Equipos involucrados: ${field(ctx, 'teamsInvolved', 'Por definir')}\nResponsable: ${field(ctx, 'owner', 'Por asignar')}\nSponsor: ${field(ctx, 'sponsor', 'Por asignar')}` },
    ],
  },

  'investment-analysis': {
    name: 'Analisis de Inversion',
    keywords: ['inversion', 'investment', 'retorno', 'roi', 'costo'],
    entityTypes: ['initiative'],
    sectionDefs: [
      { title: 'Resumen', build: (ctx) => `Analisis de inversion para la iniciativa "${ctx.entityTitle}" (${ctx.entityLabel}).\n\n${ctx.entityDescription}` },
      { title: 'Costos Estimados', build: (ctx) => `Equipos requeridos: ${field(ctx, 'teamsInvolved', 'Por definir')}\nDuracion estimada: ${field(ctx, 'estimatedDuration', 'Por determinar')}\nEpicas asociadas: ${ctx.items.length}\n\nDesglose de costos:\n- Desarrollo: Pendiente de estimacion\n- Infraestructura: Pendiente de estimacion\n- Licencias/terceros: ${field(ctx, 'thirdPartyDependencies', 'Ninguna identificada')}` },
      { title: 'Retorno Esperado', build: (ctx) => `**Beneficios cuantitativos:**\n${field(ctx, 'quantitativeBenefits', 'Pendiente de cuantificar.')}\n\n**Metricas de medicion:**\n${field(ctx, 'benefitsMeasurement', 'Pendiente de definir.')}` },
      { title: 'Riesgos Financieros', build: () => '| Riesgo | Probabilidad | Impacto Financiero | Mitigacion |\n|--------|-------------|-------------------|------------|\n| Sobrecostos | Media | Alto | Estimaciones conservadoras + buffer 20% |\n| Retrasos | Media | Medio | Entregas incrementales por epica |\n| Cambios de alcance | Alta | Alto | Change control board + priorizado |\n| Dependencias externas | Baja | Medio | Contratos y SLAs definidos |' },
      { title: 'Recomendaciones', build: (ctx) => `Prioridad de negocio: ${field(ctx, 'businessPriority', 'No definida')}\n\nRecomendaciones:\n1. Validar estimaciones con equipos tecnicos\n2. Establecer metricas de seguimiento financiero\n3. Revisar ROI trimestralmente\n4. Mantener alineamiento con objetivos estrategicos` },
    ],
  },

  'roadmap-doc': {
    name: 'Documento de Roadmap',
    keywords: ['roadmap', 'hoja de ruta', 'fases', 'hitos', 'milestones'],
    entityTypes: ['initiative'],
    sectionDefs: [
      { title: 'Vision', build: (ctx) => `Roadmap para la iniciativa "${ctx.entityTitle}" (${ctx.entityLabel}).\n\n${ctx.entityDescription}` },
      { title: 'Fases', build: (ctx) => ctx.items.length > 0 ? `Fases derivadas de las epicas asociadas:\n\n${ctx.items.map((s, i) => `### Fase ${i + 1}: ${s}\n- Inicio estimado: Por definir\n- Duracion estimada: Por definir\n- Entregables: Por detallar`).join('\n\n')}` : 'Las fases se definiran una vez que se asocien epicas a esta iniciativa.' },
      { title: 'Hitos', build: (ctx) => `Hitos clave:\n\n1. Kickoff de la iniciativa: ${field(ctx, 'startDate', 'Por definir')}\n2. Completar primera epica: Por definir\n3. Revision de medio camino: Por definir\n4. Entrega final: ${field(ctx, 'targetDate', 'Por definir')}\n5. Cierre y retrospectiva: Por definir` },
      { title: 'Dependencias', build: (ctx) => `Dependencias externas: ${field(ctx, 'thirdPartyDependencies', 'Ninguna identificada')}\nEquipos involucrados: ${field(ctx, 'teamsInvolved', 'Por definir')}\n\nDependencias entre epicas:\n- Por mapear durante la fase de planificacion detallada` },
      { title: 'Criterios de Exito', build: (ctx) => `**Medicion de beneficios:**\n${field(ctx, 'benefitsMeasurement', 'Pendiente de definir.')}\n\n**Criterios de aceptacion de la iniciativa:**\n- Todas las epicas completadas y validadas\n- Metricas de beneficio alcanzadas\n- Sign-off de stakeholders\n- Documentacion completa` },
    ],
  },

  'stakeholder-report': {
    name: 'Reporte para Stakeholders',
    keywords: ['stakeholder', 'stakeholders', 'avance', 'progreso'],
    entityTypes: ['initiative'],
    sectionDefs: [
      { title: 'Estado General', build: (ctx) => `Reporte de avance para la iniciativa "${ctx.entityTitle}" (${ctx.entityLabel}).\n\nPrioridad: ${field(ctx, 'businessPriority', 'No definida')}\nFecha de inicio: ${field(ctx, 'startDate', 'Por definir')}\nFecha objetivo: ${field(ctx, 'targetDate', 'Por definir')}` },
      { title: 'Avance', build: (ctx) => `Epicas asociadas: ${ctx.items.length}\nDocumentos generados: ${ctx.existingDocs.length}\n\n${ctx.items.length > 0 ? `Detalle de epicas:\n${ctx.items.map((s, i) => `${i + 1}. ${s} - Estado: Por actualizar`).join('\n')}` : 'No hay epicas asociadas aun.'}` },
      { title: 'Metricas Clave', build: (ctx) => `**Beneficios esperados:**\n${field(ctx, 'quantitativeBenefits', 'Pendiente de cuantificar.')}\n\n**Medicion:**\n${field(ctx, 'benefitsMeasurement', 'Pendiente de definir metricas.')}\n\n**KPIs:**\n- Porcentaje de avance: Por calcular\n- Epicas completadas: 0 de ${ctx.items.length}\n- Adherencia al cronograma: Por evaluar` },
      { title: 'Proximos Pasos', build: () => '1. Continuar ejecucion segun roadmap\n2. Revisar dependencias y bloqueos\n3. Actualizar estimaciones si es necesario\n4. Preparar siguiente revision con stakeholders' },
      { title: 'Riesgos', build: (ctx) => `Dependencias externas: ${field(ctx, 'thirdPartyDependencies', 'Ninguna')}\nCanales impactados: ${field(ctx, 'impactedChannels', 'Por determinar')}\n\nAcciones de mitigacion:\n- Monitoreo continuo de dependencias\n- Escalamiento temprano de bloqueos\n- Comunicacion proactiva con equipos` },
    ],
  },
};

// ─── Template Matching ───────────────────────────────────────────────────────

function matchTemplate(message: string, context: CopilotContext): DocTemplateKey {
  const lower = message.toLowerCase();
  const entityType = context.entityType;

  // First pass: try entity-specific templates (prioritize templates scoped to the current entity type)
  for (const [key, template] of Object.entries(TEMPLATES)) {
    if (template.entityTypes && template.entityTypes.includes(entityType)) {
      if (template.keywords.some((kw) => lower.includes(kw))) {
        return key as DocTemplateKey;
      }
    }
  }

  // Second pass: try general templates (those without entityTypes restriction)
  for (const [key, template] of Object.entries(TEMPLATES)) {
    if (!template.entityTypes) {
      if (template.keywords.some((kw) => lower.includes(kw))) {
        return key as DocTemplateKey;
      }
    }
  }

  // Default based on entity type
  if (entityType === 'initiative') return 'initiative-summary';
  return 'technical-spec';
}

// ─── Content Builders ────────────────────────────────────────────────────────

function buildSections(templateKey: DocTemplateKey, context: CopilotContext): EpicDocumentSection[] {
  const template = TEMPLATES[templateKey];
  return template.sectionDefs.map((def, i) => ({
    id: `sec-${crypto.randomUUID()}-${i}`,
    title: def.title,
    content: def.build(context),
  }));
}

function buildDocPreview(
  templateKey: DocTemplateKey,
  context: CopilotContext,
  format: DocFormat,
): CopilotDocPreview {
  return {
    id: `doc-${crypto.randomUUID()}`,
    name: TEMPLATES[templateKey].name,
    sections: buildSections(templateKey, context),
    format,
    status: 'preview',
  };
}

function buildAnswerContent(message: string, context: CopilotContext): string {
  const lower = message.toLowerCase();
  const noun = entityNoun(context);
  const items = itemNoun(context);

  if (lower.includes('historia') || lower.includes('stories') || lower.includes('epica') || lower.includes('elementos')) {
    if (context.items.length === 0) {
      return `Esta ${noun} aun no tiene ${items} asociadas.`;
    }
    return (
      `La ${noun} "${context.entityTitle}" tiene ${context.items.length} ${items}:\n\n` +
      itemList(context) +
      `\n\nPuedo generar documentacion basada en estos elementos si lo necesitas.`
    );
  }

  if (lower.includes('alcance') || lower.includes('scope')) {
    const scope = context.fields.scopeDescription;
    if (!scope) {
      return `La ${noun} "${context.entityTitle}" aun no tiene un alcance definido.`;
    }
    return `Alcance de "${context.entityTitle}":\n\n${scope}`;
  }

  return (
    `Sobre la ${noun} "${context.entityTitle}":\n\n` +
    `${context.entityDescription}\n\n` +
    `**Estado actual:**\n` +
    `- ${context.items.length} ${items}\n` +
    `- ${context.existingDocs.length} documento(s) existente(s)\n` +
    `- ${context.diagramTypes.length} diagrama(s)\n\n` +
    'Si necesitas mas detalle sobre algun aspecto en particular, puedo ayudarte.'
  );
}

function buildRefineResponse(
  message: string,
  context: CopilotContext,
  history: CopilotMessage[],
): CopilotMessage {
  const lastDocMessage = [...history]
    .reverse()
    .find((m) => m.role === 'assistant' && m.docPreview);

  if (!lastDocMessage?.docPreview) {
    return {
      id: `msg-${crypto.randomUUID()}`,
      role: 'assistant',
      content: 'No encontre un documento previo para refinar. Puedo generar uno nuevo si me indicas que tipo de documento necesitas.',
      timestamp: new Date().toISOString(),
    };
  }

  const prevDoc = lastDocMessage.docPreview;
  const lower = message.toLowerCase();

  let refinedSections = prevDoc.sections.map((s) => ({ ...s }));

  if (lower.includes('mas detalle') || lower.includes('expande')) {
    refinedSections = refinedSections.map((s) => ({
      ...s,
      content: s.content + `\n\n[Contenido ampliado con mayor nivel de detalle basado en el contexto de "${context.entityTitle}" y las mejores practicas de la industria.]`,
    }));
  } else if (lower.includes('reduce') || lower.includes('simplifica')) {
    refinedSections = refinedSections.map((s) => ({
      ...s,
      content: s.content.split('\n').slice(0, 3).join('\n'),
    }));
  }

  const format = detectFormat(message) || prevDoc.format;

  return {
    id: `msg-${crypto.randomUUID()}`,
    role: 'assistant',
    content: `He refinado el documento "${prevDoc.name}" segun tu solicitud. Revisa el contenido y decide si deseas guardarlo.`,
    timestamp: new Date().toISOString(),
    docPreview: {
      id: `doc-${crypto.randomUUID()}`,
      name: `${prevDoc.name} (refinado)`,
      sections: refinedSections,
      format,
      status: 'preview',
    },
  };
}

// ─── Delay Simulation ────────────────────────────────────────────────────────

function simulateDelay(): Promise<void> {
  const ms = 1500 + Math.random() * 1500;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main Agent Function ─────────────────────────────────────────────────────

export async function sendCopilotMessage(
  userMessage: string,
  context: CopilotContext,
  history: CopilotMessage[],
): Promise<CopilotMessage> {
  await simulateDelay();

  const intent = detectIntent(userMessage, history);
  const format = detectFormat(userMessage);

  switch (intent) {
    case 'generate': {
      const templateKey = matchTemplate(userMessage, context);
      const docPreview = buildDocPreview(templateKey, context, format);

      return {
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: `He generado "${docPreview.name}". Revisa el contenido y decide si deseas guardarlo.`,
        timestamp: new Date().toISOString(),
        docPreview,
      };
    }

    case 'refine': {
      return buildRefineResponse(userMessage, context, history);
    }

    case 'answer':
    default: {
      return {
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: buildAnswerContent(userMessage, context),
        timestamp: new Date().toISOString(),
      };
    }
  }
}
