import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { simpleGit, type SimpleGit } from 'simple-git';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { OrgAnthropicConfigService } from '../../org-anthropic-config/org-anthropic-config.service';

/**
 * Auto-resolver de merge conflicts entre stories paralelas de la misma wave.
 *
 * **Por qué existe**: stories paralelas que tocan archivos comunes (típico:
 * `package.json`, `.gitignore`, `jest.config.js`) generan merge conflicts
 * REALES cuando se mergean al integration branch. Sin auto-resolver, ese
 * caso degradaba la story a `in_review` requiring intervención humana.
 * Eso rompía la value prop del Forge ("zero-touch parallel software factory").
 *
 * **Estrategia de 2 capas**:
 *
 *   Capa A — Determinística (structured files):
 *     Para archivos con sintaxis bien definida (JSON, YAML, gitignore),
 *     leemos ambas versiones del archivo (head + base) directamente via
 *     `git show` (NO parseamos los marker `<<<<<<<` — más limpio) y
 *     hacemos union semánticamente correcto:
 *       - JSON: deep merge — objects union keys recursivamente, arrays
 *         deduplican por valor o por JSON.stringify.
 *       - YAML: future (no MVP).
 *       - .gitignore | .txt line-based: union de líneas con dedupe.
 *
 *   Capa B — Sonnet judge (código semántico, FUTURE):
 *     Para .ts/.py/.js/etc., capa A no aplica porque mergear código
 *     deterministicamente puede romper semántica. Sonnet recibe contexto
 *     completo de ambas stories (PO + TL + QA markdown) + el archivo
 *     con conflict markers y emite resolution. Aún no implementado en
 *     este MVP — si conflict es en código, retorna ok=false y caller
 *     cae a in_review (comportamiento legacy preservado).
 *
 * **Trade-offs**:
 *   - PRO: el 90% de los conflicts en software-factory triviales (jest
 *     config + .gitignore + package.json) se resuelven determinísticamente
 *     sin LLM ni tokens, sin riesgo de hallucination.
 *   - PRO: preserva paralelismo intra-wave (stories siguen corriendo
 *     paralelas), elimina la opción nuclear de serializar el epic.
 *   - CON: archivos de código real aún caen a in_review hasta Capa B.
 *   - CON: si Capa A produce un JSON sintácticamente válido pero
 *     semánticamente roto (raro — solo si los stories conflictan
 *     intencionalmente en el mismo key con valores incompatibles),
 *     el merge final pasaría pero el código posterior podría fallar.
 *     Mitigación: log explicit de qué resolvió + idempotencia (el
 *     siguiente push del worker resobre-escribe si está mal).
 *
 * **Flow**:
 *   1. Clone shallow del repo (depth=50 para tener historia suficiente).
 *   2. Fetch base + head branches.
 *   3. Intentar `git merge origin/base` sobre head.
 *   4. Detectar archivos en conflict via `simple-git status`.
 *   5. Filtrar — si TODOS son structured (Capa A), continuar; sino abort.
 *   6. Por cada archivo: read head version + base version via `git show`,
 *      hacer merge semánticamente, write resolved.
 *   7. `git add` + commit + push.
 *   8. Cleanup tmpdir.
 *   9. Caller (agent-run.service) re-intenta merge del PR vía GitHub API.
 */
@Injectable()
export class ConflictResolverService {
  /**
   * Modelo Sonnet usado por Capa B. Sonnet 4.6 da mejor razonamiento semántico
   * sobre código que Haiku, y los conflicts típicos son raros (~1-5 por epic)
   * así que el costo extra es despreciable contra el valor de auto-resolver.
   */
  private static readonly SONNET_MODEL = 'claude-sonnet-4-6';

  constructor(
    private readonly orgAnthropic: OrgAnthropicConfigService,
    @InjectPinoLogger(ConflictResolverService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Intenta resolver el conflict del PR. Returns ok=true si se resolvió
   * y el caller debe re-intentar el merge; ok=false si no se pudo
   * (archivo no-structured, error de git, etc.) y caller debe caer a
   * in_review.
   */
  async tryAutoResolve(input: {
    runId: string;
    prNumber: number;
    repoUrl: string;
    headBranch: string;
    baseBranch: string;
    githubToken: string;
  }): Promise<{ ok: boolean; reason?: string; sha?: string; resolvedFiles?: string[] }> {
    const { runId, prNumber, repoUrl, headBranch, baseBranch, githubToken } = input;

    // Observabilidad: tracking de duración y costos para el log autoritativo
    // `forge.conflict_resolver.completed` al final del flow. Espejo del
    // pattern `forge.verify.completed` del DoD verifier — una sola línea
    // queryable en Loki/Grafana con TODOS los stats.
    const startedAtMs = Date.now();
    const layerBTokens = { input: 0, output: 0 };
    let layerBCallsCount = 0;

    // Clone target — directorio temporal, cleanup garantizado en finally.
    const workdir = await mkdtemp(path.join(tmpdir(), `forge-conflict-resolve-`));

    try {
      this.logger.info(
        {
          event: 'conflict_resolver.start',
          runId,
          prNumber,
          headBranch,
          baseBranch,
          workdir,
        },
        `[conflict-resolver] start PR #${prNumber} ${baseBranch} ← ${headBranch}`,
      );

      // Authenticate clone URL con el token (no se loggea el URL completo).
      const authedUrl = this.injectTokenIntoUrl(repoUrl, githubToken);
      const git = simpleGit({ baseDir: workdir });

      // 1. Clone shallow — depth=50 da suficiente historia para 3-way merge
      //    en epics pequeños. Si epic tiene más de 50 commits acumulados
      //    entre base y head (raro), el merge puede fallar por falta de
      //    common ancestor. En ese caso, fallback in_review.
      await git.clone(authedUrl, '.', ['--depth=50', '--branch', baseBranch]);

      // 2. Fetch ambas branches con sintaxis `<remote>:<local>` que crea
      //    directamente branches LOCALES. Esta sintaxis es más confiable
      //    que `<branch>:refs/remotes/origin/<branch>` porque:
      //      - Crea un branch local real (no solo un ref remoto técnico)
      //      - El checkout posterior es trivial: `git checkout <local>`
      //      - No requiere config `remote.origin.fetch` para tracking
      //
      //    Historia del bug 2026-05-17:
      //      v0 (original): `fetch origin <branch>` → ref a FETCH_HEAD →
      //                     checkout falla con "ruta no concord'o".
      //      v1 (fix#3): `fetch origin <branch>:refs/remotes/origin/<branch>` →
      //                  ref creado pero `--track` falla con "no es una rama".
      //      v2 (fix actual): `fetch origin <branch>:<branch>` → branch LOCAL
      //                       creado → checkout simple funciona.
      //
      //    NOTE: baseBranch ya existe localmente porque el `git clone --branch
      //    <baseBranch>` lo creó. Solo fetcheamos headBranch — el merge
      //    posterior usa `origin/<baseBranch>` que SÍ existe como tracking
      //    ref tras el clone con --branch.
      await git.fetch('origin', `${headBranch}:${headBranch}`);

      // 3. Checkout head como branch local (creado por el fetch v2).
      await git.checkout(headBranch);

      // 4. Intentar merge. Espera que falle con conflict — pero a veces
      //    succeed (caso .gitignore / archivos texto donde git auto-mergea
      //    cambios non-overlapping). Tratamos AMBOS casos correctamente.
      let conflictedFiles: string[];
      try {
        await git.merge([`origin/${baseBranch}`, '--no-commit', '--no-ff']);
        // ─── PATH HAPPY: git local mergeó sin conflict ──────────────
        // GitHub rechazó el merge (caller nos invocó por isMergeConflict=true)
        // pero git CLI puede auto-mergear cambios non-overlapping en archivos
        // text (e.g., .gitignore con líneas distintas appendeadas). GitHub
        // es más estricto que `git merge`. La solución: commitear el merge
        // local + push al head branch del PR. Eso actualiza el HEAD que
        // GitHub ve, y el siguiente intento de `pulls.merge` API succeed.
        //
        // Bug descubierto 2026-05-17 con seed minimal: el código antes
        // hacía `merge --abort` + return ok:true SIN push, así que el
        // caller re-intentaba el merge API contra el HEAD original
        // (sin la resolución pusheada) y GitHub seguía rechazando con 405.
        // BUG fix 2026-05-17 (iter 2): cuando hay MERGE_HEAD pendiente (tras
        // `git merge --no-commit --no-ff`), git escribe `MERGE_MSG` file
        // con el mensaje default ("Merge branch X into Y"). simple-git's
        // `commit(msg, [], options)` PUEDE no pasar -m correctamente y
        // git usa MERGE_MSG en su lugar. Resultado: el commit termina con
        // mensaje default + sin trailers. Verificado en PR #139 del 8vo run.
        //
        // FIX: usar `git.raw(['commit', '-m', msg, '--no-verify'])` que
        // bypassa la abstracción de simple-git y pasa -m explícito. Eso
        // override MERGE_MSG y garantiza el mensaje custom + trailers.
        await git.raw([
          'commit',
          '-m',
          `chore(conflict-resolver): auto-merge ${baseBranch} into ${headBranch}\n\n` +
            `PR: #${prNumber}\n` +
            `Run: ${runId}\n` +
            `Strategy: auto-merged-no-conflict (git CLI handled non-overlapping changes)\n` +
            `Forge-Conflict-Resolver: true\n` +
            `Resolver-Strategies: auto-merged-no-conflict`,
          '--no-verify',
        ]);
        const headSha = (await git.revparse(['HEAD'])).trim();
        await git.push('origin', headBranch);
        this.logger.info(
          {
            event: 'conflict_resolver.layer_a.auto_merged_committed',
            runId,
            prNumber,
            sha: headSha.slice(0, 7),
            fullSha: headSha,
            strategy: 'auto-merged-no-conflict',
            headBranch,
          },
          `[conflict-resolver] PR #${prNumber} auto-merge local OK (git auto-resolvió cambios non-overlapping). ` +
            `Pusheado sha=${headSha.slice(0, 7)} a ${headBranch} — caller re-intenta merge API.`,
        );
        return { ok: true, sha: headSha, reason: 'auto-merged-no-conflict' };
      } catch (mergeErr) {
        // Expected — conflict detected.
        const status = await git.status();
        conflictedFiles = status.conflicted;
        if (conflictedFiles.length === 0) {
          // Merge falló pero no por conflict. Otro error (e.g., not a
          // common ancestor).
          await git.raw(['merge', '--abort']).catch(() => undefined);
          return {
            ok: false,
            reason: `git merge falló pero status.conflicted está vacío: ${(mergeErr as Error).message}`,
          };
        }
      }

      this.logger.info(
        {
          event: 'conflict_resolver.detected',
          runId,
          prNumber,
          conflictedFiles,
          count: conflictedFiles.length,
        },
        `[conflict-resolver] PR #${prNumber} tiene ${conflictedFiles.length} archivos en conflict: ${conflictedFiles.join(', ')}`,
      );

      // 5. Per file: intentar resolver via Capa A (determinístico).
      //    Si Capa A retorna "no soportado" (tipo de archivo no structured),
      //    intentar Capa B (Sonnet judge). Si AMBAS fallan, abortar todo.
      //    No resolvemos parcialmente — too risky tener algunos archivos
      //    resueltos y otros con markers.
      const unresolvable: Array<{ file: string; reason: string }> = [];
      const resolved: Array<{ file: string; strategy: string }> = [];

      // Cargar API key una sola vez si vamos a necesitarla (Capa B).
      // Lazy load — solo si algún archivo escala a Capa B.
      let cachedApiKey: string | null = null;

      for (const file of conflictedFiles) {
        // Capa A — determinística.
        const layerA = await this.tryResolveFileLayerA({
          git,
          workdir,
          filePath: file,
          headBranch,
          baseBranch,
        });

        if (layerA.ok) {
          resolved.push({ file, strategy: layerA.strategy });
          this.logger.info(
            {
              event: 'conflict_resolver.file_resolved',
              runId,
              prNumber,
              file,
              layer: 'A',
              strategy: layerA.strategy,
            },
            `[conflict-resolver] PR #${prNumber} resolved ${file} via Capa A (${layerA.strategy})`,
          );
          continue;
        }

        // Capa A falló. Si supported=true (Capa A intentó pero falló),
        // NO escalamos a Capa B — el archivo es structured pero algo
        // pasó (e.g., JSON inválido). Capa B podría introducir cambios
        // semánticamente incorrectos en archivos structured.
        if (layerA.supported) {
          unresolvable.push({ file, reason: `Capa A: ${layerA.reason}` });
          this.logger.warn(
            {
              event: 'conflict_resolver.file_unresolvable',
              runId,
              prNumber,
              file,
              layer: 'A',
              reason: layerA.reason,
            },
            `[conflict-resolver] PR #${prNumber} unresolvable ${file} (Capa A supported but failed): ${layerA.reason}`,
          );
          continue;
        }

        // Capa A no soportado (tipo de archivo no structured) — escalar
        // a Capa B (Sonnet judge para código real).
        try {
          if (cachedApiKey === null) {
            cachedApiKey = await this.orgAnthropic.getApiKeyPlaintext();
          }
        } catch (apiKeyErr) {
          unresolvable.push({
            file,
            reason: `No API key disponible para Capa B: ${(apiKeyErr as Error).message}`,
          });
          continue;
        }

        const layerB = await this.tryResolveFileLayerB({
          git,
          workdir,
          filePath: file,
          headBranch,
          baseBranch,
          apiKey: cachedApiKey,
          runId,
          prNumber,
        });

        // Acumula stats de Capa B (siempre — éxito o falla — porque
        // el call a Sonnet ocurrió y consumió tokens).
        layerBCallsCount += 1;
        if (layerB.ok) {
          if (layerB.tokens) {
            layerBTokens.input += layerB.tokens.in;
            layerBTokens.output += layerB.tokens.out;
          }
          resolved.push({ file, strategy: 'sonnet-judge' });
          this.logger.info(
            {
              event: 'conflict_resolver.file_resolved',
              runId,
              prNumber,
              file,
              layer: 'B',
              strategy: 'sonnet-judge',
              tokens: layerB.tokens,
              estimatedCostUsd: layerB.tokens
                ? this.estimateSonnetCostUsd(layerB.tokens.in, layerB.tokens.out)
                : 0,
            },
            `[conflict-resolver] PR #${prNumber} resolved ${file} via Capa B (Sonnet, ${layerB.tokens?.in ?? 0}in/${layerB.tokens?.out ?? 0}out)`,
          );
        } else {
          unresolvable.push({ file, reason: `Capa B: ${layerB.reason}` });
          this.logger.warn(
            {
              event: 'conflict_resolver.file_unresolvable',
              runId,
              prNumber,
              file,
              layer: 'B',
              reason: layerB.reason,
            },
            `[conflict-resolver] PR #${prNumber} unresolvable ${file} (Capa B falló): ${layerB.reason}`,
          );
        }
      }

      // Si algún archivo es no-resolvable, abort (no resolvemos parcial).
      if (unresolvable.length > 0) {
        await git.raw(['merge', '--abort']).catch(() => undefined);
        const layerACount = resolved.filter((r) => r.strategy !== 'sonnet-judge').length;
        const layerBOkCount = resolved.filter((r) => r.strategy === 'sonnet-judge').length;
        // Log autoritativo del flow ABORT — espejo de `forge.verify.completed`.
        this.emitCompletedSummary({
          runId,
          prNumber,
          outcome: 'aborted',
          totalFiles: conflictedFiles.length,
          layerAResolved: layerACount,
          layerBResolved: layerBOkCount,
          layerBCallsCount,
          layerBTokens,
          unresolvableFiles: unresolvable.map((u) => u.file),
          durationMs: Date.now() - startedAtMs,
          reason: unresolvable.map((u) => `${u.file}: ${u.reason}`).join(' | '),
        });
        return {
          ok: false,
          reason:
            `${unresolvable.length} archivo(s) no resolvibles ` +
            `(A=${layerACount} ok, B=${layerBOkCount} ok). ` +
            `Detalles: ${unresolvable.map((u) => `${u.file}: ${u.reason}`).join(' | ')}`,
        };
      }

      // 6. All resolved. Commit + push.
      //
      // Trailer "Forge-Conflict-Resolver: true" — para filtrar TODOS los
      // commits del resolver via `git log --grep="Forge-Conflict-Resolver"`.
      // Trailer "Resolver-Strategies" — lista las strategies usadas (A, B,
      // o mezcla). Útil para auditoría: cuántos commits usaron Sonnet
      // (cost real) vs cuántos line-union (gratis).
      const filesDescription = resolved
        .map((r) => `${r.file} (${r.strategy})`)
        .join(', ');
      const strategiesSet = [...new Set(resolved.map((r) => r.strategy))].join(',');
      await git.commit(
        `Auto-resolve merge conflict from parallel siblings\n\n` +
          `Run: ${runId}\n` +
          `PR: #${prNumber}\n` +
          `Files resolved: ${filesDescription}\n` +
          `Forge-Conflict-Resolver: true\n` +
          `Resolver-Strategies: ${strategiesSet}`,
        [], // no specific files — todo lo que está staged
        { '--no-verify': null }, // skip pre-commit hooks del repo target
      );

      await git.push('origin', headBranch);

      const newSha = (await git.revparse(['HEAD'])).trim();

      const layerACount = resolved.filter((r) => r.strategy !== 'sonnet-judge').length;
      const layerBOkCount = resolved.filter((r) => r.strategy === 'sonnet-judge').length;

      // Log structured con sha COMPLETO + per-layer breakdown — auditable
      // post-merge en Loki/Grafana via `event="conflict_resolver.success"`.
      this.logger.info(
        {
          event: 'conflict_resolver.success',
          runId,
          prNumber,
          newSha: newSha.slice(0, 7),
          fullSha: newSha,
          resolvedFiles: resolved.map((r) => r.file),
          strategies: resolved.map((r) => r.strategy),
          layerACount,
          layerBOkCount,
          headBranch,
        },
        `[conflict-resolver] PR #${prNumber} auto-resolved (${resolved.length} files) — caller debe re-intentar merge`,
      );

      // Log dedicado para Capa B SUCCESS (smoking gun auditable) — espejo
      // del `layer_a.auto_merged_committed` del path "no-conflict". Útil
      // para auditar SOLO los commits que invocaron Sonnet (cost real) vs
      // los deterministic (cost cero).
      if (layerBOkCount > 0) {
        this.logger.info(
          {
            event: 'conflict_resolver.layer_b.committed',
            runId,
            prNumber,
            sha: newSha.slice(0, 7),
            fullSha: newSha,
            sonnetFiles: resolved.filter((r) => r.strategy === 'sonnet-judge').map((r) => r.file),
            sonnetFilesCount: layerBOkCount,
            headBranch,
          },
          `[conflict-resolver] PR #${prNumber} Capa B (Sonnet) committed sha=${newSha.slice(0, 7)} ` +
            `con ${layerBOkCount} archivo(s) integrado(s): ${resolved.filter((r) => r.strategy === 'sonnet-judge').map((r) => r.file).join(', ')}`,
        );
      }

      // Log autoritativo del flow SUCCESS — espejo de `forge.verify.completed`.
      // Queryable en Loki/Grafana:
      //   |= "forge.conflict_resolver.completed" | outcome="success"
      //   |= "forge.conflict_resolver.completed" | layerB_calls > 0 | totalCostUsd
      //   |= "forge.conflict_resolver.completed" | duration_ms > 30000  (slow alerts)
      this.emitCompletedSummary({
        runId,
        prNumber,
        outcome: 'success',
        totalFiles: conflictedFiles.length,
        layerAResolved: layerACount,
        layerBResolved: layerBOkCount,
        layerBCallsCount,
        layerBTokens,
        unresolvableFiles: [],
        durationMs: Date.now() - startedAtMs,
        newSha: newSha.slice(0, 7),
      });

      return {
        ok: true,
        sha: newSha,
        resolvedFiles: resolved.map((r) => r.file),
      };
    } catch (err) {
      // Log autoritativo del flow ERROR (excepción inesperada — diferente
      // de unresolvable/aborted que son flow normal de "no se pudo").
      // El `forge.conflict_resolver.completed` con outcome='error' que emite
      // `emitCompletedSummary` incluye `reason: 'Unexpected: ${err.message}'`
      // — log dedicado adicional sería redundante (cleanup 2026-05-19).
      this.emitCompletedSummary({
        runId,
        prNumber,
        outcome: 'error',
        totalFiles: 0,
        layerAResolved: 0,
        layerBResolved: 0,
        layerBCallsCount,
        layerBTokens,
        unresolvableFiles: [],
        durationMs: Date.now() - startedAtMs,
        reason: `Unexpected: ${(err as Error).message}`,
      });
      return { ok: false, reason: `Unexpected error: ${(err as Error).message}` };
    } finally {
      // Cleanup del workdir — best effort, no fail el método si no se
      // puede borrar (e.g., FS lock).
      await rm(workdir, { recursive: true, force: true }).catch((cleanupErr) => {
        this.logger.warn(
          {
            event: 'conflict_resolver.cleanup_failed',
            workdir,
            err: (cleanupErr as Error).message,
          },
          `[conflict-resolver] cleanup tmpdir failed (non-fatal): ${(cleanupErr as Error).message}`,
        );
      });
    }
  }

  /**
   * Capa A — resolve determinístico de un solo archivo.
   *
   * Returns:
   *   - {ok:true, strategy} si resolvió (escrito + staged via git add)
   *   - {ok:false, supported:true, reason} si es tipo soportado pero falló
   *     (e.g., JSON malformado) → CALLER NO escala a Capa B (sería peor)
   *   - {ok:false, supported:false, reason} si tipo no soportado por Capa A
   *     (código real .ts/.py/etc.) → CALLER escala a Capa B (Sonnet)
   */
  private async tryResolveFileLayerA(input: {
    git: SimpleGit;
    workdir: string;
    filePath: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<
    | { ok: true; strategy: 'json-deep-merge' | 'line-union' }
    | { ok: false; supported: true; reason: string }
    | { ok: false; supported: false; reason: string }
  > {
    const { git, workdir, filePath, headBranch, baseBranch } = input;
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath);

    // Read head + base versions del archivo directamente del git tree
    // — NO leemos del workdir porque ese tiene los markers <<<<<<<.
    let headContent: string;
    let baseContent: string;
    try {
      headContent = await git.show([`${headBranch}:${filePath}`]);
    } catch {
      // Archivo no existe en head (raro post-merge-attempt, probable
      // que el conflict sea por delete-vs-modify). NO escalamos a B
      // — Sonnet tampoco podría resolver delete-vs-modify confiablemente.
      return {
        ok: false,
        supported: true,
        reason: 'archivo no existe en head branch (delete-vs-modify)',
      };
    }
    try {
      baseContent = await git.show([`origin/${baseBranch}:${filePath}`]);
    } catch {
      // Archivo no existe en base — significa que el conflict es
      // delete-vs-add (head agregó archivo nuevo). En ese caso, head
      // gana automáticamente (mantenemos el archivo).
      const absPath = path.join(workdir, filePath);
      await writeFile(absPath, headContent, 'utf-8');
      await git.add(filePath);
      return { ok: true, strategy: 'line-union' };
    }

    // .json → deep merge
    if (ext === '.json') {
      try {
        const headJson = JSON.parse(headContent);
        const baseJson = JSON.parse(baseContent);
        const merged = this.deepMergeJson(headJson, baseJson);
        const absPath = path.join(workdir, filePath);
        // Preservar formato: 2-space indent, trailing newline (Prettier-style).
        await writeFile(absPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
        await git.add(filePath);
        return { ok: true, strategy: 'json-deep-merge' };
      } catch (parseErr) {
        return {
          ok: false,
          supported: true,
          reason: `JSON parse error: ${(parseErr as Error).message}`,
        };
      }
    }

    // .gitignore | .npmrc | .txt | .env.example → line-union
    if (
      basename === '.gitignore' ||
      basename === '.npmrc' ||
      basename === '.env.example' ||
      ext === '.txt'
    ) {
      const merged = this.lineUnionMerge(headContent, baseContent);
      const absPath = path.join(workdir, filePath);
      await writeFile(absPath, merged, 'utf-8');
      await git.add(filePath);
      return { ok: true, strategy: 'line-union' };
    }

    // Tipo no soportado — caller debe escalar a Capa B (Sonnet judge).
    return {
      ok: false,
      supported: false,
      reason: `Tipo no soportado por Capa A (ext='${ext}', basename='${basename}')`,
    };
  }

  /**
   * Capa B — resolve semántico via Sonnet judge.
   *
   * Para archivos de código real (.ts, .py, .js, etc.) donde merge
   * determinístico es peligroso. Sonnet recibe ambas versiones del
   * archivo (head + base) más el archivo con conflict markers (output
   * de git merge), y produce la versión resuelta respetando las
   * intenciones de ambas branches.
   *
   * Safety:
   *  - Output validation: rechaza si contiene conflict markers
   *    (`<<<<<<<`, `=======`, `>>>>>>>`) en la respuesta.
   *  - Sentinel `UNRESOLVABLE`: Sonnet puede declarar que no puede
   *    resolver safely → caller cae a in_review.
   *  - Strip markdown fences si Sonnet ignoró las instrucciones y
   *    envolvió en \`\`\`lang ... \`\`\`.
   *
   * Costo: ~3-8K tokens por archivo (input head + input base + input
   * conflict + output resolved). A Sonnet pricing (~$0.003/$0.015 per
   * 1K in/out), ~$0.01-0.05 por archivo resuelto. Despreciable vs
   * el costo de in_review humano.
   *
   * Modelo: Sonnet 4.6 (no Haiku) — el razonamiento sobre código
   * requiere capacidad. Si en el futuro Haiku alcanza calidad
   * suficiente, podemos cambiar para reducir costo.
   */
  private async tryResolveFileLayerB(input: {
    git: SimpleGit;
    workdir: string;
    filePath: string;
    headBranch: string;
    baseBranch: string;
    apiKey: string;
    runId: string;
    prNumber: number;
  }): Promise<
    | { ok: true; tokens?: { in: number; out: number } }
    | { ok: false; reason: string }
  > {
    const {
      git,
      workdir,
      filePath,
      headBranch,
      baseBranch,
      apiKey,
      runId,
      prNumber,
    } = input;

    // 1. Read versions from git
    let headContent: string;
    let baseContent: string;
    let conflictedContent: string;
    try {
      headContent = await git.show([`${headBranch}:${filePath}`]);
      baseContent = await git.show([`origin/${baseBranch}:${filePath}`]);
      conflictedContent = await readFile(
        path.join(workdir, filePath),
        'utf-8',
      );
    } catch (readErr) {
      return {
        ok: false,
        reason: `Failed to read file versions: ${(readErr as Error).message}`,
      };
    }

    // 2. Hard cap del tamaño para evitar abuso de tokens. Si el archivo
    //    es masivo (>50KB), Sonnet probablemente no haga buen trabajo
    //    y mejor caer a in_review.
    const totalSize = headContent.length + baseContent.length + conflictedContent.length;
    const MAX_SIZE = 50_000; // ~50KB combined → ~12K tokens
    if (totalSize > MAX_SIZE) {
      return {
        ok: false,
        reason: `Archivo demasiado grande para Capa B (${totalSize} bytes > ${MAX_SIZE} max combined). ` +
          `Resolver manualmente en in_review.`,
      };
    }

    // 3. Build prompt para Sonnet
    const prompt = this.buildLayerBPrompt({
      filePath,
      headContent,
      baseContent,
      conflictedContent,
    });

    // 4. Llamar Sonnet
    this.logger.info(
      {
        event: 'conflict_resolver.layer_b.calling_sonnet',
        runId,
        prNumber,
        file: filePath,
        promptChars: prompt.length,
      },
      `[conflict-resolver] Llamando Sonnet para resolver ${filePath}`,
    );

    let response: Anthropic.Messages.Message;
    try {
      const anthropic = new Anthropic({ apiKey });
      response = await anthropic.messages.create({
        model: ConflictResolverService.SONNET_MODEL,
        max_tokens: 16_000, // suficiente para archivos típicos
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });
    } catch (apiErr) {
      return {
        ok: false,
        reason: `Anthropic API error: ${(apiErr as Error).message}`,
      };
    }

    // 5. Parse response
    const firstBlock = response.content[0];
    if (!firstBlock || firstBlock.type !== 'text') {
      return {
        ok: false,
        reason: `Sonnet respondió con bloque no-text (type=${firstBlock?.type ?? 'undefined'})`,
      };
    }

    let resolved = firstBlock.text.trim();

    // 6. Detectar sentinel UNRESOLVABLE
    if (resolved === 'UNRESOLVABLE' || resolved.startsWith('UNRESOLVABLE\n')) {
      return {
        ok: false,
        reason: `Sonnet declaró UNRESOLVABLE para ${filePath}`,
      };
    }

    // 7. Strip markdown fences si Sonnet ignoró las instrucciones
    const fenceMatch = resolved.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
    if (fenceMatch) {
      resolved = fenceMatch[1];
    }

    // 8. Validar que NO contiene conflict markers (Sonnet a veces
    //    los preserva por accidente)
    if (
      resolved.includes('<<<<<<<') ||
      resolved.includes('>>>>>>>') ||
      /^=======$/m.test(resolved)
    ) {
      return {
        ok: false,
        reason: `Sonnet output contiene conflict markers — resolution incompleta`,
      };
    }

    // 9. Sanity: el output no debe ser vacío ni mucho más chico que
    //    head + base combined (sugeriría que Sonnet truncó).
    const expectedMinSize = Math.min(headContent.length, baseContent.length) * 0.3;
    if (resolved.length < expectedMinSize) {
      return {
        ok: false,
        reason:
          `Sonnet output sospechosamente chico (${resolved.length} chars vs expected min ${Math.floor(expectedMinSize)}). ` +
          `Probable truncation o hallucination.`,
      };
    }

    // 10. Write + stage
    const absPath = path.join(workdir, filePath);
    await writeFile(absPath, resolved, 'utf-8');
    await git.add(filePath);

    return {
      ok: true,
      tokens: {
        in: response.usage.input_tokens,
        out: response.usage.output_tokens,
      },
    };
  }

  /**
   * Construye el prompt para Sonnet Capa B. Mantenemos el prompt
   * en una función separada para que sea testeable y refactorable.
   */
  private buildLayerBPrompt(input: {
    filePath: string;
    headContent: string;
    baseContent: string;
    conflictedContent: string;
  }): string {
    const { filePath, headContent, baseContent, conflictedContent } = input;
    return `You are a merge conflict resolver for a parallel Software Factory.

Two stories ran in parallel and both modified \`${filePath}\`. The first one merged into base, the second one (current PR) hit a conflict because of overlap. Your task: produce the FINAL CONTENT of this file that respects BOTH stories' intentions.

## File path
${filePath}

## Version on head branch (current PR, modified by the current story)
\`\`\`
${headContent}
\`\`\`

## Version on base branch (already includes the sibling story's changes)
\`\`\`
${baseContent}
\`\`\`

## File with conflict markers (output of git merge)
\`\`\`
${conflictedContent}
\`\`\`

## Instructions

1. **Combine disjoint changes**: if Story A added function/class/import X in one region and Story B added Y in a different region, the resolved file must contain BOTH X and Y.

2. **Resolve overlapping changes intelligently**: if both stories modified the same region (e.g., changed the same function's body), prefer head version (most recent intention) but adapt to be compatible with base where possible. Use the surrounding code as context to decide what behavior makes sense.

3. **Preserve syntactic validity**: the output must parse as valid ${this.inferLanguage(filePath)} code. No partial statements, no dangling brackets, no syntax errors.

4. **DO NOT include conflict markers** in your output: no \`<<<<<<<\`, no \`=======\`, no \`>>>>>>>\`.

5. **Output ONLY the resolved file content**: no markdown fences, no commentary, no explanations, no preamble. Just the raw file content as it should appear on disk.

6. **If you cannot resolve safely** (e.g., the two stories have semantically incompatible intentions that you can't reconcile), output the literal single word \`UNRESOLVABLE\` (uppercase, nothing else) on its own line. This is a safety mechanism — the caller will then route the conflict to human review.

## Constraints

- Do not invent new functions/imports that neither story added.
- Do not remove code that both stories explicitly kept.
- Prefer additive merges (keeping both sides' additions) over choosing one side.

Output the resolved file content now:`;
  }

  /**
   * Infiere el lenguaje a partir de la extensión del archivo para que el
   * prompt sea más específico (e.g., "valid TypeScript code" vs genérico).
   */
  private inferLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript JSX',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript JSX',
      '.mjs': 'JavaScript (ESM)',
      '.cjs': 'JavaScript (CommonJS)',
      '.py': 'Python',
      '.go': 'Go',
      '.rs': 'Rust',
      '.java': 'Java',
      '.kt': 'Kotlin',
      '.cs': 'C#',
      '.swift': 'Swift',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.toml': 'TOML',
      '.md': 'Markdown',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.xml': 'XML',
    };
    return map[ext] ?? 'plain text';
  }

  /**
   * Deep merge de dos JSON values. Reglas:
   *   - null o undefined: el otro side gana.
   *   - Primitives (string/number/bool): head wins (intención más reciente).
   *   - Arrays: union dedupe (preserva orden: base primero, luego head).
   *   - Objects: recursive merge — keys union; key colision → recurse.
   *
   * Es seguro para package.json típico:
   *   base.scripts.test:    "jest"
   *   head.scripts.lint:    "eslint"
   *   → merged.scripts:     { test: "jest", lint: "eslint" }
   *
   * Para keys con valores conflictivos (raro pero posible):
   *   base.version: "1.0.0"
   *   head.version: "1.1.0"
   *   → merged.version: "1.1.0" (head wins, intención más reciente)
   */
  private deepMergeJson(head: unknown, base: unknown): unknown {
    if (head === null || head === undefined) return base;
    if (base === null || base === undefined) return head;

    // Primitives — head wins.
    if (typeof head !== 'object' || typeof base !== 'object') {
      return head;
    }

    // Arrays — union dedupe.
    if (Array.isArray(head) && Array.isArray(base)) {
      const seen = new Set<string>();
      const result: unknown[] = [];
      for (const item of [...base, ...head]) {
        const key =
          typeof item === 'object' && item !== null
            ? JSON.stringify(item)
            : String(item);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
      return result;
    }

    // Si uno es array y otro objeto → head wins (tipo inconsistente, casos
    // raros donde el seed accidentalmente cambia type de un campo).
    if (Array.isArray(head) || Array.isArray(base)) {
      return head;
    }

    // Objects — recursive merge.
    const headObj = head as Record<string, unknown>;
    const baseObj = base as Record<string, unknown>;
    const result: Record<string, unknown> = { ...baseObj };
    for (const key of Object.keys(headObj)) {
      if (key in baseObj) {
        result[key] = this.deepMergeJson(headObj[key], baseObj[key]);
      } else {
        result[key] = headObj[key];
      }
    }
    return result;
  }

  /**
   * Union dedupe de líneas — para archivos line-based como .gitignore.
   * Preserva orden: base primero, luego líneas nuevas del head.
   */
  private lineUnionMerge(headContent: string, baseContent: string): string {
    const baseLines = baseContent.split('\n');
    const headLines = headContent.split('\n');
    const seen = new Set<string>();
    const result: string[] = [];
    for (const line of [...baseLines, ...headLines]) {
      if (!seen.has(line)) {
        seen.add(line);
        result.push(line);
      }
    }
    return result.join('\n');
  }

  /**
   * Inserta el token de GitHub en el URL para clone authenticated.
   * Acepta formato `https://github.com/owner/repo` o `https://github.com/owner/repo.git`.
   * Output: `https://x-access-token:TOKEN@github.com/owner/repo[.git]`.
   *
   * NO loggear el output (contiene el token en cleartext).
   */
  private injectTokenIntoUrl(repoUrl: string, token: string): string {
    return repoUrl.replace(
      /^https:\/\//,
      `https://x-access-token:${token}@`,
    );
  }

  /**
   * Pricing approx de Sonnet 4.6 (precios públicos Anthropic):
   *   - Input:  $3.00 / 1M tokens → $0.000003 / token
   *   - Output: $15.00 / 1M tokens → $0.000015 / token
   *
   * Usado solo para observability (cost tracking en logs) — NO para
   * pricing decisions. Si Anthropic cambia los precios, este número
   * queda stale pero el flow sigue funcionando (los logs solo muestran
   * estimate aproximado, no autoritativo de billing).
   */
  private estimateSonnetCostUsd(inputTokens: number, outputTokens: number): number {
    const INPUT_PRICE_PER_TOKEN = 0.000003;
    const OUTPUT_PRICE_PER_TOKEN = 0.000015;
    return (
      inputTokens * INPUT_PRICE_PER_TOKEN +
      outputTokens * OUTPUT_PRICE_PER_TOKEN
    );
  }

  /**
   * Emite el log autoritativo `forge.conflict_resolver.completed` con
   * TODOS los stats del intento de resolución. Espejo del pattern usado
   * por `forge.verify.completed` (DoD verifier).
   *
   * Una sola línea queryable que responde:
   *   - ¿Cuántos archivos se intentaron resolver?
   *   - ¿Cuántos via Capa A (determinística, $0 tokens)?
   *   - ¿Cuántos via Capa B (Sonnet judge)?
   *   - ¿Cuántos tokens consumió Capa B en total? (cost USD aprox)
   *   - ¿Qué archivos fueron unresolvable?
   *   - ¿Cuánto tomó wall-time?
   *
   * Queries típicas Loki/Grafana:
   *   |= "forge.conflict_resolver.completed" | outcome != "success"
   *   |= "forge.conflict_resolver.completed" | layerB_calls > 0 | unwrap totalCostUsd
   *   |= "forge.conflict_resolver.completed" | duration_ms > 30000
   *   |= "forge.conflict_resolver.completed" | unresolvable_count > 0
   *
   * Choice de log level:
   *   - outcome="success" → info
   *   - outcome="aborted" (archivos unresolvable) → warn (operator notice)
   *   - outcome="error" (excepción inesperada) → error (alert)
   */
  private emitCompletedSummary(input: {
    runId: string;
    prNumber: number;
    outcome: 'success' | 'aborted' | 'error';
    totalFiles: number;
    layerAResolved: number;
    layerBResolved: number;
    layerBCallsCount: number;
    layerBTokens: { input: number; output: number };
    unresolvableFiles: string[];
    durationMs: number;
    newSha?: string;
    reason?: string;
  }): void {
    const {
      runId,
      prNumber,
      outcome,
      totalFiles,
      layerAResolved,
      layerBResolved,
      layerBCallsCount,
      layerBTokens,
      unresolvableFiles,
      durationMs,
      newSha,
      reason,
    } = input;

    const totalCostUsd = this.estimateSonnetCostUsd(
      layerBTokens.input,
      layerBTokens.output,
    );
    const totalResolved = layerAResolved + layerBResolved;
    const passRate = totalFiles > 0 ? Math.round((totalResolved / totalFiles) * 100) : 0;

    const payload = {
      event: 'forge.conflict_resolver.completed',
      runId,
      prNumber,
      outcome,
      totalFiles,
      totalResolved,
      passRate,
      // Per-layer breakdown — útil para entender qué cubrió cada capa.
      // Ratio layerA/layerB indica si los conflicts del seed son
      // structured (jest config, package.json) o de código real.
      layerA: {
        resolved: layerAResolved,
      },
      layerB: {
        resolved: layerBResolved,
        calls: layerBCallsCount,
        tokens: {
          input: layerBTokens.input,
          output: layerBTokens.output,
        },
        costUsd: Math.round(totalCostUsd * 10_000) / 10_000, // 4 decimals
      },
      unresolvable: {
        count: unresolvableFiles.length,
        files: unresolvableFiles,
      },
      durationMs,
      ...(newSha ? { newSha } : {}),
      ...(reason ? { reason } : {}),
    };

    const msgSummary =
      `[forge.conflict_resolver.completed] PR #${prNumber} outcome=${outcome} ` +
      `resolved=${totalResolved}/${totalFiles} (${passRate}%) | ` +
      `A=${layerAResolved} | B=${layerBResolved} (calls=${layerBCallsCount}, ` +
      `tokens=${layerBTokens.input}in/${layerBTokens.output}out, ` +
      `cost=$${totalCostUsd.toFixed(4)}) | ` +
      `unresolvable=${unresolvableFiles.length} | duration=${durationMs}ms`;

    if (outcome === 'success') {
      this.logger.info(payload, msgSummary);
    } else if (outcome === 'aborted') {
      this.logger.warn(payload, msgSummary);
    } else {
      this.logger.error(payload, msgSummary);
    }
  }
}
