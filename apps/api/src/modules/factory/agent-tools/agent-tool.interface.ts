import type Anthropic from '@anthropic-ai/sdk';

/**
 * Bloque adjunto que una tool multimodal puede inyectar en el siguiente user
 * message del loop del agente. Los `document` blocks (PDF) y los `image` blocks
 * no caben dentro de un `tool_result` — la API de Anthropic solo acepta `text`
 * e `image` como contenido de tool_result. Por eso los propagamos via un user
 * message extra, inmediatamente después del tool_result.
 */
export type ToolAttachment =
  | Anthropic.Messages.ImageBlockParam
  | Anthropic.Messages.DocumentBlockParam;

/** Retorno de la ruta multimodal. El `text` va al tool_result.content como string. */
export interface MultimodalToolResult {
  text: string;
  attachments?: ToolAttachment[];
}

/** Contract for agent tools usable by the Claude SDK tool-use loop. */
export interface AgentTool {
  /** Unique tool name (snake_case, matches the name sent to Claude). */
  readonly name: string;

  /** JSON Schema describing the tool input. */
  readonly schema: Record<string, unknown>;

  /** Human-readable description shown to the model. */
  readonly description: string;

  /** Execute the tool with validated input and request-scoped context. */
  execute(input: Record<string, unknown>, ctx: AgentToolContext): Promise<string>;

  /**
   * Ruta opcional para tools que producen adjuntos multimodales (PDFs, imágenes).
   * Si existe, el dispatcher la prefiere sobre `execute`. El `text` se envía como
   * tool_result.content y `attachments` se adjunta al messages array como siguiente
   * user turn.
   */
  executeMultimodal?(
    input: Record<string, unknown>,
    ctx: AgentToolContext,
  ): Promise<MultimodalToolResult>;
}

export interface AgentToolContext {
  tenantId?: string;
  userId?: string;
  initiativeId: string;
}
