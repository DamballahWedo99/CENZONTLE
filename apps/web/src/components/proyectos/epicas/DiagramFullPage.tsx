'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useProyectos } from '@/context/ProyectosContext';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import { DiagramViewer } from './DiagramViewer';
import { EpicDiagram } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { ArrowLeft, GitBranch } from 'lucide-react';

interface DiagramFullPageProps {
  epicId: string;
}

export function DiagramFullPage({ epicId }: DiagramFullPageProps) {
  const { state, dispatch } = useProyectos();
  const { setBreadcrumb } = useBreadcrumb();

  const rawEpic = state.epics.find((e) => e.id === epicId);
  const businessDiagram = rawEpic?.diagrams.find((d) => d.type === 'business');

  const initiative = rawEpic ? state.initiatives.find((i) => i.id === rawEpic.initiativeId) : null;

  useEffect(() => {
    if (!rawEpic) return;
    setBreadcrumb(
      <div className="flex items-center gap-2 text-sm">
        <Link href="/proyectos" className="text-muted-foreground hover:text-foreground transition-colors">
          Proyectos
        </Link>
        <span className="text-muted-foreground/40">/</span>
        {initiative && (
          <>
            <Link href={`/proyectos/iniciativas/${initiative.id}`} className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[180px]">
              {initiative.name}
            </Link>
            <span className="text-muted-foreground/40">/</span>
          </>
        )}
        <Link href={`/proyectos/epicas/${epicId}?tab=diagramas`} className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[180px]">
          {rawEpic.title}
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-foreground">Diagrama</span>
      </div>
    );
    return () => setBreadcrumb(null);
  }, [rawEpic, epicId, initiative, setBreadcrumb]);

  if (!rawEpic) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-sm text-muted-foreground">Épica no encontrada</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/proyectos">Volver a proyectos</Link>
        </Button>
      </div>
    );
  }

  if (!businessDiagram) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <GitBranch className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No hay diagrama de negocio generado</p>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/proyectos/epicas/${epicId}?tab=diagramas`}>Volver a la épica</Link>
        </Button>
      </div>
    );
  }

  const handleDiagramChange = (diagram: EpicDiagram) => {
    dispatch({ type: 'UPDATE_EPIC_DIAGRAM', payload: { epicId, diagram } });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Compact top bar */}
      <div className="flex items-center justify-between h-12 px-4 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link href={`/proyectos/epicas/${epicId}?tab=diagramas`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{rawEpic.tracker?.externalKey ?? '—'}</span>
            <span className="text-muted-foreground/30">·</span>
            <span className="text-sm font-medium">Diagrama de Negocio</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{businessDiagram.nodes.length} nodos</span>
          <span className="text-muted-foreground/30">·</span>
          <span>{businessDiagram.edges.length} conexiones</span>
        </div>
      </div>

      {/* Full-height diagram */}
      <div className="flex-1 min-h-0">
        <DiagramViewer
          diagram={businessDiagram}
          editable
          fullHeight
          onDiagramChange={handleDiagramChange}
        />
      </div>
    </div>
  );
}
