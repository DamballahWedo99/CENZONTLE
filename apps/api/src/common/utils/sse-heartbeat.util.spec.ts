import type { Response } from 'express';
import { setupSseHeartbeat, SSE_HEARTBEAT_INTERVAL_MS } from './sse-heartbeat.util';

/**
 * Helper para construir un Response stub mínimo. Solo usamos `res.write`
 * en el helper, así que es lo único que stubbeamos.
 */
function buildResStub(): { res: Response; writes: string[] } {
  const writes: string[] = [];
  const res = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
  } as unknown as Response;
  return { res, writes };
}

describe('setupSseHeartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emite ": ping\\n\\n" cada SSE_HEARTBEAT_INTERVAL_MS al avanzar el timer', () => {
    const { res, writes } = buildResStub();
    const stop = setupSseHeartbeat(res);

    expect(writes).toHaveLength(0);

    jest.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
    expect(writes).toEqual([': ping\n\n']);

    jest.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
    expect(writes).toEqual([': ping\n\n', ': ping\n\n']);

    stop();
  });

  it('respeta intervalMs custom', () => {
    const { res, writes } = buildResStub();
    const stop = setupSseHeartbeat(res, 5_000);

    jest.advanceTimersByTime(4_999);
    expect(writes).toHaveLength(0);

    jest.advanceTimersByTime(1);
    expect(writes).toHaveLength(1);

    stop();
  });

  it('cleanup function detiene los pings', () => {
    const { res, writes } = buildResStub();
    const stop = setupSseHeartbeat(res, 1_000);

    jest.advanceTimersByTime(2_500);
    expect(writes).toHaveLength(2);

    stop();

    jest.advanceTimersByTime(10_000);
    expect(writes).toHaveLength(2); // sin nuevos pings tras stop
  });

  it('silencia errores de write (socket muerto) sin propagar', () => {
    let writeCallCount = 0;
    const res = {
      write: () => {
        writeCallCount++;
        throw new Error('socket muerto');
      },
    } as unknown as Response;

    const stop = setupSseHeartbeat(res, 1_000);

    // No debe tirar aunque write lance — el helper silencia para que el
    // interval siga vivo hasta que el caller llame stop() desde su own
    // close handler.
    expect(() => jest.advanceTimersByTime(2_500)).not.toThrow();
    expect(writeCallCount).toBe(2);

    stop();
  });

  it('cleanup es idempotente — multiple stop() calls no rompen', () => {
    const { res } = buildResStub();
    const stop = setupSseHeartbeat(res);

    expect(() => {
      stop();
      stop();
      stop();
    }).not.toThrow();
  });

  it('SSE_HEARTBEAT_INTERVAL_MS es 15s — bajo el bodyTimeout de undici (5min)', () => {
    // Este es el invariante que justifica el helper: el interval debe ser
    // significativamente menor que el bodyTimeout default de undici (300s)
    // y que los idle timeouts comunes de proxies (30-60s).
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBeLessThan(60_000);
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(5_000);
  });
});
