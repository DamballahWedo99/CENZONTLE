import type {
  TrackerReference,
  IntegrationProvider,
  StoryTechnicalDependency,
} from '@cenzontle/shared';

export interface InitiativePayload {
  id: string;
  name: string;
  description: string;
  /** Opcional: una iniciativa en planning puede no tener fechas comprometidas todavía. */
  startDate: Date | null;
  /** Opcional: una iniciativa en planning puede no tener fechas comprometidas todavía. */
  targetDate: Date | null;
  status: string;
}

export interface EpicDependencyPayload {
  title?: string;
  vendor?: string;
  type?: string;
  severity?: string;
  description?: string;
}

export interface EpicPayload {
  id: string;
  title: string;
  /**
   * Markdown único de la épica — reemplaza los 12 campos narrativos del shape
   * v1 (description, qualitativeBenefits, scopeDescription, etc.). El provider
   * pasa este markdown literal a Linear con sanitización (strip HTML tags +
   * length cap) — no parsea sub-secciones.
   */
  markdown?: string;
  priority: string | null | undefined;
  startDate: Date;
  targetDate: Date;
  // Dependencias técnicas detectadas (manuales o del vault)
  dependencies?: EpicDependencyPayload[];
  stories: Array<StoryPayload>;
}

/**
 * Contenido de una historia leído del vault. A partir de v2 (refactor Jira-style)
 * cada sección es un único string markdown. Los headings obligatorios viven
 * dentro del markdown — no son campos discretos.
 */
export interface StoryContentSection {
  po?: { markdown?: string };
  technical?: { markdown?: string };
  qa?: { markdown?: string };
}

export interface StoryPayload {
  id: string;
  title: string;
  storyPoints: number;
  labels: string[];
  /** Contenido completo de la historia leído del vault (PO + Technical + QA). */
  content?: StoryContentSection | null;
  /**
   * Dependencias técnicas a nivel historia (APIs, secrets, fixtures, etc.)
   * Cada dep se renderiza dentro del body del Issue agrupada por categoría.
   * Reemplaza el rol que tenía la sección "🔗 Dependencias detectadas" del
   * Project en versiones previas.
   */
  technicalDependencies?: StoryTechnicalDependency[];
}

/** Edge del DAG story↔story que se materializa como Linear IssueRelation. */
export interface StoryHardEdge {
  blockedExternalId: string;
  blockingExternalId: string;
}

export interface PublishStoryRelationsResult {
  ok: number;
  failed: Array<{
    blockedExternalId: string;
    blockingExternalId: string;
    error: string;
  }>;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  details?: { user?: string; workspace?: string };
}

/**
 * Resultado de publicar una épica + sus historias. La épica se materializa
 * como Linear Project (no Issue), y las historias como Issues sueltos dentro
 * de ese Project (sin parentId — sub-issues los crean los agentes después).
 */
export interface PublishEpicResult {
  /** Tracker reference apuntando al Linear Project creado para la épica. */
  epicTracker: TrackerReference;
  /** Trackers de las historias publicadas como Issues del Project. */
  storyTrackers: Array<{ storyId: string; tracker: TrackerReference }>;
  /** Historias que fallaron individualmente — el Project + las que pasaron se persisten igual. */
  partialFailures: Array<{ storyId: string; error: string }>;
}

export interface TrackerProvider {
  readonly providerName: IntegrationProvider;
  testConnection(): Promise<TestConnectionResult>;

  /** Crea la entidad de alto nivel (Linear Initiative). */
  publishInitiative(initiative: InitiativePayload): Promise<TrackerReference>;

  /**
   * Crea el agregado de trabajo (Linear Project) para la épica + sus issues.
   * Si `initiativeExternalId` viene, asocia el Project a esa Initiative
   * (Linear lo modela con la tabla pivote InitiativeToProject).
   */
  publishEpic(
    epic: EpicPayload,
    opts?: { initiativeExternalId?: string },
  ): Promise<PublishEpicResult>;

  /**
   * Crea una historia individual como Linear Issue dentro del Project de la
   * épica padre. `projectExternalId` es OBLIGATORIO — si la épica padre no
   * tiene Project, primero hay que publicar la épica.
   */
  publishStory(
    story: StoryPayload,
    opts: { projectExternalId: string },
  ): Promise<TrackerReference>;

  /**
   * Crea relaciones de bloqueo entre Issues recién publicados. Linear modela
   * dependencias issue↔issue nativamente vía `IssueRelation type='blocks'`.
   * Failures individuales no abortan el resto — se reportan en `failed`.
   * Solo procesa edges hard del DAG; los soft quedan como referencia textual.
   */
  publishStoryRelations(edges: StoryHardEdge[]): Promise<PublishStoryRelationsResult>;
}
