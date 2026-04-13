import { apiFetch } from './client';

export interface PodResponse {
  id: string;
  name: string;
  description: string;
  color: string;
  epicCount: number;
  createdAt: string;
  updatedAt: string;
}

export function getPods() {
  return apiFetch<PodResponse[]>('/proyectos/pods');
}

export function getPod(id: string) {
  return apiFetch<PodResponse>(`/proyectos/pods/${id}`);
}

export function createPod(data: { name: string; description: string; color: string }) {
  return apiFetch<PodResponse>('/proyectos/pods', { method: 'POST', body: JSON.stringify(data) });
}

export function updatePod(id: string, data: Partial<{ name: string; description: string; color: string }>) {
  return apiFetch<PodResponse>(`/proyectos/pods/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deletePod(id: string) {
  return apiFetch<void>(`/proyectos/pods/${id}`, { method: 'DELETE' });
}
