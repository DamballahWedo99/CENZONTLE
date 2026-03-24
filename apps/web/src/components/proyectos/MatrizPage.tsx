'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { MatrizSeguimiento } from './matriz/MatrizSeguimiento';
import { MatrizTimeline } from './matriz/MatrizTimeline';
import type { MatrizTimelineHandle } from './matriz/MatrizTimeline';
import { ProyectosFilters } from './filters/ProyectosFilters';
import { Grid3X3, Maximize2, Minimize2, CalendarDays, LayoutGrid, CalendarCheck, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { ZoomLevel } from '@/lib/timeline-utils';
import { ZOOM_CONFIGS } from '@/lib/timeline-utils';

type MatrizView = 'pods' | 'timeline';

export function MatrizPage() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [view, setView] = useState<MatrizView>('timeline');
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('day');
  const [showCeremonies, setShowCeremonies] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<MatrizTimelineHandle>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      setPortalContainer(fs ? containerRef.current : null);
    };
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  return (
      <div
        ref={containerRef}
        className={`space-y-4 ${isFullscreen ? 'bg-background p-6 overflow-y-auto' : ''}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Grid3X3 className="h-6 w-6" />
              Matriz de Seguimiento
            </h1>
            <p className="text-sm text-muted-foreground">
              {view === 'timeline'
                ? 'Timeline de historias por sprint con seguimiento diario'
                : 'Vista cruzada de épicas por POD con progreso detallado'}
            </p>
          </div>

          {/* Unified control bar */}
          <div className="flex items-center gap-2">
            {/* Timeline controls — only when timeline is active */}
            {view === 'timeline' && (
              <>
                <div className="flex rounded-lg border p-0.5">
                  {(['day', 'week', 'month'] as ZoomLevel[]).map((level) => (
                    <Button
                      key={level}
                      variant={zoomLevel === level ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setZoomLevel(level)}
                      className="text-xs h-7 px-2.5"
                    >
                      {ZOOM_CONFIGS[level].label}
                    </Button>
                  ))}
                </div>

                {zoomLevel === 'day' && (
                  <Button
                    variant={showCeremonies ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setShowCeremonies((v) => !v)}
                    className="gap-1.5 text-xs h-7"
                  >
                    <CalendarCheck className="h-3.5 w-3.5" />
                    Ceremonias
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => timelineRef.current?.scrollToToday()}
                  className="gap-1.5 text-xs h-7"
                >
                  <Navigation className="h-3.5 w-3.5" />
                  Hoy
                </Button>

                <Separator orientation="vertical" className="h-6" />
              </>
            )}

            {/* View toggle */}
            <div className="flex rounded-lg border p-0.5">
              <Button
                variant={view === 'timeline' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setView('timeline')}
                className="gap-1.5 text-xs h-7 px-2.5"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                Timeline
              </Button>
              <Button
                variant={view === 'pods' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setView('pods')}
                className="gap-1.5 text-xs h-7 px-2.5"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                PODs
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={toggleFullscreen}
              className="gap-1.5 text-xs shrink-0"
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isFullscreen ? 'Salir' : 'Pantalla completa'}
            </Button>
          </div>
        </div>
        <ProyectosFilters portalContainer={portalContainer} />
        {view === 'timeline' ? (
          <MatrizTimeline
            ref={timelineRef}
            zoomLevel={zoomLevel}
            showCeremonies={showCeremonies}
          />
        ) : (
          <MatrizSeguimiento />
        )}
      </div>
  );
}
