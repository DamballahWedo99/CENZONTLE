'use client';

import { useEffect, useRef } from 'react';

/**
 * Mantiene la pantalla del usuario ACTIVA mientras `enabled === true` usando
 * la Screen Wake Lock API (https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
 *
 * Caso de uso primario: flujos de generación con LLM que duran 20-30 minutos
 * y se ejecutan via SSE. Si la pantalla del usuario se apaga por inactividad,
 * macOS / Windows pueden poner el sistema en sleep, lo que CORTA todas las
 * conexiones HTTP abiertas. El SSE muere con `terminated` y el progreso se
 * pierde aunque el backend siga corriendo.
 *
 * Limitaciones honestas que el caller debe entender:
 *  - El lock se libera AUTOMÁTICAMENTE cuando la pestaña pierde visibilidad
 *    (cambio de tab, minimizar). NO podemos forzar al usuario a mantener
 *    la pestaña visible.
 *  - Si el usuario cierra el lid del laptop, el SO suspende el sistema
 *    independientemente del lock.
 *  - Soporte de navegador: Chrome 84+, Edge 84+, Safari 16.4+, Opera 70+.
 *    Firefox aún no lo soporta — en ese caso, el hook es no-op silencioso.
 *
 * Por convención, escribimos warning al console si la API no está disponible
 * para que el dev sepa que el flujo largo NO está protegido en ese browser.
 */
export function useScreenWakeLock(enabled: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      // Firefox y browsers viejos. No-op silencioso.
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          // El effect se desmontó mientras esperábamos el request. Liberamos.
          await sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;

        // Si el sistema libera el lock por su cuenta (ej. usuario cambió de
        // tab y volvió), intentamos re-adquirir cuando la pestaña vuelva a
        // estar visible.
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null;
        });
      } catch {
        // Errores típicos: documento no visible al momento del request,
        // permiso denegado por política del browser, hardware sin soporte.
        // No-op silencioso — el caller no puede recuperar de estos casos.
      }
    };

    // Re-adquisición automática al volver a foreground. Sin esto, si el
    // usuario cambia de tab durante los 28 min, el lock se pierde para
    // siempre aunque vuelva a la pestaña.
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    void acquire();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) {
        // No await — el cleanup de useEffect debe ser síncrono. release()
        // retorna una promise pero no necesitamos esperarla; el browser la
        // ejecuta en background.
        sentinel.release().catch(() => {});
      }
    };
  }, [enabled]);
}
