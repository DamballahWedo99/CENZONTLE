import type { Initiative, Epic, UserStory, Pod, EpicWithRelations } from '@cenzontle/shared';
import {
  initiativeToJsonShape,
  epicToJsonShape,
  storyToJsonShape,
  initiativeToFlatRow,
  epicToFlatRow,
  storyToFlatRow,
} from './serializers';
import type { ListJsonShape, InitiativeFlatRow, EpicFlatRow, StoryFlatRow } from './types';
import { SCHEMA_VERSION } from './types';

async function downloadJson(payload: unknown, filename: string): Promise<void> {
  const { saveAs } = await import('file-saver');
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  saveAs(blob, filename);
}

export async function exportInitiativeToJSON(
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  await downloadJson(initiativeToJsonShape(initiative, epics, stories, pods), filename);
}

export async function exportEpicToJSON(
  epic: Epic,
  initiative: Initiative | null,
  pods: Pod[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  await downloadJson(epicToJsonShape(epic, initiative, pods, stories), filename);
}

export async function exportStoryToJSON(
  story: UserStory,
  epic: Epic | null,
  pod: Pod | null,
  filename: string,
): Promise<void> {
  await downloadJson(storyToJsonShape(story, epic, pod), filename);
}

export async function exportInitiativesListToJSON(
  initiatives: Initiative[],
  epics: Epic[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  const items: InitiativeFlatRow[] = initiatives.map((i) => initiativeToFlatRow(i, epics, stories));
  const payload: ListJsonShape<InitiativeFlatRow> = {
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
  await downloadJson(payload, filename);
}

export async function exportEpicsListToJSON(
  epics: EpicWithRelations[],
  filename: string,
): Promise<void> {
  const items: EpicFlatRow[] = epics.map((epic) =>
    epicToFlatRow(epic, epic.initiative, epic.pods, epic.stories),
  );
  const payload: ListJsonShape<EpicFlatRow> = {
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
  await downloadJson(payload, filename);
}

export async function exportStoriesListToJSON(
  stories: UserStory[],
  epics: Epic[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  const items: StoryFlatRow[] = stories.map((s) =>
    storyToFlatRow(s, epics.find((e) => e.id === s.epicId), pods.find((p) => p.id === s.podId)),
  );
  const payload: ListJsonShape<StoryFlatRow> = {
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
  await downloadJson(payload, filename);
}
