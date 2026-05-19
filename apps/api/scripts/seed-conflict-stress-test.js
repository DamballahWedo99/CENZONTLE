/* eslint-disable @typescript-eslint/no-require-imports */
// Run with: node --env-file=apps/api/.env apps/api/scripts/seed-conflict-stress-test.js
//
// Seed adversarial diseñado para FORZAR conflicts reales en el sprint-batch
// branch y así ejercitar AMBAS capas del ConflictResolverService:
//
//   Capa A (deterministic): JSON deep-merge para package.json, line-union
//                            para .gitignore/.npmrc/.txt/.env.example.
//   Capa B (Sonnet judge):  semantic merge para .html/.ts/.py/.md/etc.
//
// ─────────────────────────────────────────────────────────────────────────
// DAG diseñado para conflict garantizado:
// ─────────────────────────────────────────────────────────────────────────
//
//   Wave 0 (4 stories paralelas, 2 pares conflictantes):
//
//   ┌─────────────────────────────────────────────┐
//   │  PAR A (Capa A target — JSON deep-merge):  │
//   │    A1: agregar `lodash` a package.json     │
//   │    A2: agregar `dayjs`  a package.json     │
//   │    → ambos mutan dependencies → conflict   │
//   │    → Capa A debe deep-merge → ambas deps   │
//   └─────────────────────────────────────────────┘
//
//   ┌─────────────────────────────────────────────┐
//   │  PAR B (Capa B target — Sonnet semantic):  │
//   │    B1: crear notes.html con notas técnicas │
//   │    B2: crear notes.html con notas legales  │
//   │    → ambos add/add mismo archivo .html     │
//   │    → Capa A returns supported:false        │
//   │    → escala a Capa B → Sonnet integra      │
//   └─────────────────────────────────────────────┘
//
//   Wave 1 (1 story verificadora con hard-deps a las 4 anteriores):
//
//     V: lee package.json y notes.html post-merge, valida que el
//        ConflictResolver hizo su trabajo, y commit un reporte
//        `conflict-test-report.md` con outcome PASS/FAIL detallado.
//
// ─────────────────────────────────────────────────────────────────────────
// Logs esperados durante el run (para grep en stdout de la API):
// ─────────────────────────────────────────────────────────────────────────
//
//   Cuando A2 (o A1, según cuál mergea primero) trate de mergear post-A1:
//     updateBranch.conflict                     ← isMergeConflict=true
//     forge.conflict_resolver.start
//     forge.conflict_resolver.detected          ← lista files: ['package.json']
//     forge.conflict_resolver.file_resolved     ← strategy='layer_a_json'
//     forge.conflict_resolver.completed         ← outcome='resolved'
//     merge.retry.success                       ← PR mergueado tras resolve
//
//   Cuando B2 (o B1) trate de mergear post-B1:
//     updateBranch.conflict
//     forge.conflict_resolver.start
//     forge.conflict_resolver.detected          ← files: ['notes.html']
//     forge.conflict_resolver.escalate_to_layer_b
//     forge.conflict_resolver.layer_b.invoke    ← Sonnet 4.6 call
//     forge.conflict_resolver.file_resolved     ← strategy='layer_b_sonnet'
//     forge.conflict_resolver.completed         ← outcome='resolved'
//     merge.retry.success
//
// Si NUNCA ves `forge.conflict_resolver.*` durante el run, algo no está
// wired correctamente (el resolver no se invoca aunque hay conflict real).
//
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Octokit } = require('@octokit/rest');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ───────────────────────────────────────────────────────────────────────────
// Vault path helpers (idénticos a seed-trivial-epic.js — replican
// apps/api/src/modules/proyectos/vault-paths.ts)
// ───────────────────────────────────────────────────────────────────────────

const VAULT_ROOT = 'iniciativas';

function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function slugifyWithId(name, id) {
  return `${slugify(name)}-${id.slice(-6)}`;
}

function storyPOPath(ini, epic, story) {
  return [
    VAULT_ROOT,
    slugifyWithId(ini.name, ini.id),
    'epics',
    slugifyWithId(epic.title, epic.id),
    'historias',
    slugifyWithId(story.title, story.id),
    'definicion-negocio.md',
  ].join('/');
}

function storyTechnicalPath(ini, epic, story) {
  return [
    VAULT_ROOT,
    slugifyWithId(ini.name, ini.id),
    'epics',
    slugifyWithId(epic.title, epic.id),
    'historias',
    slugifyWithId(story.title, story.id),
    'definicion-tecnica.md',
  ].join('/');
}

function storyQAPath(ini, epic, story) {
  return [
    VAULT_ROOT,
    slugifyWithId(ini.name, ini.id),
    'epics',
    slugifyWithId(epic.title, epic.id),
    'historias',
    slugifyWithId(story.title, story.id),
    'testing-strategy.md',
  ].join('/');
}

function storyFolderPath(ini, epic, story) {
  return [
    VAULT_ROOT,
    slugifyWithId(ini.name, ini.id),
    'epics',
    slugifyWithId(epic.title, epic.id),
    'historias',
    slugifyWithId(story.title, story.id),
  ].join('/');
}

// ───────────────────────────────────────────────────────────────────────────
// Vault writer (GitHub API via Octokit)
// ───────────────────────────────────────────────────────────────────────────

const VAULT_OWNER = process.env.VAULT_GITHUB_OWNER;
const VAULT_REPO = process.env.VAULT_GITHUB_REPO;
const VAULT_BRANCH = process.env.VAULT_GITHUB_BRANCH || 'main';
const VAULT_TOKEN = process.env.VAULT_GITHUB_TOKEN;

if (!VAULT_OWNER || !VAULT_REPO || !VAULT_TOKEN) {
  console.error('❌ Falta config del vault — verificar VAULT_GITHUB_OWNER/REPO/TOKEN en .env');
  process.exit(1);
}

const octokit = new Octokit({ auth: VAULT_TOKEN });

async function writeVaultFile(path, content, commitMessage) {
  let existingSha;
  try {
    const { data } = await octokit.repos.getContent({
      owner: VAULT_OWNER,
      repo: VAULT_REPO,
      path,
      ref: VAULT_BRANCH,
    });
    if (!Array.isArray(data) && data.type === 'file') {
      existingSha = data.sha;
    }
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  await octokit.repos.createOrUpdateFileContents({
    owner: VAULT_OWNER,
    repo: VAULT_REPO,
    path,
    message: commitMessage,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch: VAULT_BRANCH,
    ...(existingSha ? { sha: existingSha } : {}),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Story specs — DAG diseñado para forzar conflicts reales
//
// CRÍTICO: las acceptance criteria son MUY específicas para minimizar el
// riesgo de que dos agentes hagan modificaciones que se "esquiven" mutuamente.
// Necesitamos que los cambios COLISIONEN físicamente en el mismo archivo
// para que GitHub reporte isMergeConflict=true y se invoque el resolver.
// ───────────────────────────────────────────────────────────────────────────

const STORY_SPECS = [
  // ─────────────────────────────────────────────────────────────────────────
  // PAR A — Capa A target (JSON deep-merge)
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: 'A1',
    title: 'Agregar dependencia `lodash` a package.json',
    acceptanceCriteria: [
      '1. El archivo `package.json` del root contiene una entrada `"lodash": "^4.17.21"` dentro del objeto `dependencies`.',
      '2. NO se modifica ningún otro campo del package.json (ni name, ni scripts, ni devDependencies, ni version).',
      '3. NO se ejecuta `npm install` ni `pnpm add` (eso modificaría el lockfile y agregaría ruido al diff).',
      '4. El archivo se mantiene como JSON válido parseable (sin trailing commas, indentación de 2 espacios preservada).',
    ].join('\n'),
    technical: {
      checklist: [
        '- Leer `package.json` del root, parsearlo como JSON.',
        '- Agregar la clave `lodash` con valor `^4.17.21` al objeto `dependencies` (preservar el resto del objeto intacto).',
        '- Si `dependencies` no existe en el package.json, créalo como objeto vacío y luego agrega la entrada.',
        '- Re-serializar con indentación de 2 espacios (`JSON.stringify(obj, null, 2)`) + newline final POSIX.',
      ],
      contract: [
        '- El diff del PR debe afectar ÚNICAMENTE al archivo `package.json` (ningún lockfile ni otros archivos).',
        '- La indentación del archivo final debe seguir el estilo del package.json original (2 espacios).',
      ],
      validation: [
        '- Post-edit, `JSON.parse(fs.readFileSync("package.json"))` debe succeder sin lanzar SyntaxError.',
        '- El objeto parseado debe tener `.dependencies.lodash === "^4.17.21"`.',
      ],
      errors: [
        '- Si el package.json no es parseable como JSON ANTES de la edición, abort sin tocarlo (no commitear un fix parcial).',
        '- NO usar `npm install lodash` ni `pnpm add lodash` — esos comandos también modifican package-lock.json/pnpm-lock.yaml y rompen el setup del test.',
      ],
    },
    qa: {
      happyPath: [
        '- Post-run: `cat package.json | jq .dependencies.lodash` retorna `"^4.17.21"`.',
      ],
      edgeCases: [
        '- Si el package.json ya tenía OTROS deps en `dependencies`, esas deps DEBEN seguir presentes (no se sobreescribe el objeto entero).',
        '- El archivo final NO debe tener trailing commas (invalida el JSON).',
      ],
      mocks: '- No requiere mocks (filesystem directo).',
      tools: '- Validación: `jq .dependencies package.json` o `node -e "console.log(require(\'./package.json\').dependencies)"`.',
    },
    dependsOn: [],
  },

  {
    key: 'A2',
    title: 'Agregar dependencia `dayjs` a package.json',
    acceptanceCriteria: [
      '1. El archivo `package.json` del root contiene una entrada `"dayjs": "^1.11.10"` dentro del objeto `dependencies`.',
      '2. NO se modifica ningún otro campo del package.json (ni name, ni scripts, ni devDependencies, ni version).',
      '3. NO se ejecuta `npm install` ni `pnpm add` (eso modificaría el lockfile).',
      '4. El archivo se mantiene como JSON válido parseable (sin trailing commas, indentación de 2 espacios).',
    ].join('\n'),
    technical: {
      checklist: [
        '- Leer `package.json` del root, parsearlo como JSON.',
        '- Agregar la clave `dayjs` con valor `^1.11.10` al objeto `dependencies` (preservar el resto intacto).',
        '- Si `dependencies` no existe en el package.json, créalo como objeto vacío y luego agrega la entrada.',
        '- Re-serializar con indentación de 2 espacios + newline final POSIX.',
      ],
      contract: [
        '- El diff del PR debe afectar ÚNICAMENTE al archivo `package.json`.',
        '- La indentación del archivo final debe seguir el estilo del package.json original (2 espacios).',
      ],
      validation: [
        '- Post-edit, `JSON.parse(fs.readFileSync("package.json"))` debe succeder.',
        '- El objeto parseado debe tener `.dependencies.dayjs === "^1.11.10"`.',
      ],
      errors: [
        '- Si el package.json no es parseable ANTES, abort.',
        '- NO usar `npm install` ni `pnpm add`.',
      ],
    },
    qa: {
      happyPath: [
        '- Post-run: `cat package.json | jq .dependencies.dayjs` retorna `"^1.11.10"`.',
      ],
      edgeCases: [
        '- Otros deps preexistentes en `dependencies` deben seguir presentes.',
        '- Sin trailing commas.',
      ],
      mocks: '- No requiere mocks.',
      tools: '- `jq .dependencies package.json`.',
    },
    dependsOn: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PAR B — Capa B target (Sonnet semantic judge para HTML)
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: 'B1',
    title: 'Crear notes.html con sección de Notas Técnicas',
    acceptanceCriteria: [
      '1. Existe un archivo `notes.html` en el root del repo (creado por este PR — NO existía antes).',
      '2. Estructura HTML5 mínima válida: `<!DOCTYPE html>`, `<html lang="es">`, `<head>` con `<meta charset="UTF-8">` y `<title>`, `<body>`.',
      '3. Dentro del `<body>` hay UNA `<section>` con `<h2>Notas Técnicas</h2>` y UN `<p>` que describe el stack tecnológico del proyecto (debe mencionar al menos dos de: Next.js, React, TypeScript, Node, Tailwind).',
      '4. El archivo NO contiene otras `<section>` ni otros `<h2>` (UNA sola sección, UN solo heading nivel 2).',
    ].join('\n'),
    technical: {
      checklist: [
        '- Crear `notes.html` en el root del repo (no en subdirectorio).',
        '- HTML5 doctype + head con meta charset + title que mencione "Notas".',
        '- UNA `<section>` con `<h2>Notas Técnicas</h2>` y exactamente UN `<p>` describiendo el stack (mencionar 2+ tech del repo).',
        '- NO incluir links a hojas de estilo externas, NO scripts, NO imágenes — HTML auto-contenido mínimo.',
      ],
      contract: [
        '- El archivo debe terminar con newline final POSIX (`\\n`).',
        '- Encoding UTF-8 sin BOM.',
        '- El `<title>` debe contener literalmente la palabra "Notas".',
      ],
      validation: [
        '- Conteo exacto: EXACTAMENTE 1 `<section>`, 1 `<h2>`, 1 `<p>` en el body.',
      ],
      errors: [
        '- Si el body termina con más de 1 `<h2>` o más de 1 `<section>`, NO commitear (estructura incorrecta).',
      ],
    },
    qa: {
      happyPath: [
        '- `cat notes.html | grep -c "<h2>"` retorna `1`.',
        '- `grep "Notas Técnicas" notes.html` matchea.',
      ],
      edgeCases: [
        '- El doctype está en la primera línea no vacía.',
        '- Newline final POSIX.',
      ],
      mocks: '- No requiere mocks.',
      tools: '- Validación: parser HTML para confirmar exactamente 1 section + 1 h2.',
    },
    dependsOn: [],
  },

  {
    key: 'B2',
    title: 'Crear notes.html con sección de Notas Legales',
    acceptanceCriteria: [
      '1. Existe un archivo `notes.html` en el root del repo (creado por este PR — NO existía antes).',
      '2. Estructura HTML5 mínima válida: `<!DOCTYPE html>`, `<html lang="es">`, `<head>` con `<meta charset="UTF-8">` y `<title>`, `<body>`.',
      '3. Dentro del `<body>` hay UNA `<section>` con `<h2>Notas Legales</h2>` y UN `<p>` con un disclaimer corto sobre propiedad intelectual del proyecto (debe mencionar "copyright" o "propiedad intelectual" + año actual).',
      '4. El archivo NO contiene otras `<section>` ni otros `<h2>` (UNA sola sección, UN solo heading nivel 2).',
    ].join('\n'),
    technical: {
      checklist: [
        '- Crear `notes.html` en el root del repo.',
        '- HTML5 doctype + head con meta charset + title que mencione "Notas".',
        '- UNA `<section>` con `<h2>Notas Legales</h2>` y exactamente UN `<p>` con disclaimer (mencionar "copyright" o "propiedad intelectual" + año actual 2026).',
        '- NO incluir links a hojas de estilo, NO scripts, NO imágenes.',
      ],
      contract: [
        '- Newline final POSIX, UTF-8 sin BOM.',
        '- El `<title>` debe contener literalmente la palabra "Notas".',
      ],
      validation: [
        '- Conteo exacto: 1 `<section>`, 1 `<h2>`, 1 `<p>` en el body.',
      ],
      errors: [
        '- Si el body termina con múltiples secciones, NO commitear.',
      ],
    },
    qa: {
      happyPath: [
        '- `grep "Notas Legales" notes.html` matchea.',
        '- `grep -iE "copyright|propiedad intelectual" notes.html` matchea.',
      ],
      edgeCases: [
        '- Doctype en primera línea no vacía.',
        '- Newline final POSIX.',
      ],
      mocks: '- No requiere mocks.',
      tools: '- Parser HTML para confirmar 1 section + 1 h2.',
    },
    dependsOn: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 1 — Verifier story (hard-deps en todas las anteriores)
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: 'V',
    title: 'Verificar resultado del ConflictResolverService post-merge',
    acceptanceCriteria: [
      '1. Existe un archivo `conflict-test-report.md` en el root del repo (creado por este PR).',
      '2. El reporte contiene un encabezado `## Resultado: ✅ PASS` o `## Resultado: ❌ FAIL` según el outcome.',
      '3. El reporte verifica que `package.json` tiene AMBAS dependencias presentes: `lodash` Y `dayjs` en `dependencies` (lista cada una con ✓ o ✗).',
      '4. El reporte verifica que `notes.html` contiene AMBAS secciones integradas: un heading `<h2>Notas Técnicas</h2>` Y un heading `<h2>Notas Legales</h2>` (lista cada una con ✓ o ✗).',
      '5. Si CUALQUIER verificación falla, el resultado debe ser `❌ FAIL` y el reporte debe enumerar exactamente qué falta (e.g., "package.json.dependencies.lodash: NO PRESENTE").',
    ].join('\n'),
    technical: {
      checklist: [
        '- LEER `package.json` del root y parsear como JSON. Verificar `.dependencies.lodash` y `.dependencies.dayjs` están presentes.',
        '- LEER `notes.html` del root. Verificar que contiene literalmente los strings `<h2>Notas Técnicas</h2>` Y `<h2>Notas Legales</h2>`.',
        '- Generar `conflict-test-report.md` con secciones: `## Resultado`, `## Capa A (JSON deep-merge — package.json)`, `## Capa B (Sonnet semantic — notes.html)`, `## Diagnóstico`.',
        '- Si ambas verificaciones pasan: PASS. Si alguna falla: FAIL + enumerar exactamente qué falta.',
      ],
      contract: [
        '- El reporte debe ser markdown válido renderizable en GitHub.',
        '- Las checks deben usar emoji ✓ (PASS) o ✗ (FAIL) consistentemente.',
      ],
      validation: [
        '- El reporte refleja FIELMENTE el estado del repo: si lodash está, dice ✓; si no, dice ✗ — NO inventar resultados.',
      ],
      errors: [
        '- Si `package.json` no es parseable como JSON, FAIL + reportar el SyntaxError.',
        '- Si `notes.html` no existe en el root, FAIL + reportar archivo faltante.',
        '- NO modificar `package.json` ni `notes.html` durante la verificación — solo lectura.',
      ],
    },
    qa: {
      happyPath: [
        '- Post-run: `cat conflict-test-report.md` muestra `## Resultado: ✅ PASS` (asumiendo que el ConflictResolver funcionó correctamente).',
        '- El reporte enumera lodash ✓, dayjs ✓, Notas Técnicas ✓, Notas Legales ✓.',
      ],
      edgeCases: [
        '- Si el ConflictResolver FALLÓ (e.g., Capa B sobrescribió en vez de integrar), el reporte debe decir `❌ FAIL` y NO esconder eso. La auditabilidad del test depende de la honestidad del reporte.',
        '- Si UNA dep está pero la otra no, el reporte debe marcarlo (no PASS si solo lodash está sin dayjs).',
      ],
      mocks: '- No requiere mocks (lectura filesystem + escritura de reporte markdown).',
      tools: '- Validación: `jq` para package.json deps; `grep` para `<h2>` en notes.html.',
    },
    dependsOn: ['A1', 'A2', 'B1', 'B2'],
  },
];

function buildPOMarkdown(spec) {
  return [
    '## Antecedentes',
    '',
    `Esta historia es parte del seed adversarial "Conflict Stress Test" diseñado para forzar conflicts reales y validar el ConflictResolverService (Capa A + Capa B).`,
    spec.dependsOn.length === 0
      ? 'Pertenece a Wave 0 (sin dependencias). Se espera que entre en conflict cuando su PR par mergeé primero al sprint-batch.'
      : `Pertenece a Wave 1 — depende de: ${spec.dependsOn.join(', ')}. Solo se claim-eará tras el merge exitoso de todas las anteriores.`,
    '',
    '## Objetivo',
    '',
    `Cumplir los criterios de aceptación al pie de la letra. Las restricciones del technical contract (NO usar pnpm/npm, modificar SOLO los archivos especificados) son críticas para el test — desviarse las invalida.`,
    '',
    '## Historia de usuario',
    '',
    `Como operador del Forge, quiero que el agente genere "${spec.title}" siguiendo los criterios específicos, para que cuando los PRs paralelos de Wave 0 mergueon a sprint-batch se produzca un conflict real que el ConflictResolverService deba resolver.`,
    '',
    '## Criterios de aceptación',
    '',
    spec.acceptanceCriteria,
    '',
    '## Notas adicionales',
    '',
    '- Generada por `scripts/seed-conflict-stress-test.js` para validar el ConflictResolverService end-to-end.',
    '- Los criterios son verificables por inspección de archivos (sin tooling complejo).',
    '- El verifier Sonnet debe enumerar cada criterio con ✓/✗ en su reason final.',
  ].join('\n');
}

function buildTechnicalMarkdown(spec) {
  return [
    '## Arquitectura y componentes',
    '',
    `Operación de filesystem directa con manejo de errores explícito. Las restricciones sobre cómo modificar los archivos (e.g., NO usar npm/pnpm para package.json) son centrales — desviarse rompe el setup del conflict test.`,
    '',
    '## Flujo de integración',
    '',
    `1. Leer estado actual del repo (archivos relevantes para esta story).`,
    `2. Aplicar la transformación descrita en el checklist (mínima, quirúrgica).`,
    `3. Validar el resultado contra los criterios de validación.`,
    `4. Git commit con mensaje claro siguiendo convenciones.`,
    '',
    '## Checklist de implementación',
    '',
    spec.technical.checklist.join('\n'),
    '',
    '## Contrato',
    '',
    spec.technical.contract.join('\n'),
    '',
    '## Validaciones',
    '',
    spec.technical.validation.join('\n'),
    '',
    '## Manejo de errores',
    '',
    spec.technical.errors.join('\n'),
    '',
  ].join('\n');
}

function buildQAMarkdown(spec) {
  return [
    '## Pruebas unitarias',
    '',
    `Tests automáticos del repo deben pasar antes del push. Más importante que coverage: cubrir el happy path + los edge cases enumerados abajo.`,
    '',
    '## Happy path',
    '',
    spec.qa.happyPath.join('\n'),
    '',
    '## Edge cases',
    '',
    spec.qa.edgeCases.join('\n'),
    '',
    '## Mocks',
    '',
    spec.qa.mocks,
    '',
    '## Herramientas',
    '',
    spec.qa.tools,
    '',
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

(async () => {
  console.log('--- Seed Conflict Stress Test (Capa A + Capa B) ---\n');

  let pod = await prisma.pod.findFirst();
  if (!pod) {
    pod = await prisma.pod.create({
      data: { name: 'Forge Test', description: 'Pod de prueba E2E', color: '#6366f1' },
    });
    console.log(`✓ Pod creado: ${pod.name} (${pod.id.slice(0, 8)})`);
  } else {
    console.log(`✓ Pod existente: ${pod.name} (${pod.id.slice(0, 8)})`);
  }

  let initiative = await prisma.initiative.findFirst({
    where: { name: { not: '' } },
  });
  if (!initiative) {
    initiative = await prisma.initiative.create({
      data: {
        name: 'Validación del Forge E2E',
        description: 'Iniciativa de prueba para encolar épicas con DAG y validar el flow E2E.',
        owner: 'seed-script',
        startDate: new Date(),
        targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    console.log(`✓ Initiative creada: ${initiative.name} (${initiative.id.slice(0, 8)})`);
  } else {
    console.log(`✓ Initiative existente: ${initiative.name} (${initiative.id.slice(0, 8)})`);
  }

  const epicTitle = `Conflict Stress Test ${new Date().toISOString().slice(11, 19)}`;
  const epicMarkdown = [
    '## Descripción',
    '',
    'Épica seed adversarial — diseñada para FORZAR conflicts reales en el sprint-batch y ejercitar AMBAS capas del ConflictResolverService.',
    '',
    'Wave 0 contiene 2 pares conflictantes:',
    '  - PAR A (target Capa A): A1 + A2 ambas modifican `package.json` → conflict JSON → Capa A deep-merge',
    '  - PAR B (target Capa B): B1 + B2 ambas crean `notes.html` → conflict add/add HTML → Capa B Sonnet judge',
    '',
    'Wave 1 contiene 1 story verificadora (V) con hard-deps a las 4 de Wave 0, que lee los archivos post-merge y genera un reporte committeable `conflict-test-report.md` con el outcome detallado.',
    '',
    '## Beneficios cualitativos',
    '- Validación E2E del ConflictResolverService — el feature está wired hace tiempo pero NUNCA fue ejercido en producción por falta de un escenario adversarial.',
    '- Auditabilidad: el reporte commiteado por la story V es la prueba tangible del outcome (no solo logs efímeros).',
    '',
    '## Beneficios cuantitativos',
    '- 5 runs Haiku/Sonnet en stories triviales (estimado: ~$5-7 total).',
    '- 4 PRs Wave 0 + 1 PR Wave 1 = 5 PRs totales. 2 de los 4 de Wave 0 entrarán en conflict y ejercitarán el resolver.',
    '',
    '## Medición de beneficios',
    '- En logs de la API se deben ver eventos `forge.conflict_resolver.start`, `.detected`, `.file_resolved`, `.completed` para los conflicts esperados (1× Capa A, 1× Capa B).',
    '- Post-merge: `package.json` debe tener AMBOS lodash + dayjs; `notes.html` debe tener AMBAS secciones (Técnicas + Legales).',
    '- El report `conflict-test-report.md` debe decir `## Resultado: ✅ PASS`.',
    '',
    '## Alcance',
    '- Modificar `package.json` (2 stories) y crear `notes.html` (2 stories) en parallel.',
    '- Story V solo lee + escribe reporte (no modifica el código existente).',
    '- NO requiere builds, NO ejecuta tests del repo.',
    '',
    '## Criterios de aceptación',
    '- 5 PRs abiertos.',
    '- AMBAS capas del ConflictResolverService corrieron al menos una vez (visible en logs).',
    '- `conflict-test-report.md` final dice `## Resultado: ✅ PASS`.',
    '',
    '## Mejoras tecnológicas',
    '- Ninguna — épica de prueba adversarial.',
    '',
    '## Canales y flujos impactados',
    '- ConflictResolverService (apps/api/src/modules/factory/fleet/conflict-resolver.service.ts) — primera ejecución real en escenario adversarial.',
    '',
    '## Dependencias de terceros',
    '- Octokit (vault writes), Anthropic API (Capa B Sonnet 4.6 invocation).',
  ].join('\n');

  const epic = await prisma.epic.create({
    data: {
      title: epicTitle,
      markdown: epicMarkdown,
      status: 'in_progress',
      priority: 'low',
      startDate: new Date(),
      targetDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      initiativeId: initiative.id,
      enqueuedAt: new Date(),
      enqueuedBatchId: randomUUID(),
    },
  });
  console.log(`✓ Épica creada y encolada: "${epic.title}" (${epic.id.slice(0, 8)})`);

  await prisma.epicPod.create({ data: { epicId: epic.id, podId: pod.id } });
  console.log(`✓ EpicPod asociación creada`);

  console.log(`\n--- Creando ${STORY_SPECS.length} stories con vaultPath + escribiendo vault ---`);
  const iniRef = { id: initiative.id, name: initiative.name };
  const epicRef = { id: epic.id, title: epic.title };
  const storiesByKey = {};
  const vaultFailures = [];

  for (const spec of STORY_SPECS) {
    const storyId = randomUUID();
    const storyRef = { id: storyId, title: spec.title };
    const folder = storyFolderPath(iniRef, epicRef, storyRef);
    const indexPath = `${folder}/index.md`;
    const poPath = storyPOPath(iniRef, epicRef, storyRef);
    const technicalPath = storyTechnicalPath(iniRef, epicRef, storyRef);
    const qaPath = storyQAPath(iniRef, epicRef, storyRef);

    let vaultPathToStore = indexPath;
    let sectionsWritten = [];
    try {
      await writeVaultFile(
        poPath,
        buildPOMarkdown(spec),
        `seed: definicion-negocio for ${spec.title}`,
      );
      sectionsWritten.push('po');
      await writeVaultFile(
        technicalPath,
        buildTechnicalMarkdown(spec),
        `seed: definicion-tecnica for ${spec.title}`,
      );
      sectionsWritten.push('tech');
      await writeVaultFile(
        qaPath,
        buildQAMarkdown(spec),
        `seed: testing-strategy for ${spec.title}`,
      );
      sectionsWritten.push('qa');
    } catch (vaultErr) {
      vaultPathToStore = null;
      vaultFailures.push({
        key: spec.key,
        error: vaultErr.message,
        sectionsWritten: sectionsWritten.length,
      });
    }

    const story = await prisma.story.create({
      data: {
        id: storyId,
        title: spec.title,
        status: 'backlog',
        epicId: epic.id,
        podId: pod.id,
        storyPoints: 1,
        vaultPath: vaultPathToStore,
      },
    });
    storiesByKey[spec.key] = story;

    const vaultStatus = vaultPathToStore
      ? `vault=OK (po+tech+qa @ ${folder})`
      : `vault=SKIPPED (write failed después de ${sectionsWritten.length}/3 secciones)`;
    console.log(`  ✓ Story ${spec.key}: "${spec.title}" (${story.id.slice(0, 8)})`);
    console.log(`    ${vaultStatus}`);
  }

  if (vaultFailures.length > 0) {
    console.log(`\n⚠️  ATENCIÓN: ${vaultFailures.length}/${STORY_SPECS.length} vault writes fallaron.`);
    for (const f of vaultFailures) {
      console.log(`     - Story ${f.key}: ${f.error.slice(0, 120)}`);
    }
  }

  console.log(`\n--- Creando dependencias hard del DAG ---`);
  let depCount = 0;
  for (const spec of STORY_SPECS) {
    const story = storiesByKey[spec.key];
    for (const blockerKey of spec.dependsOn) {
      const blocker = storiesByKey[blockerKey];
      await prisma.storyDependency.create({
        data: {
          storyId: story.id,
          blockedById: blocker.id,
          hardness: 'hard',
          reason: 'sequential_logic',
          description: `Story ${spec.key} depends on Story ${blockerKey} per conflict-test DAG`,
        },
      });
      depCount++;
      console.log(`  ✓ ${spec.key} ← bloqueada por ${blockerKey}`);
    }
  }

  console.log(`\n--- LISTO ---`);
  console.log(`Epic ID: ${epic.id}`);
  console.log(`Batch ID: ${epic.enqueuedBatchId}`);
  console.log(`Stories: ${STORY_SPECS.length} (${STORY_SPECS.map((s) => s.key).join(', ')}) | Dependencies hard: ${depCount}`);
  console.log(`Vault writes: ${STORY_SPECS.length * 3} archivos en ${VAULT_OWNER}/${VAULT_REPO}`);
  console.log(`\nDAG esperado en el dashboard /factory/batch/${epic.enqueuedBatchId}:`);
  console.log(`  Wave 0:`);
  console.log(`    A1 (package.json + lodash) — conflict pair con A2 → Capa A`);
  console.log(`    A2 (package.json + dayjs)  — conflict pair con A1 → Capa A`);
  console.log(`    B1 (notes.html técnicas)   — conflict pair con B2 → Capa B`);
  console.log(`    B2 (notes.html legales)    — conflict pair con B1 → Capa B`);
  console.log(`  Wave 1:`);
  console.log(`    V  (verifier + reporte)    ← A1, A2, B1, B2`);
  console.log(`\nLogs a monitorear (en stdout de la API):`);
  console.log(`  pnpm dev:api 2>&1 | grep -E "(conflict_resolver|updateBranch\\.conflict|merge\\.retry)"`);
  console.log(`\nResultado esperado:`);
  console.log(`  - 2 eventos forge.conflict_resolver.completed (1× package.json [Capa A], 1× notes.html [Capa B])`);
  console.log(`  - 5 PRs mergueados al sprint-batch del epic`);
  console.log(`  - Story V genera conflict-test-report.md con "## Resultado: ✅ PASS"`);
  console.log(`\nSi NO ves logs del conflict_resolver durante el run pero los PRs igual mergean:`);
  console.log(`  → Significa que los agentes no produjeron conflict real (e.g., uno terminó MUCHO antes que el otro)`);
  console.log(`  → Re-run el seed, o verifica timestamps de los PRs en GitHub`);
  console.log(`\nPara que el worker la claim:`);
  console.log(`  1. Asegurate que "Forge: write" está activo en /factory/settings → Código`);
  console.log(`  2. Reinicia worker: pkill -f "factory-worker start" && factory-worker start`);

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('❌ ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
