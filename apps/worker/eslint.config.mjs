// El worker es un CLI Node + TypeScript plano (sin NestJS, sin React). El
// preset `nestjs.mjs` del paquete compartido NO contiene reglas específicas
// de NestJS — es de facto la config genérica "Node + TS" del monorepo (el
// mismo preset que consume apps/api). Lo reusamos tal cual.
import nodeTsConfig from "@cenzontle/eslint-config/nestjs.mjs";

export default [
  ...nodeTsConfig,
  // `eslint.config.mjs`, `vitest.config.ts` y `scripts/` viven fuera de
  // `src/` y NO están en el tsconfig del worker (`include: ["src"]`). El
  // preset activa `parserOptions.project`; el parser type-aware falla con
  // archivos ausentes del proyecto TS. Los excluimos — el lint cubre `src/`,
  // que es el código que se compila y despliega. `coverage/` y `dist/` son
  // artefactos generados (Vitest v8 / tsc) — tampoco se lintean.
  {
    ignores: [
      "eslint.config.mjs",
      "vitest.config.ts",
      "scripts/**",
      "coverage/**",
      "dist/**",
    ],
  },
];
