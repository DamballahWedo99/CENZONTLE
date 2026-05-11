import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AGENT_RUN_ACTIVE_STATUSES,
  AGENT_RUN_TERMINAL_STATUSES,
  type AgentRunStatus,
  type ClaimedStory,
} from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgAnthropicConfigService } from './org-anthropic-config.service';
import { ForgePromptBuilderService } from './forge-prompt-builder.service';
import { GitHubService } from '../github/github.service';
import { DodService } from '../dod/dod.service';
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

function redactServerSide(text: string | undefined | null): string | undefined {
  if (text == null) return undefined;
  let out = text;
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
  private readonly logger = new Logger(AgentRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAnthropicConfig: OrgAnthropicConfigService,
    private readonly promptBuilder: ForgePromptBuilderService,
    private readonly github: GitHubService,
    private readonly dod: DodService,
  ) {}

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
    try {
      return await this.prisma.$transaction(async (tx) => {
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
        const claimedRows = await tx.$queryRaw<ClaimedStoryRow[]>`
          WITH ready_stories AS (
            SELECT s.id, s."epicId", s.title, s."podId"
            FROM stories s
            JOIN epics e ON s."epicId" = e.id
            WHERE e."enqueuedAt" IS NOT NULL
              AND s."claimedAt" IS NULL
              AND s.status != 'done'
              AND NOT EXISTS (
                SELECT 1 FROM story_dependencies dep
                JOIN stories blocker ON blocker.id = dep."blockedById"
                WHERE dep."storyId" = s.id
                  AND dep.hardness = 'hard'
                  AND blocker.status != 'done'
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

        return await this.materializeClaim(tx, nodeId, tokenId, claimedRows);
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
  }

  /**
   * Continuación del claim DENTRO de la transacción: lookup del story para
   * el prompt, INSERT del AgentRun, fetch del ANTHROPIC_API_KEY.
   *
   * Refactor del bloque post-CTE (qa-reviewer F-B 2026-05-06) para
   * mantener todo bajo el mismo $transaction. `tx` es el cliente Prisma
   * con el lock activo; cualquier throw aborta la transacción y revierte
   * tanto el `claimedAt=NOW()` como el `agentRun.create`.
   */
  private async materializeClaim(
    tx: Prisma.TransactionClient,
    nodeId: string,
    tokenId: string,
    claimedRows: ClaimedStoryRow[],
  ): Promise<ClaimedStory | null> {
    if (claimedRows.length === 0) {
      this.logger.debug(`[claim] nodeId=${nodeId} → 204 noStoriesReady`);
      return null;
    }

    const claimed = claimedRows[0];

    // Branch naming: forge/epic-<short>/story-<short>. Reusa primeros 8
    // chars del UUID como en lib/short-id.ts (frontend) — consistente UX.
    const branch = `forge/epic-${claimed.epicId.slice(0, 8)}/story-${claimed.id.slice(0, 8)}`;

    // Lee la story DENTRO de la transacción para construir el prompt.
    const story = await tx.story.findUnique({
      where: { id: claimed.id },
      include: {
        epic: { select: { id: true, title: true, markdown: true } },
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

    // Construye el prompt vía ForgePromptBuilderService. Antes era un
    // helper privado en este service (architecture-reviewer F-04
    // 2026-05-06: SRP — AgentRunService coordina lifecycle, no formatea
    // prompts).
    //
    // Inyectamos el catálogo de DoD configurado por el operador en
    // `/factory/settings/Definition of Done` para que el agente sepa qué
    // criterios bloquean el merge ANTES de empezar a trabajar. Solo los
    // `enabled` (todos hoy, por construcción del modelo nuevo) — y solo
    // los campos visibles al agente: `text` + `description`.
    // Incluimos `kind` además de text/description porque el worker lo
    // usa para mapear a verificación determinística (dod-verifier.ts).
    // El prompt builder solo necesita text/description pero ignora kind
    // cuando lo recibe — sin overhead.
    const dodCriteria = (await this.dod.findAll())
      .filter((c) => c.enabled)
      .map((c) => ({ kind: c.kind, text: c.text, description: c.description }));
    const prompt = this.promptBuilder.buildStoryPrompt({
      epicTitle: story.epic.title,
      epicMarkdown: story.epic.markdown,
      storyTitle: story.title,
      dodCriteria,
    });

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
    try {
      const { cloneUrl, defaultBranch } = await this.github.getCloneUrl();
      const integrationBranch = `forge/sprint-batch-${claimed.epicId.slice(0, 8)}`;

      // Idempotente: si la integration branch ya existe (re-encole), retorna
      // la existente. Si NO existe, la crea desde defaultBranch (DEV/main).
      // Esto se hace ANTES de devolver al worker para garantizar que cuando
      // el worker pushee `forge/epic-X/story-Y`, la base ya existe en remote.
      await this.github.createIntegrationBranch({
        branchName: integrationBranch,
        devBranch: defaultBranch,
        epicId: claimed.epicId,
      });

      repoUrl = cloneUrl;
      baseBranch = integrationBranch;
      this.logger.log(
        `[claim:${agentRun.id}] git wired: integrationBranch=${integrationBranch} (from ${defaultBranch})`,
      );
    } catch (err) {
      // Sin code repo configurado, o error en GitHub API. Fallback a sandbox
      // mode — el run sigue ejecutando localmente sin clone/push.
      this.logger.warn(
        `[claim:${agentRun.id}] git integration unavailable, falling back to sandbox mode: ${(err as Error).message}`,
      );
    }

    this.logger.log(
      `[claim:${agentRun.id}] nodeId=${nodeId} tokenId=${tokenId.slice(0, 8)} → storyId=${claimed.id} epicId=${claimed.epicId} branch=${branch} mode=${repoUrl ? 'git' : 'sandbox'}`,
    );

    return {
      runId: agentRun.id,
      storyId: claimed.id,
      storyTitle: claimed.title,
      epicId: claimed.epicId,
      branch,
      prompt,
      repoUrl,
      baseBranch,
      anthropicApiKey,
      dodCriteria,
    };
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
          ? { lastOutput: redactServerSide(dto.lastOutput) }
          : {}),
        // HITO 1.6: persist criteria progress (worker milestones + agent custom)
        ...(dto.criteriaProgress !== undefined
          ? { criteriaProgress: dto.criteriaProgress as Prisma.InputJsonValue }
          : {}),
        // HITO 1.5: la primera vez que el worker reporta ttydUrl, lo persistimos
        // para que el frontend pueda mostrar iframe del terminal en vivo
        ...(dto.ttydUrl !== undefined ? { ttydUrl: dto.ttydUrl } : {}),
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
      },
    });

    this.logger.debug(`[run:${runId}] progress nodeId=${nodeId} status=${newStatus}`);
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
   *  - exitCode ≠ 0 → run.status='failed', story.status no cambia, el
   *    sweeper eventualmente dejará claimedAt=NULL para retry manual
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
    let prNumber: number | undefined = dto.prNumber; // legacy: worker pudo mandarlo
    let prUrl: string | undefined;
    if (exitedClean && dto.prBranchPushed && prNumber === undefined) {
      const integrationBranch = `forge/sprint-batch-${run.story.epic.id.slice(0, 8)}`;
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

      try {
        const pr = await this.github.openStoryPullRequest({
          headBranch: run.branch,
          baseBranch: integrationBranch,
          title: prTitle,
          body: prBody,
        });
        prNumber = pr.prNumber;
        prUrl = pr.htmlUrl;
        this.logger.log(
          `[run:${runId}] PR #${prNumber} abierto: ${prUrl}`,
        );
      } catch (err) {
        // PR creation falló pero el push sí ocurrió. No marcamos failed —
        // el commit está safe en remote. Loggeamos para que un humano
        // pueda re-intentar manualmente o un cron posterior.
        this.logger.error(
          `[run:${runId}] PR creation FAILED tras push exitoso: ${(err as Error).message}. ` +
            `Commit safe en remote (${dto.commitSha?.slice(0, 7) ?? 'unknown'}). Re-intentar manualmente.`,
        );
      }
    }

    const movedToReview = exitedClean && prNumber !== undefined;
    // SANDBOX MODE: si claude terminó limpio pero no hubo push (sin code
    // repo configurado), avanzamos la historia a 'done' directamente para
    // que el DAG fluya y los workers puedan reclamar dependientes.
    // En modo git real, siempre debería haber prNumber (movedToReview=true);
    // si fallé crear PR, queda como completed sin movimiento de story.
    const movedToDoneSandbox =
      exitedClean && !dto.prBranchPushed && prNumber === undefined;
    const finalStatus: AgentRunStatus = exitedClean ? 'completed' : 'failed';
    const now = new Date();

    // F-12 defense-in-depth: redact errorMessage y lastOutput antes de
    // persistir. Aunque el worker honesto ya lo hace, aquí blindamos
    // contra workers maliciosos / regex skips.
    const redactedErrorMessage = redactServerSide(dto.errorMessage);
    const redactedLastOutput = redactServerSide(dto.lastOutput);

    await this.prisma.$transaction([
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
            ? { criteriaProgress: dto.criteriaProgress as Prisma.InputJsonValue }
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
        },
      }),
      // Transición de la historia depende del modo:
      //  - movedToReview (con PR real): in_review (esperando reviewers + merge)
      //  - movedToDoneSandbox (sin push, sandbox mode): done directo +
      //    claimedAt=NULL para liberar el slot del DAG
      //  - else (failed o PR creation falló): no se mueve, queda visible
      //    como 'completed' run pero story sigue en su status anterior
      ...(movedToReview
        ? [
            this.prisma.story.update({
              where: { id: run.storyId },
              data: { status: 'in_review' as const },
            }),
          ]
        : movedToDoneSandbox
          ? [
              this.prisma.story.update({
                where: { id: run.storyId },
                data: { status: 'done' as const, claimedAt: null },
              }),
            ]
          : []),
    ]);

    const durationMs = now.getTime() - run.startedAt.getTime();
    if (exitedClean) {
      this.logger.log(
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
            epic: { select: { id: true, title: true } },
          },
        },
        node: { select: { id: true, name: true, type: true } },
      },
    });
    if (!run) return null;
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
