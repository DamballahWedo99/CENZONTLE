/* ════════════════════════════════════════════════════════════════════════
 * verify-secret-read.ts — verificación on-demand de la LECTURA de secrets
 * ════════════════════════════════════════════════════════════════════════
 *
 * Corre el flujo REAL del worker (`runStory`) con el binario `claude` real y
 * un secreto externo inyectado. La "historia" es trivial: el agente debe
 * leer `process.env.TEST_EXTERNAL_SECRET` y reportar su longitud + los
 * primeros 4 chars. Confirma end-to-end que el secreto del claim llega al
 * environment del agente — y, de paso, que sobrevive al sandbox.
 *
 * ⚠️  GASTA TOKENS REALES de la API de Anthropic. Minimizado a propósito:
 *   - Haiku 4.5 + effort `low`,
 *   - sandbox mode (`repoUrl: null` → sin clone/push de GitHub),
 *   - `dodCriteria: []` → cero spawns del DoD verifier,
 *   - una tarea de 1 turno con un prompt mínimo.
 *   Costo típico: del orden de 1-3 centavos.
 *
 * Por eso NO es un `*.test.ts` (CI corre `pnpm test`, jamás esto) y tiene
 * DOBLE opt-in: `RUN_SECRET_READ_CHECK=1` Y `ANTHROPIC_API_KEY`.
 *
 * Uso:
 *   RUN_SECRET_READ_CHECK=1 ANTHROPIC_API_KEY=sk-ant-xxx \
 *     pnpm --filter @cenzontle/worker verify:secrets
 *
 * Requiere `claude` en el PATH y un sandbox (`sandbox-exec` en macOS /
 * `firejail` en Linux). Para bypassear el sandbox: exportá además
 * FACTORY_WORKER_SANDBOX_MODE=none y FACTORY_WORKER_ALLOW_NO_SANDBOX=1.
 */

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ClaimedStory } from '@cenzontle/shared';
import { runStory } from './lib/runner.js';
import type { ApiClient } from './lib/api-client.js';

// Secreto descartable — NUNCA una credencial real. Formato arbitrario, sin
// prefijo reconocible: así la verificación depende de la inyección del env,
// no de un patrón de redacción.
const SECRET_NAME = 'TEST_EXTERNAL_SECRET';
const SECRET_VALUE = 'forge-secret-read-check-abc123xyz';

/**
 * Prompt para el agente: una tarea trivial de 1 turno. Le pedimos correr UN
 * comando de bash que imprime la longitud + los primeros 4 chars del secreto
 * (evidencia observable y leak-safe — no imprime el valor completo).
 */
const PROBE_PROMPT = [
  'Tarea de verificación interna del Forge. NO escribas código, NO crees',
  'archivos, NO instales dependencias, NO abras ningún PR.',
  '',
  'Ejecutá UNA SOLA VEZ, con tu herramienta de bash, exactamente este comando:',
  '',
  '  printf \'SECRET_PROBE len=%s head=%s\\n\' "${#TEST_EXTERNAL_SECRET}" "${TEST_EXTERNAL_SECRET:0:4}"',
  '',
  'Ese comando imprime una línea con el formato `SECRET_PROBE len=<N> head=<XXXX>`.',
  'Reportá textualmente esa línea en tu respuesta y terminá. No hagas nada más.',
].join('\n');

function box(title: string, lines: string[]): void {
  const bar = '═'.repeat(72);
  console.log(`\n${bar}\n  ${title}\n${bar}`);
  for (const line of lines) console.log(`  ${line}`);
  console.log(bar + '\n');
}

async function main(): Promise<number> {
  // ── Gate 1 — opt-in explícito. CI nunca setea esta variable. ───────────
  if (process.env.RUN_SECRET_READ_CHECK !== '1') {
    box('verify-secret-read — NO ejecutado', [
      'Esta verificación GASTA TOKENS REALES de la API de Anthropic.',
      'Para correrla hace falta opt-in explícito con dos variables:',
      '',
      '  RUN_SECRET_READ_CHECK=1 ANTHROPIC_API_KEY=sk-ant-xxx \\',
      '    pnpm --filter @cenzontle/worker verify:secrets',
    ]);
    return 0;
  }

  // ── Gate 2 — API key real. ─────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length < 10) {
    box('verify-secret-read — ERROR', [
      'RUN_SECRET_READ_CHECK=1 está seteado pero falta ANTHROPIC_API_KEY',
      '(una key real `sk-ant-...`). Sin ella no se puede correr un `claude`',
      'real. Exportá ANTHROPIC_API_KEY y reintentá.',
    ]);
    return 1;
  }

  const expectedLen = SECRET_VALUE.length;
  const expectedHead = SECRET_VALUE.slice(0, 4);

  box('verify-secret-read — corriendo', [
    `Secreto inyectado: ${SECRET_NAME} (len=${expectedLen}, head=${expectedHead})`,
    'Modelo: claude-haiku-4-5 · effort low · sandbox mode · sin DoD verifier',
    'Spawnea un `claude` real — costo esperado del orden de 1-3 centavos.',
  ]);

  // ── Fixtures: stubs triviales de tmux/ttyd. El flujo real los exige;
  //    `startTailFollowSession` solo espera 500ms tras spawnear ttyd (no
  //    verifica HTTP), así que un `exit 0` alcanza. ─────────────────────────
  const fixtureDir = await fs.mkdtemp(join(tmpdir(), 'verify-secret-'));
  const tmuxStub = join(fixtureDir, 'tmux-stub.sh');
  const ttydStub = join(fixtureDir, 'ttyd-stub.sh');
  await fs.writeFile(tmuxStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.writeFile(ttydStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // ── Mock del ApiClient: captura todo lo que el worker postea. ─────────
  const posted: Array<{ path: string; body: unknown }> = [];
  const mockClient = {
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      return {};
    },
    get: async () => ({}),
  } as unknown as ApiClient;

  // ── ClaimedStory mínimo: sandbox mode, sin DoD, Haiku. ────────────────
  const claimed: ClaimedStory = {
    runId: `verify-${Date.now().toString(36)}`,
    storyId: 'verify-secret-story',
    storyTitle: 'Verificación de lectura de secret externo',
    storyMarkdown: null,
    epicId: 'verify-secret-epic',
    branch: 'forge/verify/secret-read',
    prompt: PROBE_PROMPT,
    repoUrl: null, // sandbox mode — sin GitHub, sin clone/push
    baseBranch: null,
    anthropicApiKey: apiKey,
    externalSecrets: [
      { name: SECRET_NAME, value: SECRET_VALUE, vendor: 'TestVendor' },
    ],
    forgeWorkerModel: 'claude-haiku-4-5',
    forgeWorkerEffort: 'low',
    dodVerifierModel: 'claude-haiku-4-5',
    dodVerifierEffort: 'low',
    dodCriteria: [], // vacío → el worker saltea el DoD loop por completo
    acceptanceCriteria: [],
    qaTestCases: [],
    technicalRequirements: [],
  };

  // Solo stubeamos tmux/ttyd. `CLAUDE_BIN` se deja sin tocar → `runStory`
  // usa el `claude` real del PATH. El sandbox se deja en su modo auto (real)
  // — así la corrida confirma también que el env sobrevive a `sandbox-exec`.
  const envBackup = new Map(
    ['TMUX_BIN', 'TTYD_BIN'].map((k) => [k, process.env[k]] as const),
  );
  process.env.TMUX_BIN = tmuxStub;
  process.env.TTYD_BIN = ttydStub;

  try {
    await runStory(mockClient, claimed);
  } finally {
    for (const [k, v] of envBackup) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }

  // ── Verificación ───────────────────────────────────────────────────────
  const complete = posted.find((p) => p.path.endsWith('/complete'));
  const lastOutput = complete
    ? ((complete.body as { lastOutput?: string }).lastOutput ?? '')
    : '';

  const probeRan = lastOutput.includes('SECRET_PROBE');
  const lenOk = lastOutput.includes(`len=${expectedLen}`);
  const headOk = lastOutput.includes(`head=${expectedHead}`);
  // Defensa: el valor crudo del secreto NUNCA debe aparecer en lo que el
  // worker postea al backend (sería una fuga a la DB / UI).
  const leaked = posted.some((p) =>
    JSON.stringify(p.body).includes(SECRET_VALUE),
  );

  const ok = Boolean(complete) && probeRan && lenOk && headOk && !leaked;

  box('verify-secret-read — resultado', [
    `/complete posteado ............. ${complete ? '✓' : '✗'}`,
    `el agente corrió el probe ...... ${probeRan ? '✓' : '✗'}`,
    `longitud correcta (${expectedLen}) ......... ${lenOk ? '✓' : '✗'}`,
    `prefijo correcto (${expectedHead}) ......... ${headOk ? '✓' : '✗'}`,
    `valor crudo NO filtrado ........ ${leaked ? '✗ FUGA' : '✓'}`,
    '',
    ok
      ? '✓ OK — el agente leyó el secreto externo desde su environment.'
      : '✗ FALLO — revisar el lastOutput de abajo para diagnosticar.',
  ]);

  console.log('  ── lastOutput capturado ─────────────────────────────────');
  console.log(
    lastOutput
      ? lastOutput
          .split('\n')
          .map((line) => `  | ${line}`)
          .join('\n')
      : '  (vacío)',
  );
  console.log('');

  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[verify-secret-read] error inesperado:', err);
    process.exit(1);
  });
