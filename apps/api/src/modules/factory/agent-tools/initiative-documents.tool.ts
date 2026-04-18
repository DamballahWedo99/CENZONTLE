import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsService } from '../../documents/documents.service';
import type {
  AgentTool,
  AgentToolContext,
  MultimodalToolResult,
} from './agent-tool.interface';
import { readDocument } from './document-readers/document-reader';

@Injectable()
export class InitiativeDocumentsTool implements AgentTool {
  readonly name = 'read_initiative_documents';
  readonly description =
    'Read documents attached to the current initiative (PDF, images, markdown/text). PDFs and images are injected natively into your context — you can see and read them directly, no parsing needed. Call first without documentId to list available documents, then call again with specific documentId to read each one. These documents contain critical requirements and context that should directly inform your epic proposals.';
  readonly schema = {
    type: 'object' as const,
    properties: {
      documentId: {
        type: 'string',
        description: 'Optional: specific document ID to read. Omit to list all.',
      },
    },
    required: [] as string[],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  async executeMultimodal(
    input: Record<string, unknown>,
    ctx: AgentToolContext,
  ): Promise<MultimodalToolResult> {
    const initiative = await this.prisma.initiative.findUnique({
      where: { id: ctx.initiativeId },
      select: { documents: true },
    });

    if (!initiative) {
      return { text: JSON.stringify({ error: 'Initiative not found' }) };
    }

    const docs = (initiative.documents as any[]) || [];

    if (docs.length === 0) {
      return {
        text: JSON.stringify({ documents: [], message: 'No documents attached to this initiative' }),
      };
    }

    const docId = input.documentId ? String(input.documentId) : null;

    if (!docId) {
      return {
        text: JSON.stringify({
          documents: docs.map((d) => ({
            id: d.id,
            name: d.name,
            format: d.format || 'unknown',
            url: d.url,
          })),
        }),
      };
    }

    const doc = docs.find((d) => d.id === docId);
    if (!doc) {
      return {
        text: JSON.stringify({ error: `Document "${docId}" not found in initiative` }),
      };
    }

    // La URL puede venir relativa (`/api/documents/file/<key>`) o absoluta
    // (`http://host:port/api/documents/file/<key>`), dependiendo de cómo el
    // frontend la haya persistido en el JSONB. Usamos indexOf para ambos.
    const URL_MARKER = '/api/documents/file/';
    const url: string | undefined = doc.url;
    const markerIdx = url?.indexOf(URL_MARKER);
    if (url && markerIdx !== undefined && markerIdx >= 0) {
      const key = url.substring(markerIdx + URL_MARKER.length);
      // Defensa en profundidad: los documentos de una iniciativa viven bajo
      // `initiatives/<initiativeId>/...`. Rechazar claves que apunten a
      // cualquier otra carpeta para prevenir IDOR — incluso si un actor con
      // EDIT_INITIATIVE intentara apuntar `url` a documentos de otra iniciativa.
      const expectedPrefix = `initiatives/${ctx.initiativeId}/`;
      if (!key.startsWith(expectedPrefix)) {
        return {
          text: JSON.stringify({
            error: 'Documento no pertenece a esta iniciativa',
            name: doc.name,
          }),
        };
      }
      const { path, exists } = this.documents.getFilePath(key);
      if (exists) {
        const result = await readDocument(path, doc.name);
        return {
          text: JSON.stringify({
            name: doc.name,
            format: doc.format,
            ...(result.attachments ? { note: result.text } : { content: result.text }),
          }),
          attachments: result.attachments,
        };
      }
    }

    return {
      text: JSON.stringify({
        name: doc.name,
        format: doc.format,
        url: doc.url,
        message: 'Content not available for direct reading',
      }),
    };
  }

  /** Compatibilidad con callers legacy — delega a executeMultimodal y descarta attachments. */
  async execute(input: Record<string, unknown>, ctx: AgentToolContext): Promise<string> {
    const result = await this.executeMultimodal(input, ctx);
    return result.text;
  }
}
