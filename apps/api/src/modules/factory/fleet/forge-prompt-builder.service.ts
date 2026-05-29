import { Injectable } from '@nestjs/common';

/**
 * Construye el prompt que el backend forwarda al worker en cada `claim-story`.
 * Extracción del helper privado de `AgentRunService.buildPrompt`
 * (architecture-reviewer F-04 2026-05-06) por dos razones:
 *
 *  1. SRP: AgentRunService coordina lifecycle (claim → progress → complete);
 *     no debería conocer la estructura del prompt de claude.
 *  2. Iteración rápida: en Sprint 3+ vamos a enriquecer el prompt con
 *     story.markdown, criterios de aceptación, diagrama de la épica,
 *     dependencias hard, contexto del repo, etc. Aislarlo aquí permite
 *     experimentar sin tocar el resto del fleet.
 *
 * Cada método retorna un string completo listo para `claude -p <prompt>`.
 * Cuando el prompt crezca (Sprint 3 lo va a llevar a varios kilobytes),
 * podemos serializar a archivo + pasar `--prompt-file` en vez de argv.
 */
@Injectable()
export class ForgePromptBuilderService {
  /**
   * Cap defensivo: cualquier story con > MAX_ACCEPTANCE_CRITERIA criterios
   * es señal de spec malformada O input adversarial (cost-bomb DoS: cada
   * criterio dispara una invocación a Sonnet en el verifier per-criterio).
   * Truncamos silenciosamente y emitimos warning visible en logs.
   *
   * Why 32: stories típicas tienen 3-8 criterios; 32 es 4x el upper-bound real.
   */
  static readonly MAX_ACCEPTANCE_CRITERIA = 32;

  /**
   * Extrae la lista numerada de criterios de aceptación desde el markdown
   * de una story. Usado por el Forge para inyectar criterios concretos al
   * worker como milestones en la UI Y al verifier para evaluación per-criterio.
   *
   * Pertenece a este service (no a StoriesService) por boundary correctness:
   * el parser es Forge-specific — su único consumidor es el flow del worker
   * vía `AgentRunService.claimStory`. StoriesService quedaba acoplado a
   * lógica de fleet sin razón cohesiva (architecture-reviewer WARN 2026-05-13).
   *
   * Tolerante a variaciones:
   *  - Heading: `## Criterios de aceptación` (h2) o `### ...` (h3)
   *  - Variantes: "Criterios de aceptación" / "Criterios de aceptacion" / "Acceptance criteria"
   *  - Numeración: `1.`, `2)`, `- `, `* `
   *  - Multi-línea: las líneas continuas (sin prefijo de lista) se concatenan al criterio previo
   *
   * Cap superior: MAX_ACCEPTANCE_CRITERIA (defensa contra cost-bomb DoS).
   * Si no encuentra la sección o el markdown es null/vacío, retorna [].
   */
  static extractAcceptanceCriteria(markdown: string | null): string[] {
    if (!markdown) return [];
    const sectionRegex = /^#{2,3}\s+(?:criterios de aceptaci[óo]n|acceptance criteria)\s*$/im;
    const match = markdown.match(sectionRegex);
    if (!match || match.index === undefined) return [];
    const headingLevel = match[0].startsWith('###') ? 3 : 2;
    const after = markdown.slice(match.index + match[0].length);
    // El final de la sección es el primer heading de igual o menor nivel
    // (## termina con otro ##; ### termina con otro ### o ##).
    const endRegex = headingLevel === 3 ? /^#{2,3}\s+/m : /^##\s+/m;
    const nextSection = after.search(endRegex);
    const sectionBody = nextSection === -1 ? after : after.slice(0, nextSection);
    const lines = sectionBody.split('\n');
    const criteria: string[] = [];
    const itemPrefixRegex = /^(?:\d+[.)]\s+|[-*]\s+)(.+)$/;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        // Línea vacía corta el criterio multi-línea actual (siguiente item arranca limpio).
        continue;
      }
      const itemMatch = trimmed.match(itemPrefixRegex);
      if (itemMatch) {
        criteria.push(itemMatch[1].trim());
      } else if (criteria.length > 0) {
        // Continuación multi-línea del último criterio: concatenamos con espacio.
        criteria[criteria.length - 1] = `${criteria[criteria.length - 1]} ${trimmed}`;
      }
    }
    if (criteria.length > ForgePromptBuilderService.MAX_ACCEPTANCE_CRITERIA) {
      // Visibilidad de truncamiento — un attacker con EDIT_STORY que intente
      // colar 1000 criterios deja rastro forense aquí. Stories legítimas
      // jamás deberían superar el cap (3-8 típicos, 32 es 4x upper-bound).
      console.warn(
        `[forge.extractAcceptanceCriteria] ${criteria.length} criterios extraídos — ` +
          `truncando a ${ForgePromptBuilderService.MAX_ACCEPTANCE_CRITERIA}. Revisar markdown ` +
          `source por posible spec malformada o input adversarial.`,
      );
      return criteria.slice(0, ForgePromptBuilderService.MAX_ACCEPTANCE_CRITERIA);
    }
    return criteria;
  }

  /**
   * Cap defensivo para test cases — mismo razonamiento que MAX_ACCEPTANCE_CRITERIA:
   * cada test case dispara una invocación al verifier Sonnet (cost-bomb DoS).
   * Stories típicas tienen 1-3 happy + 3-7 edge = ~10 casos; cap a 32.
   */
  static readonly MAX_TEST_CASES = 32;

  /**
   * Extrae los casos de prueba enumerados en el QA markdown de una story
   * (secciones `## Happy path` y `## Edge cases`). El verifier los usa para
   * evaluación per-test-case del criterio DoD `tests-passing`: cada caso
   * se valida individualmente (¿existe un test que lo cubra? ¿pasa?) en
   * lugar de la evaluación en bloque ("¿pnpm test exit 0?") legacy.
   *
   * Patrón idéntico a `extractAcceptanceCriteria` para consistency:
   *  - Tolera headings h2 (`## Happy path`) y h3 (`### Happy path`).
   *  - Variantes: "Happy path" / "Happy Path" / "Camino feliz".
   *                "Edge cases" / "Edge Cases" / "Casos edge" / "Casos límite".
   *  - Numeración: `1.`, `2)`, `- `, `* `.
   *  - Multi-línea: continúa el item anterior si no hay prefijo de lista.
   *
   * Cap superior: MAX_TEST_CASES (defensa cost-bomb).
   *
   * Returns:
   *  - `Array<{ category: 'happy' | 'edge', description: string }>` ordenado
   *    happy primero, edge después (orden de aparición dentro de cada categoría).
   *  - Array vacío si el markdown es null/empty o no encontró ninguna sección.
   */
  static extractTestCases(
    qaMarkdown: string | null,
  ): Array<{ category: 'happy' | 'edge'; description: string }> {
    if (!qaMarkdown) return [];

    // Regex permite h2 o h3, con o sin acento, lowercase-insensitive.
    // Happy path: matchea "Happy path", "Happy Path", "Camino feliz".
    // Edge cases: matchea "Edge cases", "Edge Cases", "Casos edge", "Casos límite".
    const happyHeadingRegex = /^#{2,3}\s+(?:happy\s+path|camino\s+feliz)\s*$/im;
    const edgeHeadingRegex = /^#{2,3}\s+(?:edge\s+cases?|casos\s+(?:edge|l[íi]mite))\s*$/im;

    const happy = ForgePromptBuilderService.parseListSection(qaMarkdown, happyHeadingRegex);
    const edge = ForgePromptBuilderService.parseListSection(qaMarkdown, edgeHeadingRegex);

    const cases: Array<{ category: 'happy' | 'edge'; description: string }> = [
      ...happy.map((d) => ({ category: 'happy' as const, description: d })),
      ...edge.map((d) => ({ category: 'edge' as const, description: d })),
    ];

    if (cases.length > ForgePromptBuilderService.MAX_TEST_CASES) {
      return cases.slice(0, ForgePromptBuilderService.MAX_TEST_CASES);
    }
    return cases;
  }

  /**
   * Cap defensivo para technical requirements — mismo razonamiento que
   * MAX_TEST_CASES: cada item dispara una invocación al verifier Sonnet
   * (cost-bomb DoS). Stories típicas tienen 3-8 checklist + 1-3 contract +
   * 2-5 validation + 1-3 errors ≈ 7-19 items; cap a 40.
   */
  static readonly MAX_TECHNICAL_REQUIREMENTS = 40;

  /**
   * Extrae los requerimientos técnicos enumerados en el TL markdown de una
   * story. El verifier los usa para evaluación per-item del criterio DoD
   * `technical-design`: cada item se valida individualmente con (a) pre-flight
   * determinístico (grep en archivos, endpoints, tipos mencionados) y (b)
   * Sonnet judgment para validar implementación semántica.
   *
   * Patrón idéntico a `extractAcceptanceCriteria` / `extractTestCases` para
   * consistency cross-section:
   *  - Tolera headings h2 (`## Checklist...`) y h3 (`### Checklist...`).
   *  - Variantes ES/EN para cada sección (checklist/contrato/validations/errors).
   *  - Numeración: `1.`, `2)`, `- `, `* `.
   *  - Multi-línea: continúa el item anterior si no hay prefijo de lista.
   *
   * Cap superior: MAX_TECHNICAL_REQUIREMENTS (defensa cost-bomb).
   *
   * Returns:
   *  - Array ordenado: checklist primero, después contract, validation, errors.
   *  - Vacío si el markdown es null/empty o no encontró ninguna sección.
   */
  static extractTechnicalRequirements(
    technicalMarkdown: string | null,
  ): Array<{ category: 'checklist' | 'contract' | 'validation' | 'errors'; description: string }> {
    if (!technicalMarkdown) return [];

    // Regex permite h2 o h3, case-insensitive, con variantes ES/EN.
    const checklistRe = /^#{2,3}\s+(?:checklist(?:\s+de\s+implementaci[óo]n)?|implementation\s+checklist)\s*$/im;
    const contractRe = /^#{2,3}\s+(?:contrato|contract|api\s+contract|api)\s*$/im;
    const validationRe = /^#{2,3}\s+(?:validaciones?|validations?|input\s+validation)\s*$/im;
    const errorsRe = /^#{2,3}\s+(?:manejo\s+de\s+errores|error\s+handling|errores|errors)\s*$/im;

    const checklist = ForgePromptBuilderService.parseListSection(technicalMarkdown, checklistRe);
    const contract = ForgePromptBuilderService.parseListSection(technicalMarkdown, contractRe);
    const validation = ForgePromptBuilderService.parseListSection(technicalMarkdown, validationRe);
    const errors = ForgePromptBuilderService.parseListSection(technicalMarkdown, errorsRe);

    const items: Array<{ category: 'checklist' | 'contract' | 'validation' | 'errors'; description: string }> = [
      ...checklist.map((d) => ({ category: 'checklist' as const, description: d })),
      ...contract.map((d) => ({ category: 'contract' as const, description: d })),
      ...validation.map((d) => ({ category: 'validation' as const, description: d })),
      ...errors.map((d) => ({ category: 'errors' as const, description: d })),
    ];

    if (items.length > ForgePromptBuilderService.MAX_TECHNICAL_REQUIREMENTS) {
      return items.slice(0, ForgePromptBuilderService.MAX_TECHNICAL_REQUIREMENTS);
    }
    return items;
  }

  /**
   * Helper genérico: parsea una sección con heading dado y extrae items
   * de lista (numerados o bulleted). Extracción compartida entre
   * `extractAcceptanceCriteria` y `extractTestCases` para evitar
   * duplicación de la lógica de tolerancia a variantes de markdown.
   */
  private static parseListSection(markdown: string, sectionRegex: RegExp): string[] {
    const match = markdown.match(sectionRegex);
    if (!match || match.index === undefined) return [];
    const headingLevel = match[0].startsWith('###') ? 3 : 2;
    const after = markdown.slice(match.index + match[0].length);
    // El final de la sección es el primer heading de igual o menor nivel.
    const endRegex = headingLevel === 3 ? /^#{2,3}\s+/m : /^##\s+/m;
    const nextSection = after.search(endRegex);
    const sectionBody = nextSection === -1 ? after : after.slice(0, nextSection);
    const items: string[] = [];
    const itemPrefixRegex = /^(?:\d+[.)]\s+|[-*]\s+)(.+)$/;
    for (const line of sectionBody.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const itemMatch = trimmed.match(itemPrefixRegex);
      if (itemMatch) {
        items.push(itemMatch[1].trim());
      } else if (items.length > 0) {
        items[items.length - 1] = `${items[items.length - 1]} ${trimmed}`;
      }
    }
    return items;
  }

  /**
   * Prompt MVP de Sprint 2: título + markdown del épic como contexto +
   * la historia específica a implementar.
   *
   * Formato markdown para que claude (que entiende markdown nativamente)
   * estructure su comprensión: la historia bajo el contexto del epic, no
   * como un blob sin jerarquía.
   */
  buildStoryPrompt(input: {
    epicTitle: string;
    epicMarkdown: string;
    /**
     * Diagrama de negocio de la épica serializado como texto (lista de
     * pasos del flow, o descripción de nodos + edges). Aprobado por el
     * equipo en story-gen — el agente DEBE seguir esta arquitectura en
     * vez de improvisar el flow. NULL si la épica no tiene diagrama.
     */
    epicBusinessDiagram: string | null;
    storyTitle: string;
    /**
     * Markdown completo de la sección Producto (negocio) de la story:
     * Antecedentes, Objetivo, Historia de usuario, Criterios de
     * aceptación, Notas. Generado por el agente PO en story-gen.
     *
     * Define EL "qué" — qué debe cumplir el código para satisfacer al
     * usuario final. Es la spec contra la que el verifier valida los
     * acceptance criteria. NULL si vaultPath está vacío o el read falló.
     */
    storyMarkdown: string | null;
    /**
     * Markdown completo de la sección Técnica de la story: arquitectura,
     * flujo de integración, checklist técnico, decisiones de diseño.
     * Generado por el agente Tech Lead en story-gen.
     *
     * Define EL "cómo" — qué patrones usar, dónde poner el código, qué
     * APIs/módulos tocar, qué decisiones arquitectónicas respetar. Sin
     * esto el agente improvisaba arquitectura ignorando el trabajo del TL.
     */
    storyTechnicalMarkdown: string | null;
    /**
     * Markdown completo de la sección QA / Testing strategy de la story:
     * Pruebas unitarias, Happy path, Edge cases, Mocks, Herramientas.
     * Generado por el agente QA en story-gen.
     *
     * Define EL "cómo probarlo" — qué casos específicos cubrir, qué
     * mocks usar, qué herramientas. El agente DEBE implementar TODOS los
     * tests aquí descritos antes de cerrar el run; no es opcional.
     */
    storyQAMarkdown: string | null;
    /**
     * Contexto del DAG — stories del mismo epic que ya completaron antes
     * que esta arrancara. La integration branch del Forge ya tiene sus
     * commits (via auto-merge post-completion) por lo que sus archivos
     * están materializados en el workdir del worker. La sección del prompt
     * las lista explícitamente para que el agente:
     *   1. Sepa cuáles stories existen sin tener que descubrirlas via `ls`.
     *   2. Lea los archivos producidos ANTES de implementar (respeta
     *      contratos previos, evita duplicación tipo epic 9311b334 donde
     *      README re-creó API.md desde cero).
     *   3. Distinga hard-deps (críticas) de siblings informativos.
     *
     * Array vacío para la primera story del epic (no hay siblings aún).
     */
    completedSiblings: Array<{
      storyId: string;
      title: string;
      isHardDep: boolean;
      prNumber: number | null;
      filesModified: number | null;
      filesModifiedPaths: string[];
      completedAt: string;
    }>;
    /**
     * Criterios del Definition of Done configurados en
     * `/factory/settings/Definition of Done`. Se inyectan en el prompt
     * para que el agente sepa exactamente qué validar antes de cerrar el
     * run. Cada criterio trae descripción extendida (texto largo con
     * detalles del "qué se espera") — REQUERIDA por el modelo desde
     * la migration 20260508240000.
     *
     * `kind` es el ID estable que el agente debe usar al reportar
     * evidencia en `.cenzontle-criteria.json` (Tier 1 Harness). Para
     * criterios custom (kind=null), el agente usa el `text` como id.
     *
     * Si la lista está vacía, el agente solo ve los criterios técnicos
     * básicos del flow (commit/push/PR) — no es un error, solo significa
     * que el operador no configuró DoD personalizado.
     */
    dodCriteria: Array<{ kind: string | null; text: string; description: string }>;
    /**
     * Plan de implementación generado por ForgePlannerService (Sonnet + advisor
     * Opus). Inyectado como primera sección del prompt para que el coder agent
     * lea el plan antes de tocar código. NULL si el planner falló o no se
     * invocó — el agente puede ejecutar sin plan (degradación graciosa).
     */
    advisorPlan?: string | null;
  }): string {
    const {
      epicTitle,
      epicMarkdown,
      epicBusinessDiagram,
      storyTitle,
      storyMarkdown,
      storyTechnicalMarkdown,
      storyQAMarkdown,
      completedSiblings,
      dodCriteria,
      advisorPlan,
    } = input;
    const dodSection = this.buildDodSection(dodCriteria);

    // Cada sección del vault se renderea solo si tiene contenido — degradación
    // graciosa: el agente sigue funcionando aunque falte alguna (sandbox, vault
    // read fail, story legacy sin alguna sección).
    const businessDiagramSection = epicBusinessDiagram && epicBusinessDiagram.trim().length > 0
      ? [
          `## Diagrama de negocio de la épica (aprobado por el equipo)`,
          ``,
          `El siguiente flujo fue diseñado y aprobado en story-gen. Tu implementación DEBE respetar esta arquitectura — no improvises un flow distinto.`,
          ``,
          epicBusinessDiagram.trim(),
          ``,
        ]
      : [];

    const storyMarkdownSection = storyMarkdown && storyMarkdown.trim().length > 0
      ? [
          `## Sección Producto — contexto del usuario`,
          ``,
          `Generado por el PO. Te da contexto de PARA QUIÉN construís esto y QUÉ valor de negocio aporta. Los acceptance criteria de acá son el "qué" — el "cómo" está en las secciones Técnica y QA arriba (que ya leíste).`,
          ``,
          storyMarkdown.trim(),
          ``,
        ]
      : [];

    const storyTechnicalSection = storyTechnicalMarkdown && storyTechnicalMarkdown.trim().length > 0
      ? [
          `## ✅ TU CHECKLIST TÉCNICO — implementá CADA item (OBLIGATORIO)`,
          ``,
          `Lo que sigue NO son sugerencias ni criterios que el verifier "checkeará después". Es **TU lista concreta de TODOs**: cada item del checklist, cada contrato, cada validación, cada caso de error — DEBE quedar implementado con código en este run. Si la sección enumera 7 requirements, tu commit debe tener evidencia de cumplir LOS 7. **No alcanza con mencionarlo en un comentario o documentación** — debe haber código que lo ejecute. El verifier es adversarial: lee el diff y valida implementación real, no intención.`,
          ``,
          `Antes de empezar a tocar código, mentalmente marcá cada item de abajo como TODO. Antes del commit final, releé esta sección y verificá que NO te quedó ningún item sin código.`,
          ``,
          storyTechnicalMarkdown.trim(),
          ``,
        ]
      : [];

    // Render del contexto DAG: hard-deps primero (críticas, OBLIGATORIO leer),
    // luego siblings informativos. Si no hay siblings, omitimos toda la
    // sección (la primera story del epic no tiene predecesores).
    const dagSection = ForgePromptBuilderService.buildCompletedSiblingsSection(completedSiblings);

    const storyQASection = storyQAMarkdown && storyQAMarkdown.trim().length > 0
      ? [
          `## ✅ TUS TESTS REQUERIDOS — un test por cada caso enumerado (OBLIGATORIO)`,
          ``,
          `Lo que sigue NO es "estrategia opcional" ni "casos que el verifier va a checkear si quiere". Es **tu lista de tests concretos a escribir**: cada Happy path = UN test específico, cada Edge case enumerado = UN test específico. Si la sección enumera 4 cases (1 happy + 3 edge), tu commit debe agregar 4 tests con nombres que matcheen el caso. **Tests vacíos, \`expect(true).toBe(true)\`, o tests que cubren genéricamente sin assertions sobre el comportamiento descrito = FAIL**.`,
          ``,
          `Los tests deben:`,
          `1. Quedar escritos en archivos del repo (\`*.test.{ts,js}\`, \`*_test.py\`, etc. según el stack).`,
          `2. Pasar al correr el comando del runner (\`npm test\`, \`pytest\`, etc.).`,
          `3. Validar el comportamiento ESPECÍFICO del caso, no genéricamente.`,
          ``,
          `Antes de empezar, mentalmente marcá cada Happy/Edge case como TODO. Antes del commit, releé esta sección y verificá que cada uno tiene su test correspondiente.`,
          ``,
          storyQAMarkdown.trim(),
          ``,
        ]
      : [];

    // Plan del advisor (pre-CLI planning). Si está disponible, se inyecta como
    // PRIMERA sección operativa del prompt (después del título de la story y
    // ANTES de TL/QA/PO markdowns) para que el coder lea el plan antes de
    // tocar cualquier sección de spec. El plan es guía, NO obligación — si
    // choca con la realidad del repo, el coder puede adaptarse.
    const advisorPlanSection = advisorPlan && advisorPlan.trim().length > 0
      ? [
          `## 🧭 Plan de implementación (revisado por advisor Opus)`,
          ``,
          `Antes de tocar código, leé este plan. Fue generado por un planner ` +
            `(Sonnet 4.6) que consultó a un advisor (Opus 4.7) sobre las decisiones ` +
            `arquitecturales críticas de esta story. El plan identifica archivos a ` +
            `tocar, patrón a usar, decisiones críticas y gotchas. **Es tu punto de ` +
            `partida** — pero si al explorar el repo descubrís que algún supuesto del ` +
            `plan es incorrecto (ej. archivo asumido no existe, patrón asumido no ` +
            `aplica), adaptate y explicalo brevemente en tu output. El plan es guía, ` +
            `no obligación.`,
          ``,
          advisorPlan.trim(),
          ``,
        ]
      : [];

    return [
      `# Tarea autónoma de CENZONTLE Forge`,
      ``,
      `## Épica: ${epicTitle}`,
      ``,
      epicMarkdown,
      ``,
      ...businessDiagramSection,
      `## Historia a implementar:`,
      ``,
      `**${storyTitle}**`,
      ``,
      ...advisorPlanSection,
      ...storyTechnicalSection,
      ...storyQASection,
      ...storyMarkdownSection,
      ...dagSection,
      ...(dodSection.length > 0 ? [dodSection, ``] : []),
      `## INSTRUCCIONES CRÍTICAS DE EJECUCIÓN`,
      ``,
      `Estás corriendo de forma **NO INTERACTIVA** dentro del worker del Software Factory.`,
      `**NO HAY UN HUMANO** que pueda aprobar planes o responder preguntas.`,
      ``,
      `- ❌ **NO uses la tool ExitPlanMode**. NO entres en plan mode.`,
      `- ❌ **NO escribas planes en disco** ni en \`~/.claude/plans/\`.`,
      `- ❌ **NO pidas aprobación** ("¿Aprobado para proceder?", "¿Continúo?", etc.).`,
      `- ❌ **NO termines tu output con preguntas**. Tu output final debe ser un resumen de cambios hechos.`,
      `- ✅ **EJECUTA INMEDIATAMENTE**: usa Edit/Write/Bash directamente para implementar la historia.`,
      `- ✅ **CADA STEP DEBE CAMBIAR ARCHIVOS** o correr comandos. No hay valor en planear sin ejecutar.`,
      ``,
      `## Workflow obligatorio`,
      ``,
      `1. Lee el contexto del repo (\`ls\`, \`cat package.json\`, etc.) para entender el stack actual.`,
      `2. **LEE los archivos de stories del DAG ya completadas** (sección "Contexto del DAG" arriba). Usa la tool Read sobre cada path listado — especialmente los marcados como **hard-dep**. Tu implementación debe CONSUMIR o EXTENDER esos archivos, NO duplicar funcionalidad ni crear contratos paralelos.`,
      `3. **Sigue la arquitectura técnica de la historia** (sección Técnica arriba) — no inventes patrones distintos.`,
      `4. Implementa la lógica de negocio: crea/edita archivos con Edit y Write directamente.`,
      `5. **Escribe los tests definidos en la sección QA** (happy path + TODOS los edge cases enumerados). Cada caso descrito debe tener su test correspondiente.`,
      `6. **Corré los GATES de calidad del repo** (lint, type-check, build, tests) — ver "GATE DE AUTO-VERIFICACIÓN" abajo. TODOS deben salir 0. Si alguno falla, arreglalo (incluido config de tooling) ANTES de commitear.`,
      `7. Haz \`git add\` y \`git commit\` con un mensaje claro siguiendo las convenciones del repo.`,
      `8. Termina (el worker hará push y abrirá el PR automáticamente).`,
      ``,
      `## 🔬 GATE DE AUTO-VERIFICACIÓN — corré los gates del repo ANTES de commitear (OBLIGATORIO)`,
      ``,
      `Antes del commit final, ejecutá VOS MISMO los gates de calidad del repo y confirmá que pasan (exit 0). El verifier del Forge corre EXACTAMENTE estos mismos comandos después — si los dejás rotos, la historia cae a in_review. Mirá los scripts de \`package.json\` y corré los que el repo tenga, en este orden:`,
      ``,
      `1. **Lint** (\`pnpm lint\` / \`npm run lint\` / \`eslint .\`) — DEBE salir 0.`,
      `2. **Type-check** (\`pnpm type-check\` / \`tsc --noEmit\`) — DEBE salir 0.`,
      `3. **Build** (\`pnpm build\` / \`npm run build\`) — DEBE compilar sin errores.`,
      `4. **Tests** (\`pnpm test\` / \`vitest run\` / \`pytest\` / el runner del repo) — DEBEN pasar.`,
      ``,
      `Si CUALQUIERA falla, ARREGLALO antes de commitear. Esto incluye fallos de **TOOLING/CONFIG**, no solo errores en tu código:`,
      ``,
      `- Si scaffoldeaste un proyecto, verificá que la config de cada herramienta matchea la VERSIÓN instalada. **Caso real frecuente**: ESLint 9 eliminó el soporte de \`.eslintrc.*\` y exige flat config (\`eslint.config.js\`). Si \`pnpm install\` trajo ESLint 9 pero generaste un \`.eslintrc.cjs\`, \`lint\` crashea con exit 2 ("couldn't find an eslint.config file"). Arreglalo: migrá a \`eslint.config.js\` (flat config) **o** fijá \`"eslint": "^8.57.0"\` en package.json. El mismo principio aplica a cualquier tool cuya config no matchee su versión instalada.`,
      `- NO cierres el run con un gate en rojo "porque es solo lint/config". Un repo cuyo \`lint\`/\`build\` no corre es un repo roto, y el verifier \`no-errors\` lo marca como fallo.`,
      ``,
      `**Regla de oro**: si vos no podés correr \`lint\`, \`type-check\`, \`build\` y \`test\` y verlos pasar en verde, la historia NO está lista para commitear.`,
      ``,
      `## Reglas importantes`,
      ``,
      `- **NO ESCRIBAS** ningún archivo \`.cenzontle-criteria.json\`, \`.forge-progress.json\` ni similares en el repo. Tu progreso lo emite el worker automáticamente, y el cumplimiento real lo determina un verifier independiente con modelo distinto que evalúa contra el repo real, no contra tu transcript.`,
      `- **NO DUPLIQUES** los criterios de aceptación en archivos del repo (e.g. JSON files, frontmatter, etc.). Los criterios ya viven en el vault como spec de la historia — el verifier los valida desde ahí.`,
      `- **NO IGNORES la sección QA**. Si la sección QA describe un edge case (e.g., "input vacío debe retornar 400"), DEBE existir un test específico que lo cubra. El verifier valida que estos tests existan y pasen — saltarlos hace que la historia caiga a in_review.`,
      `- **NO IGNORES la sección "Contexto del DAG"** (cuando aparece). Las stories listadas allí YA están integradas en la branch base — sus archivos están en tu workdir. Si tu story tiene hard-deps marcadas, DEBES leer los archivos enumerados con \`Read\` antes de implementar — el agente del Forge anterior diseñó contratos que tú debes consumir. Crear módulos paralelos que dupliquen funcionalidad ya implementada cuenta como código inválido y el verifier lo detectará.`,
      `- **NUNCA commitees dependencias ni artefactos de build**: \`node_modules/\`, \`.next/\`, \`dist/\`, \`build/\`, \`out/\`, \`coverage/\`, \`*.tsbuildinfo\`. Si scaffoldeas un proyecto nuevo (ej. \`create-next-app\`), lo PRIMERO que debes hacer es crear/verificar el \`.gitignore\` que los excluya, ANTES de correr \`npm install\`/\`pnpm install\`. Un commit con node_modules rompe el push (el diff es demasiado grande para escanear). El worker tiene una red de seguridad que los excluye, pero no la uses como excusa: mantené el árbol limpio.`,
      ``,
      `Si la historia es ambigua o tienes dudas, toma la decisión más razonable basada en el contexto del repo y procede. **NO PREGUNTES**.`,
    ].join('\n');
  }

  /**
   * Construye la sección "Definition of Done" del prompt a partir del
   * catálogo configurado en `/factory/settings/Definition of Done`.
   *
   * Formato: bullet list. Si el criterio tiene descripción, va indentada
   * debajo como detalle. Si no, solo aparece el `text`. Cada criterio
   * bloquea el merge — el agente debe asegurarse de cumplirlos antes de
   * dejar el run en estado "PR creado".
   *
   * Devuelve string vacío si la lista está vacía — el caller decide si
   * incluir la sección o no.
   */
  private buildDodSection(
    criteria: Array<{ kind: string | null; text: string; description: string }>,
  ): string {
    if (criteria.length === 0) return '';
    const lines: string[] = [
      `## Definition of Done — todos estos criterios bloquean el merge`,
      ``,
      `Antes de cerrar el run, debes asegurarte de cumplir cada uno de los siguientes criterios y reportar evidencia de cumplimiento (ver sección "Reporte OBLIGATORIO de evidencia" abajo). Estos están configurados a nivel de toda la factory por la Alta Gerencia y aplican a TODA historia.`,
      ``,
    ];
    criteria.forEach((c, i) => {
      // Incluimos el `id` para que el agente pueda usarlo literalmente al
      // reportar evidencia en `.cenzontle-criteria.json`. Para custom
      // (kind=null), usamos el text como id — el agente lo reproduce
      // literal incluyendo espacios y mayúsculas.
      const idLabel = c.kind ?? c.text;
      lines.push(`${i + 1}. **${c.text}** (id: \`${idLabel}\`)`);
      // description siempre viene con contenido (NOT NULL en DB +
      // @MinLength(1) en DTO). Indentamos como detalle del bullet.
      const descIndented = c.description
        .trim()
        .split('\n')
        .map((line) => `   ${line}`)
        .join('\n');
      lines.push(descIndented);
    });
    return lines.join('\n');
  }

  /**
   * Construye la sección "Contexto del DAG" del prompt. Lista las stories
   * del mismo epic ya completadas con sus paths concretos, separando
   * **hard-deps** (críticas, marcadas) de **siblings informativos**.
   *
   * Estructura del output:
   *   ## Contexto del DAG — stories ya integradas en la branch
   *
   *   Antes de implementar TU historia, debes leer los archivos producidos
   *   por las stories que ya están integradas en `forge/sprint-batch-XX`.
   *   Sus cambios están materializados en tu workdir actual (vía git clone).
   *
   *   ### Hard dependencies (OBLIGATORIO leer antes de implementar)
   *
   *   1. **{title}** — PR #{n}
   *      Archivos producidos: `path/a.ts`, `path/b.ts`
   *
   *   ### Otras stories del epic ya integradas (contexto)
   *
   *   1. {title} — PR #{n} — 3 archivos
   *      Archivos: `path/c.ts`, `path/d.ts`, `path/e.ts`
   *
   * Si `completedSiblings` está vacío, devuelve `[]` y la sección entera
   * se omite del prompt (no hay predecesores del DAG).
   */
  static buildCompletedSiblingsSection(
    completedSiblings: Array<{
      storyId: string;
      title: string;
      isHardDep: boolean;
      prNumber: number | null;
      filesModified: number | null;
      filesModifiedPaths: string[];
      completedAt: string;
    }>,
  ): string[] {
    if (completedSiblings.length === 0) return [];

    const hardDeps = completedSiblings.filter((s) => s.isHardDep);
    const siblings = completedSiblings.filter((s) => !s.isHardDep);

    const lines: string[] = [
      `## Contexto del DAG — stories ya integradas en la branch`,
      ``,
      `Las siguientes historias del mismo epic YA terminaron y sus commits están mergeados en la integration branch (\`forge/sprint-batch-XX\`). Cuando el worker clonó el repo, los archivos de estas stories quedaron MATERIALIZADOS en tu workdir actual. Eso significa que cuando ejecutes \`ls\` o \`Read\` sobre los paths listados abajo, los archivos EXISTEN.`,
      ``,
      `**ANTES** de implementar TU story, debes leer estos archivos para entender qué contratos, módulos y convenciones ya están establecidos. NO duplicarás trabajo previo ni crearás interfaces paralelas — extenderás o consumirás lo que ya hay.`,
      ``,
    ];

    if (hardDeps.length > 0) {
      lines.push(`### ⚠ Hard dependencies (OBLIGATORIO leer antes de implementar)`);
      lines.push(``);
      lines.push(
        `Tu story declara dependencia HARD sobre estas historias. Tu código probablemente DEBE consumir las APIs/módulos/tipos que ellas crearon. Si las ignoras, vas a:`,
      );
      lines.push(
        `- Duplicar funcionalidad ya implementada (waste).`,
      );
      lines.push(
        `- Crear interfaces incompatibles con el resto del epic (rompes la integración).`,
      );
      lines.push(
        `- Romper tests de integración cuando se mergeen ambas stories.`,
      );
      lines.push(``);
      hardDeps.forEach((s, i) => {
        const prInfo = s.prNumber ? ` — PR #${s.prNumber}` : '';
        lines.push(`${i + 1}. **${s.title}**${prInfo}`);
        if (s.filesModifiedPaths.length > 0) {
          lines.push(
            `   **Archivos producidos (LÉELOS con Read antes de implementar):**`,
          );
          // Cap visual a 15 paths para no inflar el prompt; el resto queda
          // mencionado como "...N more" para que el agente sepa que hay más
          // y pueda explorar con `ls` si lo necesita.
          const visible = s.filesModifiedPaths.slice(0, 15);
          for (const p of visible) {
            lines.push(`   - \`${p}\``);
          }
          if (s.filesModifiedPaths.length > 15) {
            lines.push(
              `   - ...y ${s.filesModifiedPaths.length - 15} más (usa \`ls\` o \`git log --name-only -1\` para descubrirlos)`,
            );
          }
        } else if (s.filesModified !== null && s.filesModified > 0) {
          // Legacy run sin paths persistidos pero con count. Avisamos al
          // agente que el trabajo existe pero debe explorarlo manualmente.
          lines.push(
            `   (${s.filesModified} archivos modificados — paths no disponibles en run legacy; ` +
              `usa \`git log --name-only --oneline\` para descubrirlos en tu workdir)`,
          );
        }
        lines.push(``);
      });
    }

    if (siblings.length > 0) {
      lines.push(`### Otras stories del epic ya integradas (contexto)`);
      lines.push(``);
      lines.push(
        `Estas stories también terminaron en este epic pero NO son hard-deps de la tuya. Aún así, su código está en tu workdir — sé consciente de que existen para evitar duplicar trabajo o asumir un estado vacío:`,
      );
      lines.push(``);
      siblings.forEach((s, i) => {
        const prInfo = s.prNumber ? ` — PR #${s.prNumber}` : '';
        const fileInfo =
          s.filesModifiedPaths.length > 0
            ? ` — ${s.filesModifiedPaths.length} archivo(s): ${s.filesModifiedPaths.slice(0, 5).map((p) => `\`${p}\``).join(', ')}${s.filesModifiedPaths.length > 5 ? `, ...+${s.filesModifiedPaths.length - 5} más` : ''}`
            : s.filesModified !== null && s.filesModified > 0
              ? ` — ${s.filesModified} archivo(s) modificado(s) (paths no disponibles)`
              : '';
        lines.push(`${i + 1}. ${s.title}${prInfo}${fileInfo}`);
      });
      lines.push(``);
    }

    return lines;
  }
}
