'use client';

import dynamic from 'next/dynamic';
import { Download, Loader2 } from 'lucide-react';
import { EpicDocument } from '@cenzontle/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthenticatedBlob } from '@/hooks/use-authenticated-blob';
import { ImageLightbox } from './ImageLightbox';

// pdfjs-dist usa APIs del browser (Worker, Canvas); forzamos client-only.
const PdfViewer = dynamic(
  () => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando visor...
      </div>
    ),
  },
);

// Derivamos del tipo canónico en @cenzontle/shared: si EpicDocument['type']
// evoluciona (video, etc.), TypeScript pide ampliar el dispatcher en vez de
// fallar en runtime via cast silencioso.
export type PreviewableType = Extract<EpicDocument['type'], 'pdf' | 'image'>;

export interface PreviewDoc {
  name: string;
  url: string;
  type: PreviewableType;
}

interface Props {
  doc: PreviewDoc | null;
  onClose: () => void;
}

export function DocumentPreview({ doc, onClose }: Props) {
  const { blobUrl, loading, error } = useAuthenticatedBlob(doc?.url ?? null);

  if (!doc) return null;

  if (doc.type === 'image') {
    if (blobUrl && !loading && !error) {
      return (
        <ImageLightbox
          src={blobUrl}
          alt={doc.name}
          open
          onClose={onClose}
        />
      );
    }

    // Loading / error para imágenes: Dialog mini con feedback explícito.
    // No mezclamos con YARL para evitar anidar dos overlays.
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm truncate">{doc.name}</DialogTitle>
          </DialogHeader>
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Descargando imagen...
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center gap-2 py-6 text-sm text-center">
              <p className="text-red-500 dark:text-red-400 font-medium">
                No se pudo cargar la imagen
              </p>
              <p className="text-xs text-muted-foreground">{error.message}</p>
              <Button variant="outline" size="sm" onClick={onClose} className="mt-2">
                Cerrar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-6xl h-[85vh] p-0 gap-0 flex flex-col overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-2 space-y-0">
          <DialogTitle className="text-sm truncate flex-1 min-w-0 text-left">
            {doc.name}
          </DialogTitle>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              asChild
              aria-label={`Descargar ${doc.name}`}
              disabled={!blobUrl}
            >
              {/* Usamos el blobUrl (ya autenticado) en vez de doc.url porque
                * el URL crudo requiere JWT y <a href> no lo inyecta — generaría 401. */}
              <a
                href={blobUrl ?? '#'}
                download={doc.name}
                rel="noopener noreferrer"
                aria-disabled={!blobUrl}
              >
                <Download className="h-3 w-3" />
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={onClose}
            >
              Cerrar
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          {loading && (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Descargando archivo...
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-full text-sm gap-2 px-4 text-center">
              <p className="text-red-500 dark:text-red-400 font-medium">
                No se pudo cargar el archivo
              </p>
              <p className="text-xs text-muted-foreground">{error.message}</p>
            </div>
          )}
          {blobUrl && !loading && !error && <PdfViewer src={blobUrl} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
