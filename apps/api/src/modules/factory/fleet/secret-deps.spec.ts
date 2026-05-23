import { classifySecretDependencies, type SecretDepInput } from './secret-deps';

/**
 * Tests del gate de credenciales bloqueantes — la lógica que decide si un
 * claim se rechaza y la historia escala a `blocked` (`materializeClaim`
 * delega esta clasificación en `classifySecretDependencies`).
 */
function dep(over: Partial<SecretDepInput>): SecretDepInput {
  return {
    title: 'Stripe API key',
    vendor: 'Stripe',
    requiresCredential: false,
    isBlocking: false,
    linkedSecretId: null,
    ...over,
  };
}

describe('classifySecretDependencies', () => {
  it('requiresCredential + isBlocking + sin link → blockingGaps', () => {
    const { blockingGaps, nonBlockingGaps } = classifySecretDependencies([
      dep({ requiresCredential: true, isBlocking: true, linkedSecretId: null }),
    ]);
    expect(blockingGaps).toEqual([{ vendor: 'Stripe', title: 'Stripe API key' }]);
    expect(nonBlockingGaps).toEqual([]);
  });

  it('requiresCredential + NO bloqueante + sin link → nonBlockingGaps', () => {
    const { blockingGaps, nonBlockingGaps } = classifySecretDependencies([
      dep({ requiresCredential: true, isBlocking: false, linkedSecretId: null }),
    ]);
    expect(nonBlockingGaps).toEqual([{ vendor: 'Stripe', title: 'Stripe API key' }]);
    expect(blockingGaps).toEqual([]);
  });

  it('dep ya vinculada (linkedSecretId presente) NO es gap', () => {
    const out = classifySecretDependencies([
      dep({
        requiresCredential: true,
        isBlocking: true,
        linkedSecretId: 'secret-uuid',
      }),
    ]);
    expect(out.blockingGaps).toEqual([]);
    expect(out.nonBlockingGaps).toEqual([]);
  });

  it('dep sin requiresCredential NO es gap, aunque sea bloqueante', () => {
    const out = classifySecretDependencies([
      dep({ requiresCredential: false, isBlocking: true, linkedSecretId: null }),
    ]);
    expect(out.blockingGaps).toEqual([]);
    expect(out.nonBlockingGaps).toEqual([]);
  });

  it('clasifica una mezcla y preserva vendor/title', () => {
    const out = classifySecretDependencies([
      dep({ title: 'A', vendor: 'Amadeus', requiresCredential: true, isBlocking: true, linkedSecretId: null }),
      dep({ title: 'B', vendor: null, requiresCredential: true, isBlocking: false, linkedSecretId: null }),
      dep({ title: 'C', vendor: 'Twilio', requiresCredential: true, isBlocking: true, linkedSecretId: 'x' }),
      dep({ title: 'D', vendor: 'Vercel', requiresCredential: false, isBlocking: true, linkedSecretId: null }),
    ]);
    expect(out.blockingGaps).toEqual([{ vendor: 'Amadeus', title: 'A' }]);
    expect(out.nonBlockingGaps).toEqual([{ vendor: null, title: 'B' }]);
  });

  it('lista vacía → sin gaps', () => {
    expect(classifySecretDependencies([])).toEqual({
      blockingGaps: [],
      nonBlockingGaps: [],
    });
  });
});
