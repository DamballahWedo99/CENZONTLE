import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Pre-flight determinístico para validar que un caso de prueba del QA
 * markdown está cubierto en el repo ANTES de invocar el verifier Sonnet.
 *
 * Filosofía harness-engineering: el agente generator NO debe poder
 * "ahorrar tests" enmascarando ausencias. Cada caso enumerado en
 * `## Happy path` / `## Edge cases` del QA markdown debe tener un test
 * concreto en archivos `*.test.*` / `*.spec.*` / `*_test.{go,py}` con:
 *   1. Presencia: grep encuentra el archivo + keywords del caso.
 *   2. No-skip: el test no tiene `.skip()`, `.todo()`, `xit()`, `xdescribe()`.
 *   3. No-trivial: el test tiene assertions REALES, no `expect(true)` ni
 *      stubs vacíos.
 *
 * Si cualquier verificación falla → return `ok=false` con reason específico.
 * El caller emite verdict failed SIN invocar Sonnet (ahorra tokens) y con
 * mensaje preciso al agente para el retry prompt.
 *
 * Si pasa → return `ok=true` con `candidatePaths` para que el verifier
 * Sonnet los use como hint y haga validación semántica (¿el test
 * efectivamente cubre el caso descrito, o solo menciona las keywords?).
 */

export interface PreflightResult {
  ok: boolean;
  /** Reason específico cuando ok=false. Se usa como `reason` del verdict
   *  failed y se inyecta al retry prompt para que el agente lo arregle. */
  reason: string | null;
  /** Cuando ok=true: archivos donde se encontró el test candidato. El
   *  verifier Sonnet los recibe como hint para enfocar su análisis. */
  candidatePaths: string[];
  /** Categoría del problema detectado, para telemetry/logging:
   *   - 'no-test-files': repo no tiene archivos de test.
   *   - 'not-found': ningún archivo menciona las keywords del caso.
   *   - 'skipped': encontró test pero está skipped/todo.
   *   - 'trivial': encontró test pero las assertions son triviales.
   *   - 'ok': pre-flight pasó. */
  category: 'no-test-files' | 'not-found' | 'skipped' | 'trivial' | 'ok';
}

/**
 * Patrones de archivo que típicamente contienen tests. Cubrimos las
 * convenciones más comunes:
 *  - JS/TS: `*.test.{ts,tsx,js,jsx,mjs,cjs}`, `*.spec.*`, `__tests__/*`
 *  - Python: `test_*.py`, `*_test.py`, `tests/*.py`
 *  - Go: `*_test.go`
 *  - Rust: `tests/*.rs`, tests inline en archivos con `#[test]`
 *  - Java/Kotlin: `*Test.{java,kt}`, `*Spec.{java,kt}`
 */
const TEST_FILE_PATTERNS = [
  '*.test.ts',
  '*.test.tsx',
  '*.test.js',
  '*.test.jsx',
  '*.test.mjs',
  '*.test.cjs',
  '*.spec.ts',
  '*.spec.tsx',
  '*.spec.js',
  '*.spec.jsx',
  '*.spec.mjs',
  '*_test.go',
  '*_test.py',
  'test_*.py',
  '*Test.java',
  '*Test.kt',
  '*Spec.kt',
];

/**
 * Tokens de "tests pendientes / saltados" que indican que el agente NO
 * implementó realmente el caso. Si el archivo candidato contiene alguno
 * cerca de las keywords del caso, marcamos como `skipped`.
 *
 * El check es deliberadamente generoso (no exige proximity exacta a las
 * keywords) — preferimos falso positivo (fail-loud) sobre falso negativo
 * (test que aparenta cubrir pero no se ejecuta).
 */
const SKIP_PATTERNS = [
  /\b(?:it|test|describe)\.skip\s*\(/,
  /\b(?:it|test|describe)\.todo\s*\(/,
  /\bxit\s*\(/,
  /\bxdescribe\s*\(/,
  /\bxtest\s*\(/,
  // Python pytest
  /@pytest\.mark\.skip\b/,
  /@pytest\.mark\.skipif\b/,
  /\bpytest\.skip\s*\(/,
  // Go testing
  /\bt\.Skip\s*\(/,
  /\bt\.Skipf\s*\(/,
  // Java JUnit
  /@(?:Disabled|Ignore)\b/,
];

/**
 * Patterns que indican assertions triviales — el test "pasa" pero no
 * valida nada útil. Estos son los anti-patterns clásicos del agente que
 * quiere ahorrar tokens haciendo un test que aparente cubrir el caso
 * sin realmente testear el comportamiento.
 */
const TRIVIAL_PATTERNS = [
  /\bexpect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)/,
  /\bexpect\s*\(\s*true\s*\)\s*\.toEqual\s*\(\s*true\s*\)/,
  /\bexpect\s*\(\s*1\s*\)\s*\.toBe\s*\(\s*1\s*\)/,
  /\bexpect\s*\(\s*['"]\s*['"]\s*\)\s*\.toBe\s*\(/,
  // Python
  /\bassert\s+True\s*$/m,
  /\bassert\s+1\s*==\s*1\b/,
  // Go
  /assert\.True\s*\(\s*t\s*,\s*true\s*\)/,
  /assert\.Equal\s*\(\s*t\s*,\s*1\s*,\s*1\s*\)/,
];

/**
 * Extrae keywords searcheables del description de un test case. Toma
 * palabras significativas (>3 chars, no stopwords) y las normaliza para
 * un grep case-insensitive. Cap a 6 keywords — más se vuelve ruidoso.
 *
 * Ejemplo: "Password vacío → retorna 400 missing password"
 *  → ['password', 'vacío', '400', 'missing']
 */
export function extractSearchKeywords(description: string): string[] {
  const STOPWORDS = new Set([
    'cuando', 'debe', 'debería', 'que', 'con', 'sin', 'para', 'por',
    'when', 'should', 'must', 'with', 'without', 'and', 'the', 'this',
    'that', 'each', 'every', 'returns', 'returns', 'response',
    // Símbolos comunes
    '→', '✓', '✗', '-',
  ]);
  const tokens = description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip acentos para grep
    .replace(/[^\w\sÀ-ſ]/g, ' ') // strip puntuación
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  // Dedupe preservando orden + cap a 6
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Busca archivos de test en el workdir usando `find` (más portable que
 * `rg`, que puede no estar instalado en todos los workers). Limitamos
 * el resultado a 200 archivos — repos más grandes que eso típicamente
 * tienen mono-repo structure y necesitarían filtros adicionales.
 */
async function findTestFiles(workdir: string): Promise<string[]> {
  try {
    // -name patterns con OR. Excluimos node_modules para evitar ruido masivo.
    const args = [
      workdir,
      '-type',
      'f',
      '(',
      ...TEST_FILE_PATTERNS.flatMap((p, i) =>
        i === 0 ? ['-name', p] : ['-o', '-name', p],
      ),
      ')',
      '-not',
      '-path',
      '*/node_modules/*',
      '-not',
      '-path',
      '*/.git/*',
      '-not',
      '-path',
      '*/dist/*',
      '-not',
      '-path',
      '*/build/*',
    ];
    const { stdout } = await execFileAsync('find', args, {
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
    });
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 200);
  } catch (err) {
    logger.warn(
      { event: 'qa.preflight.find_failed', err: (err as Error).message },
      'find subprocess failed enumerating test files',
    );
    return [];
  }
}

/**
 * Verifica si el contenido del archivo menciona TODAS las keywords del
 * caso (case-insensitive). Requerimos TODAS (AND, no OR) porque un test
 * que solo menciona "password" en un repo de auth podría ser cualquier
 * test — necesitamos que también mencione "vacío" o "400" para tener
 * confianza razonable de que es ESE test específico.
 *
 * Si las keywords son <2 (description muy genérico), relajamos a "alguna
 * keyword presente" para no descartar tests legítimos.
 */
function fileMentionsCase(content: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const normalized = content.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (keywords.length === 1) {
    return normalized.includes(keywords[0]);
  }
  // ≥2 keywords: requerimos al menos 2 hits (AND parcial) — más estricto que OR
  // pero menos rígido que requerir todas (defiende contra synonym shifts).
  let hits = 0;
  for (const k of keywords) {
    if (normalized.includes(k)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

/**
 * Detecta si el contenido del archivo contiene patrones de skip/todo
 * cerca de las keywords del caso. Si las keywords aparecen en un test
 * marcado .skip/.todo → el agente lo dejó sin implementar.
 *
 * Implementación: buscamos `.skip/.todo/xit/etc` en TODO el archivo. Si
 * existe en el archivo de test candidato, alguna línea del archivo tiene
 * un test desactivado. Conservador: preferimos falso positivo sobre
 * falso negativo, así que cualquier skip en el archivo dispara warning.
 */
function detectSkipPatterns(content: string): string[] {
  const found: string[] = [];
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(content)) {
      found.push(pattern.source);
    }
  }
  return found;
}

/**
 * Detecta patrones de assertions triviales (harness engineering del agente).
 * Cualquier match indica que hay AL MENOS un test trivial en el archivo —
 * no necesariamente el que cubre nuestro caso, pero levanta sospecha
 * suficiente para fallar el pre-flight y dejar que el Sonnet judge confirme.
 */
function detectTrivialAssertions(content: string): string[] {
  const found: string[] = [];
  for (const pattern of TRIVIAL_PATTERNS) {
    if (pattern.test(content)) {
      found.push(pattern.source);
    }
  }
  return found;
}

/**
 * Pre-flight check completo para UN test case. Retorna verdict
 * determinístico — sin invocar LLM. Llama al Sonnet judge SOLO cuando
 * este pre-flight pasa, lo que minimiza el uso de tokens.
 */
export async function preflightTestCase(
  workdir: string,
  testCase: { category: 'happy' | 'edge'; description: string },
): Promise<PreflightResult> {
  const keywords = extractSearchKeywords(testCase.description);
  logger.debug(
    {
      event: 'qa.preflight.start',
      category: testCase.category,
      description: testCase.description.slice(0, 80),
      keywords,
    },
    `qa.preflight: starting check for [${testCase.category}] ${testCase.description.slice(0, 60)}`,
  );

  // 1. ¿Hay archivos de test?
  const testFiles = await findTestFiles(workdir);
  if (testFiles.length === 0) {
    // NO fallar determinísticamente. Algunas stories son sobre documentación
    // (.md files, configs) — su QA test case describe comportamiento del
    // documento, no código. El LLM debe leer y decidir, no el preflight.
    // El hint le dice al verifier que no había code tests, así puede juzgar
    // si eso es problema (story de código) o expected (story de docs).
    logger.info(
      {
        event: 'qa.preflight.escalate_no_tests',
        category: testCase.category,
        description: testCase.description.slice(0, 80),
      },
      `qa.preflight: no test files in repo → escalating to LLM (story may be documentation-only)`,
    );
    return {
      ok: true,
      reason: null,
      candidatePaths: [],
      category: 'no-test-files',
    };
  }

  // 2. ¿Algún archivo menciona las keywords del caso?
  const matches: string[] = [];
  for (const file of testFiles) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue; // archivo borrado/permisos, skip silencioso
    }
    if (fileMentionsCase(content, keywords)) {
      matches.push(file);
    }
  }

  if (matches.length === 0) {
    // NO fallar determinísticamente. Hay test files pero ninguno menciona
    // las keywords del caso. Puede ser legítimo (story de docs, keywords
    // del description son behavior-talk no code-talk) o ilegítimo (agente
    // olvidó test). El LLM con `candidatePaths` vacío decide leyendo
    // contexto, no el preflight con un grep crudo.
    logger.info(
      {
        event: 'qa.preflight.escalate_no_match',
        category: testCase.category,
        keywords: keywords.join(','),
        testFilesCount: testFiles.length,
        description: testCase.description.slice(0, 80),
      },
      `qa.preflight: no test file matched keywords → escalating to LLM (may be docs story or keyword mismatch)`,
    );
    return {
      ok: true,
      reason: null,
      candidatePaths: [],
      category: 'not-found',
    };
  }

  // 3. Anti harness-engineering: detectar skip/todo + assertions triviales.
  const skipIssues: string[] = [];
  const trivialIssues: string[] = [];
  for (const file of matches) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const skips = detectSkipPatterns(content);
    if (skips.length > 0) skipIssues.push(`${file.replace(workdir, '')}: ${skips.join(', ')}`);
    const trivials = detectTrivialAssertions(content);
    if (trivials.length > 0) trivialIssues.push(`${file.replace(workdir, '')}: ${trivials.length} trivial assertion(s)`);
  }

  if (skipIssues.length > 0) {
    return {
      ok: false,
      reason:
        `Tests del caso "${testCase.description}" están marcados como SKIPPED/TODO/disabled. ` +
        `Detalles: ${skipIssues.join('; ')}. ` +
        `Tests skipped no se ejecutan — el agente debe implementarlos o quitarlos del .skip/.todo.`,
      candidatePaths: matches,
      category: 'skipped',
    };
  }

  if (trivialIssues.length > 0) {
    return {
      ok: false,
      reason:
        `Detectadas assertions triviales (e.g. \`expect(true).toBe(true)\`, \`assert True\`) en los archivos candidatos. ` +
        `Detalles: ${trivialIssues.join('; ')}. ` +
        `Estas no validan comportamiento real — el agente debe escribir assertions concretas sobre el output esperado.`,
      candidatePaths: matches,
      category: 'trivial',
    };
  }

  // 4. Pre-flight pasó — pasamos a Sonnet con los archivos candidatos como hint.
  // Downgrade a debug — pasa para cada test case (5-10 por story). Saturaría
  // logs en runs normales. Mismo razonamiento que `tl.preflight.posix_newline.passed`.
  // El `escalate_no_*` (info) sí queda porque indica decisión excepcional.
  logger.debug(
    {
      event: 'qa.preflight.passed',
      category: testCase.category,
      candidateCount: matches.length,
      description: testCase.description.slice(0, 80),
    },
    `qa.preflight: passed (${matches.length} candidate file(s)) → escalando a Sonnet semantic check`,
  );

  return {
    ok: true,
    reason: null,
    candidatePaths: matches,
    category: 'ok',
  };
}
