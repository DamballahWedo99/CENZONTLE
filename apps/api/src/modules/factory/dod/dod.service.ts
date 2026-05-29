import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import type { DodCanonicalKind } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpsertDodCriteriaDto } from './dto/upsert-dod-criteria.dto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface DodCriterionPublic {
  id: string;
  // Modelo de LECTURA desde DB — `string | null` a propósito (no
  // `DodCanonicalKind | null`): la columna podría contener kinds legacy y un
  // read model no debe mentir sobre lo que la DB realmente puede tener. La
  // garantía de canonicidad se aplica en la ESCRITURA (DEFAULT_DOD_CRITERIA).
  kind: string | null;
  text: string;
  description: string;
  position: number;
}

/**
 * Catálogo canónico de criterios estándar del DoD. Refresh basado en research
 * de industria (Atlassian, Scrum.org, Codacy AI agents, DORA/Accelerate)
 * — migration `20260508250000_dod_evidence_based_defaults`. Este array es
 * la fuente de verdad cuando el operador hace "Restaurar defaults" — los
 * valores acá ganan sobre lo que esté en DB para los criterios con `kind`.
 *
 * Los `kind` son `DodCanonicalKind` (fuente única de verdad en
 * `@cenzontle/shared`). Tipar este array contra ese union hace que un typo o
 * un kind no canónico sea un ERROR de compilación — antes era string libre y
 * podía driftear silenciosamente respecto al mapa `VERIFIERS` del worker
 * (architecture-reviewer 2026-05-28).
 *
 * Si en el futuro se cambia un criterio estándar (text o description),
 * actualizar acá Y crear migration de backfill para los installs existentes.
 * Para agregar un kind nuevo: agregarlo primero a `DOD_CANONICAL_KINDS`.
 */
const DEFAULT_DOD_CRITERIA: ReadonlyArray<{
  kind: DodCanonicalKind;
  text: string;
  description: string;
}> = [
  {
    kind: 'code-written',
    text: 'Código escrito y funcional',
    description:
      'El código implementado debe ejecutarse sin errores de runtime y cumplir el comportamiento descrito en la historia. Si la story define un endpoint, debe responder; si define un componente, debe renderearse; si define una función, debe retornar valores correctos para los casos descritos. No basta con que compile — debe correr.',
  },
  {
    kind: 'acceptance-criteria',
    text: 'Cumple criterios de aceptación de la historia',
    description:
      'El código no solo debe ejecutarse, debe cumplir TODOS los criterios de aceptación descritos en la historia. Lee la story como una spec: cada bullet es un test mental. Si la story dice "el botón debe ser azul", verifica el color. Si dice "el endpoint retorna 404 cuando no encuentra el recurso", escribe el caso. No marques el criterio como cumplido si solo parte de los acceptance criteria están cubiertos — todos o ninguno.',
  },
  {
    kind: 'technical-design',
    text: 'Sigue el diseño técnico del Tech Lead',
    description:
      'El código debe respetar la arquitectura, contratos API, patrones, validaciones y manejo de errores documentados en la sección Técnica de la story. Cada item del checklist técnico, cada endpoint/type/interface del contrato, cada regla de validación y cada flujo de errores definidos por el TL DEBEN estar visibles en el código (archivos, funciones, módulos correspondientes). NO improvisar decisiones que el TL ya tomó: si el TL dijo "usar repository pattern", no inventes un service pattern; si definió `interface LoginDto { email, password }`, el código debe tener esa interface con esos campos. El verifier evalúa per-item con grep determinístico + judgment semántico.',
  },
  {
    kind: 'tests-passing',
    text: 'Tests pasando + casos edge cubiertos',
    description:
      'Los tests automáticos del repo deben pasar localmente (npm test / pnpm test) antes de pushear. Más importante que la cobertura numérica es la CALIDAD de los tests: cubrí el happy path + casos edge (inputs vacíos, valores límite, condiciones de error) + manejo de errores. NO bypasear tests con flags ni excluir archivos del coverage para alcanzar un threshold. NO escribir tests triviales solo para subir el coverage % — eso es teatro de cobertura sin valor real.',
  },
  {
    kind: 'no-errors',
    text: 'Sin errores de lint/typecheck',
    description:
      'No debe haber errores de lint (ESLint/Biome/etc.) ni de TypeScript en el código modificado. Corre `pnpm lint` y `pnpm type-check` antes de cerrar el run. Si encontrás errores pre-existentes en archivos que NO estás modificando, déjalos — no expandas el scope.',
  },
  {
    kind: 'security-scan',
    text: 'Sin vulnerabilidades críticas de seguridad',
    description:
      'Tu código no debe introducir vulnerabilidades de severidad crítica/alta detectables por herramientas estándar (npm audit, dependabot, semgrep). En particular: cero command injection, cero SQL injection, cero secretos hardcoded, cero XSS en componentes que renderean input del usuario. Validá inputs en los boundaries del sistema (endpoints, queries DB, exec de comandos shell). El worker corre `npm audit` DIFERENCIAL (origin/<base> vs HEAD) y solo falla por advisories NUEVOS que tu branch introdujo — los preexistentes de la base no penalizan.',
  },
  {
    kind: 'code-security',
    text: 'Revisión de seguridad del código (HIGH = bloqueante)',
    description:
      'Revisión de seguridad profunda del diff (réplica del comando /security-review de Claude Code): un agente de seguridad independiente audita el código nuevo de tu branch buscando vulnerabilidades de ALTA confianza y explotabilidad real — injection (SQL/command/template/NoSQL), path traversal, auth/authz bypass, secretos hardcodeados, crypto débil, RCE por deserialización, XSS, exposición de datos sensibles. Solo los findings HIGH (directamente explotables: RCE, data breach, auth bypass) bloquean la historia; los MEDIUM se reportan para visibilidad pero no fallan. NO introduzcas código que cruce un boundary de privilegio sin validar, que interpole input no saneado en queries/comandos/HTML, ni que loguee secretos en plaintext.',
  },
  {
    kind: 'design-coverage-check',
    text: 'Cobertura de componentes del diseño UX/UI',
    description:
      'Si la épica tiene diseños UX/UI con un manifest de componentes (sections / react-components extraídos del bundle por `design-bundle.service`), cada componente del manifest DEBE tener una implementación correspondiente en el código del workdir bajo `src/`. El check del worker (Layer 1, no bloqueante) hace grep recursivo del nombre del componente sobre los archivos `.ts/.tsx/.js/.jsx` buscando patrones `function NAME(`, `const NAME =`, `class NAME `, `<NAME ...>`. Si la épica es backend-only o no trae manifest, el check se salta. Si encuentra componentes sin implementación, queda como warn visible en la UI — el operador decide si re-encolar la historia.',
  },
  {
    kind: 'pr-created',
    text: 'PR creado y aprobado',
    description:
      'Al terminar el trabajo, debes pushear la branch al remote y abrir un Pull Request en GitHub apuntando a la branch base de la épica (forge/sprint-batch-{epicId}). El PR debe tener título descriptivo y body explicando qué se implementó. La aprobación humana del PR es la confirmación final.',
  },
  {
    kind: 'docs-updated',
    text: 'Documentación actualizada',
    description:
      'Si tu cambio toca código de aplicación, DEBES actualizar documentación en el mismo PR. Regla concreta (el worker la verifica DETERMINÍSTICAMENTE: si el diff toca código, debe tocar también un archivo de docs): actualizá el README con lo que aplique — qué hace la feature, cómo correrla, estructura del proyecto. Escalá la doc al tamaño del cambio: una sección corta en el README para algo simple; para una decisión arquitectónica significativa (elección de patrón, contrato de API, trade-off de diseño) agregá además un ADR en docs/adr/NNNN-titulo.md (un archivo NUEVO por decisión — así no genera conflictos entre historias del mismo sprint). Basta con tocar un archivo de docs (README, cualquier *.md, docs/**, AGENTS.md o CLAUDE.md). Cambios SOLO de config (deps/lockfile) no requieren docs.',
  },
];

/**
 * Catálogo global de criterios de Definition of Done. Reemplaza el
 * useState local que vivía en el frontend.
 *
 * Estrategia de update: replace-all en transaction. El frontend manda el
 * array completo cada vez que el operador toca "Guardar". El backend
 * borra todo y reinserta. Trade-off: se pierde `createdAt` per-criterio
 * en cada save, pero el flow de uso (lista chica, edits agrupadas, replace
 * de la totalidad de la lista cuando dragea/agrega/borra) es lo
 * suficientemente coherente para que sea aceptable.
 */
@Injectable()
export class DodService {
  constructor(private readonly prisma: PrismaService,
    @InjectPinoLogger(DodService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Lista todos los criterios ordenados por `position` ASC. Todo lo que está
   * en la tabla está activo — no hay toggles ni filtros (los campos `enabled`
   * y `required` se eliminaron en migration 20260512 por ser scaffolding sin UI).
   */
  async findAll(): Promise<DodCriterionPublic[]> {
    const rows = await this.prisma.dodCriterion.findMany({
      orderBy: { position: 'asc' },
      select: {
        id: true,
        kind: true,
        text: true,
        description: true,
        position: true,
      },
    });
    return rows;
  }

  /**
   * Replace-all del catálogo. Validaciones:
   *  - `kind` debe ser único entre los criterios del payload (un mismo
   *    `kind` dos veces revienta el UNIQUE de la DB; mejor validar antes
   *    para devolver 400 con mensaje claro).
   *  - `position` debe ser entero ≥ 0 (el DTO ya lo valida con class-validator).
   *
   * Hace delete + insert en una sola transacción para que un fallo a mitad
   * no deje el catálogo vacío.
   */
  async replaceAll(
    dto: UpsertDodCriteriaDto,
    actorEmail?: string,
  ): Promise<DodCriterionPublic[]> {
    // Validar duplicados de `kind` ANTES de pegarle a la DB.
    const seenKinds = new Set<string>();
    for (const c of dto.criteria) {
      if (c.kind != null) {
        if (seenKinds.has(c.kind)) {
          throw new BadRequestException(
            `Duplicate kind "${c.kind}" — cada criterio estándar puede aparecer solo una vez.`,
          );
        }
        seenKinds.add(c.kind);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.dodCriterion.deleteMany({});
      if (dto.criteria.length === 0) {
        return [];
      }
      await tx.dodCriterion.createMany({
        data: dto.criteria.map((c) => ({
          kind: c.kind ?? null,
          text: c.text,
          // description ya viene validada non-empty por el DTO
          // (@MinLength(1)). Si llega vacía es un bug del frontend, no
          // un caso a manejar acá — Prisma rechazará por la NOT NULL.
          description: c.description,
          position: c.position,
        })),
      });
      this.logger.info(
        `[dod.replace_all] count=${dto.criteria.length} actor=${actorEmail ?? 'unknown'}`,
      );
      return tx.dodCriterion.findMany({
        orderBy: { position: 'asc' },
        select: {
          id: true,
          kind: true,
          text: true,
          description: true,
          position: true,
        },
      });
    });
  }

  /**
   * Restaura los criterios estándar al estado canónico definido en
   * `DEFAULT_DOD_CRITERIA`. Para cada uno (`code-written`, `acceptance-criteria`,
   * `tests-passing`, `no-errors`, `security-scan`, `design-coverage-check`,
   * `pr-created`, `docs-updated`):
   *  - Si existe en DB (con cualquier text/description), lo PISA con los
   *    valores canónicos.
   *  - Si NO existe (operador lo borró), lo INSERTA de nuevo.
   *
   * Los criterios CUSTOM (kind=null) NO se tocan — sobreviven al reset
   * y mantienen su position relativa, pero el array se reordena: defaults
   * primero (position 0..3), luego custom (position 4..N).
   *
   * Es la única forma de reset que ofrecemos hoy. Si en el futuro se
   * agrega "reset full" (que también borre custom), debería ser un
   * endpoint distinto con confirmación más fuerte (type-to-confirm).
   */
  async resetDefaults(actorEmail?: string): Promise<DodCriterionPublic[]> {
    return this.prisma.$transaction(async (tx) => {
      // 1) Levantar custom existentes para preservarlos. Solo necesitamos
      //    text/description para reinsertar — id/position se regeneran.
      const existingCustom = await tx.dodCriterion.findMany({
        where: { kind: null },
        orderBy: { position: 'asc' },
        select: { text: true, description: true },
      });

      // 2) Wipe completo. Más simple que "upsert por kind + delete custom
      //    + reinsert" — y como estamos dentro de la transacción, no hay
      //    ventana de inconsistencia visible.
      await tx.dodCriterion.deleteMany({});

      // 3) Reinsertar los defaults canónicos en posiciones 0..N.
      const defaultsData = DEFAULT_DOD_CRITERIA.map((d, i) => ({
        kind: d.kind,
        text: d.text,
        description: d.description,
        position: i,
      }));

      // 4) Reinsertar los custom preservados con position offset por el
      //    largo de defaults. Mantienen su orden relativo.
      const customData = existingCustom.map((c, i) => ({
        kind: null,
        text: c.text,
        description: c.description,
        position: defaultsData.length + i,
      }));

      await tx.dodCriterion.createMany({
        data: [...defaultsData, ...customData],
      });

      this.logger.info(
        `[dod.reset_defaults] preserved=${existingCustom.length} custom criteria, restored ${defaultsData.length} defaults. actor=${actorEmail ?? 'unknown'}`,
      );

      return tx.dodCriterion.findMany({
        orderBy: { position: 'asc' },
        select: {
          id: true,
          kind: true,
          text: true,
          description: true,
          position: true,
        },
      });
    });
  }
}
