/**
 * Tipos del vault compartidos entre la API y el frontend.
 */

/**
 * Estado del job del agente de conexiones del vault (POST /vault/connections
 * + polling de GET /vault/connections/status). Un solo job por proceso; el
 * backend devuelve un snapshot idle neutro si el job en curso pertenece a
 * un vault distinto al consultado.
 */
export interface VaultConnectionsStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  phase: 'reading' | 'analyzing' | 'writing' | null;
  /** Vault target del job (null = vault activo). */
  vaultId: string | null;
  totalDocuments: number;
  processedDocuments: number;
  updatedDocuments: number;
  skippedDocuments: number;
  /** Tags que conectan 2-5 documentos en el resultado final (los que el grafo dibuja). */
  sharedTags: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}
