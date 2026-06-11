import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type { PinoLogger } from 'nestjs-pino';
import type { RedisService } from '../../redis/redis.service';
import { AssistantSessionService } from './assistant-session.service';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as PinoLogger;

/**
 * Fake in-memory de RedisService — implementa el subset usado por
 * AssistantSessionService (get/setex/del/expire) con TTLs reales contra
 * Date.now() para poder simular expiración con fake timers.
 */
class FakeRedis {
  store = new Map<string, { value: string; expiresAt: number }>();
  isConnected = true;

  async get(key: string): Promise<string | null> {
    if (!this.isConnected) return null;
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    if (!this.isConnected) return;
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }
}

function makeService(redis: FakeRedis): AssistantSessionService {
  return new AssistantSessionService(redis as unknown as RedisService, mockLogger);
}

function userMsg(text: string): Anthropic.Messages.MessageParam {
  return { role: 'user', content: text };
}

function toolResultMsg(): Anthropic.Messages.MessageParam {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
  };
}

function makeTurn(): Anthropic.Messages.MessageParam[] {
  return [
    userMsg('pregunta'),
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'vault_read', input: {} }] },
    toolResultMsg(),
    { role: 'assistant', content: [{ type: 'text', text: 'respuesta' }] },
  ];
}

describe('AssistantSessionService (Redis) — ciclo de vida y ownership', () => {
  let redis: FakeRedis;
  let service: AssistantSessionService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = makeService(redis);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('crea sesión nueva y NO la persiste hasta persist() (un turno abortado no deja fantasma)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    expect(s.id).toBeTruthy();
    expect(redis.store.size).toBe(0);
    expect(await service.findActiveSnapshot('user-1', 'epic', 'entity-1')).toBeNull();
  });

  it('persist + getOrCreate por sessionId retoma (sobrevive "restart" — no hay estado en memoria)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    s.messages.push(userMsg('hola'));
    s.transcript.push({ role: 'user', segments: [{ kind: 'text', content: 'hola' }] });
    await service.persist(s);

    // "Restart": instancia nueva del service, mismo Redis.
    const fresh = makeService(redis);
    const again = await fresh.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    expect(again.id).toBe(s.id);
    expect(again.messages).toHaveLength(1);
    expect(again.transcript).toHaveLength(1);
  });

  it('sin sessionId retoma la sesión activa por índice user+entidad (recarga de página)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    s.messages.push(userMsg('hola'));
    await service.persist(s);

    const resumed = await service.getOrCreate('user-1', 'epic', 'entity-1');
    expect(resumed.id).toBe(s.id);
  });

  it('rechaza sessionId de OTRO usuario (cross-user hijack)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);
    await expect(service.getOrCreate('user-2', 'epic', 'entity-1', s.id)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rechaza sessionId de OTRA entidad (cross-entity reuse)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);
    await expect(service.getOrCreate('user-1', 'epic', 'entity-2', s.id)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.getOrCreate('user-1', 'story', 'entity-1', s.id)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('sesión expirada por TTL → crea nueva', async () => {
    jest.useFakeTimers({ now: new Date('2026-06-10T10:00:00Z') });
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);
    jest.setSystemTime(new Date('2026-06-10T10:31:00Z')); // TTL 30 min superado
    const fresh = await service.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    expect(fresh.id).not.toBe(s.id);
  });

  it('Redis caído degrada a sesión fresca (el chat sigue funcionando turno a turno)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);
    redis.isConnected = false;
    const fresh = await service.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    expect(fresh.id).not.toBe(s.id);
    expect(await service.findActiveSnapshot('user-1', 'epic', 'entity-1')).toBeNull();
  });

  it('destroy exige ownership, borra sesión + índice, e idempotente', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);
    await expect(service.destroy(s.id, 'user-2')).rejects.toThrow(ForbiddenException);
    expect(await service.destroy(s.id, 'user-1')).toBe(true);
    expect(await service.findActiveSnapshot('user-1', 'epic', 'entity-1')).toBeNull();
    expect(await service.destroy(s.id, 'user-1')).toBe(false);
  });
});

describe('AssistantSessionService — feedback de propuestas', () => {
  let redis: FakeRedis;
  let service: AssistantSessionService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = makeService(redis);
  });

  it('recordProposalFeedback exige sesión existente y ownership', async () => {
    await expect(
      service.recordProposalFeedback('00000000-0000-4000-8000-000000000000', 'user-1', []),
    ).rejects.toThrow(NotFoundException);

    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);
    await expect(
      service.recordProposalFeedback(s.id, 'user-2', [{ id: 'prop-1', status: 'applied' }]),
    ).rejects.toThrow(ForbiddenException);
  });

  it('registra estados visibles en el snapshot y encola pendingFeedback', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);
    await service.recordProposalFeedback(s.id, 'user-1', [
      { id: 'prop-1', status: 'applied' },
      { id: 'prop-2', status: 'rejected' },
    ]);

    const snapshot = await service.findActiveSnapshot('user-1', 'epic', 'entity-1');
    expect(snapshot?.proposalStatuses).toEqual({ 'prop-1': 'applied', 'prop-2': 'rejected' });

    const reloaded = await service.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    expect(reloaded.pendingFeedback).toEqual([
      { id: 'prop-1', status: 'applied' },
      { id: 'prop-2', status: 'rejected' },
    ]);
  });

  it('persist() fusiona feedback registrado durante el turno (copia stale no lo pisa)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);

    // El turno trabaja con SU copia mientras el usuario aplica una propuesta.
    const turnCopy = await service.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    await service.recordProposalFeedback(s.id, 'user-1', [{ id: 'prop-9', status: 'applied' }]);

    // El turno persiste su copia stale al cerrar — el merge preserva el feedback.
    await service.persist(turnCopy);
    const reloaded = await service.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    expect(reloaded.proposalStatuses['prop-9']).toBe('applied');
    expect(reloaded.pendingFeedback).toEqual([{ id: 'prop-9', status: 'applied' }]);
  });

  it('capea proposalStatuses/pendingFeedback a 100 entradas (SEC-1, CWE-770)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    await service.persist(s);
    // Simular el ataque: 8 requests de 20 ids fabricados cada una (160 > cap).
    for (let batch = 0; batch < 8; batch++) {
      const feedback = Array.from({ length: 20 }, (_, i) => ({
        id: `prop-${String(batch).padStart(2, '0')}${String(i).padStart(6, '0')}`,
        status: 'rejected' as const,
      }));
      await service.recordProposalFeedback(s.id, 'user-1', feedback);
    }
    const reloaded = await service.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    expect(reloaded.pendingFeedback.length).toBeLessThanOrEqual(100);
    expect(Object.keys(reloaded.proposalStatuses).length).toBeLessThanOrEqual(100);
    // Conserva las MÁS recientes (las del último batch sobreviven).
    expect(reloaded.proposalStatuses['prop-07000019']).toBe('rejected');
  });

  it('persist() NO reintroduce feedback ya consumido por el turno', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    s.pendingFeedback = [{ id: 'prop-5', status: 'rejected' }];
    await service.persist(s);

    // El turno consume prop-5 (lo comunica al modelo) y persiste con el id marcado.
    const turnCopy = await service.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    turnCopy.pendingFeedback = [];
    await service.persist(turnCopy, new Set(['prop-5']));

    const reloaded = await service.getOrCreate('user-1', 'epic', 'entity-1', s.id);
    expect(reloaded.pendingFeedback).toEqual([]);
  });
});

describe('AssistantSessionService — caps de historial y transcript', () => {
  let service: AssistantSessionService;

  beforeEach(() => {
    service = makeService(new FakeRedis());
  });

  it('trim del historial corta SOLO en frontera de turno (primer mensaje = user texto puro)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    for (let i = 0; i < 20; i++) s.messages.push(...makeTurn()); // 80 mensajes
    await service.persist(s);
    expect(s.messages.length).toBeLessThanOrEqual(60);
    const first = s.messages[0];
    expect(first.role).toBe('user');
    if (typeof first.content !== 'string') {
      expect(first.content.some((b) => (b as { type?: string }).type === 'tool_result')).toBe(false);
    }
    expect(s.lastContentFingerprint).toBeNull();
  });

  it('trim de la transcript corta en frontera user y respeta el cap (40)', async () => {
    const s = await service.getOrCreate('user-1', 'epic', 'entity-1');
    for (let i = 0; i < 30; i++) {
      s.transcript.push(
        { role: 'user', segments: [{ kind: 'text', content: `pregunta ${i}` }] },
        { role: 'assistant', segments: [{ kind: 'text', content: `respuesta ${i}` }] },
      );
    }
    await service.persist(s);
    expect(s.transcript.length).toBeLessThanOrEqual(40);
    expect(s.transcript[0].role).toBe('user');
  });
});
