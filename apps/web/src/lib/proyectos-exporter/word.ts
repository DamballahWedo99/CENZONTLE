import type { Initiative, Epic, UserStory, Pod, EpicWithRelations } from '@cenzontle/shared';
import {
  initiativeToSections,
  epicToSections,
  storyToSections,
  initiativeToFlatRow,
  epicToFlatRow,
  storyToFlatRow,
  statusLabel,
  priorityLabel,
} from './serializers';
import type { DocumentSection, DocumentTable } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DocxModule = typeof import('docx');

async function loadDocx(): Promise<DocxModule> {
  return await import('docx');
}

function titleParagraph(docx: DocxModule, text: string, subtitle?: string) {
  const items = [
    new docx.Paragraph({ text, heading: docx.HeadingLevel.TITLE }),
  ];
  if (subtitle) {
    items.push(
      new docx.Paragraph({
        children: [new docx.TextRun({ text: subtitle, italics: true, color: '555555' })],
      }),
    );
  }
  items.push(
    new docx.Paragraph({
      children: [
        new docx.TextRun({
          text: `Generado: ${new Date().toLocaleString('es-MX')}`,
          size: 18,
          color: '888888',
        }),
      ],
    }),
  );
  items.push(new docx.Paragraph({ text: '' }));
  return items;
}

function headingLevelFor(docx: DocxModule, level: 1 | 2 | 3) {
  if (level === 1) return docx.HeadingLevel.HEADING_1;
  if (level === 2) return docx.HeadingLevel.HEADING_2;
  return docx.HeadingLevel.HEADING_3;
}

function buildTable(docx: DocxModule, table: DocumentTable) {
  const rows = [
    new docx.TableRow({
      tableHeader: true,
      children: table.headers.map(
        (h) =>
          new docx.TableCell({
            shading: { fill: '18181B' },
            children: [
              new docx.Paragraph({
                children: [new docx.TextRun({ text: h, bold: true, color: 'FFFFFF' })],
              }),
            ],
          }),
      ),
    }),
    ...table.rows.map(
      (row) =>
        new docx.TableRow({
          children: row.map(
            (cell) =>
              new docx.TableCell({
                children: [new docx.Paragraph({ text: cell })],
              }),
          ),
        }),
    ),
  ];
  return new docx.Table({
    rows,
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
  });
}

function sectionsToBlocks(docx: DocxModule, sections: DocumentSection[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [];
  for (const section of sections) {
    blocks.push(
      new docx.Paragraph({
        text: section.title,
        heading: headingLevelFor(docx, section.level),
      }),
    );
    if (section.body) {
      const paragraphs = section.body.split(/\n{2,}/).filter((l) => l.length > 0);
      for (const p of paragraphs) {
        blocks.push(
          new docx.Paragraph({
            children: p.split(/\n/).flatMap((line, i) =>
              i === 0
                ? [new docx.TextRun({ text: line })]
                : [new docx.TextRun({ text: line, break: 1 })],
            ),
          }),
        );
      }
    }
    if (section.table) {
      blocks.push(buildTable(docx, section.table));
      blocks.push(new docx.Paragraph({ text: '' }));
    }
  }
  return blocks;
}

async function saveDoc(docx: DocxModule, doc: InstanceType<DocxModule['Document']>, filename: string): Promise<void> {
  const { saveAs } = await import('file-saver');
  const blob = await docx.Packer.toBlob(doc);
  saveAs(blob, filename);
}

// === INDIVIDUAL EXPORTS ===

export async function exportInitiativeToWord(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  const docx = await loadDocx();
  const doc = new docx.Document({
    sections: [
      {
        children: [
          ...titleParagraph(docx, initiative.name, `Iniciativa — ${statusLabel(initiative.status)}`),
          ...sectionsToBlocks(docx, initiativeToSections(initiative, epics, stories, pods)),
        ],
      },
    ],
  });
  await saveDoc(docx, doc, filename);
}

export async function exportEpicToWord(
  epic: Epic,
  initiative: Initiative | null,
  pods: Pod[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const docx = await loadDocx();
  const subtitle = `Épica — ${statusLabel(epic.status)} — ${priorityLabel(epic.priority)}`;
  const doc = new docx.Document({
    sections: [
      {
        children: [
          ...titleParagraph(docx, epic.title, subtitle),
          ...sectionsToBlocks(docx, epicToSections(epic, initiative, pods, stories)),
        ],
      },
    ],
  });
  await saveDoc(docx, doc, filename);
}

export async function exportStoryToWord(
  story: UserStory,
  epic: Epic | null,
  pod: Pod | null,
  filename: string,
): Promise<void> {
  const docx = await loadDocx();
  const subtitle = `Historia — ${statusLabel(story.status)} — ${story.storyPoints} SP`;
  const doc = new docx.Document({
    sections: [
      {
        children: [
          ...titleParagraph(docx, story.title, subtitle),
          ...sectionsToBlocks(docx, storyToSections(story, epic, pod)),
        ],
      },
    ],
  });
  await saveDoc(docx, doc, filename);
}

// === LIST EXPORTS ===

export async function exportInitiativesListToWord(
  initiatives: Initiative[],
  epics: Epic[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const docx = await loadDocx();
  const rows = initiatives.map((i) => {
    const r = initiativeToFlatRow(i, epics, stories);
    return [r.name, r.status, r.owner, r.startDate, r.targetDate, String(r.epicCount), String(r.storyCount), `${r.progress}%`];
  });
  const doc = new docx.Document({
    sections: [
      {
        children: [
          ...titleParagraph(docx, 'Iniciativas', `${initiatives.length} resultados`),
          buildTable(docx, {
            headers: ['Nombre', 'Estado', 'Owner', 'Inicio', 'Objetivo', 'Épicas', 'Historias', 'Progreso'],
            rows,
          }),
        ],
      },
    ],
  });
  await saveDoc(docx, doc, filename);
}

export async function exportEpicsListToWord(
  epics: EpicWithRelations[],
  filename: string,
): Promise<void> {
  const docx = await loadDocx();
  const rows = epics.map((epic) => {
    const r = epicToFlatRow(epic, epic.initiative, epic.pods, epic.stories);
    return [r.trackerKey || '—', r.title, r.initiativeName, r.status, r.priority, r.pods, `${r.progress}%`];
  });
  const doc = new docx.Document({
    sections: [
      {
        children: [
          ...titleParagraph(docx, 'Épicas', `${epics.length} resultados`),
          buildTable(docx, {
            headers: ['Key', 'Título', 'Iniciativa', 'Estado', 'Prioridad', 'PODs', 'Progreso'],
            rows,
          }),
        ],
      },
    ],
  });
  await saveDoc(docx, doc, filename);
}

export async function exportStoriesListToWord(
  stories: UserStory[],
  epics: Epic[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  const docx = await loadDocx();
  const rows = stories.map((s) => {
    const r = storyToFlatRow(s, epics.find((e) => e.id === s.epicId), pods.find((p) => p.id === s.podId));
    return [r.trackerKey || '—', r.title, r.epicTitle, r.podName, r.status, String(r.storyPoints)];
  });
  const doc = new docx.Document({
    sections: [
      {
        children: [
          ...titleParagraph(docx, 'Historias', `${stories.length} resultados`),
          buildTable(docx, {
            headers: ['Key', 'Título', 'Épica', 'POD', 'Estado', 'SP'],
            rows,
          }),
        ],
      },
    ],
  });
  await saveDoc(docx, doc, filename);
}
