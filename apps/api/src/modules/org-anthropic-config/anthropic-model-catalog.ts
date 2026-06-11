/**
 * Catálogo curado de modelos Claude para el selector de la organización.
 *
 * Fuente: referencia oficial de la API de Anthropic (cached 2026-05-26).
 * El pricing NO lo expone la Models API (`GET /v1/models`) — vive aquí y se
 * mergea con los datos en vivo. La lista en vivo es la fuente de verdad de
 * QUÉ modelos existen y sus capacidades; este catálogo aporta pricing,
 * descripciones en español y el flag de compatibilidad con los agentes.
 *
 * `agentCompatible`: los 4 loops de agentes (épicas/historias/diagramas/
 * asistente) mandan `thinking: {type: 'adaptive'}` + `output_config.effort`.
 * Un modelo sin soporte de AMBOS (p. ej. Haiku 4.5) devolvería 400 en cada
 * turno — por eso solo los compatibles son seleccionables.
 */
export interface AnthropicModelInfo {
  id: string;
  displayName: string;
  /** Descripción corta en español para la UI del selector. */
  description: string;
  /** Ventana de contexto en tokens. */
  contextWindow: number;
  /** Máximo de tokens de salida. */
  maxOutput: number;
  /** USD por millón de tokens. */
  pricing: { inputPerMTok: number; outputPerMTok: number };
  /** Compatible con el shape de los agentes (adaptive thinking + effort). */
  agentCompatible: boolean;
  /** Sugerido como balance costo/inteligencia para los agentes. */
  recommended?: boolean;
  /** Generación anterior — funcional pero superado por un modelo actual. */
  legacy?: boolean;
}

export const ANTHROPIC_MODEL_CATALOG: AnthropicModelInfo[] = [
  {
    id: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    description:
      'El modelo más potente e inteligente de Anthropic. Tier superior a Opus — para los runs más exigentes donde el costo no es la restricción.',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { inputPerMTok: 10, outputPerMTok: 50 },
    agentCompatible: true,
  },
  {
    id: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    description:
      'El Opus más capaz — estado del arte en trabajo agéntico de horizonte largo. Ideal para épicas/historias complejas que justifican el costo.',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { inputPerMTok: 5, outputPerMTok: 25 },
    agentCompatible: true,
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    description:
      'El mejor balance velocidad/inteligencia/costo. Es el modelo con el que se calibraron los presupuestos de tokens de los agentes de CENZONTLE.',
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    pricing: { inputPerMTok: 3, outputPerMTok: 15 },
    agentCompatible: true,
    recommended: true,
  },
  {
    id: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7',
    description:
      'Opus de generación anterior. Sigue activo; para nuevos runs conviene Opus 4.8 al mismo precio.',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { inputPerMTok: 5, outputPerMTok: 25 },
    agentCompatible: true,
    legacy: true,
  },
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    description:
      'Opus de dos generaciones atrás. Sigue activo; para nuevos runs conviene Opus 4.8 al mismo precio.',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { inputPerMTok: 5, outputPerMTok: 25 },
    agentCompatible: true,
    legacy: true,
  },
  {
    id: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    description:
      'El más rápido y económico — pero NO soporta adaptive thinking ni effort, que los agentes de CENZONTLE requieren. No seleccionable como modelo de agentes.',
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { inputPerMTok: 1, outputPerMTok: 5 },
    agentCompatible: false,
  },
];
