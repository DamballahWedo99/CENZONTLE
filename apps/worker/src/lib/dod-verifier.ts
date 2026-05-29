import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type {
  ComponentManifest,
  CriterionVerdict,
  DodCanonicalKind,
  ExternalSecretForWorker,
} from '@cenzontle/shared';
import { logger } from './logger.js';
import {
  runVerifierAgentWithRetry,
  runVerifierAgentBatchWithRetry,
  runCodeSecurityReview,
  type BatchCriterionInput,
  type VerifierAgentVerdict,
} from './dod-verifier-agent.js';
import { runDesignCoverageCheck } from './design-coverage-check.js';

/**
 * Batch mode toggle. ON por default tras OPTIMIZATION #1 (Anthropic harness
 * engineering): procesar N criterios en 1 sesión de claude reduce wall-clock
 * 60-80% para grupos de 3+. Para regresar al modo legacy (single-call per
 * criterio), export `DOD_VERIFIER_BATCH=0` antes de start del worker.
 *
 * Trade-off documentado: si el batch crash-ea, perdemos todos los verdicts.
 * Mitigation: `runVerifierAgentBatch` retorna verdicts failed con
 * verifierError específico para cada criterio si la sesión falla, así el
 * caller siempre tiene N verdicts en el output (no excepciones).
 */
const VERIFIER_BATCH_ENABLED = (process.env.DOD_VERIFIER_BATCH ?? '1') === '1';
import { preflightTestCase } from './qa-preflight.js';
import { preflightTechnicalRequirement } from './tl-preflight.js';
import { buildSecretEnv, makeRedactor } from './secrets.js';

// Re-export para callers internos del worker que importaban desde aquí.
// El tipo canónico vive en `@cenzontle/shared` desde 2026-05-11
// (architecture-reviewer: contrato cruzado worker→backend→frontend).
export type { CriterionVerdict } from '@cenzontle/shared';

const execFileAsync = promisify(execFile);

/**
 * Tier 1 Harness — verificación determinística externa del DoD.
 *
 * Implementa el patrón "computational controls" (Martin Fowler) +
 * "structural completion gate" (Anthropic): el agente NO decide si cumplió
 * un criterio; el worker corre subprocess separado y captura exit code +
 * output literal, que después alimenta el retry-prompt si falla.
 *
 * Mapeo `kind` → command es estático y vive acá (no en DB) porque depende
 * del environment del worker (qué tooling instalado), no de qué dice el
 * dashboard. Si el repo no tiene la tool, el criterio se marca `skipped`
 * con razón visible en UI — no es failure.
 *
 * Criterios SIN mapeo determinístico (acceptance-criteria, docs-updated,
 * custom kind=null) caen al self-report del agente en
 * `.cenzontle-criteria.json` — Tier 1 los considera "trust agent".
 * Tier 2 (post-MVP) introducirá verifier agent para estos.
 */

// `CriterionVerdict` ahora vive en `@cenzontle/shared` (ver import arriba) —
// el shape canónico es compartido entre worker (productor), backend (Json
// column) y frontend (consumidor de `run.dodVerification`).

const VERIFIER_TIMEOUT_MS = 5 * 60 * 1000; // 5 min por command — cubre tests grandes
const MAX_OUTPUT_BYTES = 2000; // Output truncado para no inflar prompts/DB

/**
 * Prefijo del `reason` cuando un verdict `skipped` viene de un FALLO DE INFRA
 * del verifier (no de un skip legítimo "no aplica"). `emitVerifierSummary` lo
 * usa para contar `verifierErrors` por separado. CRÍTICO: este mismo prefijo se
 * usa al CONSTRUIR el reason en callVerifierAgent[Batch] — si divergen, el
 * conteo queda en 0 silenciosamente (qa/arch review 2026-05-28). Una sola
 * constante ata construcción y detección.
 */
const VERIFIER_INFRA_ERROR_PREFIX = 'Verifier agent error (';

/**
 * Un comando individual ejecutado por el verifier. `binary` + `args` van
 * directos a `execFile` (sin shell), preservando la defensa shell-escape
 * multi-capa.
 */
interface VerifierCommand {
  binary: string;
  args: string[];
}

/**
 * Contexto que recibe un verifier custom (`customVerify`). Le damos todo lo
 * que un check determinístico no-command puede necesitar: el workdir, la
 * identidad del criterio (kind/label) para construir el verdict, el base
 * branch para diffs contra origin/<base>, y los secrets del org para el env.
 */
interface CustomVerifyContext {
  workdir: string;
  kind: string;
  label: string;
  baseBranch: string | null;
  secrets: ExternalSecretForWorker[];
  /**
   * API key del org para spawns de claude desde un custom verifier (ej.
   * `code-security`, que spawnea el review headless). Los verifiers que no
   * spawnean claude (ej. `security-scan`) lo ignoran.
   */
  anthropicApiKey: string;
}

/**
 * Configuración del verifier para un kind canónico. Es una unión discriminada:
 *
 *  - **command-based** (`precheck`): el caso común. `precheck` valida
 *    prerrequisitos del environment (ej. existe package.json + script "test").
 *    Si retorna `{ skip }`, el criterio se skip con esa razón. Si retorna
 *    `{ commands }`, ejecuta los comandos SECUENCIALMENTE con short-circuit en
 *    el primer fail (semántica AND). Multi-command permite que `no-errors`
 *    corra `lint` Y `type-check` sin shell wrappers.
 *
 *  - **custom** (`customVerify`): para checks que NO se expresan como un
 *    subprocess con exit-code (ej. `security-scan` diferencial, que parsea
 *    JSON de dos `npm audit` y hace set-diff). `customVerify` posee el cómputo
 *    completo del verdict y devuelve un `CriterionVerdict` directo.
 */
type VerifierSpec =
  | { precheck: (workdir: string) => Promise<{ commands: VerifierCommand[] } | { skip: string }> }
  | { customVerify: (ctx: CustomVerifyContext) => Promise<CriterionVerdict> };

/**
 * Detecta si el workdir tiene un package.json + un script específico.
 * Centraliza la lógica para tests-passing y no-errors.
 */
async function hasNpmScript(workdir: string, scriptName: string): Promise<boolean> {
  try {
    const pkgRaw = await fs.readFile(join(workdir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.[scriptName] === 'string';
  } catch {
    return false;
  }
}

/**
 * Selecciona el package manager a usar. Prioriza pnpm > npm > yarn según
 * qué lockfile encuentra. Si no hay ninguno, default a npm.
 */
async function detectPackageManager(workdir: string): Promise<'pnpm' | 'npm' | 'yarn'> {
  for (const [pm, lockfile] of [
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['npm', 'package-lock.json'],
  ] as const) {
    try {
      await fs.access(join(workdir, lockfile));
      return pm;
    } catch {
      // ignore, prueba siguiente
    }
  }
  return 'npm';
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY-SCAN DIFERENCIAL — npm audit base vs HEAD, falla solo en las NUEVAS
// ═══════════════════════════════════════════════════════════════════════════
//
// `npm audit --audit-level=high` plano falla por CUALQUIER advisory high/critical
// del árbol de deps — incluidas las PREEXISTENTES que el agente no introdujo.
// Es un falso negativo: penaliza al agente por vulns que ya estaban en la base.
// Este differential audita la base (origin/<base>) y el HEAD, y falla SOLO por
// advisories que aparecen en HEAD y NO en la base.

interface NpmAuditVia {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: string;
}
interface NpmAuditVuln {
  name?: string;
  severity?: string;
  via?: Array<NpmAuditVia | string>;
}
interface NpmAuditJson {
  vulnerabilities?: Record<string, NpmAuditVuln>;
}

type AdvisoryInfo = { severity: string; title: string; module: string };

/**
 * Extrae el set de advisories high+critical de un reporte `npm audit --json`,
 * keyed por un identificador ESTABLE entre runs: el `source` numérico del
 * advisory de npm (invariante por GHSA), o la URL como fallback. Solo cuenta
 * entradas `via` que son OBJETOS — un `via` string es una referencia transitiva
 * a otro paquete vulnerable, no un advisory primario (lo contaríamos doble).
 */
function extractHighCriticalAdvisories(audit: NpmAuditJson): Map<string, AdvisoryInfo> {
  const out = new Map<string, AdvisoryInfo>();
  for (const [pkgName, vuln] of Object.entries(audit.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via === 'string') continue;
      const sev = (via.severity ?? '').toLowerCase();
      if (sev !== 'high' && sev !== 'critical') continue;
      const key =
        via.source != null
          ? `src:${via.source}`
          : via.url
            ? `url:${via.url}`
            : `pkg:${pkgName}:${via.title ?? ''}`;
      out.set(key, { severity: sev, title: via.title ?? '(sin título)', module: via.name ?? pkgName });
    }
  }
  return out;
}

/**
 * Corre `npm audit --json` en `cwd` y devuelve el JSON parseado, o null si no
 * se pudo obtener un reporte parseable (npm ausente, sin lockfile, sin red al
 * advisory API, output corrupto). `npm audit` sale con exit code 1 cuando
 * ENCUENTRA vulns pero igual emite el JSON en stdout — por eso parseamos
 * `err.stdout` en el catch, no solo el happy path.
 */
async function runNpmAuditJson(
  cwd: string,
  secrets: ExternalSecretForWorker[],
): Promise<NpmAuditJson | null> {
  const tryParse = (s: string | undefined): NpmAuditJson | null => {
    if (!s) return null;
    try {
      return JSON.parse(s) as NpmAuditJson;
    } catch {
      return null;
    }
  };
  const opts = {
    cwd,
    env: {
      ...buildSecretEnv(secrets),
      HOME: process.env.HOME ?? '',
      PATH: process.env.PATH ?? '',
      USER: process.env.USER ?? '',
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      CI: '1',
    },
    timeout: VERIFIER_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  };
  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--json'], opts);
    return tryParse(stdout);
  } catch (err) {
    // exit code 1 (vulns encontradas) → JSON en err.stdout. ENOENT/timeout → null.
    const e = err as { stdout?: string };
    return tryParse(e.stdout);
  }
}

/**
 * `git show <ref>` read-only contra el workdir. Devuelve el contenido del
 * archivo en ese ref, o null si no existe (ej. la base no tenía lockfile).
 * NO toca el working tree del agente.
 */
async function gitShow(workdir: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['show', ref], {
      cwd: workdir,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Security-scan diferencial. Compara los advisories high/critical de la base
 * (origin/<base>) contra el HEAD del workdir y falla SOLO por los nuevos.
 *
 * Estados:
 *  - skip: sin package-lock.json, sin base branch, o audit no parseable (infra).
 *    Skip escala a Layer 3 — nunca cuenta como fallo del agente.
 *  - passed: 0 advisories nuevos (las preexistentes de la base se ignoran).
 *  - failed: ≥1 advisory high/critical introducido por este branch.
 */
async function runSecurityScanDifferential(ctx: CustomVerifyContext): Promise<CriterionVerdict> {
  const baseVerdict = {
    criterionId: ctx.kind,
    label: ctx.label,
    kind: ctx.kind,
    command: `npm audit --json (diferencial origin/${ctx.baseBranch ?? '?'} vs HEAD)`,
    exitCode: null as number | null,
  };

  // Observabilidad: una sola forma de evento (`dod.security_scan.differential`)
  // emitida antes de cada return. WARN para failed/infra-skip (accionable),
  // INFO para passed/skip-normal. En prod permite alertar sobre vulns nuevas y
  // sobre degradación de infra (audit no parseable); en debug confirma que el
  // diferencial corrió y con qué conteos (head/base/new/preexisting).
  const emitLog = (outcome: string, fields: Record<string, unknown> = {}) => {
    const payload = { event: 'dod.security_scan.differential', outcome, baseBranch: ctx.baseBranch, ...fields };
    if (outcome === 'failed' || outcome.startsWith('skip.infra')) {
      logger.warn(payload, `[security-scan.diff] ${outcome}`);
    } else {
      logger.info(payload, `[security-scan.diff] ${outcome}`);
    }
  };

  // Precheck: npm necesita package-lock.json. Sin lockfile (pnpm/yarn, o repo
  // sin deps), skip → escalará a Layer 3.
  try {
    await fs.access(join(ctx.workdir, 'package-lock.json'));
  } catch {
    emitLog('skip.no_lockfile');
    return {
      ...baseVerdict,
      command: null,
      output: null,
      status: 'skipped',
      reason: 'El repo no tiene package-lock.json (npm). Security scan diferencial no aplica.',
    };
  }

  // 1. Audit del HEAD (workdir tras el commit del agente).
  const headAudit = await runNpmAuditJson(ctx.workdir, ctx.secrets);
  if (!headAudit) {
    emitLog('skip.infra.head_audit_unparseable');
    return {
      ...baseVerdict,
      output: null,
      status: 'skipped',
      reason:
        'No se pudo obtener `npm audit --json` del HEAD (npm ausente, sin red al advisory API, o output no parseable). No contado como fallo.',
    };
  }
  const headAdv = extractHighCriticalAdvisories(headAudit);

  // 2. Sin base branch no hay con qué diferenciar → skip. Fallar por absolutos
  //    reintroduciría el falso negativo que este differential existe para evitar.
  if (!ctx.baseBranch) {
    emitLog('skip.no_base_branch', { headCount: headAdv.size });
    return {
      ...baseVerdict,
      output: null,
      status: 'skipped',
      reason: 'No hay base branch para diferenciar advisories. Security scan diferencial omitido.',
    };
  }

  // 3. Audit de la base: materializamos package.json + package-lock.json de
  //    origin/<base> en un tempdir y corremos npm audit ahí (trabaja sobre el
  //    lockfile, no necesita node_modules). git show es read-only — no tocamos
  //    el working tree del agente.
  let baseAdv = new Map<string, AdvisoryInfo>();
  let baseAuditFailed = false;
  const tmp = await fs.mkdtemp(join(tmpdir(), 'cenzontle-audit-base-'));
  try {
    const basePkg = await gitShow(ctx.workdir, `origin/${ctx.baseBranch}:package.json`);
    const baseLock = await gitShow(ctx.workdir, `origin/${ctx.baseBranch}:package-lock.json`);
    if (basePkg !== null && baseLock !== null) {
      await fs.writeFile(join(tmp, 'package.json'), basePkg);
      await fs.writeFile(join(tmp, 'package-lock.json'), baseLock);
      const baseAudit = await runNpmAuditJson(tmp, ctx.secrets);
      if (baseAudit) {
        baseAdv = extractHighCriticalAdvisories(baseAudit);
      } else {
        baseAuditFailed = true;
      }
    }
    // else: la base no tenía package.json/lock (este branch los introdujo).
    // baseAdv queda vacío → TODOS los advisories del HEAD cuentan como nuevos,
    // que es correcto: si el branch agregó las deps, sus vulns son suyas.
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }

  // Si el audit de la base FALLÓ (red/parse) — distinto de "base sin deps" —
  // no podemos diferenciar con confianza. Skip en vez de reportar falsos nuevos.
  if (baseAuditFailed) {
    emitLog('skip.infra.base_audit_unparseable', { headCount: headAdv.size });
    return {
      ...baseVerdict,
      output: null,
      status: 'skipped',
      reason: `No se pudo auditar la base (origin/${ctx.baseBranch}) para diferenciar. Security scan diferencial omitido (no contado como fallo).`,
    };
  }

  // 4. Diferencial: advisories en HEAD que NO están en la base.
  const newAdv = [...headAdv.entries()].filter(([k]) => !baseAdv.has(k));
  const preexisting = headAdv.size - newAdv.length;

  if (newAdv.length === 0) {
    emitLog('passed', { headCount: headAdv.size, baseCount: baseAdv.size, newCount: 0, preexisting });
    return {
      ...baseVerdict,
      output:
        headAdv.size > 0
          ? `${preexisting} advisory(s) high/critical preexistente(s) en la base — ignorados. 0 nuevos introducidos por este branch.`
          : '0 advisories high/critical.',
      status: 'passed',
      reason:
        headAdv.size > 0
          ? `Sin nuevas vulnerabilidades. ${preexisting} preexistente(s) ignorada(s) (ya estaban en origin/${ctx.baseBranch}).`
          : 'npm audit limpio (0 high/critical).',
    };
  }

  emitLog('failed', {
    headCount: headAdv.size,
    baseCount: baseAdv.size,
    newCount: newAdv.length,
    preexisting,
    newModules: newAdv.map(([, v]) => v.module).slice(0, 20),
  });

  const lines = newAdv
    .map(([, v]) => `  - [${v.severity.toUpperCase()}] ${v.module}: ${v.title}`)
    .join('\n');
  return {
    ...baseVerdict,
    output: tailBytes(
      `NUEVAS vulnerabilidades introducidas por este branch (${newAdv.length}):\n${lines}` +
        (preexisting > 0 ? `\n\n(${preexisting} preexistente(s) de la base, ignorada(s))` : ''),
      MAX_OUTPUT_BYTES,
    ),
    status: 'failed',
    reason: `${newAdv.length} nueva(s) vulnerabilidad(es) high/critical introducida(s) por este branch (npm audit diferencial vs origin/${ctx.baseBranch}). Las preexistentes (${preexisting}) no cuentan.`,
  };
}

/**
 * Adaptador del `code-security` review (plan #4): traduce el
 * `CodeSecurityReviewResult` del agente headless al `CriterionVerdict` del
 * pipeline. Requiere base branch (sin él no hay diff que revisar → skip).
 *
 * Mapeo: failed (≥1 HIGH) bloquea; passed (0 HIGH) puede traer MEDIUMs que se
 * reportan en el output pero no fallan; skipped (review no pudo correr) no
 * cuenta como fallo (medidor≠medido). El markdown del review va al `output`
 * truncado para revisión humana en la UI.
 */
async function runCodeSecurityReviewVerdict(ctx: CustomVerifyContext): Promise<CriterionVerdict> {
  const baseVerdict = {
    criterionId: ctx.kind,
    label: ctx.label,
    kind: ctx.kind,
    command: null,
    exitCode: null,
  };

  if (!ctx.baseBranch) {
    return {
      ...baseVerdict,
      output: null,
      status: 'skipped',
      reason: 'No hay base branch para revisar (origin/<base>..HEAD). Code-security review omitido.',
    };
  }

  const result = await runCodeSecurityReview({
    workdir: ctx.workdir,
    baseBranch: ctx.baseBranch,
    anthropicApiKey: ctx.anthropicApiKey,
    externalSecrets: ctx.secrets,
  });

  // El markdown del review (con findings + recomendaciones) va al output,
  // truncado. Si está vacío, caemos al summary.
  const output =
    result.markdown.trim().length > 0
      ? tailBytes(result.markdown.trim(), MAX_OUTPUT_BYTES)
      : result.summary || null;

  if (result.status === 'skipped') {
    return {
      ...baseVerdict,
      output,
      status: 'skipped',
      reason: `Code-security review no pudo correr (${result.verifierError ?? 'desconocido'}) — no contado como fallo: ${result.summary}`,
    };
  }

  if (result.status === 'failed') {
    return {
      ...baseVerdict,
      output,
      status: 'failed',
      reason: `${result.highCount} vulnerabilidad(es) HIGH de seguridad introducida(s) por este branch (code-security review /security-review). ${result.mediumCount} MEDIUM. ${result.summary}`,
    };
  }

  // passed
  return {
    ...baseVerdict,
    output,
    status: 'passed',
    reason:
      result.mediumCount > 0
        ? `Sin vulnerabilidades HIGH. ${result.mediumCount} MEDIUM reportada(s) (no bloqueante). ${result.summary}`
        : `Sin vulnerabilidades HIGH/MEDIUM de seguridad. ${result.summary}`,
  };
}

/**
 * docs-updated DETERMINÍSTICO (reemplaza el juez Haiku semántico, que era flaky:
 * coder y verifier — ambos Haiku — juzgaban distinto el mismo caso ambiguo
 * "¿este cambio necesita docs?", 2026-05-28). Regla determinística PROPORCIONAL:
 * si el diff (origin/<base>..HEAD) tocó archivos de CÓDIGO de aplicación, exige
 * que también haya tocado un archivo de DOCS (README/CHANGELOG/AGENTS/CLAUDE,
 * `docs/**`, cualquier `*.md`, o un ADR en `docs/adr/`). Cambios solo-config o
 * solo-docs pasan sin requisito.
 *
 * Principio de harness: un gate de DoD debe ser PREDECIBLE — el agente aprende
 * "tocá un doc cuando cambies código" y pasa de forma fiable. La CALIDAD de la
 * doc la guía el prompt del coder (README proporcional + ADR para decisiones
 * significativas); este gate solo verifica PRESENCIA. Separa "el agente produce
 * (semántico, inteligente)" de "el gate verifica (determinístico)". Acepta
 * cualquier artefacto de doc → habilita el esquema escalonado (línea en README
 * para lo trivial, ADR nuevo para lo grande) sin imponer estructura rígida.
 */
async function runDocsUpdatedCheck(ctx: CustomVerifyContext): Promise<CriterionVerdict> {
  const baseVerdict = {
    criterionId: ctx.kind,
    label: ctx.label,
    kind: ctx.kind,
    command: `git diff --name-only origin/${ctx.baseBranch ?? '?'}..HEAD (docs gate determinístico)`,
    exitCode: null as number | null,
  };
  const emitLog = (outcome: string, fields: Record<string, unknown> = {}) => {
    const payload = { event: 'dod.docs_updated.check', outcome, baseBranch: ctx.baseBranch, ...fields };
    if (outcome === 'failed') logger.warn(payload, `[docs-updated] ${outcome}`);
    else logger.info(payload, `[docs-updated] ${outcome}`);
  };

  if (!ctx.baseBranch) {
    emitLog('skip.no_base_branch');
    return {
      ...baseVerdict,
      command: null,
      output: null,
      status: 'skipped',
      reason: 'No hay base branch para diferenciar el diff. docs-updated omitido.',
    };
  }

  let changed: string[];
  try {
    // Tres puntos (qa-reviewer 2026-05-28): `A...B` difea desde el ANCESTRO
    // COMÚN, así reporta solo lo que ESTA branch introdujo. Con dos puntos, si
    // origin/<base> avanzó (otra historia mergeó) mientras corría, archivos de
    // esa otra historia aparecerían en el diff y falsearían el conteo.
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', `origin/${ctx.baseBranch}...HEAD`],
      { cwd: ctx.workdir, maxBuffer: 10 * 1024 * 1024 },
    );
    changed = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    emitLog('skip.infra.diff_failed', { err: (err as Error).message.slice(0, 120) });
    return {
      ...baseVerdict,
      output: null,
      status: 'skipped',
      reason: `No se pudo obtener el diff vs origin/${ctx.baseBranch} — docs-updated omitido (no contado como fallo).`,
    };
  }

  // OJO (qa-reviewer 2026-05-28): el 4to clause restringe la EXTENSIÓN a docs
  // (.md/.mdx/.txt/.rst o sin extensión). Sin esa restricción, un archivo de
  // CÓDIGO como `src/claude.ts` o `lib/changelog.ts` matchearía por basename →
  // se contaría como doc (falso negativo: código sin docs pasaría). Los .md ya
  // los cubre el 1er clause; el 4to es solo para README/CHANGELOG sin ext o .txt.
  const isDoc = (f: string): boolean =>
    /\.mdx?$/i.test(f) ||
    f.startsWith('docs/') ||
    f.includes('/docs/') ||
    /(^|\/)(README|CHANGELOG|CONTRIBUTING|AGENTS|CLAUDE)(\.(md|mdx|txt|rst))?$/i.test(f);
  // Código de APLICACIÓN (no docs). Config/lockfiles (package.json, *.lock) NO
  // cuentan como código → un bump de deps no exige docs.
  const CODE_EXT =
    /\.(tsx?|jsx?|mjs|cjs|cts|mts|vue|svelte|astro|py|go|rs|rb|php|java|kt|swift|c|cc|cpp|h|hpp|cs|css|scss|sass|less|html?)$/i;
  const isCode = (f: string): boolean => CODE_EXT.test(f) && !isDoc(f);

  const codeChanged = changed.filter(isCode);
  const docChanged = changed.filter(isDoc);

  if (codeChanged.length === 0) {
    emitLog('passed.no_code', { changedCount: changed.length });
    return {
      ...baseVerdict,
      output: null,
      status: 'passed',
      reason: 'El cambio no toca código de aplicación (solo config/otros) — no requiere actualización de docs.',
    };
  }
  if (docChanged.length > 0) {
    emitLog('passed', { codeChanged: codeChanged.length, docChanged: docChanged.length });
    return {
      ...baseVerdict,
      output: `Docs actualizados: ${docChanged.slice(0, 10).join(', ')}`,
      status: 'passed',
      reason: `Tocaste ${codeChanged.length} archivo(s) de código y ${docChanged.length} de docs — OK.`,
    };
  }
  emitLog('failed', { codeChanged: codeChanged.length, docChanged: 0, sampleCode: codeChanged.slice(0, 8) });
  return {
    ...baseVerdict,
    output: tailBytes(
      `Código cambiado SIN docs (${codeChanged.length} archivo(s)):\n${codeChanged.slice(0, 15).map((f) => `  - ${f}`).join('\n')}`,
      MAX_OUTPUT_BYTES,
    ),
    status: 'failed',
    reason:
      `Cambiaste ${codeChanged.length} archivo(s) de código pero NO actualizaste ninguna doc. ` +
      `Actualizá el README (qué hace / cómo correr / estructura). Para una decisión arquitectónica significativa, agregá un ADR en docs/adr/NNNN-titulo.md.`,
  };
}

// `Partial<Record<DodCanonicalKind, ...>>` (no `Record<string, ...>`): las keys
// deben ser kinds canónicos de `@cenzontle/shared` — un typo o un kind que el
// backend renombró sin actualizar acá es un ERROR de compilación, no un drift
// silencioso a Layer 3 (architecture-reviewer 2026-05-28). `Partial` porque no
// todos los kinds tienen spec Layer 1 (acceptance-criteria, technical-design,
// pr-created se manejan aparte/semánticos).
const VERIFIERS: Partial<Record<DodCanonicalKind, VerifierSpec>> = {
  /**
   * code-written: el agente debe haber producido cambios. Verificación
   * más simple posible — `git status --porcelain` debe traer al menos
   * una línea (hay archivos modified/added/deleted). Si está vacío, fail.
   *
   * Nota: usamos `status --porcelain` en vez de `diff` porque el worker
   * NO ha hecho commit todavía (el commit lo hace el worker después de
   * que el agente termina). status reporta working-tree changes sin
   * importar staging.
   */
  'code-written': {
    precheck: async () => ({
      commands: [{ binary: 'git', args: ['status', '--porcelain'] }],
    }),
  },

  /**
   * tests-passing: corre el script `test` del package.json si existe.
   * Si no hay script, skip (no podemos verificar lo que el repo no
   * configuró — no es failure del agente).
   */
  'tests-passing': {
    precheck: async (workdir) => {
      const has = await hasNpmScript(workdir, 'test');
      if (!has) return { skip: 'El repo no tiene script "test" en package.json. No se puede verificar determinísticamente.' };
      const pm = await detectPackageManager(workdir);
      // `npm run test` funciona en npm/pnpm/yarn. `npm test` también funciona
      // porque es uno de los 4 shortcuts builtin de npm (start/test/restart/stop),
      // pero usar `run` lo hace universal y consistente con `no-errors` abajo.
      return { commands: [{ binary: pm, args: ['run', 'test'] }] };
    },
  },

  /**
   * no-errors: combina `lint` Y `type-check`. Si AMBOS scripts existen,
   * corremos ambos secuencial (semántica AND — primer fallo decide).
   * Si solo uno existe, corre ese. Si ninguno existe, skip.
   *
   * Implementación post-fix BUG-04: el shape multi-command de VerifierSpec
   * permite ejecutar lint Y type-check sin recurrir a shell wrappers. Antes
   * usábamos solo `lint` si estaba presente y dejábamos type-check silenciado
   * — un lint que pasaba ocultaba type errors reales.
   */
  'no-errors': {
    precheck: async (workdir) => {
      const hasLint = await hasNpmScript(workdir, 'lint');
      const typeCheckScript: 'type-check' | 'typecheck' | null = (await hasNpmScript(
        workdir,
        'type-check',
      ))
        ? 'type-check'
        : (await hasNpmScript(workdir, 'typecheck'))
          ? 'typecheck'
          : null;
      if (!hasLint && !typeCheckScript) {
        return { skip: 'El repo no tiene scripts "lint" ni "type-check" en package.json.' };
      }
      const pm = await detectPackageManager(workdir);
      // CRÍTICO usar `run` (2026-05-11): npm SOLO tiene shortcuts builtin para
      // start/test/restart/stop. Para CUALQUIER otro script (lint, type-check,
      // typecheck, etc.), `npm <script>` es error porque npm interpreta el
      // primer arg como subcomando inexistente — exit code 1, sin output útil.
      // `npm run <script>` funciona universal (npm/pnpm/yarn) y es la forma
      // segura sin importar el script name.
      const commands: VerifierCommand[] = [];
      if (hasLint) commands.push({ binary: pm, args: ['run', 'lint'] });
      if (typeCheckScript) commands.push({ binary: pm, args: ['run', typeCheckScript] });
      return { commands };
    },
  },

  /**
   * security-scan: DIFERENCIAL. Audita origin/<base> vs HEAD con `npm audit
   * --json` y falla SOLO por advisories high/critical que este branch
   * introdujo — las preexistentes de la base no penalizan al agente. Ver
   * `runSecurityScanDifferential`. Skip si no hay package-lock.json, base
   * branch, o red al advisory API (no cuenta como fallo).
   */
  'security-scan': {
    customVerify: (ctx) => runSecurityScanDifferential(ctx),
  },

  /**
   * code-security: revisión de seguridad profunda con el prompt pixel-perfect
   * de `/security-review` (Sonnet headless contra origin/<base>..HEAD). Falla
   * solo por findings HIGH (directamente explotables); MEDIUM se reportan pero
   * no bloquean. Skip si no hay base branch o el review no pudo correr
   * (timeout/spawn/parse). Ver `runCodeSecurityReviewVerdict`.
   */
  'code-security': {
    customVerify: (ctx) => runCodeSecurityReviewVerdict(ctx),
  },

  /**
   * docs-updated: DETERMINÍSTICO (ya no juez Haiku semántico — ver
   * `runDocsUpdatedCheck`). Si el diff tocó código de app, exige que también
   * tocó un doc (README/docs/**​/*.md/ADR). Predecible, nunca flaky.
   */
  'docs-updated': {
    customVerify: (ctx) => runDocsUpdatedCheck(ctx),
  },

  // pr-created: NO se verifica acá — lo hace el worker después de la
  // verificación determinística (si todos los demás pasan, hace push + PR).
  // Si lo dejamos en VERIFIERS sería loop circular.

  // acceptance-criteria, docs-updated: NO determinísticos. Caen al
  // trust agent self-report (Tier 2 introducirá verifier agent).
};

/**
 * Reporte del agente para un criterio individual. SOLO para visibility en
 * UI — no es autoritative. El verdict pass/fail del DoD lo decide el
 * verifier agent (Layer 3) + checks determinísticos (Layer 1), nunca el
 * self-report del generator.
 */
/**
 * Trunca output a las últimas N bytes, manteniendo el final (donde típicamente
 * está el error). Importante: el agente en retry necesita ver el final del
 * output del comando que falló, no el principio.
 */
function tailBytes(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return '... (truncated) ...\n' + text.slice(-maxBytes);
}

/**
 * Ejecuta UN verifier. Retorna verdict con exit code, output truncado y status.
 * Maneja timeouts, prerrequisitos faltantes (skip), y errores de spawn (fail
 * con razón legible).
 */
async function runVerifier(
  workdir: string,
  kind: string,
  label: string,
  spec: VerifierSpec,
  secrets: ExternalSecretForWorker[],
  baseBranch: string | null,
  anthropicApiKey: string,
): Promise<CriterionVerdict> {
  // Verifier custom (ej. security-scan diferencial, code-security review):
  // posee su propio cómputo de verdict — no pasa por el pipeline command-based.
  if ('customVerify' in spec) {
    return spec.customVerify({ workdir, kind, label, baseBranch, secrets, anthropicApiKey });
  }

  const config = await spec.precheck(workdir);
  if ('skip' in config) {
    return {
      criterionId: kind,
      label,
      kind,
      command: null,
      exitCode: null,
      output: null,
      status: 'skipped',
      reason: config.skip,
    };
  }

  // Itera commands secuencialmente con short-circuit on fail (semántica AND).
  // Caso típico: no-errors corre [lint, type-check]. Si lint falla, no
  // corremos type-check (el agente debe arreglar lint primero). Si lint pasa,
  // type-check decide. Output combinado preserva traza de los commands
  // exitosos previos para que el retry-prompt sepa qué pasó vs qué falló.
  const cmdStrings: string[] = [];
  const passedOutputs: string[] = [];
  for (let i = 0; i < config.commands.length; i++) {
    const cmd = config.commands[i];
    const cmdString = `${cmd.binary} ${cmd.args.join(' ')}`;
    cmdStrings.push(cmdString);
    try {
      const result = await execFileAsync(cmd.binary, cmd.args, {
        cwd: workdir,
        env: {
          // Secretos externos del org PRIMERO — las env vars fijas van
          // después para pisarlas siempre (defensa final). Da a los comandos
          // del verifier (`pnpm test`/`lint`/etc.) acceso al servicio
          // externo de la historia.
          ...buildSecretEnv(secrets),
          HOME: process.env.HOME ?? '',
          PATH: process.env.PATH ?? '',
          USER: process.env.USER ?? '',
          LANG: process.env.LANG ?? 'en_US.UTF-8',
          // CI=1 desactiva watchers/spinners en muchas tools (jest, vitest, etc.)
          CI: '1',
        },
        timeout: VERIFIER_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB headroom; truncamos a 2KB para reporte
      });
      const combined = (result.stdout + result.stderr).trim();
      if (combined) {
        passedOutputs.push(`[${cmdString}]\n${combined}`);
      }
      // Si NO es el último command, continuamos al siguiente. Si SÍ es el
      // último, caemos fuera del loop y retornamos `passed` con el output
      // combinado de todos los commands exitosos.
    } catch (err) {
      // execFileAsync rechaza con error que tiene `code` (exit code), `stdout`,
      // `stderr`, `killed`, `signal`. Tipo Node.js standard.
      const e = err as NodeJS.ErrnoException & {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        signal?: string;
      };
      // Si el binario no existe (ENOENT), reportamos skip con razón clara
      // — el repo o environment no tiene la tool, no es failure del agente.
      // Aplica al PRIMER command que falla con ENOENT; los siguientes ni se
      // intentan (short-circuit).
      if (e.code === 'ENOENT') {
        return {
          criterionId: kind,
          label,
          kind,
          command: cmdStrings.join(' && '),
          exitCode: null,
          output: null,
          status: 'skipped',
          reason: `Binario "${cmd.binary}" no encontrado en el environment del worker.`,
        };
      }
      // Timeout — el comando excedió VERIFIER_TIMEOUT_MS.
      if (e.killed || e.signal === 'SIGTERM') {
        return {
          criterionId: kind,
          label,
          kind,
          command: cmdStrings.join(' && '),
          exitCode: null,
          output: tailBytes(((e.stdout ?? '') + (e.stderr ?? '')).trim(), MAX_OUTPUT_BYTES),
          status: 'failed',
          reason: `Comando "${cmdString}" excedió timeout de ${VERIFIER_TIMEOUT_MS / 1000}s`,
        };
      }
      // Fail normal: exit code distinto de 0. Capturamos output del command
      // que falló (no el de los exitosos previos — el agente necesita ver
      // el error específico que tiene que arreglar).
      const exitCode = typeof e.code === 'number' ? e.code : -1;
      const combined = ((e.stdout ?? '') + (e.stderr ?? '')).trim();
      const stepInfo =
        config.commands.length > 1
          ? ` (paso ${i + 1}/${config.commands.length}: "${cmdString}")`
          : '';
      return {
        criterionId: kind,
        label,
        kind,
        command: cmdStrings.join(' && '),
        exitCode,
        output: tailBytes(combined, MAX_OUTPUT_BYTES),
        status: 'failed',
        reason: `Comando exit code ${exitCode}${stepInfo}`,
      };
    }
  }

  // Todos los commands pasaron — verdict final 'passed'.
  const combinedOutput = passedOutputs.length > 0 ? passedOutputs.join('\n\n') : '';
  return {
    criterionId: kind,
    label,
    kind,
    command: cmdStrings.join(' && '),
    exitCode: 0,
    output: tailBytes(combinedOutput, MAX_OUTPUT_BYTES),
    status: 'passed',
  };
}

/**
 * Verifica TODOS los criterios del DoD para un workdir dado. Arquitectura
 * de capas siguiendo recomendaciones del research (Anthropic, DoneSpec,
 * Multi-Gate Quality Systems):
 *
 *   Layer 1: Deterministic checks (subprocess — git/pnpm/npm)
 *   Layer 3: Verifier Agent (claude separado con modelo distinto)
 *            — fallback cuando Layer 1 no aplica o no puede correr
 *
 * Layer 2 (Completion Contract personalizable) queda para Fase B.
 *
 * El self-report del agente generator (`.cenzontle-criteria.json`) se lee
 * SOLO para tracking visual (no autoritative). El verdict pass/fail viene
 * exclusivamente de Layer 1 o Layer 3 — nunca de auto-reporte.
 *
 * El caller (runner.ts) usa este resultado para:
 *   1. Decidir si re-spawn el agente (si hay status='failed')
 *   2. Construir retry-prompt con las failures + outputs literales
 *   3. Reportar al backend (campo dodVerification)
 */
export async function verifyDoDCriteria(
  workdir: string,
  criteria: Array<{ kind: string | null; text: string; description: string }>,
  agentContext: {
    storyTitle: string;
    /**
     * Markdown completo de la sección Producto de la story (vault). Null si
     * no estaba disponible al claim. Solo se usa para inyectar al prompt
     * del verifier Layer 3 cuando el criterio es `acceptance-criteria` —
     * permite que el verifier evalúe contra los criterios CONCRETOS de la
     * historia en vez de evaluar en abstracto (2026-05-12).
     */
    storyMarkdown: string | null;
    /**
     * Lista plana de acceptance criteria parseados del vault. Cuando el
     * verifier procesa el criterio del DoD `acceptance-criteria`, en vez
     * de hacer UNA evaluación global, hace UNA POR CADA acceptance criterion
     * de esta lista (granularidad per-criterio). Cada verdict resultante
     * usa el texto del criterio como `label`, lo que permite que el runner
     * matchee con `storyCriterion.label` y marque cada milestone individual
     * en la UI (2026-05-13). Array vacío → fallback a evaluación global.
     */
    acceptanceCriteria: string[];
    /**
     * Casos de prueba parseados del QA markdown (## Happy path + ## Edge
     * cases). Mismo patrón per-criterion que `acceptanceCriteria` pero
     * aplicado al criterio DoD `tests-passing`: el verifier evalúa cada
     * caso individualmente — para cada uno (a) hace grep determinístico
     * en archivos de tests del repo para detectar ausencia, (b) si
     * encuentra candidato, valida con Sonnet que efectivamente cubre el
     * caso (no es trivial/vacío), (c) corre el test runner del repo y
     * exige que pase. Array vacío → fallback a evaluación global legacy
     * ("¿pasa pnpm test?" sin saber qué tests deberían existir).
     */
    qaTestCases: Array<{ category: 'happy' | 'edge'; description: string }>;
    /**
     * Requerimientos técnicos parseados del TL markdown (`## Checklist`,
     * `## Contrato`, `## Validaciones`, `## Manejo de errores`). El
     * verifier los procesa para el criterio DoD `technical-design`: por
     * cada item ejecuta (a) pre-flight determinístico (grep identifiers
     * del item en archivos source del repo); (b) si pre-flight pasa, LLM
     * judge valida implementación semántica. Array vacío → fallback a
     * evaluación global del criterio sin per-item granularity.
     */
    technicalRequirements: Array<{
      category: 'checklist' | 'contract' | 'validation' | 'errors';
      description: string;
    }>;
    branch: string;
    /**
     * Base branch del repo (origin/<base>) contra el que el security-scan
     * diferencial compara advisories. `null` si el run no tiene repo remoto
     * (local-only) — ahí el differential skipea. Lo provee el runner desde
     * el claim (`ClaimedStory.baseBranch`).
     */
    baseBranch: string | null;
    anthropicApiKey: string;
    /**
     * Modelo + effort del verifier (configurados en /factory/settings →
     * Factory → DoD Verifier). Cuando vienen del claim, override las env
     * vars DOD_VERIFIER_MODEL/EFFORT. Si NO vienen (caller legacy o claim
     * sin el campo), el dod-verifier-agent.ts cae a env como antes.
     */
    dodVerifierModel?: string;
    dodVerifierEffort?: string;
    /**
     * Secretos externos del org (Stripe/Twilio/Amadeus/…). Se inyectan en
     * el `env` de los comandos del verifier Layer 1 (`pnpm test`/`lint`) y
     * en el `env` de los spawns del verifier agent Layer 3 — NUNCA en
     * ningún prompt. Paridad con el coder: los tests del repo pueden tocar
     * el servicio externo. Array vacío si la org no tiene secrets.
     *
     * PRECONDICIÓN: deben venir ya saneados por `sanitizeExternalSecrets`
     * (el runner lo hace una vez, antes de armar este contexto). Este módulo
     * NO vuelve a sanear — solo redacta el output e inyecta el env.
     */
    externalSecrets: ExternalSecretForWorker[];
    /**
     * Manifests de componentes UX/UI extraídos del bundle de diseño de la
     * épica (lo emite Stream A: `design-bundle.service` y se forwardea en
     * `ClaimedStory.componentManifests`). Lo usa el Layer 1 check
     * `design-coverage-check` para verificar que cada componente del
     * manifest tiene una implementación en `${workdir}/src` tras el run
     * del coder.
     *
     * `undefined` (o array vacío) → el check skipea sin fail. Aplica a:
     *   - épicas backend-only (sin diseño UI).
     *   - claims de un backend desactualizado que aún no extrae manifests.
     */
    componentManifests?: ComponentManifest[];
  },
  /**
   * Callback opcional para UX progressive (2026-05-11). El verifier lo
   * invoca DESPUÉS de cada verdict.push — el caller (runner.ts) lo usa
   * para postear `dodVerification` parcial al backend y que la UI muestre
   * checkmarks incrementales (1/N, 2/N, ...) en lugar del salto 0/N → N/N
   * al final.
   *
   * Recibe el array ACUMULADO de verdicts (no incremental delta) — match
   * exact con el shape persistido en `/complete`. Errores en el callback
   * se loguean pero NO interrumpen la verificación: el progreso al backend
   * es nice-to-have, el verdict autoritativo es la respuesta de esta función.
   */
  onProgress?: (verdicts: CriterionVerdict[]) => void | Promise<void>,
): Promise<CriterionVerdict[]> {
  // Agent self-report eliminado 2026-05-13 (era sycophancy: el generator
  // se auto-evaluaba). El verifier independiente Sonnet es la única fuente
  // de verdict para criterios semánticos. Para granularidad sub-story, el
  // criterio `acceptance-criteria` se evalúa per-criterio (loop abajo).
  const verdicts: CriterionVerdict[] = [];

  // Redacción de los verdicts antes de que SALGAN de esta función. El
  // `output`/`reason`/`command` de un verdict puede contener el valor de un
  // secreto externo: el verifier Layer 1 corre `pnpm test`/`lint` con los
  // secretos en el env y captura su stdout crudo en `output`; el verifier
  // agent Layer 3 puede echar un secreto en su reasoning y eso queda en
  // `reason`. Sin esto, esos valores llegan crudos a `agent_runs.dodVerification`
  // (DB), al iframe de la UI y al retry-prompt del coder. Redactamos en los
  // DOS puntos de salida — `fireProgress` y el `return` — así cubrimos todo
  // verdict sin importar cuál de los múltiples push-sites lo generó
  // (security-reviewer BLOCK 2026-05-21).
  const redactVerdictText = makeRedactor(
    agentContext.externalSecrets.map((s) => s.value),
  );
  const redactVerdict = (v: CriterionVerdict): CriterionVerdict => ({
    ...v,
    command: v.command ? redactVerdictText(v.command) : v.command,
    output: v.output ? redactVerdictText(v.output) : v.output,
    reason: v.reason ? redactVerdictText(v.reason) : v.reason,
  });

  // Helper local: dispara onProgress de forma segura. Un fallo del POST
  // al backend (red, 5xx) NO debe romper la verificación — solo loggear.
  //
  // Pasamos un SNAPSHOT del array (`[...verdicts]`) en lugar de la
  // referencia viva (qa-reviewer 2026-05-11). Razón: si el callback es
  // async (POST HTTP en runner.ts) y la serialización JSON del body es
  // lazy en el cliente HTTP, otra iteración del loop podría haber hecho
  // `verdicts.push(...)` antes de que el body se serialice — el backend
  // recibiría N+1 elementos cuando el intent era N. Snapshot es O(N)
  // trivial y elimina la ambigüedad sin importar la implementación del
  // HTTP client.
  const fireProgress = async () => {
    if (!onProgress) return;
    try {
      await onProgress(verdicts.map(redactVerdict));
    } catch (err) {
      logger.warn(
        { event: 'dod.verify.progress.error', err: (err as Error).message },
        'onProgress callback falló — verificación continúa',
      );
    }
  };

  for (const c of criteria) {
    // pr-created se skip explícitamente — el worker lo maneja después con push.
    if (c.kind === 'pr-created') {
      verdicts.push({
        criterionId: 'pr-created',
        label: c.text,
        kind: 'pr-created',
        command: null,
        exitCode: null,
        output: null,
        status: 'skipped',
        reason: 'Verificado por el worker después del DoD loop (push + Octokit).',
      });
      await fireProgress();
      continue;
    }

    // ────────────────────────────────────────────────────────────────────
    // design-coverage-check (Layer 1 NON-subprocess)
    // ────────────────────────────────────────────────────────────────────
    //
    // Verifica que cada componente del/los `componentManifests` del claim
    // está implementado en `${workdir}/src`. NO está en VERIFIERS porque
    // no es un subprocess único: necesita iterar componentes, grepearlos
    // uno por uno y emitir log estructurado por cada uno.
    //
    // Política WARN (consistente con `security-scan` y `docs-updated`):
    //   - Sin componentManifests → skipped.
    //   - Todos los componentes encontrados → passed.
    //   - 1+ faltante → failed (warn no bloqueante: el runner no usa
    //     `hasFailedCriteria` para abortar el push, solo para WARN logs).
    if (c.kind === 'design-coverage-check') {
      const coverage = await runDesignCoverageCheck(
        workdir,
        agentContext.componentManifests,
      );
      // Output: lista resumida de matched paths cuando passed, lista de
      // faltantes cuando failed. Truncado a MAX_OUTPUT_BYTES para no inflar
      // el prompt de retry ni el DTO del backend.
      const outputLines: string[] = [];
      for (const pc of coverage.perComponent) {
        if (pc.found) {
          outputLines.push(
            `  ✓ ${pc.component.name} (${pc.component.kind}) → ${pc.matchedPaths.slice(0, 3).join(', ')}`,
          );
        } else {
          outputLines.push(
            `  ✗ ${pc.component.name} (${pc.component.kind}) → NOT FOUND (manifest origen: ${pc.component.filePath})`,
          );
        }
      }
      const output = outputLines.length > 0
        ? `Cobertura del manifest de diseño:\n${outputLines.join('\n')}`
        : null;
      logger.info(
        {
          event: 'dod.verify.layer1',
          kind: c.kind,
          status: coverage.status,
          componentCount: coverage.perComponent.length,
          missingCount: coverage.perComponent.filter((v) => !v.found).length,
        },
        `DoD Layer 1 [${c.kind}] → ${coverage.status}`,
      );
      verdicts.push({
        criterionId: c.kind,
        label: c.text,
        kind: c.kind,
        command: null, // No es un subprocess — el comando "compuesto" se loggea per-componente.
        exitCode: null,
        output: output ? tailBytes(output, MAX_OUTPUT_BYTES) : null,
        status: coverage.status,
        reason: coverage.reason,
      });
      await fireProgress();
      continue;
    }

    // ────────────────────────────────────────────────────────────────────
    // SHORT-CIRCUIT per-test-case del QA markdown (`tests-passing`).
    // ────────────────────────────────────────────────────────────────────
    //
    // Si la story trae casos de prueba parseados del QA markdown,
    // SALTAMOS Layer 1 subprocess (`pnpm test` aggregate) y evaluamos cada
    // caso individualmente con Layer 3 per-test-case. Esto es estrictamente
    // más fuerte: per-test-case incluye correr el test runner del repo
    // AL FINAL del verifier-agent, pero ADEMÁS valida semánticamente que
    // cada caso descrito en el QA esté cubierto y no sea trivial/skipped.
    //
    // SIN este short-circuit, el bloque per-test-case que estaba dentro del
    // else "sin Layer 1 spec" nunca se alcanzaba (tests-passing SIEMPRE
    // tiene spec definido en VERIFIERS). Era código muerto — bug.
    //
    // Fallback: si la story NO tiene qaTestCases (legacy o sin
    // testing-strategy.md), seguimos al path normal Layer 1 abajo.
    if (
      c.kind === 'tests-passing' &&
      agentContext.qaTestCases.length > 0
    ) {
      logger.info(
        {
          event: 'dod.verify.layer3.per_test_case',
          kind: c.kind,
          count: agentContext.qaTestCases.length,
          happy: agentContext.qaTestCases.filter((tc) => tc.category === 'happy').length,
          edge: agentContext.qaTestCases.filter((tc) => tc.category === 'edge').length,
          batchMode: VERIFIER_BATCH_ENABLED,
        },
        `Layer 3 per-test-case: ${agentContext.qaTestCases.length} test cases del QA markdown a evaluar`,
      );

      // PASS 1: preflight todos. Split items en deterministic failures vs
      // batchable. Lo mismo que el TL loop pero con preflightTestCase.
      const qaBatchInput: Array<{
        criterionId: string;
        kind: string | null;
        text: string;
        description: string;
      }> = [];
      for (const tc of agentContext.qaTestCases) {
        const label = tc.category === 'happy'
          ? `Happy path: ${tc.description}`
          : `Edge case: ${tc.description}`;

        const preflight = await preflightTestCase(workdir, tc);
        if (!preflight.ok) {
          logger.warn(
            {
              event: 'dod.verify.layer3.preflight_failed',
              kind: c.kind,
              category: tc.category,
              preflightCategory: preflight.category,
              description: tc.description.slice(0, 80),
            },
            `Pre-flight test case failed deterministicly: ${preflight.category} (skipping Sonnet call to save tokens)`,
          );
          verdicts.push({
            // DTO backend cap criterionId @ 200 chars (MaxLength). Si label
            // (qa testcase description) excede, truncamos. Conserva la mayoría
            // de uniqueness — los duplicados acá son improbables porque cada
            // test case del seed tiene wording distinto.
            criterionId: truncate(label, 200),
            label,
            kind: c.kind,
            command: null,
            exitCode: null,
            output: preflight.candidatePaths.length > 0
              ? `Archivos candidatos examinados por pre-flight:\n${preflight.candidatePaths.map((p) => `  - ${p}`).join('\n')}`
              : null,
            status: 'failed',
            reason: preflight.reason ?? 'pre-flight failed',
            usage: undefined,
          });
          await fireProgress();
          continue;
        }

        // Pre-flight pasó → acumular para batch.
        const candidateHint = preflight.candidatePaths.length > 0
          ? ` Pre-flight encontró tests candidatos en: ${preflight.candidatePaths.map((p) => p.replace(workdir, '')).slice(0, 3).join(', ')}. Léelos primero con Read antes de explorar el resto del repo.`
          : '';
        qaBatchInput.push({
          criterionId: `qa-${qaBatchInput.length + 1}`,
          kind: c.kind,
          text: label,
          description:
            `Caso de prueba específico del QA markdown — categoría '${tc.category}'. ` +
            `Pre-flight determinístico ya validó: (a) el archivo de test existe, (b) las keywords del caso aparecen ahí, ` +
            `(c) no hay .skip/.todo/xit/disabled en ese archivo, (d) no hay assertions triviales obvias. ` +
            `Tu trabajo (Sonnet semantic check): leer el test candidato y validar que efectivamente cubre el ` +
            `comportamiento "${tc.description}" — verificar que las assertions matchean el comportamiento descrito, ` +
            `no solo que el test corre. Después corre el test runner del repo y exige que ese test específico pase. ` +
            `Emite passed=false si las assertions son inadecuadas para el caso o si el test runner reporta failure.` +
            candidateHint,
        });
      }

      // PASS 2: batch call si batch enabled y >= 2 items batchable.
      if (VERIFIER_BATCH_ENABLED && qaBatchInput.length >= 2) {
        const batchVerdicts = await callVerifierAgentBatch(
          workdir,
          qaBatchInput,
          agentContext,
        );
        verdicts.push(...batchVerdicts);
        await fireProgress();
      } else {
        for (const item of qaBatchInput) {
          const syntheticCriterion = {
            kind: item.kind,
            text: item.text,
            description: item.description,
          };
          const verdict = await callVerifierAgent(workdir, syntheticCriterion, agentContext);
          verdicts.push(verdict);
          await fireProgress();
        }
      }
      // El último iter del for-of ya disparó fireProgress(); el `continue`
      // skip el fireProgress final-de-loop-iteration (línea ~860). No
      // necesitamos otro extra — sería un POST HTTP duplicado con payload
      // idéntico (qa-reviewer WARN 2026-05-15).
      continue;
    }

    // `c.kind` es un string runtime (viene del claim/DB). El cast a
    // DodCanonicalKind es seguro: si NO es canónico, el lookup en el Partial
    // devuelve undefined → cae al path "sin spec" (Layer 3), igual que antes.
    const spec = c.kind !== null ? VERIFIERS[c.kind as DodCanonicalKind] : undefined;

    if (spec) {
      // Layer 1: Deterministic check. Corre subprocess.
      const verdict = await runVerifier(
        workdir,
        c.kind!,
        c.text,
        spec,
        agentContext.externalSecrets,
        agentContext.baseBranch,
        agentContext.anthropicApiKey,
      );
      logger.info(
        {
          event: 'dod.verify.layer1',
          kind: c.kind,
          status: verdict.status,
          exitCode: verdict.exitCode,
          reason: verdict.reason,
        },
        `DoD Layer 1 [${c.kind}] → ${verdict.status}`,
      );

      // Si un check command-based hizo skip por falta de tooling → fallback a
      // Layer 3 (el agente verifier hereda el criterio y decide independiente).
      // PERO un verifier `customVerify` (security-scan, code-security) que skipea
      // ya decidió "no puedo medir esto con confianza" — escalar a un agente
      // genérico menos equipado contradice esa decisión. Su skip es autoritativo
      // (no bloqueante) y NO escala.
      if (verdict.status === 'skipped' && !('customVerify' in spec)) {
        logger.info(
          { event: 'dod.verify.layer3.fallback', kind: c.kind, reason: verdict.reason },
          `Layer 1 skipped → escalating to Layer 3 verifier agent`,
        );
        const upgraded = await callVerifierAgent(workdir, c, agentContext);
        verdicts.push(upgraded);
      } else {
        // passed/failed de Layer 1, o skip autoritativo de un customVerify.
        verdicts.push(verdict);
      }
    } else {
      // Sin Layer 1 spec disponible (criterio semántico: acceptance-criteria,
      // docs-updated, o custom kind=null). Directo a Layer 3 — el verifier
      // agent audita el repo y emite verdict independiente.
      //
      // SPECIAL CASE 2026-05-13: si el criterio es `acceptance-criteria` Y
      // tenemos la lista de criterios concretos del seed, hacemos UNA llamada
      // al verifier-agent POR CADA acceptance criterion. Cada verdict usa el
      // texto del criterio como `label` para que el runner pueda matchearlo
      // con `storyCriterion.label` y marcar los milestones individualmente.
      // Sin esto, el verifier emite UN solo verdict global y los 4 criterios
      // de la story quedan agrupados como bloque pass/fail.
      if (c.kind === 'acceptance-criteria' && agentContext.acceptanceCriteria.length > 0) {
        logger.info(
          {
            event: 'dod.verify.layer3.per_criterion',
            kind: c.kind,
            count: agentContext.acceptanceCriteria.length,
            batchMode: VERIFIER_BATCH_ENABLED && agentContext.acceptanceCriteria.length >= 2,
          },
          `Layer 3 per-criterio: ${agentContext.acceptanceCriteria.length} acceptance criteria a evaluar`,
        );

        if (VERIFIER_BATCH_ENABLED && agentContext.acceptanceCriteria.length >= 2) {
          // BATCH PATH (OPTIMIZATION #1): N criterios → 1 sesión de claude.
          // Trade-off: pierde la granularidad de fireProgress per-criterion
          // (el UI no ve checkmarks incrementales — todos llegan al final).
          // Gana: 60-80% menos wall-clock + costo similar gracias a 1 lectura
          // de archivos en vez de N.
          const batchCriteria = agentContext.acceptanceCriteria.map((ac, i) => ({
            // criterionId estable: index del array + slice del texto. Para
            // que el modelo pueda emitir verdicts identificados sin que el
            // texto del criterio (que va al prompt) cuente como ID literal.
            criterionId: `ac-${i + 1}`,
            kind: c.kind,
            text: ac,
            description: `Acceptance criterion específico de la story: ${ac}`,
          }));
          const batchVerdicts = await callVerifierAgentBatch(
            workdir,
            batchCriteria,
            agentContext,
          );
          verdicts.push(...batchVerdicts);
          await fireProgress();
        } else {
          // LEGACY PATH (single call per criterio). Activo cuando
          // DOD_VERIFIER_BATCH=0 o cuando solo hay 1 criterio (batch == single,
          // sin overhead).
          for (const ac of agentContext.acceptanceCriteria) {
            // Construimos un criterio SINTÉTICO con el texto específico del
            // acceptance criterion. El verifier-agent recibe ese texto en su
            // prompt y evalúa SOLO ese requisito (no el bloque entero).
            const syntheticCriterion = {
              kind: c.kind,
              text: ac,
              description: `Acceptance criterion específico de la story: ${ac}`,
            };
            const verdict = await callVerifierAgent(workdir, syntheticCriterion, agentContext);
            verdicts.push(verdict);
            // UX progressive per-criterion: el frontend ve checkmarks
            // incrementales 1/N → 2/N → ... mientras Sonnet procesa cada uno.
            await fireProgress();
          }
        }
        // Salimos del else (ya pusheamos N verdicts), saltamos el verdict
        // global del path legacy abajo. NO hacemos `continue` aquí porque
        // queremos seguir al final del bloque for con su fireProgress final
        // (el último per-criterion ya disparó uno, otro extra es no-op).
      } else if (c.kind === 'technical-design' && agentContext.technicalRequirements.length > 0) {
        // Mismo patrón per-item para `technical-design` cuando la story
        // tiene requerimientos técnicos parseados del TL markdown. Cada
        // item se evalúa individualmente con:
        //   (a) Pre-flight determinístico (`tl-preflight.ts`): grep en
        //       archivos source del repo por identifiers extraídos del
        //       description (endpoints, paths, tipos, funciones).
        //       - `no-source-files` → fail (sin código).
        //       - `identifiers-missing` → fail (agente NO implementó).
        //       - `abstract` → escala a Sonnet sin fail (item prosa).
        //       - `ok` → escala a Sonnet con candidatePaths como hint.
        //   (b) Sonnet judge: lee archivos candidatos + valida que la
        //       implementación efectivamente cubre el item (no solo
        //       que los identifiers aparezcan superficialmente).
        //
        // Granularidad real per-item del TL en la UI: el operador ve qué
        // item específico del checklist técnico, contrato, validaciones o
        // errores no se cumplió. Defensa contra agentes que improvisan
        // arquitectura ignorando las decisiones del TL.
        logger.info(
          {
            event: 'dod.verify.layer3.per_technical_requirement',
            kind: c.kind,
            count: agentContext.technicalRequirements.length,
            checklist: agentContext.technicalRequirements.filter((tr) => tr.category === 'checklist').length,
            contract: agentContext.technicalRequirements.filter((tr) => tr.category === 'contract').length,
            validation: agentContext.technicalRequirements.filter((tr) => tr.category === 'validation').length,
            errors: agentContext.technicalRequirements.filter((tr) => tr.category === 'errors').length,
            batchMode: VERIFIER_BATCH_ENABLED,
          },
          `Layer 3 per-technical-requirement: ${agentContext.technicalRequirements.length} TL requirements a evaluar`,
        );

        // PASS 1: preflight todos los items. Items que fallan preflight
        // determinísticamente se materializan como failure verdicts ahora.
        // Items que pasan preflight se acumulan para una sola batch call.
        const categoryLabel: Record<'checklist' | 'contract' | 'validation' | 'errors', string> = {
          checklist: 'Checklist',
          contract: 'Contrato',
          validation: 'Validación',
          errors: 'Errores',
        };
        const tlBatchInput: Array<{
          criterionId: string;
          kind: string | null;
          text: string;
          description: string;
          originalLabel: string;
        }> = [];
        for (const tr of agentContext.technicalRequirements) {
          const label = `${categoryLabel[tr.category]}: ${tr.description}`;
          const preflight = await preflightTechnicalRequirement(workdir, tr);
          if (!preflight.ok) {
            logger.warn(
              {
                event: 'dod.verify.layer3.tl_preflight_failed',
                kind: c.kind,
                category: tr.category,
                preflightCategory: preflight.category,
                description: tr.description.slice(0, 80),
              },
              `Pre-flight TL requirement failed deterministicly: ${preflight.category} (skipping Sonnet call to save tokens)`,
            );
            verdicts.push({
              // DTO backend cap criterionId @ 200 chars (MaxLength).
              criterionId: truncate(label, 200),
              label,
              kind: c.kind,
              command: null,
              exitCode: null,
              output: preflight.candidatePaths.length > 0
                ? `Archivos source examinados por pre-flight:\n${preflight.candidatePaths.map((p) => `  - ${p}`).join('\n')}`
                : null,
              status: 'failed',
              reason: preflight.reason ?? 'pre-flight failed',
              usage: undefined,
            });
            await fireProgress();
            continue;
          }

          // Pre-flight pasó (ok | abstract) → acumular para batch.
          const candidateHint = preflight.candidatePaths.length > 0
            ? ` Pre-flight encontró archivos source que contienen identifiers de este item: ${preflight.candidatePaths.map((p) => p.replace(workdir, '')).slice(0, 3).join(', ')}. Léelos primero con Read antes de explorar el resto del repo.`
            : ` Item descrito como prosa abstracta (sin identifiers concretos detectables por grep). Explora el repo libremente con Read/Grep y evalúa si el código cumple semánticamente el requerimiento.`;
          const matchedHint = preflight.matchedIdentifiers.length > 0
            ? ` Identifiers que matchearon en pre-flight: ${preflight.matchedIdentifiers.join(', ')}.`
            : '';
          const description =
            `Requerimiento técnico específico del TL markdown — categoría '${tr.category}'. ` +
            `Pre-flight determinístico ya validó: (a) hay archivos source en el repo, (b) ` +
            (preflight.category === 'ok'
              ? `algunos identifiers del item aparecen en el código.${matchedHint}`
              : `el item está descrito como prosa abstracta sin identifiers concretos.`) +
            ` Tu trabajo (Sonnet semantic check): leer los archivos candidatos y validar que el código ` +
            `efectivamente IMPLEMENTA "${tr.description}" — no solo que los identifiers aparecen. ` +
            `Para 'contract': verifica que los endpoints/types/interfaces existen y tienen los campos descritos. ` +
            `Para 'checklist': verifica que la tarea técnica está hecha en código (no solo planificada en comments). ` +
            `Para 'validation': verifica que las reglas de validación están implementadas en los inputs descritos. ` +
            `Para 'errors': verifica que el manejo de errores (códigos, retries, fallbacks) está presente. ` +
            `Emite passed=false si el código no cubre el item o si la implementación contradice las decisiones del TL.` +
            candidateHint;
          tlBatchInput.push({
            criterionId: `tl-${tlBatchInput.length + 1}`,
            kind: c.kind,
            text: label,
            description,
            originalLabel: label,
          });
        }

        // PASS 2: si batch enabled y hay >= 2 items → 1 sola call.
        // Si solo hay 1 item (o batch disabled) → fallback a single calls.
        if (VERIFIER_BATCH_ENABLED && tlBatchInput.length >= 2) {
          const batchVerdicts = await callVerifierAgentBatch(
            workdir,
            tlBatchInput,
            agentContext,
          );
          verdicts.push(...batchVerdicts);
          await fireProgress();
        } else {
          for (const item of tlBatchInput) {
            const syntheticCriterion = {
              kind: item.kind,
              text: item.text,
              description: item.description,
            };
            const verdict = await callVerifierAgent(workdir, syntheticCriterion, agentContext);
            verdicts.push(verdict);
            await fireProgress();
          }
        }
      } else {
        logger.info(
          { event: 'dod.verify.layer3.direct', kind: c.kind, label: c.text },
          `Sin Layer 1 spec → Layer 3 verifier agent directo`,
        );
        const verdict = await callVerifierAgent(workdir, c, agentContext);
        verdicts.push(verdict);
      }
    }

    // UX progressive: notifica al runner después de CADA criterio para que
    // el backend reciba un POST /progress con el array acumulado parcial.
    // El frontend (polling cada Ns) verá el siguiente refresh con N+1
    // verdicts en lugar de esperar al final del attempt.
    await fireProgress();
  }

  // ════════════════════════════════════════════════════════════════════
  // OBSERVABILIDAD: log autoritativo del verifier al terminar el loop
  // ════════════════════════════════════════════════════════════════════
  //
  // Este es el hito espejado de `forge.claim.prompt.built` del api-side:
  // "qué salió del verifier" vs "qué entró al agente". Una sola línea
  // queryable para responder en Loki:
  //   - ¿Cuántos criterios totales se evaluaron?
  //   - ¿Cuántos pasaron / fallaron / skipped?
  //   - Breakdown por `kind` del DoD criterion.
  //   - Breakdown granular del TL por categoría (checklist/contract/
  //     validation/errors).
  //   - Pre-flight outcomes del TL (no-source-files / identifiers-missing /
  //     abstract / ok) para alerting sobre regresiones en context engineering.
  //
  // Queries típicas:
  //   |= "forge.verify.completed" | totalPassed < totalEvaluated
  //   |= "forge.verify.completed" | tl_failed > 0
  //   |= "forge.verify.completed" | unwrap tl_preflight_missing
  emitVerifierSummary(verdicts, agentContext);

  return verdicts.map(redactVerdict);
}

/**
 * Emite el log autoritativo del verifier al terminar el loop completo.
 * Equivalente del lado worker al `forge.claim.prompt.built` del backend.
 *
 * Breakdown:
 *   - Counts global (total / passed / failed / skipped).
 *   - Por `kind` del DoD criterion (acceptance-criteria, tests-passing,
 *     technical-design, etc.) — útil para identificar qué reviewer rompe.
 *   - Para `technical-design` específicamente, breakdown por TL category
 *     (checklist/contract/validation/errors) y outcomes del pre-flight
 *     determinístico — permite alertar sobre items que el agente saltó
 *     (identifiers-missing) vs items que el LLM judge falló (abstract).
 */
function emitVerifierSummary(
  verdicts: CriterionVerdict[],
  agentContext: { storyTitle: string; branch: string },
): void {
  const total = verdicts.length;
  const passed = verdicts.filter((v) => v.status === 'passed').length;
  const failed = verdicts.filter((v) => v.status === 'failed').length;
  const skipped = verdicts.filter((v) => v.status === 'skipped').length;
  // `verifierErrors`: subconjunto de `skipped` que NO es un skip legítimo
  // ("no aplica al entorno") sino un fallo del MEDIDOR (timeout/spawn/parse/
  // batch.missing_verdict del verifier agent). Los distinguimos por el prefijo
  // determinista que callVerifierAgent[Batch] inyecta en el reason. Esta cuenta
  // es la señal accionable para alerting: skipped alto por "no aplica" es OK,
  // pero verifierErrors alto significa que la infra del verifier está degradada
  // y criterios reales NO se están midiendo (falsos PASS silenciosos).
  const verifierErrors = verdicts.filter(
    (v) => v.status === 'skipped' && v.reason?.startsWith(VERIFIER_INFRA_ERROR_PREFIX),
  ).length;

  // Breakdown por kind (acceptance-criteria, tests-passing, technical-design,
  // code-written, no-errors, security-scan, design-coverage-check,
  // docs-updated, pr-created).
  const byKind: Record<string, { total: number; passed: number; failed: number }> = {};
  for (const v of verdicts) {
    const kind = v.kind ?? 'custom';
    if (!byKind[kind]) byKind[kind] = { total: 0, passed: 0, failed: 0 };
    byKind[kind].total++;
    if (v.status === 'passed') byKind[kind].passed++;
    if (v.status === 'failed') byKind[kind].failed++;
  }

  // Breakdown específico del TL por categoría — solo si hay technical-design.
  // Inferimos la category del `label` que pusimos en el bloque per-item:
  //   "Checklist: ..." | "Contrato: ..." | "Validación: ..." | "Errores: ..."
  const tlVerdicts = verdicts.filter((v) => v.kind === 'technical-design');
  const tlByCategory: Record<string, { total: number; passed: number; failed: number }> = {
    checklist: { total: 0, passed: 0, failed: 0 },
    contract: { total: 0, passed: 0, failed: 0 },
    validation: { total: 0, passed: 0, failed: 0 },
    errors: { total: 0, passed: 0, failed: 0 },
  };
  for (const v of tlVerdicts) {
    let cat: 'checklist' | 'contract' | 'validation' | 'errors' | null = null;
    if (v.label.startsWith('Checklist:')) cat = 'checklist';
    else if (v.label.startsWith('Contrato:')) cat = 'contract';
    else if (v.label.startsWith('Validación:')) cat = 'validation';
    else if (v.label.startsWith('Errores:')) cat = 'errors';
    if (cat) {
      tlByCategory[cat].total++;
      if (v.status === 'passed') tlByCategory[cat].passed++;
      if (v.status === 'failed') tlByCategory[cat].failed++;
    }
  }

  // Pre-flight outcomes del TL — inferimos del `reason` field del verdict
  // failed para distinguir failure categorías (defensa contra agentes que
  // saltan items específicos vs errores semánticos del LLM judge).
  let tlPreflightMissing = 0;     // identifiers-missing
  let tlPreflightNoSource = 0;    // no-source-files
  let tlPreflightSemantic = 0;    // Sonnet judge falló post-preflight ok/abstract
  for (const v of tlVerdicts) {
    if (v.status !== 'failed' || !v.reason) continue;
    if (v.reason.includes('Ningún identifier')) tlPreflightMissing++;
    else if (v.reason.includes('No se encontraron archivos source')) tlPreflightNoSource++;
    else tlPreflightSemantic++;
  }

  // Idem para QA test cases — pre-flight outcomes por category.
  let qaPreflightNotFound = 0;
  let qaPreflightSkipped = 0;
  let qaPreflightTrivial = 0;
  let qaPreflightSemantic = 0;
  const qaVerdicts = verdicts.filter((v) => v.kind === 'tests-passing');
  for (const v of qaVerdicts) {
    if (v.status !== 'failed' || !v.reason) continue;
    if (v.reason.includes('Ningún archivo de test menciona')) qaPreflightNotFound++;
    else if (v.reason.includes('SKIPPED/TODO')) qaPreflightSkipped++;
    else if (v.reason.includes('assertions triviales')) qaPreflightTrivial++;
    else qaPreflightSemantic++;
  }

  const payload = {
    event: 'forge.verify.completed',
    storyTitle: agentContext.storyTitle.slice(0, 100),
    branch: agentContext.branch,
    total,
    passed,
    failed,
    skipped,
    verifierErrors,
    passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
    byKind,
    tl: {
      total: tlVerdicts.length,
      byCategory: tlByCategory,
      preflightOutcomes: {
        missing: tlPreflightMissing,
        noSource: tlPreflightNoSource,
        semantic: tlPreflightSemantic,
      },
    },
    qa: {
      total: qaVerdicts.length,
      preflightOutcomes: {
        notFound: qaPreflightNotFound,
        skipped: qaPreflightSkipped,
        trivial: qaPreflightTrivial,
        semantic: qaPreflightSemantic,
      },
    },
  };

  // Mensaje legible humano + payload JSON estructurado.
  const summary =
    `verify.completed ${passed}/${total} passed ` +
    `(${failed} failed, ${skipped} skipped${verifierErrors > 0 ? ` [${verifierErrors} verifier-err]` : ''}, ${payload.passRate}%)` +
    (tlVerdicts.length > 0
      ? ` | TL: ${tlByCategory.checklist.passed}/${tlByCategory.checklist.total}cl + ${tlByCategory.contract.passed}/${tlByCategory.contract.total}ct + ${tlByCategory.validation.passed}/${tlByCategory.validation.total}vl + ${tlByCategory.errors.passed}/${tlByCategory.errors.total}er`
      : '')
    + (qaVerdicts.length > 0 ? ` | QA: ${qaVerdicts.filter(v => v.status === 'passed').length}/${qaVerdicts.length}` : '');

  // Loggear con WARN si hay regresión (failed > 0) O si el medidor falló
  // (verifierErrors > 0). Esto facilita alerting: cualquier WARN/ERROR del
  // event `forge.verify.completed` es señal accionable — failed = el agente
  // no cumplió; verifierErrors = la infra del verifier no pudo medir (criterios
  // pasaron como `skipped` sin verificarse → riesgo de falso PASS silencioso).
  if (failed > 0 || verifierErrors > 0) {
    logger.warn(payload, summary);
  } else {
    logger.info(payload, summary);
  }
}

/**
 * Wrapper que invoca `runVerifierAgent` (Layer 3) y traduce su output
 * (`VerifierAgentVerdict`) al shape `CriterionVerdict` esperado por el
 * resto del pipeline. Loguea el verdict para forensics.
 */
async function callVerifierAgent(
  workdir: string,
  criterion: { kind: string | null; text: string; description: string },
  agentContext: {
    storyTitle: string;
    storyMarkdown: string | null;
    branch: string;
    anthropicApiKey: string;
    dodVerifierModel?: string;
    dodVerifierEffort?: string;
    /** Secretos externos del org — propagados al spawn del verifier agent. */
    externalSecrets: ExternalSecretForWorker[];
  },
): Promise<CriterionVerdict> {
  const verdict: VerifierAgentVerdict = await runVerifierAgentWithRetry({
    workdir,
    criterion: { kind: criterion.kind, text: criterion.text, description: criterion.description },
    storyTitle: agentContext.storyTitle,
    storyMarkdown: agentContext.storyMarkdown,
    branch: agentContext.branch,
    anthropicApiKey: agentContext.anthropicApiKey,
    externalSecrets: agentContext.externalSecrets,
    model: agentContext.dodVerifierModel,
    effort: agentContext.dodVerifierEffort,
  });

  logger.info(
    {
      event: 'dod.verify.layer3.verdict',
      kind: criterion.kind,
      label: criterion.text,
      passed: verdict.passed,
      verifierError: verdict.verifierError,
      evidencePaths: verdict.evidencePaths,
    },
    `Layer 3 [${criterion.kind ?? 'custom'}] → ${verdict.passed ? 'PASSED' : 'FAILED'}`,
  );

  return {
    // `criterion.text` siempre se prefiere sobre `criterion.kind` para evitar
    // colisiones cuando múltiples synthetic criterions comparten el mismo
    // `kind` (ej. acceptance-criteria per-criterion, tests-passing
    // per-test-case, technical-design per-item). En esos paths, varios
    // verdicts del mismo attempt tendrían el mismo criterionId si usamos
    // `kind` — la `new Map(verdicts.map(...))` en runner.ts:1045 dedup
    // por key conservaría solo el último, dejando ciega la skip-regression
    // detection (qa-reviewer HIGH 2026-05-15). `criterion.text` es siempre
    // único per-verdict y estable entre attempts (viene del seed o del
    // texto canónico del DoD criterion, ambos deterministic).
    // DTO backend cap @ 200 chars — criterion.text puede ser un AC largo.
    criterionId: truncate(criterion.text, 200),
    label: criterion.text,
    kind: criterion.kind,
    // Layer 3 no es subprocess — no hay command ni exitCode.
    command: null,
    exitCode: null,
    // Output reporta el reason del verifier + evidencias (para retry prompt).
    output:
      verdict.evidencePaths.length > 0
        ? `Evidencias examinadas por el verifier:\n${verdict.evidencePaths.map((p) => `  - ${p}`).join('\n')}`
        : null,
    // Un fallo del VERIFICADOR (timeout/spawn/parse) NO es un fallo del
    // CRITERIO. Mapeamos a `skipped` (no bloqueante) en vez de `failed`:
    // penalizar al agente por un rate limit o cold-start del verifier es
    // un falso negativo. El `reason` deja explícito que fue infra, y
    // emitVerifierSummary cuenta estos como `verifierErrors` aparte para
    // observabilidad. Principio: un fallo del medidor ≠ fallo de lo medido.
    status: verdict.verifierError ? 'skipped' : verdict.passed ? 'passed' : 'failed',
    reason: verdict.verifierError
      ? `${VERIFIER_INFRA_ERROR_PREFIX}${verdict.verifierError}) — criterio NO verificado (no contado como fallo): ${verdict.reason}`
      : verdict.reason,
    // Propaga usage del CLI claude → CriterionVerdict para cost tracking
    // y forensics. Ausente si el verifier falló antes de obtener wrapper
    // JSON (timeout/spawn/exit nonzero); presente desde verdict.parse.failed
    // en adelante (los tokens ya se gastaron).
    usage: verdict.usage,
  };
}

/**
 * Wrapper batch: invoca `runVerifierAgentBatch` para N criterios en una sola
 * sesión y devuelve Array<CriterionVerdict> en el MISMO orden del input.
 *
 * Cada criterio del input debe traer:
 *  - `criterionId`: ID único usado para correlacionar verdicts batch-side
 *  - `kind`: kind del verdict resultante
 *  - `text`: label visible (matchea storyCriterion.label en el frontend)
 *  - `description`: descripción que el verifier ve en el prompt
 *
 * Si N === 0 → retorna []. Si N === 1 → degrada a single-call (sin overhead
 * del wrapper batch). N >= 2 → 1 sesión batch real.
 *
 * Garantía: el array de salida tiene EXACTAMENTE input.criteria.length items,
 * en el mismo orden — si el modelo skipea algún criterio, ese verdict viene
 * como failed con verifierError descriptivo (no se omite del array).
 */
async function callVerifierAgentBatch(
  workdir: string,
  criteria: Array<{
    criterionId: string;
    kind: string | null;
    text: string;
    description: string;
  }>,
  agentContext: {
    storyTitle: string;
    storyMarkdown: string | null;
    branch: string;
    anthropicApiKey: string;
    dodVerifierModel?: string;
    dodVerifierEffort?: string;
    /** Secretos externos del org — propagados al spawn del verifier agent. */
    externalSecrets: ExternalSecretForWorker[];
  },
): Promise<CriterionVerdict[]> {
  if (criteria.length === 0) return [];

  const batchInput: BatchCriterionInput[] = criteria.map((c) => ({
    criterionId: c.criterionId,
    kind: c.kind,
    text: c.text,
    description: c.description,
  }));

  const verdictMap = await runVerifierAgentBatchWithRetry({
    workdir,
    criteria: batchInput,
    storyTitle: agentContext.storyTitle,
    storyMarkdown: agentContext.storyMarkdown,
    branch: agentContext.branch,
    anthropicApiKey: agentContext.anthropicApiKey,
    externalSecrets: agentContext.externalSecrets,
    model: agentContext.dodVerifierModel,
    effort: agentContext.dodVerifierEffort,
  });

  return criteria.map((c) => {
    const v = verdictMap.get(c.criterionId) ?? {
      passed: false,
      reason: `Batch verifier no devolvió verdict para criterionId="${c.criterionId}" (bug interno)`,
      evidencePaths: [],
      verifierError: 'batch.missing_verdict',
    };

    logger.info(
      {
        event: 'dod.verify.layer3.verdict',
        kind: c.kind,
        label: c.text,
        passed: v.passed,
        verifierError: v.verifierError,
        evidencePaths: v.evidencePaths,
        batch: true,
      },
      `Layer 3 [${c.kind ?? 'custom'}] (batch) → ${v.passed ? 'PASSED' : 'FAILED'}`,
    );

    return {
      // DTO backend cap @ 200 chars — c.text es el label del criterio del batch.
      criterionId: truncate(c.text, 200),
      label: c.text,
      kind: c.kind,
      command: null,
      exitCode: null,
      output:
        v.evidencePaths.length > 0
          ? `Evidencias examinadas por el verifier batch:\n${v.evidencePaths.map((p) => `  - ${p}`).join('\n')}`
          : null,
      // Mismo principio que el single-verifier (~línea 1230): un fallo del
      // VERIFICADOR (timeout/spawn/parse/batch.missing_verdict) NO es un fallo
      // del CRITERIO → `skipped` no bloqueante, no `failed`. emitVerifierSummary
      // los cuenta como `verifierErrors` aparte. Medidor ≠ medido.
      status: v.verifierError ? 'skipped' : v.passed ? 'passed' : 'failed',
      reason: v.verifierError
        ? `${VERIFIER_INFRA_ERROR_PREFIX}${v.verifierError}) — criterio NO verificado (no contado como fallo): ${v.reason}`
        : v.reason,
      usage: v.usage,
    };
  });
}

/**
 * Helper para el caller: ¿algún verdict bloquea el complete?
 * `passed` y `skipped` son OK; solo `failed` bloquea. Skipped no falla
 * porque significa "no aplica al environment", NO "está mal".
 */
export function hasFailedCriteria(verdicts: CriterionVerdict[]): boolean {
  return verdicts.some((v) => v.status === 'failed');
}

/**
 * Helper para el caller: extrae solo los failed para incluir en retry-prompt.
 */
export function extractFailedCriteria(verdicts: CriterionVerdict[]): CriterionVerdict[] {
  return verdicts.filter((v) => v.status === 'failed');
}

/**
 * Helper para el caller: extrae solo los PASSED para incluir en retry-prompt
 * como contexto "preservar". El surgical retry usa esta lista para enumerar
 * al agente qué NO debe tocar.
 *
 * Excluye 'skipped' intencionalmente — esos no son "trabajo preservado" (no
 * aplican al environment, no hay nada que romper).
 */
export function extractPassedCriteria(verdicts: CriterionVerdict[]): CriterionVerdict[] {
  return verdicts.filter((v) => v.status === 'passed');
}

/**
 * Construye el prompt de retry QUIRÚRGICO (surgical incremental retry).
 *
 * Diseño 2026-05-17 — reemplaza el approach anterior "destructive retry" que
 * concatenaba `originalPrompt` completo al final, causando que el agente
 * re-implementara desde cero y regresionara criterios que ya pasaban.
 *
 * El nuevo prompt:
 *   1. Le dice EXPLÍCITAMENTE al agente cuánto progreso preservó (N de M).
 *   2. Lista los criterios que YA pasaron como "NO TOCAR" con evidencia
 *      cuando está disponible.
 *   3. Enumera solo los fallidos con verdict + diagnóstico + comando.
 *   4. NO reenvía el `originalPrompt` completo (sigue accesible en el filesystem
 *      vía los archivos commiteados; el agente puede `git log` / `git show` si
 *      necesita re-contexto).
 *   5. Reglas estrictas: Read antes de Write, cambios mínimos, no commitear si
 *      el fix de un criterio rompería otro que ya pasaba.
 *
 * Resultado esperado: el agente trata cada retry como una operación quirúrgica
 * incremental, NO como un "do it all again, but better".
 *
 * @param storyTitle Título corto de la story (10-100 chars). Aparece arriba
 *        como recordatorio del scope sin reenviar el AC completo.
 * @param storyContext (opcional) Resumen corto de la story (≤500 chars) si
 *        el agente necesita más contexto del que da el título.
 * @param failedVerdicts Verdicts del verifier con status='failed'. Cada uno
 *        trae command + output literal + reason. Solo estos serán el SCOPE
 *        del retry.
 * @param passedVerdicts Verdicts del verifier con status='passed'. NO son el
 *        scope del retry — se listan como "preservar" para que el agente no
 *        los toque accidentalmente.
 * @param attemptNumber Cuál intento es ahora (2 = segundo, 3 = tercero, etc.).
 * @param maxAttempts Cuántos intentos máximo antes de fail permanente.
 */
export function buildRetryPrompt(input: {
  storyTitle: string;
  storyContext?: string;
  failedVerdicts: CriterionVerdict[];
  passedVerdicts: CriterionVerdict[];
  attemptNumber: number;
  maxAttempts: number;
}): string {
  const {
    storyTitle,
    storyContext,
    failedVerdicts,
    passedVerdicts,
    attemptNumber,
    maxAttempts,
  } = input;

  const totalCount = failedVerdicts.length + passedVerdicts.length;
  const passedCount = passedVerdicts.length;
  const failedCount = failedVerdicts.length;
  const progressPct = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  const failedSection = renderFailedSection(failedVerdicts);
  const preservedSection = renderPreservedSection(passedVerdicts);

  return [
    `# CENZONTLE Forge — Retry QUIRÚRGICO (intento ${attemptNumber}/${maxAttempts})`,
    ``,
    `## Story: ${storyTitle}`,
    ``,
    ...(storyContext ? [`> ${storyContext}`, ``] : []),
    `## ⚡ Estado del trabajo`,
    ``,
    `Ya cumpliste **${passedCount} de ${totalCount}** criterios del Definition of Done (${progressPct}%) en el attempt anterior.`,
    `Los archivos que generaste **YA ESTÁN commiteados** en la branch del worker — usá \`git log\` y \`git show\` si necesitás revisar tu trabajo previo.`,
    ``,
    `**NO REESCRIBÁS desde cero**. Esta es una iteración quirúrgica: solo fixeá los ${failedCount} criterios que fallaron, sin tocar el resto.`,
    ``,
    `## 🛑 Reglas estrictas del retry`,
    ``,
    `1. **USAR Read ANTES de Write/Edit**: confirmá el estado actual del archivo antes de modificarlo. NO asumas que recordás lo que escribiste antes.`,
    `2. **Cambios mínimos**: el menor diff posible que satisfaga los criterios fallidos. Si un cambio de 3 líneas funciona, NO reemplaces el archivo entero.`,
    `3. **NO toques los archivos relacionados con criterios que ya pasan** (listados abajo como "PRESERVAR"). Si tu fix requiere tocar uno de esos, primero verificá con Read que el cambio NO rompe lo que ya funciona.`,
    `4. **OBLIGATORIO antes de Edit/Write en archivos PRESERVED**: si un archivo aparece en el bloque "🛡️ Archivos referenciados por criterios PRESERVED" abajo, DEBÉS (a) hacer Read del archivo completo, (b) identificar qué sección/función/línea cubre el criterio passed, (c) modificar SOLO lo necesario sin tocar esa sección, (d) re-leer post-Edit para verificar que no rompiste nada.`,
    `5. **Si no podés fixear el criterio X sin romper el criterio Y (que ya pasa)**: NO commits. Dejá un comentario en tu output explicando el conflicto y deja la branch como estaba. Mejor fail honesto que regresión silenciosa.`,
    `6. **Si llegás al intento ${maxAttempts} sin arreglar todo, los criterios sin cumplir quedan como deuda visible (warn) y la historia igual avanza** — no te quedes dando vueltas.`,
    ``,
    preservedSection,
    ``,
    failedSection,
    ``,
    `---`,
    ``,
    `**Recordá**: cada criterio fallido viene con (a) qué se esperaba, (b) qué falló (verdict del judge), y (c) si aplica, el comando del verifier + su output literal. Esa es la fuente de verdad — leéla con cuidado antes de actuar.`,
  ].join('\n');
}

/**
 * Extrae paths de archivo del `output` field de un verdict — los verifiers
 * embeben evidencias como bullet list:
 *   "Evidencias examinadas por el verifier batch:
 *      - history.html
 *      - history.test.js"
 *
 * Parser permisivo: matchea cualquier line con prefijo `  - <path>` que
 * tenga apariencia de path (sin spaces, con al menos una extension o slash).
 * Si el output no tiene esa estructura (ej. Layer 1 deterministic con
 * `git status` raw), retorna [].
 *
 * Cap a 10 paths por verdict — más que eso indica criterio amplio y el coder
 * no necesita la lista exhaustiva.
 */
function extractEvidencePathsFromOutput(output: string | null): string[] {
  if (!output) return [];
  const paths = new Set<string>();
  const bulletRe = /^\s{2,}-\s+(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = bulletRe.exec(output)) !== null && paths.size < 10) {
    const candidate = m[1].trim();
    // Filtrar tokens que claramente no son paths (números, palabras solas
    // sin extension ni slash).
    if (candidate.includes('/') || /\.[a-z0-9]{1,8}$/i.test(candidate)) {
      paths.add(candidate);
    }
  }
  return Array.from(paths);
}

/**
 * Renderea los verdicts PASADOS como contexto de "no tocar". Truncado para
 * no inflar el prompt: solo label + evidencia (paths) si la hay. Si la lista
 * tiene más de 15 items, agrupa los primeros 15 y muestra count de los demás.
 */
function renderPreservedSection(passed: CriterionVerdict[]): string {
  if (passed.length === 0) {
    return [
      `## ✓ Criterios que YA pasan`,
      ``,
      `_(Ninguno — el attempt previo no cumplió ningún criterio. Empezá desde el primer fail con cuidado.)_`,
    ].join('\n');
  }
  const lines: string[] = [
    `## ✓ Criterios que YA pasan (NO ROMPER en este retry)`,
    ``,
  ];
  const MAX_SHOWN = 15;
  const visible = passed.slice(0, MAX_SHOWN);
  // Recolectar TODOS los archivos asociados a criterios preserved (union
  // deduplicada) — los exponemos al final como bloque "ARCHIVOS A NO ROMPER".
  // Fix 2026-05-18 contra regresiones: antes el coder solo veía labels sin
  // saber qué archivos relacionados, así que al editar para fixear failed
  // criteria rompía criteria que ya pasaban.
  //
  // Los evidence paths viven embebidos en el `output` field como texto plano
  // (formato "Evidencias examinadas por el verifier...:\n  - path1\n  - path2").
  // Los parseamos acá en lugar de extender el shape de CriterionVerdict porque
  // el shape es shared con el backend (paquete @cenzontle/shared) y un cambio
  // de tipo cascadea a 5+ archivos. Parsing local es self-contained.
  const allPreservedFiles = new Set<string>();
  visible.forEach((v) => {
    const evidence = v.command ? ` _(verifier: \`${truncate(v.command, 80)}\`)_` : '';
    const filesFromOutput = extractEvidencePathsFromOutput(v.output);
    // Inline files per criterion para que el coder sepa qué archivos cubren
    // este criterio específico (granularidad fina).
    const filesLine = filesFromOutput.length > 0
      ? `\n    Archivos: ${filesFromOutput.slice(0, 5).map((p) => `\`${p}\``).join(', ')}`
      : '';
    lines.push(`- ✓ ${truncate(v.label, 200)}${evidence}${filesLine}`);
    filesFromOutput.forEach((p) => allPreservedFiles.add(p));
  });
  if (passed.length > MAX_SHOWN) {
    lines.push(`- _...y ${passed.length - MAX_SHOWN} criterios más, todos OK._`);
  }
  // Bloque consolidado al final — listado plano de TODOS los archivos preserved
  // para que el coder tenga UNA referencia rápida sin re-leer cada bullet.
  if (allPreservedFiles.size > 0) {
    lines.push('');
    lines.push(`**🛡️ Archivos referenciados por criterios PRESERVED (cuidado al editarlos):**`);
    Array.from(allPreservedFiles)
      .slice(0, 30)
      .forEach((p) => lines.push(`- \`${p}\``));
    if (allPreservedFiles.size > 30) {
      lines.push(`- _...y ${allPreservedFiles.size - 30} archivos más._`);
    }
    lines.push('');
    lines.push(
      `**Antes de modificar cualquiera de estos archivos**: USA \`Read\` sobre ` +
        `el archivo + revisá qué criterio passed lo cubre (lista arriba) + hacé ` +
        `el menor cambio posible que NO rompa la sección/función/línea que el ` +
        `verifier validó. Si tu fix REQUIERE romper algo preserved, comentá el ` +
        `conflicto en tu output y dejá la branch sin commit nuevo — mejor fail ` +
        `honesto que regresión silenciosa.`,
    );
  }
  return lines.join('\n');
}

/**
 * Renderea cada verdict failed como bullet con su comando + output literal
 * en code block, formato markdown que claude parsea visualmente.
 *
 * Trunca strings largos para evitar inflar el prompt: el output del verifier
 * puede ser de KB y solo necesitamos las últimas líneas para diagnóstico.
 */
function renderFailedSection(failed: CriterionVerdict[]): string {
  if (failed.length === 0) {
    return [
      `## ✗ Criterios que necesitan fix`,
      ``,
      `_(Ninguno listado — esto es inesperado, el retry no debió haberse triggereado. Reportar bug.)_`,
    ].join('\n');
  }
  const lines: string[] = [
    `## ✗ Criterios fallidos a FIXEAR (scope EXCLUSIVO de este retry)`,
    ``,
    `Cada uno trae **qué se esperaba**, **qué falló**, y cuando aplica, el **output literal** del verifier.`,
    ``,
  ];
  failed.forEach((f, i) => {
    lines.push(`### ${i + 1}. ${truncate(f.label, 300)}`);
    lines.push('');
    if (f.command) {
      lines.push(`**Comando ejecutado por el worker**: \`${truncate(f.command, 200)}\``);
      lines.push('');
    }
    if (f.reason) {
      lines.push(`**Diagnóstico del judge**: ${truncate(f.reason, 800)}`);
      lines.push('');
    }
    if (f.output && f.output.trim().length > 0) {
      lines.push(`**Output literal** (últimas líneas — fuente de verdad):`);
      lines.push('```');
      lines.push(truncate(f.output, 1500));
      lines.push('```');
      lines.push('');
    } else {
      lines.push('_(Sin output capturado — el verifier no produjo evidencia textual. Verificá manualmente qué espera el criterio.)_');
      lines.push('');
    }
  });
  return lines.join('\n');
}

/**
 * Truncate a string to max chars, agregando "… (truncated N chars)" al final
 * si se truncó. Helper compartido por `renderFailedSection` /
 * `renderPreservedSection`, los wrappers `callVerifierAgent` /
 * `callVerifierAgentBatch` y los bloques per-item del verifier para acotar
 * labels/reasons/outputs.
 *
 * También sirve como defensa-en-profundidad contra los MaxLength del backend
 * DTO (label≤500, reason≤2000, output≤4000, command≤500) — si pasamos un
 * verdict por aquí antes de mandarlo al network, evitamos 400 silenciosos.
 */
function truncate(s: string, maxChars: number): string {
  if (!s || s.length <= maxChars) return s ?? '';
  const remaining = s.length - maxChars;
  return s.slice(0, maxChars) + `… (truncated ${remaining} chars)`;
}
