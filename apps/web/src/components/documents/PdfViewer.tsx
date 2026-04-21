'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface Props {
  src: string;
}

export function PdfViewer({ src }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [rotation, setRotation] = useState(0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2 shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            aria-label="Pagina anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground min-w-[60px] text-center">
            {currentPage} / {numPages || '?'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages || numPages === 0}
            aria-label="Pagina siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            disabled={scale <= 0.5}
            aria-label="Alejar"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground min-w-[45px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            disabled={scale >= 3}
            aria-label="Acercar"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            aria-label="Rotar"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-muted/10 flex justify-center py-4">
        <Document
          file={src}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando PDF...
            </div>
          }
          error={
            <div className="text-sm text-red-500 p-8">
              Error al cargar el PDF
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            rotate={rotation}
            renderTextLayer
            renderAnnotationLayer
          />
        </Document>
      </div>
    </div>
  );
}
