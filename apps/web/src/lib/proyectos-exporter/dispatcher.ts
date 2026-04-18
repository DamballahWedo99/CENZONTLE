import type { Initiative, Epic, UserStory, Pod, EpicWithRelations } from '@cenzontle/shared';
import type { ExportFormat } from './types';
import * as pdf from './pdf';
import * as excel from './excel';
import * as word from './word';
import * as csv from './csv';
import * as json from './json';

export async function dispatchInitiative(
  format: ExportFormat,
  initiative: Initiative,
  epics: Epic[],
  stories: UserStory[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  switch (format) {
    case 'pdf':
      return pdf.exportInitiativeToPDF(initiative, epics, stories, pods, filename);
    case 'excel':
      return excel.exportInitiativeToExcel(initiative, epics, stories, pods, filename);
    case 'word':
      return word.exportInitiativeToWord(initiative, epics, stories, pods, filename);
    case 'csv':
      return csv.exportInitiativeToCSV(initiative, epics, stories, filename);
    case 'json':
      return json.exportInitiativeToJSON(initiative, epics, stories, pods, filename);
  }
}

export async function dispatchEpic(
  format: ExportFormat,
  epic: Epic,
  initiative: Initiative | null,
  pods: Pod[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  switch (format) {
    case 'pdf':
      return pdf.exportEpicToPDF(epic, initiative, pods, stories, filename);
    case 'excel':
      return excel.exportEpicToExcel(epic, initiative, pods, stories, filename);
    case 'word':
      return word.exportEpicToWord(epic, initiative, pods, stories, filename);
    case 'csv':
      return csv.exportEpicToCSV(epic, initiative, pods, stories, filename);
    case 'json':
      return json.exportEpicToJSON(epic, initiative, pods, stories, filename);
  }
}

export async function dispatchStory(
  format: ExportFormat,
  story: UserStory,
  epic: Epic | null,
  pod: Pod | null,
  filename: string,
): Promise<void> {
  switch (format) {
    case 'pdf':
      return pdf.exportStoryToPDF(story, epic, pod, filename);
    case 'excel':
      return excel.exportStoryToExcel(story, epic, pod, filename);
    case 'word':
      return word.exportStoryToWord(story, epic, pod, filename);
    case 'csv':
      return csv.exportStoryToCSV(story, epic, pod, filename);
    case 'json':
      return json.exportStoryToJSON(story, epic, pod, filename);
  }
}

export async function dispatchInitiativesList(
  format: ExportFormat,
  initiatives: Initiative[],
  epics: Epic[],
  stories: UserStory[],
  filename: string,
): Promise<void> {
  switch (format) {
    case 'pdf':
      return pdf.exportInitiativesListToPDF(initiatives, epics, stories, filename);
    case 'excel':
      return excel.exportInitiativesListToExcel(initiatives, epics, stories, filename);
    case 'word':
      return word.exportInitiativesListToWord(initiatives, epics, stories, filename);
    case 'csv':
      return csv.exportInitiativesListToCSV(initiatives, epics, stories, filename);
    case 'json':
      return json.exportInitiativesListToJSON(initiatives, epics, stories, filename);
  }
}

export async function dispatchEpicsList(
  format: ExportFormat,
  epics: EpicWithRelations[],
  filename: string,
): Promise<void> {
  switch (format) {
    case 'pdf':
      return pdf.exportEpicsListToPDF(epics, filename);
    case 'excel':
      return excel.exportEpicsListToExcel(epics, filename);
    case 'word':
      return word.exportEpicsListToWord(epics, filename);
    case 'csv':
      return csv.exportEpicsListToCSV(epics, filename);
    case 'json':
      return json.exportEpicsListToJSON(epics, filename);
  }
}

export async function dispatchStoriesList(
  format: ExportFormat,
  stories: UserStory[],
  epics: Epic[],
  pods: Pod[],
  filename: string,
): Promise<void> {
  switch (format) {
    case 'pdf':
      return pdf.exportStoriesListToPDF(stories, epics, pods, filename);
    case 'excel':
      return excel.exportStoriesListToExcel(stories, epics, pods, filename);
    case 'word':
      return word.exportStoriesListToWord(stories, epics, pods, filename);
    case 'csv':
      return csv.exportStoriesListToCSV(stories, epics, pods, filename);
    case 'json':
      return json.exportStoriesListToJSON(stories, epics, pods, filename);
  }
}
