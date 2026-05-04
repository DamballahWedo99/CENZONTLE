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
 */
const KICKOFF_MESSAGE_PATTERN =
  /messages:\s*Anthropic\.Messages\.MessageParam\[\]\s*=\s*\[[\s\S]{0,500}role:\s*'user',\s*content:\s*'[^']*system prompt[^']*'/;

/**
 * Regex que detecta la regresión: contextBlock viajando en messages[0]
 * en vez del system. Si esto matchea, el fix se rompió.
 */
const CONTEXT_BLOCK_IN_MESSAGES_REGRESSION =
  /messages:\s*Anthropic\.Messages\.MessageParam\[\]\s*=\s*\[\s*\{\s*role:\s*'user',\s*content:\s*contextBlock\s*\}/;

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
        expect(DIAGRAM_SERVICE).toMatch(/this\.client\.messages\.create\(/);
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
      expect(EPIC_SERVICE).toMatch(/this\.client\.messages\.stream\(/);
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
      // declarados antes del for con `for (let iteration`.
      expect(STORY_SERVICE).toMatch(
        /let totalInputTokens = 0;\s*\n\s*let totalOutputTokens = 0;\s*\n\s*let totalCacheRead = 0;\s*\n\s*let totalCacheCreate = 0;\s*\n[\s\S]{0,500}for\s*\(let iteration/,
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
      // y aplica el TTL default de 5min. La regresión sería SILENCIOSA — no
      // hay error, solo el cache expira más rápido y los costos suben.
      const betaHeaderPattern = /'anthropic-beta':\s*'extended-cache-ttl-2025-04-11'/;
      expect(DIAGRAM_SERVICE).toMatch(betaHeaderPattern);
      expect(EPIC_SERVICE).toMatch(betaHeaderPattern);
      expect(STORY_SERVICE).toMatch(betaHeaderPattern);
    });

    it('los 3 servicios pasan defaultHeaders al constructor de Anthropic', () => {
      // El header debe estar dentro del `defaultHeaders` del cliente, no
      // como request override per-call. Si alguien lo movió a `extra_headers`
      // de un call específico, perdería cobertura para los demás calls.
      const constructorPattern = /new Anthropic\(\s*\{[\s\S]{0,500}defaultHeaders:\s*\{[\s\S]{0,200}'anthropic-beta'/;
      expect(DIAGRAM_SERVICE).toMatch(constructorPattern);
      expect(EPIC_SERVICE).toMatch(constructorPattern);
      expect(STORY_SERVICE).toMatch(constructorPattern);
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
});
