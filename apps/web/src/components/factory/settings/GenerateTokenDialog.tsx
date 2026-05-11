'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { createWorkerToken, type GeneratedTokenResponse } from '@/lib/api/factory';

interface GenerateTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string | null;
  nodeName: string;
  /** Callback cuando el user cierra el modal después de copiar — para refrescar la lista de tokens. */
  onTokenGenerated?: () => void;
}

/**
 * Modal que genera un nuevo Bearer token para un nodo y muestra el plaintext
 * UNA SOLA VEZ (patrón Stripe sk_xxx).
 *
 * Flow:
 *  1. User abre el modal desde el botón "Token" en una fila de nodo
 *  2. useEffect dispara `createWorkerToken(nodeId)` automáticamente al abrir
 *  3. Backend retorna `{plaintext, prefix, id}` — mostramos plaintext + comando completo
 *  4. User copia. Al cerrar el modal, el plaintext desaparece de memoria y nunca más se muestra.
 */
export function GenerateTokenDialog({
  open,
  onOpenChange,
  nodeId,
  nodeName,
  onTokenGenerated,
}: GenerateTokenDialogProps) {
  const [token, setToken] = useState<GeneratedTokenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'token' | 'command' | null>(null);

  // FIX 2026-05-06: antes usábamos `window.location.origin` que apunta al
  // frontend Next.js (puerto 3000 en dev). El worker NO pasa por el BFF —
  // necesita el host del API NestJS directo (puerto 3001 en dev). El backend
  // ahora devuelve `token.dashboardUrl` derivado de su env `PUBLIC_API_URL`.
  //
  // Fallback defensivo: si el backend corre código viejo (deploy incompleto)
  // y NO incluye `dashboardUrl` en el response, degradamos a `localhost:3001`
  // en vez de generar `--dashboard ` vacío que produce un comando inválido.
  const dashboardUrl = token?.dashboardUrl ?? 'http://localhost:3001';
  const command = token
    ? `factory-worker register --dashboard ${dashboardUrl} --token ${token.plaintext}`
    : '';

  // Genera el token automáticamente al abrir el modal. Solo una vez por
  // apertura — si el user cierra y reabre, se genera otro distinto.
  //
  // RACE FIX (qa-reviewer F-05 MEDIUM 2026-05-06): si el user cierra el
  // dialog antes de que el fetch complete, el .then() llegaba después del
  // unmount/reset y sobrescribía el token nuevo del próximo dialog open.
  // El flag `cancelled` previene state updates post-cleanup.
  useEffect(() => {
    if (!open || !nodeId) return;
    // Solo dispara si NO hay token todavía. Excluimos `token`/`loading`
    // del array de deps para evitar re-triggers después de set.
    let cancelled = false;
    setLoading(true);
    setError(null);
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
  }, [open, nodeId]);

  const handleClose = (next: boolean) => {
    if (!next) {
      // Reset al cerrar — el plaintext nunca persiste en state después de cerrar.
      setToken(null);
      setError(null);
      setCopiedField(null);
    }
    onOpenChange(next);
  };

  const copy = (text: string, field: 'token' | 'command') => {
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success('Copiado al portapapeles');
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Token de conexión — {nodeName}</DialogTitle>
          <DialogDescription>
            Este token se muestra <strong>una sola vez</strong>. Cópialo ahora; no podrás verlo
            de nuevo. Si lo pierdes, genera uno nuevo y revoca este.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-3 py-8 justify-center text-sm text-muted-foreground">
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
          <div className="space-y-4 py-2">
            {/* Comando completo listo para copiar */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Terminal className="h-3 w-3" />
                Comando para la máquina destino
              </label>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
                <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-green-400 select-all">
                  {command}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(command, 'command')}
                  className="h-7 w-7 p-0 shrink-0"
                >
                  {copiedField === 'command' ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                Después de ejecutar este comando en la máquina remota, corre{' '}
                <code className="font-mono text-foreground">factory-worker start</code> para iniciar el daemon de heartbeat.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => handleClose(false)} disabled={loading}>
            Listo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
