'use client';

import { useEffect } from 'react';

/**
 * Resultado de parsear un KeyboardEvent contra el mapa de shortcuts del
 * editor de diagramas. `null` significa "ignorar" (no intercepta la tecla).
 *
 * Se separa de `useDiagramKeyboard` para permitir tests puros sin montar
 * React: el hook solo despacha sobre el resultado de este helper.
 */
export type ShortcutAction =
  | 'delete'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'selectAll'
  | 'escape'
  | { type: 'nudge'; dx: number; dy: number };

/** Paso base de arrow keys sin modifier. */
const NUDGE_STEP = 10;
/** Paso grande con Shift (convención Figma/Excalidraw/PowerPoint). */
const NUDGE_STEP_LARGE = 50;

/**
 * Indica si el target del evento es un input-like donde el user está
 * escribiendo — en ese caso NO interceptamos teclas para no romper la
 * edición (ej: Delete en el `PropertyPanel` debe borrar el caracter, no
 * el node).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // `isContentEditable` es el check canónico en browsers reales, pero jsdom no
  // lo deriva del atributo/propiedad. Triple check por robustez:
  //   1) propiedad runtime (funciona en browser).
  //   2) atributo DOM (funciona si lo setearon por attr).
  //   3) property accessor (funciona en jsdom cuando lo seteas por setter).
  if (el.isContentEditable) return true;
  const attr = el.getAttribute?.('contenteditable');
  if (attr != null && attr !== 'false' && attr !== 'inherit') return true;
  const prop = (el as unknown as { contentEditable?: string }).contentEditable;
  if (prop != null && prop !== 'false' && prop !== 'inherit' && prop !== '') {
    return true;
  }
  return false;
}

/**
 * Función pura: recibe un KeyboardEvent y retorna la acción semántica
 * del editor, o `null` si no matchea ningún shortcut (o si el target es
 * un campo de texto).
 *
 * Diseño: Cmd (Mac) y Ctrl (Win/Linux) son intercambiables — usamos
 * `metaKey || ctrlKey`. Esto difiere de apps que sólo aceptan Cmd en Mac,
 * pero la mayoría de apps cross-platform (VSCode, Figma web) lo permiten.
 */
export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  if (isTypingTarget(e.target)) return null;

  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;

  // Delete / Backspace → borrar selección. Sin modifiers: si tuviera Cmd/Ctrl
  // podría chocar con "back" del browser en algunos contextos.
  if ((key === 'Delete' || key === 'Backspace') && !mod) {
    return 'delete';
  }

  if (key === 'Escape') {
    return 'escape';
  }

  // Undo/Redo: Cmd+Z, Cmd+Shift+Z, Cmd+Y.
  // `key` para 'z' llega en minúscula si no hay Shift, y 'Z' con Shift — se
  // compara case-insensitive para robustez.
  if (mod) {
    const lower = key.toLowerCase();

    if (lower === 'z' && !e.shiftKey) return 'undo';
    if (lower === 'z' && e.shiftKey) return 'redo';
    if (lower === 'y' && !e.shiftKey) return 'redo';

    if (lower === 'd' && !e.shiftKey) return 'duplicate';
    if (lower === 'a' && !e.shiftKey) return 'selectAll';
  }

  // Arrow keys → nudge. NO con Cmd/Ctrl (evita colisionar con navegación de
  // workspaces del SO o del browser, ej: Cmd+Arrow = ir al inicio/fin de línea).
  if (!mod) {
    const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    switch (key) {
      case 'ArrowUp':
        return { type: 'nudge', dx: 0, dy: -step };
      case 'ArrowDown':
        return { type: 'nudge', dx: 0, dy: step };
      case 'ArrowLeft':
        return { type: 'nudge', dx: -step, dy: 0 };
      case 'ArrowRight':
        return { type: 'nudge', dx: step, dy: 0 };
    }
  }

  return null;
}

export interface UseDiagramKeyboardArgs {
  /** Típicamente `isEditing`. Si false, los listeners NO se registran. */
  enabled: boolean;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onSelectAll: () => void;
  onEscape: () => void;
  onNudge: (dx: number, dy: number) => void;
}

/**
 * Registra un listener global de `keydown` sobre `window` y despacha a los
 * callbacks según el shortcut. Sólo se activa cuando `enabled` es true.
 *
 * Decisiones:
 *   - Window (no document): permite interceptar aunque el focus esté en
 *     body/html, que es lo común cuando el user clickea en el canvas de
 *     React Flow.
 *   - `preventDefault()` sólo si matcheó un shortcut — de lo contrario
 *     interferimos con otras teclas (tab navigation, typing en otros
 *     componentes fuera del diagrama si los hubiera).
 *   - `isTypingTarget` bail-out dentro de `matchShortcut` para mantener la
 *     lógica en un solo lugar y testeable sin montar React.
 */
export function useDiagramKeyboard(args: UseDiagramKeyboardArgs): void {
  const {
    enabled,
    onDelete,
    onUndo,
    onRedo,
    onDuplicate,
    onSelectAll,
    onEscape,
    onNudge,
  } = args;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const action = matchShortcut(e);
      if (!action) return;

      e.preventDefault();

      if (typeof action === 'object') {
        onNudge(action.dx, action.dy);
        return;
      }

      switch (action) {
        case 'delete':
          onDelete();
          break;
        case 'undo':
          onUndo();
          break;
        case 'redo':
          onRedo();
          break;
        case 'duplicate':
          onDuplicate();
          break;
        case 'selectAll':
          onSelectAll();
          break;
        case 'escape':
          onEscape();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    enabled,
    onDelete,
    onUndo,
    onRedo,
    onDuplicate,
    onSelectAll,
    onEscape,
    onNudge,
  ]);
}
