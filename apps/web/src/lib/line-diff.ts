/**
 * Diff de líneas para las propuestas del asistente. LCS clásico con dos
 * optimizaciones que lo mantienen barato en documentos de 60K chars:
 *   1. Trim de prefijo/sufijo común — los cambios de una propuesta suelen
 *      ser locales, así que la "ventana" diferente es pequeña.
 *   2. Cap de la ventana (800×800 líneas) — si se excede, degradamos a
 *      "bloque removido + bloque agregado" en vez de colgar el main thread
 *      con una matriz de millones de celdas.
 */

export type DiffLine =
  | { kind: 'context'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string };

const LCS_WINDOW_CAP = 800;

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // 1. Prefijo común
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  // 2. Sufijo común (sin solapar el prefijo)
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);

  const result: DiffLine[] = [];
  for (const text of oldLines.slice(0, prefix)) result.push({ kind: 'context', text });

  if (oldMid.length > LCS_WINDOW_CAP || newMid.length > LCS_WINDOW_CAP) {
    // Ventana demasiado grande: bloque plano (raro — propuesta que reescribe todo).
    for (const text of oldMid) result.push({ kind: 'removed', text });
    for (const text of newMid) result.push({ kind: 'added', text });
  } else {
    result.push(...lcsDiff(oldMid, newMid));
  }

  for (const text of oldLines.slice(oldLines.length - suffix)) {
    result.push({ kind: 'context', text });
  }
  return result;
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ kind: 'added' as const, text }));
  if (m === 0) return a.map((text) => ({ kind: 'removed' as const, text }));

  // dp[i][j] = LCS de a[i..] vs b[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ kind: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ kind: 'removed', text: a[i] });
      i++;
    } else {
      result.push({ kind: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) result.push({ kind: 'removed', text: a[i++] });
  while (j < m) result.push({ kind: 'added', text: b[j++] });
  return result;
}

/**
 * Colapsa el contexto sin cambios a `keep` líneas alrededor de cada hunk,
 * insertando separadores. Devuelve los items a renderizar.
 */
export type DiffRenderItem = DiffLine | { kind: 'gap'; hiddenCount: number };

export function collapseContext(lines: DiffLine[], keep = 2): DiffRenderItem[] {
  const isChange = (l: DiffLine) => l.kind !== 'context';
  const visible = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    if (!isChange(lines[i])) continue;
    for (let k = Math.max(0, i - keep); k <= Math.min(lines.length - 1, i + keep); k++) {
      visible[k] = true;
    }
  }

  const out: DiffRenderItem[] = [];
  let hidden = 0;
  for (let i = 0; i < lines.length; i++) {
    if (visible[i]) {
      if (hidden > 0) {
        out.push({ kind: 'gap', hiddenCount: hidden });
        hidden = 0;
      }
      out.push(lines[i]);
    } else {
      hidden++;
    }
  }
  if (hidden > 0) out.push({ kind: 'gap', hiddenCount: hidden });
  return out;
}
