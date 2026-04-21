import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import {
  migrateLegacyDiagramGroups,
  type DiagramGenerationType,
  type EpicDiagram,
} from '@cenzontle/shared';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';

/**
 * Persiste diagramas generados por el agente LLM en Redis con TTL de 5 días.
 *
 * TTL elegido (5 días = 432 000 s):
 *   - Suficientemente largo: una épica consultada esporádicamente durante la
 *     semana no requiere regeneración cada vez (regenerar cuesta ~30-60 s de
 *     tool-use de Claude Sonnet + tokens).
 *   - Suficientemente corto: cambios significativos en la épica (código
 *     nuevo, dependencias actualizadas) se reflejan automáticamente cuando
 *     el cache caduca. La siguiente visita fuerza regeneración con contexto
 *     fresco, evitando diagramas obsoletos atrapados indefinidamente.
 *
 * Una épica puede tener dos diagramas simultáneos (type='business' y
 * type='technical'), por lo que la key incluye ambos ejes.
 *
 * Defense-in-depth: se aplica `scrubSecrets` al JSON serializado aunque
 * los diagramas nunca deberían contener credenciales (son nodos/edges con
 * labels de 1-3 palabras). El coste es trivial y blinda contra futuros
 * cambios donde algún campo textual pudiera incluir texto sensible.
 */

/** 5 días en segundos — ver docblock del service para el racional del valor. */
const DIAGRAM_CACHE_TTL_SECONDS = 5 * 24 * 60 * 60;

@Injectable()
export class DiagramCacheService {
  private readonly logger = new Logger(DiagramCacheService.name);

  constructor(private readonly redis: RedisService) {}

  private key(epicId: string, type: DiagramGenerationType): string {
    return `epic-diagram:${epicId}:${type}`;
  }

  async saveDiagram(
    epicId: string,
    type: DiagramGenerationType,
    diagram: EpicDiagram,
  ): Promise<void> {
    // Normaliza grupos legacy antes de persistir. Si el caller reutiliza un
    // diagrama originalmente fetched con el schema viejo (ej: el frontend
    // edita un diagrama cacheado pre-refactor), evitamos que los valores
    // legacy queden atrapados en Redis hasta que venza el TTL.
    const normalized = migrateLegacyDiagramGroups(diagram);
    const payload = scrubSecrets(JSON.stringify(normalized));
    await this.redis.setex(
      this.key(epicId, type),
      DIAGRAM_CACHE_TTL_SECONDS,
      payload,
    );
    this.logger.log(
      `Diagram cached: epic=${epicId} type=${type} nodes=${normalized.nodes.length} edges=${normalized.edges.length} ttl=${DIAGRAM_CACHE_TTL_SECONDS}s`,
    );
  }

  async getDiagram(
    epicId: string,
    type: DiagramGenerationType,
  ): Promise<EpicDiagram | null> {
    const raw = await this.redis.get(this.key(epicId, type));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as EpicDiagram;
      return migrateLegacyDiagramGroups(parsed);
    } catch {
      // Cache corrupto (versión incompatible, truncamiento, etc.) — purgar
      // para evitar entregar basura al frontend en futuras lecturas.
      this.logger.warn(
        `Corrupted diagram cache for epic=${epicId} type=${type}; deleting`,
      );
      await this.invalidateDiagram(epicId, type);
      return null;
    }
  }

  async invalidateDiagram(
    epicId: string,
    type: DiagramGenerationType,
  ): Promise<void> {
    await this.redis.del(this.key(epicId, type));
    this.logger.log(`Diagram cache invalidated: epic=${epicId} type=${type}`);
  }
}
