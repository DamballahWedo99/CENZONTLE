'use client';

import React, { createContext, useContext, useReducer, useMemo, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  Initiative, Epic, UserStory, Pod, Sprint, ChangelogEntry,
  SprintCeremony, InitiativeStatus, EpicStatus as SharedEpicStatus, Priority,
  ProyectosFilters, DEFAULT_FILTERS, EpicWithRelations, MatrizRow, MatrizCell,
  StoryStatus, EpicStatus, ChangelogAction, ChangelogEntityType, QAMatrix, EpicQAMatrix,
} from '@cenzontle/shared';
import {
  mockSprints, mockCeremonies,
} from '@/data/mock/proyectos';
import { getInitiatives, createInitiative as apiCreateInitiative, updateInitiative as apiUpdateInitiative } from '@/lib/api/initiatives';
import { getEpics, createEpic as apiCreateEpic, updateEpic as apiUpdateEpic } from '@/lib/api/epics';
import { getStories, type StoryResponse } from '@/lib/api/stories';
import { getPods } from '@/lib/api/pods';
import { useAuthContext } from '@/context/AuthContext';
import { getChangelog, createChangelogEntry as apiCreateChangelog, type ChangelogEntryResponse } from '@/lib/api/changelog';
import type { InitiativeResponse } from '@/lib/api/initiatives';
import type { EpicResponse } from '@/lib/api/epics';
import type { PodResponse } from '@/lib/api/pods';

// === API → Domain mappers ===
function toDateStr(iso: string): string {
  return iso ? iso.slice(0, 10) : '';
}

function mapInitiative(r: InitiativeResponse): Initiative {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status as InitiativeStatus,
    // Las fechas son opcionales — null si la iniciativa está en planning
    // sin fechas comprometidas. Preservamos null para que la UI muestre
    // estados consistentes ("Sin fechas (borrador)" vs valor real).
    startDate: r.startDate ? toDateStr(r.startDate) : null,
    targetDate: r.targetDate ? toDateStr(r.targetDate) : null,
    owner: r.owner,
    epicIds: r.epics.map((e) => e.id),
    documents: r.documents ?? [],
    tracker: r.tracker ?? undefined,
  };
}

export function mapEpic(r: EpicResponse): Epic {
  return {
    ...r,
    status: r.status as SharedEpicStatus,
    priority: r.priority as Priority,
    startDate: toDateStr(r.startDate),
    targetDate: toDateStr(r.targetDate),
    documents: r.documents ?? [],
    diagrams: r.diagrams ?? [],
    dependencies: r.dependencies ?? [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  } as Epic;
}

function mapPod(r: PodResponse): Pod {
  return { id: r.id, name: r.name, description: r.description, color: r.color };
}

function mapStory(r: StoryResponse): UserStory {
  // El list endpoint solo retorna metadata — el contenido markdown vive en el
  // vault y se carga via `getStory(id, true)` en `StoryFullPage`. Aquí
  // inicializamos los 3 markdowns vacíos en shape v2; los consumers que
  // necesiten contenido completo deben pasar por la story page o por
  // `mergeStoryContent` (DownloadMenu).
  return {
    id: r.id,
    title: r.title,
    description: '',
    po: { markdown: '' },
    technical: { markdown: '' },
    qa: { markdown: '' },
    status: r.status as StoryStatus,
    storyPoints: r.storyPoints as 1 | 2 | 3 | 5 | 8 | 13,
    epicId: r.epicId,
    podId: r.podId,
    sprintId: r.sprintId,
    labels: r.labels ?? [],
    tracker: r.tracker ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapChangelog(r: ChangelogEntryResponse): ChangelogEntry {
  return {
    id: r.id,
    timestamp: r.timestamp,
    entityType: r.entityType as ChangelogEntityType,
    entityId: r.entityId,
    entityTitle: r.entityTitle,
    action: r.action as ChangelogAction,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    changedBy: r.changedByName ? { id: r.changedById ?? '', name: r.changedByName, avatarUrl: '' } : { id: '', name: 'Sistema', avatarUrl: '' },
    changeReason: null,
  };
}

// === STATE ===
interface ProyectosState {
  initiatives: Initiative[];
  epics: Epic[];
  stories: UserStory[];
  pods: Pod[];
  sprints: Sprint[];
  ceremonies: SprintCeremony[];
  changelog: ChangelogEntry[];
  filters: ProyectosFilters;
  activeTab: 'overview' | 'epicas' | 'historias';
  currentUserId: string;
  currentUserName: string;
  loading: boolean;
  error: string | null;
}

const initialState: ProyectosState = {
  initiatives: [],
  epics: [],
  stories: [],
  pods: [],
  sprints: mockSprints,
  ceremonies: mockCeremonies,
  changelog: [],
  filters: DEFAULT_FILTERS,
  activeTab: 'overview',
  currentUserId: '',
  currentUserName: 'Sistema',
  loading: true,
  error: null,
};

// === CHANGELOG HELPER ===
function createChangelogEntry(
  entityType: ChangelogEntityType,
  entityId: string,
  entityTitle: string,
  action: ChangelogAction,
  field: string | null,
  oldValue: string | null,
  newValue: string | null,
  userName?: string,
): ChangelogEntry {
  return {
    id: `cl-auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    entityType,
    entityId,
    entityTitle,
    action,
    field,
    oldValue,
    newValue,
    changedBy: { id: 'current-user', name: userName ?? _currentUserName, avatarUrl: '' },
    changeReason: null,
  };
}

// Module-level ref updated by the provider — lets the pure helper access the user name
let _currentUserName = 'Sistema';

// === ACTIONS ===
type ProyectosAction =
  | { type: 'LOAD_DATA'; payload: { initiatives: Initiative[]; epics: Epic[]; stories: UserStory[]; pods: Pod[]; changelog: ChangelogEntry[]; currentUserName: string } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_FILTERS'; payload: Partial<ProyectosFilters> }
  | { type: 'RESET_FILTERS' }
  | { type: 'SET_ACTIVE_TAB'; payload: ProyectosState['activeTab'] }
  | { type: 'UPDATE_INITIATIVE'; payload: { id: string; changes: Partial<Initiative> } }
  | { type: 'UPDATE_EPIC'; payload: { id: string; changes: Partial<Epic> } }
  | { type: 'CREATE_EPIC'; payload: Epic }
  | { type: 'CREATE_INITIATIVE'; payload: Initiative }
  | { type: 'CREATE_STORY'; payload: UserStory }
  | { type: 'UPDATE_STORY'; payload: { id: string; changes: Partial<UserStory> } }
  | { type: 'DELETE_STORY'; payload: { id: string } }
  | { type: 'DELETE_EPIC'; payload: { id: string } }
  | { type: 'DELETE_INITIATIVE'; payload: { id: string } }
  | { type: 'SAVE_EPIC_DIAGRAM'; payload: { epicId: string; diagram: import('@cenzontle/shared').EpicDiagram } }
  | { type: 'BULK_CREATE_STORIES'; payload: { epicId: string; stories: UserStory[] } }
  | { type: 'APPROVE_EPIC_STORIES'; payload: { epicId: string; poId: string; poName: string } }
  | { type: 'REJECT_EPIC_STORIES'; payload: { epicId: string; poId: string; poName: string; comment: string } }
  | { type: 'APPROVE_EPIC_DIAGRAM_TL'; payload: { epicId: string; tlName: string } }
  | { type: 'REJECT_EPIC_DIAGRAM_TL'; payload: { epicId: string; tlName: string; comment: string } }
  | { type: 'UPDATE_EPIC_DIAGRAM'; payload: { epicId: string; diagram: import('@cenzontle/shared').EpicDiagram } }
  | { type: 'SAVE_QA_MATRIX'; payload: { epicId: string; matrix: QAMatrix } }
  | { type: 'UPDATE_QA_MATRIX'; payload: { epicId: string; matrix: QAMatrix } }
  | { type: 'APPROVE_EPIC_QA'; payload: { epicId: string; qaName: string } }
  | { type: 'REJECT_EPIC_QA'; payload: { epicId: string; qaName: string; comment: string } }
  | { type: 'SAVE_EPIC_QA_MATRIX'; payload: { epicId: string; matrix: EpicQAMatrix } }
  | { type: 'UPDATE_EPIC_QA_MATRIX'; payload: { epicId: string; matrix: EpicQAMatrix } }
  | { type: 'ADD_EPIC_DOCUMENT'; payload: { epicId: string; document: import('@cenzontle/shared').EpicDocument } }
  | { type: 'UPDATE_EPIC_DOCUMENT'; payload: { epicId: string; document: import('@cenzontle/shared').EpicDocument } }
  | { type: 'DELETE_EPIC_DOCUMENT'; payload: { epicId: string; documentId: string } }
  | { type: 'ADD_INITIATIVE_DOCUMENT'; payload: { initiativeId: string; document: import('@cenzontle/shared').EpicDocument } }
  | { type: 'UPDATE_INITIATIVE_DOCUMENT'; payload: { initiativeId: string; document: import('@cenzontle/shared').EpicDocument } }
  | { type: 'DELETE_INITIATIVE_DOCUMENT'; payload: { initiativeId: string; documentId: string } }
  | { type: 'ADD_EPIC_DEPENDENCY'; payload: { epicId: string; dependency: import('@cenzontle/shared').EpicDependency } }
  | { type: 'UPDATE_EPIC_DEPENDENCY'; payload: { epicId: string; dependency: import('@cenzontle/shared').EpicDependency } }
  | { type: 'DELETE_EPIC_DEPENDENCY'; payload: { epicId: string; dependencyId: string } }
  | { type: 'ADD_EPIC_DESIGN'; payload: { epicId: string; design: import('@cenzontle/shared').EpicDesign } }
  | { type: 'UPDATE_EPIC_DESIGN'; payload: { epicId: string; design: import('@cenzontle/shared').EpicDesign } }
  | { type: 'DELETE_EPIC_DESIGN'; payload: { epicId: string; designId: string } }
  | { type: 'TOGGLE_EPIC_DESIGN_SKIP'; payload: { epicId: string; skipped: boolean } }
  | { type: 'SET_CURRENT_USER'; payload: string };

function proyectosReducer(state: ProyectosState, action: ProyectosAction): ProyectosState {
  switch (action.type) {
    case 'LOAD_DATA': {
      const { initiatives, epics, stories, pods, changelog, currentUserName } = action.payload;
      return { ...state, initiatives, epics, stories, pods, changelog, currentUserName, loading: false, error: null };
    }
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    case 'SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.payload } };
    case 'RESET_FILTERS':
      return { ...state, filters: DEFAULT_FILTERS };
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
    case 'UPDATE_INITIATIVE': {
      const { id, changes } = action.payload;
      const old = state.initiatives.find((i) => i.id === id);
      if (!old) return state;
      const newChangelog = Object.entries(changes).map(([field, newVal]) => {
        const oldVal = String(old[field as keyof Initiative] ?? '');
        return createChangelogEntry(
          ChangelogEntityType.Initiative, id, old.name,
          ChangelogAction.Updated, field, oldVal, String(newVal),
        );
      });
      return {
        ...state,
        initiatives: state.initiatives.map((i) => i.id === id ? { ...i, ...changes } : i),
        changelog: [...newChangelog, ...state.changelog],
      };
    }
    case 'UPDATE_EPIC': {
      const { id, changes } = action.payload;
      const old = state.epics.find((e) => e.id === id);
      if (!old) return state;
      const newChangelog = Object.entries(changes).map(([field, newVal]) => {
        const oldVal = String(old[field as keyof Epic] ?? '');
        return createChangelogEntry(
          ChangelogEntityType.Epic, id, old.title,
          ChangelogAction.Updated, field, oldVal, String(newVal),
        );
      });
      return {
        ...state,
        epics: state.epics.map((e) => e.id === id ? { ...e, ...changes, updatedAt: new Date().toISOString() } : e),
        changelog: [...newChangelog, ...state.changelog],
      };
    }
    case 'CREATE_EPIC': {
      const epic = action.payload;
      const initiative = state.initiatives.find((i) => i.id === epic.initiativeId);
      const updatedInitiatives = initiative
        ? state.initiatives.map((i) =>
            i.id === epic.initiativeId
              ? { ...i, epicIds: [...i.epicIds, epic.id] }
              : i
          )
        : state.initiatives;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epic.id, epic.title,
        ChangelogAction.Created, null, null, null,
      );
      return {
        ...state,
        epics: [...state.epics, epic],
        initiatives: updatedInitiatives,
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'CREATE_INITIATIVE': {
      const initiative = action.payload;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Initiative, initiative.id, initiative.name,
        ChangelogAction.Created, null, null, null,
      );
      return {
        ...state,
        initiatives: [...state.initiatives, initiative],
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'CREATE_STORY': {
      const story = action.payload;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Story, story.id, story.title,
        ChangelogAction.Created, null, null, null,
      );
      return {
        ...state,
        stories: [...state.stories, story],
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'UPDATE_STORY': {
      const { id, changes } = action.payload;
      const oldStory = state.stories.find((s) => s.id === id);
      if (!oldStory) return state;
      const updatedStory = { ...oldStory, ...changes, updatedAt: new Date().toISOString() };
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Story, id, updatedStory.title,
        ChangelogAction.Updated, null, null, null,
      );
      return {
        ...state,
        stories: state.stories.map((s) => s.id === id ? updatedStory : s),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'DELETE_STORY': {
      const { id } = action.payload;
      const story = state.stories.find((s) => s.id === id);
      if (!story) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Story, id, story.title,
        ChangelogAction.Deleted, null, null, null,
      );
      return {
        ...state,
        stories: state.stories.filter((s) => s.id !== id),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'DELETE_EPIC': {
      // Cascada: al borrar la épica, también purgamos sus historias huérfanas
      // en memoria. La DB ya maneja la cascada real; esto mantiene el state sync.
      const { id } = action.payload;
      const epic = state.epics.find((e) => e.id === id);
      if (!epic) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, id, epic.title,
        ChangelogAction.Deleted, null, null, null,
      );
      return {
        ...state,
        epics: state.epics.filter((e) => e.id !== id),
        stories: state.stories.filter((s) => s.epicId !== id),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'DELETE_INITIATIVE': {
      // Cascada doble: la iniciativa → sus épicas → sus historias.
      const { id } = action.payload;
      const initiative = state.initiatives.find((i) => i.id === id);
      if (!initiative) return state;
      const orphanedEpicIds = new Set(
        state.epics.filter((e) => e.initiativeId === id).map((e) => e.id),
      );
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Initiative, id, initiative.name,
        ChangelogAction.Deleted, null, null, null,
      );
      return {
        ...state,
        initiatives: state.initiatives.filter((i) => i.id !== id),
        epics: state.epics.filter((e) => e.initiativeId !== id),
        stories: state.stories.filter((s) => !orphanedEpicIds.has(s.epicId)),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'SAVE_EPIC_DIAGRAM': {
      const { epicId, diagram } = action.payload;
      return {
        ...state,
        epics: state.epics.map((e) => {
          if (e.id !== epicId) return e;
          const filtered = e.diagrams.filter((d) => d.type !== diagram.type);
          return { ...e, diagrams: [...filtered, diagram], updatedAt: new Date().toISOString() };
        }),
      };
    }
    case 'BULK_CREATE_STORIES': {
      const { epicId, stories } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      const changelogEntries = stories.map((story) =>
        createChangelogEntry(
          ChangelogEntityType.Story, story.id, story.title,
          ChangelogAction.Created, null, null, null,
        )
      );
      const epicChangelogEntry = epic
        ? createChangelogEntry(
            ChangelogEntityType.Epic, epicId, epic.title,
            ChangelogAction.Updated, 'historias', '0', String(stories.length),
          )
        : null;
      return {
        ...state,
        stories: [...state.stories, ...stories],
        changelog: [...(epicChangelogEntry ? [epicChangelogEntry] : []), ...changelogEntries, ...state.changelog],
      };
    }
    case 'APPROVE_EPIC_STORIES': {
      const { epicId, poName } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const approval = {
        status: 'approved' as const,
        approvedBy: poName,
        approvedAt: new Date().toISOString(),
        comment: null,
      };
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Approved, 'aprobación PO', null, `Aprobado por ${poName}`,
      );
      return {
        ...state,
        epics: state.epics.map((e) => e.id === epicId ? { ...e, poApproval: approval, updatedAt: new Date().toISOString() } : e),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'REJECT_EPIC_STORIES': {
      const { epicId, poName, comment } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const rejection = {
        status: 'rejected' as const,
        approvedBy: poName,
        approvedAt: new Date().toISOString(),
        comment,
      };
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Rejected, 'aprobación PO', null, `Rechazado por ${poName}: ${comment}`,
      );
      return {
        ...state,
        epics: state.epics.map((e) => e.id === epicId ? { ...e, poApproval: rejection, updatedAt: new Date().toISOString() } : e),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'APPROVE_EPIC_DIAGRAM_TL': {
      const { epicId, tlName } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const approval = {
        status: 'approved' as const,
        approvedBy: tlName,
        approvedAt: new Date().toISOString(),
        comment: null,
      };
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Approved, 'aprobación TL (diagrama)', null, `Diagrama aprobado por ${tlName}`,
      );
      return {
        ...state,
        epics: state.epics.map((e) => e.id === epicId ? { ...e, tlApproval: approval, updatedAt: new Date().toISOString() } : e),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'REJECT_EPIC_DIAGRAM_TL': {
      const { epicId, tlName, comment } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const rejection = {
        status: 'rejected' as const,
        approvedBy: tlName,
        approvedAt: new Date().toISOString(),
        comment,
      };
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Rejected, 'aprobación TL (diagrama)', null, `Diagrama rechazado por ${tlName}: ${comment}`,
      );
      return {
        ...state,
        epics: state.epics.map((e) => e.id === epicId ? { ...e, tlApproval: rejection, updatedAt: new Date().toISOString() } : e),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'UPDATE_EPIC_DIAGRAM': {
      const { epicId, diagram } = action.payload;
      return {
        ...state,
        epics: state.epics.map((e) => {
          if (e.id !== epicId) return e;
          const filtered = e.diagrams.filter((d) => d.type !== diagram.type);
          return { ...e, diagrams: [...filtered, diagram], tlApproval: null, updatedAt: new Date().toISOString() };
        }),
      };
    }
    case 'SAVE_QA_MATRIX': {
      const { epicId, matrix } = action.payload;
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId ? { ...e, qaMatrix: matrix, updatedAt: new Date().toISOString() } : e
        ),
      };
    }
    case 'UPDATE_QA_MATRIX': {
      const { epicId, matrix } = action.payload;
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId ? { ...e, qaMatrix: matrix, qaApproval: null, updatedAt: new Date().toISOString() } : e
        ),
      };
    }
    case 'APPROVE_EPIC_QA': {
      const { epicId, qaName } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const approval = {
        status: 'approved' as const,
        approvedBy: qaName,
        approvedAt: new Date().toISOString(),
        comment: null,
      };
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Approved, 'aprobación QA', null, `Matriz QA aprobada por ${qaName}`,
      );
      return {
        ...state,
        epics: state.epics.map((e) => e.id === epicId ? { ...e, qaApproval: approval, updatedAt: new Date().toISOString() } : e),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'REJECT_EPIC_QA': {
      const { epicId, qaName, comment } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const rejection = {
        status: 'rejected' as const,
        approvedBy: qaName,
        approvedAt: new Date().toISOString(),
        comment,
      };
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Rejected, 'aprobación QA', null, `Matriz QA rechazada por ${qaName}: ${comment}`,
      );
      return {
        ...state,
        epics: state.epics.map((e) => e.id === epicId ? { ...e, qaApproval: rejection, updatedAt: new Date().toISOString() } : e),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'SAVE_EPIC_QA_MATRIX': {
      const { epicId, matrix } = action.payload;
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId ? { ...e, epicQAMatrix: matrix, updatedAt: new Date().toISOString() } : e
        ),
      };
    }
    case 'UPDATE_EPIC_QA_MATRIX': {
      const { epicId, matrix } = action.payload;
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId ? { ...e, epicQAMatrix: matrix, qaApproval: null, updatedAt: new Date().toISOString() } : e
        ),
      };
    }
    case 'ADD_EPIC_DOCUMENT': {
      const { epicId, document } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Created, 'documento', null, document.name,
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId ? { ...e, documents: [...e.documents, document], updatedAt: new Date().toISOString() } : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'UPDATE_EPIC_DOCUMENT': {
      const { epicId, document } = action.payload;
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId
            ? { ...e, documents: e.documents.map((d) => d.id === document.id ? document : d), updatedAt: new Date().toISOString() }
            : e
        ),
      };
    }
    case 'DELETE_EPIC_DOCUMENT': {
      const { epicId, documentId } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const doc = epic.documents.find((d) => d.id === documentId);
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Deleted, 'documento', doc?.name ?? documentId, null,
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId
            ? { ...e, documents: e.documents.filter((d) => d.id !== documentId), updatedAt: new Date().toISOString() }
            : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'ADD_INITIATIVE_DOCUMENT': {
      const { initiativeId, document } = action.payload;
      const ini = state.initiatives.find((i) => i.id === initiativeId);
      if (!ini) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Initiative, initiativeId, ini.name,
        ChangelogAction.Created, 'documento', null, document.name,
      );
      return {
        ...state,
        initiatives: state.initiatives.map((i) =>
          i.id === initiativeId ? { ...i, documents: [...(i.documents ?? []), document] } : i
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'UPDATE_INITIATIVE_DOCUMENT': {
      const { initiativeId, document } = action.payload;
      return {
        ...state,
        initiatives: state.initiatives.map((i) =>
          i.id === initiativeId
            ? { ...i, documents: (i.documents ?? []).map((d) => d.id === document.id ? document : d) }
            : i
        ),
      };
    }
    case 'DELETE_INITIATIVE_DOCUMENT': {
      const { initiativeId, documentId } = action.payload;
      const ini = state.initiatives.find((i) => i.id === initiativeId);
      if (!ini) return state;
      const doc = (ini.documents ?? []).find((d) => d.id === documentId);
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Initiative, initiativeId, ini.name,
        ChangelogAction.Deleted, 'documento', doc?.name ?? documentId, null,
      );
      return {
        ...state,
        initiatives: state.initiatives.map((i) =>
          i.id === initiativeId
            ? { ...i, documents: (i.documents ?? []).filter((d) => d.id !== documentId) }
            : i
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'ADD_EPIC_DEPENDENCY': {
      const { epicId, dependency } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Created, 'dependencia', null, dependency.targetEpicId,
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId ? { ...e, dependencies: [...e.dependencies, dependency], updatedAt: new Date().toISOString() } : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'UPDATE_EPIC_DEPENDENCY': {
      const { epicId, dependency } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Updated, 'dependencia', null, dependency.targetEpicId,
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId
            ? { ...e, dependencies: e.dependencies.map((d) => d.id === dependency.id ? dependency : d), updatedAt: new Date().toISOString() }
            : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'DELETE_EPIC_DEPENDENCY': {
      const { epicId, dependencyId } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const dep = epic.dependencies.find((d) => d.id === dependencyId);
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Deleted, 'dependencia', dep?.targetEpicId ?? dependencyId, null,
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId
            ? { ...e, dependencies: e.dependencies.filter((d) => d.id !== dependencyId), updatedAt: new Date().toISOString() }
            : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'ADD_EPIC_DESIGN': {
      const { epicId, design } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Created, 'diseño', null, design.name,
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId ? { ...e, designs: [...(e.designs ?? []), design], updatedAt: new Date().toISOString() } : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'UPDATE_EPIC_DESIGN': {
      const { epicId, design } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Updated, 'diseño', null, design.name,
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId
            ? { ...e, designs: (e.designs ?? []).map((d) => d.id === design.id ? design : d), updatedAt: new Date().toISOString() }
            : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'DELETE_EPIC_DESIGN': {
      const { epicId, designId } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const design = (epic.designs ?? []).find((d) => d.id === designId);
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Deleted, 'diseño', design?.name ?? designId, null,
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId
            ? { ...e, designs: (e.designs ?? []).filter((d) => d.id !== designId), updatedAt: new Date().toISOString() }
            : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'TOGGLE_EPIC_DESIGN_SKIP': {
      const { epicId, skipped } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const changelogEntry = createChangelogEntry(
        ChangelogEntityType.Epic, epicId, epic.title,
        ChangelogAction.Updated, 'requiere diseño', epic.designSkipped ? 'no' : 'sí', skipped ? 'no' : 'sí',
      );
      return {
        ...state,
        epics: state.epics.map((e) =>
          e.id === epicId ? { ...e, designSkipped: skipped, updatedAt: new Date().toISOString() } : e
        ),
        changelog: [changelogEntry, ...state.changelog],
      };
    }
    case 'SET_CURRENT_USER':
      return { ...state, currentUserId: action.payload };
    default:
      return state;
  }
}

// === CONTEXT ===
interface ProyectosContextValue {
  state: ProyectosState;
  dispatch: React.Dispatch<ProyectosAction>;
  reload: () => Promise<void>;
  // Computed values
  filteredStories: UserStory[];
  filteredEpics: Epic[];
  epicsWithRelations: EpicWithRelations[];
  matrizRows: MatrizRow[];
  // Stats
  stats: {
    totalInitiatives: number;
    totalEpics: number;
    totalStories: number;
    totalStoryPoints: number;
    doneStories: number;
    doneStoryPoints: number;
    blockedStories: number;
    inProgressStories: number;
    overallProgress: number;
  };
}

const ProyectosContext = createContext<ProyectosContextValue | null>(null);

// === PROVIDER ===
export function ProyectosProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(proyectosReducer, initialState);
  const { currentUser } = useAuthContext();

  // Keep module-level user name in sync for the changelog helper
  _currentUserName = currentUser?.name || 'Sistema';

  // Fetch all data from API. Exposed as `reload` so consumers (e.g. vault switch) can trigger it.
  const reload = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const [initiativesRaw, epicsRaw, storiesRaw, podsRaw, changelogRaw] = await Promise.all([
        getInitiatives(),
        getEpics(),
        getStories(),
        getPods(),
        getChangelog(),
      ]);
      dispatch({
        type: 'LOAD_DATA',
        payload: {
          initiatives: initiativesRaw.map(mapInitiative),
          epics: epicsRaw.map(mapEpic),
          stories: storiesRaw.map(mapStory),
          pods: podsRaw.map(mapPod),
          changelog: changelogRaw.map(mapChangelog),
          currentUserName: currentUser?.name || 'Sistema',
        },
      });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Error cargando datos' });
    }
  }, [currentUser?.name]);

  // Fetch on mount
  useEffect(() => {
    reload();
  }, []);

  // Persist new changelog entries to backend (deduped)
  const persistedIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const newEntries = state.changelog.filter(
      (e) => e.id.startsWith('cl-auto-') && !persistedIdsRef.current.has(e.id),
    );
    for (const entry of newEntries) {
      persistedIdsRef.current.add(entry.id);
      apiCreateChangelog({
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityTitle: entry.entityTitle,
        action: entry.action,
        field: entry.field ?? undefined,
        oldValue: entry.oldValue ?? undefined,
        newValue: entry.newValue ?? undefined,
      }).catch(() => {});
    }
  }, [state.changelog, currentUser]);

  const filteredStories = useMemo(() => {
    const { filters, stories } = state;
    return stories.filter((story) => {
      if (filters.initiativeIds.length > 0) {
        const epic = state.epics.find((e) => e.id === story.epicId);
        if (!epic || !filters.initiativeIds.includes(epic.initiativeId)) return false;
      }
      if (filters.podIds.length > 0 && !filters.podIds.includes(story.podId)) return false;
      if (filters.statuses.length > 0 && !filters.statuses.includes(story.status)) return false;
      if (filters.priorities.length > 0) {
        const epic = state.epics.find((e) => e.id === story.epicId);
        if (!epic || !filters.priorities.includes(epic.priority)) return false;
      }
      if (filters.sprintId && story.sprintId !== filters.sprintId) return false;
      if (filters.storyPointsRange.min !== null && story.storyPoints < filters.storyPointsRange.min) return false;
      if (filters.storyPointsRange.max !== null && story.storyPoints > filters.storyPointsRange.max) return false;
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase();
        if (!story.title.toLowerCase().includes(q) && !story.description.toLowerCase().includes(q)) return false;
      }
      if (filters.trackerKey && (!story.tracker?.externalKey || !story.tracker.externalKey.toLowerCase().includes(filters.trackerKey.toLowerCase()))) return false;
      return true;
    });
  }, [state]);

  const filteredEpics = useMemo(() => {
    const { filters, epics } = state;
    return epics.filter((epic) => {
      if (filters.initiativeIds.length > 0 && !filters.initiativeIds.includes(epic.initiativeId)) return false;
      if (filters.podIds.length > 0 && !filters.podIds.some((pid) => epic.podIds.includes(pid))) return false;
      if (filters.epicStatuses.length > 0 && !filters.epicStatuses.includes(epic.status)) return false;
      if (filters.priorities.length > 0 && !filters.priorities.includes(epic.priority)) return false;
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase();
        // Search en title + markdown completo (post-refactor v2 reemplaza description).
        if (!epic.title.toLowerCase().includes(q) && !(epic.markdown ?? '').toLowerCase().includes(q)) return false;
      }
      if (filters.trackerKey && (!epic.tracker?.externalKey || !epic.tracker.externalKey.toLowerCase().includes(filters.trackerKey.toLowerCase()))) return false;
      return true;
    });
  }, [state]);

  const epicsWithRelations = useMemo(() => {
    return filteredEpics.map((epic) => {
      const initiative = state.initiatives.find((i) => i.id === epic.initiativeId)!;
      const pods = state.pods.filter((p) => epic.podIds.includes(p.id));
      const stories = state.stories.filter((s) => s.epicId === epic.id);
      const doneStories = stories.filter((s) => s.status === StoryStatus.Done).length;
      const progress = stories.length > 0 ? Math.round((doneStories / stories.length) * 100) : 0;
      return { ...epic, initiative, pods, stories, progress };
    });
  }, [filteredEpics, state.initiatives, state.pods, state.stories]);

  const matrizRows = useMemo((): MatrizRow[] => {
    return filteredEpics.map((epic) => {
      const initiative = state.initiatives.find((i) => i.id === epic.initiativeId)!;
      const cells: Record<string, MatrizCell> = {};

      state.pods.forEach((pod) => {
        const podStories = filteredStories.filter(
          (s) => s.epicId === epic.id && s.podId === pod.id
        );
        const doneStories = podStories.filter((s) => s.status === StoryStatus.Done);
        const blockedStories = podStories.filter((s) => s.status === StoryStatus.Blocked);
        const totalPoints = podStories.reduce((sum, s) => sum + s.storyPoints, 0);
        const donePoints = doneStories.reduce((sum, s) => sum + s.storyPoints, 0);

        cells[pod.id] = {
          podId: pod.id,
          epicId: epic.id,
          stories: podStories,
          totalStories: podStories.length,
          doneStories: doneStories.length,
          blockedStories: blockedStories.length,
          totalPoints,
          donePoints,
          progress: totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0,
        };
      });

      return { epic, initiative, cells };
    });
  }, [filteredEpics, filteredStories, state.initiatives, state.pods]);

  const stats = useMemo(() => {
    const allStories = state.stories;
    const doneStories = allStories.filter((s) => s.status === StoryStatus.Done);
    const totalPoints = allStories.reduce((sum, s) => sum + s.storyPoints, 0);
    const donePoints = doneStories.reduce((sum, s) => sum + s.storyPoints, 0);

    return {
      totalInitiatives: state.initiatives.length,
      totalEpics: state.epics.length,
      totalStories: allStories.length,
      totalStoryPoints: totalPoints,
      doneStories: doneStories.length,
      doneStoryPoints: donePoints,
      blockedStories: allStories.filter((s) => s.status === StoryStatus.Blocked).length,
      inProgressStories: allStories.filter((s) => s.status === StoryStatus.InProgress).length,
      overallProgress: totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0,
    };
  }, [state.initiatives, state.epics, state.stories]);

  const value = useMemo(
    () => ({ state, dispatch, reload, filteredStories, filteredEpics, epicsWithRelations, matrizRows, stats }),
    [state, dispatch, reload, filteredStories, filteredEpics, epicsWithRelations, matrizRows, stats]
  );

  return (
    <ProyectosContext.Provider value={value}>
      {children}
    </ProyectosContext.Provider>
  );
}

export function useProyectos() {
  const context = useContext(ProyectosContext);
  if (!context) {
    throw new Error('useProyectos must be used within a ProyectosProvider');
  }
  return context;
}
