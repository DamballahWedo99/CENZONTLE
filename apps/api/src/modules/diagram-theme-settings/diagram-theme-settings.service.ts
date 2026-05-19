import {
  Injectable,
} from '@nestjs/common';
import {
  DEFAULT_DIAGRAM_GROUP_COLORS,
  DEFAULT_DIAGRAM_TEXT_COLORS,
  filterDiagramGroupColors,
  type DiagramGroupColors,
  type DiagramTextColors,
} from '@cenzontle/shared';
import { PrismaService } from '../prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Row singleton con id fijo. Usar siempre esta constante y NO el default del
 * schema — si alguna vez generamos la row desde código, queremos que apunte
 * al mismo registro que las lecturas/escrituras posteriores.
 */
const SINGLETON_ID = 'singleton';

/**
 * Shape público que expone el endpoint GET /diagram-theme.
 *
 * `colors` siempre es un DiagramGroupColors completo — si la row singleton
 * no existe, el service la auto-inicializa con DEFAULT_DIAGRAM_GROUP_COLORS
 * antes de retornar.
 *
 * `textColors` también se retorna siempre completo — si la row es legacy
 * (sin el campo persistido) se rellena con DEFAULT_DIAGRAM_TEXT_COLORS.
 */
export interface DiagramThemeSettingsPublic {
  colors: DiagramGroupColors;
  textColors: DiagramTextColors;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Gestiona la configuración singleton de colores de diagrama para toda la
 * organización. Single-org por ahora: una sola row con id="singleton".
 *
 * Auto-inicialización: el primer GET o PUT crea la row si no existe, usando
 * DEFAULT_DIAGRAM_GROUP_COLORS del paquete shared. No requiere seed script.
 */
@Injectable()
export class DiagramThemeSettingsService {
  constructor(private readonly prisma: PrismaService,
    @InjectPinoLogger(DiagramThemeSettingsService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Devuelve la configuración actual de colores. Si la row singleton no existe,
   * la crea con los defaults y la retorna. Es seguro concurrentemente: usa
   * upsert por el id fijo, así que dos lecturas simultáneas no crean duplicados.
   */
  async get(): Promise<DiagramThemeSettingsPublic> {
    const row = await this.prisma.diagramThemeSettings.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        groupColors: DEFAULT_DIAGRAM_GROUP_COLORS as unknown as object,
      },
      update: {},
    });

    return this.toPublic(row);
  }

  /**
   * Reemplaza todos los colores. Idempotente: un upsert garantiza que la row
   * existe tras la operación, aunque haya sido eliminada manualmente de DB.
   *
   * `updatedBy` es el `sub` del JWT (Auth0 user id) del operador que dispara
   * el cambio — guardado como string para audit trail sin FK dura a una tabla
   * de usuarios (que vive en Auth0, no en PG).
   *
   * `textColors` es opcional: si viene, se persiste; si no, se preserva el
   * valor existente en DB (o defaults si la fila es legacy). Esto evita
   * sobreescribir involuntariamente cuando el cliente sólo está actualizando
   * los colores de grupo.
   */
  async update(
    colors: DiagramGroupColors,
    updatedBy: string | null,
    textColors?: DiagramTextColors,
  ): Promise<DiagramThemeSettingsPublic> {
    // Si el cliente no envió textColors, preservamos lo que haya en DB
    // (o defaults si la fila es legacy). Leemos el estado actual para
    // decidir qué valor escribir en create/update del upsert.
    let nextTextColors: DiagramTextColors;
    if (textColors) {
      nextTextColors = textColors;
    } else {
      const existing = await this.prisma.diagramThemeSettings.findUnique({
        where: { id: SINGLETON_ID },
        select: { textColors: true },
      });
      nextTextColors = this.resolveTextColors(existing?.textColors);
    }

    const row = await this.prisma.diagramThemeSettings.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        groupColors: colors as unknown as object,
        textColors: nextTextColors as unknown as object,
        updatedBy,
      },
      update: {
        groupColors: colors as unknown as object,
        textColors: nextTextColors as unknown as object,
        updatedBy,
      },
    });

    this.logger.info(
      `[update] colors updated by sub=${updatedBy ?? '<unknown>'}` +
        (textColors ? ' (textColors included)' : ''),
    );
    return this.toPublic(row);
  }

  /**
   * Convierte la row de Prisma al shape público.
   *
   * El campo `groupColors` es `Json` (JSONB) — filas escritas antes de la
   * reducción 9→7 pueden tener claves legacy (`decision`, `alt`). Filtramos
   * a las 7 claves canónicas con `filterDiagramGroupColors` y rellenamos
   * cualquier faltante con defaults para que el frontend nunca reciba un
   * shape más ancho ni más estrecho que `DiagramGroupColors`.
   *
   * `textColors` es nullable en DB (backward compat). Se resuelve a través
   * de `resolveTextColors` para garantizar un shape siempre completo.
   */
  private toPublic(row: {
    groupColors: unknown;
    textColors: unknown;
    updatedAt: Date;
    updatedBy: string | null;
  }): DiagramThemeSettingsPublic {
    const raw = (row.groupColors ?? {}) as Record<string, unknown>;
    const filtered = filterDiagramGroupColors(raw);
    const colors: DiagramGroupColors = { ...DEFAULT_DIAGRAM_GROUP_COLORS, ...filtered };
    const textColors = this.resolveTextColors(row.textColors);
    return {
      colors,
      textColors,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  /**
   * Normaliza el valor persistido de `textColors` (que puede ser null en
   * filas legacy o un objeto con claves parciales) a un `DiagramTextColors`
   * siempre completo. Cualquier clave faltante cae a los defaults del
   * paquete shared. Solo se aceptan strings — cualquier tipo inesperado
   * en una clave concreta se ignora y se usa el default.
   */
  private resolveTextColors(raw: unknown): DiagramTextColors {
    if (!raw || typeof raw !== 'object') {
      return { ...DEFAULT_DIAGRAM_TEXT_COLORS };
    }
    const obj = raw as Record<string, unknown>;
    return {
      title:
        typeof obj.title === 'string' ? obj.title : DEFAULT_DIAGRAM_TEXT_COLORS.title,
      description:
        typeof obj.description === 'string'
          ? obj.description
          : DEFAULT_DIAGRAM_TEXT_COLORS.description,
    };
  }
}
