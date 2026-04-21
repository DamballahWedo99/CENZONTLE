import { describe, it, expect, vi } from 'vitest';
import {
  matchShortcut,
  isTypingTarget,
  useDiagramKeyboard,
} from '../editor/useDiagramKeyboard';

// ────────────────────────────────────────────────────────────────────────────
// Helpers: construcción de KeyboardEvents sintéticos
// ────────────────────────────────────────────────────────────────────────────

interface KeyOpts {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}

/**
 * Crea un KeyboardEvent con un target arbitrario (opcional). jsdom no
 * permite setear `target` en el constructor, así que lo sobreescribimos
 * con defineProperty — suficiente para los checks de `matchShortcut`.
 */
function makeKey(opts: KeyOpts): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key: opts.key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target !== undefined) {
    Object.defineProperty(e, 'target', { value: opts.target, enumerable: true });
  }
  return e;
}

// ────────────────────────────────────────────────────────────────────────────
// isTypingTarget
// ────────────────────────────────────────────────────────────────────────────

describe('isTypingTarget', () => {
  it('target null → false', () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it('INPUT → true', () => {
    const el = document.createElement('input');
    expect(isTypingTarget(el)).toBe(true);
  });

  it('TEXTAREA → true', () => {
    const el = document.createElement('textarea');
    expect(isTypingTarget(el)).toBe(true);
  });

  it('SELECT → true (evita disparar shortcuts mientras user navega combos)', () => {
    const el = document.createElement('select');
    expect(isTypingTarget(el)).toBe(true);
  });

  it('DIV con contenteditable=true → true', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    expect(isTypingTarget(el)).toBe(true);
  });

  it('BUTTON → false (no es input de texto)', () => {
    const el = document.createElement('button');
    expect(isTypingTarget(el)).toBe(false);
  });

  it('DIV normal → false', () => {
    const el = document.createElement('div');
    expect(isTypingTarget(el)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// matchShortcut — delete / escape
// ────────────────────────────────────────────────────────────────────────────

describe('matchShortcut — Delete / Backspace / Escape', () => {
  it('Delete → delete', () => {
    expect(matchShortcut(makeKey({ key: 'Delete' }))).toBe('delete');
  });

  it('Backspace → delete', () => {
    expect(matchShortcut(makeKey({ key: 'Backspace' }))).toBe('delete');
  });

  it('Cmd+Delete → null (no interceptar, puede ser shortcut del SO)', () => {
    expect(matchShortcut(makeKey({ key: 'Delete', metaKey: true }))).toBeNull();
  });

  it('Escape → escape', () => {
    expect(matchShortcut(makeKey({ key: 'Escape' }))).toBe('escape');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// matchShortcut — undo / redo
// ────────────────────────────────────────────────────────────────────────────

describe('matchShortcut — undo / redo', () => {
  it('Cmd+Z sin shift → undo', () => {
    expect(matchShortcut(makeKey({ key: 'z', metaKey: true }))).toBe('undo');
  });

  it('Ctrl+Z sin shift → undo (Windows/Linux)', () => {
    expect(matchShortcut(makeKey({ key: 'z', ctrlKey: true }))).toBe('undo');
  });

  it('Cmd+Shift+Z → redo', () => {
    // Con Shift, `key` suele llegar en mayúscula — verificamos case-insensitive.
    expect(
      matchShortcut(makeKey({ key: 'Z', metaKey: true, shiftKey: true })),
    ).toBe('redo');
  });

  it('Ctrl+Y → redo (convención Windows)', () => {
    expect(matchShortcut(makeKey({ key: 'y', ctrlKey: true }))).toBe('redo');
  });

  it('Cmd+Y → redo', () => {
    expect(matchShortcut(makeKey({ key: 'y', metaKey: true }))).toBe('redo');
  });

  it('Z sin modifier → null', () => {
    expect(matchShortcut(makeKey({ key: 'z' }))).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// matchShortcut — duplicate / select all
// ────────────────────────────────────────────────────────────────────────────

describe('matchShortcut — duplicate / selectAll', () => {
  it('Cmd+D → duplicate', () => {
    expect(matchShortcut(makeKey({ key: 'd', metaKey: true }))).toBe(
      'duplicate',
    );
  });

  it('Ctrl+D → duplicate', () => {
    expect(matchShortcut(makeKey({ key: 'd', ctrlKey: true }))).toBe(
      'duplicate',
    );
  });

  it('Cmd+Shift+D → null (Shift+D no está mapeado)', () => {
    expect(
      matchShortcut(makeKey({ key: 'D', metaKey: true, shiftKey: true })),
    ).toBeNull();
  });

  it('Cmd+A → selectAll', () => {
    expect(matchShortcut(makeKey({ key: 'a', metaKey: true }))).toBe(
      'selectAll',
    );
  });

  it('Ctrl+A → selectAll', () => {
    expect(matchShortcut(makeKey({ key: 'a', ctrlKey: true }))).toBe(
      'selectAll',
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// matchShortcut — nudge (arrow keys)
// ────────────────────────────────────────────────────────────────────────────

describe('matchShortcut — arrow nudge', () => {
  it('ArrowUp sin shift → nudge(0, -10)', () => {
    expect(matchShortcut(makeKey({ key: 'ArrowUp' }))).toEqual({
      type: 'nudge',
      dx: 0,
      dy: -10,
    });
  });

  it('ArrowDown sin shift → nudge(0, 10)', () => {
    expect(matchShortcut(makeKey({ key: 'ArrowDown' }))).toEqual({
      type: 'nudge',
      dx: 0,
      dy: 10,
    });
  });

  it('ArrowLeft sin shift → nudge(-10, 0)', () => {
    expect(matchShortcut(makeKey({ key: 'ArrowLeft' }))).toEqual({
      type: 'nudge',
      dx: -10,
      dy: 0,
    });
  });

  it('ArrowRight sin shift → nudge(10, 0)', () => {
    expect(matchShortcut(makeKey({ key: 'ArrowRight' }))).toEqual({
      type: 'nudge',
      dx: 10,
      dy: 0,
    });
  });

  it('Shift+ArrowUp → nudge(0, -50) (paso grande)', () => {
    expect(matchShortcut(makeKey({ key: 'ArrowUp', shiftKey: true }))).toEqual({
      type: 'nudge',
      dx: 0,
      dy: -50,
    });
  });

  it('Shift+ArrowRight → nudge(50, 0)', () => {
    expect(
      matchShortcut(makeKey({ key: 'ArrowRight', shiftKey: true })),
    ).toEqual({ type: 'nudge', dx: 50, dy: 0 });
  });

  it('Cmd+ArrowUp → null (evita choque con navegación de texto del SO)', () => {
    expect(matchShortcut(makeKey({ key: 'ArrowUp', metaKey: true }))).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// matchShortcut — typing bail-out
// ────────────────────────────────────────────────────────────────────────────

describe('matchShortcut — typing target bail-out', () => {
  it('Delete sobre INPUT → null (no borra el node)', () => {
    const input = document.createElement('input');
    expect(matchShortcut(makeKey({ key: 'Delete', target: input }))).toBeNull();
  });

  it('Cmd+Z sobre TEXTAREA → null (deja al browser manejar undo del texto)', () => {
    const ta = document.createElement('textarea');
    expect(
      matchShortcut(makeKey({ key: 'z', metaKey: true, target: ta })),
    ).toBeNull();
  });

  it('ArrowUp sobre INPUT → null (no mueve nodes mientras navegas por el texto)', () => {
    const input = document.createElement('input');
    expect(
      matchShortcut(makeKey({ key: 'ArrowUp', target: input })),
    ).toBeNull();
  });

  it('Escape sobre INPUT → null (lo delegamos al componente que tenga el focus)', () => {
    const input = document.createElement('input');
    expect(matchShortcut(makeKey({ key: 'Escape', target: input }))).toBeNull();
  });

  it('Delete sobre DIV normal → delete (no es typing target)', () => {
    const div = document.createElement('div');
    expect(matchShortcut(makeKey({ key: 'Delete', target: div }))).toBe(
      'delete',
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// matchShortcut — no-match
// ────────────────────────────────────────────────────────────────────────────

describe('matchShortcut — teclas no mapeadas', () => {
  it('Tab → null', () => {
    expect(matchShortcut(makeKey({ key: 'Tab' }))).toBeNull();
  });

  it('Enter → null', () => {
    expect(matchShortcut(makeKey({ key: 'Enter' }))).toBeNull();
  });

  it('Space → null', () => {
    expect(matchShortcut(makeKey({ key: ' ' }))).toBeNull();
  });

  it('letra random sin modifier → null', () => {
    expect(matchShortcut(makeKey({ key: 'x' }))).toBeNull();
  });

  it('Cmd+X → null (cut no está mapeado aún)', () => {
    expect(matchShortcut(makeKey({ key: 'x', metaKey: true }))).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// useDiagramKeyboard — integración con window listener
//
// Nota: no tenemos @testing-library/react, así que renderizamos el hook
// manualmente invocando el useEffect a través de un componente mínimo.
// En su lugar usamos un enfoque aún más simple: probamos el efecto
// observable del hook — que dispatching window.keydown llama a los
// callbacks — usando una función helper que ejecuta el hook en un
// runtime controlado.
// ────────────────────────────────────────────────────────────────────────────

describe('useDiagramKeyboard — exports', () => {
  it('exporta una función (tipo del hook)', () => {
    // Sanity check: el símbolo existe y es función. La cobertura funcional
    // del comportamiento del listener está en los tests de `matchShortcut`
    // arriba + el test de integración siguiente.
    expect(typeof useDiagramKeyboard).toBe('function');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Integración ligera: el hook registra listeners y despacha.
//
// Trick: ejecutamos el cuerpo del hook montando un componente funcional
// mínimo con ReactDOM. Si no disponible, el test se salta.
// ────────────────────────────────────────────────────────────────────────────

describe('useDiagramKeyboard — integración window listener', () => {
  it('dispara onDelete al presionar Delete con enabled=true', async () => {
    const { renderHookLike } = createHookRunner();

    const onDelete = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onDuplicate = vi.fn();
    const onSelectAll = vi.fn();
    const onEscape = vi.fn();
    const onNudge = vi.fn();

    const cleanup = renderHookLike(() =>
      useDiagramKeyboard({
        enabled: true,
        onDelete,
        onUndo,
        onRedo,
        onDuplicate,
        onSelectAll,
        onEscape,
        onNudge,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();

    cleanup();
  });

  it('no registra listener cuando enabled=false', () => {
    const { renderHookLike } = createHookRunner();
    const onDelete = vi.fn();

    const cleanup = renderHookLike(() =>
      useDiagramKeyboard({
        enabled: false,
        onDelete,
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onDuplicate: vi.fn(),
        onSelectAll: vi.fn(),
        onEscape: vi.fn(),
        onNudge: vi.fn(),
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );

    expect(onDelete).not.toHaveBeenCalled();
    cleanup();
  });

  it('dispara onNudge con dx/dy correctos para Shift+ArrowRight', () => {
    const { renderHookLike } = createHookRunner();
    const onNudge = vi.fn();

    const cleanup = renderHookLike(() =>
      useDiagramKeyboard({
        enabled: true,
        onDelete: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onDuplicate: vi.fn(),
        onSelectAll: vi.fn(),
        onEscape: vi.fn(),
        onNudge,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(onNudge).toHaveBeenCalledTimes(1);
    expect(onNudge).toHaveBeenCalledWith(50, 0);
    cleanup();
  });

  it('remueve el listener al cleanup', () => {
    const { renderHookLike } = createHookRunner();
    const onDelete = vi.fn();

    const cleanup = renderHookLike(() =>
      useDiagramKeyboard({
        enabled: true,
        onDelete,
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onDuplicate: vi.fn(),
        onSelectAll: vi.fn(),
        onEscape: vi.fn(),
        onNudge: vi.fn(),
      }),
    );

    cleanup();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );

    expect(onDelete).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Runner mínimo para hooks sin @testing-library/react
//
// Usa React + react-dom/client para montar un componente stub. Retorna
// un cleanup que desmonta y corre los useEffect cleanups.
// ────────────────────────────────────────────────────────────────────────────

function createHookRunner() {
  // Import diferido (require) en vez de import top-level porque sólo
  // necesitamos React en los tests de integración del hook — los tests de
  // `matchShortcut` son puros.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactDOMClient = require('react-dom/client') as typeof import('react-dom/client');
  const act = React.act;

  function renderHookLike(hook: () => void): () => void {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const HookHost: React.FC = () => {
      hook();
      return null;
    };

    act(() => {
      root.render(React.createElement(HookHost));
    });

    return () => {
      act(() => {
        root.unmount();
      });
    };
  }

  return { renderHookLike };
}
