import { ResilientThrottlerStorage } from './resilient-throttler.storage';
import type { ThrottlerStorage } from '@nestjs/throttler';

// Un registro "real" arbitrario que el storage Redis devolvería en el happy
// path. `timeToExpire` va en SEGUNDOS — así lo devuelve el storage real.
const REAL_RECORD = {
  totalHits: 7,
  timeToExpire: 42,
  isBlocked: false,
  timeToBlockExpire: 0,
};

/** Logger mudo — la mayoría de los tests no asertan sobre logs. */
const silentLogger = { warn: () => {} };

describe('ResilientThrottlerStorage', () => {
  it('delega en el storage real cuando Redis está sano', async () => {
    const delegate: ThrottlerStorage = {
      increment: jest.fn().mockResolvedValue(REAL_RECORD),
    };
    const storage = new ResilientThrottlerStorage(
      delegate,
      () => true,
      silentLogger,
    );

    const record = await storage.increment('key', 60_000, 60, 60_000, 'default');

    expect(record).toEqual(REAL_RECORD);
    expect(delegate.increment).toHaveBeenCalledWith(
      'key',
      60_000,
      60,
      60_000,
      'default',
    );
  });

  it('falla abierto SIN tocar Redis cuando la conexión no está sana', async () => {
    const delegate: ThrottlerStorage = { increment: jest.fn() };
    const storage = new ResilientThrottlerStorage(
      delegate,
      () => false,
      silentLogger,
    );

    const record = await storage.increment('key', 60_000, 60, 60_000, 'default');

    // timeToExpire va en SEGUNDOS (ttl entra en ms): 60_000 ms → 60 s.
    expect(record).toEqual({
      totalHits: 0,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    // Crítico: ni se intentó el comando — evita el offline-queue/hang de ioredis.
    expect(delegate.increment).not.toHaveBeenCalled();
  });

  it('falla abierto cuando el storage real lanza (Redis cae a mitad de vuelo)', async () => {
    const delegate: ThrottlerStorage = {
      increment: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const storage = new ResilientThrottlerStorage(
      delegate,
      () => true,
      silentLogger,
    );

    const record = await storage.increment('key', 30_000, 5, 30_000, 'default');

    expect(record.totalHits).toBe(0);
    expect(record.isBlocked).toBe(false);
    expect(record.timeToExpire).toBe(30); // 30_000 ms → 30 s
  });

  it('convierte ttl (ms) a timeToExpire (s) redondeando hacia arriba', async () => {
    const delegate: ThrottlerStorage = {
      increment: jest.fn().mockRejectedValue(new Error('down')),
    };
    const storage = new ResilientThrottlerStorage(
      delegate,
      () => true,
      silentLogger,
    );

    // 1_500 ms → Math.ceil(1.5) = 2 s.
    const record = await storage.increment('key', 1_500, 10, 1_500, 'default');
    expect(record.timeToExpire).toBe(2);
  });

  it('el registro fail-open nunca dispara 429: isBlocked=false y totalHits=0', async () => {
    const delegate: ThrottlerStorage = {
      increment: jest.fn().mockRejectedValue(new Error('down')),
    };
    const storage = new ResilientThrottlerStorage(
      delegate,
      () => true,
      silentLogger,
    );

    // El ThrottlerGuard lanza 429 cuando isBlocked es true; isBlocked se vuelve
    // true cuando totalHits > limit. limit=1 es el cap más estricto posible.
    const record = await storage.increment('key', 1_000, 1, 1_000, 'default');

    expect(record.isBlocked).toBe(false);
    expect(record.totalHits).toBe(0);
  });

  it('loguea un warn cuando entra en fail-open (degradación observable)', async () => {
    const logger = { warn: jest.fn() };
    const delegate: ThrottlerStorage = { increment: jest.fn() };
    const storage = new ResilientThrottlerStorage(delegate, () => false, logger);

    await storage.increment('key', 60_000, 60, 60_000, 'default');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('FAIL-OPEN'),
    );
  });

  it('rate-limita el warn: dos fail-opens seguidos → un solo log', async () => {
    const logger = { warn: jest.fn() };
    const delegate: ThrottlerStorage = { increment: jest.fn() };
    const storage = new ResilientThrottlerStorage(delegate, () => false, logger);

    await storage.increment('key', 60_000, 60, 60_000, 'default');
    await storage.increment('key', 60_000, 60, 60_000, 'default');

    // El 2º fail-open cae dentro de la ventana de 30s → no re-loguea.
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
