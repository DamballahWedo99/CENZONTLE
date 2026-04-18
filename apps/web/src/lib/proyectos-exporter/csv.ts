import type { Initiative, Epic, UserStory, Pod, EpicWithRelations } from '@cenzontle/shared';
import {
  initiativeToFlatRow,
  epicToFlatRow,
  storyToFlatRow,
} from './serializers';
import type { InitiativeFlatRow, EpicFlatRow, StoryFlatRow } from './types';

function escape(value: string | number): string {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  // BOM for Excel UTF-8 compatibility
  return '\uFEFF' + lines.join('\r\n');
}

async function downloadCsv(content: string, filename: string): Promise<void> {
  const { saveAs } = await import('file-saver');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, filename);
}

const INITIATIVE_HEADERS = [
  'ID', 'Nombre', 'Estado', 'Owner', 'Inicio', 'Objetivo',
  'Épicas', 'Historias', 'Historias Done', 'SP Totales', 'SP Done', 'Progreso (%)',
  'Documentos', 'Descripción',
];

function initiativeRow(r: InitiativeFlatRow): Array<string | number> {
  return [
    r.id, r.name, r.status, r.owner, r.startDate, r.targetDate,
    r.epicCount, r.storyCount, r.doneStoryCount, r.totalStoryPoints, r.doneStoryPoints, r.progress,
    r.documentCount, r.description,
  ];
}

const EPIC_HEADERS = [
  'ID', 'Tracker', 'Título', 'Iniciativa', 'Estado', 'Prioridad', 'PODs',
  'Inicio', 'Objetivo', 'Historias', 'Historias Done', 'Progreso (%)', 'Descripción',
];

function epicRow(r: EpicFlatRow): Array<string | number> {
  return [
    r.id, r.trackerKey, r.title, r.initiativeName, r.status, r.priority, r.pods,
    r.startDate, r.targetDate, r.storyCount, r.doneStoryCount, r.progress, r.description,
  ];
}

const STORY_HEADERS = [
  'ID', 'Tracker', 'Título', 'Épica', 'POD', 'Estado', 'SP', 'Sprint', 'Labels',
];

function storyRow(r: StoryFlatRow): Array<string | number> {
  return [
    r.id, r.trackerKey, r.title, r.epicTitle, r.podName, r.status, r.storyPoints, r.sprintId, r.labels,
  ];
}

// === INDIVIDUAL: fila única plana ===

export async function exportInitiativeToCSV(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const row = initiativeToFlatRow(initiative, epics, stories);
  const csv = toCsv(INITIATIVE_HEADERS, [initiativeRow(row)]);
  await downloadCsv(csv, filename);
}

export async function exportEpicToCSV(
  epic: Epic,
  initiative: Initiative | null,
  pods: Pod[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const row = epicToFlatRow(epic, initiative ?? undefined, pods, stories);
  const csv = toCsv(EPIC_HEADERS, [epicRow(row)]);
  await downloadCsv(csv, filename);
}

export async function exportStoryToCSV(
  story: UserStory,
  epic: Epic | null,
  pod: Pod | null,
  filename: string,
): Promise<void> {
  const row = storyToFlatRow(story, epic ?? undefined, pod ?? undefined);
  const csv = toCsv(STORY_HEADERS, [storyRow(row)]);
  await downloadCsv(csv, filename);
}

// === LISTAS ===

export async function exportInitiativesListToCSV(
  initiatives: Initiative[],
  epics: Epic[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const rows = initiatives.map((i) => initiativeRow(initiativeToFlatRow(i, epics, stories)));
  const csv = toCsv(INITIATIVE_HEADERS, rows);
  await downloadCsv(csv, filename);
}

export async function exportEpicsListToCSV(
  epics: EpicWithRelations[],
  filename: string,
): Promise<void> {
  const rows = epics.map((epic) =>
    epicRow(epicToFlatRow(epic, epic.initiative, epic.pods, epic.stories)),
  );
  const csv = toCsv(EPIC_HEADERS, rows);
  await downloadCsv(csv, filename);
}

export async function exportStoriesListToCSV(
  stories: UserStory[],
  epics: Epic[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  const rows = stories.map((s) =>
    storyRow(storyToFlatRow(s, epics.find((e) => e.id === s.epicId), pods.find((p) => p.id === s.podId))),
  );
  const csv = toCsv(STORY_HEADERS, rows);
  await downloadCsv(csv, filename);
}
