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
  return {
    ...base,
    qualitativeBenefits: api.qualitativeBenefits ?? base.qualitativeBenefits,
    quantitativeBenefits: api.quantitativeBenefits ?? base.quantitativeBenefits,
    benefitsMeasurement: api.benefitsMeasurement ?? base.benefitsMeasurement,
    scopeDescription: api.scopeDescription ?? base.scopeDescription,
    acceptanceCriteria: api.acceptanceCriteria ?? base.acceptanceCriteria,
    technologicalImprovements: api.technologicalImprovements ?? base.technologicalImprovements,
    businessPriority: api.businessPriority ?? base.businessPriority,
    teamsInvolved: api.teamsInvolved ?? base.teamsInvolved,
    impactedChannels: api.impactedChannels ?? base.impactedChannels,
    impactedFlows: api.impactedFlows ?? base.impactedFlows,
    impactSabreLevel: api.impactSabreLevel ?? base.impactSabreLevel,
    thirdPartyDependencies: api.thirdPartyDependencies ?? base.thirdPartyDependencies,
  };
}

function parseWhatHowWhen(raw: string | undefined): { what: string; how: string; when: string } {
  if (!raw) return { what: '', how: '', when: '' };
  // The API stores the 3 sub-fields as one string joined with known separators.
  // We accept labeled forms ("Qué: ... Cómo: ... Cuándo: ...") and fall back to putting
  // everything into `what`.
  const labeled = raw.match(/Qu[ée]:\s*([\s\S]*?)\s*C[óo]mo:\s*([\s\S]*?)\s*Cu[áa]ndo:\s*([\s\S]*)$/i);
  if (labeled) {
    return { what: labeled[1].trim(), how: labeled[2].trim(), when: labeled[3].trim() };
  }
  return { what: raw, how: '', when: '' };
}

function mergeStoryContent(
  base: UserStory,
  api: StoryWithContentResponse,
): UserStory {
  if (!api.content) return base;
  const po: StoryPOFields = {
    background: api.content.po?.background ?? base.po.background,
    objective: api.content.po?.objective ?? base.po.objective,
    userStory: api.content.po?.userStory ?? base.po.userStory,
    whatHowWhen: api.content.po?.whatHowWhen
      ? parseWhatHowWhen(api.content.po.whatHowWhen)
      : base.po.whatHowWhen,
    acceptanceCriteria: api.content.po?.acceptanceCriteria
      ? api.content.po.acceptanceCriteria.split(/\n/).map((l) => l.trim()).filter(Boolean)
      : base.po.acceptanceCriteria,
    additionalNotes: api.content.po?.additionalNotes ?? base.po.additionalNotes,
  };
  const technical: StoryTechnicalFields = {
    architecture: api.content.technical?.architecture ?? base.technical.architecture,
    integrationFlow: api.content.technical?.integrationFlow ?? base.technical.integrationFlow,
    validations: api.content.technical?.validations ?? base.technical.validations,
    errorHandling: api.content.technical?.errorHandling ?? base.technical.errorHandling,
    implementationChecklist:
      api.content.technical?.implementationChecklist ?? base.technical.implementationChecklist,
  };
  const qa: StoryQAFields = {
    testingStrategy: api.content.qa?.testingStrategy ?? base.qa.testingStrategy,
    linkedQAMatrixId: api.content.qa?.linkedQAMatrixId ?? base.qa.linkedQAMatrixId,
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
