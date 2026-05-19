import type { PinoLogger } from 'nestjs-pino';

/**
 * Mock no-op de `PinoLogger` para tests unitarios. Cada método es `jest.fn()`
 * → tests pueden hacer assertions tipo `expect(mock.info).toHaveBeenCalled()`
 * cuando quieran verificar comportamiento de logging, o ignorar las llamadas
 * cuando no son relevantes.
 *
 * Uso típico (replaces `private readonly logger` que era local pre-migración):
 *   ```ts
 *   service = new SomeService(prisma, deps, ..., createMockPinoLogger());
 *   ```
 *
 * El cast `as unknown as PinoLogger` es necesario porque PinoLogger tiene
 * propiedades privadas internas de pino (`logger`, `contextName`, etc.) que
 * NO necesitamos mockear — los tests solo invocan los métodos públicos.
 */
export function createMockPinoLogger(): PinoLogger {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
    assign: jest.fn(),
  } as unknown as PinoLogger;
}
