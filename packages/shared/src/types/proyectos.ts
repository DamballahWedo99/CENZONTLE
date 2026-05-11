import type { TrackerReference } from './factory';

// === ENUMS ===

export enum InitiativeStatus {
  Planning = 'planning',
  Active = 'active',
  Completed = 'completed',
  OnHold = 'on_hold',
}

export enum EpicStatus {
  Draft = 'draft',
  InProgress = 'in_progress',
  Done = 'done',
  Blocked = 'blocked',
}

export enum StoryStatus {
  Backlog = 'backlog',
  ToDo = 'to_do',
  InProgress = 'in_progress',
  InReview = 'in_review',
  QA = 'qa',
  Done = 'done',
  Blocked = 'blocked',
}

export enum Priority {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

export enum SprintStatus {
  Planning = 'planning',
  Active = 'active',
  Completed = 'completed',
}

export enum ChangelogAction {
  Created = 'created',
  Updated = 'updated',
  Deleted = 'deleted',
  Moved = 'moved',
  Reassigned = 'reassigned',
  Approved = 'approved',
  Rejected = 'rejected',
}

export enum ChangelogEntityType {
  Initiative = 'initiative',
  Epic = 'epic',
  Story = 'story',
}

// === EPIC MARKDOWN STRUCTURE ===

/**
 * Headings level-2 obligatorios en el markdown único de una épica.
 * Single source of truth para:
 *  - Backend: validación pre-aprobación en `epics.service.ts → assertEpicReadyForApproval`.
 *  - Frontend: cálculo del checklist (Definición completa N/9) en `EpicFullPage.tsx`.
 *  - Editor: placeholder de la épica nueva (EPIC_MARKDOWN_PLACEHOLDER reusa estos).
 *  - Agente IA: prompt al generador exige emitir estos headings.
 *
 * Si añades/quitas un heading, los 4 callsites se actualizan automáticamente.
 *
 * Comparación recomendada: usar `epicMarkdownHasAllHeadings()` que aplica
 * regex exact-match — `markdown.includes(heading)` produce falsos positivos
 * (`## Alcance de negocio` matchea `## Alcance`).
 */
export const REQUIRED_EPIC_HEADINGS: readonly string[] = [
  '## Objetivo',
  '## Beneficios cualitativos',
  '## Beneficios cuantitativos',
  '## Medición de beneficios',
  '## Alcance',
  '## Criterios de aceptación',
  '## Mejoras tecnológicas',
  '## Canales y flujos impactados',
  '## Dependencias de terceros',
];

/**
 * Cuenta cuántos headings obligatorios están presentes en el markdown.
 * Usado por el frontend para mostrar progreso (N/9). El backend sólo
 * necesita el predicado boolean — usa `epicMarkdownHasAllHeadings()`.
 *
 * Match exact-line: el heading debe aparecer al inicio de línea seguido
 * por whitespace o fin de string. Esto rechaza:
 *  - `## Alcance de negocio` matcheando `## Alcance` (substring trap).
 *  - `Subheader: ## Alcance` matcheando (anchor de inicio de línea).
 *
 * Case-insensitive porque el editor humano puede tipear con capitalización
 * libre. Los headings emitidos por el agente IA respetan la capitalización
 * canónica, pero la validación no debe ser frágil a eso.
 */
export function epicMarkdownHeadingsPresent(
  markdown: string | null | undefined,
): readonly string[] {
  if (!markdown) return [];
  return REQUIRED_EPIC_HEADINGS.filter((heading) => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|\\n)${escaped}(\\s|$)`, 'i');
    return re.test(markdown);
  });
}

/**
 * Predicate boolean — épica está "definicionalmente completa" si tiene
 * los 9 headings obligatorios. NO valida contenido bajo cada heading
 * (eso es responsabilidad del agente generador y del editor humano).
 */
export function epicMarkdownHasAllHeadings(
  markdown: string | null | undefined,
): boolean {
  return epicMarkdownHeadingsPresent(markdown).length === REQUIRED_EPIC_HEADINGS.length;
}

// === DIAGRAM TYPES ===

export type DiagramNodeType =
  | 'service'
  | 'database'
  | 'queue'
  | 'gateway'
  | 'external'
  | 'client'
  | 'process'
  | 'decision'
  | 'actor'
  // `reference` es un "jump connector" — par de círculos con la misma letra
  // (A/B/C…) que parten un edge largo en dos segmentos cortos. Se crea en
  // el frontend post-layout (ver `insertJumpConnectors` en useGroupedLayout)
  // y se persiste como nodo real para que el user pueda moverlo/renombrarlo.
  // El LLM del backend NO debe generar este tipo — solo aparece como
  // resultado del pipeline de rendering, nunca como salida del agente.
  | 'reference';

/**
 * Agrupamiento visual del nodo — el viewer lo usa para clustering (swim lanes).
 * Si falta, el backend lo auto-asigna por heurística basada en DiagramNodeType.
 *
 * Son 7 layers arquitectónicos. `decision` y `external` son TIPOS de nodo,
 * no layers: un rombo de decisión hereda la capa donde vive su lógica
 * (normalmente backend); un integrador externo es un layer aparte aunque el
 * tipo del nodo también se llame `external`.
 */
export type DiagramNodeGroup =
  | 'start'
  | 'end'
  | 'frontend'
  | 'backend'
  | 'data'
  | 'infra'
  | 'external';

/**
 * Lista canónica de los grupos actuales. Usado para validación en backend
 * (`VALID_GROUPS`), filtrado defensivo en el theme service y como single
 * source of truth que el `DiagramNodeGroup` union debería espejar.
 */
export const DIAGRAM_NODE_GROUPS: readonly DiagramNodeGroup[] = [
  'start',
  'end',
  'frontend',
  'backend',
  'data',
  'infra',
  'external',
];

/**
 * Máximo de caracteres en un edge label — el viewer trunca con `…` si excede.
 * El backend validator (`diagram-generation.service.ts`) y el frontend
 * `ValidationPanel` usan este mismo valor para enforcement consistente.
 */
export const DIAGRAM_EDGE_LABEL_MAX_CHARS = 12;

/**
 * Labels de edge prohibidos por demasiado genéricos. C4 model y el análisis
 * de best practices 2026 (icepanel top-mistakes) coinciden: un label como
 * "uses" es equivalente a no tener label — el lector sigue sin saber si es
 * un call, un read, un publish, etc.
 *
 * Mantener corto y conservador — solo tokens inequívocamente no informativos.
 * Labels legítimos cortos ("SI", "NO", "GET", "JWT") NO están aquí porque
 * sí comunican algo específico (rama, verbo HTTP, mecanismo de autenticación).
 *
 * La lista es `ReadonlySet<string>` para lookup O(1) en hot path. El
 * validator en backend y el ValidationPanel en frontend ambos normalizan
 * el input con `.toLowerCase().trim()` antes de consultar.
 */
export const TRIVIAL_DIAGRAM_EDGE_LABELS: ReadonlySet<string> = new Set([
  'uses',
  'usa',
  'utiliza',
  'use',
  '-',
  '.',
  '->',
  '→',
  'x',
  'arrow',
  'edge',
  'link',
  'flow',
]);

/**
 * Grupos legacy (`decision`, `alt`) del schema anterior a la reducción 9→7.
 * Aún pueden vivir en:
 *   - Diagramas cacheados en Redis (TTL 5 días) emitidos antes del cambio.
 *   - Filas de `diagram_theme_settings.groupColors` (JSONB tolera keys extra).
 *
 * Los normalizamos al leer (`migrateLegacyGroup`) y al escribir
 * (`migrateLegacyDiagramGroups`) para garantizar que la UI nunca reciba un
 * valor fuera del union actual.
 *
 * `decision`/`alt` → `backend` porque los rombos y caminos alternativos
 * típicamente viven en la capa de lógica de servidor.
 */
export const LEGACY_DIAGRAM_GROUP_MAP: Record<string, DiagramNodeGroup> = {
  decision: 'backend',
  alt: 'backend',
};

/**
 * Mapea un valor legacy de `group` al valor canónico actual. Si el input
 * ya es un grupo válido, lo retorna sin cambios. Si es desconocido, retorna
 * `undefined` — el caller decide el fallback (típicamente `'backend'`).
 */
export function migrateLegacyGroup(group: string | undefined | null): DiagramNodeGroup | undefined {
  if (!group) return undefined;
  if ((DIAGRAM_NODE_GROUPS as readonly string[]).includes(group)) {
    return group as DiagramNodeGroup;
  }
  return LEGACY_DIAGRAM_GROUP_MAP[group];
}

/**
 * Aplica `migrateLegacyGroup` a cada nodo de un diagrama — helper para el
 * cache service en el backend. Retorna un diagrama nuevo (no muta el input)
 * con `node.group` normalizado al union actual. Nodos con grupo desconocido
 * conservan el valor original para no enmascarar bugs upstream.
 */
export function migrateLegacyDiagramGroups<T extends EpicDiagram>(diagram: T): T {
  const nodes = diagram.nodes.map((n) => {
    const migrated = migrateLegacyGroup(n.group);
    return migrated && migrated !== n.group ? { ...n, group: migrated } : n;
  });
  return { ...diagram, nodes };
}

/**
 * Filtra un objeto `groupColors` (puede venir de DB con keys legacy) al
 * shape actual — solo conserva las 7 claves válidas. Usado en
 * `diagram-theme-settings.service.toPublic()` para evitar que claves
 * `decision`/`alt` escapen al frontend con un tipo más ancho del declarado.
 */
export function filterDiagramGroupColors(raw: Record<string, unknown>): Partial<DiagramGroupColors> {
  const out: Partial<DiagramGroupColors> = {};
  for (const key of DIAGRAM_NODE_GROUPS) {
    const value = raw[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Configuración de colores por grupo semántico de nodos. Hex strings.
 * Cada organización (single-org actualmente) tiene un único set.
 */
export type DiagramGroupColors = Record<DiagramNodeGroup, string>;

export const DEFAULT_DIAGRAM_GROUP_COLORS: DiagramGroupColors = {
  start: '#6366f1',    // indigo (nodo inicial)
  end: '#10b981',      // emerald (terminal)
  frontend: '#38bdf8', // sky (UI, web, móvil)
  backend: '#a855f7',  // violet (microservicios)
  data: '#f59e0b',     // amber (DBs, colas)
  infra: '#94a3b8',    // slate (gateways, CDNs)
  external: '#f43f5e', // rose (terceros)
};

/**
 * Colores de texto dentro de cada nodo (título grande y descripción pequeña).
 * Son GLOBALES al diagrama — no por grupo — para evitar un panel de config
 * abrumador (14 controles). Los defaults son un white+zinc-200 que trabaja
 * bien contra los 7 fondos por grupo.
 */
export type DiagramTextColors = {
  /** Color hex del TÍTULO dentro de cada nodo (ej: "Frontend App"). */
  title: string;
  /** Color hex de la DESCRIPCIÓN (texto pequeño debajo del título). */
  description: string;
};

export const DEFAULT_DIAGRAM_TEXT_COLORS: DiagramTextColors = {
  title: '#ffffff',
  // zinc-200 — mucho más contraste que el zinc-400 hardcodeado previo.
  // Los diagramas nuevos salen legibles sin intervención del usuario.
  description: '#e4e4e7',
};

export interface DiagramNode {
  id: string;
  type: DiagramNodeType;
  label: string;
  description?: string;
  group?: DiagramNodeGroup;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  sourceHandle?: string; // e.g. 'right', 'left', 'bottom'
  targetHandle?: string;
}

export type DiagramGenerationType = 'technical' | 'business';

/**
 * Paso del flujo de integración — agrupa nodos lógicamente y provee narrativa
 * para el sidepanel del viewer. El paso activo (hover o click) ilumina los
 * `nodeIds` declarados y sus edges interconectoras; el resto del diagrama
 * se atenúa visualmente.
 *
 * El agente genera los pasos junto con el documento de flujo de integración
 * que se escribe al vault (ver `integrationFlowDocPath` en `EpicDiagram`).
 * Diagramas legacy no tienen `steps` — el sidepanel muestra un CTA de
 * backfill en ese caso.
 */
export interface DiagramStep {
  id: string;
  /** Orden en el flujo (1..N). Determina la numeración visual en el sidepanel. */
  order: number;
  /** Título corto — e.g. "Validación de credenciales". */
  title: string;
  /** Descripción detallada del paso (2-4 frases). */
  description: string;
  /** IDs de nodos que este paso engloba. Debe tener al menos 1. */
  nodeIds: string[];
  /**
   * IDs de edges explícitamente asociados al paso. Si undefined, el viewer
   * deriva los edges cuya source + target pertenecen ambos a `nodeIds`.
   */
  edgeIds?: string[];
  /**
   * Anchor opcional al documento de flujo de integración (e.g. "#paso-1").
   * Si está presente, el sidepanel linkea "Ver detalles" al doc scrolleado.
   */
  docAnchor?: string;
  /**
   * Sinopsis de 1-2 frases del paso, optimizada para lectura rápida en el
   * bottom panel del viewer. Se diferencia de `description` en que es
   * deliberadamente condensada (≤220 chars) — el lector debe captar el
   * "qué hace" del paso en un vistazo. Opcional para backward compat con
   * diagramas generados antes de esta feature.
   */
  summary?: string;
  /**
   * 3-6 bullet points que enumeran los puntos CLAVE del paso (inputs,
   * decisiones, efectos principales). Se renderizan como lista visual en
   * el bottom panel. Cada bullet es una frase corta e independiente
   * (≤120 chars). Opcional para backward compat.
   */
  bulletpoints?: string[];
}

export interface EpicDiagram {
  id: string;
  name: string;
  type: DiagramGenerationType;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  generatedAt: string;
  generatedBy: 'ai' | 'manual';
  /**
   * Marca si el diagrama tiene posiciones de nodos ajustadas manualmente.
   * Cuando `true`, el viewer NO re-corre Dagre (respeta los drags del user).
   * Cuando `false` o ausente, el auto-layout se aplica como siempre.
   * Se enciende la primera vez que el user arrastra un nodo en modo edición.
   */
  hasManualLayout?: boolean;
  /**
   * Posiciones manuales `{ nodeId → {x, y} }` persistidas junto al diagrama.
   * Solo se poblan cuando `hasManualLayout === true`. El viewer las aplica
   * tras el layout Dagre (si sigue activo) o las usa como posición directa.
   */
  manualPositions?: Record<string, { x: number; y: number }>;
  /**
   * Pasos del flujo de integración generados por el agente. Opcional —
   * diagramas legacy (generados antes de esta feature) no lo tienen; el
   * sidepanel muestra un CTA "Generar documento de flujo" en ese caso.
   */
  steps?: DiagramStep[];
  /**
   * Path en vault al documento de flujo de integración. Formato canónico:
   * `epics/{epicId}-{slug}/diagrams/{type}.md`. Undefined si el diagrama
   * es legacy o si la escritura al vault falló (el diagrama se persiste
   * igual; la ausencia del doc es degradación graciosa).
   */
  integrationFlowDocPath?: string;
  /**
   * ISO timestamp de cuando se generó el documento de integración. Puede
   * diferir de `generatedAt` si el doc se generó vía backfill sobre un
   * diagrama preexistente.
   */
  integrationFlowGeneratedAt?: string;
}

// === QA MATRIX TYPES ===

export type TestCaseStatus = 'pending' | 'passed' | 'failed' | 'blocked' | 'skipped';
export type TestCasePriority = 'critical' | 'high' | 'medium' | 'low';
export type AutomationStatus = 'manual' | 'automated' | 'to_automate';

export type TestEnvironment = 'development' | 'staging' | 'production';

export interface TestExecution {
  id: string;
  executedAt: string; // ISO datetime
  environment: TestEnvironment;
  status: TestCaseStatus;
  duration: number; // milliseconds
  executedBy: string | null;
  notes: string;
}

export interface TestTrend {
  passRate: number; // 0-100, rolling average of last N executions
  flakyScore: number; // 0-100, frequency of status flips
  avgDuration: number; // milliseconds, average execution time
  failureFrequency: number; // failures in last N executions
  lastExecutions: TestExecution[];
}

export interface GherkinScenario {
  id: string;
  name: string;
  given: string; // precondition
  when: string; // action/trigger
  then: string; // expected outcome
  tags: string[]; // e.g. ['@smoke', '@regression', '@critical']
}

// --- Story-level (functional) QA types ---

export interface QATestCase {
  id: string;
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  status: TestCaseStatus;
  priority: TestCasePriority;
  assignedTo: string | null;
  automationStatus: AutomationStatus;
  linkedDefects: string[];
  executionHistory: TestExecution[];
  trend: TestTrend | null;
}

export interface QAMatrixRow {
  storyId: string;
  storyTitle: string;
  storyJiraKey: string;
  acceptanceCriteria: string[];
  testCases: QATestCase[];
  coverage: number; // 0-100 percentage
}

export interface QAMatrix {
  id: string;
  epicId: string;
  rows: QAMatrixRow[];
  generatedAt: string; // ISO date
  generatedBy: 'ai' | 'manual';
  updatedAt: string;
}

// --- Epic-level (systemic) QA types ---

export type EpicQATestCategory =
  | 'integration'
  | 'e2e'
  | 'performance'
  | 'security'
  | 'compatibility'
  | 'reliability'
  | 'safety'
  | 'usability'
  | 'maintainability';

export const EPIC_QA_CATEGORY_LABELS: Record<EpicQATestCategory, string> = {
  integration: 'Integración',
  e2e: 'End-to-End',
  performance: 'Performance',
  security: 'Seguridad',
  compatibility: 'Compatibilidad',
  reliability: 'Fiabilidad',
  safety: 'Seguridad Operativa',
  usability: 'Usabilidad',
  maintainability: 'Mantenibilidad',
};

export const EPIC_QA_CATEGORY_DESCRIPTIONS: Record<EpicQATestCategory, string> = {
  integration: 'Interacción entre módulos y servicios de la épica',
  e2e: 'Flujos completos de usuario de punta a punta',
  performance: 'Tiempos de respuesta, carga y throughput',
  security: 'Vulnerabilidades, acceso y encriptación',
  compatibility: 'Cross-browser, cross-platform y API versioning',
  reliability: 'Tolerancia a fallos y recuperación',
  safety: 'Restricciones operativas, fail-safe y advertencias de riesgo',
  usability: 'Accesibilidad, inclusividad y experiencia de interacción',
  maintainability: 'Modularidad, testabilidad y facilidad de modificación',
};

export interface EpicQATest {
  id: string;
  category: EpicQATestCategory;
  title: string;
  description: string;
  scenarios: string[];
  gherkinScenarios: GherkinScenario[];
  dependencies: string[];
  status: TestCaseStatus;
  priority: TestCasePriority;
  assignedTo: string | null;
  automationStatus: AutomationStatus;
  linkedDefects: string[];
  riskLikelihood: 1 | 2 | 3 | 4 | 5;
  riskImpact: 1 | 2 | 3 | 4 | 5;
  executionHistory: TestExecution[];
  trend: TestTrend | null;
}

export interface EpicQAMatrix {
  id: string;
  epicId: string;
  tests: EpicQATest[];
  nfrCoverage: Record<EpicQATestCategory, number>; // category → 0-100%
  generatedAt: string;
  generatedBy: 'ai' | 'manual';
  updatedAt: string;
}

export type QAApproval = {
  status: 'pending' | 'approved' | 'rejected';
  /** Sub del JWT del aprobador (`auth0|...`) — identificador estable. */
  approvedBy: string | null;
  /**
   * Nombre humano del aprobador en el momento del VoBo. Snapshot inmutable
   * — si el usuario cambia su nombre o se elimina, el approval conserva
   * el nombre con que fue dado para preservar la trazabilidad histórica.
   * Nullable para retro-compat con approvals creados antes de este campo.
   */
  approvedByName: string | null;
  approvedAt: string | null;
  comment: string | null;
};

// === DEPENDENCY TYPES ===

export type DependencyType = 'technical' | 'resource' | 'knowledge' | 'external' | 'cross-team';
export type DependencyDirection = 'depends_on' | 'depended_on_by';
export type DependencyStatus = 'identified' | 'in_progress' | 'resolved' | 'blocked' | 'mitigated';
export type DependencyScheduling = 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish';

/**
 * @deprecated Reemplazado por `StoryTechnicalDependency` (FK a Story).
 * El campo `Epic.dependencies` queda inerte para retrocompatibilidad con
 * data legacy en JSONB; las nuevas dependencias se crean a nivel story
 * y se agregan vía `GET /epicas/:id/dependencies-rollup`.
 */
export interface EpicDependency {
  id: string;
  title: string;
  description: string;
  type: DependencyType;
  direction: DependencyDirection;
  scheduling: DependencyScheduling;
  status: DependencyStatus;
  severity: Priority; // reuse Priority enum: critical, high, medium, low
  isBlocking: boolean;
  targetEpicId: string | null; // null for external dependencies
  targetExternalName: string | null; // for external deps: team/vendor name
  owner: string; // person responsible for resolution
  dueDate: string | null; // ISO date
  resolutionNotes: string;
  /** Proveedor externo (Stripe, Twilio, etc.) cuando aplica. */
  vendor?: string;
  /** True si la dep requiere una credencial externa (API key, merchant code). */
  requiresCredential?: boolean;
  /** Si `requiresCredential` y ya se registró, apunta al `ExternalSecret.id` que la resuelve. */
  linkedSecretId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// === DOCUMENT TYPE ===

export type DocumentFormat = 'pdf' | 'excel' | 'word' | 'csv';

export interface EpicDocumentSection {
  id: string;
  title: string;
  content: string; // Markdown-like text content
}

export interface EpicDocument {
  id: string;
  name: string;
  type: 'pdf' | 'excel' | 'diagram' | 'image' | 'other';
  url: string; // mock URL or blob path
  uploadedBy: string;
  uploadedAt: string; // ISO date
  size: string; // human-readable, e.g. "2.4 MB"
  // AI-generated document fields
  sections?: EpicDocumentSection[];
  generatedBy?: 'ai' | 'manual';
  format?: DocumentFormat;
}

// === DESIGN TYPE ===

export interface EpicDesign {
  id: string;
  name: string;
  description: string;
  /**
   * Texto que el agente PO/TL/QA ve como contexto del diseño en sus prompts.
   *
   * - Diseños creados antes del cambio a "bundle ZIP" (legacy): contiene la
   *   URL del handoff de Claude Design tal cual la pegó el user.
   * - Diseños creados con bundle ZIP: contiene un handoff sintético compacto
   *   (slug del bundle, path al primary design, listing de archivos del
   *   bundle accesibles via vault_read). El README crudo y los HTMLs viven
   *   en el vault — Claude Code los lee al implementar la historia.
   */
  handoff: string;
  /**
   * Si el diseño se creó subiendo un bundle ZIP de Claude Design, esta clave
   * apunta al ZIP completo de respaldo en object/file storage. Permite
   * descargar el bundle original (incluyendo binarios que no descomprimimos
   * al vault). Ausente para diseños legacy (URL handoff).
   */
  bundleKey?: string;
  /**
   * Path en el vault donde se descomprimieron los archivos texto del bundle
   * (HTML, CSS, JS, README, etc.). Formato:
   * `iniciativas/<initSlug>/epics/<epicSlug>/disenos/<designSlug>/`. Los
   * agentes pueden listar/leer estos archivos via `vault_glob` y `vault_read`.
   * Ausente para diseños legacy.
   */
  bundleVaultPath?: string;
  createdAt: string; // ISO date
  updatedAt: string; // ISO date
  createdBy?: string;
}

// === INTERFACES ===

export interface Initiative {
  id: string;
  name: string;
  description: string;
  status: InitiativeStatus;
  /** ISO date. Opcional: una iniciativa en planning puede no tener fechas comprometidas todavía. */
  startDate: string | null;
  /** ISO date. Opcional: una iniciativa en planning puede no tener fechas comprometidas todavía. */
  targetDate: string | null;
  owner: string; // name of the initiative owner
  epicIds: string[];
  documents: EpicDocument[];
  tracker?: TrackerReference;
}

export interface Epic {
  id: string;
  title: string;
  /**
   * Markdown único de la épica con la estructura mínima dictada por el
   * prompt al agente IA y por el placeholder del editor humano. Headings
   * obligatorios:
   *   ## Descripción
   *   ## Beneficios cualitativos
   *   ## Beneficios cuantitativos
   *   ## Medición de beneficios
   *   ## Alcance
   *   ## Criterios de aceptación
   *   ## Mejoras tecnológicas
   *   ## Canales y flujos impactados
   *   ## Dependencias de terceros
   *
   * Reemplaza los 12 campos discretos del shape v1 (description,
   * qualitativeBenefits, quantitativeBenefits, benefitsMeasurement,
   * scopeDescription, acceptanceCriteria, technologicalImprovements,
   * businessPriority, teamsInvolved, impactedChannels, impactedFlows,
   * impactSabreLevel, thirdPartyDependencies). `priority` (enum) y
   * `podIds` (cells) viven aparte como metadata estructurada — no se
   * duplican en el markdown.
   */
  markdown: string;
  status: EpicStatus;
  priority: Priority;
  initiativeId: string;
  podIds: string[]; // many-to-many: epic can belong to multiple PODs
  tracker?: TrackerReference;
  startDate: string;
  targetDate: string;
  documents: EpicDocument[];
  diagrams: EpicDiagram[];
  /** @deprecated Inerte. Las dependencias técnicas viven ahora a nivel story (`StoryTechnicalDependency`). */
  dependencies: EpicDependency[];
  designs: EpicDesign[];
  designSkipped: boolean;
  poApproval: {
    status: 'pending' | 'approved' | 'rejected';
    approvedBy: string | null; // PO sub (auth0|...)
    approvedByName: string | null; // PO display name snapshot
    approvedAt: string | null; // ISO date
    comment: string | null;
  } | null;
  tlApproval: {
    status: 'pending' | 'approved' | 'rejected';
    approvedBy: string | null; // TL sub (auth0|...)
    approvedByName: string | null; // TL display name snapshot
    approvedAt: string | null; // ISO date
    comment: string | null;
  } | null;
  qaMatrix: QAMatrix | null;
  qaApproval: QAApproval | null;
  epicQAMatrix: EpicQAMatrix | null;
  /**
   * Timestamp ISO de cuándo la épica fue enviada al Forge ("in queue").
   * Null hasta que el usuario hace click en "Subir al Forge" tras los 3
   * VoBos. Modelo KISS Mes 0 — en Mes 1 migrará a tabla SprintBatch.
   */
  enqueuedAt?: string | null;
  /** UUID del batch en la cola del Forge. Null si la épica no fue encolada. */
  enqueuedBatchId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Epica propuesta por el agente IA, antes de ser persistida. */
export type ProposedEpic = Omit<
  Epic,
  | 'id' | 'createdAt' | 'updatedAt'
  | 'documents' | 'diagrams' | 'dependencies' | 'designs' | 'designSkipped'
  | 'poApproval' | 'tlApproval' | 'qaMatrix' | 'qaApproval' | 'epicQAMatrix'
  | 'tracker'
> & {
  clientId: string; // ID local para tracking en staging
};

/** Fases del agente de generacion de epicas. */
export type EpicGenerationPhase = 'idle' | 'researching' | 'analyzing' | 'proposing' | 'done';

/** Base fields present on every SSE event. */
interface EpicGenerationEventBase {
  timestamp?: string;
}

/** Eventos SSE emitidos durante la generacion de epicas. */
export type EpicGenerationEvent =
  | (EpicGenerationEventBase & { type: 'run_started' })
  | (EpicGenerationEventBase & { type: 'run_finished'; totalDurationMs: number })
  | (EpicGenerationEventBase & { type: 'phase_change'; phase: EpicGenerationPhase; label: string })
  | (EpicGenerationEventBase & { type: 'thinking'; delta: string })
  | (EpicGenerationEventBase & { type: 'step_start'; step: string; label?: string; tool?: string; toolArgs?: Record<string, unknown> })
  | (EpicGenerationEventBase & { type: 'step_done'; step: string; tool?: string; summary?: string; durationMs?: number; resultPreview?: string })
  | (EpicGenerationEventBase & { type: 'tool_progress'; tool: string; detail: string })
  | (EpicGenerationEventBase & { type: 'proposal_ready'; epic: ProposedEpic })
  | (EpicGenerationEventBase & { type: 'done' })
  | (EpicGenerationEventBase & { type: 'error'; message: string });

/** Cached generation session stored in Redis. */
export interface CachedGenerationSession {
  initiativeId: string;
  status: 'streaming' | 'staging';
  proposals: ProposedEpic[];
  events: EpicGenerationEvent[];
  createdAt: string;
  completedAt?: string;
  ttlSeconds: number;
}

// --- Story generation (AI agent) types ---

/** Fases de los 5 agentes especializados durante la generacion de historias. */
export type StoryGenerationPhase =
  | 'idle'
  | 'researching'      // Investigacion inicial (documentos + vault + codigo)
  | 'drafting_po'      // Agente PO redactando antecedentes/objetivo/criterios
  | 'drafting_technical' // Agente Tech Lead detallando arquitectura/flujo/validaciones
  | 'drafting_qa'      // Agente QA generando estrategia de testing + casos unitarios
  | 'auditing_deps'    // Agente DepsAuditor — revisa que no falten credenciales/env vars
  | 'analyzing_order'  // Agente StoryOrderAnalyzer — recupera el DAG hard/soft entre historias
  | 'proposing'        // Consolidando y emitiendo propuestas
  | 'done';

/**
 * Rol del agente activo durante un step. Permite a la UI rotular que "sombrero"
 * esta usando el agente en cada momento (PO / Tech Lead / QA / DepsAuditor / StoryOrder).
 */
export type StoryAgentRole = 'po' | 'technical' | 'qa' | 'deps_auditor' | 'story_order' | 'orchestrator';

interface StoryGenerationEventBase {
  timestamp?: string;
  /**
   * Set por workers paralelos del TL/QA cuando emiten eventos durante el
   * procesamiento de UNA historia específica del batch. Permite a la UI
   * subdividir el bucket "Tech Lead" / "QA" en N sub-cadenas (una por
   * historia). undefined = evento global (run_started, phase_change,
   * proposal_ready, run_finished, error) o legacy non-parallel runs.
   */
  storyIndex?: number;
}

/** Eventos SSE emitidos durante la generacion de historias. */
export type StoryGenerationEvent =
  | (StoryGenerationEventBase & { type: 'run_started' })
  | (StoryGenerationEventBase & { type: 'run_finished'; totalDurationMs: number })
  | (StoryGenerationEventBase & {
      type: 'phase_change';
      phase: StoryGenerationPhase;
      label: string;
      role?: StoryAgentRole;
      /**
       * Titles de las historias del batch. Se incluye SOLO en el phase_change
       * que arranca una fase paralela (ej. `drafting_technical`, `drafting_qa`),
       * para que la UI pueda etiquetar las sub-cadenas paralelas con el nombre
       * real de cada historia en lugar de "Historia 1, Historia 2…". Cada
       * worker paralelo emite events con `storyIndex`; este campo da la
       * correspondencia inversa `storyIndex → title`.
       */
      outlines?: { storyIndex: number; title: string }[];
    })
  | (StoryGenerationEventBase & { type: 'thinking'; delta: string; role?: StoryAgentRole })
  | (StoryGenerationEventBase & { type: 'step_start'; step: string; label?: string; tool?: string; toolArgs?: Record<string, unknown>; role?: StoryAgentRole })
  | (StoryGenerationEventBase & { type: 'step_done'; step: string; tool?: string; summary?: string; durationMs?: number; resultPreview?: string; role?: StoryAgentRole })
  | (StoryGenerationEventBase & { type: 'proposal_ready'; story: ProposedStory })
  | (StoryGenerationEventBase & { type: 'done' })
  | (StoryGenerationEventBase & { type: 'error'; message: string });

/** Cached story generation session stored in Redis, keyed por epicId. */
export interface CachedStoryGenerationSession {
  epicId: string;
  status: 'streaming' | 'staging';
  proposals: ProposedStory[];
  events: StoryGenerationEvent[];
  createdAt: string;
  completedAt?: string;
  ttlSeconds: number;
}

// --- Diagram generation (AI agent) types ---

/** Fases del agente de generacion de diagramas. */
export type DiagramGenerationPhase = 'idle' | 'researching' | 'analyzing' | 'composing' | 'done';

/** Base fields present on every diagram SSE event. */
interface DiagramGenerationEventBase {
  timestamp?: string;
}

/** Eventos SSE emitidos durante la generacion de diagramas. */
export type DiagramGenerationEvent =
  | (DiagramGenerationEventBase & { type: 'run_started' })
  | (DiagramGenerationEventBase & { type: 'run_finished'; totalDurationMs: number })
  | (DiagramGenerationEventBase & { type: 'phase_change'; phase: DiagramGenerationPhase; label: string })
  | (DiagramGenerationEventBase & { type: 'thinking'; delta: string })
  | (DiagramGenerationEventBase & { type: 'step_start'; step: string; label?: string; tool?: string; toolArgs?: Record<string, unknown> })
  | (DiagramGenerationEventBase & { type: 'step_done'; step: string; tool?: string; summary?: string; durationMs?: number; resultPreview?: string })
  | (DiagramGenerationEventBase & { type: 'diagram_ready'; diagram: EpicDiagram })
  | (DiagramGenerationEventBase & {
      type: 'document_ready';
      path: string;
      epicId: string;
      diagramType: DiagramGenerationType;
      generatedAt: string;
    })
  | (DiagramGenerationEventBase & { type: 'done' })
  | (DiagramGenerationEventBase & { type: 'error'; message: string });

// --- Story section types ---

/**
 * Sección Product Owner de una historia. Markdown con headings obligatorios
 * (## Antecedentes, ## Objetivo, ## Historia de usuario, ## What/How/When,
 * ## Criterios de aceptación, ## Notas adicionales [opcional]). Reemplaza
 * los 6 sub-campos discretos del shape v1.
 */
export interface StoryPOFields {
  markdown: string;
}

// ─────────────────────────────────────────────────────────────────────
// Legacy shapes — preservados solo como type-only para que los helpers
// `legacy*ToMarkdown` del backend acepten data v1 al leer del vault.
// NO se usan en runtime ni en API contracts. Se eliminarán cuando todas
// las historias del vault estén migradas a v2.
// ─────────────────────────────────────────────────────────────────────

export interface StoryPOFieldsLegacy {
  background: string;
  objective: string;
  userStory: string;
  whatHowWhen: { what: string; how: string; when: string };
  acceptanceCriteria: string[];
  additionalNotes: string;
}

export interface StoryTechnicalFieldsLegacy {
  architecture: string;
  integrationFlow: string;
  validations: string[];
  errorHandling: string[];
  implementationChecklist: string[];
  contract?: string;
}

export interface StoryQAFieldsLegacy {
  testingStrategy: string;
  linkedQAMatrixId: string | null;
  unitTests?: string;
  happyPath?: string[];
  edgeCases?: string[];
  mocks?: string;
  tools?: string;
}

/**
 * Sección de Solución Técnica de una historia. A partir del refactor v2 es un
 * único string markdown con headings obligatorios (## Arquitectura y
 * componentes, ## Flujo de integración, ## Validaciones, ## Manejo de errores,
 * ## Contrato). El frontend renderea 1 editor Tiptap full-feature por tab.
 * El agente IA emite el markdown via prompt; los headings se validan con regex.
 */
export interface StoryTechnicalFields {
  markdown: string;
}

/**
 * Sección QA de una historia. Markdown con headings obligatorios
 * (## Pruebas unitarias, ## Happy path, ## Edge cases, ## Mocks,
 * ## Herramientas). Reemplaza los 7 sub-campos discretos del shape v1.
 */
export interface StoryQAFields {
  markdown: string;
}

export interface UserStory {
  id: string;
  title: string;
  description: string;
  status: StoryStatus;
  storyPoints: number; // fibonacci: 1, 2, 3, 5, 8, 13
  epicId: string;
  podId: string; // each story belongs to ONE pod
  sprintId: string | null;
  tracker?: TrackerReference;
  labels: string[];
  // Structured sections
  po: StoryPOFields;
  technical: StoryTechnicalFields;
  qa: StoryQAFields;
  createdAt: string;
  updatedAt: string;
}

/**
 * Output del Agente PO (Product Owner). Contiene los meta-datos de la historia
 * y la seccion de negocio. Se pasa literalmente al Agente Tech Lead como input.
 */
export interface StoryOutline {
  title: string;
  description: string;
  storyPoints: number; // fibonacci
  podId: string;
  labels: string[];
  po: StoryPOFields;
}

/**
 * Documento de la iniciativa/epica padre que el agente PO identifico como
 * relevante para la historia. Se persiste como .md individual en
 * `stories/<folder>/documentos-epica/<slug>.md`.
 */
export interface RelatedDocument {
  docId: string;          // id del documento en initiative.documents
  docName: string;        // nombre original del archivo
  bucketUrl: string;      // ruta del bucket (ej: /api/documents/file/initiatives/xxx/...)
  relevanceSummary: string; // 1-2 parrafos del agente explicando por que aplica
}

/** Severidad de una dependencia descubierta (align con Priority enum). */
export type DependencySeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Clasificacion de una dependencia descubierta por el agente QA.
 * Diferente de `DependencyType` (usado en EpicDependency) — aquel tiene
 * semantica de direccion entre epicas; este solo categoriza el origen.
 */
export type DiscoveredDependencyType = 'api' | 'service' | 'data' | 'team' | 'other';

/**
 * Dependencia descubierta por los agentes durante generación de historias.
 * Emitida por el **Tech Lead** (foco: arquitectura/credenciales externas) y
 * por el **QA** (foco: mocks/fixtures/datos). Los dos agentes comparten el
 * mismo shape; el merge final deduplica por `(vendor, type)`.
 *
 * Se persiste como .md individual en `epics/<folder>/dependencias/<slug>.md`.
 */
export interface DiscoveredDependency {
  id: string;               // clientId local (ai-dep-<uuid>)
  title: string;            // titulo corto
  description: string;      // resumen ejecutivo 1-2 lineas
  severity: DependencySeverity;
  type: DiscoveredDependencyType;
  mdContent: string;        // markdown extenso con detalles, refs, mitigacion
  /** Proveedor externo (Stripe, Twilio, SAP Ariba, etc.) si aplica. */
  vendor?: string;
  /**
   * True cuando la dep requiere una credencial externa (API key, merchant
   * code, OAuth client_secret) que el sistema NO puede resolver por sí solo.
   * El TL la marca cuando diseña una integración con proveedor.
   */
  requiresCredential?: boolean;
  /**
   * True cuando la dep es bloqueante para que el backend funcione. Usado
   * junto con `requiresCredential` para priorizar la resolución en settings.
   */
  isBlocking?: boolean;
  /** Si el secret ya se registró en `/factory/settings`, apunta al `ExternalSecret.id`. */
  linkedSecretId?: string | null;
}

/**
 * Historia propuesta por los 3 agentes IA (PO + Tech Lead + QA),
 * antes de ser aceptada y persistida. Omite campos generados por el servidor.
 */
export type ProposedStory = Omit<
  UserStory,
  'id' | 'createdAt' | 'updatedAt' | 'tracker'
> & {
  clientId: string; // ID local para tracking en staging
  /** Documentos de la iniciativa detectados como relevantes por el agente PO. */
  relatedDocuments?: RelatedDocument[];
  /** Dependencias descubiertas por el agente QA durante el trazo de testing. */
  discoveredDependencies?: DiscoveredDependency[];
  /**
   * Historias del MISMO batch que bloquean a ésta. Las detecta el Tech Lead
   * cuando razona sobre la arquitectura (B consume API que A crea, B requiere
   * migration que A define, etc.).
   *
   * `storyClientId` referencia el `clientId` de otra propuesta staging del
   * mismo batch — estable aunque el user regenere historias individuales.
   * Al aceptar las historias, el backend mapea `clientId → id` real.
   */
  blockedBy?: StoryOrderDependency[];
};

/** Razón por la que una historia bloquea a otra. Diferencia tipos de acoplamiento. */
export type StoryOrderDependencyReason =
  | 'api_contract'      // B consume el endpoint que A crea
  | 'migration_order'   // Ambas tocan la misma tabla; B requiere schema de A
  | 'shared_model'      // B importa un DTO/tipo que A exporta
  | 'sequential_logic'  // B asume que A ya corrió (populación de datos, etc.)
  | 'other';

/**
 * Hard = no puede arrancar hasta que termine la otra (bloqueante absoluto).
 * Soft = arranca con mock/stub, termina cuando la otra está (permite paralelizar).
 */
export type StoryOrderDependencyHardness = 'hard' | 'soft';

export interface StoryOrderDependency {
  /** clientId (en staging) o storyId (post-accept) de la historia que bloquea. */
  storyClientId: string;
  hardness: StoryOrderDependencyHardness;
  reason: StoryOrderDependencyReason;
  /** Descripción humana corta: "B consume /api/users que A crea". */
  description: string;
}

// === STORY TECHNICAL DEPENDENCIES (nivel historia) ===

/**
 * Categorías unificadas para dependencias técnicas a nivel historia.
 * Coherentes con la categorización del frontend (EpicDependencies.tsx
 * CATEGORY_CONFIG): bloques visuales claros en la UI.
 */
export type StoryTechnicalDependencyCategory =
  | 'secrets'
  | 'apis'
  | 'testing'
  | 'services'
  | 'teams'
  | 'knowledge'
  | 'other';

export type StoryTechnicalDependencySeverity = 'critical' | 'high' | 'medium' | 'low';

export type StoryTechnicalDependencyStatus =
  | 'identified'
  | 'in_progress'
  | 'resolved'
  | 'blocked'
  | 'mitigated';

/**
 * Origen de la dependencia: `manual` la creó un usuario desde la UI;
 * `discovered` la emitió el agente IA durante generación de historias.
 * Preservar el origen permite filtrar/badge sin perder trazabilidad.
 */
export type StoryTechnicalDependencySource = 'manual' | 'discovered';

/**
 * Dependencia técnica ligada a una historia específica. Reemplaza el modelo
 * legacy de `EpicDependency` (JSONB) y `DiscoveredDependency` (vault) en una
 * sola tabla con FK directa a `Story`. Cada épica obtiene un roll-up read-only
 * agregando las deps de todas sus historias.
 */
export interface StoryTechnicalDependency {
  id: string;
  storyId: string;
  title: string;
  description: string;
  category: StoryTechnicalDependencyCategory;
  severity: StoryTechnicalDependencySeverity;
  source: StoryTechnicalDependencySource;
  vendor: string | null;
  requiresCredential: boolean;
  linkedSecretId: string | null;
  isBlocking: boolean;
  targetExternalName: string | null;
  targetEpicId: string | null;
  status: StoryTechnicalDependencyStatus;
  owner: string;
  dueDate: string | null;
  resolutionNotes: string;
  mdContent: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Solo presente en respuestas del rollup cross-stories del epic. Lista las
   * historias que mencionan la MISMA credencial cuando varias coinciden.
   * Permite al frontend mostrar "Usado en N historias" en vez de duplicar
   * la entry. Cuando viene `undefined`, la dep es de una sola story (caso
   * normal del endpoint per-story).
   */
  relatedStories?: Array<{ storyId: string; storyTitle: string }>;
}

export interface Pod {
  id: string;
  name: string;
  description: string;
  color: string; // hex color for UI
}

export interface Sprint {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  podId: string;
  status: SprintStatus;
}

export interface ChangelogEntry {
  id: string;
  timestamp: string; // ISO datetime
  entityType: ChangelogEntityType;
  entityId: string;
  entityTitle: string;
  action: ChangelogAction;
  field: string | null; // null for 'created' action
  oldValue: string | null;
  newValue: string | null;
  changedBy: {
    id: string;
    name: string;
    avatarUrl: string;
  };
  changeReason: string | null;
}

// === SPRINT CEREMONY TYPES ===

export type CeremonyType =
  | 'planning'
  | 'review'
  | 'retro'
  | 'release'
  | 'pi_planning'
  | 'e2e'
  | 'cvt'
  | 'integration';

export interface SprintCeremony {
  id: string;
  sprintId: string | null;   // null for PI-level ceremonies
  type: CeremonyType;
  date: string;               // ISO date
  endDate?: string;           // For multi-day ceremonies (CVT, e2e)
  label?: string;             // Override default label
  podId?: string;             // Optional: pod-specific ceremony
  scope: 'sprint' | 'pi';    // Sprint-level or PI-level
}

// === COMPUTED / HELPER TYPES ===

export interface EpicWithRelations extends Epic {
  initiative: Initiative;
  pods: Pod[];
  stories: UserStory[];
  progress: number; // 0-100 percentage of done stories
}

export interface StoryWithRelations extends UserStory {
  epic: Epic;
  pod: Pod;
  sprint: Sprint | null;
}

export interface PodWithRelations extends Pod {
  stories: UserStory[];
  epics: Epic[];
}

export interface MatrizCell {
  podId: string;
  epicId: string;
  stories: UserStory[];
  totalStories: number;
  doneStories: number;
  blockedStories: number;
  totalPoints: number;
  donePoints: number;
  progress: number; // 0-100
}

export interface MatrizRow {
  epic: Epic;
  initiative: Initiative;
  cells: Record<string, MatrizCell>; // keyed by podId
}

// Filter state
export interface ProyectosFilters {
  initiativeIds: string[];
  podIds: string[];
  statuses: StoryStatus[];
  epicStatuses: EpicStatus[];
  priorities: Priority[];
  sprintId: string | null;
  dateRange: { from: string | null; to: string | null };
  storyPointsRange: { min: number | null; max: number | null };
  searchQuery: string;
  trackerKey: string;
}

export const DEFAULT_FILTERS: ProyectosFilters = {
  initiativeIds: [],
  podIds: [],
  statuses: [],
  epicStatuses: [],
  priorities: [],
  sprintId: null,
  dateRange: { from: null, to: null },
  storyPointsRange: { min: null, max: null },
  searchQuery: '',
  trackerKey: '',
};

