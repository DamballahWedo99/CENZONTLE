'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Terminal, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { createWorkerToken, type GeneratedTokenResponse } from '@/lib/api/factory';

interface GenerateTokenInlineProps {
  /** UUID del nodo para el cual se genera el token. */
  nodeId: string;
  /** Nombre humano del nodo, para el header del panel. */
  nodeName: string;
  /** Callback para cerrar el panel inline. El parent debe controlar
   *  el state que decide si renderizar este componente o no. */
  onClose: () => void;
  /** Callback opcional cuando el token se generó exitosamente — usado
   *  por el parent para refrescar la lista de tokens del nodo. */
  onTokenGenerated?: () => void;
}

/**
 * Panel inline (NO modal) que genera un nuevo Bearer token para un nodo y
 * muestra el comando completo de `factory-worker register` UNA SOLA VEZ
 * (patrón Stripe sk_xxx).
 *
 * Diseño UX (refactor 2026-05-07): antes era un Dialog modal — overlayed
 * y disruptivo cuando el operador estaba comparando con la lista de nodos.
 * Ahora aparece como un panel expandido debajo de la tabla, manteniendo
 * el contexto visual de la flota.
 *
 * Flow:
 *  1. Parent renderiza este componente cuando el user hace click en "Generar"
 *  2. useEffect dispara `createWorkerToken(nodeId)` automáticamente al mount
 *  3. Backend retorna `{plaintext, prefix, id, dashboardUrl}` — mostramos
 *     el comando completo listo para copiar
 *  4. User copia. Al hacer click en X (o cuando el parent desmonta), el
 *     plaintext desaparece de memoria y nunca más se muestra.
 */
export function GenerateTokenInline({
  nodeId,
  nodeName,
  onClose,
  onTokenGenerated,
}: GenerateTokenInlineProps) {
  const [token, setToken] = useState<GeneratedTokenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fallback defensivo: si el backend corre código viejo (deploy incompleto)
  // y NO incluye `dashboardUrl` en el response, degradamos a `localhost:3001`
  // en vez de generar `--dashboard ` vacío que produce un comando inválido.
  const dashboardUrl = token?.dashboardUrl ?? 'http://localhost:3001';
  const command = token
    ? `factory-worker register --dashboard ${dashboardUrl} --token ${token.plaintext}`
    : '';

  // Genera el token automáticamente al montar el componente. Cuando el
  // parent cambia `nodeId` (e.g., el user genera para otro nodo), el
  // efecto re-corre.
  //
  // RACE FIX (heredado del Dialog original): si el user cierra el panel
  // antes de que el fetch complete, el .then() llegaba después del unmount
  // y sobrescribía el token nuevo del próximo open. El flag `cancelled`
  // previene state updates post-cleanup.
  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setToken(null);
    createWorkerToken(nodeId)
      .then((result) => {
        if (cancelled) return;
        setToken(result);
        onTokenGenerated?.();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Error desconocido al generar token');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copiado al portapapeles');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border bg-background p-5 mt-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Token de conexión — {nodeName}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Este token se muestra <strong>una sola vez</strong>. Cópialo ahora; no podrás verlo de
            nuevo. Si lo pierdes, genera uno nuevo y revoca este.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-7 w-7 p-0 shrink-0"
          aria-label="Cerrar panel de token"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-3 py-4 justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generando token...
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {token && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Terminal className="h-3 w-3" />
            Comando para la máquina destino
          </label>
          <div className="flex w-fit max-w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
            <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-green-400 select-all">
              {command}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copy(command)}
              className="h-7 w-7 p-0 shrink-0"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            Después de ejecutar este comando en la máquina remota, corre{' '}
            <code className="font-mono text-foreground">factory-worker start</code> para iniciar el
            daemon de heartbeat.
          </p>
        </div>
      )}
    </div>
  );
}
