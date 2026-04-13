import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Encripta/desencripta secretos sensibles (tokens de GitHub, API keys) para
 * almacenamiento en PG. Usa AES-256-GCM, que es un AEAD (authenticated encryption
 * with associated data) — el auth tag detecta manipulación del ciphertext.
 *
 * La llave se deriva de `VAULT_ENCRYPTION_KEY` en env vars vía scrypt. Si la
 * env var no existe al arrancar, el servicio falla loud para evitar encriptar
 * con una llave default insegura.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12; // 96 bits, recomendado para GCM
  private static readonly KEY_LENGTH = 32; // 256 bits

  constructor() {
    const secret = process.env.VAULT_ENCRYPTION_KEY;
    if (!secret || secret.length < 16) {
      this.logger.error(
        'VAULT_ENCRYPTION_KEY no configurada o muy corta (< 16 chars). ' +
          'El CryptoService no puede operar de forma segura. Genera una key random: ' +
          'openssl rand -base64 32',
      );
      throw new Error('VAULT_ENCRYPTION_KEY missing or too short');
    }
    // Derivamos la key con scrypt en lugar de usar el secret raw,
    // así VAULT_ENCRYPTION_KEY puede ser cualquier string razonable
    // y scrypt lo convierte en exactamente 32 bytes de material criptográfico.
    // El salt "cenzontle:vault:v1" es público pero estable — cambiarlo rotaría
    // efectivamente la key y requeriría re-encriptar todos los tokens.
    this.key = scryptSync(secret, 'cenzontle:vault:v1', CryptoService.KEY_LENGTH);
    this.logger.log('[ctor] CryptoService initialized');
  }

  /**
   * Encripta plaintext y devuelve los 3 componentes necesarios para desencriptar.
   * Cada llamada genera un IV único random — ciphertexts del mismo plaintext son distintos.
   */
  encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
    const iv = randomBytes(CryptoService.IV_LENGTH);
    const cipher = createCipheriv(CryptoService.ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  /**
   * Desencripta un ciphertext previamente producido por `encrypt()`.
   * Si el auth tag no valida (archivo manipulado o key incorrecta),
   * lanza una excepción — NO devolvemos plaintext posiblemente comprometido.
   */
  decrypt(params: { ciphertext: string; iv: string; authTag: string }): string {
    try {
      const iv = Buffer.from(params.iv, 'base64');
      const ciphertext = Buffer.from(params.ciphertext, 'base64');
      const authTag = Buffer.from(params.authTag, 'base64');

      const decipher = createDecipheriv(CryptoService.ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch (err) {
      this.logger.error('[decrypt] failed to decrypt — key mismatch or tampered data');
      throw new InternalServerErrorException('Error desencriptando secret');
    }
  }

  /**
   * Genera una "máscara" segura para mostrar en UI: primeros 4 + últimos 4 caracteres
   * del token, con `•` en medio. Nunca expone el token completo.
   *
   * Ejemplo: `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` → `ghp_••••••••••••••••••••••anfH`
   */
  static mask(token: string): string {
    if (token.length <= 8) return '••••••••';
    const prefix = token.slice(0, 4);
    const suffix = token.slice(-4);
    return `${prefix}${'•'.repeat(Math.min(token.length - 8, 24))}${suffix}`;
  }
}
