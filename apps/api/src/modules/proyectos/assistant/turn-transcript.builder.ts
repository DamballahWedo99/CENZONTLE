import type {
  AssistantChatEvent,
  AssistantTranscriptMessage,
  AssistantTranscriptSegment,
} from '@cenzontle/shared';

/**
 * Compacta los eventos SSE de UN turno en los mensajes de transcript que se
 * persisten en la sesión (Redis) para rehidratar la UI tras una recarga.
 *
 * Consume los MISMOS eventos que el frontend reduce en vivo
 * (useAssistantChat.handleEvent) — misma semántica de segmentos: los
 * text_delta/thinking_delta consecutivos se consolidan en un segmento; un
 * tool_start abre un segmento de tool que su tool_done cierra con el summary;
 * cada proposal es su propio segmento. Los eventos de control (session, done,
 * error) no forman parte de la transcript.
 */
export class TurnTranscriptBuilder {
  private readonly segments: AssistantTranscriptSegment[] = [];

  constructor(private readonly userMessage: string) {}

  ingest(event: AssistantChatEvent): void {
    switch (event.type) {
      case 'text_delta': {
        const last = this.segments[this.segments.length - 1];
        if (last?.kind === 'text') {
          last.content += event.delta;
        } else {
          this.segments.push({ kind: 'text', content: event.delta });
        }
        break;
      }
      case 'thinking_delta': {
        const last = this.segments[this.segments.length - 1];
        if (last?.kind === 'thinking') {
          last.content += event.delta;
        } else {
          this.segments.push({ kind: 'thinking', content: event.delta });
        }
        break;
      }
      case 'tool_start':
        this.segments.push({ kind: 'tool', tool: event.tool, label: event.label });
        break;
      case 'tool_done': {
        for (let i = this.segments.length - 1; i >= 0; i--) {
          const seg = this.segments[i];
          if (seg.kind === 'tool' && seg.tool === event.tool && seg.summary === undefined) {
            seg.summary = event.summary ?? 'Completado';
            break;
          }
        }
        break;
      }
      case 'proposal':
        this.segments.push({ kind: 'proposal', proposal: event.proposal });
        break;
      case 'error':
        // Solo llega aquí cuando el turno SE PERSISTE pese al error (hoy:
        // max_tokens — los demás errores hacen rollback y la transcript se
        // descarta). Sin esto, al rehidratar la respuesta truncada parecería
        // completa. Se registra como el mismo aviso que el usuario vio en vivo.
        this.segments.push({ kind: 'text', content: `\n\n⚠️ ${event.message}` });
        break;
      default:
        break;
    }
  }

  /**
   * Mensajes del turno para anexar a la transcript de la sesión: el user
   * message visible + la respuesta del asistente (si produjo algo).
   */
  build(): AssistantTranscriptMessage[] {
    const messages: AssistantTranscriptMessage[] = [
      { role: 'user', segments: [{ kind: 'text', content: this.userMessage }] },
    ];
    if (this.segments.length > 0) {
      messages.push({ role: 'assistant', segments: this.segments });
    }
    return messages;
  }
}
