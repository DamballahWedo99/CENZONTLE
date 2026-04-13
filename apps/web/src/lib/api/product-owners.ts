import { apiFetch } from './client';

export interface ProductOwnerResponse {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  podIds: string[];
  pods: { id: string; name: string; color: string }[];
  createdAt: string;
  updatedAt: string;
}

export function getProductOwners() {
  return apiFetch<ProductOwnerResponse[]>('/proyectos/product-owners');
}

export function createProductOwner(data: { name: string; email: string; avatarUrl?: string }) {
  return apiFetch<ProductOwnerResponse>('/proyectos/product-owners', { method: 'POST', body: JSON.stringify(data) });
}

export function updateProductOwner(id: string, data: Partial<{ name: string; email: string; avatarUrl: string }>) {
  return apiFetch<ProductOwnerResponse>(`/proyectos/product-owners/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteProductOwner(id: string) {
  return apiFetch<void>(`/proyectos/product-owners/${id}`, { method: 'DELETE' });
}
