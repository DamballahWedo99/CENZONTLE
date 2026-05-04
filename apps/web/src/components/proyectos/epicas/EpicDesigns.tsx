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
  Upload,
  FileArchive,
  Loader2,
} from 'lucide-react';

interface EpicDesignsProps {
  designs: EpicDesign[];
  designSkipped: boolean;
  /**
   * Crea un diseño NUEVO subiendo un bundle ZIP de Claude Design. Recibe los
   * inputs en bruto y delega al padre el fetch multipart — el padre devuelve
   * el `EpicDesign` ya construido por el backend (con bundleKey, handoff
   * sintético, etc.).
   */
  onAddDesignBundle: (input: { name: string; description: string; file: File }) => Promise<EpicDesign>;
  /**
   * Edita SOLO los metadatos (name, description) de un diseño existente.
   * El bundle (handoff, bundleKey, archivos del vault) queda intacto. Si en
   * el futuro queremos permitir reemplazar el ZIP, agregamos un endpoint
   * dedicado.
   */
  onUpdateDesign: (design: EpicDesign) => void;
  onDeleteDesign: (designId: string) => void;
  onToggleSkip: (skipped: boolean) => void;
}

// ──────────────────────────────────────────────────────────────────────
//   DesignDialog — create (con file input) / edit (solo metadatos)
// ──────────────────────────────────────────────────────────────────────

interface DesignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDesign: EpicDesign | null;
  onCreate: (input: { name: string; description: string; file: File }) => Promise<EpicDesign>;
  onUpdate: (design: EpicDesign) => void;
}

function DesignDialog({ open, onOpenChange, initialDesign, onCreate, onUpdate }: DesignDialogProps) {
  const [name, setName] = useState(() => initialDesign?.name ?? '');
  const [description, setDescription] = useState(() => initialDesign?.description ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = initialDesign !== null;
  // En CREATE: name + file requeridos. En EDIT: solo name (el bundle ya existe).
  const canSubmit = isEdit ? name.trim().length > 0 : name.trim().length > 0 && file !== null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    // Validación cliente — el backend valida también, pero aquí evita upload
    // costoso para archivos obvios mal. Aceptamos `.zip` (bundle Claude Design)
    // o `.html`/`.htm` (mockup standalone).
    const lower = f.name.toLowerCase();
    const isZip = lower.endsWith('.zip');
    const isHtml = lower.endsWith('.html') || lower.endsWith('.htm');
    if (!isZip && !isHtml) {
      setError('El archivo debe ser un .zip (bundle Claude Design) o un .html standalone');
      setFile(null);
      return;
    }
    // Cap por tipo: HTML standalone se inlinea al prompt del agente IA, así
    // que el cap es más estricto (2MB) que el de ZIPs (10MB, contenido se
    // distribuye en múltiples archivos texto).
    const maxBytes = isHtml ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
    if (f.size > maxBytes) {
      const maxLabel = isHtml ? '2 MB' : '10 MB';
      setError(`El archivo excede ${maxLabel}${isHtml ? ' (límite para HTML standalone — sube como ZIP si tienes muchas imágenes embebidas)' : ''}`);
      setFile(null);
      return;
    }
    setFile(f);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    if (isEdit && initialDesign) {
      // Edit: solo metadatos via callback síncrono.
      const now = new Date().toISOString();
      onUpdate({
        ...initialDesign,
        name: name.trim(),
        description: description.trim(),
        updatedAt: now,
      });
      onOpenChange(false);
      return;
    }
    // Create: upload multipart vía callback async.
    if (!file) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        file,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al subir el bundle';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar diseño' : 'Agregar diseño'}</DialogTitle>
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
              disabled={submitting}
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
              disabled={submitting}
            />
          </div>

          {/* CREATE: file input para el bundle ZIP o HTML standalone. EDIT: muestra info del bundle existente, no editable. */}
          {!isEdit ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Archivo de diseño (.zip o .html) <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="design-bundle-file"
                  className={`flex-1 flex items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2.5 cursor-pointer hover:border-foreground/40 transition-colors ${file ? 'bg-accent/30' : ''} ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {file ? (
                    <>
                      {file.name.toLowerCase().endsWith('.zip') ? (
                        <FileArchive className="h-4 w-4 text-foreground/60 shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-foreground/60 shrink-0" />
                      )}
                      <span className="text-sm truncate">{file.name}</span>
                      <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground">Click para seleccionar archivo (.zip o .html)</span>
                    </>
                  )}
                </label>
                <input
                  id="design-bundle-file"
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed,.html,.htm,text/html"
                  onChange={handleFileChange}
                  disabled={submitting}
                  className="sr-only"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Acepta el ZIP de Claude Design (con README.md y carpeta project/, máx 10 MB) o un .html standalone (mockup hecho a mano u otra herramienta, máx 2 MB).
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileArchive className="h-3.5 w-3.5 shrink-0" />
                <span>El bundle existente no se modifica al editar metadatos.</span>
              </div>
              {initialDesign?.bundleVaultPath && (
                <p className="mt-1 text-[11px] font-mono text-muted-foreground/70 break-all">
                  {initialDesign.bundleVaultPath}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Subiendo…
              </>
            ) : isEdit ? (
              'Guardar cambios'
            ) : (
              'Agregar diseño'
            )}
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
  const isBundle = !!design.bundleKey;

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
          {isBundle ? (
            <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <Palette className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
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
          {design.bundleVaultPath && (
            <div className="min-w-0">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <FileArchive className="h-3 w-3" />
                Bundle en el vault
              </h5>
              <p className="text-xs font-mono text-foreground/70 bg-muted/40 rounded-md px-2 py-1.5 break-all">
                {design.bundleVaultPath}
              </p>
            </div>
          )}
          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              {isBundle ? 'Handoff sintético (lo que ve el agente)' : 'Handoff de Claude Design'}
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
  onAddDesignBundle,
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

  // Estado de diseño y skip son MUTUAMENTE EXCLUYENTES:
  //  - Si hay diseños → la épica claramente requiere UI; el toggle "No
  //    requiere diseño" es contradictorio y se oculta.
  //  - Si NO hay diseños → el toggle es relevante: el user puede declarar
  //    que la épica es backend-only para que el agente IA no genere
  //    referencias a diseños inexistentes.
  // Si por estado inconsistente (regresión, migración) `designSkipped=true`
  // Y hay diseños, ignoramos el flag para el render — los diseños existentes
  // siempre se muestran para que el user los pueda editar/eliminar.
  const hasDesigns = designs.length > 0;
  const showSkipToggle = !hasDesigns;
  const showSkippedBanner = designSkipped && !hasDesigns;
  const showDesignsList = hasDesigns || !designSkipped;

  return (
    <div className="space-y-6">
      {/* ── Toggle: No requiere diseño (solo si NO hay diseños) ── */}
      {showSkipToggle && (
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
      )}

      {/* ── Estado: skipped (solo si está skipped Y no hay diseños) ── */}
      {showSkippedBanner && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            Esta épica está marcada como <strong>sin diseño requerido</strong>. Los diseños están deshabilitados
            y no se referenciarán en la generación de historias con IA.
          </p>
        </div>
      )}

      {/* ── Lista de diseños ── */}
      {showDesignsList && (
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
                Sube el ZIP exportado de Claude Design para que la IA lo referencie al generar historias y
                Claude Code pueda implementarlo pixel-perfect.
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
        onCreate={onAddDesignBundle}
        onUpdate={onUpdateDesign}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
        title="Eliminar diseño"
        description={
          confirmDeleteId
            ? `"${designs.find((d) => d.id === confirmDeleteId)?.name ?? ''}" se eliminará permanentemente. El bundle y los archivos del vault se perderán y no se podrán recuperar.`
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
