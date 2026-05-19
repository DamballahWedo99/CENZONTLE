import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface GlobOpts {
  subDir?: string;
  maxResults?: number;
}

export interface GlobResult {
  filenames: string[];
  numFiles: number;
  truncated: boolean;
  durationMs: number;
}

/**
 * Resultado de búsqueda sobre múltiples repos (Opción C — modo "todos los enabled").
 * Cada match incluye el nombre del repo para que el agente sepa de dónde vino.
 */
export interface MultiGlobResult {
  matches: Array<{ repository: string; file: string }>;
  numFiles: number;
  truncated: boolean;
  durationMs: number;
  repositoriesSearched: string[];
}

export interface MultiGrepResult {
  matches: Array<{ repository: string; file: string; line?: number; content: string }>;
  files?: Array<{ repository: string; file: string }>;
  counts?: Array<{ repository: string; file: string; count: number }>;
  totalMatches: number;
  truncated: boolean;
  durationMs: number;
  repositoriesSearched: string[];
}

export interface GrepOpts {
  path?: string;
  glob?: string;
  type?: string;
  outputMode?: 'content' | 'files_with_matches' | 'count';
  before?: number;
  after?: number;
  context?: number;
  lineNumbers?: boolean;
  caseInsensitive?: boolean;
  multiline?: boolean;
  headLimit?: number;
  offset?: number;
}

export interface GrepResult {
  matches: Array<{ file: string; line?: number; content: string }>;
  files?: string[];
  counts?: Array<{ file: string; count: number }>;
  totalMatches: number;
  truncated: boolean;
  durationMs: number;
}

export interface ReadOpts {
  /** 1-indexed. */
  offset?: number;
  limit?: number;
}

export interface ReadResult {
  path: string;
  content: string;
  totalLines: number;
  truncated: boolean;
}

/**
 * Motor compartido por las 3 tools Glob/Grep/Read.
 *
 * - Shell-out a `rg` (ripgrep) vía child_process.spawn (sin shell=true → sin injection).
 * - resolveSafePath() asegura que cualquier path del agente queda dentro del repoPath.
 *   Sin esto, el agente podría leer /etc/passwd con un code_read malicioso.
 * - Excluye directorios típicos heavy (node_modules, dist, .next, .git...) para que
 *   el agente no reciba miles de matches irrelevantes en cada búsqueda.
 */
@Injectable()
export class CodeSearchService implements OnModuleInit {
  private readonly maxBytesPerFile: number;
  private readonly grepTimeoutMs: number;

  private static readonly EXCLUDE_GLOBS = [
    '!node_modules',
    '!.next',
    '!dist',
    '!build',
    '!**/.git',
    '!**/.git/**',
    '!**/.svn',
    '!**/.svn/**',
    '!**/.hg',
    '!**/.hg/**',
    '!**/.ssh',
    '!**/.ssh/**',
    '!**/.aws',
    '!**/.aws/**',
    '!**/.docker',
    '!**/.docker/**',
    '!.turbo',
    '!.vercel',
    '!coverage',
    '!**/.env',
    '!**/.env.*',
    '!**/.gitmodules',
    '!**/.npmrc',
    '!**/.yarnrc',
    '!**/.yarnrc.yml',
    '!**/.netrc',
    '!**/_netrc',
    '!**/id_rsa',
    '!**/id_dsa',
    '!**/id_ecdsa',
    '!**/id_ed25519',
    '!**/.pypirc',
    '!**/.dockercfg',
    '!**/*.pem',
    '!**/*.key',
    '!**/*.p12',
    '!**/*.pfx',
    '!**/*.crt',
    '!**/*.cer',
  ];

  /**
   * Defense-in-depth: directorios que contienen metadatos de VCS, credenciales SSH
   * o config interna del cloud.
   *
   * - `.git`, `.svn`, `.hg`: metadatos de VCS. `.git/config` puede contener URLs de
   *   remotes con PATs embebidos; `.git/packed-refs` expone refs internas.
   * - `.ssh`: claves privadas y `authorized_keys` / `known_hosts`.
   * - `.aws`: `credentials` con access keys + `config` con role ARNs.
   * - `.docker`: `config.json` con auth tokens para registries privados.
   *
   * Se aplica a cualquier segmento del path (no solo prefix) para capturar casos
   * como `monorepo/frontend/.git/config` o `homedir/.ssh/id_rsa`.
   */
  private static readonly FORBIDDEN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
    '.git',
    '.svn',
    '.hg',
    '.ssh',
    '.aws',
    '.docker',
  ]);

  /**
   * Archivos de entorno que typically contienen secrets (DB passwords, API keys, JWTs).
   * Check es por prefix porque existen variantes `.env.local`, `.env.production`,
   * `.env.development.local`, etc.
   */
  private static readonly FORBIDDEN_FILE_PREFIXES: readonly string[] = ['.env'];

  /**
   * Archivos que por nombre exacto contienen secrets o tokens:
   *
   * - `.gitmodules`: URLs de submódulos (pueden incluir tokens inline).
   * - `.npmrc`, `.yarnrc`, `.yarnrc.yml`: auth tokens de registries (NPM, Yarn).
   * - `.netrc`, `_netrc`: credenciales HTTP legacy (login + password).
   * - `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`: llaves SSH privadas.
   * - `.pypirc`: credenciales para PyPI publish.
   * - `.dockercfg`: legacy Docker auth (anterior a ~/.docker/config.json).
   *
   * Match es contra el basename lowercased. Check exacto (no prefix) para evitar
   * falsos positivos en nombres legítimos que coincidan parcialmente.
   */
  private static readonly FORBIDDEN_FILENAMES: ReadonlySet<string> = new Set([
    '.gitmodules',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    '.netrc',
    '_netrc',
    'id_rsa',
    'id_dsa',
    'id_ecdsa',
    'id_ed25519',
    '.pypirc',
    '.dockercfg',
  ]);

  /**
   * Extensiones asociadas a material criptográfico privado o certificados:
   *
   * - `.pem`, `.key`: llaves privadas (RSA, EC, etc.) en formato PEM.
   * - `.p12`, `.pfx`: PKCS#12 bundles (llave + cert + cadena).
   * - `.crt`, `.cer`: certificados X.509 (a menudo acompañan a llaves privadas).
   *
   * Match por extensión (lowercased). Aunque `.crt`/`.cer` suelen ser públicos,
   * los bloqueamos defensivamente: si el agente necesita un cert público para
   * análisis, debe hacerlo fuera de este tool.
   */
  private static readonly FORBIDDEN_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
    '.pem',
    '.key',
    '.p12',
    '.pfx',
    '.crt',
    '.cer',
  ]);

  constructor(private readonly config: ConfigService,
    @InjectPinoLogger(CodeSearchService.name) private readonly logger: PinoLogger,
  ) {
    // Coerción explícita: env vars llegan como string incluso cuando el generic
    // dice <number>. spawn() rechaza strings para su opción timeout.
    this.maxBytesPerFile = Number(this.config.get('CODE_REPOS_MAX_BYTES_PER_FILE')) || 262144;
    this.grepTimeoutMs = Number(this.config.get('CODE_REPOS_GREP_TIMEOUT_MS')) || 8000;
  }

  async onModuleInit() {
    // Health check: verificar que ripgrep está en el PATH.
    // Distinguimos entre "rg no instalado" (ENOENT) y otros errores de spawn
    // para no mentir en el log si el problema es distinto.
    try {
      await this.spawnRg(['--version'], '/tmp');
      this.logger.info('ripgrep binary found on PATH');
    } catch (err: any) {
      const isNotFound = err?.code === 'ENOENT' || /ENOENT/.test(err?.message ?? '');
      if (isNotFound) {
        this.logger.error(
          `ripgrep (rg) NOT found on PATH. Code search tools will fail. Install via: brew install ripgrep OR apt-get install ripgrep.`,
        );
      } else {
        this.logger.error(
          `ripgrep health check failed (rg probably IS installed but spawn failed). Error: ${err?.message}`,
        );
      }
    }
  }

  async glob(repoPath: string, pattern: string, opts: GlobOpts = {}): Promise<GlobResult> {
    const start = Date.now();
    // Defense-in-depth: bloquea subDir que apunte a VCS metadata antes de spawn.
    if (opts.subDir) {
      this.assertNotForbidden(opts.subDir);
    }
    // Resolve symlinks on the repo root (CWE-59 mitigation). macOS canonicalizes
    // /tmp → /private/tmp, so comparing `real.startsWith(path.resolve(...))` fails
    // and every file would be discarded as "escapes repo". We compute both forms
    // and accept either prefix.
    const absRepo = path.resolve(repoPath);
    const realRepo = await fs.realpath(absRepo).catch(() => absRepo);
    const targetDir = opts.subDir ? this.resolveSafePath(repoPath, opts.subDir) : absRepo;
    const maxResults = Math.min(opts.maxResults ?? 100, 500);

    // `--no-follow` explicit — ripgrep default ya es no-follow, pero declararlo
    // evita que un cambio futuro de flags upstream nos exponga a CWE-59.
    const args = [
      '--files',
      '--hidden',
      '--no-follow',
      '--no-messages',
      '--glob',
      pattern,
      ...CodeSearchService.EXCLUDE_GLOBS.flatMap((g) => ['--glob', g]),
    ];

    const stdout = await this.spawnRg(args, targetDir).catch((err: any) => {
      if (err?.code === 1) return ''; // no matches
      throw err;
    });

    // Post-filter string-level: cinturón-y-tirantes frente a EXCLUDE_GLOBS. Si
    // un pattern futuro se malinterpreta o queda ineficaz en alguna versión de
    // ripgrep, este filtro garantiza que nunca se devuelvan paths prohibidos
    // por nombre al agente.
    const stringFiltered = stdout
      .split('\n')
      .filter(Boolean)
      .filter((f) => !this.isForbiddenPath(f));

    // Post-filter realpath-level (CWE-59): descarta entradas cuyo target real
    // escape del repo o apunte a una ubicación prohibida. Se hace sobre el
    // primer slice + extras para manejar truncation correcto: filtrar después
    // del slice infla numFiles con entradas que luego descartamos; filtrar
    // antes es caro si hay miles de matches. Como maxResults<=500, filtrar
    // todos los candidatos es aceptable — pero cap antes a un orden razonable.
    const realpathCandidates = stringFiltered.slice(0, Math.min(maxResults * 2, 1000));
    const realpathChecked = await Promise.all(
      realpathCandidates.map(async (f) => {
        try {
          const abs = path.join(targetDir, f);
          const real = await fs.realpath(abs);
          // Accept containment against either the resolved (realRepo) OR the
          // original (absRepo) repo root. macOS /tmp → /private/tmp means the
          // resolved file path will share a prefix with realRepo but not with
          // absRepo; on other OSes both forms are equal.
          const containedInReal = real === realRepo || real.startsWith(realRepo + path.sep);
          const containedInAbs = real === absRepo || real.startsWith(absRepo + path.sep);
          if (!containedInReal && !containedInAbs) {
            return null; // escapa del repo
          }
          const rootForRelative = containedInReal ? realRepo : absRepo;
          if (this.isForbiddenPath(path.relative(rootForRelative, real))) {
            return null; // symlink a ubicación prohibida
          }
          return f;
        } catch {
          // ENOENT / ELOOP / EACCES → descartar silenciosamente; nunca revelar
          // al agente un file que no podemos validar.
          return null;
        }
      }),
    );
    const allFiles = realpathChecked.filter((f): f is string => f !== null);
    const truncated = allFiles.length > maxResults || stringFiltered.length > realpathCandidates.length;
    const head = allFiles.slice(0, maxResults);

    // Sort by mtime DESC (most recent first)
    const withStats = await Promise.all(
      head.map(async (f) => {
        try {
          const stat = await fs.stat(path.join(targetDir, f));
          return { f, mtime: stat.mtimeMs };
        } catch {
          return { f, mtime: 0 };
        }
      }),
    );
    withStats.sort((a, b) => b.mtime - a.mtime);

    return {
      filenames: withStats.map((w) => w.f),
      numFiles: allFiles.length,
      truncated,
      durationMs: Date.now() - start,
    };
  }

  async grep(repoPath: string, pattern: string, opts: GrepOpts = {}): Promise<GrepResult> {
    const start = Date.now();
    // Defense-in-depth: bloquea scoping a VCS metadata antes de spawn.
    if (opts.path) {
      this.assertNotForbidden(opts.path);
    }
    // See glob() for rationale — resolve symlinks on the repo root so the
    // containment check works on macOS (/tmp → /private/tmp).
    const absRepo = path.resolve(repoPath);
    const realRepo = await fs.realpath(absRepo).catch(() => absRepo);
    const targetDir = opts.path ? this.resolveSafePath(repoPath, opts.path) : absRepo;
    const mode = opts.outputMode ?? 'files_with_matches';
    const headLimit = opts.headLimit ?? 250;
    const offset = opts.offset ?? 0;

    // `--no-follow` explicit (CWE-59): ripgrep default no sigue symlinks, pero
    // lo declaramos para blindar contra cambios upstream.
    const args: string[] = [
      '--hidden',
      '--no-follow',
      '--no-messages',
      '--max-columns',
      '500',
    ];
    if (opts.caseInsensitive) args.push('-i');
    if (opts.multiline) args.push('-U', '--multiline-dotall');
    if (opts.glob) args.push('--glob', opts.glob);
    if (opts.type) args.push('--type', opts.type);
    for (const g of CodeSearchService.EXCLUDE_GLOBS) args.push('--glob', g);

    if (mode === 'files_with_matches') args.push('-l');
    else if (mode === 'count') args.push('-c');
    else {
      if (opts.before !== undefined) args.push('-B', String(opts.before));
      if (opts.after !== undefined) args.push('-A', String(opts.after));
      if (opts.context !== undefined) args.push('-C', String(opts.context));
      if (opts.lineNumbers !== false) args.push('-n');
    }

    // `-e` para que patterns que empiezan con '-' no se interpreten como flags
    args.push('-e', pattern);
    args.push('.');

    const stdout = await this.spawnRg(args, targetDir).catch((err: any) => {
      if (err?.code === 1) return ''; // no matches
      throw err;
    });

    // Post-filter string-level: cinturón-y-tirantes frente a EXCLUDE_GLOBS. Cada
    // modo tiene formato distinto — extraemos el path de cada línea antes.
    const stringFiltered = stdout.split('\n').filter(Boolean).filter((line) => {
      const filePath = this.extractFilePathFromGrepLine(line, mode);
      return filePath === null || !this.isForbiddenPath(filePath);
    });

    // Post-filter realpath-level (CWE-59): aunque ripgrep no sigue symlinks con
    // --no-follow, un archivo regular cuyo PADRE sea un symlink sí aparecerá
    // si el symlink está dentro del repo. Validar que el target real del
    // archivo reportado no escape del repo ni apunte a ubicación prohibida.
    // Cache por path: el mismo file puede aparecer varias veces en content mode.
    const realpathCache = new Map<string, boolean>();
    const checkPath = async (filePath: string): Promise<boolean> => {
      if (realpathCache.has(filePath)) return realpathCache.get(filePath)!;
      try {
        const abs = path.resolve(targetDir, filePath);
        const real = await fs.realpath(abs);
        // Accept containment against either realRepo or absRepo (macOS /tmp
        // quirk). Compute relative path against the matching root.
        const containedInReal = real === realRepo || real.startsWith(realRepo + path.sep);
        const containedInAbs = real === absRepo || real.startsWith(absRepo + path.sep);
        if (!containedInReal && !containedInAbs) {
          realpathCache.set(filePath, false);
          return false;
        }
        const rootForRelative = containedInReal ? realRepo : absRepo;
        const ok = !this.isForbiddenPath(path.relative(rootForRelative, real));
        realpathCache.set(filePath, ok);
        return ok;
      } catch {
        realpathCache.set(filePath, false);
        return false;
      }
    };

    const realpathChecked = await Promise.all(
      stringFiltered.map(async (line) => {
        const filePath = this.extractFilePathFromGrepLine(line, mode);
        if (filePath === null) return line; // no pudo parsear → preservar
        const ok = await checkPath(filePath);
        return ok ? line : null;
      }),
    );
    const allLines = realpathChecked.filter((l): l is string => l !== null);
    const sliced = allLines.slice(offset, offset + headLimit);
    const truncated = allLines.length > offset + headLimit;

    if (mode === 'files_with_matches') {
      return {
        matches: [],
        files: sliced,
        totalMatches: allLines.length,
        truncated,
        durationMs: Date.now() - start,
      };
    }
    if (mode === 'count') {
      const counts = sliced.map((line) => {
        const idx = line.lastIndexOf(':');
        return { file: line.slice(0, idx), count: parseInt(line.slice(idx + 1), 10) || 0 };
      });
      return {
        matches: [],
        counts,
        totalMatches: allLines.length,
        truncated,
        durationMs: Date.now() - start,
      };
    }
    // content mode: cada línea es "path:lineNum:content" cuando -n está activo
    const matches = sliced.map((line) => {
      const parts = line.split(':');
      const file = parts[0];
      const lineNum = parseInt(parts[1], 10);
      const hasLineNum = Number.isFinite(lineNum);
      const content = hasLineNum ? parts.slice(2).join(':') : parts.slice(1).join(':');
      return { file, line: hasLineNum ? lineNum : undefined, content };
    });
    return {
      matches,
      totalMatches: allLines.length,
      truncated,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Fan-out: ejecuta glob sobre múltiples repos en paralelo y merge los resultados
   * con atribución de repo. Cappea per-repo para evitar context explosion.
   */
  async globAll(
    repos: Array<{ name: string; absolutePath: string }>,
    pattern: string,
    opts: GlobOpts = {},
  ): Promise<MultiGlobResult> {
    const start = Date.now();
    if (repos.length === 0) {
      return { matches: [], numFiles: 0, truncated: false, durationMs: 0, repositoriesSearched: [] };
    }
    const globalMax = Math.min(opts.maxResults ?? 100, 500);
    const perRepoMax = Math.max(5, Math.ceil(globalMax / repos.length));

    const results = await Promise.all(
      repos.map(async (r) => {
        try {
          const res = await this.glob(r.absolutePath, pattern, { ...opts, maxResults: perRepoMax });
          return { repo: r.name, result: res };
        } catch {
          return { repo: r.name, result: { filenames: [] as string[], numFiles: 0, truncated: false, durationMs: 0 } };
        }
      }),
    );

    const matches = results.flatMap(({ repo, result }) =>
      result.filenames.map((file) => ({ repository: repo, file })),
    );
    const numFiles = results.reduce((sum, r) => sum + r.result.numFiles, 0);
    const truncated = numFiles > matches.length;

    return {
      matches,
      numFiles,
      truncated,
      durationMs: Date.now() - start,
      repositoriesSearched: repos.map((r) => r.name),
    };
  }

  /**
   * Fan-out: ejecuta grep sobre múltiples repos en paralelo y merge los resultados
   * con atribución de repo. Cappea per-repo para evitar context explosion.
   */
  async grepAll(
    repos: Array<{ name: string; absolutePath: string }>,
    pattern: string,
    opts: GrepOpts = {},
  ): Promise<MultiGrepResult> {
    const start = Date.now();
    if (repos.length === 0) {
      return {
        matches: [],
        totalMatches: 0,
        truncated: false,
        durationMs: 0,
        repositoriesSearched: [],
      };
    }
    const mode = opts.outputMode ?? 'files_with_matches';
    const globalLimit = opts.headLimit ?? 250;
    const perRepoLimit = Math.max(10, Math.ceil(globalLimit / repos.length));

    const results = await Promise.all(
      repos.map(async (r) => {
        try {
          const res = await this.grep(r.absolutePath, pattern, { ...opts, headLimit: perRepoLimit, offset: 0 });
          return { repo: r.name, result: res };
        } catch {
          return {
            repo: r.name,
            result: { matches: [], totalMatches: 0, truncated: false, durationMs: 0 } as GrepResult,
          };
        }
      }),
    );

    const totalMatches = results.reduce((sum, r) => sum + r.result.totalMatches, 0);
    const anyTruncated = results.some((r) => r.result.truncated);

    if (mode === 'files_with_matches') {
      const files = results.flatMap(({ repo, result }) =>
        (result.files ?? []).map((file) => ({ repository: repo, file })),
      );
      return {
        matches: [],
        files,
        totalMatches,
        truncated: anyTruncated,
        durationMs: Date.now() - start,
        repositoriesSearched: repos.map((r) => r.name),
      };
    }
    if (mode === 'count') {
      const counts = results.flatMap(({ repo, result }) =>
        (result.counts ?? []).map((c) => ({ repository: repo, file: c.file, count: c.count })),
      );
      return {
        matches: [],
        counts,
        totalMatches,
        truncated: anyTruncated,
        durationMs: Date.now() - start,
        repositoriesSearched: repos.map((r) => r.name),
      };
    }
    // content mode
    const matches = results.flatMap(({ repo, result }) =>
      result.matches.map((m) => ({ repository: repo, file: m.file, line: m.line, content: m.content })),
    );
    return {
      matches,
      totalMatches,
      truncated: anyTruncated,
      durationMs: Date.now() - start,
      repositoriesSearched: repos.map((r) => r.name),
    };
  }

  async read(repoPath: string, relativeFilePath: string, opts: ReadOpts = {}): Promise<ReadResult> {
    // Defense-in-depth: resolveSafePath solo previene path-traversal fuera del repo;
    // aquí bloqueamos paths a VCS metadata / env files para mitigar exfiltración
    // de PATs vía prompt injection (ej. `.git/config`, `.env.local`).
    this.assertNotForbidden(relativeFilePath);

    const absPath = this.resolveSafePath(repoPath, relativeFilePath);

    // Segundo check sobre el path absoluto resuelto: si el caller pasó un path
    // que después de resolver apunta a un segmento prohibido que no aparecía en
    // el input original, seguimos bloqueando.
    this.assertNotForbidden(path.relative(path.resolve(repoPath), absPath));

    // Tercer check (CWE-59 — symlink bypass): resolver symlinks y validar el
    // target real. Un attacker con write en el repo podría commitear
    // `evidence.txt -> .git/config`; los checks de arriba pasan, pero
    // `fs.readFile` seguiría el symlink. Usamos el realPath para leer también,
    // asegurando que lo leído es exactamente lo validado (evita TOCTOU si
    // alguien reemplaza el archivo entre validate y read).
    const realPath = await this.assertNotForbiddenRealPath(absPath, repoPath);

    const stat = await fs.stat(realPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new BadRequestException(`File not found: ${relativeFilePath}`);
    }
    if (stat.size > this.maxBytesPerFile) {
      throw new BadRequestException(
        `File too large (${Math.round(stat.size / 1024)} KB > ${Math.round(this.maxBytesPerFile / 1024)} KB). Usa code_grep primero para localizar la sección, luego code_read con offset+limit.`,
      );
    }

    const ext = path.extname(realPath).toLowerCase();
    const allowedBinary = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const binary = await this.isBinary(realPath);

    if (binary && !allowedBinary.includes(ext)) {
      throw new BadRequestException(`Binary file: ${relativeFilePath}`);
    }
    if (allowedBinary.includes(ext)) {
      return {
        path: relativeFilePath,
        content: `[Binary file: ${ext.slice(1).toUpperCase()}, ${Math.round(stat.size / 1024)} KB]`,
        totalLines: 0,
        truncated: false,
      };
    }

    const raw = await fs.readFile(realPath, 'utf8');
    const lines = raw.split('\n');
    const totalLines = lines.length;
    const offset = Math.max(0, (opts.offset ?? 1) - 1);
    const limit = opts.limit ?? 2000;
    const sliced = lines.slice(offset, offset + limit);
    const truncated = totalLines > offset + limit;

    const numberWidth = String(offset + sliced.length).length;
    const content = sliced
      .map((l, i) => `${String(offset + i + 1).padStart(numberWidth, ' ')}\t${l}`)
      .join('\n');

    return { path: relativeFilePath, content, totalLines, truncated };
  }

  // ─── Private ───

  /**
   * Asserta que un path resolved queda estrictamente dentro de repoPath.
   * Lanza BadRequestException si el agente intenta salir del repo.
   */
  private resolveSafePath(repoPath: string, userInput: string): string {
    const absRepo = path.resolve(repoPath);
    const joined = path.resolve(absRepo, userInput);
    if (joined !== absRepo && !joined.startsWith(absRepo + path.sep)) {
      throw new BadRequestException(`Path escapes repository root: ${userInput}`);
    }
    return joined;
  }

  /**
   * Extrae el path de una línea de output de ripgrep. El formato depende del modo:
   * - files_with_matches: `path/to/file.ts`
   * - count: `path/to/file.ts:42`
   * - content: `path/to/file.ts:42:matched content` (con -n) o `path/to/file.ts:matched content`
   *
   * Retorna null si no pudo parsear — el filtro trata esto como "permitir" para
   * no descartar silenciosamente matches válidos por bugs de parsing; la línea
   * de defensa primaria sigue siendo EXCLUDE_GLOBS + isForbiddenPath en read().
   */
  private extractFilePathFromGrepLine(
    line: string,
    mode: 'content' | 'files_with_matches' | 'count',
  ): string | null {
    if (!line) return null;
    if (mode === 'files_with_matches') {
      return line;
    }
    // count: path separado por ':' del count al final
    if (mode === 'count') {
      const idx = line.lastIndexOf(':');
      return idx > 0 ? line.slice(0, idx) : line;
    }
    // content: primer ':' separa path del resto (puede ser lineNum:content o content)
    const firstColon = line.indexOf(':');
    return firstColon > 0 ? line.slice(0, firstColon) : null;
  }

  /**
   * Defense-in-depth: bloquea paths a directorios sensibles (VCS, SSH, AWS, Docker),
   * archivos de entorno (.env.*), filenames con secrets conocidos (id_rsa, .npmrc,
   * .netrc, etc.) y extensiones cripto (.pem, .key, .p12, ...).
   *
   * resolveSafePath() previene salirse del repo, pero no evita que un agente
   * comprometido vía prompt injection intente leer `.git/config` para exfiltrar
   * PATs embebidos en URLs de remotes, o `.npmrc` con tokens de registry. Este
   * check cierra esa ventana.
   *
   * Acepta cualquier formato de path (absoluto o relativo); normaliza separadores
   * y divide en segmentos antes de comparar.
   */
  private isForbiddenPath(targetPath: string): boolean {
    // Normaliza separadores a '/' para consistencia cross-platform.
    // Lowercase para cubrir case-insensitive filesystems (macOS HFS+, Windows NTFS
    // por defecto) donde `.GIT/config` resuelve al mismo inode que `.git/config`.
    const normalized = targetPath.replace(/\\/g, '/').toLowerCase();
    const segments = normalized.split('/').filter(Boolean);

    for (const segment of segments) {
      if (CodeSearchService.FORBIDDEN_PATH_SEGMENTS.has(segment)) {
        return true;
      }
    }

    const fileName = segments.length > 0 ? segments[segments.length - 1] : '';

    // Filename exacto (id_rsa, .npmrc, .netrc, ...).
    if (CodeSearchService.FORBIDDEN_FILENAMES.has(fileName)) {
      return true;
    }

    // Prefix (.env, .env.local, .env.production, ...).
    for (const prefix of CodeSearchService.FORBIDDEN_FILE_PREFIXES) {
      if (fileName === prefix || fileName.startsWith(prefix + '.')) {
        return true;
      }
    }

    // Extensión (llaves privadas y certs). path.extname() sobre fileName ya
    // lowercased; devuelve '' si no hay dot.
    const ext = path.extname(fileName);
    if (ext && CodeSearchService.FORBIDDEN_FILE_EXTENSIONS.has(ext)) {
      return true;
    }

    return false;
  }

  /**
   * Helper para el error message — describe de forma precisa qué bloqueó el path
   * sin filtrar internals (el agente solo necesita saber que es sensible, no los
   * segmentos exactos de la blocklist).
   */
  private assertNotForbidden(relativePath: string): void {
    if (this.isForbiddenPath(relativePath)) {
      throw new BadRequestException(
        `Access denied: path "${relativePath}" targets a sensitive location (VCS metadata, environment file, credential or private key).`,
      );
    }
  }

  /**
   * Mitigación CWE-59 (symlink bypass): resuelve el path real del filesystem y
   * verifica que:
   *   1. No escape del repoPath (symlink → `/etc/passwd` o `../../otro-repo`).
   *   2. El target no esté en una ubicación prohibida (symlink `evidence.txt`
   *      → `.git/config` para exfiltrar PATs).
   *
   * `assertNotForbidden` sobre el input string del agente NO detecta esto: el
   * string `evidence.txt` pasa todos los checks, pero `fs.realpath` revela que
   * apunta a `.git/config`. Por eso este check va DESPUÉS de `resolveSafePath`
   * y antes de cualquier `fs.readFile`.
   *
   * Si el path no existe (ENOENT), lanza NotFoundException en vez del error
   * crudo de Node, para no filtrar rutas del filesystem en mensajes de error.
   */
  private async assertNotForbiddenRealPath(absPath: string, repoPath: string): Promise<string> {
    const absRepo = path.resolve(repoPath);
    // Resolve symlinks on the repo root too, for the same macOS /tmp reason
    // explained in glob(). Fallback to absRepo if realpath fails.
    const realRepo = await fs.realpath(absRepo).catch(() => absRepo);
    let realPath: string;
    try {
      realPath = await fs.realpath(absPath);
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
        throw new NotFoundException(
          `File not found: ${path.relative(absRepo, absPath) || path.basename(absPath)}`,
        );
      }
      // Otros errores (EACCES, loops de symlink ELOOP): no filtrar detalles.
      throw new BadRequestException(
        `Unable to resolve file: ${path.relative(absRepo, absPath) || path.basename(absPath)}`,
      );
    }

    // Containment check: si el realPath salió del repo via symlink, bloquear.
    // Acepta contención contra realRepo o absRepo (macOS /tmp quirk).
    const containedInReal = realPath === realRepo || realPath.startsWith(realRepo + path.sep);
    const containedInAbs = realPath === absRepo || realPath.startsWith(absRepo + path.sep);
    if (!containedInReal && !containedInAbs) {
      throw new BadRequestException(
        `Path escapes repository root via symlink: ${path.relative(absRepo, absPath)}`,
      );
    }

    // Blocklist check sobre el target real. El path relativo va contra la
    // root que contiene realmente el archivo (realRepo si el filesystem lo
    // canonicalizó, absRepo si no).
    const rootForRelative = containedInReal ? realRepo : absRepo;
    const relativeReal = path.relative(rootForRelative, realPath);
    if (this.isForbiddenPath(relativeReal)) {
      throw new BadRequestException(
        `Access denied: symlink target "${relativeReal}" is a sensitive location.`,
      );
    }

    return realPath;
  }

  private spawnRg(args: string[], cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn('rg', args, {
        cwd,
        timeout: this.grepTimeoutMs,
      });
      let stdout = '';
      let stderr = '';
      const MAX_BUFFER = 8 * 1024 * 1024;
      let bufferOverflow = false;

      child.stdout.on('data', (d: Buffer) => {
        if (stdout.length + d.length > MAX_BUFFER) {
          bufferOverflow = true;
          child.kill();
          return;
        }
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        if (stderr.length + d.length < 65536) stderr += d.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (bufferOverflow) {
          const err: any = new Error('rg output exceeded 8 MB buffer — narrow your search');
          err.code = 'BUFFER_OVERFLOW';
          return reject(err);
        }
        if (code === 0) return resolve(stdout);
        if (code === 1) {
          const err: any = new Error('no matches');
          err.code = 1;
          return reject(err);
        }
        reject(new Error(`rg exited ${code}: ${stderr.slice(0, 500)}`));
      });
    });
  }

  private async isBinary(absPath: string): Promise<boolean> {
    const fd = await fs.open(absPath, 'r');
    try {
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await fd.read(buf, 0, 8192, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0) return true;
      }
      return false;
    } finally {
      await fd.close();
    }
  }
}
