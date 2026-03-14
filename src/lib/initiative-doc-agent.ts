/**
 * Mock AI Document Generation Agent for Initiatives
 *
 * Generates structured documents from initiative context.
 * In production this would call an LLM API.
 */

import { Initiative, EpicDocument, EpicDocumentSection } from '@/types/proyectos';

export type InitiativeDocType =
  | 'initiative-summary'
  | 'investment-analysis'
  | 'roadmap-doc'
  | 'stakeholder-report'
  | 'risk-assessment'
  | 'scope-document';

export const initiativeDocTypeLabelsMap: Record<InitiativeDocType, string> = {
  'initiative-summary': 'Resumen Ejecutivo',
  'investment-analysis': 'Analisis de Inversion',
  'roadmap-doc': 'Documento de Roadmap',
  'stakeholder-report': 'Reporte para Stakeholders',
  'risk-assessment': 'Evaluacion de Riesgos',
  'scope-document': 'Documento de Alcance',
};

const docTemplates: Record<InitiativeDocType, {
  name: string;
  sections: (initiative: Initiative, epicTitles: string[]) => EpicDocumentSection[];
}> = {
  'initiative-summary': {
    name: 'Resumen Ejecutivo',
    sections: (ini, epics) => [
      { id: 's1', title: 'Resumen', content: `Resumen ejecutivo de la iniciativa "${ini.name}".\n\n${ini.description}` },
      { id: 's2', title: 'Objetivos Estrategicos', content: `Esta iniciativa busca generar valor de negocio a traves de ${epics.length} epicas de trabajo alineadas a los objetivos organizacionales.` },
      { id: 's3', title: 'Epicas Asociadas', content: epics.length > 0 ? `La iniciativa se compone de:\n\n${epics.map((e, i) => `${i + 1}. ${e}`).join('\n')}` : 'Sin epicas asociadas.' },
      { id: 's4', title: 'Cronograma', content: `Fecha de inicio: ${ini.startDate}\nFecha objetivo: ${ini.targetDate}\nResponsable: ${ini.owner}` },
      { id: 's5', title: 'Estado Actual', content: `Estado: ${ini.status}\nEpicas totales: ${epics.length}` },
    ],
  },
  'investment-analysis': {
    name: 'Analisis de Inversion',
    sections: (ini, epics) => [
      { id: 's1', title: 'Resumen', content: `Analisis de inversion para la iniciativa "${ini.name}".\n\n${ini.description}` },
      { id: 's2', title: 'Alcance de la Inversion', content: `Epicas involucradas: ${epics.length}\nResponsable: ${ini.owner}\nDuracion estimada: ${ini.startDate} a ${ini.targetDate}` },
      { id: 's3', title: 'Desglose de Costos', content: `Costos estimados por area:\n- Desarrollo: Pendiente de estimacion\n- Infraestructura: Pendiente de estimacion\n- Licencias/terceros: Pendiente de estimacion\n- QA y testing: Pendiente de estimacion` },
      { id: 's4', title: 'Retorno Esperado', content: 'El retorno de inversion se evaluara en funcion de las metricas definidas por cada epica y los beneficios cuantitativos asociados.' },
      { id: 's5', title: 'Riesgos Financieros', content: '- Sobre-costo por cambios de alcance\n- Retrasos en entrega que impacten el ROI\n- Dependencias externas no presupuestadas' },
    ],
  },
  'roadmap-doc': {
    name: 'Documento de Roadmap',
    sections: (ini, epics) => [
      { id: 's1', title: 'Vision', content: `Roadmap para la iniciativa "${ini.name}".\n\n${ini.description}` },
      { id: 's2', title: 'Fases de Implementacion', content: epics.length > 0 ? epics.map((e, i) => `### Fase ${i + 1}: ${e}\n- Inicio estimado: Por definir\n- Duracion estimada: Por definir\n- Entregables: Por detallar`).join('\n\n') : 'Las fases se definiran cuando se asocien epicas.' },
      { id: 's3', title: 'Hitos Clave', content: `- Inicio del proyecto: ${ini.startDate}\n- Revision intermedia: Por definir\n- Entrega final: ${ini.targetDate}` },
      { id: 's4', title: 'Dependencias entre Fases', content: 'Las dependencias entre fases se detallaran conforme avance la planificacion de cada epica.' },
      { id: 's5', title: 'Gobernanza', content: `Responsable: ${ini.owner}\nRevisiones: Quincenales\nEscalacion: Comite directivo` },
    ],
  },
  'stakeholder-report': {
    name: 'Reporte para Stakeholders',
    sections: (ini, epics) => [
      { id: 's1', title: 'Estado General', content: `Reporte de avance para la iniciativa "${ini.name}".\n\nEstado: ${ini.status}\nResponsable: ${ini.owner}\nInicio: ${ini.startDate}\nObjetivo: ${ini.targetDate}` },
      { id: 's2', title: 'Avance por Epica', content: epics.length > 0 ? epics.map((e, i) => `${i + 1}. ${e} — Estado: Por actualizar`).join('\n') : 'Sin epicas asociadas.' },
      { id: 's3', title: 'Logros del Periodo', content: '- Pendiente de documentar logros recientes.' },
      { id: 's4', title: 'Riesgos y Bloqueos', content: '- Pendiente de documentar riesgos activos.' },
      { id: 's5', title: 'Proximos Pasos', content: '- Pendiente de definir acciones inmediatas.' },
    ],
  },
  'risk-assessment': {
    name: 'Evaluacion de Riesgos',
    sections: (ini, epics) => [
      { id: 's1', title: 'Contexto', content: `Evaluacion de riesgos para "${ini.name}".\n\n${ini.description}` },
      { id: 's2', title: 'Riesgos Tecnicos', content: '- Complejidad de integracion entre sistemas\n- Deuda tecnica acumulada\n- Dependencias de proveedores externos' },
      { id: 's3', title: 'Riesgos de Negocio', content: '- Cambios en prioridades estrategicas\n- Presupuesto insuficiente\n- Falta de alineacion entre stakeholders' },
      { id: 's4', title: 'Riesgos Operativos', content: '- Rotacion de personal clave\n- Retrasos en aprobaciones\n- Dependencias entre equipos' },
      { id: 's5', title: 'Plan de Mitigacion', content: `Se requiere monitoreo continuo de ${epics.length} epicas.\n\nAcciones:\n1. Revisiones de riesgo quincenales\n2. Escalacion temprana al comite\n3. Buffer de contingencia del 15%` },
    ],
  },
  'scope-document': {
    name: 'Documento de Alcance',
    sections: (ini, epics) => [
      { id: 's1', title: 'Descripcion del Alcance', content: `"${ini.name}"\n\n${ini.description}` },
      { id: 's2', title: 'Dentro del Alcance', content: epics.length > 0 ? `Las siguientes epicas estan dentro del alcance:\n\n${epics.map((e, i) => `${i + 1}. ${e}`).join('\n')}` : 'Pendiente de definir epicas.' },
      { id: 's3', title: 'Fuera del Alcance', content: 'Los siguientes elementos NO estan dentro del alcance de esta iniciativa:\n\n- Pendiente de documentar exclusiones.' },
      { id: 's4', title: 'Supuestos', content: '- El presupuesto esta aprobado\n- Los equipos estan asignados\n- Las dependencias externas estan comprometidas' },
      { id: 's5', title: 'Restricciones', content: `Fecha limite: ${ini.targetDate}\nResponsable: ${ini.owner}` },
    ],
  },
};

export async function generateInitiativeDocument(
  initiative: Initiative,
  epicTitles: string[],
  docType: InitiativeDocType,
): Promise<EpicDocument> {
  await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 2000));

  const template = docTemplates[docType];
  const now = new Date().toISOString();
  const sections = template.sections(initiative, epicTitles).map((s, i) => ({
    ...s,
    id: `sec-${Date.now()}-${i}`,
  }));

  return {
    id: `doc-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${template.name} — ${initiative.name}`,
    type: 'other' as const,
    url: '#',
    uploadedBy: 'Agente IA',
    uploadedAt: now,
    size: `${Math.round(sections.reduce((sum, s) => sum + s.content.length, 0) / 100)}KB`,
    sections,
    generatedBy: 'ai',
  };
}
