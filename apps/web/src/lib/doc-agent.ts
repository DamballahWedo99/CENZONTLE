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

/**
 * Extrae una sección puntual del epic.markdown buscando un heading H2 específico.
 * Retorna el cuerpo de la sección o un fallback si el heading no existe.
 */
function getSection(md: string | undefined, heading: string, fallback: string): string {
  if (!md) return fallback;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^##\\s+${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`, 'm');
  const match = md.match(re);
  const body = match?.[1]?.trim();
  return body && body.length > 0 ? body : fallback;
}

const docTemplates: Record<DocType, { name: string; sections: (epic: Epic) => EpicDocumentSection[] }> = {
  'technical-spec': {
    name: 'Especificación Técnica',
    sections: (epic) => [
      { id: 's1', title: 'Resumen Ejecutivo', content: `Este documento describe la especificación técnica para "${epic.title}".\n\n${getSection(epic.markdown, 'Descripción', 'Sin descripción.')}` },
      { id: 's2', title: 'Alcance del Proyecto', content: getSection(epic.markdown, 'Alcance', 'Pendiente de definir.') },
      { id: 's3', title: 'Mejoras Tecnológicas', content: getSection(epic.markdown, 'Mejoras tecnológicas', 'Pendiente de definir.') },
      { id: 's4', title: 'Criterios de Aceptación', content: getSection(epic.markdown, 'Criterios de aceptación', 'Pendiente de definir.') },
      { id: 's5', title: 'Dependencias de Terceros', content: getSection(epic.markdown, 'Dependencias de terceros', 'Sin dependencias externas identificadas.') },
      { id: 's6', title: 'Canales y Flujos Impactados', content: getSection(epic.markdown, 'Canales y flujos impactados', 'Sin impacto identificado.') },
      { id: 's7', title: 'Cronograma', content: `Fecha de inicio: ${epic.startDate}\nFecha objetivo: ${epic.targetDate}` },
    ],
  },
  'release-notes': {
    name: 'Notas de Release',
    sections: (epic) => [
      { id: 's1', title: 'Release', content: `# ${epic.title}\n\nVersión: 1.0\nFecha: ${epic.targetDate}${epic.tracker?.externalKey ? `\nTracker: ${epic.tracker.externalKey}` : ''}` },
      { id: 's2', title: 'Descripción del Cambio', content: getSection(epic.markdown, 'Descripción', 'Sin descripción.') },
      { id: 's3', title: 'Beneficios', content: `**Cualitativos:**\n${getSection(epic.markdown, 'Beneficios cualitativos', 'N/A')}\n\n**Cuantitativos:**\n${getSection(epic.markdown, 'Beneficios cuantitativos', 'N/A')}` },
      { id: 's4', title: 'Canales y Flujos Impactados', content: getSection(epic.markdown, 'Canales y flujos impactados', 'Todos los canales.') },
      { id: 's5', title: 'Notas de Despliegue', content: 'Se requiere validación en ambiente de staging antes de producción.\nRollback plan disponible.' },
    ],
  },
  'test-plan': {
    name: 'Plan de Pruebas',
    sections: (epic) => [
      { id: 's1', title: 'Objetivo', content: `Plan de pruebas para validar la correcta implementación de "${epic.title}".` },
      { id: 's2', title: 'Alcance de Pruebas', content: getSection(epic.markdown, 'Alcance', 'Cobertura completa del alcance definido.') },
      { id: 's3', title: 'Criterios de Aceptación', content: getSection(epic.markdown, 'Criterios de aceptación', 'Según definición de la épica.') },
      { id: 's4', title: 'Tipos de Pruebas', content: '- Pruebas unitarias\n- Pruebas de integración\n- Pruebas E2E\n- Pruebas de rendimiento\n- Pruebas de seguridad' },
      { id: 's5', title: 'Ambientes de Prueba', content: '- Desarrollo (DEV)\n- QA\n- Staging\n- Pre-producción' },
      { id: 's6', title: 'Criterios de Salida', content: '- Cobertura de código > 80%\n- 0 bugs críticos abiertos\n- Todas las pruebas de regresión pasando\n- Aprobación del QA Lead' },
      { id: 's7', title: 'Dependencias y Riesgos', content: getSection(epic.markdown, 'Dependencias de terceros', 'Sin dependencias externas identificadas.') },
    ],
  },
  'user-guide': {
    name: 'Guía de Usuario',
    sections: (epic) => [
      { id: 's1', title: 'Introducción', content: `Esta guía describe cómo utilizar las funcionalidades implementadas en "${epic.title}".` },
      { id: 's2', title: 'Descripción General', content: getSection(epic.markdown, 'Descripción', 'Sin descripción.') },
      { id: 's3', title: 'Beneficios para el Usuario', content: getSection(epic.markdown, 'Beneficios cualitativos', 'Mejora general de la experiencia.') },
      { id: 's4', title: 'Canales y Flujos', content: getSection(epic.markdown, 'Canales y flujos impactados', 'Disponible en todos los canales.') },
      { id: 's5', title: 'Preguntas Frecuentes', content: '1. ¿Cuándo estará disponible?\nRespuesta: Según el cronograma del proyecto.\n\n2. ¿Necesito capacitación?\nRespuesta: Se proporcionará material de capacitación.' },
    ],
  },
  'business-case': {
    name: 'Caso de Negocio',
    sections: (epic) => [
      { id: 's1', title: 'Resumen Ejecutivo', content: `Caso de negocio para "${epic.title}".\n\n${getSection(epic.markdown, 'Descripción', '')}` },
      { id: 's2', title: 'Beneficios Cualitativos', content: getSection(epic.markdown, 'Beneficios cualitativos', 'Pendiente de definir.') },
      { id: 's3', title: 'Beneficios Cuantitativos', content: getSection(epic.markdown, 'Beneficios cuantitativos', 'Pendiente de definir.') },
      { id: 's4', title: 'Medición de Beneficios', content: getSection(epic.markdown, 'Medición de beneficios', 'Pendiente de definir métricas.') },
      { id: 's5', title: 'Prioridad de Negocio', content: `Prioridad: ${epic.priority}` },
      { id: 's6', title: 'Cronograma', content: `Inicio: ${epic.startDate} — Objetivo: ${epic.targetDate}` },
      { id: 's7', title: 'Análisis de Riesgos', content: `Dependencias externas: ${getSection(epic.markdown, 'Dependencias de terceros', 'Ninguna')}` },
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
