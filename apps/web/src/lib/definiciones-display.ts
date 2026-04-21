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
/**
 * Acorta nombres de archivos user-uploaded quitando timestamps verbosos y
 * la extension final. El nombre completo queda preservado en el markdown
 * del archivo (frontmatter + body con `# {docName}` + `Ubicacion en bucket`
 * + `Document ID`) — el display es solo una version compacta para UX.
 *
 * Ejemplos:
 *   "Captura de pantalla 2026-04-21 a las 2.18.26 a. m..png"
 *   -> "Captura de pantalla 2026-04-21"
 *
 *   "Reporte Q4 2024 final.pdf"
 *   -> "Reporte Q4 2024 final"
 *
 *   "screenshot (1).png"
 *   -> "screenshot (1)"
 */
function shortenUserUploadedName(baseName: string): string {
  let out = baseName;

  // 1. Strip timestamp pattern tipo " a las HH.MM.SS a. m." (lang: es).
  //    Cubre variantes: "a las 2:18", "a las 14.30", "a las 2.18.26 a. m.",
  //    "a las 2.18.26 p. m.". Regex greedy hasta fin de string.
  out = out.replace(/\s+a\s+las\s+.+$/i, '');

  // 2. Strip final extension tipo `.png`, `.pdf`, `.jpeg`. 2-4 chars
  //    para evitar false positives en dominios reales del nombre.
  out = out.replace(/\.[a-z0-9]{2,4}$/i, '');

  // 3. Trim puntos y espacios colgantes.
  out = out.replace(/\.+$/, '').trim();

  return out || baseName; // si quedo vacio por alguna razon, fallback al original
}

export function formatDisplayName(name: string, isFolder = true): string {
  if (!name) return name;
  const baseName = name.endsWith('.md') ? name.slice(0, -3) : name;

  // Heuristica: si el name contiene chars que un slug NO produciria
  // (espacios, puntos internos, mayusculas, underscores), es user-uploaded.
  const looksUserUploaded = /[\s._]/.test(baseName) || /[A-Z]/.test(baseName);
  if (looksUserUploaded) {
    // User-uploaded: acortar timestamps + extension para UX limpia.
    // La info completa sigue disponible en la metadata del archivo.
    return shortenUserUploadedName(baseName);
  }

  if (!isFolder) {
    // Archivos slug (tipo `definicion-negocio.md`, `index.md`): preservar
    // tambien — el `-` es semantico del filename, no ruido de dominio.
    return baseName;
  }

  // Folders con formato slug: quita shortId de 6 chars + guiones a espacios.
  let out = baseName.replace(SHORT_ID_SUFFIX, '');
  out = out.replace(/-/g, ' ');
  return out.trim();
}
