import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import type {
  AssistantEntityType,
  AssistantProposalFeedback,
  AssistantProposalResolution,
  AssistantSessionSnapshot,
  AssistantTranscriptMessage,
} from '@cenzontle/shared';
import { RedisService } from '../../redis/redis.service';
import { scrubSecrets } from '../../../common/utils/scrub-secrets.util';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * TTL sliding de una sesión de chat — cada persist (cierre de turno, feedback)
 * lo renueva. Al expirar, el siguiente turno crea sesión nueva de forma
 * transparente (el backend responde el id efectivo en el evento `session`).
 */
const SESSION_TTL_SECONDS = 30 * 60;

/**
 * Cap del historial en mensajes Anthropic (user/assistant alternados,
 * incluyendo los pares tool_use/tool_result de cada turno). Al exceder, se
 * recortan los mensajes más viejos cortando SIEMPRE en una frontera de
 * mensaje `user` sin tool_results — así nunca queda un tool_use huérfano
 * (la API rechaza un tool_use sin su tool_result siguiente).
 */
const MAX_HISTORY_MESSAGES = 60;

/** Cap de la transcript de UI (mensajes user/assistant compactados). */
const MAX_TRANSCRIPT_MESSAGES = 40;

/**
 * Cap de entradas en proposalStatuses/pendingFeedback (CWE-770, hallazgo
 * SEC-1 de security-review). Sin esto, un usuario autenticado podía inflar
 * la sesión con ids de feedback fabricados (20 por request × 60 req/min,
 * renovando TTL en cada una) hasta agotar el Redis compartido. Un turno
 * realista produce <5 propuestas — 100 es holgado.
 */
const MAX_PROPOSAL_ENTRIES = 100;

/**
 * Cap de bytes del payload serializado (CWE-770, hallazgo SEC-2). El peor
 * caso legítimo (40 mensajes de transcript con propuestas de 60K+60K chars)
 * ronda varios MB — al exceder, se degrada recortando primero la transcript
 * más vieja y luego el historial, siempre en fronteras seguras.
 */
const MAX_SESSION_BYTES = 2 * 1024 * 1024;

/**
 * Sesión de chat del asistente. Vive en Redis (sobrevive restarts del API y
 * permite rehidratar la UI tras recargar la página). Una sesión "activa" por
 * usuario+entidad vía key índice — crear una nueva para la misma entidad
 * reemplaza el índice y la anterior expira sola por TTL.
 */
export interface AssistantSession {
  id: string;
  userSub: string;
  entityType: AssistantEntityType;
  entityId: string;
  /** Historial Anthropic completo (incluye tool_use/tool_result de turnos pasados). */
  messages: Anthropic.Messages.MessageParam[];
  /**
   * Fingerprint del último snapshot de contenido de la entidad enviado al
   * modelo. Si el contenido cambió (el usuario aplicó una propuesta o editó
   * a mano), el siguiente turno reinyecta el snapshot actualizado.
   */
  lastContentFingerprint: string | null;
  /** Transcript compactada para rehidratar la UI (ver TurnTranscriptBuilder). */
  transcript: AssistantTranscriptMessage[];
  /** Propuestas resueltas por el usuario (applied/rejected); pendientes no aparecen. */
  proposalStatuses: Record<string, AssistantProposalResolution>;
  /** Feedback aún no comunicado al modelo — se consume al armar el próximo turno. */
  pendingFeedback: AssistantProposalFeedback[];
  createdAt: number;
}

@Injectable()
export class AssistantSessionService {
  constructor(
    private readonly redis: RedisService,
    @InjectPinoLogger(AssistantSessionService.name) private readonly logger: PinoLogger,
  ) {}

  private sessionKey(sessionId: string): string {
    return `assistant:session:${sessionId}`;
  }

  /**
   * Índice "sesión activa" por usuario+entidad. Permite rehidratar la
   * conversación tras recargar la página sin que el cliente recuerde el
   * sessionId, y acota a UNA sesión viva por usuario y entidad.
   */
  private activeKey(userSub: string, entityType: AssistantEntityType, entityId: string): string {
    return `assistant:active:${userSub}:${entityType}:${entityId}`;
  }

  /**
   * Recupera la sesión para este turno:
   *  1. Por sessionId explícito — valida ownership y match de entidad
   *     (Forbidden si es de otro usuario u otra entidad).
   *  2. Sin sessionId (o expirado/restart): retoma la sesión activa del
   *     usuario para esta entidad vía el índice, si existe.
   *  3. Crea una nueva (NO se persiste aquí — el primer persist llega al
   *     cierre del turno; un turno abortado no deja sesión fantasma).
   */
  async getOrCreate(
    userSub: string,
    entityType: AssistantEntityType,
    entityId: string,
    sessionId?: string,
  ): Promise<AssistantSession> {
    if (sessionId) {
      const existing = await this.load(sessionId);
      if (existing) {
        this.assertOwnership(existing, userSub, entityType, entityId);
        return existing;
      }
      // Expiró o el server se reinició con Redis caído: probar el índice.
    }

    const activeId = await this.redis.get(this.activeKey(userSub, entityType, entityId));
    if (activeId && activeId !== sessionId) {
      const active = await this.load(activeId);
      // El índice incluye userSub/entityType/entityId en la key, pero
      // validamos igual contra el payload (defensa en profundidad).
      if (
        active &&
        active.userSub === userSub &&
        active.entityType === entityType &&
        active.entityId === entityId
      ) {
        return active;
      }
    }

    return {
      id: randomUUID(),
      userSub,
      entityType,
      entityId,
      messages: [],
      lastContentFingerprint: null,
      transcript: [],
      proposalStatuses: {},
      pendingFeedback: [],
      createdAt: Date.now(),
    };
  }

  /**
   * Snapshot para rehidratar la UI (GET session). Null si el usuario no tiene
   * sesión activa para la entidad (o Redis está caído — degrada a chat fresco).
   */
  async findActiveSnapshot(
    userSub: string,
    entityType: AssistantEntityType,
    entityId: string,
  ): Promise<AssistantSessionSnapshot | null> {
    const activeId = await this.redis.get(this.activeKey(userSub, entityType, entityId));
    if (!activeId) return null;
    const session = await this.load(activeId);
    if (!session || session.userSub !== userSub) return null;
    return {
      sessionId: session.id,
      transcript: session.transcript,
      proposalStatuses: session.proposalStatuses,
    };
  }

  /**
   * Persiste la sesión renovando el TTL sliding, aplicando los caps de
   * historial/transcript, y FUSIONANDO el feedback de propuestas que pudo
   * llegar por el endpoint proposal-feedback mientras el turno corría (la
   * copia en memoria del turno sería stale y lo pisaría).
   *
   * @param consumedFeedbackIds — ids de feedback que el turno YA comunicó al
   * modelo: el merge NO debe reintroducirlos desde la copia de Redis (se
   * repetirían en el próximo turno).
   */
  async persist(
    session: AssistantSession,
    consumedFeedbackIds: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    this.trimHistory(session);
    this.trimTranscript(session);

    const stored = await this.load(session.id);
    if (stored) {
      session.proposalStatuses = { ...session.proposalStatuses, ...stored.proposalStatuses };
      const knownIds = new Set(session.pendingFeedback.map((f) => f.id));
      for (const fb of stored.pendingFeedback) {
        if (!knownIds.has(fb.id) && !consumedFeedbackIds.has(fb.id)) {
          session.pendingFeedback.push(fb);
        }
      }
    }
    this.capProposalEntries(session);

    // Defense in depth: scrub del JSON serializado antes de Redis — paridad
    // con ProposalCacheService. Los eventos ya van scrubbed al emitirse; esto
    // cubre campos futuros que escapen la redacción upstream.
    let payload = scrubSecrets(JSON.stringify(session));

    // Cap de bytes (SEC-2): degradar recortando lo más viejo antes que dejar
    // crecer la key. Transcript primero (mayor contribuyente — propuestas con
    // oldContent/newContent), luego historial en fronteras de turno.
    while (payload.length > MAX_SESSION_BYTES && session.transcript.length > 2) {
      this.trimTranscriptTo(session, Math.max(2, Math.floor(session.transcript.length / 2)));
      payload = scrubSecrets(JSON.stringify(session));
    }
    while (payload.length > MAX_SESSION_BYTES && session.messages.length > 4) {
      const target = Math.max(4, Math.floor(session.messages.length / 2));
      if (!this.trimHistoryTo(session, target)) break;
      payload = scrubSecrets(JSON.stringify(session));
    }
    if (payload.length > MAX_SESSION_BYTES) {
      this.logger.warn(
        { sessionId: session.id, bytes: payload.length },
        '[session] payload sigue sobre el cap tras degradar — persistiendo igual (best-effort)',
      );
    }

    await this.redis.setex(this.sessionKey(session.id), SESSION_TTL_SECONDS, payload);
    await this.redis.setex(
      this.activeKey(session.userSub, session.entityType, session.entityId),
      SESSION_TTL_SECONDS,
      session.id,
    );
  }

  /**
   * Registra el resultado de propuestas (aplicada/descartada) apenas el
   * usuario actúa — así sobrevive recargas y alimenta el próximo turno
   * server-side. Read-modify-write sobre Redis: NO usar la copia del turno.
   */
  async recordProposalFeedback(
    sessionId: string,
    userSub: string,
    feedback: AssistantProposalFeedback[],
  ): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) throw new NotFoundException('Sesión no encontrada o expirada');
    if (session.userSub !== userSub) {
      throw new ForbiddenException('La sesión pertenece a otro usuario');
    }
    for (const fb of feedback) {
      session.proposalStatuses[fb.id] = fb.status;
      session.pendingFeedback = [
        ...session.pendingFeedback.filter((f) => f.id !== fb.id),
        fb,
      ];
    }
    // Persist directo (sin merge — esta ES la copia fresca) preservando caps.
    this.trimHistory(session);
    this.trimTranscript(session);
    this.capProposalEntries(session);
    const payload = scrubSecrets(JSON.stringify(session));
    await this.redis.setex(this.sessionKey(session.id), SESSION_TTL_SECONDS, payload);
    await this.redis.expire(
      this.activeKey(session.userSub, session.entityType, session.entityId),
      SESSION_TTL_SECONDS,
    );
  }

  /** Destruye una sesión y su índice (ownership check). Idempotente. */
  async destroy(sessionId: string, userSub: string): Promise<boolean> {
    const session = await this.load(sessionId);
    if (!session) return false;
    if (session.userSub !== userSub) {
      throw new ForbiddenException('La sesión pertenece a otro usuario');
    }
    await this.redis.del(this.sessionKey(sessionId));
    const idxKey = this.activeKey(session.userSub, session.entityType, session.entityId);
    const activeId = await this.redis.get(idxKey);
    if (activeId === sessionId) {
      await this.redis.del(idxKey);
    }
    return true;
  }

  private async load(sessionId: string): Promise<AssistantSession | null> {
    const raw = await this.redis.get(this.sessionKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AssistantSession;
    } catch {
      this.logger.warn({ sessionId }, '[session] payload corrupto en Redis — descartando');
      return null;
    }
  }

  private assertOwnership(
    session: AssistantSession,
    userSub: string,
    entityType: AssistantEntityType,
    entityId: string,
  ): void {
    if (session.userSub !== userSub) {
      throw new ForbiddenException('La sesión pertenece a otro usuario');
    }
    if (session.entityType !== entityType || session.entityId !== entityId) {
      throw new ForbiddenException('La sesión pertenece a otra entidad');
    }
  }

  /**
   * Recorta el historial al cap. Solo corta en fronteras seguras: el primer
   * mensaje restante debe ser un `user` SIN bloques tool_result (un user
   * "texto puro" que abre turno). Esto preserva la validez del protocolo
   * tool-use de Anthropic en el historial restante.
   */
  private trimHistory(session: AssistantSession): void {
    this.trimHistoryTo(session, MAX_HISTORY_MESSAGES);
  }

  /** @returns true si recortó (false si no había frontera viable o ya cabía). */
  private trimHistoryTo(session: AssistantSession, maxMessages: number): boolean {
    if (session.messages.length <= maxMessages) return false;

    const isTurnOpeningUser = (msg: Anthropic.Messages.MessageParam): boolean => {
      if (msg.role !== 'user') return false;
      if (typeof msg.content === 'string') return true;
      return !msg.content.some((b) => (b as { type?: string }).type === 'tool_result');
    };

    // Buscar la primera frontera de turno tal que lo restante quepa en el cap.
    for (let i = 1; i < session.messages.length; i++) {
      if (!isTurnOpeningUser(session.messages[i])) continue;
      const remaining = session.messages.length - i;
      if (remaining <= maxMessages) {
        session.messages = session.messages.slice(i);
        // El snapshot de contenido pudo quedar fuera del historial — forzar
        // reinyección en el siguiente turno.
        session.lastContentFingerprint = null;
        return true;
      }
    }
    // Sin frontera viable (un único turno gigante): conservar tal cual; el
    // cap de iteraciones por turno (10) acota el crecimiento de todos modos.
    return false;
  }

  /**
   * Recorta la transcript de UI al cap, cortando en una frontera de mensaje
   * `user` (los turnos van en pares user→assistant — empezar en assistant
   * dejaría una respuesta sin su pregunta).
   */
  private trimTranscript(session: AssistantSession): void {
    this.trimTranscriptTo(session, MAX_TRANSCRIPT_MESSAGES);
  }

  private trimTranscriptTo(session: AssistantSession, maxMessages: number): void {
    if (session.transcript.length <= maxMessages) return;
    for (let i = 1; i < session.transcript.length; i++) {
      if (session.transcript[i].role !== 'user') continue;
      if (session.transcript.length - i <= maxMessages) {
        session.transcript = session.transcript.slice(i);
        return;
      }
    }
  }

  /**
   * Cap de proposalStatuses/pendingFeedback (SEC-1, CWE-770): conserva las
   * entradas más recientes. Las propuestas viejas ya no son accionables en
   * la UI (la transcript también se recorta), así que perder su estado es
   * inocuo.
   */
  private capProposalEntries(session: AssistantSession): void {
    if (session.pendingFeedback.length > MAX_PROPOSAL_ENTRIES) {
      session.pendingFeedback = session.pendingFeedback.slice(-MAX_PROPOSAL_ENTRIES);
    }
    const entries = Object.entries(session.proposalStatuses);
    if (entries.length > MAX_PROPOSAL_ENTRIES) {
      session.proposalStatuses = Object.fromEntries(entries.slice(-MAX_PROPOSAL_ENTRIES));
    }
  }
}
