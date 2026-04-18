import type { Initiative, Epic, UserStory, Pod, EpicWithRelations } from '@cenzontle/shared';

export type ExportFormat = 'pdf' | 'excel' | 'word' | 'csv' | 'json';

export const ALL_FORMATS: ExportFormat[] = ['pdf', 'excel', 'word', 'csv', 'json'];

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF',
  excel: 'Excel',
  word: 'Word',
  csv: 'CSV',
  json: 'JSON',
};

export const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  pdf: 'pdf',
  excel: 'xlsx',
  word: 'docx',
  csv: 'csv',
  json: 'json',
};

export type ExportEntity =
  | { kind: 'initiative'; initiative: Initiative }
  | { kind: 'epic'; epic: Epic }
  | { kind: 'story'; story: UserStory }
  | { kind: 'initiatives-list'; initiatives: Initiative[] }
  | { kind: 'epics-list'; epics: EpicWithRelations[] }
  | { kind: 'stories-list'; stories: UserStory[] };

export type ExportEntityKind = ExportEntity['kind'];

export interface ExportRelations {
  initiatives: Initiative[];
  epics: Epic[];
  stories: UserStory[];
  pods: Pod[];
}

export interface InitiativeFlatRow {
  [key: string]: string | number;
  id: string;
  name: string;
  status: string;
  owner: string;
  startDate: string;
  targetDate: string;
  epicCount: number;
  storyCount: number;
  doneStoryCount: number;
  totalStoryPoints: number;
  doneStoryPoints: number;
  progress: number;
  documentCount: number;
  description: string;
}

export interface EpicFlatRow {
  [key: string]: string | number;
  id: string;
  trackerKey: string;
  title: string;
  initiativeName: string;
  status: string;
  priority: string;
  pods: string;
  startDate: string;
  targetDate: string;
  storyCount: number;
  doneStoryCount: number;
  progress: number;
  description: string;
}

export interface StoryFlatRow {
  [key: string]: string | number;
  id: string;
  trackerKey: string;
  title: string;
  epicTitle: string;
  podName: string;
  status: string;
  storyPoints: number;
  sprintId: string;
  labels: string;
}

export interface DocumentTable {
  headers: string[];
  rows: string[][];
}

export interface DocumentSection {
  level: 1 | 2 | 3;
  title: string;
  body?: string;
  table?: DocumentTable;
}

export interface InitiativeJsonShape {
  initiative: Initiative;
  epics: Array<Epic & { stories: UserStory[] }>;
  pods: Pod[];
  generatedAt: string;
  schemaVersion: string;
}

export interface EpicJsonShape {
  epic: Epic;
  initiative: Initiative | null;
  pods: Pod[];
  stories: UserStory[];
  generatedAt: string;
  schemaVersion: string;
}

export interface StoryJsonShape {
  story: UserStory;
  epic: Epic | null;
  pod: Pod | null;
  generatedAt: string;
  schemaVersion: string;
}

export interface ListJsonShape<T> {
  items: T[];
  total: number;
  generatedAt: string;
  schemaVersion: string;
}

export const SCHEMA_VERSION = '1.0';
