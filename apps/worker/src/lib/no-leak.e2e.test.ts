// ════════════════════════════════════════════════════════════════════════
// no-leak.e2e.test.ts — test E2E de no-fuga de secretos externos
// ════════════════════════════════════════════════════════════════════════
//
// Corre el flujo REAL del worker (`runStory`) con un secreto externo
// inyectado y un `claude` stub que lo FILTRA a stderr a propósito. Verifica
// que el valor crudo del secreto nunca llega al backend (lo que terminaría
// en `agent_runs.lastOutput` → DB → iframe de la UI).
//
// Cómo se mantiene determinístico, sin gastar tokens ni depender del entorno:
//  - `CLAUDE_BIN` → un script stub que lee el secreto de su propio env (que
//    el worker le inyecta vía `buildSecretEnv`) y lo escribe a stderr.
//  - `TMUX_BIN`/`TTYD_BIN` → stubs triviales `exit 0`. `startTailFollowSession`
//    solo espera 500ms tras spawnear ttyd — NO verifica que sirva HTTP — así
//    que un stub que sale 0 alcanza para correr el `tmux-ttyd.ts` real.
//  - `dodCriteria: []` → el worker saltea el DoD loop por completo (cero
//    spawns del verifier).
//  - sandbox mode (`repoUrl: null`) → sin clone ni push, sin git.
//  - `FACTORY_WORKER_SANDBOX_MODE=none` + `FACTORY_WORKER_ALLOW_NO_SANDBOX=1`
//    → bypass del sandbox-exec/firejail (doble opt-in) para el stub.
//  - un `ApiClient` mock captura todo lo que el worker postea.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ClaimedStory } from '@cenzontle/shared';
import { runStory } from './runner.js';
import type { ApiClient } from './api-client.js';

// Valor del secreto que el stub va a filtrar. Formato ARBITRARIO, sin prefijo
// reconocible — los patrones de redacción por prefijo NO lo atrapan, así que
// solo la redacción POR VALOR EXACTO puede hacerlo. Eso es justo lo que el
// feature agrega para secretos de terceros (Amadeus/Twilio/etc.).
const SECRET_NAME = 'AMADEUS_API_SECRET';
const SECRET_VALUE = 'arbitrary-format-secret-no-prefix-7h3x9q2w5';

test('E2E no-fuga: un secreto externo nunca llega crudo al backend', async () => {
  // ── 1. Binarios stub ────────────────────────────────────────────────────
  const fixtureDir = await fs.mkdtemp(join(tmpdir(), 'no-leak-e2e-'));
  const claudeStub = join(fixtureDir, 'claude-stub.sh');
  const tmuxStub = join(fixtureDir, 'tmux-stub.sh');
  const ttydStub = join(fixtureDir, 'ttyd-stub.sh');

  // El stub de `claude` lee el secreto de SU PROPIO env (lo inyecta el worker
  // vía `buildSecretEnv`) y lo escribe a stderr — el peor caso de fuga. El
  // marcador `STUB-CLAUDE-RAN` prueba que el spawn efectivamente corrió.
  //
  // El `sleep 1` no es cosmético: el worker escribe el log file de forma
  // async (`fs.appendFile` fire-and-forget) y luego lo RELEE con
  // `readOutputTail`. Un `claude` real corre segundos y esos writes se
  // asientan solos; este stub es instantáneo, así que esperamos a que el
  // append aterrice antes de que el stub salga y el worker lea el archivo.
  // 1s es margen amplio (el append son ~60 bytes) — robusto bajo carga.
  await fs.writeFile(
    claudeStub,
    `#!/bin/sh\necho "STUB-CLAUDE-RAN leak=$${SECRET_NAME}" >&2\nsleep 1\nexit 0\n`,
    { mode: 0o755 },
  );
  await fs.writeFile(tmuxStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.writeFile(ttydStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // ── 2. Mock del ApiClient — captura todo lo que el worker postea ────────
  const posted: Array<{ path: string; body: unknown }> = [];
  const mockClient = {
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      return {};
    },
    get: async () => ({}),
  } as unknown as ApiClient;

  // ── 3. ClaimedStory en sandbox mode con un secreto externo ─────────────
  const runId = `e2e-${Date.now().toString(36)}`;
  const claimed: ClaimedStory = {
    runId,
    storyId: 'e2e-story',
    storyTitle: 'E2E no-leak test story',
    storyMarkdown: null,
    epicId: 'e2e-epic',
    branch: 'forge/e2e/no-leak',
    // Prompt >= 100 chars — el worker rechaza prompts triviales.
    prompt: 'Implementá la historia de prueba E2E del worker. '.repeat(8),
    repoUrl: null, // sandbox mode — sin clone ni push
    baseBranch: null,
    anthropicApiKey: 'sk-ant-e2e-dummy-key-not-real-000000',
    externalSecrets: [
      { name: SECRET_NAME, value: SECRET_VALUE, vendor: 'Amadeus' },
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

  // ── 4. Env: stubs + bypass del sandbox (doble opt-in) ──────────────────
  const envKeys = [
    'CLAUDE_BIN',
    'TMUX_BIN',
    'TTYD_BIN',
    'FACTORY_WORKER_SANDBOX_MODE',
    'FACTORY_WORKER_ALLOW_NO_SANDBOX',
  ];
  const envBackup = new Map(envKeys.map((k) => [k, process.env[k]]));
  process.env.CLAUDE_BIN = claudeStub;
  process.env.TMUX_BIN = tmuxStub;
  process.env.TTYD_BIN = ttydStub;
  process.env.FACTORY_WORKER_SANDBOX_MODE = 'none';
  process.env.FACTORY_WORKER_ALLOW_NO_SANDBOX = '1';

  try {
    // ── 5. Correr el flujo REAL del worker ───────────────────────────────
    await runStory(mockClient, claimed);
  } finally {
    for (const [k, v] of envBackup) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }

  // ── 6. Aserciones ───────────────────────────────────────────────────────
  const complete = posted.find((p) => p.path.endsWith('/complete'));
  assert.ok(complete, 'el worker debió postear /complete');

  const lastOutput =
    (complete.body as { lastOutput?: string }).lastOutput ?? '';

  // El stub corrió → confirma que el flujo llegó al spawn de `claude`.
  assert.ok(
    lastOutput.includes('STUB-CLAUDE-RAN'),
    'el output del stub debió capturarse — confirma que el spawn corrió',
  );
  // El valor se redactó. Esto prueba la cadena completa: si el env NO se
  // hubiera inyectado, el stub habría escrito un valor vacío y no habría
  // nada que redactar → sin `[REDACTED]`.
  assert.ok(
    lastOutput.includes('[REDACTED]'),
    'el valor del secreto debió redactarse a [REDACTED]',
  );
  // CRÍTICO: el valor crudo NUNCA aparece en NADA de lo que se postea al
  // backend (ni /progress ni /complete) — es lo que termina en la DB/UI.
  // `outputBuffer` y el log file se escriben con la MISMA cadena redactada
  // (`appendFormattedToLog`), así que esto también prueba el log file.
  for (const p of posted) {
    assert.ok(
      !JSON.stringify(p.body).includes(SECRET_VALUE),
      `el valor crudo del secreto se filtró en POST ${p.path}`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════════
// Segundo E2E: el escaneo pre-push (git mode). Si el agente HARDCODEA el
// valor de un secreto en un archivo commiteado (en vez de leerlo de
// `process.env`), el worker debe ABORTAR el push — la redacción del output
// no cubre el contenido de los archivos. Usa un repo `bare` local (`file://`)
// como remote: determinístico, sin red.
// ════════════════════════════════════════════════════════════════════════
test('E2E pre-push scan: aborta el push si el agente commitea un secreto', async () => {
  const fixtureDir = await fs.mkdtemp(join(tmpdir(), 'no-leak-git-e2e-'));
  const bareDir = join(fixtureDir, 'remote.git');
  const seedDir = join(fixtureDir, 'seed');
  const claudeStub = join(fixtureDir, 'claude-stub.sh');
  const tmuxStub = join(fixtureDir, 'tmux-stub.sh');
  const ttydStub = join(fixtureDir, 'ttyd-stub.sh');

  // ── 1. Repo remoto `bare` con un commit inicial en `main` ───────────────
  const runGit = (args: string[], cwd: string) =>
    execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  execFileSync('git', ['init', '--bare', '-b', 'main', bareDir], {
    stdio: 'pipe',
  });
  await fs.mkdir(seedDir);
  runGit(['init', '-b', 'main'], seedDir);
  runGit(['config', 'user.email', 'seed@test.local'], seedDir);
  runGit(['config', 'user.name', 'Seed'], seedDir);
  await fs.writeFile(join(seedDir, 'README.md'), '# repo base\n');
  runGit(['add', '-A'], seedDir);
  runGit(['commit', '-m', 'commit base'], seedDir);
  runGit(['push', bareDir, 'main'], seedDir);

  // ── 2. Stub `claude`: HARDCODEA el secreto en un archivo source ─────────
  // El peor caso que el escaneo pre-push debe atrapar.
  await fs.writeFile(
    claudeStub,
    `#!/bin/sh\necho "const apiKey = \\"$${SECRET_NAME}\\";" > leaked-config.ts\nexit 0\n`,
    { mode: 0o755 },
  );
  await fs.writeFile(tmuxStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.writeFile(ttydStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // ── 3. Mock ApiClient + ClaimedStory en git mode ───────────────────────
  const posted: Array<{ path: string; body: unknown }> = [];
  const mockClient = {
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      return {};
    },
    get: async () => ({}),
  } as unknown as ApiClient;

  const runId = `e2e-git-${Date.now().toString(36)}`;
  const claimed: ClaimedStory = {
    runId,
    storyId: 'e2e-git-story',
    storyTitle: 'E2E pre-push scan story',
    storyMarkdown: null,
    epicId: 'e2e-epic',
    branch: 'forge/e2e/leak-branch',
    prompt: 'Implementá la historia de prueba E2E del worker. '.repeat(8),
    repoUrl: `file://${bareDir}`,
    baseBranch: 'main',
    anthropicApiKey: 'sk-ant-e2e-dummy-key-not-real-000000',
    externalSecrets: [
      { name: SECRET_NAME, value: SECRET_VALUE, vendor: 'Amadeus' },
    ],
    forgeWorkerModel: 'claude-haiku-4-5',
    forgeWorkerEffort: 'low',
    dodVerifierModel: 'claude-haiku-4-5',
    dodVerifierEffort: 'low',
    dodCriteria: [],
    acceptanceCriteria: [],
    qaTestCases: [],
    technicalRequirements: [],
  };

  const envKeys = [
    'CLAUDE_BIN',
    'TMUX_BIN',
    'TTYD_BIN',
    'FACTORY_WORKER_SANDBOX_MODE',
    'FACTORY_WORKER_ALLOW_NO_SANDBOX',
  ];
  const envBackup = new Map(envKeys.map((k) => [k, process.env[k]]));
  process.env.CLAUDE_BIN = claudeStub;
  process.env.TMUX_BIN = tmuxStub;
  process.env.TTYD_BIN = ttydStub;
  process.env.FACTORY_WORKER_SANDBOX_MODE = 'none';
  process.env.FACTORY_WORKER_ALLOW_NO_SANDBOX = '1';

  try {
    await runStory(mockClient, claimed);
  } finally {
    for (const [k, v] of envBackup) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }

  // ── 4. Aserciones ───────────────────────────────────────────────────────
  const complete = posted.find((p) => p.path.endsWith('/complete'));
  assert.ok(complete, 'el worker debió postear /complete');
  const body = complete.body as {
    prBranchPushed?: boolean;
    errorMessage?: string;
  };
  // El push fue ABORTADO por el escaneo — el branch nunca llegó al remote.
  assert.equal(body.prBranchPushed, false, 'el branch NO debió pushearse');
  assert.match(
    body.errorMessage ?? '',
    /secret scan abort/i,
    'el errorMessage debió indicar el abort del escaneo pre-push',
  );
  // El valor crudo del secreto nunca aparece en ningún POST.
  for (const p of posted) {
    assert.ok(
      !JSON.stringify(p.body).includes(SECRET_VALUE),
      `el valor crudo del secreto se filtró en POST ${p.path}`,
    );
  }
});
