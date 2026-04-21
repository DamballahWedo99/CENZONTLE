import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Subject } from 'rxjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PodsService } from '../../pods/pods.service';
import { VaultService } from '../../../vault/vault.service';
import { InitiativeDocumentsTool } from '../../../factory/agent-tools/initiative-documents.tool';
import { CodeGlobTool } from '../../../factory/agent-tools/code-glob.tool';
import { CodeGrepTool } from '../../../factory/agent-tools/code-grep.tool';
import { CodeReadTool } from '../../../factory/agent-tools/code-read.tool';
import { VaultGlobTool } from '../../../factory/agent-tools/vault-glob.tool';
import { VaultGrepTool } from '../../../factory/agent-tools/vault-grep.tool';
import { VaultReadTool } from '../../../factory/agent-tools/vault-read.tool';
import {
  isNewFormatVaultPath,
  epicFolderPath,
  type InitiativeRef,
  type EpicRef,
} from '../../vault-paths';
import { CodeRepoCloneService } from '../../../code-repositories/code-repo-clone.service';
import type { AgentTool, AgentToolContext, ToolAttachment } from '../../../factory/agent-tools/agent-tool.interface';
import type {
  StoryGenerationEvent,
  ProposedStory,
  StoryStatus,
  StoryPOFields,
  StoryTechnicalFields,
  StoryQAFields,
  StoryOutline,
  RelatedDocument,
  DiscoveredDependency,
  StoryAgentRole,
  DependencySeverity,
  DiscoveredDependencyType,
} from '@cenzontle/shared';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_ATTACHMENT_BYTES_TOTAL = 60 * 1024 * 1024;
const VALID_STORY_POINTS = [1, 2, 3, 5, 8, 13] as const;

// Presupuestos por agente — tuned para equilibrio entre profundidad y costo.
//
// max_tokens: Sonnet 4 soporta hasta 64000 tokens output nativamente. Damos
// margen generoso a TL y QA porque cuando el PO propone N historias, cada
// uno tiene que redactar N × (subsecciones × prosa). Si el QA sigue
// truncando con 32K, el issue no es el cap — es que el modelo esta
// entrando en loop de iteracion sin producir el terminal tool.
// PO es mas ligero (metadata + criteria) y 12K le sobra.
const PO_MAX_ITERATIONS = 8;
const TL_MAX_ITERATIONS = 8;
const QA_MAX_ITERATIONS = 6;
const PO_MAX_TOKENS = 12288;
const TL_MAX_TOKENS = 32768;
const QA_MAX_TOKENS = 32768;

// Caps defensivos alineados con DTO (apps/api/.../stories/dto/story-content.dto.ts).
const MAX_FIELD_LEN = 20_000;
const MAX_LIST_ITEM_LEN = 2_000;
const MAX_LIST_SIZE = 100;
const MAX_TITLE_LEN = 200;
const MAX_LABELS = 20;
const MAX_LABEL_LEN = 64;
const MAX_DOCS_PER_BATCH = 50;
const MAX_DEPS_PER_BATCH = 80;
const MAX_DEP_MD_LEN = 10_000;

function cap(s: string, n = MAX_FIELD_LEN): string {
  return s.length > n ? s.slice(0, n) : s;
}

// Clasificación de archivos del vault según su subcarpeta dentro del folder de la épica.
type EpicVaultFileKind = 'diagrama' | 'documento' | 'dependencia' | 'matriz' | 'historia' | 'otro';

interface EpicVaultFile {
  path: string;
  sizeBytes?: number;
  kind: EpicVaultFileKind;
}

interface CommonContext {
  epic: {
    id: string;
    title: string;
    description: string;
    priority: string;
    startDate: Date;
    targetDate: Date;
    podIds: string[];
    vaultPath: string | null;
    initiative: { id: string; name: string; description: string };
    stories: { id: string; title: string; storyPoints: number }[];
  };
  epicMarkdown: string;
  podsForAssignment: { id: string; name: string; description: string }[];
  existingStoriesSummary: string;
  enabledRepos: Array<{ name: string; branch: string }>;
  // Archivos .md del folder de la épica en el vault — para que el agente PO los lea con vault_read.
  epicVaultFiles: EpicVaultFile[];
  ctx: AgentToolContext;
}

interface POResult {
  outlines: StoryOutline[];
  relatedDocuments: RelatedDocument[];
}

interface TLResult {
  designs: Map<number, StoryTechnicalFields>; // indexed by outline position
}

interface QAResult {
  strategies: Map<number, StoryQAFields>;
  discoveredDependencies: DiscoveredDependency[];
}

interface AgentLoopParams {
  role: StoryAgentRole;
  commonContextBlock: string; // va en system[0] con cache_control
  roleSystemPrompt: string;   // va en system[1]
  tools: (Anthropic.Messages.Tool | Anthropic.Messages.WebSearchTool20250305)[];
  agentToolset: AgentTool[];  // tools concretas (instancias) para ejecutar
  maxIterations: number;
  maxTokens: number;
  initialUserContent: string; // primer user turn (contexto especifico del rol)
  terminalToolName: string;
  ctx: AgentToolContext;
  signal?: AbortSignal;
  subject: Subject<{ data: StoryGenerationEvent }>;
  runStartTime: number;
}

@Injectable()
export class StoryGenerationService {
  private readonly logger = new Logger(StoryGenerationService.name);
  private readonly client: Anthropic;
  // Toolsets por rol (referencias a las mismas instancias inyectadas).
  private readonly poToolset: AgentTool[];
  private readonly tlToolset: AgentTool[];
  private readonly qaToolset: AgentTool[];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly pods: PodsService,
    private readonly vault: VaultService,
    private readonly initDocsTool: InitiativeDocumentsTool,
    private readonly codeGlob: CodeGlobTool,
    private readonly codeGrep: CodeGrepTool,
    private readonly codeRead: CodeReadTool,
    private readonly vaultGlob: VaultGlobTool,
    private readonly vaultGrep: VaultGrepTool,
    private readonly vaultRead: VaultReadTool,
    private readonly codeRepoClones: CodeRepoCloneService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not configured — story generation will fail at runtime');
    }
    // Sonnet 4 (claude-sonnet-4-20250514) soporta max_tokens hasta 64000 tokens
    // NATIVAMENTE, sin beta header. El header 'output-128k-2025-02-19' era de
    // Sonnet 3.7 y no aplica aqui — lo removimos por higiene.
    // Para output > 64K se requiere Opus 4.6/4.7 (128K nativo) o Batches API.
    this.client = new Anthropic({ apiKey: apiKey || undefined });

    // PO lee contexto de negocio (docs de iniciativa + vault de definiciones).
    this.poToolset = [initDocsTool, vaultGlob, vaultGrep, vaultRead];
    // TL explora codigo para disenar arquitectura. Puede leer docs si necesita.
    this.tlToolset = [codeGlob, codeGrep, codeRead, vaultRead, initDocsTool];
    // QA explora codigo para detectar test patterns existentes y dependencias.
    this.qaToolset = [codeGlob, codeGrep, codeRead, vaultRead];
  }

  /**
   * Punto de entrada. Orquesta 3 agentes Claude secuenciales (PO → TL → QA)
   * sobre el mismo contexto comun cacheado (prompt caching ephemeral, TTL 5 min).
   * Retorna un Subject que emite eventos SSE al subscriber.
   */
  generate(
    epicId: string,
    prompt?: string,
    count?: number,
    signal?: AbortSignal,
    webSearch = false,
  ): Subject<{ data: StoryGenerationEvent }> {
    const subject = new Subject<{ data: StoryGenerationEvent }>();

    this.runOrchestrator(epicId, prompt, count, subject, signal, webSearch).catch((err) => {
      this.logger.error(`Orchestrator error: ${err.message}`, err.stack);
      subject.next({
        data: {
          type: 'error',
          message: 'Error interno al generar historias. Intenta de nuevo.',
          timestamp: new Date().toISOString(),
        },
      });
      subject.complete();
    });

    return subject;
  }

  // ─────────────────────────────────────────────────────────────────────
  //   ORQUESTADOR — 3 agentes en serie con contexto comun cacheado
  // ─────────────────────────────────────────────────────────────────────

  private async runOrchestrator(
    epicId: string,
    userPrompt: string | undefined,
    count: number | undefined,
    subject: Subject<{ data: StoryGenerationEvent }>,
    signal: AbortSignal | undefined,
    webSearch: boolean,
  ) {
    const runStartTime = Date.now();
    this.logger.log(
      `[StoryGen] ═══ START orchestrator epic=${epicId} count=${count ?? 'auto'} webSearch=${webSearch} hasPrompt=${!!userPrompt}`,
    );
    subject.next({ data: { type: 'run_started', timestamp: new Date().toISOString() } });

    // ── Fase 1: researching (carga contexto comun)
    subject.next({
      data: {
        type: 'phase_change',
        phase: 'researching',
        label: 'Cargando contexto de la epica',
        role: 'orchestrator',
        timestamp: new Date().toISOString(),
      },
    });

    const common = await this.loadCommonContext(epicId, subject);
    if (!common) {
      subject.next({
        data: {
          type: 'run_finished',
          timestamp: new Date().toISOString(),
          totalDurationMs: Date.now() - runStartTime,
        },
      });
      subject.complete();
      return;
    }

    if (signal?.aborted) {
      subject.next({
        data: {
          type: 'run_finished',
          timestamp: new Date().toISOString(),
          totalDurationMs: Date.now() - runStartTime,
        },
      });
      subject.complete();
      return;
    }

    const commonContextBlock = this.buildCommonContextBlock(common);

    try {
      // ── Fase 2: drafting_po
      this.logger.log(`[StoryGen] ── Phase: drafting_po (t=${Date.now() - runStartTime}ms)`);
      subject.next({
        data: {
          type: 'phase_change',
          phase: 'drafting_po',
          label: 'Product Owner redactando vision de negocio',
          role: 'po',
          timestamp: new Date().toISOString(),
        },
      });
      const poStart = Date.now();
      const poResult = await this.runPOAgent(common, commonContextBlock, userPrompt, count, webSearch, signal, subject, runStartTime);
      if (!poResult) {
        this.logger.warn(`[StoryGen] PO agent returned null — aborting orchestration`);
        return;
      }
      this.logger.log(
        `[StoryGen] ✓ PO done in ${Date.now() - poStart}ms: ${poResult.outlines.length} outlines, ${poResult.relatedDocuments.length} relatedDocs`,
      );

      // ── Fase 3: drafting_technical
      this.logger.log(`[StoryGen] ── Phase: drafting_technical (t=${Date.now() - runStartTime}ms)`);
      subject.next({
        data: {
          type: 'phase_change',
          phase: 'drafting_technical',
          label: 'Tech Lead disenando arquitectura y flujo',
          role: 'technical',
          timestamp: new Date().toISOString(),
        },
      });
      const tlStart = Date.now();
      const tlResult = await this.runTechnicalAgent(common, commonContextBlock, poResult, signal, subject, runStartTime);
      if (!tlResult) {
        this.logger.warn(`[StoryGen] TL agent returned null — aborting orchestration`);
        return;
      }
      this.logger.log(
        `[StoryGen] ✓ TL done in ${Date.now() - tlStart}ms: ${tlResult.designs.size} designs`,
      );

      // ── Fase 4: drafting_qa
      this.logger.log(`[StoryGen] ── Phase: drafting_qa (t=${Date.now() - runStartTime}ms)`);
      subject.next({
        data: {
          type: 'phase_change',
          phase: 'drafting_qa',
          label: 'QA trazando estrategia de pruebas',
          role: 'qa',
          timestamp: new Date().toISOString(),
        },
      });
      const qaStart = Date.now();
      const qaResult = await this.runQAAgent(common, commonContextBlock, poResult, tlResult, signal, subject, runStartTime);
      if (!qaResult) {
        this.logger.warn(`[StoryGen] QA agent returned null — aborting orchestration`);
        return;
      }
      this.logger.log(
        `[StoryGen] ✓ QA done in ${Date.now() - qaStart}ms: ${qaResult.strategies.size} strategies, ${qaResult.discoveredDependencies.length} deps`,
      );

      // ── Fase 5: proposing (consolidacion y emision)
      this.logger.log(`[StoryGen] ── Phase: proposing (t=${Date.now() - runStartTime}ms)`);
      subject.next({
        data: {
          type: 'phase_change',
          phase: 'proposing',
          label: 'Consolidando propuestas',
          role: 'orchestrator',
          timestamp: new Date().toISOString(),
        },
      });
      this.emitProposals(poResult, tlResult, qaResult, common, subject);

      const totalMs = Date.now() - runStartTime;
      this.logger.log(`[StoryGen] ═══ DONE orchestrator in ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);
      subject.next({ data: { type: 'done', timestamp: new Date().toISOString() } });
      subject.next({
        data: {
          type: 'run_finished',
          timestamp: new Date().toISOString(),
          totalDurationMs: totalMs,
        },
      });
      subject.complete();
    } catch (err: any) {
      // Failsafe: si un agente arroja inesperadamente, emitimos error claro antes
      // de run_finished para que la UI no quede colgada en "drafting_*".
      // CRITICO: loguear tambien el nombre del error y status HTTP si es de la SDK
      // de Anthropic — ayuda a distinguir 400 (bad request), 429 (rate limit),
      // 529 (overloaded), 500 (server error).
      const errName = err?.name ?? 'UnknownError';
      const errStatus = err?.status ?? err?.response?.status ?? 'n/a';
      const errBody = err?.error?.error?.message ?? err?.response?.data?.error?.message ?? err?.message ?? String(err);
      this.logger.error(
        `Orchestrator failure: name=${errName} status=${errStatus} msg="${errBody}"`,
        err?.stack,
      );
      // Mensaje seguro al frontend: incluye el mensaje real PERO truncado y sanitizado.
      // Sin info del SO, stack traces o secrets — solo la causa humano-legible.
      const safeMsg = typeof errBody === 'string'
        ? errBody.slice(0, 300).replace(/[\r\n\t]/g, ' ')
        : 'Error desconocido';
      subject.next({
        data: {
          type: 'error',
          message: `Error del agente: ${safeMsg}${errStatus !== 'n/a' ? ` (HTTP ${errStatus})` : ''}`,
          timestamp: new Date().toISOString(),
        },
      });
      subject.next({
        data: {
          type: 'run_finished',
          timestamp: new Date().toISOString(),
          totalDurationMs: Date.now() - runStartTime,
        },
      });
      subject.complete();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //   CARGA DE CONTEXTO COMUN
  // ─────────────────────────────────────────────────────────────────────

  private async loadCommonContext(
    epicId: string,
    subject: Subject<{ data: StoryGenerationEvent }>,
  ): Promise<CommonContext | null> {
    subject.next({
      data: {
        type: 'step_start',
        step: 'loading_context',
        label: 'Cargando contexto de la epica',
        role: 'orchestrator',
        timestamp: new Date().toISOString(),
      },
    });

    const epicRow = await this.prisma.epic.findUnique({
      where: { id: epicId },
      include: {
        initiative: true,
        stories: { select: { id: true, title: true, storyPoints: true } },
        pods: { select: { podId: true } },
      },
    });

    if (!epicRow) {
      subject.next({
        data: {
          type: 'error',
          message: 'Epica no encontrada',
          timestamp: new Date().toISOString(),
        },
      });
      return null;
    }

    const epic = {
      ...epicRow,
      podIds: epicRow.pods.map((ep: { podId: string }) => ep.podId),
    };

    let epicMarkdown = '';
    if (epic.vaultPath) {
      try {
        const note = await this.vault.readNote(epic.vaultPath);
        epicMarkdown = note?.content ?? '';
      } catch (err: any) {
        this.logger.warn(`No se pudo leer markdown de la epica: ${err?.message}`);
      }
    }

    const allPodsRaw = await this.pods.findAll();
    const epicPodIdSet = new Set<string>(epic.podIds);
    const epicPods = allPodsRaw.filter((p: { id: string }) => epicPodIdSet.has(p.id));
    const podsForAssignment = epicPods.length > 0 ? epicPods : allPodsRaw;

    const existingStoriesSummary = epic.stories
      .map((s: { title: string; storyPoints: number }) => `- ${s.title} (${s.storyPoints} SP)`)
      .join('\n');

    const enabledRepos = await this.codeRepoClones.getEnabled().catch(() => []);

    // ── Scan del vault: listar todos los .md del folder de la épica ──────
    const epicVaultFiles = await this.scanEpicVaultFiles(
      epic.vaultPath,
      { id: epic.initiative.id, name: epic.initiative.name },
      { id: epic.id, title: epic.title },
    );

    subject.next({
      data: {
        type: 'step_done',
        step: 'loading_context',
        role: 'orchestrator',
        summary: `Epica "${epic.title}" (iniciativa "${epic.initiative.name}"), ${epic.stories.length} historias existentes${enabledRepos.length > 0 ? `, ${enabledRepos.length} repo(s) de codigo` : ''}${epicVaultFiles.length > 0 ? `, ${epicVaultFiles.length} archivo(s) en vault` : ''}`,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      epic: {
        id: epic.id,
        title: epic.title,
        description: epic.description,
        priority: epic.priority,
        startDate: epic.startDate,
        targetDate: epic.targetDate,
        podIds: epic.podIds,
        vaultPath: epic.vaultPath,
        initiative: {
          id: epic.initiative.id,
          name: epic.initiative.name,
          description: epic.initiative.description,
        },
        stories: epic.stories,
      },
      epicMarkdown,
      podsForAssignment,
      existingStoriesSummary,
      enabledRepos,
      epicVaultFiles,
      ctx: { initiativeId: epic.initiativeId },
    };
  }

  /**
   * Lista todos los archivos .md dentro del folder de la épica en el vault.
   * Clasifica cada archivo según su subcarpeta (diagrama, documento, dependencia, etc.).
   *
   * Solo funciona para épicas con formato nuevo (iniciativas/<slug>/epics/<slug>/index.md).
   * Para paths legacy retorna lista vacía con advertencia.
   *
   * Limitado a 30 archivos para evitar contextos excesivos.
   */
  private async scanEpicVaultFiles(
    vaultPath: string | null,
    ini: InitiativeRef,
    epic: EpicRef,
  ): Promise<EpicVaultFile[]> {
    const MAX_FILES = 30;

    // Si no hay vaultPath en formato nuevo, no hay folder canonico que listar.
    if (!isNewFormatVaultPath(vaultPath)) {
      if (vaultPath) {
        this.logger.warn(`[StoryGen] epic vault scan omitido — vaultPath legacy o nulo: "${vaultPath}"`);
      }
      return [];
    }

    // Construir el path del folder de la épica a partir de ini+epic refs.
    const folderPath = epicFolderPath(ini, epic);

    try {
      const tree = await this.vault.listTree(folderPath);

      // Aplanar el árbol anidado a una lista plana de archivos .md.
      const flatFiles: EpicVaultFile[] = [];
      const walk = (nodes: typeof tree) => {
        for (const node of nodes) {
          if (node.type === 'file' && node.path.endsWith('.md')) {
            flatFiles.push({
              path: node.path,
              sizeBytes: node.size,
              kind: this.classifyEpicVaultFile(node.path),
            });
          }
          if (node.children && node.children.length > 0) {
            walk(node.children);
          }
        }
      };
      walk(tree);

      // Ordenar: diagramas primero (los más valiosos para el PO), luego el resto.
      flatFiles.sort((a, b) => {
        const priority: Record<EpicVaultFileKind, number> = {
          diagrama: 0,
          matriz: 1,
          dependencia: 2,
          documento: 3,
          historia: 4,
          otro: 5,
        };
        return priority[a.kind] - priority[b.kind];
      });

      // Limitar a MAX_FILES para evitar contextos excesivos.
      const limited = flatFiles.slice(0, MAX_FILES);

      // Log de resumen por tipo para observabilidad.
      const counts = limited.reduce<Record<EpicVaultFileKind, number>>(
        (acc, f) => { acc[f.kind] = (acc[f.kind] || 0) + 1; return acc; },
        { diagrama: 0, documento: 0, dependencia: 0, matriz: 0, historia: 0, otro: 0 },
      );
      this.logger.log(
        `[StoryGen] epic vault scan: found ${limited.length} files` +
        ` (${counts.diagrama} diagramas, ${counts.documento} documentos,` +
        ` ${counts.dependencia} deps, ${counts.matriz} matrices,` +
        ` ${counts.historia} historias, ${counts.otro} otros)`,
      );

      return limited;
    } catch (err: any) {
      this.logger.warn(`[StoryGen] epic vault scan falló (vault desconectado o 404): ${err?.message}`);
      return [];
    }
  }

  /**
   * Clasifica un archivo del vault según la subcarpeta en la que se encuentra
   * dentro del folder de la épica.
   */
  private classifyEpicVaultFile(path: string): EpicVaultFileKind {
    if (path.includes('/diagramas/')) return 'diagrama';
    if (path.includes('/dependencias/')) return 'dependencia';
    if (path.includes('/matrices/')) return 'matriz';
    if (path.includes('/documentos/')) return 'documento';
    if (path.includes('/historias/')) return 'historia';
    return 'otro';
  }

  private buildCommonContextBlock(ctx: CommonContext): string {
    const { epic, epicMarkdown, podsForAssignment, enabledRepos, existingStoriesSummary, epicVaultFiles } = ctx;
    const startDate = epic.startDate.toISOString().slice(0, 10);
    const targetDate = epic.targetDate.toISOString().slice(0, 10);

    const parts = [
      `<epic>
titulo: ${epic.title}
prioridad: ${epic.priority}
fechas: ${startDate} -> ${targetDate}

descripcion_breve:
${epic.description}
${epicMarkdown ? `\ndefinicion_completa_markdown:\n${epicMarkdown.slice(0, 12_000)}${epicMarkdown.length > 12_000 ? '\n\n[…truncado — usa vault_read si necesitas el resto]' : ''}` : ''}
</epic>`,

      `<initiative_parent>
nombre: ${epic.initiative.name}

${epic.initiative.description}
</initiative_parent>`,

      `<pods_asignados_a_la_epica>
Cada historia debe asignarse a UNO de estos pods:
${podsForAssignment.map((p) => `- ${p.name} (id: ${p.id}): ${p.description}`).join('\n')}
</pods_asignados_a_la_epica>`,
    ];

    if (enabledRepos.length > 0) {
      parts.push(`<available_code_repositories>
Repositorios de codigo conectados (para code_glob/code_grep/code_read):
${enabledRepos.map((r) => `- ${r.name} (branch: ${r.branch})`).join('\n')}

Nombre exacto en parametro \`repository\` de code_read. code_glob/code_grep pueden omitir repository para fan-out.
</available_code_repositories>`);
    } else {
      parts.push(`<available_code_repositories>
Ninguno conectado. code_* retornaran error. Basate en vault y documentos de la iniciativa.
</available_code_repositories>`);
    }

    if (existingStoriesSummary) {
      parts.push(`<existing_stories>
Historias existentes — NO las repitas, propon complementarias:
${existingStoriesSummary}
</existing_stories>`);
    } else {
      parts.push('<existing_stories>\nNinguna — primera generacion para esta epica.\n</existing_stories>');
    }

    // Folder base de la epica en el vault (extraido del vaultPath que apunta al index.md).
    // El agente PO lo usa como prefijo para vault_glob: `<folder>/**/*.md` descubre
    // diagramas/documentos/dependencias/matrices que existen REALMENTE (no cached).
    // Defensivo: escapamos <,> por si un path mal-formado intenta cerrar tags del prompt.
    const escapeForPrompt = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const epicFolderBase = epic.vaultPath && epic.vaultPath.endsWith('/index.md')
      ? epic.vaultPath.slice(0, -'/index.md'.length)
      : null;

    if (epicFolderBase && epicVaultFiles.length > 0) {
      // Hay folder valido Y ya hicimos un pre-scan: damos el folder base como ancla
      // + un hint de que tipos de artefactos existen (para guiar el grep). NO damos
      // los paths exactos como prescripcion — el agente los redescubre con vault_glob.
      const counts = epicVaultFiles.reduce<Record<string, number>>((acc, f) => {
        acc[f.kind] = (acc[f.kind] || 0) + 1;
        return acc;
      }, {});
      const summary = Object.entries(counts)
        .map(([kind, n]) => `${n} ${kind}${n !== 1 ? 's' : ''}`)
        .join(', ');
      parts.push(`<epic_vault_files>
Folder de la epica en el vault: \`${escapeForPrompt(epicFolderBase)}\`
Artefactos presentes (pre-scan): ${summary}.

Usa este folder como prefijo en \`vault_glob\` para descubrir los paths reales y pasarlos a \`vault_read\`.
Ejemplo: \`vault_glob\` con pattern \`${escapeForPrompt(epicFolderBase)}/**/*.md\` → lista los .md dentro del folder.
</epic_vault_files>`);
    } else if (epicFolderBase) {
      // Folder existe pero pre-scan vacio. Aun asi, el agente puede hacer vault_glob
      // por si se escribieron archivos nuevos despues del snapshot del pre-scan.
      parts.push(`<epic_vault_files>
Folder de la epica en el vault: \`${escapeForPrompt(epicFolderBase)}\`
El pre-scan no encontro artefactos todavia (sin diagramas/matrices/deps generados). Puedes intentar \`vault_glob\` con pattern \`${escapeForPrompt(epicFolderBase)}/**/*.md\` por si hay archivos nuevos; si devuelve vacio, salta al paso 1.
</epic_vault_files>`);
    } else {
      // Sin folder (epica legacy sin vaultPath nuevo o sin vaultPath). El agente debe
      // basarse solo en el markdown de la epica ya incluido arriba.
      parts.push(`<epic_vault_files>
Esta epica no tiene folder en el nuevo formato del vault (legacy o sin migrar). NO uses \`vault_glob\`/\`vault_grep\`/\`vault_read\` para artefactos de epica — basate en el markdown completo y los documentos de la iniciativa.
</epic_vault_files>`);
    }

    return parts.join('\n\n');
  }

  // ─────────────────────────────────────────────────────────────────────
  //   AGENTE 1 — PRODUCT OWNER
  // ─────────────────────────────────────────────────────────────────────

  private async runPOAgent(
    common: CommonContext,
    commonContextBlock: string,
    userPrompt: string | undefined,
    count: number | undefined,
    webSearch: boolean,
    signal: AbortSignal | undefined,
    subject: Subject<{ data: StoryGenerationEvent }>,
    runStartTime: number,
  ): Promise<POResult | null> {
    const roleSystemPrompt = this.buildPOSystemPrompt(count, webSearch);
    const docs = await this.getInitiativeDocumentsMeta(common.epic.initiative.id);

    const terminalTool: Anthropic.Messages.Tool = {
      name: 'submit_po_outline',
      description: 'Envia los outlines de las historias (seccion PO) y los documentos de la iniciativa detectados como relevantes. LLama a esta tool UNA sola vez cuando completes el analisis de negocio.',
      input_schema: {
        type: 'object' as const,
        properties: {
          stories: {
            type: 'array',
            description: count
              ? `Aproximadamente ${count} outlines de historia (tolerancia ±2 si el scope real lo requiere). Cada uno con metadata + seccion PO completa.`
              : `Las historias NECESARIAS para cubrir el alcance completo de la epica. Tipicamente 3-10, puede ser mas si el scope es extenso (hasta 15). Cada una con metadata + seccion PO completa. NO inventes historias para rellenar — tampoco las omitas por pereza.`,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string', description: 'Resumen ejecutivo 1-2 lineas' },
                storyPoints: { type: 'number', description: 'Fibonacci: 1, 2, 3, 5, 8 o 13' },
                podId: { type: 'string', description: 'ID exacto de uno de los pods listados' },
                labels: { type: 'array', items: { type: 'string' } },
                po: {
                  type: 'object',
                  properties: {
                    background: { type: 'string', description: 'Antecedentes, contexto historico, por que surge' },
                    objective: { type: 'string' },
                    userStory: { type: 'string', description: 'Como [rol], quiero [accion], para [beneficio]' },
                    whatHowWhen: {
                      type: 'object',
                      properties: {
                        what: { type: 'string' },
                        how: { type: 'string' },
                        when: { type: 'string' },
                      },
                      required: ['what', 'how', 'when'],
                    },
                    acceptanceCriteria: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Minimo 3 criterios verificables',
                    },
                    additionalNotes: { type: 'string' },
                  },
                  required: ['background', 'objective', 'userStory', 'whatHowWhen', 'acceptanceCriteria'],
                },
              },
              required: ['title', 'description', 'storyPoints', 'podId', 'po'],
            },
          },
          relatedDocuments: {
            type: 'array',
            description: 'Documentos de la iniciativa que son relevantes al conjunto de historias. Para cada uno, incluye un resumen de 1-2 parrafos de POR QUE aplica.',
            items: {
              type: 'object',
              properties: {
                docId: { type: 'string', description: 'ID del documento (devuelto por read_initiative_documents al listar sin documentId)' },
                docName: { type: 'string' },
                bucketUrl: { type: 'string', description: 'Ruta del bucket (de la lista de documentos inicial)' },
                relevanceSummary: { type: 'string' },
              },
              required: ['docId', 'docName', 'bucketUrl', 'relevanceSummary'],
            },
          },
        },
        required: ['stories', 'relatedDocuments'],
      },
    };

    const claudeTools: (Anthropic.Messages.Tool | Anthropic.Messages.WebSearchTool20250305)[] = [];
    if (webSearch) {
      claudeTools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3 });
    }
    claudeTools.push(
      ...this.poToolset.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema as Anthropic.Messages.Tool.InputSchema,
      })),
      terminalTool,
    );

    const docsList = docs.length > 0
      ? `\n<initiative_documents_available>\n${docs.map((d) => `- ${d.id}: "${d.name}" (${d.format ?? 'unknown'})${d.url ? ` @ ${d.url}` : ''}`).join('\n')}\n\nUsa read_initiative_documents con documentId para leer cualquiera. En relatedDocuments de submit_po_outline usa exactamente estos id/name/url.\n</initiative_documents_available>`
      : '\n<initiative_documents_available>Ninguno</initiative_documents_available>';

    const userContent = [
      'Eres el Agente Product Owner.',
      '',
      'Tu mision: redactar los outlines (metadata + seccion PO de negocio) de las historias que entregan el valor de la epica descrita en el contexto.',
      '',
      docsList,
      '',
      userPrompt ? `<user_instructions>\n${userPrompt}\n</user_instructions>` : '',
      '',
      `Proceso obligatorio:
1. Si hay documentos de iniciativa, LEELOS con read_initiative_documents (lista primero sin documentId, luego individualmente).
2. Busca definiciones/reglas de negocio en el vault (vault_grep/vault_read) si la epica menciona conceptos con terminologia propia.
3. Propon ${count ? `aproximadamente ${count}` : `las`} historias ${count ? '' : 'necesarias (segun el alcance real de la epica, no un numero fijo) '}con secciones PO completas (minimo 3 criterios de aceptacion cada una).
4. Identifica cuales de los documentos anteriores son especialmente relevantes a estas historias y arma \`relatedDocuments\`.
5. Llama submit_po_outline UNA sola vez con todo listo.

NO disenes tecnicamente ni propongas tests — eso es trabajo del Tech Lead y del QA. Tu output es input literal del siguiente agente.`,
    ].join('\n').trim();

    const output = await this.runAgentLoop({
      role: 'po',
      commonContextBlock,
      roleSystemPrompt,
      tools: claudeTools,
      agentToolset: this.poToolset,
      maxIterations: PO_MAX_ITERATIONS,
      maxTokens: PO_MAX_TOKENS,
      initialUserContent: userContent,
      terminalToolName: 'submit_po_outline',
      ctx: common.ctx,
      signal,
      subject,
      runStartTime,
    });

    if (!output) return null;

    const rawStories = Array.isArray((output as any).stories) ? (output as any).stories : [];
    const rawDocs = Array.isArray((output as any).relatedDocuments) ? (output as any).relatedDocuments : [];

    // Cap duro de 15 historias por presupuesto de tokens del TL/QA (cada historia
    // agrega ~2500 output tokens en QA). Si el usuario paso `count`, respetamos
    // ese numero como tope de seguridad (±2); si no, tope defensivo de 15.
    // Este cap NO es censurio — es para no explotar el contexto del siguiente agente.
    const storyCap = count !== undefined ? Math.min(count + 2, 15) : 15;
    const outlines: StoryOutline[] = rawStories
      .slice(0, storyCap)
      .map((raw: Record<string, unknown>) => this.normalizeOutline(raw, common))
      .filter((o: StoryOutline | null): o is StoryOutline => o !== null);

    const relatedDocuments: RelatedDocument[] = rawDocs
      .slice(0, MAX_DOCS_PER_BATCH)
      .map((raw: Record<string, unknown>) => ({
        docId: cap(String(raw.docId ?? ''), 200),
        docName: cap(String(raw.docName ?? 'documento'), 300),
        bucketUrl: cap(String(raw.bucketUrl ?? ''), 500),
        relevanceSummary: cap(String(raw.relevanceSummary ?? '')),
      }))
      .filter((d: RelatedDocument) => d.docId && d.relevanceSummary);

    if (outlines.length === 0) {
      subject.next({
        data: {
          type: 'error',
          message: 'El agente PO no produjo outlines validos. Intenta con un prompt mas especifico.',
          timestamp: new Date().toISOString(),
        },
      });
      return null;
    }

    return { outlines, relatedDocuments };
  }

  // ─────────────────────────────────────────────────────────────────────
  //   AGENTE 2 — TECH LEAD
  // ─────────────────────────────────────────────────────────────────────

  private async runTechnicalAgent(
    common: CommonContext,
    commonContextBlock: string,
    poResult: POResult,
    signal: AbortSignal | undefined,
    subject: Subject<{ data: StoryGenerationEvent }>,
    runStartTime: number,
  ): Promise<TLResult | null> {
    const roleSystemPrompt = this.buildTLSystemPrompt();

    const terminalTool: Anthropic.Messages.Tool = {
      name: 'submit_technical_designs',
      description: 'Envia las secciones tecnicas disenadas, indexadas por outlineIndex (0-based en el orden que recibiste los outlines del PO).',
      input_schema: {
        type: 'object' as const,
        properties: {
          designs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                outlineIndex: { type: 'number', description: '0-based index del outline del PO' },
                technical: {
                  type: 'object',
                  properties: {
                    architecture: { type: 'string', description: 'Markdown extenso con capa, proposito, dependencias, patron' },
                    integrationFlow: { type: 'string', description: 'Secuencia de llamadas paso a paso' },
                    validations: { type: 'array', items: { type: 'string' } },
                    errorHandling: { type: 'array', items: { type: 'string' } },
                    implementationChecklist: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['architecture', 'integrationFlow', 'validations', 'errorHandling', 'implementationChecklist'],
                },
              },
              required: ['outlineIndex', 'technical'],
            },
          },
        },
        required: ['designs'],
      },
    };

    const claudeTools: Anthropic.Messages.Tool[] = [
      ...this.tlToolset.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema as Anthropic.Messages.Tool.InputSchema,
      })),
      terminalTool,
    ];

    const outlinesBlock = poResult.outlines
      .map((o, i) => `<story index="${i}">
titulo: ${o.title}
description: ${o.description}
storyPoints: ${o.storyPoints}
podId: ${o.podId}
po.userStory: ${o.po.userStory}
po.objective: ${o.po.objective}
po.acceptanceCriteria:
${o.po.acceptanceCriteria.map((c) => `  - ${c}`).join('\n')}
</story>`)
      .join('\n\n');

    const userContent = `Eres el Agente Tech Lead.

Tu mision: para CADA uno de los ${poResult.outlines.length} outlines que el Product Owner ya escribio, disena la seccion tecnica completa. Ya esta decidido QUE construir; tu trabajo es COMO.

<story_outlines_from_po>
${outlinesBlock}
</story_outlines_from_po>

Proceso obligatorio:
1. Explora el codigo de los repositorios conectados (code_grep/code_read) para entender stack, convenciones, error handling existente, testing tooling.
2. Lee del vault (vault_read) cualquier decision de arquitectura documentada que aplique.
3. Para CADA story, genera su seccion tecnica con los 5 campos llenos (architecture, integrationFlow, validations, errorHandling, implementationChecklist).
4. Llama submit_technical_designs UNA sola vez con un design por cada outlineIndex.

NO cambies titles, descriptions, acceptanceCriteria — esos estan congelados. Si detectas que un outline es inviable, igual genera design con el mejor aproach y deja notas en architecture.`;

    const output = await this.runAgentLoop({
      role: 'technical',
      commonContextBlock,
      roleSystemPrompt,
      tools: claudeTools,
      agentToolset: this.tlToolset,
      maxIterations: TL_MAX_ITERATIONS,
      maxTokens: TL_MAX_TOKENS,
      initialUserContent: userContent,
      terminalToolName: 'submit_technical_designs',
      ctx: common.ctx,
      signal,
      subject,
      runStartTime,
    });

    if (!output) return null;

    const rawDesigns = Array.isArray((output as any).designs) ? (output as any).designs : [];
    const designs = new Map<number, StoryTechnicalFields>();
    for (const raw of rawDesigns) {
      const idx = typeof raw.outlineIndex === 'number' ? raw.outlineIndex : -1;
      if (idx < 0 || idx >= poResult.outlines.length) continue;
      designs.set(idx, this.normalizeTechnical(raw.technical));
    }

    // FAIL FAST: si el agente NO produjo ningun design, abortar con diagnostico
    // enriquecido (igual que el QA, ver comentario alla).
    if (designs.size === 0) {
      const rawPreview = rawDesigns.length > 0
        ? JSON.stringify(rawDesigns[0]).slice(0, 400)
        : '(empty array)';
      const indicesSeen = rawDesigns
        .map((r: any) => r?.outlineIndex)
        .filter((i: any) => typeof i === 'number')
        .join(',');
      const diagnosis =
        rawDesigns.length === 0
          ? 'Array rawDesigns vacio — o truncamiento o el agente emitio designs:[]'
          : `rawDesigns tiene ${rawDesigns.length} items pero ninguno matched outlineIndex valido [0..${poResult.outlines.length - 1}]. Indices recibidos: [${indicesSeen}]`;
      this.logger.error(
        `[StoryGen:TL] ✗ no designs produced. rawDesigns.length=${rawDesigns.length} outlineCount=${poResult.outlines.length}. ${diagnosis}. Raw[0] preview: ${rawPreview}`,
      );
      subject.next({
        data: {
          type: 'error',
          message: 'El agente Tech Lead no pudo generar las definiciones tecnicas (respuesta truncada). Reintenta con menos historias.',
          timestamp: new Date().toISOString(),
        },
      });
      return null;
    }

    // Cobertura parcial: si faltan algunos, log y rellenar con shells vacios.
    const missing: number[] = [];
    for (let i = 0; i < poResult.outlines.length; i++) {
      if (!designs.has(i)) {
        missing.push(i);
        designs.set(i, this.normalizeTechnical({}));
      }
    }
    if (missing.length > 0) {
      this.logger.warn(
        `[StoryGen:TL] partial coverage: ${designs.size - missing.length}/${poResult.outlines.length} valid; missing indices=[${missing.join(',')}] filled with empty shells`,
      );
    }

    return { designs };
  }

  // ─────────────────────────────────────────────────────────────────────
  //   AGENTE 3 — QA
  // ─────────────────────────────────────────────────────────────────────

  private async runQAAgent(
    common: CommonContext,
    commonContextBlock: string,
    poResult: POResult,
    tlResult: TLResult,
    signal: AbortSignal | undefined,
    subject: Subject<{ data: StoryGenerationEvent }>,
    runStartTime: number,
  ): Promise<QAResult | null> {
    const roleSystemPrompt = this.buildQASystemPrompt();

    const terminalTool: Anthropic.Messages.Tool = {
      name: 'submit_qa_strategies',
      description: 'Envia las estrategias de testing por historia (indexed por outlineIndex) + dependencias descubiertas transversales.',
      input_schema: {
        type: 'object' as const,
        properties: {
          strategies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                outlineIndex: { type: 'number' },
                qa: {
                  type: 'object',
                  properties: {
                    testingStrategy: { type: 'string', description: 'Markdown con subsecciones: alcance unitarias, escenarios felices, edge cases, mocks, cobertura, herramientas' },
                  },
                  required: ['testingStrategy'],
                },
              },
              required: ['outlineIndex', 'qa'],
            },
          },
          discoveredDependencies: {
            type: 'array',
            description: 'Dependencias descubiertas al trazar testing (APIs externas, servicios, datos, equipos). Cada una con mdContent markdown que se guardara como archivo individual en el vault.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string', description: '1-2 lineas' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                type: { type: 'string', enum: ['api', 'service', 'data', 'team', 'other'] },
                mdContent: { type: 'string', description: 'Markdown extenso: naturaleza, impacto en testing, estrategia de mock, owner sugerido, links' },
              },
              required: ['title', 'description', 'severity', 'type', 'mdContent'],
            },
          },
        },
        required: ['strategies', 'discoveredDependencies'],
      },
    };

    const claudeTools: Anthropic.Messages.Tool[] = [
      ...this.qaToolset.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema as Anthropic.Messages.Tool.InputSchema,
      })),
      terminalTool,
    ];

    const fullStoriesBlock = poResult.outlines
      .map((o, i) => {
        const design = tlResult.designs.get(i);
        return `<story index="${i}">
titulo: ${o.title}
po.userStory: ${o.po.userStory}
po.acceptanceCriteria:
${o.po.acceptanceCriteria.map((c) => `  - ${c}`).join('\n')}

technical.architecture:
${design?.architecture ?? '(no disponible)'}

technical.integrationFlow:
${design?.integrationFlow ?? '(no disponible)'}

technical.validations:
${(design?.validations ?? []).map((v) => `  - ${v}`).join('\n')}

technical.errorHandling:
${(design?.errorHandling ?? []).map((e) => `  - ${e}`).join('\n')}
</story>`;
      })
      .join('\n\n');

    const userContent = `Eres el Agente QA.

Tu mision: para CADA una de las ${poResult.outlines.length} historias (con su PO y TL ya definidos), redacta la estrategia de testing enfocada en PRUEBAS UNITARIAS e integracion a nivel de historia. Y de forma transversal, identifica las dependencias descubiertas durante este trazo.

<stories_with_po_and_tl>
${fullStoriesBlock}
</stories_with_po_and_tl>

Proceso obligatorio:
1. Explora el codigo (code_grep, code_read) para entender frameworks de testing existentes (Jest/Vitest/JUnit/pytest) y patrones de mocks ya usados.
2. Para CADA historia, redacta testingStrategy con estas 6 subsecciones markdown:
   (1) Alcance de pruebas unitarias
   (2) Escenarios felices (3-5)
   (3) Edge cases y errores (5-10)
   (4) Mocks y stubs
   (5) Criterios de cobertura (>= 90% tipico)
   (6) Herramientas
3. Identifica dependencias REALES descubiertas al trazar los tests (APIs externas que mockear, servicios con contratos, datos semilla, equipos que proveen). Registra cada una con su mdContent detallado — se persistiran como .md individuales en el vault.
4. Llama submit_qa_strategies UNA sola vez.

NO cambies PO ni technical. Si una historia es inviable de testear, dejalo claro en testingStrategy con recomendaciones.`;

    const output = await this.runAgentLoop({
      role: 'qa',
      commonContextBlock,
      roleSystemPrompt,
      tools: claudeTools,
      agentToolset: this.qaToolset,
      maxIterations: QA_MAX_ITERATIONS,
      maxTokens: QA_MAX_TOKENS,
      initialUserContent: userContent,
      terminalToolName: 'submit_qa_strategies',
      ctx: common.ctx,
      signal,
      subject,
      runStartTime,
    });

    if (!output) return null;

    const rawStrategies = Array.isArray((output as any).strategies) ? (output as any).strategies : [];
    const rawDeps = Array.isArray((output as any).discoveredDependencies) ? (output as any).discoveredDependencies : [];

    const strategies = new Map<number, StoryQAFields>();
    for (const raw of rawStrategies) {
      const idx = typeof raw.outlineIndex === 'number' ? raw.outlineIndex : -1;
      if (idx < 0 || idx >= poResult.outlines.length) continue;
      strategies.set(idx, this.normalizeQA(raw.qa));
    }

    // FAIL FAST: si el agente NO produjo ninguna strategy, abortar con diagnostico
    // enriquecido para distinguir entre:
    //  (a) truncamiento max_tokens (rawStrategies.length=0 porque el JSON se corto)
    //  (b) array vacio emitido intencionalmente (agente devolvio strategies:[])
    //  (c) items con outlineIndex invalido (desfase PO <-> QA)
    if (strategies.size === 0) {
      const rawPreview = rawStrategies.length > 0
        ? JSON.stringify(rawStrategies[0]).slice(0, 400)
        : '(empty array)';
      const indicesSeen = rawStrategies
        .map((r: any) => r?.outlineIndex)
        .filter((i: any) => typeof i === 'number')
        .join(',');
      const diagnosis =
        rawStrategies.length === 0
          ? 'Array rawStrategies vacio — o truncamiento o el agente emitio strategies:[]'
          : `rawStrategies tiene ${rawStrategies.length} items pero ninguno matched outlineIndex valido [0..${poResult.outlines.length - 1}]. Indices recibidos: [${indicesSeen}]`;
      this.logger.error(
        `[StoryGen:QA] ✗ no strategies produced. rawStrategies.length=${rawStrategies.length} rawDeps.length=${rawDeps.length} outlineCount=${poResult.outlines.length}. ${diagnosis}. Raw[0] preview: ${rawPreview}`,
      );
      subject.next({
        data: {
          type: 'error',
          message: `El agente QA no genero estrategias (rawStrategies=${rawStrategies.length}, outlines=${poResult.outlines.length}). Revisa los logs del API para diagnostico.`,
          timestamp: new Date().toISOString(),
        },
      });
      return null;
    }

    // Cobertura parcial: log + shells vacios.
    const missing: number[] = [];
    for (let i = 0; i < poResult.outlines.length; i++) {
      if (!strategies.has(i)) {
        missing.push(i);
        strategies.set(i, { testingStrategy: '', linkedQAMatrixId: null });
      }
    }
    if (missing.length > 0) {
      this.logger.warn(
        `[StoryGen:QA] partial coverage: ${strategies.size - missing.length}/${poResult.outlines.length} valid; missing indices=[${missing.join(',')}] filled with empty shells`,
      );
    }

    const discoveredDependencies: DiscoveredDependency[] = rawDeps
      .slice(0, MAX_DEPS_PER_BATCH)
      .map((raw: Record<string, unknown>) => this.normalizeDependency(raw))
      .filter((d: DiscoveredDependency | null): d is DiscoveredDependency => d !== null);

    return { strategies, discoveredDependencies };
  }

  // ─────────────────────────────────────────────────────────────────────
  //   LOOP GENERICO DE TOOL-USE
  // ─────────────────────────────────────────────────────────────────────

  private async runAgentLoop(params: AgentLoopParams): Promise<Record<string, unknown> | null> {
    const {
      role,
      commonContextBlock,
      roleSystemPrompt,
      tools,
      agentToolset,
      maxIterations,
      maxTokens,
      initialUserContent,
      terminalToolName,
      ctx,
      signal,
      subject,
      runStartTime,
    } = params;

    this.logger.log(
      `[StoryGen:${role.toUpperCase()}] ▶ loop start: maxIter=${maxIterations} maxTokens=${maxTokens} tools=${agentToolset.length}+terminal`,
    );

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: initialUserContent },
    ];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (signal?.aborted) {
        this.logger.warn(`[StoryGen:${role.toUpperCase()}] aborted before iter ${iteration}`);
        return null;
      }

      if (iteration === maxIterations - 2) {
        this.logger.log(`[StoryGen:${role.toUpperCase()}] nudge (iter ${iteration}/${maxIterations}) — forcing terminal tool soon`);
        messages.push({
          role: 'user',
          content: `Ya tienes suficiente contexto. Llama a ${terminalToolName} AHORA con todo lo que tengas. No hagas mas busquedas.`,
        });
      }

      const callStart = Date.now();
      const response = await this.client.messages.create(
        {
          model: MODEL,
          max_tokens: maxTokens,
          system: [
            // El bloque comun se cachea (ephemeral, TTL 5 min) para que los
            // 3 agentes consecutivos lo reutilicen sin re-pagar los input tokens.
            { type: 'text', text: commonContextBlock, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: roleSystemPrompt },
          ],
          tools,
          messages,
        },
        signal ? { signal } : undefined,
      );

      // CRITICO: log de usage con tokens. `cache_read_input_tokens > 0` en iter 0
      // de los agentes TL y QA confirma que el prompt cache funciona.
      const usage = response.usage as any;
      const cacheRead = usage?.cache_read_input_tokens ?? 0;
      const cacheCreate = usage?.cache_creation_input_tokens ?? 0;
      const inputTokens = usage?.input_tokens ?? 0;
      const outputTokens = usage?.output_tokens ?? 0;
      this.logger.log(
        `[StoryGen:${role.toUpperCase()}] iter ${iteration} stop=${response.stop_reason} dur=${Date.now() - callStart}ms tokens(in=${inputTokens} out=${outputTokens} cache_read=${cacheRead} cache_create=${cacheCreate})${cacheRead > 0 ? ' 🎯 CACHE HIT' : ''}`,
      );

      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      // Emit thinking + server tool events (web_search)
      for (const block of assistantContent) {
        if (block.type === 'text' && (block as any).text?.trim()) {
          subject.next({
            data: {
              type: 'thinking',
              delta: scrubSecrets((block as any).text),
              role,
              timestamp: new Date().toISOString(),
            },
          });
        }
        if ((block as any).type === 'server_tool_use') {
          const sb = block as any;
          subject.next({
            data: {
              type: 'step_start',
              step: 'tool_use',
              tool: 'web_search',
              label: 'Investigando en la web',
              toolArgs: sb.input ? this.sanitizeToolArgs(sb.input as Record<string, unknown>) : undefined,
              role,
              timestamp: new Date().toISOString(),
            },
          });
        }
        if ((block as any).type === 'web_search_tool_result') {
          const result = block as any;
          const searchResults = Array.isArray(result.content) ? result.content : [];
          let resultPreview = '';
          try {
            const items = searchResults.filter((r: any) => r.type === 'web_search_result' || r.title || r.url);
            if (items.length > 0) {
              resultPreview = items.slice(0, 5).map((r: any) => {
                const title = r.title ?? 'Resultado';
                let host = '';
                try { host = r.url ? ` (${new URL(r.url).hostname})` : ''; } catch { /* ignore */ }
                return `${title}${host}`;
              }).join('\n');
            }
          } catch { /* ignore */ }
          subject.next({
            data: {
              type: 'step_done',
              step: 'tool_use',
              tool: 'web_search',
              summary: `${searchResults.length} resultados web`,
              resultPreview: resultPreview ? scrubSecrets(resultPreview) : undefined,
              role,
              timestamp: new Date().toISOString(),
            },
          });
        }
      }

      const toolUseBlocks = assistantContent.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0 && response.stop_reason === 'end_turn') {
        // El agente termino sin llamar terminal tool — output ambiguo.
        this.logger.warn(`Agent ${role} ended without calling ${terminalToolName}`);
        subject.next({
          data: {
            type: 'error',
            message: `El agente ${role} no produjo resultado. Intenta con un prompt mas especifico.`,
            timestamp: new Date().toISOString(),
          },
        });
        return null;
      }

      if (toolUseBlocks.length === 0) {
        continue; // probablemente solo server_tool_use (web_search) — sigue
      }

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      const pendingAttachments: ToolAttachment[] = [];
      let attachmentBytesInFlight = 0;

      for (const toolBlock of toolUseBlocks) {
        if (signal?.aborted) return null;

        // Terminal tool → retornamos su input como output del agente
        if (toolBlock.name === terminalToolName) {
          const terminalInput = toolBlock.input as Record<string, unknown>;
          const preview = this.summarizeTerminalInput(terminalToolName, terminalInput);
          // Si el modelo se quedo sin tokens MIENTRAS escribia el JSON del terminal
          // tool, el SDK de Anthropic devuelve un objeto parcial/vacio. Detectarlo
          // explicitamente evita propagar shells vacios silenciosamente.
          const truncated = response.stop_reason === 'max_tokens';
          if (truncated) {
            this.logger.warn(
              `[StoryGen:${role.toUpperCase()}] ⚠ terminal tool '${terminalToolName}' called at iter ${iteration} BUT stop_reason=max_tokens — JSON likely truncated. Preview: ${preview}`,
            );
          } else {
            this.logger.log(
              `[StoryGen:${role.toUpperCase()}] ✓ terminal tool '${terminalToolName}' called at iter ${iteration} — ${preview}`,
            );
          }
          return terminalInput;
        }

        const tool = agentToolset.find((t) => t.name === toolBlock.name);
        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify({ error: `Tool no disponible para el agente ${role}: ${scrubSecrets(toolBlock.name).slice(0, 60)}` }),
          });
          continue;
        }

        const toolLabel = this.getToolLabel(tool.name);
        subject.next({
          data: {
            type: 'step_start',
            step: 'tool_use',
            tool: tool.name,
            label: toolLabel,
            toolArgs: this.sanitizeToolArgs(toolBlock.input as Record<string, unknown>),
            role,
            timestamp: new Date().toISOString(),
          },
        });

        const stepStartTime = Date.now();
        const timerMs = tool.executeMultimodal ? 20_000 : 10_000;
        const timer = this.timeout(timerMs);
        try {
          let result: string;
          if (tool.executeMultimodal) {
            const toolPromise = tool
              .executeMultimodal(toolBlock.input as Record<string, unknown>, ctx)
              .catch((err) => {
                this.logger.warn(`Late rejection from ${tool.name}: ${err?.message}`);
                throw err;
              });
            const mm = await Promise.race([toolPromise, timer]);
            result = mm.text;
            if (mm.attachments?.length) {
              const attachmentBytes = mm.attachments.reduce((sum, att) => {
                const data = att.source && 'data' in att.source ? att.source.data : '';
                return sum + (typeof data === 'string' ? data.length : 0);
              }, 0);
              if (attachmentBytesInFlight + attachmentBytes > MAX_ATTACHMENT_BYTES_TOTAL) {
                result = JSON.stringify({
                  error: 'Limite de adjuntos multimodales alcanzado en este run',
                });
              } else {
                attachmentBytesInFlight += attachmentBytes;
                pendingAttachments.push(...mm.attachments);
              }
            }
          } else {
            const toolPromise = tool
              .execute(toolBlock.input as Record<string, unknown>, ctx)
              .catch((err) => {
                this.logger.warn(`Late rejection from ${tool.name}: ${err?.message}`);
                throw err;
              });
            result = await Promise.race([toolPromise, timer]);
          }
          timer.clear();

          subject.next({
            data: {
              type: 'step_done',
              step: 'tool_use',
              tool: tool.name,
              summary: this.summarizeToolResult(result),
              durationMs: Date.now() - stepStartTime,
              resultPreview: this.extractResultPreview(result),
              role,
              timestamp: new Date().toISOString(),
            },
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: scrubSecrets(result),
          });
        } catch (err: any) {
          timer.clear();
          this.logger.warn(`Tool ${tool.name} (${role}) failed: ${err?.message}`);
          subject.next({
            data: {
              type: 'step_done',
              step: 'tool_use',
              tool: tool.name,
              summary: 'Error ejecutando tool',
              durationMs: Date.now() - stepStartTime,
              role,
              timestamp: new Date().toISOString(),
            },
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify({ error: 'Tool execution failed' }),
            is_error: true,
          });
        }
      }

      const userContent: Array<Anthropic.Messages.ToolResultBlockParam | ToolAttachment> =
        pendingAttachments.length > 0
          ? [...toolResults, ...pendingAttachments]
          : toolResults;
      messages.push({
        role: 'user',
        content: userContent as Anthropic.Messages.ContentBlockParam[],
      });

      void runStartTime; // usado por orquestador; referencia aqui para lint
    }

    // Max iter alcanzado sin terminal tool
    this.logger.warn(`Agent ${role} reached max iterations (${maxIterations}) without calling ${terminalToolName}`);
    subject.next({
      data: {
        type: 'error',
        message: `El agente ${role} alcanzo el maximo de iteraciones sin terminar. Reintenta.`,
        timestamp: new Date().toISOString(),
      },
    });
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────
  //   CONSOLIDACION Y EMISION FINAL
  // ─────────────────────────────────────────────────────────────────────

  private emitProposals(
    poResult: POResult,
    tlResult: TLResult,
    qaResult: QAResult,
    common: CommonContext,
    subject: Subject<{ data: StoryGenerationEvent }>,
  ) {
    const podIdSet = new Set(common.podsForAssignment.map((p) => p.id));
    if (common.podsForAssignment.length === 0 && common.epic.podIds.length === 0) {
      this.logger.error(`[StoryGen] ✗ cannot emit: epic has no pods assigned`);
      subject.next({
        data: {
          type: 'error',
          message: 'La epica no tiene pods asignados. Asigna al menos un pod antes de generar historias.',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    const fallbackPodId = common.podsForAssignment[0]?.id ?? common.epic.podIds[0];

    // Las dependencias son transversales al batch — se adjuntan a CADA historia
    // propuesta (el backend al aceptar solo persiste deps de la historia aceptada).
    const depsAll = qaResult.discoveredDependencies;

    this.logger.log(
      `[StoryGen] Consolidating ${poResult.outlines.length} proposals (docs=${poResult.relatedDocuments.length} deps=${depsAll.length})`,
    );

    for (let i = 0; i < poResult.outlines.length; i++) {
      const outline = poResult.outlines[i];
      const technical = tlResult.designs.get(i) ?? this.normalizeTechnical({});
      const qa = qaResult.strategies.get(i) ?? { testingStrategy: '', linkedQAMatrixId: null };

      const podId = podIdSet.has(outline.podId) ? outline.podId : fallbackPodId;
      const podFallbackUsed = podId !== outline.podId;

      const proposed: ProposedStory = {
        clientId: `ai-story-${randomUUID()}`,
        title: outline.title,
        description: outline.description,
        status: 'backlog' as StoryStatus,
        storyPoints: outline.storyPoints,
        epicId: common.epic.id,
        podId,
        sprintId: null,
        labels: outline.labels,
        po: outline.po,
        technical,
        qa,
        relatedDocuments: poResult.relatedDocuments,
        discoveredDependencies: depsAll,
      };

      this.logger.log(
        `[StoryGen]   proposal[${i}] "${outline.title.slice(0, 60)}" SP=${outline.storyPoints} pod=${podId}${podFallbackUsed ? ' (fallback)' : ''} tech=${technical.architecture ? 'ok' : 'empty'} qa=${qa.testingStrategy ? 'ok' : 'empty'}`,
      );

      subject.next({
        data: {
          type: 'proposal_ready',
          story: proposed,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //   NORMALIZADORES (defensive: cap + filter + default)
  // ─────────────────────────────────────────────────────────────────────

  private normalizeOutline(raw: Record<string, unknown>, common: CommonContext): StoryOutline | null {
    const title = cap(String(raw.title ?? '').trim(), MAX_TITLE_LEN);
    if (!title) return null;

    const rawSP = typeof raw.storyPoints === 'number' ? raw.storyPoints : Number(raw.storyPoints);
    const storyPoints = (VALID_STORY_POINTS as readonly number[]).includes(rawSP) ? rawSP : 3;

    const podId = typeof raw.podId === 'string' ? raw.podId : '';

    const labels = Array.isArray(raw.labels)
      ? (raw.labels as unknown[])
          .filter((l): l is string => typeof l === 'string')
          .map((l) => l.slice(0, MAX_LABEL_LEN))
          .slice(0, MAX_LABELS)
      : [];

    const po = this.normalizePO(raw.po);
    const description = cap(
      typeof raw.description === 'string' && raw.description.trim()
        ? raw.description
        : po.userStory || po.objective,
    );

    void common; // accepted param, not used in normalize (fallback en emit)

    return { title, description, storyPoints, podId, labels, po };
  }

  private normalizePO(raw: unknown): StoryPOFields {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const whw = src.whatHowWhen;
    const whatHowWhen = whw && typeof whw === 'object' && !Array.isArray(whw)
      ? {
          what: cap(String((whw as any).what ?? ''), MAX_LIST_ITEM_LEN),
          how: cap(String((whw as any).how ?? ''), MAX_LIST_ITEM_LEN),
          when: cap(String((whw as any).when ?? ''), MAX_LIST_ITEM_LEN),
        }
      : { what: '', how: '', when: '' };

    const ac = Array.isArray(src.acceptanceCriteria)
      ? (src.acceptanceCriteria as unknown[])
          .map((item) => cap(String(item), MAX_LIST_ITEM_LEN))
          .filter((s) => s.trim().length > 0)
          .slice(0, MAX_LIST_SIZE)
      : typeof src.acceptanceCriteria === 'string'
        ? cap(String(src.acceptanceCriteria))
            .split('\n')
            .map((s) => cap(s.trim(), MAX_LIST_ITEM_LEN))
            .filter(Boolean)
            .slice(0, MAX_LIST_SIZE)
        : [];

    return {
      background: cap(String(src.background ?? '')),
      objective: cap(String(src.objective ?? '')),
      userStory: cap(String(src.userStory ?? '')),
      whatHowWhen,
      acceptanceCriteria: ac,
      additionalNotes: cap(String(src.additionalNotes ?? '')),
    };
  }

  private normalizeTechnical(raw: unknown): StoryTechnicalFields {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const toList = (val: unknown): string[] =>
      Array.isArray(val)
        ? (val as unknown[])
            .map((item) => cap(String(item), MAX_LIST_ITEM_LEN))
            .filter((s) => s.trim().length > 0)
            .slice(0, MAX_LIST_SIZE)
        : typeof val === 'string' && val.trim()
          ? cap(String(val))
              .split('\n')
              .map((s) => cap(s.trim(), MAX_LIST_ITEM_LEN))
              .filter(Boolean)
              .slice(0, MAX_LIST_SIZE)
          : [];

    return {
      architecture: cap(String(src.architecture ?? '')),
      integrationFlow: cap(String(src.integrationFlow ?? '')),
      validations: toList(src.validations),
      errorHandling: toList(src.errorHandling),
      implementationChecklist: toList(src.implementationChecklist),
    };
  }

  private normalizeQA(raw: unknown): StoryQAFields {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      testingStrategy: cap(String(src.testingStrategy ?? '')),
      linkedQAMatrixId: typeof src.linkedQAMatrixId === 'string' ? src.linkedQAMatrixId : null,
    };
  }

  private normalizeDependency(raw: Record<string, unknown>): DiscoveredDependency | null {
    const title = cap(String(raw.title ?? '').trim(), 300);
    if (!title) return null;
    const validSev: DependencySeverity[] = ['critical', 'high', 'medium', 'low'];
    const validTypes: DiscoveredDependencyType[] = ['api', 'service', 'data', 'team', 'other'];
    const severity = validSev.includes(raw.severity as DependencySeverity)
      ? (raw.severity as DependencySeverity)
      : 'medium';
    const type = validTypes.includes(raw.type as DiscoveredDependencyType)
      ? (raw.type as DiscoveredDependencyType)
      : 'other';
    return {
      id: `ai-dep-${randomUUID()}`,
      title,
      description: cap(String(raw.description ?? ''), MAX_LIST_ITEM_LEN),
      severity,
      type,
      mdContent: cap(String(raw.mdContent ?? ''), MAX_DEP_MD_LEN),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  //   HELPERS
  // ─────────────────────────────────────────────────────────────────────

  private async getInitiativeDocumentsMeta(
    initiativeId: string,
  ): Promise<Array<{ id: string; name: string; format: string; url?: string }>> {
    try {
      const row = await this.prisma.initiative.findUnique({
        where: { id: initiativeId },
        select: { documents: true },
      });
      const docs = Array.isArray(row?.documents) ? (row?.documents as any[]) : [];
      return docs.map((d) => ({
        id: String(d.id ?? ''),
        name: String(d.name ?? 'documento'),
        format: String(d.format ?? 'unknown'),
        url: typeof d.url === 'string' ? d.url : undefined,
      }));
    } catch {
      return [];
    }
  }

  private buildPOSystemPrompt(count: number | undefined, webSearch: boolean): string {
    const webStep = webSearch
      ? 'Puedes usar `web_search` si necesitas validar estandares externos o referencias de industria (maximo 3 usos).'
      : 'NO tienes acceso a `web_search`. Basate solo en tools locales.';

    // La directiva del numero de historias es dinamica:
    //  - Si el usuario paso un `count` via query param, lo tratamos como sugerencia
    //    (aproximadamente ±2) — el agente aun puede ajustar si el scope lo pide.
    //  - Si NO se paso count, el agente decide segun el alcance real de la epica.
    //    Esto es el comportamiento por defecto y se alinea con la intencion del
    //    usuario de "las que sean necesarias, no un numero fijo".
    const storyCountDirective = count
      ? `Apunta a aproximadamente ${count} historias (±2 si el scope real de la epica lo requiere). El usuario sugirio ese numero pero tu juicio de scope prevalece.`
      : `Redacta las historias NECESARIAS para cubrir el alcance completo de la epica — ni mas ni menos. Tipicamente 3-10 pero puede ser mas si el scope es extenso (limite duro 15 por presupuesto de tokens). NO fuerces un numero: ni dividas artificialmente en historias triviales, ni consolides scope en pocas historias gigantes.`;

    return `Eres un **Agente Product Owner** disenando historias de usuario orientadas a valor de negocio.

TU MISION: redactar outlines de historias a partir del contexto comun (epica + iniciativa). El output va LITERALMENTE al Agente Tech Lead — no disenes codigo ni tests.

## Numero de historias

${storyCountDirective}

## Que compones por historia

1. **title**: corto, accionable, especifico al contexto real de la epica.
2. **description**: 1-2 lineas.
3. **storyPoints**: Fibonacci {1, 2, 3, 5, 8, 13}. 13 solo si es realmente grande (prefiere dividir).
4. **podId**: UNO de los IDs listados en \`<pods_asignados_a_la_epica>\`. El que mas sentido tenga para el scope de esa historia.
5. **labels**: etiquetas tecnicas cortas (backend, api, frontend, mobile, data, etc.).
6. **po.background**: antecedentes reales — por que surge esta historia, que problema resuelve, referencias historicas si aplica.
7. **po.objective**: que valor entrega y para quien, una frase.
8. **po.userStory**: "Como [rol concreto, no generico], quiero [accion], para [beneficio medible]".
9. **po.whatHowWhen**: what = alcance del entregable; how = approach de alto nivel (sin detalle tecnico); when = fase/sprint.
10. **po.acceptanceCriteria**: minimo 3 criterios VERIFICABLES. Formato Gherkin ("Dado... Cuando... Entonces...") o bullets con metricas concretas.
11. **po.additionalNotes**: opcional — dependencias cruzadas, restricciones, riesgos.

## Documentos relevantes

Aparte de los outlines, identifica cuales de los documentos listados en \`<initiative_documents_available>\` son especialmente relevantes al conjunto de historias. Para cada uno, en \`relatedDocuments\`:
- docId, docName, bucketUrl — exactamente como se listo.
- relevanceSummary — 1-2 parrafos del por que aplica. No resumas el documento completo; solo el vinculo con las historias.

## Proceso

${webStep}

0. **Explora el vault de la epica (vault_glob > vault_grep > vault_read). MAX 3-4 tool calls antes del terminal — no sobre-explores.**
   - PRIMERO \`vault_glob\` con el path del folder de la epica (ver \`<epic_vault_files>\` para el folder base; si no hay, la epica no tiene artefactos en el vault todavia).
     Patron: \`"<folder-epica>/**/*.md"\` — descubre diagramas, matrices, deps y docs reales del vault.
   - LUEGO \`vault_grep\` con regex si los paths del glob mencionan terminos especificos de negocio de la epica (\`"(termino1|termino2|concepto)"\` con \`-i: true\`).
   - FINALMENTE \`vault_read\` SOLO con paths que devolvio \`vault_glob\` — nunca construyas ni infieras paths. Lee maximo 2-3 archivos (prioriza diagramas sobre matrices sobre documentos).
   - Si \`vault_glob\` retorna 0 archivos: no hay artefactos todavia, omite grep/read y salta al paso 1.
   - Si \`vault_read\` devuelve "File not found": NO reintentes el mismo path — abandona ese archivo.

1. Si hay documentos en la iniciativa, lista (\`read_initiative_documents\` sin documentId) y lee los que parezcan mas relevantes (con documentId).
2. Propon las historias respetando el alcance de la epica — no inventes alcance que no este en la epica.
3. Llama \`submit_po_outline\` UNA sola vez con stories[] y relatedDocuments[].

## Anti-patrones a evitar

- Historias genericas tipo "Configurar CI/CD" sin referencia al contexto real.
- acceptanceCriteria vagos ("debe funcionar bien").
- Inventar metricas sin base en los docs o codigo.
- Invadir trabajo del TL (arquitectura) o del QA (testing strategy).

Idioma: espanol.`;
  }

  private buildTLSystemPrompt(): string {
    return `Eres un **Agente Tech Lead** disenando la solucion tecnica de historias cuyo QUE ya fue definido por el PO.

TU MISION: para cada outline del PO (que recibes en el user message), escribe la seccion tecnica completa. El output va LITERALMENTE al Agente QA.

⚠️ PRESUPUESTO DE TOKENS: tienes 8192 tokens de salida TOTAL para los N designs. Eso es ~1500 tokens por historia si son 5. Se conciso. NO uses markdown decorativo (headings ##/###), NO repitas info entre campos, NO escribas parrafos largos cuando una lista alcanza.

## Que compones por historia (en technical)

1. **architecture** (max ~250 palabras): UN parrafo o lista corta. Incluye solo: capa/layer + proposito + dependencias clave + patron. NO uses headings markdown. Ejemplo conciso: "Microservicio NestJS en capa BFF. Proxy autenticado a /api/proyectos/*. Consume Auth0 (JWT) y Prisma (PG). Patron: stateless gateway."
2. **integrationFlow** (max ~200 palabras): secuencia numerada (1. ... 2. ...). Endpoint, payload, transformaciones, llamadas externas, response. Sin pseudocodigo extenso.
3. **validations** (lista 3-8 items): "campo: regla -> que pasa si falla". Una linea por item.
4. **errorHandling** (lista 4-8 items): "CODIGO: escenario -> ERR.X.Y". Una linea por item.
5. **implementationChecklist** (lista 5-10 items): pasos concretos, una linea cada uno. Ordenados por dependencia.

## Proceso

1. Explora el codigo de repos conectados (code_grep > code_read). MAX 3-4 tool calls antes del terminal — no sobre-explores.
2. Lee del vault solo si la epica menciona decisiones documentadas.
3. Para CADA outline (respetando outlineIndex), genera su design SIENDO CONCISO.
4. Llama \`submit_technical_designs\` UNA sola vez.

## Anti-patrones

- architecture con sub-headings ## o ### (consume tokens innecesariamente).
- Repetir info en multiples campos (ej. arquitectura de capa en architecture Y en integrationFlow).
- Listas con items de 50+ palabras cada uno (corta a 1-2 lineas por item).
- Tech generico sin referencia al codigo ("usa Kubernetes") cuando no esta en el stack.
- Cambiar alcance del outline. Tu trabajo es COMO, no QUE.

Idioma: espanol. Codigo en ingles si el repo lo usa asi.`;
  }

  private buildQASystemPrompt(): string {
    return `Eres un **Agente QA** disenando la estrategia de testing de historias cuyo PO y TL ya estan definidos.

TU MISION: para cada historia, redactar testingStrategy enfocada en PRUEBAS UNITARIAS e integracion a nivel de historia. Identificar dependencias transversales descubiertas.

⚠️ PRESUPUESTO: 16384 tokens TOTAL para N strategies + dependencies (donde N es el numero de historias que el PO propuso — puede ser 3, 8 o 15). ~1500-2500 tokens por testingStrategy. SE CONCISO — listas en vez de prosa, sin headings markdown decorativos. Cada bullet max 20 palabras.

## Que compones por historia (en qa.testingStrategy)

Markdown CORTO con estas 6 subsecciones (usa **bold** como label, no headings ##):

1. **Alcance**: clases/funciones a cubrir (lista 1 linea).
2. **Happy paths**: 3-5 casos breves (1 linea cada uno: "input X → output Y").
3. **Edge cases**: 5-8 escenarios (1 linea cada uno).
4. **Mocks**: dependencias mockeadas + comportamiento happy/fail (lista compacta).
5. **Cobertura**: porcentaje minimo + justificacion en 1 linea.
6. **Herramientas**: framework segun el stack detectado (1 linea).

EJEMPLO CONCISO de testingStrategy:
\`\`\`
**Alcance**: AnalysisController, AnalysisService, LLMClient, ValidationUtil.
**Happy paths**:
- POST /analyze con epica valida → 200 + outline JSON.
- LLMClient con response valido → outline parseado.
- ValidationUtil con storyPoints 5 → ok.
**Edge cases**:
- Body sin titulo → 400 + ERR.VALIDATION.MISSING_FIELD.
- LLM timeout → 504 + retry una vez.
- storyPoints fuera Fibonacci → 422.
- Response LLM no parseable → 502 + log.
- Input > 20k chars → 413.
**Mocks**: LLMClient (happy: outline JSON; fail: throw timeout). DB (happy: epic existe; fail: not found).
**Cobertura**: >=90% lineas (excluir DTOs).
**Herramientas**: Jest + ts-jest + supertest (detectado en repo).
\`\`\`

## Dependencias descubiertas (mdContent)

Cada una max ~150 palabras de mdContent. Solo info accionable: que es, impacto, estrategia mock, owner. NO repitas info entre deps.

Tipos:
- **api**: API externa.
- **service**: servicio interno.
- **data**: datos semilla.
- **team**: equipo/pod proveedor.
- **other**: otro.

## Proceso

1. Explora codigo MAX 3-4 tool calls (code_grep test/spec). No sobre-explores.
2. Para CADA historia, redacta testingStrategy CONCISA.
3. Identifica dependencias REALES (no genericas).
4. Llama \`submit_qa_strategies\` UNA sola vez.

## Anti-patrones

- testingStrategy con prosa larga (cada bullet > 30 palabras es excesivo).
- Headings ## dentro de testingStrategy (usa **bold** label).
- Inventar numeros sin base del codigo.
- Dependencias genericas ("depende de la DB") sin contexto especifico.
- Invadir trabajo del TL (arquitectura) o del PO (criterios).

Idioma: espanol. Nombres de frameworks/archivos en ingles.`;
  }

  private sanitizeToolArgs(input: Record<string, unknown>): Record<string, unknown> {
    return this.sanitizeToolArgValue(input) as Record<string, unknown>;
  }

  private sanitizeToolArgValue(val: unknown): unknown {
    if (typeof val === 'string') {
      const truncated = val.length > 100 ? val.slice(0, 100) + '\u2026' : val;
      return scrubSecrets(truncated);
    }
    if (Array.isArray(val)) {
      return val.map((item) => this.sanitizeToolArgValue(item));
    }
    if (val !== null && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(val as Record<string, unknown>)) {
        out[key] = this.sanitizeToolArgValue(inner);
      }
      return out;
    }
    return val;
  }

  private extractResultPreview(result: string): string | undefined {
    const preview = this.computeRawPreview(result);
    return preview === undefined ? undefined : scrubSecrets(preview);
  }

  private computeRawPreview(result: string): string | undefined {
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed.results) && parsed.results.length > 0) {
        return parsed.results
          .slice(0, 5)
          .map((r: Record<string, unknown>) => r.title || r.path || r.name || JSON.stringify(r).slice(0, 80))
          .join(' · ');
      }
      if (Array.isArray(parsed.documents) && parsed.documents.length > 0) {
        return parsed.documents
          .slice(0, 5)
          .map((d: Record<string, unknown>) => d.title || d.name || 'Documento')
          .join(' · ');
      }
      if (typeof parsed.content === 'string' && parsed.content.length > 0) {
        return parsed.content.slice(0, 300) + (parsed.content.length > 300 ? '…' : '');
      }
      const str = JSON.stringify(parsed);
      if (str.length > 2) return str.slice(0, 300) + (str.length > 300 ? '…' : '');
      return undefined;
    } catch {
      return result.slice(0, 300) + (result.length > 300 ? '…' : '');
    }
  }

  private getToolLabel(name: string): string {
    const labels: Record<string, string> = {
      code_glob: 'Buscando archivos de codigo',
      code_grep: 'Buscando en codigo',
      code_read: 'Leyendo codigo',
      vault_glob: 'Explorando Vault',
      vault_grep: 'Buscando en Vault',
      vault_read: 'Leyendo del Vault',
      web_search: 'Investigando en la web',
      read_initiative_documents: 'Leyendo documentos',
    };
    return labels[name] ?? name;
  }

  private summarizeToolResult(result: string): string {
    try {
      const parsed = JSON.parse(result);
      if (parsed.results) return `${parsed.results.length} resultados`;
      if (parsed.documents) return `${parsed.documents.length} documentos`;
      if (parsed.content) return `Contenido leido (${parsed.content.length} chars)`;
      return 'Completado';
    } catch {
      return 'Completado';
    }
  }

  private timeout(ms: number): Promise<never> & { clear: () => void } {
    let timerId: NodeJS.Timeout;
    const promise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error(`Tool timeout (${ms}ms)`)), ms);
    });
    (promise as any).clear = () => clearTimeout(timerId!);
    return promise as Promise<never> & { clear: () => void };
  }

  /** Preview corto del input del terminal tool para logging. */
  private summarizeTerminalInput(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'submit_po_outline': {
        const stories = Array.isArray(input.stories) ? (input.stories as any[]).length : 0;
        const docs = Array.isArray(input.relatedDocuments) ? (input.relatedDocuments as any[]).length : 0;
        return `stories=${stories} relatedDocuments=${docs}`;
      }
      case 'submit_technical_designs': {
        const designs = Array.isArray(input.designs) ? (input.designs as any[]).length : 0;
        return `designs=${designs}`;
      }
      case 'submit_qa_strategies': {
        const strategies = Array.isArray(input.strategies) ? (input.strategies as any[]).length : 0;
        const deps = Array.isArray(input.discoveredDependencies) ? (input.discoveredDependencies as any[]).length : 0;
        return `strategies=${strategies} discoveredDependencies=${deps}`;
      }
      default:
        return 'ok';
    }
  }
}
