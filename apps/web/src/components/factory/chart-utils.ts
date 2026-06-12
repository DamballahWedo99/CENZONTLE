'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

// =============================================================================
// Utilidades compartidas de los dashboards de analytics del Forge
// (CostAnalytics, VelocityTracker). Extraídas de CostAnalytics.tsx — solo
// piezas genéricas, nada acoplado a la semántica de costos.
// =============================================================================

// ─── Formatters ──────────────────────────────────────────────────────────────

/** Moneda USD con 2 decimales: `$1.23`. */
export function fmtCost(v: number): string {
  return `$${v.toFixed(2)}`;
}

/** Números grandes compactos: `1.2M`, `3.4K`, `512`. */
export function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toString();
}

/** Fracción 0–1 a porcentaje entero: `0.42` → `42%`. */
export function fmtPct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

/** Duración en ms legible: `45s`, `3m 12s`, `1h 4m`. */
export function fmtDurationMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m ${totalSec % 60}s`;
  const hours = Math.floor(totalMin / 60);
  return `${hours}h ${totalMin % 60}m`;
}

// ─── Estadística ─────────────────────────────────────────────────────────────

/** Regresión lineal por mínimos cuadrados sobre puntos {x, y}. */
export function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, rSquared: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const ssTot = points.reduce((s, p) => s + (p.y - sumY / n) ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, rSquared };
}

// ─── Layout hooks ────────────────────────────────────────────────────────────

// useLayoutEffect en el browser para medir ANTES del primer paint — sin esto
// el primer frame pinta con el default 600px y los SVG desbordan en
// contenedores angostos (qa-reviewer 2026-06-11). useEffect en SSR, donde
// useLayoutEffect emite warning y no hay layout que medir.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Ancho reactivo del contenedor (ResizeObserver) con default SSR de 600px. */
export function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(600);
  useIsomorphicLayoutEffect(() => {
    if (!ref.current) return;
    // Medición síncrona pre-paint del mount; el observer cubre los resizes.
    setWidth(ref.current.getBoundingClientRect().width);
    const obs = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return width;
}
