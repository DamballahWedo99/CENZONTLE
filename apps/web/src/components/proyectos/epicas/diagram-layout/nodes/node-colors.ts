import type { DiagramNodeGroup } from '@cenzontle/shared';

/**
 * Devuelve el valor CSS para `backgroundColor` del nodo basado en su grupo.
 *
 * El sistema de colores es ahora **únicamente por grupo** (gestión org-wide
 * via `useOrgDiagramTheme`). Se removió el color "genérico" del tema personal
 * — cada nodo se distingue solo por su grupo semántico.
 *
 * Cascada:
 *   1. `var(--diagram-group-${group}-bg, ...)`: el color configurado para
 *      ese grupo por Alta Gerencia. Se setea en el `style` del contenedor
 *      de DiagramViewer.tsx.
 *   2. `#27272a`: fallback hardcoded (zinc-800) para cuando el nodo viva
 *      fuera del viewer (storybook, screenshots) o no tenga grupo asignado.
 *
 * Uso: style inline con `backgroundColor: getGroupBackground(data.group)`.
 * Usamos inline style (no Tailwind arbitrary value) porque Tailwind extrae
 * las clases at build time y no soporta interpolación runtime del nombre
 * de la variable CSS (el nombre cambia según `data.group`).
 */
export function getGroupBackground(group?: DiagramNodeGroup): string {
  if (!group) return '#27272a';
  return `var(--diagram-group-${group}-bg, #27272a)`;
}
