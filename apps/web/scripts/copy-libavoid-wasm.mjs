#!/usr/bin/env node
/**
 * Copia `libavoid.wasm` desde `node_modules/libavoid-js/dist/` a `public/`
 * para que Next.js lo sirva como asset estático en `/libavoid.wasm`.
 *
 * Se ejecuta como postinstall del workspace `web` — cada `pnpm install`
 * refresca la copia para mantenerla sincronizada con la versión que
 * pnpm resolvió. Evita que un upgrade de `libavoid-js` deje el WASM
 * desactualizado silenciosamente.
 *
 * Soporta node_modules "flat" (install standalone en apps/web) y
 * "hoisted" (monorepo con deps elevadas a la raíz). Si `libavoid-js` se
 * resolvió arriba, el script lo encuentra sin fallar.
 *
 * Si el WASM no existe (p. ej. install parcial o removido), sale con
 * warning pero exit 0 — NO rompe el install del resto del monorepo.
 *
 * ESM (`.mjs`): el workspace no declara `"type": "module"`, así que la
 * extensión es lo que le dice a Node que lo cargue como módulo ES.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolver CJS para localizar el asset dentro del grafo de node_modules.
// `import.meta.resolve` no acepta un origen distinto al de este módulo, y
// necesitamos resolver *desde el package `web`* (ver `paths` abajo).
const nodeRequire = createRequire(import.meta.url);

/**
 * Estrategia de resolución (en orden):
 *  1. `require.resolve` — sigue el grafo de symlinks de pnpm correctamente.
 *     Funciona para flat, hoisted, y worktrees donde `node_modules` vive
 *     a N niveles arriba.
 *  2. Candidatos explícitos — fallback para entornos exóticos donde
 *     `require.resolve` no resuelve (p. ej. pnpm con
 *     `--shamefully-hoist=false` y lockfile parcial).
 */
function resolveWasmSource() {
  // Intento 1: require.resolve sigue los symlinks de pnpm
  try {
    const webPackageDir = path.join(__dirname, '..');
    return nodeRequire.resolve('libavoid-js/dist/libavoid.wasm', {
      paths: [webPackageDir],
    });
  } catch {
    // Siguiente estrategia
  }

  // Intento 2: paths explícitos (flat + hoisted + monorepo root)
  const explicitCandidates = [
    path.join(__dirname, '..', 'node_modules', 'libavoid-js', 'dist', 'libavoid.wasm'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'libavoid-js', 'dist', 'libavoid.wasm'),
    path.join(__dirname, '..', '..', 'node_modules', 'libavoid-js', 'dist', 'libavoid.wasm'),
  ];
  return explicitCandidates.find((p) => fs.existsSync(p)) || null;
}

const src = resolveWasmSource();
const candidates = [src].filter(Boolean);
const dest = path.join(__dirname, '..', 'public', 'libavoid.wasm');

if (!src) {
  console.warn(
    '[copy-libavoid-wasm] libavoid.wasm no encontrado en ninguno de los paths esperados.\n' +
      '                    Candidatos probados:\n' +
      candidates.map((p) => `                      - ${p}`).join('\n') +
      '\n                    Ejecutá `pnpm install` en el workspace web.',
  );
  process.exit(0);
}

const publicDir = path.dirname(dest);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.copyFileSync(src, dest);
console.log(`[copy-libavoid-wasm] libavoid.wasm → ${path.relative(process.cwd(), dest)}`);
