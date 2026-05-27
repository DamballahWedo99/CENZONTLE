import { detectDoomLoopKind } from '@cenzontle/shared';
import { extractFailureInfo } from './failure-info';

/**
 * Specs de la extracción de la checklist DoD que alimenta la sección
 * "Stories sin completar" del merge view. Funciones puras — sin mocks.
 */

describe('detectDoomLoopKind', () => {
  it('devuelve null para errorMessage null/undefined/vacío', () => {
    expect(detectDoomLoopKind(null)).toBeNull();
    expect(detectDoomLoopKind(undefined)).toBeNull();
    expect(detectDoomLoopKind('')).toBeNull();
  });

  it('devuelve null para un fallo que no es doom loop', () => {
    expect(detectDoomLoopKind('Run abandoned by sweeper after 10min')).toBeNull();
    expect(detectDoomLoopKind('exit code 1: npm install failed')).toBeNull();
  });

  it('detecta regression del mensaje canónico del worker', () => {
    const msg =
      'Doom loop detectado en attempt 3 — REGRESIÓN: passedCount efectivo bajó de 3 a 1.';
    expect(detectDoomLoopKind(msg)).toBe('regression');
  });

  it('detecta regression sin tilde (REGRESION)', () => {
    expect(detectDoomLoopKind('... REGRESION: ...')).toBe('regression');
  });

  it('detecta stagnation del mensaje canónico del worker', () => {
    const msg =
      'Doom loop detectado en attempt 3 — ESTANCAMIENTO: passedCount no aumentó (1 → 1).';
    expect(detectDoomLoopKind(msg)).toBe('stagnation');
  });

  it('es case-insensitive', () => {
    expect(detectDoomLoopKind('doom loop ... regresión ...')).toBe('regression');
    expect(detectDoomLoopKind('... estancamiento ...')).toBe('stagnation');
  });
});

describe('extractFailureInfo', () => {
  it('devuelve estructura vacía cuando dodVerification es null', () => {
    expect(extractFailureInfo(null, null)).toEqual({
      attempts: 0,
      doomLoopKind: null,
      criteria: [],
    });
  });

  it('devuelve estructura vacía cuando dodVerification es []', () => {
    expect(extractFailureInfo([], null)).toEqual({
      attempts: 0,
      doomLoopKind: null,
      criteria: [],
    });
  });

  it('combina doomLoopKind del errorMessage aunque dodVerification sea null', () => {
    const result = extractFailureInfo(null, '... REGRESIÓN ...');
    expect(result.doomLoopKind).toBe('regression');
    expect(result.attempts).toBe(0);
  });

  it('reporta attempts = longitud del array de attempts', () => {
    const dod = [
      { attempt: 1, verdicts: [] },
      { attempt: 2, verdicts: [] },
      { attempt: 3, verdicts: [] },
    ];
    expect(extractFailureInfo(dod, null).attempts).toBe(3);
  });

  it('la checklist incluye TODOS los criterios — passed, failed y skipped', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'code-written', label: 'Código', status: 'passed' },
          { criterionId: 'tests', label: 'Tests', status: 'failed', reason: '3 fallan' },
          { criterionId: 'pr-created', label: 'PR creado', status: 'skipped', reason: 'sandbox' },
        ],
      },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    expect(criteria).toHaveLength(3);
    expect(criteria.map((c) => c.status)).toEqual(['passed', 'failed', 'skipped']);
  });

  it('REGRESSION DEL BUG: usa verdict.status (no un campo `passed` inexistente)', () => {
    // El shape canónico es { criterionId, status }. Si extractFailureInfo
    // leyera `verdict.passed`, todo saldría como 'failed' (status undefined).
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'c1', label: 'C1', status: 'passed' },
          { criterionId: 'c2', label: 'C2', status: 'failed', reason: 'x' },
        ],
      },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    expect(criteria.find((c) => c.id === 'c1')?.status).toBe('passed');
    expect(criteria.find((c) => c.id === 'c2')?.status).toBe('failed');
  });

  it('MERGE across attempts: last-wins por criterionId', () => {
    // El criterio 'tests' falla en attempt 1, pasa en attempt 2 → debe
    // quedar como passed (el attempt más reciente gana).
    const dod = [
      { attempt: 1, verdicts: [{ criterionId: 'tests', label: 'Tests', status: 'failed', reason: 'viejo' }] },
      { attempt: 2, verdicts: [{ criterionId: 'tests', label: 'Tests', status: 'passed' }] },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].status).toBe('passed');
  });

  it('MERGE: un criterio ausente del último attempt NO se pierde', () => {
    // Surgical retry — attempt 2 re-verifica solo 'tests', NO 'code-written'.
    // Leer solo el último attempt perdería 'code-written'. El merge lo conserva.
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'code-written', label: 'Código', status: 'passed' },
          { criterionId: 'tests', label: 'Tests', status: 'failed', reason: 'v1' },
        ],
      },
      {
        attempt: 2,
        verdicts: [
          { criterionId: 'tests', label: 'Tests', status: 'failed', reason: 'sigue fallando' },
        ],
      },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    expect(criteria).toHaveLength(2);
    expect(criteria.find((c) => c.id === 'code-written')?.status).toBe('passed');
    expect(criteria.find((c) => c.id === 'tests')?.reason).toBe('sigue fallando');
  });

  it('preserva el orden de primera-aparición de cada criterio', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'a', label: 'A', status: 'passed' },
          { criterionId: 'b', label: 'B', status: 'failed', reason: 'x' },
          { criterionId: 'c', label: 'C', status: 'passed' },
        ],
      },
      { attempt: 2, verdicts: [{ criterionId: 'b', label: 'B', status: 'passed' }] },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    expect(criteria.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('reason vacío para criterios passed', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'c1', label: 'C1', status: 'passed', reason: 'no debería aparecer' },
        ],
      },
    ];
    expect(extractFailureInfo(dod, null).criteria[0].reason).toBe('');
  });

  it('prefiere `reason` sobre `output` crudo en los failed', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          {
            criterionId: 'tests',
            label: 'Tests',
            status: 'failed',
            reason: 'explicación concisa',
            output: 'DUMP CRUDO ...',
          },
        ],
      },
    ];
    expect(extractFailureInfo(dod, null).criteria[0].reason).toBe(
      'explicación concisa',
    );
  });

  it('cae a `output` cuando `reason` no viene', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'tests', label: 'Tests', status: 'failed', output: 'stderr dump' },
        ],
      },
    ];
    expect(extractFailureInfo(dod, null).criteria[0].reason).toBe('stderr dump');
  });

  it('trunca el reason a 500 chars con elipsis', () => {
    // El cap es 500 (no 200 como decía el test viejo) — alineado con
    // REASON_MAX_CHARS de failure-info.ts. Subió de 200→500 cuando el DTO
    // permite reasons de hasta 2000 chars (Layer 3 verifier emite reasons
    // detallados que el operador necesita ver en el panel de revisión).
    const longReason = 'x'.repeat(800);
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'c1', label: 'C1', status: 'failed', reason: longReason },
        ],
      },
    ];
    const reason = extractFailureInfo(dod, null).criteria[0].reason;
    expect(reason).toHaveLength(501); // 500 + '…'
    expect(reason.endsWith('…')).toBe(true);
  });

  it('status malformado/desconocido se trata como failed', () => {
    const dod = [
      { attempt: 1, verdicts: [{ criterionId: 'c1', label: 'C1', status: 'weird' }] },
    ];
    expect(extractFailureInfo(dod, null).criteria[0].status).toBe('failed');
  });

  it('cae a criterionId cuando label falta, y a "unknown" cuando criterionId falta', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'no-errors', status: 'failed' },
          { status: 'failed' },
        ],
      },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    expect(criteria[0].label).toBe('no-errors');
    expect(criteria[1].id).toBe('unknown');
  });

  it('MERGE: ordena por attempt — un entry fuera de orden no rompe last-wins', () => {
    // Worker bug hipotético: entries NO ascendentes. El sort defensivo
    // garantiza que attempt 2 (passed) gane sobre attempt 1 (failed).
    const dod = [
      { attempt: 2, verdicts: [{ criterionId: 'tests', label: 'Tests', status: 'passed' }] },
      { attempt: 1, verdicts: [{ criterionId: 'tests', label: 'Tests', status: 'failed', reason: 'viejo' }] },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].status).toBe('passed');
  });

  it('MERGE: un criterio que aparece por primera vez en attempt 2 va al final', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'a', label: 'A', status: 'passed' },
          { criterionId: 'b', label: 'B', status: 'passed' },
        ],
      },
      {
        attempt: 2,
        verdicts: [
          { criterionId: 'b', label: 'B', status: 'failed', reason: 'x' },
          { criterionId: 'c', label: 'C', status: 'failed', reason: 'nuevo criterio' },
        ],
      },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    expect(criteria.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('verdicts con criterionId ausente colapsan a "unknown" (dedup conocido)', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { label: 'Sin id 1', status: 'failed', reason: 'primero' },
          { label: 'Sin id 2', status: 'failed', reason: 'segundo' },
        ],
      },
    ];
    const { criteria } = extractFailureInfo(dod, null);
    // Ambos colapsan a id='unknown' — last-wins deja solo el segundo.
    expect(criteria).toHaveLength(1);
    expect(criteria[0].id).toBe('unknown');
    expect(criteria[0].reason).toBe('segundo');
  });

  it('colapsa saltos de línea del reason a espacios (markdown copiable)', () => {
    const dod = [
      {
        attempt: 1,
        verdicts: [
          { criterionId: 'c1', label: 'C1', status: 'failed', reason: 'línea 1\nlínea 2\n  línea 3' },
        ],
      },
    ];
    expect(extractFailureInfo(dod, null).criteria[0].reason).toBe(
      'línea 1 línea 2 línea 3',
    );
  });

  it('escenario realista: doom loop regression, checklist con 1 passed + 2 failed', () => {
    const dod = [
      { attempt: 1, verdicts: [{ criterionId: 'code-written', label: 'Código', status: 'passed' }] },
      {
        attempt: 3,
        verdicts: [
          { criterionId: 'code-written', label: 'Código escrito', status: 'passed' },
          { criterionId: 'tests', label: 'Tests pasan', status: 'failed', reason: '5 rotos' },
          { criterionId: 'acceptance', label: 'Aceptación', status: 'failed', reason: 'no persiste' },
        ],
      },
    ];
    const result = extractFailureInfo(
      dod,
      'Doom loop detectado en attempt 3 — REGRESIÓN: ...',
    );
    expect(result.attempts).toBe(2);
    expect(result.doomLoopKind).toBe('regression');
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria.filter((c) => c.status === 'passed')).toHaveLength(1);
    expect(result.criteria.filter((c) => c.status === 'failed')).toHaveLength(2);
  });
});
