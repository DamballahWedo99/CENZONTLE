import type { Initiative, Epic, UserStory, Pod, EpicWithRelations } from '@cenzontle/shared';
import {
  initiativeToFlatRow,
  epicToFlatRow,
  storyToFlatRow,
  statusLabel,
  priorityLabel,
  getInitiativeRelations,
  splitMarkdownByH2,
} from './serializers';

// We avoid a top-level import of exceljs to keep the bundle small.
// The eslint/type-check tolerates `any` on the dynamic import's return.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWorkbook = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWorksheet = any;

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF18181B' } };
const HEADER_FONT = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };

function styleHeader(sheet: AnyWorksheet): void {
  const row = sheet.getRow(1);
  row.fill = HEADER_FILL;
  row.font = HEADER_FONT;
  row.alignment = { vertical: 'middle', horizontal: 'left' };
}

async function newWorkbook(): Promise<{ workbook: AnyWorkbook; ExcelJS: typeof import('exceljs') }> {
  const ExcelJS = await import('exceljs');
  return { workbook: new ExcelJS.Workbook(), ExcelJS };
}

async function saveWorkbook(workbook: AnyWorkbook, filename: string): Promise<void> {
  const { saveAs } = await import('file-saver');
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, filename);
}

function addKeyValueSheet(
  workbook: AnyWorkbook,
  name: string,
  rows: Array<[string, string | number]>,
): void {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  sheet.columns = [
    { header: 'Campo', key: 'key', width: 30 },
    { header: 'Valor', key: 'value', width: 80 },
  ];
  styleHeader(sheet);
  for (const [k, v] of rows) {
    const r = sheet.addRow({ key: k, value: v });
    r.getCell('value').alignment = { wrapText: true, vertical: 'top' };
  }
}

function addTableSheet(
  workbook: AnyWorkbook,
  name: string,
  columns: Array<{ header: string; key: string; width: number }>,
  rows: ReadonlyArray<Record<string, string | number>>,
): void {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  sheet.columns = columns;
  styleHeader(sheet);
  for (const row of rows) {
    const r = sheet.addRow(row);
    columns.forEach((col) => {
      r.getCell(col.key).alignment = { wrapText: true, vertical: 'top' };
    });
  }
}

// === COLUMN DEFINITIONS ===

const INITIATIVE_COLUMNS = [
  { header: 'Nombre', key: 'name', width: 40 },
  { header: 'Estado', key: 'status', width: 14 },
  { header: 'Owner', key: 'owner', width: 22 },
  { header: 'Inicio', key: 'startDate', width: 12 },
  { header: 'Objetivo', key: 'targetDate', width: 12 },
  { header: 'Épicas', key: 'epicCount', width: 8 },
  { header: 'Historias', key: 'storyCount', width: 10 },
  { header: 'Done', key: 'doneStoryCount', width: 8 },
  { header: 'SP Totales', key: 'totalStoryPoints', width: 12 },
  { header: 'SP Done', key: 'doneStoryPoints', width: 10 },
  { header: 'Progreso (%)', key: 'progress', width: 12 },
  { header: 'Descripción', key: 'description', width: 60 },
];

const EPIC_COLUMNS = [
  { header: 'Key', key: 'trackerKey', width: 12 },
  { header: 'Título', key: 'title', width: 40 },
  { header: 'Iniciativa', key: 'initiativeName', width: 28 },
  { header: 'Estado', key: 'status', width: 14 },
  { header: 'Prioridad', key: 'priority', width: 12 },
  { header: 'PODs', key: 'pods', width: 24 },
  { header: 'Inicio', key: 'startDate', width: 12 },
  { header: 'Objetivo', key: 'targetDate', width: 12 },
  { header: 'Historias', key: 'storyCount', width: 10 },
  { header: 'Done', key: 'doneStoryCount', width: 8 },
  { header: 'Progreso (%)', key: 'progress', width: 12 },
  { header: 'Descripción', key: 'description', width: 50 },
];

const STORY_COLUMNS = [
  { header: 'Key', key: 'trackerKey', width: 12 },
  { header: 'Título', key: 'title', width: 40 },
  { header: 'Épica', key: 'epicTitle', width: 28 },
  { header: 'POD', key: 'podName', width: 18 },
  { header: 'Estado', key: 'status', width: 14 },
  { header: 'SP', key: 'storyPoints', width: 6 },
  { header: 'Sprint', key: 'sprintId', width: 14 },
  { header: 'Labels', key: 'labels', width: 30 },
];

// === INDIVIDUAL EXPORTS ===

export async function exportInitiativeToExcel(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  const { workbook } = await newWorkbook();
  const row = initiativeToFlatRow(initiative, epics, stories);

  addKeyValueSheet(workbook, 'Iniciativa', [
    ['ID', row.id],
    ['Nombre', row.name],
    ['Estado', row.status],
    ['Owner', row.owner],
    ['Fecha inicio', row.startDate],
    ['Fecha objetivo', row.targetDate],
    ['Total épicas', row.epicCount],
    ['Total historias', row.storyCount],
    ['Historias done', row.doneStoryCount],
    ['SP totales', row.totalStoryPoints],
    ['SP done', row.doneStoryPoints],
    ['Progreso (%)', row.progress],
    ['Documentos', row.documentCount],
    ['Descripción', row.description],
  ]);

  const { epics: initiativeEpics, stories: initiativeStories } = getInitiativeRelations(
    initiative,
    epics,
    stories,
  );
  const epicRows = initiativeEpics.map((epic) => epicToFlatRow(epic, initiative, pods, stories));
  addTableSheet(workbook, 'Épicas', EPIC_COLUMNS, epicRows);

  const storyRows = initiativeStories.map((s) =>
    storyToFlatRow(s, initiativeEpics.find((e) => e.id === s.epicId), pods.find((p) => p.id === s.podId)),
  );
  addTableSheet(workbook, 'Historias', STORY_COLUMNS, storyRows);

  await saveWorkbook(workbook, filename);
}

export async function exportEpicToExcel(
  epic: Epic,
  initiative: Initiative | null,
  pods: Pod[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const { workbook } = await newWorkbook();
  const epicPods = pods.filter((p) => epic.podIds.includes(p.id));
  const epicStories = stories.filter((s) => s.epicId === epic.id);

  const metadata: Array<[string, string | number]> = [
    ['ID', epic.id],
    ['Tracker', epic.tracker?.externalKey ?? ''],
    ['Título', epic.title],
    ['Iniciativa', initiative?.name ?? ''],
    ['Estado', statusLabel(epic.status)],
    ['Prioridad', priorityLabel(epic.priority)],
    ['PODs', epicPods.map((p) => p.name).join(', ')],
    ['Fecha inicio', epic.startDate],
    ['Fecha objetivo', epic.targetDate],
    ['Creada', epic.createdAt],
    ['Actualizada', epic.updatedAt],
  ];
  // Markdown único de la épica — split por H2 para preservar la estructura
  // en filas key-value (post-refactor v2).
  if (epic.markdown && epic.markdown.trim().length > 0) {
    for (const sub of splitMarkdownByH2(epic.markdown)) {
      metadata.push([sub.title, sub.body]);
    }
  }
  addKeyValueSheet(workbook, 'Épica', metadata);

  if (epic.dependencies.length > 0) {
    addTableSheet(
      workbook,
      'Dependencias',
      [
        { header: 'Título', key: 'title', width: 30 },
        { header: 'Tipo', key: 'type', width: 14 },
        { header: 'Dirección', key: 'direction', width: 16 },
        { header: 'Estado', key: 'status', width: 14 },
        { header: 'Severidad', key: 'severity', width: 12 },
        { header: 'Bloqueante', key: 'blocking', width: 12 },
        { header: 'Owner', key: 'owner', width: 20 },
        { header: 'Vencimiento', key: 'dueDate', width: 14 },
      ],
      epic.dependencies.map((d) => ({
        title: d.title,
        type: d.type,
        direction: d.direction,
        status: d.status,
        severity: priorityLabel(d.severity),
        blocking: d.isBlocking ? 'Sí' : 'No',
        owner: d.owner,
        dueDate: d.dueDate ?? '',
      })),
    );
  }

  const storyRows = epicStories.map((s) =>
    storyToFlatRow(s, epic, pods.find((p) => p.id === s.podId)),
  );
  addTableSheet(workbook, 'Historias', STORY_COLUMNS, storyRows);

  await saveWorkbook(workbook, filename);
}

export async function exportStoryToExcel(
  story: UserStory,
  epic: Epic | null,
  pod: Pod | null,
  filename: string,
): Promise<void> {
  const { workbook } = await newWorkbook();

  addKeyValueSheet(workbook, 'Historia', [
    ['ID', story.id],
    ['Tracker', story.tracker?.externalKey ?? ''],
    ['Título', story.title],
    ['Épica', epic?.title ?? ''],
    ['POD', pod?.name ?? ''],
    ['Estado', statusLabel(story.status)],
    ['Story points', story.storyPoints],
    ['Sprint', story.sprintId ?? ''],
    ['Labels', story.labels.join(', ')],
    ['Creada', story.createdAt],
    ['Actualizada', story.updatedAt],
    ['Descripción', story.description],
  ]);

  const detailRows: Array<{ section: string; field: string; value: string }> = [];

  // Cada sección es un markdown único — split por encabezados level 2
  // para preservar la separación semántica en el Excel.
  const expandSection = (section: string, md: string | undefined) => {
    const text = (md ?? '').trim();
    if (!text) return;
    const re = /^##\s+(.+?)\s*$/gm;
    const headings: Array<{ title: string; bodyStart: number; start: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      headings.push({ title: m[1].trim(), bodyStart: m.index + m[0].length, start: m.index });
    }
    if (headings.length === 0) {
      detailRows.push({ section, field: 'Contenido', value: text });
      return;
    }
    const preamble = text.slice(0, headings[0].start).trim();
    if (preamble) detailRows.push({ section, field: 'Resumen', value: preamble });
    for (let i = 0; i < headings.length; i++) {
      const end = i + 1 < headings.length ? headings[i + 1].start : text.length;
      const body = text.slice(headings[i].bodyStart, end).trim();
      if (body) detailRows.push({ section, field: headings[i].title, value: body });
    }
  };
  expandSection('PO', story.po.markdown);
  expandSection('Técnico', story.technical.markdown);
  expandSection('QA', story.qa.markdown);

  addTableSheet(
    workbook,
    'Detalles',
    [
      { header: 'Sección', key: 'section', width: 16 },
      { header: 'Campo', key: 'field', width: 30 },
      { header: 'Valor', key: 'value', width: 80 },
    ],
    detailRows,
  );

  await saveWorkbook(workbook, filename);
}

// === LIST EXPORTS ===

export async function exportInitiativesListToExcel(
  initiatives: Initiative[],
  epics: Epic[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const { workbook } = await newWorkbook();
  const rows = initiatives.map((i) => initiativeToFlatRow(i, epics, stories));
  addTableSheet(workbook, 'Iniciativas', INITIATIVE_COLUMNS, rows);
  await saveWorkbook(workbook, filename);
}

export async function exportEpicsListToExcel(
  epics: EpicWithRelations[],
  filename: string,
): Promise<void> {
  const { workbook } = await newWorkbook();
  const rows = epics.map((epic) => epicToFlatRow(epic, epic.initiative, epic.pods, epic.stories));
  addTableSheet(workbook, 'Épicas', EPIC_COLUMNS, rows);
  await saveWorkbook(workbook, filename);
}

export async function exportStoriesListToExcel(
  stories: UserStory[],
  epics: Epic[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  const { workbook } = await newWorkbook();
  const rows = stories.map((s) =>
    storyToFlatRow(s, epics.find((e) => e.id === s.epicId), pods.find((p) => p.id === s.podId)),
  );
  addTableSheet(workbook, 'Historias', STORY_COLUMNS, rows);
  await saveWorkbook(workbook, filename);
}
