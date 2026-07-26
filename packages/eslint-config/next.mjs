import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Assets estáticos, no código fuente. Aquí viven binarios de terceros que
    // se sirven tal cual (pdf.worker.min.mjs de Mozilla, libavoid.wasm):
    // lintear un bundle minificado no dice nada y su licencia prohíbe
    // modificarlo sin reflejarlo en NOTICES.md.
    "public/**",
  ]),
]);

export default eslintConfig;
