import { ConflictException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import Anthropic from '@anthropic-ai/sdk';
import { VaultConnectionsStatus } from '@cenzontle/shared';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { OrgAnthropicConfigService } from '../org-anthropic-config/org-anthropic-config.service';
import { anthropicFetch } from '../../lib/anthropic-fetch';
import { VaultService, VaultTreeNode } from './vault.service';
import { VaultCloneService } from './vault-clone.service';
import { VaultConfigService } from './vault-config.service';
import {
  buildExcerpt,
  extractTitle,
  joinFrontmatter,
  normalizeTag,
  parseFrontmatterTags,
  sameTagSet,
  splitFrontmatter,
  updateFrontmatterTags,
} from './vault-tags.util';

/**
 * VaultConnectionsService — agente IA que genera conexiones en el grafo
 * del vault asignando tags temáticos al frontmatter de los documentos.
 *
 * Mecánica del grafo (GraphView.tsx): dos documentos se conectan cuando
 * comparten un tag, pero los tags presentes en MÁS de 5 documentos se
 * ignoran (ruido). Por eso el agente apunta a tags que agrupen 2-5 docs:
 * un tag huérfano (1 doc) no conecta nada y uno masivo no genera aristas.
 *
 * Diseño del job (mismo patrón fire-and-forget + polling que
 * VaultCloneService.scheduleClone / getStatus):
 *  1. `start()` valida que no haya job en curso y dispara `runJob()` sin
 *     await. El endpoint responde 202 con el snapshot inicial.
 *  2. `runJob()` lee todos los .md (clone local si está ready — costo fs;
 *     fallback a GitHub Contents API), llama a Claude por lotes con tool
 *     use forzado, y escribe vía `writeNote()` SOLO los docs cuyos tags
 *     cambian (writeNote ya serializa con mutex + retry).
 *  3. El frontend pollea `getStatus()` y recarga el árbol al ver `done`.
 *
 * Un solo job a la vez en el proceso: el costo es una llamada LLM por cada
 * ~80 docs y un commit por doc modificado — correr dos en paralelo solo
 * duplicaría commits en conflicto sobre el mismo repo.
 */

// Sonnet 4.6 — mismo executor que forge-planner/story-gen: suficiente para
// clasificación temática; Opus sería costo sin beneficio en esta tarea.
const EXECUTOR_MODEL = 'claude-sonnet-4-6';

// Prefijo de los commits que escribe el agente. Es el marcador que
// `getLastRunAt` busca en el git history para datar la última corrida — por
// eso vive como constante única (escritura y lectura no pueden divergir).
const CONNECTIONS_COMMIT_PREFIX = 'docs(vault): conexiones IA';

// Docs por llamada LLM. 80 docs × ~400 tokens de excerpt ≈ 32K input —
// cómodo dentro de la ventana y deja el output (~40 tokens/doc) lejos del cap.
const CHUNK_SIZE = 80;

// Cap de seguridad del job completo. Por encima de esto el costo/latencia
// crecen sin que el grafo gane legibilidad; el excedente se reporta en
// `skippedDocuments` (no silencioso).
const MAX_DOCUMENTS = 400;

// Excerpt por documento para el prompt. Los headings + primer párrafo
// concentran la señal temática; el resto es costo marginal.
const EXCERPT_CHARS = 1200;

// Tags máximos que el agente puede dejar en un doc (existentes + nuevos).
const MAX_TAGS_PER_DOC = 6;

// Lecturas concurrentes en el fallback GitHub API (el clone local es fs y
// no necesita límite). 6 mantiene el burst bajo el secondary rate limit.
const READ_CONCURRENCY = 6;

const CALL_MAX_TOKENS = 8192;
const CALL_TIMEOUT_MS = 10 * 60 * 1000;

// TTL del cache de getAllTags — alineado con el cache de readNote (60s).
const TAGS_CACHE_TTL_MS = 60_000;

const SYSTEM_PROMPT = `Eres el agente de conexiones del vault de documentación de CENZONTLE (plataforma de software factory). Recibes un lote de documentos markdown (path, título, tags existentes y un extracto) y asignas tags temáticos cuyo único propósito es CONECTAR documentos relacionados en una vista de grafo.

Reglas del grafo (no negociables):
1. Dos documentos se conectan cuando comparten un tag, pero los tags presentes en más de 5 documentos se IGNORAN. Apunta a tags que agrupen entre 2 y 5 documentos.
2. Un tag usado por un solo documento no crea ninguna conexión — no propongas tags huérfanos.
3. Asigna entre 2 y 5 tags por documento.

Reglas de formato:
4. kebab-case en español, minúsculas, sin acentos ni espacios: autenticacion, flujo-de-pagos, infra-deploy.
5. Conserva los tags existentes de cada documento e inclúyelos en tu respuesta (puedes sumarles nuevos, no quitarlos).
6. Si recibes un "vocabulario compartido" de lotes anteriores, reutilízalo siempre que aplique — la coherencia entre lotes vale más que la creatividad.

Criterio semántico:
7. Conecta por dominio funcional real (misma feature, mismo flujo de negocio, misma capa técnica), no por similitudes superficiales como "ambos son markdown" o "ambos mencionan código".

Responde ÚNICAMENTE con la tool submit_tag_assignments, incluyendo TODOS los documentos del lote.`;

const SUBMIT_TOOL: Anthropic.Tool = {
  name: 'submit_tag_assignments',
  description:
    'Entrega la asignación final de tags para cada documento del lote. Incluye todos los documentos recibidos.',
  input_schema: {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path exacto del documento, tal como se recibió.' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Set final de tags (existentes + nuevos), 2-5 por documento, kebab-case en español.',
            },
          },
          required: ['path', 'tags'],
        },
      },
    },
    required: ['assignments'],
  },
};

const IDLE_STATUS: VaultConnectionsStatus = {
  status: 'idle',
  phase: null,
  vaultId: null,
  totalDocuments: 0,
  processedDocuments: 0,
  updatedDocuments: 0,
  skippedDocuments: 0,
  sharedTags: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

interface VaultDocumentSnapshot {
  path: string;
  name: string;
  frontmatter: string | null;
  body: string;
  tags: string[];
}

@Injectable()
export class VaultConnectionsService {
  private status: VaultConnectionsStatus = { ...IDLE_STATUS };

  private readonly tagsCache = new Map<string, { at: number; tags: Record<string, string[]> }>();

  constructor(
    private readonly vault: VaultService,
    private readonly clones: VaultCloneService,
    private readonly vaultConfigs: VaultConfigService,
    private readonly orgAnthropic: OrgAnthropicConfigService,
    @InjectPinoLogger(VaultConnectionsService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Clave del cache de tags para un vault target. Para requests sin vaultId
   * resuelve el id REAL del vault activo (no un alias sintético): tras un
   * switch de vault activo, una entrada del anterior nunca debe servirse a
   * usuarios autorizados solo para el nuevo (CWE-200 cross-vault). Con el id
   * real como clave, una entrada solo se sirve a requests de ESE vault —
   * que ya pasaron el VaultAccessGuard contra él. Si no hay activo, usa un
   * sentinel que igual no aliasea ningún vault real.
   */
  private async resolveCacheKey(vaultId?: string): Promise<string> {
    if (vaultId) return vaultId;
    const vaults = await this.vaultConfigs.findAll();
    return vaults.find((v) => v.isActive)?.id ?? '__no-active-vault__';
  }

  /**
   * Snapshot del job. Filtrado por vault: si el job en curso (o el último
   * terminado) pertenece a un vault distinto al consultado, devuelve un
   * snapshot idle neutro — el status de un vault restringido no debe
   * filtrarse a usuarios que solo pasaron el guard del vault activo
   * (CWE-200: ni metadatos como tamaño del corpus o mensajes de error).
   */
  getStatus(requestedVaultId?: string): VaultConnectionsStatus {
    const requested = requestedVaultId ?? null;
    if (this.status.status !== 'idle' && this.status.vaultId !== requested) {
      return { ...IDLE_STATUS };
    }
    return { ...this.status };
  }

  /**
   * Inicia el job de conexiones. Lanza ConflictException si ya hay uno en
   * curso. Fire-and-forget: el caller obtiene el snapshot inicial y pollea
   * `getStatus()` para el progreso.
   */
  start(vaultId?: string): VaultConnectionsStatus {
    if (this.status.status === 'running') {
      throw new ConflictException('Ya hay una generación de conexiones en curso');
    }
    this.status = {
      status: 'running',
      phase: 'reading',
      vaultId: vaultId ?? null,
      totalDocuments: 0,
      processedDocuments: 0,
      updatedDocuments: 0,
      skippedDocuments: 0,
      sharedTags: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    void this.runJob(vaultId).catch((err: any) => {
      // runJob ya captura sus errores; este catch es el backstop para que
      // una excepción inesperada nunca deje el status en running eterno.
      this.logger.error({ err: err?.message }, '[connections] runJob escapó el catch interno');
      this.status = {
        ...this.status,
        status: 'error',
        phase: null,
        finishedAt: new Date().toISOString(),
        error: 'Error inesperado generando conexiones — revisa los logs del servidor',
      };
    });
    return this.getStatus(vaultId);
  }

  /**
   * Mapa path → tags de TODOS los documentos .md del vault. Alimenta la
   * vista de grafo del frontend (que sin esto solo conoce los tags de los
   * docs que el usuario abrió en la sesión). Cache 60s por vault.
   */
  async getAllTags(vaultId?: string): Promise<Record<string, string[]>> {
    const key = await this.resolveCacheKey(vaultId);
    const hit = this.tagsCache.get(key);
    if (hit && Date.now() - hit.at < TAGS_CACHE_TTL_MS) return hit.tags;

    const { docs } = await this.collectDocuments(vaultId);
    const map: Record<string, string[]> = {};
    for (const d of docs) {
      if (d.tags.length > 0) map[d.path] = d.tags;
    }
    this.tagsCache.set(key, { at: Date.now(), tags: map });
    return map;
  }

  /**
   * Fecha ISO de la última generación de conexiones, derivada del git history
   * del vault: el commit-marcador más reciente que el agente escribe
   * (`docs(vault): conexiones IA — …`). No se persiste estado propio — el
   * vault es la fuente de verdad, igual que el changelog. `listCommits` los
   * devuelve más-reciente-primero, así que el primer match es la última
   * corrida. Devuelve null si nunca se generaron (o si la última quedó fuera
   * de los últimos 100 commits — caso raro que la UI muestra como "sin datos").
   */
  async getLastRunAt(vaultId?: string): Promise<string | null> {
    const commits = await this.vault.listCommits(100, undefined, vaultId);
    const marker = commits.find((c) => c.message.startsWith(CONNECTIONS_COMMIT_PREFIX));
    return marker?.date || null;
  }

  // === Job ===

  private async runJob(vaultId?: string): Promise<void> {
    try {
      const client = await this.buildClient();

      const { docs, skipped, scanned } = await this.collectDocuments(vaultId, (processed, total) => {
        this.status.processedDocuments = processed;
        this.status.totalDocuments = total;
      });
      // totalDocuments = archivos escaneados (no solo los legibles): así
      // processedDocuments nunca lo excede durante el progreso del polling.
      this.status.totalDocuments = scanned;
      this.status.skippedDocuments = skipped;

      if (docs.length === 0) {
        this.finishOk();
        return;
      }

      // --- Análisis por lotes, con vocabulario acumulado para coherencia ---
      this.status.phase = 'analyzing';
      const suggestionsByPath = new Map<string, string[]>();
      const vocabulary = new Map<string, number>();
      // Los tags existentes también son vocabulario: el agente debe poder
      // conectar un doc nuevo a un cluster ya etiquetado a mano.
      for (const d of docs) {
        for (const t of d.tags) vocabulary.set(t, (vocabulary.get(t) ?? 0) + 1);
      }

      for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
        const chunk = docs.slice(i, i + CHUNK_SIZE);
        const assignments = await this.analyzeChunk(client, chunk, vocabulary);
        for (const [docPath, tags] of assignments) {
          suggestionsByPath.set(docPath, tags);
          for (const t of tags) {
            if (!vocabulary.has(t)) vocabulary.set(t, 0);
          }
        }
        this.logger.info(
          { chunk: i / CHUNK_SIZE + 1, docs: chunk.length, assigned: assignments.size },
          '[connections] chunk analizado',
        );
      }

      // --- Resolución global: solo aceptar tags que realmente conectan ---
      const finalByPath = this.resolveFinalTags(docs, suggestionsByPath);

      // --- Escritura de los docs cuyo set de tags cambió ---
      this.status.phase = 'writing';
      for (const doc of docs) {
        const finalTags = finalByPath.get(doc.path);
        if (!finalTags || sameTagSet(finalTags, doc.tags)) continue;
        const newFrontmatter = updateFrontmatterTags(doc.frontmatter, finalTags);
        const content = joinFrontmatter(newFrontmatter || null, doc.body);
        await this.vault.writeNote(
          doc.path,
          content,
          `${CONNECTIONS_COMMIT_PREFIX} — tags de ${doc.path}`,
          vaultId,
        );
        this.status.updatedDocuments += 1;
      }

      // Conteo final de tags conectivos para el resumen de la UI. Mismo
      // criterio que GraphView: un tag dibuja aristas solo si lo comparten
      // 2-5 documentos (>5 se ignora como ruido).
      const counts = new Map<string, number>();
      for (const doc of docs) {
        const tags = finalByPath.get(doc.path) ?? doc.tags;
        for (const t of new Set(tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      this.status.sharedTags = [...counts.values()].filter((n) => n >= 2 && n <= 5).length;

      // Los tags cambiaron en GitHub: el próximo getAllTags debe releer.
      // Misma clave (id real del vault) que pobló el cache en getAllTags.
      this.tagsCache.delete(await this.resolveCacheKey(vaultId));

      this.finishOk();
      this.logger.info(
        {
          total: this.status.totalDocuments,
          updated: this.status.updatedDocuments,
          sharedTags: this.status.sharedTags,
          skipped: skipped,
        },
        '[connections] job completado',
      );
    } catch (err: any) {
      const isKeyMissing = err?.status === 404 || err?.name === 'NotFoundException';
      // El detalle del error (mensajes de la SDK de Anthropic / Octokit)
      // se queda en los logs del servidor — puede contener URLs internas o
      // contexto de infraestructura que no debe llegar al cliente (CWE-200).
      const message = isKeyMissing
        ? 'API key de Anthropic no configurada — configúrala en Settings → Factory'
        : 'Error generando conexiones — revisa los logs del servidor';
      this.logger.error({ err: err?.message, stack: err?.stack }, '[connections] job falló');
      this.status = {
        ...this.status,
        status: 'error',
        phase: null,
        finishedAt: new Date().toISOString(),
        error: message,
      };
    }
  }

  private finishOk(): void {
    this.status = {
      ...this.status,
      status: 'done',
      phase: null,
      finishedAt: new Date().toISOString(),
    };
  }

  private async buildClient(): Promise<Anthropic> {
    const apiKey = await this.orgAnthropic.getApiKeyPlaintext();
    return new Anthropic({
      apiKey,
      timeout: CALL_TIMEOUT_MS,
      fetch: anthropicFetch,
    });
  }

  // === Lectura del corpus ===

  /**
   * Lista los .md del vault y lee su contenido. Camino feliz: clone local
   * (fs, milisegundos). Fallback por archivo: GitHub Contents API vía
   * readNote (cacheado 60s). El cap MAX_DOCUMENTS se reporta como skipped.
   */
  private async collectDocuments(
    vaultId?: string,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{ docs: VaultDocumentSnapshot[]; skipped: number; scanned: number }> {
    const tree = await this.vault.listTree('', vaultId);
    const allPaths: { path: string; name: string }[] = [];
    collectMarkdownFiles(tree, allPaths);

    const skipped = Math.max(0, allPaths.length - MAX_DOCUMENTS);
    if (skipped > 0) {
      this.logger.warn(
        { total: allPaths.length, cap: MAX_DOCUMENTS },
        '[connections] vault excede el cap de documentos; el excedente se omite',
      );
    }
    const targets = allPaths.slice(0, MAX_DOCUMENTS);
    const cloneRoot = await this.resolveCloneRoot(vaultId);

    const docs: VaultDocumentSnapshot[] = [];
    let processed = 0;
    await mapWithConcurrency(targets, cloneRoot ? 16 : READ_CONCURRENCY, async (entry) => {
      const content = await this.readDocumentContent(cloneRoot, entry.path, vaultId);
      processed += 1;
      onProgress?.(processed, targets.length);
      if (content === null) return;
      const { frontmatter, body } = splitFrontmatter(content);
      docs.push({
        path: entry.path,
        name: entry.name,
        frontmatter,
        body,
        tags: parseFrontmatterTags(frontmatter),
      });
    });

    // Orden estable por path: chunks deterministas entre corridas.
    docs.sort((a, b) => a.path.localeCompare(b.path));
    return { docs, skipped, scanned: targets.length };
  }

  /**
   * Ruta del clone local si el vault target está activo y ready; null si
   * hay que ir a la API de GitHub. `ensureFresh` fuerza pull si hay writes
   * pendientes de sincronizar (pendingSyncs) — sin esto el agente leería
   * tags viejos justo después de una edición manual.
   */
  private async resolveCloneRoot(vaultId?: string): Promise<string | null> {
    const enabled = await this.clones.getEnabled();
    const target = vaultId ? enabled.find((v) => v.id === vaultId) : enabled[0];
    if (!target) return null;
    try {
      await this.clones.ensureFresh(target.id, TAGS_CACHE_TTL_MS);
    } catch {
      // Pull falló: leemos el clone como esté (mejor stale que N requests).
    }
    return target.absolutePath;
  }

  private async readDocumentContent(
    cloneRoot: string | null,
    docPath: string,
    vaultId?: string,
  ): Promise<string | null> {
    if (cloneRoot) {
      // CWE-22: los paths vienen del tree de GitHub, no de input del user,
      // pero el check de prefijo es barato y elimina la clase de bug.
      const resolved = path.resolve(cloneRoot, docPath);
      if (resolved.startsWith(path.resolve(cloneRoot) + path.sep)) {
        try {
          return await fs.readFile(resolved, 'utf8');
        } catch {
          // Archivo aún no presente en el clone (recién creado) → fallback API.
        }
      }
    }
    try {
      const note = await this.vault.readNote(docPath, vaultId);
      return note?.content ?? null;
    } catch (err: any) {
      this.logger.warn({ path: docPath, err: err?.message }, '[connections] no se pudo leer documento');
      return null;
    }
  }

  // === LLM ===

  private async analyzeChunk(
    client: Anthropic,
    chunk: VaultDocumentSnapshot[],
    vocabulary: Map<string, number>,
  ): Promise<Map<string, string[]>> {
    const payload = {
      documentos: chunk.map((d) => ({
        path: d.path,
        titulo: extractTitle(d.body, d.name),
        tags_existentes: d.tags,
        extracto: buildExcerpt(d.body, EXCERPT_CHARS),
      })),
      vocabulario_compartido: [...vocabulary.keys()].sort(),
    };

    const response = await client.messages.create({
      model: EXECUTOR_MODEL,
      max_tokens: CALL_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
      tools: [SUBMIT_TOOL],
      tool_choice: { type: 'tool', name: SUBMIT_TOOL.name },
    });

    const block = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_TOOL.name,
    );
    if (!block) {
      throw new Error('El agente no devolvió asignaciones de tags (sin tool_use en la respuesta)');
    }
    if (!block.input || typeof block.input !== 'object' || Array.isArray(block.input)) {
      throw new Error('El agente devolvió un input de tool malformado (no es objeto)');
    }

    const input = block.input as { assignments?: Array<{ path?: unknown; tags?: unknown }> };
    const known = new Map(chunk.map((d) => [d.path, d]));
    const result = new Map<string, string[]>();
    for (const entry of input.assignments ?? []) {
      if (typeof entry.path !== 'string' || !known.has(entry.path)) continue;
      if (!Array.isArray(entry.tags)) continue;
      const normalized: string[] = [];
      for (const raw of entry.tags) {
        if (typeof raw !== 'string') continue;
        const tag = normalizeTag(raw);
        if (tag && !normalized.includes(tag)) normalized.push(tag);
      }
      result.set(entry.path, normalized);
    }
    return result;
  }

  /**
   * Resolución global post-LLM. El modelo ve un lote a la vez; aquí, con el
   * universo completo, se aplican las invariantes que garantizan conexiones:
   *  - Los tags existentes se preservan SIEMPRE (no destructivo — quitar
   *    tags es decisión del usuario vía TagEditor, no del agente).
   *  - Un tag sugerido solo se acepta si conecta ≥2 documentos en el
   *    universo final (sugerido o existente en otro doc).
   *  - Cap MAX_TAGS_PER_DOC por documento, priorizando los tags más
   *    conectivos (mayor frecuencia global → más aristas).
   */
  private resolveFinalTags(
    docs: VaultDocumentSnapshot[],
    suggestionsByPath: Map<string, string[]>,
  ): Map<string, string[]> {
    // Frecuencia de cada tag en el universo candidato (existentes + sugeridos).
    const freq = new Map<string, number>();
    for (const doc of docs) {
      const union = new Set([...doc.tags, ...(suggestionsByPath.get(doc.path) ?? [])]);
      for (const t of union) freq.set(t, (freq.get(t) ?? 0) + 1);
    }

    const final = new Map<string, string[]>();
    for (const doc of docs) {
      const existing = [...new Set(doc.tags)];
      const suggested = (suggestionsByPath.get(doc.path) ?? []).filter(
        (t) => !existing.includes(t) && (freq.get(t) ?? 0) >= 2,
      );
      // Más conectivos primero; el cap corta los marginales.
      suggested.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));
      const room = Math.max(0, MAX_TAGS_PER_DOC - existing.length);
      final.set(doc.path, [...existing, ...suggested.slice(0, room)]);
    }
    return final;
  }
}

// === Helpers puros ===

function collectMarkdownFiles(nodes: VaultTreeNode[], out: { path: string; name: string }[]): void {
  for (const node of nodes) {
    if (node.name.startsWith('.')) continue;
    if (node.type === 'file' && node.name.toLowerCase().endsWith('.md')) {
      out.push({ path: node.path, name: node.name });
    }
    if (node.children) collectMarkdownFiles(node.children, out);
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
