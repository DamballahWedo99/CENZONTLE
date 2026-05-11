'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ComputeNode, ResourcePool } from '@cenzontle/shared';
import {
  getComputeNodes,
  getActiveRuns,
  type ComputeNodeResponse,
  type ActiveRunResponse,
} from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';

/**
 * Mapea el shape del backend (`ComputeNodeResponse`) al shape mock que usa
 * el FactoryContext (`ComputeNode` de `@cenzontle/shared`). Diferencias:
 *  - `type` usa underscores en backend (`mac_mini`), dashes en frontend (`mac-mini`)
 *  - `agents` queda vacío hasta que tengamos `GET /factory/runs?nodeId=X`
 *    para enumerar runs activos por nodo (Sprint 4)
 *  - `lastHeartbeat` puede ser null en backend (nodo recién creado, sin
 *    handshake) → fallback a `createdAt` para que el mapping no rompa
 */
function mapBackendNodeToMock(
  node: ComputeNodeResponse,
  activeRuns: ActiveRunResponse[],
): ComputeNode {
  const typeMap: Record<ComputeNodeResponse['type'], ComputeNode['type']> = {
    local: 'local',
    mac_mini: 'mac-mini',
    cloud_vm: 'cloud-vm',
    gpu_instance: 'gpu-instance',
    other: 'other',
  };
  // Filtra runs activos de este nodo y los mapea al shape del frontend.
  // El "batchName" del shape mock se renderea en cards de agents — usamos
  // el `epicTitle` porque visualmente "qué épica está corriendo" es la
  // info más útil para el operador (los batches del frontend son derivados).
  const nodeRuns = activeRuns
    .filter((r) => r.nodeId === node.id)
    .map((r) => ({
      agentId: r.runId,
      batchId: r.epicId,
      batchName: r.epicTitle,
    }));

  return {
    id: node.id,
    name: node.name,
    type: typeMap[node.type] ?? 'other',
    os: node.os || '',
    location: node.location || '',
    ip: node.ip || '',
    status: node.effectiveStatus,
    totalSlots: node.totalSlots,
    agents: nodeRuns,
    addedAt: node.createdAt,
    lastHeartbeat: node.lastHeartbeat ?? node.createdAt,
  };
}

/**
 * Hook que devuelve el `ResourcePool` "efectivo" para el dashboard del
 * Forge: combina los nodos reales del backend (`GET /factory/nodes` con
 * polling 5s) con el mock del FactoryContext.
 *
 * Estrategia: si hay nodos reales, los usa; si no (API caída, sin auth,
 * primer render antes del fetch), fallback al mock para que la UI no se
 * quede vacía. El fallback es transparente — los componentes consumers
 * no necesitan distinguir entre "datos reales" y "mock".
 *
 * Polling: 5s, mismo intervalo que `ComputeNodesSection` en
 * `/factory/settings`. Eso garantiza consistencia entre vistas — un nodo
 * recién agregado aparece en `/factory`, `/factory/agents` y `/factory/settings`
 * al mismo tiempo (dentro del mismo tick de polling).
 *
 * Uso:
 * ```tsx
 * const effectivePool = useEffectiveResourcePool(state.factory.resourcePool);
 * <ResourcePoolDrawer pool={effectivePool} ... />
 * ```
 *
 * TODO Sprint 4: cuando `agents: []` se reemplace con runs reales del
 * backend (vía `GET /factory/runs?nodeId=X`), eliminar el mock del
 * FactoryContext y este fallback.
 */
export function useEffectiveResourcePool(mockPool: ResourcePool): ResourcePool {
  const [realNodes, setRealNodes] = useState<ComputeNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetchAndUpdate = async () => {
      try {
        // Fetch en paralelo: nodos + runs activos. Combinamos ambos al
        // mapear — cada nodo recibe su slice de runs activos en `agents`.
        // Si runs falla pero nodos OK, mostramos los nodos sin agents
        // (defensivo: el array vacío no rompe la UI).
        const [nodes, activeRuns] = await Promise.all([
          getComputeNodes(),
          getActiveRuns().catch((err) => {
            // Logueamos pero no rompemos — los nodos solos son útiles.
            if (!(err instanceof ApiError) || err.status !== 401) {
              console.warn('[useEffectiveResourcePool] active runs fetch failed', err);
            }
            return [] as ActiveRunResponse[];
          }),
        ]);
        if (cancelled) return;
        setRealNodes(nodes.map((n) => mapBackendNodeToMock(n, activeRuns)));
      } catch (err) {
        // 401 lo maneja el client wrapper (redirect a login). Otros
        // errores los silenciamos — el fallback al mock preserva la UX
        // sin romper la página.
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn('[useEffectiveResourcePool] failed to fetch nodes', err);
        }
      }
    };
    void fetchAndUpdate();
    const interval = setInterval(() => void fetchAndUpdate(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return useMemo(() => {
    const nodes = realNodes.length > 0 ? realNodes : mockPool.nodes;
    return {
      nodes,
      totalSlots: nodes.reduce((sum, n) => sum + n.totalSlots, 0),
      usedSlots: nodes.reduce((sum, n) => sum + n.agents.length, 0),
    };
  }, [realNodes, mockPool.nodes]);
}
