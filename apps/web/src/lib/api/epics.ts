import type { DiscoveredDependency, EpicDesign } from '@cenzontle/shared';
import { apiFetch } from './client';

/**
 * Estructura canónica de un VoBo (Visto Bueno) sobre una épica. Coincide
 * con el shape que el backend persiste en `Epic.{po|tl|qa}Approval` (Json)
 * y con la respuesta de `POST /proyectos/epicas/:id/approvals/{role}`.
 *
 * El campo `status` permite extender a flujos de rejection en el futuro
 * sin romper consumers; hoy solo se persiste 'approved' (el rejection no
 * se escribe — se borra el approval entero).
 */
export interface ApprovalRecord {
  status: 'approved' | 'pending' | 'rejected';
  /** Sub del JWT del aprobador (auth0|...). Identificador estable. */
  approvedBy: string | null;
  /**
   * Snapshot del nombre del aprobador en el momento del VoBo. Persiste
   * aunque el usuario cambie de nombre o sea eliminado posteriormente.
   * Nullable para approvals creados antes de este campo (fallback en UI:
   * lookup en `state.members` por `approvedBy`).
   */
  approvedByName: string | null;
  approvedAt: string | null;
  comment: string | null;
}

export interface EpicResponse {
  id: string;
  title: string;
  /**
   * Markdown único de la épica (post-refactor v2). Reemplaza description + 11
   * campos narrativos discretos. Estructura mínima: 9 headings level-2
   * obligatorios dictados por placeholder UX y prompt al agente IA.
   */
  markdown: string;
  status: string;
  priority: string;
  startDate: string;
  targetDate: string;
  initiativeId: string;
  initiative: { id: string; name: string; status: string };
  podIds: string[];
  pods: { id: string; name: string; color: string }[];
  documents: any[];
  diagrams: any[];
  dependencies: any[];
  designs: EpicDesign[];
  designSkipped: boolean;
  poApproval: ApprovalRecord | null;
  tlApproval: ApprovalRecord | null;
  qaApproval: ApprovalRecord | null;
  qaMatrix: any;
  epicQAMatrix: any;
  tracker: any;
  /** ISO timestamp de cuándo la épica fue enviada al Forge. Null si nunca. */
  enqueuedAt: string | null;
  /** UUID del batch en la cola del Forge. Null si nunca encolada. */
  enqueuedBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getEpics(params?: { initiativeId?: string; status?: string; priority?: string; podId?: string }) {
  const query = new URLSearchParams();
  if (params?.initiativeId) query.set('initiativeId', params.initiativeId);
  if (params?.status) query.set('status', params.status);
  if (params?.priority) query.set('priority', params.priority);
  if (params?.podId) query.set('podId', params.podId);
  const qs = query.toString();
  return apiFetch<EpicResponse[]>(`/proyectos/epicas${qs ? `?${qs}` : ''}`);
}

export function getEpic(id: string, includeContent = false) {
  const qs = includeContent ? '?includeContent=true' : '';
  return apiFetch<EpicResponse>(`/proyectos/epicas/${id}${qs}`);
}

export interface CreateEpicInput {
  title: string;
  status?: string;
  priority?: string;
  startDate: string;
  targetDate: string;
  initiativeId: string;
  podIds?: string[];
  /** Markdown único con los 9 headings obligatorios. Optional al crear — el user puede llenarlo después. */
  markdown?: string;
}

export function createEpic(data: CreateEpicInput) {
  return apiFetch<EpicResponse>('/proyectos/epicas', { method: 'POST', body: JSON.stringify(data) });
}

export function updateEpic(id: string, data: Record<string, any>) {
  return apiFetch<EpicResponse>(`/proyectos/epicas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteEpic(id: string) {
  return apiFetch<void>(`/proyectos/epicas/${id}`, { method: 'DELETE' });
}

export function getDiscoveredDependencies(epicId: string) {
  return apiFetch<DiscoveredDependency[]>(`/proyectos/epicas/${epicId}/discovered-dependencies`);
}

/**
 * Item del DAG: historia bloqueada + lista de sus bloqueantes directos.
 * El backend ya resuelve los títulos de ambas puntas para evitar N+1 lookups.
 */
export interface StoryDependencyItem {
  story: { id: string; title: string };
  blockedBy: Array<{
    story: { id: string; title: string };
    hardness: 'hard' | 'soft' | string;
    reason: 'api_contract' | 'migration_order' | 'shared_model' | 'sequential_logic' | 'other' | string;
    description: string;
  }>;
}

export function getStoryDependencies(epicId: string) {
  return apiFetch<StoryDependencyItem[]>(`/proyectos/epicas/${epicId}/story-dependencies`);
}

/**
 * Shape de la respuesta del coverage check del bundle de diseño contra las
 * historias. El backend cruza `epic.designs[].componentManifest` contra
 * `story.componentsCovered: string[]`.
 *
 * Tres escenarios "no aplica":
 *  - `hasDesignBundle: false`: épica sin bundle (legacy o nunca tuvo).
 *  - `hasDesignBundle: true && manifestExists: false`: bundle subido ANTES
 *    de que el extractor de manifest existiera. El frontend muestra un
 *    mensaje sugiriendo re-upload, pero NO bloquea el envío.
 *
 * Cuando ambos son true, `canEnqueue` refleja si TODO componente del
 * manifest está cubierto. Si false, el frontend deshabilita el botón
 * "Enviar al Forge" y permite un "forzar envío" con justificación.
 */
export interface CoverageCheckResponse {
  hasDesignBundle: boolean;
  manifestExists: boolean;
  components: Array<{
    name: string;
    kind: 'section' | 'react-component';
    coverage: {
      covered: boolean;
      coveredByStories: Array<{ storyId: string; storyTitle: string }>;
    };
  }>;
  summary: {
    totalComponents: number;
    coveredComponents: number;
    uncoveredComponents: string[];
    coveragePercent: number;
  };
  canEnqueue: boolean;
}

/**
 * Coverage check del bundle de diseño contra las historias de la épica.
 * Devuelve qué componentes del manifest están cubiertos por al menos una
 * story. El caller debe degradar graciosamente si el endpoint falla
 * (Stream A puede no haberlo desplegado aún): NO mostrar el bloque de
 * cobertura y permitir el flujo normal de envío.
 */
export function getEpicCoverageCheck(epicId: string) {
  return apiFetch<CoverageCheckResponse>(
    `/proyectos/epicas/${epicId}/coverage-check`,
  );
}

/**
 * Borra un diseño de la épica. El backend hace cleanup completo:
 *  - Bundle: borra todos los archivos del vault bajo `disenos/<slug>/`
 *    + el ZIP de respaldo en disco.
 *  - Legacy (URL): borra el `.md` independiente.
 *  - Quita el design del array y persiste.
 * Idempotente.
 */
export async function deleteDesign(epicId: string, designId: string): Promise<void> {
  await apiFetch<void>(`/proyectos/epicas/${epicId}/designs/${designId}`, {
    method: 'DELETE',
  });
}

// ──────────────────────────────────────────────────────────────────────
// Visto Bueno (VoBo) — aprobaciones por rol con step-up authentication
// ──────────────────────────────────────────────────────────────────────

export type ApprovalRole = 'po' | 'tl' | 'qa';

export interface ApproveEpicInput {
  password: string;
  comment?: string;
}

export interface ApproveEpicResponse {
  status: 'approved';
  approvedAt: string;
  approvedBy: string;
  /** Display name del aprobador snapshot al momento del VoBo. */
  approvedByName: string;
  /** Comentario opcional del aprobador, persistido en el ChangelogEntry. */
  comment: string | null;
}

/**
 * Da el VoBo de una épica para un rol específico (PO/TL/QA). Backend valida:
 *  - Pod intersection del aprobador con la épica.
 *  - Rol exacto del aprobador (no AltaGerencia substitution).
 *  - Contraseña actual contra Auth0 (step-up auth).
 *  - Prerequisites (definición/diagrama/historias + VoBos previos en orden).
 *
 * Errores tipados:
 *  - 400: épica no lista (faltan headings, diagrama, historias, o VoBo previo).
 *  - 401: contraseña incorrecta.
 *  - 403: rol del aprobador no coincide con el VoBo solicitado.
 *  - 409: la épica ya tiene ese VoBo en estado approved.
 *  - 503: Auth0 no configurado para verify-password.
 */
export function approveEpic(
  epicId: string,
  role: ApprovalRole,
  input: ApproveEpicInput,
) {
  return apiFetch<ApproveEpicResponse>(
    `/proyectos/epicas/${epicId}/approvals/${role}`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

// ──────────────────────────────────────────────────────────────────────
// Forge Queue — enviar épicas al pipeline "in queue" del Factory
// ──────────────────────────────────────────────────────────────────────

export interface EnqueueEpicResponse {
  batchId: string;
  epicId: string;
  epicTitle: string;
  storiesCount: number;
  totalStoryPoints: number;
  enqueuedAt: string;
  enqueuedBy: string;
  enqueuedByName: string;
}

/**
 * Envía una épica al Forge ("in queue"). Backend valida:
 *  - Pod intersection (CWE-639).
 *  - Definición completa (9 headings) + diagrama negocio + ≥1 historia.
 *  - Los 3 VoBos approved (PO, TL, QA).
 *  - Idempotency: 409 si ya está encolada.
 *
 * Una vez enviada, `epic.enqueuedAt` queda set en DB y el banner cambia
 * a "Épica enviada al Forge".
 */
export function enqueueEpicToForge(epicId: string) {
  return apiFetch<EnqueueEpicResponse>(`/factory/queue/enqueue/${epicId}`, {
    method: 'POST',
  });
}

/**
 * Sube un bundle ZIP de Claude Design al backend para asociarlo como
 * diseño de la épica. Usa multipart/form-data — NO `apiFetch` porque
 * éste fuerza `Content-Type: application/json` y rompe los boundaries
 * que el browser genera automáticamente para FormData.
 *
 * El proxy BFF reenvía el body multipart intacto al backend NestJS
 * (`FileInterceptor('file')` lo procesa con multer).
 */
export async function uploadDesignBundle(
  epicId: string,
  input: { name: string; description: string; file: File },
): Promise<import('@cenzontle/shared').EpicDesign> {
  const fd = new FormData();
  fd.append('name', input.name);
  fd.append('description', input.description);
  fd.append('file', input.file);

  const res = await fetch(`/api/proxy/proyectos/epicas/${epicId}/designs/upload`, {
    method: 'POST',
    body: fd,
    // NO seteamos Content-Type — el browser lo construye con el boundary
    // correcto al detectar el body como FormData.
  });

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/auth/login';
      return new Promise<never>(() => {});
    }
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || `Error ${res.status} al subir el bundle.`);
  }
  return res.json();
}
