/**
 * Centraliza la construccion de paths del vault para TODAS las entidades
 * del dominio Proyectos (iniciativas, epics, historias, diagramas, deps,
 * matrices, documentos).
 *
 * Estructura canonica:
 *
 * ```
 * iniciativas/
 *   <ini-slug>-<iniId6>/
 *     index.md
 *     resumenes-ejecutivos/<summary-slug>-<id>.md
 *     documentos/<doc-slug>.md
 *     epics/
 *       <epic-slug>-<epicId6>/
 *         index.md
 *         definicion.md
 *         diagramas/<type>.md
 *         documentos/<doc-slug>.md
 *         dependencias/<dep-slug>.md
 *         matrices/<kind>.md
 *         historias/
 *           <story-slug>-<storyId6>/
 *             index.md
 *             definicion-negocio.md
 *             definicion-tecnica.md
 *             testing-strategy.md
 *             documentos/<doc-slug>.md
 *             dependencias/<dep-slug>.md
 * ```
 *
 * Reglas:
 *  - Todos los slugs: `slugify(name) + '-' + id.slice(-6)` para unicidad.
 *  - `vaultPath` en PG siempre apunta al `index.md` del folder (no al folder).
 *  - `dirname(vaultPath)` reconstruye el folder para hermanos/subcarpetas.
 */

export const VAULT_ROOT_INITIATIVES = 'iniciativas';

// ─────────────────────────────────────────────────────────────────────
//   Slug generation
// ─────────────────────────────────────────────────────────────────────

/**
 * Normaliza un nombre humano a slug URL-safe. ASCII only, lowercase,
 * separadores con guion. Max 60 chars antes del sufijo `-<id6>`.
 *
 * Ejemplo: "Agente para hacer diagramas" → "agente-para-hacer-diagramas"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || 'sin-nombre'; // fallback si el name es vacio o solo caracteres no-slug
}

/**
 * Construye un slug con sufijo de 6 chars del UUID para garantizar unicidad
 * incluso si dos entidades tienen el mismo nombre.
 *
 * Valida que `id` tenga al menos 6 chars; si es más corto, eso invalida la
 * garantia de unicidad (2 entidades con nombres cortos y ids cortos pueden
 * colisionar si el sufijo se degrada). Este path se considera un bug de
 * invariante aguas arriba y se detecta temprano con un throw explicito.
 */
export function slugifyWithId(name: string, id: string): string {
  if (typeof id !== 'string' || id.length < 6) {
    throw new Error(
      `slugifyWithId: id invalido (length=${id?.length ?? 0}). Los ids de domain deben ser UUIDs; recibido='${id}'`,
    );
  }
  return `${slugify(name)}-${id.slice(-6)}`;
}

// ─────────────────────────────────────────────────────────────────────
//   Initiative paths
// ─────────────────────────────────────────────────────────────────────

export interface InitiativeRef {
  id: string;
  name: string;
}

export function initiativeFolderPath(ini: InitiativeRef): string {
  return `${VAULT_ROOT_INITIATIVES}/${slugifyWithId(ini.name, ini.id)}`;
}

export function initiativeIndexPath(ini: InitiativeRef): string {
  return `${initiativeFolderPath(ini)}/index.md`;
}

export function initiativeDocumentPath(ini: InitiativeRef, docName: string): string {
  return `${initiativeFolderPath(ini)}/documentos/${slugify(docName) || 'documento'}.md`;
}

export function initiativeExecutiveSummaryPath(
  ini: InitiativeRef,
  summaryName: string,
  summaryId: string,
): string {
  return `${initiativeFolderPath(ini)}/resumenes-ejecutivos/${slugifyWithId(summaryName, summaryId)}.md`;
}

// ─────────────────────────────────────────────────────────────────────
//   Epic paths
// ─────────────────────────────────────────────────────────────────────

export interface EpicRef {
  id: string;
  title: string;
}

export function epicFolderPath(ini: InitiativeRef, epic: EpicRef): string {
  return `${initiativeFolderPath(ini)}/epics/${slugifyWithId(epic.title, epic.id)}`;
}

export function epicIndexPath(ini: InitiativeRef, epic: EpicRef): string {
  return `${epicFolderPath(ini, epic)}/index.md`;
}

export function epicDefinitionPath(ini: InitiativeRef, epic: EpicRef): string {
  return `${epicFolderPath(ini, epic)}/definicion.md`;
}

export type EpicDiagramKind = 'business' | 'technical';

export interface DiagramRef {
  id: string;
  type: EpicDiagramKind;
}

/**
 * Path de un diagrama en el vault. El filename incluye el tipo + sufijo de 6
 * chars del id del diagrama para garantizar unicidad cuando una epica tiene
 * multiples diagramas del mismo tipo. Si solo hay uno por tipo, el sufijo es
 * estable y la URL se ve como `business-abc123.md`.
 *
 * Se permite la forma legacy `epicDiagramPath(ini, epic, 'business')` sin id
 * solo para codepaths que escriben el diagrama canonico unico por tipo (ej.
 * diagram-generation antes de asignar el id). En ese caso cae a `<type>.md`.
 * Esa forma NO se debe usar en codepaths que iteran una lista de diagramas.
 */
/**
 * Charset valido para ids de diagramas. UUIDs son `[a-f0-9-]`; aceptamos
 * tambien uppercase para tolerar ids provenientes de sistemas externos que
 * normalicen distinto. Cualquier otro caracter (especialmente `/`, `.`, `\`,
 * whitespace, unicode) se rechaza antes de construir el path — sin este
 * guard, un `id = "a/../x"` produciria escape del folder `diagramas/` al
 * resolverse contra el repo del vault, permitiendo overwrite de archivos
 * hermanos (`index.md`, `definicion.md`, etc.).
 */
const DIAGRAM_ID_RE = /^[a-fA-F0-9-]+$/;

export function epicDiagramPath(
  ini: InitiativeRef,
  epic: EpicRef,
  kindOrDiagram: EpicDiagramKind | DiagramRef,
): string {
  if (typeof kindOrDiagram === 'string') {
    return `${epicFolderPath(ini, epic)}/diagramas/${kindOrDiagram}.md`;
  }
  const { type, id } = kindOrDiagram;
  if (!DIAGRAM_ID_RE.test(id)) {
    throw new Error(`epicDiagramPath: diagram id invalido (charset fuera de [a-fA-F0-9-])`);
  }
  const suffix = id.length >= 6 ? `-${id.slice(-6)}` : '';
  return `${epicFolderPath(ini, epic)}/diagramas/${type}${suffix}.md`;
}

export function epicDocumentPath(
  ini: InitiativeRef,
  epic: EpicRef,
  docName: string,
): string {
  return `${epicFolderPath(ini, epic)}/documentos/${slugify(docName) || 'documento'}.md`;
}

export function epicDependencyPath(
  ini: InitiativeRef,
  epic: EpicRef,
  depTitle: string,
): string {
  return `${epicFolderPath(ini, epic)}/dependencias/${slugify(depTitle) || 'dependencia'}.md`;
}

export type EpicMatrixKind = 'qa-funcional' | 'qa-sistemica';

export function epicMatrixPath(
  ini: InitiativeRef,
  epic: EpicRef,
  kind: EpicMatrixKind,
): string {
  return `${epicFolderPath(ini, epic)}/matrices/${kind}.md`;
}

// ─────────────────────────────────────────────────────────────────────
//   Story paths
// ─────────────────────────────────────────────────────────────────────

export interface StoryRef {
  id: string;
  title: string;
}

export function storyFolderPath(
  ini: InitiativeRef,
  epic: EpicRef,
  story: StoryRef,
): string {
  return `${epicFolderPath(ini, epic)}/historias/${slugifyWithId(story.title, story.id)}`;
}

export function storyIndexPath(
  ini: InitiativeRef,
  epic: EpicRef,
  story: StoryRef,
): string {
  return `${storyFolderPath(ini, epic, story)}/index.md`;
}

export function storyPOPath(
  ini: InitiativeRef,
  epic: EpicRef,
  story: StoryRef,
): string {
  return `${storyFolderPath(ini, epic, story)}/definicion-negocio.md`;
}

export function storyTechnicalPath(
  ini: InitiativeRef,
  epic: EpicRef,
  story: StoryRef,
): string {
  return `${storyFolderPath(ini, epic, story)}/definicion-tecnica.md`;
}

export function storyQAPath(
  ini: InitiativeRef,
  epic: EpicRef,
  story: StoryRef,
): string {
  return `${storyFolderPath(ini, epic, story)}/testing-strategy.md`;
}

export function storyDocumentPath(
  ini: InitiativeRef,
  epic: EpicRef,
  story: StoryRef,
  docName: string,
): string {
  return `${storyFolderPath(ini, epic, story)}/documentos/${slugify(docName) || 'documento'}.md`;
}

export function storyDependencyPath(
  ini: InitiativeRef,
  epic: EpicRef,
  story: StoryRef,
  depTitle: string,
): string {
  return `${storyFolderPath(ini, epic, story)}/dependencias/${slugify(depTitle) || 'dependencia'}.md`;
}

// ─────────────────────────────────────────────────────────────────────
//   Path parsing utilities
// ─────────────────────────────────────────────────────────────────────

/**
 * Devuelve el directorio padre del path. Ejemplo:
 *   'iniciativas/x/epics/y/index.md' → 'iniciativas/x/epics/y'
 */
export function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

/**
 * Devuelve el ultimo segmento del path. Ejemplo:
 *   'iniciativas/x/epics/y/index.md' → 'index.md'
 */
export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Detecta si un vaultPath sigue el formato legacy flat (pre-reestructuracion).
 * Criterios de legacy:
 *   - Empieza con 'initiatives/' (ingles) o 'epics/' o 'stories/' sin prefijo `iniciativas/`.
 *   - Termina en `.md` sin `/index.md` (archivo unico, no folder).
 */
export function isLegacyVaultPath(vaultPath: string | null | undefined): boolean {
  if (!vaultPath) return false;
  if (vaultPath.startsWith('iniciativas/')) return false;
  // Legacy roots: 'initiatives/', 'epics/', 'stories/' (sin 'iniciativas/' parent).
  return (
    vaultPath.startsWith('initiatives/') ||
    vaultPath.startsWith('epics/') ||
    vaultPath.startsWith('stories/')
  );
}

/**
 * Detecta si un vaultPath esta en el formato nuevo (anidado).
 * Todo path nuevo empieza con `iniciativas/` y termina en `/index.md`
 * (para initiative, epic y story folders; los sub-artefactos no tienen vaultPath).
 */
export function isNewFormatVaultPath(vaultPath: string | null | undefined): boolean {
  if (!vaultPath) return false;
  return vaultPath.startsWith(`${VAULT_ROOT_INITIATIVES}/`) && vaultPath.endsWith('/index.md');
}
