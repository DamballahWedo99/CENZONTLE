/**
 * Serializadores de artefactos de épica a markdown humano-legible y parseable por agentes.
 *
 * Reglas de diseño:
 *  - Todas las funciones son puras (mismo input → mismo output).
 *  - Separador entre secciones: `\n\n`.
 *  - Tablas con `|` alineadas al ancho mínimo necesario.
 *  - Frontmatter YAML delimitado con `---\n...\n---`.
 *  - Comentarios en español; el markdown generado también está en español.
 */

import type {
  EpicDiagram,
  EpicDependency,
  QAMatrix,
  EpicQAMatrix,
  DiagramNodeGroup,
  EpicQATestCategory,
} from '@cenzontle/shared';
import { DIAGRAM_NODE_GROUPS, EPIC_QA_CATEGORY_LABELS } from '@cenzontle/shared';
import { scrubSecrets } from '../../../common/utils/scrub-secrets.util';

// ─────────────────────────────────────────────────────────────────────
//   Utilidades internas
// ─────────────────────────────────────────────────────────────────────

/**
 * Escapa el contenido de una celda de tabla markdown: reemplaza `|` por `\|`
 * y elimina saltos de línea para que no rompan la fila.
 */
function escapeCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\n/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Construye una tabla markdown con encabezados y filas.
 * @param headers - Nombres de columna
 * @param rows    - Filas como arrays de strings (mismo orden que headers)
 */
function buildTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n_Sin registros._`;
  }
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const head = `| ${headers.join(' | ')} |`;
  const body = rows
    .map((row) => `| ${row.map(escapeCell).join(' | ')} |`)
    .join('\n');
  return `${head}\n${sep}\n${body}`;
}

/**
 * Genera el bloque frontmatter YAML a partir de pares clave-valor.
 * Los valores ya deben estar formateados (strings, booleans o null).
 */
function frontmatter(pairs: Array<[string, string | boolean | number | null]>): string {
  const body = pairs
    .map(([k, v]) => {
      if (v === null || v === undefined) return `${k}: ~`;
      if (typeof v === 'boolean') return `${k}: ${v}`;
      if (typeof v === 'number') return `${k}: ${v}`;
      // Entrecomilla strings con caracteres especiales YAML
      const needsQuotes = /[:#[\]{}&*!,|>'"?@`]/.test(String(v)) || String(v).trim() !== String(v);
      return needsQuotes ? `${k}: ${JSON.stringify(String(v))}` : `${k}: ${v}`;
    })
    .join('\n');
  return `---\n${body}\n---`;
}

// ─────────────────────────────────────────────────────────────────────
//   Etiquetas en español para tipos/estados/prioridades
// ─────────────────────────────────────────────────────────────────────

const DIAGRAM_TYPE_LABELS: Record<string, string> = {
  business: 'Negocio',
  technical: 'Técnico',
};

const GROUP_LABELS: Record<DiagramNodeGroup, string> = {
  start: 'Inicio',
  end: 'Fin',
  frontend: 'Frontend',
  backend: 'Backend',
  data: 'Datos',
  infra: 'Infraestructura',
  external: 'Externo',
};

const DEPENDENCY_TYPE_LABELS: Record<string, string> = {
  technical: 'Técnica',
  resource: 'Recurso',
  knowledge: 'Conocimiento',
  external: 'Externa',
  'cross-team': 'Inter-equipo',
};

const DEPENDENCY_DIRECTION_LABELS: Record<string, string> = {
  depends_on: 'Depende de',
  depended_on_by: 'Es requerida por',
};

const DEPENDENCY_STATUS_LABELS: Record<string, string> = {
  identified: 'Identificada',
  in_progress: 'En progreso',
  resolved: 'Resuelta',
  blocked: 'Bloqueada',
  mitigated: 'Mitigada',
};

const DEPENDENCY_SCHEDULING_LABELS: Record<string, string> = {
  'finish-to-start': 'Fin-a-Inicio',
  'start-to-start': 'Inicio-a-Inicio',
  'finish-to-finish': 'Fin-a-Fin',
  'start-to-finish': 'Inicio-a-Fin',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

const TEST_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  passed: 'Pasó',
  failed: 'Falló',
  blocked: 'Bloqueado',
  skipped: 'Omitido',
};

const TEST_PRIORITY_LABELS: Record<string, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

const AUTOMATION_STATUS_LABELS: Record<string, string> = {
  manual: 'Manual',
  automated: 'Automatizado',
  to_automate: 'Por automatizar',
};

// ─────────────────────────────────────────────────────────────────────
//   buildDiagramMarkdown
// ─────────────────────────────────────────────────────────────────────

/**
 * Serializa un `EpicDiagram` a markdown con:
 *  - Frontmatter YAML (id, type, generatedAt, generatedBy)
 *  - Título H1 con nombre del diagrama
 *  - Tabla de nodos agrupada por `group` (columnas: id, type, label, description)
 *  - Tabla de edges (columnas: source → target, label, animated)
 *  - Leyenda de grupos presentes en el diagrama
 *  - Resumen de pasos de integración si existen
 */
export function buildDiagramMarkdown(diagram: EpicDiagram): string {
  // ── Frontmatter ──
  const fm = frontmatter([
    ['id', diagram.id],
    ['type', diagram.type],
    ['generatedAt', diagram.generatedAt],
    ['generatedBy', diagram.generatedBy],
    ['hasManualLayout', diagram.hasManualLayout ?? false],
  ]);

  // ── Nodos agrupados ──
  // Recopilar todos los grupos presentes, respetando el orden canónico
  const groupsPresent = DIAGRAM_NODE_GROUPS.filter((g) =>
    diagram.nodes.some((n) => n.group === g),
  );
  // Los nodos sin grupo o con group desconocido caen en un grupo "Otros"
  const ungrouped = diagram.nodes.filter(
    (n) => !n.group || !(DIAGRAM_NODE_GROUPS as readonly string[]).includes(n.group),
  );

  const nodesSection = (() => {
    const parts: string[] = [];

    for (const group of groupsPresent) {
      const nodesInGroup = diagram.nodes.filter((n) => n.group === group);
      const label = GROUP_LABELS[group] ?? group;
      const rows = nodesInGroup.map((n) => [
        n.id,
        n.type,
        n.label,
        n.description ?? '',
      ]);
      parts.push(`### ${label}\n\n${buildTable(['ID', 'Tipo', 'Etiqueta', 'Descripción'], rows)}`);
    }

    if (ungrouped.length > 0) {
      const rows = ungrouped.map((n) => [n.id, n.type, n.label, n.description ?? '']);
      parts.push(`### Sin grupo\n\n${buildTable(['ID', 'Tipo', 'Etiqueta', 'Descripción'], rows)}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '_No hay nodos._';
  })();

  // ── Edges ──
  const edgeRows = diagram.edges.map((e) => [
    `${e.source} → ${e.target}`,
    e.label ?? '',
    e.animated ? 'Sí' : 'No',
  ]);
  const edgesSection = buildTable(['Conexión (origen → destino)', 'Etiqueta', 'Animada'], edgeRows);

  // ── Leyenda de grupos ──
  const legendaRows = groupsPresent.map((g) => {
    const count = diagram.nodes.filter((n) => n.group === g).length;
    return [GROUP_LABELS[g] ?? g, `${count} nodo${count !== 1 ? 's' : ''}`];
  });
  const legendaSection =
    legendaRows.length > 0
      ? buildTable(['Grupo', 'Cantidad'], legendaRows)
      : '_Sin grupos definidos._';

  // ── Pasos de integración (opcional) ──
  let stepsSection = '';
  if (diagram.steps && diagram.steps.length > 0) {
    const sortedSteps = [...diagram.steps].sort((a, b) => a.order - b.order);
    const stepParts = sortedSteps.map((step) => {
      const bullet = step.bulletpoints?.length
        ? '\n\n**Puntos clave:**\n' + step.bulletpoints.map((bp) => `- ${bp}`).join('\n')
        : '';
      const summary = step.summary ? `\n\n> ${step.summary}` : '';
      const nodeList = step.nodeIds.length
        ? `\n\n**Nodos:** ${step.nodeIds.join(', ')}`
        : '';
      return `#### Paso ${step.order}: ${step.title}\n\n${step.description}${summary}${bullet}${nodeList}`;
    });
    stepsSection = `\n\n## Pasos del flujo de integración\n\n${stepParts.join('\n\n')}`;
  }

  // ── Ensamblado final ──
  const typeLabel = DIAGRAM_TYPE_LABELS[diagram.type] ?? diagram.type;
  return [
    fm,
    '',
    `# ${diagram.name}`,
    '',
    `**Tipo:** ${typeLabel} · **Generado:** ${diagram.generatedAt} · **Por:** ${diagram.generatedBy}`,
    '',
    '## Nodos',
    '',
    nodesSection,
    '',
    '## Conexiones (edges)',
    '',
    edgesSection,
    '',
    '## Leyenda de grupos',
    '',
    legendaSection,
    ...(stepsSection ? [stepsSection] : []),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
//   buildDependencyMarkdown
// ─────────────────────────────────────────────────────────────────────

/**
 * Serializa un `EpicDependency` a markdown con:
 *  - Frontmatter YAML con los campos clave de la dependencia
 *  - Título H1 con el título de la dependencia
 *  - Sección `## Descripción` con el cuerpo narrativo
 *  - Sección `## Resolución` con `resolutionNotes`
 *
 * Los campos de texto libre (title, description, resolutionNotes, owner)
 * se pasan por `scrubSecrets` antes de escribir al vault. El vault se
 * sincroniza a un repo de GitHub que puede ser publico o compartido con
 * terceros — cualquier secret que un usuario pegue accidentalmente en
 * estos campos se filtraria si no lo redactamos aqui.
 */
export function buildDependencyMarkdown(dep: EpicDependency): string {
  // ── Frontmatter ──
  const fm = frontmatter([
    ['id', dep.id],
    ['type', dep.type],
    ['direction', dep.direction],
    ['severity', dep.severity],
    ['status', dep.status],
    ['scheduling', dep.scheduling],
    ['isBlocking', dep.isBlocking],
    ['targetEpicId', dep.targetEpicId ?? null],
    ['targetExternalName', dep.targetExternalName ? scrubSecrets(dep.targetExternalName) : null],
    ['owner', scrubSecrets(dep.owner)],
    ['dueDate', dep.dueDate ?? null],
    ['createdAt', dep.createdAt],
    ['updatedAt', dep.updatedAt],
  ]);

  // ── Metadatos en tabla ──
  const metaRows = [
    ['Tipo', DEPENDENCY_TYPE_LABELS[dep.type] ?? dep.type],
    ['Dirección', DEPENDENCY_DIRECTION_LABELS[dep.direction] ?? dep.direction],
    ['Severidad', SEVERITY_LABELS[dep.severity] ?? dep.severity],
    ['Estado', DEPENDENCY_STATUS_LABELS[dep.status] ?? dep.status],
    ['Scheduling', DEPENDENCY_SCHEDULING_LABELS[dep.scheduling] ?? dep.scheduling],
    ['¿Bloquea?', dep.isBlocking ? 'Sí' : 'No'],
    ['Responsable', scrubSecrets(dep.owner)],
    ['Vence', dep.dueDate ?? '—'],
    ['Épica destino', dep.targetEpicId ?? (dep.targetExternalName ? scrubSecrets(dep.targetExternalName) : '—')],
  ];
  const metaTable = buildTable(['Atributo', 'Valor'], metaRows);

  return [
    fm,
    '',
    `# ${scrubSecrets(dep.title)}`,
    '',
    metaTable,
    '',
    '## Descripción',
    '',
    dep.description ? scrubSecrets(dep.description) : '_Sin descripción._',
    '',
    '## Resolución',
    '',
    dep.resolutionNotes ? scrubSecrets(dep.resolutionNotes) : '_Sin notas de resolución aún._',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
//   buildQAMatrixMarkdown  (nivel historia — funcional)
// ─────────────────────────────────────────────────────────────────────

/**
 * Serializa un `QAMatrix` (funcional, story-level) a markdown con:
 *  - Frontmatter con id/epicId/generatedAt/generatedBy
 *  - Por cada row (historia): `## <storyTitle>` + subtabla de testCases
 *    (columnas: id, title, priority, status, automationStatus, defectos vinculados)
 */
export function buildQAMatrixMarkdown(matrix: QAMatrix): string {
  // ── Frontmatter ──
  const fm = frontmatter([
    ['id', matrix.id],
    ['epicId', matrix.epicId],
    ['generatedAt', matrix.generatedAt],
    ['generatedBy', matrix.generatedBy],
    ['updatedAt', matrix.updatedAt],
  ]);

  // ── Resumen global ──
  const totalTests = matrix.rows.reduce((sum, r) => sum + r.testCases.length, 0);
  const summaryRows = matrix.rows.map((r) => [
    r.storyTitle,
    r.storyJiraKey || '—',
    `${r.testCases.length}`,
    `${r.coverage}%`,
  ]);
  const summaryTable = buildTable(
    ['Historia', 'Tracker Key', 'Casos de prueba', 'Cobertura'],
    summaryRows,
  );

  // ── Por historia ──
  const storySections = matrix.rows.map((row) => {
    const testRows = row.testCases.map((tc) => [
      tc.id,
      tc.title,
      TEST_PRIORITY_LABELS[tc.priority] ?? tc.priority,
      TEST_STATUS_LABELS[tc.status] ?? tc.status,
      AUTOMATION_STATUS_LABELS[tc.automationStatus] ?? tc.automationStatus,
      tc.linkedDefects.length > 0 ? tc.linkedDefects.join(', ') : '—',
    ]);
    const testTable = buildTable(
      ['ID', 'Título', 'Prioridad', 'Estado', 'Automatización', 'Defectos vinculados'],
      testRows,
    );

    const criteriaSection =
      row.acceptanceCriteria.length > 0
        ? '\n\n**Criterios de aceptación:**\n' +
          row.acceptanceCriteria.map((c) => `- ${c}`).join('\n')
        : '';

    return `## ${row.storyTitle}\n\n${testTable}${criteriaSection}`;
  });

  return [
    fm,
    '',
    '# Matriz QA Funcional',
    '',
    `**Épica:** \`${matrix.epicId}\` · **Total de casos:** ${totalTests} · **Generado:** ${matrix.generatedAt}`,
    '',
    '## Resumen por historia',
    '',
    summaryTable,
    '',
    '## Casos de prueba por historia',
    '',
    storySections.length > 0 ? storySections.join('\n\n') : '_Sin historias con casos de prueba._',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
//   buildEpicQAMatrixMarkdown  (nivel épica — sistémica)
// ─────────────────────────────────────────────────────────────────────

/**
 * Serializa un `EpicQAMatrix` (sistémica, epic-level) a markdown con:
 *  - Frontmatter con id/epicId/generatedAt/generatedBy
 *  - Por categoría (`EPIC_QA_CATEGORY_LABELS`) → agrupa los tests
 *  - Por test: title, priority, status, riesgo (likelihood×impact), scenarios, gherkin, dependencies
 */
export function buildEpicQAMatrixMarkdown(matrix: EpicQAMatrix): string {
  // ── Frontmatter ──
  const fm = frontmatter([
    ['id', matrix.id],
    ['epicId', matrix.epicId],
    ['generatedAt', matrix.generatedAt],
    ['generatedBy', matrix.generatedBy],
    ['updatedAt', matrix.updatedAt],
  ]);

  // ── Cobertura NFR ──
  const coverageRows = (
    Object.entries(EPIC_QA_CATEGORY_LABELS) as Array<[EpicQATestCategory, string]>
  ).map(([cat, label]) => {
    const pct = matrix.nfrCoverage[cat] ?? 0;
    const count = matrix.tests.filter((t) => t.category === cat).length;
    return [label, `${count} test${count !== 1 ? 's' : ''}`, `${pct}%`];
  });
  const coverageTable = buildTable(['Categoría', 'Tests', 'Cobertura NFR'], coverageRows);

  // ── Por categoría ──
  const categorySections = (
    Object.entries(EPIC_QA_CATEGORY_LABELS) as Array<[EpicQATestCategory, string]>
  )
    .map(([cat, catLabel]) => {
      const tests = matrix.tests.filter((t) => t.category === cat);
      if (tests.length === 0) return null;

      const testParts = tests.map((test) => {
        const riesgo = test.riskLikelihood * test.riskImpact;
        const riesgoLabel =
          riesgo >= 15 ? 'Crítico' : riesgo >= 9 ? 'Alto' : riesgo >= 4 ? 'Medio' : 'Bajo';

        // Tabla resumen del test
        const metaRows = [
          ['Prioridad', TEST_PRIORITY_LABELS[test.priority] ?? test.priority],
          ['Estado', TEST_STATUS_LABELS[test.status] ?? test.status],
          ['Automatización', AUTOMATION_STATUS_LABELS[test.automationStatus] ?? test.automationStatus],
          ['Riesgo', `${riesgoLabel} (probabilidad ${test.riskLikelihood} × impacto ${test.riskImpact} = ${riesgo})`],
          ['Asignado a', test.assignedTo ?? '—'],
          ['Defectos vinculados', test.linkedDefects.length > 0 ? test.linkedDefects.join(', ') : '—'],
        ];
        const metaTable = buildTable(['Atributo', 'Valor'], metaRows);

        // Escenarios textuales
        const scenariosSection =
          test.scenarios.length > 0
            ? '\n\n**Escenarios:**\n' + test.scenarios.map((s) => `- ${s}`).join('\n')
            : '';

        // Gherkin
        const gherkinSection =
          test.gherkinScenarios.length > 0
            ? '\n\n**Escenarios Gherkin:**\n\n' +
              test.gherkinScenarios
                .map((g) => {
                  const tags = g.tags.length > 0 ? `${g.tags.join(' ')}\n` : '';
                  return (
                    `\`\`\`gherkin\n${tags}Escenario: ${g.name}\n` +
                    `  Dado ${g.given}\n` +
                    `  Cuando ${g.when}\n` +
                    `  Entonces ${g.then}\n\`\`\``
                  );
                })
                .join('\n\n')
            : '';

        // Dependencias de test
        const depsSection =
          test.dependencies.length > 0
            ? '\n\n**Dependencias del test:**\n' +
              test.dependencies.map((d) => `- ${d}`).join('\n')
            : '';

        return (
          `### ${test.title}\n\n` +
          `${test.description}\n\n` +
          metaTable +
          scenariosSection +
          gherkinSection +
          depsSection
        );
      });

      return `## ${catLabel}\n\n${testParts.join('\n\n')}`;
    })
    .filter(Boolean) as string[];

  return [
    fm,
    '',
    '# Matriz QA Sistémica',
    '',
    `**Épica:** \`${matrix.epicId}\` · **Total de tests:** ${matrix.tests.length} · **Generado:** ${matrix.generatedAt}`,
    '',
    '## Cobertura por categoría NFR',
    '',
    coverageTable,
    '',
    '## Tests por categoría',
    '',
    categorySections.length > 0 ? categorySections.join('\n\n') : '_Sin tests definidos._',
  ].join('\n');
}
