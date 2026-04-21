import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { VaultFolderService } from '../../vault/vault-folder.service';
import { sanitizeForLog } from '../../../common/utils/sanitize-llm-input.util';
import {
  initiativeIndexPath,
  epicIndexPath,
  epicDefinitionPath,
  epicDiagramPath,
  epicDependencyPath,
  epicMatrixPath,
  storyFolderPath,
  storyIndexPath,
  isLegacyVaultPath,
  isNewFormatVaultPath,
  type InitiativeRef,
  type EpicRef,
  type StoryRef,
} from '../vault-paths';
import {
  buildDiagramMarkdown,
  buildDependencyMarkdown,
  buildQAMatrixMarkdown,
  buildEpicQAMatrixMarkdown,
} from '../epics/epic-markdown-builders';
import type {
  EpicDiagram,
  EpicDependency,
  QAMatrix,
  EpicQAMatrix,
} from '@cenzontle/shared';

// ─────────────────────────────────────────────────────────────────────
//   Tipos del reporte de migración
// ─────────────────────────────────────────────────────────────────────

export interface MigrationError {
  entity: 'initiative' | 'epic' | 'story';
  id: string;
  error: string;
}

export interface MigrationReport {
  initiativesMigrated: number;
  epicsMigrated: number;
  storiesMigrated: number;
  initiativesSkipped: number;
  epicsSkipped: number;
  storiesSkipped: number;
  errors: MigrationError[];
}

export interface OrphanCleanupReport {
  orphansDetected: number;
  foldersDeleted: number;
  errors: Array<{ folder: string; error: string }>;
  orphanPaths: string[];
}

// ─────────────────────────────────────────────────────────────────────
//   VaultMigrationService
// ─────────────────────────────────────────────────────────────────────

/**
 * Migra toda la data del vault desde el formato legacy (flat) al formato
 * nuevo anidado bajo `iniciativas/`.
 *
 * Idempotente: si un vaultPath ya está en el formato nuevo, lo skipea.
 * Safety: si un write falla, NO se borra el archivo legacy original.
 */
@Injectable()
export class VaultMigrationService {
  private readonly logger = new Logger(VaultMigrationService.name);

  /**
   * Lock in-memory para evitar dos invocaciones concurrentes de migrateAll().
   * Dos migraciones simultaneas duplicarian commits al vault (cada write va a
   * GitHub Contents API y ambos clients intentarian tomar el mismo SHA).
   *
   * NOTA: esto es un lock por instancia del service — si el API corre con
   * multiples replicas (worker count > 1 via PM2 o Kubernetes), el lock no
   * sirve como barrera global. Para eso habria que migrar a Redis SETNX o
   * un advisory lock de Postgres. Como el endpoint es admin-only y el usuario
   * tipicamente corre 1 migracion por mes, aceptamos el riesgo de la race
   * multi-replica a cambio de simplicidad.
   */
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly vaultFolder: VaultFolderService,
  ) {}

  /**
   * Punto de entrada principal. Lista TODAS las initiatives, epics y stories
   * desde Prisma y migra las que tengan vaultPath legacy.
   *
   * Retorna un reporte con conteos y errores.
   *
   * @throws ConflictException si ya hay una migracion en curso en esta instancia.
   */
  async migrateAll(executedByUserId?: string): Promise<MigrationReport> {
    if (this.isRunning) {
      this.logger.warn(
        `[VaultMigration] intento de invocacion concurrente rechazado (user=${sanitizeForLog(executedByUserId ?? 'unknown')})`,
      );
      throw new ConflictException(
        'Ya hay una migración del vault en ejecución. Espera a que termine para iniciar otra.',
      );
    }

    this.isRunning = true;
    try {
      return await this.runMigration(executedByUserId);
    } finally {
      this.isRunning = false;
    }
  }

  private async runMigration(executedByUserId?: string): Promise<MigrationReport> {
    this.logger.log(
      `[VaultMigration] ===== INICIO de migración big-bang (user=${sanitizeForLog(executedByUserId ?? 'unknown')}) =====`,
    );

    const report: MigrationReport = {
      initiativesMigrated: 0,
      epicsMigrated: 0,
      storiesMigrated: 0,
      initiativesSkipped: 0,
      epicsSkipped: 0,
      storiesSkipped: 0,
      errors: [],
    };

    // Cargar todas las initiatives con sus épicas e historias anidadas
    const initiatives = await this.prisma.initiative.findMany({
      include: {
        epics: {
          include: {
            stories: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    this.logger.log(
      `[VaultMigration] ${initiatives.length} initiative(s) encontradas para procesar`,
    );

    for (const ini of initiatives) {
      const iniRef: InitiativeRef = { id: ini.id, name: ini.name };

      // ── Migrar initiative ──
      const iniMigrated = await this.migrateInitiative(ini, iniRef, report);

      for (const epic of ini.epics) {
        const epicRef: EpicRef = { id: epic.id, title: epic.title };

        // ── Migrar epic ──
        const epicMigrated = await this.migrateEpic(epic, iniRef, epicRef, report);
        void epicMigrated; // usado solo para trazabilidad futura

        for (const story of epic.stories) {
          const storyRef: StoryRef = { id: story.id, title: story.title };

          // ── Migrar story ──
          await this.migrateStory(story, iniRef, epicRef, storyRef, report);
        }
      }

      void iniMigrated; // usado solo para trazabilidad futura
    }

    this.logger.log(
      `[VaultMigration] ===== FIN de migración =====\n` +
        `  Initiatives: migradas=${report.initiativesMigrated}, skipped=${report.initiativesSkipped}\n` +
        `  Epics: migradas=${report.epicsMigrated}, skipped=${report.epicsSkipped}\n` +
        `  Stories: migradas=${report.storiesMigrated}, skipped=${report.storiesSkipped}\n` +
        `  Errores: ${report.errors.length}`,
    );

    return report;
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Migración de initiative
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Migra una initiative del formato legacy al nuevo.
   * Legacy: `initiatives/<id>-<slug>.md` (un solo archivo .md plano).
   * Nuevo:  `iniciativas/<slug>-<id6>/index.md`.
   *
   * Si el write falla, NO se borra el legacy (preservar siempre el original).
   */
  private async migrateInitiative(
    ini: { id: string; name: string; vaultPath: string | null },
    iniRef: InitiativeRef,
    report: MigrationReport,
  ): Promise<boolean> {
    const newPath = initiativeIndexPath(iniRef);

    // Ya está en el formato nuevo → skipear
    if (isNewFormatVaultPath(ini.vaultPath)) {
      this.logger.debug(
        `[VaultMigration] initiative ${ini.id} ya en formato nuevo: ${ini.vaultPath} — skip`,
      );
      report.initiativesSkipped++;
      return false;
    }

    // Sin vaultPath legacy → crear index.md nuevo sin contenido previo
    if (!ini.vaultPath || !isLegacyVaultPath(ini.vaultPath)) {
      this.logger.log(
        `[VaultMigration] initiative ${ini.id} sin vaultPath legacy, creando ${newPath}`,
      );
      try {
        const fallbackContent = this.buildInitiativeIndexMarkdown(ini);
        await this.vault.writeNote(
          newPath,
          fallbackContent,
          `refactor(vault-migration): create initiative "${sanitizeForLog(ini.name)}" [${ini.id}]`,
        );
        await this.prisma.initiative.update({
          where: { id: ini.id },
          data: { vaultPath: newPath },
        });
        report.initiativesMigrated++;
        this.logger.log(
          `[VaultMigration] initiative ${ini.id}: (sin legacy) → ${newPath} ✓`,
        );
        return true;
      } catch (err: any) {
        this.registrarError(report, 'initiative', ini.id, err);
        return false;
      }
    }

    // Existe vaultPath legacy → leer contenido, escribir en nuevo path, borrar viejo
    this.logger.log(
      `[VaultMigration] initiative ${ini.id}: ${ini.vaultPath} → ${newPath}`,
    );

    try {
      // 1. Leer contenido del legacy
      const legacyNote = await this.vault.readNote(ini.vaultPath);
      const content = legacyNote?.content ?? this.buildInitiativeIndexMarkdown(ini);

      // 2. Escribir en el nuevo path
      await this.vault.writeNote(
        newPath,
        content,
        `refactor(vault-migration): migrate initiative "${sanitizeForLog(ini.name)}" to nested format [${ini.id}]`,
      );

      // 3. Actualizar PG con el nuevo vaultPath
      await this.prisma.initiative.update({
        where: { id: ini.id },
        data: { vaultPath: newPath },
      });

      // 4. Solo si todo lo anterior salió bien, borrar el legacy
      try {
        await this.vault.deleteNote(
          ini.vaultPath,
          `refactor(vault-migration): remove legacy initiative path [${ini.id}]`,
        );
      } catch (deleteErr: any) {
        // El delete es best-effort — el legacy queda como basura, no como blocker
        this.logger.warn(
          `[VaultMigration] initiative ${ini.id}: no se pudo borrar legacy ${ini.vaultPath}: ${deleteErr?.message}`,
        );
      }

      report.initiativesMigrated++;
      this.logger.log(
        `[VaultMigration] initiative ${ini.id}: old=${ini.vaultPath} → new=${newPath} ✓`,
      );
      return true;
    } catch (err: any) {
      this.registrarError(report, 'initiative', ini.id, err);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Migración de epic
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Migra una epic del formato legacy al nuevo.
   *
   * Legacy: `epics/<id>-<slug>.md` (un solo archivo con descripción + 12 narrativos).
   * Nuevo:  `iniciativas/.../epics/<slug>-<id6>/index.md` + `definicion.md`.
   *
   * Además escribe los artefactos JSONB (diagrams, dependencies, qaMatrix, epicQAMatrix)
   * como archivos .md individuales en sus subcarpetas correspondientes.
   */
  private async migrateEpic(
    epic: {
      id: string;
      title: string;
      description: string;
      vaultPath: string | null;
      diagrams: any;
      dependencies: any;
      qaMatrix: any;
      epicQAMatrix: any;
      [key: string]: any;
    },
    iniRef: InitiativeRef,
    epicRef: EpicRef,
    report: MigrationReport,
  ): Promise<boolean> {
    const newIndexPath = epicIndexPath(iniRef, epicRef);
    const newDefinitionPath = epicDefinitionPath(iniRef, epicRef);

    // Ya está en el formato nuevo → skipear (pero intentar escribir artefactos si faltan)
    if (isNewFormatVaultPath(epic.vaultPath)) {
      this.logger.debug(
        `[VaultMigration] epic ${epic.id} ya en formato nuevo: ${epic.vaultPath} — skip`,
      );
      // Aun así intentar serializar artefactos JSONB por si no se escribieron antes
      await this.escribirArtefactosEpic(epic, iniRef, epicRef);
      report.epicsSkipped++;
      return false;
    }

    this.logger.log(
      `[VaultMigration] epic ${epic.id}: ${epic.vaultPath ?? '(sin path)'} → ${newIndexPath}`,
    );

    try {
      // 1. Leer legacy (si existe) y separar en index + definicion
      let legacyContent: string | null = null;
      if (epic.vaultPath && isLegacyVaultPath(epic.vaultPath)) {
        const legacyNote = await this.vault.readNote(epic.vaultPath).catch(() => null);
        legacyContent = legacyNote?.content ?? null;
      }

      const { indexMd, definicionMd } = this.separarContenidoEpic(epic, legacyContent);

      const sanitizedTitle = sanitizeForLog(epic.title);

      // 2. Escribir index.md
      await this.vault.writeNote(
        newIndexPath,
        indexMd,
        `refactor(vault-migration): migrate epic "${sanitizedTitle}" index [${epic.id}]`,
      );

      // 3. Escribir definicion.md
      await this.vault.writeNote(
        newDefinitionPath,
        definicionMd,
        `refactor(vault-migration): migrate epic "${sanitizedTitle}" definition [${epic.id}]`,
      );

      // 4. Actualizar PG con el nuevo vaultPath
      await this.prisma.epic.update({
        where: { id: epic.id },
        data: { vaultPath: newIndexPath },
      });

      // 5. Escribir artefactos JSONB como markdown
      await this.escribirArtefactosEpic(epic, iniRef, epicRef);

      // 6. Best-effort: borrar legacy
      if (epic.vaultPath && isLegacyVaultPath(epic.vaultPath)) {
        try {
          await this.vault.deleteNote(
            epic.vaultPath,
            `refactor(vault-migration): remove legacy epic path [${epic.id}]`,
          );
        } catch (deleteErr: any) {
          this.logger.warn(
            `[VaultMigration] epic ${epic.id}: no se pudo borrar legacy ${epic.vaultPath}: ${deleteErr?.message}`,
          );
        }
      }

      report.epicsMigrated++;
      this.logger.log(
        `[VaultMigration] epic ${epic.id}: old=${epic.vaultPath ?? 'n/a'} → new=${newIndexPath} ✓`,
      );
      return true;
    } catch (err: any) {
      this.registrarError(report, 'epic', epic.id, err);
      return false;
    }
  }

  /**
   * Escribe los artefactos JSONB de la épica (diagrams, dependencies, matrices)
   * como archivos markdown individuales en sus subcarpetas correspondientes.
   * Cada write es best-effort — si uno falla se loguea y se continúa.
   */
  private async escribirArtefactosEpic(
    epic: {
      id: string;
      title: string;
      diagrams: any;
      dependencies: any;
      qaMatrix: any;
      epicQAMatrix: any;
    },
    iniRef: InitiativeRef,
    epicRef: EpicRef,
  ): Promise<void> {
    // Diagramas — usar id para desambiguar si hay multiples del mismo tipo
    const diagrams: EpicDiagram[] = Array.isArray(epic.diagrams) ? epic.diagrams : [];
    for (const diagram of diagrams) {
      if (!diagram?.id || !diagram?.type) continue;
      const kind = diagram.type === 'business' || diagram.type === 'technical'
        ? diagram.type
        : 'business';
      const path = epicDiagramPath(iniRef, epicRef, { id: diagram.id, type: kind });
      try {
        await this.vault.writeNote(
          path,
          buildDiagramMarkdown(diagram as EpicDiagram),
          `refactor(vault-migration): write diagram "${sanitizeForLog(diagram.type)}" for epic [${epic.id}]`,
        );
        this.logger.log(`[VaultMigration] epic ${epic.id}: diagrama "${sanitizeForLog(diagram.type)}" → ${path}`);
      } catch (err: any) {
        this.logger.warn(
          `[VaultMigration] epic ${epic.id}: error escribiendo diagrama ${path}: ${err?.message}`,
        );
      }
    }

    // Dependencias
    const dependencies: EpicDependency[] = Array.isArray(epic.dependencies)
      ? epic.dependencies
      : [];
    for (const dep of dependencies) {
      if (!dep?.id || !dep?.title) continue;
      const path = epicDependencyPath(iniRef, epicRef, dep.title);
      const safeTitle = sanitizeForLog(dep.title);
      try {
        await this.vault.writeNote(
          path,
          buildDependencyMarkdown(dep as EpicDependency),
          `refactor(vault-migration): write dependency "${safeTitle}" for epic [${epic.id}]`,
        );
        this.logger.log(`[VaultMigration] epic ${epic.id}: dependencia "${safeTitle}" → ${path}`);
      } catch (err: any) {
        this.logger.warn(
          `[VaultMigration] epic ${epic.id}: error escribiendo dependencia ${path}: ${err?.message}`,
        );
      }
    }

    // Matriz QA funcional (story-level)
    const qaMatrix = epic.qaMatrix as QAMatrix | null;
    if (qaMatrix?.id) {
      const path = epicMatrixPath(iniRef, epicRef, 'qa-funcional');
      try {
        await this.vault.writeNote(
          path,
          buildQAMatrixMarkdown(qaMatrix),
          `refactor(vault-migration): write QA matrix for epic [${epic.id}]`,
        );
        this.logger.log(`[VaultMigration] epic ${epic.id}: matriz QA funcional → ${path}`);
      } catch (err: any) {
        this.logger.warn(
          `[VaultMigration] epic ${epic.id}: error escribiendo QA funcional ${path}: ${err?.message}`,
        );
      }
    }

    // Matriz QA sistémica (epic-level)
    const epicQAMatrix = epic.epicQAMatrix as EpicQAMatrix | null;
    if (epicQAMatrix?.id) {
      const path = epicMatrixPath(iniRef, epicRef, 'qa-sistemica');
      try {
        await this.vault.writeNote(
          path,
          buildEpicQAMatrixMarkdown(epicQAMatrix),
          `refactor(vault-migration): write epic QA matrix for epic [${epic.id}]`,
        );
        this.logger.log(`[VaultMigration] epic ${epic.id}: matriz QA sistémica → ${path}`);
      } catch (err: any) {
        this.logger.warn(
          `[VaultMigration] epic ${epic.id}: error escribiendo QA sistémica ${path}: ${err?.message}`,
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Migración de story
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Migra una story usando VaultFolderService.moveFolder.
   *
   * Casos:
   *  - `stories/<slug>-<id6>/` (formato intermedio de este PR) → mover al nuevo path anidado.
   *  - Ya en formato nuevo → skipear.
   *  - Sin vaultPath o formato desconocido → skipear con warn.
   */
  private async migrateStory(
    story: { id: string; title: string; vaultPath: string | null },
    iniRef: InitiativeRef,
    epicRef: EpicRef,
    storyRef: StoryRef,
    report: MigrationReport,
  ): Promise<boolean> {
    const newIndexPath = storyIndexPath(iniRef, epicRef, storyRef);
    const newFolder = storyFolderPath(iniRef, epicRef, storyRef);

    // Ya está en el formato nuevo → skipear
    if (isNewFormatVaultPath(story.vaultPath)) {
      this.logger.debug(
        `[VaultMigration] story ${story.id} ya en formato nuevo: ${story.vaultPath} — skip`,
      );
      report.storiesSkipped++;
      return false;
    }

    // Sin vaultPath → no hay nada que migrar
    if (!story.vaultPath) {
      this.logger.debug(
        `[VaultMigration] story ${story.id} sin vaultPath — skip`,
      );
      report.storiesSkipped++;
      return false;
    }

    // Detectar el folder origen desde el vaultPath.
    // Para stories el vaultPath apunta al index.md dentro del folder.
    // Ejemplo legacy intermedio: `stories/<slug>-<id6>/index.md`
    const oldFolder = story.vaultPath.endsWith('/index.md')
      ? story.vaultPath.slice(0, story.vaultPath.lastIndexOf('/'))
      : null;

    if (!oldFolder || oldFolder === newFolder) {
      // Si ya apunta al mismo folder o no podemos detectarlo, skipear
      this.logger.debug(
        `[VaultMigration] story ${story.id}: path no detectado como folder de historias — skip (${story.vaultPath})`,
      );
      report.storiesSkipped++;
      return false;
    }

    this.logger.log(
      `[VaultMigration] story ${story.id}: ${oldFolder} → ${newFolder}`,
    );

    try {
      // Usar VaultFolderService.moveFolder para la operación segura
      const result = await this.vaultFolder.moveFolder(
        oldFolder,
        newFolder,
        `refactor(vault-migration): migrate story "${sanitizeForLog(story.title)}" to nested format [${story.id}]`,
        `refactor(vault-migration): remove legacy story folder [${story.id}]`,
      );

      if (result.copyErrors.length > 0) {
        // Si hubo errores de copia, moveFolder ya preservó el legacy — registrar error
        throw new Error(
          `moveFolder copy errors: ${result.copyErrors.join('; ')}`,
        );
      }

      // Si hubo errores de delete del legacy, loguearlos en lugar de silenciarlos:
      // quedan archivos huerfanos que alguien tiene que limpiar manualmente.
      if (result.deleteErrors.length > 0) {
        this.logger.warn(
          `[VaultMigration] story ${story.id}: legacy folder parcialmente huerfano (${result.deleteErrors.length} archivos no borrados): ${result.deleteErrors.join('; ')}`,
        );
      }

      // Actualizar PG con el nuevo vaultPath
      await this.prisma.story.update({
        where: { id: story.id },
        data: { vaultPath: newIndexPath },
      });

      report.storiesMigrated++;
      this.logger.log(
        `[VaultMigration] story ${story.id}: old=${oldFolder} → new=${newFolder} (moved=${result.filesMoved}) ✓`,
      );
      return true;
    } catch (err: any) {
      this.registrarError(report, 'story', story.id, err);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Helpers de construcción de markdown
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Construye un index.md mínimo para una initiative sin contenido legacy.
   */
  private buildInitiativeIndexMarkdown(ini: {
    id: string;
    name: string;
    description?: string;
  }): string {
    const now = new Date().toISOString();
    return [
      `---`,
      `id: ${ini.id}`,
      `name: ${JSON.stringify(ini.name)}`,
      `migratedAt: ${now}`,
      `---`,
      ``,
      `# ${ini.name}`,
      ``,
      ini.description || '_Sin descripción._',
    ].join('\n');
  }

  /**
   * A partir de una epic y su contenido legacy (si existe), produce
   * el par (indexMd, definicionMd) para el formato nuevo.
   *
   * El legacy puede mezclar descripción + 12 campos narrativos en un solo .md.
   * Si no hay legacy, se construye desde los campos de PG directamente.
   */
  private separarContenidoEpic(
    epic: {
      id: string;
      title: string;
      description: string;
      qualitativeBenefits?: string;
      quantitativeBenefits?: string;
      benefitsMeasurement?: string;
      scopeDescription?: string;
      acceptanceCriteria?: string;
      technologicalImprovements?: string;
      businessPriority?: string;
      teamsInvolved?: string;
      impactedChannels?: string;
      impactedFlows?: string;
      impactSabreLevel?: string;
      thirdPartyDependencies?: string;
    },
    legacyContent: string | null,
  ): { indexMd: string; definicionMd: string } {
    const now = new Date().toISOString();

    // index.md — siempre construido desde PG (no depende del legacy)
    const indexMd = [
      `---`,
      `id: ${epic.id}`,
      `title: ${JSON.stringify(epic.title)}`,
      `migratedAt: ${now}`,
      `---`,
      ``,
      `# ${epic.title}`,
      ``,
      epic.description || '_Sin descripción._',
    ].join('\n');

    // definicion.md — preferir contenido del legacy si existe;
    // si no, construir desde los 12 campos narrativos de PG
    let definicionMd: string;

    if (legacyContent) {
      // El legacy ya es el markdown completo: lo reutilizamos como definicion.md
      // pero aseguramos que empiece con un encabezado claro
      definicionMd = legacyContent.startsWith('#')
        ? legacyContent
        : `# Definición de épica: ${epic.title}\n\n${legacyContent}`;
    } else {
      // Construir desde campos de PG
      const campos: Array<[string, string]> = [
        ['Beneficios cualitativos', epic.qualitativeBenefits ?? ''],
        ['Beneficios cuantitativos', epic.quantitativeBenefits ?? ''],
        ['Medición de beneficios', epic.benefitsMeasurement ?? ''],
        ['Descripción del alcance', epic.scopeDescription ?? ''],
        ['Criterios de aceptación', epic.acceptanceCriteria ?? ''],
        ['Mejoras tecnológicas', epic.technologicalImprovements ?? ''],
        ['Prioridad de negocio', epic.businessPriority ?? ''],
        ['Equipos involucrados', epic.teamsInvolved ?? ''],
        ['Canales impactados', epic.impactedChannels ?? ''],
        ['Flujos impactados', epic.impactedFlows ?? ''],
        ['Nivel de impacto Sabre', epic.impactSabreLevel ?? ''],
        ['Dependencias de terceros', epic.thirdPartyDependencies ?? ''],
      ];

      const sections = campos
        .map(([label, value]) => `## ${label}\n\n${value || '_Sin definir._'}`)
        .join('\n\n');

      definicionMd = [
        `---`,
        `id: ${epic.id}`,
        `title: ${JSON.stringify(epic.title)}`,
        `migratedAt: ${now}`,
        `---`,
        ``,
        `# Definición de épica: ${epic.title}`,
        ``,
        sections,
      ].join('\n');
    }

    return { indexMd, definicionMd };
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Utilidades
  // ─────────────────────────────────────────────────────────────────────

  /** Registra un error en el reporte y loguea con stack. */
  private registrarError(
    report: MigrationReport,
    entity: MigrationError['entity'],
    id: string,
    err: any,
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `[VaultMigration] ERROR ${entity} ${id}: ${message}`,
      err instanceof Error ? err.stack : undefined,
    );
    report.errors.push({ entity, id, error: message });
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Cleanup de folders huerfanos
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Detecta y borra folders de historias huerfanos en el vault — folders que
   * existen en GitHub pero cuyo shortId (ultimos 6 chars del slug del folder)
   * NO corresponde a ninguna story en PG.
   *
   * Origen de los huerfanos: intentos fallidos de create story donde el
   * writeFileSet fallo parcialmente (p.ej. 409 Conflict bajo concurrencia)
   * y el rollback tambien fallo, dejando archivos en vault sin fila en PG.
   *
   * Idempotente: correr multiples veces es safe. Si alguien re-usa un shortId
   * (astronomicamente improbable con UUIDs), NO se borra nada.
   *
   * El matching es por SHORT ID (6 chars sufijo del folder) comparado contra
   * el `id.slice(-6)` de las stories en PG. Esto alinea con el formato
   * `<slug>-<id6>` de storyFolderPath.
   */
  async cleanupOrphanStories(): Promise<OrphanCleanupReport> {
    this.logger.log('[VaultCleanup] ===== INICIO cleanup de folders huerfanos =====');

    // 1. Cargar todos los shortIds validos desde PG
    const allStories = await this.prisma.story.findMany({
      select: { id: true, vaultPath: true, title: true },
    });
    const validShortIds = new Set(
      allStories.filter((s) => s.id.length >= 6).map((s) => s.id.slice(-6)),
    );
    this.logger.log(`[VaultCleanup] ${allStories.length} stories en PG, ${validShortIds.size} shortIds validos`);

    // 2. Listar el tree completo bajo iniciativas/ y detectar folders en historias/
    const tree = await this.vault.listTree('iniciativas').catch(() => []);
    const orphanPaths: string[] = [];

    const walk = (nodes: typeof tree, insideHistorias: boolean) => {
      for (const node of nodes) {
        const isHistoriasFolder = node.type === 'folder' && node.path.endsWith('/historias');
        const isStoryFolder =
          node.type === 'folder' &&
          insideHistorias &&
          /\/historias\/[^/]+$/.test(node.path);

        if (isStoryFolder) {
          // Extraer shortId del nombre del folder (ultimos 6 chars del slug)
          const folderName = node.path.split('/').pop() ?? '';
          const shortId = folderName.slice(-6);
          if (!validShortIds.has(shortId)) {
            orphanPaths.push(node.path);
          }
          // No recursamos dentro de un story folder — no hay mas story folders
          // anidados (solo archivos).
          continue;
        }

        // Recursa manteniendo el flag de si estamos dentro de historias/
        if (node.children && node.children.length > 0) {
          walk(node.children, insideHistorias || isHistoriasFolder);
        }
      }
    };
    walk(tree, false);

    this.logger.log(
      `[VaultCleanup] detectados ${orphanPaths.length} folder(s) huerfano(s)`,
    );

    // 3. Borrar cada folder huerfano. El mutex queue del VaultService serializa
    //    las operaciones — no habra 409s por concurrencia interna.
    const errors: Array<{ folder: string; error: string }> = [];
    let foldersDeleted = 0;
    for (const folder of orphanPaths) {
      try {
        await this.vaultFolder.deleteFolder(
          folder,
          `cleanup(vault): remove orphan story folder ${folder.split('/').pop()}`,
        );
        foldersDeleted++;
        this.logger.log(`[VaultCleanup] ✓ deleted orphan: ${folder}`);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ folder, error: message });
        this.logger.warn(`[VaultCleanup] ✗ failed to delete ${folder}: ${message}`);
      }
    }

    this.logger.log(
      `[VaultCleanup] ===== FIN cleanup: ${foldersDeleted}/${orphanPaths.length} borrados, ${errors.length} errores =====`,
    );

    return {
      orphansDetected: orphanPaths.length,
      foldersDeleted,
      errors,
      orphanPaths,
    };
  }
}
