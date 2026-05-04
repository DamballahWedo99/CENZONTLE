import type { Initiative, Epic, UserStory, Pod } from '@cenzontle/shared';
import { StoryStatus } from '@cenzontle/shared';
import type {
  InitiativeFlatRow,
  EpicFlatRow,
  StoryFlatRow,
  DocumentSection,
  InitiativeJsonShape,
  EpicJsonShape,
  StoryJsonShape,
} from './types';
import { SCHEMA_VERSION } from './types';

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
  on_hold: 'On Hold',
  draft: 'Draft',
  in_progress: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
  backlog: 'Backlog',
  to_do: 'Por hacer',
  in_review: 'In Review',
  qa: 'QA',
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function priorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

function progressOf(stories: UserStory[]): number {
  if (stories.length === 0) return 0;
  const done = stories.filter((s) => s.status === StoryStatus.Done).length;
  return Math.round((done / stories.length) * 100);
}

// === FLAT ROWS (CSV / Excel listas / JSON listas) ===

export function initiativeToFlatRow(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
): InitiativeFlatRow {
  const { epics: initiativeEpics, stories: initiativeStories } = getInitiativeRelations(
    initiative,
    epics,
    stories,
  );
  const doneStories = initiativeStories.filter((s) => s.status === StoryStatus.Done);
  const totalSP = initiativeStories.reduce((sum, s) => sum + s.storyPoints, 0);
  const doneSP = doneStories.reduce((sum, s) => sum + s.storyPoints, 0);
  return {
    id: initiative.id,
    name: initiative.name,
    status: statusLabel(initiative.status),
    owner: initiative.owner,
    // Fechas opcionales — si la iniciativa está en planning sin compromiso,
    // exportamos string vacío para que las celdas de tabla queden en blanco.
    startDate: initiative.startDate ?? '',
    targetDate: initiative.targetDate ?? '',
    epicCount: initiativeEpics.length,
    storyCount: initiativeStories.length,
    doneStoryCount: doneStories.length,
    totalStoryPoints: totalSP,
    doneStoryPoints: doneSP,
    progress: progressOf(initiativeStories),
    documentCount: (initiative.documents ?? []).length,
    description: initiative.description,
  };
}

export function epicToFlatRow(
  epic: Epic,
  initiative: Initiative | undefined,
  pods: Pod[],
  stories: UserStory[],
): EpicFlatRow {
  const epicStories = stories.filter((s) => s.epicId === epic.id);
  const doneStories = epicStories.filter((s) => s.status === StoryStatus.Done);
  const epicPods = pods.filter((p) => epic.podIds.includes(p.id));
  return {
    id: epic.id,
    trackerKey: epic.tracker?.externalKey ?? '',
    title: epic.title,
    initiativeName: initiative?.name ?? '',
    status: statusLabel(epic.status),
    priority: priorityLabel(epic.priority),
    pods: epicPods.map((p) => p.name).join(', '),
    startDate: epic.startDate,
    targetDate: epic.targetDate,
    storyCount: epicStories.length,
    doneStoryCount: doneStories.length,
    progress: progressOf(epicStories),
    description: extractEpicSummary(epic.markdown),
  };
}

/**
 * Extrae un summary corto del epic.markdown para vistas tabulares (Excel,
 * CSV, JSON). Busca el primer párrafo después del heading `## Objetivo`
 * (nuevo), con fallback a `## Descripción` (épicas creadas antes del
 * rename), o el primer párrafo de cualquier heading. Fallback a string
 * vacío.
 */
function extractEpicSummary(md: string | undefined): string {
  const text = (md ?? '').trim();
  if (!text) return '';
  const objetivoMatch = text.match(/^##\s+Objetivo\s*\n+([\s\S]*?)(?=\n##\s|$)/m);
  const descMatch = text.match(/^##\s+Descripción\s*\n+([\s\S]*?)(?=\n##\s|$)/m);
  const firstParaMatch = text.match(/^##\s+\S[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/m);
  return (objetivoMatch?.[1] ?? descMatch?.[1] ?? firstParaMatch?.[1] ?? text).trim();
}

export function storyToFlatRow(
  story: UserStory,
  epic: Epic | undefined,
  pod: Pod | undefined,
): StoryFlatRow {
  return {
    id: story.id,
    trackerKey: story.tracker?.externalKey ?? '',
    title: story.title,
    epicTitle: epic?.title ?? '',
    podName: pod?.name ?? '',
    status: statusLabel(story.status),
    storyPoints: story.storyPoints,
    sprintId: story.sprintId ?? '',
    labels: story.labels.join(', '),
  };
}

// === DOCUMENT SECTIONS (PDF / Word) ===

export function getInitiativeRelations(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
): { epics: Epic[]; stories: UserStory[] } {
  const initiativeEpics = epics.filter((e) => initiative.epicIds.includes(e.id));
  const initiativeStories = stories.filter((s) =>
    initiativeEpics.some((e) => e.id === s.epicId),
  );
  return { epics: initiativeEpics, stories: initiativeStories };
}

export function initiativeToSections(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
  pods: Pod[],
): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const { epics: initiativeEpics, stories: initiativeStories } = getInitiativeRelations(
    initiative,
    epics,
    stories,
  );

  // Resumen
  sections.push({
    level: 1,
    title: 'Resumen',
    table: {
      headers: ['Campo', 'Valor'],
      rows: [
        ['Nombre', initiative.name],
        ['Estado', statusLabel(initiative.status)],
        ['Owner', initiative.owner],
        ['Fecha de inicio', initiative.startDate ?? '—'],
        ['Fecha objetivo', initiative.targetDate ?? '—'],
        ['Total de épicas', String(initiativeEpics.length)],
        ['Total de historias', String(initiativeStories.length)],
        ['Story points totales', String(initiativeStories.reduce((s, x) => s + x.storyPoints, 0))],
        ['Progreso', `${progressOf(initiativeStories)}%`],
        ['Documentos adjuntos', String((initiative.documents ?? []).length)],
      ],
    },
  });

  // Descripción
  if (initiative.description) {
    sections.push({ level: 1, title: 'Descripción', body: initiative.description });
  }

  // Épicas
  if (initiativeEpics.length > 0) {
    sections.push({ level: 1, title: `Épicas (${initiativeEpics.length})` });
    for (const epic of initiativeEpics) {
      const epicStories = initiativeStories.filter((s) => s.epicId === epic.id);
      const epicPods = pods.filter((p) => epic.podIds.includes(p.id));
      const headerKey = epic.tracker?.externalKey ? `${epic.tracker.externalKey} — ` : '';
      sections.push({ level: 2, title: `${headerKey}${epic.title}` });
      sections.push({
        level: 3,
        title: 'Metadatos',
        table: {
          headers: ['Campo', 'Valor'],
          rows: [
            ['Estado', statusLabel(epic.status)],
            ['Prioridad', priorityLabel(epic.priority)],
            ['PODs', epicPods.map((p) => p.name).join(', ')],
            ['Fecha de inicio', epic.startDate],
            ['Fecha objetivo', epic.targetDate],
            ['Historias', String(epicStories.length)],
          ],
        },
      });
      if (epic.markdown && epic.markdown.trim().length > 0) {
        // Split por H2 para preservar la estructura (post-refactor v2).
        for (const sub of splitMarkdownByH2(epic.markdown)) {
          sections.push({ level: 3, title: sub.title, body: sub.body });
        }
      }
      if (epicStories.length > 0) {
        sections.push({
          level: 3,
          title: 'Historias',
          table: storiesTable(epicStories, pods),
        });
      }
    }
  }

  return sections;
}

export function epicToSections(
  epic: Epic,
  initiative: Initiative | null,
  pods: Pod[],
  stories: UserStory[],
): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const epicStories = stories.filter((s) => s.epicId === epic.id);
  const epicPods = pods.filter((p) => epic.podIds.includes(p.id));

  // Metadatos
  sections.push({
    level: 1,
    title: 'Metadatos',
    table: {
      headers: ['Campo', 'Valor'],
      rows: [
        ['Título', epic.title],
        ['Tracker', epic.tracker?.externalKey ?? '—'],
        ['Iniciativa', initiative?.name ?? '—'],
        ['Estado', statusLabel(epic.status)],
        ['Prioridad', priorityLabel(epic.priority)],
        ['PODs', epicPods.map((p) => p.name).join(', ')],
        ['Fecha de inicio', epic.startDate],
        ['Fecha objetivo', epic.targetDate],
        ['Creada', epic.createdAt],
        ['Actualizada', epic.updatedAt],
      ],
    },
  });

  // Markdown único de la épica — split dinámico por H2 para preservar la
  // estructura semántica (post-refactor v2).
  if (epic.markdown && epic.markdown.trim().length > 0) {
    sections.push({ level: 1, title: 'Definición' });
    for (const sub of splitMarkdownByH2(epic.markdown)) {
      sections.push({ level: 2, title: sub.title, body: sub.body });
    }
  }

  // Aprobaciones
  const approvalRows: string[][] = [];
  if (epic.poApproval) {
    approvalRows.push([
      'PO',
      statusLabel(epic.poApproval.status),
      epic.poApproval.approvedBy ?? '—',
      epic.poApproval.approvedAt ?? '—',
      epic.poApproval.comment ?? '—',
    ]);
  }
  if (epic.tlApproval) {
    approvalRows.push([
      'Tech Lead',
      statusLabel(epic.tlApproval.status),
      epic.tlApproval.approvedBy ?? '—',
      epic.tlApproval.approvedAt ?? '—',
      epic.tlApproval.comment ?? '—',
    ]);
  }
  if (epic.qaApproval) {
    approvalRows.push([
      'QA',
      statusLabel(epic.qaApproval.status),
      epic.qaApproval.approvedBy ?? '—',
      epic.qaApproval.approvedAt ?? '—',
      epic.qaApproval.comment ?? '—',
    ]);
  }
  if (approvalRows.length > 0) {
    sections.push({
      level: 1,
      title: 'Aprobaciones',
      table: {
        headers: ['Rol', 'Estado', 'Aprobado por', 'Fecha', 'Comentario'],
        rows: approvalRows,
      },
    });
  }

  // Dependencias
  if (epic.dependencies.length > 0) {
    sections.push({
      level: 1,
      title: `Dependencias (${epic.dependencies.length})`,
      table: {
        headers: ['Título', 'Tipo', 'Dirección', 'Estado', 'Severidad', 'Bloqueante', 'Owner', 'Vencimiento'],
        rows: epic.dependencies.map((d) => [
          d.title,
          d.type,
          d.direction,
          d.status,
          priorityLabel(d.severity),
          d.isBlocking ? 'Sí' : 'No',
          d.owner,
          d.dueDate ?? '—',
        ]),
      },
    });
  }

  // Diagramas (resumen de nodos/edges, no imagen)
  if (epic.diagrams.length > 0) {
    sections.push({
      level: 1,
      title: `Diagramas (${epic.diagrams.length})`,
      table: {
        headers: ['Nombre', 'Tipo', 'Nodos', 'Conexiones', 'Generado', 'Origen'],
        rows: epic.diagrams.map((d) => [
          d.name,
          d.type,
          String(d.nodes.length),
          String(d.edges.length),
          d.generatedAt,
          d.generatedBy,
        ]),
      },
    });
  }

  // Matriz QA (story-level)
  if (epic.qaMatrix) {
    const totalCases = epic.qaMatrix.rows.reduce((sum, r) => sum + r.testCases.length, 0);
    sections.push({
      level: 1,
      title: 'Matriz QA',
      body: `Historias cubiertas: ${epic.qaMatrix.rows.length}. Casos de prueba: ${totalCases}. Generada: ${epic.qaMatrix.generatedAt}.`,
    });
  }

  // Historias
  if (epicStories.length > 0) {
    sections.push({
      level: 1,
      title: `Historias (${epicStories.length})`,
      table: storiesTable(epicStories, pods),
    });
  }

  return sections;
}

export function storyToSections(
  story: UserStory,
  epic: Epic | null,
  pod: Pod | null,
): DocumentSection[] {
  const sections: DocumentSection[] = [];

  sections.push({
    level: 1,
    title: 'Metadatos',
    table: {
      headers: ['Campo', 'Valor'],
      rows: [
        ['Título', story.title],
        ['Tracker', story.tracker?.externalKey ?? '—'],
        ['Épica', epic?.title ?? '—'],
        ['POD', pod?.name ?? '—'],
        ['Estado', statusLabel(story.status)],
        ['Story points', String(story.storyPoints)],
        ['Sprint', story.sprintId ?? '—'],
        ['Labels', story.labels.join(', ') || '—'],
        ['Creada', story.createdAt],
        ['Actualizada', story.updatedAt],
      ],
    },
  });

  if (story.description) {
    sections.push({ level: 1, title: 'Descripción', body: story.description });
  }

  // PO Fields — split dinámico por encabezados ## del markdown
  sections.push({ level: 1, title: 'Definición de Negocio' });
  for (const sub of splitMarkdownByH2(story.po.markdown ?? '')) {
    sections.push({ level: 2, title: sub.title, body: sub.body });
  }

  // Technical Fields
  sections.push({ level: 1, title: 'Técnico' });
  for (const sub of splitMarkdownByH2(story.technical.markdown ?? '')) {
    sections.push({ level: 2, title: sub.title, body: sub.body });
  }

  // QA Fields
  sections.push({ level: 1, title: 'QA' });
  for (const sub of splitMarkdownByH2(story.qa.markdown ?? '')) {
    sections.push({ level: 2, title: sub.title, body: sub.body });
  }

  return sections;
}

/**
 * Split de un markdown por encabezados level-2 (`## Título`). Cada sub-sección
 * preserva el body desde el inicio del heading hasta el siguiente ## (o EOF).
 *
 * Si el markdown no tiene ningún `## ` (texto plano), retorna un único bloque
 * sin título — el caller decide si lo emite con un `level: 2` genérico.
 */
export function splitMarkdownByH2(md: string): Array<{ title: string; body: string }> {
  const text = (md ?? '').trim();
  if (!text) return [];
  const out: Array<{ title: string; body: string }> = [];
  const re = /^##\s+(.+?)\s*$/gm;
  const headings: Array<{ title: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    headings.push({ title: m[1].trim(), start: m.index, bodyStart: m.index + m[0].length });
  }
  if (headings.length === 0) {
    out.push({ title: 'Contenido', body: text });
    return out;
  }
  // Si hay contenido antes del primer ##, lo emitimos como "Resumen"
  const preamble = text.slice(0, headings[0].start).trim();
  if (preamble) out.push({ title: 'Resumen', body: preamble });
  for (let i = 0; i < headings.length; i++) {
    const end = i + 1 < headings.length ? headings[i + 1].start : text.length;
    const body = text.slice(headings[i].bodyStart, end).trim();
    out.push({ title: headings[i].title, body });
  }
  return out;
}

function storiesTable(stories: UserStory[], pods: Pod[]) {
  return {
    headers: ['Key', 'Título', 'Estado', 'SP', 'POD'],
    rows: stories.map((s) => {
      const pod = pods.find((p) => p.id === s.podId);
      return [
        s.tracker?.externalKey ?? '—',
        s.title,
        statusLabel(s.status),
        String(s.storyPoints),
        pod?.name ?? '—',
      ];
    }),
  };
}

// === JSON SHAPES ===

export function initiativeToJsonShape(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
  pods: Pod[],
): InitiativeJsonShape {
  const { epics: initiativeEpics, stories: initiativeStories } = getInitiativeRelations(
    initiative,
    epics,
    stories,
  );
  return {
    initiative,
    epics: initiativeEpics.map((epic) => ({
      ...epic,
      stories: initiativeStories.filter((s) => s.epicId === epic.id),
    })),
    pods: pods.filter((p) => initiativeEpics.some((e) => e.podIds.includes(p.id))),
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
}

export function epicToJsonShape(
  epic: Epic,
  initiative: Initiative | null,
  pods: Pod[],
  stories: UserStory[],
): EpicJsonShape {
  return {
    epic,
    initiative,
    pods: pods.filter((p) => epic.podIds.includes(p.id)),
    stories: stories.filter((s) => s.epicId === epic.id),
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
}

export function storyToJsonShape(
  story: UserStory,
  epic: Epic | null,
  pod: Pod | null,
): StoryJsonShape {
  return {
    story,
    epic,
    pod,
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
}
