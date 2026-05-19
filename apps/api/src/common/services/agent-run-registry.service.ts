import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Registro centralizado de agentes IA en ejecución (story / diagram / epic
 * generation). Reemplaza los `Map<key, AbortController>` privados que cada
 * controller mantenía por separado.
 *
 * Razón de centralizar:
 *  - **Cap GLOBAL por usuario**: sin esto, un user podría correr 3 stories +
 *    3 diagrams + 3 epics = 9 agentes simultáneos. Cada agente arranca un
 *    stream Anthropic + clones de GitHub vault, lo que multiplica costos.
 *  - **Identidad por AbortController**: cancelled-tracking via `WeakSet`
 *    elimina la race condition donde un cancel sobre run X corrompía el
 *    cache del run Y (mismo key, distinto controller tras restart rápido).
 *  - **Hard timeout**: si el agente cuelga sin emitir complete/error,
 *    el `activeRuns` entry quedaba zombie hasta restart del proceso,
 *    bloqueando futuras runs del mismo key. 10min cap libera el slot.
 *
 * Es `@Global` para evitar imports cruzados desde generation modules.
 */
@Injectable()
export class AgentRunRegistryService {
  constructor(
    @InjectPinoLogger(AgentRunRegistryService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Cap por usuario — total agentes simultáneos sumados across los 3
   * endpoints (stories + diagrams + epics). 3 es generoso: típicamente
   * un usuario solo opera 1 a la vez. Configurable via env si crecemos.
   */
  private readonly userCap = 3;

  /**
   * Hard timeout DEFAULT: si el agente corre más de esto sin emitir
   * terminal event, abortamos. 10 min cubre los flujos single-agent
   * (epics, diagrams). Para flujos multi-agente como stories (PO + TL +
   * QA secuenciales), el caller puede pasar un timeout más alto vía el
   * parámetro `hardTimeoutMs` de `register()`.
   */
  private readonly defaultHardTimeoutMs = 10 * 60 * 1000;

  /** key (epicId / initiativeId / etc.) → AbortController activo */
  private readonly activeRuns = new Map<string, AbortController>();

  /** userSub → Set de keys que tiene este usuario activo */
  private readonly userActiveRuns = new Map<string, Set<string>>();

  /**
   * key → userSub que inició el run. Permite que los endpoints de cancel
   * verifiquen ownership: solo el usuario que arrancó la generación (o
   * AltaGerencia como override admin) puede cancelarla. Sin esto, un peer
   * del mismo pod podía cancelar el run de un compañero — intra-pod
   * griefing, granularidad de auth incorrecta para un recurso per-user.
   */
  private readonly runOwners = new Map<string, string>();

  /** AbortControllers marcados como cancelled (identity-based, no key-based) */
  private readonly cancelledControllers = new WeakSet<AbortController>();

  /** AbortController → timeout handle, para cleanup del hard timeout */
  private readonly timeouts = new WeakMap<AbortController, NodeJS.Timeout>();

  /**
   * Registra una nueva run. Throws ConflictException si:
   *  - El usuario ya tiene `userCap` runs activos.
   *  - Ya hay un run activo para el mismo `key`.
   *
   * Establece un hard timeout que aborta el controller. El caller puede
   * pasar `hardTimeoutMs` para sobrescribir el default (10min). Útil para
   * flujos multi-agente como stories (3 sub-agentes secuenciales) donde
   * el budget natural es ~30min — sin override, el timeout disparaba
   * justo cuando el TL estaba terminando, abortando el run con events=
   * cientos pero proposals=0 (output desperdiciado).
   *
   * El caller debe llamar `unregister(...)` en complete/error para limpiar
   * el timeout y los maps.
   */
  register(
    userSub: string,
    key: string,
    controller: AbortController,
    hardTimeoutMs?: number,
  ): void {
    if (this.activeRuns.has(key)) {
      throw new ConflictException(
        'Ya hay un agente corriendo para este recurso. Usa el endpoint de session para hidratar.',
      );
    }

    const userRuns = this.userActiveRuns.get(userSub) ?? new Set<string>();
    if (userRuns.size >= this.userCap) {
      throw new ConflictException(
        `Has alcanzado el límite de ${this.userCap} generaciones simultáneas. Espera o cancela una en curso.`,
      );
    }

    this.activeRuns.set(key, controller);
    userRuns.add(key);
    this.userActiveRuns.set(userSub, userRuns);
    this.runOwners.set(key, userSub);

    const effectiveTimeoutMs = hardTimeoutMs ?? this.defaultHardTimeoutMs;
    const timeout = setTimeout(() => {
      this.logger.warn(
        `[hard-timeout] aborting run after ${effectiveTimeoutMs}ms key=${key} user=${userSub}`,
      );
      // Tratar el hard-timeout como cancelación: el run se aborta en un
      // estado parcial y NO queremos que los callbacks persistan los
      // events/proposals acumulados como `staging` (estado válido).
      // markCancelled hace que el complete callback invalide cache.
      this.cancelledControllers.add(controller);
      controller.abort();
      this.unregister(userSub, key, controller);
    }, effectiveTimeoutMs);
    // Permite que el proceso Node termine aunque haya timeouts pendientes.
    timeout.unref?.();
    this.timeouts.set(controller, timeout);
  }

  /**
   * Borra el registro SI el controller actual coincide (compare-and-swap).
   * Esto evita la race donde un complete callback de un run viejo borraría
   * el entry de un run nuevo bajo la misma key.
   *
   * CRÍTICO: la mutación de `userActiveRuns` está gated por la misma CAS.
   * Sin esto, una callback stale del run X podía decrementar el contador
   * del run Y (mismo user, mismo key tras restart) → user count volvía
   * a 0 → bypass del cap, user podía arrancar `cap` runs más.
   *
   * El timeout cleanup NO necesita CAS: el WeakMap es por identidad de
   * controller, así que solo afecta al run que estamos terminando.
   *
   * Idempotente: llamarlo múltiples veces es seguro.
   */
  unregister(userSub: string, key: string, controller: AbortController): void {
    if (this.activeRuns.get(key) === controller) {
      this.activeRuns.delete(key);
      const userRuns = this.userActiveRuns.get(userSub);
      if (userRuns) {
        userRuns.delete(key);
        if (userRuns.size === 0) this.userActiveRuns.delete(userSub);
      }
      // runOwners gated por la misma CAS — sin esto, un stale callback
      // del run viejo borraría la entrada de ownership del run nuevo,
      // permitiendo que cualquier user del pod cancele el run nuevo.
      this.runOwners.delete(key);
    }
    const timeout = this.timeouts.get(controller);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(controller);
    }
  }

  /**
   * Recupera el AbortController de un run activo (si existe). Usado por
   * los endpoints de cancel para abort externo.
   */
  getController(key: string): AbortController | undefined {
    return this.activeRuns.get(key);
  }

  /** Marca un controller como cancelado (identidad, no key). */
  markCancelled(controller: AbortController): void {
    this.cancelledControllers.add(controller);
  }

  /** ¿Este controller específico fue cancelado explícitamente? */
  wasCancelled(controller: AbortController): boolean {
    return this.cancelledControllers.has(controller);
  }

  /** ¿Hay alguna run activa para este key? Para hidratación de sesión. */
  isActive(key: string): boolean {
    return this.activeRuns.has(key);
  }

  /** Cuántos runs simultáneos tiene este usuario (suma todos los tipos). */
  getUserRunCount(userSub: string): number {
    return this.userActiveRuns.get(userSub)?.size ?? 0;
  }

  /**
   * ¿Este `userSub` fue quien inició el run con esta `key`?
   *
   * Usado por endpoints de cancel para enforce ownership: solo el creador
   * del run puede cancelarlo (con AltaGerencia como override en el caller).
   * Devuelve `false` si la key no tiene run activo (idempotente — un cancel
   * sobre un run ya terminado no necesita ownership).
   */
  isOwner(key: string, userSub: string): boolean {
    return this.runOwners.get(key) === userSub;
  }
}
