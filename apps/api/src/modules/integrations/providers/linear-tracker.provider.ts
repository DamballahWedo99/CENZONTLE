import {
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import { LinearClient, IssueRelationType } from '@linear/sdk';
import type {
  TrackerReference,
  LinearConfig,
  StoryTechnicalDependency,
  StoryTechnicalDependencyCategory,
} from '@cenzontle/shared';
import type {
  TrackerProvider,
  TestConnectionResult,
  PublishEpicResult,
  EpicPayload,
  InitiativePayload,
  StoryPayload,
  StoryHardEdge,
  PublishStoryRelationsResult,
} from './tracker-provider.interface';

/**
 * Labels human-readable por categoría unificada para renderizar en el body
 * del Linear Issue. Coherente con CATEGORY_CONFIG del frontend.
 */
const CATEGORY_LABELS: Record<StoryTechnicalDependencyCategory, string> = {
  secrets: '🔑 Secrets y credenciales',
  apis: '🔌 APIs e integraciones',
  testing: '🧪 Testing y datos',
  services: '⚙️ Servicios técnicos',
  teams: '👥 Equipos y cross-team',
  knowledge: '📚 Conocimiento',
  other: '🧩 Otras',
};

export class LinearTrackerProvider implements TrackerProvider {
  readonly providerName = 'linear' as const;
  private readonly client: LinearClient;
  // Logger local — esta clase NO es @Injectable. Se instancia con `new` desde
  // TrackerProviderFactory cada vez que el caller necesita un cliente fresh
  // (la API key puede rotarse, no cacheamos). Como no pasa por DI no podemos
  // inyectar PinoLogger; usamos el legacy Logger que igual sale como JSON
  // via el useLogger global del bootstrap (pino transport).
  private readonly logger = new Logger(LinearTrackerProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly config: LinearConfig,
  ) {
    this.client = new LinearClient({ apiKey });
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const viewer = await this.client.viewer;
      const team = await this.client.team(this.config.teamId);
      return {
        ok: true,
        details: { user: viewer.email ?? viewer.name, workspace: team.name },
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Error desconocido';
      return { ok: false, error: this.sanitizeLinearError(raw) };
    }
  }

  /**
   * Crea una Linear Initiative — la entidad de alto nivel cross-team que
   * agrupa Projects (épicas). Linear's Initiative NO tiene `startDate`,
   * solo `targetDate` (TimelessDate).
   */
  async publishInitiative(initiative: InitiativePayload): Promise<TrackerReference> {
    try {
      // Linear's `description` es el SUMMARY corto (≤255 chars, aparece como
      // subtítulo y en listas). El body markdown completo va en `content`.
      const fullDescription = this.escapeMarkdown(initiative.description);
      const result = await this.client.createInitiative({
        name: initiative.name,
        description: this.buildShortSummary(fullDescription),
        content: fullDescription.slice(0, 50_000),
        targetDate: this.toTimelessDate(initiative.targetDate),
      });
      const node = await result.initiative;
      if (!node) {
        throw new BadGatewayException(
          'Linear no devolvió la initiative tras la creación',
        );
      }
      // Linear Initiatives no tienen `identifier` ni `url` directo en la response
      // del payload create — construimos la URL desde el slug + initiative slug/id.
      return {
        provider: 'linear',
        externalId: node.id,
        externalKey: node.id.slice(0, 8),
        externalUrl: `https://linear.app/${this.config.workspaceSlug}/initiative/${node.slugId ?? node.id}`,
      };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      this.logger.error({ raw }, `[publishInitiative] Linear createInitiative failed: ${raw}`);
      throw new BadGatewayException(
        `Linear rechazó la creación de la initiative: ${this.sanitizeLinearError(raw)}`,
      );
    }
  }

  /**
   * Crea un Linear Project para la épica y sus issues. Si `initiativeExternalId`
   * viene, asocia el Project a la Initiative via `createInitiativeToProject`
   * (best-effort — un fallo en la asociación NO invalida el Project creado).
   */
  async publishEpic(
    epic: EpicPayload,
    opts?: { initiativeExternalId?: string },
  ): Promise<PublishEpicResult> {
    const fullMarkdown = this.buildEpicDescription(epic);
    // El summary corto sale del primer párrafo del markdown (típicamente la
    // sección "## Descripción") o del título como fallback. Strip headings y
    // markdown estructural para que Linear muestre prosa limpia en la vista
    // resumida del Project.
    const summary = this.buildShortSummary(this.extractEpicSummary(epic));
    // Sin inicializador: el catch de abajo siempre lanza, así que `project`
    // está asignado en todo camino que llegue a usarlo.
    let project: { id: string; url: string; name: string };
    try {
      const result = await this.client.createProject({
        name: epic.title,
        description: summary,
        content: fullMarkdown.slice(0, 50_000),
        teamIds: [this.config.teamId],
        priority: this.mapPriority(epic.priority),
        startDate: this.toTimelessDate(epic.startDate),
        targetDate: this.toTimelessDate(epic.targetDate),
      });
      const node = await result.project;
      if (!node) {
        throw new BadGatewayException(
          'Linear no devolvió el project tras la creación',
        );
      }
      project = { id: node.id, url: node.url, name: node.name };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      this.logger.error({ raw }, `[publishEpic] Linear createProject failed: ${raw}`);
      throw new BadGatewayException(
        `Linear rechazó la creación del project de la épica: ${this.sanitizeLinearError(raw)}`,
      );
    }

    // Best-effort: asociar el Project a la Initiative. Si falla, loggeamos
    // pero seguimos — el Project ya existe y los issues pueden crearse sin
    // la asociación (queda como deuda visible para que el user la haga manual).
    if (opts?.initiativeExternalId) {
      try {
        await this.client.createInitiativeToProject({
          initiativeId: opts.initiativeExternalId,
          projectId: project.id,
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[publishEpic] failed to link project=${project.id} → initiative=${opts.initiativeExternalId}: ${this.sanitizeLinearError(raw)}`,
        );
      }
    }

    const epicTracker: TrackerReference = {
      provider: 'linear',
      externalId: project.id,
      externalKey: project.name.slice(0, 50),
      externalUrl: project.url,
    };

    const storyTrackers: PublishEpicResult['storyTrackers'] = [];
    const partialFailures: PublishEpicResult['partialFailures'] = [];

    for (const story of epic.stories) {
      try {
        const tracker = await this.publishStory(story, {
          projectExternalId: project.id,
        });
        storyTrackers.push({ storyId: story.id, tracker });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[publishEpic] story ${story.id} (${story.title}) failed: ${raw}`,
        );
        partialFailures.push({
          storyId: story.id,
          error: this.sanitizeLinearError(raw),
        });
      }
    }

    return { epicTracker, storyTrackers, partialFailures };
  }

  /**
   * Crea un Linear Issue dentro de un Project. El `projectExternalId` es
   * obligatorio para mantener la jerarquía Initiative → Project → Issue.
   * NO se crean sub-issues (parentId) — los agentes lo harán después.
   */
  /**
   * Crea relaciones de bloqueo nativas en Linear para los edges hard del DAG.
   * Failures individuales NO abortan — se reportan en `failed[]` para que el
   * caller pueda mostrar warning sin romper el publish completo.
   */
  async publishStoryRelations(
    edges: StoryHardEdge[],
  ): Promise<PublishStoryRelationsResult> {
    const failed: PublishStoryRelationsResult['failed'] = [];
    let ok = 0;
    for (const edge of edges) {
      try {
        await this.client.createIssueRelation({
          issueId: edge.blockedExternalId,
          relatedIssueId: edge.blockingExternalId,
          type: IssueRelationType.Blocks,
        });
        ok += 1;
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const sanitized = this.sanitizeLinearError(raw);
        this.logger.warn(
          `[publishStoryRelations] failed edge blocked=${edge.blockedExternalId} blocking=${edge.blockingExternalId}: ${raw}`,
        );
        failed.push({
          blockedExternalId: edge.blockedExternalId,
          blockingExternalId: edge.blockingExternalId,
          error: sanitized,
        });
      }
    }
    return { ok, failed };
  }

  async publishStory(
    story: StoryPayload,
    opts: { projectExternalId: string },
  ): Promise<TrackerReference> {
    const description = this.buildStoryDescription(story);
    try {
      const result = await this.client.createIssue({
        teamId: this.config.teamId,
        projectId: opts.projectExternalId,
        title: story.title,
        // Linear acepta description hasta el límite de TEXT en Postgres
        // (~65535). Cortamos a 50K como margen de seguridad — suficiente
        // para historias muy bien documentadas (PO + Technical + QA combinados).
        description: description.slice(0, 50_000),
        estimate: story.storyPoints > 0 ? story.storyPoints : undefined,
      });
      const issue = await result.issue;
      if (!issue) {
        throw new BadGatewayException(
          `Linear no devolvió el issue tras crear la historia ${story.id}`,
        );
      }
      return {
        provider: 'linear',
        externalId: issue.id,
        externalKey: issue.identifier,
        externalUrl: issue.url,
      };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(
        `Linear rechazó la creación de la historia ${story.id}: ${this.sanitizeLinearError(raw)}`,
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Extrae un summary corto del epic.markdown. Busca el primer párrafo no-vacío
   * después del heading `## Descripción`, o el primer párrafo de cualquier
   * heading si Descripción no existe. Fallback al título si el markdown está
   * vacío. Strip de markdown structural para que Linear muestre prosa limpia.
   */
  private extractEpicSummary(epic: EpicPayload): string {
    const md = (epic.markdown ?? '').trim();
    if (!md) return this.escapeMarkdown(epic.title);
    const descMatch = md.match(/^##\s+Descripción\s*\n+([\s\S]*?)(?=\n##\s|$)/m);
    const firstParaMatch = md.match(/^##\s+\S[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/m);
    const block = (descMatch?.[1] ?? firstParaMatch?.[1] ?? md).trim();
    // Quita marcadores de listas, bold, etc. para sumario plano.
    const plain = block
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/[*_`]/g, '');
    return this.escapeMarkdown(plain);
  }

  private buildEpicDescription(epic: EpicPayload): string {
    const sections: string[] = [];

    // En v2 la épica es un único string markdown con headings dictados por el
    // prompt al agente IA. Lo passthrough sin reconstruir secciones, pero strip
    // HTML tags como defense-in-depth contra XSS (mismo patrón que las
    // historias en buildStoryDescription).
    const epicMd = epic.markdown?.trim();
    if (epicMd) {
      sections.push(this.capSection(this.stripHtmlTags(epicMd), 30_000));
    }

    // Las dependencias técnicas viven a nivel historia (en cada Issue), no aquí.
    // Las relaciones de bloqueo entre historias se materializan como Linear
    // IssueRelations nativas (ver `publishStoryRelations`), visibles en el
    // panel "Blocks" / "Blocked by" de cada Issue.

    sections.push(
      `---\n_Sincronizado desde CENZONTLE — épica id \`${epic.id}\`. Cada historia contiene su definición de negocio, solución técnica, testing strategy y dependencias técnicas. Las relaciones de bloqueo (DAG hard) viven nativamente en Linear bajo "Blocks" / "Blocked by" de cada Issue._`,
    );
    const joined = sections.join('\n\n');
    // Cap defensivo total: Linear soporta bodies grandes pero degrada el
    // renderer. 45K es coherente con el cap aplicado a buildStoryDescription.
    return joined.length > 45_000
      ? `${joined.slice(0, 45_000)}\n\n_[Truncado por longitud — ver épica completa en CENZONTLE]_`
      : joined;
  }

  /**
   * Strip de tags HTML peligrosas en markdown. Defense-in-depth contra XSS:
   * el frontend Tiptap ya bloquea `html: true`, pero un agente IA o un
   * file vault editado fuera del flujo podrían introducir `<script>`,
   * `<img onerror>`, `<iframe>`, etc. Linear sanitiza su renderer pero el
   * body se propaga a webhook subscribers y email notifications que
   * históricamente renderizan HTML.
   *
   * Estrategia: eliminamos cualquier tag HTML completo (`<...>`). Mantenemos
   * el texto interno. No aplicamos `escapeMarkdown` porque romperíamos los
   * headings/links/listas legítimos del markdown user-facing.
   */
  private stripHtmlTags(input: string): string {
    return input.replace(/<[^>]*>/g, '');
  }

  /**
   * Cap por sección antes de juntar. Sin esto, una sección muy larga
   * podría consumir el budget total del body de Linear y descartar las
   * otras secciones silenciosamente al aplicar el cap final.
   * 12K × 3 secciones = 36K, dejando ~9K para deps + footer dentro del
   * cap total de 45K aplicado al final de buildStoryDescription.
   */
  private capSection(md: string, maxLen = 12_000): string {
    if (md.length <= maxLen) return md;
    return `${md.slice(0, maxLen)}\n\n_[Sección truncada por longitud — ver historia completa en CENZONTLE]_`;
  }

  private buildStoryDescription(story: StoryPayload): string {
    const sections: string[] = [];
    const content = story.content ?? null;

    // ── DEFINICIÓN DE NEGOCIO (PO) ──────────────────────────────────
    // En v2 el contenido es un único string markdown con headings dictados
    // por el prompt al agente IA. Lo passthrough (sin reconstruir secciones)
    // pero strip HTML tags + cap per section como defense-in-depth.
    const poMd = content?.po?.markdown?.trim();
    if (poMd) {
      sections.push(`## 📋 Definición de negocio\n\n${this.capSection(this.stripHtmlTags(poMd))}`);
    }

    // ── SOLUCIÓN TÉCNICA (TL) ───────────────────────────────────────
    const techMd = content?.technical?.markdown?.trim();
    if (techMd) {
      sections.push(`## 🛠️ Solución técnica\n\n${this.capSection(this.stripHtmlTags(techMd))}`);
    }

    // ── ESTRATEGIA DE TESTING (QA) ──────────────────────────────────
    const qaMd = content?.qa?.markdown?.trim();
    if (qaMd) {
      sections.push(`## 🧪 Estrategia QA\n\n${this.capSection(this.stripHtmlTags(qaMd))}`);
    }

    // ── DEPENDENCIAS TÉCNICAS ─────────────────────────────────────────
    // Agrupadas por categoría unificada (secrets, apis, testing, services,
    // teams, knowledge, other) — coherente con la categorización del frontend
    // EpicDependencies.tsx CATEGORY_CONFIG.
    const techDeps = story.technicalDependencies ?? [];
    if (techDeps.length > 0) {
      const grouped = this.groupDependenciesByCategory(techDeps);
      const blocks = (Object.keys(grouped) as StoryTechnicalDependencyCategory[])
        .map((cat) => {
          const items = grouped[cat];
          if (!items || items.length === 0) return null;
          const label = CATEGORY_LABELS[cat];
          const lines = items
            .map((d) => {
              const sev = d.severity ? ` [${d.severity.toUpperCase()}]` : '';
              const vendor = d.vendor ? ` — ${this.escapeMarkdown(d.vendor)}` : '';
              const blocking = d.isBlocking ? ' ⚠️ Bloqueante' : '';
              const credential = d.requiresCredential ? ' 🔑 Requiere credencial' : '';
              const title = d.title ? this.escapeMarkdown(d.title) : '_(sin título)_';
              const escapedDesc = d.description
                ? this.escapeMarkdown(d.description)
                : '';
              const desc = escapedDesc
                ? `\n  ${escapedDesc.slice(0, 300)}${escapedDesc.length > 300 ? '…' : ''}`
                : '';
              return `- **${title}**${vendor}${sev}${blocking}${credential}${desc}`;
            })
            .join('\n');
          return `### ${label}\n\n${lines}`;
        })
        .filter((s): s is string => s !== null);
      if (blocks.length > 0) {
        sections.push(`## 🔗 Dependencias técnicas\n\n${blocks.join('\n\n')}`);
      }
    }

    if (story.labels.length > 0) {
      const labels = story.labels.map((l) => this.escapeMarkdown(l)).join(', ');
      sections.push(`**Labels:** ${labels}`);
    }

    sections.push(
      `---\n_Sincronizado desde CENZONTLE — story id \`${story.id}\`._`,
    );
    // Defense-in-depth: cap total a ~45KB. Linear acepta bodies más grandes
    // pero degrada el renderer y los webhook subscribers manejan mejor payloads
    // chicos. 3 secciones × MAX_STORY_MARKDOWN_LEN (60K) + deps + footer puede
    // exceder fácilmente este límite.
    const joined = sections.join('\n\n');
    return joined.length > 45_000
      ? `${joined.slice(0, 45_000)}\n\n_[Truncado por longitud — ver historia completa en CENZONTLE]_`
      : joined;
  }

  /**
   * Agrupa dependencias por su categoría unificada para renderizar bloques
   * separados en el body del Issue. Mantiene el orden definido en CATEGORY_LABELS.
   */
  private groupDependenciesByCategory(
    deps: StoryTechnicalDependency[],
  ): Partial<Record<StoryTechnicalDependencyCategory, StoryTechnicalDependency[]>> {
    const grouped: Partial<Record<StoryTechnicalDependencyCategory, StoryTechnicalDependency[]>> = {};
    for (const dep of deps) {
      const cat = dep.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat]!.push(dep);
    }
    return grouped;
  }

  // `extractWhatHowWhen` y `toListMarkdown` se eliminaron en el refactor v2.
  // En v2 las 3 secciones (PO/Technical/QA) son markdown libre con headings
  // dictados por el prompt — el provider hace passthrough sin reconstruir
  // sub-secciones desde campos discretos.

  /**
   * Convierte una `Date` (o null) a TimelessDate (formato `YYYY-MM-DD`) que
   * Linear exige en startDate/targetDate. Linear NO acepta ISO datetime con
   * hora — usar `toISOString()` directo arroja "Invalid TimelessDate".
   *
   * Si la fecha es null (iniciativa en planning sin compromiso temporal),
   * retorna `undefined` para que el campo se omita del payload de Linear
   * — Linear acepta sin targetDate y simplemente no muestra fecha objetivo.
   */
  private toTimelessDate(d: Date | null | undefined): string | undefined {
    if (!d) return undefined;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Construye un summary corto (max 250 chars) para `Project.description` y
   * `Initiative.description`, que Linear limita a 255. Toma el primer párrafo
   * del input o trunca con elipsis. El body completo va aparte en `content`.
   */
  private buildShortSummary(input: string): string {
    if (!input) return '';
    const firstParagraph = input.split('\n\n')[0]?.trim() ?? input;
    const oneLineForm = firstParagraph.replace(/\n/g, ' ').trim();
    if (oneLineForm.length <= 250) return oneLineForm;
    return oneLineForm.slice(0, 247) + '...';
  }

  private mapPriority(priority: string | null | undefined): number {
    if (!priority) return 0;
    switch (priority.toLowerCase()) {
      case 'urgent':
      case 'critical':
        return 1;
      case 'high':
        return 2;
      case 'medium':
        return 3;
      case 'low':
        return 4;
      default:
        return 0;
    }
  }

  private sanitizeLinearError(raw: string): string {
    if (!raw) return 'Error desconocido contactando Linear';
    const beforeJson = raw.split(': {')[0]?.trim() ?? raw;
    const firstLine = beforeJson.split('\n')[0]?.trim() ?? beforeJson;
    const truncated = firstLine.slice(0, 200);
    return truncated || 'Error desconocido contactando Linear';
  }

  private escapeMarkdown(input: string): string {
    return input
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/`/g, '\\`')
      .replace(/^#/gm, '\\#');
  }
}
