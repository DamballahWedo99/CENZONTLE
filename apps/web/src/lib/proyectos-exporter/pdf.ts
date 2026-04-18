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
import type { DocumentSection } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDoc = any;

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const MAX_Y = 280;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

async function newPdf(): Promise<{
  pdf: PdfDoc;
  autoTable: (doc: PdfDoc, options: Record<string, unknown>) => void;
}> {
  const { default: jsPDF } = await import('jspdf');
  const autoTableMod = await import('jspdf-autotable');
  // jspdf-autotable v5 exports the function as default; older as named
  const autoTable =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (autoTableMod as any).default ?? (autoTableMod as any).autoTable ?? autoTableMod;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  return { pdf, autoTable };
}

function ensureSpace(pdf: PdfDoc, y: number, needed: number): number {
  if (y + needed > MAX_Y) {
    pdf.addPage();
    return 20;
  }
  return y;
}

function drawTitle(pdf: PdfDoc, text: string, y: number, subtitle?: string): number {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(text, MARGIN, y);
  let ny = y + 8;
  if (subtitle) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(100);
    pdf.text(subtitle, MARGIN, ny);
    pdf.setTextColor(0);
    ny += 6;
  }
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(128);
  pdf.text(`Generado: ${new Date().toLocaleString('es-MX')}`, MARGIN, ny);
  pdf.setTextColor(0);
  return ny + 8;
}

function drawHeading(pdf: PdfDoc, text: string, level: 1 | 2 | 3, y: number): number {
  const fontSize = level === 1 ? 15 : level === 2 ? 12 : 10;
  const indent = level === 3 ? 4 : 0;
  const ny = ensureSpace(pdf, y, fontSize);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(fontSize);
  pdf.text(text, MARGIN + indent, ny);
  pdf.setFont('helvetica', 'normal');
  return ny + (level === 1 ? 6 : level === 2 ? 5 : 4);
}

function drawBody(pdf: PdfDoc, text: string, y: number): number {
  let ny = y;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  const paragraphs = text.split(/\n{2,}/);
  for (const paragraph of paragraphs) {
    const lines: string[] = pdf.splitTextToSize(paragraph, CONTENT_WIDTH);
    for (const line of lines) {
      ny = ensureSpace(pdf, ny, 5);
      pdf.text(line, MARGIN, ny);
      ny += 5;
    }
    ny += 2;
  }
  return ny + 2;
}

function drawTable(
  pdf: PdfDoc,
  autoTable: (doc: PdfDoc, options: Record<string, unknown>) => void,
  headers: string[],
  rows: string[][],
  y: number,
): number {
  autoTable(pdf, {
    startY: y,
    head: [headers],
    body: rows,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [24, 24, 27], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 247] },
    theme: 'grid',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastY = (pdf as any).lastAutoTable?.finalY ?? y;
  return lastY + 6;
}

function renderSections(
  pdf: PdfDoc,
  autoTable: (doc: PdfDoc, options: Record<string, unknown>) => void,
  sections: DocumentSection[],
  startY: number,
): number {
  let y = startY;
  for (const s of sections) {
    y = drawHeading(pdf, s.title, s.level, y);
    if (s.body) y = drawBody(pdf, s.body, y);
    if (s.table) y = drawTable(pdf, autoTable, s.table.headers, s.table.rows, y);
  }
  return y;
}

function addFooter(pdf: PdfDoc): void {
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(128);
    pdf.text(`Página ${i} de ${pages}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 8, { align: 'center' });
    pdf.setTextColor(0);
  }
}

// === INDIVIDUAL EXPORTS ===

export async function exportInitiativeToPDF(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  const { pdf, autoTable } = await newPdf();
  let y = drawTitle(pdf, initiative.name, 20, `Iniciativa — ${statusLabel(initiative.status)}`);
  y = renderSections(pdf, autoTable, initiativeToSections(initiative, epics, stories, pods), y);
  addFooter(pdf);
  pdf.save(filename);
}

export async function exportEpicToPDF(
  epic: Epic,
  initiative: Initiative | null,
  pods: Pod[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const { pdf, autoTable } = await newPdf();
  const subtitle = `Épica — ${statusLabel(epic.status)} — ${priorityLabel(epic.priority)}`;
  let y = drawTitle(pdf, epic.title, 20, subtitle);
  y = renderSections(pdf, autoTable, epicToSections(epic, initiative, pods, stories), y);
  addFooter(pdf);
  pdf.save(filename);
}

export async function exportStoryToPDF(
  story: UserStory,
  epic: Epic | null,
  pod: Pod | null,
  filename: string,
): Promise<void> {
  const { pdf, autoTable } = await newPdf();
  const subtitle = `Historia — ${statusLabel(story.status)} — ${story.storyPoints} SP`;
  let y = drawTitle(pdf, story.title, 20, subtitle);
  y = renderSections(pdf, autoTable, storyToSections(story, epic, pod), y);
  addFooter(pdf);
  pdf.save(filename);
}

// === LIST EXPORTS ===

export async function exportInitiativesListToPDF(
  initiatives: Initiative[],
  epics: Epic[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const { pdf, autoTable } = await newPdf();
  let y = drawTitle(pdf, 'Iniciativas', 20, `${initiatives.length} resultados`);
  const rows = initiatives.map((i) => {
    const r = initiativeToFlatRow(i, epics, stories);
    return [
      r.name,
      r.status,
      r.owner,
      r.startDate,
      r.targetDate,
      String(r.epicCount),
      String(r.storyCount),
      `${r.progress}%`,
    ];
  });
  y = drawTable(
    pdf,
    autoTable,
    ['Nombre', 'Estado', 'Owner', 'Inicio', 'Objetivo', 'Épicas', 'Historias', 'Progreso'],
    rows,
    y,
  );
  addFooter(pdf);
  pdf.save(filename);
}

export async function exportEpicsListToPDF(
  epics: EpicWithRelations[],
  filename: string,
): Promise<void> {
  const { pdf, autoTable } = await newPdf();
  let y = drawTitle(pdf, 'Épicas', 20, `${epics.length} resultados`);
  const rows = epics.map((epic) => {
    const r = epicToFlatRow(epic, epic.initiative, epic.pods, epic.stories);
    return [
      r.trackerKey || '—',
      r.title,
      r.initiativeName,
      r.status,
      r.priority,
      r.pods,
      `${r.progress}%`,
    ];
  });
  y = drawTable(
    pdf,
    autoTable,
    ['Key', 'Título', 'Iniciativa', 'Estado', 'Prioridad', 'PODs', 'Progreso'],
    rows,
    y,
  );
  addFooter(pdf);
  pdf.save(filename);
}

export async function exportStoriesListToPDF(
  stories: UserStory[],
  epics: Epic[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  const { pdf, autoTable } = await newPdf();
  let y = drawTitle(pdf, 'Historias', 20, `${stories.length} resultados`);
  const rows = stories.map((s) => {
    const r = storyToFlatRow(s, epics.find((e) => e.id === s.epicId), pods.find((p) => p.id === s.podId));
    return [r.trackerKey || '—', r.title, r.epicTitle, r.podName, r.status, String(r.storyPoints)];
  });
  y = drawTable(pdf, autoTable, ['Key', 'Título', 'Épica', 'POD', 'Estado', 'SP'], rows, y);
  addFooter(pdf);
  pdf.save(filename);
}
