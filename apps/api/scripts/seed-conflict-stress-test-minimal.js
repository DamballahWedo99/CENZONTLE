/* eslint-disable @typescript-eslint/no-require-imports */
// Run with: node --env-file=apps/api/.env apps/api/scripts/seed-conflict-stress-test-minimal.js
//
// ═════════════════════════════════════════════════════════════════════════
// Seed MINIMAL para validar ConflictResolverService — Capa A + Capa B
// ═════════════════════════════════════════════════════════════════════════
//
// Optimización 2026-05-17: el seed previo (seed-conflict-stress-test.js)
// gastó ~$9.32 en 5 stories porque cada story tenía 18-21 criterios DoD,
// y cada criterio = 1 LLM call al verifier. El ConflictResolver NO le
// importa la complejidad de las stories — solo necesita que 2 PRs choquen
// en el mismo archivo. Este seed re-diseña con esa observación en mente:
//
//   - 4 stories en vez de 5 (NO hay V verifier — se reemplaza por script bash)
//   - Cada story: 1 AC trivial + 0 TL requirements + 0 QA test cases
//   - Stories tan simples que el coder converge en attempt 1 (no doom loop)
//   - Validación post-merge con `gh api` + `grep` — $0 cost, instant
//
// Cost esperado: $1.00-1.40 USD total (vs $9.32 actual = 87% reducción)
// Wall-clock: ~3-4 min (vs ~10 min) por menos verifier calls
//
// ═════════════════════════════════════════════════════════════════════════
// DAG diseñado para forzar conflict mínimo:
// ═════════════════════════════════════════════════════════════════════════
//
//   Wave 0 (4 stories paralelas — 2 pares conflictantes, sin Wave 1):
//
//   ┌─────────────────────────────────────────────────────────┐
//   │  PAR A (Capa A target — text line-union deterministic): │
//   │    A1: append "# CENZONTLE-A1" al final de .gitignore   │
//   │    A2: append "# CENZONTLE-A2" al final de .gitignore   │
//   │    → conflict en última posición del archivo            │
//   │    → Capa A `lineUnionMerge` → preserva ambas líneas    │
//   └─────────────────────────────────────────────────────────┘
//
//   ┌─────────────────────────────────────────────────────────┐
//   │  PAR B (Capa B target — markdown Sonnet semantic):      │
//   │    B1: crear MERGE_TEST.md con sección "## From B1"     │
//   │    B2: crear MERGE_TEST.md con sección "## From B2"     │
//   │    → add/add conflict (ambos crean el mismo archivo)    │
//   │    → Capa A retorna {supported:false} para .md          │
//   │    → escala a Capa B → Sonnet integra ambas secciones   │
//   └─────────────────────────────────────────────────────────┘
//
// Validación post-merge (sin LLM, sin gastos):
//   bash apps/api/scripts/verify-conflict-test.sh <BATCH_ID_PREFIX>
//
// ═════════════════════════════════════════════════════════════════════════

const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Octokit } = require('@octokit/rest');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ───────────────────────────────────────────────────────────────────────────
// Vault path helpers (idénticos a seed-conflict-stress-test.js — replican
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
// Story specs — MINIMAL: 1 AC trivial + technical/qa vacíos por story
//
// El parser del backend lee las 3 secciones del vault (PO + Technical + QA)
// y extrae:
//   - PO   → acceptance criteria (per-criterion verifier Layer 3)
//   - Tech → TL requirements (per-item verifier — VACÍO acá)
//   - QA   → test cases (per-test-case verifier — VACÍO acá)
//
// Con technical/qa vacíos, el verifier corre SOLO 1 LLM call por AC + las
// DoD standard (code-written, no-errors, security-scan, docs-updated).
// Estimado ~3-5 LLM calls por story × 4 stories × 1 attempt = ~15 calls
// total ≈ $0.80-1.20.
// ───────────────────────────────────────────────────────────────────────────

const EMPTY_TECHNICAL = {
  checklist: [],
  contract: [],
  validation: [],
  errors: [],
};

const EMPTY_QA = {
  happyPath: [],
  edgeCases: [],
  mocks: '- N/A (story trivial — sin tests por diseño)',
  tools: '- N/A',
};

const STORY_SPECS = [
  // ─────────────────────────────────────────────────────────────────────────
  // PAR A — Capa A target (line-union deterministic en .gitignore)
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: 'A1',
    title: 'Append marker A1 al archivo .gitignore',
    acceptanceCriteria: [
      '1. El archivo `.gitignore` en el root del repo contiene la línea exacta `# CENZONTLE-A1` (caso-sensitivo, sin espacios extra).',
      '2. La línea se agrega al FINAL del archivo (es la última línea, después de cualquier contenido preexistente).',
      '3. El resto del contenido del `.gitignore` queda intacto (no se borra ni reordena nada).',
    ].join('\n'),
    technical: EMPTY_TECHNICAL,
    qa: EMPTY_QA,
    dependsOn: [],
  },
  {
    key: 'A2',
    title: 'Append marker A2 al archivo .gitignore',
    acceptanceCriteria: [
      '1. El archivo `.gitignore` en el root del repo contiene la línea exacta `# CENZONTLE-A2` (caso-sensitivo, sin espacios extra).',
      '2. La línea se agrega al FINAL del archivo (es la última línea, después de cualquier contenido preexistente).',
      '3. El resto del contenido del `.gitignore` queda intacto.',
    ].join('\n'),
    technical: EMPTY_TECHNICAL,
    qa: EMPTY_QA,
    dependsOn: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PAR B — Capa B target (Sonnet semantic judge en MERGE_TEST.md)
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: 'B1',
    title: 'Crear MERGE_TEST.md con sección B1',
    acceptanceCriteria: [
      '1. Existe un archivo `MERGE_TEST.md` en el root del repo (creado por este PR — NO existía antes).',
      '2. El archivo contiene EXACTAMENTE estas dos líneas (en este orden, sin nada más):',
      '```',
      '## From B1',
      'Marker: B1-OK',
      '```',
    ].join('\n'),
    technical: EMPTY_TECHNICAL,
    qa: EMPTY_QA,
    dependsOn: [],
  },
  {
    key: 'B2',
    title: 'Crear MERGE_TEST.md con sección B2',
    acceptanceCriteria: [
      '1. Existe un archivo `MERGE_TEST.md` en el root del repo (creado por este PR — NO existía antes).',
      '2. El archivo contiene EXACTAMENTE estas dos líneas (en este orden, sin nada más):',
      '```',
      '## From B2',
      'Marker: B2-OK',
      '```',
    ].join('\n'),
    technical: EMPTY_TECHNICAL,
    qa: EMPTY_QA,
    dependsOn: [],
  },
];

function buildPOMarkdown(spec) {
  return [
    '## Antecedentes',
    '',
    'Story MINIMAL del seed adversarial — diseñada para producir un conflict trivial y ejercitar el ConflictResolverService con costo bajo (~$0.30/story).',
    'No requiere lógica compleja: una sola modificación textual al archivo target.',
    '',
    '## Objetivo',
    '',
    `Cumplir el AC al pie de la letra. Es UNA línea/archivo — no necesitás technical design, tests ni docs.`,
    '',
    '## Historia de usuario',
    '',
    `Como operador del Forge, quiero forzar un conflict en el sprint-batch base para validar que el ConflictResolverService lo resuelve automáticamente.`,
    '',
    '## Criterios de aceptación',
    '',
    spec.acceptanceCriteria,
    '',
    '## Notas adicionales',
    '',
    '- Generada por `scripts/seed-conflict-stress-test-minimal.js`.',
    '- NO requiere code-review humano — es archivo de test, no producción.',
    '- El conflict será resuelto automáticamente por la capa A (deterministic) o B (Sonnet judge) del ConflictResolverService cuando los PRs se mergeen al sprint-batch.',
  ].join('\n');
}

/**
 * Build technical markdown con secciones VACÍAS — el parser del backend lee
 * las headings obligatorios pero extrae 0 requirements de cada categoría.
 * Resultado: 0 TL requirements para el verifier (== 0 LLM calls TL).
 */
function buildTechnicalMarkdown(spec) {
  return [
    '## Arquitectura y componentes',
    '',
    'N/A — operación filesystem trivial (1 línea / 1 archivo).',
    '',
    '## Flujo de integración',
    '',
    '1. Leer el archivo target (si existe).',
    '2. Hacer el cambio mínimo del AC.',
    '3. Commit + push.',
    '',
    '## Checklist de implementación',
    '',
    spec.technical.checklist.length > 0
      ? spec.technical.checklist.join('\n')
      : '_(N/A — story trivial, sin checklist técnico.)_',
    '',
    '## Contrato',
    '',
    spec.technical.contract.length > 0
      ? spec.technical.contract.join('\n')
      : '_(N/A.)_',
    '',
    '## Validaciones',
    '',
    spec.technical.validation.length > 0
      ? spec.technical.validation.join('\n')
      : '_(N/A.)_',
    '',
    '## Manejo de errores',
    '',
    spec.technical.errors.length > 0
      ? spec.technical.errors.join('\n')
      : '_(N/A.)_',
    '',
  ].join('\n');
}

/**
 * Build QA markdown con secciones VACÍAS — 0 test cases extraídos.
 */
function buildQAMarkdown(spec) {
  return [
    '## Pruebas unitarias',
    '',
    'N/A — story trivial sin lógica para testear. La validación final es bash + gh api post-merge.',
    '',
    '## Happy path',
    '',
    spec.qa.happyPath.length > 0
      ? spec.qa.happyPath.join('\n')
      : '_(N/A.)_',
    '',
    '## Edge cases',
    '',
    spec.qa.edgeCases.length > 0
      ? spec.qa.edgeCases.join('\n')
      : '_(N/A.)_',
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
  console.log('--- Seed MINIMAL Conflict Stress Test (Capa A + Capa B) ---\n');
  console.log('Cost esperado: ~$1.00-1.40 USD total (vs ~$9.32 del seed previo)\n');

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

  const epicTitle = `Conflict Minimal ${new Date().toISOString().slice(11, 19)}`;
  const epicMarkdown = [
    '## Descripción',
    '',
    'Épica MINIMAL — diseñada para validar ConflictResolverService con costo ~$1 USD (vs ~$9 del seed full).',
    '',
    '4 stories Wave 0, sin Wave 1 (validación post-merge via bash + gh api, no via agent):',
    '  - PAR A (Capa A): A1 + A2 ambos appendean al .gitignore → conflict line-union',
    '  - PAR B (Capa B): B1 + B2 ambos crean MERGE_TEST.md → conflict semantic',
    '',
    'Cada story: 1 AC trivial + 0 TL requirements + 0 QA test cases. Coder converge en attempt 1, verifier ejecuta ~5 LLM calls por story.',
    '',
    '## Beneficios cualitativos',
    '- Validación E2E del ConflictResolverService con cost mínimo — el resolver no le importa la complejidad de las stories, solo que conflictúen.',
    '',
    '## Beneficios cuantitativos',
    '- ~$1.00-1.40 total (vs ~$9.32 del seed previo). 87% reducción.',
    '- ~3-4 min wall-clock (vs ~10 min).',
    '',
    '## Medición de beneficios',
    '- 4 PRs mergueados al sprint-batch.',
    '- En logs API: 2× eventos `forge.conflict_resolver.completed` (1 Capa A, 1 Capa B).',
    '- Script `verify-conflict-test.sh` retorna PASS/PASS.',
    '',
    '## Alcance',
    '- 4 modificaciones triviales de archivos. NO touch a código ejecutable.',
    '',
    '## Criterios de aceptación',
    '- 4 PRs abiertos y mergueados.',
    '- AMBAS capas del resolver corrieron al menos una vez.',
    '- Post-merge: .gitignore tiene `# CENZONTLE-A1` Y `# CENZONTLE-A2`; MERGE_TEST.md tiene `B1-OK` Y `B2-OK`.',
    '',
    '## Mejoras tecnológicas',
    '- Ninguna — épica de prueba.',
    '',
    '## Canales y flujos impactados',
    '- ConflictResolverService — primera ejecución real validada en escenario adversarial mínimo.',
    '',
    '## Dependencias de terceros',
    '- GitHub API (PRs + merge).',
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

  // Sin StoryDependency — todas en Wave 0, sin Wave 1.
  console.log(`\n--- Sin dependencias hard (todas Wave 0 paralelas) ---`);

  console.log(`\n--- LISTO ---`);
  console.log(`Epic ID: ${epic.id}`);
  console.log(`Batch ID: ${epic.enqueuedBatchId}`);
  console.log(`Sprint-batch branch: forge/sprint-batch-${epic.id.slice(0, 8)}`);
  console.log(`Stories: ${STORY_SPECS.length} (${STORY_SPECS.map((s) => s.key).join(', ')}) | Dependencies: 0`);
  console.log(`Vault writes: ${STORY_SPECS.length * 3} archivos en ${VAULT_OWNER}/${VAULT_REPO}`);
  console.log(`\nDAG (sin Wave 1):`);
  console.log(`  Wave 0 paralela:`);
  console.log(`    A1 (.gitignore +# CENZONTLE-A1) ── conflict con A2 → Capa A`);
  console.log(`    A2 (.gitignore +# CENZONTLE-A2) ── conflict con A1 → Capa A`);
  console.log(`    B1 (MERGE_TEST.md +"From B1")  ── conflict con B2 → Capa B`);
  console.log(`    B2 (MERGE_TEST.md +"From B2")  ── conflict con B1 → Capa B`);
  console.log(`\nLogs API a monitorear:`);
  console.log(`  pnpm dev:api 2>&1 | grep -E "(conflict_resolver|updateBranch\\.conflict|merge\\.retry)"`);
  console.log(`\nValidación POST-merge ($0 cost):`);
  console.log(`  bash apps/api/scripts/verify-conflict-test.sh ${epic.id.slice(0, 8)}`);
  console.log(`\nCost esperado: ~$1.00-1.40 (vs ~$9.32 del seed full)`);
  console.log(`Wall-clock esperado: ~3-4 min`);
  console.log(`\nPara que el worker la claim:`);
  console.log(`  pkill -f "factory-worker start" && FACTORY_WORKER_ALLOW_INSECURE=1 factory-worker start`);

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('❌ ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
