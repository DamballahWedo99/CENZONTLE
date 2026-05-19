import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Detecta si un requirement técnico del TL pide validar el "trailing newline"
 * POSIX al final de un archivo. Cubre las variantes más comunes en español/
 * inglés que aparecen en los markdowns técnicos del story-gen:
 *
 *   - "Línea final con newline `\n` (estándar POSIX)"
 *   - "El archivo debe terminar con newline final POSIX"
 *   - "Trailing newline obligatorio según POSIX"
 *
 * Si matchea, el flow del preflight skipea Sonnet y hace un check determinístico
 * (`tail -c1`). Si NO matchea, sigue el flow normal de extracción de identifiers
 * + grep.
 */
function isPosixNewlineRequirement(description: string): boolean {
  return /newline.*final|trailing\s+newline|línea\s+final.*\\n|POSIX|estándar\s+POSIX/i.test(description);
}

/**
 * Extrae nombres de archivo concretos mencionados en el description del TL.
 * Combina dos regex:
 *   - Backtick-quoted: `info-card.html` → info-card.html
 *   - Loose con extension conocida: "el archivo `info-card.html` debe..."
 * Restringido a extensions comunes para evitar matches espurios (versiones,
 * URLs, etc.). Solo se usa en el path POSIX newline — el flow general usa
 * `extractTlIdentifiers` que cubre más casos.
 */
function extractCandidateFileNames(description: string): string[] {
  const found = new Set<string>();
  const COMMON_EXTENSIONS = '(?:md|mdx|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|go|rs|java|kt|cs|swift|html|css|scss|xml|sh|bash|conf|cfg|ini|env|lock)';
  // Backtick-quoted file names (más confiables — el TL los marca explícitamente)
  const backtickRe = new RegExp(`\`([a-zA-Z][\\w-]*\\.${COMMON_EXTENSIONS})\``, 'g');
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(description)) !== null) {
    found.add(m[1]);
  }
  // Loose file names (fallback cuando el TL no los marcó con backticks)
  const looseRe = new RegExp(`\\b([a-zA-Z][\\w-]*\\.${COMMON_EXTENSIONS})\\b`, 'g');
  while ((m = looseRe.exec(description)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

/**
 * Verifica si un archivo termina con trailing newline POSIX (último byte = 0x0A).
 * Determinístico, costo ~0 (1 syscall). Reemplaza al verifier Sonnet para esta
 * verificación específica — ahorro de ~$0.20-0.30 por verificación.
 *
 * Returns:
 *   - { exists: false } si el archivo no existe en el workdir
 *   - { exists: true, hasNewline: bool } si existe
 *
 * Edge cases manejados:
 *   - Archivo vacío (0 bytes): `tail -c1` retorna string vacío, hasNewline=false.
 *     Es el comportamiento correcto: un archivo vacío NO cumple "termina con \n".
 *   - Archivo binario: igualmente válido — POSIX newline aplica a cualquier byte.
 *   - Timeout/error: returns { exists: false } (fall-through al flow normal).
 */
async function checkPosixTrailingNewline(
  workdir: string,
  filename: string,
): Promise<{ exists: boolean; hasNewline?: boolean }> {
  const fullPath = join(workdir, filename);
  try {
    const { stdout } = await execFileAsync('tail', ['-c1', fullPath], {
      maxBuffer: 1024,
      timeout: 5_000,
    });
    return { exists: true, hasNewline: stdout === '\n' };
  } catch (err) {
    // tail falla con exit ≠ 0 cuando el archivo no existe — esperado.
    const msg = (err as Error).message;
    if (msg.includes('No such file') || msg.includes('cannot open')) {
      return { exists: false };
    }
    // Otros errores (timeout, permission, etc.) → fall-through al flow normal.
    logger.warn(
      { event: 'tl.preflight.posix_check_failed', filename, err: msg },
      `tl.preflight POSIX check on '${filename}' failed: ${msg}. Fall-through to Sonnet check.`,
    );
    return { exists: false };
  }
}

/**
 * Pre-flight determinístico para validar que un requerimiento técnico del
 * TL markdown está IMPLEMENTADO en el repo ANTES de invocar el verifier
 * Sonnet/Haiku. Análogo a `qa-preflight.ts` pero para TL items.
 *
 * Filosofía harness-engineering aplicada al TL: si el TL dice "implementar
 * endpoint POST /api/auth/login" o "agregar interface LoginDto", el código
 * DEBE contener una referencia detectable a esos identifiers. Si no, el
 * agente improvisó otra arquitectura (o se saltó el item).
 *
 * Estrategias de detección por categoría:
 *   - 'checklist': busca KEYWORDS del item en el repo (similar al QA).
 *   - 'contract': si menciona endpoints (`POST /...`), funciones, tipos,
 *      busca esos identifiers específicos.
 *   - 'validation': busca patrones de validación (regex, schema, etc.).
 *   - 'errors': busca codigos de error (`400`, `404`, `throw new ...`).
 *
 * Si NO hay keywords detectables (item descrito como prosa narrativa
 * abstracta), pre-flight escala a Sonnet sin fail-loud — el LLM judge
 * decide. Esto es diferente del QA que SÍ exige test files concretos.
 *
 * Returns:
 *   - ok=true si encontró evidencia → Sonnet hace semantic check con hint.
 *   - ok=false (con reason específico) si:
 *     - El item menciona identifiers concretos que NO aparecen en el repo.
 *     - El item menciona archivos que NO existen.
 */

export interface TlPreflightResult {
  ok: boolean;
  reason: string | null;
  candidatePaths: string[];
  /** Identifiers/keywords que se buscaron y SÍ se encontraron — útil para
   *  el debug y para pasar al verifier Sonnet como hint. */
  matchedIdentifiers: string[];
  category:
    | 'no-source-files'
    | 'identifiers-missing'
    | 'files-missing'
    | 'ok'
    | 'abstract'; // 'abstract' = item sin identifiers concretos, escala a Sonnet
}

/**
 * Patrones de archivos source típicos por stack. Excluimos tests + build
 * outputs — el TL describe código de producción, no tests.
 */
const SOURCE_FILE_PATTERNS = [
  // TypeScript / JavaScript
  '*.ts',
  '*.tsx',
  '*.js',
  '*.jsx',
  '*.mjs',
  '*.cjs',
  // Python
  '*.py',
  // Go
  '*.go',
  // Rust
  '*.rs',
  // Java / Kotlin
  '*.java',
  '*.kt',
  // C# / .NET
  '*.cs',
  // Swift
  '*.swift',
];

/**
 * Patrones de exclusión: directorios que NO son código de producción.
 */
const EXCLUDE_PATHS = [
  '*/node_modules/*',
  '*/.git/*',
  '*/dist/*',
  '*/build/*',
  '*/target/*',
  '*/.next/*',
  '*/__pycache__/*',
  '*/coverage/*',
];

/**
 * Extrae identifiers buscables del description de un requerimiento técnico.
 * Detecta:
 *   - Endpoints HTTP: `POST /api/auth/login` → `auth/login` o `auth.login`.
 *   - Paths de archivo: `auth/service.ts` → tal cual.
 *   - Identificadores camelCase/PascalCase: `LoginDto`, `validateEmail` → tal cual.
 *   - Funciones: `function foo()` → `foo`.
 *   - Tipos: `interface Bar` o `type Bar` → `Bar`.
 *
 * Si no detecta NINGÚN identifier concreto, devuelve [] → el caller usa el
 * fallback `abstract` (sin fail-loud, escala a Sonnet).
 */
export function extractTlIdentifiers(description: string): string[] {
  const identifiers = new Set<string>();

  // 1. Endpoints HTTP: POST /api/auth/login → auth/login
  const endpointRe = /\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/[\w/-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = endpointRe.exec(description)) !== null) {
    const path = m[1].replace(/^\//, ''); // strip leading /
    if (path) identifiers.add(path);
  }

  // 2. Paths de archivo: src/auth/service.ts, auth/service.py
  const filePathRe = /\b([\w-]+\/[\w/-]+\.\w+)\b/g;
  while ((m = filePathRe.exec(description)) !== null) {
    identifiers.add(m[1]);
  }

  // 3. PascalCase identifiers (typically: classes, interfaces, types, components).
  //    Require ≥2 uppercase transitions to avoid matching common English words
  //    like "Implementar" or "Validar".
  const pascalRe = /\b([A-Z][a-z]+(?:[A-Z][a-z0-9]+)+)\b/g;
  while ((m = pascalRe.exec(description)) !== null) {
    // Filter common words that look like PascalCase but aren't identifiers.
    const word = m[1];
    if (!COMMON_SPANISH_PASCAL.has(word.toLowerCase())) {
      identifiers.add(word);
    }
  }

  // 4. camelCase identifiers (functions, vars): validateEmail, fetchUser
  const camelRe = /\b([a-z][a-z0-9]+[A-Z][a-zA-Z0-9]+)\b/g;
  while ((m = camelRe.exec(description)) !== null) {
    identifiers.add(m[1]);
  }

  // 5. snake_case identifiers (Python, Rust)
  const snakeRe = /\b([a-z][a-z0-9]+_[a-z][a-z0-9_]+)\b/g;
  while ((m = snakeRe.exec(description)) !== null) {
    identifiers.add(m[1]);
  }

  // 6. Backtick-quoted code: \`foo()\`, \`SomeType\`, \`[SETUP.md](./SETUP.md)\`
  const backtickRe = /`([^`\s][^`]*[^`\s]|\S)`/g;
  while ((m = backtickRe.exec(description)) !== null) {
    const code = m[1].trim();
    // Toma solo si parece un identifier (sin espacios, no muy largo).
    if (code.length < 100 && !code.includes(' ')) {
      identifiers.add(code.replace(/[()]/g, '')); // strip parens
    }
    // ADEMÁS extraer file names DENTRO del backtick. Cubre casos donde el
    // contenido del backtick es un markdown link, code block con paths, o
    // cualquier expresión que mencione archivos por nombre. Ejemplos:
    //   \`[SETUP.md](./SETUP.md)\` → SETUP.md (válido, matcheable en grep)
    //   \`npm test\` → no matches (no extension), no agrega nada
    //   \`package.json\` → package.json (igual al code raw, dedupea via Set)
    //   \`config/app.yaml\` → app.yaml
    // doom loop 2026-05-15 (epic 7708d15b PR README.md): sin esto, items con
    // markdown link en backtick generaban identifiers como
    // \`[SETUP.md]./SETUP.md\` (basura post-strip parens) que jamás matcheaba
    // en grep → identifiers-missing → fail → retry idéntico → doom loop.
    const fileNameRe = /\b([a-zA-Z][\w-]*\.[a-zA-Z][\w]{0,7})\b/g;
    let fm: RegExpExecArray | null;
    while ((fm = fileNameRe.exec(code)) !== null) {
      identifiers.add(fm[1]);
    }
  }

  // 7. File names sueltos en el description (fuera de backticks). Cubre
  // items que mencionan archivos sin backtick-quote (ej. "el README.md
  // debe tener..."). Limitado a extensions conocidas para evitar matches
  // espurios como "v2.0" o "node.18".
  const looseFileNameRe = /\b([a-zA-Z][\w-]*\.(?:md|mdx|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|go|rs|java|kt|cs|swift|html|css|scss|xml))\b/g;
  while ((m = looseFileNameRe.exec(description)) !== null) {
    identifiers.add(m[1]);
  }

  return Array.from(identifiers);
}

// Palabras en español/inglés que matchean PascalCase pero NO son identifiers
// de código. Si el TL escribe "Implementar Validaciones", no queremos buscar
// "Implementar" o "Validaciones" como identifiers.
const COMMON_SPANISH_PASCAL = new Set([
  'implementar', 'validar', 'crear', 'modificar', 'agregar', 'eliminar',
  'actualizar', 'configurar', 'integrar', 'verificar', 'manejar',
  'should', 'must', 'shall', 'will', 'when', 'where',
]);

/**
 * Busca archivos source en el workdir excluyendo tests/build outputs.
 * Cap a 500 archivos.
 */
async function findSourceFiles(workdir: string): Promise<string[]> {
  try {
    const args: string[] = [
      workdir,
      '-type',
      'f',
      '(',
      ...SOURCE_FILE_PATTERNS.flatMap((p, i) =>
        i === 0 ? ['-name', p] : ['-o', '-name', p],
      ),
      ')',
      // Excluir tests (no son producción)
      '-not',
      '-name',
      '*.test.*',
      '-not',
      '-name',
      '*.spec.*',
      '-not',
      '-name',
      '*_test.*',
      '-not',
      '-name',
      'test_*',
    ];
    for (const exclude of EXCLUDE_PATHS) {
      args.push('-not', '-path', exclude);
    }
    const { stdout } = await execFileAsync('find', args, {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    });
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 500);
  } catch (err) {
    logger.warn(
      { event: 'tl.preflight.find_failed', err: (err as Error).message },
      'find subprocess failed enumerating source files',
    );
    return [];
  }
}

/**
 * Busca con grep si un identifier aparece en algún archivo source.
 * Returns paths donde matchea (cap a 5 por identifier).
 */
async function grepIdentifier(workdir: string, identifier: string): Promise<string[]> {
  try {
    // Escape regex metacaracters en el identifier.
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Incluimos archivos source code + docs + config:
    //   - Source (ts/tsx/js/py/go/etc.): production code donde típicamente
    //     viven los identifiers del TL (endpoints, tipos, funciones).
    //   - Docs (md/mdx): TL items legítimos pueden hablar del contenido de
    //     README, docs/, instrucciones markdown (ej. "usar sintaxis
    //     `[SETUP.md](./SETUP.md)`" debe matchear el contenido del README).
    //     Sin .md en el grep, items sobre documentación caían a
    //     `identifiers-missing` aunque el contenido SÍ estuviera implementado
    //     — false negative determinístico (qa-reviewer 2026-05-15, doom loop
    //     en epic 817bddf3 PR README.md).
    //   - Config (json/yaml/yml/toml): TL items pueden referenciar
    //     package.json, tsconfig, GitHub workflows, etc.
    //
    // El Sonnet semantic check downstream protege contra false positives
    // por matches incidentales (e.g., menciones en comments) — el preflight
    // solo gating "no se encontró nada en ningún lado del repo".
    const args: string[] = [
      '-r',
      '-l',
      // Source code (production)
      '--include=*.ts',
      '--include=*.tsx',
      '--include=*.js',
      '--include=*.jsx',
      '--include=*.py',
      '--include=*.go',
      '--include=*.rs',
      '--include=*.java',
      '--include=*.kt',
      '--include=*.cs',
      '--include=*.swift',
      // Documentation (README, docs/, etc.)
      '--include=*.md',
      '--include=*.mdx',
      // Config / data files (package.json, tsconfig, CI/CD, etc.)
      '--include=*.json',
      '--include=*.yaml',
      '--include=*.yml',
      '--include=*.toml',
      '--exclude-dir=node_modules',
      '--exclude-dir=.git',
      '--exclude-dir=dist',
      '--exclude-dir=build',
      '--exclude-dir=target',
      escaped,
      workdir,
    ];
    const { stdout } = await execFileAsync('grep', args, {
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
    });
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 5);
  } catch {
    // grep returna exit 1 cuando no hay matches — no es error real.
    return [];
  }
}

/**
 * Pre-flight check para UN technical requirement.
 */
export async function preflightTechnicalRequirement(
  workdir: string,
  requirement: {
    category: 'checklist' | 'contract' | 'validation' | 'errors';
    description: string;
  },
): Promise<TlPreflightResult> {
  // ════════════════════════════════════════════════════════════════════
  // Early-exit POSIX newline check (2026-05-18)
  // ════════════════════════════════════════════════════════════════════
  // Doom loop frecuente del coder: "Línea final con newline POSIX". Sonnet
  // semantic check no resuelve porque el coder no recibe el comando exacto.
  // Acá hacemos chequeo determinístico (`tail -c1`) y en el reason del fail
  // incluimos el comando `printf "\\n" >> file` para que el retry-prompt lo
  // muestre literal al coder. Ahorro: ~$0.20-0.30 por verificación + rompe
  // el doom loop en attempt 2 (vs estancarse 3 attempts).
  if (isPosixNewlineRequirement(requirement.description)) {
    const candidateFiles = extractCandidateFileNames(requirement.description);
    if (candidateFiles.length > 0) {
      const missingNewline: string[] = [];
      const verified: string[] = [];
      for (const file of candidateFiles) {
        const check = await checkPosixTrailingNewline(workdir, file);
        if (!check.exists) continue; // archivo no existe — otro item lo cubre o aún no creado
        if (check.hasNewline) {
          verified.push(file);
        } else {
          missingNewline.push(file);
        }
      }
      if (missingNewline.length > 0) {
        const fixCommands = missingNewline.map((f) => `printf "\\n" >> ${f}`).join(' && ');
        logger.info(
          {
            event: 'tl.preflight.posix_newline.failed',
            files: missingNewline,
            fixCommands,
          },
          `tl.preflight POSIX: ${missingNewline.length} archivo(s) sin trailing newline — fail determinístico (skip Sonnet)`,
        );
        return {
          ok: false,
          reason:
            `Falta trailing newline POSIX en: ${missingNewline.map((f) => `\`${f}\``).join(', ')}. ` +
            `Arreglar con: \`${fixCommands}\`. ` +
            `Verificable con: \`tail -c1 ${missingNewline[0]} | xxd\` (debe terminar en 0a = \\n).`,
          candidatePaths: missingNewline,
          matchedIdentifiers: missingNewline,
          category: 'identifiers-missing',
        };
      }
      if (verified.length > 0) {
        // Downgrade a debug — pasa en cada story con criterio POSIX cuando el
        // coder ya hizo bien el newline. Saturaría logs en runs normales.
        // El FAILED sí queda en info porque indica acción del coder pendiente.
        logger.debug(
          {
            event: 'tl.preflight.posix_newline.passed',
            files: verified,
          },
          `tl.preflight POSIX: ${verified.length} archivo(s) con trailing newline OK — pass determinístico (skip Sonnet, ahorro ~$0.25)`,
        );
        return {
          ok: true,
          reason: null,
          candidatePaths: verified,
          matchedIdentifiers: verified,
          category: 'ok',
        };
      }
      // candidateFiles tenía files pero ninguno existe en workdir — fall-through
      // al flow normal (escala a Sonnet, que decide si el item aplica a archivos
      // aún no creados por el coder en esta wave).
    }
    // Sin candidates extraíbles → fall-through al flow normal.
  }

  const identifiers = extractTlIdentifiers(requirement.description);

  logger.debug(
    {
      event: 'tl.preflight.start',
      category: requirement.category,
      description: requirement.description.slice(0, 80),
      identifiers,
    },
    `tl.preflight: starting check for [${requirement.category}] ${requirement.description.slice(0, 60)}`,
  );

  // 1. ¿Hay archivos source en el repo?
  const sourceFiles = await findSourceFiles(workdir);
  if (sourceFiles.length === 0) {
    return {
      ok: false,
      reason:
        `No se encontraron archivos source en el repo (buscado: ${SOURCE_FILE_PATTERNS.slice(0, 5).join(', ')}, etc.). ` +
        `El agente debe crear código de producción para cumplir el requerimiento técnico.`,
      candidatePaths: [],
      matchedIdentifiers: [],
      category: 'no-source-files',
    };
  }

  // 2. Si NO hay identifiers detectables, el item es prosa abstracta.
  //    Escalamos directo a Sonnet — sin fail-loud (el LLM judge decide).
  if (identifiers.length === 0) {
    logger.debug(
      { event: 'tl.preflight.abstract', category: requirement.category },
      'tl.preflight: item sin identifiers concretos — escala a Sonnet sin fail-loud',
    );
    return {
      ok: true,
      reason: null,
      candidatePaths: [],
      matchedIdentifiers: [],
      category: 'abstract',
    };
  }

  // 3. Por cada identifier, grep en archivos source.
  const allMatchedPaths = new Set<string>();
  const matchedIdentifiers: string[] = [];
  const missingIdentifiers: string[] = [];
  for (const id of identifiers) {
    const matches = await grepIdentifier(workdir, id);
    if (matches.length > 0) {
      matchedIdentifiers.push(id);
      for (const p of matches) allMatchedPaths.add(p);
    } else {
      missingIdentifiers.push(id);
    }
  }

  // 4. Si CERO identifiers matchearon → el item NO está implementado.
  if (matchedIdentifiers.length === 0) {
    return {
      ok: false,
      reason:
        `Ningún identifier de este requerimiento se encontró en el código del repo. ` +
        `Identifiers buscados: [${identifiers.join(', ')}]. ` +
        `El agente NO implementó "${requirement.description}" (o usó nombres completamente distintos a los del TL).`,
      candidatePaths: [],
      matchedIdentifiers: [],
      category: 'identifiers-missing',
    };
  }

  // 5. Algunos matchearon → pre-flight OK, escalamos a Sonnet con hints.
  logger.info(
    {
      event: 'tl.preflight.passed',
      category: requirement.category,
      matchedCount: matchedIdentifiers.length,
      totalCount: identifiers.length,
      candidateCount: allMatchedPaths.size,
      description: requirement.description.slice(0, 80),
    },
    `tl.preflight: passed (${matchedIdentifiers.length}/${identifiers.length} identifiers, ${allMatchedPaths.size} candidate file(s)) → escalando a Sonnet semantic check`,
  );

  return {
    ok: true,
    reason: missingIdentifiers.length > 0
      ? `Matched: ${matchedIdentifiers.join(', ')}. Missing (validación del LLM): ${missingIdentifiers.join(', ')}`
      : null,
    candidatePaths: Array.from(allMatchedPaths),
    matchedIdentifiers,
    category: 'ok',
  };
}
