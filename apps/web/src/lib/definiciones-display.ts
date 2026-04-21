/**
 * Utilidades de presentacion para nombres de carpetas/archivos del Vault.
 *
 * Los nombres en GitHub siguen el formato `<slug>-<id6>` (ej. `terminal-
 * interactivo-de-factory-con-contexto-dinamico-de-ini-2d602c`) que es optimo
 * para storage (unicidad + URL-safe) pero ruidoso para UX.
 *
 * Esta capa transforma solo para DISPLAY. El `node.name` original se preserva
 * intacto — lo usamos para rename, delete, y todas las operaciones que tocan
 * el vault real.
 */

/**
 * Sufijo de shortId: guion + 6 chars alphanumericos al final. Coincide con
 * `slugifyWithId(name, id)` del backend que usa `id.slice(-6)`.
 *
 * NO toca archivos sin shortId (index.md, definicion.md, dependencias/, etc.)
 * ni nombres que por azar terminan en guion-6chars sin ser shortId real.
 */
const SHORT_ID_SUFFIX = /-[a-z0-9]{6}$/;

/**
 * Convierte un nombre de folder/archivo del vault a su forma legible.
 *
 * El comportamiento depende del tipo:
 *
 * **Folders** (`isFolder = true`): normalizacion agresiva para UX limpia —
 * quitar shortId de 6 chars del sufijo + convertir `-` en espacios.
 *   "terminal-interactivo-...-2d602c" -> "terminal interactivo ..."
 *   "prueba-fff7a4"                   -> "prueba"
 *   "epics"                           -> "epics"
 *
 * **Files** (`isFolder = false`): preservar el nombre tal cual para respetar
 * los caracteres especiales del archivo original (guiones, underscores,
 * puntos de extension, etc.). Solo se quita el `.md` trailing si existe.
 *   "definicion-negocio.md"                          -> "definicion-negocio"
 *   "captura-de-pantalla-2026-04-21-a-m-png.md"      -> "captura-de-pantalla-2026-04-21-a-m-png"
 *   "Captura de pantalla 2026_04_21.png"             -> "Captura de pantalla 2026_04_21.png"
 *
 * Razon del split: los folders son semantica de dominio (ID con slug) donde
 * queremos presentarlos limpios. Los archivos son data cruda del usuario o
 * del agente donde cada caracter importa (especialmente para identificar
 * versiones, timestamps, extensions).
 */
export function formatDisplayName(name: string, isFolder = true): string {
  if (!name) return name;

  if (!isFolder) {
    // Archivos: solo quita `.md` trailing, preserva todo lo demas.
    return name.endsWith('.md') ? name.slice(0, -3) : name;
  }

  // Folders: normalizacion completa.
  let out = name.endsWith('.md') ? name.slice(0, -3) : name;
  out = out.replace(SHORT_ID_SUFFIX, '');
  out = out.replace(/-/g, ' ');
  return out.trim();
}
