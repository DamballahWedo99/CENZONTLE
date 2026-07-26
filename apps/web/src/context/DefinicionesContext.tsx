'use client';

import React, { createContext, useContext, useReducer, useState, useMemo, useCallback, useRef, useEffect, ReactNode } from 'react';
import { DefinicionNode } from '@/types/definiciones';
import { useAuthContext } from '@/context/AuthContext';
import {
  AccessLevel,
  AccessControlEntry,
  NodeAccessConfig,
  ACCESS_LEVEL_HIERARCHY,
  DEFAULT_ROLE_ACCESS,
  PrincipalType,
  UserRole,
} from '@cenzontle/shared';
import {
  getVaultTree,
  getVaultFile,
  writeVaultFile,
  deleteVaultFile,
  getVaultChangelog,
  getAllVaultTags,
  type VaultTreeNode,
  type VaultCommit,
} from '@/lib/api/vault';
import {
  getAccessibleVaultConfigs,
  activateVaultConfig,
  type VaultConfig as VaultConfigApi,
} from '@/lib/api/vault-configs';
import { toast } from 'sonner';

/**
 * Folder raíz del vault. Vacío = raíz del repo completo (comportamiento tipo Obsidian:
 * el dashboard muestra TODOS los folders del vault, no un sub-folder específico).
 *
 * Con `VAULT_ROOT = ''` el dashboard de Definiciones sirve como browser completo del
 * vault ecommerce: adrs/, definitions/, epics/, initiatives/, qa-matrices/, research/, stories/.
 *
 * Caveat: si editas un `.md` dentro de `epics/` o `stories/` desde este dashboard, estás
 * editando el mismo archivo que el backend escribe/lee vía parseEpicMarkdown. Si rompes
 * el formato de headings esperado (`## Descripción`, `## Criterios de aceptación`, etc.),
 * la vista estructurada de esas entidades puede parsear mal los campos. Los folders de
 * "contenido libre" (definitions/, adrs/, research/, qa-matrices/) no tienen esa restricción.
 */
const VAULT_ROOT = '';

export type SortOption = 'name-asc' | 'name-desc' | 'created-newest' | 'created-oldest' | 'updated-newest' | 'updated-oldest';

export type ChangelogAction = 'create' | 'edit' | 'delete' | 'rename' | 'move' | 'tags' | 'reorder' | 'access';

export interface ChangelogEntry {
  id: string;
  timestamp: string;
  action: ChangelogAction;
  nodeId: string;
  nodeName: string;
  nodeType: 'folder' | 'document';
  userId?: string;
  userName?: string;
  details?: {
    oldName?: string;
    newName?: string;
    parentName?: string;
    addedTags?: string[];
    removedTags?: string[];
    contentPreview?: string;
    previousContent?: string;
    newContent?: string;
    accessChange?: {
      principalName: string;
      principalType: PrincipalType;
      oldLevel?: AccessLevel;
      newLevel?: AccessLevel;
    };
  };
}

interface DefinicionesState {
  tree: DefinicionNode[];
  selectedId: string | null;
  expandedFolders: Set<string>;
  searchQuery: string;
  isEditing: boolean;
  sortBy: SortOption;
  changelog: ChangelogEntry[];
  accessConfig: Record<string, NodeAccessConfig>;
  roleDefaults: Record<UserRole, AccessLevel>;
  loading: boolean;
  error: string | null;
}

type DefinicionesAction =
  | { type: 'LOAD_TREE_START' }
  | { type: 'LOAD_TREE_SUCCESS'; tree: DefinicionNode[] }
  | { type: 'LOAD_CHANGELOG'; entries: ChangelogEntry[] }
  | { type: 'LOAD_ACCESS_CONFIG'; accessConfig: Record<string, NodeAccessConfig> }
  | { type: 'LOAD_TREE_ERROR'; error: string }
  | { type: 'SET_NODE_CONTENT'; id: string; content: string; metadata?: Record<string, string>; tags?: string[]; updatedAt?: string }
  | { type: 'SELECT_NODE'; id: string | null }
  | { type: 'TOGGLE_FOLDER'; id: string }
  | { type: 'EXPAND_FOLDER'; id: string }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'TOGGLE_EDITING' }
  | { type: 'UPDATE_CONTENT'; id: string; content: string; previousContent?: string }
  | { type: 'ADD_FOLDER'; parentId: string | null; name: string; node: DefinicionNode }
  | { type: 'ADD_DOCUMENT'; parentId: string; name: string; node: DefinicionNode }
  | { type: 'RENAME_NODE'; id: string; name: string }
  | { type: 'UPDATE_TAGS'; id: string; tags: string[] }
  | { type: 'DELETE_NODE'; id: string }
  | { type: 'SET_SORT'; sortBy: SortOption }
  | { type: 'EXPAND_ALL' }
  | { type: 'COLLAPSE_ALL' }
  | { type: 'SET_INHERITANCE'; nodeId: string; inherit: boolean }
  | { type: 'ADD_ACCESS'; entry: AccessControlEntry }
  | { type: 'UPDATE_ACCESS'; entryId: string; nodeId: string; accessLevel: AccessLevel }
  | { type: 'REMOVE_ACCESS'; entryId: string; nodeId: string }
  | { type: 'SET_ROLE_DEFAULT'; role: UserRole; level: AccessLevel };

// === Error helpers ===

/**
 * Extrae el `message` de un valor lanzado, que en un `catch` es `unknown`.
 *
 * Los rechazos que llegan a los catch de este archivo vienen de `apiFetch`,
 * que lanza `ApiError extends Error` para respuestas no-2xx y re-lanza el
 * `TypeError` nativo de `fetch` en fallos de red. La rama de objeto duck-typed
 * cubre el resto de valores para que el resultado sea idéntico al de un
 * acceso opcional `err?.message`.
 *
 * Devuelve `undefined` cuando no hay mensaje, para que cada call site elija
 * su propio fallback con `??` o `||` según corresponda.
 */
function errorMessageOf(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return undefined;
}

// === Tree helpers ===

function collectAllNodeIds(nodes: DefinicionNode[]): string[] {
  return nodes.flatMap(n => [n.id, ...(n.children ? collectAllNodeIds(n.children) : [])]);
}

function collectAllFolderIds(nodes: DefinicionNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      ids.push(node.id);
      if (node.children) {
        ids.push(...collectAllFolderIds(node.children));
      }
    }
  }
  return ids;
}

function findNodeById(nodes: DefinicionNode[], id: string): DefinicionNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Devuelve los ids de todos los folders ancestors de un nodo dado.
 * Ejemplo: para un doc en `root/carpeta-A/carpeta-B/doc.md`, retorna
 * [rootId, carpetaAId, carpetaBId] — todos los folders que hay que expandir
 * para que el nodo sea visible en el tree.
 *
 * Si el nodo no existe, retorna []. Si el nodo es root (sin padre), retorna [].
 */
function findAncestorIds(nodes: DefinicionNode[], targetId: string): string[] {
  const walk = (list: DefinicionNode[], trail: string[]): string[] | null => {
    for (const node of list) {
      if (node.id === targetId) return trail;
      if (node.type === 'folder' && node.children) {
        const found = walk(node.children, [...trail, node.id]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

function updateNodeInTree(nodes: DefinicionNode[], id: string, updater: (node: DefinicionNode) => DefinicionNode): DefinicionNode[] {
  return nodes.map(node => {
    if (node.id === id) return updater(node);
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, id, updater) };
    }
    return node;
  });
}

function findParentId(nodes: DefinicionNode[], targetId: string, currentParent: string | null = null): string | null | undefined {
  for (const node of nodes) {
    if (node.id === targetId) return currentParent;
    if (node.children) {
      const found = findParentId(node.children, targetId, node.id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function addNodeToTree(nodes: DefinicionNode[], parentId: string | null, newNode: DefinicionNode): DefinicionNode[] {
  if (parentId === null) return [...nodes, newNode];
  return nodes.map(node => {
    if (node.id === parentId && node.type === 'folder') {
      return { ...node, children: [...(node.children || []), newNode], updatedAt: new Date().toISOString() };
    }
    if (node.children) {
      return { ...node, children: addNodeToTree(node.children, parentId, newNode) };
    }
    return node;
  });
}

function deleteNodeFromTree(nodes: DefinicionNode[], id: string): DefinicionNode[] {
  return nodes
    .filter(node => node.id !== id)
    .map(node => {
      if (node.children) {
        return { ...node, children: deleteNodeFromTree(node.children, id) };
      }
      return node;
    });
}

function sortTree(nodes: DefinicionNode[], sortBy: SortOption): DefinicionNode[] {
  const sorted = [...nodes].sort((a, b) => {
    switch (sortBy) {
      case 'name-asc': return a.name.localeCompare(b.name, 'es');
      case 'name-desc': return b.name.localeCompare(a.name, 'es');
      case 'created-newest': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'created-oldest': return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'updated-newest': return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      case 'updated-oldest': return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      default: return 0;
    }
  });
  return sorted.map(node =>
    node.children ? { ...node, children: sortTree(node.children, sortBy) } : node,
  );
}

function filterTree(nodes: DefinicionNode[], query: string): DefinicionNode[] {
  if (!query.trim()) return nodes;
  const lower = query.toLowerCase();
  return nodes.reduce<DefinicionNode[]>((acc, node) => {
    const nameMatch = node.name.toLowerCase().includes(lower);
    const tagMatch = node.tags?.some(t => t.toLowerCase().includes(lower));
    const contentMatch = node.content?.toLowerCase().includes(lower);

    if (nameMatch || tagMatch || contentMatch) {
      acc.push(node);
    } else if (node.type === 'folder' && node.children) {
      const filteredChildren = filterTree(node.children, query);
      if (filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren });
      }
    }
    return acc;
  }, []);
}

/**
 * Recolecta IDs de TODOS los folders que o bien matchean la busqueda
 * directamente o bien contienen un descendiente que matchea. Se usa para
 * auto-expandir el tree del EXPLORADOR cuando el user tipea una busqueda —
 * asi se ven los resultados anidados sin tener que abrir manualmente.
 */
function collectFolderIdsWithMatches(nodes: DefinicionNode[], query: string): Set<string> {
  const out = new Set<string>();
  if (!query.trim()) return out;
  const lower = query.toLowerCase();

  const walk = (list: DefinicionNode[]): boolean => {
    let anyMatch = false;
    for (const node of list) {
      const nameMatch = node.name.toLowerCase().includes(lower);
      const tagMatch = node.tags?.some(t => t.toLowerCase().includes(lower)) ?? false;
      const contentMatch = node.content?.toLowerCase().includes(lower) ?? false;
      const selfMatch = nameMatch || tagMatch || contentMatch;
      let descendantMatch = false;
      if (node.type === 'folder' && node.children) {
        descendantMatch = walk(node.children);
      }
      if (node.type === 'folder' && (selfMatch || descendantMatch)) {
        out.add(node.id);
      }
      if (selfMatch || descendantMatch) anyMatch = true;
    }
    return anyMatch;
  };

  walk(nodes);
  return out;
}

// === Vault mapping ===

/**
 * Regex que detecta el prefijo UUID v4 que el backend agrega a los filenames
 * de épicas, historias e iniciativas (ej: `420e7507-e650-4489-80ce-fdef119f1354-motores-antifraude.md`).
 * Si un archivo tiene ese prefijo, lo removemos para el display name — el ID del nodo
 * (path completo) sigue intacto porque es la identidad real del recurso en el vault.
 */
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/**
 * Convierte un filename del vault en un nombre legible para la UI:
 * 1. Remueve extensión `.md`
 * 2. Strip UUID prefix si existe
 * 3. Reemplaza guiones por espacios (preservando guiones entre dígitos) y
 *    capitaliza primera letra (un-slugify)
 *
 * El lookbehind/lookahead `(?<!\d)-(?!\d)` preserva guiones que estan entre
 * dos digitos — esto es critico para archivos user-uploaded con timestamps
 * tipo `2026-04-21` o versiones tipo `v1-2-3`. Sin este guard, fechas como
 * `2026-04-21` se transforman a `2026 04 21` y pierden su semantica.
 */
function humanizeFilename(filename: string): string {
  const withoutExt = filename.replace(/\.md$/i, '');
  const withoutUuid = withoutExt.replace(UUID_PREFIX_RE, '');
  const humanized = withoutUuid.replace(/(?<!\d)-(?!\d)/g, ' ').trim();
  if (!humanized) return withoutUuid || withoutExt;
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

/**
 * Convierte un VaultTreeNode (path crudo del backend) en un DefinicionNode.
 * El ID del nodo es el path completo en el vault (ej. "definitions/finanzas/ebit.md").
 *
 * Filtrado:
 * - `.gitkeep` se omite (marcador para folders vacíos, no debe aparecer en UI)
 * - Archivos ocultos (empiezan con `.`) se omiten
 * - Archivos texto soportados se MUESTRAN: markdown + assets de bundles de
 *   diseño (HTML, CSS, JS, JSON, SVG, TXT, YAML, XML). Antes solo
 *   mostrábamos `.md`, lo que ocultaba los archivos descomprimidos de
 *   bundles de Claude Design — el user veía las carpetas `project/` vacías
 *   aunque los HTMLs sí estaban commiteados al repo.
 * - Otros archivos (binarios, extensiones desconocidas) se ocultan.
 * - Folders vacíos se conservan (sin children después del filtrado).
 */
const SHOWN_FILE_EXTENSIONS = [
  '.md', '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx',
  '.json', '.txt', '.svg', '.xml', '.yaml', '.yml',
];

function vaultTreeToDefinicionNodes(vaultNodes: VaultTreeNode[]): DefinicionNode[] {
  const out: DefinicionNode[] = [];
  const now = new Date().toISOString();

  for (const v of vaultNodes) {
    // Ocultar archivos/folders ocultos (empiezan con .)
    if (v.name.startsWith('.')) continue;
    if (v.type === 'file') {
      const lowerName = v.name.toLowerCase();
      const hasShownExt = SHOWN_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
      if (!hasShownExt) continue;
    }

    const displayName = v.type === 'file' ? humanizeFilename(v.name) : v.name;

    const children = v.children ? vaultTreeToDefinicionNodes(v.children) : undefined;

    // Si un folder queda sin hijos válidos después del filtrado, lo conservamos
    // vacío (puede ser un folder "en progreso" con solo un .gitkeep)
    out.push({
      id: v.path,
      name: displayName,
      type: v.type === 'folder' ? 'folder' : 'document',
      tags: [],
      createdAt: now,
      updatedAt: now,
      ...(v.type === 'folder' ? { children: children ?? [] } : {}),
    });
  }

  return out;
}

/**
 * Aplica el mapa path → tags (de GET /vault/tags) al árbol recién mapeado.
 * El id de cada DefinicionNode ES su path en el vault, así que el lookup
 * es directo. Solo documentos — los folders no tienen frontmatter.
 */
function applyVaultTags(nodes: DefinicionNode[], tagsByPath: Record<string, string[]>): DefinicionNode[] {
  return nodes.map((n) => ({
    ...n,
    ...(n.type === 'document' && tagsByPath[n.id] ? { tags: tagsByPath[n.id] } : {}),
    ...(n.children ? { children: applyVaultTags(n.children, tagsByPath) } : {}),
  }));
}

/** Deriva el path vault completo para un nodo nuevo dentro de un parent. */
function buildChildPath(parentPath: string | null, childName: string, type: 'folder' | 'document'): string {
  const leaf = type === 'document' ? `${childName}.md` : childName;
  // Si estamos en la raíz del vault (parentPath null y VAULT_ROOT vacío),
  // el path es solo el leaf — sin leading slash (el backend rechaza paths con /).
  if (parentPath === null) {
    return VAULT_ROOT ? `${VAULT_ROOT}/${leaf}` : leaf;
  }
  return `${parentPath}/${leaf}`;
}

/** Slugify simple para filenames — mantiene letras, números y guiones. */
function slugifyFilename(name: string): string {
  return name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
}

/**
 * Separa un documento markdown en su frontmatter YAML y su body.
 * El frontmatter son las líneas entre el primer par de `---` al inicio del archivo.
 * Si no hay frontmatter, `frontmatter` es null y `body` es el contenido completo.
 *
 * Ejemplo:
 *   ---
 *   id: abc
 *   type: epic
 *   ---
 *
 *   # Title
 *   ...
 *
 * → { frontmatter: "---\nid: abc\ntype: epic\n---", body: "\n# Title\n..." }
 */
function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  // Debe empezar con `---\n` y tener un cierre `\n---\n` (o `\n---` al final)
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: content };
  const frontmatter = match[0].replace(/\n?$/, '');
  const body = content.slice(match[0].length).replace(/^\n+/, '');
  return { frontmatter, body };
}

/** Re-adjunta el frontmatter original al body editado (si existía). */
function joinFrontmatter(frontmatter: string | null, body: string): string {
  if (!frontmatter) return body;
  // Aseguramos newline entre frontmatter y body
  return `${frontmatter}\n\n${body}`;
}

/**
 * Parser de frontmatter YAML flat. Soporta:
 * - `key: value` → string
 * - `key: [a, b, c]` → array (inline flow syntax)
 * - `key: []` → array vacío
 *
 * NO soporta: objetos anidados, valores multilínea, arrays block-style (- item).
 * Cubre el 100% del formato que genera el backend y lo que la UI escribe para tags.
 */
function parseYamlFrontmatter(yaml: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const stripped = yaml.replace(/^---\n?/, '').replace(/\n?---\s*$/, '');
  const lines = stripped.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    // Detectar array inline: [a, b, c] o []
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      if (inner === '') {
        result[key] = [];
      } else {
        result[key] = inner
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      }
    } else {
      result[key] = rawValue;
    }
  }
  return result;
}

/** Serializa un array de tags a flow-style YAML: `[pagos, checkout]` */
function serializeTags(tags: string[]): string {
  if (tags.length === 0) return '[]';
  const escaped = tags.map((t) =>
    /[\s,\[\]"':]/.test(t) ? `"${t.replace(/"/g, '\\"')}"` : t,
  );
  return `[${escaped.join(', ')}]`;
}

/**
 * Actualiza (o crea) el campo `tags` dentro de un frontmatter YAML.
 * - Si el frontmatter es null y hay tags → crea un frontmatter nuevo con solo tags
 * - Si el frontmatter existe y ya tiene tags → reemplaza esa línea
 * - Si el frontmatter existe pero no tiene tags → agrega la línea
 * - Si tags es vacío y había una línea tags → la elimina
 * - Si el resultado es un frontmatter sin ningún campo → devuelve string vacío
 */
function updateFrontmatterTags(frontmatter: string | null, tags: string[]): string {
  // No hay frontmatter previo
  if (!frontmatter) {
    if (tags.length === 0) return '';
    return `---\ntags: ${serializeTags(tags)}\n---`;
  }

  const inner = frontmatter.replace(/^---\n?/, '').replace(/\n?---\s*$/, '');
  const lines = inner.split('\n').filter((l) => l.trim() !== '');
  const tagLineIdx = lines.findIndex((l) => l.trim().startsWith('tags:'));
  const newTagLine = `tags: ${serializeTags(tags)}`;

  if (tags.length === 0) {
    if (tagLineIdx !== -1) lines.splice(tagLineIdx, 1);
  } else if (tagLineIdx !== -1) {
    lines[tagLineIdx] = newTagLine;
  } else {
    lines.push(newTagLine);
  }

  // Si quedó sin campos, devolver vacío
  if (lines.length === 0) return '';
  return ['---', ...lines, '---'].join('\n');
}

// === Access control helpers ===

export interface EffectiveAccess {
  level: AccessLevel;
  source: 'direct' | 'role' | 'inherited';
  sourceNodeId?: string;
}

export function getEffectiveAccess(
  userId: string,
  userRole: UserRole,
  nodeId: string,
  fullTree: DefinicionNode[],
  accessConfig: Record<string, NodeAccessConfig>,
  roleDefaults: Record<UserRole, AccessLevel> = DEFAULT_ROLE_ACCESS,
): EffectiveAccess {
  const config = accessConfig[nodeId];

  if (config) {
    const userEntry = config.entries.find(e => e.principalType === 'user' && e.principalId === userId);
    if (userEntry) return { level: userEntry.accessLevel, source: 'direct' };

    const roleEntry = config.entries.find(e => e.principalType === 'role' && e.principalId === userRole);
    if (roleEntry) return { level: roleEntry.accessLevel, source: 'role' };

    if (config.inheritFromParent) {
      const parentId = findParentId(fullTree, nodeId);
      if (parentId) {
        const parentAccess = getEffectiveAccess(userId, userRole, parentId, fullTree, accessConfig, roleDefaults);
        return { ...parentAccess, source: 'inherited', sourceNodeId: parentAccess.sourceNodeId ?? parentId };
      }
      return { level: roleDefaults[userRole], source: 'role' };
    }

    // Herencia OFF + sin entries explícitas → fallback a roleDefaults del vault.
    // Sin esto, el nodo queda inaccesible para todos (incluso admin) al desactivar herencia.
    return { level: roleDefaults[userRole] ?? 'none', source: 'role' };
  }

  const parentId = findParentId(fullTree, nodeId);
  if (parentId) {
    const parentAccess = getEffectiveAccess(userId, userRole, parentId, fullTree, accessConfig, roleDefaults);
    return { ...parentAccess, source: 'inherited', sourceNodeId: parentAccess.sourceNodeId ?? parentId };
  }
  return { level: roleDefaults[userRole], source: 'role' };
}

export function getParentEffectiveLevel(
  nodeId: string,
  userId: string,
  userRole: UserRole,
  fullTree: DefinicionNode[],
  accessConfig: Record<string, NodeAccessConfig>,
  roleDefaults: Record<UserRole, AccessLevel> = DEFAULT_ROLE_ACCESS,
): AccessLevel {
  const parentId = findParentId(fullTree, nodeId);
  if (!parentId) return 'owner';
  return getEffectiveAccess(userId, userRole, parentId, fullTree, accessConfig, roleDefaults).level;
}

function filterTreeByAccess(
  nodes: DefinicionNode[],
  userId: string,
  userRole: UserRole,
  fullTree: DefinicionNode[],
  accessConfig: Record<string, NodeAccessConfig>,
  roleDefaults: Record<UserRole, AccessLevel>,
): DefinicionNode[] {
  return nodes.reduce<DefinicionNode[]>((acc, node) => {
    const access = getEffectiveAccess(userId, userRole, node.id, fullTree, accessConfig, roleDefaults);
    if (access.level === 'none') return acc;

    if (node.type === 'folder' && node.children) {
      const filteredChildren = filterTreeByAccess(node.children, userId, userRole, fullTree, accessConfig, roleDefaults);
      acc.push({ ...node, children: filteredChildren });
    } else {
      acc.push(node);
    }
    return acc;
  }, []);
}

// === Changelog helpers ===

function logEntry(action: ChangelogAction, nodeId: string, nodeName: string, nodeType: 'folder' | 'document', details?: ChangelogEntry['details']): ChangelogEntry {
  return { id: crypto.randomUUID(), timestamp: new Date().toISOString(), action, nodeId, nodeName, nodeType, details };
}

function addToChangelog(changelog: ChangelogEntry[], entry: ChangelogEntry): ChangelogEntry[] {
  const latest = changelog[0];
  if (latest && latest.action === entry.action && latest.nodeId === entry.nodeId) {
    const diff = new Date(entry.timestamp).getTime() - new Date(latest.timestamp).getTime();
    if (diff < 2000) return changelog;
  }
  return [entry, ...changelog];
}

// === State & Reducer ===

const initialState: DefinicionesState = {
  tree: [],
  selectedId: null,
  expandedFolders: new Set<string>(),
  roleDefaults: { ...DEFAULT_ROLE_ACCESS },
  searchQuery: '',
  isEditing: false,
  sortBy: 'name-asc' as SortOption,
  changelog: [],
  accessConfig: {},
  loading: true,
  error: null,
};

function reducer(state: DefinicionesState, action: DefinicionesAction): DefinicionesState {
  switch (action.type) {
    case 'LOAD_TREE_START':
      return { ...state, loading: true, error: null };

    case 'LOAD_TREE_SUCCESS':
      return { ...state, tree: action.tree, loading: false, error: null };

    case 'LOAD_TREE_ERROR':
      return { ...state, loading: false, error: action.error };

    case 'LOAD_ACCESS_CONFIG':
      return { ...state, accessConfig: action.accessConfig };

    case 'LOAD_CHANGELOG':
      // Replace completo — cada vault tiene su propio git history.
      // Las entradas locales de la sesión (create/edit/delete) se pierden al cambiar
      // de vault, pero se reemplazan con el historial real de commits del nuevo vault.
      return { ...state, changelog: action.entries };

    case 'SET_NODE_CONTENT':
      return {
        ...state,
        tree: updateNodeInTree(state.tree, action.id, node => ({
          ...node,
          content: action.content,
          // Solo actualizar si viene en la action (no pisar con undefined)
          ...(action.metadata !== undefined ? { metadata: action.metadata } : {}),
          ...(action.tags !== undefined ? { tags: action.tags } : {}),
          ...(action.updatedAt ? { updatedAt: action.updatedAt } : {}),
        })),
      };

    case 'SELECT_NODE': {
      // Al seleccionar un nodo (desde cualquier fuente — click en tree,
      // click en content area card, link de graph/changelog), auto-expandimos
      // solo sus ANCESTORS para que el nodo sea visible en el tree.
      //
      // IMPORTANTE: NO expandimos el folder seleccionado mismo — si lo
      // hicieramos, el flujo `toggleFolder(id) + selectNode(id)` del click
      // en tree se anularia (toggle colapsa, select re-expande). El user
      // puede hacer click en el chevron / carpeta misma para controlar la
      // expansion del nodo; este reducer solo revela la ruta hasta el.
      if (action.id === null) {
        return { ...state, selectedId: null, isEditing: false };
      }
      const ancestors = findAncestorIds(state.tree, action.id);
      const nextExpanded = new Set(state.expandedFolders);
      for (const ancestorId of ancestors) nextExpanded.add(ancestorId);
      return {
        ...state,
        selectedId: action.id,
        isEditing: false,
        expandedFolders: nextExpanded,
      };
    }

    case 'TOGGLE_FOLDER': {
      const next = new Set(state.expandedFolders);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, expandedFolders: next };
    }

    case 'EXPAND_FOLDER': {
      const next = new Set(state.expandedFolders);
      next.add(action.id);
      return { ...state, expandedFolders: next };
    }

    case 'SET_SEARCH': {
      // Cuando el user escribe una busqueda, auto-expandir todos los folders
      // que contienen matches (directos o descendientes). Asi el tree del
      // EXPLORADOR revela los resultados anidados sin que el user tenga que
      // expandir manualmente. Cuando se limpia la busqueda, dejamos los
      // folders expandidos como estaban — no colapsamos para no sorprender
      // al user que quiza ya navego a uno de esos nodos.
      if (!action.query.trim()) {
        return { ...state, searchQuery: action.query };
      }
      const matchFolders = collectFolderIdsWithMatches(state.tree, action.query);
      if (matchFolders.size === 0) {
        return { ...state, searchQuery: action.query };
      }
      const nextExpanded = new Set(state.expandedFolders);
      matchFolders.forEach(id => nextExpanded.add(id));
      return { ...state, searchQuery: action.query, expandedFolders: nextExpanded };
    }

    case 'TOGGLE_EDITING':
      return { ...state, isEditing: !state.isEditing };

    case 'UPDATE_CONTENT': {
      const contentNode = findNodeById(state.tree, action.id);
      const prevContent = action.previousContent ?? contentNode?.content ?? '';
      const contentChanged = prevContent.trim() !== action.content.trim();
      return {
        ...state,
        tree: updateNodeInTree(state.tree, action.id, node => ({
          ...node,
          content: action.content,
          updatedAt: new Date().toISOString(),
        })),
        changelog: contentChanged
          ? addToChangelog(state.changelog, logEntry('edit', action.id, contentNode?.name ?? '', contentNode?.type ?? 'document', {
              contentPreview: action.content.slice(0, 80).replace(/\n/g, ' '),
              previousContent: prevContent,
              newContent: action.content,
            }))
          : state.changelog,
      };
    }

    case 'ADD_FOLDER': {
      const next = new Set(state.expandedFolders);
      if (action.parentId) next.add(action.parentId);
      const parentFolder = action.parentId ? findNodeById(state.tree, action.parentId) : null;
      return {
        ...state,
        tree: addNodeToTree(state.tree, action.parentId, action.node),
        expandedFolders: next,
        changelog: addToChangelog(state.changelog, logEntry('create', action.node.id, action.name, 'folder', {
          parentName: parentFolder?.name ?? 'raíz',
        })),
      };
    }

    case 'ADD_DOCUMENT': {
      const next = new Set(state.expandedFolders);
      next.add(action.parentId);
      const docParent = findNodeById(state.tree, action.parentId);
      return {
        ...state,
        tree: addNodeToTree(state.tree, action.parentId, action.node),
        selectedId: action.node.id,
        expandedFolders: next,
        isEditing: true,
        changelog: addToChangelog(state.changelog, logEntry('create', action.node.id, action.name, 'document', {
          parentName: docParent?.name ?? 'raíz',
          newContent: action.node.content,
        })),
      };
    }

    case 'UPDATE_TAGS': {
      const tagNode = findNodeById(state.tree, action.id);
      const oldTags = tagNode?.tags ?? [];
      const added = action.tags.filter(t => !oldTags.includes(t));
      const removed = oldTags.filter(t => !action.tags.includes(t));
      return {
        ...state,
        tree: updateNodeInTree(state.tree, action.id, node => ({
          ...node,
          tags: action.tags,
          updatedAt: new Date().toISOString(),
        })),
        changelog: (added.length > 0 || removed.length > 0) ? addToChangelog(state.changelog, logEntry('tags', action.id, tagNode?.name ?? '', tagNode?.type ?? 'document', {
          addedTags: added.length > 0 ? added : undefined,
          removedTags: removed.length > 0 ? removed : undefined,
        })) : state.changelog,
      };
    }

    case 'RENAME_NODE': {
      const renNode = findNodeById(state.tree, action.id);
      return {
        ...state,
        tree: updateNodeInTree(state.tree, action.id, node => ({
          ...node,
          name: action.name,
          updatedAt: new Date().toISOString(),
        })),
        changelog: addToChangelog(state.changelog, logEntry('rename', action.id, action.name, renNode?.type ?? 'document', {
          oldName: renNode?.name,
          newName: action.name,
        })),
      };
    }

    case 'DELETE_NODE': {
      const delNode = findNodeById(state.tree, action.id);
      const idsToRemove = new Set(delNode ? collectAllNodeIds([delNode]) : [action.id]);
      const cleanedAccess = Object.fromEntries(
        Object.entries(state.accessConfig).filter(([k]) => !idsToRemove.has(k)),
      );
      return {
        ...state,
        tree: deleteNodeFromTree(state.tree, action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        accessConfig: cleanedAccess,
        changelog: addToChangelog(state.changelog, logEntry('delete', action.id, delNode?.name ?? '', delNode?.type ?? 'document', {
          previousContent: delNode?.content,
        })),
      };
    }

    case 'SET_SORT':
      return { ...state, sortBy: action.sortBy };

    case 'EXPAND_ALL':
      return { ...state, expandedFolders: new Set(collectAllFolderIds(state.tree)) };

    case 'COLLAPSE_ALL':
      return { ...state, expandedFolders: new Set() };

    case 'SET_INHERITANCE': {
      const inheritNode = findNodeById(state.tree, action.nodeId);
      const defaultCfg: NodeAccessConfig = { nodeId: action.nodeId, inheritFromParent: true, entries: [] };
      const existing = state.accessConfig[action.nodeId] ?? defaultCfg;
      return {
        ...state,
        accessConfig: {
          ...state.accessConfig,
          [action.nodeId]: { ...existing, inheritFromParent: action.inherit },
        },
        changelog: addToChangelog(state.changelog, logEntry('access', action.nodeId, inheritNode?.name ?? '', inheritNode?.type ?? 'folder', {
          accessChange: {
            principalName: action.inherit ? 'Herencia activada' : 'Herencia desactivada',
            principalType: 'role',
          },
        })),
      };
    }

    case 'ADD_ACCESS': {
      const accessNode = findNodeById(state.tree, action.entry.nodeId);
      const defaultCfg: NodeAccessConfig = { nodeId: action.entry.nodeId, inheritFromParent: true, entries: [] };
      const existing = state.accessConfig[action.entry.nodeId] ?? defaultCfg;
      return {
        ...state,
        accessConfig: {
          ...state.accessConfig,
          [action.entry.nodeId]: {
            ...existing,
            entries: [...existing.entries, action.entry],
          },
        },
        changelog: addToChangelog(state.changelog, logEntry('access', action.entry.nodeId, accessNode?.name ?? '', accessNode?.type ?? 'folder', {
          accessChange: {
            principalName: action.entry.principalId,
            principalType: action.entry.principalType,
            newLevel: action.entry.accessLevel,
          },
        })),
      };
    }

    case 'UPDATE_ACCESS': {
      const updateAccessNode = findNodeById(state.tree, action.nodeId);
      const existingConfig = state.accessConfig[action.nodeId];
      if (!existingConfig) return state;
      const oldEntry = existingConfig.entries.find(e => e.id === action.entryId);
      return {
        ...state,
        accessConfig: {
          ...state.accessConfig,
          [action.nodeId]: {
            ...existingConfig,
            entries: existingConfig.entries.map(e =>
              e.id === action.entryId ? { ...e, accessLevel: action.accessLevel } : e,
            ),
          },
        },
        changelog: addToChangelog(state.changelog, logEntry('access', action.nodeId, updateAccessNode?.name ?? '', updateAccessNode?.type ?? 'folder', {
          accessChange: {
            principalName: oldEntry?.principalId ?? '',
            principalType: oldEntry?.principalType ?? 'role',
            oldLevel: oldEntry?.accessLevel,
            newLevel: action.accessLevel,
          },
        })),
      };
    }

    case 'REMOVE_ACCESS': {
      const removeNode = findNodeById(state.tree, action.nodeId);
      const removeConfig = state.accessConfig[action.nodeId];
      if (!removeConfig) return state;
      const removedEntry = removeConfig.entries.find(e => e.id === action.entryId);
      return {
        ...state,
        accessConfig: {
          ...state.accessConfig,
          [action.nodeId]: {
            ...removeConfig,
            entries: removeConfig.entries.filter(e => e.id !== action.entryId),
          },
        },
        changelog: addToChangelog(state.changelog, logEntry('access', action.nodeId, removeNode?.name ?? '', removeNode?.type ?? 'folder', {
          accessChange: {
            principalName: removedEntry?.principalId ?? '',
            principalType: removedEntry?.principalType ?? 'role',
            oldLevel: removedEntry?.accessLevel,
          },
        })),
      };
    }

    case 'SET_ROLE_DEFAULT':
      return {
        ...state,
        roleDefaults: { ...state.roleDefaults, [action.role]: action.level },
      };

    default:
      return state;
  }
}

// === Context ===

interface DefinicionesContextValue {
  state: DefinicionesState;
  selectedNode: DefinicionNode | null;
  filteredTree: DefinicionNode[];
  unfilteredTree: DefinicionNode[];
  changelog: ChangelogEntry[];
  accessConfig: Record<string, NodeAccessConfig>;
  loading: boolean;
  error: string | null;
  reloadTree: () => Promise<void>;
  // Vault configs (multi-vault support)
  vaults: VaultConfigApi[];
  vaultsLoaded: boolean;
  activeVaultId: string | null;
  /** Vault que el user está VIENDO (puede diferir del activo). null = ver el activo. */
  viewingVaultId: string | null;
  /** ID efectivo: viewing si hay override, sino active. */
  effectiveVaultId: string | null;
  switchVault: (vaultId: string) => Promise<void>;
  reloadVaults: () => Promise<void>;
  selectNode: (id: string | null) => void;
  toggleFolder: (id: string) => void;
  expandFolder: (id: string) => void;
  setSearch: (query: string) => void;
  toggleEditing: () => void;
  updateContent: (id: string, content: string, previousContent?: string) => void;
  addFolder: (parentId: string | null, name: string) => void;
  addDocument: (parentId: string, name: string) => void;
  renameNode: (id: string, name: string) => void;
  updateTags: (id: string, tags: string[]) => void;
  deleteNode: (id: string) => void;
  setSortBy: (sortBy: SortOption) => void;
  expandAll: () => void;
  collapseAll: () => void;
  getEffectiveAccessForNode: (nodeId: string) => EffectiveAccess;
  setInheritance: (nodeId: string, inherit: boolean) => void;
  addAccess: (entry: AccessControlEntry) => void;
  updateAccess: (entryId: string, nodeId: string, accessLevel: AccessLevel) => void;
  removeAccess: (entryId: string, nodeId: string) => void;
  roleDefaults: Record<UserRole, AccessLevel>;
  setRoleDefault: (role: UserRole, level: AccessLevel) => void;
}

const DefinicionesContext = createContext<DefinicionesContextValue | null>(null);

export function DefinicionesProvider({ children }: { children: ReactNode }) {
  const { currentUser, members } = useAuthContext();
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const [state, dispatch] = useReducer((s: DefinicionesState, action: DefinicionesAction) => {
    const newState = reducer(s, action);
    if (newState.changelog.length > s.changelog.length && currentUserRef.current) {
      const [newest, ...rest] = newState.changelog;
      return {
        ...newState,
        changelog: [
          { ...newest, userId: currentUserRef.current.id, userName: currentUserRef.current.name },
          ...rest,
        ],
      };
    }
    return newState;
  }, initialState);

  // === Content caches (refs para no disparar re-renders) ===
  // `contentCache` marca qué nodos ya tuvieron su body cargado — evita re-fetch en re-renders
  // `frontmatterCache` preserva el YAML crudo del archivo para re-adjuntarlo al guardar
  const contentCache = useRef<Set<string>>(new Set());
  const frontmatterCache = useRef<Map<string, string>>(new Map());

  // Ref que tracking el vaultId override del browse-mode. Necesario porque
  // `reloadTree` y `loadFile` se declaran antes que el state `viewingVaultId`
  // y sus closures necesitan leer el valor actual sin re-crearse en cada
  // cambio (lo cual rompería los useEffect deps).
  const browseVaultIdRef = useRef<string | undefined>(undefined);

  // === Async loader: fetch tree from GitHub vault ===
  const reloadTree = useCallback(async () => {
    // Solo mostrar spinner en la carga inicial (tree vacío).
    // En reloads posteriores (rename, vault switch), mantener el tree visible
    // mientras se carga en background para evitar flicker.
    if (state.tree.length === 0) {
      dispatch({ type: 'LOAD_TREE_START' });
    }
    // CRÍTICO: limpiar caches de contenido — el tree nuevo tiene instancias frescas de
    // DefinicionNode sin `content`/`metadata`. Si no limpiamos, el lazy-load effect ve
    // el cache y se skipea, dejando el selectedNode sin contenido permanentemente.
    contentCache.current.clear();
    frontmatterCache.current.clear();
    try {
      // Lee del vault que el user está VIENDO (puede ser distinto del activo
      // si abrió otro desde el dropdown). Sin override, lee del activo.
      // Los tags de TODOS los docs se cargan en paralelo: el grafo los
      // necesita completos para dibujar conexiones (sin esto solo tendría
      // los tags de documentos ya abiertos en la sesión). Si el endpoint
      // falla, el árbol carga igual — el grafo degrada a jerarquía sola.
      const [vaultTree, allTags] = await Promise.all([
        getVaultTree(VAULT_ROOT, browseVaultIdRef.current),
        getAllVaultTags(browseVaultIdRef.current).catch(() => ({}) as Record<string, string[]>),
      ]);
      const mapped = applyVaultTags(vaultTreeToDefinicionNodes(vaultTree), allTags);
      dispatch({ type: 'LOAD_TREE_SUCCESS', tree: mapped });
    } catch (err: unknown) {
      const msg = errorMessageOf(err) || 'Error cargando el vault';
      dispatch({ type: 'LOAD_TREE_ERROR', error: msg });
      toast.error(`No se pudo cargar el vault: ${msg}`);
    }
  }, []);

  // Tree se carga condicionalmente — ver useEffect después del bloque multi-vault

  // === Multi-vault support ===
  const [allVaults, setAllVaults] = useState<VaultConfigApi[]>([]);

  // Filtro de acceso: un usuario solo ve vaults donde:
  // 1. Su rol es AltaGerencia → ve todos los vaults
  // 2. allowedPodIds está vacío (sin restricción, todos ven)
  // 3. Alguno de sus podIds está en allowedPodIds del vault
  const vaults = useMemo(() => {
    if (!currentUser) return allVaults;
    if (currentUser.role === UserRole.AltaGerencia) return allVaults;
    const userPodIds = new Set(currentUser.podIds ?? []);
    return allVaults.filter((v) =>
      v.allowedPodIds.length === 0 || v.allowedPodIds.some((pid) => userPodIds.has(pid)),
    );
  }, [allVaults, currentUser]);

  const activeVaultId = useMemo(() => vaults.find((v) => v.isActive)?.id ?? vaults[0]?.id ?? null, [vaults]);

  const [vaultsLoaded, setVaultsLoaded] = useState(false);

  // viewingVaultId — vault que el user está VIENDO en la UI. Independiente
  // del vinculado (`activeVaultId`). Cambiar el dropdown navega entre vaults
  // sin alterar dónde se ESCRIBE — el "vínculo" se cambia solo desde Settings.
  // Default null = ver el vault vinculado (comportamiento sin override).
  const [viewingVaultId, setViewingVaultId] = useState<string | null>(null);

  // El vault efectivamente mostrado: el viewing si existe, sino el active.
  const effectiveVaultId = viewingVaultId ?? activeVaultId;

  // Helper: pasa vaultId a las APIs de read solo cuando es DIFERENTE al activo.
  // Pasar undefined hace que el backend lea del activo (default behavior).
  // Esto evita query strings con vaultId redundante cuando viewing === active.
  const browseVaultId = viewingVaultId && viewingVaultId !== activeVaultId ? viewingVaultId : undefined;

  // Sincronizar el ref para que las closures de `reloadTree`/`loadFile`
  // (declaradas antes en el archivo) puedan leer el browse override actual.
  useEffect(() => {
    browseVaultIdRef.current = browseVaultId;
  }, [browseVaultId]);

  const reloadVaults = useCallback(async () => {
    try {
      const data = await getAccessibleVaultConfigs();
      setAllVaults(data);
    } catch {
      /* fail-soft: el state vacío activa el empty-state legítimo de la UI */
    } finally {
      setVaultsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reloadVaults();
  }, [reloadVaults]);

  // Si el user borra/cambia el activo, y el viewing apunta a un vault que
  // ya no es accesible, resetear viewing a null (volver al activo).
  useEffect(() => {
    if (viewingVaultId && !vaults.find((v) => v.id === viewingVaultId)) {
      setViewingVaultId(null);
    }
  }, [vaults, viewingVaultId]);

  const switchVault = useCallback(async (vaultId: string) => {
    const target = vaults.find((v) => v.id === vaultId);
    if (!target) return;
    // Si el target es el activo, simplemente reset viewing (no override).
    if (target.isActive) {
      setViewingVaultId(null);
      return;
    }
    // Cambia el vault VISTO (no toca el isActive en BD). Las carpetas/docs
    // que se creen aquí van al vault visto. Las épicas/historias siguen
    // yendo al vault vinculado (el isActive de la BD).
    setViewingVaultId(vaultId);
    toast.success(`Viendo vault "${target.name}"`, {
      description: 'Carpetas/docs manuales se guardan aquí. Épicas/historias van al vault vinculado.',
    });
    await reloadTree();
  }, [vaults, reloadTree]);

  // === Sincronizar roleDefaults del vault activo al state ===
  useEffect(() => {
    const activeVault = vaults.find((v) => v.id === activeVaultId);
    if (!activeVault) return;
    const vaultDefaults = activeVault.roleDefaults ?? {};
    // Para cada rol, usar el default del vault si está definido, sino el global
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.AltaGerencia) continue;
      const level = (vaultDefaults[role] as AccessLevel) || DEFAULT_ROLE_ACCESS[role];
      dispatch({ type: 'SET_ROLE_DEFAULT', role, level });
    }
  }, [activeVaultId, vaults]);

  // === Tree load condicionado a que haya vaults accesibles ===
  // Si el usuario no tiene ningún vault permitido, no carga el tree (empty state).
  // Recarga al montar, al cambiar el activo, y al cambiar el viewing override
  // (cuando el user navega a otro vault desde el dropdown).
  useEffect(() => {
    if (vaults.length === 0) {
      // Sin vaults accesibles → limpiar tree
      dispatch({ type: 'LOAD_TREE_SUCCESS', tree: [] });
      return;
    }
    void reloadTree();
  }, [vaults.length > 0, effectiveVaultId, reloadTree]);

  // === Changelog from git history ===
  // Se recarga cada vez que cambia el vault VISTO (active o browse override)
  // para mostrar los commits del vault que el user está mirando.
  useEffect(() => {
    if (!effectiveVaultId) return;
    getVaultChangelog(50, browseVaultId)
      .then((commits) => {
        const entries: ChangelogEntry[] = commits
          // Filtrar commits de config interna — no son documentos del usuario
          .filter((c) => !c.message.includes('.cenzontle/') && !c.message.includes('folder access config') && !c.message.includes('folder access permissions'))
          .map((c) => {
          let action: ChangelogAction = 'edit';
          if (c.message.startsWith('feat(')) action = 'create';
          else if (c.message.includes('delete')) action = 'delete';
          else if (c.message.startsWith('fix(')) action = 'edit';

          const afterColon = c.message.split(': ').slice(1).join(': ').trim();
          const pathMatch = afterColon.match(/(?:create|update|delete|repair)\s+"?([^"[\]]+)"?/i);
          const nodePath = pathMatch?.[1]?.trim() || afterColon.slice(0, 80);
          const rawName = nodePath.split('/').pop() || nodePath;
          const nodeName = humanizeFilename(rawName);

          return {
            id: c.sha,
            timestamp: c.date,
            action,
            nodeId: nodePath,
            nodeName,
            nodeType: 'document' as const,
            userName: c.authorName,
            details: { contentPreview: c.message },
          };
        });
        // REPLACE, no merge — cada vault tiene su propio historial de commits
        dispatch({ type: 'LOAD_CHANGELOG', entries });
      })
      .catch(() => {});
  }, [effectiveVaultId, browseVaultId]);

  // === Per-folder access config persistence ===
  // Carga `.cenzontle/access.json` del vault al cambiar de vault activo.
  // Guarda cada vez que cambia el accessConfig (debounced 1s).
  const ACCESS_CONFIG_PATH = '.cenzontle/access.json';

  useEffect(() => {
    if (!activeVaultId || vaults.length === 0) return;
    // Fetch silencioso vía BFF proxy (inyecta Auth0 token).
    // No usar apiFetch para evitar log de error cuando 404 (archivo no existe aún).
    fetch(`/api/proxy/vault/file?path=${encodeURIComponent(ACCESS_CONFIG_PATH)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.content) {
          try {
            const parsed = JSON.parse(data.content);
            dispatch({ type: 'LOAD_ACCESS_CONFIG', accessConfig: parsed });
          } catch { /* archivo corrupto, usar defaults */ }
        }
      })
      .catch(() => { /* network error, usar defaults */ });
  }, [activeVaultId]);

  // Guardar accessConfig al vault (debounced) cada vez que cambia
  const accessConfigRef = useRef(state.accessConfig);
  accessConfigRef.current = state.accessConfig;
  const saveAccessTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveAccessConfig = useCallback(() => {
    if (saveAccessTimeout.current) clearTimeout(saveAccessTimeout.current);
    saveAccessTimeout.current = setTimeout(() => {
      const config = accessConfigRef.current;
      // Solo guardar si hay entradas (no guardar un objeto vacío)
      if (Object.keys(config).length === 0) return;
      writeVaultFile(
        ACCESS_CONFIG_PATH,
        JSON.stringify(config, null, 2),
        'config(vault): update folder access permissions',
        browseVaultIdRef.current,
      ).catch(() => {});
    }, 1500); // Debounce 1.5s para no hacer un commit por cada click de radio button
  }, []);

  // === Lazy-load file content on selection ===
  // Se dispara cuando se selecciona un nodo (documento o folder).
  // - Para un documento: carga su contenido
  // - Para un folder: pre-carga el contenido de TODOS sus hijos directos tipo documento
  //   (necesario para que las cards de la vista de folder muestren previews del body)
  useEffect(() => {
    if (!state.selectedId) return;
    const node = findNodeById(state.tree, state.selectedId);
    if (!node) return;

    // Acumular la lista de documentos que necesitan carga
    const docsToLoad: DefinicionNode[] = [];
    const pushIfNeeded = (n: DefinicionNode) => {
      if (n.type !== 'document') return;
      if (n.content !== undefined) return;
      if (contentCache.current.has(n.id)) return;
      docsToLoad.push(n);
    };

    if (node.type === 'document') {
      pushIfNeeded(node);
    } else if (node.type === 'folder' && node.children) {
      for (const child of node.children) {
        pushIfNeeded(child);
      }
    }

    if (docsToLoad.length === 0) return;

    for (const doc of docsToLoad) {
      contentCache.current.add(doc.id);
      // Lee del vault que el user está VIENDO (browse override si aplica).
      getVaultFile(doc.id, browseVaultIdRef.current)
        .then((file) => {
          // Separar frontmatter del body
          const { frontmatter, body } = splitFrontmatter(file.content);
          let metadata: Record<string, string> | undefined;
          let tagsFromFrontmatter: string[] | undefined;

          if (frontmatter) {
            frontmatterCache.current.set(doc.id, frontmatter);
            const parsed = parseYamlFrontmatter(frontmatter);
            // Separar tags (metadata de usuario) del resto (metadata de sistema)
            const metadataEntries: [string, string][] = [];
            for (const [key, value] of Object.entries(parsed)) {
              if (key === 'tags') {
                if (Array.isArray(value)) tagsFromFrontmatter = value;
                continue;
              }
              // MetadataTable solo renderea strings — si hay otro array, lo serializamos
              metadataEntries.push([key, Array.isArray(value) ? value.join(', ') : value]);
            }
            metadata = Object.fromEntries(metadataEntries);
          }

          dispatch({
            type: 'SET_NODE_CONTENT',
            id: doc.id,
            content: body,
            metadata,
            tags: tagsFromFrontmatter,
            updatedAt: file.updatedAt ?? undefined,
          });
        })
        .catch((err) => {
          contentCache.current.delete(doc.id);
          toast.error(`No se pudo cargar el archivo: ${err?.message ?? 'error desconocido'}`);
        });
    }
  }, [state.selectedId, state.tree]);

  const unfilteredTree = useMemo(
    () => sortTree(filterTree(state.tree, state.searchQuery), state.sortBy),
    [state.tree, state.searchQuery, state.sortBy],
  );

  const filteredTree = useMemo(
    () => {
      if (!currentUser) return unfilteredTree;
      return filterTreeByAccess(unfilteredTree, currentUser.id, currentUser.role, state.tree, state.accessConfig, state.roleDefaults);
    },
    [unfilteredTree, currentUser, state.tree, state.accessConfig, state.roleDefaults],
  );

  const selectedNode = useMemo(() => {
    if (!state.selectedId) return null;
    // Si hay busqueda activa, preferir el nodo de filteredTree porque sus
    // `children` ya estan filtrados a los que matchean. Asi el panel derecho
    // del DocumentViewer muestra solo los resultados relevantes en vez del
    // contenido completo del folder. Fallback al tree crudo si no esta en
    // filteredTree (ej: seleccionado antes de la busqueda o fuera del
    // scope del filter por access).
    if (state.searchQuery.trim()) {
      const filteredNode = findNodeById(filteredTree, state.selectedId);
      if (filteredNode) return filteredNode;
    }
    const node = findNodeById(state.tree, state.selectedId);
    if (!node || !currentUser) return node;
    const access = getEffectiveAccess(currentUser.id, currentUser.role, node.id, state.tree, state.accessConfig, state.roleDefaults);
    if (access.level === 'none') return null;
    return node;
  }, [state.tree, filteredTree, state.selectedId, state.searchQuery, currentUser, state.accessConfig, state.roleDefaults]);

  const getEffectiveAccessForNode = useCallback(
    (nodeId: string): EffectiveAccess => {
      if (!currentUser) return { level: 'none', source: 'direct' };
      return getEffectiveAccess(currentUser.id, currentUser.role, nodeId, state.tree, state.accessConfig, state.roleDefaults);
    },
    [currentUser, state.tree, state.accessConfig, state.roleDefaults],
  );

  const requireEditor = useCallback((nodeId: string): boolean => {
    const level = getEffectiveAccessForNode(nodeId).level;
    return level === 'editor' || level === 'owner';
  }, [getEffectiveAccessForNode]);

  const requireOwner = useCallback((nodeId: string): boolean => {
    return getEffectiveAccessForNode(nodeId).level === 'owner';
  }, [getEffectiveAccessForNode]);

  // === Read-only UI actions (local only) ===
  const selectNode = useCallback((id: string | null) => dispatch({ type: 'SELECT_NODE', id }), []);
  const toggleFolder = useCallback((id: string) => dispatch({ type: 'TOGGLE_FOLDER', id }), []);
  const expandFolder = useCallback((id: string) => dispatch({ type: 'EXPAND_FOLDER', id }), []);
  const setSearch = useCallback((query: string) => dispatch({ type: 'SET_SEARCH', query }), []);
  const setSortBy = useCallback((sortBy: SortOption) => dispatch({ type: 'SET_SORT', sortBy }), []);
  const expandAll = useCallback(() => dispatch({ type: 'EXPAND_ALL' }), []);
  const collapseAll = useCallback(() => dispatch({ type: 'COLLAPSE_ALL' }), []);
  const toggleEditing = useCallback(() => dispatch({ type: 'TOGGLE_EDITING' }), []);

  // === Write actions that persist to vault ===

  const updateContent = useCallback(async (id: string, content: string, previousContent?: string) => {
    if (!requireEditor(id)) return;
    // Optimistic update local (el body sin frontmatter es lo que vive en el state)
    dispatch({ type: 'UPDATE_CONTENT', id, content, previousContent });
    try {
      // Re-adjuntar el frontmatter original al guardar para no perder la metadata
      // (id, type, initiativeId, created, etc.) que el backend necesita para parsear.
      const frontmatter = frontmatterCache.current.get(id) ?? null;
      const fullContent = joinFrontmatter(frontmatter, content);
      await writeVaultFile(id, fullContent, `docs(vault): update ${id}`, browseVaultIdRef.current);
    } catch (err: unknown) {
      if (previousContent !== undefined) {
        dispatch({ type: 'UPDATE_CONTENT', id, content: previousContent });
      }
      toast.error(`Error guardando: ${errorMessageOf(err) ?? 'error desconocido'}`);
    }
  }, [requireEditor]);

  const addFolder = useCallback(async (parentId: string | null, name: string) => {
    if (parentId && !requireEditor(parentId)) return;
    const safeName = slugifyFilename(name);
    if (!safeName) {
      toast.error('Nombre de folder inválido');
      return;
    }
    const folderPath = buildChildPath(parentId, safeName, 'folder');
    const gitkeepPath = `${folderPath}/.gitkeep`;
    const now = new Date().toISOString();

    const newNode: DefinicionNode = {
      id: folderPath,
      name,
      type: 'folder',
      createdAt: now,
      updatedAt: now,
      children: [],
    };

    // Optimistic
    dispatch({ type: 'ADD_FOLDER', parentId, name, node: newNode });
    try {
      // Git no trackea folders vacíos — creamos un .gitkeep como marcador
      await writeVaultFile(gitkeepPath, '', `feat(vault): create folder ${folderPath}`, browseVaultIdRef.current);
      toast.success(`Folder "${name}" creado`);
    } catch (err: unknown) {
      dispatch({ type: 'DELETE_NODE', id: folderPath });
      toast.error(`Error creando folder: ${errorMessageOf(err) ?? 'error desconocido'}`);
    }
  }, [requireEditor]);

  const addDocument = useCallback(async (parentId: string, name: string) => {
    if (!requireEditor(parentId)) return;
    const safeName = slugifyFilename(name);
    if (!safeName) {
      toast.error('Nombre de documento inválido');
      return;
    }
    const docPath = buildChildPath(parentId, safeName, 'document');
    const initialContent = `# ${name}\n\nDescribe esta definición aquí...\n`;
    const now = new Date().toISOString();

    const newNode: DefinicionNode = {
      id: docPath,
      name,
      type: 'document',
      tags: [],
      createdAt: now,
      updatedAt: now,
      content: initialContent,
    };

    // Optimistic
    dispatch({ type: 'ADD_DOCUMENT', parentId, name, node: newNode });
    try {
      await writeVaultFile(docPath, initialContent, `feat(vault): create ${docPath}`, browseVaultIdRef.current);
    } catch (err: unknown) {
      dispatch({ type: 'DELETE_NODE', id: docPath });
      toast.error(`Error creando documento: ${errorMessageOf(err) ?? 'error desconocido'}`);
    }
  }, [requireEditor]);

  const deleteNode = useCallback(async (id: string) => {
    if (!requireOwner(id)) return;
    const node = findNodeById(state.tree, id);
    if (!node) return;

    // Optimistic local delete
    dispatch({ type: 'DELETE_NODE', id });

    try {
      const browseId = browseVaultIdRef.current;
      if (node.type === 'document') {
        await deleteVaultFile(id, `chore(vault): delete ${id}`, browseId);
      } else {
        // Folder: recursive delete of all descendant files
        const descendantFiles = collectDescendantFilePaths(node);
        for (const filePath of descendantFiles) {
          await deleteVaultFile(filePath, `chore(vault): delete ${filePath}`, browseId).catch(() => {});
        }
        // También borrar el .gitkeep si existía
        await deleteVaultFile(`${id}/.gitkeep`, `chore(vault): delete folder marker ${id}`, browseId).catch(() => {});
      }
      toast.success(`Eliminado "${node.name}"`);
    } catch (err: unknown) {
      toast.error(`Error eliminando: ${errorMessageOf(err) ?? 'error desconocido'}`);
      // Reload completo para re-sincronizar con GitHub
      void reloadTree();
    }
  }, [requireOwner, state.tree, reloadTree]);

  const renameNode = useCallback(async (id: string, name: string) => {
    if (!requireEditor(id)) return;
    const node = findNodeById(state.tree, id);
    if (!node) return;

    // Folders: mover recursivamente todos los archivos hijos al nuevo path
    if (node.type === 'folder') {
      const safeName = slugifyFilename(name);
      if (!safeName) { toast.error('Nombre inválido'); return; }

      const oldFolderPath = id;
      const parentSegments = id.split('/').slice(0, -1);
      const newFolderPath = [...parentSegments, safeName].join('/');

      // Optimistic
      const oldName = node.name;
      dispatch({ type: 'RENAME_NODE', id, name });

      try {
        // Recopilar todos los archivos descendientes del folder
        const descendantFiles = collectDescendantFilePaths(node);
        const browseId = browseVaultIdRef.current;

        // Mover cada archivo: leer contenido → escribir en nueva ruta → borrar vieja
        for (const filePath of descendantFiles) {
          const relativePart = filePath.slice(oldFolderPath.length); // ej: /subfolder/doc.md
          const newFilePath = newFolderPath + relativePart;

          const fileContent = await getVaultFile(filePath, browseId).then(f => f.content).catch(() => '');
          await writeVaultFile(newFilePath, fileContent, `docs(vault): rename folder ${oldFolderPath} → ${newFolderPath}`, browseId);
          await deleteVaultFile(filePath, `chore(vault): cleanup old path ${filePath}`, browseId);
        }

        // Mover el .gitkeep si existe
        try {
          await writeVaultFile(`${newFolderPath}/.gitkeep`, '', `chore(vault): gitkeep for ${newFolderPath}`, browseId);
          await deleteVaultFile(`${oldFolderPath}/.gitkeep`, `chore(vault): cleanup old gitkeep`, browseId).catch(() => {});
        } catch { /* puede no existir */ }

        await reloadTree();
        toast.success(`Carpeta renombrada a "${name}"`);
      } catch (err: unknown) {
        dispatch({ type: 'RENAME_NODE', id, name: oldName });
        toast.error(`Error renombrando carpeta: ${errorMessageOf(err) ?? 'error desconocido'}`);
        await reloadTree();
      }
      return;
    }

    // Documentos: delete old + write new en el vault
    const safeName = slugifyFilename(name);
    if (!safeName) { toast.error('Nombre inválido'); return; }

    // Derivar el nuevo path: mismo parent folder, nuevo nombre
    const segments = id.split('/');
    segments[segments.length - 1] = `${safeName}.md`;
    const newPath = segments.join('/');

    // Optimistic update local
    const oldName = node.name;
    dispatch({ type: 'RENAME_NODE', id, name });

    try {
      // Leer contenido actual (puede estar en el state o necesitar fetch)
      const frontmatter = frontmatterCache.current.get(id) ?? null;
      const body = node.content ?? '';
      const fullContent = frontmatter ? `${frontmatter}\n\n${body}` : body;

      // Escribir con nuevo path
      await writeVaultFile(newPath, fullContent, `docs(vault): rename ${id} → ${newPath}`, browseVaultIdRef.current);
      // Borrar el viejo
      await deleteVaultFile(id, `chore(vault): delete old path ${id}`, browseVaultIdRef.current);

      // Actualizar caches
      if (frontmatter) {
        frontmatterCache.current.set(newPath, frontmatter);
        frontmatterCache.current.delete(id);
      }
      contentCache.current.delete(id);

      // Recargar el tree para reflejar el nuevo path como ID
      await reloadTree();
      toast.success(`Renombrado a "${name}"`);
    } catch (err: unknown) {
      // Rollback
      dispatch({ type: 'RENAME_NODE', id, name: oldName });
      toast.error(`Error renombrando: ${errorMessageOf(err) ?? 'error desconocido'}`);
    }
  }, [requireEditor, state.tree, reloadTree]);

  const updateTags = useCallback(async (id: string, tags: string[]) => {
    if (!requireEditor(id)) return;
    const node = findNodeById(state.tree, id);
    if (!node || node.type !== 'document') return;

    const oldTags = node.tags ?? [];
    // Optimistic update local para UX responsiva
    dispatch({ type: 'UPDATE_TAGS', id, tags });

    try {
      // Reconstruir frontmatter con los tags actualizados
      const currentFrontmatter = frontmatterCache.current.get(id) ?? null;
      const newFrontmatter = updateFrontmatterTags(currentFrontmatter, tags);

      // Actualizar cache del frontmatter
      if (newFrontmatter) {
        frontmatterCache.current.set(id, newFrontmatter);
      } else {
        frontmatterCache.current.delete(id);
      }

      // Escribir al vault combinando frontmatter nuevo + body existente
      const body = node.content ?? '';
      const fullContent = newFrontmatter
        ? `${newFrontmatter}\n\n${body}`
        : body;
      await writeVaultFile(id, fullContent, `docs(vault): update tags for ${id}`);
    } catch (err: unknown) {
      // Rollback: restaurar tags previos en el state
      dispatch({ type: 'UPDATE_TAGS', id, tags: oldTags });
      toast.error(`Error guardando tags: ${errorMessageOf(err) ?? 'error desconocido'}`);
    }
  }, [requireEditor, state.tree]);

  // === ACL actions (persisted to .cenzontle/access.json) ===
  const setInheritance = useCallback((nodeId: string, inherit: boolean) => {
    const parentId = findParentId(state.tree, nodeId);
    if (parentId && !requireOwner(parentId)) return;
    dispatch({ type: 'SET_INHERITANCE', nodeId, inherit });
    saveAccessConfig();
  }, [requireOwner, state.tree, saveAccessConfig]);

  const resolveRole = useCallback((principalType: 'user' | 'role', principalId: string): UserRole => {
    if (principalType === 'role') return principalId as UserRole;
    const member = members.find(m => m.id === principalId);
    return member?.role ?? UserRole.Viewer;
  }, [members]);

  const addAccess = useCallback((entry: AccessControlEntry) => {
    if (!requireOwner(entry.nodeId)) return;
    // Solo aplicar herencia restrictiva si el nodo HEREDA del padre.
    // Si inheritFromParent está OFF, el usuario explícitamente quiere permisos custom
    // que pueden ser MAYORES que los del padre — por eso desactivó la herencia.
    const nodeConfig = state.accessConfig[entry.nodeId];
    const inherits = nodeConfig?.inheritFromParent ?? true;
    if (inherits) {
      const principalUserId = entry.principalType === 'user' ? entry.principalId : '';
      const principalRole = resolveRole(entry.principalType, entry.principalId);
      const parentLevel = getParentEffectiveLevel(
        entry.nodeId, principalUserId, principalRole, state.tree, state.accessConfig,
      );
      if (ACCESS_LEVEL_HIERARCHY[entry.accessLevel] > ACCESS_LEVEL_HIERARCHY[parentLevel]) return;
    }
    dispatch({ type: 'ADD_ACCESS', entry });
    saveAccessConfig();
  }, [requireOwner, resolveRole, state.tree, state.accessConfig, saveAccessConfig]);

  const updateAccess = useCallback((entryId: string, nodeId: string, accessLevel: AccessLevel) => {
    if (!requireOwner(nodeId)) return;
    const config = state.accessConfig[nodeId];
    const inherits = config?.inheritFromParent ?? true;
    if (inherits) {
      const entry = config?.entries.find(e => e.id === entryId);
      const principalUserId = entry?.principalType === 'user' ? entry.principalId : '';
      const principalRole = resolveRole(entry?.principalType ?? 'role', entry?.principalId ?? '');
      const parentLevel = getParentEffectiveLevel(
        nodeId, principalUserId, principalRole, state.tree, state.accessConfig,
      );
      if (ACCESS_LEVEL_HIERARCHY[accessLevel] > ACCESS_LEVEL_HIERARCHY[parentLevel]) return;
    }
    dispatch({ type: 'UPDATE_ACCESS', entryId, nodeId, accessLevel });
    saveAccessConfig();
  }, [requireOwner, resolveRole, state.tree, state.accessConfig, saveAccessConfig]);

  const removeAccess = useCallback((entryId: string, nodeId: string) => {
    if (!requireOwner(nodeId)) return;
    dispatch({ type: 'REMOVE_ACCESS', entryId, nodeId });
    saveAccessConfig();
  }, [requireOwner, saveAccessConfig]);

  const setRoleDefault = useCallback((role: UserRole, level: AccessLevel) => dispatch({ type: 'SET_ROLE_DEFAULT', role, level }), []);

  const value = useMemo<DefinicionesContextValue>(() => ({
    state,
    selectedNode,
    filteredTree,
    unfilteredTree,
    changelog: state.changelog,
    accessConfig: state.accessConfig,
    roleDefaults: state.roleDefaults,
    loading: state.loading,
    error: state.error,
    reloadTree,
    vaults,
    vaultsLoaded,
    activeVaultId,
    viewingVaultId,
    effectiveVaultId,
    switchVault,
    reloadVaults,
    selectNode,
    toggleFolder,
    expandFolder,
    setSearch,
    toggleEditing,
    updateContent,
    addFolder,
    addDocument,
    renameNode,
    updateTags,
    deleteNode,
    setSortBy,
    expandAll,
    collapseAll,
    getEffectiveAccessForNode,
    setInheritance,
    addAccess,
    updateAccess,
    removeAccess,
    setRoleDefault,
  }), [state, selectedNode, filteredTree, unfilteredTree, reloadTree, vaults, vaultsLoaded, activeVaultId, viewingVaultId, effectiveVaultId, switchVault, reloadVaults, selectNode, toggleFolder, expandFolder, setSearch, toggleEditing, updateContent, addFolder, addDocument, renameNode, updateTags, deleteNode, setSortBy, expandAll, collapseAll, getEffectiveAccessForNode, setInheritance, addAccess, updateAccess, removeAccess, setRoleDefault]);

  return (
    <DefinicionesContext.Provider value={value}>
      {children}
    </DefinicionesContext.Provider>
  );
}

export function useDefiniciones() {
  const ctx = useContext(DefinicionesContext);
  if (!ctx) throw new Error('useDefiniciones must be used within DefinicionesProvider');
  return ctx;
}

/** Collects full vault paths of all descendant file nodes (not the node itself). */
function collectDescendantFilePaths(node: DefinicionNode): string[] {
  const out: string[] = [];
  const walk = (n: DefinicionNode) => {
    if (n.type === 'document') out.push(n.id);
    if (n.children) n.children.forEach(walk);
  };
  if (node.children) node.children.forEach(walk);
  if (node.type === 'document') out.push(node.id);
  return out;
}
