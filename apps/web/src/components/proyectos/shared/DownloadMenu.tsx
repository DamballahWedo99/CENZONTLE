'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Permission } from '@cenzontle/shared';
import type { StoryPOFields, StoryTechnicalFields, StoryQAFields, UserStory, Epic } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { useProyectos } from '@/context/ProyectosContext';
import { getEpic } from '@/lib/api/epics';
import { getStory, type StoryWithContentResponse } from '@/lib/api/stories';
import {
  Download,
  FileText,
  FileSpreadsheet,
  FileJson,
  FileCode,
  FileType,
  Loader2,
} from 'lucide-react';
import {
  ALL_FORMATS,
  FORMAT_LABELS,
  buildFilename,
  dispatchInitiative,
  dispatchEpic,
  dispatchStory,
  dispatchInitiativesList,
  dispatchEpicsList,
  dispatchStoriesList,
  type ExportEntity,
  type ExportFormat,
} from '@/lib/proyectos-exporter';

interface DownloadMenuProps {
  entity: ExportEntity;
  formats?: ExportFormat[];
  variant?: 'icon' | 'button';
  filenameBase?: string;
  fetchFullContent?: boolean;
  className?: string;
}

const formatIcons: Record<ExportFormat, typeof FileText> = {
  pdf: FileType,
  excel: FileSpreadsheet,
  word: FileText,
  csv: FileCode,
  json: FileJson,
};

function mergeEpicNarrative(base: Epic, api: Awaited<ReturnType<typeof getEpic>>): Epic {
  // Post-refactor v2: el contenido narrativo entero vive en `markdown`.
  // El backend hace el merge vault-vs-PG en `findOne(includeContent=true)`,
  // así que el `api.markdown` ya viene como source of truth.
  return {
    ...base,
    markdown: api.markdown ?? base.markdown,
  };
}

function mergeStoryContent(
  base: UserStory,
  api: StoryWithContentResponse,
): UserStory {
  if (!api.content) return base;
  const po: StoryPOFields = {
    markdown: api.content.po?.markdown ?? base.po.markdown,
  };
  const technical: StoryTechnicalFields = {
    markdown: api.content.technical?.markdown ?? base.technical.markdown,
  };
  const qa: StoryQAFields = {
    markdown: api.content.qa?.markdown ?? base.qa.markdown,
  };
  return { ...base, po, technical, qa };
}

export function DownloadMenu({
  entity,
  formats = ALL_FORMATS,
  variant = 'icon',
  filenameBase,
  fetchFullContent = false,
  className,
}: DownloadMenuProps) {
  const { state } = useProyectos();
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);

  async function handleExport(format: ExportFormat): Promise<void> {
    setExportingFormat(format);
    try {
      const filename = buildFilename(entity, format, filenameBase);
      switch (entity.kind) {
        case 'initiative': {
          await dispatchInitiative(
            format,
            entity.initiative,
            state.epics,
            state.stories,
            state.pods,
            filename,
          );
          break;
        }
        case 'epic': {
          let epic = entity.epic;
          if (fetchFullContent) {
            const api = await getEpic(epic.id, true);
            epic = mergeEpicNarrative(epic, api);
          }
          const initiative = epic.initiativeId
            ? state.initiatives.find((i) => i.id === epic.initiativeId) ?? null
            : null;
          await dispatchEpic(format, epic, initiative, state.pods, state.stories, filename);
          break;
        }
        case 'story': {
          let story = entity.story;
          if (fetchFullContent) {
            const api = await getStory(story.id, true);
            story = mergeStoryContent(story, api);
          }
          const epic = state.epics.find((e) => e.id === story.epicId) ?? null;
          const pod = state.pods.find((p) => p.id === story.podId) ?? null;
          await dispatchStory(format, story, epic, pod, filename);
          break;
        }
        case 'initiatives-list':
          await dispatchInitiativesList(
            format,
            entity.initiatives,
            state.epics,
            state.stories,
            filename,
          );
          break;
        case 'epics-list':
          await dispatchEpicsList(format, entity.epics, filename);
          break;
        case 'stories-list':
          await dispatchStoriesList(format, entity.stories, state.epics, state.pods, filename);
          break;
      }
      toast.success('Archivo descargado');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast.error(`Error al exportar: ${msg}`);
    } finally {
      setExportingFormat(null);
    }
  }

  const isExporting = exportingFormat !== null;
  const triggerLabel = isExporting ? 'Exportando' : 'Descargar';

  const triggerContent =
    variant === 'button' ? (
      <>
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span>{triggerLabel}</span>
      </>
    ) : isExporting ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      <Download className="h-4 w-4" />
    );

  return (
    <PermissionGate permission={Permission.VIEW_ALL}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant === 'button' ? 'outline' : 'ghost'}
            size={variant === 'button' ? 'sm' : 'icon-sm'}
            disabled={isExporting}
            aria-label="Descargar"
            className={className}
          >
            {triggerContent}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          <DropdownMenuLabel>Formato</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {formats.map((format) => {
            const Icon = formatIcons[format];
            return (
              <DropdownMenuItem
                key={format}
                onClick={() => handleExport(format)}
                disabled={isExporting}
              >
                <Icon className="h-4 w-4" />
                {FORMAT_LABELS[format]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </PermissionGate>
  );
}
