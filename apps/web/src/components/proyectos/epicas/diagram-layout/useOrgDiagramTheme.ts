'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_DIAGRAM_GROUP_COLORS,
  DEFAULT_DIAGRAM_TEXT_COLORS,
  Permission,
  type DiagramGroupColors,
  type DiagramTextColors,
} from '@cenzontle/shared';
import { useAuthContext } from '@/context/AuthContext';
import { fetchDiagramTheme, updateDiagramTheme } from '@/lib/api/diagram-theme';

export interface UseOrgDiagramThemeReturn {
  /** Colores efectivos: defaults + overrides del server una vez fetched. */
  colors: DiagramGroupColors;
  /** Colores de texto (título/descripción) efectivos. */
  textColors: DiagramTextColors;
  /** `true` cuando el primer fetch concluyó (éxito o fallo). */
  isLoaded: boolean;
  /** `true` si el user tiene `manage:diagram-theme` (alta gerencia por default). */
  canEdit: boolean;
  /** Guarda un override parcial/completo. Retorna `true` si el server confirmó. */
  save: (next: DiagramGroupColors) => Promise<boolean>;
  /**
   * Guarda los colores de texto. El PUT incluye `colors` actual para que el
   * backend reciba el estado completo del tema — previene inconsistencias
   * si otro tab ya cambió `colors` en paralelo (last-write-wins consciente).
   */
  saveTextColors: (next: DiagramTextColors) => Promise<boolean>;
  /** Restaura todos los grupos + textColors a los defaults. */
  reset: () => Promise<boolean>;
}

/**
 * State + fetch del tema de colores-por-grupo a nivel organización.
 *
 * Decisiones clave:
 *
 *  - **Mount-time defaults**: arrancamos con `DEFAULT_DIAGRAM_GROUP_COLORS`
 *    y disparamos el fetch en `useEffect`. Eso evita flicker en SSR
 *    (el server no tiene acceso al state del viewer) y permite que el
 *    diagrama renderice inmediatamente con colores razonables mientras
 *    la red resuelve.
 *
 *  - **Fail-soft**: si el fetch o el PUT fallan, mantenemos los defaults/
 *    el state previo. Nunca rompemos la UI por un error de tema — los
 *    diagramas siguen siendo legibles con los colores canónicos.
 *
 *  - **Optimistic updates**: en `save()` actualizamos el state ANTES del
 *    PUT para que el color picker sea responsivo (el user ve el cambio
 *    instantáneo). Si el PUT falla, revertimos al state previo. Esto
 *    refleja la realidad: el servidor casi siempre acepta el valor
 *    (RBAC ya validado client-side), y el picker nativo del OS genera
 *    muchos `onChange` por drag — sin optimistic se vería laggy.
 *
 *  - **Single-org**: no hay `orgId` porque el backend opera en modo
 *    single-tenant. Si en el futuro se añade multi-org, el hook sería
 *    parametrizable por orgId sin cambios de signature externo.
 */
export function useOrgDiagramTheme(): UseOrgDiagramThemeReturn {
  const { hasPermission } = useAuthContext();
  const [colors, setColors] = useState<DiagramGroupColors>(DEFAULT_DIAGRAM_GROUP_COLORS);
  const [textColors, setTextColors] = useState<DiagramTextColors>(DEFAULT_DIAGRAM_TEXT_COLORS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Montaje: guard para que el fetch solo dispare UNA vez en StrictMode
  // (React 18+ en dev monta, desmonta y remonta los effects). Sin este
  // guard se disparan 2 GET /diagram-theme innecesarios en develop.
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    fetchDiagramTheme().then((res) => {
      if (cancelled) return;
      if (res?.colors) {
        // Merge defensivo: si el backend devuelve solo un subset de grupos
        // (ej: tras migración parcial), los grupos faltantes usan defaults.
        // Esto garantiza que `colors[group]` SIEMPRE sea string y no undefined.
        setColors({ ...DEFAULT_DIAGRAM_GROUP_COLORS, ...res.colors });
      }
      // `textColors` puede venir undefined si el backend aún no pobló el
      // campo (migration parcial). Fallback a defaults para no aplicar un
      // parcial sobre el state inicial y dejar `title` o `description` vacío.
      if (res?.textColors) {
        setTextColors({ ...DEFAULT_DIAGRAM_TEXT_COLORS, ...res.textColors });
      }
      setIsLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const canEdit = hasPermission(Permission.MANAGE_DIAGRAM_THEME);

  const save = useCallback(
    async (next: DiagramGroupColors): Promise<boolean> => {
      // Optimistic update: capturamos el previous para rollback y
      // actualizamos el state inmediatamente. El picker nativo va a
      // disparar muchos `onChange` durante un drag; sin optimistic el
      // feedback visual sería dependiente del RTT del backend.
      let previous: DiagramGroupColors | null = null;
      setColors((prev) => {
        previous = prev;
        return next;
      });

      // Enviamos también `textColors` actual: el backend recibe el estado
      // completo y evitamos que un PUT parcial tumbe los valores de texto
      // si la API decidiera sobreescribir campos no provistos con defaults.
      const result = await updateDiagramTheme({ colors: next, textColors });
      if (!result) {
        // Rollback — el servidor rechazó o la red falló. Volvemos a
        // `previous` para que el picker refleje el último estado válido.
        if (previous) setColors(previous);
        return false;
      }

      // Sincronizamos con la respuesta canónica del server (defensivo:
      // el server podría aplicar validación/normalización que cambie el
      // valor enviado).
      setColors({ ...DEFAULT_DIAGRAM_GROUP_COLORS, ...result.colors });
      if (result.textColors) {
        setTextColors({ ...DEFAULT_DIAGRAM_TEXT_COLORS, ...result.textColors });
      }
      return true;
    },
    [textColors],
  );

  const saveTextColors = useCallback(
    async (next: DiagramTextColors): Promise<boolean> => {
      // Optimistic equivalente al de `save()` — los color pickers de texto
      // se comportan igual (drag del picker nativo = muchos onChange).
      let previous: DiagramTextColors | null = null;
      setTextColors((prev) => {
        previous = prev;
        return next;
      });

      const result = await updateDiagramTheme({ colors, textColors: next });
      if (!result) {
        if (previous) setTextColors(previous);
        return false;
      }

      if (result.colors) {
        setColors({ ...DEFAULT_DIAGRAM_GROUP_COLORS, ...result.colors });
      }
      if (result.textColors) {
        setTextColors({ ...DEFAULT_DIAGRAM_TEXT_COLORS, ...result.textColors });
      }
      return true;
    },
    [colors],
  );

  const reset = useCallback(async (): Promise<boolean> => {
    // Reset atómico: un único PUT que manda ambos payloads a defaults
    // evita dos round-trips y la ventana donde solo un lado estaría
    // reseteado (UX inconsistente si el segundo PUT tarda).
    let previousColors: DiagramGroupColors | null = null;
    let previousTextColors: DiagramTextColors | null = null;
    setColors((prev) => {
      previousColors = prev;
      return DEFAULT_DIAGRAM_GROUP_COLORS;
    });
    setTextColors((prev) => {
      previousTextColors = prev;
      return DEFAULT_DIAGRAM_TEXT_COLORS;
    });

    const result = await updateDiagramTheme({
      colors: DEFAULT_DIAGRAM_GROUP_COLORS,
      textColors: DEFAULT_DIAGRAM_TEXT_COLORS,
    });
    if (!result) {
      if (previousColors) setColors(previousColors);
      if (previousTextColors) setTextColors(previousTextColors);
      return false;
    }

    setColors({ ...DEFAULT_DIAGRAM_GROUP_COLORS, ...result.colors });
    if (result.textColors) {
      setTextColors({ ...DEFAULT_DIAGRAM_TEXT_COLORS, ...result.textColors });
    }
    return true;
  }, []);

  return { colors, textColors, isLoaded, canEdit, save, saveTextColors, reset };
}
