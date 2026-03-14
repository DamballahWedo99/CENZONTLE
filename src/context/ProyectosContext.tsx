'use client';

import React, { createContext, useContext, useReducer, useMemo, ReactNode } from 'react';
import {
  Initiative, Epic, UserStory, Pod, ProductOwner, Sprint, ChangelogEntry,
  ProyectosFilters, DEFAULT_FILTERS, EpicWithRelations, MatrizRow, MatrizCell,
  StoryStatus, EpicStatus, ChangelogAction, ChangelogEntityType, QAMatrix,
} from '@/types/proyectos';
import {
  mockInitiatives, mockEpics, mockStories, mockPods,
  mockProductOwners, mockSprints, mockChangelog,
} from '@/data/mock/proyectos';

// === STATE ===
interface ProyectosState {
  initiatives: Initiative[];
  epics: Epic[];
  stories: UserStory[];
  pods: Pod[];
  productOwners: ProductOwner[];
  sprints: Sprint[];
  changelog: ChangelogEntry[];
  filters: ProyectosFilters;
  activeTab: 'overview' | 'epicas' | 'historias';
  currentUserId: string; // simulates the logged-in PO
}

const initialState: ProyectosState = {
  initiatives: mockInitiatives,
  epics: mockEpics,
  stories: mockStories,
  pods: mockPods,
  productOwners: mockProductOwners,
  sprints: mockSprints,
  changelog: mockChangelog,
  filters: DEFAULT_FILTERS,
  activeTab: 'overview',
  currentUserId: 'po-1', // Carlos Méndez — simulated logged-in user
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
    changedBy: { id: 'current-user', name: 'Usuario Actual', avatarUrl: '' },
    changeReason: null,
  };
}

// === ACTIONS ===
type ProyectosAction =
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
  | { type: 'SAVE_EPIC_DIAGRAM'; payload: { epicId: string; diagram: import('@/types/proyectos').EpicDiagram } }
  | { type: 'BULK_CREATE_STORIES'; payload: { epicId: string; stories: UserStory[] } }
  | { type: 'APPROVE_EPIC_STORIES'; payload: { epicId: string; poId: string; poName: string } }
  | { type: 'REJECT_EPIC_STORIES'; payload: { epicId: string; poId: string; poName: string; comment: string } }
  | { type: 'APPROVE_EPIC_DIAGRAM_TL'; payload: { epicId: string; tlName: string } }
  | { type: 'REJECT_EPIC_DIAGRAM_TL'; payload: { epicId: string; tlName: string; comment: string } }
  | { type: 'UPDATE_EPIC_DIAGRAM'; payload: { epicId: string; diagram: import('@/types/proyectos').EpicDiagram } }
  | { type: 'SAVE_QA_MATRIX'; payload: { epicId: string; matrix: QAMatrix } }
  | { type: 'UPDATE_QA_MATRIX'; payload: { epicId: string; matrix: QAMatrix } }
  | { type: 'APPROVE_EPIC_QA'; payload: { epicId: string; qaName: string } }
  | { type: 'REJECT_EPIC_QA'; payload: { epicId: string; qaName: string; comment: string } }
  | { type: 'ADD_EPIC_DOCUMENT'; payload: { epicId: string; document: import('@/types/proyectos').EpicDocument } }
  | { type: 'UPDATE_EPIC_DOCUMENT'; payload: { epicId: string; document: import('@/types/proyectos').EpicDocument } }
  | { type: 'DELETE_EPIC_DOCUMENT'; payload: { epicId: string; documentId: string } }
  | { type: 'ADD_INITIATIVE_DOCUMENT'; payload: { initiativeId: string; document: import('@/types/proyectos').EpicDocument } }
  | { type: 'UPDATE_INITIATIVE_DOCUMENT'; payload: { initiativeId: string; document: import('@/types/proyectos').EpicDocument } }
  | { type: 'DELETE_INITIATIVE_DOCUMENT'; payload: { initiativeId: string; documentId: string } }
  | { type: 'SET_CURRENT_USER'; payload: string };

function proyectosReducer(state: ProyectosState, action: ProyectosAction): ProyectosState {
  switch (action.type) {
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
      const { epicId, poId, poName } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const approval = {
        status: 'approved' as const,
        approvedBy: poId,
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
      const { epicId, poId, poName, comment } = action.payload;
      const epic = state.epics.find((e) => e.id === epicId);
      if (!epic) return state;
      const rejection = {
        status: 'rejected' as const,
        approvedBy: poId,
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

  const filteredStories = useMemo(() => {
    const { filters, stories } = state;
    return stories.filter((story) => {
      if (filters.initiativeIds.length > 0) {
        const epic = state.epics.find((e) => e.id === story.epicId);
        if (!epic || !filters.initiativeIds.includes(epic.initiativeId)) return false;
      }
      if (filters.podIds.length > 0 && !filters.podIds.includes(story.podId)) return false;
      if (filters.productOwnerIds.length > 0 && !filters.productOwnerIds.includes(story.productOwnerId)) return false;
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
      if (filters.jiraKey && !story.jiraKey.toLowerCase().includes(filters.jiraKey.toLowerCase())) return false;
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
        if (!epic.title.toLowerCase().includes(q) && !epic.description.toLowerCase().includes(q)) return false;
      }
      if (filters.jiraKey && !epic.jiraKey.toLowerCase().includes(filters.jiraKey.toLowerCase())) return false;
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
    () => ({ state, dispatch, filteredStories, filteredEpics, epicsWithRelations, matrizRows, stats }),
    [state, dispatch, filteredStories, filteredEpics, epicsWithRelations, matrizRows, stats]
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
