'use client';

import { useEffect, useState } from 'react';
import { Palette, RotateCcw, X, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { DiagramGroupColors, DiagramNodeGroup, DiagramTextColors } from '@cenzontle/shared';
import type { DiagramTheme } from './useDiagramTheme';
import { GROUP_LABELS } from './layout-constants';

interface DiagramThemePanelProps {
  theme: DiagramTheme;
  onBackgroundChange: (color: string) => void;
  /**
   * Reset del tema personal del usuario (fondo del canvas). Síncrono —
   * localStorage. El panel lo invoca junto con `onOrgReset` dentro del
   * único botón "Restablecer todos".
   */
  onReset: () => void;
  /**
   * Tema org-wide (colores por grupo). Pasado por el parent para que la
   * lógica de fetch/save viva donde hay acceso al AuthContext y pueda
   * compartirse con el resto del viewer si se necesita.
   */
  orgColors: DiagramGroupColors;
  orgCanEdit: boolean;
  onOrgColorChange: (group: DiagramNodeGroup, color: string) => void;
  /**
   * Reset del tema organizacional (colores por grupo). Async porque hace
   * PUT al backend. Retorna true si el server confirmó, false si falló
   * (rollback silencioso con los colores previos).
   */
  onOrgReset: () => Promise<boolean>;
  /**
   * Colores de texto organizacionales (título/descripción de los nodos).
   * Gated por el mismo RBAC que `orgColors` — `orgCanEdit` aplica a ambas
   * secciones.
   */
  textColors: DiagramTextColors;
  /**
   * Callback para actualizar un color de texto puntual. El parent decide
   * si dispara PUT inmediato (optimistic) o lo debouncea; aquí solo
   * notificamos el cambio.
   */
  onTextColorChange: (key: 'title' | 'description', color: string) => void;
}

// Orden visual de los grupos en el panel — refleja un flujo lógico de
// diagrama (entrada → frontend → backend → datos → infra → externos →
// salida). Facilita escaneo visual cuando el user busca un grupo específico.
const GROUP_ORDER: DiagramNodeGroup[] = [
  'start',
  'frontend',
  'backend',
  'data',
  'infra',
  'external',
  'end',
];

/**
 * Botón flotante + panel desplegable con `<input type="color">` nativos.
 *
 * Por qué `<input type="color">` en lugar de un picker custom:
 *   - Funciona cross-browser (Chrome, Firefox, Safari) sin dependencias.
 *   - Accesible por defecto (teclado, lector de pantalla).
 *   - Abre el picker nativo del SO (macOS Color Panel, etc.) que los
 *     diseñadores ya conocen y prefieren.
 *   - YAGNI: un picker custom añadiría 5-10 KB y lógica de eyedropper/
 *     presets que nadie pidió.
 *
 * Posicionado `absolute top-3 left-3` dentro del `<DiagramViewer>`. El
 * viewer ya tiene el botón "Editar diagrama" arriba a la derecha, así que
 * izquierda es el espacio natural para no competir visualmente.
 *
 * El panel tiene DOS secciones:
 *   - Tema personal (fondo + nodos genéricos) — localStorage, por user.
 *   - Tema organizacional (colores por grupo) — backend, RBAC-gated.
 */
export function DiagramThemePanel({
  theme,
  onBackgroundChange,
  onReset,
  orgColors,
  orgCanEdit,
  onOrgColorChange,
  onOrgReset,
  textColors,
  onTextColorChange,
}: DiagramThemePanelProps) {
  const [open, setOpen] = useState(false);
  /*
    `mounted` desacopla DOM presence de la animación. Cuando `open` pasa de
    true → false, `mounted` permanece true durante `ANIM_MS` para que la
    animación-out se reproduzca; tras ese delay, `mounted` pasa a false y
    el elemento se desmonta. Patrón equivalente al que usa Radix Popover
    internamente sin necesidad de añadir la dependencia.
  */
  const [mounted, setMounted] = useState(false);
  const ANIM_MS = 180;
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), ANIM_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-md bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-200 backdrop-blur-sm transition-colors shadow"
        aria-expanded={open}
        aria-label="Configurar colores del diagrama"
      >
        <Palette className="h-3.5 w-3.5" />
        Colores
      </button>

      {mounted && (
        /*
          Animación in/out via tailwindcss-animate + data-state attribute.
          - `data-[state=open]:*` se activa durante la apertura (in).
          - `data-[state=closed]:*` se activa durante el cierre (out), mientras
            `open === false` pero `mounted === true` (180ms de gracia).
          El sistema replica la API de Radix Popover sin importar Radix.
          `origin-top-left` alinea la animación con el botón disparador.
        */
        <div
          data-state={open ? 'open' : 'closed'}
          className="absolute top-14 left-3 z-10 w-72 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg bg-zinc-900/95 border border-zinc-700 p-4 shadow-xl backdrop-blur-sm origin-top-left duration-[180ms] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:slide-out-to-top-2"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-zinc-200">Tema del diagrama</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-zinc-400 hover:text-zinc-200 transition-colors"
              aria-label="Cerrar panel de colores"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Picker del fondo del canvas (personal, localStorage). */}
          <ColorRow label="Fondo" value={theme.background} onChange={onBackgroundChange} />

          {/* Separador visual entre tema personal y colores por grupo. */}
          <div className="my-4 border-t border-zinc-800" />

          {/* Sección de colores por grupo: SIEMPRE visible (no colapsable).
              Es el único sistema que diferencia nodes — debe estar accesible
              sin interacción extra. El botón "Restablecer todos" vive después
              de la sección de colores de texto para aplicar a AMBOS bloques
              org + fondo personal. */}
          <GroupColorsSection
            colors={orgColors}
            canEdit={orgCanEdit}
            onColorChange={onOrgColorChange}
          />

          {/* Separador visual entre "colores por grupo" y "colores de texto".
              Mismo estilo que el separador entre fondo y grupos para mantener
              cohesión visual del panel. */}
          <div className="my-4 border-t border-zinc-800" />

          {/* Sección de colores de texto — gated por el mismo RBAC que la
              sección de grupos (`orgCanEdit`). Los inputs siguen visibles
              cuando `!orgCanEdit` (contexto visible) pero en disabled. */}
          <TextColorsSection
            textColors={textColors}
            canEdit={orgCanEdit}
            onTextColorChange={onTextColorChange}
          />

          {/* Botón único de reset: aplica a tema personal (fondo) + org
              (colores por grupo + colores de texto). Se renderiza después
              de todas las secciones editables para que actúe como "cerrar
              por abajo" consistente con otros panels de configuración. */}
          {orgCanEdit && (
            <ResetAllButton
              onResetAll={async () => {
                // Reset personal (síncrono, localStorage) + org (async, backend).
                // Ejecutamos el personal primero para que el feedback visual
                // del fondo sea inmediato aunque el backend tarde.
                onReset();
                const ok = await onOrgReset();
                if (ok) {
                  toast.success('Colores restablecidos');
                } else {
                  // Causa más común: migration `add_diagram_theme_settings` no
                  // ejecutada. También puede ser: Redis/Postgres caído, o 403
                  // inesperado. Mensaje accionable en vez de "error" genérico.
                  toast.error('No se pudo restablecer los colores de la organización', {
                    description: 'Verifica que la migration de Prisma haya corrido o que el backend esté disponible.',
                  });
                }
              }}
            />
          )}

          <p className="text-[10px] text-zinc-500 mt-3 leading-snug">
            Afecta a todos los diagramas de la organización.
          </p>
        </div>
      )}
    </>
  );
}

interface GroupColorsSectionProps {
  colors: DiagramGroupColors;
  canEdit: boolean;
  onColorChange: (group: DiagramNodeGroup, color: string) => void;
}

/**
 * Sección con los 7 color pickers de grupo (layers arquitectónicos).
 * SIEMPRE visible (antes era colapsable; el user pidió acceso directo).
 * Cuando `!canEdit` los inputs siguen visibles pero disabled con cursor
 * not-allowed + tooltip. Mostrar los valores leídos aporta contexto: el
 * user sabe qué colores ve en los diagramas aunque no pueda cambiarlos.
 */
function GroupColorsSection({
  colors,
  canEdit,
  onColorChange,
}: GroupColorsSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-2 min-w-0 mb-3">
        <span className="text-sm font-semibold text-zinc-200">Colores por grupo</span>
        {!canEdit && <SoloAltaGerenciaBadge />}
      </div>

      <div className="space-y-2">
        {GROUP_ORDER.map((group) => (
          <GroupColorRow
            key={group}
            group={group}
            label={GROUP_LABELS[group]}
            value={colors[group]}
            disabled={!canEdit}
            onChange={(color) => onColorChange(group, color)}
          />
        ))}
      </div>
    </div>
  );
}

interface TextColorsSectionProps {
  textColors: DiagramTextColors;
  canEdit: boolean;
  onTextColorChange: (key: 'title' | 'description', color: string) => void;
}

/**
 * Sección con los 2 color pickers de texto (título + descripción del nodo).
 * Se renderiza DESPUÉS de `GroupColorsSection` y antes de `ResetAllButton`,
 * compartiendo el mismo gating RBAC (`canEdit`).
 *
 * Reutiliza `ColorRow` — el mismo row simple usado para "Fondo". La razón:
 * los colores de texto NO tienen swatch adelante como los grupos; son dos
 * valores singulares, no necesitan preview extra del valor (el hex a la
 * derecha ya lo aporta).
 */
function TextColorsSection({
  textColors,
  canEdit,
  onTextColorChange,
}: TextColorsSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-2 min-w-0 mb-3">
        <span className="text-sm font-semibold text-zinc-200">Colores de texto</span>
        {!canEdit && <SoloAltaGerenciaBadge />}
      </div>

      <div className="space-y-2">
        <ColorRow
          label="Título del nodo"
          value={textColors.title}
          onChange={(color) => onTextColorChange('title', color)}
          disabled={!canEdit}
        />
        <ColorRow
          label="Descripción del nodo"
          value={textColors.description}
          onChange={(color) => onTextColorChange('description', color)}
          disabled={!canEdit}
        />
      </div>
    </div>
  );
}

/**
 * Badge reutilizable para indicar gating RBAC en las secciones org-wide.
 * Extraído porque ahora dos secciones lo muestran cuando `!canEdit`
 * (colores por grupo + colores de texto). Evita duplicar el markup.
 */
function SoloAltaGerenciaBadge() {
  return (
    <span
      className="flex items-center gap-1 rounded bg-zinc-800/80 border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-400"
      title="Solo Alta Gerencia puede editar"
    >
      <Lock className="h-2.5 w-2.5" />
      Solo Alta Gerencia
    </span>
  );
}

/**
 * Botón único que dispara el reset global (fondo personal + colores org
 * + colores de texto). Aislado en su propio componente para encapsular
 * el state `resetting` y la animación del spinner.
 */
function ResetAllButton({ onResetAll }: { onResetAll: () => Promise<void> }) {
  const [resetting, setResetting] = useState(false);
  return (
    <button
      type="button"
      disabled={resetting}
      onClick={async () => {
        setResetting(true);
        try {
          await onResetAll();
        } finally {
          setResetting(false);
        }
      }}
      className="w-full mt-4 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-wait"
    >
      <RotateCcw className={`h-3 w-3 ${resetting ? 'animate-spin' : ''}`} />
      {resetting ? 'Restableciendo…' : 'Restablecer todos'}
    </button>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  /**
   * Cuando `true`, el input queda visible pero deshabilitado (consistente
   * con `GroupColorRow`). Usado por la sección de texto para respetar el
   * gating RBAC `orgCanEdit`. Default `false` preserva el uso actual para
   * el fondo personal (siempre editable).
   */
  disabled?: boolean;
}) {
  const title = disabled ? 'Solo Alta Gerencia puede editar' : undefined;
  return (
    <label
      className={`flex items-center justify-between gap-3 ${
        disabled ? 'cursor-not-allowed' : ''
      }`}
      title={title}
    >
      <span className="text-xs text-zinc-300">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-zinc-500 uppercase">{value}</span>
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`h-7 w-10 rounded bg-transparent border border-zinc-700 ${
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          }`}
        />
      </div>
    </label>
  );
}

function GroupColorRow({
  group,
  label,
  value,
  disabled,
  onChange,
}: {
  group: DiagramNodeGroup;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (color: string) => void;
}) {
  const title = disabled ? 'Solo Alta Gerencia puede editar' : `Color del grupo ${label}`;

  return (
    <label
      className={`flex items-center justify-between gap-3 ${
        disabled ? 'cursor-not-allowed' : ''
      }`}
      title={title}
    >
      <span className="flex items-center gap-2 min-w-0">
        {/* Swatch visual adelante del label: da feedback rápido sobre qué
            color tiene cada grupo sin tener que leer el hex al lado del
            input. */}
        <span
          aria-hidden
          className="h-3 w-3 flex-shrink-0 rounded-sm border border-zinc-700"
          style={{ backgroundColor: value }}
        />
        <span className="text-xs text-zinc-300 truncate">{label}</span>
      </span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-zinc-500 uppercase">{value}</span>
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Color para ${label}`}
          className={`h-7 w-10 rounded bg-transparent border border-zinc-700 ${
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          }`}
          data-group={group}
        />
      </div>
    </label>
  );
}
