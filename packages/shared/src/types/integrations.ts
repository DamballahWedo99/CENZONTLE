// === INTEGRATION TYPES ===

export type IntegrationProvider = 'linear' | 'jira';

export type ConnectionStatus = 'disconnected' | 'connected' | 'error';

export interface IntegrationFieldMapping {
  storyTitle: string; // maps to: Linear 'title' / Jira 'summary'
  storyDescription: string; // maps to: Linear 'description' / Jira 'description'
  storyPoints: string; // maps to: Linear 'estimate' / Jira custom field ID (e.g. 'customfield_10016')
  priority: string; // maps to: Linear 'priority' / Jira 'priority'
  labels: string; // maps to: Linear 'labelIds' / Jira 'labels'
  epicParent: string; // maps to: Linear 'parentId' / Jira 'parent'
  status: string; // maps to: Linear 'stateId' / Jira 'status'
  assignee: string; // maps to: Linear 'assigneeId' / Jira 'assignee'
}

export const DEFAULT_LINEAR_MAPPING: IntegrationFieldMapping = {
  storyTitle: 'title',
  storyDescription: 'description',
  storyPoints: 'estimate',
  priority: 'priority',
  labels: 'labelIds',
  epicParent: 'parentId',
  status: 'stateId',
  assignee: 'assigneeId',
};

// Jira uses custom field IDs for story points — default is customfield_10016
// but this varies per Jira instance. User should verify in Jira Admin > Custom Fields.
export const DEFAULT_JIRA_MAPPING: IntegrationFieldMapping = {
  storyTitle: 'summary',
  storyDescription: 'description',
  storyPoints: 'customfield_10016',
  priority: 'priority',
  labels: 'labels',
  epicParent: 'parent',
  status: 'status',
  assignee: 'assignee',
};

export interface LinearConfig {
  apiKey: string; // Personal API key: lin_api_...
  teamId: string; // UUID of the target team (required for issue creation)
  teamName: string; // Display name (informational)
  workspaceSlug: string; // e.g. "my-company" — used for generating links back to Linear
  projectId: string | null; // Optional project UUID to scope issues
  projectName: string | null; // Display name (informational)
}

export interface JiraConfig {
  email: string; // Atlassian account email (used for Basic Auth)
  apiToken: string; // API token from https://id.atlassian.com/manage-profile/security/api-tokens
  domain: string; // Subdomain only, e.g. "mycompany" → https://mycompany.atlassian.net
  projectKey: string; // e.g. "PROJ", "ENG" — required for issue creation
  projectName: string; // Display name (informational)
  defaultIssueType: string; // e.g. "Story", "Task", "Bug" — required for issue creation
  storyPointsFieldId: string; // Custom field ID for story points (e.g. "customfield_10016")
}

export interface IntegrationConfig {
  provider: IntegrationProvider | null;
  status: ConnectionStatus;
  lastSyncedAt: string | null; // ISO date
  maskedKey: string | null; // e.g. "lin****a3f2"
  fieldMapping: IntegrationFieldMapping;
  linear: LinearConfig | null;
  jira: JiraConfig | null;
}

export const DEFAULT_INTEGRATION_CONFIG: IntegrationConfig = {
  provider: null,
  status: 'disconnected',
  lastSyncedAt: null,
  maskedKey: null,
  fieldMapping: DEFAULT_LINEAR_MAPPING,
  linear: null,
  jira: null,
};

// Mask a key for display: show first 3 and last 4 chars
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}
