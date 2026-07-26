import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body para `POST /factory/queue/:batchId/approve-staging`. El operador
 * (rol TechLead o AltaGerencia) confirma con step-up auth — password actual
 * via Auth0 — que aprueba el merge del consolidated PR del integration
 * branch del Forge a DEV.
 *
 * El backend valida (en este orden):
 *   1. Pod intersection del usuario con la épica del batch (CWE-639).
 *   2. Rol estricto: TechLead o AltaGerencia (admin override).
 *   3. Password contra Auth0 (step-up auth via assertPasswordValid).
 *   4. Estado del batch: todas stories done O in_review (awaitingHumanGate)
 *      — solo en approval original; retries skipean esta verificación.
 *   5. Idempotency parcial: 409 SOLO si approval Y merge ambos terminales.
 *      Si solo approval persistió pero merge falló, retry permitido.
 *
 * Errores tipados que el frontend mapea a UI:
 *   - 400: batch no listo (stories pendientes) — UI deshabilita botón.
 *   - 401: contraseña incorrecta — UI muestra inline error.
 *   - 403: rol no autorizado — UI muestra "Solo TechLead puede aprobar".
 *   - 404: batchId no existe o user sin acceso al pod.
 *   - 409: ya aprobado Y mergeado — UI cambia a estado terminal.
 *   - 502/503: GitHub merge falló (rate limit, auth) o Auth0 no configurado.
 */

/**
 * Regex deny-list para `notes`. Construida via `new RegExp(string)` en vez de
 * literal `/.../` porque U+2028 y U+2029 son line terminators del source code
 * JS (incluso dentro de regex literals en TypeScript). Como string literal,
 * los escapes `\u2028`/`\u2029` se interpretan a sus codepoints correctamente.
 *
 * Caracteres bloqueados (deny-list, post security review):
 *   \r \n           → CR / LF — injection en commit trailers (Signed-off-by spoof).
 *   U+0085          → NEL (next-line) — render como salto en algunos parsers.
 *   U+2028 U+2029   → Unicode LINE/PARAGRAPH SEPARATOR — bypass del \n bloqueado.
 *   U+000B U+000C   → VT / FF — display garbling en commit/PR.
 *   \t              → TAB — corrupción de layout en PR body.
 *   # @ ` < >       → markdown headings / mentions / code / html tags.
 *   [ ]             → markdown links `[texto](url)` — vector de phishing.
 *
 * NOTE: si la deny-list sigue creciendo, invertir a allow-list:
 *   `^[\\p{L}\\p{N}\\s.,:;()!?_/-]*$` con flag `u` — más defendible a futuro.
 */
const NOTES_SAFE_PATTERN = new RegExp(
  // Los caracteres de control (VT U+000B, FF U+000C) SON la deny-list:
  // bloquearlos es el propósito del patrón. Quitarlos del rango reabre el
  // garbling en el commit/PR body.
  // eslint-disable-next-line no-control-regex -- deny-list intencional
  '^[^\\r\\n\\u0085\\u2028\\u2029\\u000B\\u000C\\t#@`<>\\[\\]]*$',
);

export class ApproveStagingGateDto {
  @ApiProperty({
    description:
      'Contraseña actual del usuario para step-up auth. Backend valida contra ' +
      'Auth0 (Resource Owner Password Grant) usando AuthService.assertPasswordValid. ' +
      'NUNCA se persiste; se valida y descarta.',
    minLength: 1,
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @ApiPropertyOptional({
    description:
      'Notas opcionales del approver — persistidas en el ChangelogEntry de la ' +
      'épica para audit trail y en el commit message del merge a DEV. Solo ' +
      'caracteres seguros: letras, números, espacios, puntuación básica. ' +
      'Bloqueamos caracteres usables para markdown injection en el PR body, ' +
      'spoofing de co-author en el commit, y notificaciones forjadas vía ' +
      'menciones en GitHub. Si el operador necesita formato rico, sube las ' +
      'notas como comment del PR en GitHub directamente.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(NOTES_SAFE_PATTERN, {
    message:
      'Las notas solo aceptan letras, números, espacios y puntuación básica. ' +
      'No se permiten saltos de línea, tabs, ni los símbolos #, @, `, <, >, [, ] — ' +
      'esos pueden inyectar markdown o spoof co-author en el commit.',
  })
  notes?: string;
}
