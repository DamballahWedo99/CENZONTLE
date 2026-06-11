import type { PinoLogger } from 'nestjs-pino';
import Anthropic from '@anthropic-ai/sdk';
import { UserRole, type AssistantChatEvent, type AuthenticatedUser } from '@cenzontle/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrgAnthropicConfigService } from '../../org-anthropic-config/org-anthropic-config.service';
import type { AgentTokenSettingsService } from '../../agent-token-settings/agent-token-settings.service';
import type { EpicsService } from '../epics/epics.service';
import type { StoriesService } from '../stories/stories.service';
import type { RedisService } from '../../redis/redis.service';
import type { InitiativeDocumentsTool } from '../../factory/agent-tools/initiative-documents.tool';
import type { CodeGlobTool } from '../../factory/agent-tools/code-glob.tool';
import type { CodeGrepTool } from '../../factory/agent-tools/code-grep.tool';
import type { CodeReadTool } from '../../factory/agent-tools/code-read.tool';
import type { VaultGlobTool } from '../../factory/agent-tools/vault-glob.tool';
import type { VaultGrepTool } from '../../factory/agent-tools/vault-grep.tool';
import type { VaultReadTool } from '../../factory/agent-tools/vault-read.tool';
import type { AgentTool } from '../../factory/agent-tools/agent-tool.interface';
import { AssistantSessionService } from './assistant-session.service';
import { AssistantChatService, type AssistantChatParams } from './assistant-chat.service';

// El SDK se mockea entero: el service hace `new Anthropic({...})` por turno y
// solo usa `client.messages.stream(...)`. anthropic-fetch crea un dispatcher
// undici a nivel módulo — lo mockeamos para aislar el spec de la red.
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../../lib/anthropic-fetch', () => ({ anthropicFetch: jest.fn() }));

// Las clases de tools y los services de epics/stories arrastran cadenas de
// imports hasta `@octokit/rest` (ESM puro que jest no transforma). Factories
// explícitas (NO automock — el automock cargaría el módulo real para reflejar
// su shape) cortan la cadena; el spec inyecta sus propios mocks de instancia.
jest.mock('../../factory/agent-tools/initiative-documents.tool', () => ({ InitiativeDocumentsTool: jest.fn() }));
jest.mock('../../factory/agent-tools/code-glob.tool', () => ({ CodeGlobTool: jest.fn() }));
jest.mock('../../factory/agent-tools/code-grep.tool', () => ({ CodeGrepTool: jest.fn() }));
jest.mock('../../factory/agent-tools/code-read.tool', () => ({ CodeReadTool: jest.fn() }));
jest.mock('../../factory/agent-tools/vault-glob.tool', () => ({ VaultGlobTool: jest.fn() }));
jest.mock('../../factory/agent-tools/vault-grep.tool', () => ({ VaultGrepTool: jest.fn() }));
jest.mock('../../factory/agent-tools/vault-read.tool', () => ({ VaultReadTool: jest.fn() }));
jest.mock('../epics/epics.service', () => ({ EpicsService: jest.fn() }));
jest.mock('../stories/stories.service', () => ({ StoriesService: jest.fn() }));

const MockedAnthropic = Anthropic as unknown as jest.Mock;

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as PinoLogger;

/** Mismo fake del spec del session service — TTLs reales contra Date.now(). */
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

  async ttl(): Promise<number> {
    return 1;
  }
}

// ─────────────────────────────────────────────────────────────────────
//   Helpers de stream del SDK
// ─────────────────────────────────────────────────────────────────────

type DeltaSpec = { kind: 'text' | 'thinking'; content: string };

/** Stream falso: async iterable de content_block_delta + finalMessage(). */
function makeStream(
  deltas: DeltaSpec[],
  final: { stop_reason: string; content: unknown[] },
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const d of deltas) {
        yield {
          type: 'content_block_delta',
          delta:
            d.kind === 'text'
              ? { type: 'text_delta', text: d.content }
              : { type: 'thinking_delta', thinking: d.content },
        };
      }
    },
    finalMessage: async () => final as unknown as Anthropic.Messages.Message,
  };
}

/** Stream que revienta a mitad de la iteración (error de API / abort). */
function makeFailingStream(error: Error) {
  return {
    // eslint-disable-next-line require-yield
    async *[Symbol.asyncIterator]() {
      throw error;
    },
    finalMessage: async () => {
      throw error;
    },
  };
}

function textFinal(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

function toolUseFinal(name: string, input: Record<string, unknown>, id: string) {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
}

// ─────────────────────────────────────────────────────────────────────
//   Setup del service
// ─────────────────────────────────────────────────────────────────────

const USER: AuthenticatedUser = {
  sub: 'user-1',
  email: 'u@example.com',
  role: UserRole.TechLead,
  podIds: ['pod-a'],
} as AuthenticatedUser;

const EPIC_MARKDOWN = '## Objetivo\nContenido viejo de la épica';

function makeTool(name: string): AgentTool {
  return {
    name,
    description: `tool ${name}`,
    schema: { type: 'object', properties: {} },
    execute: jest.fn().mockResolvedValue(JSON.stringify({ content: 'resultado' })),
  };
}

interface Harness {
  service: AssistantChatService;
  sessions: AssistantSessionService;
  redis: FakeRedis;
  mockStream: jest.Mock;
  epicsFindOne: jest.Mock;
}

function makeHarness(): Harness {
  const redis = new FakeRedis();
  const sessions = new AssistantSessionService(redis as unknown as RedisService, mockLogger);

  const mockStream = jest.fn();
  MockedAnthropic.mockImplementation(() => ({ messages: { stream: mockStream } }));

  const epicsFindOne = jest.fn().mockResolvedValue({
    initiativeId: 'ini-1',
    title: 'Mi épica',
    markdown: EPIC_MARKDOWN,
  });

  const prisma = {
    initiative: { findUnique: jest.fn() },
    story: { findUnique: jest.fn() },
  } as unknown as PrismaService;

  const service = new AssistantChatService(
    prisma,
    {
      getApiKeyPlaintext: jest.fn().mockResolvedValue('sk-test'),
    } as unknown as OrgAnthropicConfigService,
    {
      getAssistant: jest.fn().mockResolvedValue({
        model: 'claude-sonnet-4-6',
        effort: 'medium',
        maxTokens: 32_000,
        enabled: true,
      }),
    } as unknown as AgentTokenSettingsService,
    { findOne: epicsFindOne } as unknown as EpicsService,
    { readStoryContent: jest.fn() } as unknown as StoriesService,
    sessions,
    makeTool('read_initiative_documents') as InitiativeDocumentsTool,
    makeTool('code_glob') as CodeGlobTool,
    makeTool('code_grep') as CodeGrepTool,
    makeTool('code_read') as CodeReadTool,
    makeTool('vault_glob') as VaultGlobTool,
    makeTool('vault_grep') as VaultGrepTool,
    makeTool('vault_read') as VaultReadTool,
    mockLogger,
  );

  return { service, sessions, redis, mockStream, epicsFindOne };
}

/** Corre un turno completo y devuelve los eventos SSE emitidos. */
function runTurn(
  harness: Harness,
  overrides: Partial<AssistantChatParams> = {},
): Promise<AssistantChatEvent[]> {
  const subject = harness.service.chat({
    user: USER,
    entityType: 'epic',
    entityId: 'epic-1',
    message: 'mejora el objetivo',
    ...overrides,
  });
  return new Promise((resolve, reject) => {
    const events: AssistantChatEvent[] = [];
    subject.subscribe({
      next: (e) => events.push(e.data),
      complete: () => resolve(events),
      error: reject,
    });
  });
}

function sessionIdOf(events: AssistantChatEvent[]): string {
  const ev = events.find((e) => e.type === 'session');
  if (!ev || ev.type !== 'session') throw new Error('sin evento session');
  return ev.sessionId;
}

/** Último user message enviado al SDK en la llamada N del stream. */
function lastUserMessageOfCall(mockStream: jest.Mock, callIndex: number): string {
  const { messages } = mockStream.mock.calls[callIndex][0] as {
    messages: Anthropic.Messages.MessageParam[];
  };
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      return messages[i].content as string;
    }
  }
  throw new Error('sin user message de texto');
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
//   Tests
// ─────────────────────────────────────────────────────────────────────

describe('AssistantChatService — path end_turn', () => {
  it('emite session/text_delta/done y persiste la transcript del turno', async () => {
    const h = makeHarness();
    h.mockStream.mockReturnValue(makeStream([{ kind: 'text', content: 'Hola, ' }, { kind: 'text', content: 'puedo ayudarte.' }], textFinal('Hola, puedo ayudarte.')));

    const events = await runTurn(h);

    expect(events.map((e) => e.type)).toEqual(['session', 'text_delta', 'text_delta', 'done']);

    const snapshot = await h.sessions.findActiveSnapshot('user-1', 'epic', 'epic-1');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.sessionId).toBe(sessionIdOf(events));
    expect(snapshot!.transcript).toEqual([
      { role: 'user', segments: [{ kind: 'text', content: 'mejora el objetivo' }] },
      { role: 'assistant', segments: [{ kind: 'text', content: 'Hola, puedo ayudarte.' }] },
    ]);

    // Historial Anthropic persistido: user (con snapshot de contenido) + assistant.
    const session = await h.sessions.getOrCreate('user-1', 'epic', 'epic-1', snapshot!.sessionId);
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[0].content).toContain('<current_content');
    expect(session.messages[0].content).toContain(EPIC_MARKDOWN);
    expect(session.messages[1].role).toBe('assistant');
  });
});

describe('AssistantChatService — path max_tokens', () => {
  it('persiste el turno parcial CON el aviso de truncamiento en la transcript', async () => {
    const h = makeHarness();
    h.mockStream.mockReturnValue(
      makeStream([{ kind: 'text', content: 'Respuesta corta…' }], {
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: 'Respuesta corta…' }],
      }),
    );

    const events = await runTurn(h);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();

    const snapshot = await h.sessions.findActiveSnapshot('user-1', 'epic', 'epic-1');
    expect(snapshot).not.toBeNull();
    const assistant = snapshot!.transcript[1];
    expect(assistant.role).toBe('assistant');
    // El texto parcial + el aviso ⚠️ (el builder ingiere el evento error vía emitTurn).
    expect(assistant.segments[0]).toEqual({ kind: 'text', content: expect.stringContaining('Respuesta corta…') });
    const joined = assistant.segments
      .map((s) => (s.kind === 'text' ? s.content : ''))
      .join('');
    expect(joined).toContain('⚠️');
    expect(joined).toContain('excedió el límite de tokens');

    // El historial queda VÁLIDO (termina en assistant — sin user colgante).
    const session = await h.sessions.getOrCreate('user-1', 'epic', 'epic-1', snapshot!.sessionId);
    expect(session.messages[session.messages.length - 1].role).toBe('assistant');
  });
});

describe('AssistantChatService — error del stream (rollback)', () => {
  it('revierte el turno: messages pre-turno, transcript sin el turno, feedback restaurado', async () => {
    const h = makeHarness();

    // Turno 1 exitoso para tener una sesión con contenido.
    h.mockStream.mockReturnValue(makeStream([{ kind: 'text', content: 'ok' }], textFinal('ok')));
    const events1 = await runTurn(h);
    const sessionId = sessionIdOf(events1);

    // El usuario aplica una propuesta (feedback server-side pendiente).
    await h.sessions.recordProposalFeedback(sessionId, 'user-1', [
      { id: 'prop-feedback-1', status: 'applied' },
    ]);

    // Turno 2: el stream revienta.
    h.mockStream.mockReturnValue(makeFailingStream(new Error('boom de API')));
    const events2 = await runTurn(h, { sessionId, message: 'otro cambio' });

    // Error genérico emitido (no es abort) y stream cerrado.
    expect(events2.some((e) => e.type === 'error')).toBe(true);

    const session = await h.sessions.getOrCreate('user-1', 'epic', 'epic-1', sessionId);
    // Historial = solo el turno 1 (2 mensajes); el user del turno 2 se descartó.
    expect(session.messages).toHaveLength(2);
    // Transcript = solo el turno 1.
    expect(session.transcript).toHaveLength(2);
    expect(session.transcript[0].segments[0]).toEqual({ kind: 'text', content: 'mejora el objetivo' });
    // El feedback consumido por el turno fallido fue RESTAURADO.
    expect(session.pendingFeedback).toEqual([{ id: 'prop-feedback-1', status: 'applied' }]);
  });
});

describe('AssistantChatService — cap de MAX_TOOL_ITERATIONS', () => {
  it('hace rollback y emite el error de máximo de pasos', async () => {
    const h = makeHarness();
    let call = 0;
    h.mockStream.mockImplementation(() =>
      makeStream([], toolUseFinal('vault_read', { path: 'x.md' }, `tu-${call++}`)),
    );

    const events = await runTurn(h);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.message).toContain('máximo de pasos');
    }
    // 10 iteraciones de stream, ni una más.
    expect(h.mockStream).toHaveBeenCalledTimes(10);
    // Sesión nueva con turno revertido → NUNCA se persistió (sin fantasmas).
    expect(await h.sessions.findActiveSnapshot('user-1', 'epic', 'epic-1')).toBeNull();
    expect(h.redis.store.size).toBe(0);
  });
});

describe('AssistantChatService — propose_update', () => {
  it('target inválido para el entityType → tool_result is_error y SIN evento proposal', async () => {
    const h = makeHarness();
    h.mockStream
      .mockReturnValueOnce(
        makeStream([], toolUseFinal('propose_update', {
          target: 'story_po', // inválido para epic
          title: 't',
          summary: 's',
          newContent: '## Objetivo\nNuevo',
        }, 'tu-1')),
      )
      .mockReturnValueOnce(makeStream([], textFinal('entendido')));

    const events = await runTurn(h);

    expect(events.some((e) => e.type === 'proposal')).toBe(false);

    // El tool_result devuelto al modelo lleva is_error + targets válidos.
    // NOTA: el SDK mock captura la REFERENCIA al array messages, que el service
    // sigue mutando tras la call — por eso escaneamos por el bloque tool_result
    // en vez de asumir que es el último mensaje.
    const { messages } = h.mockStream.mock.calls[1][0] as {
      messages: Anthropic.Messages.MessageParam[];
    };
    const toolResultBlock = messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => (b as { type?: string }).type === 'tool_result') as
      | { type: string; is_error?: boolean; content?: string }
      | undefined;
    expect(toolResultBlock).toBeDefined();
    expect(toolResultBlock!.is_error).toBe(true);
    expect(toolResultBlock!.content).toContain('epic_markdown');
  });

  it('target válido → evento proposal con oldContent del snapshot SERVER-side', async () => {
    const h = makeHarness();
    h.mockStream
      .mockReturnValueOnce(
        makeStream([], toolUseFinal('propose_update', {
          target: 'epic_markdown',
          title: 'Objetivo medible',
          summary: 'Reescribe el objetivo con métricas',
          newContent: '## Objetivo\nContenido nuevo propuesto',
        }, 'tu-1')),
      )
      .mockReturnValueOnce(makeStream([{ kind: 'text', content: 'Propuse el cambio.' }], textFinal('Propuse el cambio.')));

    const events = await runTurn(h);

    const proposalEvent = events.find((e) => e.type === 'proposal');
    expect(proposalEvent).toBeDefined();
    if (proposalEvent?.type === 'proposal') {
      expect(proposalEvent.proposal.target).toBe('epic_markdown');
      // oldContent viene del snapshot del server (epicsService.findOne), NO del modelo.
      expect(proposalEvent.proposal.oldContent).toBe(EPIC_MARKDOWN);
      expect(proposalEvent.proposal.newContent).toBe('## Objetivo\nContenido nuevo propuesto');
      expect(proposalEvent.proposal.id).toMatch(/^prop-/);
    }

    // La transcript persistida incluye el segmento proposal (rehidratación).
    const snapshot = await h.sessions.findActiveSnapshot('user-1', 'epic', 'epic-1');
    const assistantSegments = snapshot!.transcript[1].segments;
    expect(assistantSegments.some((s) => s.kind === 'proposal')).toBe(true);
  });
});

describe('AssistantChatService — feedback server-side', () => {
  it('consume session.pendingFeedback en el user message y NO lo reintroduce tras persist', async () => {
    const h = makeHarness();

    // Turno 1: crea y persiste la sesión.
    h.mockStream.mockReturnValue(makeStream([], textFinal('ok')));
    const events1 = await runTurn(h);
    const sessionId = sessionIdOf(events1);

    // El usuario descarta una propuesta entre turnos (endpoint feedback).
    await h.sessions.recordProposalFeedback(sessionId, 'user-1', [
      { id: 'prop-zzz', status: 'rejected' },
    ]);

    // Turno 2.
    h.mockStream.mockClear();
    h.mockStream.mockReturnValue(makeStream([], textFinal('listo')));
    await runTurn(h, { sessionId, message: 'sigue' });

    // El user message del turno 2 comunica el feedback al modelo…
    const turnMessage = lastUserMessageOfCall(h.mockStream, 0);
    expect(turnMessage).toContain('<proposal_feedback>');
    expect(turnMessage).toContain('prop-zzz');
    expect(turnMessage).toContain('descartada por el usuario');
    // …y NO reinyecta el snapshot de contenido (fingerprint sin cambios).
    expect(turnMessage).not.toContain('<current_content');

    // Consumido: el merge de persist no lo reintroduce (consumedFeedbackIds).
    const session = await h.sessions.getOrCreate('user-1', 'epic', 'epic-1', sessionId);
    expect(session.pendingFeedback).toEqual([]);
    // El estado resuelto se conserva para la rehidratación de la UI.
    expect(session.proposalStatuses['prop-zzz']).toBe('rejected');
  });
});
