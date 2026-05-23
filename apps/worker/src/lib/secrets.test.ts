// Tests unitarios de `secrets.ts` — la lógica de seguridad de los secretos
// externos del worker. Corre con el test runner nativo de Node (`node:test`),
// sin dependencias extra: `pnpm --filter @cenzontle/worker test`.

import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import type { ExternalSecretForWorker } from '@cenzontle/shared';
import {
  sanitizeExternalSecrets,
  buildSecretEnv,
  serializeDotenv,
  scanDiffForSecrets,
  makeRedactor,
  redactSecrets,
  RESERVED_ENV_NAMES,
} from './secrets.js';

/** Construye un secreto de prueba (vendor `null` por default). */
function secret(
  name: string,
  value: string,
  vendor: string | null = null,
): ExternalSecretForWorker {
  return { name, value, vendor };
}

describe('sanitizeExternalSecrets', () => {
  test('deja pasar un secreto válido y preserva el vendor', () => {
    const out = sanitizeExternalSecrets([
      secret('STRIPE_API_KEY', 'sk_live_abc12345', 'Stripe'),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'STRIPE_API_KEY');
    assert.equal(out[0].value, 'sk_live_abc12345');
    assert.equal(out[0].vendor, 'Stripe');
  });

  test('descarta nombres de env var reservados', () => {
    const out = sanitizeExternalSecrets([
      secret('PATH', 'value-larguito'),
      secret('HOME', 'value-larguito'),
      secret('ANTHROPIC_API_KEY', 'value-larguito'),
      secret('NODE_OPTIONS', 'value-larguito'),
      secret('LD_PRELOAD', 'value-larguito'),
    ]);
    assert.equal(out.length, 0);
  });

  test('descarta el prefijo reservado GIT_', () => {
    const out = sanitizeExternalSecrets([
      secret('GIT_DIR', 'value-larguito'),
      secret('GIT_SSH_COMMAND', 'value-larguito'),
    ]);
    assert.equal(out.length, 0);
  });

  test('NO descarta GITHUB_TOKEN — "GITHUB_" no es el prefijo "GIT_"', () => {
    const out = sanitizeExternalSecrets([secret('GITHUB_TOKEN', 'ghp_value12345')]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'GITHUB_TOKEN');
  });

  test('descarta nombres que no son identificadores de env var válidos', () => {
    const out = sanitizeExternalSecrets([
      secret('with-dash', 'value-larguito'),
      secret('1LEADING_DIGIT', 'value-larguito'),
      secret('WITH SPACE', 'value-larguito'),
      secret('lower.dot', 'value-larguito'),
      secret('', 'value-larguito'),
    ]);
    assert.equal(out.length, 0);
  });

  test('acepta nombres válidos en minúscula y con leading underscore', () => {
    const out = sanitizeExternalSecrets([
      secret('_private', 'value-larguito'),
      secret('lowercase_ok', 'value-larguito'),
    ]);
    assert.equal(out.length, 2);
  });

  test('descarta valores vacíos', () => {
    const out = sanitizeExternalSecrets([secret('EMPTY', '')]);
    assert.equal(out.length, 0);
  });

  test('descarta valores cortos (< 8 chars) — no se pueden proteger', () => {
    const out = sanitizeExternalSecrets([secret('SHORT', '1234')]);
    assert.equal(out.length, 0);
  });
});

describe('buildSecretEnv', () => {
  test('mapea name → value', () => {
    const env = buildSecretEnv([secret('A', 'one'), secret('B', 'two')]);
    assert.deepEqual(env, { A: 'one', B: 'two' });
  });

  test('array vacío → objeto vacío', () => {
    assert.deepEqual(buildSecretEnv([]), {});
  });

  test('las env vars fijas pisan al spread cuando van después (orden del caller)', () => {
    // Replica el patrón del spawn en runner.ts: secretos PRIMERO, fijas
    // DESPUÉS. Aunque `sanitizeExternalSecrets` ya filtra PATH/HOME, esto
    // verifica la defensa final del orden del spread.
    const merged = {
      ...buildSecretEnv([secret('HOME', 'evil'), secret('PATH', 'evil')]),
      HOME: 'real-home',
      PATH: 'real-path',
    };
    assert.equal(merged.HOME, 'real-home');
    assert.equal(merged.PATH, 'real-path');
  });
});

describe('serializeDotenv', () => {
  test('formato NAME="value" con newline final', () => {
    assert.equal(serializeDotenv([secret('A', 'abc')]), 'A="abc"\n');
  });

  test('array vacío → string vacío', () => {
    assert.equal(serializeDotenv([]), '');
  });

  test('una línea por secreto', () => {
    assert.equal(
      serializeDotenv([secret('A', 'one'), secret('B', 'two')]),
      'A="one"\nB="two"\n',
    );
  });

  test('escapa comillas dobles (no se puede cerrar el string antes de tiempo)', () => {
    assert.equal(serializeDotenv([secret('A', 'a"b')]), 'A="a\\"b"\n');
  });

  test('escapa backslash', () => {
    assert.equal(serializeDotenv([secret('A', 'a\\b')]), 'A="a\\\\b"\n');
  });

  test('escapa newline — no permite inyectar líneas NAME=value extra', () => {
    const out = serializeDotenv([secret('A', 'line1\nINJECTED=evil')]);
    // El newline real se escapa a `\n` literal → queda una sola línea.
    assert.equal(out, 'A="line1\\nINJECTED=evil"\n');
    assert.equal(out.split('\n').filter(Boolean).length, 1);
  });
});

describe('scanDiffForSecrets', () => {
  const longSecret = secret(
    'STRIPE_KEY',
    'value-long-enough-for-scanning-test',
    'Stripe',
  );

  test('detecta un valor de secreto en una línea AÑADIDA', () => {
    const diff = '+const k = "value-long-enough-for-scanning-test";';
    assert.deepEqual(scanDiffForSecrets(diff, [longSecret]), ['STRIPE_KEY']);
  });

  test('IGNORA un valor en una línea de contexto (no la añadió el agente)', () => {
    const diff = ' const k = "value-long-enough-for-scanning-test";';
    assert.deepEqual(scanDiffForSecrets(diff, [longSecret]), []);
  });

  test('IGNORA un valor en una línea eliminada', () => {
    const diff = '-const k = "value-long-enough-for-scanning-test";';
    assert.deepEqual(scanDiffForSecrets(diff, [longSecret]), []);
  });

  test('IGNORA el header de archivo +++', () => {
    const diff = '+++ b/value-long-enough-for-scanning-test.ts';
    assert.deepEqual(scanDiffForSecrets(diff, [longSecret]), []);
  });

  test('NO flaggea valores cortos (< 8 chars)', () => {
    const diff = '+const pin = "1234";';
    assert.deepEqual(scanDiffForSecrets(diff, [secret('PIN', '1234')]), []);
  });

  test('diff vacío → []', () => {
    assert.deepEqual(scanDiffForSecrets('', [longSecret]), []);
  });

  test('múltiples secretos: solo los que aparecen en líneas añadidas', () => {
    const a = secret('SECRET_A', 'aaaaaaaa-value-aaaaaaaa', 'V');
    const b = secret('SECRET_B', 'bbbbbbbb-value-bbbbbbbb', 'V');
    const diff = [
      '+++ b/config.ts',
      '+const x = "aaaaaaaa-value-aaaaaaaa";',
      ' const y = "bbbbbbbb-value-bbbbbbbb";',
    ].join('\n');
    assert.deepEqual(scanDiffForSecrets(diff, [a, b]), ['SECRET_A']);
  });
});

describe('makeRedactor', () => {
  test('makeRedactor([]) redacta patrones por prefijo (comportamiento legacy)', () => {
    const r = makeRedactor([]);
    const out = r('clave sk-ant-api03-abcDEF123456 fin');
    assert.match(out, /sk-ant-\[REDACTED\]/);
    assert.ok(!out.includes('abcDEF123456'));
  });

  test('redacta un GitHub PAT por patrón', () => {
    const r = makeRedactor([]);
    const out = r(`token ${'ghp_' + 'A'.repeat(36)}`);
    assert.match(out, /ghp_\[REDACTED\]/);
  });

  test('redacta credenciales embebidas en una URL', () => {
    const r = makeRedactor([]);
    const out = r('git push https://x-access-token:abc123secret@github.com/o/r');
    assert.ok(!out.includes('abc123secret'));
  });

  test('redacta un secreto externo por su valor exacto (>= 8 chars)', () => {
    const r = makeRedactor(['supersecretvalue123']);
    assert.equal(r('leak supersecretvalue123 here'), 'leak [REDACTED] here');
  });

  test('redacta el valor LITERALMENTE — no interpreta metacaracteres regex', () => {
    const value = 'key.[v1]*$x'; // lleno de metacaracteres regex
    const r = makeRedactor([value]);
    assert.equal(r(`token=${value} end`), 'token=[REDACTED] end');
  });

  test('NO redacta valores cortos (< 8 chars) por valor — evita sobre-redacción', () => {
    const r = makeRedactor(['1234']);
    assert.equal(r('el pin es 1234 ok'), 'el pin es 1234 ok');
  });

  test('redacta el valor más largo primero (substrings anidados)', () => {
    const r = makeRedactor(['commonprefix', 'commonprefixEXTRA']);
    assert.equal(r('x commonprefixEXTRA y'), 'x [REDACTED] y');
  });

  test('aplica ambas pasadas: valor exacto + patrones por prefijo', () => {
    const r = makeRedactor(['my-stripe-secret-xyz']);
    const out = r('stripe=my-stripe-secret-xyz anthropic=sk-ant-api03-zzzzzz999');
    assert.ok(!out.includes('my-stripe-secret-xyz'));
    assert.ok(!out.includes('zzzzzz999'));
  });

  test('redactSecrets exportado equivale a makeRedactor([])', () => {
    const tok = 'ghp_' + 'B'.repeat(36);
    assert.equal(redactSecrets(`x ${tok}`), makeRedactor([])(`x ${tok}`));
  });

  test('texto vacío → texto vacío', () => {
    assert.equal(makeRedactor(['whatever12345'])(''), '');
  });
});

describe('RESERVED_ENV_NAMES', () => {
  test('contiene las env vars críticas del sistema', () => {
    for (const name of [
      'PATH',
      'HOME',
      'USER',
      'LANG',
      'CI',
      'ANTHROPIC_API_KEY',
      'NODE_OPTIONS',
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
    ]) {
      assert.ok(RESERVED_ENV_NAMES.has(name), `${name} debe estar reservado`);
    }
  });
});
