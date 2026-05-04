#!/usr/bin/env node
/**
 * Script de verificación standalone — confirma que el parser de markdown
 * que usa el frontend reconoce correctamente las tablas GFM que el agente
 * QA va a emitir tras el cambio bullets → tablas en `## Happy path` y
 * `## Edge cases`.
 *
 * Estrategia: verifica a nivel de PARSER (`markdown-it`, que es lo que
 * `tiptap-markdown` usa internamente) en lugar de instanciar un Editor
 * completo de TipTap. Razón: TipTap 3.x con ProseMirror falla en Node
 * nativo por interop ESM/CJS que duplica plugin keys, pero el parser
 * de markdown es 100% determinístico y se puede testear aislado.
 *
 * Lo que esto SÍ valida (lo importante):
 *  - La sintaxis GFM `| col | col |` se reconoce como tabla y no como prosa.
 *  - Los headers se distinguen de las celdas data.
 *  - Conteo de columnas correcto (2 para Happy path, 3 para Edge cases).
 *  - El HTML resultante contiene <table>, <thead>, <tr>, <th>, <td> —
 *    lo cual TipTap mapea automáticamente a sus nodes de tabla.
 *  - Code inline (`...`) en celdas no rompe el parser.
 *
 * Lo que NO valida (out-of-scope):
 *  - El render visual final con CSS de Tiptap — eso solo se ve corriendo
 *    `pnpm dev` y abriendo la story.
 *  - Round-trip JSON ↔ markdown completo via TipTap — requiere bundler real.
 *
 * Uso:
 *   cd apps/web && node scripts/verify-qa-markdown-tables.mjs
 *
 * Exit codes: 0 = OK, 1 = falló alguna verificación.
 */
import { createRequire } from 'module';

// `markdown-it` es dep transitiva via `tiptap-markdown`. Usamos la misma
// instancia que carga tiptap-markdown para garantizar paridad de versión
// y plugins habilitados (tables, lists, code fences).
const requireFromHere = createRequire(import.meta.url);
const tiptapMarkdownPath = requireFromHere.resolve('tiptap-markdown');
const requireFromTiptapMarkdown = createRequire(tiptapMarkdownPath);
const markdownItPath = requireFromTiptapMarkdown.resolve('markdown-it');
const MarkdownIt = (await import(markdownItPath)).default;

// Configuración idéntica a la que usa tiptap-markdown internamente cuando
// `Markdown.configure({ html: false, breaks: true })` se aplica en
// `apps/web/src/components/shared/tiptap/extensions.ts`.
const md = new MarkdownIt({
  html: false,
  breaks: true,
  // GFM tables están habilitadas por defecto en markdown-it 14.x.
});

// Markdown de ejemplo — formato literal que el QA emitirá después del cambio.
const SAMPLE_QA_MARKDOWN = `## Pruebas unitarias

Cubre \`PaymentService.charge()\` en \`apps/api/src/modules/payments/payment.service.ts\`. Testea validación de input, mapeo de errores de Stripe, y persistencia exitosa.

## Happy path

| Input | Output esperado |
| --- | --- |
| \`POST /api/payments\` con \`{ amount: 1000, currency: 'USD', cardToken: 'tok_visa' }\` | 201 + \`{ paymentId, status: 'succeeded' }\` |
| \`GET /api/payments/:id\` con paymentId del usuario auth | 200 + payment object con \`status='succeeded'\` |
| \`POST /api/payments\` con cardToken requires_action | 200 + \`{ paymentId, status: 'requires_action' }\` |

## Edge cases

| Condición | Comportamiento | Código de error |
| --- | --- | --- |
| \`amount=0\` | Rechazado en validator, sin llamar Stripe | 422 \`ERR.VALIDATION.INVALID_AMOUNT\` |
| \`amount\` negativo | Rechazado en validator | 422 \`ERR.VALIDATION.NEGATIVE_AMOUNT\` |
| Stripe SDK timeout >5s | 1 retry automático y luego falla | 504 \`ERR.PAYMENT.GATEWAY_TIMEOUT\` |
| JWT expirado | JwtGuard rechaza antes del controller | 401 \`ERR.AUTH.UNAUTHORIZED\` |

## Mocks

\`StripeClient\` mockeado con \`jest.mock('stripe')\`: happy retorna \`{ id, status: 'succeeded' }\`, fail throws \`StripeCardError\`.

## Herramientas

Jest 29 + supertest 7. Comando: \`pnpm --filter api test apps/api/src/modules/payments\`.
`;

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function fail(msg, extra) {
  console.error(`\n❌ FAIL — ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

function pass(msg) {
  console.log(`✅ ${msg}`);
}

// ─────────────────────────────────────────────────────────────────
// Verificación 1 — el parser reconoce las 2 tablas como bloques
// ─────────────────────────────────────────────────────────────────

const tokens = md.parse(SAMPLE_QA_MARKDOWN, {});
const tableOpens = tokens.filter((t) => t.type === 'table_open');

if (tableOpens.length !== 2) {
  fail(
    `esperaba 2 tokens \`table_open\` (Happy path + Edge cases), encontré ${tableOpens.length}`,
    `Token types vistos: ${tokens.map((t) => t.type).filter((t) => t.includes('table') || t.startsWith('th') || t.startsWith('td') || t.startsWith('tr')).join(', ')}`,
  );
}
pass(`Parser reconoce 2 tokens \`table_open\` (sintaxis GFM funciona)`);

// ─────────────────────────────────────────────────────────────────
// Verificación 2 — conteo de columnas por tabla
// ─────────────────────────────────────────────────────────────────

// Para cada `table_open`, contar `th_open` hasta el primer `tr_close` (header row).
function countColumnsForTable(tokens, tableOpenIdx) {
  let count = 0;
  for (let i = tableOpenIdx + 1; i < tokens.length; i++) {
    if (tokens[i].type === 'th_open') count++;
    if (tokens[i].type === 'tr_close') break;
  }
  return count;
}

const happyTableIdx = tokens.findIndex((t) => t.type === 'table_open');
const edgeTableIdx = tokens.findIndex(
  (t, i) => t.type === 'table_open' && i > happyTableIdx,
);

const happyCols = countColumnsForTable(tokens, happyTableIdx);
const edgeCols = countColumnsForTable(tokens, edgeTableIdx);

if (happyCols !== 2) {
  fail(`Happy path table tiene ${happyCols} columnas, esperaba 2 (Input | Output esperado)`);
}
pass(`Happy path table: ${happyCols} columnas (Input | Output esperado)`);

if (edgeCols !== 3) {
  fail(`Edge cases table tiene ${edgeCols} columnas, esperaba 3 (Condición | Comportamiento | Código de error)`);
}
pass(`Edge cases table: ${edgeCols} columnas (Condición | Comportamiento | Código de error)`);

// ─────────────────────────────────────────────────────────────────
// Verificación 3 — conteo de filas data
// ─────────────────────────────────────────────────────────────────

function countDataRowsForTable(tokens, tableOpenIdx) {
  // Las filas data viven entre `tbody_open` y `tbody_close`.
  let inTbody = false;
  let count = 0;
  for (let i = tableOpenIdx + 1; i < tokens.length; i++) {
    if (tokens[i].type === 'tbody_open') inTbody = true;
    else if (tokens[i].type === 'tbody_close') break;
    else if (inTbody && tokens[i].type === 'tr_open') count++;
  }
  return count;
}

const happyRows = countDataRowsForTable(tokens, happyTableIdx);
const edgeRows = countDataRowsForTable(tokens, edgeTableIdx);

if (happyRows !== 3) fail(`Happy path tiene ${happyRows} filas data, esperaba 3`);
pass(`Happy path table: 3 filas data`);

if (edgeRows !== 4) fail(`Edge cases tiene ${edgeRows} filas data, esperaba 4`);
pass(`Edge cases table: 4 filas data`);

// ─────────────────────────────────────────────────────────────────
// Verificación 4 — render HTML contiene los tags correctos
// ─────────────────────────────────────────────────────────────────

const html = md.render(SAMPLE_QA_MARKDOWN);

const requiredTags = ['<table>', '<thead>', '<tbody>', '<tr>', '<th>', '<td>'];
const missingTags = requiredTags.filter((tag) => !html.includes(tag));
if (missingTags.length > 0) {
  fail(
    `el HTML renderizado no contiene los tags: ${missingTags.join(', ')}`,
    `HTML output (primeros 800 chars):\n${html.slice(0, 800)}`,
  );
}
pass(`HTML renderizado contiene <table>, <thead>, <tbody>, <tr>, <th>, <td>`);

// ─────────────────────────────────────────────────────────────────
// Verificación 5 — code inline en celdas se preserva (<code>)
// ─────────────────────────────────────────────────────────────────

const codeTagsInTable = (html.match(/<td>[\s\S]*?<code>[\s\S]*?<\/code>[\s\S]*?<\/td>/g) ?? []).length;
if (codeTagsInTable < 5) {
  fail(
    `esperaba ≥5 celdas con <code> inline (los ejemplos del QA usan backticks abundantemente), encontré ${codeTagsInTable}`,
    `HTML preview:\n${html.slice(0, 500)}`,
  );
}
pass(`Celdas preservan <code> inline para snippets con backticks (${codeTagsInTable} celdas)`);

// ─────────────────────────────────────────────────────────────────
// Verificación 6 — los 5 headings de QA siguen siendo headings level-2
// (sanity check del validateTerminal del backend)
// ─────────────────────────────────────────────────────────────────

const h2Tokens = tokens.filter((t) => t.type === 'heading_open' && t.tag === 'h2');
if (h2Tokens.length !== 5) {
  fail(`esperaba 5 headings level-2 (los 5 obligatorios del QA), encontré ${h2Tokens.length}`);
}
pass(`Los 5 headings level-2 obligatorios se preservan como \`<h2>\``);

// ─────────────────────────────────────────────────────────────────
// Resumen final
// ─────────────────────────────────────────────────────────────────

console.log('\n🎉 Todas las verificaciones pasaron — el parser de markdown que usa el frontend reconoce correctamente las tablas GFM del nuevo formato QA.');
console.log('\nNota: el render visual final (estilos Tiptap, bordes de celda) requiere abrir una story en el browser con `pnpm dev`. Esta verificación solo confirma que la SINTAXIS del LLM no se va a degradar a prosa.\n');
process.exit(0);
