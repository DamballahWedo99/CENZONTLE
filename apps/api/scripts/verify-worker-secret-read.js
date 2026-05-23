/* ════════════════════════════════════════════════════════════════════════
 * verify-worker-secret-read.js — orquestador del verify:secrets con la KEY REAL
 * ════════════════════════════════════════════════════════════════════════
 *
 * El `verify:secrets` del worker necesita un `ANTHROPIC_API_KEY` real. La key
 * del Forge NO está en texto plano en ningún `.env` — vive encriptada en
 * `OrgAnthropicConfig` (la que se configura en /factory/settings → Anthropic
 * API Key, y que el claim real desencripta vía `getApiKeyPlaintext()`).
 *
 * Este script — del lado del API, que tiene Prisma + la key de encripción —
 * desencripta esa key y corre el harness del worker pasándosela por env var.
 * La key plaintext NUNCA se imprime ni toca disco.
 *
 * ⚠️ Gasta tokens reales de la API de Anthropic. Doble opt-in:
 *   RUN_SECRET_READ_CHECK=1 pnpm --filter api verify:secrets
 */
const { readFileSync } = require('fs');
const { join } = require('path');
const { createDecipheriv, scryptSync } = require('crypto');
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

/** Extrae una var de un texto de `.env` (primera línea no comentada). */
function envVar(envText, name) {
  const m = envText.match(new RegExp('^' + name + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

/**
 * Réplica del decrypt de `CryptoService`
 * (apps/api/src/modules/vault/crypto.service.ts): AES-256-GCM con la key
 * derivada de VAULT_ENCRYPTION_KEY vía scrypt + el salt fijo del vault.
 */
function decryptVaultValue(vaultKey, enc) {
  const key = scryptSync(vaultKey, 'cenzontle:vault:v1', 32);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(enc.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(enc.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function main() {
  // ── Gate — opt-in explícito (CI nunca lo setea). ──────────────────────
  if (process.env.RUN_SECRET_READ_CHECK !== '1') {
    console.log(
      '\nverify:secrets (API) — NO ejecutado. Gasta tokens reales de Anthropic.\n' +
        'Opt-in explícito:\n' +
        '  RUN_SECRET_READ_CHECK=1 pnpm --filter api verify:secrets\n',
    );
    return 0;
  }

  // `.env` resuelto relativo a este archivo → funciona desde cualquier cwd.
  let envText;
  try {
    envText = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  } catch {
    console.error('ERROR: no se pudo leer apps/api/.env');
    return 1;
  }
  const databaseUrl = envVar(envText, 'DATABASE_URL');
  const vaultKey = envVar(envText, 'VAULT_ENCRYPTION_KEY');
  if (!databaseUrl || !vaultKey) {
    console.error(
      'ERROR: falta DATABASE_URL o VAULT_ENCRYPTION_KEY en apps/api/.env',
    );
    return 1;
  }
  // ── Leer la fila encriptada de OrgAnthropicConfig (singleton id='global'). ──
  // Prisma 7 → driver adapter explícito (mismo patrón que `PrismaService`).
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  let cfg;
  try {
    cfg = await prisma.orgAnthropicConfig.findUnique({ where: { id: 'global' } });
  } finally {
    await prisma.$disconnect();
  }
  if (!cfg || !cfg.apiKeyCiphertext || !cfg.apiKeyIv || !cfg.apiKeyAuthTag) {
    console.error(
      'ERROR: OrgAnthropicConfig no tiene una API key configurada ' +
        '(/factory/settings → Anthropic API Key).',
    );
    return 1;
  }

  // ── Desencriptar. ──────────────────────────────────────────────────────
  let realKey;
  try {
    realKey = decryptVaultValue(vaultKey, {
      ciphertext: cfg.apiKeyCiphertext,
      iv: cfg.apiKeyIv,
      authTag: cfg.apiKeyAuthTag,
    });
  } catch {
    console.error(
      'ERROR: no se pudo desencriptar la API key — ¿VAULT_ENCRYPTION_KEY no coincide?',
    );
    return 1;
  }
  if (!realKey || realKey.trim().length < 10) {
    console.error('ERROR: la API key desencriptada es inválida (muy corta).');
    return 1;
  }
  console.log(
    '[verify] API key del Forge desencriptada de OrgAnthropicConfig (len ' +
      realKey.length +
      '). Corriendo el harness del worker...\n',
  );

  // ── Correr el harness del worker con la key real. ─────────────────────
  // La key viaja por la env var del subproceso — nunca se imprime ni persiste.
  // Sandbox bypasseado: la lectura del secreto es lo que se valida acá; el
  // sandbox es ortogonal (y los runs anteriores probaron que no bloquea claude).
  try {
    execFileSync('pnpm', ['--filter', '@cenzontle/worker', 'verify:secrets'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: realKey,
        RUN_SECRET_READ_CHECK: '1',
        FACTORY_WORKER_SANDBOX_MODE: 'none',
        FACTORY_WORKER_ALLOW_NO_SANDBOX: '1',
      },
    });
    return 0;
  } catch (err) {
    // execFileSync lanza si el worker sale != 0 — el harness ya imprimió el detalle.
    return err && typeof err.status === 'number' ? err.status : 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[verify-worker-secret-read] error inesperado:', err);
    process.exit(1);
  });
