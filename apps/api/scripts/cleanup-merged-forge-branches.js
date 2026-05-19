/* eslint-disable @typescript-eslint/no-require-imports */
// Run with:
//   node scripts/cleanup-merged-forge-branches.js <owner>/<repo>          (dry-run)
//   node scripts/cleanup-merged-forge-branches.js <owner>/<repo> --apply  (borrar)
//
// Borra ramas remotas del Forge cuyo PR está MERGED pero que quedaron huérfanas
// porque `deleteBranch()` nunca se invocaba post-merge (bug fixed 2026-05-17).
//
// Requisitos:
//   - `gh` CLI instalado y autenticado contra el owner/repo target
//   - Permisos de escritura sobre el repo (delete branches)
//
// Safety:
//   - SOLO borra ramas con prefix `forge/` cuyo PR está MERGED
//   - Verifica que la rama todavía existe antes de borrar (idempotente)
//   - Dry-run por default — requiere flag `--apply` explícito para ejecutar
//   - NO toca dev/main/master ni ramas sin PR asociado
const { execFileSync } = require('child_process');

const repoArg = process.argv[2];
const apply = process.argv.includes('--apply');

if (!repoArg || !repoArg.includes('/')) {
  console.error('Usage: node scripts/cleanup-merged-forge-branches.js <owner>/<repo> [--apply]');
  process.exit(1);
}

const [owner, repo] = repoArg.split('/');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

// Variante silenciosa para checks de existencia: gh imprime "Branch not found"
// a stderr en 404 por default. Lo capturamos sin echo al terminal — el caller
// ya distingue éxito/falla por el throw.
function ghSilent(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

(async () => {
  console.log(`\n[cleanup] target: ${owner}/${repo}`);
  console.log(`[cleanup] mode: ${apply ? 'APPLY (destructive)' : 'DRY-RUN'}\n`);

  // 1. Lista TODOS los PRs MERGED paginando hasta el límite máximo.
  //    --state merged + --json filtra a lo que necesitamos.
  console.log('[cleanup] listando PRs merged...');
  const raw = gh([
    'pr',
    'list',
    '--repo',
    `${owner}/${repo}`,
    '--state',
    'merged',
    '--limit',
    '500',
    '--json',
    'number,headRefName,mergedAt',
  ]);
  const prs = JSON.parse(raw);
  console.log(`[cleanup] ${prs.length} PRs merged encontrados\n`);

  // 2. Filtra los que tienen head `forge/*`. Esos son los candidatos a borrar.
  const forgePrs = prs.filter((p) => p.headRefName.startsWith('forge/'));
  console.log(`[cleanup] ${forgePrs.length} PRs con head 'forge/*' merged\n`);

  if (forgePrs.length === 0) {
    console.log('[cleanup] nada que limpiar.');
    return;
  }

  // 3. Para cada uno, verifica que la rama todavía existe en remote.
  //    Si ya no existe (cleanup previo o borrado manual), skip.
  let toDelete = [];
  let alreadyGone = 0;
  for (const pr of forgePrs) {
    try {
      ghSilent(['api', `repos/${owner}/${repo}/branches/${pr.headRefName}`, '--silent']);
      toDelete.push(pr);
    } catch {
      alreadyGone++;
    }
  }

  console.log(`[cleanup] ${alreadyGone} ramas ya no existen (skip)`);
  console.log(`[cleanup] ${toDelete.length} ramas pendientes de borrar\n`);

  if (toDelete.length === 0) {
    console.log('[cleanup] todo limpio.');
    return;
  }

  // 4. Listar y borrar (o reportar en dry-run).
  if (!apply) {
    console.log('[cleanup] DRY-RUN — ramas que SE borrarían:');
    for (const pr of toDelete) {
      console.log(`  - ${pr.headRefName}  (PR #${pr.number}, merged ${pr.mergedAt})`);
    }
    console.log(`\n[cleanup] re-ejecuta con --apply para borrar las ${toDelete.length} ramas.`);
    return;
  }

  console.log('[cleanup] APPLY — borrando ramas...');
  let deleted = 0;
  let failed = 0;
  for (const pr of toDelete) {
    try {
      gh([
        'api',
        '--method',
        'DELETE',
        `repos/${owner}/${repo}/git/refs/heads/${pr.headRefName}`,
        '--silent',
      ]);
      console.log(`  ✓ ${pr.headRefName}  (PR #${pr.number})`);
      deleted++;
    } catch (err) {
      console.error(`  ✗ ${pr.headRefName}  (PR #${pr.number}): ${err.message}`);
      failed++;
    }
  }

  console.log(`\n[cleanup] borradas: ${deleted}, fallidas: ${failed}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
