import type { DiscoveredDependency, EpicDesign } from '@cenzontle/shared';
import { apiFetch } from './client';

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
  poApproval: any;
  tlApproval: any;
  qaApproval: any;
  qaMatrix: any;
  epicQAMatrix: any;
  tracker: any;
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
