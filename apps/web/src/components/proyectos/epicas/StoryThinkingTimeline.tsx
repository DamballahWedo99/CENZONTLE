'use client';

import { useMemo, useState } from 'react';
import { AgentThinkingDisplay } from '../overview/agent-thinking/AgentThinkingDisplay';
import type {
  EpicGenerationEvent,
  StoryGenerationEvent,
  StoryGenerationPhase,
  StoryAgentRole,
} from '@cenzontle/shared';

/**
 * Timeline multi-agente para la generación de historias.
 *
 * El backend ejecuta 5 sub-agentes:
 *   1. Product Owner (drafting_po) — define vision de negocio
 *   2. Tech Lead    (drafting_technical) — diseña arquitectura (paralelo por historia)
 *   3. QA           (drafting_qa) — estrategia de pruebas (paralelo por historia)
 *   4. DepsAuditor  (auditing_deps) — verifica credenciales/env vars con web_search
 *   5. Story Order  (analyzing_order) — DAG hard/soft entre historias del batch
 *
 * Antes mostrábamos los 3 mezclados en una sola cadena de pensamiento, lo
 * que hacía MUY difícil seguir cuál agente estaba diciendo qué. Ahora cada
 * agente tiene su propia cadena con su propio header (nombre del rol +
 * tiempo + estado), y solo se muestra cuando ya empezó.
 *
 * Cómo asignamos events a cada sub-cadena:
 *  - Events con `role='po'` → cadena PO.
 *  - Events con `role='technical'` → cadena Tech Lead.
 *  - Events con `role='qa'` → cadena QA.
 *  - Events con `role='deps_auditor'` → cadena DepsAuditor.
 *  - Events con `role='story_order'` → cadena StoryOrder.
 *  - Events del orchestrator (researching/proposing) Y eventos sin role
 *    (run_started, run_finished, error, done) se asignan al PO si todavía
 *    no llegó el primer phase_change a 'drafting_technical'; luego al
 *    bucket actual según el último phase_change visto.
 */

interface StoryThinkingTimelineProps {
  events: StoryGenerationEvent[];
  isStreaming: boolean;
  onCancel: () => void;
}

type AgentBucketRole = 'po' | 'technical' | 'qa' | 'deps_auditor' | 'story_order';

interface AgentBucket {
  role: AgentBucketRole;
  label: string;
  events: StoryGenerationEvent[];
}

const ROLE_LABELS: Record<AgentBucketRole, string> = {
  po: 'Product Owner',
  technical: 'Tech Lead',
  qa: 'QA',
  deps_auditor: 'Deps Auditor',
  story_order: 'Story Order Analyzer',
};

/**
 * Texto que reemplaza el genérico "Cadena de pensamiento" en el header
 * de cada cadena cuando el agente terminó. Concreto al rol — comunica
 * al user QUÉ produjo el agente, no solo que "pensó". Para los buckets
 * paralelos (TL/QA), el mismo label aplica a cada sub-historia porque
 * cada worker es un mini-agente del mismo rol.
 */
const FINISHED_LABELS: Record<AgentBucketRole, string> = {
  po: 'Outline de producto emitido',
  technical: 'Diseño técnico generado',
  qa: 'Estrategia de pruebas emitida',
  deps_auditor: 'Auditoría de dependencias completada',
  story_order: 'DAG de orden entre historias emitido',
};

/**
 * Mapea phases del agente de historias al enum del componente compartido
 * `AgentThinkingDisplay`. Cada sub-cadena solo verá phases que aplican a
 * su rol, así que el mapping es lineal: drafting_X → researching/analyzing.
 */
function mapStoryPhaseToEpicPhase(phase: StoryGenerationPhase): 'idle' | 'researching' | 'analyzing' | 'proposing' | 'done' {
  switch (phase) {
    case 'drafting_po':
      return 'researching';
    case 'drafting_technical':
    case 'drafting_qa':
    case 'auditing_deps':
    case 'analyzing_order':
      // DepsAuditor y StoryOrderAnalyzer también son "analizando" desde el
      // POV del display genérico — son agentes especializados que razonan
      // sobre las stories que PO/TL/QA ya redactaron.
      return 'analyzing';
    default:
      return phase;
  }
}

function adaptEvent(event: StoryGenerationEvent): EpicGenerationEvent {
  if (event.type === 'phase_change') {
    return {
      type: 'phase_change',
      phase: mapStoryPhaseToEpicPhase(event.phase),
      label: event.label,
      timestamp: event.timestamp,
    };
  }
  if (event.type === 'proposal_ready') {
    // El AgentThinkingDisplay no renderiza proposal_ready; mapeamos a un
    // dummy 'done' que el switch ignora dentro del processEvents loop.
    return { type: 'done', timestamp: event.timestamp };
  }
  // El resto comparten shape — descartamos el campo `role` opcional que el
  // EpicGenerationEvent no usa.
  const { role: _role, ...rest } = event as typeof event & { role?: unknown };
  return rest as unknown as EpicGenerationEvent;
}

/**
 * Particiona los events globales en 5 buckets por rol. Los events del
 * orchestrator se asignan al bucket activo según el último phase_change
 * visto. Si el primer phase_change todavía no llegó, todo va al PO
 * (que es siempre el primero en arrancar).
 */
function partitionEventsByRole(events: StoryGenerationEvent[]): {
  po: StoryGenerationEvent[];
  technical: StoryGenerationEvent[];
  qa: StoryGenerationEvent[];
  deps_auditor: StoryGenerationEvent[];
  story_order: StoryGenerationEvent[];
} {
  const po: StoryGenerationEvent[] = [];
  const technical: StoryGenerationEvent[] = [];
  const qa: StoryGenerationEvent[] = [];
  const deps_auditor: StoryGenerationEvent[] = [];
  const story_order: StoryGenerationEvent[] = [];

  // Bucket activo: cambia con cada phase_change que tiene un role concreto.
  let active: AgentBucketRole = 'po';

  const isAgentRole = (role: unknown): role is AgentBucketRole =>
    role === 'po' || role === 'technical' || role === 'qa' ||
    role === 'deps_auditor' || role === 'story_order';

  for (const ev of events) {
    // Si el event es phase_change con un role específico, switch bucket
    // ANTES de asignarlo (así el phase_change termina en el bucket nuevo,
    // marcando claramente el "Tech Lead empezando").
    if (ev.type === 'phase_change') {
      const role = (ev as { role?: StoryAgentRole }).role;
      if (isAgentRole(role)) {
        active = role;
      }
      // Para phase_change del orchestrator (researching/proposing), no
      // cambiamos active — sigue en el bucket actual.
    }

    // Asignar al bucket activo. Events con role propio respetan su rol
    // (si dice 'qa' va a qa aunque active=po momentáneamente — robustez
    // ante reordering del backend).
    const evRole = (ev as { role?: StoryAgentRole }).role;
    const target: AgentBucketRole = isAgentRole(evRole) ? evRole : active;

    if (target === 'po') po.push(ev);
    else if (target === 'technical') technical.push(ev);
    else if (target === 'qa') qa.push(ev);
    else if (target === 'deps_auditor') deps_auditor.push(ev);
    else story_order.push(ev);
  }

  return { po, technical, qa, deps_auditor, story_order };
}

function getEventTimestamp(ev: StoryGenerationEvent): number {
  return ev.timestamp ? new Date(ev.timestamp).getTime() : 0;
}

export function StoryThinkingTimeline({ events, isStreaming, onCancel }: StoryThinkingTimelineProps) {
  // Partición memoizada — recalcular solo cuando llegan events nuevos.
  const buckets: AgentBucket[] = useMemo(() => {
    const { po, technical, qa, deps_auditor, story_order } = partitionEventsByRole(events);
    const result: AgentBucket[] = [
      { role: 'po', label: ROLE_LABELS.po, events: po },
      { role: 'technical', label: ROLE_LABELS.technical, events: technical },
      { role: 'qa', label: ROLE_LABELS.qa, events: qa },
    ];
    // El bucket del DepsAuditor solo aparece si efectivamente corrió (web_search
    // estaba habilitado). Sin events no agregamos el bucket — evita un placeholder
    // visual confuso cuando el agente fue skipeado.
    if (deps_auditor.length > 0) {
      result.push({ role: 'deps_auditor', label: ROLE_LABELS.deps_auditor, events: deps_auditor });
    }
    // El StoryOrderAnalyzer corre SIEMPRE (no depende de webSearch), pero igual
    // condicionamos al length>0 para casos de skip por outlines.length<2.
    if (story_order.length > 0) {
      result.push({ role: 'story_order', label: ROLE_LABELS.story_order, events: story_order });
    }
    return result;
  }, [events]);

  // Extraer titles de las historias del batch desde el primer phase_change
  // que los traiga. El backend los emite en `drafting_technical` (y de nuevo
  // en `drafting_qa` por simetría — el primer match gana). El map permite
  // que el `ParallelAgentBucket` etiquete cada sub-cadena con el título real
  // de la historia en lugar de un genérico "Historia N".
  const titlesByIndex = useMemo<Map<number, string>>(() => {
    const map = new Map<number, string>();
    for (const ev of events) {
      if (ev.type !== 'phase_change') continue;
      const outlines = (ev as { outlines?: { storyIndex: number; title: string }[] }).outlines;
      if (!outlines || outlines.length === 0) continue;
      for (const o of outlines) {
        // Primera ocurrencia gana — defensa por si el backend re-emite
        // outlines con titles distintos (no debería, pero ante regresión
        // mejor consistencia que sobreescribir con la última).
        if (!map.has(o.storyIndex)) map.set(o.storyIndex, o.title);
      }
      if (map.size > 0) break;
    }
    return map;
  }, [events]);

  // Determina cuál es el sub-agente "actualmente activo" (el último que tiene
  // events). Solo ese muestra `isStreaming=true`; los anteriores ya
  // terminaron y los posteriores aún no arrancaron.
  //
  // BUG FIX (2026-05-04): cambiamos `bucket.events.length > 0` por
  // `hasSubstantiveEvents` para que ignore phase_change boundary events.
  // Antes el bucket QA "ganaba" desde el inicio del pipeline (porque emito
  // su phase_change al arranque del pipelining TL+QA), aunque ningún worker
  // QA hubiera arrancado. Resultado: bucket TL aparecía como "no-activo"
  // → sus dots se pintaban verdes prematuramente. Ahora QA solo gana cuando
  // tiene events sustantivos (workers reales emitiendo thinking/step_*).
  const hasSubstantiveEvents = (b: AgentBucket): boolean =>
    b.events.some((ev) => ev.type !== 'phase_change');
  const activeRole: AgentBucketRole | null = useMemo(() => {
    if (!isStreaming) return null;
    // El más reciente en empezar es el activo. Buscamos del último al primero.
    for (const role of ['story_order', 'deps_auditor', 'qa', 'technical', 'po'] as const) {
      const bucket = buckets.find((b) => b.role === role);
      if (bucket && hasSubstantiveEvents(bucket)) return role;
    }
    return null;
  }, [buckets, isStreaming]);

  // Calcula la duración REAL de cada sub-agente terminado usando boundaries
  // cross-bucket. El hook `useAgentThinkingState` no puede hacerlo solo
  // porque ve solo los events de su slice (filtrados por rol) — no sabe
  // cuándo empezó el siguiente sub-agente. Aquí sí tenemos visión global:
  //  - End del PO = start del primer event del TL (si TL ya arrancó).
  //  - End del TL = start del primer event del QA (si QA ya arrancó).
  //  - End del QA = timestamp del último event global cuando el run terminó.
  //  - Sub-agente activo: null (deja que el ThinkingHeader use tick live).
  //
  // Sin esto, el hook calcula `lastEvent_X - firstEvent_X` que excluye el
  // tiempo entre el último event con role=X y el handoff real al siguiente
  // sub-agente (procesamiento backend final, parsing del terminal tool, etc.).
  const realDurations = useMemo(() => {
    const result: Record<AgentBucketRole, number | null> = {
      po: null,
      technical: null,
      qa: null,
      deps_auditor: null,
      story_order: null,
    };

    const findFirstTs = (role: AgentBucketRole): number | null => {
      const bucket = buckets.find((b) => b.role === role);
      if (!bucket || bucket.events.length === 0) return null;
      let minTs = Number.POSITIVE_INFINITY;
      for (const ev of bucket.events) {
        const ts = getEventTimestamp(ev);
        if (ts > 0 && ts < minTs) minTs = ts;
      }
      return Number.isFinite(minTs) ? minTs : null;
    };

    const poFirst = findFirstTs('po');
    const tlFirst = findFirstTs('technical');
    const qaFirst = findFirstTs('qa');
    const auditorFirst = findFirstTs('deps_auditor');
    const orderFirst = findFirstTs('story_order');

    const runEndTs = !isStreaming && events.length > 0
      ? getEventTimestamp(events[events.length - 1])
      : null;

    // PO terminó cuando empezó TL.
    if (poFirst !== null) {
      if (tlFirst !== null && tlFirst > poFirst) {
        result.po = tlFirst - poFirst;
      } else if (runEndTs !== null && runEndTs > poFirst && activeRole !== 'po') {
        result.po = runEndTs - poFirst;
      }
    }

    // TL terminó cuando empezó QA.
    if (tlFirst !== null) {
      if (qaFirst !== null && qaFirst > tlFirst) {
        result.technical = qaFirst - tlFirst;
      } else if (runEndTs !== null && runEndTs > tlFirst && activeRole !== 'technical') {
        result.technical = runEndTs - tlFirst;
      }
    }

    // QA terminó cuando empezó DepsAuditor (si hubo) o StoryOrder (si no hubo
    // auditor) o el run terminó.
    if (qaFirst !== null) {
      const next = auditorFirst ?? orderFirst;
      if (next !== null && next > qaFirst) {
        result.qa = next - qaFirst;
      } else if (runEndTs !== null && runEndTs > qaFirst && activeRole !== 'qa') {
        result.qa = runEndTs - qaFirst;
      }
    }

    // DepsAuditor terminó cuando empezó StoryOrder o el run global terminó.
    if (auditorFirst !== null) {
      if (orderFirst !== null && orderFirst > auditorFirst) {
        result.deps_auditor = orderFirst - auditorFirst;
      } else if (runEndTs !== null && runEndTs > auditorFirst && activeRole !== 'deps_auditor') {
        result.deps_auditor = runEndTs - auditorFirst;
      }
    }

    // StoryOrder terminó cuando el run global terminó (es el último).
    if (orderFirst !== null && runEndTs !== null && runEndTs > orderFirst && activeRole !== 'story_order') {
      result.story_order = runEndTs - orderFirst;
    }

    return result;
  }, [buckets, isStreaming, activeRole, events]);

  return (
    <div className="space-y-2">
      {buckets.map((bucket) => {
        if (bucket.events.length === 0) return null;
        const isThisActive = isStreaming && activeRole === bucket.role;
        const overrideDurationMs = realDurations[bucket.role];

        // Detectar si los eventos vienen del modo PARALELO (workers TL/QA
        // que inyectan storyIndex). Si sí, agrupamos por historia y
        // renderizamos N sub-cadenas dentro de un container colapsable.
        // Si no, render legacy de 1 cadena.
        const hasStoryIndex = (bucket.role === 'technical' || bucket.role === 'qa') &&
          bucket.events.some((ev) => typeof (ev as { storyIndex?: number }).storyIndex === 'number');

        if (!hasStoryIndex) {
          // Si el bucket SOLO contiene phase_change boundary events (sin
          // contenido sustantivo del agente), no renderizar — evita el
          // placeholder fantasma "Iniciando agente..." que aparecía en QA
          // mientras los workers todavía estaban en TL. El bucket se
          // materializa cuando llega su primer event con storyIndex (que
          // dispara el render paralelo abajo).
          const hasSubstantive = bucket.events.some((ev) => ev.type !== 'phase_change');
          if (!hasSubstantive) return null;
          const adaptedEvents = bucket.events.map(adaptEvent);
          return (
            <div key={bucket.role} className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80 pl-1">
                {bucket.label}
              </div>
              <AgentThinkingDisplay
                events={adaptedEvents}
                isStreaming={isThisActive}
                onCancel={isThisActive ? onCancel : undefined}
                overrideDurationMs={overrideDurationMs}
                defaultOpen={false}
                finishedLabel={FINISHED_LABELS[bucket.role]}
              />
            </div>
          );
        }

        // Render paralelo: agrupar por storyIndex.
        // Pasamos `isStreaming` global (no `isThisActive`) porque con
        // pipelining TL+QA tanto el bucket TL como el QA pueden estar
        // procesando workers SIMULTÁNEAMENTE — `activeRole` solo identifica
        // uno de los dos. Cada sub-historia decide su propio estado basándose
        // en su `isDone` individual (ver `perStoryState` en ParallelAgentBucket).
        return (
          <ParallelAgentBucket
            key={bucket.role}
            bucket={bucket}
            isStreamingGlobal={isStreaming}
            onCancel={onCancel}
            overrideDurationMs={overrideDurationMs}
            titlesByIndex={titlesByIndex}
          />
        );
      })}
    </div>
  );
}

/**
 * Renderea un bucket de TL/QA cuando hay eventos paralelos (con storyIndex).
 * Estructura visual:
 *   [▼] TECH LEAD — 5 historias (colapse outer)
 *     ├─ Historia 1
 *     │   └─ AgentThinkingDisplay (events de storyIndex=0)
 *     ├─ Historia 2
 *     │   └─ AgentThinkingDisplay (events de storyIndex=1)
 *     ...
 * El usuario puede colapsar TODO el bucket con 1 click en el header outer.
 */
function ParallelAgentBucket({
  bucket,
  isStreamingGlobal,
  onCancel,
  overrideDurationMs,
  titlesByIndex,
}: {
  bucket: AgentBucket;
  /**
   * Estado global del run: si el run completo está streameando, `isStreamingGlobal=true`.
   * Reemplaza el `isThisActive` previo, que se basaba en `activeRole === bucket.role`.
   * Razón: con pipelining TL→QA por historia, ambos buckets pueden tener
   * workers procesando AL MISMO TIEMPO (TL[3,4] todavía corriendo + QA[0,1]
   * ya arrancado por sus workers que terminaron TL). `activeRole` (single value)
   * no captura eso. La fuente de verdad per-historia es el `state.isDone`
   * derivado de su step_done terminal — cada sub-cadena decide su propio
   * estado, NO el bucket completo.
   */
  isStreamingGlobal: boolean;
  onCancel?: () => void;
  overrideDurationMs: number | null;
  /**
   * Map de `storyIndex → title` derivado del phase_change que arranca la
   * fase paralela. Permite etiquetar cada sub-cadena con el título real de
   * la historia (ej. "Historia 1 — Endpoint de búsqueda de vuelos") en
   * lugar del genérico "Historia 1". Si el map está vacío (caso legacy:
   * backend no emitió outlines en el phase_change), fallback a "Historia N".
   */
  titlesByIndex: Map<number, string>;
}) {
  // Outer del bucket paralelo: empieza COLAPSADO. El user expande si quiere
  // ver las sub-cadenas por historia (mismo principio que las cadenas internas
  // — defecto colapsado, control 100% del usuario).
  const [collapsed, setCollapsed] = useState<boolean>(true);

  // Agrupar eventos por storyIndex. Eventos sin storyIndex se dividen en:
  //  - boundary: phase_change emitido por el orchestrator al entrar al bucket
  //    (ej. role='technical' phase='drafting_technical'). Es un marker de
  //    transición que el header outer ya representa con su label — renderizarlo
  //    como sub-cadena propia produce un bucket "Iniciando agente..." vacío
  //    sin valor informativo.
  //  - substantive: cualquier otro evento sin storyIndex (errores del
  //    orchestrator, run_finished mal-clasificado, etc). Estos sí merecen
  //    visualización porque pueden contener info útil para diagnóstico.
  const grouped = useMemo(() => {
    const byStory = new Map<number, StoryGenerationEvent[]>();
    const substantiveUngrouped: StoryGenerationEvent[] = [];
    for (const ev of bucket.events) {
      const idx = (ev as { storyIndex?: number }).storyIndex;
      if (typeof idx === 'number') {
        if (!byStory.has(idx)) byStory.set(idx, []);
        byStory.get(idx)!.push(ev);
        continue;
      }
      // Sin storyIndex: filtrar boundary markers que el header ya cubre.
      if (ev.type === 'phase_change') continue;
      substantiveUngrouped.push(ev);
    }
    const sortedIndices = Array.from(byStory.keys()).sort((a, b) => a - b);
    return { byStory, ungrouped: substantiveUngrouped, sortedIndices };
  }, [bucket.events]);

  const totalStories = grouped.sortedIndices.length;
  // Conteo de historias terminadas — derivado de `perStoryState` (calculado
  // abajo con el lookup del terminal step_done). Útil para el header outer
  // cuando el bucket está activo: "TECH LEAD — 1/3 historias listas".

  // Estado por historia: cada worker paralelo tiene su propio ciclo de vida
  // (start → terminal-tool → done). Antes pasábamos `isStreaming={isThisActive}`
  // a TODAS las sub-cadenas, lo que mantenía animado el spinner aunque la
  // historia ya hubiese terminado — solo se "apagaban" cuando TODOS los
  // workers del batch terminaban.
  //
  // Heurística de detección: el último `step_done` con `tool` que empiece
  // con `submit_` indica que el agent loop llamó al terminal tool y emitió
  // su resultado (ver `terminalToolName` en story-generation.service.ts —
  // los 5 agentes usan prefijo `submit_*`). Después de ese step_done, el
  // worker no emite nada más para ese storyIndex.
  //
  // Si encontramos ese step_done, calculamos también la duración real:
  // `firstEventTs` (start) → `step_done.timestamp` (end). Cuando el bucket
  // entero está cerrado pero el storyIndex no tiene terminal step_done
  // (caso raro: el agente fue cancelado o falló), retornamos `done=false`
  // y dejamos que el componente use su lógica default.
  const perStoryState = useMemo(() => {
    const result = new Map<number, { isDone: boolean; durationMs: number | null }>();
    for (const storyIdx of grouped.sortedIndices) {
      const evs = grouped.byStory.get(storyIdx) ?? [];
      let terminalEv: StoryGenerationEvent | undefined;
      // Recorremos al revés porque el terminal step_done está cerca del final.
      for (let i = evs.length - 1; i >= 0; i--) {
        const ev = evs[i];
        if (ev.type === 'step_done') {
          const tool = (ev as { tool?: string }).tool;
          if (tool && tool.startsWith('submit_')) {
            terminalEv = ev;
            break;
          }
        }
      }
      if (!terminalEv) {
        result.set(storyIdx, { isDone: false, durationMs: null });
        continue;
      }
      const startTs = evs[0]?.timestamp ? new Date(evs[0].timestamp).getTime() : 0;
      const endTs = terminalEv.timestamp ? new Date(terminalEv.timestamp).getTime() : 0;
      const durationMs = startTs > 0 && endTs > startTs ? endTs - startTs : null;
      result.set(storyIdx, { isDone: true, durationMs });
    }
    return result;
  }, [grouped.byStory, grouped.sortedIndices]);

  return (
    <div className="space-y-1">
      {/* Header outer: clickeable para colapsar TODO el bucket */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80 pl-1 py-1 hover:text-foreground transition-colors"
        aria-expanded={!collapsed}
      >
        <span className="text-muted-foreground/60">{collapsed ? '▶' : '▼'}</span>
        <span>{bucket.label}</span>
        <span className="text-muted-foreground/50 normal-case font-normal">
          {(() => {
            const doneCount = Array.from(perStoryState.values()).filter((s) => s.isDone).length;
            // Total esperado del batch: `titlesByIndex.size` (size del map de
            // outlines emitido por el backend en el phase_change). Esto cubre
            // el edge case del pipelining QA donde las sub-historias arrancan
            // ESCALONADAMENTE — antes el total era `grouped.sortedIndices.length`
            // que solo contaba las que YA habían arrancado QA, así el header
            // mostraba "0/2" mientras QA[2,3,4] estaban esperando su TL.
            // Si el backend no emitió outlines (caso legacy), fallback al
            // count actual visible.
            const expectedTotal = Math.max(titlesByIndex.size, totalStories);
            // "Activo" = al menos una historia aún no terminó Y el run está
            // streameando. Reemplaza el `isThisActive` previo basado en
            // `activeRole === bucket.role`, que con pipelining TL+QA no
            // capturaba que ambos buckets pueden estar activos a la vez.
            const isAnyStoryActive = isStreamingGlobal && doneCount < expectedTotal;
            if (isAnyStoryActive) {
              return `— ${doneCount}/${expectedTotal} historias listas`;
            }
            return `— ${expectedTotal} ${expectedTotal === 1 ? 'historia' : 'historias'}`;
          })()}
        </span>
      </button>

      {/* Sub-cadenas: una por historia. Colapsa con el outer. */}
      {!collapsed && (
        <div className="space-y-2 pl-3 border-l-2 border-border/40">
          {grouped.sortedIndices.map((storyIdx) => {
            const evs = grouped.byStory.get(storyIdx) ?? [];
            const adapted = evs.map(adaptEvent);
            // Estado per-historia (calculado en `perStoryState` arriba).
            // Si la historia ya terminó (terminal step_done emitido),
            // `isStreaming=false` para esa sub-cadena aunque el bucket
            // completo siga activo procesando OTRAS historias.
            //
            // BUG FIX (2026-05-04): antes era `isThisActive && !state.isDone`.
            // Con pipelining TL+QA, `isThisActive` (derivado de activeRole)
            // se volvía false para el bucket TL apenas QA ganaba foco —
            // resultado: TODOS los workers TL se pintaban verde aunque
            // siguieran corriendo. La fuente de verdad per-historia es solo
            // SU `isDone`, no qué bucket "el orchestrator considera activo".
            const state = perStoryState.get(storyIdx) ?? { isDone: false, durationMs: null };
            const storyIsStreaming = isStreamingGlobal && !state.isDone;
            const title = titlesByIndex.get(storyIdx);
            return (
              <div key={storyIdx} className="space-y-1">
                <div className="text-[10px] font-medium text-muted-foreground/70 pl-1 flex items-baseline gap-1.5 flex-wrap">
                  <span>Historia {storyIdx + 1}</span>
                  {title && (
                    <>
                      <span className="text-muted-foreground/40">—</span>
                      <span className="text-foreground/80 normal-case">{title}</span>
                    </>
                  )}
                </div>
                <AgentThinkingDisplay
                  events={adapted}
                  isStreaming={storyIsStreaming}
                  onCancel={undefined}
                  overrideDurationMs={state.durationMs}
                  defaultOpen={false}
                  finishedLabel={FINISHED_LABELS[bucket.role]}
                />
              </div>
            );
          })}
          {/* Eventos sin storyIndex y NO boundary (errores u otros raros).
              Se muestran SOLO si quedan eventos sustantivos — los phase_change
              ya se filtraron arriba. Diseño: tono más tenue + label explícito
              ("Otros") para distinguirlo de las sub-cadenas por historia. */}
          {grouped.ungrouped.length > 0 && (() => {
            // Mismo principio: el bucket está activo si hay alguna sub-historia
            // aún corriendo Y el run está streameando.
            const anyActive = isStreamingGlobal && Array.from(perStoryState.values()).some((s) => !s.isDone);
            return (
              <div className="space-y-1 mt-2">
                <div className="text-[10px] font-medium text-muted-foreground/50 pl-1 italic">
                  Otros eventos del agente
                </div>
                <AgentThinkingDisplay
                  events={grouped.ungrouped.map(adaptEvent)}
                  isStreaming={anyActive}
                  onCancel={anyActive ? onCancel : undefined}
                  overrideDurationMs={overrideDurationMs}
                  defaultOpen={false}
                  finishedLabel={FINISHED_LABELS[bucket.role]}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
