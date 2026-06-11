/**
 * Utilidades puras para leer/escribir el campo `tags` del frontmatter YAML
 * de documentos del vault, server-side.
 *
 * Espejo exacto de la lógica del frontend (DefinicionesContext.tsx:
 * splitFrontmatter / parseYamlFrontmatter / serializeTags /
 * updateFrontmatterTags) — el agente de conexiones debe producir el mismo
 * formato que el TagEditor de la UI para que ambos flujos sean
 * indistinguibles en el repo del vault.
 *
 * Solo soporta el formato flat que genera `buildFrontmatter()` y la UI:
 * `key: value` y arrays inline flow-style `[a, b, c]`. NO soporta objetos
 * anidados ni arrays block-style — ese formato no existe en el vault.
 */

/**
 * Separa el frontmatter YAML (delimitado por `---`) del body markdown.
 * Si no hay frontmatter válido al inicio, devuelve frontmatter null y el
 * contenido completo como body.
 *
 * Normaliza CRLF → LF antes de matchear: un archivo editado desde Windows
 * o la web UI de GitHub no debe perder sus tags porque el regex con `\n`
 * literal no matchee (la reescritura queda en LF, formato canónico del vault).
 */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: normalized };
  const frontmatter = match[0].replace(/\n?$/, '');
  const body = normalized.slice(match[0].length).replace(/^\n+/, '');
  return { frontmatter, body };
}

/** Re-adjunta el frontmatter al body (si existe), con línea en blanco entre ambos. */
export function joinFrontmatter(frontmatter: string | null, body: string): string {
  if (!frontmatter) return body;
  return `${frontmatter}\n\n${body}`;
}

/**
 * Extrae el array de tags de un frontmatter. Soporta los dos formatos que
 * pueden existir en el repo: inline flow-style `[a, b, c]` (lo que escriben
 * el backend y la UI) y block-style (`tags:` seguido de líneas `- item`,
 * típico de documentos editados con Obsidian o la web UI de GitHub).
 */
export function parseFrontmatterTags(frontmatter: string | null): string[] {
  if (!frontmatter) return [];
  const inner = frontmatter
    .replace(/\r\n/g, '\n')
    .replace(/^---\n?/, '')
    .replace(/\n?---\s*$/, '');
  const lines = inner.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('tags:')) continue;
    const rawValue = trimmed.slice('tags:'.length).trim();
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const body = rawValue.slice(1, -1).trim();
      if (body === '') return [];
      return body
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    if (rawValue === '') {
      // Block-style: consumir las líneas `- item` siguientes. Las líneas en
      // blanco intermedias son YAML válido y no terminan el array.
      const tags: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        const item = lines[j].match(/^\s*-\s+(.+)$/);
        if (!item) break;
        tags.push(item[1].trim().replace(/^["']|["']$/g, ''));
      }
      return tags.filter(Boolean);
    }
    // Valor escalar inesperado (`tags: foo`) — sin formato reconocible.
    return [];
  }
  return [];
}

/** Serializa un array de tags a flow-style YAML: `[pagos, checkout]` */
export function serializeTags(tags: string[]): string {
  if (tags.length === 0) return '[]';
  const escaped = tags.map((t) =>
    /[\s,[\]"':]/.test(t) ? `"${t.replace(/"/g, '\\"')}"` : t,
  );
  return `[${escaped.join(', ')}]`;
}

/**
 * Actualiza (o crea) el campo `tags` dentro de un frontmatter YAML.
 * - Sin frontmatter previo + tags → crea uno nuevo solo con tags
 * - Frontmatter con línea tags → la reemplaza in-place
 * - Frontmatter sin línea tags → la agrega al final
 * - tags vacío → elimina la línea; si el frontmatter queda sin campos,
 *   devuelve string vacío (sin bloque `---`)
 */
export function updateFrontmatterTags(frontmatter: string | null, tags: string[]): string {
  if (!frontmatter) {
    if (tags.length === 0) return '';
    return `---\ntags: ${serializeTags(tags)}\n---`;
  }

  const inner = frontmatter
    .replace(/\r\n/g, '\n')
    .replace(/^---\n?/, '')
    .replace(/\n?---\s*$/, '');
  const rawLines = inner.split('\n');
  const tagLineIdx = rawLines.findIndex((l) => l.trim().startsWith('tags:'));

  // Si la línea es block-style (`tags:` sin valor), los items `- x` de las
  // líneas siguientes pertenecen al array y deben reemplazarse junto con
  // ella — dejarlos colgando produciría YAML malformado. Las líneas en
  // blanco entre items son YAML válido: se saltan, pero el span a eliminar
  // solo llega hasta el ÚLTIMO item real (una blanca final no es del array).
  let blockSpan = 0;
  if (tagLineIdx !== -1 && rawLines[tagLineIdx].trim() === 'tags:') {
    let lastItemIdx = tagLineIdx;
    for (let j = tagLineIdx + 1; j < rawLines.length; j++) {
      if (rawLines[j].trim() === '') continue;
      if (!/^\s*-\s+/.test(rawLines[j])) break;
      lastItemIdx = j;
    }
    blockSpan = lastItemIdx - tagLineIdx;
  }

  const newTagLine = `tags: ${serializeTags(tags)}`;
  const lines = [...rawLines];
  if (tagLineIdx !== -1) {
    lines.splice(tagLineIdx, 1 + blockSpan, ...(tags.length > 0 ? [newTagLine] : []));
  } else if (tags.length > 0) {
    lines.push(newTagLine);
  }

  const cleaned = lines.filter((l) => l.trim() !== '');
  if (cleaned.length === 0) return '';
  return ['---', ...cleaned, '---'].join('\n');
}

/**
 * Normaliza un tag sugerido por el agente a kebab-case ASCII:
 * "Flujo de Pagos" → "flujo-de-pagos", "Autenticación" → "autenticacion".
 * Devuelve null si tras normalizar no queda un slug usable (2-40 chars).
 */
export function normalizeTag(raw: string): string | null {
  const slug = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length < 2 || slug.length > 40) return null;
  return slug;
}

/** Compara dos sets de tags sin importar orden ni duplicados. */
export function sameTagSet(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const t of setA) if (!setB.has(t)) return false;
  return true;
}

/** Primer heading `# ` del body, o el nombre de archivo sin extensión. */
export function extractTitle(body: string, fileName: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return fileName.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
}

/**
 * Excerpt compacto del body para el prompt del agente: colapsa líneas en
 * blanco repetidas y corta a `maxChars`. Conserva los headings — son la
 * señal semántica más densa para asignar tags.
 */
export function buildExcerpt(body: string, maxChars: number): string {
  const compact = body
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars)}…`;
}
