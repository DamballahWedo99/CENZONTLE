/**
 * Helpers para construir URLs de GitHub hacia el vault.
 *
 * El backend almacena `vaultPath` apuntando siempre al `index.md` del folder
 * de cada entidad (iniciativa, épica, historia). En la UI queremos mostrar el
 * folder completo, no el archivo index, para que el usuario vea la estructura
 * de archivos en GitHub.
 */

/**
 * Dada la ruta del vault de una entidad, devuelve el segmento de ruta que
 * se debe usar en el link de GitHub:
 *
 *   - Si termina en `/index.md` → devuelve el folder (quita `/index.md`)
 *     para que GitHub muestre el árbol del folder en lugar del archivo.
 *   - Si es cualquier otro `.md` (path legacy flat) → lo devuelve tal cual.
 *   - Si es `null` o `undefined` → devuelve `null`.
 *
 * El caller concatena este segmento a la base de GitHub:
 *   `https://github.com/<owner>/<repo>/tree/<branch>/<vaultLinkTarget(path)>`
 *
 * Se usa `tree/` en vez de `blob/` para las rutas de folder.
 */
export function vaultLinkTarget(vaultPath: string | null | undefined): string | null {
  if (!vaultPath) return null;
  if (vaultPath.endsWith('/index.md')) {
    return vaultPath.replace(/\/index\.md$/, '');
  }
  return vaultPath;
}

/**
 * Construye la URL completa de GitHub para un `vaultPath` dado.
 *
 * - Folders (`/index.md` stripped) → usa `tree/` para mostrar el árbol.
 * - Archivos `.md` planos (legacy) → usa `blob/` para ver el archivo.
 * - `vaultPath` nulo → devuelve `null`.
 *
 * @param vaultPath  - Path almacenado en PG (puede ser null).
 * @param owner      - Owner del repo de GitHub (ej. "mi-organizacion").
 * @param repo       - Nombre del repo vault (ej. "mi-vault").
 * @param branch     - Branch del vault (ej. "main").
 */
export function buildVaultGitHubUrl(
  vaultPath: string | null | undefined,
  owner: string,
  repo: string,
  branch = 'main',
): string | null {
  const target = vaultLinkTarget(vaultPath);
  if (!target) return null;
  // Folders (target no termina en .md) → `tree/`; archivos → `blob/`
  const mode = target.endsWith('.md') ? 'blob' : 'tree';
  return `https://github.com/${owner}/${repo}/${mode}/${branch}/${target}`;
}
