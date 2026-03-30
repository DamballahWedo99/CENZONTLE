/**
 * Mock AI Document Generation Agent
 *
 * In production this would call an LLM API with context from the epic definition
 * to generate structured documents (technical specs, release notes, test plans, etc.).
 * For now we simulate the agent by parsing the epic fields and generating realistic
 * document sections from templates.
 */

import { Epic, EpicDocument, EpicDocumentSection } from '@cenzontle/shared';

export type DocType = 'technical-spec' | 'release-notes' | 'test-plan' | 'user-guide' | 'business-case';

const docTemplates: Record<DocType, { name: string; sections: (epic: Epic) => EpicDocumentSection[] }> = {
  'technical-spec': {
    name: 'Especificación Técnica',
    sections: (epic) => [
      { id: 's1', title: 'Resumen Ejecutivo', content: `Este documento describe la especificación técnica para "${epic.title}".\n\n${epic.description}` },
      { id: 's2', title: 'Alcance del Proyecto', content: epic.scopeDescription || 'Pendiente de definir.' },
      { id: 's3', title: 'Mejoras Tecnológicas', content: epic.technologicalImprovements || 'Pendiente de definir.' },
      { id: 's4', title: 'Criterios de Aceptación', content: epic.acceptanceCriteria || 'Pendiente de definir.' },
      { id: 's5', title: 'Dependencias de Terceros', content: epic.thirdPartyDependencies || 'Sin dependencias externas identificadas.' },
      { id: 's6', title: 'Equipos Involucrados', content: epic.teamsInvolved || 'Pendiente de definir.' },
      { id: 's7', title: 'Impacto en Sabre', content: epic.impactSabreLevel || 'Sin impacto identificado.' },
      { id: 's8', title: 'Cronograma', content: `Fecha de inicio: ${epic.startDate}\nFecha objetivo: ${epic.targetDate}` },
    ],
  },
  'release-notes': {
    name: 'Notas de Release',
    sections: (epic) => [
      { id: 's1', title: 'Release', content: `# ${epic.title}\n\nVersión: 1.0\nFecha: ${epic.targetDate}${epic.tracker?.externalKey ? `\nTracker: ${epic.tracker.externalKey}` : ''}` },
      { id: 's2', title: 'Descripción del Cambio', content: epic.description },
      { id: 's3', title: 'Beneficios', content: `**Cualitativos:**\n${epic.qualitativeBenefits || 'N/A'}\n\n**Cuantitativos:**\n${epic.quantitativeBenefits || 'N/A'}` },
      { id: 's4', title: 'Canales Impactados', content: epic.impactedChannels || 'Todos los canales.' },
      { id: 's5', title: 'Flujos Impactados', content: epic.impactedFlows || 'Sin flujos impactados.' },
      { id: 's6', title: 'Notas de Despliegue', content: 'Se requiere validación en ambiente de staging antes de producción.\nRollback plan disponible.' },
    ],
  },
  'test-plan': {
    name: 'Plan de Pruebas',
    sections: (epic) => [
      { id: 's1', title: 'Objetivo', content: `Plan de pruebas para validar la correcta implementación de "${epic.title}".` },
      { id: 's2', title: 'Alcance de Pruebas', content: epic.scopeDescription || 'Cobertura completa del alcance definido.' },
      { id: 's3', title: 'Criterios de Aceptación', content: epic.acceptanceCriteria || 'Según definición de la épica.' },
      { id: 's4', title: 'Tipos de Pruebas', content: '- Pruebas unitarias\n- Pruebas de integración\n- Pruebas E2E\n- Pruebas de rendimiento\n- Pruebas de seguridad' },
      { id: 's5', title: 'Ambientes de Prueba', content: '- Desarrollo (DEV)\n- QA\n- Staging\n- Pre-producción' },
      { id: 's6', title: 'Criterios de Salida', content: '- Cobertura de código > 80%\n- 0 bugs críticos abiertos\n- Todas las pruebas de regresión pasando\n- Aprobación del QA Lead' },
      { id: 's7', title: 'Riesgos y Mitigaciones', content: `Dependencias: ${epic.thirdPartyDependencies || 'Ninguna'}\nImpacto: ${epic.impactSabreLevel || 'Bajo'}` },
    ],
  },
  'user-guide': {
    name: 'Guía de Usuario',
    sections: (epic) => [
      { id: 's1', title: 'Introducción', content: `Esta guía describe cómo utilizar las funcionalidades implementadas en "${epic.title}".` },
      { id: 's2', title: 'Descripción General', content: epic.description },
      { id: 's3', title: 'Beneficios para el Usuario', content: epic.qualitativeBenefits || 'Mejora general de la experiencia.' },
      { id: 's4', title: 'Flujos Principales', content: epic.impactedFlows || 'Consultar con el equipo de producto.' },
      { id: 's5', title: 'Canales Disponibles', content: epic.impactedChannels || 'Disponible en todos los canales.' },
      { id: 's6', title: 'Preguntas Frecuentes', content: '1. ¿Cuándo estará disponible?\nRespuesta: Según el cronograma del proyecto.\n\n2. ¿Necesito capacitación?\nRespuesta: Se proporcionará material de capacitación.' },
    ],
  },
  'business-case': {
    name: 'Caso de Negocio',
    sections: (epic) => [
      { id: 's1', title: 'Resumen Ejecutivo', content: `Caso de negocio para "${epic.title}".\n\n${epic.description}` },
      { id: 's2', title: 'Beneficios Cualitativos', content: epic.qualitativeBenefits || 'Pendiente de definir.' },
      { id: 's3', title: 'Beneficios Cuantitativos', content: epic.quantitativeBenefits || 'Pendiente de definir.' },
      { id: 's4', title: 'Medición de Beneficios', content: epic.benefitsMeasurement || 'Pendiente de definir métricas.' },
      { id: 's5', title: 'Prioridad de Negocio', content: epic.businessPriority || `Prioridad: ${epic.priority}` },
      { id: 's6', title: 'Inversión Requerida', content: `Equipos: ${epic.teamsInvolved || 'Por definir'}\nDuración: ${epic.startDate} — ${epic.targetDate}` },
      { id: 's7', title: 'Análisis de Riesgos', content: `Dependencias externas: ${epic.thirdPartyDependencies || 'Ninguna'}\nImpacto en sistemas: ${epic.impactSabreLevel || 'Bajo'}` },
    ],
  },
};

/** Simulates an AI agent generating a structured document from an epic's definition. */
export async function generateDocument(epic: Epic, docType: DocType): Promise<EpicDocument> {
  // Simulate AI thinking time (2-4s)
  await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 2000));

  const template = docTemplates[docType];
  const now = new Date().toISOString();
  const sections = template.sections(epic).map((s, i) => ({
    ...s,
    id: `sec-${Date.now()}-${i}`,
  }));

  return {
    id: `doc-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${template.name}${epic.tracker?.externalKey ? ` — ${epic.tracker.externalKey}` : ''}`,
    type: 'other' as const,
    url: '#',
    uploadedBy: 'Agente IA',
    uploadedAt: now,
    size: `${Math.round(sections.reduce((sum, s) => sum + s.content.length, 0) / 100)}KB`,
    sections,
    generatedBy: 'ai',
  };
}

export const docTypeLabelsMap: Record<DocType, string> = {
  'technical-spec': 'Especificación Técnica',
  'release-notes': 'Notas de Release',
  'test-plan': 'Plan de Pruebas',
  'user-guide': 'Guía de Usuario',
  'business-case': 'Caso de Negocio',
};
