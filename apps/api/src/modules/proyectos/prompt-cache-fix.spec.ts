/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests para el fix anti-cache-thrashing del prompt cache de
 * Anthropic (Fase 1 de optimización de costos — 2026-05-04).
 *
 * Contexto del fix:
 *   El `contextBlock` (epic/initiative + repos + designs) viajaba en
 *   `messages[0]` (uncached). Cada iter del agent loop re-pagaba ese
 *   contenido como `input_no_cache`. Métrica observada en producción:
 *   ratio cache_write_5m / cache_read_5m invertido 5:1 → ~$5.45/día solo
 *   en cache write thrashing.
 *
 *   Fix: mover el contextBlock al `system` array con `cache_control:
 *   ephemeral`. Anthropic permite hasta 4 breakpoints; ahora usamos 2
 *   (system[0]=systemPrompt estable, system[1]=contextBlock cacheable).
 *
 * Estrategia de validación:
 *   - **Source-level regex tests** sobre el código fuente de los servicios
 *     afectados. Valida que los patrones críticos del fix sigan presentes.
 *   - NO requiere instanciar el servicio, mockear Anthropic, ni llamadas
 *     reales. 100% reproducible, $0 costo, ejecuta en milisegundos.
 *   - Atrapa cualquier refactor (intencional o accidental) que rompa el
 *     patrón — el test es el canario que detecta el costo subiendo.
 *
 * Cuándo fallarán estos tests:
 *   - Alguien mueve `contextBlock` de vuelta a `messages[0]`.
 *   - Alguien quita un `cache_control` breakpoint del system array.
 *   - Alguien actualiza el systemPrompt y vuelve a decir "primer mensaje".
 *   - Alguien quita el kickoff message y deja `messages[0]` con contextBlock.
 *
 * Si la API de Anthropic cambia su shape de cache_control en una versión
 * futura del SDK, estos tests también pueden fallar — actualizar las regex
 * con cuidado, NO simplemente flexibilizar los matchers.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Cargamos el código fuente de los 2 servicios afectados por el fix.
const DIAGRAM_SERVICE = readFileSync(
  join(__dirname, 'diagrams/generation/diagram-generation.service.ts'),
  'utf-8',
);

const EPIC_SERVICE = readFileSync(
  join(__dirname, 'epics/generation/epic-generation.service.ts'),
  'utf-8',
);

const STORY_SERVICE = readFileSync(
  join(__dirname, 'stories/generation/story-generation.service.ts'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Helpers de matching — encapsulan los patrones críticos del fix para
// reutilizar en múltiples assertions sin duplicar regex frágiles.
// ---------------------------------------------------------------------------

/**
 * Regex que matchea un bloque `system` array de 2 elementos donde:
 *   - system[0] = systemPrompt + cache_control: ephemeral (con o sin ttl)
 *   - system[1] = contextBlock + cache_control: ephemeral (con o sin ttl)
 *
 * Acepta whitespace flexible, comentarios entre líneas, y opcionalmente el
 * field `ttl: '1h'` (TTL extendido — habilitado 2026-05-04).
 */
const TWO_CACHE_BREAKPOINTS_PATTERN =
  /system:\s*\[\s*(?:\/\/[^\n]*\n\s*)*\{\s*type:\s*'text',\s*text:\s*systemPrompt,\s*cache_control:\s*\{\s*type:\s*'ephemeral'(?:,\s*ttl:\s*'(?:5m|1h)')?\s*\}\s*\},\s*(?:\/\/[^\n]*\n\s*)*\{\s*type:\s*'text',\s*text:\s*contextBlock,\s*cache_control:\s*\{\s*type:\s*'ephemeral'(?:,\s*ttl:\s*'(?:5m|1h)')?\s*\}\s*\},?\s*\]/;

/**
 * Regex que matchea un kickoff message en `messages[0]` que MENCIONA
 * explícitamente que el contexto está en el system prompt. El reforzamiento
 * explícito del contrato evita que un futuro refactor mueva el contextBlock
 * silenciosamente y el agente quede sin contexto.
 *
 * Tolera whitespace, comentarios, y propiedades intermedias entre la
 * declaración del array y el primer `content` (los servicios reales tienen
 * comentarios extensos del fix entre la firma y el primer elemento).
 *
 * Acepta los 2 shapes válidos para el tipo del array:
 *   - `Anthropic.Messages.MessageParam[]` (namespace standard — layout pass,
 *     epic-generation)
 *   - `Anthropic.Beta.BetaMessageParam[]` (namespace beta — story-generation
 *     y diagram-generation tras la migración del advisor 2026-05-04)
 */
const KICKOFF_MESSAGE_PATTERN =
  /messages:\s*Anthropic\.(?:Messages\.MessageParam|Beta\.BetaMessageParam)\[\]\s*=\s*\[[\s\S]{0,500}role:\s*'user',\s*content:\s*'[^']*system prompt[^']*'/;

/**
 * Regex que detecta la regresión: contextBlock viajando en messages[0]
 * en vez del system. Si esto matchea, el fix se rompió. Acepta los 2 shapes
 * de tipo (standard y beta).
 */
const CONTEXT_BLOCK_IN_MESSAGES_REGRESSION =
  /messages:\s*Anthropic\.(?:Messages\.MessageParam|Beta\.BetaMessageParam)\[\]\s*=\s*\[\s*\{\s*role:\s*'user',\s*content:\s*contextBlock\s*\}/;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Prompt cache anti-thrashing fix — source-level regression', () => {
  // =========================================================================
  // diagram-generation.service.ts — tiene 3 sitios:
  //   - Agente principal de diagrama (línea ~840)
  //   - Agente de integration doc (línea ~1640)
  //   - Layout pass (línea ~3829) — INTENCIONALMENTE no afectado por fix
  // =========================================================================

  describe('diagram-generation.service.ts', () => {
    describe('agente principal de diagrama', () => {
      it('system array tiene exactamente 2 cache_control breakpoints (systemPrompt + contextBlock)', () => {
        // El test busca AL MENOS UNA ocurrencia del patrón — el archivo tiene
        // múltiples (main + integration doc) y todos deben cumplirlo.
        expect(DIAGRAM_SERVICE).toMatch(TWO_CACHE_BREAKPOINTS_PATTERN);
      });

      it('NO contiene el anti-patrón de contextBlock en messages[0] (regresión guard)', () => {
        // Si este test falla, alguien revirtió el fix.
        expect(DIAGRAM_SERVICE).not.toMatch(CONTEXT_BLOCK_IN_MESSAGES_REGRESSION);
      });

      it('messages[0] usa kickoff explícito que menciona "system prompt"', () => {
        expect(DIAGRAM_SERVICE).toMatch(KICKOFF_MESSAGE_PATTERN);
      });

      it('logging captura cache_read_input_tokens y cache_creation_input_tokens', () => {
        expect(DIAGRAM_SERVICE).toMatch(/cache_read_input_tokens/);
        expect(DIAGRAM_SERVICE).toMatch(/cache_creation_input_tokens/);
      });
    });

    describe('agente de integration doc (segundo sitio del mismo servicio)', () => {
      it('contiene 2 ocurrencias del patrón "system array con 2 breakpoints" (main + integration doc)', () => {
        // Cuenta ocurrencias del patrón. Si el integration doc agent regresa
        // a 1 breakpoint, este test detecta la regresión. Acepta opcional
        // `, ttl: '5m'|'1h'` (TTL extendido habilitado 2026-05-04).
        const matches = DIAGRAM_SERVICE.match(
          /system:\s*\[\s*(?:\/\/[^\n]*\n\s*)*\{\s*type:\s*'text',\s*text:\s*systemPrompt,\s*cache_control:\s*\{\s*type:\s*'ephemeral'(?:,\s*ttl:\s*'(?:5m|1h)')?\s*\}\s*\},\s*(?:\/\/[^\n]*\n\s*)*\{\s*type:\s*'text',\s*text:\s*contextBlock,\s*cache_control/g,
        );
        expect(matches).not.toBeNull();
        expect(matches?.length).toBeGreaterThanOrEqual(2);
      });

      it('contiene 2 ocurrencias de kickoff messages explícitos (uno por agente)', () => {
        const matches = DIAGRAM_SERVICE.match(
          /content:\s*'[^']*system prompt[^']*'/g,
        );
        expect(matches).not.toBeNull();
        // El agente principal y el integration doc agent — al menos 2.
        expect(matches?.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('layout pass agent (intencionalmente no afectado por el fix)', () => {
      it('preserva el patrón legacy `system: systemPrompt` (string plano, sin array)', () => {
        // Layout pass es single-shot, no se beneficia del cache, y usa
        // messages.create() en lugar de stream(). Si el fix lo afectó por
        // accidente, este test lo detecta.
        expect(DIAGRAM_SERVICE).toMatch(/system:\s*systemPrompt,\s*\n[^\n]*\/\/[^\n]*tool_choice/);
      });

      it('usa messages.create() (no stream) — single-turn agent', () => {
        // Validación cruzada: el layout pass agent es el ÚNICO que usa create()
        // en este archivo. Confirma que el fix no lo migró accidentalmente.
        expect(DIAGRAM_SERVICE).toMatch(/client\.messages\.create\(/);
      });
    });

    describe('coherencia de systemPrompts con el nuevo shape', () => {
      it('systemPrompts NO mencionan "primer mensaje" (referencia obsoleta)', () => {
        // Antes del fix, el contextBlock vivía en messages[0]. Los
        // systemPrompts decían "el contexto está en el primer mensaje".
        // Después del fix, esa instrucción es una mentira que confunde al
        // modelo. Este test asegura que la prosa esté sincronizada con la
        // estructura real.
        //
        // NOTA: solo valida que NO aparezca en contextos de instrucciones
        // del agente — no busca todas las apariciones del string en el
        // archivo (los comentarios de código pueden referenciar la historia
        // del fix legítimamente).
        expect(DIAGRAM_SERVICE).not.toMatch(
          /\*\*Lee la épica y su iniciativa\*\*[^.]*primer mensaje/,
        );
      });

      it('systemPrompts mencionan "system prompt" como ubicación del contexto', () => {
        expect(DIAGRAM_SERVICE).toMatch(
          /\*\*Lee la épica y su iniciativa\*\*[^.]*system prompt/,
        );
      });
    });
  });

  // =========================================================================
  // epic-generation.service.ts — 1 sitio único (agente de generación de épicas)
  // =========================================================================

  describe('epic-generation.service.ts', () => {
    it('system array tiene 2 cache_control breakpoints (systemPrompt + contextBlock)', () => {
      expect(EPIC_SERVICE).toMatch(TWO_CACHE_BREAKPOINTS_PATTERN);
    });

    it('NO contiene el anti-patrón de contextBlock en messages[0] (regresión guard)', () => {
      expect(EPIC_SERVICE).not.toMatch(CONTEXT_BLOCK_IN_MESSAGES_REGRESSION);
    });

    it('messages[0] usa kickoff explícito que menciona "system prompt"', () => {
      expect(EPIC_SERVICE).toMatch(KICKOFF_MESSAGE_PATTERN);
    });

    it('logging captura cache_read_input_tokens y cache_creation_input_tokens', () => {
      expect(EPIC_SERVICE).toMatch(/cache_read_input_tokens/);
      expect(EPIC_SERVICE).toMatch(/cache_creation_input_tokens/);
    });

    it('usa messages.stream() (no create) — multi-turn agent loop', () => {
      expect(EPIC_SERVICE).toMatch(/client\.messages\.stream\(/);
    });
  });

  // =========================================================================
  // Cross-service invariants — propiedades que deben cumplirse en ambos
  // =========================================================================

  describe('invariantes cross-service', () => {
    it('ambos servicios usan cache_control con type "ephemeral" (no persistent ni nada exótico)', () => {
      // Ephemeral es el único tipo soportado actualmente. El ttl puede ser
      // '5m' (default) o '1h' (extendido vía beta). Si alguien agregó un
      // `type: 'persistent'` sin coordinación, este test lo detecta.
      const ephemeralPattern = /cache_control:\s*\{\s*type:\s*'ephemeral'(?:,\s*ttl:\s*'(?:5m|1h)')?\s*\}/g;
      const diagramEphemeralCount = (DIAGRAM_SERVICE.match(ephemeralPattern) ?? []).length;
      const epicEphemeralCount = (EPIC_SERVICE.match(ephemeralPattern) ?? []).length;

      // Diagram: 4 (main: system+context, integration doc: system+context).
      // Epic: 2 (main: system+context).
      expect(diagramEphemeralCount).toBeGreaterThanOrEqual(4);
      expect(epicEphemeralCount).toBeGreaterThanOrEqual(2);
    });

    it('ningún servicio tiene cache_control con type distinto de "ephemeral"', () => {
      // Detecta cualquier type alternativo que se haya colado.
      const diagramAlternateTypes = DIAGRAM_SERVICE.match(
        /cache_control:\s*\{\s*type:\s*'(?!ephemeral)[^']*'/g,
      );
      const epicAlternateTypes = EPIC_SERVICE.match(
        /cache_control:\s*\{\s*type:\s*'(?!ephemeral)[^']*'/g,
      );
      expect(diagramAlternateTypes).toBeNull();
      expect(epicAlternateTypes).toBeNull();
    });

    it('ambos servicios documentan el rationale del fix con un comentario', () => {
      // Asegura que el WHY del fix esté presente en el código — si alguien lo
      // borra, el test falla y obliga a reflexionar antes de quitar el contexto.
      //
      // El comentario está partido en múltiples líneas (`// El contextBlock`
      // sigue con `// viaja\n// en el \`system\``). La regex permite cualquier
      // separador entre las palabras clave para tolerar la indentación natural
      // de comentarios multi-línea.
      const rationaleSignature = /El `contextBlock`[\s\S]{0,500}viaja[\s\S]{0,500}cache_control:\s*ephemeral/;
      expect(DIAGRAM_SERVICE).toMatch(rationaleSignature);
      expect(EPIC_SERVICE).toMatch(rationaleSignature);
    });

    it('ambos servicios mantienen la guard "kickoff explícito" para detectar refactors silenciosos', () => {
      // El kickoff message debe mencionar dónde está el contexto. Esto crea
      // un fail-loud: si alguien mueve el contextBlock fuera del system pero
      // olvida actualizar el kickoff, el agente recibirá una instrucción
      // inconsistente y producirá output degradado de manera VISIBLE (no
      // silencioso).
      expect(DIAGRAM_SERVICE).toMatch(
        /MENCIONA explícitamente la ubicación del contexto/,
      );
      expect(EPIC_SERVICE).toMatch(
        /MENCIONA explícitamente la ubicación del contexto/,
      );
    });
  });

  // =========================================================================
  // Logs de diagnóstico — agregados para hacer el smoke test trivialmente
  // legible. Si alguien borra estos logs, el smoke test se vuelve doloroso
  // (toca leer cada iter). Estos tests aseguran que las 3 piezas críticas
  // de telemetría sigan presentes:
  //
  //   1. Log inicial con tamaño del contextBlock (detecta edge case de
  //      bloques < 1024 tokens donde Anthropic ignora cache_control silencioso)
  //   2. Warning explícito si cache_create > 0 en iter > 0 (detecta
  //      regresión silenciosa mid-loop)
  //   3. Resumen final con ratio cache_read:cache_create
  // =========================================================================

  describe('telemetría de diagnóstico para smoke test', () => {
    it('diagram-generation tiene los 3 patrones de log en cada uno de los 2 sitios (main + integration doc)', () => {
      // Cada uno de los 2 agentes (DiagramAgent y DiagramDoc) debe tener:
      //   - "▶ loop start" — systemPrompt + contextBlock sizes (ambos breakpoints)
      //   - "POSIBLE REGRESIÓN" — warning calibrado por ratio create/read
      //   - "▣ run summary" — totales del run

      // 2 sitios × 1 patrón "loop start" cada uno = al menos 2.
      const loopStarts = DIAGRAM_SERVICE.match(/▶ loop start: systemPrompt=\$\{systemPromptChars\}/g);
      expect(loopStarts).not.toBeNull();
      expect(loopStarts!.length).toBeGreaterThanOrEqual(2);

      // 2 sitios × 1 warning cada uno = al menos 2.
      const regressionWarnings = DIAGRAM_SERVICE.match(
        /POSIBLE REGRESIÓN at iter \$\{iteration\}/g,
      );
      expect(regressionWarnings).not.toBeNull();
      expect(regressionWarnings!.length).toBeGreaterThanOrEqual(2);

      // 2 sitios × 1 summary cada uno = al menos 2.
      const summaries = DIAGRAM_SERVICE.match(/▣ run summary:/g);
      expect(summaries).not.toBeNull();
      expect(summaries!.length).toBeGreaterThanOrEqual(2);
    });

    it('epic-generation tiene los 3 patrones de log en su único sitio', () => {
      expect(EPIC_SERVICE).toMatch(/▶ loop start: systemPrompt=\$\{systemPromptChars\}/);
      expect(EPIC_SERVICE).toMatch(/POSIBLE REGRESIÓN at iter \$\{iteration\}/);
      expect(EPIC_SERVICE).toMatch(/▣ run summary:/);
    });

    it('warning de regresión usa heurística por ratio (create > read * 0.5) — evita false positives', () => {
      // Calibración (2026-05-04): el guard original `cache_create > 0` era
      // false positive — Anthropic emite cache_create > 0 normal en iter > 0
      // por crecimiento del messages array (~700 tokens). La heurística real
      // es comparar ratio create/read.
      //
      // El test asegura que la calibración no se revierta a `> 0` por accidente.
      const ratioGuardPattern = /cacheRatio\s*>\s*0\.5/g;
      const diagramGuards = DIAGRAM_SERVICE.match(ratioGuardPattern);
      const epicGuards = EPIC_SERVICE.match(ratioGuardPattern);

      expect(diagramGuards).not.toBeNull();
      expect(diagramGuards!.length).toBeGreaterThanOrEqual(2); // 2 sitios en diagram
      expect(epicGuards).not.toBeNull();
      expect(epicGuards!.length).toBeGreaterThanOrEqual(1); // 1 sitio en epic
    });

    it('cálculo de cacheRatio maneja división por cero (cache_read=0)', () => {
      // Si cache_read=0 y cache_create>0 → ratio=Infinity (regresión total).
      // Si cache_read=0 y cache_create=0 → ratio=0 (no fired).
      // El operador ternario debe estar presente en los 3 sitios.
      const safeRatioPattern =
        /cacheRead\s*>\s*0\s*\?\s*cacheCreate\s*\/\s*cacheRead\s*:\s*\(cacheCreate\s*>\s*0\s*\?\s*Infinity\s*:\s*0\)/g;
      const diagramSafeRatios = DIAGRAM_SERVICE.match(safeRatioPattern);
      const epicSafeRatios = EPIC_SERVICE.match(safeRatioPattern);

      expect(diagramSafeRatios).not.toBeNull();
      expect(diagramSafeRatios!.length).toBeGreaterThanOrEqual(2);
      expect(epicSafeRatios).not.toBeNull();
      expect(epicSafeRatios!.length).toBeGreaterThanOrEqual(1);
    });

    it('resumen final calcula ratio_read_to_write con guard de división por cero', () => {
      // El cálculo del ratio DEBE manejar `totalCacheCreate === 0` (run muy
      // corto que nunca activó cache). Sin la guard, divide por cero y emite
      // "Infinity" o "NaN" en el log — ambos confunden el smoke test.
      const ratioPattern =
        /totalCacheCreate\s*>\s*0\s*\?\s*\(totalCacheRead\s*\/\s*totalCacheCreate\)\.toFixed\(1\)\s*:\s*'∞'/g;
      const diagramRatios = DIAGRAM_SERVICE.match(ratioPattern);
      const epicRatios = EPIC_SERVICE.match(ratioPattern);

      expect(diagramRatios).not.toBeNull();
      expect(diagramRatios!.length).toBeGreaterThanOrEqual(2);
      expect(epicRatios).not.toBeNull();
      expect(epicRatios!.length).toBeGreaterThanOrEqual(1);
    });

    it('story-generation tiene los 3 patrones de log en runAgentLoop (compartido por PO/TL/QA)', () => {
      // story-generation usa una sola función `runAgentLoop` para los 3
      // agentes — un solo cambio cubre PO, TL y QA. Por eso esperamos UN
      // patrón de cada tipo (no 3).
      expect(STORY_SERVICE).toMatch(/▶ loop start:[\s\S]{0,500}commonContext=\$\{commonContextChars\}/);
      expect(STORY_SERVICE).toMatch(/POSIBLE REGRESIÓN at iter \$\{iteration\}/);
      expect(STORY_SERVICE).toMatch(/▣ run summary:/);
    });

    it('story-generation usa heurística por ratio (create > read * 0.5)', () => {
      // Mismo patrón que diagram/epic — calibración consistente.
      expect(STORY_SERVICE).toMatch(/cacheRatio\s*>\s*0\.5/);
    });

    it('story-generation cálculo de cacheRatio maneja división por cero', () => {
      const safeRatioPattern =
        /cacheRead\s*>\s*0\s*\?\s*cacheCreate\s*\/\s*cacheRead\s*:\s*\(cacheCreate\s*>\s*0\s*\?\s*Infinity\s*:\s*0\)/;
      expect(STORY_SERVICE).toMatch(safeRatioPattern);
    });

    it('story-generation acumuladores en outer scope sobreviven el for loop', () => {
      // En story-generation el loop está en runAgentLoop. Los acumuladores
      // van DENTRO de la función pero FUERA del for. Verificamos que estén
      // declarados antes del for con `for (let iteration`. Rango {0,1500}
      // tolera los acumuladores de advisor (totalAdvisor*) agregados en
      // Fase 2 (2026-05-04).
      expect(STORY_SERVICE).toMatch(
        /let totalInputTokens = 0;\s*\n\s*let totalOutputTokens = 0;\s*\n\s*let totalCacheRead = 0;\s*\n\s*let totalCacheCreate = 0;\s*\n[\s\S]{0,1500}for\s*\(let iteration/,
      );
    });

    it('story-generation log inicial mide commonContextBlock + roleSystemPrompt (los 2 breakpoints reales)', () => {
      // En story-generation los 2 breakpoints son distintos: commonContextBlock
      // (system[0]) y roleSystemPrompt (system[1]). El log debe medir AMBOS.
      expect(STORY_SERVICE).toMatch(/commonContextChars >= 4096/);
      expect(STORY_SERVICE).toMatch(/roleSystemChars >= 4096/);
    });
  });

  // =========================================================================
  // TTL extendido (1 hora) — habilitado 2026-05-04 vía beta header
  //
  // Justificación: runs reales toman 15-20 min. Con TTL=5min default, el
  // cache se renueva 3-4 veces durante el run, multiplicando cache_create.
  // TTL=1h cubre el run entero con 1 sola escritura. Trade-off: cache_create
  // con TTL=1h cuesta 2× input vs 1.25× del 5min — ahorro neto ~60% en
  // cache_create para runs largos.
  //
  // Estos tests aseguran que:
  //   1. Los 3 servicios incluyan el beta header `extended-cache-ttl-2025-04-11`
  //   2. TODOS los cache_control breakpoints usen `ttl: '1h'`
  //   3. NO haya cache_control sin ttl (que default a 5min) — regresión silenciosa
  // =========================================================================

  describe('TTL extendido (1h) — beta header + ttl en cache_control', () => {
    it('los 3 servicios incluyen el beta header "extended-cache-ttl-2025-04-11"', () => {
      // Sin este header en `defaultHeaders`, Anthropic ignora el `ttl: '1h'`
      // y aplica el TTL default de 5min. La regresión sería SILENCIOSA.
      // El header puede aparecer solo o concatenado con otros betas (e.g.
      // ',advisor-tool-2026-03-01' agregado en Fase 2).
      const betaHeaderPattern = /'anthropic-beta':\s*'[^']*extended-cache-ttl-2025-04-11[^']*'/;
      expect(DIAGRAM_SERVICE).toMatch(betaHeaderPattern);
      expect(EPIC_SERVICE).toMatch(betaHeaderPattern);
      expect(STORY_SERVICE).toMatch(betaHeaderPattern);
    });

    it('epic-generation Y diagram-generation NO incluyen el advisor tool (removido 2026-05-04 — no aportaba valor)', () => {
      // Decisión histórica: se intentó el advisor en epic-generation
      // (piloto Fase 2) y luego en diagram-generation. Smoke tests reales
      // mostraron que Sonnet NUNCA lo invocaba en ambos contextos:
      //   - Épicas: prompts directos sin espacio de decisión.
      //   - Diagramas: 7 iters, 0 invocaciones — tareas estructurales
      //     (outline → draft → submit) sin decisiones que ameriten Opus.
      //
      // Alineado con doc oficial: "weaker fit for workloads where every
      // turn genuinely requires the advisor model's full capability."
      //
      // En story-generation el advisor se conserva SOLO en PO/TL/QA (3
      // agentes con decisiones reales). DEPS_AUDITOR y STORY_ORDER son
      // mecánicos y se removieron en el mismo commit. Ver el otro test
      // ("story-generation: advisor SOLO en PO/TL/QA, NO en DEPS_AUDITOR/STORY_ORDER").
      expect(EPIC_SERVICE).not.toMatch(/type:\s*'advisor_20260301'/);
      expect(EPIC_SERVICE).not.toMatch(/'anthropic-beta':\s*'[^']*advisor-tool-2026-03-01/);
      expect(DIAGRAM_SERVICE).not.toMatch(/type:\s*'advisor_20260301'/);
      expect(DIAGRAM_SERVICE).not.toMatch(/'anthropic-beta':\s*'[^']*advisor-tool-2026-03-01/);
      // Tampoco debe usar el namespace beta (sin advisor no hace falta).
      expect(DIAGRAM_SERVICE).not.toMatch(/client\.beta\.messages\.stream\(/);
    });

    it('los 3 servicios pasan defaultHeaders al constructor de Anthropic', () => {
      // El header debe estar dentro del `defaultHeaders` del cliente, no
      // como request override per-call. Si alguien lo movió a `extra_headers`
      // de un call específico, perdería cobertura para los demás calls.
      // Validamos por presencia de `defaultHeaders` cerca de `new Anthropic`
      // y luego presencia de `'anthropic-beta'` en cualquier parte cercana —
      // las regex multilínea con rangos amplios son frágiles a comentarios
      // largos de doc, así que descomponemos en 2 assertions más simples.
      const isInConstructor = /new Anthropic\([\s\S]{0,3000}defaultHeaders:\s*\{[\s\S]{0,1000}'anthropic-beta'/;
      expect(DIAGRAM_SERVICE).toMatch(isInConstructor);
      expect(EPIC_SERVICE).toMatch(isInConstructor);
      expect(STORY_SERVICE).toMatch(isInConstructor);
    });

    it('TODOS los cache_control breakpoints usan ttl 1h (no 5m default)', () => {
      // Si alguien agrega un nuevo cache_control sin ttl, defaulteará a 5min
      // y romperá el patrón. Este test detecta esa regresión.
      // Conteo esperado: diagram=4, epic=2, story=2 (total 8).
      const ttl1hPattern = /cache_control:\s*\{\s*type:\s*'ephemeral',\s*ttl:\s*'1h'\s*\}/g;
      const diagramCount = (DIAGRAM_SERVICE.match(ttl1hPattern) ?? []).length;
      const epicCount = (EPIC_SERVICE.match(ttl1hPattern) ?? []).length;
      const storyCount = (STORY_SERVICE.match(ttl1hPattern) ?? []).length;

      expect(diagramCount).toBe(4);
      expect(epicCount).toBe(2);
      expect(storyCount).toBe(2);
    });

    it('NO existe ningún cache_control con ttl 5m explícito (regresión guard)', () => {
      // Si alguien revierte un breakpoint a `ttl: '5m'`, este test falla.
      // El TTL default es 5min, así que un `ttl: '5m'` explícito sería
      // equivalente al default — pero indicaría que alguien intencionalmente
      // bajó el TTL en un sitio específico, lo cual queremos detectar.
      const ttl5mPattern = /cache_control:\s*\{\s*type:\s*'ephemeral',\s*ttl:\s*'5m'\s*\}/g;
      expect(DIAGRAM_SERVICE.match(ttl5mPattern)).toBeNull();
      expect(EPIC_SERVICE.match(ttl5mPattern)).toBeNull();
      expect(STORY_SERVICE.match(ttl5mPattern)).toBeNull();
    });

    it('NO existe ningún cache_control sin ttl (defaultearía a 5m — regresión silenciosa)', () => {
      // Detecta el patrón ANTIGUO: `cache_control: { type: 'ephemeral' }`
      // sin ttl. Si alguien agrega un nuevo breakpoint y olvida `ttl: '1h'`,
      // este test falla — el cache expiraría a 5min y el ahorro se perdería.
      const noTtlPattern = /cache_control:\s*\{\s*type:\s*'ephemeral'\s*\}/g;
      expect(DIAGRAM_SERVICE.match(noTtlPattern)).toBeNull();
      expect(EPIC_SERVICE.match(noTtlPattern)).toBeNull();
      expect(STORY_SERVICE.match(noTtlPattern)).toBeNull();
    });

    it('umbral de tokens calibrado a 4096 chars (~1024 tokens) — Anthropic spec — aplicado a AMBOS breakpoints', () => {
      // Anthropic ignora cache_control si el bloque está bajo 1024 tokens.
      // El log inicial debe medir SYSTEMPROMPT y CONTEXTBLOCK por separado
      // (cada breakpoint cachea independiente). Si alguien revierte a medir
      // solo contextBlock, el log mentiría — el smoke test del 2026-05-04
      // mostró que el systemPrompt activa cache solo aunque contextBlock no.
      const systemCheck = /systemPromptChars >= 4096/g;
      const contextCheck = /contextBlockChars >= 4096/g;

      const diagramSystemChecks = DIAGRAM_SERVICE.match(systemCheck);
      const diagramContextChecks = DIAGRAM_SERVICE.match(contextCheck);
      const epicSystemChecks = EPIC_SERVICE.match(systemCheck);
      const epicContextChecks = EPIC_SERVICE.match(contextCheck);

      expect(diagramSystemChecks).not.toBeNull();
      expect(diagramSystemChecks!.length).toBeGreaterThanOrEqual(2); // 2 sitios
      expect(diagramContextChecks).not.toBeNull();
      expect(diagramContextChecks!.length).toBeGreaterThanOrEqual(2);

      expect(epicSystemChecks).not.toBeNull();
      expect(epicSystemChecks!.length).toBeGreaterThanOrEqual(1); // 1 sitio
      expect(epicContextChecks).not.toBeNull();
      expect(epicContextChecks!.length).toBeGreaterThanOrEqual(1);
    });

    it('acumuladores de tokens están declarados en outer scope (sobreviven el for loop)', () => {
      // Los `let totalInputTokens = 0` etc. DEBEN estar fuera del `for`
      // para acumular entre iters. Si alguien los mete dentro del for por
      // accidente, el resumen siempre será 0.
      expect(DIAGRAM_SERVICE).toMatch(
        /let totalInputTokens = 0;\s*\n\s*let totalOutputTokens = 0;\s*\n\s*let totalCacheRead = 0;\s*\n\s*let totalCacheCreate = 0;\s*\n[\s\S]{0,3000}for\s*\(let iteration/,
      );
      expect(EPIC_SERVICE).toMatch(
        /let totalInputTokens = 0;\s*\n\s*let totalOutputTokens = 0;\s*\n\s*let totalCacheRead = 0;\s*\n\s*let totalCacheCreate = 0;\s*\n[\s\S]{0,500}for\s*\(let iteration/,
      );
    });
  });

  // =========================================================================
  // Advisor strategy — wiring crítico (3 errores corregidos 2026-05-04):
  //
  //   1. Modelo del advisor: SOLO `claude-opus-4-7` (la tabla oficial no
  //      acepta 4-6 — bug raíz que mantuvo el advisor inactivo en 7+ runs).
  //   2. Namespace beta: `client.beta.messages.stream()` con `betas: [...]`
  //      pasados por request, NO `client.messages.stream()` standard con el
  //      header en `defaultHeaders` (el standard ignora el tool en silencio).
  //   3. Header del advisor SOLO en el array `betas`, NO en `defaultHeaders`.
  //
  // Estos tests guardan que la regresión sea ruidosa: si alguien revierte a
  // 4-6 o vuelve al namespace standard, los tests fallan al instante.
  // =========================================================================

  describe('Advisor strategy — wiring beta + modelo correcto', () => {
    it('story-generation declara ADVISOR_MODEL = claude-opus-4-7 (NO 4-6)', () => {
      // El advisor SOLO acepta opus-4-7 según la tabla oficial. 4-6 es
      // ignorado silenciosamente y el run no invoca al advisor.
      expect(STORY_SERVICE).toMatch(/const ADVISOR_MODEL = 'claude-opus-4-7';/);
      expect(STORY_SERVICE).not.toMatch(/const ADVISOR_MODEL = 'claude-opus-4-6';/);
    });

    it('story-generation usa client.beta.messages.stream() (NO el namespace standard)', () => {
      // Sin el namespace beta, el header `advisor-tool-2026-03-01` se ignora
      // y el advisor nunca se invoca aunque esté declarado en `tools`.
      expect(STORY_SERVICE).toMatch(/client\.beta\.messages\.stream\(/);
    });

    it('story-generation pasa betas con extended-cache-ttl + advisor-tool en cada llamada beta', () => {
      // El header debe estar en el array `betas: [...]` por request, no
      // en `defaultHeaders`.
      expect(STORY_SERVICE).toMatch(
        /betas:\s*\[\s*'extended-cache-ttl-2025-04-11',\s*'advisor-tool-2026-03-01'\s*\]/,
      );
    });

    it('story-generation NO tiene advisor-tool en defaultHeaders (debe ir en betas[])', () => {
      // Si alguien revierte y vuelve a poner el advisor en defaultHeaders,
      // el namespace beta sigue funcionando pero el código duplica el
      // header en 2 lugares — y peor, si alguien borra el `betas` del
      // request específico pensando que el defaultHeaders cubre, el
      // advisor se desactiva. Mejor un único punto de verdad: en betas[].
      expect(STORY_SERVICE).not.toMatch(
        /defaultHeaders:\s*\{[\s\S]{0,500}'anthropic-beta':\s*'[^']*advisor-tool-2026-03-01[^']*'/,
      );
    });

    it('buildAdvisorTool() emite shape correcto (type=advisor_20260301, model=ADVISOR_MODEL) — solo en story', () => {
      // Sanity check: el tool emitido debe tener el `type` correcto y
      // referenciar la constante `ADVISOR_MODEL` (no un literal hardcoded).
      // Solo aplica a story-generation desde 2026-05-04 (advisor removido
      // de epic y diagram).
      const toolShapePattern =
        /type:\s*'advisor_20260301',\s*name:\s*'advisor',\s*model:\s*ADVISOR_MODEL,\s*max_uses:/;
      expect(STORY_SERVICE).toMatch(toolShapePattern);
    });

    it('story-generation acumula advisor tokens desde usage.iterations (BetaUsage shape)', () => {
      // Con el namespace beta, `usage.iterations` contiene los tokens del
      // advisor por separado. El fix 2026-05-04 los suma en
      // `advisorInputTokens` / `advisorOutputTokens` — sin esto, los logs
      // siempre reportarían 0 aunque el advisor sí se invoque.
      expect(STORY_SERVICE).toMatch(/usage as any\)\?\.iterations/);
      expect(STORY_SERVICE).toMatch(/advisorInputTokens\s*=\s*advisorIterations\.reduce/);
      expect(STORY_SERVICE).toMatch(/advisorOutputTokens\s*=\s*advisorIterations\.reduce/);
    });
  });

  // =========================================================================
  // Advisor wiring — fixes derivados del segundo deep-dive de docs (2026-05-04)
  //
  // Doc:
  //   https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool
  //
  //   1. La invocación produce `server_tool_use` (NO `tool_use`). Filtrar por
  //      el tipo erróneo siempre cuenta 0 invocaciones.
  //   2. `usage.iterations[]` discrimina por `type`: 'advisor_message' (Opus)
  //      vs 'message' (executor). Sumar todas las iterations duplica los
  //      tokens del executor en la métrica del advisor.
  //   3. ADVISOR_GUIDANCE debe seguir el patrón prescriptivo evaluado por
  //      Anthropic: conciseness primero (corta tokens 35-45%), timing,
  //      treatment. El patrón anterior ("usa SOLO en decisiones difíciles")
  //      DETER al executor de invocar.
  // =========================================================================

  describe('Advisor wiring — alineado con docs oficiales', () => {
    it('story-generation filtra advisor blocks por server_tool_use (NO tool_use)', () => {
      // Doc: "The executor emits a `server_tool_use` block with `name: 'advisor'`".
      // Filtrar por `tool_use` (regular) siempre da 0 falsamente.
      expect(STORY_SERVICE).toMatch(
        /b\?\.type\s*===\s*'server_tool_use'\s*&&\s*b\?\.name\s*===\s*'advisor'/,
      );
      // El antipatrón viejo NO debe estar.
      expect(STORY_SERVICE).not.toMatch(
        /b\?\.type\s*===\s*'tool_use'\s*&&\s*b\?\.name\s*===\s*'advisor'/,
      );
    });

    it('story-generation filtra usage.iterations por type === "advisor_message"', () => {
      // Doc: "Iterations with `type: 'advisor_message'` are billed at the
      // advisor model's rates; iterations with `type: 'message'` are billed
      // at the executor model's rates." Sumar todas dobletea el executor.
      expect(STORY_SERVICE).toMatch(
        /allIterations\.filter\(\(it\)\s*=>\s*it\?\.type\s*===\s*'advisor_message'\)/,
      );
    });

    it('ADVISOR_GUIDANCE empieza con la conciseness instruction (corta tokens 35-45%) — solo en story', () => {
      // Doc: "prepend a single conciseness instruction to the system prompt
      // before any other sentence that mentions the advisor." La instrucción
      // exacta que evalúa Anthropic. Solo en story (advisor removido de diagram).
      const concisenessLine = /The advisor should respond in under 100 words and use enumerated steps, not explanations\./;
      expect(STORY_SERVICE).toMatch(concisenessLine);
    });

    it('ADVISOR_GUIDANCE incluye el timing block ("Call advisor BEFORE substantive work") — solo en story', () => {
      // Patrón oficial: nudgea al executor a invocar advisor antes de
      // commits a un approach o submit. Sin esto, el executor lo invocaba
      // raramente o nunca.
      const timingPattern = /Call advisor BEFORE substantive work/;
      expect(STORY_SERVICE).toMatch(timingPattern);
    });

    it('ADVISOR_GUIDANCE incluye el treatment block ("Give the advice serious weight") — solo en story', () => {
      // Sin este bloque, el executor podía ignorar las recomendaciones del
      // advisor o switchear silenciosamente sin reconciliar conflictos.
      const treatmentPattern = /Give the advice serious weight/;
      expect(STORY_SERVICE).toMatch(treatmentPattern);
    });

    it('story-generation NO contiene el patrón viejo restrictivo "usa SOLO en decisiones difíciles"', () => {
      // El patrón viejo deteraba la invocación. Si alguien lo restaura, el
      // smoke test bajará invocaciones a 0 — este test atrapa la regresión.
      expect(STORY_SERVICE).not.toMatch(/Úsalo SOLO en decisiones genuinamente difíciles/);
    });

    it('story-generation log usa el formato nuevo "advisor(uses=N tokens=in/out=...)" — no el viejo "blocks="', () => {
      // El log viejo (`blocks=N types=[...]`) no expone tokens reales del
      // advisor. El log nuevo lo hace para que el smoke test confirme
      // costo del Opus por separado.
      expect(STORY_SERVICE).toMatch(/advisor\(uses=\$\{advisorCount\} tokens=in\/out=/);
      expect(STORY_SERVICE).not.toMatch(/advisor\(blocks=\$\{advisorCount\} types=/);
    });
  });

  // =========================================================================
  // Refinamientos del tercer deep-dive (verificado contra docs 2026-05-04):
  //
  //   1. Cada invocación del advisor produce 2 blocks: server_tool_use +
  //      advisor_tool_result. Contar ambos doblea el conteo. Filtramos solo
  //      server_tool_use (1:1 con invocaciones reales).
  //   2. `advisor_tool_result.content.type === 'advisor_tool_result_error'`
  //      identifica errores (max_uses_exceeded, overloaded, etc.) — los
  //      reportamos por separado para no esconder problemas operativos.
  //   3. `stop_reason === 'pause_turn'` puede ocurrir cuando el server-side
  //      loop hit su iter limit con un dangling advisor o web_search. El
  //      doc dice "Simply add the assistant's response to your messages array
  //      and make another API request" — exactamente lo que hace nuestro
  //      `messages.push + continue`. Logueamos para detectarlo, no para
  //      cambiar el manejo.
  // =========================================================================

  describe('Advisor refinements — conteo exacto + error tracking + pause_turn', () => {
    it('story-generation cuenta SOLO server_tool_use para advisorCount (1:1 con invocaciones)', () => {
      // Cada invocación produce 1 server_tool_use + 1 advisor_tool_result.
      // El antipatrón anterior contaba ambos → reportaba uses=4 cuando max_uses=2.
      expect(STORY_SERVICE).toMatch(
        /advisorInvocations\s*=\s*response\.content\.filter\(\s*\([^)]*\)\s*=>\s*b\?\.type\s*===\s*'server_tool_use'\s*&&\s*b\?\.name\s*===\s*'advisor'/,
      );
      expect(STORY_SERVICE).toMatch(/advisorCount\s*=\s*advisorInvocations\.length/);
    });

    it('story-generation detecta advisor errors via content.type === advisor_tool_result_error', () => {
      expect(STORY_SERVICE).toMatch(
        /advisorErrors\s*=\s*advisorResults\.filter\(\s*\([^)]*\)\s*=>\s*b\?\.content\?\.type\s*===\s*'advisor_tool_result_error'/,
      );
      expect(STORY_SERVICE).toMatch(/advisorErrorCount\s*=\s*advisorErrors\.length/);
    });

    it('story-generation detecta y loguea pause_turn explícitamente (defensivo)', () => {
      // Doc: "Your application should handle `pause_turn` in any agent loop
      // that uses server tools." Nuestro continue lo maneja, este log lo
      // hace visible en smoke tests.
      expect(STORY_SERVICE).toMatch(
        /response\.stop_reason\s*===\s*'pause_turn'/,
      );
      expect(STORY_SERVICE).toMatch(/⏸ pause_turn at iter/);
    });

    it('story-generation log per-iter incluye errors=N⚠ cuando advisorErrorCount > 0', () => {
      // Cuando hay errores del advisor (rate-limit, max_uses_exceeded), el
      // log debe mostrar `errors=N⚠` para distinguir invocaciones exitosas
      // de fallidas — un advisor que cae 100% en errors igual cuenta para
      // max_uses pero NO entrega advice útil.
      const errorLogPattern = /errors=\$\{advisorErrorCount\}⚠/;
      expect(STORY_SERVICE).toMatch(errorLogPattern);
    });
  });

  // =========================================================================
  // Decisiones tras smoke test real de historias (2026-05-04):
  //
  //   1. ADVISOR removido de DEPS_AUDITOR y STORY_ORDER. Run de prueba mostró
  //      que invocaban al advisor 1 vez cada uno por tareas mecánicas (audit
  //      vendors / extracción de edges). Costo: ~$2.13/run del Opus para 0
  //      decisión real. Conservado solo en PO/TL/QA donde sí toman decisión.
  //
  //   2. PO migrado de Haiku 4.5 → Sonnet 4.6. Smoke test mostró calidad
  //      narrativa inferior con Haiku en los 5 headings del PO. Sonnet
  //      entrega prosa más rica en lenguaje de PO real.
  //
  //   3. QA bug fix: Sonnet a veces emite `strategies` como JSON-encoded
  //      string bajo presión de output (qa.markdown grande + dependencies
  //      con mdContent hyper-rico). Antes: 3 retries × $0.09 = $0.27/run.
  //      Ahora: validateTerminal intenta JSON.parse y recupera in-place.
  // =========================================================================

  describe('Story-generation refinements post smoke test (2026-05-04)', () => {
    it('story-generation: advisor SOLO en PO/TL/QA, NO en DEPS_AUDITOR/STORY_ORDER', () => {
      // El advisor es costoso ($15/M Opus). Solo justifica donde el agente
      // toma decisiones de criterio (división de stories, arquitectura, edge
      // cases). DEPS_AUDITOR y STORY_ORDER son mecánicos — Haiku basta.
      //
      // Conteo esperado: `buildAdvisorTool() as any` aparece 3 veces (PO+TL+QA),
      // NO 5 como en la versión inicial.
      const advisorCalls = STORY_SERVICE.match(/buildAdvisorTool\(\)\s+as\s+any/g);
      expect(advisorCalls).not.toBeNull();
      expect(advisorCalls!.length).toBe(3);

      // Verificación complementaria: ADVISOR_GUIDANCE se concatena en
      // EXACTAMENTE 3 system prompts (no 5).
      const guidanceInjections = STORY_SERVICE.match(/\+\s*ADVISOR_GUIDANCE/g);
      expect(guidanceInjections).not.toBeNull();
      expect(guidanceInjections!.length).toBe(3);
    });

    it('story-generation: runDepsAuditorAgent NO inyecta ADVISOR_GUIDANCE', () => {
      // Guard contra regresión: si alguien añade `+ ADVISOR_GUIDANCE` al
      // roleSystemPrompt del DEPS_AUDITOR, este test falla. El comentario
      // en el código explica el porqué del removal.
      const depsBlock = STORY_SERVICE.match(
        /buildDepsAuditorSystemPrompt\(\)[^;\n]*/,
      );
      expect(depsBlock).not.toBeNull();
      expect(depsBlock![0]).not.toMatch(/ADVISOR_GUIDANCE/);
    });

    it('story-generation: runStoryOrderAgent NO inyecta ADVISOR_GUIDANCE', () => {
      const orderBlock = STORY_SERVICE.match(
        /buildStoryOrderSystemPrompt\(\)[^;\n]*/,
      );
      expect(orderBlock).not.toBeNull();
      expect(orderBlock![0]).not.toMatch(/ADVISOR_GUIDANCE/);
    });

    it('PO usa el modelo configurable por org, NO HAIKU_MODEL — revertido tras smoke test', () => {
      // El user observó que el PO con Haiku quedaba inferior en calidad
      // narrativa (revert 2026-05-04). Desde el selector de modelo (2026-06-10)
      // el caller pasa `model` resuelto de OrgAnthropicConfigService.getModel()
      // — cuya whitelist excluye Haiku — y el comentario preserva el porqué.
      expect(STORY_SERVICE).toMatch(
        /role:\s*'po',\s*\n[\s\S]{0,500}Haiku[\s\S]{0,500}model,/,
      );
      // Garantía dura: el caller del PO no pasa HAIKU_MODEL.
      expect(STORY_SERVICE).not.toMatch(/role:\s*'po',\s*\n[\s\S]{0,300}HAIKU_MODEL/);
    });

    it('runQAAgent valida con recovery automática para strategies-as-string (Sonnet bug)', () => {
      // Sonnet bajo presión de output a veces serializa el array como JSON
      // string. El validator lo recupera con JSON.parse antes de fallar.
      // Sin esto, cada run pierde 2-3 iters en retries (~$0.27).
      expect(STORY_SERVICE).toMatch(/typeof strategies\s*===\s*'string'/);
      expect(STORY_SERVICE).toMatch(/JSON\.parse\(strategies\)/);
      expect(STORY_SERVICE).toMatch(/recuperado strategies-as-string via JSON\.parse/);
      expect(STORY_SERVICE).toMatch(/inputObj\.strategies\s*=\s*parsed/);
    });

    it('runQAAgent error message refuerza "array literal NO JSON-encoded string"', () => {
      // El nuevo errorMessage en el validator distingue array literal vs
      // string serializado, con ejemplos de ambos. Sin esta claridad, el
      // modelo puede repetir el mismo error en el retry.
      expect(STORY_SERVICE).toMatch(
        /array literal de objetos, NO un JSON-encoded string/,
      );
    });

    it('user content del QA advierte explícitamente sobre el shape del array', () => {
      // Refuerzo en el USER content (no solo en el validator): el modelo
      // ve esta nota antes de emitir, así puede evitar el error desde la
      // primera iteración.
      expect(STORY_SERVICE).toMatch(
        /strategies.{1,200}DEBE ser un \*\*array literal nativo de objetos\*\*, NO un string JSON-encoded/,
      );
    });
  });
});
