'use client';

import {
  Server,
  Database,
  Inbox,
  Route,
  Cloud,
  UserRound,
  Cog,
  Diamond,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { DiagramNodeType } from '@cenzontle/shared';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { type ToolKind } from './useDiagramEditor';
import { TOOL_DEFINITIONS } from './editor-constants';

// Mapeo `DiagramNodeType → Icono`. Vive acá (UI layer) y no en
// `useDiagramEditor` para mantener el hook libre de dependencias de UI.
// `reference` excluido: no es creable desde la palette (ver node-icons.ts).
const TOOL_ICONS: Record<Exclude<DiagramNodeType, 'reference'>, LucideIcon> = {
  service: Server,
  database: Database,
  queue: Inbox,
  gateway: Route,
  external: Cloud,
  client: UserRound,
  process: Cog,
  decision: Diamond,
  actor: UserCog,
};

/**
 * MIME type del dataTransfer usado en el drag-drop de tools → canvas.
 * Espacio de nombres propio (`application/cenzontle-node-type`) para no
 * colisionar con otros drags del browser (archivos, URLs, etc.) y permitir
 * filtrar eventos en `onDragOver` sin ambigüedad.
 */
export const NODE_TYPE_DRAG_MIME = 'application/cenzontle-node-type';

interface EditToolbarProps {
  activeTool: ToolKind;
  onToolSelect: (tool: ToolKind) => void;
}

/**
 * Palette vertical con los 9 tipos de node. Patrón dual:
 *
 *  A) Click-tool → click-canvas (Excalidraw-style):
 *     1. Click en un tool → se vuelve activo (highlight primary).
 *     2. Click en el canvas → deposita un node de ese tipo ahí.
 *     3. El tool se desactiva automáticamente tras colocar.
 *     Click de nuevo sobre el tool activo → lo desactiva (toggle).
 *
 *  B) Drag-drop (Figma-style, ADITIVO):
 *     1. Drag desde un tool → dispara `onDragStart` con el tipo serializado
 *        en el dataTransfer bajo el MIME `NODE_TYPE_DRAG_MIME`.
 *     2. El caller del viewer usa `useDropNode` para recibir el drop y
 *        proyectar coords del cursor a coords del flow.
 *
 * Los dos modos coexisten: el user puede elegir uno u otro según preferencia.
 *
 * Vive como `Panel position="top-left"` dentro de ReactFlow; se monta
 * sobre el canvas con z-index alto via el sistema de Panels de xyflow.
 *
 * Los tooltips usan el wrapper `@/components/ui/tooltip` (Radix) — los mismos
 * que el resto del software (FolderTree, sidebar, etc.). Portal-based, a11y
 * keyboard/screen-reader compliant, sin conflictos de z-index con el Panel
 * de React Flow.
 */
export function EditToolbar({ activeTool, onToolSelect }: EditToolbarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-1 rounded-lg bg-zinc-900/95 border border-zinc-700 p-1.5 shadow-xl backdrop-blur-sm">
        {TOOL_DEFINITIONS.map(({ type, label, description }) => {
          const Icon = TOOL_ICONS[type];
          const isActive = activeTool === type;
          return (
            <Tooltip key={type}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    // Serializa el tipo en un MIME propio para que el drop handler
                    // lo identifique sin confundir con drags externos (archivos, URLs).
                    event.dataTransfer.setData(NODE_TYPE_DRAG_MIME, type);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => onToolSelect(isActive ? null : type)}
                  className={`flex items-center justify-center h-9 w-9 rounded-md transition-colors cursor-grab active:cursor-grabbing ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-inner'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                  }`}
                  aria-label={`${label} — ${description}`}
                  aria-pressed={isActive}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{label}</span>
                  <span className="text-[10px] opacity-80">{description}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
