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

/**
 * Modelos seleccionables para los agentes de Proyectos (PO/TL/QA/épicas/
 * diagramas/asistente). DISTINTO de FORGE_WORKER_MODELS: estos agentes corren
 * vía el SDK con `thinking: {type:'adaptive'}` + `output_config.effort`, así
 * que SOLO se permiten modelos que soportan ambos. Haiku queda fuera a
 * propósito (no soporta adaptive thinking → 400 en cada turno).
 *
 * Fuente de verdad de la whitelist server-side. El catálogo rico (pricing,
 * descripciones, verificación en vivo) vive en apps/api y la deriva de aquí.
 */
export const PROJECT_AGENT_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
] as const;
export type ProjectAgentModel = typeof PROJECT_AGENT_MODELS[number];

export const PROJECT_AGENT_MODEL_LABELS: Record<ProjectAgentModel, string> = {
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
};

/** Modelo por defecto de los agentes de Proyectos (calibrado con Sonnet 4.6). */
export const DEFAULT_PROJECT_AGENT_MODEL: ProjectAgentModel = 'claude-sonnet-4-6';

/**
 * Modelos válidos para el Forge Worker (coder agent que corre Claude Code CLI).
 * Distinto del set para los agentes story-gen porque el CLI maneja el rango
 * completo de modelos production-grade.
 *
 * Cuando se agreguen nuevos modelos (Haiku 4.6, etc.), agregar al array y
 * el DTO + UI se actualizan automáticamente.
 */
export const FORGE_WORKER_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const;
export type ForgeWorkerModel = typeof FORGE_WORKER_MODELS[number];

export const FORGE_WORKER_MODEL_LABELS: Record<ForgeWorkerModel, string> = {
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-7': 'Claude Opus 4.7',
};

/**
 * Pricing público de Anthropic (USD por 1M tokens). Para mostrar al user
 * en la UI como hint de cost relativo entre modelos. Si Anthropic actualiza
 * precios, este es el único punto de update.
 */
export const FORGE_WORKER_MODEL_PRICING: Record<ForgeWorkerModel, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-7': { input: 15, output: 75 },
};

/**
 * Effort levels que soporta el CLI `claude` via `--effort`. Más granular que
 * el `AgentEffortLevel` de los agentes story-gen porque el CLI permite
 * `xhigh` y `max` para extended thinking más generoso.
 *  - 'low'    — sin thinking, latency mínima.
 *  - 'medium' — thinking moderado, default histórico del CLI.
 *  - 'high'   — extended thinking activo (recomendado para coding).
 *  - 'xhigh'  — thinking budget más generoso.
 *  - 'max'    — thinking budget máximo (solo en Opus 4.6+).
 */
export const FORGE_WORKER_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ForgeWorkerEffortLevel = typeof FORGE_WORKER_EFFORT_LEVELS[number];

export const FORGE_WORKER_EFFORT_LABELS: Record<ForgeWorkerEffortLevel, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'X-Alto',
  max: 'Máximo',
};

export const FORGE_WORKER_EFFORT_DESCRIPTIONS: Record<ForgeWorkerEffortLevel, string> = {
  low: 'Sin extended thinking. Latencia mínima. Para tasks triviales.',
  medium: 'Thinking moderado. Balance entre quality y latencia.',
  high: 'Extended thinking activo. Recomendado para coding production.',
  xhigh: 'Thinking budget más generoso. Tasks complejas.',
  max: 'Thinking budget máximo. Solo Opus 4.6+. Tasks que requieren razonamiento profundo.',
};

export interface AgentTokenSettings {
  // Stories — Product Owner
  storyPoModel: ProjectAgentModel;
  storyPoEffort: AgentEffortLevel;
  storyPoMaxTokens: number;
  storyPoThinkingEnabled: boolean;

  // Stories — Tech Lead
  storyTlModel: ProjectAgentModel;
  storyTlEffort: AgentEffortLevel;
  storyTlMaxTokens: number;
  storyTlThinkingEnabled: boolean;

  // Stories — QA
  storyQaModel: ProjectAgentModel;
  storyQaEffort: AgentEffortLevel;
  storyQaMaxTokens: number;
  storyQaThinkingEnabled: boolean;

  // Epics (max_tokens dinámico → este es el cap superior)
  epicModel: ProjectAgentModel;
  epicEffort: AgentEffortLevel;
  epicMaxTokens: number;
  epicThinkingEnabled: boolean;

  // Diagrams (principal + integration doc comparten config)
  diagramModel: ProjectAgentModel;
  diagramEffort: AgentEffortLevel;
  diagramMaxTokens: number;
  diagramThinkingEnabled: boolean;

  // Assistant — chatbot lateral de edición de iniciativas/épicas/historias
  assistantModel: ProjectAgentModel;
  assistantEffort: AgentEffortLevel;
  assistantMaxTokens: number;
  assistantThinkingEnabled: boolean;

  // Forge Worker — coder agent (Claude Code CLI)
  forgeWorkerModel: ForgeWorkerModel;
  forgeWorkerEffort: ForgeWorkerEffortLevel;

  /**
   * Max wall-clock duration (ms) que el worker espera al CLI antes de
   * matar el proceso. Default 1800000 (30 min). Stories grandes con
   * muchos componentes UI o suites de tests pueden necesitar 3600000-
   * 5400000 (60-90 min). Min 300000 (5 min), max 7200000 (2h).
   */
  forgeWorkerMaxRunDurationMs: number;

  // DoD Verifier — reviewer agent (Claude Code CLI, --output-format json)
  // Reusa el mismo set de modelos + effort levels que el Forge Worker
  // porque ambos invocan el CLI con los mismos parámetros válidos.
  dodVerifierModel: ForgeWorkerModel;
  dodVerifierEffort: ForgeWorkerEffortLevel;

  // DoD retry loop — máximo de intentos del enforcement loop del worker.
  // 1 = una sola pasada (verificador no-bloqueante). >1 activa reintentos.
  dodMaxAttempts: number;

  updatedAt: string;
  updatedBy: string | null;
}

/** Defaults coincidentes con los `@default(...)` del schema Prisma. */
export const DEFAULT_AGENT_TOKEN_SETTINGS: Omit<AgentTokenSettings, 'updatedAt' | 'updatedBy'> = {
  storyPoModel: DEFAULT_PROJECT_AGENT_MODEL,
  storyPoEffort: 'medium',
  storyPoMaxTokens: 28_000,
  storyPoThinkingEnabled: true,
  storyTlModel: DEFAULT_PROJECT_AGENT_MODEL,
  storyTlEffort: 'medium',
  storyTlMaxTokens: 64_000,
  storyTlThinkingEnabled: true,
  storyQaModel: DEFAULT_PROJECT_AGENT_MODEL,
  storyQaEffort: 'medium',
  storyQaMaxTokens: 64_000,
  storyQaThinkingEnabled: true,
  epicModel: DEFAULT_PROJECT_AGENT_MODEL,
  epicEffort: 'medium',
  epicMaxTokens: 64_000,
  epicThinkingEnabled: true,
  diagramModel: DEFAULT_PROJECT_AGENT_MODEL,
  diagramEffort: 'medium',
  diagramMaxTokens: 64_000,
  diagramThinkingEnabled: true,
  assistantModel: DEFAULT_PROJECT_AGENT_MODEL,
  assistantEffort: 'medium',
  assistantMaxTokens: 32_000,
  assistantThinkingEnabled: true,
  forgeWorkerModel: 'claude-sonnet-4-6',
  forgeWorkerEffort: 'high',
  forgeWorkerMaxRunDurationMs: 1_800_000, // 30 min — default conservador
  dodVerifierModel: 'claude-haiku-4-5-20251001',
  dodVerifierEffort: 'low',
  dodMaxAttempts: 1,
};

/** Bounds usados tanto en server (validation) como en client (input min/max). */
export const AGENT_TOKEN_BOUNDS = {
  maxTokens: { min: 4096, max: 64_000 },
  forgeWorkerMaxRunDurationMs: {
    min: 300_000, // 5 min — runs más cortos suelen indicar config rota
    max: 7_200_000, // 2 h — más allá indica que la story es demasiado grande
  },
} as const;

/** Identificador discriminator para iterar agentes en UI. */
export type AgentKey = 'storyPo' | 'storyTl' | 'storyQa' | 'epic' | 'diagram' | 'assistant';

type EditableField = keyof Omit<AgentTokenSettings, 'updatedAt' | 'updatedBy'>;

export interface AgentDescriptor {
  key: AgentKey;
  /** Selector de modelo Claude del agente (whitelist PROJECT_AGENT_MODELS). */
  modelField: EditableField;
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
    modelField: 'storyPoModel',
    effortField: 'storyPoEffort',
    maxTokensField: 'storyPoMaxTokens',
    enabledField: 'storyPoThinkingEnabled',
    label: 'Historias · Product Owner',
    description: 'Genera la sección de negocio (markdown PO) de cada historia.',
  },
  {
    key: 'storyTl',
    modelField: 'storyTlModel',
    effortField: 'storyTlEffort',
    maxTokensField: 'storyTlMaxTokens',
    enabledField: 'storyTlThinkingEnabled',
    label: 'Historias · Tech Lead',
    description: 'Genera la sección técnica (arquitectura, integración, validaciones).',
  },
  {
    key: 'storyQa',
    modelField: 'storyQaModel',
    effortField: 'storyQaEffort',
    maxTokensField: 'storyQaMaxTokens',
    enabledField: 'storyQaThinkingEnabled',
    label: 'Historias · QA',
    description: 'Genera la sección de QA (pruebas unitarias, happy path, edge cases).',
  },
  {
    key: 'epic',
    modelField: 'epicModel',
    effortField: 'epicEffort',
    maxTokensField: 'epicMaxTokens',
    enabledField: 'epicThinkingEnabled',
    label: 'Épicas',
    description: 'Genera propuestas de épicas con investigación previa (vault, code, web search).',
  },
  {
    key: 'diagram',
    modelField: 'diagramModel',
    effortField: 'diagramEffort',
    maxTokensField: 'diagramMaxTokens',
    enabledField: 'diagramThinkingEnabled',
    label: 'Diagramas',
    description:
      'Genera diagramas y documentos de integración (agente principal + doc). Excluye el layout pass — es estructural y determinista, no usa thinking.',
  },
  {
    key: 'assistant',
    modelField: 'assistantModel',
    effortField: 'assistantEffort',
    maxTokensField: 'assistantMaxTokens',
    enabledField: 'assistantThinkingEnabled',
    label: 'Asistente de edición',
    description:
      'Chatbot lateral que propone ediciones de iniciativas, épicas e historias con diff y apply human-in-the-loop.',
  },
] as const;
