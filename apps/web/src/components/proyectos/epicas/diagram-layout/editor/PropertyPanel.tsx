'use client';

import { Trash2, X } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import type { DiagramNodeType, DiagramNodeGroup } from '@cenzontle/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { TOOL_DEFINITIONS } from './editor-constants';
import { GROUP_LABELS } from '../layout-constants';

interface PropertyPanelProps {
  selectedNode: Node | null;
  selectedEdge: Edge | null;
  onUpdateNode: (
    nodeId: string,
    patch: Partial<{ label: string; description: string; group: DiagramNodeGroup; type: DiagramNodeType }>,
  ) => void;
  onUpdateEdge: (
    edgeId: string,
    patch: Partial<{ label: string; animated: boolean }>,
  ) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onClose: () => void;
}

/**
 * Panel derecho (240px ancho) que aparece cuando hay un node o edge
 * seleccionado. Mutaciones **inmediatas** onChange (no hay botón "Aplicar")
 * — esto es el comportamiento de editores modernos como Figma: lo que
 * cambias se aplica en vivo, y el undo/redo (Fase 3) cubre reverts.
 *
 * La progresión del UX:
 *   - Sin selección → panel no se renderiza (progressive disclosure).
 *   - Con node → campos: label, descripción, tipo, grupo + botón delete.
 *   - Con edge → campos: label, animated toggle + botón delete.
 */
export function PropertyPanel(props: PropertyPanelProps) {
  const { selectedNode, selectedEdge, onClose } = props;

  if (!selectedNode && !selectedEdge) return null;

  return (
    <div className="w-60 rounded-lg bg-zinc-900/95 border border-zinc-700 shadow-xl backdrop-blur-sm flex flex-col max-h-[calc(100%-24px)]">
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          {selectedNode ? 'Nodo' : 'Conexión'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Cerrar panel de propiedades"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {selectedNode ? (
          <NodeFields
            node={selectedNode}
            onChange={(patch) => props.onUpdateNode(selectedNode.id, patch)}
            onDelete={() => props.onDeleteNode(selectedNode.id)}
          />
        ) : selectedEdge ? (
          <EdgeFields
            edge={selectedEdge}
            onChange={(patch) => props.onUpdateEdge(selectedEdge.id, patch)}
            onDelete={() => props.onDeleteEdge(selectedEdge.id)}
          />
        ) : null}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function NodeFields({
  node,
  onChange,
  onDelete,
}: {
  node: Node;
  onChange: (patch: Partial<{ label: string; description: string; group: DiagramNodeGroup; type: DiagramNodeType }>) => void;
  onDelete: () => void;
}) {
  const data = node.data as {
    label?: string;
    description?: string;
    nodeType?: DiagramNodeType;
    group?: DiagramNodeGroup;
  };

  return (
    <>
      <FieldLabel>Etiqueta</FieldLabel>
      <Input
        value={data.label ?? ''}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Nombre del nodo"
        className="h-8 text-xs bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
      />

      <FieldLabel>Descripción</FieldLabel>
      <Input
        value={data.description ?? ''}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="Contexto técnico (opcional)"
        className="h-8 text-xs bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
      />

      <FieldLabel>Tipo</FieldLabel>
      <Select
        value={data.nodeType ?? 'service'}
        onValueChange={(v) => onChange({ type: v as DiagramNodeType })}
      >
        <SelectTrigger className="h-8 text-xs bg-zinc-800 border-zinc-700 text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TOOL_DEFINITIONS.map((t) => (
            <SelectItem key={t.type} value={t.type} className="text-xs">
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <FieldLabel>Grupo visual</FieldLabel>
      <Select
        value={data.group ?? 'backend'}
        onValueChange={(v) => onChange({ group: v as DiagramNodeGroup })}
      >
        <SelectTrigger className="h-8 text-xs bg-zinc-800 border-zinc-700 text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(GROUP_LABELS).map(([key, label]) => (
            <SelectItem key={key} value={key} className="text-xs">
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="pt-2 border-t border-zinc-800">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="w-full h-8 gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30"
        >
          <Trash2 className="h-3 w-3" />
          Eliminar nodo
        </Button>
      </div>
    </>
  );
}

function EdgeFields({
  edge,
  onChange,
  onDelete,
}: {
  edge: Edge;
  onChange: (patch: Partial<{ label: string; animated: boolean }>) => void;
  onDelete: () => void;
}) {
  const label = typeof edge.label === 'string' ? edge.label : '';

  return (
    <>
      <FieldLabel>Etiqueta</FieldLabel>
      <Input
        value={label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="SI / NO / publish / JWT"
        maxLength={24}
        className="h-8 text-xs bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
      />
      <p className="text-[10px] text-zinc-500 -mt-1.5">
        Máximo 12 caracteres recomendados.
      </p>

      <label className="flex items-center justify-between gap-3 pt-1">
        <span className="text-xs text-zinc-300">Animada</span>
        <input
          type="checkbox"
          checked={!!edge.animated}
          onChange={(e) => onChange({ animated: e.target.checked })}
          className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-primary focus:ring-primary focus:ring-offset-zinc-900"
        />
      </label>

      <div className="pt-2 text-[10px] text-zinc-500 space-y-1">
        <div>
          <span className="text-zinc-600">Origen:</span> <span className="font-mono">{edge.source}</span>
        </div>
        <div>
          <span className="text-zinc-600">Destino:</span> <span className="font-mono">{edge.target}</span>
        </div>
      </div>

      <div className="pt-2 border-t border-zinc-800">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="w-full h-8 gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30"
        >
          <Trash2 className="h-3 w-3" />
          Eliminar conexión
        </Button>
      </div>
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </Label>
  );
}
