import type { ExportEntity, ExportFormat } from './types';
import { FORMAT_EXTENSIONS } from './types';

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return cleaned || 'export';
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function entityBaseName(entity: ExportEntity): string {
  switch (entity.kind) {
    case 'initiative':
      return `iniciativa-${sanitizeFilename(entity.initiative.name)}`;
    case 'epic': {
      const key = entity.epic.tracker?.externalKey;
      const slug = sanitizeFilename(entity.epic.title);
      return key ? `epica-${sanitizeFilename(key)}-${slug}` : `epica-${slug}`;
    }
    case 'story': {
      const key = entity.story.tracker?.externalKey;
      const slug = sanitizeFilename(entity.story.title);
      return key ? `historia-${sanitizeFilename(key)}-${slug}` : `historia-${slug}`;
    }
    case 'initiatives-list':
      return 'iniciativas';
    case 'epics-list':
      return 'epicas';
    case 'stories-list':
      return 'historias';
  }
}

export function buildFilename(
  entity: ExportEntity,
  format: ExportFormat,
  override?: string,
): string {
  const ext = FORMAT_EXTENSIONS[format];
  const base = override ? sanitizeFilename(override) : entityBaseName(entity);
  const isList = entity.kind.endsWith('-list');
  return isList ? `${base}-${todayStamp()}.${ext}` : `${base}.${ext}`;
}
