import { spawnSync } from 'child_process';
import { homedir, platform } from 'os';
import { logger } from './logger.js';

/**
 * Modos de sandbox disponibles.
 *
 *  - `sandbox-exec`: macOS native, configurable via SBPL profile (Scheme).
 *  - `firejail`: Linux, namespace + cgroup-based isolation.
 *  - `none`: sin aislamiento OS (require FACTORY_WORKER_ALLOW_NO_SANDBOX=1).
 *
 * El sandbox NO es hermético — claude necesita network (API Anthropic),
 * exec (binarios git/pnpm/node), y filesystem amplio (workdir + system
 * libs). El objetivo es proteger contra el ataque más probable: prompt
 * injection en epic.markdown que intenta leer credenciales del HOME
 * (~/.ssh/id_rsa, ~/.aws/credentials, ~/.config/gh/, etc.).
 *
 * Architecture (security-reviewer F-06 2026-05-06):
 *  - Auto-detect del modo basado en plataforma + binarios instalados
 *  - Override explícito vía FACTORY_WORKER_SANDBOX_MODE env var
 *  - Bypass requiere TANTO `FACTORY_WORKER_SANDBOX_MODE=none` (o auto si
 *    no hay sandbox) Y `FACTORY_WORKER_ALLOW_NO_SANDBOX=1` (doble opt-in)
 */
export type SandboxMode = 'sandbox-exec' | 'firejail' | 'none';

export interface SandboxedSpawn {
  bin: string;
  args: string[];
  /** Modo activo, para logging y observabilidad. */
  mode: SandboxMode;
}

/**
 * Paths del HOME que NUNCA deben ser legibles por claude — la lista cubre
 * los lugares más comunes donde un atacante busca credenciales del worker
 * host. Se aplica como deny rule en sandbox-exec y firejail.
 */
function sensitiveHomePaths(): string[] {
  const home = homedir();
  return [
    `${home}/.ssh`,
    `${home}/.aws`,
    `${home}/.config/gh`, // GitHub CLI auth
    `${home}/.config/gcloud`, // Google Cloud SDK
    `${home}/.kube`, // Kubernetes config
    `${home}/.gnupg`, // GPG keys
    `${home}/.netrc`, // Generic HTTP creds
    `${home}/.docker`, // Docker registry creds
    `${home}/.npmrc`, // npm publish tokens (auth value en npmrc)
    `${home}/.cargo/credentials`, // crates.io
    `${home}/.pypirc`, // PyPI
    `${home}/.terraformrc`, // Terraform
  ];
}

/**
 * Verifica si un binario existe en el PATH. Usa `command -v` que es más
 * portable que `which` (POSIX standard, disponible en Linux y macOS).
 */
function isInstalled(bin: string): boolean {
  try {
    const result = spawnSync('command', ['-v', bin], {
      stdio: 'ignore',
      shell: '/bin/sh',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Decide el modo basándose en env override + plataforma + binarios.
 * Logs una sola línea informativa al detectar.
 */
function detectMode(): SandboxMode {
  const envOverride = process.env.FACTORY_WORKER_SANDBOX_MODE;
  if (envOverride === 'sandbox-exec' || envOverride === 'firejail' || envOverride === 'none') {
    logger.info(
      { event: 'sandbox.mode', mode: envOverride, source: 'env_override' },
      `Worker sandbox mode = ${envOverride} (FACTORY_WORKER_SANDBOX_MODE override)`,
    );
    return envOverride;
  }

  const os = platform();
  if (os === 'darwin' && isInstalled('sandbox-exec')) {
    logger.info(
      { event: 'sandbox.mode', mode: 'sandbox-exec', source: 'auto_detect', platform: 'darwin' },
      'Worker sandbox mode = sandbox-exec (macOS native)',
    );
    return 'sandbox-exec';
  }
  if (os === 'linux' && isInstalled('firejail')) {
    logger.info(
      { event: 'sandbox.mode', mode: 'firejail', source: 'auto_detect', platform: 'linux' },
      'Worker sandbox mode = firejail (Linux)',
    );
    return 'firejail';
  }

  logger.warn(
    { event: 'sandbox.mode', mode: 'none', source: 'auto_detect', platform: os },
    `No sandbox tool detected on ${os}. Set FACTORY_WORKER_ALLOW_NO_SANDBOX=1 to allow unsandboxed spawn (NOT recommended for production).`,
  );
  return 'none';
}

/**
 * Construye un perfil SBPL (Scheme-like) para `sandbox-exec -p`. Estrategia
 * deny-list: parte de "allow default" para no romper utilidades del worker
 * (git, pnpm, node), y solo deniega R/W a los paths sensibles del HOME.
 *
 * NOTA: el profile se pasa inline por argv. macOS limita argv a ~256KB
 * pero la lista cabe holgadamente (~1KB).
 */
function buildSandboxExecProfile(): string {
  const denyPaths = sensitiveHomePaths();
  const denyReads = denyPaths.map((p) => `  (subpath "${p}")`).join('\n');
  const denyWrites = denyPaths.map((p) => `  (subpath "${p}")`).join('\n');
  return [
    `(version 1)`,
    `(allow default)`,
    `(deny file-read*`,
    denyReads,
    `)`,
    `(deny file-write*`,
    denyWrites,
    `)`,
  ].join('\n');
}

/**
 * Envuelve un comando con la capa de sandbox apropiada para la plataforma.
 *
 * @param bin    Binario a ejecutar (e.g. 'claude').
 * @param args   Argumentos del binario.
 * @param workdir cwd del proceso (usado para logging; el sandbox confía
 *                en el cwd del spawn de Node, no lo restringe explícitamente).
 *
 * @returns `{ bin, args, mode }` listo para `spawn()`.
 *
 * @throws Error si modo='none' y FACTORY_WORKER_ALLOW_NO_SANDBOX != '1'.
 */
export function wrapWithSandbox(
  bin: string,
  args: string[],
  workdir: string,
): SandboxedSpawn {
  const mode = detectMode();

  switch (mode) {
    case 'sandbox-exec': {
      const profile = buildSandboxExecProfile();
      return {
        bin: 'sandbox-exec',
        args: ['-p', profile, bin, ...args],
        mode,
      };
    }
    case 'firejail': {
      const blacklists = sensitiveHomePaths().map((p) => `--blacklist=${p}`);
      return {
        bin: 'firejail',
        args: [
          '--quiet',
          '--private-tmp',
          ...blacklists,
          '--',
          bin,
          ...args,
        ],
        mode,
      };
    }
    case 'none': {
      const allowed = process.env.FACTORY_WORKER_ALLOW_NO_SANDBOX === '1';
      if (!allowed) {
        throw new Error(
          `No sandbox available on ${platform()} and FACTORY_WORKER_ALLOW_NO_SANDBOX is not '1'. ` +
            `Install sandbox-exec (macOS, default) or firejail (Linux: 'apt install firejail'), ` +
            `or set FACTORY_WORKER_ALLOW_NO_SANDBOX=1 to bypass. NEVER bypass in production — ` +
            `a malicious epic.markdown can exfiltrate worker host credentials via prompt injection.`,
        );
      }
      logger.warn(
        { event: 'sandbox.bypassed', workdir },
        '⚠️  Worker running WITHOUT SANDBOX (FACTORY_WORKER_ALLOW_NO_SANDBOX=1). Prompt injection can read worker host credentials. NEVER use in production.',
      );
      return { bin, args, mode };
    }
  }
}
