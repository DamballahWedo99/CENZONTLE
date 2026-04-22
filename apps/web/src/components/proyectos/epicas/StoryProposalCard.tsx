'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Code2,
  TestTube2,
  FileText,
  AlertTriangle,
  GitBranch,
} from 'lucide-react';
import type { ProposedStory, Pod, DependencySeverity } from '@cenzontle/shared';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';

type ExpandedSection = 'po' | 'technical' | 'qa' | 'deps' | null;

const depSeverityColor: Record<DependencySeverity, string> = {
  critical: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900/40',
  high: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900/40',
  medium: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/40',
  low: 'text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700/40',
};

interface StoryProposalCardProps {
  proposal: ProposedStory;
  pods: Pod[];
  /**
   * Resto de propuestas del mismo batch. Se usa para resolver los títulos
   * de las historias en `proposal.blockedBy` (que vienen como `clientId`).
   * Opcional: si no se pasa, el badge muestra solo el count sin título.
   */
  batchProposals?: ProposedStory[];
  onAccept: (proposal: ProposedStory) => void;
  onDiscard: (clientId: string) => void;
  accepting?: boolean;
}

export function StoryProposalCard({
  proposal,
  pods,
  batchProposals,
  onAccept,
  onDiscard,
  accepting,
}: StoryProposalCardProps) {
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);
  const pod = pods.find((p) => p.id === proposal.podId);
  const docsCount = proposal.relatedDocuments?.length ?? 0;
  const depsCount = proposal.discoveredDependencies?.length ?? 0;
  const blockedBy = proposal.blockedBy ?? [];

  // Lookup de títulos para los clientIds bloqueantes. Fallback a truncated
  // clientId si el batch no pasa el contexto (edge case).
  const blockerTitles = blockedBy.map((edge) => {
    const src = batchProposals?.find((p) => p.clientId === edge.storyClientId);
    return {
      title: src?.title ?? edge.storyClientId.slice(0, 20),
      hardness: edge.hardness,
      reason: edge.reason,
      description: edge.description,
    };
  });
  const hasHardBlocker = blockerTitles.some((b) => b.hardness === 'hard');

  const toggleSection = (section: Exclude<ExpandedSection, null>) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  return (
    <div className="rounded-lg border-2 border-dashed border-primary/20 bg-primary/[0.02] p-4 space-y-3 transition-colors hover:border-primary/30">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="h-2.5 w-2.5" />
              IA
            </span>
            <StoryPointsBadge points={proposal.storyPoints} />
            {pod && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full border"
                style={{ borderColor: `${pod.color}40`, color: pod.color, backgroundColor: `${pod.color}10` }}
              >
                {pod.name}
              </span>
            )}
            {docsCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                title={`${docsCount} documento(s) de la epica vinculados`}
              >
                <FileText className="h-2.5 w-2.5" />
                {docsCount} docs
              </span>
            )}
            {depsCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                title={`${depsCount} dependencia(s) descubierta(s) por el agente QA`}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {depsCount} deps
              </span>
            )}
            {blockerTitles.length > 0 && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                  hasHardBlocker
                    ? 'bg-destructive/10 text-destructive border-destructive/20'
                    : 'bg-muted text-foreground/80 border-border'
                }`}
                title={
                  blockerTitles
                    .map((b) => `[${b.hardness}] ${b.reason}: ${b.title}${b.description ? ` — ${b.description}` : ''}`)
                    .join('\n')
                }
              >
                <GitBranch className="h-2.5 w-2.5" />
                Bloqueada por {blockerTitles.length}
              </span>
            )}
          </div>
          <h4 className="text-sm font-medium mt-1.5 leading-snug">{proposal.title}</h4>
          {blockerTitles.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {blockerTitles.slice(0, 3).map((b, idx) => (
                <li
                  key={idx}
                  className="text-[11px] text-muted-foreground flex items-start gap-1"
                >
                  <GitBranch className="h-3 w-3 mt-0.5 shrink-0 opacity-60" />
                  <span className="truncate">
                    <span className={b.hardness === 'hard' ? 'text-destructive font-medium' : ''}>
                      [{b.hardness === 'hard' ? 'hard' : 'soft'}]
                    </span>{' '}
                    {b.title}
                  </span>
                </li>
              ))}
              {blockerTitles.length > 3 && (
                <li className="text-[10px] text-muted-foreground/70 pl-4">+{blockerTitles.length - 3} más…</li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground line-clamp-2">{proposal.description}</p>

      {/* Labels */}
      {proposal.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {proposal.labels.slice(0, 5).map((label) => (
            <span
              key={label}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {label}
            </span>
          ))}
          {proposal.labels.length > 5 && (
            <span className="text-[10px] text-muted-foreground">+{proposal.labels.length - 5}</span>
          )}
        </div>
      )}

      {/* Section expandable previews */}
      <div className="space-y-1">
        <SectionToggle
          icon={<ClipboardList className="h-3 w-3" />}
          label="PO"
          detail={`${proposal.po.acceptanceCriteria.length} criterios`}
          expanded={expandedSection === 'po'}
          onToggle={() => toggleSection('po')}
        />
        {expandedSection === 'po' && <POPreview po={proposal.po} />}

        <SectionToggle
          icon={<Code2 className="h-3 w-3" />}
          label="Tech Lead"
          detail={`${proposal.technical.validations.length} valid, ${proposal.technical.errorHandling.length} err, ${proposal.technical.implementationChecklist.length} pasos`}
          expanded={expandedSection === 'technical'}
          onToggle={() => toggleSection('technical')}
        />
        {expandedSection === 'technical' && <TechnicalPreview technical={proposal.technical} />}

        <SectionToggle
          icon={<TestTube2 className="h-3 w-3" />}
          label="QA"
          detail={proposal.qa.testingStrategy ? 'Strategy definida' : 'Sin strategy'}
          expanded={expandedSection === 'qa'}
          onToggle={() => toggleSection('qa')}
        />
        {expandedSection === 'qa' && <QAPreview qa={proposal.qa} />}

        {depsCount > 0 && (
          <>
            <SectionToggle
              icon={<GitBranch className="h-3 w-3" />}
              label="Dependencias"
              detail={`${depsCount} descubierta${depsCount === 1 ? '' : 's'} por QA`}
              expanded={expandedSection === 'deps'}
              onToggle={() => toggleSection('deps')}
            />
            {expandedSection === 'deps' && (
              <DepsPreview deps={proposal.discoveredDependencies ?? []} />
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 flex-1"
          onClick={() => onAccept(proposal)}
          disabled={accepting}
        >
          <Check className="h-3 w-3" />
          {accepting ? 'Guardando...' : 'Aceptar'}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDiscard(proposal.clientId)}
          title="Descartar"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function SectionToggle({
  icon,
  label,
  detail,
  expanded,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 rounded-md px-2 py-1 text-[11px] hover:bg-muted/50 transition-colors text-left"
    >
      <span className="text-primary/70">{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground text-[10px] truncate flex-1">{detail}</span>
      {expanded ? (
        <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
      ) : (
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

function POPreview({ po }: { po: ProposedStory['po'] }) {
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2 space-y-2 text-[11px]">
      {po.userStory && (
        <div>
          <div className="text-muted-foreground font-medium mb-0.5">Historia</div>
          <p className="text-foreground/80 line-clamp-2">{po.userStory}</p>
        </div>
      )}
      {po.objective && (
        <div>
          <div className="text-muted-foreground font-medium mb-0.5">Objetivo</div>
          <p className="text-foreground/80 line-clamp-2">{po.objective}</p>
        </div>
      )}
      {po.acceptanceCriteria.length > 0 && (
        <div>
          <div className="text-muted-foreground font-medium mb-0.5">
            Criterios ({po.acceptanceCriteria.length})
          </div>
          <ul className="space-y-0.5">
            {po.acceptanceCriteria.slice(0, 3).map((c, i) => (
              <li key={i} className="text-foreground/80 line-clamp-1">
                <span className="text-muted-foreground mr-1">·</span>
                {c}
              </li>
            ))}
            {po.acceptanceCriteria.length > 3 && (
              <li className="text-muted-foreground italic">+{po.acceptanceCriteria.length - 3} mas</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function TechnicalPreview({ technical }: { technical: ProposedStory['technical'] }) {
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2 space-y-2 text-[11px]">
      {technical.architecture && (
        <div>
          <div className="text-muted-foreground font-medium mb-0.5">Arquitectura</div>
          <p className="text-foreground/80 line-clamp-3 whitespace-pre-line">
            {technical.architecture}
          </p>
        </div>
      )}
      {technical.implementationChecklist.length > 0 && (
        <div>
          <div className="text-muted-foreground font-medium mb-0.5">
            Checklist ({technical.implementationChecklist.length})
          </div>
          <ul className="space-y-0.5">
            {technical.implementationChecklist.slice(0, 3).map((c, i) => (
              <li key={i} className="text-foreground/80 line-clamp-1">
                <span className="text-muted-foreground mr-1">·</span>
                {c}
              </li>
            ))}
            {technical.implementationChecklist.length > 3 && (
              <li className="text-muted-foreground italic">
                +{technical.implementationChecklist.length - 3} mas
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function QAPreview({ qa }: { qa: ProposedStory['qa'] }) {
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2 space-y-1 text-[11px]">
      {qa.testingStrategy ? (
        <>
          <div className="text-muted-foreground font-medium mb-0.5">Testing Strategy</div>
          <p className="text-foreground/80 line-clamp-4 whitespace-pre-line">
            {qa.testingStrategy}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground italic">Sin estrategia generada</p>
      )}
    </div>
  );
}

function DepsPreview({ deps }: { deps: NonNullable<ProposedStory['discoveredDependencies']> }) {
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2 space-y-2 text-[11px]">
      <div className="text-muted-foreground font-medium mb-0.5">
        Dependencias descubiertas ({deps.length})
      </div>
      <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {deps.map((dep) => (
          <li key={dep.id} className="rounded bg-background/50 border border-border/40 px-2 py-1.5">
            <div className="flex items-center justify-between gap-1.5 mb-0.5">
              <span className="font-medium text-foreground/90 line-clamp-1 flex-1">{dep.title}</span>
              <span
                className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${depSeverityColor[dep.severity]}`}
              >
                {dep.severity}
              </span>
              <span className="text-[9px] text-muted-foreground/70 shrink-0 uppercase tracking-wider">
                {dep.type}
              </span>
            </div>
            <p className="text-foreground/70 line-clamp-2" title={dep.mdContent}>
              {dep.description}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
