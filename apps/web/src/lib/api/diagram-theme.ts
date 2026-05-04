import type { DiagramGroupColors, DiagramTextColors } from '@cenzontle/shared';
import { apiFetch } from './client';

export interface DiagramThemeResponse {
  colors: DiagramGroupColors;
  /**
   * Colores de texto (título/descripción) a nivel organización. Puede venir
   * `undefined` si el backend no ha poblado el campo aún (migration parcial
   * o instancias viejas). El hook consumidor aplica `DEFAULT_DIAGRAM_TEXT_COLORS`
   * como fallback.
   */
  textColors?: DiagramTextColors;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Payload aceptado por `PUT /diagram-theme`. Ambos campos son opcionales
 * en el cliente — el hook envía SIEMPRE `colors`+`textColors` juntos para
 * evitar que un PUT parcial deje campos inconsistentes, pero tipamos como
 * opcional para no forzar al call site cuando solo quiere actualizar uno.
 */
export interface DiagramThemeUpdatePayload {
  colors?: DiagramGroupColors;
  textColors?: DiagramTextColors;
}

/**
 * Lee el tema global de diagramas (colores por grupo) de la organización.
 *
 * Por qué `GET` es público:
 *   - El tema se aplica a TODOS los diagramas que cualquier usuario ve,
 *     incluso viewers. Requerir un permiso específico para leerlo rompería
 *     el rendering para la mayoría de roles.
 *   - El endpoint devuelve solo data de presentación (hex colors +
 *     timestamps), sin información sensible.
 *
 * Por qué devuelve `null` en error en vez de throw:
 *   - El componente consumidor (`useOrgDiagramTheme`) ya arranca con
 *     `DEFAULT_DIAGRAM_GROUP_COLORS`. Si la API falla (red caída, API
 *     down), la UI debe degradar a los defaults, NO crashear el diagrama.
 *   - `fail-soft` es el comportamiento correcto para un tema de
 *     presentación. Los errores reales (401, 500) se registran en
 *     consola para observabilidad.
 */
export async function fetchDiagramTheme(): Promise<DiagramThemeResponse | null> {
  try {
    return await apiFetch<DiagramThemeResponse>('/diagram-theme');
  } catch {
    return null;
  }
}

/**
 * Actualiza el tema global de diagramas. Requiere `manage:diagram-theme`
 * (solo `alta_gerencia` por default). El backend valida el permiso;
 * retornar `null` aquí cubre tanto errores de red como 403 inesperado
 * (ej: el UI no hizo el gating correcto por race condition entre RBAC
 * load y click del user).
 */
export async function updateDiagramTheme(
  payload: DiagramThemeUpdatePayload,
): Promise<DiagramThemeResponse | null> {
  try {
    return await apiFetch<DiagramThemeResponse>('/diagram-theme', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}
