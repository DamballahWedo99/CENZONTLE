'use client';

import { useMemo, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import {
  ShieldCheck,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import {
  DIAGRAM_EDGE_LABEL_MAX_CHARS,
  TRIVIAL_DIAGRAM_EDGE_LABELS,
  qualityScore,
  type QualityScore,
} from '@cenzontle/shared';

interface ValidationPanelProps {
  nodes: Node[];
  edges: Edge[];
  /** Si el user prefiere colapsarlo. Default expanded. */
  defaultOpen?: boolean;
}

type WarningSeverity = 'warning' | 'info';

interface ValidationWarning {
  id: string;
  severity: WarningSeverity;
  message: string;
}

/** Máximo de warnings renderizados; el resto se cuentan en "+N más". */
const MAX_VISIBLE_WARNINGS = 10;

/** Umbral de caracteres tras el cual un edge label se considera "largo". */
const EDGE_LABEL_LONG_THRESHOLD = DIAGRAM_EDGE_LABEL_MAX_CHARS;

/**
 * Umbral duros para mapeo score → color:
 *   verde ≥ 0.85  |  ámbar ≥ 0.6  |  rojo < 0.6
 */
const SCORE_GREEN_THRESHOLD = 0.85;
const SCORE_AMBER_THRESHOLD = 0.6;

/**
 * Panel de validación discreto (bottom-right del canvas) que muestra en vivo
 * el score de calidad estructural del diagrama + warnings específicos.
 *
 * Se mantiene **localmente stateful** para el toggle colapsado/expandido.
 * El cálculo pesado (qualityScore O(n²) en crossings + warnings) vive bajo
 * useMemo([nodes, edges]) para evitar recompute en cada render del canvas.
 *
 * Los warnings viven acá (no en diagram-quality-metrics) porque son
 * heurísticas de UX específicas del editor, no métricas de layout. Mantenerlas
 * separadas deja al score como métrica objetiva pura.
 */
export function ValidationPanel({
  nodes,
  edges,
  defaultOpen = true,
}: ValidationPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  const { score, warnings } = useMemo(() => {
    const scoreResult = qualityScore(nodes, edges);
    const warningList = computeWarnings(nodes, edges);
    return { score: scoreResult, warnings: warningList };
  }, [nodes, edges]);

  const tone = scoreTone(score.score);
  const visibleWarnings = warnings.slice(0, MAX_VISIBLE_WARNINGS);
  const hiddenCount = warnings.length - visibleWarnings.length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full bg-zinc-900/95 border border-zinc-700 px-3 py-1.5 shadow-xl backdrop-blur-sm text-xs font-medium text-zinc-200 hover:bg-zinc-800/95 transition-colors"
        aria-label={`Expandir panel de validación. Score actual: ${score.score.toFixed(2)}`}
      >
        <span
          className={`h-2 w-2 rounded-full ${tone.dotClass}`}
          aria-hidden="true"
        />
        <span className="font-mono tabular-nums">{score.score.toFixed(2)}</span>
        <ChevronUp className="h-3 w-3 text-zinc-500" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      className="w-72 rounded-lg bg-zinc-900/95 border border-zinc-700 shadow-xl backdrop-blur-sm flex flex-col max-h-[420px]"
      role="region"
      aria-label="Panel de validación del diagrama"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className={`h-3.5 w-3.5 ${tone.iconClass}`} aria-hidden="true" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Calidad del diagrama
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Colapsar panel"
            title="Colapsar"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Cerrar panel"
            title="Cerrar"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body scrollable */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Score grande */}
        <div className="flex items-baseline gap-2">
          <span
            className={`text-3xl font-bold font-mono tabular-nums ${tone.textClass}`}
          >
            {score.score.toFixed(2)}
          </span>
          <span className="text-[11px] text-zinc-500">/ 1.00</span>
        </div>

        {/* Breakdown de métricas */}
        <MetricsBreakdown score={score} />

        {/* Warnings */}
        {warnings.length > 0 ? (
          <div className="pt-1 border-t border-zinc-800 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 pt-1">
              Advertencias ({warnings.length})
            </div>
            <ul className="space-y-1">
              {visibleWarnings.map((w) => (
                <WarningRow key={w.id} warning={w} />
              ))}
            </ul>
            {hiddenCount > 0 ? (
              <div className="text-[10px] text-zinc-500 italic pt-0.5">
                +{hiddenCount} más
              </div>
            ) : null}
          </div>
        ) : (
          <div className="pt-1 border-t border-zinc-800">
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 pt-1">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Sin advertencias estructurales
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function MetricsBreakdown({ score }: { score: QualityScore }) {
  // Cada métrica se normaliza a [0,1] donde 1 = mejor, para que la barrita
  // visual sea consistente (más llena = mejor) independiente de si la métrica
  // es "lower is better" (overlaps, crossings) o "higher is better" (handle
  // validity).
  const items: Array<{ label: string; raw: string; normalized: number }> = [
    {
      label: 'Solapamiento',
      raw: `${(score.nodeOverlapRatio * 100).toFixed(0)}%`,
      normalized: 1 - score.nodeOverlapRatio,
    },
    {
      label: 'Cruces edge-nodo',
      raw: String(score.edgeNodeCrossings),
      normalized: score.edgeNodeCrossings === 0 ? 1 : Math.max(0, 1 - score.edgeNodeCrossings / 10),
    },
    {
      label: 'Cruces edge-edge',
      raw: String(score.edgeEdgeCrossings),
      normalized: score.edgeEdgeCrossings === 0 ? 1 : Math.max(0, 1 - score.edgeEdgeCrossings / 20),
    },
    {
      label: 'Handles válidos',
      raw: `${(score.handleValidityRatio * 100).toFixed(0)}%`,
      normalized: score.handleValidityRatio,
    },
    {
      label: 'Edge promedio',
      raw: `${score.avgEdgeLength.toFixed(0)}px`,
      normalized: 1, // sanity check, no se penaliza
    },
  ];

  return (
    <div className="space-y-1.5 pt-1 border-t border-zinc-800">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 pt-1">
        Métricas
      </div>
      {items.map((m) => (
        <div key={m.label} className="space-y-0.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">{m.label}</span>
            <span className="font-mono tabular-nums text-zinc-300">{m.raw}</span>
          </div>
          <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor(m.normalized)}`}
              style={{ width: `${Math.round(clamp01(m.normalized) * 100)}%` }}
              aria-hidden="true"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function WarningRow({ warning }: { warning: ValidationWarning }) {
  const Icon = warning.severity === 'warning' ? AlertTriangle : Info;
  const colorCls =
    warning.severity === 'warning' ? 'text-amber-400' : 'text-sky-400';
  return (
    <li className="flex items-start gap-1.5 text-[11px] text-zinc-300 leading-tight">
      <Icon
        className={`h-3 w-3 mt-0.5 flex-shrink-0 ${colorCls}`}
        aria-hidden="true"
      />
      <span>{warning.message}</span>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Warning computation (heurísticas UX del editor)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Labels de edge prohibidos — alias local que deriva de
 * `TRIVIAL_DIAGRAM_EDGE_LABELS` en `@cenzontle/shared`. Así backend y
 * frontend consumen la misma lista y no divergen silenciosamente si alguien
 * añade un token a futuro.
 */
const TRIVIAL_EDGE_LABELS = TRIVIAL_DIAGRAM_EDGE_LABELS;

/**
 * Calcula warnings estructurales sobre nodes/edges.
 *
 * Las heurísticas viven acá (y no en qualityScore) porque son **guías
 * accionables** para el user editando, no métricas objetivas del layout.
 * Cada warning sugiere implícitamente qué arreglar.
 *
 * Algunas reglas (edge sin label, labels genéricos, labels >12 chars, orphans)
 * están ahora también enforzadas en el backend validator — este panel las
 * sigue mostrando porque el editor manual permite estados inválidos temporales
 * (ej: user arrastra node al canvas sin conectar aún).
 */
function computeWarnings(nodes: Node[], edges: Edge[]): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // 1) Edges sin label o con label genérico.
  // Racional (C4 model / icepanel top-mistakes): una arista desnuda es la
  // queja #1 en revisiones de arquitectura — el lector no sabe si es
  // "calls", "publishes", "reads", etc. Labels como "uses" son igual de
  // ambiguos. Espejo de TRIVIAL_EDGE_LABELS en el backend validator.
  for (const edge of edges) {
    const raw = typeof edge.label === 'string' ? edge.label.trim() : '';
    if (!raw) {
      warnings.push({
        id: `edge-no-label:${edge.id}`,
        severity: 'warning',
        message: `Edge sin label (${edge.source} → ${edge.target}). Usa verbo específico: calls, publish, reads, routes.`,
      });
      continue;
    }
    if (TRIVIAL_EDGE_LABELS.has(raw.toLowerCase())) {
      warnings.push({
        id: `edge-trivial-label:${edge.id}`,
        severity: 'warning',
        message: `Edge con label genérico "${raw}". Reemplaza por verbo específico (calls, publish, reads, etc.).`,
      });
    }
  }

  // 2) Decisions sin ≥2 edges salientes.
  // Racional: un "decision node" representa una bifurcación; una sola salida
  // es un if sin else, que suele ser un error de modelado.
  const outgoingCountByNode = new Map<string, number>();
  for (const edge of edges) {
    outgoingCountByNode.set(
      edge.source,
      (outgoingCountByNode.get(edge.source) ?? 0) + 1,
    );
  }
  for (const node of nodes) {
    const data = node.data as { nodeType?: string; label?: string } | undefined;
    if (data?.nodeType !== 'decision') continue;
    const count = outgoingCountByNode.get(node.id) ?? 0;
    if (count < 2) {
      warnings.push({
        id: `decision-branches:${node.id}`,
        severity: 'warning',
        message: `Decisión sin suficientes ramas: ${nodeLabel(node)}`,
      });
    }
  }

  // 3) Nodes huérfanos (sin edges entrantes ni salientes).
  // Racional: un node desconectado es casi siempre residuo de un delete a
  // medias o un drag sin conectar. Raramente intencional.
  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }
  for (const node of nodes) {
    if (!connectedIds.has(node.id)) {
      warnings.push({
        id: `orphan:${node.id}`,
        severity: 'info',
        message: `Nodo sin conexiones: ${nodeLabel(node)}`,
      });
    }
  }

  // 4) Labels largos (>12 chars).
  // Racional: edges con labels largos sobrescriben al edge y rompen la
  // legibilidad. El PropertyPanel ya sugiere 12 como máximo.
  for (const edge of edges) {
    if (typeof edge.label !== 'string') continue;
    if (edge.label.length <= EDGE_LABEL_LONG_THRESHOLD) continue;
    warnings.push({
      id: `long-label:${edge.id}`,
      severity: 'info',
      message: `Label largo (>${EDGE_LABEL_LONG_THRESHOLD} chars): "${edge.label}"`,
    });
  }

  // 5) Nodes con el mismo label exacto (potencial duplicación).
  // Racional: dos nodos con label idéntico casi siempre indican una copia
  // accidental o un refactor a medias. Comparamos case-insensitive + trim
  // (mismo criterio que `buildReflectionChecklist` en el backend) para
  // atrapar "Auth Service" y "auth service " como duplicados.
  const byLabel = new Map<string, { display: string; nodes: Node[] }>();
  for (const node of nodes) {
    const data = node.data as { label?: string } | undefined;
    const raw = data?.label?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const bucket = byLabel.get(key) ?? { display: raw, nodes: [] };
    bucket.nodes.push(node);
    byLabel.set(key, bucket);
  }
  for (const [key, { display, nodes: dupes }] of byLabel) {
    if (dupes.length < 2) continue;
    warnings.push({
      id: `duplicate-label:${key}`,
      severity: 'warning',
      message: `${dupes.length} nodos con label idéntico: "${display}"`,
    });
  }

  return warnings;
}

// ────────────────────────────────────────────────────────────────────────────
// Presentation helpers
// ────────────────────────────────────────────────────────────────────────────

interface ScoreTone {
  dotClass: string;
  textClass: string;
  iconClass: string;
}

function scoreTone(score: number): ScoreTone {
  if (score >= SCORE_GREEN_THRESHOLD) {
    return {
      dotClass: 'bg-emerald-400',
      textClass: 'text-emerald-400',
      iconClass: 'text-emerald-400',
    };
  }
  if (score >= SCORE_AMBER_THRESHOLD) {
    return {
      dotClass: 'bg-amber-400',
      textClass: 'text-amber-400',
      iconClass: 'text-amber-400',
    };
  }
  return {
    dotClass: 'bg-red-500',
    textClass: 'text-red-400',
    iconClass: 'text-red-400',
  };
}

function barColor(normalized: number): string {
  if (normalized >= SCORE_GREEN_THRESHOLD) return 'bg-emerald-500';
  if (normalized >= SCORE_AMBER_THRESHOLD) return 'bg-amber-500';
  return 'bg-red-500';
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function nodeLabel(node: Node): string {
  const data = node.data as { label?: string } | undefined;
  const label = data?.label?.trim();
  return label && label.length > 0 ? label : `#${node.id}`;
}
