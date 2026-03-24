'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import {
  IntegrationConfig,
  DEFAULT_INTEGRATION_CONFIG,
  IntegrationProvider,
  IntegrationFieldMapping,
  LinearConfig,
  JiraConfig,
  ConnectionStatus,
  maskApiKey,
  DEFAULT_LINEAR_MAPPING,
  DEFAULT_JIRA_MAPPING,
} from '@/types/integrations';

interface IntegrationsState {
  config: IntegrationConfig;
}

const initialState: IntegrationsState = {
  config: DEFAULT_INTEGRATION_CONFIG,
};

type IntegrationsAction =
  | { type: 'SET_PROVIDER'; payload: IntegrationProvider | null }
  | { type: 'CONNECT_LINEAR'; payload: { config: LinearConfig; apiKey: string } }
  | { type: 'CONNECT_JIRA'; payload: { config: JiraConfig; apiToken: string } }
  | { type: 'DISCONNECT' }
  | { type: 'SET_STATUS'; payload: ConnectionStatus }
  | { type: 'UPDATE_FIELD_MAPPING'; payload: Partial<IntegrationFieldMapping> }
  | { type: 'SET_LAST_SYNCED'; payload: string };

function integrationsReducer(state: IntegrationsState, action: IntegrationsAction): IntegrationsState {
  switch (action.type) {
    case 'SET_PROVIDER':
      return {
        ...state,
        config: {
          ...DEFAULT_INTEGRATION_CONFIG,
          provider: action.payload,
          fieldMapping: action.payload === 'jira' ? DEFAULT_JIRA_MAPPING : DEFAULT_LINEAR_MAPPING,
        },
      };
    case 'CONNECT_LINEAR':
      return {
        ...state,
        config: {
          ...state.config,
          provider: 'linear',
          status: 'connected',
          maskedKey: maskApiKey(action.payload.apiKey),
          linear: action.payload.config,
          jira: null,
          lastSyncedAt: null,
        },
      };
    case 'CONNECT_JIRA':
      return {
        ...state,
        config: {
          ...state.config,
          provider: 'jira',
          status: 'connected',
          maskedKey: maskApiKey(action.payload.apiToken),
          jira: action.payload.config,
          linear: null,
          lastSyncedAt: null,
        },
      };
    case 'DISCONNECT':
      return { ...state, config: DEFAULT_INTEGRATION_CONFIG };
    case 'SET_STATUS':
      return { ...state, config: { ...state.config, status: action.payload } };
    case 'UPDATE_FIELD_MAPPING':
      return {
        ...state,
        config: {
          ...state.config,
          fieldMapping: { ...state.config.fieldMapping, ...action.payload },
        },
      };
    case 'SET_LAST_SYNCED':
      return {
        ...state,
        config: { ...state.config, lastSyncedAt: action.payload },
      };
    default:
      return state;
  }
}

const IntegrationsContext = createContext<{
  state: IntegrationsState;
  dispatch: React.Dispatch<IntegrationsAction>;
} | null>(null);

export function IntegrationsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(integrationsReducer, initialState);

  return (
    <IntegrationsContext.Provider value={{ state, dispatch }}>
      {children}
    </IntegrationsContext.Provider>
  );
}

export function useIntegrations() {
  const context = useContext(IntegrationsContext);
  if (!context) throw new Error('useIntegrations must be used within IntegrationsProvider');
  return context;
}
