/* eslint-disable @typescript-eslint/no-require-imports */
// Run with:
//   node scripts/cleanup-all-forge-branches.js <owner>/<repo>          (dry-run)
//   node scripts/cleanup-all-forge-branches.js <owner>/<repo> --apply  (borrar)
//
// Borra TODAS las ramas remotas cuyo nombre empieza con `forge/`, sin importar
// si su PR está merged, closed o open. Operación destructiva diseñada para
// limpieza experimental — borra work-in-progress también.
//
// DIFERENCIA vs `cleanup-merged-forge-branches.js`:
//   - cleanup-merged-*: solo borra si el PR está MERGED (operación recurrente segura)
//   - cleanup-all-*    : borra TODAS las forge/* sin importar PR state (one-shot adversarial)
//
// Defensas (multi-layer):
//   1. Match obligatorio del prefix `forge/` — main, dev, master, etc. nunca matchean
//   2. Lista las branches OPEN-PR antes de borrar para que el operador vea
//      qué work-in-progress se va a perder
//   3. Dry-run por default — requiere `--apply` explícito
//   4. Idempotente: skip 404 (branch ya borrada)
//   5. Reporta deleted/failed por separado
const { execFileSync } = require('child_process');

const repoArg = process.argv[2];
const apply = process.argv.includes('--apply');

if (!repoArg || !repoArg.includes('/')) {
  console.error('Usage: node scripts/cleanup-all-forge-branches.js <owner>/<repo> [--apply]');
  process.exit(1);
}

const [owner, repo] = repoArg.split('/');

function gh(args, opts = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'pipe',
  });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

(async () => {
  console.log(`\n[cleanup-all] target: ${owner}/${repo}`);
  console.log(`[cleanup-all] mode: ${apply ? 'APPLY (destructive — borra WIP también)' : 'DRY-RUN'}\n`);

  // 1. Listar TODAS las branches del repo con paginación
  console.log('[cleanup-all] listando branches...');
  let allBranches = [];
  let page = 1;
  while (true) {
    const batch = ghJson([
      'api',
      `repos/${owner}/${repo}/branches?per_page=100&page=${page}`,
    ]);
    if (batch.length === 0) break;
    allBranches.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  console.log(`[cleanup-all] ${allBranches.length} branches totales en remote`);

  // 2. Filtrar SOLO las que empiezan con `forge/` (defensa contra main/dev/master)
  const forgeBranches = allBranches.filter((b) => b.name.startsWith('forge/'));
  if (forgeBranches.length === 0) {
    console.log('[cleanup-all] no hay branches forge/* — nada que limpiar.');
    return;
  }
  console.log(`[cleanup-all] ${forgeBranches.length} branches forge/* candidatas\n`);

  // 3. Defensa adicional: verificar que NINGUNA es default/protected
  const protectedNames = new Set(['main', 'master', 'dev', 'develop', 'staging', 'production']);
  for (const b of forgeBranches) {
    if (protectedNames.has(b.name)) {
      console.error(`[cleanup-all] FATAL: branch '${b.name}' parece protegida pero matchea filtro. Aborto.`);
      process.exit(1);
    }
    if (b.protected) {
      console.error(`[cleanup-all] FATAL: branch '${b.name}' tiene protection rules. Aborto.`);
      process.exit(1);
    }
  }

  // 4. Detectar branches con PRs OPEN para advertir al operador (WIP que se pierde)
  console.log('[cleanup-all] chequeando PRs open asociados...');
  const openPrs = ghJson([
    'pr',
    'list',
    '--repo',
    `${owner}/${repo}`,
    '--state',
    'open',
    '--limit',
    '500',
    '--json',
    'number,headRefName,title',
  ]);
  const openByBranch = new Map(openPrs.map((p) => [p.headRefName, p]));
  const wipBranches = forgeBranches.filter((b) => openByBranch.has(b.name));

  if (wipBranches.length > 0) {
    console.log(`\n[cleanup-all] ⚠️  ${wipBranches.length} branches forge/* con PR OPEN (work-in-progress que se perderá):`);
    for (const b of wipBranches) {
      const pr = openByBranch.get(b.name);
      console.log(`    - ${b.name}  →  PR #${pr.number} "${pr.title}"`);
    }
  } else {
    console.log('[cleanup-all] no hay PRs open asociados — sin WIP en riesgo.');
  }

  // 5. Dry-run vs apply
  if (!apply) {
    console.log(`\n[cleanup-all] DRY-RUN — branches que SE borrarían (${forgeBranches.length}):`);
    for (const b of forgeBranches) {
      const wip = openByBranch.has(b.name) ? '  ⚠ OPEN-PR' : '';
      console.log(`    - ${b.name}${wip}`);
    }
    console.log(`\n[cleanup-all] re-ejecuta con --apply para borrar las ${forgeBranches.length} branches.`);
    return;
  }

  // 6. Apply: borrar una por una
  console.log(`\n[cleanup-all] APPLY — borrando ${forgeBranches.length} branches...`);
  let deleted = 0;
  let failed = 0;
  let alreadyGone = 0;
  for (const b of forgeBranches) {
    try {
      gh([
        'api',
        '--method',
        'DELETE',
        `repos/${owner}/${repo}/git/refs/heads/${b.name}`,
        '--silent',
      ], { silent: true });
      console.log(`  ✓ ${b.name}`);
      deleted++;
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('404') || msg.includes('Not Found')) {
        console.log(`  - ${b.name} (ya no existía)`);
        alreadyGone++;
      } else {
        console.error(`  ✗ ${b.name}: ${msg.split('\n')[0]}`);
        failed++;
      }
    }
  }

  console.log(`\n[cleanup-all] borradas: ${deleted}, ya gone: ${alreadyGone}, fallidas: ${failed}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
