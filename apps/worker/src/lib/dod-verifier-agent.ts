import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';
import { wrapWithSandbox } from './sandbox.js';

const execFileAsync = promisify(execFile);

/**
 * Tier 1 Harness — Layer 3: Verifier Agent (model-based grader).
 *
 * Patrón fundamentado en research industria (sources: Anthropic "Demystifying
 * evals for AI agents", Anthropic "Outcome-based verification", Multi-Gate
 * Quality Systems, GLEAN arxiv 2603.02798):
 *
 *   - **Heterogeneous models**: el generator es Haiku 4.5; el verifier es
 *     Sonnet 4.6 (modelo distinto reduce shared biases del generator).
 *   - **Sin acceso al transcript del generator**: el verifier ve solo el
 *     diff + criterion + story. No lee `.cenzontle-criteria.json` ni el
 *     output del generator. Anonymization principle.
 *   - **Outcome-based**: el verifier puede usar tools read-only para auditar
 *     el ESTADO real del repo (Read, Grep, Bash). No confía en transcripts.
 *   - **JSON estructurado**: output parseable con verdict + reason +
 *     evidence_paths para forensics.
 *
 * Costo: ~$0.05 per call con Sonnet (~3K input + ~500 output tokens).
 * Latencia: 10-30s por criterio según complejidad del repo.
 */

/**
 * Modelo canónico del verifier. Distinto del generator (Haiku 4.5). Override
 * con env var `DOD_VERIFIER_MODEL` para testing/cost optimization.
 */
const VERIFIER_MODEL = process.env.DOD_VERIFIER_MODEL ?? 'claude-sonnet-4-6';

/**
 * Timeout máximo per verifier call. El verifier es read-only y debería
 * terminar rápido — si excede esto, probablemente está atorado leyendo
 * archivos enormes. 90s da margen para repos medianos.
 */
const VERIFIER_TIMEOUT_MS = 90_000;

/**
 * Output máximo del verifier en bytes. El JSON final es pequeño (~500
 * bytes), pero capturamos hasta 50KB para tener el trail de razonamiento
 * en caso de parseo fallido para forensics.
 */
const MAX_OUTPUT_BYTES = 50_000;

export interface VerifierAgentVerdict {
  /** Pass/fail decidido por el verifier independiente */
  passed: boolean;
  /** Razón legible para humanos (también va al retry-prompt si fail) */
  reason: string;
  /** Paths de archivos que el verifier examinó como evidencia */
  evidencePaths: string[];
  /** Output raw del verifier (para forensics si el parseo falla) */
  rawOutput?: string;
  /** Razón técnica de un fallo del verifier mismo (no del criterio) */
  verifierError?: string;
  /** Token usage + cost del CLI claude (Anthropic Agent SDK cost-tracking spec).
   *  Solo presente cuando el verifier corrió con --output-format json y el
   *  wrapper JSON parseó OK. Ausente en errores tempranos (timeout, spawn fail,
   *  parse fail). */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    totalCostUsd: number;
    durationMs: number;
    apiDurationMs: number;
  };
}

/**
 * Shape del wrapper JSON que el CLI claude emite con `--output-format json`.
 * Confirmado contra la docs de Anthropic Agent SDK (cost-tracking page, 2026):
 * el SDK retorna un único objeto al cierre de la sesión con estos campos.
 *
 * Notas de robustez:
 *  - `total_cost_usd` puede venir como número o ausente — fallback a 0.
 *  - `usage` puede omitir cache fields si el modelo no usó cache — fallback a 0.
 *  - `result` es el texto que emitió el modelo (de donde extraemos el JSON
 *    verdict con extractJsonVerdict).
 */
interface ClaudeCliJsonOutput {
  type?: string;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  session_id?: string;
  is_error?: boolean;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Resuelve el binario `claude` del PATH. Mismo helper que runner.ts.
 */
function resolveClaudeBin(): string {
  return process.env.CLAUDE_BIN ?? 'claude';
}

/**
 * Construye el prompt del verifier agent. Diseñado siguiendo los principios
 * del research:
 *   - Persona explícita: "verificador independiente"
 *   - Sin contexto del generator (anonymization)
 *   - Outcome-based: usa tools para auditar el repo real
 *   - JSON output estructurado al final
 *   - Reglas duras contra sycophancy: "no confíes en commits/transcripts"
 */
function buildVerifierPrompt(input: {
  criterionText: string;
  criterionDescription: string;
  storyTitle: string;
  diffSummary: string;
  branch: string;
}): string {
  const { criterionText, criterionDescription, storyTitle, diffSummary, branch } = input;
  return [
    `# Verificador Independiente del DoD — CENZONTLE Forge`,
    ``,
    `Sos un agente de verificación INDEPENDIENTE. NO escribiste el código de esta historia. Tu único trabajo es validar OBJETIVAMENTE si el código entregado cumple UN CRITERIO ESPECÍFICO del Definition of Done — actuando con el criterio de un **Tech Lead senior** revisando un PR.`,
    ``,
    `## Reglas duras`,
    ``,
    `- ❌ **NO escribas código nuevo**. NO uses Edit ni Write. NO modifiques archivos.`,
    `- ❌ **NO confíes en commit messages** ni en archivos como \`.cenzontle-criteria.json\` (puede mentir el que los escribió).`,
    `- ❌ **NO entres en plan mode**. NO pidas aprobación. Ejecutá tu verificación directo.`,
    `- ✅ **SÍ podés explorar el repo** con Read, Grep, Glob, y Bash en modo read-only (ls, cat, git log, git diff, grep — NUNCA git push, rm, mv, etc.).`,
    `- ✅ **SÍ debés auditar el estado REAL del repo**. Lee los archivos modificados, examina sus contenidos, valida que efectivamente cumplen el criterio.`,
    `- ✅ **Tu output final** debe ser ÚNICAMENTE un JSON parseable, sin markdown wrapper, sin prosa antes ni después.`,
    ``,
    `## Story que se implementó`,
    ``,
    `**${storyTitle}**`,
    ``,
    `## Branch actual`,
    ``,
    `\`${branch}\``,
    ``,
    `## Cambios producidos por el generator (resumen)`,
    ``,
    `\`\`\``,
    diffSummary || '(sin diff disponible — el generator no produjo cambios)',
    `\`\`\``,
    ``,
    `## Criterio que debes verificar`,
    ``,
    `### ${criterionText}`,
    ``,
    criterionDescription,
    ``,
    `## Tu workflow (3 pasos en orden)`,
    ``,
    `### PASO 1 — Determinar APPLICABILITY`,
    ``,
    `Antes de auditar el repo, evalúa si el criterio APLICA al tipo de cambio que el generator hizo. Algunos criterios no aplican a ciertos tipos de stories — un Tech Lead razonable los consideraría N/A:`,
    ``,
    `- **Story solo crea/modifica documentación** (\`.md\`, \`.txt\`, READMEs, comments, archivos puramente declarativos): criterios como **"Tests pasando"**, **"Sin errores de lint/typecheck"**, **"Sin vulnerabilidades de seguridad"** típicamente NO APLICAN — no hay código ejecutable que testear, lint-ar, ni dependencias nuevas que escanear.`,
    `- **Story solo modifica configuración** (\`.json\` configs, \`.env.example\`, YAML CI) sin lógica nueva: ídem, esos criterios suelen ser N/A.`,
    `- **Story modifica código de producción** (\`.ts\`, \`.py\`, \`.js\`, \`.go\`, \`.rs\`, etc. con lógica): TODOS los criterios aplican y deben verificarse rigurosamente.`,
    `- **Criterio "Código escrito y funcional"** y **"Cumple criterios de aceptación"** siempre aplican.`,
    `- **Criterio "Documentación actualizada"** aplica solo si la story modificó APIs públicas, comportamiento de usuario, o flujos críticos. Stories triviales de tooling/CI suelen no requerir docs update.`,
    ``,
    `Si el criterio NO APLICA al tipo de cambio que ves en el diff, marcá \`passed: true\` con razón explícita del tipo: *"Criterio no aplicable a esta story: solo se creó un archivo .md sin código ejecutable. Sin código no hay tests/lint/security-scan a verificar — criterio satisfecho por construcción."* Un Tech Lead aprobaría un PR de docs sin pedir tests; vos también.`,
    ``,
    `### PASO 2 — AUDITAR (solo si el criterio aplica)`,
    ``,
    `Si el criterio SÍ APLICA, auditá el repo con Read/Grep/Bash:`,
    ``,
    `1. \`ls\` y \`git log --oneline -5\` para overview.`,
    `2. \`git diff HEAD~1\` para ver qué cambió REALMENTE.`,
    `3. Lee los archivos modificados con Read o \`cat\`. Buscá evidencia OBSERVABLE.`,
    `4. Si el criterio requiere ejecución (tests, lint), intentá correrlo: \`pnpm test\`, \`npm test\`, etc. — si exit 0, passed; si exit no-cero, failed.`,
    ``,
    `### PASO 3 — VERDICT`,
    ``,
    `- \`passed: true\` si: el criterio NO aplica al tipo de cambio (justificación clara), **O** el criterio aplica y se cumple con evidencia observable.`,
    `- \`passed: false\` si: el criterio aplica y NO se cumple, con razón específica de la deficiencia.`,
    ``,
    `**NO escribas el código que falta**. Solo identificá la deficiencia.`,
    ``,
    `## Output requerido — JSON único al final, sin texto adicional`,
    ``,
    `\`\`\`json`,
    `{`,
    `  "passed": true,`,
    `  "reason": "Razón clara y específica. Si N/A: 'Criterio no aplicable a esta story porque {X}'. Si aplicó y pasó: 'El archivo X.md existe (ls confirma) y contiene el formato pedido (cat muestra línea Y)'. Si aplicó y falló: 'El test foo.test.ts no existe en el repo aunque la story pedía cobertura'.",`,
    `  "evidence_paths": ["FORGE_TEST_2.md"]`,
    `}`,
    `\`\`\``,
    ``,
    `**EJECUTA INMEDIATAMENTE**. Cuando termines tu razonamiento, emití el JSON final.`,
  ].join('\n');
}

/**
 * Captura el diff de los cambios producidos por el generator. Usado como
 * contexto en el prompt del verifier — le da el resumen de qué auditar.
 * Falla silenciosamente con string vacío si git no responde.
 */
async function captureDiffSummary(workdir: string): Promise<string> {
  try {
    // git status --porcelain muestra working tree changes (lo que el
    // generator dejó sin commit). git log + diff captura commits hechos.
    const status = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workdir,
      env: {
        HOME: process.env.HOME ?? '',
        PATH: process.env.PATH ?? '',
      },
      maxBuffer: 1024 * 1024,
    });
    const log = await execFileAsync(
      'git',
      ['log', '--oneline', '--no-decorate', '-5'],
      {
        cwd: workdir,
        env: { HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '' },
        maxBuffer: 1024 * 1024,
      },
    );
    const diffStat = await execFileAsync(
      'git',
      ['diff', '--stat', 'HEAD~1', 'HEAD'],
      {
        cwd: workdir,
        env: { HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '' },
        maxBuffer: 1024 * 1024,
      },
    ).catch(() => ({ stdout: '' })); // OK si no hay HEAD~1
    return [
      '=== git status --porcelain (working tree) ===',
      status.stdout.trim() || '(clean working tree)',
      '',
      '=== git log -5 ===',
      log.stdout.trim() || '(no commits)',
      '',
      '=== git diff --stat HEAD~1 HEAD ===',
      diffStat.stdout.trim() || '(no diff)',
    ].join('\n');
  } catch {
    return '(no se pudo capturar diff summary)';
  }
}

/**
 * Extrae el JSON del output del verifier. claude con `-p` a veces emite
 * prosa antes o después del JSON a pesar de las instrucciones. Probamos
 * en orden:
 *   1. Output entero parseable como JSON
 *   2. Buscar el último bloque {...} balanceado en el output
 *   3. Buscar JSON dentro de un code fence \`\`\`json...\`\`\`
 *
 * Devuelve null si no puede parsear.
 */
function extractJsonVerdict(output: string): { passed: boolean; reason: string; evidence_paths?: string[] } | null {
  const trimmed = output.trim();

  // Caso 1: output entero es JSON válido
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.passed === 'boolean') {
      return parsed;
    }
  } catch {
    // continúa con siguiente método
  }

  // Caso 2: buscar bloque JSON en code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.passed === 'boolean') {
        return parsed;
      }
    } catch {
      // continúa
    }
  }

  // Caso 3: buscar el último bloque balanceado {...} en el texto
  // Esto cubre el caso "thinking + JSON al final sin code fence"
  const lastOpenBrace = trimmed.lastIndexOf('{');
  if (lastOpenBrace !== -1) {
    // Intenta parsear desde la última { hasta el final del string
    for (let end = trimmed.length; end > lastOpenBrace; end--) {
      const candidate = trimmed.slice(lastOpenBrace, end);
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === 'object' && parsed !== null && typeof parsed.passed === 'boolean') {
          return parsed;
        }
      } catch {
        // sigue probando
      }
    }
  }

  return null;
}

/**
 * Ejecuta el verifier agent contra un criterio. Spawn de claude separado
 * con modelo distinto del generator, sandboxed, output JSON estructurado.
 *
 * Si el verifier mismo falla (timeout, crash, output no parseable), retorna
 * `{ passed: false, verifierError }` para que el caller distinga "criterio
 * realmente no pasó" de "verifier broke" y maneje cada caso.
 */
export async function runVerifierAgent(input: {
  workdir: string;
  criterion: { text: string; description: string };
  storyTitle: string;
  branch: string;
  anthropicApiKey: string;
}): Promise<VerifierAgentVerdict> {
  const diffSummary = await captureDiffSummary(input.workdir);
  const prompt = buildVerifierPrompt({
    criterionText: input.criterion.text,
    criterionDescription: input.criterion.description,
    storyTitle: input.storyTitle,
    diffSummary,
    branch: input.branch,
  });

  // Sandbox wrap igual que el generator — denegar lecturas a credentials
  // del worker host. F-06 defense en deep.
  let sandboxed;
  try {
    sandboxed = wrapWithSandbox(
      resolveClaudeBin(),
      [
        '-p',
        prompt,
        '--dangerously-skip-permissions',
        '--permission-mode',
        'bypassPermissions',
        '--model',
        VERIFIER_MODEL,
        // `json` retorna un objeto único al cierre de la sesión con:
        //   - result (texto del modelo, donde está nuestro JSON verdict)
        //   - total_cost_usd (estimate client-side, para budgeting)
        //   - usage { input_tokens, output_tokens, cache_creation_input_tokens,
        //             cache_read_input_tokens }
        //   - duration_ms / duration_api_ms / num_turns / session_id
        // (Anthropic Agent SDK cost-tracking docs, 2026)
        '--output-format',
        'json',
      ],
      input.workdir,
    );
  } catch (err) {
    return {
      passed: false,
      reason: `Verifier agent setup falló (sandbox): ${(err as Error).message}`,
      evidencePaths: [],
      verifierError: 'sandbox.unavailable',
    };
  }
  const spawnStartedAt = Date.now();

  return new Promise<VerifierAgentVerdict>((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let timedOut = false;

    const child = spawn(sandboxed.bin, sandboxed.args, {
      cwd: input.workdir,
      env: {
        HOME: process.env.HOME ?? '',
        PATH: process.env.PATH ?? '',
        USER: process.env.USER ?? '',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        ANTHROPIC_API_KEY: input.anthropicApiKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 3000).unref();
      } catch {
        // ignore
      }
    }, VERIFIER_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf-8');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 10_000) {
        stderr += chunk.toString('utf-8');
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      resolve({
        passed: false,
        reason: `Verifier agent spawn error: ${err.message}`,
        evidencePaths: [],
        verifierError: 'spawn.error',
        rawOutput: stdout,
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeoutHandle);
      const measuredDurationMs = Date.now() - spawnStartedAt;

      if (timedOut) {
        logger.warn(
          { event: 'dod.verifier_agent.timeout', criterion: input.criterion.text, measuredDurationMs },
          'Verifier agent timeout',
        );
        return resolve({
          passed: false,
          reason: `Verifier agent excedió timeout de ${VERIFIER_TIMEOUT_MS / 1000}s. No se pudo verificar — probablemente repo grande o criterio ambiguo.`,
          evidencePaths: [],
          verifierError: 'timeout',
          rawOutput: stdout,
        });
      }

      if (exitCode !== 0) {
        logger.warn(
          {
            event: 'dod.verifier_agent.exit_nonzero',
            criterion: input.criterion.text,
            exitCode,
            measuredDurationMs,
            stderrTail: stderr.slice(-500),
          },
          `Verifier agent exit ${exitCode}`,
        );
        return resolve({
          passed: false,
          reason: `Verifier agent terminó con exit code ${exitCode}. Stderr: ${stderr.slice(-300)}`,
          evidencePaths: [],
          verifierError: `exit.${exitCode}`,
          rawOutput: stdout,
        });
      }

      // Con `--output-format json`, stdout es un único objeto JSON que contiene
      // tanto el output del modelo (campo `result`) como la metadata de usage
      // y costo. Anthropic Agent SDK cost-tracking spec — ver docs 2026.
      let cliJson: ClaudeCliJsonOutput;
      try {
        cliJson = JSON.parse(stdout.trim()) as ClaudeCliJsonOutput;
      } catch (err) {
        logger.warn(
          {
            event: 'dod.verifier_agent.wrapper_parse_fail',
            criterion: input.criterion.text,
            measuredDurationMs,
            err: (err as Error).message,
            stdoutHead: stdout.slice(0, 300),
            stdoutTail: stdout.slice(-300),
          },
          'Verifier agent output (CLI wrapper) no parseable — cambio de formato del CLI o spawn corrupto',
        );
        return resolve({
          passed: false,
          reason: `CLI wrapper JSON no parseable. Forensics tail: \`${stdout.slice(-300)}\``,
          evidencePaths: [],
          verifierError: 'cli_wrapper.parse.failed',
          rawOutput: stdout,
        });
      }

      // Captura el usage del wrapper ANTES de validar el verdict — queremos
      // los costos incluso si el JSON verdict del modelo está malformado
      // (igual pagamos los tokens).
      const usage = {
        inputTokens: cliJson.usage?.input_tokens ?? 0,
        outputTokens: cliJson.usage?.output_tokens ?? 0,
        cacheCreationInputTokens: cliJson.usage?.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: cliJson.usage?.cache_read_input_tokens ?? 0,
        totalCostUsd: cliJson.total_cost_usd ?? 0,
        durationMs: cliJson.duration_ms ?? measuredDurationMs,
        apiDurationMs: cliJson.duration_api_ms ?? 0,
      };

      // Log de cost-tracking — un log estructurado por criterio. El runner
      // suma todos los criterios de un run para el resumen final.
      logger.info(
        {
          event: 'dod.verifier_agent.usage',
          criterion: input.criterion.text,
          model: VERIFIER_MODEL,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          totalCostUsd: usage.totalCostUsd,
          durationMs: usage.durationMs,
          apiDurationMs: usage.apiDurationMs,
          numTurns: cliJson.num_turns,
          sessionId: cliJson.session_id,
        },
        `[verifier.cost] criterio="${input.criterion.text.slice(0, 50)}" tokens(in/out/cache_w/cache_r)=${usage.inputTokens}/${usage.outputTokens}/${usage.cacheCreationInputTokens}/${usage.cacheReadInputTokens} cost=$${usage.totalCostUsd.toFixed(4)} duration=${(usage.durationMs / 1000).toFixed(1)}s`,
      );

      // El verdict del modelo viene en cliJson.result (string). Aplicamos
      // extractJsonVerdict ahí (no a stdout completo — eso incluiría el
      // wrapper del CLI).
      const modelOutput = cliJson.result ?? '';
      const parsed = extractJsonVerdict(modelOutput);
      if (!parsed) {
        logger.warn(
          {
            event: 'dod.verifier_agent.verdict_parse_fail',
            criterion: input.criterion.text,
            modelOutputTail: modelOutput.slice(-500),
          },
          'Verifier agent emitió texto pero el JSON verdict no parseó',
        );
        return resolve({
          passed: false,
          reason: `Verifier agent emitió texto pero no JSON verdict parseable. Forensics: \`${modelOutput.slice(-300)}\``,
          evidencePaths: [],
          verifierError: 'verdict.parse.failed',
          rawOutput: stdout,
          usage, // → preservar tracking de costo aunque el verdict haya fallado
        });
      }

      logger.info(
        {
          event: 'dod.verifier_agent.verdict',
          criterion: input.criterion.text,
          passed: parsed.passed,
          model: VERIFIER_MODEL,
        },
        `Verifier agent verdict: ${parsed.passed ? 'PASSED' : 'FAILED'} — ${parsed.reason.slice(0, 100)}`,
      );

      resolve({
        passed: parsed.passed,
        reason: parsed.reason,
        evidencePaths: Array.isArray(parsed.evidence_paths) ? parsed.evidence_paths : [],
        rawOutput: stdout,
        usage,
      });
    });
  });
}
