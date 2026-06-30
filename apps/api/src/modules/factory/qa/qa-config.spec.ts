import { redactSecrets } from './qa-config';

/**
 * Specs de redactSecrets — la evidencia de los lentes se persiste en DB y se
 * expone por GET /factory/tests, así que NO debe contener secretos del código
 * generado (security-reviewer). redactSecrets delega en el scrubber canónico
 * `scrubSecrets`; estos tests verifican la propiedad de seguridad (el secreto
 * crudo desaparece) a través del entrypoint del módulo QA.
 */
describe('redactSecrets', () => {
  it('redacta una Anthropic API key', () => {
    const out = redactSecrets('const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";');
    expect(out).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(out).toContain('sk-ant-<REDACTED>');
  });

  it('redacta un GitHub PAT', () => {
    const out = redactSecrets('token=ghp_0123456789abcdefghijklmnopqrstuvwxyz');
    expect(out).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz');
    expect(out).toContain('ghp_<REDACTED>');
  });

  it('redacta un token de clone embebido en URL de git', () => {
    const out = redactSecrets('https://x-access-token:ghs_secrettoken123@github.com/o/r.git');
    expect(out).not.toContain('ghs_secrettoken123');
  });

  it('redacta una AWS access key ID (deja solo el prefijo)', () => {
    const out = redactSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(out).not.toContain('IOSFODNN7EXAMPLE');
    expect(out).toContain('AKIA<REDACTED>');
  });

  it('redacta un JWT (cubierto por el scrubber canónico, no por la lista vieja)', () => {
    const out = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4');
    expect(out).not.toContain('eyJhbGciOiJIUzI1');
    expect(out).toContain('<REDACTED_JWT>');
  });

  it('deja texto sin secretos intacto', () => {
    const clean = 'Test failed: expected 200 got 500 at line 42';
    expect(redactSecrets(clean)).toBe(clean);
  });

  it('no falla con string vacío', () => {
    expect(redactSecrets('')).toBe('');
  });
});
