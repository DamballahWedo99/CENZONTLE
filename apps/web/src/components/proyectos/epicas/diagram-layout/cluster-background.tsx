'use client';

import { useStore } from '@xyflow/react';
import type { ClusterBounds } from './elk-layout';
import { truncateToFitPx, measureLabelPx } from './truncate-label';

interface ClusterBackgroundProps {
  clusters: ClusterBounds[];
  /** Padding alrededor del cluster real, en px de layout (no de pantalla). */
  padding?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Label/pill typography constants
// ────────────────────────────────────────────────────────────────────────────

const LABEL_FONT_SIZE = 11;
/** Distancia (px) entre el borde izquierdo del cluster y el comienzo del texto. */
const LABEL_INSET_X = 10;
/** Distancia (px) entre el borde superior del cluster y la baseline del texto. */
const LABEL_OFFSET_ABOVE = 6;
/** Padding horizontal interior del pill (a cada lado del texto). */
const LABEL_PILL_PADDING_X = 8;
/** Alto del pill. Cubre ascender + x-height + descender + 4px de aire. */
const LABEL_PILL_HEIGHT = 16;
/** Distancia desde la baseline del texto al borde superior del pill. */
const LABEL_PILL_TOP_FROM_BASELINE = 12;

/**
 * Renderiza rectángulos SVG con el bounding box de cada cluster, transformados
 * por la cámara actual de ReactFlow (pan/zoom). Se posiciona detrás de todo
 * el contenido del canvas (pointer-events: none).
 *
 * Cada cluster lleva un label con PILL DE FONDO posicionado ARRIBA del rect
 * (fuera del contenido), no dentro. Esto evita solapamientos con los nodos
 * y permite leer el nombre del grupo sin interferir con el flujo.
 *
 * El label se trunca con `…` si no cabe en el ancho disponible, para mantener
 * el pill siempre dentro del área horizontal del cluster (y no chocar con
 * clusters hermanos adyacentes).
 */
export function ClusterBackground({ clusters, padding = 26 }: ClusterBackgroundProps) {
  // Transformación actual de la cámara de ReactFlow. En el primer render puede
  // no estar aún — usamos [0, 0, 1] como fallback hasta que el store esté listo.
  const transform = useStore((s) => s.transform);
  const tx = transform?.[0] ?? 0;
  const ty = transform?.[1] ?? 0;
  const zoom = transform?.[2] ?? 1;

  if (!clusters.length) return null;

  // Filtrar clusters con bounds inválidos (NaN/Infinity) — ELK puede producir
  // bounds indefinidos si el cluster está vacío o degenerado.
  const validClusters = clusters.filter(
    (c) =>
      Number.isFinite(c.x) &&
      Number.isFinite(c.y) &&
      Number.isFinite(c.width) &&
      Number.isFinite(c.height) &&
      c.width > 0 &&
      c.height > 0,
  );
  if (!validClusters.length) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width="100%"
      height="100%"
      style={{ zIndex: 0 }}
    >
      <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
        {validClusters.map((c) => {
          // Geometría del rect exterior del cluster.
          const rectX = c.x - padding;
          const rectY = c.y - padding;
          const rectW = c.width + padding * 2;
          const rectH = c.height + padding * 2;

          // Geometría del label: baseline arriba del rect, texto comenzando
          // con un inset desde el borde izquierdo.
          const labelBaselineY = rectY - LABEL_OFFSET_ABOVE;
          const labelX = rectX + LABEL_INSET_X;

          // Máximo ancho del label para que el pill nunca sobresalga del
          // ancho horizontal del cluster (margen del inset a cada lado).
          const maxLabelWidth = Math.max(0, rectW - LABEL_INSET_X * 2);
          const displayLabel = truncateToFitPx(c.label, maxLabelWidth, LABEL_FONT_SIZE);

          // Caso degenerate: el cluster es tan angosto que ni "…" cabe.
          // Renderizamos solo el rect sin label.
          if (!displayLabel) {
            return (
              <rect
                key={c.id}
                x={rectX}
                y={rectY}
                width={rectW}
                height={rectH}
                rx={14}
                ry={14}
                fill={c.color}
                fillOpacity={0.06}
                stroke={c.color}
                strokeOpacity={0.3}
                strokeWidth={1}
                strokeDasharray="6 4"
              />
            );
          }

          // Ancho del pill basado en la medida del texto truncado + padding.
          const labelPxWidth = measureLabelPx(displayLabel, LABEL_FONT_SIZE);
          const pillX = labelX - LABEL_PILL_PADDING_X;
          const pillY = labelBaselineY - LABEL_PILL_TOP_FROM_BASELINE;
          const pillW = labelPxWidth + LABEL_PILL_PADDING_X * 2;

          return (
            <g key={c.id}>
              {/* Cluster rect — fondo tenue con borde dashed del color del grupo. */}
              <rect
                x={rectX}
                y={rectY}
                width={rectW}
                height={rectH}
                rx={14}
                ry={14}
                fill={c.color}
                fillOpacity={0.06}
                stroke={c.color}
                strokeOpacity={0.3}
                strokeWidth={1}
                strokeDasharray="6 4"
              />
              {/* Pill del label — fondo opaco para despegar el texto del canvas. */}
              <rect
                x={pillX}
                y={pillY}
                width={pillW}
                height={LABEL_PILL_HEIGHT}
                rx={8}
                ry={8}
                fill="rgb(9,9,11)"
                fillOpacity={0.92}
                stroke={c.color}
                strokeOpacity={0.4}
                strokeWidth={1}
              />
              <text
                x={labelX}
                y={labelBaselineY}
                fill={c.color}
                fillOpacity={0.95}
                fontSize={LABEL_FONT_SIZE}
                fontWeight={600}
                style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
              >
                {displayLabel}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
