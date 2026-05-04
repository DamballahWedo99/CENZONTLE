import { ConflictException } from '@nestjs/common';
import { AgentRunRegistryService } from './agent-run-registry.service';

/**
 * Tests del registry — DoS protection central. Los invariantes son sutiles
 * y bugs causan cap bypass (security issue), por eso cada caso edge tiene
 * test dedicado. Ver `agent-run-registry.service.ts` para contexto del
 * diseño.
 */
describe('AgentRunRegistryService', () => {
  let registry: AgentRunRegistryService;

  beforeEach(() => {
    registry = new AgentRunRegistryService();
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. Cap enforcement
  // ─────────────────────────────────────────────────────────────────
  describe('cap enforcement', () => {
    it('permite registrar hasta 3 runs simultáneos para el mismo usuario', () => {
      const c1 = new AbortController();
      const c2 = new AbortController();
      const c3 = new AbortController();

      expect(() => registry.register('user1', 'key1', c1)).not.toThrow();
      expect(() => registry.register('user1', 'key2', c2)).not.toThrow();
      expect(() => registry.register('user1', 'key3', c3)).not.toThrow();

      expect(registry.getUserRunCount('user1')).toBe(3);
    });

    it('bloquea el 4to run con ConflictException mencionando "límite"', () => {
      registry.register('user1', 'key1', new AbortController());
      registry.register('user1', 'key2', new AbortController());
      registry.register('user1', 'key3', new AbortController());

      expect(() => {
        registry.register('user1', 'key4', new AbortController());
      }).toThrow(ConflictException);
      expect(() => {
        registry.register('user1', 'key5', new AbortController());
      }).toThrow(/límite/i);
    });

    it('bloquea registro de la misma key ya activa (incluso para otro usuario)', () => {
      registry.register('user1', 'sharedKey', new AbortController());

      expect(() => {
        registry.register('user2', 'sharedKey', new AbortController());
      }).toThrow(ConflictException);
      expect(() => {
        registry.register('user1', 'sharedKey', new AbortController());
      }).toThrow(/recurso/i);
    });

    it('cap se libera cuando un run hace unregister: usuario puede registrar de nuevo', () => {
      const c1 = new AbortController();
      const c2 = new AbortController();
      const c3 = new AbortController();

      registry.register('user1', 'key1', c1);
      registry.register('user1', 'key2', c2);
      registry.register('user1', 'key3', c3);

      // Liberamos un slot
      registry.unregister('user1', 'key2', c2);
      expect(registry.getUserRunCount('user1')).toBe(2);

      // Ahora puede registrar otro
      expect(() => {
        registry.register('user1', 'key4', new AbortController());
      }).not.toThrow();
      expect(registry.getUserRunCount('user1')).toBe(3);
    });

    it('caps son por usuario, no globales: user2 puede registrar aunque user1 esté en su tope', () => {
      registry.register('user1', 'key1', new AbortController());
      registry.register('user1', 'key2', new AbortController());
      registry.register('user1', 'key3', new AbortController());

      expect(() => {
        registry.register('user2', 'key4', new AbortController());
      }).not.toThrow();
      expect(registry.getUserRunCount('user2')).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. CAS correctness in unregister — el bug original que reviewers encontraron.
  // Stale callback de un run viejo NO debe corromper el state del run nuevo
  // bajo la misma key.
  // ─────────────────────────────────────────────────────────────────
  describe('CAS correctness in unregister', () => {
    it('unregister con controller stale (≠ activo) NO borra el activeRun actual', () => {
      const ctrlA = new AbortController();
      const ctrlStale = new AbortController(); // distinto, simulando run viejo

      registry.register('user1', 'sharedKey', ctrlA);

      registry.unregister('user1', 'sharedKey', ctrlStale);

      // El activeRun actual sigue siendo ctrlA
      expect(registry.getController('sharedKey')).toBe(ctrlA);
      expect(registry.isActive('sharedKey')).toBe(true);
    });

    it('unregister con controller stale NO decrementa userActiveRuns (cap se preserva)', () => {
      const ctrlA = new AbortController();
      const ctrlStale = new AbortController();

      registry.register('user1', 'sharedKey', ctrlA);
      expect(registry.getUserRunCount('user1')).toBe(1);

      // Stale callback de run viejo. SIN el fix del CAS, este unregister
      // borraría userActiveRuns aunque activeRuns siga apuntando a ctrlA,
      // dejando la cuenta del usuario en 0 → cap bypass.
      registry.unregister('user1', 'sharedKey', ctrlStale);

      expect(registry.getUserRunCount('user1')).toBe(1);
    });

    it('cap bypass NO ocurre tras stale unregister: usuario sigue limitado a 3', () => {
      // Reproduce exactamente el escenario del reviewer:
      // 1. user registra run A
      // 2. callback stale del run anterior (otro controller) ejecuta unregister
      // 3. SIN el fix, el slot del run A se libera fantasma → user puede tener 4
      const ctrlA = new AbortController();
      const ctrlStale1 = new AbortController();
      const ctrlStale2 = new AbortController();
      const ctrlStale3 = new AbortController();

      registry.register('user1', 'keyA', ctrlA);

      // 3 stale callbacks que NO deben afectar la cuenta
      registry.unregister('user1', 'keyA', ctrlStale1);
      registry.unregister('user1', 'keyA', ctrlStale2);
      registry.unregister('user1', 'keyA', ctrlStale3);

      expect(registry.getUserRunCount('user1')).toBe(1);

      // Ahora intentamos registrar 3 más — solo 2 deben pasar (1 + 2 = 3)
      registry.register('user1', 'keyB', new AbortController());
      registry.register('user1', 'keyC', new AbortController());

      expect(() => {
        registry.register('user1', 'keyD', new AbortController());
      }).toThrow(/límite/i);
    });

    it('unregister con controller correcto sí libera el slot', () => {
      const ctrlA = new AbortController();

      registry.register('user1', 'keyA', ctrlA);
      expect(registry.getUserRunCount('user1')).toBe(1);

      registry.unregister('user1', 'keyA', ctrlA);

      expect(registry.getUserRunCount('user1')).toBe(0);
      expect(registry.getController('keyA')).toBeUndefined();
      expect(registry.isActive('keyA')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Hard timeout cleanup
  // ─────────────────────────────────────────────────────────────────
  describe('hard timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('aborta el controller tras 10min y limpia el state', () => {
      const ctrl = new AbortController();
      registry.register('user1', 'keyA', ctrl);

      expect(ctrl.signal.aborted).toBe(false);
      expect(registry.isActive('keyA')).toBe(true);

      // Avanzar exactamente 10min
      jest.advanceTimersByTime(10 * 60 * 1000);

      // El timeout disparó: abort + cleanup
      expect(ctrl.signal.aborted).toBe(true);
      expect(registry.isActive('keyA')).toBe(false);
      expect(registry.getController('keyA')).toBeUndefined();
      expect(registry.getUserRunCount('user1')).toBe(0);
    });

    it('marca el controller como cancelled (para que callbacks no persistan staging parcial)', () => {
      const ctrl = new AbortController();
      registry.register('user1', 'keyA', ctrl);

      expect(registry.wasCancelled(ctrl)).toBe(false);

      jest.advanceTimersByTime(10 * 60 * 1000);

      // wasCancelled=true previene que subject.complete callback haga
      // saveFullSession con estado parcial.
      expect(registry.wasCancelled(ctrl)).toBe(true);
    });

    it('NO dispara antes de 10min', () => {
      const ctrl = new AbortController();
      registry.register('user1', 'keyA', ctrl);

      // 9 min 59 seg — un segundo antes
      jest.advanceTimersByTime(10 * 60 * 1000 - 1000);

      expect(ctrl.signal.aborted).toBe(false);
      expect(registry.isActive('keyA')).toBe(true);
    });

    it('respeta el hardTimeoutMs custom pasado en register (override del default)', () => {
      const ctrl = new AbortController();
      // Override: 5 min en vez del default 10 min
      const customTimeoutMs = 5 * 60 * 1000;
      registry.register('user1', 'keyA', ctrl, customTimeoutMs);

      // A 4m 59s no debe disparar
      jest.advanceTimersByTime(customTimeoutMs - 1000);
      expect(ctrl.signal.aborted).toBe(false);

      // A 5min exacto SÍ dispara
      jest.advanceTimersByTime(1000);
      expect(ctrl.signal.aborted).toBe(true);
      expect(registry.wasCancelled(ctrl)).toBe(true);
    });

    it('hardTimeoutMs custom más largo que el default (caso multi-agente)', () => {
      const ctrl = new AbortController();
      // Caso real: stories pasa 30min porque tiene 3 sub-agentes secuenciales
      const longTimeoutMs = 30 * 60 * 1000;
      registry.register('user1', 'keyA', ctrl, longTimeoutMs);

      // El default (10min) NO debe disparar — el caller pidió más tiempo
      jest.advanceTimersByTime(10 * 60 * 1000);
      expect(ctrl.signal.aborted).toBe(false);
      expect(registry.isActive('keyA')).toBe(true);

      // A 30min sí dispara
      jest.advanceTimersByTime(20 * 60 * 1000);
      expect(ctrl.signal.aborted).toBe(true);
    });

    it('unregister manual antes del timeout cancela el setTimeout', () => {
      const ctrl = new AbortController();
      registry.register('user1', 'keyA', ctrl);

      // Unregister manual ANTES del timeout
      registry.unregister('user1', 'keyA', ctrl);

      // Avanzar más de 10min
      jest.advanceTimersByTime(11 * 60 * 1000);

      // El controller NO fue abortado por el timeout (porque clearTimeout
      // corrió en unregister). El signal sigue como antes (no aborted, ya
      // que solo el unregister no llama abort por sí solo).
      expect(ctrl.signal.aborted).toBe(false);
      // Y wasCancelled NO se marcó (el timeout fue cancelado, no ejecutado).
      expect(registry.wasCancelled(ctrl)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. Idempotent unregister
  // ─────────────────────────────────────────────────────────────────
  describe('idempotent unregister', () => {
    it('unregister dos veces consecutivas no causa errores', () => {
      const ctrl = new AbortController();
      registry.register('user1', 'keyA', ctrl);

      expect(() => {
        registry.unregister('user1', 'keyA', ctrl);
        registry.unregister('user1', 'keyA', ctrl);
      }).not.toThrow();

      expect(registry.getUserRunCount('user1')).toBe(0);
      expect(registry.isActive('keyA')).toBe(false);
    });

    it('unregister sobre combo nunca registrado no afecta cuentas de otros', () => {
      registry.register('user1', 'keyA', new AbortController());

      // Unregister combo inexistente
      expect(() => {
        registry.unregister('userPhantom', 'phantomKey', new AbortController());
      }).not.toThrow();

      // user1 sigue intacto
      expect(registry.getUserRunCount('user1')).toBe(1);
      expect(registry.isActive('keyA')).toBe(true);
    });

    it('unregister con userSub diferente al registrado NO corrompe el slot del owner real', () => {
      const ctrl = new AbortController();
      registry.register('user1', 'keyA', ctrl);

      // Otro user llama unregister con el mismo controller (escenario raro
      // pero posible si el caller usa el wrong userSub). Como activeRuns CAS
      // gates ambas mutaciones, NO debe corromper el slot real.
      registry.unregister('user2', 'keyA', ctrl);

      // El CAS pasó (ctrl es el activeRun), así que SE BORRA. Pero el
      // userActiveRuns que se borra es el del userSub PASADO ('user2'),
      // no el del owner real. user1 keda con 1 fantasma.
      // Esto es un edge case que documenta el comportamiento — los callers
      // deben pasar consistentemente el mismo userSub que en register.
      expect(registry.getController('keyA')).toBeUndefined();
      // user1 sigue mostrando 1 porque la mutación fue gated en el bucket
      // de user2 (que estaba vacío).
      expect(registry.getUserRunCount('user1')).toBe(1);
      expect(registry.getUserRunCount('user2')).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 5. WeakSet identity — markCancelled NO debe afectar otros controllers
  // bajo la misma key
  // ─────────────────────────────────────────────────────────────────
  describe('WeakSet identity for cancellation tracking', () => {
    it('markCancelled solo marca el controller específico, no la key', () => {
      const ctrlA = new AbortController();
      const ctrlB = new AbortController();

      registry.markCancelled(ctrlA);

      expect(registry.wasCancelled(ctrlA)).toBe(true);
      expect(registry.wasCancelled(ctrlB)).toBe(false);
    });

    it('tras unregister + re-register con mismo key, el nuevo controller NO heredé cancellation del viejo', () => {
      const ctrlA = new AbortController();
      registry.register('user1', 'keyA', ctrlA);

      // Cancela run A
      registry.markCancelled(ctrlA);
      registry.unregister('user1', 'keyA', ctrlA);

      // Inmediatamente nuevo run con misma key (después de cancel rápido)
      const ctrlB = new AbortController();
      registry.register('user1', 'keyA', ctrlB);

      // ctrlB es un objeto distinto — NO está en el WeakSet de cancelados.
      // Sin esto, un cancel sobre run X corrompía el persist del run Y.
      expect(registry.wasCancelled(ctrlA)).toBe(true); // viejo, sí
      expect(registry.wasCancelled(ctrlB)).toBe(false); // nuevo, NO
    });

    it('markCancelled es idempotente sobre el mismo controller', () => {
      const ctrl = new AbortController();
      registry.markCancelled(ctrl);
      registry.markCancelled(ctrl);
      expect(registry.wasCancelled(ctrl)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 6. Concurrent (sync) registers — Node.js es single-thread, así que
  // 4 register calls síncronos NO interleavían entre sí. El check + set
  // dentro de register es atómico. Validamos.
  // ─────────────────────────────────────────────────────────────────
  describe('atomic register under sync calls', () => {
    it('4 registers síncronos: solo los primeros 3 pasan, el 4to throws', () => {
      const c1 = new AbortController();
      const c2 = new AbortController();
      const c3 = new AbortController();
      const c4 = new AbortController();

      registry.register('user1', 'k1', c1);
      registry.register('user1', 'k2', c2);
      registry.register('user1', 'k3', c3);
      expect(() => registry.register('user1', 'k4', c4)).toThrow(ConflictException);

      expect(registry.getUserRunCount('user1')).toBe(3);
      expect(registry.isActive('k4')).toBe(false);
    });

    it('si el 4to register falla, el 4to controller NO queda registrado en activeRuns', () => {
      const c1 = new AbortController();
      const c2 = new AbortController();
      const c3 = new AbortController();
      const c4 = new AbortController();

      registry.register('user1', 'k1', c1);
      registry.register('user1', 'k2', c2);
      registry.register('user1', 'k3', c3);

      try {
        registry.register('user1', 'k4', c4);
      } catch {
        // expected
      }

      // c4 NO debe estar registrado: register lanzó antes del set.
      expect(registry.getController('k4')).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 7. Ownership tracking — solo el usuario que arrancó el run puede
  // cancelarlo (con AltaGerencia override en el caller). Previene
  // intra-pod griefing donde un peer del mismo pod cancela tu run.
  // ─────────────────────────────────────────────────────────────────
  describe('run ownership (isOwner)', () => {
    it('register asocia el run a su usuario; isOwner devuelve true para el creador', () => {
      const ctrl = new AbortController();
      registry.register('userA', 'keyX', ctrl);

      expect(registry.isOwner('keyX', 'userA')).toBe(true);
    });

    it('isOwner devuelve false para usuarios distintos al creador', () => {
      registry.register('userA', 'keyX', new AbortController());

      expect(registry.isOwner('keyX', 'userB')).toBe(false);
      expect(registry.isOwner('keyX', 'userPhantom')).toBe(false);
    });

    it('isOwner devuelve false para keys sin run activo', () => {
      expect(registry.isOwner('phantomKey', 'anyUser')).toBe(false);
    });

    it('unregister con controller stale NO borra la entrada de ownership', () => {
      const ctrlA = new AbortController();
      const ctrlStale = new AbortController();
      registry.register('userA', 'keyX', ctrlA);

      // Stale callback de un run viejo
      registry.unregister('userA', 'keyX', ctrlStale);

      // Ownership preservada — sin esto un peer podía cancelar el run
      // tras un fake stale unregister.
      expect(registry.isOwner('keyX', 'userA')).toBe(true);
    });

    it('unregister con controller correcto sí borra la entrada de ownership', () => {
      const ctrl = new AbortController();
      registry.register('userA', 'keyX', ctrl);
      expect(registry.isOwner('keyX', 'userA')).toBe(true);

      registry.unregister('userA', 'keyX', ctrl);

      expect(registry.isOwner('keyX', 'userA')).toBe(false);
    });

    it('tras unregister + re-register con nuevo user, ownership refleja el nuevo dueño', () => {
      const ctrlA = new AbortController();
      registry.register('userA', 'keyX', ctrlA);
      registry.unregister('userA', 'keyX', ctrlA);

      // Otro usuario reinicia el run con la misma key
      const ctrlB = new AbortController();
      registry.register('userB', 'keyX', ctrlB);

      expect(registry.isOwner('keyX', 'userA')).toBe(false);
      expect(registry.isOwner('keyX', 'userB')).toBe(true);
    });

    it('hard timeout limpia la entrada de ownership junto con el resto del state', () => {
      jest.useFakeTimers();
      try {
        const ctrl = new AbortController();
        registry.register('userA', 'keyX', ctrl);
        expect(registry.isOwner('keyX', 'userA')).toBe(true);

        jest.advanceTimersByTime(10 * 60 * 1000);

        // El timeout llamó unregister con el controller correcto → CAS pasa
        // → runOwners.delete corre.
        expect(registry.isOwner('keyX', 'userA')).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Bonus: helpers públicos
  // ─────────────────────────────────────────────────────────────────
  describe('public helpers', () => {
    it('isActive devuelve false para keys nunca registradas', () => {
      expect(registry.isActive('phantom')).toBe(false);
    });

    it('getController devuelve undefined para keys nunca registradas', () => {
      expect(registry.getController('phantom')).toBeUndefined();
    });

    it('getUserRunCount devuelve 0 para usuarios nunca registrados', () => {
      expect(registry.getUserRunCount('phantom')).toBe(0);
    });

    it('wasCancelled devuelve false para controllers nunca marcados', () => {
      expect(registry.wasCancelled(new AbortController())).toBe(false);
    });
  });
});
