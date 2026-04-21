'use client';

import { useCallback, useEffect, useState } from 'react';

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

/**
 * State + persistencia del tema del diagrama. El tema sobrevive a refreshes
 * y se propaga vía CSS variables en el contenedor del viewer, para que los
 * custom nodes lo consuman sin re-renders individuales.
 *
 * SSR-safe: arranca con DEFAULT_DIAGRAM_THEME y se hidrata desde localStorage
 * en un `useEffect` tras mount. Durante ese primer flicker (ms) el diagrama
 * se ve con los defaults; el salto al theme personalizado es imperceptible.
 */
export function useDiagramTheme() {
  const [theme, setTheme] = useState<DiagramTheme>(DEFAULT_DIAGRAM_THEME);

  useEffect(() => {
    setTheme(loadTheme());
  }, []);

  const persist = useCallback((next: DiagramTheme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota excedida / localStorage deshabilitado → ignorar; el theme
      // sigue funcionando en memoria solo por esta sesión.
    }
  }, []);

  const setBackground = useCallback(
    (color: string) => {
      setTheme((prev) => {
        const next = { ...prev, background: color };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setTheme(DEFAULT_DIAGRAM_THEME);
    persist(DEFAULT_DIAGRAM_THEME);
  }, [persist]);

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
