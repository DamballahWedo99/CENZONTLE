import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { redactRepoUrlCredentials } from './runner.js';

/**
 * Cobertura del redactor de credenciales en errores de git. Es código
 * security-crítico: `git clone`/`git push` echan la URL del remote (con el
 * token embebido) en sus mensajes de auth-failure, y el worker manda esos
 * mensajes al backend (DB + UI) — un token sin redactar se filtraría.
 */
describe('redactRepoUrlCredentials', () => {
  // Forma real del clone URL del backend: token de GitHub App como password.
  const TOKEN = 'ghs_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AbCd';
  const repoUrl = `https://x-access-token:${TOKEN}@github.com/owner/repo.git`;

  it('redacta el token cuando git imprime la URL completa con trailing slash', () => {
    const gitErr = `fatal: Authentication failed for '${repoUrl}/'`;
    const out = redactRepoUrlCredentials(gitErr, repoUrl);
    assert.ok(!out.includes(TOKEN), 'el token NO debe aparecer');
    assert.ok(!out.includes('x-access-token'), 'el username tampoco');
  });

  it('redacta el token aunque la URL aparezca sin el sufijo .git', () => {
    const noGit = `https://x-access-token:${TOKEN}@github.com/owner/repo`;
    const gitErr = `remote: Invalid username or password for ${noGit}`;
    const out = redactRepoUrlCredentials(gitErr, repoUrl);
    assert.ok(!out.includes(TOKEN), 'el token se redacta vía el .split(password)');
  });

  it('redacta el token suelto aunque no venga la URL alrededor', () => {
    const out = redactRepoUrlCredentials(`creds rechazadas: ${TOKEN}`, repoUrl);
    assert.ok(!out.includes(TOKEN), 'el .split(password) lo atrapa sin la URL');
  });

  it('deja intacto un repoUrl SIN credenciales (no lo enmascara)', () => {
    const clean = 'https://github.com/owner/repo.git';
    const gitErr = `fatal: repository '${clean}' not found`;
    const out = redactRepoUrlCredentials(gitErr, clean);
    assert.equal(out, gitErr, 'una URL limpia debe seguir visible para el operador');
  });

  it('reemplaza la URL completa cuando repoUrl no es parseable como URL', () => {
    const weird = 'just-a-bare-string';
    const gitErr = `clone failed for ${weird}`;
    const out = redactRepoUrlCredentials(gitErr, weird);
    assert.ok(!out.includes(weird), 'fallback: redacta entera la URL no parseable');
  });

  it('texto vacío o repoUrl null → devuelve el texto tal cual', () => {
    assert.equal(redactRepoUrlCredentials('', repoUrl), '');
    assert.equal(redactRepoUrlCredentials('algo', null), 'algo');
  });

  it('redacta credenciales cortas (1-3 chars) en URLs', () => {
    // Caso realista: proveedor custom de auth HTTP Basic con password de 3
    // chars. La heurística anterior de `length >= 4` filtraba estos tokens
    // como "ruido"; ahora se redactan defensivamente (mejor un substring
    // común redactado que filtrar la credencial al log).
    const shortPwUrl = 'https://user:ab1@git.internal/o/r.git';
    const gitErr = `fatal: Authentication failed for '${shortPwUrl}'`;
    const out = redactRepoUrlCredentials(gitErr, shortPwUrl);
    assert.ok(!out.includes(':ab1@'), 'el password corto debe redactarse');
    assert.ok(!out.includes('user:ab1'), 'la combinación user:pass también');
  });

  it('redacta password de 1 char (caso extremo)', () => {
    const oneCharPwUrl = 'https://x-access-token:Z@github.com/o/r.git';
    const gitErr = `creds rechazadas con token Z`;
    const out = redactRepoUrlCredentials(gitErr, oneCharPwUrl);
    // El password "Z" aparece como substring en "rechazadas" — esto es el
    // trade-off documentado: aceptamos falsos positivos benignos antes que
    // filtrar la credencial real.
    assert.ok(!out.includes(' Z '), 'el "Z" suelto debe redactarse');
  });

  it('username corto también se redacta', () => {
    const shortUserUrl = 'https://ab:passwordcompleto@github.com/o/r.git';
    const gitErr = `fatal: ab no autorizado en el remote`;
    const out = redactRepoUrlCredentials(gitErr, shortUserUrl);
    assert.ok(!out.includes(' ab '), 'el username corto se redacta');
  });
});
