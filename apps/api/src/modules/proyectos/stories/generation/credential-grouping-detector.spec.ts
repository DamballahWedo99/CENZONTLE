import type { DiscoveredDependency } from '@cenzontle/shared';
import { detectGroupedCredentials } from './credential-grouping-detector';

function dep(title: string, overrides: Partial<DiscoveredDependency> = {}): DiscoveredDependency {
  return {
    id: `ai-dep-${Math.random().toString(36).slice(2)}`,
    title,
    description: '',
    severity: 'medium',
    type: 'other',
    mdContent: '',
    ...overrides,
  };
}

describe('detectGroupedCredentials', () => {
  describe('happy path — no flags', () => {
    it('retorna [] cuando deps es vacío', () => {
      expect(detectGroupedCredentials([])).toEqual([]);
    });

    it('no flagea single secret con SCREAMING_SNAKE_CASE', () => {
      expect(detectGroupedCredentials([dep('VERCEL_TOKEN')])).toEqual([]);
    });

    it('no flagea single secret común con underscores', () => {
      expect(detectGroupedCredentials([dep('AWS_ACCESS_KEY_ID')])).toEqual([]);
      expect(detectGroupedCredentials([dep('AWS_SECRET_ACCESS_KEY')])).toEqual([]);
      expect(detectGroupedCredentials([dep('NEXTAUTH_SECRET')])).toEqual([]);
    });

    it('no flagea títulos descriptivos con un solo token uppercase', () => {
      expect(detectGroupedCredentials([dep('Stripe API Key')])).toEqual([]);
      expect(detectGroupedCredentials([dep('GCP Service Account JSON')])).toEqual([]);
      expect(detectGroupedCredentials([dep('AWS IAM Role')])).toEqual([]);
      expect(detectGroupedCredentials([dep('Twilio Auth Token')])).toEqual([]);
    });

    it('no flagea siglas cortas (<4 chars) repetidas — son legítimas', () => {
      expect(detectGroupedCredentials([dep('AWS_LAMBDA_AWS_REGION')])).toEqual([]);
      expect(detectGroupedCredentials([dep('GCP_GCP_PROJECT')])).toEqual([]);
    });

    it('ignora deps con title vacío o whitespace', () => {
      expect(detectGroupedCredentials([dep(''), dep('   ')])).toEqual([]);
    });
  });

  describe('R1 — lista separada por delimiter explícito', () => {
    it('flagea separación por coma (caso del bug reportado por el user)', () => {
      const offenders = detectGroupedCredentials([
        dep('GitHub Secrets: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID'),
      ]);
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toContain('VERCEL_TOKEN');
    });

    it('flagea separación por +', () => {
      const offenders = detectGroupedCredentials([
        dep('AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY'),
      ]);
      expect(offenders).toHaveLength(1);
    });

    it('flagea separación por /', () => {
      const offenders = detectGroupedCredentials([
        dep('STRIPE_PUBLIC_KEY / STRIPE_SECRET_KEY'),
      ]);
      expect(offenders).toHaveLength(1);
    });

    it('flagea separación por ;', () => {
      const offenders = detectGroupedCredentials([
        dep('GITHUB_TOKEN; VERCEL_TOKEN'),
      ]);
      expect(offenders).toHaveLength(1);
    });

    it('flagea separación por &', () => {
      const offenders = detectGroupedCredentials([
        dep('GITHUB_TOKEN & NEXTAUTH_SECRET'),
      ]);
      expect(offenders).toHaveLength(1);
    });
  });

  describe('R2 — prefijo plural', () => {
    it('flagea "Secrets:" como prefijo', () => {
      expect(
        detectGroupedCredentials([dep('Secrets: api_key, db_url')]),
      ).toHaveLength(1);
    });

    it('flagea "GitHub Secrets:" como prefijo', () => {
      expect(
        detectGroupedCredentials([dep('GitHub Secrets: x, y')]),
      ).toHaveLength(1);
    });

    it('flagea "Keys:", "Tokens:", "Credentials:", "Variables:" case-insensitive', () => {
      expect(detectGroupedCredentials([dep('Keys: a, b')])).toHaveLength(1);
      expect(detectGroupedCredentials([dep('TOKENS: x, y')])).toHaveLength(1);
      expect(detectGroupedCredentials([dep('credentials: a, b')])).toHaveLength(1);
      expect(detectGroupedCredentials([dep('Variables: VAR1, VAR2')])).toHaveLength(1);
    });

    it('no flagea "Secret" (singular) como prefijo', () => {
      expect(detectGroupedCredentials([dep('Secret: stripe_key')])).toEqual([]);
    });
  });

  describe('R3 — token UPPERCASE repetido sin separador explícito', () => {
    it('flagea concatenación con underscores (caso del user)', () => {
      const offenders = detectGroupedCredentials([
        dep('GITHUB_SECRETS_VERCEL_TOKEN_VERCEL_ORG_ID_VERCEL_PROJECT_ID'),
      ]);
      expect(offenders).toHaveLength(1);
    });

    it('flagea cuando el mismo vendor (≥4 chars) aparece 2+ veces', () => {
      expect(
        detectGroupedCredentials([dep('VERCEL_TOKEN_VERCEL_ORG_ID')]),
      ).toHaveLength(1);
    });

    it('no flagea cuando el token repetido es <4 chars (sigla común)', () => {
      expect(detectGroupedCredentials([dep('AWS_AWS_REGION')])).toEqual([]);
    });
  });

  describe('múltiples deps en input', () => {
    it('retorna solo los ofensores, ignorando legítimos', () => {
      const offenders = detectGroupedCredentials([
        dep('Stripe API Key'),
        dep('GitHub Secrets: VERCEL_TOKEN, VERCEL_ORG_ID'),
        dep('AWS_ACCESS_KEY_ID'),
        dep('Twilio Auth Token'),
        dep('AWS_LAMBDA_FN_ENV: KEY1, KEY2'),
      ]);
      expect(offenders).toHaveLength(2);
      expect(offenders[0]).toContain('VERCEL_TOKEN');
      expect(offenders[1]).toContain('KEY1');
    });

    it('trunca títulos largos a 80 chars con elipsis', () => {
      const longTitle = 'GitHub Secrets: ' + 'A'.repeat(100) + ', ' + 'B'.repeat(100);
      const offenders = detectGroupedCredentials([dep(longTitle)]);
      expect(offenders).toHaveLength(1);
      expect(offenders[0].length).toBe(78); // 77 chars + …
      expect(offenders[0].endsWith('…')).toBe(true);
    });
  });
});
