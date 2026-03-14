/**
 * Mock AI Economic Analysis Agent
 *
 * Generates structured economic analysis reports for initiatives based on
 * their epics, progress, and category. In production this would call an LLM
 * API with financial models, historical project data, and market benchmarks
 * to produce validated economic projections.
 */

import { Initiative, Epic, Priority } from '@/types/proyectos';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CostBenefitItem {
  category: string;
  estimated: number; // in thousands USD
  type: 'cost' | 'benefit';
}

export interface ROIProjectionPoint {
  month: string; // e.g. "Mes 1", "Mes 2"...
  investment: number; // cumulative investment in thousands
  returnValue: number; // cumulative return in thousands
  netValue: number; // returnValue - investment
}

export interface ImpactDimension {
  dimension: string; // e.g. "Experiencia del Cliente", "Eficiencia Operativa"
  score: number; // 0-100
  description: string;
}

export interface ResourceAllocation {
  team: string;
  allocation: number; // percentage 0-100
  cost: number; // monthly cost in thousands
}

export interface RiskItem {
  name: string;
  probability: number; // 0-1
  impact: number; // 0-1
  mitigation: string;
}

export interface EconomicAnalysisReport {
  // Summary metrics
  estimatedTotalInvestment: number; // thousands USD
  estimatedAnnualReturn: number; // thousands USD
  roiPercentage: number;
  paybackMonths: number;
  npv: number; // Net Present Value in thousands
  irr: number; // Internal Rate of Return percentage

  // Chart data
  costBenefitItems: CostBenefitItem[];
  roiProjection: ROIProjectionPoint[]; // 12 months
  impactDimensions: ImpactDimension[];
  resourceAllocation: ResourceAllocation[];
  risks: RiskItem[];

  // Qualitative
  executiveSummary: string;
  recommendations: string[];

  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Category profiles
// ---------------------------------------------------------------------------

interface CategoryProfile {
  keywords: string[];
  label: string;
  investmentRange: [number, number]; // min-max in thousands
  roiRange: [number, number]; // percentage
  paybackRange: [number, number]; // months
  impactScores: {
    customerExperience: number;
    operationalEfficiency: number;
    revenue: number;
    innovation: number;
    scalability: number;
    compliance: number;
  };
  risks: RiskItem[];
  executiveSummaryTemplate: string;
  recommendations: string[];
}

const categoryProfiles: CategoryProfile[] = [
  {
    keywords: ['plataforma', 'digital', 'modernización', 'modernizar', 'web', 'frontend'],
    label: 'Plataforma Digital',
    investmentRange: [800, 1200],
    roiRange: [180, 250],
    paybackRange: [8, 12],
    impactScores: {
      customerExperience: 85,
      operationalEfficiency: 70,
      revenue: 65,
      innovation: 80,
      scalability: 90,
      compliance: 60,
    },
    risks: [
      {
        name: 'Complejidad de migración de sistemas legacy',
        probability: 0.7,
        impact: 0.8,
        mitigation: 'Migración incremental con feature flags y estrategia de rollback por fase.',
      },
      {
        name: 'Resistencia al cambio por parte de usuarios internos',
        probability: 0.5,
        impact: 0.4,
        mitigation: 'Programa de change management con capacitación progresiva y champions internos.',
      },
      {
        name: 'Deuda técnica acumulada durante la migración',
        probability: 0.6,
        impact: 0.5,
        mitigation: 'Sprints dedicados a refactoring cada 3 ciclos y métricas de calidad de código.',
      },
      {
        name: 'Degradación de performance durante la transición',
        probability: 0.4,
        impact: 0.7,
        mitigation: 'Pruebas de carga continuas y monitoreo de Core Web Vitals en cada release.',
      },
      {
        name: 'Dependencia de proveedores de infraestructura cloud',
        probability: 0.3,
        impact: 0.6,
        mitigation: 'Arquitectura cloud-agnostic con abstracciones y contratos multi-proveedor.',
      },
    ],
    executiveSummaryTemplate:
      'La iniciativa de modernización de plataforma digital representa una inversión estratégica orientada a mejorar la experiencia del cliente y la escalabilidad operativa. El análisis financiero indica un retorno positivo dentro del primer año, con beneficios acumulativos crecientes a medida que se consolida la nueva arquitectura.',
    recommendations: [
      'Priorizar la migración de los flujos de mayor impacto en conversión para maximizar el retorno temprano.',
      'Implementar observabilidad desde el día uno para detectar regresiones de performance.',
      'Establecer un equipo dedicado de platform engineering para mantener la velocidad de desarrollo.',
      'Considerar una estrategia de strangler fig pattern para la migración gradual del monolito.',
    ],
  },
  {
    keywords: ['pago', 'payment', 'procesador', 'cobro', 'transacción', 'checkout'],
    label: 'Pagos',
    investmentRange: [500, 800],
    roiRange: [250, 400],
    paybackRange: [4, 8],
    impactScores: {
      customerExperience: 75,
      operationalEfficiency: 80,
      revenue: 95,
      innovation: 60,
      scalability: 70,
      compliance: 90,
    },
    risks: [
      {
        name: 'Incumplimiento regulatorio PCI-DSS',
        probability: 0.3,
        impact: 0.95,
        mitigation: 'Auditoría PCI-DSS trimestral y uso de tokenización certificada por proveedores.',
      },
      {
        name: 'Fallas en conciliación entre procesadores',
        probability: 0.5,
        impact: 0.7,
        mitigation: 'Sistema de conciliación automatizado con alertas de discrepancia en tiempo real.',
      },
      {
        name: 'Fraude y contracargos elevados',
        probability: 0.4,
        impact: 0.8,
        mitigation: 'Motor de reglas antifraude con machine learning y verificación 3D Secure 2.0.',
      },
      {
        name: 'Caída de procesador principal',
        probability: 0.2,
        impact: 0.9,
        mitigation: 'Routing inteligente multi-procesador con failover automático en menos de 5 segundos.',
      },
      {
        name: 'Cambios regulatorios en métodos de pago locales',
        probability: 0.4,
        impact: 0.5,
        mitigation: 'Monitoreo regulatorio proactivo y capa de abstracción para rápida adaptación.',
      },
    ],
    executiveSummaryTemplate:
      'La optimización del sistema de pagos ofrece el retorno de inversión más alto entre las categorías analizadas, impulsado por mejoras directas en tasa de conversión y reducción de costos de procesamiento. La inversión se recupera rápidamente gracias al impacto inmediato en ingresos.',
    recommendations: [
      'Implementar routing inteligente multi-procesador como primera fase para capturar ganancias rápidas.',
      'Asegurar cumplimiento PCI-DSS nivel 1 desde el diseño de la arquitectura.',
      'Incorporar métodos de pago alternativos para capturar segmentos desatendidos.',
      'Establecer dashboards de conciliación en tiempo real para el equipo de finanzas.',
    ],
  },
  {
    keywords: ['lealtad', 'loyalty', 'punto', 'reward', 'programa', 'milla'],
    label: 'Lealtad',
    investmentRange: [400, 700],
    roiRange: [150, 220],
    paybackRange: [10, 14],
    impactScores: {
      customerExperience: 90,
      operationalEfficiency: 55,
      revenue: 75,
      innovation: 70,
      scalability: 65,
      compliance: 50,
    },
    risks: [
      {
        name: 'Baja adopción del programa por los clientes',
        probability: 0.4,
        impact: 0.8,
        mitigation: 'Programa piloto con segmento de clientes frecuentes y ajustes basados en feedback.',
      },
      {
        name: 'Costo de redención superior al presupuestado',
        probability: 0.5,
        impact: 0.7,
        mitigation: 'Modelo financiero dinámico con caps de redención mensual y ajuste de valuación de puntos.',
      },
      {
        name: 'Complejidad de integración con partners externos',
        probability: 0.6,
        impact: 0.5,
        mitigation: 'API estándar para partners con sandbox de pruebas y onboarding automatizado.',
      },
      {
        name: 'Fraude en acumulación o redención de puntos',
        probability: 0.3,
        impact: 0.7,
        mitigation: 'Reglas antifraude en tiempo real y auditoría de transacciones sospechosas.',
      },
    ],
    executiveSummaryTemplate:
      'El programa de lealtad tiene un horizonte de retorno más largo pero genera valor sostenible a través de mayor retención y lifetime value del cliente. La inversión se justifica por el incremento en frecuencia de compra y la diferenciación competitiva.',
    recommendations: [
      'Lanzar con un MVP enfocado en acumulación y redención básica antes de expandir features.',
      'Establecer métricas claras de engagement: tasa de activación, frecuencia de redención, NPS.',
      'Negociar acuerdos con partners estratégicos antes del lanzamiento para ofrecer catálogo atractivo.',
      'Implementar personalización basada en segmentos para maximizar la relevancia de ofertas.',
    ],
  },
  {
    keywords: ['mobile', 'app', 'ios', 'android', 'nativo', 'aplicación'],
    label: 'Mobile',
    investmentRange: [600, 900],
    roiRange: [200, 300],
    paybackRange: [6, 10],
    impactScores: {
      customerExperience: 95,
      operationalEfficiency: 60,
      revenue: 70,
      innovation: 85,
      scalability: 75,
      compliance: 55,
    },
    risks: [
      {
        name: 'Fragmentación de dispositivos y versiones de OS',
        probability: 0.6,
        impact: 0.5,
        mitigation: 'Soporte para las últimas 3 versiones de iOS/Android y testing en device farm.',
      },
      {
        name: 'Rechazo en revisión de App Store / Play Store',
        probability: 0.3,
        impact: 0.6,
        mitigation: 'Checklist de compliance pre-submit y relación con representantes de las tiendas.',
      },
      {
        name: 'Performance degradada en dispositivos de gama baja',
        probability: 0.5,
        impact: 0.6,
        mitigation: 'Budget de performance por pantalla y profiling en dispositivos de referencia de gama baja.',
      },
      {
        name: 'Baja tasa de adopción y ratings negativos',
        probability: 0.4,
        impact: 0.7,
        mitigation: 'Beta testing con usuarios reales, programa de early adopters y respuesta activa a reviews.',
      },
      {
        name: 'Sincronización offline-online con pérdida de datos',
        probability: 0.3,
        impact: 0.8,
        mitigation: 'Conflict resolution strategy definida y pruebas exhaustivas de edge cases de conectividad.',
      },
    ],
    executiveSummaryTemplate:
      'La iniciativa mobile representa una apuesta estratégica en el canal de mayor crecimiento. La experiencia nativa mejora significativamente la satisfacción del cliente y habilita funcionalidades clave como boarding pass offline y notificaciones push que impactan directamente en la operación.',
    recommendations: [
      'Priorizar los flujos de mayor frecuencia de uso: check-in, boarding pass y estado de vuelo.',
      'Implementar analytics de comportamiento in-app para iterar basado en datos reales.',
      'Considerar React Native para maximizar code sharing entre iOS y Android sin sacrificar experiencia nativa.',
      'Establecer pipeline de CI/CD con distribución automática a testers internos.',
    ],
  },
  {
    keywords: ['monitoreo', 'observabilidad', 'dashboard', 'métricas', 'alertas'],
    label: 'Monitoreo y Observabilidad',
    investmentRange: [300, 500],
    roiRange: [120, 180],
    paybackRange: [12, 18],
    impactScores: {
      customerExperience: 45,
      operationalEfficiency: 95,
      revenue: 40,
      innovation: 60,
      scalability: 85,
      compliance: 75,
    },
    risks: [
      {
        name: 'Sobrecarga de alertas (alert fatigue)',
        probability: 0.6,
        impact: 0.5,
        mitigation: 'Implementación progresiva de alertas con SLOs bien definidos y reducción de ruido.',
      },
      {
        name: 'Costo elevado de retención de datos de observabilidad',
        probability: 0.5,
        impact: 0.6,
        mitigation: 'Políticas de retención por nivel de datos y sampling inteligente para trazas de alto volumen.',
      },
      {
        name: 'Falta de adopción por equipos de desarrollo',
        probability: 0.5,
        impact: 0.7,
        mitigation: 'Integración en pipeline de CI/CD y dashboards por defecto para cada nuevo servicio.',
      },
      {
        name: 'Incompatibilidad con sistemas legacy no instrumentados',
        probability: 0.7,
        impact: 0.4,
        mitigation: 'Agentes de instrumentación automática y proxies para servicios que no soporten SDKs.',
      },
    ],
    executiveSummaryTemplate:
      'La inversión en observabilidad es una habilitadora fundamental para la salud operativa de toda la plataforma. Aunque el retorno directo en ingresos es menor, la reducción en tiempo de detección y resolución de incidentes protege los ingresos existentes y mejora la confiabilidad del servicio.',
    recommendations: [
      'Adoptar OpenTelemetry como estándar de instrumentación para evitar vendor lock-in.',
      'Comenzar con las métricas doradas (latencia, tráfico, errores, saturación) antes de expandir.',
      'Establecer SLOs claros por servicio y vincular alertas a violaciones de SLO, no a umbrales arbitrarios.',
      'Crear dashboards de negocio además de técnicos para alinear la observabilidad con objetivos de la empresa.',
    ],
  },
];

// Default fallback profile
const defaultProfile: CategoryProfile = {
  keywords: [],
  label: 'General',
  investmentRange: [500, 800],
  roiRange: [150, 250],
  paybackRange: [8, 14],
  impactScores: {
    customerExperience: 65,
    operationalEfficiency: 65,
    revenue: 60,
    innovation: 60,
    scalability: 65,
    compliance: 60,
  },
  risks: [
    {
      name: 'Alcance del proyecto mal definido',
      probability: 0.5,
      impact: 0.7,
      mitigation: 'Sesiones de refinamiento con stakeholders y definición clara de criterios de aceptación.',
    },
    {
      name: 'Dependencias externas no identificadas',
      probability: 0.4,
      impact: 0.6,
      mitigation: 'Mapeo de dependencias en fase de diseño y acuerdos de nivel de servicio con proveedores.',
    },
    {
      name: 'Rotación del equipo durante el proyecto',
      probability: 0.3,
      impact: 0.6,
      mitigation: 'Documentación técnica actualizada, pair programming y knowledge sharing sessions.',
    },
    {
      name: 'Retrasos por cambios en prioridades del negocio',
      probability: 0.5,
      impact: 0.5,
      mitigation: 'Governance claro con comité de priorización y protección de capacity comprometida.',
    },
  ],
  executiveSummaryTemplate:
    'La iniciativa presenta un caso de negocio equilibrado con una inversión moderada y retorno esperado dentro de los parámetros aceptables. Se recomienda avanzar con un enfoque iterativo para validar las hipótesis de valor tempranamente.',
  recommendations: [
    'Definir métricas de éxito claras antes de iniciar la implementación.',
    'Implementar en fases iterativas con validación de valor al final de cada fase.',
    'Asegurar alineación con stakeholders clave mediante revisiones quincenales.',
    'Establecer criterios de go/no-go para cada fase basados en métricas objetivas.',
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractInitiativeText(initiative: Initiative): string {
  return [initiative.name, initiative.description].join(' ');
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function extractTeamsFromEpics(epics: Epic[]): string[] {
  const teamsSet = new Set<string>();
  for (const epic of epics) {
    if (epic.teamsInvolved) {
      epic.teamsInvolved.split(',').forEach((team) => {
        const trimmed = team.trim();
        if (trimmed) teamsSet.add(trimmed);
      });
    }
  }
  if (teamsSet.size === 0) {
    return ['Desarrollo', 'QA', 'Arquitectura', 'DevOps'];
  }
  return Array.from(teamsSet);
}

function extractBenefitsFromEpics(epics: Epic[]): string[] {
  const benefits: string[] = [];
  for (const epic of epics) {
    if (epic.quantitativeBenefits) {
      benefits.push(epic.quantitativeBenefits);
    }
  }
  return benefits;
}

// ---------------------------------------------------------------------------
// Generation logic
// ---------------------------------------------------------------------------

function selectProfile(initiative: Initiative): CategoryProfile {
  const text = extractInitiativeText(initiative).toLowerCase();

  let bestScore = 0;
  let bestProfile: CategoryProfile | null = null;

  for (const profile of categoryProfiles) {
    const score = profile.keywords.filter((kw) => text.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestProfile = profile;
    }
  }

  return bestProfile && bestScore > 0 ? bestProfile : defaultProfile;
}

function generateCostBenefitItems(
  epics: Epic[],
  totalInvestment: number,
  annualReturn: number,
): CostBenefitItem[] {
  const teams = extractTeamsFromEpics(epics);
  const benefits = extractBenefitsFromEpics(epics);

  const items: CostBenefitItem[] = [];

  // Cost items distributed across teams
  const costPerTeam = totalInvestment / teams.length;
  for (const team of teams) {
    items.push({
      category: `Equipo ${team}`,
      estimated: roundTo(costPerTeam * randomInRange(0.7, 1.3), 1),
      type: 'cost',
    });
  }

  // Infrastructure cost
  items.push({
    category: 'Infraestructura y Licencias',
    estimated: roundTo(totalInvestment * randomInRange(0.1, 0.2), 1),
    type: 'cost',
  });

  // Benefit items
  const benefitLabels =
    benefits.length >= 3
      ? benefits.slice(0, 3)
      : [
          'Incremento en conversión de ventas',
          'Reducción de costos operativos',
          'Mejora en retención de clientes',
        ];

  const benefitShare = annualReturn / benefitLabels.length;
  for (const label of benefitLabels) {
    items.push({
      category: label.length > 60 ? label.substring(0, 57) + '...' : label,
      estimated: roundTo(benefitShare * randomInRange(0.6, 1.4), 1),
      type: 'benefit',
    });
  }

  return items;
}

function generateROIProjection(
  totalInvestment: number,
  annualReturn: number,
  paybackMonths: number,
): ROIProjectionPoint[] {
  const points: ROIProjectionPoint[] = [];

  // Investment ramps up in early months, then levels off
  // Returns start slow and accelerate after payback threshold
  for (let m = 1; m <= 12; m++) {
    const investmentProgress = Math.min(1, m / Math.max(paybackMonths * 0.8, 4));
    const cumulativeInvestment = roundTo(totalInvestment * investmentProgress, 1);

    // S-curve for returns: slow start, acceleration, then stabilization
    const returnProgress = 1 / (1 + Math.exp(-0.8 * (m - paybackMonths * 0.6)));
    const cumulativeReturn = roundTo(annualReturn * returnProgress, 1);

    const netValue = roundTo(cumulativeReturn - cumulativeInvestment, 1);

    points.push({
      month: `Mes ${m}`,
      investment: cumulativeInvestment,
      returnValue: cumulativeReturn,
      netValue,
    });
  }

  return points;
}

function generateImpactDimensions(
  scores: CategoryProfile['impactScores'],
  progressFactor: number,
): ImpactDimension[] {
  const jitter = () => Math.round(randomInRange(-8, 8));
  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  // Progress slightly boosts scores (projects further along have more validated impact)
  const progressBoost = Math.round(progressFactor * 10);

  return [
    {
      dimension: 'Experiencia del Cliente',
      score: clamp(scores.customerExperience + jitter() + progressBoost),
      description: 'Impacto en la satisfacción y facilidad de uso para el cliente final.',
    },
    {
      dimension: 'Eficiencia Operativa',
      score: clamp(scores.operationalEfficiency + jitter() + progressBoost),
      description: 'Mejora en procesos internos, automatización y reducción de esfuerzo manual.',
    },
    {
      dimension: 'Generación de Ingresos',
      score: clamp(scores.revenue + jitter() + progressBoost),
      description: 'Impacto directo e indirecto en los ingresos de la organización.',
    },
    {
      dimension: 'Innovación Tecnológica',
      score: clamp(scores.innovation + jitter()),
      description: 'Nivel de modernización tecnológica y adopción de nuevas capacidades.',
    },
    {
      dimension: 'Escalabilidad',
      score: clamp(scores.scalability + jitter()),
      description: 'Capacidad de la solución para crecer con la demanda sin degradación.',
    },
    {
      dimension: 'Cumplimiento y Seguridad',
      score: clamp(scores.compliance + jitter()),
      description: 'Alineación con estándares regulatorios, de seguridad y gobernanza.',
    },
  ];
}

function generateResourceAllocation(
  epics: Epic[],
  totalInvestment: number,
): ResourceAllocation[] {
  const teams = extractTeamsFromEpics(epics);

  // Distribute allocation percentages that sum to ~100
  const rawWeights = teams.map(() => randomInRange(0.5, 1.5));
  const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);

  return teams.map((team, idx) => {
    const allocation = roundTo((rawWeights[idx] / totalWeight) * 100, 0);
    const monthlyCost = roundTo((totalInvestment / 12) * (rawWeights[idx] / totalWeight), 1);
    return {
      team,
      allocation,
      cost: monthlyCost,
    };
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateEconomicAnalysis(
  initiative: Initiative,
  epics: Epic[],
  storiesCount: number,
  doneStoriesCount: number,
  totalPoints: number,
  donePoints: number,
): Promise<EconomicAnalysisReport> {
  // Simulate AI thinking time (3-5 seconds)
  await new Promise((resolve) => setTimeout(resolve, 3000 + Math.random() * 2000));

  const profile = selectProfile(initiative);

  // Scale investment proportionally to number of epics
  const epicScaleFactor = 1 + epics.length * 0.15;
  const baseInvestment = randomInRange(profile.investmentRange[0], profile.investmentRange[1]);
  const estimatedTotalInvestment = roundTo(baseInvestment * epicScaleFactor, 1);

  const roiPercentage = roundTo(randomInRange(profile.roiRange[0], profile.roiRange[1]), 1);
  const estimatedAnnualReturn = roundTo(estimatedTotalInvestment * (roiPercentage / 100), 1);

  const paybackMonths = roundTo(randomInRange(profile.paybackRange[0], profile.paybackRange[1]), 1);

  // Progress factor: how much of the initiative is done (0 to 1)
  const progressFactor = storiesCount > 0 ? doneStoriesCount / storiesCount : 0;
  const pointsProgress = totalPoints > 0 ? donePoints / totalPoints : 0;

  // Slightly adjust projections based on progress (more progress = slightly better numbers)
  const progressAdjustment = 1 + progressFactor * 0.05;
  const adjustedReturn = roundTo(estimatedAnnualReturn * progressAdjustment, 1);
  const adjustedROI = roundTo(roiPercentage * progressAdjustment, 1);

  // NPV calculation (simplified: discount rate 10%, 3-year horizon)
  const discountRate = 0.1;
  let npv = -estimatedTotalInvestment;
  for (let year = 1; year <= 3; year++) {
    npv += adjustedReturn / Math.pow(1 + discountRate, year);
  }
  npv = roundTo(npv, 1);

  // IRR approximation (simplified)
  const irr = roundTo(adjustedROI * 0.65 + randomInRange(-5, 5), 1);

  // Build report sections
  const costBenefitItems = generateCostBenefitItems(epics, estimatedTotalInvestment, adjustedReturn);
  const roiProjection = generateROIProjection(estimatedTotalInvestment, adjustedReturn, paybackMonths);
  const impactDimensions = generateImpactDimensions(profile.impactScores, progressFactor);
  const resourceAllocation = generateResourceAllocation(epics, estimatedTotalInvestment);

  // Build executive summary with context
  const progressNote =
    progressFactor > 0
      ? ` El avance actual es del ${roundTo(progressFactor * 100, 0)}% en historias (${doneStoriesCount}/${storiesCount}) y ${roundTo(pointsProgress * 100, 0)}% en puntos (${donePoints}/${totalPoints}), lo que refuerza la confianza en las proyecciones.`
      : '';

  const executiveSummary =
    `${profile.executiveSummaryTemplate}${progressNote} La inversión estimada total es de $${estimatedTotalInvestment.toLocaleString()}K USD con un retorno anual proyectado de $${adjustedReturn.toLocaleString()}K USD, resultando en un ROI del ${adjustedROI}% y un periodo de recuperación de ${paybackMonths} meses.`;

  return {
    estimatedTotalInvestment,
    estimatedAnnualReturn: adjustedReturn,
    roiPercentage: adjustedROI,
    paybackMonths,
    npv,
    irr,
    costBenefitItems,
    roiProjection,
    impactDimensions,
    resourceAllocation,
    risks: profile.risks,
    executiveSummary,
    recommendations: profile.recommendations,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Chart selection types
// ---------------------------------------------------------------------------

export type VisualizationType =
  | 'bar' | 'line' | 'area' | 'pie' | 'radar'
  | 'scatter' | 'treemap' | 'heatmap' | 'gauge' | 'waterfall' | 'sankey' | 'funnel';

export const ALL_VISUALIZATION_TYPES: VisualizationType[] = [
  'bar', 'line', 'area', 'pie', 'radar',
  'scatter', 'treemap', 'heatmap', 'gauge', 'waterfall', 'sankey', 'funnel',
];

export const VISUALIZATION_TYPE_LABELS: Record<VisualizationType, string> = {
  bar: 'Barras',
  line: 'Linea',
  area: 'Area',
  pie: 'Pastel',
  radar: 'Radar',
  scatter: 'Dispersión',
  treemap: 'Treemap',
  heatmap: 'Heatmap',
  gauge: 'Gauge',
  waterfall: 'Waterfall',
  sankey: 'Sankey',
  funnel: 'Funnel',
};

export type VizCategory = 'comparison' | 'trend' | 'composition' | 'correlation' | 'flow';

export interface VizTypeMetadata {
  type: VisualizationType;
  label: string;
  category: VizCategory;
  description: string;
  bestFor: string;
}

export const VIZ_CATEGORIES: Record<VizCategory, string> = {
  comparison: 'Comparación',
  trend: 'Tendencia',
  composition: 'Composición',
  correlation: 'Correlación',
  flow: 'Flujo',
};

export const VIZ_TYPE_METADATA: VizTypeMetadata[] = [
  { type: 'bar', label: 'Barras', category: 'comparison', description: 'Compara valores entre categorías', bestFor: 'Rankings, costos vs beneficios' },
  { type: 'line', label: 'Línea', category: 'trend', description: 'Muestra tendencias a lo largo del tiempo', bestFor: 'Proyecciones ROI, métricas mensuales' },
  { type: 'area', label: 'Área', category: 'trend', description: 'Volumen acumulado en el tiempo', bestFor: 'Inversión acumulada, crecimiento' },
  { type: 'pie', label: 'Pastel', category: 'composition', description: 'Proporción de un total', bestFor: 'Distribución de recursos, presupuesto' },
  { type: 'radar', label: 'Radar', category: 'comparison', description: 'Perfil multidimensional', bestFor: 'Impacto en múltiples dimensiones' },
  { type: 'scatter', label: 'Dispersión', category: 'correlation', description: 'Relación entre dos variables', bestFor: 'Riesgo vs probabilidad, costo vs impacto' },
  { type: 'heatmap', label: 'Heatmap', category: 'correlation', description: 'Patrones en matrices', bestFor: 'Actividad por tiempo, cobertura' },
  { type: 'waterfall', label: 'Waterfall', category: 'flow', description: 'Descomposición incremental de valores', bestFor: 'Desglose financiero, P&L' },
  { type: 'funnel', label: 'Funnel', category: 'flow', description: 'Conversión por etapas', bestFor: 'Pipeline, proceso de aprobación' },
  { type: 'gauge', label: 'Gauge', category: 'comparison', description: 'KPI contra un objetivo', bestFor: 'Progreso de ROI, cumplimiento de meta' },
  { type: 'treemap', label: 'Treemap', category: 'composition', description: 'Jerarquías con proporciones', bestFor: 'Distribución de épicas, presupuesto' },
  { type: 'sankey', label: 'Sankey', category: 'flow', description: 'Flujo de valores entre nodos', bestFor: 'Flujo de inversión, asignación' },
];

// ---------------------------------------------------------------------------
// Prompt-based analysis request / response
// ---------------------------------------------------------------------------

export interface AnalysisRequest {
  prompt: string;
  initiative: Initiative;
  epics: Epic[];
  storiesCount: number;
  doneStoriesCount: number;
  totalPoints: number;
  donePoints: number;
}

export interface AnalysisResponse {
  id: string;
  title: string;
  prompt: string;
  report: EconomicAnalysisReport;
  summary: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Prompt-based analysis generation
// ---------------------------------------------------------------------------

export async function generateAnalysisFromPrompt(
  request: AnalysisRequest,
): Promise<AnalysisResponse> {
  // Generate report (2-4s simulated delay)
  const report = await (async () => {
    await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 2000));

    const profile = selectProfile(request.initiative);

    const epicScaleFactor = 1 + request.epics.length * 0.15;
    const baseInvestment = randomInRange(profile.investmentRange[0], profile.investmentRange[1]);
    const estimatedTotalInvestment = roundTo(baseInvestment * epicScaleFactor, 1);

    const roiPercentage = roundTo(randomInRange(profile.roiRange[0], profile.roiRange[1]), 1);
    const estimatedAnnualReturn = roundTo(estimatedTotalInvestment * (roiPercentage / 100), 1);

    const paybackMonths = roundTo(randomInRange(profile.paybackRange[0], profile.paybackRange[1]), 1);

    const progressFactor = request.storiesCount > 0 ? request.doneStoriesCount / request.storiesCount : 0;
    const pointsProgress = request.totalPoints > 0 ? request.donePoints / request.totalPoints : 0;

    const progressAdjustment = 1 + progressFactor * 0.05;
    const adjustedReturn = roundTo(estimatedAnnualReturn * progressAdjustment, 1);
    const adjustedROI = roundTo(roiPercentage * progressAdjustment, 1);

    const discountRate = 0.1;
    let npv = -estimatedTotalInvestment;
    for (let year = 1; year <= 3; year++) {
      npv += adjustedReturn / Math.pow(1 + discountRate, year);
    }
    npv = roundTo(npv, 1);

    const irr = roundTo(adjustedROI * 0.65 + randomInRange(-5, 5), 1);

    const costBenefitItems = generateCostBenefitItems(request.epics, estimatedTotalInvestment, adjustedReturn);
    const roiProjection = generateROIProjection(estimatedTotalInvestment, adjustedReturn, paybackMonths);
    const impactDimensions = generateImpactDimensions(profile.impactScores, progressFactor);
    const resourceAllocation = generateResourceAllocation(request.epics, estimatedTotalInvestment);

    const progressNote =
      progressFactor > 0
        ? ` El avance actual es del ${roundTo(progressFactor * 100, 0)}% en historias (${request.doneStoriesCount}/${request.storiesCount}) y ${roundTo(pointsProgress * 100, 0)}% en puntos (${request.donePoints}/${request.totalPoints}), lo que refuerza la confianza en las proyecciones.`
        : '';

    const executiveSummary =
      `${profile.executiveSummaryTemplate}${progressNote} La inversión estimada total es de $${estimatedTotalInvestment.toLocaleString()}K USD con un retorno anual proyectado de $${adjustedReturn.toLocaleString()}K USD, resultando en un ROI del ${adjustedROI}% y un periodo de recuperación de ${paybackMonths} meses.`;

    return {
      estimatedTotalInvestment,
      estimatedAnnualReturn: adjustedReturn,
      roiPercentage: adjustedROI,
      paybackMonths,
      npv,
      irr,
      costBenefitItems,
      roiProjection,
      impactDimensions,
      resourceAllocation,
      risks: profile.risks,
      executiveSummary,
      recommendations: profile.recommendations,
      generatedAt: new Date().toISOString(),
    } satisfies EconomicAnalysisReport;
  })();

  const title =
    request.prompt.length > 50
      ? request.prompt.substring(0, 50) + '...'
      : request.prompt;

  const summary =
    `Se generó un análisis económico para "${request.initiative.name}" basado en tu solicitud. ` +
    `La inversión estimada es de $${report.estimatedTotalInvestment.toLocaleString()}K USD con un ROI proyectado del ${report.roiPercentage}%.`;

  return {
    id: crypto.randomUUID(),
    title,
    prompt: request.prompt,
    report,
    summary,
    createdAt: new Date().toISOString(),
  };
}
