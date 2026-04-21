'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Pencil,
  Copy,
  Trash2,
  ArrowRightLeft,
  Plus,
  type LucideIcon,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────────────

/**
 * Objetivo del click derecho. Discriminated union por `kind` para que el caller
 * pueda hacer pattern-matching seguro en los callbacks sin casts.
 *
 *   - `node`  → el user hizo right-click sobre un node del canvas.
 *   - `edge`  → sobre un edge (arista).
 *   - `pane`  → sobre el canvas vacío; `position` ya está proyectada al
 *                espacio del flow (coords internas de ReactFlow), no a coords
 *                de pantalla — lista para pasar a `addNode({x, y})`.
 */
export type ContextTarget =
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'pane'; position: { x: number; y: number } };

export interface DiagramContextMenuProps {
  /** Posición del cursor en pantalla (clientX, clientY). `null` = cerrado. */
  screenPosition: { x: number; y: number } | null;
  /** Qué se clickeó con right-click. `null` = cerrado. */
  target: ContextTarget | null;
  /** Inline label edit. El integrador normalmente abre `InlineLabelEditor`. */
  onEdit?: (target: ContextTarget) => void;
  /** Duplicar node/edge. Atajo default: Cmd/Ctrl+D. */
  onDuplicate?: (target: ContextTarget) => void;
  /** Eliminar node/edge. Atajo default: Del / Backspace. */
  onDelete?: (target: ContextTarget) => void;
  /** Abre submenu/dialog de tipos (node shape o edge variant). */
  onChangeType?: (target: ContextTarget) => void;
  /** Añadir node en la posición del flow donde se hizo right-click. */
  onAddNodeHere?: (position: { x: number; y: number }) => void;
  /** Cerrar (click fuera, Escape, acción ejecutada). Siempre obligatorio. */
  onClose: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Hook auxiliar
// ────────────────────────────────────────────────────────────────────────────

export interface UseContextMenuReturn {
  screenPosition: { x: number; y: number } | null;
  target: ContextTarget | null;
  open: (
    position: { x: number; y: number },
    target: ContextTarget,
  ) => void;
  close: () => void;
}

/**
 * Encapsula el state del menú contextual (posición + target). El caller hace
 * `const ctx = useContextMenu()` y luego wire los handlers de React Flow:
 *
 *   onNodeContextMenu={(e, n) => { e.preventDefault();
 *     ctx.open({x: e.clientX, y: e.clientY}, {kind:'node', nodeId: n.id}); }}
 *
 * Y pasa `ctx.screenPosition`, `ctx.target`, `onClose={ctx.close}` al menú.
 */
export function useContextMenu(): UseContextMenuReturn {
  const [screenPosition, setScreenPosition] = useState<
    { x: number; y: number } | null
  >(null);
  const [target, setTarget] = useState<ContextTarget | null>(null);

  const open = useCallback(
    (position: { x: number; y: number }, nextTarget: ContextTarget) => {
      setScreenPosition(position);
      setTarget(nextTarget);
    },
    [],
  );

  const close = useCallback(() => {
    setScreenPosition(null);
    setTarget(null);
  }, []);

  return { screenPosition, target, open, close };
}

// ────────────────────────────────────────────────────────────────────────────
// Componente
// ────────────────────────────────────────────────────────────────────────────

/**
 * Menú contextual flotante que aparece en la posición del cursor tras un
 * right-click sobre el diagrama. Presenta acciones distintas según el target:
 *
 *   - Node  → Editar, Duplicar, Cambiar tipo, Eliminar.
 *   - Edge  → Editar, Cambiar tipo, Eliminar.
 *   - Pane  → Añadir nodo aquí.
 *
 * Detalles de implementación:
 *
 *   1. **Auto-ajuste de viewport** — tras el primer render mide el rect real
 *      del menú y, si sobresale por la derecha o abajo, "refleja" el anchor
 *      hacia top-left del cursor en lugar de bottom-right. Evita que el menú
 *      quede cortado cerca de los bordes de la pantalla.
 *
 *   2. **Cierre por click fuera** — escucha `mousedown` (no `click`) en el
 *      documento. Usar `mousedown` es crítico: si el user hace click en otro
 *      elemento interactivo, queremos cerrar ANTES de que dispare su handler,
 *      simétrico a cómo macOS/Windows cierran context menus nativos.
 *
 *   3. **Cierre por Escape** — listener dedicado; no delega al editor padre
 *      para que Escape siempre tenga máxima prioridad mientras el menú abre.
 *
 *   4. **Atajos mostrados** — renderizados tenue a la derecha del label, sin
 *      vincularlos acá. El editor principal es dueño de `keydown` globales
 *      (Cmd+D, Del); el menú solo los muestra como hint visual.
 *
 * SRP: el menú NO conoce el catálogo de tipos de node/edge. `onChangeType`
 * delega al caller, que normalmente abre un submenu/dialog propio.
 */
export function DiagramContextMenu({
  screenPosition,
  target,
  onEdit,
  onDuplicate,
  onDelete,
  onChangeType,
  onAddNodeHere,
  onClose,
}: DiagramContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // ─── Auto-ajuste de posición post-mount ─────────────────────────────────
  //
  // Se ejecuta síncrono antes del paint (useLayoutEffect) para evitar el
  // flash del menú apareciendo y moviéndose un frame después. Mide el rect
  // real después del primer render — más confiable que hardcodear el tamaño.
  useLayoutEffect(() => {
    if (!screenPosition || !menuRef.current) {
      setAdjustedPosition(null);
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 8; // holgura con el borde del viewport

    let x = screenPosition.x;
    let y = screenPosition.y;

    // Overflow derecho → anclar por la derecha del menú (cursor queda en su top-right).
    if (x + rect.width + MARGIN > vw) {
      x = Math.max(MARGIN, x - rect.width);
    }
    // Overflow inferior → anclar por abajo del menú.
    if (y + rect.height + MARGIN > vh) {
      y = Math.max(MARGIN, y - rect.height);
    }

    setAdjustedPosition({ x, y });
  }, [screenPosition, target]);

  // ─── Click fuera para cerrar ─────────────────────────────────────────────
  useEffect(() => {
    if (!screenPosition || !target) return;

    const handleMouseDown = (event: MouseEvent) => {
      const menu = menuRef.current;
      if (!menu) return;
      if (event.target instanceof Node && menu.contains(event.target)) return;
      onClose();
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [screenPosition, target, onClose]);

  // ─── Escape para cerrar ──────────────────────────────────────────────────
  useEffect(() => {
    if (!screenPosition || !target) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [screenPosition, target, onClose]);

  if (!screenPosition || !target) return null;

  // Hasta que el layout effect corra (primer paint) usamos la posición raw;
  // el reflow del ajuste no es visible porque useLayoutEffect bloquea el paint.
  const pos = adjustedPosition ?? screenPosition;

  // Detecta macOS para mostrar el símbolo correcto del modifier.
  const isMac =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform ?? '');
  const modKey = isMac ? 'Cmd' : 'Ctrl';

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Menú contextual del diagrama"
      // stopPropagation en mousedown previene que el listener de click-fuera
      // cierre el menú al clickear un item (el listener escucha en document
      // pero contains() ya lo filtra; este stop es defensa adicional contra
      // listeners del editor que puedan interceptar primero).
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 1000,
      }}
      className="min-w-[180px] rounded-lg border border-zinc-700 bg-zinc-900/95 py-1 shadow-xl backdrop-blur-sm"
    >
      {target.kind === 'node' && (
        <>
          {onEdit && (
            <MenuItem
              icon={Pencil}
              label="Editar label"
              onClick={() => {
                onEdit(target);
                onClose();
              }}
            />
          )}
          {onDuplicate && (
            <MenuItem
              icon={Copy}
              label="Duplicar"
              shortcut={`${modKey}+D`}
              onClick={() => {
                onDuplicate(target);
                onClose();
              }}
            />
          )}
          {onChangeType && (
            <MenuItem
              icon={ArrowRightLeft}
              label="Cambiar tipo"
              trailing="›"
              onClick={() => {
                onChangeType(target);
                onClose();
              }}
            />
          )}
          {(onEdit || onDuplicate || onChangeType) && onDelete && <MenuSeparator />}
          {onDelete && (
            <MenuItem
              icon={Trash2}
              label="Eliminar"
              shortcut="Del"
              danger
              onClick={() => {
                onDelete(target);
                onClose();
              }}
            />
          )}
        </>
      )}

      {target.kind === 'edge' && (
        <>
          {onEdit && (
            <MenuItem
              icon={Pencil}
              label="Editar label"
              onClick={() => {
                onEdit(target);
                onClose();
              }}
            />
          )}
          {onChangeType && (
            <MenuItem
              icon={ArrowRightLeft}
              label="Cambiar tipo"
              trailing="›"
              onClick={() => {
                onChangeType(target);
                onClose();
              }}
            />
          )}
          {(onEdit || onChangeType) && onDelete && <MenuSeparator />}
          {onDelete && (
            <MenuItem
              icon={Trash2}
              label="Eliminar"
              shortcut="Del"
              danger
              onClick={() => {
                onDelete(target);
                onClose();
              }}
            />
          )}
        </>
      )}

      {target.kind === 'pane' && onAddNodeHere && (
        <MenuItem
          icon={Plus}
          label="Añadir nodo aquí"
          onClick={() => {
            onAddNodeHere(target.position);
            onClose();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  /** Atajo de teclado mostrado a la derecha (tenue). Solo informativo. */
  shortcut?: string;
  /** Glyph a la derecha (p.ej. "›" para indicar submenu). */
  trailing?: string;
  /** Estilo destructivo (rojo) para acciones como eliminar. */
  danger?: boolean;
  onClick: () => void;
}

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  trailing,
  danger,
  onClick,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-950/40 hover:text-red-300'
          : 'text-zinc-200 hover:bg-zinc-800'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-zinc-500 tabular-nums">
          {shortcut}
        </span>
      )}
      {trailing && (
        <span className="text-[10px] text-zinc-500">{trailing}</span>
      )}
    </button>
  );
}

function MenuSeparator() {
  return <hr className="my-1 border-zinc-800" />;
}
