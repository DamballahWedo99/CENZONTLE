import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import type { CriterionVerdict } from '@cenzontle/shared';
import { logger } from './logger.js';
import { runVerifierAgent, type VerifierAgentVerdict } from './dod-verifier-agent.js';

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
 * Configuración del verifier para un kind canónico. `precheck` valida
 * prerrequisitos del environment (ej. existe package.json + script "test").
 * Si el precheck retorna `null`, el criterio se skip con esa razón.
 * Si retorna `{ args }`, se ejecuta el comando con esos args.
 */
interface VerifierSpec {
  /** Función que decide si el verifier puede correr en este workdir.
   *  Retorna `null` con razón si NO puede (skip) o config para correr. */
  precheck: (workdir: string) => Promise<{ binary: string; args: string[] } | { skip: string }>;
}

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

const VERIFIERS: Record<string, VerifierSpec> = {
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
    precheck: async () => ({ binary: 'git', args: ['status', '--porcelain'] }),
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
      return { binary: pm, args: ['test'] };
    },
  },

  /**
   * no-errors: combina `lint` y `type-check`. Si AMBOS scripts existen,
   * corremos ambos secuencial (el primer fallo decide). Si solo uno
   * existe, corre ese. Si ninguno existe, skip.
   *
   * Implementación: usa `--silent` cuando es posible para reducir noise.
   */
  'no-errors': {
    precheck: async (workdir) => {
      const hasLint = await hasNpmScript(workdir, 'lint');
      const hasTypeCheck =
        (await hasNpmScript(workdir, 'type-check')) ||
        (await hasNpmScript(workdir, 'typecheck'));
      if (!hasLint && !hasTypeCheck) {
        return { skip: 'El repo no tiene scripts "lint" ni "type-check" en package.json.' };
      }
      const pm = await detectPackageManager(workdir);
      // Si existen ambos, encadenamos con `&&` via shell wrapper. Pero como
      // usamos execFile (sin shell), corremos solo el que tenga prioridad
      // (lint primero, type-check si no hay lint). Esto es trade-off:
      // verificación más simple a costa de no detectar type errors si lint
      // pasa. Suficiente para Tier 1; Tier 2 puede correr ambos.
      const script = hasLint ? 'lint' : (await hasNpmScript(workdir, 'type-check')) ? 'type-check' : 'typecheck';
      return { binary: pm, args: [script] };
    },
  },

  /**
   * security-scan: `npm audit --audit-level=high` reporta solo críticas y
   * altas. Exit code != 0 si encuentra. Solo aplica a repos Node con
   * package.json — sin él, skip.
   */
  'security-scan': {
    precheck: async (workdir) => {
      try {
        await fs.access(join(workdir, 'package.json'));
      } catch {
        return { skip: 'El repo no tiene package.json. Security scan vía npm audit no aplica.' };
      }
      return { binary: 'npm', args: ['audit', '--audit-level=high'] };
    },
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
interface AgentSelfReport {
  id: string;
  label: string;
  completed: boolean;
}

/**
 * Lee el `.cenzontle-criteria.json` del workdir si existe. Es el self-report
 * del agente — usado SOLO para visibility en UI (timeline), no para decidir
 * pass/fail. Tolerante a errores: archivo ausente o malformado → array vacío.
 */
async function readAgentSelfReport(workdir: string): Promise<AgentSelfReport[]> {
  try {
    const raw = await fs.readFile(join(workdir, '.cenzontle-criteria.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is AgentSelfReport =>
        c &&
        typeof c === 'object' &&
        typeof c.id === 'string' &&
        typeof c.label === 'string' &&
        typeof c.completed === 'boolean',
    );
  } catch {
    return [];
  }
}

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
): Promise<CriterionVerdict> {
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
  const cmdString = `${config.binary} ${config.args.join(' ')}`;
  try {
    const result = await execFileAsync(config.binary, config.args, {
      cwd: workdir,
      env: {
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
    return {
      criterionId: kind,
      label,
      kind,
      command: cmdString,
      exitCode: 0,
      output: tailBytes(combined, MAX_OUTPUT_BYTES),
      status: 'passed',
    };
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
    if (e.code === 'ENOENT') {
      return {
        criterionId: kind,
        label,
        kind,
        command: cmdString,
        exitCode: null,
        output: null,
        status: 'skipped',
        reason: `Binario "${config.binary}" no encontrado en el environment del worker.`,
      };
    }
    // Timeout — el comando excedió VERIFIER_TIMEOUT_MS. Distinguimos del
    // fail normal porque el agente puede que necesite un fix distinto
    // (optimizar tests, no debugear lógica).
    if (e.killed || e.signal === 'SIGTERM') {
      return {
        criterionId: kind,
        label,
        kind,
        command: cmdString,
        exitCode: null,
        output: tailBytes(((e.stdout ?? '') + (e.stderr ?? '')).trim(), MAX_OUTPUT_BYTES),
        status: 'failed',
        reason: `Comando excedió timeout de ${VERIFIER_TIMEOUT_MS / 1000}s`,
      };
    }
    // Fail normal: exit code distinto de 0. Capturamos output para retry prompt.
    const exitCode = typeof e.code === 'number' ? e.code : -1;
    const combined = ((e.stdout ?? '') + (e.stderr ?? '')).trim();
    return {
      criterionId: kind,
      label,
      kind,
      command: cmdString,
      exitCode,
      output: tailBytes(combined, MAX_OUTPUT_BYTES),
      status: 'failed',
      reason: `Comando exit code ${exitCode}`,
    };
  }
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
    branch: string;
    anthropicApiKey: string;
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
  // Cargamos el self-report aunque NO se usa para verdict (solo para logging
  // forensics si difiere del veredicto del verifier agent — interesante para
  // detectar sycophancy del generator).
  const selfReport = await readAgentSelfReport(workdir);
  void selfReport; // Reservado para forensics futuro.
  const verdicts: CriterionVerdict[] = [];

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
      await onProgress([...verdicts]);
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

    const spec = c.kind !== null ? VERIFIERS[c.kind] : undefined;

    if (spec) {
      // Layer 1: Deterministic check. Corre subprocess.
      const verdict = await runVerifier(workdir, c.kind!, c.text, spec);
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

      // Si Layer 1 hizo skip por falta de tooling → fallback a Layer 3.
      // El agente verifier hereda el criterio y decide independiente.
      if (verdict.status === 'skipped') {
        logger.info(
          { event: 'dod.verify.layer3.fallback', kind: c.kind, reason: verdict.reason },
          `Layer 1 skipped → escalating to Layer 3 verifier agent`,
        );
        const upgraded = await callVerifierAgent(workdir, c, agentContext);
        verdicts.push(upgraded);
      } else {
        // passed o failed de Layer 1 son autoritative.
        verdicts.push(verdict);
      }
    } else {
      // Sin Layer 1 spec disponible (criterio semántico: acceptance-criteria,
      // docs-updated, o custom kind=null). Directo a Layer 3 — el verifier
      // agent audita el repo y emite verdict independiente.
      logger.info(
        { event: 'dod.verify.layer3.direct', kind: c.kind, label: c.text },
        `Sin Layer 1 spec → Layer 3 verifier agent directo`,
      );
      const verdict = await callVerifierAgent(workdir, c, agentContext);
      verdicts.push(verdict);
    }

    // UX progressive: notifica al runner después de CADA criterio para que
    // el backend reciba un POST /progress con el array acumulado parcial.
    // El frontend (polling cada Ns) verá el siguiente refresh con N+1
    // verdicts en lugar de esperar al final del attempt.
    await fireProgress();
  }

  return verdicts;
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
    branch: string;
    anthropicApiKey: string;
  },
): Promise<CriterionVerdict> {
  const verdict: VerifierAgentVerdict = await runVerifierAgent({
    workdir,
    criterion: { text: criterion.text, description: criterion.description },
    storyTitle: agentContext.storyTitle,
    branch: agentContext.branch,
    anthropicApiKey: agentContext.anthropicApiKey,
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
    criterionId: criterion.kind ?? criterion.text,
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
    status: verdict.passed ? 'passed' : 'failed',
    reason: verdict.verifierError
      ? `Verifier agent error (${verdict.verifierError}): ${verdict.reason}`
      : verdict.reason,
    // Propaga usage del CLI claude → CriterionVerdict para cost tracking
    // y forensics. Ausente si el verifier falló antes de obtener wrapper
    // JSON (timeout/spawn/exit nonzero); presente desde verdict.parse.failed
    // en adelante (los tokens ya se gastaron).
    usage: verdict.usage,
  };
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
 * Construye el prompt para un retry attempt. Aplica los principios del
 * research:
 *
 *   - Output literal del comando que falló se inyecta directo (no se
 *     sintetiza ni se traduce). Anthropic, Augment Code, Addy Osmani
 *     coinciden: los modelos auto-corrigen mejor con error verbatim que
 *     con resumen humano.
 *   - "NO repitas la misma estrategia" — chain of fallbacks (OpenAI o3):
 *     instrucción explícita para cambiar approach evita doom loop.
 *   - Pre-pendeamos al prompt original (que ya tiene el contexto completo
 *     de épica + story + DoD) en vez de reconstruirlo desde cero. Single
 *     source of truth — el backend ya generó el contexto bien.
 *
 * @param originalPrompt El prompt que el backend envió en el primer claim.
 *        Tiene épica + story + DoD + workflow. Lo reusamos al pie de página.
 * @param failedVerdicts Verdicts del verifier con status='failed'. Cada uno
 *        trae command + output literal + reason.
 * @param attemptNumber Cuál intento es ahora (2 = segundo, 3 = tercero, etc.)
 * @param maxAttempts Cuántos intentos máximo antes de fail permanente.
 */
export function buildRetryPrompt(input: {
  originalPrompt: string;
  failedVerdicts: CriterionVerdict[];
  attemptNumber: number;
  maxAttempts: number;
}): string {
  const { originalPrompt, failedVerdicts, attemptNumber, maxAttempts } = input;
  const failedSection = renderFailedSection(failedVerdicts);
  return [
    `# CENZONTLE Forge — INTENTO ${attemptNumber} de ${maxAttempts}`,
    ``,
    `## ⚠️ Tu intento previo NO cumplió todos los criterios del Definition of Done.`,
    ``,
    `Esta es la iteración ${attemptNumber} del loop de verificación. El worker corrió checks determinísticos sobre el código que dejaste y los siguientes fallaron. Tenés acá el output literal de cada uno — **es la fuente de verdad de qué está roto**.`,
    ``,
    `**Reglas del retry**:`,
    `- NO repitas exactamente la misma estrategia que falló — claramente no funcionó.`,
    `- Lee el output del error PRIMERO. Investigá el código relevante con Read/Grep si el error te confunde.`,
    `- Cambios incrementales: arreglá un criterio fallido, verificá mentalmente, después pasá al siguiente.`,
    `- Si llegás al intento ${maxAttempts} sin arreglar todo, el run se marca fallido y un humano investiga — no te quedes en doom loop.`,
    ``,
    failedSection,
    ``,
    `---`,
    ``,
    `## Contexto original de la tarea (mismo del primer intento)`,
    ``,
    originalPrompt,
  ].join('\n');
}

/**
 * Renderea cada verdict failed como bullet con su comando + output literal
 * en code block, formato markdown que claude parsea visualmente.
 */
function renderFailedSection(failed: CriterionVerdict[]): string {
  if (failed.length === 0) return '';
  const lines: string[] = [`## Criterios que NO cumpliste en el intento previo`, ''];
  failed.forEach((f, i) => {
    lines.push(`### ${i + 1}. ${f.label}`);
    lines.push('');
    if (f.command) {
      lines.push(`**Comando ejecutado por el worker**: \`${f.command}\``);
      lines.push('');
    }
    if (f.reason) {
      lines.push(`**Diagnóstico**: ${f.reason}`);
      lines.push('');
    }
    if (f.output && f.output.trim().length > 0) {
      lines.push(`**Output literal** (últimas líneas — esta es la verdad de qué está roto):`);
      lines.push('```');
      lines.push(f.output);
      lines.push('```');
      lines.push('');
    } else {
      lines.push('_(Sin output capturado — verificá manualmente qué espera el criterio.)_');
      lines.push('');
    }
  });
  return lines.join('\n');
}
