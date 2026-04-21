'use client';

import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Initiative, EpicDocument, EpicDocumentSection } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  generateInitiativeDocument,
  type InitiativeDocType,
  initiativeDocTypeLabelsMap,
} from '@/lib/initiative-doc-agent';
import { exportToPDF, exportToExcel, exportToWord, exportToCSV } from '@/lib/doc-exporter';
import {
  FileText,
  FileSpreadsheet,
  Image,
  File,
  Upload,
  Plus,
  Sparkles,
  Loader2,
  Pencil,
  Trash2,
  Download,
  Eye,
  X,
} from 'lucide-react';
import { DocumentPreview, type PreviewDoc } from '@/components/documents/DocumentPreview';

// --- Type maps ---

const docTypeIcons: Record<EpicDocument['type'], typeof FileText> = {
  pdf: FileText,
  excel: FileSpreadsheet,
  diagram: Image,
  image: Image,
  other: File,
};

const docTypeLabels: Record<EpicDocument['type'], string> = {
  pdf: 'PDF',
  excel: 'Excel',
  diagram: 'Diagrama',
  image: 'Imagen',
  other: 'Archivo',
};

const aiDocTypes: { value: InitiativeDocType; label: string }[] = [
  { value: 'initiative-summary', label: 'Resumen Ejecutivo' },
  { value: 'investment-analysis', label: 'Analisis de Inversion' },
  { value: 'roadmap-doc', label: 'Documento de Roadmap' },
  { value: 'stakeholder-report', label: 'Reporte para Stakeholders' },
  { value: 'risk-assessment', label: 'Evaluacion de Riesgos' },
  { value: 'scope-document', label: 'Documento de Alcance' },
];

const manualDocTypes: { value: EpicDocument['type']; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'excel', label: 'Excel' },
  { value: 'diagram', label: 'Diagrama' },
  { value: 'image', label: 'Imagen' },
  { value: 'other', label: 'Otro' },
];

// --- Props ---

interface InitiativeDocumentsProps {
  initiative: Initiative;
  epicTitles: string[];
  documents: EpicDocument[];
  onDocumentGenerated: (doc: EpicDocument) => void;
  onDocumentUpdated: (doc: EpicDocument) => void;
  onDocumentDeleted: (docId: string) => void;
  onDocumentAdded: (doc: EpicDocument) => void;
}

// --- Component ---

export function InitiativeDocuments({
  initiative,
  epicTitles,
  documents,
  onDocumentGenerated,
  onDocumentUpdated,
  onDocumentDeleted,
  onDocumentAdded,
}: InitiativeDocumentsProps) {
  // File upload ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedAIType, setSelectedAIType] = useState<InitiativeDocType | ''>('');

  // Manual creation dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteDocTarget, setDeleteDocTarget] = useState<EpicDocument | null>(null);
  const [newDocName, setNewDocName] = useState('');
  const [newDocType, setNewDocType] = useState<EpicDocument['type']>('other');
  const [newDocSections, setNewDocSections] = useState<EpicDocumentSection[]>([
    { id: 'sec-new-0', title: '', content: '' },
  ]);

  // View/Edit dialog
  const [editingDoc, setEditingDoc] = useState<EpicDocument | null>(null);
  const [editName, setEditName] = useState('');
  const [editSections, setEditSections] = useState<EpicDocumentSection[]>([]);

  // Delete confirmation

  // Export loading
  const [exportingDocId, setExportingDocId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<PreviewDoc | null>(null);

  // --- File Upload ---

  const extensionToDocType = (ext: string): EpicDocument['type'] => {
    const lower = ext.toLowerCase();
    if (lower === 'pdf') return 'pdf';
    if (['xls', 'xlsx', 'csv'].includes(lower)) return 'excel';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(lower)) return 'image';
    if (['drawio', 'mermaid', 'puml'].includes(lower)) return 'diagram';
    return 'other';
  };

  const processFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop() ?? '';
      const now = new Date().toISOString();
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(`/api/proxy/documents/upload?folder=initiatives/${initiative.id}`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Upload failed');
        const uploaded = await res.json();

        const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const doc: EpicDocument = {
          id: uploaded.key,
          name: file.name,
          type: extensionToDocType(ext),
          url: `${API_BASE}${uploaded.url}`,
          uploadedBy: 'Usuario',
          uploadedAt: now,
          size: file.size < 1024
            ? `${file.size}B`
            : file.size < 1024 * 1024
              ? `${Math.round(file.size / 1024)}KB`
              : `${(file.size / (1024 * 1024)).toFixed(1)}MB`,
          generatedBy: 'manual',
        };

        onDocumentAdded(doc);
      } catch {
        toast.error(`Error subiendo ${file.name}`);
      }
    }
  }, [onDocumentAdded]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  }, [processFiles]);

  const handleDropzoneDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleDropzoneDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // --- AI Generation ---

  const handleAIGenerate = useCallback(async (docType: InitiativeDocType) => {
    setIsGenerating(true);
    setSelectedAIType(docType);
    try {
      const doc = await generateInitiativeDocument(initiative, epicTitles, docType);
      onDocumentGenerated(doc);
    } finally {
      setIsGenerating(false);
      setSelectedAIType('');
    }
  }, [initiative, epicTitles, onDocumentGenerated]);

  // --- Manual Creation ---

  const resetCreateForm = useCallback(() => {
    setNewDocName('');
    setNewDocType('other');
    setNewDocSections([{ id: 'sec-new-0', title: '', content: '' }]);
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetCreateForm();
    setShowCreateDialog(true);
  }, [resetCreateForm]);

  const handleAddNewSection = useCallback(() => {
    setNewDocSections((prev) => [
      ...prev,
      { id: `sec-new-${Date.now()}`, title: '', content: '' },
    ]);
  }, []);

  const handleRemoveNewSection = useCallback((idx: number) => {
    setNewDocSections((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleNewSectionChange = useCallback(
    (idx: number, field: 'title' | 'content', value: string) => {
      setNewDocSections((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
      );
    },
    []
  );

  const handleSaveNewDoc = useCallback(() => {
    if (!newDocName.trim()) return;

    const now = new Date().toISOString();
    const sections = newDocSections
      .filter((s) => s.title.trim() || s.content.trim())
      .map((s, i) => ({ ...s, id: `sec-${Date.now()}-${i}` }));

    const doc: EpicDocument = {
      id: `doc-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: newDocName.trim(),
      type: newDocType,
      url: '#',
      uploadedBy: 'Usuario',
      uploadedAt: now,
      size: `${Math.max(1, Math.round(sections.reduce((sum, s) => sum + s.title.length + s.content.length, 0) / 100))}KB`,
      sections: sections.length > 0 ? sections : undefined,
      generatedBy: 'manual',
    };

    onDocumentAdded(doc);
    setShowCreateDialog(false);
    resetCreateForm();
  }, [newDocName, newDocType, newDocSections, onDocumentAdded, resetCreateForm]);

  // --- View/Edit ---

  const handleOpenEdit = useCallback((doc: EpicDocument) => {
    setEditingDoc(doc);
    setEditName(doc.name);
    setEditSections(doc.sections ? doc.sections.map((s) => ({ ...s })) : []);
  }, []);

  const handleEditSectionChange = useCallback(
    (idx: number, field: 'title' | 'content', value: string) => {
      setEditSections((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
      );
    },
    []
  );

  const handleAddEditSection = useCallback(() => {
    setEditSections((prev) => [
      ...prev,
      { id: `sec-edit-${Date.now()}`, title: '', content: '' },
    ]);
  }, []);

  const handleRemoveEditSection = useCallback((idx: number) => {
    setEditSections((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingDoc) return;

    const cleaned = editSections
      .filter((s) => s.title.trim() || s.content.trim())
      .map((s, i) => ({ ...s, id: s.id || `sec-${Date.now()}-${i}` }));

    const updated: EpicDocument = {
      ...editingDoc,
      name: editName.trim() || editingDoc.name,
      sections: cleaned.length > 0 ? cleaned : undefined,
      size: `${Math.max(1, Math.round(cleaned.reduce((sum, s) => sum + s.title.length + s.content.length, 0) / 100))}KB`,
    };

    onDocumentUpdated(updated);
    setEditingDoc(null);
  }, [editingDoc, editName, editSections, onDocumentUpdated]);

  // --- Export ---

  const handleExport = useCallback(
    async (doc: EpicDocument, format: 'pdf' | 'excel' | 'word' | 'csv') => {
      setExportingDocId(doc.id);
      try {
        switch (format) {
          case 'pdf': await exportToPDF(doc); break;
          case 'excel': await exportToExcel(doc); break;
          case 'word': await exportToWord(doc); break;
          case 'csv': await exportToCSV(doc); break;
        }
      } finally {
        setExportingDocId(null);
      }
    },
    []
  );

  // --- Helpers ---

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
    });
  }

  // --- Render ---

  return (
    <div className="space-y-4">

      {/* Generating indicator */}
      {isGenerating && (
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">
            Generando {selectedAIType ? initiativeDocTypeLabelsMap[selectedAIType as InitiativeDocType] : 'documento'}...
          </span>
        </div>
      )}

      {/* Upload dropzone */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.svg,.webp,.drawio,.doc,.docx,.pptx,.txt"
        className="hidden"
        onChange={handleFileChange}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        onDrop={handleDropzoneDrop}
        onDragOver={handleDropzoneDragOver}
        className="flex items-center justify-center rounded-lg border-2 border-dashed py-6 text-muted-foreground hover:border-foreground/20 hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <div className="flex flex-col items-center gap-1.5">
          <Upload className="h-6 w-6 opacity-40" />
          <p className="text-xs">Arrastra archivos aqui o haz click para subir</p>
          <p className="text-[10px] text-muted-foreground/60">PDF, Excel, imagenes, diagramas</p>
        </div>
      </div>

      {/* Document list */}
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No hay documentos adjuntos
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {documents.map((doc) => {
            const Icon = docTypeIcons[doc.type];
            const isExporting = exportingDocId === doc.id;

            return (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                {/* Icon */}
                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-muted shrink-0">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    {doc.generatedBy === 'ai' && (
                      <span className="shrink-0 inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-950/30 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                        IA
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {docTypeLabels[doc.type]} · {doc.size} · {doc.uploadedBy} · {formatDate(doc.uploadedAt)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    asChild
                    aria-label={`Descargar ${doc.name}`}
                  >
                    <a href={doc.url} download={doc.name} target="_blank" rel="noopener noreferrer">
                      <Download className="h-3 w-3" />
                    </a>
                  </Button>

                  {/* Preview (solo PDFs e imagenes con URL real; excluye
                    * documentos manuales cuya url es '#'). */}
                  {(doc.type === 'pdf' || doc.type === 'image') && doc.url && doc.url !== '#' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        setPreviewDoc({
                          name: doc.name,
                          url: doc.url,
                          type: doc.type as 'pdf' | 'image',
                        })
                      }
                      aria-label={`Previsualizar ${doc.name}`}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                    onClick={() => setDeleteDocTarget(doc)}
                    aria-label={`Eliminar ${doc.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- Manual Creation Dialog --- */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Agregar documento</DialogTitle>
            <DialogDescription className="text-xs">
              Crea un documento manualmente con secciones personalizadas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <Input
                value={newDocName}
                onChange={(e) => setNewDocName(e.target.value)}
                placeholder="Nombre del documento"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <Select value={newDocType} onValueChange={(val) => setNewDocType(val as EpicDocument['type'])}>
                <SelectTrigger size="sm" className="h-8 text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {manualDocTypes.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value} className="text-xs">
                      {dt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Secciones</label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] gap-1"
                  onClick={handleAddNewSection}
                >
                  <Plus className="h-2.5 w-2.5" />
                  Agregar
                </Button>
              </div>
              {newDocSections.map((section, idx) => (
                <div key={section.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={section.title}
                      onChange={(e) => handleNewSectionChange(idx, 'title', e.target.value)}
                      placeholder="Titulo de la seccion"
                      className="h-7 text-xs flex-1"
                    />
                    {newDocSections.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 shrink-0"
                        onClick={() => handleRemoveNewSection(idx)}
                        aria-label="Eliminar seccion"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <textarea
                    value={section.content}
                    onChange={(e) => handleNewSectionChange(idx, 'content', e.target.value)}
                    placeholder="Contenido..."
                    rows={3}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
                  />
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="text-xs gap-1.5"
              onClick={handleSaveNewDoc}
              disabled={!newDocName.trim()}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Delete Confirmation Dialog (componente compartido) --- */}
      <ConfirmDialog
        open={!!deleteDocTarget}
        onOpenChange={(next) => !next && setDeleteDocTarget(null)}
        title="Eliminar documento"
        description={deleteDocTarget ? `Se eliminará "${deleteDocTarget.name}" permanentemente. Esta acción no se puede deshacer.` : undefined}
        confirmText="Eliminar"
        onConfirm={() => {
          if (deleteDocTarget) {
            onDocumentDeleted(deleteDocTarget.id);
            setDeleteDocTarget(null);
          }
        }}
        destructive
      />

      {/* --- Document Preview (PDF / Imagen) --- */}
      <DocumentPreview doc={previewDoc} onClose={() => setPreviewDoc(null)} />
    </div>
  );
}
