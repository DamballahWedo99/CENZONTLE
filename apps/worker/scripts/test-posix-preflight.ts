// Test standalone del POSIX newline preflight — cero tokens, ~5s wall-clock.
//
// Run with:
//   cd apps/worker && pnpm exec tsx scripts/test-posix-preflight.ts
//
// Estrategia:
//   1. Crear workdir temporal con archivos de prueba (algunos con trailing \n,
//      otros sin)
//   2. Invocar `preflightTechnicalRequirement` directamente con varios shape
//      de TL requirements (POSIX newline, no-POSIX, mixed)
//   3. Assertions manuales — print PASS por caso, FAIL con detail
//   4. Cleanup workdir + exit 0/1 según outcome
//
// Cubre 7 casos:
//   1. POSIX requirement + file con \n final     → ok=true
//   2. POSIX requirement + file SIN \n final     → ok=false, fix command exacto
//   3. POSIX requirement + multiple files mixed  → ok=false, lista solo los broken
//   4. POSIX requirement + file no existe        → fall-through (ningún match POSIX)
//   5. NO POSIX requirement                       → fall-through al flow normal
//   6. POSIX requirement + sin filenames extraíbles → fall-through
//   7. POSIX requirement + archivo vacío (0 bytes) → fail (vacío != termina con \n)
//
// Si todos los casos pasan: exit 0. Si alguno falla: exit 1 + detail del caso.

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { preflightTechnicalRequirement } from '../src/lib/tl-preflight.js';

let failures = 0;
let passes = 0;

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ ${msg}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function assertContains(haystack: string | null, needle: string, msg: string): void {
  if (haystack && haystack.includes(needle)) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ ${msg}`);
    console.error(`    expected to contain: "${needle}"`);
    console.error(`    actual: ${JSON.stringify(haystack)}`);
  }
}

async function main() {
  const workdir = await fs.mkdtemp(join(tmpdir(), `posix-preflight-test-${randomUUID().slice(0, 8)}-`));
  console.log(`\n[setup] workdir: ${workdir}\n`);

  try {
    // Setup files
    await fs.writeFile(join(workdir, 'good.html'), '<html></html>\n', 'utf8');           // tiene \n
    await fs.writeFile(join(workdir, 'bad.html'), '<html></html>', 'utf8');              // sin \n
    await fs.writeFile(join(workdir, 'also-bad.json'), '{"x":1}', 'utf8');               // sin \n
    await fs.writeFile(join(workdir, 'also-good.md'), '# Title\n', 'utf8');              // tiene \n
    await fs.writeFile(join(workdir, 'empty.html'), '', 'utf8');                          // vacío
    console.log('[setup] 5 archivos test creados (3 con \\n, 2 sin \\n)\n');

    // ────────────────────────────────────────────────────────────────────
    // Caso 1: POSIX requirement + file con \n final → ok=true
    // ────────────────────────────────────────────────────────────────────
    console.log('[Caso 1] POSIX requirement + file con \\n → debe PASS sin Sonnet\n');
    {
      const result = await preflightTechnicalRequirement(workdir, {
        category: 'contract',
        description: 'Línea final con newline `\\n` (estándar POSIX) en `good.html`',
      });
      assertEq(result.ok, true, 'ok=true (preflight passed)');
      assertEq(result.category, 'ok', 'category=ok');
      assertEq(result.candidatePaths.includes('good.html'), true, 'candidatePaths incluye good.html');
    }
    console.log();

    // ────────────────────────────────────────────────────────────────────
    // Caso 2: POSIX requirement + file SIN \n → ok=false con comando exacto
    // ────────────────────────────────────────────────────────────────────
    console.log('[Caso 2] POSIX requirement + file SIN \\n → debe FAIL con fix command\n');
    {
      const result = await preflightTechnicalRequirement(workdir, {
        category: 'contract',
        description: 'Línea final con newline `\\n` (estándar POSIX) en `bad.html`',
      });
      assertEq(result.ok, false, 'ok=false (preflight failed)');
      assertEq(result.category, 'identifiers-missing', 'category=identifiers-missing');
      assertContains(result.reason, 'bad.html', 'reason menciona el file');
      assertContains(result.reason, 'printf "\\n" >> bad.html', 'reason incluye comando fix exacto');
      assertContains(result.reason, 'tail -c1', 'reason incluye comando de verificación');
    }
    console.log();

    // ────────────────────────────────────────────────────────────────────
    // Caso 3: POSIX requirement + multiple files mixed → fail solo lista broken
    // ────────────────────────────────────────────────────────────────────
    console.log('[Caso 3] POSIX requirement con 2 files (1 bueno, 1 malo) → debe FAIL listando solo el malo\n');
    {
      const result = await preflightTechnicalRequirement(workdir, {
        category: 'errors',
        description: 'Los archivos `good.html` y `bad.html` deben terminar con newline POSIX',
      });
      assertEq(result.ok, false, 'ok=false');
      assertContains(result.reason, 'bad.html', 'reason menciona bad.html (broken)');
      // good.html NO debería aparecer en el reason de fail (ya tiene newline)
      const reasonHasGood = result.reason?.includes('good.html');
      assertEq(reasonHasGood, false, 'reason NO menciona good.html (ya tiene \\n)');
    }
    console.log();

    // ────────────────────────────────────────────────────────────────────
    // Caso 4: POSIX requirement + file no existe → fall-through (flow normal)
    // ────────────────────────────────────────────────────────────────────
    console.log('[Caso 4] POSIX requirement + file inexistente → fall-through al flow normal\n');
    {
      const result = await preflightTechnicalRequirement(workdir, {
        category: 'contract',
        description: 'Línea final con newline `\\n` (estándar POSIX) en `nonexistent.html`',
      });
      // Fall-through invoca el flow normal (extractTlIdentifiers + grep).
      // Como no encontramos source files en el workdir test (no hay .ts/.py/etc.),
      // debería retornar no-source-files o algo similar — NO el path POSIX.
      assertEq(
        result.category === 'no-source-files' || result.category === 'abstract' || result.category === 'identifiers-missing',
        true,
        `fall-through ejecutado (category=${result.category}, no path POSIX)`,
      );
    }
    console.log();

    // ────────────────────────────────────────────────────────────────────
    // Caso 5: NO POSIX requirement → fall-through inmediato
    // ────────────────────────────────────────────────────────────────────
    console.log('[Caso 5] NO POSIX requirement → fall-through al flow normal sin tocar POSIX path\n');
    {
      const result = await preflightTechnicalRequirement(workdir, {
        category: 'checklist',
        description: 'Implementar endpoint `POST /api/auth/login` con `LoginDto`',
      });
      // Sin source files .ts/.py en workdir → no-source-files
      assertEq(result.category, 'no-source-files', 'category=no-source-files (no path POSIX)');
    }
    console.log();

    // ────────────────────────────────────────────────────────────────────
    // Caso 6: POSIX requirement sin filenames extraíbles → fall-through
    // ────────────────────────────────────────────────────────────────────
    console.log('[Caso 6] POSIX requirement sin filenames → fall-through al flow normal\n');
    {
      const result = await preflightTechnicalRequirement(workdir, {
        category: 'contract',
        description: 'Todos los archivos deben terminar con newline POSIX',  // no menciona ningún file
      });
      assertEq(
        result.category === 'no-source-files' || result.category === 'abstract',
        true,
        `fall-through (category=${result.category}, sin path POSIX porque no hay files extraíbles)`,
      );
    }
    console.log();

    // ────────────────────────────────────────────────────────────────────
    // Caso 7: POSIX requirement + archivo vacío → FAIL (vacío != cumple)
    // ────────────────────────────────────────────────────────────────────
    console.log('[Caso 7] POSIX requirement + archivo vacío (0 bytes) → debe FAIL (vacío no cumple)\n');
    {
      const result = await preflightTechnicalRequirement(workdir, {
        category: 'contract',
        description: 'Línea final con newline `\\n` (POSIX) en `empty.html`',
      });
      assertEq(result.ok, false, 'ok=false (vacío no cumple)');
      assertContains(result.reason, 'empty.html', 'reason menciona empty.html');
    }
    console.log();
  } finally {
    // Cleanup
    await fs.rm(workdir, { recursive: true, force: true });
    console.log(`[cleanup] workdir borrado\n`);
  }

  // ────────────────────────────────────────────────────────────────────
  // Resumen final
  // ────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(60));
  console.log(`  ${passes} PASS, ${failures} FAIL`);
  console.log('═'.repeat(60));

  if (failures > 0) {
    console.error('\n❌ Hay tests fallidos — el preflight POSIX tiene un bug.');
    process.exit(1);
  } else {
    console.log('\n✅ Todos los tests pasaron — preflight POSIX funciona como debe.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
