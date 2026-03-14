/**
 * Mock AI Diagram Agent
 *
 * Generates business flow diagrams with decision gates, branching paths,
 * and realistic microservice interactions based on epic definitions.
 * In production this would call an LLM API with context from the codebase.
 */

import { Epic, EpicDiagram, DiagramNode, DiagramEdge } from '@/types/proyectos';

// --- Flow templates ---
// Each template represents a business flow pattern that gets matched by keywords

interface FlowTemplate {
  keywords: string[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const flowTemplates: FlowTemplate[] = [
  // --- Checkout / Purchase flow ---
  {
    keywords: ['checkout', 'compra', 'boleto', 'carrito', 'purchase'],
    nodes: [
      { id: 'n1', type: 'client', label: 'CLIENTE LLEGA\nAL CHECKOUT', group: 'start' },
      { id: 'n2', type: 'service', label: 'FE Web\n(Checkout)', group: 'frontend' },
      { id: 'n3', type: 'database', label: 'Catálogo de\nmétodos de pago', group: 'data' },
      { id: 'n4', type: 'decision', label: '¿Requiere\nantifraude?', group: 'decision' },
      { id: 'n5', type: 'service', label: 'Micro_AM_API\nAntifraude', group: 'backend' },
      { id: 'n6', type: 'service', label: 'Motor Prevención\nFraude', group: 'backend' },
      { id: 'n7', type: 'decision', label: '¿Status?', group: 'decision' },
      { id: 'n8', type: 'service', label: 'Micro_AM_PAY', group: 'backend' },
      { id: 'n9', type: 'service', label: 'SABRE DC', group: 'external' },
      { id: 'n10', type: 'service', label: 'PROCESADOR\nDE PAGO\n(DEUNA/ADYEN)', group: 'external' },
      { id: 'n11', type: 'client', label: 'Reserva\nConfirmada', group: 'end' },
      { id: 'n12', type: 'client', label: 'Reserva\nON HOLD (PNR)', group: 'end' },
      { id: 'n13', type: 'process', label: 'Sigue flujo del\nmétodo de pago\nseleccionado', group: 'alt' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e3', source: 'n2', target: 'n4', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e4', source: 'n4', target: 'n5', label: 'SI', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e5', source: 'n4', target: 'n13', label: 'NO', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e6', source: 'n5', target: 'n6', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e7', source: 'n6', target: 'n7', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e8', source: 'n7', target: 'n8', label: 'ACCEPT', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e9', source: 'n7', target: 'n12', label: 'REJECT', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e10', source: 'n8', target: 'n9', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e11', source: 'n9', target: 'n10', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e12', source: 'n10', target: 'n11', sourceHandle: 'bottom', targetHandle: 'top' },
    ],
  },

  // --- Payment processing flow ---
  {
    keywords: ['pago', 'payment', 'procesador', 'multi-procesador', 'stripe', 'deuna', 'adyen'],
    nodes: [
      { id: 'n1', type: 'client', label: 'SOLICITUD\nDE PAGO', group: 'start' },
      { id: 'n2', type: 'service', label: 'Payment\nOrchestrator', group: 'backend' },
      { id: 'n3', type: 'decision', label: '¿Tipo de\ntarjeta?', group: 'decision' },
      { id: 'n4', type: 'service', label: 'DEUNA\nGateway', group: 'external' },
      { id: 'n5', type: 'service', label: 'Stripe\nGateway', group: 'external' },
      { id: 'n6', type: 'service', label: 'Adyen\nGateway', group: 'external' },
      { id: 'n7', type: 'decision', label: '¿Transacción\naprobada?', group: 'decision' },
      { id: 'n8', type: 'service', label: 'Retry Engine', group: 'backend', description: 'Circuit breaker + backoff' },
      { id: 'n9', type: 'decision', label: '¿Reintentos\nagotados?', group: 'decision' },
      { id: 'n10', type: 'service', label: 'Notification\nService', group: 'backend' },
      { id: 'n11', type: 'client', label: 'PAGO\nEXITOSO', group: 'end' },
      { id: 'n12', type: 'client', label: 'PAGO\nDECLINADO', group: 'end' },
      { id: 'n13', type: 'database', label: 'Transaction\nLog DB', group: 'data' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e3', source: 'n3', target: 'n4', label: 'MX/LATAM', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e4', source: 'n3', target: 'n5', label: 'US/EU', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e5', source: 'n3', target: 'n6', label: 'APAC', sourceHandle: 'left-out', targetHandle: 'left' },
      { id: 'e6', source: 'n4', target: 'n7', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e7', source: 'n5', target: 'n7', sourceHandle: 'bottom', targetHandle: 'right' },
      { id: 'e8', source: 'n6', target: 'n7', sourceHandle: 'bottom', targetHandle: 'left' },
      { id: 'e9', source: 'n7', target: 'n10', label: 'SI', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e10', source: 'n7', target: 'n8', label: 'NO', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e11', source: 'n10', target: 'n11', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e12', source: 'n8', target: 'n9', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e13', source: 'n9', target: 'n2', label: 'NO', sourceHandle: 'left-out', targetHandle: 'left', animated: true },
      { id: 'e14', source: 'n9', target: 'n12', label: 'SI', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e15', source: 'n2', target: 'n13', sourceHandle: 'right', targetHandle: 'left' },
    ],
  },

  // --- Microservices migration flow ---
  {
    keywords: ['microservicio', 'migración', 'monolito', 'kubernetes', 'gateway'],
    nodes: [
      { id: 'n1', type: 'client', label: 'REQUEST\nENTRANTE', group: 'start' },
      { id: 'n2', type: 'service', label: 'API Gateway\n(Kong)', group: 'infra' },
      { id: 'n3', type: 'service', label: 'Auth Service', group: 'backend' },
      { id: 'n4', type: 'decision', label: '¿Token\nválido?', group: 'decision' },
      { id: 'n5', type: 'service', label: 'Booking\nService', group: 'backend' },
      { id: 'n6', type: 'service', label: 'Payment\nService', group: 'backend' },
      { id: 'n7', type: 'service', label: 'Notification\nService', group: 'backend' },
      { id: 'n8', type: 'queue', label: 'Event Bus\n(Kafka)', group: 'infra', description: 'Async events' },
      { id: 'n9', type: 'database', label: 'Primary DB\n(PostgreSQL)', group: 'data' },
      { id: 'n10', type: 'service', label: 'Sabre GDS', group: 'external', description: 'Reservaciones' },
      { id: 'n11', type: 'service', label: 'Observability\nStack', group: 'infra', description: 'Datadog/Jaeger' },
      { id: 'n12', type: 'client', label: 'RESPONSE\nAL CLIENTE', group: 'end' },
      { id: 'n13', type: 'client', label: 'ERROR 401\nUNAUTHORIZED', group: 'end' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'bottom', targetHandle: 'top', label: 'JWT' },
      { id: 'e3', source: 'n3', target: 'n4', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e4', source: 'n4', target: 'n5', label: 'SI', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e5', source: 'n4', target: 'n13', label: 'NO', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e6', source: 'n5', target: 'n6', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e7', source: 'n5', target: 'n10', sourceHandle: 'bottom', targetHandle: 'top', label: 'API' },
      { id: 'e8', source: 'n6', target: 'n8', sourceHandle: 'bottom', targetHandle: 'top', label: 'publish' },
      { id: 'e9', source: 'n8', target: 'n7', sourceHandle: 'right', targetHandle: 'left', label: 'subscribe', animated: true },
      { id: 'e10', source: 'n5', target: 'n9', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e11', source: 'n6', target: 'n9', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e12', source: 'n6', target: 'n12', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e13', source: 'n2', target: 'n11', sourceHandle: 'left-out', targetHandle: 'right', animated: true },
    ],
  },

  // --- Loyalty / Points flow ---
  {
    keywords: ['lealtad', 'punto', 'loyalty', 'recompensa', 'redención', 'frequent flyer'],
    nodes: [
      { id: 'n1', type: 'actor', label: 'CLIENTE\nFREQUENT\nFLYER', group: 'start' },
      { id: 'n2', type: 'service', label: 'FE Web/App\n(Lealtad)', group: 'frontend' },
      { id: 'n3', type: 'decision', label: '¿Acumular o\nRedimir?', group: 'decision' },
      { id: 'n4', type: 'service', label: 'Motor de\nAcumulación', group: 'backend' },
      { id: 'n5', type: 'service', label: 'Motor de\nRedención', group: 'backend' },
      { id: 'n6', type: 'service', label: 'Rules Engine\n(Drools)', group: 'backend', description: 'Reglas dinámicas' },
      { id: 'n7', type: 'decision', label: '¿Saldo\nsuficiente?', group: 'decision' },
      { id: 'n8', type: 'database', label: 'Balance DB', group: 'data' },
      { id: 'n9', type: 'service', label: 'Partner\nAPIs', group: 'external', description: 'SkyTeam/Hoteles' },
      { id: 'n10', type: 'service', label: 'Notification\nService', group: 'backend' },
      { id: 'n11', type: 'client', label: 'PUNTOS\nACUMULADOS', group: 'end' },
      { id: 'n12', type: 'client', label: 'REDENCIÓN\nEXITOSA', group: 'end' },
      { id: 'n13', type: 'client', label: 'SALDO\nINSUFICIENTE', group: 'end' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e3', source: 'n3', target: 'n4', label: 'ACUMULAR', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e4', source: 'n3', target: 'n5', label: 'REDIMIR', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e5', source: 'n4', target: 'n6', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e6', source: 'n6', target: 'n8', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e7', source: 'n4', target: 'n9', sourceHandle: 'right', targetHandle: 'left', animated: true },
      { id: 'e8', source: 'n6', target: 'n11', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e9', source: 'n5', target: 'n7', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e10', source: 'n7', target: 'n12', label: 'SI', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e11', source: 'n7', target: 'n13', label: 'NO', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e12', source: 'n5', target: 'n8', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e13', source: 'n12', target: 'n10', sourceHandle: 'bottom', targetHandle: 'top' },
    ],
  },

  // --- Monitoring / Dashboard flow ---
  {
    keywords: ['monitoreo', 'dashboard', 'métricas', 'observabilidad', 'alerta', 'reporte'],
    nodes: [
      { id: 'n1', type: 'service', label: 'Microservicios\n(Métricas)', group: 'backend' },
      { id: 'n2', type: 'queue', label: 'Metrics\nCollector', group: 'infra' },
      { id: 'n3', type: 'database', label: 'Elasticsearch\nCluster', group: 'data' },
      { id: 'n4', type: 'service', label: 'Aggregation\nEngine', group: 'backend' },
      { id: 'n5', type: 'decision', label: '¿Umbral\nexcedido?', group: 'decision' },
      { id: 'n6', type: 'service', label: 'Alert\nManager', group: 'backend' },
      { id: 'n7', type: 'service', label: 'Slack\nNotification', group: 'external' },
      { id: 'n8', type: 'service', label: 'PagerDuty', group: 'external' },
      { id: 'n9', type: 'service', label: 'Dashboard\nFrontend', group: 'frontend', description: 'WebSocket real-time' },
      { id: 'n10', type: 'actor', label: 'OPERADOR\nSRE', group: 'end' },
      { id: 'n11', type: 'service', label: 'Report\nExporter', group: 'backend', description: 'CSV/PDF' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'bottom', targetHandle: 'top', label: 'push' },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e3', source: 'n3', target: 'n4', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e4', source: 'n4', target: 'n5', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e5', source: 'n5', target: 'n6', label: 'SI', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e6', source: 'n5', target: 'n9', label: 'NO', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e7', source: 'n6', target: 'n7', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e8', source: 'n6', target: 'n8', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e9', source: 'n9', target: 'n10', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e10', source: 'n4', target: 'n9', sourceHandle: 'right', targetHandle: 'left', animated: true, label: 'WS' },
      { id: 'e11', source: 'n9', target: 'n11', sourceHandle: 'right', targetHandle: 'left' },
    ],
  },

  // --- Reconciliation flow ---
  {
    keywords: ['reconciliación', 'conciliación', 'contable', 'discrepancia', 'sap'],
    nodes: [
      { id: 'n1', type: 'service', label: 'Procesadores\nde Pago', group: 'external' },
      { id: 'n2', type: 'service', label: 'File Ingestion\nService', group: 'backend' },
      { id: 'n3', type: 'database', label: 'Transaction\nDB', group: 'data' },
      { id: 'n4', type: 'service', label: 'Matching\nEngine', group: 'backend', description: 'Auto-conciliación' },
      { id: 'n5', type: 'decision', label: '¿Match\nencontrado?', group: 'decision' },
      { id: 'n6', type: 'client', label: 'CONCILIADO\nAUTOMÁTICO', group: 'end' },
      { id: 'n7', type: 'service', label: 'Workflow de\nResolución', group: 'backend' },
      { id: 'n8', type: 'actor', label: 'ANALISTA\nFINANCIERO', group: 'end' },
      { id: 'n9', type: 'service', label: 'SAP\nContable', group: 'external' },
      { id: 'n10', type: 'service', label: 'Alert\nService', group: 'backend' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'bottom', targetHandle: 'top', label: 'CSV/XML' },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e3', source: 'n2', target: 'n4', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e4', source: 'n3', target: 'n4', sourceHandle: 'bottom', targetHandle: 'left' },
      { id: 'e5', source: 'n4', target: 'n5', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e6', source: 'n5', target: 'n6', label: 'SI', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e7', source: 'n5', target: 'n7', label: 'NO', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e8', source: 'n7', target: 'n8', sourceHandle: 'bottom', targetHandle: 'top' },
      { id: 'e9', source: 'n7', target: 'n10', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e10', source: 'n6', target: 'n9', sourceHandle: 'bottom', targetHandle: 'top', label: 'sync' },
    ],
  },
];

// --- Default flow for unmatched epics ---
const defaultFlow: { nodes: DiagramNode[]; edges: DiagramEdge[] } = {
  nodes: [
    { id: 'n1', type: 'client', label: 'INICIO DEL\nFLUJO', group: 'start' },
    { id: 'n2', type: 'service', label: 'Frontend\nApp', group: 'frontend' },
    { id: 'n3', type: 'service', label: 'API Gateway', group: 'infra' },
    { id: 'n4', type: 'decision', label: '¿Validación\ncorrecta?', group: 'decision' },
    { id: 'n5', type: 'service', label: 'Core\nService', group: 'backend' },
    { id: 'n6', type: 'database', label: 'Base de\nDatos', group: 'data' },
    { id: 'n7', type: 'service', label: 'External\nService', group: 'external' },
    { id: 'n8', type: 'client', label: 'OPERACIÓN\nEXITOSA', group: 'end' },
    { id: 'n9', type: 'client', label: 'ERROR\nVALIDACIÓN', group: 'end' },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e3', source: 'n3', target: 'n4', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e4', source: 'n4', target: 'n5', label: 'SI', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e5', source: 'n4', target: 'n9', label: 'NO', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e6', source: 'n5', target: 'n6', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e7', source: 'n5', target: 'n7', sourceHandle: 'right', targetHandle: 'left', animated: true },
    { id: 'e8', source: 'n5', target: 'n8', sourceHandle: 'bottom', targetHandle: 'top' },
  ],
};

function extractText(epic: Epic): string {
  return [
    epic.title, epic.description, epic.scopeDescription,
    epic.teamsInvolved, epic.impactedChannels, epic.impactedFlows,
    epic.thirdPartyDependencies, epic.technologicalImprovements,
    epic.impactSabreLevel, epic.acceptanceCriteria,
  ].join(' ').toLowerCase();
}

// --- Public API ---

/** Simulates an AI agent generating a business flow diagram. */
export async function generateDiagram(epic: Epic, type: 'technical' | 'business'): Promise<EpicDiagram> {
  // Simulate AI thinking time (2-3.5s)
  await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 1500));

  const text = extractText(epic);

  // Find the best matching flow template
  let bestMatch: FlowTemplate | null = null;
  let bestScore = 0;

  for (const template of flowTemplates) {
    const score = template.keywords.filter((kw) => text.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = template;
    }
  }

  const flow = bestMatch ?? defaultFlow;

  // Add unique timestamps to IDs to prevent conflicts
  const ts = Date.now();
  const nodes = flow.nodes.map((n, i) => ({ ...n, id: `${n.id}-${ts}` }));
  const edges = flow.edges.map((e, i) => ({
    ...e,
    id: `${e.id}-${ts}`,
    source: `${e.source}-${ts}`,
    target: `${e.target}-${ts}`,
  }));

  return {
    id: `diagram-${ts}`,
    name: 'Diagrama de Negocio',
    type: 'business',
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
    generatedBy: 'ai',
  };
}
