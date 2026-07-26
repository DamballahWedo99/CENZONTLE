'use client';

import { useCallback, useSyncExternalStore } from 'react';

export interface DiagramTheme {
  /** Color del fondo del canvas (cualquier valor CSS válido, típicamente hex). */
  background: string;
}

/**
 * Default del fondo del canvas (`#18181b` = zinc-900). Los colores de los
 * nodos ya NO viven aquí — cada grupo tiene su propio color gestionado por
 * `useOrgDiagramTheme` (config org-wide, RBAC). La identidad visual de un
 * nodo se deriva completamente del color de su grupo.
 */
export const DEFAULT_DIAGRAM_THEME: DiagramTheme = {
  background: '#18181b',
};

const STORAGE_KEY = 'cenzontle:diagram-theme';

function loadTheme(): DiagramTheme {
  if (typeof window === 'undefined') return DEFAULT_DIAGRAM_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DIAGRAM_THEME;
    const parsed = JSON.parse(raw) as Partial<DiagramTheme>;
    return {
      background:
        typeof parsed.background === 'string' ? parsed.background : DEFAULT_DIAGRAM_THEME.background,
    };
  } catch {
    return DEFAULT_DIAGRAM_THEME;
  }
}

/*
 * ── Store del tema ────────────────────────────────────────────────────────
 *
 * El tema NO es estado de React: vive en localStorage, un sistema externo al
 * árbol. Lo modelamos como un store con `subscribe`/`getSnapshot` y lo leemos
 * con `useSyncExternalStore` — la API que React expone justo para esto. Así
 * el valor de localStorage entra en el render sin pasar por un `useEffect`
 * que haga `setState` (render extra + frame con el default).
 *
 * `memoryTheme` es el espejo en memoria y la fuente de verdad de la sesión:
 *   - Se carga perezosamente en la primera lectura del cliente.
 *   - `getSnapshot` DEBE devolver la misma referencia mientras nada cambie
 *     (si no, React entra en loop de renders) — por eso cacheamos el objeto
 *     y solo lo reemplazamos en `writeTheme`.
 *   - Si localStorage falla (quota / deshabilitado), el espejo igual se
 *     actualiza: el tema sigue funcionando en memoria por esta sesión.
 */
let memoryTheme: DiagramTheme | null = null;
const listeners = new Set<() => void>();

function getThemeSnapshot(): DiagramTheme {
  memoryTheme ??= loadTheme();
  return memoryTheme;
}

/**
 * Snapshot de servidor: siempre el default. Garantiza que el HTML de SSR y
 * el primer render de hidratación coincidan; React re-renderiza con el
 * snapshot de cliente inmediatamente después de hidratar (mismo instante en
 * que antes corría el `useEffect`).
 */
function getServerThemeSnapshot(): DiagramTheme {
  return DEFAULT_DIAGRAM_THEME;
}

function subscribeToTheme(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function writeTheme(next: DiagramTheme): void {
  memoryTheme = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota excedida / localStorage deshabilitado → ignorar; el theme
    // sigue funcionando en memoria solo por esta sesión.
  }
  for (const listener of listeners) listener();
}

/**
 * State + persistencia del tema del diagrama. El tema sobrevive a refreshes
 * y se propaga vía CSS variables en el contenedor del viewer, para que los
 * custom nodes lo consuman sin re-renders individuales.
 *
 * SSR-safe: durante SSR e hidratación devuelve DEFAULT_DIAGRAM_THEME y salta
 * al valor de localStorage apenas termina de hidratar. Durante ese primer
 * flicker (ms) el diagrama se ve con los defaults; el salto al theme
 * personalizado es imperceptible.
 */
export function useDiagramTheme() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const setBackground = useCallback((color: string) => {
    writeTheme({ ...getThemeSnapshot(), background: color });
  }, []);

  const reset = useCallback(() => {
    writeTheme(DEFAULT_DIAGRAM_THEME);
  }, []);

  return { theme, setBackground, reset };
}

/**
 * Determina si un color HEX (`#rrggbb`) es "claro" perceptualmente,
 * usando la fórmula YIQ (ponderación 299/587/114 reflejando la sensibilidad
 * humana a rojo/verde/azul).
 *
 * Usado para elegir automáticamente un color de contraste para los puntos
 * del background: sobre fondo oscuro → puntos claros; sobre fondo claro →
 * puntos oscuros. Evita que el usuario tenga que configurar un 3er color
 * manual.
 */
export function isLightColor(hex: string): boolean {
  // Manejo tolerante de formatos no-hex (ej: si el usuario pega rgb/rgba).
  // En ese caso asumimos oscuro por defecto; el picker nativo garantiza
  // hex al 99% de las veces.
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return false;

  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128;
}
