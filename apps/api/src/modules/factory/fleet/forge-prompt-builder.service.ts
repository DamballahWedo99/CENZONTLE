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
    storyTitle: string;
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
  }): string {
    const { epicTitle, epicMarkdown, storyTitle, dodCriteria } = input;
    const dodSection = this.buildDodSection(dodCriteria);
    return [
      `# Tarea autónoma de CENZONTLE Forge`,
      ``,
      `## Épica: ${epicTitle}`,
      ``,
      epicMarkdown,
      ``,
      `## Historia a implementar:`,
      ``,
      `**${storyTitle}**`,
      ``,
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
      `2. Implementa la historia: crea/edita archivos con Edit y Write directamente.`,
      `3. Corre los tests del repo. Si fallan, arréglalos antes de terminar.`,
      `4. Haz \`git add\` y \`git commit\` con un mensaje claro siguiendo las convenciones del repo.`,
      `5. Termina (el worker hará push y abrirá el PR automáticamente).`,
      ``,
      `## Reporte opcional de criterios (para visibility en UI)`,
      ``,
      `Si quieres que la UI del Forge muestre tu progreso paso a paso ante el operador,`,
      `puedes ESCRIBIR un archivo \`.cenzontle-criteria.json\` en el root del workdir con un`,
      `array de objetos \`{ id, label, completed }\`. El worker lo lee periódicamente y lo`,
      `manda al backend para timeline visual.`,
      ``,
      `**IMPORTANTE**: este self-report es SOLO para visibility — NO decide si el run pasa.`,
      `El cumplimiento real del DoD lo determina un sistema de verificación independiente`,
      `(deterministic checks ejecutados por el worker + verifier agent con modelo distinto)`,
      `que valida outcomes contra el estado real del repo, no contra tu transcript.`,
      ``,
      `Ejemplo:`,
      `\`\`\`json`,
      `[`,
      `  { "id": "stack-detected", "label": "Detecté que es Next.js 14", "completed": true },`,
      `  { "id": "feature-implemented", "label": "Feature de la historia implementado", "completed": true }`,
      `]`,
      `\`\`\``,
      ``,
      `Reglas:`,
      `- Es OPCIONAL — no afecta el pass/fail del run.`,
      `- Cada vez que avances, REESCRIBE el archivo entero.`,
      `- Mantén entre 3 y 8 criterios — más es ruido.`,
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
}
