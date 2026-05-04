/**
 * Configuración de tokens (adaptive thinking + max_tokens) por agente IA.
 * Singleton de organización. Editable por Alta Gerencia desde
 * `/factory/settings?section=agent-tokens`.
 *
 * Bounds aceptados por el backend:
 *  - effort ∈ 'low' | 'medium' | 'high' (Sonnet 4.6 / Opus 4.6+).
 *    'max' solo soportado en modelos Opus; no incluido por ahora.
 *  - max_tokens: [4096, 64000]
 */

/**
 * Niveles de "esfuerzo" del adaptive thinking de Anthropic.
 * Reemplaza el `budget_tokens` numérico del modo `thinking: enabled` legacy.
 *
 *  - 'low'    — chat, clasificación, tareas simples; razonamiento mínimo.
 *  - 'medium' — balance default cost/quality.
 *  - 'high'   — agentic work, tool-heavy. Default y recomendado.
 *
 * 'max' existe en la API pero solo en Opus 4.6+; agregar cuando se haga el
 * upgrade del modelo a Opus.
 */
export type AgentEffortLevel = 'low' | 'medium' | 'high';

export const AGENT_EFFORT_LEVELS: ReadonlyArray<AgentEffortLevel> = [
  'low',
  'medium',
  'high',
] as const;

export const AGENT_EFFORT_LABELS: Record<AgentEffortLevel, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
};

export const AGENT_EFFORT_DESCRIPTIONS: Record<AgentEffortLevel, string> = {
  low: 'Razonamiento mínimo. Para tareas simples y latencia crítica.',
  medium: 'Balance entre calidad y costo.',
  high: 'Razonamiento profundo. Recomendado para agentes con tools.',
};

export interface AgentTokenSettings {
  // Stories — Product Owner
  storyPoEffort: AgentEffortLevel;
  storyPoMaxTokens: number;
  storyPoThinkingEnabled: boolean;

  // Stories — Tech Lead
  storyTlEffort: AgentEffortLevel;
  storyTlMaxTokens: number;
  storyTlThinkingEnabled: boolean;

  // Stories — QA
  storyQaEffort: AgentEffortLevel;
  storyQaMaxTokens: number;
  storyQaThinkingEnabled: boolean;

  // Epics (max_tokens dinámico → este es el cap superior)
  epicEffort: AgentEffortLevel;
  epicMaxTokens: number;
  epicThinkingEnabled: boolean;

  // Diagrams (principal + integration doc comparten config)
  diagramEffort: AgentEffortLevel;
  diagramMaxTokens: number;
  diagramThinkingEnabled: boolean;

  updatedAt: string;
  updatedBy: string | null;
}

/** Defaults coincidentes con los `@default(...)` del schema Prisma. */
export const DEFAULT_AGENT_TOKEN_SETTINGS: Omit<AgentTokenSettings, 'updatedAt' | 'updatedBy'> = {
  storyPoEffort: 'high',
  storyPoMaxTokens: 28_000,
  storyPoThinkingEnabled: true,
  storyTlEffort: 'high',
  storyTlMaxTokens: 64_000,
  storyTlThinkingEnabled: true,
  storyQaEffort: 'high',
  storyQaMaxTokens: 64_000,
  storyQaThinkingEnabled: true,
  epicEffort: 'high',
  epicMaxTokens: 64_000,
  epicThinkingEnabled: true,
  diagramEffort: 'high',
  diagramMaxTokens: 64_000,
  diagramThinkingEnabled: true,
};

/** Bounds usados tanto en server (validation) como en client (input min/max). */
export const AGENT_TOKEN_BOUNDS = {
  maxTokens: { min: 4096, max: 64_000 },
} as const;

/** Identificador discriminator para iterar agentes en UI. */
export type AgentKey = 'storyPo' | 'storyTl' | 'storyQa' | 'epic' | 'diagram';

type EditableField = keyof Omit<AgentTokenSettings, 'updatedAt' | 'updatedBy'>;

export interface AgentDescriptor {
  key: AgentKey;
  effortField: EditableField;
  maxTokensField: EditableField;
  /** Toggle on/off del adaptive thinking. Cuando false, el agente NO emite
   *  `thinking: enabled` ni `output_config.effort` en la llamada a Anthropic. */
  enabledField: EditableField;
  label: string;
  description: string;
}

export const AGENT_DESCRIPTORS: ReadonlyArray<AgentDescriptor> = [
  {
    key: 'storyPo',
    effortField: 'storyPoEffort',
    maxTokensField: 'storyPoMaxTokens',
    enabledField: 'storyPoThinkingEnabled',
    label: 'Historias · Product Owner',
    description: 'Genera la sección de negocio (markdown PO) de cada historia.',
  },
  {
    key: 'storyTl',
    effortField: 'storyTlEffort',
    maxTokensField: 'storyTlMaxTokens',
    enabledField: 'storyTlThinkingEnabled',
    label: 'Historias · Tech Lead',
    description: 'Genera la sección técnica (arquitectura, integración, validaciones).',
  },
  {
    key: 'storyQa',
    effortField: 'storyQaEffort',
    maxTokensField: 'storyQaMaxTokens',
    enabledField: 'storyQaThinkingEnabled',
    label: 'Historias · QA',
    description: 'Genera la sección de QA (pruebas unitarias, happy path, edge cases).',
  },
  {
    key: 'epic',
    effortField: 'epicEffort',
    maxTokensField: 'epicMaxTokens',
    enabledField: 'epicThinkingEnabled',
    label: 'Épicas',
    description: 'Genera propuestas de épicas con investigación previa (vault, code, web search).',
  },
  {
    key: 'diagram',
    effortField: 'diagramEffort',
    maxTokensField: 'diagramMaxTokens',
    enabledField: 'diagramThinkingEnabled',
    label: 'Diagramas',
    description:
      'Genera diagramas y documentos de integración (agente principal + doc). Excluye el layout pass — es estructural y determinista, no usa thinking.',
  },
] as const;
