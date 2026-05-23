import { classifyStoryRetryability } from './retry-eligibility';

describe('classifyStoryRetryability', () => {
  it("rechaza una story 'done' — terminal-exitosa, nada que reintentar", () => {
    const r = classifyStoryRetryability('done', null);
    expect(r.retryable).toBe(false);
    expect(r.reason).toMatch(/done/);
  });

  it("rechaza una story 'done' aunque tenga claimedAt set", () => {
    expect(classifyStoryRetryability('done', new Date()).retryable).toBe(false);
  });

  it("rechaza una story 'backlog' idle (sin claim) — ya está en cola", () => {
    const r = classifyStoryRetryability('backlog', null);
    expect(r.retryable).toBe(false);
    expect(r.reason).toMatch(/cola/);
  });

  it("permite reintentar una story 'backlog' YA claimeada (abandona el claim en vuelo)", () => {
    const r = classifyStoryRetryability('backlog', new Date());
    expect(r.retryable).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("permite reintentar una story 'blocked' (run crasheó / doom loop)", () => {
    expect(classifyStoryRetryability('blocked', null).retryable).toBe(true);
  });

  it("permite reintentar una story 'in_review' (mergeada con deuda técnica)", () => {
    expect(classifyStoryRetryability('in_review', null).retryable).toBe(true);
  });

  it("permite reintentar una story 'in_progress' (el run activo se abandona)", () => {
    expect(classifyStoryRetryability('in_progress', new Date()).retryable).toBe(
      true,
    );
  });

  it("permite reintentar estados intermedios ('todo', 'qa')", () => {
    expect(classifyStoryRetryability('todo', null).retryable).toBe(true);
    expect(classifyStoryRetryability('qa', null).retryable).toBe(true);
  });

  it('reason es no-null exactamente cuando retryable es false', () => {
    const cases: Array<[string, Date | null]> = [
      ['done', null],
      ['backlog', null],
      ['blocked', null],
      ['in_review', new Date()],
      ['in_progress', new Date()],
      ['backlog', new Date()],
      ['todo', null],
      ['qa', null],
    ];
    for (const [status, claimedAt] of cases) {
      const r = classifyStoryRetryability(status, claimedAt);
      expect(r.reason === null).toBe(r.retryable);
    }
  });
});
