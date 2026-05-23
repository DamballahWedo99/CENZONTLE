import { defineConfig } from 'vitest/config';

/**
 * Config de Vitest del Forge Worker.
 *
 * El worker es un binario Node headless (sin browser, sin DOM) → environment
 * 'node'. Los tests `*.e2e.test.ts` corren el flujo REAL de `runStory`:
 * spawnean procesos hijo (stubs de claude/tmux/ttyd) y tocan el filesystem.
 * Por eso:
 *  - pool 'forks': aislamiento por proceso. Cada archivo de test muta
 *    `process.env` (CLAUDE_BIN, sandbox flags) y debe quedar contenido —
 *    forks da un proceso fresco por archivo, sin contaminación cruzada.
 *  - testTimeout amplio: los stubs hacen `sleep` para que los writes async
 *    del log file del worker aterricen antes de que el worker los relea;
 *    un timeout corto los volvería flaky bajo carga.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Foco: la policy pura del retry loop (dod-retry.ts → 100 %, verificable
      // aislado con `vitest run dod-retry --coverage`). runner.ts es enorme y
      // mayormente I/O — su cobertura sale de los e2e y se mira como
      // referencia, no como gate. Sin thresholds: romper el build por la
      // superficie pre-existente sin tests no aporta.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
    },
  },
});
