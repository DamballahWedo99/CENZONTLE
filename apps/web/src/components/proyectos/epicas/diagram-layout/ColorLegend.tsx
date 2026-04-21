'use client';

import type { DiagramGroupColors, DiagramNodeGroup } from '@cenzontle/shared';
import { GROUP_LABELS } from './layout-constants';

// Orden visual — mismo que `DiagramThemePanel` para mantener consistencia
// entre el panel de configuración y la leyenda.
const GROUP_ORDER: DiagramNodeGroup[] = [
  'start',
  'frontend',
  'backend',
  'data',
  'infra',
  'external',
  'end',
];

interface ColorLegendProps {
  /**
   * Colores por grupo. Se reciben por prop (lifted state) desde el
   * `DiagramViewer`, que posee la única instance de `useOrgDiagramTheme`.
   *
   * Por qué no consumir el hook aquí: cada llamada a `useOrgDiagramTheme`
   * crea su propia `useState` aislado — si ColorLegend llamara el hook
   * directamente, los colores que el user modifica en el `DiagramThemePanel`
   * solo actualizarían la instance de DiagramViewer, dejando la leyenda
   * desincronizada hasta un refresh. Con lifted state, DiagramViewer es la
   * única fuente de verdad y ambos consumidores (panel + leyenda) reciben
   * el mismo objeto reactivo.
   */
  colors: DiagramGroupColors;
}

/**
 * Leyenda siempre visible que mapea color → grupo.
 *
 * Use case principal: al explicar un diagrama el user necesita poder señalar
 * un cluster y decir su layer sin detenerse a hover/click. Por eso el
 * componente NO es colapsable — muestra los 7 grupos en una lista compacta
 * fija, visible de un vistazo.
 *
 * Los colores son REACTIVOS al theme org-wide: cuando Alta Gerencia cambia
 * un color, el DiagramViewer propaga el nuevo `colors` por prop y la
 * leyenda se re-renderiza en vivo sin refresh.
 */
export function ColorLegend({ colors }: ColorLegendProps) {
  return (
    <div className="rounded-lg bg-zinc-900/90 border border-zinc-700 px-2.5 py-2 shadow-xl backdrop-blur-sm">
      <span className="block text-[9px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
        Grupos
      </span>
      <div className="space-y-1">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 flex-shrink-0 rounded-sm border border-zinc-700"
              style={{ backgroundColor: colors[group] }}
            />
            <span className="text-[10px] text-zinc-300 leading-none">
              {GROUP_LABELS[group]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
