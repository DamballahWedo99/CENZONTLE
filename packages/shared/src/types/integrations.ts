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

/**
 * Shape de respuesta canónica para `GET/PUT /integrations/:provider`.
 * Compartido entre backend (DTO) y frontend (client API). NUNCA contiene la
 * apiKey en plaintext — siempre `maskedKey` (ej: "lin****a3f2").
 */
export interface IntegrationConfigResponse {
  provider: IntegrationProvider;
  status: ConnectionStatus;
  maskedKey: string;
  metadata: LinearConfig | JiraConfig;
  lastTestedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

// === GITHUB / REPOSITORY CONFIGURATION ===

export interface GitHubConfig {
  owner: string;           // GitHub org or user, e.g. "DamballahWedo99"
  repo: string;            // Repository name, e.g. "CENZONTLE"
  personalAccessToken: string; // GitHub PAT with repo scope
}

export interface BranchStrategy {
  devBranch: string;          // Target for consolidated PRs from Forge, e.g. "dev" or "develop"
  mainBranch: string;         // Production branch, e.g. "main" or "master"
  forgeBranchPrefix: string;  // Prefix for batch branches, e.g. "forge/sprint-batch-"
  autoDeleteForgeBranch: boolean; // Delete forge branch after merge to DEV
}

export interface FactoryConfig {
  github: GitHubConfig | null;
  branchStrategy: BranchStrategy;
  maxConcurrentAgents: number;    // Semaphore limit (default: 6)
  maxRetriesPerStory: number;     // Max reject loops before escalation (default: 3)
  connectionStatus: ConnectionStatus; // reuse from existing type
}

export const DEFAULT_BRANCH_STRATEGY: BranchStrategy = {
  devBranch: 'dev',
  mainBranch: 'main',
  forgeBranchPrefix: 'forge/sprint-batch-',
  autoDeleteForgeBranch: true,
};

export const DEFAULT_FACTORY_CONFIG: FactoryConfig = {
  github: null,
  branchStrategy: DEFAULT_BRANCH_STRATEGY,
  maxConcurrentAgents: 6,
  maxRetriesPerStory: 3,
  connectionStatus: 'disconnected',
};

// Mask a key for display: show first 3 and last 4 chars
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}
