import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { promises as fs } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { OrgAnthropicConfigService } from '../../org-anthropic-config/org-anthropic-config.service';
import { anthropicFetch } from '../../../lib/anthropic-fetch';
import {
  QaWorkspaceService,
  type PreparedWorkspace,
  type ServedApp,
} from './qa-workspace.service';
import {
  QA_MODELS,
  SECRET_PATTERNS,
  estimateSonnetCostUsd,
  QA_LENS_TIMEOUT_MS,
} from './qa-config';
import type { LensExecResult, LensTestSuiteResult, RawFinding } from './qa-types';

const MAX_DIFF_CHARS = 60_000;
const LATENCY_THRESHOLD_MS = 2000;

/**
 * Ejecuta los lentes de QA contra un workspace efímero ya preparado. Cada
 * método es independiente y devuelve un `LensExecResult` estructurado que el
 * orquestador persiste. Determinista donde se puede (tests, latencia, a11y,
 * secrets), aumentado con IA donde aporta (revisión de seguridad del diff).
 */
@Injectable()
export class QaLensRunnerService {
  constructor(
    private readonly workspace: QaWorkspaceService,
    private readonly orgAnthropic: OrgAnthropicConfigService,
    @InjectPinoLogger(QaLensRunnerService.name)
    private readonly logger: PinoLogger,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Lente: suite del repo
  // ──────────────────────────────────────────────────────────────────────
  async runTestSuite(ws: PreparedWorkspace, runId: string): Promise<LensExecResult> {
    if (!ws.installOk) {
      return this.lensFailed(
        'test_suite',
        'unit',
        'Dependencias no instaladas — no se puede ejecutar la suite',
        'medium',
      );
    }
    const testScript = await this.readScript(ws.workdir, 'test');
    if (!testScript) {
      // Sin script de test → no hay señal de suite (no es un fallo).
      return { status: 'completed', suite: null, findings: [], envUrl: null, errorMessage: null, usage: null };
    }
    try {
      const started = Date.now();
      const { stdout, stderr, exitCode } = await this.workspace.runCommand(
        ws.packageManager,
        ['run', 'test'],
        ws.workdir,
        QA_LENS_TIMEOUT_MS,
      );
      const durationMs = Date.now() - started;
      const out = `${stdout}\n${stderr}`;
      const suite = this.parseTestOutput(out, durationMs, exitCode);
      const findings: RawFinding[] = [];
      if (exitCode !== 0 || (suite && suite.failed > 0)) {
        findings.push({
          id: `test_suite-fail`,
          category: 'unit',
          title: `Suite del repo con fallos (exit ${exitCode}${suite ? `, ${suite.failed} fallidos` : ''})`,
          evidence: this.tail(out, 2500),
          severity: 'high',
        });
      }
      return { status: 'completed', suite, findings, envUrl: null, errorMessage: null, usage: null };
    } catch (err) {
      this.logger.warn(
        { event: 'qa.lens.test_suite.error', runId },
        `[qa:${runId}] suite del repo no ejecutó: ${(err as Error).message}`,
      );
      return {
        status: 'failed',
        suite: null,
        findings: [
          {
            id: 'test_suite-error',
            category: 'unit',
            title: 'No se pudo ejecutar la suite del repo',
            evidence: (err as Error).message.slice(0, 1000),
            severity: 'medium',
          },
        ],
        envUrl: null,
        errorMessage: (err as Error).message.slice(0, 500),
        usage: null,
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Lente: E2E contra entorno efímero
  // ──────────────────────────────────────────────────────────────────────
  async runE2e(ws: PreparedWorkspace, served: ServedApp | null): Promise<LensExecResult> {
    if (!ws.installOk) {
      return this.lensFailed('e2e', 'e2e', 'Dependencias no instaladas — no se puede levantar el app', 'high');
    }
    // El server efímero lo levanta el orquestador UNA sola vez y lo comparten
    // e2e y perf_a11y (evita dos dev servers en el mismo workdir corrompiéndose
    // el cache). Si no levantó, el app no bootea = fallo crítico.
    if (!served) {
      return this.lensFailed(
        'e2e',
        'e2e',
        'El app no levantó en el entorno efímero (build/serve falló)',
        'critical',
      );
    }
    const findings: RawFinding[] = [];
    let passed = 0;
    let failed = 0;
    let durationMs = 0;
    {
      // 1. Smoke: el home responde 200 y no es una página de error.
      const probe = await this.httpGet(served.url, 15_000);
      durationMs += probe.ms;
      if (probe.error || (probe.status ?? 0) >= 400) {
        failed++;
        findings.push({
          id: 'e2e-smoke',
          category: 'e2e',
          title: `El home no respondió OK (${probe.error ?? `HTTP ${probe.status}`})`,
          evidence: probe.error ?? `status=${probe.status}\n${this.tail(probe.body ?? '', 1500)}`,
          severity: 'critical',
        });
      } else if (this.looksLikeErrorPage(probe.body ?? '')) {
        failed++;
        findings.push({
          id: 'e2e-error-page',
          category: 'e2e',
          title: 'El home renderiza una página de error / pantalla en blanco',
          evidence: this.tail(probe.body ?? '', 1500),
          severity: 'high',
        });
      } else {
        passed++;
      }

      // 2. Si el repo trae suite e2e, córrela contra la URL viva. Resolvemos
      // el nombre del script UNA sola vez (un segundo readScript podría diferir
      // ante un error de FS transitorio y correr el script equivocado).
      const scriptName: 'test:e2e' | 'e2e' | null = (await this.readScript(ws.workdir, 'test:e2e'))
        ? 'test:e2e'
        : (await this.readScript(ws.workdir, 'e2e'))
          ? 'e2e'
          : null;
      if (scriptName) {
        const started = Date.now();
        const res = await this.workspace.runCommand(
          ws.packageManager,
          ['run', scriptName],
          ws.workdir,
          QA_LENS_TIMEOUT_MS,
        );
        durationMs += Date.now() - started;
        const out = `${res.stdout}\n${res.stderr}`;
        const parsed = this.parseTestOutput(out, durationMs, res.exitCode);
        if (parsed) {
          passed += parsed.passed;
          failed += parsed.failed;
        }
        if (res.exitCode !== 0 || (parsed && parsed.failed > 0)) {
          findings.push({
            id: 'e2e-suite',
            category: 'e2e',
            title: `Suite E2E del repo con fallos (exit ${res.exitCode})`,
            evidence: this.tail(out, 2500),
            severity: 'high',
          });
        }
      }
    }
    const total = passed + failed;
    const suite: LensTestSuiteResult = { total, passed, failed, skipped: 0, coverage: null, durationMs };
    return { status: 'completed', suite, findings, envUrl: served.url, errorMessage: null, usage: null };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Lente: escaneo de seguridad diferencial
  // ──────────────────────────────────────────────────────────────────────
  async runSecurityDiff(ws: PreparedWorkspace, runId: string): Promise<LensExecResult> {
    const diff = await this.computeMergeDiff(ws.workdir);
    if (diff === null) {
      // No silenciar: si no podemos computar el diff (p.ej. shallow clone sin
      // el primer-padre), reportamos un hallazgo en vez de un falso verde.
      return {
        status: 'completed',
        suite: null,
        findings: [
          {
            id: 'security-diff-unavailable',
            category: 'security',
            title: 'Escaneo de seguridad omitido — no se pudo computar el diff del batch',
            evidence:
              'El primer-padre del merge no está disponible localmente (clone shallow). Requiere revisión manual.',
            severity: 'medium',
          },
        ],
        envUrl: null,
        errorMessage: null,
        usage: null,
      };
    }
    const findings: RawFinding[] = [];

    // 1. Capa determinista: secrets en líneas agregadas.
    const addedLines = diff
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    let secretIdx = 0;
    for (const line of addedLines) {
      for (const { re, label } of SECRET_PATTERNS) {
        if (re.test(line)) {
          findings.push({
            id: `security-secret-${secretIdx++}`,
            category: 'security',
            title: `Posible ${label} hardcodeado en el diff`,
            evidence: line.slice(0, 300),
            severity: 'critical',
          });
        }
      }
    }

    // 2. Capa IA: revisión de seguridad del diff (estilo /security-review).
    let usage: LensExecResult['usage'] = null;
    try {
      const review = await this.aiSecurityReview(diff.slice(0, MAX_DIFF_CHARS));
      findings.push(...review.findings);
      usage = review.usage;
    } catch (err) {
      this.logger.warn(
        { event: 'qa.lens.security.ai_failed', runId },
        `[qa:${runId}] revisión IA de seguridad falló (non-fatal): ${(err as Error).message}`,
      );
    }
    return { status: 'completed', suite: null, findings, envUrl: null, errorMessage: null, usage };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Lente: performance + accesibilidad
  // ──────────────────────────────────────────────────────────────────────
  async runPerfA11y(ws: PreparedWorkspace, served: ServedApp | null): Promise<LensExecResult> {
    if (!ws.installOk) {
      return this.lensFailed('perf_a11y', 'performance', 'Dependencias no instaladas', 'medium');
    }
    // Comparte el server efímero con el lente e2e (lo levanta el orquestador).
    if (!served) {
      return this.lensFailed('perf_a11y', 'performance', 'El app no levantó para medir perf/a11y', 'high');
    }
    const findings: RawFinding[] = [];
    let passed = 0;
    let failed = 0;
    {
      // Perf: latencia mediana de 5 requests al home.
      const samples: number[] = [];
      let html = '';
      for (let i = 0; i < 5; i++) {
        const r = await this.httpGet(served.url, 15_000);
        if (!r.error && (r.status ?? 0) < 500) {
          samples.push(r.ms);
          if (r.body) html = r.body;
        }
      }
      if (samples.length > 0) {
        const median = samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
        if (median > LATENCY_THRESHOLD_MS) {
          failed++;
          findings.push({
            id: 'perf-latency',
            category: 'performance',
            title: `Latencia alta del home (mediana ${median}ms > ${LATENCY_THRESHOLD_MS}ms)`,
            evidence: `Muestras (ms): ${samples.join(', ')}`,
            severity: 'medium',
          });
        } else {
          passed++;
        }
      }

      // A11y: heurísticas sobre el HTML servido (sin browser).
      const a11y = this.checkA11y(html);
      passed += a11y.passed;
      failed += a11y.failed;
      findings.push(...a11y.findings);
    }
    const total = passed + failed;
    const suite: LensTestSuiteResult = { total, passed, failed, skipped: 0, coverage: null, durationMs: 0 };
    return { status: 'completed', suite, findings, envUrl: served.url, errorMessage: null, usage: null };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  private lensFailed(
    idPrefix: string,
    category: RawFinding['category'],
    title: string,
    severity: RawFinding['severity'],
  ): LensExecResult {
    return {
      status: 'failed',
      suite: null,
      findings: [{ id: `${idPrefix}-failed`, category, title, evidence: title, severity }],
      envUrl: null,
      errorMessage: title,
      usage: null,
    };
  }

  private async readScript(workdir: string, name: string): Promise<string | null> {
    try {
      const pkg = JSON.parse(await fs.readFile(join(workdir, 'package.json'), 'utf-8'));
      const s = pkg?.scripts?.[name];
      return typeof s === 'string' && s.length > 0 ? s : null;
    } catch {
      return null;
    }
  }

  /** Parser genérico de salida jest/vitest. Extrae conteos por token. */
  private parseTestOutput(
    output: string,
    durationMs: number,
    exitCode: number,
  ): LensTestSuiteResult | null {
    const passedM = output.match(/(\d+)\s+passed/i);
    const failedM = output.match(/(\d+)\s+failed/i);
    const skippedM = output.match(/(\d+)\s+(?:skipped|todo|pending)/i);
    const coverageM = output.match(/All files\s*\|\s*([\d.]+)/);
    const passed = passedM ? parseInt(passedM[1], 10) : 0;
    const failed = failedM ? parseInt(failedM[1], 10) : 0;
    const skipped = skippedM ? parseInt(skippedM[1], 10) : 0;
    const total = passed + failed + skipped;
    if (total === 0) {
      // Sin conteo parseable: exit 0 → null (no fingir "1/1 passed" — cero
      // tests no es lo mismo que tests pasando). Exit !=0 → sintetiza un fallo
      // para no perder la señal de que el comando falló.
      return exitCode === 0
        ? null
        : { total: 1, passed: 0, failed: 1, skipped: 0, coverage: null, durationMs };
    }
    return {
      total,
      passed,
      failed,
      skipped,
      coverage: coverageM ? parseFloat(coverageM[1]) : null,
      durationMs,
    };
  }

  private looksLikeErrorPage(body: string): boolean {
    if (body.trim().length === 0) return true;
    const lower = body.toLowerCase();
    return (
      lower.includes('internal server error') ||
      lower.includes('application error') ||
      lower.includes('cannot get /') ||
      lower.includes('unhandledrejection') ||
      /<pre[^>]*>[^<]*error[^<]*at\s/i.test(body)
    );
  }

  private checkA11y(html: string): { passed: number; failed: number; findings: RawFinding[] } {
    const findings: RawFinding[] = [];
    let passed = 0;
    let failed = 0;
    if (!html) return { passed: 0, failed: 0, findings };

    // lang en <html>
    if (/<html[^>]*\blang\s*=/.test(html)) passed++;
    else {
      failed++;
      findings.push({
        id: 'a11y-lang',
        category: 'accessibility',
        title: 'Falta atributo lang en <html>',
        evidence: 'No se encontró <html lang="...">',
        severity: 'low',
      });
    }
    // <title>
    if (/<title>[^<]+<\/title>/.test(html)) passed++;
    else {
      failed++;
      findings.push({
        id: 'a11y-title',
        category: 'accessibility',
        title: 'Falta <title> con contenido',
        evidence: 'No se encontró <title>...</title>',
        severity: 'low',
      });
    }
    // <img> sin alt
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    const imgsSinAlt = imgs.filter((t) => !/\balt\s*=/.test(t));
    if (imgs.length === 0 || imgsSinAlt.length === 0) {
      passed++;
    } else {
      failed++;
      findings.push({
        id: 'a11y-img-alt',
        category: 'accessibility',
        title: `${imgsSinAlt.length}/${imgs.length} <img> sin atributo alt`,
        evidence: imgsSinAlt.slice(0, 3).join('\n').slice(0, 500),
        severity: 'low',
      });
    }
    return { passed, failed, findings };
  }

  /** Diff de la merge (primer-padre) o del último commit, en el workdir. */
  private async computeMergeDiff(workdir: string): Promise<string | null> {
    for (const range of ['HEAD^1', 'HEAD~1']) {
      try {
        const { stdout } = await this.workspace.runCommand(
          'git',
          ['diff', `${range}..HEAD`],
          workdir,
          60_000,
        );
        if (stdout.trim().length > 0) return stdout;
      } catch {
        /* prueba el siguiente rango */
      }
    }
    return null;
  }

  private async aiSecurityReview(
    diff: string,
  ): Promise<{ findings: RawFinding[]; usage: LensExecResult['usage'] }> {
    if (diff.trim().length === 0) return { findings: [], usage: null };
    const apiKey = await this.orgAnthropic.getApiKeyPlaintext();
    const client = new Anthropic({ apiKey, fetch: anthropicFetch });
    const prompt =
      `Eres un revisor de seguridad. Analiza SOLO el siguiente diff (líneas + agregadas) ` +
      `en busca de vulnerabilidades REALES introducidas por el cambio: inyección (SQL/cmd/XSS), ` +
      `fallas de authz/authn, secrets hardcodeados, deserialización insegura, path traversal, SSRF.\n\n` +
      `Responde SOLO un array JSON. Cada item: {"title": string, "severity": "critical"|"high"|"medium"|"low", "evidence": string}. ` +
      `Si no hay vulnerabilidades reales, responde []. No inventes problemas teóricos sin evidencia en el diff.\n\n` +
      `Diff:\n\`\`\`diff\n${diff}\n\`\`\``;
    const response = await client.messages.create({
      model: QA_MODELS.security,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    const text = block && block.type === 'text' ? block.text : '[]';
    const usage = {
      totalCostUsd: estimateSonnetCostUsd(response.usage.input_tokens, response.usage.output_tokens),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    const findings = this.parseSecurityFindings(text);
    return { findings, usage };
  }

  private parseSecurityFindings(text: string): RawFinding[] {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return [];
    let arr: unknown;
    try {
      arr = JSON.parse(text.slice(start, end + 1));
    } catch {
      return [];
    }
    if (!Array.isArray(arr)) return [];
    const valid = new Set(['critical', 'high', 'medium', 'low']);
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x, i) => {
        const sev = typeof x.severity === 'string' && valid.has(x.severity) ? x.severity : 'medium';
        return {
          id: `security-ai-${i}`,
          category: 'security' as const,
          title: typeof x.title === 'string' ? x.title.slice(0, 200) : 'Hallazgo de seguridad',
          evidence: typeof x.evidence === 'string' ? x.evidence.slice(0, 1500) : '',
          severity: sev as RawFinding['severity'],
        };
      });
  }

  private async httpGet(
    url: string,
    timeoutMs: number,
  ): Promise<{ status?: number; body?: string; ms: number; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(url, { signal: controller.signal });
      const body = await res.text();
      return { status: res.status, body, ms: Date.now() - started };
    } catch (err) {
      return { ms: Date.now() - started, error: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  private tail(s: string, n: number): string {
    return s.length <= n ? s : s.slice(s.length - n);
  }
}
