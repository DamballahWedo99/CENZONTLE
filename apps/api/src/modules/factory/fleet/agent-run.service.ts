import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import {
  AGENT_RUN_ACTIVE_STATUSES,
  AGENT_RUN_TERMINAL_STATUSES,
  type AgentRunStatus,
  type ClaimedStory,
  type ExternalSecretForWorker,
} from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgAnthropicConfigService } from '../../org-anthropic-config/org-anthropic-config.service';
import { ForgePromptBuilderService } from './forge-prompt-builder.service';
import { GitHubService } from '../github/github.service';
import { DodService } from '../dod/dod.service';
import { ConflictResolverService } from './conflict-resolver.service';
import { ForgePlannerService } from './forge-planner.service';
import { AgentTokenSettingsService } from '../../agent-token-settings/agent-token-settings.service';
import { StoriesService } from '../../proyectos/stories/stories.service';
import { ExternalSecretsService } from '../../external-secrets/external-secrets.service';
import { VaultService } from '../../vault/vault.service';
import { computeRunStats } from '../queue/run-stats';
import { classifySecretDependencies } from './secret-deps';
import { RunProgressDto } from './dto/run-progress.dto';
import { RunCompleteDto } from './dto/run-complete.dto';

// Re-exporta para compat con callers que importaban desde aquí.
export type { ClaimedStory } from '@cenzontle/shared';

/**
 * Threshold ms — un AgentRun sin progress por más tiempo que esto se marca
 * `abandoned`. 10 min es generoso: una historia compleja en Claude Code rara
 * vez tarda más de 5min, pero hay headroom para historias arquitecturales.
 */
const STALE_RUN_MS = 10 * 60 * 1000;

/**
 * SEC (security-reviewer 2026-05-22, Finding 2 / CWE-601, CWE-1021):
 *
 * Valida que una URL de ttyd reportada por un worker apunte a un host
 * INTERNO. El frontend embebe ese valor en `<iframe src>`; un worker
 * comprometido podía reportar `http://attacker.com/…` y conseguir phishing
 * dentro del panel del dashboard. El `@IsUrl` del DTO ya bloquea schemes
 * peligrosos (`javascript:`, `data:`, `file:`); esta función es la segunda
 * barrera — bloquea hosts EXTERNOS antes de persistir.
 *
 * Allowlist (case-insensitive):
 *   - localhost / 127.0.0.0/8 / ::1 (loopback IPv4 e IPv6)
 *   - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918)
 *   - 169.254.0.0/16, fe80::/10 (link-local)
 *   - fc00::/7 (IPv6 unique local)
 *
 * Cualquier otro host (FQDN público, IP pública) → rechazado.
 */
function isInternalTtydUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // URL.hostname devuelve IPv6 con o sin brackets según el runtime — normalizar.
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  // localhost + IPv4/IPv6 loopback
  if (host === 'localhost' || host === '0.0.0.0') return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // IPv4 RFC 1918
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // IPv4 link-local (169.254.0.0/16)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // IPv6 link-local (fe80::/10) — primer nibble del 2° byte ∈ {8, 9, a, b}
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // IPv6 unique local (fc00::/7) — primer byte fc o fd
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  return false;
}

/**
 * Result type del raw SQL de claim. Una historia reclamada (o null si no hay
 * nada claimable). Los campos coinciden con el RETURNING del UPDATE.
 */
interface ClaimedStoryRow {
  id: string;
  epicId: string;
  title: string;
  podId: string;
}

/**
 * Shape interno del retorno de `materializeClaim` — incluye todos los
 * datos crudos para construir el `ClaimedStory` final FUERA del
 * $transaction. `storyVaultPath`, `epicTitle`, `epicMarkdown` se exponen
 * acá porque el caller los necesita para `readStoryContent` + `buildStoryPrompt`
 * después del commit (qa+arch-reviewer 2026-05-12: HTTP calls fuera del lock).
 */
interface MaterializedClaim {
  runId: string;
  storyId: string;
  storyTitle: string;
  storyVaultPath: string | null;
  epicId: string;
  epicTitle: string;
  epicMarkdown: string;
  /**
   * Diagrama de negocio de la épica serializado a texto legible para el
   * agente. Toma el primer diagrama type='business' de `epic.diagrams` y
   * lo formatea como lista numerada de pasos (si el diagrama tiene `steps`)
   * o como descripción de nodos+edges (fallback). NULL si la épica no tiene
   * diagrama de negocio.
   *
   * Sin esto, el agente improvisa la arquitectura del flujo en lugar de
   * seguir el diseño aprobado por el equipo en story-gen.
   */
  epicBusinessDiagram: string | null;
  /**
   * Contexto del DAG — stories del MISMO epic que ya completaron antes que
   * esta story arrancara. La integration branch del Forge ya tiene los
   * commits de estas stories (via auto-merge post-completion), por lo que
   * sus archivos están materializados en el workdir del worker. El backend
   * inyecta esta lista al prompt para que el agente:
   *   1. Sepa explícitamente cuáles stories existieron (no solo via ls).
   *   2. Lea los archivos que produjeron ANTES de implementar (respeta
   *      contratos previos, evita duplicación tipo epic 9311b334 donde
   *      README re-creó API.md desde cero).
   *   3. Distinga hard-deps (críticas, definidas en StoryDependency) de
   *      siblings (informativas, completaron en el mismo epic).
   *
   * Ordenadas por completedAt DESC (más recientes primero) — facilita
   * prioridad cuando hay muchas siblings.
   */
  completedSiblings: Array<{
    storyId: string;
    title: string;
    /** True si esta story es hard-dep directa de la story actual
     *  (existe StoryDependency con hardness='hard'). El prompt las
     *  resalta como "OBLIGATORIO leer estos archivos". */
    isHardDep: boolean;
    prNumber: number | null;
    filesModified: number | null;
    /** Paths relativos producidos por esta story. Vacío si el run legacy
     *  (pre-migration 20260515000000) — el agente sabe igual que la story
     *  existió pero no qué archivos tocó. */
    filesModifiedPaths: string[];
    completedAt: string;
  }>;
  branch: string;
  repoUrl: string | null;
  baseBranch: string | null;
  anthropicApiKey: string;
  /**
   * Todos los `ExternalSecret` de la org, desencriptados — se forwardean al
   * worker en el `ClaimedStory`. Cargados con el client propio de
   * `ExternalSecretsService` (NO `tx`): es un READ de otra tabla que no
   * afecta la atomicidad del INSERT de `agent_runs`. Array vacío válido
   * (org sin secrets registrados) — NO es un campo crítico del payload.
   */
  externalSecrets: ExternalSecretForWorker[];
  /**
   * Dependencias técnicas de la historia que requieren credencial, son
   * BLOQUEANTES (`isBlocking`) y NO tienen secret vinculado
   * (`linkedSecretId == null`). Si la lista no está vacía, el caller
   * `claimStory` rechaza el claim y escala la historia a `blocked` — el
   * agente no puede implementar contra una credencial inexistente.
   */
  blockingSecretGaps: Array<{ vendor: string | null; title: string }>;
  dodCriteria: Array<{ kind: string | null; text: string; description: string }>;
  /** Modelo + effort del Forge Worker (coder agent CLI). Leído del singleton
   *  AgentTokenSettings — configurable desde /factory/settings → Factory.
   *  Pasados al worker en la response del claim para que reemplacen las env
   *  vars del worker (que quedan como fallback legacy). */
  forgeWorkerModel: string;
  forgeWorkerEffort: string;
  /** Max wall-clock duration (ms) que el worker espera al CLI antes de matar
   *  el proceso. Default backend 1_800_000 (30 min). Configurable desde
   *  /factory/settings → tab Factory. Reemplaza el MAX_RUN_DURATION_MS
   *  hardcoded del runner.ts. Si llega null/0/undefined, el worker cae al
   *  default local 30 min como red de seguridad. */
  forgeWorkerMaxRunDurationMs: number;
  /** Modelo + effort del DoD Verifier (reviewer agent CLI). Mismo patrón. */
  dodVerifierModel: string;
  dodVerifierEffort: string;
  /** Tope de intentos del DoD enforcement loop del worker (singleton
   *  AgentTokenSettings → tab Factory). 1 = una sola pasada. */
  dodMaxAttempts: number;
}

/**
 * Sentinel exception lanzada DESDE DENTRO del `$transaction` cuando el
 * INSERT de agent_runs colisiona con el unique `[storyId, status]` (race
 * extremadamente improbable porque el FOR UPDATE SKIP LOCKED ya garantiza
 * exclusión, pero la red de seguridad existe).
 *
 * Lanzar esto fuerza a Prisma a rollback el tx (incluyendo el `claimedAt`).
 * El caller la captura DESPUÉS del `$transaction` y devuelve `null` para
 * que el controller responda 204 (no era nuestro turno).
 */
class AgentRunRaceError extends Error {
  constructor() {
    super('AgentRun unique constraint hit — concurrent claim won');
    this.name = 'AgentRunRaceError';
  }
}

/**
 * Defense-in-depth (security-reviewer F-12 2026-05-06): aunque el worker
 * ya redacta antes de enviar (`runner.ts:appendToBuffer`), un worker
 * comprometido podría saltarse esa capa. El backend NO confía en la
 * higiene del worker — aplicamos la misma redacción al persistir
 * `lastOutput`/`errorMessage`. Si el worker es honesto, la redacción es
 * idempotente (no hay match porque ya viene `[REDACTED]`); si es
 * malicioso, capturamos el secreto antes de DB.
 *
 * Mantener este set ALINEADO con `apps/worker/src/lib/runner.ts:REDACTION_PATTERNS`.
 * Sprint 3 mover a `packages/shared/security/redact.ts`.
 */
const SERVER_REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[a-zA-Z0-9_-]+/g, 'sk-ant-[REDACTED]'],
  [/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-[REDACTED]'],
  [/sk_live_[a-zA-Z0-9]{20,}/g, 'sk_live_[REDACTED]'],
  [/rk_live_[a-zA-Z0-9]{20,}/g, 'rk_live_[REDACTED]'],
  [/ghp_[A-Za-z0-9]{30,}/g, 'ghp_[REDACTED]'],
  [/github_pat_[A-Za-z0-9_]{22,}/g, 'github_pat_[REDACTED]'],
  [/gho_[A-Za-z0-9]{30,}/g, 'gho_[REDACTED]'],
  [/ghs_[A-Za-z0-9]{30,}/g, 'ghs_[REDACTED]'],
  [/glpat-[A-Za-z0-9_-]{20,}/g, 'glpat-[REDACTED]'],
  [/(AKIA|ASIA)[A-Z0-9]{16}/g, '[AWS_ACCESS_KEY_REDACTED]'],
  [/xox[abposr]-[A-Za-z0-9-]{10,}/g, 'xox[REDACTED]'],
  [/AIza[0-9A-Za-z_-]{35}/g, 'AIza[REDACTED]'],
  [/x-access-token:[^@\s]+@/g, 'x-access-token:[REDACTED]@'],
  [/(https?|postgres|postgresql|mongodb|redis|amqp|mysql):\/\/[^:\s]+:[^@\s]+@/g, '$1://[CREDS_REDACTED]@'],
  [/worker_[a-z2-7]{20,}/g, 'worker_[REDACTED]'],
  [/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]'],
];

function redactServerSide(
  text: string | undefined | null,
  secretValues: readonly string[] = [],
): string | undefined {
  if (text == null) return undefined;
  let out = text;
  // Pasada 1 — valores exactos de los secretos externos del org. Los
  // secretos de terceros (Amadeus/Twilio/etc.) tienen formato arbitrario y
  // no matchean los patrones por prefijo de abajo: hay que redactar por el
  // valor literal. Solo valores >= 8 chars — uno más corto sobre-redactaría.
  // `split`/`join` = reemplazo literal del substring (sin interpretación regex).
  for (const value of secretValues) {
    if (value.length >= 8) {
      out = out.split(value).join('[REDACTED]');
    }
  }
  // Pasada 2 — patrones por prefijo (claves con formato conocido).
  for (const [pattern, replacement] of SERVER_REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Service que maneja el lifecycle de AgentRun (claim → progress → complete/abandon).
 *
 * Separado de FleetService para mantener este último enfocado en CRUD de
 * nodos y registration. AgentRunService es donde vive la lógica de
 * scheduling distribuido (atomicidad de claim, sweeper de runs huérfanos,
 * forwarding de API key).
 */
@Injectable()
export class AgentRunService {
  /**
   * Mutex per integration branch para serializar auto-merges concurrentes
   * (defensa en profundidad — capa 1 de 2).
   *
   * Problema diagnosticado 2026-05-13: cuando dos stories de la misma wave
   * terminan al mismo tiempo (~30s ± 1s con Haiku 4.5), ambas llaman
   * `mergePullRequest()` casi simultáneamente al MISMO integration branch.
   * GitHub serializa los merges con un lock pessimista per-target-branch, así
   * que SOLO uno gana — el otro recibe `merged: false` con conflict, y la
   * story queda en `in_review` aunque su DoD pasó.
   *
   * El mutex encadena promises por branch name: `Map<branch, Promise>`.
   * Cada nueva llamada a `withMergeLock` espera a que termine la anterior
   * antes de invocar su closure. Cleanup automático cuando la chain termina.
   *
   * Combinado con `mergeWithRetry` (capa 2), cubre tanto races internos
   * (mismo backend process) como externos (humano mergea concurrente, otra
   * replica en multi-instance, GitHub rate limit que causa merged=false).
   */
  private mergeChain = new Map<string, Promise<unknown>>();

  /**
   * Contador per-branch del número de stories esperando en `withMergeLock`.
   * Cada entry sostiene su closure (runId, prNumber, commitTitle/Message) hasta
   * que llega su turno — para waves grandes (~20+ stories paralelas) la
   * memoria pico crece linealmente. NO es un leak permanente (todas liberan
   * cuando termina la wave), pero un crecimiento sostenido sin liberarse
   * indica un problema (entry hung, deadlock, GitHub API down). El log
   * warning cuando excede `QUEUE_WARN_THRESHOLD` permite alertar en
   * observabilidad. qa-reviewer WARN 2026-05-15.
   */
  private mergeChainDepth = new Map<string, number>();

  /**
   * Threshold para warning del depth de la chain. Una wave típica tiene
   * <10 stories paralelas — alcanzar 8 indica load alto pero aún esperado.
   * Sostenido >>8 alerta de problema operacional.
   */
  private static readonly MERGE_CHAIN_WARN_THRESHOLD = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAnthropicConfig: OrgAnthropicConfigService,
    private readonly externalSecrets: ExternalSecretsService,
    private readonly promptBuilder: ForgePromptBuilderService,
    private readonly github: GitHubService,
    private readonly dod: DodService,
    private readonly stories: StoriesService,
    private readonly conflictResolver: ConflictResolverService,
    private readonly planner: ForgePlannerService,
    private readonly agentTokens: AgentTokenSettingsService,
    private readonly vault: VaultService,
    // Logger general del service. Para logs del context engineering
    // específicamente, usamos `forgeClaimLogger` con namespace separado
    // que produce eventos `forge.claim.*` queryables en Loki/Grafana.
    @InjectPinoLogger(AgentRunService.name)
    private readonly logger: PinoLogger,
    @InjectPinoLogger('forge.claim')
    private readonly forgeClaimLogger: PinoLogger,
  ) {}

  /**
   * Serializa la ejecución de `fn` por `branch` — cualquier otra llamada a
   * `withMergeLock` con el mismo branch espera a que esta termine antes de
   * arrancar. Implementación in-memory; si en prod hay multi-replica, este
   * mutex NO sincroniza cross-instance — el retry de mergeWithRetry compensa.
   */
  private async withMergeLock<T>(branch: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.mergeChain.get(branch) ?? Promise.resolve();
    // `.catch()` swallow errors del anterior — la chain no debe romperse por
    // un fallo previo, solo serializa el orden de ejecución.
    const newChain = previous.catch(() => undefined).then(fn);
    this.mergeChain.set(branch, newChain);

    // Tracking de queue depth para observabilidad. Cada `withMergeLock` corre
    // mientras espera su turno, sosteniendo su closure (~kbs por entry). Para
    // waves chicas (<8) es despreciable; sostenido alto indica problema
    // operacional (entry hung, deadlock, GitHub API down).
    const depthAfterInsert = (this.mergeChainDepth.get(branch) ?? 0) + 1;
    this.mergeChainDepth.set(branch, depthAfterInsert);
    if (depthAfterInsert >= AgentRunService.MERGE_CHAIN_WARN_THRESHOLD) {
      this.logger.warn(
        {
          event: 'fleet.merge_chain.high_depth',
          branch,
          depth: depthAfterInsert,
          threshold: AgentRunService.MERGE_CHAIN_WARN_THRESHOLD,
        },
        `mergeChain depth elevado: ${depthAfterInsert} stories esperando lock en branch=${branch}. ` +
          `Cada entry sostiene su closure (runId/prNumber/etc) hasta su turn — ` +
          `memoria pico crece linealmente. Sostenido alto sugiere stories hung en el lock o load anómalo.`,
      );
    }

    try {
      return await newChain;
    } finally {
      // Cleanup del depth counter (siempre decrementa, incluso si fn throw).
      const depthAfterRemove = (this.mergeChainDepth.get(branch) ?? 1) - 1;
      if (depthAfterRemove <= 0) {
        this.mergeChainDepth.delete(branch);
      } else {
        this.mergeChainDepth.set(branch, depthAfterRemove);
      }
      // Cleanup del chain ref: solo eliminar si nadie se enqueueó después de mí.
      if (this.mergeChain.get(branch) === newChain) {
        this.mergeChain.delete(branch);
      }
    }
  }

  /**
   * Retry con backoff exponencial para `mergePullRequest` (defensa en
   * profundidad — capa 2 de 2). Cubre fallas residuales que el mutex no
   * puede prevenir:
   *  - Multi-replica del backend (sin Redis lock cross-instance)
   *  - Race con merges externos (humano mergea PR via GitHub UI)
   *  - GitHub rate limit transient
   *  - `merged: false` por sync delay en GitHub (head SHA no advanced aún)
   *
   * Retries: 3 attempts con sleep 1s, 2s, 4s (exponential backoff). Si los
   * 3 fallan, propaga el último error al caller (que cae a 'in_review').
   */
  /**
   * Alinea el HEAD branch del PR con su base actualizado ANTES del merge.
   *
   * Motivación (2026-05-15): stories paralelas de la misma wave clonan del
   * integration branch en T0. La primera mergea OK y avanza el integration
   * a T1. Las siguientes intentan mergear su head (todavía en T0) → GitHub
   * responde "merge conflicts" aunque no haya overlap real de archivos. El
   * `mergeWithRetry` reintentaba el merge 3 veces idénticamente, fallando
   * idénticamente — el conflict no es transient.
   *
   * Esta función llama `pulls.updateBranch` (equivalente al click "Update
   * branch" en GitHub UI) que mergea el base dentro del head. Si los archivos
   * no overlap, GitHub auto-resuelve y el siguiente merge es fast-forward.
   * Si overlap real, throw inmediato (caller cae a in_review).
   *
   * Retry policy diferencial:
   *  - 5xx, network, rate limit → reintenta hasta MAX_ATTEMPTS con backoff.
   *  - 422 conflict real (`isMergeConflict=true`) → throw inmediato, NO
   *    retry. El conflict es persistente, esperar no lo resuelve.
   *  - 4xx no-conflict (permisos, etc.) → throw inmediato.
   *
   * DEBE llamarse DENTRO del `withMergeLock` para que la operación
   * (update + merge) sea atómica per integration branch — sin el lock, otra
   * story podría mergear entre nuestro update y nuestro merge, dejando el
   * head stale de nuevo.
   */
  private async updateBranchToBaseWithRetry(
    runId: string,
    prNumber: number,
  ): Promise<void> {
    const MAX_ATTEMPTS = 3;
    const BACKOFF_MS = [1000, 2000, 4000];
    let lastErr: Error = new Error('unreachable');
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.github.updatePullRequestBranch(prNumber);
        if (attempt > 1) {
          this.logger.info(
            `[run:${runId}] updateBranch.retry.success: PR #${prNumber} alineado con base en attempt ${attempt}/${MAX_ATTEMPTS}: ${result.message}`,
          );
        } else {
          this.logger.info(
            `[run:${runId}] updateBranch.ok: PR #${prNumber} alineado con base: ${result.message}`,
          );
        }
        // Post-updateBranch: poll mergeable_state hasta resuelto ANTES de
        // permitir que el caller invoque mergeWithRetry. updateBranch retorna
        // 202 (Accepted, async) — GitHub encola el merge interno y no
        // actualiza el SHA del head inmediatamente. Si mergeWithRetry corre
        // con head stale, falla con "merge conflicts" aunque updateBranch
        // hubiera resuelto el problema. El poll detecta propagación completa
        // (mergeable_state in clean/unstable/has_hooks) o failure terminal
        // (dirty=conflict real post-update, blocked=branch protection,
        // draft=no mergeable). qa-reviewer HIGH 2026-05-15: sin esto, el
        // primer attempt de mergeWithRetry (zero delay) corría con state
        // pre-propagación y el race ahí era real.
        await this.pollMergeableStateAfterUpdate(runId, prNumber);
        return;
      } catch (err) {
        lastErr = err as Error;
        const isConflict = (err as Error & { isMergeConflict?: boolean }).isMergeConflict === true;
        if (isConflict) {
          // Conflict real (archivos overlap). NO retry — el conflict es
          // persistente, esperar no lo resuelve. Throw inmediato para que
          // el caller caiga a `in_review` con razón clara.
          this.logger.warn(
            `[run:${runId}] updateBranch.conflict: PR #${prNumber} tiene conflict real de archivos. ` +
              `Skipeando retries (conflict no es transient). Story → in_review.`,
          );
          throw lastErr;
        }
        if (attempt === MAX_ATTEMPTS) {
          this.logger.error(
            `[run:${runId}] updateBranch.retry.exhausted: PR #${prNumber} falló los ${MAX_ATTEMPTS} attempts. ` +
              `Último error: ${lastErr.message}`,
          );
          throw lastErr;
        }
        const sleepMs = BACKOFF_MS[attempt - 1];
        this.logger.warn(
          `[run:${runId}] updateBranch.retry: PR #${prNumber} attempt ${attempt}/${MAX_ATTEMPTS} failed ` +
            `(${lastErr.message}). Sleeping ${sleepMs}ms antes de reintentar...`,
        );
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }
    throw lastErr;
  }

  /**
   * Polls `pulls.get` hasta que GitHub confirme que `mergeable_state` está
   * resuelto post-`updateBranch`. Necesario porque `pulls.updateBranch`
   * retorna 202 Accepted (operación async encolada), no 200 Done — el SHA
   * del head no se actualiza inmediatamente y `mergeWithRetry` corriendo
   * con state stale falla con "merge conflicts" aunque el update hubiera
   * resuelto el problema.
   *
   * Outcomes:
   *  - `mergeable_state in {clean, unstable, has_hooks}`: ready, return.
   *  - `mergeable_state === 'dirty'`: conflict REAL post-update (raro pero
   *    posible si race con commit out-of-band). Throw isMergeConflict.
   *  - `mergeable_state in {blocked, draft}`: state terminal no recuperable
   *    (branch protection, PR en draft). Throw sin isMergeConflict (no es
   *    conflict de archivos pero tampoco transient — caller cae a in_review).
   *  - `mergeable_state in {unknown, behind} | null`: continue polling.
   *  - Timeout (POLL_MAX × POLL_INTERVAL_MS = 5s): log warning, return.
   *    mergeWithRetry tiene 3 retries con backoff que cubren ~7s extra
   *    si la propagación tarda — defensive, no fail loud.
   *
   * Polls separados por 500ms para no saturar la API rate-limit (5000/hr
   * por PAT). 10 polls = 10 reads/run en el peor caso, despreciable.
   */
  private async pollMergeableStateAfterUpdate(
    runId: string,
    prNumber: number,
  ): Promise<void> {
    const POLL_MAX = 10;
    const POLL_INTERVAL_MS = 500;
    const READY_STATES = new Set(['clean', 'unstable', 'has_hooks']);
    const TERMINAL_FAIL_STATES = new Set(['dirty', 'blocked', 'draft']);

    for (let i = 1; i <= POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const status = await this.github.getPullRequestStatus(prNumber);
      const state = status.mergeableState;

      if (state && READY_STATES.has(state)) {
        this.logger.info(
          `[run:${runId}] updateBranch.poll.ready: PR #${prNumber} mergeable_state=${state} ` +
            `en poll ${i}/${POLL_MAX} (~${i * POLL_INTERVAL_MS}ms post-update)`,
        );
        return;
      }

      if (state && TERMINAL_FAIL_STATES.has(state)) {
        this.logger.warn(
          `[run:${runId}] updateBranch.poll.terminal: PR #${prNumber} mergeable_state=${state} ` +
            `post-update. Story → in_review (NO retry, state terminal).`,
        );
        throw Object.assign(
          new Error(
            `PR #${prNumber}: post-updateBranch mergeable_state=${state}`,
          ),
          // Solo marcamos isMergeConflict para 'dirty' — 'blocked'/'draft'
          // no son conflicts de archivos pero igual son no-recuperables.
          // Tratarlos como conflicts evita retries pointless en
          // updateBranchToBaseWithRetry si ese caller estuviera retrying
          // (en este path no aplica porque ya estamos post-success).
          { isMergeConflict: state === 'dirty' },
        );
      }
      // unknown, behind, null → GitHub aún computando, continue polling.
    }

    // Timeout: no fail loud — mergeWithRetry siguiente puede compensar con
    // sus propios 3 retries (backoff 1s/2s/4s = ~7s extra). Log warning para
    // detectar latencia anómala en observabilidad.
    this.logger.warn(
      `[run:${runId}] updateBranch.poll.timeout: PR #${prNumber} no resolvió ` +
        `mergeable_state en ${POLL_MAX * POLL_INTERVAL_MS}ms — procediendo a ` +
        `merge anyway, confiando en retries de mergeWithRetry como fallback.`,
    );
  }

  /**
   * Poll variant para POST-resolver-push (bug #5 fix 2026-05-17).
   *
   * Cuando el ConflictResolverService pushea su resolución al head branch
   * del PR, GitHub necesita tiempo para invalidar su cache de
   * `mergeable_state` y recomputarlo contra el nuevo head. Si el caller
   * intenta `pulls.merge` API inmediatamente, GitHub responde 405 "Pull
   * Request has merge conflicts" con el estado anterior STALE — aunque el
   * push fue exitoso y el merge YA NO tiene conflict real.
   *
   * Caso de uso real (visto en seed-conflict-stress-test-minimal iter 6):
   *   22:39:58 resolver push sha=ad552b4 (B1+B2 integrado correctamente)
   *   22:39:59 re-merge API → 405 "merge conflicts" (state cache stale)
   *   ~22:40:30 merge manual OK (GitHub ya invalidó cache)
   *
   * Diferencias vs `pollMergeableStateAfterUpdate`:
   *   - NO throw cuando state='dirty' — el resolver acaba de pushear, si
   *     GitHub reporta dirty puede ser cache stale residual. Log warn y
   *     continúa polling. Si timeout con dirty persistente, el siguiente
   *     mergeWithRetry verá el conflict real y lo manejará.
   *   - NO throw cuando state='blocked'/'draft' — esos son terminales pero
   *     este path post-resolver no debería entrar ahí (el resolver no
   *     toca branch protection ni draft state). Si pasa, log warn.
   *   - Solo retorna early cuando ALCANZA un READY state. Sino, timeout +
   *     log + return (siempre intentamos merge anyway, el retry lo cubre).
   *
   * Polling: 1s × 10 = 10s max wait. Es overhead aceptable post-resolver
   * (corremos esto solo cuando hubo conflict — caso minoritario).
   */
  private async pollMergeableStateAfterResolverPush(
    runId: string,
    prNumber: number,
  ): Promise<void> {
    const POLL_MAX = 10;
    const POLL_INTERVAL_MS = 1000;
    const READY_STATES = new Set(['clean', 'unstable', 'has_hooks']);

    for (let i = 1; i <= POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const status = await this.github.getPullRequestStatus(prNumber);
      const state = status.mergeableState;

      if (state && READY_STATES.has(state)) {
        this.logger.info(
          {
            event: 'merge.post_resolver_push.poll.ready',
            runId,
            prNumber,
            mergeableState: state,
            pollNum: i,
            elapsedMs: i * POLL_INTERVAL_MS,
          },
          `[run:${runId}] post-resolver poll ready: PR #${prNumber} mergeable_state=${state} ` +
            `tras ${i * POLL_INTERVAL_MS}ms — procediendo a re-merge.`,
        );
        return;
      }
      // unknown, behind, dirty, blocked, draft, null → continue polling.
      // No throw — confiamos en el resolver que pushó algo válido, y el
      // siguiente mergeWithRetry maneja el error real si lo hubiera.
    }

    this.logger.warn(
      { event: 'merge.post_resolver_push.poll.timeout', runId, prNumber, timeoutMs: POLL_MAX * POLL_INTERVAL_MS },
      `[run:${runId}] post-resolver poll timeout: PR #${prNumber} no alcanzó ` +
        `mergeable_state ready en ${POLL_MAX * POLL_INTERVAL_MS}ms — procediendo a ` +
        `re-merge anyway (mergeWithRetry compensa con sus retries internos).`,
    );
  }

  /**
   * Merge wrapper con retry chain (3 attempts, backoff 1s/2s/4s).
   *
   * El `allowConflictRetry` flag controla el short-circuit del fix #2:
   *  - `false` (default): primer attempt con `isMergeConflict=true` aborta
   *    inmediato. Usado en el merge ORIGINAL post-`run.complete` — un
   *    conflict acá es señal de overlap real de archivos, esperar no lo
   *    resuelve. El catch externo invoca al ConflictResolverService.
   *  - `true`: ignora el short-circuit, retry todo error incluido
   *    conflict. Usado en el re-merge POST-resolver-push (fix #5
   *    2026-05-17), donde un 405 inicial puede ser cache stale de
   *    GitHub que se resuelve solo tras los backoffs (1s/2s/4s extra).
   */
  private async mergeWithRetry(
    runId: string,
    prNumber: number,
    commitTitle: string,
    commitMessage: string,
    allowConflictRetry = false,
  ): Promise<{ merged: boolean; sha: string | null }> {
    const MAX_ATTEMPTS = 3;
    const BACKOFF_MS = [1000, 2000, 4000];
    let lastErr: Error = new Error('unreachable');
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.github.mergePullRequest({
          prNumber,
          commitTitle,
          commitMessage,
        });
        if (result.merged) {
          if (attempt > 1) {
            this.logger.info(
              `[run:${runId}] merge.retry.success: PR #${prNumber} mergeó en attempt ${attempt}/${MAX_ATTEMPTS}`,
            );
          }
          return result;
        }
        // GitHub respondió 200 OK con merged=false (race condition, branch
        // protection, status checks failed). Tratamos como fail retryable.
        throw new Error(
          `GitHub returned merged=false (sha=${result.sha ?? 'null'}); race con otro merge o branch protection.`,
        );
      } catch (err) {
        lastErr = err as Error;

        // Short-circuit cuando el error es conflict REAL: retry no lo va a
        // resolver (los conflicts son persistentes, no transient). Throw
        // INMEDIATO para que el caller (completeRun) lo capture y invoque al
        // ConflictResolverService sin desperdiciar 7s en retries + GitHub
        // API quota. La marca `isMergeConflict=true` viene de
        // `github.mergePullRequest()` cuando detecta status 405/409/422 con
        // mensaje de conflict (post-fix 2026-05-17 — antes el flag no se
        // setteaba en este path y el resolver jamás se invocaba).
        const isConflict = (lastErr as Error & { isMergeConflict?: boolean }).isMergeConflict === true;
        if (isConflict && !allowConflictRetry) {
          this.logger.info(
            { event: 'merge.retry.skip_conflict', runId, prNumber, attempt },
            `[run:${runId}] merge.retry skipped: PR #${prNumber} es conflict real — propagando inmediato para ConflictResolverService`,
          );
          throw lastErr;
        }
        if (isConflict && allowConflictRetry && attempt < MAX_ATTEMPTS) {
          this.logger.info(
            { event: 'merge.retry.conflict_allowed', runId, prNumber, attempt },
            `[run:${runId}] merge.retry post-resolver: PR #${prNumber} conflict en attempt ${attempt}/${MAX_ATTEMPTS} — probable cache stale GitHub, reintentar tras backoff`,
          );
          // Caer al backoff normal en lugar de skip.
        }

        if (attempt === MAX_ATTEMPTS) {
          this.logger.error(
            `[run:${runId}] merge.retry.exhausted: PR #${prNumber} falló los ${MAX_ATTEMPTS} attempts. ` +
              `Último error: ${lastErr.message}`,
          );
          throw lastErr;
        }
        const sleepMs = BACKOFF_MS[attempt - 1];
        this.logger.warn(
          `[run:${runId}] merge.retry: PR #${prNumber} attempt ${attempt}/${MAX_ATTEMPTS} failed ` +
            `(${lastErr.message}). Sleeping ${sleepMs}ms antes de reintentar...`,
        );
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }
    throw lastErr;
  }

  /**
   * Borra la branch remota tras un merge exitoso si la config global lo permite
   * (`BranchStrategyConfig.autoDeleteForgeBranch=true`, default true).
   *
   * Best-effort: el delete NUNCA debe romper el flow del caller. Si falla
   * (network, branch protection, token sin permisos), log warn y seguimos.
   * `deleteBranch` ya es idempotente con 404/422.
   *
   * Lee la config singleton directamente con Prisma (PK fija `id='global'`)
   * para evitar la circular dependency entre FleetModule y BranchStrategyModule
   * (este último importa FleetModule para `assertCanManageFleet`).
   */
  private async cleanupBranchIfEnabled(
    branchName: string,
    runId: string,
    context: 'story' | 'integration',
  ): Promise<void> {
    try {
      const config = await this.prisma.branchStrategyConfig.findUnique({
        where: { id: 'global' },
        select: { autoDeleteForgeBranch: true },
      });
      if (!config?.autoDeleteForgeBranch) return;

      await this.github.deleteBranch(branchName);
      this.logger.info(
        { event: 'forge.cleanup.branch_deleted', runId, branchName, context },
        `[run:${runId}] ${context} branch eliminada tras merge: ${branchName}`,
      );
    } catch (err) {
      this.logger.warn(
        { event: 'forge.cleanup.branch_delete_failed', runId, branchName, context, err: (err as Error).message },
        `[run:${runId}] cleanup de ${context} branch '${branchName}' falló (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Atomicamente reclama UNA historia ready para el nodo dado, respetando
   * el DAG `StoryDependency` (hardness='hard').
   *
   * Una historia es claimable si:
   *  1. Su épica está enqueued (epic.enqueuedAt IS NOT NULL)
   *  2. No tiene claimedAt
   *  3. Status != 'done' (no re-claim de completadas)
   *  4. Todas sus dependencias hard están en status='done'
   *
   * Pre-check de concurrencia (security-reviewer F-04 2026-05-06): si el
   * nodo ya tiene `totalSlots` runs activos (claimed|running), rechaza
   * con ConflictException. Sin esto, un token leakeado podía reclamar
   * 15 historias/min y congelar el backlog hasta el sweeper (10min).
   *
   * SQL clave: `FOR UPDATE OF s SKIP LOCKED` permite N workers reclamando
   * en paralelo sin bloquearse mutuamente — el primero gana, los demás
   * pasan al siguiente row sin waiting.
   *
   * Después del UPDATE, INSERT en agent_runs en la MISMA transacción.
   * `@@unique([storyId, status])` actúa como red de seguridad si la lógica
   * arriba se rompe.
   *
   * @param nodeId  ComputeNode que reclama (resuelto por WorkerAuthGuard)
   * @param tokenId WorkerToken específico que se usó (forensics audit trail)
   *
   * Retorna `null` si no hay historias claimable (worker recibe 204 No Content).
   */
  async claimStory(nodeId: string, tokenId: string): Promise<ClaimedStory | null> {
    // ════════════════════════════════════════════════════════════════════
    // KILL SWITCH GLOBAL — bloquea TODO claim-story
    // ════════════════════════════════════════════════════════════════════
    //
    // Defensa explícita contra spawns accidentales de claude. Dos capas
    // independientes (cualquiera bloquea):
    //
    // 1. **DB flag** (`BranchStrategyConfig.forgePaused`):
    //    - Toggleable via UI sin reiniciar el proceso
    //    - Persistente — sobrevive restarts del backend
    //    - Source-of-truth confiable, no se pierde por env propagation
    //    - Lookup en cada claim (~1ms, indexed singleton)
    //
    // 2. **Env var** (`FORGE_PAUSED=1`):
    //    - Backup defensivo — nunca lleva a falsa confianza
    //    - Útil para boot inicial cuando aún no hay BranchStrategyConfig
    //    - REQUISITO: turbo.json debe tener globalPassThroughEnv con
    //      FORGE_PAUSED, sino el child process del API no la ve
    //
    // Casos de uso:
    //  - Validar setup sin gastar tokens
    //  - Incidente en producción: pausa inmediata
    //  - Desarrollo: bloquear spawns mientras trabajas en otro feature
    if (process.env.FORGE_PAUSED === '1') {
      this.logger.warn(
        `[claim] FORGE_PAUSED=1 (env) — claim-story bloqueado. nodeId=${nodeId}`,
      );
      return null;
    }
    const strategyConfig = await this.prisma.branchStrategyConfig.findUnique({
      where: { id: 'global' },
      select: { forgePaused: true, forgePausedReason: true },
    });
    if (strategyConfig?.forgePaused) {
      this.logger.warn(
        `[claim] forgePaused=true (DB) — claim-story bloqueado. nodeId=${nodeId} reason="${strategyConfig.forgePausedReason ?? 'sin razón'}"`,
      );
      return null;
    }

    // Secretos externos del org — desencriptados FUERA del `$transaction` de
    // claim (qa+architecture-reviewer 2026-05-21). Es un READ de otra tabla;
    // hacerlo dentro del tx mantendría abierta la conexión + el lock
    // `FOR UPDATE` de `compute_nodes` durante el findMany + las N
    // desencriptaciones AES. `getAllPlaintext` omite defensivamente cualquier
    // secret corrupto; `[]` es válido (org sin secrets). Se pasa a
    // `materializeClaim` como parámetro.
    const externalSecrets = await this.externalSecrets.getAllPlaintext();

    // ATOMIC CAP + CLAIM (qa-reviewer F-B 2026-05-06).
    //
    // El check anterior (count seguido de UPDATE en queries separadas)
    // tenía TOCTOU: dos requests concurrentes del MISMO nodo podían pasar
    // el cap independientemente y reclamar 2 historias contra slots=1.
    //
    // Fix: envolvemos node-lookup + count + claim en una `$transaction`
    // y abrimos con `SELECT ... FOR UPDATE` sobre la fila del compute_node.
    // Eso serializa solo las claims del MISMO nodo (otros nodos siguen
    // claimando en paralelo) — claims back-to-back desde 1 nodo se
    // vuelven secuenciales bajo este lock, lo cual es aceptable (claim
    // es una operación rápida).
    let materialized: MaterializedClaim | null;
    try {
      materialized = await this.prisma.$transaction(async (tx) => {
        // 1) Lock la fila del compute_node — serializa claims per-node.
        const lockedNodes = await tx.$queryRaw<
          Array<{ id: string; totalSlots: number; retiredAt: Date | null }>
        >`
          SELECT id, "totalSlots", "retiredAt"
          FROM compute_nodes
          WHERE id = ${nodeId}
          FOR UPDATE
        `;
        if (lockedNodes.length === 0) {
          throw new ConflictException('Node not found');
        }
        const node = lockedNodes[0];
        if (node.retiredAt !== null) {
          throw new ConflictException('Node retired');
        }

        // 2) Count BAJO el lock — ningún otro request de este nodo puede
        //    estar en este punto al mismo tiempo (secuenciados por el lock).
        const activeRuns = await tx.agentRun.count({
          where: {
            nodeId,
            status: { in: [...AGENT_RUN_ACTIVE_STATUSES] },
          },
        });
        if (activeRuns >= node.totalSlots) {
          this.logger.warn(
            `[claim] nodeId=${nodeId} REJECTED activeRuns=${activeRuns} totalSlots=${node.totalSlots}`,
          );
          throw new ConflictException(
            `Node is at capacity (${activeRuns}/${node.totalSlots} active runs)`,
          );
        }

        // 3) Atomic claim de UNA historia (FOR UPDATE OF s SKIP LOCKED
        //    sigue siendo necesario — protege contra colisiones entre
        //    nodos DISTINTOS que apunten a la misma historia).
        //
        // DAG check direction (verified contra schema 2026-05-06):
        //   StoryDependency.storyId    = "historia bloqueada" (la dependiente)
        //   StoryDependency.blockedById = "historia que bloquea" (el blocker)
        // Por eso: para candidata `s`, buscamos `dep.storyId = s.id` y
        // resolvemos blocker via `dep.blockedById`.
        // Filtros del candidato (orden importa para legibilidad):
        //  - epic enqueueada
        //  - story no reclamada en este momento
        //  - status NOT IN ('done', 'in_review', 'blocked'): excluye stories
        //    terminales. in_review = PR abierto esperando humano (O MOCK+merge-fail
        //    bloqueando el DAG hasta resolución manual). blocked = run falló y
        //    escaló a humano — re-reclamarla automáticamente repetiría el
        //    fallo; el retry es una acción humana explícita (botón en el merge
        //    view). Sin estas exclusiones, una story con claimedAt=NULL podría
        //    re-reclamarse sola.
        //  - NOT EXISTS predecesor sin RESOLVER: bloquea wave N+1 hasta que
        //    TODOS los predecesores hard lleguen a un estado TERMINAL — 'done'
        //    (merge OK) o 'blocked' (el predecesor falló). 'blocked' cuenta
        //    como resuelto (2026-05-21): el fallo de una historia NO debe
        //    dejar atascadas para siempre a sus dependientes. El orden del DAG
        //    se preserva (esperan a que el blocker termine), pero el error NO
        //    se propaga — la dependiente corre igual y decide por sus méritos.
        //
        // PARALELISMO INTRA-WAVE: stories de la misma wave (sin DAG dep entre
        // ellas) corren EN PARALELO — es el value prop del Forge fleet. Si
        // dos stories tocan archivos comunes (típico: package.json), el
        // auto-merge maneja:
        //   - Conflicts por TIMING (base avanzó) → updateBranch resuelve.
        //   - Conflicts REALES (overlap código) → ConflictResolverService
        //     intenta resolver con contexto de ambas stories antes de
        //     fallar a in_review. Ver agent-run.service.ts callsite del
        //     auto-merge para detalles.
        const claimedRows = await tx.$queryRaw<ClaimedStoryRow[]>`
          WITH ready_stories AS (
            SELECT s.id, s."epicId", s.title, s."podId"
            FROM stories s
            JOIN epics e ON s."epicId" = e.id
            WHERE e."enqueuedAt" IS NOT NULL
              AND s."claimedAt" IS NULL
              AND s.status NOT IN ('done', 'in_review', 'blocked')
              AND NOT EXISTS (
                SELECT 1 FROM story_dependencies dep
                JOIN stories blocker ON blocker.id = dep."blockedById"
                WHERE dep."storyId" = s.id
                  AND dep.hardness = 'hard'
                  AND blocker.status NOT IN ('done', 'blocked')
              )
            ORDER BY e."enqueuedAt" ASC, s."createdAt" ASC
            LIMIT 1
            FOR UPDATE OF s SKIP LOCKED
          )
          UPDATE stories
          SET "claimedAt" = NOW()
          FROM ready_stories
          WHERE stories.id = ready_stories.id
          RETURNING stories.id, stories."epicId", stories.title, stories."podId"
        `;

        return await this.materializeClaim(
          tx,
          nodeId,
          tokenId,
          claimedRows,
          externalSecrets,
        );
      });
    } catch (err) {
      // Sentinel: el INSERT chocó con el unique constraint de seguridad
      // (ya hay otro claim activo para esta story). Devolvemos null →
      // controller responde 204 → worker reintenta en el siguiente poll.
      // La transacción ya fue rolleada por Prisma cuando lanzamos.
      if (err instanceof AgentRunRaceError) {
        return null;
      }
      throw err;
    }

    if (!materialized) return null;

    // ════════════════════════════════════════════════════════════════════
    // GATE — dependencias técnicas bloqueantes sin credencial vinculada
    // ════════════════════════════════════════════════════════════════════
    //
    // `materializeClaim` separó las `StoryTechnicalDependency` de la historia:
    // las `requiresCredential && isBlocking && linkedSecretId == null` quedaron
    // en `blockingSecretGaps`. Una historia así NO puede correr — el código que
    // el agente escriba referenciaría una credencial que no existe y los tests
    // que la toquen fallarían. La escalamos a humano: el operador registra el
    // secret en `/factory/settings → Secretos externos` (lo que vincula la dep
    // por vendor) y re-encola la historia.
    //
    // Se chequea ACÁ, antes del planner (~$0.12/story), para no gastar tokens
    // en una historia que va a quedar `blocked` igual. Reusa el mismo patrón
    // de cleanup+throw que la validación defensiva de más abajo.
    if (materialized.blockingSecretGaps.length > 0) {
      const gapsDesc = materialized.blockingSecretGaps
        .map((g) => `"${g.title}"${g.vendor ? ` (${g.vendor})` : ''}`)
        .join(', ');
      this.logger.error(
        {
          event: 'claim.blocking_secret_gap',
          runId: materialized.runId,
          storyId: materialized.storyId,
          gaps: materialized.blockingSecretGaps,
        },
        `Historia tiene dependencias técnicas bloqueantes sin credencial ` +
          `vinculada: ${gapsDesc} — abortando claim, escalando la historia a ` +
          `'blocked' para revisión humana`,
      );
      try {
        await this.prisma.$transaction([
          this.prisma.agentRun.update({
            where: { id: materialized.runId },
            data: {
              status: 'failed',
              errorMessage: `Blocking credential dependencies without linked secret: ${gapsDesc}`,
            },
          }),
          this.prisma.story.update({
            where: { id: materialized.storyId },
            data: { claimedAt: null, status: 'blocked' },
          }),
        ]);
      } catch (cleanupErr) {
        this.logger.error(
          {
            event: 'claim.blocking_secret_gap.cleanup_failed',
            runId: materialized.runId,
            storyId: materialized.storyId,
            error: (cleanupErr as Error).message,
          },
          'Cleanup post-gate falló — AgentRun queda zombie hasta sweeper TTL',
        );
      }
      throw new ConflictException(
        `Story ${materialized.storyId} blocked: requiere credenciales no ` +
          `provisionadas (${gapsDesc}). Registrá el/los secret(s) en Factory ` +
          `settings y re-encolá la historia.`,
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // Post-transaction enrichment (qa+arch-reviewer 2026-05-12)
    // ════════════════════════════════════════════════════════════════════
    //
    // Hacemos HTTP a GitHub vault para leer el markdown de la story DESPUÉS
    // del commit. Si estuviera dentro del $transaction, mantendría el lock
    // `FOR UPDATE` sobre `compute_nodes` mientras esperamos respuesta de
    // GitHub (200-800ms típico, hasta segundos bajo rate limit) y
    // serializaría workers concurrentes innecesariamente.
    //
    // Si falla (vault no responde, vaultPath null, archivo borrado),
    // `storyMarkdown = null` y el flow degrada al comportamiento previo
    // (verifier evalúa `acceptance-criteria` en abstracto). Sin loss of
    // liveness.
    // Leemos las 3 secciones del vault (PO + Technical + QA). Antes solo
    // pasábamos PO → el agente improvisaba arquitectura y tests porque
    // ignoraba el trabajo del Tech Lead y del QA. Pasar las 3 secciones
    // garantiza que el agente respete la arquitectura aprobada e implemente
    // los tests específicos planificados.
    // ════════════════════════════════════════════════════════════════════
    // CONTEXT ENGINEERING — carga del contexto del agente
    // ════════════════════════════════════════════════════════════════════
    //
    // Pipeline (sin logs intermedios — un solo log estructurado al final):
    //   1. vault read → PO + Technical + QA markdowns
    //   2. parsers   → acceptanceCriteria + qaTestCases
    //   3. diagrama  → ya serializado en materialize
    //   4. DAG       → ya cargado en materialize (completedSiblings)
    //   5. prompt    → ensamblado final con todas las piezas
    //
    // Observabilidad: 2 logs estructurados con event keys queryables
    // (`forge.claim.vault.*` y `forge.claim.prompt.built`) en vez de 5 logs
    // sueltos. Sin ruido en hot paths.
    let storyMarkdown: string | null = null;
    let storyTechnicalMarkdown: string | null = null;
    let storyQAMarkdown: string | null = null;
    let vaultReadError: string | null = null;
    if (materialized.storyVaultPath) {
      try {
        const content = await this.stories.readStoryContent(materialized.storyVaultPath);
        storyMarkdown = content.po?.markdown || null;
        storyTechnicalMarkdown = content.technical?.markdown || null;
        storyQAMarkdown = content.qa?.markdown || null;
      } catch (err) {
        vaultReadError = (err as Error).message;
      }
    }

    // Pseudo-advisor pre-CLI: invocamos el planner (Sonnet + Opus advisor via
    // SDK) ANTES de construir el prompt para inyectar un plan estructurado
    // como primera sección operativa. El planner es best-effort: si falla
    // (API down, rate limit, timeout), retorna null y el prompt se construye
    // sin plan — el coder igual ejecuta, solo sin la guía pre-pensada.
    //
    // Cost esperado por story: ~$0.12 (Sonnet ~$0.03 + Opus advisor ~$0.09).
    // Cuando la story tiene contexto rico (PO+TL+QA markdowns), el plan
    // típicamente identifica archivos a tocar, patrón arquitectural, 1-3
    // decisiones críticas y gotchas — exactamente las decisiones difíciles
    // donde el advisor Opus aporta valor sobre Sonnet solo.
    const plannerResult = await this.planner.planStory({
      runId: materialized.runId,
      storyTitle: materialized.storyTitle,
      epicTitle: materialized.epicTitle,
      epicMarkdown: materialized.epicMarkdown,
      epicBusinessDiagram: materialized.epicBusinessDiagram,
      storyMarkdown,
      storyTechnicalMarkdown,
      storyQAMarkdown,
    });

    // Persistir plan + usage en el AgentRun para observabilidad:
    //  - plannerPlan: visible en AgentDetailDrawer para forensics.
    //  - plannerUsage: agregado a totalCostUsd del batch en getBatchDetail.
    // Best-effort: si el update falla (race con sweeper, network), log warn
    // y seguimos — el claim no se cae por un fallo de observabilidad.
    if (plannerResult.plan || plannerResult.usage) {
      try {
        await this.prisma.agentRun.update({
          where: { id: materialized.runId },
          data: {
            plannerPlan: plannerResult.plan,
            plannerUsage: plannerResult.usage as unknown as Prisma.InputJsonValue,
          },
        });
      } catch {
        // Persist del plan/usage falló — non-fatal. El prompt YA recibió el
        // plan inyectado (lo importante para el coder). Solo se pierde el
        // record persistente del AgentRun en DB; el `forge.planner.done`
        // previo ya contiene los tokens/cost para forensics. Silent skip.
      }
    }

    // Diseño de referencia INLINEADO (causa raíz 2026-06-02): leemos el código
    // fuente del/los primary file(s) del diseño aprobado de la épica del vault
    // server-side y lo pasamos al prompt-builder para que lo meta DIRECTO en el
    // prompt. Así el agente recibe el diseño sin depender de `vault_read` (tool
    // que el worker NO expone). Fail-soft total: si algo falla devuelve [] y el
    // flow degrada al comportamiento previo (el agente improvisa).
    const designReferenceFiles = await this.loadDesignReferenceFiles(
      materialized.epicId,
      materialized.runId,
    );

    // Construimos el prompt FUERA del transaction — string concatenation
    // no afecta locks. Recibe las 4 piezas de contexto enriquecido cuando
    // están disponibles (PO + Technical + QA + diagrama) + el DAG context
    // + el plan del advisor (si el planner pudo generarlo) + el código fuente
    // del diseño de referencia inlineado (si la épica tiene bundle).
    const prompt = this.promptBuilder.buildStoryPrompt({
      epicTitle: materialized.epicTitle,
      epicMarkdown: materialized.epicMarkdown,
      epicBusinessDiagram: materialized.epicBusinessDiagram,
      storyTitle: materialized.storyTitle,
      storyMarkdown,
      storyTechnicalMarkdown,
      storyQAMarkdown,
      completedSiblings: materialized.completedSiblings,
      dodCriteria: materialized.dodCriteria,
      advisorPlan: plannerResult.plan,
      designReferenceFiles,
    });

    // Parsers que escalan el contexto a granularidad per-criterion en el
    // verifier:
    //   - acceptanceCriteria → DoD `acceptance-criteria` (PO markdown).
    //   - qaTestCases → DoD `tests-passing` (QA markdown).
    //   - technicalRequirements → DoD `technical-design` (TL markdown).
    // Mismo patrón cross-section: pre-flight determinístico + Sonnet judge.
    const acceptanceCriteria = ForgePromptBuilderService.extractAcceptanceCriteria(storyMarkdown);
    const qaTestCases = ForgePromptBuilderService.extractTestCases(storyQAMarkdown);
    const technicalRequirements = ForgePromptBuilderService.extractTechnicalRequirements(
      storyTechnicalMarkdown,
    );

    // ════════════════════════════════════════════════════════════════════
    // OBSERVABILIDAD: 2 logs estructurados de hitos del context engineering
    // ════════════════════════════════════════════════════════════════════
    this.logVaultLoaded({
      runId: materialized.runId,
      storyId: materialized.storyId,
      epicId: materialized.epicId,
      vaultPath: materialized.storyVaultPath,
      vaultReadError,
      po: storyMarkdown,
      technical: storyTechnicalMarkdown,
      qa: storyQAMarkdown,
    });

    this.logPromptBuilt({
      runId: materialized.runId,
      storyId: materialized.storyId,
      epicId: materialized.epicId,
      promptChars: prompt.length,
      po: storyMarkdown,
      technical: storyTechnicalMarkdown,
      qa: storyQAMarkdown,
      epicBusinessDiagram: materialized.epicBusinessDiagram,
      acceptanceCriteria,
      qaTestCases,
      technicalRequirements,
      completedSiblings: materialized.completedSiblings,
      dodCriteriaCount: materialized.dodCriteria.length,
    });

    // ════════════════════════════════════════════════════════════════════
    // DEFENSIVE VALIDATION del payload antes de retornar al worker
    // ════════════════════════════════════════════════════════════════════
    //
    // Si CUALQUIER campo crítico vino null/empty (bug en materializeClaim,
    // OrgAnthropicConfig roto, vault read fail catastrófico que dejó prompt
    // sin contenido), abortamos el claim ANTES de pasarle data corrupta al
    // worker. El worker tiene su propio safety net pero detectarlo en el
    // backend es más rápido (no consume slot del worker) + permite cleanup
    // limpio del AgentRun + Story claim state.
    //
    // Threshold de `anthropicApiKey: 10`: las claves reales `sk-ant-...` son
    // 100+ chars; 10 es conservador pero atrapa null/empty/dummy values.
    // Threshold de `prompt: 100`: prompts reales son 8K-15K chars; 100 es el
    // mismo guard que el worker usa para consistencia cross-side.
    const missingFields: string[] = [];
    if (!materialized.anthropicApiKey || materialized.anthropicApiKey.trim().length < 10) {
      missingFields.push(`anthropicApiKey(len=${materialized.anthropicApiKey?.length ?? 0})`);
    }
    if (!materialized.storyTitle || materialized.storyTitle.trim().length === 0) {
      missingFields.push('storyTitle');
    }
    if (!materialized.branch || materialized.branch.trim().length === 0) {
      missingFields.push('branch');
    }
    if (!materialized.epicId) {
      missingFields.push('epicId');
    }
    if (!prompt || prompt.trim().length < 100) {
      missingFields.push(`prompt(len=${prompt?.length ?? 0})`);
    }

    if (missingFields.length > 0) {
      this.logger.error(
        {
          event: 'claim.invalid_payload',
          runId: materialized.runId,
          storyId: materialized.storyId,
          missingFields,
        },
        `Claim payload tiene campos críticos vacíos: ${missingFields.join(', ')} — abortando claim antes de retornar al worker (cleanup AgentRun + un-claim story)`,
      );
      // Cleanup: marcar AgentRun como failed + story como `blocked`.
      // `missingFields` valida campos del DB (title/markdown/etc.) — un fallo
      // así NO es transitorio: re-claimar la misma story produce el mismo
      // fallo de validación. Antes se devolvía a 'backlog' (re-claimable),
      // lo que loopeaba claim→fail→backlog→claim quemando overhead. Ahora
      // 'blocked' escala a humano, igual que un run fallido (qa-reviewer
      // 2026-05-19). El operador corrige el contenido de la story y la
      // re-encola manualmente.
      try {
        await this.prisma.$transaction([
          this.prisma.agentRun.update({
            where: { id: materialized.runId },
            data: {
              status: 'failed',
              errorMessage: `Claim payload validation failed: ${missingFields.join(', ')}`,
            },
          }),
          this.prisma.story.update({
            where: { id: materialized.storyId },
            data: { claimedAt: null, status: 'blocked' },
          }),
        ]);
      } catch (cleanupErr) {
        this.logger.error(
          {
            event: 'claim.invalid_payload.cleanup_failed',
            runId: materialized.runId,
            storyId: materialized.storyId,
            error: (cleanupErr as Error).message,
          },
          'Cleanup post-validation falló — AgentRun queda zombie hasta sweeper TTL',
        );
      }
      throw new ConflictException(
        `Claim payload validation failed for story ${materialized.storyId}: ${missingFields.join(', ')}`,
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // Load componentManifests del bundle de diseño (post-tx, fail-soft)
    // ════════════════════════════════════════════════════════════════════
    //
    // El DesignBundleService extrae automáticamente el manifest de
    // componentes del HTML del bundle (TopBar, Hero, Ticker, etc.) y lo
    // guarda en `epic.designs[].componentManifest`. El worker lo necesita
    // para:
    //   1. Worker recibe en claim payload como `componentManifests`
    //   2. Verifier de Layer 1 (`design-coverage-check`) usa el manifest
    //      para validar que cada componente fue implementado.
    //
    // Fail-soft: si no hay designs, o no tienen manifest (legacy), o
    // alguno tiene shape inválido, retornamos `[]` y el check del worker
    // hace `skipped`. NO bloqueamos el claim por esto.
    let componentManifests: ClaimedStory['componentManifests'] = undefined;
    try {
      const epicWithDesigns = await this.prisma.epic.findUnique({
        where: { id: materialized.epicId },
        select: { designs: true },
      });
      const designs = (epicWithDesigns?.designs ?? []) as unknown as Array<{
        componentManifest?: unknown;
      }>;
      const manifests = designs
        .map((d) => d.componentManifest)
        .filter(
          (m): m is { components: unknown[]; primaryFilePath: string; extractedAt: string } =>
            m !== null &&
            typeof m === 'object' &&
            Array.isArray((m as { components?: unknown }).components) &&
            typeof (m as { primaryFilePath?: unknown }).primaryFilePath === 'string',
        )
        .map((m) => ({
          components: (m.components as unknown[])
            .filter(
              (c): c is { name: string; kind: string; startLine: number; endLine: number; filePath: string } =>
                typeof c === 'object' &&
                c !== null &&
                typeof (c as { name?: unknown }).name === 'string' &&
                (((c as { kind?: unknown }).kind === 'section') ||
                  ((c as { kind?: unknown }).kind === 'react-component')) &&
                typeof (c as { startLine?: unknown }).startLine === 'number' &&
                typeof (c as { endLine?: unknown }).endLine === 'number' &&
                typeof (c as { filePath?: unknown }).filePath === 'string',
            )
            .map((c) => ({
              name: c.name,
              kind: c.kind as 'section' | 'react-component',
              startLine: c.startLine,
              endLine: c.endLine,
              filePath: c.filePath,
            })),
          primaryFilePath: m.primaryFilePath,
          extractedAt: m.extractedAt,
        }));
      componentManifests = manifests.length > 0 ? manifests : undefined;
    } catch (err) {
      // Fail-soft: log pero no bloquear. El check downstream queda skipped.
      this.logger.warn(
        { event: 'claim.componentManifest.load_failed', runId: materialized.runId, err: (err as Error).message },
        '[claim] Failed to load componentManifests — design-coverage-check will skip',
      );
    }

    return {
      runId: materialized.runId,
      storyId: materialized.storyId,
      storyTitle: materialized.storyTitle,
      storyMarkdown,
      epicId: materialized.epicId,
      branch: materialized.branch,
      prompt,
      repoUrl: materialized.repoUrl,
      baseBranch: materialized.baseBranch,
      anthropicApiKey: materialized.anthropicApiKey,
      externalSecrets: materialized.externalSecrets,
      forgeWorkerModel: materialized.forgeWorkerModel,
      forgeWorkerEffort: materialized.forgeWorkerEffort,
      forgeWorkerMaxRunDurationMs: materialized.forgeWorkerMaxRunDurationMs,
      dodVerifierModel: materialized.dodVerifierModel,
      dodVerifierEffort: materialized.dodVerifierEffort,
      dodMaxAttempts: materialized.dodMaxAttempts,
      dodCriteria: materialized.dodCriteria,
      acceptanceCriteria,
      qaTestCases,
      technicalRequirements,
      componentManifests,
    };
  }

  /**
   * Continuación del claim DENTRO de la transacción: lookup del story para
   * el prompt, INSERT del AgentRun, fetch del ANTHROPIC_API_KEY.
   *
   * Refactor del bloque post-CTE (qa-reviewer F-B 2026-05-06) para
   * mantener todo bajo el mismo $transaction. `tx` es el cliente Prisma
   * con el lock activo; cualquier throw aborta la transacción y revierte
   * tanto el `claimedAt=NOW()` como el `agentRun.create`.
   *
   * Retorna `MaterializedClaim` (internal type) con los datos crudos
   * necesarios para construir el `ClaimedStory` final. El caller
   * (`claimStory`) hace `readStoryContent` y `buildStoryPrompt` FUERA del
   * transaction para no mantener locks mientras GitHub responde
   * (qa+architecture-reviewer 2026-05-12: bajo carga concurrente la HTTP
   * call de vault dentro del $transaction serializa workers).
   */
  private async materializeClaim(
    tx: Prisma.TransactionClient,
    nodeId: string,
    tokenId: string,
    claimedRows: ClaimedStoryRow[],
    externalSecrets: ExternalSecretForWorker[],
  ): Promise<MaterializedClaim | null> {
    if (claimedRows.length === 0) {
      this.logger.debug({ nodeId }, `[claim] nodeId=${nodeId} → 204 noStoriesReady`);
      return null;
    }

    const claimed = claimedRows[0];

    // Branch naming: forge/epic-<short>/story-<short>. Reusa primeros 8
    // chars del UUID como en lib/short-id.ts (frontend) — consistente UX.
    const branch = `forge/epic-${claimed.epicId.slice(0, 8)}/story-${claimed.id.slice(0, 8)}`;

    // Lee la story DENTRO de la transacción para construir el prompt.
    // Incluimos `epic.diagrams` para serializar el diagrama de negocio y
    // pasárselo al agente como contexto — sin esto el agente improvisa la
    // arquitectura del flow en vez de seguir el diseño aprobado.
    const story = await tx.story.findUnique({
      where: { id: claimed.id },
      include: {
        epic: { select: { id: true, title: true, markdown: true, diagrams: true } },
      },
    });
    if (!story) {
      // Casi imposible — la fila acabamos de updatearla. Throw aborta el
      // tx → el UPDATE de claimedAt=NOW() también se rollbackea.
      this.logger.error(
        `[claim] story disappeared between UPDATE and SELECT? id=${claimed.id}`,
      );
      throw new ConflictException('Story disappeared mid-claim');
    }

    // Crea AgentRun. Si el unique [storyId, status='claimed'] ya existe
    // (race condition extrema), Prisma lanza P2002. Capturamos para
    // devolver null limpio en vez de error genérico — la transacción
    // se rolleará al throw, devolviendo claimedAt a NULL automáticamente.
    let agentRun;
    try {
      agentRun = await tx.agentRun.create({
        data: {
          storyId: claimed.id,
          nodeId,
          claimedByTokenId: tokenId, // forensics — sec F-03
          status: 'claimed',
          branch,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(
          `[claim] AgentRun race detected for storyId=${claimed.id} — tx rollback`,
        );
        // Rethrow una excepción específica que el caller traduzca a "204".
        // Prisma rollbackea automáticamente al propagar.
        throw new AgentRunRaceError();
      }
      throw err;
    }

    // Resuelve API key (forwarding al worker). Si no está configurada,
    // throw → tx rollback automático (tanto agentRun como claimedAt).
    // OrgAnthropicConfig vive en otra tabla y usa su propio Prisma client
    // (no `tx`) — pero como solo es READ y no modifica estado relacionado,
    // no afecta la atomicidad de nuestro escrito.
    const anthropicApiKey = await this.orgAnthropicConfig.getApiKeyPlaintext();

    // `externalSecrets` llega como parámetro: se desencripta FUERA del
    // `$transaction` (ver `claimStory`) para no mantener locks abiertos
    // durante el findMany + las desencriptaciones AES.

    // Dependencias técnicas de la historia que requieren credencial. El gate
    // post-tx de `claimStory` rechaza el claim si alguna es BLOQUEANTE y no
    // tiene secret vinculado — el agente no puede implementar (ni el verifier
    // testear) contra una credencial que no existe. Leído con `tx` para que
    // sea consistente con el snapshot de la story recién lockeada.
    const technicalDependencies = await tx.storyTechnicalDependency.findMany({
      where: { storyId: claimed.id },
      select: {
        title: true,
        vendor: true,
        requiresCredential: true,
        isBlocking: true,
        linkedSecretId: true,
      },
    });
    // Clasificación pura (unit-testeada en `secret-deps.spec.ts`): parte las
    // deps en gaps bloqueantes (abortan el claim en `claimStory`) vs
    // no-bloqueantes (solo log de advertencia).
    const { blockingGaps, nonBlockingGaps } = classifySecretDependencies(
      technicalDependencies,
    );
    for (const gap of nonBlockingGaps) {
      // Requiere credencial pero NO es bloqueante: no aborta el claim, solo
      // deja rastro queryable para diagnóstico operacional.
      this.forgeClaimLogger.warn(
        {
          event: 'forge.claim.unlinked_secret_dep',
          runId: agentRun.id,
          storyId: claimed.id,
          epicId: claimed.epicId,
          depTitle: gap.title,
          depVendor: gap.vendor,
        },
        `dependencia técnica "${gap.title}" requiere credencial pero no tiene ` +
          `secret vinculado (no bloqueante — el claim procede)`,
      );
    }

    // Construye el prompt vía ForgePromptBuilderService. Antes era un
    // helper privado en este service (architecture-reviewer F-04
    // 2026-05-06: SRP — AgentRunService coordina lifecycle, no formatea
    // prompts).
    //
    // Inyectamos el catálogo de DoD configurado por el operador en
    // `/factory/settings/Definition of Done` para que el agente sepa qué
    // criterios bloquean el merge ANTES de empezar a trabajar. Solo los
    // Lee todos los criterios del catálogo. Solo los campos visibles al
    // agente: `text` + `description`. Incluimos `kind` además porque el
    // worker lo usa para mapear a verificación determinística
    // (dod-verifier.ts). El prompt builder solo necesita text/description
    // pero ignora kind cuando lo recibe — sin overhead.
    const dodCriteria = (await this.dod.findAll())
      .map((c) => ({ kind: c.kind, text: c.text, description: c.description }));

    // NOTA: NO leemos el markdown de la story acá. Se hace FUERA del
    // $transaction en `claimStory` después del commit, para no mantener
    // el `FOR UPDATE OF s SKIP LOCKED` lock mientras esperamos respuesta
    // de GitHub vault (puede tardar 200-800ms; bajo carga concurrente
    // eso serializaría workers innecesariamente — qa+arch-reviewer
    // 2026-05-12). Solo pasamos el `vaultPath` al caller para que
    // decida si necesita hacer el read.

    // ════════════════════════════════════════════════════════════════════
    // GIT INTEGRATION (HITOS 2/4/5) — resolver clone URL + asegurar
    // integration branch del epic
    // ════════════════════════════════════════════════════════════════════
    //
    // Si hay un CodeRepository enabled, le pasamos al worker:
    //  - `repoUrl`: clone URL con token embebido (HTTPS auth)
    //  - `baseBranch`: nombre de la integration branch del epic (debe
    //    existir en remote — la creamos aquí si no existe)
    //
    // Si NO hay CodeRepository (cualquier error en getCloneUrl), entramos
    // en sandbox mode: el worker corre claude en /tmp/ sin clone ni push.
    // La story se marcará 'done' al exit 0 igual (movedToDoneSandbox), pero
    // sin PR. Esto preserva el flow E2E para validación sin GitHub setup.
    let repoUrl: string | null = null;
    let baseBranch: string | null = null;
    let gitWiringError: string | null = null;
    try {
      const { cloneUrl } = await this.github.getCloneUrl();
      // Modelo de 3 niveles del Forge:
      //   main ← DEV ← forge/sprint-batch-{epicId}
      // La integration branch DEBE crearse desde `dev` (la branch de integración
      // pre-release), NO desde el `defaultBranch` del repo (que típicamente es
      // `main` por config). Antes pasábamos `defaultBranch` aquí — bug crítico
      // descubierto 2026-05-14 — y eso hacía que el PR consolidado contra `dev`
      // fallara con "No common ancestor" porque la integration branch nacía
      // desde main, no desde dev. Lectura directa del config porque el
      // BranchStrategyService no está inyectado en este service.
      const strategyConfig = await this.prisma.branchStrategyConfig.findUnique({
        where: { id: 'global' },
        select: { devBranch: true },
      });
      const devBranch = strategyConfig?.devBranch ?? 'dev';
      const integrationBranch = `forge/sprint-batch-${claimed.epicId.slice(0, 8)}`;

      // Idempotente: si la integration branch ya existe (creada en enqueue),
      // retorna la existente. Si NO existe (enqueue falló por sandbox o el
      // epic es legacy), la crea desde `devBranch` para que el flow normal
      // de open-PR → squash-merge a dev funcione sin "No common ancestor".
      await this.github.createIntegrationBranch({
        branchName: integrationBranch,
        devBranch,
        epicId: claimed.epicId,
      });

      repoUrl = cloneUrl;
      baseBranch = integrationBranch;
    } catch (err) {
      // Sandbox fallback. El log estructurado abajo emite mode=sandbox +
      // el error como field — no duplicamos un log aparte para "fallback".
      gitWiringError = (err as Error).message;
    }

    const epicBusinessDiagram = this.serializeBusinessDiagram(
      story.epic.diagrams,
      claimed.epicId,
    );

    // Un log estructurado por claim (reemplaza 2 logs sueltos):
    // `forge.claim.materialized` con identificadores + git mode + error.
    const mode = repoUrl ? 'git' : 'sandbox';
    this.forgeClaimLogger.info(
      {
        event: 'forge.claim.materialized',
        runId: agentRun.id,
        storyId: claimed.id,
        epicId: claimed.epicId,
        nodeId,
        tokenIdShort: tokenId.slice(0, 8),
        branch,
        baseBranch,
        mode,
        diagram: {
          present: epicBusinessDiagram !== null,
          chars: epicBusinessDiagram?.length ?? 0,
        },
        // Solo NOMBRES de secrets — nunca valores (contrato de seguridad
        // de `ExternalSecretForWorker`).
        externalSecretsCount: externalSecrets.length,
        externalSecretNames: externalSecrets.map((s) => s.name),
        ...(gitWiringError ? { gitError: gitWiringError } : {}),
      },
      `materialized run=${agentRun.id.slice(0, 8)} story=${claimed.id.slice(0, 8)} epic=${claimed.epicId.slice(0, 8)} mode=${mode} secrets=${externalSecrets.length}`,
    );

    // Carga del contexto del DAG: stories del MISMO epic que YA terminaron
    // antes que esta historia arrancara. La integration branch tiene los
    // commits de éstas (via auto-merge en `complete()`), por lo que sus
    // archivos están materializados en el workdir del worker. Sin embargo
    // el agente no sabe explícitamente cuáles existen — solo via `ls`. Acá
    // las cargamos para inyectarlas al prompt con paths concretos.
    //
    // 1. Hard deps directas — relación StoryDependency hardness='hard'.
    //    Son las que esta story EXPLÍCITAMENTE depende. El prompt las
    //    resalta como "OBLIGATORIO leer estos archivos antes de implementar".
    // 2. Otras stories completadas del epic — siblings informativos. El
    //    agente debe ser consciente de su existencia pero no es bloqueante.
    //
    // Filter por `agentRuns.status='completed'` con `take: 1` (último run
    // exitoso) para incluir paths del filesModifiedPaths. Stories con status
    // 'in_review' (PR abierto pero no mergeado) NO entran porque la
    // integration branch aún no tiene su trabajo.
    const completedSiblings = await this.loadCompletedSiblingsForStory(
      tx,
      claimed.id,
      claimed.epicId,
    );

    // Forge Worker + DoD Verifier config (singleton AgentTokenSettings) —
    // leídos fuera del transaction porque NO afecta locks y el cache TTL=30s
    // del service hace que el read sea casi siempre in-memory. Los 2 lecturas
    // hit el mismo cache, así que efectivamente es 1 read.
    const [forgeWorkerConfig, dodVerifierConfig] = await Promise.all([
      this.agentTokens.getForgeWorker(),
      this.agentTokens.getDodVerifier(),
    ]);

    return {
      runId: agentRun.id,
      storyId: claimed.id,
      storyTitle: claimed.title,
      storyVaultPath: story.vaultPath,
      epicId: claimed.epicId,
      epicTitle: story.epic.title,
      epicMarkdown: story.epic.markdown,
      epicBusinessDiagram,
      completedSiblings,
      branch,
      repoUrl,
      baseBranch,
      anthropicApiKey,
      externalSecrets,
      blockingSecretGaps: blockingGaps,
      dodCriteria,
      forgeWorkerModel: forgeWorkerConfig.model,
      forgeWorkerEffort: forgeWorkerConfig.effort,
      forgeWorkerMaxRunDurationMs: forgeWorkerConfig.maxRunDurationMs,
      dodVerifierModel: dodVerifierConfig.model,
      dodVerifierEffort: dodVerifierConfig.effort,
      dodMaxAttempts: dodVerifierConfig.maxAttempts,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // OBSERVABILIDAD — context engineering logs estructurados (pino-native)
  // ════════════════════════════════════════════════════════════════════
  //
  // Estrategia: emitir UN log estructurado por hito significativo (no
  // múltiples logs por fase secundaria). Cada log es JSON nativo via pino:
  //   logger.info({ event, runId, context }, 'mensaje legible')
  //     → { "level":30, "event":"...", "runId":"...", "context":{...}, "msg":"..."}
  //
  // Cada log tiene:
  //   - `event`: clave estable queryable en Loki/Grafana (`forge.claim.*`).
  //   - Identificadores (`runId`, `storyId`, `epicId`) para correlación.
  //   - Metadata anidada por dominio (`context.po`, `context.dag`).
  //   - Mensaje legible humano que sale como `msg` en JSON / pretty.
  //
  // Hitos cubiertos:
  //   - `forge.claim.materialized`: claim row creado + git wiring outcome.
  //   - `forge.claim.vault.loaded`: vault read del story content + outcome.
  //   - `forge.claim.prompt.built`: snapshot completo de lo que recibió el
  //     agente (sources, sizes, counts). Es EL log autoritativo para
  //     responder "¿el agente recibió suficiente contexto?".
  //   - `forge.claim.diagram.parse_failed`: diagrama corrupto (WARN).
  //
  // Niveles:
  //   - INFO: estado normal del flow (claim ok, vault loaded, prompt built).
  //   - WARN: degradación graciosa (vault no leíble, sandbox fallback).
  //
  // Queries de ejemplo:
  //   {app="cenzontle-api"} | json | event="forge.claim.prompt.built" | completeness < 4
  //   {app="cenzontle-api"} | json | event="forge.claim.vault.loaded" | outcome="failed"
  //   {app="cenzontle-api"} | json | event="forge.claim.prompt.built" | context_dag_hardDeps > 0

  /**
   * Log del hito "vault content loaded". Discrete `outcome` field para
   * queries simples ("runs donde el vault no se leyó"). Reemplaza 3 logs
   * separados que existían antes — un único punto de telemetry.
   */
  private logVaultLoaded(input: {
    runId: string;
    storyId: string;
    epicId: string;
    vaultPath: string | null;
    vaultReadError: string | null;
    po: string | null;
    technical: string | null;
    qa: string | null;
  }): void {
    let outcome: 'loaded' | 'empty' | 'failed' | 'no-path';
    if (!input.vaultPath) outcome = 'no-path';
    else if (input.vaultReadError) outcome = 'failed';
    else if (!input.po && !input.technical && !input.qa) outcome = 'empty';
    else outcome = 'loaded';

    const payload = {
      event: 'forge.claim.vault.loaded',
      runId: input.runId,
      storyId: input.storyId,
      epicId: input.epicId,
      outcome,
      vaultPath: input.vaultPath,
      po: { chars: input.po?.length ?? 0, present: input.po !== null },
      technical: { chars: input.technical?.length ?? 0, present: input.technical !== null },
      qa: { chars: input.qa?.length ?? 0, present: input.qa !== null },
      ...(input.vaultReadError ? { error: input.vaultReadError } : {}),
    };
    const msg = `vault.loaded outcome=${outcome} po=${payload.po.chars}ch tech=${payload.technical.chars}ch qa=${payload.qa.chars}ch`;

    if (outcome === 'failed' || outcome === 'empty') {
      this.forgeClaimLogger.warn(payload, msg);
    } else {
      this.forgeClaimLogger.info(payload, msg);
    }
  }

  /**
   * Log del hito "prompt built" — snapshot AUTORITATIVO de lo que recibió
   * el agente. Cualquier debug del Forge ("¿por qué el agente improvisó la
   * arquitectura?", "¿no vio la sección QA?") empieza por buscar este log
   * y revisar el payload.
   *
   * Métrica clave para dashboards: `completeness` 0-5 = cuántas fuentes
   * de contexto se inyectaron (po | technical | qa | diagram | dag_siblings).
   * Si baja repentinamente → regresión en story-gen o vault corrupto.
   *
   * Queries (Grafana/Loki):
   *   | json | event="forge.claim.prompt.built" | completeness < 4
   *   | json | event="forge.claim.prompt.built" | context_dag_hardDeps > 0
   *   | json | event="forge.claim.prompt.built" | context_po_criteriaCount == 0 | context_po_chars > 100
   */
  private logPromptBuilt(input: {
    runId: string;
    storyId: string;
    epicId: string;
    promptChars: number;
    po: string | null;
    technical: string | null;
    qa: string | null;
    epicBusinessDiagram: string | null;
    acceptanceCriteria: string[];
    qaTestCases: Array<{ category: 'happy' | 'edge'; description: string }>;
    technicalRequirements: Array<{
      category: 'checklist' | 'contract' | 'validation' | 'errors';
      description: string;
    }>;
    completedSiblings: Array<{ isHardDep: boolean; filesModifiedPaths: string[] }>;
    dodCriteriaCount: number;
  }): void {
    const happy = input.qaTestCases.filter((tc) => tc.category === 'happy').length;
    const edge = input.qaTestCases.length - happy;
    const trChecklist = input.technicalRequirements.filter((tr) => tr.category === 'checklist').length;
    const trContract = input.technicalRequirements.filter((tr) => tr.category === 'contract').length;
    const trValidation = input.technicalRequirements.filter((tr) => tr.category === 'validation').length;
    const trErrors = input.technicalRequirements.filter((tr) => tr.category === 'errors').length;
    const hard = input.completedSiblings.filter((s) => s.isHardDep).length;
    const dagPaths = input.completedSiblings.reduce(
      (sum, s) => sum + s.filesModifiedPaths.length,
      0,
    );
    // `completeness` 0-5: count de fuentes de contexto con contenido.
    // Métrica simple para alertar regresiones del context engineering.
    const sources = {
      po: input.po !== null,
      technical: input.technical !== null,
      qa: input.qa !== null,
      businessDiagram: input.epicBusinessDiagram !== null,
      dagSiblings: input.completedSiblings.length > 0,
    };
    const completeness = Object.values(sources).filter(Boolean).length;

    const payload = {
      event: 'forge.claim.prompt.built',
      runId: input.runId,
      storyId: input.storyId,
      epicId: input.epicId,
      promptChars: input.promptChars,
      completeness,
      sourcesTotal: 5,
      sources,
      context: {
        po: { chars: input.po?.length ?? 0, criteriaCount: input.acceptanceCriteria.length },
        technical: {
          chars: input.technical?.length ?? 0,
          requirements: {
            total: input.technicalRequirements.length,
            checklist: trChecklist,
            contract: trContract,
            validation: trValidation,
            errors: trErrors,
          },
        },
        qa: {
          chars: input.qa?.length ?? 0,
          testCases: { total: input.qaTestCases.length, happy, edge },
        },
        businessDiagram: {
          present: input.epicBusinessDiagram !== null,
          chars: input.epicBusinessDiagram?.length ?? 0,
        },
        dag: {
          totalSiblings: input.completedSiblings.length,
          hardDeps: hard,
          totalPaths: dagPaths,
        },
        dodCriteria: { count: input.dodCriteriaCount },
      },
    };
    const msg =
      `prompt.built ${input.promptChars}ch completeness=${completeness}/5 ` +
      `po=${payload.context.po.chars}ch(${input.acceptanceCriteria.length}AC) ` +
      `tech=${payload.context.technical.chars}ch(${input.technicalRequirements.length}TR:${trChecklist}cl+${trContract}ct+${trValidation}vl+${trErrors}er) ` +
      `qa=${payload.context.qa.chars}ch(${input.qaTestCases.length}TC:${happy}h+${edge}e) ` +
      `diag=${payload.context.businessDiagram.chars}ch ` +
      `dag=${input.completedSiblings.length}sib(${hard}hard,${dagPaths}paths) ` +
      `dod=${input.dodCriteriaCount}crit`;

    this.forgeClaimLogger.info(payload, msg);
  }

  /**
   * Carga las stories del mismo epic que YA completaron exitosamente, con
   * sus hard-deps marcadas. Se ejecuta DENTRO de la transacción del claim
   * para garantizar consistency (la ventana es trivialmente pequeña — read-
   * only de stories en estado terminal — pero respetamos el lock semantics).
   *
   * Ordena por completedAt DESC para que el agente vea primero las más
   * recientes (típicamente las que producen el contrato más actual).
   *
   * Cap a 20 siblings para defenderse de epics legacy con cientos de stories
   * — el prompt no escala bien a payloads gigantes y la utilidad marginal
   * cae rápidamente después de las primeras 10-15 más recientes.
   */
  private async loadCompletedSiblingsForStory(
    tx: Prisma.TransactionClient,
    currentStoryId: string,
    epicId: string,
  ): Promise<MaterializedClaim['completedSiblings']> {
    // Set de hard-deps de la story actual.
    const hardDeps = await tx.storyDependency.findMany({
      where: {
        storyId: currentStoryId,
        hardness: 'hard',
      },
      select: { blockedById: true },
    });
    const hardDepIds = new Set(hardDeps.map((d) => d.blockedById));

    // Stories del mismo epic completadas (status=done; in_review excluido
    // porque el PR aún no se mergeó al integration branch).
    const siblings = await tx.story.findMany({
      where: {
        epicId,
        id: { not: currentStoryId },
        status: 'done',
      },
      select: {
        id: true,
        title: true,
        agentRuns: {
          where: { status: 'completed' },
          orderBy: { completedAt: 'desc' },
          take: 1,
          select: {
            prNumber: true,
            filesModified: true,
            filesModifiedPaths: true,
            completedAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    return siblings
      .filter((s) => s.agentRuns.length > 0 && s.agentRuns[0].completedAt)
      .map((s) => {
        const run = s.agentRuns[0];
        return {
          storyId: s.id,
          title: s.title,
          isHardDep: hardDepIds.has(s.id),
          prNumber: run.prNumber,
          filesModified: run.filesModified,
          filesModifiedPaths: run.filesModifiedPaths ?? [],
          completedAt: run.completedAt!.toISOString(),
        };
      });
  }

  /**
   * Serializa el primer diagrama de negocio (`type === 'business'`) de la
   * épica a texto legible para el agente Forge. JSON estructurado de nodes/
   * edges es demasiado verboso para inyectar al prompt — formateamos el
   * `steps` array como lista numerada (preferred path) o fallback a una
   * descripción compacta de nodos + edges.
   *
   * NULL si la épica no tiene diagrama de negocio o el JSON está corrupto.
   * Defensa: cualquier exception interna se silencia con warn — el agente
   * sigue funcionando sin el diagrama, no es un blocker.
   */
  private serializeBusinessDiagram(diagramsJson: unknown, epicId: string): string | null {
    try {
      if (!Array.isArray(diagramsJson) || diagramsJson.length === 0) return null;
      const diagrams = diagramsJson as Array<{
        type?: string;
        name?: string;
        nodes?: Array<{ id: string; data?: { label?: string; type?: string } }>;
        edges?: Array<{ source: string; target: string; label?: string }>;
        steps?: Array<{ order: number; title: string; description: string }>;
      }>;
      const business = diagrams.find((d) => d?.type === 'business');
      if (!business) return null;

      const parts: string[] = [];
      if (business.name) parts.push(`**${business.name}**`);

      // Preferred: lista numerada de pasos (el agente QA + TL los redactaron
      // como narrativa legible del flujo). Si no hay steps, caemos al
      // dump compacto de nodos + edges.
      if (Array.isArray(business.steps) && business.steps.length > 0) {
        const sorted = [...business.steps].sort((a, b) => a.order - b.order);
        parts.push(``, `### Flujo del diagrama:`);
        for (const step of sorted) {
          parts.push(`${step.order}. **${step.title}** — ${step.description}`);
        }
      } else if (Array.isArray(business.nodes) && business.nodes.length > 0) {
        parts.push(``, `### Nodos:`);
        for (const node of business.nodes) {
          const label = node.data?.label ?? node.id;
          const nodeType = node.data?.type ? ` (${node.data.type})` : '';
          parts.push(`- ${label}${nodeType}`);
        }
        if (Array.isArray(business.edges) && business.edges.length > 0) {
          // Mapea ids a labels para legibilidad humana.
          const labelById = new Map<string, string>(
            business.nodes.map((n) => [n.id, n.data?.label ?? n.id]),
          );
          parts.push(``, `### Conexiones (flow):`);
          for (const edge of business.edges) {
            const from = labelById.get(edge.source) ?? edge.source;
            const to = labelById.get(edge.target) ?? edge.target;
            const via = edge.label ? ` — ${edge.label}` : '';
            parts.push(`- ${from} → ${to}${via}`);
          }
        }
      }

      return parts.length > 0 ? parts.join('\n') : null;
    } catch (err) {
      this.forgeClaimLogger.warn(
        {
          event: 'forge.claim.diagram.parse_failed',
          epicId,
          error: (err as Error).message,
        },
        `diagram.parse_failed epic=${epicId.slice(0, 8)} — ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Carga el código fuente COMPLETO del/los primary file(s) del diseño aprobado
   * de la épica para INLINEARLO en el prompt del coder (causa raíz 2026-06-02).
   *
   * Problema que resuelve: el handoff del diseño le pide al agente hacer
   * `vault_read` del primary file (ej. `aerovia.html`) y replicarlo pixel-
   * perfect, PERO el worker spawnea `claude -p` SIN la tool `vault_read` (solo
   * Read/Write/Bash sobre su sandbox) y el archivo del diseño vive FUERA del
   * workdir. Resultado: el agente nunca recibía el diseño y lo improvisaba.
   * Leyendo el contenido server-side acá y pasándolo a `buildStoryPrompt`, el
   * diseño SIEMPRE llega al modelo sin depender de una tool que el worker no
   * expone.
   *
   * Por cada `EpicDesign` con `bundleVaultPath` Y un `componentManifest`
   * con `primaryFilePath` válido: construye el path completo (normalizando a
   * UNA sola `/` entre el bundle y el relativo del primary), lo lee del vault
   * y acumula `{ path, content }`. Designs sin bundle (legacy URL handoff) o
   * sin manifest se saltan silenciosamente.
   *
   * FAIL-SOFT TOTAL: cualquier excepción (query DB, vault read, shape inválido)
   * se traga con un warn estructurado y devuelve `[]`. El claim NUNCA se cae
   * por esto — sin diseño inlineado el flow degrada al comportamiento previo
   * (el agente improvisa, como hacía antes del fix). Pérdida de fidelidad, NO
   * de liveness.
   */
  private async loadDesignReferenceFiles(
    epicId: string,
    runId: string,
  ): Promise<Array<{ path: string; content: string }>> {
    try {
      const epicWithDesigns = await this.prisma.epic.findUnique({
        where: { id: epicId },
        select: { designs: true },
      });
      const designs = (epicWithDesigns?.designs ?? []) as unknown as Array<{
        bundleVaultPath?: unknown;
        componentManifest?: unknown;
      }>;

      const files: Array<{ path: string; content: string }> = [];
      // Dedup por path: una épica podría tener 2 designs apuntando al mismo
      // primary (re-upload) — evitamos inlinear el mismo HTML dos veces.
      const seenPaths = new Set<string>();

      for (const design of designs) {
        const bundleVaultPath = design.bundleVaultPath;
        const manifest = design.componentManifest;
        // Validamos shape igual que el bloque de componentManifests existente:
        // bundleVaultPath debe ser string no vacío y el manifest debe traer un
        // primaryFilePath string. Cualquier otra cosa (legacy/null) → skip.
        if (typeof bundleVaultPath !== 'string' || bundleVaultPath.trim().length === 0) {
          continue;
        }
        if (
          manifest === null ||
          typeof manifest !== 'object' ||
          typeof (manifest as { primaryFilePath?: unknown }).primaryFilePath !== 'string'
        ) {
          continue;
        }
        const primaryFilePath = (manifest as { primaryFilePath: string }).primaryFilePath;
        if (primaryFilePath.trim().length === 0) continue;

        // Path completo = bundleVaultPath + primaryFilePath con EXACTAMENTE una
        // `/` de junta. `bundleVaultPath` normalmente ya trae trailing slash
        // (epics.service lo persiste así), pero normalizamos por robustez ante
        // datos legacy que pudieran no tenerlo.
        const fullPath = `${bundleVaultPath.replace(/\/+$/, '')}/${primaryFilePath.replace(/^\/+/, '')}`;

        // SECURITY (CWE-22 / CWE-639): tanto `bundleVaultPath` como
        // `primaryFilePath` viven en el JSONB de `epic.designs`, nominalmente
        // user-supplied vía Create/UpdateEpicDto. Un actor con EDIT_EPIC podría
        // plantar `primaryFilePath="../../../secrets/keys.md"` para exfiltrar
        // contenido FUERA del bundle inlineándolo en el prompt que viaja al
        // worker. Replicamos la guarda de path-traversal que epics.service ya
        // aplica sobre bundleVaultPath (líneas ~1938) — fail-closed: skip + log,
        // nunca leemos un path con traversal. Coste cero: un primary legítimo
        // generado por el extractor nunca contiene estos caracteres.
        if (
          fullPath.includes('..') ||
          fullPath.includes('\\') ||
          fullPath.includes('//') ||
          // eslint-disable-next-line no-control-regex
          /[\x00-\x1f]/.test(fullPath)
        ) {
          this.forgeClaimLogger.warn(
            {
              event: 'claim.design_inline.unsafe_path',
              runId,
              epicId,
              fullPath,
            },
            `[claim] Skipped design primary with unsafe path (traversal/control chars) — epic=${epicId.slice(0, 8)} path="${fullPath}"`,
          );
          continue;
        }

        // Anclaje (defensa en profundidad sobre la guarda de `..`): el primary
        // DEBE vivir dentro del subtree de su `bundleVaultPath` (server-anclado
        // al folder `disenos/<design>/` de la épica). Si por dato legacy el join
        // escapara del bundle, no lo leemos. Mismo patrón `startsWith(prefix)`
        // que deleteDesign (epics.service ~1957).
        const bundlePrefix = `${bundleVaultPath.replace(/\/+$/, '')}/`;
        if (!fullPath.startsWith(bundlePrefix)) {
          this.forgeClaimLogger.warn(
            { event: 'claim.design_inline.outside_bundle', runId, epicId, fullPath },
            `[claim] Skipped design primary fuera de su bundle subtree — epic=${epicId.slice(0, 8)} path="${fullPath}"`,
          );
          continue;
        }

        if (seenPaths.has(fullPath)) continue;
        seenPaths.add(fullPath);

        // Inner try/catch: un error transitorio leyendo ESTE primary (GitHub
        // 5xx/rate-limit/timeout) NO debe descartar los diseños ya acumulados
        // (qa-reviewer F-01). Skip de este archivo + seguir.
        let note;
        try {
          note = await this.vault.readNote(fullPath);
        } catch (readErr) {
          this.forgeClaimLogger.warn(
            {
              event: 'claim.design_inline.read_failed',
              runId,
              epicId,
              fullPath,
              error: (readErr as Error).message,
            },
            `[claim] Failed reading design primary "${fullPath}" — skip this file, keep the rest. epic=${epicId.slice(0, 8)}`,
          );
          continue;
        }
        if (!note || typeof note.content !== 'string' || note.content.trim().length === 0) {
          continue;
        }
        files.push({ path: fullPath, content: note.content });
      }

      return files;
    } catch (err) {
      this.forgeClaimLogger.warn(
        {
          event: 'claim.design_inline.load_failed',
          runId,
          epicId,
          error: (err as Error).message,
        },
        `[claim] Failed to inline design reference files — coder will fall back to improvising (no pixel-perfect source). epic=${epicId.slice(0, 8)}`,
      );
      return [];
    }
  }

  /**
   * Reporta progress de un run: refresca lastProgressAt + persiste lastOutput.
   *
   * Idempotente: el worker puede llamar varias veces, cada llamada solo
   * refresca el timestamp + sobrescribe lastOutput. Si el run ya está
   * completed/failed/abandoned, devuelve 410 Gone — el worker debe abandonar.
   */
  async reportProgress(runId: string, nodeId: string, dto: RunProgressDto): Promise<void> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { id: true, nodeId: true, status: true },
    });
    if (!run) throw new NotFoundException('AgentRun no encontrado');
    if (run.nodeId !== nodeId) {
      // Otro nodo mandando progress al run de un compañero — bug del worker.
      throw new ConflictException('Run no pertenece a este nodo');
    }
    if (AGENT_RUN_TERMINAL_STATUSES.includes(run.status as AgentRunStatus)) {
      throw new ConflictException(`Run ya está en estado terminal (${run.status})`);
    }

    // Si era 'claimed', esta es la primera señal de vida → 'running'.
    const newStatus: AgentRunStatus =
      run.status === 'claimed' ? 'running' : (run.status as AgentRunStatus);

    // F-12 defense-in-depth: el backend redacta lastOutput aunque el worker
    // ya lo haya hecho. Cargamos los valores de los secretos del org para
    // redactar también por valor exacto (los de terceros no tienen prefijo
    // que los patrones atrapen). Solo si hay lastOutput — evita el query
    // cuando el progress no trae output.
    const progressSecretValues =
      dto.lastOutput !== undefined
        ? (await this.externalSecrets.getAllPlaintext()).map((s) => s.value)
        : [];

    // SEC (Finding 2): validar ttydUrl contra allowlist de hosts internos
    // antes de persistir. Si el worker reporta una URL no-interna (host
    // externo, scheme peligroso, parsing fail), se descarta + log WARN; el
    // row mantiene el ttydUrl previo (o null) intacto. El log es la única
    // forma para el operador de diagnosticar por qué el iframe del terminal
    // queda en blanco — sin él, fallo silencioso.
    let safeTtydUrl: string | undefined;
    if (dto.ttydUrl !== undefined) {
      if (isInternalTtydUrl(dto.ttydUrl)) {
        safeTtydUrl = dto.ttydUrl;
      } else {
        this.logger.warn(
          `[run:${runId}] ttydUrl rechazado por security policy: ` +
            `'${dto.ttydUrl.slice(0, 120)}' no es URL interna ` +
            `(loopback / RFC 1918 / link-local). NO se persiste.`,
        );
      }
    }

    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: newStatus,
        lastProgressAt: new Date(),
        // F-12 defense-in-depth: redact server-side aunque el worker ya
        // lo haya hecho. Si trae secrets que pasaron filtros del worker
        // (regex incomplete, worker malicioso, output de un proceso hijo
        // que claude no redactó), aquí se quedan fuera de la DB.
        ...(dto.lastOutput !== undefined
          ? { lastOutput: redactServerSide(dto.lastOutput, progressSecretValues) }
          : {}),
        // HITO 1.6: persist criteria progress (worker milestones + agent custom)
        ...(dto.criteriaProgress !== undefined
          ? // Doble cast vía `unknown`: el DTO ahora es CriterionEventDto[] (validado),
// pero TS no acepta cast directo a InputJsonValue porque DTOs no tienen
// index signature. Mismo patrón que el cast de dodVerification abajo.
{ criteriaProgress: dto.criteriaProgress as unknown as Prisma.InputJsonValue }
          : {}),
        // HITO 1.5 + SEC (Finding 2): persistimos el ttydUrl solo si pasó la
        // allowlist de hosts internos en `safeTtydUrl` (ver arriba el bloque
        // de validación). Si fue rechazado, ya se logueó WARN y aquí
        // simplemente no escribimos — el row queda con su ttydUrl previo.
        ...(safeTtydUrl !== undefined ? { ttydUrl: safeTtydUrl } : {}),
        // Tier 1 Harness — UX progressive (2026-05-11): el worker manda
        // dodVerification parcial después de verificar cada criterio para
        // que la UI muestre checkmarks incrementales (1/N, 2/N, ...) en
        // lugar del salto 0/N → N/N al final. Mismo shape que persiste
        // /complete: array de { attempt, verdicts }. Sobrescribe el row
        // anterior — el worker ya envía el array acumulado del attempt
        // actual (no incremental delta).
        ...(dto.dodVerification !== undefined
          ? {
              // Doble cast (via unknown) — `DodVerificationEntry[]` es un
              // tipo concreto y Prisma.InputJsonValue requiere index signature
              // en objetos. El cast es seguro porque el shape de
              // DodVerificationEntry es JSON-compatible (solo primitives +
              // arrays + objects nested), pero TS no puede inferirlo.
              dodVerification:
                dto.dodVerification as unknown as Prisma.InputJsonValue,
            }
          : {}),
        // Cost real-time: el worker manda generatorUsage parcial después de
        // cada attempt completado (sin esperar al /complete). Permite que el
        // card "Cost" de la UI suba attempt-por-attempt en vez de saltar 0 → N.
        ...(dto.generatorUsage !== undefined
          ? {
              generatorUsage:
                dto.generatorUsage as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });

    if (dto.generatorUsage !== undefined) {
      // Log testigo del cost tracking — validado E2E 2026-05-12, downgrade a
      // debug en cleanup 2026-05-19. El `completeRun.cost.received` final ya
      // captura el agregado de la story.
      this.logger.debug(
        `[reportProgress:${runId}] cost.received: ` +
          `attempts=${dto.generatorUsage.callsCount} ` +
          `tokens=${dto.generatorUsage.totalInputTokens + dto.generatorUsage.totalOutputTokens} ` +
          `cost=$${dto.generatorUsage.totalCostUsd.toFixed(4)}`,
      );
    }
    this.logger.debug({ runId, nodeId, newStatus }, `[run:${runId}] progress nodeId=${nodeId} status=${newStatus}`);
  }

  /**
   * Completa un run (exitoso o fallido). El worker reporta el exit code
   * y opcionalmente el PR number creado.
   *
   * Semántica:
   *  - exitCode === 0 → run.status='completed' (Claude terminó limpio)
   *  - exitCode === 0 + prNumber set → adicionalmente story.status='in_review'
   *    (PR pendiente de revisión humana — flow de prod cuando Octokit esté)
   *  - exitCode === 0 + prNumber NULL → SANDBOX MODE: story.status='done'
   *    + claimedAt=NULL. Esto permite que el DAG fluya sin Octokit todavía
   *    (Sprint 3): las historias avanzan a done en cuanto claude termina
   *    limpio, lo cual desbloquea historias dependientes y permite que
   *    "todos los slots se usen dinámicamente". Cuando Sprint 3 traiga
   *    Octokit real, restauramos el flow normal: prNumber set → in_review
   *    (revisión humana), sin prNumber → considerar fallo.
   *  - exitCode ≠ 0 → run.status='failed'. SOLO esa story pasa a 'blocked'
   *    (estado terminal que escala al merge gate humano). Sin cascada
   *    (Q7 2026-05-21): las historias descendientes del DAG NO se bloquean
   *    — el fallo no se propaga, cada una corre y decide por sus méritos.
   *    NO hay re-claim automático de la story fallida: el retry es una
   *    acción humana explícita (botón "Reintentar" en el merge view).
   */
  async completeRun(runId: string, nodeId: string, dto: RunCompleteDto): Promise<void> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            status: true,
            epic: { select: { id: true, title: true } },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('AgentRun no encontrado');
    if (run.nodeId !== nodeId) {
      throw new ConflictException('Run no pertenece a este nodo');
    }
    if (AGENT_RUN_TERMINAL_STATUSES.includes(run.status as AgentRunStatus)) {
      throw new ConflictException(`Run ya está en estado terminal (${run.status})`);
    }

    const exitedClean = dto.exitCode === 0;
    // SEC-03: gate server-side para forceCompletion. El flag del worker
    // dispara mergePullRequest() real (squash merge irreversible vía Octokit).
    // Sin gate, un worker token leakeado puede auto-mergear PRs arbitrarios
    // saltándose el human review. Reglas:
    //  - production (NODE_ENV=production): hard-deny SIEMPRE, ignora la env var
    //  - dev/test: requiere FORGE_ALLOW_FORCE_COMPLETION=1 explícita
    //
    // El flujo MOCK end-to-end (DAG-vs-git-graph sync de wave anterior) sigue
    // funcionando si el operador setea ambas vars: DOD_VERIFIER_MOCK=1 en el
    // worker + FORGE_ALLOW_FORCE_COMPLETION=1 en el backend.
    const forceCompletionAllowed =
      process.env.NODE_ENV !== 'production' &&
      process.env.FORGE_ALLOW_FORCE_COMPLETION === '1';
    if (dto.forceCompletion === true && !forceCompletionAllowed) {
      this.logger.warn(
        `[run:${runId}] worker requested forceCompletion=true but server gate is closed ` +
          `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'}, ` +
          `FORGE_ALLOW_FORCE_COMPLETION=${process.env.FORGE_ALLOW_FORCE_COMPLETION ?? 'unset'}). ` +
          `Ignorando flag — story irá a in_review como en PROD.`,
      );
    }
    // Calculados early porque el bloque auto-merge (DAG-vs-git-graph sync)
    // necesita ambos. Sin auto-merge en MOCK las waves posteriores clonan un
    // integration branch sin los outputs previos → conflictos divergentes.
    // En PROD el merge queda al humano vía el PR abierto — comportamiento
    // sin cambio. `integrationBranch` se computa una vez y se reutiliza
    // tanto en PR creation como en el log del auto-merge.
    const forceCompletion =
      exitedClean && dto.forceCompletion === true && forceCompletionAllowed;
    const integrationBranch = `forge/sprint-batch-${run.story.epic.id.slice(0, 8)}`;

    // ════════════════════════════════════════════════════════════════════
    // HITO 5 — PR creation via Octokit cuando worker reportó push exitoso
    // ════════════════════════════════════════════════════════════════════
    //
    // El worker, después del git push, llama complete con prBranchPushed=true.
    // Aquí abrimos el PR contra la integration branch del epic. Si el push
    // fue exitoso pero la apertura del PR falla (red, rate limit, etc.) NO
    // marcamos failed — el run sigue como completed y dejamos `prNumber=null`
    // para que un cron/retry posterior pueda re-intentar. La defensa: el
    // commit ya está en remote, no se pierde trabajo.
    // SEC (security-reviewer 2026-05-22, Finding 1 / CWE-639): el prNumber
    // SOLO se setea internamente por `openStoryPullRequest` abajo — NUNCA
    // se acepta del worker. Aceptarlo del payload permitía a un worker
    // comprometido pasar el ID de un PR cualquiera del repo y el bloque de
    // auto-merge lo squash-mergeaba sin verificación de pertenencia (bypass
    // de human review + branch protection). El campo se borró del DTO.
    let prNumber: number | undefined = undefined;
    let prUrl: string | undefined;
    if (exitedClean && dto.prBranchPushed) {
      const prTitle = `[Forge] ${run.story.title}`;
      const prBody = [
        `## Auto-generated by CENZONTLE Forge`,
        ``,
        `**Story:** ${run.story.title}`,
        `**Epic:** ${run.story.epic.title}`,
        `**Run ID:** \`${runId}\``,
        `**Branch:** \`${run.branch}\``,
        ``,
        `Este PR fue creado automáticamente por un agente del Forge tras completar la implementación.`,
        `Revisores asignados (code-reviewer + security-reviewer) lo evaluarán antes del merge a la integration branch.`,
      ].join('\n');

      this.logger.info(
        `[run:${runId}] STORY_BLOCKED_BY_PR_CREATION attempt: ` +
          `openStoryPullRequest(head=${run.branch}, base=${integrationBranch})`,
      );
      try {
        const pr = await this.github.openStoryPullRequest({
          headBranch: run.branch,
          baseBranch: integrationBranch,
          title: prTitle,
          body: prBody,
        });
        prNumber = pr.prNumber;
        prUrl = pr.htmlUrl;
        this.logger.info(
          `[run:${runId}] STORY_BLOCKED_BY_PR_CREATION resolved: PR #${prNumber} abierto en ${prUrl}`,
        );
      } catch (err) {
        // PR creation falló pero el push sí ocurrió. No marcamos failed —
        // el commit está safe en remote. Loggeamos para que un humano
        // pueda re-intentar manualmente o un cron posterior. En MOCK mode
        // el auto-merge tampoco corre (skip silencioso del DAG-sync), por
        // lo que stories dependientes verán un base sin estos cambios.
        //
        // 2026-05-13: enriquecemos el log con status code + response body
        // de GitHub (cuando son accesibles desde Octokit RequestError). Esto
        // permite distinguir entre causa raíz comunes:
        //   - 404 "Not Found" → base branch no existe en remote
        //   - 422 "Validation Failed" → PR ya existe con mismo head, o head sin commits
        //   - 403 "Bad credentials" → token sin permisos
        //   - 429 / 403 X-RateLimit-Remaining=0 → rate limit
        const e = err as Error & {
          status?: number;
          response?: { data?: unknown; status?: number };
        };
        const ghStatus = e.status ?? e.response?.status ?? 'unknown';
        const ghResponseBody =
          e.response?.data !== undefined
            ? JSON.stringify(e.response.data).slice(0, 500)
            : 'unavailable';
        this.logger.error(
          `[run:${runId}] STORY_BLOCKED_BY_PR_CREATION FAILED ` +
            `head=${run.branch} base=${integrationBranch}: ` +
            `${e.message} (githubStatus=${ghStatus}, githubResponse=${ghResponseBody}). ` +
            `Commit safe en remote (${dto.commitSha?.slice(0, 7) ?? 'unknown'}). ` +
            `Story va a quedar atascada hasta que un humano abra el PR manualmente o se re-intente. ` +
            `Causa probable: base branch '${integrationBranch}' no existe en remote — verificar con ` +
            `\`gh api repos/<owner>/<repo>/branches/${integrationBranch}\`.`,
        );
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // DAG vs git-graph sync — auto-merge automático cross-story
    // ════════════════════════════════════════════════════════════════════
    //
    // CAMBIO 2026-05-16 (fix bug crítico): este bloque AHORA corre en
    // CUALQUIER modo (MOCK o real DoD verifier), no solo MOCK como antes.
    // El gate previo `forceCompletion &&` causaba que en modo real (sin
    // DOD_VERIFIER_MOCK=1) los PRs cross-story quedaran open silenciosamente
    // — el ConflictResolverService NUNCA se ejecutaba para resolver
    // overlaps comunes (package.json, .gitignore, etc.) en producción.
    //
    // Filosofía corregida del Forge:
    //   - Story passes DoD → PR opens → AUTO-MERGE a sprint-batch  ← acá
    //   - Sprint-batch acumula todo el trabajo del epic
    //   - "Approve & Merge to DEV" botón = human gate FINAL para sprint-batch → DEV
    //
    // El human-in-loop NO es en cada story PR — es en el merge consolidado
    // sprint-batch → DEV. Sin auto-merge cross-story, el DAG de stories
    // dependientes (Wave N+1) ve un sprint-batch vacío y los stories de Wave
    // N+1 fallan por no encontrar archivos de hard-deps.
    //
    // Gate ahora: solo requiere PR exists + push exitoso del worker. Si la
    // resolución manual es deseada (e.g., epic experimental), el operador
    // puede deshabilitar este path con env var (future enhancement) o
    // configurar branch protection en sprint-batch (GitHub block merges).
    //
    // autoMergeOk: tracking explícito de si el auto-merge funcionó (sea por
    // path happy o por ConflictResolverService Capa A/B). Si NO funcionó
    // (race condition, conflict no resolvible, branch protection),
    // el PR queda open y la story igual va a 'done' (per refactor semantics
    // 2026-05-16). El operador debe revisar el PR manualmente.
    let autoMergeOk = false;
    if (prNumber !== undefined && dto.prBranchPushed) {
      try {
        // Defensa en profundidad contra race condition de auto-merge concurrente
        // (diagnosticado 2026-05-13 con epics 95949b14 y 1ba4627e donde 2 stories
        // de la misma wave terminaban al ~mismo segundo y solo 1 mergeó;
        // refinado 2026-05-15 con epic f10c04b8 donde PR #98 falló por base
        // stale tras merge de su hermana):
        //   Capa 0 (updateBranch): pre-merge alinea head con base actualizado.
        //     Cuando stories paralelas terminan en orden no-determinístico, la
        //     primera mergea y avanza el integration branch — las siguientes
        //     ven `mergeable_state: behind`. `updateBranch` resuelve ese
        //     desfase de timing automáticamente cuando los archivos no
        //     overlap. Si overlap real → throw isMergeConflict → in_review
        //     honesto. SIN esta capa, conflicts de timing eran indistinguibles
        //     de conflicts reales y todos caían a in_review.
        //   Capa 1 (mutex): withMergeLock serializa update+merge como unidad
        //     atómica al mismo integrationBranch dentro del proceso del backend.
        //     Sin el lock, otra story podría mergear entre nuestro update y
        //     nuestro merge, dejando head stale otra vez.
        //   Capa 2 (retry): mergeWithRetry reintenta hasta 3 veces con backoff
        //     1s/2s/4s ante fallos transient (multi-replica, races externos,
        //     branch protection delay, GitHub rate limit). Post-updateBranch
        //     el merge debería ser fast-forward, así que esto es defensive.
        const mergeResult = await this.withMergeLock(integrationBranch, async () => {
          // Capa 0: alinear head con base antes de mergear. Si conflict real,
          // throw bubble-up al try/catch externo → cae a in_review.
          await this.updateBranchToBaseWithRetry(runId, prNumber!);
          // Capa 2: merge con retry. Post-update head está al día → fast-forward.
          return this.mergeWithRetry(
            runId,
            prNumber!,
            `[Forge] ${run.story.title} (#${prNumber})`,
            `Auto-merged por Forge en MOCK mode (forceCompletion=true).\nRun: ${runId}`,
          );
        });
        autoMergeOk = true;
        this.logger.info(
          `[run:${runId}] PR #${prNumber} auto-merged a ${integrationBranch} (sha=${mergeResult.sha?.slice(0, 7) ?? 'null'})`,
        );
        await this.cleanupBranchIfEnabled(run.branch, runId, 'story');
      } catch (mergeErr) {
        // Capa 3 (auto-resolve via ConflictResolverService) — preserva
        // paralelismo intra-wave intentando resolver conflicts REALES de
        // archivos cuando stories paralelas tocaron los mismos archivos
        // structured (típico: package.json, .gitignore, jest.config.js).
        //
        // Solo intenta resolver si el error es `isMergeConflict=true`
        // (conflict real, no transient). Para errores no-conflict
        // (branch protection, token, etc.), salta directo al log+in_review.
        //
        // Si el resolver auto-mergea exitosamente con un commit determinístico,
        // re-intenta el merge del PR (un solo intento — el head ya tiene
        // los cambios del base, debe ser fast-forward). Si re-merge falla
        // O resolver no pudo (archivo de código no resolvible por Capa A),
        // cae al log+in_review como antes.
        //
        // Esto elimina el caso típico de "SETUP y TESTS ambos modificaron
        // package.json paralelo → conflict real → in_review" sin sacrificar
        // paralelismo. Capa B (Sonnet judge para código real) pendiente.
        const isConflict = (mergeErr as Error & { isMergeConflict?: boolean }).isMergeConflict === true;
        let resolved = false;
        if (isConflict && prNumber !== undefined) {
          try {
            const creds = await this.github.getRepoCredentials();
            const resolution = await this.conflictResolver.tryAutoResolve({
              runId,
              prNumber,
              repoUrl: creds.repoUrl,
              headBranch: run.branch,
              baseBranch: integrationBranch,
              githubToken: creds.token,
            });

            if (resolution.ok) {
              this.logger.info(
                `[run:${runId}] PR #${prNumber} auto-resolved: ${resolution.resolvedFiles?.join(', ') ?? 'no files'}. ` +
                  `Re-intentando merge del PR...`,
              );
              // Bug #5 fix (2026-05-17): GitHub cache stale tras push del
              // resolver causa que `pulls.merge` API responda 405 con state
              // anterior durante ~3-10s post-push. Polleamos `mergeable_state`
              // hasta que esté READY antes de intentar merge. Sin esto, el
              // re-merge falla con 405 aunque el push fue exitoso y el conflict
              // ya está resuelto. Validado E2E: PR #132 (Capa B Sonnet)
              // requirió ~30s post-push para que GitHub re-evaluara — caía a
              // in_review por timing, no por bug real del resolver.
              await this.pollMergeableStateAfterResolverPush(runId, prNumber);

              // Re-intentar merge ahora que el head tiene la resolución
              // pusheada Y GitHub propagó el state. Usa el mismo mutex
              // para serialización con otras stories del mismo integration
              // branch. mergeWithRetry hace 3 attempts si state aún no
              // propagó completamente (backoff 1s/2s/4s = 7s extra).
              try {
                const reMerge = await this.withMergeLock(integrationBranch, () =>
                  this.mergeWithRetry(
                    runId,
                    prNumber,
                    `[Forge] ${run.story.title} (#${prNumber})`,
                    `Auto-merged por Forge tras conflict resolution (run ${runId}).`,
                    // allowConflictRetry: true → bug #5 fix. Si el primer
                    // attempt falla con 405 conflict puede ser cache stale
                    // GitHub aún propagando el push del resolver. Retry con
                    // backoff 1s/2s/4s = ~7s extra normalmente resuelve.
                    true,
                  ),
                );
                autoMergeOk = true;
                resolved = true;
                this.logger.info(
                  `[run:${runId}] PR #${prNumber} auto-merged tras conflict resolution (sha=${reMerge.sha?.slice(0, 7) ?? 'null'})`,
                );
                await this.cleanupBranchIfEnabled(run.branch, runId, 'story');
              } catch (reMergeErr) {
                this.logger.error(
                  `[run:${runId}] PR #${prNumber} re-merge post-resolution failed: ${(reMergeErr as Error).message}. ` +
                    `Resolución pusheada pero PR sigue conflicting — humano debe investigar.`,
                );
              }
            } else {
              this.logger.info(
                `[run:${runId}] PR #${prNumber} conflict no resolvible automáticamente: ${resolution.reason}. ` +
                  `Cayendo a in_review.`,
              );
            }
          } catch (resolverErr) {
            this.logger.warn(
              `[run:${runId}] PR #${prNumber} ConflictResolverService throw inesperado: ${(resolverErr as Error).message}. ` +
                `Cayendo a in_review (mismo comportamiento que sin resolver).`,
            );
          }
        }

        if (!resolved) {
          // Fallo tras agotar todos los retries Y respetando el mutex. Esto
          // indica un problema NO transient (branch protection rule real,
          // token sin permisos, conflict real no resolvible por Capa A) —
          // propagación a 'in_review' es la decisión correcta porque no
          // es una race recuperable.
          this.logger.error(
            `[run:${runId}] auto-merge del PR #${prNumber} FAILED tras retries: ${(mergeErr as Error).message}. ` +
              `Story cae a 'in_review' (NO 'done') para bloquear stories dependientes hasta resolución manual del PR.`,
          );
        }
      }
    }

    // Transición de la story según el outcome del run:
    //  - movedToReview (variable name legacy): el worker terminó limpio + hay
    //    PR + el worker pushó la branch. Status sale a 'done' (per semantics
    //    refactor 2026-05-16) porque coder + DoD + PR push completados.
    //    El auto-merge a sprint-batch ocurrió arriba (independiente de MOCK
    //    o real mode tras fix 2026-05-16). Si autoMergeOk=true: PR mergeado,
    //    sprint-batch tiene los commits. Si autoMergeOk=false: PR queda open
    //    en GitHub para resolución humana, pero la story igual marca 'done'
    //    para no bloquear el DAG (el sweeper detecta stuck-claimed por TTL).
    //  - movedToDoneSandbox: sandbox path (sin push ni PR). Story 'done'
    //    sin trabajo en remoto.
    //  - El nombre 'in_review' queda RESERVADO para epic futuro de reviewer
    //    agents (code-review/security/arch). Flow futuro:
    //      done(coder) → in_review(reviewers corriendo) → released.
    const movedToReview =
      exitedClean && prNumber !== undefined && dto.prBranchPushed === true;
    const movedToDoneSandbox =
      exitedClean && !dto.prBranchPushed && prNumber === undefined;
    const finalStatus: AgentRunStatus = exitedClean ? 'completed' : 'failed';
    const now = new Date();

    // ════════════════════════════════════════════════════════════════════
    // DEBUG: snapshot completo del estado de decisión. Cualquier story que
    // queda "in queue" después del review de acceptance criteria debería
    // tener su trace acá. Si movedToReview=false Y movedToDoneSandbox=false
    // con exitedClean=true → la story queda atascada (caso bug del usuario).
    // ════════════════════════════════════════════════════════════════════
    // Ambas branches reportan 'done' como expectedTransition tras el cambio
    // de semantics 2026-05-16 (status='done' inmediato post-DoD + PR push).
    const expectedTransition = movedToReview
      ? 'done'
      : movedToDoneSandbox
        ? 'done'
        : exitedClean
          ? 'NO_TRANSITION_STUCK'
          : 'NO_TRANSITION_FAILED';
    this.logger.info(
      `[completeRun:${runId}] decision: ` +
        `exitCode=${dto.exitCode} exitedClean=${exitedClean} ` +
        `prNumber=${prNumber ?? 'null'} prBranchPushed=${dto.prBranchPushed ?? false} ` +
        `forceCompletion=${forceCompletion} autoMergeOk=${autoMergeOk} ` +
        `attempts=${dto.attempts ?? 'undefined'} ` +
        `→ movedToReview=${movedToReview} movedToDoneSandbox=${movedToDoneSandbox} ` +
        `expectedTransition=${expectedTransition}`,
    );

    // Log testigo de cost tracking — validado E2E 2026-05-12. Downgrade a
    // debug 2026-05-19: el feature ya está estable y el card Cost del batch
    // detail muestra los valores agregados. Si hay regresión, levantar a info.
    const generatorCost = dto.generatorUsage?.totalCostUsd ?? 0;
    const generatorTokens = dto.generatorUsage
      ? dto.generatorUsage.totalInputTokens + dto.generatorUsage.totalOutputTokens
      : 0;
    const generatorAttempts = dto.generatorUsage?.callsCount ?? 0;
    const verifierAttemptsCount = dto.dodVerification?.length ?? 0;
    this.logger.debug(
      `[completeRun:${runId}] cost.received: ` +
        `generator(present=${dto.generatorUsage !== undefined}, ` +
        `attempts=${generatorAttempts}, tokens=${generatorTokens}, cost=$${generatorCost.toFixed(4)}) ` +
        `verifier(attempts=${verifierAttemptsCount}, dodVerification.present=${dto.dodVerification !== undefined})`,
    );

    // F-12 defense-in-depth: redact errorMessage y lastOutput antes de
    // persistir. Aunque el worker honesto ya lo hace, aquí blindamos
    // contra workers maliciosos / regex skips. Cargamos los valores de los
    // secretos del org para redactar también por valor exacto — los de
    // terceros tienen formato arbitrario y los patrones por sí solos no los
    // atrapan.
    const completeSecretValues = (
      await this.externalSecrets.getAllPlaintext()
    ).map((s) => s.value);
    const redactedErrorMessage = redactServerSide(
      dto.errorMessage,
      completeSecretValues,
    );
    const redactedLastOutput = redactServerSide(
      dto.lastOutput,
      completeSecretValues,
    );

    // Tipo explícito del array: las ramas condicionales arman distintos
    // tipos de PrismaPromise (story.update vs agentRun.update); la anotación
    // evita que TS intente unificarlos en un tuple homogéneo y falle.
    const txOps: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          exitCode: dto.exitCode,
          prNumber,
          errorMessage: redactedErrorMessage,
          lastOutput: redactedLastOutput,
          completedAt: now,
          // HITO 1.5: ttyd ya no está vivo cuando el run termina; limpiamos
          // la URL para que el frontend muestre el viewer estático del
          // lastOutput en lugar del iframe (que devolvería ECONNREFUSED).
          ttydUrl: null,
          // HITO 1.6: si el worker mandó criteriaProgress final, lo persistimos.
          // El último estado de progress ya estará en DB, pero el complete
          // puede traer marks adicionales que ocurrieron post-último-progress
          // (auto.commit, branch.pushed) si claude tardó <30s en terminar.
          ...(dto.criteriaProgress !== undefined
            ? // Doble cast vía `unknown`: el DTO ahora es CriterionEventDto[] (validado),
// pero TS no acepta cast directo a InputJsonValue porque DTOs no tienen
// index signature. Mismo patrón que el cast de dodVerification abajo.
{ criteriaProgress: dto.criteriaProgress as unknown as Prisma.InputJsonValue }
            : {}),
          // Tier 1 Harness: persistir attempts y verificación log estructurada
          // para visibility en UI (timeline de attempts + cuáles criterios
          // pasaron/fallaron en cada uno).
          ...(dto.attempts !== undefined ? { attempts: dto.attempts } : {}),
          ...(dto.dodVerification !== undefined
            ? {
                // Mismo doble cast que en reportProgress — DodVerificationEntry[]
                // → Prisma.InputJsonValue vía `unknown` (shape JSON-compatible
                // pero TS necesita la bridge explícita).
                dodVerification:
                  dto.dodVerification as unknown as Prisma.InputJsonValue,
              }
            : {}),
          // Generator usage (Haiku) — cost/tokens del agente que escribe el código.
          // Separado del verifier (Sonnet) porque son modelos distintos. El
          // backend suma ambos en getBatchDetail.
          ...(dto.generatorUsage !== undefined
            ? {
                generatorUsage:
                  dto.generatorUsage as unknown as Prisma.InputJsonValue,
              }
            : {}),
          // Files modified — count del diff base..HEAD calculado por el worker
          // post-push. Visible en el AgentCard como "X files".
          ...(dto.filesModified !== undefined
            ? { filesModified: dto.filesModified }
            : {}),
          // Files modified PATHS — lista exacta de archivos tocados.
          // Inyectada en el prompt del próximo agente del DAG via
          // `completedSiblings` cuando reclama una story que depende de
          // ésta. Cap de seguridad: 200 paths (defensa contra runs masivos
          // accidentales). El worker ya trunca antes de enviar; defensive
          // depth: re-truncamos acá por si el DTO validator se evade.
          ...(dto.filesModifiedPaths !== undefined
            ? { filesModifiedPaths: dto.filesModifiedPaths.slice(0, 200) }
            : {}),
        },
      }),
      // Transición de la historia depende del modo:
      //  - movedToReview (con PR real): 'done' tras refactor semantics 2026-05-16.
      //    Antes era 'in_review' por convención, pero NO había reviewer agents
      //    corriendo — el status era meramente "PR open awaiting nothing".
      //    Ahora reservamos 'in_review' para el epic futuro donde reviewer
      //    agents (code/security/arch) sí evaluarán. Por ahora: PR push +
      //    DoD pass = done. El estado del PR mismo (merged/open/closed) se
      //    consulta vía Octokit, NO se proyecta al status de la story.
      //  - movedToDoneSandbox (sin push O MOCK+merge OK): done directo +
      //    claimedAt=NULL para liberar el slot del DAG.
      //  - !exitedClean (run falló — exit≠0): SOLO esa story pasa a 'blocked'.
      //    blocked es TERMINAL: el SQL de claimStory excluye la story como
      //    candidata (no auto-retry) PERO la acepta como blocker resuelto, así
      //    que sus dependientes del DAG corren igual. blocked cuenta para
      //    awaitingHumanGate → el batch llega al merge gate. El operador ve la
      //    story en el merge view ("Stories sin completar") y decide:
      //    reintentar o cerrar el sprint asumiendo la brecha.
      //  - else (exitedClean pero sin transición — PR creation falló): no se
      //    mueve, queda en su status anterior (caso atascado, log WARN abajo).
      ...(movedToReview || movedToDoneSandbox
        ? [
            this.prisma.story.update({
              where: { id: run.storyId },
              data: { status: 'done' as const, claimedAt: null },
            }),
          ]
        : !exitedClean
          ? [
              // Q7 (2026-05-21): SIN cascada. Un run fallido marca 'blocked'
              // SOLO su propia story — las descendientes hard del DAG ya NO
              // se bloquean en cascada. El fallo de una historia no es deuda
              // de las que dependen de ella: el orden del DAG se respeta
              // igual (claimStory acepta un blocker 'blocked' como resuelto),
              // así que las dependientes corren con normalidad y deciden por
              // sus propios méritos. El merge gate igual se alcanza — cada
              // descendiente llega a su propio estado terminal.
              // updateMany (no .update): el guard `status NOT IN
              // ('done','in_review')` evita que un run viejo que reporta su
              // fallo tarde degrade una story que otro run ya completó
              // (carrera con retry manual / sweeper — qa-reviewer 2026-05-21).
              // updateMany no lanza si 0 filas matchean; .update sí lo haría.
              this.prisma.story.updateMany({
                where: {
                  id: run.storyId,
                  status: { notIn: ['done', 'in_review'] },
                },
                data: { status: 'blocked' as const, claimedAt: null },
              }),
            ]
          : []),
    ];
    await this.prisma.$transaction(txOps);

    // Log granular del transition para forensics y queryability en Loki.
    // Evento queryable: `story.status.done` por runId. Si en el epic futuro
    // de reviewer agents se reintroduce 'in_review', habrá un evento paralelo
    // `story.status.in_review` con su propio call site.
    if (movedToReview || movedToDoneSandbox) {
      this.logger.info(
        `[run:${runId}] event=story.status.done storyId=${run.storyId} ` +
          `prNumber=${prNumber ?? 'none'} prBranchPushed=${dto.prBranchPushed ?? false} ` +
          `path=${movedToReview ? 'pr-flow' : 'sandbox-or-mock'} ` +
          `(coder + DoD + PR push completados; reviewer agents son trabajo futuro)`,
      );
    } else if (!exitedClean) {
      // Evento queryable en Loki: `story.status.blocked` por runId. Marca el
      // momento en que un fallo del agente escala a decisión humana (gate).
      this.logger.info(
        `[run:${runId}] event=story.status.blocked storyId=${run.storyId} ` +
          `exitCode=${dto.exitCode} ` +
          `(run falló — story marcada blocked, escala al merge gate humano)`,
      );
    }

    const durationMs = now.getTime() - run.startedAt.getTime();
    if (exitedClean) {
      this.logger.info(
        `[run:${runId}] COMPLETE nodeId=${nodeId} prNumber=${prNumber ?? 'none'} prBranchPushed=${dto.prBranchPushed ?? false} movedToReview=${movedToReview} movedToDoneSandbox=${movedToDoneSandbox} duration=${durationMs}ms`,
      );
    } else {
      // SECURITY (F-02): NO loguear errorMessage completo (puede contener
      // tokens/secretos del stdout de claude). Solo primeros 80 chars de
      // la versión REDACTADA (F-12) y sin echo del output del modelo.
      this.logger.error(
        `[run:${runId}] FAIL nodeId=${nodeId} exitCode=${dto.exitCode} errMsg="${(redactedErrorMessage ?? '').slice(0, 80)}" duration=${durationMs}ms`,
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // DEBUG: detección explícita del caso "story atascada en queue". Si
    // exitedClean=true (DoD pasó) pero NI movedToReview NI movedToDoneSandbox
    // se activaron, la story NO transicionó. Esto es el bug del usuario:
    // el operador ve la story "esperando" en la pipeline del Forge sin
    // saber por qué. Este log WARN dispara una señal forense clara que
    // permite reconstruir la cadena de decisiones en post-mortem.
    //
    // Causas conocidas que llevan acá:
    //  - exitedClean=true + prBranchPushed=true + prNumber=undefined
    //    → push exitoso pero PR creation falló en líneas 720-737. Story
    //      queda con código en remote pero sin PR para mergear.
    //  - exitedClean=true + prBranchPushed=false + prNumber=N
    //    → PR existía de un run previo pero el worker actual no pushó.
    //      Inconsistencia que indica bug en upstream del DTO.
    //  - exitedClean=true + algún flag con valor inesperado (null, undefined)
    //    → bug de validación del DTO. Acción: agregar guard en upstream.
    //
    // Acción del operador: revisar el log inmediatamente anterior
    // `[completeRun:${runId}] decision: ...` para ver TODOS los flags.
    // ════════════════════════════════════════════════════════════════════
    if (exitedClean && !movedToReview && !movedToDoneSandbox) {
      this.logger.warn(
        `[run:${runId}] STORY_STUCK storyId=${run.storyId} ` +
          `nodeId=${nodeId} ` +
          `exitedClean=true PERO NI movedToReview NI movedToDoneSandbox. ` +
          `Story queda en su status previo con claimedAt set. ` +
          `Flags: prNumber=${prNumber ?? 'null'} prBranchPushed=${dto.prBranchPushed ?? false} ` +
          `forceCompletion=${forceCompletion} autoMergeOk=${autoMergeOk}. ` +
          `Causa probable: ${
            dto.prBranchPushed && prNumber === undefined
              ? 'push OK pero PR creation falló (revisar GitHub API logs upstream)'
              : !dto.prBranchPushed && prNumber !== undefined
                ? 'PR existe pero worker no reportó push — DTO inconsistente'
                : 'condición de carrera o flag inconsistente'
          }. Sweeper limpia abandoned a 10min; mientras, story bloqueada.`,
      );
    }
  }

  /**
   * Lee el detalle de un run específico — usado por la página
   * `/factory/agents/:runId/terminal` para mostrar `lastOutput` con
   * polling. Incluye info de la story+epic+node para el header del
   * viewer (qué se está haciendo, en qué máquina, en qué branch).
   *
   * Retorna null si el run no existe (en lugar de throw para que el
   * caller pueda hacer fallback graceful).
   */
  async getRunDetail(runId: string) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            storyPoints: true,
            tracker: true,
            epic: { select: { id: true, title: true, tracker: true } },
            // Historias que bloquean a ésta (deps duras/blandas del DAG).
            // El drawer las muestra en la fila "Depends on".
            blockedBy: {
              select: {
                blockedBy: {
                  select: { id: true, title: true, tracker: true },
                },
              },
            },
          },
        },
        node: { select: { id: true, name: true, type: true } },
      },
    });
    if (!run) return null;

    // Cost + tokens-new del run — generator + verifier + planner. Reusa el
    // helper compartido `computeRunStats` para que el AgentDetailDrawer sume
    // EXACTAMENTE lo mismo que el AgentCard (vía `getBatchDetail`): antes este
    // callsite omitía el cost del verifier e incluía cache_read en tokens.
    const runStats = computeRunStats(run);

    // Tracker key de la story (Json `{ externalKey?, ... }`).
    const storyTracker = run.story.tracker as Record<string, unknown> | null;
    const storyTrackerKey =
      storyTracker && typeof storyTracker.externalKey === 'string'
        ? storyTracker.externalKey
        : null;

    // Tracker key del epic (Json `{ externalKey?, ... }`).
    const epicTracker = run.story.epic.tracker as Record<string, unknown> | null;
    const epicTrackerKey =
      epicTracker && typeof epicTracker.externalKey === 'string'
        ? epicTracker.externalKey
        : null;

    // Stories de las que ésta depende → { key, title } para el drawer.
    const dependsOn = run.story.blockedBy.map((dep) => {
      const depTracker = dep.blockedBy.tracker as Record<string, unknown> | null;
      return {
        key:
          depTracker && typeof depTracker.externalKey === 'string'
            ? depTracker.externalKey
            : null,
        title: dep.blockedBy.title,
      };
    });

    return {
      runId: run.id,
      status: run.status as AgentRunStatus,
      branch: run.branch,
      lastOutput: run.lastOutput ?? '',
      lastProgressAt: run.lastProgressAt.toISOString(),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      exitCode: run.exitCode,
      errorMessage: run.errorMessage,
      prNumber: run.prNumber,
      // HITO 1.5: URL del ttyd vivo durante el run (null si terminó o nunca arrancó)
      ttydUrl: run.ttydUrl,
      // HITO 1.6: timeline de criterios/milestones (worker + agente)
      criteriaProgress: run.criteriaProgress,
      // Tier 1 Harness: total attempts del DoD loop + log estructurado de
      // verdicts por criterio en cada attempt. Frontend pinta cada criterio
      // del DoD según el último verdict de dodVerification.
      attempts: run.attempts,
      dodVerification: run.dodVerification,
      storyId: run.story.id,
      storyTitle: run.story.title,
      epicId: run.story.epic.id,
      epicTitle: run.story.epic.title,
      nodeId: run.node.id,
      nodeName: run.node.name,
      nodeType: run.node.type,
      // Métricas reales del run — consumidas por el AgentDetailDrawer.
      durationMs: run.completedAt
        ? run.completedAt.getTime() - run.startedAt.getTime()
        : null,
      costUsd: runStats.costUsd,
      tokensNew: runStats.tokensNew,
      filesModified: run.filesModified,
      storyPoints: run.story.storyPoints,
      storyTrackerKey,
      epicTrackerKey,
      dependsOn,
    };
  }

  /**
   * Lista runs activos (claimed | running) con metadata útil para el
   * Resource Pool drawer del frontend. Joins con story → epic para que
   * el UI muestre "qué historia está corriendo en cada nodo" sin hacer
   * fetch adicional.
   *
   * Cost: 1 query con JOIN, indexed por `status`. Polling cada 5s del
   * frontend → ~12 queries/min con dataset pequeño (runs activos < 50).
   */
  async listActiveRuns(): Promise<
    Array<{
      runId: string;
      nodeId: string;
      storyId: string;
      storyTitle: string;
      epicId: string;
      epicTitle: string;
      status: AgentRunStatus;
      branch: string;
      startedAt: string;
      lastProgressAt: string;
    }>
  > {
    const runs = await this.prisma.agentRun.findMany({
      where: {
        status: { in: [...AGENT_RUN_ACTIVE_STATUSES] },
      },
      select: {
        id: true,
        nodeId: true,
        status: true,
        branch: true,
        startedAt: true,
        lastProgressAt: true,
        story: {
          select: {
            id: true,
            title: true,
            epic: {
              select: { id: true, title: true },
            },
          },
        },
      },
      orderBy: { startedAt: 'asc' },
    });

    return runs.map((r) => ({
      runId: r.id,
      nodeId: r.nodeId,
      storyId: r.story.id,
      storyTitle: r.story.title,
      epicId: r.story.epic.id,
      epicTitle: r.story.epic.title,
      status: r.status as AgentRunStatus,
      branch: r.branch,
      startedAt: r.startedAt.toISOString(),
      lastProgressAt: r.lastProgressAt.toISOString(),
    }));
  }

  /**
   * Sweeper cron: marca abandoned los runs sin progress reciente y resetea
   * `story.claimedAt = NULL` para permitir re-claim por otro worker.
   *
   * Idempotencia (QA-reviewer F-02 2026-05-06): el filtro `status` en el
   * updateMany es CRÍTICO — el findMany ocurre en t1, el updateMany en t2,
   * y entre medias el worker pudo haber reportado complete (status pasó
   * a completed/failed). Sin el filtro, sobrescribiríamos un terminal con
   * 'abandoned' y perderíamos el resultado real. Lo mismo aplica al story
   * update: solo reseteamos claimedAt si AÚN está set (worker pudo haberlo
   * actualizado en complete).
   *
   * Ejecutado por FleetSweeperService cada minuto.
   */
  async sweepStaleRuns(): Promise<number> {
    const threshold = new Date(Date.now() - STALE_RUN_MS);
    const stale = await this.prisma.agentRun.findMany({
      where: {
        status: { in: [...AGENT_RUN_ACTIVE_STATUSES] },
        lastProgressAt: { lt: threshold },
      },
      select: { id: true, storyId: true, nodeId: true },
    });

    if (stale.length === 0) return 0;

    const now = new Date();
    const staleIds = stale.map((r) => r.id);
    const staleStoryIds = stale.map((r) => r.storyId);
    const [updatedRuns, updatedStories] = await this.prisma.$transaction([
      this.prisma.agentRun.updateMany({
        // Idempotente: si el worker ya reportó complete entre el findMany
        // y este updateMany, status ya no será claimed/running y el filtro
        // lo excluye → no sobrescribimos un terminal real.
        where: {
          id: { in: staleIds },
          status: { in: [...AGENT_RUN_ACTIVE_STATUSES] },
        },
        data: {
          status: 'abandoned',
          completedAt: now,
          errorMessage: `Run abandoned by sweeper after ${STALE_RUN_MS / 60_000}min without progress`,
        },
      }),
      this.prisma.story.updateMany({
        // Idempotente igual: si claimedAt ya es NULL (worker lo hizo en
        // un complete reciente), no tocamos. NOT { claimedAt: null }
        // por la condición.
        where: {
          id: { in: staleStoryIds },
          claimedAt: { not: null },
        },
        data: { claimedAt: null },
      }),
    ]);

    this.logger.warn(
      `[sweeper:runs] inspected=${stale.length} markedAbandoned=${updatedRuns.count} resetClaimedAt=${updatedStories.count} runIds=[${stale.map((r) => r.id.slice(0, 8)).join(',')}]`,
    );
    return updatedRuns.count;
  }

}
