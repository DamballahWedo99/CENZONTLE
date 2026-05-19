/* eslint-disable @typescript-eslint/no-require-imports */
// Run with: node --env-file=.env scripts/seed-trivial-epic.js
//
// Crea una épica con 5 historias + DAG de dependencias HARD + criterios de
// aceptación escritos al vault GitHub, para validar end-to-end:
//
//   - Wave Execution DAG topológico (`getBatchDetail` agrupa por waves)
//   - storyMarkdown llegando al agente Forge + verifier Layer 3 (acceptance
//     criteria CONCRETOS evaluados, no en abstracto)
//   - Pipeline Board: épica avanza In Queue → Forge (procesando) → Forge
//     awaiting approval (todas done) sin regresar a IN QUEUE
//
// DAG creado (replica el ejemplo de docs):
//
//   Wave 0: A (Setup base) ─┬─→ Wave 1: C ─┐
//                            │              ├─→ Wave 2: E (Documentación)
//           B (Tests config) ┴─→ Wave 1: D ─┘
//
//   - Story A: sin deps
//   - Story B: sin deps
//   - Story C: depende de A
//   - Story D: depende de A + B
//   - Story E: depende de C + D
//
// Cada story tiene vaultPath set + las 3 secciones del story content
// escritas al vault con specs específicos:
//   - `definicion-negocio.md` (PO): acceptance criteria.
//   - `definicion-tecnica.md` (TL): checklist + contract + validations + errors.
//   - `testing-strategy.md` (QA): happy path + edge cases + mocks + tools.
//
// El backend lee las 3 en `readStoryContent` y las inyecta al prompt del
// agente + verifier Layer 3 (`acceptance-criteria`, `technical-design`,
// `tests-passing`). Validan end-to-end el feature del context engineering
// y la evaluación per-item del DoD verifier.

const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Octokit } = require('@octokit/rest');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ───────────────────────────────────────────────────────────────────────────
// Vault path helpers (replican apps/api/src/modules/proyectos/vault-paths.ts)
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
  // Verificar si el archivo existe (para sha en update). PUT contents
  // requiere sha si el archivo ya existe, lo omite si es nuevo.
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
// Story specs — el DAG completo + acceptance criteria reales
// ───────────────────────────────────────────────────────────────────────────

const STORY_SPECS = [
  {
    key: 'A',
    title: 'Crear info-card.html con datos del Popocatépetl',
    acceptanceCriteria: [
      '1. Existe un archivo `info-card.html` en el root del repo.',
      '2. Contiene una etiqueta `<section>` o `<article>` con un `<h2>` que mencione "Popocatépetl".',
      '3. Contiene una lista (`<ul>` o `<dl>`) con al menos 3 datos: altura, ubicación, última erupción documentada.',
      '4. El archivo está committeado en la branch del worker.',
    ].join('\n'),
    // Sección Technical — items detectables por pre-flight (paths concretos)
    // + items abstractos (escalan a Sonnet judge). Mix intencional para
    // ejercitar ambos paths del feature `technical-design`.
    technical: {
      checklist: [
        '- Crear archivo `info-card.html` en el directorio raíz del repo (no en subdirectorio).',
        '- Usar HTML5 semántico: `<section>` o `<article>` + `<h2>` + `<ul>` o `<dl>`.',
        '- Incluir al menos 3 datos factuales reales: altura (~5,426m), ubicación (entre Puebla y Estado de México), erupción reciente.',
      ],
      contract: [
        '- El archivo debe usar encoding UTF-8 sin BOM.',
        '- Línea final con newline `\\n` (estándar POSIX).',
      ],
      validation: [
        '- El HTML final debe ser parseable: tags balanceados, atributos quoted, sin elementos sin cerrar.',
      ],
      errors: [
        '- Si el contenido generado no incluye `<section>`/`<article>` + lista con ≥3 items, NO ejecutar `git commit`.',
      ],
    },
    // Sección QA — casos de prueba que el verifier evaluará per-test-case.
    qa: {
      happyPath: [
        '- Después del run, `cat info-card.html` debe mostrar HTML válido con sección de datos y ≥3 items en la lista.',
      ],
      edgeCases: [
        '- El archivo committeado debe terminar con newline final (`\\n`) según estándar POSIX.',
        '- Todos los tags HTML deben estar correctamente cerrados (cada `<li>` con `</li>`, etc.).',
      ],
      mocks: '- No requiere mocks (HTML estático).',
      tools: '- Validación: parsear el HTML con un parser simple para verificar estructura.',
    },
    dependsOn: [],
  },
  {
    key: 'B',
    title: 'Crear history.html con la leyenda de Popocatépetl e Iztaccíhuatl',
    acceptanceCriteria: [
      '1. Existe un archivo `history.html` en el root del repo.',
      '2. Contiene una `<section>` con un `<h2>` que mencione "Leyenda" o "Historia".',
      '3. Contiene al menos 2 párrafos (`<p>`) explicando el mito azteca de Popocatépetl e Iztaccíhuatl.',
      '4. El archivo está committeado en la branch del worker.',
    ].join('\n'),
    technical: {
      checklist: [
        '- Crear archivo `history.html` en el directorio raíz del repo.',
        '- Usar HTML5 semántico: `<section>` + `<h2>` + `<p>`.',
        '- Contar la leyenda azteca de los dos enamorados convertidos en volcanes (mínimo 2 párrafos).',
      ],
      contract: [
        '- Encoding UTF-8 sin BOM.',
        '- Línea final con newline `\\n` (estándar POSIX).',
      ],
      validation: [
        '- El HTML debe ser parseable: tags balanceados, párrafos correctamente cerrados.',
      ],
      errors: [
        '- Si los párrafos del relato suman menos de 100 palabras totales, NO commit (relato insuficiente).',
      ],
    },
    qa: {
      happyPath: [
        '- `cat history.html` muestra HTML válido con sección de leyenda y ≥2 párrafos narrativos.',
      ],
      edgeCases: [
        '- Archivo termina con newline final POSIX.',
        '- Cada `<p>` está correctamente cerrado con `</p>`.',
      ],
      mocks: '- No requiere mocks (contenido narrativo estático).',
      tools: '- Validación: contar palabras en los `<p>` + parser HTML.',
    },
    dependsOn: [],
  },
  {
    key: 'C',
    title: 'Crear index.html integrando info-card.html e history.html',
    acceptanceCriteria: [
      '1. Existe un archivo `index.html` en el root del repo (o se modifica si ya existía).',
      '2. Contiene estructura HTML5 completa: `<!DOCTYPE html>`, `<html lang="es">`, `<head>` con `<meta charset>` y `<title>`.',
      '3. El `<body>` integra el contenido completo de `info-card.html` Y `history.html` inline (no `<iframe>`, sino markup copiado).',
      '4. El `<title>` menciona "Popocatépetl" y el archivo está committeado en la branch del worker.',
    ].join('\n'),
    technical: {
      checklist: [
        '- LEER `info-card.html` y `history.html` ANTES de generar `index.html` (consumir contratos de stories previas).',
        '- Crear `index.html` con `<!DOCTYPE html>` en la primera línea no vacía, `<head>` con `<meta charset="UTF-8">` y `<title>` que mencione "Popocatépetl".',
        '- Insertar el contenido de info-card.html antes que el de history.html dentro del `<body>` (orden importa: datos → leyenda).',
      ],
      contract: [
        '- El `<title>` debe contener literalmente la palabra "Popocatépetl".',
        '- Encoding UTF-8 sin BOM, newline final POSIX.',
      ],
      validation: [
        '- El `index.html` final debe contener EXACTAMENTE UN `<!DOCTYPE>` y UN único elemento `<html>` raíz.',
      ],
      errors: [
        '- Si `info-card.html` o `history.html` no existen, NO commitear `index.html` parcial — abortar con error claro.',
      ],
    },
    qa: {
      happyPath: [
        '- Después del run, abrir `index.html` en browser muestra el título "Popocatépetl..." en la pestaña + datos y leyenda visibles.',
      ],
      edgeCases: [
        '- El doctype `<!DOCTYPE html>` está en la primera línea no vacía del archivo.',
        '- Hay exactamente UN elemento `<html>` raíz (sin duplicados por copy-paste de los fragments).',
      ],
      mocks: '- No requiere mocks (operación filesystem + lectura de stories previas).',
      tools: '- Validación: parser HTML para confirmar único `<html>` root + presencia de DOCTYPE.',
    },
    dependsOn: ['A', 'B'],
  },
];

function buildPOMarkdown(spec) {
  return [
    '## Antecedentes',
    '',
    `Esta historia es parte del DAG de prueba del Forge (épica seed-trivial). Pertenece a la wave de ${spec.dependsOn.length === 0 ? 'inicialización (sin dependencias)' : `dependencias resueltas tras: ${spec.dependsOn.join(', ')}`}.`,
    '',
    '## Objetivo',
    '',
    `Crear el artefacto markdown descrito por el título, cumpliendo los criterios de aceptación al pie de la letra.`,
    '',
    '## Historia de usuario',
    '',
    `Como operador del Forge, quiero que el agente genere "${spec.title}" siguiendo los criterios de aceptación específicos, para validar que el verifier Layer 3 evalúa contra criterios concretos (no en abstracto).`,
    '',
    '## Criterios de aceptación',
    '',
    spec.acceptanceCriteria,
    '',
    '## Notas adicionales',
    '',
    '- Esta historia fue generada por `scripts/seed-trivial-epic.js` para validación E2E.',
    '- Los criterios son verificables sin tooling (existencia + contenido de archivos).',
    '- El verifier Sonnet debe enumerar cada criterio con ✓/✗ en su reason final.',
  ].join('\n');
}

/**
 * Construye `definicion-tecnica.md` con los 4 headings obligatorios que el
 * parser `extractTechnicalRequirements` reconoce (checklist / contract /
 * validation / errors). El verifier evalúa per-item con pre-flight
 * determinístico + Sonnet judgment.
 */
function buildTechnicalMarkdown(spec) {
  return [
    '## Arquitectura y componentes',
    '',
    `Implementación pragmática para una historia trivial de validación del Forge. NO requiere patterns complejos (Repository / Factory / etc.) — operación filesystem directa con manejo de errores explícito.`,
    '',
    '## Flujo de integración',
    '',
    `1. Leer estado actual del repo (existe el archivo? hay deps de otras stories?).`,
    `2. Aplicar la transformación descrita en el checklist.`,
    `3. Validar el resultado antes de commit.`,
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

/**
 * Construye `testing-strategy.md` con los headings obligatorios que el
 * parser `extractTestCases` reconoce (Happy path / Edge cases / Mocks /
 * Herramientas). El verifier evalúa per-test-case con pre-flight
 * determinístico (grep en archivos de test) + Sonnet judgment.
 */
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
  console.log('--- Seed épica con DAG + acceptance criteria al vault ---\n');

  // 1. Pod
  let pod = await prisma.pod.findFirst();
  if (!pod) {
    pod = await prisma.pod.create({
      data: { name: 'Forge Test', description: 'Pod de prueba E2E', color: '#6366f1' },
    });
    console.log(`✓ Pod creado: ${pod.name} (${pod.id.slice(0, 8)})`);
  } else {
    console.log(`✓ Pod existente: ${pod.name} (${pod.id.slice(0, 8)})`);
  }

  // 2. Initiative — campos del schema: name (NOT title), description, owner
  //
  // Defensive: si encontramos una Initiative legacy sin `name` válido (puede
  // haber rows viejos de seeds previos que usaban el field `title` que no
  // existe en el schema), creamos una nueva. Sin `name` no podemos calcular
  // el vault path (slugify de undefined → crash).
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

  // 3. Épica
  const epicTitle = `Forge DAG test ${new Date().toISOString().slice(11, 19)}`;
  const epicMarkdown = [
    '## Descripción',
    '',
    'Épica con DAG de 3 historias (2 waves) — mini-sitio HTML sobre el volcán Popocatépetl — para validar Wave Execution + hard-deps + auto-merge cross-story + propagación de Completed Siblings al prompt del agente.',
    '',
    '## Beneficios cualitativos',
    '- Validación E2E del Tier 1 Harness con dependencias hard y verifier Layer 3 real (Haiku/Sonnet) sobre el flow completo del DAG.',
    '',
    '## Beneficios cuantitativos',
    '- ~3 runs Haiku ($0.20-0.30 c/u) + verifier batched por story (~$0.30-0.40 c/u).',
    '',
    '## Medición de beneficios',
    '- 3 PRs abiertos respetando orden topológico (A,B en wave 0; C en wave 1 tras merge de ambos).',
    '',
    '## Alcance',
    '- Crear 3 archivos HTML que componen un mini-sitio temático sobre el Popocatépetl.',
    '- NO modificar código ejecutable.',
    '',
    '## Criterios de aceptación',
    '- 3 PRs abiertos.',
    '- Order de merge respeta el DAG (A, B → C).',
    '- index.html final tiene el contenido de info-card.html e history.html integrado inline.',
    '',
    '## Mejoras tecnológicas',
    '- Ninguna — épica de prueba.',
    '',
    '## Canales y flujos impactados',
    '- Ninguno.',
    '',
    '## Dependencias de terceros',
    '- Ninguna.',
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

  // 4. Crear stories (sin deps todavía — necesitamos los IDs para las deps)
  console.log(`\n--- Creando ${STORY_SPECS.length} stor${STORY_SPECS.length === 1 ? 'y' : 'ies'} con vaultPath + escribiendo vault ---`);
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

    // Escribir las 3 secciones del vault (PO + Technical + QA). El backend
    // las lee en `readStoryContent` y las inyecta al prompt del agente +
    // al verifier per-item:
    //   - PO  → `acceptance-criteria` (per-criterion).
    //   - TL  → `technical-design` (per-item con pre-flight determinístico).
    //   - QA  → `tests-passing` (per-test-case con pre-flight).
    //
    // Graceful degradation: si CUALQUIER write falla, la story se crea con
    // vaultPath=null y todas las secciones se evalúan en abstracto. NO
    // hacemos parcial (escribir solo PO y skip TL/QA) porque el feature
    // del agente necesita las 3 para validar end-to-end.
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
    console.log(`   Las stories afectadas tienen vaultPath=null — el verifier`);
    console.log(`   evaluará acceptance-criteria en abstracto (sin los AC concretos).`);
    console.log(`   Causa probable: token de GitHub sin write access al repo del vault.`);
    console.log(`   Diagnosticá con:`);
    console.log(`   curl -s -H "Authorization: token $VAULT_GITHUB_TOKEN" \\`);
    console.log(`     https://api.github.com/repos/${VAULT_OWNER}/${VAULT_REPO} | head -5`);
    console.log(`   Errors:`);
    for (const f of vaultFailures) {
      console.log(`     - Story ${f.key}: ${f.error.slice(0, 120)}`);
    }
  }

  // 5. Crear StoryDependencies (DAG hard)
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
          description: `Story ${spec.key} depends on Story ${blockerKey} per seed DAG`,
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
  console.log(`  (por story: definicion-negocio.md + definicion-tecnica.md + testing-strategy.md)`);
  console.log(`\nDAG esperado en el dashboard /factory/batch/${epic.enqueuedBatchId}:`);
  console.log(`  Wave 0: A (info-card.html), B (history.html) — sin deps`);
  console.log(`  Wave 1: C (index.html) ← A, B`);
  console.log(`\nPara que el worker la claim:`);
  console.log(`  1. Activa "Forge: write" en /factory/settings → Código`);
  console.log(`  2. Reinicia worker: pkill -f "factory-worker start" && factory-worker start`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
