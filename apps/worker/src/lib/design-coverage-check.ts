import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import type { ComponentManifest, DesignManifestComponent } from '@cenzontle/shared';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Layer 1 DoD check — `design-coverage-check`.
 *
 * Verifica que CADA componente del/los `ComponentManifest` que extrajo el
 * backend (Stream A: `design-bundle.service`) del bundle del diseño esté
 * implementado en el código del workdir tras el run del coder. Es la red
 * de seguridad contra agentes que ignoran parte del diseño UX/UI.
 *
 * Política (consistente con `security-scan` / `docs-updated` que ya viven en
 * `dod-verifier.ts`):
 *   - Manifest vacío o sin `componentManifests` en el claim → `skipped`.
 *   - Todos los componentes encontrados → `passed`.
 *   - 1+ componente faltante → `failed` con razón que lista los nombres.
 *
 * El check es **WARN no bloqueante**: el caller del runner ya filtra los
 * verdicts del verifier por `status === 'failed'` pero NO mata el run con
 * un solo verdict failed (ver `runner.ts:hasFailedCriteria`); el push y el
 * complete siguen su curso, los warns quedan visibles en la UI y el
 * operador decide si re-encolar la historia.
 *
 * Heurística del grep
 * --------------------
 * El nombre del componente puede aparecer en archivos con nombre distinto al
 * del componente (TopBar definido en `Header.tsx`, por ejemplo). El grep
 * usa un regex compuesto que matchea cualquiera de:
 *   - `function TopBar(`           → declaración de función.
 *   - `function TopBar<` o `<T>`   → función genérica.
 *   - `export function TopBar`     → export named de función.
 *   - `const TopBar =`             → declaración arrow / FC.
 *   - `class TopBar `              → declaración de clase.
 *   - `class TopBar(`              → clase con paréntesis (raro pero válido).
 *   - `<TopBar`                    → uso como elemento JSX.
 *
 * El boundary `\b` antes del nombre evita que `TopBar` matchee `TopBarLite`.
 *
 * Restringimos extensiones a `.ts`, `.tsx`, `.js`, `.jsx` — el manifest viene
 * de un bundle UI (React/Next), no aplica a `.py`/`.go`/etc.
 *
 * El grep se hace case-sensitive porque los nombres de componente React son
 * PascalCase canónico (`TopBar` ≠ `topbar` semánticamente).
 */

const DEFAULT_WORKDIR_SRC = 'src';
const GREP_TIMEOUT_MS = 30_000;
const GREP_MAX_BUFFER = 5 * 1024 * 1024; // 5MB headroom — el grep solo lista paths

/**
 * Construye el regex compuesto para detectar la presencia de un componente
 * en código JS/TS/JSX/TSX. Los 6 alternantes cubren los patrones de
 * declaración/uso más comunes en React (y class components legacy).
 *
 * El `\b<NAME>\b` boundary evita matches parciales (`TopBarLite` no matchea
 * `TopBar`).
 *
 * Escapamos `name` con `escapeRegex` porque el nombre puede venir de input
 * humano (un diseñador puede haber escrito un nombre con caracteres
 * inesperados en el bundle). No queremos que `name = "."` matchee todo.
 *
 * Exportado para tests unitarios.
 */
export function buildComponentRegex(componentName: string): string {
  const escaped = escapeRegex(componentName);
  // Boundary `\b` antes y dentro de cada alternante. ERE (POSIX) no
  // soporta lookahead así que usamos alternancia explícita: para el patrón
  // `<NAME` necesitamos que el char DESPUÉS de NAME sea `>`, `/`, `\s` o el
  // fin del bloque JSX (`>`). Lo cubrimos con un caracter set `[\s/>]` después.
  //
  // Los 7 alternantes:
  //   1. function <NAME>(           — declaración de función con paréntesis
  //   2. function <NAME><           — función genérica `function TopBar<T>()`
  //   3. export function <NAME>     — export named function
  //   4. const <NAME>\s*=           — `const TopBar = ...` (arrow / FC)
  //   5. class <NAME>\b             — declaración de clase
  //   6. <<NAME>[\s/>]              — uso como elemento JSX `<TopBar ...>` o `<TopBar/>`
  //
  // Nota: usamos `grep -E` (ERE) — la sintaxis no soporta `\d`/`\w` GNU
  // específicos pero `\b` SÍ está soportado en grep GNU + BSD (macOS).
  return [
    `function[[:space:]]+${escaped}[[:space:]]*\\(`,
    `function[[:space:]]+${escaped}[[:space:]]*<`,
    `export[[:space:]]+function[[:space:]]+${escaped}\\b`,
    `const[[:space:]]+${escaped}[[:space:]]*=`,
    `class[[:space:]]+${escaped}\\b`,
    `<${escaped}[[:space:]/>]`,
  ].join('|');
}

/**
 * Escapa caracteres especiales de regex (ERE/PCRE). Usado tanto para el
 * grep como para los matchers de tests. Mantenido aquí (no en
 * `secrets.ts`/utilidad global) para que el módulo sea self-contained.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Verdict per-componente. `found` indica si el grep retornó ≥1 match en
 * algún archivo bajo `${workdir}/src`.
 */
export interface ComponentCoverageVerdict {
  component: DesignManifestComponent;
  found: boolean;
  /** Paths donde se encontró match (cap 5). Vacío si `found=false`. Usado
   *  para forensics en el log estructurado. */
  matchedPaths: string[];
}

/**
 * Verdict agregado del check. `passed` indica que TODOS los componentes
 * fueron encontrados. `missing` lista los que faltaron (vacío si pasó).
 *
 * `skipped` se usa cuando no hay manifest aplicable — el caller decide
 * cómo materializar eso en el `CriterionVerdict` final (status='skipped').
 */
export interface DesignCoverageResult {
  status: 'passed' | 'failed' | 'skipped';
  /** Reason humano-readable. */
  reason: string;
  /** Verdicts per-componente, en el mismo orden de entrada. Vacío si
   *  `status='skipped'` (no había manifest que evaluar). */
  perComponent: ComponentCoverageVerdict[];
}

/**
 * Resuelve el directorio source a escanear. Heurística:
 *   1. Si `${workdir}/src` existe → usar `src`.
 *   2. Si no → escanear `${workdir}` directamente (proyectos sin convención).
 *
 * Sin probar `./app`, `./components`, etc. — el grep recursivo desde la raíz
 * cubre cualquier estructura monorepo / non-standard. El cap del grep en
 * sí ya filtra `node_modules`/`.git`/`dist`/`build`.
 */
async function resolveSearchRoot(workdir: string): Promise<string> {
  try {
    const stat = await fs.stat(join(workdir, DEFAULT_WORKDIR_SRC));
    if (stat.isDirectory()) return join(workdir, DEFAULT_WORKDIR_SRC);
  } catch {
    // src no existe — fallback al workdir entero
  }
  return workdir;
}

/**
 * Corre grep recursivo para un componente. Retorna paths que matchean.
 * Cap a 5 paths — más que eso no aporta forensics, y el output del grep
 * podría inflarse en repos grandes.
 *
 * Modo `grep -E -l` (extended regex + list-files-only): el output es una
 * línea por archivo que matchea. Si no matchea, exit code 1 (lo que sería
 * "error" normalmente) — lo tratamos como "no found" semánticamente.
 *
 * Otros exit codes (2+ = error real de grep, ENOENT del binario) los
 * loggeamos como warn y degradamos a "not found" — fail-loud: si el grep
 * está roto preferimos marcar el componente como faltante (warn) en lugar
 * de pasarlo silenciosamente.
 */
async function grepComponent(
  searchRoot: string,
  componentName: string,
): Promise<{ matchedPaths: string[]; error: string | null }> {
  const pattern = buildComponentRegex(componentName);
  // Args para `grep -r -E -l --include=...`:
  //   -r  recursive
  //   -E  extended regex (necesario para `|` alternancia sin escape)
  //   -l  list files only
  //   --include limita por extensión (case-sensitive en BSD grep)
  //   --exclude-dir omite node_modules, .git, dist, build, .next
  // El pattern lo pasamos como ARG explícito vía `-e PATTERN` — evita que
  // una flag accidental en `componentName` se interprete como flag de grep.
  const args = [
    '-r',
    '-E',
    '-l',
    '--include=*.ts',
    '--include=*.tsx',
    '--include=*.js',
    '--include=*.jsx',
    '--exclude-dir=node_modules',
    '--exclude-dir=.git',
    '--exclude-dir=dist',
    '--exclude-dir=build',
    '--exclude-dir=.next',
    '--exclude-dir=coverage',
    '-e',
    pattern,
    searchRoot,
  ];
  try {
    const result = await execFileAsync('grep', args, {
      timeout: GREP_TIMEOUT_MS,
      maxBuffer: GREP_MAX_BUFFER,
    });
    const paths = result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 5);
    return { matchedPaths: paths, error: null };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };
    // exit code 1 = grep no encontró matches. Es el caso normal de
    // "componente faltante" — no es error.
    if (typeof e.code === 'number' && e.code === 1) {
      return { matchedPaths: [], error: null };
    }
    // exit code 2 = error real (regex inválido, archivo inaccesible).
    // ENOENT = grep no instalado (extremadamente raro pero posible).
    // Timeout = repo gigantesco. En todos los casos degradamos a
    // "not found" + error string para forensics.
    const errorMsg =
      e.code === 'ENOENT'
        ? 'binario `grep` no encontrado en el environment del worker'
        : e.killed
          ? `grep excedió timeout de ${GREP_TIMEOUT_MS / 1000}s`
          : `grep exit code ${e.code ?? 'unknown'}${e.stderr ? `: ${e.stderr.slice(0, 200)}` : ''}`;
    return { matchedPaths: [], error: errorMsg };
  }
}

/**
 * Aplana los `componentManifests` del claim a una lista única de
 * componentes a verificar, deduplicando por `name`. Razón de la dedupe:
 * múltiples diseños de la misma épica pueden referenciar al mismo
 * componente (e.g. `TopBar` aparece en `desktop-design` y `mobile-design`);
 * grepear dos veces es desperdicio y produce verdicts duplicados.
 *
 * El "componente representativo" cuando hay duplicados es el primero que
 * aparece — coherente con el orden de extracción del backend.
 */
export function flattenManifests(
  manifests: ComponentManifest[] | undefined,
): DesignManifestComponent[] {
  if (!manifests || manifests.length === 0) return [];
  const seen = new Set<string>();
  const out: DesignManifestComponent[] = [];
  for (const m of manifests) {
    for (const c of m.components) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
  }
  return out;
}

/**
 * Entry point del check. Evalúa cobertura de componentes contra el código
 * del workdir y retorna el verdict.
 *
 * Estructura del log estructurado emitido:
 *   - `dod.design_coverage.start` (1x): kickoff con count de componentes.
 *   - `dod.design_coverage.component_found` (N veces): cada componente
 *      encontrado, con los paths que matchearon (cap 5).
 *   - `dod.design_coverage.component_missing` (M veces): cada componente
 *      faltante, sin paths.
 *   - `dod.design_coverage.done` (1x): resumen con found/missing counts +
 *      decisión final (passed/failed).
 *
 * El caller (dod-verifier.ts) traduce este resultado a un `CriterionVerdict`
 * con el shape esperado por el pipeline (criterionId, label, kind, etc.)
 * y lo redacta antes del egress al backend (consistente con los demás
 * verdicts del verifier).
 */
export async function runDesignCoverageCheck(
  workdir: string,
  componentManifests: ComponentManifest[] | undefined,
): Promise<DesignCoverageResult> {
  const components = flattenManifests(componentManifests);
  if (components.length === 0) {
    logger.info(
      {
        event: 'dod.design_coverage.skip',
        reason:
          componentManifests && componentManifests.length > 0
            ? 'manifest sin componentes parseables'
            : 'sin manifests en el claim (épica backend-only o backend viejo)',
        manifestCount: componentManifests?.length ?? 0,
      },
      'design-coverage-check skipped — no hay componentes que verificar',
    );
    return {
      status: 'skipped',
      reason:
        componentManifests && componentManifests.length > 0
          ? 'Los manifests del diseño no listan componentes parseables.'
          : 'La épica no tiene componentManifests en el claim (backend-only o backend desactualizado).',
      perComponent: [],
    };
  }

  logger.info(
    {
      event: 'dod.design_coverage.start',
      componentCount: components.length,
      manifestCount: componentManifests?.length ?? 0,
    },
    `design-coverage-check: evaluando ${components.length} componente(s) del manifest`,
  );

  const searchRoot = await resolveSearchRoot(workdir);
  const perComponent: ComponentCoverageVerdict[] = [];
  for (const component of components) {
    const { matchedPaths, error } = await grepComponent(searchRoot, component.name);
    const found = matchedPaths.length > 0;
    perComponent.push({ component, found, matchedPaths });

    if (found) {
      logger.info(
        {
          event: 'dod.design_coverage.component_found',
          name: component.name,
          kind: component.kind,
          matchedPaths,
        },
        `[design-coverage] ${component.name} (${component.kind}) → found in ${matchedPaths.length} file(s)`,
      );
    } else {
      logger.warn(
        {
          event: 'dod.design_coverage.component_missing',
          name: component.name,
          kind: component.kind,
          designFilePath: component.filePath,
          grepError: error,
        },
        `[design-coverage] ${component.name} (${component.kind}) → NOT FOUND in workdir${error ? ` (grep error: ${error})` : ''}`,
      );
    }
  }

  const missingComponents = perComponent
    .filter((v) => !v.found)
    .map((v) => v.component.name);
  const foundCount = perComponent.length - missingComponents.length;

  const payload = {
    event: 'dod.design_coverage.done',
    componentCount: components.length,
    found: foundCount,
    missing: missingComponents.length,
    missingNames: missingComponents,
    decision: missingComponents.length === 0 ? 'passed' : 'failed',
  };
  const summary = `design-coverage-check done: ${foundCount}/${components.length} found${missingComponents.length > 0 ? ` (missing: ${missingComponents.join(', ')})` : ''}`;
  if (missingComponents.length > 0) {
    logger.warn(payload, summary);
  } else {
    logger.info(payload, summary);
  }

  if (missingComponents.length === 0) {
    return {
      status: 'passed',
      reason: `Todos los componentes del manifest están implementados (${foundCount}/${components.length}).`,
      perComponent,
    };
  }
  return {
    status: 'failed',
    reason: `Componentes del manifest sin implementar: ${missingComponents.join(', ')}`,
    perComponent,
  };
}
