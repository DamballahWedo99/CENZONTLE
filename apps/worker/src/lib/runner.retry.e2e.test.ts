// ════════════════════════════════════════════════════════════════════════
// runner.retry.e2e.test.ts — test E2E del DoD retry loop (config dodMaxAttempts)
// ════════════════════════════════════════════════════════════════════════
//
// Corre el flujo REAL del worker (`runStory`) con un stub de `claude` que
// FALLA de forma controlada para ejercitar el retry loop hard-error. Verifica
// que la feature "configuración para activar retries" (AgentTokenSettings →
// tab Factory → dodMaxAttempts) funciona end-to-end:
//
//   - dodMaxAttempts > 1: un crash de claude se REINTENTA desde cero.
//   - dodMaxAttempts = 1: un crash NO se reintenta (retries opt-in).
//   - el worker re-clampea claims fuera de rango (defensa en profundidad).
//   - la estrategia de logs emite los eventos esperados con los campos
//     correctos (dod.attempts.resolved, dod.retry.hard_error, dod.retry,
//     claude.exit_nonzero).
//
// Cómo se mantiene determinístico, sin gastar tokens ni red:
//  - `CLAUDE_BIN` → un stub que cuenta sus invocaciones en un counter file y
//    decide su exit code según el nº de attempt. El path del counter y el
//    umbral de fallo se HORNEAN en el script (el worker spawnea claude con
//    un env explícito — NO propaga env arbitrario al hijo).
//  - `TMUX_BIN`/`TTYD_BIN` → stubs triviales `exit 0`.
//  - `dodCriteria: []` → el verifier del DoD se saltea; el retry que se
//    ejercita es el de HARD-ERROR (exitCode ≠ 0), no el de DoD-warn.
//  - sandbox mode (`repoUrl: null`) → sin clone ni push.
//  - el logger se mockea para capturar y verificar los eventos estructurados.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ClaimedStory } from '@cenzontle/shared';

// ── Mock del logger ──────────────────────────────────────────────────────
// Captura cada evento estructurado para poder verificar la estrategia de logs
// sin depender del transport de pino. `vi.hoisted` crea el array antes de que
// el factory de `vi.mock` (hoisteado) lo capture por clausura.
interface LogRecord {
  level: string;
  obj: Record<string, unknown>;
  msg?: string;
}
const logRecords = vi.hoisted(() => [] as LogRecord[]);

vi.mock('./logger.js', () => {
  const record =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      logRecords.push({
        level,
        obj:
          obj && typeof obj === 'object'
            ? (obj as Record<string, unknown>)
            : { value: obj },
        msg,
      });
    };
  const known: Record<string, unknown> = {
    info: record('info'),
    debug: record('debug'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    trace: record('trace'),
    level: 'debug',
  };
  // Proxy: cualquier acceso no anticipado (otro nivel/método de pino) cae a
  // un no-op seguro — el mock nunca rompe `runStory` por un método faltante.
  const logger: unknown = new Proxy(known, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'child') return () => logger;
      return () => undefined;
    },
  });
  return {
    logger,
    logEvent: (event: string, data: Record<string, unknown>, msg?: string) =>
      logRecords.push({ level: 'info', obj: { event, ...data }, msg }),
  };
});

// El import de `runStory` debe ir DESPUÉS del vi.mock para que reciba el
// logger mockeado (vi.mock se hoistea, pero el orden textual deja claro el
// intent).
import { runStory } from './runner.js';
import type { ApiClient } from './api-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Escribe un stub de `claude` que cuenta sus invocaciones en `counterFile` y
 * decide su exit code: falla (exit 1) mientras el nº de invocación sea menor
 * que `failUntil`; a partir de ahí sale 0. Ejemplos:
 *   failUntil = 1   → éxito en el primer spawn (1 < 1 es falso).
 *   failUntil = 2   → falla el spawn 1, éxito en el 2.
 *   failUntil = 999 → falla siempre (en la práctica).
 *
 * El `sleep 1` no es cosmético: el worker engancha el listener `close` del
 * proceso hijo unos ms después del spawn; el stub debe seguir vivo hasta
 * entonces o el evento se perdería. Mismo motivo que `no-leak.e2e.test.ts`.
 */
async function writeCountingClaudeStub(
  path: string,
  counterFile: string,
  failUntil: number,
): Promise<void> {
  const script = [
    '#!/bin/sh',
    `N=$(cat "${counterFile}" 2>/dev/null || echo 0)`,
    'N=$((N + 1))',
    `echo "$N" > "${counterFile}"`,
    'echo "STUB-CLAUDE-RAN attempt=$N" >&2',
    'sleep 1',
    `if [ "$N" -lt ${failUntil} ]; then`,
    '  echo "stub: fallo simulado del attempt $N" >&2',
    '  exit 1',
    'fi',
    'exit 0',
    '',
  ].join('\n');
  await fs.writeFile(path, script, { mode: 0o755 });
}

interface RetryRunResult {
  /** Todos los POSTs que el worker mandó al backend (mock). */
  posted: Array<{ path: string; body: unknown }>;
  /** Cuántas veces se spawneó el stub de claude (= attempts ejecutados). */
  spawnCount: number;
  /** Body del POST /complete final. */
  complete: Record<string, unknown> | undefined;
}

/**
 * Corre `runStory` en sandbox mode con el stub de claude configurado.
 * Devuelve los POSTs capturados, el nº de spawns y el body de /complete.
 */
async function runWithStub(opts: {
  dodMaxAttempts: number | undefined;
  failUntil: number;
}): Promise<RetryRunResult> {
  const fixtureDir = await fs.mkdtemp(join(tmpdir(), 'retry-e2e-'));
  const claudeStub = join(fixtureDir, 'claude-stub.sh');
  const tmuxStub = join(fixtureDir, 'tmux-stub.sh');
  const ttydStub = join(fixtureDir, 'ttyd-stub.sh');
  const counterFile = join(fixtureDir, 'attempt-counter');

  await writeCountingClaudeStub(claudeStub, counterFile, opts.failUntil);
  await fs.writeFile(tmuxStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.writeFile(ttydStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const posted: Array<{ path: string; body: unknown }> = [];
  const mockClient = {
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      return {};
    },
    get: async () => ({}),
  } as unknown as ApiClient;

  const runId = `retry-e2e-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const claimed: ClaimedStory = {
    runId,
    storyId: 'retry-e2e-story',
    storyTitle: 'E2E retry loop test story',
    storyMarkdown: null,
    epicId: 'retry-e2e-epic',
    branch: 'forge/e2e/retry',
    // Prompt >= 100 chars — el worker rechaza prompts triviales.
    prompt: 'Implementá la historia de prueba E2E del retry loop. '.repeat(8),
    repoUrl: null, // sandbox mode — sin clone ni push
    baseBranch: null,
    anthropicApiKey: 'sk-ant-e2e-dummy-key-not-real-000000',
    externalSecrets: [],
    forgeWorkerModel: 'claude-haiku-4-5',
    forgeWorkerEffort: 'low',
    dodVerifierModel: 'claude-haiku-4-5',
    dodVerifierEffort: 'low',
    dodCriteria: [], // vacío → verifier saltado; el retry es por hard-error
    acceptanceCriteria: [],
    qaTestCases: [],
    technicalRequirements: [],
    dodMaxAttempts: opts.dodMaxAttempts,
  };

  const envKeys = [
    'CLAUDE_BIN',
    'TMUX_BIN',
    'TTYD_BIN',
    'FACTORY_WORKER_SANDBOX_MODE',
    'FACTORY_WORKER_ALLOW_NO_SANDBOX',
  ];
  const envBackup = new Map(envKeys.map((k) => [k, process.env[k]]));
  process.env.CLAUDE_BIN = claudeStub;
  process.env.TMUX_BIN = tmuxStub;
  process.env.TTYD_BIN = ttydStub;
  process.env.FACTORY_WORKER_SANDBOX_MODE = 'none';
  process.env.FACTORY_WORKER_ALLOW_NO_SANDBOX = '1';

  try {
    await runStory(mockClient, claimed);
  } finally {
    for (const [k, v] of envBackup) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  const spawnCountRaw = await fs
    .readFile(counterFile, 'utf-8')
    .catch(() => '0');
  const spawnCount = parseInt(spawnCountRaw.trim(), 10) || 0;

  await fs.rm(fixtureDir, { recursive: true, force: true });

  const complete = posted.find((p) => p.path.endsWith('/complete'))?.body as
    | Record<string, unknown>
    | undefined;

  return { posted, spawnCount, complete };
}

/** Eventos del logger mock de un tipo (`event`) dado. */
function eventsOfType(event: string): LogRecord[] {
  return logRecords.filter((r) => r.obj.event === event);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('DoD retry loop — comportamiento de la config dodMaxAttempts', () => {
  beforeEach(() => {
    logRecords.length = 0;
  });

  it('dodMaxAttempts=2: un crash en el attempt 1 se reintenta y completa en el 2', async () => {
    const { spawnCount, complete } = await runWithStub({
      dodMaxAttempts: 2,
      failUntil: 2,
    });
    // claude se spawneó 2 veces (1 crash + 1 éxito) → el retry SÍ ocurrió.
    expect(spawnCount).toBe(2);
    expect(complete).toBeDefined();
    expect(complete!.attempts).toBe(2);
    expect(complete!.exitCode).toBe(0);
    // Run exitoso → sin errorMessage (el worker no lo asigna en el path ok).
    expect(complete!.errorMessage).toBeUndefined();
  });

  it('dodMaxAttempts=1: un crash NO se reintenta (los retries son opt-in)', async () => {
    const { spawnCount, complete } = await runWithStub({
      dodMaxAttempts: 1,
      failUntil: 999,
    });
    // Una sola pasada: sin budget de retry, el crash no dispara otro spawn.
    expect(spawnCount).toBe(1);
    expect(complete).toBeDefined();
    expect(complete!.attempts).toBe(1);
    expect(complete!.exitCode).toBe(1);
    expect(complete!.errorMessage).toMatch(/exited with code 1/i);
  });

  it('dodMaxAttempts=3: si claude crashea siempre, agota los 3 attempts', async () => {
    const { spawnCount, complete } = await runWithStub({
      dodMaxAttempts: 3,
      failUntil: 999,
    });
    expect(spawnCount).toBe(3);
    expect(complete!.attempts).toBe(3);
    expect(complete!.exitCode).toBe(1);
    expect(complete!.errorMessage).toMatch(/exited with code 1/i);
  });

  it('claim sin dodMaxAttempts (backend viejo): default 1, sin retry', async () => {
    const { spawnCount, complete } = await runWithStub({
      dodMaxAttempts: undefined,
      failUntil: 999,
    });
    expect(spawnCount).toBe(1);
    expect(complete!.attempts).toBe(1);
  });

  it('dodMaxAttempts fuera de rango (99): el worker re-clampea a 3', async () => {
    const { spawnCount, complete } = await runWithStub({
      dodMaxAttempts: 99,
      failUntil: 999,
    });
    // Defensa en profundidad: nunca se spawnea más de MAX_DOD_ATTEMPTS_CAP.
    expect(spawnCount).toBe(3);
    expect(complete!.attempts).toBe(3);
  });

  it('éxito al primer intento: no se gasta budget de retry', async () => {
    const { spawnCount, complete } = await runWithStub({
      dodMaxAttempts: 3,
      failUntil: 1,
    });
    expect(spawnCount).toBe(1);
    expect(complete!.attempts).toBe(1);
    expect(complete!.exitCode).toBe(0);
  });
});

describe('DoD retry loop — estrategia de logs (eventos estructurados)', () => {
  beforeEach(() => {
    logRecords.length = 0;
  });

  it('dod.attempts.resolved emite el valor crudo y el resuelto (sin clamp)', async () => {
    await runWithStub({ dodMaxAttempts: 2, failUntil: 1 });
    const resolved = eventsOfType('dod.attempts.resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].level).toBe('info');
    expect(resolved[0].obj.maxDodAttempts).toBe(2);
    expect(resolved[0].obj.claimedValue).toBe(2);
    expect(resolved[0].obj.clamped).toBe(false);
  });

  it('dod.attempts.resolved marca clamped=true cuando el claim viene fuera de rango', async () => {
    await runWithStub({ dodMaxAttempts: 99, failUntil: 1 });
    const resolved = eventsOfType('dod.attempts.resolved');
    expect(resolved[0].obj.maxDodAttempts).toBe(3);
    expect(resolved[0].obj.claimedValue).toBe(99);
    expect(resolved[0].obj.clamped).toBe(true);
  });

  it('dod.attempts.resolved marca clamped=true cuando el claim trae un float (2.9 → 2)', async () => {
    // El DTO del backend valida @IsInt, pero el worker hace defensa en
    // profundidad: trunca el float y marca clamped porque 2.9 !== 2.
    await runWithStub({ dodMaxAttempts: 2.9, failUntil: 1 });
    const resolved = eventsOfType('dod.attempts.resolved');
    expect(resolved[0].obj.maxDodAttempts).toBe(2);
    expect(resolved[0].obj.claimedValue).toBe(2.9);
    expect(resolved[0].obj.clamped).toBe(true);
  });

  it('un retry hard-error emite dod.retry.hard_error (info) y dod.retry del attempt 2', async () => {
    await runWithStub({ dodMaxAttempts: 2, failUntil: 2 });

    const hardError = eventsOfType('dod.retry.hard_error');
    expect(hardError).toHaveLength(1);
    expect(hardError[0].level).toBe('info');
    expect(hardError[0].obj.attempt).toBe(1);
    expect(hardError[0].obj.nextAttempt).toBe(2);

    // dod.retry marca el inicio del attempt reintentado.
    const retry = eventsOfType('dod.retry');
    expect(retry).toHaveLength(1);
    expect(retry[0].level).toBe('info');
    expect(retry[0].obj.attempt).toBe(2);
    expect(retry[0].obj.maxAttempts).toBe(2);
  });

  it('claude.exit_nonzero se emite a nivel error en cada crash, con willRetry correcto', async () => {
    await runWithStub({ dodMaxAttempts: 3, failUntil: 999 });
    const crashes = eventsOfType('claude.exit_nonzero');
    expect(crashes).toHaveLength(3);
    for (const c of crashes) {
      expect(c.level).toBe('error');
      expect(c.obj.exitCode).toBe(1);
    }
    // Los 2 primeros crashes tienen budget → willRetry=true; el último no.
    expect(crashes[0].obj.willRetry).toBe(true);
    expect(crashes[1].obj.willRetry).toBe(true);
    expect(crashes[2].obj.willRetry).toBe(false);
  });

  it('un run de un solo attempt NO emite eventos de retry', async () => {
    await runWithStub({ dodMaxAttempts: 1, failUntil: 999 });
    expect(eventsOfType('dod.retry')).toHaveLength(0);
    expect(eventsOfType('dod.retry.hard_error')).toHaveLength(0);
  });
});
