'use client';

import { useState } from 'react';
import type { EpicDesign } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Plus,
  Pencil,
  Trash2,
  Palette,
  ChevronDown,
  ChevronRight,
  Ban,
  FileText,
} from 'lucide-react';

interface EpicDesignsProps {
  designs: EpicDesign[];
  designSkipped: boolean;
  onAddDesign: (design: EpicDesign) => void;
  onUpdateDesign: (design: EpicDesign) => void;
  onDeleteDesign: (designId: string) => void;
  onToggleSkip: (skipped: boolean) => void;
}

// ──────────────────────────────────────────────────────────────────────
//   DesignDialog — create / edit
// ──────────────────────────────────────────────────────────────────────

interface DesignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDesign: EpicDesign | null;
  onSubmit: (design: EpicDesign) => void;
  currentUserName?: string;
}

function DesignDialog({ open, onOpenChange, initialDesign, onSubmit, currentUserName }: DesignDialogProps) {
  // Lazy initializers toman el initialDesign una sola vez al montar. El padre
  // fuerza remount via `key` cuando cambia el diseño editado, lo que garantiza
  // que estos valores siempre reflejen el initialDesign actual sin el
  // antipattern de setState-in-effect.
  const [name, setName] = useState(() => initialDesign?.name ?? '');
  const [description, setDescription] = useState(() => initialDesign?.description ?? '');
  const [handoff, setHandoff] = useState(() => initialDesign?.handoff ?? '');

  const canSubmit = name.trim().length > 0 && handoff.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const now = new Date().toISOString();
    const design: EpicDesign = initialDesign
      ? { ...initialDesign, name: name.trim(), description: description.trim(), handoff: handoff.trim(), updatedAt: now }
      : {
          id: crypto.randomUUID(),
          name: name.trim(),
          description: description.trim(),
          handoff: handoff.trim(),
          createdAt: now,
          updatedAt: now,
          createdBy: currentUserName,
        };
    onSubmit(design);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initialDesign ? 'Editar diseño' : 'Agregar diseño'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Nombre <span className="text-red-500">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Checkout Mobile"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Resumen corto del diseño: qué pantallas cubre, objetivo UX principal…"
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-relaxed shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Handoff de Claude Design <span className="text-red-500">*</span>
            </label>
            <textarea
              value={handoff}
              onChange={(e) => setHandoff(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={'Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/<id>?open_file=<file>.html\nImplement: <file>.html'}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-relaxed font-mono shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pega tal cual el handoff que Claude Design generó al exportar el diseño.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {initialDesign ? 'Guardar cambios' : 'Agregar diseño'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────
//   DesignCard — single item with expand/collapse
// ──────────────────────────────────────────────────────────────────────

interface DesignCardProps {
  design: EpicDesign;
  onEdit: () => void;
  onDelete: () => void;
}

function DesignCard({ design, onEdit, onDelete }: DesignCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <Palette className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium truncate">{design.name}</h4>
            {design.description && (
              <p className="text-xs text-muted-foreground truncate">{design.description}</p>
            )}
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Editar diseño">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
            aria-label="Eliminar diseño"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {design.description && (
            <div>
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Descripción
              </h5>
              <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
                {design.description}
              </p>
            </div>
          )}
          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Handoff de Claude Design
            </h5>
            <pre className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap font-mono bg-muted/40 rounded-md p-3 max-h-96 overflow-auto">
              {design.handoff}
            </pre>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Actualizado: {new Date(design.updatedAt).toLocaleString()}
            {design.createdBy ? ` · por ${design.createdBy}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
//   EpicDesigns — main container
// ──────────────────────────────────────────────────────────────────────

export function EpicDesigns({
  designs,
  designSkipped,
  onAddDesign,
  onUpdateDesign,
  onDeleteDesign,
  onToggleSkip,
}: EpicDesignsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDesign, setEditingDesign] = useState<EpicDesign | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const openCreate = () => {
    setEditingDesign(null);
    setDialogOpen(true);
  };

  const openEdit = (design: EpicDesign) => {
    setEditingDesign(design);
    setDialogOpen(true);
  };

  const handleSubmit = (design: EpicDesign) => {
    if (editingDesign) {
      onUpdateDesign(design);
    } else {
      onAddDesign(design);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Toggle: No requiere diseño ── */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-3 min-w-0">
          <Ban className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">No requiere diseño</p>
            <p className="text-xs text-muted-foreground">
              Activa esto si la épica es backend-only, infraestructura o integración sin UI. El agente IA
              no referenciará diseños al generar historias.
            </p>
          </div>
        </div>
        <Switch
          checked={designSkipped}
          onCheckedChange={onToggleSkip}
          aria-label="No requiere diseño"
        />
      </div>

      {/* ── Estado: skipped ── */}
      {designSkipped && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            Esta épica está marcada como <strong>sin diseño requerido</strong>. Los diseños están deshabilitados
            y no se referenciarán en la generación de historias con IA.
          </p>
        </div>
      )}

      {/* ── Lista de diseños ── */}
      {!designSkipped && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Diseños {designs.length > 0 ? `(${designs.length})` : ''}
            </h3>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Agregar diseño
            </Button>
          </div>

          {designs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
              <Palette className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-1">Aún no hay diseños para esta épica.</p>
              <p className="text-xs text-muted-foreground">
                Agrega nombre, descripción y el handoff completo de Claude Code + Claude Design para que
                la IA los referencie al generar historias.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {designs.map((design) => (
                <DesignCard
                  key={design.id}
                  design={design}
                  onEdit={() => openEdit(design)}
                  onDelete={() => setConfirmDeleteId(design.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <DesignDialog
        key={`${dialogOpen ? 'open' : 'closed'}-${editingDesign?.id ?? 'new'}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDesign={editingDesign}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
        title="Eliminar diseño"
        description={
          confirmDeleteId
            ? `"${designs.find((d) => d.id === confirmDeleteId)?.name ?? ''}" se eliminará permanentemente. El handoff se perderá y no se podrá recuperar.`
            : ''
        }
        confirmText="Eliminar"
        destructive
        onConfirm={() => {
          if (confirmDeleteId) onDeleteDesign(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}
